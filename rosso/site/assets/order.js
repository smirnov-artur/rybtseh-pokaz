/* ============================================================
   РЫБЦЕХ — «ЗАЯВКА ИЗ ПРАЙСА» (order.js)
   Сборка заказа прямо в прайсе + отправка в мессенджер.
   Без библиотек. Работает с file://. Данные — только window.PRICES.
   Подключать ПОСЛЕ assets/prices.js и после скрипта рендера прайса.
   Настройка — data-атрибутами на теге <script> или window.ORDER_CONFIG.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 0. КОНФИГ ---------- */
  var SELF = document.currentScript ||
    (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var DS = (SELF && SELF.dataset) || {};
  var USER = window.ORDER_CONFIG || {};

  function cfg(key, dflt) {
    if (USER[key] !== undefined && USER[key] !== null && USER[key] !== '') return USER[key];
    if (DS[key] !== undefined && DS[key] !== null && DS[key] !== '') return DS[key];
    return dflt;
  }
  function num(v, dflt) { var n = parseFloat(v); return isFinite(n) ? n : dflt; }

  var C = {
    theme: cfg('theme', 'auto'),
    /* строки прайса: сначала явный data-order-id, потом вёрстки обоих сайтов */
    rows: cfg('rows', '[data-order-id], tr.pr, .table .pr'),
    /* контейнер, за перерисовкой которого следим */
    root: cfg('root', ''),
    /* ячейка с названием внутри строки */
    nameCell: cfg('nameCell', '.nm, .pr__n, [data-order-name]'),
    /* кнопки режима цен самого прайса — компонент их нажимает и слушает */
    pageOpt: cfg('pageOpt', '#modeOpt, #fMode [data-m="opt"]'),
    pageRetail: cfg('pageRetail', '#modeRetail, #fMode [data-m="retail"]'),
    /* элементы-признаки режима: селектор → класс «сейчас опт» */
    modeFlags: cfg('modeFlags', '#prBody:mode-opt, #table:is-opt'),
    /* «селектор:подпись» — бейдж, который сайт рисует через ::after ячейки имени
       (у «Россо» это «СПЕЦ» на фирменных позициях). Оригинал гасится в CSS,
       такой же значок компонент рисует внутри своей полосы. Пусто — не трогать. */
    rowTag: cfg('rowTag', '.spec:СПЕЦ'),
    /* контакты — из ДАННЫЕ.md */
    wa: String(cfg('wa', '79287702170')).replace(/\D/g, ''),
    tg: cfg('tg', 'https://t.me/+79287702170'),
    mail: cfg('mail', 'ak806@me.com'),
    subject: cfg('subject', 'Заявка с сайта РЫБЦЕХ.РФ'),
    site: cfg('site', 'РЫБЦЕХ.РФ'),
    store: cfg('store', 'rybtseh-order-v1'),
    /* условия опта — из ДАННЫЕ.md; 0 = условие не задано, ничего не обещаем */
    optMinTotal: num(cfg('optMinTotal', 100), 100),
    optMinPos: num(cfg('optMinPos', 10), 10),
    /* кириллица в URL — 6 символов на букву, поэтому лимиты щедрые, но разные:
       wa.me держит длинную ссылку, а mailto упирается в ~2000 у Outlook/Windows */
    urlMax: num(cfg('urlMax', 8000), 8000),
    mailMax: num(cfg('mailMax', 1900), 1900)
  };

  var P = window.PRICES;
  if (!P || !P.items || !P.items.length) return;      /* прайса нет — молча выходим */

  /* ---------- 1. УТИЛИТЫ ---------- */
  var NBSP = / /g;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* нормализация для сопоставления строки прайса с позицией каталога */
  function key(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/g, '');
  }
  function money(v) {
    if (v == null || isNaN(v)) return '—';
    var kop = Math.round(v * 100) % 100 !== 0;
    return v.toLocaleString('ru-RU', {
      minimumFractionDigits: kop ? 2 : 0, maximumFractionDigits: 2
    }) + ' ₽';
  }
  function qtyText(v) {
    var r = Math.round(v * 1000) / 1000;
    return r.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  }
  function plural(n, a, b, c) {
    var n10 = Math.floor(n) % 10, n100 = Math.floor(n) % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return b;
    return c;
  }
  function plain(s) { return String(s).replace(NBSP, ' '); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function on(node, ev, fn) { if (node) node.addEventListener(ev, fn); }

  /* ---------- 2. КАТАЛОГ ---------- */
  var BY_ID = {};                 /* id → позиция                          */
  var KEYS = [];                  /* [ключ, id] — для сопоставления по тексту */
  P.items.forEach(function (it) {
    BY_ID[it.id] = it;
    KEYS.push([key(it.name + ' ' + (it.variant || '')), it.id]);
  });
  /* длинные ключи вперёд: строка прайса начинается с «имя+вариант», далее теги */
  KEYS.sort(function (a, b) { return b[0].length - a[0].length; });

  function itemByText(txt) {
    var k = key(txt);
    if (!k) return null;
    for (var i = 0; i < KEYS.length; i++) {
      if (k.indexOf(KEYS[i][0]) === 0) return BY_ID[KEYS[i][1]];
    }
    return null;
  }
  function unitOf(it) { return it.unit || 'кг'; }
  /* «20 кг», но «3 банки»: килограмм не склоняем, штучные единицы — да */
  function unitText(it, qty) {
    var u = unitOf(it);
    if (u === 'банка') return plural(qty, 'банка', 'банки', 'банок');
    return u;
  }
  function isKg(it) { return unitOf(it) === 'кг'; }
  function stepOf(it) { return 1; }
  function minOf(it) { return isKg(it) ? 0.1 : 1; }
  function priceOf(it, mode) { return (mode === 'opt' ? it.price_opt : it.price_retail); }

  /* количество из строки ввода: «10,5» и «10.5» одинаково валидны */
  function parseQty(raw, it) {
    var v = parseFloat(String(raw).replace(',', '.').replace(/[^\d.]/g, ''));
    if (!isFinite(v) || v <= 0) return 0;
    if (!isKg(it)) v = Math.round(v);
    else v = Math.round(v * 1000) / 1000;
    return v > 0 ? v : 0;
  }

  /* ---------- 3. СОСТОЯНИЕ + LOCALSTORAGE ---------- */
  var state = { mode: 'retail', items: [] };   /* items: [{id, qty}] — порядок добавления */

  function storeRead() {
    try {
      var raw = window.localStorage.getItem(C.store);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return null;
      return d;
    } catch (e) { return null; }
  }
  function storeWrite() {
    try {
      window.localStorage.setItem(C.store, JSON.stringify({
        v: 1, mode: state.mode, ts: Date.now(),
        items: state.items.map(function (l) { return { id: l.id, qty: l.qty }; })
      }));
    } catch (e) { /* приватный режим / переполнение — работаем без сохранения */ }
  }
  function restore() {
    var d = storeRead();
    if (!d) return;
    if (d.mode === 'opt' || d.mode === 'retail') state.mode = d.mode;
    if (Object.prototype.toString.call(d.items) === '[object Array]') {
      d.items.forEach(function (l) {
        var it = l && BY_ID[l.id];
        if (!it) return;                                   /* позиции нет в прайсе — выкидываем */
        var q = parseQty(l.qty, it);
        if (q > 0) state.items.push({ id: it.id, qty: q });
      });
    }
  }

  function find(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }
  function qtyOf(id) { var l = find(id); return l ? l.qty : 0; }

  function setQty(id, q) {
    var it = BY_ID[id];
    if (!it) return;
    var l = find(id);
    if (q > 0) {
      if (l) l.qty = q; else state.items.push({ id: id, qty: q });
    } else if (l) {
      state.items.splice(state.items.indexOf(l), 1);
    }
    storeWrite();
    paint();
  }
  function clearAll() { state.items = []; storeWrite(); paint(); }

  /* ---------- 4. ПОДСЧЁТ ---------- */
  function calc() {
    var r = {
      lines: [], total: 0, count: 0, kg: 0, jars: 0,
      under: [],                 /* позиции ниже минимума по позиции (кг)  */
      optReady: false
    };
    state.items.forEach(function (l) {
      var it = BY_ID[l.id];
      if (!it) return;
      var p = priceOf(it, state.mode);
      var sum = Math.round(p * l.qty * 100) / 100;
      r.lines.push({ it: it, qty: l.qty, price: p, sum: sum });
      r.total += sum;
      r.count++;
      if (isKg(it)) {
        r.kg += l.qty;
        if (C.optMinPos > 0 && l.qty < C.optMinPos) r.under.push(it.id);
      } else r.jars += l.qty;
    });
    r.total = Math.round(r.total * 100) / 100;
    r.kg = Math.round(r.kg * 1000) / 1000;
    r.optReady = C.optMinTotal > 0 && r.kg >= C.optMinTotal && r.under.length === 0;
    return r;
  }

  /* ---------- 5. ТЕМА ---------- */
  (function theme() {
    var root = document.documentElement;
    if (root.getAttribute('data-order-theme')) return;      /* задана вручную — уважаем */
    var t = C.theme;
    if (t === 'auto') {
      t = document.querySelector('.prtab') ? 'rosso'
        : (document.querySelector('.table .pr, #tbody') ? 'artefakt' : 'rosso');
    }
    root.setAttribute('data-order-theme', t);
  })();

  /* ---------- 6. СТЕППЕР (общая фабрика для строки и панели) ---------- */
  function stepper(it, opts) {
    var box = el('div', 'ord-q');
    box.setAttribute('role', 'group');
    var label = 'Количество, ' + unitOf(it) + ' — ' + it.name + (it.variant ? ', ' + it.variant : '');
    box.setAttribute('aria-label', label);

    var dec = el('button', 'ord-q__b', '&minus;');
    dec.type = 'button';
    dec.setAttribute('aria-label', 'Уменьшить количество');
    var inp = document.createElement('input');
    inp.className = 'ord-q__i ord-num';
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.autocomplete = 'off';
    inp.setAttribute('aria-label', label);
    var unit = el('span', 'ord-q__u', esc(unitOf(it)));
    var inc = el('button', 'ord-q__b', '+');
    inc.type = 'button';
    inc.setAttribute('aria-label', 'Увеличить количество');

    box.appendChild(dec); box.appendChild(inp); box.appendChild(unit); box.appendChild(inc);

    function read() { return parseQty(inp.value, it); }
    function write(v) { inp.value = v > 0 ? qtyText(v) : ''; }

    function bump(sign) {
      var v = read() || 0;
      v = Math.round((v + sign * stepOf(it)) * 1000) / 1000;
      if (v < minOf(it)) v = sign > 0 ? minOf(it) : 0;
      write(v);
      opts.onChange(v);
    }
    on(dec, 'click', function () { bump(-1); });
    on(inc, 'click', function () { bump(1); });
    on(inp, 'input', function () { opts.onChange(read()); });
    on(inp, 'blur', function () { write(read()); });
    on(inp, 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); write(read()); opts.onEnter && opts.onEnter(read()); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
    });

    return { node: box, input: inp, read: read, write: write };
  }

  /* ---------- 7. КАРКАС ПАНЕЛИ ---------- */
  var ICON = {
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a8.8 8.8 0 0 0-7.5 13.4L3.3 20.7l4.3-1.1A8.8 8.8 0 1 0 12 3.2Z"/><path d="M9.1 8.2h1.2l.9 2-1 .8a5.4 5.4 0 0 0 2.5 2.5l.8-1 2 .9v1.2a1 1 0 0 1-1 1 6.9 6.9 0 0 1-6.4-6.4 1 1 0 0 1 1-1Z"/></svg>',
    tg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4 3.9 2.9 10.8a.45.45 0 0 0 0 .85l4.6 1.6 1.7 4.9a.45.45 0 0 0 .8.12l2.4-2.9 4.5 3.3a.45.45 0 0 0 .7-.25l3.5-13.9a.45.45 0 0 0-.7-.52Z"/></svg>',
    ml: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5h17v13h-17z"/><path d="m3.9 6.2 8.1 6.3 8.1-6.3"/></svg>',
    cp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9z"/><path d="M15 9V4H4v11h5"/></svg>'
  };

  var fab = el('button', 'ord-fab is-empty',
    '<span class="ord-fab__t">Заявка</span>' +
    '<span class="ord-fab__n ord-num" data-ord="n">0</span>' +
    '<span class="ord-fab__s ord-num" data-ord="s"></span>');
  fab.type = 'button';
  fab.id = 'ordFab';
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'ordPanel');

  var backdrop = el('div', 'ord-backdrop');
  backdrop.hidden = true;

  var panel = el('aside', 'ord-panel',
    '<div class="ord-head">' +
      '<h2 id="ordTitle">Заявка</h2>' +
      '<span class="ord-cap" data-ord="cap"></span>' +
      '<button type="button" class="ord-x" data-ord="close" aria-label="Закрыть заявку">&times;</button>' +
    '</div>' +
    '<div class="ord-mode">' +
      '<span class="ord-cap">Цены</span>' +
      '<div class="ord-seg" role="group" aria-label="Тип цены в заявке">' +
        '<button type="button" data-ord="retail" aria-pressed="true">Розница</button>' +
        '<button type="button" data-ord="opt" aria-pressed="false">Опт</button>' +
      '</div>' +
    '</div>' +
    '<ul class="ord-list" data-ord="list"></ul>' +
    '<div class="ord-empty" data-ord="empty">' +
      '<p>Пока пусто.</p>' +
      '<span class="ord-cap">Укажите количество в строке прайса и нажмите «В заявку»</span>' +
    '</div>' +
    '<div class="ord-sum">' +
      '<div class="ord-sum__r"><span>Позиций</span><b data-ord="cnt">0</b></div>' +
      '<div class="ord-sum__r"><span>Вес</span><b data-ord="kg">0 кг</b></div>' +
      '<div class="ord-total"><span>Итого</span><b class="ord-num" data-ord="total">0 ₽</b></div>' +
      '<div class="ord-bar" data-ord="bar" hidden><i></i></div>' +
      '<p class="ord-hint" data-ord="hint" hidden></p>' +
      '<p class="ord-sr" data-ord="live" aria-live="polite"></p>' +
    '</div>' +
    '<div class="ord-send">' +
      '<button type="button" class="ord-b ord-b--solid" data-ord="wa">' + ICON.wa + 'WhatsApp</button>' +
      '<button type="button" class="ord-b" data-ord="tg">' + ICON.tg + 'Telegram</button>' +
      '<button type="button" class="ord-b" data-ord="ml">' + ICON.ml + 'Почта</button>' +
      '<button type="button" class="ord-b" data-ord="cp">' + ICON.cp + 'Скопировать</button>' +
    '</div>' +
    '<div class="ord-foot">' +
      '<span class="ord-cap" data-ord="terms"></span>' +
      '<button type="button" class="ord-link" data-ord="clear">Очистить</button>' +
    '</div>');
  panel.id = 'ordPanel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'ordTitle');
  panel.setAttribute('aria-modal', 'false');

  var toast = el('div', 'ord-toast');
  toast.hidden = true;
  toast.setAttribute('role', 'status');

  function q(name) { return panel.querySelector('[data-ord="' + name + '"]'); }
  var UI = {
    list: q('list'), empty: q('empty'), cnt: q('cnt'), kg: q('kg'), total: q('total'),
    hint: q('hint'), bar: q('bar'), live: q('live'), cap: q('cap'), terms: q('terms'),
    retail: q('retail'), opt: q('opt'),
    fabN: fab.querySelector('[data-ord="n"]'), fabS: fab.querySelector('[data-ord="s"]')
  };

  function mount() {
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(fab);
    document.body.appendChild(toast);
    UI.terms.textContent = P.updated ? ('Прайс от ' + P.updated.split('-').reverse().join('.')) : '';
  }

  /* ---------- 8. РЕНДЕР СПИСКА ПАНЕЛИ ---------- */
  var lineSteppers = {};          /* id → степпер строки панели */

  function renderList(r) {
    UI.list.innerHTML = '';
    lineSteppers = {};
    UI.empty.hidden = r.lines.length > 0;

    r.lines.forEach(function (ln) {
      var it = ln.it;
      var li = el('li', 'ord-line' +
        (C.optMinPos > 0 && state.mode === 'opt' && isKg(it) && ln.qty < C.optMinPos ? ' is-under' : ''));

      var nm = el('div', 'ord-line__n',
        '<b>' + esc(it.name) + '</b>' +
        (it.variant ? '<span>' + esc(it.variant) + '</span>' : ''));

      var qBox = el('div', 'ord-line__q');
      var st = stepper(it, {
        onChange: function (v) { setQty(it.id, v); }
      });
      st.write(ln.qty);
      qBox.appendChild(st.node);
      lineSteppers[it.id] = st;

      var sum = el('div', 'ord-line__s',
        '<b class="ord-num">' + esc(money(ln.sum)) + '</b>' +
        '<span>' + esc(qtyText(ln.qty) + ' ' + unitText(it, ln.qty) + ' × ' + money(ln.price)) + '</span>');

      var x = el('button', 'ord-line__x', '&times;');
      x.type = 'button';
      x.setAttribute('aria-label', 'Убрать из заявки: ' + it.name + (it.variant ? ', ' + it.variant : ''));
      on(x, 'click', function () {
        setQty(it.id, 0);
        (UI.list.querySelector('input,button') || panel.querySelector('[data-ord="close"]')).focus();
      });

      li.appendChild(nm); li.appendChild(x); li.appendChild(qBox); li.appendChild(sum);
      UI.list.appendChild(li);
    });
  }

  /* ---------- 9. ПОДСКАЗКА ПО ОПТУ (строго из условий прайса) ---------- */
  function optHint(r) {
    /* условие не сформулировано числом — ничего не выдумываем */
    if (!(C.optMinTotal > 0)) {
      UI.bar.hidden = true;
      if (P.opt_terms) { UI.hint.textContent = P.opt_terms; UI.hint.hidden = false; }
      else UI.hint.hidden = true;
      return;
    }
    var need = Math.round((C.optMinTotal - r.kg) * 1000) / 1000;
    var pct = Math.max(0, Math.min(100, (r.kg / C.optMinTotal) * 100));
    UI.bar.hidden = false;
    UI.bar.classList.toggle('is-done', r.optReady);
    UI.bar.firstChild.style.width = pct + '%';

    var txt;
    if (r.count === 0) {
      txt = 'Опт — от ' + qtyText(C.optMinTotal) + ' кг в ассортименте' +
        (C.optMinPos > 0 ? ', не менее ' + qtyText(C.optMinPos) + ' кг по позиции' : '') + '.';
    } else if (need > 0) {
      txt = 'До оптовой цены — ещё <b>' + qtyText(need) + ' кг</b> (набрано ' +
        qtyText(r.kg) + ' из ' + qtyText(C.optMinTotal) + ' кг).';
    } else if (r.under.length) {
      txt = 'Вес набран, но ' + r.under.length + ' ' +
        plural(r.under.length, 'позиция', 'позиции', 'позиций') + ' ниже <b>' +
        qtyText(C.optMinPos) + ' кг</b> — минимума по одной позиции.';
    } else {
      txt = 'Условие опта выполнено: ' + qtyText(r.kg) + ' кг в ассортименте.';
    }
    if (r.jars > 0) {
      txt += ' Икра считается за банку — в килограммы не входит.';
    }
    UI.hint.innerHTML = txt;
    UI.hint.hidden = false;
  }

  /* ---------- 10. ОБЩАЯ ПЕРЕРИСОВКА ---------- */
  var painting = false;

  function paint() {
    if (painting) return;
    painting = true;

    var r = calc();
    renderList(r);

    UI.cnt.textContent = String(r.count);
    UI.kg.textContent = qtyText(r.kg) + ' кг' + (r.jars ? ' + ' + qtyText(r.jars) + ' ' +
      plural(r.jars, 'банка', 'банки', 'банок') : '');
    UI.total.textContent = money(r.total);
    UI.cap.textContent = state.mode === 'opt' ? 'Оптовые цены' : 'Розничные цены';
    optHint(r);

    UI.retail.classList.toggle('is-on', state.mode !== 'opt');
    UI.opt.classList.toggle('is-on', state.mode === 'opt');
    UI.retail.setAttribute('aria-pressed', state.mode !== 'opt' ? 'true' : 'false');
    UI.opt.setAttribute('aria-pressed', state.mode === 'opt' ? 'true' : 'false');

    fab.classList.toggle('is-empty', r.count === 0);
    UI.fabN.textContent = String(r.count);
    UI.fabS.textContent = money(r.total);
    fab.setAttribute('aria-label', r.count === 0
      ? 'Заявка пуста — открыть панель заявки'
      : 'Заявка: ' + r.count + ' ' + plural(r.count, 'позиция', 'позиции', 'позиций') +
        ', итого ' + plain(money(r.total)) + ' — открыть панель');

    UI.live.textContent = r.count + ' ' + plural(r.count, 'позиция', 'позиции', 'позиций') +
      ', итого ' + plain(money(r.total)) + ', ' +
      (state.mode === 'opt' ? 'оптовые цены' : 'розничные цены');

    ['wa', 'tg', 'ml', 'cp'].forEach(function (k) { q(k).disabled = r.count === 0; });

    paintRows();
    painting = false;
  }

  /* ---------- 11. КОНТРОЛЫ В СТРОКАХ ПРАЙСА ---------- */
  var rowCtl = [];                /* [{id, ctl, st, btn, note}] */

  /* куда вставлять: в <tr> — в ячейку имени, иначе в саму строку-грид */
  function mountPoint(row) {
    if (row.tagName === 'TR') {
      return row.querySelector(C.nameCell) || row.querySelector('td') || row;
    }
    return row;
  }

  function attach(row) {
    if (row.getAttribute('data-ord-done') === '1') return;

    var id = row.getAttribute('data-order-id') || '';
    var it = id && BY_ID[id] ? BY_ID[id] : null;
    if (!it) {
      var cell = row.querySelector(C.nameCell) || row;
      it = itemByText(cell.textContent);
    }
    if (!it) return;                                   /* строка не опознана — не трогаем */
    row.setAttribute('data-ord-done', '1');

    var ctl = el('div', 'ord-ctl');
    var st = stepper(it, { onChange: function () { sync(rec); }, onEnter: function () { act(rec); } });
    var btn = el('button', 'ord-b', 'В заявку');
    btn.type = 'button';
    var note = el('span', 'ord-ctl__note');

    ctl.appendChild(st.node);
    ctl.appendChild(btn);
    ctl.appendChild(note);
    if (C.rowTag) {
      var p = String(C.rowTag).split(':');
      try {
        if (p[0] && p[1] && row.matches(p[0])) ctl.appendChild(el('span', 'ord-ctl__tag', esc(p[1])));
      } catch (e) { /* кривой селектор в конфиге — просто без бейджа */ }
    }
    mountPoint(row).appendChild(ctl);

    var rec = { id: it.id, it: it, row: row, ctl: ctl, st: st, btn: btn, note: note };
    on(btn, 'click', function () { act(rec); });
    rowCtl.push(rec);
    dressRow(rec);
    return rec;
  }

  /* нажатие кнопки строки: добавить / обновить / убрать */
  function act(rec) {
    var inBasket = qtyOf(rec.id) > 0;
    if (inBasket) {
      setQty(rec.id, 0);
      rec.st.write(0);
      rec.st.input.focus();
    } else {
      var v = rec.st.read();
      if (!(v > 0)) { v = isKg(rec.it) ? 1 : 1; rec.st.write(v); }
      setQty(rec.id, v);
      flash('«' + rec.it.name + '» в заявке: ' + qtyText(v) + ' ' + unitText(rec.it, v));
    }
  }
  /* правка числа в строке, когда позиция уже в заявке — сразу в заявку */
  function sync(rec) {
    if (qtyOf(rec.id) > 0) setQty(rec.id, rec.st.read());
  }

  function dressRow(rec) {
    var qv = qtyOf(rec.id);
    var inB = qv > 0;
    rec.ctl.classList.toggle('is-in', inB);
    rec.btn.textContent = inB ? 'Убрать' : 'В заявку';
    rec.btn.setAttribute('aria-label',
      (inB ? 'Убрать из заявки: ' : 'Добавить в заявку: ') +
      rec.it.name + (rec.it.variant ? ', ' + rec.it.variant : ''));
    rec.note.textContent = inB
      ? ('в заявке · ' + plain(money(Math.round(priceOf(rec.it, state.mode) * qv * 100) / 100)))
      : '';
    if (inB && rec.st.read() !== qv) rec.st.write(qv);
    /* не в заявке и поле пустое — показываем 1, чтобы контрол не выглядел сломанным */
    if (!inB && document.activeElement !== rec.st.input && rec.st.read() === 0) rec.st.write(1);
  }

  function paintRows() {
    for (var i = rowCtl.length - 1; i >= 0; i--) {
      if (!rowCtl[i].row.isConnected) { rowCtl.splice(i, 1); continue; }
      dressRow(rowCtl[i]);
    }
  }

  function scan() {
    var rows = document.querySelectorAll(C.rows);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].closest('.ord-panel')) continue;
      attach(rows[i]);
    }
    paintRows();
  }

  /* прайс «Артефакта» перерисовывает строки целиком — следим и переклеиваем */
  function watch() {
    var root = C.root ? document.querySelector(C.root) : null;
    if (!root) {
      var probe = document.querySelector(C.rows);
      root = probe ? (probe.closest('#tbody, table, .table, tbody') || document.body) : document.body;
    }
    if (!window.MutationObserver) return;
    var timer = null;
    new MutationObserver(function () {
      if (timer) return;
      timer = setTimeout(function () { timer = null; scan(); }, 60);
    }).observe(root, { childList: true, subtree: true });
  }

  /* ---------- 12. РЕЖИМ ЦЕН: панель ↔ страница ---------- */
  var FLAGS = String(C.modeFlags).split(',').map(function (s) {
    var p = s.trim().split(':');
    return { sel: p[0], cls: p[1] };
  }).filter(function (f) { return f.sel && f.cls; });

  function pageMode() {
    for (var i = 0; i < FLAGS.length; i++) {
      var n = document.querySelector(FLAGS[i].sel);
      if (n) return n.classList.contains(FLAGS[i].cls) ? 'opt' : 'retail';
    }
    return null;
  }

  var muting = false;
  function setMode(m, pushToPage) {
    state.mode = (m === 'opt') ? 'opt' : 'retail';
    storeWrite();
    if (pushToPage) {
      var btn = document.querySelector(state.mode === 'opt' ? C.pageOpt : C.pageRetail);
      if (btn && pageMode() !== state.mode) { muting = true; btn.click(); muting = false; }
    }
    paint();
  }

  function watchPageMode() {
    if (!FLAGS.length || !window.MutationObserver) return;
    FLAGS.forEach(function (f) {
      var n = document.querySelector(f.sel);
      if (!n) return;
      new MutationObserver(function () {
        if (muting) return;
        var m = n.classList.contains(f.cls) ? 'opt' : 'retail';
        if (m !== state.mode) { state.mode = m; storeWrite(); paint(); }
      }).observe(n, { attributes: true, attributeFilter: ['class'] });
    });
  }

  /* ---------- 13. ТЕКСТ ЗАЯВКИ ---------- */
  /* «Лещ вяленый, 900–1200 г — 20 кг × 990 ₽ = 19 800 ₽» */
  function lineText(ln, i) {
    return (i + 1) + '. ' + ln.it.name + (ln.it.variant ? ', ' + ln.it.variant : '') +
      ' — ' + qtyText(ln.qty) + ' ' + unitText(ln.it, ln.qty) +
      ' × ' + plain(money(ln.price)) + ' = ' + plain(money(ln.sum));
  }

  function orderText(limitLines) {
    var r = calc();
    var head = ['Заявка с сайта ' + C.site];
    /* «Опт: заказ от 100 кг…» → в скобках «Опт:» второй раз не нужен */
    var terms = plain(P.opt_terms || '').replace(/^\s*опт\s*[:—-]\s*/i, '');
    head.push('Цены: ' + (state.mode === 'opt' ? 'оптовые' : 'розничные') +
      (state.mode === 'opt' && terms ? ' (' + terms + ')' : ''));
    head.push('');

    var body = r.lines.map(lineText);
    var cut = 0;
    if (limitLines != null && limitLines < body.length) {
      cut = body.length - limitLines;
      body = body.slice(0, limitLines);
      body.push('…и ещё ' + cut + ' ' + plural(cut, 'позиция', 'позиции', 'позиций') +
        ' — пришлю полным списком.');
    }

    var tail = [''];
    tail.push('Позиций: ' + r.count +
      ' · вес: ' + qtyText(r.kg) + ' кг' +
      (r.jars ? ' + ' + qtyText(r.jars) + ' ' + plural(r.jars, 'банка', 'банки', 'банок') : ''));
    tail.push('ИТОГО: ' + plain(money(r.total)));
    if (state.mode === 'opt' && C.optMinTotal > 0) {
      tail.push(r.optReady
        ? 'Условие опта выполнено.'
        : 'Условие опта пока не выполнено — прошу проверить цены.');
    }
    tail.push('');
    tail.push((P.updated ? 'Прайс от ' + P.updated.split('-').reverse().join('.') + '. ' : '') +
      plain(P.vat_note || ''));

    return { text: head.concat(body, tail).join('\n').replace(/\n{3,}/g, '\n\n'), cut: cut, calc: r };
  }

  /* подгоняем длину под лимит URL: режем список, не итог */
  function textForUrl(prefix, max) {
    var n = calc().lines.length;
    var t = orderText(null);
    var url = prefix + encodeURIComponent(t.text);
    while (url.length > max && n > 1) {
      n--;
      t = orderText(n);
      url = prefix + encodeURIComponent(t.text);
    }
    return { url: url, cut: t.cut, text: t.text };
  }

  /* ---------- 14. КОПИРОВАНИЕ И ТОСТ ---------- */
  var toastTimer = null;
  function flash(msg, ms) {
    toast.textContent = msg;
    toast.hidden = false;
    /* принудительный reflow, чтобы сработал переход */
    void toast.offsetWidth;
    toast.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('is-on');
      toastTimer = setTimeout(function () { toast.hidden = true; }, 300);
    }, ms || 3600);
  }

  function copyText(text, okMsg) {
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      flash(ok ? okMsg : 'Скопировать не удалось — выделите список вручную.');
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(okMsg); }, legacy);
      return;
    }
    legacy();
  }

  /* ---------- 15. КАНАЛЫ ОТПРАВКИ ---------- */
  function openUrl(url) {
    var w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;                       /* блокировщик всплывающих окон */
  }

  function sendWA() {
    if (!calc().count) return;
    var r = textForUrl('https://wa.me/' + C.wa + '?text=', C.urlMax);
    openUrl(r.url);
    if (r.cut) {
      copyText(orderText(null).text,
        'Список длинный: в WhatsApp ушли не все строки. Полный список скопирован — вставьте в чат.');
    }
    document.dispatchEvent(new CustomEvent('rybtseh:order-send', {
      detail: { channel: 'wa', positions: calc().count, kg: calc().kg, total: calc().total }
    }));
  }
  function sendTG() {
    if (!calc().count) return;
    /* t.me не принимает текст в ссылке — кладём в буфер и открываем чат */
    copyText(orderText(null).text, 'Список скопирован — вставьте его в чат Telegram (Ctrl+V).');
    setTimeout(function () { openUrl(C.tg); }, 260);
    document.dispatchEvent(new CustomEvent('rybtseh:order-send', {
      detail: { channel: 'tg', positions: calc().count, kg: calc().kg, total: calc().total }
    }));
  }
  function sendMail() {
    if (!calc().count) return;
    var r = textForUrl('mailto:' + C.mail + '?subject=' + encodeURIComponent(C.subject) + '&body=',
      C.mailMax);
    openUrl(r.url);
    if (r.cut) {
      copyText(orderText(null).text,
        'Список длинный: в письмо ушли не все строки. Полный список скопирован — вставьте в письмо.');
    }
    document.dispatchEvent(new CustomEvent('rybtseh:order-send', {
      detail: { channel: 'mail', positions: calc().count, kg: calc().kg, total: calc().total }
    }));
  }
  function sendCopy() {
    if (!calc().count) return;
    copyText(orderText(null).text, 'Список скопирован в буфер обмена.');
    document.dispatchEvent(new CustomEvent('rybtseh:order-send', {
      detail: { channel: 'copy', positions: calc().count, kg: calc().kg, total: calc().total }
    }));
  }

  /* ---------- 16. ОТКРЫТИЕ / ЗАКРЫТИЕ / ФОКУС ---------- */
  var open = false;
  var lastFocus = null;
  var mqSheet = window.matchMedia ? window.matchMedia('(max-width:760px)') : { matches: false };

  function focusables() {
    return Array.prototype.filter.call(
      panel.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]'),
      function (n) { return n.offsetParent !== null || n === document.activeElement; });
  }

  function openPanel() {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    var sheet = !!mqSheet.matches;
    panel.setAttribute('aria-modal', sheet ? 'true' : 'false');
    if (sheet) {
      backdrop.hidden = false;
      document.documentElement.classList.add('ord-lock');
      void backdrop.offsetWidth;
      backdrop.classList.add('is-on');
    }
    void panel.offsetWidth;
    panel.classList.add('is-on');
    fab.setAttribute('aria-expanded', 'true');
    fab.hidden = true;
    var f = focusables()[0];
    (f || panel).focus();
  }

  function closePanel(returnFocus) {
    if (!open) return;
    open = false;
    panel.classList.remove('is-on');
    backdrop.classList.remove('is-on');
    document.documentElement.classList.remove('ord-lock');
    fab.hidden = false;
    fab.setAttribute('aria-expanded', 'false');
    setTimeout(function () {
      if (!open) { panel.hidden = true; backdrop.hidden = true; }
    }, 280);
    if (returnFocus !== false) fab.focus();
  }

  function togglePanel() { open ? closePanel() : openPanel(); }

  /* Escape закрывает; ловушка фокуса — только в модальном листе (мобильный) */
  on(document, 'keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closePanel(); return; }
    if (e.key !== 'Tab' || !mqSheet.matches) return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  on(backdrop, 'click', function () { closePanel(); });
  on(fab, 'click', togglePanel);
  on(q('close'), 'click', function () { closePanel(); });

  /* ---------- 17. СВЯЗЫВАНИЕ КНОПОК ПАНЕЛИ ---------- */
  on(UI.retail, 'click', function () { setMode('retail', true); });
  on(UI.opt, 'click', function () { setMode('opt', true); });
  on(q('wa'), 'click', sendWA);
  on(q('tg'), 'click', sendTG);
  on(q('ml'), 'click', sendMail);
  on(q('cp'), 'click', sendCopy);
  on(q('clear'), 'click', function () {
    if (!calc().count) return;
    clearAll();
    flash('Заявка очищена.');
    panel.querySelector('[data-ord="close"]').focus();
  });

  /* заявка живёт между вкладками одного сайта */
  on(window, 'storage', function (e) {
    if (e.key !== C.store) return;
    state.items = [];
    restore();
    paint();
  });

  /* ---------- 18. СТАРТ ---------- */
  function init() {
    restore();
    var pm = pageMode();
    if (pm) state.mode = pm;                          /* режим страницы главнее сохранённого */
    mount();
    scan();
    watch();
    watchPageMode();
    paint();
    /* публичный минимум — для отладки и для демо-страницы */
    window.RybtsehOrder = {
      add: function (id, qty) { setQty(id, parseQty(qty, BY_ID[id] || { unit: 'кг' })); },
      clear: clearAll,
      setMode: function (m) { setMode(m, true); },
      open: openPanel,
      close: closePanel,
      text: function () { return orderText(null).text; },
      state: function () { return calc(); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();
})();
