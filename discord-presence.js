const RPC = require("discord-rpc");

const DEFAULT_CONFIG = {
  enabled: false,
  clientId: "",
  largeImageKey: "",
  largeImageText: "Apollo Client",
  smallImageKeyPlaying: "",
  smallImageKeyPaused: "",
  smallImageKeyBuffering: ""
};

function cleanText(value, maxLength = 128) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitiseConfig(config = {}) {
  return {
    enabled: Boolean(config.enabled),
    clientId: cleanText(config.clientId, 64).replace(/\s+/g, ""),
    largeImageKey: cleanText(config.largeImageKey, 128),
    largeImageText: cleanText(config.largeImageText, 128) || DEFAULT_CONFIG.largeImageText,
    smallImageKeyPlaying: cleanText(config.smallImageKeyPlaying, 128),
    smallImageKeyPaused: cleanText(config.smallImageKeyPaused, 128),
    smallImageKeyBuffering: cleanText(config.smallImageKeyBuffering, 128)
  };
}

function sanitisePlayback(playback) {
  if (!playback || typeof playback !== "object") {
    return null;
  }

  const status = ["playing", "paused", "buffering"].includes(playback.status)
    ? playback.status
    : "paused";
  const title = cleanText(playback.title);
  const artist = cleanText(playback.artist);

  if (!title && !artist) {
    return null;
  }

  return {
    title: title || "Unknown Title",
    artist: artist || "Unknown Artist",
    album: cleanText(playback.album),
    provider: cleanText(playback.provider),
    artworkUrl: cleanText(playback.artworkUrl, 2048),
    buttonUrl: cleanText(playback.buttonUrl, 2048),
    partyId: cleanText(playback.partyId, 128),
    partySize: Math.max(0, Math.round(cleanNumber(playback.partySize))),
    partyMax: Math.max(0, Math.round(cleanNumber(playback.partyMax))),
    joinSecret: cleanText(playback.joinSecret, 512),
    status,
    currentTime: Math.max(0, cleanNumber(playback.currentTime)),
    duration: Math.max(0, cleanNumber(playback.duration)),
    playbackRate: Math.max(0.25, cleanNumber(playback.playbackRate, 1))
  };
}

function getStatusLabel(status) {
  if (status === "buffering") {
    return "Buffering";
  }

  if (status === "paused") {
    return "Paused";
  }

  return "Listening";
}

function buildActivity(config, playback, appName) {
  if (!playback) {
    return null;
  }

  const statusLabel = getStatusLabel(playback.status);
  const stateParts = playback.status === "playing" ? [] : [statusLabel];

  if (playback.artist) {
    stateParts.push(playback.artist);
  }

  if (playback.album) {
    stateParts.push(playback.album);
  }

  if (playback.provider) {
    stateParts.push(playback.provider);
  }

  const activity = {
    details: playback.title,
    state: cleanText(stateParts.join(" | "), 128),
    instance: false
  };

  if (playback.artworkUrl) {
    activity.largeImageKey = playback.artworkUrl;
    activity.largeImageText = cleanText(`${playback.title} | ${playback.artist}`, 128);
  } else if (config.largeImageKey) {
    activity.largeImageKey = config.largeImageKey;
    activity.largeImageText = config.largeImageText || appName;
  }

  const smallImageKey = playback.status === "buffering"
    ? config.smallImageKeyBuffering
    : playback.status === "paused"
      ? config.smallImageKeyPaused
      : config.smallImageKeyPlaying;

  if (smallImageKey) {
    activity.smallImageKey = smallImageKey;
    activity.smallImageText = statusLabel;
  }

  if (playback.status === "playing" && playback.duration > 0 && playback.playbackRate === 1) {
    const remainingSeconds = Math.max(0, playback.duration - playback.currentTime);
    activity.startTimestamp = new Date(Date.now() - Math.round(playback.currentTime * 1000));
    activity.endTimestamp = new Date(Date.now() + Math.round(remainingSeconds * 1000));
  }

  if (playback.buttonUrl) {
    activity.buttons = [
      {
        label: "Play on Apollo",
        url: playback.buttonUrl
      }
    ];
  }

  if (playback.partyId) {
    activity.partyId = playback.partyId;

    if (playback.partyMax > 0) {
      activity.partyMax = Math.max(playback.partySize || 1, playback.partyMax);
    }

    if (playback.partySize > 0) {
      activity.partySize = playback.partySize;
    }
  }

  if (playback.joinSecret) {
    activity.joinSecret = playback.joinSecret;
  }

  return activity;
}

function createDiscordPresenceController({ appName = "Apollo Client", onJoin = null, logger = null } = {}) {
  let config = { ...DEFAULT_CONFIG };
  let playback = null;
  let client = null;
  let isReady = false;
  let connectPromise = null;
  let reconnectTimer = null;
  let lastActivitySignature = "";

  function log(message) {
    if (typeof logger === "function") {
      logger(`[legacy-rpc] ${message}`);
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (!config.enabled || !config.clientId || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected().then((nextClient) => {
        if (nextClient) {
          void flushPresence();
        }
      });
    }, 15000);
  }

  function markDisconnected(currentClient, error) {
    if (client !== currentClient) {
      return;
    }

    client = null;
    isReady = false;
    lastActivitySignature = "";

    if (error && error.message !== "Could not connect" && error.message !== "connection closed") {
      console.warn("[discord-presence]", error.message);
      log(`disconnected error=${error.message}`);
    }

    log("disconnected");
    scheduleReconnect();
  }

  async function ensureConnected() {
    if (!config.enabled || !config.clientId) {
      return null;
    }

    if (client && isReady) {
      return client;
    }

    if (connectPromise) {
      return connectPromise;
    }

    clearReconnectTimer();

    const nextClient = new RPC.Client({ transport: "ipc" });
    client = nextClient;
    isReady = false;
    log(`ensureConnected clientId=${config.clientId}`);

    nextClient.on("ready", () => {
      if (client === nextClient) {
        isReady = true;
        log("ready");
      }
    });

    nextClient.on("disconnected", () => {
      markDisconnected(nextClient);
    });

    nextClient.on("error", (error) => {
      markDisconnected(nextClient, error);
    });

    nextClient.on("ACTIVITY_JOIN", ({ secret } = {}) => {
      if (client !== nextClient || typeof onJoin !== "function" || !secret) {
        return;
      }

      onJoin(secret);
    });

    try {
      RPC.register(config.clientId);
    } catch {
      // Registration is best-effort and not required for IPC transport.
    }

    const pendingConnection = nextClient.login({ clientId: config.clientId })
      .then(() => {
        if (client !== nextClient) {
          return null;
        }

        isReady = true;
        log("login ok");
        void nextClient.subscribe("ACTIVITY_JOIN").catch(() => {
          // Some Discord clients may not expose the join event; presence still works without it.
        });
        return nextClient;
      })
      .catch(async (error) => {
        log(`login failed error=${error?.message || "unknown"}`);
        markDisconnected(nextClient, error);
        try {
          await nextClient.destroy();
        } catch {
          // Ignore teardown failures.
        }
        return null;
      })
      .finally(() => {
        if (connectPromise === pendingConnection) {
          connectPromise = null;
        }
      });

    connectPromise = pendingConnection;
    return pendingConnection;
  }

  async function clearActivity() {
    if (!client || !isReady) {
      lastActivitySignature = "";
      log("clear skipped no-ready-client");
      return;
    }

    try {
      await client.clearActivity();
      lastActivitySignature = "";
      log("clear ok");
    } catch (error) {
      log(`clear failed error=${error?.message || "unknown"}`);
      markDisconnected(client, error);
    }
  }

  async function flushPresence() {
    if (!config.enabled || !config.clientId) {
      await clearActivity();
      return false;
    }

    const activity = buildActivity(config, playback, appName);
    if (!activity) {
      await clearActivity();
      return false;
    }

    const activitySignature = JSON.stringify(activity);
    if (activitySignature === lastActivitySignature && client && isReady) {
      log("setActivity skipped unchanged");
      return true;
    }

    const connectedClient = await ensureConnected();
    if (!connectedClient || !isReady) {
      return false;
    }

    try {
      await connectedClient.setActivity(activity);
      lastActivitySignature = activitySignature;
      log(`setActivity ok title=${playback?.title || ""} status=${playback?.status || ""}`);
      return true;
    } catch (error) {
      log(`setActivity failed error=${error?.message || "unknown"}`);
      markDisconnected(connectedClient, error);
      return false;
    }
  }

  async function resetClient() {
    clearReconnectTimer();
    const currentClient = client;
    client = null;
    isReady = false;
    connectPromise = null;
    lastActivitySignature = "";

    if (!currentClient) {
      return;
    }

    try {
      await currentClient.clearActivity();
      log("reset clear ok");
    } catch {
      // Ignore teardown failures.
    }

    try {
      await currentClient.destroy();
      log("reset destroy ok");
    } catch {
      // Ignore teardown failures.
    }
  }

  return {
    async configure(nextConfig) {
      const previousClientId = config.clientId;
      const previousEnabled = config.enabled;
      config = {
        ...DEFAULT_CONFIG,
        ...sanitiseConfig(nextConfig)
      };

      if (!config.enabled || !config.clientId) {
        await resetClient();
        return;
      }

      if (!previousEnabled || previousClientId !== config.clientId) {
        await resetClient();
      }

      await flushPresence();
    },
    async updatePlayback(nextPlayback) {
      playback = sanitisePlayback(nextPlayback);
      await flushPresence();
    },
    async clear() {
      playback = null;
      await clearActivity();
    },
    async destroy() {
      playback = null;
      await resetClient();
    }
  };
}

module.exports = {
  createDiscordPresenceController
};
