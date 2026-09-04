/* ============================================================
   admin-import.js — импорт XLS/XLSX, экспорт, переоценка (агент
   «импорт», _СПЕК-V2.md §4). IIFE, читает/пишет только через
   window.RYBADM (ядро, admin.js). Библиотека: window.XLSX
   (admin/vendor/xlsx.full.min.js, подключена <script defer> до
   этого файла). Без сборки, ES5 (тот же язык, что у ядра).
   ============================================================ */
(function () {
  'use strict';

  var RYBADM = window.RYBADM;
  if (!RYBADM) { return; } /* ядро не загрузилось — модулю делать нечего */

  /* ---------- 0. META — перенесено из data/build_prices.py (таблица
     «контрольная подстрока XLS → позиция»). Порядок — как в файле
     владельца, не важен для поиска (ищем по вхождению подстроки).
     key — нижний регистр, ищется вхождением в нормализованный (только
     lower+ё→е) текст строки XLS — так же, как build_prices.py проверял
     `assert key in xls_name.lower()`. ---------- */
  var META = [
    { key: 'плотва вяленая средняя', id: 'plotva-vyalenaya-srednyaya', category: 'вяленая', name: 'Плотва вяленая', variant: 'средняя, до 90 г', unit: 'кг', notes: null },
    { key: 'плотва вяленая крупная', id: 'plotva-vyalenaya-krupnaya', category: 'вяленая', name: 'Плотва вяленая', variant: 'крупная, от 90 г', unit: 'кг', notes: null },
    { key: 'плотва "казачка"', id: 'plotva-kazachka', category: 'вяленая', name: 'Плотва «Казачка»', variant: null, unit: 'кг', notes: 'фирменный рецепт' },
    { key: 'густера вяленая средняя', id: 'gustera-vyalenaya-srednyaya', category: 'вяленая', name: 'Густера вяленая', variant: 'средняя', unit: 'кг', notes: null },
    { key: 'густера вяленая крупная', id: 'gustera-vyalenaya-krupnaya', category: 'вяленая', name: 'Густера вяленая', variant: 'крупная', unit: 'кг', notes: null },
    { key: 'окунь вяленый средний', id: 'okun-vyalenyy-sredniy', category: 'вяленая', name: 'Окунь вяленый', variant: 'средний', unit: 'кг', notes: null },
    { key: 'окунь вяленый крупный', id: 'okun-vyalenyy-krupnyy', category: 'вяленая', name: 'Окунь вяленый', variant: 'крупный', unit: 'кг', notes: null },
    { key: 'рыбец вяленый средний', id: 'rybets-vyalenyy-sredniy', category: 'вяленая', name: 'Рыбец вяленый', variant: 'средний, до 180 г', unit: 'кг', notes: null },
    { key: 'рыбец вяленый крупный', id: 'rybets-vyalenyy-krupnyy', category: 'вяленая', name: 'Рыбец вяленый', variant: 'крупный, 180–250 г', unit: 'кг', notes: null },
    { key: 'чехонь вяленая крупная', id: 'chehon-vyalenaya-krupnaya', category: 'вяленая', name: 'Чехонь вяленая', variant: 'крупная', unit: 'кг', notes: null },
    { key: 'чехонь вяленая средняя', id: 'chehon-vyalenaya-srednyaya', category: 'вяленая', name: 'Чехонь вяленая', variant: 'средняя', unit: 'кг', notes: null },
    { key: 'лещ вяленый средний/хк', id: 'leshch-vyalenyy-hk-350-500', category: 'вяленая и холодного копчения', name: 'Лещ вяленый / х/к', variant: 'средний, 350–500 г', unit: 'кг', notes: null },
    { key: 'лещ вяленый/хк 500', id: 'leshch-vyalenyy-hk-500-700', category: 'вяленая и холодного копчения', name: 'Лещ вяленый / х/к', variant: '500–700 г', unit: 'кг', notes: null },
    { key: 'лещ вяленый 700', id: 'leshch-vyalenyy-700-900', category: 'вяленая', name: 'Лещ вяленый', variant: '700–900 г', unit: 'кг', notes: null },
    { key: 'лещ вяленый 900', id: 'leshch-vyalenyy-900-1200', category: 'вяленая', name: 'Лещ вяленый', variant: '900–1200 г', unit: 'кг', notes: null },
    { key: 'лещ вяленый отборный 1,2', id: 'leshch-vyalenyy-otbornyy-1200-1500', category: 'вяленая', name: 'Лещ вяленый отборный', variant: '1,2–1,5 кг', unit: 'кг', notes: null },
    { key: 'лещ вяленый отборный от 1,5', id: 'leshch-vyalenyy-otbornyy-ot-1500', category: 'вяленая', name: 'Лещ вяленый отборный', variant: 'от 1,5 кг', unit: 'кг', notes: null },
    { key: 'лещ вяленый/хк отборный от 2', id: 'leshch-vyalenyy-hk-otbornyy-ot-2kg', category: 'вяленая и холодного копчения', name: 'Лещ вяленый / х/к отборный', variant: 'от 2 кг', unit: 'кг', notes: null },
    { key: 'лещ х/к 700', id: 'leshch-hk-700-900', category: 'холодного копчения', name: 'Лещ х/к', variant: '700–900 г', unit: 'кг', notes: null },
    { key: 'лещ х/к 900', id: 'leshch-hk-900-1200', category: 'холодного копчения', name: 'Лещ х/к', variant: '900–1200 г', unit: 'кг', notes: null },
    { key: 'лещ х/к отборный 1,2', id: 'leshch-hk-otbornyy-1200-1500', category: 'холодного копчения', name: 'Лещ х/к отборный', variant: '1,2–1,5 кг', unit: 'кг', notes: null },
    { key: 'лещ х/к отборный от 1,5', id: 'leshch-hk-otbornyy-ot-1500', category: 'холодного копчения', name: 'Лещ х/к отборный', variant: 'от 1,5 кг', unit: 'кг', notes: null },
    { key: 'старым казачьим', id: 'leshch-kazachiy-sposob', category: 'вяленая', name: 'Лещ вяленый «Старым казачьим способом»', variant: null, unit: 'кг', notes: 'фирменный рецепт' },
    { key: 'карась вяленый/х/к пласт', id: 'karas-plast-sredniy', category: 'вяленая и холодного копчения', name: 'Карась вяленый / х/к', variant: 'пласт, средний', unit: 'кг', notes: null },
    { key: 'карась вяленый/х/к целый', id: 'karas-tselyy-sredniy', category: 'вяленая и холодного копчения', name: 'Карась вяленый / х/к', variant: 'целый, средний', unit: 'кг', notes: null },
    { key: 'сазан х/к. ребро', id: 'sazan-hk-rebro', category: 'холодного копчения', name: 'Сазан х/к', variant: 'ребро', unit: 'кг', notes: null },
    { key: 'сазан х/к. хвост', id: 'sazan-hk-hvost', category: 'холодного копчения', name: 'Сазан х/к', variant: 'хвост', unit: 'кг', notes: null },
    { key: 'судак вяленый средний', id: 'sudak-vyalenyy-sredniy', category: 'вяленая', name: 'Судак вяленый', variant: 'средний, 150–300 г', unit: 'кг', notes: null },
    { key: 'судак вяленый крупный', id: 'sudak-vyalenyy-krupnyy', category: 'вяленая', name: 'Судак вяленый', variant: 'крупный, от 300 г', unit: 'кг', notes: null },
    { key: 'судак х/к филе', id: 'sudak-hk-file', category: 'холодного копчения', name: 'Судак х/к', variant: 'филе', unit: 'кг', notes: null },
    { key: 'сельдь фарера', id: 'seld-farera-ss', category: 'слабосолёная', name: 'Сельдь Фарера слабосолёная', variant: '380+', unit: 'кг', notes: null },
    { key: 'скумбрия фарера с/с', id: 'skumbriya-farera-ss', category: 'слабосолёная', name: 'Скумбрия Фарера с/с', variant: '600+ н/р', unit: 'кг', notes: null },
    { key: 'скумбрия фарера х/к', id: 'skumbriya-farera-hk', category: 'холодного копчения', name: 'Скумбрия Фарера х/к', variant: '600+ н/р', unit: 'кг', notes: null },
    { key: 'толстолоб вяленый', id: 'tolstolob-vyalenyy', category: 'вяленая', name: 'Толстолоб вяленый', variant: null, unit: 'кг', notes: null },
    { key: 'мойва фарера вяленая', id: 'moyva-farera-vyalenaya', category: 'вяленая', name: 'Мойва Фарера вяленая', variant: null, unit: 'кг', notes: null },
    { key: 'мойва фарера х/к', id: 'moyva-farera-hk', category: 'холодного копчения', name: 'Мойва Фарера х/к', variant: null, unit: 'кг', notes: null },
    { key: 'форель с/с тушка', id: 'forel-ss-tushka', category: 'слабосолёная', name: 'Форель с/с', variant: 'тушка', unit: 'кг', notes: null },
    { key: 'форель х/к тушка', id: 'forel-hk-tushka', category: 'холодного копчения', name: 'Форель х/к', variant: 'тушка', unit: 'кг', notes: null },
    { key: 'форель с/с филе', id: 'forel-ss-file', category: 'слабосолёная', name: 'Форель с/с', variant: 'филе', unit: 'кг', notes: null },
    { key: 'горбуша с/с', id: 'gorbusha-ss', category: 'слабосолёная', name: 'Горбуша с/с', variant: null, unit: 'кг', notes: null },
    { key: 'горбуша х/к', id: 'gorbusha-hk', category: 'холодного копчения', name: 'Горбуша х/к', variant: null, unit: 'кг', notes: null },
    { key: 'икра кеты', id: 'ikra-kety-480', category: 'икра', name: 'Икра кеты слабосолёная', variant: 'стекло 480 г', unit: 'банка', notes: null },
    { key: 'икра горбуши слабосоленая. стекло 200', id: 'ikra-gorbushi-200', category: 'икра', name: 'Икра горбуши слабосолёная', variant: 'стекло 200 г', unit: 'банка', notes: null },
    { key: 'икра горбуши слабосоленая. стекло 230', id: 'ikra-gorbushi-230', category: 'икра', name: 'Икра горбуши слабосолёная', variant: 'стекло 230 г', unit: 'банка', notes: null },
    { key: 'икра горбуши слабосоленая. стекло 90', id: 'ikra-gorbushi-90', category: 'икра', name: 'Икра горбуши слабосолёная', variant: 'стекло 90 г', unit: 'банка', notes: null },
    { key: 'камбала белобрюшка', id: 'kambala-belobryushka-vyalenaya', category: 'вяленая', name: 'Камбала белобрюшка вяленая', variant: null, unit: 'кг', notes: null },
    { key: 'камбала - ерш', id: 'kambala-yorsh-vyalenaya', category: 'вяленая', name: 'Камбала-ёрш вяленая', variant: null, unit: 'кг', notes: null },
    { key: 'сом вяленый/х/к филе', id: 'som-file', category: 'вяленая и холодного копчения', name: 'Сом вяленый / х/к', variant: 'филе', unit: 'кг', notes: null },
    { key: 'сом вяленый/х/к кольцо', id: 'som-koltso', category: 'вяленая и холодного копчения', name: 'Сом вяленый / х/к', variant: 'кольцо', unit: 'кг', notes: null },
    { key: 'сом вяленый/х/к мелкий', id: 'som-melkiy', category: 'вяленая и холодного копчения', name: 'Сом вяленый / х/к', variant: 'мелкий', unit: 'кг', notes: null }
  ];

  /* категории — тот же список и подписи, что в ORDER/TITLE ядра (admin.js
     их не отдаёт наружу через RYBADM, поэтому дублируем: 5 разделов
     прайса, порядок как на сайте). */
  var CAT_ORDER = ['вяленая', 'вяленая и холодного копчения', 'холодного копчения', 'слабосолёная', 'икра'];
  var CAT_TITLE = {
    'вяленая': 'Вяленая',
    'вяленая и холодного копчения': 'Вяленая и холодного копчения',
    'холодного копчения': 'Холодного копчения',
    'слабосолёная': 'Слабосолёная',
    'икра': 'Икра'
  };

  /* ---------- 1. утилиты ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function plural(n, a, b, c) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return b;
    return c;
  }
  /* lower + ё→е + схлопнуть пробелы — минимальная нормализация для
     поиска подстрок META (тот же уровень, что у build_prices.py) */
  function lowerE(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }
  /* полная нормализация для точного сравнения «название файла» ==
     «name + variant» текущей позиции: убрать кавычки/точки, тире → дефис,
     «х/к»/«х.к.»/«хк» → «хк», «гр.» → «г», схлопнуть пробелы */
  function aggressiveNormalize(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    t = t.replace(/ё/g, 'е');
    t = t.replace(/[–—]/g, '-');
    t = t.replace(/х\s*\.?\s*\/?\s*\.?\s*к\.?/g, 'хк');
    t = t.replace(/гр\.?\b/g, 'г');
    t = t.replace(/[«»""'`]/g, '');
    t = t.replace(/[.,;:\/]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }
  function colLetter(idx) {
    var s = '', n = idx + 1;
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function isNumericVal(v) {
    if (v == null || v === '') return false;
    if (typeof v === 'number') return isFinite(v);
    if (typeof v === 'string') {
      var s = v.trim().replace(/\s+/g, '').replace(',', '.');
      return /^\d+(\.\d+)?$/.test(s);
    }
    return false;
  }
  function toNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : null;
    var s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  }
  function isTextVal(v) {
    if (v == null) return false;
    var s = String(v).trim();
    if (!s) return false;
    return !isNumericVal(v);
  }
  function maxCols(aoa) {
    var m = 0;
    for (var i = 0; i < aoa.length; i++) { var r = aoa[i]; if (r && r.length > m) m = r.length; }
    return m;
  }
  function xlsxReady() { return typeof window.XLSX !== 'undefined' && !!window.XLSX.read; }

  /* ---------- 2. разбор файла: выбор листа и колонок ---------- */
  /* строка листа считается «строкой данных», если в ней есть текстовая
     ячейка (название) и хотя бы одна числовая (цена) — этого достаточно,
     чтобы естественно отсеять и шапку-простыню (только текст), и строку
     заголовков таблицы (текст «Цена опт…»/«Цена розница…», тоже без чисел) */
  function analyzeSheet(ws) {
    var aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    var ncols = maxCols(aoa);
    if (!ncols) return null;
    var dataRows = [];
    for (var r = 0; r < aoa.length; r++) {
      var row = aoa[r] || [];
      var nameIdx = -1;
      for (var c = 0; c < row.length; c++) { if (isTextVal(row[c])) { nameIdx = c; break; } }
      if (nameIdx === -1) continue;
      var priceIdxs = [];
      for (var c2 = 0; c2 < row.length; c2++) { if (c2 !== nameIdx && isNumericVal(row[c2])) priceIdxs.push(c2); }
      if (!priceIdxs.length) continue;
      dataRows.push({ r: r, nameIdx: nameIdx, priceIdxs: priceIdxs });
    }
    if (!dataRows.length) return { aoa: aoa, ncols: ncols, score: 0 };
    var nameVotes = {};
    dataRows.forEach(function (d) { nameVotes[d.nameIdx] = (nameVotes[d.nameIdx] || 0) + 1; });
    var nameCol = 0, bestVotes = -1;
    Object.keys(nameVotes).forEach(function (k) { if (nameVotes[k] > bestVotes) { bestVotes = nameVotes[k]; nameCol = parseInt(k, 10); } });
    var priceVotes = {};
    dataRows.forEach(function (d) { d.priceIdxs.forEach(function (p) { if (p !== nameCol) priceVotes[p] = (priceVotes[p] || 0) + 1; }); });
    var priceCols = Object.keys(priceVotes).map(Number).sort(function (a, b) { return a - b; });
    var goodRows = dataRows.filter(function (d) { return d.nameIdx === nameCol; });
    return { aoa: aoa, ncols: ncols, nameCol: nameCol, priceCols: priceCols, score: goodRows.length };
  }
  /* заголовок (в верхних 20 строках) со словами «опт»/«розн» — определяет
     семантику колонок; если не нашли — опт первая числовая колонка,
     розница вторая (порядок в файле владельца, см. data/build_prices.py) */
  function detectRoles(aoa, priceCols) {
    var roles = null;
    for (var r = 0; r < Math.min(20, aoa.length); r++) {
      var row = aoa[r] || [];
      var hitOpt = -1, hitRetail = -1;
      for (var c = 0; c < row.length; c++) {
        var t = lowerE(row[c]);
        if (!t) continue;
        if (hitOpt === -1 && t.indexOf('опт') !== -1) hitOpt = c;
        if (hitRetail === -1 && t.indexOf('розн') !== -1) hitRetail = c;
      }
      if (hitOpt !== -1 || hitRetail !== -1) { roles = { headerIdx: r, opt: hitOpt, retail: hitRetail }; break; }
    }
    var optCol = null, retailCol = null;
    if (roles && roles.opt !== -1 && priceCols.indexOf(roles.opt) !== -1) optCol = roles.opt;
    if (roles && roles.retail !== -1 && priceCols.indexOf(roles.retail) !== -1) retailCol = roles.retail;
    var remaining = priceCols.filter(function (c) { return c !== optCol && c !== retailCol; });
    if (optCol == null) optCol = remaining.shift();
    if (retailCol == null) retailCol = remaining.shift();
    if (optCol == null) optCol = priceCols[0];
    if (retailCol == null) retailCol = priceCols[1] != null ? priceCols[1] : priceCols[0];
    return { headerIdx: roles ? roles.headerIdx : -1, optCol: optCol, retailCol: retailCol };
  }
  function extractRows(aoa, nameCol, optCol, retailCol, headerIdx) {
    var rows = [];
    for (var r = 0; r < aoa.length; r++) {
      if (r === headerIdx) continue;
      var row = aoa[r] || [];
      var nameRaw = row[nameCol];
      if (!isTextVal(nameRaw)) continue;
      var optNum = toNum(row[optCol]);
      var retailNum = toNum(row[retailCol]);
      if (optNum == null && retailNum == null) continue;
      rows.push({ rowIndex: r, text: String(nameRaw).trim(), opt: optNum, retail: retailNum });
    }
    return rows;
  }
  /* точка входа для input/drop — разбирает буфер, выбирает лучший лист
     (максимум строк «текст + число») и распознаёт колонки. */
  function parseArrayBuffer(buf, filename) {
    if (!xlsxReady()) return { ok: false, message: 'Библиотека ещё грузится' };
    var wb;
    try { wb = window.XLSX.read(buf, { type: 'array' }); }
    catch (e) { return { ok: false, message: 'Файл повреждён или не читается (' + ((e && e.message) || 'ошибка') + ').' }; }
    var best = null;
    (wb.SheetNames || []).forEach(function (sn) {
      var ws = wb.Sheets[sn];
      if (!ws) return;
      var a = analyzeSheet(ws);
      if (!a || !a.score) return;
      if (!best || a.score > best.score) { a.sheetName = sn; best = a; }
    });
    if (!best) return { ok: false, message: 'Не нашли на листах ни одной строки «название + цена».' };
    var roles = detectRoles(best.aoa, best.priceCols);
    var rows = extractRows(best.aoa, best.nameCol, roles.optCol, roles.retailCol, roles.headerIdx);
    if (!rows.length) return { ok: false, message: 'На листе «' + best.sheetName + '» не нашли строк с ценами.' };
    return {
      ok: true, fileName: filename, sheetName: best.sheetName, aoa: best.aoa, ncols: best.ncols,
      nameCol: best.nameCol, optCol: roles.optCol, retailCol: roles.retailCol, headerIdx: roles.headerIdx,
      rows: rows
    };
  }

  /* ---------- 3. сопоставление строк файла с текущими позициями ---------- */
  function findMetaMatch(text) {
    var hay = lowerE(text);
    var best = null;
    for (var i = 0; i < META.length; i++) {
      if (hay.indexOf(META[i].key) !== -1) {
        if (!best || META[i].key.length > best.key.length) best = META[i];
      }
    }
    return best;
  }
  function guessCategory(text) {
    var t = lowerE(text);
    var hasHk = /х\s*\.?\s*\/?\s*\.?\s*к\b/.test(t) || /холодн\w*\s*копч/.test(t);
    var hasVyal = /вялен/.test(t);
    var hasSS = /с\s*\/\s*с\b/.test(t) || /слабосол/.test(t);
    var hasIkra = /икра/.test(t);
    if (hasIkra) return 'икра';
    if (hasSS) return 'слабосолёная';
    if (hasVyal && hasHk) return 'вяленая и холодного копчения';
    if (hasHk) return 'холодного копчения';
    return 'вяленая';
  }
  function guessNameVariant(text) {
    var raw = String(text || '').trim();
    var commaIdx = raw.indexOf(',');
    if (commaIdx > 0) return { name: raw.slice(0, commaIdx).trim(), variant: raw.slice(commaIdx + 1).trim() || null };
    var m = /\b(средн\w*|крупн\w*|мелк\w*|отборн\w*|филе|тушка|кольцо|ребро|хвост|пласт|целый\w*)\b/i.exec(raw);
    if (m && m.index > 0) return { name: raw.slice(0, m.index).trim(), variant: raw.slice(m.index).trim() || null };
    return { name: raw, variant: null };
  }
  function buildAddedFromRow(row, metaEntry) {
    var category, name, variant, unit, notes;
    if (metaEntry) {
      category = metaEntry.category; name = metaEntry.name; variant = metaEntry.variant;
      unit = metaEntry.unit; notes = metaEntry.notes;
    } else {
      var g = guessNameVariant(row.text);
      category = guessCategory(row.text);
      name = g.name; variant = g.variant;
      unit = (category === 'икра') ? 'банка' : 'кг';
      notes = null;
    }
    var base = RYBADM.slugify(name + (variant ? (' ' + variant) : '')) || RYBADM.slugify(row.text) || 'novaya-pozitsiya';
    return {
      rowText: row.text, category: category, name: name, variant: variant, unit: unit, notes: notes,
      price_retail: row.retail, price_opt: row.opt, __apply: true, __base: base
    };
  }
  /* changed: [{item, oldRetail,newRetail,applyRetail, oldOpt,newOpt,applyOpt, __apply}]
     unchanged: [{item}]
     added: [{id,category,name,variant,unit,notes,price_retail,price_opt,__apply}]
     missingItems: [{item, __apply}]  — позиции таблицы без пары в файле */
  function matchImportRows(rows) {
    var items = RYBADM.state.items;
    var idIndex = {};
    items.forEach(function (it) { if (it.id) idIndex[it.id] = it; });
    var localIds = {};
    items.forEach(function (it) { if (it.id) localIds[it.id] = true; });
    var usedKeys = {};

    var changed = [], unchanged = [], added = [];

    rows.forEach(function (row) {
      var norm = aggressiveNormalize(row.text);
      var found = null;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (usedKeys[it._key]) continue;
        var candA = aggressiveNormalize((it.name || '') + ' ' + (it.variant || ''));
        var candB = aggressiveNormalize(it.name || '');
        if (norm === candA || norm === candB) { found = it; break; }
      }
      var metaEntry = null;
      if (!found) {
        metaEntry = findMetaMatch(row.text);
        if (metaEntry && idIndex[metaEntry.id] && !usedKeys[idIndex[metaEntry.id]._key]) {
          found = idIndex[metaEntry.id];
        }
      }
      if (found) {
        usedKeys[found._key] = true;
        var newRetail = row.retail != null ? row.retail : found.price_retail;
        var newOpt = row.opt != null ? row.opt : found.price_opt;
        var diffRetail = row.retail != null && Number(found.price_retail) !== Number(row.retail);
        var diffOpt = row.opt != null && Number(found.price_opt) !== Number(row.opt);
        if (diffRetail || diffOpt) {
          changed.push({
            item: found, rowText: row.text,
            oldRetail: found.price_retail, newRetail: newRetail, applyRetail: diffRetail,
            oldOpt: found.price_opt, newOpt: newOpt, applyOpt: diffOpt,
            __apply: true
          });
        } else {
          unchanged.push({ item: found });
        }
      } else {
        added.push(buildAddedFromRow(row, metaEntry));
      }
    });

    var missingItems = [];
    items.forEach(function (it) { if (!usedKeys[it._key]) missingItems.push({ item: it, __apply: false }); });

    added.forEach(function (row) {
      var base = row.__base || 'pozitsiya';
      var candidate = RYBADM.uniqueId(base);
      while (localIds[candidate]) candidate = candidate + 'x';
      localIds[candidate] = true;
      row.id = candidate;
    });

    return { changed: changed, unchanged: unchanged, added: added, missingItems: missingItems };
  }

  /* применяет отмеченные строки диффа к RYBADM.state.items как обычные
     правки/добавления/удаления и синхронизирует ядро (§ инструкции агента). */
  function applyMatchResult(mr) {
    var items = RYBADM.state.items;
    var appliedPrices = 0, appliedNew = 0, appliedDeleted = 0;

    mr.changed.forEach(function (row) {
      if (row.__apply === false) return;
      var did = false;
      if (row.applyRetail) { row.item.price_retail = row.newRetail; did = true; }
      if (row.applyOpt) { row.item.price_opt = row.newOpt; did = true; }
      if (did) appliedPrices++;
    });

    mr.added.forEach(function (row) {
      if (row.__apply === false) return;
      items.push({
        _key: 'kimp' + Date.now() + Math.floor(Math.random() * 100000),
        _new: true,
        id: row.id,
        category: row.category,
        name: row.name,
        variant: row.variant || null,
        unit: row.unit || 'кг',
        price_retail: row.price_retail != null ? row.price_retail : null,
        price_opt: row.price_opt != null ? row.price_opt : null,
        in_stock: true,
        notes: row.notes || null
      });
      appliedNew++;
    });

    mr.missingItems.forEach(function (row) {
      if (!row.__apply) return;
      var idx = items.indexOf(row.item);
      if (idx !== -1) { items.splice(idx, 1); appliedDeleted++; }
    });

    if (appliedPrices || appliedNew || appliedDeleted) {
      RYBADM.render();
      RYBADM.scheduleDraftSave();
      RYBADM.updateHeaderButtons();
      RYBADM.emit('items-changed');
    }
    return { appliedPrices: appliedPrices, appliedNew: appliedNew, appliedDeleted: appliedDeleted };
  }

  /* ---------- 4. лист импорта (RYBADM.modal.open, wide) ---------- */
  var importState = null;

  function sampleFor(aoa, colIdx) {
    for (var r = 0; r < aoa.length; r++) {
      var v = aoa[r] && aoa[r][colIdx];
      if (v != null && String(v).trim() !== '') return String(v).trim().slice(0, 26);
    }
    return '—';
  }
  function refreshImportRows() {
    var p = importState.parsed;
    var rows = extractRows(p.aoa, importState.colMap.name, importState.colMap.opt, importState.colMap.retail, p.headerIdx);
    importState.rows = rows;
    importState.matchResult = matchImportRows(rows);
  }
  function renderColsBlock() {
    var block = importState.els.colsBlock;
    block.innerHTML = '';
    var title = document.createElement('p');
    title.className = 'imp-cols__title';
    title.textContent = 'Колонки распознаны: название → ' + colLetter(importState.colMap.name) +
      ', опт → ' + colLetter(importState.colMap.opt) + ', розница → ' + colLetter(importState.colMap.retail) +
      ' (лист «' + importState.parsed.sheetName + '», найдено строк: ' + importState.rows.length + ')';
    block.appendChild(title);

    var selRow = document.createElement('div');
    selRow.className = 'imp-cols__selects';
    [['name', 'Название'], ['opt', 'Опт'], ['retail', 'Розница']].forEach(function (pair) {
      var role = pair[0], label = pair[1];
      var lbl = document.createElement('label');
      lbl.appendChild(document.createTextNode(label));
      var sel = document.createElement('select');
      sel.setAttribute('data-role', role);
      for (var c = 0; c < importState.parsed.ncols; c++) {
        var opt = document.createElement('option');
        opt.value = String(c);
        opt.textContent = colLetter(c) + ' — ' + sampleFor(importState.parsed.aoa, c);
        if (c === importState.colMap[role]) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', function () {
        importState.colMap[role] = parseInt(sel.value, 10);
        refreshImportRows();
        renderColsBlock();
        renderImportTable();
      });
      lbl.appendChild(sel);
      selRow.appendChild(lbl);
    });
    block.appendChild(selRow);
  }
  function fmtMoneyOrDash(v) {
    if (v == null) return '—';
    var s = RYBADM.fmt.money(v);
    return s === '' ? '—' : s;
  }
  function buildChangedRow(row) {
    var tr = document.createElement('tr'); tr.className = 'imp-row imp-row--changed';
    var tdChk = document.createElement('td'); tdChk.className = 'imp-c-chk';
    var chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = row.__apply !== false;
    chk.addEventListener('change', function () { row.__apply = chk.checked; });
    tdChk.appendChild(chk); tr.appendChild(tdChk);

    var tdName = document.createElement('td'); tdName.setAttribute('data-label', 'Позиция');
    tdName.textContent = row.item.name + (row.item.variant ? (' · ' + row.item.variant) : '');
    tr.appendChild(tdName);

    var tdRetail = document.createElement('td'); tdRetail.setAttribute('data-label', 'Розница было → стало'); tdRetail.className = 'mono num';
    appendChangeCell(tdRetail, row.oldRetail, row.newRetail, row.applyRetail);
    tr.appendChild(tdRetail);

    var tdOpt = document.createElement('td'); tdOpt.setAttribute('data-label', 'Опт было → стало'); tdOpt.className = 'mono num';
    appendChangeCell(tdOpt, row.oldOpt, row.newOpt, row.applyOpt);
    tr.appendChild(tdOpt);

    var tdStatus = document.createElement('td'); tdStatus.setAttribute('data-label', 'Статус'); tdStatus.textContent = 'изменено';
    tr.appendChild(tdStatus);
    return tr;
  }
  function appendChangeCell(td, oldV, newV, did) {
    var oldSpan = document.createElement('span'); oldSpan.textContent = fmtMoneyOrDash(oldV);
    td.appendChild(oldSpan);
    if (did) {
      td.appendChild(document.createTextNode(' → '));
      var newSpan = document.createElement('span'); newSpan.className = 'imp-accent'; newSpan.textContent = fmtMoneyOrDash(newV);
      td.appendChild(newSpan);
    }
  }
  function buildAddedRow(row) {
    var tr = document.createElement('tr'); tr.className = 'imp-row imp-row--new';
    var tdChk = document.createElement('td'); tdChk.className = 'imp-c-chk';
    var chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = row.__apply !== false;
    chk.addEventListener('change', function () { row.__apply = chk.checked; });
    tdChk.appendChild(chk); tr.appendChild(tdChk);

    var tdName = document.createElement('td'); tdName.setAttribute('data-label', 'Позиция');
    tdName.appendChild(document.createTextNode(row.name + (row.variant ? (' · ' + row.variant) : '') + ' '));
    var badge = document.createElement('span'); badge.className = 'badge badge--new'; badge.textContent = 'новая';
    tdName.appendChild(badge);
    tr.appendChild(tdName);

    var tdRetail = document.createElement('td'); tdRetail.setAttribute('data-label', 'Розница было → стало'); tdRetail.className = 'mono num';
    appendChangeCell(tdRetail, null, row.price_retail, true);
    tr.appendChild(tdRetail);

    var tdOpt = document.createElement('td'); tdOpt.setAttribute('data-label', 'Опт было → стало'); tdOpt.className = 'mono num';
    appendChangeCell(tdOpt, null, row.price_opt, true);
    tr.appendChild(tdOpt);

    var tdStatus = document.createElement('td'); tdStatus.setAttribute('data-label', 'Статус'); tdStatus.textContent = 'новая';
    tr.appendChild(tdStatus);
    return tr;
  }
  function buildMissingRow(row) {
    var tr = document.createElement('tr'); tr.className = 'imp-row imp-row--missing';
    var tdChk = document.createElement('td'); tdChk.className = 'imp-c-chk';
    var chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!row.__apply;
    chk.title = 'Удалить эту позицию из таблицы';
    chk.addEventListener('change', function () { row.__apply = chk.checked; });
    tdChk.appendChild(chk); tr.appendChild(tdChk);

    var tdName = document.createElement('td'); tdName.setAttribute('data-label', 'Позиция');
    tdName.textContent = row.item.name + (row.item.variant ? (' · ' + row.item.variant) : '');
    tr.appendChild(tdName);

    var tdRetail = document.createElement('td'); tdRetail.setAttribute('data-label', 'Розница было → стало'); tdRetail.className = 'mono num';
    tdRetail.textContent = fmtMoneyOrDash(row.item.price_retail);
    tr.appendChild(tdRetail);

    var tdOpt = document.createElement('td'); tdOpt.setAttribute('data-label', 'Опт было → стало'); tdOpt.className = 'mono num';
    tdOpt.textContent = fmtMoneyOrDash(row.item.price_opt);
    tr.appendChild(tdOpt);

    var tdStatus = document.createElement('td'); tdStatus.setAttribute('data-label', 'Статус'); tdStatus.textContent = 'отсутствует в файле';
    tr.appendChild(tdStatus);
    return tr;
  }
  function renderSummary() {
    var mr = importState.matchResult;
    importState.els.summaryEl.textContent =
      'Изменится цен: ' + mr.changed.length +
      ' · Новых: ' + mr.added.length +
      ' · Отсутствуют в файле: ' + mr.missingItems.length +
      ' · Без изменений: ' + mr.unchanged.length;
  }
  function renderImportTable() {
    var wrapEl = importState.els.tableWrap;
    wrapEl.innerHTML = '';
    var mr = importState.matchResult;
    renderSummary();
    var total = mr.changed.length + mr.added.length + mr.missingItems.length;
    if (!total) {
      var p = document.createElement('p'); p.className = 'empty-state';
      p.textContent = 'Все позиции файла совпадают с текущими ценами — менять нечего.';
      wrapEl.appendChild(p);
      return;
    }
    var table = document.createElement('table'); table.className = 'imp-table';
    var thead = document.createElement('thead'); var htr = document.createElement('tr');
    ['', 'Позиция', 'Розница было → стало', 'Опт было → стало', 'Статус'].forEach(function (t) {
      var th = document.createElement('th'); th.textContent = t; htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    mr.changed.forEach(function (row) { tbody.appendChild(buildChangedRow(row)); });
    mr.added.forEach(function (row) { tbody.appendChild(buildAddedRow(row)); });
    mr.missingItems.forEach(function (row) { tbody.appendChild(buildMissingRow(row)); });
    table.appendChild(tbody);
    wrapEl.appendChild(table);
  }
  function buildImportBody() {
    var wrap = document.createElement('div'); wrap.className = 'imp-flow';

    var colsBlock = document.createElement('div'); colsBlock.className = 'imp-cols';
    wrap.appendChild(colsBlock);

    var delWrap = document.createElement('label'); delWrap.className = 'imp-delcheck';
    var delChk = document.createElement('input'); delChk.type = 'checkbox'; delChk.id = 'imp-del-missing';
    delWrap.appendChild(delChk);
    delWrap.appendChild(document.createTextNode('Удалить отсутствующие в файле позиции'));
    wrap.appendChild(delWrap);

    var summaryEl = document.createElement('p'); summaryEl.className = 'imp-summary';
    wrap.appendChild(summaryEl);

    var tableWrap = document.createElement('div'); tableWrap.className = 'imp-table-wrap';
    wrap.appendChild(tableWrap);

    importState.els = { root: wrap, colsBlock: colsBlock, summaryEl: summaryEl, tableWrap: tableWrap, delChk: delChk };

    delChk.addEventListener('change', function () {
      var checked = delChk.checked;
      importState.matchResult.missingItems.forEach(function (row) { row.__apply = checked; });
      renderImportTable();
    });

    renderColsBlock();
    renderImportTable();
    return wrap;
  }
  function openImportModal(parsed) {
    importState = { parsed: parsed, colMap: { name: parsed.nameCol, opt: parsed.optCol, retail: parsed.retailCol } };
    refreshImportRows();
    var body = buildImportBody();
    RYBADM.modal.open({
      title: 'Импорт прайса из файла',
      wide: true,
      body: body,
      actions: [
        { label: 'Отмена', kind: 'ghost', onClick: function () { RYBADM.modal.close(); importState = null; } },
        { label: 'Применить к таблице', kind: 'solid', onClick: function () {
          if (!importState) return;
          var res = applyMatchResult(importState.matchResult);
          RYBADM.modal.close();
          var parts = [];
          if (res.appliedPrices) parts.push('цен изменено ' + res.appliedPrices);
          if (res.appliedNew) parts.push('добавлено ' + res.appliedNew);
          if (res.appliedDeleted) parts.push('удалено ' + res.appliedDeleted);
          RYBADM.toast({ kind: 'ok', text: parts.length ? ('Импорт применён: ' + parts.join(', ')) : 'Импорт применён: изменений не было', duration: 7000 });
          importState = null;
        } }
      ]
    });
  }
  function runImportFlow(buf, filename) {
    var parsed = parseArrayBuffer(buf, filename);
    if (!parsed.ok) { RYBADM.toast({ kind: 'error', text: parsed.message || 'Не удалось разобрать файл.', duration: 7000 }); return; }
    openImportModal(parsed);
  }

  /* ---------- 5. выбор файла: кнопка «Импорт» + drop-зона ---------- */
  var fileInputEl = null;
  function ensureFileInput() {
    if (fileInputEl) return fileInputEl;
    fileInputEl = document.createElement('input');
    fileInputEl.type = 'file';
    fileInputEl.accept = '.xls,.xlsx';
    fileInputEl.style.display = 'none';
    fileInputEl.addEventListener('change', function () {
      var f = fileInputEl.files && fileInputEl.files[0];
      fileInputEl.value = '';
      if (f) handleFile(f);
    });
    document.body.appendChild(fileInputEl);
    return fileInputEl;
  }
  function handleFile(file) {
    var name = file.name || 'файл';
    if (!/\.(xls|xlsx)$/i.test(name)) { RYBADM.toast({ kind: 'error', text: 'Нужен файл .xls или .xlsx' }); return; }
    if (!xlsxReady()) { RYBADM.toast({ kind: 'error', text: 'Библиотека ещё грузится' }); return; }
    var reader = (typeof file.arrayBuffer === 'function')
      ? file.arrayBuffer()
      : new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsArrayBuffer(file);
      });
    reader.then(function (buf) { runImportFlow(buf, name); })
      .catch(function () { RYBADM.toast({ kind: 'error', text: 'Не удалось прочитать файл.' }); });
  }
  var dropEl = null;
  function ensureDropZone() {
    if (dropEl) return dropEl;
    dropEl = document.createElement('div');
    dropEl.className = 'imp-drop';
    dropEl.hidden = true;
    var plate = document.createElement('div');
    plate.className = 'imp-drop__plate';
    plate.textContent = 'Отпустите файл прайса';
    dropEl.appendChild(plate);
    document.body.appendChild(dropEl);
    return dropEl;
  }
  function hasFiles(e) {
    return !!(e.dataTransfer && e.dataTransfer.types &&
      Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1);
  }
  function wireDropZone() {
    var el = ensureDropZone();
    document.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      el.hidden = false;
    });
    document.addEventListener('dragleave', function (e) {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) el.hidden = true;
    });
    el.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      el.hidden = true;
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    document.addEventListener('drop', function (e) { if (hasFiles(e)) { e.preventDefault(); el.hidden = true; } });
  }

  /* ---------- 6. экспорт ---------- */
  function todayIsoDate() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function todayRuDate() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function buildExportWorkbook() {
    var items = RYBADM.state.items.slice();
    var byCat = {};
    items.forEach(function (it) { (byCat[it.category] = byCat[it.category] || []).push(it); });
    var ordered = [];
    CAT_ORDER.forEach(function (c) {
      var arr = byCat[c];
      if (!arr) return;
      arr.sort(function (a, b) { return (a.name + ' ' + (a.variant || '')).localeCompare(b.name + ' ' + (b.variant || ''), 'ru'); });
      ordered = ordered.concat(arr);
      delete byCat[c];
    });
    Object.keys(byCat).forEach(function (c) { ordered = ordered.concat(byCat[c]); });

    var aoa = [['Раздел', 'Наименование', 'Вариант', 'Ед.', 'Розница', 'Опт', 'Примечание']];
    ordered.forEach(function (it) {
      aoa.push([
        CAT_TITLE[it.category] || it.category,
        it.name || '',
        it.variant || '',
        it.unit || '',
        it.price_retail == null ? '' : Number(it.price_retail),
        it.price_opt == null ? '' : Number(it.price_opt),
        it.notes || ''
      ]);
    });
    var ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 26 }, { wch: 32 }, { wch: 22 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 26 }];
    var wb = window.XLSX.utils.book_new();
    var sheetName = ('Прайс РЫБЦЕХ от ' + todayRuDate()).slice(0, 31);
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return wb;
  }
  function doExportXlsx() {
    if (!xlsxReady()) { RYBADM.toast({ kind: 'error', text: 'Библиотека ещё грузится' }); return; }
    try {
      var wb = buildExportWorkbook();
      var filename = 'prays-rybtseh-' + todayIsoDate() + '.xlsx';
      window.XLSX.writeFile(wb, filename);
    } catch (e) {
      RYBADM.toast({ kind: 'error', text: 'Не удалось собрать файл экспорта.', duration: 6000 });
    }
  }
  function doExportPrint() { window.open('../price.html?print=1'); }

  /* ---------- 7. переоценка ---------- */
  function lowerEq(s) { return lowerE(s); }
  function repriceScopeItems(scope, categoryValue) {
    var items = RYBADM.state.items;
    if (scope === 'cat') return items.filter(function (it) { return it.category === categoryValue; });
    if (scope === 'query') {
      var q = lowerEq(RYBADM.state.query || '');
      if (!q) return [];
      var words = q.split(/\s+/).filter(Boolean);
      return items.filter(function (it) {
        var hay = lowerEq((it.name || '') + ' ' + (it.variant || '') + ' ' + (it.notes || ''));
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      });
    }
    return items.slice();
  }
  function fieldsForWhat(what) {
    if (what === 'retail') return ['price_retail'];
    if (what === 'opt') return ['price_opt'];
    return ['price_retail', 'price_opt'];
  }
  function computeNewPrice(oldV, sign, val, unit, roundOn, step, dir) {
    var v = Number(oldV);
    if (unit === 'pct') v = v * (1 + sign * val / 100);
    else v = v + sign * val;
    v = Math.round(v * 100) / 100;
    if (v < 0) v = 0;
    if (roundOn && step) {
      if (dir === 'up') v = Math.ceil(v / step) * step;
      else if (dir === 'down') v = Math.floor(v / step) * step;
      else v = Math.round(v / step) * step;
    }
    return Math.round(v * 100) / 100;
  }
  function displayName(it) { return (it.name || '') + (it.variant ? (' ' + it.variant) : ''); }
  function repricePreview(opts) {
    var items = repriceScopeItems(opts.scope, opts.categoryValue);
    var fields = fieldsForWhat(opts.what);
    var count = 0, example = null;
    items.forEach(function (it) {
      var changedThis = false;
      fields.forEach(function (f) {
        var oldV = it[f];
        if (oldV == null) return;
        var newV = computeNewPrice(oldV, opts.sign, opts.val, opts.unit, opts.roundOn, opts.roundStep, opts.roundDir);
        if (newV !== Number(oldV)) {
          changedThis = true;
          if (!example) example = { it: it, oldV: oldV, newV: newV };
        }
      });
      if (changedThis) count++;
    });
    var exampleText = example ? (displayName(example.it) + ' ' + fmtMoneyOrDash(example.oldV) + ' → ' + fmtMoneyOrDash(example.newV)) : '';
    return { count: count, exampleText: exampleText };
  }
  function repriceApply(opts) {
    var items = repriceScopeItems(opts.scope, opts.categoryValue);
    var fields = fieldsForWhat(opts.what);
    var count = 0;
    items.forEach(function (it) {
      var changedThis = false;
      fields.forEach(function (f) {
        var oldV = it[f];
        if (oldV == null) return;
        var newV = computeNewPrice(oldV, opts.sign, opts.val, opts.unit, opts.roundOn, opts.roundStep, opts.roundDir);
        if (newV !== Number(oldV)) { it[f] = newV; changedThis = true; }
      });
      if (changedThis) count++;
    });
    if (count) {
      RYBADM.render();
      RYBADM.scheduleDraftSave();
      RYBADM.updateHeaderButtons();
      RYBADM.emit('items-changed');
    }
    return { count: count };
  }
  function readRepriceOpts(els) {
    var what = els.root.querySelector('input[name="imp-what"]:checked').value;
    var scope = els.root.querySelector('input[name="imp-scope"]:checked').value;
    var categoryValue = els.scopeCat.value;
    var sign = els.sign.value === '-' ? -1 : 1;
    var rawVal = els.val.value.replace(',', '.').trim();
    var val = parseFloat(rawVal);
    if (isNaN(val) || val < 0) val = 0;
    var unit = els.unit.value;
    var roundOn = els.roundOn.checked;
    var roundStep = parseInt(els.roundStep.value, 10);
    var roundDir = els.roundDir.value;
    return { what: what, scope: scope, categoryValue: categoryValue, sign: sign, val: val, unit: unit, roundOn: roundOn, roundStep: roundStep, roundDir: roundDir };
  }
  function buildRepriceBody() {
    var wrap = document.createElement('div'); wrap.className = 'imp-reprice';
    var els = { root: wrap };

    /* «Что» */
    var fsWhat = document.createElement('fieldset'); fsWhat.className = 'imp-field';
    var lgWhat = document.createElement('legend'); lgWhat.textContent = 'Что'; fsWhat.appendChild(lgWhat);
    var rowWhat = document.createElement('div'); rowWhat.className = 'imp-field__opts';
    [['retail', 'Розница'], ['opt', 'Опт'], ['both', 'Обе цены']].forEach(function (pair, i) {
      var lbl = document.createElement('label');
      var r = document.createElement('input'); r.type = 'radio'; r.name = 'imp-what'; r.value = pair[0]; if (i === 0) r.checked = true;
      lbl.appendChild(r); lbl.appendChild(document.createTextNode(pair[1]));
      rowWhat.appendChild(lbl);
    });
    fsWhat.appendChild(rowWhat); wrap.appendChild(fsWhat);

    /* «Кому» */
    var fsScope = document.createElement('fieldset'); fsScope.className = 'imp-field';
    var lgScope = document.createElement('legend'); lgScope.textContent = 'Кому'; fsScope.appendChild(lgScope);
    var rowScope = document.createElement('div'); rowScope.className = 'imp-field__opts';

    var lblAll = document.createElement('label');
    var rAll = document.createElement('input'); rAll.type = 'radio'; rAll.name = 'imp-scope'; rAll.value = 'all'; rAll.checked = true;
    lblAll.appendChild(rAll); lblAll.appendChild(document.createTextNode('Все позиции'));
    rowScope.appendChild(lblAll);

    var lblCat = document.createElement('label');
    var rCat = document.createElement('input'); rCat.type = 'radio'; rCat.name = 'imp-scope'; rCat.value = 'cat';
    var selCat = document.createElement('select');
    CAT_ORDER.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = CAT_TITLE[c]; selCat.appendChild(o);
    });
    selCat.addEventListener('change', function () { rCat.checked = true; updatePreview(); });
    lblCat.appendChild(rCat); lblCat.appendChild(document.createTextNode('Раздел')); lblCat.appendChild(selCat);
    rowScope.appendChild(lblCat);
    els.scopeCat = selCat;

    var q = RYBADM.state.query || '';
    var lblQuery = document.createElement('label');
    var rQuery = document.createElement('input'); rQuery.type = 'radio'; rQuery.name = 'imp-scope'; rQuery.value = 'query';
    if (!q) rQuery.disabled = true;
    var qCount = q ? repriceScopeItems('query', null).length : 0;
    lblQuery.appendChild(rQuery);
    lblQuery.appendChild(document.createTextNode(q ? ('Найденные поиском («' + q + '», ' + qCount + ' ' + plural(qCount, 'позиция', 'позиции', 'позиций') + ')') : 'Найденные поиском (сейчас поиск пуст)'));
    rowScope.appendChild(lblQuery);

    fsScope.appendChild(rowScope); wrap.appendChild(fsScope);

    /* «Как» */
    var fsHow = document.createElement('fieldset'); fsHow.className = 'imp-field';
    var lgHow = document.createElement('legend'); lgHow.textContent = 'Как'; fsHow.appendChild(lgHow);
    var rowHow = document.createElement('div'); rowHow.className = 'imp-how-row';
    var selSign = document.createElement('select');
    ['+', '-'].forEach(function (s) { var o = document.createElement('option'); o.value = s; o.textContent = s === '+' ? '+' : '−'; selSign.appendChild(o); });
    var inpVal = document.createElement('input'); inpVal.type = 'text'; inpVal.setAttribute('inputmode', 'decimal'); inpVal.value = '10';
    var selUnit = document.createElement('select');
    [['pct', '%'], ['rub', '₽']].forEach(function (p) { var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; selUnit.appendChild(o); });
    rowHow.appendChild(selSign); rowHow.appendChild(inpVal); rowHow.appendChild(selUnit);
    fsHow.appendChild(rowHow);
    els.sign = selSign; els.val = inpVal; els.unit = selUnit;

    var roundRow = document.createElement('label'); roundRow.className = 'imp-round-toggle';
    var roundChk = document.createElement('input'); roundChk.type = 'checkbox'; roundChk.id = 'imp-round-on';
    roundRow.appendChild(roundChk);
    roundRow.appendChild(document.createTextNode(' округлить до '));
    var selStep = document.createElement('select');
    [['1', '1 ₽'], ['10', '10 ₽'], ['50', '50 ₽']].forEach(function (p) { var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; if (p[0] === '10') o.selected = true; selStep.appendChild(o); });
    roundRow.appendChild(selStep);
    var selDir = document.createElement('select');
    [['round', 'математически'], ['up', 'вверх'], ['down', 'вниз']].forEach(function (p) { var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; selDir.appendChild(o); });
    roundRow.appendChild(selDir);
    fsHow.appendChild(roundRow);
    els.roundOn = roundChk; els.roundStep = selStep; els.roundDir = selDir;
    wrap.appendChild(fsHow);

    /* предпросмотр */
    var preview = document.createElement('p'); preview.className = 'imp-preview'; preview.textContent = 'Изменится 0 позиций.';
    wrap.appendChild(preview);
    els.preview = preview;

    function updatePreview() {
      var opts = readRepriceOpts(els);
      var res = repricePreview(opts);
      if (!res.count) { preview.innerHTML = ''; preview.textContent = 'Изменится 0 позиций.'; return; }
      preview.innerHTML = '';
      preview.appendChild(document.createTextNode('Изменится '));
      var b1 = document.createElement('b'); b1.textContent = String(res.count); preview.appendChild(b1);
      preview.appendChild(document.createTextNode(' ' + plural(res.count, 'позиция', 'позиции', 'позиций') + (res.exampleText ? (', пример: ' + res.exampleText) : '') + '.'));
    }
    wrap.addEventListener('input', updatePreview);
    wrap.addEventListener('change', updatePreview);
    updatePreview();

    els.updatePreview = updatePreview;
    return els;
  }
  function openRepriceSheet() {
    var els = buildRepriceBody();
    RYBADM.modal.open({
      title: 'Переоценка',
      wide: true,
      body: els.root,
      actions: [
        { label: 'Отмена', kind: 'ghost', onClick: function () { RYBADM.modal.close(); } },
        { label: 'Применить', kind: 'solid', onClick: function () {
          var opts = readRepriceOpts(els);
          var res = repriceApply(opts);
          RYBADM.modal.close();
          RYBADM.toast({ kind: 'ok', text: res.count ? ('Переоценка применена: ' + res.count + ' ' + plural(res.count, 'позиция', 'позиции', 'позиций') + ' изменено') : 'Переоценка: изменений не потребовалось', duration: 6000 });
        } }
      ]
    });
  }

  /* ---------- 8. включение кнопок тулбара ---------- */
  function closeExportMenu() {
    var menu = $('#export-menu'), trigger = $('#btn-export');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }
  function wireButtons() {
    var btnImport = $('#btn-import'), btnExport = $('#btn-export'), btnReprice = $('#btn-reprice');
    [btnImport, btnExport, btnReprice].forEach(function (b) {
      if (!b) return;
      b.disabled = false;
      b.removeAttribute('title');
    });
    if (btnImport) btnImport.addEventListener('click', function () {
      if (!xlsxReady()) { RYBADM.toast({ kind: 'error', text: 'Библиотека ещё грузится' }); return; }
      ensureFileInput().click();
    });
    var exportXlsx = $('#export-xlsx'), exportPrint = $('#export-print');
    if (exportXlsx) exportXlsx.addEventListener('click', function () { closeExportMenu(); doExportXlsx(); });
    if (exportPrint) exportPrint.addEventListener('click', function () { closeExportMenu(); doExportPrint(); });
    if (btnReprice) btnReprice.addEventListener('click', openRepriceSheet);
  }

  /* ---------- 9. инициализация ---------- */
  wireButtons();
  wireDropZone();

  /* точки входа для сценариев проверки (cdp-eval) и для самого модуля */
  window.RYBADM.importer = {
    parseArrayBuffer: parseArrayBuffer,
    matchRows: matchImportRows,
    applyMatchResult: applyMatchResult,
    buildExportWorkbook: buildExportWorkbook,
    repricePreview: repricePreview,
    repriceApply: repriceApply,
    normalize: aggressiveNormalize,
    META: META
  };
})();
