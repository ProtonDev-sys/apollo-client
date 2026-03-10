# Plugin Development

Apollo Client exposes a small renderer-side plugin host for extending the detail panel and lyrics resolution flow.

## Current architecture

- Plugins are plain ES modules loaded by the renderer.
- Built-in plugins are registered in `src/plugins/index.js`.
- The host lives in `src/plugin-host.js`.
- Plugins are loaded during renderer startup before the first render.

## Plugin module shape

Each plugin exports a default object with:

```js
const plugin = {
  id: "example",
  name: "Example Plugin",
  async setup(api) {
    // registerDetailTab(...)
    // registerLyricsProvider(...)
  }
};

export default plugin;
```

Rules:

- `id` must be unique.
- `setup(api)` is required.
- `name` is optional and is used for display/debugging only.

## Setup API

Inside `setup(api)`, the plugin receives:

- `registerDetailTab(tab)`
- `registerLyricsProvider(provider)`
- `escapeHtml(value)`
- `formatDuration(value)`
- `providerLabel(providerId)`

The shared helper functions come from the renderer host and are intended for consistent UI formatting.

## Detail tabs

Use `registerDetailTab` to add a tab to the right-hand detail panel.

```js
api.registerDetailTab({
  id: "credits",
  label: "Credits",
  order: 40,
  mount({ container, context, services }) {
    const track = context.getSelectedTrack() || context.getPlaybackTrack();

    container.innerHTML = `
      <div class="detail-empty-state">
        <h3>Credits</h3>
        <p>${api.escapeHtml(track?.artist || "No artist selected.")}</p>
      </div>
    `;

    return () => {
      // optional cleanup
    };
  }
});
```

Tab contract:

- `id`: required unique string.
- `label`: required tab label.
- `order`: optional sort order, lower values render earlier.
- `mount(...)`: required function that renders into the provided container.

`mount` receives:

- `container`: DOM node for the tab body.
- `context`: detail panel context from the renderer.
- `services`: plugin-host services exposed at mount time.

`mount` may return a cleanup function. The host calls it when the tab is replaced or re-rendered.

## Detail context

The current detail context includes:

- `audioPlayer`
- `getPlaybackTrack()`
- `getPlaybackTrackKey()`
- `getSelectedTrack()`
- `isTrackLiked(trackKey)`
- `providerLabel(providerId)`

Use `getPlaybackTrack()` for the actively playing item and `getSelectedTrack()` for the track highlighted in the list.

## Lyrics providers

Use `registerLyricsProvider` to participate in lyrics resolution.

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

Provider contract:

- `id`: required unique string.
- `name`: required display name.
- `order`: optional priority, lower values run first.
- `canResolve(track)`: optional pre-filter.
- `resolve(track)`: required async resolver.

Resolver return shape:

```js
{
  source: "Provider name",
  synced: true,
  plainText: "Full plain-text lyrics",
  lines: [
    { startMs: 0, endMs: 4200, text: "First line" }
  ],
  meta: {
    album: "Album title"
  }
}
```

Notes:

- Returning `null` means "no result, try the next provider".
- If a provider throws, the host ignores the failure and continues to later providers.
- If `lines` has data, the host treats the lyrics as synced.

## Registering a plugin

Add the plugin module to `src/plugins/` and include it in `src/plugins/index.js`.

```js
import lyricsPlugin from "./lyrics-plugin.js";
import creditsPlugin from "./credits-plugin.js";

export const builtinPlugins = [lyricsPlugin, creditsPlugin];
```

That is the only registration step in the current app.

## Implementation notes

- Plugins currently run in the renderer, not in the Electron main process.
- There is no dynamic plugin loading, sandboxing, or external plugin directory yet.
- Plugins should avoid storing secrets or making assumptions about privileged Node access.
- If a plugin calls external services, it should do so with public metadata only unless the renderer contract is expanded deliberately.
