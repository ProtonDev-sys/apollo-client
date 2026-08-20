#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
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
if (!/\belectron\b/.test(String(packageJson.scripts?.start || ""))) {
  errors.push("The start script must launch Electron.");
}
if (!dependencyNames.has("electron")) {
  errors.push("Electron must remain an explicit development dependency.");
}
if (!dependencyNames.has("electron-builder")) {
  errors.push("electron-builder must remain the desktop application packager.");
}

for (const dependencyName of dependencyNames) {
  if (dependencyName === "tauri" || dependencyName.startsWith("@tauri-apps/")) {
    errors.push(`Tauri dependency is not allowed: ${dependencyName}`);
  }
}

for (const entryName of ["src-tauri", "tauri.conf.json", "tauri.conf.json5", "Tauri.toml"]) {
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

if (errors.length) {
  errors.forEach((error) => process.stderr.write(`error: ${error}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write("Electron client boundary verified; no Tauri project surface detected.\n");
}
