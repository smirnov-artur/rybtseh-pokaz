/* ============================================================
   Админка прайса «Артефакт» — логика.
   Без библиотек и сборки. Работает в двух режимах:
   — Сервер: api.php отвечает на ping JSON'ом (php:true).
   — Демо: сервера нет (file://, GitHub Pages, 404) — данные из
     window.PRICES (../assets/prices.js, подключён до этого файла),
     правки и «публикация» живут в localStorage этого браузера.
   Контракт API — _СПЕК-АДМИНКИ.md §3. Порядок разделов и сортировка
   внутри группы — как на сайте (price.html).
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 0. константы ---------- */
  var ORDER = ['вяленая', 'вяленая и холодного копчения', 'холодного копчения', 'слабосолёная', 'икра'];
  var TITLE = {
    'вяленая': 'Вяленая',
    'вяленая и холодного копчения': 'Вяленая и холодного копчения',
    'холодного копчения': 'Холодного копчения',
    'слабосолёная': 'Слабосолёная',
    'икра': 'Икра'
  };
  var UNITS = ['кг', 'банка', 'шт'];
  var FIELDS = ['category', 'name', 'variant', 'unit', 'price_retail', 'price_opt', 'in_stock', 'notes'];
  var MONTH = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
  };

  var DRAFT_KEY = 'rybadm-draft';
  var DRAFT_CATALOG_KEY = 'rybadm-draft-catalog';
  var DEMO_KEY = 'rybadm-demo';
  var DEMO_CATALOG_KEY = 'rybadm-demo-catalog';
  var DEMO_AUTH_KEY = 'rybadm-demo-authed';
  var DEMO_LOCK_KEY = 'rybadm-demo-lock';

  var KEY_SEQ = 1;

  /* ---------- 1. состояние ---------- */
  var S = {
    serverMode: false,
    setupMode: false,
    authed: false,
    authPending: false,
    token: null,
    pendingPublish: false,
    query: '',
    baseline: null,   // {updated, source, currency, vat_note, opt_terms, items:[]}
    items: [],        // рабочая копия строк (+ _key, + _new у новых)
    backups: [],       // [{name,time,positions}]
    pendingRestore: null,
    draftTimer: null,
    catalogBaseline: null,  // {updated, products:[]} — см. _СПЕК-V2.md §0; null пока не загружен
    catalog: null,          // рабочая копия {updated, products:[+_key,+_new]}
    catalogDraftTimer: null
    // pendingPhotos — необязательное поле, выставляет admin-cards.js (счётчик «Фото загружено» в листе публикации)
  };

  /* ---------- 2. утилиты ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е'); }
  function plural(n, a, b, c) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return b;
    return c;
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function dateRu(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '—');
    return parseInt(m[3], 10) + ' ' + MONTH[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }
  function dateTimeRu(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso || ''));
    if (!m) return dateRu(iso);
    return parseInt(m[3], 10) + ' ' + MONTH[parseInt(m[2], 10) - 1] + ' ' + m[1] + ', ' + m[4] + ':' + m[5];
  }
  function dateTimeRuNoYear(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso || ''));
    if (!m) return dateRu(iso);
    return parseInt(m[3], 10) + ' ' + MONTH[parseInt(m[2], 10) - 1] + ', ' + m[4] + ':' + m[5];
  }
  function todayIsoDate() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function isoStampCompact() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* число «1 176,5» / «1176.5» → 1176.5; пустое → null; мусор → NaN */
  function parseMoney(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return null;
    s = s.replace(/[\s  ]/g, '');
    if (!/^\d+([.,]\d{1,2})?$/.test(s)) return NaN;
    s = s.replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? NaN : Math.round(n * 100) / 100;
  }
  function fmtNum(v) {
    if (v == null || isNaN(v)) return '';
    var r = Math.round(v * 100) / 100;
    var ip = Math.floor(r), fp = Math.round((r - ip) * 100);
    var s = String(ip).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (fp) s += ',' + (fp < 10 ? '0' + fp : fp);
    return s;
  }
  /* при вводе цены — не пропускать буквы, разрешать только цифры/пробелы/запятую/точку */
  function sanitizeNumericInput(el) {
    var v = el.value;
    var cleaned = v.replace(/[^0-9,.\s  ]/g, '');
    if (cleaned !== v) {
      var pos = el.selectionStart == null ? cleaned.length : el.selectionStart;
      el.value = cleaned;
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    }
  }

  function slugify(text) {
    var s = String(text || '').toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      out += TRANSLIT.hasOwnProperty(ch) ? TRANSLIT[ch] : ch;
    }
    out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (out.length > 80) out = out.slice(0, 80).replace(/-+$/, '');
    return out;
  }
  function uniqueId(base, exceptItem) {
    var used = {};
    S.items.forEach(function (it) { if (it !== exceptItem && it.id) used[it.id] = true; });
    if (!used[base]) return base;
    var n = 2, candidate;
    do {
      var suffix = '-' + n;
      var trimmedBase = (base.length + suffix.length > 80) ? base.slice(0, 80 - suffix.length) : base;
      candidate = trimmedBase + suffix;
      n++;
    } while (used[candidate]);
    return candidate;
  }
  /* новый id — только у новых строк, пока не введено название id пуст */
  function regenerateId(item) {
    if (!item.name || !String(item.name).trim()) { item.id = ''; return; }
    var base = slugify(item.name + ' ' + (item.variant || ''));
    if (!base) { item.id = ''; return; }
    item.id = uniqueId(base, item);
  }

  /* ---------- 2а. шина событий (для модулей admin-import.js / admin-cards.js /
     admin-extra.js — подписка через RYBADM.on, публикация через RYBADM.emit).
     События: 'items-changed' (после любой правки/добавления/удаления/отмены
     правок/применения импорта — и после правки карточки, раз предпросмотр
     слушает одно и то же событие для обеих вкладок), 'published' (после
     успешной публикации, аргумент — сводка результата), 'tab' (после смены
     вкладки, аргумент — её имя: 'price'|'cards'|'history'), 'data-loaded'
     (после того как S.baseline/S.catalogBaseline получили данные — старт,
     обновление после публикации, восстановление из истории). ---------- */
  var LISTENERS = {};
  function on(evt, fn) {
    if (typeof fn !== 'function') return function () {};
    (LISTENERS[evt] = LISTENERS[evt] || []).push(fn);
    return function off() {
      var arr = LISTENERS[evt];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }
  function emit(evt) {
    var arr = LISTENERS[evt];
    if (!arr || !arr.length) return;
    var args = Array.prototype.slice.call(arguments, 1);
    arr.slice().forEach(function (fn) {
      try { fn.apply(null, args); } catch (e) { if (window.console) console.error('RYBADM: обработчик события "' + evt + '" упал', e); }
    });
  }

  /* ---------- 3. слой API (сервер) ---------- */
  function apiCall(action, body, opts) {
    opts = opts || {};
    var method = opts.method || 'POST';
    var headers = {};
    if (method !== 'GET') headers['Content-Type'] = 'application/json; charset=utf-8';
    if (opts.needsToken && S.token) headers['X-Token'] = S.token;

    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = null;
    if (controller) timer = setTimeout(function () { controller.abort(); }, opts.timeout || 9000);

    var initObj = {
      method: method,
      credentials: 'same-origin',
      headers: headers
    };
    if (method !== 'GET') initObj.body = JSON.stringify(body || {});
    if (controller) initObj.signal = controller.signal;

    return fetch('api.php?a=' + encodeURIComponent(action), initObj).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (!json || typeof json !== 'object') {
          var e1 = new Error('Сервер вернул неожиданный ответ.');
          e1.code = 'server'; e1.status = res.status;
          throw e1;
        }
        if (!res.ok || json.ok === false) {
          var e2 = new Error(json.message || 'Ошибка сервера.');
          e2.code = json.error || 'server'; e2.status = res.status; e2.details = json.details;
          throw e2;
        }
        return json;
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.code) throw err;
      var e3 = new Error('Нет соединения с сервером.');
      e3.code = 'network';
      throw e3;
    });
  }
  function pingServer() { return apiCall('ping', null, { method: 'GET', timeout: 2500 }); }

  /* ---------- 4. слой демо (localStorage) ---------- */
  function loadDemoStore() {
    var raw = null;
    try { raw = localStorage.getItem(DEMO_KEY); } catch (e) {}
    if (raw) {
      try { var parsed = JSON.parse(raw); if (parsed && parsed.data) return parsed; } catch (e) {}
    }
    var initial = { data: deepClone(window.PRICES || { items: [] }), backups: [] };
    saveDemoStore(initial);
    return initial;
  }
  function saveDemoStore(store) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function demoGet() {
    return new Promise(function (resolve) {
      var store = loadDemoStore();
      resolve({
        data: store.data,
        backups: store.backups.map(function (b) { return { name: b.name, time: b.time, positions: b.positions }; })
      });
    });
  }
  function demoSave(items) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var store = loadDemoStore();
          var prevData = store.data;
          var today = todayIsoDate();
          var newDoc = {
            updated: today,
            source: 'Демо, ' + dateRu(today),
            currency: prevData.currency,
            vat_note: prevData.vat_note,
            opt_terms: prevData.opt_terms,
            positions: items.length,
            items: items
          };
          var backupEntry = {
            name: 'prices-' + isoStampCompact() + '.json',
            time: new Date().toISOString().slice(0, 19),
            positions: prevData.positions != null ? prevData.positions : (prevData.items || []).length,
            data: prevData
          };
          store.backups.unshift(backupEntry);
          if (store.backups.length > 10) store.backups = store.backups.slice(0, 10);
          store.data = newDoc;
          saveDemoStore(store);
          resolve({ ok: true, updated: newDoc.updated, positions: newDoc.positions, time: new Date().toISOString().slice(0, 19), warnings: [] });
        } catch (e) {
          reject({ message: 'Не удалось сохранить в этом браузере.', code: 'server' });
        }
      }, 350);
    });
  }
  function demoRestore(name) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        var store = loadDemoStore();
        var found = null;
        for (var i = 0; i < store.backups.length; i++) { if (store.backups[i].name === name) { found = store.backups[i]; break; } }
        if (!found) { reject({ message: 'Резервная копия не найдена.', code: 'not_found' }); return; }
        var prevData = store.data;
        var restored = deepClone(found.data);
        var backupEntry = {
          name: 'prices-' + isoStampCompact() + '.json',
          time: new Date().toISOString().slice(0, 19),
          positions: prevData.positions != null ? prevData.positions : (prevData.items || []).length,
          data: prevData
        };
        store.backups.unshift(backupEntry);
        if (store.backups.length > 10) store.backups = store.backups.slice(0, 10);
        store.data = restored;
        saveDemoStore(store);
        resolve({ ok: true, updated: restored.updated, positions: (restored.items || []).length, time: new Date().toISOString().slice(0, 19), warnings: [] });
      }, 300);
    });
  }
  function checkDemoLock() {
    var raw = null;
    try { raw = localStorage.getItem(DEMO_LOCK_KEY); } catch (e) {}
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (o.until && Date.now() < o.until) return 'Слишком много попыток, подождите 10 минут';
    } catch (e) {}
    return null;
  }
  function registerDemoFail() {
    var o = { count: 0, until: 0 };
    try { var raw = localStorage.getItem(DEMO_LOCK_KEY); if (raw) o = JSON.parse(raw); } catch (e) {}
    o.count = (o.count || 0) + 1;
    if (o.count >= 5) { o.until = Date.now() + 10 * 60 * 1000; o.count = 0; }
    try { localStorage.setItem(DEMO_LOCK_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function resetDemoLock() {
    try { localStorage.removeItem(DEMO_LOCK_KEY); } catch (e) {}
  }

  /* ---------- 4а. слой демо для каталога карточек (localStorage, отдельный
     ключ от прайса — п. 0 _СПЕК-V2.md). Без сервера (PHP ещё не реализовал
     catalog_get/catalog_save) это единственный источник каталога в демо;
     на сервере — до тех пор, пока `get` не начнёт отдавать catalog,
     applyLoadedData() падает на window.CATALOG / пустой каталог сама. ---------- */
  function loadDemoCatalogStore() {
    var raw = null;
    try { raw = localStorage.getItem(DEMO_CATALOG_KEY); } catch (e) {}
    if (raw) {
      try { var parsed = JSON.parse(raw); if (parsed && parsed.data) return parsed; } catch (e) {}
    }
    var initial = { data: deepClone(window.CATALOG || { updated: null, products: [] }) };
    saveDemoCatalogStore(initial);
    return initial;
  }
  function saveDemoCatalogStore(store) {
    try { localStorage.setItem(DEMO_CATALOG_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function demoCatalogGet() {
    return new Promise(function (resolve) {
      var store = loadDemoCatalogStore();
      resolve({ data: store.data });
    });
  }
  function demoCatalogSave(products) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var store = loadDemoCatalogStore();
          var today = todayIsoDate();
          var newDoc = { updated: today, products: products };
          store.data = newDoc;
          saveDemoCatalogStore(store);
          resolve({ ok: true, updated: newDoc.updated, time: new Date().toISOString().slice(0, 19), warnings: [] });
        } catch (e) {
          reject({ message: 'Не удалось сохранить карточки в этом браузере.', code: 'server' });
        }
      }, 250);
    });
  }

  /* ---------- 5. данные: базовая версия / рабочая копия / различия ---------- */
  function cleanItemForSave(it) {
    return {
      id: it.id, category: it.category, name: it.name, variant: it.variant,
      unit: it.unit, price_retail: it.price_retail, price_opt: it.price_opt,
      in_stock: !!it.in_stock, notes: it.notes
    };
  }
  function applyLoadedData(data, backups, catalog) {
    S.baseline = deepClone(data);
    S.backups = backups || [];
    /* catalog — необязательный третий аргумент: сервер (после того как PHP-агент
       реализует §7 _СПЕК-V2.md) отдаёт его как data.catalog внутри ответа `get`;
       в демо — тот же документ идёт из localStorage через RYBADM.demo.catalogGet.
       Пока ни то ни другое не пришло (undefined) — держим прежний baseline, если
       он уже был (обновление после публикации без catalog в ответе не должно
       откатывать локально обновлённый каталог); при самой первой загрузке
       baseline ещё нет — берём window.CATALOG (../assets/catalog.js) или пустой
       каталог, если файла ещё нет (агент «медиа» его не создал). */
    if (catalog !== undefined && catalog !== null) {
      S.catalogBaseline = deepClone(catalog);
    } else if (!S.catalogBaseline) {
      S.catalogBaseline = deepClone(window.CATALOG || { updated: null, products: [] });
    }
  }
  function workingCopyFromBaseline() {
    return S.baseline.items.map(function (it) {
      var c = deepClone(it);
      c._new = false;
      c._key = 'k' + (KEY_SEQ++);
      return c;
    });
  }
  function fieldsDiff(b, it) {
    var out = [];
    FIELDS.forEach(function (f) {
      var bv = b[f], iv = it[f];
      if (f === 'name' || f === 'variant' || f === 'notes') {
        bv = bv == null ? '' : String(bv).trim();
        iv = iv == null ? '' : String(iv).trim();
      } else if (f === 'price_retail' || f === 'price_opt') {
        bv = (bv == null) ? null : Number(bv);
        iv = (iv == null) ? null : Number(iv);
      } else if (f === 'in_stock') {
        bv = !!bv; iv = !!iv;
      }
      if (bv !== iv) out.push(f);
    });
    return out;
  }
  function baselineMap() {
    var m = {};
    if (S.baseline) S.baseline.items.forEach(function (b) { m[b.id] = b; });
    return m;
  }
  function computeDiff() {
    var baseMap = baselineMap();
    var changed = [], changedPrice = [], changedOther = [], added = [], currentIds = {};
    S.items.forEach(function (it) {
      if (it._new) { added.push(it); return; }
      currentIds[it.id] = true;
      var b = baseMap[it.id];
      if (!b) { added.push(it); return; }
      var df = fieldsDiff(b, it);
      if (df.length) {
        changed.push(it);
        if (df.indexOf('price_retail') !== -1 || df.indexOf('price_opt') !== -1) changedPrice.push(it);
        else changedOther.push(it);
      }
    });
    var deleted = (S.baseline ? S.baseline.items : []).filter(function (b) { return !currentIds[b.id]; });
    return {
      changed: changed, changedPrice: changedPrice, changedOther: changedOther,
      added: added, deleted: deleted,
      total: changed.length + added.length + deleted.length
    };
  }

  /* ---------- 5а. каталог карточек: рабочая копия / различия (§0, §3 _СПЕК-V2.md).
     Полноценное редактирование карточек делает admin-cards.js — здесь только
     модель данных, чтобы «Опубликовать» и лист подтверждения работали, даже
     если модуль карточек ещё не подключён (тогда каталог просто никогда не
     меняется и catalogDirty() всегда 0). ---------- */
  var CATALOG_FIELDS = ['name', 'latin', 'origin', 'blurb', 'photo', 'order', 'hidden'];
  function cleanCatalogItemForSave(p) {
    return {
      key: p.key, name: p.name, latin: p.latin, origin: p.origin,
      blurb: p.blurb, photo: p.photo, order: p.order, hidden: !!p.hidden
    };
  }
  function catalogWorkingCopyFromBaseline() {
    var base = S.catalogBaseline || { updated: null, products: [] };
    return {
      updated: base.updated,
      products: (base.products || []).map(function (p) {
        var c = deepClone(p);
        c._new = false;
        c._key = 'ck' + (KEY_SEQ++);
        return c;
      })
    };
  }
  function catalogBaselineMap() {
    var m = {};
    if (S.catalogBaseline) (S.catalogBaseline.products || []).forEach(function (p) { m[p.key] = p; });
    return m;
  }
  function catalogFieldsDiff(b, it) {
    var out = [];
    CATALOG_FIELDS.forEach(function (f) {
      var bv = b[f], iv = it[f];
      if (f === 'name' || f === 'latin' || f === 'origin' || f === 'blurb' || f === 'photo') {
        bv = bv == null ? '' : String(bv).trim();
        iv = iv == null ? '' : String(iv).trim();
      } else if (f === 'hidden') {
        bv = !!bv; iv = !!iv;
      } else if (f === 'order') {
        bv = (bv == null) ? null : Number(bv); iv = (iv == null) ? null : Number(iv);
      }
      if (bv !== iv) out.push(f);
    });
    return out;
  }
  /* число изменённых карточек (новые и удалённые тоже считаются «изменением») —
     RYBADM.catalogDirty(), см. _СПЕК-V2.md §3 и задание агента «ядро» */
  function catalogDirty() {
    if (!S.catalog) return 0;
    var baseMap = catalogBaselineMap();
    var n = 0, currentKeys = {};
    (S.catalog.products || []).forEach(function (it) {
      if (it._new) { n++; return; }
      currentKeys[it.key] = true;
      var b = baseMap[it.key];
      if (!b) { n++; return; }
      if (catalogFieldsDiff(b, it).length) n++;
    });
    var deletedCount = (S.catalogBaseline ? (S.catalogBaseline.products || []) : []).filter(function (b) { return !currentKeys[b.key]; }).length;
    return n + deletedCount;
  }

  /* ---------- 6. поиск / группировка (как на сайте) ---------- */
  function matchesQuery(it, q) {
    if (!q) return true;
    var hay = norm(it.name + ' ' + (it.variant || '') + ' ' + (it.notes || ''));
    var words = q.split(/\s+/);
    for (var i = 0; i < words.length; i++) { if (words[i] && hay.indexOf(words[i]) === -1) return false; }
    return true;
  }
  function groupAndSort(list) {
    var byCat = {};
    list.forEach(function (it) { (byCat[it.category] = byCat[it.category] || []).push(it); });
    var cats = ORDER.slice();
    Object.keys(byCat).forEach(function (c) { if (cats.indexOf(c) === -1) cats.push(c); });
    var groups = [];
    cats.forEach(function (c) {
      var arr = byCat[c];
      if (!arr || !arr.length) return;
      var existing = arr.filter(function (it) { return !it._new; });
      var news = arr.filter(function (it) { return it._new; });
      existing.sort(function (a, b) {
        return (a.name + ' ' + (a.variant || '')).localeCompare(b.name + ' ' + (b.variant || ''), 'ru');
      });
      groups.push({ cat: c, items: existing.concat(news) });
    });
    return groups;
  }
  function guessDefaultCategory() {
    if (!S.query) return 'вяленая';
    var q = norm(S.query);
    var filtered = S.items.filter(function (it) { return matchesQuery(it, q); });
    var cats = {};
    filtered.forEach(function (it) { cats[it.category] = true; });
    var keys = Object.keys(cats);
    return keys.length === 1 ? keys[0] : 'вяленая';
  }

  /* ---------- 7. рендер таблицы ---------- */
  function makeCellLbl(text) {
    var s = document.createElement('span');
    s.className = 'cell-lbl'; s.setAttribute('aria-hidden', 'true'); s.textContent = text;
    return s;
  }
  function buildRow(item, baseMap) {
    var tr = document.createElement('tr');
    tr.className = 'row'; tr.setAttribute('data-key', item._key);
    if (!item.in_stock) tr.classList.add('is-off');

    var base = (!item._new) ? baseMap[item.id] : null;
    var diffFields = base ? fieldsDiff(base, item) : [];
    function dirty(f) { return diffFields.indexOf(f) !== -1; }
    var who = item.name || 'новая позиция';

    var tdCat = document.createElement('td'); tdCat.className = 'c-cat' + (dirty('category') ? ' dirty' : '');
    tdCat.appendChild(makeCellLbl('Раздел'));
    var selCat = document.createElement('select');
    selCat.setAttribute('data-field', 'category'); selCat.setAttribute('aria-label', 'Раздел — ' + who);
    ORDER.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = TITLE[c];
      if (c === item.category) o.selected = true;
      selCat.appendChild(o);
    });
    tdCat.appendChild(selCat); tr.appendChild(tdCat);

    var tdName = document.createElement('td'); tdName.className = 'c-name' + (dirty('name') ? ' dirty' : '');
    var wrap = document.createElement('div'); wrap.className = 'cell-flex';
    var inpName = document.createElement('input');
    inpName.type = 'text'; inpName.maxLength = 120; inpName.value = item.name || '';
    inpName.setAttribute('data-field', 'name'); inpName.setAttribute('aria-label', 'Название');
    inpName.placeholder = 'Название позиции';
    wrap.appendChild(inpName);
    if (item._new) {
      var badge = document.createElement('span'); badge.className = 'badge badge--new'; badge.textContent = 'новая';
      wrap.appendChild(badge);
    }
    tdName.appendChild(wrap); tr.appendChild(tdName);

    var tdVar = document.createElement('td'); tdVar.className = 'c-variant' + (dirty('variant') ? ' dirty' : '');
    var inpVar = document.createElement('input');
    inpVar.type = 'text'; inpVar.maxLength = 120; inpVar.value = item.variant || '';
    inpVar.setAttribute('data-field', 'variant'); inpVar.setAttribute('aria-label', 'Вариант — ' + who);
    inpVar.placeholder = '—';
    tdVar.appendChild(inpVar); tr.appendChild(tdVar);

    var tdUnit = document.createElement('td'); tdUnit.className = 'c-unit' + (dirty('unit') ? ' dirty' : '');
    tdUnit.appendChild(makeCellLbl('Ед.'));
    var selUnit = document.createElement('select');
    selUnit.setAttribute('data-field', 'unit'); selUnit.setAttribute('aria-label', 'Единица — ' + who);
    UNITS.forEach(function (u) {
      var o = document.createElement('option'); o.value = u; o.textContent = u;
      if (u === item.unit) o.selected = true;
      selUnit.appendChild(o);
    });
    tdUnit.appendChild(selUnit); tr.appendChild(tdUnit);

    var tdR = document.createElement('td'); tdR.className = 'c-retail' + (dirty('price_retail') ? ' dirty' : '');
    tdR.appendChild(makeCellLbl('Розница, ₽'));
    var inpR = document.createElement('input');
    inpR.type = 'text'; inpR.setAttribute('inputmode', 'decimal'); inpR.value = fmtNum(item.price_retail);
    inpR.setAttribute('data-field', 'price_retail'); inpR.setAttribute('aria-label', 'Розница, рубли — ' + who);
    inpR.placeholder = '—';
    tdR.appendChild(inpR); tr.appendChild(tdR);

    var tdO = document.createElement('td'); tdO.className = 'c-opt' + (dirty('price_opt') ? ' dirty' : '');
    tdO.appendChild(makeCellLbl('Опт, ₽'));
    var inpO = document.createElement('input');
    inpO.type = 'text'; inpO.setAttribute('inputmode', 'decimal'); inpO.value = fmtNum(item.price_opt);
    inpO.setAttribute('data-field', 'price_opt'); inpO.setAttribute('aria-label', 'Опт, рубли — ' + who);
    inpO.placeholder = '—';
    tdO.appendChild(inpO); tr.appendChild(tdO);

    var tdS = document.createElement('td'); tdS.className = 'c-stock' + (dirty('in_stock') ? ' dirty' : '');
    tdS.appendChild(makeCellLbl('В наличии'));
    var btnS = document.createElement('button');
    btnS.type = 'button'; btnS.className = 'switch'; btnS.setAttribute('role', 'switch');
    btnS.setAttribute('data-field', 'in_stock');
    btnS.setAttribute('aria-checked', item.in_stock ? 'true' : 'false');
    btnS.setAttribute('aria-label', 'В наличии — ' + who);
    tdS.appendChild(btnS); tr.appendChild(tdS);

    var tdN = document.createElement('td'); tdN.className = 'c-notes' + (dirty('notes') ? ' dirty' : '');
    tdN.appendChild(makeCellLbl('Примечание'));
    var inpN = document.createElement('input');
    inpN.type = 'text'; inpN.maxLength = 160; inpN.value = item.notes || '';
    inpN.setAttribute('data-field', 'notes'); inpN.setAttribute('aria-label', 'Примечание — ' + who);
    inpN.placeholder = notesPlaceholder();
    tdN.appendChild(inpN); tr.appendChild(tdN);

    var tdD = document.createElement('td'); tdD.className = 'c-del';
    var btnD = document.createElement('button');
    btnD.type = 'button'; btnD.className = 'del-btn'; btnD.textContent = '×';
    btnD.setAttribute('aria-label', 'Удалить — ' + who);
    tdD.appendChild(btnD); tr.appendChild(tdD);

    return tr;
  }
  function renderTable(opts) {
    opts = opts || {};
    var baseMap = baselineMap();
    var q = norm(S.query);
    var filtered = S.items.filter(function (it) { return matchesQuery(it, q); });
    var groups = groupAndSort(filtered);
    var tbody = $('#tbody');
    tbody.innerHTML = '';
    var emptyState = $('#empty-state');
    if (!groups.length) {
      emptyState.hidden = false;
      emptyState.textContent = S.items.length ? 'Ничего не нашлось. Измените запрос поиска.' : 'Позиций пока нет.';
    } else {
      emptyState.hidden = true;
      groups.forEach(function (g) {
        var grpTr = document.createElement('tr'); grpTr.className = 'grp-row';
        var grpTd = document.createElement('td'); grpTd.colSpan = 9;
        var titleSpan = document.createElement('span'); titleSpan.className = 'grp-title'; titleSpan.textContent = TITLE[g.cat] || g.cat;
        var countSpan = document.createElement('span'); countSpan.className = 'grp-count';
        countSpan.textContent = g.items.length + ' ' + plural(g.items.length, 'позиция', 'позиции', 'позиций');
        grpTd.appendChild(titleSpan); grpTd.appendChild(countSpan);
        grpTr.appendChild(grpTd); tbody.appendChild(grpTr);
        g.items.forEach(function (it) { tbody.appendChild(buildRow(it, baseMap)); });
      });
    }
    if (opts.focusKey) {
      var tr = tbody.querySelector('tr[data-key="' + opts.focusKey + '"]');
      if (tr) {
        if (opts.scrollTo) tr.scrollIntoView({ block: 'center' });
        var f = opts.focusField ? tr.querySelector('[data-field="' + opts.focusField + '"]') : null;
        if (f) f.focus();
      }
    }
  }
  function focusItem(item, field, scroll) {
    var tr = $('#tbody').querySelector('tr[data-key="' + item._key + '"]');
    if (!tr) return;
    if (scroll) tr.scrollIntoView({ block: 'center' });
    var el = tr.querySelector('[data-field="' + field + '"]');
    if (el) el.focus();
  }

  /* ---------- 8. шапка / статус / кнопки ---------- */
  function updateHeaderStatus() {
    var el = $('#hdr-status');
    if (!el || !S.baseline) return;
    var n = (S.baseline.items || []).length;
    el.textContent = 'Опубликован ' + dateRu(S.baseline.updated) + ' · ' + n + ' ' + plural(n, 'позиция', 'позиции', 'позиций');
  }
  function updateHeaderButtons() {
    var diff = computeDiff();
    var n = diff.total;
    /* «Отменить правки» revertEdits() откатывает только прайс — держим её disabled-логику
       на price-диффе (n), иначе кнопка включалась бы от одних правок каталога и ничего
       не делала бы по клику. А счётчик на «Опубликовать» — общий: кнопка публикует и то,
       и другое (см. doPublish), число должно отражать всё, что реально уйдёт на публикацию. */
    [$('#btn-revert'), $('#menu-revert')].forEach(function (b) { if (b) b.disabled = (n === 0); });
    if (!S.pendingPublish) {
      var total = n + catalogDirty();
      var label = total > 0 ? ('Опубликовать · ' + total) : 'Опубликовать';
      [$('#btn-publish'), $('#btn-publish-mobile')].forEach(function (b) { if (b) b.textContent = label; });
    }
  }

  /* ---------- 9. правки: коммит поля / удаление / добавление ---------- */
  function findItemByKey(key) {
    for (var i = 0; i < S.items.length; i++) { if (S.items[i]._key === key) return S.items[i]; }
    return null;
  }
  function findItemFromEl(el) {
    var tr = el.closest('tr.row');
    if (!tr) return null;
    return findItemByKey(tr.getAttribute('data-key'));
  }
  function markDirtyCell(el, item) {
    var td = el.closest('td');
    if (!td) return;
    if (item._new) { td.classList.remove('dirty'); return; }
    var base = baselineMap()[item.id];
    if (!base) { td.classList.remove('dirty'); return; }
    var field = el.getAttribute('data-field');
    var differs = fieldsDiff(base, item).indexOf(field) !== -1;
    td.classList.toggle('dirty', differs);
  }
  function commitTextField(el) {
    var item = findItemFromEl(el);
    if (!item) return;
    var field = el.getAttribute('data-field');
    if (field === 'name') {
      item.name = el.value.trim();
      el.value = item.name;
    } else if (field === 'variant' || field === 'notes') {
      var val = el.value.trim();
      item[field] = (val === '') ? null : val;
      el.value = item[field] || '';
    } else if (field === 'price_retail' || field === 'price_opt') {
      var parsed = parseMoney(el.value);
      if (parsed === null || (typeof parsed === 'number' && !isNaN(parsed) && parsed >= 0)) {
        item[field] = parsed;
      } /* иначе (NaN / отрицательное) — оставляем прежнее значение поля */
      el.value = fmtNum(item[field]);
    } else {
      return;
    }
    if (item._new && (field === 'name' || field === 'variant')) regenerateId(item);
    markDirtyCell(el, item);
    scheduleDraftSave();
    updateHeaderButtons();
    emit('items-changed');
  }
  function deleteItem(item) {
    var idx = S.items.indexOf(item);
    if (idx === -1) return;
    S.items.splice(idx, 1);
    renderTable();
    scheduleDraftSave();
    updateHeaderButtons();
    emit('items-changed');
    showToast({
      kind: 'ok', text: 'Позиция удалена', actionText: 'Вернуть', duration: 6000, focusAction: true,
      onAction: function () {
        S.items.push(item);
        renderTable({ focusKey: item._key, focusField: 'name' });
        scheduleDraftSave();
        updateHeaderButtons();
        emit('items-changed');
      }
    });
  }
  function addItem() {
    var item = {
      _key: 'k' + (KEY_SEQ++), _new: true, id: '',
      category: guessDefaultCategory(), name: '', variant: null, unit: 'кг',
      price_retail: null, price_opt: null, in_stock: true, notes: null
    };
    S.items.push(item);
    renderTable({ focusKey: item._key, focusField: 'name', scrollTo: true });
    scheduleDraftSave();
    updateHeaderButtons();
    emit('items-changed');
  }
  function revertEdits() {
    if (computeDiff().total === 0) return;
    S.items = workingCopyFromBaseline();
    clearDraft();
    refreshDraftBar();
    renderTable();
    updateHeaderButtons();
    closeAllDropdowns();
    emit('items-changed');
  }

  /* ---------- 10. делегирование событий в таблице ---------- */
  function moveFocusDown(el) {
    var field = el.getAttribute('data-field');
    var tr = el.closest('tr.row');
    var next = tr.nextElementSibling;
    while (next && !next.classList.contains('row')) next = next.nextElementSibling;
    if (!next) return;
    var target = next.querySelector('[data-field="' + field + '"]');
    if (target) target.focus();
  }
  function wireTable() {
    var tbody = $('#tbody');

    tbody.addEventListener('focusin', function (e) {
      var el = e.target;
      if (el.tagName === 'INPUT') el.dataset.snapshot = el.value;
    });
    tbody.addEventListener('focusout', function (e) {
      var el = e.target;
      if (el.matches && el.matches('input[data-field]')) commitTextField(el);
    });
    tbody.addEventListener('input', function (e) {
      var el = e.target;
      if (el.matches && el.matches('input[data-field="price_retail"], input[data-field="price_opt"]')) {
        sanitizeNumericInput(el);
      }
    });
    tbody.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.matches || !el.matches('select[data-field]')) return;
      var item = findItemFromEl(el);
      if (!item) return;
      var field = el.getAttribute('data-field');
      var oldCat = item.category;
      item[field] = el.value;
      markDirtyCell(el, item);
      scheduleDraftSave();
      updateHeaderButtons();
      emit('items-changed');
      if (field === 'category' && el.value !== oldCat) {
        renderTable({ focusKey: item._key, focusField: 'category' });
      }
    });
    tbody.addEventListener('click', function (e) {
      var sw = e.target.closest('.switch');
      var del = e.target.closest('.del-btn');
      if (sw) {
        var item = findItemFromEl(sw);
        if (!item) return;
        item.in_stock = !item.in_stock;
        sw.setAttribute('aria-checked', item.in_stock ? 'true' : 'false');
        var tr = sw.closest('tr.row'); tr.classList.toggle('is-off', !item.in_stock);
        markDirtyCell(sw, item);
        scheduleDraftSave();
        updateHeaderButtons();
        emit('items-changed');
      } else if (del) {
        var it2 = findItemFromEl(del);
        if (it2) deleteItem(it2);
      }
    });
    tbody.addEventListener('keydown', function (e) {
      var el = e.target;
      if (e.key === 'Escape') {
        if (el.tagName === 'INPUT' && el.dataset.snapshot !== undefined) {
          el.value = el.dataset.snapshot;
        }
        return;
      }
      if (e.key === 'Enter') {
        if (el.matches && el.matches('input[data-field]')) {
          e.preventDefault();
          commitTextField(el);
          moveFocusDown(el);
        } else if (el.matches && el.matches('select[data-field]')) {
          /* select уже коммитит значение по 'change' — тут только переносим фокус */
          e.preventDefault();
          moveFocusDown(el);
        } else if (el.matches && el.matches('button.switch[data-field]')) {
          /* без preventDefault: иначе браузер не отработает штатную активацию
             кнопки по Enter (переключатель перестанет тумблироваться с клавиатуры) */
          moveFocusDown(el);
        }
      }
    });
  }

  /* ---------- 11. валидация перед публикацией ---------- */
  function validateAll() {
    var errs = [];
    var seenIds = {};
    S.items.forEach(function (it, idx) {
      var row = idx + 1;
      var name = (it.name || '').trim();
      if (name.length < 1 || name.length > 120) errs.push('Строка ' + row + ': название должно быть от 1 до 120 символов.');
      if (it.variant != null && String(it.variant).length > 120) errs.push('Строка ' + row + ': вариант длиннее 120 символов.');
      if (it.notes != null && String(it.notes).length > 160) errs.push('Строка ' + row + ': примечание длиннее 160 символов.');
      if (it.price_retail != null && (isNaN(it.price_retail) || it.price_retail < 0)) errs.push('Строка ' + row + ': розничная цена некорректна.');
      if (it.price_opt != null && (isNaN(it.price_opt) || it.price_opt < 0)) errs.push('Строка ' + row + ': опт. цена некорректна.');
      if (!it.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(it.id)) {
        errs.push('Строка ' + row + ': не удалось сформировать код позиции — измените название.');
      } else if (seenIds[it.id]) {
        errs.push('Строка ' + row + ': повторяющийся код позиции.');
      } else {
        seenIds[it.id] = true;
      }
    });
    if (S.items.length > 500) errs.push('Слишком много позиций (максимум 500).');
    return errs;
  }

  /* ---------- 12. модальный лист публикации ---------- */
  function addModalRow(label, n) {
    var li = document.createElement('li');
    var s1 = document.createElement('span'); s1.textContent = label + ':';
    var s2 = document.createElement('span'); s2.textContent = String(n);
    li.appendChild(s1); li.appendChild(s2);
    $('#modal-list').appendChild(li);
  }
  function openModal() {
    var diff = computeDiff();
    var list = $('#modal-list'); list.innerHTML = '';
    addModalRow('Изменено цен', diff.changedPrice.length);
    addModalRow('Новых позиций', diff.added.length);
    addModalRow('Удалено', diff.deleted.length);
    addModalRow('Прочие правки', diff.changedOther.length);
    addModalRow('Карточек изменено', catalogDirty());
    if (S.pendingPhotos != null) addModalRow('Фото загружено', S.pendingPhotos);
    $('#modal-backdrop').hidden = false;
    trapFocus($('#modal-publish'));
    $('#modal-confirm').focus();
  }
  function closeModal() {
    $('#modal-backdrop').hidden = true;
    releaseFocus();
  }
  function setPublishPending(on) {
    S.pendingPublish = on;
    [$('#btn-publish'), $('#btn-publish-mobile'), $('#modal-confirm')].forEach(function (b) { if (b) b.disabled = on; });
    $('#modal-cancel').disabled = on;
    if (on) {
      [$('#btn-publish'), $('#btn-publish-mobile'), $('#modal-confirm')].forEach(function (b) { if (b) b.textContent = 'Публикуем…'; });
    } else {
      $('#modal-confirm').textContent = 'Опубликовать';
      updateHeaderButtons();
    }
  }
  function highlightFromDetails(details) {
    if (!details || !details.length) return;
    var targets = [];
    var needClear = false;
    details.forEach(function (d) {
      var m = /Строка\s+(\d+)/.exec(String(d));
      if (!m) return;
      var idx = parseInt(m[1], 10) - 1;
      var item = S.items[idx];
      if (!item) return;
      targets.push(item);
      if (S.query && !matchesQuery(item, norm(S.query))) needClear = true;
    });
    if (needClear) { S.query = ''; $('#f-search').value = ''; renderTable(); }
    targets.forEach(function (item) {
      var tr = $('#tbody').querySelector('tr[data-key="' + item._key + '"]');
      if (tr) {
        tr.classList.add('row-error');
        tr.scrollIntoView({ block: 'center' });
        setTimeout(function () { tr.classList.remove('row-error'); }, 5000);
      }
    });
  }
  function formatPublishedTime(iso) { return dateTimeRu(iso); }

  /* result = { priceRes, catalogRes } — catalogRes есть только если каталог
     был изменён (catalogDirty()>0) и его тоже опубликовали, см. doPublish() */
  function onPublishSuccess(result) {
    var res = result.priceRes;
    var catalogWasSaved = !!result.catalogRes;
    closeModal();
    clearDraft();
    if (catalogWasSaved) {
      S.catalogBaseline = deepClone(S.catalog);
      clearCatalogDraft();
    }
    refreshDraftBar();
    var refreshTask = S.serverMode ? apiCall('get', {}, { needsToken: false }) : demoGet();
    refreshTask.then(function (getRes) {
      applyLoadedData(getRes.data, getRes.backups, getRes.catalog);
      S.items = workingCopyFromBaseline();
      S.catalog = catalogWorkingCopyFromBaseline();
      renderTable();
      renderHistory();
      updateHeaderStatus();
      updateHeaderButtons();
      emit('data-loaded');
    }).catch(function () {
      updateHeaderStatus();
    });
    var timeText = formatPublishedTime(res.time || res.updated);
    var extra = (res.warnings && res.warnings.length) ? (' Предупреждения: ' + res.warnings.join('; ')) : '';
    showToast({ kind: 'ok', text: 'Опубликовано · ' + timeText + extra, linkHref: '../price.html', linkText: 'Открыть прайс', duration: 8000 });
    emit('published', result);
  }
  function onPublishError(err) {
    if (err && err.code === 'unauthorized') { closeModal(); triggerReauth(); return; }
    if (err && err.code === 'invalid') {
      closeModal();
      var msg = (err.details && err.details.length) ? err.details.join(' ') : (err.message || 'Проверьте данные.');
      showToast({ kind: 'error', text: msg, duration: 8000 });
      highlightFromDetails(err.details);
      return;
    }
    showToast({ kind: 'error', text: (err && err.message) ? err.message : 'Не удалось опубликовать. Попробуйте ещё раз.', duration: 6000 });
  }
  function doPublish() {
    if (S.pendingPublish) return;
    setPublishPending(true);
    var payload = S.items.map(cleanItemForSave);
    var priceTask = S.serverMode ? apiCall('save', { data: { items: payload } }, { needsToken: true }) : demoSave(payload);
    /* каталог публикуется вторым шагом, только если реально изменён (_СПЕК-V2.md §3:
       «Опубликовать» публикует прайс и, если каталог изменён, — catalog_save) */
    priceTask.then(function (priceRes) {
      var cd = catalogDirty();
      if (cd > 0 && S.catalog) {
        var catPayload = S.catalog.products.map(cleanCatalogItemForSave);
        var catalogTask = S.serverMode
          ? apiCall('catalog_save', { data: { products: catPayload } }, { needsToken: true })
          : demoCatalogSave(catPayload);
        return catalogTask.then(function (catalogRes) { return { priceRes: priceRes, catalogRes: catalogRes }; });
      }
      return { priceRes: priceRes, catalogRes: null };
    }).then(onPublishSuccess).catch(onPublishError).then(function () { setPublishPending(false); });
  }
  function openPublishFlow() {
    var offender = null;
    for (var i = 0; i < S.items.length; i++) {
      if (!S.items[i].name || !String(S.items[i].name).trim()) { offender = S.items[i]; break; }
    }
    if (offender) {
      if (S.query && !matchesQuery(offender, norm(S.query))) {
        S.query = ''; $('#f-search').value = ''; renderTable();
      }
      showToast({ kind: 'error', text: 'Заполните название — есть пустые позиции', duration: 5000 });
      focusItem(offender, 'name', true);
      return;
    }
    var errs = validateAll();
    if (errs.length) {
      showToast({ kind: 'error', text: errs[0] + (errs.length > 1 ? (' И ещё ' + (errs.length - 1) + '.') : ''), duration: 6000 });
      return;
    }
    openModal();
  }

  /* ---------- 13. история публикаций / восстановление ---------- */
  function renderHistory() {
    var list = $('#history-list'); list.innerHTML = '';
    var empty = $('#history-empty');
    if (!S.backups.length) { empty.hidden = false; return; }
    empty.hidden = true;
    S.backups.forEach(function (b) {
      var li = document.createElement('li'); li.className = 'history__row';
      var meta = document.createElement('span'); meta.className = 'history__meta';
      meta.textContent = dateTimeRu(b.time) + ' · ' + b.positions + ' ' + plural(b.positions, 'позиция', 'позиции', 'позиций');
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'link-btn'; btn.textContent = 'Вернуть';
      btn.addEventListener('click', function () { openRestoreConfirm(b); });
      li.appendChild(meta); li.appendChild(btn);
      list.appendChild(li);
    });
  }
  function openRestoreConfirm(backup) {
    $('#modal-restore-text').textContent = 'Вернуть прайс от ' + dateTimeRu(backup.time) + '? Текущий уйдёт в историю.';
    S.pendingRestore = backup;
    $('#modal-restore-backdrop').hidden = false;
    trapFocus($('#modal-restore'));
    $('#modal-restore-confirm').focus();
  }
  function closeRestoreConfirm() {
    $('#modal-restore-backdrop').hidden = true;
    S.pendingRestore = null;
    releaseFocus();
  }
  function setRestorePending(on) {
    $('#modal-restore-confirm').disabled = on;
    $('#modal-restore-cancel').disabled = on;
    $('#modal-restore-confirm').textContent = on ? 'Возвращаем…' : 'Вернуть';
  }
  function doRestoreConfirmed() {
    var backup = S.pendingRestore;
    if (!backup) return;
    setRestorePending(true);
    var task = S.serverMode ? apiCall('restore', { name: backup.name }, { needsToken: true }) : demoRestore(backup.name);
    task.then(function (res) {
      closeRestoreConfirm();
      var refreshTask = S.serverMode ? apiCall('get', {}, { needsToken: false }) : demoGet();
      return refreshTask.then(function (getRes) {
        applyLoadedData(getRes.data, getRes.backups, getRes.catalog);
        clearDraft();
        refreshDraftBar();
        S.items = workingCopyFromBaseline();
        renderTable(); renderHistory(); updateHeaderStatus(); updateHeaderButtons();
        emit('items-changed');
        emit('data-loaded');
        /* closeRestoreConfirm() уже вернул фокус на кнопку «Вернуть» в #history-list —
           но renderHistory() только что пересоздал этот список, узел уничтожен.
           Переставляем фокус на стабильный элемент — заголовок вкладки «История». */
        var historyHeading = $('#history-heading');
        if (historyHeading) historyHeading.focus();
        showToast({ kind: 'ok', text: 'Прайс возвращён · ' + formatPublishedTime(res.time || res.updated), duration: 6000 });
      });
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') { closeRestoreConfirm(); triggerReauth(); return; }
      showToast({ kind: 'error', text: (err && err.message) ? err.message : 'Не удалось вернуть прайс.', duration: 6000 });
    }).then(function () { setRestorePending(false); });
  }

  /* ---------- 14. черновик (localStorage). Прайс и каталог карточек хранятся
     отдельными ключами (rybadm-draft / rybadm-draft-catalog — см. _СПЕК-V2.md
     §3), но показываются одной полосой над вкладками: если несохранённые
     правки есть в обоих — текст перечисляет оба, «Продолжить»/«Отбросить»
     применяется к обоим сразу (кнопка одна на весь экран, не по вкладкам). ---------- */
  function scheduleDraftSave(kind) {
    if (kind === 'catalog') {
      clearTimeout(S.catalogDraftTimer);
      S.catalogDraftTimer = setTimeout(saveCatalogDraftNow, 400);
    } else {
      clearTimeout(S.draftTimer);
      S.draftTimer = setTimeout(saveDraftNow, 400);
    }
  }
  function saveDraftNow() {
    if (!S.baseline) return;
    var payload = { items: S.items.map(cleanItemForSave), updatedBase: S.baseline.updated, savedAt: new Date().toISOString() };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(payload)); } catch (e) {}
  }
  function saveCatalogDraftNow() {
    if (!S.catalogBaseline || !S.catalog) return;
    var payload = { products: S.catalog.products.map(cleanCatalogItemForSave), updatedBase: S.catalogBaseline.updated, savedAt: new Date().toISOString() };
    try { localStorage.setItem(DRAFT_CATALOG_KEY, JSON.stringify(payload)); } catch (e) {}
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    clearTimeout(S.draftTimer);
  }
  function clearCatalogDraft() {
    try { localStorage.removeItem(DRAFT_CATALOG_KEY); } catch (e) {}
    clearTimeout(S.catalogDraftTimer);
  }
  function sortForCompare(arr) {
    return arr.slice().sort(function (a, b) { return (a.id || '').localeCompare(b.id || ''); });
  }
  function sortCatalogForCompare(arr) {
    return arr.slice().sort(function (a, b) { return (a.key || '').localeCompare(b.key || ''); });
  }
  /* возвращает ISO-время черновика, если он есть и отличается от baseline, иначе null (и сам чистит совпадающий черновик) */
  function resolveDraftOnBoot() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
    if (!raw) return null;
    var draft = null;
    try { draft = JSON.parse(raw); } catch (e) {}
    if (!draft || !draft.items || !draft.items.length) return null;
    var baseNorm = S.baseline.items.map(cleanItemForSave);
    var same = JSON.stringify(sortForCompare(baseNorm)) === JSON.stringify(sortForCompare(draft.items));
    if (same) { clearDraft(); return null; }
    var baseIds = {};
    S.baseline.items.forEach(function (b) { baseIds[b.id] = true; });
    S.items = draft.items.map(function (it) {
      var c = deepClone(it);
      c._key = 'k' + (KEY_SEQ++);
      c._new = !(c.id && baseIds[c.id]);
      return c;
    });
    return draft.savedAt;
  }
  function resolveCatalogDraftOnBoot() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_CATALOG_KEY); } catch (e) {}
    if (!raw) return null;
    var draft = null;
    try { draft = JSON.parse(raw); } catch (e) {}
    if (!draft || !draft.products || !draft.products.length) return null;
    var baseNorm = (S.catalogBaseline.products || []).map(cleanCatalogItemForSave);
    var same = JSON.stringify(sortCatalogForCompare(baseNorm)) === JSON.stringify(sortCatalogForCompare(draft.products));
    if (same) { clearCatalogDraft(); return null; }
    var baseKeys = {};
    (S.catalogBaseline.products || []).forEach(function (b) { baseKeys[b.key] = true; });
    S.catalog = {
      updated: S.catalogBaseline.updated,
      products: draft.products.map(function (p) {
        var c = deepClone(p);
        c._key = 'ck' + (KEY_SEQ++);
        c._new = !(c.key && baseKeys[c.key]);
        return c;
      })
    };
    return draft.savedAt;
  }
  /* одна полоса «Есть несохранённые правки…» на прайс и каталог сразу */
  function applyDraftBar(priceSavedAt, catalogSavedAt) {
    if (!priceSavedAt && !catalogSavedAt) { $('#draft-bar').hidden = true; return; }
    var text;
    if (priceSavedAt && catalogSavedAt) {
      var latest = (new Date(catalogSavedAt) > new Date(priceSavedAt)) ? catalogSavedAt : priceSavedAt;
      text = 'Есть несохранённые правки в прайсе и карточках от ' + dateTimeRuNoYear(latest) + '.';
    } else if (catalogSavedAt) {
      text = 'Есть несохранённые правки в карточках от ' + dateTimeRuNoYear(catalogSavedAt) + '.';
    } else {
      text = 'Есть несохранённые правки от ' + dateTimeRuNoYear(priceSavedAt) + '.';
    }
    $('#draft-bar-text').textContent = text;
    $('#draft-bar').hidden = false;
  }
  /* перечитать оба ключа localStorage и обновить полосу — используется везде,
     где один из черновиков мог исчезнуть (отмена правок, сброс, публикация,
     восстановление), чтобы не тащить время черновика через кучу параметров */
  function refreshDraftBar() {
    var priceSavedAt = null, catalogSavedAt = null;
    try {
      var rawP = localStorage.getItem(DRAFT_KEY);
      if (rawP) { var dp = JSON.parse(rawP); priceSavedAt = dp && dp.savedAt; }
    } catch (e) {}
    try {
      var rawC = localStorage.getItem(DRAFT_CATALOG_KEY);
      if (rawC) { var dc = JSON.parse(rawC); catalogSavedAt = dc && dc.savedAt; }
    } catch (e) {}
    applyDraftBar(priceSavedAt, catalogSavedAt);
  }

  /* ---------- 15. тосты ---------- */
  function showToast(opts) {
    var el = document.createElement('div');
    el.className = 'toast' + (opts.kind === 'error' ? ' toast--error' : ' toast--ok');
    el.setAttribute('role', opts.kind === 'error' ? 'alert' : 'status');
    var text = document.createElement('span'); text.textContent = opts.text;
    el.appendChild(text);
    if (opts.linkHref) {
      var a = document.createElement('a'); a.href = opts.linkHref; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'link-btn'; a.textContent = opts.linkText || 'Открыть';
      el.appendChild(a);
    }
    if (opts.actionText) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn'; b.textContent = opts.actionText;
      b.addEventListener('click', function () { if (opts.onAction) opts.onAction(); dismiss(); });
      el.appendChild(b);
    }
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'link-btn'; closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Закрыть уведомление');
    closeBtn.addEventListener('click', dismiss);
    el.appendChild(closeBtn);
    $('#toasts').appendChild(el);
    /* удаление строки убивает узел, на котором стоял фокус (кнопка «×»);
       перекидываем фокус на кнопку отмены в тосте, чтобы он не падал на <body> */
    if (opts.focusAction && opts.actionText && b) b.focus();
    var timer = setTimeout(dismiss, opts.duration || 5000);
    function dismiss() {
      clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  /* ---------- 16. фокус-ловушка модалок ---------- */
  var trapHandler = null, trapPrevFocus = null;
  function trapFocus(container) {
    trapPrevFocus = document.activeElement;
    trapHandler = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeAnyModal(); return; }
      if (e.key !== 'Tab') return;
      var focusables = container.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapHandler, true);
  }
  function releaseFocus() {
    if (trapHandler) document.removeEventListener('keydown', trapHandler, true);
    trapHandler = null;
    if (trapPrevFocus && trapPrevFocus.focus) { try { trapPrevFocus.focus(); } catch (e) {} }
    trapPrevFocus = null;
  }
  function closeAnyModal() {
    if (!$('#modal-backdrop').hidden) { closeModal(); return; }
    if (!$('#modal-restore-backdrop').hidden) { closeRestoreConfirm(); return; }
    if (!$('#modal-logout-backdrop').hidden) { closeLogoutConfirm(); return; }
    if (!$('#sheet-backdrop').hidden) { closeSheet(); return; }
    closeAllDropdowns();
  }

  /* ---------- 16а. RYBADM.modal.open/close — универсальный лист поверх
     существующей модалки (та же ловушка фокуса и Esc, что у публикации/
     восстановления/выхода). Для будущих модулей: смена пароля, диффы
     импорта, кроп фото и т.п. — они сами наполняют #sheet-body и кнопки.
     openSheet({ title, body: Node, actions: [{label, kind, onClick, disabled, id}], wide }) */
  function openSheet(opts) {
    opts = opts || {};
    closeAllDropdowns();
    var dialog = $('#sheet-dialog');
    dialog.classList.toggle('modal--wide', !!opts.wide);
    $('#sheet-title').textContent = opts.title || '';
    var body = $('#sheet-body');
    body.innerHTML = '';
    if (opts.body) {
      if (opts.body.nodeType) body.appendChild(opts.body);
      else { var p = document.createElement('p'); p.textContent = String(opts.body); body.appendChild(p); }
    }
    var actionsEl = $('#sheet-actions');
    actionsEl.innerHTML = '';
    (opts.actions || []).forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var kindClass = a.kind === 'solid' ? 'btn--solid' : (a.kind === 'text' ? 'btn--text' : 'btn--ghost');
      btn.className = 'btn ' + kindClass;
      btn.textContent = a.label || '';
      if (a.id) btn.id = a.id;
      if (a.disabled) btn.disabled = true;
      btn.addEventListener('click', function () { if (a.onClick) a.onClick(); });
      actionsEl.appendChild(btn);
    });
    $('#sheet-backdrop').hidden = false;
    trapFocus(dialog);
    var focusTarget = body.querySelector('input, select, textarea, button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')
      || actionsEl.querySelector('button:not(:disabled)');
    if (focusTarget) focusTarget.focus(); else dialog.focus();
  }
  function closeSheet() {
    $('#sheet-backdrop').hidden = true;
    releaseFocus();
  }

  /* ---------- 17. выпадающие меню: «⋯» на телефоне, «Ещё ▾» на десктопе,
     «Экспорт ▾» в тулбаре — один и тот же механизм (открыть/закрыть по клику
     на триггер, закрыть по клику вне, закрыть все по Esc, автозакрытие
     остальных при открытии одного). Триггер с disabled (модуль не загружен)
     просто никогда не откроет меню. ---------- */
  var DROPDOWNS = [];
  function registerDropdown(triggerSel, menuSel) {
    var trigger = $(triggerSel), menu = $(menuSel);
    if (!trigger || !menu) return null;
    function isOpen() { return !menu.hidden; }
    function onDocClick(e) {
      if (!menu.contains(e.target) && e.target !== trigger) close();
    }
    function open() {
      closeAllDropdowns();
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', onDocClick);
    }
    function close() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick);
    }
    trigger.addEventListener('click', function () {
      if (trigger.disabled) return;
      if (isOpen()) close(); else open();
    });
    var api = { open: open, close: close, isOpen: isOpen };
    DROPDOWNS.push(api);
    return api;
  }
  function closeAllDropdowns() {
    DROPDOWNS.forEach(function (d) { if (d.isOpen()) d.close(); });
  }

  /* ---------- 18. вход / первый вход / выход / сессия истекла ---------- */
  function showAuth(opts) {
    opts = opts || {};
    S.setupMode = (opts.mode === 'setup');
    var titleEl = $('#auth-title');
    titleEl.textContent = S.setupMode ? 'Первый вход' : (opts.reauth ? 'Сессия истекла · вход' : 'Прайс · вход');
    $('#f-pass2-wrap').hidden = !S.setupMode;
    $('#auth-submit').textContent = S.setupMode ? 'Задать и войти' : 'Войти';
    var errEl = $('#auth-error'); errEl.hidden = true; errEl.textContent = '';
    var note = $('#auth-note');
    if (S.setupMode) {
      note.hidden = false;
      note.textContent = 'Пароль не короче 8 символов. Запишите его: восстановление — только через файл на сервере (см. инструкцию).';
    } else if (!S.serverMode) {
      note.hidden = false;
      note.textContent = 'Демо-режим: логин demo, пароль demo. Изменения сохраняются только в этом браузере.';
    } else {
      note.hidden = true;
    }
    $('#f-login').value = ''; $('#f-pass').value = ''; $('#f-pass2').value = '';
    $('#screen-auth').hidden = false;
    /* экран входа рисуется поверх #screen-app (см. §5.3 «401 в любой момент —
       поверх таблицы экран входа»), но саму таблицу мы не прячем — она
       по-прежнему в DOM. inert исключает её из табуляции, пока сверху форма входа. */
    $('#screen-app').setAttribute('inert', '');
    setTimeout(function () { $('#f-login').focus(); }, 0);
  }
  function hideAuth() {
    $('#screen-app').removeAttribute('inert');
    $('#screen-auth').hidden = true;
  }
  function showAuthError(msg) { var el = $('#auth-error'); el.textContent = msg; el.hidden = false; }
  function setAuthPending(on) {
    S.authPending = on;
    $('#auth-submit').disabled = on;
    $('#auth-submit').textContent = on ? 'Входим…' : (S.setupMode ? 'Задать и войти' : 'Войти');
  }
  function triggerReauth() {
    S.authed = false; S.token = null;
    showAuth({ mode: 'login', reauth: true });
  }
  function doLogin(login, pass) {
    setAuthPending(true);
    if (S.serverMode) {
      apiCall('login', { login: login, password: pass }, { needsToken: false }).then(function (res) {
        S.authed = true; S.token = res.token; hideAuth();
        setAuthPending(false);
        if ($('#screen-app').hidden) loadServerData();
        else { renderTable(); updateHeaderButtons(); }
      }).catch(function (err) {
        setAuthPending(false);
        showAuthError((err && err.message) ? err.message : 'Не удалось войти.');
      });
    } else {
      var lock = checkDemoLock();
      if (lock) { setAuthPending(false); showAuthError(lock); return; }
      if (login === 'demo' && pass === 'demo') {
        resetDemoLock();
        try { sessionStorage.setItem(DEMO_AUTH_KEY, '1'); } catch (e) {}
        S.authed = true; hideAuth();
        setAuthPending(false);
        if ($('#screen-app').hidden) loadDemoData();
        else { renderTable(); updateHeaderButtons(); }
      } else {
        registerDemoFail();
        setAuthPending(false);
        showAuthError('Неверный логин или пароль');
      }
    }
  }
  function doSetup(login, pass) {
    setAuthPending(true);
    apiCall('setup', { login: login, password: pass }, { needsToken: false }).then(function (res) {
      S.authed = true; S.token = res.token; hideAuth();
      setAuthPending(false);
      loadServerData();
    }).catch(function (err) {
      setAuthPending(false);
      showAuthError((err && err.message) ? err.message : 'Не удалось выполнить настройку.');
    });
  }
  function openLogoutConfirm() {
    $('#modal-logout-backdrop').hidden = false;
    trapFocus($('#modal-logout'));
    $('#modal-logout-confirm').focus();
  }
  function closeLogoutConfirm() {
    $('#modal-logout-backdrop').hidden = true;
    releaseFocus();
  }
  function doLogoutNow() {
    if (S.serverMode) {
      apiCall('logout', {}, { needsToken: true }).catch(function () {}).then(afterLogout);
    } else {
      try { sessionStorage.removeItem(DEMO_AUTH_KEY); } catch (e) {}
      afterLogout();
    }
  }
  function logout() {
    closeAllDropdowns();
    if (computeDiff().total > 0) { openLogoutConfirm(); return; }
    doLogoutNow();
  }
  function afterLogout() {
    S.authed = false; S.token = null;
    $('#screen-app').hidden = true;
    showAuth({ mode: 'login' });
  }

  /* ---------- 19. загрузка данных / старт ---------- */
  function finishBoot() {
    $('#demo-bar').hidden = S.serverMode;
    S.items = workingCopyFromBaseline();
    S.catalog = catalogWorkingCopyFromBaseline();
    var priceDraftAt = resolveDraftOnBoot();
    var catalogDraftAt = resolveCatalogDraftOnBoot();
    applyDraftBar(priceDraftAt, catalogDraftAt);
    updateHeaderStatus();
    renderTable();
    renderHistory();
    updateHeaderButtons();
    hideAuth();
    $('#screen-app').hidden = false;
    emit('data-loaded');
  }
  function loadServerData() {
    apiCall('get', {}, { needsToken: false }).then(function (res) {
      applyLoadedData(res.data, res.backups, res.catalog);
      finishBoot();
    }).catch(function (err) {
      if (err && err.code === 'unauthorized') { showAuth({ mode: 'login' }); return; }
      showToast({ kind: 'error', text: (err && err.message) ? err.message : 'Не удалось загрузить прайс.', duration: 6000 });
      showAuth({ mode: 'login' });
    });
  }
  function loadDemoData() {
    var store = loadDemoStore();
    var catalogStore = loadDemoCatalogStore();
    applyLoadedData(store.data, store.backups.map(function (b) { return { name: b.name, time: b.time, positions: b.positions }; }), catalogStore.data);
    finishBoot();
  }
  function startDemo() {
    S.serverMode = false;
    var authed = false;
    try { authed = sessionStorage.getItem(DEMO_AUTH_KEY) === '1'; } catch (e) {}
    if (authed) { S.authed = true; loadDemoData(); }
    else showAuth({ mode: 'login' });
  }
  function boot() {
    pingServer().then(function (res) {
      if (!res || typeof res.php === 'undefined') { startDemo(); return; }
      S.serverMode = true;
      S.setupMode = !!res.setup;
      S.authed = !!res.authed;
      if (S.setupMode) showAuth({ mode: 'setup' });
      else if (!S.authed) showAuth({ mode: 'login' });
      else loadServerData();
    }).catch(function () { startDemo(); });
  }

  /* ---------- 20. проводка UI, не связанного с таблицей ---------- */
  function wirePassToggle(inputSel, btnSel) {
    var input = $(inputSel), btn = $(btnSel);
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Скрыть' : 'Показать';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
  }
  function wireStatic() {
    $('#auth-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (S.authPending) return;
      var login = $('#f-login').value.trim();
      var pass = $('#f-pass').value;
      $('#auth-error').hidden = true;
      if (S.setupMode) {
        var pass2 = $('#f-pass2').value;
        if (pass.length < 8) { showAuthError('Пароль не короче 8 символов.'); return; }
        if (pass !== pass2) { showAuthError('Пароли не совпадают.'); return; }
        doSetup(login, pass);
      } else {
        doLogin(login, pass);
      }
    });
    wirePassToggle('#f-pass', '#f-pass-toggle');
    wirePassToggle('#f-pass2', '#f-pass2-toggle');

    $('#f-search').addEventListener('input', debounce(function (e) { S.query = e.target.value; renderTable(); }, 80));
    $('#f-search').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.target.value = ''; S.query = ''; renderTable(); }
    });

    $('#btn-add').addEventListener('click', addItem);
    $('#btn-revert').addEventListener('click', revertEdits);
    $('#menu-revert').addEventListener('click', revertEdits);
    $('#btn-publish').addEventListener('click', openPublishFlow);
    $('#btn-publish-mobile').addEventListener('click', openPublishFlow);
    $('#btn-logout').addEventListener('click', logout);
    $('#menu-logout').addEventListener('click', logout);

    /* выпадающие меню: «⋯» (телефон), «Ещё ▾» (десктоп) — пункты «Предпросмотр»/
       «Сменить пароль» внутри обоих остаются disabled, пока их не включит
       admin-extra.js; «Экспорт ▾» в тулбаре «Прайс» — так же, admin-import.js */
    registerDropdown('#hdr-more', '#hdr-menu');
    registerDropdown('#hdr-more-text', '#hdr-menu-text');
    registerDropdown('#btn-export', '#export-menu');

    $('#draft-continue').addEventListener('click', function () { $('#draft-bar').hidden = true; });
    $('#draft-discard').addEventListener('click', function () {
      clearDraft();
      clearCatalogDraft();
      S.items = workingCopyFromBaseline();
      S.catalog = catalogWorkingCopyFromBaseline();
      refreshDraftBar();
      renderTable(); updateHeaderButtons();
      emit('items-changed');
    });

    $('#modal-cancel').addEventListener('click', closeModal);
    $('#modal-backdrop').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    $('#modal-confirm').addEventListener('click', doPublish);

    $('#modal-restore-cancel').addEventListener('click', closeRestoreConfirm);
    $('#modal-restore-backdrop').addEventListener('click', function (e) { if (e.target === this) closeRestoreConfirm(); });
    $('#modal-restore-confirm').addEventListener('click', doRestoreConfirmed);

    $('#modal-logout-cancel').addEventListener('click', closeLogoutConfirm);
    $('#modal-logout-backdrop').addEventListener('click', function (e) { if (e.target === this) closeLogoutConfirm(); });
    $('#modal-logout-confirm').addEventListener('click', function () { closeLogoutConfirm(); doLogoutNow(); });

    $('#sheet-backdrop').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllDropdowns();
    });

    window.addEventListener('beforeunload', function (e) {
      if (S.authed && S.baseline && computeDiff().total > 0) {
        e.preventDefault(); e.returnValue = '';
      }
    });

    wireTabs();

    /* Планшет: поле примечания стоит второй строкой под названием без подписи —
       ему нужна словесная заглушка. На десктопе колонка подписана в шапке, на
       телефоне есть подпись «Примечание» в карточке — там достаточно «—»,
       иначе слово повторяется 50 раз. При смене брейкпоинта обновляем заглушки. */
    if (TABLET_MQ.addEventListener) {
      TABLET_MQ.addEventListener('change', function () {
        var ph = notesPlaceholder();
        Array.prototype.forEach.call(document.querySelectorAll('#tbody input[data-field="notes"]'), function (el) { el.placeholder = ph; });
      });
    }

    wireTable();
  }

  var TABLET_MQ = window.matchMedia ? window.matchMedia('(min-width: 760px) and (max-width: 1099.98px)') : { matches: false };
  function notesPlaceholder() { return TABLET_MQ.matches ? 'примечание' : '—'; }

  /* ---------- 20а. вкладки «Прайс · Карточки · История» (role="tablist"),
     переключение мышью и стрелками (Left/Right/Home/End — «automatic
     activation»: фокус сразу активирует вкладку), синхронизация с hash. ---------- */
  var TAB_IDS = ['price', 'cards', 'history'];
  var currentTab = 'price';
  function activateTab(name, opts) {
    opts = opts || {};
    if (TAB_IDS.indexOf(name) === -1) name = 'price';
    currentTab = name;
    TAB_IDS.forEach(function (id) {
      var btn = $('#tab-' + id), panel = $('#panel-' + id);
      var active = (id === name);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
    });
    if (opts.updateHash !== false) {
      var newHash = '#' + name;
      if (location.hash !== newHash) {
        if (window.history && history.replaceState) history.replaceState(null, '', newHash);
        else location.hash = newHash;
      }
    }
    if (opts.focus) $('#tab-' + name).focus();
    emit('tab', name);
  }
  function wireTabs() {
    TAB_IDS.forEach(function (id) {
      $('#tab-' + id).addEventListener('click', function () { activateTab(id); });
    });
    $('#tabs').addEventListener('keydown', function (e) {
      var idx = TAB_IDS.indexOf(currentTab);
      if (e.key === 'ArrowRight') { e.preventDefault(); activateTab(TAB_IDS[(idx + 1) % TAB_IDS.length], { focus: true }); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); activateTab(TAB_IDS[(idx - 1 + TAB_IDS.length) % TAB_IDS.length], { focus: true }); }
      else if (e.key === 'Home') { e.preventDefault(); activateTab(TAB_IDS[0], { focus: true }); }
      else if (e.key === 'End') { e.preventDefault(); activateTab(TAB_IDS[TAB_IDS.length - 1], { focus: true }); }
    });
    window.addEventListener('hashchange', function () {
      var h = location.hash.replace('#', '');
      if (TAB_IDS.indexOf(h) !== -1 && h !== currentTab) activateTab(h, { updateHash: false });
    });
    var initial = location.hash.replace('#', '');
    activateTab(TAB_IDS.indexOf(initial) !== -1 ? initial : 'price', { updateHash: false });
  }

  /* ---------- 21. старт ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    wireStatic();
    boot();
  });

  /* ---------- 22. внутренний API для модулей (_СПЕК-V2.md §3) — ровно эти
     имена; модули (admin-import.js / admin-cards.js / admin-extra.js) читают
     и пишут через них, RYBADM.state — тот же живой объект S (не копия), так
     что RYBADM.state.items/.catalog всегда актуальны. ---------- */
  window.RYBADM = {
    state: S,
    api: apiCall,
    demo: {
      get: demoGet, save: demoSave, restore: demoRestore, store: loadDemoStore,
      catalogGet: demoCatalogGet, catalogSave: demoCatalogSave
    },
    render: renderTable,
    renderHistory: renderHistory,
    markDirty: markDirtyCell,
    scheduleDraftSave: scheduleDraftSave,
    updateHeaderButtons: updateHeaderButtons,
    computeDiff: computeDiff,
    catalogDirty: catalogDirty,
    toast: showToast,
    modal: { open: openSheet, close: closeSheet },
    fmt: { money: fmtNum, parseMoney: parseMoney, dateRu: dateRu, dateTimeRu: dateTimeRu },
    slugify: slugify,
    uniqueId: uniqueId,
    on: on,
    emit: emit
  };
})();
