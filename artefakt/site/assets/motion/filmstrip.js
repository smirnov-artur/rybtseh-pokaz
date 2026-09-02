/* assets/motion/filmstrip.js — «история как киноплёнка» (момент 1 волны 5,
   ЗАМЫСЕЛ-ПЛАН.md §3 «Артефакт» / ЗАМЫСЕЛ-МАКСИМУМ.md §5). Только istoria.html.
   Хроника (.chron/.chron__vp/.chron__track/.era) уже несёт годы через
   data-count — этот файл ничего не выдумывает и не подписывает иначе:
   годы и подписи берутся только из уже существующей разметки. Единственная
   документальная съёмка — репортаж Первого канала 2008 — живёт в разделе
   «03 / Пресса» отдельно и этим файлом не затрагивается.
   Не создаёт новых data-rv/data-mat появлений на карточках — вся хореография
   ленты (защёлка на кадре) — свой, отдельный от общего слоя эффект.
   Guard: без GSAP/Observer — .chron остаётся нативным overflow-x:auto,
   как в artefakt.css, ничего не меняется. */
(function () {
  'use strict';
  if (!window.gsap || !window.Observer) return;

  var gsap = window.gsap;
  var AM = window.ArtefaktMotion || {};
  var T = AM.T || { 120: .12, 240: .24, 420: .42, 700: .7, 1200: 1.2 };

  var chron = document.querySelector('.chron');
  var vp = chron ? chron.querySelector('.chron__vp') : null;
  var track = vp ? vp.querySelector('.chron__track') : null;
  var frames = track ? Array.prototype.slice.call(track.querySelectorAll('.era')) : [];
  if (!chron || !vp || !track || frames.length < 2) return;

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* годы — только из того, что уже стоит в разметке (data-count на .cnt) */
  var years = frames.map(function (f) {
    var cnt = f.querySelector('[data-count]');
    var v = cnt ? parseFloat(cnt.getAttribute('data-count')) : NaN;
    return isFinite(v) ? v : 0;
  });

  chron.classList.add('chron--rigged');

  /* риска-указатель по центру окна ленты */
  var marker = document.createElement('div');
  marker.className = 'chron__marker';
  marker.setAttribute('aria-hidden', 'true');
  vp.appendChild(marker);

  vp.setAttribute('tabindex', '0');
  if (!vp.hasAttribute('role')) vp.setAttribute('role', 'group');
  if (!vp.hasAttribute('aria-label')) vp.setAttribute('aria-label', 'Хроника, 1967—2026, перетаскиваемая лента');

  /* панель ‹ год › — единственный явный способ листать при reduced-motion */
  var nav = document.createElement('div');
  nav.className = 'chron__nav';
  nav.innerHTML =
    '<button type="button" class="chron__btn chron__btn--prev" aria-label="Раньше">‹</button>' +
    '<span class="chron__year" aria-live="polite"><span class="chron__year-n">' + years[0] + '</span></span>' +
    '<button type="button" class="chron__btn chron__btn--next" aria-label="Позже">›</button>';
  vp.parentNode.insertBefore(nav, vp.nextSibling);
  var btnPrev = nav.querySelector('.chron__btn--prev');
  var btnNext = nav.querySelector('.chron__btn--next');
  var yearN = nav.querySelector('.chron__year-n');

  var x = 0;
  var centers = [];

  function measure() {
    centers = frames.map(function (f) { return f.offsetLeft + f.offsetWidth / 2; });
  }
  measure();

  function bounds() {
    var vw = vp.clientWidth;
    var tw = track.scrollWidth;
    return { min: Math.min(0, vw - tw), max: 0, vw: vw };
  }

  function frameTargetX(i) {
    var b = bounds();
    return Math.max(b.min, Math.min(b.max, b.vw / 2 - centers[i]));
  }

  function nearestIndex(curX) {
    var b = bounds();
    var bestI = 0, bestD = Infinity;
    centers.forEach(function (c, i) {
      var d = Math.abs(c + curX - b.vw / 2);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    return bestI;
  }

  /* число = интерполяция по двум ближайшим кадрам к риске-указателю */
  function yearAt(curX) {
    var b = bounds();
    var ref = b.vw / 2;
    var n = centers.length;
    var i = 0;
    while (i < n - 1 && (centers[i + 1] + curX) < ref) i++;
    if (i >= n - 1) return years[n - 1];
    var c0 = centers[i] + curX, c1 = centers[i + 1] + curX;
    if (c0 >= ref) return years[0];
    var t = (ref - c0) / ((c1 - c0) || 1);
    t = Math.max(0, Math.min(1, t));
    return Math.round(years[i] + (years[i + 1] - years[i]) * t);
  }

  var lastShown = null;
  function paintYear(y) {
    if (y === lastShown) return;
    lastShown = y;
    yearN.textContent = y;
  }

  var curIndex = 0;
  function flashSettle(i) {
    if (reduced) return;
    var el = frames[i];
    gsap.killTweensOf(el);
    gsap.fromTo(el, { filter: 'brightness(1.4)' }, { filter: 'brightness(1)', duration: T[420], ease: 'inOut4', overwrite: true });
  }

  function setBtns() {
    btnPrev.disabled = curIndex <= 0;
    btnNext.disabled = curIndex >= frames.length - 1;
  }

  function setX(v, animate, onDone) {
    gsap.killTweensOf(track);
    if (!animate || reduced) {
      x = v;
      gsap.set(track, { x: v });
      paintYear(yearAt(v));
      if (onDone) onDone();
    } else {
      gsap.to(track, {
        x: v, duration: T[420], ease: 'inOut4', overwrite: true,
        onUpdate: function () { x = gsap.getProperty(track, 'x'); paintYear(yearAt(x)); },
        onComplete: onDone
      });
    }
  }

  function goTo(i) {
    i = Math.max(0, Math.min(frames.length - 1, i));
    curIndex = i;
    setBtns();
    setX(frameTargetX(i), true, function () { flashSettle(i); });
  }

  function snapToNearest() {
    var i = nearestIndex(x);
    curIndex = i;
    setBtns();
    setX(frameTargetX(i), true, function () { flashSettle(i); });
  }

  /* ---------- старт: первый кадр у риски, без анимации ---------- */
  x = frameTargetX(0);
  gsap.set(track, { x: x });
  paintYear(years[0]);
  setBtns();

  /* ---------- кнопки и клавиатура — работают в любом режиме (без reduced
     анимации нет: setX сам ставит кадр мгновенно) ---------- */
  btnPrev.addEventListener('click', function () { goTo(curIndex - 1); });
  btnNext.addEventListener('click', function () { goTo(curIndex + 1); });
  vp.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(curIndex + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(curIndex - 1); }
  });

  /* ---------- перетаскивание с инерцией — только без reduced-motion:
     при reduced лента статична, листается только кнопками/стрелками ---------- */
  if (!reduced) {
    var isDragging = false;
    var wheelTimer = null;
    Observer.create({
      target: vp,
      type: 'touch,pointer,wheel',
      dragMinimum: 3,
      onPress: function () {
        gsap.killTweensOf(track);
        x = gsap.getProperty(track, 'x') || 0;
        isDragging = false;
        vp.classList.add('is-pressed');
      },
      onDrag: function (self) {
        isDragging = true;
        vp.classList.add('is-dragging');
        var b = bounds();
        var nx = x + self.deltaX;
        if (nx > b.max) nx = b.max + (nx - b.max) * .35;        /* мягкое сопротивление за краем */
        else if (nx < b.min) nx = b.min + (nx - b.min) * .35;
        x = nx;
        gsap.set(track, { x: x });
        paintYear(yearAt(x));
      },
      onRelease: function (self) {
        vp.classList.remove('is-dragging', 'is-pressed');
        if (!isDragging) return;   /* обычный тап по кадру/кнопке — их клики сработают сами */
        isDragging = false;
        var b = bounds();
        x = Math.max(b.min, Math.min(b.max, x));
        var v = self.velocityX || 0;
        if (Math.abs(v) < 40) { snapToNearest(); return; }
        var proj = Math.max(b.min, Math.min(b.max, x + v * .18));
        var dur = Math.min(.6, Math.max(.22, Math.abs(proj - x) / 900));
        gsap.killTweensOf(track);
        gsap.to(track, {
          x: proj, duration: dur, ease: 'igloo', overwrite: true,
          onUpdate: function () { x = gsap.getProperty(track, 'x'); paintYear(yearAt(x)); },
          onComplete: snapToNearest
        });
      },
      onWheel: function (self) {
        var ev = self.event;
        if (!ev || Math.abs(ev.deltaX) <= Math.abs(ev.deltaY)) return;   /* вертикальная прокрутка страницы не трогается */
        ev.preventDefault();
        gsap.killTweensOf(track);
        var b = bounds();
        x = Math.max(b.min, Math.min(b.max, x - ev.deltaX));
        gsap.set(track, { x: x });
        paintYear(yearAt(x));
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(snapToNearest, 120);
      }
    });
  }

  /* ---------- пересчёт позиций при ресайзе (смена раскладки, догрузка шрифта) ---------- */
  var resizeT = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      measure();
      x = frameTargetX(curIndex);
      gsap.set(track, { x: x });
      paintYear(years[curIndex]);
    }, 150);
  });
})();
