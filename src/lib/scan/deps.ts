import { basename } from "./ignore.ts";
import type { DepKind, DepManifest, DepNode, Ecosystem, WorkspaceLink } from "./types.ts";

const MANIFEST_BASENAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "lerna.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "pipfile",
  "environment.yml",
  "environment.yaml",
  "cargo.toml",
  "go.mod",
  "gemfile",
  "composer.json",
  "pubspec.yaml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "mix.exs",
  "package.swift",
]);

/** JS regex has no `\Z`; under the `m` flag this is the true end of the text. */
const END_OF_INPUT = "$(?![\\s\\S])";

export function isManifestPath(path: string): boolean {
  const base = basename(path).toLowerCase();
  if (MANIFEST_BASENAMES.has(base)) return true;
  return base.endsWith(".csproj") || base.endsWith(".fsproj");
}

export function parseManifests(files: { path: string; content?: string }[]): DepManifest[] {
  const out: DepManifest[] = [];
  for (const file of files) {
    if (!file.content || !isManifestPath(file.path)) continue;
    const parsed = parseOne(file.path, file.content);
    if (parsed) out.push(parsed);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function parseOne(path: string, content: string): DepManifest | null {
  const base = basename(path).toLowerCase();
  try {
    if (base === "package.json") return parsePackageJson(path, content);
    if (base === "pnpm-workspace.yaml") return parsePnpmWorkspace(path, content);
    if (base === "pyproject.toml") return parsePyproject(path, content);
    if (base === "requirements.txt" || base === "requirements-dev.txt") {
      return parseRequirements(path, content);
    }
    if (base === "pipfile") return parsePipfile(path, content);
    if (base === "cargo.toml") return parseCargo(path, content);
    if (base === "go.mod") return parseGoMod(path, content);
    if (base === "gemfile") return parseGemfile(path, content);
    if (base === "composer.json") return parseComposer(path, content);
    if (base === "pubspec.yaml") return parsePubspec(path, content);
    if (base === "pom.xml") return parsePom(path, content);
    if (base === "build.gradle" || base === "build.gradle.kts") {
      return parseGradle(path, content);
    }
    if (base === "mix.exs") return parseMix(path, content);
    if (base.endsWith(".csproj") || base.endsWith(".fsproj")) {
      return parseCsproj(path, content);
    }
  } catch {
    return {
      path,
      ecosystem: guessEcosystem(base),
      dependencies: [],
    };
  }
  return null;
}

function guessEcosystem(base: string): Ecosystem {
  if (base.includes("package") || base.includes("pnpm") || base.includes("lerna")) {
    return "npm";
  }
  if (base.includes("pyproject") || base.includes("requirements") || base === "pipfile") {
    return "python";
  }
  if (base.includes("cargo")) return "cargo";
  if (base === "go.mod") return "go";
  if (base === "gemfile") return "ruby";
  if (base.includes("composer")) return "php";
  if (base.includes("pubspec")) return "dart";
  if (base.includes("pom")) return "maven";
  if (base.includes("gradle")) return "gradle";
  if (base.includes("mix")) return "elixir";
  if (base.endsWith("csproj") || base.endsWith("fsproj")) return "dotnet";
  return "npm";
}

function dep(name: string, version: string, kind: DepKind): DepNode {
  return { name, version: version || "*", kind };
}

function parsePackageJson(path: string, content: string): DepManifest {
  const json = JSON.parse(content) as {
    name?: string;
    version?: string;
    workspaces?: string[] | { packages?: string[] };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const dependencies: DepNode[] = [];
  const push = (rec: Record<string, string> | undefined, kind: DepKind) => {
    if (!rec) return;
    for (const [name, version] of Object.entries(rec)) {
      dependencies.push(dep(name, String(version), kind));
    }
  };
  push(json.dependencies, "prod");
  push(json.optionalDependencies, "optional");
  push(json.peerDependencies, "peer");
  push(json.devDependencies, "dev");
  const workspaces = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages;
  return {
    path,
    ecosystem: "npm",
    name: json.name,
    version: json.version,
    workspaces,
    dependencies,
  };
}

function parsePnpmWorkspace(path: string, content: string): DepManifest {
  const packages: string[] = [];
  const lines = content.split(/\r?\n/);
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = line.match(/^\s*-\s+['"]?([^'"#]+)['"]?/);
      if (m?.[1]) packages.push(m[1].trim());
      else if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) {
        inPackages = false;
      }
    }
  }
  return { path, ecosystem: "npm", workspaces: packages, dependencies: [] };
}

function parsePyproject(path: string, content: string): DepManifest {
  const name = matchTomlString(content, "name") ?? sectionKv(content, "tool.poetry", "name");
  const version =
    matchTomlString(content, "version") ?? sectionKv(content, "tool.poetry", "version");
  const dependencies: DepNode[] = [];

  const projectDeps = tomlArray(content, "dependencies");
  for (const item of projectDeps) {
    const parsed = parsePep508(item);
    if (parsed) dependencies.push(dep(parsed.name, parsed.version, "prod"));
  }

  const poetryProd = tomlTableKeys(content, "tool.poetry.dependencies");
  for (const [k, v] of poetryProd) {
    if (k === "python") continue;
    dependencies.push(dep(k, v, "prod"));
  }
  const poetryDev = tomlTableKeys(content, "tool.poetry.group.dev.dependencies");
  for (const [k, v] of poetryDev) dependencies.push(dep(k, v, "dev"));

  const optional = tomlTableKeys(content, "project.optional-dependencies");
  for (const [k] of optional) {
    // values are arrays; skip detailed parse
    if (k) dependencies.push(dep(k, "optional-extra", "optional"));
  }

  return {
    path,
    ecosystem: "python",
    name: name ?? undefined,
    version: version ?? undefined,
    dependencies,
  };
}

function parseRequirements(path: string, content: string): DepManifest {
  const dependencies: DepNode[] = [];
  const kind: DepKind = basename(path).includes("dev") ? "dev" : "prod";
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const parsed = parsePep508(line);
    if (parsed) dependencies.push(dep(parsed.name, parsed.version, kind));
  }
  return { path, ecosystem: "python", dependencies };
}

function parsePipfile(path: string, content: string): DepManifest {
  const dependencies: DepNode[] = [];
  for (const [k, v] of tomlTableKeys(content, "packages")) {
    dependencies.push(dep(k, v, "prod"));
  }
  for (const [k, v] of tomlTableKeys(content, "dev-packages")) {
    dependencies.push(dep(k, v, "dev"));
  }
  return { path, ecosystem: "python", dependencies };
}

function parseCargo(path: string, content: string): DepManifest {
  const name = sectionKv(content, "package", "name");
  const version = sectionKv(content, "package", "version");
  const dependencies: DepNode[] = [];
  for (const [k, v] of tomlTableKeys(content, "dependencies")) {
    dependencies.push(dep(k, v, "prod"));
  }
  for (const [k, v] of tomlTableKeys(content, "dev-dependencies")) {
    dependencies.push(dep(k, v, "dev"));
  }
  const members = tomlArray(content, "members");
  return {
    path,
    ecosystem: "cargo",
    name: name ?? undefined,
    version: version ?? undefined,
    workspaces: members.length ? members : undefined,
    dependencies,
  };
}

function parseGoMod(path: string, content: string): DepManifest {
  const mod = content.match(/^module\s+(\S+)/m)?.[1];
  const dependencies: DepNode[] = [];
  const requireRe = /require\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(content))) {
    if (m[1] === "(") continue;
    dependencies.push(dep(m[1], m[2], "prod"));
  }
  const block = content.match(/require\s*\(([\s\S]*?)\)/);
  if (block?.[1]) {
    for (const line of block[1].split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("//")) continue;
      const parts = t.split(/\s+/);
      if (parts[0] && parts[1]) dependencies.push(dep(parts[0], parts[1], "prod"));
    }
  }
  // dedupe
  const seen = new Set<string>();
  const unique = dependencies.filter((d) => {
    const k = `${d.name}@${d.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { path, ecosystem: "go", name: mod, dependencies: unique };
}

function parseGemfile(path: string, content: string): DepManifest {
  const dependencies: DepNode[] = [];
  const re = /gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    dependencies.push(dep(m[1], m[2] ?? "*", "prod"));
  }
  return { path, ecosystem: "ruby", dependencies };
}

function parseComposer(path: string, content: string): DepManifest {
  const json = JSON.parse(content) as {
    name?: string;
    require?: Record<string, string>;
    "require-dev"?: Record<string, string>;
  };
  const dependencies: DepNode[] = [];
  for (const [k, v] of Object.entries(json.require ?? {})) {
    if (k === "php") continue;
    dependencies.push(dep(k, v, "prod"));
  }
  for (const [k, v] of Object.entries(json["require-dev"] ?? {})) {
    dependencies.push(dep(k, v, "dev"));
  }
  return { path, ecosystem: "php", name: json.name, dependencies };
}

function parsePubspec(path: string, content: string): DepManifest {
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const version = content.match(/^version:\s*(.+)$/m)?.[1]?.trim();
  const dependencies: DepNode[] = [];
  const grab = (section: string, kind: DepKind) => {
    const block = content.match(
      new RegExp(`^${section}:\\s*\\n([\\s\\S]*?)(?=^\\w|${END_OF_INPUT})`, "m"),
    );
    if (!block?.[1]) return;
    for (const line of block[1].split(/\r?\n/)) {
      const m = line.match(/^\s{2}(\S+):\s*(.*)$/);
      if (m && m[1] !== "sdk") dependencies.push(dep(m[1], m[2].trim() || "*", kind));
    }
  };
  grab("dependencies", "prod");
  grab("dev_dependencies", "dev");
  return { path, ecosystem: "dart", name, version, dependencies };
}

function parsePom(path: string, content: string): DepManifest {
  const dependencies: DepNode[] = [];
  const re =
    /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    dependencies.push(dep(`${m[1]}:${m[2]}`, m[3] ?? "*", "prod"));
  }
  const art = content.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
  const ver = content.match(/<version>([^<]+)<\/version>/)?.[1];
  return { path, ecosystem: "maven", name: art, version: ver, dependencies };
}

function parseGradle(path: string, content: string): DepManifest {
  const dependencies: DepNode[] = [];
  const re =
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt)\s*\(?\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const kind: DepKind = m[0].includes("test") ? "dev" : "prod";
    dependencies.push(dep(m[1], "*", kind));
  }
  return { path, ecosystem: "gradle", dependencies };
}

function parseMix(path: string, content: string): DepManifest {
  const name = content.match(/app:\s*:(\w+)/)?.[1];
  const dependencies: DepNode[] = [];
  const re = /\{:(\w+)\s*,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    dependencies.push(dep(m[1], m[2], "prod"));
  }
  return { path, ecosystem: "elixir", name, dependencies };
}

function parseCsproj(path: string, content: string): DepManifest {
  const dependencies: DepNode[] = [];
  const re = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    dependencies.push(dep(m[1], m[2] ?? "*", "prod"));
  }
  return {
    path,
    ecosystem: "dotnet",
    name: basename(path).replace(/\.(cs|fs)proj$/i, ""),
    dependencies,
  };
}

function parsePep508(spec: string): { name: string; version: string } | null {
  const cleaned = spec.split(/[;#]/)[0]?.trim() ?? "";
  if (!cleaned) return null;
  const m = cleaned.match(/^([A-Za-z0-9_.-]+)\s*(.*)$/);
  if (!m) return null;
  const version = (m[2] ?? "").replace(/\s+/g, " ").trim() || "*";
  return { name: m[1], version };
}

function matchTomlString(content: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m");
  return content.match(re)?.[1] ?? null;
}

function sectionKv(content: string, section: string, key: string): string | null {
  const table = extractTomlTable(content, section);
  if (!table) return null;
  const re = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m");
  return table.match(re)?.[1] ?? null;
}

function tomlArray(content: string, key: string): string[] {
  const inline = content.match(new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!inline) return [];
  return [...inline[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

function tomlTableKeys(content: string, section: string): [string, string][] {
  const table = extractTomlTable(content, section);
  if (!table) return [];
  const out: [string, string][] = [];
  for (const line of table.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!m) continue;
    const raw = m[2].trim();
    const str = raw.match(/^"([^"]+)"/)?.[1];
    const ver = str ?? raw.replace(/[{}]/g, "").match(/version\s*=\s*"([^"]+)"/)?.[1] ?? raw;
    out.push([m[1], ver]);
  }
  return out;
}

function extractTomlTable(content: string, section: string): string | null {
  const re = new RegExp(
    `^\\[${section.replace(/\./g, "\\.")}\\]\\s*$([\\s\\S]*?)(?=^\\[|${END_OF_INPUT})`,
    "m",
  );
  return content.match(re)?.[1] ?? null;
}

export function workspaceLinks(manifests: DepManifest[]): WorkspaceLink[] {
  const named = manifests.filter((m) => m.name);
  const names = new Set(named.map((m) => m.name as string));
  const links: WorkspaceLink[] = [];
  for (const m of named) {
    for (const d of m.dependencies) {
      if (names.has(d.name) && d.name !== m.name) {
        links.push({ from: m.name as string, to: d.name });
      }
    }
  }
  return links;
}

export function renderDepTree(manifest: DepManifest, compact = false): string {
  const title = [
    manifest.ecosystem,
    manifest.name ? manifest.name + (manifest.version ? `@${manifest.version}` : "") : null,
    compact ? null : `· ${manifest.path}`,
  ]
    .filter(Boolean)
    .join(" ");

  if (compact) {
    const prod = manifest.dependencies.filter((d) => d.kind === "prod");
    const rest = manifest.dependencies.filter((d) => d.kind !== "prod");
    const fmt = (d: DepNode) =>
      d.version && d.version !== "*" ? `${d.name}@${shortVer(d.version)}` : d.name;
    const bits = [title];
    if (prod.length) bits.push(prod.map(fmt).join(" "));
    if (rest.length) {
      bits.push("dev " + rest.map(fmt).join(" "));
    }
    return bits.join("\n  ");
  }

  const lines = [`${title}`];
  const groups: { label: string; kind: DepKind }[] = [
    { label: "prod", kind: "prod" },
    { label: "peer", kind: "peer" },
    { label: "optional", kind: "optional" },
    { label: "dev", kind: "dev" },
  ];
  for (const g of groups) {
    const deps = manifest.dependencies.filter((d) => d.kind === g.kind);
    if (!deps.length) continue;
    if (g.kind !== "prod") {
      // What ships is a tree; tooling is one line, since nobody reads thirty dev dependencies down a column.
      lines.push(`  ${g.label}: ${deps.map((d) => `${d.name} ${d.version}`).join(", ")}`);
      continue;
    }
    deps.forEach((d, i) => {
      const last = i === deps.length - 1;
      const branch = last ? "└──" : "├──";
      lines.push(`  ${branch} ${d.name}  ${d.version}`);
    });
  }
  if (manifest.workspaces?.length) {
    lines.push(`  workspaces: ${manifest.workspaces.join(", ")}`);
  }
  if (!manifest.dependencies.length && !manifest.workspaces?.length) {
    lines.push("  (no dependencies listed)");
  }
  return lines.join("\n");
}

function shortVer(v: string): string {
  return v.replace(/^workspace:/, "ws:").replace(/^file:/, "file:");
}

export function renderMermaidGraph(manifests: DepManifest[], links: WorkspaceLink[]): string {
  const pkgNodes = manifests.filter((m) => m.name);
  if (!pkgNodes.length && !links.length) return "";
  const id = (name: string) => "n_" + name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  const lines = ["graph LR"];
  const seen = new Set<string>();
  for (const m of pkgNodes) {
    const n = m.name as string;
    if (seen.has(n)) continue;
    seen.add(n);
    lines.push(`  ${id(n)}["${n}"]`);
  }
  for (const link of links) {
    lines.push(`  ${id(link.from)} --> ${id(link.to)}`);
  }
  if (links.length === 0 && pkgNodes.length > 1) {
    const root = pkgNodes.find((m) => m.workspaces?.length) ?? pkgNodes[0];
    for (const m of pkgNodes) {
      if (m.name && m.name !== root.name) {
        lines.push(`  ${id(root.name as string)} --> ${id(m.name)}`);
      }
    }
  }
  const externals: { from: string; to: string }[] = [];
  for (const m of pkgNodes) {
    if (!m.name) continue;
    for (const d of m.dependencies) {
      if (d.kind !== "prod") continue;
      if (seen.has(d.name)) continue;
      externals.push({ from: m.name, to: d.name });
    }
  }
  const cap = 24;
  externals.slice(0, cap).forEach((e, i) => {
    const eid = `e_${i}_${e.to.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 24)}`;
    lines.push(`  ${eid}["${e.to}"]`);
    lines.push(`  ${id(e.from)} --> ${eid}`);
  });
  if (externals.length > cap) {
    lines.push(`  more["+${externals.length - cap} more"]`);
  }
  return lines.join("\n");
}
