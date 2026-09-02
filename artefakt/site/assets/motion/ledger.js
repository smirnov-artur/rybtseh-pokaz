/* assets/motion/ledger.js — «Прайс как инвентарная книга» (волна 3, «Артефакт»,
   ЗАМЫСЕЛ-ПЛАН §3 «Прайс как инвентарная книга»).
   Ничего в price.html / order.js / order.css не переписывает: рендер прайса
   (инлайн-скрипт price.html) оборачивается через геттер/сеттер #tbody.innerHTML,
   заявка (order.js) — через MutationObserver на её собственных узлах и делегирование
   кликов. Всё под единым guard: без GSAP страница ведёт себя как раньше.

   1. Строки .pr вписываются слева направо (clip-path) при первом появлении в
      окне — по ScrollTrigger, один раз на позицию (data-flip-id), навсегда.
   2. Сортировка/фильтры/поиск перерисовывают #tbody — здесь это Flip: строки
      переезжают, ушедшие гаснут (клон на месте старой строки, т.к. price.html
      сам стирает старые узлы раньше, чем Flip успел бы их анимировать), новые
      вписываются как в п.1.
   3. Открытие заявки — печать-пластина «ТРЕБОВАНИЕ» поверх шапки, оседает.
   4. Итог в заявке тикает одометром при любом изменении корзины.
   5. Кнопка «В заявку» — короткий отклик нажатия.
*/
(function () {
  'use strict';
  if (!window.gsap) return;

  var gsap = window.gsap;
  var AM = window.ArtefaktMotion || {};
  var T = AM.T || { 120: .12, 240: .24, 420: .42, 700: .7, 1200: 1.2 };
  var HAS_FLIP = !!window.Flip;
  var HAS_ST = !!window.ScrollTrigger;

  var mqReduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var REDUCED = !!(mqReduced && mqReduced.matches);
  if (mqReduced && mqReduced.addEventListener) {
    mqReduced.addEventListener('change', function (e) { REDUCED = e.matches; });
  }

  var tbody = document.getElementById('tbody');
  if (!tbody) return;

  /* ---------- деньги, byte-в-byte как order.js (nbsp перед ₽) ---------- */
  function money(v) {
    if (v == null || isNaN(v)) return '—';
    var kop = Math.round(v * 100) % 100 !== 0;
    return v.toLocaleString('ru-RU', {
      minimumFractionDigits: kop ? 2 : 0, maximumFractionDigits: 2
    }) + ' ₽';
  }
  function parseMoney(txt) {
    var s = String(txt || '').replace(/ /g, '').replace('₽', '').replace(/\s+/g, '').replace(',', '.');
    var v = parseFloat(s);
    return isFinite(v) ? v : 0;
  }

  /* ---------- 1. СОПОСТАВЛЕНИЕ СТРОКИ ↔ ПОЗИЦИЯ ПРАЙСА (data-flip-id) ---------- */
  var ITEMS = (window.PRICES && window.PRICES.items) || [];
  var KEY_TO_ID = {};
  ITEMS.forEach(function (it) { KEY_TO_ID[it.name + '|' + (it.variant || '')] = it.id; });

  function keyOf(row) {
    var b = row.querySelector('.pr__n b');
    var v = row.querySelector('.pr__v');
    var k = (b ? b.textContent : '') + '|' + (v ? v.textContent : '');
    var id = KEY_TO_ID[k];
    return id == null ? null : ('p-' + id);
  }
  function tagRow(row) {
    var fid = row.getAttribute('data-flip-id');
    if (fid) return fid;
    fid = keyOf(row);
    if (fid) row.setAttribute('data-flip-id', fid);
    return fid;
  }

  /* существующий data-rv на строках прайса — отдаём этому слою появлений,
     чтобы не было двух срабатываний (защита на будущее, сейчас разметка
     .pr его не носит — artefakt.js уже собрал свой список без них) */
  function stripForeignRV(root) {
    var q = root.querySelectorAll('.pr[data-rv]');
    for (var i = 0; i < q.length; i++) q[i].removeAttribute('data-rv');
  }

  /* ---------- 2. ВПИСЫВАНИЕ СТРОК ПРИ ПЕРВОМ ПОЯВЛЕНИИ (once навсегда) ---------- */
  var revealed = Object.create(null);      /* data-flip-id → true */

  function primeRow(row) {
    var fid = tagRow(row);
    if (REDUCED || !HAS_ST || !fid || revealed[fid]) {
      gsap.set(row, { clearProps: 'clipPath' });
      if (fid) revealed[fid] = true;
      return;
    }
    gsap.set(row, { clipPath: 'inset(0 100% 0 0)' });
  }

  function armReveal() {
    if (!HAS_ST || REDUCED) return;
    /* строго внутри #tbody: клоны уходящих строк (.ledger-leave) временно
       живут в document.body и тоже носят класс .pr ради визуальной
       точности затухания — их эта проба задевать не должна */
    ScrollTrigger.batch('#tbody .pr', {
      start: 'top 94%',
      once: true,
      interval: .06,
      batchMax: 8,
      onEnter: function (batch) {
        var todo = [];
        batch.forEach(function (row) {
          var fid = tagRow(row);
          if (!fid || revealed[fid]) { gsap.set(row, { clearProps: 'clipPath' }); return; }
          revealed[fid] = true;
          todo.push(row);
        });
        if (todo.length) gsap.to(todo, {
          clipPath: 'inset(0 0% 0 0)', duration: T[420], ease: 'entry2', stagger: .03
        });
      }
    });
  }

  /* первый проход: строки уже отрисованы синхронным скриптом price.html
     до того, как этот (deferred) файл вообще начал выполняться */
  (function primeAll() {
    stripForeignRV(tbody);
    var rows = tbody.querySelectorAll('.pr');
    for (var i = 0; i < rows.length; i++) primeRow(rows[i]);
    armReveal();
  })();

  /* ---------- 3. FLIP ПРИ ПЕРЕСОРТИРОВКЕ/ФИЛЬТРАХ ----------
     Рендер-функцию price.html не трогаем: перехватываем саму запись
     tbody.innerHTML = html — единственное место, где рендер прайса когда-
     либо меняет строки, независимо от того, что его вызвало (чипы, поиск,
     переключатель цен). */
  (function wrapRender() {
    if (!HAS_FLIP) return;
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!desc || !desc.set) return;
    var nativeGet = desc.get, nativeSet = desc.set;

    Object.defineProperty(tbody, 'innerHTML', {
      configurable: true,
      get: function () { return nativeGet.call(this); },
      set: function (html) {
        var oldRows = tbody.querySelectorAll('.pr');
        var state = null, leaving = [];

        if (!REDUCED && oldRows.length) {
          var oldMap = Object.create(null);
          for (var i = 0; i < oldRows.length; i++) {
            var fid = tagRow(oldRows[i]);
            if (fid) oldMap[fid] = oldRows[i];
          }
          /* какие data-flip-id останутся после перерисовки — узнаём из
             будущей разметки заранее, без реального обновления DOM */
          var tmp = document.createElement('div');
          tmp.innerHTML = html;
          var newIds = Object.create(null);
          var tmpRows = tmp.querySelectorAll('.pr');
          for (var j = 0; j < tmpRows.length; j++) {
            var k = keyOf(tmpRows[j]);
            if (k) newIds[k] = true;
          }
          /* уходящие строки price.html уничтожит мгновенно вместе с DOM —
             ловим их живой прямоугольник сейчас и гасим клоном поверх места */
          for (var fid2 in oldMap) {
            if (newIds[fid2]) continue;
            var row = oldMap[fid2];
            var r = row.getBoundingClientRect();
            var clone = row.cloneNode(true);
            clone.className += ' ledger-leave';
            clone.style.position = 'fixed';
            clone.style.left = r.left + 'px';
            clone.style.top = r.top + 'px';
            clone.style.width = r.width + 'px';
            clone.style.margin = '0';
            clone.style.zIndex = '50';
            document.body.appendChild(clone);
            leaving.push(clone);
          }
          state = Flip.getState(oldRows);
        }

        nativeSet.call(this, html);

        if (leaving.length) {
          /* CSS-переход, не GSAP: клоны — разовые независимые узлы вне
             #tbody, а в этот самый момент синхронно поднимается тяжёлая
             Flip/ScrollTrigger-перестройка остальной таблицы — тикер GSAP
             в тот же кадр иногда «доедает» большой лаг и досрочно
             завершает свежесозданный твин. Чистый transition на opacity
             (тот же --t-240/--ca-inout3 из core.css) от этого не зависит. */
          leaving.forEach(function (c) {
            c.style.opacity = '1';
            c.style.transition = 'opacity var(--t-240) var(--ca-inout3)';
          });
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              leaving.forEach(function (c) { c.style.opacity = '0'; });
            });
          });
          setTimeout(function () {
            leaving.forEach(function (c) { c.remove(); });
          }, 320);
        }
        afterRender(state);
      }
    });
  })();

  function afterRender(state) {
    var rows = tbody.querySelectorAll('.pr');
    for (var i = 0; i < rows.length; i++) tagRow(rows[i]);

    if (HAS_ST) {
      /* триггеры уничтоженных строк прайса — за собой убираем */
      ScrollTrigger.getAll().forEach(function (st) {
        var t = st.trigger;
        if (t && t.classList && t.classList.contains('pr') && !t.isConnected) st.kill();
      });
    }

    if (REDUCED || !state || !HAS_FLIP) {
      for (var j = 0; j < rows.length; j++) primeRow(rows[j]);
      armReveal();
      return;
    }

    Flip.from(state, {
      targets: rows,
      duration: T[420],
      ease: 'entry',
      stagger: .008,
      absolute: true,
      onEnter: function (els) {
        var write = [], fade = [];
        els.forEach(function (row) {
          var fid = tagRow(row);
          if (fid && !revealed[fid]) { revealed[fid] = true; write.push(row); }
          else fade.push(row);
        });
        if (write.length) gsap.fromTo(write,
          { clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)', duration: T[420], ease: 'entry2', stagger: .02 });
        if (fade.length) gsap.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: T[240], ease: 'entry2' });
      }
    });

    /* строки, которых не коснулся Flip (например их вообще не было на
       экране раньше) — обычная разовая вписка при прокрутке до них */
    armReveal();
  }

  /* ---------- 4. ЗАЯВКА: печать-пластина, тикающий итог, отклик кнопки ---------- */
  function initOrderExtras() {
    var panel = document.getElementById('ordPanel');
    if (!panel) return;
    var head = panel.querySelector('.ord-head');
    var totalEl = panel.querySelector('[data-ord="total"]');

    /* печать «ТРЕБОВАНИЕ»: появляется поверх шапки при каждом открытии
       листа заявки (лист = «требование со склада»), потом оседает мелкой
       пластиной у заголовка */
    var stamp = null;
    if (head) {
      stamp = document.createElement('span');
      stamp.className = 'ledger-stamp';
      stamp.setAttribute('aria-hidden', 'true');
      stamp.textContent = 'ТРЕБОВАНИЕ';
      head.insertBefore(stamp, head.firstChild);
      gsap.set(stamp, { opacity: 0, scale: 1.3, rotation: -7, yPercent: -50, transformOrigin: '0% 50%' });
    }
    function playStamp() {
      if (!stamp) return;
      gsap.killTweensOf(stamp);
      if (REDUCED) { gsap.set(stamp, { opacity: 1, scale: 1, rotation: -3, yPercent: -50 }); return; }
      gsap.set(stamp, { opacity: 0, scale: 1.3, rotation: -7, yPercent: -50 });
      gsap.timeline()
        .to(stamp, { opacity: 1, scale: 1.06, rotation: -5, duration: T[700], ease: 'inOut4' })
        .to(stamp, { scale: 1, rotation: -3, duration: T[420], ease: 'entry' });
    }
    function resetStamp() {
      if (!stamp) return;
      gsap.killTweensOf(stamp);
      gsap.set(stamp, { opacity: 0, scale: 1.3, rotation: -7, yPercent: -50 });
    }
    if (window.MutationObserver) {
      var wasOn = panel.classList.contains('is-on');
      new MutationObserver(function () {
        var isOn = panel.classList.contains('is-on');
        if (isOn && !wasOn) playStamp();
        else if (!isOn && wasOn) resetStamp();
        wasOn = isOn;
      }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }

    /* итог тикает одометром при любом изменении корзины/режима цен */
    if (totalEl && window.MutationObserver) {
      var cur = { v: parseMoney(totalEl.textContent) };
      var writing = false;
      new MutationObserver(function () {
        if (writing) { writing = false; return; }
        var target = parseMoney(totalEl.textContent);
        if (Math.abs(target - cur.v) < .005) { cur.v = target; return; }
        if (REDUCED) { cur.v = target; return; }
        writing = true; totalEl.textContent = money(cur.v);
        gsap.to(cur, {
          v: target, duration: T[420], ease: 'entry',
          onUpdate: function () { writing = true; totalEl.textContent = money(cur.v); },
          onComplete: function () { writing = true; totalEl.textContent = money(target); cur.v = target; }
        });
      }).observe(totalEl, { childList: true });
    }

    /* кнопка «В заявку» в строке прайса — короткий отклик нажатия */
    document.addEventListener('click', function (e) {
      if (REDUCED) return;
      var btn = e.target.closest('.ord-ctl .ord-b');
      if (!btn) return;
      gsap.fromTo(btn, { scale: .96 }, { scale: 1, duration: T[120], ease: 'entry2' });
    });
  }

  /* order.js монтирует панель по DOMContentLoaded — этот файл выполняется
     как defer-скрипт раньше того события, так что слушатель успевает
     встать в очередь (и выполнится следом за init() из order.js) */
  document.addEventListener('DOMContentLoaded', initOrderExtras);
})();
