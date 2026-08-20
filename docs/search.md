# Song Search

Apollo Client is an Electron application. Search runs in the Electron renderer and calls the Apollo server through the constrained client transport. The project does not use Tauri, and `npm run check:runtime` rejects Tauri dependencies, project artifacts, and references in executable application files.

## Search stages

Song search is progressive:

1. The active local collection is searched immediately.
2. Artist and remote-provider requests begin only after the normalized query reaches two characters.
3. Remote results are consumed over Server-Sent Events and rendered as each provider completes.
4. A newer query aborts the previous request and cannot overwrite current state.

One-character queries remain local. This avoids expensive provider calls for inputs that are normally exploratory or incomplete.

## Local collection indexes

`src/renderer/search-index.js` builds an index for each library, liked-song, or playlist revision. Repeated keystrokes reuse that index rather than repeatedly normalizing and scoring every track.

The index supports:

- Unicode compatibility normalization;
- accent-insensitive and punctuation-insensitive matching;
- exact-token and token-prefix lookup;
- fallback substring lookup;
- multi-token intersection;
- stable relevance ranking.

Ranking prioritizes exact and prefix title matches, followed by artist, album, album-artist, genre, and file metadata. Existing library records receive a small preference. The renderer caps one local result set at 250 ranked tracks to avoid unbounded DOM work.

Cache keys include the renderer revision for the active collection. Library, playlist, and like changes therefore produce fresh indexes automatically. Old collection indexes are removed with LRU eviction.

## Remote streaming and caching

The Apollo server already emits incremental search snapshots. The client consumes those snapshots directly, so a fast provider can populate the interface without waiting for the slowest provider.

Song and artist-search responses use bounded TTL/LRU caches:

- song searches: 48 entries, two-minute lifetime;
- artist searches: 32 entries, ten-minute lifetime.

Reads refresh recency, expired entries are discarded, and cached payloads are cloned at the cache boundary so callers cannot mutate shared state.

General song search does not eagerly request full profiles and releases for every artist result. Those heavier requests remain deferred until the user opens an artist, reducing burst traffic to the server and metadata providers.

## Validation

Search changes must pass:

```sh
npm run check:runtime
npm run check:syntax
npm test
npm run audit:deps
```

CI additionally runs the complete dependency audit, exercises the Electron interface under Xvfb, and builds an unpacked Electron application with a non-empty `app.asar`.
