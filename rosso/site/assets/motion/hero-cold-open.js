/* Россо · motion/hero-cold-open.js — холодный старт главной (волна 2, момент 1
   ЗАМЫСЕЛ-ПЛАН §3). Одна GSAP-таймлайн владеет героем: чёрный кадр → сигнальная
   лампа → постер проявляется (чёрный гаснет + clip-path снизу вверх) →
   надглазник → «Рыбцех» по буквам → кнопки. Видео подменяет постер отдельным
   кроссфейдом по canplay, вне таймлайны (постер-первым).

   Кривые и шкала — из assets/motion/core.js (entry/entry2/entry3/igloo/
   inOut3/inOut4, CustomEase). Если core.js не поднялся (нет GSAP) — этот файл
   тоже ничего не делает, а chisto-CSS фолбэк в hero-cold-open.css сам снимает
   чёрный кадр через 1.7 с, чтобы герой не завис.

   Технический факт для отчёта: WebGL-reveal (assets/gl/rosso-gl.js) считает
   прогресс от позиции элемента во вьюпорте (top/vh), не от времени — у героя,
   прижатого к верху страницы, top=0 при загрузке всегда «за порогом», поэтому
   встроенная анимация reveal-шейдера не растягивается по времени сама. Общий
   бото-вверх/верх-вниз материализующий вайп здесь сделан через clip-path на
   .hero-media (transform/opacity/clip-path — единственные разрешённые
   свойства); data-gl="reveal" на постере оставлен — он даёт зерно/виньетку/
   антибандинг слоя поверх изображения, просто без собственной 900-мс анимации. */
(function () {
  "use strict";

  var hero = document.getElementById('hero-cold');
  if (!hero || hero.dataset.coldOpen === '1') return;
  hero.dataset.coldOpen = '1';

  var heroBlack = document.getElementById('hero-black');
  var signal = document.getElementById('hero-signal');
  var heroMedia = hero.querySelector('.hero-media');
  var eyebrowLine = document.getElementById('hero-eyebrow-line');
  var eyebrowText = document.getElementById('hero-eyebrow-text');
  var title = document.getElementById('hero-title');
  var btnRed = document.getElementById('hero-btn-red');
  var btnGray = document.getElementById('hero-btn-gray');

  var REDUCED = false;
  try { REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  if (!window.gsap || !window.RossoMotion) return; // без фундамента — остаёмся на CSS-фолбэке
  var gsap = window.gsap;
  var hasSplit = !!window.SplitText;

  /* CSS-фолбэк чёрного кадра больше не нужен — таймлайн берёт слой под себя. */
  if (heroBlack) heroBlack.style.animation = 'none';

  /* ---------- буквы «Рыбцех»: SplitText с маской по символам ---------- */
  var chars = null;
  if (hasSplit && title) {
    try {
      var split = new window.SplitText(title, { type: 'chars', mask: 'chars' });
      chars = split.chars;
    } catch (e) { chars = null; }
  }

  /* ---------- конечное состояние (reduced-motion / повторный заход) ---------- */
  var settled = false;
  function finalState() {
    gsap.set([heroBlack, signal], { opacity: 0, willChange: 'auto' });
    if (heroMedia) gsap.set(heroMedia, { clipPath: 'inset(0% 0% 0% 0%)', willChange: 'auto' });
    /* WebGL-проявление — в конечное положение, дальше им ведает прокрутка */
    try {
      var poster0 = heroMedia ? heroMedia.querySelector('img[data-gl]') : null;
      if (poster0 && window.RossoGL && window.RossoGL.drive) { window.RossoGL.drive(poster0, 1); window.RossoGL.release(poster0); }
    } catch (e) {}
    if (eyebrowLine) gsap.set(eyebrowLine, { scaleX: 1, willChange: 'auto' });
    if (eyebrowText) gsap.set(eyebrowText, { opacity: 1, y: 0, willChange: 'auto' });
    if (btnRed) gsap.set(btnRed, { opacity: 1, y: 0, willChange: 'auto' });
    if (btnGray) gsap.set(btnGray, { opacity: 1, y: 0, willChange: 'auto' });
    if (chars && chars.length) gsap.set(chars, { yPercent: 0, willChange: 'auto' });
    else if (title) gsap.set(title, { opacity: 1, y: 0 });
    settled = true;
  }

  /* gsap.matchMedia().add() с ОБЪЕКТОМ из нескольких условий в этой сборке
     (assets/motion/vendor/gsap.min.js, версия 3.13.0) молча не вызывает
     колбэк — проверено живым прогоном (cdp-eval): регистрация не бросает
     исключения, но функция ни разу не срабатывает даже при заведомо истинном
     условии. Однострочная форма mm.add(query, fn) работает исправно — берём
     её, а reduced-motion проверяем напрямую через matchMedia().matches
     (живой чтение, не статический флаг), чтобы OS-переключатель посреди
     сессии тоже обрабатывался конечным кадром. */
  function reducedNow() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function buildTimeline(mobile) {
    if (reducedNow() || settled) { finalState(); return; }
    var k = mobile ? 0.7 : 1; // мобильная раскадровка короче: задержки и длительности ×0.7
    var startClip = mobile ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)'; // сверху-вниз / снизу-вверх
    var openClip = 'inset(0% 0% 0% 0%)';

    /* исходное состояние кадра — до первого пикселя видимого движения */
    gsap.set(heroBlack, { opacity: 1, willChange: 'opacity' });
    gsap.set(signal, { opacity: 0, willChange: 'opacity' });
    if (heroMedia) gsap.set(heroMedia, { clipPath: startClip, willChange: 'clip-path' });
    if (eyebrowLine) gsap.set(eyebrowLine, { scaleX: 0, willChange: 'transform' });
    if (eyebrowText) gsap.set(eyebrowText, { opacity: 0, y: 8, willChange: 'opacity, transform' });
    if (btnRed) gsap.set(btnRed, { opacity: 0, y: 10, willChange: 'opacity, transform' });
    if (btnGray) gsap.set(btnGray, { opacity: 0, y: 10, willChange: 'opacity, transform' });
    if (chars && chars.length) gsap.set(chars, { yPercent: 130, willChange: 'transform' });
    else if (title) gsap.set(title, { opacity: 0, y: 14 });

    var tl = gsap.timeline({
      defaults: { overwrite: 'auto' },
      onComplete: function () {
        settled = true;
        gsap.set([heroBlack, signal], { willChange: 'auto' });
        if (heroMedia) gsap.set(heroMedia, { willChange: 'auto' });
        if (eyebrowLine) gsap.set(eyebrowLine, { willChange: 'auto' });
        if (eyebrowText) gsap.set(eyebrowText, { willChange: 'auto' });
        if (btnRed) gsap.set(btnRed, { willChange: 'auto' });
        if (btnGray) gsap.set(btnGray, { willChange: 'auto' });
        if (chars && chars.length) gsap.set(chars, { willChange: 'auto' });
      }
    });

    /* 200 — кримзонная лампа мигает один раз */
    tl.fromTo(signal, { opacity: 0 }, { opacity: 1, duration: .06 * k, ease: 'inOut4' }, .2 * k)
      .to(signal, { opacity: 0, duration: .06 * k, ease: 'inOut4' }, .26 * k);

    /* 320 — чёрный гаснет, постер проявляется.
       Куратор глазами: clip-path даёт ЖЁСТКУЮ прямую кромку, режущую рыбу
       пополам, как штора. У WebGL-слоя (rosso-gl.js) есть ручной режим
       RossoGL.drive(el, p): шейдер проявляет кадр снизу вверх с мягкой
       зернистой кромкой и дымкой. Ведём его по времени; пока слой не поднят
       (линковка асинхронная) или его нет вовсе — та же кромка через clip-path,
       чтобы кадр в любом случае проявился. */
    tl.to(heroBlack, { opacity: 0, duration: .9 * k, ease: 'entry' }, .32 * k);
    var poster = heroMedia ? heroMedia.querySelector('img[data-gl]') : null;
    var reveal = { p: 0 }, glTook = false;
    tl.to(reveal, {
      p: 1, duration: .9 * k, ease: 'entry',
      onUpdate: function () {
        var ok = !!(poster && window.RossoGL && window.RossoGL.drive && window.RossoGL.drive(poster, reveal.p));
        if (ok && !glTook) { glTook = true; if (heroMedia) gsap.set(heroMedia, { clipPath: openClip }); }
        if (!ok && !glTook && heroMedia) {
          var pct = (100 * (1 - reveal.p)).toFixed(2) + '%';
          gsap.set(heroMedia, { clipPath: mobile ? 'inset(0% 0% ' + pct + ' 0%)' : 'inset(' + pct + ' 0% 0% 0%)' });
        }
      },
      onComplete: function () {
        if (heroMedia) gsap.set(heroMedia, { clipPath: openClip });
        if (poster && window.RossoGL && window.RossoGL.release) window.RossoGL.release(poster);
      }
    }, .32 * k);

    /* 700 — сначала волосяная линия, потом текст надглазника */
    if (eyebrowLine) tl.fromTo(eyebrowLine, { scaleX: 0 }, { scaleX: 1, duration: .22 * k, ease: 'igloo' }, .70 * k);
    if (eyebrowText) tl.fromTo(eyebrowText, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .24 * k, ease: 'igloo' }, .70 * k + .16 * k);

    /* 1000 — «Рыбцех» встаёт из-под маски, разбег 28 мс на букву */
    if (chars && chars.length) {
      tl.to(chars, { yPercent: 0, duration: .7 * k, ease: 'entry3', stagger: .028 * k }, 1.0 * k);
    } else if (title) {
      tl.to(title, { opacity: 1, y: 0, duration: .7 * k, ease: 'entry3' }, 1.0 * k);
    }

    /* 1500 — кнопки последними, красная на 60 мс раньше серой */
    if (btnRed) tl.to(btnRed, { opacity: 1, y: 0, duration: .24 * k, ease: 'inOut3' }, 1.5 * k);
    if (btnGray) tl.to(btnGray, { opacity: 1, y: 0, duration: .24 * k, ease: 'inOut3' }, 1.56 * k);
  }

  var mm = gsap.matchMedia();
  mm.add('(max-width: 700px)', function () { buildTimeline(true); });
  mm.add('(min-width: 700.02px)', function () { buildTimeline(false); });

  /* ---------- идемпотентность: возврат из bfcache — сразу конечный кадр ---------- */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) finalState();
  });
})();
