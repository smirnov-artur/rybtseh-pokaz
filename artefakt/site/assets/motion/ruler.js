/* assets/motion/ruler.js — весовая линейка как прибор (волна 4 плана, момент 2
   ЗАМЫСЕЛ-ПЛАН.md §3 «Артефакт» / ЗАМЫСЕЛ-МАКСИМУМ.md §5).
   Не переписывает выбор веса — существующий инлайн-скрипт в index.html
   (ROW/byId/show()) остаётся единственным местом, где вес превращается в
   цену. Эта линейка только оборачивает .notch-кнопки в перетаскиваемую
   ленту с инерцией и магнитной защёлкой, а смену деления запускает тем же
   способом, что и обычный клик — программным .click() по нужной кнопке —
   и сверху накладывает тик чисел, подъём насечки и масштаб кадра рыбы.
   Guard: без GSAP или Observer — ничего не делает, линейка работает как
   раньше (нативный overflow-x:auto из artefakt.css, клик по .notch). */
(function () {
  'use strict';
  if (!window.gsap || !window.Observer) return;

  var gsap = window.gsap;
  var AM = window.ArtefaktMotion || {};
  var T = AM.T || { 120: .12, 240: .24, 420: .42, 700: .7, 1200: 1.2 };

  var ruler = document.querySelector('.ruler');
  var row = ruler ? ruler.querySelector('.ruler__row') : null;
  var notches = row ? Array.prototype.slice.call(row.querySelectorAll('.notch')) : [];
  var elCat = document.getElementById('flagCat');
  var elPrice = document.getElementById('flagPrice');
  var vidbox = document.querySelector('.flag__vidbox');   /* кадр рыбы рядом — видео-карточка флагмана; отдельного фото нет */
  if (!ruler || !row || notches.length < 2 || !elCat || !elPrice) return;

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---------- реструктуризация: насечки уезжают в ленту, которую двигаем transform'ом ---------- */
  var track = document.createElement('div');
  track.className = 'ruler__track';
  notches.forEach(function (b) { track.appendChild(b); });
  row.appendChild(track);

  var marker = document.createElement('div');
  marker.className = 'ruler__marker';
  marker.setAttribute('aria-hidden', 'true');
  row.appendChild(marker);

  ruler.classList.add('ruler--rigged');

  var x = 0;
  var lastCat = elCat.textContent;
  var lastPrice = elPrice.textContent;

  function bounds() {
    var vw = row.clientWidth;
    var tw = track.scrollWidth;
    return { min: Math.min(0, vw - tw), max: 0, vw: vw };
  }

  function notchTargetX(i) {
    var b = bounds();
    var n = notches[i];
    var center = n.offsetLeft + n.offsetWidth / 2;
    return Math.max(b.min, Math.min(b.max, b.vw / 2 - center));
  }

  function nearestIndex(curX) {
    var b = bounds();
    var bestI = 0, bestD = Infinity;
    notches.forEach(function (n, i) {
      var center = n.offsetLeft + n.offsetWidth / 2 + curX;
      var d = Math.abs(center - b.vw / 2);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    return bestI;
  }

  function setX(v, animate, dur, ease, onDone) {
    x = v;
    gsap.killTweensOf(track);
    if (!animate || reduced) {
      gsap.set(track, { x: v });
      if (onDone) onDone();
    } else {
      gsap.to(track, { x: v, duration: dur, ease: ease, overwrite: true, onComplete: onDone });
    }
  }

  function snapToNearest(animate) {
    var i = nearestIndex(x);
    setX(notchTargetX(i), animate, T[420], 'inOut4', function () { notches[i].click(); });
  }

  /* ---------- тик чисел в подписи веса и в ценнике ---------- */
  function tickNumberText(el, fromText, toText, dur) {
    var re = /\d+(?:,\d+)?/g;
    var fromMatches = fromText.match(re) || [];
    var toks = [], m;
    while ((m = re.exec(toText))) {
      toks.push({ start: m.index, end: m.index + m[0].length, comma: m[0].indexOf(',') > -1, val: parseFloat(m[0].replace(',', '.')) });
    }
    if (!toks.length || reduced) { el.textContent = toText; return; }
    var proxy = { t: 0 };
    gsap.to(proxy, {
      t: 1, duration: dur, ease: 'inOut4', overwrite: true,
      onUpdate: function () {
        var out = '', last = 0;
        toks.forEach(function (tok, i) {
          var fv = fromMatches[i] !== undefined ? parseFloat(fromMatches[i].replace(',', '.')) : tok.val;
          var v = fv + (tok.val - fv) * proxy.t;
          var s = tok.comma ? (Math.round(v * 10) / 10).toFixed(1).replace('.', ',') : String(Math.round(v));
          out += toText.slice(last, tok.start) + s;
          last = tok.end;
        });
        el.textContent = out + toText.slice(last);
      },
      onComplete: function () { el.textContent = toText; }
    });
  }

  /* ---------- насечка приподнимается, кадр рыбы «ложится на весы» ---------- */
  function liftNotch(i, instant) {
    notches.forEach(function (b, k) {
      var to = { y: k === i ? -2 : 0, scale: k === i ? 1.04 : 1 };
      if (instant || reduced) {
        gsap.set(b, to);
      } else {
        gsap.to(b, { y: to.y, scale: to.scale, duration: T[240], ease: k === i ? 'entry3' : 'inOut3', overwrite: true });
      }
    });
  }

  function pulseFrame() {
    if (!vidbox) return;
    if (reduced) { gsap.set(vidbox, { scale: 1 }); return; }
    gsap.fromTo(vidbox, { scale: .96 }, { scale: 1, duration: T[420], ease: 'entry2', overwrite: true });
  }

  /* Общая точка выхода для ЛЮБОГО источника смены деления — обычного клика,
     стрелок клавиатуры (см. существующий keydown-обработчик в index.html)
     и нашего программного .click() при защёлкивании. Логику вес→цена не
     трогаем, только читаем уже обновлённый DOM и доигрываем физику сверху. */
  function onSelectionSettled() {
    var newCat = elCat.textContent, newPrice = elPrice.textContent;
    if (newCat !== lastCat) { tickNumberText(elCat, lastCat, newCat, T[420]); lastCat = newCat; }
    if (newPrice !== lastPrice) { tickNumberText(elPrice, lastPrice, newPrice, T[420]); lastPrice = newPrice; }
    var activeI = notches.findIndex(function (b) { return b.classList.contains('is-on'); });
    if (activeI > -1) liftNotch(activeI);
    pulseFrame();
  }
  notches.forEach(function (b) {
    b.addEventListener('click', onSelectionSettled);
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') onSelectionSettled();
    });
  });

  /* ---------- Observer: перетаскивание указателем/пальцем с инерцией ---------- */
  var isDragging = false;
  Observer.create({
    target: row,
    type: 'touch,pointer',
    dragMinimum: 3,
    onPress: function () {
      gsap.killTweensOf(track);
      x = gsap.getProperty(track, 'x') || 0;
      isDragging = false;
      row.classList.add('is-pressed');
    },
    onDrag: function (self) {
      isDragging = true;
      row.classList.add('is-dragging');
      var b = bounds();
      var nx = x + self.deltaX;
      if (nx > b.max) nx = b.max + (nx - b.max) * .35;   /* мягкое сопротивление за краем */
      else if (nx < b.min) nx = b.min + (nx - b.min) * .35;
      x = nx;
      gsap.set(track, { x: x });
    },
    onRelease: function (self) {
      row.classList.remove('is-dragging', 'is-pressed');
      if (!isDragging) return;   /* это был обычный тап — клик по кнопке сработает сам */
      isDragging = false;
      var b = bounds();
      x = Math.max(b.min, Math.min(b.max, x));
      if (reduced) { snapToNearest(false); return; }
      var v = self.velocityX || 0;
      if (Math.abs(v) < 40) { snapToNearest(true); return; }
      var proj = Math.max(b.min, Math.min(b.max, x + v * .18));
      var dur = Math.min(.6, Math.max(.22, Math.abs(proj - x) / 900));
      setX(proj, true, dur, 'igloo', function () { snapToNearest(true); });
    }
  });

  /* ---------- колесо / тачпад по горизонтали ---------- */
  var wheelTimer = null;
  row.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   /* вертикальная прокрутка страницы не трогается */
    e.preventDefault();
    gsap.killTweensOf(track);
    var b = bounds();
    x = Math.max(b.min, Math.min(b.max, x - e.deltaX));
    gsap.set(track, { x: x });
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () { snapToNearest(!reduced); }, 120);
  }, { passive: false });

  /* ---------- начальная позиция: уже активная насечка сразу под риской, без анимации ---------- */
  var initI = notches.findIndex(function (b) { return b.classList.contains('is-on'); });
  if (initI < 0) initI = 0;
  x = notchTargetX(initI);
  gsap.set(track, { x: x });
  liftNotch(initI, true);

  /* пересчёт позиции при смене раскладки (ресайз, догрузка шрифта) */
  var resizeT = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      var i = notches.findIndex(function (b) { return b.classList.contains('is-on'); });
      if (i < 0) i = 0;
      x = notchTargetX(i);
      gsap.set(track, { x: x });
    }, 150);
  });
})();
