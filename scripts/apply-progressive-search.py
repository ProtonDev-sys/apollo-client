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
  buildSearchCacheKey as buildClientSearchCacheKey,
  createTimedLruCache,
  createTrackSearchIndex,
  mergeSearchTracks
} from "./renderer/search-index.js";
''',
    "search module imports"
)

replace_once(
    '''const searchResultCache = new Map();
const artistSearchCache = new Map();
''',
    '''const searchResultCache = createTimedLruCache({
  maxEntries: 40,
  ttlMs: 2 * 60 * 1000
});
const trackSearchIndex = createTrackSearchIndex();
const artistSearchCache = new Map();
''',
    "search caches"
)

replace_once(
    '''  searchResultCache.clear();
  artistSearchCache.clear();
''',
    '''  searchResultCache.clear();
  trackSearchIndex.clear();
  artistSearchCache.clear();
''',
    "search index teardown"
)

replace_block(
    "function buildSearchCacheKey(query, options = {}) {",
    "function normaliseArtist(artist = {}) {",
    '''function buildSearchCacheKey(query, options = {}) {
  return buildClientSearchCacheKey({
    query,
    scope: options.scope || "all",
    provider: options.provider || "",
    providers: Array.isArray(options.providers) ? options.providers : getEnabledProviders(),
    includeLibraryResults: state.settings.search.includeLibraryResults,
    apiBase: state.apiBase
  });
}

function readCachedSearchResult(query, options = {}) {
  return searchResultCache.get(buildSearchCacheKey(query, options));
}

function writeCachedSearchResult(query, result, options = {}) {
  searchResultCache.set(buildSearchCacheKey(query, options), result);
}

''',
    "bounded search cache helpers"
)

remote_fetch_replacement = '''async function fetchRemoteSearchResults(query, {
  signal,
  onProgress = () => {}
} = {}) {
  const trimmedQuery = String(query || "").trim();
  const enabledProviders = getEnabledProviders();
  if (!trimmedQuery || !enabledProviders.length) {
    return {
      tracks: [],
      warnings: [],
      progress: null
    };
  }

  const useAllProviders = enabledProviders.length === searchProviderOrder.length;
  const remoteProviderParam = useAllProviders ? "all" : enabledProviders.join(",");
  const cacheOptions = {
    scope: "remote",
    provider: remoteProviderParam,
    providers: enabledProviders
  };
  const cachedResult = readCachedSearchResult(trimmedQuery, cacheOptions);
  if (cachedResult) {
    onProgress({
      ...cachedResult,
      complete: true,
      fromCache: true
    });
    return cachedResult;
  }

  let latestResult = {
    tracks: [],
    warnings: [],
    progress: null
  };
  let receivedEvent = false;
  const streamPath = `${buildSearchRequestPath(trimmedQuery, "remote", remoteProviderParam)}&stream=1`;

  await requestJson.requestEventStream(
    streamPath,
    createSearchRequestOptions({ signal }),
    ({ event, data }) => {
      if (!data || !["message", "snapshot", "done"].includes(event)) {
        return;
      }

      const remotePayload = data.remote || {};
      const progress = remotePayload.progress || null;
      const complete = event === "done" || progress?.complete === true;
      latestResult = {
        tracks: dedupeTracks((remotePayload.items || []).map(normaliseRemoteTrack)),
        warnings: [remotePayload.warning].filter(Boolean),
        progress
      };
      receivedEvent = true;
      onProgress({
        ...latestResult,
        complete,
        fromCache: false
      });
    }
  );

  if (!receivedEvent) {
    return latestResult;
  }

  writeCachedSearchResult(trimmedQuery, latestResult, cacheOptions);
  return latestResult;
}

'''
replace_block(
    "async function fetchRemoteSearchResults(query, { signal } = {}) {",
    "async function fetchArtistSearchResults(query, { signal } = {}) {",
    remote_fetch_replacement,
    "progressive remote search"
)

replace_block(
    "async function enrichArtistSearchResults(artists, { signal } = {}) {",
    "function abortPendingSearchRequest() {",
    "",
    "redundant artist fan-out"
)

replace_block(
    "function matchesTrackQuery(track, query) {",
    "function isCollectionScopedSearch() {",
    '''function getLocalSearchResults(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery || !state.settings.search.includeLibraryResults) {
    return [];
  }

  const baseTracks = (() => {
    if (state.selectedPlaylistId === "liked-tracks") {
      return Array.from(likedTracks.values());
    }

    if (state.selectedPlaylistId && state.selectedPlaylistId !== "all-tracks") {
      return state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId)?.tracks || [];
    }

    return state.libraryTracks;
  })();

  return trackSearchIndex.search(baseTracks, trimmedQuery);
}

''',
    "indexed local search"
)

replace_once(
    '''    searchResultCache.clear();
    state.message = health?.status ? "" : "Apollo responded without a health status.";
''',
    '''    searchResultCache.clear();
    trackSearchIndex.clear();
    state.message = health?.status ? "" : "Apollo responded without a health status.";
''',
    "library refresh search invalidation"
)

replace_once(
    '''    state.searchResults = dedupeTracks([...localTracks, ...remoteResults]);
''',
    '''    state.searchResults = mergeSearchTracks(localTracks, remoteResults, {
      isEquivalent: areTracksEquivalent
    });
''',
    "local and remote result merge"
)

old_artist_task = '''    const artistTask = fetchArtistSearchResults(query, { signal: abortController.signal })
      .then((artists) => {
        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        artistResults = artists;
        publishSearchProgress();
        return enrichArtistSearchResults(artists, { signal: abortController.signal })
          .then((enrichedArtists) => {
            if (!isSearchRequestCurrent(requestId, query)) {
              return;
            }

            artistResults = enrichedArtists;
            writeCachedArtistSearchResult(query, enrichedArtists);
            publishSearchProgress();
          });
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          throw error;
        }
      });
'''
new_artist_task = '''    const artistTask = fetchArtistSearchResults(query, { signal: abortController.signal })
      .then((artists) => {
        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        artistResults = artists;
        publishSearchProgress();
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          throw error;
        }
      });
'''
replace_once(old_artist_task, new_artist_task, "single-request artist search")

old_remote_task = '''    const remoteTask = fetchRemoteSearchResults(query, { signal: abortController.signal })
      .then(({ tracks, warnings }) => {
        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        remoteResults = tracks;
        searchWarnings.splice(0, searchWarnings.length, ...warnings);
        remotePending = false;
        publishSearchProgress();
      })
      .catch((error) => {
        if (isAbortError(error)) {
          return;
        }

        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        remotePending = false;
        searchWarnings.splice(0, searchWarnings.length, error.message);
        publishSearchProgress();
      });
'''
new_remote_task = '''    const remoteTask = fetchRemoteSearchResults(query, {
      signal: abortController.signal,
      onProgress({ tracks, warnings, complete }) {
        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        remoteResults = tracks;
        searchWarnings.splice(
          0,
          searchWarnings.length,
          ...Array.from(new Set(warnings.filter(Boolean)))
        );
        remotePending = !complete;
        publishSearchProgress();
      }
    })
      .then(({ tracks, warnings }) => {
        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        remoteResults = tracks;
        searchWarnings.splice(
          0,
          searchWarnings.length,
          ...Array.from(new Set(warnings.filter(Boolean)))
        );
        remotePending = false;
        publishSearchProgress();
      })
      .catch((error) => {
        if (isAbortError(error)) {
          return;
        }

        if (!isSearchRequestCurrent(requestId, query)) {
          return;
        }

        remotePending = false;
        searchWarnings.splice(0, searchWarnings.length, error.message);
        publishSearchProgress();
      });
'''
replace_once(old_remote_task, new_remote_task, "progressive search publishing")

required_fragments = (
    'from "./renderer/search-index.js"',
    "requestJson.requestEventStream(",
    "trackSearchIndex.search(baseTracks, trimmedQuery)",
    "mergeSearchTracks(localTracks, remoteResults",
    "onProgress({ tracks, warnings, complete })",
)
for fragment in required_fragments:
    if fragment not in source:
        raise SystemExit(f"required renderer fragment is missing: {fragment}")

for forbidden_fragment in (
    "function matchesTrackQuery(",
    "async function enrichArtistSearchResults(",
    "const searchResultCache = new Map();",
):
    if forbidden_fragment in source:
        raise SystemExit(f"stale renderer fragment remains: {forbidden_fragment}")

renderer_path.write_text(source, encoding="utf-8")
print(f"renderer.js is now {len(source.encode('utf-8'))} bytes")
