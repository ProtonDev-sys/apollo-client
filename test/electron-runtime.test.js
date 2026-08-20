const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectElectronRuntimeErrors,
  findRetiredDesktopReferences,
  hasDistFileSet,
  isDirectElectronStartCommand
} = require("../scripts/check-electron-runtime");

function createProject(overrides = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-electron-only-"));
  const packageJson = {
    main: "main.js",
    scripts: {
      start: "electron .",
      "build:app": "node scripts/build-app.js",
      "build:win": "npm run build:app && electron-builder --win nsis",
      "build:win:portable": "npm run build:app && electron-builder --dir --win && node scripts/build-windows-portable.js",
      "build:win:social": "npm run build:app && npm run build:discord-social-helper && electron-builder --win nsis"
    },
    dependencies: {},
    devDependencies: {
      electron: "^43.4.1",
      "electron-builder": "^26.15.7",
      esbuild: "^0.28.2"
    },
    build: {
      asar: true,
      compression: "maximum",
      npmRebuild: false,
      afterPack: "scripts/prune-electron-runtime.js",
      electronLanguages: ["en-US"],
      files: [{ from: "dist-app", to: ".", filter: ["**/*"] }]
    },
    ...overrides.packageJson
  };
  const packageLock = overrides.packageLock || {
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {}
      }
    }
  };

  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(projectRoot, "package-lock.json"), JSON.stringify(packageLock));
  fs.writeFileSync(path.join(projectRoot, ".gitignore"), "dist-app/\n");
  fs.writeFileSync(path.join(projectRoot, "main.js"), "const { app } = require('electron');\nvoid app;\n");
  fs.writeFileSync(path.join(projectRoot, "preload.js"), "const { contextBridge } = require('electron');\nvoid contextBridge;\n");
  fs.writeFileSync(path.join(projectRoot, "src", "index.html"), "<!doctype html><title>Apollo</title>\n");
  fs.writeFileSync(path.join(projectRoot, "src", "renderer.js"), "export const runtime = 'electron';\n");
  fs.writeFileSync(path.join(projectRoot, "scripts", "build-app.js"), "module.exports = {};\n");
  fs.writeFileSync(
    path.join(projectRoot, "scripts", "prune-electron-runtime.js"),
    "module.exports = async function afterPack() {};\n"
  );
  fs.writeFileSync(
    path.join(projectRoot, "scripts", "build-windows-portable.js"),
    "module.exports = {};\n"
  );

  if (overrides.retiredReference) {
    fs.writeFileSync(
      path.join(projectRoot, "src", "retired-reference.js"),
      `const retired = "${Buffer.from([116, 97, 117, 114, 105]).toString("utf8")}";\n`
    );
  }

  return projectRoot;
}

test("Electron start validation accepts only the direct launch command", () => {
  assert.equal(isDirectElectronStartCommand("electron ."), true);
  assert.equal(isDirectElectronStartCommand(" electron . "), true);
  assert.equal(isDirectElectronStartCommand("echo electron"), false);
  assert.equal(isDirectElectronStartCommand("electron-builder"), false);
});

test("compact file-set validation requires generated runtime mapping", () => {
  assert.equal(hasDistFileSet([{ from: "dist-app", to: ".", filter: ["**/*"] }]), true);
  assert.equal(hasDistFileSet(["src/**/*"]), false);
  assert.equal(hasDistFileSet([{ from: "dist-app", to: "app" }]), false);
});

test("Electron-only boundary accepts compact core, portable, and optional social builds", (context) => {
  const projectRoot = createProject();
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  assert.deepEqual(collectElectronRuntimeErrors(projectRoot), []);
});

test("Electron-only boundary rejects mixed toolchains and broad packaging", (context) => {
  const projectRoot = createProject({
    packageJson: {
      main: "desktop.js",
      scripts: {
        start: "echo electron",
        "build:app": "echo build",
        "build:win": "npm run build:discord-social-helper && electron-builder --win nsis",
        "build:win:portable": "electron-builder --dir --win",
        "build:win:social": "electron-builder --win nsis"
      },
      dependencies: {
        "runtime-package": "1.0.0"
      },
      devDependencies: {
        electron: "^43.4.1",
        "electron-builder": "^26.15.7",
        esbuild: "^0.28.2",
        "second-packager": "1.0.0"
      },
      build: {
        asar: false,
        compression: "store",
        npmRebuild: true,
        electronLanguages: ["en-US", "de"],
        files: ["**/*"]
      }
    },
    packageLock: {
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: { "runtime-package": "1.0.0" }
        }
      }
    },
    retiredReference: true
  });
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const errors = collectElectronRuntimeErrors(projectRoot).join("\n");
  assert.match(errors, /main\.js/);
  assert.match(errors, /direct Electron launch/);
  assert.match(errors, /compact Electron core/);
  assert.match(errors, /optional Discord Social build/);
  assert.match(errors, /build-windows-portable/);
  assert.match(errors, /Production dependencies/);
  assert.match(errors, /toolchain allowlist/);
  assert.match(errors, /ASAR/);
  assert.match(errors, /compression/);
  assert.match(errors, /prune-electron-runtime/);
  assert.match(errors, /generated dist-app/);
  assert.match(errors, /en-US locale/);
  assert.match(errors, /Retired desktop-shell reference/);
});

test("Electron-only boundary rejects missing packaging helpers", (context) => {
  const projectRoot = createProject();
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const packagePath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  delete packageJson.build.afterPack;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson));
  fs.rmSync(path.join(projectRoot, "scripts", "build-windows-portable.js"));

  const errors = collectElectronRuntimeErrors(projectRoot).join("\n");
  assert.match(errors, /prune-electron-runtime/);
  assert.match(errors, /build-windows-portable/);
});

test("retired desktop references are detected across documentation and source", (context) => {
  const projectRoot = createProject({ retiredReference: true });
  context.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  assert.deepEqual(findRetiredDesktopReferences(projectRoot), ["src/retired-reference.js"]);
});
