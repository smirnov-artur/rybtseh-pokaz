/* ============================================================
   «РОССО» — базовый JS многостраничника РЫБЦЕХ.РФ
   Минимум: мобильное меню · появления по IntersectionObserver ·
   видео-контракт play-in-view + prefers-reduced-motion ·
   подсветка активного пункта навигации.
   Подключать в конце <body>: <script src="assets/rosso.js" defer></script>
   ============================================================ */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Мобильное меню (бургер + шторка) ----------
     Разметка: <button class="burger" aria-expanded="false" aria-controls="drawer">
               <nav class="drawer" id="drawer"> */
  var burger = document.querySelector('.burger');
  var drawer = document.querySelector('.drawer');
  if (burger && drawer) {
    var setMenu = function (open) {
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      drawer.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () {
      setMenu(burger.getAttribute('aria-expanded') !== 'true');
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      /* Закрыть — и вернуть фокус туда, откуда меню открывали: иначе после
         Esc фокус проваливается в body, и с клавиатуры продолжить неоткуда. */
      var wasOpen = burger.getAttribute('aria-expanded') === 'true';
      setMenu(false);
      if (wasOpen) burger.focus();
    });
  }

  /* ---------- 2. Активный пункт навигации ----------
     Сравнивает href со своим именем файла; index.html = "" и "index.html". */
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a, .drawer a').forEach(function (a) {
    var target = (a.getAttribute('href') || '').split('#')[0].split('?')[0];
    if (target === here || (here === 'index.html' && (target === '' || target === './' || target === 'index.html'))) {
      a.setAttribute('aria-current', 'page');
    }
  });

  /* ---------- 3. Появления (.rev → .rev.in) ----------
     Разметка: class="rev", опционально data-delay="1|2|3". */
  var revs = document.querySelectorAll('.rev');
  if (revs.length) {
    if (REDUCED || !('IntersectionObserver' in window)) {
      revs.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      revs.forEach(function (el) { io.observe(el); });
    }
  }

  /* ---------- 4. Видео-контракт play-in-view ----------
     Разметка: <video data-autoplay muted playsinline loop
                      preload="none" poster="assets/img/poster-….jpg">
                 <source src="assets/video/….mp4" type="video/mp4">
               </video>
     Атрибут muted обязателен в разметке; JS дублирует его для надёжности.
     При prefers-reduced-motion видео не запускается — остаётся постер.
     Вне вьюпорта видео ставится на паузу (экономия батареи/сети). */
  var vids = document.querySelectorAll('video[data-autoplay]');
  if (vids.length && !REDUCED) {
    var tryPlay = function (v) {
      v.muted = true;
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* автоплей запрещён — остаётся постер */ });
    };
    if ('IntersectionObserver' in window) {
      var vio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var v = en.target;
          if (en.isIntersecting) {
            if (v.preload === 'none') v.preload = 'auto';
            tryPlay(v);
          } else if (!v.paused) {
            v.pause();
          }
        });
      }, { rootMargin: '120px 0px', threshold: 0.15 });
      vids.forEach(function (v) { vio.observe(v); });
    } else {
      vids.forEach(tryPlay);
    }
  }

  /* ---------- 5. Пауза всех фоновых видео при скрытии вкладки ---------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      document.querySelectorAll('video[data-autoplay]').forEach(function (v) { v.pause(); });
    }
  });

  /* ---------- 6. Плавающая кнопка связи ----------
     Строится здесь, чтобы быть одинаковой на всех страницах.
     Факты — только из ДАННЫЕ.md. Часов работы опта в данных нет,
     поэтому в панели их нет: часы указаны отдельно как часы магазина.
     Escape и клик вне закрывают. Прячется, когда открыта шторка меню
     или когда в кадре футер (чтобы не перекрывать контакты и низ страницы). */
  var LINES = [
    { tag: 'Опт',      name: 'Антон Дмитриевич',     tel: '79287702170', disp: '+7 928 770-21-70' },
    { tag: 'Розница',  name: 'Маргарита Георгиевна', tel: '79185949685', disp: '+7 918 594-96-85' }
  ];
  var ic = function (id) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#' + id + '"/></svg>'; };
  var msgRow = function (c) {
    var row =
      '<a class="msg" href="https://wa.me/' + c.tel + '" target="_blank" rel="noopener"' +
      ' aria-label="Написать в WhatsApp: ' + c.tag + ', ' + c.name + '">' + ic('i-wa') + 'WhatsApp</a>' +
      '<a class="msg" href="https://t.me/+' + c.tel + '" target="_blank" rel="noopener"' +
      ' aria-label="Написать в Telegram: ' + c.tag + ', ' + c.name + '">' + ic('i-tg') + 'Telegram</a>' +
      '<a class="msg" href="viber://chat?number=%2B' + c.tel + '"' +
      ' aria-label="Написать в Viber: ' + c.tag + ', ' + c.name + '">' + ic('i-vb') + 'Viber</a>';

    /* MAX: вставить ссылку max.ru/u/<хеш> от Антона Дмитриевича и раскомментировать.
       У MAX нет ссылок по номеру телефона — только персональная ссылка владельца
       аккаунта, поэтому кнопка лежит выключенной: включение — одна правка.
    if (c.tel === '79287702170') {
      row += '<a class="msg" href="https://max.ru/u/ХЕШ" target="_blank" rel="noopener"' +
        ' aria-label="Написать в MAX: ' + c.tag + ', ' + c.name + '">' + ic('i-max') + 'MAX</a>';
    }
    */

    return '<p class="msgs">' + row + '</p>';
  };

  if (document.getElementById('i-wa')) {
    var fab = document.createElement('div');
    fab.className = 'fab';
    fab.innerHTML =
      '<div class="fab-panel" id="fabPanel" role="dialog" aria-modal="false" aria-label="Связаться с рыбцехом">' +
        '<div class="fab-head"><span>Связаться</span>' +
          '<button class="fab-x" type="button" aria-label="Закрыть панель связи">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
        '</div>' +
        LINES.map(function (c) {
          return '<div class="fab-role">' +
            '<span class="r-tag">' + c.tag + '</span>' +
            '<p class="r-name">' + c.name + '</p>' +
            '<a class="r-tel" href="tel:+' + c.tel + '" aria-label="Позвонить: ' + c.tag + ', ' + c.name + ', ' + c.disp + '">' + c.disp + '</a>' +
            msgRow(c) +
          '</div>';
        }).join('') +
        '<div class="fab-foot">' +
          '<a href="mailto:ak806@me.com">ak806@me.com</a>' +
          '<a href="https://vk.com/klevtsov_fish" target="_blank" rel="noopener">ВКонтакте</a>' +
        '</div>' +
      '</div>' +
      '<button class="fab-btn" type="button" aria-expanded="false" aria-controls="fabPanel">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>' +
        '<b>Связь</b></button>';
    document.body.appendChild(fab);

    var fbtn = fab.querySelector('.fab-btn');
    var fpanel = fab.querySelector('.fab-panel');

    /* Высота кнопки — в CSS-переменную --fab-h, чтобы плавающая кнопка
       заявки (.ord-fab, order.css) вставала над ней, а не под ней:
       меряем реальный рендер, а не угадываем цифру (шрифт/подпись могут
       поменяться). Используется только на price.html, но переменную
       ставим везде — дешёво и не мешает остальным страницам. */
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
      if (open) { var t = fpanel.querySelector('.r-tel'); if (t) t.focus(); }
      /* Две панели разом — связь и заявка — перекрывали друг друга на
         306×318px. Открывается одна: вторая закрывается. */
      if (open && window.RybtsehOrder && typeof window.RybtsehOrder.close === 'function') {
        try { window.RybtsehOrder.close(); } catch (err) {}
      }
    };
    /* …и в обратную сторону: панель заявки открылась — панель связи уходит.
       У order.js нет события открытия, поэтому следим за классом. */
    if ('MutationObserver' in window) {
      var watchOrder = function () {
        var op = document.querySelector('.ord-panel');
        if (!op) return false;
        new MutationObserver(function () {
          if (op.classList.contains('is-on') && fab.classList.contains('open')) setFab(false);
        }).observe(op, { attributes: true, attributeFilter: ['class'] });
        return true;
      };
      if (!watchOrder()) window.addEventListener('load', watchOrder);
    }
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
    fpanel.addEventListener('click', function (e) {
      if (e.target.closest('a')) setFab(false);
    });

    /* Прямая ссылка на связь: любая страница + #svyaz открывает панель */
    var openByHash = function () {
      if (location.hash === '#svyaz') setFab(true);
    };
    openByHash();
    window.addEventListener('hashchange', openByHash);

    /* Не перекрывать футер и не спорить со шторкой меню */
    var hideIf = function () {
      var menuOpen = burger && burger.getAttribute('aria-expanded') === 'true';
      fab.classList.toggle('away', !!menuOpen || fab.dataset.foot === '1');
      if (menuOpen || fab.dataset.foot === '1') setFab(false);
    };
    if (burger) burger.addEventListener('click', function () { setTimeout(hideIf, 0); });
    var foot = document.querySelector('footer');
    if (foot && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { fab.dataset.foot = en.isIntersecting ? '1' : '0'; });
        hideIf();
      }, { rootMargin: '0px 0px -30% 0px' }).observe(foot);
    }
  }
})();

/* ============================================================
   СЛОЙ АНИМАЦИЙ «РОССО» — часть 1: появления, split-text, счётчики
   Отдельный IIFE: базовый блок выше не трогаем.
   Всё через IntersectionObserver, ноль зависимостей.
   ============================================================ */
(function () {
  'use strict';
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var REDUCED = mq.matches;

  /* ---------- A. Появления [data-rv] со стаггером внутри группы ----------
     Разметка:
       <div data-rv-group>            — контейнер группы (задаёт очередь)
         <div data-rv="up"></div>     — up | fade | left | right | line | mask | mask-up
         <div data-rv="up"></div>
       </div>
     data-st="1|2|3" — шаг стаггера (40 / 60 / 80 мс).
     Индекс внутри группы JS кладёт в --i; задержку считает CSS. */
  var rvs = [].slice.call(document.querySelectorAll('[data-rv]'));

  document.querySelectorAll('[data-rv-group]').forEach(function (g) {
    var kids = g.querySelectorAll('[data-rv]');
    for (var i = 0; i < kids.length; i++) kids[i].style.setProperty('--i', i);
  });

  function reveal(el) { el.classList.add('in'); }

  if (rvs.length) {
    if (REDUCED || !('IntersectionObserver' in window)) {
      rvs.forEach(reveal);
    } else {
      /* Порог 6% отсекает появление, когда виден лишь край блока.
         Но у блока ВЫШЕ экрана эта доля недостижима или почти недостижима:
         таблица прайса на 50 строк (~4700px) при этом не открывалась вовсе.
         Поэтому слушаем оба рубежа и для высоких блоков берём сам факт
         пересечения. Порог по площади остаётся для обычных блоков. */
      var rio = new IntersectionObserver(function (en) {
        en.forEach(function (e) {
          if (!e.isIntersecting) return;
          var rootH = (e.rootBounds && e.rootBounds.height) || window.innerHeight || 1;
          var tall = e.boundingClientRect.height > rootH * 0.9;
          if (!tall && e.intersectionRatio < 0.06) return;
          reveal(e.target);
          rio.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: [0, 0.06] });
      rvs.forEach(function (el) { rio.observe(el); });
    }
  }

  /* ---------- B. Split-text [data-split]: разбивка по СЛОВАМ ----------
     Разметка: <h2 data-split>Вяленый лещ Цимлы</h2>
     Каждое слово оборачивается в <span class="sw"><i>слово</i></span>,
     маска .sw обрезает, <i> встаёт из-под кромки волной по --i.
     Вложенная разметка (<em>, <br>) сохраняется: обходим текстовые узлы. */
  var splits = [].slice.call(document.querySelectorAll('[data-split]'));

  function wrapWords(root) {
    var n = 0;
    var walk = function (node) {
      var kids = [].slice.call(node.childNodes);
      kids.forEach(function (ch) {
        if (ch.nodeType === 3) {
          var parts = ch.nodeValue.split(/(\s+)/);
          if (!ch.nodeValue.trim()) return;
          var frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            var s = document.createElement('span'); s.className = 'sw';
            var i = document.createElement('i'); i.textContent = p;
            i.style.setProperty('--i', n++);
            s.appendChild(i); frag.appendChild(s);
          });
          node.replaceChild(frag, ch);
        } else if (ch.nodeType === 1 && ch.tagName !== 'BR' && !ch.classList.contains('sw')) {
          walk(ch);
        }
      });
    };
    walk(root);
    return n;
  }

  if (splits.length && !REDUCED) {
    splits.forEach(function (el) {
      if (el.dataset.splitDone) return;
      wrapWords(el);
      el.dataset.splitDone = '1';
    });
    if ('IntersectionObserver' in window) {
      var sio = new IntersectionObserver(function (en) {
        en.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          sio.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
      splits.forEach(function (el) { sio.observe(el); });
    } else {
      splits.forEach(function (el) { el.classList.add('in'); });
    }
  } else {
    splits.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- C. Счётчики [data-count] ----------
     Разметка: <b class="num" data-count>1 990</b>  — цель берётся из текста,
               <b data-count="60">60</b>            — или из атрибута.
     Небуквенное окружение («₽», «°C», «−») сохраняется. Формат — ru,
     неразрывный пробел в тысячах. Табличные цифры в CSS — строка не дёргается. */
  var counts = [].slice.call(document.querySelectorAll('[data-count]'));

  /* \u0427\u0438\u0441\u043b\u043e \u0438\u0449\u0435\u043c \u0442\u0430\u043a, \u0447\u0442\u043e\u0431\u044b \u041d\u0415 \u0437\u0430\u0445\u0432\u0430\u0442\u0438\u0442\u044c \u043f\u0440\u043e\u0431\u0435\u043b \u043f\u043e\u0441\u043b\u0435 \u043d\u0435\u0433\u043e: \u0440\u0430\u043d\u044c\u0448\u0435 \u00ab48 \u0447\u0430\u0441\u043e\u0432\u00bb
     \u043f\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u043b\u043e\u0441\u044c \u0432 \u00ab48\u0447\u0430\u0441\u043e\u0432\u00bb, \u043f\u043e\u0442\u043e\u043c\u0443 \u0447\u0442\u043e [\d ]* \u0436\u0430\u0434\u043d\u043e \u0441\u044a\u0435\u0434\u0430\u043b \u0440\u0430\u0437\u0434\u0435\u043b\u0438\u0442\u0435\u043b\u044c.
     \u0420\u0430\u0437\u0440\u044f\u0434\u044b \u0441\u0442\u0430\u0432\u0438\u043c \u0442\u043e\u043b\u044c\u043a\u043e \u0442\u0430\u043c, \u0433\u0434\u0435 \u043e\u043d\u0438 \u0431\u044b\u043b\u0438 \u0432 \u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0435: \u00ab1 990\u00bb \u043e\u0441\u0442\u0430\u043d\u0435\u0442\u0441\u044f
     \u0441 \u043f\u0440\u043e\u0431\u0435\u043b\u043e\u043c, \u0430 \u0433\u043e\u0434 \u00ab1967\u00bb \u2014 \u0433\u043e\u0434\u043e\u043c, \u0430 \u043d\u0435 \u00ab1 967\u00bb. */
  var NUM_RE = /-?\d(?:[\d ]*\d)?/;

  function runCount(el) {
    var raw = el.getAttribute('data-count');
    var src = (raw && raw.trim()) ? raw : el.textContent;
    src = String(src).replace(/\u00a0/g, ' ');
    var m = src.match(NUM_RE);
    if (!m) return;
    var target = parseInt(m[0].replace(/ /g, ''), 10);
    if (isNaN(target)) return;
    var pre = (raw && raw.trim()) ? '' : src.slice(0, m.index);
    var post = (raw && raw.trim()) ? '' : src.slice(m.index + m[0].length);
    var grouped = / /.test(m[0]);
    if (raw && raw.trim()) {
      var t = el.textContent.replace(/\u00a0/g, ' ');
      var tm = t.match(NUM_RE);
      if (tm) { pre = t.slice(0, tm.index); post = t.slice(tm.index + tm[0].length); grouped = / /.test(tm[0]); }
    }
    var sepAttr = el.getAttribute('data-count-sep');
    if (sepAttr === '0' || sepAttr === 'no') grouped = false;
    if (sepAttr === '1' || sepAttr === 'yes') grouped = true;
    var fmt = function (v) {
      var body = String(v);
      if (grouped) body = body.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
      return pre + body + post;
    };
    var dur = parseInt(el.getAttribute('data-count-dur'), 10) || 900, t0 = 0;
    var ease = function (p) { return 1 - Math.pow(1 - p, 3); };   /* out-cubic ≈ entry_ease */
    var tick = function (ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      el.textContent = fmt(Math.round(ease(p) * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  if (counts.length && !REDUCED && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (!e.isIntersecting) return;
        runCount(e.target);
        cio.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.4 });
    counts.forEach(function (el) { cio.observe(el); });
  }
})();

/* ============================================================
   СЛОЙ АНИМАЦИЙ «РОССО» — часть 2:
   параллакс · шапка на скролле · магнитная CTA · переходы страниц
   ============================================================ */
(function () {
  'use strict';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = window.matchMedia('(any-hover:hover) and (pointer:fine)').matches;

  /* ---------- D. Параллакс фонов [data-plx="6…10"] ----------
     Разметка: <img class="ph-img" data-plx="8" …> внутри .ph / .hero-media
     (контейнер обязан быть overflow:hidden — у обоих он есть).
     CSS растит кадр на --plx и поднимает на половину; JS двигает --py. */
  var plx = [].slice.call(document.querySelectorAll('[data-plx]'));
  if (plx.length && !REDUCED) {
    plx.forEach(function (el) {
      var v = parseFloat(el.getAttribute('data-plx')) || 8;
      v = Math.max(4, Math.min(12, v));
      el.style.setProperty('--plx', v + '%');
      el._plxAmp = v;
    });
    var ticking = false;
    var onPlx = function () {
      var vh = window.innerHeight || 1;
      plx.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var p = (r.top + r.height / 2 - vh / 2) / vh;      /* −1…1 */
        p = Math.max(-1.4, Math.min(1.4, p));
        var amp = r.height * el._plxAmp / 200;
        el.style.setProperty('--py', (p * amp).toFixed(1) + 'px');
      });
      ticking = false;
    };
    var reqPlx = function () { if (!ticking) { ticking = true; requestAnimationFrame(onPlx); } };
    window.addEventListener('scroll', reqPlx, { passive: true });
    window.addEventListener('resize', reqPlx);
    onPlx();
  }

  /* ---------- E. Шапка уезжает при скролле вниз (приём Ferrari) ----------
     .is-stuck — подложка с блюром, как только ушли с самого верха.
     .is-hidden — увели вверх на свою высоту; возвращается на скролле вверх,
     при открытой шторке меню и при фокусе с клавиатуры внутри шапки. */
  var bar = document.querySelector('.topbar');
  if (bar) {
    var last = window.pageYOffset, tick2 = false;
    var burg = document.querySelector('.burger');
    var upd = function () {
      var y = window.pageYOffset;
      bar.classList.toggle('is-stuck', y > 8);
      var menuOpen = burg && burg.getAttribute('aria-expanded') === 'true';
      var focusIn = bar.contains(document.activeElement);
      if (!REDUCED && !menuOpen && !focusIn) {
        if (y > 160 && y > last + 4) bar.classList.add('is-hidden');
        else if (y < last - 4 || y <= 160) bar.classList.remove('is-hidden');
      } else {
        bar.classList.remove('is-hidden');
      }
      last = y; tick2 = false;
    };
    window.addEventListener('scroll', function () {
      if (!tick2) { tick2 = true; requestAnimationFrame(upd); }
    }, { passive: true });
    bar.addEventListener('focusin', function () { bar.classList.remove('is-hidden'); });
    upd();
  }

  /* ---------- F. Магнитная кнопка — ровно одна CTA на страницу ----------
     Только .btn-red и только с настоящим указателем. Радиус 90 px,
     смещение 26 % — курсор всегда остаётся внутри кнопки. */
  var cta = document.querySelector('.btn-red');
  if (cta && FINE && !REDUCED) {
    var R = 90, K = 0.26, raf = null, mx = 0, my = 0;
    var apply = function () {
      cta.style.setProperty('--mx', mx.toFixed(1) + 'px');
      cta.style.setProperty('--my', my.toFixed(1) + 'px');
      raf = null;
    };
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = cta.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var near = Math.abs(dx) < r.width / 2 + R && Math.abs(dy) < r.height / 2 + R;
      cta.classList.toggle('is-pulling', near);
      mx = near ? dx * K : 0;
      my = near ? dy * K : 0;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
    window.addEventListener('blur', function () { mx = my = 0; apply(); cta.classList.remove('is-pulling'); });
  }

  /* ---------- G. Переходы между страницами ----------
     Chrome 126+ / Safari 18.2+ делают кросс-документный переход сами
     по правилу @view-transition в CSS: шапка, нижняя полоса и кнопка
     связи держатся (view-transition-name), контент кроссфейдится.
     Здесь — только фолбэк для остальных: гасим контент на 300 мс. */
  var hasVT = !!document.startViewTransition;
  if (!hasVT && !REDUCED) {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      /* tel:, mailto:, viber:, javascript: — не наши */
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      document.documentElement.classList.add('is-leaving');
      setTimeout(function () { location.href = a.href; }, 280);
    });
    window.addEventListener('pageshow', function () {
      document.documentElement.classList.remove('is-leaving');
    });
  }
})();

/* ---------- фильмы: постер + кнопка, системные контролы только после первого клика ---------- */
(function () {
  var stages = document.querySelectorAll('.film-stage, .report-stage');
  for (var i = 0; i < stages.length; i++) (function (box) {
    var v = box.querySelector('video[data-film]'), b = box.querySelector('.film-play');
    if (!v || !b) return;
    var started = false;
    function start() {
      if (started) return; started = true;
      if (v.preload === 'none') v.preload = 'auto';
      v.controls = true; box.classList.add('is-playing');
      var p = v.play(); if (p && p.catch) p.catch(function () { /* браузер не дал — контролы уже на месте */ });
    }
    b.addEventListener('click', start);
    v.addEventListener('click', function () { if (!started) start(); });
    v.addEventListener('play', function () { started = true; v.controls = true; box.classList.add('is-playing'); });
  })(stages[i]);
})();

/* ---------- хроника: стрелки листают ленту на ширину карточки ---------- */
(function () {
  var view = document.querySelector('.chron-view'); if (!view) return;
  var btns = document.querySelectorAll('.chron-btn[data-chron]'); if (!btns.length) return;
  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function step() {
    var items = view.querySelectorAll('.chron-item');
    if (items.length > 1) return items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().left;
    return view.clientWidth * .8;
  }
  function sync() {
    var max = view.scrollWidth - view.clientWidth - 1;
    for (var i = 0; i < btns.length; i++) {
      var d = +btns[i].getAttribute('data-chron');
      btns[i].disabled = d < 0 ? view.scrollLeft <= 0 : view.scrollLeft >= max;
    }
  }
  for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () {
    var d = +this.getAttribute('data-chron');
    view.scrollBy({ left: d * step(), top: 0, behavior: RM ? 'auto' : 'smooth' });
  });
  view.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  sync();
})();
