import { create } from "zustand";
import {
  DEFAULT_SCAN_OPTIONS,
  filesFromEntries,
  filesFromFileList,
  filesFromRecord,
  filesFromZip,
  scanProject,
  type ScanOptions,
  type ScanResult,
  type VirtualFile,
} from "@/lib/scan";

type Status = "idle" | "scanning" | "ready" | "error";

type Stash = {
  rootName: string;
  files: VirtualFile[];
  label: string;
};

type Progress = { phase: string; done: number; total: number };

type AppState = {
  status: Status;
  progress: Progress | null;
  result: ScanResult | null;
  error: string | null;
  options: ScanOptions;
  sourceLabel: string;
  stash: Stash | null;
  setOptions: (patch: Partial<ScanOptions>) => void;
  scanStash: () => Promise<void>;
  loadDemo: () => Promise<void>;
  loadFileList: (list: ArrayLike<File>, label?: string) => Promise<void>;
  loadEntries: (entries: FileSystemEntry[]) => Promise<void>;
  loadZip: (file: File) => Promise<void>;
};

/** Bumped per scan, so a slow scan that finishes late can't overwrite a newer one. */
let latestRun = 0;

export const useCartograph = create<AppState>((set, get) => ({
  status: "idle",
  progress: null,
  result: null,
  error: null,
  options: { ...DEFAULT_SCAN_OPTIONS },
  sourceLabel: "",
  stash: null,

  setOptions: (patch) => {
    set((s) => ({ options: { ...s.options, ...patch } }));
    if (get().stash) void get().scanStash();
  },

  scanStash: async () => {
    const { stash, options } = get();
    if (!stash) return;
    const run = ++latestRun;
    set({ status: "scanning", error: null, progress: null });
    try {
      const result = await scanProject(stash.rootName, stash.files, options, (progress) => {
        if (run === latestRun) set({ progress });
      });
      if (run !== latestRun) return;
      set({
        status: "ready",
        result,
        progress: null,
        sourceLabel: stash.label,
      });
    } catch (err) {
      if (run !== latestRun) return;
      set({
        status: "error",
        progress: null,
        error: err instanceof Error ? err.message : "The scan failed.",
      });
    }
  },

  loadDemo: async () => {
    // Loaded on demand so the sample's text stays out of the main bundle.
    const { SELF_FILES, SELF_ROOT } = await import("@/lib/sample/self");
    set({
      stash: {
        rootName: SELF_ROOT,
        files: filesFromRecord(SELF_ROOT, SELF_FILES),
        label: "Sample: Cartograph's own source, built in",
      },
    });
    await get().scanStash();
  },

  loadFileList: async (list, label) => {
    const { rootName, files } = filesFromFileList(list);
    if (!files.length) {
      set({ status: "error", error: "No files found in that selection." });
      return;
    }
    set({
      stash: {
        rootName,
        files,
        label: label ?? `${rootName} · ${files.length} files`,
      },
    });
    await get().scanStash();
  },

  loadEntries: async (entries) => {
    set({
      status: "scanning",
      error: null,
      progress: { phase: "Reading folder", done: 0, total: 0 },
    });
    try {
      const { rootName, files } = await filesFromEntries(entries);
      if (!files.length) {
        set({ status: "error", progress: null, error: "That folder is empty." });
        return;
      }
      set({ stash: { rootName, files, label: `${rootName} · ${files.length} files` } });
      await get().scanStash();
    } catch (err) {
      set({
        status: "error",
        progress: null,
        error: err instanceof Error ? err.message : "Could not read that folder.",
      });
    }
  },

  loadZip: async (file) => {
    set({ status: "scanning", error: null, progress: null });
    try {
      const { rootName, files } = await filesFromZip(file, (progress) => set({ progress }));
      if (!files.length) {
        set({ status: "error", progress: null, error: "That archive was empty." });
        return;
      }
      set({
        stash: {
          rootName,
          files,
          label: `${file.name} · ${files.length} files`,
        },
      });
      await get().scanStash();
    } catch (err) {
      set({
        status: "error",
        progress: null,
        error: err instanceof Error ? err.message : "Could not read that zip.",
      });
    }
  },
}));
