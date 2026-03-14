const { createEventChannel, createStateStore } = require("./state-store");

const DEFAULT_LISTEN_ALONG_SIGNAL_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";
const DEFAULT_LISTEN_ALONG_SIGNAL_TOPIC_PREFIX = "apollo/client/listen-along";

function createListenAlongSignaling({
  mqtt,
  brokerUrl = DEFAULT_LISTEN_ALONG_SIGNAL_BROKER_URL,
  topicPrefix = DEFAULT_LISTEN_ALONG_SIGNAL_TOPIC_PREFIX
}) {
  const signalEvents = createEventChannel();
  const stateStore = createStateStore({
    available: true,
    connected: false,
    connecting: false,
    rooms: [],
    brokerUrl,
    message: "Listen along signaling is idle."
  });
  const subscribedRooms = new Set();
  let client = null;
  let connectPromise = null;
  let connectingClient = null;

  function buildTopic(sessionId) {
    return `${topicPrefix}/${String(sessionId || "").trim()}`;
  }

  function parseSessionId(topic = "") {
    const prefix = `${topicPrefix}/`;
    return topic.startsWith(prefix) ? topic.slice(prefix.length) : "";
  }

  function emitState(patch = {}) {
    return stateStore.setState({
      ...stateStore.getState(),
      ...patch,
      rooms: Array.from(subscribedRooms).sort(),
      brokerUrl
    });
  }

  function handleMessage(topic, buffer) {
    const sessionId = parseSessionId(topic);
    if (!sessionId) {
      return;
    }

    try {
      signalEvents.emit({
        sessionId,
        payload: JSON.parse(buffer.toString("utf8"))
      });
    } catch {
      // Ignore malformed broker messages.
    }
  }

  function attachClient(nextClient) {
    nextClient.on("connect", () => {
      emitState({
        connected: true,
        connecting: false,
        message: "Listen along signaling connected."
      });

      if (subscribedRooms.size) {
        nextClient.subscribe(Array.from(subscribedRooms).map(buildTopic));
      }
    });

    nextClient.on("reconnect", () => {
      emitState({
        connected: false,
        connecting: true,
        message: "Reconnecting listen along signaling..."
      });
    });

    nextClient.on("close", () => {
      emitState({
        connected: false,
        connecting: false,
        message: "Listen along signaling disconnected."
      });
    });

    nextClient.on("error", (error) => {
      emitState({
        connected: false,
        connecting: false,
        message: error?.message || "Listen along signaling failed."
      });
    });

    nextClient.on("message", handleMessage);
  }

  function ensureClient() {
    if (client?.connected) {
      return Promise.resolve(client);
    }

    if (connectPromise) {
      return connectPromise;
    }

    emitState({
      connecting: true,
      message: "Connecting listen along signaling..."
    });

    connectPromise = new Promise((resolve, reject) => {
      const nextClient = mqtt.connect(brokerUrl, {
        clientId: `apollo-client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: true
      });
      connectingClient = nextClient;

      attachClient(nextClient);

      const cleanup = () => {
        nextClient.off("connect", onConnect);
        nextClient.off("error", onError);
        if (connectingClient === nextClient) {
          connectingClient = null;
        }
        connectPromise = null;
      };

      const onConnect = () => {
        cleanup();
        client = nextClient;
        resolve(nextClient);
      };

      const onError = (error) => {
        cleanup();

        try {
          nextClient.end(true);
        } catch {
          // Ignore teardown failures.
        }

        reject(error);
      };

      nextClient.once("connect", onConnect);
      nextClient.once("error", onError);
    });

    return connectPromise;
  }

  async function connectRoom(sessionId) {
    const resolvedSessionId = String(sessionId || "").trim();
    if (!resolvedSessionId) {
      throw new Error("Listen along session ID is required.");
    }

    if (subscribedRooms.has(resolvedSessionId)) {
      return emitState();
    }

    const resolvedClient = await ensureClient();

    await new Promise((resolve, reject) => {
      resolvedClient.subscribe(buildTopic(resolvedSessionId), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    subscribedRooms.add(resolvedSessionId);
    return emitState();
  }

  async function disconnectRoom(sessionId) {
    const resolvedSessionId = String(sessionId || "").trim();
    if (!resolvedSessionId) {
      return stateStore.getState();
    }

    subscribedRooms.delete(resolvedSessionId);
    if (client?.connected) {
      await new Promise((resolve) => {
        client.unsubscribe(buildTopic(resolvedSessionId), () => {
          resolve();
        });
      });
    }

    return emitState();
  }

  async function publish(sessionId, payload) {
    const resolvedSessionId = String(sessionId || "").trim();
    if (!resolvedSessionId) {
      throw new Error("Listen along session ID is required.");
    }

    const resolvedClient = await ensureClient();
    if (!subscribedRooms.has(resolvedSessionId)) {
      await connectRoom(resolvedSessionId);
    }

    await new Promise((resolve, reject) => {
      resolvedClient.publish(
        buildTopic(resolvedSessionId),
        JSON.stringify(payload || {}),
        {
          qos: 0,
          retain: false
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    });

    return true;
  }

  function dispose() {
    if (connectingClient) {
      try {
        connectingClient.end(true);
      } catch {
        // Ignore MQTT teardown failures.
      }
    }

    if (client) {
      try {
        client.end(true);
      } catch {
        // Ignore MQTT teardown failures.
      }
    }

    client = null;
    connectingClient = null;
    connectPromise = null;
    subscribedRooms.clear();
    emitState({
      connected: false,
      connecting: false,
      message: "Listen along signaling is idle."
    });
    signalEvents.clear();
    stateStore.clear();
  }

  return {
    getState: () => stateStore.getState(),
    connectRoom,
    disconnectRoom,
    publish,
    onSignal: (callback) => signalEvents.subscribe(callback),
    onStateChange: (callback) => stateStore.subscribe(callback),
    dispose
  };
}

module.exports = {
  createListenAlongSignaling,
  DEFAULT_LISTEN_ALONG_SIGNAL_BROKER_URL,
  DEFAULT_LISTEN_ALONG_SIGNAL_TOPIC_PREFIX
};
