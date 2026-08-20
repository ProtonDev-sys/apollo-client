const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("preload uses lazy native WebSocket signaling without a package dependency", () => {
  const preload = read("preload.js");
  const packageJson = JSON.parse(read("package.json"));

  assert.deepEqual(packageJson.dependencies || {}, {});
  assert.doesNotMatch(preload, /require\(["']mqtt["']\)/);
  assert.match(preload, /lazyNativeMqtt/);
  assert.match(preload, /require\("\.\/src\/preload\/mqtt-websocket"\)/);
});

test("Discord presence uses the local native IPC implementation", () => {
  const source = read("discord-presence.js");
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.dependencies?.["discord-rpc"], undefined);
  assert.match(source, /require\("\.\/src\/main\/discord-ipc"\)/);
  assert.match(read("src/main/discord-ipc.js"), /node:net/);
});

test("main process defers optional work and disables unused Chromium graphics features", () => {
  const source = read("main.js");

  assert.match(source, /createAsyncLogWriter/);
  assert.match(source, /function ensureDiscordSocialBridge\(\)/);
  assert.match(source, /backgroundThrottling: true/);
  assert.match(source, /spellcheck: false/);
  assert.match(source, /DISABLED_CHROMIUM_FEATURES/);
  assert.match(source, /"Vulkan"/);
  assert.match(source, /"WebGPU"/);
  assert.match(source, /"WebGPUService"/);
  assert.match(source, /configureLeanChromiumRuntime\(\);/);
  assert.match(source, /appendSwitch\?\.\(\s*"disable-features"/);
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

test("packaged runtime assets avoid watchers, broad scans, and startup seeding", () => {
  const source = read("src/preload/runtime-assets.js");

  assert.match(source, /const watchRuntimeAssets = !runtimeInfo\.isPackaged/);
  assert.match(source, /if \(watchRuntimeAssets && !watchersInitialised\)/);
  assert.doesNotMatch(source, /ensureSeedRuntimeAssets/);
  assert.doesNotMatch(source, /copyFileSync/);
  assert.doesNotMatch(source, /\n  initialiseWatchers\(\);\n\n  return \{/);
});

test("production packaging contains only generated and pruned Electron runtime files", () => {
  const packageJson = JSON.parse(read("package.json"));
  const pruneSource = read("scripts/prune-electron-runtime.js");

  assert.equal(packageJson.build.asar, true);
  assert.equal(packageJson.build.compression, "maximum");
  assert.equal(packageJson.build.npmRebuild, false);
  assert.equal(packageJson.build.afterPack, "scripts/prune-electron-runtime.js");
  assert.deepEqual(packageJson.build.electronLanguages, ["en-US"]);
  assert.deepEqual(packageJson.build.files, [
    { from: "dist-app", to: ".", filter: ["**/*"] }
  ]);
  assert.match(pruneSource, /dxcompiler\.dll/);
  assert.match(pruneSource, /dxil\.dll/);
  assert.match(pruneSource, /vk_swiftshader\.dll/);
  assert.match(pruneSource, /libvk_swiftshader\.so/);
  assert.match(pruneSource, /libvulkan\.so\.1/);
  assert.equal(packageJson.devDependencies.electron, "^43.4.1");
  assert.equal(packageJson.devDependencies["electron-builder"], "^26.15.7");
  assert.equal(packageJson.devDependencies.esbuild, "^0.28.2");
  assert.equal(fs.existsSync(path.join(projectRoot, "src", "desktop", "listen-along-signaling.js")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "src", "desktop", "runtime-assets.js")), false);
});

test("core Windows packages exclude optional SDKs and retain a smaller portable build", () => {
  const packageJson = JSON.parse(read("package.json"));
  const portableBuilder = read("scripts/build-windows-portable.js");

  assert.match(packageJson.scripts["build:win"], /electron-builder --win nsis/);
  assert.doesNotMatch(packageJson.scripts["build:win"], /build:discord-social-helper/);
  assert.match(packageJson.scripts["pack:win:ci"], /electron-builder --win nsis/);
  assert.match(packageJson.scripts["build:win:portable"], /build-windows-portable\.js/);
  assert.match(packageJson.scripts["build:win:social"], /build:discord-social-helper/);
  assert.match(portableBuilder, /DEFAULT_MAX_PORTABLE_BYTES = 78_000_000/);
  assert.match(portableBuilder, /"-mx=9"/);
  assert.match(portableBuilder, /"-ms=on"/);
});

test("source UI uses system fonts and the build creates minified output", () => {
  const html = read("src/index.html");
  const buildScript = read("scripts/build-app.js");

  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.match(read("src/styles.css"), /system-ui/);
  assert.match(buildScript, /minify: true/);
  assert.match(buildScript, /bundle: true/);
  assert.match(buildScript, /dist-app/);
});
