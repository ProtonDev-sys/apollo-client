export function buildInterfaceStyles() {
  return `
    body.apollo-interface-v2 {
      --apollo-shell-gap: 10px;
      --apollo-shell-radius: 16px;
      --apollo-shell-radius-small: 11px;
      --apollo-focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 34%, transparent);
      background:
        radial-gradient(circle at 12% -12%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 34rem),
        radial-gradient(circle at 88% 112%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 38rem),
        var(--bg);
    }

    body.apollo-interface-v2 .app-shell {
      background: transparent;
    }

    body.apollo-interface-v2 .topbar {
      position: relative;
      z-index: 20;
      min-height: 68px;
      padding-inline: 16px;
      border-bottom-color: color-mix(in srgb, var(--border) 76%, transparent);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, transparent), color-mix(in srgb, var(--surface) 82%, transparent));
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
      backdrop-filter: blur(22px) saturate(130%);
    }

    body.apollo-interface-v2 .workspace {
      gap: var(--apollo-shell-gap);
      padding: var(--apollo-shell-gap);
      background: transparent;
    }

    body.apollo-interface-v2 .panel {
      min-width: 0;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--border) 92%, transparent);
      border-radius: var(--apollo-shell-radius);
      background:
        linear-gradient(160deg, color-mix(in srgb, var(--surface) 96%, white 1%), color-mix(in srgb, var(--surface) 92%, transparent));
      box-shadow:
        0 18px 50px rgba(0, 0, 0, 0.24),
        0 1px 0 color-mix(in srgb, white 5%, transparent) inset;
    }

    body.apollo-interface-v2 .panel-header {
      border-bottom: 1px solid var(--border-soft);
      background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 76%, transparent), transparent);
    }

    body.apollo-interface-v2 .panel-resizer {
      width: 4px;
      flex-basis: 4px;
      margin-inline: -2px;
      z-index: 4;
    }

    body.apollo-interface-v2 .panel-resizer::before {
      width: 2px;
      border-radius: 999px;
      opacity: 0;
      transition: opacity 160ms ease, background-color 160ms ease;
    }

    body.apollo-interface-v2 .panel-resizer:hover::before,
    body.apollo-interface-v2 .panel-resizer.is-active::before {
      opacity: 1;
    }

    body.apollo-interface-v2 .library-item,
    body.apollo-interface-v2 .track-row,
    body.apollo-interface-v2 .queue-row,
    body.apollo-interface-v2 .artist-search-item {
      border-bottom-color: color-mix(in srgb, var(--border-soft) 86%, transparent);
    }

    body.apollo-interface-v2 .library-item-main,
    body.apollo-interface-v2 .track-main-button,
    body.apollo-interface-v2 .queue-main {
      border-radius: var(--apollo-shell-radius-small);
    }

    body.apollo-interface-v2 .library-item:hover,
    body.apollo-interface-v2 .library-item:focus-within,
    body.apollo-interface-v2 .track-row:hover .track-main-button,
    body.apollo-interface-v2 .track-main-button:focus-visible,
    body.apollo-interface-v2 .queue-row:hover,
    body.apollo-interface-v2 .queue-row.is-selected {
      background: transparent;
    }

    body.apollo-interface-v2 .library-item:hover .library-item-main,
    body.apollo-interface-v2 .library-item:focus-within .library-item-main,
    body.apollo-interface-v2 .track-row:hover .track-main-button,
    body.apollo-interface-v2 .track-main-button:focus-visible,
    body.apollo-interface-v2 .queue-row:hover {
      background: color-mix(in srgb, var(--surface-3) 82%, transparent);
      border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
    }

    body.apollo-interface-v2 .library-item.is-active .library-item-main,
    body.apollo-interface-v2 .track-row.is-active .track-main-button,
    body.apollo-interface-v2 .queue-row.is-current {
      background:
        linear-gradient(90deg, color-mix(in srgb, var(--accent) 84%, white 4%) 0 4px, transparent 4px),
        linear-gradient(135deg, color-mix(in srgb, var(--accent) 15%, var(--surface-2)), color-mix(in srgb, var(--surface-2) 94%, transparent));
      border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    }

    body.apollo-interface-v2 .item-art,
    body.apollo-interface-v2 .track-art,
    body.apollo-interface-v2 .now-playing-art,
    body.apollo-interface-v2 .detail-art,
    body.apollo-interface-v2 .queue-play,
    body.apollo-interface-v2 .library-item-menu,
    body.apollo-interface-v2 .track-menu-button,
    body.apollo-interface-v2 .queue-remove-button,
    body.apollo-interface-v2 .like-button,
    body.apollo-interface-v2 .now-playing-icon-button,
    body.apollo-interface-v2 .icon-button,
    body.apollo-interface-v2 .modal-dialog,
    body.apollo-interface-v2 .track-menu-popover,
    body.apollo-interface-v2 .playlist-menu-popover,
    body.apollo-interface-v2 .queue-menu-popover,
    body.apollo-interface-v2 .now-playing-share-menu {
      border-radius: var(--apollo-shell-radius-small);
    }

    body.apollo-interface-v2 .detail-tab,
    body.apollo-interface-v2 .secondary-button,
    body.apollo-interface-v2 .primary-button,
    body.apollo-interface-v2 .text-button,
    body.apollo-interface-v2 .topbar-auth-button {
      border-radius: 999px;
    }

    body.apollo-interface-v2 .detail-art {
      overflow: hidden;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3);
    }

    body.apollo-interface-v2 .detail-copy h2 {
      line-height: 0.98;
      letter-spacing: -0.035em;
    }

    body.apollo-interface-v2 .player-bar {
      position: relative;
      z-index: 21;
      min-height: 96px;
      margin: 0 var(--apollo-shell-gap) var(--apollo-shell-gap);
      padding: 12px 16px;
      border: 1px solid color-mix(in srgb, var(--border) 92%, transparent);
      border-radius: var(--apollo-shell-radius);
      background:
        linear-gradient(145deg, color-mix(in srgb, var(--surface) 94%, white 1%), color-mix(in srgb, var(--surface-2) 91%, transparent));
      box-shadow: 0 20px 52px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(24px) saturate(135%);
    }

    body.apollo-interface-v2 .progress-track::before {
      height: 5px;
      border-radius: 999px;
    }

    body.apollo-interface-v2 .progress-fill {
      border-radius: 999px;
      box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 42%, transparent);
    }

    body.apollo-interface-v2 button:focus-visible,
    body.apollo-interface-v2 input:focus-visible,
    body.apollo-interface-v2 textarea:focus-visible,
    body.apollo-interface-v2 select:focus-visible,
    body.apollo-interface-v2 [tabindex]:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 86%, white 8%);
      outline-offset: 2px;
      box-shadow: var(--apollo-focus-ring);
    }

    .apollo-interface-controls {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .apollo-interface-status,
    .apollo-interface-command-button {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 11px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface-2) 86%, transparent);
      color: var(--muted);
      font-size: 0.73rem;
      font-weight: 650;
      white-space: nowrap;
      transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
    }

    .apollo-interface-status:hover,
    .apollo-interface-status:focus-visible,
    .apollo-interface-command-button:hover,
    .apollo-interface-command-button:focus-visible {
      color: var(--text);
      border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
      background: color-mix(in srgb, var(--accent) 11%, var(--surface-2));
      transform: translateY(-1px);
    }

    .apollo-interface-status-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--muted-2);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--muted-2) 13%, transparent);
    }

    .apollo-interface-status[data-kind="online"] .apollo-interface-status-dot {
      background: #53d58b;
      box-shadow: 0 0 0 4px rgba(83, 213, 139, 0.14);
    }

    .apollo-interface-status[data-kind="active"] .apollo-interface-status-dot {
      background: var(--accent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
    }

    .apollo-interface-status[data-kind="busy"] .apollo-interface-status-dot {
      background: #f1b84b;
      box-shadow: 0 0 0 4px rgba(241, 184, 75, 0.14);
      animation: apollo-interface-pulse 1.15s ease-in-out infinite alternate;
    }

    .apollo-interface-status[data-kind="offline"] .apollo-interface-status-dot,
    .apollo-interface-status[data-kind="locked"] .apollo-interface-status-dot {
      background: #ef6a67;
      box-shadow: 0 0 0 4px rgba(239, 106, 103, 0.14);
    }

    .apollo-interface-keycap {
      min-width: 24px;
      min-height: 20px;
      display: inline-grid;
      place-items: center;
      padding-inline: 5px;
      border: 1px solid var(--border);
      border-bottom-color: color-mix(in srgb, var(--border) 58%, black);
      border-radius: 6px;
      background: color-mix(in srgb, var(--surface-3) 94%, transparent);
      color: var(--muted-2);
      font-family: var(--font-mono);
      font-size: 0.61rem;
      line-height: 1;
    }

    .apollo-interface-live-region {
      position: fixed;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .apollo-command-layer {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: grid;
      place-items: start center;
      padding: min(14vh, 128px) 18px 18px;
      background: rgba(0, 0, 0, 0.68);
      backdrop-filter: blur(18px) saturate(115%);
      opacity: 0;
      visibility: hidden;
      transition: opacity 150ms ease, visibility 150ms ease;
    }

    .apollo-command-layer.is-open {
      opacity: 1;
      visibility: visible;
    }

    .apollo-command-dialog {
      width: min(680px, 100%);
      max-height: min(680px, 76vh);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--border) 92%, transparent);
      border-radius: 20px;
      background:
        linear-gradient(155deg, color-mix(in srgb, var(--surface) 98%, white 1%), color-mix(in srgb, var(--surface-2) 96%, transparent));
      box-shadow: 0 36px 100px rgba(0, 0, 0, 0.58);
      transform: translateY(-10px) scale(0.985);
      transition: transform 160ms ease;
    }

    .apollo-command-layer.is-open .apollo-command-dialog {
      transform: none;
    }

    .apollo-command-search-shell {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 11px;
      min-height: 64px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
    }

    .apollo-command-search-icon {
      width: 18px;
      height: 18px;
      color: var(--muted);
    }

    .apollo-command-search {
      min-width: 0;
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
      font-size: 1rem;
    }

    .apollo-command-search::placeholder {
      color: var(--muted-2);
    }

    .apollo-command-results {
      min-height: 100px;
      overflow-y: auto;
      padding: 8px;
    }

    .apollo-command-group-label {
      margin: 8px 10px 6px;
      color: var(--muted-2);
      font-family: var(--font-mono);
      font-size: 0.66rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .apollo-command-item {
      width: 100%;
      min-height: 58px;
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 9px 11px;
      border: 1px solid transparent;
      border-radius: 12px;
      text-align: left;
    }

    .apollo-command-item:hover,
    .apollo-command-item:focus-visible,
    .apollo-command-item.is-active {
      border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
      background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
    }

    .apollo-command-item-icon {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-3);
      color: var(--accent);
      font-size: 0.92rem;
      font-weight: 800;
    }

    .apollo-command-item-copy {
      min-width: 0;
    }

    .apollo-command-item-label,
    .apollo-command-item-description {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .apollo-command-item-label {
      color: var(--text);
      font-size: 0.86rem;
      font-weight: 700;
    }

    .apollo-command-item-description {
      margin-top: 3px;
      color: var(--muted);
      font-size: 0.72rem;
    }

    .apollo-command-empty {
      min-height: 150px;
      display: grid;
      place-items: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
    }

    .apollo-command-footer {
      min-height: 44px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 14px;
      border-top: 1px solid var(--border);
      color: var(--muted-2);
      font-size: 0.67rem;
    }

    .apollo-shortcut-sheet {
      display: grid;
      gap: 8px;
      padding: 10px;
    }

    .apollo-shortcut-row {
      min-height: 44px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border-soft);
    }

    .apollo-shortcut-row span:first-child {
      color: var(--text);
      font-size: 0.82rem;
    }

    .apollo-shortcut-keys {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    body.apollo-density-compact .topbar {
      min-height: 58px;
      padding-block: 7px;
    }

    body.apollo-density-compact .panel-header {
      padding-block: 11px 8px;
    }

    body.apollo-density-compact .library-item-main {
      min-height: 54px;
      padding: 7px 10px;
    }

    body.apollo-density-compact .item-art {
      width: 38px;
      height: 38px;
    }

    body.apollo-density-compact .track-main-button {
      min-height: 56px;
      padding: 6px 10px;
      grid-template-columns: minmax(18px, auto) minmax(0, 1fr) minmax(44px, auto);
    }

    body.apollo-density-compact .track-leading {
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 9px;
    }

    body.apollo-density-compact .track-art {
      width: 40px;
      height: 40px;
    }

    body.apollo-density-compact .player-bar {
      min-height: 82px;
      padding-block: 8px;
    }

    @keyframes apollo-interface-pulse {
      from {
        opacity: 0.72;
        transform: scale(0.9);
      }
      to {
        opacity: 1;
        transform: scale(1.08);
      }
    }

    @media (max-width: 1180px) {
      .apollo-interface-status-label {
        display: none;
      }

      .apollo-interface-status {
        width: 34px;
        justify-content: center;
        padding: 0;
      }
    }

    @media (max-width: 980px) {
      body.apollo-interface-v2 {
        --apollo-shell-gap: 6px;
        --apollo-shell-radius: 12px;
      }

      body.apollo-interface-v2 .workspace {
        padding: var(--apollo-shell-gap);
      }

      body.apollo-interface-v2 .player-bar {
        margin-inline: var(--apollo-shell-gap);
        margin-bottom: var(--apollo-shell-gap);
      }

      .apollo-interface-command-button .apollo-interface-command-label {
        display: none;
      }

      .apollo-interface-command-button {
        width: 34px;
        justify-content: center;
        padding: 0;
      }

      .apollo-command-layer {
        place-items: end stretch;
        padding: 10px;
      }

      .apollo-command-dialog {
        width: 100%;
        max-height: min(78vh, 680px);
        border-radius: 18px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .apollo-command-layer,
      .apollo-command-dialog,
      .apollo-interface-status,
      .apollo-interface-command-button,
      body.apollo-interface-v2 .panel-resizer::before {
        transition: none !important;
      }

      .apollo-interface-status[data-kind="busy"] .apollo-interface-status-dot {
        animation: none;
      }
    }

    @media (prefers-contrast: more) {
      body.apollo-interface-v2 .panel,
      body.apollo-interface-v2 .player-bar,
      .apollo-interface-status,
      .apollo-interface-command-button,
      .apollo-command-dialog {
        border-color: currentColor;
      }
    }
  `;
}
