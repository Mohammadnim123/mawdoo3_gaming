# Game Contract — createGame-v1

This document is the single source of truth for the boundary between the
**starter template** (infrastructure, versioned, hand-written) and the
**generated game** (gameplay, AI-written). It is injected verbatim into the
code-generation prompt and enforced by the quality gate.

## Files a generated game provides

| File       | Required | Content                                        |
|------------|----------|------------------------------------------------|
| `game.js`  | yes      | Plain-script JavaScript. All gameplay logic.    |
| `game.css` | no       | Game-specific styling only.                     |

Everything else in the bundle (`index.html`, `engine.js`, `engine.css`, the
embedded manifest) comes from the template and must never be re-implemented
by the game.

## Entry point

`game.js` must assign a single global factory:

```js
window.createGame = function ({ mount, sdk }) {
  // Build the entire game inside `mount` (a full-viewport <div>).
  // Use canvas or DOM elements — your choice per the blueprint.

  sdk.ready(); // call once the first frame is visible

  return {
    destroy() {
      // OPTIONAL. Only for cleanup the SDK cannot track for you.
      // Timers, listeners, loops and audio created through the SDK
      // are cleaned up automatically.
    },
  };
};
```

- `game.js` is a **plain script**: no `import`/`export`, no modules, no
  `require`, and no globals other than `window.createGame`.
- `createGame` must be synchronous and must not throw.

## The SDK

The `sdk` object passed to `createGame` is the **only** allowed way to talk
to the browser for timing, events, audio, storage, and localization.

### Lifecycle & timing (auto-cleaned on destroy)

| API | Description |
|-----|-------------|
| `sdk.ready()` | Signal the game is visible; hides the loading overlay. |
| `sdk.loop(update)` | Starts a requestAnimationFrame loop. `update(dt, elapsed)` receives seconds. Returns `{ stop() }`. Auto-pauses while the tab is hidden. |
| `sdk.after(ms, fn)` | One-shot timer. Returns a `cancel()` function. |
| `sdk.every(ms, fn)` | Repeating timer. Returns a `cancel()` function. |
| `sdk.on(target, type, handler, options?)` | Event listener on `window`, `document`, or any element. Returns an `off()` function. |

### Localization (bilingual Arabic/English is mandatory)

| API | Description |
|-----|-------------|
| `sdk.lang` | Current locale: `'ar'` or `'en'`. |
| `sdk.dir` | `'rtl'` or `'ltr'` — already applied to `<html>`. |
| `sdk.t(key)` | Localized UI string for the current locale. Keys come from the blueprint's `ui_strings`. Never hard-code user-facing text. |
| `sdk.strings` | The raw strings table `{ key: { en, ar } }`. |
| `sdk.formatNumber(n)` | Formats numbers with Arabic-Indic digits in Arabic locale. Use it for every number shown to the player. |

### Gameplay helpers

| API | Description |
|-----|-------------|
| `sdk.tweaks` | Read-only numeric knobs from the blueprint (e.g. `sdk.tweaks.speed`). Consume every knob the blueprint defines — never hard-code a literal that contradicts one. |
| `sdk.rand(min, max)` / `sdk.randInt(min, max)` / `sdk.pick(array)` | Random helpers. |
| `sdk.audio.beep({ freq, duration, type, volume })` | Short synthesized sound effect. All audio resources are tracked and released automatically. |
| `sdk.storage.get(key, fallback)` / `sdk.storage.set(key, value)` | Session-scoped key/value store (e.g. best score). Not persistent. |

### Platform hooks (future save/share — already wired)

| API | Description |
|-----|-------------|
| `sdk.report(event, data)` | Posts a structured event to the host page (sandbox-safe `postMessage`). |
| `sdk.gameOver({ score, won })` | Standard end-of-game report. Call it whenever a round ends. |

## 3D games (blueprint `rendering: "webgl3d"`)

When the blueprint's `rendering` is `webgl3d`, the template ships a pinned
**Three.js r149** runtime and the page exposes the global `THREE` before
`game.js` loads. Rules for 3D game code:

- Create one `THREE.WebGLRenderer({ antialias: true })`, size it to the mount,
  and append `renderer.domElement` to `mount`. Handle resize with
  `sdk.on(window, 'resize', ...)`.
- Drive rendering with `sdk.loop((dt) => { ...; renderer.render(scene, camera); })`.
  `renderer.setAnimationLoop` is **forbidden** (the gate rejects it) — `sdk.loop`
  is how the template guarantees the loop stops on destroy.
- In `destroy()`, call `renderer.dispose()` and dispose geometries/materials you
  created.
- Keep scenes lightweight: primitive geometries (box, sphere, plane, cylinder,
  torus), `MeshStandardMaterial`/`MeshBasicMaterial` with plain colors, ambient +
  directional light, optional fog. **No external textures, models, or fonts** —
  the bundle must stay self-contained. Target ≤ 200 meshes.
- Input stays on the SDK: `sdk.on(mount, 'pointerdown', ...)`, keyboard via
  `sdk.on(window, 'keydown', ...)`.

## Painted art (optional, pipeline-provided)

Some games ship with pipeline-painted art bundled next to `game.js`: a
full-scene backdrop `bg.png` and/or transparent hero sprites
`sprite_<name>.png`. **Only when the build instructions explicitly list
them**: reference each by its exact relative filename — the backdrop from
`game.css` as `url('bg.png')` (cover-fit, bottom scene layer), sprites via
`<img>`/CSS or canvas `drawImage` (with a procedural placeholder until the
image is loaded — never block `sdk.ready()` on image loading). When the
instructions do not mention a file, it does not exist — never reference it,
and draw that element procedurally instead. These relative bundle-internal
paths are allowed; every external URL remains forbidden.

## Logic & puzzle games — correctness requirements

For board/puzzle/quiz/word games the deep review stage verifies real logic, so:

- Separate the core game logic into **pure functions** (state in → state out),
  independent of the DOM; render from state.
- Generated puzzle instances must be **guaranteed solvable** — construct by
  shuffling from a solved state or validate with a solver before showing.
- Win/lose/draw detection must cover every case (all rows/columns/diagonals,
  stalemates, no-moves-left).
- An AI opponent described as smart in the blueprint must genuinely play well
  (e.g. minimax for tic-tac-toe — never random-only moves).
- No unreachable or stuck states: every reachable state offers a legal move or
  ends the round.

## Hard rules (enforced by the quality gate — violations block the game)

1. **No raw browser scheduling or events.** `setTimeout`, `setInterval`,
   `requestAnimationFrame`, `cancelAnimationFrame`, `setAnimationLoop`,
   `addEventListener`, `removeEventListener` are forbidden in game code. Use
   `sdk.after`, `sdk.every`, `sdk.loop`, `sdk.on` — that is how cleanup stays
   leak-free.
2. **No network.** `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `navigator.sendBeacon` are forbidden.
3. **No escape hatches.** `eval`, `new Function`, `document.cookie`,
   `localStorage`, `sessionStorage`, `indexedDB`, `window.parent`,
   `window.top`, `window.open`, `importScripts` are forbidden.
4. **No raw audio.** `AudioContext` / `new Audio(...)` are forbidden; use `sdk.audio`.
5. **Self-contained.** No external URLs of any kind (scripts, images, fonts,
   CDNs). Draw with canvas, CSS, Unicode symbols, and emoji.
6. **Bilingual.** Every user-facing string goes through `sdk.t(...)`; every
   displayed number goes through `sdk.formatNumber(...)`. The layout must
   look correct in RTL (the template sets `dir` for you — avoid hard-coded
   `left`/`right` positioning for UI text; prefer flexbox and logical
   properties in `game.css`).
7. **Complete.** No TODOs, no placeholders, no dead code. The game must be
   winnable/losable exactly as the blueprint's `core_rule` describes.
8. **Call the SDK literally.** Always access SDK members as `sdk.<member>(...)`
   (`sdk.ready()`, `sdk.loop(...)`, `sdk.on(...)`, `sdk.t(...)`) — never
   destructure or alias the `sdk` object (`const { ready } = sdk`,
   `const s = sdk`). The gate verifies these literal call sites.
