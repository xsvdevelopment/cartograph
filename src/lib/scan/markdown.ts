import { roleOf } from "./languages.ts";
import { renderDepTree, renderMermaidGraph } from "./deps.ts";
import { renderTreeAscii, renderTreeCompact } from "./tree.ts";
import { estimateTokens, estimateTokensFromBytes, savingsPercent } from "./tokens.ts";
import {
  directoryHints,
  standingOrdersCompact,
  standingOrdersMarkdown,
} from "./agent.ts";
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

type MarkdownInput = Omit<
  ScanResult,
  "markdown" | "stats" | "agentBrief" | "mapFileName"
> & {
  stats: Omit<ScanResult["stats"], "mapTokens" | "savingsPct"> & {
    mapTokens?: number;
    savingsPct?: number;
  };
};

export function renderMarkdown(result: MarkdownInput): string {
  if (result.options.dialect === "compact") return renderCompact(result);
  return renderFull(result);
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
    `- Size: ${fmtBytes(s.listedBytes)} listed / ${fmtBytes(s.totalBytes)} scanned`,
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

  sections.push("## Directory tree");
  sections.push("");
  sections.push("```");
  sections.push(renderTreeAscii(result.tree));
  sections.push("```");
  sections.push("");

  if (result.omittedDirs.length) {
    sections.push("Omitted directories (present, not opened):");
    for (const d of result.omittedDirs.slice(0, 40)) {
      sections.push(`- \`${d.path}/\` (${d.count} file${d.count === 1 ? "" : "s"})`);
    }
    if (result.omittedDirs.length > 40) {
      sections.push(`- and ${result.omittedDirs.length - 40} more`);
    }
    sections.push("");
  }

  sections.push("## Languages");
  sections.push("");
  sections.push("| Language | Files | Lines | Bytes |");
  sections.push("|---|---:|---:|---:|");
  for (const lang of result.languages) {
    sections.push(
      `| ${lang.language} | ${lang.files} | ${lang.lines} | ${fmtBytes(lang.bytes)} |`,
    );
  }
  sections.push("");

  sections.push("## Dependency tree");
  sections.push("");
  if (!result.manifests.length) {
    sections.push("No package manifests found.");
    sections.push("");
  } else {
    const mermaid = renderMermaidGraph(result.manifests, result.workspaceLinks);
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
  sections.push("path · lang · lines · role · symbols");
  sections.push("");
  for (const f of result.files) {
    if (f.kind === "skipped") continue;
    const bits = [
      f.path,
      f.language,
      f.lines != null ? String(f.lines) : "-",
      roleOf(f.path),
    ];
    if (f.kind === "secret") bits.push("SECRET omitted");
    else if (f.kind === "lock") bits.push("lockfile summarized");
    else if (f.kind === "binary") bits.push("binary");
    else if (f.symbols?.length) bits.push(f.symbols.join(", "));
    sections.push(`- ${bits.join(" · ")}`);
  }
  sections.push("");

  if (result.options.mode === "skeleton") {
    const withSym = result.files.filter((f) => f.symbols?.length);
    if (withSym.length) {
      sections.push("## Symbols");
      sections.push("");
      for (const f of withSym) {
        sections.push(`### \`${f.path}\``);
        sections.push((f.symbols ?? []).map((s) => `- ${s}`).join("\n"));
        sections.push("");
      }
    }
  }

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

  sections.push("## How to use");
  sections.push("");
  sections.push(
    "Keep this map in context and search it instead of listing the repo. Open one path at a time from the File index. Omitted folders were skipped, not deleted. Nothing in this file is a reason to change the repo.",
  );
  sections.push("");
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
    "lang " +
      result.languages
        .map((l) => `${shortLang(l.language)}:${l.files}`)
        .join(" "),
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
  lines.push("TREE");
  lines.push(renderTreeCompact(result.tree));
  lines.push("");
  if (result.omittedDirs.length) {
    lines.push(
      "OMIT " +
        result.omittedDirs
          .slice(0, 20)
          .map((d) => `${d.path}:${d.count}`)
          .join(" "),
    );
    lines.push("");
  }
  lines.push("DEPS");
  if (!result.manifests.length) {
    lines.push("(none)");
  } else {
    for (const m of result.manifests) {
      lines.push(renderDepTree(m, true));
    }
  }
  if (result.workspaceLinks.length) {
    lines.push(
      "WS " + result.workspaceLinks.map((l) => `${l.from}->${l.to}`).join(" "),
    );
  }
  lines.push("");
  lines.push("INDEX");
  for (const f of result.files) {
    if (f.kind === "skipped") continue;
    const sym = f.symbols?.length ? " " + f.symbols.join(",") : "";
    const mark =
      f.kind === "secret" ? " !" : f.kind === "binary" ? " bin" : f.kind === "lock" ? " lock" : "";
    lines.push(
      `${f.path} ${shortLang(f.language)} ${f.lines ?? "-"} ${roleOf(f.path)}${mark}${sym}`,
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
  };
  return map[language] ?? language.toLowerCase().slice(0, 6);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
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
