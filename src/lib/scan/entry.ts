import { basename, extname } from "./ignore.ts";
import { roleOf } from "./languages.ts";
import type { EntryPoint } from "./types.ts";

type Source = { path: string; content?: string };

const MAX_ENTRIES = 10;
const SRC_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const INDEXES = SRC_EXTS.map((e) => "/index" + e);

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function join(dir: string, rel: string): string | null {
  const parts = dir ? dir.split("/") : [];
  for (const seg of rel.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

const depth = (p: string) => p.split("/").length;

const SCRIPT = "runs as a script";
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|c|cc|cpp|h|hpp|swift|dart|rb|php)$/;

/** What a file's own text says about being a place a program starts. */
const CONTENT_RULES: [exts: string[], test: RegExp, why: string][] = [
  [["py"], /^if\s+__name__\s*==\s*['"]__main__['"]\s*:/m, SCRIPT],
  [["go"], /^package\s+main\b[\s\S]*?^func\s+main\s*\(/m, "Go program"],
  [["java"], /\bextends\s+JavaPlugin\b/, "plugin main class"],
  [["java"], /\bpublic\s+static\s+void\s+main\s*\(/, "Java main"],
  [["kt"], /^fun\s+main\s*\(/m, "Kotlin main"],
  [["cs"], /\bstatic\s+(?:async\s+)?(?:void|int|Task(?:<int>)?)\s+Main\s*\(/, "C# main"],
  [["cs"], /\[RuntimeInitializeOnLoadMethod\b/, "runs when the game loads"],
  [["c", "cc", "cpp", "cxx", "m", "mm"], /^\s*(?:int|void)\s+main\s*\(/m, "C main"],
  [["dart"], /^(?:void|Future<void>)\s+main\s*\(/m, "Dart main"],
  [["swift"], /^@main\b/m, "Swift main"],
];

/**
 * Where execution starts: what a manifest names as its main or bin, the script a `start` command runs, the
 * page a browser loads and the script that page loads, and files that declare a main themselves. An agent
 * asked to change behaviour reads from here; without it the first step is a search for "main".
 */
export function findEntryPoints(files: Source[]): { entries: EntryPoint[]; more: number } {
  const all = new Set(files.map((f) => f.path));
  const found = new Map<string, { why: string; rank: number }>();
  const add = (path: string | null | undefined, why: string, rank: number) => {
    if (!path || !all.has(path) || roleOf(path) === "test") return;
    const cur = found.get(path);
    if (!cur || rank < cur.rank) found.set(path, { why, rank });
  };

  /** The source file a manifest path points at, when it names a build output that isn't in the map. */
  const resolve = (dir: string, target: string): string | undefined => {
    const base = join(dir, target);
    if (base == null) return undefined;
    if (all.has(base)) return base;
    const stem = base.replace(/\.(m|c)?jsx?$/, "");
    const stems = [stem];
    // "out/main/index.js" is built from "src/main/index.ts".
    const rel = dir ? stem.slice(dir.length + 1) : stem;
    const swapped = rel.replace(/^(out|dist|build|lib|\.output)\//, "src/");
    if (swapped !== rel) stems.push(dir ? `${dir}/${swapped}` : swapped);
    else if (!rel.startsWith("src/")) stems.push(dir ? `${dir}/src/${rel}` : `src/${rel}`);
    for (const s of stems) {
      for (const e of [...SRC_EXTS, ...INDEXES]) if (all.has(s + e)) return s + e;
    }
    return undefined;
  };

  for (const f of files) {
    const base = basename(f.path).toLowerCase();
    const dir = dirOf(f.path);
    const ext = extname(f.path);

    if (base === "package.json" && f.content) {
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(f.content) as Record<string, unknown>;
      } catch {
        continue;
      }
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const where = dir ? `${dir}/package.json` : "package.json";
      add(resolve(dir, str(pkg.main) ?? ""), `"main" in ${where}`, 0 + depth(f.path));
      const bin = pkg.bin;
      if (typeof bin === "string") add(resolve(dir, bin), `"bin" in ${where}`, 0 + depth(f.path));
      else if (bin && typeof bin === "object") {
        for (const [name, target] of Object.entries(bin as Record<string, unknown>)) {
          add(resolve(dir, str(target) ?? ""), `the \`${name}\` command`, 0 + depth(f.path));
        }
      }
      const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
      for (const name of ["start", "dev", "serve"]) {
        const run = str(scripts[name]);
        const m =
          run &&
          /(?:^|[\s&;])(?:node|nodemon|tsx|ts-node|bun|deno run)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w./-]+)/.exec(
            run,
          );
        if (m) add(resolve(dir, m[1]), `run by the \`${name}\` script`, 1 + depth(f.path));
      }
      continue;
    }

    if (base === "pyproject.toml" && f.content) {
      // [project.scripts] and Poetry's table: `name = "package.module:function"`.
      const table =
        /^\[(?:project\.scripts|tool\.poetry\.scripts)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(
          f.content,
        )?.[1] ?? "";
      for (const m of table.matchAll(
        /^\s*["']?([\w.-]+)["']?\s*=\s*["']([\w.]+)(?::[\w.]+)?["']/gm,
      )) {
        const mod = m[2].replace(/\./g, "/");
        const hit = [
          mod + ".py",
          "src/" + mod + ".py",
          mod + "/__init__.py",
          "src/" + mod + "/__init__.py",
        ]
          .map((p) => (dir ? `${dir}/${p}` : p))
          .find((p) => all.has(p));
        add(hit, `the \`${m[1]}\` command`, 0 + depth(f.path));
      }
      continue;
    }

    if (
      base === "index.html" &&
      depth(f.path) <= 4 &&
      !/(^|\/)(docs?|examples?|coverage)\//.test(f.path)
    ) {
      add(f.path, "page the browser loads", 2 + depth(f.path));
      for (const m of (f.content ?? "").matchAll(/<script\b[^>]*\bsrc=["']([^"'?#]+)["']/gi)) {
        if (/^(https?:)?\/\//.test(m[1])) continue;
        const hit = m[1].startsWith("/")
          ? (resolve("", m[1].slice(1)) ?? resolve(dir, m[1].slice(1)))
          : resolve(dir, m[1]);
        add(hit, `loaded by ${f.path}`, 2 + depth(f.path));
      }
      continue;
    }

    // A batch file at the top of a project is there to be double-clicked.
    if ((ext === "bat" || ext === "cmd") && !dir) {
      add(f.path, "batch file to run", 5);
      continue;
    }
    if (ext === "rs" && /(^|\/)src\/(main|lib)\.rs$/.test(f.path)) {
      add(f.path, base === "main.rs" ? "Rust binary" : "Rust library root", 3 + depth(f.path));
      continue;
    }
    if (base === "manage.py" || base === "__main__.py") {
      add(
        f.path,
        base === "manage.py" ? "Django command line" : "runs with python -m",
        3 + depth(f.path),
      );
      continue;
    }
    // A build script or a one-off tool has a main too, but it is not where the program starts.
    if (!f.content || /(^|\/)(docs?|examples?|samples?)\//.test(f.path)) continue;
    // Only a scripting language has loose scripts; `Assets/Scripts/Boot.cs` is part of the game.
    if (ext === "py" && roleOf(f.path) === "script") continue;
    for (const [exts, test, why] of CONTENT_RULES) {
      if (exts.includes(ext) && test.test(f.content)) {
        add(f.path, why, 4 + depth(f.path));
        break;
      }
    }
  }

  // A few Python files with a main are the program; many of them, or a handful beside a codebase in another
  // language, are build and asset tools.
  const scripts = [...found].filter(([, v]) => v.why === SCRIPT).map(([path]) => path);
  const code = files.filter((f) => CODE_EXT.test(f.path)).length;
  const python = files.filter((f) => f.path.endsWith(".py")).length;
  if (scripts.length > 3 || python * 3 < code) for (const path of scripts) found.delete(path);

  const sorted = [...found.entries()]
    .sort((a, b) => a[1].rank - b[1].rank || a[0].localeCompare(b[0]))
    .map(([path, v]) => ({ path, why: v.why }));
  return { entries: sorted.slice(0, MAX_ENTRIES), more: Math.max(0, sorted.length - MAX_ENTRIES) };
}
