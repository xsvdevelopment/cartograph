import {
  basename,
  buildIgnoreSet,
  collectGitignorePatterns,
  isIgnoredPath,
  isLockfile,
  isSecretPath,
  normalizeRel,
  omittedDirKey,
  parseIgnoreLines,
  stripRootPrefix,
  type IgnoreSet,
} from "./ignore.ts";
import { isProbablyText, languageOf } from "./languages.ts";
import { isManifestPath, parseManifests, workspaceLinks } from "./deps.ts";
import { countLines, extractSymbols } from "./symbols.ts";
import { buildTree } from "./tree.ts";
import {
  estimateTokens,
  estimateTokensFromBytes,
  finalizeMarkdown,
  renderMarkdown,
  savingsPercent,
} from "./markdown.ts";
import { mapFileName, renderAgentBrief } from "./agent.ts";
import type {
  ListedFile,
  ProgressFn,
  ScanOptions,
  ScanResult,
  VirtualFile,
} from "./types.ts";
import { DEFAULT_SCAN_OPTIONS } from "./types.ts";

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

export function filesFromRecord(
  rootName: string,
  record: Record<string, string>,
): VirtualFile[] {
  return Object.entries(record).map(([path, content]) => ({
    path: path.startsWith(rootName + "/")
      ? path.slice(rootName.length + 1)
      : path,
    size: new TextEncoder().encode(content).length,
    content,
  }));
}

export function filesFromFileList(
  list: ArrayLike<File>,
): { rootName: string; files: VirtualFile[] } {
  const files: VirtualFile[] = [];
  let rootName = "project";
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    const { root, rest } = stripRootPrefix(rel);
    // Loose files have no folder, so they must not name the project.
    if (i === 0 && root && rest) rootName = root;
    const path = rest && root === rootName ? rest : normalizeRel(rel);
    if (!path) continue;
    files.push({ path, size: file.size, blob: file });
  }
  return { rootName, files };
}

export async function filesFromZip(
  blob: Blob,
  onProgress?: ProgressFn,
): Promise<{ rootName: string; files: VirtualFile[] }> {
  onProgress?.({ phase: "Opening archive", done: 0, total: 1 });
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(blob);
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  const files: VirtualFile[] = [];
  let rootName = "project";
  const { root } = stripRootPrefix(entries[0]?.name ?? "");
  if (root && entries.every((e) => normalizeRel(e.name).startsWith(root + "/"))) {
    rootName = root;
  }
  const prefix = rootName === "project" ? "" : rootName + "/";
  for (const entry of entries) {
    const rel = normalizeRel(entry.name);
    const path = prefix && rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    if (!path) continue;
    // Entries are only inflated if the scan decides to read them, so a zip
    // that still holds node_modules costs almost nothing.
    files.push({
      path,
      size:
        (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
      load: () => entry.async("blob"),
    });
  }
  return { rootName, files };
}

export async function scanProject(
  rootName: string,
  input: VirtualFile[],
  options: ScanOptions = DEFAULT_SCAN_OPTIONS,
  onProgress?: ProgressFn,
): Promise<ScanResult> {
  const generatedAt = new Date().toISOString();

  onProgress?.({ phase: "Applying ignore rules", done: 0, total: input.length });

  // Ignore files inside already-skipped dirs (node_modules, build/...) can't
  // matter, and reading thousands of them from vendored trees is wasted work.
  const baseIgnore = buildIgnoreSet(options.extraIgnores);
  const gitignoreFiles = input.filter((f) => {
    const b = basename(f.path).toLowerCase();
    return (
      (b === ".gitignore" || b === ".cartographignore" || b === ".ignore") &&
      !isIgnoredPath(f.path, baseIgnore)
    );
  });
  await hydrateContents(gitignoreFiles, options.maxFileBytes, onProgress, "Reading ignore files");

  const fromGit = collectGitignorePatterns(gitignoreFiles);
  const ignore = buildIgnoreSet(
    [
      ...options.extraIgnores,
      ...fromGit.root,
      ...flattenUserIgnores(options.extraIgnores),
    ],
    fromGit.scoped,
  );
  const dirIgnore: IgnoreSet = { ...ignore, extra: [] };

  const omitted = new Map<string, { count: number; bytes: number }>();
  const candidates: VirtualFile[] = [];
  let omittedFiles = 0;
  let omittedBytes = 0;
  let totalBytes = 0;

  for (const file of input) {
    totalBytes += file.size;
    // Name a gitignored `.env` (contents stay omitted) so agents know it
    // exists, but not certs buried inside skipped dirs like `.venv/`.
    if (isSecretPath(file.path) && !isIgnoredPath(file.path, dirIgnore)) {
      candidates.push(file);
      continue;
    }
    if (isIgnoredPath(file.path, ignore)) {
      omittedFiles += 1;
      omittedBytes += file.size;
      const key = omittedDirKey(file.path, ignore);
      if (key) {
        const cur = omitted.get(key) ?? { count: 0, bytes: 0 };
        cur.count += 1;
        cur.bytes += file.size;
        omitted.set(key, cur);
      }
      continue;
    }
    candidates.push(file);
  }

  // Secrets are listed by name only, so they are never read at all.
  const alwaysRead = candidates.filter(
    (f) =>
      !isSecretPath(f.path) &&
      (isManifestPath(f.path) || basename(f.path).toLowerCase().startsWith("readme")),
  );

  const needContent =
    options.mode === "map"
      ? alwaysRead
      : candidates.filter((f) => {
          if (isSecretPath(f.path) || isLockfile(f.path)) return false;
          const lang = languageOf(f.path);
          return isProbablyText(f.path, lang) || isManifestPath(f.path);
        });

  // Manifests and READMEs first, so the read cap never costs the dependency tree.
  const toRead = [
    ...alwaysRead,
    ...needContent.filter((f) => !alwaysRead.includes(f)),
  ]
    .filter((f) => f.content == null && (f.blob || f.load))
    .slice(0, options.maxReadFiles);

  await hydrateContents(toRead, options.maxFileBytes, onProgress, "Reading files");

  onProgress?.({ phase: "Indexing", done: 0, total: candidates.length });

  const listed: ListedFile[] = [];
  let binaryFiles = 0;
  let secretFiles = 0;
  let listedBytes = 0;
  let totalLines = 0;
  const langMap = new Map<
    string,
    { files: number; bytes: number; lines: number }
  >();

  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    const language = languageOf(file.path);
    const secret = isSecretPath(file.path);
    const lock = isLockfile(file.path);
    const textish = isProbablyText(file.path, language);

    let kind: ListedFile["kind"] = "text";
    let skipReason: string | undefined;
    let content: string | undefined;
    let truncated = false;

    if (secret) {
      kind = "secret";
      secretFiles += 1;
      skipReason = "secret, contents omitted";
    } else if (lock) {
      kind = "lock";
      skipReason = "lockfile, summarized";
    } else if (!textish) {
      kind = "binary";
      binaryFiles += 1;
      skipReason = "binary";
    } else if (file.content != null) {
      content = file.content;
      if (content.length > options.maxFileBytes) {
        content = content.slice(0, options.maxFileBytes);
        truncated = true;
      }
      if (looksBinary(content)) {
        kind = "binary";
        binaryFiles += 1;
        content = undefined;
        skipReason = "binary";
      }
    } else if (file.size > options.maxFileBytes) {
      skipReason = "over size cap";
    }

    const lines = content != null ? countLines(content) : undefined;
    if (lines) totalLines += lines;

    let symbols: string[] | undefined;
    if (
      content &&
      kind === "text" &&
      (options.mode === "skeleton" || options.mode === "contents")
    ) {
      symbols = extractSymbols(file.path, content);
    }

    listedBytes += file.size;
    const bucket = langMap.get(language) ?? { files: 0, bytes: 0, lines: 0 };
    bucket.files += 1;
    bucket.bytes += file.size;
    bucket.lines += lines ?? 0;
    langMap.set(language, bucket);

    const includeBody =
      options.mode === "contents" && kind === "text" && content && !lock && !secret;

    listed.push({
      path: file.path,
      size: file.size,
      language,
      kind,
      lines,
      symbols: symbols?.length ? symbols : undefined,
      content: includeBody ? content : undefined,
      truncated: includeBody ? truncated : undefined,
      skipReason,
    });

    if (i % 80 === 0) {
      onProgress?.({ phase: "Indexing", done: i, total: candidates.length });
      await yieldThread();
    }
  }

  listed.sort((a, b) => a.path.localeCompare(b.path));

  const manifestSources = listed
    .filter((f) => isManifestPath(f.path))
    .map((f) => ({
      path: f.path,
      content: candidates.find((c) => c.path === f.path)?.content,
    }));

  const manifests = parseManifests(manifestSources);
  const links = workspaceLinks(manifests);

  const omittedDirs = [...omitted.entries()]
    .map(([path, v]) => ({ path, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const languages = [...langMap.entries()]
    .map(([language, v]) => ({ language, ...v }))
    .sort((a, b) => b.bytes - a.bytes);

  const tree = buildTree(listed, omittedDirs, rootName);

  // "Raw" is what pasting every listed source file would cost, not the
  // node_modules nobody would paste anyway, so the savings figure is honest.
  const rawTokens = estimateTokensFromBytes(
    listed.reduce((n, f) => (f.kind === "text" ? n + f.size : n), 0),
  );
  const partialStats = {
    listedFiles: listed.length,
    omittedFiles,
    binaryFiles,
    secretFiles,
    listedBytes,
    omittedBytes,
    totalBytes,
    totalLines,
    languages: languages.length,
    manifests: manifests.length,
    rawTokens,
  };

  let markdown = renderMarkdown({
    rootName,
    generatedAt,
    options,
    files: listed,
    tree,
    languages,
    manifests,
    workspaceLinks: links,
    omittedDirs,
    stats: partialStats,
  });
  const mapTokens = estimateTokens(markdown);
  markdown = finalizeMarkdown(markdown, mapTokens, rawTokens, options.dialect);

  return {
    rootName,
    generatedAt,
    options,
    files: listed,
    tree,
    languages,
    manifests,
    workspaceLinks: links,
    omittedDirs,
    stats: {
      ...partialStats,
      mapTokens,
      savingsPct: savingsPercent(mapTokens, rawTokens),
    },
    markdown,
    agentBrief: renderAgentBrief(rootName),
    mapFileName: mapFileName(rootName),
  };
}

async function hydrateContents(
  files: VirtualFile[],
  maxFileBytes: number,
  onProgress: ProgressFn | undefined,
  phase: string,
) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({ phase, done: i, total: files.length });
    if (file.content != null) continue;
    if (file.size > maxFileBytes * 4) continue;
    try {
      const blob = file.blob ?? (await file.load?.());
      if (!blob) continue;
      const buf = await blob.slice(0, maxFileBytes + 1).arrayBuffer();
      if (hasNul(new Uint8Array(buf))) continue;
      file.content = TEXT_DECODER.decode(buf);
      if (file.size === 0) file.size = buf.byteLength;
    } catch {
      // leave unread
    }
    if (i % 20 === 0) await yieldThread();
  }
}

function hasNul(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function looksBinary(text: string): boolean {
  const n = Math.min(text.length, 4000);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl / n > 0.1;
}

function flattenUserIgnores(extra: string[]): string[] {
  const out: string[] = [];
  for (const item of extra) {
    if (item.includes("\n")) out.push(...parseIgnoreLines(item));
  }
  return out;
}

function yieldThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export type { IgnoreSet };
