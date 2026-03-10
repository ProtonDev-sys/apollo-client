const lyricsCache = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(official|video|audio|lyrics|lyric video|visualizer|visualiser|music video|remaster(ed)?)\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTrackTitle(title) {
  const cleaned = normaliseText(title);
  return cleaned || String(title || "").trim();
}

function primaryArtist(artist) {
  const raw = String(artist || "").trim();

  if (!raw) {
    return "";
  }

  const split = raw.split(/\s*(?:,|&|feat\.?|ft\.?|\/)\s*/i)[0];
  return split || raw;
}

function parseTimestamp(token) {
  const match = String(token || "").match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0")}`) : 0;
  return (minutes * 60 + seconds + fraction) * 1000;
}

function parseSyncedLyrics(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\[([^\]]+)\](.*)$/);
      if (!match) {
        return null;
      }

      const startMs = parseTimestamp(match[1]);
      const text = match[2].trim();

      if (!Number.isFinite(startMs) || !text) {
        return null;
      }

      return {
        startMs,
        text
      };
    })
    .filter(Boolean)
    .map((line, index, lines) => ({
      ...line,
      endMs: lines[index + 1]?.startMs ?? null
    }));
}

function buildPlainText(payload) {
  if (payload.plainLyrics) {
    return payload.plainLyrics.trim();
  }

  return parseSyncedLyrics(payload.syncedLyrics)
    .map((line) => line.text)
    .join("\n")
    .trim();
}

function scoreCandidate(candidate, track) {
  let score = 0;
  const trackTitle = cleanTrackTitle(track.title);
  const candidateTitle = cleanTrackTitle(candidate.trackName || candidate.name);
  const trackArtist = normaliseText(primaryArtist(track.artist));
  const candidateArtist = normaliseText(candidate.artistName);
  const trackAlbum = normaliseText(track.album);
  const candidateAlbum = normaliseText(candidate.albumName);

  if (candidateTitle === trackTitle) {
    score += 60;
  } else if (candidateTitle.includes(trackTitle) || trackTitle.includes(candidateTitle)) {
    score += 40;
  }

  if (candidateArtist === trackArtist) {
    score += 35;
  } else if (candidateArtist.includes(trackArtist) || trackArtist.includes(candidateArtist)) {
    score += 20;
  }

  if (trackAlbum && candidateAlbum === trackAlbum) {
    score += 12;
  }

  const duration = Number(track.duration);
  const candidateDuration = Number(candidate.duration);
  if (Number.isFinite(duration) && Number.isFinite(candidateDuration)) {
    const difference = Math.abs(duration - candidateDuration);

    if (difference <= 2) {
      score += 20;
    } else if (difference <= 6) {
      score += 12;
    } else if (difference <= 12) {
      score += 6;
    }
  }

  if (candidate.syncedLyrics) {
    score += 8;
  }

  return score;
}

async function fetchLyricsFromLrclib(track) {
  if (!track?.title || !track?.artist) {
    return null;
  }

  const trackKey = track.key || `${track.title}:${track.artist}`;
  if (lyricsCache.has(trackKey)) {
    return lyricsCache.get(trackKey);
  }

  const request = (async () => {
    const params = new URLSearchParams({
      track_name: cleanTrackTitle(track.title),
      artist_name: primaryArtist(track.artist)
    });

    if (track.album) {
      params.set("album_name", track.album);
    }

    const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Lyrics lookup failed.");
    }

    const results = await response.json();
    if (!Array.isArray(results) || !results.length) {
      return null;
    }

    const ranked = results
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, track)
      }))
      .sort((left, right) => right.score - left.score);

    const best = ranked[0];
    if (!best || best.score < 45) {
      return null;
    }

    const payload = best.candidate;
    const lines = parseSyncedLyrics(payload.syncedLyrics);

    return {
      source: "LRCLIB",
      synced: lines.length > 0,
      plainText: buildPlainText(payload),
      lines,
      meta: {
        album: payload.albumName || "",
        duration: payload.duration || null
      }
    };
  })();

  lyricsCache.set(trackKey, request);

  try {
    return await request;
  } catch (error) {
    lyricsCache.delete(trackKey);
    throw error;
  }
}

function renderEmpty(container, title, copy) {
  container.innerHTML = `
    <div class="lyrics-panel lyrics-panel--empty">
      <p class="lyrics-eyebrow">Lyrics</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function renderLoading(container, track) {
  container.innerHTML = `
    <div class="lyrics-panel lyrics-panel--empty">
      <p class="lyrics-eyebrow">Lyrics</p>
      <h3>${escapeHtml(track?.title || "Loading lyrics")}</h3>
      <p>Looking up synced lyrics on LRCLIB from the client.</p>
    </div>
  `;
}

function renderUnsyncedLyrics(container, track, lyrics) {
  const plainLines = lyrics.plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  container.innerHTML = `
    <div class="lyrics-panel">
      <div class="lyrics-header">
        <div>
          <p class="lyrics-eyebrow">Lyrics</p>
          <h3>${escapeHtml(track.title)}</h3>
          <p class="lyrics-meta">Source: ${escapeHtml(lyrics.source)} | Static text</p>
        </div>
      </div>
      <div class="lyrics-copy">
        ${plainLines.map((line) => `<p class="lyrics-paragraph">${escapeHtml(line)}</p>`).join("")}
      </div>
    </div>
  `;
}

function renderSyncedLyrics(container, track, lyrics, context) {
  container.innerHTML = `
    <div class="lyrics-panel">
      <div class="lyrics-header">
        <div>
          <p class="lyrics-eyebrow">Lyrics</p>
          <h3>${escapeHtml(track.title)}</h3>
          <p class="lyrics-meta">Source: ${escapeHtml(lyrics.source)} | Synced to playback</p>
        </div>
      </div>
      <div class="lyrics-lines">
        ${lyrics.lines
          .map(
            (line, index) => `
              <p class="lyrics-line" data-line-index="${index}" data-start-ms="${line.startMs}" data-end-ms="${line.endMs ?? ""}">
                ${escapeHtml(line.text)}
              </p>
            `
          )
          .join("")}
      </div>
    </div>
  `;

  const lineNodes = Array.from(container.querySelectorAll(".lyrics-line"));
  let activeIndex = -1;

  const syncActiveLine = () => {
    const playbackTrack = context.getPlaybackTrack();
    const playbackTrackKey = context.getPlaybackTrackKey();
    const playbackTrackResolvedKey = playbackTrack?.key;

    if (!playbackTrackResolvedKey || playbackTrackKey !== playbackTrackResolvedKey) {
      lineNodes.forEach((node) => node.classList.remove("is-active"));
      activeIndex = -1;
      return;
    }

    const position = context.audioPlayer.currentTime * 1000;
    const nextIndex = lyrics.lines.findIndex((line) => {
      const endMs = line.endMs ?? Number.POSITIVE_INFINITY;
      return position >= line.startMs && position < endMs;
    });

    if (nextIndex === activeIndex) {
      return;
    }

    if (activeIndex >= 0) {
      lineNodes[activeIndex]?.classList.remove("is-active");
    }

    activeIndex = nextIndex;

    if (activeIndex >= 0) {
      const activeNode = lineNodes[activeIndex];
      activeNode?.classList.add("is-active");
      activeNode?.scrollIntoView({
        block: "nearest"
      });
    }
  };

  context.audioPlayer.addEventListener("timeupdate", syncActiveLine);
  context.audioPlayer.addEventListener("seeked", syncActiveLine);
  context.audioPlayer.addEventListener("play", syncActiveLine);
  context.audioPlayer.addEventListener("pause", syncActiveLine);
  syncActiveLine();

  return () => {
    context.audioPlayer.removeEventListener("timeupdate", syncActiveLine);
    context.audioPlayer.removeEventListener("seeked", syncActiveLine);
    context.audioPlayer.removeEventListener("play", syncActiveLine);
    context.audioPlayer.removeEventListener("pause", syncActiveLine);
  };
}

const lyricsPlugin = {
  id: "lyrics",
  name: "Lyrics",
  async setup(api) {
    api.registerLyricsProvider({
      id: "lrclib",
      name: "LRCLIB",
      order: 10,
      canResolve(track) {
        return Boolean(track?.title && track?.artist);
      },
      async resolve(track) {
        return fetchLyricsFromLrclib(track);
      }
    });

    api.registerDetailTab({
      id: "lyrics",
      label: "Lyrics",
      order: 20,
      mount({ container, context, services }) {
        let disposed = false;
        let cleanup = () => {};

        const run = async () => {
          const track = context.getPlaybackTrack() || context.getSelectedTrack();

          if (!track) {
            renderEmpty(container, "Nothing playing", "Start playback to load lyrics for the current song.");
            return;
          }

          renderLoading(container, track);

          try {
            const lyrics = await services.resolveLyrics(track);
            if (disposed) {
              return;
            }

            cleanup();

            if (!lyrics) {
              renderEmpty(
                container,
                "No lyrics found",
                "This lookup stays client-side. Try a cleaner search result or a local track with cleaner metadata."
              );
              return;
            }

            if (lyrics.synced && lyrics.lines.length) {
              cleanup = renderSyncedLyrics(container, track, lyrics, context) || (() => {});
              return;
            }

            renderUnsyncedLyrics(container, track, lyrics);
          } catch (error) {
            if (disposed) {
              return;
            }

            renderEmpty(container, "Lyrics unavailable", error.message || "Lyrics lookup failed.");
          }
        };

        void run();

        return () => {
          disposed = true;
          cleanup();
        };
      }
    });
  }
};

export default lyricsPlugin;
