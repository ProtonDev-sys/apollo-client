from pathlib import Path


renderer_path = Path("src/renderer.js")
source = renderer_path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    source = source.replace(old, new, 1)


def replace_exact_count(old: str, new: str, expected: int, label: str) -> None:
    global source
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    source = source.replace(old, new)


def replace_block(start: str, end: str, replacement: str, label: str) -> None:
    global source
    start_count = source.count(start)
    end_count = source.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(
            f"{label}: expected one boundary each, "
            f"found start={start_count}, end={end_count}"
        )

    start_index = source.index(start)
    end_index = source.index(end, start_index)
    source = source[:start_index] + replacement + source[end_index:]


replace_once(
    "  pollInFlight: false\n",
    "",
    "legacy joined-session inflight flag",
)
replace_once(
    "  task: () => refreshJoinedListenAlongSession(),\n",
    "  task: ({ isCurrent }) => refreshJoinedListenAlongSession({ isCurrent }),\n",
    "generation-aware polling task",
)
replace_exact_count(
    "  listenAlongState.pollInFlight = false;\n",
    "",
    2,
    "legacy joined-session inflight resets",
)
replace_once(
    "  void refreshJoinedListenAlongSession().catch(() => {});\n",
    "  void joinedListenAlongPolling.run();\n",
    "initial joined-session refresh",
)

replacement = '''async function applyListenAlongSessionSnapshot(
  session,
  { initial = false, sessionId = "", isCurrent = () => true } = {}
) {
  const resolvedSessionId = String(sessionId || listenAlongState.joinedSessionId || "").trim();
  const canApply = () => isJoinedListenAlongRefreshCurrent(resolvedSessionId, isCurrent);
  const sessionTrackId = String(session?.trackId || "").trim();
  if (!sessionTrackId || !canApply()) {
    return false;
  }

  const track = createListenAlongTrack(session, resolvedSessionId);
  const currentTrack = getPlaybackTrack();
  const currentTrackId = getListenAlongComparableTrackId(currentTrack);
  const needsTrackChange = currentTrackId !== sessionTrackId;

  if (needsTrackChange) {
    const didStartPlayback = await playResolvedTrack(track, {
      queueTracks: [track],
      preserveListenAlong: true
    });
    if (!didStartPlayback || !canApply()) {
      return false;
    }
  }

  if (!canApply()) {
    return false;
  }

  const playback = {
    status: session.status === "playing" ? "playing" : "paused",
    positionSeconds: Math.max(0, Number(session.positionSeconds) || 0),
    capturedAt: Math.max(0, Number(session.capturedAt) || 0),
    playbackRate: clampNumber(session.playbackRate, 0.25, 4, 1)
  };
  const duration = audioPlayer.duration
    || getCachedDuration(track)
    || Number(session.durationSeconds)
    || Number.MAX_SAFE_INTEGER;
  const targetTime = clampNumber(getListenAlongStartTime(playback), 0, duration, 0);
  const driftSeconds = Math.abs((audioPlayer.currentTime || 0) - targetTime);
  if (needsTrackChange || driftSeconds > DISCORD_LISTEN_SESSION_RESYNC_THRESHOLD_SECONDS) {
    audioPlayer.currentTime = targetTime;
  }

  if (!canApply()) {
    return false;
  }

  if (playback.status === "playing") {
    try {
      await audioPlayer.play();
    } catch {
      // Ignore autoplay/promise failures and keep the joined session active.
    }

    if (!canApply()) {
      return false;
    }
  } else {
    audioPlayer.pause();
  }

  if (!canApply()) {
    return false;
  }

  listenAlongState.joinedTrackId = sessionTrackId;

  if (initial) {
    state.message = playback.status === "playing"
      ? `Joined ${track.title} at ${formatDuration(targetTime)}.`
      : `Opened ${track.title} from Discord.`;
    render();
  }

  return true;
}

function isJoinedListenAlongRefreshCurrent(sessionId, isCurrent = () => true) {
  return Boolean(
    sessionId
    && typeof isCurrent === "function"
    && isCurrent()
    && listenAlongState.joinedSessionId === sessionId
    && listenAlongRtc.joinDataChannel?.readyState !== "open"
  );
}

async function refreshJoinedListenAlongSession({ isCurrent = () => true } = {}) {
  const sessionId = String(listenAlongState.joinedSessionId || "").trim();
  const sessionToken = String(listenAlongState.joinedSessionToken || "").trim();
  const peerCandidates = Array.isArray(listenAlongState.joinedPeerCandidates)
    ? [...listenAlongState.joinedPeerCandidates]
    : [];
  const preferredPeerBaseUrl = String(listenAlongState.joinedPeerBaseUrl || "").trim();
  const refreshIsCurrent = () => isJoinedListenAlongRefreshCurrent(sessionId, isCurrent);

  if (!refreshIsCurrent()) {
    return false;
  }

  try {
    const { session, peerBaseUrl } = await fetchListenAlongSession(sessionId, {
      sessionToken,
      peerCandidates,
      preferredPeerBaseUrl
    });

    if (!refreshIsCurrent()) {
      return false;
    }

    if (peerBaseUrl) {
      listenAlongState.joinedPeerBaseUrl = peerBaseUrl;
    }

    if (!session?.trackId) {
      stopJoinedListenAlongSession();
      return false;
    }

    return applyListenAlongSessionSnapshot(session, {
      sessionId,
      isCurrent
    });
  } catch (error) {
    if (!refreshIsCurrent()) {
      return false;
    }

    if (/404/i.test(String(error?.message || ""))) {
      stopJoinedListenAlongSession();
      state.message = "The listen along session ended.";
      renderStatus();
    } else if (!preferredPeerBaseUrl && !peerCandidates.length) {
      state.message = "This listen along link is missing peer connection details.";
      renderStatus();
    }

    return false;
  }
}

'''
replace_block(
    "async function applyListenAlongSessionSnapshot(",
    "function startJoinedListenAlongPolling(",
    replacement,
    "joined-session snapshot and refresh lifecycle",
)

replace_once(
    '''async function leaveJoinedListenAlongSession() {
  if (!listenAlongState.joinedSessionId) {
    return false;
  }

  await resetJoinedListenAlongPeer({
''',
    '''async function leaveJoinedListenAlongSession() {
  if (!listenAlongState.joinedSessionId) {
    return false;
  }

  joinedListenAlongPolling.stop();
  await resetJoinedListenAlongPeer({
''',
    "leave-session invalidation",
)
replace_once(
    '''    render();
    return;
  }

  await resetJoinedListenAlongPeer({
''',
    '''    render();
    return;
  }

  joinedListenAlongPolling.stop();
  await resetJoinedListenAlongPeer({
''',
    "new-session invalidation",
)

required_fragments = (
    "task: ({ isCurrent }) => refreshJoinedListenAlongSession({ isCurrent })",
    "void joinedListenAlongPolling.run();",
    "function isJoinedListenAlongRefreshCurrent(",
    "async function refreshJoinedListenAlongSession({ isCurrent = () => true } = {})",
    "listenAlongRtc.joinDataChannel?.readyState !== \"open\"",
)
for fragment in required_fragments:
    if fragment not in source:
        raise SystemExit(f"required renderer fragment is missing: {fragment}")

for forbidden_fragment in (
    "pollInFlight",
    "listenAlongState.pollHandle",
    "pollHandle:",
    "void refreshJoinedListenAlongSession().catch(() => {});",
):
    if forbidden_fragment in source:
        raise SystemExit(f"stale renderer fragment remains: {forbidden_fragment}")

renderer_path.write_text(source, encoding="utf-8")
print(f"renderer.js is now {len(source.encode('utf-8'))} bytes")
