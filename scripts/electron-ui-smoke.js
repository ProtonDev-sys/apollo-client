const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIRECTORY = process.env.APOLLO_UI_SMOKE_OUTPUT
  ? path.resolve(process.env.APOLLO_UI_SMOKE_OUTPUT)
  : path.join(PROJECT_ROOT, "test-results");
const SCREENSHOT_PATH = path.join(OUTPUT_DIRECTORY, "apollo-client-ui.png");
const USER_DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), "apollo-client-ui-smoke-"));
const SERVER_URL = "http://127.0.0.1:9";

process.env.APOLLO_SERVER_URL = SERVER_URL;
process.env.APOLLO_CONFIG_PATH = path.join(USER_DATA_PATH, "apollo.config.json");

app.setPath("userData", USER_DATA_PATH);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("no-sandbox");

function registerIpcHandlers() {
  ipcMain.on("app:get-runtime-info-sync", (event) => {
    event.returnValue = {
      appVersion: "0.1.5-smoke",
      appPath: PROJECT_ROOT,
      userDataPath: USER_DATA_PATH,
      execPath: process.execPath,
      execDirectory: path.dirname(process.execPath),
      currentWorkingDirectory: PROJECT_ROOT,
      logPath: path.join(USER_DATA_PATH, "apollo-client-smoke.log"),
      isPackaged: false
    };
  });

  const handlers = {
    "app:get-pending-client-update": () => null,
    "app:ack-client-update-required": () => true,
    "app:open-external-url": () => true,
    "window-controls:get-state": () => ({
      isFocused: true,
      isMaximized: false
    }),
    "discord-presence:configure": () => ({
      ok: true
    }),
    "discord-social:get-state": () => ({
      available: false,
      helperRunning: false,
      authenticated: false,
      ready: false,
      authInProgress: false,
      message: "Unavailable in UI smoke test."
    }),
    "discord-social:start-auth": () => ({
      available: false
    }),
    "discord-social:sign-out": () => ({
      available: false
    }),
    "discord-social:list-friends": () => [],
    "discord-social:send-activity-invite": () => ({
      ok: false
    }),
    "listen-along:get-state": () => ({
      available: false,
      running: false,
      port: 0,
      advertisedHosts: [],
      message: "Unavailable in UI smoke test."
    }),
    "listen-along:publish-session": () => ({
      available: false
    }),
    "listen-along:clear-session": () => ({
      available: false
    })
  };

  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });
}

async function waitForCondition(window, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;

  while (Date.now() < deadline) {
    lastValue = await window.webContents.executeJavaScript(expression, true).catch(() => null);
    if (lastValue) {
      return lastValue;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for UI condition: ${expression}. Last value: ${lastValue}`);
}

async function run() {
  registerIpcHandlers();
  await app.whenReady();

  const rendererFailures = [];
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    backgroundColor: "#050505",
    webPreferences: {
      preload: path.join(PROJECT_ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    rendererFailures.push(`renderer exited: ${details.reason}`);
  });
  window.webContents.on("unresponsive", () => {
    rendererFailures.push("renderer became unresponsive");
  });

  await window.loadFile(path.join(PROJECT_ROOT, "src", "index.html"));

  await waitForCondition(
    window,
    `Boolean(
      document.body.classList.contains("apollo-interface-v2")
      && document.querySelector(".apollo-interface-status")
      && document.querySelector(".apollo-interface-command-button")
    )`
  );

  window.show();
  window.focus();
  window.webContents.focus();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const initialSnapshot = await window.webContents.executeJavaScript(`
    (() => {
      const status = document.querySelector(".apollo-interface-status");
      const commandButton = document.querySelector(".apollo-interface-command-button");
      commandButton.click();

      return {
        hasInterfaceClass: document.body.classList.contains("apollo-interface-v2"),
        statusKind: status?.dataset.kind || "",
        statusLabel: status?.textContent?.trim() || "",
        commandOpen: document.querySelector(".apollo-command-layer")?.classList.contains("is-open") || false,
        commandCount: document.querySelectorAll(".apollo-command-item").length,
        activeTrackButtonsWithPressedState: document.querySelectorAll(".track-main-button[aria-pressed]").length
      };
    })()
  `, true);

  assert.equal(initialSnapshot.hasInterfaceClass, true);
  assert.equal(initialSnapshot.commandOpen, true);
  assert.ok(initialSnapshot.commandCount >= 8, "expected the built-in command menu");
  assert.ok(
    ["offline", "online", "locked", "busy", "active"].includes(initialSnapshot.statusKind),
    `unexpected interface status: ${initialSnapshot.statusKind}`
  );
  assert.ok(initialSnapshot.statusLabel, "expected a visible status label");

  const densitySnapshot = await window.webContents.executeJavaScript(`
    (() => {
      const densityCommand = document.querySelector('[data-command-id="density"]');
      densityCommand?.click();
      return {
        commandFound: Boolean(densityCommand),
        compact: document.body.classList.contains("apollo-density-compact"),
        storedPreferences: localStorage.getItem("apollo-interface-preferences-v1")
      };
    })()
  `, true);

  assert.equal(densitySnapshot.commandFound, true);
  assert.equal(densitySnapshot.compact, true);
  assert.match(String(densitySnapshot.storedPreferences || ""), /compact/);

  const keyboardSnapshot = await window.webContents.executeJavaScript(`
    (() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true
      }));
      const closed = !document.querySelector(".apollo-command-layer")?.classList.contains("is-open");

      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
      const reopened = document.querySelector(".apollo-command-layer")?.classList.contains("is-open") || false;
      const searchFocused = document.activeElement?.classList.contains("apollo-command-search") || false;

      return {
        closed,
        reopened,
        searchFocused
      };
    })()
  `, true);

  assert.equal(keyboardSnapshot.closed, true);
  assert.equal(keyboardSnapshot.reopened, true);

  const focusSnapshot = await waitForCondition(
    window,
    `document.activeElement?.classList.contains("apollo-command-search") || false`,
    5000
  );
  assert.equal(Boolean(keyboardSnapshot.searchFocused || focusSnapshot), true);

  fs.mkdirSync(OUTPUT_DIRECTORY, {
    recursive: true
  });
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(SCREENSHOT_PATH, screenshot.toPNG());

  assert.ok(fs.statSync(SCREENSHOT_PATH).size > 1000, "expected a non-empty UI screenshot");
  assert.deepEqual(rendererFailures, []);

  process.stdout.write(`${JSON.stringify({
    screenshot: SCREENSHOT_PATH,
    status: initialSnapshot.statusKind,
    commands: initialSnapshot.commandCount
  })}\n`);

  window.destroy();
}

run()
  .then(() => {
    fs.rmSync(USER_DATA_PATH, {
      recursive: true,
      force: true
    });
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fs.rmSync(USER_DATA_PATH, {
      recursive: true,
      force: true
    });
    app.exit(1);
  });