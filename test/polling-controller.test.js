const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importPollingController() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "polling-controller.js"),
    "utf8"
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`);
}

function createFakeScheduler() {
  let nextHandle = 1;
  const callbacks = new Map();
  const clearedHandles = [];

  return {
    setIntervalFn(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    clearIntervalFn(handle) {
      clearedHandles.push(handle);
      callbacks.delete(handle);
    },
    callbacks,
    clearedHandles
  };
}

test("polling controller starts immediately and restarts cleanly", async () => {
  const { createPollingController } = await importPollingController();
  const scheduler = createFakeScheduler();
  let runCount = 0;

  const controller = createPollingController({
    intervalMs: 1000,
    task: () => {
      runCount += 1;
    },
    setIntervalFn: scheduler.setIntervalFn,
    clearIntervalFn: scheduler.clearIntervalFn
  });

  const firstHandle = controller.start();
  await new Promise(setImmediate);

  assert.equal(runCount, 1);
  assert.equal(controller.isRunning(), true);
  assert.equal(controller.getHandle(), firstHandle);
  assert.equal(scheduler.callbacks.size, 1);

  const secondHandle = controller.start({ immediate: false });
  assert.notEqual(secondHandle, firstHandle);
  assert.deepEqual(scheduler.clearedHandles, [firstHandle]);
  assert.equal(scheduler.callbacks.size, 1);
  assert.equal(controller.getHandle(), secondHandle);

  scheduler.callbacks.get(secondHandle)();
  await new Promise(setImmediate);
  assert.equal(runCount, 2);

  controller.stop();
  assert.equal(controller.isRunning(), false);
  assert.equal(controller.getHandle(), null);
  assert.deepEqual(scheduler.clearedHandles, [firstHandle, secondHandle]);
});

test("polling controller never overlaps asynchronous tasks", async () => {
  const { createPollingController } = await importPollingController();
  let releaseTask;
  let runCount = 0;

  const controller = createPollingController({
    intervalMs: 1000,
    task: () => {
      runCount += 1;
      return new Promise((resolve) => {
        releaseTask = resolve;
      });
    }
  });

  const firstRun = controller.run();
  const overlappingRun = controller.run();

  assert.equal(firstRun, overlappingRun);
  assert.equal(runCount, 0);
  await new Promise(setImmediate);
  assert.equal(runCount, 1);
  assert.equal(controller.isTaskActive(), true);

  releaseTask();
  await firstRun;
  assert.equal(controller.isTaskActive(), false);

  const nextRun = controller.run();
  await new Promise(setImmediate);
  assert.equal(runCount, 2);
  releaseTask();
  await nextRun;
});

test("polling controller reports failures and keeps its lifecycle usable", async () => {
  const { createPollingController } = await importPollingController();
  const scheduler = createFakeScheduler();
  const errors = [];
  let shouldFail = true;
  let runCount = 0;

  const controller = createPollingController({
    intervalMs: 250,
    task: () => {
      runCount += 1;
      if (shouldFail) {
        throw new Error("temporary failure");
      }
    },
    setIntervalFn: scheduler.setIntervalFn,
    clearIntervalFn: scheduler.clearIntervalFn,
    onError: (error) => errors.push(error.message)
  });

  const handle = controller.start();
  await new Promise(setImmediate);

  assert.equal(runCount, 1);
  assert.deepEqual(errors, ["temporary failure"]);
  assert.equal(controller.isRunning(), true);

  shouldFail = false;
  scheduler.callbacks.get(handle)();
  await new Promise(setImmediate);

  assert.equal(runCount, 2);
  assert.deepEqual(errors, ["temporary failure"]);

  controller.stop();
  assert.equal(scheduler.callbacks.size, 0);
});

test("polling controller rejects invalid configuration", async () => {
  const { createPollingController } = await importPollingController();

  assert.throws(
    () => createPollingController({ intervalMs: 0, task: () => {} }),
    /positive number/
  );
  assert.throws(
    () => createPollingController({ intervalMs: 100, task: null }),
    /must be a function/
  );
});
