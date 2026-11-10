import { extname } from "./ignore.ts";

const MAX_SYMBOLS = 300;

/** Extension to use for a file with none, going by the language its `#!` line named. */
const SCRIPT_EXT: Record<string, string> = {
  Python: "py",
  JavaScript: "js",
  Ruby: "rb",
  Shell: "sh",
};

export function extractSymbols(path: string, content: string, language?: string): string[] {
  const lang = extname(path) || SCRIPT_EXT[language ?? ""] || "";
  try {
    if (["sh", "bash", "zsh"].includes(lang)) return shellSymbols(content);
    if (["ps1", "psm1"].includes(lang)) return powershellSymbols(content);
    if (["bat", "cmd"].includes(lang)) return batchSymbols(content);
    if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(lang)) {
      return jsSymbols(content);
    }
    if (lang === "py") return pythonSymbols(content);
    if (lang === "go") return goSymbols(content);
    if (lang === "rs") return rustSymbols(content);
    if (["java", "kt", "kts"].includes(lang)) return jvmSymbols(content);
    if (lang === "rb") return rubySymbols(content);
    if (["cs", "fs"].includes(lang)) return csharpSymbols(content);
    if (lang === "swift") return swiftSymbols(content);
    if (["vue", "svelte", "astro"].includes(lang)) return jsSymbols(content);
  } catch {
    return [];
  }
  return [];
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

/** Returns the substring between the `{` at openIdx and its matching `}` (exclusive of both braces). */
function extractBalanced(src: string, openIdx: number): string | null {
  if (src[openIdx] !== "{") return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

const JS_RESERVED = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "try",
  "finally",
  "super",
  "this",
]);

/** Method / class-field-arrow names inside every top-level (and nested) class body, as `ClassName.method`. */
function jsClassMembers(src: string): string[] {
  const found: string[] = [];
  const classHeader =
    /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = classHeader.exec(src))) {
    const className = m[1];
    const openIdx = m.index + m[0].length - 1;
    const body = extractBalanced(src, openIdx);
    if (!body) continue;

    const methodRe =
      /^[ \t]*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|abstract\s+|override\s+|async\s+)*(?:get\s+|set\s+)?(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm;
    let mm: RegExpExecArray | null;
    while ((mm = methodRe.exec(body))) {
      const name = mm[1];
      if (JS_RESERVED.has(name) && name !== "constructor") continue;
      found.push(`${className}.${name}`);
    }

    const fieldArrowRe =
      /^[ \t]*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(#?[A-Za-z_$][\w$]*)\s*(?::\s*[^=;\n]+)?=\s*(?:async\s*)?\(/gm;
    while ((mm = fieldArrowRe.exec(body))) {
      found.push(`${className}.${mm[1]}`);
    }
  }
  return found;
}

function jsSymbols(src: string): string[] {
  const found: string[] = [];
  const exportBlock =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  const exportList = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  const exportStarAs = /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g;
  const namedFn = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  const namedClass = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm;
  const namedConstFn =
    /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function\b)/gm;
  let m: RegExpExecArray | null;
  while ((m = exportBlock.exec(src))) found.push(m[1]);
  while ((m = exportList.exec(src))) {
    for (const part of m[1].split(",")) {
      const name = part.replace(/\s+as\s+[A-Za-z_$][\w$]*/g, "").trim();
      if (name && name !== "type" && name !== "default") found.push(name);
    }
  }
  while ((m = exportStarAs.exec(src))) found.push(m[1]);
  while ((m = namedFn.exec(src))) found.push(m[1]);
  while ((m = namedClass.exec(src))) found.push(m[1]);
  while ((m = namedConstFn.exec(src))) found.push(m[1]);
  found.push(...jsClassMembers(src));
  return uniq(found);
}

function pythonSymbols(src: string): string[] {
  const found: string[] = [];
  const lines = src.split("\n");
  const classStack: { indent: number; name: string }[] = [];
  const classRe = /^([ \t]*)class\s+([A-Za-z_][\w]*)/;
  const defRe = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_][\w]*)/;
  for (const line of lines) {
    const cm = classRe.exec(line);
    if (cm) {
      const indent = cm[1].length;
      while (classStack.length && classStack[classStack.length - 1].indent >= indent) {
        classStack.pop();
      }
      found.push(cm[2]);
      classStack.push({ indent, name: cm[2] });
      continue;
    }
    const dm = defRe.exec(line);
    if (dm) {
      const indent = dm[1].length;
      while (classStack.length && classStack[classStack.length - 1].indent >= indent) {
        classStack.pop();
      }
      const owner = classStack[classStack.length - 1];
      found.push(owner ? `${owner.name}.${dm[2]}` : dm[2]);
    }
  }
  return uniq(found);
}

function goSymbols(src: string): string[] {
  const found: string[] = [];
  const re =
    /^func\s+(?:\(([^)]+)\)\s+)?([A-Za-z_][\w]*)|^type\s+([A-Za-z_][\w]*)|^var\s+([A-Za-z_][\w]*)|^const\s+([A-Za-z_][\w]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[2]) {
      if (m[1]) {
        const recv = /\*?\s*([A-Za-z_][\w]*)\s*$/.exec(m[1].trim());
        found.push(recv ? `${recv[1]}.${m[2]}` : m[2]);
      } else {
        found.push(m[2]);
      }
    } else {
      found.push(m[3] || m[4] || m[5]);
    }
  }
  return uniq(found);
}

function rustSymbols(src: string): string[] {
  const found: string[] = [];
  const topRe =
    /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|mod|const)\s+([A-Za-z_][\w]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = topRe.exec(src))) found.push(m[1]);

  const implRe = /^impl(?:<[^>]*>)?\s+(?:[A-Za-z_][\w:<>]*\s+for\s+)?([A-Za-z_][\w]*)/gm;
  while ((m = implRe.exec(src))) {
    const typeName = m[1];
    const openIdx = src.indexOf("{", m.index + m[0].length - 1);
    if (openIdx === -1) continue;
    const body = extractBalanced(src, openIdx);
    if (!body) continue;
    const fnRe =
      /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][\w]*)/gm;
    let mm: RegExpExecArray | null;
    while ((mm = fnRe.exec(body))) found.push(`${typeName}.${mm[1]}`);
  }
  return uniq(found);
}

function jvmSymbols(src: string): string[] {
  const found: string[] = [];
  const re =
    /(?:(?:public|private|protected|internal|open|data|sealed|abstract|final)\s+)*(?:class|interface|object|fun|enum class)\s+([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push(m[1]);
  return uniq(found);
}

function rubySymbols(src: string): string[] {
  const found: string[] = [];
  const re = /^[ \t]*(?:module|class)\s+([A-Z][\w:]*)|^[ \t]*def\s+([A-Za-z_][\w?!=]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push(m[1] || m[2]);
  return uniq(found);
}

function csharpSymbols(src: string): string[] {
  const found: string[] = [];
  const typeRe =
    /(?:public|internal|protected|private)\s+(?:static\s+)?(?:partial\s+)?(?:class|interface|struct|record|enum)\s+([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = typeRe.exec(src))) found.push(m[1]);

  const methodRe =
    /(?:public|internal|protected|private)\s+(?:static\s+|virtual\s+|override\s+|async\s+|sealed\s+)*[A-Za-z_][\w<>[\],. ?]*\s+([A-Za-z_][\w]*)\s*\(/g;
  while ((m = methodRe.exec(src))) {
    const name = m[1];
    if (name === "get" || name === "set" || name === "new") continue;
    found.push(name);
  }
  return uniq(found);
}

function shellSymbols(src: string): string[] {
  const found: string[] = [];
  const re = /^[ \t]*(?:function\s+([A-Za-z_][\w:-]*)|([A-Za-z_][\w:-]*)\s*\(\s*\))\s*\{?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push(m[1] || m[2]);
  return uniq(found);
}

function powershellSymbols(src: string): string[] {
  const found: string[] = [];
  const re = /^[ \t]*(?:function|filter)\s+(?:(?:global|script|private):)?([A-Za-z_][\w-]*)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push(m[1]);
  return uniq(found);
}

/** A batch file's labels are its subroutines: what `call :name` and `goto name` jump to. */
function batchSymbols(src: string): string[] {
  const found: string[] = [];
  const re = /^[ \t]*:([A-Za-z_][\w-]*)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) if (m[1].toLowerCase() !== "eof") found.push(m[1]);
  return uniq(found);
}

function swiftSymbols(src: string): string[] {
  const found: string[] = [];
  const re =
    /^[ \t]*(?:(?:public|open|internal|private|fileprivate)\s+)*(?:final\s+)?(?:class|struct|enum|protocol|func|actor)\s+([A-Za-z_][\w]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push(m[1]);
  return uniq(found);
}

export function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  if (text.endsWith("\n") && n > 1) n--;
  return n;
}
