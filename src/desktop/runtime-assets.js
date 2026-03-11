const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_THEME_SEED = {
  fonts: {
    ui: "\"IBM Plex Sans\", sans-serif",
    mono: "\"IBM Plex Mono\", monospace"
  },
  variables: {
    bg: "#050505",
    surface: "#0c0c0c",
    "surface-2": "#111111",
    "surface-3": "#171717",
    border: "rgba(255, 255, 255, 0.08)",
    "border-soft": "rgba(255, 255, 255, 0.04)",
    text: "#f4f1eb",
    muted: "#9f988d",
    "muted-2": "#7b756b",
    accent: "#dc55dc",
    "accent-soft": "rgba(220, 85, 220, 0.18)",
    progress: "#dc55dc",
    shadow: "0 18px 60px rgba(0, 0, 0, 0.42)"
  },
  css: ""
};

function sanitiseThemeConfig(theme = {}) {
  const variables = {};
  const sources = [theme.variables, theme.vars];
  sources.forEach((source) => {
    if (!source || typeof source !== "object") {
      return;
    }

    Object.entries(source).forEach(([key, value]) => {
      if (typeof value !== "string" || !key) {
        return;
      }

      const variableName = key.startsWith("--") ? key : `--${key}`;
      variables[variableName] = value;
    });
  });

  if (typeof theme?.fonts?.ui === "string") {
    variables["--font-ui"] = theme.fonts.ui;
  }

  if (typeof theme?.fonts?.mono === "string") {
    variables["--font-mono"] = theme.fonts.mono;
  }

  return {
    variables,
    css: typeof theme.css === "string" ? theme.css : ""
  };
}

function ensureDirectory(directoryPath) {
  if (!directoryPath) {
    return;
  }

  fs.mkdirSync(directoryPath, {
    recursive: true
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniquePaths(values) {
  const seen = new Set();
  return values.filter((value) => {
    const resolved = String(value || "").trim();
    if (!resolved) {
      return false;
    }

    const normalised = path.resolve(resolved);
    if (seen.has(normalised)) {
      return false;
    }

    seen.add(normalised);
    return true;
  });
}

function createRuntimeAssetsController({
  runtimeInfo = {},
  env = process.env,
  appDirectory = process.cwd(),
  logger = () => {}
} = {}) {
  const runtimeAssetListeners = new Set();
  const runtimeAssetWatchers = [];
  let runtimeAssetNotifyHandle = null;
  let appConfig = {
    sourcePath: "",
    themeSourcePath: "",
    themeDirectories: [],
    pluginDirectories: [],
    theme: sanitiseThemeConfig()
  };

  function logRuntimeEvent(message, details = null) {
    logger("runtime-assets", message, details);
  }

  function getRuntimePluginDirectories() {
    return uniquePaths([
      env.APOLLO_PLUGIN_DIR,
      runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "plugins") : "",
      runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "plugins") : "",
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "plugins") : ""
    ]);
  }

  function getRuntimeThemeDirectories() {
    return uniquePaths([
      env.APOLLO_THEME_DIR,
      runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "themes") : "",
      runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "themes") : "",
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "themes") : ""
    ]);
  }

  function getDefaultRuntimePluginPath() {
    const pluginDirectories = getRuntimePluginDirectories();
    return pluginDirectories[pluginDirectories.length - 1]
      ? path.join(pluginDirectories[pluginDirectories.length - 1], "lyrics-plugin.js")
      : "";
  }

  function getDefaultRuntimeThemePath() {
    const themeDirectories = getRuntimeThemeDirectories();
    return themeDirectories[themeDirectories.length - 1]
      ? path.join(themeDirectories[themeDirectories.length - 1], "default-theme.json")
      : "";
  }

  function ensureSeedRuntimeAssets() {
    const defaultPluginTarget = getDefaultRuntimePluginPath();
    const defaultThemeTarget = getDefaultRuntimeThemePath();

    if (defaultPluginTarget) {
      ensureDirectory(path.dirname(defaultPluginTarget));
      if (!fs.existsSync(defaultPluginTarget)) {
        fs.copyFileSync(path.join(appDirectory, "src", "plugins", "lyrics-plugin.js"), defaultPluginTarget);
        logRuntimeEvent("seeded default plugin", {
          target: defaultPluginTarget
        });
      }
    }

    if (defaultThemeTarget) {
      ensureDirectory(path.dirname(defaultThemeTarget));
      if (!fs.existsSync(defaultThemeTarget)) {
        fs.writeFileSync(defaultThemeTarget, JSON.stringify(DEFAULT_THEME_SEED, null, 2));
        logRuntimeEvent("seeded default theme", {
          target: defaultThemeTarget
        });
      }
    }
  }

  function resolveAppConfigCandidatePaths() {
    return uniquePaths([
      env.APOLLO_CONFIG_PATH,
      runtimeInfo.execDirectory ? path.join(runtimeInfo.execDirectory, "apollo.config.json") : "",
      runtimeInfo.currentWorkingDirectory ? path.join(runtimeInfo.currentWorkingDirectory, "apollo.config.json") : "",
      runtimeInfo.userDataPath ? path.join(runtimeInfo.userDataPath, "apollo.config.json") : "",
      path.join(appDirectory, "apollo.config.json")
    ]);
  }

  function resolveAppConfigPath() {
    try {
      for (const candidatePath of resolveAppConfigCandidatePaths()) {
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    } catch {
      return "";
    }

    return "";
  }

  function mergeThemeConfigs(baseTheme = sanitiseThemeConfig(), overrideTheme = sanitiseThemeConfig()) {
    return sanitiseThemeConfig({
      variables: {
        ...(baseTheme.variables || {}),
        ...(overrideTheme.variables || {})
      },
      css: [baseTheme.css || "", overrideTheme.css || ""].filter(Boolean).join("\n")
    });
  }

  function resolveThemeSelection(selection, themeDirectories, relativeDirectory = "") {
    const rawSelection = String(selection || "").trim();
    if (!rawSelection) {
      return "";
    }

    const directCandidates = uniquePaths([
      path.isAbsolute(rawSelection) ? rawSelection : "",
      relativeDirectory ? path.join(relativeDirectory, rawSelection) : ""
    ]);
    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const fileCandidates = [rawSelection];
    if (!path.extname(rawSelection)) {
      fileCandidates.push(`${rawSelection}.json`);
      fileCandidates.push(`${rawSelection}.css`);
    }

    for (const directoryPath of themeDirectories) {
      for (const candidateName of fileCandidates) {
        const candidatePath = path.join(directoryPath, candidateName);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    }

    return "";
  }

  function loadThemeFromFile(themePath) {
    if (!themePath || !fs.existsSync(themePath)) {
      return sanitiseThemeConfig();
    }

    if (themePath.toLowerCase().endsWith(".css")) {
      return sanitiseThemeConfig({
        css: fs.readFileSync(themePath, "utf8")
      });
    }

    const parsedTheme = readJsonFile(themePath);
    return sanitiseThemeConfig(parsedTheme?.theme || parsedTheme);
  }

  function loadAppConfig() {
    ensureSeedRuntimeAssets();

    const configPath = resolveAppConfigPath();
    const themeDirectories = getRuntimeThemeDirectories();
    const pluginDirectories = getRuntimePluginDirectories();

    if (!configPath) {
      const defaultThemePath = resolveThemeSelection("default-theme", themeDirectories);
      return {
        sourcePath: "",
        themeSourcePath: defaultThemePath,
        themeDirectories,
        pluginDirectories,
        theme: loadThemeFromFile(defaultThemePath)
      };
    }

    try {
      const parsed = readJsonFile(configPath);
      const themeSelection = parsed?.themeFile
        || parsed?.theme?.file
        || parsed?.theme?.path
        || parsed?.theme?.id
        || parsed?.theme?.name
        || "";
      const themeSourcePath = resolveThemeSelection(
        themeSelection,
        themeDirectories,
        path.dirname(configPath)
      );

      return {
        sourcePath: configPath,
        themeSourcePath,
        themeDirectories,
        pluginDirectories,
        theme: mergeThemeConfigs(
          loadThemeFromFile(themeSourcePath),
          sanitiseThemeConfig(parsed?.theme)
        )
      };
    } catch (error) {
      logRuntimeEvent("unable to load app config", {
        path: configPath,
        error: error?.message || "unknown"
      });
      return {
        sourcePath: configPath,
        themeSourcePath: "",
        themeDirectories,
        pluginDirectories,
        theme: sanitiseThemeConfig()
      };
    }
  }

  function discoverPlugins() {
    ensureSeedRuntimeAssets();

    const pluginEntries = [];
    const seen = new Set();

    getRuntimePluginDirectories().forEach((directoryPath) => {
      if (!fs.existsSync(directoryPath)) {
        return;
      }

      let directoryEntries = [];
      try {
        directoryEntries = fs.readdirSync(directoryPath, {
          withFileTypes: true
        });
      } catch (error) {
        logRuntimeEvent("unable to read plugin directory", {
          directoryPath,
          error: error?.message || "unknown"
        });
        return;
      }

      directoryEntries.forEach((entry) => {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".js")) {
          return;
        }

        const resolvedPath = path.join(directoryPath, entry.name);
        if (seen.has(resolvedPath)) {
          return;
        }

        seen.add(resolvedPath);

        let stat = null;
        try {
          stat = fs.statSync(resolvedPath);
        } catch {
          stat = null;
        }

        pluginEntries.push({
          id: path.basename(entry.name, path.extname(entry.name)),
          fileName: entry.name,
          path: resolvedPath,
          directoryPath,
          moduleUrl: pathToFileURL(resolvedPath).toString(),
          mtimeMs: stat?.mtimeMs || 0
        });
      });
    });

    return pluginEntries;
  }

  function getSnapshot() {
    appConfig = loadAppConfig();
    return {
      appConfig,
      plugins: discoverPlugins(),
      paths: {
        configCandidates: resolveAppConfigCandidatePaths(),
        pluginDirectories: getRuntimePluginDirectories(),
        themeDirectories: getRuntimeThemeDirectories(),
        logPath: runtimeInfo.logPath || ""
      }
    };
  }

  function emitChanged(reason) {
    const snapshot = getSnapshot();
    runtimeAssetListeners.forEach((listener) => {
      listener({
        reason,
        snapshot
      });
    });
  }

  function scheduleChanged(reason) {
    clearTimeout(runtimeAssetNotifyHandle);
    runtimeAssetNotifyHandle = setTimeout(() => {
      emitChanged(reason);
    }, 140);
  }

  function watchPath(targetPath, reason) {
    if (!targetPath) {
      return;
    }

    try {
      const watcher = fs.watch(targetPath, {
        persistent: false
      }, () => {
        scheduleChanged(reason);
      });

      runtimeAssetWatchers.push(() => {
        try {
          watcher.close();
        } catch {
          // Ignore watcher close failures.
        }
      });
    } catch (error) {
      logRuntimeEvent("unable to watch path", {
        targetPath,
        error: error?.message || "unknown"
      });
    }
  }

  function initialiseWatchers() {
    uniquePaths([
      ...getRuntimePluginDirectories(),
      ...getRuntimeThemeDirectories(),
      ...resolveAppConfigCandidatePaths().map((candidatePath) => path.dirname(candidatePath))
    ]).forEach((targetPath) => {
      if (fs.existsSync(targetPath)) {
        watchPath(targetPath, targetPath);
      }
    });
  }

  function dispose() {
    clearTimeout(runtimeAssetNotifyHandle);
    runtimeAssetNotifyHandle = null;

    while (runtimeAssetWatchers.length) {
      const disposeWatcher = runtimeAssetWatchers.pop();
      try {
        disposeWatcher();
      } catch {
        // Ignore watcher cleanup failures.
      }
    }

    runtimeAssetListeners.clear();
  }

  try {
    appConfig = loadAppConfig();
  } catch (error) {
    logRuntimeEvent("unable to initialise app config", {
      error: error?.message || "unknown"
    });
  }

  initialiseWatchers();

  return {
    getAppConfig() {
      appConfig = loadAppConfig();
      return appConfig;
    },
    getPlugins: discoverPlugins,
    getSnapshot,
    onChanged(callback) {
      if (typeof callback !== "function") {
        return () => {};
      }

      runtimeAssetListeners.add(callback);
      callback({
        reason: "initial",
        snapshot: getSnapshot()
      });

      return () => {
        runtimeAssetListeners.delete(callback);
      };
    },
    dispose
  };
}

module.exports = {
  createRuntimeAssetsController
};
