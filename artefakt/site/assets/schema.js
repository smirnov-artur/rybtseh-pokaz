/*!
 * РЫБЦЕХ — генераторы расширенной микроразметки (JSON-LD), которых сегодня
 * нет на сайте: BreadcrumbList, Product (из window.PRICES), VideoObject,
 * Organization. LocalBusiness (index.html) и ItemList (price.html) уже
 * есть на страницах — этот файл их не трогает и не дублирует.
 *
 * Использование — см. README.md. Коротко: подключить файл, затем вызвать
 * нужный билдер и вставить результат в <head> самостоятельным тегом
 * <script type="application/ld+json">, например:
 *
 *   RybtsehSchema.inject(RybtsehSchema.breadcrumbList());
 *   RybtsehSchema.inject(RybtsehSchema.organization());
 *
 * Каждый билдер возвращает обычный JS-объект либо null, если разметку
 * честно строить не из чего (см. комментарии у каждой функции) —
 * инъекция null молча ничего не делает.
 */
(function (window, document) {
  'use strict';

  var BASE_URL = window.RYBTSEH_SCHEMA_BASE_URL || 'https://xn--90ai5awd2a.xn--p1ai/';
  var BUSINESS_ID = BASE_URL + '#business';

  function absUrl(path) {
    path = String(path || '').replace(/^\/+/, '');
    return BASE_URL + path;
  }

  /* ---------- вставка готового объекта как отдельного <script> ---------- */
  function inject(ld) {
    if (!ld) return null;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
    return s;
  }

  /* =====================================================================
     BREADCRUMBLIST — по пути текущей страницы
     Строится из карты «файл → название» ниже (сверить с nav обоих сайтов:
     Главная / Прайс / Наша история / Оптовикам / Доставка / Магазин).
     На главной и на 404 breadcrumbs не строим — на главной это один
     элемент без пользы для поиска, на 404 страницы как таковой нет.
     ===================================================================== */
  var PAGE_TITLES = {
    'index.html': 'Главная',
    'price.html': 'Прайс',
    'istoria.html': 'Наша история',
    'opt.html': 'Оптовикам',
    'dostavka.html': 'Доставка',
    'magazin.html': 'Магазин'
  };

  function currentFile() {
    var f = String(location.pathname || '').split('/').pop();
    return f || 'index.html';
  }

  /* label — необязательная ручная подпись текущей страницы (например,
     если название в PAGE_TITLES не совпадает с заголовком, или страница
     не входит в основной набор). Без аргумента берётся PAGE_TITLES,
     а если файла там нет — document.title до первого « — ». */
  function breadcrumbList(label) {
    var file = currentFile();
    if (file === 'index.html' || file === '' || file === '404.html') return null;

    var name = label || PAGE_TITLES[file] ||
      (document.title || '').split(/[—-]/)[0].trim() || file;

    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        {
          '@type': 'ListItem',
          'position': 1,
          'name': 'Главная',
          'item': absUrl('index.html')
        },
        {
          '@type': 'ListItem',
          'position': 2,
          'name': name,
          'item': absUrl(file)
        }
      ]
    };
  }

  /* =====================================================================
     FAQPAGE — НЕ ПРИМЕНИМО.
     Проверены dostavka.html и opt.html обоих сайтов (artefakt-site,
     rosso-site) на 01–02.09.2026: реальных блоков «вопрос — ответ» там
     нет, только сплошной информационный текст и списки условий
     (доставка, минимальный опт, тара). Совпадения по словам «ответ» —
     это «ответственность за груз», не Q&A.
     Функция оставлена как заглушка: возвращает null и не создаёт
     разметку из воздуха. Если на сайте когда-нибудь появится настоящий
     блок вопрос-ответ (видимый пользователю текст, не только в вёрстке
     для FAQPage), передайте пары сюда:
     RybtsehSchema.faqPage([{q:'...', a:'...'}, ...])
     ===================================================================== */
  function faqPage(pairs) {
    if (!pairs || !pairs.length) return null;   /* без пар — ничего не строим и не выдумываем */
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': pairs.map(function (p) {
        return {
          '@type': 'Question',
          'name': p.q,
          'acceptedAnswer': { '@type': 'Answer', 'text': p.a }
        };
      })
    };
  }

  /* =====================================================================
     PRODUCT — из window.PRICES, ничего не хардкодится.
     Форма объекта совпадает с уже работающим инлайн-скриптом ItemList
     на price.html (оба сайта) — так что это не новая логика, а вынесенная
     в переиспользуемый файл версия того же самого. НЕ добавляйте её на
     price.html поверх существующего инлайн-скрипта — получится дубль
     JSON-LD на одной странице. Использовать здесь, если инлайн-скрипт
     когда-нибудь удалят/заменят на этот вызов, либо на других страницах,
     где нужен Product по одной конкретной позиции (productSingle).
     availability сознательно не указывается — сайт не управляет
     остатками, врать про наличие нельзя (см. ДАННЫЕ.md, комментарий
     в существующем инлайн-скрипте price.html).
     ===================================================================== */
  function productList(pageUrl) {
    var P = window.PRICES;
    if (!P || !P.items || !P.items.length) return null;
    var url = pageUrl ? absUrl(pageUrl) : absUrl('price.html');
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': 'Прайс Рыбцеха Клевцова',
      'description': P.vat_note || '',
      'url': url,
      'numberOfItems': P.items.length,
      'itemListOrder': 'https://schema.org/ItemListUnordered',
      'itemListElement': P.items.map(function (it, n) {
        return {
          '@type': 'ListItem',
          'position': n + 1,
          'item': productSingle(it, url)
        };
      })
    };
  }

  function productSingle(it, pageUrl) {
    var P = window.PRICES || {};
    var url = pageUrl || absUrl('price.html');
    return {
      '@type': 'Product',
      'name': it.name + (it.variant ? ', ' + it.variant : ''),
      'category': it.category,
      'brand': { '@type': 'Brand', 'name': 'Рыбцех Клевцова' },
      'offers': {
        '@type': 'Offer',
        'price': it.price_retail,
        'priceCurrency': P.currency || 'RUB',
        'url': url,
        'eligibleQuantity': { '@type': 'QuantitativeValue', 'unitText': it.unit }
        /* availability намеренно не указан */
      }
    };
  }

  /* =====================================================================
     VIDEOOBJECT — по факту DOM, а не по жёстко зашитому имени файла:
     функция сканирует <video> на текущей странице и строит объект под
     то, что реально там лежит (poster, source[src]). Так разметка не
     разойдётся с версткой, если другой агент поменяет пути к файлам.

     kind:
       'production_film' — постановочный ролик о вялении (сгенерирован
         нейросетью в 2026 году). ВАЖНО: описание прямо говорит, что это
         не документальная съёмка цеха — так требует владелец.
       'report_1tv'       — репортаж Первого канала, эфир 25.08.2008,
         настоящая съёмка. Есть только на «Россо» (istoria.html вставляет
         сам ролик istoria-1tv.mp4). На «Артефакте» этот блок — цитата и
         фотография БЕЗ видео, поэтому для 'report_1tv' на артефакт-версии
         функция вернёт null: строить VideoObject не из чего, а привязка
         к странице, где ролика физически нет, вводит Google в заблуждение.

     Длительности взяты из подписи на самих страницах (не выдуманы):
     постановочный ролик — 0:35, репортаж — 3:40.
     ===================================================================== */
  var DURATION_BY_KIND = {
    production_film: 'PT35S',
    report_1tv: 'PT3M40S'
  };

  var DESCRIPTION_BY_KIND = {
    production_film: 'Постановочный ролик о вялении рыбы: приёмка, посол, сушилка. ' +
      'Видео сгенерировано нейросетью в 2026 году и не является документальной ' +
      'съёмкой цеха — это иллюстрация процесса, без звука.',
    report_1tv: 'Телевизионный репортаж «Первого канала» о рыбцехе Клевцова, ' +
      'эфир 25 августа 2008 года: настоящая съёмка приёмки, посола и сушилки, ' +
      'со звуком.'
  };

  var NAME_BY_KIND = {
    production_film: 'Кино о вялении рыбы — Рыбцех Клевцова',
    report_1tv: 'Первый канал о рыбцехе Клевцова, эфир 25.08.2008'
  };

  /* дата загрузки постановочного ролика — берём из window.RYBTSEH_SCHEMA_FILM_DATE
     ('YYYY-MM-DD'), если её задали (см. README/ЧТО-СПРОСИТЬ-У-ВЛАДЕЛЬЦА — дату
     публикации сайта знает только владелец). Без неё поле просто не появится
     в объекте — лучше не отправлять uploadDate вовсе, чем угадывать.
     Для репортажа дата настоящая и известна точно — эфир 25.08.2008. */
  var UPLOAD_DATE_BY_KIND = {
    production_film: window.RYBTSEH_SCHEMA_FILM_DATE || null,
    report_1tv: '2008-08-25'
  };

  function findVideoEl(kind) {
    var all = document.querySelectorAll('video');
    for (var i = 0; i < all.length; i++) {
      var v = all[i];
      var src = '';
      var sourceEl = v.querySelector('source');
      src = (sourceEl && sourceEl.getAttribute('src')) || v.getAttribute('src') || '';
      src = src.toLowerCase();
      if (kind === 'report_1tv' && src.indexOf('1tv') !== -1) return v;
      if (kind === 'production_film' && src.indexOf('1tv') === -1 &&
        (src.indexOf('kino') !== -1 || src.indexOf('film') !== -1)) return v;
    }
    return null;
  }

  function videoObject(kind) {
    var v = findVideoEl(kind);
    if (!v) return null;                    /* на этой странице/сайте такого видео нет — не выдумываем */

    var sourceEl = v.querySelector('source');
    var src = (sourceEl && sourceEl.getAttribute('src')) || v.getAttribute('src') || '';
    var poster = v.getAttribute('poster') || '';
    var uploadDate = UPLOAD_DATE_BY_KIND[kind];

    var ld = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      'name': NAME_BY_KIND[kind] || document.title,
      'description': DESCRIPTION_BY_KIND[kind] || '',
      'thumbnailUrl': poster ? [absUrl(poster)] : undefined,
      'contentUrl': src ? absUrl(src) : undefined,
      'embedUrl': absUrl(currentFile()),
      'duration': DURATION_BY_KIND[kind]
    };
    if (uploadDate) ld.uploadDate = uploadDate;
    /* без даты публикации поле лучше не отправлять вовсе, чем угадывать */
    return ld;
  }

  /* =====================================================================
     ORGANIZATION — контакты по ролям, из ДАННЫЕ.md (единственный источник
     истины проекта). Использовать на внутренних страницах (istoria,
     opt, dostavka, magazin), где сегодня вообще нет структурированных
     данных о компании — LocalBusiness сейчас есть только на index.html.
     @id совпадает с LocalBusiness на главной (#business), чтобы Google
     не плодил вторую сущность, а достраивал ту же самую.
     Это НЕ замена LocalBusiness на главной — там полный набор (адрес,
     часы работы, geo), здесь — лёгкая версия только с идентификацией
     и контактами, без дублирования адреса/часов на каждой странице.
     ===================================================================== */
  function organization() {
    return {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': BUSINESS_ID,
      'name': 'Рыбцех Клевцова',
      'alternateName': 'Рыбцехъ Клевцова',
      'url': BASE_URL,
      'logo': absUrl('apple-touch-icon-180.png'),
      'foundingDate': '1967',
      'sameAs': ['https://vk.com/klevtsov_fish'],
      'contactPoint': [
        {
          '@type': 'ContactPoint',
          'contactType': 'sales',
          'name': 'Опт — Антон Дмитриевич',
          'telephone': '+7-928-770-21-70',
          'email': 'ak806@me.com',
          'availableLanguage': 'Russian'
        },
        {
          '@type': 'ContactPoint',
          'contactType': 'customer support',
          'name': 'Розница — Маргарита Георгиевна',
          'telephone': '+7-918-594-96-85',
          'availableLanguage': 'Russian'
        },
        {
          '@type': 'ContactPoint',
          'contactType': 'technical support',
          'name': 'Технолог — Ольга Михайловна',
          'telephone': '+7-928-96-500-95',
          'email': 'info@k-fish.ru',
          'availableLanguage': 'Russian'
        }
      ]
    };
  }

  /* очищает undefined-поля перед сериализацией (duration/contentUrl и т.п.,
     если видео на странице не нашлось по частям) */
  function clean(o) {
    if (!o || typeof o !== 'object') return o;
    if (Array.isArray(o)) { return o.map(clean); }
    var out = {};
    Object.keys(o).forEach(function (k) {
      if (o[k] === undefined) return;
      out[k] = clean(o[k]);
    });
    return out;
  }

  window.RybtsehSchema = {
    inject: function (ld) { return inject(clean(ld)); },
    breadcrumbList: breadcrumbList,
    faqPage: faqPage,
    productList: productList,
    productSingle: productSingle,
    videoObject: videoObject,
    organization: organization,
    _clean: clean,
    _absUrl: absUrl
  };

})(window, document);
