# Apollo Client

Desktop Electron client for the Apollo music server.

## Overview

This repository contains a desktop-first shell that talks directly to an Apollo server and renders:

- library and playlist browsing
- track search and playback
- playlist creation and editing
- auth/session handling against Apollo's API
- a renderer-side plugin host for detail-panel extensions
- a built-in lyrics plugin backed by LRCLIB

## Tech stack

- Electron 37
- plain HTML, CSS, and JavaScript
- no bundler
- no TypeScript

## Repository layout

```text
.
|-- main.js              # Electron main process entry
|-- preload.js           # Safe bridge into the renderer
|-- src/
|   |-- index.html       # Renderer markup
|   |-- styles.css       # App styles
|   |-- renderer.js      # Apollo client UI and API integration
|   |-- plugin-host.js   # Plugin registration and mounting
|   `-- plugins/         # Built-in plugins
`-- docs/
    `-- plugins.md       # Plugin authoring guide
```

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- a running Apollo server

## Setup

Install dependencies:

```powershell
npm.cmd install
```

By default the client targets `http://127.0.0.1:4848`.

If Apollo is running somewhere else, set `APOLLO_SERVER_URL` before launch:

```powershell
$env:APOLLO_SERVER_URL = "http://127.0.0.1:4848"
```

## Run in development

```powershell
npm.cmd start
```

That starts Electron directly from the checked-out source.

## Build status

This project does not currently define a packaging pipeline or installer build. The runnable desktop build is the source checkout launched with `npm.cmd start`.

If you want distributable binaries later, add a packager such as `electron-builder` or `electron-forge` and introduce explicit build scripts in `package.json`.

## Apollo server expectations

The renderer expects the Apollo server to expose the client APIs used for:

- server health/status
- library and playlist queries
- playback/stream URLs
- auth status and session creation

When Apollo authentication is enabled, the client prompts for the shared secret, exchanges it for a session token through `/api/auth/session`, and then sends bearer auth on later API calls.

Security note:

- Do not hardcode the shared secret in this repo.
- Do not commit `.env` files or local auth/session artifacts.
- The client stores only the issued session token in browser storage at runtime.

## Plugin system

Apollo Client includes a small plugin host in the renderer. Plugins can currently do two things:

- add a tab to the detail panel
- register lyrics providers used by the built-in lyrics flow

The current built-in plugin is:

- `src/plugins/lyrics-plugin.js`

Plugin registration happens in:

- `src/plugins/index.js`

Detailed plugin authoring documentation lives here:

- [docs/plugins.md](/C:/Users/proton/Documents/Development/Apollo%20client/docs/plugins.md)

## Plugin quick start

Create a plugin module in `src/plugins/`:

```js
const examplePlugin = {
  id: "example",
  name: "Example",
  async setup(api) {
    api.registerDetailTab({
      id: "example",
      label: "Example",
      order: 50,
      mount({ container, context }) {
        const track = context.getSelectedTrack() || context.getPlaybackTrack();
        container.innerHTML = `<p>${api.escapeHtml(track?.title || "Nothing selected")}</p>`;
      }
    });
  }
};

export default examplePlugin;
```

Then register it in `src/plugins/index.js`.

## Notes

- Plugins currently run in the renderer process.
- There is no external plugin marketplace or dynamic loading yet.
- Lyrics lookups are client-side and currently use LRCLIB.
- This UI is desktop-first, though it scales down reasonably on smaller windows.
