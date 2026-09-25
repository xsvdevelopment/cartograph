import { basename } from "./ignore.ts";
import type { ListedFile, TreeNode } from "./types.ts";

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
    const parentPath = dirPath.includes("/")
      ? dirPath.slice(0, dirPath.lastIndexOf("/"))
      : "";
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

  for (const file of files) {
    const dir = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";
    const parent = ensureDir(dir);
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
    const already = parent.children.some(
      (c) => c.path === omitted.path && c.omitted,
    );
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

export function renderTreeAscii(root: TreeNode): string {
  const lines: string[] = [`${root.name}/`];
  const children = root.children ?? [];
  children.forEach((child, i) => {
    walk(child, "", i === children.length - 1, lines);
  });
  return lines.join("\n");
}

function walk(node: TreeNode, prefix: string, isLast: boolean, lines: string[]) {
  const branch = isLast ? "└── " : "├── ";
  const label = formatNode(node);
  lines.push(prefix + branch + label);
  const kids = node.children ?? [];
  if (node.omitted || kids.length === 0) return;
  const next = prefix + (isLast ? "    " : "│   ");
  kids.forEach((child, i) => {
    walk(child, next, i === kids.length - 1, lines);
  });
}

function formatNode(node: TreeNode): string {
  if (node.omitted) {
    const n = node.omittedCount ?? 0;
    return `${node.name}/  [omitted · ${n} file${n === 1 ? "" : "s"}]`;
  }
  if (node.type === "dir") return `${node.name}/`;
  return node.name;
}

/** Compact tree: sibling files on one line, dirs nested. */
export function renderTreeCompact(root: TreeNode): string {
  const lines: string[] = [`${root.name}/`];
  compactWalk(root, "", lines);
  return lines.join("\n");
}

function compactWalk(node: TreeNode, indent: string, lines: string[]) {
  const kids = node.children ?? [];
  const dirs = kids.filter((k) => k.type === "dir");
  const files = kids.filter((k) => k.type === "file");

  if (files.length) {
    const names = files.map((f) => f.name);
    const grouped = groupByExt(names);
    lines.push(`${indent}${grouped}`);
  }
  for (const dir of dirs) {
    if (dir.omitted) {
      lines.push(
        `${indent}${dir.name}/ [omitted ${dir.omittedCount ?? 0}]`,
      );
      continue;
    }
    const dirKids = dir.children ?? [];
    const onlyFiles =
      dirKids.length > 0 && dirKids.every((c) => c.type === "file");
    if (onlyFiles && dirKids.length <= 6) {
      lines.push(
        `${indent}${dir.name}/ ${dirKids.map((c) => c.name).join(" ")}`,
      );
    } else {
      lines.push(`${indent}${dir.name}/`);
      compactWalk(dir, indent + "  ", lines);
    }
  }
}

function groupByExt(names: string[]): string {
  if (names.length <= 8) return names.join(" ");
  const byExt = new Map<string, string[]>();
  for (const n of names) {
    const i = n.lastIndexOf(".");
    const ext = i > 0 ? n.slice(i) : "";
    const arr = byExt.get(ext) ?? [];
    arr.push(n);
    byExt.set(ext, arr);
  }
  const parts: string[] = [];
  for (const [ext, list] of byExt) {
    if (list.length >= 4 && ext) {
      const stems = list.map((n) => n.slice(0, n.length - ext.length));
      parts.push(`{${stems.join(",")}}${ext}`);
    } else {
      parts.push(...list);
    }
  }
  return parts.join(" ");
}
