import { basename } from "./ignore.ts";
import type { CommandGroup } from "./types.ts";

const MAX_PER_GROUP = 16;
const MAX_RUN = 120;

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

const clip = (s: string) => (s.length > MAX_RUN ? s.slice(0, MAX_RUN - 1) + "…" : s);

/** The package manager a project uses, going by the lockfile beside its manifests. */
function runnerFor(paths: Set<string>): string {
  const has = (name: string) => [...paths].some((p) => basename(p).toLowerCase() === name);
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("bun.lockb") || has("bun.lock")) return "bun run";
  return "npm run";
}

/** Toolchains whose commands are the same in every project, keyed by the file that shows one is in use. */
const TOOLCHAINS: [test: RegExp, how: string, commands: string[]][] = [
  [/^cargo\.toml$/, "cargo <name>", ["build", "test", "run"]],
  [/^go\.mod$/, "go <name> ./...", ["build", "test", "vet"]],
  [/^gradlew$/, "./gradlew <name>", ["build", "test"]],
  [/\.sln$/, "dotnet <name>", ["build", "test"]],
];

/**
 * How to build, test and run: the commands a project defines for itself (`package.json`, `deno.json` and
 * `composer.json` scripts, Makefile and justfile targets) and, where a toolchain's commands are fixed, the
 * ones that apply (Cargo, Go, Gradle, .NET). This is what an agent otherwise opens three files to find.
 */
export function findCommands(
  sources: { path: string; content?: string }[],
  allPaths: string[],
): CommandGroup[] {
  const runner = runnerFor(new Set(allPaths));
  const groups: CommandGroup[] = [];
  const paths = new Set(sources.map((s) => s.path));
  /** True when a folder above `path` holds the same file: a workspace member, covered by its root. */
  const nested = (path: string) => {
    const base = basename(path);
    for (let dir = dirOf(dirOf(path)); ; dir = dirOf(dir)) {
      if (paths.has(dir ? `${dir}/${base}` : base) && (dir ? `${dir}/${base}` : base) !== path)
        return true;
      if (!dir) return false;
    }
  };
  for (const { path, content } of sources) {
    const base = basename(path).toLowerCase();
    const commands: CommandGroup["commands"] = [];
    let how = "";
    const toolchain = TOOLCHAINS.find(([test]) => test.test(base));
    if (toolchain) {
      // A Cargo.toml that only lists workspace members still runs the same commands, so no content is needed.
      if (nested(path)) continue;
      how = toolchain[1];
      for (const name of toolchain[2]) {
        // `cargo run` needs a binary; a library crate has none.
        if (
          how.startsWith("cargo") &&
          name === "run" &&
          !allPaths.includes((dirOf(path) ? dirOf(path) + "/" : "") + "src/main.rs")
        )
          continue;
        commands.push({ name });
      }
    } else if (!content) {
      continue;
    } else if (base === "deno.json" || base === "deno.jsonc" || base === "composer.json") {
      const key = base === "composer.json" ? "scripts" : "tasks";
      try {
        const tasks =
          (JSON.parse(content) as Record<string, Record<string, unknown> | undefined>)[key] ?? {};
        for (const [name, run] of Object.entries(tasks)) {
          if (typeof run === "string") commands.push({ name, run: clip(run) });
          else if (Array.isArray(run))
            commands.push({
              name,
              run: clip(run.filter((r) => typeof r === "string").join(" && ")),
            });
          else commands.push({ name });
        }
      } catch {
        continue;
      }
      how = key === "tasks" ? "deno task <name>" : "composer run <name>";
    } else if (base === "package.json") {
      try {
        const scripts =
          (JSON.parse(content) as { scripts?: Record<string, unknown> }).scripts ?? {};
        for (const [name, run] of Object.entries(scripts)) {
          // `npm init` writes a test script that only prints an error.
          if (typeof run === "string" && !/no test specified/i.test(run))
            commands.push({ name, run: clip(run) });
        }
      } catch {
        continue;
      }
      how = `${runner} <name>`;
    } else if (base === "makefile" || base === "gnumakefile" || base === "justfile") {
      const just = base === "justfile";
      const seen = new Set<string>();
      for (const m of content.matchAll(/^([A-Za-z][\w.-]*)(?:[ \t]+[^:=\n]*)?:(?!=)/gm)) {
        const name = m[1];
        if (name === ".PHONY" || seen.has(name)) continue;
        seen.add(name);
        commands.push({ name });
      }
      how = just ? "just <name>" : "make <name>";
    } else continue;
    if (!commands.length) continue;
    groups.push({
      path,
      dir: dirOf(path),
      how,
      commands: commands.slice(0, MAX_PER_GROUP),
      more: Math.max(0, commands.length - MAX_PER_GROUP),
    });
  }
  // Root first: that is where an agent starts.
  const depth = (g: CommandGroup) => (g.dir ? g.dir.split("/").length : 0);
  return groups.sort((a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path)).slice(0, 12);
}

export function isCommandFile(path: string): boolean {
  const base = basename(path).toLowerCase();
  return (
    ["makefile", "gnumakefile", "justfile", "deno.json", "deno.jsonc", "composer.json"].includes(
      base,
    ) || TOOLCHAINS.some(([test]) => test.test(base))
  );
}
