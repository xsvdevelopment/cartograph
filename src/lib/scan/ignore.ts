import type { VirtualFile } from "./types.ts";

/** Directory names skipped wherever they appear in a path. */
export const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  ".jj",
  "node_modules",
  "bower_components",
  "jspm_packages",
  ".pnpm-store",
  "dist",
  "build",
  "out",
  "output",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".vercel",
  ".netlify",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "env",
  ".direnv",
  "target",
  "vendor",
  ".idea",
  ".vscode",
  ".gradle",
  ".mvn",
  "Pods",
  "DerivedData",
  ".dart_tool",
  ".terraform",
  ".serverless",
]);

const IGNORED_BASENAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".eslintcache",
  ".stylelintcache",
  "npm-debug.log",
  "yarn-error.log",
  "pnpm-debug.log",
]);

const IGNORED_EXTENSIONS = new Set([
  "pyc",
  "pyo",
  "class",
  "o",
  "obj",
  "so",
  "dylib",
  "dll",
  "exe",
  "bin",
  "wasm",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "ico",
  "icns",
  "mp3",
  "mp4",
  "wav",
  "webm",
  "mov",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "iso",
  "dmg",
  "pdf",
  "psd",
  "ai",
  "sketch",
]);

const SECRET_BASENAME_RE =
  /^(\.env(\..+)?|credentials|secrets|id_rsa|id_ed25519|\.npmrc|\.pypirc)$/i;
/** Templates meant to be committed, like `.env.example`, are safe to read. */
const SECRET_TEMPLATE_RE = /^\.env\.(example|sample|template|dist|defaults)$/i;
const SECRET_EXT = new Set(["pem", "key", "p12", "pfx", "crt", "cer", "asc"]);

const LOCK_BASENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "cargo.lock",
  "poetry.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "pipfile.lock",
  "flake.lock",
  "uv.lock",
]);

export function normalizeRel(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function basename(path: string): string {
  const n = normalizeRel(path);
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

export function stripRootPrefix(path: string): { root: string; rest: string } {
  const n = normalizeRel(path);
  const i = n.indexOf("/");
  if (i === -1) return { root: n, rest: "" };
  return { root: n.slice(0, i), rest: n.slice(i + 1) };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "{{ANYDIR}}")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/{{ANYDIR}}/g, "(?:.*/)?");
  return new RegExp(`^${escaped}$`);
}

export function parseIgnoreLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
}

/** Patterns from a nested .gitignore; they only apply under `dir`. */
export type ScopedIgnore = { dir: string; patterns: string[] };

export type IgnoreSet = {
  dirs: Set<string>;
  extra: string[];
  scoped: ScopedIgnore[];
};

export function buildIgnoreSet(extra: string[] = [], scoped: ScopedIgnore[] = []): IgnoreSet {
  const dirs = new Set(IGNORED_DIR_NAMES);
  const extraPatterns: string[] = [];
  for (const raw of extra) {
    const p = raw.trim();
    if (!p || p.startsWith("#") || p.startsWith("!")) continue;
    const cleaned = p.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!cleaned.includes("*") && !cleaned.includes("/") && !cleaned.includes(".")) {
      dirs.add(cleaned);
    } else {
      extraPatterns.push(cleaned);
    }
  }
  const cleanedScoped = scoped.map(({ dir, patterns }) => ({
    dir,
    patterns: patterns
      .map((p) => p.trim().replace(/\\/g, "/").replace(/\/+$/, ""))
      .filter((p) => p && !p.startsWith("#") && !p.startsWith("!")),
  }));
  return { dirs, extra: extraPatterns, scoped: cleanedScoped };
}

export function isSecretPath(path: string): boolean {
  const base = basename(path);
  if (SECRET_TEMPLATE_RE.test(base)) return false;
  if (SECRET_BASENAME_RE.test(base)) return true;
  const ext = extname(path);
  if (SECRET_EXT.has(ext)) return true;
  if (/\.(p12|pfx)$/i.test(base)) return true;
  return false;
}

export function isLockfile(path: string): boolean {
  return LOCK_BASENAMES.has(basename(path).toLowerCase());
}

export function isIgnoredPath(path: string, ignore: IgnoreSet): boolean {
  const n = normalizeRel(path);
  if (!n) return true;
  const parts = n.split("/");
  const base = parts[parts.length - 1] ?? n;

  for (const part of parts) {
    if (ignore.dirs.has(part)) return true;
  }
  if (IGNORED_BASENAMES.has(base.toLowerCase())) return true;
  // A previous Cartograph map would otherwise index itself.
  if (base.toLowerCase().endsWith(".cartograph.md")) return true;
  const ext = extname(n);
  if (ext && IGNORED_EXTENSIONS.has(ext)) return true;

  for (const pattern of ignore.extra) {
    if (matchPattern(n, base, pattern)) return true;
  }
  for (const { dir, patterns } of ignore.scoped) {
    if (!n.startsWith(dir + "/")) continue;
    const rest = n.slice(dir.length + 1);
    for (const pattern of patterns) {
      if (matchPattern(rest, base, pattern)) return true;
    }
  }
  return false;
}

function matchPattern(path: string, base: string, pattern: string): boolean {
  if (pattern.startsWith("/") || pattern.includes("/")) {
    // Anchored or path patterns: a match on any leading folder covers
    // everything inside it, as in git.
    const re = globToRegExp(pattern.replace(/^\//, ""));
    return selfAndAncestors(path).some((p) => re.test(p));
  }
  if (pattern.startsWith("*.")) {
    return base.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
  }
  if (pattern.includes("*") || pattern.includes("?")) {
    const re = globToRegExp(pattern);
    return path.split("/").some((part) => re.test(part));
  }
  return path.split("/").includes(pattern);
}

/** `a/b/c.ts` gives `a`, `a/b`, `a/b/c.ts`. */
function selfAndAncestors(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * The outermost ignored folder holding `path`, so the map can name it with a
 * file count. Covers built-in names, gitignore names and paths, and folders
 * whose own `.gitignore` ignores everything (`*`). Null for files ignored on
 * their own, like `*.log`.
 */
export function omittedDirKey(path: string, ignore: IgnoreSet): string | null {
  const parts = normalizeRel(path).split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const folder = parts.slice(0, i + 1).join("/");
    if (ignore.dirs.has(seg)) return folder;
    for (const pattern of ignore.extra) {
      if (!pattern.startsWith("*.") && matchPattern(folder, seg, pattern)) return folder;
    }
    for (const { dir, patterns } of ignore.scoped) {
      if (folder === dir && patterns.some((p) => p === "*" || p === "**")) return folder;
      if (!folder.startsWith(dir + "/")) continue;
      const rest = folder.slice(dir.length + 1);
      if (patterns.some((p) => !p.startsWith("*.") && matchPattern(rest, seg, p))) return folder;
    }
  }
  return null;
}

/**
 * Root ignore files apply everywhere; nested ones (e.g. `.venv/.gitignore`,
 * which is just `*`) only apply inside their own directory, as in git.
 */
export function collectGitignorePatterns(files: VirtualFile[]): {
  root: string[];
  scoped: ScopedIgnore[];
} {
  const root: string[] = [];
  const scoped: ScopedIgnore[] = [];
  for (const f of files) {
    const base = basename(f.path).toLowerCase();
    if (
      (base === ".gitignore" || base === ".cartographignore" || base === ".ignore") &&
      typeof f.content === "string"
    ) {
      const patterns = parseIgnoreLines(f.content);
      const n = normalizeRel(f.path);
      const slash = n.lastIndexOf("/");
      if (slash === -1) root.push(...patterns);
      else scoped.push({ dir: n.slice(0, slash), patterns });
    }
  }
  return { root, scoped };
}
