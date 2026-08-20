const SEARCH_MARK_PATTERN = /\p{M}+/gu;
const SEARCH_SEPARATOR_PATTERN = /[^\p{L}\p{N}]+/gu;
const SUBSTRING_GRAM_LENGTH = 3;
const MAX_PREFIX_LENGTH = SUBSTRING_GRAM_LENGTH;

export function normaliseSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(SEARCH_MARK_PATTERN, "")
    .toLowerCase()
    .replace(SEARCH_SEPARATOR_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchQuery(value) {
  return Array.from(new Set(
    normaliseSearchText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
  ));
}

export function shouldSearchRemote(query, { minimumCharacters = 2 } = {}) {
  const compactQuery = normaliseSearchText(query).replace(/\s+/g, "");
  return compactQuery.length >= Math.max(1, Number(minimumCharacters) || 2);
}

function normaliseGenre(genre) {
  return Array.isArray(genre)
    ? genre.map(normaliseSearchText).filter(Boolean).join(" ")
    : normaliseSearchText(genre);
}

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

function unionSets(...sets) {
  const result = new Set();
  for (const set of sets) {
    if (!set) {
      continue;
    }
    for (const value of set) {
      result.add(value);
    }
  }
  return result;
}

function intersectSets(left, right) {
  if (!left) {
    return new Set(right);
  }

  const [smaller, larger] = left.size <= right.size
    ? [left, right]
    : [right, left];
  const result = new Set();

  for (const value of smaller) {
    if (larger.has(value)) {
      result.add(value);
    }
  }
  return result;
}

function createSubstringGrams(token) {
  if (token.length < SUBSTRING_GRAM_LENGTH) {
    return [];
  }

  const grams = new Set();
  for (let index = 0; index <= token.length - SUBSTRING_GRAM_LENGTH; index += 1) {
    grams.add(token.slice(index, index + SUBSTRING_GRAM_LENGTH));
  }
  return Array.from(grams);
}

export function createTrackSearchDocument(track = {}, sourceIndex = 0) {
  const title = normaliseSearchText(track.normalizedTitle || track.title);
  const artist = normaliseSearchText(track.normalizedArtist || track.artist);
  const artists = Array.isArray(track.artists)
    ? track.artists.map(normaliseSearchText).filter(Boolean).join(" ")
    : normaliseSearchText(track.artists);
  const album = normaliseSearchText(track.normalizedAlbum || track.album);
  const albumArtist = normaliseSearchText(track.albumArtist);
  const genre = normaliseGenre(track.genre);
  const fileName = normaliseSearchText(track.fileName || track.filePath);
  const provider = normaliseSearchText(track.provider || track.sourcePlatform);
  const titleArtist = [title, artist].filter(Boolean).join(" ");
  const artistTitle = [artist, title].filter(Boolean).join(" ");
  const searchableText = [
    title,
    artist,
    artists,
    album,
    albumArtist,
    genre,
    fileName,
    provider
  ].filter(Boolean).join(" ");

  return {
    track,
    sourceIndex,
    title,
    artist,
    artists,
    album,
    albumArtist,
    genre,
    fileName,
    provider,
    titleArtist,
    artistTitle,
    searchableText,
    tokens: tokenizeSearchQuery(searchableText),
    titleWords: new Set(title.split(" ").filter(Boolean)),
    artistWords: new Set([artist, artists].filter(Boolean).join(" ").split(" ").filter(Boolean)),
    albumWords: new Set([album, albumArtist].filter(Boolean).join(" ").split(" ").filter(Boolean)),
    isLocal: track.resultSource === "library" || track.provider === "library"
  };
}

function scoreToken(document, token) {
  let score = 0;

  if (document.titleWords.has(token)) {
    score = Math.max(score, 38);
  } else if (document.title.startsWith(token)) {
    score = Math.max(score, 31);
  } else if (document.title.includes(token)) {
    score = Math.max(score, 24);
  }

  if (document.artistWords.has(token)) {
    score = Math.max(score, 35);
  } else if (document.artist.startsWith(token) || document.artists.startsWith(token)) {
    score = Math.max(score, 29);
  } else if (document.artist.includes(token) || document.artists.includes(token)) {
    score = Math.max(score, 22);
  }

  if (document.albumWords.has(token)) {
    score = Math.max(score, 16);
  } else if (document.album.includes(token) || document.albumArtist.includes(token)) {
    score = Math.max(score, 11);
  }

  if (document.genre.includes(token)) {
    score = Math.max(score, 7);
  }
  if (document.fileName.includes(token)) {
    score = Math.max(score, 4);
  }

  return score;
}

export function scoreTrackSearchDocument(document, query) {
  const normalisedQuery = normaliseSearchText(query);
  if (!normalisedQuery) {
    return 0;
  }

  const tokens = tokenizeSearchQuery(normalisedQuery);
  if (!tokens.length || !tokens.every((token) => document.searchableText.includes(token))) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = document.isLocal ? 35 : 0;
  if (document.title === normalisedQuery) {
    score += 260;
  }
  if (document.artist === normalisedQuery || document.artists === normalisedQuery) {
    score += 225;
  }
  if (document.titleArtist === normalisedQuery || document.artistTitle === normalisedQuery) {
    score += 310;
  }
  if (document.title.startsWith(normalisedQuery)) {
    score += 120;
  } else if (document.title.includes(normalisedQuery)) {
    score += 88;
  }
  if (document.artist.startsWith(normalisedQuery) || document.artists.startsWith(normalisedQuery)) {
    score += 104;
  } else if (document.artist.includes(normalisedQuery) || document.artists.includes(normalisedQuery)) {
    score += 76;
  }
  if (document.album === normalisedQuery) {
    score += 54;
  } else if (document.album.startsWith(normalisedQuery)) {
    score += 36;
  } else if (document.album.includes(normalisedQuery)) {
    score += 24;
  }

  for (const token of tokens) {
    score += scoreToken(document, token);
  }

  if (tokens.length > 1) {
    const titleMatches = tokens.filter((token) => document.title.includes(token)).length;
    const artistMatches = tokens.filter((token) =>
      document.artist.includes(token) || document.artists.includes(token)
    ).length;
    score += titleMatches * 10;
    score += artistMatches * 9;
    if (titleMatches && artistMatches) {
      score += 45;
    }
  }

  return score;
}

export function buildTrackSearchIndex(tracks = []) {
  const documents = (Array.isArray(tracks) ? tracks : [])
    .filter(Boolean)
    .map((track, sourceIndex) => createTrackSearchDocument(track, sourceIndex));
  const exactTokenIndex = new Map();
  const prefixTokenIndex = new Map();
  const substringGramIndex = new Map();

  documents.forEach((document, documentIndex) => {
    document.tokens.forEach((token) => {
      addIndexValue(exactTokenIndex, token, documentIndex);
      const prefixLimit = Math.min(token.length, MAX_PREFIX_LENGTH);
      for (let length = 1; length <= prefixLimit; length += 1) {
        addIndexValue(prefixTokenIndex, token.slice(0, length), documentIndex);
      }
      createSubstringGrams(token).forEach((gram) => {
        addIndexValue(substringGramIndex, gram, documentIndex);
      });
    });
  });

  return {
    documents,
    exactTokenIndex,
    prefixTokenIndex,
    substringGramIndex
  };
}

function getSubstringCandidates(index, token) {
  const grams = createSubstringGrams(token);
  if (!grams.length) {
    const candidates = new Set();
    index.documents.forEach((document, documentIndex) => {
      if (document.searchableText.includes(token)) {
        candidates.add(documentIndex);
      }
    });
    return candidates;
  }

  let candidates = null;
  for (const gram of grams) {
    const gramCandidates = index.substringGramIndex.get(gram);
    if (!gramCandidates) {
      return new Set();
    }
    candidates = intersectSets(candidates, gramCandidates);
    if (!candidates.size) {
      return candidates;
    }
  }

  return new Set(
    Array.from(candidates || []).filter((documentIndex) =>
      index.documents[documentIndex].searchableText.includes(token)
    )
  );
}

function getTokenCandidates(index, token) {
  return unionSets(
    index.exactTokenIndex.get(token),
    index.prefixTokenIndex.get(token),
    getSubstringCandidates(index, token)
  );
}

export function searchTrackIndex(index, query, { limit = Number.POSITIVE_INFINITY } = {}) {
  const normalisedQuery = normaliseSearchText(query);
  const queryTokens = tokenizeSearchQuery(normalisedQuery);
  if (!normalisedQuery || !queryTokens.length || !index?.documents?.length) {
    return [];
  }

  let candidateIndexes = null;
  for (const token of queryTokens) {
    candidateIndexes = intersectSets(candidateIndexes, getTokenCandidates(index, token));
    if (!candidateIndexes.size) {
      return [];
    }
  }

  const maximumResults = Number.isFinite(Number(limit))
    ? Math.max(0, Math.trunc(Number(limit)))
    : Number.POSITIVE_INFINITY;

  return Array.from(candidateIndexes)
    .map((documentIndex) => {
      const document = index.documents[documentIndex];
      return {
        document,
        score: scoreTrackSearchDocument(document, normalisedQuery)
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

export function createTrackSearchEngine({ maxIndexes = 18 } = {}) {
  const indexes = new Map();
  const maximumIndexes = Math.max(1, Math.trunc(Number(maxIndexes) || 18));

  function getIndex(tracks, cacheKey = "") {
    const resolvedKey = String(cacheKey || "").trim();
    if (!resolvedKey) {
      return buildTrackSearchIndex(tracks);
    }

    const cached = indexes.get(resolvedKey);
    if (cached) {
      indexes.delete(resolvedKey);
      indexes.set(resolvedKey, cached);
      return cached;
    }

    const index = buildTrackSearchIndex(tracks);
    indexes.set(resolvedKey, index);
    while (indexes.size > maximumIndexes) {
      indexes.delete(indexes.keys().next().value);
    }
    return index;
  }

  return {
    search(tracks, query, options = {}) {
      return searchTrackIndex(getIndex(tracks, options.cacheKey), query, options);
    },
    clear() {
      indexes.clear();
    },
    delete(cacheKey) {
      return indexes.delete(String(cacheKey || "").trim());
    },
    getSize() {
      return indexes.size;
    }
  };
}

function defaultClone(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function createTimedLruCache({
  maxEntries = 40,
  ttlMs = 2 * 60 * 1000,
  clone = defaultClone,
  now = () => Date.now()
} = {}) {
  const entries = new Map();
  const maximumEntries = Math.max(1, Math.trunc(Number(maxEntries) || 40));
  const lifetimeMs = Math.max(0, Number(ttlMs) || 0);

  function isExpired(entry) {
    return Boolean(entry && lifetimeMs > 0 && entry.expiresAt <= now());
  }

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      return null;
    }
    if (isExpired(entry)) {
      entries.delete(key);
      return null;
    }

    entries.delete(key);
    entries.set(key, entry);
    return clone(entry.value);
  }

  function set(key, value) {
    entries.delete(key);
    entries.set(key, {
      value: clone(value),
      expiresAt: lifetimeMs > 0 ? now() + lifetimeMs : Number.POSITIVE_INFINITY
    });

    while (entries.size > maximumEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  return {
    get,
    set,
    has(key) {
      const entry = entries.get(key);
      if (!entry || isExpired(entry)) {
        entries.delete(key);
        return false;
      }
      entries.delete(key);
      entries.set(key, entry);
      return true;
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
    },
    getSize() {
      return entries.size;
    }
  };
}

export function buildSearchCacheKey({
  query,
  scope = "all",
  provider = "",
  providers = [],
  includeLibraryResults = true,
  apiBase = ""
} = {}) {
  const selectedProviders = Array.isArray(providers)
    ? [...new Set(providers.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))].sort()
    : [];

  return JSON.stringify({
    query: normaliseSearchText(query),
    scope: String(scope || "all").trim().toLowerCase(),
    provider: String(provider || "").trim().toLowerCase(),
    providers: selectedProviders,
    includeLibraryResults: Boolean(includeLibraryResults),
    apiBase: String(apiBase || "").replace(/\/+$/, "").toLowerCase()
  });
}

export function mergeSearchTracks(localTracks, remoteTracks, { isEquivalent } = {}) {
  const result = [];
  const seenKeys = new Set();
  const equivalence = typeof isEquivalent === "function"
    ? isEquivalent
    : (left, right) => Boolean(left?.key && right?.key && left.key === right.key);

  for (const track of [...(localTracks || []), ...(remoteTracks || [])]) {
    if (!track) {
      continue;
    }

    const key = String(track.key || "").trim();
    if (key && seenKeys.has(key)) {
      continue;
    }
    if (result.some((candidate) => equivalence(candidate, track))) {
      continue;
    }

    if (key) {
      seenKeys.add(key);
    }
    result.push(track);
  }

  return result;
}
