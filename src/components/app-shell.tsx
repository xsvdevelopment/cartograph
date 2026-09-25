import { useEffect } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IngestPanel } from "@/components/ingest-panel";
import { ResultPanel } from "@/components/result-panel";
import { useCartograph } from "@/lib/store";

export function AppShell() {
  const loadDemo = useCartograph((s) => s.loadDemo);
  const status = useCartograph((s) => s.status);

  // Open on the sample project so there is a map to look at straight away.
  useEffect(() => {
    if (status === "idle") void loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-7">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                Codebase maps for coding agents
              </p>
              <h1 className="mt-1 font-display text-4xl leading-none tracking-[-0.03em] sm:text-5xl">
                Cartograph
              </h1>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Scan a project and get one markdown file with its folders,
              dependencies and code symbols. Point your agent at it and it reads
              the map instead of listing every folder on every task.
            </p>
          </div>
        </header>

        <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:py-8">
          <IngestPanel />
          <ResultPanel />
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted-foreground sm:px-6">
          Everything runs on this machine. Cartograph never uploads your code,
          never runs it and never edits it. The only files it writes are the map
          you save and, when you ask, one rule added to the end of a CLAUDE.md.
        </footer>
      </div>
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          className:
            "!bg-card !text-foreground !shadow-[var(--shadow-border)] !border-0",
        }}
      />
    </TooltipProvider>
  );
}
