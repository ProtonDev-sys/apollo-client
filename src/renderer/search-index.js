export function normaliseSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseGenre(genre) {
  return Array.isArray(genre)
    ? genre.map(normaliseSearchText).filter(Boolean).join(" ")
    : normaliseSearchText(genre);
}

function createTrackSignature(track = {}) {
  return JSON.stringify([
    track.key || "",
    track.title || "",
    track.artist || "",
    Array.isArray(track.artists) ? track.artists : track.artists || "",
    track.album || "",
    track.albumArtist || "",
    track.genre || "",
    track.fileName || "",
    track.filePath || "",
    track.duration || 0
  ]);
}

export function createTrackSearchDocument(track = {}) {
  const title = normaliseSearchText(track.title);
  const artist = normaliseSearchText(track.artist);
  const artists = Array.isArray(track.artists)
    ? track.artists.map(normaliseSearchText).filter(Boolean).join(" ")
    : normaliseSearchText(track.artists);
  const album = normaliseSearchText(track.album);
  const albumArtist = normaliseSearchText(track.albumArtist);
  const genre = normaliseGenre(track.genre);
  const fileName = normaliseSearchText(track.fileName || track.filePath);
  const titleArtist = [title, artist].filter(Boolean).join(" ");
  const artistTitle = [artist, title].filter(Boolean).join(" ");
  const searchableText = [title, artist, artists, album, albumArtist, genre, fileName]
    .filter(Boolean)
    .join(" ");

  return {
    track,
    signature: createTrackSignature(track),
    title,
    artist,
    artists,
    album,
    albumArtist,
    genre,
    fileName,
    titleArtist,
    artistTitle,
    searchableText,
    titleWords: new Set(title.split(" ").filter(Boolean)),
    artistWords: new Set([artist, artists].filter(Boolean).join(" ").split(" ").filter(Boolean)),
    albumWords: new Set([album, albumArtist].filter(Boolean).join(" ").split(" ").filter(Boolean))
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

  const tokens = normalisedQuery.split(" ").filter(Boolean);
  if (!tokens.length || !tokens.every((token) => document.searchableText.includes(token))) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
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

export function createTrackSearchIndex({ maxEntries = 10000 } = {}) {
  const documents = new Map();
  const safeMaxEntries = Math.max(1, Number(maxEntries) || 1);

  function getDocument(track) {
    const trackKey = String(track?.key || track?.trackId || track?.id || "").trim();
    if (!trackKey) {
      return createTrackSearchDocument(track);
    }

    const signature = createTrackSignature(track);
    const cached = documents.get(trackKey);
    if (cached?.signature === signature) {
      documents.delete(trackKey);
      documents.set(trackKey, cached);
      return cached;
    }

    const document = createTrackSearchDocument(track);
    documents.delete(trackKey);
    documents.set(trackKey, document);
    while (documents.size > safeMaxEntries) {
      documents.delete(documents.keys().next().value);
    }
    return document;
  }

  function search(tracks, query) {
    const normalisedQuery = normaliseSearchText(query);
    if (!normalisedQuery) {
      return Array.isArray(tracks) ? [...tracks] : [];
    }

    return (Array.isArray(tracks) ? tracks : [])
      .map((track, index) => {
        const document = getDocument(track);
        return {
          track,
          index,
          score: scoreTrackSearchDocument(document, normalisedQuery)
        };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.index - right.index;
      })
      .map((entry) => entry.track);
  }

  return {
    search,
    clear: () => documents.clear(),
    getSize: () => documents.size
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
  const safeMaxEntries = Math.max(1, Number(maxEntries) || 1);
  const safeTtlMs = Math.max(0, Number(ttlMs) || 0);

  function get(key) {
    const entry = entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= now()) {
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
      expiresAt: now() + safeTtlMs
    });

    while (entries.size > safeMaxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  return {
    get,
    set,
    clear: () => entries.clear(),
    getSize: () => entries.size
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
  const keyIndexes = new Map();
  const equivalence = typeof isEquivalent === "function"
    ? isEquivalent
    : (left, right) => Boolean(left?.key && right?.key && left.key === right.key);

  for (const track of [...(localTracks || []), ...(remoteTracks || [])]) {
    if (!track) {
      continue;
    }

    const key = String(track.key || "").trim();
    if (key && keyIndexes.has(key)) {
      continue;
    }
    if (result.some((candidate) => equivalence(candidate, track))) {
      continue;
    }

    if (key) {
      keyIndexes.set(key, result.length);
    }
    result.push(track);
  }

  return result;
}
