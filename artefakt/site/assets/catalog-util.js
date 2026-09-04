/* РЫБЦЕХ — привязка позиции прайса к карточке каталога (п. 0.1 СПЕК-V2).
   Общий модуль сайта и админки. Подключать до скрипта рендера. */
(function () {
  'use strict';
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е'); }

  /* первое слово item.name: без кавычек, до первого пробела, у слова
     с дефисом — часть до дефиса («Камбала-ёрш» → «Камбала») */
  function productNameOf(item) {
    var s = String((item && item.name) || '').replace(/[«»"']/g, '').trim();
    var w = (s.split(/\s+/)[0] || '').split('-')[0];
    return w;
  }

  /* карточка каталога, чьё name совпадает с productNameOf(item) (ё→е, без регистра), или null */
  function productKeyOf(catalog, item) {
    var name = norm(productNameOf(item));
    var products = catalog && catalog.products;
    if (!name || !products) return null;
    for (var i = 0; i < products.length; i++) {
      if (norm(products[i].name) === name) return products[i];
    }
    return null;
  }

  window.productNameOf = productNameOf;
  window.productKeyOf = productKeyOf;
})();
