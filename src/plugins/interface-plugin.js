import { buildInterfaceStyles } from "./interface-styles.js";
import {
  deriveInterfaceStatus,
  filterInterfaceCommands,
  isEditableInterfaceTarget,
  persistInterfacePreferences,
  readInterfacePreferences
} from "./interface-state.js";

function createElement(documentRef, tagName, className = "", attributes = {}) {
  const element = documentRef.createElement(tagName);
  if (className) {
    element.className = className;
  }

  Object.entries(attributes).forEach(([name, value]) => {
    if (value !== null && value !== undefined) {
      element.setAttribute(name, String(value));
    }
  });
  return element;
}

function getPrimaryModifier(windowRef) {
  return String(windowRef?.navigator?.platform || "").toLowerCase().includes("mac")
    ? "⌘"
    : "Ctrl";
}

function syncAccessibleSelection(documentRef) {
  documentRef.querySelectorAll(".library-item-main[aria-current]").forEach((element) => {
    element.removeAttribute("aria-current");
  });
  documentRef.querySelector(".library-item.is-active .library-item-main")
    ?.setAttribute("aria-current", "true");

  documentRef.querySelectorAll(".track-main-button").forEach((button) => {
    const isActive = button.closest(".track-row")?.classList.contains("is-active");
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (isActive) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  documentRef.querySelector("#track-list")?.setAttribute("aria-label", "Tracks");
}

const interfacePlugin = {
  id: "interface",
  name: "Interface",

  setup(api) {
    const runtime = api.apollo;
    const documentRef = runtime?.document || document;
    const windowRef = runtime?.window || window;
    const storage = runtime?.localStorage || windowRef.localStorage;
    const body = documentRef.body;
    const topbarRight = documentRef.querySelector(".topbar-side--right");

    if (!body || !topbarRight) {
      return () => {};
    }

    let preferences = readInterfacePreferences(storage);
    let activeCommandIndex = 0;
    let previousFocus = null;
    let lastAnnouncement = "";

    const styleElement = createElement(documentRef, "style");
    styleElement.id = "apollo-interface-v2-style";
    styleElement.textContent = buildInterfaceStyles();
    documentRef.head.append(styleElement);

    body.classList.add("apollo-interface-v2");
    body.classList.toggle("apollo-density-compact", preferences.density === "compact");

    const controls = createElement(documentRef, "div", "apollo-interface-controls");
    const statusButton = createElement(documentRef, "button", "apollo-interface-status", {
      type: "button",
      "aria-label": "Open Apollo commands"
    });
    const statusDot = createElement(documentRef, "span", "apollo-interface-status-dot", {
      "aria-hidden": "true"
    });
    const statusLabel = createElement(documentRef, "span", "apollo-interface-status-label");
    statusButton.append(statusDot, statusLabel);

    const commandButton = createElement(documentRef, "button", "apollo-interface-command-button", {
      type: "button",
      "aria-label": "Open command menu"
    });
    const commandLabel = createElement(documentRef, "span", "apollo-interface-command-label");
    commandLabel.textContent = "Commands";
    const commandKey = createElement(documentRef, "kbd", "apollo-interface-keycap");
    commandKey.textContent = `${getPrimaryModifier(windowRef)} K`;
    commandButton.append(commandLabel, commandKey);

    controls.append(statusButton, commandButton);
    topbarRight.prepend(controls);

    const liveRegion = createElement(documentRef, "p", "apollo-interface-live-region", {
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    });
    body.append(liveRegion);

    const layer = createElement(documentRef, "div", "apollo-command-layer", {
      "aria-hidden": "true"
    });
    const dialog = createElement(documentRef, "section", "apollo-command-dialog", {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "apollo-command-title",
      tabindex: "-1"
    });
    const searchShell = createElement(documentRef, "div", "apollo-command-search-shell");
    const dialogTitle = createElement(documentRef, "h2", "apollo-interface-live-region", {
      id: "apollo-command-title"
    });
    dialogTitle.textContent = "Apollo command menu";
    const searchIcon = createElement(documentRef, "span", "apollo-command-search-icon", {
      "aria-hidden": "true"
    });
    searchIcon.textContent = "⌕";
    const searchInput = createElement(documentRef, "input", "apollo-command-search", {
      type: "search",
      "aria-label": "Search Apollo commands",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Search Apollo commands"
    });
    const escapeKey = createElement(documentRef, "kbd", "apollo-interface-keycap");
    escapeKey.textContent = "Esc";
    searchShell.append(dialogTitle, searchIcon, searchInput, escapeKey);

    const results = createElement(documentRef, "div", "apollo-command-results", {
      "aria-label": "Apollo commands"
    });
    const footer = createElement(documentRef, "div", "apollo-command-footer");
    footer.innerHTML = "<span>↑ ↓ navigate · Enter run</span><span>/ search · ? commands</span>";
    dialog.append(searchShell, results, footer);
    layer.append(dialog);
    body.append(layer);

    const getState = () => runtime?.snapshots?.getState?.() || {};
    const getPlayback = () => runtime?.playback?.getSnapshot?.() || {};

    function closePalette({ restoreFocus = true } = {}) {
      if (!layer.classList.contains("is-open")) {
        return;
      }

      layer.classList.remove("is-open");
      layer.setAttribute("aria-hidden", "true");
      searchInput.value = "";
      activeCommandIndex = 0;

      if (restoreFocus) {
        previousFocus?.focus?.();
      }
      previousFocus = null;
    }

    function focusSearch() {
      closePalette({
        restoreFocus: false
      });
      runtime?.dom?.searchInput?.focus?.();
      runtime?.dom?.searchInput?.select?.();
    }

    function ensureDetailPanelVisible() {
      if (getState().layout?.hidden?.detail) {
        runtime?.ui?.togglePanel?.("detail");
      }
    }

    function buildCommands() {
      const state = getState();
      const compact = preferences.density === "compact";
      return [
        {
          id: "search",
          group: "Navigate",
          icon: "⌕",
          label: "Focus search",
          description: "Search the library and enabled providers.",
          shortcut: "/",
          keywords: ["find", "track", "artist"],
          run: focusSearch
        },
        {
          id: "queue",
          group: "Navigate",
          icon: "Q",
          label: "Open queue",
          description: "Show upcoming playback in the detail panel.",
          keywords: ["next", "playing"],
          run() {
            closePalette({
              restoreFocus: false
            });
            ensureDetailPanelVisible();
            runtime?.ui?.setActiveDetailTab?.("queue");
          }
        },
        {
          id: "refresh",
          group: "Library",
          icon: "↻",
          label: "Refresh library",
          description: "Reload tracks, playlists, and server health.",
          keywords: ["sync", "server", "reload"],
          async run() {
            closePalette({
              restoreFocus: false
            });
            await runtime?.library?.refreshLibrary?.({
              force: true,
              reason: "command-palette"
            });
          }
        },
        {
          id: "create-playlist",
          group: "Library",
          icon: "+",
          label: "Create playlist",
          description: "Open the playlist editor.",
          keywords: ["new", "collection"],
          run() {
            closePalette({
              restoreFocus: false
            });
            runtime?.ui?.openPlaylistModal?.();
          }
        },
        {
          id: "sidebar",
          group: "Layout",
          icon: "L",
          label: state.layout?.hidden?.sidebar ? "Show library panel" : "Hide library panel",
          description: "Toggle the left library and playlist panel.",
          keywords: ["sidebar", "playlists"],
          run() {
            closePalette({
              restoreFocus: false
            });
            runtime?.ui?.togglePanel?.("sidebar");
          }
        },
        {
          id: "detail",
          group: "Layout",
          icon: "D",
          label: state.layout?.hidden?.detail ? "Show detail panel" : "Hide detail panel",
          description: "Toggle track details, queue, and plugins.",
          keywords: ["right", "lyrics"],
          run() {
            closePalette({
              restoreFocus: false
            });
            runtime?.ui?.togglePanel?.("detail");
          }
        },
        {
          id: "density",
          group: "Layout",
          icon: compact ? "C" : "S",
          label: compact ? "Use comfortable density" : "Use compact density",
          description: compact ? "Restore larger rows." : "Fit more tracks on screen.",
          keywords: ["spacing", "rows"],
          run() {
            preferences = {
              ...preferences,
              density: compact ? "comfortable" : "compact"
            };
            persistInterfacePreferences(storage, preferences);
            body.classList.toggle("apollo-density-compact", preferences.density === "compact");
            renderCommands();
          }
        },
        {
          id: "reset-layout",
          group: "Layout",
          icon: "R",
          label: "Reset panel layout",
          description: "Restore default panel order, size, and visibility.",
          keywords: ["defaults", "resize"],
          run() {
            closePalette({
              restoreFocus: false
            });
            runtime?.ui?.resetLayout?.();
          }
        },
        {
          id: "settings",
          group: "Application",
          icon: "⚙",
          label: "Open settings",
          description: "Configure server, playback, search, and integrations.",
          keywords: ["preferences", "configuration"],
          run() {
            closePalette({
              restoreFocus: false
            });
            runtime?.ui?.openSettingsModal?.();
          }
        }
      ];
    }

    function executeCommand(command) {
      try {
        const result = command?.run?.();
        result?.catch?.((error) => {
          runtime?.ui?.setStatusMessage?.(error?.message || "Command failed.");
        });
      } catch (error) {
        runtime?.ui?.setStatusMessage?.(error?.message || "Command failed.");
      }
    }

    function markActiveCommand(index) {
      activeCommandIndex = index;
      results.querySelectorAll(".apollo-command-item").forEach((entry, entryIndex) => {
        const isActive = entryIndex === activeCommandIndex;
        entry.classList.toggle("is-active", isActive);
        if (isActive) {
          entry.setAttribute("aria-current", "true");
        } else {
          entry.removeAttribute("aria-current");
        }
      });
    }

    function renderCommands() {
      const commands = filterInterfaceCommands(buildCommands(), searchInput.value);
      results.replaceChildren();

      if (!commands.length) {
        const empty = createElement(documentRef, "div", "apollo-command-empty");
        empty.textContent = "No matching Apollo commands.";
        results.append(empty);
        activeCommandIndex = 0;
        return;
      }

      activeCommandIndex = Math.max(0, Math.min(activeCommandIndex, commands.length - 1));
      let lastGroup = "";

      commands.forEach((command, index) => {
        if (command.group !== lastGroup) {
          const groupLabel = createElement(documentRef, "p", "apollo-command-group-label");
          groupLabel.textContent = command.group;
          results.append(groupLabel);
          lastGroup = command.group;
        }

        const button = createElement(documentRef, "button", "apollo-command-item", {
          type: "button",
          "data-command-id": command.id
        });
        const icon = createElement(documentRef, "span", "apollo-command-item-icon", {
          "aria-hidden": "true"
        });
        icon.textContent = command.icon;
        const copy = createElement(documentRef, "span", "apollo-command-item-copy");
        const label = createElement(documentRef, "span", "apollo-command-item-label");
        label.textContent = command.label;
        const description = createElement(documentRef, "span", "apollo-command-item-description");
        description.textContent = command.description;
        copy.append(label, description);

        const shortcut = createElement(documentRef, "span");
        if (command.shortcut) {
          const keycap = createElement(documentRef, "kbd", "apollo-interface-keycap");
          keycap.textContent = command.shortcut;
          shortcut.append(keycap);
        }

        button.append(icon, copy, shortcut);
        button.addEventListener("mouseenter", () => markActiveCommand(index));
        button.addEventListener("focus", () => markActiveCommand(index));
        button.addEventListener("click", () => executeCommand(command));
        results.append(button);
      });

      markActiveCommand(activeCommandIndex);
      results.querySelector(".apollo-command-item.is-active")
        ?.scrollIntoView?.({
          block: "nearest"
        });
    }

    function openPalette() {
      previousFocus = documentRef.activeElement;
      activeCommandIndex = 0;
      searchInput.value = "";
      layer.classList.add("is-open");
      layer.setAttribute("aria-hidden", "false");
      renderCommands();
      windowRef.setTimeout(() => searchInput.focus(), 0);
    }

    function syncInterface() {
      const status = deriveInterfaceStatus(getState(), getPlayback());
      statusButton.dataset.kind = status.kind;
      statusLabel.textContent = status.label;
      statusButton.title = status.detail;
      statusButton.setAttribute(
        "aria-label",
        `${status.label}. ${status.detail}. Open Apollo commands.`
      );

      const announcement = `${status.label}. ${status.detail}`.trim();
      if (announcement !== lastAnnouncement) {
        lastAnnouncement = announcement;
        liveRegion.textContent = announcement;
      }

      syncAccessibleSelection(documentRef);
      if (layer.classList.contains("is-open")) {
        renderCommands();
      }
    }

    function handleDocumentKeydown(event) {
      const primaryModifier = event.ctrlKey || event.metaKey;

      if (layer.classList.contains("is-open")) {
        const commands = filterInterfaceCommands(buildCommands(), searchInput.value);

        if (event.key === "Escape") {
          event.preventDefault();
          closePalette();
        } else if (event.key === "ArrowDown" && commands.length) {
          event.preventDefault();
          markActiveCommand((activeCommandIndex + 1) % commands.length);
        } else if (event.key === "ArrowUp" && commands.length) {
          event.preventDefault();
          markActiveCommand((activeCommandIndex - 1 + commands.length) % commands.length);
        } else if (event.key === "Enter" && commands[activeCommandIndex]) {
          event.preventDefault();
          executeCommand(commands[activeCommandIndex]);
        } else if (event.key === "Tab") {
          const focusable = Array.from(dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ));
          if (!focusable.length) {
            return;
          }

          const currentIndex = focusable.indexOf(documentRef.activeElement);
          const nextIndex = event.shiftKey
            ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
            : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
          event.preventDefault();
          focusable[nextIndex].focus();
        }
        return;
      }

      if (primaryModifier && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      } else if (event.key === "?" && !isEditableInterfaceTarget(event.target)) {
        event.preventDefault();
        openPalette();
      } else if (
        event.key === "/"
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !isEditableInterfaceTarget(event.target)
      ) {
        event.preventDefault();
        focusSearch();
      }
    }

    function handleLayerPointerDown(event) {
      if (event.target === layer) {
        closePalette();
      }
    }

    function handleSearchInput() {
      activeCommandIndex = 0;
      renderCommands();
    }

    statusButton.addEventListener("click", openPalette);
    commandButton.addEventListener("click", openPalette);
    layer.addEventListener("pointerdown", handleLayerPointerDown);
    searchInput.addEventListener("input", handleSearchInput);
    documentRef.addEventListener("keydown", handleDocumentKeydown, true);

    const unsubscribeEvents = [
      api.on("app:render", syncInterface),
      api.on("app:ready", syncInterface),
      api.on("playback:state", syncInterface),
      api.on("playback:track-changed", syncInterface),
      api.on("auth:changed", syncInterface),
      api.on("library:refresh:start", syncInterface),
      api.on("library:refresh:success", syncInterface),
      api.on("library:refresh:error", syncInterface)
    ];

    syncInterface();

    return () => {
      unsubscribeEvents.forEach((unsubscribe) => unsubscribe?.());
      documentRef.removeEventListener("keydown", handleDocumentKeydown, true);
      layer.removeEventListener("pointerdown", handleLayerPointerDown);
      searchInput.removeEventListener("input", handleSearchInput);
      controls.remove();
      layer.remove();
      liveRegion.remove();
      styleElement.remove();
      body.classList.remove("apollo-interface-v2", "apollo-density-compact");
    };
  }
};

export default interfacePlugin;
