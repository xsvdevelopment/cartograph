import assert from "node:assert/strict";
import { test } from "node:test";
import { HARBOR_FILES, HARBOR_ROOT } from "./fixtures/harbor.ts";
import { filesFromFileList, filesFromRecord, scanProject } from "./ingest.ts";
import { isIgnoredPath, buildIgnoreSet, isSecretPath } from "./ignore.ts";
import { parseManifests, workspaceLinks } from "./deps.ts";
import { extractSymbols } from "./symbols.ts";
import { languageOf } from "./languages.ts";
import { DEFAULT_SCAN_OPTIONS } from "./types.ts";

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
  assert.ok(extractSymbols("client.ts", HARBOR_FILES["packages/sdk/src/client.ts"]).includes("HarborClient"));
  assert.ok(extractSymbols("main.py", HARBOR_FILES["services/ingest/src/main.py"]).includes("create_app"));
  assert.ok(extractSymbols("queue.go", HARBOR_FILES["services/worker/internal/queue/queue.go"]).includes("Listen"));
  assert.ok(extractSymbols("lib.rs", HARBOR_FILES["crates/hasher/src/lib.rs"]).includes("digest_bytes"));
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
    { path: "services/ingest/pyproject.toml", content: HARBOR_FILES["services/ingest/pyproject.toml"] },
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
  assert.ok(result.markdown.includes("`.superpowers/` (2 files)"));
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
  assert.deepEqual(files.map((f) => f.path), ["index.ts", "util.ts"]);
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
  const listedText = result.files
    .filter((f) => f.kind === "text")
    .reduce((n, f) => n + f.size, 0);
  assert.equal(result.stats.rawTokens, Math.round(listedText / 3.6));
});

test("on a project of real size the map is far smaller than the source", async () => {
  const record: Record<string, string> = {};
  for (let i = 0; i < 60; i++) {
    const body = Array.from({ length: 80 }, (_, j) => `  const v${j} = compute(${j}, input);`).join("\n");
    record[`src/feature${i}/service.ts`] =
      `export function handle${i}(input: number) {\n${body}\n  return input;\n}\n`;
  }
  const result = await scanProject("big", filesFromRecord("big", record), DEFAULT_SCAN_OPTIONS);
  assert.ok(result.stats.savingsPct > 80, `expected big savings, got ${result.stats.savingsPct}%`);
  assert.ok(result.markdown.includes("% smaller"));
});

test("a dependency table at the very end of the file is still read", () => {
  const [cargo, pipfile, pubspec, poetry] = parseManifests([
    { path: "a/Cargo.toml", content: '[package]\nname = "a"\n\n[dependencies]\nsha2 = "0.10"\nserde = { version = "1", features = ["derive"] }\n' },
    { path: "b/Pipfile", content: '[packages]\nrequests = "*"\n\n[dev-packages]\npytest = "*"\n' },
    { path: "c/pubspec.yaml", content: "name: app\ndependencies:\n  http: ^1.0.0\n  flutter:\n    sdk: flutter\n" },
    { path: "d/pyproject.toml", content: '[tool.poetry]\nname = "d"\n\n[tool.poetry.dependencies]\npython = "^3.12"\nrich = "^13"\n' },
  ]);
  assert.deepEqual(cargo.dependencies.map((d) => `${d.name}@${d.version}`), ["sha2@0.10", "serde@1"]);
  assert.deepEqual(pipfile.dependencies.map((d) => `${d.name}:${d.kind}`), ["requests:prod", "pytest:dev"]);
  assert.deepEqual(pubspec.dependencies.map((d) => d.name), ["http", "flutter"]);
  assert.deepEqual(poetry.dependencies.map((d) => d.name), ["rich"]);
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
    "VERSION": "1.2.3\n",
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
