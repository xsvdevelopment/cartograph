# Cartograph

Coding agents start most tasks by exploring the repo: list the root, list `src`, glob for `*.ts`, open three files
to find the one that matters. Every session pays for that walk again, in tokens and in time.

Cartograph does the walk once. Point it at a project and it writes one markdown file, `<project>.cartograph.md`,
holding what an agent otherwise has to dig for: where the program starts, the commands that build, test and run it,
the files everything else imports, the folder tree, the dependency tree, and for each file its functions and classes
and the one line it says about itself.
Add one rule to `CLAUDE.md` (or `AGENTS.md`, or a Cursor rule) and the agent searches the map first, then opens the
one file it needs.

On Cartograph's own source, the default map is over 90% smaller than pasting the code.

## Install

Cartograph runs on Windows 10 and 11 (64-bit). Download one of these from the
[release page](https://github.com/xsvdevelopment/cartograph/releases):

- `Cartograph-Setup-<version>.exe` installs Cartograph for your user account, with a Start menu shortcut.
- `Cartograph-<version>-portable.exe` is the whole app in one file. Run it from anywhere.

The builds aren't code-signed yet, so Windows SmartScreen may show "Windows protected your PC" the first time.
Choose **More info**, then **Run anyway**. Cartograph uses Microsoft Edge WebView2, which Windows 10 and 11 already
include.

## Using it

1. **Choose folder**, **Choose zip**, or drop either onto the window. The app opens on a sample, which is
   Cartograph's own source code.
2. **Pick a depth.**
   - **Map**: files, folders, dependencies and languages. The smallest.
   - **Skeleton**: adds the functions, classes and exports in each file. The default, and usually the right one.
   - **Contents**: adds the source itself. Only worth it for small projects you want an agent to read end to end.
3. **Pick a format.** Markdown reads well for people and agents. Compact drops the formatting to save tokens.
4. **Download map** and save it in the root of the project you scanned.
5. **Add to CLAUDE.md** picks the project folder and adds the agent rule to the end of its `CLAUDE.md`, creating the
   file if there isn't one. Or copy the rule from the Agents tab and paste it wherever your agent reads its
   instructions.

Rescan whenever the project changes shape. The map is a snapshot, not a live view.

## What it skips

- Folders nobody wants mapped: `node_modules`, `.git`, `dist`, `build`, `target`, `.venv`, `__pycache__`, caches and
  the like. They are named in the map with a file count, but never opened.
- Anything your `.gitignore` files exclude. A nested `.gitignore` only applies inside its own folder, as in git.
- Anything listed under **Also skip**, one gitignore-style pattern per line.
- Secrets (`.env`, `.env.local`, keys, certificates, `.npmrc`) are listed by name so the agent knows they exist.
  Their contents are never read. Templates like `.env.example` are read as normal.
- Lockfiles, binaries, images and fonts are listed but not read. A folder with five or more images or 3D models
  gets one summary line, like `sprites/ · 412 images (png)`, instead of one line per file. So does a folder with
  twenty or more data files of one kind, such as cached JSON responses.
- In a Unity project, the `.meta` files and the `Library`, `Temp`, `Logs`, `Obj` and `UserSettings` folders.
- Working folders that coding agents leave behind: `.superpowers`, `.remember`, `.playwright-mcp`.

## What the map holds

- **Quick find**: the folder to open for source, UI, routes, services, tests, scripts and docs.
- **Entry points**: the file a manifest names as its main, the script a `start` command runs, the page a browser
  loads and the script that page loads, Python console scripts, batch files at the top of the project, and files
  that declare a main themselves.
- **Commands**: `package.json`, `deno.json` and `composer.json` scripts and Makefile or justfile targets, with the
  package manager the lockfile implies, plus the standard commands for Cargo, Go, Gradle and .NET projects.
- **Most imported**: the files the most other files import, so a change to one is made knowingly. Each file in the
  index also carries its own "used by" count. Imports are followed in JavaScript, TypeScript, Python, Java, Kotlin,
  Rust, Dart, C-family includes, stylesheets, the scripts and stylesheets an HTML page loads, and the scripts a
  PowerShell or batch file runs. C# and Go name a namespace or a package, not a file, so there a file counts as used
  when another mentions a type or package-level name it declares.
- **Directory tree**: folders only, with the number of listed files under each.
- **Languages** and **Dependency tree**.
- **File index**: every file with its language, line count, role, symbols and its opening comment or first heading.

## What it writes

Cartograph never changes the project you scan. It writes exactly two things, both only when you click a button and
confirm a native Save or folder dialog:

- the map file, wherever you save it;
- the agent rule, added to the end of a `CLAUDE.md`. Existing text is never touched, the file keeps its line endings,
  and if the rule is already there nothing is written.

No network access, no telemetry. Fonts are bundled.

## Supported manifests

npm (`package.json`, `pnpm-workspace.yaml`), Python (`pyproject.toml`, `requirements*.txt`, `Pipfile`), Cargo, Go,
Ruby (`Gemfile`), PHP (`composer.json`), Dart (`pubspec.yaml`), Maven, Gradle, Elixir (`mix.exs`) and .NET
(`.csproj`, `.fsproj`). Symbols are extracted for TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, C#,
F# and Swift, plus shell scripts, PowerShell functions, batch file labels and extensionless scripts identified by their
`#!` line.

## Development

Needs Node 22+ and, for the desktop app, Rust with the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run dev        # the app in a browser at http://localhost:5173
npm run desktop    # the desktop app with hot reload
npm test           # scanner tests
npm run typecheck
npm run lint
npm run dist       # src-tauri/target/release/cartograph.exe and the NSIS installer
```

`npm run dev` works in any Chromium browser. Download map falls back to a normal download there, and Add to CLAUDE.md
only appears in the desktop app.

Layout: `src/lib/scan` is the scanner (pure TypeScript, no DOM: ignore rules, manifest parsers, symbol extraction,
markdown rendering), `src/components` is the React UI, and `src-tauri` is the desktop shell, whose only native code is
the two Save commands in `src-tauri/src/lib.rs`.

## License

MIT. See [LICENSE](LICENSE).

Built by XSV Development, with help from Claude.
