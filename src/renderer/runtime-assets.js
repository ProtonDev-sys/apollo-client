function resolveThemeStyleElement(documentRef) {
  return documentRef.querySelector("#apollo-theme-style");
}

export function applyConfiguredTheme(theme, documentRef = document) {
  if (!theme || typeof theme !== "object") {
    return;
  }

  const rootStyle = documentRef.documentElement?.style;
  if (rootStyle && theme.variables && typeof theme.variables === "object") {
    Object.entries(theme.variables).forEach(([key, value]) => {
      if (typeof key === "string" && typeof value === "string" && key.startsWith("--")) {
        rootStyle.setProperty(key, value);
      }
    });
  }

  const existingThemeStyle = resolveThemeStyleElement(documentRef);
  if (typeof theme.css === "string" && theme.css) {
    const styleElement = existingThemeStyle || documentRef.createElement("style");
    styleElement.id = "apollo-theme-style";
    styleElement.textContent = theme.css;
    if (!existingThemeStyle) {
      documentRef.head.append(styleElement);
    }
  } else if (existingThemeStyle) {
    existingThemeStyle.remove();
  }
}

export function buildPluginImportUrl(pluginEntry) {
  const baseUrl = String(pluginEntry?.moduleUrl || pluginEntry?.path || "");
  if (!baseUrl) {
    return "";
  }

  try {
    const importUrl = new URL(baseUrl);
    importUrl.searchParams.set("apollo_mtime", String(pluginEntry?.mtimeMs || Date.now()));
    return importUrl.toString();
  } catch {
    return `${baseUrl}?apollo_mtime=${encodeURIComponent(String(pluginEntry?.mtimeMs || Date.now()))}`;
  }
}

export async function loadRuntimePluginModules({
  runtimeAssets,
  logClient,
  buildImportUrl = buildPluginImportUrl
}) {
  if (!runtimeAssets?.getPlugins) {
    return [];
  }

  let pluginEntries = [];
  try {
    pluginEntries = await runtimeAssets.getPlugins();
  } catch (error) {
    logClient?.("plugins", "runtime plugin discovery failed", {
      error: error?.message || "unknown"
    });
    return [];
  }

  const modules = [];
  for (const pluginEntry of Array.isArray(pluginEntries) ? pluginEntries : []) {
    try {
      const importUrl = buildImportUrl(pluginEntry);
      if (!importUrl) {
        continue;
      }

      const pluginModule = await import(importUrl);
      if (!pluginModule?.default) {
        logClient?.("plugins", "plugin module missing default export", {
          path: pluginEntry.path
        });
        continue;
      }

      modules.push(pluginModule.default);
    } catch (error) {
      logClient?.("plugins", "plugin import failed", {
        path: pluginEntry.path,
        error: error?.message || "unknown"
      });
    }
  }

  return modules;
}
