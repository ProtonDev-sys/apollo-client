const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMqttWebSocketAdapter,
  createPacket,
  encodeUtf8String
} = require("../src/preload/mqtt-websocket");

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url, protocol) {
    this.url = url;
    this.protocol = protocol;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(bytes) {
    const buffer = Buffer.from(bytes);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    this.onmessage?.({ data: arrayBuffer });
  }

  send(packet) {
    if (this.failSend) {
      throw new Error("socket send failed");
    }
    this.sent.push(Buffer.from(packet));
  }

  close() {
    const wasOpen = this.readyState === FakeWebSocket.OPEN;
    this.readyState = 3;
    if (wasOpen) {
      this.onclose?.();
    }
  }
}

function packetIdFrom(packet) {
  let cursor = 1;
  while (packet[cursor] & 0x80) {
    cursor += 1;
  }
  cursor += 1;
  return packet.readUInt16BE(cursor);
}

async function connectClient(options = {}) {
  FakeWebSocket.instances.length = 0;
  const mqtt = createMqttWebSocketAdapter({ WebSocketImpl: FakeWebSocket });
  const client = mqtt.connect("wss://broker.example/mqtt", {
    clientId: "apollo-test",
    reconnectPeriod: 0,
    keepalive: 0,
    ...options
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.equal(socket.protocol, "mqtt");
  assert.equal(socket.sent[0][0], 0x10);
  socket.message(Buffer.from([0x20, 0x02, 0x00, 0x00]));
  await client.dataQueue;
  return { client, socket };
}

test("native adapter connects, subscribes, publishes, receives, and unsubscribes", async () => {
  const { client, socket } = await connectClient();
  assert.equal(client.connected, true);

  const subscribed = new Promise((resolve, reject) => {
    client.subscribe("apollo/session", (error) => error ? reject(error) : resolve());
  });
  const subscribePacket = socket.sent.at(-1);
  assert.equal(subscribePacket[0], 0x82);
  const subscribeId = packetIdFrom(subscribePacket);
  socket.message(Buffer.from([0x90, 0x03, subscribeId >> 8, subscribeId & 0xff, 0x00]));
  await subscribed;

  await new Promise((resolve, reject) => {
    client.publish("apollo/session", JSON.stringify({ ok: true }), (error) => error ? reject(error) : resolve());
  });
  assert.equal(socket.sent.at(-1)[0], 0x30);

  const received = new Promise((resolve) => {
    client.once("message", (topic, payload) => resolve({ topic, payload }));
  });
  socket.message(createPacket(0x30, Buffer.concat([
    encodeUtf8String("apollo/session"),
    Buffer.from('{"ok":true}')
  ])));
  const message = await received;
  assert.equal(message.topic, "apollo/session");
  assert.equal(message.payload.toString("utf8"), '{"ok":true}');

  const unsubscribed = new Promise((resolve, reject) => {
    client.unsubscribe("apollo/session", (error) => error ? reject(error) : resolve());
  });
  const unsubscribePacket = socket.sent.at(-1);
  assert.equal(unsubscribePacket[0], 0xa2);
  const unsubscribeId = packetIdFrom(unsubscribePacket);
  socket.message(Buffer.from([0xb0, 0x02, unsubscribeId >> 8, unsubscribeId & 0xff]));
  await unsubscribed;

  client.end(true);
  assert.equal(client.connected, false);
});

test("native adapter parses fragmented and coalesced packets", async () => {
  FakeWebSocket.instances.length = 0;
  const mqtt = createMqttWebSocketAdapter({ WebSocketImpl: FakeWebSocket });
  const client = mqtt.connect("wss://broker.example/mqtt", {
    clientId: "apollo-test",
    reconnectPeriod: 0,
    keepalive: 0
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();

  socket.message(Buffer.from([0x20, 0x02]));
  await client.dataQueue;
  assert.equal(client.connected, false);
  socket.message(Buffer.from([0x00, 0x00]));
  await client.dataQueue;
  assert.equal(client.connected, true);

  const messages = [];
  client.on("message", (topic, payload) => messages.push([topic, payload.toString("utf8")]));
  const first = createPacket(0x30, Buffer.concat([encodeUtf8String("a"), Buffer.from("1")]));
  const second = createPacket(0x30, Buffer.concat([encodeUtf8String("b"), Buffer.from("2")]));
  socket.message(Buffer.concat([first, second]));
  await client.dataQueue;
  assert.deepEqual(messages, [["a", "1"], ["b", "2"]]);
  client.end(true);
});

test("native adapter closes oversized streams without retaining data", async () => {
  const { client, socket } = await connectClient({ maxPacketBytes: 1024 });
  const error = new Promise((resolve) => client.once("error", resolve));
  socket.message(Buffer.from([0x30, 0xff, 0xff, 0x7f]));
  assert.match((await error).message, /size limit/);
  assert.equal(socket.readyState, 3);
  client.end(true);
});

test("native adapter does not retain acknowledgements when a send fails", async () => {
  const { client, socket } = await connectClient();
  socket.failSend = true;
  const error = await new Promise((resolve) => {
    client.subscribe("apollo/fail", (failure) => resolve(failure));
  });
  assert.match(error.message, /send failed/);
  assert.equal(client.pendingAcks.size, 0);
  socket.failSend = false;
  client.end(true);
});

test("native adapter bounds acknowledgement memory and expires missing acknowledgements", async () => {
  const { client } = await connectClient({
    ackTimeout: 15,
    maxPendingAcks: 2
  });
  const failures = [];
  client.subscribe("apollo/one", (error) => error && failures.push(error.message));
  client.subscribe("apollo/two", (error) => error && failures.push(error.message));
  client.subscribe("apollo/three", (error) => error && failures.push(error.message));

  assert.equal(client.pendingAcks.size, 2);
  assert.ok(failures.some((message) => /queue limit/.test(message)));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(client.pendingAcks.size, 0);
  assert.equal(failures.filter((message) => /timed out/.test(message)).length, 2);
  client.end(true);
});


test("native adapter serializes asynchronous Blob frames in arrival order", async () => {
  const { client, socket } = await connectClient();
  const messages = [];
  client.on("message", (topic, payload) => messages.push([topic, payload.toString("utf8")]));
  const firstPacket = createPacket(0x30, Buffer.concat([
    encodeUtf8String("first"),
    Buffer.from("1")
  ]));
  const secondPacket = createPacket(0x30, Buffer.concat([
    encodeUtf8String("second"),
    Buffer.from("2")
  ]));

  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  class DelayedBlob extends Blob {
    async arrayBuffer() {
      await firstGate;
      return super.arrayBuffer();
    }
  }

  const firstTask = client.handleSocketData(new DelayedBlob([firstPacket]), socket);
  const secondTask = client.handleSocketData(new Blob([secondPacket]), socket);
  await new Promise(setImmediate);
  assert.deepEqual(messages, []);
  releaseFirst();
  await Promise.all([firstTask, secondTask]);
  assert.deepEqual(messages, [["first", "1"], ["second", "2"]]);
  client.end(true);
});
