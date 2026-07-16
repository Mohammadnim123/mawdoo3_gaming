/* Hero composer — type-and-delete placeholder + live char counter. */
(function () {
  "use strict";
  var ta = document.querySelector("textarea[data-typewriter]");
  if (!ta) return;

  var counter = document.querySelector("[data-charcount]");
  var max = parseInt(ta.getAttribute("maxlength") || "1000", 10);

  if (counter) {
    var sync = function () {
      counter.textContent = ta.value.length + "/" + max;
      counter.style.opacity = ta.value.length > 0 ? "1" : "0";
    };
    ta.addEventListener("input", sync);
    sync();
  }

  var examples = [
    "an endless runner where a corgi dodges vacuum cleaners",
    "a neon snake that speeds up with every apple",
    "a puzzle about sorting alien recycling",
    "flappy but you are a paper plane in a thunderstorm",
  ];
  if (document.documentElement.lang === "ar") {
    examples = [
      "لعبة جري لا نهائي تتفادى فيها العقبات",
      "ثعبان نيوني يتسارع مع كل تفاحة",
      "لغز عن فرز نفايات الفضائيين",
      "طائرة ورقية في عاصفة رعدية",
    ];
  }

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { ta.setAttribute("placeholder", examples[0]); return; }

  var i = 0, pos = 0, deleting = false, base = ta.getAttribute("placeholder") || "";
  function tick() {
    if (document.activeElement === ta || ta.value.length > 0) {
      ta.setAttribute("placeholder", base);
      return setTimeout(tick, 400);
    }
    var word = examples[i];
    pos += deleting ? -1 : 1;
    ta.setAttribute("placeholder", word.slice(0, pos));
    var delay = deleting ? 35 : 65;
    if (!deleting && pos === word.length) { deleting = true; delay = 1400; }
    else if (deleting && pos === 0) { deleting = false; i = (i + 1) % examples.length; delay = 250; }
    setTimeout(tick, delay);
  }
  setTimeout(tick, 600);
})();
