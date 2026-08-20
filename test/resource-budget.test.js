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

function createProject(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-resource-budget-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const packageJson = {
    main: "main.js",
    dependencies: { "discord-rpc": "^4.0.1" },
    build: {
      asar: true,
      compression: "maximum",
      files: ["main.js", "preload.js", "src/**/*", "package.json"]
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

test("resource budget accepts a compact Electron project", (context) => {
  const root = createProject();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(collectResourceBudgetErrors(root).errors, []);
});

test("resource budget rejects MQTT, unrestricted packaging, and dead desktop files", (context) => {
  const root = createProject({
    packageJson: {
      dependencies: { mqtt: "^5.0.0" },
      build: { asar: false, compression: "store", files: ["**/*"] }
    },
    packageLock: {
      packages: {
        "": { dependencies: { mqtt: "^5.0.0" } },
        "node_modules/mqtt": { version: "5.0.0" }
      }
    }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src", "desktop"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "desktop", "runtime-assets.js"), "");
  const errors = collectResourceBudgetErrors(root).errors.join("\n");
  assert.match(errors, /mqtt/i);
  assert.match(errors, /ASAR/);
  assert.match(errors, /compression/);
  assert.match(errors, /unrestricted wildcard/);
  assert.match(errors, /src\/desktop\/runtime-assets/);
});

test("package budget rejects oversized app.asar files", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-package-budget-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, "release", "linux-unpacked", "resources");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), Buffer.alloc(20));
  assert.equal(checkPackageBudget({ projectRoot: root, maxAsarBytes: 10 }).ok, false);
  assert.equal(checkPackageBudget({ projectRoot: root, maxAsarBytes: 30 }).ok, true);
});


test("resource budget rejects unavailable required targets and exact exclusive limits", (context) => {
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

test("package budget rejects non-finite and non-positive limits", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-package-budget-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => checkPackageBudget({ projectRoot: root, maxAsarBytes: Number.POSITIVE_INFINITY }),
    /finite positive number/
  );
  assert.throws(
    () => checkPackageBudget({ projectRoot: root, maxAsarBytes: 0 }),
    /finite positive number/
  );
});
