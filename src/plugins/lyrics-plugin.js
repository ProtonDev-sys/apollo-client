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
    .flatMap((line) => {
      const matches = Array.from(String(line).matchAll(/\[([^\]]+)\]/g));
      if (!matches.length) {
        return [];
      }

      const text = String(line).replace(/\[[^\]]+\]/g, "").trim();
      if (!text) {
        return [];
      }

      return matches
        .map((match) => parseTimestamp(match[1]))
        .filter(Number.isFinite)
        .map((startMs) => ({
          startMs,
          text
        }));
    })
    .filter(Boolean)
    .sort((left, right) => left.startMs - right.startMs)
    .map((line, index, lines) => ({
      ...line,
      endMs: lines[index + 1]?.startMs ?? null
    }));
}

function getTrackDurationSeconds(track) {
  const duration = Number(track?.normalizedDuration ?? track?.duration ?? 0);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
}

function buildLrclibLookupParams(track, { includeAlbum = true, includeDuration = true } = {}) {
  const params = new URLSearchParams({
    track_name: cleanTrackTitle(track.title),
    artist_name: primaryArtist(track.artist)
  });

  if (includeAlbum && track.album) {
    params.set("album_name", track.album);
  }

  const durationSeconds = getTrackDurationSeconds(track);
  if (includeDuration && durationSeconds) {
    params.set("duration", String(durationSeconds));
  }

  return params;
}

async function fetchExactLyricsCandidate(track, fetchImpl) {
  const variants = [
    { includeAlbum: true, includeDuration: true },
    { includeAlbum: false, includeDuration: true },
    { includeAlbum: true, includeDuration: false },
    { includeAlbum: false, includeDuration: false }
  ];

  for (const variant of variants) {
    const response = await fetchImpl(`https://lrclib.net/api/get?${buildLrclibLookupParams(track, variant).toString()}`);
    if (!response.ok) {
      continue;
    }

    const payload = await response.json();
    if (payload) {
      return payload;
    }
  }

  return null;
}

function pickBestCandidate(track, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  const ranked = candidates
    .map((candidate, index) => {
      const syncedLines = parseSyncedLyrics(candidate?.syncedLyrics);
      return {
        candidate,
        index,
        syncedLines,
        score: scoreCandidate(candidate, track) + (syncedLines.length ? 10 : 0)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.syncedLines.length !== left.syncedLines.length) {
        return right.syncedLines.length - left.syncedLines.length;
      }

      return left.index - right.index;
    });

  const best = ranked[0];
  if (!best || best.score < 45) {
    return null;
  }

  return {
    payload: best.candidate,
    lines: best.syncedLines
  };
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

async function fetchLyricsFromLrclib(track, fetchImpl = fetch) {
  if (!track?.title || !track?.artist) {
    return null;
  }

  const trackKey = track.key || `${track.title}:${track.artist}`;
  if (lyricsCache.has(trackKey)) {
    return lyricsCache.get(trackKey);
  }

  const request = (async () => {
    const exactCandidate = await fetchExactLyricsCandidate(track, fetchImpl);
    const response = await fetchImpl(`https://lrclib.net/api/search?${buildLrclibLookupParams(track, { includeAlbum: true, includeDuration: false }).toString()}`);
    if (!response.ok) {
      throw new Error("Lyrics lookup failed.");
    }

    const results = await response.json();
    const combinedCandidates = [
      ...(exactCandidate ? [exactCandidate] : []),
      ...(Array.isArray(results) ? results : [])
    ];

    if (!combinedCandidates.length) {
      return null;
    }

    const best = pickBestCandidate(track, combinedCandidates);
    if (!best) {
      return null;
    }

    const payload = best.payload;
    const lines = best.lines;

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

function supportsLyricsFullscreen() {
  return Boolean(document.fullscreenEnabled && document.documentElement?.requestFullscreen);
}

function renderLyricsHeader(track, meta) {
  const fullscreenSupported = supportsLyricsFullscreen();

  return `
    <div class="lyrics-header">
      <div>
        <p class="lyrics-eyebrow">Lyrics</p>
        <h3>${escapeHtml(track.title)}</h3>
        <p class="lyrics-meta">${escapeHtml(meta)}</p>
      </div>
      ${fullscreenSupported
        ? `
          <div class="lyrics-header-actions">
            <button class="lyrics-fullscreen-button" type="button" data-lyrics-fullscreen aria-label="Open fullscreen lyrics">
              Fullscreen
            </button>
          </div>
        `
        : ""}
    </div>
  `;
}

function wireLyricsFullscreen(container) {
  const panel = container.querySelector(".lyrics-panel");
  const button = container.querySelector("[data-lyrics-fullscreen]");

  if (!panel || !button || !supportsLyricsFullscreen()) {
    return () => {};
  }

  const syncButton = () => {
    const isFullscreen = document.fullscreenElement === panel;
    button.classList.toggle("is-active", isFullscreen);
    button.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute("aria-label", isFullscreen ? "Exit fullscreen lyrics" : "Open fullscreen lyrics");
  };

  const handleToggle = async () => {
    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      } else {
        await panel.requestFullscreen();
      }
    } catch {
      // Ignore fullscreen failures and leave the lyrics panel usable inline.
    }

    syncButton();
  };

  button.addEventListener("click", handleToggle);
  document.addEventListener("fullscreenchange", syncButton);
  syncButton();

  return () => {
    button.removeEventListener("click", handleToggle);
    document.removeEventListener("fullscreenchange", syncButton);
  };
}

function renderUnsyncedLyrics(container, track, lyrics) {
  const plainLines = lyrics.plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  container.innerHTML = `
    <div class="lyrics-panel">
      ${renderLyricsHeader(track, `Source: ${lyrics.source} | Static text`)}
      <div class="lyrics-copy">
        ${plainLines
          .map((line, index) => `<p class="lyrics-paragraph" style="--line-index:${index};">${escapeHtml(line)}</p>`)
          .join("")}
      </div>
    </div>
  `;

  return wireLyricsFullscreen(container);
}

function renderSyncedLyrics(container, track, lyrics, context) {
  container.innerHTML = `
    <div class="lyrics-panel">
      ${renderLyricsHeader(track, `Source: ${lyrics.source} | Synced to playback | Click a line to seek`)}
      <div class="lyrics-lines">
        ${lyrics.lines
          .map(
            (line, index) => `
              <button class="lyrics-line" type="button" data-line-index="${index}" data-start-ms="${line.startMs}" data-end-ms="${line.endMs ?? ""}" style="--line-index:${index};">
                ${escapeHtml(line.text)}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;

  const lineNodes = Array.from(container.querySelectorAll(".lyrics-line"));
  const cleanupFullscreen = wireLyricsFullscreen(container);
  let activeIndex = -1;

  const waitForSeekReady = () => {
    if (context.audioPlayer.readyState >= 1) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        context.audioPlayer.removeEventListener("loadedmetadata", onReady);
        context.audioPlayer.removeEventListener("canplay", onReady);
        context.audioPlayer.removeEventListener("error", onReady);
      };
      const onReady = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      context.audioPlayer.addEventListener("loadedmetadata", onReady, { once: true });
      context.audioPlayer.addEventListener("canplay", onReady, { once: true });
      context.audioPlayer.addEventListener("error", onReady, { once: true });
      setTimeout(onReady, 1200);
    });
  };

  const seekToLine = async (line) => {
    const targetSeconds = Math.max(0, Number(line?.startMs || 0) / 1000);
    const playbackTrack = context.getPlaybackTrack();

    if (!playbackTrack || playbackTrack.key !== track.key) {
      await context.apollo?.playback?.playTrack?.(track, {
        autoplay: true
      });
      await waitForSeekReady();
    }

    if (!Number.isFinite(targetSeconds)) {
      return;
    }

    context.audioPlayer.currentTime = targetSeconds;
    syncActiveLine();
  };

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
        block: "center",
        behavior: "smooth"
      });
    }
  };

  lineNodes.forEach((node, index) => {
    node.addEventListener("click", () => {
      void seekToLine(lyrics.lines[index]);
    });
  });

  context.audioPlayer.addEventListener("timeupdate", syncActiveLine);
  context.audioPlayer.addEventListener("seeked", syncActiveLine);
  context.audioPlayer.addEventListener("play", syncActiveLine);
  context.audioPlayer.addEventListener("pause", syncActiveLine);
  syncActiveLine();

  return () => {
    cleanupFullscreen();
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
    const fetchLyrics = (track) => fetchLyricsFromLrclib(track, api.apollo?.net?.fetch || fetch);

    api.registerLyricsProvider({
      id: "lrclib",
      name: "LRCLIB",
      order: 10,
      canResolve(track) {
        return Boolean(track?.title && track?.artist);
      },
      async resolve(track) {
        return fetchLyrics(track);
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

            cleanup = renderUnsyncedLyrics(container, track, lyrics) || (() => {});
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
