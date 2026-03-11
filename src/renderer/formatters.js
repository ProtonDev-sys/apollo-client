export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

export function formatDuration(value, fallback = "0:00") {
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

export function providerLabel(provider, requestedProvider = "") {
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
