const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectResourceBudgetErrors
} = require("../scripts/check-resource-budget");
const {
  checkPackageBudget
} = require("../scripts/check-package-budget");
const {
  checkBundleBudget
} = require("../scripts/check-bundle-budget");

function createProject(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-resource-budget-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const packageJson = {
    main: "main.js",
    dependencies: {},
    build: {
      asar: true,
      compression: "maximum",
      afterPack: "scripts/prune-electron-runtime.js",
      electronLanguages: ["en-US"],
      files: [{ from: "dist-app", to: ".", filter: ["**/*"] }]
    },
    ...overrides.packageJson
  };
  const packageLock = {
    lockfileVersion: 3,
    packages: {
      "": {
        dependencies: packageJson.dependencies || {}
      }
    },
    ...overrides.packageLock
  };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(packageLock));
  for (const file of ["main.js", "preload.js", "discord-presence.js", "discord-social-bridge.js"]) {
    fs.writeFileSync(path.join(root, file), "module.exports = {};\n");
  }
  fs.writeFileSync(path.join(root, "src", "renderer.js"), "export {};\n");
  return root;
}

function createPackagedRuntime(root, {
  platform = "linux",
  asarBytes = 20,
  extraFiles = {}
} = {}) {
  const directoryName = platform === "win32" ? "win-unpacked" : "linux-unpacked";
  const packageDirectory = path.join(root, "release", directoryName);
  const resources = path.join(packageDirectory, "resources");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), Buffer.alloc(asarBytes));

  Object.entries(extraFiles).forEach(([relativePath, bytes]) => {
    const targetPath = path.join(packageDirectory, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, Buffer.alloc(bytes));
  });

  return packageDirectory;
}

test("resource budget accepts a compact dependency-free Electron project", (context) => {
  const root = createProject();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(collectResourceBudgetErrors(root).errors, []);
});

test("resource budget rejects dependencies, broad packaging, extra locales, and missing pruning", (context) => {
  const root = createProject({
    packageJson: {
      dependencies: { "runtime-package": "1.0.0" },
      build: {
        asar: false,
        compression: "store",
        electronLanguages: ["en-US", "de"],
        files: ["**/*"]
      }
    },
    packageLock: {
      packages: {
        "": { dependencies: { "runtime-package": "1.0.0" } }
      }
    }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src", "desktop"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "desktop", "runtime-assets.js"), "");

  const errors = collectResourceBudgetErrors(root).errors.join("\n");
  assert.match(errors, /production dependencies/);
  assert.match(errors, /ASAR/);
  assert.match(errors, /compression/);
  assert.match(errors, /generated dist-app/);
  assert.match(errors, /en-US locale/);
  assert.match(errors, /prune-electron-runtime/);
  assert.match(errors, /src\/desktop\/runtime-assets/);
});

test("package budget enforces app.asar and complete runtime size", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-package-budget-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createPackagedRuntime(root, {
    extraFiles: {
      "required-runtime.bin": 30
    }
  });

  assert.equal(checkPackageBudget({
    projectRoot: root,
    packagePlatform: "linux",
    maxAsarBytes: 10,
    maxUnpackedBytes: 100
  }).ok, false);
  assert.equal(checkPackageBudget({
    projectRoot: root,
    packagePlatform: "linux",
    maxAsarBytes: 30,
    maxUnpackedBytes: 100
  }).ok, true);
  assert.match(checkPackageBudget({
    projectRoot: root,
    packagePlatform: "linux",
    maxAsarBytes: 30,
    maxUnpackedBytes: 40
  }).error, /runtime exceeds/);
});

test("package budget rejects Electron files assigned to build-time pruning", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-package-budget-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createPackagedRuntime(root, {
    platform: "win32",
    extraFiles: {
      "dxcompiler.dll": 5,
      "ffmpeg.dll": 7
    }
  });

  const result = checkPackageBudget({
    projectRoot: root,
    packagePlatform: "win32",
    maxAsarBytes: 30,
    maxUnpackedBytes: 100
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.remainingPrunableFiles, ["dxcompiler.dll"]);
  assert.match(result.error, /Unused Electron graphics files remain/);
});

test("resource budget rejects unavailable targets and exact exclusive limits", (context) => {
  const root = createProject();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(root, "preload.js"));
  let errors = collectResourceBudgetErrors(root).errors.join("\n");
  assert.match(errors, /missing or unreadable: preload\.js/);

  fs.writeFileSync(path.join(root, "preload.js"), "module.exports = {};\n");
  const mainSize = fs.statSync(path.join(root, "main.js")).size;
  errors = collectResourceBudgetErrors(root, { mainBytes: mainSize }).errors.join("\n");
  assert.match(errors, /mainBytes exceeds its exclusive resource budget/);
});

test("package and bundle budgets reject invalid limits", () => {
  assert.throws(
    () => checkPackageBudget({ maxAsarBytes: Number.POSITIVE_INFINITY }),
    /finite positive number/
  );
  assert.throws(
    () => checkPackageBudget({ maxUnpackedBytes: 0 }),
    /finite positive number/
  );
  assert.throws(
    () => checkBundleBudget({ maxBundleBytes: 0 }),
    /finite positive number/
  );
});
