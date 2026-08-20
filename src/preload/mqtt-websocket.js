const { EventEmitter } = require("node:events");

const MQTT_PROTOCOL_NAME = "MQTT";
const MQTT_PROTOCOL_LEVEL = 4;
const DEFAULT_KEEP_ALIVE_SECONDS = 30;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_PERIOD_MS = 3_000;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PENDING_ACKS = 64;
const DEFAULT_MAX_PACKET_BYTES = 256 * 1024;

function encodeRemainingLength(value) {
  let remaining = Math.max(0, Number(value) || 0);
  const bytes = [];

  do {
    let encoded = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      encoded |= 0x80;
    }
    bytes.push(encoded);
  } while (remaining > 0 && bytes.length < 4);

  if (remaining > 0) {
    throw new RangeError("MQTT packet is too large.");
  }

  return Uint8Array.from(bytes);
}

function encodeUtf8String(value) {
  const bytes = Buffer.from(String(value || ""), "utf8");
  if (bytes.length > 0xffff) {
    throw new RangeError("MQTT string is too long.");
  }

  const result = Buffer.allocUnsafe(bytes.length + 2);
  result.writeUInt16BE(bytes.length, 0);
  bytes.copy(result, 2);
  return result;
}

function createPacket(header, body = Buffer.alloc(0)) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([
    Buffer.from([header]),
    Buffer.from(encodeRemainingLength(payload.length)),
    payload
  ]);
}

function createConnectPacket({ clientId, clean = true, keepAlive = DEFAULT_KEEP_ALIVE_SECONDS } = {}) {
  const protocol = encodeUtf8String(MQTT_PROTOCOL_NAME);
  const variableHeader = Buffer.allocUnsafe(protocol.length + 4);
  protocol.copy(variableHeader, 0);
  variableHeader[protocol.length] = MQTT_PROTOCOL_LEVEL;
  variableHeader[protocol.length + 1] = clean ? 0x02 : 0;
  variableHeader.writeUInt16BE(Math.max(0, Math.min(0xffff, Number(keepAlive) || 0)), protocol.length + 2);

  return createPacket(0x10, Buffer.concat([
    variableHeader,
    encodeUtf8String(clientId)
  ]));
}

function readUtf8String(buffer, offset) {
  if (offset + 2 > buffer.length) {
    throw new Error("Malformed MQTT string.");
  }

  const length = buffer.readUInt16BE(offset);
  const start = offset + 2;
  const end = start + length;
  if (end > buffer.length) {
    throw new Error("Malformed MQTT string payload.");
  }

  return {
    value: buffer.toString("utf8", start, end),
    nextOffset: end
  };
}

function concatBuffers(left, right) {
  if (!left.length) {
    return Buffer.from(right);
  }
  if (!right.length) {
    return left;
  }
  return Buffer.concat([left, Buffer.from(right)]);
}

function parsePacketFrame(buffer, maxPacketBytes) {
  if (buffer.length < 2) {
    return null;
  }

  let multiplier = 1;
  let remainingLength = 0;
  let cursor = 1;
  let encodedBytes = 0;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    remainingLength += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    cursor += 1;
    encodedBytes += 1;

    if (encodedBytes > 4) {
      throw new Error("Malformed MQTT remaining length.");
    }
    if ((byte & 0x80) === 0) {
      break;
    }
  }

  if (!encodedBytes || (buffer[cursor - 1] & 0x80) !== 0) {
    return null;
  }
  if (remainingLength > maxPacketBytes) {
    throw new Error("MQTT packet exceeds the configured size limit.");
  }

  const frameLength = cursor + remainingLength;
  if (buffer.length < frameLength) {
    return null;
  }

  return {
    header: buffer[0],
    body: buffer.subarray(cursor, frameLength),
    consumed: frameLength
  };
}

class MqttWebSocketClient extends EventEmitter {
  constructor(url, options = {}) {
    super();
    const resolveNumberOption = (value, fallback, minimum = 0) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue)
        ? Math.max(minimum, numericValue)
        : fallback;
    };
    this.url = String(url || "").trim();
    this.options = {
      clientId: options.clientId || `apollo-client-${Date.now().toString(36)}`,
      clean: options.clean !== false,
      connectTimeout: resolveNumberOption(options.connectTimeout, DEFAULT_CONNECT_TIMEOUT_MS, 1),
      reconnectPeriod: resolveNumberOption(options.reconnectPeriod, DEFAULT_RECONNECT_PERIOD_MS),
      keepalive: resolveNumberOption(options.keepalive, DEFAULT_KEEP_ALIVE_SECONDS),
      ackTimeout: resolveNumberOption(options.ackTimeout, DEFAULT_ACK_TIMEOUT_MS, 1),
      maxPendingAcks: Math.max(
        1,
        Math.trunc(resolveNumberOption(options.maxPendingAcks, DEFAULT_MAX_PENDING_ACKS, 1))
      ),
      maxPacketBytes: resolveNumberOption(options.maxPacketBytes, DEFAULT_MAX_PACKET_BYTES, 1024)
    };
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.connected = false;
    this.ended = false;
    this.socket = null;
    this.receiveBuffer = Buffer.alloc(0);
    this.nextPacketId = 1;
    this.pendingAcks = new Map();
    this.dataQueue = Promise.resolve();
    this.connectTimeoutHandle = null;
    this.reconnectHandle = null;
    this.keepAliveHandle = null;
    this.lastPacketAt = 0;

    if (!this.url) {
      queueMicrotask(() => this.emit("error", new Error("MQTT broker URL is required.")));
      return;
    }
    if (typeof this.WebSocketImpl !== "function") {
      queueMicrotask(() => this.emit("error", new Error("WebSocket is unavailable in this Electron runtime.")));
      return;
    }

    this.openSocket(false);
  }

  allocatePacketId() {
    for (let attempt = 0; attempt < 0xffff; attempt += 1) {
      const packetId = this.nextPacketId;
      this.nextPacketId = packetId >= 0xffff ? 1 : packetId + 1;
      if (!this.pendingAcks.has(packetId)) {
        return packetId;
      }
    }

    throw new Error("MQTT acknowledgement queue is exhausted.");
  }

  clearTimer(name) {
    if (this[name]) {
      clearTimeout(this[name]);
      clearInterval(this[name]);
      this[name] = null;
    }
  }

  clearConnectionTimers() {
    this.clearTimer("connectTimeoutHandle");
    this.clearTimer("keepAliveHandle");
  }

  startKeepAlive() {
    this.clearTimer("keepAliveHandle");
    if (!this.options.keepalive) {
      return;
    }

    const intervalMs = Math.max(1_000, this.options.keepalive * 500);
    this.keepAliveHandle = setInterval(() => {
      if (!this.connected || !this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
        return;
      }

      if (Date.now() - this.lastPacketAt >= this.options.keepalive * 1_000) {
        this.sendPacket(createPacket(0xc0));
      }
    }, intervalMs);
    this.keepAliveHandle.unref?.();
  }

  openSocket(isReconnect) {
    if (this.ended) {
      return;
    }

    this.clearConnectionTimers();
    this.receiveBuffer = Buffer.alloc(0);

    if (isReconnect) {
      this.emit("reconnect");
    }

    let socket;
    try {
      socket = new this.WebSocketImpl(this.url, "mqtt");
    } catch (error) {
      this.emit("error", error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    try {
      socket.binaryType = "arraybuffer";
    } catch {
      // Some WebSocket implementations expose a read-only binaryType.
    }

    this.connectTimeoutHandle = setTimeout(() => {
      if (this.socket !== socket || this.connected || this.ended) {
        return;
      }
      this.emit("error", new Error("MQTT WebSocket connection timed out."));
      try {
        socket.close();
      } catch {
        this.scheduleReconnect();
      }
    }, this.options.connectTimeout);
    this.connectTimeoutHandle.unref?.();

    socket.onopen = () => {
      if (this.socket === socket && !this.ended) {
        this.sendPacket(createConnectPacket(this.options));
      }
    };

    socket.onmessage = (event) => {
      if (this.socket === socket && !this.ended) {
        void this.handleSocketData(event?.data, socket);
      }
    };

    socket.onerror = () => {
      if (this.socket === socket && !this.ended) {
        this.emit("error", new Error("MQTT WebSocket connection failed."));
      }
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.clearConnectionTimers();
      this.socket = null;
      const wasConnected = this.connected;
      this.connected = false;
      this.rejectPendingAcks(new Error("MQTT connection closed."));
      if (wasConnected) {
        this.emit("offline");
      }
      this.emit("close");
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.ended || this.reconnectHandle || !this.options.reconnectPeriod) {
      return;
    }

    this.reconnectHandle = setTimeout(() => {
      this.reconnectHandle = null;
      this.openSocket(true);
    }, this.options.reconnectPeriod);
    this.reconnectHandle.unref?.();
  }

  handleSocketData(data, socket = this.socket) {
    this.dataQueue = this.dataQueue.then(() => this.consumeSocketData(data, socket));
    return this.dataQueue;
  }

  async consumeSocketData(data, socket) {
    try {
      let bytes;
      if (data instanceof ArrayBuffer) {
        bytes = Buffer.from(data);
      } else if (ArrayBuffer.isView(data)) {
        bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      } else if (typeof Blob !== "undefined" && data instanceof Blob) {
        bytes = Buffer.from(await data.arrayBuffer());
      } else {
        bytes = Buffer.from(data || []);
      }

      if (this.socket !== socket || this.ended) {
        return;
      }

      this.receiveBuffer = concatBuffers(this.receiveBuffer, bytes);
      while (this.receiveBuffer.length) {
        const frame = parsePacketFrame(this.receiveBuffer, this.options.maxPacketBytes);
        if (!frame) {
          break;
        }
        this.receiveBuffer = this.receiveBuffer.subarray(frame.consumed);
        this.handlePacket(frame.header, frame.body);
      }
    } catch (error) {
      if (this.socket !== socket || this.ended) {
        return;
      }
      this.emit("error", error);
      try {
        socket?.close();
      } catch {
        // Ignore teardown failures after malformed broker data.
      }
    }
  }

  handlePacket(header, body) {
    const packetType = header >> 4;
    this.lastPacketAt = Date.now();

    if (packetType === 2) {
      if (body.length < 2 || body[1] !== 0) {
        const returnCode = body.length >= 2 ? body[1] : -1;
        this.emit("error", new Error(`MQTT broker rejected the connection (${returnCode}).`));
        this.socket?.close();
        return;
      }
      this.clearTimer("connectTimeoutHandle");
      this.connected = true;
      this.startKeepAlive();
      this.emit("connect", { sessionPresent: Boolean(body[0] & 0x01) });
      return;
    }

    if (packetType === 3) {
      const topic = readUtf8String(body, 0);
      let offset = topic.nextOffset;
      const qos = (header >> 1) & 0x03;
      let packetId = 0;
      if (qos > 0) {
        if (offset + 2 > body.length) {
          throw new Error("Malformed MQTT publish packet.");
        }
        packetId = body.readUInt16BE(offset);
        offset += 2;
      }
      this.emit("message", topic.value, Buffer.from(body.subarray(offset)));
      if (qos === 1 && packetId) {
        const acknowledgement = Buffer.allocUnsafe(2);
        acknowledgement.writeUInt16BE(packetId, 0);
        this.sendPacket(createPacket(0x40, acknowledgement));
      }
      return;
    }

    if ([4, 9, 11].includes(packetType)) {
      if (body.length < 2) {
        throw new Error("Malformed MQTT acknowledgement packet.");
      }
      const packetId = body.readUInt16BE(0);
      const grants = packetType === 9 ? body.subarray(2) : undefined;
      const error = grants?.includes(0x80)
        ? new Error("MQTT broker rejected the subscription.")
        : null;
      this.settlePendingAck(packetId, error, grants);
    }
  }

  settlePendingAck(packetId, error = null, grants = undefined) {
    const pending = this.pendingAcks.get(packetId);
    if (!pending) {
      return false;
    }

    this.pendingAcks.delete(packetId);
    clearTimeout(pending.timeoutHandle);
    try {
      pending.callback(error, grants);
    } catch {
      // A consumer callback must not tear down the signaling connection.
    }
    return true;
  }

  registerPendingAck(packetId, callback) {
    while (this.pendingAcks.size >= this.options.maxPendingAcks) {
      const oldestPacketId = this.pendingAcks.keys().next().value;
      this.settlePendingAck(
        oldestPacketId,
        new Error("MQTT acknowledgement queue limit reached.")
      );
    }

    const timeoutHandle = setTimeout(() => {
      this.settlePendingAck(packetId, new Error("MQTT acknowledgement timed out."));
    }, this.options.ackTimeout);
    timeoutHandle.unref?.();
    this.pendingAcks.set(packetId, {
      callback: callback || (() => {}),
      timeoutHandle
    });
  }

  rejectPendingAcks(error) {
    for (const packetId of [...this.pendingAcks.keys()]) {
      this.settlePendingAck(packetId, error);
    }
  }

  sendPacket(packet) {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error("MQTT WebSocket is not connected.");
    }
    this.lastPacketAt = Date.now();
    this.socket.send(packet);
  }

  subscribe(topics, options, callback) {
    const resolvedCallback = typeof options === "function" ? options : callback;
    const topicList = (Array.isArray(topics) ? topics : [topics])
      .map((topic) => String(topic || "").trim())
      .filter(Boolean);
    if (!topicList.length) {
      resolvedCallback?.(new Error("At least one MQTT topic is required."));
      return this;
    }

    try {
      const packetId = this.allocatePacketId();
      const packetIdBuffer = Buffer.allocUnsafe(2);
      packetIdBuffer.writeUInt16BE(packetId, 0);
      const body = Buffer.concat([
        packetIdBuffer,
        ...topicList.flatMap((topic) => [encodeUtf8String(topic), Buffer.from([0])])
      ]);
      this.sendPacket(createPacket(0x82, body));
      this.registerPendingAck(packetId, resolvedCallback);
    } catch (error) {
      resolvedCallback?.(error);
      if (!resolvedCallback) {
        this.emit("error", error);
      }
    }
    return this;
  }

  unsubscribe(topics, callback) {
    const topicList = (Array.isArray(topics) ? topics : [topics])
      .map((topic) => String(topic || "").trim())
      .filter(Boolean);
    if (!topicList.length) {
      callback?.(new Error("At least one MQTT topic is required."));
      return this;
    }

    try {
      const packetId = this.allocatePacketId();
      const packetIdBuffer = Buffer.allocUnsafe(2);
      packetIdBuffer.writeUInt16BE(packetId, 0);
      this.sendPacket(createPacket(0xa2, Buffer.concat([
        packetIdBuffer,
        ...topicList.map(encodeUtf8String)
      ])));
      this.registerPendingAck(packetId, callback);
    } catch (error) {
      callback?.(error);
      if (!callback) {
        this.emit("error", error);
      }
    }
    return this;
  }

  publish(topic, payload, options, callback) {
    const resolvedCallback = typeof options === "function" ? options : callback;
    try {
      const topicBuffer = encodeUtf8String(topic);
      const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ""), "utf8");
      this.sendPacket(createPacket(0x30, Buffer.concat([topicBuffer, payloadBuffer])));
      resolvedCallback?.(null);
    } catch (error) {
      resolvedCallback?.(error);
      if (!resolvedCallback) {
        this.emit("error", error);
      }
    }
    return this;
  }

  end(force = false, callback) {
    this.ended = true;
    this.connected = false;
    this.clearConnectionTimers();
    this.clearTimer("reconnectHandle");
    this.rejectPendingAcks(new Error("MQTT client ended."));

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        if (!force && socket.readyState === this.WebSocketImpl.OPEN) {
          socket.send(createPacket(0xe0));
        }
        socket.close();
      } catch {
        // Ignore teardown failures.
      }
    }

    callback?.();
    return this;
  }
}

function createMqttWebSocketAdapter({ WebSocketImpl = globalThis.WebSocket } = {}) {
  return {
    connect(url, options = {}) {
      return new MqttWebSocketClient(url, { ...options, WebSocketImpl });
    }
  };
}

module.exports = {
  DEFAULT_ACK_TIMEOUT_MS,
  DEFAULT_MAX_PACKET_BYTES,
  DEFAULT_MAX_PENDING_ACKS,
  MqttWebSocketClient,
  createMqttWebSocketAdapter,
  createConnectPacket,
  createPacket,
  encodeRemainingLength,
  encodeUtf8String,
  parsePacketFrame
};
