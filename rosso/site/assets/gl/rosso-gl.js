/* ============================================================
   «РОССО» · WebGL-слой  ·  rosso-gl.js
   Ванильный WebGL2, ноль зависимостей, ноль сборки.
   Прогрессивное улучшение: нет WebGL2 / стоит prefers-reduced-motion /
   упал контекст — остаётся обычная <img>, страница не ломается.

   Разметка:
     <img src="..." data-gl="reveal">
     <img src="..." data-gl="displace" data-gl-src="a.jpg,b.jpg">
     <img src="..." data-gl="ripple">

   Приёмы взяты из разведки igloo.inc (РАЗВЕДКА-IGLOO.md):
     · материализация из тьмы  — falloffsmooth по мировой Y
     · синий шум с покадровым смещением против бандинга
     · диагональное умножение 0.8 → 1.0 вместо радиальной виньетки
     · зажатый DPR + адаптивное снижение при FPS < 30
   Чужого кода нет: шейдеры и шум написаны здесь.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 0. ВОРОТА ПРОГРЕССИВНОГО УЛУЧШЕНИЯ ---------- */

  var REDUCED = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) return;
  if (typeof WebGL2RenderingContext === 'undefined') return;
  if (!window.requestAnimationFrame || !window.IntersectionObserver) return;

  /* ---------- 1. НАСТРОЙКИ ---------- */

  var CFG = {
    maxContexts: 8,      // больше живых контекстов браузер не любит
    dprFloor: 0.6,       // пол адаптивного множителя
    warmup: 2000,        // прогрев до первой оценки FPS, мс
    sampleEvery: 4000,   // шаг оценки FPS, мс
    minSamples: 5,
    fpsFloor: 30,        // ниже — режем DPR
    rootMargin: '220px', // запас видимости для IntersectionObserver
    noiseSize: 64        // сторона плитки синего шума
  };

  /* ---------- 2. МЕЛОЧИ ---------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  /* object-position картинки → доли [x, y] 0..1 (проценты и ключевые слова; иначе центр) */
  function objPos(el) {
    try {
      var v = getComputedStyle(el).objectPosition.split(/\s+/);
      var f = function (t) {
        if (/%$/.test(t)) return Math.min(1, Math.max(0, parseFloat(t) / 100));
        if (t === 'left' || t === 'top') return 0;
        if (t === 'right' || t === 'bottom') return 1;
        return 0.5;
      };
      return [f(v[0] || '50%'), f(v[1] || '50%')];
    } catch (e) { return [0.5, 0.5]; }
  }
  function num(el, attr, def) {
    var v = parseFloat(el.getAttribute(attr));
    return isNaN(v) ? def : v;
  }
  function attr(el, a, def) {
    var v = el.getAttribute(a);
    return (v === null || v === '') ? def : v;
  }
  // мягкая кривая входа, близкая к igloo entry_ease
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) {
    t = clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* Базовый DPR — жёстко зажат, как в разведке. */
  function baseDpr() {
    var d = window.devicePixelRatio || 1;
    return d <= 2 ? Math.min(d, 1.15) : Math.min(d, 1.5);
  }

  /* ---------- 3. СИНИЙ ШУМ (void-and-cluster, 64×64) ----------
     Плитка считается один раз на странице, лениво, в простое.
     До готовности шейдер берёт процедурный interleaved-gradient noise,
     так что бандинг лечится с первого кадра, а плитка просто улучшает
     спектр. Ассетов не тянем: ни KTX2, ни PNG. */

  var noiseTile = null;   // Uint8Array(64*64) или null
  var noiseBuilt = false;

  function buildBlueNoise(N) {
    var n = N * N, i, j, x, y;
    var bin = new Uint8Array(n);          // 0/1 — «минорная» решётка
    var energy = new Float32Array(n);
    var rank = new Int32Array(n);
    // гауссово ядро радиуса 6, sigma 1.9 (стандарт void-and-cluster)
    var R = 6, sig2 = 2 * 1.9 * 1.9, K = [];
    for (y = -R; y <= R; y++) for (x = -R; x <= R; x++) {
      K.push([x, y, Math.exp(-(x * x + y * y) / sig2)]);
    }
    var kl = K.length;

    function splat(idx, s) {
      var px = idx % N, py = (idx / N) | 0, k, kx, ky, e;
      for (k = 0; k < kl; k++) {
        kx = (px + K[k][0] + N) % N;
        ky = (py + K[k][1] + N) % N;
        energy[ky * N + kx] += s * K[k][2];
      }
    }
    function extreme(want, wantFilled) { // want:  1 = максимум, -1 = минимум
      var best = -1, bv = want > 0 ? -Infinity : Infinity, e;
      for (i = 0; i < n; i++) {
        if (bin[i] !== wantFilled) continue;
        e = energy[i];
        if (want > 0 ? e > bv : e < bv) { bv = e; best = i; }
      }
      return best;
    }

    // 1. стартовое множество ~10% случайных точек
    var seed = 20240901, cnt = Math.round(n * 0.1);
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var placed = 0;
    while (placed < cnt) {
      i = (rnd() * n) | 0;
      if (!bin[i]) { bin[i] = 1; splat(i, 1); placed++; }
    }
    // 2. релаксация: самый «кластерный» переносим в самую большую «пустоту»
    for (var it = 0; it < n; it++) {
      var tight = extreme(1, 1);
      bin[tight] = 0; splat(tight, -1);
      var voidIdx = extreme(-1, 0);
      if (voidIdx === tight) { bin[tight] = 1; splat(tight, 1); break; }
      bin[voidIdx] = 1; splat(voidIdx, 1);
    }
    // 3. фаза I — разбираем стартовое множество назад
    var snapshot = bin.slice();
    for (i = 0; i < n; i++) rank[i] = -1;
    var c = placed;
    while (c > 0) {
      var t = extreme(1, 1);
      bin[t] = 0; splat(t, -1); c--;
      rank[t] = c;
    }
    // 4. фаза II/III — досыпаем в пустоты
    bin.set(snapshot);
    energy.fill(0);
    for (i = 0; i < n; i++) if (bin[i]) splat(i, 1);
    for (c = placed; c < n; c++) {
      var v = extreme(-1, 0);
      if (v < 0) break;
      bin[v] = 1; splat(v, 1);
      rank[v] = c;
    }
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) out[i] = Math.min(255, Math.round((rank[i] < 0 ? 0 : rank[i]) * 255 / (n - 1)));
    return out;
  }

  /* Плитка считается ~300–400 мс одним куском (void-and-cluster — O(n²)).
     В простое это всё равно ОДНА длинная задача, и профиль поймал её первым
     кадром холодного старта: 383 мс дыра. Поэтому три ступени:
       1) кеш в localStorage (4 КБ) — повторный заход не считает вовсе;
       2) Web Worker — главный поток не трогаем, шейдер до готовности
          живёт на процедурном шуме (см. выше);
       3) старый синхронный путь — только если Worker недоступен. */
  var NOISE_KEY = 'rgl:bn:' + CFG.noiseSize;

  function noiseFromCache() {
    try {
      var s = window.localStorage && localStorage.getItem(NOISE_KEY);
      if (!s) return null;
      var bin = atob(s), n = CFG.noiseSize * CFG.noiseSize;
      if (bin.length !== n) return null;
      var out = new Uint8Array(n);
      for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  function noiseToCache(tile) {
    try {
      var s = '';
      for (var i = 0; i < tile.length; i++) s += String.fromCharCode(tile[i]);
      localStorage.setItem(NOISE_KEY, btoa(s));
    } catch (e) {}
  }

  function ensureNoise(cb) {
    if (noiseBuilt) { cb(noiseTile); return; }
    noiseBuilt = true;

    var cached = noiseFromCache();
    if (cached) { noiseTile = cached; cb(noiseTile); return; }

    var done = function (tile) {
      noiseTile = tile || null;
      if (noiseTile) noiseToCache(noiseTile);
      cb(noiseTile);
    };

    if (window.Worker && window.Blob && window.URL) {
      try {
        var src = 'var build=' + buildBlueNoise.toString() + ';' +
                  'self.onmessage=function(e){try{self.postMessage(build(e.data));}catch(err){self.postMessage(null);}};';
        var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        var w = new Worker(url);
        w.onmessage = function (e) { URL.revokeObjectURL(url); w.terminate(); done(e.data); };
        w.onerror = function () { URL.revokeObjectURL(url); w.terminate(); done(null); };
        w.postMessage(CFG.noiseSize);
        return;
      } catch (e) { /* падаем в синхронный путь */ }
    }

    var run = function () {
      var tile = null;
      try { tile = buildBlueNoise(CFG.noiseSize); } catch (e) { tile = null; }
      done(tile);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 60);
  }

  /* ---------- 4. МЕЛКИЕ ПОМОЩНИКИ WEBGL2 ---------- */

  function getContext(canvas) {
    var opts = {
      alpha: true, depth: false, stencil: false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
      powerPreference: 'low-power', failIfMajorPerformanceCaveat: false
    };
    try { return canvas.getContext('webgl2', opts); } catch (e) { return null; }
  }

  function shader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    /* COMPILE_STATUS тоже ждёт компиляцию синхронно. При параллельной
       линковке статус не спрашиваем — ошибка компиляции всплывёт в
       LINK_STATUS, когда программа дозреет (см. programOk). */
    var ext = gl.__pc === undefined ? (gl.__pc = gl.getExtension('KHR_parallel_shader_compile')) : gl.__pc;
    if (!ext && !gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (window.console) console.warn('[rosso-gl] shader:', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  }

  /* Линковка шейдера — сотни миллисекунд на встроенной графике, и запрос
     LINK_STATUS ждёт её синхронно: профиль ловил дыру 367 мс в первом кадре.
     С KHR_parallel_shader_compile линковка идёт в фоне: программу отдаём
     сразу, а готовность спрашиваем по COMPLETION_STATUS_KHR из кадра в кадр —
     пока не готова, на экране остаётся <img>, никакой дыры. */
  function program(gl, vsrc, fsrc) {
    var vs = shader(gl, gl.VERTEX_SHADER, vsrc);
    var fs = shader(gl, gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    return p;
  }

  /* true — линковка завершена (успешно или нет); проверять LINK_STATUS
     имеет смысл только после этого. Без расширения — сразу true. */
  function programDone(gl, p) {
    var ext = gl.__pc === undefined ? (gl.__pc = gl.getExtension('KHR_parallel_shader_compile')) : gl.__pc;
    if (!ext) return true;
    return !!gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR);
  }

  function programOk(gl, p) {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (window.console) console.warn('[rosso-gl] link:', gl.getProgramInfoLog(p));
      gl.deleteProgram(p); return false;
    }
    return true;
  }

  function quad(gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao: vao, buf: buf };
  }

  function texFromImage(gl, img) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) { gl.deleteTexture(t); return null; }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  function texFromNoise(gl, data, N) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  /* ---------- 5. ШЕЙДЕРЫ: ОБЩАЯ ЧАСТЬ ---------- */

  var SH = {};

  SH.vert =
    '#version 300 es\n' +
    'in vec2 aPos; out vec2 vUv;\n' +
    'void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }\n';

  SH.head =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vUv; out vec4 oCol;\n' +
    'uniform vec2  uRes;\n' +
    'uniform float uTime;\n' +
    'uniform float uProgress;\n' +
    'uniform vec2  uCov0;\n' +
    'uniform vec2  uCov1;\n' +
    'uniform vec2  uPos;\n' +          /* object-position картинки, доли 0..1 */
    'uniform sampler2D uTex0;\n' +
    'uniform sampler2D uTex1;\n' +
    'uniform float uMono;\n' +
    'uniform float uAmount;\n' +
    'uniform float uGrain;\n' +
    'uniform float uGradA;\n' +
    'uniform float uHasNoise;\n' +
    'uniform vec2  uNoiseOff;\n' +
    'uniform sampler2D uNoise;\n' +
    'const vec3 ROSSO = vec3(0.855,0.161,0.110);\n' +   /* #da291c */
    // object-fit: cover в UV-пространстве
    'vec2 cov(vec2 uv, vec2 s){ return uv*s + (1.0-s)*uPos; }\n' +   /* центр = uPos .5/.5; иначе окно едет по object-position */
    'vec3 mono(vec3 c, float k){ float l = dot(c, vec3(0.2126,0.7152,0.0722)); return mix(c, vec3(l), k); }\n' +
    // igloo: мягкая полоса, идущая сверху вниз при p 0→1
    'float falloffsmooth(float v, float hi, float lo, float feather, float p){\n' +
    '  float edge = mix(hi + feather, lo - feather - 0.1, clamp(p,0.0,1.0));\n' +
    '  return smoothstep(edge, edge + feather, v);\n' +
    '}\n' +
    // свой value-noise + fbm (никакой чужой библиотеки)
    'float hash21(vec2 p){ p = fract(p*vec2(123.34,345.45)); p += dot(p, p+34.345); return fract(p.x*p.y); }\n' +
    'float vnoise(vec2 p){\n' +
    '  vec2 i = floor(p), f = fract(p);\n' +
    '  vec2 u = f*f*(3.0-2.0*f);\n' +
    '  float a = hash21(i), b = hash21(i+vec2(1.0,0.0));\n' +
    '  float c = hash21(i+vec2(0.0,1.0)), d = hash21(i+vec2(1.0,1.0));\n' +
    '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);\n' +
    '}\n' +
    'float fbm(vec2 p){\n' +
    '  float s = 0.0, a = 0.5;\n' +
    '  for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.02; a *= 0.5; }\n' +
    '  return s;\n' +
    '}\n';

  /* ---------- 6. РЕЖИМ «REVEAL» — МАТЕРИАЛИЗАЦИЯ ИЗ ТЬМЫ ----------
     Приём разведки: alpha *= falloffsmooth(worldY, 3.5, 0.1, 2.0, uProgress).
     Мировая Y берётся как vUv.y * 3.5 — так константы igloo переносятся
     буквально: полоса шириной 3.5 юнита, растушёвка 2.0, идёт сверху вниз.
     Прогресс привязан к появлению элемента в кадре (считается на CPU). */

  SH.reveal =
    'void main(){\n' +
    '  float p = clamp(uProgress, 0.0, 1.0);\n' +
    // лёгкий наплыв: кадр «выступает» из тьмы, а не проступает плоско
    '  vec2 uv = cov(vUv, uCov0);\n' +
    '  uv = (uv - 0.5) * mix(1.045, 1.0, p) + 0.5;\n' +
    '  vec3 col = mono(texture(uTex0, uv).rgb, uMono);\n' +
    '  float worldY = vUv.y * 3.5;\n' +
    '  float a = falloffsmooth(worldY, 3.5, 0.1, 2.0, p);\n' +
    // узкий гребень света ровно на кромке материализации
    '  float e = falloffsmooth(worldY, 3.5, 0.1, 0.42, p);\n' +
    '  float ridge = e * (1.0 - e) * 4.0;\n' +
    '  col += ridge * uAmount * (0.35 + 0.65 * col);\n' +
    // тьма, из которой выступает кадр: недопроявленное чуть темнее
    '  col *= mix(0.62, 1.0, a);\n' +
    '  col = rglFinish(col, vUv, gl_FragCoord.xy);\n' +
    '  oCol = vec4(col * a, a);\n' +
    '}\n';

  /* ---------- 7. РЕЖИМ «DISPLACE» — ПЕРЕТЕКАНИЕ ПО КАРТЕ СМЕЩЕНИЯ ----------
     Не кроссфейд: порог идёт по шумовой карте, а оба кадра тянутся вдоль
     градиента этой же карты — снимок буквально растекается в следующий.
     uProgress 0 → кадр A, 1 → кадр B. */

  SH.displace =
    'void main(){\n' +
    '  float p = clamp(uProgress, 0.0, 1.0);\n' +
    '  float ar = uRes.x / max(uRes.y, 1.0);\n' +
    '  vec2 np = vec2(vUv.x * ar, vUv.y) * 2.6;\n' +
    // карта смещения: крупный fbm + медленный дрейф, чтобы кадр «жил»
    '  float n = fbm(np + vec2(0.0, uTime * 0.02));\n' +
    // градиент карты — направление растекания
    '  const float ex = 0.035;\n' +
    '  float nx = fbm(np + vec2(ex, 0.0)) - n;\n' +
    '  float ny = fbm(np + vec2(0.0, ex)) - n;\n' +
    '  vec2 dir = vec2(nx, ny);\n' +
    '  float dl = length(dir);\n' +
    '  dir = dl > 0.0001 ? dir / dl : vec2(0.0, 1.0);\n' +
    // фронт перехода: узкая мягкая граница по значению карты
    '  const float band = 0.30;\n' +
    '  float th = mix(-band, 1.0 + band, p);\n' +
    '  float m = smoothstep(th - band, th + band, n);\n' +   /* 1 — ещё A, 0 — уже B */
    '  float front = (1.0 - abs(m * 2.0 - 1.0));\n' +        /* сила тяги на фронте */
    '  float amp = uAmount * front;\n' +
    '  vec2 uvA = cov(vUv + dir * amp, uCov0);\n' +
    '  vec2 uvB = cov(vUv - dir * amp * 0.72, uCov1);\n' +
    '  vec3 a = mono(texture(uTex0, uvA).rgb, uMono);\n' +
    '  vec3 b = mono(texture(uTex1, uvB).rgb, uMono);\n' +
    '  vec3 col = mix(b, a, m);\n' +
    // на фронте кадр слегка недоэкспонирован — читается как «плавка», не как шторка
    '  col *= 1.0 - front * 0.16;\n' +
    '  col = rglFinish(col, vUv, gl_FragCoord.xy);\n' +
    '  oCol = vec4(col, 1.0);\n' +
    '}\n';

  /* ---------- 8. РЕЖИМ «RIPPLE» — РЯБЬ ПОД КУРСОРОМ ----------
     Восемь источников в кольцевом буфере: xy — позиция в UV (с поправкой
     на пропорции), z — возраст в секундах, w — сила. Радиальные волны
     с затуханием по времени и расстоянию; UV смещается вдоль радиуса.
     Ноль FBO, ноль симуляции — на слабом железе это ровно один проход. */

  SH.ripple =
    'uniform vec4 uRip[8];\n' +   /* x,y — UV; z — возраст, с; w — сила */
    'uniform float uRipAccent;\n' +
    'void main(){\n' +
    '  float ar = uRes.x / max(uRes.y, 1.0);\n' +
    '  vec2 p = vec2(vUv.x * ar, vUv.y);\n' +
    '  vec2 disp = vec2(0.0);\n' +
    '  float crest = 0.0;\n' +
    '  for(int i = 0; i < 8; i++){\n' +
    '    vec4 r = uRip[i];\n' +
    '    if(r.w <= 0.001) continue;\n' +
    '    vec2 d = p - vec2(r.x * ar, r.y);\n' +
    '    float dist = length(d);\n' +
    '    float age = r.z;\n' +
    // фронт уходит от точки со скоростью 0.42 UV/с
    '    float wave = dist - age * 0.42;\n' +
    // кольцо: узкая волна, живёт ~1.6 с и гаснет по расстоянию
    '    float ring = sin(wave * 34.0) * exp(-abs(wave) * 9.0);\n' +
    '    float life = exp(-age * 2.1);\n' +
    '    float fall = exp(-dist * 2.6);\n' +
    '    float amp = r.w * life * fall;\n' +
    '    disp += (dist > 0.0001 ? d / dist : vec2(0.0)) * ring * amp;\n' +
    '    crest += ring * amp;\n' +
    '  }\n' +
    '  disp *= uAmount;\n' +
    '  vec2 uv = cov(vUv + disp, uCov0);\n' +
    '  vec3 col = mono(texture(uTex0, uv).rgb, uMono);\n' +
    // блик на гребне — вода отдаёт свет
    '  col += clamp(crest, -1.0, 1.0) * 0.22 * (0.4 + 0.6 * col);\n' +
    // единственный кримзон на всём слое — и только на интеракции
    '  float hot = clamp(abs(crest) * 3.2, 0.0, 1.0);\n' +
    '  col = mix(col, mix(col, ROSSO, 0.5), hot * uRipAccent);\n' +
    '  col = rglFinish(col, vUv, gl_FragCoord.xy);\n' +
    '  oCol = vec4(col, 1.0);\n' +
    '}\n';

  /* ---------- 9. ЗЕРНО И АНТИБАНДИНГ (общий хвост всех режимов) ----------
     Два приёма из разведки:
     1) синий шум с покадровым смещением — вместо плёночного оверлея.
        Дитеринг делается ДО квантования в 8 бит, амплитуда ~1.5/255:
        полосы в почти-чёрных градиентах рассыпаются в невидимую крупу.
        Пока плитка не посчитана, работает interleaved-gradient noise —
        спектрально близкий заменитель, ноль веса, ноль ассетов.
     2) диагональное умножение mix(0.8, 1.0, (uv.x+uv.y)*0.5) вместо
        радиальной виньетки: левый низ 80%, правый верх 100%. */

  SH.grain =
    // процедурный дизер-шум (fallback и «подмешка» к плитке)
    'float ign(vec2 p){\n' +
    '  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));\n' +
    '}\n' +
    'float dither(vec2 frag){\n' +
    '  if(uHasNoise > 0.5){\n' +
    '    return texture(uNoise, (frag + uNoiseOff) / 64.0).r;\n' +
    '  }\n' +
    '  return ign(frag + uNoiseOff);\n' +
    '}\n' +
    'vec3 rglFinish(vec3 c, vec2 uv, vec2 frag){\n' +
    // диагональный градиент вместо виньетки
    '  float g = mix(0.8, 1.0, (uv.x + uv.y) * 0.5);\n' +
    '  c *= mix(1.0, g, uGradA);\n' +
    // зерно: сильнее в тенях, где бандинг и живёт
    '  float d = dither(frag) - 0.5;\n' +
    '  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));\n' +
    '  float shadow = 1.0 - smoothstep(0.0, 0.34, lum);\n' +
    '  c += d * uGrain * (1.0 + shadow * 2.2);\n' +
    '  return c;\n' +
    '}\n';

  /* Сборка фрагментного шейдера режима. */
  function fragFor(mode) {
    return SH.head + SH.grain + (SH[mode] || SH.reveal);
  }

  /* ---------- 10. ЭЛЕМЕНТ СЛОЯ ---------- */

  var items = [];
  var liveContexts = 0;
  var dprMult = 1;

  function Item(img) {
    this.img = img;
    this.mode = attr(img, 'data-gl', 'reveal');
    if (this.mode !== 'reveal' && this.mode !== 'displace' && this.mode !== 'ripple') {
      this.mode = 'reveal';
    }
    this.host = img.parentElement || document.body;
    /* <picture class="pic"> с display:contents — коробки нет, прямоугольник
       нулевой; канвас должен жить в первом предке с настоящей коробкой. */
    while (this.host && this.host !== document.body &&
           getComputedStyle(this.host).display === 'contents') {
      this.host = this.host.parentElement;
    }
    this.canvas = null;
    this.gl = null;
    this.ready = false;
    this.failed = false;
    this.visible = false;
    this.lastSeen = 0;
    this.w = 0; this.h = 0;
    this.progress = this.mode === 'reveal' ? 0 : 0;
    this.time = 0;
    this.frame = 0;

    /* Настройки из атрибутов */
    this.mono = num(img, 'data-gl-mono', 0);
    this.grain = num(img, 'data-gl-grain', this.mode === 'reveal' ? 0.012 : 0.010);
    this.gradA = num(img, 'data-gl-gradient', 0.55);
    this.revealStart = num(img, 'data-gl-start', 0.92);   // доля высоты окна
    this.revealEnd = num(img, 'data-gl-end', 0.42);
    this.once = attr(img, 'data-gl-once', '1') !== '0';
    this.amount = num(img, 'data-gl-amount',
      this.mode === 'displace' ? 0.09 : (this.mode === 'ripple' ? 0.030 : 0.5));
    this.accent = num(img, 'data-gl-accent', 0.30);

    /* displace: список кадров */
    this.srcs = [img.currentSrc || img.src];
    var extra = attr(img, 'data-gl-src', '');
    if (extra) {
      extra.split(',').forEach(function (s) {
        s = s.trim(); if (s) this.srcs.push(s);
      }, this);
    }
    this.slot = 0;             // индекс текущего кадра A
    this.texs = [];            // загруженные текстуры по индексу src
    this.imgs = [];            // HTMLImageElement по индексу
    this.aspect = [];          // пропорции по индексу
    this.transition = null;    // {from,to,t0,dur}
    this.interval = num(img, 'data-gl-interval', this.srcs.length > 1 ? 5200 : 0);
    this.dur = num(img, 'data-gl-dur', 1400);
    this.nextAt = 0;
    this.trigger = attr(img, 'data-gl-on', 'auto');   // auto | hover | api

    /* ripple: кольцевой буфер источников */
    this.rip = new Float32Array(32);   // 8 × vec4
    this.ripHead = 0;
    this.lastSpawn = 0;

    this.uni = {};
  }

  Item.prototype.uloc = function (name) {
    if (!(name in this.uni)) this.uni[name] = this.gl.getUniformLocation(this.prog, name);
    return this.uni[name];
  };

  /* Загрузка одной картинки по индексу; возвращает промис-подобный колбэк. */
  Item.prototype.load = function (i, cb) {
    var self = this;
    if (this.imgs[i]) { cb(this.imgs[i]); return; }
    var src = this.srcs[i];
    var el;
    // нулевой кадр — сама <img>, если уже загружена
    if (i === 0 && this.img.complete && this.img.naturalWidth) {
      el = this.img;
      this.imgs[0] = el;
      this.aspect[0] = el.naturalWidth / el.naturalHeight;
      cb(el); return;
    }
    el = new Image();
    el.decoding = 'async';
    if (this.img.crossOrigin) el.crossOrigin = this.img.crossOrigin;
    el.onload = function () {
      self.imgs[i] = el;
      self.aspect[i] = el.naturalWidth / Math.max(el.naturalHeight, 1);
      cb(el);
    };
    el.onerror = function () { cb(null); };
    el.src = src;
  };

  /* Ленивый подъём контекста — только когда элемент реально нужен. */
  Item.prototype.init = function () {
    if (this.ready || this.failed || this.starting) return;
    if (liveContexts >= CFG.maxContexts && !reclaim()) return;
    this.starting = true;
    var self = this;

    this.load(0, function (im0) {
      if (!im0) { self.fail(); return; }
      var need = self.mode === 'displace' && self.srcs.length > 1 ? 1 : -1;
      if (need > 0) self.load(1, function () { self.boot(); });
      else self.boot();
    });
  };

  Item.prototype.fail = function () {
    this.failed = true; this.starting = false;
    this.img.classList.remove('rgl-on');
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
  };

  Item.prototype.boot = function () {
    var self = this;
    var cv = document.createElement('canvas');
    cv.className = 'rgl-canvas' + (this.mode === 'ripple' ? ' rgl-interactive' : '');
    cv.setAttribute('aria-hidden', 'true');
    var gl = getContext(cv);
    if (!gl) { this.fail(); return; }

    this.canvas = cv; this.gl = gl;
    this.prog = program(gl, SH.vert, fragFor(this.mode));
    if (!this.prog) { this.fail(); return; }

    /* Ждём линковку, не блокируя кадр. starting остаётся true — повторный
       init() не пройдёт; <img> видна, пока программа не готова. */
    var poll = function () {
      if (self.failed || !self.gl) return;
      if (!programDone(self.gl, self.prog)) { requestAnimationFrame(poll); return; }
      if (!programOk(self.gl, self.prog)) { self.prog = null; self.fail(); return; }
      self.bootFinish();
    };
    poll();
  };

  Item.prototype.bootFinish = function () {
    var self = this, gl = this.gl, cv = this.canvas;
    this.geo = quad(gl);

    /* Текстуры кадров */
    this.texs[0] = texFromImage(gl, this.imgs[0]);
    if (this.imgs[1]) this.texs[1] = texFromImage(gl, this.imgs[1]);
    if (!this.texs[0]) { this.fail(); return; }

    /* Плитка синего шума — общая логика, своя текстура на контекст */
    this.noiseTex = null;
    ensureNoise(function (tile) {
      if (!tile || !self.gl || self.failed) return;
      try { self.noiseTex = texFromNoise(self.gl, tile, CFG.noiseSize); } catch (e) { self.noiseTex = null; }
    });

    /* Хост должен быть позиционирован, иначе канвас улетит по странице.
       Если он static — ставим relative: единственная правка чужого DOM. */
    var pos = window.getComputedStyle(this.host).position;
    if (pos === 'static') this.host.style.position = 'relative';
    this.host.insertBefore(cv, this.img.nextSibling);

    cv.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); self.fail(); liveContexts--;
    }, false);

    gl.clearColor(0, 0, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    liveContexts++;
    this.starting = false;
    this.ready = true;
    this.resize(true);
    if (this.mode === 'ripple') bindPointer(this);
    if (this.trigger === 'hover' && this.srcs.length > 1) bindHover(this);
    if (this.interval > 0 && this.trigger === 'auto') this.nextAt = now() + this.interval / 1000;
    /* Первый кадр считаем по фактической геометрии: даже если следующий
       rAF по какой-то причине не придёт, на экране будет верное состояние. */
    tick(this, now(), 0);
    this.render(0);
    this.img.classList.add('rgl-on');
    start();
  };

  Item.prototype.dispose = function () {
    if (!this.ready) return;
    var gl = this.gl;
    try {
      gl.deleteProgram(this.prog);
      gl.deleteBuffer(this.geo.buf);
      gl.deleteVertexArray(this.geo.vao);
      this.texs.forEach(function (t) { if (t) gl.deleteTexture(t); });
      if (this.noiseTex) gl.deleteTexture(this.noiseTex);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) {}
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null; this.gl = null; this.texs = []; this.uni = {};
    this.ready = false; this.starting = false;
    this.drawnAt = undefined; this.drawnP = undefined;   /* после подъёма заново — первый кадр сразу */
    this.img.classList.remove('rgl-on');
    liveContexts--;
  };

  /* Освободить контекст у самого давно невидимого элемента. */
  function reclaim() {
    var victim = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.ready || it.visible) continue;
      if (!victim || it.lastSeen < victim.lastSeen) victim = it;
    }
    if (victim) { victim.dispose(); return true; }
    return false;
  }

  Item.prototype.resize = function (force, redraw) {
    if (!this.ready) return;
    var r = this.img.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    var d = baseDpr() * dprMult;
    var pw = Math.max(1, Math.round(w * d));
    var ph = Math.max(1, Math.round(h * d));
    if (!force && pw === this.canvas.width && ph === this.canvas.height) return;
    this.canvas.width = pw; this.canvas.height = ph;
    this.w = pw; this.h = ph;
    this.boxAspect = w / h;
    this.pos = objPos(this.img);   /* object-position живёт в CSS и меняется с медиазапросом */
    this.gl.viewport(0, 0, pw, ph);
    /* Смена размера очищает буфер. Если не перерисовать сразу, до следующего
       кадра на месте картинки будет дыра (исходная <img> уже скрыта). */
    if (redraw) this.render(0);
  };

  /* object-fit: cover в UV. */
  Item.prototype.cover = function (i) {
    var ia = this.aspect[i] || this.boxAspect || 1;
    var ba = this.boxAspect || 1;
    return ba > ia ? [1, ia / ba] : [ba / ia, 1];
  };

  Item.prototype.render = function (dt) {
    if (!this.ready) return;
    var gl = this.gl;
    this.time += dt;
    this.frame++;
    this.resize(false);

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.geo.vao);

    gl.uniform2f(this.uloc('uRes'), this.w, this.h);
    gl.uniform1f(this.uloc('uTime'), this.time);
    gl.uniform1f(this.uloc('uProgress'), this.progress);
    gl.uniform1f(this.uloc('uMono'), this.mono);
    gl.uniform1f(this.uloc('uAmount'), this.amount);
    gl.uniform1f(this.uloc('uGrain'), this.grain);
    gl.uniform1f(this.uloc('uGradA'), this.gradA);

    /* Синий шум: покадровое смещение по золотому сечению —
       крупа не «стоит» на месте и не бьётся с движением кадра. */
    gl.uniform1f(this.uloc('uHasNoise'), this.noiseTex ? 1 : 0);
    gl.uniform2f(this.uloc('uNoiseOff'),
      (this.frame * 37.0) % 64.0, (this.frame * 17.0) % 64.0);
    if (this.noiseTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      gl.uniform1i(this.uloc('uNoise'), 2);
    }

    var a = this.transition ? this.transition.from : this.slot;
    var b = this.transition ? this.transition.to : this.slot;
    var c0 = this.cover(a), c1 = this.cover(b);
    gl.uniform2f(this.uloc('uCov0'), c0[0], c0[1]);
    gl.uniform2f(this.uloc('uCov1'), c1[0], c1[1]);
    gl.uniform2f(this.uloc('uPos'), this.pos ? this.pos[0] : 0.5, this.pos ? this.pos[1] : 0.5);

    /* Видео-подача (RossoGL.feed): пока петля играет, каждый кадр уходит в
       текстуру слота 0 — тот же шейдер, то же зерно и градиент, что у постера.
       Первый кадр петли = постер, поэтому переключение невидимо. */
    var v = this.video;
    if (v && v.readyState >= 2 && !v.paused && !v.ended && this.texs[0]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texs[0]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        if (v.videoWidth) this.aspect[0] = v.videoWidth / v.videoHeight;
        this.videoFed = true;
      } catch (e) { this.video = null; }
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texs[a] || this.texs[0]);
    gl.uniform1i(this.uloc('uTex0'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texs[b] || this.texs[a] || this.texs[0]);
    gl.uniform1i(this.uloc('uTex1'), 1);

    if (this.mode === 'ripple') {
      /* возраст источников тикает на CPU — в шейдер уходит готовый вектор */
      for (var i = 0; i < 8; i++) {
        if (this.rip[i * 4 + 3] > 0.001) {
          this.rip[i * 4 + 2] += dt;
          if (this.rip[i * 4 + 2] > 3.2) this.rip[i * 4 + 3] = 0;
        }
      }
      gl.uniform4fv(this.uloc('uRip[0]'), this.rip);
      gl.uniform1f(this.uloc('uRipAccent'), this.accent);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  /* ---------- 11. УКАЗАТЕЛЬ ДЛЯ RIPPLE ---------- */

  var COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  Item.prototype.spawn = function (x, y, force) {
    var i = this.ripHead % 8;
    this.rip[i * 4] = x;
    this.rip[i * 4 + 1] = y;
    this.rip[i * 4 + 2] = 0;
    this.rip[i * 4 + 3] = force;
    this.ripHead++;
  };

  function bindPointer(it) {
    var cv = it.canvas;
    function local(ev) {
      var r = cv.getBoundingClientRect();
      return [
        (ev.clientX - r.left) / Math.max(r.width, 1),
        1 - (ev.clientY - r.top) / Math.max(r.height, 1)
      ];
    }
    if (COARSE) {
      /* тач: рябь по тапу и слабее — палец и так закрывает половину кадра */
      cv.addEventListener('pointerdown', function (ev) {
        var p = local(ev);
        it.spawn(p[0], p[1], 0.65);
      }, { passive: true });
    } else {
      cv.addEventListener('pointermove', function (ev) {
        var t = now();
        /* троттлинг как в разведке: не чаще ~15 мс */
        if (t - it.lastSpawn < 0.045) return;
        it.lastSpawn = t;
        var p = local(ev);
        it.spawn(p[0], p[1], 1.0);
      }, { passive: true });
      cv.addEventListener('pointerdown', function (ev) {
        var p = local(ev);
        it.spawn(p[0], p[1], 1.6);
      }, { passive: true });
    }
  }

  /* Листание кадров по наведению: data-gl-on="hover".
     Слушаем РОДИТЕЛЯ, а не канвас: у displace канвас сквозной
     (pointer-events:none), до него события не доходят.
     Слушатель ставится один раз и переживает освобождение контекста —
     goTo() сам отсекает вызовы, пока слой не поднят. */
  function bindHover(it) {
    if (it.hoverBound) return;
    var host = it.host || it.img.parentNode;
    if (!host) return;
    it.hoverBound = true;
    /* На тач-устройствах наведения нет — там кадр листается по касанию. */
    host.addEventListener(COARSE ? 'pointerdown' : 'pointerenter', function () {
      if (it.ready && !it.transition && it.srcs.length > 1) it.next();
    }, { passive: true });
  }

  /* ---------- 12. СМЕНА КАДРОВ ДЛЯ DISPLACE ---------- */

  Item.prototype.goTo = function (idx) {
    if (this.transition || !this.ready) return;
    if (idx === this.slot) return;
    var self = this;
    this.load(idx, function (im) {
      if (!im || !self.gl) return;
      if (!self.texs[idx]) self.texs[idx] = texFromImage(self.gl, im);
      self.transition = { from: self.slot, to: idx, t0: now(), dur: self.dur / 1000 };
    });
  };

  Item.prototype.next = function () {
    this.goTo((this.slot + 1) % this.srcs.length);
  };

  /* ---------- 13. ПЛАНИРОВЩИК ---------- */

  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  function now() {
    return (((window.performance && performance.now) ? performance.now() : Date.now()) - t0) / 1000;
  }

  var running = false, lastT = 0, rafId = 0;
  var fpsFrames = 0, fpsStart = 0, started = 0, degrades = 0;

  function anyVisible() {
    for (var i = 0; i < items.length; i++) if (items[i].visible) return true;
    return false;
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    lastT = now();
    fpsFrames = 0; fpsStart = lastT;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function loop() {
    if (!running) return;
    var t = now();
    var dt = Math.min(t - lastT, 0.05);
    lastT = t;

    var busy = false, i, it;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (!it.visible) continue;
      busy = true;
      if (!it.ready) { it.init(); continue; }
      it.lastSeen = t;
      tick(it, t, dt);
      /* Рисуем не каждый кадр. Пока прогресс меняется, идёт переход кадров
         или живут волны — каждый; в покое — каждый ~66 мс, чтобы дымка по
         uTime продолжала плыть, а стоимость контекста упала вчетверо.
         Раньше два контекста на главной перерисовывались 60 раз в секунду
         впустую — p95 66 мс при видео на паузе. */
      if (needsDraw(it, t)) {
        it.render(it.drawnAt === undefined ? dt : Math.min(t - it.drawnAt, 0.1));
        it.drawnAt = t; it.drawnP = it.progress;
      }
    }

    /* Адаптивный DPR: прогрев, потом оценка каждые CFG.sampleEvery. */
    fpsFrames++;
    var span = (t - fpsStart) * 1000;
    if (t * 1000 > CFG.warmup && span > CFG.sampleEvery && fpsFrames >= CFG.minSamples) {
      var fps = fpsFrames / (span / 1000);
      if (fps < CFG.fpsFloor && dprMult > CFG.dprFloor) {
        dprMult = Math.max(CFG.dprFloor, dprMult - 0.1);
        degrades++;
        for (i = 0; i < items.length; i++) if (items[i].ready) items[i].resize(true, true);
      }
      fpsFrames = 0; fpsStart = t;
    }

    if (!busy) { stop(); return; }
    rafId = requestAnimationFrame(loop);
  }

  /* Нужен ли этому элементу настоящий кадр прямо сейчас. */
  function needsDraw(it, t) {
    if (it.drawnAt === undefined) return true;                 /* первый кадр */
    if (it.video && !it.video.paused && !it.video.ended) return true; /* петля играет */
    if (it.mode === 'displace' && it.transition) return true;  /* идёт смена кадра */
    if (it.mode === 'ripple' && (t - it.lastSpawn) < 4) return true; /* волны ещё живут */
    if (it.progress !== it.drawnP) return true;                /* проявление движется */
    return (t - it.drawnAt) > 0.066;                           /* покой: ~15 кадров/с ради дымки */
  }

  /* Покадровая логика режима. */
  function tick(it, t, dt) {
    if (it.mode === 'reveal') {
      /* Ручной режим: прогресс задаёт внешний таймлайн (RossoGL.drive),
         а не положение на экране. Нужен герою: он стоит на самом верху,
         и прокруткой ему проявляться не с чего — а по времени, с мягкой
         зернистой кромкой шейдера, вместо жёсткой шторки clip-path. */
      if (it.driven != null) { it.progress = clamp(it.driven, 0, 1); return; }
      if (it.once && it.progress >= 1) return;
      var r = it.img.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var top = r.top / vh;
      var raw = (it.revealStart - top) / Math.max(it.revealStart - it.revealEnd, 0.001);
      var p = easeOut(clamp(raw, 0, 1));
      it.progress = it.once ? Math.max(it.progress, p) : p;
      return;
    }
    if (it.mode === 'displace') {
      if (it.transition) {
        var k = (t - it.transition.t0) / it.transition.dur;
        it.progress = easeInOut(clamp(k, 0, 1));
        if (k >= 1) {
          it.slot = it.transition.to;
          it.transition = null;
          it.progress = 0;
          if (it.interval > 0 && it.trigger === 'auto') it.nextAt = t + it.interval / 1000;
        }
      } else if (it.trigger === 'auto' && it.interval > 0 && t >= it.nextAt && it.srcs.length > 1) {
        it.next();
      }
    }
  }

  /* ---------- 14. ВИДИМОСТЬ ---------- */

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var el = entries[i].target;
      var it = el.__rgl;
      if (!it) continue;
      it.visible = entries[i].isIntersecting;
      if (it.visible) {
        it.lastSeen = now();
        /* Контекст поднимаем сразу на пересечении, а не ждём кадра rAF:
           первый кадр слоя должен совпасть с появлением элемента. */
        if (!it.ready) it.init();
        start();
      }
    }
    if (!anyVisible()) stop();
  }, { rootMargin: CFG.rootMargin, threshold: 0 });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (anyVisible()) start();
  });

  var ro = window.ResizeObserver ? new ResizeObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var it = entries[i].target.__rgl;
      if (it && it.ready) it.resize(true, true);
    }
    if (anyVisible()) start();
  }) : null;

  if (!ro) {
    window.addEventListener('resize', function () {
      for (var i = 0; i < items.length; i++) if (items[i].ready) items[i].resize(true, true);
      if (anyVisible()) start();
    });
  }

  /* ---------- 15. СКАНИРОВАНИЕ DOM ---------- */

  function attach(el) {
    if (el.__rgl) return el.__rgl;
    if (el.tagName !== 'IMG') return null;      /* слой работает по <img> */
    var it = new Item(el);
    el.__rgl = it;
    items.push(it);
    io.observe(el);
    if (ro) ro.observe(el);
    return it;
  }

  function scan(root) {
    var list = (root || document).querySelectorAll('img[data-gl]');
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  /* Проверочный контекст: если WebGL2 в системе не поднимается вовсе —
     не трогаем ни одной картинки, страница остаётся как была. */
  function probe() {
    var c = document.createElement('canvas');
    var g = getContext(c);
    if (!g) return false;
    var lose = g.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  }

  function boot() {
    if (!probe()) return;
    scan(document);
    if (!items.length) return;
    /* Новые картинки (галереи, подгрузка) подхватываются сами. */
    if (window.MutationObserver) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var nodes = muts[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'IMG' && n.hasAttribute('data-gl')) attach(n);
            else if (n.querySelectorAll) scan(n);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ---------- 16. ПУБЛИЧНЫЙ API ---------- */

  window.RossoGL = {
    /* Пересканировать DOM (после своей вставки разметки). */
    refresh: function (root) { scan(root); },
    /* Следующий кадр у displace-элемента: RossoGL.next(el) или по селектору. */
    next: function (target) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el && el.__rgl) el.__rgl.next();
    },
    goTo: function (target, i) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el && el.__rgl) el.__rgl.goTo(i);
    },
    /* Выключить слой на элементе — картинка возвращается. */
    off: function (target) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el && el.__rgl) el.__rgl.dispose();
    },
    /* Ручной прогресс проявления 0…1 для режима reveal: внешний таймлайн
       ведёт шейдер по времени (герой на самом верху страницы прокруткой
       не проявляется). Возвращает true, если элемент уже поднят и принял
       значение; false — слой ещё не готов (звать снова следующим кадром). */
    drive: function (target, p) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el || !el.__rgl) return false;
      var it = el.__rgl;
      it.driven = p;
      if (!it.ready) { if (!it.starting && !it.failed) it.init(); return false; }
      start();
      return true;
    },
    /* Подать видео в слот 0: слой рисует петлю вместо постера через тот же
       шейдер. Возвращает true, если слой поднят и принял видео. */
    feed: function (target, video) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el || !el.__rgl || !video) return false;
      var it = el.__rgl;
      if (!it.ready || it.failed) return false;
      it.video = video;
      start();
      return true;
    },
    unfeed: function (target) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el && el.__rgl) { el.__rgl.video = null; }
    },
    /* Вернуть проявление под управление прокрутки. */
    release: function (target) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el && el.__rgl) el.__rgl.driven = null;
    },
    /* Диагностика: сколько живых контекстов, как просел DPR. */
    stats: function () {
      return {
        items: items.length,
        contexts: liveContexts,
        dpr: +(baseDpr() * dprMult).toFixed(3),
        dprMult: +dprMult.toFixed(2),
        degrades: degrades,
        blueNoise: !!noiseTile,
        running: running
      };
    }
  };

})();
