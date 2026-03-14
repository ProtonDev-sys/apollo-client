# Apollo Client

Apollo Client is an Electron desktop app for browsing an Apollo music server, managing playlists, and playing music from a desktop interface.

## Features

- Browse your library and playlists
- Search the library and supported providers
- Create, edit, and delete playlists
- Play tracks with repeat, seek, and volume controls
- View lyrics through the built-in LRCLIB-powered plugin
- Extend the client through a broad renderer-side plugin runtime
- Sign in with Apollo shared-secret authentication when enabled
- Show optional Discord Rich Presence while listening

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A running Apollo server

## Quick start

Install dependencies:

```sh
npm install
```

Run the syntax pass across the JavaScript surface:

```sh
npm run check:syntax
```

Run the baseline verification checks:

```sh
npm run verify
```

Launch the desktop client:

```sh
npm start
```

Apollo Client connects to `http://127.0.0.1:4848` by default.

## Configuration

Set `APOLLO_SERVER_URL` before launch when the server is not running on the default address.

PowerShell:

```powershell
$env:APOLLO_SERVER_URL = "http://127.0.0.1:4848"
npm start
```

Bash:

```bash
APOLLO_SERVER_URL="http://127.0.0.1:4848" npm start
```

### App config

Apollo can load an external `apollo.config.json` file for runtime theme selection and overrides. The loader checks these locations in order and uses the first file it finds:

- `APOLLO_CONFIG_PATH`
- `apollo.config.json` next to the installed executable
- `apollo.config.json` in the current working directory
- `apollo.config.json` in the Electron user-data directory
- `apollo.config.json` next to the app source during local development

Themes are now disk-backed runtime assets. Apollo seeds `default-theme.json` into the user-data `themes/` directory on first run, and you can swap to any theme file there or in another configured theme directory without rebuilding the app.

Theme config supports:

- `theme.id`, `theme.name`, `theme.file`, or `theme.path` to select a JSON or CSS theme file
- inline `theme.variables` and `theme.css` overrides
- optional `theme.fonts.ui` and `theme.fonts.mono`

```json
{
  "theme": {
    "id": "default-theme",
    "fonts": {
      "ui": "\"Aptos\", sans-serif",
      "mono": "\"JetBrains Mono\", monospace"
    },
    "variables": {
      "bg": "#101418",
      "surface": "#162029",
      "surface-2": "#1c2833",
      "text": "#f3f7fb",
      "muted": "#9fb0bf",
      "accent": "#7dd3fc",
      "progress": "#7dd3fc",
      "border": "rgba(255, 255, 255, 0.12)",
      "shadow": "0 24px 80px rgba(0, 0, 0, 0.38)"
    },
    "css": ".artist-search-mark { background: linear-gradient(145deg, #0f172a, #1d4ed8); }"
  }
}
```

Variable keys can be written with or without the `--` prefix.

### Runtime plugins

Plugins are also disk-backed runtime assets now. Apollo seeds `lyrics-plugin.js` into the user-data `plugins/` directory on first run and loads `.js` plugins from these directories:

- `APOLLO_PLUGIN_DIR`
- `plugins/` next to the installed executable
- `plugins/` in the current working directory
- `plugins/` in the Electron user-data directory

Renderer-side plugin and theme directories are watched. Editing a plugin or theme file reloads it without rebuilding the app.

Plugin ids, detail-tab ids, and lyrics-provider ids must be unique across the active runtime. Apollo now treats duplicate registrations as load errors instead of silently shadowing earlier plugins.

### Logs

Apollo writes a shared client log to the Electron user-data directory:

- `apollo-client.log`

Discord bridge logging still writes:

- `apollo-discord.log`

### Discord Rich Presence

Discord Rich Presence ships with Apollo's default Discord application ID. You can keep that default in the settings UI or override it locally through environment variables:

```text
APOLLO_DISCORD_CLIENT_ID
APOLLO_DISCORD_LARGE_IMAGE_KEY
APOLLO_DISCORD_LARGE_IMAGE_TEXT
APOLLO_DISCORD_SMALL_IMAGE_KEY_PLAYING
APOLLO_DISCORD_SMALL_IMAGE_KEY_PAUSED
APOLLO_DISCORD_SMALL_IMAGE_KEY_BUFFERING
```

Artwork and playback-state icons require a Discord application with matching uploaded asset keys. Apollo also registers the `apollo://` protocol so Discord buttons can reopen the desktop app on the current track.

Discord join / listen-along uses the `apollo://` protocol. The optional `Play on Apollo` rich-presence button only appears when Apollo is pointed at a non-localhost server URL, because Discord button URLs must be regular `http://` or `https://` links.

## Building Windows packages

Apollo can package a Windows installer with Electron Builder, but the Discord Social helper is intentionally not checked into the repository as a built binary or vendored SDK.

Prerequisites:

- Visual Studio Build Tools with the C++ workload
- A local Discord Social SDK checkout

Point `APOLLO_DISCORD_SOCIAL_SDK_DIR` at that SDK checkout, or place the SDK at `vendor/discord_social_sdk`, then run:

```powershell
$env:APOLLO_DISCORD_SOCIAL_SDK_DIR = "C:\path\to\discord_social_sdk"
npm run build:win
```

That command builds the native helper into `native-bin/` and writes packaged artifacts to `release/`. Both directories are ignored on purpose.

## Authentication

When Apollo authentication is enabled, the client exchanges the shared secret for a session token and uses that token for later API calls. Authentication data stays local to the machine running the client.

## Status

Apollo Client runs directly from source with Electron. Windows packaging is supported locally through `npm run build:win`, but generated helpers, SDK files, and release artifacts stay out of the Git repository.

## Documentation

- [Plugin development](docs/plugins.md)

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
|   |-- plugin-host.js
|   `-- plugins/
`-- docs/
    `-- plugins.md
```

## Plugin trust model

Plugins run in the renderer as trusted application code. They are not sandboxed. The plugin runtime exposes broad access to client state, UI flows, playback controls, network helpers, and the preload desktop bridge.
