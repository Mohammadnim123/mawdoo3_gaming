/* Hero composer — type-and-delete placeholder, live char counter, and the
 * send button's disabled-until-valid gate (mirrors the reference
 * HeroComposer: 3..1000 trimmed chars). */
(function () {
  "use strict";
  var ta = document.querySelector("textarea[data-typewriter]");
  if (!ta) return;

  var counter = document.querySelector("[data-charcount]");
  var send = document.querySelector("[data-hero-send]");
  var max = parseInt(ta.getAttribute("maxlength") || "1000", 10);
  var MIN = 3;

  var sync = function () {
    if (counter) {
      counter.textContent = ta.value.length + "/" + max;
      counter.classList.toggle("opacity-0", ta.value.length === 0);
      counter.classList.toggle("opacity-100", ta.value.length > 0);
      counter.setAttribute("aria-hidden", ta.value.length === 0 ? "true" : "false");
    }
    if (send) {
      var trimmed = ta.value.trim();
      send.disabled = !(trimmed.length >= MIN && ta.value.length <= max);
    }
  };
  ta.addEventListener("input", sync);
  sync();

  var examples = [
    "an endless runner where a corgi dodges vacuum cleaners",
    "a neon snake that speeds up with every apple",
    "a puzzle about sorting alien recycling",
    "flappy but you are a paper plane in a thunderstorm",
  ];
  if (document.documentElement.lang === "ar") {
    examples = [
      "لعبة جري لا نهائية يتفادى فيها كلب كورجي المكانس الكهربائية",
      "ثعبان نيون يتسارع مع كل تفاحة",
      "لغز عن فرز نفايات الفضائيين",
      "فلابي لكنك طائرة ورقية في عاصفة رعدية",
    ];
  }

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { ta.setAttribute("placeholder", examples[0]); return; }

  /* Reference Typewriter timings: type 45 / delete 22 / hold 2200 / rest 450.
   * Steps by code POINT (Array.from) so Arabic and emoji never tear; never
   * pauses — while the user types, the value covers the placeholder anyway. */
  var TYPE = 45, DELETE = 22, HOLD = 2200, REST = 450;
  var phrases = examples.map(function (p) { return Array.from(p); });
  var i = 0, pos = 0, deleting = false;
  function tick() {
    var word = phrases[i];
    var delay;
    if (deleting) {
      pos -= 1;
      delay = DELETE;
      if (pos <= 0) { pos = 0; deleting = false; i = (i + 1) % phrases.length; delay = REST; }
    } else {
      pos += 1;
      delay = TYPE;
      if (pos >= word.length) { pos = word.length; deleting = true; delay = HOLD; }
    }
    ta.setAttribute("placeholder", (deleting ? word : phrases[i]).slice(0, pos).join(""));
    setTimeout(tick, delay);
  }
  tick();
})();
