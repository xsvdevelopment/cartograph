/**
 * The built-in sample is Cartograph's own source, bundled at build time, so
 * the first map anyone sees is a real project with real numbers.
 */
const modules = import.meta.glob(
  [
    "/src/**/*.{ts,tsx,css}",
    "/src-tauri/src/*.rs",
    "/src-tauri/{Cargo.toml,build.rs,tauri.conf.json}",
    "/src-tauri/capabilities/*.json",
    "/{package.json,README.md,index.html,vite.config.ts,tsconfig.json,eslint.config.mjs}",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

export const SELF_ROOT = "cartograph";

export const SELF_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, text]) => [path.replace(/^\//, ""), text]),
);
