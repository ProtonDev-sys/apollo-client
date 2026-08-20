import { normaliseMetadataText } from "./track-model.js";

const SEARCH_MARK_PATTERN = /\p{M}+/gu;
const SEARCH_SEPARATOR_PATTERN = /[^\p{L}\p{N}]+/gu;
const MAX_PREFIX_LENGTH = 32;

function addIndexValue(index, key, value) {
  if (!key) {
    return;
  }

  const values = index.get(key);
  if (values) {
    values.add(value);
    return;
  }

  index.set(key, new Set([value]));
}

function intersectSets(left, right) {
  if (!left) {
    return new Set(right);
  }

  const [smaller, larger] = left.size <= right.size
    ? [left, right]
    : [right, left];
  const result = new Set();

  smaller.forEach((value) => {
    if (larger.has(value)) {
      result.add(value);
    }
  });
  return result;
}

function getTrackGenreText(track = {}) {
  return Array.isArray(track.genre)
    ? track.genre.join(" ")
    : String(track.genre || "");
}

function getFieldScore(field, query, tokens, weights) {
  if (!field) {
    return 0;
  }

  let score = 0;
  if (field === query) {
    score += weights.exact;
  } else if (field.startsWith(query)) {
    score += weights.prefix;
  } else if (field.includes(query)) {
    score += weights.phrase;
  }

  tokens.forEach((token) => {
    if (field === token) {
      score += weights.tokenExact;
    } else if (field.startsWith(token)) {
      score += weights.tokenPrefix;
    } else if (field.includes(token)) {
      score += weights.tokenContains;
    }
  });

  return score;
}

export function normaliseSearchText(value) {
  return normaliseMetadataText(
    String(value || "")
      .normalize("NFKD")
      .replace(SEARCH_MARK_PATTERN, " ")
      .replace(SEARCH_SEPARATOR_PATTERN, " ")
  );
}

export function tokenizeSearchQuery(query) {
  return Array.from(new Set(
    normaliseSearchText(query)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
  ));
}

export function shouldSearchRemote(query, { minimumCharacters = 2 } = {}) {
  const compactQuery = normaliseSearchText(query).replace(/\s+/g, "");
  return compactQuery.length >= Math.max(1, Number(minimumCharacters) || 2);
}

export function createTrackSearchDocument(track, sourceIndex = 0) {
  const title = normaliseSearchText(track?.normalizedTitle || track?.title);
  const artist = normaliseSearchText(track?.normalizedArtist || track?.artist);
  const album = normaliseSearchText(track?.normalizedAlbum || track?.album);
  const albumArtist = normaliseSearchText(track?.albumArtist);
  const genre = normaliseSearchText(getTrackGenreText(track));
  const provider = normaliseSearchText(track?.provider || track?.sourcePlatform);
  const all = [title, artist, album, albumArtist, genre, provider]
    .filter(Boolean)
    .join(" ");

  return {
    track,
    sourceIndex,
    title,
    artist,
    album,
    albumArtist,
    genre,
    provider,
    all,
    tokens: tokenizeSearchQuery(all)
  };
}

export function buildTrackSearchIndex(tracks = []) {
  const documents = (Array.isArray(tracks) ? tracks : [])
    .filter(Boolean)
    .map((track, index) => createTrackSearchDocument(track, index));
  const exactTokenIndex = new Map();
  const prefixTokenIndex = new Map();

  documents.forEach((document, documentIndex) => {
    document.tokens.forEach((token) => {
      addIndexValue(exactTokenIndex, token, documentIndex);
      const prefixLimit = Math.min(token.length, MAX_PREFIX_LENGTH);
      for (let length = 1; length <= prefixLimit; length += 1) {
        addIndexValue(prefixTokenIndex, token.slice(0, length), documentIndex);
      }
    });
  });

  return {
    documents,
    exactTokenIndex,
    prefixTokenIndex
  };
}

export function scoreTrackSearchDocument(document, query, queryTokens) {
  if (!document?.track || !query || !queryTokens.length) {
    return Number.NEGATIVE_INFINITY;
  }

  if (!queryTokens.every((token) => document.all.includes(token))) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  score += getFieldScore(document.title, query, queryTokens, {
    exact: 1600,
    prefix: 1200,
    phrase: 900,
    tokenExact: 220,
    tokenPrefix: 150,
    tokenContains: 90
  });
  score += getFieldScore(document.artist, query, queryTokens, {
    exact: 900,
    prefix: 700,
    phrase: 520,
    tokenExact: 130,
    tokenPrefix: 90,
    tokenContains: 55
  });
  score += getFieldScore(document.album, query, queryTokens, {
    exact: 520,
    prefix: 400,
    phrase: 280,
    tokenExact: 75,
    tokenPrefix: 48,
    tokenContains: 28
  });
  score += getFieldScore(document.albumArtist, query, queryTokens, {
    exact: 360,
    prefix: 280,
    phrase: 190,
    tokenExact: 50,
    tokenPrefix: 32,
    tokenContains: 18
  });
  score += getFieldScore(document.genre, query, queryTokens, {
    exact: 170,
    prefix: 130,
    phrase: 95,
    tokenExact: 28,
    tokenPrefix: 18,
    tokenContains: 10
  });

  if (document.track.resultSource === "library" || document.track.provider === "library") {
    score += 35;
  }

  return score;
}

export function searchTrackIndex(index, query, { limit = Number.POSITIVE_INFINITY } = {}) {
  const normalizedQuery = normaliseSearchText(query);
  const queryTokens = tokenizeSearchQuery(normalizedQuery);
  if (!normalizedQuery || !queryTokens.length || !index?.documents?.length) {
    return [];
  }

  let candidateIndexes = null;
  queryTokens.forEach((token) => {
    const indexedCandidates = index.exactTokenIndex.get(token)
      || index.prefixTokenIndex.get(token);
    const tokenCandidates = indexedCandidates || new Set(
      index.documents
        .map((document, documentIndex) => document.all.includes(token) ? documentIndex : -1)
        .filter((documentIndex) => documentIndex >= 0)
    );
    candidateIndexes = intersectSets(candidateIndexes, tokenCandidates);
  });

  const maximumResults = Number.isFinite(Number(limit))
    ? Math.max(0, Number(limit))
    : Number.POSITIVE_INFINITY;

  return Array.from(candidateIndexes || [])
    .map((documentIndex) => {
      const document = index.documents[documentIndex];
      return {
        document,
        score: scoreTrackSearchDocument(document, normalizedQuery, queryTokens)
      };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.document.sourceIndex - right.document.sourceIndex;
    })
    .slice(0, maximumResults)
    .map((entry) => entry.document.track);
}

export function createTrackSearchEngine({ maxIndexes = 12 } = {}) {
  const indexCache = new Map();
  const maximumIndexes = Math.max(1, Number(maxIndexes) || 12);

  function getIndex(tracks, cacheKey = "") {
    const resolvedKey = String(cacheKey || "").trim();
    if (!resolvedKey) {
      return buildTrackSearchIndex(tracks);
    }

    const cached = indexCache.get(resolvedKey);
    if (cached) {
      indexCache.delete(resolvedKey);
      indexCache.set(resolvedKey, cached);
      return cached;
    }

    const index = buildTrackSearchIndex(tracks);
    indexCache.set(resolvedKey, index);
    while (indexCache.size > maximumIndexes) {
      indexCache.delete(indexCache.keys().next().value);
    }
    return index;
  }

  return {
    search(tracks, query, options = {}) {
      return searchTrackIndex(
        getIndex(tracks, options.cacheKey),
        query,
        options
      );
    },
    clear() {
      indexCache.clear();
    },
    delete(cacheKey) {
      return indexCache.delete(String(cacheKey || "").trim());
    },
    get size() {
      return indexCache.size;
    }
  };
}

export function createLruTtlCache({
  maxEntries = 40,
  ttlMs = 2 * 60 * 1000,
  now = () => Date.now()
} = {}) {
  const entries = new Map();
  const maximumEntries = Math.max(1, Number(maxEntries) || 40);
  const lifetimeMs = Math.max(0, Number(ttlMs) || 0);

  function isExpired(entry) {
    return Boolean(entry && lifetimeMs > 0 && entry.expiresAt <= now());
  }

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (isExpired(entry)) {
      entries.delete(key);
      return undefined;
    }

    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    entries.delete(key);
    entries.set(key, {
      value,
      expiresAt: lifetimeMs > 0 ? now() + lifetimeMs : Number.POSITIVE_INFINITY
    });

    while (entries.size > maximumEntries) {
      entries.delete(entries.keys().next().value);
    }
    return cache;
  }

  const cache = {
    get,
    set,
    has(key) {
      return get(key) !== undefined;
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    keys() {
      return entries.keys();
    },
    get size() {
      return entries.size;
    }
  };
  return cache;
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (typeof mapper !== "function") {
    throw new TypeError("Search concurrency mapper must be a function.");
  }

  const workerCount = Math.min(
    sourceItems.length,
    Math.max(1, Number(concurrency) || 1)
  );
  const results = new Array(sourceItems.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < sourceItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(sourceItems[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
