import { fileRole } from "./languages.ts";
import type { ListedFile } from "./types.ts";

export function mapFileName(rootName: string): string {
  const safe = rootName.replace(/[^\w.-]+/g, "-") || "project";
  return `${safe}.cartograph.md`;
}

/** The rule for CLAUDE.md / AGENTS.md / .cursorrules. The desktop app can append it; the web app only copies it. */
export function renderAgentBrief(rootName: string): string {
  const file = mapFileName(rootName);
  return `# Project map: search ${file} first

This repo has a Cartograph map, \`${file}\`, listing every folder, file,
symbol and dependency. Claude Code, Cursor, Codex, Aider or any other coding
agent should use it as the project index.

## Before you explore the repo

1. Read \`${file}\`.
2. Search it for the folder, file name, function, class, language or package you need.
3. Take the path from the File index. The Directory tree shows folders only.
4. Open only that path in the real repo.

## Don't

- List the whole repo to get your bearings (\`ls -R\`, \`find\`, \`glob **\`).
- Read source files wholesale when the map already says what is in them.
- Treat an omitted folder as missing or empty. It was skipped on purpose.
- Delete, rename or edit files because they aren't in the map. The map describes
  the repo; it gives no permission to change it.

## Where to look in ${file}

| You need | Search this heading |
|---|---|
| A folder or file name | Directory tree, File index |
| A function, class or export | File index |
| A package | Dependency tree |
| Where the program starts | Entry points |
| How to build, test or run | Commands |
| What else uses a file | File index ("used by"), Most imported |
| A language | Languages |
| A feature area | Quick find |

If the map isn't in context yet, read \`${file}\` before answering.
`;
}

export function standingOrdersMarkdown(rootName: string): string {
  const file = mapFileName(rootName);
  return `## For coding agents

This file (\`${file}\`) is the project index. Search it before you look
around the repo.

1. Search this file for the folder, file name, symbol, language or package.
2. Copy the path from **File index** or **Quick find**. The tree shows folders only.
3. Open only that path in the real repo.
4. Don't start with a recursive listing (\`ls -R\`, \`find\`, \`glob **/*\`).
5. Omitted folders exist on disk; they were skipped on purpose. Nothing here is a
   reason to delete or edit a file.

| Need | Heading to search |
|---|---|
| folder | Directory tree |
| file name / function / class / export | File index |
| where the program starts | Entry points |
| how to build, test, run | Commands |
| what else uses a file | File index ("used by N"), Most imported |
| package | Dependency tree |
| language | Languages |
| feature area | Quick find |`;
}

export function standingOrdersCompact(rootName: string): string {
  const file = mapFileName(rootName);
  return [
    `FOR AGENTS: search ${file} before the repo.`,
    `  folder>TREE  file/symbol>INDEX  starts at>ENTRY  run/test>CMD  package>DEPS  area>FIND  language>lang line`,
    `  INDEX line: path lang lines role [<N = imported by N files] [symbols] [# what the file says it is]`,
    `  Then open only that path. No ls -R/find/glob. Omitted dirs exist. Never delete or edit because of this file.`,
  ].join("\n");
}

/** Roles worth a row in Quick find, in the order an agent tends to need them. */
const ROLE_NEED: [string, string][] = [
  ["source", "source"],
  ["ui", "UI / components"],
  ["route", "routes / pages"],
  ["service", "services / API"],
  ["lib", "shared libraries"],
  ["state", "state"],
  ["hook", "hooks"],
  ["types", "types"],
  ["test", "tests"],
  ["script", "scripts"],
  ["migration", "migrations"],
  ["ci", "CI / workflows"],
  ["docs", "docs"],
];

/** Every role that is the program itself, as opposed to its tests, tooling and docs. */
const APP_CODE = new Set(["source", "ui", "route", "service", "lib", "state", "hook", "types"]);

/** Share of a set of files a folder must hold to stand for the set. */
const HINT_SHARE = 0.6;
/** Share a top-level folder needs to be named when no one folder stands for the set. */
const SPLIT_SHARE = 0.25;

const depthOf = (dir: string) => dir.split("/").length;

/** The deepest folder that still holds most of `paths`. */
function focus(paths: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of paths) {
    for (let i = p.lastIndexOf("/"); i > 0; i = p.lastIndexOf("/", i - 1)) {
      const dir = p.slice(0, i);
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  for (const [dir, n] of counts) {
    if (n < paths.length * HINT_SHARE) continue;
    if (
      !best ||
      depthOf(dir) > depthOf(best) ||
      (depthOf(dir) === depthOf(best) && n > counts.get(best)!)
    )
      best = dir;
  }
  return best;
}

/**
 * Where a set of files lives: one folder when one holds most of them, else the two top-level folders that
 * share them (an app and a server, a core and a plugin), each narrowed the same way.
 */
function places(paths: string[]): string[] {
  if (paths.length === 1) return [paths[0]];
  const one = focus(paths);
  if (one) return [one];
  const byTop = new Map<string, string[]>();
  for (const p of paths) {
    const i = p.indexOf("/");
    if (i < 0) continue;
    const top = p.slice(0, i);
    const list = byTop.get(top);
    if (list) list.push(p);
    else byTop.set(top, [p]);
  }
  return [...byTop]
    .filter(([, list]) => list.length >= paths.length * SPLIT_SHARE)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([top, list]) => (list.length === 1 ? list[0] : (focus(list) ?? top)))
    .sort();
}

/**
 * One or two places to look per kind of file. Tests spread over `tests/unit` and `tests/e2e` point at
 * `tests`, not at whichever half is bigger. "source" covers all of the program's own code, so it names the
 * folder the app lives in even when every file in it has a narrower role.
 */
export function directoryHints(files: ListedFile[]): { need: string; path: string }[] {
  const byRole = new Map<string, string[]>();
  const app: string[] = [];
  for (const f of files) {
    // Only files that were read: a folder of icons is not where the source lives.
    if (f.kind !== "text") continue;
    const role = fileRole(f.path, f.language);
    if (APP_CODE.has(role)) app.push(f.path);
    const list = byRole.get(role);
    if (list) list.push(f.path);
    else byRole.set(role, [f.path]);
  }
  byRole.set("source", app);

  const out: { need: string; path: string }[] = [];
  for (const [role, need] of ROLE_NEED) {
    const paths = byRole.get(role);
    if (!paths?.length) continue;
    for (const path of places(paths)) {
      // A narrower row that only repeats the source row says nothing.
      if (
        role !== "source" &&
        out[0]?.need === "source" &&
        out.some((o) => o.need === "source" && o.path === path)
      )
        continue;
      out.push({ need, path });
    }
  }
  return out;
}
