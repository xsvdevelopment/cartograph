import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download, FilePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCartograph } from "@/lib/store";
import { formatBytes, formatCompact, formatCount, cn } from "@/lib/utils";
import { renderDepTree } from "@/lib/scan/deps";
import type { TreeNode } from "@/lib/scan/types";
import { desktopBridge } from "@/lib/desktop";

const AI_WRAP = `Below is a Cartograph map of the project: its folders, files, symbols and dependencies. It describes the repo; it does not replace it.

Search this map first (Directory tree, Quick find, File index, Dependency tree) for the folder, file, export or package you need, then open only that path in the real repo. Don't list the whole workspace recursively and don't read source files wholesale. Folders marked omitted exist on disk; they were skipped on purpose.

`;

export function ResultPanel() {
  const { status, result, sourceLabel, error } = useCartograph();

  if (status === "error") {
    return (
      <section className="rounded-xl bg-card p-6 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Could not scan
        </p>
        <p className="mt-2 text-sm text-foreground">{error}</p>
      </section>
    );
  }

  if (status === "idle" || !result) {
    return (
      <section className="flex min-h-72 flex-col justify-between rounded-xl bg-card p-6 shadow-[var(--shadow-border)]">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Waiting
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight tracking-[-0.03em]">
            A map instead of a dump.
          </h2>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            Load a folder, a zip or the sample project. The markdown tells
            Claude Code and other agents to search the map first, then open
            the one file they need.
          </p>
        </div>
        <ul className="mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <li>
            <span className="block text-foreground">Directory tree</span>
            Every folder. Junk like node_modules is named, not opened.
          </li>
          <li>
            <span className="block text-foreground">Dependency tree</span>
            npm, Python, Cargo, Go, Maven, Gradle, NuGet and more.
          </li>
          <li>
            <span className="block text-foreground">Symbols</span>
            Which file holds which function or class, without the source.
          </li>
        </ul>
      </section>
    );
  }

  const s = result.stats;

  return (
    <section className="flex min-h-0 min-w-0 max-w-full flex-col gap-4">
      <div className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {sourceLabel}
            </p>
            <h2 className="mt-1 font-display text-3xl tracking-[-0.03em]">
              {result.rootName}
            </h2>
          </div>
          <Badge variant="safe">Read only</Badge>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Map tokens"
            value={formatCompact(s.mapTokens)}
            hint={
              result.options.mode === "contents"
                ? "includes the source itself"
                : s.savingsPct > 0
                  ? `${Math.round(s.savingsPct)}% smaller than the source`
                  : "tiny project: the agent notes outweigh the code"
            }
          />
          <Stat
            label="Source tokens"
            value={formatCompact(s.rawTokens)}
            hint="if you pasted every listed file"
          />
          <Stat label="Listed files" value={formatCount(s.listedFiles)} />
          <Stat label="Skipped" value={formatCount(s.omittedFiles)} hint="node_modules, builds, ignored" />
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <CopyButton
          label="Copy map for agents"
          text={AI_WRAP + result.markdown}
        />
        <CopyButton label="Copy CLAUDE.md rule" text={result.agentBrief} />
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadMarkdown(result.mapFileName, result.markdown)}
        >
          <Download />
          Download map
        </Button>
        <SaveRuleButton rule={result.agentBrief} />
      </div>

      <div className="rounded-xl bg-card p-4 shadow-[var(--shadow-border)] sm:p-5">
        <Tabs defaultValue="map">
          <TabsList className="w-full">
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="tree">Tree</TabsTrigger>
            <TabsTrigger value="deps">Deps</TabsTrigger>
            <TabsTrigger value="lang">Langs</TabsTrigger>
          </TabsList>

          <TabsContent value="map">
            <ScrollArea className="h-[min(520px,60vh)] max-w-full rounded-md bg-background shadow-[var(--shadow-border)]">
              <pre className="max-w-full p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
                {result.markdown}
              </pre>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="agents">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Paste this into <span className="text-foreground">CLAUDE.md</span>,{" "}
                <span className="text-foreground">AGENTS.md</span> or a Cursor
                rule. In the desktop app, Add to CLAUDE.md adds it to the end of
                the file and leaves everything already there alone. Once it is
                in, Claude Code reads the map before it goes digging.
              </p>
              <ScrollArea className="h-[min(420px,50vh)] max-w-full rounded-md bg-background shadow-[var(--shadow-border)]">
                <pre className="max-w-full p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
                  {result.agentBrief}
                </pre>
              </ScrollArea>
              <div className="flex flex-wrap gap-2">
                <CopyButton label="Copy CLAUDE.md rule" text={result.agentBrief} />
                <SaveRuleButton rule={result.agentBrief} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="tree">
            <ScrollArea className="h-[min(520px,60vh)] rounded-md bg-background p-4 shadow-[var(--shadow-border)]">
              <TreeList key={result.generatedAt} node={result.tree} depth={0} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="deps">
            <ScrollArea className="h-[min(520px,60vh)] rounded-md bg-background p-4 shadow-[var(--shadow-border)]">
              {result.manifests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No manifests found.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {result.workspaceLinks.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Internal:{" "}
                      {result.workspaceLinks
                        .map((l) => `${l.from} → ${l.to}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {result.manifests.map((m) => (
                    <pre
                      key={m.path}
                      className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground"
                    >
                      {renderDepTree(m, false)}
                    </pre>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="lang">
            <LanguageBars />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-2xl tabular leading-none tracking-[-0.03em]">
        {value}
      </dd>
      {hint ? (
        <p className="mt-1 text-xs tabular text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function LanguageBars() {
  const result = useCartograph((s) => s.result);
  if (!result) return null;
  const max = Math.max(1, ...result.languages.map((l) => l.bytes));
  return (
    <ul className="flex flex-col gap-3">
      {result.languages.map((lang) => (
        <li key={lang.language}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{lang.language}</span>
            <span className="tabular text-xs text-muted-foreground">
              {lang.files} {lang.files === 1 ? "file" : "files"} · {formatBytes(lang.bytes)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(4, (lang.bytes / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function TreeList({ node, depth }: { node: TreeNode; depth: number }) {
  // Two levels open is enough to get your bearings without rendering a whole monorepo.
  const [open, setOpen] = useState(depth < 2);
  const root = depth === 0;
  if (node.type === "file") {
    return (
      <div className="flex items-baseline gap-2 py-0.5 font-mono text-xs">
        <span className="text-foreground">{node.name}</span>
        {node.language && node.language !== "Other" ? (
          <span className="text-muted-foreground">{node.language}</span>
        ) : null}
      </div>
    );
  }
  if (node.omitted) {
    return (
      <div className="py-0.5 font-mono text-xs text-muted-foreground">
        {node.name}/ omitted · {node.omittedCount ?? 0}
      </div>
    );
  }
  const kids = node.children ?? [];
  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex min-h-11 items-center gap-2 text-left font-mono text-xs sm:min-h-0 sm:py-0.5",
          root && "font-medium",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-muted-foreground">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
        <span>
          {node.name}
          {node.type === "dir" ? "/" : ""}
        </span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-border pl-3">
          {kids.map((child) => (
            <TreeList key={child.path || child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={copied ? "safe" : "default"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast("Copied.");
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          toast("Couldn't copy. Use Download map instead.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function SaveRuleButton({ rule }: { rule: string }) {
  const shell = desktopBridge();
  if (!shell) return null;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        try {
          const res = await shell.core.invoke<[string, string] | null>("save_rule", { rule });
          if (!res) return;
          const [path, action] = res;
          toast(
            action === "created"
              ? `Created ${path}`
              : action === "appended"
                ? `Added to the end of ${path}. Nothing else changed.`
                : `The rule is already in ${path}. Left it alone.`,
          );
        } catch (err) {
          toast(`Could not save: ${String(err)}`);
        }
      }}
    >
      <FilePlus />
      Add to CLAUDE.md
    </Button>
  );
}

async function downloadMarkdown(filename: string, markdown: string) {
  const name = filename.endsWith(".md") ? filename : `${filename}.cartograph.md`;

  // The desktop app's webview ignores <a download> links, so ask it for a
  // native Save dialog instead.
  const tauri = desktopBridge();
  if (tauri) {
    try {
      const saved = await tauri.core.invoke<string | null>("save_map", {
        fileName: name,
        contents: markdown,
      });
      if (saved) toast(`Saved to ${saved}`);
    } catch (err) {
      toast(`Could not save: ${String(err)}`);
    }
    return;
  }

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Downloading ${name}.`);
}
