const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importSettings() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "settings.js"),
    "utf8"
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`);
}

test("default live search waits briefly enough for progressive results", async () => {
  const { createDefaultSettings, parseConnectionSettings } = await importSettings();
  const settings = createDefaultSettings({
    defaultConnectionSettings: parseConnectionSettings("http://127.0.0.1:4848")
  });

  assert.equal(settings.search.liveSearchDelayMs, 160);
});

test("saved live-search delays remain bounded", async () => {
  const {
    createDefaultSettings,
    mergeSettings,
    parseConnectionSettings
  } = await importSettings();
  const defaults = createDefaultSettings({
    defaultConnectionSettings: parseConnectionSettings("http://127.0.0.1:4848")
  });

  assert.equal(
    mergeSettings(defaults, { search: { liveSearchDelayMs: -100 } }).search.liveSearchDelayMs,
    0
  );
  assert.equal(
    mergeSettings(defaults, { search: { liveSearchDelayMs: 900 } }).search.liveSearchDelayMs,
    500
  );
});
