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
  const eventListeners = new Map();
  const pluginApis = new Map();
  const pluginDisposers = new Map();

  function subscribe(eventName, handler) {
    if (!eventName || typeof handler !== "function") {
      throw new Error("Plugins must subscribe with an event name and handler.");
    }

    const listeners = eventListeners.get(eventName) || [];
    listeners.push(handler);
    eventListeners.set(eventName, listeners);

    return () => {
      const currentListeners = eventListeners.get(eventName) || [];
      const nextListeners = currentListeners.filter((listener) => listener !== handler);

      if (nextListeners.length) {
        eventListeners.set(eventName, nextListeners);
        return;
      }

      eventListeners.delete(eventName);
    };
  }

  function emit(eventName, payload = {}) {
    const listeners = eventListeners.get(eventName) || [];

    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch {
        // Ignore plugin event failures so one bad subscriber does not break the host.
      }
    });
  }

  function ensureUniqueRegistration(items, id, description) {
    if (items.some((entry) => entry.id === id)) {
      throw new Error(`${description} "${id}" is already registered.`);
    }
  }

  function registerDetailTab(plugin, tab) {
    if (!tab?.id || !tab?.label || typeof tab.mount !== "function") {
      throw new Error(`Plugin "${plugin.id}" registered an invalid detail tab.`);
    }

    ensureUniqueRegistration(detailTabs, tab.id, "Detail tab");

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

    ensureUniqueRegistration(lyricsProviders, provider.id, "Lyrics provider");

    lyricsProviders.push({
      ...provider,
      pluginId: plugin.id
    });
    sortByOrder(lyricsProviders);
  }

  function createPluginApi(plugin) {
    const cleanups = [];
    const registerCleanup = (cleanup) => {
      if (typeof cleanup === "function") {
        cleanups.push(cleanup);
      }
    };

    pluginDisposers.set(plugin.id, () => {
      while (cleanups.length) {
        const cleanup = cleanups.pop();

        try {
          cleanup();
        } catch {
          // Ignore plugin cleanup failures during host shutdown.
        }
      }
    });

    return {
      ...sharedApi,
      on(eventName, handler) {
        const unsubscribe = subscribe(eventName, handler);
        registerCleanup(unsubscribe);
        return unsubscribe;
      },
      emit,
      onDispose: registerCleanup,
      registerDetailTab: (tab) => registerDetailTab(plugin, tab),
      registerLyricsProvider: (provider) => registerLyricsProvider(plugin, provider)
    };
  }

  async function loadPlugins(pluginModules) {
    for (const plugin of pluginModules) {
      if (!plugin?.id || typeof plugin.setup !== "function") {
        continue;
      }

      if (pluginApis.has(plugin.id)) {
        console.warn(`[apollo-plugin-host] duplicate plugin id "${plugin.id}" ignored`);
        continue;
      }

      try {
        const api = createPluginApi(plugin);
        pluginApis.set(plugin.id, api);
        const dispose = await plugin.setup(api);

        if (typeof dispose === "function") {
          api.onDispose(dispose);
        }

        plugins.push({
          id: plugin.id,
          name: plugin.name || plugin.id
        });
      } catch (error) {
        pluginDisposers.get(plugin.id)?.();
        pluginDisposers.delete(plugin.id);
        pluginApis.delete(plugin.id);
        console.warn(`[apollo-plugin-host] failed to load plugin "${plugin.id}"`, error);
      }
    }

    emit("plugins:loaded", {
      plugins: plugins.map((plugin) => ({ ...plugin }))
    });
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

    const mountSubscriptions = [];
    let cleanup = () => {};

    try {
      cleanup = tab.mount({
        container,
        context,
        api: pluginApis.get(tab.pluginId) || sharedApi,
        apollo: sharedApi.apollo,
        plugin: {
          id: tab.pluginId
        },
        services: {
          resolveLyrics,
          emit,
          on(eventName, handler) {
            const unsubscribe = subscribe(eventName, handler);
            mountSubscriptions.push(unsubscribe);
            return unsubscribe;
          }
        }
      }) || (() => {});
    } catch (error) {
      container.textContent = "Panel unavailable.";
      console.warn(`[apollo-plugin-host] failed to mount detail tab "${tab.id}"`, error);
    }

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }

      while (mountSubscriptions.length) {
        const unsubscribe = mountSubscriptions.pop();
        unsubscribe();
      }
    };
  }

  function getPlugins() {
    return plugins.map((plugin) => ({ ...plugin }));
  }

  function dispose() {
    for (const disposer of pluginDisposers.values()) {
      disposer();
    }

    plugins.length = 0;
    detailTabs.length = 0;
    lyricsProviders.length = 0;
    pluginDisposers.clear();
    pluginApis.clear();
    eventListeners.clear();
  }

  return {
    getDetailTabs,
    getPlugins,
    loadPlugins,
    mountDetailTab,
    dispose,
    emit,
    on: subscribe,
    plugins
  };
}
