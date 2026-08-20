const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function importEsmSource(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const importUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`;
  return import(importUrl);
}

async function createHost(sharedApi = {}) {
  const modulePath = path.join(__dirname, "..", "src", "plugin-host.js");
  const { createPluginHost } = await importEsmSource(modulePath);
  return createPluginHost(sharedApi);
}

test("plugin host rolls back contributions and subscriptions after setup fails", async () => {
  const host = await createHost({
    apollo: {}
  });
  let leakedEventCalls = 0;

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await host.loadPlugins([
      {
        id: "broken",
        name: "Broken",
        setup(api) {
          api.on("probe", () => {
            leakedEventCalls += 1;
          });
          api.registerDetailTab({
            id: "broken-tab",
            label: "Broken",
            order: 1,
            mount() {}
          });
          api.registerLyricsProvider({
            id: "broken-lyrics",
            name: "Broken lyrics",
            order: 1,
            async resolve() {
              return {
                plainText: "This provider must not survive."
              };
            }
          });
          throw new Error("setup failed");
        }
      },
      {
        id: "healthy",
        name: "Healthy",
        setup(api) {
          api.registerLyricsProvider({
            id: "healthy-lyrics",
            name: "Healthy lyrics",
            order: 10,
            async resolve() {
              return {
                plainText: "Healthy result"
              };
            }
          });
        }
      }
    ]);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(host.getPlugins(), [
    {
      id: "healthy",
      name: "Healthy"
    }
  ]);
  assert.deepEqual(host.getDetailTabs(), []);

  host.emit("probe");
  assert.equal(leakedEventCalls, 0);

  const lyrics = await host.resolveLyrics({
    title: "Apollo",
    artist: "Tester"
  });
  assert.equal(lyrics.plainText, "Healthy result");

  host.dispose();
});

test("plugin host loads, mounts, emits, and disposes a healthy plugin", async () => {
  const host = await createHost({
    apollo: {
      marker: "runtime"
    }
  });
  let eventCalls = 0;
  let setupCleanupCalls = 0;
  let mountCleanupCalls = 0;

  await host.loadPlugins([
    {
      id: "inspector",
      name: "Inspector",
      setup(api) {
        api.on("selection:changed", () => {
          eventCalls += 1;
        });
        api.registerDetailTab({
          id: "inspector-tab",
          label: "Inspector",
          order: 30,
          mount({ container, apollo }) {
            container.textContent = apollo.marker;
            return () => {
              mountCleanupCalls += 1;
            };
          }
        });

        return () => {
          setupCleanupCalls += 1;
        };
      }
    }
  ]);

  assert.deepEqual(host.getDetailTabs(), [
    {
      id: "inspector-tab",
      label: "Inspector",
      order: 30,
      pluginId: "inspector"
    }
  ]);

  host.emit("selection:changed");
  assert.equal(eventCalls, 1);

  const container = {
    textContent: ""
  };
  const unmount = host.mountDetailTab("inspector-tab", container, {});
  assert.equal(container.textContent, "runtime");

  unmount();
  assert.equal(mountCleanupCalls, 1);

  host.dispose();
  assert.equal(setupCleanupCalls, 1);
  assert.deepEqual(host.getPlugins(), []);
  assert.deepEqual(host.getDetailTabs(), []);

  host.emit("selection:changed");
  assert.equal(eventCalls, 1);
});

test("plugin host ignores duplicate plugin ids without replacing the first plugin", async () => {
  const host = await createHost({
    apollo: {}
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await host.loadPlugins([
      {
        id: "duplicate",
        name: "First",
        setup() {}
      },
      {
        id: "duplicate",
        name: "Second",
        setup() {
          throw new Error("must not run");
        }
      }
    ]);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(host.getPlugins(), [
    {
      id: "duplicate",
      name: "First"
    }
  ]);

  host.dispose();
});
