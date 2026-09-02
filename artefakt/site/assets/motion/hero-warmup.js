/* assets/motion/hero-warmup.js — холодный старт главной «Артефакт» (волна 2 плана,
   момент 1), раскадровка ЗАМЫСЕЛ-МАКСИМУМ.md §5 / ЗАМЫСЕЛ-ПЛАН.md §3.
   Одна GSAP-таймлайн владеет всем героем на 0 → 1,8 с (375: ×0.66 по задержкам).
   Снимает с героя лёгкий CSS-слой (data-mat на кадре) — атрибут убран из
   разметки, .hw-veil в этом файле берёт тёплую тьму на себя целиком, чтобы на
   кадре не оказалось двух слоёв реveal одновременно.
   Guard: без GSAP или при повторном исполнении — ничего не делает, герой
   выглядит так, как будто этого файла нет. */
(function () {
  'use strict';
  if (!window.gsap || window.__heroWarmupDone) return;
  window.__heroWarmupDone = true;

  var gsap = window.gsap;
  /* без сглаживания рывков тикера: короткий разовый интро не должен «зависать»
     на подвисших кадрах (фон/headless) и потом наверстывать — он должен идти
     по реальному прошедшему времени */
  if (gsap.ticker && gsap.ticker.lagSmoothing) gsap.ticker.lagSmoothing(0);
  var AM = window.ArtefaktMotion || {};
  var T = AM.T || { 120: .12, 240: .24, 420: .42, 700: .7, 1200: 1.2 };

  var hero = document.querySelector('.hero');
  if (!hero) return;

  var veil = hero.querySelector('.hw-veil');
  var plate = hero.querySelector('.hero__plate');
  var wtEl = plate ? plate.querySelector('.hw-wt') : null;
  var lead = hero.querySelector('.hero__lead');
  var card = hero.querySelector('.hero__card');
  var vid = hero.querySelector('.hero__vid');
  var vidPlay = vid ? vid.querySelector('.ph__play') : null;
  var vlabelSpan = document.querySelector('.vlabel span');
  var vlabelText = vlabelSpan ? (vlabelSpan.textContent || '') : '';

  /* тот же порог, на котором .hero переходит в мобильную колонку
     (см. artefakt.css, @media max-width:980px) */
  var isMobile = false;
  try { isMobile = window.matchMedia('(max-width:980px)').matches; } catch (e) {}
  var K = isMobile ? 0.66 : 1;   /* «масштабируй задержки ×0.66» на 375 */

  var wcTargets = [veil, plate, wtEl, lead, card, vid, vidPlay].filter(Boolean);

  function setFinalFrame() {
    /* prefers-reduced-motion: не выключаем момент, а сразу ставим его
       конечный кадр — паритет, а не пустота. */
    if (veil) gsap.set(veil, { opacity: 0 });
    if (wtEl) gsap.set(wtEl, { fontVariationSettings: '"wght" 700' });
    if (vlabelSpan) vlabelSpan.textContent = vlabelText;
    if (plate) gsap.set(plate, { opacity: 1 });
    if (lead) gsap.set(lead, { opacity: 1, y: 0 });
    if (card) gsap.set(card, { opacity: 1, y: 0 });
    if (vid) gsap.set(vid, { opacity: 1 });
    if (vidPlay) gsap.set(vidPlay, { scale: 1 });
  }

  function buildTimeline() {
    window.__heroWarmupBuiltAt = performance.now();
    /* стартовые состояния — только то, что появится позже по раскадровке;
       .hero__top на герое не трогаем, он был и остаётся видимым всегда */
    if (veil) gsap.set(veil, { opacity: .92 });
    if (plate) gsap.set(plate, { opacity: 0 });
    if (wtEl) gsap.set(wtEl, { fontVariationSettings: '"wght" 300' });
    if (vlabelSpan) vlabelSpan.textContent = '';
    if (lead) gsap.set(lead, { opacity: 0, y: 12 });
    if (card) gsap.set(card, { opacity: 0, y: 12 });
    if (vid) gsap.set(vid, { opacity: 0 });
    if (vidPlay) gsap.set(vidPlay, { scale: 1, transformOrigin: '50% 50%' });
    if (wcTargets.length) gsap.set(wcTargets, { willChange: 'opacity, transform, font-variation-settings' });

    var tl = gsap.timeline({
      defaults: { overwrite: 'auto' },
      onComplete: function () {
        if (wcTargets.length) gsap.set(wcTargets, { willChange: 'auto' });
      }
    });

    /* t=240: фонарь разогревается — тьма гаснет 700мс, igloo, только opacity */
    if (veil) tl.to(veil, { opacity: 0, duration: T[700], ease: 'igloo' }, K * .24);

    /* t=600: бирка печатается посимвольно, шаг ~35мс на символ (~600мс на
       текущий текст метки) — фиктивный таргет {} двигает progress, textContent
       обновляется в onUpdate тем же прогоном, что и остальной таймлайн, поэтому
       reduced-motion (timeScale×100 в core.js) доводит бирку до конца мгновенно
       вместе со всем остальным. */
    if (vlabelSpan && vlabelText) {
      var step = .035;
      tl.to({}, {
        duration: Math.max(step, step * vlabelText.length),
        ease: 'none',
        onUpdate: function () {
          var n = Math.round(this.progress() * vlabelText.length);
          vlabelSpan.textContent = vlabelText.slice(0, n);
        },
        onComplete: function () { vlabelSpan.textContent = vlabelText; }
      }, K * .6);
    }

    /* t=900: заголовок появляется ВЕСОМ — не сдвигом. Плита мгновенно видима,
       материализация только через font-variation-settings 300→700 у внутреннего
       .hw-wt (фиттер плиты меряет .hero__plate>span, его не трогаем — после
       тween просим artefakt.js перемерить пластину тем же событием resize,
       которым он это уже умеет делать). */
    if (plate) tl.set(plate, { opacity: 1 }, K * .9);
    if (wtEl) {
      tl.to(wtEl, {
        fontVariationSettings: '"wght" 700', duration: .6, ease: 'entry3',
        onComplete: function () {
          try { window.dispatchEvent(new Event('resize')); } catch (e) {}
        }
      }, K * .9);
    }

    /* t=1300: подзаголовок и карточка — мягко снизу, 12px, opacity, entry, 420 */
    var soft = [lead, card].filter(Boolean);
    if (soft.length) tl.to(soft, { opacity: 1, y: 0, duration: T[420], ease: 'entry' }, K * 1.3);

    /* t=1600: видео-карточка последней; кружок play пульсирует один раз */
    if (vid) tl.to(vid, { opacity: 1, duration: T[240], ease: 'inOut4' }, K * 1.6);
    if (vidPlay) {
      tl.to(vidPlay, {
        scale: 1.08, duration: T[240] / 2, ease: 'inOut4', yoyo: true, repeat: 1
      }, K * 1.6);
    }
  }

  if (gsap.matchMedia) {
    var mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: reduce)', setFinalFrame);
    mm.add('(prefers-reduced-motion: no-preference)', buildTimeline);
  } else {
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduced) setFinalFrame(); else buildTimeline();
  }
})();
