# Song Search

Apollo Client is an Electron application. Search runs in the Electron renderer and calls the Apollo server through the constrained preload-backed client transport. The project does not use Tauri, and `npm run check:platform` rejects Tauri dependencies, configuration files, source directories, and runtime references.

## Search stages

Song search is progressive:

1. The active local collection is searched immediately.
2. Artist and remote-provider requests begin after the configured input debounce.
3. Results render as each source completes rather than waiting for every provider.
4. A newer query aborts the previous request and cannot overwrite current state.

One-character queries remain local. Remote and artist requests begin at two normalized characters, which avoids expensive provider calls for inputs that are usually exploratory or incomplete.

## Local index

`src/renderer/search-engine.js` builds a compact index for each library, liked-song, or playlist revision. Repeated keystrokes reuse that index rather than repeatedly normalizing every title, artist, album, genre, and provider string.

The index supports:

- Unicode compatibility normalization;
- accent-insensitive matching;
- punctuation-insensitive matching;
- exact-token and token-prefix lookup;
- fallback substring lookup;
- multi-token intersection;
- stable relevance ranking.

Ranking prioritizes exact and prefix title matches, then artist, album, album artist, and genre matches. Local-library records receive a small tie-breaking boost. The renderer caps a single local result set at 250 ranked tracks to avoid creating an unbounded number of DOM rows.

Index cache keys include the renderer revision for the corresponding collection. A library, playlist, or like change therefore produces a fresh index automatically.

## Remote caching

Remote song and artist-search responses use bounded TTL/LRU caches:

- song searches: 48 entries, two-minute lifetime;
- artist searches: 32 entries, ten-minute lifetime.

Reads refresh recency, expired entries are removed immediately, and old entries are evicted without manual insertion-order bookkeeping. Cached payloads remain cloned at the renderer boundary so callers cannot mutate shared cache state.

## Artist enrichment

Artist profile and release enrichment is limited to three artists at a time. Each artist may still fetch its profile and releases concurrently, but the client no longer starts every enrichment pair simultaneously. This reduces burst load on the Apollo server and upstream metadata services while preserving result order.

## Validation

Search changes must pass:

```sh
npm run check:platform
npm run check:syntax
npm test
npm run audit:deps
```

CI additionally runs the complete dependency audit, exercises the Electron interface under Xvfb, and builds an unpacked Electron application with a non-empty `app.asar`.
