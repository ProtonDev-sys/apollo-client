# Apollo Client Architecture

Apollo Client uses an Electron main process, a constrained preload bridge, and a renderer application. The renderer remains the largest subsystem, so changes should move deterministic logic into focused modules before expanding `src/renderer.js`.

## Process boundaries

- `main.js` owns the Electron application lifecycle, windows, protocol handling, native integrations, and privileged IPC handlers.
- `preload.js` exposes the minimum desktop bridge used by the renderer. Renderer code must not import Node.js or Electron modules directly.
- `src/renderer.js` coordinates application state, view rendering, playback, server calls, and feature lifecycles.
- `src/plugin-host.js` loads trusted renderer plugins transactionally. Failed setup must not leave registrations, subscriptions, or cleanup state behind.

## Renderer modules

Deterministic logic belongs under `src/renderer/` so it can be tested without Electron or a DOM.

- `settings.js` normalizes connection, playback, search, download, and integration settings.
- `storage.js` reads and writes durable client state.
- `transport.js` owns Apollo API request behavior and connection/authentication error classification.
- `track-model.js` owns track metadata normalization, provider identifiers, identity matching, release-date validation, equivalence, and playability decisions.
- `polling-controller.js` owns non-overlapping periodic task lifecycles.
- `runtime-assets.js` applies themes and imports runtime plugins.
- `icons.js` and `formatters.js` provide presentation helpers without application state.

New renderer logic should stay in `src/renderer.js` only when it directly coordinates several subsystems or manipulates live UI state. Parsing, normalization, scoring, scheduling, and other pure decisions should be extracted with tests.

## Track-model invariants

Track identity is not defined by a single provider key. Apollo compares tracks in this order:

1. identical client keys;
2. a matching normalized provider identifier;
3. normalized title and artist, with no more than three seconds of duration difference when both durations are known.

Remote tracks may be playable without a direct media URL when their provider, title, and artist allow the Apollo server to resolve a playback source. Generic `remote` and `listen-along` records still require an explicit source.

Release dates are canonicalized to `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Invalid calendar dates are discarded rather than persisted as apparently valid metadata.

## Listen-along lifecycle

Listen-along prefers its WebRTC data channel and audio stream. The HTTP session endpoint is a fallback, not a one-shot probe.

- A direct connection timeout starts a one-second fallback poll.
- Poll executions never overlap.
- Opening the WebRTC data channel stops fallback polling.
- Leaving or ending the joined session stops polling and clears peer state.
- Hosted audio is captured from the active playback deck so crossfades cannot leave the listener attached to an inactive element.

Any new exit path for joined sessions must call the shared session teardown rather than clearing individual fields.

## Validation gates

Run the following before merging renderer or desktop changes:

```sh
npm run check:syntax
npm test
npm run audit:deps
npm run audit:all
```

CI additionally renders and drives the Electron interface under Xvfb, performs an unpacked Linux build, and checks the packaged `app.asar`. Architectural regression tests enforce extracted boundaries and prevent `src/renderer.js` from silently returning to its previous size.
