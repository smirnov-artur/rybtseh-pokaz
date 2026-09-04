/* ============================================================
   admin-cards.js — вкладка «Карточки» (_СПЕК-V2.md §5).
   Список карточек = каталог (RYBADM.state.catalog.products) + автокарточки
   для позиций прайса, чьё первое слово не нашлось среди карточек (§0.1).
   Каждая правка ложится прямо в RYBADM.state.catalog.products, затем
   RYBADM.scheduleDraftSave('catalog') + RYBADM.updateHeaderButtons() —
   публикует общая кнопка «Опубликовать» в ядре (admin.js), catalog_save
   этот модуль сам не вызывает.
   IIFE, без библиотек, без сборки. UTF-8, LF.
   ============================================================ */
(function () {
  'use strict';

  var RYBADM = window.RYBADM;
  if (!RYBADM) return; /* ядро не загрузилось — модулю делать нечего */

  /* ---------- 0. константы ---------- */
  var FIXED_ORIGINS = ['Цимлянское водохранилище', 'Атлантика', 'Фарерские острова', 'Дальний Восток'];
  var OTHER_ORIGIN = 'Другое';
  var DEFAULT_ORIGIN = FIXED_ORIGINS[0];
  var IDB_NAME = 'rybadm-demo-photos';
  var IDB_STORE = 'photos';
  var CROP_PX = 240;   /* сторона рамки предпросмотра кропа, px */
  var BIG_PX = 1400;
  var SMALL_PX = 640;

  if (RYBADM.state.pendingPhotos == null) RYBADM.state.pendingPhotos = 0;

  /* ---------- 1. состояние модуля ---------- */
  var initialized = false;
  var cardsRoot = null;
  var OPEN_KEYS = {};          /* key → true, раскрытые строки */
  var PENDING_PHOTOS = {};     /* key → {source, width, height, size, cropX, cropY, dragging?} — кроп в процессе */
  var DEMO_PHOTO_URLS = {};    /* key → object URL, кэш фото из IndexedDB (демо) на эту сессию */
  var CARD_SEQ = 0;
  var DRAG = null;             /* {key, canvas, startX, startY, startCropX, startCropY} — активное перетаскивание кропа */

  /* ---------- 2. утилиты ---------- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function idSafe(k) { return String(k).replace(/[^a-zA-Z0-9_-]/g, '-'); }
  function pluralPositions(n) {
    var n10 = n % 10, n100 = n % 100, word;
    if (n10 === 1 && n100 !== 11) word = 'позиция';
    else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) word = 'позиции';
    else word = 'позиций';
    return n + ' ' + word;
  }

  /* привязка позиции прайса к карточке — п. 0.1 _СПЕК-V2.md (10 строк,
     productNameOf/productKeyOf уже есть в assets/catalog-util.js, но в
     админке этот файл не подключён — правило реализовано локально). */
  function productNameOf(item) {
    var s = String((item && item.name) || '').replace(/[«»"']/g, '').trim();
    return (s.split(/\s+/)[0] || '').split('-')[0];
  }
  function normName(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }

  /* ---------- 3. модель: карточки каталога + автокарточки ---------- */
  function buildCardModels() {
    var cat = RYBADM.state.catalog;
    var products = (cat && cat.products) || [];
    var items = RYBADM.state.items || [];
    var byNorm = {};
    products.forEach(function (p) { byNorm[normName(p.name)] = p; });

    var counts = {};       /* product.key → n */
    var autoGroups = {};   /* normName → {name, count} */
    items.forEach(function (it) {
      var raw = productNameOf(it);
      var key = normName(raw);
      if (!key) return;
      var prod = byNorm[key];
      if (prod) counts[prod.key] = (counts[prod.key] || 0) + 1;
      else {
        if (!autoGroups[key]) autoGroups[key] = { name: raw, count: 0 };
        autoGroups[key].count++;
      }
    });

    var real = products.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .map(function (p) { return { kind: 'real', product: p, key: p.key, name: p.name, count: counts[p.key] || 0 }; });
    var auto = Object.keys(autoGroups).sort(function (a, b) { return autoGroups[a].name.localeCompare(autoGroups[b].name, 'ru'); })
      .map(function (k) { return { kind: 'auto', product: null, key: 'auto:' + k, name: autoGroups[k].name, count: autoGroups[k].count }; });
    return real.concat(auto);
  }
  function findModelByKey(key) {
    var models = buildCardModels();
    for (var i = 0; i < models.length; i++) { if (models[i].key === key) return models[i]; }
    return null;
  }
  function maxOrder() {
    var m = 0;
    ((RYBADM.state.catalog && RYBADM.state.catalog.products) || []).forEach(function (p) {
      if (typeof p.order === 'number' && p.order > m) m = p.order;
    });
    return m;
  }
  function makeCardKey(name) {
    var base = RYBADM.slugify(name || 'card');
    base = base.slice(0, 40).replace(/-+$/, '');
    if (!base) base = 'card';
    var used = {};
    (RYBADM.state.catalog.products || []).forEach(function (p) { used[p.key] = true; });
    if (!used[base]) return base;
    var n = 2, candidate;
    do {
      var suffix = '-' + n;
      var trimmed = (base.length + suffix.length > 40) ? base.slice(0, 40 - suffix.length) : base;
      candidate = trimmed + suffix;
      n++;
    } while (used[candidate]);
    return candidate;
  }
  /* автокарточка → настоящая запись в products при первой правке (§5) */
  function ensurePromoted(model) {
    if (model.kind === 'real') return model.product;
    var key = makeCardKey(model.name);
    var prod = {
      key: key, name: model.name, latin: '', origin: DEFAULT_ORIGIN, blurb: '',
      photo: null, order: maxOrder() + 1, hidden: false,
      _new: true, _key: 'ck-new-' + (++CARD_SEQ)
    };
    RYBADM.state.catalog.products.push(prod);
    if (OPEN_KEYS[model.key]) { delete OPEN_KEYS[model.key]; OPEN_KEYS[key] = true; }
    if (PENDING_PHOTOS[model.key]) { PENDING_PHOTOS[key] = PENDING_PHOTOS[model.key]; delete PENDING_PHOTOS[model.key]; }
    model.kind = 'real'; model.product = prod; model.key = key;
    return prod;
  }

  /* ---------- 4. демо-хранилище фото (IndexedDB, rybadm-demo-photos) ---------- */
  function openPhotoDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB недоступен')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbPutPhoto(key, blob) {
    return openPhotoDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(blob, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGetPhoto(key) {
    return openPhotoDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return null; });
  }
  /* src превью: сервер — файл -640.jpg; демо — сначала кэш сессии, потом
     IndexedDB (правится точечно, без полного render(), чтобы не сбить
     фокус, если пользователь в этот момент печатает в другом поле). */
  function resolvePreviewSrc(key, photo) {
    if (!photo) return null;
    if (RYBADM.state.serverMode) return '../' + photo.replace(/\.jpg$/i, '-640.jpg');
    if (DEMO_PHOTO_URLS[key]) return DEMO_PHOTO_URLS[key];
    idbGetPhoto(key).then(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      DEMO_PHOTO_URLS[key] = url;
      if (!cardsRoot) return;
      var img = cardsRoot.querySelector('.card-row[data-key="' + key + '"] img[data-role="preview-img"]');
      if (img) img.src = url;
    });
    return '../' + photo.replace(/\.jpg$/i, '-640.jpg');
  }

  /* ---------- 5. правки: коммит поля / скрыть / порядок ---------- */
  function commitField(model, field, rawValue) {
    var prod = ensurePromoted(model);
    var value = rawValue;
    if (field === 'latin') value = String(rawValue || '').slice(0, 60);
    else if (field === 'blurb') value = String(rawValue || '').slice(0, 160);
    else if (field === 'origin') value = String(rawValue || '').slice(0, 40);
    prod[field] = value;
    RYBADM.scheduleDraftSave('catalog');
    RYBADM.updateHeaderButtons();
    render();
  }
  function commitHiddenToggle(model) {
    var prod = ensurePromoted(model);
    prod.hidden = !prod.hidden;
    RYBADM.scheduleDraftSave('catalog');
    RYBADM.updateHeaderButtons();
    render();
  }
  function moveCard(key, dir) {
    var models = buildCardModels();
    var idx = -1;
    for (var i = 0; i < models.length; i++) { if (models[i].key === key) { idx = i; break; } }
    if (idx === -1) return;
    var swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= models.length) return;
    var a = ensurePromoted(models[idx]);
    var b = ensurePromoted(models[swapIdx]);
    var tmp = a.order; a.order = b.order; b.order = tmp;
    RYBADM.scheduleDraftSave('catalog');
    RYBADM.updateHeaderButtons();
    render();
  }

  /* ---------- 6. фото: приём файла → кроп 1:1 → сохранение ---------- */
  function decodeViaImageEl(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
      img.src = url;
    });
  }
  function decodeImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file)
        .then(function (bmp) { return { source: bmp, width: bmp.width, height: bmp.height }; })
        .catch(function () { return decodeViaImageEl(file); });
    }
    return decodeViaImageEl(file);
  }
  function loadFileForCard(key, file) {
    if (!file) return Promise.reject(new Error('Файл не выбран'));
    return decodeImage(file).then(function (d) {
      var size = Math.min(d.width, d.height);
      PENDING_PHOTOS[key] = {
        source: d.source, width: d.width, height: d.height, size: size,
        cropX: (d.width - size) / 2, cropY: (d.height - size) / 2
      };
      OPEN_KEYS[key] = true;
      render();
    }).catch(function (err) {
      RYBADM.toast({ kind: 'error', text: 'Не удалось прочитать изображение', duration: 5000 });
      throw err;
    });
  }
  function drawCropPreview(canvas, st) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CROP_PX, CROP_PX);
    ctx.drawImage(st.source, st.cropX, st.cropY, st.size, st.size, 0, 0, CROP_PX, CROP_PX);
  }
  function cropToCanvas(st, outSize) {
    var c = document.createElement('canvas'); c.width = outSize; c.height = outSize;
    c.getContext('2d').drawImage(st.source, st.cropX, st.cropY, st.size, st.size, 0, 0, outSize, outSize);
    return c;
  }
  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('Не удалось собрать файл')); }, 'image/jpeg', quality);
    });
  }
  function savePhotoByKey(key) {
    var model = findModelByKey(key);
    if (!model) return;
    var st = PENDING_PHOTOS[model.key];
    if (!st) return;
    var prod = ensurePromoted(model);
    st = PENDING_PHOTOS[prod.key] || st;
    var bigCanvas = cropToCanvas(st, BIG_PX);
    var smallCanvas = cropToCanvas(st, SMALL_PX);
    Promise.all([canvasToBlob(bigCanvas, 0.85), canvasToBlob(smallCanvas, 0.85)]).then(function (blobs) {
      var bigBlob = blobs[0], smallBlob = blobs[1];
      if (RYBADM.state.serverMode) {
        var fd = new FormData();
        fd.append('key', prod.key);
        fd.append('big', bigBlob, prod.key + '.jpg');
        fd.append('small', smallBlob, prod.key + '-640.jpg');
        return fetch('api.php?a=upload', {
          method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Token': RYBADM.state.token || '' }
        }).then(function (res) {
          return res.text().then(function (text) {
            var json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) {}
            if (!res.ok || !json || json.ok === false) {
              throw new Error((json && (json.message || json.error)) || ('Ошибка загрузки (' + res.status + ')'));
            }
            return json;
          });
        }).then(function (json) { prod.photo = json.photo; });
      }
      return idbPutPhoto(prod.key, smallBlob).then(function () {
        DEMO_PHOTO_URLS[prod.key] = URL.createObjectURL(smallBlob);
        prod.photo = 'assets/img/cards/' + prod.key + '.jpg';
      });
    }).then(function () {
      delete PENDING_PHOTOS[prod.key];
      RYBADM.state.pendingPhotos = (RYBADM.state.pendingPhotos || 0) + 1;
      RYBADM.scheduleDraftSave('catalog');
      RYBADM.updateHeaderButtons();
      RYBADM.toast({ kind: 'ok', text: 'Фото сохранено', duration: 4000 });
      render();
    }).catch(function (err) {
      RYBADM.toast({ kind: 'error', text: (err && err.message) || 'Не удалось сохранить фото', duration: 6000 });
    });
  }
  function cancelCropByKey(key) {
    var model = findModelByKey(key);
    if (!model) return;
    delete PENDING_PHOTOS[model.key];
    render();
  }
  function removePhotoByKey(key) {
    var model = findModelByKey(key);
    if (!model) return;
    var prod = ensurePromoted(model);
    prod.photo = null;
    RYBADM.scheduleDraftSave('catalog');
    RYBADM.updateHeaderButtons();
    render();
  }

  /* ---------- 7. рендер ---------- */
  function buildOriginField(model, data) {
    var wrap = document.createElement('div'); wrap.className = 'card-field';
    var label = document.createElement('label');
    var uid = 'cf-origin-' + idSafe(model.key);
    label.setAttribute('for', uid); label.textContent = 'Происхождение';
    var select = document.createElement('select');
    select.id = uid; select.setAttribute('data-field', 'origin'); select.setAttribute('data-key', model.key);
    var known = FIXED_ORIGINS.indexOf(data.origin) !== -1;
    FIXED_ORIGINS.concat([OTHER_ORIGIN]).forEach(function (o) {
      var opt = document.createElement('option'); opt.value = o; opt.textContent = o;
      if ((known && o === data.origin) || (!known && o === OTHER_ORIGIN)) opt.selected = true;
      select.appendChild(opt);
    });
    var custom = document.createElement('input');
    custom.type = 'text'; custom.maxLength = 40; custom.placeholder = 'Своё происхождение';
    custom.setAttribute('data-field', 'origin-custom'); custom.setAttribute('data-key', model.key);
    custom.value = known ? '' : (data.origin || '');
    custom.hidden = known;
    wrap.appendChild(label); wrap.appendChild(select); wrap.appendChild(custom);
    return wrap;
  }
  function buildPhotoZone(model, data) {
    var wrap = document.createElement('div'); wrap.className = 'card-photo';
    var pending = PENDING_PHOTOS[model.key];
    if (pending) {
      var crop = document.createElement('div'); crop.className = 'card-crop';
      var canvas = document.createElement('canvas');
      canvas.className = 'card-crop-canvas'; canvas.width = CROP_PX; canvas.height = CROP_PX;
      canvas.style.width = CROP_PX + 'px'; canvas.style.height = CROP_PX + 'px';
      canvas.setAttribute('data-key', model.key);
      var hint = document.createElement('p'); hint.className = 'card-crop__hint';
      hint.textContent = 'Перетащите кадр внутри рамки, чтобы выбрать нужную часть фото.';
      var actions = document.createElement('div'); actions.className = 'card-crop__actions';
      var btnSave = document.createElement('button'); btnSave.type = 'button'; btnSave.className = 'btn btn--solid';
      btnSave.textContent = 'Сохранить фото'; btnSave.setAttribute('data-action', 'save-photo'); btnSave.setAttribute('data-key', model.key);
      var btnCancel = document.createElement('button'); btnCancel.type = 'button'; btnCancel.className = 'btn btn--ghost';
      btnCancel.textContent = 'Отмена'; btnCancel.setAttribute('data-action', 'cancel-crop'); btnCancel.setAttribute('data-key', model.key);
      actions.appendChild(btnSave); actions.appendChild(btnCancel);
      crop.appendChild(canvas); crop.appendChild(hint); crop.appendChild(actions);
      wrap.appendChild(crop);
      /* рисуем сразу — источник изображения уже декодирован и хранится в PENDING_PHOTOS */
      setTimeout(function () { drawCropPreview(canvas, pending); }, 0);
      return wrap;
    }
    if (data.photo) {
      var cur = document.createElement('div'); cur.className = 'card-photo-current';
      var img = document.createElement('img'); img.alt = ''; img.setAttribute('data-role', 'preview-img');
      img.src = resolvePreviewSrc(model.key, data.photo);
      var btnRemove = document.createElement('button'); btnRemove.type = 'button'; btnRemove.className = 'btn btn--ghost';
      btnRemove.textContent = 'Убрать фото'; btnRemove.setAttribute('data-action', 'remove-photo'); btnRemove.setAttribute('data-key', model.key);
      cur.appendChild(img); cur.appendChild(btnRemove);
      wrap.appendChild(cur);
    }
    var zone = document.createElement('div'); zone.className = 'card-dropzone'; zone.setAttribute('data-key', model.key);
    var p1 = document.createElement('p'); p1.textContent = 'Перетащите фото сюда (JPEG/PNG/WebP)';
    var btnChoose = document.createElement('button'); btnChoose.type = 'button'; btnChoose.className = 'btn btn--ghost';
    btnChoose.textContent = 'Выбрать файл'; btnChoose.setAttribute('data-action', 'choose-file');
    var input = document.createElement('input'); input.type = 'file'; input.hidden = true;
    input.accept = 'image/jpeg,image/png,image/webp'; input.setAttribute('data-key', model.key);
    zone.appendChild(p1); zone.appendChild(btnChoose); zone.appendChild(input);
    wrap.appendChild(zone);
    return wrap;
  }
  function buildPanel(model, idx, total) {
    var panel = document.createElement('div');
    panel.className = 'card-row__panel';
    panel.id = 'card-panel-' + idSafe(model.key);
    var data = model.kind === 'real' ? model.product : { latin: '', origin: DEFAULT_ORIGIN, blurb: '', hidden: false, photo: null };

    var fLatin = document.createElement('div'); fLatin.className = 'card-field';
    var lLatin = document.createElement('label'); var uidL = 'cf-latin-' + idSafe(model.key);
    lLatin.setAttribute('for', uidL); lLatin.textContent = 'Латинское название';
    var iLatin = document.createElement('input'); iLatin.type = 'text'; iLatin.id = uidL; iLatin.maxLength = 60;
    iLatin.value = data.latin || ''; iLatin.placeholder = 'Например, Abramis brama';
    iLatin.setAttribute('data-field', 'latin'); iLatin.setAttribute('data-key', model.key);
    fLatin.appendChild(lLatin); fLatin.appendChild(iLatin);
    panel.appendChild(fLatin);

    panel.appendChild(buildOriginField(model, data));

    var fBlurb = document.createElement('div'); fBlurb.className = 'card-field';
    var lBlurb = document.createElement('label'); var uidB = 'cf-blurb-' + idSafe(model.key);
    lBlurb.setAttribute('for', uidB); lBlurb.textContent = 'Описание';
    var tBlurb = document.createElement('textarea'); tBlurb.id = uidB; tBlurb.maxLength = 160;
    tBlurb.value = data.blurb || ''; tBlurb.setAttribute('data-field', 'blurb'); tBlurb.setAttribute('data-key', model.key);
    var counter = document.createElement('div'); counter.className = 'card-counter'; counter.setAttribute('data-role', 'blurb-counter');
    counter.textContent = (data.blurb || '').length + '/160';
    fBlurb.appendChild(lBlurb); fBlurb.appendChild(tBlurb); fBlurb.appendChild(counter);
    panel.appendChild(fBlurb);

    var fSwitch = document.createElement('div'); fSwitch.className = 'card-field card-field--switch';
    var lSwitch = document.createElement('label'); lSwitch.textContent = 'Скрыть с сайта';
    var btnSwitch = document.createElement('button'); btnSwitch.type = 'button'; btnSwitch.className = 'switch';
    btnSwitch.setAttribute('role', 'switch'); btnSwitch.setAttribute('aria-checked', data.hidden ? 'true' : 'false');
    btnSwitch.setAttribute('data-key', model.key); btnSwitch.setAttribute('aria-label', 'Скрыть с сайта — ' + model.name);
    fSwitch.appendChild(lSwitch); fSwitch.appendChild(btnSwitch);
    panel.appendChild(fSwitch);

    var fOrder = document.createElement('div'); fOrder.className = 'card-field card-order';
    var btnUp = document.createElement('button'); btnUp.type = 'button'; btnUp.className = 'btn btn--ghost';
    btnUp.textContent = '↑'; btnUp.setAttribute('aria-label', 'Выше — ' + model.name);
    btnUp.setAttribute('data-action', 'order-up'); btnUp.setAttribute('data-key', model.key);
    if (idx === 0) btnUp.disabled = true;
    var pos = document.createElement('span'); pos.className = 'card-order__pos'; pos.textContent = (idx + 1) + ' из ' + total;
    var btnDown = document.createElement('button'); btnDown.type = 'button'; btnDown.className = 'btn btn--ghost';
    btnDown.textContent = '↓'; btnDown.setAttribute('aria-label', 'Ниже — ' + model.name);
    btnDown.setAttribute('data-action', 'order-down'); btnDown.setAttribute('data-key', model.key);
    if (idx === total - 1) btnDown.disabled = true;
    fOrder.appendChild(btnUp); fOrder.appendChild(pos); fOrder.appendChild(btnDown);
    panel.appendChild(fOrder);

    panel.appendChild(buildPhotoZone(model, data));
    return panel;
  }
  function buildRow(model, idx, total) {
    var row = document.createElement('div'); row.className = 'card-row'; row.setAttribute('data-key', model.key);
    var isOpen = !!OPEN_KEYS[model.key];
    var photo = model.kind === 'real' ? model.product.photo : null;

    var head = document.createElement('button'); head.type = 'button'; head.className = 'card-row__head';
    head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    head.setAttribute('aria-controls', 'card-panel-' + idSafe(model.key));

    var prev = document.createElement('div'); prev.className = 'card-row__preview';
    if (photo) {
      var img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.setAttribute('data-role', 'preview-img');
      img.src = resolvePreviewSrc(model.key, photo);
      prev.appendChild(img);
    } else {
      var ph = document.createElement('div'); ph.className = 'card-row__preview-text';
      ph.textContent = (model.kind === 'real' ? model.product.latin : '') || model.name;
      prev.appendChild(ph);
    }
    head.appendChild(prev);

    var info = document.createElement('div'); info.className = 'card-row__info';
    var nameEl = document.createElement('div'); nameEl.className = 'card-row__name';
    var nameText = document.createElement('span'); nameText.textContent = model.name;
    nameEl.appendChild(nameText);
    if (model.kind === 'auto') {
      var badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'новая карточка';
      nameEl.appendChild(badge);
    }
    var meta = document.createElement('div'); meta.className = 'card-row__meta';
    meta.textContent = pluralPositions(model.count) + (photo ? '' : ' · без фото');
    info.appendChild(nameEl); info.appendChild(meta);
    head.appendChild(info);

    var chevron = document.createElement('span'); chevron.className = 'card-row__chevron'; chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    head.appendChild(chevron);

    row.appendChild(head);
    var panel = document.createElement('div'); panel.hidden = !isOpen;
    if (isOpen) panel = buildPanel(model, idx, total); else { panel.className = 'card-row__panel'; panel.id = 'card-panel-' + idSafe(model.key); }
    panel.hidden = !isOpen;
    row.appendChild(panel);
    return row;
  }
  function render() {
    if (!initialized || !cardsRoot) return;
    var listEl = document.getElementById('cards-list');
    if (!listEl) return;
    if (!RYBADM.state.catalog) { listEl.innerHTML = '<p class="empty-state">Загрузка…</p>'; return; }
    var models = buildCardModels();
    if (!models.length) { listEl.innerHTML = '<p class="empty-state">Карточек пока нет.</p>'; return; }
    listEl.innerHTML = '';
    var frag = document.createDocumentFragment();
    models.forEach(function (model, idx) { frag.appendChild(buildRow(model, idx, models.length)); });
    listEl.appendChild(frag);
  }

  /* ---------- 8. делегирование событий ---------- */
  function onDragMove(e) {
    if (!DRAG) return;
    var st = PENDING_PHOTOS[DRAG.key];
    if (!st) { onDragEnd(); return; }
    var scale = CROP_PX / st.size;
    var dx = (e.clientX - DRAG.startX) / scale, dy = (e.clientY - DRAG.startY) / scale;
    st.cropX = clamp(DRAG.startCropX - dx, 0, st.width - st.size);
    st.cropY = clamp(DRAG.startCropY - dy, 0, st.height - st.size);
    drawCropPreview(DRAG.canvas, st);
  }
  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    DRAG = null;
  }
  function wireRootEvents() {
    cardsRoot.addEventListener('click', function (e) {
      var upBtn = e.target.closest('[data-action="order-up"]');
      if (upBtn) { moveCard(upBtn.getAttribute('data-key'), -1); return; }
      var downBtn = e.target.closest('[data-action="order-down"]');
      if (downBtn) { moveCard(downBtn.getAttribute('data-key'), 1); return; }
      var chooseBtn = e.target.closest('[data-action="choose-file"]');
      if (chooseBtn) { var zone = chooseBtn.closest('.card-dropzone'); var inp = zone && zone.querySelector('input[type="file"]'); if (inp) inp.click(); return; }
      var saveBtn = e.target.closest('[data-action="save-photo"]');
      if (saveBtn) { savePhotoByKey(saveBtn.getAttribute('data-key')); return; }
      var cancelBtn = e.target.closest('[data-action="cancel-crop"]');
      if (cancelBtn) { cancelCropByKey(cancelBtn.getAttribute('data-key')); return; }
      var removeBtn = e.target.closest('[data-action="remove-photo"]');
      if (removeBtn) { removePhotoByKey(removeBtn.getAttribute('data-key')); return; }
      var sw = e.target.closest('.card-field--switch .switch');
      if (sw) { var model1 = findModelByKey(sw.getAttribute('data-key')); if (model1) commitHiddenToggle(model1); return; }
      var head = e.target.closest('.card-row__head');
      if (head) {
        var key = head.closest('.card-row').getAttribute('data-key');
        if (OPEN_KEYS[key]) delete OPEN_KEYS[key]; else OPEN_KEYS[key] = true;
        render();
      }
    });
    cardsRoot.addEventListener('change', function (e) {
      var fileInput = e.target.closest('input[type="file"][data-key]');
      if (fileInput) {
        var key = fileInput.getAttribute('data-key');
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (file) loadFileForCard(key, file);
        return;
      }
      var select = e.target.closest('select[data-field="origin"]');
      if (select) {
        var key2 = select.getAttribute('data-key');
        var model = findModelByKey(key2);
        if (!model) return;
        if (select.value === OTHER_ORIGIN) {
          var row = select.closest('.card-row');
          var custom = row && row.querySelector('input[data-field="origin-custom"]');
          if (custom) { custom.hidden = false; custom.focus(); }
        } else {
          commitField(model, 'origin', select.value);
        }
      }
    });
    cardsRoot.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('textarea[data-field="blurb"]')) {
        var field = e.target.closest('.card-field');
        var counter = field && field.querySelector('[data-role="blurb-counter"]');
        if (counter) counter.textContent = e.target.value.length + '/160';
      }
    });
    cardsRoot.addEventListener('focusout', function (e) {
      var el = e.target;
      if (!el.matches) return;
      if (el.matches('input[data-field="latin"], textarea[data-field="blurb"]')) {
        var model = findModelByKey(el.getAttribute('data-key'));
        if (model) commitField(model, el.getAttribute('data-field'), el.value.trim());
      } else if (el.matches('input[data-field="origin-custom"]')) {
        var model2 = findModelByKey(el.getAttribute('data-key'));
        if (model2) commitField(model2, 'origin', el.value.trim());
      }
    });
    ['dragover', 'dragenter', 'dragleave', 'drop'].forEach(function (type) {
      cardsRoot.addEventListener(type, function (e) {
        var zone = e.target.closest('.card-dropzone');
        if (!zone) return;
        if (type === 'dragover' || type === 'dragenter') { e.preventDefault(); zone.classList.add('is-drag'); }
        else if (type === 'dragleave') { zone.classList.remove('is-drag'); }
        else if (type === 'drop') {
          e.preventDefault(); zone.classList.remove('is-drag');
          var key = zone.getAttribute('data-key');
          var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) loadFileForCard(key, file);
        }
      });
    });
    cardsRoot.addEventListener('pointerdown', function (e) {
      var canvas = e.target.closest('canvas.card-crop-canvas');
      if (!canvas) return;
      var key = canvas.getAttribute('data-key');
      var st = PENDING_PHOTOS[key];
      if (!st) return;
      e.preventDefault();
      DRAG = { key: key, canvas: canvas, startX: e.clientX, startY: e.clientY, startCropX: st.cropX, startCropY: st.cropY };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      window.addEventListener('pointercancel', onDragEnd);
    });
  }

  /* ---------- 9. инициализация / события ядра ---------- */
  function ensureInit() {
    if (initialized) return;
    cardsRoot = document.getElementById('cards-root');
    if (!cardsRoot) return;
    cardsRoot.innerHTML = '<div class="cards-list" id="cards-list"></div>';
    wireRootEvents();
    initialized = true;
  }
  RYBADM.on('tab', function (name) { if (name === 'cards') { ensureInit(); render(); } });
  RYBADM.on('data-loaded', function () { if (initialized) render(); });
  RYBADM.on('items-changed', function () { if (initialized) render(); });
  RYBADM.on('published', function () { RYBADM.state.pendingPhotos = 0; if (initialized) render(); });

  /* ---------- 10. публичный хук для проверки (живой Chrome) ----------
     RYBADM.cards.acceptFile(fileOrBlob, key) — тот же путь, что drag&drop/
     «Выбрать файл»: декодирует изображение, готовит кроп 1:1 для карточки
     `key`, раскрывает её строку. Дальше — обычная кнопка «Сохранить фото». */
  RYBADM.cards = {
    acceptFile: function (fileOrBlob, key) { return loadFileForCard(key, fileOrBlob); }
  };
})();
