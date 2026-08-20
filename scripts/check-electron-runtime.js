#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const FORBIDDEN_TAURI_ENTRIES = Object.freeze([
  "src-tauri",
  "tauri.conf.json",
  "tauri.conf.json5",
  "tauri.conf.toml",
  "Tauri.toml"
]);
const RUNTIME_DIRECTORIES = Object.freeze(["src", "native-src"]);
const RUNTIME_ROOT_FILES = Object.freeze([
  "main.js",
  "preload.js",
  "discord-presence.js",
  "discord-social-bridge.js"
]);
const SCANNED_RUNTIME_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx"
]);
const TAURI_RUNTIME_REFERENCE_PATTERN =
  /@tauri-apps\/|\b__TAURI__\b|\btauri::|\btauri:\/\/|\btauri\.conf(?:\.json5?|\.toml)?\b/i;
const TAURI_PACKAGE_REFERENCE_PATTERN = /@tauri-apps\//i;
const TAURI_COMMAND_SEGMENT_PATTERN =
  /(?:^|&&|\|\||;|\|)\s*(?:(?:cross-env(?:-shell)?|env)\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(?:(?:(?:npx|bunx)\s+(?:--?[^\s]+\s+)*|cargo\s+|yarn\s+|(?:npm|pnpm)\s+(?:exec\s+)?(?:--\s+)?))?(?:\.\/)?(?:node_modules\/\.bin\/)?tauri(?:\s|$)/i;

function isDirectElectronStartCommand(value) {
  return String(value || "").trim() === "electron .";
}

function hasTauriPackageCommand(value) {
  const command = String(value || "");
  return TAURI_PACKAGE_REFERENCE_PATTERN.test(command)
    || TAURI_COMMAND_SEGMENT_PATTERN.test(command);
}

function walkFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const resolvedPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(resolvedPath);
      }
      return entry.isFile() ? [resolvedPath] : [];
    });
}

function validateRuntimeFile(projectRoot, filePath, errors) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return;
  }

  if (!SCANNED_RUNTIME_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return;
  }

  const source = fs.readFileSync(filePath, "utf8");
  if (!TAURI_RUNTIME_REFERENCE_PATTERN.test(source)) {
    return;
  }

  const relativePath = path.relative(projectRoot, filePath).split(path.sep).join("/");
  errors.push(`Tauri runtime reference is not allowed in ${relativePath}.`);
}

function collectElectronRuntimeErrors(projectRoot) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
  );
  const dependencyGroups = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies
  ].filter(Boolean);
  const dependencyNames = new Set(dependencyGroups.flatMap((group) => Object.keys(group)));
  const errors = [];

  if (packageJson.main !== "main.js") {
    errors.push("package.json must use main.js as the Electron main-process entry.");
  }
  if (!isDirectElectronStartCommand(packageJson.scripts?.start)) {
    errors.push("The start script must be the direct Electron launch command: electron .");
  }
  if (!dependencyNames.has("electron")) {
    errors.push("Electron must remain an explicit development dependency.");
  }
  if (!dependencyNames.has("electron-builder")) {
    errors.push("electron-builder must remain the desktop application packager.");
  }
  if (Object.prototype.hasOwnProperty.call(packageJson, "tauri")) {
    errors.push("A package.json Tauri configuration is not allowed.");
  }

  for (const [scriptName, command] of Object.entries(packageJson.scripts || {})) {
    if (hasTauriPackageCommand(command)) {
      errors.push(`Tauri command is not allowed in package script: ${scriptName}`);
    }
  }

  for (const dependencyName of dependencyNames) {
    if (dependencyName === "tauri" || dependencyName.startsWith("@tauri-apps/")) {
      errors.push(`Tauri dependency is not allowed: ${dependencyName}`);
    }
  }

  for (const entryName of FORBIDDEN_TAURI_ENTRIES) {
    if (fs.existsSync(path.join(projectRoot, entryName))) {
      errors.push(`Tauri project entry is not allowed: ${entryName}`);
    }
  }

  for (const requiredFile of ["main.js", "preload.js"]) {
    const filePath = path.join(projectRoot, requiredFile);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing Electron runtime file: ${requiredFile}`);
      continue;
    }

    const source = fs.readFileSync(filePath, "utf8");
    if (!/require\(["']electron["']\)/.test(source)) {
      errors.push(`${requiredFile} must import Electron directly.`);
    }
  }

  for (const directory of RUNTIME_DIRECTORIES) {
    for (const filePath of walkFiles(path.join(projectRoot, directory))) {
      validateRuntimeFile(projectRoot, filePath, errors);
    }
  }
  for (const fileName of RUNTIME_ROOT_FILES) {
    validateRuntimeFile(projectRoot, path.join(projectRoot, fileName), errors);
  }

  return errors;
}

function run(projectRoot = path.resolve(__dirname, "..")) {
  const errors = collectElectronRuntimeErrors(projectRoot);
  if (errors.length) {
    errors.forEach((error) => process.stderr.write(`error: ${error}\n`));
    process.exitCode = 1;
    return false;
  }

  process.stdout.write("Electron client boundary verified; no Tauri project surface detected.\n");
  return true;
}

if (require.main === module) {
  run();
}

module.exports = {
  FORBIDDEN_TAURI_ENTRIES,
  RUNTIME_DIRECTORIES,
  RUNTIME_ROOT_FILES,
  SCANNED_RUNTIME_EXTENSIONS,
  TAURI_RUNTIME_REFERENCE_PATTERN,
  TAURI_PACKAGE_REFERENCE_PATTERN,
  TAURI_COMMAND_SEGMENT_PATTERN,
  isDirectElectronStartCommand,
  hasTauriPackageCommand,
  walkFiles,
  validateRuntimeFile,
  collectElectronRuntimeErrors,
  run
};
