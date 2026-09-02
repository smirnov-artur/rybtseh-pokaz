/* Россо · motion/core.js — фундамент волны 1 (ЗАМЫСЕЛ-ПЛАН §2).
   Дирижёр поверх существующих слоёв (rosso.js, gl/, scrub) — ничего в них
   не переопределяет и не отключает. Если GSAP не загрузился — страница
   остаётся такой же, как без этого файла. */
(function () {
  "use strict";
  if (!window.gsap) return;

  var gsap = window.gsap;

  // --- регистрация плагинов (каждый может отсутствовать — не валим страницу) ---
  try {
    var plugins = [];
    if (window.CustomEase) plugins.push(window.CustomEase);
    if (window.Flip) plugins.push(window.Flip);
    if (window.SplitText) plugins.push(window.SplitText);
    if (window.ScrollTrigger) plugins.push(window.ScrollTrigger);
    if (window.Observer) plugins.push(window.Observer);
    if (plugins.length) gsap.registerPlugin.apply(gsap, plugins);
  } catch (e) {}

  // --- шесть кривых из РАЗВЕДКА-IGLOO.md (строки ~39-44), как есть ---
  var EASE = { entry: "entry", entry2: "entry2", entry3: "entry3", igloo: "igloo", inOut3: "inOut3", inOut4: "inOut4" };
  if (window.CustomEase) {
    try {
      CustomEase.create("entry", "M0,0 C0.358,0 0.336,0.209 0.442,0.519 0.59,0.952 0.768,0.918 1,1");
      CustomEase.create("entry2", "M0,0 C0.388,0.082 0.924,0.862 1,1");
      CustomEase.create("entry3", "M0,0 C0.272,0 0.472,0.454 0.496,0.496 0.66,0.79 0.685,1 1,1");
      CustomEase.create("igloo", "M0,0 C0.662,0.073 0.047,1 1,1");
      CustomEase.create("inOut3", "M0,0 C0.6,0 0,1 1,1");
      CustomEase.create("inOut4", "M0,0 C0.4,0 -0.06,1 1,1");
    } catch (e) {}
  }

  // --- шкала времени (та же сетка, что и --t-120/240/420/700/1200 в core.css) ---
  var T = { 120: 120, 240: 240, 420: 420, 700: 700, 1200: 1200 };

  gsap.defaults({ ease: "entry", duration: 0.42 });

  // --- reduced-motion: один выключатель, всё встаёт в конечный кадр ---
  function settleAll() {
    try {
      gsap.globalTimeline.timeScale(1000);
    } catch (e) {}
  }
  try {
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) settleAll();
    var onChange = function (m) {
      if (m.matches) settleAll();
      else gsap.globalTimeline.timeScale(1);
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {}

  // --- проба кадра: плавная прокрутка вниз-вверх, rAF + PerformanceObserver('longtask') ---
  function probe(seconds) {
    seconds = seconds || 3;
    return new Promise(function (resolve) {
      var frames = [];
      var longTasks = 0;
      var po = null;
      try {
        po = new PerformanceObserver(function (list) {
          longTasks += list.getEntries().length;
        });
        po.observe({ entryTypes: ["longtask"] });
      } catch (e) {}

      var startY = window.scrollY || window.pageYOffset || 0;
      var maxY = Math.max(
        (document.documentElement.scrollHeight || 0) - window.innerHeight,
        0
      );
      var totalMs = seconds * 1000;
      var halfMs = totalMs / 2;
      var t0 = null;
      var last = null;

      function finish() {
        if (po) {
          try {
            po.disconnect();
          } catch (e) {}
        }
        window.scrollTo(0, startY);
        var sorted = frames.slice().sort(function (a, b) {
          return a - b;
        });
        var sum = 0;
        for (var i = 0; i < sorted.length; i++) sum += sorted[i];
        var avg = sorted.length ? sum / sorted.length : 0;
        var p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
        var worst = sorted.length ? sorted[sorted.length - 1] : 0;
        resolve({ avg: avg, p95: p95, worst: worst, longTasks: longTasks, frames: sorted.length });
      }

      function tick(now) {
        if (t0 === null) {
          t0 = now;
          last = now;
          requestAnimationFrame(tick);
          return;
        }
        frames.push(now - last);
        last = now;
        var elapsed = now - t0;
        if (elapsed >= totalMs) {
          finish();
          return;
        }
        var y;
        if (elapsed <= halfMs) {
          var p = elapsed / halfMs;
          var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // sine-ish ease, no extra deps
          y = startY + (maxY - startY) * e;
        } else {
          var p2 = (elapsed - halfMs) / halfMs;
          var e2 = p2 < 0.5 ? 2 * p2 * p2 : 1 - Math.pow(-2 * p2 + 2, 2) / 2;
          y = maxY + (startY - maxY) * e2;
        }
        window.scrollTo(0, y);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  window.RossoMotion = { T: T, ease: EASE, probe: probe };
})();
