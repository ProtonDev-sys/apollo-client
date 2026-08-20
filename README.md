# Apollo Client

Apollo Client is a compact Electron desktop application for browsing an Apollo music server, managing playlists, searching supported providers, and playing music.

## Features

- Browse the library and playlists
- Search local collections and supported remote providers
- Create, edit, and delete playlists
- Play tracks with repeat, seek, crossfade, normalization, and volume controls
- View lyrics through the built-in LRCLIB-powered plugin
- Load trusted renderer plugins and themes from the Electron user-data directory
- Sign in with Apollo shared-secret authentication when enabled
- Publish optional Discord Rich Presence and Listen Along sessions

## Requirements

- Node.js 22.12 or newer; Node.js 24 LTS is recommended
- npm 10 or newer
- A running Apollo server

## Quick start

```sh
npm install
npm run verify
npm start
```

Apollo Client connects to `http://127.0.0.1:4848` by default. Set `APOLLO_SERVER_URL` before launch to use another endpoint.

PowerShell:

```powershell
$env:APOLLO_SERVER_URL = "http://127.0.0.1:4848"
npm start
```

Bash:

```bash
APOLLO_SERVER_URL="http://127.0.0.1:4848" npm start
```

## Compact production build

`npm run build:app` creates `dist-app/`, the only application source tree packaged by Electron Builder. The build:

- minifies the main process, preload, and supporting CommonJS modules;
- bundles and tree-shakes the renderer into one module;
- minifies CSS and HTML;
- removes remote font requests and uses system font stacks;
- keeps optional main-process integrations lazy;
- disables unused Vulkan and WebGPU features;
- removes the corresponding prebuilt graphics compiler and fallback files after packaging;
- emits no source maps or production `node_modules` tree.

Electron Builder packages only that generated runtime into a compressed ASAR and keeps only the `en-US` Electron locale.

Current measured outputs are:

| Output | Size |
|---|---:|
| Generated Apollo runtime | 383,218 bytes |
| Linux `app.asar` | 387,146 bytes |
| Windows `app.asar` | 387,165 bytes |
| Linux x64 unpacked runtime | 273,060,493 bytes |
| Windows x64 unpacked runtime | 292,748,743 bytes |
| Windows x64 installer | 94,838,255 bytes |

```sh
npm run build:app
npm run check:bundle
npm run pack:linux:ci
npm run check:package
```

Generated runtime files, release artifacts, native helper binaries, and SDK files remain outside version control. See [Electron package size](docs/package-size.md) for the runtime breakdown, pruning rules, and the practical standalone size floor.

## Configuration

Apollo can load an external `apollo.config.json` file for theme selection and overrides. In packaged applications the loader checks explicit environment configuration and the Electron user-data directory. Development builds also inspect the executable, working, and source directories.

Theme files may be JSON or CSS. Inline config supports `theme.variables`, `theme.css`, and optional UI and monospace font stacks.

```json
{
  "theme": {
    "file": "my-theme.json",
    "variables": {
      "bg": "#101418",
      "surface": "#162029",
      "text": "#f3f7fb",
      "muted": "#9fb0bf",
      "accent": "#7dd3fc"
    }
  }
}
```

Apollo does not write default theme or plugin copies at startup. The interface and lyrics plugins are compiled into the application. Additional trusted `.js` plugins can be placed in the configured plugin directory or the Electron user-data `plugins/` directory.

Plugin ids, detail-tab ids, and lyrics-provider ids must be unique. Plugins execute as trusted renderer code and are not sandboxed from the application plugin API.

## Logs

Apollo writes one asynchronous, size-bounded log in the Electron user-data directory:

- `apollo-client.log`

The log is capped at 1 MiB and its in-memory queue is bounded.

## Discord integration

Rich Presence uses Apollo's built-in Discord application ID unless it is overridden in settings or with the documented `APOLLO_DISCORD_*` environment variables. The client talks to the local Discord desktop IPC endpoint through a small built-in Node module, so the packaged application has no production package dependencies.

The optional Windows Discord Social helper remains lazy. It is started only when an account action requires it.

## Building Windows packages

Windows packaging requires Visual Studio Build Tools with the C++ workload and a local Discord Social SDK checkout when the optional native helper is required.

```powershell
$env:APOLLO_DISCORD_SOCIAL_SDK_DIR = "C:\path\to\discord_social_sdk"
npm run build:win
```

The command builds the helper into `native-bin/`, generates the compact Electron runtime, and writes the NSIS installer to `release/`.

## Validation

`npm run verify` checks the Electron-only project boundary, source budgets, syntax, unit tests, generated runtime bundle, and production dependency audit. CI repeats this on Node.js 22 and 24, exercises both the development and pruned packaged Electron applications, builds Linux and Windows packages, and enforces ASAR, unpacked-runtime, and installer-size limits.

## Project layout

```text
.
|-- main.js
|-- preload.js
|-- discord-presence.js
|-- discord-social-bridge.js
|-- native-src/
|-- scripts/
|-- src/
|   |-- index.html
|   |-- styles.css
|   |-- renderer.js
|   |-- main/
|   |-- preload/
|   |-- renderer/
|   `-- plugins/
|-- test/
|-- docs/
`-- dist-app/          generated and ignored
```

See [plugin development](docs/plugins.md) for the renderer plugin API.
