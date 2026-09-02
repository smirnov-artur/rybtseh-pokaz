/* ============================================================
   «АРТЕФАКТ» — базовый JS многостраничника РЫБЦЕХ.РФ
   Без CDN и зависимостей. Всё, что нужно строителю страниц:
     1. фиттер номерных пластин  [data-plate]
     2. мобильное меню            .burger + .drawer
     3. активный пункт навигации  по имени файла
     4. фон навигации, тёплое пятно света, служебная сноска
     5. появления                 [data-rv] → .is-in
     6. видео-контракт            video[data-autoplay] play-in-view
     7. рельс технологии          .tech__rail + .step
     8. каталог-опись             .item__btn (аккордеон)
     9. плавающая кнопка связи    .fab (строится из LINES)
   Подключать в конце <body>:
     <script src="assets/artefakt.js" defer></script>
   ============================================================ */
(function () {
  'use strict';

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var IO = 'IntersectionObserver' in window;
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  /* ------------------------------------------------------------------
     1. ФИТТЕР НОМЕРНЫХ ПЛАСТИН
     Разметка: <div class="plate" data-plate data-max="190"><span>РЫБЦЕХЪ</span></div>
     data-max — потолок кегля в px (необязателен).
     ------------------------------------------------------------------ */
  function fitPlates() {
    $$('[data-plate]').forEach(function (plate) {
      var span = plate.firstElementChild;
      if (!span) return;
      span.style.fontSize = '10px';          // схлопнуть, чтобы контейнер не остался раздутым
      var lim = plate.clientWidth;
      var vpw = document.documentElement.clientWidth || window.innerWidth || 0;
      if (vpw) {                              // плита не шире вьюпорта, даже если предок разъехался
        var pl = Math.max(0, plate.getBoundingClientRect().left);
        lim = Math.min(lim, Math.max(120, vpw - pl * 2));
      }
      var target = lim * 0.996;               // страховка от боковых свесов глифов
      if (!target) { span.style.fontSize = ''; return; }
      span.style.fontSize = '100px';
      var w = span.getBoundingClientRect().width;
      if (!w) return;
      var max = parseFloat(plate.getAttribute('data-max') || '0');
      var size = 100 * target / w;
      if (max && size > max) { span.style.fontSize = max + 'px'; return; }
      span.style.fontSize = size.toFixed(2) + 'px';
      var w2 = span.getBoundingClientRect().width;      // второй проход: кернинг округляется
      if (w2 && Math.abs(w2 - target) > 1) {
        var s2 = size * target / w2;
        span.style.fontSize = (max && s2 > max ? max : s2).toFixed(2) + 'px';
      }
    });
  }
  var fitT;
  function fitLater() { clearTimeout(fitT); fitT = setTimeout(fitPlates, 90); }
  fitPlates();
  window.addEventListener('resize', fitLater);
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fitPlates); }

  /* ------------------------------------------------------------------
     2. МОБИЛЬНОЕ МЕНЮ
     <button class="burger" aria-expanded="false" aria-controls="drawer">
     <div class="drawer" id="drawer">
     ------------------------------------------------------------------ */
  var burger = $('.burger'), drawer = $('.drawer');
  if (burger && drawer) {
    var setMenu = function (open) {
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      document.body.classList.toggle('menu-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () {
      setMenu(burger.getAttribute('aria-expanded') !== 'true');
    });
    drawer.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var was = burger.getAttribute('aria-expanded') === 'true';
      setMenu(false);
      if (was) burger.focus();
    });
  }

  /* ------------------------------------------------------------------
     3. АКТИВНЫЙ ПУНКТ НАВИГАЦИИ (многостраничник)
     index.html = '' и './' и 'index.html'
     ------------------------------------------------------------------ */
  var here = location.pathname.split('/').pop() || 'index.html';
  $$('.nav__menu a, .drawer a, .foot__nav a').forEach(function (a) {
    var t = (a.getAttribute('href') || '').split('#')[0].split('?')[0];
    if (t === here || (here === 'index.html' && (t === '' || t === './' || t === 'index.html'))) {
      a.setAttribute('aria-current', 'page');
      a.classList.add('is-active');
    }
  });

  /* ------------------------------------------------------------------
     4. ФОН НАВИГАЦИИ · ТЁПЛОЕ ПЯТНО · СЛУЖЕБНАЯ СНОСКА
     --bloom растёт к низу страницы; .is-deep включает сноску;
     .is-quiet гасит её над «тихими» зонами: [data-quiet] (прайс, каталог, контакты).
     ------------------------------------------------------------------ */
  var nav = $('.nav');
  var quiet = $$('[data-quiet]');
  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (nav) nav.classList.toggle('is-stuck', y > 40);

    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? Math.min(1, y / h) : 0;
    document.documentElement.style.setProperty('--bloom', (0.12 + p * 0.55).toFixed(3));
    document.body.classList.toggle('is-deep', y > window.innerHeight * 0.7);

    var mid = window.innerHeight * 0.5, hush = false;
    for (var i = 0; i < quiet.length; i++) {
      var r = quiet[i].getBoundingClientRect();
      if (r.top < mid && r.bottom > mid) { hush = true; break; }
    }
    document.body.classList.toggle('is-quiet', hush);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  /* ------------------------------------------------------------------
     5. ПОЯВЛЕНИЯ  [data-rv] → .is-in
     Прячем только после того, как убедились, что наблюдатель есть:
     без JS/без IO контент остаётся видимым.
     ------------------------------------------------------------------ */
  var revs = $$('[data-rv]');
  if (revs.length && IO && !RM) {
    document.body.classList.add('rv-armed');
    var rio = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); rio.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    revs.forEach(function (el) { rio.observe(el); });
    // подстраховка: всё, что оказалось выше вьюпорта при загрузке
    setTimeout(function () {
      revs.forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('is-in');
      });
    }, 1200);
  }

  /* ------------------------------------------------------------------
     6. ВИДЕО-КОНТРАКТ  play-in-view
     <video data-autoplay muted loop playsinline preload="none"
            poster="assets/img/poster-….jpg">
       <source src="assets/video/….mp4" type="video/mp4"></video>
     · prefers-reduced-motion — не запускаем, остаётся постер;
     · вне вьюпорта — пауза (батарея и сеть);
     · вкладка скрыта — пауза;
     · родителю .ph--vid ставим .is-playing, чтобы спрятать кружок play.
     Видео с controls (фильм, репортаж) НЕ помечать data-autoplay.
     ------------------------------------------------------------------ */
  var vids = $$('video[data-autoplay]');
  if (vids.length && !RM) {
    var mark = function (v, on) {
      var box = v.closest('.ph--vid') || v.closest('.ph');
      if (box) box.classList.toggle('is-playing', on);
    };
    var tryPlay = function (v) {
      v.muted = true;
      var p = v.play();
      if (p && p.then) p.then(function () { mark(v, true); }).catch(function () { /* автоплей запрещён — постер */ });
      else mark(v, true);
    };
    if (IO) {
      var vio = new IntersectionObserver(function (en) {
        en.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) { if (v.preload === 'none') v.preload = 'auto'; tryPlay(v); }
          else if (!v.paused) { v.pause(); mark(v, false); }
        });
      }, { rootMargin: '120px 0px', threshold: 0.15 });
      vids.forEach(function (v) { vio.observe(v); });
    } else {
      vids.forEach(tryPlay);
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) $$('video[data-autoplay]').forEach(function (v) { v.pause(); });
  });

  /* ------------------------------------------------------------------
     6b. ФИЛЬМ: РУЧНОЙ СТАРТ  video[data-clickstart]
     <figure class="ph ph--vid ph--shot ph--plain">
       <video data-clickstart playsinline preload="none" poster="…">…</video>
       <button class="ph__play" type="button" aria-label="Смотреть фильм"></button>
     · до старта — постер и кружок .ph__play, тот же, что на пяти автоплей-роликах:
       серой браузерной панели поверх музейной вёрстки не видно (гайд §5 «ноль UI-хрома»);
     · по клику включаем нативные controls (перемотка, полный экран, клавиатура)
       и запускаем — дальше Chrome сам прячет панель во время игры и отдаёт её по ховеру.
     ------------------------------------------------------------------ */
  $$('video[data-clickstart]').forEach(function (v) {
    var box = v.closest('.ph');
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      if (v.preload === 'none') v.preload = 'auto';
      v.controls = true;
      if (box) box.classList.add('is-playing');
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* браузер не дал — панель уже на месте */ });
    };
    if (box) {
      var btn = box.querySelector('.ph__play');
      if (btn) btn.addEventListener('click', start);
    }
    v.addEventListener('click', function () { if (!started) start(); });
    v.addEventListener('play', function () { if (box) box.classList.add('is-playing'); });
  });

  /* ------------------------------------------------------------------
     7. РЕЛЬС ТЕХНОЛОГИИ
     <div class="tech__rail"><button data-go="0">…</button></div>
     <article class="step" id="step-0">…</article>
     ------------------------------------------------------------------ */
  var rail = $('.tech__rail');
  var steps = $$('.step');
  if (rail && steps.length) {
    var btns = $$('button[data-go]', rail);
    var light = function (i) {
      btns.forEach(function (b, k) { b.classList.toggle('is-on', k === i); });
    };
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var t = steps[parseInt(b.getAttribute('data-go'), 10)];
        if (t) t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
      });
    });
    if (IO) {
      var sio = new IntersectionObserver(function (en) {
        en.forEach(function (e) { if (e.isIntersecting) light(steps.indexOf(e.target)); });
      }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
      steps.forEach(function (s) { sio.observe(s); });
    }
  }

  /* ------------------------------------------------------------------
     8. КАТАЛОГ-ОПИСЬ (аккордеон)
     <div class="item"><button class="item__btn">…</button>
       <div class="item__body"><div class="item__inner"><div class="item__pad">…
     ------------------------------------------------------------------ */
  $$('.item__btn').forEach(function (b) {
    var item = b.closest('.item');
    if (!item) return;
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () {
      var open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  /* ------------------------------------------------------------------
     9. ПЛАВАЮЩАЯ КНОПКА СВЯЗИ
     Строится здесь, чтобы быть одинаковой на всех страницах и на 404.
     Факты — только из ДАННЫЕ.md. Часов работы ОПТА в данных нет,
     поэтому в панели их нет: в подвале указаны часы магазина при цехе.
     · Escape, клик вне и крестик закрывают;
     · прячется, когда открыта шторка меню (CSS) и когда в кадре подвал;
     · служебная сноска .stampnote поднимается ровно на высоту кнопки
       (--fab-h), поэтому в правом нижнем углу они не пересекаются;
     · prefers-reduced-motion — без выезда и без анимации (CSS §25).
     ------------------------------------------------------------------ */
  var LINES = [
    { tag: 'Опт — партии от 100 кг',      short: 'опт',     name: 'Антон Дмитриевич',     tel: '79287702170', disp: '+7 928 770-21-70' },
    { tag: 'Розница — магазин и наличие', short: 'розница', name: 'Маргарита Георгиевна', tel: '79185949685', disp: '+7 918 594-96-85' }
  ];
  var ic = function (id) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#' + id + '"/></svg>'; };
  var msgRow = function (c) {
    var row =
      '<a class="msg" href="https://wa.me/' + c.tel + '" target="_blank" rel="noopener"' +
      ' aria-label="Написать в WhatsApp — ' + c.short + ', ' + c.name + '">' + ic('i-wa') + 'WhatsApp</a>' +
      '<a class="msg" href="https://t.me/+' + c.tel + '" target="_blank" rel="noopener"' +
      ' aria-label="Написать в Telegram — ' + c.short + ', ' + c.name + '">' + ic('i-tg') + 'Telegram</a>' +
      '<a class="msg" href="viber://chat?number=%2B' + c.tel + '"' +
      ' aria-label="Написать в Viber — ' + c.short + ', ' + c.name + '">' + ic('i-vb') + 'Viber</a>';

    /* MAX: вставить ссылку max.ru/u/<хеш> от Антона Дмитриевича и раскомментировать.
       Ссылок по номеру телефона у MAX нет — только персональная ссылка владельца
       аккаунта, поэтому кнопка лежит выключенной: включение — одна правка.
    if (c.tel === '79287702170') {
      row += '<a class="msg" href="https://max.ru/u/ХЕШ" target="_blank" rel="noopener"' +
        ' aria-label="Написать в MAX — ' + c.short + ', ' + c.name + '">' + ic('i-max') + 'MAX</a>';
    }
    */

    return '<p class="msgs">' + row + '</p>';
  };

  if (document.getElementById('i-wa')) {
    var fab = document.createElement('div');
    fab.className = 'fab';
    fab.innerHTML =
      '<div class="fab-panel" id="fabPanel" role="dialog" aria-modal="false" aria-label="Связаться с рыбцехом">' +
        '<div class="fab-head"><span class="lbl">Кому звонить</span>' +
          '<button class="fab-x" type="button" aria-label="Закрыть панель">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
        '</div>' +
        LINES.map(function (c) {
          return '<div class="fab-role">' +
            '<span class="lbl lbl--em">' + c.tag + '</span>' +
            '<a class="r-tel" href="tel:+' + c.tel + '" aria-label="Позвонить — ' + c.short + ', ' + c.name + ', ' + c.disp + '">' + c.disp + '</a>' +
            '<span class="lbl">' + c.name + '</span>' +
            msgRow(c) +
          '</div>';
        }).join('') +
        '<div class="fab-foot">' +
          '<a class="lbl" href="mailto:ak806@me.com">ak806@me.com</a>' +
          '<a class="lbl" href="https://vk.com/klevtsov_fish" target="_blank" rel="noopener">ВКонтакте</a>' +
        '</div>' +
      '</div>' +
      '<button class="fab-btn" type="button" aria-expanded="false" aria-controls="fabPanel" aria-label="Связаться с рыбцехом">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>' +
        '<span class="fab-btn__t">Связаться</span></button>';
    document.body.appendChild(fab);
    document.body.classList.add('has-fab');

    var fbtn = fab.querySelector('.fab-btn');
    var fpanel = fab.querySelector('.fab-panel');

    /* сноска встаёт ровно над кнопкой — высоту меряем, а не угадываем */
    var sizeFab = function () {
      var h = Math.round(fbtn.getBoundingClientRect().height);
      if (h) document.documentElement.style.setProperty('--fab-h', h + 'px');
    };
    sizeFab();
    window.addEventListener('resize', sizeFab, { passive: true });
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(sizeFab); }

    var setFab = function (open) {
      fab.classList.toggle('open', open);
      fbtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      /* фокус переводим следующим кадром: панель выезжает из visibility:hidden,
         и в тот же тик браузер фокус на ней ещё не принимает */
      if (open) {
        var t = fpanel.querySelector('.r-tel');
        if (t) setTimeout(function () { t.focus(); }, 0);
      }
    };
    fbtn.addEventListener('click', function () {
      setFab(fbtn.getAttribute('aria-expanded') !== 'true');
    });
    fab.querySelector('.fab-x').addEventListener('click', function () {
      setFab(false); fbtn.focus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && fab.classList.contains('open')) { setFab(false); fbtn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!fab.contains(e.target) && fab.classList.contains('open')) setFab(false);
    });
    fpanel.addEventListener('click', function (e) { if (e.target.closest('a')) setFab(false); });

    /* прямая ссылка на связь: любая страница + #svyaz открывает панель */
    var openByHash = function () { if (location.hash === '#svyaz') setFab(true); };
    openByHash();
    window.addEventListener('hashchange', openByHash);

    /* Не спорить со шторкой меню и не перекрывать блоки с контактами.
       Кнопка «Связаться» теряет смысл там, где телефоны и так перед глазами,
       а вися поверх них — ещё и закрывает цифры. Подвал прячет её всегда;
       любой другой блок — по атрибуту data-fab-hide в разметке страницы. */
    var covering = 0;
    var hideIf = function () {
      var menuOpen = burger && burger.getAttribute('aria-expanded') === 'true';
      var hide = !!menuOpen || covering > 0;
      fab.classList.toggle('away', hide);
      if (hide) setFab(false);
    };
    if (burger) burger.addEventListener('click', function () { setTimeout(hideIf, 0); });
    var shy = document.querySelectorAll('.foot,[data-fab-hide]');
    if (shy.length && IO) {
      var seen = new WeakSet();
      var sio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var was = seen.has(en.target);
          if (en.isIntersecting && !was) { seen.add(en.target); covering++; }
          else if (!en.isIntersecting && was) { seen.delete(en.target); covering--; }
        });
        if (covering < 0) covering = 0;
        hideIf();
      }, { rootMargin: '0px 0px -25% 0px' });
      for (var si = 0; si < shy.length; si++) sio.observe(shy[si]);
    }
  }

})();

/* ============================================================
   «АРТЕФАКТ» · СЛОЙ АНИМАЦИЙ  (дополнение, отдельный модуль)
   Ничего из базового JS не переопределяет. Всё выключается одним
   prefers-reduced-motion. Без IntersectionObserver / без @property
   страница остаётся полностью читаемой — деградация только в движении.
     A. свет из точки касания      [data-glow] + .pill/.ghost/.chip/…
     B. автостаггер появлений      [data-rv] внутри [data-stagger]
     C. материализация кадров      [data-mat] → .is-mat
     D. двухслойное появление      .blueprint → .is-draw → .is-mat → .is-done
     E. параллакс                  [data-par]
     F. split-text по словам       [data-split]
     G. счётчики                   [data-count]
     H. переходы страниц           View Transitions + фолбэк
     I. слой зерна .grade, магнитная .pill, рельс, лента .mq
   ============================================================ */
(function () {
  'use strict';

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var IO = 'IntersectionObserver' in window;
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* слой зерна: один div, чтобы не трогать разметку страниц */
  if (!document.querySelector('.grade')) {
    var g = document.createElement('div');
    g.className = 'grade';
    g.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(g, document.body.firstChild);
  }

  /* ------------------------------------------------------------------
     A. СВЕТ ИЗ ТОЧКИ КАСАНИЯ
     Один делегированный pointermove на документ: ставит --gx/--gy той
     цели, над которой курсор. Никаких слушателей на каждом элементе.
     ------------------------------------------------------------------ */
  var GLOW = '.pill,.ghost,.chip,.link,.card,.era,.pr,.item__btn,.nav__menu a,[data-glow]';
  if (!RM && window.matchMedia('(hover:hover)').matches) {
    var lastG = 0;
    document.addEventListener('pointermove', function (e) {
      var t = e.clientX, now = e.timeStamp || Date.now();
      if (now - lastG < 24) return;                 /* троттлинг как в igloo */
      lastG = now;
      var el = e.target.closest && e.target.closest(GLOW);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty('--gx', ((t - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });

    /* палец: свет зажигается в точке нажатия и там же гаснет */
    document.addEventListener('pointerdown', function (e) {
      var el = e.target.closest && e.target.closest(GLOW);
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--gx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* ------------------------------------------------------------------
     B. АВТОСТАГГЕР
     <div data-stagger> … <div data-rv> × N </div> — соседи просыпаются
     волной, разметке не нужны data-delay="1..8" руками.
     ------------------------------------------------------------------ */
  $$('[data-stagger]').forEach(function (box) {
    var kids = $$('[data-rv]', box).filter(function (k) {
      return k.parentNode.closest('[data-stagger]') === box;
    });
    var step = parseFloat(box.getAttribute('data-stagger')) || 1;
    kids.forEach(function (k, i) {
      if (!k.hasAttribute('data-delay')) k.style.setProperty('--i', (i * step).toFixed(2));
    });
  });

  /* ------------------------------------------------------------------
     C+D. МАТЕРИАЛИЗАЦИЯ И ДВУХСЛОЙНОЕ ПОЯВЛЕНИЕ
     [data-mat]  — кадр выступает из тьмы под полосой света.
     .blueprint  — сначала чертёж (рамка, приводочные линии, уголки),
                   через 0.6 с внутри него материализуется изображение,
                   ещё через 1.6 с чертёж гаснет. Тайминг интро igloo.
     ------------------------------------------------------------------ */
  var mats = $$('[data-mat]');
  if (mats.length && IO && !RM) {
    document.body.classList.add('rv-armed');       /* CSS слоя ждёт этот класс */

    $$('.blueprint').forEach(function (b) {
      if (b.querySelector('.bp')) return;
      var ink = document.createElement('i');
      ink.className = 'bp';
      ink.setAttribute('aria-hidden', 'true');
      ink.innerHTML = '<i class="bp__f"></i><i class="bp__v"></i><i class="bp__h"></i>' +
        '<i class="bp__c bp__c--tl"></i><i class="bp__c bp__c--tr"></i>' +
        '<i class="bp__c bp__c--bl"></i><i class="bp__c bp__c--br"></i>';
      b.appendChild(ink);
    });

    var fire = function (el) {
      var bp = el.classList.contains('blueprint');
      var wait = parseInt(el.getAttribute('data-mat-delay') || '0', 10);
      setTimeout(function () {
        if (bp) {
          el.classList.add('is-draw');
          setTimeout(function () { el.classList.add('is-mat'); }, 600);
          setTimeout(function () { el.classList.add('is-done'); }, 2200);
          /* Чертёж отработал — выносим его из DOM. Одной opacity мало:
             тонкие линии в отдельном слое переживают гашение родителя
             (ловилось на полигоне), да и висеть им дальше незачем. */
          setTimeout(function () {
            var ink = el.querySelector('.bp');
            if (ink && ink.parentNode) ink.parentNode.removeChild(ink);
          }, 4000);
        } else {
          el.classList.add('is-mat');
        }
      }, wait);
    };

    var mio = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (e.isIntersecting) { fire(e.target); mio.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    mats.forEach(function (m) { mio.observe(m); });

    /* страховка: то, что уже в кадре при загрузке (герой) */
    setTimeout(function () {
      mats.forEach(function (m) {
        var r = m.getBoundingClientRect();
        if (r.top < window.innerHeight && !m.classList.contains('is-mat')) fire(m);
      });
    }, 1400);
  }

  /* ------------------------------------------------------------------
     E. ПАРАЛЛАКС  [data-par="8"] — ход в процентах высоты слота (6…10).
     Считаем только для видимых слотов, обновляем на rAF по скроллу.
     ------------------------------------------------------------------ */
  var pars = $$('[data-par]');
  if (pars.length && !RM) {
    var live = pars;
    if (IO) {
      live = [];
      var pio = new IntersectionObserver(function (en) {
        en.forEach(function (e) {
          var i = live.indexOf(e.target);
          if (e.isIntersecting && i < 0) live.push(e.target);
          if (!e.isIntersecting && i >= 0) live.splice(i, 1);
        });
      }, { rootMargin: '20% 0px 20% 0px' });
      pars.forEach(function (p) { pio.observe(p); });
    }
    var pticking = false;
    var parStep = function () {
      pticking = false;
      var vh = window.innerHeight;
      live.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var amt = clamp(parseFloat(el.getAttribute('data-par')) || 8, 0, 14);
        /* −1 сверху экрана … +1 снизу */
        var t = clamp(((r.top + r.height / 2) / vh - 0.5) * 2, -1, 1);
        el.style.setProperty('--par', (t * r.height * amt / 200).toFixed(1) + 'px');
        el.style.setProperty('--par-s', (1 + amt / 100).toFixed(3));
      });
    };
    var parTick = function () { if (!pticking) { pticking = true; requestAnimationFrame(parStep); } };
    window.addEventListener('scroll', parTick, { passive: true });
    window.addEventListener('resize', parTick, { passive: true });
    parStep();
  }

  /* ------------------------------------------------------------------
     F. SPLIT-TEXT  [data-split] — разбивка ПО СЛОВАМ и появление волной.
     Режем только текстовые узлы: вложенные <span class="em">, <br>,
     ссылки внутри заголовка остаются живыми. Доступность: исходный текст
     кладём в aria-label, разбитое дерево прячем от скринридера.
     ------------------------------------------------------------------ */
  var splits = $$('[data-split]');
  if (splits.length && !RM) {
    var wi = 0;
    var cut = function (node, host) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.nodeValue.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var w = document.createElement('span');
            w.className = 'w';
            var i = document.createElement('i');
            i.textContent = p;
            i.style.setProperty('--wi', wi++);
            w.appendChild(i);
            frag.appendChild(w);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') {
          cut(n, host);
        }
      });
    };
    splits.forEach(function (h) {
      if (h.querySelector('.w')) return;
      var text = (h.textContent || '').replace(/\s+/g, ' ').trim();
      wi = 0;
      cut(h, h);
      if (text) h.setAttribute('aria-label', text);
      if (!h.hasAttribute('data-rv')) h.setAttribute('data-rv', 'none');
    });
  }

  /* Свой наблюдатель для заголовков: базовый модуль снял список [data-rv]
     раньше, чем мы дописали атрибут, — на него не рассчитываем. */
  if (splits.length && !RM && IO) {
    document.body.classList.add('rv-armed');
    var sio2 = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); sio2.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    splits.forEach(function (h) { sio2.observe(h); });
    setTimeout(function () {
      splits.forEach(function (h) {
        if (h.getBoundingClientRect().top < window.innerHeight) h.classList.add('is-in');
      });
    }, 1400);
  } else if (splits.length && (!IO || RM)) {
    splits.forEach(function (h) { h.classList.add('is-in'); });
  }

  /* ------------------------------------------------------------------
     G. СЧЁТЧИКИ  [data-count]
       <span class="cnt" data-count="1974">1974</span>
       data-count       — конечное число (обязательно)
       data-count-from  — старт (по умолчанию 0; для года удобно 1900)
       data-count-dur   — мс (по умолчанию 1600)
       data-count-sep   — "1" ставит неразрывный пробел разрядов
     Разметка обязана содержать конечное значение текстом: без JS
     и при reduce-motion на экране сразу правильное число.
     ------------------------------------------------------------------ */
  var cnts = $$('[data-count]');
  if (cnts.length && IO && !RM) {
    var fmt = function (v, sep) {
      var s = String(v);
      return sep ? s.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') : s;
    };
    var runCount = function (el) {
      var to = parseFloat(el.getAttribute('data-count'));
      if (!isFinite(to)) return;
      var from = parseFloat(el.getAttribute('data-count-from'));
      if (!isFinite(from)) from = 0;
      var dur = parseInt(el.getAttribute('data-count-dur') || '1600', 10);
      var sep = el.getAttribute('data-count-sep') === '1';
      var dec = (String(to).split('.')[1] || '').length;
      var t0 = 0;
      var frame = function (ts) {
        if (!t0) t0 = ts;
        var p = clamp((ts - t0) / dur, 0, 1);
        /* entry_ease_2 «на глаз»: быстрый разгон, мягкая посадка */
        var e = 1 - Math.pow(1 - p, 3);
        var v = from + (to - from) * e;
        el.textContent = fmt(dec ? v.toFixed(dec) : Math.round(v), sep);
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    var cio = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (e.isIntersecting) { runCount(e.target); cio.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    cnts.forEach(function (c) { cio.observe(c); });
  }

  /* ------------------------------------------------------------------
     H. ПЕРЕХОДЫ МЕЖДУ СТРАНИЦАМИ
     Кросс-документные View Transitions включены в CSS (@view-transition).
     Здесь только две вещи:
       1) именуем пластину героя и шапку — они переезжают, а не гаснут;
       2) фолбэк для браузеров без API: гасим свет перед уходом.
     Внешние ссылки, target=_blank, якоря, tel/mailto и #svyaz не трогаем.
     ------------------------------------------------------------------ */
  if (!RM) {
    var plate = document.querySelector('.hero__plate') || document.querySelector('[data-plate]');
    if (plate) plate.style.viewTransitionName = 'plate';
    var navEl = document.querySelector('.nav');
    if (navEl) navEl.style.viewTransitionName = 'nav';
  }

  var vtSupported = ('startViewTransition' in document) &&
    CSS.supports && CSS.supports('view-transition-name', 'x');
  if (!vtSupported && !RM) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
          e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (/^(#|tel:|mailto:|https?:\/\/)/i.test(href) && a.host !== location.host) return;
      if (href.charAt(0) === '#') return;
      var u;
      try { u = new URL(a.href); } catch (err) { return; }
      if (u.origin !== location.origin) return;
      if (u.pathname === location.pathname) return;      /* тот же документ */
      e.preventDefault();
      document.body.classList.add('vt-out');
      setTimeout(function () { location.href = a.href; }, 260);
    });
    /* возврат «назад» из bfcache не должен оставить страницу погашенной */
    window.addEventListener('pageshow', function () { document.body.classList.remove('vt-out'); });
  }

  /* ------------------------------------------------------------------
     I1. МАГНИТНАЯ .pill — единственная залитая кнопка страницы тянется
     к курсору на 6 px. Только при hover:hover, только без reduce-motion.
     ------------------------------------------------------------------ */
  if (!RM && window.matchMedia('(hover:hover)').matches) {
    $$('.pill').forEach(function (p) {
      p.addEventListener('pointerenter', function () { p.classList.add('is-mag'); });
      p.addEventListener('pointermove', function (e) {
        var r = p.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        p.style.setProperty('--mx', (clamp(dx, -1, 1) * 6).toFixed(1) + 'px');
        p.style.setProperty('--my', (clamp(dy, -1, 1) * 4).toFixed(1) + 'px');
      });
      p.addEventListener('pointerleave', function () {
        p.classList.remove('is-mag');
        p.style.setProperty('--mx', '0px'); p.style.setProperty('--my', '0px');
      });
    });
  }

  /* I2. РЕЛЬС ТЕХНОЛОГИИ: линия прогресса вдоль липких кнопок */
  var rail = document.querySelector('.tech__rail');
  var steps = $$('.step');
  if (rail && steps.length && !RM) {
    var railTick = function () {
      var first = steps[0].getBoundingClientRect();
      var last = steps[steps.length - 1].getBoundingClientRect();
      var total = (last.bottom - first.top) || 1;
      var p = clamp((window.innerHeight * 0.5 - first.top) / total, 0, 1);
      rail.style.setProperty('--rail', p.toFixed(3));
    };
    window.addEventListener('scroll', railTick, { passive: true });
    window.addEventListener('resize', railTick, { passive: true });
    railTick();
  }

  /* I3. ЛЕНТА ФАКТОВ .mq — дорожку дублируем, чтобы петля шла без шва */
  $$('.mq').forEach(function (m) {
    var t = m.querySelector('.mq__t');
    if (!t || t.dataset.doubled === '1') return;
    t.innerHTML = t.innerHTML + t.innerHTML;
    t.dataset.doubled = '1';
  });

})();

/* ============================================================
   «АРТЕФАКТ» · .vlabel КАК ПЕРЕТАСКИВАЕМАЯ ПОЛОСА ПРОКРУТКИ
   (дополнение, отдельный модуль — ничего из базового JS или из
   слоя анимаций не переопределяет).
   Прогрессивное улучшение: без этого модуля (или при
   prefers-reduced-motion, или на экранах ≤1024px, где .vlabel и
   так display:none в CSS) метка остаётся неподвижной декоративной
   подписью — ровно как была, вид не меняется ни на пиксель.
     - перетаскивание мышью и пальцем (Pointer Events, единый путь),
     - визуальное положение метки = текущая позиция прокрутки страницы,
     - клавиатура (стрелки, PageUp/PageDown, Home/End) при фокусе,
     - role="scrollbar" + aria-value* + aria-controls для чтения с экрана.
   ============================================================ */
(function () {
  'use strict';

  var els = document.querySelectorAll('.vlabel');
  if (!els.length) return;

  /* Полностью выключено при prefers-reduced-motion — без исключений,
     живой ползунок в этом режиме не включается вовсе. */
  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* matchMedia недоступен — считаем, что анимации разрешены */ }
  if (reduceMotion) return;

  /* Тот же порог, что и в CSS (.vlabel{display:none} на max-width:1024px) —
     ниже него элемент и так не виден, ставить перетаскивание незачем. */
  var mqNarrow = null;
  try { mqNarrow = window.matchMedia('(max-width:1024px)'); } catch (e) {}

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* id основной прокручиваемой области — .vlabel живёт вне <main>,
     aria-controls указывает на неё, если она есть на странице. */
  var scrollTarget = document.getElementById('main') || document.querySelector('main');
  if (scrollTarget && !scrollTarget.id) scrollTarget.id = 'vlabel-scrolltarget';

  Array.prototype.forEach.call(els, setup);

  function setup(el) {
    var enhanced = false;
    var dragging = false;
    var grabOffsetY = 0;
    var rafId = null;

    function scrollEl() {
      return document.scrollingElement || document.documentElement;
    }

    function maxScroll() {
      var se = scrollEl();
      return Math.max(0, se.scrollHeight - se.clientHeight);
    }

    /* Трек — от верхнего края (как в исходной вёрстке) до нижнего запаса,
       считаем каждый раз заново: высота самой метки разная от страницы к
       странице (текст разной длины) и меняется при ресайзе. */
    function trackRange() {
      var h = el.getBoundingClientRect().height;
      var margin = 16;
      var max = Math.max(0, window.innerHeight - h - margin);
      return { min: 0, max: max };
    }

    function fracFromScroll() {
      var ms = maxScroll();
      return ms > 0 ? clamp01(scrollEl().scrollTop / ms) : 0;
    }

    function applyFrac(frac) {
      frac = clamp01(frac);
      var t = trackRange();
      var y = t.min + (t.max - t.min) * frac;
      el.style.top = y + 'px';
      var pct = Math.round(frac * 100);
      el.setAttribute('aria-valuenow', String(pct));
      el.setAttribute('aria-valuetext', pct + '%');
    }

    function syncFromScroll() {
      if (dragging || !enhanced) return;
      applyFrac(fracFromScroll());
    }

    function onScroll() {
      if (rafId) return;
      rafId = window.requestAnimationFrame(function () {
        rafId = null;
        /* resize/scroll могли уже стоять в очереди rAF в момент, когда
           узкий экран/reduced-motion выключил улучшение — не даём этому
           отложенному кадру воскресить inline top после unenhance() */
        syncFromScroll();
      });
    }

    function setScrollFrac(frac) {
      var ms = maxScroll();
      var se = scrollEl();
      /* На сайте глобально включён CSS scroll-behavior:smooth — он подхватывает
         и обычное присваивание scrollTop, из-за чего страница «догоняла» бы
         курсор с анимационной задержкой. Во время перетаскивания нужен
         мгновенный отклик 1:1, поэтому явно просим instant. */
      if (typeof se.scrollTo === 'function') {
        se.scrollTo({ top: clamp01(frac) * ms, left: se.scrollLeft, behavior: 'instant' });
      } else {
        se.scrollTop = clamp01(frac) * ms;
      }
    }

    /* ---------- перетаскивание: мышь и палец через Pointer Events ---------- */
    function onPointerDown(e) {
      if (typeof e.button === 'number' && e.button !== 0) return;
      dragging = true;
      el.classList.add('is-dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      var rect = el.getBoundingClientRect();
      grabOffsetY = e.clientY - rect.top;   /* сохраняем точку хвата — без «прыжка» метки под курсор */
      e.preventDefault();
      /* preventDefault() на pointerdown в Chrome попутно гасит штатную
         фокусировку по клику — без явного focus() перетащивший мышью/пальцем
         не смог бы тут же продолжить стрелками, фокус остался бы на <body>. */
      try { el.focus({ preventScroll: true }); } catch (err) { try { el.focus(); } catch (e2) {} }
    }
    function onPointerMove(e) {
      if (!dragging) return;
      var t = trackRange();
      var range = t.max - t.min;
      var newTop = e.clientY - grabOffsetY;
      var frac = range > 0 ? (newTop - t.min) / range : 0;
      frac = clamp01(frac);
      applyFrac(frac);
      setScrollFrac(frac);
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      syncFromScroll();
    }

    /* ---------- клавиатура: стрелки, PageUp/PageDown, Home/End ---------- */
    function onKeydown(e) {
      var ms = maxScroll();
      if (ms <= 0) return;
      var se = scrollEl();
      var step = Math.max(40, window.innerHeight * 0.08);
      var page = window.innerHeight * 0.9;
      var handled = true;
      switch (e.key) {
        case 'ArrowUp': case 'ArrowLeft': se.scrollTop -= step; break;
        case 'ArrowDown': case 'ArrowRight': se.scrollTop += step; break;
        case 'PageUp': se.scrollTop -= page; break;
        case 'PageDown': se.scrollTop += page; break;
        case 'Home': se.scrollTop = 0; break;
        case 'End': se.scrollTop = ms; break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); syncFromScroll(); }
    }

    /* ---------- включение/выключение (узкий экран может меняться на лету) ---------- */
    function enhance() {
      if (enhanced) return;
      enhanced = true;
      el.setAttribute('role', 'scrollbar');
      el.setAttribute('aria-orientation', 'vertical');
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '100');
      el.setAttribute('aria-label', 'Прокрутка страницы');
      if (scrollTarget) el.setAttribute('aria-controls', scrollTarget.id);
      el.removeAttribute('aria-hidden');
      el.setAttribute('tabindex', '0');
      el.classList.add('is-scrollbar');
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
      el.addEventListener('keydown', onKeydown);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      syncFromScroll();
    }

    function unenhance() {
      if (!enhanced) return;
      enhanced = false;
      dragging = false;
      el.removeAttribute('role');
      el.removeAttribute('aria-orientation');
      el.removeAttribute('aria-valuemin');
      el.removeAttribute('aria-valuemax');
      el.removeAttribute('aria-valuenow');
      el.removeAttribute('aria-valuetext');
      el.removeAttribute('aria-label');
      el.removeAttribute('aria-controls');
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('tabindex');
      el.classList.remove('is-scrollbar', 'is-dragging');
      el.style.top = '';
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('keydown', onKeydown);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    }

    function isNarrow() {
      return mqNarrow ? mqNarrow.matches : (window.innerWidth <= 1024);
    }

    function update() {
      if (isNarrow()) unenhance(); else enhance();
    }

    update();
    if (mqNarrow) {
      if (mqNarrow.addEventListener) mqNarrow.addEventListener('change', update);
      else if (mqNarrow.addListener) mqNarrow.addListener(update); /* старые браузеры */
    }
  }

})();
