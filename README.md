# Storm ⚡

A local game library manager for Windows 10 — a Steam-style poster wall that
remembers every game you own, where it lives, and how long you played it.

Everything stays on your machine. There is no account, no sync, and no network
call: your library is a single JSON file next to your posters.

![Stack](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)
![Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Stack](https://img.shields.io/badge/TypeScript-5.4A4F7?logo=typescript&logoColor=white)

---

## What it does

**The wall.** Every game you own as a poster, laid out like a Steam library.
Hover to lift the poster, zoom the artwork and reveal the quick actions. Click
it to open a full detail page with the wallpaper as a cinematic backdrop.

**Never lose a game again.** Set the install folder once. When you delete the
folder after finishing a game, Storm notices *while it is running* — the badge
flips from **Installed** to **Not installed** and the poster desaturates. You
keep the record of the game even after the files are gone.

**Real playtime.** Press *Play* in Storm and it launches the `.exe`, watches the
process, and accumulates genuine play time, session count and a last-played
date. Your library becomes an actual gaming log, not a folder of shortcuts.

**Everything about a game in one place.** Cover art, wallpaper, executable
path, install location, save location, tags and notes.

**Private shelf.** Some games are yours alone. Hide one and it leaves the wall
completely — no poster, no count, no mention in search. When you are on your
own, open the private shelf to find it again and bring it back.

**Bilingual.** English and Simplified Chinese, switchable in Settings.

---

## Feature tour

| | |
|---|---|
| **Poster wall** | Responsive grid, per-game hover animations, staggered entrance, shared-element transition into the detail page |
| **Live install detection** | `fs.watch` on the parent folder plus a polling safety net — the badge updates the moment you delete a game |
| **Playtime tracking** | Process tracking with a Windows fallback for launchers that spawn and exit immediately |
| **Add / edit / delete** | Native file pickers for `.exe`, install folder and save folder; posters and wallpapers are copied into the library |
| **Filters & search** | All · Installed · Not installed · Played · Unplayed · Favorites, with live search across title, tags and notes |
| **Hidden games** | A private shelf: hidden games leave the wall, the counts and the search results, and only come back when you unhide them |
| **Sorting** | Title, date added, last played, playtime, sessions |
| **Detail page** | Wallpaper backdrop, path rows with reveal-in-folder and copy, tags, notes, install status |
| **Settings** | Language, accent colour, poster size, tray behaviour, detection interval, motion reduction, JSON import/export |
| **System tray** | Minimise to tray, live accent-coloured icon, quick access |

---

## Running it

```bash
npm install          # dependencies
npm run dev          # hot-reloading development build
npm run typecheck    # TypeScript, no emit
npm run build        # compile main / preload / renderer into out/
npm run seed         # fill the library with demo games (development)
npm run icon         # regenerate build/icon.ico
```

### Building the Windows installer

```bash
npm run dist         # -> release/Storm-1.0.0-Setup.exe  (installer)
npm run dist:zip     # -> release/Storm-1.0.0-Setup.zip  (portable folder)
npm run dist:app     # -> release/win-unpacked/          (unpacked app)
```

`npm run dist` produces an NSIS installer with a Simplified-Chinese UI: a
welcome page, a folder picker, desktop and Start-menu shortcuts, a proper
*Programs and Features* entry, and an uninstaller. It installs per-user, so no
UAC prompt and no administrator rights are needed.

> **Why not `electron-builder --win`?**
> electron-builder's own NSIS target builds the uninstaller and then *runs* it
> under `wine` to materialise it before embedding it — so it fails on Linux
> with `spawn wine ENOENT`. `scripts/build-installer.mjs` drives `makensis`
> directly instead, which produces a complete installer (and a native
> uninstaller) on any host, Windows or Linux. Change the version in
> `package.json` before each release.

### Development helpers

Two environment variables make the app easy to drive while working on it:

```bash
STORM_VIEW=game STORM_VIEW_ARG="Elden Ring"   # open a game's detail page
STORM_VIEW=form                               # open the add-game form
STORM_VIEW=settings                           # open settings
STORM_VIEW=launch STORM_VIEW_ARG="Elden Ring" # launch a game
STORM_SCREENSHOT=/tmp/shot.png                # capture the window, then exit
```

The renderer also understands a plain deep link, which is handy for testing:
`app://storm/index.html?game=<title>`.

---

## How your data is stored

Everything lives in Electron's user-data folder:

```
%APPDATA%/storm/
├── library.json      # your games, settings and play history
├── covers/           # poster images
└── banners/          # wallpaper images
```

- `library.json` is written atomically (temp file + rename), so a crash can
  never leave you with a half-written library.
- Posters and wallpapers are **copied** into Storm. Moving or deleting the
  original file will not break anything.
- **Settings → Export** writes a portable JSON copy you can keep or move to
  another machine; **Import** restores one.

---

## How the live install detection works

Two independent mechanisms, because either one alone has blind spots:

1. **Folder watching.** Storm watches the *parent* directory of each install
   path — one watcher per parent, not per game — and reacts to renames and
   deletions. Catching the folder vanishing is instant.
2. **Polling.** Every N seconds (default 10, configurable) Storm stats each
   install path. This catches anything the watcher missed: network drives, very
   deep paths, or a missed rename event.

If you have neither an install folder nor an executable set, the game is
simply treated as *not installed*.

---

## Project layout

```
src/
├── main/            Electron main process
│   ├── index.ts     window, tray, protocols, app lifecycle
│   ├── ipc.ts       every IPC handler
│   ├── store.ts     JSON persistence (atomic writes)
│   ├── watcher.ts   live install-folder detection
│   ├── launcher.ts  process launching + playtime tracking
│   ├── media.ts     poster / wallpaper import and serving
│   ├── tray.ts      system-tray icon and menu
│   ├── png.ts       tiny PNG encoder for the app & tray icons
│   └── icons.ts     runtime-generated bolt icon
├── preload/         contextBridge API (whitelisted channels only)
├── renderer/        React UI
│   ├── components/  sidebar, wall, cards, detail, form, settings
│   ├── styles/      design tokens and per-area stylesheets
│   ├── store/       zustand state
│   └── utils/       formatting and selectors
├── shared/          types, IPC contract, translations, icon renderer
└── scripts/         demo-data seeder, icon generator, NSIS installer builder
```

### Two custom protocols

| Scheme | Serves | Why |
|---|---|---|
| `app://storm/` | the built renderer | A real origin, so the production CSP can be strict (`script-src 'self'`) and ES modules load without `file://` restrictions. |
| `storm://asset/` | posters and wallpapers | The renderer can read Storm's media folders and nothing else — path traversal is rejected. |

The packaged app runs with `sandbox: true`, `contextIsolation: true` and
`nodeIntegration: false`, behind a strict Content-Security-Policy.

---

## Notes

- Runs on Windows 10 and 11. Developed and tested on Linux as well.
- The renderer runs with `contextIsolation` on and `nodeIntegration` off; the
  preload bridge exposes a fixed, typed set of calls and nothing else.
- Posters are served over a custom `storm://` protocol that only ever reads
  from Storm's own media folders — the renderer cannot reach arbitrary files.
- **Reduce motion** (Settings, or your OS setting) disables the ambient
  animation and all transitions.
