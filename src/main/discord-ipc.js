const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const net = require("node:net");

const OPCODES = Object.freeze({
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4
});
const MAX_SOCKET_CANDIDATES = 10;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 64;
const REQUEST_TIMEOUT_MS = 10_000;

function getSocketPath(index, { platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") {
    return `\\\\?\\pipe\\discord-ipc-${index}`;
  }

  const prefix = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
  return `${String(prefix).replace(/\/$/, "")}/discord-ipc-${index}`;
}

function encodeFrame(opcode, payload = {}) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.allocUnsafe(body.length + 8);
  frame.writeInt32LE(opcode, 0);
  frame.writeInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

function createFrameDecoder(onFrame, { maxFrameBytes = MAX_FRAME_BYTES } = {}) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    buffer = buffer.length ? Buffer.concat([buffer, bytes]) : Buffer.from(bytes);

    while (buffer.length >= 8) {
      const opcode = buffer.readInt32LE(0);
      const bodyLength = buffer.readInt32LE(4);
      if (bodyLength < 0 || bodyLength > maxFrameBytes) {
        buffer = Buffer.alloc(0);
        throw new Error("Discord IPC frame exceeds the configured size limit.");
      }

      const frameLength = bodyLength + 8;
      if (buffer.length < frameLength) {
        break;
      }

      const body = buffer.subarray(8, frameLength);
      buffer = buffer.subarray(frameLength);
      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        throw new Error("Discord IPC returned malformed JSON.");
      }
      onFrame(opcode, payload);
    }
  };
}

function connectToDiscord({
  createConnection,
  platform,
  env,
  maxCandidates = MAX_SOCKET_CANDIDATES
}) {
  return new Promise((resolve, reject) => {
    let index = 0;
    let lastError = null;

    const tryNext = () => {
      if (index >= maxCandidates) {
        reject(lastError || new Error("Could not connect"));
        return;
      }

      const socketPath = getSocketPath(index, { platform, env });
      index += 1;
      let socket;
      try {
        socket = createConnection(socketPath);
      } catch (error) {
        lastError = error;
        tryNext();
        return;
      }

      const handleFailure = (error) => {
        lastError = error;
        socket.removeListener?.("connect", handleConnect);
        socket.removeListener?.("error", handleFailure);
        socket.destroy?.();
        tryNext();
      };
      const handleConnect = () => {
        socket.removeListener?.("error", handleFailure);
        resolve(socket);
      };

      socket.once("error", handleFailure);
      socket.once("connect", handleConnect);
    };

    tryNext();
  });
}

function createActivityPayload(args = {}, pid = process.pid) {
  let timestamps;
  let assets;
  let party;
  let secrets;

  if (args.startTimestamp || args.endTimestamp) {
    const resolveTimestamp = (value) => value instanceof Date ? value.getTime() : value;
    timestamps = {
      start: resolveTimestamp(args.startTimestamp),
      end: resolveTimestamp(args.endTimestamp)
    };
  }

  if (args.largeImageKey || args.largeImageText || args.smallImageKey || args.smallImageText) {
    assets = {
      large_image: args.largeImageKey,
      large_text: args.largeImageText,
      small_image: args.smallImageKey,
      small_text: args.smallImageText
    };
  }

  if (args.partySize || args.partyId || args.partyMax) {
    party = { id: args.partyId };
    if (args.partySize || args.partyMax) {
      party.size = [args.partySize, args.partyMax];
    }
  }

  if (args.matchSecret || args.joinSecret || args.spectateSecret) {
    secrets = {
      match: args.matchSecret,
      join: args.joinSecret,
      spectate: args.spectateSecret
    };
  }

  return {
    pid,
    activity: {
      state: args.state,
      details: args.details,
      timestamps,
      assets,
      party,
      secrets,
      buttons: args.buttons,
      instance: Boolean(args.instance)
    }
  };
}

function createDiscordIpcModule({
  createConnection = (socketPath) => net.createConnection(socketPath),
  platform = process.platform,
  env = process.env,
  createNonce = () => randomUUID(),
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  maxPendingRequests = MAX_PENDING_REQUESTS
} = {}) {
  class Client extends EventEmitter {
    constructor() {
      super();
      this.clientId = "";
      this.socket = null;
      this.pending = new Map();
      this.connectPromise = null;
      this.destroyed = false;
      this.handleData = createFrameDecoder((opcode, payload) => {
        this.handleFrame(opcode, payload);
      });
    }

    send(opcode, payload) {
      if (!this.socket || this.socket.destroyed || this.destroyed) {
        throw new Error("Discord IPC is not connected.");
      }
      this.socket.write(encodeFrame(opcode, payload));
    }

    settlePending(nonce, error, data) {
      const pending = this.pending.get(nonce);
      if (!pending) {
        return false;
      }
      this.pending.delete(nonce);
      clearTimeout(pending.timeoutHandle);
      if (error) {
        pending.reject(error);
      } else {
        pending.resolve(data);
      }
      return true;
    }

    rejectPending(error) {
      for (const nonce of [...this.pending.keys()]) {
        this.settlePending(nonce, error);
      }
    }

    handleDisconnect(error = new Error("connection closed")) {
      const socket = this.socket;
      this.socket = null;
      this.connectPromise = null;
      this.rejectPending(error);
      if (socket && !this.destroyed) {
        this.emit("disconnected");
      }
    }

    handleFrame(opcode, payload) {
      if (opcode === OPCODES.PING) {
        this.send(OPCODES.PONG, payload);
        return;
      }
      if (opcode === OPCODES.CLOSE) {
        this.handleDisconnect(new Error(payload?.message || "connection closed"));
        this.socket?.destroy?.();
        return;
      }
      if (opcode !== OPCODES.FRAME || !payload) {
        return;
      }

      if (payload.cmd === "DISPATCH" && payload.evt === "READY") {
        this.emit("connected", payload.data);
        return;
      }

      if (payload.nonce && this.pending.has(payload.nonce)) {
        if (payload.evt === "ERROR") {
          const error = new Error(payload.data?.message || "Discord IPC request failed.");
          error.code = payload.data?.code;
          error.data = payload.data;
          this.settlePending(payload.nonce, error);
        } else {
          this.settlePending(payload.nonce, null, payload.data);
        }
        return;
      }

      if (payload.evt) {
        this.emit(payload.evt, payload.data);
      }
    }

    async connect(clientId) {
      if (this.connectPromise) {
        return this.connectPromise;
      }
      if (!clientId) {
        throw new Error("Discord client ID is required.");
      }

      this.destroyed = false;
      this.clientId = String(clientId);
      this.connectPromise = (async () => {
        const socket = await connectToDiscord({ createConnection, platform, env });
        if (this.destroyed) {
          socket.destroy?.();
          throw new Error("Discord IPC client was destroyed.");
        }

        this.socket = socket;
        socket.on("data", (chunk) => {
          try {
            this.handleData(chunk);
          } catch (error) {
            this.emit("error", error);
            socket.destroy?.();
          }
        });
        socket.on("error", (error) => {
          if (this.socket === socket && !this.destroyed) {
            this.emit("error", error);
          }
        });
        socket.on("close", () => {
          if (this.socket === socket) {
            this.handleDisconnect();
          }
        });

        const ready = new Promise((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            cleanup();
            reject(new Error("RPC_CONNECTION_TIMEOUT"));
          }, requestTimeoutMs);
          timeoutHandle.unref?.();
          const handleReady = (payload) => {
            cleanup();
            resolve(payload);
          };
          const handleClose = () => {
            cleanup();
            reject(new Error("connection closed"));
          };
          const cleanup = () => {
            clearTimeout(timeoutHandle);
            this.removeListener("connected", handleReady);
            this.removeListener("disconnected", handleClose);
          };
          this.once("connected", handleReady);
          this.once("disconnected", handleClose);
        });

        this.send(OPCODES.HANDSHAKE, {
          v: 1,
          client_id: this.clientId
        });
        await ready;
        return this;
      })().catch((error) => {
        this.connectPromise = null;
        this.socket?.destroy?.();
        this.socket = null;
        throw error;
      });

      return this.connectPromise;
    }

    async login({ clientId } = {}) {
      await this.connect(clientId);
      this.emit("ready");
      return this;
    }

    request(cmd, args = undefined, evt = undefined) {
      if (this.pending.size >= maxPendingRequests) {
        return Promise.reject(new Error("Discord IPC request queue limit reached."));
      }

      const nonce = createNonce();
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this.settlePending(nonce, new Error("Discord IPC request timed out."));
        }, requestTimeoutMs);
        timeoutHandle.unref?.();
        this.pending.set(nonce, { resolve, reject, timeoutHandle });

        try {
          this.send(OPCODES.FRAME, { cmd, args, evt, nonce });
        } catch (error) {
          this.settlePending(nonce, error);
        }
      });
    }

    setActivity(args = {}, pid = process.pid) {
      return this.request("SET_ACTIVITY", createActivityPayload(args, pid));
    }

    clearActivity(pid = process.pid) {
      return this.request("SET_ACTIVITY", { pid });
    }

    async subscribe(event, args) {
      await this.request("SUBSCRIBE", args, event);
      return {
        unsubscribe: () => this.request("UNSUBSCRIBE", args, event)
      };
    }

    async destroy() {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      this.rejectPending(new Error("Discord IPC client ended."));
      const socket = this.socket;
      this.socket = null;
      this.connectPromise = null;
      if (!socket) {
        return;
      }
      try {
        socket.write(encodeFrame(OPCODES.CLOSE, {}));
      } catch {
        // Ignore shutdown writes after the peer disconnects.
      }
      socket.end?.();
      socket.destroy?.();
    }
  }

  return {
    Client,
    register() {}
  };
}

module.exports = {
  ...createDiscordIpcModule(),
  OPCODES,
  createActivityPayload,
  createDiscordIpcModule,
  createFrameDecoder,
  encodeFrame,
  getSocketPath
};
