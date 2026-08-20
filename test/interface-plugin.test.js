const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function importStandaloneEsm(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const importUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`;
  return import(importUrl);
}

function copyInterfaceRuntimeSource(temporaryRoot) {
  fs.mkdirSync(path.join(temporaryRoot, "src", "renderer"), {
    recursive: true
  });
  fs.mkdirSync(path.join(temporaryRoot, "src", "plugins"), {
    recursive: true
  });
  fs.writeFileSync(
    path.join(temporaryRoot, "package.json"),
    JSON.stringify({
      type: "module"
    })
  );

  fs.copyFileSync(
    path.join(__dirname, "..", "src", "renderer", "runtime-assets.js"),
    path.join(temporaryRoot, "src", "renderer", "runtime-assets.js")
  );

  [
    "interface-plugin.js",
    "interface-state.js",
    "interface-styles.js"
  ].forEach((fileName) => {
    fs.copyFileSync(
      path.join(__dirname, "..", "src", "plugins", fileName),
      path.join(temporaryRoot, "src", "plugins", fileName)
    );
  });
}

async function importInterfaceState() {
  const modulePath = path.join(__dirname, "..", "src", "plugins", "interface-state.js");
  return importStandaloneEsm(modulePath);
}

test("interface preferences accept only supported density values", async () => {
  const { normaliseInterfacePreferences } = await importInterfaceState();

  assert.deepEqual(normaliseInterfacePreferences(), {
    density: "comfortable"
  });
  assert.deepEqual(normaliseInterfacePreferences({ density: "compact" }), {
    density: "compact"
  });
  assert.deepEqual(normaliseInterfacePreferences({ density: "tiny" }), {
    density: "comfortable"
  });
});

test("interface status derives offline, auth, activity, and playback states", async () => {
  const { deriveInterfaceStatus } = await importInterfaceState();

  assert.deepEqual(
    deriveInterfaceStatus({
      isConnected: false,
      apiBase: "http://127.0.0.1:4848"
    }),
    {
      kind: "offline",
      label: "Server offline",
      detail: "http://127.0.0.1:4848"
    }
  );

  assert.equal(
    deriveInterfaceStatus({
      isConnected: true,
      auth: {
        enabled: true,
        token: ""
      }
    }).kind,
    "locked"
  );

  assert.deepEqual(
    deriveInterfaceStatus({
      isConnected: true,
      isLoading: true,
      query: "test"
    }),
    {
      kind: "busy",
      label: "Searching",
      detail: "Searching for test"
    }
  );

  assert.equal(
    deriveInterfaceStatus(
      {
        isConnected: true
      },
      {
        isBuffering: true,
        track: {
          title: "Buffer Song"
        }
      }
    ).label,
    "Buffering"
  );

  assert.deepEqual(
    deriveInterfaceStatus(
      {
        isConnected: true
      },
      {
        isPlaying: true,
        track: {
          title: "Track",
          artist: "Artist"
        }
      }
    ),
    {
      kind: "active",
      label: "Playing",
      detail: "Track — Artist"
    }
  );

  assert.deepEqual(
    deriveInterfaceStatus({
      isConnected: true,
      backendVersion: "1.2.3"
    }),
    {
      kind: "online",
      label: "Connected",
      detail: "Apollo Server 1.2.3"
    }
  );
});

test("interface command filtering matches all query tokens", async () => {
  const { filterInterfaceCommands } = await importInterfaceState();
  const commands = [
    {
      id: "refresh",
      label: "Refresh library",
      description: "Reload tracks and playlists",
      keywords: ["server", "sync"]
    },
    {
      id: "settings",
      label: "Open settings",
      description: "Configure playback",
      keywords: ["preferences"]
    }
  ];

  assert.deepEqual(
    filterInterfaceCommands(commands, "library sync").map((command) => command.id),
    ["refresh"]
  );
  assert.deepEqual(
    filterInterfaceCommands(commands, "playback").map((command) => command.id),
    ["settings"]
  );
  assert.deepEqual(
    filterInterfaceCommands(commands, "").map((command) => command.id),
    ["refresh", "settings"]
  );
});

test("interface editable-target detection avoids stealing shortcuts from form controls", async () => {
  const { isEditableInterfaceTarget } = await importInterfaceState();

  assert.equal(
    isEditableInterfaceTarget({
      tagName: "INPUT",
      isContentEditable: false,
      closest: () => null
    }),
    true
  );
  assert.equal(
    isEditableInterfaceTarget({
      tagName: "DIV",
      isContentEditable: true,
      closest: () => null
    }),
    true
  );
  assert.equal(
    isEditableInterfaceTarget({
      tagName: "DIV",
      isContentEditable: false,
      closest: (selector) => selector === '[role="textbox"]' ? {} : null
    }),
    true
  );
  assert.equal(
    isEditableInterfaceTarget({
      tagName: "BUTTON",
      isContentEditable: false,
      closest: () => null
    }),
    false
  );
});

test("runtime asset loader always includes the built-in interface plugin", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-runtime-assets-"));

  try {
    copyInterfaceRuntimeSource(temporaryRoot);

    const runtimeAssetsModule = await import(
      `${pathToFileURL(path.join(temporaryRoot, "src", "renderer", "runtime-assets.js")).toString()}?test=${Date.now()}`
    );
    const loaded = await runtimeAssetsModule.loadRuntimePluginModules({
      runtimeAssets: null
    });

    assert.deepEqual(
      loaded.map((plugin) => plugin.id),
      ["interface"]
    );
  } finally {
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true
    });
  }
});

test("runtime asset loader preserves built-ins and skips a duplicate runtime plugin", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-runtime-assets-"));

  try {
    copyInterfaceRuntimeSource(temporaryRoot);

    const extraPluginPath = path.join(temporaryRoot, "extra-plugin.js");
    const duplicatePluginPath = path.join(temporaryRoot, "duplicate-plugin.js");
    fs.writeFileSync(extraPluginPath, "export default { id: 'extra', name: 'Extra', setup() {} };");
    fs.writeFileSync(duplicatePluginPath, "export default { id: 'interface', name: 'Duplicate', setup() {} };");

    const logs = [];
    const runtimeAssetsModule = await import(
      `${pathToFileURL(path.join(temporaryRoot, "src", "renderer", "runtime-assets.js")).toString()}?test=${Date.now()}`
    );
    const loaded = await runtimeAssetsModule.loadRuntimePluginModules({
      runtimeAssets: {
        async getPlugins() {
          return [
            {
              path: extraPluginPath,
              moduleUrl: pathToFileURL(extraPluginPath).toString(),
              mtimeMs: 1
            },
            {
              path: duplicatePluginPath,
              moduleUrl: pathToFileURL(duplicatePluginPath).toString(),
              mtimeMs: 1
            }
          ];
        }
      },
      logClient(source, message, details) {
        logs.push({
          source,
          message,
          details
        });
      }
    });

    assert.deepEqual(
      loaded.map((plugin) => plugin.id),
      ["interface", "extra"]
    );
    assert.equal(
      logs.some((entry) => entry.message === "duplicate plugin module ignored"),
      true
    );
  } finally {
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true
    });
  }
});
