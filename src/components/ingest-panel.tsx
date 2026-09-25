import { useId, useRef, useState } from "react";
import { FolderOpen, FileArchive, Landmark, Shield } from "lucide-react";
import { droppedEntries } from "@/lib/scan";
import { Button } from "@/components/ui/button";
import { useCartograph } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ScanDialect, ScanMode } from "@/lib/scan";

export function IngestPanel() {
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderId = useId();
  const zipId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [ignoreDraft, setIgnoreDraft] = useState("");
  const { status, options, setOptions, loadDemo, loadFileList, loadEntries, loadZip, progress } =
    useCartograph();
  const busy = status === "scanning";

  function applyIgnores() {
    const extraIgnores = ignoreDraft
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    setOptions({ extraIgnores });
  }

  return (
    <aside className="flex min-w-0 flex-col gap-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const files = [...e.dataTransfer.files];
          const entries = droppedEntries(e.dataTransfer);
          if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
            void loadZip(files[0]);
          } else if (entries.length) {
            void loadEntries(entries);
          } else if (files.length) {
            void loadFileList(files, `${files.length} files`);
          }
        }}
        className={cn(
          "rounded-xl bg-card p-5 shadow-[var(--shadow-border)] transition-[box-shadow,background-color] duration-150 ease-out",
          dragOver && "bg-accent shadow-[var(--shadow-border-hover)]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Source
            </p>
            <h2 className="mt-2 font-display text-2xl leading-tight tracking-[-0.03em]">
              Your files stay put.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Drop a project folder or a zip here. Cartograph only reads it. The
              map is a new file you save wherever you like.
            </p>
          </div>
          <Shield className="mt-1 size-5 shrink-0 text-safe" aria-hidden />
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => folderInput.current?.click()}
          >
            <FolderOpen />
            Choose folder
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => zipInput.current?.click()}
          >
            <FileArchive />
            Choose zip
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-2 w-full"
          disabled={busy}
          onClick={() => void loadDemo()}
        >
          <Landmark />
          Try the sample project
        </Button>

        <input
          id={folderId}
          type="file"
          className="sr-only"
          multiple
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) void loadFileList(list);
            e.target.value = "";
          }}
          ref={(el) => {
            folderInput.current = el;
            if (el) {
              el.setAttribute("webkitdirectory", "true");
              el.setAttribute("directory", "true");
            }
          }}
        />
        <input
          id={zipId}
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadZip(file);
            e.target.value = "";
          }}
        />

        {busy && progress ? (
          <p className="mt-4 text-xs tabular text-muted-foreground">
            {progress.phase}
            {progress.total > 1 ? ` · ${progress.done}/${progress.total}` : null}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Depth
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Map lists files and dependencies. Skeleton adds the functions,
          classes and exports in each file. Contents adds the source itself,
          minus secrets and lockfiles.
        </p>
        <Segmented<ScanMode>
          className="mt-4"
          value={options.mode}
          onChange={(mode) => setOptions({ mode })}
          options={[
            { value: "map", label: "Map" },
            { value: "skeleton", label: "Skeleton" },
            { value: "contents", label: "Contents" },
          ]}
        />

        <p className="mt-5 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Format
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Compact drops the markdown formatting to save tokens.
        </p>
        <Segmented<ScanDialect>
          className="mt-3"
          value={options.dialect}
          onChange={(dialect) => setOptions({ dialect })}
          options={[
            { value: "markdown", label: "Markdown" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </div>

      <div className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
        <label htmlFor="ignores" className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Also skip
        </label>
        <p className="mt-2 text-sm text-muted-foreground">
          One per line, gitignore style. node_modules, .git, build output and
          the project's own .gitignore are already handled. Anything listed here
          just stays out of the map.
        </p>
        <textarea
          id="ignores"
          value={ignoreDraft}
          onChange={(e) => setIgnoreDraft(e.target.value)}
          onBlur={applyIgnores}
          spellCheck={false}
          rows={4}
          placeholder={"storybook-static\n*.snap"}
          className="mt-3 w-full resize-y rounded-md bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        />
      </div>
    </aside>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-lg bg-muted p-1",
        options.length === 2 ? "grid-cols-2" : "grid-cols-3",
        className,
      )}
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-9 rounded-md text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out",
              active
                ? "bg-card text-foreground shadow-[var(--shadow-border)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
