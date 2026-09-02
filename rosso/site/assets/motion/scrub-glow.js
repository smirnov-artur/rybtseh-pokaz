/* Россо · motion/scrub-glow.js — момент «ореол облёта» (ЗАМЫСЕЛ-ПЛАН §3.5).
   Сила кримзонного ореола пропорциональна скорости прокрутки (GSAP
   Observer, type:'scroll' — реальная скорость страницы, не сырые события
   колеса), сглаживание короткой твин-подкруткой, гаснет за 700 igloo при
   остановке (onStop). Не трогает scrub.js/canvas — только --glow-o на уже
   собранном .scrub__stage (см. scrub-glow.css). Подключать ПОСЛЕ
   assets/scrub/scrub.js, чтобы .scrub__stage уже был в DOM. */
(function () {
  "use strict";
  if (!window.gsap || !window.Observer) return;
  var stages = document.querySelectorAll('.scrub__stage');
  if (!stages.length) return;

  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; // css уже прячет ::after
  } catch (e) {}

  var gsap = window.gsap;
  var MAXV = 2200; // px/с — скорость, дающая полную силу ореола
  var proxy = { v: 0 };

  function apply() {
    var v = proxy.v;
    for (var i = 0; i < stages.length; i++) stages[i].style.setProperty('--glow-o', v.toFixed(3));
  }

  window.Observer.create({
    target: window,
    type: 'scroll',
    onChange: function (self) {
      var target = Math.min(1, Math.abs(self.velocityY || 0) / MAXV);
      gsap.to(proxy, { v: target, duration: .12, ease: 'inOut3', overwrite: true, onUpdate: apply });
    },
    onStop: function () {
      gsap.to(proxy, { v: 0, duration: .7, ease: 'igloo', overwrite: true, onUpdate: apply });
    }
  });
})();
