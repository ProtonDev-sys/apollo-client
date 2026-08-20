const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  OPCODES,
  createActivityPayload,
  createDiscordIpcModule,
  createFrameDecoder,
  encodeFrame,
  getSocketPath
} = require("../src/main/discord-ipc");

function decodeWrittenFrame(frame) {
  const opcode = frame.readInt32LE(0);
  const bodyLength = frame.readInt32LE(4);
  return {
    opcode,
    payload: JSON.parse(frame.subarray(8, bodyLength + 8).toString("utf8"))
  };
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writes = [];
  }

  write(frame) {
    if (this.destroyed) {
      throw new Error("socket closed");
    }
    const packet = Buffer.from(frame);
    this.writes.push(packet);
    const decoded = decodeWrittenFrame(packet);
    if (decoded.opcode === OPCODES.HANDSHAKE) {
      queueMicrotask(() => {
        this.emit("data", encodeFrame(OPCODES.FRAME, {
          cmd: "DISPATCH",
          evt: "READY",
          data: { user: { id: "1" } }
        }));
      });
    } else if (decoded.opcode === OPCODES.FRAME && decoded.payload.nonce) {
      queueMicrotask(() => {
        this.emit("data", encodeFrame(OPCODES.FRAME, {
          cmd: decoded.payload.cmd,
          nonce: decoded.payload.nonce,
          data: { ok: true }
        }));
      });
    }
    return true;
  }

  end() {}

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.emit("close");
  }
}

test("Discord IPC frame decoder handles fragmentation and coalescing", () => {
  const frames = [];
  const decode = createFrameDecoder((opcode, payload) => frames.push({ opcode, payload }));
  const first = encodeFrame(OPCODES.PING, { one: 1 });
  const second = encodeFrame(OPCODES.FRAME, { two: 2 });

  decode(first.subarray(0, 5));
  assert.deepEqual(frames, []);
  decode(Buffer.concat([first.subarray(5), second]));
  assert.deepEqual(frames, [
    { opcode: OPCODES.PING, payload: { one: 1 } },
    { opcode: OPCODES.FRAME, payload: { two: 2 } }
  ]);
});

test("Discord IPC uses native platform socket locations", () => {
  assert.equal(
    getSocketPath(3, { platform: "win32", env: {} }),
    "\\\\?\\pipe\\discord-ipc-3"
  );
  assert.equal(
    getSocketPath(2, { platform: "linux", env: { XDG_RUNTIME_DIR: "/run/user/1000/" } }),
    "/run/user/1000/discord-ipc-2"
  );
});

test("Discord IPC client logs in and sends activity without a package dependency", async () => {
  const socket = new FakeSocket();
  const module = createDiscordIpcModule({
    createConnection() {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
    platform: "linux",
    env: { XDG_RUNTIME_DIR: "/tmp" },
    createNonce: (() => {
      let value = 0;
      return () => `nonce-${value += 1}`;
    })()
  });
  const client = new module.Client();
  client.on("error", () => {});

  await client.login({ clientId: "1234567890" });
  await client.setActivity({
    details: "Song",
    state: "Artist",
    startTimestamp: new Date(1000),
    endTimestamp: new Date(2000),
    largeImageKey: "cover",
    partyId: "party",
    partySize: 1,
    partyMax: 4,
    joinSecret: "apollo://listen/session"
  }, 42);

  const activityPacket = socket.writes
    .map(decodeWrittenFrame)
    .find(({ payload }) => payload.cmd === "SET_ACTIVITY");
  assert.equal(activityPacket.opcode, OPCODES.FRAME);
  assert.deepEqual(activityPacket.payload.args, {
    pid: 42,
    activity: {
      state: "Artist",
      details: "Song",
      timestamps: { start: 1000, end: 2000 },
      assets: { large_image: "cover" },
      party: { id: "party", size: [1, 4] },
      secrets: { join: "apollo://listen/session" },
      instance: false
    }
  });
  await client.destroy();
});

test("activity payload preserves the established Discord field mapping", () => {
  assert.deepEqual(createActivityPayload({ details: "Track" }, 7), {
    pid: 7,
    activity: {
      state: undefined,
      details: "Track",
      timestamps: undefined,
      assets: undefined,
      party: undefined,
      secrets: undefined,
      buttons: undefined,
      instance: false
    }
  });
});
