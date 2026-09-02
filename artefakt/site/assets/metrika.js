/*!
 * РЫБЦЕХ — Яндекс.Метрика: сниппет + цели + безопасная обёртка.
 * Без библиотек, работает с file://. Ничего не падает, если счётчик
 * не подставлен, заблокирован адблоком или пользователь просит Do Not Track.
 *
 * ПОДКЛЮЧЕНИЕ И НОМЕР СЧЁТЧИКА — см. README.md рядом с этим файлом.
 * Коротко: вставить номер счётчика в data-counter-id на теге <script>
 * ЛИБО в window.RYBTSEH_METRIKA = { id: 12345678 } до подключения файла.
 */
(function (window, document) {
  'use strict';

  var SELF = document.currentScript;
  var CFG = window.RYBTSEH_METRIKA || {};

  /* ЗАМЕНИТЬ: номер счётчика Яндекс.Метрики. Взять на https://metrika.yandex.ru/
     после регистрации сайта («Добавить счётчик» → «Номер счётчика» в самом верху
     страницы настроек, восьмизначное число). Если оставить плейсхолдер — скрипт
     сам ничего никуда не отправит (см. isPlaceholder ниже), сайт не сломается. */
  var PLACEHOLDER = 'XXXXXXX';
  var COUNTER_ID = CFG.id ||
    (SELF && SELF.getAttribute('data-counter-id')) ||
    PLACEHOLDER;

  var isPlaceholder = (String(COUNTER_ID) === PLACEHOLDER || !COUNTER_ID);

  /* ---------- Do Not Track ---------- */
  function dntRequested() {
    var v = window.doNotTrack || navigator.doNotTrack || navigator.msDoNotTrack || '';
    v = String(v);
    return v === '1' || v === 'yes' || v.toLowerCase() === 'true';
  }

  var DNT = dntRequested();
  var enabled = !isPlaceholder && !DNT;

  /* ---------- Загрузка счётчика (официальный сниппет, без изменений логики) ---------- */
  function installCounter() {
    if (!enabled) return;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments) };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
      k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

    window.ym(COUNTER_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true,
      trackHash: true,          /* сайты — одностраничные переходы по якорям внутри страниц */
      defer: true               /* не блокировать первую отрисовку */
    });
  }

  installCounter();

  /* ---------- Безопасный вызов целей ---------- */
  /* Никогда не бросает исключение: счётчик может быть не загружен (адблок,
     офлайн, ещё не успел прогрузиться) — вызовы целей в этом случае просто
     тихо игнорируются. НЕ передавайте сюда персональные данные (имя, телефон,
     адрес, точный список товаров) — только агрегаты и категории, см. README. */
  function reachGoal(name, params) {
    try {
      if (!enabled) return false;
      if (typeof window.ym !== 'function') return false;
      window.ym(COUNTER_ID, 'reachGoal', name, params || undefined);
      return true;
    } catch (e) {
      return false;
    }
  }

  function hit(url, params) {
    try {
      if (!enabled || typeof window.ym !== 'function') return false;
      window.ym(COUNTER_ID, 'hit', url || (location.pathname + location.search), params || undefined);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Публичный API — можно звать целями руками со страниц/других компонентов:
     RybtsehAnalytics.reachGoal('goal_id', {опционально: 'число или строка без ПДн'}) */
  var Analytics = window.RybtsehAnalytics = {
    reachGoal: reachGoal,
    hit: hit,
    isEnabled: function () { return enabled; },
    isDNT: function () { return DNT; },
    counterId: function () { return isPlaceholder ? null : COUNTER_ID; }
  };

  /* ---------- Утилита делегирования кликов ---------- */
  function onClickMatch(selector, handler) {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (el) handler(el, e);
    }, true);
  }

  var firedOnce = {};
  function once(key, fn) {
    if (firedOnce[key]) return;
    firedOnce[key] = true;
    fn();
  }

  /* =====================================================================
     ЦЕЛИ — ЗВОНОК И МЕССЕНДЖЕРЫ
     Ловим по факту href, а не по классу/тексту — переживает любую вёрстку
     и правки других агентов на страницах сайта.
     ===================================================================== */
  onClickMatch('a[href^="tel:"]', function (el) {
    reachGoal('phone_click', { section: nearestSection(el) });
  });

  onClickMatch('a[href*="wa.me"], a[href*="api.whatsapp.com"]', function (el) {
    reachGoal('messenger_click_whatsapp', { section: nearestSection(el) });
  });

  onClickMatch('a[href*="t.me/"], a[href^="tg://"]', function (el) {
    reachGoal('messenger_click_telegram', { section: nearestSection(el) });
  });

  onClickMatch('a[href^="viber:"]', function (el) {
    reachGoal('messenger_click_viber', { section: nearestSection(el) });
  });

  /* «Раздел» — какой блок страницы (шапка/подвал/герой и т.д.), если он
     размечен атрибутом id у ближайшей секции. Данные не персональные —
     просто помогает понять, какой блок страницы работает лучше. */
  function nearestSection(el) {
    var s = el.closest ? el.closest('section[id], header, footer') : null;
    return s && s.id ? s.id : (s ? s.tagName.toLowerCase() : '');
  }

  /* =====================================================================
     ЦЕЛЬ — ПЕРЕХОД НА СТРАНИЦУ ОПТА
     Считаем сам факт просмотра страницы (надёжнее, чем ловить клик по
     ссылке «Оптовикам» — переход мог быть и по прямой ссылке/закладке).
     ===================================================================== */
  (function () {
    var path = String(location.pathname || '');
    if (/(^|\/)opt\.html$/.test(path)) {
      once('opt_page_view', function () { reachGoal('opt_page_view'); });
    }
  })();

  /* =====================================================================
     ЦЕЛЬ — СКАЧИВАНИЕ / ПЕЧАТЬ ПРАЙСА
     beforeprint срабатывает и на Ctrl+P, и на печать из меню браузера,
     и на любой будущий вызов window.print() — без привязки к конкретной
     кнопке, которой сегодня на странице ещё нет.
     Отдельно ловим клик по ссылке на файл прайса, если/когда он появится
     (a[href$=".pdf"], a[download]) — уже сегодня не ломается, что его нет.
     ===================================================================== */
  window.addEventListener('beforeprint', function () {
    reachGoal('price_print', { path: location.pathname });
  });

  onClickMatch('a[download], a[href$=".pdf" i]', function (el) {
    reachGoal('price_download', { href: el.getAttribute('href') || '' });
  });

  /* =====================================================================
     ЦЕЛЬ — ПРОСМОТР ФИЛЬМА
     Разделяем постановочный ролик о вялении (сгенерирован) и репортаж
     Первого канала (настоящая съёмка 2008 года) — это разные по природе
     ролики, владельцу полезно видеть их отдельно. Определяем по src
     видео, а не по id/классу — переживает правки вёрстки.
     Декоративные фоновые видео (data-autoplay, зацикленные, без звука,
     без controls) НЕ считаем «просмотром» — считаем только ролики,
     которые пользователь осознанно запускает (controls или data-clickstart).
     ===================================================================== */
  function videoKind(videoEl) {
    var src = '';
    if (videoEl.currentSrc) src = videoEl.currentSrc;
    else {
      var s = videoEl.querySelector('source');
      src = (s && s.getAttribute('src')) || videoEl.getAttribute('src') || '';
    }
    src = src.toLowerCase();
    if (!src) return null;
    if (src.indexOf('1tv') !== -1 || src.indexOf('istoria-1tv') !== -1) return 'report_1tv';
    if (src.indexOf('kino') !== -1 || src.indexOf('film') !== -1) return 'production_film';
    return null;
  }

  function isFeatureVideo(videoEl) {
    /* «фильм, который смотрят», а не фоновая петля-обои */
    return videoEl.hasAttribute('controls') || videoEl.hasAttribute('data-clickstart');
  }

  document.addEventListener('play', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || !isFeatureVideo(v)) return;
    var kind = videoKind(v);
    if (!kind) return;
    once('video_play_' + kind, function () {
      reachGoal(kind === 'report_1tv' ? 'report_1tv_view' : 'film_view', { kind: kind });
    });
  }, true);

  /* =====================================================================
     ЦЕЛЬ — ОТПРАВКА ЗАЯВКИ ИЗ КОМПОНЕНТА «ORDER»
     КОМПОНЕНТЫ\order\order.js СЕГОДНЯ НЕ ИСПУСКАЕТ СОБСТВЕННЫХ СОБЫТИЙ —
     см. README.md, п. «Что стоит добавить в order.js», предложенный патч
     (2 строки на каждый sendXxx) там же. Пока патч не применён, слушаем
     то, что уже стабильно есть в разметке: кнопки панели заявки помечены
     data-ord="wa|tg|ml|cp" (order.js, строки ~284, 321–324, 749).
     Если в будущем order.js станет слать CustomEvent
     'rybtseh:order-send' — этот файл предпочтёт его (не задублирует цель).
     ===================================================================== */
  var ORDER_GOALS = { wa: 'order_send_whatsapp', tg: 'order_send_telegram', ml: 'order_send_mail', cp: 'order_send_copy' };
  var orderEventSeen = false;

  /* Предпочтительный путь — если order.js когда-нибудь начнёт слать событие */
  document.addEventListener('rybtseh:order-send', function (e) {
    orderEventSeen = true;
    var d = (e && e.detail) || {};
    var channel = d.channel || 'unknown';
    var name = ORDER_GOALS[channel] || ('order_send_' + channel);
    reachGoal(name, safeOrderParams(d));
  });

  /* Резервный путь — работает уже сегодня, без правок order.js.

     ВНИМАНИЕ, из-за чего тут отложенный запуск. Делегирование ловит клик
     на ПЕРЕХВАТЕ, то есть раньше, чем order.js на всплытии успеет послать
     своё событие. Поэтому при первом же клике orderEventSeen ещё false,
     резервный путь срабатывает — а следом приходит событие, и цель уходит
     ВТОРОЙ раз. Дальше дубля нет, но первая отправка на каждой загрузке
     страницы считалась дважды.

     Лечится сдвигом на один такт: событие (оно рассылается синхронно
     внутри обработчика order.js) успевает прийти раньше, и резервный путь
     сам себя отменяет. */
  onClickMatch('[data-ord="wa"], [data-ord="tg"], [data-ord="ml"], [data-ord="cp"]', function (el) {
    if (orderEventSeen) return;                        /* событие уже покрывает цель — не дублируем */
    var kind = el.getAttribute('data-ord');
    var goal = ORDER_GOALS[kind];
    if (!goal) return;
    var params = safeOrderParams(readOrderState());
    /* order.js сам ничего не шлёт, если заявка пуста (см. sendWA/sendTG/sendMail/sendCopy) —
       повторяем ту же проверку, чтобы не считать пустые клики отправкой */
    if (params && typeof params.positions === 'number' && params.positions === 0) return;
    setTimeout(function () {
      if (orderEventSeen) return;                      /* событие всё-таки пришло — цель уже засчитана */
      reachGoal(goal, params);
    }, 0);
  });

  function readOrderState() {
    try {
      if (window.RybtsehOrder && typeof window.RybtsehOrder.state === 'function') {
        return window.RybtsehOrder.state();
      }
    } catch (e) { /* публичный API мог измениться/отсутствовать — не падаем */ }
    return null;
  }

  /* Только агрегаты (число позиций/вес/сумма) — никаких названий товаров,
     имён, телефонов и прочих персональных данных в цели не уходит. */
  function safeOrderParams(s) {
    if (!s) return {};
    var out = {};
    if (typeof s.positions === 'number') out.positions = s.positions;
    else if (typeof s.count === 'number') out.positions = s.count;
    if (typeof s.kg === 'number') out.kg = Math.round(s.kg);
    if (typeof s.total === 'number') out.sum = Math.round(s.total);
    return out;
  }

})(window, document);
