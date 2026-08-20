const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importResourceControls() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "resource-controls.js"),
    "utf8"
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`);
}

test("LRU map helpers refresh reads and bound retained entries", async () => {
  const { getLruMapValue, setLruMapValue } = await importResourceControls();
  const cache = new Map();
  setLruMapValue(cache, "one", 1, 2);
  setLruMapValue(cache, "two", 2, 2);
  assert.equal(getLruMapValue(cache, "one"), 1);
  setLruMapValue(cache, "three", 3, 2);

  assert.equal(cache.has("two"), false);
  assert.deepEqual([...cache.keys()], ["one", "three"]);
});

test("history trimming keeps only the newest entries", async () => {
  const { trimOldestArrayEntries } = await importResourceControls();
  const history = [1, 2, 3, 4];
  assert.equal(trimOldestArrayEntries(history, 2), history);
  assert.deepEqual(history, [3, 4]);
});

test("interval gate throttles hot paths and supports forced updates", async () => {
  const { createIntervalGate } = await importResourceControls();
  let currentTime = 1000;
  const gate = createIntervalGate(250, { now: () => currentTime });

  assert.equal(gate.shouldRun(), true);
  currentTime = 1100;
  assert.equal(gate.shouldRun(), false);
  assert.equal(gate.shouldRun({ force: true }), true);
  currentTime = 1300;
  assert.equal(gate.shouldRun(), false);
  currentTime = 1350;
  assert.equal(gate.shouldRun(), true);
  gate.reset();
  assert.equal(gate.shouldRun(), true);
});
