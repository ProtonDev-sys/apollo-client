function sortByOrder(items) {
  items.sort((left, right) => {
    const leftOrder = left.order ?? 100;
    const rightOrder = right.order ?? 100;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return String(left.label || left.name || left.id).localeCompare(
      String(right.label || right.name || right.id)
    );
  });
}

function normaliseLyricsPayload(payload, provider) {
  if (!payload) {
    return null;
  }

  return {
    source: payload.source || provider.name || provider.id,
    synced: Boolean(payload.synced),
    plainText: payload.plainText || "",
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    meta: payload.meta || {}
  };
}

export function createPluginHost(sharedApi) {
  const plugins = [];
  const detailTabs = [];
  const lyricsProviders = [];

  function registerDetailTab(plugin, tab) {
    if (!tab?.id || !tab?.label || typeof tab.mount !== "function") {
      throw new Error(`Plugin "${plugin.id}" registered an invalid detail tab.`);
    }

    detailTabs.push({
      ...tab,
      pluginId: plugin.id
    });
    sortByOrder(detailTabs);
  }

  function registerLyricsProvider(plugin, provider) {
    if (!provider?.id || !provider?.name || typeof provider.resolve !== "function") {
      throw new Error(`Plugin "${plugin.id}" registered an invalid lyrics provider.`);
    }

    lyricsProviders.push({
      ...provider,
      pluginId: plugin.id
    });
    sortByOrder(lyricsProviders);
  }

  async function loadPlugins(pluginModules) {
    for (const plugin of pluginModules) {
      if (!plugin?.id || typeof plugin.setup !== "function") {
        continue;
      }

      const api = {
        ...sharedApi,
        registerDetailTab: (tab) => registerDetailTab(plugin, tab),
        registerLyricsProvider: (provider) => registerLyricsProvider(plugin, provider)
      };

      await plugin.setup(api);
      plugins.push({
        id: plugin.id,
        name: plugin.name || plugin.id
      });
    }
  }

  async function resolveLyrics(track) {
    for (const provider of lyricsProviders) {
      if (typeof provider.canResolve === "function" && !provider.canResolve(track)) {
        continue;
      }

      try {
        const result = await provider.resolve(track);
        const payload = normaliseLyricsPayload(result, provider);

        if (payload && (payload.lines.length || payload.plainText)) {
          return payload;
        }
      } catch {
        // Ignore provider failures so later providers can still resolve lyrics.
      }
    }

    return null;
  }

  function getDetailTabs() {
    return detailTabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      order: tab.order ?? 100,
      pluginId: tab.pluginId
    }));
  }

  function mountDetailTab(tabId, container, context) {
    const tab = detailTabs.find((entry) => entry.id === tabId);

    if (!tab) {
      container.textContent = "Panel unavailable.";
      return () => {};
    }

    const cleanup = tab.mount({
      container,
      context,
      services: {
        resolveLyrics
      }
    });

    return typeof cleanup === "function" ? cleanup : () => {};
  }

  return {
    getDetailTabs,
    loadPlugins,
    mountDetailTab,
    plugins
  };
}
