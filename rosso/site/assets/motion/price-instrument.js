/* Россо · motion/price-instrument.js — момент 2 волны 3 (ЗАМЫСЕЛ-ПЛАН §3,
   «Прайс как инструмент»). Дирижёр поверх двух чужих слоёв:
   1) инлайн-рендер прайса в price.html (не трогаем — только перехватываем
      клики/ввод в capture-фазе на document, до того как их bubble-обработчик
      переставит/спрячет строки) и
   2) КОМПОНЕНТЫ/order/order.js (не трогаем — только слушаем DOM, который он
      сам создаёт: .ord-panel, .ord-ctl.is-in, [data-ord="total"]).
   Без GSAP — страница работает так же, как без этого файла (пустой return). */
(function () {
  "use strict";
  if (!window.gsap) return;

  var gsap = window.gsap;
  var RM = window.RossoMotion || {};
  var T = RM.T || { 120: 120, 240: 240, 420: 420, 700: 700, 1200: 1200 };
  function sec(ms) { return ms / 1000; }

  document.documentElement.classList.add("pi-on");

  var mqMobile = window.matchMedia ? window.matchMedia("(max-width:760px)") : { matches: false };

  /* ---------- ключ строки прайса → id позиции (как order.js сопоставляет текст) ---------- */
  function normKey(s) {
    return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, "");
  }
  function buildKeyMap() {
    var P = window.PRICES;
    var map = [];
    if (P && P.items) {
      P.items.forEach(function (it) {
        map.push([normKey(it.name + " " + (it.variant || "")), it.id]);
      });
      map.sort(function (a, b) { return b[0].length - a[0].length; });
    }
    return map;
  }
  var KEYMAP = buildKeyMap();
  function idForRow(row) {
    var cell = row.querySelector(".nm");
    if (!cell) return null;
    var k = normKey(cell.textContent);
    for (var i = 0; i < KEYMAP.length; i++) {
      if (k.indexOf(KEYMAP[i][0]) === 0) return KEYMAP[i][1];
    }
    return null;
  }

  /* =====================================================================
     1 + 5. FLIP ПРИ СОРТИРОВКЕ/ФИЛЬТРАХ + ОТКЛИК КНОПКИ «В ЗАЯВКУ»
     Рендер-функцию инлайн-скрипта не переписываем: перехватываем клик/ввод
     в capture-фазе на document (это гарантированно раньше bubble-обработчика
     на самой кнопке — DOM ещё старый), снимаем Flip.getState, затем даём
     оригинальному обработчику отработать и на следующем кадре анимируем.
     ===================================================================== */
  (function flipModule() {
    var table = document.getElementById("prTable");
    if (!table || !window.Flip) return;
    var Flip = window.Flip;

    function tagRows() {
      var rows = table.querySelectorAll("tr.pr");
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].hasAttribute("data-flip-id")) continue;
        var id = idForRow(rows[i]);
        rows[i].setAttribute("data-flip-id", id ? "p-" + id : "r-" + i);
      }
    }
    tagRows();
    if (window.MutationObserver) {
      new MutationObserver(tagRows).observe(table, { childList: true, subtree: true });
    }

    var flipState = null;
    function captureFlip() {
      tagRows();
      flipState = Flip.getState(table.querySelectorAll("tr.pr"), { props: "opacity" });
    }
    function playFlip() {
      if (!flipState) return;
      var state = flipState;
      flipState = null;
      var rows = table.querySelectorAll("tr.pr");
      for (var i = 0; i < rows.length; i++) rows[i].style.willChange = "transform,opacity";
      Flip.from(state, {
        targets: rows,
        duration: sec(T[420]),
        ease: "entry",
        stagger: 0.008,
        absolute: true,
        onEnter: function (els) {
          return gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: sec(T[420]), ease: "entry", stagger: 0.008 });
        },
        onLeave: function (els) {
          return gsap.to(els, { opacity: 0, duration: sec(T[240]), ease: "inOut3" });
        },
        onComplete: function () {
          for (var i = 0; i < rows.length; i++) rows[i].style.willChange = "";
        }
      });
    }

    var TRIGGERS = "#sortName,#sortPrice,#modeRetail,#modeOpt,#prFilters button,#prReset";
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest(TRIGGERS);
      if (!t) return;
      captureFlip();
      requestAnimationFrame(playFlip);
    }, true);

    document.addEventListener("input", function (e) {
      if (!e.target || e.target.id !== "prSearch") return;
      captureFlip();
      requestAnimationFrame(playFlip);
    }, true);

    /* отклик кнопки «В заявку»/«Убрать» — order.js сам меняет текст/класс,
       мы только даём короткий пружинный отскок самой кнопке */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".ord-ctl .ord-b");
      if (!btn) return;
      gsap.fromTo(btn, { scale: 0.96 }, { scale: 1, duration: sec(T[120]), ease: "inOut4" });
    }, true);
  })();

  /* =====================================================================
     3. ОДОМЕТР ИТОГА В ПАНЕЛИ ЗАЯВКИ
     order.js пишет UI.total.textContent = money(r.total) напрямую — ловим
     через MutationObserver и подменяем на тикающую анимацию. Собственные
     записи помечаем, чтобы не зациклиться.
     ===================================================================== */
  document.addEventListener("DOMContentLoaded", function () {
    var totalEl = document.querySelector('[data-order-theme="rosso"] .ord-total [data-ord="total"]');
    if (!totalEl || !window.MutationObserver) return;

    function parseMoney(s) {
      var n = parseFloat(String(s).replace(/[^\d.,]/g, "").replace(",", "."));
      return isFinite(n) ? n : 0;
    }
    function fmtRub(v) {
      v = Math.round(v * 100) / 100;
      var kop = Math.round(v * 100) % 100 !== 0;
      var s = v.toLocaleString("ru-RU", { minimumFractionDigits: kop ? 2 : 0, maximumFractionDigits: 2 });
      return s.replace(/[\s ]/g, " ") + " ₽";
    }

    var curVal = parseMoney(totalEl.textContent);
    var lastSelf = totalEl.textContent;
    var tw = null;

    function tickTo(target) {
      if (tw) tw.kill();
      var startTxt = fmtRub(curVal);
      lastSelf = startTxt;
      totalEl.textContent = startTxt;
      var obj = { v: curVal };
      tw = gsap.to(obj, {
        v: target,
        duration: sec(T[420]),
        ease: "entry",
        onUpdate: function () {
          curVal = obj.v;
          var t = fmtRub(obj.v);
          lastSelf = t;
          totalEl.textContent = t;
        },
        onComplete: function () { curVal = target; tw = null; }
      });
    }

    new MutationObserver(function () {
      var now = totalEl.textContent;
      if (now === lastSelf) return;
      tickTo(parseMoney(now));
    }).observe(totalEl, { childList: true, characterData: true, subtree: true });
  });

  /* =====================================================================
     4. ПАНЕЛЬ ЗАЯВКИ — «ЛИСТ БУМАГИ»
     order.js переключает .ord-panel.is-on сама (fab/backdrop/Esc/close/
     публичный API RybtsehOrder.open|close) — реагируем на класс, а не на
     конкретные кнопки, чтобы покрыть все пути открытия/закрытия разом.
     Таймер order.js на 280мс ставит [hidden] раньше, чем наш 420мс-твин
     закрытия успевает доиграть — держим панель отрисованной классом
     .pi-closing (см. price-instrument.css), убираем его сами по onComplete.
     ===================================================================== */
  document.addEventListener("DOMContentLoaded", function () {
    var panel = document.querySelector('[data-order-theme="rosso"] .ord-panel');
    if (!panel) return;

    var wasOn = panel.classList.contains("is-on");
    var tw = null;

    function closedVars() {
      return mqMobile.matches ? { y: 56, rotate: 0 } : { y: 20, rotate: 12 };
    }

    function playOpen() {
      if (tw) tw.kill();
      panel.classList.remove("pi-closing");
      var c = closedVars();
      gsap.set(panel, { transformOrigin: mqMobile.matches ? "50% 100%" : "88% 100%", willChange: "transform,opacity" });
      tw = gsap.fromTo(panel,
        { y: c.y, rotate: c.rotate, opacity: 0, "--pi-shadow": 0 },
        {
          y: 0, rotate: 0, opacity: 1, "--pi-shadow": 1,
          duration: sec(mqMobile.matches ? T[420] : T[700]),
          ease: "entry",
          onComplete: function () {
            gsap.set(panel, { clearProps: "transform,opacity,willChange" });
            tw = null;
          }
        });
    }

    function playClose() {
      if (tw) tw.kill();
      var c = closedVars();
      panel.classList.add("pi-closing");
      gsap.set(panel, { willChange: "transform,opacity" });
      tw = gsap.to(panel, {
        y: c.y, rotate: c.rotate, opacity: 0, "--pi-shadow": 0,
        duration: sec(T[420]), ease: "igloo",
        onComplete: function () {
          panel.classList.remove("pi-closing");
          gsap.set(panel, { clearProps: "transform,opacity,willChange" });
          tw = null;
        }
      });
    }

    new MutationObserver(function () {
      var isOn = panel.classList.contains("is-on");
      if (isOn === wasOn) return;
      wasOn = isOn;
      if (isOn) playOpen(); else playClose();
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  });
})();
