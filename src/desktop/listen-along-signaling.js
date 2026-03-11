const mqtt = require("mqtt");

const DEFAULT_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";
const DEFAULT_TOPIC_PREFIX = "apollo/client/listen-along";

function createInitialState(brokerUrl) {
  return {
    available: true,
    connected: false,
    connecting: false,
    rooms: [],
    brokerUrl,
    message: "Listen along signaling is idle."
  };
}

function createListenerSet() {
  const listeners = new Set();

  return {
    add(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(payload) {
      listeners.forEach((listener) => {
        listener(payload);
      });
    },
    clear() {
      listeners.clear();
    }
  };
}

function normaliseSessionId(sessionId) {
  return String(sessionId || "").trim();
}

function buildSignalTopic(topicPrefix, sessionId) {
  return `${topicPrefix}/${normaliseSessionId(sessionId)}`;
}

function parseSignalTopic(topicPrefix, topic = "") {
  const prefix = `${topicPrefix}/`;
  return topic.startsWith(prefix) ? topic.slice(prefix.length) : "";
}

function createListenAlongSignalingBridge({
  brokerUrl = DEFAULT_BROKER_URL,
  topicPrefix = DEFAULT_TOPIC_PREFIX
} = {}) {
  const stateListeners = createListenerSet();
  const signalListeners = createListenerSet();
  const rooms = new Set();
  let state = createInitialState(brokerUrl);
  let signalClient = null;
  let connectPromise = null;

  function emitState() {
    state = {
      ...state,
      rooms: Array.from(rooms)
    };
    stateListeners.emit(state);
  }

  function attachClient(client) {
    client.on("connect", () => {
      state = {
        ...state,
        connected: true,
        connecting: false,
        message: "Listen along signaling connected."
      };
      if (rooms.size) {
        client.subscribe(Array.from(rooms).map((sessionId) => buildSignalTopic(topicPrefix, sessionId)));
      }
      emitState();
    });

    client.on("reconnect", () => {
      state = {
        ...state,
        connected: false,
        connecting: true,
        message: "Reconnecting listen along signaling..."
      };
      emitState();
    });

    client.on("close", () => {
      state = {
        ...state,
        connected: false,
        connecting: false,
        message: "Listen along signaling disconnected."
      };
      emitState();
    });

    client.on("error", (error) => {
      state = {
        ...state,
        connected: false,
        connecting: false,
        message: error?.message || "Listen along signaling failed."
      };
      emitState();
    });

    client.on("message", (topic, buffer) => {
      const sessionId = parseSignalTopic(topicPrefix, topic);
      if (!sessionId) {
        return;
      }

      try {
        signalListeners.emit({
          sessionId,
          payload: JSON.parse(buffer.toString("utf8"))
        });
      } catch {
        // Ignore malformed broker messages.
      }
    });
  }

  function ensureClient() {
    if (signalClient?.connected) {
      return Promise.resolve(signalClient);
    }

    if (connectPromise) {
      return connectPromise;
    }

    state = {
      ...state,
      connecting: true,
      message: "Connecting listen along signaling..."
    };
    emitState();

    connectPromise = new Promise((resolve, reject) => {
      const client = mqtt.connect(brokerUrl, {
        clientId: `apollo-client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: true
      });

      attachClient(client);

      const cleanup = () => {
        client.off("connect", onConnect);
        client.off("error", onError);
        connectPromise = null;
      };

      const onConnect = () => {
        cleanup();
        signalClient = client;
        resolve(client);
      };

      const onError = (error) => {
        cleanup();
        try {
          client.end(true);
        } catch {
          // Ignore teardown failures.
        }
        reject(error);
      };

      client.once("connect", onConnect);
      client.once("error", onError);
    });

    return connectPromise;
  }

  async function connectRoom(sessionId) {
    const resolvedSessionId = normaliseSessionId(sessionId);
    if (!resolvedSessionId) {
      throw new Error("Listen along session ID is required.");
    }

    const client = await ensureClient();
    rooms.add(resolvedSessionId);
    await new Promise((resolve, reject) => {
      client.subscribe(buildSignalTopic(topicPrefix, resolvedSessionId), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    emitState();
    return state;
  }

  async function disconnectRoom(sessionId) {
    const resolvedSessionId = normaliseSessionId(sessionId);
    if (!resolvedSessionId) {
      return state;
    }

    rooms.delete(resolvedSessionId);
    if (signalClient?.connected) {
      await new Promise((resolve) => {
        signalClient.unsubscribe(buildSignalTopic(topicPrefix, resolvedSessionId), () => {
          resolve();
        });
      });
    }

    emitState();
    return state;
  }

  async function publish(sessionId, payload) {
    const resolvedSessionId = normaliseSessionId(sessionId);
    if (!resolvedSessionId) {
      throw new Error("Listen along session ID is required.");
    }

    const client = await ensureClient();
    if (!rooms.has(resolvedSessionId)) {
      await connectRoom(resolvedSessionId);
    }

    await new Promise((resolve, reject) => {
      client.publish(
        buildSignalTopic(topicPrefix, resolvedSessionId),
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

  function getState() {
    return {
      ...state,
      rooms: Array.from(rooms)
    };
  }

  function dispose() {
    if (signalClient) {
      try {
        signalClient.end(true);
      } catch {
        // Ignore MQTT teardown failures.
      }
    }

    signalClient = null;
    connectPromise = null;
    rooms.clear();
    state = createInitialState(brokerUrl);
    stateListeners.clear();
    signalListeners.clear();
  }

  return {
    connectRoom,
    disconnectRoom,
    publish,
    getState,
    onSignal: signalListeners.add,
    onStateChange: stateListeners.add,
    dispose
  };
}

module.exports = {
  DEFAULT_BROKER_URL,
  DEFAULT_TOPIC_PREFIX,
  createListenAlongSignalingBridge
};
