/* Россо · motion/tech-timecode.js — момент «технология как таймкод»
   (ЗАМЫСЕЛ-ПЛАН §3.3). Кримзонный рельс + таймкод 00:00:00:00 бегут от
   прогресса прокрутки секции #tech (ScrollTrigger scrub:0.6) — не от
   таймера. В секции нет кадров data-gl="displace" (проверено: там только
   видео posol-live) — RossoGL.goTo сюда не добавляем, см. задание и
   assets/gl/README.md §3.2 («если displace нет — не добавлять»).
   Фундамент — assets/motion/core.js/core.css. */
(function () {
  "use strict";
  if (!window.gsap || !window.ScrollTrigger || !window.RossoMotion) return;

  var section = document.getElementById('tech');
  var rail = section && section.querySelector('.tt-rail');
  var code = rail && rail.querySelector('.tt-code');
  if (!section || !rail || !code) return;

  var FPS = 24, DUR_S = 14; // виртуальный хронометр рельса — 14 с при 24 fps
  var TOTAL = FPS * DUR_S;

  function pad(n) { n = Math.floor(n); return n < 10 ? '0' + n : '' + n; }
  function fmt(frame) {
    var s = Math.floor(frame / FPS);
    var ff = frame % FPS;
    var mm = Math.floor(s / 60), ss = s % 60;
    return '00:' + pad(mm) + ':' + pad(ss) + ':' + pad(ff);
  }

  function setP(p) {
    p = Math.max(0, Math.min(1, p));
    rail.style.setProperty('--tt-p', p.toFixed(4));
    code.textContent = fmt(p * TOTAL);
  }

  function reducedNow() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  if (reducedNow()) { setP(1); return; }

  setP(0);
  var st = window.ScrollTrigger.create({
    trigger: section,
    start: 'top 75%',
    end: 'bottom 45%',
    scrub: 0.6,
    onUpdate: function (self) { setP(self.progress); }
  });

  /* переключатель ОС посреди сессии — сразу конечный кадр, как в core.js */
  try {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function (m) {
      if (m.matches) { if (st) st.kill(); setP(1); }
    });
  } catch (e) {}
})();
