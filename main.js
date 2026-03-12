const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { createDiscordPresenceController } = require("./discord-presence");
const { createDiscordSocialBridge } = require("./discord-social-bridge");
const { createListenAlongServer } = require("./src/listen-along-p2p");

const APOLLO_PROTOCOL = "apollo";
const DEFAULT_DISCORD_CLIENT_ID = "1480728455263031296";
const WINDOWS_APP_USER_MODEL_ID = "com.apollo.client";
const GITHUB_REPO_OWNER = process.env.APOLLO_CLIENT_GITHUB_OWNER || "ProtonDev-sys";
const GITHUB_REPO_NAME = process.env.APOLLO_CLIENT_GITHUB_REPO || "apollo-client";
const GITHUB_REPO_BRANCH = process.env.APOLLO_CLIENT_GITHUB_BRANCH || "main";
const GITHUB_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/${GITHUB_REPO_BRANCH}/package.json`;
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const CLIENT_UPDATE_TIMEOUT_MS = 5000;

const discordPresence = createDiscordPresenceController({
  appName: "Apollo Client",
  logger: (message) => {
    logDiscord(message);
  },
  onJoin: (joinSecret) => {
    if (typeof joinSecret === "string" && joinSecret.startsWith(`${APOLLO_PROTOCOL}://`)) {
      dispatchDeepLink(joinSecret);
    }
  }
});
let discordSocial = null;
let mainWindow = null;
let pendingDeepLinkUrl = null;
let latestDiscordConfig = null;
let latestDiscordPlayback = null;
let latestDiscordSocialConfigSignature = "";
let isCleaningUpForQuit = false;
let appLogFilePath = null;
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

function buildRuntimeInfo() {
  const execPath = process.execPath || "";
  return {
    appVersion: app.getVersion(),
    appPath: app.getAppPath(),
    userDataPath: app.getPath("userData"),
    execPath,
    execDirectory: execPath ? path.dirname(execPath) : "",
    currentWorkingDirectory: (() => {
      try {
        return process.cwd();
      } catch {
        return "";
      }
    })(),
    logPath: appLogFilePath || path.join(app.getPath("userData"), "apollo-client.log"),
    isPackaged: app.isPackaged
  };
}

function compareClientVersions(left, right) {
  const parseVersion = (value) => {
    const raw = String(value || "").trim();
    const [core = "", prerelease = ""] = raw.split("-", 2);
    return {
      raw,
      prerelease,
      parts: core.split(".").map((segment) => Number.parseInt(segment, 10))
    };
  };

  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const maxParts = Math.max(leftVersion.parts.length, rightVersion.parts.length);

  for (let index = 0; index < maxParts; index += 1) {
    const leftPart = Number.isFinite(leftVersion.parts[index]) ? leftVersion.parts[index] : 0;
    const rightPart = Number.isFinite(rightVersion.parts[index]) ? rightVersion.parts[index] : 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  if (leftVersion.prerelease && !rightVersion.prerelease) {
    return -1;
  }

  if (!leftVersion.prerelease && rightVersion.prerelease) {
    return 1;
  }

  return leftVersion.prerelease.localeCompare(rightVersion.prerelease);
}

async function fetchLatestGithubClientVersion() {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, CLIENT_UPDATE_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_PACKAGE_URL, {
      signal: abortController.signal,
      headers: {
        "Cache-Control": "no-cache"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}`);
    }

    const payload = await response.json();
    const version = String(payload?.version || "").trim();
    if (!version) {
      throw new Error("GitHub package.json did not include a version");
    }

    return version;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function maybeShowClientUpdateNotice() {
  if (
    hasShownClientUpdateNotice
    || !pendingClientUpdateNotice
    || !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isLoadingMainFrame()
  ) {
    return;
  }

  sendToWindow(mainWindow, "app:client-update-required", {
    ...pendingClientUpdateNotice,
    branch: GITHUB_REPO_BRANCH
  });
  logApp("update", "client update notice sent to renderer");
}

async function checkForClientUpdate() {
  try {
    const currentVersion = String(app.getVersion() || "").trim();
    const latestVersion = await fetchLatestGithubClientVersion();
    if (!currentVersion || compareClientVersions(currentVersion, latestVersion) >= 0) {
      return;
    }

    pendingClientUpdateNotice = {
      currentVersion,
      latestVersion
    };
    logApp("update", `client update required current=${currentVersion} latest=${latestVersion}`);
    await maybeShowClientUpdateNotice();
  } catch (error) {
    logApp("update", `client update check failed error=${error?.message || "unknown"}`);
  }
}

function buildWindowState(window) {
  if (!window || window.isDestroyed()) {
    return {
      isFocused: false,
      isMaximized: false
    };
  }

  return {
    isFocused: window.isFocused(),
    isMaximized: window.isMaximized()
  };
}

function canSendToWindow(window) {
  return Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed());
}

function sendToWindow(window, channel, payload) {
  if (!canSendToWindow(window)) {
    return;
  }

  window.webContents.send(channel, payload);
}

function sendWindowState(window) {
  sendToWindow(window, "window-controls:state-changed", buildWindowState(window));
}

function getEventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function getUnavailableDiscordSocialState() {
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

function getListenAlongState() {
  return listenAlongServer?.getState?.() || {
    available: false,
    running: false,
    port: 0,
    advertisedHosts: [],
    message: "Listen along server is unavailable."
  };
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

ipcMain.handle("discord-presence:configure", (_event, config) => {
  latestDiscordConfig = config;
  logDiscord(`configure enabled=${Boolean(config?.enabled)} clientId=${config?.clientId || ""}`);
  if (discordSocial) {
    discordSocial.configure(config);
  }
  return syncDiscordPresence();
});

ipcMain.on("discord-presence:update-playback", (_event, playback) => {
  latestDiscordPlayback = playback;
  logDiscord(`update-playback title=${playback?.title || ""} status=${playback?.status || ""}`);
  void syncDiscordPresence();
});

ipcMain.on("discord-presence:clear", () => {
  latestDiscordPlayback = null;
  logDiscord("clear-playback");
  void syncDiscordPresence();
});

ipcMain.handle("discord-social:get-state", () => {
  return getDiscordSocialState();
});

ipcMain.handle("discord-social:start-auth", async () => {
  discordSocial?.startAuth();
  return getDiscordSocialState();
});

ipcMain.handle("discord-social:sign-out", async () => {
  discordSocial?.signOut();
  return getDiscordSocialState();
});

ipcMain.handle("discord-social:list-friends", async () => {
  if (!discordSocial) {
    return [];
  }

  return discordSocial.listFriends();
});

ipcMain.handle("discord-social:send-activity-invite", async (_event, payload) => {
  if (!discordSocial) {
    throw new Error("Discord Social SDK is unavailable.");
  }

  return discordSocial.sendActivityInvite(payload || {});
});

ipcMain.handle("listen-along:get-state", async () => {
  return getListenAlongState();
});

ipcMain.handle("listen-along:publish-session", async (_event, payload) => {
  if (!listenAlongServer) {
    throw new Error("Listen along server is unavailable.");
  }

  const result = await listenAlongServer.publishSession(payload || {});
  sendListenAlongState();
  return result;
});

ipcMain.handle("listen-along:clear-session", async (_event, sessionId) => {
  listenAlongServer?.clearSession?.(sessionId);
  return listenAlongServer?.getState?.() || null;
});

ipcMain.on("app:get-runtime-info-sync", (event) => {
  event.returnValue = buildRuntimeInfo();
});

ipcMain.handle("app:get-pending-client-update", () => {
  if (!pendingClientUpdateNotice) {
    return null;
  }

  return {
    ...pendingClientUpdateNotice,
    branch: GITHUB_REPO_BRANCH
  };
});

ipcMain.handle("app:ack-client-update-required", () => {
  if (!pendingClientUpdateNotice) {
    return false;
  }

  hasShownClientUpdateNotice = true;
  pendingClientUpdateNotice = null;
  logApp("update", "client update notice acknowledged by renderer");
  return true;
});

ipcMain.handle("app:open-external-url", async (_event, url) => {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    return false;
  }

  await shell.openExternal(targetUrl);
  logApp("main", `opened external url=${targetUrl}`);
  return true;
});

ipcMain.on("app:log", (_event, payload) => {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const source = String(payload.source || "renderer").trim() || "renderer";
  const message = String(payload.message || "").trim();
  const details = typeof payload.details === "string"
    ? payload.details.trim()
    : payload.details != null
      ? JSON.stringify(payload.details)
      : "";

  if (!message && !details) {
    return;
  }

  logApp(source, details ? `${message} ${details}`.trim() : message);
});

ipcMain.handle("window-controls:get-state", (event) => {
  return buildWindowState(getEventWindow(event));
});

ipcMain.on("window-controls:minimize", (event) => {
  getEventWindow(event)?.minimize();
});

ipcMain.on("window-controls:toggle-maximize", (event) => {
  const window = getEventWindow(event);
  if (!window) {
    return;
  }

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on("window-controls:close", (event) => {
  getEventWindow(event)?.close();
});

function getDiscordPresenceDefaults() {
  return {
    enabled: true,
    clientId: process.env.APOLLO_DISCORD_CLIENT_ID || DEFAULT_DISCORD_CLIENT_ID,
    largeImageKey: process.env.APOLLO_DISCORD_LARGE_IMAGE_KEY || "",
    largeImageText: process.env.APOLLO_DISCORD_LARGE_IMAGE_TEXT || "Apollo Client",
    smallImageKeyPlaying: process.env.APOLLO_DISCORD_SMALL_IMAGE_KEY_PLAYING || "",
    smallImageKeyPaused: process.env.APOLLO_DISCORD_SMALL_IMAGE_KEY_PAUSED || "",
    smallImageKeyBuffering: process.env.APOLLO_DISCORD_SMALL_IMAGE_KEY_BUFFERING || ""
  };
}

function getDiscordSocialApplicationId(config = latestDiscordConfig) {
  const candidate = typeof config?.clientId === "string"
    ? config.clientId.trim()
    : "";

  return candidate || DEFAULT_DISCORD_CLIENT_ID;
}

function getDiscordSocialState() {
  if (!discordSocial) {
    return getUnavailableDiscordSocialState();
  }

  return discordSocial.getState();
}

function sendDiscordSocialState() {
  sendToWindow(mainWindow, "discord-social:state-changed", getDiscordSocialState());
}

function sendListenAlongState() {
  sendToWindow(mainWindow, "listen-along:state-changed", getListenAlongState());
}

async function logRendererDesktopBridgeState() {
  if (!canSendToWindow(mainWindow)) {
    return;
  }

  try {
    const bridgeSummary = await mainWindow.webContents.executeJavaScript(`
      JSON.stringify({
        hasApolloDesktop: Boolean(window.apolloDesktop),
        hasDiscordPresence: Boolean(window.apolloDesktop?.discordPresence),
        hasDiscordSocial: Boolean(window.apolloDesktop?.discordSocial),
        discordSocialAvailable: Boolean(window.apolloDesktop?.discordSocial?.available),
        hasWindowControls: Boolean(window.apolloDesktop?.windowControls),
        windowControlsAvailable: Boolean(window.apolloDesktop?.windowControls?.available)
      })
    `, true);
    logDiscord(`[renderer-bridge] ${bridgeSummary}`);
  } catch (error) {
    logDiscord(`[renderer-bridge] probe failed error=${error?.message || "unknown"}`);
  }
}

function discordSocialCanHandlePresence() {
  const state = getDiscordSocialState();
  return state.available && state.helperRunning;
}

async function syncDiscordPresence() {
  const config = latestDiscordConfig || getDiscordPresenceDefaults();
  if (discordSocial) {
    const nextSignature = JSON.stringify({
      clientId: config.clientId || "",
      largeImageKey: config.largeImageKey || "",
      largeImageText: config.largeImageText || "",
      smallImageKeyPlaying: config.smallImageKeyPlaying || "",
      smallImageKeyPaused: config.smallImageKeyPaused || "",
      smallImageKeyBuffering: config.smallImageKeyBuffering || ""
    });
    if (nextSignature !== latestDiscordSocialConfigSignature) {
      discordSocial.configure(config);
      latestDiscordSocialConfigSignature = nextSignature;
    }
  }

  if (!config.enabled) {
    await discordPresence.configure({
      ...config,
      enabled: false
    });
    logDiscord("sync disabled -> clear all");
    if (discordSocial) {
      await discordSocial.clear();
    }
    await discordPresence.clear();
    return;
  }

  if (!latestDiscordPlayback) {
    await discordPresence.configure({
      ...config,
      enabled: !discordSocialCanHandlePresence()
    });
    logDiscord(`sync no-playback social_active=${discordSocialCanHandlePresence()}`);
    if (discordSocialCanHandlePresence()) {
      await discordSocial.clear();
    }
    await discordPresence.clear();
    return;
  }

  if (discordSocialCanHandlePresence()) {
    await discordPresence.configure({
      ...config,
      enabled: false
    });
    logDiscord(
      latestDiscordPlayback?.joinSecret
        ? "sync using social presence (joinable)"
        : "sync using social presence"
    );
    discordSocial?.updatePlayback(latestDiscordPlayback);
    await discordPresence.clear();
    return;
  }

  await discordPresence.configure(config);
  logDiscord("sync using legacy rpc");
  await discordPresence.updatePlayback(latestDiscordPlayback);
}

function findDeepLinkArg(argv = []) {
  return argv.find((value) => typeof value === "string" && value.startsWith(`${APOLLO_PROTOCOL}://`)) || null;
}

function registerApolloProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APOLLO_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient(APOLLO_PROTOCOL);
}

function dispatchDeepLink(url) {
  if (!url) {
    return;
  }

  pendingDeepLinkUrl = url;
  if (!mainWindow) {
    return;
  }

  const send = () => {
    if (!canSendToWindow(mainWindow) || pendingDeepLinkUrl !== url) {
      return;
    }

    sendToWindow(mainWindow, "apollo:deep-link", url);
    pendingDeepLinkUrl = null;
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once("did-finish-load", send);
    return;
  }

  send();
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    logDiscord(`[preload-error] path=${preloadPath} error=${error?.message || "unknown"}`);
  });

  mainWindow.on("closed", () => {
    if (mainWindow) {
      mainWindow = null;
    }
  });

  ["focus", "blur", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"].forEach((eventName) => {
    mainWindow.on(eventName, () => {
      sendWindowState(mainWindow);
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    sendWindowState(mainWindow);
    sendDiscordSocialState();
    sendListenAlongState();
    void maybeShowClientUpdateNotice();
    void logRendererDesktopBridgeState();
    setTimeout(() => {
      void logRendererDesktopBridgeState();
    }, 1500);
    if (pendingDeepLinkUrl) {
      dispatchDeepLink(pendingDeepLinkUrl);
    }
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    dispatchDeepLink(findDeepLinkArg(commandLine));
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchDeepLink(url);
  });

  app.whenReady().then(() => {
    appLogFilePath = path.join(app.getPath("userData"), "apollo-client.log");
    discordLogFilePath = path.join(app.getPath("userData"), "apollo-discord.log");
    logApp("main", `app ready version=${app.getVersion()} packaged=${app.isPackaged}`);
    logDiscord("app ready");
    if (process.platform === "win32") {
      app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
    }
    registerApolloProtocol();
    latestDiscordConfig = getDiscordPresenceDefaults();
    listenAlongServer = createListenAlongServer({
      logger: (message) => {
        logDiscord(message);
      }
    });
    listenAlongServer.on("state", () => {
      const state = listenAlongServer?.getState?.();
      logDiscord(
        `[listen-along] running=${Boolean(state?.running)} port=${state?.port || 0} hosts=${(state?.advertisedHosts || []).join(",")}`
      );
      sendListenAlongState();
    });
    void listenAlongServer.start().catch((error) => {
      logDiscord(`[listen-along] start failed error=${error?.message || "unknown"}`);
      sendListenAlongState();
    });
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
    createWindow();
    void checkForClientUpdate();
    sendDiscordSocialState();
    void syncDiscordPresence();
    dispatchDeepLink(findDeepLinkArg(process.argv));

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.focus();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (isCleaningUpForQuit) {
      return;
    }

    event.preventDefault();
    isCleaningUpForQuit = true;

    Promise.allSettled([
      listenAlongServer?.stop(),
      discordSocial?.destroy(),
      discordPresence.destroy()
    ]).finally(() => {
      app.quit();
    });
  });
}
