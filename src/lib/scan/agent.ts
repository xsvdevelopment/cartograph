import { roleOf } from "./languages.ts";
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
3. Take the path from the File index or the Directory tree.
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
| A package or import | Dependency tree |
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
2. Copy the path from **Directory tree**, **Quick find** or **File index**.
3. Open only that path in the real repo.
4. Don't start with a recursive listing (\`ls -R\`, \`find\`, \`glob **/*\`).
5. Omitted folders exist on disk; they were skipped on purpose. Nothing here is a
   reason to delete or edit a file.

| Need | Heading to search |
|---|---|
| folder / file name | Directory tree, File index |
| function / class / export | File index |
| package / import | Dependency tree |
| language | Languages |
| feature area | Quick find |`;
}

export function standingOrdersCompact(rootName: string): string {
  const file = mapFileName(rootName);
  return [
    `FOR AGENTS: search ${file} before the repo.`,
    `  folder>TREE  file/symbol>INDEX  package>DEPS  area>FIND  language>lang line`,
    `  Then open only that path. No ls -R/find/glob. Omitted dirs exist. Never delete or edit because of this file.`,
  ].join("\n");
}

const ROLE_NEED: Record<string, string> = {
  ui: "UI / components",
  route: "routes / pages",
  service: "services / API",
  lib: "shared libraries",
  test: "tests",
  manifest: "package manifests",
  config: "config",
  docs: "docs",
  script: "scripts",
  types: "types",
  state: "state",
  hook: "hooks",
  overview: "README / overview",
  migration: "migrations",
  source: "source",
};

export function directoryHints(
  files: ListedFile[],
): { need: string; path: string }[] {
  const dirs = new Map<string, Map<string, number>>();
  for (const f of files) {
    if (f.kind === "skipped") continue;
    const i = f.path.lastIndexOf("/");
    if (i <= 0) continue;
    const dir = f.path.slice(0, i);
    const role = roleOf(f.path);
    const roles = dirs.get(dir) ?? new Map<string, number>();
    roles.set(role, (roles.get(role) ?? 0) + 1);
    dirs.set(dir, roles);
  }

  const rows: { need: string; path: string; n: number }[] = [];
  for (const [path, roles] of dirs) {
    let best = "source";
    let bestN = 0;
    for (const [role, n] of roles) {
      if (n > bestN) {
        best = role;
        bestN = n;
      }
    }
    const need = ROLE_NEED[best];
    if (!need) continue;
    rows.push({ need, path, n: bestN });
  }
  rows.sort((a, b) => b.n - a.n || a.path.localeCompare(b.path));

  const seenNeed = new Set<string>();
  const seenPath = new Set<string>();
  const out: { need: string; path: string }[] = [];
  for (const r of rows) {
    if (seenNeed.has(r.need)) continue;
    if ([...seenPath].some((p) => r.path.startsWith(p + "/"))) continue;
    seenNeed.add(r.need);
    seenPath.add(r.path);
    out.push({ need: r.need, path: r.path });
    if (out.length >= 12) break;
  }
  return out;
}
