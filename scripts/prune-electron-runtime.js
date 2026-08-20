#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const PRUNED_RUNTIME_FILES = Object.freeze({
  linux: Object.freeze([
    "libvk_swiftshader.so",
    "vk_swiftshader_icd.json",
    "libvulkan.so.1"
  ]),
  win32: Object.freeze([
    "dxcompiler.dll",
    "dxil.dll",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll"
  ])
});

function resolveElectronPlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  if (platform === "win" || platform === "windows") {
    return "win32";
  }
  return platform;
}

function pruneElectronRuntime(context, {
  fsImpl = fs,
  pathImpl = path,
  logger = (message) => process.stdout.write(`${message}\n`)
} = {}) {
  const platform = resolveElectronPlatform(context?.electronPlatformName || context?.platform);
  const appOutDir = String(context?.appOutDir || "").trim();
  const relativePaths = PRUNED_RUNTIME_FILES[platform] || [];

  if (!relativePaths.length) {
    return {
      platform,
      removedBytes: 0,
      removedFiles: []
    };
  }

  if (!appOutDir) {
    throw new TypeError("Electron runtime pruning requires an appOutDir.");
  }

  let removedBytes = 0;
  const removedFiles = [];

  for (const relativePath of relativePaths) {
    const targetPath = pathImpl.join(appOutDir, relativePath);
    let stats;
    try {
      stats = fsImpl.statSync(targetPath);
    } catch {
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    removedBytes += stats.size;
    fsImpl.rmSync(targetPath, { force: true });
    removedFiles.push(relativePath);
  }

  logger(
    `Pruned unused Electron graphics runtime: platform=${platform} `
      + `files=${removedFiles.length} bytes=${removedBytes}.`
  );

  return {
    platform,
    removedBytes,
    removedFiles
  };
}

async function afterPack(context) {
  pruneElectronRuntime(context);
}

module.exports = afterPack;
module.exports.PRUNED_RUNTIME_FILES = PRUNED_RUNTIME_FILES;
module.exports.pruneElectronRuntime = pruneElectronRuntime;
module.exports.resolveElectronPlatform = resolveElectronPlatform;
