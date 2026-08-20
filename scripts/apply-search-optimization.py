from pathlib import Path


renderer_path = Path("src/renderer.js")
source = renderer_path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    source = source.replace(old, new, 1)


def replace_block(start: str, end: str, replacement: str, label: str) -> None:
    global source
    start_count = source.count(start)
    end_count = source.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(
            f"{label}: expected one boundary each, "
            f"found start={start_count}, end={end_count}"
        )

    start_index = source.index(start)
    end_index = source.index(end, start_index)
    source = source[:start_index] + replacement + source[end_index:]


replace_once(
    'import { createPollingController } from "./renderer/polling-controller.js";\n',
    '''import { createPollingController } from "./renderer/polling-controller.js";
import {
  createLruTtlCache,
  createTrackSearchEngine,
  mapWithConcurrency,
  shouldSearchRemote
} from "./renderer/search-engine.js";
''',
    "search engine imports",
)

replace_once(
    '''const searchResultCache = new Map();
const artistSearchCache = new Map();
const artistProfileCache = new Map();
''',
    '''const searchResultCache = createLruTtlCache({
  maxEntries: 48,
  ttlMs: 2 * 60 * 1000
});
const artistSearchCache = createLruTtlCache({
  maxEntries: 32,
  ttlMs: 10 * 60 * 1000
});
const localTrackSearch = createTrackSearchEngine({
  maxIndexes: 18
});
const artistProfileCache = new Map();
''',
    "search caches",
)

replace_block(
    "function writeCachedSearchResult(query, result, options = {}) {",
    "function normaliseArtist(artist = {}) {",
    '''function writeCachedSearchResult(query, result, options = {}) {
  const cacheKey = buildSearchCacheKey(query, options);
  searchResultCache.set(cacheKey, structuredClone(result));
}

''',
    "search result cache writer",
)

replace_block(
    "function writeCachedArtistSearchResult(query, result) {",
    "function getArtistBrowseSummary(",
    '''function writeCachedArtistSearchResult(query, result) {
  const cacheKey = `${state.apiBase}::${String(query || "").trim().toLowerCase()}`;
  artistSearchCache.set(cacheKey, structuredClone(result));
}

''',
    "artist search cache writer",
)

replace_once(
    '''  searchResultCache.clear();
  artistSearchCache.clear();
  artistProfileCache.clear();
''',
    '''  searchResultCache.clear();
  artistSearchCache.clear();
  localTrackSearch.clear();
  artistProfileCache.clear();
''',
    "search teardown",
)

replace_once(
    '''  if (!trimmedQuery || !enabledProviders.length) {
    return {
      tracks: [],
      warnings: []
    };
  }
''',
    '''  if (!shouldSearchRemote(trimmedQuery) || !enabledProviders.length) {
    return {
      tracks: [],
      warnings: []
    };
  }
''',
    "remote search gate",
)

replace_once(
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
    "artist search gate",
)

replace_block(
    "async function enrichArtistSearchResults(artists, { signal } = {}) {",
    "function abortPendingSearchRequest() {",
    '''async function enrichArtistSearchResults(artists, { signal } = {}) {
  return mapWithConcurrency(
    Array.isArray(artists) ? artists : [],
    3,
    async (artist) => {
      try {
        const [profile, releases] = await Promise.all([
          fetchArtistProfile(artist.id, { signal }),
          fetchArtistReleases(artist.id, { signal })
        ]);
        return normaliseArtist({
          ...artist,
          ...profile,
          artwork: getArtistArtwork(profile),
          releases
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        return normaliseArtist(artist);
      }
    }
  );
}

''',
    "bounded artist enrichment",
)

replace_block(
    "function matchesTrackQuery(track, query) {",
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
    "indexed local search",
)

replace_once(
    '''  let remotePending = !collectionScopedSearch && getEnabledProviders().length > 0;
''',
    '''  let remotePending = !collectionScopedSearch
    && shouldSearchRemote(query)
    && getEnabledProviders().length > 0;
''',
    "remote search progress gate",
)

required_fragments = (
    'from "./renderer/search-engine.js"',
    "const localTrackSearch = createTrackSearchEngine(",
    "createLruTtlCache({",
    "shouldSearchRemote(trimmedQuery)",
    "mapWithConcurrency(",
    "function getLocalSearchCollection()",
    "localTrackSearch.search(collection.tracks, trimmedQuery",
)
for fragment in required_fragments:
    if fragment not in source:
        raise SystemExit(f"required search integration is missing: {fragment}")

for forbidden_fragment in (
    "const searchResultCache = new Map();",
    "const artistSearchCache = new Map();",
    "function matchesTrackQuery(",
    "if (searchResultCache.size <= 20)",
    "if (artistSearchCache.size <= 20)",
):
    if forbidden_fragment in source:
        raise SystemExit(f"stale search implementation remains: {forbidden_fragment}")

renderer_path.write_text(source, encoding="utf-8")
print(f"renderer.js is now {len(source.encode('utf-8'))} bytes")
