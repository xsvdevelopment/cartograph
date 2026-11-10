import { basename, extname } from "./ignore.ts";
import type { ListedFile, TreeNode } from "./types.ts";

/** A folder with more assets of one kind than this gets one summary line instead of one per file. */
const IMAGE_GROUP_MIN = 5;

/** Asset kinds worth summarizing, and the plural used in the summary. */
const GROUPED: Record<string, string> = { Image: "images", "3D model": "models" };

/**
 * Data is worth a line per file until one folder holds this many of a kind. Past that they are records
 * (cached responses, fixtures, exports) and listing each would bury the source under them.
 */
const DATA_GROUP_MIN = 20;
const BULK: Record<string, string> = {
  JSON: "JSON files",
  CSV: "CSV files",
  XML: "XML files",
  YAML: "YAML files",
  Text: "text files",
  Log: "logs",
  SVG: "SVG files",
  Other: "other files",
};

export type ImageGroup = {
  dir: string;
  language: string;
  count: number;
  bytes: number;
  exts: string[];
};

function dirOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function groupKey(f: ListedFile): string | undefined {
  if (f.kind === "secret" || f.kind === "lock") return undefined;
  return GROUPED[f.language] || BULK[f.language]
    ? `${dirOf(f.path)}\u0000${f.language}`
    : undefined;
}

/** Folders full of images or models, which the map summarizes instead of listing. */
export function imageGroups(files: ListedFile[]): Map<string, ImageGroup> {
  const byKey = new Map<string, ImageGroup>();
  for (const f of files) {
    const key = groupKey(f);
    if (!key) continue;
    const g = byKey.get(key) ?? {
      dir: dirOf(f.path),
      language: f.language,
      count: 0,
      bytes: 0,
      exts: [],
    };
    g.count += 1;
    g.bytes += f.size;
    const ext = extname(f.path);
    if (ext && !g.exts.includes(ext)) g.exts.push(ext);
    byKey.set(key, g);
  }
  for (const [key, g] of byKey) {
    if (g.count < (GROUPED[g.language] ? IMAGE_GROUP_MIN : DATA_GROUP_MIN)) byKey.delete(key);
  }
  return byKey;
}

export function imageGroupLabel(g: ImageGroup): string {
  const exts = g.exts.sort();
  const shown = exts.length > 6 ? exts.slice(0, 6).join(", ") + ", …" : exts.join(", ");
  return `${g.count} ${GROUPED[g.language] ?? BULK[g.language]}${shown ? ` (${shown})` : ""}`;
}

export function imageGroupRole(g: ImageGroup): string {
  return GROUPED[g.language] || g.language === "SVG" ? "asset" : "data";
}

/**
 * Files in index order, with each asset-heavy folder's images or models
 * replaced by one summary entry where the first of them would have been.
 */
export function indexEntries(files: ListedFile[]): (ListedFile | ImageGroup)[] {
  const groups = imageGroups(files);
  const out: (ListedFile | ImageGroup)[] = [];
  const emitted = new Set<string>();
  for (const f of files) {
    const key = groupKey(f);
    const g = key ? groups.get(key) : undefined;
    if (!g || !key) {
      out.push(f);
    } else if (!emitted.has(key)) {
      emitted.add(key);
      out.push(g);
    }
  }
  return out;
}

export function isImageGroup(e: ListedFile | ImageGroup): e is ImageGroup {
  return "exts" in e;
}

export function buildTree(
  files: ListedFile[],
  omittedDirs: { path: string; count: number }[],
  rootName: string,
): TreeNode {
  const root: TreeNode = {
    name: rootName,
    path: "",
    type: "dir",
    children: [],
  };

  const dirMap = new Map<string, TreeNode>();
  dirMap.set("", root);

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const parentPath = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
    const parent = ensureDir(parentPath);
    const node: TreeNode = {
      name: basename(dirPath) || dirPath,
      path: dirPath,
      type: "dir",
      children: [],
    };
    parent.children = parent.children ?? [];
    parent.children.push(node);
    dirMap.set(dirPath, node);
    return node;
  };

  for (const entry of indexEntries(files)) {
    if (isImageGroup(entry)) {
      const parent = ensureDir(entry.dir);
      parent.children = parent.children ?? [];
      parent.children.push({
        name: `[${imageGroupLabel(entry)}]`,
        path: `${entry.dir}/*${entry.language}*`,
        type: "file",
        language: entry.language,
        size: entry.bytes,
      });
      continue;
    }
    const file = entry;
    const parent = ensureDir(dirOf(file.path));
    parent.children = parent.children ?? [];
    parent.children.push({
      name: basename(file.path),
      path: file.path,
      type: "file",
      language: file.language,
      size: file.size,
    });
  }

  for (const omitted of omittedDirs) {
    const parentPath = omitted.path.includes("/")
      ? omitted.path.slice(0, omitted.path.lastIndexOf("/"))
      : "";
    const parent = ensureDir(parentPath);
    parent.children = parent.children ?? [];
    const already = parent.children.some((c) => c.path === omitted.path && c.omitted);
    if (already) continue;
    parent.children.push({
      name: basename(omitted.path),
      path: omitted.path,
      type: "dir",
      omitted: true,
      omittedCount: omitted.count,
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node: TreeNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    if (!!a.omitted !== !!b.omitted) return a.omitted ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

/**
 * Folders only, each with the number of listed files beneath it. Every file is already in the file index with
 * its full path, so naming them here a second time would double the map. A folder whose only content is one
 * more folder is written on the same line ("docs/guides/api/").
 */
export function renderDirTree(root: TreeNode, files: ListedFile[], compact = false): string {
  const under = new Map<string, number>();
  const direct = new Map<string, number>();
  for (const f of files) {
    if (f.kind === "skipped") continue;
    let dir = dirOf(f.path);
    direct.set(dir, (direct.get(dir) ?? 0) + 1);
    for (;;) {
      under.set(dir, (under.get(dir) ?? 0) + 1);
      if (!dir) break;
      dir = dirOf(dir);
    }
  }
  const dirsOf = (node: TreeNode) => (node.children ?? []).filter((c) => c.type === "dir");
  const count = (n: number) => (compact ? String(n) : `${n} file${n === 1 ? "" : "s"}`);
  const lines: string[] = [
    compact
      ? `${root.name}/ ${count(under.get("") ?? 0)}`
      : `${root.name}/ · ${count(under.get("") ?? 0)}`,
  ];

  const visit = (node: TreeNode, prefix: string, isLast: boolean) => {
    let label = node.name;
    while (!node.omitted && !direct.get(node.path)) {
      const kids = dirsOf(node);
      if (kids.length !== 1) break;
      node = kids[0];
      label += "/" + node.name;
    }
    const branch = compact ? "" : isLast ? "└── " : "├── ";
    if (node.omitted) {
      const n = node.omittedCount ?? 0;
      lines.push(
        prefix +
          branch +
          (compact
            ? `${label}/ [omitted ${n}]`
            : `${label}/  [omitted · ${n} file${n === 1 ? "" : "s"}]`),
      );
      return;
    }
    const n = under.get(node.path) ?? 0;
    lines.push(prefix + branch + (compact ? `${label}/ ${n}` : `${label}/ · ${n}`));
    const kids = dirsOf(node);
    const next = prefix + (compact ? "  " : isLast ? "    " : "│   ");
    kids.forEach((k, i) => visit(k, next, i === kids.length - 1));
  };
  const top = dirsOf(root);
  top.forEach((k, i) => visit(k, compact ? "  " : "", i === top.length - 1));
  return lines.join("\n");
}
