export const SEARCH_PROVIDER_ORDER = ["deezer", "youtube", "spotify", "soundcloud", "itunes"];

export const DEFAULT_LAYOUT = {
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

export function getDefaultPort(protocol) {
  return protocol === "https" ? "443" : "80";
}

export function parseConnectionSettings(url, fallbackUrl = "http://127.0.0.1:4848") {
  try {
    const parsedUrl = new URL(String(url || "").trim() || fallbackUrl);
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

export function normaliseConnectionSettings(connection = {}) {
  let protocol = String(connection?.protocol || "http").trim().toLowerCase();
  let hostname = String(connection?.hostname || "").trim();
  let port = String(connection?.port || "").trim();

  if (hostname.includes("://")) {
    let parsedUrl;
    try {
      parsedUrl = new URL(hostname);
    } catch {
      throw new Error("Enter a valid Apollo server URL.");
    }

    if ((parsedUrl.pathname && parsedUrl.pathname !== "/") || parsedUrl.search || parsedUrl.hash) {
      throw new Error("Enter only the Apollo server host or root URL, not an API path.");
    }

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

export function buildApiBase(connection) {
  const normalisedConnection = normaliseConnectionSettings(connection);
  return `${normalisedConnection.protocol}://${normalisedConnection.hostname}:${normalisedConnection.port}`;
}

export function clampWidth(value, fallback = 280) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return fallback;
  }

  return Math.max(220, Math.min(520, Math.round(nextValue)));
}

export function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

export function createDefaultSettings({
  defaultConnectionSettings,
  desktopDiscordDefaults = {}
} = {}) {
  return {
    connection: {
      ...(defaultConnectionSettings || parseConnectionSettings())
    },
    playback: {
      autoplaySelection: true,
      restoreLastTrack: true,
      pauseOnBlur: false,
      skipUnplayableTracks: true,
      defaultRepeatMode: "off",
      previousSeekThreshold: 3,
      playbackRate: 1,
      crossfadeSeconds: 0
    },
    audio: {
      volume: 0.72,
      muted: false,
      volumeStep: 0.05,
      preloadMode: "auto",
      levelingEnabled: false
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
      autoRefreshLibrary: true,
      autoDownloadRemoteOnPlay: false,
      preferLocalPlayback: true
    },
    integrations: {
      discord: {
        enabled: Boolean(desktopDiscordDefaults.enabled),
        allowListenAlongRequests: true,
        clientId: desktopDiscordDefaults.clientId || "",
        largeImageKey: desktopDiscordDefaults.largeImageKey || "",
        largeImageText: desktopDiscordDefaults.largeImageText || "Apollo Client",
        smallImageKeyPlaying: desktopDiscordDefaults.smallImageKeyPlaying || "",
        smallImageKeyPaused: desktopDiscordDefaults.smallImageKeyPaused || "",
        smallImageKeyBuffering: desktopDiscordDefaults.smallImageKeyBuffering || ""
      }
    }
  };
}

export function mergeSettings(base, override) {
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
  merged.playback.skipUnplayableTracks = override?.playback?.skipUnplayableTracks ?? merged.playback.skipUnplayableTracks;
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
  merged.playback.crossfadeSeconds = clampNumber(
    override?.playback?.crossfadeSeconds,
    0,
    12,
    merged.playback.crossfadeSeconds
  );

  merged.audio.volume = clampNumber(override?.audio?.volume, 0, 1, merged.audio.volume);
  merged.audio.muted = Boolean(override?.audio?.muted);
  merged.audio.volumeStep = clampNumber(override?.audio?.volumeStep, 0.01, 0.1, merged.audio.volumeStep);
  merged.audio.preloadMode = ["none", "metadata", "auto"].includes(override?.audio?.preloadMode)
    ? override.audio.preloadMode
    : merged.audio.preloadMode;
  merged.audio.levelingEnabled = override?.audio?.levelingEnabled ?? merged.audio.levelingEnabled;

  merged.search.includeLibraryResults = override?.search?.includeLibraryResults ?? merged.search.includeLibraryResults;
  merged.search.liveSearchDelayMs = clampNumber(
    override?.search?.liveSearchDelayMs,
    0,
    500,
    merged.search.liveSearchDelayMs
  );
  SEARCH_PROVIDER_ORDER.forEach((provider) => {
    merged.search.providers[provider] = override?.search?.providers?.[provider] ?? merged.search.providers[provider];
  });

  merged.downloads.autoRefreshLibrary = override?.downloads?.autoRefreshLibrary ?? merged.downloads.autoRefreshLibrary;
  merged.downloads.autoDownloadRemoteOnPlay = override?.downloads?.autoDownloadRemoteOnPlay ?? merged.downloads.autoDownloadRemoteOnPlay;
  merged.downloads.preferLocalPlayback = override?.downloads?.preferLocalPlayback ?? merged.downloads.preferLocalPlayback;
  merged.integrations.discord.enabled = override?.integrations?.discord?.enabled ?? merged.integrations.discord.enabled;
  merged.integrations.discord.allowListenAlongRequests = override?.integrations?.discord?.allowListenAlongRequests
    ?? merged.integrations.discord.allowListenAlongRequests;
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
