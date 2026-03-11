const lyricsCache = new Map();
const resolvedLyricsCache = new Map();
let lastRenderedLyricsSignature = "";

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

function clampProgress(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function stripInlineWordTimestamps(value) {
  return String(value || "").replace(/<[^>]+>/g, "");
}

function buildLineTextFromWords(words) {
  return words
    .map((word) => word.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWordTimedText(value, lineStartMs, lineEndMs) {
  const source = String(value || "");
  const matches = Array.from(source.matchAll(/<([^>]+)>/g));

  if (!matches.length) {
    return {
      text: stripInlineWordTimestamps(source).replace(/\s+/g, " ").trim(),
      words: []
    };
  }

  const words = [];
  let activeStartMs = lineStartMs;
  let segmentStart = matches[0].index + matches[0][0].length;

  matches.forEach((match, index) => {
    const parsedTimestamp = parseTimestamp(match[1]);
    if (Number.isFinite(parsedTimestamp)) {
      activeStartMs = parsedTimestamp;
    }

    const nextMatch = matches[index + 1];
    const segmentEnd = nextMatch ? nextMatch.index : source.length;
    const text = source.slice(segmentStart, segmentEnd);

    if (text.trim()) {
      words.push({
        text: words.length ? text : text.replace(/^\s+/, ""),
        startMs: activeStartMs
      });
    }

    if (nextMatch) {
      segmentStart = nextMatch.index + nextMatch[0].length;
    }
  });

  const normalisedWords = words
    .map((word, index, list) => ({
      text: word.text,
      startMs: word.startMs,
      endMs: list[index + 1]?.startMs ?? lineEndMs ?? null
    }))
    .filter((word) => word.text.trim());

  return {
    text: buildLineTextFromWords(normalisedWords),
    words: normalisedWords
  };
}

function parseSyncedLyrics(value) {
  const parsedLines = String(value || "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const matches = Array.from(String(line).matchAll(/\[([^\]]+)\]/g));
      if (!matches.length) {
        return [];
      }

      const timedText = String(line).replace(/\[[^\]]+\]/g, "");
      const fallbackText = stripInlineWordTimestamps(timedText).replace(/\s+/g, " ").trim();
      if (!fallbackText) {
        return [];
      }

      return matches
        .map((match) => parseTimestamp(match[1]))
        .filter(Number.isFinite)
        .map((startMs) => ({
          startMs,
          rawText: timedText
        }));
    })
    .filter(Boolean)
    .sort((left, right) => left.startMs - right.startMs);

  return parsedLines
    .map((line, index, allLines) => {
      const endMs = allLines[index + 1]?.startMs ?? null;
      const enhancedLine = parseWordTimedText(line.rawText, line.startMs, endMs);

      return {
        startMs: line.startMs,
        endMs,
        text: enhancedLine.text,
        words: enhancedLine.words
      };
    })
    .filter((line) => line.text);
}

function getTrackDurationSeconds(track) {
  const duration = Number(track?.normalizedDuration ?? track?.duration ?? 0);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
}

function buildTrackLookupKey(track) {
  return track?.key || `${track?.title || ""}:${track?.artist || ""}:${getTrackDurationSeconds(track)}`;
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

function getTimingPriority(lines, plainText) {
  if (Array.isArray(lines) && lines.some((line) => Array.isArray(line.words) && line.words.length)) {
    return 3;
  }

  if (Array.isArray(lines) && lines.length) {
    return 2;
  }

  if (plainText) {
    return 1;
  }

  return 0;
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

function scoreCandidate(candidate, track, syncedLines = []) {
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

  if (syncedLines.some((line) => Array.isArray(line.words) && line.words.length)) {
    score += 18;
  } else if (syncedLines.length) {
    score += 8;
  }

  return score;
}

function pickBestCandidate(track, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  const ranked = candidates
    .map((candidate, index) => {
      const syncedLines = parseSyncedLyrics(candidate?.syncedLyrics);
      const plainText = buildPlainText(candidate);

      return {
        candidate,
        index,
        syncedLines,
        plainText,
        timingPriority: getTimingPriority(syncedLines, plainText),
        score: scoreCandidate(candidate, track, syncedLines)
      };
    })
    .sort((left, right) => {
      if (right.timingPriority !== left.timingPriority) {
        return right.timingPriority - left.timingPriority;
      }

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
    lines: best.syncedLines,
    plainText: best.plainText
  };
}

async function fetchLyricsFromLrclib(track, fetchImpl = fetch) {
  if (!track?.title || !track?.artist) {
    return null;
  }

  const trackKey = buildTrackLookupKey(track);
  if (lyricsCache.has(trackKey)) {
    return lyricsCache.get(trackKey);
  }

  const request = (async () => {
    const exactCandidate = await fetchExactLyricsCandidate(track, fetchImpl);
    const response = await fetchImpl(
      `https://lrclib.net/api/search?${buildLrclibLookupParams(track, { includeAlbum: true, includeDuration: false }).toString()}`
    );

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

    return {
      source: "LRCLIB",
      synced: best.lines.length > 0,
      plainText: best.plainText,
      lines: best.lines,
      meta: {
        album: best.payload.albumName || "",
        duration: best.payload.duration || null
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

function createLyricsSignature(track, lyrics) {
  if (!lyrics) {
    return `${buildTrackLookupKey(track)}::none`;
  }

  return JSON.stringify({
    key: buildTrackLookupKey(track),
    source: lyrics.source || "",
    plainText: lyrics.plainText || "",
    lines: Array.isArray(lyrics.lines)
      ? lyrics.lines.map((line) => ({
          startMs: line.startMs,
          endMs: line.endMs,
          text: line.text,
          words: Array.isArray(line.words)
            ? line.words.map((word) => ({
                startMs: word.startMs,
                endMs: word.endMs,
                text: word.text
              }))
            : []
        }))
      : []
  });
}

function getLyricsDisplayMode(lyrics) {
  if (Array.isArray(lyrics?.lines) && lyrics.lines.some((line) => Array.isArray(line.words) && line.words.length)) {
    return "word";
  }

  if (Array.isArray(lyrics?.lines) && lyrics.lines.length) {
    return "line";
  }

  if (lyrics?.plainText) {
    return "static";
  }

  return "empty";
}

function renderEmpty(container, title, copy, { animate = false } = {}) {
  container.innerHTML = `
    <div class="lyrics-panel lyrics-panel--empty${animate ? " lyrics-panel--animated" : ""}">
      <p class="lyrics-eyebrow">Lyrics</p>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function renderLoading(container, track) {
  container.innerHTML = `
    <div class="lyrics-panel lyrics-panel--empty lyrics-panel--animated">
      <p class="lyrics-eyebrow">Lyrics</p>
      <h3>${escapeHtml(track?.title || "Loading lyrics")}</h3>
      <p>Looking up the best lyrics match from the client.</p>
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
      // Ignore fullscreen failures and keep the inline panel active.
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

function renderUnsyncedLyrics(container, track, lyrics, { animate = true } = {}) {
  const plainLines = String(lyrics.plainText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  container.innerHTML = `
    <div class="lyrics-panel lyrics-panel--static${animate ? " lyrics-panel--animated" : ""}" data-lyrics-mode="static">
      ${renderLyricsHeader(track, `Source: ${lyrics.source} | Full text`)}
      <div class="lyrics-copy">
        ${plainLines
          .map((line, index) => `<p class="lyrics-paragraph" style="--line-index:${index};">${escapeHtml(line)}</p>`)
          .join("")}
      </div>
    </div>
  `;

  return wireLyricsFullscreen(container);
}

function renderLineWords(line) {
  if (!Array.isArray(line.words) || !line.words.length) {
    return escapeHtml(line.text);
  }

  return line.words
    .map(
      (word, index) => `
        <span
          class="lyrics-word"
          data-word-index="${index}"
          data-start-ms="${word.startMs}"
          data-end-ms="${word.endMs ?? ""}"
          style="--word-progress:0%;"
        >${escapeHtml(word.text)}</span>
      `
    )
    .join("");
}

function getTimedLyricsMeta(lyrics, displayMode) {
  const modeLabel = displayMode === "word" ? "Word synced" : "Line synced";
  return `Source: ${lyrics.source} | ${modeLabel} | Click a line to seek`;
}

function setWordState(node, state, progress = 0) {
  node.classList.toggle("is-sung", state === "sung");
  node.classList.toggle("is-current", state === "current");
  node.style.setProperty("--word-progress", `${Math.round(clampProgress(progress) * 100)}%`);
}

function clearWordState(node) {
  node.classList.remove("is-sung", "is-current");
  node.style.setProperty("--word-progress", "0%");
}

function findActiveLineIndex(lines, position) {
  return lines.findIndex((line) => {
    const endMs = line.endMs ?? Number.POSITIVE_INFINITY;
    return position >= line.startMs && position < endMs;
  });
}

function findActiveWordIndex(words, position) {
  if (!Array.isArray(words) || !words.length) {
    return -1;
  }

  const activeIndex = words.findIndex((word) => {
    const endMs = word.endMs ?? Number.POSITIVE_INFINITY;
    return position >= word.startMs && position < endMs;
  });

  if (activeIndex >= 0) {
    return activeIndex;
  }

  if (position >= words[words.length - 1].startMs) {
    return words.length - 1;
  }

  return -1;
}

function renderTimedLyrics(container, track, lyrics, context, { animate = true } = {}) {
  const displayMode = getLyricsDisplayMode(lyrics);

  container.innerHTML = `
    <div class="lyrics-panel lyrics-panel--timed${animate ? " lyrics-panel--animated" : ""}" data-lyrics-mode="${displayMode}">
      ${renderLyricsHeader(track, getTimedLyricsMeta(lyrics, displayMode))}
      <div class="lyrics-lines">
        ${lyrics.lines
          .map(
            (line, index) => `
              <button class="lyrics-line" type="button" data-line-index="${index}" data-start-ms="${line.startMs}" data-end-ms="${line.endMs ?? ""}" style="--line-index:${index};">
                <span class="lyrics-line-text">${renderLineWords(line)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;

  const lineEntries = Array.from(container.querySelectorAll(".lyrics-line")).map((node, index) => ({
    node,
    line: lyrics.lines[index],
    words: Array.from(node.querySelectorAll(".lyrics-word"))
  }));
  const cleanupFullscreen = wireLyricsFullscreen(container);
  let activeLineIndex = -1;

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
    syncActiveLyrics();
  };

  const clearAllTimedState = () => {
    lineEntries.forEach(({ node, words }) => {
      node.classList.remove("is-active", "is-past");
      words.forEach(clearWordState);
    });
    activeLineIndex = -1;
  };

  const syncActiveLyrics = () => {
    const playbackTrack = context.getPlaybackTrack();
    const playbackTrackKey = context.getPlaybackTrackKey();
    const playbackTrackResolvedKey = playbackTrack?.key;

    if (!playbackTrackResolvedKey || playbackTrackKey !== playbackTrackResolvedKey) {
      clearAllTimedState();
      return;
    }

    const position = context.audioPlayer.currentTime * 1000;
    const nextLineIndex = findActiveLineIndex(lyrics.lines, position);

    if (nextLineIndex !== activeLineIndex) {
      lineEntries.forEach(({ node }, index) => {
        node.classList.toggle("is-active", index === nextLineIndex);
        node.classList.toggle("is-past", nextLineIndex >= 0 && index < nextLineIndex);
      });

      activeLineIndex = nextLineIndex;

      if (activeLineIndex >= 0) {
        lineEntries[activeLineIndex]?.node?.scrollIntoView({
          block: "center",
          behavior: "smooth"
        });
      }
    }

    lineEntries.forEach(({ words }, index) => {
      if (!words.length) {
        return;
      }

      if (nextLineIndex < 0) {
        words.forEach(clearWordState);
        return;
      }

      if (index < nextLineIndex) {
        words.forEach((word) => setWordState(word, "sung", 1));
        return;
      }

      if (index > nextLineIndex) {
        words.forEach(clearWordState);
        return;
      }

      const activeWordIndex = findActiveWordIndex(lyrics.lines[index].words, position);
      words.forEach((wordNode, wordIndex) => {
        const word = lyrics.lines[index].words[wordIndex];

        if (wordIndex < activeWordIndex) {
          setWordState(wordNode, "sung", 1);
          return;
        }

        if (wordIndex > activeWordIndex || activeWordIndex < 0) {
          clearWordState(wordNode);
          return;
        }

        const wordDuration = Math.max(1, (word.endMs ?? lyrics.lines[index].endMs ?? word.startMs + 1) - word.startMs);
        setWordState(wordNode, "current", (position - word.startMs) / wordDuration);
      });
    });
  };

  lineEntries.forEach(({ node, line }) => {
    node.addEventListener("click", () => {
      void seekToLine(line);
    });
  });

  context.audioPlayer.addEventListener("timeupdate", syncActiveLyrics);
  context.audioPlayer.addEventListener("seeked", syncActiveLyrics);
  context.audioPlayer.addEventListener("play", syncActiveLyrics);
  context.audioPlayer.addEventListener("pause", syncActiveLyrics);
  syncActiveLyrics();

  return () => {
    cleanupFullscreen();
    context.audioPlayer.removeEventListener("timeupdate", syncActiveLyrics);
    context.audioPlayer.removeEventListener("seeked", syncActiveLyrics);
    context.audioPlayer.removeEventListener("play", syncActiveLyrics);
    context.audioPlayer.removeEventListener("pause", syncActiveLyrics);
  };
}

function renderResolvedLyrics(container, track, lyrics, context, options = {}) {
  if (!lyrics) {
    renderEmpty(
      container,
      "No lyrics found",
      "This lookup stays client-side. Try a cleaner search result or a local track with cleaner metadata.",
      options
    );
    return () => {};
  }

  if (Array.isArray(lyrics.lines) && lyrics.lines.length) {
    return renderTimedLyrics(container, track, lyrics, context, options) || (() => {});
  }

  return renderUnsyncedLyrics(container, track, lyrics, options) || (() => {});
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
        let mountedSignature = "";

        const renderTrackLyrics = (track, lyrics, { animate }) => {
          cleanup();
          mountedSignature = createLyricsSignature(track, lyrics);
          lastRenderedLyricsSignature = mountedSignature;
          cleanup = renderResolvedLyrics(container, track, lyrics, context, {
            animate
          });
        };

        const run = async () => {
          const track = context.getPlaybackTrack() || context.getSelectedTrack();

          if (!track) {
            mountedSignature = "nothing-playing";
            renderEmpty(container, "Nothing playing", "Start playback to load lyrics for the current song.");
            return;
          }

          const trackKey = buildTrackLookupKey(track);
          const hasCachedLyrics = resolvedLyricsCache.has(trackKey);

          if (hasCachedLyrics) {
            const cachedLyrics = resolvedLyricsCache.get(trackKey) ?? null;
            renderTrackLyrics(track, cachedLyrics, {
              animate: lastRenderedLyricsSignature !== createLyricsSignature(track, cachedLyrics)
            });
          } else {
            renderLoading(container, track);
          }

          try {
            const lyrics = await services.resolveLyrics(track);
            resolvedLyricsCache.set(trackKey, lyrics ?? null);

            if (disposed) {
              return;
            }

            const nextSignature = createLyricsSignature(track, lyrics);
            if (nextSignature === mountedSignature) {
              return;
            }

            renderTrackLyrics(track, lyrics, {
              animate: lastRenderedLyricsSignature !== nextSignature
            });
          } catch (error) {
            if (disposed) {
              return;
            }

            cleanup();
            mountedSignature = `${trackKey}::error`;
            lastRenderedLyricsSignature = mountedSignature;
            renderEmpty(container, "Lyrics unavailable", error.message || "Lyrics lookup failed.", {
              animate: !hasCachedLyrics
            });
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
