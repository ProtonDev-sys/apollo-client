export function createPollingController({
  intervalMs,
  task,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = () => {}
} = {}) {
  const resolvedIntervalMs = Number(intervalMs);
  if (!Number.isFinite(resolvedIntervalMs) || resolvedIntervalMs <= 0) {
    throw new TypeError("Polling interval must be a positive number.");
  }

  if (typeof task !== "function") {
    throw new TypeError("Polling task must be a function.");
  }

  if (typeof setIntervalFn !== "function" || typeof clearIntervalFn !== "function") {
    throw new TypeError("Polling timers must be functions.");
  }

  let intervalHandle = null;
  let activeRun = null;
  let generation = 0;

  function invalidate() {
    generation += 1;
    activeRun = null;
    return generation;
  }

  function run() {
    if (activeRun) {
      return activeRun.promise;
    }

    const runGeneration = generation;
    const context = Object.freeze({
      generation: runGeneration,
      isCurrent: () => generation === runGeneration
    });
    const runRecord = {
      generation: runGeneration,
      promise: null
    };

    runRecord.promise = Promise.resolve()
      .then(() => task(context))
      .catch((error) => {
        if (!context.isCurrent()) {
          return undefined;
        }

        try {
          return Promise.resolve(onError(error, context)).catch(() => undefined);
        } catch {
          // Keep the polling lifecycle alive even if error reporting fails.
          return undefined;
        }
      })
      .finally(() => {
        if (activeRun === runRecord) {
          activeRun = null;
        }
      });

    activeRun = runRecord;
    return runRecord.promise;
  }

  function stop() {
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle);
      intervalHandle = null;
    }

    invalidate();
  }

  function start({ immediate = true } = {}) {
    stop();

    if (immediate) {
      void run();
    }

    intervalHandle = setIntervalFn(() => {
      void run();
    }, resolvedIntervalMs);

    return intervalHandle;
  }

  return {
    start,
    stop,
    run,
    invalidate,
    isRunning: () => intervalHandle !== null,
    isTaskActive: () => activeRun !== null,
    getGeneration: () => generation,
    getHandle: () => intervalHandle
  };
}
