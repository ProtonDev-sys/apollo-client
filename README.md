# Apollo Client

Desktop Electron client for the Apollo music server.

## Overview

Apollo Client is a desktop-first shell that talks directly to an Apollo server and provides:

- library and playlist browsing
- track search and playback
- playlist creation and editing
- auth/session handling against Apollo's API
- a renderer-side plugin host for detail-panel extensions
- a built-in lyrics plugin backed by LRCLIB

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- a running Apollo server

## Setup

Install dependencies:

```powershell
npm.cmd install
```

By default the client connects to `http://127.0.0.1:4848`.

If Apollo is running somewhere else, set `APOLLO_SERVER_URL` before launch:

```powershell
$env:APOLLO_SERVER_URL = "http://127.0.0.1:4848"
```

Optional Discord Rich Presence defaults can also be supplied through environment variables:

```powershell
$env:APOLLO_DISCORD_CLIENT_ID = "your_discord_application_id"
$env:APOLLO_DISCORD_LARGE_IMAGE_KEY = "apollo"
$env:APOLLO_DISCORD_LARGE_IMAGE_TEXT = "Apollo Client"
```

You can also configure Rich Presence directly inside Apollo's settings modal. To show artwork or playback-status icons, create a Discord application and upload matching asset keys in the Discord developer portal.

## Run in development

```powershell
npm.cmd start
```

That starts Electron directly from the checked-out source.

## Build

The project currently ships as source plus an Electron runtime. There is no packaging pipeline or installer script yet.

Current build/run path:

- install dependencies with `npm.cmd install`
- launch the desktop client with `npm.cmd start`

If you want distributable binaries later, add an Electron packager such as `electron-builder` or `electron-forge` and introduce explicit build scripts in `package.json`.

## Authentication

If Apollo authentication is enabled, the client prompts for the shared secret, exchanges it for a session token through `/api/auth/session`, and uses that token for later API calls.

Do not hardcode secrets in this repository. Runtime auth data should remain local to the machine running the client.

## Documentation

- [Plugin development](docs/plugins.md)

## Project structure

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

## Notes

- The UI is desktop-first.
- Plugins currently run in the renderer process.
- Lyrics lookups are client-side and currently use LRCLIB.
- Longer implementation details should live under `docs/` rather than in this root README.
