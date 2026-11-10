import { basename, extname } from "./ignore.ts";

const MAX_SUMMARY = 110;

/** Head comments that say nothing about the file: licenses, linter switches, editor modelines. */
const BOILERPLATE =
  /copyright|licen[cs]e|spdx|eslint|prettier|biome-ignore|istanbul|@ts-|tslint|jshint|pylint|noqa|coding[:=]|vim:|^\s*@|^use (strict|client|server)$|do not (remove|edit|modify|touch)|auto-?generated|^(todo|fixme|hack|note)\b/i;

const SLASH_LANGS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "cs",
  "fs",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "dart",
  "php",
  "scala",
  "css",
  "scss",
  "less",
]);
const HASH_LANGS = new Set([
  "py",
  "rb",
  "sh",
  "bash",
  "zsh",
  "yml",
  "yaml",
  "toml",
  "ex",
  "exs",
  "pl",
  "r",
  "ps1",
]);

function tidy(text: string): string | undefined {
  const flat = text
    .replace(/[`*_]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // One unbroken word is a path or a name repeated, not a description.
  if (flat.length < 12 || !flat.includes(" ") || BOILERPLATE.test(flat)) return undefined;
  // First sentence only; "e.g." and "v1.2" are not sentence ends.
  const end = flat.search(/[.!?](?=\s+[A-Z(])/);
  let out = end >= 0 ? flat.slice(0, end + 1) : flat;
  if (out.length > MAX_SUMMARY)
    out = out.slice(0, out.lastIndexOf(" ", MAX_SUMMARY - 1)).replace(/[,;:]$/, "") + "…";
  return out.replace(/\.$/, "");
}

/** Text of the comment a file opens with, before any code. */
function headComment(
  src: string,
  style: "slash" | "hash" | "python" | "batch",
): string | undefined {
  const lines = src.split(/\r?\n/, 60);
  let i = 0;
  if (lines[0]?.startsWith("#!")) i++;
  // Lines every file of the kind opens with, before it says anything about itself.
  const preamble = style === "batch" ? /^@?(echo off|setlocal\b.*)$/i : /^['"]use \w+['"];?$/;
  while (i < lines.length && (!lines[i].trim() || preamble.test(lines[i].trim()))) i++;
  const first = lines[i]?.trim() ?? "";

  // PowerShell's block comment, with or without comment-based help keywords.
  if (style === "hash" && first.startsWith("<#")) {
    const body = lines.slice(i).join("\n");
    const stop = body.indexOf("#>");
    const text = body.slice(2, stop < 0 ? undefined : stop);
    const synopsis = /\.SYNOPSIS\s+([\s\S]*?)(?=\n\s*\.[A-Z]+\b|(?![\s\S]))/.exec(text);
    return (synopsis ? synopsis[1] : text.replace(/^\s*\.[A-Z]+\s*$/gm, " ")).trim() || undefined;
  }

  if (style === "python" && /^[rRuU]?("""|''')/.test(first)) {
    const quote = first.includes('"""') ? '"""' : "'''";
    const body = lines.slice(i).join("\n");
    const start = body.indexOf(quote) + 3;
    const stop = body.indexOf(quote, start);
    return body.slice(start, stop < 0 ? undefined : stop);
  }
  if (style === "slash" && first.startsWith("/*")) {
    const out: string[] = [];
    for (; i < lines.length; i++) {
      const done = lines[i].includes("*/");
      out.push(lines[i].replace(/^\s*\/?\*+!?\/?/, "").replace(/\*\/.*$/, ""));
      if (done) break;
    }
    // JSDoc tags start the machine-readable part.
    const text = out.join(" ");
    const tag = text.search(/\s@\w+/);
    return tag >= 0 ? text.slice(0, tag) : text;
  }
  const mark =
    style === "slash"
      ? /^\s*\/\/[/!]?\s?/
      : style === "batch"
        ? /^\s*(?:@?rem(?:\s|$)|::)\s?/i
        : /^\s*#+!?\s?/;
  const out: string[] = [];
  for (; i < lines.length && mark.test(lines[i]); i++) {
    const text = lines[i].replace(mark, "");
    if (!text.trim() && out.length) break;
    out.push(text);
  }
  return out.length ? out.join(" ") : undefined;
}

/**
 * One line on what a file is, taken from the file itself: the comment it opens with, a Python module
 * docstring, or a document's first heading. Undefined when the file doesn't say.
 */
export function fileSummary(path: string, content: string): string | undefined {
  const ext = extname(path);
  if (["md", "mdx", "rst", "adoc"].includes(ext)) {
    const m = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/m.exec(content.slice(0, 4000));
    if (!m) return undefined;
    const title = tidy(m[1]);
    // A README headed with its own project name adds nothing.
    const stem = basename(path)
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
    return title && title.toLowerCase() !== stem ? title : undefined;
  }
  const style =
    ext === "py"
      ? "python"
      : SLASH_LANGS.has(ext)
        ? "slash"
        : HASH_LANGS.has(ext)
          ? "hash"
          : ext === "bat" || ext === "cmd"
            ? "batch"
            : undefined;
  if (!style) return undefined;
  let text = headComment(content, style);
  if (text == null && style === "python") text = headComment(content, "hash");
  return text ? tidy(text) : undefined;
}
