/* assets/motion/core.js — фундамент движения «Артефакт» (волна 1 плана).
   Регистрирует GSAP-плагины, шесть кривых IGLOO (РАЗВЕДКА-IGLOO.md, п.7),
   шкалу времени T и пробу кадра. Существующие слои (artefakt.js, data-mat/
   .blueprint/data-rv/data-split/data-count/.mq, рельс, .vlabel, gl/, скраб)
   не переопределяет и не отключает — только даёт им общий словарь времени.
   Всё под единым guard: если GSAP не загрузился, страница работает как раньше. */
(function () {
  'use strict';
  if (!window.gsap) return;

  var gsap = window.gsap;
  ['CustomEase', 'Flip', 'SplitText', 'ScrollTrigger', 'Observer'].forEach(function (name) {
    if (window[name]) gsap.registerPlugin(window[name]);
  });

  if (window.CustomEase) {
    CustomEase.create('entry',  'M0,0 C0.358,0 0.336,0.209 0.442,0.519 0.59,0.952 0.768,0.918 1,1');
    CustomEase.create('entry2', 'M0,0 C0.388,0.082 0.924,0.862 1,1');
    CustomEase.create('entry3', 'M0,0 C0.272,0 0.472,0.454 0.496,0.496 0.66,0.79 0.685,1 1,1');
    CustomEase.create('igloo',  'M0,0 C0.662,0.073 0.047,1 1,1');
    CustomEase.create('inOut3', 'M0,0 C0.6,0 0,1 1,1');
    CustomEase.create('inOut4', 'M0,0 C0.4,0 -0.06,1 1,1');
  }

  /* шкала времени: ключ — ms из имени токена --t-*, значение — секунды (GSAP duration) */
  var T = { 120: .12, 240: .24, 420: .42, 700: .7, 1200: 1.2 };
  var ease = { entry: 'entry', entry2: 'entry2', entry3: 'entry3', igloo: 'igloo', inOut3: 'inOut3', inOut4: 'inOut4' };

  gsap.defaults({ ease: 'entry', duration: T[420] });

  /* единый выключатель: reduced-motion не гасит анимации, а мгновенно
     довозит глобальный таймлайн до конечного кадра (официальный приём GSAP). */
  if (gsap.matchMedia) {
    var mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: reduce)', function () {
      gsap.globalTimeline.timeScale(100);
      return function () { gsap.globalTimeline.timeScale(1); };
    });
  }

  /* --- проба кадра: seconds секунд плавной прокрутки вниз-вверх,
     длительности кадров через rAF, длинные задачи через PerformanceObserver --- */
  function probe(seconds) {
    seconds = seconds || 3;
    return new Promise(function (resolve) {
      var longTasks = [];
      var po = null;
      if ('PerformanceObserver' in window) {
        try {
          po = new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (e) { longTasks.push(e.duration); });
          });
          po.observe({ entryTypes: ['longtask'] });
        } catch (e) { po = null; }
      }

      var startY = window.scrollY;
      var maxY = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      var total = seconds * 1000;
      var start = performance.now();
      var last = start;
      var frames = [];

      function tick(now) {
        frames.push(now - last);
        last = now;
        var elapsed = now - start;
        if (elapsed >= total) {
          if (po) po.disconnect();
          window.scrollTo(0, startY);
          frames.shift();
          var sorted = frames.slice().sort(function (a, b) { return a - b; });
          var n = sorted.length || 1;
          var avg = sorted.reduce(function (a, b) { return a + b; }, 0) / n;
          var p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
          var worst = sorted[sorted.length - 1] || 0;
          resolve({
            avg: +avg.toFixed(2),
            p95: +p95.toFixed(2),
            worst: +worst.toFixed(2),
            longTasks: longTasks.length,
            frames: sorted.length
          });
          return;
        }
        var p = elapsed / total;
        var y = p < .5 ? maxY * (p / .5) : maxY * (1 - (p - .5) / .5);
        window.scrollTo(0, y);
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  window.ArtefaktMotion = { T: T, ease: ease, probe: probe };
})();
