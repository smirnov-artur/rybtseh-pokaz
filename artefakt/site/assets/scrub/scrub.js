/* ===========================================================
   СКРОЛЛ-СКРАБ — покадровая прокрутка объекта на canvas
   Ванильный JS, без зависимостей. Проект РЫБЦЕХ.
   Подключение: scrub.css + этот файл. Разметка — см. README.md
   =========================================================== */
(function () {
  'use strict';

  var SEL = '[data-scrub]';
  var instances = [];
  var ticking = false;

  /* ---------- утилиты ---------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function attr(el, name, fallback) {
    var v = el.getAttribute('data-scrub-' + name);
    return (v === null || v === '') ? fallback : v;
  }

  function num(el, name, fallback) {
    var v = parseFloat(attr(el, name, NaN));
    return isNaN(v) ? fallback : v;
  }

  /* ---------- определение режима (деградация) ---------- */

  function pickMode(el) {
    // 1. Пользователь просил меньше движения — статичный кадр, скраб не запускаем
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'static';
    }

    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    // 2. Экономия трафика или очень медленная сеть — статичный кадр
    if (c) {
      if (c.saveData) return 'static';
      var et = c.effectiveType || '';
      if (et === 'slow-2g' || et === '2g') return 'static';
    }

    // 3. Узкий экран / слабое устройство / 3g — половина кадров
    var narrow = window.matchMedia
      ? window.matchMedia('(max-width: ' + num(el, 'narrow', 700) + 'px)').matches
      : window.innerWidth <= 700;
    var weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
               (c && c.effectiveType === '3g');

    if (narrow || weak) return 'reduced';

    return 'full';
  }

  /* ---------- сборка DOM ---------- */

  function build(el, opts) {
    var stage = document.createElement('div');
    stage.className = 'scrub__stage';

    var canvas = document.createElement('canvas');
    canvas.className = 'scrub__canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', attr(el, 'alt', 'Вяленый лещ, облёт камерой'));

    var poster = document.createElement('img');
    poster.className = 'scrub__poster';
    poster.alt = '';
    poster.decoding = 'async';
    if (opts.poster) poster.src = opts.poster;

    stage.appendChild(canvas);
    stage.appendChild(poster);

    // индикатор предзагрузки
    var load = document.createElement('div');
    load.className = 'scrub__load';
    var bar = document.createElement('div');
    bar.className = 'scrub__bar';
    var fill = document.createElement('i');
    bar.appendChild(fill);
    var pct = document.createElement('span');
    pct.className = 'scrub__pct';
    pct.textContent = '0%';
    load.appendChild(bar);
    load.appendChild(pct);
    stage.appendChild(load);

    // переносим исходное содержимое секции в слой поверх кадра
    var overlay = document.createElement('div');
    overlay.className = 'scrub__overlay';
    while (el.firstChild) overlay.appendChild(el.firstChild);
    stage.appendChild(overlay);

    var hintText = attr(el, 'hint', '');
    if (hintText) {
      var hint = document.createElement('div');
      hint.className = 'scrub__hint';
      hint.textContent = hintText;
      stage.appendChild(hint);
    }

    el.appendChild(stage);

    return { stage: stage, canvas: canvas, poster: poster, load: load, fill: fill, pct: pct };
  }

  /* ---------- экземпляр ---------- */

  function Scrub(el) {
    this.el = el;
    this.src = attr(el, 'src', '');
    this.count = Math.max(2, num(el, 'count', 60));
    this.padw = num(el, 'pad', 2);
    this.first = num(el, 'start', 1);
    this.travel = num(el, 'travel', 125);      // vh прокрутки поверх липкого экрана
    this.ease = clamp(num(el, 'ease', 0.16), 0.02, 1);
    this.fit = attr(el, 'fit', 'cover');
    this.poster = attr(el, 'poster', '');

    this.mode = pickMode(el);
    this.dom = build(el, { poster: this.poster });

    this.ctx = this.dom.canvas.getContext('2d', { alpha: false });
    this.images = [];
    this.indices = this.buildIndices();
    this.loaded = 0;
    this.failed = 0;
    this.ready = false;
    this.cur = 0;      // сглаженный прогресс 0..1
    this.target = 0;
    this.drawn = -1;
    this.dpr = 1;
    this.cw = 0;
    this.ch = 0;

    this.applyHeight();
    this.resize();
    this.observe();
  }

  // какие кадры реально грузим
  Scrub.prototype.buildIndices = function () {
    var out = [], i;
    if (this.mode === 'static') {
      out.push(this.first + Math.floor(this.count / 2)); // серединный кадр
      return out;
    }
    var step = (this.mode === 'reduced') ? 2 : 1;
    for (i = 0; i < this.count; i += step) out.push(this.first + i);
    // последний кадр обязателен — иначе поворот не доходит до конца
    var last = this.first + this.count - 1;
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  };

  Scrub.prototype.url = function (idx) {
    if (this.src.indexOf('{n}') !== -1) {
      return this.src.replace('{n}', pad(idx, this.padw));
    }
    return this.src + pad(idx, this.padw) + '.webp';
  };

  Scrub.prototype.applyHeight = function () {
    if (this.mode === 'static') {
      this.el.setAttribute('data-scrub-static', '');
      this.el.style.height = '';
    } else {
      this.el.style.setProperty('--scrub-travel', this.travel + 'vh');
    }
  };

  /* ---------- загрузка ---------- */

  Scrub.prototype.observe = function () {
    var self = this;
    if (!('IntersectionObserver' in window)) { this.preload(); return; }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); self.preloadAfterLoad(); }
      }
    }, { rootMargin: '150% 0px' });
    io.observe(this.el);
  };

  /* Куратор (02.09): на главной «Артефакта» дорожка — второй экран, и 60 кадров
     (~2,4 МБ) уходили в сеть вместе с героем, шрифтами и скриптами. Теперь ждём
     события load (критичное для первого экрана уже пришло) и первую паузу
     главного потока; постер дорожки виден всё это время. */
  Scrub.prototype.preloadAfterLoad = function () {
    var self = this;
    if (self._queued) return;
    self._queued = true;
    function go() {
      if ('requestIdleCallback' in window) window.requestIdleCallback(function () { self.preload(); }, { timeout: 1200 });
      else setTimeout(function () { self.preload(); }, 200);
    }
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  };

  Scrub.prototype.preload = function () {
    var self = this;
    var list = this.indices;
    var total = list.length;
    var next = 0;
    var CONC = Math.min(6, total);
    var inflight = 0;

    if (!this.src) { this.fail(); return; }

    function progress() {
      var done = self.loaded + self.failed;
      var p = Math.round(done / total * 100);
      self.dom.fill.style.width = p + '%';
      self.dom.pct.textContent = p + '%';
      if (done >= total) finish();
    }

    function finish() {
      self.dom.load.setAttribute('hidden', '');
      if (self.failed > total * 0.25 || !self.images[0]) { self.fail(); return; }
      self.ready = true;
      self.el.setAttribute('data-scrub-ready', '');
      self.resize();
      if (self.mode === 'static') {
        self.drawFrame(0);
      } else {
        self.measure();
        self.cur = self.target;
        self.render();
        bindGlobal();
      }
    }

    function pump() {
      while (next < total && inflight < CONC) { inflight++; load(next++); }
    }

    function load(slot) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        self.images[slot] = img;
        self.loaded++;
        // первый кадр рисуем сразу, чтобы секция не была пустой
        if (slot === 0) { self.resize(); self.drawFrame(0); }
        inflight--;
        progress();
        pump();
      };
      img.onerror = function () {
        self.failed++;
        inflight--;
        progress();
        pump();
      };
      img.src = self.url(list[slot]);
    }

    pump();
  };

  Scrub.prototype.fail = function () {
    this.dom.load.setAttribute('hidden', '');
    this.el.setAttribute('data-scrub-failed', '');
    this.el.setAttribute('data-scrub-static', '');
    this.el.style.height = '';
  };

  /* ---------- геометрия и отрисовка ---------- */

  Scrub.prototype.resize = function () {
    var canvas = this.dom.canvas;
    var w = canvas.clientWidth || this.dom.stage.clientWidth;
    var h = canvas.clientHeight || this.dom.stage.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !h) return;
    if (w === this.cw && h === this.ch && dpr === this.dpr) return;
    this.cw = w; this.ch = h; this.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.drawn = -1;             // заставить перерисовать
  };

  Scrub.prototype.drawFrame = function (slot) {
    var img = this.images[slot];
    if (!img) return;
    var ctx = this.ctx;
    var cw = this.dom.canvas.width, ch = this.dom.canvas.height;
    if (!cw || !ch) return;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;

    var s = (this.fit === 'contain')
      ? Math.min(cw / iw, ch / ih)
      : Math.max(cw / iw, ch / ih);
    var w = iw * s, h = ih * s;

    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    this.drawn = slot;
  };

  // прогресс прокрутки внутри секции: 0 — секция прилипла, 1 — отлипает
  Scrub.prototype.measure = function () {
    var rect = this.el.getBoundingClientRect();
    var span = this.el.offsetHeight - this.dom.stage.offsetHeight;
    if (span <= 0) { this.target = 0; return; }
    this.target = clamp(-rect.top / span, 0, 1);
  };

  Scrub.prototype.render = function () {
    var n = this.indices.length;
    if (!n || !this.loaded) return;
    var slot = Math.round(this.cur * (n - 1));
    slot = clamp(slot, 0, n - 1);
    // если кадр не догрузился — берём ближайший загруженный
    if (!this.images[slot]) {
      var k = slot;
      while (k >= 0 && !this.images[k]) k--;
      if (k < 0) { k = slot; while (k < n && !this.images[k]) k++; }
      slot = clamp(k, 0, n - 1);
    }
    if (slot !== this.drawn) this.drawFrame(slot);
  };

  // один шаг сглаживания; возвращает true, пока не успокоилось
  Scrub.prototype.step = function () {
    var d = this.target - this.cur;
    if (Math.abs(d) < 0.0004) {
      if (this.cur !== this.target) { this.cur = this.target; this.render(); }
      return false;
    }
    this.cur += d * this.ease;
    this.render();
    return true;
  };

  /* ---------- общий цикл ---------- */

  function active() {
    var out = [], i;
    for (i = 0; i < instances.length; i++) {
      var s = instances[i];
      if (!s.ready || s.mode === 'static') continue;
      var r = s.el.getBoundingClientRect();
      if (r.bottom > -200 && r.top < window.innerHeight + 200) out.push(s);
    }
    return out;
  }

  function frame() {
    var list = active(), i, more = false;
    for (i = 0; i < list.length; i++) {
      if (list[i].step()) more = true;
    }
    if (more) { requestAnimationFrame(frame); } else { ticking = false; }
  }

  function kick() {
    var list = active(), i;
    for (i = 0; i < list.length; i++) {
      list[i].measure();
      if (list[i].target > 0.02) list[i].el.setAttribute('data-scrub-moved', '');
    }
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }

  var bound = false;
  function bindGlobal() {
    if (bound) return;
    bound = true;
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    kick();
  }

  var rt = null;
  function onResize() {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      for (var i = 0; i < instances.length; i++) {
        instances[i].resize();
        instances[i].render();
      }
      kick();
    }, 120);
  }

  /* ---------- старт ---------- */

  function init() {
    var els = document.querySelectorAll(SEL), i;
    for (i = 0; i < els.length; i++) {
      if (els[i].hasAttribute('data-scrub-init')) continue;
      els[i].setAttribute('data-scrub-init', '');
      try { instances.push(new Scrub(els[i])); } catch (e) { /* секция останется постером */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.RybtsehScrub = { init: init, instances: instances };
})();
