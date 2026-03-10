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
