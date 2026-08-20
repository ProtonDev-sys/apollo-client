export function createPollingController({
  intervalMs,
  task,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = () => {}
} = {}) {
  if (!Number.isFinite(Number(intervalMs)) || Number(intervalMs) <= 0) {
    throw new TypeError("Polling interval must be a positive number.");
  }

  if (typeof task !== "function") {
    throw new TypeError("Polling task must be a function.");
  }

  if (typeof setIntervalFn !== "function" || typeof clearIntervalFn !== "function") {
    throw new TypeError("Polling timers must be functions.");
  }

  let intervalHandle = null;
  let activeTask = null;

  function run() {
    if (activeTask) {
      return activeTask;
    }

    activeTask = Promise.resolve()
      .then(() => task())
      .catch((error) => {
        try {
          onError(error);
        } catch {
          // Keep the polling lifecycle alive even if error reporting fails.
        }
        return undefined;
      })
      .finally(() => {
        activeTask = null;
      });

    return activeTask;
  }

  function stop() {
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle);
      intervalHandle = null;
    }
  }

  function start({ immediate = true } = {}) {
    stop();

    if (immediate) {
      void run();
    }

    intervalHandle = setIntervalFn(() => {
      void run();
    }, Number(intervalMs));

    return intervalHandle;
  }

  return {
    start,
    stop,
    run,
    isRunning: () => intervalHandle !== null,
    isTaskActive: () => activeTask !== null,
    getHandle: () => intervalHandle
  };
}
