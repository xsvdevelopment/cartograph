import { extname, basename } from "./ignore.ts";

const EXT_LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  cts: "TypeScript",
  mts: "TypeScript",
  py: "Python",
  pyi: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  cs: "C#",
  fs: "F#",
  scala: "Scala",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  m: "Objective-C",
  mm: "Objective-C",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  elm: "Elm",
  clj: "Clojure",
  cljs: "Clojure",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  json: "JSON",
  jsonc: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  md: "Markdown",
  mdx: "MDX",
  rst: "reStructuredText",
  sql: "SQL",
  graphql: "GraphQL",
  gql: "GraphQL",
  proto: "Protobuf",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  ps1: "PowerShell",
  bat: "Batch",
  dockerfile: "Dockerfile",
  makefile: "Make",
  cmake: "CMake",
  gradle: "Gradle",
  tf: "Terraform",
  hcl: "HCL",
  nix: "Nix",
  zig: "Zig",
  nim: "Nim",
  v: "V",
  sol: "Solidity",
  wasm: "WebAssembly",
  svg: "SVG",
  csv: "CSV",
  tsv: "CSV",
  txt: "Text",
  env: "Env",
  prisma: "Prisma",
  lock: "Lockfile",
  log: "Log",
  gltf: "glTF",
};

const BASENAME_LANG: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Make",
  "cmakelists.txt": "CMake",
  gemfile: "Ruby",
  rakefile: "Ruby",
  podfile: "Ruby",
  "vagrantfile": "Ruby",
  procfile: "Procfile",
  brewfile: "Ruby",
  "cargo.toml": "TOML",
  "go.mod": "Go",
  "go.sum": "Go",
  pipfile: "TOML",
  "pyproject.toml": "TOML",
  "package.json": "JSON",
  "tsconfig.json": "JSON",
  "composer.json": "JSON",
  "pubspec.yaml": "YAML",
  "pnpm-workspace.yaml": "YAML",
};

export function languageOf(path: string): string {
  const base = basename(path).toLowerCase();
  if (BASENAME_LANG[base]) return BASENAME_LANG[base];
  const ext = extname(path);
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  if (IMAGE_EXT.has(ext)) return "Image";
  if (MODEL_EXT.has(ext) || /^blend\d+$/.test(ext)) return "3D model";
  if (base.startsWith(".env")) return "Env";
  if (base.endsWith("file") && !base.includes(".")) return "Config";
  if (!ext && base.startsWith(".")) return "Config";
  if (TEXT_BASENAMES.has(base)) return "Text";
  return "Other";
}

const SHEBANG_LANG: [RegExp, string][] = [
  [/python/, "Python"],
  [/\b(node|deno|bun)\b/, "JavaScript"],
  [/\b(bash|sh|zsh|dash|ksh|fish)\b/, "Shell"],
  [/ruby/, "Ruby"],
  [/perl/, "Perl"],
  [/\bphp\b/, "PHP"],
];

/** The language named by a `#!` line, for scripts with no extension. */
export function shebangLanguage(content: string | undefined): string | undefined {
  if (!content?.startsWith("#!")) return undefined;
  const line = content.slice(0, content.indexOf("\n") >>> 0).toLowerCase();
  return SHEBANG_LANG.find(([re]) => re.test(line))?.[1] ?? "Shell";
}

const TEXT_BASENAMES =new Set(["license", "copying", "authors", "changelog", "notice", "readme"]);

export function isProbablyText(path: string, language: string): boolean {
  if (language === "Image" || language === "3D model") return false;
  if (language === "Other") {
    const ext = extname(path);
    if (!ext) {
      const base = basename(path).toLowerCase();
      return (
        base.startsWith(".") ||
        [
          "makefile",
          "dockerfile",
          "gemfile",
          "procfile",
          "license",
          "copying",
          "authors",
          "changelog",
          "rakefile",
        ].includes(base)
      );
    }
    return false;
  }
  return true;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "avif", "heic"]);
const MODEL_EXT = new Set(["glb", "fbx", "blend", "stl", "3ds", "dae", "usdz", "vox"]);

export function roleOf(path: string): string {
  const p = path.toLowerCase();
  const base = basename(p);
  if (base.startsWith("readme")) return "overview";
  if (base.startsWith("license") || base === "copying") return "license";
  if (base.includes("changelog")) return "changelog";
  // Prose is docs wherever it sits; a design doc in specs/ is not a test.
  if (/\.(md|mdx|rst|adoc)$/.test(base)) return "docs";
  if (!base.slice(1).includes(".") && base.startsWith(".")) return "config";
  if (
    /(^|\/)(test|tests|__tests__|spec|specs)\//.test(p) ||
    /\.(test|spec)\./.test(base)
  ) {
    return "test";
  }
  if (/(^|\/)(stories|__stories__)\//.test(p) || /\.stories\./.test(base)) {
    return "story";
  }
  if (
    [
      "package.json",
      "pyproject.toml",
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
    ].includes(base)
  ) {
    return "manifest";
  }
  if (base.endsWith("lock") || base.endsWith("lock.json") || base.endsWith("lock.yaml") || base.endsWith("lockb")) {
    return "lockfile";
  }
  if (/(^|\/)(migrations?)\//.test(p)) return "migration";
  if (/(^|\/)(components?|ui)\//.test(p)) return "ui";
  if (/(^|\/)(pages?|views|screens|routes)\//.test(p)) return "route";
  if (/(^|\/)(api|server|backend|services?)\//.test(p)) return "service";
  if (/(^|\/)(lib|utils?|helpers?|shared)\//.test(p)) return "lib";
  if (/(^|\/)(hooks?)\//.test(p)) return "hook";
  if (/(^|\/)(store|state|redux|atoms)\//.test(p)) return "state";
  if (/(^|\/)(types?|typings|@types)\//.test(p) || /\.d\.ts$/.test(base)) return "types";
  if (/(^|\/)(config|configs?|\.config)\//.test(p) || /config\.(ts|js|mjs|cjs|json)$/.test(base)) {
    return "config";
  }
  if (/(^|\/)(docs?|documentation)\//.test(p)) return "docs";
  if (/(^|\/)(scripts?|bin|tools)\//.test(p)) return "script";
  if (/(^|\/)(assets?|static|public|images?|media)\//.test(p)) return "asset";
  if (/\.(css|scss|sass|less)$/.test(base)) return "style";
  return "source";
}
