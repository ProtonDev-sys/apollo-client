const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  validateElectronBoundary,
  validateElectronPackage
} = require("../scripts/check-electron-platform");

function createElectronPackage(overrides = {}) {
  return {
    main: "main.js",
    scripts: {
      start: "electron ."
    },
    devDependencies: {
      electron: "^43.4.1",
      "electron-builder": "^26.15.3"
    },
    ...overrides
  };
}

test("Electron package boundary accepts the supported desktop stack", () => {
  assert.deepEqual(validateElectronPackage(createElectronPackage()), []);
});

test("Electron package boundary rejects Tauri dependencies and missing Electron entry points", () => {
  const errors = validateElectronPackage(createElectronPackage({
    main: "src-tauri/main.rs",
    scripts: {
      start: "tauri dev"
    },
    dependencies: {
      "@tauri-apps/api": "latest"
    },
    devDependencies: {}
  }));

  assert.ok(errors.some((error) => error.includes('"main"')));
  assert.ok(errors.some((error) => error.includes("launch Electron")));
  assert.ok(errors.some((error) => error.includes("Electron must")));
  assert.ok(errors.some((error) => error.includes("electron-builder")));
  assert.ok(errors.some((error) => error.includes("Tauri dependencies")));
});

test("project boundary rejects Tauri files and source references", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-electron-boundary-"));
  fs.mkdirSync(path.join(projectRoot, "src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify(createElectronPackage(), null, 2)
  );
  fs.writeFileSync(
    path.join(projectRoot, "src", "bridge.js"),
    'import { invoke } from "@tauri-apps/api/core";\n'
  );

  const errors = validateElectronBoundary(projectRoot);
  assert.ok(errors.some((error) => error.includes("src-tauri")));
  assert.ok(errors.some((error) => error.includes("src/bridge.js")));

  fs.rmSync(projectRoot, { recursive: true, force: true });
});
