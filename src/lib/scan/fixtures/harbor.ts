/** Test fixture: a small made-up monorepo covering npm, Python, Go and Cargo. */

export const HARBOR_ROOT = "harbor";

export const HARBOR_FILES: Record<string, string> = {
  "README.md": `# Harbor

Internal operations platform: a TypeScript web app, a Python ingest service,
a Go worker, and a small Rust hashing crate.

Nothing in this sample is real infrastructure. It exists so Cartograph can
show a directory tree, a multi-ecosystem dependency graph, and a compact
symbol index without opening a private repo.
`,
  "LICENSE": "MIT License\n\nCopyright (c) 2026 Harbor\n",
  ".gitignore": `node_modules
dist
build
.venv
__pycache__
target
.env
*.pyc
.DS_Store
`,
  "package.json": `{
  "name": "harbor",
  "private": true,
  "version": "0.4.2",
  "workspaces": ["apps/*", "packages/*"],
  "devDependencies": {
    "typescript": "^5.7.0",
    "turbo": "^2.3.0"
  }
}
`,
  "pnpm-workspace.yaml": `packages:
  - "apps/*"
  - "packages/*"
`,
  "apps/web/package.json": `{
  "name": "@harbor/web",
  "version": "0.4.2",
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "@harbor/sdk": "workspace:*",
    "@harbor/config": "workspace:*",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "typescript": "^5.7.0"
  }
}
`,
  "apps/web/tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
`,
  "apps/web/src/main.tsx": `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
  "apps/web/src/App.tsx": `import { Dock } from "./components/Dock";
import { Chart } from "./components/Chart";
import { fetchSnapshot } from "./api";

export function App() {
  return (
    <main>
      <Dock />
      <Chart load={fetchSnapshot} />
    </main>
  );
}
`,
  "apps/web/src/api.ts": `import { createClient } from "@harbor/sdk";
import { harborConfig } from "@harbor/config";

const client = createClient(harborConfig.apiBase);

export async function fetchSnapshot() {
  return client.get("/v1/snapshot");
}

export async function fetchBerth(id: string) {
  return client.get(\`/v1/berths/\${id}\`);
}
`,
  "apps/web/src/components/Dock.tsx": `export function Dock() {
  return <nav aria-label="Harbor dock">Dock</nav>;
}

export function DockItem({ label }: { label: string }) {
  return <a href={"#" + label}>{label}</a>;
}
`,
  "apps/web/src/components/Chart.tsx": `type Props = { load: () => Promise<unknown> };

export function Chart({ load }: Props) {
  void load;
  return <section>Berth occupancy</section>;
}
`,
  "apps/web/src/styles.css": `:root { color-scheme: dark; }
body { margin: 0; font-family: ui-sans-serif; }
`,
  "apps/admin/package.json": `{
  "name": "@harbor/admin",
  "version": "0.4.2",
  "dependencies": {
    "react": "^19.2.0",
    "@harbor/sdk": "workspace:*"
  }
}
`,
  "apps/admin/src/index.tsx": `import { listUsers } from "./users";

export function AdminRoot() {
  return <section>{listUsers().length} operators</section>;
}
`,
  "apps/admin/src/users.ts": `export type Operator = { id: string; role: "pilot" | "clerk" };

export function listUsers(): Operator[] {
  return [{ id: "op-1", role: "pilot" }];
}

export function isPilot(user: Operator) {
  return user.role === "pilot";
}
`,
  "packages/sdk/package.json": `{
  "name": "@harbor/sdk",
  "version": "0.4.2",
  "dependencies": {
    "neverthrow": "^8.0.0"
  }
}
`,
  "packages/sdk/src/index.ts": `export { createClient, HarborClient } from "./client";
export type { HarborConfig, Snapshot } from "./types";
`,
  "packages/sdk/src/client.ts": `import type { HarborConfig } from "./types";

export class HarborClient {
  constructor(private readonly base: string) {}
  get(path: string) {
    return fetch(this.base + path).then((r) => r.json());
  }
}

export function createClient(base: string) {
  return new HarborClient(base);
}
`,
  "packages/sdk/src/types.ts": `export type HarborConfig = { apiBase: string };
export type Snapshot = { berths: number; occupied: number };
`,
  "packages/config/package.json": `{
  "name": "@harbor/config",
  "version": "0.4.2"
}
`,
  "packages/config/src/index.ts": `export const harborConfig = {
  apiBase: "https://api.harbor.example",
  region: "us-east-1",
};
`,
  "services/ingest/pyproject.toml": `[project]
name = "harbor-ingest"
version = "0.4.2"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "pydantic>=2.10",
  "httpx>=0.27",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]
`,
  "services/ingest/src/__init__.py": `from .main import create_app

__all__ = ["create_app"]
`,
  "services/ingest/src/main.py": `from fastapi import FastAPI
from .models import Manifest
from .parsers import parse_manifest

def create_app() -> FastAPI:
    app = FastAPI(title="harbor-ingest")

    @app.post("/parse")
    def parse(raw: str) -> Manifest:
        return parse_manifest(raw)

    return app
`,
  "services/ingest/src/models.py": `from pydantic import BaseModel

class Manifest(BaseModel):
    name: str
    version: str
    files: int
`,
  "services/ingest/src/parsers.py": `from .models import Manifest

def parse_manifest(raw: str) -> Manifest:
    name = "unknown"
    version = "0"
    return Manifest(name=name, version=version, files=raw.count("\\n"))

def sniff_language(path: str) -> str:
    if path.endswith(".py"):
        return "python"
    return "other"
`,
  "services/worker/go.mod": `module github.com/harbor/worker

go 1.22

require (
    github.com/redis/go-redis/v9 v9.6.1
    github.com/rs/zerolog v1.33.0
)
`,
  "services/worker/cmd/worker/main.go": `package main

import (
    "github.com/harbor/worker/internal/queue"
)

func main() {
    queue.Listen("berths")
}
`,
  "services/worker/internal/queue/queue.go": `package queue

import "fmt"

func Listen(topic string) {
    fmt.Println("listening", topic)
}

func Push(topic, payload string) error {
    return nil
}
`,
  "crates/hasher/Cargo.toml": `[package]
name = "harbor-hasher"
version = "0.4.2"
edition = "2021"

[dependencies]
sha2 = "0.10"
hex = "0.4"
`,
  "crates/hasher/src/lib.rs": `use sha2::{Digest, Sha256};

pub fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn digest_str(input: &str) -> String {
    digest_bytes(input.as_bytes())
}
`,
  "docs/architecture.md": `# Architecture

Web and admin consume \`@harbor/sdk\`. Ingest writes manifests. The Go worker
drains the berth queue. Hasher is a tiny crate used by ingest via FFI in the
real system; here it is only present so Cartograph can draw a Cargo tree.
`,
  ".env.example": `HARBOR_API_URL=https://api.harbor.example
HARBOR_TOKEN=
`,
  ".env": `HARBOR_TOKEN=super-secret-do-not-dump
`,
  "node_modules/react/package.json": `{ "name": "react", "version": "19.2.0" }\n`,
  "node_modules/react/index.js": `${"export default {};\n".repeat(800)}`,
  "node_modules/zod/package.json": `{ "name": "zod", "version": "4.0.0" }\n`,
  "node_modules/zod/index.js": `${"function z() {}\n".repeat(600)}`,
  "dist/web.js": `${"/* bundled */\n".repeat(400)}`,
  ".git/config": "[core]\n\trepositoryformatversion = 0\n",
};

