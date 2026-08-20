const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectElectronRuntimeErrors,
  isDirectElectronStartCommand
} = require("../scripts/check-electron-runtime");

function createProject(overrides = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-client-electron-boundary-"));
  const packageJson = {
    main: "main.js",
    scripts: {
      start: "electron ."
    },
    devDependencies: {
      electron: "^43.4.1",
      "electron-builder": "^26.15.3"
    },
    ...overrides.packageJson
  };

  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(projectRoot, "main.js"), "const { app } = require('electron');\nvoid app;\n");
  fs.writeFileSync(path.join(projectRoot, "preload.js"), "const { contextBridge } = require('electron');\nvoid contextBridge;\n");
  fs.writeFileSync(path.join(projectRoot, "src", "renderer.js"), "export const runtime = 'electron';\n");

  if (overrides.tauri) {
    fs.mkdirSync(path.join(projectRoot, "src-tauri"));
  }
  if (overrides.runtimeSource) {
    fs.writeFileSync(path.join(projectRoot, "src", "renderer.js"), overrides.runtimeSource);
  }

  return projectRoot;
}

test("Electron client start validation accepts only the direct launch command", () => {
  assert.equal(isDirectElectronStartCommand("electron ."), true);
  assert.equal(isDirectElectronStartCommand(" electron . "), true);
  assert.equal(isDirectElectronStartCommand("echo electron"), false);
  assert.equal(isDirectElectronStartCommand("node -e \"console.log('electron')\""), false);
  assert.equal(isDirectElectronStartCommand("electron-builder"), false);
});

test("Electron client boundary accepts a valid project", (context) => {
  const projectRoot = createProject();
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  assert.deepEqual(collectElectronRuntimeErrors(projectRoot), []);
});

test("Electron client boundary rejects Tauri dependencies, artifacts, and runtime references", (context) => {
  const projectRoot = createProject({
    packageJson: {
      main: "main.js",
      scripts: {
        start: "echo electron"
      },
      dependencies: {
        "@tauri-apps/api": "^2.0.0"
      },
      devDependencies: {
        electron: "^43.4.1",
        "electron-builder": "^26.15.3"
      }
    },
    tauri: true,
    runtimeSource: "window.__TAURI__.core.invoke('search');\n"
  });
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const errors = collectElectronRuntimeErrors(projectRoot);
  assert.ok(errors.some((error) => error.includes("direct Electron launch command")));
  assert.ok(errors.some((error) => error.includes("@tauri-apps/api")));
  assert.ok(errors.some((error) => error.includes("src-tauri")));
  assert.ok(errors.some((error) => error.includes("src/renderer.js")));
});

test("documentation and tests are outside the executable Tauri scan", (context) => {
  const projectRoot = createProject();
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(projectRoot, "docs"));
  fs.mkdirSync(path.join(projectRoot, "test"));
  fs.writeFileSync(path.join(projectRoot, "docs", "architecture.md"), "Tauri is not supported.\n");
  fs.writeFileSync(path.join(projectRoot, "test", "boundary.test.js"), "const tauriFixture = '@tauri-apps/api';\n");

  assert.deepEqual(collectElectronRuntimeErrors(projectRoot), []);
});
