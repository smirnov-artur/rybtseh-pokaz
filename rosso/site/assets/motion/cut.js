/* Россо · motion/cut.js — момент «склейка страниц» (ЗАМЫСЕЛ-ПЛАН §3.4,
   ЗАМЫСЕЛ-МАКСИМУМ §4). Уход в чёрное 240 мс с кримзонной волосяной
   шторкой-линией (scaleX 0→1 сверху экрана), навигация, проявление 420
   (entry). На 375 — короче на 30% (k=0.7, тот же приём, что в
   hero-cold-open.js). Слушатель клика — на capture-фазе, подключается
   ОДНОЙ строкой сразу после core.js (раньше rosso.js по document-order):
   e.preventDefault() гасит собственный фолбэк rosso.js — он сам проверяет
   defaultPrevented и не трогает страницу второй раз (см. cut.css).
   Если браузер поддерживает document.startViewTransition — @view-transition
   в rosso.css уже ведёт переход сам (шапка/строка/fab — свои
   view-transition-name); веил здесь ниже их по z-index — не перекрывает. */
(function () {
  "use strict";

  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var FLAG = 'rosso-cut-arrive';
  var armed = false;
  if (!REDUCED) {
    try { armed = sessionStorage.getItem(FLAG) === '1'; } catch (e) {}
  }
  if (armed) {
    try { sessionStorage.removeItem(FLAG); } catch (e) {}
    document.documentElement.classList.add('cut-arriving');
  }

  function ensureVeil() {
    var v = document.querySelector('.cut-veil');
    if (v) return v;
    v = document.createElement('div');
    v.className = 'cut-veil';
    v.setAttribute('aria-hidden', 'true');
    var line = document.createElement('i');
    line.className = 'cut-shutter';
    v.appendChild(line);
    (document.body || document.documentElement).appendChild(v);
    return v;
  }

  var veil = ensureVeil();
  var line = veil.querySelector('.cut-shutter');

  if (REDUCED) { veil.style.display = 'none'; return; } // без вуали, обычная навигация

  var gsap = window.gsap;
  var EASE = (window.RossoMotion && window.RossoMotion.ease) || {};

  function mobileK() {
    try { return window.matchMedia('(max-width:700px)').matches ? 0.7 : 1; } catch (e) { return 1; }
  }

  function revealFromBlack() {
    document.documentElement.classList.remove('cut-arriving');
    veil.classList.add('is-on');
    var dur = .42 * mobileK();
    if (gsap) {
      gsap.set(veil, { opacity: 1 });
      gsap.to(veil, {
        opacity: 0, duration: dur, ease: EASE.entry || 'power2.out',
        onComplete: function () { veil.classList.remove('is-on'); }
      });
    } else {
      veil.style.transition = 'opacity ' + dur + 's ease';
      veil.style.opacity = '1';
      requestAnimationFrame(function () { veil.style.opacity = '0'; });
      setTimeout(function () { veil.classList.remove('is-on'); }, dur * 1000 + 40);
    }
  }
  if (armed) revealFromBlack();

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    if (a.closest('.fab, .ord-panel, [data-order]')) return; // связь/заявка — свои переходы
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return; // якоря
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return; // tel:, mailto:, viber: …
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return; // внешние
    if (url.pathname === location.pathname && url.search === location.search) return; // та же страница

    e.preventDefault();
    try { sessionStorage.setItem(FLAG, '1'); } catch (err) {}
    var dest = a.href;
    var dur = .24 * mobileK();
    veil.classList.add('is-on');
    if (gsap) {
      gsap.set(line, { scaleX: 0 });
      gsap.set(veil, { opacity: 0 });
      var tl = gsap.timeline({ onComplete: function () { location.href = dest; } });
      tl.to(veil, { opacity: 1, duration: dur, ease: EASE.inOut4 || 'power2.in' }, 0)
        .to(line, { scaleX: 1, duration: dur, ease: EASE.igloo || 'power1.out' }, 0);
    } else {
      veil.style.transition = 'opacity ' + dur + 's ease';
      veil.style.opacity = '1';
      setTimeout(function () { location.href = dest; }, dur * 1000);
    }
  }, true);

  /* идемпотентность: возврат из bfcache — сразу снять веил, не залипать */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      if (gsap) gsap.set(veil, { opacity: 0 }); else veil.style.opacity = '0';
      veil.classList.remove('is-on');
      document.documentElement.classList.remove('cut-arriving');
    }
  });
})();
