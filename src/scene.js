/* Passeio na floresta: os 12 principios da animacao com uma pessoa e seu cachorro.
 * A movimentacao da pessoa vem de window.MOTION, medida quadro a quadro no video original.
 * renderFrame(f) e uma funcao pura do quadro: o mesmo f sempre desenha a mesma imagem. */
(() => {
  'use strict';
  const FPS = 60, N = 600, PW = 320, PH = 240, TAU = Math.PI * 2;
  const W0 = 54, H0 = 51;          // tamanho da bolinha em repouso no video original
  const SCROLL = 64 / FPS;         // chao em px/quadro: fecha 640px em 10s, o loop nao "pula"
  const WIN = 6;                   // meia janela (quadros) para medir velocidade sem ruido
  const MIN_FACE = 0.55;           // largura minima na virada: nunca fica fino como papel

  const PANELS = [
    { id: 'solido', label: 'Desenho sólido', scroll: true },
    { id: 'encenacao', label: 'Encenação (3D)' },
    { id: 'antecipacao', label: 'Antecipação' },
    { id: 'apelo', label: 'Apelo', scroll: true },
    { id: 'pose', label: 'Pose a pose' },
    { id: 'arco', label: 'Arco' },
    { id: 'exagero', label: 'Exagero' },
    { id: 'continuidade', label: 'Continuidade' },
    { id: 'secundaria', label: 'Ação secundária' },
    { id: 'easing', label: 'Acelerar e desacelerar' },
    { id: 'timing', label: 'Timing' },
    { id: 'squash', label: 'Comprimir e esticar' },
  ];

  const C = {
    parka: '#ff9a2e', parkaHi: '#ffbb63', parkaLo: '#d9701a', trim: '#fff0d6',
    skin: '#f6c9a0', cheek: '#ee9a7c', ink: '#2a1c14', pants: '#27384a', boot: '#5a3620',
    pack: '#2f8f83', packLo: '#1f6a61', mitten: '#c9551a',
    dog: '#f0e3c8', dogLo: '#cdb892', patch: '#8f5a30', nose: '#2a1c14', collar: '#e0483a', tongue: '#ec7f88',
    leash: '#fff3cf', fx: '#fff6dc', firefly: '#f7ef9a', dust: '#b7a98d',
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (f) => ((f % N) + N) % N;
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rngOf = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------- Estabilizacao das curvas medidas ----------
   * O video traz degraus de 1px e um tremelique constante da "gelatina" parada, que numa
   * pessoa parece tremor. Parado: so respiracao lenta. Em acao: suavizacao leve, sem
   * atravessar cortes e impactos, para saltos, poses e corridas continuarem iguais. */
  const SLOW = 24;                                    // sigma (quadros) do corpo parado
  const RAMP = 14;                                    // quadros de transicao entre acao e repouso
  const IMPACT = ['squash', 'exagero', 'arco', 'secundaria']; // deformacao rapida e proposital
  const KEEP = {                                      // estalos do original ligados aos efeitos
    solido: (t) => t % (4 / 3) < 0.45,
    apelo: (t) => t % 2 > 0.45 && t % 2 < 1.35,
  };

  function gauss(a, sigma, brk) {
    const r = Math.ceil(sigma * 3), out = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let sum = a[i], w = 1;
      for (const dir of [-1, 1]) {
        for (let d = 1; d <= r; d++) {
          const j = i + dir * d;
          if (j < 0 || j >= a.length) break;
          if (brk[dir < 0 ? j + 1 : j]) break;       // brk[k]: ha corte entre k-1 e k
          const g = Math.exp(-0.5 * (d / sigma) ** 2);
          sum += a[j] * g; w += g;
        }
      }
      out[i] = sum / w;
    }
    return out;
  }

  const median5 = (a) => a.map((_, i) => {
    const s = a.slice(Math.max(0, i - 2), i + 3).sort((p, q) => p - q);
    return s[s.length >> 1];
  });

  function stabilize(tr, o) {
    const n = tr.x.length, x0 = median5(tr.x);
    const brk = x0.map((_, i) => i > 0 && (Math.abs(x0[i] - x0[i - 1]) > 30
      || Math.abs(tr.h[i] - tr.h[i - 1]) > 12 || tr.vis[i] !== tr.vis[i - 1]));
    const noBrk = new Array(n).fill(false);
    const footsSorted = [...tr.foot].sort((p, q) => p - q);
    const ground = footsSorted[Math.floor(n * 0.9)];
    const keep = KEEP[o.key];

    // Peso de acao: 1 em movimento, no ar, em deformacao grande ou em estalo proposital.
    const raw = x0.map((_, f) => {
      const a = x0[Math.max(0, f - WIN)], b = x0[Math.min(n - 1, f + WIN)];
      const moving = Math.abs(b - a) / (2 * WIN) > 0.5;
      const air = !o.free && ground - tr.foot[f] > 3;
      const big = tr.h[f] < 36 || tr.h[f] > 78 || tr.w[f] > 80;
      return moving || air || big || o.free || (keep && keep(f / FPS)) ? 1 : 0;
    });
    const dil = raw.map((_, i) => (raw.slice(Math.max(0, i - 8), i + 9).some(Boolean) ? 1 : 0));
    // Dentro do trecho parado, o peso cai de 1 a 0 conforme se afasta da acao: sem saltos na emenda.
    const act = dil.map((v, i) => {
      if (v) return 1;
      for (let d = 1; d <= RAMP; d++) {
        if (dil[i - d] || dil[i + d]) return 1 - sstep(0, RAMP, d);
      }
      return 0;
    });
    // A media lenta so enxerga quadros parados: nunca puxa o corpo para a corrida vizinha.
    const brkSlow = brk.map((b, i) => b || (i > 0 && dil[i] !== dil[i - 1]));

    const mix = (a, sigma) => {
      const mild = gauss(a, sigma, brk), slow = gauss(a, SLOW, brkSlow);
      return a.map((_, i) => (dil[i] ? mild[i] : lerp(slow[i], mild[i], act[i])));
    };
    const shape = o.free ? 5 : IMPACT.includes(o.key) ? 1.5 : 3.5;
    const out = {
      ...tr,
      x: mix(x0, o.free ? 4 : 2.2),
      foot: o.free ? gauss(tr.foot, 4, noBrk) : mix(tr.foot, 1),
      w: mix(tr.w, shape), h: mix(tr.h, shape),
      lean: mix(tr.lean, o.free ? 5 : 3), sq: mix(tr.sq, 4),
    };
    if (tr.ball) out.ball = gauss(tr.ball, 1.5, noBrk);
    return out;
  }

  /* ---------- Movimento da pessoa ---------- */
  function buildPerson(rawTrack, opts = {}) {
    const tr = stabilize(rawTrack, opts);
    const foots = tr.foot.filter((_, i) => tr.vis[i]).sort((a, b) => a - b);
    const ground = opts.free ? null : foots[Math.floor(foots.length * 0.9)];
    const fr = [];
    for (let f = 0; f < N; f++) {
      const lean = clamp(tr.lean[f], -1.4, 1.4);
      const w = Math.max(tr.w[f] - Math.abs(lean) * tr.h[f] * 0.75, 12);
      const air = ground === null ? 0 : Math.max(0, ground - tr.foot[f]);
      fr.push({
        vis: !!tr.vis[f], x: tr.x[f] - lean * tr.h[f] / 2, foot: tr.foot[f],
        sx: w / W0, sy: tr.h[f] / H0, lean, air: air > 3 ? air : 0, ground,
        sq: sstep(0.8, 0.93, tr.sq[f]),
        // So o "Apelo" pisca de proposito; esticar o corpo nao pode fechar os olhos.
        blink: opts.key === 'apelo' && KEEP.apelo(f / FPS) && rawTrack.eye[f] / Math.max(rawTrack.h[f], 1) < 0.085 ? 1 : 0,
        pomGap: tr.ball ? Math.max(0, tr.foot[f] - tr.h[f] - tr.ball[f]) : null,
      });
    }
    let phase = 0, amp = 0;
    for (let k = 0; k < 2; k++) {   // duas voltas: o quadro 0 herda o estado do quadro 599
      for (let f = 0; f < N; f++) {
        const p = fr[f], a = fr[wrap(f - 1)], b = fr[wrap(f + 1)];
        let v = (b.x - a.x) / 2;
        if (Math.abs(v) > 30) v = 0;           // cortes do "pose a pose" nao contam como passo
        p.v = v;
        p.vy = (b.foot - a.foot) / 2;
        // Velocidade em janela: a respiracao da bolinha nao pode virar passo nem virada.
        const dx = fr[wrap(f + WIN)].x - fr[wrap(f - WIN)].x;
        const dy = fr[wrap(f + WIN)].foot - fr[wrap(f - WIN)].foot;
        p.vs = Math.abs(dx) > 90 && Math.abs(v) < 1 ? 0 : dx / (2 * WIN);
        const scale = Math.max((p.sx + p.sy) / 2, 0.2);
        let speed = Math.hypot(p.vs, opts.free ? dy / (2 * WIN) : 0) / scale;
        if (opts.scroll) speed = SCROLL;
        phase += (p.air ? 0 : speed / 36) * TAU;
        amp += ((speed > 0.35 && !p.air ? 1 : 0) - amp) * 0.18;
        p.phase = phase; p.amp = amp;
      }
    }
    return fr;
  }

  /* ---------- Movimento do cachorro: uma coreografia por principio ---------- */
  function follow(P, f, delay, kx, ky, ks) {
    const p = P[wrap(f - delay)];
    return {
      x: 160 + (p.x - 160) * kx, lift: p.air * ky,
      sx: 1 + (p.sx - 1) * ks, sy: 1 + (p.sy - 1) * ks, lean: p.lean * ks,
    };
  }

  const DOG = {
    // Andando ao lado, com o cenario correndo: o passeio em si.
    solido: (P, f) => {
      const p = P[wrap(f - 12)];
      return { x: 214 + Math.sin(f / N * TAU * 3) * 5, lift: 0, sx: 1 + (p.sx - 1) * 0.25, sy: 1 + (p.sy - 1) * 0.25,
        lean: 0, face: 1, trot: true, wag: 0.8 };
    },
    apelo: (P, f) => {
      const t = (f / FPS) % 2;
      const hop = t > 0.55 && t < 1.05 ? Math.sin((t - 0.55) / 0.5 * Math.PI) : 0;
      const excited = t > 0.45 && t < 1.35;
      return { x: 216, lift: hop * 17, sx: 1 - hop * 0.08, sy: 1 + hop * 0.12, lean: 0,
        face: excited ? -1 : 1, trot: !excited, wag: excited ? 1.6 : 0.8, pant: excited };
    },
    // Quando a pessoa sai voando, a guia puxa o cachorro para cima, nas patas de tras.
    exagero: (P, f) => {
      const p = P[f];
      const flying = !p.vis || p.air > 30;
      const t = (f / FPS) % 2.5;
      const after = t > 1.42 ? Math.exp(-(t - 1.42) * 5) * Math.abs(Math.sin((t - 1.42) * 13)) : 0;
      const pre = t > 0.38 && t < 0.62 ? 1 : 0;
      return { x: flying ? 96 : 76, lift: after * 22 + (flying ? 3 : 0), sx: pre ? 1.1 : 1, sy: pre ? 0.82 : 1, lean: 0,
        sit: flying ? 0 : 1, beg: flying ? 1 : 0, spring: [0.16, 0.72], wag: flying ? 0.2 : 1 };
    },
    secundaria: (P, f) => ({ ...follow(P, f, 9, 0, 0.3, 0.35), x: 98, sit: P[wrap(f - 9)].air > 4 ? 0 : 1, wag: 1.4, pant: true }),
    squash: (P, f) => ({ ...follow(P, f + 30, 0, 0, 0.36, 0.5), x: 92, wag: 1 }),
    antecipacao: (P, f) => ({ ...follow(P, f, 8, 0.4, 0, 0.8), wag: 0.9 }),
    continuidade: (P, f) => ({ ...follow(P, f, 14, 0.4, 0, 0.8), spring: [0.09, 0.8], wag: 0.9 }),
    easing: (P, f) => ({ ...follow(P, f, 7, 0.4, 0, 0.55), wag: 0.8 }),
    timing_a: (P, f) => ({ ...follow(P, f, 5, 0.4, 0, 0.6), wag: 0.8 }),
    timing_b: (P, f) => ({ ...follow(P, f, 9, 0.4, 0, 0.6), wag: 0.8 }),
    arco: (P, f) => ({ ...follow(P, f, 13, 0.68, 0.6, 0.7), wag: 0.5 }),
    // Cada pose da pessoa tem uma pose do cachorro, trocadas em corte seco.
    pose: (P, f) => {
      const seg = Math.floor((((f / FPS - 0.083) % 5 + 5) % 5) / 1.25);
      const base = follow(P, f, 3, 0.4, 0, 0.12);
      if (seg === 2) base.x -= 34;   // a pessoa vira panqueca aqui: o cachorro abre espaco
      return { ...base, sit: seg === 0 ? 1 : 0, beg: seg === 1 ? 1 : 0, lie: seg === 2 ? 1 : 0, snap: true, wag: seg === 3 ? 1.6 : 0.3 };
    },
    // Mesma orbita, alguns passos atras, respeitando a profundidade.
    encenacao: (P, f) => {
      const p = P[wrap(f - 24)];
      return { x: p.x, foot: p.foot, lift: 0, sx: p.sx, sy: p.sy, lean: 0, wag: 0.8, free: true };
    },
  };

  function buildDog(P, key) {
    const cfg = DOG[key], fr = new Array(N);
    const G = P[0].ground;
    let x = cfg(P, 0).x, vx = 0, phase = 0, amp = 0, ear = 0, earV = 0, tail = 0, tailV = 0, sit = 0, beg = 0, lie = 0, face = 1, prevX = x, prevFoot = 0, idle = 0;
    for (let k = 0; k < 2; k++) {
      for (let f = 0; f < N; f++) {
        const t = cfg(P, f);
        if (t.spring) {
          vx += (t.x - x) * t.spring[0]; vx *= t.spring[1]; x += vx;
        } else { x = t.x; }
        const foot = t.foot !== undefined ? t.foot : G - t.lift;
        let v = x - prevX;
        const vy = foot - prevFoot;
        if (Math.abs(v) > 30) v = 0;
        prevX = x; prevFoot = foot;
        const ta = cfg(P, wrap(f - WIN)), tb = cfg(P, wrap(f + WIN));
        const wx = tb.x - ta.x;
        const vs = t.snap && Math.abs(wx) > 30 ? 0 : wx / (2 * WIN);
        const vsY = t.free ? (tb.foot - ta.foot) / (2 * WIN) : 0;
        const scale = Math.max((t.sx + t.sy) / 2, 0.2);
        const air = t.foot !== undefined ? 0 : t.lift;
        let speed = Math.hypot(vs, vsY) / scale;
        if (t.trot) speed = SCROLL;
        phase += (air > 2 ? 0 : speed / 22) * TAU;
        amp += ((speed > 0.25 && air <= 2 ? 1 : 0) - amp) * 0.2;
        // Orelhas e rabo atrasam em relacao ao corpo: e a molinha da continuidade.
        earV += (clamp(-v * 0.22 + vy * 0.11, -1.2, 1.2) - ear) * 0.16; earV *= 0.78; ear += earV;
        tailV += (clamp(-v * 0.16, -1, 1) - tail) * 0.14; tailV *= 0.8; tail += tailV;
        const r = t.snap ? 1 : 0.16;
        sit += ((t.sit || 0) - sit) * r; beg += ((t.beg || 0) - beg) * r; lie += ((t.lie || 0) - lie) * r;
        const p = P[f];
        const dir = Math.abs(vs) > 0.3 ? Math.sign(vs) : 0;
        idle = dir ? 0 : idle + 1;
        const want = t.face !== undefined ? t.face : dir || (idle > 10 ? Math.sign((p.x - x) || 1) : face);
        face += (want - face) * (t.snap ? 1 : 0.22);
        const headY = (p.vis ? p.foot - 58 * p.sy : -40) - (foot - 26);
        const headX = Math.abs(p.x - x) + 10;
        fr[f] = { x, foot, lift: air, sx: t.sx, sy: t.sy, lean: t.lean, face, phase, amp, ear, tail, sit, beg, lie,
          wag: t.wag === undefined ? 0.8 : t.wag, pant: !!t.pant, f,
          look: clamp(Math.atan2(headY, headX), -1.05, 0.25), ground: G };
      }
    }
    return fr;
  }

  function faceToDog(P, D, opts) {
    let face = 1, idle = 0;
    for (let k = 0; k < 2; k++) for (let f = 0; f < N; f++) {
      const p = P[f];
      const dir = Math.abs(p.vs) > 0.4 ? Math.sign(p.vs) : 0;
      idle = dir ? 0 : idle + 1;
      let want = opts.face !== undefined ? opts.face : dir || (idle > 14 ? Math.sign((D[f].x - p.x) || 1) : face);
      face += (want - face) * 0.28;
      p.face = Math.abs(face) < MIN_FACE ? (face < 0 ? -MIN_FACE : MIN_FACE) : face;
    }
  }

  /* Poeira: quando sai em disparada ou aterrissa. */
  function dustEvents(P, D) {
    const ev = [];
    const scan = (fr, scale) => {
      for (let f = 0; f < N; f++) {
        const a = fr[wrap(f - 1)], b = fr[f];
        const px = b.x;
        if (a.air > 0 && !b.air && a.air !== undefined) ev.push({ f, x: px, y: b.ground, dir: 0, s: scale });
        const va = Math.abs(a.v || 0), vb = Math.abs(b.v || 0);
        if (va < 2.2 && vb >= 2.2 && !b.air) ev.push({ f, x: px - Math.sign(b.v) * 26 * scale, y: b.ground, dir: Math.sign(b.v), s: scale, lines: true });
      }
    };
    scan(P, 1);
    const dogFrames = D.map((d, i) => ({ x: d.x, air: d.lift > 2 ? d.lift : 0, v: d.x - D[wrap(i - 1)].x, ground: d.ground }));
    scan(dogFrames, 0.55);
    return ev;
  }

  /* ---------- Desenho da pessoa ---------- */
  function personXf(p) { return { x: p.x, y: p.foot, a: p.sx, c: -p.lean * p.sy, d: p.sy, face: p.face }; }
  const localToWorld = (m, lx, ly) => ({ x: m.x + m.a * m.face * lx + m.c * ly, y: m.y + m.d * ly });

  function bodyPath(c, sq, top, hem, hw) {
    const k = 0.5523, flat = lerp(0, hw - 8, sq), rx = hw - flat, ry = lerp(30, 9, sq), rb = lerp(3, 7, sq);
    c.beginPath();
    c.moveTo(-hw + rb, hem);
    c.quadraticCurveTo(-hw, hem, -hw, hem - rb);
    c.lineTo(-hw, top + ry);
    c.bezierCurveTo(-hw, top + ry * (1 - k), -flat - rx * k, top, -flat, top);
    c.lineTo(flat, top);
    c.bezierCurveTo(flat + rx * k, top, hw, top + ry * (1 - k), hw, top + ry);
    c.lineTo(hw, hem - rb);
    c.quadraticCurveTo(hw, hem, hw - rb, hem);
    c.closePath();
  }

  function drawPerson(c, p, handTarget, ghost) {
    const m = personXf(p);
    const TOP = -66, HEM = -13, HW = 21;
    c.save();
    c.transform(m.a, 0, m.c, m.d, m.x, m.y);
    c.scale(m.face, 1);
    c.lineCap = 'round'; c.lineJoin = 'round';

    // Pernas: ciclo de caminhada pela distancia percorrida; encolhidas quando no ar.
    const flying = p.air > 3;
    const drawLeg = (ph, hipX, col) => {
      const sw = Math.sin(ph) * p.amp, lift = Math.max(0, Math.cos(ph)) * p.amp;
      let fx = hipX + sw * 11, fy = -2 - lift * 5;
      if (flying) { fx = hipX + (hipX > 0 ? 3 : -3); fy = -6 - clamp(p.air / 30, 0, 1) * 2; }
      c.strokeStyle = ghost || col; c.lineWidth = 7;
      c.beginPath(); c.moveTo(hipX, -15); c.lineTo(fx, fy); c.stroke();
      c.fillStyle = ghost || C.boot;
      c.beginPath(); c.ellipse(fx + 2.2, fy + 0.2, 6, 3.4, 0, 0, TAU); c.fill();
    };
    drawLeg(p.phase + Math.PI, -6, '#1d2c3b');
    drawLeg(p.phase, 7, C.pants);

    // Mochila atras do corpo.
    c.fillStyle = ghost || C.pack;
    c.beginPath(); c.roundRect(-HW - 8, -46, 14, 25, 5); c.fill();
    if (!ghost) { c.fillStyle = C.packLo; c.beginPath(); c.roundRect(-HW - 8, -32, 12, 8, 3); c.fill(); }

    // Parka: mesma cupula da bolinha, com a mesma transformacao para quadrado.
    bodyPath(c, p.sq, TOP, HEM, HW);
    if (ghost) { c.fillStyle = ghost; c.fill(); } else {
      const g = c.createLinearGradient(-HW, TOP, HW * 0.7, HEM);
      g.addColorStop(0, C.parkaHi); g.addColorStop(0.5, C.parka); g.addColorStop(1, C.parkaLo);
      c.fillStyle = g; c.fill();
      c.save(); c.clip();
      c.fillStyle = 'rgba(120,50,0,.20)'; c.fillRect(-HW, HEM - 6, HW * 2, 6);
      c.strokeStyle = 'rgba(120,50,0,.28)'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(7, -28); c.lineTo(7, HEM); c.stroke();
      c.restore();
    }

    // Rosto no capuz.
    if (!ghost) {
      const fx = 5, fy = -44, sqr = p.sq;
      c.fillStyle = C.trim;
      c.beginPath(); c.roundRect(fx - 15, fy - 14, 30, 28, lerp(14, 8, sqr)); c.fill();
      c.fillStyle = C.skin;
      c.beginPath(); c.roundRect(fx - 11.5, fy - 10.5, 23, 21, lerp(10.5, 6, sqr)); c.fill();
      c.fillStyle = C.cheek; c.globalAlpha = 0.55;
      c.beginPath(); c.ellipse(fx - 6.5, fy + 4, 2.8, 1.8, 0, 0, TAU); c.ellipse(fx + 7.5, fy + 4, 2.8, 1.8, 0, 0, TAU); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = C.ink; c.strokeStyle = C.ink; c.lineWidth = 1.7;
      for (const ex of [fx - 3.2, fx + 5.4]) {
        if (p.blink) { c.beginPath(); c.moveTo(ex - 2.8, fy - 1); c.lineTo(ex + 2.8, fy - 1); c.stroke(); }
        else { const es = p.eyeS || 1; c.beginPath(); c.ellipse(ex, fy - 1, 2 * es, 2.5 * es, 0, 0, TAU); c.fill(); }
      }
      c.lineWidth = 1.3;
      if (p.mouthO) { c.beginPath(); c.ellipse(fx + 1, fy + 5, 2.6, 3.2 * p.mouthO, 0, 0, TAU); c.fill(); }
      else { c.beginPath(); c.arc(fx + 1, fy + 3, 3.1, 0.2, Math.PI - 0.2); c.stroke(); }
    }

    // Pompom do capuz: no painel "Ação secundária" ele repete a bolinha que atrasa.
    const gap = p.pomGap === null ? 5 : p.pomGap;
    const py = TOP - (gap + 1) / Math.max(p.sy, 0.3) + 2;
    if (gap > 11) {
      c.strokeStyle = ghost || C.parkaLo; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, TOP + 1); c.lineTo(0, py + 5); c.stroke();
    }
    c.fillStyle = ghost || C.trim;
    c.beginPath(); c.ellipse(0, py, 6.5, 6.5 / Math.max(p.sy / p.sx, 0.4) * 0.9, 0, 0, TAU); c.fill();

    // Braco que segura a guia: aponta para o cachorro.
    const sh = { x: 3, y: -30 };
    const shW = localToWorld(m, sh.x, sh.y);
    let ax = 1, ay = 0.2;
    if (handTarget) {
      const dx = (handTarget.x - shW.x) * Math.sign(m.face), dy = handTarget.y - shW.y;
      const l = Math.hypot(dx, dy) || 1; ax = dx / l; ay = dy / l;
    }
    const hx = sh.x + ax * 17, hy = sh.y + ay * 15;
    c.strokeStyle = ghost || C.parkaLo; c.lineWidth = 6.5;
    c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(hx, hy); c.stroke();
    c.fillStyle = ghost || C.mitten;
    c.beginPath(); c.arc(hx, hy, 3.8, 0, TAU); c.fill();
    c.restore();
    return localToWorld(m, hx, hy);
  }

  /* ---------- Desenho do cachorro ---------- */
  function drawDog(c, d, ghost, t) {
    const face = Math.abs(d.face) < MIN_FACE ? (d.face < 0 ? -MIN_FACE : MIN_FACE) : d.face;
    c.save();
    c.transform(d.sx, 0, -d.lean * d.sy, d.sy, d.x, d.foot);
    c.scale(face, 1);
    c.lineCap = 'round'; c.lineJoin = 'round';
    const s = d.sit, b = d.beg, l = d.lie;
    const stand = Math.max(0, 1 - s - b - l);
    const mix = (st, si, be, li) => st * stand + si * s + be * b + li * l;
    const hip = { x: mix(-13, -9, -4, -13), y: mix(-17, -8, -9, -7) };
    const chest = { x: mix(10, 7, 2, 10), y: mix(-19, -22, -32, -9) };
    const gait = d.amp;

    const leg = (from, ph, dx, col, foldY) => {
      const sw = Math.sin(ph) * gait, up = Math.max(0, Math.cos(ph)) * gait;
      const fx = from.x + dx + sw * 8, fy = lerp(-1 - up * 4, foldY, 1 - stand);
      c.strokeStyle = ghost || col; c.lineWidth = 4.6;
      c.beginPath(); c.moveTo(from.x + dx, from.y + 3); c.lineTo(fx, fy); c.stroke();
    };
    const pose = d.phase;
    // Rabo: abana, e atrasa junto com o movimento.
    const wag = Math.sin(t * 16 * Math.max(d.wag, 0.2)) * 0.45 * d.wag;
    const tAng = -1.05 + wag + d.tail * 0.9 + (s + b) * 0.9;
    c.strokeStyle = ghost || C.patch; c.lineWidth = 4;
    c.beginPath(); c.moveTo(hip.x - 3, hip.y - 2);
    c.quadraticCurveTo(hip.x - 11 * Math.cos(tAng + 0.4), hip.y - 11 * Math.abs(Math.sin(tAng + 0.4)) - 1,
      hip.x - 16 * Math.cos(tAng), hip.y + 16 * Math.sin(tAng));
    c.stroke();

    leg(hip, pose + Math.PI, 4, C.dogLo, -1);
    leg(chest, pose, -3, C.dogLo, b > 0.5 ? -24 : -1);

    // Tronco.
    c.strokeStyle = ghost || C.dog; c.lineWidth = 13.5;
    c.beginPath(); c.moveTo(hip.x, hip.y); c.lineTo(chest.x, chest.y); c.stroke();
    if (!ghost) {
      const mx = lerp(hip.x, chest.x, 0.35), my = lerp(hip.y, chest.y, 0.35);
      c.fillStyle = C.patch;
      c.beginPath(); c.ellipse(mx, my - 2.8, 6.6, 4, Math.atan2(chest.y - hip.y, chest.x - hip.x), 0, TAU); c.fill();
    }

    leg(hip, pose, -2, C.dog, -1);
    leg(chest, pose + Math.PI, 3, C.dog, b > 0.5 ? -21 : -1);

    // Cabeca: procura a pessoa com o olhar.
    const hx = chest.x + 7, hy = chest.y - 9 + l * 2;
    c.save();
    c.translate(hx, hy);
    c.rotate(d.look * 0.85);
    c.fillStyle = ghost || C.dog;
    c.beginPath(); c.arc(0, 0, 9.4, 0, TAU); c.fill();
    c.beginPath(); c.roundRect(3, -1.5, 11.5, 8, 4); c.fill();
    if (!ghost) {
      c.fillStyle = C.nose; c.beginPath(); c.ellipse(13.4, 0.2, 2.4, 2, 0, 0, TAU); c.fill();
      c.beginPath(); c.arc(3.6, -2.6, 1.7, 0, TAU); c.fill();
      c.fillStyle = C.fx; c.beginPath(); c.arc(4.1, -3.2, 0.6, 0, TAU); c.fill();
      if (d.bark) {
        c.fillStyle = C.ink;
        c.beginPath(); c.moveTo(3, 5); c.lineTo(13, 5); c.lineTo(9, 6 + d.bark * 7); c.closePath(); c.fill();
      } else if (d.pant) {
        c.fillStyle = C.tongue;
        c.beginPath(); c.roundRect(7, 5, 3.6, 5 + Math.sin(t * 22) * 1.2, 1.8); c.fill();
      }
      // Coleira.
      c.strokeStyle = C.collar; c.lineWidth = 2.6;
      c.beginPath(); c.arc(-3, 3, 8.6, 1.1, 2.6); c.stroke();
    }
    // Orelha caida, com atraso.
    c.save();
    c.translate(-3, -7);
    c.rotate(0.28 + d.ear + (d.lift > 2 ? -0.35 : 0));
    c.fillStyle = ghost || C.patch;
    c.beginPath(); c.ellipse(-2.5, 7, 4.2, 8, 0, 0, TAU); c.fill();
    c.restore();
    c.restore();
    c.restore();
  }

  // Ponto da coleira, no mundo: onde a guia se prende.
  function dogCollar(d) {
    const s = d.sit, b = d.beg, l = d.lie, st = Math.max(0, 1 - s - b - l);
    const cx = st * 10 + s * 7 + b * 2 + l * 10, cy = st * -19 + s * -22 + b * -32 + l * -9;
    const lx = (cx + 3) * Math.sign(d.face || 1), ly = cy - 6;
    return { x: d.x + d.sx * lx - d.lean * d.sy * ly, y: d.foot + d.sy * ly };
  }

  function drawLeash(c, h, t, ls, f) {
    const dist = Math.hypot(h.x - t.x, h.y - t.y);
    const LEN = 118 * ls;
    const slack = Math.max(0, LEN - dist);
    const wobble = Math.sin(f * 0.13) * 1.5 * ls * clamp(slack / 40, 0, 1);
    const mx = (h.x + t.x) / 2 + wobble, my = (h.y + t.y) / 2 + slack * 0.42;
    c.strokeStyle = C.leash; c.lineWidth = 1.7 * clamp(ls, 0.45, 1.2); c.lineCap = 'round';
    c.beginPath(); c.moveTo(h.x, h.y); c.quadraticCurveTo(mx, my, t.x, t.y); c.stroke();
  }

  function drawShadow(c, x, y, rx, a) {
    c.fillStyle = `rgba(4,14,12,${a})`;
    c.beginPath(); c.ellipse(x, y, Math.max(rx, 1), Math.max(rx * 0.17, 0.5), 0, 0, TAU); c.fill();
  }

  /* ---------- Floresta: pintada uma vez, reaproveitada em todo quadro ---------- */
  const mkCanvas = (w, h, ss) => {
    const k = document.createElement('canvas');
    k.width = Math.round(w * ss); k.height = Math.round(h * ss);
    const c = k.getContext('2d'); c.scale(ss, ss);
    return { k, c };
  };

  function pine(c, x, base, h, w, col, trunk) {
    c.fillStyle = trunk; c.fillRect(x - w * 0.05, base - h * 0.2, w * 0.1, h * 0.2);
    c.fillStyle = col;
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const yB = base - h * (0.12 + t * 0.72), yT = yB - h * 0.32;
      const hw = w * (0.5 - t * 0.38);
      c.beginPath();
      c.moveTo(x, yT);
      c.lineTo(x + hw * 0.55, yB - h * 0.1);
      c.lineTo(x + hw * 0.42, yB - h * 0.08);
      c.lineTo(x + hw, yB);
      c.lineTo(x - hw, yB);
      c.lineTo(x - hw * 0.42, yB - h * 0.08);
      c.lineTo(x - hw * 0.55, yB - h * 0.1);
      c.closePath(); c.fill();
    }
  }

  function broadTrunk(c, x, base, w, col, lit, rng) {
    const g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, col); g.addColorStop(0.55, col); g.addColorStop(1, lit);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - w * 0.75, base + 3);
    c.quadraticCurveTo(x - w * 0.45, base - 18, x - w * 0.42, base - 60);
    c.lineTo(x - w * 0.36, -5); c.lineTo(x + w * 0.36, -5); c.lineTo(x + w * 0.42, base - 60);
    c.quadraticCurveTo(x + w * 0.45, base - 18, x + w * 0.75, base + 3);
    c.closePath(); c.fill();
    c.strokeStyle = col; c.lineWidth = w * 0.22; c.lineCap = 'round';
    const by = base - 95 - rng() * 45, dir = rng() > 0.5 ? 1 : -1;
    c.beginPath(); c.moveTo(x, by); c.quadraticCurveTo(x + dir * 18, by - 8, x + dir * 34, by - 28); c.stroke();
  }

  function tiled(W, fn) { for (const dx of [-W, 0, W]) fn(dx); }

  function paintFar(c, W, top, ground, rng, glowX) {
    const H = ground - top;
    const g = c.createLinearGradient(0, top, 0, ground);
    g.addColorStop(0, '#163d40'); g.addColorStop(0.55, '#2b6a61'); g.addColorStop(1, '#5d9a7c');
    c.fillStyle = g; c.fillRect(0, top, W, H + 2);
    const sun = c.createRadialGradient(glowX, top + H * 0.32, 4, glowX, top + H * 0.32, 170);
    sun.addColorStop(0, 'rgba(255,221,150,.62)'); sun.addColorStop(0.45, 'rgba(240,200,130,.2)'); sun.addColorStop(1, 'rgba(240,200,130,0)');
    c.fillStyle = sun; c.fillRect(0, top, W, H + 2);
    const trees = [];
    const n = Math.round(W / 15);
    for (let i = 0; i < n; i++) trees.push({ x: (i + rng() * 0.8) * W / n, h: 70 + rng() * 60, w: 26 + rng() * 14 });
    tiled(W, (dx) => { for (const t of trees) pine(c, t.x + dx, ground - 6, t.h, t.w, '#2f6e64', '#285f58'); });
  }

  function paintMid(c, W, top, ground, rng) {
    const trees = [];
    const n = Math.round(W / 27);
    for (let i = 0; i < n; i++) trees.push({ x: (i + rng() * 0.9) * W / n, h: 105 + rng() * 75, w: 44 + rng() * 22 });
    tiled(W, (dx) => { for (const t of trees) pine(c, t.x + dx, ground - 2, t.h, t.w, '#1b4a44', '#16362f'); });
    const fog = c.createLinearGradient(0, ground - 75, 0, ground);
    fog.addColorStop(0, 'rgba(180,225,195,0)'); fog.addColorStop(1, 'rgba(180,225,195,.20)');
    c.fillStyle = fog; c.fillRect(0, ground - 75, W, 75);
  }

  function shafts(c, W, top, ground, rng) {
    c.save(); c.globalCompositeOperation = 'lighter';
    const n = Math.max(2, Math.round(W / 130));
    for (let i = 0; i < n; i++) {
      const x = (i + rng()) * W / n, w = 12 + rng() * 22;
      const g = c.createLinearGradient(0, top, 0, ground);
      g.addColorStop(0, 'rgba(255,226,160,.16)'); g.addColorStop(1, 'rgba(255,226,160,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(x, top); c.lineTo(x + w, top); c.lineTo(x + w - 42, ground); c.lineTo(x - 42 - w * 0.4, ground); c.closePath(); c.fill();
    }
    c.restore();
  }

  function paintGround(c, W, top, ground, bottom, rng, opts = {}) {
    if (!opts.noTrunks) {
      const trunks = [];
      const n = Math.round(W / 125);
      for (let i = 0; i < n; i++) trunks.push({ x: (i + 0.2 + rng() * 0.6) * W / n, w: 13 + rng() * 11, s: rng() * 1000 | 0 });
      tiled(W, (dx) => {
        c.save(); c.beginPath(); c.rect(0, top, W, bottom - top); c.clip();
        for (const t of trunks) broadTrunk(c, t.x + dx, ground - 7, t.w, '#10302d', '#25574c', rngOf(t.s));
        c.restore();
      });
    }
    const edge = ground - 11;
    const g = c.createLinearGradient(0, edge - 4, 0, bottom);
    g.addColorStop(0, '#2e5c2c'); g.addColorStop(0.3, '#23492a'); g.addColorStop(1, '#10291f');
    c.fillStyle = g; c.fillRect(0, edge, W, bottom - edge);
    // Trilha de terra onde os pes pisam.
    const trail = c.createLinearGradient(0, ground - 7, 0, ground + 12);
    trail.addColorStop(0, '#6f5a3c'); trail.addColorStop(0.6, '#5b4830'); trail.addColorStop(1, '#3c3322');
    c.fillStyle = trail; c.fillRect(0, ground - 7, W, Math.min(19, bottom - ground + 7));
    const items = [];
    const n = Math.round(W / 5);
    for (let i = 0; i < n; i++) items.push({ x: rng() * W, y: rng(), h: 3 + rng() * 6, k: rng(), lean: rng() - 0.5 });
    tiled(W, (dx) => {
      for (const it of items) {
        const lowY = ground + 13 + it.y * Math.max(bottom - ground - 13, 0);
        const y = it.k < 0.45 ? edge + 3 : lowY;
        if (y > bottom) continue;
        c.strokeStyle = it.k < 0.2 ? '#4f8a3b' : it.k < 0.6 ? '#3b7435' : '#2b5c30';
        c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(it.x + dx, y); c.quadraticCurveTo(it.x + dx + it.lean * 2, y - it.h * 0.6, it.x + dx + it.lean * 6, y - it.h); c.stroke();
      }
    });
    // Pedras, cogumelos e seixos.
    const props = [];
    const m = Math.round(W / 62);
    for (let i = 0; i < m; i++) props.push({ x: (i + rng()) * W / m, k: rng(), r: 3 + rng() * 4 });
    tiled(W, (dx) => {
      for (const p of props) {
        const x = p.x + dx;
        if (p.k < 0.45) {
          c.fillStyle = '#54665c'; c.beginPath(); c.ellipse(x, ground + 15, p.r + 2, p.r * 0.7, 0, 0, TAU); c.fill();
          c.fillStyle = '#74877a'; c.beginPath(); c.ellipse(x - 1, ground + 13.7, p.r * 0.7, p.r * 0.3, 0, 0, TAU); c.fill();
        } else if (p.k < 0.75) {
          c.fillStyle = '#e8dfca'; c.fillRect(x - 1, edge - 3, 2, 5);
          c.fillStyle = '#c9493b'; c.beginPath(); c.arc(x, edge - 3, 4, Math.PI, 0); c.fill();
        } else {
          c.fillStyle = '#28553a';
          for (let a = -2; a <= 2; a++) { c.beginPath(); c.ellipse(x + a * 3.2, edge - 2 - (2 - Math.abs(a)) * 2, 2.2, 6, a * 0.42, 0, TAU); c.fill(); }
        }
      }
    });
  }

  function canopy(c, W, rng) {
    const n = Math.round(W / 8);
    c.fillStyle = '#0d2826';
    const blobs = [];
    for (let i = 0; i < n; i++) blobs.push({ x: rng() * W, y: rng() * 16 - 4, r: 7 + rng() * 11 });
    tiled(W, (dx) => { for (const b of blobs) { c.beginPath(); c.arc(b.x + dx, b.y, b.r, 0, TAU); c.fill(); } });
  }

  function buildBackdrop(panel, i, ss) {
    const rng = rngOf(1009 + i * 77);
    const glow = 50 + rng() * 220;
    const G = 209;
    const L = { layers: [] };
    const add = (w, speed, paint) => {
      const k = mkCanvas(w, PH, ss);
      paint(k.c, w);
      L.layers.push({ canvas: k.k, w, speed });
    };
    if (panel.id === 'encenacao') {
      add(PW, 0, (c) => paintPerspective(c, rng, glow));
    } else if (panel.id === 'timing') {
      add(PW, 0, (c) => {
        const lanes = [[0, 118, 117], [118, 240, 209]];
        for (const [t, b, g] of lanes) {
          c.save(); c.beginPath(); c.rect(0, t, PW, b - t); c.clip();
          paintFar(c, PW, t, g, rng, glow);
          paintMid(c, PW, t, g, rng);
          shafts(c, PW, t, g, rng);
          paintGround(c, PW, t, g, b, rng, { noTrunks: t === 0 });
          c.restore();
        }
        // Sombra da encosta: a raia de cima vira um terraco, nao uma tabua solta.
        const drop = c.createLinearGradient(0, 118, 0, 150);
        drop.addColorStop(0, 'rgba(5,18,16,.6)'); drop.addColorStop(1, 'rgba(5,18,16,0)');
        c.fillStyle = drop; c.fillRect(0, 118, PW, 32);
        canopy(c, PW, rng);
      });
    } else if (panel.scroll) {
      add(PW, 0, (c) => paintFar(c, PW, 0, G, rng, glow));
      add(PW, SCROLL / 2, (c) => { paintMid(c, PW, 0, G, rng); shafts(c, PW, 0, G, rng); });
      add(640, SCROLL, (c) => { paintGround(c, 640, 0, G, PH, rng); canopy(c, 640, rng); });
    } else {
      add(PW, 0, (c) => {
        paintFar(c, PW, 0, G, rng, glow);
        paintMid(c, PW, 0, G, rng);
        shafts(c, PW, 0, G, rng);
        paintGround(c, PW, 0, G, PH, rng);
        if (panel.id === 'arco') drawLog(c, 160, G);
        canopy(c, PW, rng);
      });
    }
    // Vinheta e, no primeiro plano, folhagem das bordas: nada disso cobre os personagens.
    const v = mkCanvas(PW, PH, ss);
    const vg = v.c.createRadialGradient(PW / 2, PH * 0.55, 90, PW / 2, PH * 0.55, 215);
    vg.addColorStop(0, 'rgba(3,10,12,0)'); vg.addColorStop(1, 'rgba(3,10,12,.52)');
    v.c.fillStyle = vg; v.c.fillRect(0, 0, PW, PH);
    L.vignette = v.k;
    L.fireflies = Array.from({ length: 11 }, () => ({
      x: rng() * PW, y: 45 + rng() * 150, ax: 8 + rng() * 15, ay: 5 + rng() * 11,
      kx: 1 + Math.floor(rng() * 4), ky: 1 + Math.floor(rng() * 4), kp: 3 + Math.floor(rng() * 8), ph: rng() * TAU,
    }));
    L.leaves = Array.from({ length: 4 }, () => ({
      x: rng() * PW, ph: rng(), k: 1 + Math.floor(rng() * 2), col: rng() > 0.5 ? '#d7a23c' : '#c9692d', sw: 10 + rng() * 15,
    }));
    L.tufts = Array.from({ length: 13 }, () => ({ x: rng() * PW, h: 9 + rng() * 11, ph: rng() * TAU, k: 1 + Math.floor(rng() * 3) }));
    return L;
  }

  function drawLog(c, x, g) {
    const y = g - 6;
    c.fillStyle = 'rgba(4,14,12,.45)'; c.beginPath(); c.ellipse(x, g + 4, 42, 6, 0, 0, TAU); c.fill();
    c.fillStyle = '#5a3d25'; c.beginPath(); c.roundRect(x - 37, y - 9, 74, 17, 8); c.fill();
    c.fillStyle = '#6e4d30'; c.beginPath(); c.roundRect(x - 34, y - 8, 66, 5, 3); c.fill();
    c.fillStyle = '#b08a5b'; c.beginPath(); c.ellipse(x + 35, y - 1, 5, 8.2, 0, 0, TAU); c.fill();
    c.strokeStyle = '#7b5a36'; c.lineWidth = 1; c.beginPath(); c.ellipse(x + 35, y - 1, 2.5, 4.5, 0, 0, TAU); c.stroke();
    c.fillStyle = '#4f8a3b'; c.beginPath(); c.ellipse(x - 14, y - 9, 11, 3, 0, 0, TAU); c.fill();
  }

  // Encenacao: o mesmo chao em perspectiva do original, agora uma clareira com arvores em volta.
  function paintPerspective(c, rng, glow) {
    const hz = 54, cx = 160;
    const g = c.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, '#163d40'); g.addColorStop(1, '#5d9a7c');
    c.fillStyle = g; c.fillRect(0, 0, PW, hz + 1);
    const sun = c.createRadialGradient(glow, hz - 8, 3, glow, hz - 8, 130);
    sun.addColorStop(0, 'rgba(255,221,150,.7)'); sun.addColorStop(1, 'rgba(240,200,130,0)');
    c.fillStyle = sun; c.fillRect(0, 0, PW, hz + 1);
    for (let i = 0; i < 26; i++) pine(c, rng() * PW, hz + 2, 22 + rng() * 26, 10 + rng() * 8, '#2f6e64', '#285f58');
    const ground = c.createLinearGradient(0, hz, 0, PH);
    ground.addColorStop(0, '#47774a'); ground.addColorStop(0.35, '#2d5a31'); ground.addColorStop(1, '#16321f');
    c.fillStyle = ground; c.fillRect(0, hz, PW, PH - hz);

    // Clareira de terra: o trapezio da grade do original.
    const pt = (u, v) => { // u -1..1 na largura; v 0 (horizonte) a 1 (frente)
      const y = hz + v * (PH - hz), hw = lerp(30, 150, v);
      return [cx + u * hw, y];
    };
    const ring = c.createLinearGradient(0, hz, 0, PH);
    ring.addColorStop(0, '#5f6a48'); ring.addColorStop(0.5, '#4d4630'); ring.addColorStop(1, '#2f2a1d');
    c.fillStyle = ring;
    c.beginPath();
    const a = pt(-1, 0), b = pt(1, 0), d = pt(1, 1), e = pt(-1, 1);
    c.moveTo(...a); c.lineTo(...b); c.lineTo(...d); c.lineTo(...e); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(235,225,190,.11)'; c.lineWidth = 1;
    for (let i = -4; i <= 4; i++) { const p = pt(i / 4, 0), q = pt(i / 4, 1); c.beginPath(); c.moveTo(...p); c.lineTo(...q); c.stroke(); }
    for (let i = 0; i <= 8; i++) { const v = Math.pow(i / 8, 2); const p = pt(-1, v), q = pt(1, v); c.beginPath(); c.moveTo(...p); c.lineTo(...q); c.stroke(); }

    // Arvores nas laterais, do fundo para a frente, crescendo com a perspectiva.
    const trees = [];
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const v = 0.1 + (i / 6) * 0.72 + rng() * 0.05;
      trees.push({ side, v, off: rng() * 22 });
    }
    trees.sort((p, q) => p.v - q.v);
    for (const t of trees) {
      const [ex, y] = pt(t.side, t.v);
      const s = lerp(0.3, 1.5, t.v);
      const x = ex + t.side * (16 * s + t.off * s);
      drawShadow(c, x, y + 1, 18 * s, 0.35);
      pine(c, x, y + 2, 110 * s, 52 * s, t.v > 0.45 ? '#123a34' : '#1b4a44', '#2a2a1e');
    }
    canopy(c, PW, rng);
  }

  /* ---------- Efeitos, com o mesmo tempo dos efeitos do original ---------- */
  function star(c, x, y, r, a) {
    if (r <= 0 || a <= 0) return;
    c.globalAlpha = a; c.fillStyle = C.fx;
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const R = i % 2 ? r * 0.26 : r, t = i / 8 * TAU - Math.PI / 2;
      c.lineTo(x + Math.cos(t) * R, y + Math.sin(t) * R);
    }
    c.closePath(); c.fill(); c.globalAlpha = 1;
  }

  function fxSolido(c, f, x, y) {
    const t = ((f / FPS) % (4 / 3));
    const R = 54;
    c.strokeStyle = C.fx; c.lineCap = 'round'; c.fillStyle = C.fx;
    if (t < 0.17 || t > 1.3) {
      const k = t > 1.3 ? 0 : t / 0.17;
      c.globalAlpha = 0.95 * (1 - k * 0.5); c.lineWidth = 1.6; c.setLineDash([11, 5]); c.lineDashOffset = -f * 0.8;
      c.beginPath(); c.arc(x, y, R - 6 + k * 8, 0, TAU); c.stroke(); c.setLineDash([]);
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.42;
      if (t > 0.1 && t < 0.3) {
        const k = (t - 0.1) / 0.2;
        c.globalAlpha = 1 - k * 0.25; c.lineWidth = 1.5;
        const r1 = R + 2 + k * 8, r2 = r1 + 9 - k * 3;
        c.beginPath(); c.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); c.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); c.stroke();
      }
      if (t > 0.26 && t < 0.62) {
        const k = (t - 0.26) / 0.36;
        c.globalAlpha = (1 - k) * 0.95;
        const r = R + 16 + k * 10;
        c.beginPath(); c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.9 * (1 - k * 0.5), 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  function fxApelo(c, f, p, d) {
    const t = (f / FPS) % 2;
    const cy = p.foot - 30;
    if (t > 0.5 && t < 1.08) {
      const k = (t - 0.5) / 0.58;
      const tailN = 12;
      c.strokeStyle = C.fx; c.lineCap = 'round';
      for (let i = 0; i < tailN; i++) {
        const u = i / tailN, ang = lerp(-0.5, 4.6, k) - u * 1.5;
        const ang2 = lerp(-0.5, 4.6, k) - (u + 1 / tailN) * 1.5;
        c.globalAlpha = (1 - u) * sstep(0, 0.1, k) * (1 - sstep(0.82, 1, k));
        c.lineWidth = 3 * (1 - u) + 0.4;
        const P = (a) => [p.x + Math.cos(a) * 42, cy + Math.sin(a) * 15 - Math.cos(a) * 7];
        c.beginPath(); c.moveTo(...P(ang)); c.lineTo(...P(ang2)); c.stroke();
      }
      c.globalAlpha = 1;
    }
    if (t > 0.9 && t < 1.33) {
      const k = (t - 0.9) / 0.43, s = Math.sin(k * Math.PI);
      star(c, p.x + 30, p.foot - 62, 7 * s, 1);
      star(c, p.x - 36, p.foot - 45, 4.5 * s, 1);
      star(c, p.x + 42, p.foot - 30, 3.5 * s, 0.9);
      // O coracao sai do cachorro.
      const hy = d.foot - 50 - k * 16;
      c.globalAlpha = 1 - sstep(0.6, 1, k); c.fillStyle = '#ff6f7a';
      const hs = 4.2 * (0.6 + s * 0.5), hx = d.x;
      c.beginPath();
      c.moveTo(hx, hy + hs);
      c.bezierCurveTo(hx - hs * 1.7, hy - hs * 0.2, hx - hs * 0.8, hy - hs * 1.3, hx, hy - hs * 0.4);
      c.bezierCurveTo(hx + hs * 0.8, hy - hs * 1.3, hx + hs * 1.7, hy - hs * 0.2, hx, hy + hs);
      c.fill(); c.globalAlpha = 1;
    }
  }

  function fxExagero(c, f) {
    const t = (f / FPS) % 2.5;
    if (t > 1.02 && t < 1.28) star(c, 160, 44, 9 * Math.sin((t - 1.02) / 0.26 * Math.PI), 1);
  }

  function fxArcoDots(c, f, ground) {
    // Pontilhado do arco do original: agora pequenos vagalumes marcando a trajetoria.
    const n = 13;
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = 56 + 206 * u, y = ground - 42 - 4 * 92 * u * (1 - u);
      const tw = 0.55 + 0.35 * Math.sin(f * 0.11 + i * 1.7);
      c.fillStyle = C.firefly; c.globalAlpha = tw;
      c.beginPath(); c.arc(x, y, 1.3, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  function fxSpeedLines(c, p) {
    if (!p.vis || !p.air || p.vy < 3.5) return;
    const top = p.foot - 72 * p.sy;
    c.strokeStyle = C.fx; c.lineWidth = 1; c.lineCap = 'round'; c.globalAlpha = 0.55;
    for (const o of [-13, 0, 13]) {
      const h = o ? 11 : 16;
      c.beginPath(); c.moveTo(p.x + o, top - 4); c.lineTo(p.x + o, top - 4 - h); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function drawDust(c, ev, f) {
    const age = wrap(f - ev.f);
    if (age > 26) return;
    const k = age / 26, a = (1 - k) * 0.62;
    c.fillStyle = C.dust;
    const puff = (px, r) => { c.globalAlpha = a; c.beginPath(); c.arc(px, ev.y - 3 - k * 7 * ev.s, r, 0, TAU); c.fill(); };
    if (ev.dir === 0) {
      for (const s of [-1, 1]) {
        puff(ev.x + s * (28 + k * 30) * ev.s, (4 + k * 7) * ev.s);
        puff(ev.x + s * (40 + k * 34) * ev.s, (3 + k * 5) * ev.s);
      }
    } else {
      puff(ev.x - ev.dir * k * 22, (5 + k * 8) * ev.s);
      puff(ev.x - ev.dir * (9 + k * 26), (3 + k * 6) * ev.s);
      if (ev.lines && age < 15) {
        c.strokeStyle = C.fx; c.lineWidth = 1; c.globalAlpha = 0.6 * (1 - age / 15);
        for (let i = 0; i < 3; i++) {
          const ly = ev.y - 12 - i * 11;
          c.beginPath(); c.moveTo(ev.x - ev.dir * 3, ly); c.lineTo(ev.x - ev.dir * 15, ly); c.stroke();
        }
      }
    }
    c.globalAlpha = 1;
  }

  function drawAmbient(c, L, f) {
    const u = f / N;
    for (const l of L.leaves) {
      const k = (u * l.k + l.ph) % 1;
      const y = 22 + k * 200, x = l.x + Math.sin(k * TAU * 2) * l.sw;
      c.save(); c.translate(x, y); c.rotate(k * TAU * 3);
      c.globalAlpha = 0.85; c.fillStyle = l.col;
      c.beginPath(); c.ellipse(0, 0, 3.2, 1.6, 0, 0, TAU); c.fill(); c.restore();
    }
    c.globalAlpha = 1;
    for (const fl of L.fireflies) {
      const x = fl.x + Math.sin(u * TAU * fl.kx + fl.ph) * fl.ax;
      const y = fl.y + Math.cos(u * TAU * fl.ky + fl.ph) * fl.ay;
      const a = Math.pow(0.5 + 0.5 * Math.sin(u * TAU * fl.kp + fl.ph * 2), 2);
      c.fillStyle = C.firefly;
      c.globalAlpha = a * 0.22; c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fill();
      c.globalAlpha = a * 0.95; c.beginPath(); c.arc(x, y, 1.15, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    c.lineCap = 'round';
    for (const t of L.tufts) {
      const sway = Math.sin(u * TAU * t.k * 3 + t.ph) * 2.6;
      c.strokeStyle = '#0d2a1b'; c.lineWidth = 2.2;
      for (const o of [-3, 0, 3]) {
        c.beginPath(); c.moveTo(t.x + o, PH + 1);
        c.quadraticCurveTo(t.x + o * 1.5, PH - t.h * 0.6, t.x + o * 2 + sway, PH - t.h); c.stroke();
      }
    }
  }

  function drawLabel(c, text) {
    c.font = '500 11.5px "Segoe UI", system-ui, Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(text).width + 22;
    c.fillStyle = 'rgba(16,24,32,.88)';
    c.beginPath(); c.roundRect(PW / 2 - w / 2, 7, w, 18, 9); c.fill();
    c.fillStyle = '#dfe7ee'; c.fillText(text, PW / 2, 16.5);
  }

  /* ---------- Montagem ---------- */
  function buildEntity(key, opts) {
    const P = buildPerson(window.MOTION[key], { ...opts, key });
    const D = buildDog(P, key);
    faceToDog(P, D, opts);
    return { key, P, D, dust: opts.free ? [] : dustEvents(P, D) };
  }

  const SCENE = {};

  function setup(ss) {
    SCENE.ss = ss;
    SCENE.ghost = mkCanvas(PW, PH, ss);
    SCENE.panels = PANELS.map((pn, i) => {
      const ents = pn.id === 'timing'
        ? [buildEntity('timing_a', {}), buildEntity('timing_b', {})]
        : [buildEntity(pn.id, {
          free: pn.id === 'encenacao', scroll: pn.scroll,
          face: pn.scroll ? 1 : undefined,
        })];
      return { ...pn, i, ents, L: buildBackdrop(pn, i, ss) };
    });
  }

  function drawCast(c, e, f) {
    const p = e.P[f], d = e.D[f], t = f / FPS;
    const collar = dogCollar(d);
    const dogFirst = e.key !== 'encenacao' || d.foot <= p.foot;
    const ls = e.key === 'encenacao' ? (p.sx + p.sy) / 2 : 1;
    let hand;
    if (dogFirst) drawDog(c, d, null, t);
    if (p.vis) hand = drawPerson(c, p, collar);
    else hand = { x: p.x, y: -30 };
    if (!dogFirst) drawDog(c, d, null, t);
    drawLeash(c, hand, collar, ls, f);
  }

  function drawGhosts(c, e, f) {
    const g = SCENE.ghost, ss = SCENE.ss;
    for (let i = 6; i >= 1; i--) {
      const q = wrap(f - i * 3), p = e.P[q], d = e.D[q];
      const fast = (who) => Math.abs(who.v !== undefined ? who.v : 0) > 0.8;
      const dV = Math.abs(d.x - e.D[wrap(q - 1)].x) > 0.8;
      if (!fast(p) && !dV) continue;
      g.c.setTransform(ss, 0, 0, ss, 0, 0);
      g.c.clearRect(0, 0, PW, PH);
      if (fast(p)) drawPerson(g.c, p, null, '#ff9a2e');
      if (dV) drawDog(g.c, d, '#f0e3c8', q / FPS);
      c.globalAlpha = 0.34 * (1 - i / 7);
      c.drawImage(g.k, 0, 0, PW, PH);
      c.globalAlpha = 1;
    }
  }

  function drawPanel(c, pn, f) {
    const L = pn.L;
    c.save();
    c.beginPath(); c.rect(0, 0, PW, PH); c.clip();
    for (const l of L.layers) {
      const off = (l.speed * f) % l.w;
      c.drawImage(l.canvas, -off, 0, l.w, PH);
      if (l.speed) c.drawImage(l.canvas, l.w - off, 0, l.w, PH);
    }
    if (pn.id === 'arco') fxArcoDots(c, f, pn.ents[0].P[0].ground);

    for (const e of pn.ents) {
      const p = e.P[f], d = e.D[f];
      const g = p.ground === null ? p.foot : p.ground;
      const gd = d.ground === null || d.ground === undefined ? d.foot : d.ground;
      if (p.vis) drawShadow(c, p.x, g, 25 * p.sx * (1 - clamp(p.air / 170, 0, 0.6)), 0.42);
      drawShadow(c, d.x, gd, 19 * d.sx * (1 - clamp(d.lift / 90, 0, 0.6)), 0.38);
    }
    if (pn.id === 'timing') for (const e of pn.ents) drawGhosts(c, e, f);
    for (const e of pn.ents) {
      for (const ev of e.dust) drawDust(c, ev, f);
      drawCast(c, e, f);
      fxSpeedLines(c, e.P[f]);
    }
    const e0 = pn.ents[0], p0 = e0.P[f];
    if (pn.id === 'solido') fxSolido(c, f, p0.x, p0.foot - 33 * p0.sy);
    if (pn.id === 'apelo') fxApelo(c, f, p0, e0.D[f]);
    if (pn.id === 'exagero') fxExagero(c, f);

    drawAmbient(c, L, f);
    c.drawImage(L.vignette, 0, 0, PW, PH);
    drawLabel(c, pn.label);
    c.restore();
    c.strokeStyle = '#142029'; c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, PW - 1, PH - 1);
  }

  function renderFrame(ctx, f) {
    f = wrap(Math.round(f));
    const ss = SCENE.ss;
    ctx.setTransform(ss, 0, 0, ss, 0, 0);
    ctx.fillStyle = '#070b10'; ctx.fillRect(0, 0, 1280, 720);
    for (const pn of SCENE.panels) {
      ctx.setTransform(ss, 0, 0, ss, (pn.i % 4) * PW * ss, Math.floor(pn.i / 4) * PH * ss);
      drawPanel(ctx, pn, f);
    }
  }

  window.Forest = {
    setup, renderFrame, FPS, N,
    // Pecas reaproveitadas pelo filme (src/story.js).
    kit: { C, TAU, clamp, lerp, sstep, rngOf, mkCanvas, drawPerson, drawDog, dogCollar, drawLeash, drawShadow,
      pine, broadTrunk, canopy, paintGround, drawLog, star },
  };
})();
