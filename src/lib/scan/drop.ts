import { IGNORED_DIR_NAMES } from "./ignore.ts";
import type { VirtualFile } from "./types.ts";

/**
 * Grab the dropped entries. This has to run synchronously inside the drop
 * handler: the browser empties `dataTransfer` as soon as the handler returns.
 */
export function droppedEntries(dt: DataTransfer): FileSystemEntry[] {
  const out: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Walk dropped folders and files. `dataTransfer.files` lists a dropped folder
 * as one empty file, so folders have to be read through the entries API.
 * One dropped folder becomes the project root; anything else is listed as is.
 */
export async function filesFromEntries(
  entries: FileSystemEntry[],
): Promise<{ rootName: string; files: VirtualFile[] }> {
  const files: VirtualFile[] = [];
  const single = entries.length === 1 && entries[0].isDirectory ? entries[0] : null;

  if (single) {
    await walk(single as FileSystemDirectoryEntry, "", files, false);
    return { rootName: single.name, files };
  }
  for (const entry of entries) {
    if (entry.isDirectory) {
      await walk(entry as FileSystemDirectoryEntry, entry.name + "/", files, false);
    } else {
      const file = await fileOf(entry as FileSystemFileEntry);
      files.push({ path: entry.name, size: file.size, blob: file });
    }
  }
  return { rootName: "project", files };
}

async function walk(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: VirtualFile[],
  skipped: boolean,
): Promise<void> {
  for (const entry of await readAll(dir)) {
    const path = prefix + entry.name;
    if (entry.isDirectory) {
      // Folders like node_modules are still walked so the map can say how
      // many files it left out, but their files are never opened.
      await walk(
        entry as FileSystemDirectoryEntry,
        path + "/",
        out,
        skipped || IGNORED_DIR_NAMES.has(entry.name),
      );
    } else if (skipped) {
      out.push({ path, size: 0 });
    } else {
      const file = await fileOf(entry as FileSystemFileEntry);
      out.push({ path, size: file.size, blob: file });
    }
  }
}

/** `readEntries` hands back at most 100 entries per call. */
async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) return all;
    all.push(...batch);
  }
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
