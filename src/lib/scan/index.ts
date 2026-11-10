export { scanProject, filesFromFileList, filesFromZip, filesFromRecord } from "./ingest.ts";
export { droppedEntries, filesFromEntries } from "./drop.ts";
export { DEFAULT_SCAN_OPTIONS } from "./types.ts";
export type {
  ScanMode,
  ScanDialect,
  ScanOptions,
  ScanResult,
  VirtualFile,
  TreeNode,
  DepManifest,
  LanguageStat,
} from "./types.ts";
export { estimateTokens, savingsPercent } from "./tokens.ts";
export { isManifestPath } from "./deps.ts";
export { mapFileName, renderAgentBrief } from "./agent.ts";
