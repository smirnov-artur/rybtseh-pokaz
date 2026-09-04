/* ============================================================
   admin-extra.js — модуль «экстра» (_СПЕК-V2.md §6).
   Три вещи поверх ядра (admin.js), без библиотек:
   1. Предпросмотр прайса+карточек в iframe price.html?preview=1
      (панель справа ≥1280px, иначе полноэкранный лист).
   2. Вкладка «История»: у каждой строки — кнопка «Что изменилось»,
      раскрытие сравнивает документ бэкапа с текущим опубликованным.
   3. «Сменить пароль» (лист) и строка «Вы вошли как …» в меню «⋯»/«Ещё ▾».
   Все точки входа — через window.RYBADM (см. _СПЕК-V2.md §3): своих
   глобалов не заводим, DOM-узлы, которых нет в index.html (панель
   предпросмотра, разворачивание истории, форма пароля), строим сами.
   ============================================================ */
(function () {
  'use strict';
  if (!window.RYBADM) return;   // ядро обязано загрузиться раньше (admin.js — не defer)
  var RYBADM = window.RYBADM;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }
  function todayIso() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function moneyOrDash(v) {
    var s = RYBADM.fmt.money(v);
    return s === '' ? '—' : s;
  }
  function itemLabel(it) {
    return (it.name || '') + (it.variant ? ' ' + it.variant : '');
  }

  /* ---------- закрыть меню «⋯»/«Ещё ▾», не трогая чужой export-меню ----------
     RYBADM не отдаёт closeAllDropdowns() модулям — закрываем только то меню,
     внутри которого лежит нажатая кнопка (обработчик open() дропдауна сам
     подчистит свой document-листенер при следующем клике где угодно). */
  var MENU_TRIGGER_OF = { 'hdr-menu': 'hdr-more', 'hdr-menu-text': 'hdr-more-text' };
  function closeMenuContaining(btn) {
    var menu = btn.closest('.menu-pop');
    if (!menu) return;
    menu.hidden = true;
    var triggerId = MENU_TRIGGER_OF[menu.id];
    if (triggerId) {
      var trigger = document.getElementById(triggerId);
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }
  function enableMenuItem(id, handler) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = false;
    btn.removeAttribute('title');
    btn.addEventListener('click', function (e) {
      closeMenuContaining(btn);
      handler(e);
    });
  }

  /* ================================================================
     1. «Вы вошли как …» — строка в обоих меню. Ядро логин не хранит
     (сервер login/setup его не возвращает) — берём из #f-login.value
     в момент 'data-loaded': к этому моменту форма входа либо только
     что была заполнена (вход/первый вход), либо (сессия сохранилась
     между перезагрузками страницы) поле так и осталось пустым — тогда
     показываем нейтральный текст, честно не выдумывая логин.
     ================================================================ */
  var currentLogin = null;
  function captureLoginFromForm() {
    var input = document.getElementById('f-login');
    if (input && input.value && input.value.trim()) currentLogin = input.value.trim();
  }
  function updateLoginInfoLines() {
    var text = currentLogin ? ('Вы вошли как ' + currentLogin) : 'Вы вошли в систему';
    ['hdr-menu', 'hdr-menu-text'].forEach(function (id) {
      var menu = document.getElementById(id);
      if (!menu) return;
      var info = menu.querySelector('.rybx-menu-info');
      if (!info) {
        info = document.createElement('div');
        info.className = 'rybx-menu-info';
        menu.insertBefore(info, menu.firstChild);
      }
      info.textContent = text;
    });
  }

  /* ================================================================
     2. ПРЕДПРОСМОТР (_СПЕК-V2.md §6, §2.6). Панель — не модалка ядра
     (RYBADM.modal — одна на весь экран, а тут нужен либо сайдбар, либо
     полноэкранный лист с независимой прокруткой таблицы позади), поэтому
     строим свой узел #preview-pane и вставляем в <body>. Брейкпоинт 1280
     задан в admin-extra.css — здесь только логика: что показывать и когда
     слать postMessage.
     ================================================================ */
  var IS_FILE_PROTOCOL = (location.protocol === 'file:');
  var previewPanel = null, previewIframe = null, previewLoaded = false;
  var catalogPollTimer = null, lastCatalogSnapshot = null;

  function cleanItemForPreview(it) {
    return {
      id: it.id, category: it.category, name: it.name, variant: it.variant,
      unit: it.unit, price_retail: it.price_retail, price_opt: it.price_opt,
      in_stock: !!it.in_stock, notes: it.notes
    };
  }
  function cleanCatalogProductForPreview(p) {
    return { key: p.key, name: p.name, latin: p.latin, origin: p.origin, blurb: p.blurb, photo: p.photo, order: p.order, hidden: !!p.hidden };
  }
  /* документ — как collectит publish ядра (doPublish/demoSave): updated —
     сегодняшним числом (предпросмотр отвечает на вопрос «как будет выглядеть
     сайт, если опубликовать прямо сейчас»), остальная метаинформация — из
     текущего baseline (валюта/оговорки админка не редактирует). */
  function buildPreviewPricesDoc() {
    var st = RYBADM.state;
    var base = st.baseline || {};
    var items = (st.items || []).map(cleanItemForPreview);
    return {
      updated: todayIso(), source: base.source, currency: base.currency,
      vat_note: base.vat_note, opt_terms: base.opt_terms,
      positions: items.length, items: items
    };
  }
  function buildPreviewCatalogDoc() {
    var st = RYBADM.state;
    var cat = st.catalog || { updated: null, products: [] };
    return { updated: todayIso(), products: (cat.products || []).map(cleanCatalogProductForPreview) };
  }
  function catalogSnapshot() {
    try { return JSON.stringify((RYBADM.state.catalog && RYBADM.state.catalog.products || []).map(cleanCatalogProductForPreview)); }
    catch (e) { return ''; }
  }

  function ensurePreviewPanel() {
    if (previewPanel) return previewPanel;
    var panel = document.createElement('div');
    panel.id = 'preview-pane';
    panel.hidden = true;

    var bar = document.createElement('div'); bar.className = 'rybx-preview__bar';
    var title = document.createElement('span'); title.className = 'rybx-preview__title'; title.textContent = 'Предпросмотр прайса';
    var actions = document.createElement('div'); actions.className = 'rybx-preview__actions';

    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button'; refreshBtn.id = 'rybx-preview-refresh';
    refreshBtn.className = 'btn btn--ghost'; refreshBtn.textContent = 'Обновить';
    refreshBtn.addEventListener('click', refreshPreviewFrame);

    var openLink = document.createElement('a');
    openLink.id = 'rybx-preview-open';
    openLink.className = 'btn btn--ghost'; openLink.textContent = 'Открыть в новой вкладке';
    openLink.href = '../price.html'; openLink.target = '_blank'; openLink.rel = 'noopener';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.id = 'rybx-preview-close';
    closeBtn.className = 'btn btn--text'; closeBtn.textContent = 'Закрыть';
    closeBtn.addEventListener('click', closePreview);

    actions.appendChild(refreshBtn); actions.appendChild(openLink); actions.appendChild(closeBtn);
    bar.appendChild(title); bar.appendChild(actions);

    var body = document.createElement('div'); body.className = 'rybx-preview__body';
    var iframe = document.createElement('iframe');
    iframe.id = 'rybx-preview-frame';
    iframe.title = 'Предпросмотр прайса';
    iframe.addEventListener('load', function () {
      if (!iframe.getAttribute('data-nav')) return;   // первый load — про about:blank рамки, пропускаем
      previewLoaded = true;
      sendPreviewUpdate();
    });
    var filenote = document.createElement('p');
    filenote.className = 'rybx-preview__filenote'; filenote.hidden = true;
    filenote.textContent = 'Предпросмотр доступен по http. Страница открыта как file:// — браузер не пропускает обмен ' +
      'данными между окном админки и iframe. Откройте админку через локальный сервер (http://…), чтобы увидеть предпросмотр здесь, ' +
      'либо жмите «Открыть в новой вкладке» — там будет опубликованная версия.';
    body.appendChild(iframe); body.appendChild(filenote);

    panel.appendChild(bar); panel.appendChild(body);
    document.body.appendChild(panel);

    previewPanel = panel; previewIframe = iframe;
    if (IS_FILE_PROTOCOL) {
      iframe.hidden = true; filenote.hidden = false;
      refreshBtn.disabled = true;
    }
    return panel;
  }
  function ensureIframeNavigated() {
    if (!previewIframe || IS_FILE_PROTOCOL) return;
    if (previewIframe.getAttribute('data-nav')) return;
    previewIframe.setAttribute('data-nav', '1');
    previewIframe.src = '../price.html?preview=1';
  }
  function refreshPreviewFrame() {
    if (!previewIframe || IS_FILE_PROTOCOL) return;
    previewLoaded = false;
    previewIframe.setAttribute('data-nav', '1');
    previewIframe.src = '../price.html?preview=1&_r=' + Date.now();
  }
  function sendPreviewUpdate() {
    if (!previewPanel || previewPanel.hidden || IS_FILE_PROTOCOL) return;
    if (!previewLoaded || !previewIframe || !previewIframe.contentWindow) return;
    try {
      previewIframe.contentWindow.postMessage(
        { type: 'rybadm-preview', prices: buildPreviewPricesDoc(), catalog: buildPreviewCatalogDoc() },
        location.origin
      );
    } catch (e) { /* iframe с чужого источника/файла — молча пропускаем */ }
  }
  var sendPreviewUpdateDebounced = debounce(sendPreviewUpdate, 300);

  function startCatalogPoll() {
    stopCatalogPoll();
    lastCatalogSnapshot = catalogSnapshot();
    catalogPollTimer = setInterval(function () {
      var snap = catalogSnapshot();
      if (snap !== lastCatalogSnapshot) { lastCatalogSnapshot = snap; sendPreviewUpdate(); }
    }, 1000);
  }
  function stopCatalogPoll() {
    if (catalogPollTimer) { clearInterval(catalogPollTimer); catalogPollTimer = null; }
  }

  function openPreview() {
    var panel = ensurePreviewPanel();
    panel.hidden = false;
    document.body.classList.add('has-preview');
    if (!IS_FILE_PROTOCOL) {
      ensureIframeNavigated();
      if (previewLoaded) sendPreviewUpdate();
      startCatalogPoll();
      var closeBtn = $('.rybx-preview__actions .btn--text', panel);
      if (closeBtn) closeBtn.focus();
    }
  }
  function closePreview() {
    if (previewPanel) previewPanel.hidden = true;
    document.body.classList.remove('has-preview');
    stopCatalogPoll();
  }
  function togglePreview() {
    if (previewPanel && !previewPanel.hidden) closePreview(); else openPreview();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && previewPanel && !previewPanel.hidden) closePreview();
  });

  /* ================================================================
     3. ИСТОРИЯ — «Что изменилось» (_СПЕК-V2.md §6). Ядро перерисовывает
     #history-list в своей renderHistory() (внутренние вызовы admin.js —
     напрямую по замыканию, не через RYBADM.renderHistory — поэтому
     подписываемся на события, после которых admin.js реально дёргает
     renderHistory(): 'data-loaded' — старт/публикация/восстановление.
     Плюс оборачиваем RYBADM.renderHistory на случай явного вызова через
     публичный API (см. задание — «допустимо»). decorateHistory()
     идемпотентна: список каждый раз пересобирается ядром заново, поэтому
     просто достраивает кнопки по текущим #history-list/state.backups. ---- */
  var backupDocCache = {};   // name -> Promise<doc>
  var diffSeq = 0;

  function loadBackupDoc(backup) {
    var name = backup.name;
    if (backupDocCache[name]) return backupDocCache[name];
    var task;
    if (RYBADM.state.serverMode) {
      task = RYBADM.api('backup', { name: name }, { needsToken: false }).then(function (res) { return res.data; });
    } else {
      task = new Promise(function (resolve, reject) {
        var store = RYBADM.demo.store();
        var found = null;
        (store.backups || []).forEach(function (b) { if (b.name === name) found = b; });
        if (found && found.data) resolve(found.data);
        else reject({ message: 'Резервная копия не найдена в этом браузере.' });
      });
    }
    backupDocCache[name] = task;
    task['catch'](function () { delete backupDocCache[name]; });
    return task;
  }

  function numEq(a, b) {
    a = (a == null) ? null : Number(a);
    b = (b == null) ? null : Number(b);
    return a === b;
  }
  function formatPriceChangeLine(backupIt, currentIt) {
    var retailDiffers = !numEq(backupIt.price_retail, currentIt.price_retail);
    var optDiffers = !numEq(backupIt.price_opt, currentIt.price_opt);
    var main = retailDiffers
      ? (moneyOrDash(backupIt.price_retail) + ' → ' + moneyOrDash(currentIt.price_retail) + ' ₽')
      : ('опт ' + moneyOrDash(backupIt.price_opt) + ' → ' + moneyOrDash(currentIt.price_opt) + ' ₽');
    var suffix = (retailDiffers && optDiffers)
      ? (' (опт ' + moneyOrDash(backupIt.price_opt) + ' → ' + moneyOrDash(currentIt.price_opt) + ' ₽)')
      : '';
    return itemLabel(currentIt) + ': ' + main + suffix;
  }

  function renderPriceDiff(panel, backupDoc) {
    var currentItems = (RYBADM.state.baseline && RYBADM.state.baseline.items) || [];
    var backupItems = (backupDoc && backupDoc.items) || [];
    var curMap = {}, backMap = {};
    currentItems.forEach(function (it) { curMap[it.id] = it; });
    backupItems.forEach(function (it) { backMap[it.id] = it; });

    var changedPrice = [], added = [], deleted = [];
    backupItems.forEach(function (bIt) {
      var cur = curMap[bIt.id];
      if (!cur) { deleted.push(bIt); return; }
      if (!numEq(bIt.price_retail, cur.price_retail) || !numEq(bIt.price_opt, cur.price_opt)) {
        changedPrice.push({ b: bIt, c: cur });
      }
    });
    currentItems.forEach(function (cIt) { if (!backMap[cIt.id]) added.push(cIt); });

    var summary = document.createElement('p'); summary.className = 'rybx-diff-summary';
    summary.textContent = 'Изменено цен ' + changedPrice.length + ' · Новых ' + added.length + ' · Удалено ' + deleted.length;
    panel.appendChild(summary);

    var lines = [];
    changedPrice.forEach(function (pair) { lines.push(formatPriceChangeLine(pair.b, pair.c)); });
    added.forEach(function (it) { lines.push(itemLabel(it) + ' — новая позиция'); });
    deleted.forEach(function (it) { lines.push(itemLabel(it) + ' — удалена из прайса'); });
    appendDiffList(panel, lines);
  }

  var CATALOG_DIFF_FIELDS = ['name', 'latin', 'origin', 'blurb', 'photo', 'order', 'hidden'];
  var CATALOG_FIELD_LABEL = { name: 'название', latin: 'латинское название', origin: 'происхождение', blurb: 'описание', photo: 'фото', order: 'порядок', hidden: 'скрытие' };
  function catalogFieldDiffers(f, bv, cv) {
    if (f === 'hidden') return !!bv !== !!cv;
    if (f === 'order') return Number(bv || 0) !== Number(cv || 0);
    return String(bv == null ? '' : bv).trim() !== String(cv == null ? '' : cv).trim();
  }
  function renderCatalogDiff(panel, backupDoc) {
    var baseline = RYBADM.state.catalogBaseline || { products: [] };
    var currentProducts = baseline.products || [];
    var backupProducts = (backupDoc && backupDoc.products) || [];
    var curMap = {}, backMap = {};
    currentProducts.forEach(function (p) { curMap[p.key] = p; });
    backupProducts.forEach(function (p) { backMap[p.key] = p; });

    var changed = [], added = [], deleted = [];
    backupProducts.forEach(function (bp) {
      var cur = curMap[bp.key];
      if (!cur) { deleted.push(bp); return; }
      var fields = CATALOG_DIFF_FIELDS.filter(function (f) { return catalogFieldDiffers(f, bp[f], cur[f]); });
      if (fields.length) changed.push({ b: bp, c: cur, fields: fields });
    });
    currentProducts.forEach(function (cp) { if (!backMap[cp.key]) added.push(cp); });

    var total = changed.length + added.length + deleted.length;
    var summary = document.createElement('p'); summary.className = 'rybx-diff-summary';
    summary.textContent = 'Карточек изменено ' + total;
    panel.appendChild(summary);

    var lines = [];
    changed.forEach(function (pair) {
      var labels = pair.fields.map(function (f) { return CATALOG_FIELD_LABEL[f] || f; }).join(', ');
      lines.push((pair.c.name || pair.b.name || pair.b.key) + ' — ' + labels);
    });
    added.forEach(function (p) { lines.push((p.name || p.key) + ' — новая карточка'); });
    deleted.forEach(function (p) { lines.push((p.name || p.key) + ' — карточка удалена'); });
    appendDiffList(panel, lines);
  }
  function appendDiffList(panel, lines) {
    if (!lines.length) {
      var eq = document.createElement('p'); eq.className = 'rybx-diff-empty'; eq.textContent = 'Совпадает с текущим.';
      panel.appendChild(eq);
      return;
    }
    var shown = lines.slice(0, 20);
    var ul = document.createElement('ul'); ul.className = 'rybx-diff-list';
    shown.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    panel.appendChild(ul);
    if (lines.length > shown.length) {
      var more = document.createElement('p'); more.className = 'rybx-diff-more';
      more.textContent = 'И ещё ' + (lines.length - shown.length) + '.';
      panel.appendChild(more);
    }
  }

  function toggleDiff(row, backup, btn) {
    var next = row.nextElementSibling;
    if (next && next.classList.contains('rybx-diff-panel')) {
      var willShow = next.hidden;
      next.hidden = !willShow;
      btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
      return;
    }
    var panel = document.createElement('li');
    panel.className = 'rybx-diff-panel';
    panel.id = 'rybx-diff-panel-' + (++diffSeq);
    panel.setAttribute('aria-live', 'polite');
    panel.textContent = 'Загрузка…';
    row.insertAdjacentElement('afterend', panel);
    btn.setAttribute('aria-controls', panel.id);
    btn.setAttribute('aria-expanded', 'true');
    loadBackupDoc(backup).then(function (doc) {
      panel.textContent = '';
      if (/^catalog-/.test(backup.name)) renderCatalogDiff(panel, doc);
      else renderPriceDiff(panel, doc);
    })['catch'](function (err) {
      panel.textContent = 'Не удалось загрузить: ' + ((err && err.message) || 'ошибка сети.');
    });
  }

  function decorateHistory() {
    var list = document.getElementById('history-list');
    if (!list) return;
    var backups = RYBADM.state.backups || [];
    var rows = $all('#history-list > li.history__row');
    rows.forEach(function (row, i) {
      if (row.querySelector('.rybx-diff-btn')) return;   // уже достроена (не должно случаться — ядро пересоздаёт список)
      var backup = backups[i];
      if (!backup) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'link-btn rybx-diff-btn'; btn.textContent = 'Что изменилось';
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () { toggleDiff(row, backup, btn); });
      row.appendChild(btn);
    });
  }

  var origRenderHistory = RYBADM.renderHistory;
  if (typeof origRenderHistory === 'function') {
    RYBADM.renderHistory = function () {
      var r = origRenderHistory.apply(RYBADM, arguments);
      decorateHistory();
      return r;
    };
  }

  /* ================================================================
     4. СМЕНА ПАРОЛЯ (_СПЕК-V2.md §6). Лист через RYBADM.modal.open —
     он сам закрывает меню «⋯»/«Ещё ▾», ловит фокус и Esc.
     ================================================================ */
  function openPasswordFlow() {
    if (!RYBADM.state.serverMode) {
      RYBADM.toast({ kind: 'ok', text: 'В демо-режиме пароль не меняется', duration: 5000 });
      return;
    }
    var wrap = document.createElement('div'); wrap.className = 'rybx-pass-form';

    function passField(labelText, id, autocomplete) {
      var f = document.createElement('div'); f.className = 'field';
      var label = document.createElement('label'); label.setAttribute('for', id); label.textContent = labelText;
      var pw = document.createElement('div'); pw.className = 'field__pass-wrap';
      var input = document.createElement('input');
      input.type = 'password'; input.id = id; input.name = id;
      input.autocomplete = autocomplete; input.required = true;
      var toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'pass-toggle'; toggle.textContent = 'Показать';
      toggle.setAttribute('aria-pressed', 'false');
      toggle.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Скрыть' : 'Показать';
        toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      });
      pw.appendChild(input); pw.appendChild(toggle);
      f.appendChild(label); f.appendChild(pw);
      wrap.appendChild(f);
      return input;
    }
    var inpCurrent = passField('Текущий пароль', 'rybx-pass-current', 'current-password');
    var inpNew = passField('Новый пароль', 'rybx-pass-new', 'new-password');
    var inpConfirm = passField('Повторите новый пароль', 'rybx-pass-confirm', 'new-password');

    var errEl = document.createElement('p');
    errEl.className = 'rybx-pass-error'; errEl.hidden = true; errEl.setAttribute('role', 'alert');
    wrap.appendChild(errEl);
    function showErr(msg) { errEl.textContent = msg; errEl.hidden = false; }
    function clearErr() { errEl.hidden = true; errEl.textContent = ''; }

    var cancelBtn, saveBtn;
    function setPending(on) {
      if (cancelBtn) cancelBtn.disabled = on;
      if (saveBtn) { saveBtn.disabled = on; saveBtn.textContent = on ? 'Сохраняем…' : 'Сохранить'; }
    }
    function submit() {
      clearErr();
      var current = inpCurrent.value;
      var pass1 = inpNew.value;
      var pass2 = inpConfirm.value;
      if (!current) { showErr('Введите текущий пароль.'); inpCurrent.focus(); return; }
      if (pass1.length < 8) { showErr('Новый пароль должен быть не короче 8 символов.'); inpNew.focus(); return; }
      if (pass1 !== pass2) { showErr('Пароли не совпадают.'); inpConfirm.focus(); inpConfirm.select(); return; }
      setPending(true);
      RYBADM.api('password', { current: current, password: pass1 }, { needsToken: true }).then(function () {
        RYBADM.modal.close();
        RYBADM.toast({ kind: 'ok', text: 'Пароль изменён', duration: 5000 });
      })['catch'](function (err) {
        setPending(false);
        if (err && err.status === 401) { showErr('Текущий пароль неверный.'); inpCurrent.focus(); inpCurrent.select(); }
        else if (err && err.code === 'locked') { showErr((err && err.message) || 'Слишком много попыток, подождите 10 минут.'); }
        else { showErr((err && err.message) || 'Не удалось сменить пароль.'); }
      });
    }
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); }
    });

    RYBADM.modal.open({
      title: 'Сменить пароль',
      body: wrap,
      actions: [
        { label: 'Отмена', kind: 'ghost', onClick: function () { RYBADM.modal.close(); } },
        { label: 'Сохранить', kind: 'solid', onClick: submit }
      ]
    });
    var buttons = $all('#sheet-actions .btn');
    cancelBtn = buttons[0]; saveBtn = buttons[1];
  }

  /* ================================================================
     5. запуск: включить пункты меню, подписаться на события ядра.
     ================================================================ */
  enableMenuItem('more-preview', togglePreview);
  enableMenuItem('menu-preview', togglePreview);
  enableMenuItem('more-password', openPasswordFlow);
  enableMenuItem('menu-password', openPasswordFlow);

  RYBADM.on('data-loaded', function () {
    captureLoginFromForm();
    updateLoginInfoLines();
    decorateHistory();
    if (previewPanel && !previewPanel.hidden) sendPreviewUpdate();
  });
  RYBADM.on('items-changed', sendPreviewUpdateDebounced);
  RYBADM.on('tab', function (name) { if (name === 'history') decorateHistory(); });

  updateLoginInfoLines();
  decorateHistory();
})();
