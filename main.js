const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { createDiscordPresenceController } = require("./discord-presence");
const { createDiscordSocialBridge } = require("./discord-social-bridge");

const APOLLO_PROTOCOL = "apollo";
const DEFAULT_DISCORD_CLIENT_ID = "1480728455263031296";

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
let discordLogFilePath = null;

function logDiscord(message) {
  if (!discordLogFilePath) {
    return;
  }

  try {
    fs.appendFileSync(discordLogFilePath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures.
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

function sendWindowState(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  window.webContents.send("window-controls:state-changed", buildWindowState(window));
}

function getEventWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
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

  return discordSocial.getState();
}

function sendDiscordSocialState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("discord-social:state-changed", getDiscordSocialState());
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
    if (!mainWindow || pendingDeepLinkUrl !== url) {
      return;
    }

    mainWindow.webContents.send("apollo:deep-link", url);
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
      nodeIntegration: false
    }
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
    discordLogFilePath = path.join(app.getPath("userData"), "apollo-discord.log");
    logDiscord("app ready");
    registerApolloProtocol();
    latestDiscordConfig = getDiscordPresenceDefaults();
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
      discordSocial?.destroy(),
      discordPresence.destroy()
    ]).finally(() => {
      app.quit();
    });
  });
}
