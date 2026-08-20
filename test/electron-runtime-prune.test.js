const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PRUNED_RUNTIME_FILES,
  pruneElectronRuntime,
  resolveElectronPlatform
} = require("../scripts/prune-electron-runtime");

function createRuntimeFixture(platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-electron-prune-"));
  const keepFile = path.join(root, platform === "win32" ? "ffmpeg.dll" : "libffmpeg.so");
  fs.writeFileSync(keepFile, Buffer.alloc(31));

  for (const relativePath of PRUNED_RUNTIME_FILES[platform]) {
    fs.writeFileSync(path.join(root, relativePath), Buffer.alloc(17));
  }

  return { root, keepFile };
}

test("Electron platform aliases resolve consistently", () => {
  assert.equal(resolveElectronPlatform("windows"), "win32");
  assert.equal(resolveElectronPlatform("win"), "win32");
  assert.equal(resolveElectronPlatform("linux"), "linux");
});

for (const platform of ["linux", "win32"]) {
  test(`runtime pruning removes only unused ${platform} graphics files`, (context) => {
    const fixture = createRuntimeFixture(platform);
    context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const messages = [];

    const result = pruneElectronRuntime({
      electronPlatformName: platform,
      appOutDir: fixture.root
    }, {
      logger: (message) => messages.push(message)
    });

    assert.equal(result.platform, platform);
    assert.equal(result.removedBytes, PRUNED_RUNTIME_FILES[platform].length * 17);
    assert.deepEqual(result.removedFiles, [...PRUNED_RUNTIME_FILES[platform]]);
    assert.equal(fs.existsSync(fixture.keepFile), true);
    for (const relativePath of PRUNED_RUNTIME_FILES[platform]) {
      assert.equal(fs.existsSync(path.join(fixture.root, relativePath)), false);
    }
    assert.match(messages.join("\n"), /Pruned unused Electron graphics runtime/);
  });
}

test("runtime pruning is idempotent and ignores unsupported platforms", (context) => {
  const fixture = createRuntimeFixture("linux");
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const first = pruneElectronRuntime({
    electronPlatformName: "linux",
    appOutDir: fixture.root
  }, { logger() {} });
  const second = pruneElectronRuntime({
    electronPlatformName: "linux",
    appOutDir: fixture.root
  }, { logger() {} });
  const unsupported = pruneElectronRuntime({
    electronPlatformName: "darwin",
    appOutDir: fixture.root
  }, { logger() {} });

  assert.ok(first.removedBytes > 0);
  assert.equal(second.removedBytes, 0);
  assert.deepEqual(unsupported, {
    platform: "darwin",
    removedBytes: 0,
    removedFiles: []
  });
});

test("runtime pruning requires an output directory for supported platforms", () => {
  assert.throws(
    () => pruneElectronRuntime({ electronPlatformName: "linux" }, { logger() {} }),
    /appOutDir/
  );
});
