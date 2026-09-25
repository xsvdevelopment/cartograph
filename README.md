# Cartograph

Coding agents start most tasks by exploring the repo: list the root, list `src`, glob for `*.ts`, open three files
to find the one that matters. Every session pays for that walk again, in tokens and in time.

Cartograph does the walk once. Point it at a project and it writes one markdown file, `<project>.cartograph.md`,
holding the directory tree, the dependency tree, a language breakdown and the functions and classes in each file.
Add one rule to `CLAUDE.md` (or `AGENTS.md`, or a Cursor rule) and the agent searches the map first, then opens the
one file it needs.

On Cartograph's own source, the default map is about 93% smaller than pasting the code.

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
- Lockfiles, binaries, images and fonts are listed but not read.

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
F# and Swift.

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
