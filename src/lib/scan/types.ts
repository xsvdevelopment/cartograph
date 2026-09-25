export type ScanMode = "map" | "skeleton" | "contents";
export type ScanDialect = "markdown" | "compact";

export type FileKind = "text" | "binary" | "secret" | "lock" | "skipped";

export type ScanOptions = {
  mode: ScanMode;
  dialect: ScanDialect;
  extraIgnores: string[];
  maxFileBytes: number;
  maxReadFiles: number;
};

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  mode: "skeleton",
  dialect: "markdown",
  extraIgnores: [],
  maxFileBytes: 256 * 1024,
  maxReadFiles: 500,
};

export type VirtualFile = {
  /** POSIX path relative to the project root (no leading slash). */
  path: string;
  size: number;
  /** In-memory text, if already loaded (demo projects). */
  content?: string;
  /** Browser File to read on demand. */
  blob?: Blob;
  /** Produces the bytes only when the scan needs them (zip entries). */
  load?: () => Promise<Blob>;
};

export type ProgressFn = (progress: {
  phase: string;
  done: number;
  total: number;
}) => void;

export type ListedFile = {
  path: string;
  size: number;
  language: string;
  kind: FileKind;
  lines?: number;
  symbols?: string[];
  content?: string;
  truncated?: boolean;
  skipReason?: string;
};

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  language?: string;
  size?: number;
  omitted?: boolean;
  omittedCount?: number;
  children?: TreeNode[];
};

export type DepKind = "prod" | "dev" | "peer" | "optional";

export type DepNode = {
  name: string;
  version: string;
  kind: DepKind;
};

export type Ecosystem =
  | "npm"
  | "python"
  | "cargo"
  | "go"
  | "ruby"
  | "php"
  | "dart"
  | "swift"
  | "dotnet"
  | "maven"
  | "gradle"
  | "elixir"
  | "rust-workspace";

export type DepManifest = {
  path: string;
  ecosystem: Ecosystem;
  name?: string;
  version?: string;
  workspaces?: string[];
  dependencies: DepNode[];
};

export type LanguageStat = {
  language: string;
  files: number;
  bytes: number;
  lines: number;
};

export type WorkspaceLink = {
  from: string;
  to: string;
};

export type ScanResult = {
  rootName: string;
  generatedAt: string;
  options: ScanOptions;
  files: ListedFile[];
  tree: TreeNode;
  languages: LanguageStat[];
  manifests: DepManifest[];
  workspaceLinks: WorkspaceLink[];
  omittedDirs: { path: string; count: number }[];
  stats: {
    listedFiles: number;
    omittedFiles: number;
    binaryFiles: number;
    secretFiles: number;
    listedBytes: number;
    omittedBytes: number;
    totalBytes: number;
    totalLines: number;
    languages: number;
    manifests: number;
    mapTokens: number;
    rawTokens: number;
    savingsPct: number;
  };
  markdown: string;
  agentBrief: string;
  mapFileName: string;
};

export type ScanError = {
  message: string;
};
