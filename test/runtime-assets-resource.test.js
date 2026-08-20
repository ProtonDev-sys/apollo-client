const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRuntimeAssetsService } = require("../src/preload/runtime-assets");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-runtime-assets-"));
  const appRootPath = path.join(root, "app");
  const userDataPath = path.join(root, "user-data");
  fs.mkdirSync(path.join(appRootPath, "src", "plugins"), { recursive: true });
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    path.join(appRootPath, "src", "plugins", "lyrics-plugin.js"),
    "export default {};\n"
  );
  return { root, appRootPath, userDataPath };
}

function createTrackingFs() {
  let watchCount = 0;
  const trackingFs = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === "watch") {
        return () => {
          watchCount += 1;
          return { close() {} };
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
  return { trackingFs, getWatchCount: () => watchCount };
}

test("packaged runtime assets do not install persistent filesystem watchers", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const { trackingFs, getWatchCount } = createTrackingFs();
  const service = createRuntimeAssetsService({
    fs: trackingFs,
    path,
    pathToFileURL,
    appRootPath: fixture.appRootPath,
    runtimeInfo: {
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      execDirectory: path.join(fixture.root, "bin"),
      currentWorkingDirectory: path.join(fixture.root, "cwd")
    },
    env: {}
  });

  const unsubscribe = service.onChanged(() => {});
  assert.equal(getWatchCount(), 0);
  unsubscribe();
  service.dispose();
});

test("development runtime assets retain hot-reload watchers", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const { trackingFs, getWatchCount } = createTrackingFs();
  const service = createRuntimeAssetsService({
    fs: trackingFs,
    path,
    pathToFileURL,
    appRootPath: fixture.appRootPath,
    runtimeInfo: {
      isPackaged: false,
      userDataPath: fixture.userDataPath,
      execDirectory: fixture.root,
      currentWorkingDirectory: fixture.root
    },
    env: {}
  });

  const unsubscribe = service.onChanged(() => {});
  assert.ok(getWatchCount() > 0);
  unsubscribe();
  service.dispose();
});
