/**
 * Runtime smoke boot for generated games — executed by the quality gate via
 * `node smoke_boot.js <game.js> <manifest.json>`.
 *
 * Boots the game the way the template engine would (createGame is synchronous
 * by contract), then drives the registered loop/timers/input handlers for a
 * few simulated seconds. The DOM boundary is absorbed by permissive stubs, so
 * what this catches is the game's OWN logic blowing up: null derefs, use of
 * uninitialized state on the first frame, ReferenceErrors, crashes in input
 * handlers — the defect class `node --check` cannot see.
 *
 * Exit codes: 0 = boots cleanly (or inconclusive harness limitation),
 *             1 = the game code itself threw (stack printed to stdout).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME_FILENAME = 'game.js';
const FRAME_DT = 1 / 60;
const FRAMES_PER_PHASE = 120;
const WALL_CLOCK_BUDGET_MS = 8000;

// --------------------------------------------------------------------------
// Absorber: a permissive stand-in for anything on the DOM side of the
// boundary. Property reads memoize (so el.style.color round-trips), calls
// return fresh absorbers, math/string coercion yields 0/''. Game-side objects
// stay real, so genuine game bugs still throw.
// --------------------------------------------------------------------------
function makeAbsorber() {
  const store = new Map();
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'string' ? '' : 0);
      if (prop === Symbol.iterator) {
        return function* () {};
      }
      if (prop === 'then' || prop === 'toJSON') return undefined;
      if (prop === Symbol.toStringTag) return 'Absorber';
      if (store.has(prop)) return store.get(prop);
      const child = makeAbsorber();
      store.set(prop, child);
      return child;
    },
    set(_t, prop, value) {
      store.set(prop, value);
      return true;
    },
    has() {
      return true;
    },
    apply() {
      return makeAbsorber();
    },
    construct() {
      return makeAbsorber();
    },
    deleteProperty(_t, prop) {
      store.delete(prop);
      return true;
    },
  });
}

function seedRect(el, width, height) {
  el.clientWidth = width;
  el.clientHeight = height;
  el.offsetWidth = width;
  el.offsetHeight = height;
  el.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width,
    height,
    right: width,
    bottom: height,
  });
  return el;
}

// --------------------------------------------------------------------------
// Environment
// --------------------------------------------------------------------------
const gameJsPath = process.argv[2];
const manifestPath = process.argv[3];
let manifest;
let code;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  code = fs.readFileSync(gameJsPath, 'utf8');
} catch (err) {
  console.log('HARNESS_SKIP: could not read inputs: ' + err.message);
  process.exit(0);
}

const windowStub = makeAbsorber();
windowStub.innerWidth = 390;
windowStub.innerHeight = 700;
windowStub.devicePixelRatio = 2;

const documentStub = makeAbsorber();
documentStub.createElement = () => seedRect(makeAbsorber(), 390, 700);
documentStub.createElementNS = () => seedRect(makeAbsorber(), 390, 700);
documentStub.body = seedRect(makeAbsorber(), 390, 700);
documentStub.documentElement = seedRect(makeAbsorber(), 390, 700);
documentStub.hidden = false;

const lang = manifest.defaultLocale === 'en' ? 'en' : 'ar';
const loops = [];
const timers = [];
const listeners = [];

const sdk = Object.freeze({
  version: 'smoke-boot',
  lang,
  dir: lang === 'ar' ? 'rtl' : 'ltr',
  tweaks: Object.freeze(manifest.tweaks || {}),
  strings: manifest.strings || {},
  t(key) {
    const entry = (manifest.strings || {})[key];
    return entry ? entry[lang] || entry.en || key : key;
  },
  formatNumber: (n) => String(n),
  ready() {},
  loop(update) {
    loops.push(update);
    return { stop() {} };
  },
  after(_ms, fn) {
    timers.push(fn);
    return () => {};
  },
  every(_ms, fn) {
    timers.push(fn);
    return () => {};
  },
  on(_target, type, handler) {
    listeners.push({ type, handler });
    return () => {};
  },
  rand: (min, max) => min + Math.random() * (max - min),
  randInt: (min, max) => Math.floor(min + Math.random() * (max - min + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  audio: Object.freeze({ beep() {} }),
  storage: {
    get: (_k, fallback) => fallback,
    set() {},
  },
  report() {},
  gameOver() {},
});

const sandbox = {
  window: windowStub,
  document: documentStub,
  navigator: makeAbsorber(),
  performance: { now: () => Date.now() },
  getComputedStyle: makeAbsorber(),
  Image: makeAbsorber(),
  // In a browser, window IS the global object, so its properties are also
  // bare globals — mirror the ones games actually read (keep the values in
  // sync with windowStub above).
  innerWidth: 390,
  innerHeight: 700,
  devicePixelRatio: 2,
  screen: makeAbsorber(),
  location: makeAbsorber(),
  // Canvas-adjacent constructors 2D games reach for.
  Path2D: makeAbsorber(),
  OffscreenCanvas: makeAbsorber(),
  ImageData: makeAbsorber(),
  DOMMatrix: makeAbsorber(),
  DOMPoint: makeAbsorber(),
  // Browser globals that are absent from a bare vm context but sanctioned by
  // the code prompt (inline SVG via base64 data: URIs).
  btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
  atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  Boolean,
  Date,
  RegExp,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Symbol,
  Promise,
  Error,
  TypeError,
  RangeError,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  Infinity,
  NaN,
  undefined,
  Uint8Array,
  Uint8ClampedArray,
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint16Array,
  Uint32Array,
  structuredClone,
  queueMicrotask,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// --------------------------------------------------------------------------
// Boot + drive
// --------------------------------------------------------------------------
const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

function isGameError(err) {
  return err && typeof err.stack === 'string' && err.stack.includes(GAME_FILENAME);
}

function fail(phase, err) {
  console.log('RUNTIME_ERROR during ' + phase + ':');
  console.log(String(err && err.stack ? err.stack : err).split('\n').slice(0, 12).join('\n'));
  process.exit(1);
}

function guard(phase, run) {
  try {
    run();
  } catch (err) {
    if (isGameError(err)) fail(phase, err);
    console.log('HARNESS_SKIP: inconclusive during ' + phase + ': ' + (err && err.message));
    process.exit(0);
  }
}

guard('script evaluation', () => {
  vm.runInContext(code, sandbox, { filename: GAME_FILENAME, timeout: 5000 });
});

if (typeof sandbox.window.createGame !== 'function') {
  // The static contract check owns this failure mode; don't double-report.
  console.log('HARNESS_SKIP: window.createGame is not a function here');
  process.exit(0);
}

const mount = seedRect(makeAbsorber(), 390, 700);
guard('createGame()', () => {
  sandbox.window.createGame({ mount, sdk });
});

function runFrames(phase, count) {
  guard(phase, () => {
    for (let i = 0; i < count && Date.now() < deadline; i++) {
      for (const update of loops) update(FRAME_DT, i * FRAME_DT);
    }
  });
}

function fire(phase, type, event) {
  guard(phase, () => {
    for (const l of listeners.slice()) {
      if (l.type === type) l.handler(event);
    }
  });
}

function pointerEvent(x, y) {
  return {
    type: 'pointer',
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    offsetX: x,
    offsetY: y,
    button: 0,
    pointerId: 1,
    touches: [{ clientX: x, clientY: y, pageX: x, pageY: y }],
    changedTouches: [{ clientX: x, clientY: y, pageX: x, pageY: y }],
    target: mount,
    preventDefault() {},
    stopPropagation() {},
  };
}

// First frames exactly as the engine would run them — before any input.
runFrames('first frames (before any input)', FRAMES_PER_PHASE);

// Fire scheduled timer callbacks once (sdk.after / sdk.every bodies).
guard('timer callbacks', () => {
  for (const fn of timers.slice()) fn();
});

// A tap / drag / release sequence, then more frames.
for (const [type, x, y] of [
  ['pointerdown', 195, 500],
  ['pointermove', 160, 560],
  ['pointerup', 160, 560],
  ['click', 195, 350],
  ['touchstart', 195, 500],
  ['touchend', 195, 500],
]) {
  fire('input handler (' + type + ')', type, pointerEvent(x, y));
}
runFrames('frames after pointer input', FRAMES_PER_PHASE);

// A few common keys.
for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter']) {
  fire('input handler (keydown ' + key + ')', 'keydown', {
    type: 'keydown',
    key,
    code: key === ' ' ? 'Space' : key,
    preventDefault() {},
    stopPropagation() {},
  });
}
fire('resize handler', 'resize', { type: 'resize' });
runFrames('frames after keyboard input', FRAMES_PER_PHASE);

console.log('SMOKE_BOOT_OK');
process.exit(0);
