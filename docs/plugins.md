# Plugin Development

Apollo Client plugins are trusted renderer modules. They are not sandboxed and can reach most of the client runtime through `api.apollo`.

## Scope

Plugins can now:

- add detail tabs
- register lyrics providers
- read and mutate live app state
- drive playback, search, playlists, auth, and layout flows
- call Apollo API endpoints through the client request helpers
- subscribe to app lifecycle and playback events
- access the DOM, browser APIs, and the desktop bridge already exposed in preload

Plugins are currently loaded as built-in modules from `src/plugins/index.js`. There is no external marketplace or sandbox.

## Architecture

- Plugins are plain ES modules loaded by the renderer.
- The host lives in `src/plugin-host.js`.
- The renderer builds the broad runtime surface in `src/renderer.js`.
- Built-in plugins are registered in `src/plugins/index.js`.

## Plugin Module Shape

Each plugin exports a default object:

```js
const plugin = {
  id: "example",
  name: "Example Plugin",
  async setup(api) {
    // plugin bootstrap
  }
};

export default plugin;
```

Requirements:

- `id` is required and unique
- `setup(api)` is required
- `name` is optional

`setup(api)` may return a cleanup function. The host runs it when the renderer unloads.

## Setup API

The setup API includes:

- `registerDetailTab(tab)`
- `registerLyricsProvider(provider)`
- `on(eventName, handler)`
- `emit(eventName, payload)`
- `onDispose(cleanup)`
- `escapeHtml(value)`
- `formatDuration(value)`
- `providerLabel(providerId)`
- `apollo`

`api.apollo` is the main plugin runtime.

## The `apollo` Runtime

The runtime exposes:

- `apollo.state`
- `apollo.playbackState`
- `apollo.likedTracks`
- `apollo.caches`
- `apollo.window`
- `apollo.document`
- `apollo.localStorage`
- `apollo.sessionStorage`
- `apollo.desktop`
- `apollo.dom`
- `apollo.helpers`
- `apollo.snapshots`
- `apollo.queries`
- `apollo.net`
- `apollo.ui`
- `apollo.search`
- `apollo.library`
- `apollo.playlists`
- `apollo.playback`
- `apollo.auth`
- `apollo.events`

Notes:

- `apollo.state` is the live renderer state object
- direct state mutation requires explicit persistence and rendering
- `apollo.ui.commit(...)` handles persistence and render triggers
- `apollo.window` and `apollo.document` are exposed because plugins already run in the renderer

## Runtime Highlights

Commonly used sections:

### `apollo.queries`

- `getVisibleTracks()`
- `getSelectedTrack()`
- `getTrackByKey(trackKey)`
- `getPlaybackTrack()`
- `getPlaybackTrackKey()`
- `getPlaylistItems()`
- `getPlaylists()`
- `getActivePlaylist()`
- `getEditablePlaylist()`
- `isTrackLiked(trackKey)`
- `isTrackInPlaylist(playlistId, track)`
- `getEnabledProviders()`
- `getCachedDuration(track)`
- `canSaveTrackToApollo(track)`
- `getPlugins()`

### `apollo.net`

- `getApiBase()`
- `requestJson(path, options)`
- `fetch(...)`
- `withAccessToken(url)`
- `getAuthorizationHeader()`

### `apollo.ui`

- `render()`
- `renderStatus()`
- `renderPlayback()`
- `renderDetailPanel()`
- `setStatusMessage(message)`
- `setActiveDetailTab(tabId, options)`
- `togglePanel(panelId)`
- `resetLayout()`
- `openPlaylistModal(options)`
- `closePlaylistModal()`
- `openSettingsModal()`
- `closeSettingsModal()`
- `commit(options)`

`commit(options)` supports:

- `likes: true`
- `auth: true`
- `playback: true`
- `settings: true`
- `layout: true`
- `renderApp: true`
- `renderStatusOnly: true`

### `apollo.search`

- `getQuery()`
- `setQuery(query, options)`
- `runSearch()`
- `fetchSearchResults(query)`

### `apollo.library`

- `refreshLibrary()`
- `fetchAllTracks(query)`
- `queueDurationProbe(track)`
- `toggleLike(track)`
- `downloadTrackToDevice(track)`
- `downloadTrackToServer(track)`

### `apollo.playlists`

- `createPlaylist(name, description, initialTrackId)`
- `updatePlaylist(playlistId, name, description)`
- `deletePlaylist(playlistId)`
- `uploadPlaylistArtwork(playlistId, file)`
- `deletePlaylistArtwork(playlistId)`
- `addTrackToPlaylist(playlistId, track)`
- `removeTrackFromPlaylist(playlistId, track)`

### `apollo.playback`

- `audioPlayer`
- `selectTrack(trackKey, options)`
- `playSelectedTrack()`
- `playTrack(trackOrKey, options)`
- `playAdjacent(offset, wrap)`
- `resolvePlaybackUrl(track)`
- `waitForPlaybackReady()`
- `getSnapshot()`

### `apollo.auth`

- `getSession()`
- `refreshAuthStatus()`
- `signInWithSecret(secret)`
- `signOut()`
- `clearAuthSession()`
- `persistAuthSession()`

## Events

Plugins can subscribe through:

- `api.on("event:name", handler)`
- `api.apollo.events.on("event:name", handler)`

Current host events include:

- `plugins:loaded`
- `app:render`
- `app:ready`
- `selection:changed`
- `detail:tab-change`
- `library:refresh:start`
- `library:refresh:success`
- `library:refresh:error`
- `library:like-changed`
- `search:start`
- `search:success`
- `search:error`
- `search:cleared`
- `playback:track-changed`
- `playback:state`
- `playback:metadata`
- `playback:error`
- `auth:changed`

Plugins may also emit custom events through `emit(...)`.

## Detail Tabs

`registerDetailTab` adds a tab to the right-hand detail panel.

```js
api.registerDetailTab({
  id: "queue-tools",
  label: "Queue Tools",
  order: 30,
  mount({ container, context, apollo }) {
    const track = context.getPlaybackTrack() || context.getSelectedTrack();

    container.innerHTML = `
      <div class="detail-empty-state">
        <h3>Queue Tools</h3>
        <p>${api.escapeHtml(track?.title || "Nothing selected.")}</p>
        <button type="button" data-action="like">Toggle like</button>
      </div>
    `;

    container.querySelector("[data-action='like']")?.addEventListener("click", () => {
      const activeTrack = apollo.queries.getPlaybackTrack() || apollo.queries.getSelectedTrack();
      if (!activeTrack) {
        return;
      }

      apollo.library.toggleLike(activeTrack);
    });
  }
});
```

Detail tab fields:

- `id`: required unique string
- `label`: required tab label
- `order`: optional sort order
- `mount(...)`: required render function

`mount(...)` receives:

- `container`
- `context`
- `apollo`
- `api`
- `plugin`
- `services`

`services` currently provides:

- `resolveLyrics(track)`
- `emit(eventName, payload)`
- `on(eventName, handler)`

The tab mount may return a cleanup function.

## Detail Context

The detail context currently includes:

- `audioPlayer`
- `getPlaybackTrack()`
- `getPlaybackTrackKey()`
- `getSelectedTrack()`
- `isTrackLiked(trackKey)`
- `providerLabel(providerId)`
- `apollo`

## Lyrics Providers

`registerLyricsProvider` participates in lyrics resolution.

```js
api.registerLyricsProvider({
  id: "local-cache",
  name: "Local Cache",
  order: 5,
  canResolve(track) {
    return Boolean(track?.title && track?.artist);
  },
  async resolve(track) {
    return {
      source: "Local Cache",
      synced: false,
      plainText: "Example lyrics",
      lines: [],
      meta: {}
    };
  }
});
```

Lyrics provider fields:

- `id`: required unique string
- `name`: required display name
- `order`: optional priority, lower runs first
- `canResolve(track)`: optional pre-filter
- `resolve(track)`: required async resolver

Resolver behavior:

- Return `null` to defer to the next provider.
- Throwing does not stop later providers.
- If `lines` contains entries, the result is treated as synced lyrics.

## Example: Full-Power Plugin

```js
const automationPlugin = {
  id: "automation-tools",
  name: "Automation Tools",
  async setup(api) {
    api.on("app:ready", () => {
      api.apollo.ui.setStatusMessage("Automation plugin loaded.");
    });

    api.registerDetailTab({
      id: "automation-tools",
      label: "Automation",
      order: 50,
      mount({ container, apollo }) {
        container.innerHTML = `
          <div class="detail-empty-state">
            <h3>Automation</h3>
            <button type="button" data-action="refresh">Refresh library</button>
          </div>
        `;

        const button = container.querySelector("[data-action='refresh']");
        const onClick = () => {
          void apollo.library.refreshLibrary();
        };

        button?.addEventListener("click", onClick);

        return () => {
          button?.removeEventListener("click", onClick);
        };
      }
    });
  }
};

export default automationPlugin;
```

## Registering a Plugin

Add the module under `src/plugins/` and include it in `src/plugins/index.js`.

```js
import lyricsPlugin from "./lyrics-plugin.js";
import automationPlugin from "./automation-plugin.js";

export const builtinPlugins = [lyricsPlugin, automationPlugin];
```

## Safety Guidance

- Plugins are trusted code.
- Plugins can break rendering, playback, auth, or state persistence if they mutate the runtime carelessly.
- Untrusted plugins should not be used in clients with access to private Apollo servers or valid auth tokens.
- Prefer `apollo.snapshots` for read-heavy logic and `apollo.ui.commit(...)` after direct state mutation.
- Clean up listeners, observers, and timers from `mount` and `setup`.
