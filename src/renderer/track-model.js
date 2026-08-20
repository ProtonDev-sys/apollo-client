export const PROVIDER_ID_KEYS = Object.freeze([
  "spotify",
  "youtube",
  "soundcloud",
  "itunes",
  "deezer",
  "isrc"
]);

const GENERIC_ALBUM_NAMES = new Set([
  "",
  "singles",
  "youtube",
  "soundcloud",
  "spotify",
  "deezer"
]);

const NON_RESOLVING_PROVIDERS = new Set([
  "",
  "library",
  "listen-along",
  "remote"
]);

export function buildTrackKey(prefix, id) {
  return `${prefix}:${id}`;
}

export function normaliseProviderIds(providerIds = {}) {
  const nextProviderIds = {};

  PROVIDER_ID_KEYS.forEach((key) => {
    const value = providerIds?.[key];
    nextProviderIds[key] = typeof value === "string"
      ? value.trim()
      : value === null || value === undefined || value === false
        ? ""
        : String(value).trim();
  });

  return nextProviderIds;
}

export function normaliseMetadataText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normaliseTrackArtists(artists, fallbackArtist = "") {
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

export function normaliseTrackNumberTag(value) {
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

function normaliseYear(yearToken) {
  const year = Number.parseInt(yearToken, 10);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    return "";
  }

  return String(year).padStart(4, "0");
}

function normaliseYearMonth(yearToken, monthToken) {
  const year = normaliseYear(yearToken);
  const month = Number.parseInt(monthToken, 10);
  if (!year || !Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

function normaliseFullDate(yearToken, monthToken, dayToken) {
  const yearMonth = normaliseYearMonth(yearToken, monthToken);
  if (!yearMonth) {
    return "";
  }

  const [year, month] = yearMonth.split("-").map(Number);
  const day = Number.parseInt(dayToken, 10);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    return "";
  }

  return `${yearMonth}-${String(day).padStart(2, "0")}`;
}

export function normaliseTrackReleaseDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const fullDate = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (fullDate) {
    return normaliseFullDate(fullDate[1], fullDate[2], fullDate[3]);
  }

  const isoLike = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoLike) {
    return normaliseFullDate(isoLike[1], isoLike[2], isoLike[3]);
  }

  const monthDate = trimmed.match(/^(\d{4})[-/](\d{2})$/);
  if (monthDate) {
    return normaliseYearMonth(monthDate[1], monthDate[2]);
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  return yearOnly ? normaliseYear(yearOnly[1]) : "";
}

export function normaliseTrackExplicitFlag(value) {
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

export function buildTrackMetadataSnapshot(track = {}) {
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

export function getTrackNormalizedDuration(track) {
  const value = Number(track?.normalizedDuration ?? track?.duration ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function getTrackNormalizedText(track, normalizedKey, fallbackKey) {
  return normaliseMetadataText(track?.[normalizedKey] || track?.[fallbackKey] || "");
}

export function hasMatchingProviderIds(leftTrack, rightTrack) {
  const leftProviderIds = normaliseProviderIds(leftTrack?.providerIds);
  const rightProviderIds = normaliseProviderIds(rightTrack?.providerIds);

  return PROVIDER_ID_KEYS.some((key) => {
    const leftValue = normaliseMetadataText(leftProviderIds[key]);
    const rightValue = normaliseMetadataText(rightProviderIds[key]);
    return Boolean(leftValue && rightValue && leftValue === rightValue);
  });
}

export function hasMatchingNormalizedMetadata(leftTrack, rightTrack) {
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
  return !(leftDuration && rightDuration && Math.abs(leftDuration - rightDuration) > 3);
}

export function areTracksEquivalent(leftTrack, rightTrack) {
  if (!leftTrack || !rightTrack) {
    return false;
  }

  return leftTrack.key === rightTrack.key
    || hasMatchingProviderIds(leftTrack, rightTrack)
    || hasMatchingNormalizedMetadata(leftTrack, rightTrack);
}

export function isGenericAlbumName(value) {
  return GENERIC_ALBUM_NAMES.has(normaliseMetadataText(value));
}

export function isTrackLikelyPlayable(track) {
  if (!track?.key || track.playable === false) {
    return false;
  }

  if (track.provider === "library" || track.trackId) {
    return true;
  }

  if (String(track.playbackUrl || track.externalUrl || track.downloadTarget || "").trim()) {
    return true;
  }

  const provider = normaliseMetadataText(track.provider);
  if (NON_RESOLVING_PROVIDERS.has(provider)) {
    return false;
  }

  const title = getTrackNormalizedText(track, "normalizedTitle", "title");
  const artist = getTrackNormalizedText(track, "normalizedArtist", "artist");
  return Boolean(
    title
    && artist
    && title !== "unknown title"
    && artist !== "unknown artist"
  );
}
