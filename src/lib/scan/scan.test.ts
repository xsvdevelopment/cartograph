import assert from "node:assert/strict";
import { test } from "node:test";
import { HARBOR_FILES, HARBOR_ROOT } from "./fixtures/harbor.ts";
import { filesFromFileList, filesFromRecord, scanProject } from "./ingest.ts";
import { isIgnoredPath, buildIgnoreSet, isSecretPath } from "./ignore.ts";
import { parseManifests, workspaceLinks } from "./deps.ts";
import { extractSymbols } from "./symbols.ts";
import { languageOf } from "./languages.ts";
import { DEFAULT_SCAN_OPTIONS } from "./types.ts";
import { findCommands } from "./commands.ts";
import { importedByCounts, localImports } from "./imports.ts";
import { fileSummary } from "./summary.ts";
import { directoryHints } from "./agent.ts";
import { roleOf } from "./languages.ts";

test("ignore: node_modules anywhere in the path", () => {
  const ignore = buildIgnoreSet();
  assert.equal(isIgnoredPath("apps/web/node_modules/react/index.js", ignore), true);
  assert.equal(isIgnoredPath("apps/web/src/App.tsx", ignore), false);
});

test("ignore: extra glob and directory names", () => {
  const ignore = buildIgnoreSet(["coverage", "*.log"]);
  assert.equal(isIgnoredPath("coverage/lcov.info", ignore), true);
  assert.equal(isIgnoredPath("tmp/debug.log", ignore), true);
  assert.equal(isIgnoredPath("src/index.ts", ignore), false);
});

test("secrets are detected by basename", () => {
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath("config/id_rsa"), true);
  assert.equal(isSecretPath("certs/star.pem"), true);
  assert.equal(isSecretPath(".env.local"), true);
  assert.equal(isSecretPath(".env.example"), false, "templates are meant to be committed");
  assert.equal(isSecretPath("README.md"), false);
});

test("language detection", () => {
  assert.equal(languageOf("apps/web/src/App.tsx"), "TypeScript");
  assert.equal(languageOf("services/ingest/src/main.py"), "Python");
  assert.equal(languageOf("crates/hasher/src/lib.rs"), "Rust");
  assert.equal(languageOf("Dockerfile"), "Dockerfile");
});

test("symbol extraction for TS, Python, Go, Rust", () => {
  assert.ok(
    extractSymbols("client.ts", HARBOR_FILES["packages/sdk/src/client.ts"]).includes(
      "HarborClient",
    ),
  );
  assert.ok(
    extractSymbols("main.py", HARBOR_FILES["services/ingest/src/main.py"]).includes("create_app"),
  );
  assert.ok(
    extractSymbols("queue.go", HARBOR_FILES["services/worker/internal/queue/queue.go"]).includes(
      "Listen",
    ),
  );
  assert.ok(
    extractSymbols("lib.rs", HARBOR_FILES["crates/hasher/src/lib.rs"]).includes("digest_bytes"),
  );
});

test("symbol extraction collects class methods, not just class names", () => {
  const clientSymbols = extractSymbols("client.ts", HARBOR_FILES["packages/sdk/src/client.ts"]);
  assert.ok(clientSymbols.includes("HarborClient"));
  assert.ok(clientSymbols.includes("HarborClient.constructor"));
  assert.ok(clientSymbols.includes("HarborClient.get"));
  assert.ok(clientSymbols.includes("createClient"));
});

test("symbol extraction attributes Python methods to their class", () => {
  const src = `class Widget:
    def __init__(self, name):
        self.name = name

    def render(self):
        return self.name

def helper():
    return 1
`;
  const symbols = extractSymbols("widget.py", src);
  assert.ok(symbols.includes("Widget"));
  assert.ok(symbols.includes("Widget.__init__"));
  assert.ok(symbols.includes("Widget.render"));
  assert.ok(symbols.includes("helper"));
});

test("symbol extraction catches non-exported const arrow functions", () => {
  const src = `const helper = (x: number) => x + 1;
export const publicHelper = async (x: number) => x + 2;
`;
  const symbols = extractSymbols("util.ts", src);
  assert.ok(symbols.includes("helper"));
  assert.ok(symbols.includes("publicHelper"));
});

test("npm and python manifests parse with workspace links", () => {
  const manifests = parseManifests([
    { path: "package.json", content: HARBOR_FILES["package.json"] },
    { path: "apps/web/package.json", content: HARBOR_FILES["apps/web/package.json"] },
    { path: "packages/sdk/package.json", content: HARBOR_FILES["packages/sdk/package.json"] },
    {
      path: "services/ingest/pyproject.toml",
      content: HARBOR_FILES["services/ingest/pyproject.toml"],
    },
  ]);
  const npmRoot = manifests.find((m) => m.path === "package.json");
  assert.ok(npmRoot?.workspaces?.includes("apps/*"));
  const web = manifests.find((m) => m.path === "apps/web/package.json");
  assert.ok(web?.dependencies.some((d) => d.name === "@harbor/sdk"));
  const py = manifests.find((m) => m.ecosystem === "python");
  assert.equal(py?.name, "harbor-ingest");
  assert.ok(py?.dependencies.some((d) => d.name === "fastapi"));
  const links = workspaceLinks(manifests);
  assert.ok(links.some((l) => l.from === "@harbor/web" && l.to === "@harbor/sdk"));
});

test("harbor sample scan is read-only, omits secrets, and shrinks tokens", async () => {
  const files = filesFromRecord(HARBOR_ROOT, HARBOR_FILES);
  const result = await scanProject(HARBOR_ROOT, files, {
    ...DEFAULT_SCAN_OPTIONS,
    mode: "skeleton",
    dialect: "markdown",
  });

  assert.equal(result.rootName, "harbor");
  assert.ok(result.files.some((f) => f.path === "apps/web/src/App.tsx"));
  assert.ok(result.markdown.includes("Directory tree"));
  assert.ok(result.markdown.includes("Dependency tree"));
  assert.ok(result.markdown.includes("@harbor/sdk"));
  assert.ok(result.markdown.includes("harbor-ingest"));
  assert.ok(result.markdown.includes("github.com/redis/go-redis/v9"));
  assert.ok(result.markdown.includes("harbor-hasher"));

  const env = result.files.find((f) => f.path === ".env");
  assert.ok(env);
  assert.equal(env?.kind, "secret");
  assert.equal(env?.content, undefined);
  assert.ok(!result.markdown.includes("super-secret-do-not-dump"));

  assert.ok(result.markdown.includes("For coding agents"));
  assert.ok(result.markdown.includes("Quick find"));
  assert.ok(result.markdown.includes("Claude Code"));
  assert.ok(result.agentBrief.includes(result.mapFileName));
  assert.ok(result.agentBrief.includes("Claude Code"));
  assert.equal(result.mapFileName, "harbor.cartograph.md");
  assert.ok(result.manifests.length >= 4);
});

test("compact dialect still carries tree and deps", async () => {
  const files = filesFromRecord(HARBOR_ROOT, HARBOR_FILES);
  const result = await scanProject(HARBOR_ROOT, files, {
    ...DEFAULT_SCAN_OPTIONS,
    mode: "map",
    dialect: "compact",
  });
  assert.ok(result.markdown.startsWith("# harbor"));
  assert.ok(result.markdown.includes("FOR AGENTS"));
  assert.ok(result.markdown.includes("FIND") || result.markdown.includes("TREE"));
  assert.ok(result.markdown.includes("DEPS"));
  assert.ok(result.markdown.includes("INDEX"));
  assert.ok(!result.markdown.includes("super-secret-do-not-dump"));
});

test("contents mode fences source but still omits secrets", async () => {
  const files = filesFromRecord(HARBOR_ROOT, HARBOR_FILES);
  const result = await scanProject(HARBOR_ROOT, files, {
    ...DEFAULT_SCAN_OPTIONS,
    mode: "contents",
    dialect: "markdown",
  });
  assert.ok(result.markdown.includes("export function App"));
  assert.ok(!result.markdown.includes("super-secret-do-not-dump"));
});

test("nested .gitignore only applies inside its own folder", async () => {
  // Python venvs and pytest caches ship a `.gitignore` containing just `*`.
  const files = filesFromRecord("proj", {
    ".gitignore": "*.log\n",
    "venv-custom/.gitignore": "*\n",
    "venv-custom/lib/cert.pem": "-----BEGIN CERTIFICATE-----",
    "src/app.py": "def main():\n    pass\n",
    "src/debug.log": "noise",
    "README.md": "# proj\n",
    "proj.cartograph.md": "# old map\n",
  });
  const result = await scanProject("proj", files, DEFAULT_SCAN_OPTIONS);
  const paths = result.files.map((f) => f.path);
  assert.ok(paths.includes("src/app.py"));
  assert.ok(paths.includes("README.md"));
  assert.ok(!paths.includes("src/debug.log"));
  assert.ok(!paths.includes("venv-custom/lib/cert.pem"), "secrets in ignored dirs stay omitted");
  assert.ok(!paths.includes("proj.cartograph.md"), "old maps are not re-indexed");
});

test("ignore: path patterns cover everything inside a matching folder", () => {
  const ignore = buildIgnoreSet(["**/generated", "/docs/api", "tmp*"]);
  assert.equal(isIgnoredPath("generated/a.ts", ignore), true);
  assert.equal(isIgnoredPath("src/generated/deep/a.ts", ignore), true);
  assert.equal(isIgnoredPath("docs/api/index.html", ignore), true);
  assert.equal(isIgnoredPath("docs/guide.md", ignore), false);
  assert.equal(isIgnoredPath("tmp-build/out.txt", ignore), true);
  assert.equal(isIgnoredPath("src/app.ts", ignore), false);
});

test("gitignored folders are named in the map with a count", async () => {
  const files = filesFromRecord("p", {
    ".gitignore": ".superpowers/\ndocs/api\n*.log\n",
    ".superpowers/notes.md": "x",
    ".superpowers/deep/plan.md": "x",
    "docs/api/index.html": "x",
    "docs/guide.md": "x",
    "tools/.cache-dir/.gitignore": "*\n",
    "tools/.cache-dir/blob.txt": "x",
    "debug.log": "x",
    "src/a.ts": "export const a = 1;\n",
  });
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  const named = Object.fromEntries(result.omittedDirs.map((d) => [d.path, d.count]));
  assert.deepEqual(named, { ".superpowers": 2, "docs/api": 1, "tools/.cache-dir": 2 });
  assert.ok(result.markdown.includes(".superpowers/  [omitted · 2 files]"));
  assert.ok(result.markdown.includes("api/  [omitted · 1 file]"));
  assert.ok(
    result.markdown.includes("tools/.cache-dir/  [omitted · 2 files]"),
    "an empty parent shares the line",
  );
});

test("secrets are named but never read", async () => {
  let reads = 0;
  const secret = new Blob(["TOKEN=abc"]);
  const files = [
    { path: ".env", size: secret.size, load: async () => (reads++, secret) },
    { path: "index.ts", size: 20, content: "export const a = 1;\n" },
  ];
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  assert.equal(reads, 0);
  assert.equal(result.files.find((f) => f.path === ".env")?.kind, "secret");
});

test("lazy files in skipped folders are never loaded", async () => {
  let reads = 0;
  const body = new Blob(["export {}"]);
  const files = [
    { path: "node_modules/x/index.js", size: body.size, load: async () => (reads++, body) },
    { path: "src/a.ts", size: body.size, load: async () => (reads++, body) },
  ];
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  assert.equal(reads, 1);
  assert.equal(result.stats.omittedFiles, 1);
});

test("loose files don't name the project after the first file", () => {
  const list = [new File(["a"], "index.ts"), new File(["b"], "util.ts")];
  const { rootName, files } = filesFromFileList(list);
  assert.equal(rootName, "project");
  assert.deepEqual(
    files.map((f) => f.path),
    ["index.ts", "util.ts"],
  );
});

test("a picked folder names the project after the folder", () => {
  const a = new File(["a"], "a.ts");
  Object.defineProperty(a, "webkitRelativePath", { value: "shop/src/a.ts" });
  const { rootName, files } = filesFromFileList([a]);
  assert.equal(rootName, "shop");
  assert.equal(files[0].path, "src/a.ts");
});

test("savings are measured against listed source, not node_modules", async () => {
  const files = filesFromRecord(HARBOR_ROOT, HARBOR_FILES);
  const result = await scanProject(HARBOR_ROOT, files, DEFAULT_SCAN_OPTIONS);
  const listedText = result.files.filter((f) => f.kind === "text").reduce((n, f) => n + f.size, 0);
  assert.equal(result.stats.rawTokens, Math.round(listedText / 3.6));
});

test("on a project of real size the map is far smaller than the source", async () => {
  const record: Record<string, string> = {};
  for (let i = 0; i < 60; i++) {
    const body = Array.from({ length: 80 }, (_, j) => `  const v${j} = compute(${j}, input);`).join(
      "\n",
    );
    record[`src/feature${i}/service.ts`] =
      `export function handle${i}(input: number) {\n${body}\n  return input;\n}\n`;
  }
  const result = await scanProject("big", filesFromRecord("big", record), DEFAULT_SCAN_OPTIONS);
  assert.ok(result.stats.savingsPct > 80, `expected big savings, got ${result.stats.savingsPct}%`);
  assert.ok(result.markdown.includes("% smaller"));
});

test("a dependency table at the very end of the file is still read", () => {
  const [cargo, pipfile, pubspec, poetry] = parseManifests([
    {
      path: "a/Cargo.toml",
      content:
        '[package]\nname = "a"\n\n[dependencies]\nsha2 = "0.10"\nserde = { version = "1", features = ["derive"] }\n',
    },
    { path: "b/Pipfile", content: '[packages]\nrequests = "*"\n\n[dev-packages]\npytest = "*"\n' },
    {
      path: "c/pubspec.yaml",
      content: "name: app\ndependencies:\n  http: ^1.0.0\n  flutter:\n    sdk: flutter\n",
    },
    {
      path: "d/pyproject.toml",
      content:
        '[tool.poetry]\nname = "d"\n\n[tool.poetry.dependencies]\npython = "^3.12"\nrich = "^13"\n',
    },
  ]);
  assert.deepEqual(
    cargo.dependencies.map((d) => `${d.name}@${d.version}`),
    ["sha2@0.10", "serde@1"],
  );
  assert.deepEqual(
    pipfile.dependencies.map((d) => `${d.name}:${d.kind}`),
    ["requests:prod", "pytest:dev"],
  );
  assert.deepEqual(
    pubspec.dependencies.map((d) => d.name),
    ["http", "flutter"],
  );
  assert.deepEqual(
    poetry.dependencies.map((d) => d.name),
    ["rich"],
  );
});

test("folders full of images become one line in the tree and index", async () => {
  const record: Record<string, string> = { "src/game.ts": "export function run() {}\n" };
  for (let i = 0; i < 12; i++) record[`art/sprites/frame${i}.png`] = "PNG";
  record["art/logo.png"] = "PNG";
  const result = await scanProject("g", filesFromRecord("g", record), DEFAULT_SCAN_OPTIONS);
  assert.ok(result.markdown.includes("art/sprites/ · 12 images (png)"));
  assert.ok(!result.markdown.includes("frame3.png"));
  assert.ok(result.markdown.includes("art/logo.png"), "a lone image is still listed");
  assert.equal(result.stats.listedFiles, 14, "stats still count every file");
});

test("extensionless scripts are read and indexed by their shebang", async () => {
  const files = filesFromRecord("s", {
    "bin/deploy": "#!/usr/bin/env python3\ndef main():\n    pass\n",
    "bin/setup": "#!/bin/bash\nfunction install_deps {\n  :\n}\ncleanup() {\n  :\n}\n",
    VERSION: "1.2.3\n",
  });
  const result = await scanProject("s", files, DEFAULT_SCAN_OPTIONS);
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
  assert.equal(byPath["bin/deploy"].language, "Python");
  assert.deepEqual(byPath["bin/deploy"].symbols, ["main"]);
  assert.equal(byPath["bin/setup"].language, "Shell");
  assert.deepEqual(byPath["bin/setup"].symbols, ["install_deps", "cleanup"]);
  assert.equal(byPath["VERSION"].language, "Text");
});

test("3D models and logs get real labels, and model folders are grouped", async () => {
  const record: Record<string, string> = { "game.log": "started\n" };
  for (let i = 0; i < 10; i++) record[`assets/models/m${i}.glb`] = "glTF";
  record["assets/source/scene.blend1"] = "BLENDER";
  const result = await scanProject("a", filesFromRecord("a", record), DEFAULT_SCAN_OPTIONS);
  assert.ok(result.markdown.includes("assets/models/ · 10 models (glb)"));
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.language]));
  assert.equal(byPath["assets/source/scene.blend1"], "3D model");
  assert.equal(byPath["game.log"], "Log");
});

test("commands come from package.json scripts, Makefiles and justfiles, root first", () => {
  const groups = findCommands(
    [
      { path: "apps/web/package.json", content: JSON.stringify({ scripts: { dev: "vite" } }) },
      {
        path: "package.json",
        content: JSON.stringify({ scripts: { build: "tsc && vite build", test: "vitest run" } }),
      },
      {
        path: "Makefile",
        content: ".PHONY: all\nall: build\nbuild:\n\tgo build ./...\nCC := gcc\n",
      },
      { path: "tools/justfile", content: "deploy env:\n  ./deploy.sh {{env}}\n" },
      { path: "broken/package.json", content: "{not json" },
    ],
    ["package.json", "pnpm-lock.yaml"],
  );
  assert.deepEqual(
    groups.map((g) => g.path),
    ["Makefile", "package.json", "tools/justfile", "apps/web/package.json"],
  );
  const root = groups.find((g) => g.path === "package.json")!;
  assert.equal(root.how, "pnpm <name>");
  assert.deepEqual(root.commands, [
    { name: "build", run: "tsc && vite build" },
    { name: "test", run: "vitest run" },
  ]);
  assert.deepEqual(
    groups[0].commands.map((c) => c.name),
    ["all", "build"],
    "a := assignment is not a target",
  );
  assert.deepEqual(groups[2].commands, [{ name: "deploy" }]);
});

test("local imports resolve relative, aliased and Python paths, and never guess", () => {
  const graph = localImports(
    [
      {
        path: "src/app.ts",
        content:
          'import { a } from "./lib/a.js";\nimport x from "@/lib/b";\nimport React from "react";\nimport "./styles.css";\n',
      },
      {
        path: "src/lib/a.ts",
        content: 'export * from "./b";\nconst c = await import("../util");\n',
      },
      {
        path: "src/lib/b.ts",
        content: 'import fs from "node:fs";\nimport u from "shared/util";\n',
      },
      { path: "src/util/index.ts", content: "" },
      { path: "src/styles.css" },
      { path: "a/shared/util.ts", content: "" },
      { path: "b/shared/util.ts", content: "" },
      { path: "pkg/__init__.py", content: "" },
      {
        path: "pkg/core.py",
        content: "from . import helpers\nfrom .helpers import thing\nimport os\n",
      },
      { path: "pkg/helpers.py", content: "import pkg.core\n" },
    ],
    new Set(["react"]),
  );
  assert.deepEqual(graph.get("src/app.ts"), ["src/lib/a.ts", "src/lib/b.ts", "src/styles.css"]);
  assert.deepEqual(graph.get("src/lib/a.ts"), ["src/lib/b.ts", "src/util/index.ts"]);
  assert.equal(
    graph.get("src/lib/b.ts"),
    undefined,
    "two files end in shared/util, so neither is picked",
  );
  assert.deepEqual(graph.get("pkg/core.py"), ["pkg/helpers.py"]);
  assert.deepEqual(graph.get("pkg/helpers.py"), ["pkg/core.py"]);
  assert.equal(importedByCounts(graph).get("src/lib/b.ts"), 2);
});

test("a file's summary is its opening comment, docstring or first heading", () => {
  assert.equal(
    fileSummary(
      "a.ts",
      "/**\n * Reads the journal back from disk. Used on resume.\n * @module journal\n */\nexport const a = 1;\n",
    ),
    "Reads the journal back from disk",
  );
  assert.equal(
    fileSummary(
      "a.py",
      '#!/usr/bin/env python\n"""Loads settings from the user profile."""\nimport os\n',
    ),
    "Loads settings from the user profile",
  );
  assert.equal(
    fileSummary("run.sh", "#!/bin/sh\n# Builds the installer and signs it\nset -e\n"),
    "Builds the installer and signs it",
  );
  assert.equal(
    fileSummary("docs/guide.md", "# Getting started with plans\n\ntext\n"),
    "Getting started with plans",
  );
  assert.equal(
    fileSummary("b.ts", "// Copyright 2026 Someone. MIT License.\nexport const b = 1;\n"),
    undefined,
  );
  assert.equal(
    fileSummary("c.ts", "// eslint-disable-next-line no-console\nconsole.log(1);\n"),
    undefined,
  );
  assert.equal(
    fileSummary("d.ts", "export const d = 1;\n// A trailing remark about nothing much\n"),
    undefined,
  );
  assert.equal(
    fileSummary(
      "main.rs",
      "// Prevents an extra console window, DO NOT REMOVE!!\n#![cfg_attr(x, y)]\n",
    ),
    undefined,
  );
});

test("the map carries commands, importers, summaries and a folders-only tree", async () => {
  const files = filesFromRecord("p", {
    "package.json": JSON.stringify({
      name: "p",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "^1.0.0", vite: "^5.0.0" },
    }),
    "src/core/types.ts":
      "/** Shapes shared by every module in the project. */\nexport type A = { a: number };\n",
    "src/core/a.ts": 'import type { A } from "./types.ts";\nexport const a: A = { a: 1 };\n',
    "src/core/b.ts": 'import type { A } from "./types.ts";\nexport const b: A = { a: 2 };\n',
    "src/core/c.ts": 'import type { A } from "./types.ts";\nexport const c: A = { a: 3 };\n',
    "tests/a.test.ts": 'import { a } from "../src/core/a.ts";\nfunction setupHelper() {}\n',
  });
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  const md = result.markdown;
  assert.equal(result.files.find((f) => f.path === "src/core/types.ts")?.usedBy, 3);
  assert.ok(md.includes("## Commands"));
  assert.ok(md.includes("- `test` · vitest run"));
  assert.ok(md.includes("- `src/core/types.ts` · used by 3 files"));
  assert.ok(md.includes('"Shapes shared by every module in the project"'));
  assert.ok(md.includes("src/core/ · 4"), "a folder holding only one folder shares its line");
  assert.ok(/dev: (vitest \^1\.0\.0, vite \^5\.0\.0|vite \^5\.0\.0, vitest \^1\.0\.0)/.test(md));
  assert.ok(!md.includes("setupHelper"), "a test's local helpers stay out of the index");
  const tree = md.slice(md.indexOf("## Directory tree"), md.indexOf("## Languages"));
  assert.ok(!tree.includes("types.ts"), "files are in the index, not the tree");

  const compact = await scanProject("p", files, { ...DEFAULT_SCAN_OPTIONS, dialect: "compact" });
  assert.ok(compact.markdown.includes("CMD"));
  assert.ok(compact.markdown.includes("test=vitest run"));
  assert.ok(compact.markdown.includes("HUBS src/core/types.ts<3"));
});

test("map mode reads no source, so it claims no importers", async () => {
  const files = filesFromRecord("p", {
    "a.ts": 'import { b } from "./b.ts";\n',
    "b.ts": "export const b = 1;\n",
  });
  const result = await scanProject("p", files, { ...DEFAULT_SCAN_OPTIONS, mode: "map" });
  assert.ok(result.files.every((f) => f.usedBy === undefined));
});

test("quick find points at the folder that holds most of a role, and CI has its own role", () => {
  assert.equal(roleOf(".github/workflows/ci.yml"), "ci");
  assert.equal(roleOf("tsconfig.node.json"), "config");
  const listed = [
    "tests/unit/a.test.ts",
    "tests/unit/b.test.ts",
    "tests/e2e/c.test.ts",
    "tests/e2e/d.test.ts",
  ].map((path) => ({ path, kind: "text" }) as never);
  assert.deepEqual(directoryHints(listed), [{ need: "tests", path: "tests" }]);
  assert.equal(roleOf("sim-tests/ShopTests.cs"), "test");
  assert.equal(roleOf("pkg/test_models.py"), "test");
  assert.equal(roleOf("src/latest.js"), "source");
  const split = [
    "app/src/a.ts",
    "app/src/b.ts",
    "app/src/ui/c.tsx",
    "server/api/d.js",
    "server/api/e.js",
    "server/f.js",
  ].map((path) => ({ path, kind: "text", language: "TypeScript" }) as never);
  assert.deepEqual(
    directoryHints(split).filter((h) => h.need === "source"),
    [
      { need: "source", path: "app/src" },
      { need: "source", path: "server/api" },
    ],
  );
  const icons = ["a", "b", "c", "d"].map(
    (n) => ({ path: `app/icons/${n}.png`, kind: "binary" }) as never,
  );
  const code = [{ path: "app/src/main.rs", kind: "text" } as never];
  assert.deepEqual(directoryHints([...icons, ...code]), [
    { need: "source", path: "app/src/main.rs" },
  ]);
});

test("entry points come from manifests, pages and files that declare a main", async () => {
  const files = filesFromRecord("p", {
    "package.json": JSON.stringify({
      name: "p",
      main: "./out/main/index.js",
      scripts: { start: "node server/index.js --port 3000" },
    }),
    "src/main/index.ts": "export const boot = 1;\n",
    "server/index.js": "console.log(1);\n",
    "web/index.html": '<script type="module" src="/src/main.tsx"></script>\n',
    "web/src/main.tsx": "export {};\n",
    "cli/app.py": 'def run():\n    pass\n\nif __name__ == "__main__":\n    run()\n',
    "tools/build_icons.py": 'if __name__ == "__main__":\n    pass\n',
    "plugin/Main.java": "public class Main extends JavaPlugin {}\n",
  });
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  assert.deepEqual(
    Object.fromEntries(result.entryPoints.map((e) => [e.path, e.why])),
    {
      "src/main/index.ts": '"main" in package.json',
      "server/index.js": "run by the `start` script",
      "web/index.html": "page the browser loads",
      "web/src/main.tsx": "loaded by web/index.html",
      "cli/app.py": "runs as a script",
      "plugin/Main.java": "plugin main class",
    },
    "a build tool under tools/ is not an entry point",
  );
  assert.ok(result.markdown.includes("## Entry points"));
});

test("imports are followed in Java, Rust, C and from HTML pages", () => {
  const graph = localImports(
    [
      { path: "core/src/main/java/com/x/db/Database.java", content: "package com.x.db;\n" },
      {
        path: "core/src/main/java/com/x/App.java",
        content:
          "import com.x.db.Database;\nimport static com.x.db.Database.open;\nimport java.util.List;\n",
      },
      { path: "crate/src/main.rs", content: "mod config;\nuse crate::net::client::Client;\n" },
      { path: "crate/src/config.rs", content: "" },
      { path: "crate/src/net/mod.rs", content: "pub mod client;\n" },
      { path: "crate/src/net/client.rs", content: "use crate::config::Config;\n" },
      { path: "c/main.c", content: '#include "util.h"\n#include <stdio.h>\n' },
      { path: "c/util.h", content: "" },
      { path: "c/util.c", content: '#include "util.h"\n' },
      {
        path: "site/index.html",
        content:
          '<link rel="stylesheet" href="css/site.css"><script src="/site/js/app.js"></script><script src="https://cdn.example.com/x.js"></script><a href="about.html">x</a>',
      },
      { path: "site/about.html", content: "" },
      { path: "site/css/site.css", content: '@import "base.css";\n' },
      { path: "site/css/base.css", content: "" },
      { path: "site/js/app.js", content: "" },
    ],
    new Set(),
  );
  assert.deepEqual(graph.get("core/src/main/java/com/x/App.java"), [
    "core/src/main/java/com/x/db/Database.java",
  ]);
  assert.deepEqual(graph.get("crate/src/main.rs"), [
    "crate/src/config.rs",
    "crate/src/net/client.rs",
  ]);
  assert.deepEqual(graph.get("crate/src/net/mod.rs"), ["crate/src/net/client.rs"]);
  assert.deepEqual(graph.get("crate/src/net/client.rs"), ["crate/src/config.rs"]);
  assert.deepEqual(graph.get("c/main.c"), ["c/util.h"]);
  assert.deepEqual(
    graph.get("site/index.html"),
    ["site/css/site.css", "site/js/app.js"],
    "a link to another page is not an import",
  );
  assert.deepEqual(graph.get("site/css/site.css"), ["site/css/base.css"]);
});

test("a folder of cached data is one line, and the code is read before it", async () => {
  const record: Record<string, string> = {
    "scripts/shots.mjs": "export function shoot() {}\n",
    "src/prompt.txt": "write a haiku about ships\n",
  };
  for (let i = 0; i < 40; i++)
    record[`scripts/.cache-1/_api_${String(i).padStart(2, "0")}.json`] = "{}";

  const lazy = Object.entries(record).map(([path, text]) => ({
    path,
    size: text.length,
    load: async () => new Blob([text]),
  }));
  const result = await scanProject("p", lazy, { ...DEFAULT_SCAN_OPTIONS, maxReadFiles: 5 });
  const md = result.markdown;
  assert.ok(md.includes("- scripts/.cache-1/ · 40 JSON files (json)"));
  assert.ok(!md.includes("_api_07.json"));
  assert.ok(md.includes("shoot"), "the script was read ahead of the cache");
  assert.ok(
    md.includes("- src/prompt.txt · Text · 1 · data"),
    "a text file under src/ is not source",
  );
  assert.deepEqual(directoryHints(result.files), [{ need: "scripts", path: "scripts/shots.mjs" }]);
});

test("Unity caches and .meta files are skipped wherever the project sits", async () => {
  const files = filesFromRecord("p", {
    "game/ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 6000.0.1f1\n",
    "game/Assets/Scripts/Shop.cs": "public class Shop {}\n",
    "game/Assets/Scripts/Shop.cs.meta": "guid: 1\n",
    "game/Library/cache.txt": "x",
    "game/Temp/a.txt": "x",
    "tools/Library/keep.py": "x = 1\n",
    "notes.meta": "kept: outside the Unity project\n",
  });
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  const paths = result.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    "game/Assets/Scripts/Shop.cs",
    "game/ProjectSettings/ProjectVersion.txt",
    "notes.meta",
    "tools/Library/keep.py",
  ]);
  assert.ok(result.markdown.includes("- game/Assets/Scripts/Shop.cs · C# · 1 · source"));
  assert.deepEqual(Object.fromEntries(result.omittedDirs.map((d) => [d.path, d.count])), {
    "game/Library": 1,
    "game/Temp": 1,
  });
});

test("C# and Go files are followed by the names they use", () => {
  const graph = localImports(
    [
      {
        path: "Assets/Scripts/Shop.cs",
        content:
          'public class Shop {\n  Kitchen kitchen; // uses Ghost in a comment only\n  string s = "Ghost";\n}\n',
      },
      {
        path: "Assets/Scripts/Kitchen.cs",
        content: "public class Kitchen { Oven oven; }\npublic enum Doneness { Rare }\n",
      },
      {
        path: "Assets/Scripts/Oven.cs",
        content: "namespace Game.Cooking {\n  public struct Oven {}\n}\n",
      },
      { path: "Assets/Scripts/Ghost.cs", content: "public class Ghost {}\n" },
      {
        path: "Assets/Scripts/Menu.cs",
        content:
          "using Game.Cooking;\nnamespace Game.Ui { class Menu { Oven o; Doneness d; Item i; } }\n",
      },
      { path: "a/Item.cs", content: "namespace A { class Item {} }\n" },
      { path: "b/Item.cs", content: "namespace B { class Item {} }\n" },

      { path: "go.mod", content: "module example.com/shop\n\ngo 1.22\n" },
      {
        path: "main.go",
        content:
          'package main\n\nimport (\n\t"fmt"\n\tst "example.com/shop/internal/store"\n\t"example.com/shop/internal/api"\n)\n\nfunc main() {\n\tdb := st.Open()\n\tapi.Serve(db)\n\tfmt.Println(version)\n}\n',
      },
      { path: "version.go", content: 'package main\n\nconst version = "1"\n' },
      {
        path: "internal/store/store.go",
        content: "package store\n\nfunc Open() *DB { return nil }\n",
      },
      { path: "internal/store/db.go", content: "package store\n\ntype DB struct{}\n" },
      {
        path: "internal/store/store_test.go",
        content: "package store\n\nfunc TestOpen() { Open() }\n",
      },
      { path: "internal/api/server.go", content: "package api\n\nfunc Serve(x any) {}\n" },
      { path: "internal/api/unused.go", content: "package api\n\nfunc Other() {}\n" },
    ],
    new Set(),
  );
  assert.deepEqual(
    graph.get("Assets/Scripts/Shop.cs"),
    ["Assets/Scripts/Kitchen.cs"],
    "a name in a comment or a string is not a use",
  );
  assert.equal(
    graph.get("Assets/Scripts/Kitchen.cs"),
    undefined,
    "Oven sits in a namespace Kitchen never opens",
  );
  assert.deepEqual(
    graph.get("Assets/Scripts/Menu.cs"),
    ["Assets/Scripts/Kitchen.cs", "Assets/Scripts/Oven.cs"],
    "Item is declared in two namespaces Menu cannot see, so neither is picked",
  );
  assert.deepEqual(graph.get("main.go"), [
    "internal/api/server.go",
    "internal/store/store.go",
    "version.go",
  ]);
  assert.deepEqual(
    graph.get("internal/store/store.go"),
    undefined,
    "DB is under four letters, so it is not matched by name",
  );
  assert.deepEqual(graph.get("internal/store/store_test.go"), ["internal/store/store.go"]);
  assert.equal(importedByCounts(graph).get("internal/api/unused.go"), undefined);
});

test("toolchains with fixed commands are listed once, at the workspace root", () => {
  const groups = findCommands(
    [
      { path: "Cargo.toml", content: '[workspace]\nmembers = ["crates/a"]\n' },
      { path: "crates/a/Cargo.toml", content: '[package]\nname = "a"\n' },
      { path: "svc/go.mod", content: "module example.com/svc\n" },
      { path: "android/gradlew", content: "#!/bin/sh\n" },
      { path: "Game.sln" },
      { path: "deno.json", content: JSON.stringify({ tasks: { dev: "deno run -A main.ts" } }) },
      {
        path: "php/composer.json",
        content: JSON.stringify({ scripts: { test: ["phpunit", "phpstan"] } }),
      },
    ],
    ["Cargo.toml", "src/main.rs", "crates/a/Cargo.toml", "crates/a/src/lib.rs"],
  );
  assert.deepEqual(
    groups.map((g) => [
      g.path,
      g.how,
      g.commands.map((c) => (c.run ? `${c.name}=${c.run}` : c.name)).join(","),
    ]),
    [
      ["Cargo.toml", "cargo <name>", "build,test,run"],
      ["deno.json", "deno task <name>", "dev=deno run -A main.ts"],
      ["Game.sln", "dotnet <name>", "build,test"],
      ["android/gradlew", "./gradlew <name>", "build,test"],
      ["php/composer.json", "composer run <name>", "test=phpunit && phpstan"],
      ["svc/go.mod", "go <name> ./...", "build,test,vet"],
    ],
  );
});

test("console scripts and Unity load hooks are entry points", async () => {
  const files = filesFromRecord("p", {
    "pyproject.toml":
      '[project]\nname = "tool"\n\n[project.scripts]\ntool = "tool.cli:main"\n\n[tool.ruff]\nline-length = 100\n',
    "src/tool/cli.py": "def main():\n    pass\n",
    "game/ProjectSettings/ProjectVersion.txt": "x\n",
    "game/Assets/Scripts/Boot.cs":
      "public static class Boot {\n  [RuntimeInitializeOnLoadMethod]\n  static void Init() {}\n}\n",
  });
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  assert.deepEqual(Object.fromEntries(result.entryPoints.map((e) => [e.path, e.why])), {
    "src/tool/cli.py": "the `tool` command",
    "game/Assets/Scripts/Boot.cs": "runs when the game loads",
  });
});

test("PowerShell and batch scripts are indexed, summarized and linked", async () => {
  const files = filesFromRecord("p", {
    "GEAR ON.bat":
      '@echo off\r\nrem Starts the peripheral software before gaming.\r\nstart "" powershell -File "%~dp0gear.ps1"\r\ngoto :eof\r\n:cleanup\r\n',
    "gear.ps1":
      '# Starts services on demand, with one prompt if any are stopped.\n. "$here\\config.ps1"\nfunction Start-Gear { }\nfilter script:Only-Stopped { }\n',
    "config.ps1":
      "<#\n.SYNOPSIS\nWhat lockdown turns off and what gear turns back on.\n.NOTES\nx\n#>\n$Services = @()\n",
    "tools/helper.cmd": ":: Rebuilds the icon cache for the current user\r\ncall ..\\gear.ps1\r\n",
  });
  const result = await scanProject("p", files, DEFAULT_SCAN_OPTIONS);
  const by = Object.fromEntries(result.files.map((f) => [f.path, f]));
  assert.deepEqual(by["gear.ps1"].symbols, ["Start-Gear", "Only-Stopped"]);
  assert.deepEqual(by["GEAR ON.bat"].symbols, ["cleanup"]);
  assert.equal(by["GEAR ON.bat"].summary, "Starts the peripheral software before gaming");
  assert.equal(
    by["gear.ps1"].summary,
    "Starts services on demand, with one prompt if any are stopped",
  );
  assert.equal(by["config.ps1"].summary, "What lockdown turns off and what gear turns back on");
  assert.equal(by["tools/helper.cmd"].summary, "Rebuilds the icon cache for the current user");
  assert.equal(by["gear.ps1"].usedBy, 2);
  assert.equal(by["config.ps1"].usedBy, 1);
  assert.deepEqual(result.entryPoints, [{ path: "GEAR ON.bat", why: "batch file to run" }]);
});
