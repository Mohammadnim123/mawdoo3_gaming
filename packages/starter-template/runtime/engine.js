/**
 * Mawdoo3 Games — starter template runtime ("the engine").
 *
 * Infrastructure only. Owns: manifest loading, bilingual/RTL setup, the game
 * SDK, the lifecycle (every timer/listener/loop/audio node created through
 * the SDK is tracked and released), loading/error overlays, and the
 * postMessage save/share hooks. Gameplay never lives here — it arrives as
 * `window.createGame` from the generated `game.js`.
 *
 * Contract: createGame-v1 (see CONTRACT.md in the template package).
 */
(function () {
  'use strict';

  var ENGINE_VERSION = '1.1.0';

  // --------------------------------------------------------------------- //
  // Manifest & locale
  // --------------------------------------------------------------------- //

  function readManifest() {
    var el = document.getElementById('game-manifest');
    if (!el) return {};
    try {
      return JSON.parse(el.textContent);
    } catch (err) {
      return {};
    }
  }

  var manifest = readManifest();
  var params = new URLSearchParams(window.location.search);
  var langOverride = params.get('lang');
  var lang =
    langOverride === 'ar' || langOverride === 'en'
      ? langOverride
      : manifest.defaultLocale === 'ar'
        ? 'ar'
        : 'en';
  var dir = lang === 'ar' ? 'rtl' : 'ltr';

  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  if (manifest.title && manifest.title[lang]) {
    document.title = manifest.title[lang];
  }

  // --------------------------------------------------------------------- //
  // Lifecycle registry — everything the SDK hands out is tracked here and
  // released exactly once. Entries remove themselves when released (a fired
  // one-shot timer, an off()'d listener), so the registry never grows with
  // per-event scheduling over a long session.
  // --------------------------------------------------------------------- //

  var disposers = new Set();
  var destroyed = false;
  var gameHandle = null;

  function track(dispose) {
    var done = false;
    var wrapped = function () {
      if (done) return;
      done = true;
      disposers.delete(wrapped);
      try {
        dispose();
      } catch (err) {
        /* disposal must never throw */
      }
    };
    disposers.add(wrapped);
    return wrapped;
  }

  function destroyAll() {
    if (destroyed) return;
    destroyed = true;
    if (gameHandle && typeof gameHandle.destroy === 'function') {
      try {
        gameHandle.destroy();
      } catch (err) {
        /* game cleanup must never break engine cleanup */
      }
    }
    var pending = Array.from(disposers);
    disposers.clear();
    for (var i = 0; i < pending.length; i++) {
      pending[i]();
    }
  }

  // --------------------------------------------------------------------- //
  // Localization
  // --------------------------------------------------------------------- //

  var strings = manifest.strings || {};

  function t(key) {
    var entry = strings[key];
    if (!entry) return key;
    return entry[lang] || entry.en || entry.ar || key;
  }

  var numberFormatter;
  try {
    numberFormatter = new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
      useGrouping: false,
    });
  } catch (err) {
    numberFormatter = null;
  }

  function formatNumber(n) {
    if (!numberFormatter || typeof n !== 'number' || !isFinite(n)) return String(n);
    return numberFormatter.format(n);
  }

  // --------------------------------------------------------------------- //
  // Timing & events (auto-cleaned). Callbacks are guarded the same way the
  // frame loop is: a throwing timer or input handler shows the error overlay
  // and reports game_error instead of failing silently once per tick.
  // --------------------------------------------------------------------- //

  function after(ms, fn) {
    var id = window.setTimeout(function () {
      release(); // one-shot: leave the registry as soon as it fires
      try {
        fn();
      } catch (err) {
        showError(err);
      }
    }, ms);
    var release = track(function () {
      window.clearTimeout(id);
    });
    return release;
  }

  function every(ms, fn) {
    var release = track(function () {
      window.clearInterval(id);
    });
    var id = window.setInterval(function () {
      try {
        fn();
      } catch (err) {
        release(); // stop a broken interval instead of re-throwing every tick
        showError(err);
      }
    }, ms);
    return release;
  }

  function on(target, type, handler, options) {
    var wrapped = function (event) {
      try {
        return handler(event);
      } catch (err) {
        showError(err);
      }
    };
    target.addEventListener(type, wrapped, options);
    return track(function () {
      target.removeEventListener(type, wrapped, options);
    });
  }

  function loop(update) {
    var rafId = null;
    var running = true;
    var last = null;
    var elapsed = 0;

    function frame(now) {
      if (!running) return;
      if (document.hidden || bridgePaused) {
        // Pause instead of accumulating a giant dt while backgrounded or
        // while the host has bridge-paused us (overlay scrolled away, etc.).
        last = null;
        rafId = window.requestAnimationFrame(frame);
        return;
      }
      if (last === null) last = now;
      var dt = Math.min((now - last) / 1000, 0.1); // clamp frame spikes
      last = now;
      elapsed += dt;
      try {
        update(dt, elapsed);
      } catch (err) {
        running = false;
        showError(err);
        return;
      }
      rafId = window.requestAnimationFrame(frame);
    }

    rafId = window.requestAnimationFrame(frame);
    var stop = track(function () {
      running = false;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    });
    return { stop: stop };
  }

  // --------------------------------------------------------------------- //
  // Audio — tiny synth; the context and every oscillator are tracked.
  // --------------------------------------------------------------------- //

  var audioCtx = null;

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    track(function () {
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
      audioCtx = null;
    });
    return audioCtx;
  }

  function beep(opts) {
    opts = opts || {};
    var ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var duration = typeof opts.duration === 'number' ? opts.duration : 0.1;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.value = typeof opts.freq === 'number' ? opts.freq : 440;
    gain.gain.value = typeof opts.volume === 'number' ? opts.volume : 0.2;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
    osc.onended = function () {
      osc.disconnect();
      gain.disconnect();
    };
  }

  // --------------------------------------------------------------------- //
  // Session storage (in-memory) & platform hooks (postMessage only — the
  // game never touches the host page directly; C2 sandbox rule).
  // --------------------------------------------------------------------- //

  var memoryStore = Object.create(null);

  var storage = {
    get: function (key, fallback) {
      return key in memoryStore ? memoryStore[key] : fallback;
    },
    set: function (key, value) {
      memoryStore[key] = value;
    },
  };

  function report(event, data) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage(
        {
          source: 'mawdoo3-game',
          gameId: manifest.gameId || null,
          // The bundle's pinned template version (stamped into the manifest
          // by the assembler); the engine constant is only a fallback.
          templateVersion: manifest.templateVersion || ENGINE_VERSION,
          event: String(event),
          data: data === undefined ? null : data,
        },
        '*'
      );
    } catch (err) {
      /* reporting is best-effort */
    }
  }

  // --------------------------------------------------------------------- //
  // Host bridge v1 — the envelope the player UI consumes:
  //   {v: 1, type: ready|console|score|error|capture:result, payload}
  // Inbound control: pause / resume / capture. Legacy `report()` messages
  // keep flowing for older consumers; both describe the same lifecycle.
  // --------------------------------------------------------------------- //

  var bridgePaused = false;

  function postBridge(type, payload) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ v: 1, type: type, payload: payload || {} }, '*');
    } catch (err) {
      /* best-effort */
    }
  }

  function stringifyConsoleArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.message + (arg.stack ? '\n' + arg.stack : '');
    try {
      var json = JSON.stringify(arg);
      return json === undefined ? String(arg) : json;
    } catch (err) {
      return String(arg);
    }
  }

  function forwardConsole(level, args, stack) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(stringifyConsoleArg(args[i]));
    var message = parts.join(' ');
    if (message.length > 4000) message = message.slice(0, 4000) + '…';
    var payload = { level: level, message: message, ts: Date.now() };
    if (stack) payload.stack = stack;
    postBridge('console', payload);
  }

  (function shimConsole() {
    var levels = ['log', 'info', 'warn', 'error'];
    for (var i = 0; i < levels.length; i++) {
      (function (level) {
        var original = console[level] ? console[level].bind(console) : null;
        console[level] = function () {
          if (original) original.apply(null, arguments);
          forwardConsole(level, arguments);
        };
      })(levels[i]);
    }
    window.addEventListener('error', function (event) {
      var stack = event.error && event.error.stack ? String(event.error.stack) : undefined;
      forwardConsole('error', [event.message || 'Uncaught error'], stack);
      postBridge('error', {
        message: String(event.message || 'Uncaught error'),
        stack: stack,
      });
    });
    window.addEventListener('unhandledrejection', function (event) {
      var reason = event.reason;
      var message = reason && reason.message ? reason.message : String(reason);
      var stack = reason && reason.stack ? String(reason.stack) : undefined;
      forwardConsole('error', ['Unhandled rejection: ' + message], stack);
      postBridge('error', { message: message, stack: stack });
    });
  })();

  function primaryCanvas() {
    var canvases = document.getElementsByTagName('canvas');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var area = canvases[i].width * canvases[i].height;
      if (area > bestArea) {
        best = canvases[i];
        bestArea = area;
      }
    }
    return best;
  }

  function handleCapture() {
    var canvas = primaryCanvas();
    if (!canvas) {
      postBridge('capture:result', { dataUrl: null, error: 'no-canvas' });
      return;
    }
    try {
      postBridge('capture:result', { dataUrl: canvas.toDataURL('image/png') });
    } catch (err) {
      postBridge('capture:result', { dataUrl: null, error: 'read-failed' });
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.v !== 1 || typeof data.type !== 'string') return;
    if (data.type === 'pause') {
      bridgePaused = true;
      if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
    } else if (data.type === 'resume') {
      bridgePaused = false;
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } else if (data.type === 'capture') {
      handleCapture();
    }
  });

  // --------------------------------------------------------------------- //
  // Overlays
  // --------------------------------------------------------------------- //

  function buildOverlay(className, textEn, textAr) {
    var overlay = document.createElement('div');
    overlay.className = 'engine-overlay ' + className;
    var box = document.createElement('div');
    box.className = 'engine-overlay-box';
    box.textContent = lang === 'ar' ? textAr : textEn;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  var loadingOverlay = null;

  function showLoading() {
    loadingOverlay = buildOverlay('engine-loading', 'Loading…', 'جارٍ التحميل…');
  }

  function hideLoading() {
    if (loadingOverlay && loadingOverlay.parentNode) {
      loadingOverlay.parentNode.removeChild(loadingOverlay);
    }
    loadingOverlay = null;
  }

  function showError(err) {
    hideLoading();
    var overlay = buildOverlay(
      'engine-error',
      'Something went wrong while running this game.',
      'حدث خطأ أثناء تشغيل هذه اللعبة.'
    );
    overlay.setAttribute('role', 'alert');
    report('game_error', { message: err && err.message ? err.message : String(err) });
    postBridge('error', {
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack) : undefined,
    });
  }

  // --------------------------------------------------------------------- //
  // SDK assembly & boot
  // --------------------------------------------------------------------- //

  var readyCalled = false;

  var sdk = Object.freeze({
    version: ENGINE_VERSION,
    lang: lang,
    dir: dir,
    tweaks: Object.freeze(manifest.tweaks || {}),
    strings: strings,
    t: t,
    formatNumber: formatNumber,
    ready: function () {
      readyCalled = true;
      hideLoading();
      report('game_ready');
      postBridge('ready', {});
    },
    loop: loop,
    after: after,
    every: every,
    on: on,
    rand: function (min, max) {
      return min + Math.random() * (max - min);
    },
    randInt: function (min, max) {
      return Math.floor(min + Math.random() * (max - min + 1));
    },
    pick: function (arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },
    audio: Object.freeze({ beep: beep }),
    storage: storage,
    report: report,
    gameOver: function (result) {
      result = result || {};
      report('game_over', {
        score: typeof result.score === 'number' ? result.score : null,
        won: typeof result.won === 'boolean' ? result.won : null,
      });
      if (typeof result.score === 'number' && isFinite(result.score)) {
        postBridge('score', { score: result.score });
      }
    },
  });

  function boot() {
    showLoading();

    var mount = document.createElement('div');
    mount.id = 'game-root';
    document.body.appendChild(mount);

    if (typeof window.createGame !== 'function') {
      showError(new Error('game.js did not define window.createGame'));
      return;
    }

    try {
      gameHandle = window.createGame({ mount: mount, sdk: sdk }) || null;
    } catch (err) {
      showError(err);
      return;
    }

    // Safety net: never leave the loading overlay up if the game forgot ready().
    window.setTimeout(function () {
      if (!readyCalled) hideLoading();
    }, 4000);

    window.addEventListener('pagehide', function (event) {
      // bfcache entry (persisted=true) may bring the page back alive via the
      // Back button — destroying would restore a permanently dead game.
      if (!event.persisted) destroyAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
