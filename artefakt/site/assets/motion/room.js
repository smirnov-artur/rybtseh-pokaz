/* assets/motion/room.js — «следующий зал»: переход между страницами (волна 5,
   момент 2 ЗАМЫСЕЛ-ПЛАН.md §3 «Артефакт» / ЗАМЫСЕЛ-МАКСИМУМ.md §5).
   Ложится ПОВЕРХ перехода из artefakt.js (View Transitions + фолбэк
   vt-out) — тот модуль не трогаем: он по-прежнему называет .hero__plate/
   [data-plate] и .nav общими элементами и красит body.vt-out в браузерах
   без View Transitions. Здесь — тёплая вуаль + штамп зала ПЕРЕД любой
   внутренней навигацией, и её проявление на странице-приёмнике.
   Без белой вспышки: если flag стоит, крохотный синхронный инлайн-скрипт
   в <head> каждой страницы (до этого файла, до первой отрисовки) уже
   поставил html.room-in — реальная .room-veil здесь только подхватывает
   её и гасит проявлением 420 (entry). Подключён на всех 7 страницах
   (включая price.html — волна 6, интеграция 02.09).
   Guard: без GSAP — обычная навигация, вуаль из head снимается мгновенно.
   pageshow/bfcache: страница, с которой ушли по клику, может вернуться
   из bfcache в состоянии «сразу после appendChild» (.room-veil/.room-stamp
   уже в DOM, скрипт не перезапускается) — без этой чистки вуаль осталась
   бы навсегда после «назад» в браузере. */
(function () {
  'use strict';
  var FLAG = 'rm-room', FLAG_T = 'rm-room-t';
  var gsap = window.gsap;
  var html = document.documentElement;

  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    html.classList.remove('room-in');
    var stale = document.querySelectorAll('.room-veil, .room-stamp');
    for (var i = 0; i < stale.length; i++) stale[i].remove();
  });

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function isSmall() { return window.innerWidth <= 520; }

  try { sessionStorage.removeItem(FLAG); sessionStorage.removeItem(FLAG_T); } catch (e) {}

  var wasVeiled = html.classList.contains('room-in');

  if (!gsap) {
    if (wasVeiled) html.classList.remove('room-in');
    return;
  }

  var AM = window.ArtefaktMotion || {};
  var T = AM.T || { 120: .12, 240: .24, 420: .42, 700: .7, 1200: 1.2 };

  /* ---------- проявление на странице-приёмнике: снимаем вуаль ---------- */
  if (wasVeiled) {
    var veilIn = document.createElement('div');
    veilIn.className = 'room-veil';
    veilIn.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(veilIn, document.body.firstChild);
    /* тот же кадр: реальная вуаль уже стоит в opacity:1 (room.css), а
       псевдо-вуаль из head снимаем — визуального шва нет */
    html.classList.remove('room-in');
    if (reduced) {
      veilIn.remove();
    } else {
      var durIn = (isSmall() ? T[420] * .7 : T[420]);
      gsap.fromTo(veilIn, { opacity: 1 }, {
        opacity: 0, duration: durIn, ease: 'entry', overwrite: true,
        onComplete: function () { veilIn.remove(); }
      });
    }
  }

  if (reduced) return;   /* при reduced-motion — только снятие вуали выше, кликов не перехватываем */

  /* ---------- уход со страницы: клик по внутренней ссылке ---------- */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.closest('.fab, .fab-panel')) return;   /* панель связи — не наш переход */
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    if (/^(tel:|mailto:|javascript:)/i.test(href)) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;                              /* внешние — не трогаем */
    if (u.pathname === location.pathname && (u.hash || u.search === location.search)) return; /* якорь / та же страница */

    e.preventDefault();

    var name = (a.textContent || '').replace(/\s+/g, ' ').trim();
    var dur = isSmall() ? T[240] * .7 : T[240];
    var target = a.href;

    var veil = document.createElement('div');
    veil.className = 'room-veil';
    veil.setAttribute('aria-hidden', 'true');
    document.body.appendChild(veil);

    var stamp = null;
    if (name) {
      stamp = document.createElement('div');
      stamp.className = 'room-stamp';
      stamp.setAttribute('aria-hidden', 'true');
      var span = document.createElement('span');
      span.textContent = name;
      stamp.appendChild(span);
      document.body.appendChild(stamp);
    }

    var tl = gsap.timeline({
      onComplete: function () {
        try {
          sessionStorage.setItem(FLAG, '1');
          sessionStorage.setItem(FLAG_T, String(Date.now()));
        } catch (err) {}
        location.href = target;
      }
    });
    tl.fromTo(veil, { opacity: 0 }, { opacity: 1, duration: dur, ease: 'entry' }, 0);
    if (stamp) {
      tl.fromTo(stamp, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: dur, ease: 'inOut4' }, 0);
    }
  });
})();
