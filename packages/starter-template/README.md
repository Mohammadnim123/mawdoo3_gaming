# Starter Template (v1.0.0)

The versioned, hand-written skeleton **every generated game inherits**.
Infrastructure only — gameplay never lives here.

| File | Role |
|------|------|
| `template.json` | Version + contract id. The pinned version is recorded on every generated game (reproducibility). |
| `CONTRACT.md` | The template ↔ game contract (`createGame-v1`). Injected verbatim into the code-generation prompt and enforced by the quality gate. |
| `index.html.tpl` | Page skeleton. The assembler fills `__LANG__`, `__DIR__`, `__TITLE__`, `__TEMPLATE_VERSION__`, `__MANIFEST_JSON__`. |
| `runtime/engine.js` | The runtime: manifest loading, ar/en + RTL setup, the game SDK (timers, loop, events, audio, storage, i18n, number formatting), lifecycle cleanup, loading/error overlays, postMessage save/share hooks. |
| `runtime/engine.css` | Reset, full-viewport mount, RTL-safe defaults, bilingual font stack, overlay styles. |

## Why the SDK is mandatory

The engine tracks everything handed out through `sdk.after / sdk.every /
sdk.loop / sdk.on / sdk.audio` and releases it on destroy. The quality gate
**forbids** the raw browser equivalents in game code, which makes the classic
generated-game defect classes (leaked timers, orphaned listeners, dangling
oscillators) impossible by construction rather than merely detectable.

## Versioning rules

- Any observable change to the runtime or contract bumps `version` in
  `template.json` (semver). A contract-breaking change also bumps the
  `contract` id.
- Generated games record the template version they were built with; old
  bundles keep their pinned engine copy forever (bundles are self-contained).
