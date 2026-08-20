export const PREFERENCES_STORAGE_KEY = "apollo-interface-preferences-v1";

const DENSITY_VALUES = new Set(["comfortable", "compact"]);

export function normaliseInterfacePreferences(value = {}) {
  return {
    density: DENSITY_VALUES.has(value?.density) ? value.density : "comfortable"
  };
}

export function deriveInterfaceStatus(state = {}, playback = {}) {
  const message = String(state.message || "").trim();
  const track = playback.track || null;

  if (!state.isConnected) {
    return {
      kind: "offline",
      label: "Server offline",
      detail: message || String(state.apiBase || "Apollo server is unavailable.")
    };
  }

  if (state.auth?.enabled && !state.auth?.token) {
    return {
      kind: "locked",
      label: "Sign-in required",
      detail: "Authenticate to access this Apollo server."
    };
  }

  if (state.isLoading) {
    return {
      kind: "busy",
      label: state.query ? "Searching" : "Refreshing",
      detail: message || (state.query ? `Searching for ${state.query}` : "Refreshing the Apollo library.")
    };
  }

  if (playback.isBuffering) {
    return {
      kind: "busy",
      label: "Buffering",
      detail: track?.title ? `Buffering ${track.title}` : "Preparing playback."
    };
  }

  if (playback.isPlaying && track) {
    return {
      kind: "active",
      label: "Playing",
      detail: [track.title, track.artist].filter(Boolean).join(" — ")
    };
  }

  return {
    kind: "online",
    label: "Connected",
    detail: state.backendVersion
      ? `Apollo Server ${state.backendVersion}`
      : String(state.apiBase || "Apollo server connected.")
  };
}

export function filterInterfaceCommands(commands = [], query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return [...commands];
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const searchText = [
      command.label,
      command.description,
      ...(command.keywords || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return queryTokens.every((token) => searchText.includes(token));
  });
}

export function isEditableInterfaceTarget(target) {
  if (!target || typeof target !== "object") {
    return false;
  }

  const tagName = String(target.tagName || "").toLowerCase();
  return ["input", "textarea", "select"].includes(tagName)
    || Boolean(target.isContentEditable)
    || Boolean(target.closest?.('[role="textbox"]'));
}

export function readInterfacePreferences(storage) {
  try {
    return normaliseInterfacePreferences(
      JSON.parse(storage?.getItem(PREFERENCES_STORAGE_KEY) || "{}")
    );
  } catch {
    return normaliseInterfacePreferences();
  }
}

export function persistInterfacePreferences(storage, preferences) {
  try {
    storage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage failures and keep the in-memory preference.
  }
}
