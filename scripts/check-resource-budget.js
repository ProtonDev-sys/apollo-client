#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BUDGETS = Object.freeze({
  mainBytes: 32 * 1024,
  preloadBytes: 12 * 1024,
  rendererBytes: 347000,
  runtimeSourceBytes: 1200 * 1024
});
const FORBIDDEN_PACKAGED_PATHS = Object.freeze([
  "src/desktop/listen-along-signaling.js",
  "src/desktop/runtime-assets.js"
]);

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

function walkFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const resolved = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(resolved);
      }
      return entry.isFile() ? [resolved] : [];
    });
}

function sumFileSizes(filePaths) {
  return filePaths.reduce((total, filePath) => total + (getFileSize(filePath) || 0), 0);
}

function calculateRuntimeSourceBytes(projectRoot) {
  const rootFiles = [
    "main.js",
    "preload.js",
    "discord-presence.js",
    "discord-social-bridge.js",
    "package.json"
  ].map((relativePath) => path.join(projectRoot, relativePath));
  return sumFileSizes(rootFiles) + sumFileSizes(walkFiles(path.join(projectRoot, "src")));
}

function hasCompactFileSet(buildFiles) {
  return Array.isArray(buildFiles) && buildFiles.some((entry) => {
    return entry
      && typeof entry === "object"
      && entry.from === "dist-app"
      && entry.to === "."
      && Array.isArray(entry.filter)
      && entry.filter.includes("**/*");
  });
}

function collectResourceBudgetErrors(projectRoot, budgets = DEFAULT_BUDGETS) {
  const errors = [];
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies || {});
  const lockedDependencies = Object.keys(packageLock.packages?.[""]?.dependencies || {});

  if (dependencies.length || lockedDependencies.length) {
    errors.push("The packaged Electron runtime must not contain production dependencies.");
  }
  if (packageJson.build?.asar !== true) {
    errors.push("Electron packaging must keep ASAR enabled.");
  }
  if (packageJson.build?.compression !== "maximum") {
    errors.push('Electron Builder compression must be set to "maximum".');
  }
  if (!hasCompactFileSet(packageJson.build?.files)) {
    errors.push("Electron Builder must package only the generated dist-app runtime.");
  }
  if (!Array.isArray(packageJson.build?.electronLanguages)
      || packageJson.build.electronLanguages.length !== 1
      || packageJson.build.electronLanguages[0] !== "en-US") {
    errors.push("Electron Builder must retain only the en-US locale.");
  }

  for (const relativePath of FORBIDDEN_PACKAGED_PATHS) {
    if (fs.existsSync(path.join(projectRoot, relativePath))) {
      errors.push(`Forbidden packaged path remains: ${relativePath}`);
    }
  }

  const requiredTargets = {
    mainBytes: "main.js",
    preloadBytes: "preload.js",
    rendererBytes: path.join("src", "renderer.js")
  };
  const measured = {};
  for (const [name, relativePath] of Object.entries(requiredTargets)) {
    const size = getFileSize(path.join(projectRoot, relativePath));
    if (size === null) {
      errors.push(`Required resource budget target is missing or unreadable: ${relativePath}`);
      measured[name] = 0;
    } else {
      measured[name] = size;
    }
  }
  measured.runtimeSourceBytes = calculateRuntimeSourceBytes(projectRoot);

  for (const [name, limit] of Object.entries(budgets)) {
    if (!Number.isFinite(limit) || limit <= 0) {
      errors.push(`Invalid resource budget for ${name}.`);
    } else if (measured[name] >= limit) {
      errors.push(`${name} exceeds its exclusive resource budget: ${measured[name]} >= ${limit} bytes`);
    }
  }

  return { errors, measured };
}

function run(projectRoot = path.resolve(__dirname, "..")) {
  const result = collectResourceBudgetErrors(projectRoot);
  if (result.errors.length) {
    result.errors.forEach((error) => process.stderr.write(`error: ${error}\n`));
    process.exitCode = 1;
    return false;
  }

  process.stdout.write(
    `Electron resource budget verified: main=${result.measured.mainBytes}, `
      + `preload=${result.measured.preloadBytes}, renderer=${result.measured.rendererBytes}, `
      + `runtime-source=${result.measured.runtimeSourceBytes} bytes.\n`
  );
  return true;
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_BUDGETS,
  FORBIDDEN_PACKAGED_PATHS,
  calculateRuntimeSourceBytes,
  collectResourceBudgetErrors,
  getFileSize,
  hasCompactFileSet,
  run,
  walkFiles
};
