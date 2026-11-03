# Storm ⚡

A local game library manager for Windows 10 — a Steam-style poster wall that
remembers every game you own, where it lives, and how long you played it.

Everything stays on your machine. There is no account, no sync and no
telemetry: your library is a single JSON file next to your posters. The only
time Storm touches the network is when you drop a picture straight out of a
web page onto it — then it downloads that one image.

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
game, and accumulates genuine play time, session count and a last-played
date. A game counts as running while anything started from its folder runs,
so a launcher that hands over to the real game (or a restart through Steam)
is still counted to the end. Your library becomes an actual gaming log, not a
folder of shortcuts.

**Everything about a game in one place.** Cover art, wallpaper, executable
path, install location, save location, tags and notes.

**Private shelf.** Some games are yours alone. Hide one and it leaves the wall
completely — no poster, no count, no mention in search. When you are on your
own, open the private shelf to find it again and bring it back.

**Drag it in.** Drop a game's `.exe` or its desktop shortcut onto the window
and Storm fills in the title (from the shortcut name, the executable's
version info or its folder), the install folder and the launch options. Drop
a whole handful of shortcuts and they are all added at once. Posters work the
same way: drop an image file, drag a picture out of your browser, or copy it
and press **Ctrl+V** in the add-game form. **Find a poster online** under the poster opens a
SteamGridDB search for the game in your browser — drag the one you like back in.

**Screenshots, keyboard or controller.** Press **F12** — or **L3 + R3** on a
controller — while a game launched from Storm is running. The screen is saved
to `Pictures\Storm\<Game>\`, a small card confirms it without taking focus
from the game, and the game's page shows a gallery. Both shortcuts can be
changed (or recorded straight from your controller) in Settings. Storm reads
the keyboard and Xbox-style controllers (XInput) directly, so the shortcuts
work while the game has focus; if a shot fails, the card says so and
`storm.log` in the data folder says why.

**HDR screenshots that look right.** With HDR on, Windows hands ordinary
screen capture a picture cut off at SDR white, so HDR games come out blown
out. Storm reads an HDR screen in full instead (DXGI, in half floats) and
turns it into a normal PNG/JPEG: SDR content — the desktop, SDR games — comes
out exactly as it looked, at whatever "SDR content brightness" Windows is set
to, and an HDR game's highlights are rolled off smoothly (the BT.2390 curve
TVs use) rather than clipped. Screens in SDR are captured as before.

**Themes.** Six themes — Storm, Aurora, Nebula, Synthwave, Ember, Obsidian —
each in a dark and a light version, or following Windows. Pick any accent on
top, including a custom colour.

**Bilingual.** English and Simplified Chinese, switchable in Settings.

---

## Feature tour

| | |
|---|---|
| **Poster wall** | Responsive grid, per-game hover animations, staggered entrance, shared-element transition into the detail page |
| **Live install detection** | `fs.watch` on the parent folder plus a polling safety net — the badge updates the moment you delete a game |
| **Playtime tracking** | Follows every process from the game's folder, so launchers, the games they start and Steam restarts all count |
| **Add / edit / delete** | Native file pickers for `.exe`, install folder and save folder; launch options; posters and wallpapers are copied into the library |
| **Filters & search** | All · Installed · Not installed · Played · Unplayed · Favorites, with live search across title, tags and notes |
| **Hidden games** | A private shelf: hidden games leave the wall, the counts and the search results, and only come back when you unhide them |
| **Sorting** | Title, date added, last played, playtime, sessions |
| **Detail page** | Wallpaper backdrop, path rows with reveal-in-folder and copy, tags, notes, install status |
| **Drag & paste** | Drop `.exe` / `.lnk` files to add games (several at once), drop or paste images for posters and wallpapers |
| **Screenshots** | Global hotkey and controller combo, per-game folders, in-game "saved" card, shutter sound, gallery on the detail page, correct colours on HDR screens |
| **Themes** | Six themes in dark and light, "follow Windows", accent swatches plus a custom colour |
| **Settings** | Language, theme, accent, poster size, screenshot shortcuts, tray behaviour, detection interval, motion reduction, JSON import/export |
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
npm run dist         # -> release/Storm-<version>-Setup.exe  (installer)
npm run dist:zip     # -> release/Storm-<version>-Setup.zip  (portable folder)
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
STORM_VIEW=drop STORM_VIEW_ARG="D:\a.exe|D:\b.lnk" # as if those files were dropped
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
├── banners/          # wallpaper images
├── thumbs/           # previews of your screenshots (the screenshots
│                     #   themselves are in Pictures\Storm)
└── storm.log         # what went wrong out of sight (screenshot shortcuts)
```

- `library.json` is written atomically (temp file + rename), so a crash can
  never leave you with a half-written library. If the file is ever damaged,
  Storm moves it aside as `library.corrupt-<date>.json` instead of
  overwriting it, and tells you where it is.
- Posters and wallpapers are **copied** into Storm. Moving or deleting the
  original file will not break anything.
- **Settings → Export** writes a portable JSON copy (games, settings and play
  history) you can keep or move to another machine; **Import** restores one
  after asking for confirmation. Artwork is not part of the export — games
  whose posters are not on the new machine show a placeholder.
- The uninstaller removes exactly the files it installed and leaves your
  library alone.

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
│   ├── processes.ts running processes and their executables (for tracking)
│   ├── winshell.ts  starting a game through the shell (UAC), like Explorer
│   ├── media.ts     poster / wallpaper import (file, bytes, URL) and serving
│   ├── gamefile.ts  what a dropped .exe / .lnk is: title, folder, arguments
│   ├── pe.ts        reads version info (ProductName…) from executables
│   ├── lnk.ts       reads Windows shortcut files
│   ├── screenshot.ts screenshot hotkey, capture and gallery
│   ├── hdrcapture.ts runs the capture process for HDR screens
│   ├── capture-process.ts that process (an Electron utility process)
│   ├── dxgi.ts      reads an HDR screen through D3D11/DXGI (via koffi)
│   ├── tonemap.ts   HDR frame → SDR picture (BT.2390 roll-off, sRGB)
│   ├── com.ts       calling COM objects through koffi
│   ├── wininput.ts  keyboard and XInput state for the shortcuts (via koffi)
│   ├── log.ts       storm.log
│   ├── normalize.ts validation of everything read from disk or the renderer
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
| `storm://asset/` | posters, wallpapers, screenshot previews | The renderer can read Storm's media folders and nothing else — path traversal is rejected. |

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
