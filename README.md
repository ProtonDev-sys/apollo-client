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

Discord Rich Presence is optional. Configuration can be supplied in the settings UI or through environment variables:

```text
APOLLO_DISCORD_CLIENT_ID
APOLLO_DISCORD_LARGE_IMAGE_KEY
APOLLO_DISCORD_LARGE_IMAGE_TEXT
APOLLO_DISCORD_SMALL_IMAGE_KEY_PLAYING
APOLLO_DISCORD_SMALL_IMAGE_KEY_PAUSED
APOLLO_DISCORD_SMALL_IMAGE_KEY_BUFFERING
```

Artwork and playback-state icons require a Discord application with matching uploaded asset keys.

## Authentication

When Apollo authentication is enabled, the client exchanges the shared secret for a session token and uses that token for later API calls. Authentication data stays local to the machine running the client.

## Status

Apollo Client currently runs directly from source with Electron. Packaged installers or distributable binaries are not included yet.

## Documentation

- [Plugin development](docs/plugins.md)

## Project layout

```text
.
|-- main.js
|-- preload.js
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
