import { basename, extname } from "./ignore.ts";

/** A source file as the import graph sees it. Files without content are still valid import targets. */
export type ImportSource = { path: string; content?: string };

const JS_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro"];
const JS_RESOLVE = [
  "",
  ".ts",
  ".tsx",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".astro",
  ".json",
  ".css",
];
const JS_INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

const JS_IMPORT =
  /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]|(?:^|[\s;])import\s*['"]([^'"\n]+)['"]|\b(?:import|require)\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const PY_FROM = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([^\n#]+)/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([^\n#]+)/gm;

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Joins and normalizes a relative specifier against a directory. Null when it climbs out of the project. */
function joinRel(dir: string, spec: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const seg of spec.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** The npm package a bare specifier names: "react-dom/client" is "react-dom", "@radix-ui/x/y" is "@radix-ui/x". */
function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** A path with its extension and any trailing "/index" removed, so "lib/utils" finds "lib/utils.ts". */
function moduleKey(path: string): string {
  const ext = extname(path);
  let key = ext ? path.slice(0, -(ext.length + 1)) : path;
  if (key.endsWith(".d")) key = key.slice(0, -2);
  if (key.endsWith("/index") || key.endsWith("/__init__")) key = key.slice(0, key.lastIndexOf("/"));
  return key;
}

/**
 * Finds which project files each file imports. Relative imports resolve exactly. Aliased ones ("@/lib/utils",
 * "@shared/types") and absolute Python modules resolve only when exactly one file in the project ends with
 * that path, so a guess is never recorded. Packages named in a manifest are never treated as local.
 *
 * Covers JavaScript, TypeScript, Python, Java, Kotlin, Rust, Dart, C-family includes, stylesheet imports and
 * the scripts and stylesheets an HTML page loads.
 *
 * C# and Go name a namespace or a package, never a file, so those are followed by name: a file uses another
 * when it mentions a type or a package-level name that the other declares and that is in scope there.
 * A name declared in two places that are both in scope is skipped.
 *
 * Returns each importing path with the project paths it pulls in.
 */
export function localImports(
  files: ImportSource[],
  packageNames: Set<string>,
): Map<string, string[]> {
  const all = new Set(files.map((f) => f.path));
  // Last path segment of every module key, to the paths that end with it.
  const byTail = new Map<string, string[]>();
  for (const f of files) {
    const key = moduleKey(f.path);
    const tail = key.slice(key.lastIndexOf("/") + 1);
    const list = byTail.get(tail);
    if (list) list.push(f.path);
    else byTail.set(tail, [f.path]);
  }

  const exact = (base: string, exts: string[], indexes: string[]): string | undefined => {
    for (const e of exts) if (all.has(base + e)) return base + e;
    for (const e of indexes) if (all.has(base + e)) return base + e;
    return undefined;
  };

  /** The one file whose module path ends with `suffix`, on a folder boundary. */
  const bySuffix = (suffix: string, lang: "js" | "py" | "jvm"): string | undefined => {
    const tail = suffix.slice(suffix.lastIndexOf("/") + 1);
    const hits = (byTail.get(tail) ?? []).filter((p) => {
      const ext = extname(p);
      const family = ext === "py" ? "py" : ext === "java" || ext === "kt" ? "jvm" : "js";
      if (family !== lang) return false;
      const key = moduleKey(p);
      return key === suffix || key.endsWith("/" + suffix);
    });
    return hits.length === 1 ? hits[0] : undefined;
  };

  const resolveJs = (from: string, spec: string): string | undefined => {
    const clean = spec.replace(/[?#].*$/, "");
    if (clean.startsWith(".")) {
      const base = joinRel(dirOf(from), clean);
      if (base == null) return undefined;
      // TypeScript ESM writes "./x.js" for a file that is "./x.ts" on disk.
      const bare = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
      return (
        exact(base, JS_RESOLVE, JS_INDEX) ??
        (bare !== base ? exact(bare, JS_RESOLVE, JS_INDEX) : undefined)
      );
    }
    if (clean.startsWith("node:") || packageNames.has(packageOf(clean))) return undefined;
    const suffix = clean.replace(/^[@~#]\/?/, "").replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, "");
    // One bare word could be any package; an alias always names a folder and a file.
    return suffix.includes("/") ? bySuffix(suffix, "js") : undefined;
  };

  const resolvePy = (from: string, dots: string, mod: string, names: string[]): string[] => {
    const rel = mod.replace(/\./g, "/");
    const out: string[] = [];
    const tryBase = (base: string) => exact(base, [".py"], ["/__init__.py"]);
    if (dots) {
      let dir: string | null = dirOf(from);
      for (let i = 1; i < dots.length && dir != null; i++) dir = dir ? dirOf(dir) : null;
      if (dir == null) return out;
      const base = rel ? (dir ? `${dir}/${rel}` : rel) : dir;
      if (rel) {
        const hit = tryBase(base);
        if (hit) out.push(hit);
      }
      // `from . import x` and `from .pkg import x` may name submodules.
      for (const n of names) {
        const hit = tryBase(base ? `${base}/${n}` : n);
        if (hit) out.push(hit);
      }
      return out;
    }
    if (!rel || packageNames.has(mod.split(".")[0])) return out;
    const hit = tryBase(rel) ?? (rel.includes("/") ? bySuffix(rel, "py") : undefined);
    if (hit) out.push(hit);
    return out;
  };

  const byBase = new Map<string, string[]>();
  for (const f of files) {
    const base = basename(f.path);
    const list = byBase.get(base);
    if (list) list.push(f.path);
    else byBase.set(base, [f.path]);
  }
  /** The one file whose full path ends with `spec`, extension included. */
  const byPathSuffix = (spec: string): string | undefined => {
    const clean = spec.replace(/^(\.\/)+/, "");
    const hits = (byBase.get(basename(clean)) ?? []).filter(
      (p) => p === clean || p.endsWith("/" + clean),
    );
    return hits.length === 1 ? hits[0] : undefined;
  };
  /** A path written in a file, against that file's folder or, with a leading slash, the project root. */
  const local = (dir: string, spec: string): string | undefined => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(spec)) return undefined;
    const path = spec.startsWith("/") ? spec.replace(/^\/+/, "") : joinRel(dir, spec);
    return path != null && all.has(path) ? path : undefined;
  };
  /** The Rust source root a file belongs to: the nearest folder above it that holds lib.rs or main.rs. */
  const crateRoot = (from: string): string | undefined => {
    for (let dir = dirOf(from); ; dir = dirOf(dir)) {
      if (all.has(dir ? `${dir}/lib.rs` : "lib.rs") || all.has(dir ? `${dir}/main.rs` : "main.rs"))
        return dir;
      if (!dir) return undefined;
    }
  };
  const rustModule = (base: string) => exact(base, [".rs"], ["/mod.rs"]);

  /** Source with comments and string contents blanked, so a name in prose is not taken for a use. */
  const codeOnly = (src: string) =>
    src.replace(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`[^`]*`/g,
      " ",
    );
  const words = (code: string) => new Set(code.match(/[A-Za-z_]\w*/g) ?? []);

  // ---- C#: types by name, visible through the file's namespace and its `using` lines.
  type CsFile = { ns: string; usings: Set<string>; code: string; own: Set<string> };
  let cs:
    { files: Map<string, CsFile>; types: Map<string, { path: string; ns: string }[]> } | undefined;
  const csIndex = () => {
    if (cs) return cs;
    cs = { files: new Map(), types: new Map() };
    for (const f of files) {
      if (!f.content || extname(f.path) !== "cs") continue;
      const code = codeOnly(f.content);
      const ns = /\bnamespace\s+([\w.]+)/.exec(code)?.[1] ?? "";
      const usings = new Set(
        [...code.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm)].map(
          (m) => m[1],
        ),
      );
      const own = new Set<string>();
      for (const m of code.matchAll(
        /\b(?:record\s+(?:class|struct)|class|struct|interface|enum|record)\s+([A-Za-z_]\w*)/g,
      )) {
        if (own.has(m[1])) continue;
        own.add(m[1]);
        const list = cs.types.get(m[1]);
        if (list) list.push({ path: f.path, ns });
        else cs.types.set(m[1], [{ path: f.path, ns }]);
      }
      cs.files.set(f.path, { ns, usings, code, own });
    }
    return cs;
  };
  const csUses = (from: string): string[] => {
    const { files: all, types } = csIndex();
    const me = all.get(from);
    if (!me) return [];
    const out: string[] = [];
    for (const name of words(me.code)) {
      if (me.own.has(name)) continue;
      const seen = (types.get(name) ?? []).filter(
        (t) =>
          !t.ns ||
          t.ns === me.ns ||
          me.ns.startsWith(t.ns + ".") ||
          me.usings.has(t.ns) ||
          me.code.includes(`${t.ns}.${name}`),
      );
      // A partial class or a name two visible namespaces share could be either file.
      if (seen.length === 1) out.push(seen[0].path);
    }
    return out;
  };

  // ---- Go: a package is a folder; which of its files is used depends on the name that is called.
  type GoFile = { path: string; test: boolean; decl: Set<string> };
  let go: { pkgs: Map<string, GoFile[]>; modules: { name: string; dir: string }[] } | undefined;
  const goIndex = () => {
    if (go) return go;
    go = { pkgs: new Map(), modules: [] };
    for (const f of files) {
      if (!f.content) continue;
      if (f.path === "go.mod" || f.path.endsWith("/go.mod")) {
        const name = /^module\s+(\S+)/m.exec(f.content)?.[1];
        if (name) go.modules.push({ name, dir: dirOf(f.path) });
        continue;
      }
      if (extname(f.path) !== "go") continue;
      const code = codeOnly(f.content);
      const decl = new Set<string>();
      // Methods are left out: `pkg.Name` can only be a function, type, variable or constant.
      for (const m of code.matchAll(/^(?:func|type|var|const)\s+([A-Za-z_]\w*)/gm)) decl.add(m[1]);
      for (const block of code.matchAll(/^(?:var|const|type)\s*\(([\s\S]*?)^\)/gm)) {
        for (const m of block[1].matchAll(/^\s+([A-Za-z_]\w*)/gm)) decl.add(m[1]);
      }
      const dir = dirOf(f.path);
      const list = go.pkgs.get(dir);
      const entry = { path: f.path, test: f.path.endsWith("_test.go"), decl };
      if (list) list.push(entry);
      else go.pkgs.set(dir, [entry]);
    }
    return go;
  };
  const goPackageDir = (spec: string): string | undefined => {
    const { pkgs, modules } = goIndex();
    for (const m of modules) {
      if (spec === m.name) return m.dir;
      if (spec.startsWith(m.name + "/")) {
        const rest = spec.slice(m.name.length + 1);
        return m.dir ? `${m.dir}/${rest}` : rest;
      }
    }
    // No go.mod in the map: the one folder the import path ends with.
    if (modules.length || !spec.includes("/")) return undefined;
    const hits = [...pkgs.keys()].filter(
      (d) => d === spec || d.endsWith("/" + spec) || spec.endsWith("/" + d),
    );
    return hits.length === 1 ? hits[0] : undefined;
  };
  const goUses = (from: string, src: string): string[] => {
    const { pkgs } = goIndex();
    const out: string[] = [];
    const code = codeOnly(src);
    const imports: [alias: string | undefined, path: string][] = [];
    for (const m of src.matchAll(
      /^[ \t]*import[ \t]*\(([\s\S]*?)\)|^[ \t]*import[ \t]+(?:([\w.]+)[ \t]+)?"([^"\n]+)"/gm,
    )) {
      if (m[3]) imports.push([m[2], m[3]]);
      else
        for (const line of m[1].matchAll(/(?:([\w.]+)[ \t]+)?"([^"\n]+)"/g))
          imports.push([line[1], line[2]]);
    }
    for (const [given, path] of imports) {
      const dir = goPackageDir(path);
      const pkg = dir === undefined ? undefined : pkgs.get(dir)?.filter((f) => !f.test);
      if (!pkg?.length || given === "_") continue;
      if (given === ".") {
        out.push(...pkg.map((f) => f.path));
        continue;
      }
      const segs = path.split("/");
      const last =
        /^v\d+$/.test(segs[segs.length - 1]) && segs.length > 1
          ? segs[segs.length - 2]
          : segs[segs.length - 1];
      const alias = given ?? last.replace(/^go-|\.go$/g, "").replace(/[^\w]/g, "_");
      for (const m of code.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_]\\w*)`, "g"))) {
        const hit = pkg.find((f) => f.decl.has(m[1]));
        if (hit) out.push(hit.path);
      }
    }
    // Files of one package see each other without an import.
    const mine = pkgs.get(dirOf(from)) ?? [];
    const self = mine.find((f) => f.path === from);
    if (mine.length > 1) {
      const used = words(code);
      for (const f of mine) {
        if (f.path === from || (f.test && !self?.test)) continue;
        // Short names ("err", "ok", "i") are far more often locals than package-level names.
        for (const name of f.decl) {
          if (name.length >= 4 && !self?.decl.has(name) && used.has(name)) {
            out.push(f.path);
            break;
          }
        }
      }
    }
    return out;
  };

  const C_EXTS = ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm"];
  const STYLE_EXTS = ["css", "scss", "sass", "less"];

  /** Imports in the languages that name a file or a module path outright. */
  const others = (from: string, ext: string, src: string): string[] => {
    const out: string[] = [];
    const push = (hit: string | undefined) => {
      if (hit) out.push(hit);
    };
    const dir = dirOf(from);
    if (ext === "java" || ext === "kt") {
      for (const m of src.matchAll(
        /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+?)(?:\.\*)?[ \t]*;?[ \t]*$/gm,
      )) {
        const parts = m[1].split(".");
        // A static import names a member, so its class is one segment up.
        for (let n = parts.length; n >= 2 && n >= parts.length - 1; n--) {
          const hit = bySuffix(parts.slice(0, n).join("/"), "jvm");
          if (hit) {
            out.push(hit);
            break;
          }
        }
      }
    } else if (ext === "rs") {
      const base = basename(from);
      const stem = base.slice(0, -3);
      // `mod x;` in lib.rs, main.rs or mod.rs is a sibling; anywhere else it sits in a folder named for the file.
      const own = ["mod.rs", "lib.rs", "main.rs"].includes(base)
        ? dir
        : dir
          ? `${dir}/${stem}`
          : stem;
      for (const m of src.matchAll(
        /^[ \t]*(?:pub(?:\([\w: ]+\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm,
      )) {
        push(rustModule(own ? `${own}/${m[1]}` : m[1]));
      }
      const root = crateRoot(from);
      if (root !== undefined) {
        for (const m of src.matchAll(/\bcrate::((?:\w+::)*\w+)/g)) {
          const segs = m[1].split("::");
          // The path ends in an item; the module is the longest leading part that is a file.
          for (let n = segs.length; n >= 1; n--) {
            const hit = rustModule([root, ...segs.slice(0, n)].filter(Boolean).join("/"));
            if (hit) {
              out.push(hit);
              break;
            }
          }
        }
      }
    } else if (C_EXTS.includes(ext)) {
      for (const m of src.matchAll(/^[ \t]*#[ \t]*(?:include|import)[ \t]+"([^"\n]+)"/gm)) {
        push(local(dir, m[1]) ?? byPathSuffix(m[1]));
      }
    } else if (ext === "html" || ext === "htm") {
      for (const m of src.matchAll(
        /<(?:script\b[^>]*?\bsrc|link\b[^>]*?\bhref)=["']([^"'?#]+)/gi,
      )) {
        push(local(dir, m[1]));
      }
    } else if (STYLE_EXTS.includes(ext)) {
      for (const m of src.matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?["']([^"'?#]+)["']/g)) {
        const rel = joinRel(dir, m[1]);
        push(
          local(dir, m[1]) ??
            (rel != null ? exact(rel, [".scss", ".sass", ".less", ".css"], []) : undefined),
        );
      }
    } else if (["ps1", "psm1", "bat", "cmd"].includes(ext)) {
      // Scripts name each other by path, usually behind a variable for their own folder:
      // `. "$here\config.ps1"`, `-File "%~dp0gear.ps1"`, `call tools\build.bat`.
      // A script named in a comment or a printed message ("run RESTORE.bat to undo") is prose, so only
      // lines that run something count: a call, a dot-source, an interpreter, or a path that opens the line.
      const runs =
        /(?:^|[\s(|&;"'])(?:call|start|\.|&|Import-Module|Invoke-Expression|powershell(?:\.exe)?|pwsh|cmd(?:\.exe)?|node|python3?|py|bash|sh)\s|-File\s|^\s*["']?(?:%~\w+|\$\w+|\.{1,2})?[\\/]?[\w.\\/-]+\.(?:ps1|bat|cmd)\b/i;
      for (const line of src.split(/\r?\n/)) {
        if (/^\s*(?:@?rem\b|::|#)/i.test(line) || !runs.test(line)) continue;
        for (const m of line.matchAll(
          /(?:%~[a-z]*\d\\?)?([\w.-][\w.\\/-]*\.(?:ps1|psm1|bat|cmd|py|js|mjs|sh))(?![\w.])/gi,
        )) {
          const spec = m[1].replace(/\\/g, "/").replace(/^(\.\/)+/, "");
          push(
            local(dir, spec) ??
              byPathSuffix(spec) ??
              byPathSuffix(spec.slice(spec.lastIndexOf("/") + 1)),
          );
        }
      }
    } else if (ext === "cs") {
      out.push(...csUses(from));
    } else if (ext === "go") {
      out.push(...goUses(from, src));
    } else if (ext === "dart") {
      for (const m of src.matchAll(/^[ \t]*(?:import|export|part)[ \t]+['"]([^'"\n]+)['"]/gm)) {
        if (m[1].startsWith("package:"))
          push(byPathSuffix("lib/" + m[1].slice(m[1].indexOf("/") + 1)));
        else if (!m[1].includes(":")) push(local(dir, m[1]));
      }
    }
    return out;
  };

  const graph = new Map<string, string[]>();
  for (const f of files) {
    if (!f.content) continue;
    const ext = extname(f.path);
    const found = new Set<string>();
    if (JS_EXTS.includes(ext)) {
      JS_IMPORT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = JS_IMPORT.exec(f.content))) {
        const hit = resolveJs(f.path, m[1] ?? m[2] ?? m[3]);
        if (hit && hit !== f.path) found.add(hit);
      }
    } else if (ext === "py") {
      PY_FROM.lastIndex = 0;
      PY_IMPORT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PY_FROM.exec(f.content))) {
        const names = m[3]
          .replace(/[()]/g, "")
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0])
          .filter((n) => /^\w+$/.test(n));
        for (const hit of resolvePy(f.path, m[1], m[2], names)) if (hit !== f.path) found.add(hit);
      }
      while ((m = PY_IMPORT.exec(f.content))) {
        for (const part of m[1].split(",")) {
          const mod = part.trim().split(/\s+as\s+/)[0];
          if (!/^[\w.]+$/.test(mod)) continue;
          for (const hit of resolvePy(f.path, "", mod, [])) if (hit !== f.path) found.add(hit);
        }
      }
    }
    for (const hit of others(f.path, ext, f.content)) if (hit !== f.path) found.add(hit);
    if (found.size) graph.set(f.path, [...found].sort());
  }
  return graph;
}

/** How many project files import each file. */
export function importedByCounts(graph: Map<string, string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const targets of graph.values())
    for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}
