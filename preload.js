const { contextBridge, ipcRenderer } = require("electron");

const DEFAULT_DISCORD_CLIENT_ID = "1480728455263031296";
const deepLinkListeners = new Set();
const windowStateListeners = new Set();
const discordSocialStateListeners = new Set();
let pendingDeepLinkUrl = "";
let latestWindowState = {
  isFocused: true,
  isMaximized: false
};
let latestDiscordSocialState = {
  available: false,
  helperRunning: false,
  authenticated: false,
  ready: false,
  authInProgress: false,
  message: "Discord Social SDK unavailable."
};

ipcRenderer.on("apollo:deep-link", (_event, url) => {
  pendingDeepLinkUrl = url;
  deepLinkListeners.forEach((listener) => {
    listener(url);
  });
});

ipcRenderer.on("window-controls:state-changed", (_event, state) => {
  latestWindowState = {
    ...latestWindowState,
    ...(state && typeof state === "object" ? state : {})
  };

  windowStateListeners.forEach((listener) => {
    listener(latestWindowState);
  });
});

ipcRenderer.on("discord-social:state-changed", (_event, state) => {
  latestDiscordSocialState = {
    ...latestDiscordSocialState,
    ...(state && typeof state === "object" ? state : {})
  };

  discordSocialStateListeners.forEach((listener) => {
    listener(latestDiscordSocialState);
  });
});

contextBridge.exposeInMainWorld("apolloDesktop", {
  platform: process.platform,
  serverUrl: process.env.APOLLO_SERVER_URL || "http://127.0.0.1:4848",
  versions: process.versions,
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
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (url) => {
      callback(url);
    };

    deepLinkListeners.add(listener);
    if (pendingDeepLinkUrl) {
      listener(pendingDeepLinkUrl);
    }

    return () => {
      deepLinkListeners.delete(listener);
    };
  },
  windowControls: {
    available: true,
    getState: () => ipcRenderer.invoke("window-controls:get-state"),
    minimize: () => ipcRenderer.send("window-controls:minimize"),
    toggleMaximize: () => ipcRenderer.send("window-controls:toggle-maximize"),
    close: () => ipcRenderer.send("window-controls:close"),
    onStateChange: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      const listener = (state) => {
        callback(state);
      };

      windowStateListeners.add(listener);
      listener(latestWindowState);

      return () => {
        windowStateListeners.delete(listener);
      };
    }
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
    onStateChange: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      const listener = (state) => {
        callback(state);
      };

      discordSocialStateListeners.add(listener);
      listener(latestDiscordSocialState);

      return () => {
        discordSocialStateListeners.delete(listener);
      };
    }
  }
});
