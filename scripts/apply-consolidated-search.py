from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def replace_block(source: str, start: str, end: str, replacement: str, label: str) -> str:
    start_count = source.count(start)
    end_count = source.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(
            f"{label}: expected one boundary each, "
            f"found start={start_count}, end={end_count}"
        )

    start_index = source.index(start)
    end_index = source.index(end, start_index)
    return source[:start_index] + replacement + source[end_index:]


renderer_path = Path("src/renderer.js")
renderer = renderer_path.read_text(encoding="utf-8")

renderer = replace_once(
    renderer,
    '''import {
  buildSearchCacheKey as buildClientSearchCacheKey,
  createTimedLruCache,
  createTrackSearchIndex,
  mergeSearchTracks
} from "./renderer/search-index.js";
''',
    '''import {
  buildSearchCacheKey as buildClientSearchCacheKey,
  createTimedLruCache,
  createTrackSearchEngine,
  mergeSearchTracks,
  shouldSearchRemote
} from "./renderer/search-index.js";
''',
    "search imports"
)

renderer = replace_once(
    renderer,
    '''const searchResultCache = createTimedLruCache({
  maxEntries: 40,
  ttlMs: 2 * 60 * 1000
});
const trackSearchIndex = createTrackSearchIndex();
const artistSearchCache = new Map();
''',
    '''const searchResultCache = createTimedLruCache({
  maxEntries: 48,
  ttlMs: 2 * 60 * 1000
});
const artistSearchCache = createTimedLruCache({
  maxEntries: 32,
  ttlMs: 10 * 60 * 1000
});
const localTrackSearch = createTrackSearchEngine({
  maxIndexes: 18
});
''',
    "bounded search caches"
)

renderer = renderer.replace("trackSearchIndex.clear();", "localTrackSearch.clear();")
if "trackSearchIndex" in renderer:
    raise SystemExit("stale trackSearchIndex reference remains")

renderer = replace_block(
    renderer,
    "function readCachedArtistSearchResult(query) {",
    "function getArtistBrowseSummary(artistId = state.artistBrowse?.id || \"\") {",
    '''function buildArtistSearchCacheKey(query) {
  return buildClientSearchCacheKey({
    query,
    scope: "artist",
    providers: [],
    includeLibraryResults: false,
    apiBase: state.apiBase
  });
}

function readCachedArtistSearchResult(query) {
  return artistSearchCache.get(buildArtistSearchCacheKey(query));
}

function writeCachedArtistSearchResult(query, result) {
  artistSearchCache.set(buildArtistSearchCacheKey(query), result);
}

''',
    "artist search cache helpers"
)

renderer = replace_once(
    renderer,
    '''  if (!trimmedQuery || !enabledProviders.length) {
''',
    '''  if (!shouldSearchRemote(trimmedQuery) || !enabledProviders.length) {
''',
    "remote minimum query"
)
renderer = replace_once(
    renderer,
    '''  if (!trimmedQuery) {
    return [];
  }

  const cachedResult = readCachedArtistSearchResult(trimmedQuery);
''',
    '''  if (!shouldSearchRemote(trimmedQuery)) {
    return [];
  }

  const cachedResult = readCachedArtistSearchResult(trimmedQuery);
''',
    "artist minimum query"
)

renderer = replace_block(
    renderer,
    "function getLocalSearchResults(query) {",
    "function isCollectionScopedSearch() {",
    '''function getLocalSearchCollection() {
  if (state.selectedPlaylistId === "liked-tracks") {
    return {
      tracks: Array.from(likedTracks.values()),
      cacheKey: `liked:${renderRevisions.likes}`
    };
  }

  if (state.selectedPlaylistId && state.selectedPlaylistId !== "all-tracks") {
    return {
      tracks: state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId)?.tracks || [],
      cacheKey: `playlist:${state.selectedPlaylistId}:${renderRevisions.playlists}`
    };
  }

  return {
    tracks: state.libraryTracks,
    cacheKey: `library:${renderRevisions.library}`
  };
}

function getLocalSearchResults(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery || !state.settings.search.includeLibraryResults) {
    return [];
  }

  const collection = getLocalSearchCollection();
  return localTrackSearch.search(collection.tracks, trimmedQuery, {
    cacheKey: collection.cacheKey,
    limit: 250
  });
}

''',
    "collection search integration"
)

renderer = replace_once(
    renderer,
    '''  const localTracks = getLocalSearchResults(query);
  const searchWarnings = [];
''',
    '''  const localTracks = getLocalSearchResults(query);
  const networkSearchEnabled = shouldSearchRemote(query);
  const searchWarnings = [];
''',
    "network query decision"
)
renderer = replace_once(
    renderer,
    '''  let remotePending = !collectionScopedSearch && getEnabledProviders().length > 0;
''',
    '''  let remotePending = !collectionScopedSearch
    && networkSearchEnabled
    && getEnabledProviders().length > 0;
''',
    "remote pending decision"
)
renderer = replace_once(
    renderer,
    '''  const abortController = new AbortController();
  activeSearchAbortController = abortController;
  state.isLoading = true;
''',
    '''  state.isLoading = !collectionScopedSearch && networkSearchEnabled;
''',
    "defer search abort controller"
)
renderer = replace_once(
    renderer,
    '''  if (collectionScopedSearch) {
    state.isLoading = false;
    publishSearchProgress();
    pluginHost?.emit("search:success", {
      query,
      tracks: state.searchResults,
      warnings: []
    });
    return;
  }

  try {
''',
    '''  if (collectionScopedSearch || !networkSearchEnabled) {
    state.isLoading = false;
    publishSearchProgress();
    pluginHost?.emit("search:success", {
      query,
      tracks: state.searchResults,
      warnings: []
    });
    return;
  }

  const abortController = new AbortController();
  activeSearchAbortController = abortController;

  try {
''',
    "local-only search completion"
)

for required in (
    "createTrackSearchEngine",
    "const artistSearchCache = createTimedLruCache(",
    "const localTrackSearch = createTrackSearchEngine(",
    "shouldSearchRemote(trimmedQuery)",
    "const networkSearchEnabled = shouldSearchRemote(query);",
    "if (collectionScopedSearch || !networkSearchEnabled)",
    "cacheKey: collection.cacheKey",
    "limit: 250"
):
    if required not in renderer:
        raise SystemExit(f"missing renderer search fragment: {required}")

renderer_path.write_text(renderer, encoding="utf-8")


smoke_path = Path("scripts/electron-ui-smoke.js")
smoke = smoke_path.read_text(encoding="utf-8")
smoke = replace_once(
    smoke,
    '''  await window.loadFile(path.join(PROJECT_ROOT, "src", "index.html"));

  await waitForCondition(
''',
    '''  await window.loadFile(path.join(PROJECT_ROOT, "src", "index.html"));
  window.show();
  window.focus();
  window.webContents.focus();

  await waitForCondition(
''',
    "show smoke-test window"
)
smoke = replace_block(
    smoke,
    "  const keyboardSnapshot = await window.webContents.executeJavaScript(`",
    "  fs.mkdirSync(OUTPUT_DIRECTORY, {",
    '''  window.focus();
  window.webContents.focus();
  await new Promise((resolve) => setTimeout(resolve, 50));

  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "Escape"
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "Escape"
  });
  await waitForCondition(
    window,
    `!document.querySelector(".apollo-command-layer")?.classList.contains("is-open")`,
    5000
  );

  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "K",
    modifiers: ["control"]
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "K",
    modifiers: ["control"]
  });
  const focusSnapshot = await waitForCondition(
    window,
    `Boolean(
      document.querySelector(".apollo-command-layer")?.classList.contains("is-open")
      && document.activeElement?.classList.contains("apollo-command-search")
    )`,
    5000
  );
  assert.equal(Boolean(focusSnapshot), true);

''',
    "native keyboard smoke test"
)

if "keyboardSnapshot" in smoke:
    raise SystemExit("stale synthetic keyboard smoke block remains")
if 'modifiers: ["control"]' not in smoke:
    raise SystemExit("native Electron keyboard input was not installed")

smoke_path.write_text(smoke, encoding="utf-8")

print("Applied consolidated progressive and indexed song search integration.")
