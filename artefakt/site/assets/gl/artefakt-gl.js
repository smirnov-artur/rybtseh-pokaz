/* ============================================================================
   artefakt-gl.js — WebGL2-слой концепта «Артефакт» (Рыбцехъ Клевцова)
   Ванильный JS, без сборки и без зависимостей. Свой код.
   Приёмы взяты из разведки igloo.inc (материализация из тьмы, двухслойность,
   синий шум, диагональное умножение, зажатый DPR) и переписаны с нуля.
   Публичный API: window.ArtefaktGL
   ========================================================================== */
var ArtefaktGL = (typeof ArtefaktGL === 'object' && ArtefaktGL) || {};
window.ArtefaktGL = ArtefaktGL;

ArtefaktGL.CFG = {
  dark:  [0x10/255, 0x09/255, 0x04/255],   /* --walnut #100904  тёплая тьма   */
  cream: [0xff/255, 0xed/255, 0xd7/255],   /* --cream  #ffedd7  блики, контур */
  ember: [0xdc/255, 0x50/255, 0x00/255],   /* --ember  #dc5000  метки, пыль   */
  grad:      0.62,   /* сила диагонального умножения вместо виньетки          */
  grain:     2.4,    /* амплитуда синего шума в тёмных зонах, 1/255           */
  noiseTile: 64,     /* сторона плитки синего шума                            */
  fpsFloor:  30,     /* ниже — снижаем DPR                                    */
  dprFloor:  0.6,
  warmupMs:  2000,
  evalMs:    4000,
  maxLive:   6       /* сколько инстансов одновременно держим анимированными  */
};

ArtefaktGL.support = function(){
  if (ArtefaktGL._sup !== undefined) return ArtefaktGL._sup;
  var ok = false;
  try {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ok = false;
    else {
      var c = document.createElement('canvas');
      var g = c.getContext('webgl2', {alpha:true, antialias:false, depth:false, stencil:false});
      ok = !!g;
      if (g && g.getExtension) g.getExtension('WEBGL_lose_context') && g.getExtension('WEBGL_lose_context').loseContext();
    }
  } catch(e){ ok = false; }
  return (ArtefaktGL._sup = ok);
};

/* базовый DPR по рецепту разведки: жёстко зажат */
ArtefaktGL.baseDpr = function(){
  var d = window.devicePixelRatio || 1;
  return d <= 2 ? Math.min(d, 1.15) : Math.min(d, 1.5);
};

ArtefaktGL.clamp  = function(v,a,b){ return v<a?a:(v>b?b:v); };
ArtefaktGL.fit    = function(v,a,b,c,d){ return ArtefaktGL.clamp((v-a)/(b-a||1),0,1)*(d-c)+c; };
/* заменители кривых GSAP из разведки, без библиотеки */
ArtefaktGL.ease = {
  power3InOut: function(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; },
  power2Out:   function(t){ return 1-(1-t)*(1-t); },
  sineInOut:   function(t){ return -(Math.cos(Math.PI*t)-1)/2; },
  /* «entry_ease_2»: быстрый вход, длинный выкат */
  entry2:      function(t){ return 1-Math.pow(1-t, 2.6); }
};

/* ---------------------------------------------------------------------------
   1. Синий шум. Плитка 64×64 генерируется своим кодом (метод минимизации
   энергии перестановками, Georgiev/Fajardo): стартуем со случайной
   перестановки 0..N-1, меняем пары местами, если локальная энергия падает.
   Бюджет времени жёсткий — что успели, то и берём: даже частично
   отрелаксированная плитка бьёт белый шум по бандингу.
   ------------------------------------------------------------------------- */
ArtefaktGL.blueNoise = function(N, budgetMs){
  N = N || 64; budgetMs = budgetMs || 22;
  var n2 = N*N, v = new Float32Array(n2), i, j, t;
  for (i=0;i<n2;i++) v[i] = i/(n2-1);
  for (i=n2-1;i>0;i--){ j=(Math.random()*(i+1))|0; t=v[i]; v[i]=v[j]; v[j]=t; }

  var R = 3, sig2 = 2.1*2.1, sigV = 1.0;
  function energyAt(x,y,val){
    var e=0, dx,dy,xx,yy,d2,dv;
    for (dy=-R; dy<=R; dy++) for (dx=-R; dx<=R; dx++){
      if (!dx && !dy) continue;
      xx=(x+dx+N)%N; yy=(y+dy+N)%N; d2=dx*dx+dy*dy;
      dv = Math.abs(val - v[yy*N+xx]);
      e += Math.exp(-d2/sig2 - Math.sqrt(dv)/sigV);
    }
    return e;
  }
  var t0 = (performance||Date).now(), tries = 0;
  while (tries < 400000){
    if ((tries & 1023) === 0 && (performance||Date).now() - t0 > budgetMs) break;
    tries++;
    var a=(Math.random()*n2)|0, b=(Math.random()*n2)|0; if (a===b) continue;
    var ax=a%N, ay=(a/N)|0, bx=b%N, by=(b/N)|0;
    var before = energyAt(ax,ay,v[a]) + energyAt(bx,by,v[b]);
    var after  = energyAt(ax,ay,v[b]) + energyAt(bx,by,v[a]);
    if (after < before){ t=v[a]; v[a]=v[b]; v[b]=t; }
  }
  var out = new Uint8Array(n2);
  for (i=0;i<n2;i++) out[i] = Math.round(v[i]*255);
  return {size:N, data:out};
};

/* ---------------------------------------------------------------------------
   2. Общий рендерер. Один WebGL2-контекст на всю страницу: рисуем в скрытый
   холст по вьюпорту инстанса и копируем результат в 2D-холст элемента.
   Так не упираемся в лимит контекстов браузера (~16) и не платим за каждый.
   ------------------------------------------------------------------------- */
ArtefaktGL.R = null;

ArtefaktGL.createRenderer = function(){
  var cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  var gl = cv.getContext('webgl2', {
    alpha:true, antialias:false, depth:false, stencil:false,
    premultipliedAlpha:true, preserveDrawingBuffer:false,
    powerPreference:'high-performance'
  });
  if (!gl) return null;
  var R = {canvas:cv, gl:gl, w:16, h:16, progs:{}, quad:null, noiseTex:null, lost:false};

  cv.addEventListener('webglcontextlost', function(e){
    e.preventDefault(); R.lost = true; ArtefaktGL.degradeAll('context-lost');
  }, false);

  /* Компиляция и линковка — сотни миллисекунд на встроенной графике, а
     запросы COMPILE_STATUS / LINK_STATUS ждут их синхронно: профиль ловил
     дыру 583 мс на первом кадре опта. С KHR_parallel_shader_compile статусы
     не спрашиваем сразу: программа отдаётся «в ожидании», drawItem ждёт
     COMPLETION_STATUS_KHR из кадра в кадр и до готовности не рисует —
     секция остаётся тёмной, с чего материализация и начинается. */
  R.parallel = gl.getExtension('KHR_parallel_shader_compile');
  R.compile = function(type, src){
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!R.parallel && !gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.warn('[artefakt-gl] shader:', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  };
  R.program = function(name, vs, fs){
    if (R.progs[name]) return R.progs[name];
    var v = R.compile(gl.VERTEX_SHADER, vs), f = R.compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    var obj = {p:p, u:{}, pending: !!R.parallel, bad: false, sh: [v, f]};
    if (!R.parallel){
      gl.deleteShader(v); gl.deleteShader(f); obj.sh = null;
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
        console.warn('[artefakt-gl] link:', gl.getProgramInfoLog(p)); return null;
      }
    }
    obj.loc = function(n){
      if (!(n in obj.u)) obj.u[n] = gl.getUniformLocation(p, n);
      return obj.u[n];
    };
    R.progs[name] = obj; return obj;
  };
  /* true — программой можно пользоваться; false — ещё линкуется или сломана (obj.bad). */
  R.programReady = function(obj){
    if (!obj.pending) return !obj.bad;
    if (!gl.getProgramParameter(obj.p, R.parallel.COMPLETION_STATUS_KHR)) return false;
    obj.pending = false;
    if (!gl.getProgramParameter(obj.p, gl.LINK_STATUS)){
      obj.bad = true;
      console.warn('[artefakt-gl] link:', gl.getProgramInfoLog(obj.p),
        obj.sh ? gl.getShaderInfoLog(obj.sh[0]) + ' | ' + gl.getShaderInfoLog(obj.sh[1]) : '');
    }
    if (obj.sh){ gl.deleteShader(obj.sh[0]); gl.deleteShader(obj.sh[1]); obj.sh = null; }
    return !obj.bad;
  };
  R.getQuad = function(){
    if (R.quad) return R.quad;
    var vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return (R.quad = vao);
  };
  R.resize = function(w,h){
    w = Math.max(2, w|0); h = Math.max(2, h|0);
    if (w > R.w || h > R.h){
      R.w = Math.max(R.w, w); R.h = Math.max(R.h, h);
      cv.width = R.w; cv.height = R.h;
    }
  };
  R.texFromImage = function(img){
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    try { gl.generateMipmap(gl.TEXTURE_2D); }
    catch(e){ gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return t;
  };
  R.getNoise = function(){
    if (R.noiseTex) return R.noiseTex;
    var bn = ArtefaktGL.blueNoise(ArtefaktGL.CFG.noiseTile, 22);
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, bn.size, bn.size, 0, gl.RED, gl.UNSIGNED_BYTE, bn.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return (R.noiseTex = t);
  };
  return R;
};

/* ---------------------------------------------------------------------------
   3. Шейдеры. Собираются из кусков — так файл правится по частям.
   ------------------------------------------------------------------------- */
ArtefaktGL.glsl = {};

ArtefaktGL.glsl.quadVS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5 + 0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

ArtefaktGL.glsl.head = `#version 300 es
precision highp float;
in  vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;      // текущий кадр
uniform sampler2D uTexB;     // следующий кадр (displace)
uniform sampler2D uNoise;    // плитка синего шума
uniform vec2  uRes;          // размер холста в пикселях
uniform vec2  uCover;        // подгонка UV под object-fit:cover (A)
uniform vec2  uCoverB;       // то же для B
uniform vec2  uNoiseOff;     // покадровое смещение плитки
uniform float uNoisePhase;   // временной сдвиг значения (золотое сечение)
uniform float uTime;
uniform float uMat;          // 0..1 материализация тела
uniform float uOut;          // 0..1 проявление контура
uniform float uOutA;         // 0..1 яркость контура (гаснет в конце)
uniform float uDisp;         // 0..1 перетекание кадров
uniform float uMode;         // 0 — кадр, 1 — перетекание
uniform float uGrad;         // сила диагонального умножения
uniform float uGrain;        // амплитуда зерна (в единицах 1/255)
uniform vec3  uDark;
uniform vec3  uCream;

#define PI 3.14159265

vec2 coverUv(vec2 uv, vec2 c){ return (uv - 0.5)*c + 0.5; }

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* мягкая полоса сверху вниз: приём igloo — растушёвка в 2 «юнита» высоты */
float sweep(float yTop, float p, float feather){
  float edge = mix(-feather, 1.0 + feather, p);
  return 1.0 - smoothstep(edge - feather, edge, yTop);
}

float hash21(vec2 p){
  p = fract(p*vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x*p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i=0;i<3;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}`;

/* Собель прямо в шейдере: контур берём из самой текстуры, отдельной карты нет */
ArtefaktGL.glsl.sobel = `
float lumAt(vec2 uv, vec2 o){ return luma(texture(uTex, clamp(uv+o, vec2(0.001), vec2(0.999))).rgb); }
float sobel(vec2 uv, vec2 st){
  float tl=lumAt(uv,vec2(-st.x, st.y)), tc=lumAt(uv,vec2(0.0, st.y)), tr=lumAt(uv,vec2(st.x, st.y));
  float ml=lumAt(uv,vec2(-st.x, 0.0)),                                mr=lumAt(uv,vec2(st.x, 0.0));
  float bl=lumAt(uv,vec2(-st.x,-st.y)), bc=lumAt(uv,vec2(0.0,-st.y)), br=lumAt(uv,vec2(st.x,-st.y));
  float gx = tl + 2.0*ml + bl - tr - 2.0*mr - br;
  float gy = tl + 2.0*tc + tr - bl - 2.0*bc - br;
  return length(vec2(gx, gy));
}`;

ArtefaktGL.glsl.main = `
void main(){
  vec2 uvA = coverUv(vUv, uCover);
  vec3 col;

  if (uMode > 0.5){
    /* --- перетекание кадров по карте смещения, а не кроссфейд --- */
    vec2 uvB = coverUv(vUv, uCoverB);
    float n   = fbm(vUv*1.8 + vec2(uTime*0.02, -uTime*0.015));
    float ang = n*6.2831853;
    vec2  dir = vec2(cos(ang), sin(ang));
    float p   = clamp(uDisp, 0.0, 1.0);
    float amt = 0.038 * sin(p*PI);
    vec3 a = texture(uTex,  uvA + dir*amt*(0.35+0.9*n)).rgb;
    vec3 b = texture(uTexB, uvB - dir*amt*(0.35+0.9*n)).rgb;
    float th = clamp(smoothstep(0.0, 1.0, (p*1.5 - 0.25) + (n - 0.5)*0.42), 0.0, 1.0);
    col = mix(a, b, th);
    float front = 1.0 - abs(th*2.0 - 1.0);
    col += uCream * front * 0.045 * sin(p*PI);

  } else {
    /* --- материализация из тьмы: экспонат выступает, а не проявляется --- */
    vec3  img  = texture(uTex, uvA).rgb;
    float yTop = 1.0 - vUv.y;
    float m    = sweep(yTop, uMat, 0.34);
    col = mix(uDark, img, m);

    float edgePos = mix(-0.34, 1.34, uMat) - 0.17;
    float band    = exp(-pow((yTop - edgePos)/0.105, 2.0));
    float pulse   = smoothstep(0.0, 0.10, uMat) * smoothstep(1.0, 0.80, uMat);
    col += uCream * band * 0.17 * pulse;

    /* --- контур поверх: рисуется первым, гаснет последним --- */
    if (uOutA > 0.002){
      vec2  st = 1.0/uRes;
      float e1 = sobel(uvA, st*1.2);
      float e2 = sobel(uvA, st*3.0);
      float edge = smoothstep(0.14, 0.52, e1) + 0.40*smoothstep(0.12, 0.46, e2);
      edge = edge/(1.0 + edge);
      float om   = sweep(yTop, uOut, 0.30);
      float ob   = exp(-pow((yTop - (mix(-0.30,1.30,uOut) - 0.15))/0.09, 2.0));
      col += uCream * edge * om * uOutA * 0.55;
      col += uCream * edge * ob * uOutA * 0.42;
    }
  }

  /* диагональное умножение вместо радиальной виньетки */
  float g = mix(0.8, 1.0, (vUv.x + vUv.y)*0.5);
  col *= mix(1.0, g, uGrad);

  /* синий шум: сильнее в тенях — там и живёт бандинг */
  vec2  np  = (gl_FragCoord.xy + uNoiseOff) / ${ArtefaktGL.CFG.noiseTile}.0;
  float bn  = fract(texture(uNoise, np).r + uNoisePhase);
  float amp = (uGrain/255.0) * (0.70 + 1.30*(1.0 - smoothstep(0.0, 0.35, luma(col))));
  col += (bn - 0.5) * amp * 2.0;

  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

ArtefaktGL.glsl.quadFS = function(){
  return ArtefaktGL.glsl.head + ArtefaktGL.glsl.sobel + ArtefaktGL.glsl.main;
};

/* --- 4. Пыль в луче: GL_POINTS, аддитивно, поверх уже нарисованного кадра --- */
ArtefaktGL.glsl.dustVS = `#version 300 es
layout(location=0) in vec4 aSeed;   // x0, y0, размер/скорость, фаза
uniform float uTime;
uniform vec2  uMouse;               // курсор в UV кадра, y вверх
uniform float uMouseAmt;
uniform float uDpr;
uniform float uOpacity;
uniform float uBeamX;               // где ось луча по низу кадра
uniform float uBeamSkew;            // наклон луча
uniform float uBeamW;               // ширина луча
out float vBright;
out float vTone;
void main(){
  float sp = 0.25 + aSeed.z*0.75;
  float t  = uTime * 0.05 * sp;
  vec2  p;
  p.x = fract(aSeed.x + sin(t*1.7 + aSeed.w*6.2831)*0.035 + t*0.02);
  p.y = fract(aSeed.y - t*0.5);

  vec2  dm = p - uMouse;
  float md = length(dm);
  float f  = exp(-(md*md)/0.014);
  p += (dm/max(md, 1e-4)) * f * 0.035 * uMouseAmt;

  float axis = (p.x - uBeamX) + (1.0 - p.y)*uBeamSkew;
  float beam = exp(-pow(axis/uBeamW, 2.0));
  beam *= mix(0.30, 1.0, p.y);

  vBright = beam * uOpacity * (0.30 + 0.70*aSeed.w);
  vTone   = fract(aSeed.w*7.13);
  gl_PointSize = 18.0;
  gl_Position  = vec4(0.0, 0.0, 0.0, 1.0);
}`;

ArtefaktGL.glsl.dustFS = `#version 300 es
precision mediump float;
in  float vBright;
in  float vTone;
uniform vec3 uCream;
uniform vec3 uEmber;
out vec4 fragColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.03, d); a *= a;
  vec3  c = mix(uCream, mix(uCream, uEmber, 0.6), vTone*vTone);
  fragColor = vec4(c, a);
}`;

/* ---------------------------------------------------------------------------
   5. Инстанс: один кадр страницы под управлением слоя.
   ------------------------------------------------------------------------- */
ArtefaktGL.Item = function(el){
  var A = ArtefaktGL, CFG = A.CFG;
  var modes = (el.getAttribute('data-gl')||'').toLowerCase().split(/[\s,|]+/).filter(Boolean);
  var it = {
    el: el,
    modes: modes,
    has: function(m){ return modes.indexOf(m) >= 0; },
    img: null, host: null, canvas: null, ctx: null,
    tex: [], texA: 0, coverA: [1,1], coverB: [1,1],
    dust: null, dustN: 0,
    w: 0, h: 0, cw: 0, ch: 0,
    started: 0, done: false, visible: false, ready: false, dead: false,
    mouse: [0.5, 0.6], mouseAmt: 0, mouseTarget: 0,
    dispT: 0, dispRunning: false, nextAt: 0,
    frame: 0
  };

  it.img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (!it.img) return null;
  it.host = (el.tagName === 'IMG') ? el.parentElement : el;
  /* Картинки обёрнуты в <picture class="pic"> с display:contents — у такой
     обёртки нет коробки и нулевой прямоугольник, канвас получил бы 0×0.
     Поднимаемся до первого предка, у которого коробка есть. */
  while (it.host && it.host !== document.body &&
         getComputedStyle(it.host).display === 'contents') {
    it.host = it.host.parentElement;
  }
  if (!it.host) return null;

  it.dur = {
    mat:     parseFloat(el.getAttribute('data-gl-dur'))   || (it.has('outline') ? 2.25 : 1.9),
    matFrom: it.has('outline') ? 1.1 : 0,
    out:     2.5, outFadeFrom: 2.0, outFadeTo: 5.0,
    delay:   parseFloat(el.getAttribute('data-gl-delay')) || 0,
    disp:    parseFloat(el.getAttribute('data-gl-disp'))  || 1.6,
    every:   parseFloat(el.getAttribute('data-gl-every')) || 5.0
  };
  it.total = it.has('outline') ? it.dur.outFadeTo
           : it.has('displace') ? Infinity
           : it.has('dust')     ? Infinity
           : it.dur.mat;

  /* холст поверх кадра; исходный <img> остаётся в потоке ради alt и размеров */
  it.canvas = document.createElement('canvas');
  it.canvas.className = 'gl-canvas';
  it.canvas.setAttribute('aria-hidden', 'true');
  it.ctx = it.canvas.getContext('2d', {alpha:false, desynchronized:true});
  if (getComputedStyle(it.host).position === 'static') it.host.style.position = 'relative';
  it.host.appendChild(it.canvas);
  el.setAttribute('data-gl-state', 'boot');

  it.layout = function(dpr){
    var im = it.img, ho = it.host;
    var r = im.getBoundingClientRect(), hr = ho.getBoundingClientRect();
    var w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h) return false;
    var cs = getComputedStyle(im);
    it.canvas.style.left   = (r.left - hr.left) + 'px';
    it.canvas.style.top    = (r.top  - hr.top ) + 'px';
    it.canvas.style.width  = w + 'px';
    it.canvas.style.height = h + 'px';
    if (cs.borderRadius !== '0px') it.canvas.style.borderRadius = cs.borderRadius;
    var cw = Math.max(2, Math.round(w*dpr)), ch = Math.max(2, Math.round(h*dpr));
    if (cw !== it.cw || ch !== it.ch){
      it.cw = it.canvas.width = cw; it.ch = it.canvas.height = ch;
      it.dirty = true;
    }
    it.w = w; it.h = h;
    return true;
  };

  it.coverFor = function(tex){
    var ia = tex.w / tex.h, ca = (it.cw||1) / (it.ch||1);
    return ia > ca ? [ca/ia, 1] : [1, ia/ca];
  };
  return it;
};

/* --- загрузка кадров и буфер пыли --- */
ArtefaktGL.loadItem = function(it, done){
  var A = ArtefaktGL, R = A.R;
  var srcs = [it.img.currentSrc || it.img.src];
  var extra = it.el.getAttribute('data-gl-frames');
  if (extra) extra.split(/[|,]/).forEach(function(s){ s = s.trim(); if (s) srcs.push(s); });
  if (it.has('displace') && srcs.length < 2) it.modes.splice(it.modes.indexOf('displace'), 1);

  var left = srcs.length, failed = false;
  srcs.forEach(function(src, i){
    var im = new Image();
    im.decoding = 'async';
    if (/^https?:/i.test(src) && src.indexOf(location.origin) !== 0) im.crossOrigin = 'anonymous';
    im.onload = function(){
      try {
        it.tex[i] = {t: R.texFromImage(im), w: im.naturalWidth || im.width, h: im.naturalHeight || im.height};
      } catch(e){ failed = true; }
      if (--left === 0) done(!failed && !!it.tex[0]);
    };
    im.onerror = function(){ failed = true; if (--left === 0) done(false); };
    im.src = src;
  });
};

ArtefaktGL.makeDust = function(it){
  var A = ArtefaktGL, R = A.R, gl = R.gl;
  var n = parseInt(it.el.getAttribute('data-gl-dust'), 10);
  if (!n || n < 1) n = 220;
  n = Math.min(n, 900);
  var data = new Float32Array(n*4);
  for (var i=0;i<n;i++){
    data[i*4+0] = Math.random();
    data[i*4+1] = Math.random();
    data[i*4+2] = Math.pow(Math.random(), 1.6);
    data[i*4+3] = Math.random();
  }
  var vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  it.dust = vao; it.dustN = n;
  it.beam = [
    parseFloat(it.el.getAttribute('data-gl-beam-x'))    || 0.58,
    parseFloat(it.el.getAttribute('data-gl-beam-skew')) || 0.28,
    parseFloat(it.el.getAttribute('data-gl-beam-w'))    || 0.30
  ];
};

/* ---------------------------------------------------------------------------
   6. Тайминги и отрисовка одного инстанса.
   Раскладка контура и тела — из тайминга интро igloo:
   контур 2.5 с, тело с задержкой 1.1 с за 2.25 с, контур гаснет к 5 с.
   ------------------------------------------------------------------------- */
ArtefaktGL.timeline = function(it, tSec){
  var A = ArtefaktGL, E = A.ease, D = it.dur;
  var t = Math.max(0, tSec - D.delay);
  var o = {mat: 1, out: 0, outA: 0};
  if (it.has('outline')){
    o.out  = E.power3InOut(A.clamp(t / D.out, 0, 1));
    o.mat  = E.entry2(A.clamp((t - D.matFrom) / D.mat, 0, 1));
    var fin  = A.clamp(t / 0.55, 0, 1);
    var fout = 1 - A.clamp((t - D.outFadeFrom) / (D.outFadeTo - D.outFadeFrom), 0, 1);
    o.outA = E.sineInOut(fin) * E.sineInOut(fout);
  } else if (it.has('materialize')){
    o.mat = E.entry2(A.clamp(t / D.mat, 0, 1));
  }
  return o;
};

ArtefaktGL.drawItem = function(it, now, dpr){
  var A = ArtefaktGL, CFG = A.CFG, R = A.R, gl = R.gl;
  if (!it.ready || it.dead || !it.cw) return;

  var prog = R.program('quad', A.glsl.quadVS, A.glsl.quadFS());
  if (!prog){ A.degrade(it, 'no-program'); return; }
  if (!R.programReady(prog)){
    if (prog.bad) A.degrade(it, 'no-program');
    return;                     /* линкуется в фоне — этот кадр пропускаем */
  }
  /* Отсчёт материализации — с первого настоящего кадра, а не с момента
     готовности текстур: иначе ожидание линковки съедало бы начало. */
  if (!it.live) it.started = now;
  var tSec = (now - it.started) / 1000;
  var tl = A.timeline(it, tSec);

  R.resize(it.cw, it.ch);

  gl.viewport(0, 0, it.cw, it.ch);
  gl.disable(gl.BLEND);
  gl.useProgram(prog.p);
  gl.bindVertexArray(R.getQuad());

  var a = it.tex[it.texA] || it.tex[0];
  var b = it.tex[(it.texA + 1) % it.tex.length] || a;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.t); gl.uniform1i(prog.loc('uTex'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.t); gl.uniform1i(prog.loc('uTexB'), 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.getNoise()); gl.uniform1i(prog.loc('uNoise'), 2);

  var ca = it.coverFor(a), cb = it.coverFor(b);
  gl.uniform2f(prog.loc('uRes'), it.cw, it.ch);
  gl.uniform2f(prog.loc('uCover'), ca[0], ca[1]);
  gl.uniform2f(prog.loc('uCoverB'), cb[0], cb[1]);
  gl.uniform2f(prog.loc('uNoiseOff'), (it.frame*37) % 64, (it.frame*59) % 64);
  gl.uniform1f(prog.loc('uNoisePhase'), (it.frame * 0.6180339887) % 1);
  gl.uniform1f(prog.loc('uTime'), tSec);
  gl.uniform1f(prog.loc('uMat'), tl.mat);
  gl.uniform1f(prog.loc('uOut'), tl.out);
  gl.uniform1f(prog.loc('uOutA'), tl.outA);
  gl.uniform1f(prog.loc('uDisp'), it.dispT);
  gl.uniform1f(prog.loc('uMode'), (it.has('displace') && it.dispRunning) ? 1 : 0);
  gl.uniform1f(prog.loc('uGrad'), CFG.grad);
  gl.uniform1f(prog.loc('uGrain'), CFG.grain);
  gl.uniform3fv(prog.loc('uDark'), CFG.dark);
  gl.uniform3fv(prog.loc('uCream'), CFG.cream);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (it.dust){
    var dp = R.program('dust', A.glsl.dustVS, A.glsl.dustFS);
    if (dp){
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(dp.p);
      gl.bindVertexArray(it.dust);
      gl.uniform1f(dp.loc('uTime'), (now - A.t0) / 1000);
      gl.uniform2f(dp.loc('uMouse'), it.mouse[0], it.mouse[1]);
      gl.uniform1f(dp.loc('uMouseAmt'), it.mouseAmt);
      gl.uniform1f(dp.loc('uDpr'), dpr);
      gl.uniform1f(dp.loc('uOpacity'), tl.mat);
      gl.uniform1f(dp.loc('uBeamX'), it.beam[0]);
      gl.uniform1f(dp.loc('uBeamSkew'), it.beam[1]);
      gl.uniform1f(dp.loc('uBeamW'), it.beam[2]);
      gl.drawArrays(gl.POINTS, 0, it.dustN);
      gl.disable(gl.BLEND);
    }
  }
  gl.bindVertexArray(null);
  gl.flush();

  it.ctx.drawImage(R.canvas, 0, R.h - it.ch, it.cw, it.ch, 0, 0, it.cw, it.ch);
  it.frame++;
  if (!it.live){ it.live = true; it.canvas.classList.add('is-live'); it.el.setAttribute('data-gl-state','on'); }
  if (it.total !== Infinity && tSec >= it.total + it.dur.delay) it.done = true;
};

/* ---------------------------------------------------------------------------
   7. Менеджер: наблюдатели, адаптивный DPR, единый цикл.
   ------------------------------------------------------------------------- */
ArtefaktGL.items = [];
ArtefaktGL.t0 = (window.performance || Date).now();
ArtefaktGL.dprMul = 1;
ArtefaktGL._fps = {samples: [], last: 0, nextEval: 0};

ArtefaktGL.dpr = function(){ return ArtefaktGL.baseDpr() * ArtefaktGL.dprMul; };

ArtefaktGL.degrade = function(it, why){
  if (!it || it.dead) return;
  it.dead = true;
  it.el.setAttribute('data-gl-state', 'off');
  if (it.canvas && it.canvas.parentNode) it.canvas.parentNode.removeChild(it.canvas);
  if (why) it.el.setAttribute('data-gl-why', why);
};
ArtefaktGL.degradeAll = function(why){
  ArtefaktGL.items.slice().forEach(function(it){ ArtefaktGL.degrade(it, why); });
  ArtefaktGL.items.length = 0;
};

ArtefaktGL.tick = function(now){
  var A = ArtefaktGL, CFG = A.CFG;
  A._raf = requestAnimationFrame(A.tick);
  if (document.hidden) return;                       /* пауза при скрытой вкладке */

  /* адаптивный DPR: прогрев 2 с, оценка каждые 4 с, пол 0.6 */
  var f = A._fps;
  if (f.last){
    var dt = now - f.last;
    if (dt > 0 && dt < 500) f.samples.push(1000/dt);
  }
  f.last = now;
  if (!f.nextEval) f.nextEval = now + CFG.warmupMs;
  else if (now > f.nextEval){
    if (f.samples.length >= 5){
      var s = 0; for (var i=0;i<f.samples.length;i++) s += f.samples[i];
      if (s/f.samples.length < CFG.fpsFloor && A.dprMul > CFG.dprFloor){
        A.dprMul = Math.max(CFG.dprFloor, A.dprMul - 0.1);
        A.items.forEach(function(it){ it.needLayout = true; });
      }
    }
    f.samples.length = 0; f.nextEval = now + CFG.evalMs;
  }

  var dpr = A.dpr(), live = 0;
  for (var k=0;k<A.items.length;k++){
    var it = A.items[k];
    if (it.dead || !it.ready || !it.visible) continue;
    if (it.done && !it.needLayout && !it.has('dust') && !it.has('displace')) continue;
    if (live >= CFG.maxLive) continue;
    if (it.needLayout){ it.layout(dpr); it.needLayout = false; it.done = false; }
    /* перетекание кадров по расписанию */
    if (it.has('displace') && it.tex.length > 1){
      if (!it.dispRunning && now >= it.nextAt){ it.dispRunning = true; it.dispStart = now; }
      if (it.dispRunning){
        var p = (now - it.dispStart) / (it.dur.disp*1000);
        it.dispT = A.ease.power3InOut(A.clamp(p, 0, 1));
        if (p >= 1){
          it.dispRunning = false; it.dispT = 0;
          it.texA = (it.texA + 1) % it.tex.length;
          it.nextAt = now + it.dur.every*1000;
        }
      }
    }
    it.mouseAmt += (it.mouseTarget - it.mouseAmt) * 0.06;
    A.drawItem(it, now, dpr);
    live++;
  }
};

ArtefaktGL.observe = function(it){
  var A = ArtefaktGL;
  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(e){
      var vis = e[0].isIntersecting;
      it.visible = vis;
      if (vis && !it.started){
        it.started = (window.performance || Date).now();
        it.nextAt  = it.started + it.dur.every*1000;
      }
    }, {rootMargin: '15% 0px', threshold: 0.01});
    io.observe(it.el); it.io = io;
  } else { it.visible = true; it.started = (window.performance||Date).now(); }

  if ('ResizeObserver' in window){
    var ro = new ResizeObserver(function(){ it.needLayout = true; });
    ro.observe(it.img); it.ro = ro;
  }
  if (it.has('dust')){
    var host = it.host;
    host.addEventListener('pointermove', function(ev){
      var r = it.img.getBoundingClientRect();
      if (!r.width) return;
      it.mouse[0] = (ev.clientX - r.left) / r.width;
      it.mouse[1] = 1 - (ev.clientY - r.top) / r.height;
      it.mouseTarget = 1;
    }, {passive:true});
    host.addEventListener('pointerleave', function(){ it.mouseTarget = 0; }, {passive:true});
  }
};

ArtefaktGL.boot = function(){
  var A = ArtefaktGL;
  var nodes = [].slice.call(document.querySelectorAll('[data-gl]'));
  if (!nodes.length) return;
  if (!A.support()){
    nodes.forEach(function(n){ n.setAttribute('data-gl-state','off'); });
    return;
  }
  A.R = A.createRenderer();
  if (!A.R){
    nodes.forEach(function(n){ n.setAttribute('data-gl-state','off'); });
    return;
  }
  var dpr = A.dpr();
  nodes.forEach(function(n){
    var it = A.Item(n);
    if (!it){ n.setAttribute('data-gl-state','off'); return; }
    A.items.push(it);
    A.observe(it);
    var go = function(){
      if (!it.layout(dpr)){ setTimeout(go, 120); return; }
      A.loadItem(it, function(ok){
        if (!ok){ A.degrade(it, 'load'); return; }
        if (it.has('dust')) A.makeDust(it);
        it.ready = true;
        if (!it.started && it.visible) it.started = (window.performance||Date).now();
      });
    };
    if (it.img.complete || !it.img.src) go();
    else it.img.addEventListener('load', go, {once:true});
    /* сторож: не ожил за 4 с — отдаём обычный <img> */
    setTimeout(function(){ if (!it.ready) A.degrade(it, 'timeout'); }, 4000);
  });

  window.addEventListener('resize', function(){
    A.items.forEach(function(it){ it.needLayout = true; });
  }, {passive:true});
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) A._fps.last = 0;
  });
  A._raf = requestAnimationFrame(A.tick);
};

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', function(){ ArtefaktGL.boot(); });
else ArtefaktGL.boot();

/* принудительный кадр для всех готовых инстансов — стенд, тесты, headless */
ArtefaktGL.renderNow = function(){
  var A = ArtefaktGL, dpr = A.dpr(), now = (window.performance || Date).now();
  A.items.forEach(function(it){
    if (!it.ready || it.dead) return;
    if (it.needLayout){ it.layout(dpr); it.needLayout = false; }
    A.drawItem(it, now, dpr);
  });
};
