import { createPluginHost } from "./plugin-host.js";
import {
  applyConfiguredTheme as applyDesktopTheme,
  loadRuntimePluginModules as discoverRuntimePluginModules
} from "./renderer/runtime-assets.js";
import {
  buildApiBase,
  clampNumber,
  clampWidth,
  createDefaultSettings,
  DEFAULT_LAYOUT,
  mergeSettings,
  normaliseConnectionSettings,
  parseConnectionSettings,
  SEARCH_PROVIDER_ORDER as searchProviderOrder
} from "./renderer/settings.js";
import {
  buildConnectionFailureMessage,
  createApolloTransport,
  isConnectionError
} from "./renderer/transport.js";
import {
  closeSmallIcon as renderCloseSmallIcon,
  dotsIcon as renderDotsIcon,
  getNavigationBackIcon as renderNavigationBackIcon,
  getNavigationForwardIcon as renderNavigationForwardIcon,
  getNextIcon as renderNextIcon,
  getPlayButtonIcon as renderPlayButtonIcon,
  getPreviousIcon as renderPreviousIcon,
  getRepeatIcon as renderRepeatIcon,
  getShuffleIcon as renderShuffleIcon,
  getVolumeIcon as renderVolumeIcon,
  getWindowMaximizeIcon as renderWindowMaximizeIcon,
  heartIcon as renderHeartIcon,
  noteIcon as renderNoteIcon,
  outlinedSvg as buildOutlinedSvg,
  playGlyphIcon as renderPlayGlyphIcon,
  saveToApolloIcon as renderSaveToApolloIcon,
  shareIcon as renderShareIcon
} from "./renderer/icons.js";
import {
  clearAuthSession as clearStoredAuthSession,
  loadAuthSession,
  loadClientId,
  loadLayout as loadStoredLayout,
  loadLikedTracks as loadStoredLikedTracks,
  loadPlaybackQueue,
  loadPlaybackState,
  loadSettings,
  persistAuthSession as persistStoredAuthSession,
  persistLayout as persistStoredLayout,
  persistLikedTracks as persistStoredLikedTracks,
  persistPlaybackQueue as persistStoredPlaybackQueue,
  persistPlaybackState as persistStoredPlaybackState,
  persistSettings as persistStoredSettings
} from "./renderer/storage.js";
import {
  escapeHtml as escapeHtmlValue,
  formatDuration as formatDurationValue,
  providerLabel as formatProviderLabel
} from "./renderer/formatters.js";
const desktopDiscordDefaults = window.apolloDesktop?.discordPresenceDefaults || {};
let desktopAppConfig = window.apolloDesktop?.appConfig || {};
const desktopRuntimeAssets = window.apolloDesktop?.runtimeAssets || null;
const desktopLogger = window.apolloDesktop?.logging || null;
const discordSocialBridge = window.apolloDesktop?.discordSocial || null;
const listenAlongBridge = window.apolloDesktop?.listenAlong || null;
const listenAlongSignalingBridge = window.apolloDesktop?.listenAlongSignaling || null;
const DEFAULT_SERVER_URL = window.apolloDesktop?.serverUrl || "http://127.0.0.1:4848";
const CLIENT_VERSION = window.apolloDesktop?.appVersion || "0.1.0";
const APOLLO_DEEP_LINK_ROUTE_PLAY = "play";
const APOLLO_DEEP_LINK_ROUTE_LISTEN = "listen";
const DISCORD_LISTEN_ALONG_PARTY_MAX = 8;
const DISCORD_LISTEN_SESSION_POLL_MS = 1000;
const DISCORD_LISTEN_SESSION_RESYNC_THRESHOLD_SECONDS = 1;
const LISTEN_ALONG_SIGNAL_CHANNEL_NAME = "apollo-listen";
const LISTEN_ALONG_WARNING_MESSAGE = "Listen Along currently uses broker-assisted peer-to-peer networking. The other participant may still learn your network address, and some networks may refuse the direct connection.";
const LISTEN_ALONG_JOIN_WARNING = "Listen Along currently uses broker-assisted peer-to-peer networking. The other participant may still learn your network address, and the session can fail on restrictive NATs. Continue?";
const LISTEN_ALONG_HOST_WARNING = "Listen Along currently creates a broker-assisted peer-to-peer session. The listener may still learn your network address, and some networks may refuse the connection. Continue?";
const SEARCH_HISTORY_GROUP_WINDOW_MS = 1500;
const NAVIGATION_INPUT_DEDUPE_MS = 400;
const LIBRARY_REFRESH_FOCUS_COOLDOWN_MS = 30 * 1000;
const PROVIDER_ID_KEYS = ["spotify", "youtube", "soundcloud", "itunes", "deezer", "isrc"];
const APOLLO_SHAREABLE_PROVIDER_ID_KEYS = ["spotify", "deezer", "youtube", "itunes"];
const PLAYBACK_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const DURATION_CACHE_STORAGE_KEY = "apollo-duration-cache-v1";
const LIBRARY_SNAPSHOT_STORAGE_KEY = "apollo-library-snapshot-v1";
const DEFAULT_CONNECTION_SETTINGS = parseConnectionSettings(DEFAULT_SERVER_URL, DEFAULT_SERVER_URL);
const DEFAULT_SETTINGS = createDefaultSettings({
  defaultConnectionSettings: DEFAULT_CONNECTION_SETTINGS,
  desktopDiscordDefaults
});
const playbackFailureCache = new Map();
const initialSettings = loadSettings(localStorage, DEFAULT_SETTINGS, mergeSettings);
let currentApiBase = buildApiBase(initialSettings.connection);
const savedPlaybackState = loadPlaybackState(localStorage);
const savedPlaybackQueue = loadPlaybackQueue(localStorage);
const initialPlaybackQueueState = restorePersistedQueueState(savedPlaybackQueue, savedPlaybackState);
const savedAuthSession = loadAuthSession(localStorage);
const savedLibrarySnapshot = loadLibrarySnapshot(currentApiBase);
const likedTracks = loadStoredLikedTracks(localStorage);
const windowControls = window.apolloDesktop?.windowControls || null;
const LOCAL_DISCORD_HOSTNAMES = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1"]);
const LOCAL_NETWORK_IPV4_PATTERN = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
const listenAlongState = {
  publishedSessionId: "",
  publishedSessionToken: "",
  publishedTrackId: "",
  joinedSessionId: "",
  joinedSessionToken: "",
  joinedTrackId: "",
  joinedPeerBaseUrl: "",
  joinedPeerCandidates: [],
  pollHandle: 0,
  pollInFlight: false
};
let listenAlongAutomaticExposureConsent = false;
let hasPromptedListenAlongAutomaticExposure = false;
const listenAlongRtc = {
  hostPeerConnection: null,
  hostDataChannel: null,
  hostRemotePeerId: "",
  joinPeerConnection: null,
  joinDataChannel: null,
  joinPeerId: "",
  joinHostPeerId: "",
  latestSnapshot: null,
  snapshotIntervalHandle: 0,
  pendingJoinTimeoutHandle: 0,
  signalingSubscribedRooms: new Set()
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

function createConnectionModalState(overrides = {}) {
  return {
    isOpen: false,
    message: "",
    endpoint: "",
    ...overrides
  };
}

function createConfirmModalState(overrides = {}) {
  return {
    isOpen: false,
    title: "Confirm action",
    message: "",
    confirmLabel: "Continue",
    cancelLabel: "Cancel",
    ...overrides
  };
}

const state = {
  apiBase: buildApiBase(initialSettings.connection),
  clientVersion: CLIENT_VERSION,
  clientId: loadClientId(localStorage),
  layout: loadStoredLayout(localStorage, DEFAULT_LAYOUT, clampWidth),
  settings: initialSettings,
  auth: {
    enabled: false,
    configured: false,
    sessionTtlHours: 0,
    token: savedAuthSession.token || "",
    expiresAt: savedAuthSession.expiresAt || "",
    modalOpen: false
  },
  libraryTracks: savedLibrarySnapshot?.libraryTracks || [],
  playlists: savedLibrarySnapshot?.playlists || [],
  selectedPlaylistId: savedPlaybackState.selectedPlaylistId || "all-tracks",
  selectedTrackKey: savedPlaybackState.selectedTrackKey || null,
  playbackTrackKey: savedPlaybackState.playbackTrackKey || null,
  playbackPendingTrackKey: "",
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
  backendStatus: "",
  backendVersion: "",
  backendSummary: "",
  queueAutofillInFlight: false,
  nowPlayingShareOpen: false,
  nowPlayingShareAnchor: null,
  playbackHistory: [],
  shuffleEnabled: false,
  repeatMode: savedPlaybackState.repeatMode || initialSettings.playback.defaultRepeatMode,
  searchTimer: null,
  modal: createPlaylistModalState(),
  discordInvite: createDiscordInviteState(),
  trackDeleteModal: createTrackDeleteModalState(),
  connectionModal: createConnectionModalState(),
  confirmModal: createConfirmModalState(),
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
  listenAlong: {
    available: Boolean(listenAlongBridge?.available),
    running: false,
    port: 0,
    advertisedHosts: [],
    message: LISTEN_ALONG_WARNING_MESSAGE
  },
  listenAlongSignaling: {
    available: Boolean(listenAlongSignalingBridge?.available),
    connected: false,
    connecting: false,
    rooms: [],
    brokerUrl: "",
    message: listenAlongSignalingBridge?.available
      ? "Listen along signaling is idle."
      : "Listen along signaling is unavailable in this build."
  },
  windowChrome: {
    available: true,
    isFocused: true,
    isMaximized: false
  }
};
const playbackState = {
  currentTime: savedPlaybackState.currentTime || 0
};
const renderRevisions = {
  library: savedLibrarySnapshot?.libraryTracks?.length ? 1 : 0,
  playlists: savedLibrarySnapshot?.playlists?.length ? 1 : 0,
  likes: likedTracks.size ? 1 : 0,
  search: 0,
  artist: 0
};

const durationCache = loadPersistedDurationCache();
const playbackUrlCache = new Map();
const pendingPlaybackUrlCache = new Map();
const searchResultCache = new Map();
const artistSearchCache = new Map();
const artistProfileCache = new Map();
const artistTracksCache = new Map();
const artistReleasesCache = new Map();
const pendingDurationKeys = new Set();
const pendingDurationProbeQueue = [];
let activeDurationProbeCount = 0;
const playbackWarmupAudio = new Audio();
playbackWarmupAudio.preload = "auto";
let playbackWarmupTrackKey = "";
let playbackWarmupUrl = "";
let playbackTransitionFrameHandle = 0;
let playbackTransitionTrackKey = "";
let audioLevelingContext = null;
let audioLevelingSourceNode = null;
let audioLevelingInputNode = null;
let audioLevelingCompressorNode = null;
let audioLevelingInitialisationFailed = false;
const audioLevelingSourceNodes = new WeakMap();
const autoDownloadQueue = new Set();
let pluginHost;
let runtimeAssetWatcherCleanup = null;
let activeConfirmResolver = null;
let activeConfirmPromise = null;
let runtimeReloadInFlight = null;
let lastDetailPanelSignature = "";
let lastPlaylistRenderSignature = "";
let lastTrackListRenderSignature = "";
let lastNowPlayingSignature = "";
let lastTrackPaneHeaderSignature = "";
let lastRuntimeAssetsEventSignature = "";

function logClient(source, message, details = null) {
  try {
    desktopLogger?.write?.(source, message, details);
  } catch {
    // Ignore logging failures.
  }
}

let detailTabCleanup = null;
let resizeSession = null;
let removeWindowControlsListener = null;
let activeSearchRequestId = 0;
let activeArtistBrowseRequestId = 0;
let activePlaybackRequestId = 0;
let activeTransportRequestId = 0;
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
const navigationBackStack = [];
const navigationForwardStack = [];
let libraryRefreshInFlight = null;
let lastLibraryRefreshAt = 0;
const activeDownloadWatchers = new Map();
const DOWNLOAD_STATUS_POLL_MS = 1500;

const workspace = document.querySelector("#workspace");
const sidebarPanel = document.querySelector("#sidebar-panel");
const trackPanel = document.querySelector("#track-panel");
const detailPanel = document.querySelector("#detail-panel");
const navigationBackButton = document.querySelector("#navigation-back-button");
const navigationForwardButton = document.querySelector("#navigation-forward-button");
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
const playbackElements = [audioPlayer, playbackWarmupAudio];
let activePlaybackElement = audioPlayer;

function getStandbyAudioElement() {
  return playbackElements.find((element) => element !== activePlaybackElement) || playbackWarmupAudio;
}

function setActiveAudioElement(nextElement) {
  if (nextElement && playbackElements.includes(nextElement)) {
    activePlaybackElement = nextElement;
  }

  return activePlaybackElement;
}

function getPlaybackCurrentTime() {
  return getActiveAudioElement().currentTime || playbackState.currentTime || 0;
}

function getPlaybackDuration(track = getPlaybackTrack()) {
  return getActiveAudioElement().duration || (track ? getCachedDuration(track) || 0 : 0);
}

function isPlaybackPaused() {
  return getActiveAudioElement().paused;
}

function getPlaybackVolume() {
  return getActiveAudioElement().volume;
}

function isPlaybackMuted() {
  return getActiveAudioElement().muted;
}

function getPlaybackRate() {
  return getActiveAudioElement().playbackRate;
}

function applyConfiguredTheme() {
  applyDesktopTheme(desktopAppConfig?.theme, document);
}

function extractBackendVersion(health = {}) {
  const candidates = [
    health?.version,
    health?.build?.version,
    health?.serverVersion,
    health?.appVersion
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function updateBackendState(health = {}) {
  state.backendStatus = String(health?.status || "").trim();
  state.backendVersion = extractBackendVersion(health);
  state.backendSummary = [state.backendStatus, state.backendVersion].filter(Boolean).join(" | ");
}

function resetBackendState() {
  state.backendStatus = "";
  state.backendVersion = "";
  state.backendSummary = "";
}

async function loadRuntimePluginModules() {
  return discoverRuntimePluginModules({
    runtimeAssets: desktopRuntimeAssets,
    logClient
  });
}

async function reloadRuntimeAssets(reason = "manual") {
  if (runtimeReloadInFlight) {
    return runtimeReloadInFlight;
  }

  runtimeReloadInFlight = (async () => {
    try {
      if (desktopRuntimeAssets?.getAppConfig) {
        try {
          desktopAppConfig = await desktopRuntimeAssets.getAppConfig();
          applyConfiguredTheme();
          logClient("themes", "applied runtime theme", {
            reason,
            sourcePath: desktopAppConfig?.sourcePath || "",
            themeSourcePath: desktopAppConfig?.themeSourcePath || ""
          });
        } catch (error) {
          logClient("themes", "runtime theme load failed", {
            reason,
            error: error?.message || "unknown"
          });
        }
      }

      destroyDetailTab();
      pluginHost?.dispose?.();
      pluginHost = createPluginHost({
        escapeHtml,
        formatDuration,
        providerLabel,
        apollo: createPluginRuntime()
      });

      const pluginModules = await loadRuntimePluginModules();
      await pluginHost.loadPlugins(pluginModules);
      logClient("plugins", "loaded runtime plugins", {
        reason,
        count: pluginModules.length,
        plugins: pluginModules.map((plugin) => plugin.id || plugin.name || "unknown")
      });
    } finally {
      runtimeReloadInFlight = null;
    }
  })();

  return runtimeReloadInFlight;
}

function createRuntimeAssetsSignature(snapshot = {}) {
  return JSON.stringify({
    config: {
      sourcePath: snapshot?.appConfig?.sourcePath || "",
      themeSourcePath: snapshot?.appConfig?.themeSourcePath || ""
    },
    plugins: Array.isArray(snapshot?.plugins)
      ? snapshot.plugins.map((plugin) => ({
        path: plugin?.path || "",
        mtimeMs: plugin?.mtimeMs || 0
      }))
      : []
  });
}

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
const confirmModal = document.querySelector("#confirm-modal");
const confirmModalTitle = document.querySelector("#confirm-modal-title");
const confirmModalCopy = document.querySelector("#confirm-modal-copy");
const confirmModalCancel = document.querySelector("#confirm-modal-cancel");
const confirmModalConfirm = document.querySelector("#confirm-modal-confirm");
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
const settingsSkipUnplayableTracks = document.querySelector("#settings-skip-unplayable-tracks");
const settingsDefaultRepeat = document.querySelector("#settings-default-repeat");
const settingsPreviousThreshold = document.querySelector("#settings-previous-threshold");
const settingsPlaybackRate = document.querySelector("#settings-playback-rate");
const settingsCrossfadeSeconds = document.querySelector("#settings-crossfade-seconds");
const settingsVolume = document.querySelector("#settings-volume");
const settingsMuted = document.querySelector("#settings-muted");
const settingsVolumeStep = document.querySelector("#settings-volume-step");
const settingsPreloadMode = document.querySelector("#settings-preload-mode");
const settingsLevelingEnabled = document.querySelector("#settings-leveling-enabled");
const settingsIncludeLibrary = document.querySelector("#settings-include-library");
const settingsProviderDeezer = document.querySelector("#settings-provider-deezer");
const settingsProviderYoutube = document.querySelector("#settings-provider-youtube");
const settingsProviderSpotify = document.querySelector("#settings-provider-spotify");
const settingsProviderSoundcloud = document.querySelector("#settings-provider-soundcloud");
const settingsProviderItunes = document.querySelector("#settings-provider-itunes");
const settingsSearchDelay = document.querySelector("#settings-search-delay");
const settingsAutoRefreshLibrary = document.querySelector("#settings-auto-refresh-library");
const settingsAutoDownloadRemoteOnPlay = document.querySelector("#settings-auto-download-remote-on-play");
const settingsPreferLocalPlayback = document.querySelector("#settings-prefer-local-playback");
const settingsDiscordEnabled = document.querySelector("#settings-discord-enabled");
const settingsDiscordAllowListenAlong = document.querySelector("#settings-discord-allow-listen-along");
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

function persistLikedTracks() {
  persistStoredLikedTracks(localStorage, likedTracks);
}

function persistAuthSession() {
  persistStoredAuthSession(localStorage, state.auth);
}

function clearAuthSession() {
  state.auth.token = "";
  state.auth.expiresAt = "";
  clearStoredAuthSession(localStorage);
  playbackUrlCache.clear();
}

function persistSettings() {
  persistStoredSettings(localStorage, state.settings);
}

function persistPlaybackState() {
  persistStoredPlaybackState(localStorage, {
    selectedPlaylistId: state.selectedPlaylistId,
    selectedTrackKey: state.selectedTrackKey,
    playbackTrackKey: state.playbackTrackKey,
    activeDetailTab: state.activeDetailTab,
    playbackContextIndex: state.playbackContextIndex,
    playbackCurrentSource: state.playbackCurrentSource,
    playbackQueueMode: state.playbackQueueMode,
    shuffleEnabled: state.shuffleEnabled,
    repeatMode: state.repeatMode,
    currentTime: getPlaybackCurrentTime()
  });
}

function persistPlaybackQueue() {
  persistStoredPlaybackQueue(localStorage, {
    version: 2,
    mode: state.playbackQueueMode,
    currentSource: state.playbackCurrentSource,
    contextIndex: state.playbackContextIndex,
    contextQueue: state.playbackContextQueue,
    manualQueue: state.playbackManualQueue,
    autoplayQueue: state.playbackAutoplayQueue
  });
}

function persistLayout() {
  persistStoredLayout(localStorage, state.layout);
}

function loadPersistedDurationCache() {
  try {
    const raw = localStorage.getItem(DURATION_CACHE_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Map();
    }

    return new Map(parsed.filter((entry) => {
      return Array.isArray(entry)
        && typeof entry[0] === "string"
        && Number.isFinite(Number(entry[1]))
        && Number(entry[1]) > 0;
    }).map(([key, duration]) => [key, Number(duration)]));
  } catch {
    return new Map();
  }
}

function persistDurationCache() {
  try {
    const entries = Array.from(durationCache.entries())
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      .slice(-800);
    localStorage.setItem(DURATION_CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage failures.
  }
}

function loadLibrarySnapshot(apiBase) {
  try {
    const raw = localStorage.getItem(LIBRARY_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const snapshot = JSON.parse(raw);
    if (!snapshot || snapshot.apiBase !== apiBase) {
      return null;
    }

    return {
      libraryTracks: Array.isArray(snapshot.libraryTracks)
        ? snapshot.libraryTracks.map(normaliseLibraryTrack)
        : [],
      playlists: Array.isArray(snapshot.playlists)
        ? snapshot.playlists.map((playlist) => ({
          id: playlist.id,
          name: playlist.name || "Untitled Playlist",
          description: playlist.description || "",
          artworkUrl: playlist.artworkUrl || "",
          tracks: Array.isArray(playlist.tracks) ? playlist.tracks.map(normaliseLibraryTrack) : []
        }))
        : []
    };
  } catch {
    return null;
  }
}

function persistLibrarySnapshot() {
  try {
    localStorage.setItem(LIBRARY_SNAPSHOT_STORAGE_KEY, JSON.stringify({
      apiBase: state.apiBase,
      savedAt: Date.now(),
      libraryTracks: state.libraryTracks.map(serialiseTrack),
      playlists: state.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        artworkUrl: playlist.artworkUrl,
        tracks: playlist.tracks.map(serialiseTrack)
      }))
    }));
  } catch {
    // Ignore storage failures.
  }
}

function bumpRenderRevisions(...keys) {
  keys.forEach((key) => {
    if (key in renderRevisions) {
      renderRevisions[key] += 1;
    }
  });
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
  return escapeHtmlValue(value);
}

function outlinedSvg(content, viewBox = "0 0 24 24") {
  return buildOutlinedSvg(content, viewBox);
}

function noteIcon() {
  return renderNoteIcon();
}

function heartIcon(filled) {
  return renderHeartIcon(filled);
}

function dotsIcon() {
  return renderDotsIcon();
}

function shareIcon() {
  return renderShareIcon();
}

function getPreviousIcon() {
  return renderPreviousIcon();
}

function getNextIcon() {
  return renderNextIcon();
}

function getNavigationBackIcon() {
  return renderNavigationBackIcon();
}

function getNavigationForwardIcon() {
  return renderNavigationForwardIcon();
}

function getWindowMaximizeIcon() {
  return renderWindowMaximizeIcon(state.windowChrome.isMaximized);
}

function renderWindowChrome() {
  document.body.classList.toggle("has-custom-chrome", state.windowChrome.available);
  document.body.classList.toggle("window-is-maximized", state.windowChrome.available && state.windowChrome.isMaximized);
  document.body.classList.toggle("window-is-focused", !state.windowChrome.available || state.windowChrome.isFocused);
  const controlsAvailable = Boolean(windowControls?.available);

  [windowMinimizeButton, windowMaximizeButton, windowCloseButton].forEach((button) => {
    if (button) {
      button.hidden = !controlsAvailable;
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
  return renderPlayButtonIcon({
    isPlaying: state.isPlaying,
    isBuffering: state.isBuffering
  });
}

function playGlyphIcon() {
  return renderPlayGlyphIcon();
}

function closeSmallIcon() {
  return renderCloseSmallIcon();
}

function getShuffleIcon() {
  return renderShuffleIcon();
}

function getRepeatIcon() {
  return renderRepeatIcon(state.repeatMode);
}

function getVolumeIcon() {
  return renderVolumeIcon({
    muted: state.settings.audio.muted,
    volume: state.settings.audio.volume
  });
}

function saveToApolloIcon() {
  return renderSaveToApolloIcon();
}

function formatDuration(value, fallback = "0:00") {
  return formatDurationValue(value, fallback);
}

function providerLabel(provider, requestedProvider = "") {
  return formatProviderLabel(provider, requestedProvider);
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

function buildApolloConnectionFailureMessage(error) {
  return buildConnectionFailureMessage(error, state.apiBase);
}

function openConnectionModal(message = buildApolloConnectionFailureMessage()) {
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
  state.playbackHistory = [];
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
  playbackFailureCache.clear();
  pendingPlaybackUrlCache.clear();
  clearArtistBrowseState();
  state.selectedTrackKey = null;
  state.playbackTrackKey = null;
  state.playbackPendingTrackKey = "";
  state.transientPlaybackTrack = null;
  bumpRenderRevisions("library", "playlists", "search", "artist");
  playbackElements.forEach((element) => {
    try {
      element.pause();
      element.removeAttribute("src");
      element.srcObject = null;
      element.load();
    } catch {
      // Ignore media reset failures.
    }
  });
  setActiveAudioElement(audioPlayer);
  clearPlaybackWarmup();
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

function normaliseTrackArtists(artists, fallbackArtist = "") {
  const fallback = String(fallbackArtist || "").trim();
  if (Array.isArray(artists)) {
    const nextArtists = artists
      .map((artist) => String(artist || "").trim())
      .filter(Boolean);
    return nextArtists.length ? nextArtists : (fallback ? [fallback] : []);
  }

  const trimmedArtists = String(artists || "").trim();
  if (!trimmedArtists) {
    return fallback ? [fallback] : [];
  }

  const nextArtists = trimmedArtists
    .split(/\s*,\s*/)
    .map((artist) => artist.trim())
    .filter(Boolean);
  return nextArtists.length ? nextArtists : [trimmedArtists];
}

function normaliseTrackNumberTag(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  const match = String(value).match(/(\d{1,4})/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normaliseTrackReleaseDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const fullDate = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (fullDate) {
    return `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`;
  }

  const monthDate = trimmed.match(/^(\d{4})[-/](\d{2})$/);
  if (monthDate) {
    return `${monthDate[1]}-${monthDate[2]}`;
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return yearOnly[1];
  }

  const isoLike = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoLike) {
    return `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;
  }

  return "";
}

function normaliseTrackExplicitFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const comparable = normaliseMetadataText(value);
  if (!comparable) {
    return null;
  }

  if (["true", "yes", "1", "explicit"].includes(comparable)) {
    return true;
  }

  if (["false", "no", "0", "clean"].includes(comparable)) {
    return false;
  }

  return null;
}

function buildTrackMetadataSnapshot(track = {}) {
  const artist = String(track.artist || "").trim();
  const releaseDate = normaliseTrackReleaseDate(track.releaseDate || track.releaseYear || "");
  const releaseYearMatch = releaseDate.match(/^(\d{4})/);
  const explicit = normaliseTrackExplicitFlag(track.explicit);
  const sourcePlatform = String(track.sourcePlatform || track.provider || "").trim();

  return {
    artists: normaliseTrackArtists(track.artists, artist),
    albumArtist: String(track.albumArtist || "").trim() || artist,
    trackNumber: normaliseTrackNumberTag(track.trackNumber),
    discNumber: normaliseTrackNumberTag(track.discNumber),
    releaseDate,
    releaseYear: normaliseTrackNumberTag(track.releaseYear)
      || (releaseYearMatch ? Number.parseInt(releaseYearMatch[1], 10) : null),
    genre: Array.isArray(track.genre)
      ? track.genre.map((value) => String(value || "").trim()).filter(Boolean).join(", ")
      : String(track.genre || "").trim(),
    explicit,
    sourcePlatform,
    sourceUrl: String(track.sourceUrl || "").trim(),
    isrc: String(track.isrc || track.providerIds?.isrc || "").trim()
  };
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
    releases: Array.isArray(artist.releases)
      ? artist.releases
        .map((release) => ({
          id: String(release?.id || "").trim(),
          title: String(release?.title || "Untitled release").trim(),
          primaryType: String(release?.primaryType || "").trim(),
          firstReleaseDate: String(release?.firstReleaseDate || "").trim()
        }))
        .filter((release) => release.title)
      : [],
    tracks: Array.isArray(artist.tracks)
      ? artist.tracks.map((track) => serialiseTrack(track)).filter((track) => track?.key)
      : [],
    activeReleaseId: String(artist.activeReleaseId || "").trim(),
    activeReleaseTitle: String(artist.activeReleaseTitle || "").trim(),
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
    artist?.area || artist?.country,
    artist?.disambiguation
  ].filter(Boolean).join(" | ");
}

function clearArtistBrowseState() {
  state.artistSearchResults = [];
  state.artistBrowse = null;
  bumpRenderRevisions("artist", "search");
}

function filterArtistBrowseTracks(artistBrowse) {
  const tracks = Array.isArray(artistBrowse?.tracks) ? artistBrowse.tracks : [];
  const activeReleaseTitle = normaliseMetadataText(artistBrowse?.activeReleaseTitle || "");
  if (!activeReleaseTitle) {
    return tracks;
  }

  const exactMatches = tracks.filter((track) => {
    const album = getTrackNormalizedText(track, "normalizedAlbum", "album");
    return album === activeReleaseTitle;
  });
  if (exactMatches.length) {
    return exactMatches;
  }

  return tracks.filter((track) => {
    const album = getTrackNormalizedText(track, "normalizedAlbum", "album");
    return album.includes(activeReleaseTitle);
  });
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

function renderNavigationButtons() {
  if (navigationBackButton) {
    navigationBackButton.innerHTML = getNavigationBackIcon();
    navigationBackButton.disabled = !navigationBackStack.length || isApplyingNavigationHistory;
  }

  if (navigationForwardButton) {
    navigationForwardButton.innerHTML = getNavigationForwardIcon();
    navigationForwardButton.disabled = !navigationForwardStack.length || isApplyingNavigationHistory;
  }
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
  if (isApplyingNavigationHistory) {
    return;
  }

  currentNavigationSnapshot = createNavigationSnapshot();
  renderNavigationButtons();
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

  if (source && source !== "history") {
    navigationForwardStack.length = 0;
  }

  if (!currentNavigationSnapshot || replace || shouldReplaceNavigationHistory(source, nextSnapshot)) {
    currentNavigationSnapshot = nextSnapshot;
  } else {
    navigationBackStack.push(structuredClone(currentNavigationSnapshot));
    currentNavigationSnapshot = nextSnapshot;
  }

  lastNavigationCommitSource = source;
  lastNavigationCommitAt = Date.now();
  renderNavigationButtons();
}

function initialiseNavigationHistory() {
  currentNavigationSnapshot = createNavigationSnapshot();
  navigationBackStack.length = 0;
  navigationForwardStack.length = 0;
  lastNavigationCommitSource = "initial-load";
  lastNavigationCommitAt = Date.now();
  renderNavigationButtons();
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
  clearTimeout(state.searchTimer);
  abortPendingSearchRequest();
  abortPendingArtistBrowseRequest();
  state.selectedPlaylistId = playlistId;
  state.query = "";
  state.searchResults = [];
  state.artistSearchResults = [];
  state.isLoading = false;
  state.message = state.isConnected ? "" : state.message;
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
      bumpRenderRevisions("search");
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
      bumpRenderRevisions("search", "artist");
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
    renderNavigationButtons();
  }
}

async function requestHistoryNavigation(direction) {
  if (isNavigationBlockedByModal() || isApplyingNavigationHistory) {
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
    if (!navigationBackStack.length || !currentNavigationSnapshot) {
      return;
    }

    navigationForwardStack.push(structuredClone(currentNavigationSnapshot));
    const previousSnapshot = navigationBackStack.pop();
    renderNavigationButtons();
    await applyNavigationSnapshot(previousSnapshot);
    return;
  }

  if (!navigationForwardStack.length || !currentNavigationSnapshot) {
    return;
  }

  navigationBackStack.push(structuredClone(currentNavigationSnapshot));
  const nextSnapshot = navigationForwardStack.pop();
  renderNavigationButtons();
  await applyNavigationSnapshot(nextSnapshot);
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
  const metadata = buildTrackMetadataSnapshot(track);
  return {
    key: track.key,
    id: track.id,
    trackId: track.trackId || null,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    artists: metadata.artists,
    album: track.album || "",
    albumArtist: metadata.albumArtist,
    trackNumber: metadata.trackNumber,
    discNumber: metadata.discNumber,
    duration: track.duration || null,
    releaseDate: metadata.releaseDate,
    releaseYear: metadata.releaseYear,
    genre: metadata.genre,
    explicit: metadata.explicit,
    artwork: track.artwork || "",
    providerIds: normaliseProviderIds(track.providerIds),
    isrc: metadata.isrc,
    provider: track.provider || "remote",
    sourcePlatform: metadata.sourcePlatform,
    resultSource: track.resultSource || "remote",
    sourceUrl: metadata.sourceUrl,
    externalUrl: track.externalUrl || "",
    downloadTarget: track.downloadTarget || "",
    normalizedTitle: track.normalizedTitle || getTrackNormalizedText(track, "normalizedTitle", "title"),
    normalizedArtist: track.normalizedArtist || getTrackNormalizedText(track, "normalizedArtist", "artist"),
    normalizedAlbum: track.normalizedAlbum || getTrackNormalizedText(track, "normalizedAlbum", "album"),
    normalizedDuration: getTrackNormalizedDuration(track) || null,
    metadataSource: track.metadataSource || track.provider || "remote",
    requestedProvider: track.requestedProvider || "",
    playable: track.playable !== false,
    playbackUrl: track.playbackUrl || "",
    listenAlongSessionId: track.listenAlongSessionId || "",
    listenAlongTrackId: track.listenAlongTrackId || ""
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
    .filter((track) => Boolean(track?.key) && isTrackQueueEligible(track));
}

function createQueueEntry(track, entryId = "") {
  try {
    const serialisedTrack = serialiseTrack(track);
    if (!serialisedTrack?.key || !isTrackQueueEligible(serialisedTrack)) {
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
  const metadata = buildTrackMetadataSnapshot(track);

  return {
    key: buildTrackKey("library", trackId),
    id: trackId,
    trackId,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    artists: metadata.artists,
    album: track.album || "",
    albumArtist: metadata.albumArtist,
    trackNumber: metadata.trackNumber,
    discNumber: metadata.discNumber,
    duration: track.duration || null,
    releaseDate: metadata.releaseDate,
    releaseYear: metadata.releaseYear,
    genre: metadata.genre,
    explicit: metadata.explicit,
    artwork: track.artwork || "",
    providerIds: normaliseProviderIds(track.providerIds),
    isrc: metadata.isrc,
    provider: "library",
    sourcePlatform: metadata.sourcePlatform || "library",
    resultSource: "library",
    sourceUrl: metadata.sourceUrl,
    externalUrl: track.externalUrl || `${currentApiBase}/stream/${trackId}`,
    downloadTarget: track.downloadTarget || `${currentApiBase}/stream/${trackId}?download=1`,
    normalizedTitle: track.normalizedTitle || getTrackNormalizedText(track, "normalizedTitle", "title"),
    normalizedArtist: track.normalizedArtist || getTrackNormalizedText(track, "normalizedArtist", "artist"),
    normalizedAlbum: track.normalizedAlbum || getTrackNormalizedText(track, "normalizedAlbum", "album"),
    normalizedDuration: getTrackNormalizedDuration(track) || null,
    metadataSource: track.metadataSource || "library",
    requestedProvider: "",
    playable: track.playable !== false
  };
}

function normaliseRemoteTrack(track) {
  const metadata = buildTrackMetadataSnapshot(track);
  return {
    key: buildTrackKey(track.provider || "remote", track.id),
    id: track.id,
    trackId: null,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    artists: metadata.artists,
    album: track.album || "",
    albumArtist: metadata.albumArtist,
    trackNumber: metadata.trackNumber,
    discNumber: metadata.discNumber,
    duration: track.duration || null,
    releaseDate: metadata.releaseDate,
    releaseYear: metadata.releaseYear,
    genre: metadata.genre,
    explicit: metadata.explicit,
    artwork: track.artwork || "",
    providerIds: normaliseProviderIds(track.providerIds),
    isrc: metadata.isrc,
    provider: track.provider || "remote",
    sourcePlatform: metadata.sourcePlatform,
    resultSource: "remote",
    sourceUrl: metadata.sourceUrl,
    externalUrl: track.externalUrl || "",
    downloadTarget: track.downloadTarget || track.externalUrl || "",
    normalizedTitle: track.normalizedTitle || getTrackNormalizedText(track, "normalizedTitle", "title"),
    normalizedArtist: track.normalizedArtist || getTrackNormalizedText(track, "normalizedArtist", "artist"),
    normalizedAlbum: track.normalizedAlbum || getTrackNormalizedText(track, "normalizedAlbum", "album"),
    normalizedDuration: getTrackNormalizedDuration(track) || null,
    metadataSource: track.metadataSource || track.provider || "remote",
    requestedProvider: track.requestedProvider || "",
    playable: track.playable !== false,
    playbackUrl: track.playbackUrl || "",
    listenAlongSessionId: track.listenAlongSessionId || "",
    listenAlongTrackId: track.listenAlongTrackId || ""
  };
}

const requestJson = createApolloTransport({
  getApiBase: () => state.apiBase,
  getAuthorizationHeader,
  onConnectionRecovered: () => {
    state.isConnected = true;
    closeConnectionModal();
  },
  onConnectionFailure: (error) => {
    handleConnectionFailure(error);
  },
  onAuthFailure: (errorMessage) => {
    clearAuthSession();
    updateAuthButton();
    openAuthModal(errorMessage);
  }
});

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

  const items = [];
  let page = 1;
  let totalPages = 1;

  do {
    const payload = await requestJson(
      `/api/artists/${encodeURIComponent(artistId)}/tracks?page=${page}&pageSize=50`,
      { signal }
    );
    items.push(...((payload.items || []).map(normaliseRemoteTrack)));
    totalPages = Math.max(1, Number(payload.totalPages) || 1);
    page += 1;
  } while (page <= totalPages);

  const tracks = dedupeTracks(items);
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

async function enrichArtistSearchResults(artists, { signal } = {}) {
  return Promise.all(
    (Array.isArray(artists) ? artists : []).map(async (artist) => {
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
    })
  );
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

  const baseTracks = (() => {
    if (state.selectedPlaylistId === "liked-tracks") {
      return Array.from(likedTracks.values());
    }

    if (state.selectedPlaylistId && state.selectedPlaylistId !== "all-tracks") {
      return state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId)?.tracks || [];
    }

    return state.libraryTracks;
  })();

  return baseTracks.filter((track) => matchesTrackQuery(track, trimmedQuery));
}

function isCollectionScopedSearch() {
  return !state.artistBrowse && state.selectedPlaylistId !== "all-tracks";
}

function buildSearchStatusMessage({ artistCount, libraryCount, remoteCount, warnings = [], remotePending = false }) {
  const summary = [
    `${artistCount} artists`,
    `${libraryCount} library`,
    remotePending ? "searching remote..." : `${remoteCount} remote`
  ].join(" | ");

  return warnings.length ? `${summary} | ${warnings.join(" ")}` : summary;
}

function formatArtistSearchSubtitle(artist) {
  const base = formatArtistSubtitle(artist);
  const releases = Array.isArray(artist?.releases) ? artist.releases.filter((release) => release?.title) : [];
  const releaseSummary = releases.length
    ? releases.slice(0, 2).map((release) => release.title).join(" | ")
    : "";
  return [base, releaseSummary].filter(Boolean).join(" · ");
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
  abortPendingSearchRequest();
  abortPendingArtistBrowseRequest();
  const abortController = new AbortController();
  activeArtistBrowseAbortController = abortController;
  state.artistBrowse = {
    ...nextArtist,
    isLoading: true,
    error: ""
  };
  bumpRenderRevisions("artist");
  state.artistSearchResults = [];
  state.searchResults = [];
  bumpRenderRevisions("search");
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
      tracks,
      releases,
      activeReleaseId: "",
      activeReleaseTitle: "",
      isLoading: false,
      error: ""
    };
    state.searchResults = tracks;
    bumpRenderRevisions("artist", "search");
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
      tracks: [],
      releases: [],
      activeReleaseId: "",
      activeReleaseTitle: "",
      isLoading: false,
      error: error.message
    };
    state.searchResults = [];
    bumpRenderRevisions("artist", "search");
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
  if (state.artistBrowse?.tracks?.length) {
    return filterArtistBrowseTracks(state.artistBrowse);
  }

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

function getKnownDurationForTrack(track) {
  if (!track?.key) {
    return null;
  }

  const sources = [
    state.playbackManualQueue.map((entry) => entry.track),
    state.playbackContextQueue,
    state.playbackAutoplayQueue.map((entry) => entry.track),
    state.playbackHistory,
    state.transientPlaybackTrack ? [state.transientPlaybackTrack] : [],
    Array.from(likedTracks.values())
  ];

  for (const source of sources) {
    const match = source.find((candidate) => candidate?.key === track.key && Number(candidate?.duration) > 0);
    if (match) {
      return Number(match.duration);
    }
  }

  return null;
}

function getPlaybackQueueSeed(track) {
  const visibleTracks = getVisibleTracks();
  if (visibleTracks.some((candidate) => candidate.key === track?.key)) {
    return visibleTracks;
  }

  return track ? [track] : [];
}

function shouldUseArtistBrowseQueue(track) {
  if (!track?.key || !state.artistBrowse?.id) {
    return false;
  }

  return filterArtistBrowseTracks(state.artistBrowse)
    .some((candidate) => candidate.key === track.key);
}

function resolvePlaybackReplaceMode(track, queueTracks = null) {
  if (Array.isArray(queueTracks) && queueTracks.length) {
    return "context";
  }

  if (shouldUseArtistBrowseQueue(track)) {
    return "context";
  }

  return state.query ? "radio" : "context";
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
    state.playbackTrackKey
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

  return [...manualEntries, ...contextEntries, ...autoplayEntries]
    .filter((entry) => isTrackQueueEligible(entry.track));
}

function getOrderedUpcomingQueueEntries() {
  return state.playbackTrackKey
    ? ensurePlaybackQueueFromCurrentTrack()
    : getUpcomingQueueEntries();
}

function getQueueEntryById(queueId) {
  if (!queueId) {
    return null;
  }

  return getOrderedUpcomingQueueEntries().find((entry) => entry.id === queueId) || null;
}

function getAdjacentQueueTrack(offset, wrap = false) {
  const upcomingEntries = getOrderedUpcomingQueueEntries();
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
  const pool = getOrderedUpcomingQueueEntries();
  if (!pool.length) {
    return null;
  }

  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function commitQueueState({ message = "", renderApp = true } = {}) {
  persistPlaybackQueue();
  persistPlaybackState();
  prefetchQueuedPlayback();

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

async function fetchRecommendedTracks(seedTrack, limit = 8) {
  if (!seedTrack) {
    return [];
  }

  const normaliseRecommendationItems = (items = []) => items.map((item) => (
    item?.provider === "library" || item?.trackId
      ? normaliseLibraryTrack(item)
      : normaliseRemoteTrack(item)
  ));

  if (getLibraryTrackId(seedTrack)) {
    const payload = await requestJson(
      `/api/tracks/${encodeURIComponent(getLibraryTrackId(seedTrack))}/related?limit=${encodeURIComponent(limit)}`
    );
    return Array.isArray(payload?.items) ? normaliseRecommendationItems(payload.items) : [];
  }

  const payload = await requestJson("/api/recommendations", {
    method: "POST",
    body: JSON.stringify({
      title: seedTrack.title || "",
      artist: seedTrack.artist || "",
      album: seedTrack.album || "",
      providerIds: normaliseProviderIds(seedTrack.providerIds),
      duration: seedTrack.duration || null,
      limit
    })
  });
  return Array.isArray(payload?.items) ? normaliseRecommendationItems(payload.items) : [];
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

async function maybeExtendAutoplayQueue(seedTrack = getPlaybackTrack(), { threshold = 2 } = {}) {
  if (state.playbackQueueMode !== "radio" || state.queueAutofillInFlight || !seedTrack?.key) {
    return;
  }

  const remainingTracks = getUpcomingQueueEntries().length;
  if (remainingTracks > threshold) {
    return;
  }

  const queries = buildAutoplayQueries(seedTrack).slice(0, 3);
  if (!queries.length) {
    return;
  }

  state.queueAutofillInFlight = true;

  try {
    let candidateTracks = [];

    try {
      candidateTracks = await fetchRecommendedTracks(seedTrack, 10);
    } catch {
      candidateTracks = [];
    }

    if (!candidateTracks.length) {
      const results = await Promise.all(queries.map((query) => fetchSearchResults(query)));
      candidateTracks = dedupeTracks(results.flatMap((result) => result.tracks || []));
    }

    const candidates = dedupeTracks(candidateTracks)
      .map((candidate) => ({
        candidate,
        score: scoreAutoplayCandidate(seedTrack, candidate)
      }))
      .filter((entry) => isTrackLikelyPlayable(entry.candidate))
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

async function getNextQueueEntryWithAutoplay(offset, wrap = false) {
  let nextEntry = getAdjacentQueueTrack(offset, wrap);
  if (nextEntry?.track || state.playbackQueueMode !== "radio" || offset < 0) {
    return nextEntry;
  }

  await maybeExtendAutoplayQueue(getPlaybackTrack());
  return getAdjacentQueueTrack(offset, wrap);
}

function addTrackToQueue(track) {
  if (!track?.key || !isTrackLikelyPlayable(track)) {
    state.message = "Apollo could not queue this song because it does not expose a playable source.";
    renderStatus();
    return;
  }

  const nextEntry = createQueueEntry(track);
  if (!nextEntry) {
    state.message = hasTrackPlaybackFailure(track)
      ? getTrackPlaybackFailure(track)?.message || "Apollo could not queue this song because no playable source was found."
      : "Apollo could not queue this song because it does not expose a playable source.";
    renderStatus();
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

    const transportRequestId = beginTransportRequest({
      cancelPendingPlayback: true
    });
    state.selectedTrackKey = track.key;
    void playTrackWithTransition(track, {
      select: false,
      preserveQueue: true,
      transportRequestId
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
  state.activeQueueMenuId = "";
  state.activeQueueMenuAnchor = null;
  document.querySelectorAll(".queue-menu-popover--portal").forEach((menu) => menu.remove());
  const currentTrack = getPlaybackTrack();
  const upcomingEntries = getOrderedUpcomingQueueEntries();
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
        <div class="queue-header-top">
          <div>
            <p class="detail-meta">Queue</p>
            <h3>${visibleEntries.length} song${visibleEntries.length === 1 ? "" : "s"} lined up</h3>
          </div>
          ${currentTrack
            ? `<button class="secondary-button queue-mode-button" type="button" data-queue-mode-toggle>${state.playbackQueueMode === "radio" ? "Autoplay on" : "Autoplay similar"}</button>`
            : ""}
        </div>
        <p class="detail-description">${state.playbackQueueMode === "radio"
          ? "This queue is in autoplay mode. Apollo will keep trying to append similar tracks as it runs low."
          : "The current song stays separate from upcoming songs. Drag anything below it to set the exact order Apollo will follow next."}</p>
      </div>
      <div class="queue-list" role="list"></div>
    </div>
  `;

  const queueList = panelBody.querySelector(".queue-list");
  const queueModeToggle = panelBody.querySelector("[data-queue-mode-toggle]");
  if (queueModeToggle && currentTrack) {
    queueModeToggle.addEventListener("click", () => {
      state.playbackQueueMode = state.playbackQueueMode === "radio" ? "context" : "radio";
      state.playbackAutoplayQueue = [];
      persistPlaybackQueue();
      persistPlaybackState();
      renderDetailPanel();
      if (state.playbackQueueMode === "radio") {
        void maybeExtendAutoplayQueue(currentTrack);
      }
    });
  }

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
    const playbackFailure = getTrackPlaybackFailure(track);
    const isUnavailable = Boolean(playbackFailure) || !isTrackQueueEligible(track);
    const isCheckingSource = !isCurrent && !isUnavailable && pendingPlaybackUrlCache.has(track.key);
    const nextRowIndex = currentTrack ? 1 : 0;
    const queueLabel = isCurrent
      ? getCurrentQueueStatusLabel()
      : isUnavailable
        ? "Unavailable"
        : isCheckingSource
          ? "Checking"
          : visibleIndex === nextRowIndex
            ? "Next"
            : queueEntry.lane === "manual"
              ? "Queued"
              : queueEntry.lane === "autoplay"
                ? "Autoplay"
                : "From context";

    row.className = `queue-row${isCurrent ? " is-current" : ""}${isSelected ? " is-selected" : ""}${isUnavailable ? " is-unavailable" : ""}`;
    if (!isCurrent) {
      row.dataset.orderIndex = String(visibleIndex - (currentTrack ? 1 : 0));
      row.dataset.queueId = queueEntry.id;
    }
    row.draggable = !isCurrent && !isUnavailable;
    row.innerHTML = `
      <button class="queue-play" type="button" aria-label="Play ${escapeHtml(track.title)}" ${isUnavailable ? "disabled" : ""}>
        <span class="queue-play-art">${renderArtwork(track, "queue-play-art-image")}</span>
        <span class="queue-play-overlay">${playGlyphIcon()}</span>
      </button>
      <button class="queue-main" type="button" ${isUnavailable ? `title="${escapeHtml(playbackFailure?.message || "No playable source available.")}"` : ""}>
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
      if (isUnavailable) {
        return;
      }

      state.selectedTrackKey = track.key;
      closeActiveMenu();
      const nextTrack = promoteQueueEntryToCurrent(queueEntry);
      if (!nextTrack) {
        return;
      }

      const transportRequestId = beginTransportRequest({
        cancelPendingPlayback: true
      });
      void playTrackWithTransition(nextTrack, {
        select: false,
        preserveQueue: true,
        transportRequestId
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
      openQueueMenu(row, queueEntry, isCurrent, {
        x: event.clientX,
        y: event.clientY
      });
    });

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
    clientVersion: state.clientVersion,
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
    backendVersion: state.backendVersion,
    backendStatus: state.backendStatus,
    isLoading: state.isLoading,
    isBuffering: state.isBuffering,
    isPlaying: state.isPlaying,
    message: state.message,
    repeatMode: state.repeatMode
  };
}

function createPluginPlaybackSnapshot() {
  const track = getPlaybackTrack();
  const status = getPlaybackStatusKind();
  return {
    track,
    trackKey: state.playbackTrackKey,
    isPlaying: state.isPlaying,
    isBuffering: state.isBuffering,
    status,
    currentTime: audioPlayer.currentTime || 0,
    duration: audioPlayer.duration || (track ? getCachedDuration(track) || 0 : 0),
    paused: audioPlayer.paused,
    muted: state.settings.audio.muted,
    volume: state.settings.audio.volume,
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
    const transportRequestId = beginTransportRequest({
      cancelPendingPlayback: true
    });
    await playResolvedTrack(track, {
      select: false,
      replaceQueue: true,
      transportRequestId
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
    version: CLIENT_VERSION,
    runtimeVersion: "2",
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
  return durationCache.get(track.key) ?? track.duration ?? getKnownDurationForTrack(track) ?? null;
}

function cacheTrackDuration(track, durationSeconds) {
  if (!track?.key || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return;
  }

  durationCache.set(track.key, durationSeconds);
  persistDurationCache();
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

function isTrackLikelyPlayable(track) {
  if (!track?.key) {
    return false;
  }

  if (track.playable === false) {
    return false;
  }

  if (track.provider === "library" || track.trackId) {
    return true;
  }

  if (String(track.playbackUrl || track.externalUrl || track.downloadTarget || "").trim()) {
    return true;
  }

  return false;
}

function getTrackPlaybackFailure(trackOrKey) {
  const trackKey = typeof trackOrKey === "string" ? trackOrKey : trackOrKey?.key;
  if (!trackKey) {
    return null;
  }

  return playbackFailureCache.get(trackKey) || null;
}

function hasTrackPlaybackFailure(trackOrKey) {
  return Boolean(getTrackPlaybackFailure(trackOrKey));
}

function isTrackQueueEligible(track) {
  return isTrackLikelyPlayable(track) && !hasTrackPlaybackFailure(track);
}

function clearTrackPlaybackFailure(trackOrKey) {
  const trackKey = typeof trackOrKey === "string" ? trackOrKey : trackOrKey?.key;
  if (!trackKey) {
    return;
  }

  playbackFailureCache.delete(trackKey);
}

function pruneKnownPlaybackFailures({ renderApp = false } = {}) {
  const filterPlayable = (entry) => !hasTrackPlaybackFailure(entry?.track || entry);
  const previousManualLength = state.playbackManualQueue.length;
  const previousContextLength = state.playbackContextQueue.length;
  const previousAutoplayLength = state.playbackAutoplayQueue.length;

  state.playbackManualQueue = state.playbackManualQueue.filter(filterPlayable);
  state.playbackContextQueue = state.playbackContextQueue.filter(filterPlayable);
  state.playbackAutoplayQueue = state.playbackAutoplayQueue.filter(filterPlayable);
  state.playbackContextIndex = resolveContextIndex(
    state.playbackContextQueue,
    state.playbackContextIndex,
    state.playbackTrackKey
  );

  const didChange = previousManualLength !== state.playbackManualQueue.length
    || previousContextLength !== state.playbackContextQueue.length
    || previousAutoplayLength !== state.playbackAutoplayQueue.length;

  if (!didChange) {
    return false;
  }

  persistPlaybackQueue();
  persistPlaybackState();

  if (renderApp) {
    render();
  } else {
    if (state.activeDetailTab === "queue") {
      renderDetailPanel();
    }
    renderStatus();
  }

  return true;
}

function rememberTrackPlaybackFailure(track, error, { renderApp = false } = {}) {
  if (!track?.key) {
    return;
  }

  const fallbackMessage = track.title
    ? `Apollo could not find a playable source for ${track.title}.`
    : "Apollo could not find a playable source for this track.";
  const message = String(error?.message || fallbackMessage).trim() || fallbackMessage;

  playbackFailureCache.set(track.key, {
    message,
    recordedAt: Date.now()
  });
  playbackUrlCache.delete(track.key);
  pendingPlaybackUrlCache.delete(track.key);
  if (playbackWarmupTrackKey === track.key) {
    clearPlaybackWarmup();
  }
  logClient("playback", "track source unavailable", {
    trackKey: track.key,
    title: track.title || "",
    message
  });
  if (state.settings.playback.skipUnplayableTracks) {
    pruneKnownPlaybackFailures({ renderApp });
  }
}

function getPlaybackStatusKind() {
  return getPlaybackStatus();
}

function getPlaybackStatus() {
  const activeAudio = getActiveAudioElement();
  const hasPlaybackTrack = Boolean(getPlaybackTrack());
  const hasSource = hasActiveAudioSource();
  const hasAudibleProgress = (activeAudio.currentTime || 0) > 0.25;
  const canKeepPlaying = activeAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
  const isSwitchingTracks = Boolean(
    state.playbackPendingTrackKey
    && state.playbackTrackKey
    && state.playbackPendingTrackKey !== state.playbackTrackKey
  );

  if (state.isBuffering) {
    if (isSwitchingTracks && state.isPlaying && !activeAudio.paused) {
      return "playing";
    }

    if (state.isPlaying && !activeAudio.paused) {
      return canKeepPlaying
        ? "playing"
        : hasAudibleProgress
          ? "buffering"
          : "loading";
    }

    return "loading";
  }

  if (state.isPlaying && !activeAudio.paused) {
    return "playing";
  }

  if (hasPlaybackTrack && (activeAudio.paused || !hasSource)) {
    return "paused";
  }

  return "idle";
}

function getCurrentQueueStatusLabel() {
  const statusKind = getPlaybackStatusKind();
  if (statusKind === "loading") {
    return "Loading";
  }

  if (statusKind === "buffering") {
    return "Buffering";
  }

  if (statusKind === "paused") {
    return "Paused";
  }

  return statusKind === "playing" ? "Playing" : "Idle";
}

function setAudioOutputVolume(volumeScale = 1) {
  const nextBaseVolume = clampNumber(state.settings.audio.volume, 0, 1, 1);
  const resolvedScale = clampNumber(volumeScale, 0, 1, 1);
  audioPlayer.volume = nextBaseVolume * resolvedScale;
  audioPlayer.muted = Boolean(state.settings.audio.muted) || audioPlayer.volume <= 0.0001;
}

function clearPlaybackTransition() {
  if (playbackTransitionFrameHandle) {
    cancelAnimationFrame(playbackTransitionFrameHandle);
    playbackTransitionFrameHandle = 0;
  }

  setAudioOutputVolume(1);
}

function animatePlaybackVolume(fromScale, toScale, durationMs) {
  clearPlaybackTransition();

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    setAudioOutputVolume(toScale);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const startedAt = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const nextScale = fromScale + ((toScale - fromScale) * progress);
      setAudioOutputVolume(nextScale);

      if (progress >= 1) {
        playbackTransitionFrameHandle = 0;
        resolve();
        return;
      }

      playbackTransitionFrameHandle = requestAnimationFrame(step);
    };

    setAudioOutputVolume(fromScale);
    playbackTransitionFrameHandle = requestAnimationFrame(step);
  });
}

function getConfiguredCrossfadeSeconds() {
  return clampNumber(state.settings.playback.crossfadeSeconds, 0, 12, 0);
}

function canUseCrossfadeTransition() {
  return getConfiguredCrossfadeSeconds() > 0
    && !listenAlongState.joinedSessionId
    && state.isPlaying
    && !state.isBuffering
    && !audioPlayer.paused
    && Number.isFinite(audioPlayer.duration)
    && audioPlayer.duration > 0;
}

function maybeStartAutomaticCrossfade() {
  const currentTrack = getPlaybackTrack();
  if (!currentTrack?.key || !canUseCrossfadeTransition()) {
    return;
  }

  if (playbackTransitionTrackKey === currentTrack.key) {
    return;
  }

  const remainingSeconds = Math.max(0, (audioPlayer.duration || 0) - (audioPlayer.currentTime || 0));
  if (remainingSeconds > getConfiguredCrossfadeSeconds()) {
    return;
  }

  playbackTransitionTrackKey = currentTrack.key;
  void playAdjacent(1, state.repeatMode === "all", {
    interrupt: false,
    transportRequestId: beginTransportRequest()
  }).finally(() => {
    if (playbackTransitionTrackKey === currentTrack.key) {
      playbackTransitionTrackKey = "";
    }
  });
}

function ensureAudioLevelingGraph() {
  if (audioLevelingContext || audioLevelingInitialisationFailed) {
    return audioLevelingContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  try {
    audioLevelingContext = new AudioContextClass();
    audioLevelingSourceNode = audioLevelingContext.createMediaElementSource(audioPlayer);
    audioLevelingInputNode = audioLevelingContext.createGain();
    audioLevelingCompressorNode = audioLevelingContext.createDynamicsCompressor();
    audioLevelingCompressorNode.threshold.value = -20;
    audioLevelingCompressorNode.knee.value = 22;
    audioLevelingCompressorNode.ratio.value = 2.6;
    audioLevelingCompressorNode.attack.value = 0.003;
    audioLevelingCompressorNode.release.value = 0.28;
    audioLevelingSourceNode.connect(audioLevelingInputNode);
    return audioLevelingContext;
  } catch (error) {
    audioLevelingInitialisationFailed = true;
    audioLevelingContext = null;
    audioLevelingSourceNode = null;
    audioLevelingInputNode = null;
    audioLevelingCompressorNode = null;
    logClient("audio", "audio normalization unavailable", {
      error: error?.message || "unknown"
    });
    return null;
  }
}

function applyAudioLevelingSetting() {
  if (!state.settings.audio.levelingEnabled) {
    if (audioLevelingInputNode && audioLevelingContext) {
      try {
        audioLevelingInputNode.disconnect();
        audioLevelingCompressorNode?.disconnect();
        audioLevelingInputNode.connect(audioLevelingContext.destination);
      } catch {
        // Ignore reconnect failures and keep default element output.
      }
    }
    return;
  }

  const audioContext = ensureAudioLevelingGraph();
  if (!audioContext || !audioLevelingInputNode || !audioLevelingCompressorNode) {
    return;
  }

  try {
    audioLevelingInputNode.disconnect();
    audioLevelingCompressorNode.disconnect();
    audioLevelingInputNode.connect(audioLevelingCompressorNode);
    audioLevelingCompressorNode.connect(audioContext.destination);
  } catch {
    // Ignore reconnect failures and leave playback running.
  }
}

async function resumeAudioLevelingContext() {
  const audioContext = state.settings.audio.levelingEnabled ? ensureAudioLevelingGraph() : null;
  if (!audioContext || audioContext.state !== "suspended") {
    return;
  }

  try {
    await audioContext.resume();
  } catch {
    // Ignore resume failures and fall back to element playback.
  }
}

function clearPlaybackWarmup() {
  playbackWarmupTrackKey = "";
  playbackWarmupUrl = "";
  try {
    playbackWarmupAudio.pause();
  } catch {
    // Ignore pause failures.
  }
  try {
    playbackWarmupAudio.removeAttribute("src");
    playbackWarmupAudio.load();
  } catch {
    // Ignore teardown failures.
  }
}

async function primePlaybackTrack(track) {
  if (!track?.key || hasActiveAudioSource()) {
    return false;
  }

  try {
    const nextUrl = await resolvePlaybackUrl(track);
    const currentSrc = audioPlayer.currentSrc || audioPlayer.src;
    if (currentSrc !== nextUrl) {
      audioPlayer.src = nextUrl;
      audioPlayer.load();
    }
    return true;
  } catch {
    return false;
  }
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

async function warmPlaybackTrack(track) {
  if (!track?.key) {
    clearPlaybackWarmup();
    return false;
  }

  try {
    const nextUrl = await resolvePlaybackUrl(track);
    if (playbackWarmupTrackKey === track.key && playbackWarmupUrl === nextUrl) {
      return true;
    }

    playbackWarmupTrackKey = track.key;
    playbackWarmupUrl = nextUrl;
    playbackWarmupAudio.src = nextUrl;
    playbackWarmupAudio.load();
    return true;
  } catch {
    if (playbackWarmupTrackKey === track.key) {
      clearPlaybackWarmup();
    }
    return false;
  }
}

function pushPlaybackHistory(track) {
  if (!track?.key) {
    return;
  }

  const lastTrack = state.playbackHistory[state.playbackHistory.length - 1];
  if (lastTrack && areTracksEquivalent(lastTrack, track)) {
    return;
  }

  state.playbackHistory = [...state.playbackHistory, serialiseTrack(track)].slice(-100);
}

function popPlaybackHistory() {
  while (state.playbackHistory.length) {
    const previousTrack = state.playbackHistory.pop();
    if (previousTrack && !areTracksEquivalent(previousTrack, getPlaybackTrack())) {
      return previousTrack;
    }
  }

  return null;
}

function buildAutoDownloadKey(track) {
  return [
    track?.provider || "",
    track?.id || "",
    track?.trackId || "",
    track?.title || "",
    track?.artist || "",
    track?.album || "",
    track?.externalUrl || "",
    track?.downloadTarget || ""
  ].join("::");
}

function resolvePreferredPlaybackTrack(track) {
  if (!track?.key || !state.settings.downloads.preferLocalPlayback) {
    return track;
  }

  const libraryMatch = findLibraryMatch(track);
  if (!libraryMatch?.trackId) {
    return track;
  }

  return libraryMatch;
}

function prefetchPlaybackUrl(track) {
  if (!track?.key || hasTrackPlaybackFailure(track) || !isTrackLikelyPlayable(track)) {
    return;
  }

  void resolvePlaybackUrl(track)
    .then(() => {
      clearTrackPlaybackFailure(track);
      if (state.activeDetailTab === "queue") {
        renderDetailPanel();
      }
    })
    .catch((error) => {
      rememberTrackPlaybackFailure(track, error, {
        renderApp: state.settings.playback.skipUnplayableTracks
      });
      if (state.activeDetailTab === "queue") {
        renderDetailPanel();
      }
    });
}

function getQueuePreloadAnchorTrack() {
  const currentTrack = getPlaybackTrack() || getSelectedTrack();
  if (currentTrack?.key) {
    return currentTrack;
  }

  const nextQueuedTrack = getOrderedUpcomingQueueEntries()
    .map((entry) => entry.track)
    .find((track) => track?.key);

  if (nextQueuedTrack?.key) {
    return nextQueuedTrack;
  }

  return state.playbackContextQueue.find((track) => track?.key) || null;
}

function prefetchUpcomingPlayback(track) {
  const anchorTrack = track?.key ? track : getQueuePreloadAnchorTrack();
  if (anchorTrack?.key) {
    prefetchPlaybackUrl(anchorTrack);
  }

  const upcomingTracks = getOrderedUpcomingQueueEntries()
    .map((entry) => entry.track)
    .filter(Boolean);

  upcomingTracks.forEach((upcomingTrack) => {
    if (upcomingTrack?.key && upcomingTrack.key !== anchorTrack?.key) {
      prefetchPlaybackUrl(upcomingTrack);
    }
  });

  const nextTrack = upcomingTracks[0];
  if (nextTrack?.key && nextTrack.key !== anchorTrack?.key) {
    void warmPlaybackTrack(nextTrack);
    return;
  }

  if (anchorTrack?.key) {
    void warmPlaybackTrack(anchorTrack);
    return;
  }

  clearPlaybackWarmup();
}

function prefetchQueuedPlayback(track = null) {
  prefetchUpcomingPlayback(track?.key ? track : getQueuePreloadAnchorTrack());
}

function queueDurationProbe(track) {
  if (track.provider !== "library") {
    return;
  }

  if (getCachedDuration(track) || pendingDurationKeys.has(track.key)) {
    return;
  }

  pendingDurationKeys.add(track.key);
  pendingDurationProbeQueue.push(track);
  flushDurationProbeQueue();
}

function flushDurationProbeQueue() {
  const MAX_PARALLEL_DURATION_PROBES = 3;
  while (activeDurationProbeCount < MAX_PARALLEL_DURATION_PROBES && pendingDurationProbeQueue.length) {
    const track = pendingDurationProbeQueue.shift();
    if (!track?.key) {
      continue;
    }

    activeDurationProbeCount += 1;
    const probe = new Audio();
    probe.preload = "metadata";
    probe.src = withAccessToken(`${state.apiBase}/stream/${track.trackId || track.id}`);

    const cleanup = () => {
      try {
        probe.removeAttribute("src");
        probe.load();
      } catch {
        // Ignore teardown failures.
      }
      activeDurationProbeCount = Math.max(0, activeDurationProbeCount - 1);
      flushDurationProbeQueue();
    };

    probe.addEventListener(
      "loadedmetadata",
      () => {
        cacheTrackDuration(track, probe.duration);
        pendingDurationKeys.delete(track.key);

        const durationNode = trackList?.querySelector(
          `.track-row[data-track-key="${CSS.escape(track.key)}"] .track-duration`
        );
        if (durationNode) {
          durationNode.textContent = formatDuration(probe.duration, "--:--");
        }

        maybeRenderDetailPanel();
        cleanup();
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

function createPlaylistRenderSignature() {
  return JSON.stringify({
    selectedPlaylistId: state.selectedPlaylistId,
    query: state.query,
    playlists: getPlaylistItems().map((playlist) => ({
      id: playlist.id,
      detail: playlist.detail,
      name: playlist.name
    })),
    editablePlaylists: state.playlists.map((playlist) => ({
      id: playlist.id,
      artworkUrl: playlist.artworkUrl || ""
    }))
  });
}

function createTrackListRenderSignature() {
  const visibleTracks = getVisibleTracks();
  const showArtistSearchResults = Boolean(state.query && !state.artistBrowse && state.artistSearchResults.length);
  const shouldRenderMessage = !visibleTracks.length || showArtistSearchResults || Boolean(state.artistBrowse);
  const sourceRevision = state.artistBrowse
    ? `artist:${state.artistBrowse.id || "unknown"}:${renderRevisions.artist}:${state.artistBrowse.activeReleaseId || ""}:${visibleTracks.length}`
    : state.query
      ? `search:${renderRevisions.search}:${visibleTracks.length}:${state.artistSearchResults.length}`
      : state.selectedPlaylistId === "liked-tracks"
        ? `liked:${renderRevisions.likes}:${visibleTracks.length}`
        : state.selectedPlaylistId === "all-tracks"
          ? `library:${renderRevisions.library}:${visibleTracks.length}`
          : `playlist:${state.selectedPlaylistId}:${renderRevisions.playlists}:${visibleTracks.length}`;
  return JSON.stringify({
    sourceRevision,
    selectedPlaylistId: state.selectedPlaylistId,
    selectedTrackKey: state.selectedTrackKey || "",
    query: state.query,
    isLoading: state.isLoading,
    message: shouldRenderMessage ? state.message : "",
    artistBrowseId: state.artistBrowse?.id || "",
    artistBrowseLoading: Boolean(state.artistBrowse?.isLoading),
    artistBrowseReleaseId: state.artistBrowse?.activeReleaseId || "",
    artistBrowseError: state.artistBrowse?.error || "",
    artistSearchCount: state.artistSearchResults.length
  });
}

function createNowPlayingSignature() {
  const currentTrack = getPlaybackTrack() || getSelectedTrack();
  return JSON.stringify({
    currentTrackKey: currentTrack?.key || "",
    currentTrackTitle: currentTrack?.title || "",
    currentTrackArtist: currentTrack?.artist || "",
    currentTrackArtwork: currentTrack?.artwork || "",
    liked: currentTrack ? isTrackLiked(currentTrack.key) : false,
    joinedSessionId: listenAlongState.joinedSessionId || "",
    shareOpen: Boolean(state.nowPlayingShareOpen),
    canInvite: canInviteCurrentTrackOnDiscord()
  });
}

function createTrackPaneHeaderSignature() {
  const visibleTracks = getVisibleTracks();
  return JSON.stringify({
    selectedPlaylistId: state.selectedPlaylistId,
    query: state.query,
    artistBrowseId: state.artistBrowse?.id || "",
    artistBrowseLoading: Boolean(state.artistBrowse?.isLoading),
    artistSearchCount: state.artistSearchResults.length,
    visibleTrackCount: visibleTracks.length,
    libraryTrackCount: state.libraryTracks.length,
    likedTrackCount: likedTracks.size,
    activePlaylistId: getActivePlaylist()?.id || ""
  });
}

function maybeRenderPlaylists() {
  const nextSignature = createPlaylistRenderSignature();
  if (nextSignature === lastPlaylistRenderSignature) {
    return;
  }

  renderPlaylists();
}

function maybeRenderTracks() {
  const nextSignature = createTrackListRenderSignature();
  if (nextSignature === lastTrackListRenderSignature) {
    return;
  }

  renderTracks();
}

function maybeRenderNowPlaying() {
  const nextSignature = createNowPlayingSignature();
  if (nextSignature === lastNowPlayingSignature) {
    return;
  }

  renderNowPlaying();
}

function maybeRenderTrackPaneHeader() {
  const nextSignature = createTrackPaneHeaderSignature();
  if (nextSignature === lastTrackPaneHeaderSignature) {
    return;
  }

  renderTrackPaneHeader();
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

function getListenAlongBridge() {
  return listenAlongBridge;
}

function getListenAlongSignalingBridge() {
  return listenAlongSignalingBridge;
}

function getActiveAudioElement() {
  return activePlaybackElement;
}

function hasActiveAudioSource() {
  return Boolean(audioPlayer.srcObject || audioPlayer.src);
}

function createListenAlongPeerId(prefix = "peer") {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

function allowDiscordListenAlongRequests() {
  return Boolean(state.settings.integrations.discord.allowListenAlongRequests);
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

function appendApolloTrackParams(url, track, { includeRemoteSources = true } = {}) {
  const trackId = buildApolloSharedTrackId(track);
  const source = includeRemoteSources ? buildTrackSourceLink(track) : "";
  if (!trackId) {
    return false;
  }

  url.searchParams.set("id", trackId);

  const inferredProvider = inferApolloSharedTrackProvider(trackId, source, "");
  const provider = String(track?.provider || "").trim().toLowerCase();
  if (provider && provider !== inferredProvider && provider !== "remote") {
    url.searchParams.set("provider", provider);
  }

  const derivedSource = buildApolloSharedTrackSource(trackId, provider || inferredProvider, source);
  if (source && (!derivedSource || derivedSource !== source)) {
    url.searchParams.set("src", source);
  }

  return true;
}

function appendApolloCompactLibraryParams(url, track) {
  const trackId = buildApolloSharedTrackId(track);
  if (!trackId) {
    return false;
  }

  url.searchParams.set("id", trackId);
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
  const deepLinkUrl = buildApolloTrackDeepLink(track);
  const libraryTrackId = getLibraryTrackId(track);
  if (libraryTrackId) {
    return buildApolloPublicLauncherLink(deepLinkUrl);
  }
  return "";
}

function buildApolloTrackDeepLink(track) {
  if (!track) {
    return "";
  }

  const url = new URL(`apollo://${APOLLO_DEEP_LINK_ROUTE_PLAY}`);
  const libraryTrackId = getLibraryTrackId(track);
  if (libraryTrackId) {
    appendApolloCompactLibraryParams(url, track);
  } else if (!appendApolloTrackParams(url, track)) {
    return "";
  }
  const deepLinkUrl = url.toString();
  return deepLinkUrl.length <= 2048 ? deepLinkUrl : "";
}

function buildApolloPublicLauncherLink(targetUrl) {
  if (!targetUrl || !canUsePublicApolloLauncherUrl()) {
    return "";
  }

  return buildApolloLauncherUrl(targetUrl);
}

function generateListenAlongSessionId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `apollo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateListenAlongToken() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `token-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getLibraryTrackId(track) {
  return String(track?.trackId || (track?.resultSource === "library" ? track?.id : "") || resolveTrackLibraryId(track) || "").trim();
}

function resetPublishedListenAlongSession() {
  listenAlongState.publishedSessionId = "";
  listenAlongState.publishedSessionToken = "";
  listenAlongState.publishedTrackId = "";
}

function getListenAlongAdvertisedHosts() {
  const hosts = Array.isArray(state.listenAlong.advertisedHosts)
    ? state.listenAlong.advertisedHosts
    : [];

  const seen = new Set();
  const ordered = [];
  hosts.forEach((value) => {
    const host = String(value || "").trim();
    if (!host || seen.has(host)) {
      return;
    }

    seen.add(host);
    if (!LOCAL_DISCORD_HOSTNAMES.has(host.toLowerCase())) {
      ordered.push(host);
    }
  });

  hosts.forEach((value) => {
    const host = String(value || "").trim();
    if (!host || seen.has(`loopback:${host}`)) {
      return;
    }

    if (LOCAL_DISCORD_HOSTNAMES.has(host.toLowerCase())) {
      seen.add(`loopback:${host}`);
      ordered.push(host);
    }
  });

  return ordered.slice(0, 4);
}

function canPublishListenAlongInvite() {
  return Boolean(state.listenAlongSignaling.available);
}

function confirmListenAlongJoin() {
  return openConfirmModal({
    title: "Join listen along",
    message: LISTEN_ALONG_JOIN_WARNING,
    confirmLabel: "Join session"
  });
}

function confirmListenAlongHostShare() {
  return openConfirmModal({
    title: "Share listen along",
    message: LISTEN_ALONG_HOST_WARNING,
    confirmLabel: "Share session"
  });
}

async function ensureAutomaticListenAlongExposureConsent() {
  if (listenAlongAutomaticExposureConsent) {
    return true;
  }

  if (hasPromptedListenAlongAutomaticExposure) {
    return false;
  }

  hasPromptedListenAlongAutomaticExposure = true;
  listenAlongAutomaticExposureConsent = await confirmListenAlongHostShare();
  return listenAlongAutomaticExposureConsent;
}

function buildApolloListenAlongLink(sessionInfo) {
  if (!sessionInfo?.sessionId || !sessionInfo?.token || !canPublishListenAlongInvite()) {
    return "";
  }

  const url = new URL(`apollo://${APOLLO_DEEP_LINK_ROUTE_LISTEN}`);
  url.searchParams.set("session", sessionInfo.sessionId);
  url.searchParams.set("token", sessionInfo.token);

  const advertisedHosts = getListenAlongAdvertisedHosts().slice(0, 2);
  const listenAlongPort = Number(state.listenAlong.port) > 0 ? String(state.listenAlong.port) : "";
  if (listenAlongPort && advertisedHosts.length) {
    url.searchParams.set("port", listenAlongPort);
    advertisedHosts.forEach((host) => {
      url.searchParams.append("host", host);
    });
  }

  const compactUrl = url.toString();
  return compactUrl.length <= 256 ? compactUrl : "";
}

function buildApolloListenAlongButtonUrl(sessionInfo) {
  return buildApolloPublicLauncherLink(buildApolloListenAlongLink(sessionInfo));
}

function createListenAlongRtcConfiguration() {
  return {
    iceServers: [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302"
        ]
      }
    ]
  };
}

function getListenAlongSignalToken(sessionId = "") {
  const resolvedSessionId = String(sessionId || "").trim();
  if (!resolvedSessionId) {
    return "";
  }

  if (resolvedSessionId === listenAlongState.publishedSessionId) {
    return String(listenAlongState.publishedSessionToken || "").trim();
  }

  if (resolvedSessionId === listenAlongState.joinedSessionId) {
    return String(listenAlongState.joinedSessionToken || "").trim();
  }

  return "";
}

function normaliseListenAlongSignalValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normaliseListenAlongSignalValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter((key) => key !== "auth")
      .sort()
      .reduce((result, key) => {
        result[key] = normaliseListenAlongSignalValue(value[key]);
        return result;
      }, {});
  }

  return value ?? null;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function signListenAlongSignalPayload(sessionId, sessionToken, payload = {}) {
  if (!sessionToken) {
    throw new Error("Listen along session token is unavailable.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionToken),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const body = JSON.stringify({
    sessionId: String(sessionId || "").trim(),
    payload: normaliseListenAlongSignalValue(payload)
  });
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return toHex(signature);
}

async function createListenAlongSignalEnvelope(sessionId, payload = {}) {
  const sessionToken = getListenAlongSignalToken(sessionId);
  const signature = await signListenAlongSignalPayload(sessionId, sessionToken, payload);
  return {
    ...payload,
    auth: {
      version: 1,
      signature
    }
  };
}

async function verifyListenAlongSignalEnvelope(sessionId, payload = {}) {
  const sessionToken = getListenAlongSignalToken(sessionId);
  const signature = String(payload?.auth?.signature || "").trim();
  if (!sessionToken || !signature) {
    return false;
  }

  const unsignedPayload = {
    ...payload
  };
  delete unsignedPayload.auth;
  const expectedSignature = await signListenAlongSignalPayload(sessionId, sessionToken, unsignedPayload);
  return expectedSignature === signature;
}

async function ensureListenAlongSignalRoom(sessionId) {
  const bridge = getListenAlongSignalingBridge();
  if (!bridge?.available) {
    throw new Error("Listen along signaling is unavailable.");
  }

  await bridge.connectRoom(sessionId);
  listenAlongRtc.signalingSubscribedRooms.add(sessionId);
}

async function disconnectListenAlongSignalRoom(sessionId) {
  const bridge = getListenAlongSignalingBridge();
  const resolvedSessionId = String(sessionId || "").trim();
  if (!bridge?.available || !resolvedSessionId) {
    return;
  }

  listenAlongRtc.signalingSubscribedRooms.delete(resolvedSessionId);
  await bridge.disconnectRoom(resolvedSessionId);
}

async function publishListenAlongSignal(sessionId, payload = {}) {
  const bridge = getListenAlongSignalingBridge();
  if (!bridge?.available) {
    throw new Error("Listen along signaling is unavailable.");
  }

  await ensureListenAlongSignalRoom(sessionId);
  const envelope = await createListenAlongSignalEnvelope(sessionId, payload);
  await bridge.publish(sessionId, envelope);
}

function clearListenAlongJoinTimeout() {
  if (listenAlongRtc.pendingJoinTimeoutHandle) {
    window.clearTimeout(listenAlongRtc.pendingJoinTimeoutHandle);
    listenAlongRtc.pendingJoinTimeoutHandle = 0;
  }
}

function stopListenAlongSnapshotInterval() {
  if (listenAlongRtc.snapshotIntervalHandle) {
    window.clearInterval(listenAlongRtc.snapshotIntervalHandle);
    listenAlongRtc.snapshotIntervalHandle = 0;
  }
}

function buildListenAlongPlaybackSnapshot() {
  const currentTrack = getPlaybackTrack();
  if (!currentTrack) {
    return null;
  }

  return {
    type: "snapshot",
    trackId: getLibraryTrackId(currentTrack) || String(currentTrack.id || currentTrack.key),
    title: currentTrack.title || "Unknown Title",
    artist: currentTrack.artist || "Unknown Artist",
    album: currentTrack.album || "",
    artwork: currentTrack.artwork || "",
    status: getPlaybackStatusKind() === "paused" ? "paused" : "playing",
    positionSeconds: Math.max(0, Number(audioPlayer.currentTime) || 0),
    durationSeconds: Math.max(0, Number(audioPlayer.duration || getCachedDuration(currentTrack) || 0)),
    playbackRate: Math.max(0.25, Number(audioPlayer.playbackRate) || 1),
    capturedAt: Date.now()
  };
}

function sendListenAlongSnapshot() {
  if (!listenAlongRtc.hostDataChannel || listenAlongRtc.hostDataChannel.readyState !== "open") {
    return;
  }

  const snapshot = buildListenAlongPlaybackSnapshot();
  if (!snapshot) {
    return;
  }

  listenAlongRtc.latestSnapshot = snapshot;
  listenAlongRtc.hostDataChannel.send(JSON.stringify(snapshot));
}

function startListenAlongSnapshotInterval() {
  stopListenAlongSnapshotInterval();
  listenAlongRtc.snapshotIntervalHandle = window.setInterval(() => {
    sendListenAlongSnapshot();
  }, 1000);
}

function getListenAlongCaptureStream() {
  if (typeof audioPlayer.captureStream === "function") {
    return audioPlayer.captureStream();
  }

  if (typeof audioPlayer.mozCaptureStream === "function") {
    return audioPlayer.mozCaptureStream();
  }

  throw new Error("This build cannot capture playback audio for listen along.");
}

function closePeerConnection(connection) {
  if (!connection) {
    return;
  }

  try {
    connection.onicecandidate = null;
    connection.onconnectionstatechange = null;
    connection.ondatachannel = null;
    connection.ontrack = null;
    connection.close();
  } catch {
    // Ignore close failures.
  }
}

async function stopHostedListenAlongSession({ keepRoom = false } = {}) {
  stopListenAlongSnapshotInterval();
  if (listenAlongRtc.hostDataChannel) {
    try {
      listenAlongRtc.hostDataChannel.close();
    } catch {
      // Ignore channel close failures.
    }
  }
  listenAlongRtc.hostDataChannel = null;
  listenAlongRtc.hostRemotePeerId = "";
  closePeerConnection(listenAlongRtc.hostPeerConnection);
  listenAlongRtc.hostPeerConnection = null;

  if (!keepRoom && listenAlongState.publishedSessionId) {
    await disconnectListenAlongSignalRoom(listenAlongState.publishedSessionId).catch(() => {});
  }
}

async function resetJoinedListenAlongPeer({ keepRoom = false } = {}) {
  clearListenAlongJoinTimeout();
  if (listenAlongRtc.joinDataChannel) {
    try {
      listenAlongRtc.joinDataChannel.close();
    } catch {
      // Ignore channel close failures.
    }
  }
  listenAlongRtc.joinDataChannel = null;
  closePeerConnection(listenAlongRtc.joinPeerConnection);
  listenAlongRtc.joinPeerConnection = null;
  listenAlongRtc.joinHostPeerId = "";
  listenAlongRtc.latestSnapshot = null;

  if (audioPlayer.srcObject) {
    try {
      audioPlayer.pause();
    } catch {
      // Ignore pause failures.
    }
    audioPlayer.srcObject = null;
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
  }

  if (!keepRoom && listenAlongState.joinedSessionId) {
    await disconnectListenAlongSignalRoom(listenAlongState.joinedSessionId).catch(() => {});
  }
}

function createTrackFromListenAlongSnapshot(snapshot) {
  const trackId = String(snapshot?.trackId || "").trim() || `${snapshot?.title || "listen"}:${snapshot?.artist || "along"}`;
  return normaliseRemoteTrack({
    id: trackId,
    provider: "listen-along",
    title: snapshot?.title || "Unknown Title",
    artist: snapshot?.artist || "Unknown Artist",
    album: snapshot?.album || "",
    artwork: snapshot?.artwork || "",
    duration: Number(snapshot?.durationSeconds) || null,
    metadataSource: "listen-along",
    requestedProvider: "listen-along",
    listenAlongSessionId: listenAlongState.joinedSessionId || "",
    listenAlongTrackId: trackId
  });
}

function applyJoinedListenAlongSnapshot(snapshot, { initial = false } = {}) {
  if (!snapshot) {
    return;
  }

  listenAlongRtc.latestSnapshot = snapshot;
  const track = createTrackFromListenAlongSnapshot(snapshot);
  durationCache.set(track.key, Number(snapshot.durationSeconds) || 0);
  state.transientPlaybackTrack = track;
  state.playbackTrackKey = track.key;
  state.selectedTrackKey = track.key;
  state.isBuffering = false;
  state.isPlaying = snapshot.status === "playing";
  persistPlaybackState();

  if (initial) {
    state.message = snapshot.status === "playing"
      ? `Joined ${track.title}.`
      : `Opened ${track.title} from listen along.`;
  }

  renderPlaybackUi({
    includeTracks: true,
    includeDetail: true
  });
}

async function applyJoinedListenAlongRemoteStream(stream) {
  if (!stream) {
    return;
  }

  cancelPendingPlaybackStart({
    keepMessage: true
  });
  audioPlayer.pause();
  audioPlayer.srcObject = stream;
  audioPlayer.removeAttribute("src");
  try {
    await audioPlayer.play();
  } catch {
    // Autoplay can fail until a user gesture; keep the session connected.
  }
}

function setupListenAlongHostDataChannel(channel) {
  listenAlongRtc.hostDataChannel = channel;
  channel.onopen = () => {
    sendListenAlongSnapshot();
    startListenAlongSnapshotInterval();
  };
  channel.onclose = () => {
    stopListenAlongSnapshotInterval();
    listenAlongRtc.hostDataChannel = null;
  };
  channel.onerror = () => {
    stopListenAlongSnapshotInterval();
  };
}

function setupListenAlongJoinDataChannel(channel) {
  listenAlongRtc.joinDataChannel = channel;
  channel.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data || ""));
      if (payload?.type === "snapshot") {
        applyJoinedListenAlongSnapshot(payload, {
          initial: !listenAlongRtc.latestSnapshot
        });
      }
    } catch {
      // Ignore malformed session messages.
    }
  };
  channel.onopen = () => {
    clearListenAlongJoinTimeout();
  };
  channel.onclose = () => {
    listenAlongRtc.joinDataChannel = null;
  };
}

async function createHostedListenAlongPeer(remotePeerId) {
  await stopHostedListenAlongSession({
    keepRoom: true
  });

  const connection = new RTCPeerConnection(createListenAlongRtcConfiguration());
  listenAlongRtc.hostPeerConnection = connection;
  listenAlongRtc.hostRemotePeerId = remotePeerId;

  const captureStream = getListenAlongCaptureStream();
  captureStream.getTracks().forEach((track) => {
    connection.addTrack(track, captureStream);
  });

  connection.onicecandidate = (event) => {
    if (!event.candidate || !listenAlongState.publishedSessionId || !listenAlongRtc.hostRemotePeerId) {
      return;
    }

    void publishListenAlongSignal(listenAlongState.publishedSessionId, {
      type: "signal",
      senderId: state.clientId,
      recipientId: listenAlongRtc.hostRemotePeerId,
      candidate: event.candidate.toJSON()
    }).catch(() => {});
  };

  connection.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
      void stopHostedListenAlongSession({
        keepRoom: true
      });
    }
  };

  const channel = connection.createDataChannel(LISTEN_ALONG_SIGNAL_CHANNEL_NAME);
  setupListenAlongHostDataChannel(channel);

  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  await publishListenAlongSignal(listenAlongState.publishedSessionId, {
    type: "signal",
    senderId: state.clientId,
    recipientId: remotePeerId,
    description: connection.localDescription?.toJSON?.() || connection.localDescription
  });
}

async function ensureJoinedListenAlongPeer(hostPeerId) {
  if (listenAlongRtc.joinPeerConnection && listenAlongRtc.joinHostPeerId === hostPeerId) {
    return listenAlongRtc.joinPeerConnection;
  }

  await resetJoinedListenAlongPeer({
    keepRoom: true
  });

  const connection = new RTCPeerConnection(createListenAlongRtcConfiguration());
  listenAlongRtc.joinPeerConnection = connection;
  listenAlongRtc.joinHostPeerId = hostPeerId;
  if (!listenAlongRtc.joinPeerId) {
    listenAlongRtc.joinPeerId = createListenAlongPeerId("join");
  }

  connection.onicecandidate = (event) => {
    if (!event.candidate || !listenAlongState.joinedSessionId || !listenAlongRtc.joinPeerId) {
      return;
    }

    void publishListenAlongSignal(listenAlongState.joinedSessionId, {
      type: "signal",
      senderId: listenAlongRtc.joinPeerId,
      recipientId: hostPeerId,
      candidate: event.candidate.toJSON()
    }).catch(() => {});
  };

  connection.ondatachannel = (event) => {
    setupListenAlongJoinDataChannel(event.channel);
  };

  connection.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) {
      void applyJoinedListenAlongRemoteStream(stream);
    }
  };

  connection.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(connection.connectionState)) {
      void leaveJoinedListenAlongSession();
    }
  };

  return connection;
}

async function ensureHostedListenAlongSession(track = getPlaybackTrack(), { force = false } = {}) {
  if (!track || !allowDiscordListenAlongRequests() || (!force && !listenAlongAutomaticExposureConsent)) {
    return null;
  }

  const sessionInfo = getActiveListenAlongSession(track);
  if (!sessionInfo?.sessionId) {
    return null;
  }

  await ensureListenAlongSignalRoom(sessionInfo.sessionId);
  return sessionInfo;
}

async function handleListenAlongJoinRequest(sessionId, senderId) {
  if (
    !sessionId
    || sessionId !== listenAlongState.publishedSessionId
    || !senderId
    || senderId === state.clientId
  ) {
    return;
  }

  if (listenAlongRtc.hostRemotePeerId && listenAlongRtc.hostRemotePeerId !== senderId) {
    await publishListenAlongSignal(sessionId, {
      type: "busy",
      senderId: state.clientId,
      recipientId: senderId
    }).catch(() => {});
    return;
  }

  await createHostedListenAlongPeer(senderId);
}

async function handleListenAlongSignalDescription(sessionId, payload) {
  if (payload.recipientId === state.clientId && payload.description?.type === "answer" && listenAlongRtc.hostPeerConnection) {
    await listenAlongRtc.hostPeerConnection.setRemoteDescription(payload.description);
    return;
  }

  if (payload.recipientId === listenAlongRtc.joinPeerId && payload.description?.type === "offer") {
    const connection = await ensureJoinedListenAlongPeer(payload.senderId);
    await connection.setRemoteDescription(payload.description);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await publishListenAlongSignal(sessionId, {
      type: "signal",
      senderId: listenAlongRtc.joinPeerId,
      recipientId: payload.senderId,
      description: connection.localDescription?.toJSON?.() || connection.localDescription
    });
  }
}

async function handleListenAlongSignalCandidate(payload) {
  if (payload.recipientId === state.clientId && listenAlongRtc.hostPeerConnection) {
    await listenAlongRtc.hostPeerConnection.addIceCandidate(payload.candidate);
    return;
  }

  if (payload.recipientId === listenAlongRtc.joinPeerId && listenAlongRtc.joinPeerConnection) {
    await listenAlongRtc.joinPeerConnection.addIceCandidate(payload.candidate);
  }
}

async function handleListenAlongSignalEvent({ sessionId, payload }) {
  if (!payload?.type || !sessionId) {
    return;
  }

  const isTrusted = await verifyListenAlongSignalEnvelope(sessionId, payload);
  if (!isTrusted) {
    logClient("listen-along", "discarded unauthenticated signal", {
      sessionId,
      type: payload?.type || ""
    });
    return;
  }

  if (payload.type === "join-request") {
    await handleListenAlongJoinRequest(sessionId, payload.senderId);
    return;
  }

  if (payload.type === "busy" && payload.recipientId === listenAlongRtc.joinPeerId) {
    clearListenAlongJoinTimeout();
    state.message = "This listen along session already has an active listener.";
    renderStatus();
    return;
  }

  if (payload.type === "signal") {
    if (payload.description) {
      await handleListenAlongSignalDescription(sessionId, payload);
    } else if (payload.candidate) {
      await handleListenAlongSignalCandidate(payload);
    }
  }
}

function buildTrackSourceLink(track) {
  return String(track?.sourceUrl || track?.externalUrl || track?.downloadTarget || "").trim();
}

function buildApolloSharedTrackId(track) {
  const providerIds = normaliseProviderIds(track?.providerIds);
  for (const key of APOLLO_SHAREABLE_PROVIDER_ID_KEYS) {
    const value = String(providerIds?.[key] || "").trim();
    if (value) {
      return `${key}:${value}`;
    }
  }

  const rawId = String(track?.id || track?.trackId || track?.key || "").trim();
  if (!rawId) {
    return "";
  }

  if (rawId.includes(":")) {
    return rawId;
  }

  const provider = String(track?.provider || "").trim().toLowerCase();
  if (!provider || provider === "remote") {
    const libraryTrackId = getLibraryTrackId(track);
    return libraryTrackId ? `library:${libraryTrackId}` : rawId;
  }

  return `${provider}:${rawId}`;
}

function inferApolloSharedTrackProvider(trackId, sourceUrl = "", fallbackProvider = "remote") {
  const idPrefix = String(trackId || "").trim().match(/^([a-z0-9-]+):/i)?.[1]?.toLowerCase() || "";
  if (idPrefix === "library") {
    return "library";
  }

  if (idPrefix && idPrefix !== "link" && [...PROVIDER_ID_KEYS, "deezer"].includes(idPrefix)) {
    return idPrefix;
  }

  const trimmedSource = String(sourceUrl || "").trim();
  if (!trimmedSource) {
    return fallbackProvider;
  }

  if (/^ytsearch\d*:/i.test(trimmedSource)) {
    return "youtube";
  }

  try {
    const parsedSource = new URL(trimmedSource);
    const hostname = parsedSource.hostname.toLowerCase();
    if (hostname.includes("spotify")) {
      return "spotify";
    }
    if (hostname.includes("youtube") || hostname === "youtu.be") {
      return "youtube";
    }
    if (hostname.includes("soundcloud")) {
      return "soundcloud";
    }
    if (hostname.includes("deezer")) {
      return "deezer";
    }
    if (hostname.includes("itunes") || hostname.includes("apple.com")) {
      return "itunes";
    }
  } catch {
    // Ignore invalid source URLs and fall back to the provided/default provider.
  }

  return fallbackProvider;
}

function buildApolloSharedTrackSource(trackId, provider = "", fallbackSource = "") {
  const trimmedTrackId = String(trackId || "").trim();
  const effectiveProvider = String(provider || inferApolloSharedTrackProvider(trimmedTrackId, fallbackSource, "")).trim().toLowerCase();
  const providerScopedId = trimmedTrackId.includes(":")
    ? trimmedTrackId.slice(trimmedTrackId.indexOf(":") + 1)
    : trimmedTrackId;
  const rawId = providerScopedId.trim();
  if (!rawId) {
    return String(fallbackSource || "").trim();
  }

  if (effectiveProvider === "deezer") {
    return `https://www.deezer.com/track/${rawId}`;
  }

  if (effectiveProvider === "spotify") {
    return `https://open.spotify.com/track/${rawId}`;
  }

  if (effectiveProvider === "youtube") {
    return `https://www.youtube.com/watch?v=${rawId}`;
  }

  if (effectiveProvider === "itunes" && /^\d+$/.test(rawId)) {
    return `https://music.apple.com/us/song/${rawId}`;
  }

  return String(fallbackSource || "").trim();
}

function isApolloSharedTrackMetadataMissing(track) {
  return !track || (
    String(track.title || "").trim() === ""
    || String(track.title || "").trim() === "Unknown Title"
    || String(track.artist || "").trim() === ""
    || String(track.artist || "").trim() === "Unknown Artist"
  );
}

async function hydrateApolloSharedTrack(track) {
  if (!track || track.provider === "library" || !isApolloSharedTrackMetadataMissing(track)) {
    return track;
  }

  const sharedTrackId = buildApolloSharedTrackId(track) || String(track.id || "").trim();
  const sourceUrl = buildTrackSourceLink(track) || buildApolloSharedTrackSource(sharedTrackId, track.provider, "");
  if (!sourceUrl) {
    return track;
  }

  try {
    const resolvedTrack = await requestJson("/api/resolve-shared-track", {
      method: "POST",
      body: JSON.stringify({
        id: sharedTrackId
      })
    });

    return resolvedTrack?.provider === "library" || resolvedTrack?.trackId
      ? normaliseLibraryTrack(resolvedTrack)
      : normaliseRemoteTrack(resolvedTrack);
  } catch {
    // Fall back to source inspection for older servers that do not expose shared-track resolution yet.
  }

  try {
    const metadata = await requestJson("/api/inspect-link", {
      method: "POST",
      body: JSON.stringify({
        url: sourceUrl
      })
    });

    return normaliseRemoteTrack({
      id: sharedTrackId || track.id || metadata?.id || `${metadata?.provider || track.provider || "remote"}:${sourceUrl}`,
      provider: metadata?.provider || track.provider || inferApolloSharedTrackProvider(track.id, sourceUrl),
      title: metadata?.title || track.title,
      artist: metadata?.artist || track.artist,
      artists: metadata?.artists || track.artists,
      album: metadata?.album || track.album,
      albumArtist: metadata?.albumArtist || track.albumArtist,
      trackNumber: metadata?.trackNumber || track.trackNumber,
      discNumber: metadata?.discNumber || track.discNumber,
      duration: metadata?.duration || track.duration,
      releaseDate: metadata?.releaseDate || track.releaseDate,
      releaseYear: metadata?.releaseYear || track.releaseYear,
      genre: metadata?.genre || track.genre,
      explicit: metadata?.explicit ?? track.explicit,
      artwork: metadata?.artwork || track.artwork,
      providerIds: metadata?.providerIds || track.providerIds,
      isrc: metadata?.isrc || track.isrc,
      sourcePlatform: metadata?.sourcePlatform || track.sourcePlatform,
      sourceUrl: metadata?.sourceUrl || track.sourceUrl || sourceUrl,
      externalUrl: metadata?.externalUrl || track.externalUrl || (sourceUrl.startsWith("http") ? sourceUrl : ""),
      downloadTarget: track.downloadTarget || metadata?.downloadTarget || metadata?.externalUrl || sourceUrl,
      metadataSource: metadata?.metadataSource || track.metadataSource || "apollo-link",
      requestedProvider: track.requestedProvider || ""
    });
  } catch {
    return track;
  }
}

function buildShareableListenAlongLink(track = getPlaybackTrack()) {
  const playbackTrack = getPlaybackTrack();
  if (!track || !playbackTrack || playbackTrack.key !== track.key || !allowDiscordListenAlongRequests()) {
    return "";
  }

  const sessionInfo = getActiveListenAlongSession(track);
  if (!sessionInfo?.sessionId) {
    return "";
  }

  return buildApolloListenAlongButtonUrl(sessionInfo) || buildApolloListenAlongLink(sessionInfo);
}

async function ensureListenAlongInviteLink(track = getPlaybackTrack()) {
  const playbackTrack = getPlaybackTrack();
  if (!track || !playbackTrack || playbackTrack.key !== track.key) {
    return "";
  }

  const sessionInfo = getActiveListenAlongSession(track);
  if (!sessionInfo?.sessionId) {
    return "";
  }

  if (!await confirmListenAlongHostShare()) {
    return null;
  }

  if (canPublishListenAlongInvite() && !listenAlongState.joinedSessionId) {
    await ensureHostedListenAlongSession(track, {
      force: true
    });
  }

  return buildApolloListenAlongButtonUrl(sessionInfo) || buildApolloListenAlongLink(sessionInfo);
}

function stopJoinedListenAlongSession() {
  void resetJoinedListenAlongPeer({
    keepRoom: false
  });
  listenAlongState.joinedSessionId = "";
  listenAlongState.joinedSessionToken = "";
  listenAlongState.joinedTrackId = "";
  listenAlongState.joinedPeerBaseUrl = "";
  listenAlongState.joinedPeerCandidates = [];
  listenAlongState.pollInFlight = false;
  listenAlongRtc.joinPeerId = "";
}

async function leaveJoinedListenAlongSession() {
  if (!listenAlongState.joinedSessionId) {
    return false;
  }

  await resetJoinedListenAlongPeer({
    keepRoom: false
  });
  stopJoinedListenAlongSession();
  state.message = "Left listen along.";
  state.transientPlaybackTrack = null;
  state.playbackTrackKey = null;
  state.isPlaying = false;
  state.isBuffering = false;
  renderStatus();
  renderPlaybackUi({
    includeTracks: true,
    includeDetail: true
  });
  syncDiscordPresence();
  return true;
}

function getActiveListenAlongSession(track) {
  const trackId = getLibraryTrackId(track);
  if (!trackId) {
    return null;
  }

  if (listenAlongState.joinedSessionId && listenAlongState.joinedTrackId === trackId) {
    return {
      sessionId: listenAlongState.joinedSessionId,
      token: listenAlongState.joinedSessionToken || ""
    };
  }

  if (listenAlongState.publishedTrackId && listenAlongState.publishedTrackId !== trackId) {
    listenAlongState.publishedSessionId = "";
    listenAlongState.publishedSessionToken = "";
  }

  if (!listenAlongState.publishedSessionId) {
    listenAlongState.publishedSessionId = generateListenAlongSessionId();
    listenAlongState.publishedSessionToken = generateListenAlongToken();
  }

  listenAlongState.publishedTrackId = trackId;
  return {
    sessionId: listenAlongState.publishedSessionId,
    token: listenAlongState.publishedSessionToken
  };
}

function buildListenAlongPeerCandidates(hosts = [], port = "") {
  const normalisedPort = Number(port) > 0 ? String(port) : "";
  if (!normalisedPort) {
    return [];
  }

  const seen = new Set();
  return hosts
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((host) => `http://${host}:${normalisedPort}`)
    .filter((baseUrl) => {
      if (seen.has(baseUrl)) {
        return false;
      }

      seen.add(baseUrl);
      return true;
    });
}

async function fetchPeerListenAlongSession(sessionId, sessionToken, peerBaseUrl) {
  const sessionUrl = new URL(`/session/${encodeURIComponent(sessionId)}`, `${peerBaseUrl}/`);
  if (sessionToken) {
    sessionUrl.searchParams.set("token", sessionToken);
  }

  const response = await fetch(sessionUrl.toString(), {
    method: "GET"
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Listen along host returned ${response.status}.`);
  }

  return response.json();
}

async function fetchListenAlongSession(sessionId, { sessionToken = "", peerCandidates = [], preferredPeerBaseUrl = "" } = {}) {
  const candidates = [
    preferredPeerBaseUrl,
    ...peerCandidates
  ].filter(Boolean);

  let lastError = null;
  for (const peerBaseUrl of candidates) {
    try {
      const session = await fetchPeerListenAlongSession(sessionId, sessionToken, peerBaseUrl);
      return {
        session,
        peerBaseUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (!candidates.length) {
    throw new Error("This listen along invite does not include a reachable host. Ask the host to copy a fresh invite.");
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Unable to reach the listen along host.");
}

async function publishListenAlongSession(track, payload, sessionInfo) {
  if (!sessionInfo?.sessionId || !sessionInfo?.token || listenAlongState.joinedSessionId) {
    return;
  }

  const trackId = getLibraryTrackId(track);
  const bridge = getListenAlongBridge();
  if (!trackId || !bridge?.available || !canPublishListenAlongInvite()) {
    return;
  }

  const sourceStreamUrl = await resolvePlaybackUrl(track);
  const nextState = await bridge.publishSession({
    sessionId: sessionInfo.sessionId,
    token: sessionInfo.token,
    trackId,
    title: track.title || "Unknown Title",
    artist: track.artist || "Unknown Artist",
    album: track.album || "",
    artwork: track.artwork || "",
    durationSeconds: payload.duration || 0,
    status: payload.status === "playing" ? "playing" : "paused",
    positionSeconds: payload.currentTime || 0,
    playbackRate: payload.playbackRate || 1,
    capturedAt: Date.now(),
    sourceStreamUrl
  });
  applyListenAlongBridgeState(nextState);
}

async function clearPublishedListenAlongSession() {
  const sessionId = listenAlongState.publishedSessionId;
  if (!sessionId) {
    return;
  }

  await stopHostedListenAlongSession({
    keepRoom: false
  }).catch(() => {});
  resetPublishedListenAlongSession();
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
    const sessionToken = parsedUrl.searchParams.get("token") || "";
    const peerPort = parsedUrl.searchParams.get("port") || "";
    const peerHosts = parsedUrl.searchParams.getAll("host");
    const sourceParam =
      parsedUrl.searchParams.get("src")
      || parsedUrl.searchParams.get("externalUrl")
      || parsedUrl.searchParams.get("downloadTarget")
      || "";
    const sharedTrackId = parsedUrl.searchParams.get("id") || "";
    const trackIdParam = parsedUrl.searchParams.get("trackId") || "";
    const remoteTrackId = sharedTrackId || "";
    const hasRemotePayload = Boolean(
      sourceParam
      || parsedUrl.searchParams.get("provider")
      || parsedUrl.searchParams.get("externalUrl")
      || parsedUrl.searchParams.get("downloadTarget")
      || parsedUrl.searchParams.get("title")
      || parsedUrl.searchParams.get("artist")
      || parsedUrl.searchParams.get("album")
      || parsedUrl.searchParams.get("artwork")
    );
    const inferredProvider = inferApolloSharedTrackProvider(remoteTrackId, sourceParam);
    const provider = parsedUrl.searchParams.get("provider")
      || (trackIdParam && !hasRemotePayload
        ? "library"
        : inferredProvider);
    const resolvedSource = sourceParam || buildApolloSharedTrackSource(remoteTrackId, provider, "");
    const title = parsedUrl.searchParams.get("title") || "Unknown Title";
    const artist = parsedUrl.searchParams.get("artist") || "Unknown Artist";
    const album = parsedUrl.searchParams.get("album") || "";
    const artwork = parsedUrl.searchParams.get("artwork") || "";
    const peerCandidates = buildListenAlongPeerCandidates(peerHosts, peerPort);

    if (route === APOLLO_DEEP_LINK_ROUTE_LISTEN && sessionId && !sharedTrackId && !trackIdParam) {
      return {
        route,
        sessionId,
        sessionToken,
        peerCandidates,
        track: null,
        playback: null
      };
    }

    if (provider === "library") {
      const trackId = trackIdParam || (
        remoteTrackId.startsWith("library:")
          ? remoteTrackId.slice("library:".length)
          : ""
      );
      if (!trackId) {
        return null;
      }

      return {
        route,
        sessionId,
        sessionToken,
        peerCandidates,
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
      sessionToken,
      peerCandidates,
      track: normaliseRemoteTrack({
        id: remoteTrackId || `${provider}:${title}:${artist}`,
        provider,
        title,
        artist,
        album,
        artwork,
        externalUrl: parsedUrl.searchParams.get("externalUrl") || (resolvedSource.startsWith("http") ? resolvedSource : ""),
        downloadTarget: parsedUrl.searchParams.get("downloadTarget") || resolvedSource || parsedUrl.searchParams.get("externalUrl") || "",
        metadataSource: "apollo-link"
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

function getListenAlongComparableTrackId(track) {
  return String(track?.listenAlongTrackId || getLibraryTrackId(track) || track?.id || "").trim();
}

function createListenAlongTrack(session, sessionId = "") {
  const sessionTrackId = String(session?.trackId || "").trim();
  if (session?.streamUrl) {
    return normaliseRemoteTrack({
      id: sessionTrackId || `${sessionId || "listen"}:${session.title || "track"}`,
      provider: "listen-along",
      title: session.title || "Unknown Title",
      artist: session.artist || "Unknown Artist",
      album: session.album || "",
      artwork: session.artwork || "",
      duration: Number(session.durationSeconds) || null,
      externalUrl: session.streamUrl,
      downloadTarget: "",
      playbackUrl: session.streamUrl,
      metadataSource: "listen-along",
      requestedProvider: "listen-along",
      listenAlongSessionId: sessionId || session?.sessionId || "",
      listenAlongTrackId: sessionTrackId
    });
  }

  return normaliseLibraryTrack({
    id: sessionTrackId,
    trackId: sessionTrackId,
    title: session.title || "Unknown Title",
    artist: session.artist || "Unknown Artist",
    album: session.album || "",
    artwork: session.artwork || ""
  });
}

async function applyListenAlongSessionSnapshot(session, { initial = false, sessionId = "" } = {}) {
  const sessionTrackId = String(session?.trackId || "").trim();
  if (!sessionTrackId) {
    return false;
  }

  const track = createListenAlongTrack(session, sessionId);
  const currentTrack = getPlaybackTrack();
  const currentTrackId = getListenAlongComparableTrackId(currentTrack);
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
    const { session, peerBaseUrl } = await fetchListenAlongSession(listenAlongState.joinedSessionId, {
      sessionToken: listenAlongState.joinedSessionToken,
      peerCandidates: listenAlongState.joinedPeerCandidates,
      preferredPeerBaseUrl: listenAlongState.joinedPeerBaseUrl
    });
    if (peerBaseUrl) {
      listenAlongState.joinedPeerBaseUrl = peerBaseUrl;
    }

    if (!session?.trackId) {
      stopJoinedListenAlongSession();
      return;
    }

    await applyListenAlongSessionSnapshot(session, {
      sessionId: listenAlongState.joinedSessionId
    });
  } catch (error) {
    if (/404/i.test(String(error?.message || ""))) {
      stopJoinedListenAlongSession();
      state.message = "The listen along session ended.";
      renderStatus();
    } else if (!listenAlongState.joinedPeerBaseUrl && !listenAlongState.joinedPeerCandidates.length) {
      state.message = "This listen along link is missing peer connection details.";
      renderStatus();
    }
  } finally {
    listenAlongState.pollInFlight = false;
  }
}

function startJoinedListenAlongPolling(sessionId, { sessionToken = "", peerCandidates = [], peerBaseUrl = "" } = {}) {
  stopJoinedListenAlongSession();
  listenAlongState.joinedSessionId = sessionId;
  listenAlongState.joinedSessionToken = sessionToken;
  listenAlongState.joinedPeerBaseUrl = peerBaseUrl;
  listenAlongState.joinedPeerCandidates = [...peerCandidates];
  listenAlongState.pollHandle = window.setInterval(() => {
    void refreshJoinedListenAlongSession();
  }, DISCORD_LISTEN_SESSION_POLL_MS);
}

async function joinApolloListenAlong(track, playback, { sessionId = "", sessionToken = "", peerCandidates = [] } = {}) {
  if (sessionId && sessionId === listenAlongState.publishedSessionId) {
    throw new Error("This client is already hosting that listen along session.");
  }

  if (sessionId && !sessionToken) {
    throw new Error("This listen along invite is missing its secure session token. Ask the host for a fresh invite.");
  }

  await clearPublishedListenAlongSession();

  if (!sessionId) {
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
    return;
  }

  await resetJoinedListenAlongPeer({
    keepRoom: false
  });
  listenAlongState.joinedSessionId = sessionId;
  listenAlongState.joinedSessionToken = sessionToken;
  listenAlongState.joinedPeerCandidates = [...peerCandidates];
  listenAlongRtc.joinPeerId = createListenAlongPeerId("join");
  await ensureListenAlongSignalRoom(sessionId);
  await publishListenAlongSignal(sessionId, {
    type: "join-request",
    senderId: listenAlongRtc.joinPeerId
  });
  void refreshJoinedListenAlongSession().catch(() => {});

  clearListenAlongJoinTimeout();
  listenAlongRtc.pendingJoinTimeoutHandle = window.setTimeout(() => {
    if (!listenAlongRtc.joinDataChannel && listenAlongState.joinedSessionId === sessionId) {
      state.message = "Direct peer connect timed out. Falling back to session sync.";
      renderStatus();
      void refreshJoinedListenAlongSession().catch(() => {});
    }
  }, 15000);
}

async function handleApolloDeepLink(url) {
  const action = parseApolloLink(url);
  if (!action) {
    return;
  }

  if (action.track?.provider !== "library") {
    action.track = await hydrateApolloSharedTrack(action.track);
  }

  if (action.route === APOLLO_DEEP_LINK_ROUTE_LISTEN) {
    if (!await confirmListenAlongJoin()) {
      state.message = "Listen along cancelled.";
      renderStatus();
      return;
    }

    try {
      await joinApolloListenAlong(action.track, action.playback, {
        sessionId: action.sessionId || "",
        sessionToken: action.sessionToken || "",
        peerCandidates: action.peerCandidates || []
      });
    } catch (error) {
      state.message = error?.message || "Unable to join listen along.";
      renderStatus();
    }
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

  const playbackStatus = getPlaybackStatusKind();
  if (playbackStatus === "paused") {
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
  const status = playbackStatus === "loading"
    ? "buffering"
    : playbackStatus === "buffering" || playbackStatus === "playing"
      ? playbackStatus
      : "";

  if (!status) {
    return null;
  }

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

  if (libraryTrackId && allowDiscordListenAlongRequests() && listenAlongAutomaticExposureConsent) {
    const sessionInfo = getActiveListenAlongSession(currentTrack);
    const joinSecret = buildApolloListenAlongLink(sessionInfo);
    if (joinSecret) {
      payload.partyId = `apollo-session:${sessionInfo.sessionId}`;
      payload.partySize = 1;
      payload.partyMax = DISCORD_LISTEN_ALONG_PARTY_MAX;
      payload.joinSecret = joinSecret;
      payload.listenAlongButtonUrl = buildApolloListenAlongButtonUrl(sessionInfo);
      payload.listenSessionId = sessionInfo.sessionId;
      payload.listenSessionToken = sessionInfo.token;
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

  const playbackTrack = getPlaybackTrack();
  if (
    playbackTrack
    && getLibraryTrackId(playbackTrack)
    && allowDiscordListenAlongRequests()
    && !listenAlongState.joinedSessionId
  ) {
    void ensureAutomaticListenAlongExposureConsent().then((consented) => {
      if (!consented || !getPlaybackTrack() || getPlaybackTrack().key !== playbackTrack.key) {
        return;
      }

      void ensureHostedListenAlongSession(playbackTrack).catch(() => {});
    });
  }

  const payload = buildDiscordPlaybackPayload();
  if (!payload) {
    void clearPublishedListenAlongSession();
    bridge.clear();
    return;
  }

  if (!payload.listenSessionId && !listenAlongState.joinedSessionId) {
    void clearPublishedListenAlongSession();
  }

  bridge.updatePlayback(payload);
}

function applySettings() {
  state.apiBase = buildApiBase(state.settings.connection);
  currentApiBase = state.apiBase;
  audioPlayer.autoplay = false;
  audioPlayer.preload = state.settings.audio.preloadMode;
  audioPlayer.playbackRate = state.settings.playback.playbackRate;
  setAudioOutputVolume(1);
  volumeSlider.value = String(state.settings.audio.volume);
  volumeSlider.step = String(state.settings.audio.volumeStep);
  syncRangeVisuals();
  applyAudioLevelingSetting();
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
  settingsSkipUnplayableTracks.checked = state.settings.playback.skipUnplayableTracks;
  settingsDefaultRepeat.value = state.settings.playback.defaultRepeatMode;
  settingsPreviousThreshold.value = String(state.settings.playback.previousSeekThreshold);
  settingsPlaybackRate.value = String(state.settings.playback.playbackRate);
  settingsCrossfadeSeconds.value = String(state.settings.playback.crossfadeSeconds || 0);
  settingsVolume.value = String(state.settings.audio.volume);
  settingsMuted.checked = state.settings.audio.muted;
  settingsVolumeStep.value = String(state.settings.audio.volumeStep);
  settingsPreloadMode.value = state.settings.audio.preloadMode;
  settingsLevelingEnabled.checked = Boolean(state.settings.audio.levelingEnabled);
  settingsIncludeLibrary.checked = state.settings.search.includeLibraryResults;
  settingsProviderDeezer.checked = state.settings.search.providers.deezer;
  settingsProviderYoutube.checked = state.settings.search.providers.youtube;
  settingsProviderSpotify.checked = state.settings.search.providers.spotify;
  settingsProviderSoundcloud.checked = state.settings.search.providers.soundcloud;
  settingsProviderItunes.checked = state.settings.search.providers.itunes;
  settingsSearchDelay.value = String(state.settings.search.liveSearchDelayMs);
  settingsAutoRefreshLibrary.checked = state.settings.downloads.autoRefreshLibrary;
  settingsAutoDownloadRemoteOnPlay.checked = state.settings.downloads.autoDownloadRemoteOnPlay;
  settingsPreferLocalPlayback.checked = state.settings.downloads.preferLocalPlayback;
  settingsDiscordEnabled.checked = state.settings.integrations.discord.enabled;
  settingsDiscordAllowListenAlong.checked = state.settings.integrations.discord.allowListenAlongRequests;
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
      skipUnplayableTracks: settingsSkipUnplayableTracks.checked,
      defaultRepeatMode: settingsDefaultRepeat.value,
      previousSeekThreshold: Number(settingsPreviousThreshold.value),
      playbackRate: Number(settingsPlaybackRate.value),
      crossfadeSeconds: Number(settingsCrossfadeSeconds.value)
    },
    audio: {
      volume: Number(settingsVolume.value),
      muted: settingsMuted.checked,
      volumeStep: Number(settingsVolumeStep.value),
      preloadMode: settingsPreloadMode.value,
      levelingEnabled: settingsLevelingEnabled.checked
    },
    search: {
      includeLibraryResults: settingsIncludeLibrary.checked,
      providers,
      liveSearchDelayMs: Number(settingsSearchDelay.value)
    },
    downloads: {
      autoRefreshLibrary: settingsAutoRefreshLibrary.checked,
      autoDownloadRemoteOnPlay: settingsAutoDownloadRemoteOnPlay.checked,
      preferLocalPlayback: settingsPreferLocalPlayback.checked
    },
    integrations: {
      discord: {
        enabled: settingsDiscordEnabled.checked,
        allowListenAlongRequests: settingsDiscordAllowListenAlong.checked,
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

function renderConfirmModal() {
  if (!confirmModal) {
    return;
  }

  confirmModalTitle.textContent = state.confirmModal.title;
  confirmModalCopy.textContent = state.confirmModal.message;
  confirmModalCancel.textContent = state.confirmModal.cancelLabel;
  confirmModalConfirm.textContent = state.confirmModal.confirmLabel;
}

function resolveActiveConfirm(result) {
  const resolver = activeConfirmResolver;
  activeConfirmResolver = null;
  activeConfirmPromise = null;
  resolver?.(result);
}

function closeConfirmModal(result = false) {
  state.confirmModal = createConfirmModalState();
  confirmModal?.classList.remove("is-open");
  confirmModal?.setAttribute("aria-hidden", "true");
  resolveActiveConfirm(result);
}

function openConfirmModal({
  title = "Confirm action",
  message = "",
  confirmLabel = "Continue",
  cancelLabel = "Cancel"
} = {}) {
  if (activeConfirmPromise) {
    return activeConfirmPromise;
  }

  state.confirmModal = createConfirmModalState({
    isOpen: true,
    title,
    message,
    confirmLabel,
    cancelLabel
  });
  renderConfirmModal();
  confirmModal?.classList.add("is-open");
  confirmModal?.setAttribute("aria-hidden", "false");
  setTimeout(() => confirmModalConfirm?.focus(), 0);

  activeConfirmPromise = new Promise((resolve) => {
    activeConfirmResolver = resolve;
  });

  return activeConfirmPromise;
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
}

function applyListenAlongBridgeState(nextState = {}) {
  state.listenAlong = {
    ...state.listenAlong,
    ...nextState,
    advertisedHosts: Array.isArray(nextState?.advertisedHosts)
      ? nextState.advertisedHosts
      : state.listenAlong.advertisedHosts
  };

  if (!state.listenAlong.running) {
    resetPublishedListenAlongSession();
  }
}

function applyListenAlongSignalingState(nextState = {}) {
  state.listenAlongSignaling = {
    ...state.listenAlongSignaling,
    ...nextState,
    rooms: Array.isArray(nextState?.rooms) ? nextState.rooms : state.listenAlongSignaling.rooms
  };
}

function saveVolumeSetting() {
  setAudioOutputVolume(1);
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
    const transportRequestId = beginTransportRequest({
      cancelPendingPlayback: true
    });
    void playSelectedTrack({
      transportRequestId
    });
  }
}

async function refreshLibrary({ force = false, reason = "manual" } = {}) {
  if (libraryRefreshInFlight) {
    return libraryRefreshInFlight;
  }

  if (
    !force
    && reason === "focus"
    && lastLibraryRefreshAt
    && (Date.now() - lastLibraryRefreshAt) < LIBRARY_REFRESH_FOCUS_COOLDOWN_MS
  ) {
    return false;
  }

  libraryRefreshInFlight = (async () => {
  state.isLoading = true;
  state.message = "Loading library...";
  render();
  pluginHost?.emit("library:refresh:start", {
    query: state.query,
    reason
  });

  try {
    const [health, tracks, playlistsPayload] = await Promise.all([
      requestJson("/api/health"),
      fetchAllTracks(""),
      requestJson("/api/playlists")
    ]);

    state.isConnected = true;
    updateBackendState(health);
    state.libraryTracks = tracks;
    state.playlists = (playlistsPayload.items || []).map((playlist) => ({
      id: playlist.id,
      name: playlist.name || "Untitled Playlist",
      description: playlist.description || "",
      artworkUrl: playlist.artworkUrl || "",
      tracks: (playlist.tracks || []).map(normaliseLibraryTrack)
    }));
    bumpRenderRevisions("library", "playlists");
    searchResultCache.clear();
    state.message = health?.status ? "" : "Apollo responded without a health status.";

    if (!state.query) {
      if (state.settings.playback.restoreLastTrack) {
        const playbackSnapshot = loadPlaybackState(localStorage);
        const restoredTrack = getTrackByKey(playbackSnapshot.selectedTrackKey);
        if (restoredTrack) {
          state.selectedTrackKey = restoredTrack.key;
        }

        const restoredPlaybackTrack = getTrackByKey(playbackSnapshot.playbackTrackKey || state.restoredPlaybackKey);
        if (restoredPlaybackTrack) {
          state.playbackTrackKey = restoredPlaybackTrack.key;
          void prefetchUpcomingPlayback(restoredPlaybackTrack);
        }
      }

      syncSelectedTrack();
      persistPlaybackState();
      prefetchQueuedPlayback(getPlaybackTrack() || getSelectedTrack());
    }

    pluginHost?.emit("library:refresh:success", {
      tracks: state.libraryTracks,
      playlists: state.playlists
    });
    persistLibrarySnapshot();
    lastLibraryRefreshAt = Date.now();
    logClient("backend", "library refresh succeeded", {
      version: state.backendVersion,
      status: state.backendStatus,
      tracks: state.libraryTracks.length,
      playlists: state.playlists.length,
      reason
    });
  } catch (error) {
    state.isConnected = false;
    resetBackendState();
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
    logClient("backend", "library refresh failed", {
      apiBase: state.apiBase,
      error: error?.message || "unknown",
      reason
    });
  } finally {
    state.isLoading = false;
    render();
    syncDiscordPresence();
  }
  })().finally(() => {
    libraryRefreshInFlight = null;
  });

  return libraryRefreshInFlight;
}

function clearDownloadWatcher(downloadId) {
  const existingWatcher = activeDownloadWatchers.get(downloadId);
  if (existingWatcher) {
    clearTimeout(existingWatcher.timeoutId);
    activeDownloadWatchers.delete(downloadId);
  }
}

function watchDownloadCompletion(downloadId, track, { silent = false } = {}) {
  const normalizedDownloadId = String(downloadId || "").trim();
  if (!normalizedDownloadId || activeDownloadWatchers.has(normalizedDownloadId)) {
    return;
  }

  let stopped = false;
  const trackLabel = String(track?.title || "track").trim() || "track";
  const pollDownloadStatus = async () => {
    if (stopped) {
      return;
    }

    try {
      const payload = await requestJson(`/api/downloads/${encodeURIComponent(normalizedDownloadId)}`);
      const status = String(payload?.status || "").trim().toLowerCase();
      if (status === "completed") {
        stopped = true;
        clearDownloadWatcher(normalizedDownloadId);
        if (state.settings.downloads.autoRefreshLibrary) {
          await refreshLibrary({
            force: true,
            reason: "download-complete"
          });
        }
        if (!silent) {
          state.message = `${trackLabel} was downloaded to Apollo.`;
          renderStatus();
        }
        return;
      }

      if (status === "failed") {
        stopped = true;
        clearDownloadWatcher(normalizedDownloadId);
        if (!silent) {
          state.message = payload?.message || `Apollo could not download ${trackLabel}.`;
          renderStatus();
        }
        return;
      }
    } catch (error) {
      if (stopped) {
        return;
      }
    }

    const timeoutId = window.setTimeout(pollDownloadStatus, DOWNLOAD_STATUS_POLL_MS);
    activeDownloadWatchers.set(normalizedDownloadId, {
      timeoutId
    });
  };

  activeDownloadWatchers.set(normalizedDownloadId, {
    timeoutId: window.setTimeout(pollDownloadStatus, DOWNLOAD_STATUS_POLL_MS)
  });
}

async function runSearch({ historySource = "", historyReplace = false } = {}) {
  const query = String(state.query || "").trim();
  const requestId = ++activeSearchRequestId;
  const collectionScopedSearch = isCollectionScopedSearch();
  abortPendingSearchRequest();
  abortPendingArtistBrowseRequest();
  state.artistBrowse = null;

  if (!query) {
    state.searchResults = [];
    state.artistSearchResults = [];
    bumpRenderRevisions("search");
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
  let remotePending = !collectionScopedSearch && getEnabledProviders().length > 0;
  let searchError = null;

  const publishSearchProgress = () => {
    if (!isSearchRequestCurrent(requestId, query)) {
      return;
    }

    state.searchResults = dedupeTracks([...localTracks, ...remoteResults]);
    state.artistSearchResults = artistResults;
    bumpRenderRevisions("search");
    state.message = collectionScopedSearch
      ? `${state.searchResults.length} songs`
      : buildSearchStatusMessage({
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
  bumpRenderRevisions("search");
  state.message = collectionScopedSearch
    ? `${localTracks.length} songs`
    : buildSearchStatusMessage({
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

  if (collectionScopedSearch) {
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
    const artistTask = fetchArtistSearchResults(query, { signal: abortController.signal })
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
  bumpRenderRevisions("likes");

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
  const link = buildTrackSourceLink(track);
  if (!link) {
    state.message = "No source link available for this track.";
    renderStatus();
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    state.message = "Copied source link.";
  } catch {
    state.message = "Copy failed in this environment.";
  }

  renderStatus();
}

async function copyApolloTrackLink(track) {
  const link = buildApolloTrackDeepLink(track);
  if (!link) {
    state.message = "No Apollo link available for this track.";
    renderStatus();
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    state.message = "Copied Apollo link.";
  } catch {
    state.message = "Copy failed in this environment.";
  }

  renderStatus();
}

async function copyListenAlongInvite(track) {
  const link = await ensureListenAlongInviteLink(track);
  if (link === null) {
    state.message = "Listen along cancelled.";
    renderStatus();
    return;
  }

  if (!link) {
    state.message = "Listen along invite is unavailable for this track.";
    renderStatus();
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    state.message = "Copied listen along invite.";
  } catch {
    state.message = "Copy failed in this environment.";
  }

  renderStatus();
}

function closeNowPlayingShareMenu() {
  state.nowPlayingShareOpen = false;
  state.nowPlayingShareAnchor = null;
  document.querySelectorAll(".now-playing-share-menu--portal").forEach((menu) => menu.remove());
}

function createNowPlayingShareMenu(track) {
  const sourceLink = buildTrackSourceLink(track);
  const apolloLink = buildApolloTrackDeepLink(track);
  const inviteLink = buildShareableListenAlongLink(track);
  const wrapper = document.createElement("div");
  wrapper.className = "track-menu-popover now-playing-share-menu";
  wrapper.innerHTML = `
    <button class="row-menu-button" type="button" data-action="copy-source" ${sourceLink ? "" : "disabled"}>Copy source link</button>
    <button class="row-menu-button" type="button" data-action="copy-apollo" ${apolloLink ? "" : "disabled"}>Copy Apollo link</button>
    <button class="row-menu-button" type="button" data-action="copy-invite" ${inviteLink ? "" : "disabled"}>Copy invite</button>
  `;

  wrapper.querySelector('[data-action="copy-source"]').addEventListener("click", () => {
    closeNowPlayingShareMenu();
    void copyTrackLink(track);
  });
  wrapper.querySelector('[data-action="copy-apollo"]').addEventListener("click", () => {
    closeNowPlayingShareMenu();
    void copyApolloTrackLink(track);
  });
  wrapper.querySelector('[data-action="copy-invite"]').addEventListener("click", () => {
    closeNowPlayingShareMenu();
    void copyListenAlongInvite(track);
  });

  return wrapper;
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
  const playbackTrack = resolvePreferredPlaybackTrack(track);
  if (playbackTrack.provider === "library") {
    return {
      trackId: playbackTrack.trackId || playbackTrack.id
    };
  }

  return {
    provider: playbackTrack.provider,
    title: playbackTrack.title,
    artist: playbackTrack.artist,
    album: playbackTrack.album,
    externalUrl: playbackTrack.externalUrl,
    downloadTarget: playbackTrack.downloadTarget
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
    artists: normaliseTrackArtists(track.artists, track.artist),
    album: track.album,
    albumArtist: String(track.albumArtist || "").trim(),
    trackNumber: normaliseTrackNumberTag(track.trackNumber),
    discNumber: normaliseTrackNumberTag(track.discNumber),
    releaseDate: normaliseTrackReleaseDate(track.releaseDate || track.releaseYear || ""),
    releaseYear: normaliseTrackNumberTag(track.releaseYear),
    genre: Array.isArray(track.genre)
      ? track.genre.map((value) => String(value || "").trim()).filter(Boolean).join(", ")
      : String(track.genre || "").trim(),
    explicit: normaliseTrackExplicitFlag(track.explicit),
    artwork: track.artwork || "",
    providerIds: normaliseProviderIds(track.providerIds),
    isrc: String(track.isrc || track.providerIds?.isrc || "").trim(),
    sourcePlatform: String(track.sourcePlatform || track.provider || "").trim(),
    externalUrl: track.externalUrl,
    sourceUrl: track.sourceUrl || track.externalUrl || track.downloadTarget,
    downloadTarget: track.downloadTarget,
    duration: track.duration,
    metadataSource: track.metadataSource || track.provider || "remote"
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

async function downloadTrackToServer(track, { silent = false } = {}) {
  if (!canSaveTrackToApollo(track)) {
    if (!silent) {
      state.message = "This song is already in the Apollo library.";
      renderStatus();
    }
    return;
  }

  try {
    const payload = await requestJson("/api/downloads/server", {
      method: "POST",
      body: JSON.stringify(buildDownloadPayload(track))
    });

    watchDownloadCompletion(payload?.id, track, { silent });

    if (!silent) {
      state.message = `Queued ${track.title} for Apollo library download with metadata.`;
      renderStatus();
    }
  } catch (error) {
    if (!silent) {
      state.message = error.message;
      renderStatus();
    }
  }
}

function queueAutoDownloadForTrack(track) {
  if (
    !track?.key
    || track.resultSource === "library"
    || !state.settings.downloads.autoDownloadRemoteOnPlay
    || !canSaveTrackToApollo(track)
  ) {
    return;
  }

  const autoDownloadKey = buildAutoDownloadKey(track);
  if (autoDownloadQueue.has(autoDownloadKey)) {
    return;
  }

  autoDownloadQueue.add(autoDownloadKey);
  void downloadTrackToServer(track, { silent: true })
    .finally(() => {
      window.setTimeout(() => {
        autoDownloadQueue.delete(autoDownloadKey);
      }, 15000);
    });
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

function createPlaylistSkeletonRow() {
  const row = document.createElement("div");
  row.className = "library-item library-item--skeleton";
  row.innerHTML = `
    <div class="library-item-main" aria-hidden="true">
      <span class="item-art skeleton-block skeleton-art"></span>
      <span class="item-copy">
        <span class="skeleton-block skeleton-line skeleton-line--title"></span>
        <span class="skeleton-block skeleton-line skeleton-line--meta"></span>
      </span>
    </div>
    <span class="library-item-menu-spacer" aria-hidden="true"></span>
  `;
  return row;
}

function createTrackSkeletonRow() {
  const row = document.createElement("div");
  row.className = "track-row track-row--skeleton";
  row.innerHTML = `
    <div class="track-main-button" aria-hidden="true">
      <span class="track-index skeleton-block skeleton-index"></span>
      <span class="track-leading">
        <span class="track-art skeleton-block skeleton-art"></span>
        <span class="track-copy">
          <span class="skeleton-block skeleton-line skeleton-line--title"></span>
          <span class="skeleton-block skeleton-line skeleton-line--meta"></span>
        </span>
      </span>
      <span class="track-duration skeleton-block skeleton-duration"></span>
    </div>
    <span class="track-menu-button" aria-hidden="true"></span>
  `;
  return row;
}

function isUiBusy() {
  const playbackStatus = getPlaybackStatusKind();
  return Boolean(
    state.isLoading
    || playbackStatus === "loading"
    || playbackStatus === "buffering"
    || state.discordInvite.isLoading
    || state.trackDeleteModal.isDeleting
  );
}

function getBusyStatusLabel() {
  if (state.trackDeleteModal.isDeleting) {
    return "Deleting track...";
  }

  if (state.discordInvite.isLoading) {
    return "Loading Discord friends...";
  }

  const playbackStatus = getPlaybackStatusKind();
  if (playbackStatus === "loading" || playbackStatus === "buffering") {
    return playbackStatus === "loading"
      ? "Loading track..."
      : "Buffering track...";
  }

  if (state.isLoading) {
    if (state.artistBrowse?.isLoading && state.artistBrowse?.name) {
      return `Loading ${state.artistBrowse.name}...`;
    }

    if (state.query) {
      return `Searching ${state.query}...`;
    }

    return "Refreshing library...";
  }

  return "";
}

function renderPlaylists() {
  const items = getPlaylistItems();
  state.activePlaylistMenuId = null;
  state.activePlaylistMenuAnchor = null;
  document.querySelectorAll(".playlist-menu-popover--portal").forEach((menu) => menu.remove());
  playlistList.innerHTML = "";

  if (state.isLoading && !items.length) {
    playlistList.setAttribute("aria-busy", "true");
    Array.from({ length: 5 }, () => createPlaylistSkeletonRow()).forEach((row) => {
      playlistList.append(row);
    });
    lastPlaylistRenderSignature = createPlaylistRenderSignature();
    return;
  }

  playlistList.setAttribute("aria-busy", "false");

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
        openPlaylistMenu(row, playlist.id, playlistRecord, {
          x: rect.right,
          y: rect.bottom
        });
      });

      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPlaylistMenu(row, playlist.id, playlistRecord, {
          x: event.clientX,
          y: event.clientY
        });
      });
    }

    playlistList.append(row);
  });

  lastPlaylistRenderSignature = createPlaylistRenderSignature();
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
    <button class="row-menu-button" type="button" data-action="copy">Copy source link</button>
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
          <p class="item-subtitle">${escapeHtml(formatArtistSearchSubtitle(artist) || "Open artist releases")}</p>
        </span>
      </button>
      <span class="library-item-menu-spacer" aria-hidden="true"></span>
    `;

    row.querySelector(".library-item-main").addEventListener("click", () => {
      void beginArtistBrowse(artist, {
        historySource: "artist-browse"
      });
    });

    row.querySelector(".item-art")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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

  const filteredTracks = filterArtistBrowseTracks(artist);
  const visibleReleases = Array.isArray(artist.releases) ? artist.releases.slice(0, 6) : [];
  const releaseSummary = visibleReleases.length
    ? visibleReleases
      .map((release, index) => {
        const releaseDetail = [release.primaryType, release.firstReleaseDate].filter(Boolean).join(" | ");
        const isActive = release.id && release.id === artist.activeReleaseId;
        return `
          <button class="detail-tag detail-action artist-release-card${isActive ? " is-active" : ""}" type="button" data-artist-release-index="${index}">
            <span class="artist-release-card__eyebrow">${escapeHtml(release.primaryType || "Release")}</span>
            <span class="artist-release-card__title">${escapeHtml(release.title)}</span>
            ${releaseDetail ? `<small class="artist-release-card__meta">${escapeHtml(releaseDetail)}</small>` : ""}
          </button>
        `;
      })
      .join("")
    : "";

  const section = document.createElement("section");
  section.className = "artist-browse-summary";
  section.innerHTML = `
    <div class="artist-browse-main">
      <div class="artist-browse-art">${renderArtistArtwork(artist, "artist-browse-art-image", state.searchResults)}</div>
      <div class="artist-browse-copy">
        <p class="artist-browse-stats">${filteredTracks.length} of ${(artist.tracks || []).length} songs${artist.activeReleaseTitle ? ` | ${escapeHtml(artist.activeReleaseTitle)}` : ""}</p>
        ${releaseSummary ? `<div class="detail-tags detail-tags--artist artist-release-grid">${releaseSummary}</div>` : ""}
        ${artist.activeReleaseTitle ? '<button class="text-button" type="button" data-artist-release-clear>Show all songs</button>' : ""}
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

  section.querySelector(".artist-browse-art")?.addEventListener("click", () => {
    void beginArtistBrowse(artist, {
      historySource: "artist-browse"
    });
  });

  section.querySelectorAll("[data-artist-release-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const releaseIndex = Number(button.getAttribute("data-artist-release-index"));
      const release = visibleReleases[releaseIndex];
      if (!release?.title) {
        return;
      }

      state.artistBrowse = {
        ...state.artistBrowse,
        activeReleaseId: release.id || "",
        activeReleaseTitle: release.title || ""
      };
      syncSelectedTrack();
      persistPlaybackState();
      render();
    });
  });

  section.querySelector("[data-artist-release-clear]")?.addEventListener("click", () => {
    state.artistBrowse = {
      ...state.artistBrowse,
      activeReleaseId: "",
      activeReleaseTitle: ""
    };
    syncSelectedTrack();
    persistPlaybackState();
    render();
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

function openTrackMenu(row, track, anchor) {
  const shouldToggleClosed = state.activeMenuTrackKey === track.key
    && document.querySelector(".track-menu-popover--portal");
  closeActiveMenu();
  if (shouldToggleClosed) {
    return;
  }

  state.activeMenuTrackKey = track.key;
  state.activeMenuAnchor = anchor;
  const menu = createRowMenu(track);
  menu.classList.add("track-menu-popover--portal");
  document.body.append(menu);
  positionActiveMenu(row, menu, anchor);
}

function openPlaylistMenu(row, playlistId, playlistRecord, anchor) {
  const shouldToggleClosed = state.activePlaylistMenuId === playlistId
    && document.querySelector(".playlist-menu-popover--portal");
  closeActiveMenu();
  if (shouldToggleClosed) {
    return;
  }

  state.activePlaylistMenuId = playlistId;
  state.activePlaylistMenuAnchor = anchor;
  const menu = createPlaylistMenu(playlistRecord);
  menu.classList.add("playlist-menu-popover--portal");
  document.body.append(menu);
  positionActiveMenu(row, menu, anchor);
}

function openQueueMenu(row, queueEntry, isCurrent, anchor) {
  const shouldToggleClosed = state.activeQueueMenuId === queueEntry.id
    && document.querySelector(".queue-menu-popover--portal");
  closeActiveMenu();
  if (shouldToggleClosed) {
    return;
  }

  state.activeQueueMenuId = queueEntry.id;
  state.activeQueueMenuAnchor = anchor;
  const menu = createQueueMenu(queueEntry, isCurrent);
  menu.classList.add("queue-menu-popover--portal");
  document.body.append(menu);
  positionActiveMenu(row, menu, anchor);
}

function renderTracks() {
  const visibleTracks = getVisibleTracks();
  const showArtistSearchResults = Boolean(state.query && !state.artistBrowse && state.artistSearchResults.length);
  state.activeMenuTrackKey = null;
  state.activeMenuAnchor = null;
  document.querySelectorAll(".track-menu-popover--portal").forEach((menu) => menu.remove());
  trackList.innerHTML = "";
  trackList.setAttribute("aria-busy", state.isLoading ? "true" : "false");

  if (state.artistBrowse) {
    const artistSummary = createArtistBrowseSummary();
    if (artistSummary) {
      trackList.append(artistSummary);
    }
  } else if (showArtistSearchResults) {
    trackList.append(createArtistSearchSection());
  }

  if (!visibleTracks.length) {
    if (state.isLoading && !showArtistSearchResults && !state.artistBrowse) {
      Array.from({ length: 8 }, () => createTrackSkeletonRow()).forEach((row) => {
        trackList.append(row);
      });
      return;
    }

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

  const fragment = document.createDocumentFragment();

  visibleTracks.forEach((track, index) => {
    const row = document.createElement("div");
    row.dataset.trackKey = track.key;
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
    mainButton.addEventListener("focus", () => {
      prefetchPlaybackUrl(track);
    });
    mainButton.addEventListener("click", (event) => {
      const forcePlay = Boolean(event.target instanceof Element && event.target.closest(".track-art"));
      const autoplay = forcePlay
        || state.settings.playback.autoplaySelection
        || Boolean(getPlaybackTrack() && getPlaybackTrack()?.key !== track.key);
      selectTrack(track.key, { autoplay });
    });

    const menuButton = row.querySelector(".track-menu-button");

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = menuButton.getBoundingClientRect();
      openTrackMenu(row, track, {
        x: rect.right,
        y: rect.bottom
      });
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTrackMenu(row, track, {
        x: event.clientX,
        y: event.clientY
      });
    });

    fragment.append(row);
    queueDurationProbe(track);
  });

  trackList.append(fragment);

  lastTrackListRenderSignature = createTrackListRenderSignature();
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
    lastTrackPaneHeaderSignature = createTrackPaneHeaderSignature();
    return;
  }

  if (state.query) {
    trackPaneKicker.textContent = isCollectionScopedSearch() ? "Filter" : "Search";
    trackPaneTitle.textContent = state.query;
    if (isCollectionScopedSearch()) {
      const scopeLabel = state.selectedPlaylistId === "liked-tracks"
        ? "liked songs"
        : `${getActivePlaylist()?.name || "playlist"}`;
      trackPaneMeta.textContent = `${visibleTracks.length} songs in ${scopeLabel}`;
      lastTrackPaneHeaderSignature = createTrackPaneHeaderSignature();
      return;
    }
    const artistCount = state.artistSearchResults.length;
    trackPaneMeta.textContent = artistCount
      ? `${artistCount} artists | ${visibleTracks.length} songs`
      : `${visibleTracks.length} songs`;
    lastTrackPaneHeaderSignature = createTrackPaneHeaderSignature();
    return;
  }

  if (state.selectedPlaylistId === "all-tracks") {
    trackPaneKicker.textContent = "Browse";
    trackPaneTitle.textContent = "All Tracks";
    trackPaneMeta.textContent = `${state.libraryTracks.length} songs`;
    lastTrackPaneHeaderSignature = createTrackPaneHeaderSignature();
    return;
  }

  if (state.selectedPlaylistId === "liked-tracks") {
    trackPaneKicker.textContent = "Playlist";
    trackPaneTitle.textContent = "Liked Songs";
    trackPaneMeta.textContent = `${likedTracks.size} songs`;
    lastTrackPaneHeaderSignature = createTrackPaneHeaderSignature();
    return;
  }

  const playlist = getActivePlaylist();
  trackPaneKicker.textContent = "Playlist";
  trackPaneTitle.textContent = playlist?.name || "Playlist";
  trackPaneMeta.textContent = `${playlist?.tracks.length || 0} songs`;
  lastTrackPaneHeaderSignature = createTrackPaneHeaderSignature();
}

function createDetailPanelSignature() {
  const selectedTrack = getSelectedTrack();
  const playbackTrack = getPlaybackTrack();
  const activeTrack = playbackTrack || selectedTrack;
  const pluginTabs = (pluginHost?.getDetailTabs?.() || [])
    .map((tab) => `${tab.id}:${tab.label}:${tab.order ?? 100}`)
    .join("|");

  if (state.activeDetailTab === "track") {
    return JSON.stringify({
      tab: "track",
      pluginTabs,
      activeTrackKey: activeTrack?.key || "",
      query: state.query,
      artistBrowseId: state.artistBrowse?.id || "",
      activeReleaseId: state.artistBrowse?.activeReleaseId || "",
      duration: activeTrack ? getCachedDuration(activeTrack) || 0 : 0
    });
  }

  if (state.activeDetailTab === "queue") {
    return JSON.stringify({
      tab: "queue",
      pluginTabs,
      playbackTrackKey: playbackTrack?.key || "",
      playbackStatus: getPlaybackStatusKind(),
      manualQueueLength: state.playbackManualQueue.length,
      contextQueueLength: state.playbackContextQueue.length,
      autoplayQueueLength: state.playbackAutoplayQueue.length
    });
  }

  return JSON.stringify({
    tab: state.activeDetailTab,
    pluginTabs,
    activeTrackKey: activeTrack?.key || ""
  });
}

function maybeRenderDetailPanel() {
  const nextSignature = createDetailPanelSignature();
  if (nextSignature === lastDetailPanelSignature) {
    return;
  }

  renderDetailPanel();
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
  lastDetailPanelSignature = createDetailPanelSignature();

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
  if (state.nowPlayingShareOpen) {
    closeNowPlayingShareMenu();
  }

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
    lastNowPlayingSignature = createNowPlayingSignature();
    return;
  }

  const liked = isTrackLiked(currentTrack.key);
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
      <button class="now-playing-icon-button" type="button" data-now-playing-action="share" aria-label="Share track">${shareIcon()}</button>
      <button class="now-playing-icon-button" type="button" data-now-playing-action="download" aria-label="Download track">${saveToApolloIcon()}</button>
      ${showLeaveListenAlong ? '<button class="now-playing-pill-button" type="button" data-now-playing-action="leave-listen-along">Leave listen along</button>' : ""}
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

  const shareButton = nowPlaying.querySelector('[data-now-playing-action="share"]');
  if (shareButton) {
    shareButton.addEventListener("click", () => {
      const wasOpen = state.nowPlayingShareOpen;
      closeNowPlayingShareMenu();
      if (wasOpen) {
        return;
      }

      const rect = shareButton.getBoundingClientRect();
      state.nowPlayingShareOpen = true;
      state.nowPlayingShareAnchor = {
        x: rect.right,
        y: rect.bottom
      };
      const menu = createNowPlayingShareMenu(currentTrack);
      menu.classList.add("now-playing-share-menu--portal");
      document.body.append(menu);
      positionActiveMenu(shareButton, menu, state.nowPlayingShareAnchor);
    });
  }

  const downloadButton = nowPlaying.querySelector('[data-now-playing-action="download"]');
  if (downloadButton) {
    downloadButton.addEventListener("click", () => {
      void downloadTrackToDevice(currentTrack);
    });
  }

  const leaveButton = nowPlaying.querySelector('[data-now-playing-action="leave-listen-along"]');
  if (leaveButton) {
    leaveButton.addEventListener("click", () => {
      leaveJoinedListenAlongSession();
    });
  }

  lastNowPlayingSignature = createNowPlayingSignature();
}

function renderStatus() {
  const busy = isUiBusy();
  document.body.classList.toggle("app-is-busy", busy);
  serverStatus.classList.toggle("is-busy", busy);
  serverStatus.setAttribute("aria-busy", busy ? "true" : "false");

  if (state.message) {
    serverStatus.textContent = state.message;
    serverStatus.title = state.message;
    return;
  }

  if (busy) {
    const busyMessage = getBusyStatusLabel();
    serverStatus.textContent = busyMessage;
    serverStatus.title = busyMessage;
    return;
  }

  if (state.isConnected) {
    const statusParts = ["Connected"];
    if (state.backendVersion) {
      statusParts.push(`Backend ${state.backendVersion}`);
    } else if (state.backendStatus) {
      statusParts.push(state.backendStatus);
    }

    const connectedMessage = statusParts.join(" | ");
    serverStatus.textContent = connectedMessage;
    serverStatus.title = connectedMessage;
    return;
  }

  serverStatus.textContent = "";
  serverStatus.title = "";
}

function renderPlaybackUi({ includeTracks = false, includeDetail = false } = {}) {
  if (includeTracks) {
    maybeRenderTracks();
  }

  if (includeDetail) {
    maybeRenderDetailPanel();
  }

  maybeRenderNowPlaying();
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
  const joinedSnapshot = listenAlongState.joinedSessionId ? listenAlongRtc.latestSnapshot : null;
  const currentTime = joinedSnapshot
    ? getListenAlongStartTime(joinedSnapshot)
    : (audioPlayer.currentTime || 0);
  const duration = joinedSnapshot
    ? Number(joinedSnapshot.durationSeconds) || 0
    : (audioPlayer.duration || cachedDuration || 0);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  progressCurrent.textContent = formatDuration(currentTime);
  progressTotal.textContent = formatDuration(duration);
  progressFill.style.width = `${progress}%`;
  volumeSlider.value = String(state.settings.audio.volume);
  syncRangeVisuals();
  volumeButton.setAttribute(
    "aria-label",
    state.settings.audio.muted || state.settings.audio.volume === 0 ? "Unmute" : "Mute"
  );
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
  renderNavigationButtons();
  applyLayout();
  updateAuthButton();
  maybeRenderPlaylists();
  maybeRenderTrackPaneHeader();
  maybeRenderTracks();
  maybeRenderDetailPanel();
  maybeRenderNowPlaying();
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

function beginTransportRequest({ cancelPendingPlayback = false } = {}) {
  const requestId = ++activeTransportRequestId;
  if (cancelPendingPlayback) {
    cancelPendingPlaybackStart({ keepMessage: true });
    clearPlaybackTransition();
  }
  return requestId;
}

function isTransportRequestCurrent(requestId) {
  return !requestId || requestId === activeTransportRequestId;
}

function cancelPendingPlaybackStart({ keepMessage = false } = {}) {
  activePlaybackRequestId += 1;
  state.isBuffering = false;
  state.playbackPendingTrackKey = "";
  playbackTransitionTrackKey = "";

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
  if (!isTrackLikelyPlayable(track)) {
    throw new Error(`Apollo could not find a playable source for ${track?.title || "this track"}.`);
  }

  const knownFailure = getTrackPlaybackFailure(track);
  if (knownFailure) {
    throw new Error(knownFailure.message);
  }

  const cachedUrl = getCachedPlaybackUrl(track.key);
  if (cachedUrl) {
    return cachedUrl;
  }

  if (pendingPlaybackUrlCache.has(track.key)) {
    return pendingPlaybackUrlCache.get(track.key);
  }

  const pendingRequest = (async () => {
    try {
      const playbackTrack = resolvePreferredPlaybackTrack(track);
      if (playbackTrack.playbackUrl) {
        clearTrackPlaybackFailure(track);
        return cachePlaybackUrl(track.key, playbackTrack.playbackUrl, Number.POSITIVE_INFINITY);
      }

      if (playbackTrack.provider === "library") {
        const directUrl = withAccessToken(`${state.apiBase}/stream/${playbackTrack.trackId || playbackTrack.id}`);
        clearTrackPlaybackFailure(track);
        return cachePlaybackUrl(track.key, directUrl, Number.POSITIVE_INFINITY);
      }

      const payload = await requestJson("/api/playback", {
        method: "POST",
        body: JSON.stringify(buildPlaybackPayload(track))
      });
      const rawStreamUrl = String(payload?.streamUrl || "").trim();
      if (!rawStreamUrl) {
        throw new Error(`Apollo could not find a playable source for ${track.title}.`);
      }

      const streamUrl = withAccessToken(rawStreamUrl);
      clearTrackPlaybackFailure(track);
      return cachePlaybackUrl(track.key, streamUrl);
    } catch (error) {
      rememberTrackPlaybackFailure(track, error);
      throw error;
    }
  })();

  pendingPlaybackUrlCache.set(track.key, pendingRequest);

  try {
    return await pendingRequest;
  } finally {
    pendingPlaybackUrlCache.delete(track.key);
  }
}

async function playTrackWithTransition(track, options = {}) {
  const fadeSeconds = getConfiguredCrossfadeSeconds();
  const shouldFade = fadeSeconds > 0
    && hasActiveAudioSource()
    && !audioPlayer.paused
    && !listenAlongState.joinedSessionId
    && !options.skipTransition;

  if (!shouldFade) {
    return playResolvedTrack(track, options);
  }

  const fadeDurationMs = Math.max(160, Math.round((fadeSeconds * 1000) / 2));
  await animatePlaybackVolume(1, 0, fadeDurationMs);

  const didPlay = await playResolvedTrack(track, {
    ...options,
    preserveTransitionVolume: true
  });
  if (!didPlay) {
    setAudioOutputVolume(1);
    return false;
  }

  setAudioOutputVolume(0);
  await animatePlaybackVolume(0, 1, fadeDurationMs);
  return true;
}

async function playResolvedTrack(track, { select = true, replaceQueue = false, queueTracks = null, preserveQueue = false, preserveListenAlong = false, preserveTransitionVolume = false, recordHistory = true, transportRequestId = 0 } = {}) {
  if (!track) {
    return false;
  }

  if (!isTrackLikelyPlayable(track)) {
    rememberTrackPlaybackFailure(track, new Error(`Apollo could not find a playable source for ${track.title || "this track"}.`));
    state.message = getTrackPlaybackFailure(track)?.message || "Apollo could not find a playable source for this track.";
    renderStatus();
    return false;
  }

  if (!isTransportRequestCurrent(transportRequestId)) {
    return false;
  }

  const requestId = ++activePlaybackRequestId;
  const previousTrack = getPlaybackTrack();

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
      mode: replaceQueue ? resolvePlaybackReplaceMode(track, queueTracks) : state.playbackQueueMode
    });
  }
  clearTrackPlaybackFailure(track);
  state.playbackPendingTrackKey = track.key;
  state.transientPlaybackTrack = getTrackByKey(track.key) ? null : serialiseTrack(track);
  state.isBuffering = true;
  state.message = `Loading ${track.title}...`;
  persistPlaybackState();
  render();

  try {
    await resumeAudioLevelingContext();
    const nextUrl = playbackWarmupTrackKey === track.key && playbackWarmupUrl
      ? playbackWarmupUrl
      : await resolvePlaybackUrl(track);
    if (!isPlaybackRequestCurrent(requestId) || !isTransportRequestCurrent(transportRequestId)) {
      if (state.playbackPendingTrackKey === track.key) {
        state.playbackPendingTrackKey = "";
      }
      return false;
    }

    const currentSrc = audioPlayer.currentSrc || audioPlayer.src;
    const urlChanged = state.playbackTrackKey !== track.key || currentSrc !== nextUrl;

    if (urlChanged) {
      if (recordHistory && previousTrack && !areTracksEquivalent(previousTrack, track)) {
        pushPlaybackHistory(previousTrack);
      }
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

    if (!isPlaybackRequestCurrent(requestId) || !isTransportRequestCurrent(transportRequestId)) {
      if (state.playbackPendingTrackKey === track.key) {
        state.playbackPendingTrackKey = "";
      }
      return false;
    }

    await audioPlayer.play();
    if (!isPlaybackRequestCurrent(requestId) || !isTransportRequestCurrent(transportRequestId)) {
      audioPlayer.pause();
      if (state.playbackPendingTrackKey === track.key) {
        state.playbackPendingTrackKey = "";
      }
      return false;
    }

    state.message = "";
    playbackTransitionTrackKey = "";
    if (playbackWarmupTrackKey === track.key) {
      clearPlaybackWarmup();
    }
    clearTrackPlaybackFailure(track);
    if (!preserveTransitionVolume) {
      clearPlaybackTransition();
    }
    prefetchUpcomingPlayback(track);
    queueAutoDownloadForTrack(track);
    void maybeExtendAutoplayQueue(track);
    return true;
  } catch (error) {
    if (!isPlaybackRequestCurrent(requestId) || !isTransportRequestCurrent(transportRequestId)) {
      if (state.playbackPendingTrackKey === track.key) {
        state.playbackPendingTrackKey = "";
      }
      return false;
    }

    state.isPlaying = false;
    state.isBuffering = false;
    state.playbackPendingTrackKey = "";
    playbackTransitionTrackKey = "";
    rememberTrackPlaybackFailure(track, error);
    state.message = getTrackPlaybackFailure(track)?.message || error.message;
    pluginHost?.emit("playback:error", {
      track,
      error
    });
    render();
    return false;
  }
}

async function playSelectedTrack({ replaceQueue = true, transportRequestId = 0 } = {}) {
  const selectedTrack = getSelectedTrack() || getPlaybackTrack();
  if (!selectedTrack) {
    return;
  }

  await playTrackWithTransition(selectedTrack, {
    select: false,
    replaceQueue,
    transportRequestId
  });
}

function getNextTrack(offset, wrap = false) {
  return getAdjacentQueueTrack(offset, wrap)?.track || null;
}

function getRandomTrack() {
  return getRandomQueueTrack()?.track || null;
}

async function playAdjacent(offset, wrap = false, { transportRequestId = 0, interrupt = true } = {}) {
  if (interrupt) {
    audioPlayer.pause();
    state.isPlaying = false;
    state.isBuffering = true;
    renderPlaybackUi();
  }

  const maxAttempts = state.playbackManualQueue.length
    + state.playbackContextQueue.length
    + state.playbackAutoplayQueue.length
    + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nextEntry = await getNextQueueEntryWithAutoplay(offset, wrap && attempt === 0);
    if (!isTransportRequestCurrent(transportRequestId)) {
      return;
    }

    if (!nextEntry?.track) {
      state.isBuffering = false;
      renderPlaybackUi();
      return;
    }

    const nextTrack = consumeQueueEntry(nextEntry);
    if (!nextTrack || !isTransportRequestCurrent(transportRequestId)) {
      state.isBuffering = false;
      renderPlaybackUi();
      return;
    }

    state.selectedTrackKey = nextEntry.track.key;
    closeActiveMenu();
    persistPlaybackState();
    render();

    const didPlay = await playTrackWithTransition(nextTrack, {
      select: false,
      preserveQueue: true,
      transportRequestId,
      skipTransition: interrupt
    });
    if (didPlay) {
      return;
    }
  }

  state.isBuffering = false;
  if (!getOrderedUpcomingQueueEntries().length && !getPlaybackTrack()) {
    state.message = "No playable tracks remain in the queue.";
  }
  renderPlaybackUi();
}

async function handlePlaybackFailure(track, error) {
  const resolvedTrack = track || getPlaybackTrack();
  const message = String(
    error?.message || `Apollo could not keep playing ${resolvedTrack?.title || "this track"}.`
  ).trim() || "Playback failed.";

  if (resolvedTrack?.key) {
    rememberTrackPlaybackFailure(resolvedTrack, error);
  }

  clearPlaybackTransition();
  state.isPlaying = false;
  state.isBuffering = false;
  state.playbackPendingTrackKey = "";

  const hasUpcomingTracks = getOrderedUpcomingQueueEntries().length > 0;
  if (hasUpcomingTracks) {
    state.message = `${resolvedTrack?.title || "Track"} could not be played. Skipping ahead.`;
    renderStatus();
    await playAdjacent(1, state.repeatMode === "all", {
      interrupt: false,
      transportRequestId: beginTransportRequest()
    });
    return;
  }

  state.playbackTrackKey = null;
  state.transientPlaybackTrack = null;
  state.message = message;

  try {
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
  } catch {
    // Ignore player teardown failures after playback errors.
  }

  render();
}

function resetLayout() {
  state.layout = structuredClone(DEFAULT_LAYOUT);
  persistLayout();
  render();
}

async function initialiseWindowChrome() {
  renderWindowChrome();

  if (!state.windowChrome.available || !windowControls?.available) {
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
  if (
    state.nowPlayingShareOpen
    && !event.target.closest(".now-playing-share-menu")
    && !event.target.closest('[data-now-playing-action="share"]')
  ) {
    closeNowPlayingShareMenu();
  }

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
  }
});

trackList.addEventListener("scroll", () => {
  if (state.nowPlayingShareOpen) {
    closeNowPlayingShareMenu();
  }

  if (!hasActiveMenu()) {
    return;
  }

  closeActiveMenu();
});

playlistList.addEventListener("scroll", () => {
  if (state.nowPlayingShareOpen) {
    closeNowPlayingShareMenu();
  }

  if (!hasActiveMenu()) {
    return;
  }

  closeActiveMenu();
});

window.addEventListener("resize", () => {
  if (state.nowPlayingShareOpen) {
    closeNowPlayingShareMenu();
  }

  if (!hasActiveMenu()) {
    return;
  }

  closeActiveMenu();
});

window.addEventListener("mousedown", handleNavigationMouseButton, true);
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
navigationBackButton?.addEventListener("click", () => {
  void requestHistoryNavigation(-1);
});
navigationForwardButton?.addEventListener("click", () => {
  void requestHistoryNavigation(1);
});
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
confirmModal?.querySelectorAll("[data-confirm-close]").forEach((element) => {
  element.addEventListener("click", () => {
    closeConfirmModal(false);
  });
});
trackDeleteModalClose?.addEventListener("click", closeTrackDeleteModal);
trackDeleteCancel?.addEventListener("click", closeTrackDeleteModal);
confirmModalCancel?.addEventListener("click", () => {
  closeConfirmModal(false);
});
confirmModalConfirm?.addEventListener("click", () => {
  closeConfirmModal(true);
});
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
    void requestHistoryNavigation(event.key === "BrowserBack" ? -1 : 1);
    return;
  }

  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    void requestHistoryNavigation(event.key === "ArrowLeft" ? -1 : 1);
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

  if (event.key === "Escape" && state.confirmModal.isOpen) {
    closeConfirmModal(false);
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
  const playbackStatus = getPlaybackStatusKind();

  if (playbackStatus === "loading") {
    beginTransportRequest({
      cancelPendingPlayback: true
    });
    audioPlayer.pause();
    state.isPlaying = false;
    renderPlaybackUi();
    return;
  }

  if (!hasActiveAudioSource()) {
    const transportRequestId = beginTransportRequest({
      cancelPendingPlayback: true
    });
    await playSelectedTrack({
      transportRequestId
    });
    return;
  }

  if (!audioPlayer.paused) {
    beginTransportRequest({
      cancelPendingPlayback: true
    });
    audioPlayer.pause();
    return;
  }

  if (audioPlayer.paused) {
    const transportRequestId = beginTransportRequest();
    renderPlayback();
    try {
      await resumeAudioLevelingContext();
      await audioPlayer.play();
      if (!isTransportRequestCurrent(transportRequestId)) {
        audioPlayer.pause();
      }
    } catch (error) {
      if (!isTransportRequestCurrent(transportRequestId)) {
        return;
      }
      state.isBuffering = false;
      state.message = error.message;
      render();
    }
    return;
  }
});

previousButton.addEventListener("click", () => {
  if (listenAlongState.joinedSessionId) {
    return;
  }

  if ((audioPlayer.currentTime || 0) > state.settings.playback.previousSeekThreshold) {
    audioPlayer.currentTime = 0;
    renderPlayback();
    return;
  }

  const previousTrack = popPlaybackHistory();
  if (previousTrack?.key) {
    const transportRequestId = beginTransportRequest({
      cancelPendingPlayback: true
    });
    state.selectedTrackKey = previousTrack.key;
    closeActiveMenu();
    persistPlaybackState();
    render();
    void playTrackWithTransition(previousTrack, {
      select: false,
      preserveQueue: true,
      recordHistory: false,
      transportRequestId
    });
    return;
  }

  void playAdjacent(-1, state.repeatMode === "all", {
    interrupt: !canUseCrossfadeTransition(),
    transportRequestId: beginTransportRequest({
      cancelPendingPlayback: true
    })
  });
});

nextButton.addEventListener("click", () => {
  if (listenAlongState.joinedSessionId) {
    return;
  }

  void playAdjacent(1, state.repeatMode === "all", {
    interrupt: !canUseCrossfadeTransition(),
    transportRequestId: beginTransportRequest({
      cancelPendingPlayback: true
    })
  });
});

progressButton.addEventListener("click", (event) => {
  if (listenAlongState.joinedSessionId || !audioPlayer.duration) {
    return;
  }

  const bounds = progressButton.getBoundingClientRect();
  const ratio = (event.clientX - bounds.left) / bounds.width;
  audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration, audioPlayer.duration * ratio));
  renderPlayback();
});

volumeSlider.addEventListener("input", (event) => {
  state.settings.audio.muted = false;
  state.settings.audio.volume = Number(event.target.value);
  saveVolumeSetting();
  renderPlayback();
});

volumeButton.addEventListener("click", () => {
  state.settings.audio.muted = !state.settings.audio.muted;
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
  if (audioPlayer.paused) {
    return;
  }

  state.isPlaying = true;
  state.isBuffering = true;
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("play", () => {
  state.isPlaying = true;
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("playing", () => {
  state.isPlaying = true;
  state.isBuffering = false;
  state.playbackPendingTrackKey = "";
  state.message = "";
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("canplay", () => {
  if (!audioPlayer.paused) {
    state.isBuffering = false;
    state.playbackPendingTrackKey = "";
    renderPlaybackUi();
  }
});

audioPlayer.addEventListener("stalled", () => {
  if (audioPlayer.paused) {
    return;
  }

  state.isBuffering = true;
  renderPlaybackUi();
});

audioPlayer.addEventListener("pause", () => {
  state.isPlaying = false;
  if (!audioPlayer.ended && !state.playbackPendingTrackKey) {
    state.isBuffering = false;
  }
  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("error", () => {
  const failedTrack = getPlaybackTrack();
  if (!failedTrack) {
    state.isPlaying = false;
    state.isBuffering = false;
    state.playbackPendingTrackKey = "";
    renderPlaybackUi();
    return;
  }

  const mediaError = audioPlayer.error;
  const errorMessage = mediaError?.message
    || `Apollo could not play ${failedTrack.title}.`;
  void handlePlaybackFailure(failedTrack, new Error(errorMessage));
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
    persistDurationCache();
  }

  if (state.restoredPlaybackKey && state.playbackTrackKey === state.restoredPlaybackKey && playbackState.currentTime > 0) {
    audioPlayer.currentTime = Math.min(playbackState.currentTime, audioPlayer.duration || playbackState.currentTime);
    try {
      audioPlayer.pause();
    } catch {
      // Ignore pause failures during restore.
    }
    state.isPlaying = false;
    state.isBuffering = false;
    state.restoredPlaybackKey = null;
  }
  renderPlaybackUi({
    includeTracks: true,
    includeDetail: true
  });
  void maybeExtendAutoplayQueue(playbackTrack);
  syncDiscordPresence();
  pluginHost?.emit("playback:metadata", createPluginPlaybackSnapshot());
});

audioPlayer.addEventListener("ended", async () => {
  state.isPlaying = false;
  state.isBuffering = false;
  state.playbackPendingTrackKey = "";
  clearPlaybackTransition();

  if (state.repeatMode === "one") {
    audioPlayer.currentTime = 0;
    void audioPlayer.play();
    return;
  }

  if (getOrderedUpcomingQueueEntries().length || state.repeatMode === "all") {
    await playAdjacent(1, state.repeatMode === "all", {
      transportRequestId: beginTransportRequest(),
      interrupt: false
    });
    return;
  }

  renderPlaybackUi();
  syncDiscordPresence();
  pluginHost?.emit("playback:state", createPluginPlaybackSnapshot());
});

window.addEventListener("focus", () => {
  if (state.settings.playback.pauseOnBlur && state.wasPlayingBeforeBlur && getPlaybackTrack()) {
    state.wasPlayingBeforeBlur = false;
    void resumeAudioLevelingContext()
      .then(() => getActiveAudioElement().play())
      .catch(() => {});
  }

  if (!state.settings.downloads.autoRefreshLibrary) {
    return;
  }

  void refreshLibrary({
    reason: "focus"
  });
});

window.addEventListener("blur", () => {
  if (!state.settings.playback.pauseOnBlur) {
    return;
  }

  state.wasPlayingBeforeBlur = !getActiveAudioElement().paused;
  if (state.wasPlayingBeforeBlur) {
    getActiveAudioElement().pause();
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
  maybeStartAutomaticCrossfade();
  if (
    state.playbackQueueMode === "radio"
    && audioPlayer.duration
    && (audioPlayer.duration - (audioPlayer.currentTime || 0)) <= 15
  ) {
    void maybeExtendAutoplayQueue(getPlaybackTrack(), {
      threshold: 4
    });
  }
  persistPlaybackState();
});

audioPlayer.addEventListener("emptied", syncDiscordPresence);

await reloadRuntimeAssets("startup");
runtimeAssetWatcherCleanup = desktopRuntimeAssets?.onChanged?.(({ reason, snapshot }) => {
  const nextSignature = createRuntimeAssetsSignature(snapshot);
  if (reason === "initial") {
    lastRuntimeAssetsEventSignature = nextSignature;
    return;
  }

  if (nextSignature && nextSignature === lastRuntimeAssetsEventSignature) {
    return;
  }

  lastRuntimeAssetsEventSignature = nextSignature;
  void reloadRuntimeAssets(reason || "runtime-assets")
    .then(() => {
      render();
    })
    .catch((error) => {
      logClient("runtime-assets", "runtime asset reload failed", {
        reason,
        error: error?.message || "unknown"
      });
    });
}) || null;
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

async function initialiseListenAlongBridge() {
  const bridge = getListenAlongBridge();
  if (!bridge?.available) {
    return () => {};
  }

  try {
    applyListenAlongBridgeState(await bridge.getState());
    syncDiscordPresence();
  } catch {
    // Ignore state probe failures and keep playback active.
  }

  return bridge.onStateChange((nextState) => {
    applyListenAlongBridgeState(nextState);
    syncDiscordPresence();
  });
}

async function initialiseListenAlongSignaling() {
  const bridge = getListenAlongSignalingBridge();
  if (!bridge?.available) {
    return {
      removeSignalListener: () => {},
      removeStateListener: () => {}
    };
  }

  applyListenAlongSignalingState(await bridge.getState());
  const removeSignalListener = bridge.onSignal((event) => {
    void handleListenAlongSignalEvent(event);
  });
  const removeStateListener = bridge.onStateChange((nextState) => {
    applyListenAlongSignalingState(nextState);
  });

  return {
    removeSignalListener,
    removeStateListener
  };
}

const removeDeepLinkListener = window.apolloDesktop?.onDeepLink?.((url) => {
  void handleApolloDeepLink(url);
});
const removeDiscordSocialListener = await initialiseDiscordSocial();
const removeListenAlongListener = await initialiseListenAlongBridge();
const {
  removeSignalListener: removeListenAlongSignalListener,
  removeStateListener: removeListenAlongSignalStateListener
} = await initialiseListenAlongSignaling();

window.addEventListener("beforeunload", () => {
  for (const downloadId of activeDownloadWatchers.keys()) {
    clearDownloadWatcher(downloadId);
  }
  stopJoinedListenAlongSession();
  void clearPublishedListenAlongSession();
  runtimeAssetWatcherCleanup?.();
  removeWindowControlsListener?.();
  removeDeepLinkListener?.();
  removeDiscordSocialListener?.();
  removeListenAlongListener?.();
  removeListenAlongSignalListener?.();
  removeListenAlongSignalStateListener?.();
  pluginHost?.dispose();
});

async function initialiseApolloClient() {
  try {
    const canContinue = await refreshAuthStatus();
    render();
    if (canContinue) {
      await refreshLibrary();
      try {
        audioPlayer.pause();
      } catch {
        // Ignore pause failures during startup.
      }
      state.isPlaying = false;
      state.isBuffering = false;
      renderPlaybackUi({
        includeTracks: true,
        includeDetail: true
      });
      prefetchQueuedPlayback(getPlaybackTrack() || getSelectedTrack());
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
