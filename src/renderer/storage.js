export const STORAGE_KEYS = {
  likedTracks: "apollo-liked-tracks",
  layout: "apollo-layout-v1",
  settings: "apollo-settings-v1",
  playbackState: "apollo-playback-state-v1",
  playbackQueue: "apollo-playback-queue-v1",
  authSession: "apollo-auth-session-v1",
  clientId: "apollo-client-id-v1"
};

function safeGetItem(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetItem(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Ignore persistence failures.
  }
}

function safeParseJson(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function createClientId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `apollo-client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadClientId(storage) {
  const existingClientId = safeGetItem(storage, STORAGE_KEYS.clientId);
  if (existingClientId) {
    return existingClientId;
  }

  const clientId = createClientId();
  safeSetItem(storage, STORAGE_KEYS.clientId, clientId);
  return clientId;
}

export function loadLikedTracks(storage) {
  const items = safeParseJson(safeGetItem(storage, STORAGE_KEYS.likedTracks), []);
  if (!Array.isArray(items)) {
    return new Map();
  }

  return new Map(items.flatMap((entry) => {
    if (Array.isArray(entry) && entry.length >= 2) {
      return [[entry[0], entry[1]]];
    }

    if (entry && typeof entry === "object" && typeof entry.key === "string") {
      return [[entry.key, entry]];
    }

    return [];
  }));
}

export function persistLikedTracks(storage, likedTracks) {
  safeSetItem(
    storage,
    STORAGE_KEYS.likedTracks,
    JSON.stringify(Array.from(likedTracks.entries()))
  );
}

export function loadAuthSession(storage) {
  const parsed = safeParseJson(safeGetItem(storage, STORAGE_KEYS.authSession), {});
  return {
    token: typeof parsed?.token === "string" ? parsed.token : "",
    expiresAt: typeof parsed?.expiresAt === "string" ? parsed.expiresAt : ""
  };
}

export function persistAuthSession(storage, auth) {
  safeSetItem(
    storage,
    STORAGE_KEYS.authSession,
    JSON.stringify({
      token: auth?.token || "",
      expiresAt: auth?.expiresAt || ""
    })
  );
}

export function clearAuthSession(storage) {
  safeRemoveItem(storage, STORAGE_KEYS.authSession);
}

export function loadSettings(storage, defaultSettings, mergeSettings) {
  const raw = safeGetItem(storage, STORAGE_KEYS.settings);
  if (!raw) {
    return structuredClone(defaultSettings);
  }

  return mergeSettings(defaultSettings, safeParseJson(raw, {}));
}

export function persistSettings(storage, settings) {
  safeSetItem(storage, STORAGE_KEYS.settings, JSON.stringify(settings));
}

export function loadPlaybackState(storage) {
  return safeParseJson(safeGetItem(storage, STORAGE_KEYS.playbackState), {});
}

export function loadPlaybackQueue(storage) {
  return safeParseJson(safeGetItem(storage, STORAGE_KEYS.playbackQueue), null);
}

export function persistPlaybackState(storage, payload) {
  safeSetItem(storage, STORAGE_KEYS.playbackState, JSON.stringify(payload));
}

export function persistPlaybackQueue(storage, payload) {
  if (
    !payload?.manualQueue?.length
    && !payload?.contextQueue?.length
    && !payload?.autoplayQueue?.length
  ) {
    safeRemoveItem(storage, STORAGE_KEYS.playbackQueue);
    return;
  }

  safeSetItem(storage, STORAGE_KEYS.playbackQueue, JSON.stringify(payload));
}

export function loadLayout(storage, defaultLayout, clampWidth) {
  const parsed = safeParseJson(safeGetItem(storage, STORAGE_KEYS.layout), null);
  if (!parsed || typeof parsed !== "object") {
    return structuredClone(defaultLayout);
  }

  const order = Array.isArray(parsed.order)
    ? parsed.order.filter((id) => ["sidebar", "tracks", "detail"].includes(id))
    : defaultLayout.order;

  return {
    order: order.length === 3 ? order : [...defaultLayout.order],
    widths: {
      sidebar: clampWidth(parsed?.widths?.sidebar, defaultLayout.widths.sidebar),
      detail: clampWidth(parsed?.widths?.detail, defaultLayout.widths.detail)
    },
    hidden: {
      sidebar: Boolean(parsed?.hidden?.sidebar),
      detail: Boolean(parsed?.hidden?.detail)
    }
  };
}

export function persistLayout(storage, layout) {
  safeSetItem(storage, STORAGE_KEYS.layout, JSON.stringify(layout));
}

export function loadPositiveNumberMap(storage, key) {
  const parsed = safeParseJson(safeGetItem(storage, key), []);
  if (!Array.isArray(parsed)) {
    return new Map();
  }

  return new Map(parsed.filter((entry) => {
    return Array.isArray(entry)
      && typeof entry[0] === "string"
      && Number.isFinite(Number(entry[1]))
      && Number(entry[1]) > 0;
  }).map(([entryKey, value]) => [entryKey, Number(value)]));
}

export function persistPositiveNumberMap(storage, key, valueMap, { limit } = {}) {
  let entries = Array.from(valueMap?.entries?.() || [])
    .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0);

  if (Number.isInteger(limit) && limit > 0) {
    entries = entries.slice(-limit);
  }

  safeSetItem(storage, key, JSON.stringify(entries));
}

export function loadLibrarySnapshot(storage, key, { apiBase, normaliseTrack } = {}) {
  const snapshot = safeParseJson(safeGetItem(storage, key), null);
  if (!snapshot || snapshot.apiBase !== apiBase) {
    return null;
  }

  const trackNormaliser = typeof normaliseTrack === "function"
    ? normaliseTrack
    : (track) => track;

  return {
    libraryTracks: Array.isArray(snapshot.libraryTracks)
      ? snapshot.libraryTracks.map(trackNormaliser)
      : [],
    playlists: Array.isArray(snapshot.playlists)
      ? snapshot.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name || "Untitled Playlist",
        description: playlist.description || "",
        artworkUrl: playlist.artworkUrl || "",
        tracks: Array.isArray(playlist.tracks)
          ? playlist.tracks.map(trackNormaliser)
          : []
      }))
      : []
  };
}

export function persistLibrarySnapshot(
  storage,
  key,
  {
    apiBase,
    libraryTracks = [],
    playlists = [],
    serialiseTrack
  } = {}
) {
  const trackSerialiser = typeof serialiseTrack === "function"
    ? serialiseTrack
    : (track) => track;

  safeSetItem(storage, key, JSON.stringify({
    apiBase,
    savedAt: Date.now(),
    libraryTracks: libraryTracks.map(trackSerialiser),
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      artworkUrl: playlist.artworkUrl,
      tracks: Array.isArray(playlist.tracks)
        ? playlist.tracks.map(trackSerialiser)
        : []
    }))
  }));
}
