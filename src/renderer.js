import { createPluginHost } from "./plugin-host.js";
import { builtinPlugins } from "./plugins/index.js";

const LIKED_STORAGE_KEY = "apollo-liked-tracks";
const LAYOUT_STORAGE_KEY = "apollo-layout-v1";
const SETTINGS_STORAGE_KEY = "apollo-settings-v1";
const PLAYBACK_STATE_STORAGE_KEY = "apollo-playback-state-v1";
const PLAYBACK_QUEUE_STORAGE_KEY = "apollo-playback-queue-v1";
const AUTH_STORAGE_KEY = "apollo-auth-session-v1";
const CLIENT_ID_STORAGE_KEY = "apollo-client-id-v1";
const desktopDiscordDefaults = window.apolloDesktop?.discordPresenceDefaults || {};
const discordSocialBridge = window.apolloDesktop?.discordSocial || null;
const DEFAULT_SERVER_URL = window.apolloDesktop?.serverUrl || "http://127.0.0.1:4848";
const APOLLO_DEEP_LINK_ROUTE_PLAY = "play";
const APOLLO_DEEP_LINK_ROUTE_LISTEN = "listen";
const DISCORD_LISTEN_ALONG_PARTY_MAX = 8;
const DISCORD_LISTEN_SESSION_POLL_MS = 1000;
const DISCORD_LISTEN_SESSION_RESYNC_THRESHOLD_SECONDS = 1;
const SEARCH_HISTORY_GROUP_WINDOW_MS = 1500;
const NAVIGATION_INPUT_DEDUPE_MS = 400;
const PROVIDER_ID_KEYS = ["spotify", "youtube", "soundcloud", "itunes", "isrc"];
const PLAYBACK_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONNECTION_SETTINGS = parseConnectionSettings(DEFAULT_SERVER_URL);
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
  connection: {
    ...DEFAULT_CONNECTION_SETTINGS
  },
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
      deezer: true,
      youtube: true,
      spotify: true,
      soundcloud: true,
      itunes: true
    },
    liveSearchDelayMs: 220
  },
  downloads: {
    autoRefreshLibrary: true
  },
  integrations: {
    discord: {
      enabled: Boolean(desktopDiscordDefaults.enabled),
      clientId: desktopDiscordDefaults.clientId || "",
      largeImageKey: desktopDiscordDefaults.largeImageKey || "",
      largeImageText: desktopDiscordDefaults.largeImageText || "Apollo Client",
      smallImageKeyPlaying: desktopDiscordDefaults.smallImageKeyPlaying || "",
      smallImageKeyPaused: desktopDiscordDefaults.smallImageKeyPaused || "",
      smallImageKeyBuffering: desktopDiscordDefaults.smallImageKeyBuffering || ""
    }
  }
};
const searchProviderOrder = ["deezer", "youtube", "spotify", "soundcloud", "itunes"];
const initialSettings = loadSettings();
const savedPlaybackState = loadPlaybackState();
const savedPlaybackQueue = loadPlaybackQueue();
const initialPlaybackQueueState = restorePersistedQueueState(savedPlaybackQueue, savedPlaybackState);
const savedAuthSession = loadAuthSession();
const windowControls = window.apolloDesktop?.windowControls || null;
const LOCAL_DISCORD_HOSTNAMES = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1"]);
const LOCAL_NETWORK_IPV4_PATTERN = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
const listenAlongState = {
  publishedSessionId: "",
  publishedTrackId: "",
  joinedSessionId: "",
  joinedTrackId: "",
  pollHandle: 0,
  pollInFlight: false
};

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

function createDiscordInviteState(overrides = {}) {
  return {
    isOpen: false,
    isLoading: false,
    isSending: false,
    selectedFriendId: "",
    friends: [],
    message: "Listen along on Apollo",
    formMessage: "",
    ...overrides
  };
}

function createTrackDeleteModalState(overrides = {}) {
  return {
    isOpen: false,
    isDeleting: false,
    track: null,
    message: "",
    ...overrides
  };
}

function createClientId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `apollo-client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadClientId() {
  try {
    const existingClientId = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existingClientId) {
      return existingClientId;
    }
  } catch {
    // Ignore storage access failures and regenerate below.
  }

  const clientId = createClientId();
  try {
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  } catch {
    // Ignore storage access failures.
  }
  return clientId;
}

function getDefaultPort(protocol) {
  return protocol === "https" ? "443" : "80";
}

function parseConnectionSettings(url) {
  try {
    const parsedUrl = new URL(String(url || "").trim() || DEFAULT_SERVER_URL);
    const protocol = parsedUrl.protocol === "https:" ? "https" : "http";
    return {
      protocol,
      hostname: parsedUrl.hostname || "127.0.0.1",
      port: parsedUrl.port || getDefaultPort(protocol)
    };
  } catch {
    return {
      protocol: "http",
      hostname: "127.0.0.1",
      port: "4848"
    };
  }
}

function normaliseConnectionSettings(connection = {}) {
  let protocol = String(connection?.protocol || "http").trim().toLowerCase();
  let hostname = String(connection?.hostname || "").trim();
  let port = String(connection?.port || "").trim();

  if (hostname.includes("://")) {
    const parsedUrl = new URL(hostname);
    protocol = parsedUrl.protocol === "https:" ? "https" : "http";
    hostname = parsedUrl.hostname;
    if (!port) {
      port = parsedUrl.port;
    }
  }

  if (!["http", "https"].includes(protocol)) {
    throw new Error("Choose a valid Apollo server protocol.");
  }

  if (!hostname) {
    throw new Error("Enter the Apollo server IP or host name.");
  }

  if (/[/?#]/.test(hostname)) {
    throw new Error("Enter only the Apollo server host or IP, not a full path.");
  }

  const resolvedPort = port || getDefaultPort(protocol);
  if (!/^\d+$/.test(resolvedPort)) {
    throw new Error("Enter a valid Apollo server port.");
  }

  const numericPort = Number(resolvedPort);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("Apollo server port must be between 1 and 65535.");
  }

  return {
    protocol,
    hostname: hostname.replace(/^\[|\]$/g, ""),
    port: String(numericPort)
  };
}

function buildApiBase(connection = DEFAULT_CONNECTION_SETTINGS) {
  const normalisedConnection = normaliseConnectionSettings(connection);
  return `${normalisedConnection.protocol}://${normalisedConnection.hostname}:${normalisedConnection.port}`;
}

function createConnectionModalState(overrides = {}) {
  return {
    isOpen: false,
    message: "",
    endpoint: "",
    ...overrides
  };
}

const state = {
  apiBase: buildApiBase(initialSettings.connection),
  clientId: loadClientId(),
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
  playbackManualQueue: initialPlaybackQueueState.manualQueue,
  playbackContextQueue: initialPlaybackQueueState.contextQueue,
  playbackContextIndex: initialPlaybackQueueState.contextIndex,
  playbackAutoplayQueue: initialPlaybackQueueState.autoplayQueue,
  playbackCurrentSource: initialPlaybackQueueState.currentSource,
  playbackQueueMode: savedPlaybackState.playbackQueueMode || "context",
  transientPlaybackTrack: null,
  activeMenuTrackKey: null,
  activeMenuAnchor: null,
  activePlaylistMenuId: null,
  activePlaylistMenuAnchor: null,
  activeQueueMenuId: "",
  activeQueueMenuAnchor: null,
  activeDetailTab: savedPlaybackState.activeDetailTab || "track",
  query: "",
  searchResults: [],
  artistSearchResults: [],
  artistBrowse: null,
  isConnected: false,
  isLoading: false,
  isBuffering: false,
  isPlaying: false,
  message: "",
  queueAutofillInFlight: false,
  shuffleEnabled: Boolean(savedPlaybackState.shuffleEnabled),
  repeatMode: savedPlaybackState.repeatMode || initialSettings.playback.defaultRepeatMode,
  searchTimer: null,
  modal: createPlaylistModalState(),
  discordInvite: createDiscordInviteState(),
  trackDeleteModal: createTrackDeleteModalState(),
  connectionModal: createConnectionModalState(),
  settingsModalOpen: false,
  restoredPlaybackKey: savedPlaybackState.playbackTrackKey || null,
  wasPlayingBeforeBlur: false,
  discordSocial: {
    available: Boolean(discordSocialBridge?.available),
    helperRunning: false,
    authenticated: false,
    ready: false,
    authInProgress: false,
    message: discordSocialBridge?.available
      ? "Discord chat invites require a one-time account connection."
      : "Discord chat invites are unavailable in this build."
  },
  windowChrome: {
    available: Boolean(windowControls?.available),
    isFocused: true,
    isMaximized: false
  }
};
const playbackState = {
  currentTime: savedPlaybackState.currentTime || 0
};

const durationCache = new Map();
const playbackUrlCache = new Map();
const pendingPlaybackUrlCache = new Map();
const searchResultCache = new Map();
const artistSearchCache = new Map();
const artistProfileCache = new Map();
const artistTracksCache = new Map();
const artistReleasesCache = new Map();
const pendingDurationKeys = new Set();
const likedTracks = loadLikedTracks();
let pluginHost;

let detailTabCleanup = null;
let resizeSession = null;
let removeWindowControlsListener = null;
let activeSearchRequestId = 0;
let activeArtistBrowseRequestId = 0;
let activePlaybackRequestId = 0;
let activeQueueDragId = "";
let queueEntryIdCounter = 0;
let activeSearchAbortController = null;
let activeArtistBrowseAbortController = null;
let currentNavigationSnapshot = null;
let lastNavigationCommitSource = "";
let lastNavigationCommitAt = 0;
let isApplyingNavigationHistory = false;
let lastNavigationInputAt = 0;
let lastNavigationInputDirection = 0;

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
const clearSearchButton = document.querySelector("#clear-library-search-button");
const windowMinimizeButton = document.querySelector("#window-minimize-button");
const windowMaximizeButton = document.querySelector("#window-maximize-button");
const windowCloseButton = document.querySelector("#window-close-button");
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
const shuffleButton = document.querySelector("#shuffle-button");
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
const playlistArtworkChoose = document.querySelector("#playlist-artwork-choose");
const playlistArtworkInput = document.querySelector("#playlist-artwork-input");
const playlistArtworkPreview = document.querySelector("#playlist-artwork-preview");
const playlistArtworkStatus = document.querySelector("#playlist-artwork-status");
const playlistArtworkClear = document.querySelector("#playlist-artwork-clear");
const trackDeleteModal = document.querySelector("#track-delete-modal");
const trackDeleteModalClose = document.querySelector("#track-delete-modal-close");
const trackDeleteCopy = document.querySelector("#track-delete-copy");
const trackDeleteMessage = document.querySelector("#track-delete-message");
const trackDeleteCancel = document.querySelector("#track-delete-cancel");
const trackDeleteConfirm = document.querySelector("#track-delete-confirm");
const authButton = document.querySelector("#auth-button");
const authModal = document.querySelector("#auth-modal");
const authForm = document.querySelector("#auth-form");
const authSecretInput = document.querySelector("#auth-secret-input");
const authFormCopy = document.querySelector("#auth-form-copy");
const authFormMessage = document.querySelector("#auth-form-message");
const authSubmitButton = document.querySelector("#auth-submit-button");
const connectionModal = document.querySelector("#connection-modal");
const connectionModalMessage = document.querySelector("#connection-modal-message");
const connectionModalEndpoint = document.querySelector("#connection-modal-endpoint");
const connectionModalRetry = document.querySelector("#connection-modal-retry");
const connectionModalSettings = document.querySelector("#connection-modal-settings");
const openSettingsButton = document.querySelector("#open-settings-button");
const settingsModal = document.querySelector("#settings-modal");
const settingsForm = document.querySelector("#settings-form");
const settingsModalClose = document.querySelector("#settings-modal-close");
const settingsFormCancel = document.querySelector("#settings-form-cancel");
const settingsFormMessage = document.querySelector("#settings-form-message");
const settingsServerProtocol = document.querySelector("#settings-server-protocol");
const settingsServerHostname = document.querySelector("#settings-server-hostname");
const settingsServerPort = document.querySelector("#settings-server-port");
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
const settingsProviderDeezer = document.querySelector("#settings-provider-deezer");
const settingsProviderYoutube = document.querySelector("#settings-provider-youtube");
const settingsProviderSpotify = document.querySelector("#settings-provider-spotify");
const settingsProviderSoundcloud = document.querySelector("#settings-provider-soundcloud");
const settingsProviderItunes = document.querySelector("#settings-provider-itunes");
const settingsSearchDelay = document.querySelector("#settings-search-delay");
const settingsAutoRefreshLibrary = document.querySelector("#settings-auto-refresh-library");
const settingsDiscordEnabled = document.querySelector("#settings-discord-enabled");
const settingsDiscordSocialStatus = document.querySelector("#settings-discord-social-status");
const settingsDiscordSocialConnect = document.querySelector("#settings-discord-social-connect");
const settingsDiscordSocialSignout = document.querySelector("#settings-discord-social-signout");
const discordInviteModal = document.querySelector("#discord-invite-modal");
const discordInviteForm = document.querySelector("#discord-invite-form");
const discordInviteModalClose = document.querySelector("#discord-invite-modal-close");
const discordInviteCancel = document.querySelector("#discord-invite-cancel");
const discordInviteFriends = document.querySelector("#discord-invite-friends");
const discordInviteMessageInput = document.querySelector("#discord-invite-message-input");
const discordInviteFormMessage = document.querySelector("#discord-invite-form-message");
const discordInviteSubmit = document.querySelector("#discord-invite-submit");

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

  try {
    merged.connection = normaliseConnectionSettings({
      protocol: override?.connection?.protocol ?? merged.connection.protocol,
      hostname: override?.connection?.hostname ?? merged.connection.hostname,
      port: override?.connection?.port ?? merged.connection.port
    });
  } catch {
    merged.connection = {
      ...merged.connection
    };
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
  merged.integrations.discord.enabled = override?.integrations?.discord?.enabled ?? merged.integrations.discord.enabled;
  merged.integrations.discord.clientId = typeof override?.integrations?.discord?.clientId === "string"
    ? override.integrations.discord.clientId.trim()
    : merged.integrations.discord.clientId;
  merged.integrations.discord.largeImageKey = typeof override?.integrations?.discord?.largeImageKey === "string"
    ? override.integrations.discord.largeImageKey.trim()
    : merged.integrations.discord.largeImageKey;
  merged.integrations.discord.largeImageText = typeof override?.integrations?.discord?.largeImageText === "string"
    ? override.integrations.discord.largeImageText.trim()
    : merged.integrations.discord.largeImageText;
  merged.integrations.discord.smallImageKeyPlaying = typeof override?.integrations?.discord?.smallImageKeyPlaying === "string"
    ? override.integrations.discord.smallImageKeyPlaying.trim()
    : merged.integrations.discord.smallImageKeyPlaying;
  merged.integrations.discord.smallImageKeyPaused = typeof override?.integrations?.discord?.smallImageKeyPaused === "string"
    ? override.integrations.discord.smallImageKeyPaused.trim()
    : merged.integrations.discord.smallImageKeyPaused;
  merged.integrations.discord.smallImageKeyBuffering = typeof override?.integrations?.discord?.smallImageKeyBuffering === "string"
    ? override.integrations.discord.smallImageKeyBuffering.trim()
    : merged.integrations.discord.smallImageKeyBuffering;
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

function loadPlaybackQueue() {
  try {
    const raw = localStorage.getItem(PLAYBACK_QUEUE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
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
      playbackContextIndex: state.playbackContextIndex,
      playbackCurrentSource: state.playbackCurrentSource,
      playbackQueueMode: state.playbackQueueMode,
      shuffleEnabled: state.shuffleEnabled,
      repeatMode: state.repeatMode,
      currentTime: audioPlayer.currentTime || playbackState.currentTime || 0
    })
  );
}

function persistPlaybackQueue() {
  if (
    !state.playbackManualQueue.length
    && !state.playbackContextQueue.length
    && !state.playbackAutoplayQueue.length
  ) {
    localStorage.removeItem(PLAYBACK_QUEUE_STORAGE_KEY);
    return;
  }

  localStorage.setItem(
    PLAYBACK_QUEUE_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      mode: state.playbackQueueMode,
      currentSource: state.playbackCurrentSource,
      contextIndex: state.playbackContextIndex,
      contextQueue: state.playbackContextQueue,
      manualQueue: state.playbackManualQueue,
      autoplayQueue: state.playbackAutoplayQueue
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

function syncRangeVisual(input, fallback = 0) {
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const min = Number(input.min || 0);
  const max = Number(input.max || 1);
  const value = clampNumber(input.value, min, max, fallback);
  const percent = max <= min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty("--range-percent", `${percent}%`);
}

function syncRangeVisuals() {
  syncRangeVisual(volumeSlider, state.settings.audio.volume);
  syncRangeVisual(settingsVolume, state.settings.audio.volume);
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
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55c-2.21 0-4 1.79-4 4s1.79 4 4 4s4-1.79 4-4V7h4V3h-6z"/>
    </svg>
  `;
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
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 6c.55 0 1 .45 1 1v10c0 .55-.45 1-1 1s-1-.45-1-1V7c0-.55.45-1 1-1zm3.66 6.82l5.77 4.07c.66.47 1.58-.01 1.58-.82V7.93c0-.81-.91-1.28-1.58-.82l-5.77 4.07a1 1 0 0 0 0 1.64z"/>
    </svg>
  `;
}

function getNextIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.58 16.89l5.77-4.07c.56-.4.56-1.24 0-1.63L7.58 7.11C6.91 6.65 6 7.12 6 7.93v8.14c0 .81.91 1.28 1.58.82zM16 7v10c0 .55.45 1 1 1s1-.45 1-1V7c0-.55-.45-1-1-1s-1 .45-1 1z"/>
    </svg>
  `;
}

function getWindowMaximizeIcon() {
  if (state.windowChrome.isMaximized) {
    return outlinedSvg(`
        <path d="M8 8h9v9H8Z"/>
        <path d="M11 8V5h8v8h-2"/>
      `);
  }

  return outlinedSvg(`
      <rect x="6" y="6" width="12" height="12" rx="1.5"/>
    `);
}

function renderWindowChrome() {
  document.body.classList.toggle("has-custom-chrome", state.windowChrome.available);
  document.body.classList.toggle("window-is-maximized", state.windowChrome.available && state.windowChrome.isMaximized);
  document.body.classList.toggle("window-is-focused", !state.windowChrome.available || state.windowChrome.isFocused);

  [windowMinimizeButton, windowMaximizeButton, windowCloseButton].forEach((button) => {
    if (button) {
      button.hidden = !state.windowChrome.available;
    }
  });

  if (!state.windowChrome.available || !windowMaximizeButton) {
    return;
  }

  windowMaximizeButton.innerHTML = getWindowMaximizeIcon();
  windowMaximizeButton.setAttribute(
    "aria-label",
    state.windowChrome.isMaximized ? "Restore window" : "Maximize window"
  );
}

function updateWindowChrome(nextState = {}) {
  state.windowChrome.isFocused = nextState.isFocused ?? state.windowChrome.isFocused;
  state.windowChrome.isMaximized = Boolean(nextState.isMaximized);
  renderWindowChrome();
}

function getPlayButtonIcon() {
  if (state.isPlaying || state.isBuffering) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M8 19c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2v10c0 1.1.9 2 2 2zm6-12v10c0 1.1.9 2 2 2s2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2z"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.69L9.54 5.98A.998.998 0 0 0 8 6.82z"/>
    </svg>
  `;
}

function playGlyphIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.69L9.54 5.98A.998.998 0 0 0 8 6.82z"/>
    </svg>
  `;
}

function closeSmallIcon() {
  return outlinedSvg(`
      <path d="M18 6 6 18"/>
      <path d="m6 6 12 12"/>
    `);
}

function getShuffleIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M10.59 9.17L6.12 4.7a.996.996 0 1 0-1.41 1.41l4.46 4.46l1.42-1.4zm4.76-4.32l1.19 1.19L4.7 17.88a.996.996 0 1 0 1.41 1.41L17.96 7.46l1.19 1.19a.5.5 0 0 0 .85-.36V4.5c0-.28-.22-.5-.5-.5h-3.79a.5.5 0 0 0-.36.85zm-.52 8.56l-1.41 1.41l3.13 3.13l-1.2 1.2a.5.5 0 0 0 .36.85h3.79c.28 0 .5-.22.5-.5v-3.79c0-.45-.54-.67-.85-.35l-1.19 1.19l-3.13-3.14z"/>
    </svg>
  `;
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

function providerLabel(provider, requestedProvider = "") {
  const labels = {
    library: "Library",
    deezer: "Deezer",
    spotify: "Spotify",
    youtube: "YouTube",
    soundcloud: "SoundCloud",
    itunes: "iTunes",
    musicbrainz: "MusicBrainz"
  };

  const resolvedProvider = labels[provider] || provider || "Remote";
  const resolvedRequestedProvider = labels[requestedProvider] || requestedProvider || "";

  if (resolvedRequestedProvider && requestedProvider !== provider) {
    return `${resolvedRequestedProvider} via ${resolvedProvider}`;
  }

  return resolvedProvider;
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

function isConnectionError(error) {
  return error?.code === "APOLLO_CONNECTION_FAILED";
}

function createConnectionError(message, cause) {
  const error = new Error(message);
  error.code = "APOLLO_CONNECTION_FAILED";
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function buildConnectionFailureMessage(error) {
  if (error?.message?.includes("Invalid URL")) {
    return "The Apollo server address is invalid. Update the protocol, IP, or port in Settings.";
  }

  return `Couldn't reach Apollo at ${state.apiBase}. Check that the server is running and that the IP and port are correct.`;
}

function openConnectionModal(message = buildConnectionFailureMessage()) {
  state.connectionModal = createConnectionModalState({
    isOpen: true,
    message,
    endpoint: state.apiBase
  });
  state.isConnected = false;
  closeAuthModal();
  connectionModalMessage.textContent = message;
  connectionModalEndpoint.textContent = state.apiBase;
  connectionModal.classList.add("is-open");
  connectionModal.setAttribute("aria-hidden", "false");
}

function closeConnectionModal() {
  state.connectionModal.isOpen = false;
  connectionModal.classList.remove("is-open");
  connectionModal.setAttribute("aria-hidden", "true");
}

function handleConnectionFailure(error) {
  state.message = error.message;
  openConnectionModal(error.message);
  renderStatus();
}

function openAuthModal(message = "") {
  state.auth.modalOpen = true;
  closeConnectionModal();
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

function clearApolloData() {
  state.libraryTracks = [];
  state.playlists = [];
  state.searchResults = [];
  state.artistSearchResults = [];
  state.playbackManualQueue = [];
  state.playbackContextQueue = [];
  state.playbackContextIndex = 0;
  state.playbackAutoplayQueue = [];
  state.playbackCurrentSource = "standalone";
  searchResultCache.clear();
  artistSearchCache.clear();
  artistProfileCache.clear();
  artistTracksCache.clear();
  artistReleasesCache.clear();
  playbackUrlCache.clear();
  pendingPlaybackUrlCache.clear();
  clearArtistBrowseState();
  state.selectedTrackKey = null;
  state.playbackTrackKey = null;
  state.transientPlaybackTrack = null;
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  persistPlaybackState();
  persistPlaybackQueue();
}

function handleServerEndpointChanged() {
  clearAuthSession();
  state.auth.enabled = false;
  state.auth.configured = false;
  state.auth.sessionTtlHours = 0;
  clearApolloData();
  updateAuthButton();
  syncDiscordPresence();
}

function updateAuthButton() {
  authButton.hidden = !state.auth.enabled && !state.auth.token;
  authButton.textContent = state.auth.token ? "Sign out" : "Sign in";
}

async function refreshAuthStatus() {
  let status;
  try {
    status = await requestJson("/api/auth/status", { skipAuth: true });
  } catch (error) {
    if (isConnectionError(error)) {
      updateAuthButton();
      return false;
    }
    throw error;
  }

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
  pluginHost?.emit("auth:changed", {
    authenticated: Boolean(state.auth.token),
    auth: { ...state.auth }
  });
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
  clearApolloData();
  updateAuthButton();
  syncDiscordPresence();

  if (state.auth.enabled) {
    openAuthModal("Signed out. Enter the Apollo shared secret to continue.");
  }

  pluginHost?.emit("auth:changed", {
    authenticated: false,
    auth: { ...state.auth }
  });
}

function buildTrackKey(prefix, id) {
  return `${prefix}:${id}`;
}

function normaliseProviderIds(providerIds = {}) {
  const nextProviderIds = {};

  PROVIDER_ID_KEYS.forEach((key) => {
    const value = providerIds?.[key];
    nextProviderIds[key] = typeof value === "string" ? value.trim() : value ? String(value) : "";
  });

  return nextProviderIds;
}

function normaliseMetadataText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getTrackNormalizedDuration(track) {
  const value = Number(track?.normalizedDuration ?? track?.duration ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getTrackNormalizedText(track, normalizedKey, fallbackKey) {
  return normaliseMetadataText(track?.[normalizedKey] || track?.[fallbackKey] || "");
}

function buildSearchCacheKey(query, options = {}) {
  return JSON.stringify({
    query: String(query || "").trim().toLowerCase(),
    scope: String(options.scope || "all"),
    provider: Array.isArray(options.providers)
      ? options.providers.join(",")
      : String(options.provider || ""),
    includeLibraryResults: Boolean(state.settings.search.includeLibraryResults),
    providers: getEnabledProviders(),
    apiBase: state.apiBase
  });
}

function readCachedSearchResult(query, options = {}) {
  const cacheKey = buildSearchCacheKey(query, options);
  const cached = searchResultCache.get(cacheKey);
  return cached ? structuredClone(cached) : null;
}

function writeCachedSearchResult(query, result, options = {}) {
  const cacheKey = buildSearchCacheKey(query, options);
  searchResultCache.set(cacheKey, structuredClone(result));

  if (searchResultCache.size <= 20) {
    return;
  }

  const oldestKey = searchResultCache.keys().next().value;
  if (oldestKey) {
    searchResultCache.delete(oldestKey);
  }
}

function normaliseArtist(artist = {}) {
  return {
    id: String(artist.id || "").trim(),
    name: String(artist.name || "Unknown Artist").trim(),
    sortName: String(artist.sortName || artist["sort-name"] || artist.name || "").trim(),
    type: String(artist.type || "").trim(),
    country: String(artist.country || "").trim(),
    area: String(artist.area || "").trim(),
    disambiguation: String(artist.disambiguation || "").trim(),
    source: String(artist.source || "musicbrainz").trim(),
    aliases: Array.isArray(artist.aliases) ? artist.aliases.filter(Boolean) : [],
    genres: Array.isArray(artist.genres) ? artist.genres.filter(Boolean) : [],
    links: Array.isArray(artist.links) ? artist.links.filter(Boolean) : [],
    tags: Array.isArray(artist.tags) ? artist.tags.filter(Boolean) : [],
    artwork: String(
      artist.artwork
      || artist.artworkUrl
      || artist.image
      || artist.imageUrl
      || artist.thumbnail
      || artist.thumb
      || artist.avatar
      || artist.photo
      || ""
    ).trim(),
    lifeSpan: {
      begin: String(artist.lifeSpan?.begin || "").trim(),
      end: String(artist.lifeSpan?.end || "").trim(),
      ended: Boolean(artist.lifeSpan?.ended)
    }
  };
}

function readCachedArtistSearchResult(query) {
  const cacheKey = `${state.apiBase}::${String(query || "").trim().toLowerCase()}`;
  const cached = artistSearchCache.get(cacheKey);
  return cached ? structuredClone(cached) : null;
}

function writeCachedArtistSearchResult(query, result) {
  const cacheKey = `${state.apiBase}::${String(query || "").trim().toLowerCase()}`;
  artistSearchCache.set(cacheKey, structuredClone(result));

  if (artistSearchCache.size <= 20) {
    return;
  }

  const oldestKey = artistSearchCache.keys().next().value;
  if (oldestKey) {
    artistSearchCache.delete(oldestKey);
  }
}

function getArtistBrowseSummary(artistId = state.artistBrowse?.id || "") {
  if (!artistId) {
    return null;
  }

  if (state.artistBrowse?.id === artistId) {
    return state.artistBrowse;
  }

  const searchMatch = state.artistSearchResults.find((artist) => artist.id === artistId);
  if (searchMatch) {
    return searchMatch;
  }

  return artistProfileCache.get(artistId) || null;
}

function formatArtistSubtitle(artist) {
  return [
    artist?.type,
    artist?.area || artist?.country,
    artist?.disambiguation
  ].filter(Boolean).join(" | ");
}

function clearArtistBrowseState() {
  state.artistSearchResults = [];
  state.artistBrowse = null;
}

function normaliseNavigationArtist(artist) {
  if (!artist) {
    return null;
  }

  const nextArtist = normaliseArtist(artist);
  return nextArtist.id ? nextArtist : null;
}

function serialiseNavigationTracks(tracks = []) {
  if (!Array.isArray(tracks)) {
    return [];
  }

  return tracks.map((track) => serialiseTrack(track));
}

function serialiseNavigationArtists(artists = []) {
  if (!Array.isArray(artists)) {
    return [];
  }

  return artists.map((artist) => normaliseArtist(artist));
}

function createNavigationSnapshot() {
  const hasCachedQueryState = Boolean(state.query);

  return {
    selectedPlaylistId: typeof state.selectedPlaylistId === "string" && state.selectedPlaylistId
      ? state.selectedPlaylistId
      : "all-tracks",
    query: String(state.query || "").trim(),
    artistBrowse: normaliseNavigationArtist(state.artistBrowse),
    selectedTrackKey: typeof state.selectedTrackKey === "string" ? state.selectedTrackKey : null,
    hasCachedQueryState,
    searchResults: hasCachedQueryState ? serialiseNavigationTracks(state.searchResults) : [],
    artistSearchResults: hasCachedQueryState ? serialiseNavigationArtists(state.artistSearchResults) : [],
    message: hasCachedQueryState ? String(state.message || "") : "",
    trackListScrollTop: Number(trackList?.scrollTop || 0),
    playlistListScrollTop: Number(playlistList?.scrollTop || 0)
  };
}

function normaliseNavigationSnapshot(snapshot = {}) {
  return {
    selectedPlaylistId: typeof snapshot?.selectedPlaylistId === "string" && snapshot.selectedPlaylistId
      ? snapshot.selectedPlaylistId
      : "all-tracks",
    query: String(snapshot?.query || "").trim(),
    artistBrowse: normaliseNavigationArtist(snapshot?.artistBrowse),
    selectedTrackKey: typeof snapshot?.selectedTrackKey === "string" ? snapshot.selectedTrackKey : null,
    hasCachedQueryState: Boolean(snapshot?.hasCachedQueryState),
    searchResults: serialiseNavigationTracks(snapshot?.searchResults),
    artistSearchResults: serialiseNavigationArtists(snapshot?.artistSearchResults),
    message: String(snapshot?.message || ""),
    trackListScrollTop: Math.max(0, Number(snapshot?.trackListScrollTop || 0)),
    playlistListScrollTop: Math.max(0, Number(snapshot?.playlistListScrollTop || 0))
  };
}

function navigationSnapshotsEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.selectedPlaylistId === right.selectedPlaylistId
    && left.query === right.query
    && left.selectedTrackKey === right.selectedTrackKey
    && (left.artistBrowse?.id || "") === (right.artistBrowse?.id || "");
}

function shouldReplaceNavigationHistory(source, nextSnapshot) {
  return source === "search-input"
    && lastNavigationCommitSource === "search-input"
    && Boolean(currentNavigationSnapshot?.query)
    && Boolean(nextSnapshot?.query)
    && !currentNavigationSnapshot?.artistBrowse
    && !nextSnapshot?.artistBrowse
    && (Date.now() - lastNavigationCommitAt) <= SEARCH_HISTORY_GROUP_WINDOW_MS;
}

function replaceCurrentNavigationHistoryState() {
  if (isApplyingNavigationHistory || !currentNavigationSnapshot) {
    return;
  }

  currentNavigationSnapshot = createNavigationSnapshot();
  window.history.replaceState({
    apolloNavigation: currentNavigationSnapshot
  }, "");
}

function syncNavigationHistory(source, { replace = false } = {}) {
  const nextSnapshot = createNavigationSnapshot();

  if (isApplyingNavigationHistory) {
    currentNavigationSnapshot = nextSnapshot;
    return;
  }

  if (navigationSnapshotsEqual(nextSnapshot, currentNavigationSnapshot)) {
    return;
  }

  const historyState = {
    apolloNavigation: nextSnapshot
  };

  if (!currentNavigationSnapshot || replace || shouldReplaceNavigationHistory(source, nextSnapshot)) {
    window.history.replaceState(historyState, "");
  } else {
    window.history.pushState(historyState, "");
  }

  currentNavigationSnapshot = nextSnapshot;
  lastNavigationCommitSource = source;
  lastNavigationCommitAt = Date.now();
}

function initialiseNavigationHistory() {
  currentNavigationSnapshot = createNavigationSnapshot();
  window.history.replaceState({
    apolloNavigation: currentNavigationSnapshot
  }, "");
  lastNavigationCommitSource = "initial-load";
  lastNavigationCommitAt = Date.now();
}

function restoreNavigationScrollPositions(snapshot) {
  const nextTrackScrollTop = Math.max(0, Number(snapshot?.trackListScrollTop || 0));
  const nextPlaylistScrollTop = Math.max(0, Number(snapshot?.playlistListScrollTop || 0));

  requestAnimationFrame(() => {
    if (trackList) {
      trackList.scrollTop = nextTrackScrollTop;
    }

    if (playlistList) {
      playlistList.scrollTop = nextPlaylistScrollTop;
    }
  });
}

function openPlaylistView(playlistId, { historySource = "" } = {}) {
  replaceCurrentNavigationHistoryState();
  state.selectedPlaylistId = playlistId;
  state.query = "";
  state.searchResults = [];
  clearArtistBrowseState();
  closeActiveMenu();
  searchInput.value = "";
  renderSearchField();
  syncSelectedTrack();
  persistPlaybackState();
  render();

  if (historySource) {
    syncNavigationHistory(historySource);
  }
}

function isNavigationBlockedByModal() {
  return state.auth.modalOpen
    || state.modal.isOpen
    || state.trackDeleteModal.isOpen
    || state.connectionModal.isOpen
    || state.settingsModalOpen
    || state.discordInvite.isOpen;
}

async function applyNavigationSnapshot(snapshot) {
  const nextSnapshot = normaliseNavigationSnapshot(snapshot);

  isApplyingNavigationHistory = true;
  clearTimeout(state.searchTimer);
  closeActiveMenu();

  try {
    state.selectedPlaylistId = nextSnapshot.selectedPlaylistId;
    state.query = nextSnapshot.query;
    state.selectedTrackKey = nextSnapshot.selectedTrackKey;
    searchInput.value = nextSnapshot.query;
    renderSearchField();

    if (!nextSnapshot.query) {
      abortPendingSearchRequest();
      abortPendingArtistBrowseRequest();
      state.searchResults = [];
      state.message = state.isConnected ? "" : state.message;
      clearArtistBrowseState();
      syncSelectedTrack();
      persistPlaybackState();
      render();
      restoreNavigationScrollPositions(nextSnapshot);
      return;
    }

    if (nextSnapshot.hasCachedQueryState) {
      abortPendingSearchRequest();
      abortPendingArtistBrowseRequest();
      state.searchResults = serialiseNavigationTracks(nextSnapshot.searchResults);
      state.artistSearchResults = serialiseNavigationArtists(nextSnapshot.artistSearchResults);
      state.artistBrowse = normaliseNavigationArtist(nextSnapshot.artistBrowse);
      state.message = nextSnapshot.message || (state.isConnected ? "" : state.message);
      state.isLoading = false;
      syncSelectedTrack();
      prefetchPlaybackUrl(getSelectedTrack());
      persistPlaybackState();
      render();
      restoreNavigationScrollPositions(nextSnapshot);
      return;
    }

    await runSearch();

    if (nextSnapshot.artistBrowse?.id) {
      await beginArtistBrowse(nextSnapshot.artistBrowse);
    }

    state.selectedTrackKey = nextSnapshot.selectedTrackKey;
    syncSelectedTrack();
    persistPlaybackState();
    render();
    restoreNavigationScrollPositions(nextSnapshot);
  } finally {
    currentNavigationSnapshot = createNavigationSnapshot();
    lastNavigationCommitSource = "history";
    lastNavigationCommitAt = Date.now();
    isApplyingNavigationHistory = false;
  }
}

function requestHistoryNavigation(direction) {
  if (isNavigationBlockedByModal()) {
    return;
  }

  const now = Date.now();
  if (
    direction === lastNavigationInputDirection
    && (now - lastNavigationInputAt) <= NAVIGATION_INPUT_DEDUPE_MS
  ) {
    return;
  }

  lastNavigationInputDirection = direction;
  lastNavigationInputAt = now;
  replaceCurrentNavigationHistoryState();

  if (direction < 0) {
    window.history.back();
    return;
  }

  window.history.forward();
}

function handleNavigationMouseButton(event) {
  if (event.button !== 3 && event.button !== 4) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  requestHistoryNavigation(event.button === 3 ? -1 : 1);
}

function hasMatchingProviderIds(leftTrack, rightTrack) {
  const leftProviderIds = normaliseProviderIds(leftTrack?.providerIds);
  const rightProviderIds = normaliseProviderIds(rightTrack?.providerIds);

  return PROVIDER_ID_KEYS.some((key) => {
    const leftValue = normaliseMetadataText(leftProviderIds[key]);
    const rightValue = normaliseMetadataText(rightProviderIds[key]);
    return Boolean(leftValue && rightValue && leftValue === rightValue);
  });
}

function hasMatchingNormalizedMetadata(leftTrack, rightTrack) {
  const leftTitle = getTrackNormalizedText(leftTrack, "normalizedTitle", "title");
  const rightTitle = getTrackNormalizedText(rightTrack, "normalizedTitle", "title");
  const leftArtist = getTrackNormalizedText(leftTrack, "normalizedArtist", "artist");
  const rightArtist = getTrackNormalizedText(rightTrack, "normalizedArtist", "artist");

  if (!leftTitle || !rightTitle || !leftArtist || !rightArtist) {
    return false;
  }

  if (leftTitle !== rightTitle || leftArtist !== rightArtist) {
    return false;
  }

  const leftDuration = getTrackNormalizedDuration(leftTrack);
  const rightDuration = getTrackNormalizedDuration(rightTrack);
  if (leftDuration && rightDuration && Math.abs(leftDuration - rightDuration) > 3) {
    return false;
  }

  return true;
}

function findLibraryMatch(track) {
  if (!track) {
    return null;
  }

  const libraryTrackId = track.trackId || (track.provider === "library" ? track.id : "");
  if (libraryTrackId) {
    return state.libraryTracks.find((candidate) => candidate.trackId === libraryTrackId) || null;
  }

  return state.libraryTracks.find((candidate) => {
    return hasMatchingProviderIds(track, candidate) || hasMatchingNormalizedMetadata(track, candidate);
  }) || null;
}

function resolveTrackLibraryId(track) {
  return findLibraryMatch(track)?.trackId || "";
}

function isFallbackTrack(track) {
  return Boolean(
    track?.requestedProvider &&
    track.requestedProvider !== track.provider
  ) || String(track?.metadataSource || "").includes("fallback");
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
    providerIds: normaliseProviderIds(track.providerIds),
    provider: track.provider || "remote",
    resultSource: track.resultSource || "remote",
    externalUrl: track.externalUrl || "",
    downloadTarget: track.downloadTarget || "",
    normalizedTitle: track.normalizedTitle || getTrackNormalizedText(track, "normalizedTitle", "title"),
    normalizedArtist: track.normalizedArtist || getTrackNormalizedText(track, "normalizedArtist", "artist"),
    normalizedAlbum: track.normalizedAlbum || getTrackNormalizedText(track, "normalizedAlbum", "album"),
    normalizedDuration: getTrackNormalizedDuration(track) || null,
    metadataSource: track.metadataSource || track.provider || "remote",
    requestedProvider: track.requestedProvider || ""
  };
}

function nextQueueEntryId() {
  queueEntryIdCounter += 1;
  return `queue-${Date.now()}-${queueEntryIdCounter}`;
}

function restoreTrackList(tracks) {
  if (!Array.isArray(tracks)) {
    return [];
  }

  return tracks
    .map((track) => {
      try {
        return serialiseTrack(track);
      } catch {
        return null;
      }
    })
    .filter((track) => Boolean(track?.key));
}

function createQueueEntry(track, entryId = "") {
  try {
    const serialisedTrack = serialiseTrack(track);
    if (!serialisedTrack?.key) {
      return null;
    }

    return {
      id: entryId || nextQueueEntryId(),
      track: serialisedTrack
    };
  } catch {
    return null;
  }
}

function restoreQueueEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      if (entry?.track) {
        return createQueueEntry(entry.track, String(entry.id || ""));
      }

      return createQueueEntry(entry);
    })
    .filter(Boolean);
}

function resolveContextIndex(queue, contextIndex, playbackTrackKey = null) {
  if (!queue.length) {
    return -1;
  }

  const numericIndex = Number(contextIndex);
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < queue.length) {
    return numericIndex;
  }

  if (playbackTrackKey) {
    const matchingIndex = queue.findIndex((track) => track.key === playbackTrackKey);
    if (matchingIndex >= 0) {
      return matchingIndex;
    }
  }

  return 0;
}

function restorePersistedQueueState(savedQueue, savedState = {}) {
  const legacyQueue = restoreTrackList(savedQueue);
  if (Array.isArray(savedQueue)) {
    return {
      manualQueue: [],
      contextQueue: legacyQueue,
      contextIndex: resolveContextIndex(legacyQueue, savedState.playbackContextIndex ?? savedState.playbackQueueIndex, savedState.playbackTrackKey),
      autoplayQueue: [],
      currentSource: legacyQueue.length ? "context" : "standalone"
    };
  }

  const contextQueue = restoreTrackList(savedQueue?.contextQueue);
  return {
    manualQueue: restoreQueueEntries(savedQueue?.manualQueue),
    contextQueue,
    contextIndex: resolveContextIndex(contextQueue, savedQueue?.contextIndex ?? savedState.playbackContextIndex, savedState.playbackTrackKey),
    autoplayQueue: restoreQueueEntries(savedQueue?.autoplayQueue),
    currentSource: ["context", "manual", "autoplay", "standalone"].includes(savedQueue?.currentSource)
      ? savedQueue.currentSource
      : contextQueue.length
        ? "context"
        : "standalone"
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
    providerIds: normaliseProviderIds(track.providerIds),
    provider: "library",
    resultSource: "library",
    externalUrl: track.externalUrl || `${state.apiBase}/stream/${trackId}`,
    downloadTarget: track.downloadTarget || `${state.apiBase}/stream/${trackId}?download=1`,
    normalizedTitle: track.normalizedTitle || getTrackNormalizedText(track, "normalizedTitle", "title"),
    normalizedArtist: track.normalizedArtist || getTrackNormalizedText(track, "normalizedArtist", "artist"),
    normalizedAlbum: track.normalizedAlbum || getTrackNormalizedText(track, "normalizedAlbum", "album"),
    normalizedDuration: getTrackNormalizedDuration(track) || null,
    metadataSource: track.metadataSource || "library",
    requestedProvider: ""
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
    providerIds: normaliseProviderIds(track.providerIds),
    provider: track.provider || "remote",
    resultSource: "remote",
    externalUrl: track.externalUrl || "",
    downloadTarget: track.downloadTarget || track.externalUrl || "",
    normalizedTitle: track.normalizedTitle || getTrackNormalizedText(track, "normalizedTitle", "title"),
    normalizedArtist: track.normalizedArtist || getTrackNormalizedText(track, "normalizedArtist", "artist"),
    normalizedAlbum: track.normalizedAlbum || getTrackNormalizedText(track, "normalizedAlbum", "album"),
    normalizedDuration: getTrackNormalizedDuration(track) || null,
    metadataSource: track.metadataSource || track.provider || "remote",
    requestedProvider: track.requestedProvider || ""
  };
}

async function requestJson(path, options = {}) {
  const { skipAuth = false, suppressConnectionModal = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  if (!(fetchOptions.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!skipAuth && state.auth.token && !headers.has("Authorization")) {
    headers.set("Authorization", getAuthorizationHeader());
  }

  let requestUrl = "";
  try {
    requestUrl = new URL(path, `${state.apiBase}/`).toString();
  } catch (error) {
    const connectionError = createConnectionError(buildConnectionFailureMessage(error), error);
    if (!suppressConnectionModal) {
      handleConnectionFailure(connectionError);
    }
    throw connectionError;
  }

  let response;
  try {
    response = await fetch(requestUrl, {
      ...fetchOptions,
      headers
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const connectionError = createConnectionError(buildConnectionFailureMessage(error), error);
    if (!suppressConnectionModal) {
      handleConnectionFailure(connectionError);
    }
    throw connectionError;
  }

  state.isConnected = true;
  closeConnectionModal();

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
  const trimmedQuery = String(query || "").trim();
  const cachedResult = readCachedSearchResult(trimmedQuery);
  if (cachedResult) {
    return cachedResult;
  }

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
    const payload = await requestJson(
      buildSearchRequestPath(trimmedQuery, "all", "all"),
      createSearchRequestOptions()
    );
    const libraryItems = (payload.library?.items || []).map(normaliseLibraryTrack);
    const remoteItems = (payload.remote?.items || []).map(normaliseRemoteTrack);
    const result = {
      tracks: [...libraryItems, ...remoteItems],
      warnings: [payload.library?.warning, payload.remote?.warning].filter(Boolean)
    };
    writeCachedSearchResult(trimmedQuery, result);
    return result;
  }

  const requests = [];
  if (includeLibraryResults) {
    requests.push(
      requestJson(
        buildSearchRequestPath(trimmedQuery, "library", "all"),
        createSearchRequestOptions()
      ).then((payload) => ({
        scope: "library",
        tracks: (payload.library?.items || []).map(normaliseLibraryTrack),
        warning: payload.library?.warning || ""
      }))
    );
  }

  if (enabledProviders.length) {
    requests.push(
      requestJson(
        buildSearchRequestPath(trimmedQuery, "remote", remoteProviderParam),
        createSearchRequestOptions()
      ).then((payload) => ({
        scope: "remote",
        tracks: (payload.remote?.items || []).map(normaliseRemoteTrack),
        warning: payload.remote?.warning || ""
      }))
    );
  }

  const results = await Promise.all(requests);
  const libraryItems = results.find((result) => result.scope === "library")?.tracks || [];
  const remoteItems = dedupeTracks(results.find((result) => result.scope === "remote")?.tracks || []);
  const result = {
    tracks: [...libraryItems, ...remoteItems],
    warnings: Array.from(new Set(results.map((result) => result.warning).filter(Boolean)))
  };
  writeCachedSearchResult(trimmedQuery, result);
  return result;
}

async function fetchRemoteSearchResults(query, { signal } = {}) {
  const trimmedQuery = String(query || "").trim();
  const enabledProviders = getEnabledProviders();
  if (!trimmedQuery || !enabledProviders.length) {
    return {
      tracks: [],
      warnings: []
    };
  }

  const useAllProviders = enabledProviders.length === searchProviderOrder.length;
  const remoteProviderParam = useAllProviders ? "all" : enabledProviders.join(",");
  const cachedResult = readCachedSearchResult(trimmedQuery, {
    scope: "remote",
    provider: remoteProviderParam,
    providers: enabledProviders
  });
  if (cachedResult) {
    return cachedResult;
  }

  const payload = await requestJson(
    buildSearchRequestPath(trimmedQuery, "remote", remoteProviderParam),
    createSearchRequestOptions({ signal })
  );
  const result = {
    tracks: dedupeTracks((payload.remote?.items || []).map(normaliseRemoteTrack)),
    warnings: [payload.remote?.warning].filter(Boolean)
  };
  writeCachedSearchResult(trimmedQuery, result, {
    scope: "remote",
    provider: remoteProviderParam,
    providers: enabledProviders
  });
  return result;
}

async function fetchArtistSearchResults(query, { signal } = {}) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return [];
  }

  const cachedResult = readCachedArtistSearchResult(trimmedQuery);
  if (cachedResult) {
    return cachedResult;
  }

  const payload = await requestJson(
    `/api/artists?query=${encodeURIComponent(trimmedQuery)}&page=1&pageSize=6`,
    { signal }
  );
  const result = (payload.items || []).map(normaliseArtist);
  writeCachedArtistSearchResult(trimmedQuery, result);
  return result;
}

async function fetchArtistProfile(artistId, { signal } = {}) {
  if (artistProfileCache.has(artistId)) {
    return artistProfileCache.get(artistId);
  }

  const profile = normaliseArtist(
    await requestJson(`/api/artists/${encodeURIComponent(artistId)}`, { signal })
  );
  artistProfileCache.set(artistId, profile);
  return profile;
}

async function fetchArtistTracks(artistId, { signal } = {}) {
  if (artistTracksCache.has(artistId)) {
    return artistTracksCache.get(artistId);
  }

  const payload = await requestJson(
    `/api/artists/${encodeURIComponent(artistId)}/tracks?page=1&pageSize=50`,
    { signal }
  );
  const tracks = dedupeTracks((payload.items || []).map(normaliseRemoteTrack));
  artistTracksCache.set(artistId, tracks);
  return tracks;
}

async function fetchArtistReleases(artistId, { signal } = {}) {
  if (artistReleasesCache.has(artistId)) {
    return artistReleasesCache.get(artistId);
  }

  const payload = await requestJson(
    `/api/artists/${encodeURIComponent(artistId)}/releases?page=1&pageSize=6`,
    { signal }
  );
  const releases = (payload.items || []).map((release) => ({
    id: release.id || "",
    title: release.title || "Untitled release",
    primaryType: release.primaryType || "",
    firstReleaseDate: release.firstReleaseDate || ""
  }));
  artistReleasesCache.set(artistId, releases);
  return releases;
}

function abortPendingSearchRequest() {
  activeSearchAbortController?.abort();
  activeSearchAbortController = null;
}

function abortPendingArtistBrowseRequest() {
  activeArtistBrowseAbortController?.abort();
  activeArtistBrowseAbortController = null;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function isSearchRequestCurrent(requestId, query) {
  return requestId === activeSearchRequestId
    && query === String(state.query || "").trim();
}

function matchesTrackQuery(track, query) {
  const normalizedQuery = normaliseMetadataText(query);
  if (!normalizedQuery) {
    return true;
  }

  return [
    getTrackNormalizedText(track, "normalizedTitle", "title"),
    getTrackNormalizedText(track, "normalizedArtist", "artist"),
    getTrackNormalizedText(track, "normalizedAlbum", "album")
  ].some((value) => value.includes(normalizedQuery));
}

function getLocalSearchResults(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery || !state.settings.search.includeLibraryResults) {
    return [];
  }

  return state.libraryTracks.filter((track) => matchesTrackQuery(track, trimmedQuery));
}

function buildSearchStatusMessage({ artistCount, libraryCount, remoteCount, warnings = [], remotePending = false }) {
  const summary = [
    `${artistCount} artists`,
    `${libraryCount} library`,
    remotePending ? "searching remote..." : `${remoteCount} remote`
  ].join(" | ");

  return warnings.length ? `${summary} | ${warnings.join(" ")}` : summary;
}

function getArtistArtwork(artist = {}, tracks = []) {
  const candidates = [
    artist.artwork,
    artist.image,
    artist.imageUrl,
    artist.thumbnail,
    artist.thumb,
    artist.avatar,
    artist.photo
  ];

  if (Array.isArray(tracks)) {
    tracks.forEach((track) => {
      candidates.push(track?.artwork);
    });
  }

  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim()) || "";
}

function getArtistInitials(name = "") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "A";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function renderArtistArtwork(artist, className, tracks = []) {
  const artwork = getArtistArtwork(artist, tracks);
  if (artwork) {
    return `<img class="${className}" src="${escapeHtml(withAccessToken(artwork))}" alt="${escapeHtml(artist?.name || "Artist artwork")}">`;
  }

  return `<span class="${className} artist-artwork-fallback" aria-hidden="true">${escapeHtml(getArtistInitials(artist?.name))}</span>`;
}

async function beginArtistBrowse(artist, { historySource = "" } = {}) {
  const nextArtist = normaliseArtist(artist);
  if (!nextArtist.id) {
    return;
  }

  if (historySource) {
    replaceCurrentNavigationHistoryState();
  }

  const requestId = ++activeArtistBrowseRequestId;
  abortPendingArtistBrowseRequest();
  const abortController = new AbortController();
  activeArtistBrowseAbortController = abortController;
  state.artistBrowse = {
    ...nextArtist,
    isLoading: true,
    error: ""
  };
  state.artistSearchResults = [];
  state.searchResults = [];
  state.isLoading = true;
  state.message = `Loading songs by ${nextArtist.name}...`;
  render();

  if (historySource) {
    syncNavigationHistory(historySource);
  }

  try {
    const [profile, tracks, releases] = await Promise.all([
      fetchArtistProfile(nextArtist.id, { signal: abortController.signal }),
      fetchArtistTracks(nextArtist.id, { signal: abortController.signal }),
      fetchArtistReleases(nextArtist.id, { signal: abortController.signal })
    ]);

    if (requestId !== activeArtistBrowseRequestId || state.artistBrowse?.id !== nextArtist.id) {
      return;
    }

    state.artistBrowse = {
      ...profile,
      artwork: getArtistArtwork(profile, tracks),
      releases,
      isLoading: false,
      error: ""
    };
    state.searchResults = tracks;
    syncSelectedTrack();
    prefetchPlaybackUrl(getSelectedTrack());
    state.message = tracks.length
      ? `${tracks.length} songs by ${profile.name}`
      : `No songs found for ${profile.name}.`;
    render();
    replaceCurrentNavigationHistoryState();
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    if (requestId !== activeArtistBrowseRequestId || state.artistBrowse?.id !== nextArtist.id) {
      return;
    }

    state.artistBrowse = {
      ...nextArtist,
      releases: [],
      isLoading: false,
      error: error.message
    };
    state.searchResults = [];
    state.message = error.message;
    render();
    replaceCurrentNavigationHistoryState();
  } finally {
    if (activeArtistBrowseAbortController === abortController) {
      activeArtistBrowseAbortController = null;
    }

    if (requestId === activeArtistBrowseRequestId && state.artistBrowse?.id === nextArtist.id) {
      state.isLoading = false;
      render();
      replaceCurrentNavigationHistoryState();
    }
  }
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
  return getVisibleTracks().find((track) => track.key === state.selectedTrackKey)
    || (state.transientPlaybackTrack?.key === state.selectedTrackKey ? state.transientPlaybackTrack : null);
}

function getTrackByKey(trackKey) {
  if (!trackKey) {
    return null;
  }

  const sources = [
    state.searchResults,
    state.libraryTracks,
    ...state.playlists.map((playlist) => playlist.tracks),
    state.playbackManualQueue.map((entry) => entry.track),
    state.playbackContextQueue,
    state.playbackAutoplayQueue.map((entry) => entry.track),
    Array.from(likedTracks.values()),
    state.transientPlaybackTrack ? [state.transientPlaybackTrack] : []
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

function getPlaybackQueueSeed(track) {
  const visibleTracks = getVisibleTracks();
  if (visibleTracks.some((candidate) => candidate.key === track?.key)) {
    return visibleTracks;
  }

  return track ? [track] : [];
}

function seedPlaybackQueues(track, queueTracks, mode = state.playbackQueueMode || "context") {
  const contextQueue = restoreTrackList(queueTracks);
  const fallbackQueue = contextQueue.length ? contextQueue : (track ? [serialiseTrack(track)] : []);
  state.playbackManualQueue = [];
  state.playbackAutoplayQueue = [];
  state.playbackContextQueue = fallbackQueue;
  state.playbackContextIndex = resolveContextIndex(
    state.playbackContextQueue,
    state.playbackContextQueue.findIndex((queueTrack) => queueTrack.key === track?.key),
    track?.key || state.playbackTrackKey
  );
  state.playbackCurrentSource = state.playbackContextQueue.length ? "context" : "standalone";
  state.playbackQueueMode = mode;
  persistPlaybackQueue();
}

function ensurePlaybackQueue(track, { replace = false, queueTracks = null, mode = state.playbackQueueMode || "context" } = {}) {
  if (!track?.key) {
    state.playbackManualQueue = [];
    state.playbackContextQueue = [];
    state.playbackContextIndex = -1;
    state.playbackAutoplayQueue = [];
    state.playbackCurrentSource = "standalone";
    state.playbackQueueMode = "context";
    persistPlaybackQueue();
    return;
  }

  if (Array.isArray(queueTracks)) {
    seedPlaybackQueues(track, queueTracks, mode);
    return;
  }

  if (replace) {
    const queueSeed = mode === "radio" ? [track] : getPlaybackQueueSeed(track);
    seedPlaybackQueues(track, queueSeed, mode);
    return;
  }

  if (
    !state.playbackManualQueue.length
    && !state.playbackContextQueue.length
    && !state.playbackAutoplayQueue.length
  ) {
    const queueSeed = mode === "radio" ? [track] : getPlaybackQueueSeed(track);
    seedPlaybackQueues(track, queueSeed, mode);
  }
}

function ensurePlaybackQueueFromCurrentTrack() {
  if (
    state.playbackManualQueue.length
    || state.playbackContextQueue.length
    || state.playbackAutoplayQueue.length
  ) {
    return getUpcomingQueueEntries();
  }

  const currentTrack = getPlaybackTrack() || getSelectedTrack();
  if (!currentTrack) {
    return [];
  }

  seedPlaybackQueues(currentTrack, getPlaybackQueueSeed(currentTrack), state.playbackQueueMode || "context");
  return getUpcomingQueueEntries();
}

function getPlaybackQueueCursor() {
  if (!state.playbackContextQueue.length) {
    return -1;
  }

  const playbackIndex = state.playbackTrackKey
    ? state.playbackContextQueue.findIndex((track) => track.key === state.playbackTrackKey)
    : -1;

  if (playbackIndex >= 0) {
    state.playbackContextIndex = playbackIndex;
    return playbackIndex;
  }

  state.playbackContextIndex = resolveContextIndex(
    state.playbackContextQueue,
    state.playbackContextIndex,
    state.selectedTrackKey
  );
  return state.playbackContextIndex;
}

function getUpcomingQueueEntries() {
  const contextIndex = getPlaybackQueueCursor();
  const manualEntries = state.playbackManualQueue.map((entry) => ({
    id: entry.id,
    lane: "manual",
    track: entry.track
  }));
  const contextEntries = state.playbackContextQueue
    .slice(contextIndex >= 0 ? contextIndex + 1 : 0)
    .map((track, offset) => ({
      id: `context:${contextIndex >= 0 ? contextIndex + offset + 1 : offset}`,
      lane: "context",
      track,
      contextIndex: contextIndex >= 0 ? contextIndex + offset + 1 : offset
    }));
  const autoplayEntries = state.playbackAutoplayQueue.map((entry) => ({
    id: entry.id,
    lane: "autoplay",
    track: entry.track
  }));

  return [...manualEntries, ...contextEntries, ...autoplayEntries];
}

function getQueueEntryById(queueId) {
  if (!queueId) {
    return null;
  }

  return getUpcomingQueueEntries().find((entry) => entry.id === queueId) || null;
}

function getAdjacentQueueTrack(offset, wrap = false) {
  const upcomingEntries = ensurePlaybackQueueFromCurrentTrack();
  if (!upcomingEntries.length) {
    if (!wrap || !state.playbackContextQueue.length) {
      return null;
    }

    return {
      ...{
        id: "context:0",
        lane: "context",
        track: state.playbackContextQueue[0],
        contextIndex: 0
      }
    };
  }

  if (offset < 0) {
    const previousContextIndex = getPlaybackQueueCursor() - 1;
    if (previousContextIndex < 0) {
      return null;
    }

    return {
      id: `context:${previousContextIndex}`,
      lane: "context",
      track: state.playbackContextQueue[previousContextIndex],
      contextIndex: previousContextIndex
    };
  }

  return upcomingEntries[0];
}

function getRandomQueueTrack() {
  const pool = ensurePlaybackQueueFromCurrentTrack();
  if (!pool.length) {
    return null;
  }

  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function commitQueueState({ message = "", renderApp = true } = {}) {
  persistPlaybackQueue();
  persistPlaybackState();

  if (message) {
    state.message = message;
  }

  if (renderApp) {
    render();
    return;
  }

  renderDetailPanel();
  renderStatus();
}

function areTracksEquivalent(leftTrack, rightTrack) {
  if (!leftTrack || !rightTrack) {
    return false;
  }

  return leftTrack.key === rightTrack.key
    || hasMatchingProviderIds(leftTrack, rightTrack)
    || hasMatchingNormalizedMetadata(leftTrack, rightTrack);
}

function buildAutoplayQueries(track) {
  const artist = String(track?.artist || "").trim();
  const title = String(track?.title || "").trim();
  const album = String(track?.album || "").trim();
  const queries = [
    artist && title ? `${artist} ${title}` : "",
    artist && album ? `${artist} ${album}` : "",
    artist,
    title
  ];

  return Array.from(new Set(queries.filter((query) => query && query.length >= 2)));
}

function scoreAutoplayCandidate(seedTrack, candidate) {
  if (
    !candidate
    || areTracksEquivalent(seedTrack, candidate)
    || areTracksEquivalent(getPlaybackTrack(), candidate)
    || getUpcomingQueueEntries().some((queueEntry) => areTracksEquivalent(queueEntry.track, candidate))
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  const seedArtist = getTrackNormalizedText(seedTrack, "normalizedArtist", "artist");
  const candidateArtist = getTrackNormalizedText(candidate, "normalizedArtist", "artist");
  const seedAlbum = getTrackNormalizedText(seedTrack, "normalizedAlbum", "album");
  const candidateAlbum = getTrackNormalizedText(candidate, "normalizedAlbum", "album");
  const seedTitle = getTrackNormalizedText(seedTrack, "normalizedTitle", "title");
  const candidateTitle = getTrackNormalizedText(candidate, "normalizedTitle", "title");

  if (seedArtist && candidateArtist === seedArtist) {
    score += 60;
  }

  if (seedAlbum && candidateAlbum === seedAlbum) {
    score += 30;
  }

  if (candidate.resultSource === "library") {
    score += 10;
  }

  if (candidate.provider === seedTrack.provider) {
    score += 8;
  }

  if (candidateTitle && candidateTitle !== seedTitle) {
    score += 6;
  }

  const durationDelta = Math.abs(getTrackNormalizedDuration(candidate) - getTrackNormalizedDuration(seedTrack));
  if (durationDelta && durationDelta <= 12) {
    score += 4;
  }

  return score;
}

async function maybeExtendAutoplayQueue(seedTrack = getPlaybackTrack()) {
  if (state.playbackQueueMode !== "radio" || state.queueAutofillInFlight || !seedTrack?.key) {
    return;
  }

  const remainingTracks = getUpcomingQueueEntries().length;
  if (remainingTracks > 2) {
    return;
  }

  const queries = buildAutoplayQueries(seedTrack).slice(0, 3);
  if (!queries.length) {
    return;
  }

  state.queueAutofillInFlight = true;

  try {
    const results = await Promise.all(queries.map((query) => fetchSearchResults(query)));
    const candidates = dedupeTracks(results.flatMap((result) => result.tracks || []))
      .map((candidate) => ({
        candidate,
        score: scoreAutoplayCandidate(seedTrack, candidate)
      }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map((entry) => createQueueEntry(entry.candidate))
      .filter(Boolean);

    if (!candidates.length) {
      return;
    }

    state.playbackAutoplayQueue = [...state.playbackAutoplayQueue, ...candidates];
    persistPlaybackQueue();
    persistPlaybackState();

    if (state.activeDetailTab === "queue") {
      renderDetailPanel();
    }
  } catch {
    // Ignore recommendation fetch failures and leave the queue as-is.
  } finally {
    state.queueAutofillInFlight = false;
  }
}

function addTrackToQueue(track) {
  if (!track?.key) {
    return;
  }

  const nextEntry = createQueueEntry(track);
  if (!nextEntry) {
    return;
  }

  state.playbackManualQueue = [...state.playbackManualQueue, nextEntry];
  if (!state.playbackTrackKey && !state.playbackContextQueue.length) {
    state.playbackQueueMode = "context";
  }
  commitQueueState({
    message: `Queued ${track.title}.`
  });
}

function setExplicitUpcomingQueue(queueEntries) {
  state.playbackManualQueue = queueEntries
    .map((entry) => createQueueEntry(entry.track, entry.lane === "context" ? "" : entry.id))
    .filter(Boolean);
  state.playbackAutoplayQueue = [];

  if (state.playbackContextQueue.length && state.playbackContextIndex >= 0) {
    state.playbackContextQueue = state.playbackContextQueue.slice(0, state.playbackContextIndex + 1);
  } else if (!state.playbackTrackKey) {
    state.playbackContextQueue = [];
    state.playbackContextIndex = -1;
  }
}

function moveQueueItem(queueId, toIndex) {
  if (!queueId || !Number.isInteger(toIndex)) {
    return;
  }

  const upcomingEntries = getUpcomingQueueEntries();
  const fromIndex = upcomingEntries.findIndex((entry) => entry.id === queueId);
  if (fromIndex < 0 || toIndex < 0 || toIndex > upcomingEntries.length) {
    return;
  }

  const nextQueue = [...upcomingEntries];
  const boundedInsertionIndex = Math.max(0, Math.min(toIndex, nextQueue.length));
  const [movedTrack] = nextQueue.splice(fromIndex, 1);
  const adjustedInsertionIndex = fromIndex < boundedInsertionIndex
    ? boundedInsertionIndex - 1
    : boundedInsertionIndex;

  if (adjustedInsertionIndex === fromIndex) {
    return;
  }

  nextQueue.splice(adjustedInsertionIndex, 0, movedTrack);
  setExplicitUpcomingQueue(nextQueue);
  commitQueueState({
    renderApp: false
  });
}

function removeQueueItem(queueId) {
  const entry = getQueueEntryById(queueId);
  if (!entry) {
    return;
  }

  if (entry.lane === "manual") {
    state.playbackManualQueue = state.playbackManualQueue.filter((queueEntry) => queueEntry.id !== entry.id);
  } else if (entry.lane === "autoplay") {
    state.playbackAutoplayQueue = state.playbackAutoplayQueue.filter((queueEntry) => queueEntry.id !== entry.id);
  } else if (entry.lane === "context" && Number.isInteger(entry.contextIndex)) {
    state.playbackContextQueue.splice(entry.contextIndex, 1);
  }

  commitQueueState({
    message: `Removed ${entry.track.title} from the queue.`
  });
}

function consumeQueueEntry(entry) {
  if (!entry?.track) {
    return null;
  }

  if (entry.lane === "manual") {
    state.playbackManualQueue = state.playbackManualQueue.filter((queueEntry) => queueEntry.id !== entry.id);
    state.playbackCurrentSource = "manual";
    return entry.track;
  }

  if (entry.lane === "autoplay") {
    state.playbackAutoplayQueue = state.playbackAutoplayQueue.filter((queueEntry) => queueEntry.id !== entry.id);
    state.playbackCurrentSource = "autoplay";
    return entry.track;
  }

  if (entry.lane === "context" && Number.isInteger(entry.contextIndex)) {
    state.playbackContextIndex = entry.contextIndex;
    state.playbackCurrentSource = "context";
    return entry.track;
  }

  return entry.track;
}

function promoteQueueEntryToCurrent(entry) {
  if (!entry?.track) {
    return null;
  }

  if (entry.lane === "manual") {
    state.playbackManualQueue = state.playbackManualQueue.filter((queueEntry) => queueEntry.id !== entry.id);
    state.playbackCurrentSource = "manual";
    return entry.track;
  }

  if (entry.lane === "autoplay") {
    state.playbackAutoplayQueue = state.playbackAutoplayQueue.filter((queueEntry) => queueEntry.id !== entry.id);
    state.playbackCurrentSource = "autoplay";
    return entry.track;
  }

  if (entry.lane === "context" && Number.isInteger(entry.contextIndex)) {
    state.playbackContextIndex = entry.contextIndex;
    state.playbackCurrentSource = "context";
    return entry.track;
  }

  return entry.track;
}

function createQueueMenu(queueEntry, isCurrent) {
  const wrapper = document.createElement("div");
  wrapper.className = "track-menu-popover queue-menu-popover";
  wrapper.innerHTML = `
    <button class="row-menu-button" type="button" data-action="play">Play now</button>
    ${isCurrent ? "" : '<button class="row-menu-button row-menu-button--danger" type="button" data-action="remove">Remove from queue</button>'}
  `;

  wrapper.querySelector('[data-action="play"]').addEventListener("click", () => {
    closeActiveMenu();
    const track = promoteQueueEntryToCurrent(queueEntry);
    if (!track) {
      return;
    }

    state.selectedTrackKey = track.key;
    void playResolvedTrack(track, {
      select: false,
      preserveQueue: true
    });
  });

  const removeButton = wrapper.querySelector('[data-action="remove"]');
  if (removeButton) {
    removeButton.addEventListener("click", () => {
      closeActiveMenu();
      removeQueueItem(queueEntry.id);
    });
  }

  return wrapper;
}

function renderQueuePanel(panelBody) {
  document.querySelectorAll(".queue-menu-popover--portal").forEach((menu) => menu.remove());
  const currentTrack = getPlaybackTrack();
  const upcomingEntries = state.playbackTrackKey ? ensurePlaybackQueueFromCurrentTrack() : getUpcomingQueueEntries();
  const visibleEntries = [
    ...(currentTrack ? [{
      id: "current",
      lane: "current",
      track: currentTrack
    }] : []),
    ...upcomingEntries
  ];

  if (!visibleEntries.length) {
    panelBody.innerHTML = `
      <div class="queue-panel queue-panel--empty">
        <p class="detail-meta">Queue</p>
        <h3>Nothing queued yet.</h3>
        <p class="detail-description">Start playback from a list or add tracks from the menu to build the queue.</p>
      </div>
    `;
    return;
  }

  panelBody.innerHTML = `
    <div class="queue-panel">
      <div class="queue-header">
        <p class="detail-meta">Queue</p>
        <h3>${visibleEntries.length} song${visibleEntries.length === 1 ? "" : "s"} lined up</h3>
        <p class="detail-description">${state.playbackQueueMode === "radio"
          ? "This queue is in autoplay mode. Apollo will keep trying to append similar tracks as it runs low."
          : "The current song stays separate from upcoming songs. Drag anything below it to set the exact order Apollo will follow next."}</p>
      </div>
      <div class="queue-list" role="list"></div>
    </div>
  `;

  const queueList = panelBody.querySelector(".queue-list");
  const dropPlaceholder = document.createElement("div");
  let activeQueueDropIndex = -1;

  const clearQueueDragState = () => {
    activeQueueDragId = "";
    activeQueueDropIndex = -1;
    queueList.classList.remove("is-drag-active");
    dropPlaceholder.remove();
    queueList.querySelectorAll(".queue-row").forEach((queueRow) => {
      queueRow.classList.remove("is-dragging");
    });
  };

  const getQueueInsertionIndex = (clientY) => {
    const rows = Array.from(queueList.querySelectorAll(".queue-row[data-order-index]"))
      .filter((queueRow) => !queueRow.classList.contains("is-dragging"));

    for (const queueRow of rows) {
      const bounds = queueRow.getBoundingClientRect();
      const queueIndex = Number(queueRow.dataset.orderIndex);
      if (clientY < bounds.top + bounds.height / 2) {
        return queueIndex;
      }
    }

    return upcomingEntries.length;
  };

  const renderDropPlaceholder = (insertionIndex) => {
    if (activeQueueDropIndex === insertionIndex && dropPlaceholder.isConnected) {
      return;
    }

    activeQueueDropIndex = insertionIndex;
    dropPlaceholder.className = "queue-drop-placeholder";
    const draggingRow = queueList.querySelector(".queue-row.is-dragging");
    const placeholderHeight = draggingRow?.getBoundingClientRect().height || 68;
    dropPlaceholder.style.height = `${Math.max(placeholderHeight, 68)}px`;

    const queueRows = Array.from(queueList.querySelectorAll(".queue-row[data-order-index]"))
      .filter((queueRow) => !queueRow.classList.contains("is-dragging"));
    const nextSibling = queueRows.find((queueRow) => Number(queueRow.dataset.orderIndex) >= insertionIndex);

    if (nextSibling) {
      queueList.insertBefore(dropPlaceholder, nextSibling);
      return;
    }

    queueList.append(dropPlaceholder);
  };

  queueList.addEventListener("dragover", (event) => {
    if (!activeQueueDragId) {
      return;
    }

    event.preventDefault();
    renderDropPlaceholder(getQueueInsertionIndex(event.clientY));
  });

  queueList.addEventListener("drop", (event) => {
    if (!activeQueueDragId) {
      return;
    }

    event.preventDefault();
    const insertionIndex = activeQueueDropIndex >= 0 ? activeQueueDropIndex : getQueueInsertionIndex(event.clientY);
    const draggedQueueId = activeQueueDragId;
    clearQueueDragState();
    moveQueueItem(draggedQueueId, insertionIndex);
  });

  queueList.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget || !queueList.contains(event.relatedTarget)) {
      dropPlaceholder.remove();
      activeQueueDropIndex = -1;
    }
  });

  visibleEntries.forEach((queueEntry, visibleIndex) => {
    const row = document.createElement("div");
    const { track } = queueEntry;
    const isCurrent = queueEntry.lane === "current";
    const isSelected = track.key === state.selectedTrackKey;
    const nextRowIndex = currentTrack ? 1 : 0;
    const queueLabel = isCurrent
      ? "Playing"
      : visibleIndex === nextRowIndex
        ? "Next"
        : queueEntry.lane === "manual"
          ? "Queued"
          : queueEntry.lane === "autoplay"
            ? "Autoplay"
            : "From context";

    row.className = `queue-row${isCurrent ? " is-current" : ""}${isSelected ? " is-selected" : ""}`;
    if (!isCurrent) {
      row.dataset.orderIndex = String(visibleIndex - (currentTrack ? 1 : 0));
      row.dataset.queueId = queueEntry.id;
    }
    row.draggable = !isCurrent;
    row.innerHTML = `
      <button class="queue-play" type="button" aria-label="Play ${escapeHtml(track.title)}">
        <span class="queue-play-art">${renderArtwork(track, "queue-play-art-image")}</span>
        <span class="queue-play-overlay">${playGlyphIcon()}</span>
      </button>
      <button class="queue-main" type="button">
        <span class="queue-copy">
          <span class="queue-title-row">
            <span class="queue-title">${escapeHtml(track.title)}</span>
            ${isCurrent ? '<span class="queue-pill">Now</span>' : ""}
          </span>
          <span class="queue-subtitle">${escapeHtml(track.artist)}</span>
        </span>
        <span class="queue-meta">
          <span>${queueLabel}</span>
          <span>${formatDuration(getCachedDuration(track), "--:--")}</span>
        </span>
      </button>
      <div class="queue-actions">
        <button class="queue-remove-button" type="button" data-queue-action="remove" aria-label="Remove from queue" ${isCurrent ? "disabled" : ""}>${closeSmallIcon()}</button>
      </div>
    `;

    row.addEventListener("dragstart", (event) => {
      if (isCurrent) {
        event.preventDefault();
        return;
      }

      if (
        event.target instanceof Element
        && event.target.closest(".queue-remove-button, .track-menu-popover, .queue-menu-popover")
      ) {
        event.preventDefault();
        return;
      }

      activeQueueDragId = queueEntry.id;
      closeActiveMenu();
      row.classList.add("is-dragging");
      queueList.classList.add("is-drag-active");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", queueEntry.id);
      }
    });

    row.addEventListener("dragend", () => {
      clearQueueDragState();
    });

    row.querySelector(".queue-play").addEventListener("click", () => {
      state.selectedTrackKey = track.key;
      closeActiveMenu();
      const nextTrack = promoteQueueEntryToCurrent(queueEntry);
      if (!nextTrack) {
        return;
      }

      void playResolvedTrack(nextTrack, {
        select: false,
        preserveQueue: true
      });
    });

    row.querySelector(".queue-main").addEventListener("click", () => {
      state.selectedTrackKey = track.key;
      closeActiveMenu();
      persistPlaybackState();
      render();
    });

    row.querySelector('[data-queue-action="remove"]').addEventListener("click", (event) => {
      event.stopPropagation();
      closeActiveMenu();
      removeQueueItem(queueEntry.id);
    });

    row.addEventListener("contextmenu", (event) => {
      if (isCurrent) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeActiveMenu();
      state.activeQueueMenuId = queueEntry.id;
      state.activeQueueMenuAnchor = {
        x: event.clientX,
        y: event.clientY
      };
      renderDetailPanel();
    });

    if (!isCurrent && state.activeQueueMenuId === queueEntry.id) {
      const menu = createQueueMenu(queueEntry, isCurrent);
      menu.classList.add("queue-menu-popover--portal");
      document.body.append(menu);
      positionActiveMenu(row, menu, state.activeQueueMenuAnchor);
    }

    queueList.append(row);
  });
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
    providerLabel,
    apollo: createPluginRuntime()
  };
}

function createPluginStateSnapshot() {
  return {
    apiBase: state.apiBase,
    layout: structuredClone(state.layout),
    settings: structuredClone(state.settings),
    auth: { ...state.auth },
    selectedPlaylistId: state.selectedPlaylistId,
    selectedTrackKey: state.selectedTrackKey,
    playbackTrackKey: state.playbackTrackKey,
    activeDetailTab: state.activeDetailTab,
    query: state.query,
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    isBuffering: state.isBuffering,
    isPlaying: state.isPlaying,
    message: state.message,
    repeatMode: state.repeatMode
  };
}

function createPluginPlaybackSnapshot() {
  const track = getPlaybackTrack();
  return {
    track,
    trackKey: state.playbackTrackKey,
    isPlaying: state.isPlaying,
    isBuffering: state.isBuffering,
    currentTime: audioPlayer.currentTime || 0,
    duration: audioPlayer.duration || (track ? getCachedDuration(track) || 0 : 0),
    paused: audioPlayer.paused,
    muted: audioPlayer.muted,
    volume: audioPlayer.volume,
    playbackRate: audioPlayer.playbackRate,
    repeatMode: state.repeatMode
  };
}

function setStatusMessage(message = "") {
  state.message = String(message || "");
  renderStatus();
}

function renderSearchField() {
  const hasQuery = Boolean((searchInput.value || state.query).trim());
  clearSearchButton.hidden = !hasQuery;
}

async function setQuery(query, { run = false, historySource = "", historyReplace = false } = {}) {
  state.query = String(query ?? "").trim();
  searchInput.value = state.query;
  renderSearchField();

  if (run) {
    await runSearch({
      historySource,
      historyReplace
    });
    return;
  }

  if (!state.query) {
    state.searchResults = [];
    clearArtistBrowseState();
    syncSelectedTrack();
  }

  render();

  if (historySource) {
    syncNavigationHistory(historySource, {
      replace: historyReplace
    });
  }
}

async function playTrack(trackOrKey, { autoplay = true } = {}) {
  const track = typeof trackOrKey === "string" ? getTrackByKey(trackOrKey) : trackOrKey;

  if (!track?.key) {
    return null;
  }

  selectTrack(track.key, { autoplay: false });

  if (autoplay) {
    await playResolvedTrack(track, {
      select: false,
      replaceQueue: true
    });
  }

  return track;
}

function setActiveDetailTab(tabId, { persist = true, renderPanel = true } = {}) {
  if (!tabId) {
    return;
  }

  state.activeDetailTab = tabId;

  if (persist) {
    persistPlaybackState();
  }

  if (renderPanel) {
    renderDetailPanel();
  }

  pluginHost?.emit("detail:tab-change", {
    tabId,
    activeTrack: getPlaybackTrack() || getSelectedTrack()
  });
}

function commitPluginChanges(options = {}) {
  const {
    renderApp = true,
    renderStatusOnly = false,
    playback = false,
    settings = false,
    layout = false,
    likes = false,
    auth = false
  } = options;

  if (likes) {
    persistLikedTracks();
  }

  if (auth) {
    persistAuthSession();
  }

  if (playback) {
    persistPlaybackState();
  }

  if (settings) {
    persistSettings();
  }

  if (layout) {
    persistLayout();
  }

  if (renderStatusOnly) {
    renderStatus();
    return;
  }

  if (renderApp) {
    render();
  }
}

function createPluginRuntime() {
  return {
    version: "2",
    window,
    document,
    localStorage,
    sessionStorage,
    desktop: window.apolloDesktop || null,
    state,
    playbackState,
    likedTracks,
    caches: {
      durationCache,
      playbackUrlCache,
      pendingDurationKeys
    },
    dom: {
      workspace,
      sidebarPanel,
      trackPanel,
      detailPanel,
      playlistList,
      trackList,
      searchInput,
      nowPlaying,
      serverStatus,
      audioPlayer
    },
    helpers: {
      escapeHtml,
      formatDuration,
      providerLabel,
      withAccessToken,
      buildTrackKey,
      serialiseTrack,
      normaliseLibraryTrack,
      normaliseRemoteTrack,
      buildPlaybackPayload,
      buildDownloadPayload,
      buildSearchRequestPath,
      dedupeTracks,
      clampNumber,
      clampWidth
    },
    snapshots: {
      getState: createPluginStateSnapshot,
      getPlayback: createPluginPlaybackSnapshot
    },
    queries: {
      getVisibleTracks,
      getSelectedTrack,
      getTrackByKey,
      getPlaybackTrack,
      getPlaybackTrackKey: () => state.playbackTrackKey,
      getPlaylistItems,
      getPlaylists: () => state.playlists,
      getActivePlaylist,
      getEditablePlaylist,
      isTrackLiked,
      isTrackInPlaylist,
      getEnabledProviders,
      getCachedDuration,
      canSaveTrackToApollo,
      getPlugins: () => pluginHost?.getPlugins() || []
    },
    net: {
      getApiBase: () => state.apiBase,
      requestJson,
      fetch: (...args) => fetch(...args),
      withAccessToken,
      getAuthorizationHeader
    },
    ui: {
      render,
      renderStatus,
      renderPlayback,
      renderDetailPanel,
      setStatusMessage,
      setActiveDetailTab,
      togglePanel,
      resetLayout,
      openPlaylistModal,
      closePlaylistModal,
      openSettingsModal,
      closeSettingsModal,
      commit: commitPluginChanges
    },
    search: {
      getQuery: () => state.query,
      setQuery,
      runSearch,
      fetchSearchResults
    },
    library: {
      refreshLibrary,
      fetchAllTracks,
      queueDurationProbe,
      toggleLike,
      downloadTrackToDevice,
      downloadTrackToServer
    },
    playlists: {
      createPlaylist,
      updatePlaylist,
      deletePlaylist,
      uploadPlaylistArtwork,
      deletePlaylistArtwork,
      addTrackToPlaylist,
      removeTrackFromPlaylist
    },
    playback: {
      audioPlayer,
      selectTrack,
      playSelectedTrack,
      playTrack,
      playAdjacent,
      resolvePlaybackUrl,
      waitForPlaybackReady,
      getSnapshot: createPluginPlaybackSnapshot
    },
    auth: {
      getSession: () => ({ ...state.auth }),
      refreshAuthStatus,
      signInWithSecret,
      signOut,
      clearAuthSession,
      persistAuthSession
    },
    events: {
      on: (eventName, handler) => pluginHost?.on(eventName, handler),
      emit: (eventName, payload) => pluginHost?.emit(eventName, payload)
    }
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

function getCachedPlaybackUrl(trackKey) {
  const entry = playbackUrlCache.get(trackKey);
  if (!entry) {
    return "";
  }

  if (typeof entry === "string") {
    return entry;
  }

  if (!entry.url) {
    playbackUrlCache.delete(trackKey);
    return "";
  }

  if (Number.isFinite(entry.expiresAt) && entry.expiresAt <= Date.now()) {
    playbackUrlCache.delete(trackKey);
    return "";
  }

  return entry.url;
}

function cachePlaybackUrl(trackKey, url, ttlMs = PLAYBACK_URL_CACHE_TTL_MS) {
  if (!trackKey || !url) {
    return url;
  }

  playbackUrlCache.set(trackKey, {
    url,
    expiresAt: Number.isFinite(ttlMs)
      ? Date.now() + Math.max(0, ttlMs)
      : Number.POSITIVE_INFINITY
  });
  return url;
}

function prefetchPlaybackUrl(track) {
  if (!track?.key || track.provider === "library") {
    return;
  }

  void resolvePlaybackUrl(track).catch(() => {});
}

function prefetchUpcomingPlayback(track) {
  prefetchPlaybackUrl(track);

  const nextEntry = getAdjacentQueueTrack(1, state.repeatMode === "all");
  if (nextEntry?.track && nextEntry.track.key !== track?.key) {
    prefetchPlaybackUrl(nextEntry.track);
  }
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

function isTrackInPlaylist(playlistId, track) {
  if (!playlistId) {
    return false;
  }

  const resolvedTrackId = resolveTrackLibraryId(track);
  if (!resolvedTrackId) {
    return false;
  }

  const playlist = getEditablePlaylist(playlistId);
  return Boolean(playlist?.tracks.some((entry) => entry.trackId === resolvedTrackId));
}

function getEnabledProviders() {
  return searchProviderOrder.filter((provider) => state.settings.search.providers[provider]);
}

function buildSearchRequestPath(query, scope, provider, pageSize = 24) {
  return `/api/search?query=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}&provider=${encodeURIComponent(provider)}&page=1&pageSize=${pageSize}`;
}

function createSearchRequestOptions(options = {}) {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Client-Id": state.clientId
    }
  };
}

function dedupeTracks(tracks) {
  const unique = new Map();
  tracks.forEach((track) => {
    const existingTrack = unique.get(track.key);
    if (!existingTrack) {
      unique.set(track.key, track);
      return;
    }

    if (isFallbackTrack(existingTrack) && !isFallbackTrack(track)) {
      unique.set(track.key, track);
    }
  });
  return Array.from(unique.values());
}

function canSaveTrackToApollo(track) {
  return Boolean(track && track.resultSource !== "library" && !findLibraryMatch(track));
}

function getDiscordPresenceBridge() {
  return window.apolloDesktop?.discordPresence || null;
}

function getDiscordSocialBridge() {
  return discordSocialBridge;
}

function getDiscordPresenceConfig() {
  return {
    enabled: state.settings.integrations.discord.enabled,
    clientId: state.settings.integrations.discord.clientId,
    largeImageKey: state.settings.integrations.discord.largeImageKey,
    largeImageText: state.settings.integrations.discord.largeImageText,
    smallImageKeyPlaying: state.settings.integrations.discord.smallImageKeyPlaying,
    smallImageKeyPaused: state.settings.integrations.discord.smallImageKeyPaused,
    smallImageKeyBuffering: state.settings.integrations.discord.smallImageKeyBuffering
  };
}

function canInviteCurrentTrackOnDiscord() {
  if (!state.settings.integrations.discord.enabled) {
    return false;
  }

  if (!state.discordSocial.available || !state.discordSocial.authenticated || !state.discordSocial.ready) {
    return false;
  }

  return Boolean(buildDiscordPlaybackPayload()?.joinSecret);
}

function renderDiscordSocialSettings() {
  if (!settingsDiscordSocialStatus) {
    return;
  }

  const showConnect = !state.discordSocial.authenticated && !state.discordSocial.authInProgress;
  const showDisconnect = state.discordSocial.authenticated;

  if (!state.discordSocial.available) {
    settingsDiscordSocialStatus.textContent = "Discord Social SDK is unavailable in this build.";
    settingsDiscordSocialConnect.hidden = true;
    settingsDiscordSocialConnect.style.display = "none";
    settingsDiscordSocialSignout.hidden = true;
    settingsDiscordSocialSignout.style.display = "none";
    return;
  }

  settingsDiscordSocialStatus.textContent = state.discordSocial.message
    || "Discord chat invites require a one-time account connection.";
  settingsDiscordSocialConnect.hidden = !showConnect;
  settingsDiscordSocialConnect.style.display = showConnect ? "" : "none";
  settingsDiscordSocialConnect.disabled = state.discordSocial.authInProgress;
  settingsDiscordSocialConnect.textContent = state.discordSocial.authInProgress
    ? "Authorizing..."
    : "Connect Discord";
  settingsDiscordSocialSignout.hidden = !showDisconnect;
  settingsDiscordSocialSignout.style.display = showDisconnect ? "" : "none";
  settingsDiscordSocialSignout.textContent = "Disconnect Info";
}

function isRemoteDiscordArtworkUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const resolvedUrl = new URL(url, state.apiBase);
    const apiOrigin = new URL(state.apiBase).origin;
    const hostname = resolvedUrl.hostname.toLowerCase();

    if (!["http:", "https:"].includes(resolvedUrl.protocol)) {
      return false;
    }

    if (resolvedUrl.origin === apiOrigin) {
      return false;
    }

    if (["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(hostname)) {
      return false;
    }

    return !resolvedUrl.searchParams.has("access_token");
  } catch {
    return false;
  }
}

function isLocalOrPrivateHostname(hostname) {
  const normalisedHost = String(hostname || "").trim().toLowerCase();
  return LOCAL_DISCORD_HOSTNAMES.has(normalisedHost) || LOCAL_NETWORK_IPV4_PATTERN.test(normalisedHost);
}

function canUsePublicApolloLauncherUrl() {
  try {
    const apiUrl = new URL(state.apiBase);
    return ["http:", "https:"].includes(apiUrl.protocol) && !isLocalOrPrivateHostname(apiUrl.hostname);
  } catch {
    return false;
  }
}

function appendApolloTrackParams(url, track, { includeArtwork = true, includeRemoteSources = true } = {}) {
  url.searchParams.set("provider", track.provider || "remote");
  url.searchParams.set("id", String(track.id || track.trackId || track.key));
  url.searchParams.set("title", track.title || "Unknown Title");
  url.searchParams.set("artist", track.artist || "Unknown Artist");

  if (track.album) {
    url.searchParams.set("album", track.album);
  }

  if (track.trackId) {
    url.searchParams.set("trackId", String(track.trackId));
  }

  if (includeRemoteSources && track.externalUrl) {
    url.searchParams.set("externalUrl", track.externalUrl);
  }

  if (includeRemoteSources && track.downloadTarget) {
    url.searchParams.set("downloadTarget", track.downloadTarget);
  }

  if (includeArtwork && isRemoteDiscordArtworkUrl(track.artwork)) {
    url.searchParams.set("artwork", track.artwork);
  }
}

function appendApolloCompactLibraryParams(url, track) {
  const trackId = getLibraryTrackId(track);
  if (!trackId) {
    return false;
  }

  url.searchParams.set("trackId", trackId);
  return true;
}

function buildApolloLauncherUrl(targetUrl) {
  if (!targetUrl) {
    return "";
  }

  try {
    const launcherUrl = new URL("/open-apollo", state.apiBase);
    launcherUrl.searchParams.set("target", targetUrl);
    const serialised = launcherUrl.toString();
    return serialised.length <= 256 ? serialised : "";
  } catch {
    return "";
  }
}

function buildApolloTrackLink(track) {
  if (!track) {
    return "";
  }

  const url = new URL(`apollo://${APOLLO_DEEP_LINK_ROUTE_PLAY}`);
  const libraryTrackId = getLibraryTrackId(track);
  if (libraryTrackId) {
    appendApolloCompactLibraryParams(url, track);
  } else {
    appendApolloTrackParams(url, track);
  }
  const deepLinkUrl = url.toString();
  if (libraryTrackId && canUsePublicApolloLauncherUrl()) {
    return buildApolloLauncherUrl(deepLinkUrl);
  }
  return "";
}

function generateListenAlongSessionId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `apollo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getLibraryTrackId(track) {
  return String(track?.trackId || (track?.resultSource === "library" ? track?.id : "") || resolveTrackLibraryId(track) || "").trim();
}

function resetPublishedListenAlongSession() {
  listenAlongState.publishedSessionId = "";
  listenAlongState.publishedTrackId = "";
}

function buildApolloListenAlongLink(sessionId) {
  if (!sessionId) {
    return "";
  }

  const url = new URL(`apollo://${APOLLO_DEEP_LINK_ROUTE_LISTEN}`);
  url.searchParams.set("session", sessionId);
  const compactUrl = url.toString();
  return compactUrl.length <= 128 ? compactUrl : "";
}

function stopJoinedListenAlongSession() {
  if (listenAlongState.pollHandle) {
    window.clearInterval(listenAlongState.pollHandle);
    listenAlongState.pollHandle = 0;
  }

  listenAlongState.joinedSessionId = "";
  listenAlongState.joinedTrackId = "";
  listenAlongState.pollInFlight = false;
}

function leaveJoinedListenAlongSession() {
  if (!listenAlongState.joinedSessionId) {
    return false;
  }

  stopJoinedListenAlongSession();
  state.message = "Left listen along.";
  renderStatus();
  renderNowPlaying();
  syncDiscordPresence();
  return true;
}

function getActiveListenAlongSessionId(track) {
  const trackId = getLibraryTrackId(track);
  if (!trackId) {
    return "";
  }

  if (listenAlongState.joinedSessionId && listenAlongState.joinedTrackId === trackId) {
    return listenAlongState.joinedSessionId;
  }

  if (!listenAlongState.publishedSessionId) {
    listenAlongState.publishedSessionId = generateListenAlongSessionId();
  }

  listenAlongState.publishedTrackId = trackId;
  return listenAlongState.publishedSessionId;
}

async function fetchListenAlongSession(sessionId) {
  return requestJson(`/api/listen-sessions/${encodeURIComponent(sessionId)}`);
}

async function publishListenAlongSession(track, payload, sessionId) {
  if (!sessionId || listenAlongState.joinedSessionId) {
    return;
  }

  const trackId = getLibraryTrackId(track);
  if (!trackId) {
    return;
  }

  await requestJson(`/api/listen-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({
      trackId,
      status: payload.status,
      positionSeconds: payload.currentTime || 0,
      durationSeconds: payload.duration || 0,
      playbackRate: payload.playbackRate || 1,
      capturedAt: Date.now()
    })
  });
}

async function clearPublishedListenAlongSession() {
  const sessionId = listenAlongState.publishedSessionId;
  resetPublishedListenAlongSession();
  if (!sessionId) {
    return;
  }

  try {
    await requestJson(`/api/listen-sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
  } catch {
    // Ignore cleanup failures. Sessions expire server-side.
  }
}

function unwrapApolloDeepLink(url) {
  try {
    const parsedUrl = new URL(url);
    const routePath = `${parsedUrl.hostname}${parsedUrl.pathname}`;
    if (!routePath.includes("_discord/join")) {
      return url;
    }

    const secret = parsedUrl.searchParams.get("secret") || "";
    return secret.startsWith("apollo://") ? secret : url;
  } catch {
    return url;
  }
}

function parseApolloLink(url) {
  try {
    const parsedUrl = new URL(unwrapApolloDeepLink(url));
    if (parsedUrl.protocol !== "apollo:") {
      return null;
    }

    const route = parsedUrl.hostname || parsedUrl.pathname.replace(/^\//, "");
    if (![APOLLO_DEEP_LINK_ROUTE_PLAY, APOLLO_DEEP_LINK_ROUTE_LISTEN].includes(route)) {
      return null;
    }

    const sessionId = parsedUrl.searchParams.get("session") || "";
    const trackIdParam = parsedUrl.searchParams.get("trackId") || parsedUrl.searchParams.get("id");
    const provider = parsedUrl.searchParams.get("provider") || (trackIdParam ? "library" : "remote");
    const title = parsedUrl.searchParams.get("title") || "Unknown Title";
    const artist = parsedUrl.searchParams.get("artist") || "Unknown Artist";
    const album = parsedUrl.searchParams.get("album") || "";
    const artwork = parsedUrl.searchParams.get("artwork") || "";

    if (route === APOLLO_DEEP_LINK_ROUTE_LISTEN && sessionId && !trackIdParam) {
      return {
        route,
        sessionId,
        track: null,
        playback: null
      };
    }

    if (provider === "library") {
      const trackId = trackIdParam;
      if (!trackId) {
        return null;
      }

      return {
        route,
        sessionId,
        track: normaliseLibraryTrack({
          id: trackId,
          trackId,
          title,
          artist,
          album,
          artwork
        }),
        playback: route === APOLLO_DEEP_LINK_ROUTE_LISTEN
          ? {
              status: parsedUrl.searchParams.get("status") === "playing" ? "playing" : "paused",
              positionSeconds: Math.max(0, Number(parsedUrl.searchParams.get("positionMs") || 0) / 1000),
              capturedAt: Math.max(0, Number(parsedUrl.searchParams.get("capturedAt") || 0)),
              playbackRate: clampNumber(parsedUrl.searchParams.get("playbackRate"), 0.25, 4, 1)
            }
          : null
      };
    }

    return {
      route,
      sessionId,
      track: normaliseRemoteTrack({
        id: parsedUrl.searchParams.get("id") || `${provider}:${title}:${artist}`,
        provider,
        title,
        artist,
        album,
        artwork,
        externalUrl: parsedUrl.searchParams.get("externalUrl") || "",
        downloadTarget: parsedUrl.searchParams.get("downloadTarget") || parsedUrl.searchParams.get("externalUrl") || ""
      }),
      playback: null
    };
  } catch {
    return null;
  }
}

function getListenAlongStartTime(playback) {
  if (!playback) {
    return 0;
  }

  const basePosition = Math.max(0, Number(playback.positionSeconds) || 0);
  if (playback.status !== "playing") {
    return basePosition;
  }

  const capturedAt = Math.max(0, Number(playback.capturedAt) || 0);
  if (!capturedAt) {
    return basePosition;
  }

  const elapsedSeconds = Math.max(0, (Date.now() - capturedAt) / 1000);
  return basePosition + elapsedSeconds * clampNumber(playback.playbackRate, 0.25, 4, 1);
}

async function applyListenAlongSessionSnapshot(session, { initial = false } = {}) {
  const sessionTrackId = getLibraryTrackId(session);
  if (!sessionTrackId) {
    return false;
  }

  const track = normaliseLibraryTrack({
    id: sessionTrackId,
    trackId: sessionTrackId,
    title: session.title || "Unknown Title",
    artist: session.artist || "Unknown Artist",
    album: session.album || "",
    artwork: session.artwork || ""
  });
  const currentTrack = getPlaybackTrack();
  const currentTrackId = getLibraryTrackId(currentTrack);
  const needsTrackChange = currentTrackId !== sessionTrackId;

  if (needsTrackChange) {
    const didStartPlayback = await playResolvedTrack(track, {
      queueTracks: [track],
      preserveListenAlong: true
    });
    if (!didStartPlayback) {
      return false;
    }
  }

  const playback = {
    status: session.status === "playing" ? "playing" : "paused",
    positionSeconds: Math.max(0, Number(session.positionSeconds) || 0),
    capturedAt: Math.max(0, Number(session.capturedAt) || 0),
    playbackRate: clampNumber(session.playbackRate, 0.25, 4, 1)
  };
  const duration = audioPlayer.duration || getCachedDuration(track) || Number(session.durationSeconds) || Number.MAX_SAFE_INTEGER;
  const targetTime = clampNumber(getListenAlongStartTime(playback), 0, duration, 0);
  const driftSeconds = Math.abs((audioPlayer.currentTime || 0) - targetTime);
  if (needsTrackChange || driftSeconds > DISCORD_LISTEN_SESSION_RESYNC_THRESHOLD_SECONDS) {
    audioPlayer.currentTime = targetTime;
  }

  if (playback.status === "playing") {
    try {
      await audioPlayer.play();
    } catch {
      // Ignore autoplay/promise failures and keep the joined session active.
    }
  } else {
    audioPlayer.pause();
  }

  listenAlongState.joinedTrackId = sessionTrackId;

  if (initial) {
    state.message = playback.status === "playing"
      ? `Joined ${track.title} at ${formatDuration(targetTime)}.`
      : `Opened ${track.title} from Discord.`;
    render();
  }

  return true;
}

async function refreshJoinedListenAlongSession() {
  if (!listenAlongState.joinedSessionId || listenAlongState.pollInFlight) {
    return;
  }

  listenAlongState.pollInFlight = true;

  try {
    const session = await fetchListenAlongSession(listenAlongState.joinedSessionId);
    if (!session?.trackId) {
      stopJoinedListenAlongSession();
      return;
    }

    await applyListenAlongSessionSnapshot(session);
  } catch (error) {
    if (/404/i.test(String(error?.message || ""))) {
      stopJoinedListenAlongSession();
      state.message = "The listen along session ended.";
      renderStatus();
    }
  } finally {
    listenAlongState.pollInFlight = false;
  }
}

function startJoinedListenAlongPolling(sessionId) {
  stopJoinedListenAlongSession();
  listenAlongState.joinedSessionId = sessionId;
  listenAlongState.pollHandle = window.setInterval(() => {
    void refreshJoinedListenAlongSession();
  }, DISCORD_LISTEN_SESSION_POLL_MS);
}

async function joinApolloListenAlong(track, playback, sessionId = "") {
  await clearPublishedListenAlongSession();

  if (sessionId) {
    const session = await fetchListenAlongSession(sessionId);
    const joined = await applyListenAlongSessionSnapshot(session, { initial: true });
    if (joined) {
      startJoinedListenAlongPolling(sessionId);
    }
    return;
  }

  const didStartPlayback = await playResolvedTrack(track, {
    queueTracks: [track],
    preserveListenAlong: true
  });
  if (!didStartPlayback) {
    return;
  }

  const duration = audioPlayer.duration || getCachedDuration(track) || Number.MAX_SAFE_INTEGER;
  const targetTime = clampNumber(getListenAlongStartTime(playback), 0, duration, 0);
  audioPlayer.currentTime = targetTime;

  if (playback?.status !== "playing") {
    audioPlayer.pause();
  }

  state.message = playback?.status === "playing"
    ? `Joined ${track.title} at ${formatDuration(targetTime)}.`
    : `Opened ${track.title} from Discord.`;
  render();
}

async function handleApolloDeepLink(url) {
  const action = parseApolloLink(url);
  if (!action) {
    return;
  }

  if (action.route === APOLLO_DEEP_LINK_ROUTE_LISTEN) {
    await joinApolloListenAlong(action.track, action.playback, action.sessionId || "");
    return;
  }

  if (!action.track) {
    return;
  }

  await playResolvedTrack(action.track, {
    queueTracks: [action.track]
  });
}

function buildDiscordPlaybackPayload() {
  const currentTrack = getPlaybackTrack();
  if (!currentTrack) {
    return null;
  }

  const libraryTrack = findLibraryMatch(currentTrack);
  const libraryTrackId = getLibraryTrackId(currentTrack);
  const artworkTrack = libraryTrack || currentTrack;
  const artworkUrl = isRemoteDiscordArtworkUrl(artworkTrack.artwork)
    ? artworkTrack.artwork
    : isRemoteDiscordArtworkUrl(currentTrack.artwork)
      ? currentTrack.artwork
      : "";

  const resolvedDuration = audioPlayer.duration || getCachedDuration(currentTrack) || 0;
  const status = state.isPlaying && !audioPlayer.paused
      ? "playing"
      : "paused";

  const payload = {
    title: currentTrack.title,
    artist: currentTrack.artist,
    album: currentTrack.album,
    provider: libraryTrackId
      ? "Local file"
      : providerLabel(currentTrack.provider, currentTrack.requestedProvider),
    artworkUrl,
    buttonUrl: buildApolloTrackLink(currentTrack),
    status,
    currentTime: audioPlayer.currentTime || 0,
    duration: resolvedDuration,
    playbackRate: audioPlayer.playbackRate || 1
  };

  if (libraryTrackId) {
    const sessionId = getActiveListenAlongSessionId(currentTrack);
    const joinSecret = buildApolloListenAlongLink(sessionId);
    if (joinSecret) {
      payload.partyId = `apollo-session:${sessionId}`;
      payload.partySize = 1;
      payload.partyMax = DISCORD_LISTEN_ALONG_PARTY_MAX;
      payload.joinSecret = joinSecret;
      payload.listenSessionId = sessionId;
    }
  }

  return payload;
}

async function syncDiscordPresenceConfig() {
  const bridge = getDiscordPresenceBridge();
  if (!bridge?.available) {
    return;
  }

  try {
    await bridge.configure(getDiscordPresenceConfig());
  } catch {
    // Ignore desktop bridge failures so playback continues normally.
  }
}

function syncDiscordPresence() {
  const bridge = getDiscordPresenceBridge();
  if (!bridge?.available) {
    return;
  }

  if (!state.settings.integrations.discord.enabled) {
    void clearPublishedListenAlongSession();
    bridge.clear();
    return;
  }

  const payload = buildDiscordPlaybackPayload();
  if (!payload) {
    void clearPublishedListenAlongSession();
    bridge.clear();
    return;
  }

  if (payload.listenSessionId && getLibraryTrackId(getPlaybackTrack()) && !listenAlongState.joinedSessionId) {
    void publishListenAlongSession(getPlaybackTrack(), payload, payload.listenSessionId);
  } else if (!listenAlongState.joinedSessionId) {
    void clearPublishedListenAlongSession();
  }

  bridge.updatePlayback(payload);
}

function applySettings() {
  state.apiBase = buildApiBase(state.settings.connection);
  audioPlayer.preload = state.settings.audio.preloadMode;
  audioPlayer.volume = state.settings.audio.volume;
  audioPlayer.muted = state.settings.audio.muted;
  audioPlayer.playbackRate = state.settings.playback.playbackRate;
  volumeSlider.value = String(state.settings.audio.volume);
  volumeSlider.step = String(state.settings.audio.volumeStep);
  syncRangeVisuals();
  void syncDiscordPresenceConfig();
  syncDiscordPresence();
}

function populateSettingsForm() {
  settingsServerProtocol.value = state.settings.connection.protocol;
  settingsServerHostname.value = state.settings.connection.hostname;
  settingsServerPort.value = state.settings.connection.port;
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
  settingsProviderDeezer.checked = state.settings.search.providers.deezer;
  settingsProviderYoutube.checked = state.settings.search.providers.youtube;
  settingsProviderSpotify.checked = state.settings.search.providers.spotify;
  settingsProviderSoundcloud.checked = state.settings.search.providers.soundcloud;
  settingsProviderItunes.checked = state.settings.search.providers.itunes;
  settingsSearchDelay.value = String(state.settings.search.liveSearchDelayMs);
  settingsAutoRefreshLibrary.checked = state.settings.downloads.autoRefreshLibrary;
  settingsDiscordEnabled.checked = state.settings.integrations.discord.enabled;
  settingsFormMessage.textContent = "";
  syncRangeVisuals();
  renderDiscordSocialSettings();
}

function saveCurrentSettingsForm() {
  const providers = {
    deezer: settingsProviderDeezer.checked,
    youtube: settingsProviderYoutube.checked,
    spotify: settingsProviderSpotify.checked,
    soundcloud: settingsProviderSoundcloud.checked,
    itunes: settingsProviderItunes.checked
  };

  if (!Object.values(providers).some(Boolean)) {
    providers.youtube = true;
  }

  return mergeSettings(DEFAULT_SETTINGS, {
    connection: normaliseConnectionSettings({
      protocol: settingsServerProtocol.value,
      hostname: settingsServerHostname.value,
      port: settingsServerPort.value
    }),
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
    },
    integrations: {
      discord: {
        enabled: settingsDiscordEnabled.checked,
        clientId: state.settings.integrations.discord.clientId,
        largeImageKey: state.settings.integrations.discord.largeImageKey,
        largeImageText: state.settings.integrations.discord.largeImageText,
        smallImageKeyPlaying: state.settings.integrations.discord.smallImageKeyPlaying,
        smallImageKeyPaused: state.settings.integrations.discord.smallImageKeyPaused,
        smallImageKeyBuffering: state.settings.integrations.discord.smallImageKeyBuffering
      }
    }
  });
}

function openSettingsModal() {
  state.settingsModalOpen = true;
  populateSettingsForm();
  settingsModal.classList.add("is-open");
  settingsModal.setAttribute("aria-hidden", "false");
  setTimeout(() => settingsServerHostname.focus(), 0);
}

function closeSettingsModal() {
  state.settingsModalOpen = false;
  settingsModal.classList.remove("is-open");
  settingsModal.setAttribute("aria-hidden", "true");
}

async function retryApolloConnection() {
  state.message = `Retrying ${state.apiBase}...`;
  renderStatus();
  await initialiseApolloClient();
}

function renderDiscordInviteModal() {
  if (!discordInviteFriends) {
    return;
  }

  discordInviteMessageInput.value = state.discordInvite.message;
  discordInviteFormMessage.textContent = state.discordInvite.formMessage;
  discordInviteSubmit.disabled = state.discordInvite.isSending || !state.discordInvite.selectedFriendId;
  discordInviteSubmit.textContent = state.discordInvite.isSending ? "Sending..." : "Send invite";

  if (state.discordInvite.isLoading) {
    discordInviteFriends.innerHTML = '<p class="discord-friend-empty">Loading Discord friends...</p>';
    return;
  }

  if (!state.discordInvite.friends.length) {
    discordInviteFriends.innerHTML = '<p class="discord-friend-empty">No Discord friends are available for invites right now.</p>';
    return;
  }

  discordInviteFriends.innerHTML = state.discordInvite.friends.map((friend) => `
    <label class="discord-friend-row${friend.id === state.discordInvite.selectedFriendId ? " is-selected" : ""}">
      <input
        type="radio"
        name="discord-invite-friend"
        value="${escapeHtml(friend.id)}"
        ${friend.id === state.discordInvite.selectedFriendId ? "checked" : ""}
      >
      <span class="discord-friend-copy">
        <strong>${escapeHtml(friend.displayName || friend.username)}</strong>
        <small>${escapeHtml(friend.status || "unknown")}${friend.playingApollo ? " | already on Apollo" : ""}</small>
      </span>
    </label>
  `).join("");

  discordInviteFriends.querySelectorAll('input[name="discord-invite-friend"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.discordInvite.selectedFriendId = input.value;
      renderDiscordInviteModal();
    });
  });
}

async function openDiscordInviteModal() {
  if (!canInviteCurrentTrackOnDiscord()) {
    state.message = "Discord invite requires a connected Discord account and a joinable track.";
    renderStatus();
    return;
  }

  state.discordInvite = createDiscordInviteState({
    isOpen: true,
    isLoading: true,
    message: state.discordInvite.message || "Listen along on Apollo"
  });
  discordInviteModal.classList.add("is-open");
  discordInviteModal.setAttribute("aria-hidden", "false");
  renderDiscordInviteModal();

  try {
    const friends = await getDiscordSocialBridge()?.listFriends?.();
    const availableFriends = Array.isArray(friends) ? friends : [];
    state.discordInvite.friends = availableFriends;
    state.discordInvite.selectedFriendId = availableFriends[0]?.id || "";
    state.discordInvite.isLoading = false;
    renderDiscordInviteModal();
  } catch (error) {
    state.discordInvite.isLoading = false;
    state.discordInvite.formMessage = error?.message || "Unable to load Discord friends.";
    renderDiscordInviteModal();
  }
}

function closeDiscordInviteModal() {
  state.discordInvite = createDiscordInviteState();
  discordInviteModal.classList.remove("is-open");
  discordInviteModal.setAttribute("aria-hidden", "true");
}

function applyDiscordSocialState(nextState = {}) {
  state.discordSocial = {
    ...state.discordSocial,
    ...nextState
  };

  if (!state.discordSocial.authenticated && state.discordInvite.isOpen) {
    closeDiscordInviteModal();
  } else if (state.discordInvite.isOpen) {
    renderDiscordInviteModal();
  }

  renderDiscordSocialSettings();
  renderNowPlaying();
}

function saveVolumeSetting() {
  state.settings.audio.volume = audioPlayer.volume;
  state.settings.audio.muted = audioPlayer.muted;
  persistSettings();
}

function closeActiveMenu() {
  state.activeMenuTrackKey = null;
  state.activeMenuAnchor = null;
  state.activePlaylistMenuId = null;
  state.activePlaylistMenuAnchor = null;
  state.activeQueueMenuId = "";
  state.activeQueueMenuAnchor = null;
  document.querySelectorAll(".track-menu-popover--portal").forEach((menu) => menu.remove());
  document.querySelectorAll(".playlist-menu-popover--portal").forEach((menu) => menu.remove());
  document.querySelectorAll(".queue-menu-popover--portal").forEach((menu) => menu.remove());
}

function hasActiveMenu() {
  return Boolean(state.activeMenuTrackKey || state.activePlaylistMenuId || state.activeQueueMenuId);
}

function selectTrack(trackKey, { autoplay = false } = {}) {
  state.selectedTrackKey = trackKey;
  closeActiveMenu();
  persistPlaybackState();
  render();
  const selectedTrack = getSelectedTrack();
  pluginHost?.emit("selection:changed", {
    track: selectedTrack,
    autoplay
  });

  prefetchPlaybackUrl(selectedTrack);

  if (autoplay) {
    void playSelectedTrack();
  }
}

async function refreshLibrary() {
  state.isLoading = true;
  state.message = "Loading library...";
  render();
  pluginHost?.emit("library:refresh:start", {
    query: state.query
  });

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
    searchResultCache.clear();
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

    pluginHost?.emit("library:refresh:success", {
      tracks: state.libraryTracks,
      playlists: state.playlists
    });
  } catch (error) {
    state.isConnected = false;
    if (error.code === "AUTH_REQUIRED") {
      state.message = error.message;
    } else if (isConnectionError(error)) {
      clearApolloData();
      state.message = error.message;
    } else {
      clearApolloData();
      state.message = `Apollo unavailable at ${state.apiBase}. ${error.message}`;
    }

    pluginHost?.emit("library:refresh:error", {
      error
    });
  } finally {
    state.isLoading = false;
    render();
    syncDiscordPresence();
  }
}

async function runSearch({ historySource = "", historyReplace = false } = {}) {
  const query = String(state.query || "").trim();
  const requestId = ++activeSearchRequestId;
  abortPendingSearchRequest();
  abortPendingArtistBrowseRequest();
  state.artistBrowse = null;

  if (!query) {
    state.searchResults = [];
    state.artistSearchResults = [];
    state.message = state.isConnected ? "" : state.message;
    syncSelectedTrack();
    render();

    if (historySource) {
      syncNavigationHistory(historySource, {
        replace: historyReplace
      });
    } else {
      replaceCurrentNavigationHistoryState();
    }

    pluginHost?.emit("search:cleared", {});
    return;
  }

  const localTracks = getLocalSearchResults(query);
  const searchWarnings = [];
  let artistResults = [];
  let remoteResults = [];
  let remotePending = getEnabledProviders().length > 0;
  let searchError = null;

  const publishSearchProgress = () => {
    if (!isSearchRequestCurrent(requestId, query)) {
      return;
    }

    state.searchResults = dedupeTracks([...localTracks, ...remoteResults]);
    state.artistSearchResults = artistResults;
    state.message = buildSearchStatusMessage({
      artistCount: artistResults.length,
      libraryCount: localTracks.length,
      remoteCount: remoteResults.length,
      warnings: searchWarnings,
      remotePending
    });
    syncSelectedTrack();
    prefetchPlaybackUrl(getSelectedTrack());
    render();
    replaceCurrentNavigationHistoryState();
  };

  const abortController = new AbortController();
  activeSearchAbortController = abortController;
  state.isLoading = true;
  state.searchResults = localTracks;
  state.artistSearchResults = [];
  state.message = buildSearchStatusMessage({
    artistCount: 0,
    libraryCount: localTracks.length,
    remoteCount: 0,
    remotePending
  });
  syncSelectedTrack();
  prefetchPlaybackUrl(getSelectedTrack());
  render();

  if (historySource) {
    syncNavigationHistory(historySource, {
      replace: historyReplace
    });
  } else {
    replaceCurrentNavigationHistoryState();
  }

  pluginHost?.emit("search:start", {
    query
  });

  try {
    const artistTask = fetchArtistSearchResults(query, { signal: abortController.signal })
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

    const remoteTask = fetchRemoteSearchResults(query, { signal: abortController.signal })
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

    await Promise.all([artistTask, remoteTask]);
  } catch (error) {
    if (isAbortError(error) || !isSearchRequestCurrent(requestId, query)) {
      return;
    }

    searchError = error;
    if (!searchWarnings.includes(error.message)) {
      searchWarnings.push(error.message);
    }
    publishSearchProgress();
    pluginHost?.emit("search:error", {
      query,
      error
    });
  } finally {
    if (activeSearchAbortController === abortController) {
      activeSearchAbortController = null;
    }

    if (!isSearchRequestCurrent(requestId, query)) {
      return;
    }

    state.isLoading = false;
    publishSearchProgress();
    if (!searchError) {
      pluginHost?.emit("search:success", {
        query,
        tracks: state.searchResults,
        warnings: [...searchWarnings]
      });
    }
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
  pluginHost?.emit("library:like-changed", {
    track,
    liked: likedTracks.has(track.key)
  });
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
    ? "Current artwork remains until it is replaced or removed."
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

function renderTrackDeleteModal() {
  const track = state.trackDeleteModal.track;
  trackDeleteCopy.textContent = track
    ? `Delete "${track.title}" by ${track.artist} from Apollo?`
    : "Delete this track from Apollo?";
  trackDeleteMessage.textContent = state.trackDeleteModal.message
    || "This removes the saved file from the Apollo server library.";
  trackDeleteCancel.disabled = state.trackDeleteModal.isDeleting;
  trackDeleteConfirm.disabled = state.trackDeleteModal.isDeleting;
  trackDeleteConfirm.textContent = state.trackDeleteModal.isDeleting ? "Deleting..." : "Delete";
}

function openTrackDeleteModal(track) {
  state.trackDeleteModal = createTrackDeleteModalState({
    isOpen: true,
    track: serialiseTrack(track)
  });
  trackDeleteModal.classList.add("is-open");
  trackDeleteModal.setAttribute("aria-hidden", "false");
  renderTrackDeleteModal();
  setTimeout(() => trackDeleteConfirm.focus(), 0);
}

function closeTrackDeleteModal() {
  state.trackDeleteModal = createTrackDeleteModalState();
  trackDeleteModal.classList.remove("is-open");
  trackDeleteModal.setAttribute("aria-hidden", "true");
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
    ? "Current artwork remains until it is replaced or removed."
    : "No artwork selected.";
}

async function addTrackToPlaylist(playlistId, track) {
  const resolvedTrackId = resolveTrackLibraryId(track);
  if (!resolvedTrackId) {
    state.message = "Only library tracks can be added to playlists right now.";
    render();
    return;
  }

  await requestJson(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ trackId: resolvedTrackId })
  });

  await refreshLibrary();
  state.message = "Added to playlist.";
  render();
}

async function removeTrackFromPlaylist(playlistId, track) {
  const resolvedTrackId = resolveTrackLibraryId(track);
  if (!resolvedTrackId) {
    return;
  }

  await requestJson(`/api/playlists/${playlistId}/tracks/${resolvedTrackId}`, {
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
    state.message = "This song is already in the Apollo library.";
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

function removeLikedEntriesForTrack(trackId) {
  if (!trackId) {
    return false;
  }

  let removed = false;

  likedTracks.forEach((likedTrack, likedKey) => {
    if ((likedTrack?.trackId || "") === trackId) {
      likedTracks.delete(likedKey);
      removed = true;
    }
  });

  if (removed) {
    persistLikedTracks();
  }

  return removed;
}

async function deleteTrackFromApollo(track, { closeModal = false } = {}) {
  const resolvedTrackId = resolveTrackLibraryId(track);
  if (!resolvedTrackId) {
    state.message = "This song is not saved in Apollo.";
    renderStatus();
    return;
  }

  const libraryTrack = findLibraryMatch(track);
  const playbackTrack = getPlaybackTrack();
  const isDeletingPlaybackTrack = Boolean(
    playbackTrack &&
    playbackTrack.provider === "library" &&
    resolveTrackLibraryId(playbackTrack) === resolvedTrackId
  );

  if (state.trackDeleteModal.isOpen) {
    state.trackDeleteModal.isDeleting = true;
    state.trackDeleteModal.message = "";
    renderTrackDeleteModal();
  }

  try {
    await requestJson(`/api/tracks/${encodeURIComponent(resolvedTrackId)}`, {
      method: "DELETE"
    });

    if (isDeletingPlaybackTrack) {
      audioPlayer.pause();
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
      state.playbackTrackKey = null;
      state.transientPlaybackTrack = null;
      state.isPlaying = false;
      state.isBuffering = false;
    }

    if (libraryTrack?.key) {
      durationCache.delete(libraryTrack.key);
      playbackUrlCache.delete(libraryTrack.key);
      pendingPlaybackUrlCache.delete(libraryTrack.key);
      pendingDurationKeys.delete(libraryTrack.key);
    }

    removeLikedEntriesForTrack(resolvedTrackId);
    state.searchResults = state.searchResults.filter(
      (item) => !(item.provider === "library" && (item.trackId === resolvedTrackId || item.id === resolvedTrackId))
    );

    await refreshLibrary();
    syncSelectedTrack();
    persistPlaybackState();

    if (closeModal) {
      closeTrackDeleteModal();
    }

    state.message = `Deleted ${track.title} from Apollo.`;
    render();
  } catch (error) {
    if (state.trackDeleteModal.isOpen) {
      state.trackDeleteModal.isDeleting = false;
      state.trackDeleteModal.message = error.message;
      renderTrackDeleteModal();
      return;
    }

    state.message = error.message;
    renderStatus();
  }
}

function renderPlaylists() {
  const items = getPlaylistItems();
  document.querySelectorAll(".playlist-menu-popover--portal").forEach((menu) => menu.remove());
  playlistList.innerHTML = "";

  items.forEach((playlist) => {
    const playlistRecord = state.playlists.find((entry) => entry.id === playlist.id);
    const artworkMarkup = playlistRecord?.artworkUrl
      ? `<img class="item-art-image" src="${escapeHtml(withAccessToken(playlistRecord.artworkUrl))}" alt="">`
      : noteIcon();
    const isEditable = Boolean(playlistRecord);
    const row = document.createElement("div");
    row.className = `library-item${playlist.id === state.selectedPlaylistId && !state.query ? " is-active" : ""}`;
    row.innerHTML = `
      <button class="library-item-main" type="button">
        <span class="item-art">${artworkMarkup}</span>
        <span class="item-copy">
          <p class="item-title">${escapeHtml(playlist.name)}</p>
          <p class="item-subtitle">${escapeHtml(playlist.detail)}</p>
        </span>
      </button>
      ${
        isEditable
          ? `<button class="library-item-menu" type="button" aria-label="Playlist actions">${dotsIcon()}</button>`
          : '<span class="library-item-menu-spacer" aria-hidden="true"></span>'
      }
    `;

    row.querySelector(".library-item-main").addEventListener("click", () => {
      openPlaylistView(playlist.id, {
        historySource: "playlist"
      });
    });

    if (isEditable) {
      const menuButton = row.querySelector(".library-item-menu");
      menuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const rect = menuButton.getBoundingClientRect();
        const shouldOpen = state.activePlaylistMenuId !== playlist.id;
        closeActiveMenu();
        state.activePlaylistMenuId = shouldOpen ? playlist.id : null;
        state.activePlaylistMenuAnchor = shouldOpen
          ? {
              x: rect.right,
              y: rect.bottom
            }
          : null;
        renderPlaylists();
      });

      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeActiveMenu();
        state.activePlaylistMenuId = playlist.id;
        state.activePlaylistMenuAnchor = {
          x: event.clientX,
          y: event.clientY
        };
        renderPlaylists();
      });

      if (state.activePlaylistMenuId === playlist.id) {
        const menu = createPlaylistMenu(playlistRecord);
        menu.classList.add("playlist-menu-popover--portal");
        document.body.append(menu);
        positionActiveMenu(row, menu, state.activePlaylistMenuAnchor);
      }
    }

    playlistList.append(row);
  });
}

function createRowMenu(track) {
  const isLiked = isTrackLiked(track.key);
  const resolvedTrackId = resolveTrackLibraryId(track);
  const isLibraryTrack = Boolean(resolvedTrackId);
  const isRemoteTrack = !isLibraryTrack;
  const canDeleteFromApollo = Boolean(resolvedTrackId && track.provider === "library");
  const editablePlaylist = getEditablePlaylist();
  const canToggleCurrentPlaylist = Boolean(editablePlaylist && isLibraryTrack);
  const isInCurrentPlaylist = canToggleCurrentPlaylist ? isTrackInPlaylist(editablePlaylist.id, track) : false;

  const wrapper = document.createElement("div");
  wrapper.className = "track-menu-popover";
  wrapper.innerHTML = `
    <button class="row-menu-button" type="button" data-action="play">Play now</button>
    <button class="row-menu-button" type="button" data-action="queue">Add to queue</button>
    <button class="row-menu-button" type="button" data-action="like">${isLiked ? "Remove like" : "Like track"}</button>
    ${canToggleCurrentPlaylist ? `<button class="row-menu-button" type="button" data-action="toggle-current">${isInCurrentPlaylist ? "Remove from playlist" : "Add to playlist"}</button>` : ""}
    <button class="row-menu-button" type="button" data-action="create-playlist">${isLibraryTrack ? "Create playlist with track" : "Create playlist"}</button>
    ${isRemoteTrack ? '<button class="row-menu-button" type="button" data-action="download-server">Save to Apollo</button>' : ""}
    ${canDeleteFromApollo ? '<button class="row-menu-button row-menu-button--danger" type="button" data-action="delete-server">Delete from Apollo</button>' : ""}
    <button class="row-menu-button" type="button" data-action="download-client">Download</button>
    <button class="row-menu-button" type="button" data-action="copy">Copy link</button>
  `;

  wrapper.querySelector('[data-action="play"]').addEventListener("click", () => {
    closeActiveMenu();
    selectTrack(track.key, { autoplay: true });
  });

  wrapper.querySelector('[data-action="queue"]').addEventListener("click", () => {
    closeActiveMenu();
    addTrackToQueue(track);
  });

  wrapper.querySelector('[data-action="like"]').addEventListener("click", () => {
    toggleLike(track);
    closeActiveMenu();
    render();
  });

  const toggleCurrent = wrapper.querySelector('[data-action="toggle-current"]');
  if (toggleCurrent && editablePlaylist) {
    toggleCurrent.addEventListener("click", async () => {
      closeActiveMenu();
      if (isInCurrentPlaylist) {
        await removeTrackFromPlaylist(editablePlaylist.id, track);
        return;
      }
      await addTrackToPlaylist(editablePlaylist.id, track);
    });
  }

  wrapper.querySelector('[data-action="create-playlist"]').addEventListener("click", () => {
    closeActiveMenu();
    openPlaylistModal({
      title: isLibraryTrack ? "Create playlist with track" : "Create playlist",
      initialTrackId: isLibraryTrack ? resolvedTrackId : null
    });
  });

  const downloadServerButton = wrapper.querySelector('[data-action="download-server"]');
  if (downloadServerButton) {
    downloadServerButton.addEventListener("click", () => {
      closeActiveMenu();
      void downloadTrackToServer(track);
      render();
    });
  }

  const deleteServerButton = wrapper.querySelector('[data-action="delete-server"]');
  if (deleteServerButton) {
    deleteServerButton.addEventListener("click", (event) => {
      closeActiveMenu();

      if (event.shiftKey) {
        void deleteTrackFromApollo(track);
        return;
      }

      openTrackDeleteModal(track);
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

function createPlaylistMenu(playlist) {
  const wrapper = document.createElement("div");
  wrapper.className = "track-menu-popover playlist-menu-popover";
  wrapper.innerHTML = `
    <button class="row-menu-button" type="button" data-action="open">Open playlist</button>
    <button class="row-menu-button" type="button" data-action="edit">Edit playlist</button>
  `;

  wrapper.querySelector('[data-action="open"]').addEventListener("click", () => {
    openPlaylistView(playlist.id, {
      historySource: "playlist"
    });
  });

  wrapper.querySelector('[data-action="edit"]').addEventListener("click", () => {
    closeActiveMenu();
    openPlaylistModal({
      mode: "edit",
      playlistId: playlist.id,
      title: "Edit playlist"
    });
  });

  return wrapper;
}

function createArtistSearchSection() {
  const section = document.createElement("section");
  section.className = "artist-search-section";
  section.innerHTML = `
    <div class="artist-search-header">
      <p class="panel-kicker">Artists</p>
      <span class="artist-search-count">${state.artistSearchResults.length}</span>
    </div>
    <div class="artist-search-list"></div>
  `;

  const list = section.querySelector(".artist-search-list");
  state.artistSearchResults.forEach((artist) => {
    const row = document.createElement("div");
    row.className = "library-item artist-search-item";
    row.innerHTML = `
      <button class="library-item-main" type="button">
        <span class="item-art artist-search-mark">${renderArtistArtwork(artist, "item-art-image")}</span>
        <span class="item-copy">
          <p class="item-title">${escapeHtml(artist.name)}</p>
          <p class="item-subtitle">${escapeHtml(formatArtistSubtitle(artist) || "Open artist songs")}</p>
        </span>
      </button>
      <span class="library-item-menu-spacer" aria-hidden="true"></span>
    `;

    row.querySelector(".library-item-main").addEventListener("click", () => {
      void beginArtistBrowse(artist, {
        historySource: "artist-browse"
      });
    });

    list.append(row);
  });

  return section;
}

function createArtistBrowseSummary() {
  const artist = getArtistBrowseSummary();
  if (!artist) {
    return null;
  }

  const releaseSummary = Array.isArray(artist.releases) && artist.releases.length
    ? artist.releases
      .slice(0, 3)
      .map((release) => {
        const releaseDetail = [release.primaryType, release.firstReleaseDate].filter(Boolean).join(" | ");
        return `<span class="detail-tag">${escapeHtml(release.title)}${releaseDetail ? ` <small>${escapeHtml(releaseDetail)}</small>` : ""}</span>`;
      })
      .join("")
    : "";

  const section = document.createElement("section");
  section.className = "artist-browse-summary";
  section.innerHTML = `
    <div class="artist-browse-main">
      <div class="artist-browse-art">${renderArtistArtwork(artist, "artist-browse-art-image", state.searchResults)}</div>
      <div class="artist-browse-copy">
        <p class="panel-kicker">Artist</p>
        <h3 class="artist-browse-title">${escapeHtml(artist.name)}</h3>
        <p class="item-subtitle">${escapeHtml(formatArtistSubtitle(artist) || "Artist profile from MusicBrainz")}</p>
        <p class="artist-browse-stats">${state.searchResults.length} songs loaded</p>
        ${artist.tags?.length ? `<p class="artist-browse-tags">${escapeHtml(artist.tags.slice(0, 5).join(" | "))}</p>` : ""}
        ${releaseSummary ? `<div class="detail-tags detail-tags--artist">${releaseSummary}</div>` : ""}
        ${state.artistBrowse?.error ? `<p class="field-message">${escapeHtml(state.artistBrowse.error)}</p>` : ""}
      </div>
    </div>
    <button class="text-button" type="button" data-artist-browse-back>Back to search</button>
  `;

  section.querySelector('[data-artist-browse-back]').addEventListener("click", () => {
    void runSearch({
      historySource: "artist-search"
    });
  });

  return section;
}

function positionActiveMenu(row, menu, anchorOverride = null) {
  const viewportPadding = 12;
  const fallbackRect = row.getBoundingClientRect();
  const anchor = anchorOverride || state.activeMenuAnchor || state.activePlaylistMenuAnchor || {
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
  const showArtistSearchResults = Boolean(state.query && !state.artistBrowse && state.artistSearchResults.length);
  document.querySelectorAll(".track-menu-popover--portal").forEach((menu) => menu.remove());
  trackList.innerHTML = "";

  if (state.artistBrowse) {
    const artistSummary = createArtistBrowseSummary();
    if (artistSummary) {
      trackList.append(artistSummary);
    }
  } else if (showArtistSearchResults) {
    trackList.append(createArtistSearchSection());
  }

  if (!visibleTracks.length) {
    if (showArtistSearchResults || state.artistBrowse) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = state.artistBrowse?.isLoading
        ? "Loading artist songs..."
        : state.message || "No songs available for this artist.";
      trackList.append(empty);
      return;
    }

    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.isLoading ? "Loading..." : state.message || "No tracks available yet.";
    trackList.append(empty);
    return;
  }

  visibleTracks.forEach((track, index) => {
    const row = document.createElement("div");
    const duration = formatDuration(getCachedDuration(track), "--:--");
    const provider = state.query ? ` · <span class="track-provider">${providerLabel(track.provider, track.requestedProvider)}</span>` : "";

    row.className = `track-row${track.key === state.selectedTrackKey ? " is-active" : ""}`;
    row.innerHTML = `
      <button class="track-main-button" type="button">
        <span class="track-index">${index + 1}</span>
        <span class="track-leading">
          <span class="track-art">
            ${renderArtwork(track, "track-art-image")}
            <span class="track-art-play" aria-hidden="true">${playGlyphIcon()}</span>
          </span>
          <span class="track-copy">
            <p class="track-title">${escapeHtml(track.title)}</p>
            <p class="track-subtitle">${escapeHtml(track.artist)}${provider}</p>
          </span>
        </span>
        <span class="track-duration">${duration}</span>
      </button>
      <button class="track-menu-button" type="button" aria-label="Track actions">${dotsIcon()}</button>
    `;

    const mainButton = row.querySelector(".track-main-button");
    mainButton.addEventListener("mouseenter", () => {
      prefetchPlaybackUrl(track);
    });
    mainButton.addEventListener("focus", () => {
      prefetchPlaybackUrl(track);
    });
    mainButton.addEventListener("click", (event) => {
      const forcePlay = Boolean(event.target instanceof Element && event.target.closest(".track-art"));
      selectTrack(track.key, { autoplay: forcePlay || state.settings.playback.autoplaySelection });
    });

    const menuButton = row.querySelector(".track-menu-button");

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = menuButton.getBoundingClientRect();
      const shouldOpen = state.activeMenuTrackKey !== track.key;
      closeActiveMenu();
      state.activeMenuTrackKey = shouldOpen ? track.key : null;
      state.activeMenuAnchor = shouldOpen
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
      closeActiveMenu();
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

  if (state.artistBrowse) {
    trackPaneKicker.textContent = "Artist";
    trackPaneTitle.textContent = state.artistBrowse.name;
    trackPaneMeta.textContent = state.artistBrowse.isLoading
      ? "Loading songs..."
      : `${visibleTracks.length} songs`;
    return;
  }

  if (state.query) {
    trackPaneKicker.textContent = "Search";
    trackPaneTitle.textContent = state.query;
    const artistCount = state.artistSearchResults.length;
    trackPaneMeta.textContent = artistCount
      ? `${artistCount} artists | ${visibleTracks.length} songs`
      : `${visibleTracks.length} songs`;
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
  const tabs = [
    {
      id: "track",
      label: "Track"
    },
    {
      id: "queue",
      label: "Queue"
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

      setActiveDetailTab(nextTab);
    });
  });

  const panelBody = detailPanel.querySelector(".detail-panel-body");

  if (state.activeDetailTab === "queue") {
    renderQueuePanel(panelBody);
    return;
  }

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
        <h2>Music, arranged around Apollo.</h2>
        <p class="detail-description">Use the top bar to show or hide the library and detail panels, resize panes with the dividers, and keep search focused on Apollo results.</p>
      </div>
    `;
    return;
  }

  const detailText = state.query
    ? `Search is live across Apollo and provider results. Use the three-dot menu for download, playlist, and save actions.`
    : activeTrack.resultSource === "library"
      ? "This track is already in the Apollo library and can be added to playlists or downloaded directly."
      : findLibraryMatch(activeTrack)
        ? "This remote result matches a track already in the Apollo library. Playlist and playback actions are available without downloading it again."
        : "This is a remote result. Save it to the Apollo server library with metadata or download it directly to the client.";

  panelBody.innerHTML = `
    <div class="detail-art">${renderArtwork(activeTrack, "detail-art-image")}</div>
    <div class="detail-copy">
      <p class="detail-meta">${escapeHtml(providerLabel(activeTrack.provider, activeTrack.requestedProvider))}</p>
      <h2>${escapeHtml(activeTrack.title)}</h2>
      <p class="detail-description">${escapeHtml(activeTrack.artist)}${activeTrack.album ? ` | ${escapeHtml(activeTrack.album)}` : ""}</p>
      <p class="detail-description">${detailText}</p>
    </div>
    <div class="detail-tags">
      <span class="detail-tag">${formatDuration(getCachedDuration(activeTrack), "--:--")}</span>
      <span class="detail-tag">${activeTrack.resultSource === "library" ? "Local" : "Remote"}</span>
    </div>
  `;
}

function renderNowPlaying() {
  const currentTrack = getPlaybackTrack() || getSelectedTrack();

  if (!currentTrack) {
    nowPlaying.innerHTML = `
      <div class="now-playing-shell">
        <div class="now-playing-art">${noteIcon()}</div>
      <div class="now-playing-meta">
        <p class="now-playing-title">Nothing playing</p>
        <p class="now-playing-subtitle">Select a track from the library or search results.</p>
      </div>
      </div>
      <button class="like-button" type="button" aria-label="Like track" aria-pressed="false" disabled>${heartIcon(false)}</button>
    `;
    return;
  }

  const liked = isTrackLiked(currentTrack.key);
  const showSaveAction = canSaveTrackToApollo(currentTrack);
  const showDiscordInviteAction = canInviteCurrentTrackOnDiscord();
  const showLeaveListenAlong = Boolean(listenAlongState.joinedSessionId);
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
      ${showDiscordInviteAction ? '<button class="text-button now-playing-invite-button" type="button" data-now-playing-action="discord-invite">Invite on Discord</button>' : ""}
      ${showLeaveListenAlong ? '<button class="text-button now-playing-invite-button" type="button" data-now-playing-action="leave-listen-along">Leave listen along</button>' : ""}
      <button class="like-button${liked ? " is-liked" : ""}" type="button" aria-label="Like track" aria-pressed="${liked}">${heartIcon(liked)}</button>
    </div>
  `;

  nowPlaying.querySelector(".now-playing-artist").addEventListener("click", () => {
    replaceCurrentNavigationHistoryState();
    state.query = currentTrack.artist;
    searchInput.value = currentTrack.artist;
    renderSearchField();
    clearTimeout(state.searchTimer);
    void runSearch({
      historySource: "artist-search"
    });
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

  const inviteButton = nowPlaying.querySelector('[data-now-playing-action="discord-invite"]');
  if (inviteButton) {
    inviteButton.addEventListener("click", () => {
      void openDiscordInviteModal();
    });
  }

  const leaveButton = nowPlaying.querySelector('[data-now-playing-action="leave-listen-along"]');
  if (leaveButton) {
    leaveButton.addEventListener("click", () => {
      leaveJoinedListenAlongSession();
    });
  }
}

function renderStatus() {
  serverStatus.textContent = state.message;
}

function renderPlaybackUi({ includeTracks = false, includeDetail = false } = {}) {
  if (includeTracks) {
    renderTracks();
  }

  if (includeDetail) {
    renderDetailPanel();
  }

  renderNowPlaying();
  renderStatus();
  renderPlayback();
}

function renderPlayback() {
  repeatButton.innerHTML = getRepeatIcon();
  repeatButton.classList.toggle("is-active", state.repeatMode !== "off");
  shuffleButton.innerHTML = getShuffleIcon();
  shuffleButton.classList.toggle("is-active", state.shuffleEnabled);
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
  volumeSlider.value = String(audioPlayer.volume);
  syncRangeVisuals();
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
  renderSearchField();
  renderWindowChrome();
  applyLayout();
  updateAuthButton();
  renderPlaylists();
  renderTrackPaneHeader();
  renderTracks();
  renderDetailPanel();
  renderNowPlaying();
  renderStatus();
  renderPlayback();
  pluginHost?.emit("app:render", {
    state: createPluginStateSnapshot(),
    playback: createPluginPlaybackSnapshot()
  });
}

function isPlaybackRequestCurrent(requestId) {
  return requestId === activePlaybackRequestId;
}

function cancelPendingPlaybackStart({ keepMessage = false } = {}) {
  activePlaybackRequestId += 1;
  state.isBuffering = false;

  if (!keepMessage && state.message.startsWith("Loading ")) {
    state.message = "";
  }
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
  const cachedUrl = getCachedPlaybackUrl(track.key);
  if (cachedUrl) {
    return cachedUrl;
  }

  if (pendingPlaybackUrlCache.has(track.key)) {
    return pendingPlaybackUrlCache.get(track.key);
  }

  const pendingRequest = (async () => {
    if (track.provider === "library") {
      const directUrl = withAccessToken(`${state.apiBase}/stream/${track.trackId || track.id}`);
      return cachePlaybackUrl(track.key, directUrl, Number.POSITIVE_INFINITY);
    }

    const payload = await requestJson("/api/playback", {
      method: "POST",
      body: JSON.stringify(buildPlaybackPayload(track))
    });

    const streamUrl = withAccessToken(payload.streamUrl);
    return cachePlaybackUrl(track.key, streamUrl);
  })();

  pendingPlaybackUrlCache.set(track.key, pendingRequest);

  try {
    return await pendingRequest;
  } finally {
    pendingPlaybackUrlCache.delete(track.key);
  }
}

async function playResolvedTrack(track, { select = true, replaceQueue = false, queueTracks = null, preserveQueue = false, preserveListenAlong = false } = {}) {
  if (!track) {
    return false;
  }

  const requestId = ++activePlaybackRequestId;

  if (!preserveListenAlong) {
    stopJoinedListenAlongSession();
  }

  if (select) {
    state.selectedTrackKey = track.key;
  }

  if (!preserveQueue) {
    ensurePlaybackQueue(track, {
      replace: replaceQueue,
      queueTracks,
      mode: replaceQueue ? (state.query ? "radio" : "context") : state.playbackQueueMode
    });
  }
  state.transientPlaybackTrack = getTrackByKey(track.key) ? null : serialiseTrack(track);
  state.isBuffering = true;
  state.message = `Loading ${track.title}...`;
  persistPlaybackState();
  render();

  try {
    const nextUrl = await resolvePlaybackUrl(track);
    if (!isPlaybackRequestCurrent(requestId)) {
      return false;
    }

    const currentSrc = audioPlayer.currentSrc || audioPlayer.src;
    const urlChanged = state.playbackTrackKey !== track.key || currentSrc !== nextUrl;

    if (urlChanged) {
      audioPlayer.pause();
      audioPlayer.src = nextUrl;
      audioPlayer.load();
      state.playbackTrackKey = track.key;
      persistPlaybackState();
      pluginHost?.emit("playback:track-changed", {
        track,
        playback: createPluginPlaybackSnapshot()
      });
    }

    if (!isPlaybackRequestCurrent(requestId)) {
      return false;
    }

    await audioPlayer.play();
    if (!isPlaybackRequestCurrent(requestId)) {
      audioPlayer.pause();
      return false;
    }

    state.message = "";
    prefetchUpcomingPlayback(track);
    window.setTimeout(() => {
      if (isPlaybackRequestCurrent(requestId)) {
        void maybeExtendAutoplayQueue(track);
      }
    }, 0);
    return true;
  } catch (error) {
    if (!isPlaybackRequestCurrent(requestId)) {
      return false;
    }

    state.isPlaying = false;
    state.isBuffering = false;
    state.message = error.message;
    pluginHost?.emit("playback:error", {
      track,
      error
    });
    render();
    return false;
  }
}

async function playSelectedTrack({ replaceQueue = true } = {}) {
  const selectedTrack = getSelectedTrack();
  if (!selectedTrack) {
    return;
  }

  await playResolvedTrack(selectedTrack, {
    select: false,
    replaceQueue
  });
}

function getNextTrack(offset, wrap = false) {
  return getAdjacentQueueTrack(offset, wrap)?.track || null;
}

function getRandomTrack() {
  return getRandomQueueTrack()?.track || null;
}

function playAdjacent(offset, wrap = false) {
  const nextEntry = state.shuffleEnabled ? getRandomQueueTrack() : getAdjacentQueueTrack(offset, wrap);
  if (!nextEntry?.track) {
    return;
  }

  const nextTrack = consumeQueueEntry(nextEntry);
  if (!nextTrack) {
    return;
  }

  state.selectedTrackKey = nextEntry.track.key;
  closeActiveMenu();
  persistPlaybackState();
  render();
  void playResolvedTrack(nextTrack, {
    select: false,
    preserveQueue: true
  });
}

function resetLayout() {
  state.layout = structuredClone(DEFAULT_LAYOUT);
  persistLayout();
  render();
}

async function initialiseWindowChrome() {
  renderWindowChrome();

  if (!state.windowChrome.available) {
    return;
  }

  try {
    updateWindowChrome(await windowControls.getState());
  } catch {
    renderWindowChrome();
  }

  removeWindowControlsListener = windowControls.onStateChange((nextState) => {
    updateWindowChrome(nextState);
  });
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
  if (!hasActiveMenu()) {
    return;
  }

  if (
    !event.target.closest(".track-menu-popover") &&
    !event.target.closest(".playlist-menu-popover") &&
    !event.target.closest(".queue-menu-popover") &&
    !event.target.closest(".track-menu-button") &&
    !event.target.closest(".library-item-menu")
  ) {
    closeActiveMenu();
    render();
  }
});

trackList.addEventListener("scroll", () => {
  if (!hasActiveMenu()) {
    return;
  }

  closeActiveMenu();
  render();
});

playlistList.addEventListener("scroll", () => {
  if (!hasActiveMenu()) {
    return;
  }

  closeActiveMenu();
  render();
});

window.addEventListener("resize", () => {
  if (!hasActiveMenu()) {
    return;
  }

  closeActiveMenu();
  render();
});

window.addEventListener("mousedown", handleNavigationMouseButton, true);
window.addEventListener("popstate", (event) => {
  const snapshot = event.state?.apolloNavigation;
  if (!snapshot) {
    return;
  }

  void applyNavigationSnapshot(snapshot);
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
windowMinimizeButton?.addEventListener("click", () => {
  windowControls?.minimize();
});
windowMaximizeButton?.addEventListener("click", () => {
  windowControls?.toggleMaximize();
});
windowCloseButton?.addEventListener("click", () => {
  windowControls?.close();
});
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
connectionModalRetry?.addEventListener("click", () => {
  void retryApolloConnection();
});
connectionModalSettings?.addEventListener("click", () => {
  closeConnectionModal();
  openSettingsModal();
});
settingsDiscordSocialConnect?.addEventListener("click", async () => {
  try {
    await getDiscordSocialBridge()?.startAuth?.();
  } catch (error) {
    state.discordSocial.message = error.message;
    renderDiscordSocialSettings();
  }
});
settingsDiscordSocialSignout?.addEventListener("click", async () => {
  state.discordSocial.message = "To fully disconnect Apollo, open Discord Settings and revoke Apollo from the authorized apps or connected games list.";
  renderDiscordSocialSettings();
});

playlistModalClose.addEventListener("click", closePlaylistModal);
playlistFormCancel.addEventListener("click", closePlaylistModal);
settingsModalClose.addEventListener("click", closeSettingsModal);
settingsFormCancel.addEventListener("click", closeSettingsModal);
discordInviteModalClose?.addEventListener("click", closeDiscordInviteModal);
discordInviteCancel?.addEventListener("click", closeDiscordInviteModal);
discordInviteMessageInput?.addEventListener("input", () => {
  state.discordInvite.message = discordInviteMessageInput.value;
});
playlistArtworkChoose.addEventListener("click", () => {
  playlistArtworkInput.click();
});

playlistModal.querySelectorAll("[data-modal-close]").forEach((element) => {
  element.addEventListener("click", closePlaylistModal);
});
settingsModal.querySelectorAll("[data-settings-close]").forEach((element) => {
  element.addEventListener("click", closeSettingsModal);
});
discordInviteModal.querySelectorAll("[data-discord-invite-close]").forEach((element) => {
  element.addEventListener("click", closeDiscordInviteModal);
});
trackDeleteModal.querySelectorAll("[data-track-delete-close]").forEach((element) => {
  element.addEventListener("click", closeTrackDeleteModal);
});
trackDeleteModalClose?.addEventListener("click", closeTrackDeleteModal);
trackDeleteCancel?.addEventListener("click", closeTrackDeleteModal);
trackDeleteConfirm?.addEventListener("click", () => {
  if (!state.trackDeleteModal.track || state.trackDeleteModal.isDeleting) {
    return;
  }

  void deleteTrackFromApollo(state.trackDeleteModal.track, {
    closeModal: true
  });
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
    syncNavigationHistory(isEditing ? "playlist-edit" : "playlist-create");
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
    syncNavigationHistory("playlist-delete");
    closePlaylistModal();
    state.message = "Playlist deleted.";
    renderStatus();
  } catch (error) {
    playlistFormMessage.textContent = error.message;
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const previousApiBase = state.apiBase;
    const nextSettings = saveCurrentSettingsForm();
    const nextApiBase = buildApiBase(nextSettings.connection);

    state.settings = nextSettings;
    persistSettings();
    state.repeatMode = state.settings.playback.defaultRepeatMode;
    applySettings();
    settingsFormMessage.textContent = "Saved.";
    persistPlaybackState();
    closeSettingsModal();

    if (nextApiBase !== previousApiBase) {
      handleServerEndpointChanged();
      state.message = `Apollo server updated to ${nextApiBase}.`;
      render();
      await initialiseApolloClient();
      if (state.query && state.isConnected && !state.auth.modalOpen) {
        void runSearch();
      }
      return;
    }

    if (state.query) {
      setTimeout(() => {
        void runSearch();
      }, 0);
    } else {
      render();
    }
  } catch (error) {
    settingsFormMessage.textContent = error.message;
  }
});

discordInviteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.discordInvite.isSending || !state.discordInvite.selectedFriendId) {
    return;
  }

  state.discordInvite.isSending = true;
  state.discordInvite.formMessage = "";
  state.discordInvite.message = discordInviteMessageInput?.value || state.discordInvite.message;
  renderDiscordInviteModal();

  try {
    await getDiscordSocialBridge()?.sendActivityInvite?.({
      userId: state.discordInvite.selectedFriendId,
      content: state.discordInvite.message || "Listen along on Apollo"
    });
    closeDiscordInviteModal();
    state.message = "Discord invite sent.";
    renderStatus();
  } catch (error) {
    state.discordInvite.isSending = false;
    state.discordInvite.formMessage = error?.message || "Unable to send Discord invite.";
    renderDiscordInviteModal();
  }
});

settingsVolume.addEventListener("input", () => {
  syncRangeVisual(settingsVolume, state.settings.audio.volume);
});

document.addEventListener("keydown", (event) => {
  if (state.auth.modalOpen) {
    return;
  }

  if (event.key === "BrowserBack" || event.key === "BrowserForward") {
    event.preventDefault();
    requestHistoryNavigation(event.key === "BrowserBack" ? -1 : 1);
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

  if (event.key === "Escape" && state.discordInvite.isOpen) {
    closeDiscordInviteModal();
    return;
  }

  if (event.key === "Escape" && state.trackDeleteModal.isOpen) {
    closeTrackDeleteModal();
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
  renderSearchField();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    void runSearch({
      historySource: "search-input"
    });
  }, state.settings.search.liveSearchDelayMs);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !searchInput.value.trim()) {
    return;
  }

  event.preventDefault();
  clearTimeout(state.searchTimer);
  void setQuery("", {
    run: true,
    historySource: "search-input"
  });
});

clearSearchButton.addEventListener("click", () => {
  clearTimeout(state.searchTimer);
  void setQuery("", {
    run: true,
    historySource: "search-input"
  });
  searchInput.focus();
});

repeatButton.addEventListener("click", () => {
  const modes = ["off", "all", "one"];
  const currentIndex = modes.indexOf(state.repeatMode);
  state.repeatMode = modes[(currentIndex + 1) % modes.length];
  persistPlaybackState();
  renderPlayback();
});

shuffleButton.addEventListener("click", () => {
  state.shuffleEnabled = !state.shuffleEnabled;
  persistPlaybackState();
  renderPlayback();
});

playButton.addEventListener("click", async () => {
  if (!audioPlayer.src) {
    await playSelectedTrack();
    return;
  }

  if (state.isBuffering) {
    cancelPendingPlaybackStart();
    audioPlayer.pause();
    renderPlaybackUi();
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
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("waiting", () => {
  state.isBuffering = true;
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("play", () => {
  state.isPlaying = true;
  state.isBuffering = false;
  state.message = "";
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("pause", () => {
  state.isPlaying = false;
  if (!audioPlayer.ended) {
    state.isBuffering = false;
  }
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("timeupdate", renderPlayback);

audioPlayer.addEventListener("seeked", () => {
  renderPlayback();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("loadedmetadata", () => {
  const playbackTrack = getPlaybackTrack();
  if (playbackTrack && audioPlayer.duration) {
    durationCache.set(playbackTrack.key, audioPlayer.duration);
  }

  if (state.restoredPlaybackKey && state.playbackTrackKey === state.restoredPlaybackKey && playbackState.currentTime > 0) {
    audioPlayer.currentTime = Math.min(playbackState.currentTime, audioPlayer.duration || playbackState.currentTime);
    state.restoredPlaybackKey = null;
  }
  renderPlaybackUi({
    includeTracks: true,
    includeDetail: true
  });
  syncDiscordPresence();
  pluginHost?.emit("playback:metadata", createPluginPlaybackSnapshot());
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

  const nextEntry = getAdjacentQueueTrack(1, false);
  if (nextEntry?.track) {
    const nextTrack = consumeQueueEntry(nextEntry);
    if (!nextTrack) {
      return;
    }

    state.selectedTrackKey = nextEntry.track.key;
    void playResolvedTrack(nextTrack, {
      select: false,
      preserveQueue: true
    });
    return;
  }

  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
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
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("timeupdate", () => {
  playbackState.currentTime = audioPlayer.currentTime || 0;
  persistPlaybackState();
});

audioPlayer.addEventListener("emptied", syncDiscordPresence);

pluginHost = createPluginHost({
  escapeHtml,
  formatDuration,
  providerLabel,
  apollo: createPluginRuntime()
});

await pluginHost.loadPlugins(builtinPlugins);
applySettings();
render();
await initialiseWindowChrome();

async function initialiseDiscordSocial() {
  const bridge = getDiscordSocialBridge();
  if (!bridge?.available) {
    renderDiscordSocialSettings();
    return () => {};
  }

  try {
    applyDiscordSocialState(await bridge.getState());
  } catch {
    renderDiscordSocialSettings();
  }

  return bridge.onStateChange((nextState) => {
    applyDiscordSocialState(nextState);
  });
}

const removeDeepLinkListener = window.apolloDesktop?.onDeepLink?.((url) => {
  void handleApolloDeepLink(url);
});
const removeDiscordSocialListener = await initialiseDiscordSocial();

window.addEventListener("beforeunload", () => {
  stopJoinedListenAlongSession();
  void clearPublishedListenAlongSession();
  removeWindowControlsListener?.();
  removeDeepLinkListener?.();
  removeDiscordSocialListener?.();
  pluginHost?.dispose();
});

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

  pluginHost?.emit("app:ready", {
    state: createPluginStateSnapshot(),
    playback: createPluginPlaybackSnapshot()
  });
}

await initialiseApolloClient();
initialiseNavigationHistory();
