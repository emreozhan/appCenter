# App Center

A Windows desktop dashboard (Electron) that finds all the small projects living under one or more folders, figures out how to install, build and run each of them, and lets you start, stop, build and commit them from a single window.

It was built for a folder full of AI-generated side projects, each with its own stack and its own commands that are hard to remember.

> The user interface is currently in Turkish.

## Features

- **Project discovery** – scans the root folders you choose (up to 3 levels deep) and detects Electron, Vite, Next.js, Tauri, Node.js, Python, .NET/C#, Java (Maven/Gradle), Go, Rust, static HTML and plain `start.cmd`/`build.cmd` projects.
- **Generated commands** – install, build and run commands are derived from each project's own configuration; any of them can be overridden per project.
- **Start / stop** – runs the project in its own folder and stops the whole process tree (`taskkill /T`), so dev servers spawned by `npm run dev` are cleaned up too. Everything is stopped when App Center quits.
- **Live logs** – stdout/stderr of runs, builds, installs and git operations in a log panel.
- **Open in browser** – the first `http://localhost:PORT` printed by a project becomes an "Open" button.
- **Built-in static server** – plain HTML projects are served on a free local port, no extra tooling needed.
- **Git status on every card** – branch, number of changed files, commits ahead/behind, or "no repository".
- **Commit & push** – commit dialog with the list of changed files; optional push afterwards.
- **Organising** – search, filter by status/type, favourites (pinned to the top), collapsible cards, hidden projects, and group cards for nested projects.
- **Launch at login** – optional Windows auto-start.

## Requirements

- Windows 10/11 (process handling uses `cmd.exe` and `taskkill`)
- [Node.js](https://nodejs.org/) with npm (developed and tested with Node.js 22)
- Git on `PATH` – optional, only needed for the git features

## Getting Started

```bash
git clone https://github.com/emreozhan/appCenter.git
cd appCenter
npm install
npm start
```

On the first start the parent folder of the App Center checkout is added as a root folder. Use the **Klasorler** (Folders) button to add or remove root folders.

## Usage

Each detected project gets a card:

| Control | What it does |
| --- | --- |
| ▶ / ■ | Start / stop the project |
| 🔨 Build | Run the build command |
| ⤓ Kur | Run the install command (`npm install`, `pip install -r requirements.txt`, …). A "kurulum gerekli" badge appears when `node_modules` is missing |
| 🌐 Ac | Open the detected local URL |
| ✔ Commit / ⇡ Push | Git commit dialog / push |
| 📄 📁 >_ | Log panel, open folder in Explorer, open a terminal in the folder |
| ⚙ | Override name, install/build/run commands and environment variables. Clearing a field returns to the detected value |
| ☆ | Favourite – favourites are listed first |
| ▾ / ▸ | Collapse the card to a single line (a small ▶/■ button stays visible) |

Keyboard: `Ctrl+F` search, `F5` / `Ctrl+R` rescan, `Esc` close dialogs, `Ctrl+Enter` commit.

### Nested projects

Projects that are not directly under a root folder (for example `tools/light-controller`) are shown together on one group card named after their top-level folder. If that folder has its own `start.cmd`, it appears as the first row of the group instead of as a separate card.

### Git

The badge next to the project name shows:

| Badge | Meaning |
| --- | --- |
| `⎇ main` (green) | Repository, no local changes |
| `⎇ main ±5` (amber) | 5 changed files |
| `↑2` / `↓1` | 2 commits to push / 1 commit behind (as of the last `fetch`; App Center never fetches by itself) |
| `git yok` | Not inside a git repository |

- **Commit** runs `git add -A -- .` and `git commit -- .` in the project folder. The scope is always that folder: for a project inside a parent repository only its own folder is committed, and files staged elsewhere in the repository are left alone.
- **Push** runs `git push`, or `git push -u origin HEAD` when no upstream is set. It is disabled when there is no remote or nothing to push.
- Git is called without a shell and with an argument list, so commit messages are passed verbatim. The commit identity comes from your git configuration.
- Status is refreshed after each scan and when the window regains focus (at most every 15 s), so commits made in a terminal show up too.

## How commands are chosen

For each project, App Center picks the first available option:

1. A command you entered in the project settings (⚙)
2. The project's own configuration – `package.json` scripts (`dev`/`start`, `build`/`dist`), `*.csproj`, `pom.xml` / `build.gradle`, `Cargo.toml`, `go.mod`, a Python entry file (`manage.py`, `app.py`, `main.py`, `serve.py`, …), or an `.exe` next to C# sources
3. A script in the project root: `start.cmd > start.bat > start.ps1 > run.cmd > run.bat > run.ps1` for running, `build.cmd > build.bat > build.ps1` for building
4. A plain guess – `npx vite`, `npx electron .`, `npx next dev`, or the built-in static server for an `index.html`

The detected project type is kept in every case. Folders recognised as a project are not scanned further, except folders that only contain root scripts, whose sub-folders are still searched. `node_modules`, `dist`, `build`, `out`, `target`, `.git`, `venv` and similar folders are skipped.

## Configuration

Settings are stored in `%APPDATA%\app-center\config.json`: root folders, per-project command overrides, hidden projects, favourites, collapsed cards and the scan depth (`maxDepth`, default 3).

"Launch at login" is stored by Windows (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) through Electron's `setLoginItemSettings`. When running from source the entry points to `electron.exe "<app folder>"`, so it keeps working only while `node_modules` is present.

## Development

```bash
npm test        # detection, scanning and git regression tests (node:test)
npm run dist    # Windows installer via electron-builder (NSIS)
```

## Project Structure

```
src/
├── main/                  # Electron main process (file system, processes, git)
│   ├── index.js           # window and app lifecycle
│   ├── config.js          # config.json read/write
│   ├── detector.js        # folder -> project type and commands
│   ├── scanner.js         # walks the root folders, groups nested projects
│   ├── processManager.js  # spawn / kill / logs / state
│   ├── staticServer.js    # built-in HTTP server for static projects
│   ├── git.js             # git status, scoped commit, push
│   ├── startup.js         # launch at login
│   └── ipc/handlers.js    # all ipcMain.handle channels
├── preload/index.js       # narrow API exposed with contextBridge
├── renderer/              # UI (no Node.js access)
└── shared/ipc-channels.js
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never gets the raw `ipcRenderer`; every project id coming from the UI is validated in the main process against the last scan.

## License

[MIT](LICENSE)

---

## Türkçe özet

App Center, verdiğin kök klasörlerdeki projeleri bulan; her biri için kurulum, build ve çalıştırma komutlarını üreten ve hepsini tek pencereden başlatıp durdurmanı sağlayan bir Electron masaüstü uygulamasıdır. Kartlarda git durumu görünür, commit ve push yapılabilir; favoriler, daraltılabilir kartlar ve iç içe projeler için grup kartları vardır. Arayüz Türkçedir.

Kurulum ve çalıştırma: `npm install`, ardından `npm start`. Testler: `npm test`.
