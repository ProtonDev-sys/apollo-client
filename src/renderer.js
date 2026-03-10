import { createPluginHost } from "./plugin-host.js";
import { builtinPlugins } from "./plugins/index.js";

const LIKED_STORAGE_KEY = "apollo-liked-tracks";
const LAYOUT_STORAGE_KEY = "apollo-layout-v1";
const SETTINGS_STORAGE_KEY = "apollo-settings-v1";
const PLAYBACK_STATE_STORAGE_KEY = "apollo-playback-state-v1";
const AUTH_STORAGE_KEY = "apollo-auth-session-v1";
const DEFAULT_LAYOUT = {
  order: ["sidebar", "tracks", "detail"],
  widths: {
    sidebar: 270,
    detail: 360
  },
  hidden: {
    sidebar: false,
    detail: false
  }
};
const DEFAULT_SETTINGS = {
  playback: {
    autoplaySelection: true,
    restoreLastTrack: true,
    pauseOnBlur: false,
    defaultRepeatMode: "off",
    previousSeekThreshold: 3,
    playbackRate: 1
  },
  audio: {
    volume: 0.72,
    muted: false,
    volumeStep: 0.05,
    preloadMode: "auto"
  },
  search: {
    includeLibraryResults: true,
    providers: {
      youtube: true,
      spotify: true,
      soundcloud: true
    },
    liveSearchDelayMs: 220
  },
  downloads: {
    autoRefreshLibrary: true
  }
};
const searchProviderOrder = ["youtube", "spotify", "soundcloud"];
const initialSettings = loadSettings();
const savedPlaybackState = loadPlaybackState();
const savedAuthSession = loadAuthSession();

function createPlaylistModalState(overrides = {}) {
  return {
    isOpen: false,
    initialTrackId: null,
    mode: "create",
    playlistId: null,
    artworkUrl: "",
    artworkPreviewUrl: "",
    artworkFile: null,
    removeArtwork: false,
    confirmDelete: false,
    ...overrides
  };
}

const state = {
  apiBase: window.apolloDesktop?.serverUrl || "http://127.0.0.1:4848",
  layout: loadLayout(),
  settings: initialSettings,
  auth: {
    enabled: false,
    configured: false,
    sessionTtlHours: 0,
    token: savedAuthSession.token || "",
    expiresAt: savedAuthSession.expiresAt || "",
    modalOpen: false
  },
  libraryTracks: [],
  playlists: [],
  selectedPlaylistId: savedPlaybackState.selectedPlaylistId || "all-tracks",
  selectedTrackKey: savedPlaybackState.selectedTrackKey || null,
  playbackTrackKey: savedPlaybackState.playbackTrackKey || null,
  activeMenuTrackKey: null,
  activeMenuAnchor: null,
  activeDetailTab: savedPlaybackState.activeDetailTab || "track",
  query: "",
  searchResults: [],
  isConnected: false,
  isLoading: false,
  isBuffering: false,
  isPlaying: false,
  message: "",
  repeatMode: savedPlaybackState.repeatMode || initialSettings.playback.defaultRepeatMode,
  searchTimer: null,
  modal: createPlaylistModalState(),
  settingsModalOpen: false,
  restoredPlaybackKey: savedPlaybackState.playbackTrackKey || null,
  wasPlayingBeforeBlur: false
};
const playbackState = {
  currentTime: savedPlaybackState.currentTime || 0
};

const durationCache = new Map();
const playbackUrlCache = new Map();
const pendingDurationKeys = new Set();
const likedTracks = loadLikedTracks();
const pluginHost = createPluginHost({
  escapeHtml,
  formatDuration,
  providerLabel
});

let detailTabCleanup = null;
let resizeSession = null;

const workspace = document.querySelector("#workspace");
const sidebarPanel = document.querySelector("#sidebar-panel");
const trackPanel = document.querySelector("#track-panel");
const detailPanel = document.querySelector("#detail-panel");
const panelElements = {
  sidebar: sidebarPanel,
  tracks: trackPanel,
  detail: detailPanel
};
const resizers = Array.from(document.querySelectorAll("[data-resizer]"));

const playlistList = document.querySelector("#playlist-list");
const trackList = document.querySelector("#track-list");
const createPlaylistButton = document.querySelector("#create-playlist-button");
const editPlaylistButton = document.querySelector("#edit-playlist-button");
const toggleSidebarButton = document.querySelector("#toggle-sidebar-button");
const toggleDetailButton = document.querySelector("#toggle-detail-button");
const resetLayoutButton = document.querySelector("#reset-layout-button");
const searchInput = document.querySelector("#library-search");
const nowPlaying = document.querySelector("#now-playing");
const serverStatus = document.querySelector("#server-status");
const trackPaneKicker = document.querySelector("#track-pane-kicker");
const trackPaneTitle = document.querySelector("#track-pane-title");
const trackPaneMeta = document.querySelector("#track-pane-meta");
const progressCurrent = document.querySelector("#progress-current");
const progressTotal = document.querySelector("#progress-total");
const progressFill = document.querySelector("#progress-fill");
const progressButton = document.querySelector("#progress-button");
const audioPlayer = document.querySelector("#audio-player");
const repeatButton = document.querySelector("#repeat-button");
const playButton = document.querySelector("#play-button");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const volumeSlider = document.querySelector("#volume-slider");
const volumeButton = document.querySelector("#volume-button");

const playlistModal = document.querySelector("#playlist-modal");
const playlistForm = document.querySelector("#playlist-form");
const playlistFormMessage = document.querySelector("#playlist-form-message");
const playlistNameInput = document.querySelector("#playlist-name-input");
const playlistDescriptionInput = document.querySelector("#playlist-description-input");
const playlistModalTitle = document.querySelector("#playlist-modal-title");
const playlistModalClose = document.querySelector("#playlist-modal-close");
const playlistFormCancel = document.querySelector("#playlist-form-cancel");
const playlistSubmitButton = document.querySelector("#playlist-submit-button");
const playlistDeleteButton = document.querySelector("#playlist-delete-button");
const playlistArtworkInput = document.querySelector("#playlist-artwork-input");
const playlistArtworkPreview = document.querySelector("#playlist-artwork-preview");
const playlistArtworkStatus = document.querySelector("#playlist-artwork-status");
const playlistArtworkClear = document.querySelector("#playlist-artwork-clear");
const authButton = document.querySelector("#auth-button");
const authModal = document.querySelector("#auth-modal");
const authForm = document.querySelector("#auth-form");
const authSecretInput = document.querySelector("#auth-secret-input");
const authFormCopy = document.querySelector("#auth-form-copy");
const authFormMessage = document.querySelector("#auth-form-message");
const authSubmitButton = document.querySelector("#auth-submit-button");
const openSettingsButton = document.querySelector("#open-settings-button");
const settingsModal = document.querySelector("#settings-modal");
const settingsForm = document.querySelector("#settings-form");
const settingsModalClose = document.querySelector("#settings-modal-close");
const settingsFormCancel = document.querySelector("#settings-form-cancel");
const settingsFormMessage = document.querySelector("#settings-form-message");
const settingsAutoplaySelection = document.querySelector("#settings-autoplay-selection");
const settingsRestoreLastTrack = document.querySelector("#settings-restore-last-track");
const settingsPauseOnBlur = document.querySelector("#settings-pause-on-blur");
const settingsDefaultRepeat = document.querySelector("#settings-default-repeat");
const settingsPreviousThreshold = document.querySelector("#settings-previous-threshold");
const settingsPlaybackRate = document.querySelector("#settings-playback-rate");
const settingsVolume = document.querySelector("#settings-volume");
const settingsMuted = document.querySelector("#settings-muted");
const settingsVolumeStep = document.querySelector("#settings-volume-step");
const settingsPreloadMode = document.querySelector("#settings-preload-mode");
const settingsIncludeLibrary = document.querySelector("#settings-include-library");
const settingsProviderYoutube = document.querySelector("#settings-provider-youtube");
const settingsProviderSpotify = document.querySelector("#settings-provider-spotify");
const settingsProviderSoundcloud = document.querySelector("#settings-provider-soundcloud");
const settingsSearchDelay = document.querySelector("#settings-search-delay");
const settingsAutoRefreshLibrary = document.querySelector("#settings-auto-refresh-library");

function loadLikedTracks() {
  try {
    const raw = localStorage.getItem(LIKED_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const items = JSON.parse(raw);
    if (!Array.isArray(items)) {
      return new Map();
    }

    return new Map(items.map((item) => [item.key, item]));
  } catch {
    return new Map();
  }
}

function persistLikedTracks() {
  localStorage.setItem(
    LIKED_STORAGE_KEY,
    JSON.stringify(Array.from(likedTracks.values()))
  );
}

function loadAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const session = JSON.parse(raw);
    return {
      token: typeof session.token === "string" ? session.token : "",
      expiresAt: typeof session.expiresAt === "string" ? session.expiresAt : ""
    };
  } catch {
    return {};
  }
}

function persistAuthSession() {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      token: state.auth.token,
      expiresAt: state.auth.expiresAt
    })
  );
}

function clearAuthSession() {
  state.auth.token = "";
  state.auth.expiresAt = "";
  persistAuthSession();
  playbackUrlCache.clear();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_SETTINGS);
    }

    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function mergeSettings(base, override) {
  const merged = structuredClone(base);
  if (!override || typeof override !== "object") {
    return merged;
  }

  merged.playback.autoplaySelection = override?.playback?.autoplaySelection ?? merged.playback.autoplaySelection;
  merged.playback.restoreLastTrack = override?.playback?.restoreLastTrack ?? merged.playback.restoreLastTrack;
  merged.playback.pauseOnBlur = override?.playback?.pauseOnBlur ?? merged.playback.pauseOnBlur;
  merged.playback.defaultRepeatMode = ["off", "all", "one"].includes(override?.playback?.defaultRepeatMode)
    ? override.playback.defaultRepeatMode
    : merged.playback.defaultRepeatMode;
  merged.playback.previousSeekThreshold = clampNumber(
    override?.playback?.previousSeekThreshold,
    0,
    15,
    merged.playback.previousSeekThreshold
  );
  merged.playback.playbackRate = clampNumber(
    override?.playback?.playbackRate,
    0.75,
    1.5,
    merged.playback.playbackRate
  );

  merged.audio.volume = clampNumber(override?.audio?.volume, 0, 1, merged.audio.volume);
  merged.audio.muted = Boolean(override?.audio?.muted);
  merged.audio.volumeStep = clampNumber(override?.audio?.volumeStep, 0.01, 0.1, merged.audio.volumeStep);
  merged.audio.preloadMode = ["none", "metadata", "auto"].includes(override?.audio?.preloadMode)
    ? override.audio.preloadMode
    : merged.audio.preloadMode;

  merged.search.includeLibraryResults = override?.search?.includeLibraryResults ?? merged.search.includeLibraryResults;
  merged.search.liveSearchDelayMs = clampNumber(
    override?.search?.liveSearchDelayMs,
    0,
    500,
    merged.search.liveSearchDelayMs
  );
  searchProviderOrder.forEach((provider) => {
    merged.search.providers[provider] = override?.search?.providers?.[provider] ?? merged.search.providers[provider];
  });

  merged.downloads.autoRefreshLibrary = override?.downloads?.autoRefreshLibrary ?? merged.downloads.autoRefreshLibrary;
  return merged;
}

function persistSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function loadPlaybackState() {
  try {
    const raw = localStorage.getItem(PLAYBACK_STATE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function persistPlaybackState() {
  localStorage.setItem(
    PLAYBACK_STATE_STORAGE_KEY,
    JSON.stringify({
      selectedPlaylistId: state.selectedPlaylistId,
      selectedTrackKey: state.selectedTrackKey,
      playbackTrackKey: state.playbackTrackKey,
      activeDetailTab: state.activeDetailTab,
      repeatMode: state.repeatMode,
      currentTime: audioPlayer.currentTime || playbackState.currentTime || 0
    })
  );
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return structuredClone(DEFAULT_LAYOUT);
    }

    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((id) => ["sidebar", "tracks", "detail"].includes(id))
      : DEFAULT_LAYOUT.order;

    return {
      order: order.length === 3 ? order : [...DEFAULT_LAYOUT.order],
      widths: {
        sidebar: clampWidth(parsed?.widths?.sidebar, DEFAULT_LAYOUT.widths.sidebar),
        detail: clampWidth(parsed?.widths?.detail, DEFAULT_LAYOUT.widths.detail)
      },
      hidden: {
        sidebar: Boolean(parsed?.hidden?.sidebar),
        detail: Boolean(parsed?.hidden?.detail)
      }
    };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

function persistLayout() {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state.layout));
}

function clampWidth(value, fallback = 280) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return fallback;
  }

  return Math.max(220, Math.min(520, Math.round(nextValue)));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function outlinedSvg(content, viewBox = "0 0 24 24") {
  return `
    <svg viewBox="${viewBox}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      ${content}
    </svg>
  `;
}

function noteIcon() {
  return outlinedSvg(`
      <rect x="18" y="18" width="52" height="52" rx="16" opacity="0.18"/>
      <path d="M51 27v29.5a8.5 8.5 0 1 1-4.5-7.5V35.5L66 31v25.5a8.5 8.5 0 1 1-4.5-7.5V23Z"/>
    `, "0 0 88 88");
}

function heartIcon(filled) {
  if (filled) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5A4.5 4.5 0 0 1 6.5 4C8.24 4 9.91 4.81 11 6.09 12.09 4.81 13.76 4 15.5 4A4.5 4.5 0 0 1 20 8.5c0 3.78-3.4 6.86-8.55 11.54Z"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m12 20.7-.8-.73c-4.85-4.4-8.05-7.31-8.05-11.22A4.23 4.23 0 0 1 7.4 4.5c1.68 0 3.28.78 4.3 2.01A5.62 5.62 0 0 1 16 4.5a4.23 4.23 0 0 1 4.25 4.25c0 3.91-3.2 6.82-8.05 11.22ZM7.4 6.25a2.46 2.46 0 0 0-2.48 2.5c0 3.13 2.84 5.71 7.08 9.58 4.24-3.87 7.08-6.45 7.08-9.58A2.46 2.46 0 0 0 16.6 6.25c-1.3 0-2.55.84-3.03 2.03h-1.14A3.6 3.6 0 0 0 9.4 6.25Z"/>
      </svg>
  `;
}

function dotsIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>
    </svg>
  `;
}

function getPreviousIcon() {
  return outlinedSvg(`
      <path d="M11 19 4 12l7-7v14Z"/>
      <path d="M19 5v14"/>
    `);
}

function getNextIcon() {
  return outlinedSvg(`
      <path d="m13 5 7 7-7 7V5Z"/>
      <path d="M5 5v14"/>
    `);
}

function getPlayButtonIcon() {
  if (state.isBuffering) {
    return outlinedSvg(`
      <path d="M21 12a9 9 0 1 1-6.2-8.56"/>
    `);
  }

  if (state.isPlaying) {
    return outlinedSvg(`
      <path d="M10 5v14"/>
      <path d="M14 5v14"/>
    `);
  }

  return outlinedSvg(`
      <path d="m7 5 11 7-11 7V5Z"/>
    `);
}

function getRepeatIcon() {
  if (state.repeatMode === "one") {
    return outlinedSvg(`
      <path d="m17 3 4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="m7 21-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      <path d="M12 10h1.5v6"/>
      <path d="m12 10-1.2.9"/>
    `);
  }

  return outlinedSvg(`
      <path d="m17 3 4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="m7 21-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    `);
}

function getVolumeIcon() {
  const effectiveVolume = audioPlayer.muted ? 0 : audioPlayer.volume;

  if (effectiveVolume === 0) {
    return outlinedSvg(`
      <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
      <path d="m17 9 4 6"/>
      <path d="m21 9-4 6"/>
    `);
  }

  if (effectiveVolume <= 0.35) {
    return outlinedSvg(`
      <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
      <path d="M16.5 12a3.5 3.5 0 0 0-2-3.15"/>
      <path d="M14.5 15.15A3.5 3.5 0 0 0 16.5 12"/>
    `);
  }

  return outlinedSvg(`
      <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
      <path d="M16 9.5a4.5 4.5 0 0 1 0 5"/>
      <path d="M18.9 7a8 8 0 0 1 0 10"/>
    `);
}

function saveToApolloIcon() {
  return outlinedSvg(`
      <path d="M12 3v12"/>
      <path d="m7 10 5 5 5-5"/>
      <path d="M5 21h14"/>
    `);
}

function formatDuration(value, fallback = "0:00") {
  if (typeof value === "string" && value.includes(":")) {
    return value;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return fallback;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function providerLabel(provider) {
  const labels = {
    library: "Library",
    spotify: "Spotify",
    youtube: "YouTube",
    soundcloud: "SoundCloud"
  };

  return labels[provider] || provider || "Remote";
}

function isProtectedApolloUrl(url) {
  try {
    const resolvedUrl = new URL(url, state.apiBase);
    const apiOrigin = new URL(state.apiBase).origin;
    return resolvedUrl.origin === apiOrigin && (
      resolvedUrl.pathname.startsWith("/stream/") ||
      resolvedUrl.pathname.startsWith("/media/")
    );
  } catch {
    return false;
  }
}

function withAccessToken(url) {
  if (!url || !state.auth.token || !isProtectedApolloUrl(url)) {
    return url;
  }

  const resolvedUrl = new URL(url, state.apiBase);
  resolvedUrl.searchParams.set("access_token", state.auth.token);
  return resolvedUrl.toString();
}

function getAuthorizationHeader() {
  return state.auth.token ? `Bearer ${state.auth.token}` : "";
}

function openAuthModal(message = "") {
  state.auth.modalOpen = true;
  authFormMessage.textContent = message;
  authFormCopy.textContent = state.auth.configured
    ? "Apollo now requires a shared secret before the client can use the API."
    : "Apollo authentication is enabled, but no shared secret is configured on the server yet.";
  authSecretInput.value = "";
  authSecretInput.disabled = !state.auth.configured;
  authSubmitButton.disabled = !state.auth.configured;
  authModal.classList.add("is-open");
  authModal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    if (!authSecretInput.disabled) {
      authSecretInput.focus();
    }
  }, 0);
}

function closeAuthModal() {
  state.auth.modalOpen = false;
  authModal.classList.remove("is-open");
  authModal.setAttribute("aria-hidden", "true");
}

function updateAuthButton() {
  authButton.hidden = !state.auth.enabled && !state.auth.token;
  authButton.textContent = state.auth.token ? "Sign out" : "Sign in";
}

async function refreshAuthStatus() {
  const status = await requestJson("/api/auth/status", { skipAuth: true });
  state.auth.enabled = Boolean(status.enabled);
  state.auth.configured = Boolean(status.configured);
  state.auth.sessionTtlHours = Number(status.sessionTtlHours) || 0;
  updateAuthButton();

  if (!state.auth.enabled) {
    closeAuthModal();
    return true;
  }

  if (!state.auth.configured) {
    openAuthModal("Set the Apollo shared secret on the server first.");
    return false;
  }

  if (!state.auth.token) {
    openAuthModal("Enter the Apollo shared secret to continue.");
    return false;
  }

  closeAuthModal();
  return true;
}

async function signInWithSecret(secret) {
  const payload = await requestJson("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({ secret }),
    skipAuth: true
  });

  state.auth.token = payload.token || "";
  state.auth.expiresAt = payload.expiresAt || "";
  persistAuthSession();
  playbackUrlCache.clear();
  closeAuthModal();
}

async function signOut() {
  if (state.auth.token) {
    try {
      await requestJson("/api/auth/session", {
        method: "DELETE"
      });
    } catch {
      // Ignore revoke failures and still clear local session state.
    }
  }

  clearAuthSession();
  state.libraryTracks = [];
  state.playlists = [];
  state.searchResults = [];
  state.selectedTrackKey = null;
  state.playbackTrackKey = null;
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  updateAuthButton();

  if (state.auth.enabled) {
    openAuthModal("Signed out. Enter the Apollo shared secret to continue.");
  }
}

function buildTrackKey(prefix, id) {
  return `${prefix}:${id}`;
}

function serialiseTrack(track) {
  return {
    key: track.key,
    id: track.id,
    trackId: track.trackId || null,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    album: track.album || "",
    duration: track.duration || null,
    artwork: track.artwork || "",
    providerIds: track.providerIds || {},
    provider: track.provider || "remote",
    resultSource: track.resultSource || "remote",
    externalUrl: track.externalUrl || "",
    downloadTarget: track.downloadTarget || ""
  };
}

function normaliseLibraryTrack(track) {
  const trackId = track.trackId || track.id;

  return {
    key: buildTrackKey("library", trackId),
    id: trackId,
    trackId,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    album: track.album || "",
    duration: track.duration || null,
    artwork: track.artwork || "",
    providerIds: track.providerIds || {},
    provider: "library",
    resultSource: "library",
    externalUrl: track.externalUrl || `${state.apiBase}/stream/${trackId}`,
    downloadTarget: track.downloadTarget || `${state.apiBase}/stream/${trackId}?download=1`
  };
}

function normaliseRemoteTrack(track) {
  return {
    key: buildTrackKey(track.provider || "remote", track.id),
    id: track.id,
    trackId: null,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    album: track.album || "",
    duration: track.duration || null,
    artwork: track.artwork || "",
    providerIds: track.providerIds || {},
    provider: track.provider || "remote",
    resultSource: "remote",
    externalUrl: track.externalUrl || "",
    downloadTarget: track.downloadTarget || track.externalUrl || ""
  };
}

async function requestJson(path, options = {}) {
  const { skipAuth = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  if (!(fetchOptions.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!skipAuth && state.auth.token && !headers.has("Authorization")) {
    headers.set("Authorization", getAuthorizationHeader());
  }

  const response = await fetch(`${state.apiBase}${path}`, {
    ...fetchOptions,
    headers
  });

  if (!response.ok) {
    let errorMessage = `Request failed with ${response.status}`;
    let payload = null;

    try {
      payload = await response.json();
      errorMessage = payload.error || errorMessage;
    } catch {
      // Ignore non-JSON errors.
    }

    if (response.status === 401 && !skipAuth) {
      clearAuthSession();
      updateAuthButton();
      openAuthModal(errorMessage);
      const authError = new Error(errorMessage);
      authError.code = "AUTH_REQUIRED";
      throw authError;
    }

    throw new Error(errorMessage);
  }

  return response.json();
}

async function fetchAllTracks(query = "") {
  const items = [];
  let page = 1;
  let totalPages = 1;

  do {
    const payload = await requestJson(
      `/api/tracks?q=${encodeURIComponent(query)}&page=${page}&pageSize=50`
    );
    items.push(...(payload.items || []).map(normaliseLibraryTrack));
    totalPages = payload.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return items;
}

async function fetchSearchResults(query) {
  const enabledProviders = getEnabledProviders();
  const includeLibraryResults = state.settings.search.includeLibraryResults;
  const useAllProviders = enabledProviders.length === searchProviderOrder.length;
  const remoteProviderParam = useAllProviders ? "all" : enabledProviders.join(",");

  if (!includeLibraryResults && !enabledProviders.length) {
    return {
      tracks: [],
      warnings: ["Enable at least one search source in settings."]
    };
  }

  if (includeLibraryResults && useAllProviders) {
    const payload = await requestJson(buildSearchRequestPath(query, "all", "all"));
    const libraryItems = (payload.library?.items || []).map(normaliseLibraryTrack);
    const remoteItems = (payload.remote?.items || []).map(normaliseRemoteTrack);
    return {
      tracks: [...libraryItems, ...remoteItems],
      warnings: [payload.library?.warning, payload.remote?.warning].filter(Boolean)
    };
  }

  const requests = [];
  if (includeLibraryResults) {
    requests.push(
      requestJson(buildSearchRequestPath(query, "library", "all")).then((payload) => ({
        scope: "library",
        tracks: (payload.library?.items || []).map(normaliseLibraryTrack),
        warning: payload.library?.warning || ""
      }))
    );
  }

  if (enabledProviders.length) {
    requests.push(
      requestJson(buildSearchRequestPath(query, "remote", remoteProviderParam)).then((payload) => ({
        scope: "remote",
        tracks: (payload.remote?.items || []).map(normaliseRemoteTrack),
        warning: payload.remote?.warning || ""
      }))
    );
  }

  const results = await Promise.all(requests);
  const libraryItems = results.find((result) => result.scope === "library")?.tracks || [];
  const remoteItems = dedupeTracks(results.find((result) => result.scope === "remote")?.tracks || []);
  return {
    tracks: [...libraryItems, ...remoteItems],
    warnings: Array.from(new Set(results.map((result) => result.warning).filter(Boolean)))
  };
}

function getVisibleTracks() {
  if (state.query) {
    return state.searchResults;
  }

  if (state.selectedPlaylistId === "liked-tracks") {
    return Array.from(likedTracks.values());
  }

  if (state.selectedPlaylistId === "all-tracks") {
    return state.libraryTracks;
  }

  return state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId)?.tracks || [];
}

function getSelectedTrack() {
  return getVisibleTracks().find((track) => track.key === state.selectedTrackKey) || null;
}

function getTrackByKey(trackKey) {
  if (!trackKey) {
    return null;
  }

  const sources = [
    state.searchResults,
    state.libraryTracks,
    ...state.playlists.map((playlist) => playlist.tracks),
    Array.from(likedTracks.values())
  ];

  for (const source of sources) {
    const match = source.find((track) => track.key === trackKey);
    if (match) {
      return match;
    }
  }

  return null;
}

function getPlaybackTrack() {
  return getTrackByKey(state.playbackTrackKey) || null;
}

function isTrackLiked(trackKey) {
  return likedTracks.has(trackKey);
}

function destroyDetailTab() {
  if (typeof detailTabCleanup === "function") {
    detailTabCleanup();
  }

  detailTabCleanup = null;
}

function createDetailContext() {
  return {
    audioPlayer,
    getPlaybackTrack,
    getPlaybackTrackKey: () => state.playbackTrackKey,
    getSelectedTrack,
    isTrackLiked,
    providerLabel
  };
}

function syncSelectedTrack() {
  const visibleTracks = getVisibleTracks();
  const visibleKeys = new Set(visibleTracks.map((track) => track.key));

  if (!visibleKeys.has(state.selectedTrackKey)) {
    state.selectedTrackKey = visibleTracks[0]?.key || null;
  }
}

function getCachedDuration(track) {
  return durationCache.get(track.key) ?? track.duration ?? null;
}

function queueDurationProbe(track) {
  if (track.provider !== "library") {
    return;
  }

  if (getCachedDuration(track) || pendingDurationKeys.has(track.key)) {
    return;
  }

  pendingDurationKeys.add(track.key);
  const probe = new Audio();
  probe.preload = "metadata";
  probe.src = withAccessToken(`${state.apiBase}/stream/${track.trackId || track.id}`);

  const cleanup = () => {
    probe.removeAttribute("src");
    probe.load();
  };

  probe.addEventListener(
    "loadedmetadata",
    () => {
      durationCache.set(track.key, probe.duration);
      pendingDurationKeys.delete(track.key);
      cleanup();
      render();
    },
    { once: true }
  );

  probe.addEventListener(
    "error",
    () => {
      pendingDurationKeys.delete(track.key);
      cleanup();
    },
    { once: true }
  );
}

function getPlaylistItems() {
  return [
    {
      id: "all-tracks",
      name: "All Tracks",
      detail: `${state.libraryTracks.length} tracks`
    },
    {
      id: "liked-tracks",
      name: "Liked Songs",
      detail: `${likedTracks.size} liked`
    },
    ...state.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      detail: `${playlist.tracks.length} tracks`
    }))
  ];
}

function getActivePlaylist() {
  return state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId) || null;
}

function getEditablePlaylist(playlistId = state.selectedPlaylistId) {
  if (!playlistId || playlistId === "all-tracks" || playlistId === "liked-tracks") {
    return null;
  }

  return state.playlists.find((playlist) => playlist.id === playlistId) || null;
}

function getEnabledProviders() {
  return searchProviderOrder.filter((provider) => state.settings.search.providers[provider]);
}

function buildSearchRequestPath(query, scope, provider, pageSize = 24) {
  return `/api/search?query=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}&provider=${encodeURIComponent(provider)}&page=1&pageSize=${pageSize}`;
}

function dedupeTracks(tracks) {
  const unique = new Map();
  tracks.forEach((track) => {
    if (!unique.has(track.key)) {
      unique.set(track.key, track);
    }
  });
  return Array.from(unique.values());
}

function canSaveTrackToApollo(track) {
  return Boolean(track && track.resultSource !== "library");
}

function applySettings() {
  audioPlayer.preload = state.settings.audio.preloadMode;
  audioPlayer.volume = state.settings.audio.volume;
  audioPlayer.muted = state.settings.audio.muted;
  audioPlayer.playbackRate = state.settings.playback.playbackRate;
  volumeSlider.value = String(state.settings.audio.volume);
  volumeSlider.step = String(state.settings.audio.volumeStep);
}

function populateSettingsForm() {
  settingsAutoplaySelection.checked = state.settings.playback.autoplaySelection;
  settingsRestoreLastTrack.checked = state.settings.playback.restoreLastTrack;
  settingsPauseOnBlur.checked = state.settings.playback.pauseOnBlur;
  settingsDefaultRepeat.value = state.settings.playback.defaultRepeatMode;
  settingsPreviousThreshold.value = String(state.settings.playback.previousSeekThreshold);
  settingsPlaybackRate.value = String(state.settings.playback.playbackRate);
  settingsVolume.value = String(state.settings.audio.volume);
  settingsMuted.checked = state.settings.audio.muted;
  settingsVolumeStep.value = String(state.settings.audio.volumeStep);
  settingsPreloadMode.value = state.settings.audio.preloadMode;
  settingsIncludeLibrary.checked = state.settings.search.includeLibraryResults;
  settingsProviderYoutube.checked = state.settings.search.providers.youtube;
  settingsProviderSpotify.checked = state.settings.search.providers.spotify;
  settingsProviderSoundcloud.checked = state.settings.search.providers.soundcloud;
  settingsSearchDelay.value = String(state.settings.search.liveSearchDelayMs);
  settingsAutoRefreshLibrary.checked = state.settings.downloads.autoRefreshLibrary;
  settingsFormMessage.textContent = "";
}

function saveCurrentSettingsForm() {
  const providers = {
    youtube: settingsProviderYoutube.checked,
    spotify: settingsProviderSpotify.checked,
    soundcloud: settingsProviderSoundcloud.checked
  };

  if (!Object.values(providers).some(Boolean)) {
    providers.youtube = true;
  }

  return mergeSettings(DEFAULT_SETTINGS, {
    playback: {
      autoplaySelection: settingsAutoplaySelection.checked,
      restoreLastTrack: settingsRestoreLastTrack.checked,
      pauseOnBlur: settingsPauseOnBlur.checked,
      defaultRepeatMode: settingsDefaultRepeat.value,
      previousSeekThreshold: Number(settingsPreviousThreshold.value),
      playbackRate: Number(settingsPlaybackRate.value)
    },
    audio: {
      volume: Number(settingsVolume.value),
      muted: settingsMuted.checked,
      volumeStep: Number(settingsVolumeStep.value),
      preloadMode: settingsPreloadMode.value
    },
    search: {
      includeLibraryResults: settingsIncludeLibrary.checked,
      providers,
      liveSearchDelayMs: Number(settingsSearchDelay.value)
    },
    downloads: {
      autoRefreshLibrary: settingsAutoRefreshLibrary.checked
    }
  });
}

function openSettingsModal() {
  state.settingsModalOpen = true;
  populateSettingsForm();
  settingsModal.classList.add("is-open");
  settingsModal.setAttribute("aria-hidden", "false");
  setTimeout(() => settingsAutoplaySelection.focus(), 0);
}

function closeSettingsModal() {
  state.settingsModalOpen = false;
  settingsModal.classList.remove("is-open");
  settingsModal.setAttribute("aria-hidden", "true");
}

function saveVolumeSetting() {
  state.settings.audio.volume = audioPlayer.volume;
  state.settings.audio.muted = audioPlayer.muted;
  persistSettings();
}

function closeActiveMenu() {
  state.activeMenuTrackKey = null;
  state.activeMenuAnchor = null;
  document.querySelectorAll(".track-menu-popover--portal").forEach((menu) => menu.remove());
}

function selectTrack(trackKey, { autoplay = false } = {}) {
  state.selectedTrackKey = trackKey;
  closeActiveMenu();
  persistPlaybackState();
  render();

  if (autoplay) {
    void playSelectedTrack();
  }
}

async function refreshLibrary() {
  state.isLoading = true;
  state.message = "Loading library...";
  render();

  try {
    const [health, tracks, playlistsPayload] = await Promise.all([
      requestJson("/api/health"),
      fetchAllTracks(""),
      requestJson("/api/playlists")
    ]);

    state.isConnected = true;
    state.libraryTracks = tracks;
    state.playlists = (playlistsPayload.items || []).map((playlist) => ({
      id: playlist.id,
      name: playlist.name || "Untitled Playlist",
      description: playlist.description || "",
      artworkUrl: playlist.artworkUrl || "",
      tracks: (playlist.tracks || []).map(normaliseLibraryTrack)
    }));
    state.message = health?.status ? "" : "Apollo responded without a health status.";

    if (!state.query) {
      if (state.settings.playback.restoreLastTrack) {
        const playbackSnapshot = loadPlaybackState();
        const restoredTrack = getTrackByKey(playbackSnapshot.selectedTrackKey);
        if (restoredTrack) {
          state.selectedTrackKey = restoredTrack.key;
        }

        const restoredPlaybackTrack = getTrackByKey(playbackSnapshot.playbackTrackKey || state.restoredPlaybackKey);
        if (restoredPlaybackTrack) {
          state.playbackTrackKey = restoredPlaybackTrack.key;
        }
      }

      syncSelectedTrack();
      persistPlaybackState();
    }
  } catch (error) {
    state.isConnected = false;
    if (error.code === "AUTH_REQUIRED") {
      state.message = error.message;
    } else {
      state.libraryTracks = [];
      state.playlists = [];
      state.selectedTrackKey = null;
      state.message = `Apollo unavailable at ${state.apiBase}. ${error.message}`;
    }
  } finally {
    state.isLoading = false;
    render();
  }
}

async function runSearch() {
  if (!state.query) {
    state.searchResults = [];
    state.message = state.isConnected ? "" : state.message;
    syncSelectedTrack();
    render();
    return;
  }

  state.isLoading = true;
  state.message = "Searching library and providers...";
  render();

  try {
    const { tracks, warnings } = await fetchSearchResults(state.query);
    state.searchResults = tracks;
    const libraryCount = state.searchResults.filter((track) => track.resultSource === "library").length;
    const remoteCount = state.searchResults.length - libraryCount;
    const summary = `${libraryCount} library | ${remoteCount} remote`;
    state.message = warnings.length ? `${summary} | ${warnings.join(" ")}` : summary;
    syncSelectedTrack();
  } catch (error) {
    state.searchResults = [];
    state.message = error.message;
  } finally {
    state.isLoading = false;
    render();
  }
}

function renderArtwork(track, className) {
  if (!track?.artwork) {
    return noteIcon();
  }

  return `<img class="${className}" src="${escapeHtml(withAccessToken(track.artwork))}" alt="">`;
}

function toggleLike(track) {
  if (!track?.key) {
    return;
  }

  if (likedTracks.has(track.key)) {
    likedTracks.delete(track.key);
  } else {
    likedTracks.set(track.key, serialiseTrack(track));
  }

  persistLikedTracks();

  if (state.selectedPlaylistId === "liked-tracks") {
    syncSelectedTrack();
  }

  render();
}

async function copyTrackLink(track) {
  const link = track.externalUrl || (track.trackId ? `${state.apiBase}/stream/${track.trackId}` : "");
  if (!link) {
    state.message = "No link available for this track.";
    renderStatus();
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    state.message = "Copied track link.";
  } catch {
    state.message = "Copy failed in this environment.";
  }

  renderStatus();
}

function openPlaylistModal({ initialTrackId = null, playlistId = null, mode = "create", title = "Create playlist" } = {}) {
  const playlist = mode === "edit" ? getEditablePlaylist(playlistId) : null;
  state.modal = createPlaylistModalState({
    isOpen: true,
    initialTrackId: playlist ? null : initialTrackId,
    mode: playlist ? "edit" : "create",
    playlistId: playlist?.id || null,
    artworkUrl: playlist?.artworkUrl || ""
  });

  playlistModalTitle.textContent = title;
  playlistSubmitButton.textContent = playlist ? "Save changes" : "Save";
  playlistDeleteButton.hidden = !playlist;
  playlistDeleteButton.textContent = "Delete playlist";
  playlistFormMessage.textContent = "";
  playlistNameInput.value = playlist?.name || "";
  playlistDescriptionInput.value = playlist?.description || "";
  playlistArtworkInput.value = "";
  playlistArtworkClear.hidden = !playlist?.artworkUrl;
  playlistArtworkPreview.innerHTML = playlist?.artworkUrl
    ? `<img src="${escapeHtml(withAccessToken(playlist.artworkUrl))}" alt="">`
    : noteIcon();
  playlistArtworkStatus.textContent = playlist?.artworkUrl
    ? "Current artwork will stay until you replace or remove it."
    : "No artwork selected.";
  playlistModal.classList.add("is-open");
  playlistModal.setAttribute("aria-hidden", "false");
  setTimeout(() => playlistNameInput.focus(), 0);
}

function closePlaylistModal() {
  if (state.modal.artworkPreviewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(state.modal.artworkPreviewUrl);
  }

  state.modal = createPlaylistModalState();
  playlistArtworkInput.value = "";
  playlistModal.classList.remove("is-open");
  playlistModal.setAttribute("aria-hidden", "true");
}

async function createPlaylist(name, description = "", initialTrackId = null) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Playlist name is required.");
  }

  const playlist = await requestJson("/api/playlists", {
    method: "POST",
    body: JSON.stringify({
      name: trimmedName,
      description
    })
  });

  if (initialTrackId) {
    await requestJson(`/api/playlists/${playlist.id}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId: initialTrackId })
    });
  }

  return playlist;
}

async function updatePlaylist(playlistId, name, description = "") {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Playlist name is required.");
  }

  return requestJson(`/api/playlists/${playlistId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: trimmedName,
      description
    })
  });
}

async function uploadPlaylistArtwork(playlistId, file) {
  if (!file) {
    return null;
  }

  const formData = new FormData();
  formData.append("artwork", file);
  return requestJson(`/api/playlists/${playlistId}/artwork`, {
    method: "POST",
    body: formData
  });
}

async function deletePlaylistArtwork(playlistId) {
  return requestJson(`/api/playlists/${playlistId}/artwork`, {
    method: "DELETE"
  });
}

async function deletePlaylist(playlistId) {
  return requestJson(`/api/playlists/${playlistId}`, {
    method: "DELETE"
  });
}

function updatePlaylistArtworkUI() {
  const artworkUrl = state.modal.removeArtwork ? "" : state.modal.artworkPreviewUrl || state.modal.artworkUrl;
  playlistArtworkPreview.innerHTML = artworkUrl
    ? `<img src="${escapeHtml(withAccessToken(artworkUrl))}" alt="">`
    : noteIcon();
  playlistArtworkClear.hidden = !artworkUrl && !state.modal.artworkFile;

  if (state.modal.artworkFile) {
    playlistArtworkStatus.textContent = `${state.modal.artworkFile.name} ready to upload.`;
    return;
  }

  playlistArtworkStatus.textContent = artworkUrl
    ? "Current artwork will stay until you replace or remove it."
    : "No artwork selected.";
}

async function addTrackToPlaylist(playlistId, track) {
  if (!track.trackId) {
    state.message = "Only library tracks can be added to playlists right now.";
    render();
    return;
  }

  await requestJson(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ trackId: track.trackId })
  });

  await refreshLibrary();
  state.message = "Added to playlist.";
  render();
}

async function removeTrackFromPlaylist(playlistId, track) {
  if (!track.trackId) {
    return;
  }

  await requestJson(`/api/playlists/${playlistId}/tracks/${track.trackId}`, {
    method: "DELETE"
  });

  await refreshLibrary();
  state.message = "Removed from playlist.";
  if (state.selectedPlaylistId === playlistId) {
    syncSelectedTrack();
  }
  render();
}

function buildPlaybackPayload(track) {
  if (track.provider === "library") {
    return {
      trackId: track.trackId || track.id
    };
  }

  return {
    provider: track.provider,
    title: track.title,
    artist: track.artist,
    album: track.album,
    externalUrl: track.externalUrl,
    downloadTarget: track.downloadTarget
  };
}

function buildDownloadPayload(track) {
  if (track.provider === "library") {
    return {
      trackId: track.trackId || track.id
    };
  }

  return {
    provider: track.provider,
    title: track.title,
    artist: track.artist,
    album: track.album,
    externalUrl: track.externalUrl,
    sourceUrl: track.externalUrl || track.downloadTarget,
    downloadTarget: track.downloadTarget,
    duration: track.duration
  };
}

function triggerBrowserDownload(downloadUrl, fileName = "") {
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  if (fileName) {
    link.download = fileName;
  }

  document.body.append(link);
  link.click();
  link.remove();
}

async function downloadTrackToDevice(track) {
  try {
    const payload = await requestJson("/api/downloads/client", {
      method: "POST",
      body: JSON.stringify(buildDownloadPayload(track))
    });

    triggerBrowserDownload(withAccessToken(payload.downloadUrl), payload.fileName || `${track.artist} - ${track.title}.mp3`);
    state.message = "Download started in the client.";
    renderStatus();
  } catch (error) {
    state.message = error.message;
    renderStatus();
  }
}

async function downloadTrackToServer(track) {
  if (!canSaveTrackToApollo(track)) {
    state.message = "This song is already in your Apollo library.";
    renderStatus();
    return;
  }

  try {
    await requestJson("/api/downloads/server", {
      method: "POST",
      body: JSON.stringify(buildDownloadPayload(track))
    });

    state.message = `Queued ${track.title} for Apollo library download with metadata.`;
    renderStatus();
    if (state.settings.downloads.autoRefreshLibrary) {
      setTimeout(() => {
        void refreshLibrary();
      }, 4000);
    }
  } catch (error) {
    state.message = error.message;
    renderStatus();
  }
}

function renderPlaylists() {
  const items = getPlaylistItems();
  playlistList.innerHTML = "";

  items.forEach((playlist) => {
    const playlistRecord = state.playlists.find((entry) => entry.id === playlist.id);
    const artworkMarkup = playlistRecord?.artworkUrl
      ? `<img class="item-art-image" src="${escapeHtml(withAccessToken(playlistRecord.artworkUrl))}" alt="">`
      : noteIcon();
    const button = document.createElement("button");
    button.type = "button";
    button.className = `library-item${playlist.id === state.selectedPlaylistId && !state.query ? " is-active" : ""}`;
    button.innerHTML = `
      <span class="item-art">${artworkMarkup}</span>
      <span class="item-copy">
        <p class="item-title">${escapeHtml(playlist.name)}</p>
        <p class="item-subtitle">${escapeHtml(playlist.detail)}</p>
      </span>
    `;

    button.addEventListener("click", () => {
      state.selectedPlaylistId = playlist.id;
      state.query = "";
      state.searchResults = [];
      closeActiveMenu();
      searchInput.value = "";
      syncSelectedTrack();
      persistPlaybackState();
      render();
    });

    playlistList.append(button);
  });
}

function createRowMenu(track) {
  const isLiked = isTrackLiked(track.key);
  const isLibraryTrack = Boolean(track.trackId);
  const isRemoteTrack = !isLibraryTrack;
  const inUserPlaylist =
    !state.query &&
    state.selectedPlaylistId !== "all-tracks" &&
    state.selectedPlaylistId !== "liked-tracks";

  const wrapper = document.createElement("div");
  wrapper.className = "track-menu-popover";
  wrapper.innerHTML = `
    <button class="row-menu-button" type="button" data-action="play">Play now</button>
    <button class="row-menu-button" type="button" data-action="like">${isLiked ? "Remove like" : "Like track"}</button>
    ${isLibraryTrack ? '<button class="row-menu-button" type="button" data-action="add-current">Add to current playlist</button>' : ""}
    <button class="row-menu-button" type="button" data-action="create-playlist">${isLibraryTrack ? "Create playlist with track" : "Create playlist"}</button>
    ${inUserPlaylist && isLibraryTrack ? '<button class="row-menu-button" type="button" data-action="remove">Remove from playlist</button>' : ""}
    ${isRemoteTrack ? '<button class="row-menu-button" type="button" data-action="download-server">Save to Apollo</button>' : ""}
    <button class="row-menu-button" type="button" data-action="download-client">Download</button>
    <button class="row-menu-button" type="button" data-action="copy">Copy link</button>
  `;

  wrapper.querySelector('[data-action="play"]').addEventListener("click", () => {
    closeActiveMenu();
    selectTrack(track.key, { autoplay: true });
  });

  wrapper.querySelector('[data-action="like"]').addEventListener("click", () => {
    toggleLike(track);
    closeActiveMenu();
    render();
  });

  const addCurrent = wrapper.querySelector('[data-action="add-current"]');
  if (addCurrent) {
    addCurrent.addEventListener("click", async () => {
      closeActiveMenu();

      if (!inUserPlaylist) {
        state.message = "Select a playlist first, then add the track.";
        render();
        return;
      }

      await addTrackToPlaylist(state.selectedPlaylistId, track);
    });
  }

  wrapper.querySelector('[data-action="create-playlist"]').addEventListener("click", () => {
    closeActiveMenu();
    openPlaylistModal({
      title: isLibraryTrack ? "Create playlist with track" : "Create playlist",
      initialTrackId: isLibraryTrack ? track.trackId : null
    });
  });

  const removeButton = wrapper.querySelector('[data-action="remove"]');
  if (removeButton) {
    removeButton.addEventListener("click", async () => {
      closeActiveMenu();
      await removeTrackFromPlaylist(state.selectedPlaylistId, track);
    });
  }

  const downloadServerButton = wrapper.querySelector('[data-action="download-server"]');
  if (downloadServerButton) {
    downloadServerButton.addEventListener("click", () => {
      closeActiveMenu();
      void downloadTrackToServer(track);
      render();
    });
  }

  wrapper.querySelector('[data-action="download-client"]').addEventListener("click", () => {
    closeActiveMenu();
    void downloadTrackToDevice(track);
    render();
  });

  wrapper.querySelector('[data-action="copy"]').addEventListener("click", () => {
    closeActiveMenu();
    void copyTrackLink(track);
    render();
  });

  return wrapper;
}

function positionActiveMenu(row, menu) {
  const viewportPadding = 12;
  const fallbackRect = row.getBoundingClientRect();
  const anchor = state.activeMenuAnchor || {
    x: fallbackRect.right - 12,
    y: fallbackRect.top + 56
  };

  menu.style.left = "0";
  menu.style.top = "0";

  const menuRect = menu.getBoundingClientRect();
  const maxLeft = Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding);
  const maxTop = Math.max(viewportPadding, window.innerHeight - menuRect.height - viewportPadding);

  let left = anchor.x - menuRect.width;
  let top = anchor.y + 8;

  if (top > maxTop) {
    top = anchor.y - menuRect.height - 8;
  }

  menu.style.left = `${Math.min(Math.max(viewportPadding, left), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(viewportPadding, top), maxTop)}px`;
}

function renderTracks() {
  const visibleTracks = getVisibleTracks();
  document.querySelectorAll(".track-menu-popover--portal").forEach((menu) => menu.remove());
  trackList.innerHTML = "";

  if (!visibleTracks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.isLoading ? "Loading..." : state.message || "No tracks available yet.";
    trackList.append(empty);
    return;
  }

  visibleTracks.forEach((track, index) => {
    const row = document.createElement("div");
    const duration = formatDuration(getCachedDuration(track), "--:--");
    const provider = state.query ? ` · <span class="track-provider">${providerLabel(track.provider)}</span>` : "";

    row.className = `track-row${track.key === state.selectedTrackKey ? " is-active" : ""}`;
    row.innerHTML = `
      <button class="track-main-button" type="button">
        <span class="track-index">${index + 1}</span>
        <span class="track-leading">
          <span class="track-art">${renderArtwork(track, "track-art-image")}</span>
          <span class="track-copy">
            <p class="track-title">${escapeHtml(track.title)}</p>
            <p class="track-subtitle">${escapeHtml(track.artist)}${provider}</p>
          </span>
        </span>
        <span class="track-duration">${duration}</span>
      </button>
      <button class="track-menu-button" type="button" aria-label="Track actions">${dotsIcon()}</button>
    `;

    row.querySelector(".track-main-button").addEventListener("click", () => {
      selectTrack(track.key, { autoplay: state.settings.playback.autoplaySelection });
    });

    const menuButton = row.querySelector(".track-menu-button");

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = menuButton.getBoundingClientRect();
      state.activeMenuTrackKey = state.activeMenuTrackKey === track.key ? null : track.key;
      state.activeMenuAnchor = state.activeMenuTrackKey
        ? {
            x: rect.right,
            y: rect.bottom
          }
        : null;
      renderTracks();
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.activeMenuTrackKey = track.key;
      state.activeMenuAnchor = {
        x: event.clientX,
        y: event.clientY
      };
      renderTracks();
    });

    if (state.activeMenuTrackKey === track.key) {
      const menu = createRowMenu(track);
      menu.classList.add("track-menu-popover--portal");
      document.body.append(menu);
      positionActiveMenu(row, menu);
    }

    trackList.append(row);
    queueDurationProbe(track);
  });
}

function renderTrackPaneHeader() {
  const visibleTracks = getVisibleTracks();
  editPlaylistButton.hidden = Boolean(state.query) || !getEditablePlaylist();

  if (state.query) {
    trackPaneKicker.textContent = "Search";
    trackPaneTitle.textContent = state.query;
    trackPaneMeta.textContent = `${visibleTracks.length} results`;
    return;
  }

  if (state.selectedPlaylistId === "all-tracks") {
    trackPaneKicker.textContent = "Browse";
    trackPaneTitle.textContent = "All Tracks";
    trackPaneMeta.textContent = `${state.libraryTracks.length} songs`;
    return;
  }

  if (state.selectedPlaylistId === "liked-tracks") {
    trackPaneKicker.textContent = "Playlist";
    trackPaneTitle.textContent = "Liked Songs";
    trackPaneMeta.textContent = `${likedTracks.size} songs`;
    return;
  }

  const playlist = getActivePlaylist();
  trackPaneKicker.textContent = "Playlist";
  trackPaneTitle.textContent = playlist?.name || "Playlist";
  trackPaneMeta.textContent = `${playlist?.tracks.length || 0} songs`;
}

function renderDetailPanel() {
  destroyDetailTab();

  const selectedTrack = getSelectedTrack();
  const playbackTrack = getPlaybackTrack();
  const activeTrack = playbackTrack || selectedTrack;
  const liked = activeTrack ? isTrackLiked(activeTrack.key) : false;
  const tabs = [
    {
      id: "track",
      label: "Track"
    },
    ...pluginHost.getDetailTabs()
  ];

  if (!tabs.some((tab) => tab.id === state.activeDetailTab)) {
    state.activeDetailTab = "track";
  }

  detailPanel.innerHTML = `
    <div class="detail-panel-shell">
      <div class="detail-tabs" role="tablist" aria-label="Detail panels">
        ${tabs
          .map(
            (tab) => `
              <button
                class="detail-tab${tab.id === state.activeDetailTab ? " is-active" : ""}"
                type="button"
                role="tab"
                aria-selected="${tab.id === state.activeDetailTab}"
                data-detail-tab="${escapeHtml(tab.id)}"
              >
                ${escapeHtml(tab.label)}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="detail-panel-body"></div>
    </div>
  `;

  detailPanel.querySelectorAll("[data-detail-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.getAttribute("data-detail-tab");
      if (!nextTab || nextTab === state.activeDetailTab) {
        return;
      }

      state.activeDetailTab = nextTab;
      persistPlaybackState();
      renderDetailPanel();
    });
  });

  const panelBody = detailPanel.querySelector(".detail-panel-body");

  if (state.activeDetailTab !== "track") {
    detailTabCleanup = pluginHost.mountDetailTab(
      state.activeDetailTab,
      panelBody,
      createDetailContext()
    );
    return;
  }

  if (!activeTrack) {
    panelBody.innerHTML = `
      <div class="detail-art">${noteIcon()}</div>
      <div class="detail-copy">
        <p class="detail-meta">Apollo</p>
        <h2>Your music, your layout.</h2>
        <p class="detail-description">Toggle the library and detail panels from the top bar, resize the panes with the dividers, and keep search focused on Apollo results without boxing the interface in.</p>
      </div>
    `;
    return;
  }

  const detailText = state.query
    ? `Search is live across Apollo and provider results. Use the three-dot menu for download, playlist, and save actions.`
    : activeTrack.resultSource === "library"
      ? "This track is already in your Apollo library and can be added to playlists or downloaded directly."
      : "This is a remote result. Save it to the Apollo server library with metadata or download it directly to the client.";

  panelBody.innerHTML = `
    <div class="detail-art">${renderArtwork(activeTrack, "detail-art-image")}</div>
    <div class="detail-copy">
      <p class="detail-meta">${escapeHtml(providerLabel(activeTrack.provider))}</p>
      <h2>${escapeHtml(activeTrack.title)}</h2>
      <p class="detail-description">${escapeHtml(activeTrack.artist)}${activeTrack.album ? ` | ${escapeHtml(activeTrack.album)}` : ""}</p>
      <p class="detail-description">${detailText}</p>
    </div>
    <div class="detail-tags">
      <span class="detail-tag">${formatDuration(getCachedDuration(activeTrack), "--:--")}</span>
      <span class="detail-tag">${activeTrack.resultSource === "library" ? "Local" : "Remote"}</span>
    </div>
    <div class="detail-actions">
      <button class="detail-action" type="button" data-detail-action="play">Play</button>
      <button class="detail-action" type="button" data-detail-action="like">${liked ? "Unlike" : "Like"}</button>
      ${activeTrack.resultSource !== "library" ? '<button class="detail-action" type="button" data-detail-action="download-server">Save to Apollo</button>' : ""}
      <button class="detail-action" type="button" data-detail-action="download-client">Download</button>
      <button class="detail-action" type="button" data-detail-action="copy">Copy link</button>
    </div>
  `;

  panelBody.querySelector('[data-detail-action="play"]').addEventListener("click", () => {
    if (selectedTrack?.key !== activeTrack.key) {
      state.selectedTrackKey = activeTrack.key;
    }
    void playSelectedTrack();
  });

  panelBody.querySelector('[data-detail-action="like"]').addEventListener("click", () => {
    toggleLike(activeTrack);
  });

  const saveToServerButton = panelBody.querySelector('[data-detail-action="download-server"]');
  if (saveToServerButton) {
    saveToServerButton.addEventListener("click", () => {
      void downloadTrackToServer(activeTrack);
    });
  }

  panelBody.querySelector('[data-detail-action="download-client"]').addEventListener("click", () => {
    void downloadTrackToDevice(activeTrack);
  });

  panelBody.querySelector('[data-detail-action="copy"]').addEventListener("click", () => {
    void copyTrackLink(activeTrack);
  });
}

function renderNowPlaying() {
  const currentTrack = getPlaybackTrack() || getSelectedTrack();

  if (!currentTrack) {
    nowPlaying.innerHTML = `
      <div class="now-playing-shell">
        <div class="now-playing-art">${noteIcon()}</div>
        <div class="now-playing-meta">
          <p class="now-playing-title">Nothing playing</p>
          <p class="now-playing-subtitle">Pick a track from your library or search.</p>
        </div>
      </div>
      <button class="like-button" type="button" aria-label="Like track">${heartIcon(false)}</button>
    `;
    return;
  }

  const liked = isTrackLiked(currentTrack.key);
  const showSaveAction = canSaveTrackToApollo(currentTrack);
  nowPlaying.innerHTML = `
    <div class="now-playing-shell">
      <div class="now-playing-art">${renderArtwork(currentTrack, "now-playing-art-image")}</div>
      <div class="now-playing-meta">
        <p class="now-playing-title">${escapeHtml(currentTrack.title)}</p>
        <button class="now-playing-artist" type="button">${escapeHtml(currentTrack.artist)}</button>
      </div>
    </div>
    <div class="now-playing-actions">
      ${showSaveAction ? '<button class="now-playing-icon-button" type="button" data-now-playing-action="save" aria-label="Save to Apollo">' + saveToApolloIcon() + "</button>" : ""}
      <button class="like-button${liked ? " is-liked" : ""}" type="button" aria-label="Like track">${heartIcon(liked)}</button>
    </div>
  `;

  nowPlaying.querySelector(".now-playing-artist").addEventListener("click", () => {
    state.query = currentTrack.artist;
    searchInput.value = currentTrack.artist;
    clearTimeout(state.searchTimer);
    void runSearch();
  });

  nowPlaying.querySelector(".like-button").addEventListener("click", () => {
    toggleLike(currentTrack);
  });

  const saveButton = nowPlaying.querySelector('[data-now-playing-action="save"]');
  if (saveButton) {
    saveButton.addEventListener("click", () => {
      void downloadTrackToServer(currentTrack);
    });
  }
}

function renderStatus() {
  serverStatus.textContent = state.message;
}

function renderPlayback() {
  repeatButton.innerHTML = getRepeatIcon();
  repeatButton.classList.toggle("is-active", state.repeatMode !== "off");
  previousButton.innerHTML = getPreviousIcon();
  nextButton.innerHTML = getNextIcon();
  playButton.innerHTML = getPlayButtonIcon();
  volumeButton.innerHTML = getVolumeIcon();

  const currentTrack = getPlaybackTrack() || getSelectedTrack();
  const cachedDuration = currentTrack ? getCachedDuration(currentTrack) : null;
  const currentTime = audioPlayer.currentTime || 0;
  const duration = audioPlayer.duration || cachedDuration || 0;
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  progressCurrent.textContent = formatDuration(currentTime);
  progressTotal.textContent = formatDuration(duration);
  progressFill.style.width = `${progress}%`;
  volumeButton.setAttribute("aria-label", audioPlayer.muted || audioPlayer.volume === 0 ? "Unmute" : "Mute");
}

function applyLayout() {
  const orderedPanels = state.layout.order.map((panelId) => panelElements[panelId]).filter(Boolean);

  orderedPanels.forEach((panel, index) => {
    panel.style.order = String(index * 2);
    const panelId = panel.dataset.panelId;
    const isHidden = panelId !== "tracks" && Boolean(state.layout.hidden[panelId]);

    if (isHidden) {
      panel.style.display = "none";
      panel.style.flex = "0 0 0px";
      panel.style.width = "0";
      panel.style.transform = "";
      panel.style.zIndex = "1";
      return;
    }

    panel.style.display = "";

    if (panelId === "tracks") {
      panel.style.flex = "1 1 auto";
      panel.style.width = "auto";
    } else {
      const width = clampWidth(state.layout.widths[panelId], DEFAULT_LAYOUT.widths[panelId]);
      panel.style.flex = `0 0 ${width}px`;
      panel.style.width = `${width}px`;
    }
    panel.style.transform = "";
    panel.style.zIndex = "1";
  });

  resizers.forEach((resizer, index) => {
    const before = state.layout.order[index];
    const after = state.layout.order[index + 1];
    const beforeHidden = before !== "tracks" && Boolean(state.layout.hidden[before]);
    const afterHidden = after !== "tracks" && Boolean(state.layout.hidden[after]);

    resizer.style.order = String(index * 2 + 1);
    resizer.dataset.before = before;
    resizer.dataset.after = after;
    resizer.style.display = beforeHidden || afterHidden ? "none" : "";
  });

  toggleSidebarButton.classList.toggle("is-active", !state.layout.hidden.sidebar);
  toggleDetailButton.classList.toggle("is-active", !state.layout.hidden.detail);
}

function render() {
  applyLayout();
  updateAuthButton();
  renderPlaylists();
  renderTrackPaneHeader();
  renderTracks();
  renderDetailPanel();
  renderNowPlaying();
  renderStatus();
  renderPlayback();
}

function waitForPlaybackReady() {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      audioPlayer.removeEventListener("canplay", onReady);
      audioPlayer.removeEventListener("playing", onReady);
      audioPlayer.removeEventListener("error", onReady);
    };

    const onReady = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    audioPlayer.addEventListener("canplay", onReady, { once: true });
    audioPlayer.addEventListener("playing", onReady, { once: true });
    audioPlayer.addEventListener("error", onReady, { once: true });

    setTimeout(onReady, 1800);
  });
}

async function resolvePlaybackUrl(track) {
  if (playbackUrlCache.has(track.key)) {
    return playbackUrlCache.get(track.key);
  }

  if (track.provider === "library") {
    const directUrl = withAccessToken(`${state.apiBase}/stream/${track.trackId || track.id}`);
    playbackUrlCache.set(track.key, directUrl);
    return directUrl;
  }

  const payload = await requestJson("/api/playback", {
    method: "POST",
    body: JSON.stringify(buildPlaybackPayload(track))
  });

  const streamUrl = withAccessToken(payload.streamUrl);
  playbackUrlCache.set(track.key, streamUrl);
  return streamUrl;
}

async function playSelectedTrack() {
  const selectedTrack = getSelectedTrack();
  if (!selectedTrack) {
    return;
  }

  state.isBuffering = true;
  state.message = `Loading ${selectedTrack.title}...`;
  render();

  try {
    const nextUrl = await resolvePlaybackUrl(selectedTrack);
    const currentSrc = audioPlayer.currentSrc || audioPlayer.src;
    const urlChanged = state.playbackTrackKey !== selectedTrack.key || currentSrc !== nextUrl;

    if (urlChanged) {
      audioPlayer.pause();
      audioPlayer.src = nextUrl;
      audioPlayer.load();
      state.playbackTrackKey = selectedTrack.key;
      persistPlaybackState();
      await waitForPlaybackReady();
    }

    await audioPlayer.play();
    state.message = "";
  } catch (error) {
    state.isPlaying = false;
    state.isBuffering = false;
    state.message = error.message;
    render();
  }
}

function getNextTrack(offset, wrap = false) {
  const visibleTracks = getVisibleTracks();
  if (!visibleTracks.length) {
    return null;
  }

  const currentIndex = visibleTracks.findIndex((track) => track.key === state.selectedTrackKey);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  let nextIndex = safeIndex + offset;

  if (wrap) {
    if (nextIndex < 0) {
      nextIndex = visibleTracks.length - 1;
    } else if (nextIndex >= visibleTracks.length) {
      nextIndex = 0;
    }
  }

  if (nextIndex < 0 || nextIndex >= visibleTracks.length) {
    return null;
  }

  return visibleTracks[nextIndex];
}

function playAdjacent(offset, wrap = false) {
  const nextTrack = getNextTrack(offset, wrap);
  if (!nextTrack) {
    return;
  }

  state.selectedTrackKey = nextTrack.key;
  closeActiveMenu();
  persistPlaybackState();
  render();
  void playSelectedTrack();
}

function resetLayout() {
  state.layout = structuredClone(DEFAULT_LAYOUT);
  persistLayout();
  render();
}

function togglePanel(panelId) {
  if (!(panelId in state.layout.hidden)) {
    return;
  }

  state.layout.hidden[panelId] = !state.layout.hidden[panelId];
  closeActiveMenu();
  persistLayout();
  render();
}

function beginResize(event, beforeId, afterId, resizer) {
  if (window.innerWidth <= 980) {
    return;
  }

  resizeSession = {
    beforeId,
    afterId,
    startX: event.clientX,
    beforeWidth: beforeId === "tracks"
      ? panelElements[beforeId].getBoundingClientRect().width
      : clampWidth(state.layout.widths[beforeId], DEFAULT_LAYOUT.widths[beforeId]),
    afterWidth: afterId === "tracks"
      ? panelElements[afterId].getBoundingClientRect().width
      : clampWidth(state.layout.widths[afterId], DEFAULT_LAYOUT.widths[afterId]),
    resizer
  };

  resizer.classList.add("is-active");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function handleResizeMove(event) {
  if (!resizeSession) {
    return;
  }

  const delta = event.clientX - resizeSession.startX;
  const { beforeId, afterId, beforeWidth, afterWidth } = resizeSession;

  if (beforeId !== "tracks" && afterId === "tracks") {
    state.layout.widths[beforeId] = clampWidth(beforeWidth + delta, beforeWidth);
  } else if (beforeId === "tracks" && afterId !== "tracks") {
    state.layout.widths[afterId] = clampWidth(afterWidth - delta, afterWidth);
  } else if (beforeId !== "tracks" && afterId !== "tracks") {
    state.layout.widths[beforeId] = clampWidth(beforeWidth + delta, beforeWidth);
    state.layout.widths[afterId] = clampWidth(afterWidth - delta, afterWidth);
  }

  applyLayout();
}

function endResize() {
  if (!resizeSession) {
    return;
  }

  resizeSession.resizer.classList.remove("is-active");
  resizeSession = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  persistLayout();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".track-menu-popover") && !event.target.closest(".track-row")) {
    closeActiveMenu();
    renderTracks();
  }
});

trackList.addEventListener("scroll", () => {
  if (!state.activeMenuTrackKey) {
    return;
  }

  closeActiveMenu();
  renderTracks();
});

window.addEventListener("resize", () => {
  if (!state.activeMenuTrackKey) {
    return;
  }

  closeActiveMenu();
  renderTracks();
});

resizers.forEach((resizer) => {
  resizer.addEventListener("mousedown", (event) => {
    beginResize(event, resizer.dataset.before, resizer.dataset.after, resizer);
  });
});

document.addEventListener("mousemove", handleResizeMove);
document.addEventListener("mouseup", endResize);

createPlaylistButton.addEventListener("click", () => {
  openPlaylistModal();
});

editPlaylistButton.addEventListener("click", () => {
  const playlist = getEditablePlaylist();
  if (!playlist) {
    return;
  }

  openPlaylistModal({
    mode: "edit",
    playlistId: playlist.id,
    title: "Edit playlist"
  });
});

toggleSidebarButton.addEventListener("click", () => {
  togglePanel("sidebar");
});

toggleDetailButton.addEventListener("click", () => {
  togglePanel("detail");
});

resetLayoutButton.addEventListener("click", resetLayout);
authButton.addEventListener("click", () => {
  if (state.auth.token) {
    void signOut().then(() => {
      render();
    });
    return;
  }

  openAuthModal("Enter the Apollo shared secret to continue.");
});
openSettingsButton.addEventListener("click", openSettingsModal);

playlistModalClose.addEventListener("click", closePlaylistModal);
playlistFormCancel.addEventListener("click", closePlaylistModal);
settingsModalClose.addEventListener("click", closeSettingsModal);
settingsFormCancel.addEventListener("click", closeSettingsModal);

playlistModal.querySelectorAll("[data-modal-close]").forEach((element) => {
  element.addEventListener("click", closePlaylistModal);
});
settingsModal.querySelectorAll("[data-settings-close]").forEach((element) => {
  element.addEventListener("click", closeSettingsModal);
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authFormMessage.textContent = "Signing in...";

  try {
    await signInWithSecret(authSecretInput.value);
    state.message = "Signed in to Apollo.";
    await refreshLibrary();
    renderStatus();
  } catch (error) {
    authFormMessage.textContent = error.message;
  }
});

playlistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  playlistFormMessage.textContent = "Saving...";
  const isEditing = state.modal.mode === "edit";

  try {
    let playlistId = state.modal.playlistId;
    if (isEditing && playlistId) {
      await updatePlaylist(playlistId, playlistNameInput.value, playlistDescriptionInput.value);
    } else {
      const playlist = await createPlaylist(
        playlistNameInput.value,
        playlistDescriptionInput.value,
        state.modal.initialTrackId
      );
      playlistId = playlist.id;
    }

    if (playlistId && state.modal.artworkFile) {
      await uploadPlaylistArtwork(playlistId, state.modal.artworkFile);
    } else if (playlistId && isEditing && state.modal.removeArtwork) {
      await deletePlaylistArtwork(playlistId);
    }

    state.selectedPlaylistId = playlistId || state.selectedPlaylistId;
    await refreshLibrary();
    closePlaylistModal();
    state.message = isEditing ? "Playlist updated." : "Playlist created.";
    renderStatus();
  } catch (error) {
    playlistFormMessage.textContent = error.message;
  }
});

playlistArtworkInput.addEventListener("change", () => {
  const file = playlistArtworkInput.files?.[0];
  if (!file) {
    return;
  }

  if (state.modal.artworkPreviewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(state.modal.artworkPreviewUrl);
  }

  state.modal.artworkFile = file;
  state.modal.artworkPreviewUrl = URL.createObjectURL(file);
  state.modal.removeArtwork = false;
  updatePlaylistArtworkUI();
});

playlistArtworkClear.addEventListener("click", () => {
  if (state.modal.artworkPreviewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(state.modal.artworkPreviewUrl);
  }

  state.modal.artworkFile = null;
  state.modal.artworkPreviewUrl = "";
  state.modal.removeArtwork = true;
  playlistArtworkInput.value = "";
  updatePlaylistArtworkUI();
});

playlistDeleteButton.addEventListener("click", async () => {
  if (!state.modal.playlistId) {
    return;
  }

  if (!state.modal.confirmDelete) {
    state.modal.confirmDelete = true;
    playlistDeleteButton.textContent = "Confirm delete";
    playlistFormMessage.textContent = "Click delete again to remove this playlist.";
    return;
  }

  playlistFormMessage.textContent = "Deleting...";
  try {
    await deletePlaylist(state.modal.playlistId);
    state.selectedPlaylistId = "all-tracks";
    await refreshLibrary();
    closePlaylistModal();
    state.message = "Playlist deleted.";
    renderStatus();
  } catch (error) {
    playlistFormMessage.textContent = error.message;
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.settings = saveCurrentSettingsForm();
  persistSettings();
  state.repeatMode = state.settings.playback.defaultRepeatMode;
  applySettings();
  settingsFormMessage.textContent = "Saved.";
  persistPlaybackState();

  if (state.query) {
    await runSearch();
  } else {
    render();
  }

  closeSettingsModal();
});

document.addEventListener("keydown", (event) => {
  if (state.auth.modalOpen) {
    return;
  }

  if (event.key === "Escape" && state.modal.isOpen) {
    closePlaylistModal();
    return;
  }

  if (event.key === "Escape" && state.settingsModalOpen) {
    closeSettingsModal();
    return;
  }

  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    audioPlayer.muted = false;
    audioPlayer.volume = clampNumber(audioPlayer.volume + state.settings.audio.volumeStep, 0, 1, audioPlayer.volume);
    volumeSlider.value = String(audioPlayer.volume);
    saveVolumeSetting();
    renderPlayback();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    audioPlayer.volume = clampNumber(audioPlayer.volume - state.settings.audio.volumeStep, 0, 1, audioPlayer.volume);
    audioPlayer.muted = audioPlayer.volume === 0;
    volumeSlider.value = String(audioPlayer.volume);
    saveVolumeSetting();
    renderPlayback();
  }
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    void runSearch();
  }, state.settings.search.liveSearchDelayMs);
});

repeatButton.addEventListener("click", () => {
  const modes = ["off", "all", "one"];
  const currentIndex = modes.indexOf(state.repeatMode);
  state.repeatMode = modes[(currentIndex + 1) % modes.length];
  persistPlaybackState();
  renderPlayback();
});

playButton.addEventListener("click", async () => {
  if (state.isBuffering) {
    return;
  }

  if (!audioPlayer.src) {
    await playSelectedTrack();
    return;
  }

  if (audioPlayer.paused) {
    state.isBuffering = true;
    renderPlayback();
    try {
      await audioPlayer.play();
    } catch (error) {
      state.isBuffering = false;
      state.message = error.message;
      render();
    }
    return;
  }

  audioPlayer.pause();
});

previousButton.addEventListener("click", () => {
  if ((audioPlayer.currentTime || 0) > state.settings.playback.previousSeekThreshold) {
    audioPlayer.currentTime = 0;
    renderPlayback();
    return;
  }

  playAdjacent(-1, state.repeatMode === "all");
});

nextButton.addEventListener("click", () => {
  playAdjacent(1, state.repeatMode === "all");
});

progressButton.addEventListener("click", (event) => {
  if (!audioPlayer.duration) {
    return;
  }

  const bounds = progressButton.getBoundingClientRect();
  const ratio = (event.clientX - bounds.left) / bounds.width;
  audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, audioPlayer.duration * ratio));
  renderPlayback();
});

volumeSlider.addEventListener("input", (event) => {
  audioPlayer.muted = false;
  audioPlayer.volume = Number(event.target.value);
  saveVolumeSetting();
  renderPlayback();
});

volumeButton.addEventListener("click", () => {
  audioPlayer.muted = !audioPlayer.muted;
  saveVolumeSetting();
  renderPlayback();
});

audioPlayer.addEventListener("loadstart", () => {
  state.isBuffering = true;
  renderPlayback();
});

audioPlayer.addEventListener("waiting", () => {
  state.isBuffering = true;
  renderPlayback();
});

audioPlayer.addEventListener("play", () => {
  state.isPlaying = true;
  state.isBuffering = false;
  state.message = "";
  render();
});

audioPlayer.addEventListener("pause", () => {
  state.isPlaying = false;
  if (!audioPlayer.ended) {
    state.isBuffering = false;
  }
  renderPlayback();
});

audioPlayer.addEventListener("timeupdate", renderPlayback);

audioPlayer.addEventListener("loadedmetadata", () => {
  const playbackTrack = getPlaybackTrack();
  if (playbackTrack && audioPlayer.duration) {
    durationCache.set(playbackTrack.key, audioPlayer.duration);
  }

  if (state.restoredPlaybackKey && state.playbackTrackKey === state.restoredPlaybackKey && playbackState.currentTime > 0) {
    audioPlayer.currentTime = Math.min(playbackState.currentTime, audioPlayer.duration || playbackState.currentTime);
    state.restoredPlaybackKey = null;
  }
  render();
});

audioPlayer.addEventListener("ended", () => {
  state.isPlaying = false;
  state.isBuffering = false;

  if (state.repeatMode === "one") {
    audioPlayer.currentTime = 0;
    void audioPlayer.play();
    return;
  }

  if (state.repeatMode === "all") {
    playAdjacent(1, true);
    return;
  }

  const nextTrack = getNextTrack(1, false);
  if (nextTrack) {
    state.selectedTrackKey = nextTrack.key;
    void playSelectedTrack();
    return;
  }

  renderPlayback();
});

window.addEventListener("focus", () => {
  void refreshLibrary();
});

window.addEventListener("blur", () => {
  if (!state.settings.playback.pauseOnBlur) {
    return;
  }

  state.wasPlayingBeforeBlur = !audioPlayer.paused;
  if (state.wasPlayingBeforeBlur) {
    audioPlayer.pause();
  }
});

audioPlayer.addEventListener("ratechange", () => {
  state.settings.playback.playbackRate = audioPlayer.playbackRate;
  persistSettings();
});

audioPlayer.addEventListener("timeupdate", () => {
  playbackState.currentTime = audioPlayer.currentTime || 0;
  persistPlaybackState();
});

await pluginHost.loadPlugins(builtinPlugins);
applySettings();
render();

async function initialiseApolloClient() {
  try {
    const canContinue = await refreshAuthStatus();
    render();
    if (canContinue) {
      await refreshLibrary();
    }
  } catch (error) {
    state.message = error.message;
    render();
  }
}

await initialiseApolloClient();
