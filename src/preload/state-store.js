function notifyListener(listener, value, phase) {
  try {
    listener(value);
  } catch (error) {
    console.warn(`[apollo-state-store] ${phase} listener failed`, error);
  }
}

function createEventChannel() {
  const listeners = new Set();

  function emit(value) {
    // Snapshot subscribers so one listener can unsubscribe itself without
    // disturbing the rest of the delivery pass.
    for (const listener of [...listeners]) {
      notifyListener(listener, value, "event");
    }
  }

  function subscribe(callback, getInitialValue = null) {
    if (typeof callback !== "function") {
      return () => {};
    }

    listeners.add(callback);

    if (typeof getInitialValue === "function") {
      notifyListener(callback, getInitialValue(), "initial");
    }

    return () => {
      listeners.delete(callback);
    };
  }

  function clear() {
    listeners.clear();
  }

  return {
    emit,
    subscribe,
    clear
  };
}

function createStateStore(initialState) {
  const events = createEventChannel();
  let currentState = initialState;

  function getState() {
    return currentState;
  }

  function setState(nextState) {
    currentState = nextState;
    events.emit(currentState);
    return currentState;
  }

  function patchState(patch = {}) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return currentState;
    }

    return setState({
      ...currentState,
      ...patch
    });
  }

  function subscribe(callback) {
    return events.subscribe(callback, () => currentState);
  }

  function clear() {
    events.clear();
  }

  return {
    getState,
    setState,
    patchState,
    subscribe,
    emit: () => events.emit(currentState),
    clear
  };
}

module.exports = {
  createEventChannel,
  createStateStore
};
