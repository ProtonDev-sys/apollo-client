const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const mqtt = require("mqtt");
const { contextBridge, ipcRenderer } = require("electron");
const { createEventChannel, createStateStore } = require("./src/preload/state-store");
const {
  createListenAlongSignaling,
  DEFAULT_LISTEN_ALONG_SIGNAL_BROKER_URL
} = require("./src/preload/listen-along-signaling");
const { createRuntimeAssetsService } = require("./src/preload/runtime-assets");

const DEFAULT_DISCORD_CLIENT_ID = "1480728455263031296";
const deepLinkEvents = createEventChannel();
const windowStateStore = createStateStore({
  isFocused: true,
  isMaximized: false
});
const discordSocialStateStore = createStateStore({
  available: false,
  helperRunning: false,
  authenticated: false,
  ready: false,
  authInProgress: false,
  message: "Discord Social SDK unavailable."
});
const listenAlongStateStore = createStateStore({
  available: false,
  running: false,
  port: 0,
  advertisedHosts: [],
  message: "Listen along server unavailable."
});
let pendingDeepLinkUrl = "";

const runtimeInfo = (() => {
  try {
    return ipcRenderer.sendSync("app:get-runtime-info-sync") || {};
  } catch {
    return {};
  }
})();

function logRendererEvent(source, message, details = null) {
  ipcRenderer.send("app:log", {
    source,
    message,
    details
  });
}

const runtimeAssets = createRuntimeAssetsService({
  fs,
  path,
  pathToFileURL,
  runtimeInfo,
  appRootPath: __dirname,
  logEvent: logRendererEvent
});
const listenAlongSignaling = createListenAlongSignaling({
  mqtt,
  brokerUrl: DEFAULT_LISTEN_ALONG_SIGNAL_BROKER_URL
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    runtimeAssets.dispose();
    listenAlongSignaling.dispose();
  });
}

ipcRenderer.on("apollo:deep-link", (_event, url) => {
  pendingDeepLinkUrl = url;
  deepLinkEvents.emit(url);
});

ipcRenderer.on("window-controls:state-changed", (_event, state) => {
  windowStateStore.patchState(state && typeof state === "object" ? state : {});
});

ipcRenderer.on("discord-social:state-changed", (_event, state) => {
  discordSocialStateStore.patchState(state && typeof state === "object" ? state : {});
});

ipcRenderer.on("listen-along:state-changed", (_event, state) => {
  const previousState = listenAlongStateStore.getState();
  listenAlongStateStore.setState({
    ...previousState,
    ...(state && typeof state === "object" ? state : {}),
    advertisedHosts: Array.isArray(state?.advertisedHosts)
      ? state.advertisedHosts
      : previousState.advertisedHosts
  });
});

contextBridge.exposeInMainWorld("apolloDesktop", {
  platform: process.platform,
  serverUrl: process.env.APOLLO_SERVER_URL || "http://127.0.0.1:4848",
  appVersion: runtimeInfo.appVersion || "0.0.0",
  appConfig: runtimeAssets.getCurrentAppConfig(),
  versions: process.versions,
  logging: {
    available: true,
    getPath: () => runtimeInfo.logPath || "",
    write: (source, message, details) => {
      logRendererEvent(source || "renderer", message || "", details ?? null);
      return true;
    }
  },
  runtimeAssets: {
    getSnapshot: () => runtimeAssets.getSnapshot(),
    getAppConfig: () => runtimeAssets.getAppConfig(),
    getPlugins: () => runtimeAssets.getPlugins(),
    onChanged: (callback) => runtimeAssets.onChanged(callback)
  },
  discordPresenceDefaults: {
    enabled: true,
    clientId: process.env.APOLLO_DISCORD_CLIENT_ID || DEFAULT_DISCORD_CLIENT_ID,
    largeImageKey: process.env.APOLLO_DISCORD_LARGE_IMAGE_KEY || "",
    largeImageText: process.env.APOLLO_DISCORD_LARGE_IMAGE_TEXT || "Apollo Client",
    smallImageKeyPlaying: process.env.APOLLO_DISCORD_SMALL_IMAGE_KEY_PLAYING || "",
    smallImageKeyPaused: process.env.APOLLO_DISCORD_SMALL_IMAGE_KEY_PAUSED || "",
    smallImageKeyBuffering: process.env.APOLLO_DISCORD_SMALL_IMAGE_KEY_BUFFERING || ""
  },
  onDeepLink: (callback) => {
    const unsubscribe = deepLinkEvents.subscribe(callback);
    if (typeof callback === "function" && pendingDeepLinkUrl) {
      callback(pendingDeepLinkUrl);
    }
    return unsubscribe;
  },
  windowControls: {
    available: true,
    getState: () => ipcRenderer.invoke("window-controls:get-state"),
    minimize: () => ipcRenderer.send("window-controls:minimize"),
    toggleMaximize: () => ipcRenderer.send("window-controls:toggle-maximize"),
    close: () => ipcRenderer.send("window-controls:close"),
    onStateChange: (callback) => windowStateStore.subscribe(callback)
  },
  discordPresence: {
    available: true,
    configure: (config) => ipcRenderer.invoke("discord-presence:configure", config),
    updatePlayback: (playback) => ipcRenderer.send("discord-presence:update-playback", playback),
    clear: () => ipcRenderer.send("discord-presence:clear")
  },
  discordSocial: {
    available: process.platform === "win32",
    getState: () => ipcRenderer.invoke("discord-social:get-state"),
    startAuth: () => ipcRenderer.invoke("discord-social:start-auth"),
    signOut: () => ipcRenderer.invoke("discord-social:sign-out"),
    listFriends: () => ipcRenderer.invoke("discord-social:list-friends"),
    sendActivityInvite: (payload) => ipcRenderer.invoke("discord-social:send-activity-invite", payload),
    onStateChange: (callback) => discordSocialStateStore.subscribe(callback)
  },
  listenAlong: {
    available: true,
    getState: () => ipcRenderer.invoke("listen-along:get-state"),
    publishSession: (payload) => ipcRenderer.invoke("listen-along:publish-session", payload),
    clearSession: (sessionId) => ipcRenderer.invoke("listen-along:clear-session", sessionId),
    onStateChange: (callback) => listenAlongStateStore.subscribe(callback)
  },
  listenAlongSignaling: {
    available: true,
    getState: () => listenAlongSignaling.getState(),
    connectRoom: (sessionId) => listenAlongSignaling.connectRoom(sessionId),
    disconnectRoom: (sessionId) => listenAlongSignaling.disconnectRoom(sessionId),
    publish: (sessionId, payload) => listenAlongSignaling.publish(sessionId, payload),
    onSignal: (callback) => listenAlongSignaling.onSignal(callback),
    onStateChange: (callback) => listenAlongSignaling.onStateChange(callback)
  }
});
