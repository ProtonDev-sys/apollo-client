const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function encodeField(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function normaliseText(value, maxLength = 512) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function resolveHelperPath() {
  const relativeSegments = ["native-bin", "win32-x64", "discord-social-helper.exe"];
  const packagedPath = path.join(process.resourcesPath || "", ...relativeSegments);
  const appPath = path.join(__dirname, ...relativeSegments);

  if (process.resourcesPath && fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  if (fs.existsSync(appPath)) {
    return appPath;
  }

  return packagedPath;
}

function resolveLaunchCommand({ appPath, execPath, isPackaged, protocolBase }) {
  if (isPackaged) {
    return `"${execPath}" "${protocolBase}"`;
  }

  return `"${execPath}" "${appPath}" "${protocolBase}"`;
}

function createDiscordSocialBridge({
  applicationId,
  appPath,
  execPath,
  userDataPath,
  isPackaged,
  gameWindowPid,
  logger = null
}) {
  const bridge = new EventEmitter();
  const helperPath = resolveHelperPath();
  const tokenFilePath = path.join(userDataPath, "discord-social-auth.txt");
  const launchCommand = resolveLaunchCommand({
    appPath,
    execPath,
    isPackaged,
    protocolBase: "apollo://discord"
  });

  let helperProcess = null;
  let helperStdoutBuffer = "";
  let requestCounter = 0;
  let helperExitPromise = null;
  let state = {
    available: process.platform === "win32" && fs.existsSync(helperPath),
    helperRunning: false,
    authenticated: false,
    ready: false,
    authInProgress: false,
    message: process.platform === "win32"
      ? "Discord Social SDK helper not started."
      : "Discord Social SDK is only configured for Windows builds."
  };

  function log(message) {
    if (typeof logger === "function") {
      logger(`[social-bridge] ${message}`);
    }
  }

  function emitState(nextState = {}) {
    state = {
      ...state,
      ...nextState
    };
    bridge.emit("state", state);
  }

  function nextRequestId() {
    requestCounter += 1;
    return `discord-social-${requestCounter}`;
  }

  function sendCommand(parts) {
    if (!helperProcess?.stdin?.writable) {
      log(`sendCommand skipped command=${parts[0] || "unknown"} writable=false`);
      return false;
    }

    helperProcess.stdin.write(`${parts.join("\t")}\n`);
    log(`sendCommand ok command=${parts[0] || "unknown"}`);
    return true;
  }

  const pendingRequests = new Map();

  function rejectPendingRequests(message) {
    const error = new Error(message);

    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }

    pendingRequests.clear();
  }

  function sendRequest(createCommand, unavailableMessage = "Discord helper is unavailable.") {
    start();
    const requestId = nextRequestId();

    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, {
        resolve,
        reject
      });

      const command = typeof createCommand === "function"
        ? createCommand(requestId)
        : [];

      if (!sendCommand(command)) {
        pendingRequests.delete(requestId);
        reject(new Error(unavailableMessage));
      }
    });
  }

  function resolvePendingRequest(type, payload) {
    if (!payload?.requestId || !pendingRequests.has(payload.requestId)) {
      return;
    }

    const request = pendingRequests.get(payload.requestId);
    pendingRequests.delete(payload.requestId);

    if (type === "friends") {
      request.resolve(payload.friends || []);
      return;
    }

    if (type === "invite-result") {
      if (payload.success) {
        request.resolve(payload);
      } else {
        request.reject(new Error(payload.message || "Discord invite failed."));
      }
    }
  }

  function handleHelperMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
    case "state":
      emitState({
        helperRunning: true,
        authenticated: Boolean(message.authenticated),
        ready: Boolean(message.ready),
        authInProgress: Boolean(message.authInProgress),
        message: normaliseText(message.message, 240) || state.message
      });
      break;
    case "activity-join":
      if (typeof message.secret === "string" && message.secret.startsWith("apollo://")) {
        bridge.emit("join", message.secret);
      }
      break;
    case "friends":
      resolvePendingRequest("friends", message);
      break;
    case "invite-result":
      resolvePendingRequest("invite-result", message);
      break;
    case "fatal":
      emitState({
        helperRunning: false,
        message: normaliseText(message.message, 240) || "Discord Social SDK helper failed."
      });
      break;
    default:
      break;
    }
  }

  function attachHelperListeners() {
    helperExitPromise = new Promise((resolve) => {
      helperProcess.once("exit", resolve);
    });

    helperProcess.stdout.on("data", (chunk) => {
      helperStdoutBuffer += chunk.toString("utf8");
      const lines = helperStdoutBuffer.split(/\r?\n/);
      helperStdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          handleHelperMessage(JSON.parse(trimmed));
        } catch {
          // Ignore malformed helper output.
        }
      }
    });

    helperProcess.stderr.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        log(`stderr ${message}`);
      }
    });

    helperProcess.on("exit", (code) => {
      log(`helper exit code=${code}`);
      helperProcess = null;
      helperStdoutBuffer = "";
      helperExitPromise = null;
      rejectPendingRequests("Discord helper stopped.");

      emitState({
        helperRunning: false,
        ready: false,
        authInProgress: false,
        message: code === 0 ? "Discord helper stopped." : `Discord helper exited with code ${code}.`
      });
    });
  }

  function start() {
    if (!state.available || helperProcess) {
      if (!state.available) {
        log("start skipped unavailable");
      }
      return;
    }

    log(`starting helper path=${helperPath}`);
    helperProcess = spawn(
      helperPath,
      [
        "--app-id",
        String(applicationId),
        "--token-file",
        tokenFilePath,
        "--launch-command",
        launchCommand,
        "--game-pid",
        String(gameWindowPid || process.pid)
      ],
      {
        cwd: path.dirname(helperPath),
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    attachHelperListeners();
    emitState({
      helperRunning: true,
      message: "Starting Discord Social SDK..."
    });
  }

  function configure(config = {}) {
    if (!state.available) {
      log("configure skipped unavailable");
      return;
    }

    start();
    sendCommand([
      "configure_assets",
      encodeField(config.largeImageKey),
      encodeField(config.largeImageText),
      encodeField(config.smallImageKeyPlaying),
      encodeField(config.smallImageKeyPaused),
      encodeField(config.smallImageKeyBuffering)
    ]);
  }

  function updatePlayback(playback = {}) {
    if (!state.available) {
      log("updatePlayback skipped unavailable");
      return;
    }

    log(`updatePlayback title=${normaliseText(playback.title, 120)} status=${normaliseText(playback.status, 24)}`);
    start();
    sendCommand([
      "set_presence",
      encodeField(playback.title),
      encodeField(playback.artist),
      encodeField(playback.album),
      encodeField(playback.provider),
      encodeField(playback.buttonUrl),
      normaliseText(playback.status, 24) || "paused",
      String(Math.max(0, Math.round(Number(playback.currentTime || 0) * 1000))),
      String(Math.max(0, Math.round(Number(playback.duration || 0) * 1000))),
      encodeField(playback.partyId),
      String(Math.max(0, Math.round(Number(playback.partySize || 0)))),
      String(Math.max(0, Math.round(Number(playback.partyMax || 0)))),
      encodeField(playback.joinSecret),
      encodeField(playback.artworkUrl),
      encodeField(playback.listenAlongButtonUrl)
    ]);
  }

  async function clear() {
    if (!state.available) {
      log("clear skipped unavailable");
      return;
    }

    start();
    sendCommand(["clear_presence"]);
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
  }

  function startAuth() {
    if (!state.available) {
      throw new Error("Discord Social SDK is unavailable.");
    }

    if (state.authenticated || state.authInProgress) {
      log("startAuth skipped already-authenticated");
      return state;
    }

    log("startAuth");
    start();
    emitState({
      authInProgress: true,
      message: "Opening Discord sign-in..."
    });
    sendCommand(["start_auth"]);
  }

  function signOut() {
    if (!state.available) {
      log("signOut skipped unavailable");
      return;
    }

    start();
    sendCommand(["sign_out"]);
  }

  function listFriends() {
    if (!state.available) {
      log("listFriends skipped unavailable");
      return Promise.resolve([]);
    }

    return sendRequest((requestId) => ["list_friends", requestId]);
  }

  function sendActivityInvite({ userId, content }) {
    if (!state.available) {
      return Promise.reject(new Error("Discord Social SDK is unavailable."));
    }

    log(`sendActivityInvite userId=${String(userId || "")}`);
    return sendRequest((requestId) => [
        "invite",
        requestId,
        String(userId || ""),
        encodeField(content || "Listen along on Apollo")
      ]);
  }

  async function destroy() {
    if (!helperProcess) {
      log("destroy skipped no-helper");
      return;
    }

    log("destroy");
    await clear();
    sendCommand(["shutdown"]);
    helperProcess.stdin.end();

    const exitPromise = helperExitPromise;
    if (!exitPromise) {
      return;
    }

    const didExit = await Promise.race([
      exitPromise.then(() => true),
      new Promise((resolve) => {
        setTimeout(() => resolve(false), 1500);
      })
    ]);

    if (!didExit && helperProcess) {
      helperProcess.kill();
      await exitPromise.catch(() => {});
    }
  }

  return {
    start,
    configure,
    updatePlayback,
    clear,
    startAuth,
    signOut,
    listFriends,
    sendActivityInvite,
    getState: () => ({ ...state }),
    on: bridge.on.bind(bridge),
    destroy
  };
}

module.exports = {
  createDiscordSocialBridge
};
