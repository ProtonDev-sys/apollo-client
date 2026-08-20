from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def replace_exact_count(source: str, old: str, new: str, expected: int, label: str) -> str:
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    return source.replace(old, new)


def replace_block(source: str, start: str, end: str, replacement: str, label: str) -> str:
    start_count = source.count(start)
    end_count = source.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(
            f"{label}: expected one boundary each, found start={start_count}, end={end_count}"
        )
    start_index = source.index(start)
    end_index = source.index(end, start_index)
    return source[:start_index] + replacement + source[end_index:]


main_path = Path("main.js")
main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''const { pathToFileURL } = require("node:url");
const { createDiscordPresenceController } = require("./discord-presence");
const { createDiscordSocialBridge } = require("./discord-social-bridge");
const { createListenAlongServer } = require("./src/listen-along-p2p");
''',
    '''const { pathToFileURL } = require("node:url");
const { createDiscordPresenceController } = require("./discord-presence");
const { createAsyncLogWriter } = require("./src/main/async-log-writer");
const { createListenAlongServer } = require("./src/listen-along-p2p");
''',
    "main imports",
)
main = replace_once(
    main,
    '''let appLogFilePath = null;
let discordLogFilePath = null;
let listenAlongServer = null;
let pendingClientUpdateNotice = null;
let hasShownClientUpdateNotice = false;
const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;

function appendLogLine(targetPath, source, message) {
  if (!targetPath) {
    return;
  }

  try {
    const currentSize = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
    if (currentSize >= MAX_LOG_FILE_BYTES) {
      fs.writeFileSync(targetPath, "");
    }

    fs.appendFileSync(targetPath, `[${new Date().toISOString()}] [${source}] ${message}\n`);
  } catch {
    // Ignore logging failures.
  }
}

function logApp(source, message) {
  appendLogLine(appLogFilePath, source, message);
}

function logDiscord(message) {
  if (appLogFilePath) {
    appendLogLine(appLogFilePath, "discord", message);
  }

  if (discordLogFilePath && discordLogFilePath !== appLogFilePath) {
    appendLogLine(discordLogFilePath, "discord", message);
  }
}
''',
    '''let appLogFilePath = null;
let listenAlongServer = null;
let pendingClientUpdateNotice = null;
let hasShownClientUpdateNotice = false;
const appLogWriter = createAsyncLogWriter({
  fs,
  maxBytes: 1024 * 1024,
  maxQueuedLines: 512
});

function logApp(source, message) {
  appLogWriter.write(source, message);
}

function logDiscord(message) {
  appLogWriter.write("discord", message);
}
''',
    "async main logging",
)
main = replace_once(
    main,
    '''function getUnavailableDiscordSocialState() {
  return {
    available: false,
    helperRunning: false,
    authenticated: false,
    ready: false,
    authInProgress: false,
    message: process.platform === "win32"
      ? "Discord Social SDK helper is unavailable."
      : "Discord Social SDK is only configured for Windows builds."
  };
}
''',
    '''function getUnavailableDiscordSocialState() {
  return {
    available: process.platform === "win32",
    helperRunning: false,
    authenticated: false,
    ready: false,
    authInProgress: false,
    message: process.platform === "win32"
      ? "Discord Social SDK starts only when you connect your account."
      : "Discord Social SDK is only configured for Windows builds."
  };
}
''',
    "dormant Discord social state",
)
main = replace_once(
    main,
    '''handleTrustedIpc("discord-social:start-auth", async () => {
  discordSocial?.startAuth();
  return getDiscordSocialState();
});
''',
    '''handleTrustedIpc("discord-social:start-auth", async () => {
  const socialBridge = ensureDiscordSocialBridge();
  socialBridge?.startAuth();
  return getDiscordSocialState();
});
''',
    "lazy Discord auth",
)
main = replace_once(
    main,
    '''handleTrustedIpc("discord-social:list-friends", async () => {
  if (!discordSocial) {
    return [];
  }

  return discordSocial.listFriends();
});

handleTrustedIpc("discord-social:send-activity-invite", async (_event, payload) => {
  if (!discordSocial) {
    throw new Error("Discord Social SDK is unavailable.");
  }

  return discordSocial.sendActivityInvite(payload || {});
});
''',
    '''handleTrustedIpc("discord-social:list-friends", async () => {
  const socialBridge = ensureDiscordSocialBridge();
  return socialBridge ? socialBridge.listFriends() : [];
});

handleTrustedIpc("discord-social:send-activity-invite", async (_event, payload) => {
  const socialBridge = ensureDiscordSocialBridge();
  if (!socialBridge) {
    throw new Error("Discord Social SDK is unavailable.");
  }

  return socialBridge.sendActivityInvite(payload || {});
});
''',
    "lazy Discord social actions",
)
main = replace_once(
    main,
    '''function getDiscordSocialApplicationId(config = latestDiscordConfig) {
  const candidate = typeof config?.clientId === "string"
    ? config.clientId.trim()
    : "";

  return candidate || DEFAULT_DISCORD_CLIENT_ID;
}

function getDiscordSocialState() {
''',
    '''function getDiscordSocialApplicationId(config = latestDiscordConfig) {
  const candidate = typeof config?.clientId === "string"
    ? config.clientId.trim()
    : "";

  return candidate || DEFAULT_DISCORD_CLIENT_ID;
}

function ensureDiscordSocialBridge() {
  if (discordSocial || process.platform !== "win32") {
    return discordSocial;
  }

  const { createDiscordSocialBridge } = require("./discord-social-bridge");
  discordSocial = createDiscordSocialBridge({
    applicationId: getDiscordSocialApplicationId(latestDiscordConfig),
    appPath: app.getAppPath(),
    execPath: process.execPath,
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
    gameWindowPid: process.pid,
    logger: (message) => {
      logDiscord(message);
    }
  });
  discordSocial.on("state", () => {
    const socialState = getDiscordSocialState();
    logDiscord(
      `[social-sdk] auth=${socialState.authenticated} ready=${socialState.ready} in_progress=${socialState.authInProgress} message=${socialState.message}`
    );
    sendDiscordSocialState();
    void syncDiscordPresence();
  });
  discordSocial.on("join", (joinSecret) => {
    dispatchDeepLink(joinSecret);
  });
  discordSocial.start();
  sendDiscordSocialState();
  return discordSocial;
}

function getDiscordSocialState() {
''',
    "lazy Discord social factory",
)
main = replace_once(
    main,
    '''  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    frame: false,
    backgroundColor: "#171615",
    autoHideMenuBar: true,
    title: "Apollo Client",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
''',
    '''  mainWindow = new BrowserWindow({
    show: false,
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    frame: false,
    backgroundColor: "#171615",
    autoHideMenuBar: true,
    title: "Apollo Client",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
      spellcheck: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
''',
    "resource-conscious BrowserWindow",
)
main = replace_once(
    main,
    '''    void maybeShowClientUpdateNotice();
    void logRendererDesktopBridgeState();
    setTimeout(() => {
      void logRendererDesktopBridgeState();
    }, 1500);
    if (pendingDeepLinkUrl) {
''',
    '''    void maybeShowClientUpdateNotice();
    if (!app.isPackaged || process.env.APOLLO_CLIENT_DIAGNOSTICS === "1") {
      void logRendererDesktopBridgeState();
    }
    if (pendingDeepLinkUrl) {
''',
    "packaged renderer diagnostics",
)
main = replace_once(
    main,
    '''    appLogFilePath = path.join(app.getPath("userData"), "apollo-client.log");
    discordLogFilePath = path.join(app.getPath("userData"), "apollo-discord.log");
    logApp("main", `app ready version=${app.getVersion()} packaged=${app.isPackaged}`);
''',
    '''    appLogFilePath = path.join(app.getPath("userData"), "apollo-client.log");
    appLogWriter.setPath(appLogFilePath);
    logApp("main", `app ready version=${app.getVersion()} packaged=${app.isPackaged}`);
''',
    "single bounded log file",
)
main = replace_block(
    main,
    '''    discordSocial = createDiscordSocialBridge({
''',
    '''    createWindow();
    void checkForClientUpdate();
''',
    "",
    "eager Discord social startup removal",
)
main = replace_once(
    main,
    '''    createWindow();
    void checkForClientUpdate();
    sendDiscordSocialState();
''',
    '''    createWindow();
    if (app.isPackaged && process.env.APOLLO_CLIENT_UPDATE_CHECK !== "0") {
      const updateCheckHandle = setTimeout(() => {
        void checkForClientUpdate();
      }, 15_000);
      updateCheckHandle.unref?.();
    }
    sendDiscordSocialState();
''',
    "deferred update check",
)
main = replace_once(
    main,
    '''    Promise.allSettled([
      listenAlongServer?.stop(),
      discordSocial?.destroy(),
      discordPresence.destroy()
    ]).finally(() => {
''',
    '''    Promise.allSettled([
      listenAlongServer?.stop(),
      discordSocial?.destroy(),
      discordPresence.destroy()
    ]).then(() => appLogWriter.flush()).finally(() => {
''',
    "log flush on quit",
)

discord_path = Path("discord-presence.js")
discord = discord_path.read_text(encoding="utf-8")
discord = replace_once(
    discord,
    '''const RPC = require("discord-rpc");

''',
    '''let cachedDiscordRpc = null;

function loadDiscordRpc() {
  if (!cachedDiscordRpc) {
    cachedDiscordRpc = require("discord-rpc");
  }
  return cachedDiscordRpc;
}

''',
    "lazy Discord RPC import",
)
discord = replace_once(
    discord,
    '''function createDiscordPresenceController({ appName = "Apollo Client", onJoin = null, logger = null } = {}) {
''',
    '''function createDiscordPresenceController({
  appName = "Apollo Client",
  onJoin = null,
  logger = null,
  loadRpc = loadDiscordRpc
} = {}) {
''',
    "injectable Discord RPC loader",
)
discord = replace_once(
    discord,
    '''    clearReconnectTimer();

    const nextClient = new RPC.Client({ transport: "ipc" });
''',
    '''    clearReconnectTimer();

    let RPC;
    try {
      RPC = loadRpc();
    } catch (error) {
      log(`load failed error=${error?.message || "unknown"}`);
      scheduleReconnect();
      return null;
    }

    const nextClient = new RPC.Client({ transport: "ipc" });
''',
    "deferred Discord RPC load",
)
discord = replace_once(
    discord,
    '''module.exports = {
  createDiscordPresenceController
};
''',
    '''module.exports = {
  createDiscordPresenceController,
  loadDiscordRpc
};
''',
    "Discord RPC exports",
)

runtime_path = Path("src/preload/runtime-assets.js")
runtime = runtime_path.read_text(encoding="utf-8")
runtime = replace_once(
    runtime,
    '''  const events = createEventChannel();
  const watchers = [];
  let notifyHandle = null;
''',
    '''  const events = createEventChannel();
  const watchers = [];
  const watchRuntimeAssets = !runtimeInfo.isPackaged || env.APOLLO_WATCH_RUNTIME_ASSETS === "1";
  let watchersInitialised = false;
  let notifyHandle = null;
''',
    "runtime watcher policy",
)
runtime = replace_once(
    runtime,
    '''  function getRuntimePluginDirectories() {
    return uniquePaths([
      env.APOLLO_PLUGIN_DIR,
      runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "plugins") : "",
      runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "plugins") : "",
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "plugins") : ""
    ]);
  }

  function getRuntimeThemeDirectories() {
    return uniquePaths([
      env.APOLLO_THEME_DIR,
      runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "themes") : "",
      runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "themes") : "",
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "themes") : ""
    ]);
  }
''',
    '''  function getRuntimePluginDirectories() {
    return uniquePaths([
      env.APOLLO_PLUGIN_DIR,
      ...(!runtimeInfo.isPackaged ? [
        runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "plugins") : "",
        runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "plugins") : ""
      ] : []),
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "plugins") : ""
    ]);
  }

  function getRuntimeThemeDirectories() {
    return uniquePaths([
      env.APOLLO_THEME_DIR,
      ...(!runtimeInfo.isPackaged ? [
        runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "themes") : "",
        runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "themes") : ""
      ] : []),
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "themes") : ""
    ]);
  }
''',
    "packaged runtime asset directories",
)
runtime = replace_once(
    runtime,
    '''  function resolveAppConfigCandidatePaths() {
    return uniquePaths([
      env.APOLLO_CONFIG_PATH,
      runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "apollo.config.json") : "",
      runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "apollo.config.json") : "",
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "apollo.config.json") : "",
      path.join(appRootPath, "apollo.config.json")
    ]);
  }
''',
    '''  function resolveAppConfigCandidatePaths() {
    return uniquePaths([
      env.APOLLO_CONFIG_PATH,
      ...(!runtimeInfo.isPackaged ? [
        runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "apollo.config.json") : "",
        runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "apollo.config.json") : "",
        path.join(appRootPath, "apollo.config.json")
      ] : []),
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "apollo.config.json") : ""
    ]);
  }
''',
    "packaged app config paths",
)
runtime = replace_once(
    runtime,
    '''  function onChanged(callback) {
    return events.subscribe(callback, () => ({
      reason: "initial",
      snapshot: getSnapshot()
    }));
  }
''',
    '''  function onChanged(callback) {
    if (watchRuntimeAssets && !watchersInitialised) {
      watchersInitialised = true;
      initialiseWatchers();
    }

    return events.subscribe(callback, () => ({
      reason: "initial",
      snapshot: getSnapshot()
    }));
  }
''',
    "lazy runtime watchers",
)
runtime = replace_once(
    runtime,
    '''
  initialiseWatchers();

  return {
''',
    '''
  return {
''',
    "eager runtime watcher removal",
)

renderer_path = Path("src/renderer.js")
renderer = renderer_path.read_text(encoding="utf-8")
renderer = replace_once(
    renderer,
    '''import { createPollingController } from "./renderer/polling-controller.js";
import {
''',
    '''import { createPollingController } from "./renderer/polling-controller.js";
import {
  createIntervalGate,
  getLruMapValue,
  setLruMapValue,
  trimOldestArrayEntries
} from "./renderer/resource-controls.js";
import {
''',
    "renderer resource controls import",
)
renderer = replace_once(
    renderer,
    '''const PLAYBACK_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const DURATION_CACHE_STORAGE_KEY = "apollo-duration-cache-v1";
''',
    '''const PLAYBACK_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAYBACK_URL_CACHE_MAX_ENTRIES = 256;
const PLAYBACK_FAILURE_CACHE_MAX_ENTRIES = 128;
const DURATION_CACHE_MAX_ENTRIES = 800;
const ARTIST_PROFILE_CACHE_MAX_ENTRIES = 48;
const ARTIST_TRACKS_CACHE_MAX_ENTRIES = 8;
const ARTIST_RELEASES_CACHE_MAX_ENTRIES = 48;
const NAVIGATION_HISTORY_MAX_ENTRIES = 16;
const PLAYBACK_PREFETCH_LIMIT = 3;
const PLAYBACK_UI_UPDATE_INTERVAL_MS = 250;
const PLAYBACK_STATE_PERSIST_INTERVAL_MS = 1000;
const DURATION_CACHE_STORAGE_KEY = "apollo-duration-cache-v1";
''',
    "renderer resource limits",
)
renderer = replace_once(
    renderer,
    '''const artistProfileCache = new Map();
const artistTracksCache = new Map();
const artistReleasesCache = new Map();
const pendingDurationKeys = new Set();
''',
    '''const artistProfileCache = new Map();
const artistTracksCache = new Map();
const artistReleasesCache = new Map();
const playbackUiUpdateGate = createIntervalGate(PLAYBACK_UI_UPDATE_INTERVAL_MS);
const playbackStatePersistenceGate = createIntervalGate(PLAYBACK_STATE_PERSIST_INTERVAL_MS);
const pendingDurationKeys = new Set();
''',
    "renderer hot-path gates",
)
renderer = replace_once(
    renderer,
    '''function persistPlaybackState() {
  persistStoredPlaybackState(localStorage, {
''',
    '''function persistPlaybackState({ force = false } = {}) {
  if (!playbackStatePersistenceGate.shouldRun({ force })) {
    return;
  }

  persistStoredPlaybackState(localStorage, {
''',
    "throttled playback persistence",
)
renderer = replace_once(
    renderer,
    '''function getCachedDuration(track) {
  return durationCache.get(track.key) ?? track.duration ?? getKnownDurationForTrack(track) ?? null;
}
''',
    '''function getCachedDuration(track) {
  return getLruMapValue(durationCache, track.key) ?? track.duration ?? getKnownDurationForTrack(track) ?? null;
}
''',
    "duration cache LRU read",
)
renderer = replace_exact_count(
    renderer,
    '''durationCache.set(track.key, durationSeconds);''',
    '''setLruMapValue(durationCache, track.key, durationSeconds, DURATION_CACHE_MAX_ENTRIES);''',
    1,
    "duration cache write",
)
renderer = replace_once(renderer, '''  const entry = playbackUrlCache.get(trackKey);
''', '''  const entry = getLruMapValue(playbackUrlCache, trackKey);
''', "playback URL LRU read")
renderer = replace_once(
    renderer,
    '''  playbackUrlCache.set(trackKey, {
    url,
    expiresAt: Number.isFinite(ttlMs)
      ? Date.now() + Math.max(0, ttlMs)
      : Number.POSITIVE_INFINITY
  });
''',
    '''  setLruMapValue(playbackUrlCache, trackKey, {
    url,
    expiresAt: Number.isFinite(ttlMs)
      ? Date.now() + Math.max(0, ttlMs)
      : Number.POSITIVE_INFINITY
  }, PLAYBACK_URL_CACHE_MAX_ENTRIES);
''',
    "bounded playback URL cache",
)
renderer = replace_once(renderer, '''  return playbackFailureCache.get(trackKey) || null;
''', '''  return getLruMapValue(playbackFailureCache, trackKey) || null;
''', "playback failure LRU read")
renderer = replace_once(
    renderer,
    '''  playbackFailureCache.set(track.key, {
    message,
    recordedAt: Date.now()
  });
''',
    '''  setLruMapValue(playbackFailureCache, track.key, {
    message,
    recordedAt: Date.now()
  }, PLAYBACK_FAILURE_CACHE_MAX_ENTRIES);
''',
    "bounded playback failure cache",
)
renderer = replace_once(
    renderer,
    '''async function fetchArtistProfile(artistId, { signal } = {}) {
  if (artistProfileCache.has(artistId)) {
    return artistProfileCache.get(artistId);
  }
''',
    '''async function fetchArtistProfile(artistId, { signal } = {}) {
  const cachedProfile = getLruMapValue(artistProfileCache, artistId);
  if (cachedProfile) {
    return cachedProfile;
  }
''',
    "artist profile LRU read",
)
renderer = replace_once(renderer, '''  artistProfileCache.set(artistId, profile);
''', '''  setLruMapValue(artistProfileCache, artistId, profile, ARTIST_PROFILE_CACHE_MAX_ENTRIES);
''', "bounded artist profile cache")
renderer = replace_once(
    renderer,
    '''async function fetchArtistTracks(artistId, { signal } = {}) {
  if (artistTracksCache.has(artistId)) {
    return artistTracksCache.get(artistId);
  }
''',
    '''async function fetchArtistTracks(artistId, { signal } = {}) {
  const cachedTracks = getLruMapValue(artistTracksCache, artistId);
  if (cachedTracks) {
    return cachedTracks;
  }
''',
    "artist tracks LRU read",
)
renderer = replace_once(renderer, '''  artistTracksCache.set(artistId, tracks);
''', '''  setLruMapValue(artistTracksCache, artistId, tracks, ARTIST_TRACKS_CACHE_MAX_ENTRIES);
''', "bounded artist tracks cache")
renderer = replace_once(
    renderer,
    '''async function fetchArtistReleases(artistId, { signal } = {}) {
  if (artistReleasesCache.has(artistId)) {
    return artistReleasesCache.get(artistId);
  }
''',
    '''async function fetchArtistReleases(artistId, { signal } = {}) {
  const cachedReleases = getLruMapValue(artistReleasesCache, artistId);
  if (cachedReleases) {
    return cachedReleases;
  }
''',
    "artist releases LRU read",
)
renderer = replace_once(renderer, '''  artistReleasesCache.set(artistId, releases);
''', '''  setLruMapValue(artistReleasesCache, artistId, releases, ARTIST_RELEASES_CACHE_MAX_ENTRIES);
''', "bounded artist releases cache")
renderer = replace_once(
    renderer,
    '''  durationCache.set(track.key, Number(snapshot.durationSeconds) || 0);
''',
    '''  setLruMapValue(
    durationCache,
    track.key,
    Number(snapshot.durationSeconds) || 0,
    DURATION_CACHE_MAX_ENTRIES
  );
''',
    "listen-along duration cache",
)
renderer = replace_once(
    renderer,
    '''      durationCache.set(playbackTrack.key, element.duration);
      persistDurationCache();
''',
    '''      setLruMapValue(
        durationCache,
        playbackTrack.key,
        element.duration,
        DURATION_CACHE_MAX_ENTRIES
      );
      persistDurationCache();
''',
    "metadata duration cache",
)
renderer = replace_once(
    renderer,
    '''  const upcomingTracks = getOrderedUpcomingQueueEntries()
    .map((entry) => entry.track)
    .filter(Boolean);
''',
    '''  const upcomingTracks = getOrderedUpcomingQueueEntries()
    .map((entry) => entry.track)
    .filter(Boolean)
    .slice(0, PLAYBACK_PREFETCH_LIMIT);
''',
    "bounded playback prefetch",
)
renderer = replace_exact_count(
    renderer,
    '''    navigationBackStack.push(structuredClone(currentNavigationSnapshot));
''',
    '''    navigationBackStack.push(structuredClone(currentNavigationSnapshot));
    trimOldestArrayEntries(navigationBackStack, NAVIGATION_HISTORY_MAX_ENTRIES);
''',
    2,
    "bounded back navigation history",
)
renderer = replace_once(
    renderer,
    '''    navigationForwardStack.push(structuredClone(currentNavigationSnapshot));
''',
    '''    navigationForwardStack.push(structuredClone(currentNavigationSnapshot));
    trimOldestArrayEntries(navigationForwardStack, NAVIGATION_HISTORY_MAX_ENTRIES);
''',
    "bounded forward navigation history",
)
renderer = replace_once(
    renderer,
    '''  element.addEventListener("timeupdate", (event) => {
    if (!isPlaybackEventForActiveDeck(event)) {
      return;
    }

    renderPlayback();
''',
    '''  element.addEventListener("timeupdate", (event) => {
    if (!isPlaybackEventForActiveDeck(event)) {
      return;
    }

    if (!playbackUiUpdateGate.shouldRun()) {
      return;
    }

    renderPlayback();
''',
    "throttled playback UI updates",
)
renderer = replace_once(
    renderer,
    '''window.addEventListener("beforeunload", () => {
  for (const downloadId of activeDownloadWatchers.keys()) {
''',
    '''window.addEventListener("beforeunload", () => {
  persistPlaybackState({ force: true });
  for (const downloadId of activeDownloadWatchers.keys()) {
''',
    "forced final playback persistence",
)

styles_path = Path("src/styles.css")
styles = styles_path.read_text(encoding="utf-8")
if "/* Electron resource containment */" not in styles:
    styles = styles.rstrip() + '''

/* Electron resource containment */
.track-row {
  content-visibility: auto;
  contain-intrinsic-size: 72px;
}
'''

for source, forbidden in (
    (main, "discordLogFilePath"),
    (main, "fs.appendFileSync"),
    (main, "fs.statSync"),
    (discord, 'const RPC = require("discord-rpc")'),
    (runtime, "\n  initialiseWatchers();\n"),
    (renderer, "trackSearchIndex"),
):
    if forbidden in source:
        raise SystemExit(f"stale resource-intensive fragment remains: {forbidden}")

for required in ("backgroundThrottling: true", "function ensureDiscordSocialBridge()", "appLogWriter.flush()"):
    if required not in main:
        raise SystemExit(f"missing main-process resource control: {required}")
for required in ("watchRuntimeAssets", "!runtimeInfo.isPackaged"):
    if required not in runtime:
        raise SystemExit(f"missing runtime asset resource control: {required}")
for required in (
    "PLAYBACK_PREFETCH_LIMIT",
    "playbackUiUpdateGate.shouldRun()",
    "playbackStatePersistenceGate.shouldRun",
    "NAVIGATION_HISTORY_MAX_ENTRIES",
):
    if required not in renderer:
        raise SystemExit(f"missing renderer resource control: {required}")

main_path.write_text(main, encoding="utf-8")
discord_path.write_text(discord, encoding="utf-8")
runtime_path.write_text(runtime, encoding="utf-8")
renderer_path.write_text(renderer, encoding="utf-8")
styles_path.write_text(styles, encoding="utf-8")
print("Applied Electron startup, memory, CPU, and package-size controls.")
