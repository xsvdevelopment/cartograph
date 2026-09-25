type TauriGlobal = {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
};

/** The Tauri bridge, present only when Cartograph runs as the desktop app. */
export function desktopBridge(): TauriGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}
