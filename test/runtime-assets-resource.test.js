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
  fs.mkdirSync(appRootPath, { recursive: true });
  fs.mkdirSync(userDataPath, { recursive: true });
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

function createService(fixture, runtimeInfo, fsImpl = fs) {
  return createRuntimeAssetsService({
    fs: fsImpl,
    path,
    pathToFileURL,
    appRootPath: fixture.appRootPath,
    runtimeInfo: {
      userDataPath: fixture.userDataPath,
      execDirectory: path.join(fixture.root, "bin"),
      currentWorkingDirectory: path.join(fixture.root, "cwd"),
      ...runtimeInfo
    },
    env: {}
  });
}

test("packaged runtime assets do not install persistent filesystem watchers", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const { trackingFs, getWatchCount } = createTrackingFs();
  const service = createService(fixture, { isPackaged: true }, trackingFs);

  const unsubscribe = service.onChanged(() => {});
  assert.equal(getWatchCount(), 0);
  unsubscribe();
  service.dispose();
});

test("development runtime assets retain hot-reload watchers", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const { trackingFs, getWatchCount } = createTrackingFs();
  const service = createService(fixture, {
    isPackaged: false,
    execDirectory: fixture.root,
    currentWorkingDirectory: fixture.root
  }, trackingFs);

  const unsubscribe = service.onChanged(() => {});
  assert.ok(getWatchCount() > 0);
  unsubscribe();
  service.dispose();
});

test("runtime asset discovery does not write default plugins or themes", (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const service = createService(fixture, { isPackaged: true });

  assert.deepEqual(service.getPlugins(), []);
  service.getAppConfig();
  assert.deepEqual(fs.readdirSync(fixture.userDataPath), []);
  service.dispose();
});
