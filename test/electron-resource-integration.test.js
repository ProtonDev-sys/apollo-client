const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("preload uses lazy native WebSocket signaling without the MQTT package", () => {
  const preload = read("preload.js");
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.dependencies?.mqtt, undefined);
  assert.doesNotMatch(preload, /require\(["']mqtt["']\)/);
  assert.match(preload, /lazyNativeMqtt/);
  assert.match(preload, /require\("\.\/src\/preload\/mqtt-websocket"\)/);
});

test("main process defers optional Discord work and uses asynchronous logging", () => {
  const source = read("main.js");

  assert.match(source, /createAsyncLogWriter/);
  assert.match(source, /function ensureDiscordSocialBridge\(\)/);
  assert.match(source, /backgroundThrottling: true/);
  assert.match(source, /spellcheck: false/);
  assert.match(source, /!app\.isPackaged \|\| process\.env\.APOLLO_CLIENT_DIAGNOSTICS === "1"/);
  assert.doesNotMatch(source, /fs\.(?:appendFileSync|statSync|writeFileSync)/);
  assert.doesNotMatch(source, /^const \{ createDiscordSocialBridge \} = require/m);
});

test("renderer bounds caches, history, prefetch, and high-frequency playback work", () => {
  const source = read("src/renderer.js");

  assert.match(source, /from "\.\/renderer\/resource-controls\.js";/);
  assert.match(source, /PLAYBACK_PREFETCH_LIMIT = 3/);
  assert.match(source, /NAVIGATION_HISTORY_MAX_ENTRIES = 16/);
  assert.match(source, /playbackUiUpdateGate\.shouldRun\(\)/);
  assert.match(source, /function persistPlaybackState\(\{ throttled = false, force = false \}/);
  assert.match(source, /throttled && !playbackStatePersistenceGate\.shouldRun/);
  assert.match(source, /persistPlaybackState\(\{ throttled: true \}\)/);
  assert.match(source, /slice\(0, PLAYBACK_PREFETCH_LIMIT\)/);
  assert.match(source, /setLruMapValue\(artistTracksCache/);
  assert.match(source, /persistPlaybackState\(\{ force: true \}\)/);
});

test("packaged runtime assets avoid persistent watchers and broad directory scans", () => {
  const source = read("src/preload/runtime-assets.js");

  assert.match(source, /const watchRuntimeAssets = !runtimeInfo\.isPackaged/);
  assert.match(source, /if \(watchRuntimeAssets && !watchersInitialised\)/);
  assert.doesNotMatch(source, /\n  initialiseWatchers\(\);\n\n  return \{/);
});

test("packaged source excludes retired desktop duplicates and uses maximum compression", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.build.asar, true);
  assert.equal(packageJson.build.compression, "maximum");
  assert.equal(fs.existsSync(path.join(projectRoot, "src", "desktop", "listen-along-signaling.js")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "src", "desktop", "runtime-assets.js")), false);
  assert.match(read("src/styles.css"), /Electron resource containment/);
});
