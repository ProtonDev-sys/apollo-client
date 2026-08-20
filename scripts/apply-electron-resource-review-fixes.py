from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


renderer_path = Path("src/renderer.js")
renderer = renderer_path.read_text(encoding="utf-8")
renderer = replace_once(
    renderer,
    '''function persistPlaybackState({ force = false } = {}) {
  if (!playbackStatePersistenceGate.shouldRun({ force })) {
    return;
  }
''',
    '''function persistPlaybackState({ throttled = false, force = false } = {}) {
  if (throttled && !playbackStatePersistenceGate.shouldRun({ force })) {
    return;
  }
''',
    "progress-only playback persistence gate",
)
renderer = replace_once(
    renderer,
    '''    persistPlaybackState();
  });

  element.addEventListener("seeked", (event) => {
''',
    '''    persistPlaybackState({ throttled: true });
  });

  element.addEventListener("seeked", (event) => {
''',
    "throttled timeupdate persistence",
)
renderer = replace_once(
    renderer,
    '''    navigationBackStack.push(structuredClone(currentNavigationSnapshot));
    trimOldestArrayEntries(navigationBackStack, NAVIGATION_HISTORY_MAX_ENTRIES);
  const nextSnapshot = navigationForwardStack.pop();
''',
    '''  navigationBackStack.push(structuredClone(currentNavigationSnapshot));
  trimOldestArrayEntries(navigationBackStack, NAVIGATION_HISTORY_MAX_ENTRIES);
  const nextSnapshot = navigationForwardStack.pop();
''',
    "forward navigation indentation",
)
renderer_path.write_text(renderer, encoding="utf-8")


mqtt_path = Path("src/preload/mqtt-websocket.js")
mqtt = mqtt_path.read_text(encoding="utf-8")
mqtt = replace_once(
    mqtt,
    '''const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_PERIOD_MS = 3_000;
const DEFAULT_MAX_PACKET_BYTES = 1024 * 1024;
''',
    '''const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_PERIOD_MS = 3_000;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PENDING_ACKS = 64;
const DEFAULT_MAX_PACKET_BYTES = 256 * 1024;
''',
    "native signaling bounds",
)
mqtt = replace_once(
    mqtt,
    '''      reconnectPeriod: resolveNumberOption(options.reconnectPeriod, DEFAULT_RECONNECT_PERIOD_MS),
      keepalive: resolveNumberOption(options.keepalive, DEFAULT_KEEP_ALIVE_SECONDS),
      maxPacketBytes: resolveNumberOption(options.maxPacketBytes, DEFAULT_MAX_PACKET_BYTES, 1024)
''',
    '''      reconnectPeriod: resolveNumberOption(options.reconnectPeriod, DEFAULT_RECONNECT_PERIOD_MS),
      keepalive: resolveNumberOption(options.keepalive, DEFAULT_KEEP_ALIVE_SECONDS),
      ackTimeout: resolveNumberOption(options.ackTimeout, DEFAULT_ACK_TIMEOUT_MS, 1),
      maxPendingAcks: Math.max(
        1,
        Math.trunc(resolveNumberOption(options.maxPendingAcks, DEFAULT_MAX_PENDING_ACKS, 1))
      ),
      maxPacketBytes: resolveNumberOption(options.maxPacketBytes, DEFAULT_MAX_PACKET_BYTES, 1024)
''',
    "native signaling acknowledgement options",
)
mqtt = replace_once(
    mqtt,
    '''  allocatePacketId() {
    const packetId = this.nextPacketId;
    this.nextPacketId = packetId >= 0xffff ? 1 : packetId + 1;
    return packetId;
  }
''',
    '''  allocatePacketId() {
    for (let attempt = 0; attempt < 0xffff; attempt += 1) {
      const packetId = this.nextPacketId;
      this.nextPacketId = packetId >= 0xffff ? 1 : packetId + 1;
      if (!this.pendingAcks.has(packetId)) {
        return packetId;
      }
    }

    throw new Error("MQTT acknowledgement queue is exhausted.");
  }
''',
    "collision-free packet identifiers",
)
mqtt = replace_once(
    mqtt,
    '''      const pending = this.pendingAcks.get(packetId);
      if (pending) {
        this.pendingAcks.delete(packetId);
        const grants = packetType === 9 ? body.subarray(2) : undefined;
        const error = grants?.includes(0x80)
          ? new Error("MQTT broker rejected the subscription.")
          : null;
        pending.callback(error, grants);
      }
    }
  }

  rejectPendingAcks(error) {
    for (const pending of this.pendingAcks.values()) {
      try {
        pending.callback(error);
      } catch {
        // Ignore callback failures during teardown.
      }
    }
    this.pendingAcks.clear();
  }
''',
    '''      const grants = packetType === 9 ? body.subarray(2) : undefined;
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
''',
    "bounded acknowledgement lifecycle",
)
mqtt = replace_once(
    mqtt,
    '''      this.pendingAcks.set(packetId, { callback: resolvedCallback || (() => {}) });
      this.sendPacket(createPacket(0x82, body));
''',
    '''      this.sendPacket(createPacket(0x82, body));
      this.registerPendingAck(packetId, resolvedCallback);
''',
    "subscription acknowledgement registration",
)
mqtt = replace_once(
    mqtt,
    '''      this.pendingAcks.set(packetId, { callback: callback || (() => {}) });
      this.sendPacket(createPacket(0xa2, Buffer.concat([
        packetIdBuffer,
        ...topicList.map(encodeUtf8String)
      ])));
''',
    '''      this.sendPacket(createPacket(0xa2, Buffer.concat([
        packetIdBuffer,
        ...topicList.map(encodeUtf8String)
      ])));
      this.registerPendingAck(packetId, callback);
''',
    "unsubscription acknowledgement registration",
)
mqtt = replace_once(
    mqtt,
    '''module.exports = {
  DEFAULT_MAX_PACKET_BYTES,
''',
    '''module.exports = {
  DEFAULT_ACK_TIMEOUT_MS,
  DEFAULT_MAX_PACKET_BYTES,
  DEFAULT_MAX_PENDING_ACKS,
''',
    "native signaling bound exports",
)
mqtt_path.write_text(mqtt, encoding="utf-8")


test_path = Path("test/mqtt-websocket.test.js")
test_source = test_path.read_text(encoding="utf-8")
test_source = replace_once(
    test_source,
    '''  send(packet) {
    this.sent.push(Buffer.from(packet));
  }
''',
    '''  send(packet) {
    if (this.failSend) {
      throw new Error("socket send failed");
    }
    this.sent.push(Buffer.from(packet));
  }
''',
    "failing WebSocket test transport",
)
if 'test("native adapter bounds acknowledgement memory and expires missing acknowledgements"' not in test_source:
    test_source = test_source.rstrip() + '''


test("native adapter does not retain acknowledgements when a send fails", async () => {
  const { client, socket } = connectClient();
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
  const { client } = connectClient({
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
'''
test_path.write_text(test_source + ("" if test_source.endswith("\n") else "\n"), encoding="utf-8")


integration_path = Path("test/electron-resource-integration.test.js")
integration = integration_path.read_text(encoding="utf-8")
integration = replace_once(
    integration,
    '''  assert.match(source, /playbackStatePersistenceGate\\.shouldRun/);
  assert.match(source, /slice\\(0, PLAYBACK_PREFETCH_LIMIT\\)/);
''',
    '''  assert.match(source, /function persistPlaybackState\\(\\{ throttled = false, force = false \\}/);
  assert.match(source, /throttled && !playbackStatePersistenceGate\\.shouldRun/);
  assert.match(source, /persistPlaybackState\\(\\{ throttled: true \\}\\)/);
  assert.match(source, /slice\\(0, PLAYBACK_PREFETCH_LIMIT\\)/);
''',
    "progress-only persistence integration assertions",
)
integration_path.write_text(integration, encoding="utf-8")

for file_path, required_fragments in {
    renderer_path: (
        "throttled = false",
        "persistPlaybackState({ throttled: true })",
    ),
    mqtt_path: (
        "DEFAULT_MAX_PENDING_ACKS",
        "registerPendingAck",
        "MQTT acknowledgement timed out",
    ),
}.items():
    source = file_path.read_text(encoding="utf-8")
    for fragment in required_fragments:
        if fragment not in source:
            raise SystemExit(f"missing reviewed resource fix in {file_path}: {fragment}")

print("Applied playback persistence and native signaling acknowledgement fixes.")
