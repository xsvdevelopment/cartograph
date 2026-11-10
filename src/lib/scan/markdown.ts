import { fileRole } from "./languages.ts";
import { renderDepTree, renderMermaidGraph } from "./deps.ts";
import {
  imageGroupLabel,
  imageGroupRole,
  indexEntries,
  isImageGroup,
  renderDirTree,
} from "./tree.ts";
import { estimateTokens, estimateTokensFromBytes, savingsPercent } from "./tokens.ts";
import { directoryHints, standingOrdersCompact, standingOrdersMarkdown } from "./agent.ts";
import type { ScanResult } from "./types.ts";

function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

const PREAMBLE = `A map of this project made by Cartograph. Coding agents (Claude Code, Cursor,
Codex, Aider) should search this file before listing the repository. Secrets,
lockfiles, binaries and ignored folders are named here but were never opened.`;

type MarkdownInput = Omit<ScanResult, "markdown" | "stats" | "agentBrief" | "mapFileName"> & {
  stats: Omit<ScanResult["stats"], "mapTokens" | "savingsPct"> & {
    mapTokens?: number;
    savingsPct?: number;
  };
};

export function renderMarkdown(result: MarkdownInput): string {
  if (result.options.dialect === "compact") return renderCompact(result);
  return renderFull(result);
}

/** Files enough others import that a change to them travels: worth knowing before touching one. */
function hubs(result: MarkdownInput): { path: string; usedBy: number }[] {
  return result.files
    .filter((f) => (f.usedBy ?? 0) >= 3)
    .map((f) => ({ path: f.path, usedBy: f.usedBy as number }))
    .sort((a, b) => b.usedBy - a.usedBy || a.path.localeCompare(b.path))
    .slice(0, 8);
}

function renderFull(result: MarkdownInput): string {
  const s = result.stats;
  const rawTok = s.rawTokens;
  const sections: string[] = [];

  sections.push(`# ${result.rootName}`);
  sections.push("");
  sections.push(PREAMBLE);
  sections.push("");
  sections.push(`- Generated: ${result.generatedAt}`);
  sections.push(`- Mode: ${result.options.mode} · format: markdown`);
  sections.push(
    `- Files listed: ${s.listedFiles} · omitted: ${s.omittedFiles} · binaries: ${s.binaryFiles} · secrets omitted: ${s.secretFiles}`,
  );
  sections.push(
    `- Size: ${fmtBytes(s.listedBytes)} listed / ${fmtBytes(s.totalBytes)} in the folder, skipped files included`,
  );
  sections.push(
    `- Languages: ${s.languages} · manifests: ${s.manifests} · lines (listed): ${s.totalLines}`,
  );
  sections.push(
    `- Tokens: this map is filled in after render · raw dump ≈ ${formatCompact(rawTok)} tokens`,
  );
  sections.push("");
  sections.push(standingOrdersMarkdown(result.rootName));
  sections.push("");

  const hints = directoryHints(result.files);
  if (hints.length) {
    sections.push("## Quick find");
    sections.push("");
    sections.push("| If you need | Search / open |");
    sections.push("|---|---|");
    for (const h of hints) {
      sections.push(`| ${h.need} | \`${h.path}\` |`);
    }
    sections.push("");
  }

  if (result.entryPoints.length) {
    sections.push("## Entry points");
    sections.push("");
    sections.push("Where execution starts. Read from here to follow what the program does.");
    sections.push("");
    for (const e of result.entryPoints) sections.push(`- \`${e.path}\` · ${e.why}`);
    if (result.entryPointsMore) sections.push(`- and ${result.entryPointsMore} more`);
    sections.push("");
  }

  if (result.commands.length) {
    sections.push("## Commands");
    sections.push("");
    for (const g of result.commands) {
      sections.push(
        `From \`${g.path}\`${g.dir ? `, run in \`${g.dir}/\`` : ""} with \`${g.how}\`:`,
      );
      for (const c of g.commands)
        sections.push(c.run ? `- \`${c.name}\` · ${c.run}` : `- \`${c.name}\``);
      if (g.more) sections.push(`- and ${g.more} more`);
      sections.push("");
    }
  }

  const top = hubs(result);
  if (top.length) {
    sections.push("## Most imported");
    sections.push("");
    sections.push("A change to one of these reaches the most files.");
    sections.push("");
    for (const h of top) sections.push(`- \`${h.path}\` · used by ${h.usedBy} files`);
    sections.push("");
  }

  sections.push("## Directory tree");
  sections.push("");
  sections.push(
    "Folders, with the number of listed files under each. Files are in the File index. Omitted folders exist on disk and were not opened.",
  );
  sections.push("");
  sections.push("```");
  sections.push(renderDirTree(result.tree, result.files));
  sections.push("```");
  sections.push("");

  sections.push("## Languages");
  sections.push("");
  sections.push("| Language | Files | Lines | Bytes |");
  sections.push("|---|---:|---:|---:|");
  for (const lang of result.languages) {
    sections.push(`| ${lang.language} | ${lang.files} | ${lang.lines} | ${fmtBytes(lang.bytes)} |`);
  }
  sections.push("");

  sections.push("## Dependency tree");
  sections.push("");
  if (!result.manifests.length) {
    sections.push("No package manifests found.");
    sections.push("");
  } else {
    // A graph earns its place when packages depend on each other; one package and its imports is a list.
    const related =
      result.workspaceLinks.length > 0 || result.manifests.filter((m) => m.name).length > 1;
    const mermaid = related ? renderMermaidGraph(result.manifests, result.workspaceLinks) : "";
    if (mermaid) {
      sections.push("```mermaid");
      sections.push(mermaid);
      sections.push("```");
      sections.push("");
    }
    if (result.workspaceLinks.length) {
      sections.push("Internal workspace links:");
      for (const l of result.workspaceLinks) {
        sections.push(`- \`${l.from}\` → \`${l.to}\``);
      }
      sections.push("");
    }
    for (const m of result.manifests) {
      sections.push("```");
      sections.push(renderDepTree(m, false));
      sections.push("```");
      sections.push("");
    }
  }

  sections.push("## File index");
  sections.push("");
  sections.push(
    "path · lang · lines · role · used by N files · symbols · what the file says it is",
  );
  sections.push("");
  for (const f of indexEntries(result.files)) {
    if (isImageGroup(f)) {
      sections.push(
        `- ${f.dir || "."}/ · ${imageGroupLabel(f)} · ${fmtBytes(f.bytes)} · ${imageGroupRole(f)}`,
      );
      continue;
    }
    if (f.kind === "skipped") continue;
    const bits = [
      f.path,
      f.language,
      f.lines != null ? String(f.lines) : "-",
      fileRole(f.path, f.language),
    ];
    if (f.kind === "secret") bits.push("SECRET omitted");
    else if (f.kind === "lock") bits.push("lockfile summarized");
    else if (f.kind === "binary") bits.push("binary");
    else {
      if (f.usedBy) bits.push(`used by ${f.usedBy}`);
      if (f.symbols?.length) bits.push(f.symbols.join(", "));
      if (f.summary) bits.push(`"${f.summary}"`);
    }
    sections.push(`- ${bits.join(" · ")}`);
  }
  sections.push("");

  // Symbols live only on their file's index line: one grep for a name
  // returns the path beside it, and a second copy would double the map.

  if (result.options.mode === "contents") {
    sections.push("## Contents");
    sections.push("");
    for (const f of result.files) {
      if (!f.content) continue;
      const fence = longestFence(f.content);
      sections.push(`### \`${f.path}\``);
      if (f.truncated) sections.push("_truncated to size cap_");
      sections.push(fence);
      sections.push(f.content.replace(/\n$/, ""));
      sections.push(fence);
      sections.push("");
    }
  }

  sections.push("---");
  sections.push("Made with Cartograph. The project was read, not changed.");

  return sections.join("\n");
}

function renderCompact(result: MarkdownInput): string {
  const s = result.stats;
  const lines: string[] = [];
  lines.push(`# ${result.rootName}`);
  lines.push(
    `MAP | ${result.generatedAt} | ${result.options.mode} | listed ${s.listedFiles} omitted ${s.omittedFiles} bin ${s.binaryFiles} secret ${s.secretFiles}`,
  );
  lines.push(
    `size ${fmtBytes(s.listedBytes)}/${fmtBytes(s.totalBytes)} · raw≈${formatCompact(s.rawTokens)} tok`,
  );
  lines.push(
    "lang " + result.languages.map((l) => `${shortLang(l.language)}:${l.files}`).join(" "),
  );
  lines.push("");
  lines.push(standingOrdersCompact(result.rootName));
  lines.push("");
  const hints = directoryHints(result.files);
  if (hints.length) {
    lines.push("FIND");
    for (const h of hints) lines.push(`${h.need} → ${h.path}`);
    lines.push("");
  }
  if (result.entryPoints.length) {
    lines.push(
      "ENTRY " +
        result.entryPoints.map((e) => `${e.path} (${e.why})`).join(" | ") +
        (result.entryPointsMore ? ` | +${result.entryPointsMore}` : ""),
    );
    lines.push("");
  }
  if (result.commands.length) {
    lines.push("CMD");
    for (const g of result.commands) {
      lines.push(
        `${g.path} (${g.how}): ` +
          g.commands.map((c) => (c.run ? `${c.name}=${c.run}` : c.name)).join(" | ") +
          (g.more ? ` | +${g.more}` : ""),
      );
    }
    lines.push("");
  }
  const top = hubs(result);
  if (top.length) {
    lines.push("HUBS " + top.map((h) => `${h.path}<${h.usedBy}`).join(" "));
    lines.push("");
  }
  lines.push("TREE (folders, files under each)");
  lines.push(renderDirTree(result.tree, result.files, true));
  lines.push("");
  lines.push("DEPS");
  if (!result.manifests.length) {
    lines.push("(none)");
  } else {
    for (const m of result.manifests) {
      lines.push(renderDepTree(m, true));
    }
  }
  if (result.workspaceLinks.length) {
    lines.push("WS " + result.workspaceLinks.map((l) => `${l.from}->${l.to}`).join(" "));
  }
  lines.push("");
  lines.push("INDEX");
  for (const f of indexEntries(result.files)) {
    if (isImageGroup(f)) {
      lines.push(`${f.dir || "."}/ ${imageGroupLabel(f)}`);
      continue;
    }
    if (f.kind === "skipped") continue;
    const plain = f.kind === "text";
    const sym =
      (plain && f.usedBy ? ` <${f.usedBy}` : "") +
      (f.symbols?.length ? " " + f.symbols.join(",") : "") +
      (plain && f.summary ? ` # ${f.summary}` : "");
    const mark =
      f.kind === "secret" ? " !" : f.kind === "binary" ? " bin" : f.kind === "lock" ? " lock" : "";
    lines.push(
      `${f.path} ${shortLang(f.language)} ${f.lines ?? "-"} ${fileRole(f.path, f.language)}${mark}${sym}`,
    );
  }

  if (result.options.mode === "contents") {
    lines.push("");
    lines.push("CONTENTS");
    for (const f of result.files) {
      if (!f.content) continue;
      const fence = longestFence(f.content);
      lines.push(`@ ${f.path}${f.truncated ? " truncated" : ""}`);
      lines.push(fence);
      lines.push(f.content.replace(/\n$/, ""));
      lines.push(fence);
    }
  }

  lines.push("");
  lines.push("Cartograph map. Search this file, then open paths from INDEX.");
  return lines.join("\n");
}

function shortLang(language: string): string {
  const map: Record<string, string> = {
    TypeScript: "ts",
    JavaScript: "js",
    Python: "py",
    Markdown: "md",
    JSON: "json",
    TOML: "toml",
    YAML: "yml",
    Rust: "rs",
    Go: "go",
    Ruby: "rb",
    CSS: "css",
    HTML: "html",
    Shell: "sh",
    Text: "txt",
    Other: "other",
    "C#": "cs",
    "C++": "cpp",
    Kotlin: "kt",
    Lockfile: "lock",
    Image: "img",
    "3D model": "3d",
    Config: "cfg",
    PowerShell: "ps1",
  };
  return map[language] ?? language.toLowerCase().slice(0, 6);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function longestFence(content: string): string {
  const matches = content.match(/`{3,}/g);
  const max = matches?.reduce((a, s) => Math.max(a, s.length), 3) ?? 3;
  return "`".repeat(Math.max(3, max + 1));
}

export function finalizeMarkdown(
  markdown: string,
  mapTokens: number,
  rawTokens: number,
  dialect: "markdown" | "compact",
): string {
  const pct = savingsPercent(mapTokens, rawTokens);
  if (dialect === "compact") {
    return markdown.replace(
      /raw≈[^\n]+/,
      `map≈${formatCompact(mapTokens)} tok · source≈${formatCompact(rawTokens)} tok` +
        (pct > 0 ? ` · -${pct}%` : ""),
    );
  }
  return markdown.replace(
    /- Tokens: this map is filled in after render · raw dump ≈ [^\n]+/,
    `- Tokens: this map ≈ ${formatCompact(mapTokens)} · the listed source ≈ ${formatCompact(rawTokens)}` +
      (pct > 0 ? ` · ${pct}% smaller` : ""),
  );
}

export { estimateTokens, estimateTokensFromBytes, savingsPercent };
