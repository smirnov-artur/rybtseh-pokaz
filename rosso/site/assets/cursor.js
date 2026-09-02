/* ============================================================
   КУРСОР «Рыбцех» — cursor.js  (ваниль, без зависимостей, file:// ок)
   Подключение:  <script src="assets/cursor.js" defer></script>
   Стили: рядом лежащий cursor.css. Если <link> на него не найден —
   скрипт инжектит стили сам (компонент самодостаточный).

   Настройка (до подключения скрипта):
     window.RC_CURSOR = { theme:'rosso'|'artefakt', hideNative:'label'|'always'|'never', ... }
   Публичное API: window.RCCursor.{init,destroy,setTheme,moveTo,refresh,el}
   ============================================================ */
(function (w, d) {
  'use strict';

  var CFG = Object.assign({
    theme: null,            // null → читаем data-cursor-theme у <html>/<body>, иначе 'rosso'
    hideNative: 'label',    // 'label' — прячем нативный ТОЛЬКО на интерактиве (рекомендуется),
                            // 'always' — на всей странице, 'never' — не прячем никогда
    easeFast: 0.34,         // догон точки
    easeSlow: 0.16,         // догон кольца/пузыря
    maxLabel: 22,           // обрезка подписи из текста элемента
    injectCSS: true,
    labels: {}              // переопределение словаря: {play:'Играть', ...}
  }, w.RC_CURSOR || {});

  var L = Object.assign({
    play: 'Играть', pause: 'Пауза', drag: 'Тянуть',
    tel: 'Позвонить', mail: 'Написать', ext: 'Открыть', link: 'Смотреть'
  }, CFG.labels);

  /* --- селекторы интерактива --- */
  var SEL_TEXT = 'input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"]';
  var SEL_ACT = 'a[href],button,summary,label[for],[role="button"],[role="tab"],[role="link"],[tabindex]:not([tabindex="-1"]),[data-cursor]';
  var SEL_DRAG = '[draggable="true"],[data-cursor-drag],.rc-drag';
  var SEL_ANY = SEL_TEXT + ',' + SEL_ACT + ',' + SEL_DRAG + ',video';

  var mqFine = w.matchMedia ? w.matchMedia('(hover: hover) and (pointer: fine)') : null;
  var mqMotion = w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)') : null;

  var root = null, slow = null, fast = null, txt = null;
  var raf = 0, live = false, seen = false, still = 0;
  var px = 0, py = 0, sx = 0, sy = 0, fx = 0, fy = 0, last = 0;
  var hot = null, hotStyle = '', state = 'idle';
  var reduce = false;

  function calm() { return !!(mqMotion && mqMotion.matches); }
  function fine() { return !mqFine || mqFine.matches; }

  /* ---------- разметка и стили ---------- */
  var ICONS =
    '<svg class="rc-cur__ico" viewBox="0 0 12 12" aria-hidden="true">' +
      '<g class="rc-i-arrow"><path d="M1.5 6h8M6.5 2.8 9.8 6l-3.3 3.2"/></g>' +
      '<g class="rc-i-ext"><path d="M3 9 9 3M4.4 3H9v4.6"/></g>' +
      '<g class="rc-i-play"><path class="rc-fill" d="M3 2l7 4-7 4z"/></g>' +
      '<g class="rc-i-pause"><path class="rc-fill" d="M3 2h2.2v8H3zM6.8 2H9v8H6.8z"/></g>' +
      '<g class="rc-i-drag"><path d="M1 6h10M3.2 3.8 1 6l2.2 2.2M8.8 3.8 11 6l-2.2 2.2"/></g>' +
    '</svg>';

  function ensureCSS() {
    if (!CFG.injectCSS || d.getElementById('rc-cur-css')) return;
    var links = d.querySelectorAll('link[rel=stylesheet]'), i;
    for (i = 0; i < links.length; i++) {
      if (/cursor\.css/i.test(links[i].href)) return;      /* стили уже подключены руками */
    }
    var me = d.currentScript || d.querySelector('script[src*="cursor.js"]');
    var href = me ? me.src.replace(/cursor\.js.*$/i, 'cursor.css') : 'cursor.css';
    var el = d.createElement('link');
    el.id = 'rc-cur-css'; el.rel = 'stylesheet'; el.href = href;
    (d.head || d.documentElement).appendChild(el);
  }

  function theme() {
    if (CFG.theme) return CFG.theme;
    var a = d.documentElement.getAttribute('data-cursor-theme') ||
            (d.body && d.body.getAttribute('data-cursor-theme'));
    return a || 'rosso';
  }

  function build() {
    root = d.createElement('div');
    root.className = 'rc-cur';
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-state', 'idle');
    root.setAttribute('data-theme', theme());
    root.innerHTML =
      '<div class="rc-cur__slow"><i class="rc-cur__ring"></i>' +
      '<div class="rc-cur__bub">' + ICONS + '<span class="rc-cur__txt"></span></div></div>' +
      '<div class="rc-cur__fast"><i class="rc-cur__dot"></i></div>';
    slow = root.firstChild; fast = root.lastChild;
    txt = root.querySelector('.rc-cur__txt');
    d.body.appendChild(root);
  }

  /* ---------- определение состояния под указателем ---------- */
  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }
  function fromText(el) {
    var t = clean(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title'));
    if (!t) return L.link;
    if (t.length > CFG.maxLabel) t = t.slice(0, CFG.maxLabel - 1).replace(/[\s,.;:—-]+$/, '') + '…';
    return t;
  }
  function outer(a) {
    if (!a.href) return false;
    if (/^(tel:|mailto:|#|javascript:)/i.test(a.getAttribute('href') || '')) return false;
    if (a.target === '_blank') return true;
    try { return new URL(a.href, location.href).host !== location.host; } catch (e) { return false; }
  }

  /* → {state, label, play} либо null, если элемент не интерактивный */
  function read(el) {
    if (!el || !el.closest) return null;
    var t = el.closest(SEL_TEXT);
    if (t) return { s: 'text', l: '', p: 0 };

    var node = el.closest(SEL_ANY);
    if (!node) return null;

    var own = node.getAttribute && node.getAttribute('data-cursor');
    if (own === 'off') return null;

    var v = node.closest('video') || (node.tagName === 'VIDEO' ? node : null);
    if (v) return { s: 'video', l: own || (v.paused ? L.play : L.pause), p: v.paused ? 0 : 1 };

    if (node.matches(SEL_DRAG)) return { s: 'drag', l: own || L.drag, p: 0 };

    if (node.tagName === 'A') {
      var h = node.getAttribute('href') || '';
      if (/^tel:/i.test(h)) return { s: 'label', l: own || L.tel, p: 0 };
      if (/^mailto:/i.test(h)) return { s: 'label', l: own || L.mail, p: 0 };
      if (outer(node)) return { s: 'ext', l: own || '', p: 0 };
    }
    return { s: 'label', l: own || fromText(node), p: 0 };
  }

  /* нативный курсор: прячем ТОЛЬКО пока компонент реально работает */
  function nativeOff(el) {
    if (CFG.hideNative !== 'label' || !el || el === hot) return;
    nativeOn();
    hot = el; hotStyle = el.style.cursor;
    el.style.cursor = 'none';
  }
  function nativeOn() {
    if (hot) { hot.style.cursor = hotStyle; hot = null; hotStyle = ''; }
  }

  /* ---------- применение состояния ---------- */
  function apply(el) {
    var r = read(el), s = r ? r.s : 'idle';
    if (r && r.s !== 'text' && el && el.closest) {
      var host = el.closest('[data-cursor-theme]');
      var th = host ? host.getAttribute('data-cursor-theme') : theme();
      if (root.getAttribute('data-theme') !== th) root.setAttribute('data-theme', th);
    }
    if (r && r.s !== 'text') nativeOff(el.closest(SEL_ANY)); else nativeOn();

    if (r) {
      if (txt.textContent !== r.l) txt.textContent = r.l;
      root.setAttribute('data-play', r.p);
    }
    if (s !== state) { state = s; root.setAttribute('data-state', s); }
  }

  /* ---------- одна rAF-петля: только transform, без layout ---------- */
  function draw(now) {
    raf = 0;
    var dt = last ? Math.min((now - last) / 16.667, 4) : 1;
    last = now;
    if (reduce) {                       /* статичный курсор: без догона */
      fx = sx = px; fy = sy = py;
    } else {
      var kf = 1 - Math.pow(1 - CFG.easeFast, dt);
      var ks = 1 - Math.pow(1 - CFG.easeSlow, dt);
      fx += (px - fx) * kf; fy += (py - fy) * kf;
      sx += (px - sx) * ks; sy += (py - sy) * ks;
    }
    place();

    /* петля засыпает, когда курсор доехал */
    if (Math.abs(px - sx) + Math.abs(py - sy) + Math.abs(px - fx) + Math.abs(py - fy) < 0.15) {
      if (++still > 4) { sx = fx = px; sy = fy = py; return; }
    } else still = 0;
    tick();
  }
  function place() {
    fast.style.transform = 'translate3d(' + fx.toFixed(2) + 'px,' + fy.toFixed(2) + 'px,0)';
    slow.style.transform = 'translate3d(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px,0)';
  }
  function tick() {
    if (!live || raf || d.hidden) return;      /* пауза при скрытой вкладке */
    raf = w.requestAnimationFrame(draw);
  }
  function wake() {
    still = 0; last = 0;
    /* «меньше движения»: ставим сразу, петля не нужна вовсе */
    if (reduce) { fx = sx = px; fy = sy = py; place(); return; }
    tick();
  }

  /* ---------- события ---------- */
  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;   /* палец/перо — мимо */
    px = e.clientX; py = e.clientY;
    if (!seen) { seen = true; sx = fx = px; sy = fy = py; root.classList.add('is-on'); }
    apply(e.target);
    wake();
  }
  function onOut(e) { if (!e.relatedTarget && !e.toElement) leave(); }
  function leave() { root.classList.remove('is-on'); root.classList.remove('is-down'); nativeOn(); }
  function onEnter() { if (seen) root.classList.add('is-on'); }
  function onDown() { root.classList.add('is-down'); }
  function onUp(e) {
    root.classList.remove('is-down');
    if (e && e.target) w.setTimeout(function () { if (live) apply(e.target); }, 60);
  }
  function onVis() { if (d.hidden) { if (raf) { w.cancelAnimationFrame(raf); raf = 0; } } else wake(); }
  function onScroll() {
    if (!live || !seen) return;
    var el = d.elementFromPoint(px, py);
    if (el) apply(el);
  }

  /* ---------- жизненный цикл ---------- */
  function init() {
    if (live) return true;
    if (!fine()) return false;                 /* тач/грубый указатель — не включаемся */
    if (!d.body) { d.addEventListener('DOMContentLoaded', init, { once: true }); return false; }
    ensureCSS();
    build();
    reduce = calm();
    root.classList.toggle('is-static', reduce);
    live = true;

    d.addEventListener('pointermove', onMove, { passive: true });
    d.addEventListener('pointerdown', onDown, { passive: true });
    d.addEventListener('pointerup', onUp, { passive: true });
    d.addEventListener('mouseout', onOut, { passive: true });
    d.addEventListener('mouseover', onEnter, { passive: true });
    w.addEventListener('blur', leave);
    w.addEventListener('scroll', onScroll, { passive: true });
    d.addEventListener('visibilitychange', onVis);

    if (CFG.hideNative === 'always') d.documentElement.classList.add('rc-cur-hide');
    return true;
  }

  function destroy() {
    if (!live) return;
    live = false;
    if (raf) { w.cancelAnimationFrame(raf); raf = 0; }
    d.removeEventListener('pointermove', onMove);
    d.removeEventListener('pointerdown', onDown);
    d.removeEventListener('pointerup', onUp);
    d.removeEventListener('mouseout', onOut);
    d.removeEventListener('mouseover', onEnter);
    w.removeEventListener('blur', leave);
    w.removeEventListener('scroll', onScroll);
    d.removeEventListener('visibilitychange', onVis);
    nativeOn();                                        /* нативный курсор вернуть */
    d.documentElement.classList.remove('rc-cur-hide');
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = slow = fast = txt = null; seen = false; state = 'idle';
  }

  /* смена условий на лету: подключили мышь / включили «меньше движения» */
  function watch(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }
  watch(mqFine, function () { if (fine()) init(); else destroy(); });
  watch(mqMotion, function () {
    reduce = calm();
    if (root) root.classList.toggle('is-static', reduce);
    wake();
  });

  /* ---------- API ---------- */
  w.RCCursor = {
    init: init,
    destroy: destroy,
    get el() { return root; },
    setTheme: function (t) { CFG.theme = t; if (root) root.setAttribute('data-theme', t); },
    refresh: function () { if (live && seen) onScroll(); },
    /* программное перемещение — для демо, тестов и headless-снимков */
    moveTo: function (x, y, snap) {
      if (!live && !init()) return;
      px = x; py = y;
      if (!seen || snap) { seen = true; sx = fx = px; sy = fy = py; }
      root.classList.add('is-on');
      var el = d.elementFromPoint(x, y);
      apply(el || d.body);
      wake();
      if (snap) { fx = sx = px; fy = sy = py; place(); }
    }
  };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window, document);
