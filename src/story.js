/* Filme de 20s: passeio na floresta, encontro com o urso, fuga, cabana e lago.
 * Tudo e funcao do quadro: as curvas sao calculadas uma vez em build() e drawFrame so as desenha. */
(() => {
  'use strict';
  const { C, TAU, clamp, lerp, sstep, rngOf, mkCanvas, drawPerson, drawDog, dogCollar, drawLeash, drawShadow,
    pine, broadTrunk, canopy, paintGround, drawLog, star } = window.Forest.kit;

  const FPS = 60, N = 1200;
  const G = 300, YTOP = -40, YBOT = 450;      // chao e limites verticais do mundo
  const ZMAX = 2.6;                           // zoom maximo: define a resolucao das camadas pintadas
  const LOG_X = 880, BUSH_X = 205, CABIN_X = 1470, SHORE_X = 1650, FINAL_CAM = 1720, SUN_X = 1810;

  /* ---------- Curvas ---------- */
  const EASE = {
    l: (u) => u,
    i: (u) => u * u,
    o: (u) => 1 - (1 - u) * (1 - u),
    io: (u) => u * u * (3 - 2 * u),
  };
  // Chaves [tempo, valor, curva]; a curva vale para o trecho que termina naquela chave.
  const K = (keys) => (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        return lerp(v0, v1, EASE[e || 'io']((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  };
  const bump = (t, c, w, a) => a * Math.exp(-(((t - c) / w) ** 2));
  const hopAt = (t, hops) => {
    for (const [a, b, h] of hops) if (t > a && t < b) { const u = (t - a) / (b - a); return 4 * h * u * (1 - u); }
    return 0;
  };
  // Antecipa, estica na saida, comprime na chegada.
  const hopSquash = (t, hops, k = 1) => {
    let s = 0;
    for (const [a, b] of hops) s += bump(t, a - 0.09, 0.07, -0.26 * k) + bump(t, a + 0.06, 0.08, 0.28 * k) + bump(t, b + 0.03, 0.07, -0.3 * k);
    return s;
  };

  const P_HOPS = [[7.55, 8.05, 54], [11.1, 11.55, 64]];
  const D_HOPS = [[7.62, 7.98, 34], [10.72, 11.12, 52], [16.5, 16.82, 16], [18.05, 18.37, 16]];

  const pX = K([[0, 110], [5.4, 370, 'l'], [5.75, 378, 'o'], [8.6, 378], [9.05, 366], [9.6, 450, 'i'], [13.6, 1450, 'l'], [14.2, 1570, 'o'], [14.5, 1560]]);
  const pLean = K([[0, 0.03], [5.4, 0.03], [5.7, 0], [8.6, 0], [9.05, -0.34], [9.35, 0.38, 'i'], [13.6, 0.3], [14.0, -0.44], [14.4, 0.07, 'o'], [14.8, 0]]);
  const pFace = K([[6.05, 1], [6.35, -1], [8.72, -1], [9.0, 1]]);

  const dX = K([[0, 175], [1.8, 270, 'l'], [2.4, 285, 'o'], [3.05, 285], [5.2, 440], [5.6, 446, 'o'], [8.78, 446], [9.0, 438], [9.45, 515, 'i'], [13.4, 1510, 'l'], [14.0, 1636, 'o'], [14.35, 1624]]);
  const dFace = K([[5.72, 1], [5.95, -1], [8.82, -1], [9.0, 1]]);
  const dLean = K([[8.78, 0], [9.0, -0.26], [9.3, 0.3, 'i'], [13.4, 0.26], [13.9, -0.38], [14.3, 0, 'o']]);
  const dSit = K([[15.1, 0], [15.4, 1]]);

  const bX = K([[9.3, BUSH_X], [9.75, 285, 'i'], [11.63, 800, 'l'], [11.72, 806, 'o']]);
  const bRise = K([[6.55, 0], [7.05, 1.06, 'o'], [7.2, 1]]);
  const bStand = K([[6.55, 0.7], [7.05, 1], [8.7, 1], [9.1, 0]]);
  const bMouth = K([[7.38, 0], [7.5, 1, 'o'], [8.45, 1], [8.7, 0.15], [9.4, 0.15], [9.6, 0.6], [11.6, 0.6], [11.7, 0.1]]);

  const camX = K([[0, 180], [5.4, 395, 'l'], [5.9, 400, 'o'], [6.8, 325], [9.1, 325], [10.4, 700, 'i'], [13.6, 1500, 'l'], [15.8, FINAL_CAM]]);
  const camZ = K([[0, 2.4], [6.2, 2.4], [7.4, 2.58], [8.8, 2.58], [9.6, 2.4], [13.4, 2.4], [15.8, 1.75]]);
  const camA = K([[13.4, 569], [15.8, 472]]);     // altura do chao na tela: desce para mostrar o lago

  const scared = (t) => t > 7.5 && t < 14.5;

  /* ---------- Pre-calculo ---------- */
  function build() {
    const fr = [];
    let pPh = 0, pAmp = 1, dPh = 0, dAmp = 1, bPh = 0, bAmp = 0;
    let ear = 0, earV = 0, tail = 0, tailV = 0, sit = 0;
    let lastPx = pX(0), lastDx = dX(0), lastBx = bX(0), lastLift = 0;
    for (let f = 0; f < N; f++) {
      const t = f / FPS;
      const x = pX(t), v = x - lastPx; lastPx = x;
      const speed = Math.abs(v);
      pPh += (speed / lerp(36, 74, clamp(speed / 4.2, 0, 1))) * TAU;
      pAmp += ((speed > 0.1 ? 1 : 0) - pAmp) * 0.18;
      const air = hopAt(t, P_HOPS);
      const fear = bump(t, 7.8, 0.22, 0.62);                 // exagero: o susto estica o corpo
      const antic = sstep(8.6, 9.05, t) * (1 - sstep(9.05, 9.18, t)) * -0.3;
      const launch = bump(t, 9.24, 0.1, 0.28);
      const skid = bump(t, 14.1, 0.16, -0.24) + bump(t, 14.45, 0.1, 0.1);
      const pant = 0.07 * Math.sin(t * TAU * 1.7) * sstep(14.3, 14.6, t) * (1 - sstep(15.6, 17, t));
      const breath = 0.014 * Math.sin(t * TAU * 0.55);
      const runBob = speed > 2 ? 0.045 * Math.sin(pPh * 2) : 0;
      const sy = 1 + hopSquash(t, P_HOPS) + fear + antic + launch + skid + pant + breath + runBob;
      const sx = clamp(1 - (sy - 1) * 0.72, 0.5, 1.6);
      const p = {
        vis: true, x, foot: G - air, sx, sy, lean: pLean(t), face: pFace(t), phase: pPh, amp: pAmp, air,
        sq: 0, pomGap: 5 + clamp(bump(t, 7.75, 0.2, 18) + bump(t, 11.3, 0.2, 14) + speed * 1.4, 0, 30),
        blink: !scared(t) && (t % 3.7) < 0.1 ? 1 : 0,
        eyeS: scared(t) ? 1.4 : 1, mouthO: scared(t) ? 0.9 + Math.sin(t * 20) * 0.1 : 0, ground: G,
      };
      if (Math.abs(p.face) < 0.55) p.face = p.face < 0 ? -0.55 : 0.55;

      const dx = dX(t), dv = dx - lastDx; lastDx = dx;
      const dSpeed = Math.abs(dv);
      dPh += (dSpeed / lerp(22, 50, clamp(dSpeed / 4.2, 0, 1))) * TAU;
      dAmp += ((dSpeed > 0.08 ? 1 : 0) - dAmp) * 0.2;
      const lift = hopAt(t, D_HOPS);
      const vy = lift - lastLift; lastLift = lift;
      earV += (clamp(-dv * 0.2 - vy * 0.1, -1.1, 1.1) - ear) * 0.16; earV *= 0.78; ear += earV;
      tailV += (clamp(-dv * 0.15, -0.9, 0.9) - tail) * 0.14; tailV *= 0.8; tail += tailV;
      sit += (dSit(t) - sit) * 0.14;
      const barking = t > 6.0 && t < 7.4 && (t * 3.2) % 1 < 0.45;
      const dSy = 1 + hopSquash(t, D_HOPS, 0.8) + (barking ? 0.05 : 0) + bump(t, 8.92, 0.1, -0.22) + bump(t, 14.05, 0.14, -0.18)
        + 0.05 * Math.sin(t * TAU * 2.4) * sstep(14.3, 14.6, t) * (1 - sstep(15.8, 17, t));
      const sniff = t > 2.4 && t < 3.05;
      // Depois de chegar, o cachorro acompanha os peixes com o olhar.
      const fishLook = t > 15.2 ? -0.32 + bump(t, 16.6, 0.3, -0.3) + bump(t, 18.2, 0.3, -0.3) : 0;
      const d = {
        x: dx, foot: G - lift, lift, sx: clamp(1 - (dSy - 1) * 0.7, 0.6, 1.5), sy: dSy, lean: dLean(t),
        face: dFace(t), phase: dPh, amp: dAmp, ear, tail, sit, beg: 0, lie: 0,
        wag: t > 15 ? 1.7 : scared(t) ? 0.15 : t > 5.6 && t < 7.4 ? 0.1 : 0.9,
        pant: t > 14 || (t > 0.5 && t < 5.5), bark: barking ? 1 : 0,
        look: sniff ? 0.3 + Math.sin(t * 24) * 0.08 : t > 5.7 && t < 9 ? -0.16 : fishLook, ground: G,
      };
      if (Math.abs(d.face) < 0.55) d.face = d.face < 0 ? -0.55 : 0.55;

      const bx = bX(t), bv = bx - lastBx; lastBx = bx;
      bPh += (bv / 88) * TAU;
      bAmp += ((bv > 0.2 ? 1 : 0) - bAmp) * 0.15;
      const rise = bRise(t);
      const roar = bump(t, 7.32, 0.09, -0.16) + bump(t, 7.6, 0.14, 0.16) + 0.02 * Math.sin(t * 46) * (t > 7.5 && t < 8.5 ? 1 : 0);
      const crash = t > 11.6 ? Math.exp(-(t - 11.6) * 3.5) : 0;
      const bSy = 1 + roar + bump(t, 8.95, 0.1, -0.16) + bump(t, 9.3, 0.1, 0.1) + crash * 0.2;
      const b = {
        x: bx, foot: G + (1 - rise) * 118, sx: clamp((1 - (bSy - 1) * 0.6) * (1 - crash * 0.42), 0.4, 1.4), sy: bSy,
        lean: bAmp > 0.3 && t < 11.6 ? 0.18 : t > 11.6 ? -0.14 * crash : 0, stand: bStand(t), mouth: bMouth(t),
        phase: bPh, amp: bAmp, dazed: t > 11.66,
      };
      fr.push({ t, p, d, b, cx: camX(t), z: camZ(t), a: camA(t) });
    }
    return fr;
  }

  /* ---------- Camadas pintadas ---------- */
  function layer(k, lx0, W, B, paint) {
    const m = mkCanvas(W, YBOT - YTOP, B);
    m.c.translate(-lx0, -YTOP);
    paint(m.c);
    return { k, lx0, W, canvas: m.k };
  }

  function paintMountains(c, rng) {
    const ridge = (base, amp, col, seed) => {
      const r = rngOf(seed);
      c.fillStyle = col; c.beginPath(); c.moveTo(-400, G);
      let y = base;
      for (let x = -400; x <= 800; x += 26) {
        y = clamp(y + (r() - 0.5) * amp, base - amp * 2.4, base + amp);
        c.lineTo(x, y);
      }
      c.lineTo(800, G); c.closePath(); c.fill();
    };
    ridge(G - 112, 15, '#c7a596', 11 + (rng() * 5 | 0));
    ridge(G - 78, 12, '#93a08f', 23);
  }

  // Sub-bosque fechado no pe das arvores: sem ele, o ceu aparece em blocos entre os troncos.
  function undergrowth(c, end, h, col, rng) {
    c.fillStyle = col;
    c.fillRect(-300, G - h, end + 300, h + 2);
    for (let x = -300; x < end; x += 9 + rng() * 11) {
      c.beginPath(); c.arc(x, G - h, 7 + rng() * (h * 0.32), 0, TAU); c.fill();
    }
  }

  function paintFarTrees(c, rng, end) {
    for (let x = -300; x < end; x += 12 + rng() * 11) {
      const fade = 1 - sstep(end - 240, end, x) * 0.55;
      const h = (150 + rng() * 120) * fade;
      pine(c, x, G - 6, h, h * 0.27, '#2f6e64', '#285f58');
    }
    undergrowth(c, end - 60, 62, '#2f6e64', rng);
    const fog = c.createLinearGradient(0, G - 110, 0, G);
    fog.addColorStop(0, 'rgba(180,225,195,0)'); fog.addColorStop(1, 'rgba(180,225,195,.24)');
    c.fillStyle = fog; c.fillRect(-300, G - 110, end + 400, 110);
  }

  function paintMidTrees(c, rng, end) {
    for (let x = -300; x < end; x += 26 + rng() * 30) {
      const fade = 1 - sstep(end - 300, end, x) * 0.5;
      const h = (220 + rng() * 170) * fade;
      pine(c, x, G - 2, h, h * 0.3, '#1b4a44', '#16362f');
    }
    undergrowth(c, end - 90, 40, '#1b4a44', rng);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let x = -200; x < end - 200; x += 110 + rng() * 140) {
      const w = 14 + rng() * 28;
      const g = c.createLinearGradient(0, -40, 0, G);
      g.addColorStop(0, 'rgba(255,226,160,.16)'); g.addColorStop(1, 'rgba(255,226,160,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(x, -40); c.lineTo(x + w, -40); c.lineTo(x + w - 90, G); c.lineTo(x - 90 - w * 0.4, G); c.closePath(); c.fill();
    }
    c.restore();
  }

  function bushShape(c, x, y, s, col, hi) {
    const blobs = [[-44, -18, 26], [-20, -34, 30], [12, -38, 32], [40, -22, 27], [0, -16, 34], [-30, -8, 22], [32, -8, 22]];
    c.fillStyle = col;
    for (const [bx, by, r] of blobs) { c.beginPath(); c.arc(x + bx * s, y + by * s, r * s, 0, TAU); c.fill(); }
    c.fillStyle = hi;
    for (const [bx, by, r] of blobs.slice(0, 4)) { c.beginPath(); c.arc(x + (bx - 5) * s, y + (by - 7) * s, r * 0.55 * s, 0, TAU); c.fill(); }
  }

  function drawCabin(c, x, g) {
    const w = 150, h = 78, l = x - w / 2, top = g - 8 - h;
    // Sombra no chao.
    c.fillStyle = 'rgba(4,14,12,.35)'; c.beginPath(); c.ellipse(x, g - 6, w * 0.62, 10, 0, 0, TAU); c.fill();
    // Chamine.
    c.fillStyle = '#66625e'; c.fillRect(x + 34, top - 66, 20, 66);
    c.fillStyle = '#4d4a47'; c.fillRect(x + 31, top - 70, 26, 6);
    c.fillStyle = 'rgba(30,25,22,.35)';
    for (let i = 0; i < 6; i++) c.fillRect(x + 34 + (i % 2) * 6, top - 62 + i * 10, 10, 2);
    // Toras das paredes.
    const logs = 7, lh = h / logs;
    for (let i = 0; i < logs; i++) {
      const y = top + i * lh;
      const g2 = c.createLinearGradient(0, y, 0, y + lh);
      g2.addColorStop(0, '#9a6a3c'); g2.addColorStop(0.5, '#845630'); g2.addColorStop(1, '#5e3b20');
      c.fillStyle = g2; c.beginPath(); c.roundRect(l - 5, y, w + 10, lh + 0.5, lh / 2); c.fill();
      c.fillStyle = '#c29a68';
      for (const ex of [l - 3, l + w + 3]) { c.beginPath(); c.ellipse(ex, y + lh / 2, 3.2, lh / 2 - 0.4, 0, 0, TAU); c.fill(); }
    }
    // Telhado.
    const rg = c.createLinearGradient(0, top - 56, 0, top + 6);
    rg.addColorStop(0, '#5c4432'); rg.addColorStop(1, '#3b2a1e');
    c.fillStyle = rg;
    c.beginPath(); c.moveTo(l - 20, top + 5); c.lineTo(x, top - 56); c.lineTo(l + w + 20, top + 5); c.lineTo(l + w + 14, top + 11); c.lineTo(l - 14, top + 11); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,220,170,.10)'; c.lineWidth = 1.3;
    for (let i = 1; i <= 5; i++) {
      const u = i / 6;
      c.beginPath(); c.moveTo(lerp(x, l - 20, u), lerp(top - 56, top + 5, u)); c.lineTo(lerp(x, l + w + 20, u), lerp(top - 56, top + 5, u)); c.stroke();
    }
    // Frontao, porta e janelas iluminadas.
    c.fillStyle = '#7b5230'; c.beginPath(); c.moveTo(l + 4, top + 4); c.lineTo(x, top - 46); c.lineTo(l + w - 4, top + 4); c.closePath(); c.fill();
    c.fillStyle = '#ffd98a'; c.beginPath(); c.arc(x, top - 16, 9, 0, TAU); c.fill();
    c.strokeStyle = '#4a2e18'; c.lineWidth = 2; c.beginPath(); c.arc(x, top - 16, 9, 0, TAU); c.moveTo(x - 9, top - 16); c.lineTo(x + 9, top - 16); c.moveTo(x, top - 25); c.lineTo(x, top - 7); c.stroke();
    c.fillStyle = '#4a2e18'; c.beginPath(); c.roundRect(x - 15, g - 58, 30, 50, [11, 11, 0, 0]); c.fill();
    c.fillStyle = '#6b4526'; c.beginPath(); c.roundRect(x - 12, g - 55, 24, 47, [9, 9, 0, 0]); c.fill();
    c.fillStyle = '#e8c15c'; c.beginPath(); c.arc(x + 7, g - 30, 1.8, 0, TAU); c.fill();
    for (const wx of [l + 28, l + w - 28]) {
      c.fillStyle = '#4a2e18'; c.fillRect(wx - 16, top + 21, 32, 29);
      const glass = c.createRadialGradient(wx, top + 35, 2, wx, top + 35, 22);
      glass.addColorStop(0, '#fff0b8'); glass.addColorStop(1, '#f2b04e');
      c.fillStyle = glass; c.fillRect(wx - 13, top + 24, 26, 23);
      c.fillStyle = '#4a2e18'; c.fillRect(wx - 1, top + 24, 2, 23); c.fillRect(wx - 13, top + 34.5, 26, 2);
      c.fillStyle = '#5e3b20'; c.fillRect(wx - 18, top + 50, 36, 4);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = i % 2 ? '#e8596b' : '#f4d35e';
        c.beginPath(); c.arc(wx - 13 + i * 5.2, top + 48 + (i % 2), 2.5, 0, TAU); c.fill();
      }
    }
    c.fillStyle = '#6e5233'; c.fillRect(x - 22, g - 9, 44, 4);
    c.fillStyle = '#54402a'; c.fillRect(x - 26, g - 5, 52, 4);
  }

  function paintLake(c, rng) {
    const R = 2700, far = G - 44;
    // Margem de la, com pinheiros pequenos.
    const land = c.createLinearGradient(0, far - 22, 0, far + 4);
    land.addColorStop(0, '#3e7240'); land.addColorStop(1, '#2d5a31');
    c.fillStyle = land;
    c.beginPath(); c.moveTo(SHORE_X - 130, far + 8);
    c.quadraticCurveTo(SHORE_X - 30, far - 14, SHORE_X + 80, far - 11);
    for (let x = SHORE_X + 80; x <= R; x += 40) c.lineTo(x, far - 11 - Math.sin(x * 0.02) * 4);
    c.lineTo(R, far + 8); c.closePath(); c.fill();
    const farTrees = [];
    for (let x = SHORE_X - 30; x < R; x += 11 + rng() * 15) farTrees.push({ x, h: 34 + rng() * 44, w: 15 + rng() * 9, d: rng() });
    for (const t of farTrees) pine(c, t.x, far - 6, t.h, t.w, t.d > 0.5 ? '#2a6158' : '#225048', '#1e443d');

    // Agua: reflete o ceu do por do sol; o azul profundo vem para a frente.
    const water = c.createLinearGradient(0, far, 0, YBOT);
    water.addColorStop(0, '#f0bd7c'); water.addColorStop(0.2, '#c8a988'); water.addColorStop(0.5, '#4f9a9c'); water.addColorStop(1, '#17525f');
    const path = () => {
      c.beginPath(); c.moveTo(R, far); c.lineTo(SHORE_X + 40, far);
      c.bezierCurveTo(SHORE_X - 10, far + 6, SHORE_X - 22, G + 4, SHORE_X - 6, G + 26);
      c.bezierCurveTo(SHORE_X + 12, G + 58, SHORE_X - 40, G + 90, SHORE_X - 70, YBOT);
      c.lineTo(R, YBOT); c.closePath();
    };
    path(); c.fillStyle = water; c.fill();
    c.save(); path(); c.clip();
    // Reflexo dos pinheiros e do sol.
    c.globalAlpha = 0.42;
    for (const t of farTrees) {
      c.save(); c.translate(0, 2 * far); c.scale(1, -1);
      pine(c, t.x, far - 2, t.h * 0.86, t.w, '#1c4a44', '#1c4a44');
      c.restore();
    }
    c.globalAlpha = 1;
    const sunCol = c.createLinearGradient(0, far, 0, YBOT);
    sunCol.addColorStop(0, 'rgba(255,232,170,.75)'); sunCol.addColorStop(1, 'rgba(255,214,140,0)');
    c.fillStyle = sunCol;
    c.filter = 'blur(16px)';
    c.beginPath(); c.moveTo(SUN_X - 24, far); c.lineTo(SUN_X + 24, far); c.lineTo(SUN_X + 72, YBOT); c.lineTo(SUN_X - 72, YBOT); c.closePath(); c.fill();
    c.filter = 'none';
    c.restore();

    // Barra clara da margem e areia.
    c.save();
    path();
    c.strokeStyle = 'rgba(232,214,168,.8)'; c.lineWidth = 3.5; c.stroke();
    c.restore();

    // Pier de madeira.
    const py = G + 26;
    c.fillStyle = 'rgba(10,30,34,.3)'; c.fillRect(SHORE_X - 8, py + 8, 112, 7);
    c.fillStyle = '#4a3320';
    for (const x of [SHORE_X + 12, SHORE_X + 52, SHORE_X + 92]) c.fillRect(x, py + 3, 5, 17);
    for (let i = 0; i < 15; i++) {
      c.fillStyle = i % 2 ? '#9a7248' : '#86613c';
      c.fillRect(SHORE_X - 8 + i * 7.5, py - 2, 7, 8);
    }

    // Vitorias-regias e juncos.
    const pads = [[SHORE_X + 180, G + 58, 13], [SHORE_X + 214, G + 74, 16], [SHORE_X + 150, G + 92, 18], [SHORE_X + 395, G + 86, 15], [SHORE_X + 430, G + 106, 19]];
    for (const [x, y, r] of pads) {
      c.fillStyle = '#3f8a4f'; c.beginPath(); c.ellipse(x, y, r, r * 0.34, 0, 0.3, TAU - 0.05); c.lineTo(x, y); c.closePath(); c.fill();
      c.fillStyle = '#5aa863'; c.beginPath(); c.ellipse(x - 2, y - 1, r * 0.55, r * 0.15, 0, 0, TAU); c.fill();
    }
    for (const [x, y] of [[SHORE_X + 214, G + 69], [SHORE_X + 430, G + 100]]) {
      c.fillStyle = '#ffd3e0';
      for (let a = 0; a < 6; a++) { c.beginPath(); c.ellipse(x + Math.cos(a) * 4, y + Math.sin(a) * 1.4, 3.3, 1.8, a, 0, TAU); c.fill(); }
      c.fillStyle = '#ffe27a'; c.beginPath(); c.arc(x, y - 1, 1.8, 0, TAU); c.fill();
    }
    for (let i = 0; i < 26; i++) {
      const x = SHORE_X - 58 + rng() * 34, y = G + 62 + rng() * 74, h = 22 + rng() * 26;
      c.strokeStyle = i % 3 ? '#3e7a3a' : '#57924a'; c.lineWidth = 1.7;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 2, y - h * 0.6, x + 4 + rng() * 6, y - h); c.stroke();
      if (i % 5 === 0) { c.fillStyle = '#6a4326'; c.beginPath(); c.roundRect(x + 2, y - h - 7, 4, 11, 2); c.fill(); }
    }
  }

  function setup(ss) {
    const B = ss * ZMAX, rng = rngOf(4242);
    const S = { ss, frames: build() };
    const midEnd = FINAL_CAM * 0.6 - 90, farEnd = FINAL_CAM * 0.35 - 30;
    S.layers = [
      layer(0.12, -400, 1200, B, (c) => paintMountains(c, rng)),
      layer(0.35, -300, 960, B, (c) => paintFarTrees(c, rng, farEnd)),
      layer(0.6, -300, 1340, B, (c) => paintMidTrees(c, rng, midEnd)),
      layer(1, -200, 2900, B, (c) => {
        // Troncos grandes, rareando ate a clareira.
        const trunks = [];
        for (let x = -220; x < 1320; x += 92 + rng() * 118) trunks.push({ x, w: 15 + rng() * 15, s: rng() * 1e4 | 0 });
        for (const t of trunks) {
          c.save(); c.translate(0, 0);
          broadTrunk(c, t.x, G - 7, t.w, '#10302d', '#25574c', rngOf(t.s));
          c.fillStyle = '#10302d'; c.fillRect(t.x - t.w * 0.36, YTOP, t.w * 0.72, 40);
          c.restore();
        }
        c.save(); c.translate(-200, 0); c.beginPath(); c.rect(0, YTOP, 2900, YBOT - YTOP); c.clip();
        paintGround(c, 2900, YTOP, G, YBOT, rng, { noTrunks: true });
        c.restore();
        // Copas altas fechando a floresta; somem antes da clareira.
        c.fillStyle = '#0d2826';
        for (let x = -220; x < 1340; x += 7 + rng() * 9) {
          const fade = 1 - sstep(1040, 1340, x);
          c.beginPath(); c.arc(x, 60 - rng() * 30 - (1 - fade) * 70, (16 + rng() * 26) * fade + 1, 0, TAU); c.fill();
        }
        c.fillRect(-220, YTOP, 1320, 76);
        for (const [x, s] of [[60, 0.8], [470, 0.7], [640, 0.95], [1120, 0.8], [1270, 0.9]]) bushShape(c, x, G - 8, s, '#1b4f30', '#2c6b3c');
        drawLog(c, LOG_X, G);
        drawCabin(c, CABIN_X, G);
        for (const [x, s] of [[CABIN_X - 110, 0.62], [CABIN_X + 92, 0.42]]) bushShape(c, x, G - 8, s, '#28653a', '#3d8449');
        paintLake(c, rng);
      }),
    ];
    S.front = layer(1.3, -100, 1900, B, (c) => {
      for (let x = -100; x < 1790; x += 18 + rng() * 42) {
        c.fillStyle = rng() > 0.5 ? '#07201a' : '#0a2a20';
        for (let a = -3; a <= 3; a++) {
          c.beginPath(); c.ellipse(x + a * 7, G + 78 - (3 - Math.abs(a)) * 8, 5, 22, a * 0.32, 0, TAU); c.fill();
        }
      }
    });
    S.mid = S.layers;
    const pr = rngOf(77);
    S.leaves = Array.from({ length: 16 }, () => ({ x: pr() * 1400, y: pr(), sw: 8 + pr() * 16, s: 0.08 + pr() * 0.1, ph: pr() * TAU, col: pr() > 0.5 ? '#d7a23c' : '#c9692d' }));
    S.flies = Array.from({ length: 22 }, () => ({ x: pr() * 1400, y: 100 + pr() * 190, ph: pr() * TAU, k: 0.35 + pr() * 0.9 }));
    S.shimmer = Array.from({ length: 70 }, () => ({ x: SHORE_X + 10 + pr() * 900, y: G - 36 + pr() * pr() * 180, w: 5 + pr() * 18, ph: pr() * TAU, k: 1 + pr() * 2 }));
    S.dust = [];
    const addDust = (who, x, a, b, dt, s) => {
      for (let t = a; t < b; t += dt) S.dust.push({ t, x: x(t) + (pr() - 0.5) * 8, y: G - 1, s: s * (0.7 + pr() * 0.6), who });
    };
    addDust('p', pX, 9.2, 13.7, 0.075, 1);
    addDust('d', dX, 9.05, 13.5, 0.09, 0.65);
    addDust('b', (t) => bX(t) - 18, 9.45, 11.65, 0.065, 1.5);
    addDust('p', pX, 13.75, 14.3, 0.028, 1.5);
    addDust('d', dX, 13.6, 14.15, 0.03, 1);
    S.birds = Array.from({ length: 9 }, () => ({ x: 120 + pr() * 300, y: 90 + pr() * 40, vx: 35 + pr() * 90, vy: -(90 + pr() * 70), ph: pr() * TAU }));
    // Peixes: [salta em t, x, distancia na agua, altura do salto, tamanho, direcao]
    S.fish = [
      [15.05, 1860, G + 30, 74, 1.05, -1], [15.95, 1990, G - 2, 54, 0.74, 1], [16.45, 1762, G + 54, 88, 1.3, 1],
      [17.15, 1930, G + 8, 60, 0.82, -1], [17.7, 2060, G + 28, 66, 1.05, -1], [18.02, 1820, G + 72, 96, 1.45, 1],
      [18.75, 1955, G + 42, 80, 1.15, -1], [19.2, 1745, G + 12, 56, 0.82, 1],
    ];
    window.Story.state = S;
    return S;
  }

  /* ---------- Coisas vivas ---------- */
  function drawBear(c, b, t) {
    const st = b.stand, fur = '#6e4526', dark = '#553318', pale = '#c79a68';
    const rock = Math.sin(b.phase) * b.amp;
    c.save();
    c.transform(b.sx, 0, -b.lean * b.sy, b.sy, b.x, b.foot);
    c.lineCap = 'round'; c.lineJoin = 'round';
    const hip = { x: lerp(-32, -8, st), y: lerp(-40 - rock * 5, -36, st) };
    const chest = { x: lerp(28, 2, st), y: lerp(-44 + rock * 6, -96, st) };
    // Patas de tras (fundo).
    const leg = (from, ph, dx, col, up, sw) => {
      const s = Math.sin(ph) * b.amp, u = Math.max(0, Math.cos(ph)) * b.amp;
      c.strokeStyle = col; c.lineWidth = 15;
      c.beginPath(); c.moveTo(from.x + dx, from.y + 8);
      c.lineTo(lerp(from.x + dx + s * sw, from.x + dx + up * 22, st * (up ? 1 : 0)), lerp(-5 - u * 9, from.y - 30, st * (up ? 1 : 0))); c.stroke();
    };
    leg(hip, b.phase + 0.9, -6, dark, 0, 22);
    leg(chest, b.phase + 3.6, 8, dark, 1, 24);
    // Tronco e barriga.
    c.strokeStyle = fur; c.lineWidth = 48;
    c.beginPath(); c.moveTo(hip.x, hip.y); c.lineTo(chest.x, chest.y); c.stroke();
    const ang = Math.atan2(chest.y - hip.y, chest.x - hip.x);
    c.fillStyle = pale; c.globalAlpha = 0.9;
    c.beginPath(); c.ellipse(lerp(hip.x, chest.x, 0.5) + Math.sin(ang) * lerp(0, 12, st) + lerp(0, 2, st), lerp(hip.y, chest.y, 0.5) + lerp(14, 2, st), lerp(26, 15, st), lerp(9, 26, st), 0, 0, TAU); c.fill();
    c.globalAlpha = 1;
    leg(hip, b.phase, 6, fur, 0, 22);
    leg(chest, b.phase + 2.7, -5, fur, 1, 24);
    if (st > 0.5) { // Garras erguidas.
      c.fillStyle = '#efe6d4';
      for (const ax of [chest.x + 17, chest.x + 25]) for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(ax + i * 4, chest.y - 31, 1.7, 0, TAU); c.fill(); }
    }
    // Cabeca.
    const hx = chest.x + lerp(30, 10, st), hy = chest.y + lerp(-13, -28, st);
    c.save(); c.translate(hx, hy); c.rotate(-0.34 * b.mouth * st + (b.dazed ? 0.2 : 0));
    c.fillStyle = fur;
    for (const ex of [-13, 11]) { c.beginPath(); c.arc(ex, -19, 8.5, 0, TAU); c.fill(); }
    c.fillStyle = pale;
    for (const ex of [-13, 11]) { c.beginPath(); c.arc(ex, -19, 4.2, 0, TAU); c.fill(); }
    c.fillStyle = fur; c.beginPath(); c.arc(0, 0, 23, 0, TAU); c.fill();
    c.fillStyle = pale; c.beginPath(); c.ellipse(16, 6 - b.mouth * 2, 15, 11, 0, 0, TAU); c.fill();
    if (b.mouth > 0.05) {
      const mh = 13 * b.mouth;
      c.fillStyle = '#3a1512'; c.beginPath(); c.ellipse(19, 11, 11, mh * 0.72 + 1, 0, 0, TAU); c.fill();
      c.fillStyle = '#d65b67'; c.beginPath(); c.ellipse(20, 11 + mh * 0.34, 7, mh * 0.34, 0, 0, TAU); c.fill();
      c.fillStyle = '#f7f1e2';
      for (const tx of [12, 18, 24]) { c.beginPath(); c.moveTo(tx - 2.2, 11 - mh * 0.62); c.lineTo(tx + 2.2, 11 - mh * 0.62); c.lineTo(tx, 11 - mh * 0.62 + 4.5); c.closePath(); c.fill(); }
    }
    c.fillStyle = C.ink; c.beginPath(); c.ellipse(25, 0 - b.mouth * 3, 4.6, 3.5, 0, 0, TAU); c.fill();
    if (b.dazed) {
      c.strokeStyle = C.ink; c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(3, -10); c.lineTo(10, -3); c.moveTo(10, -10); c.lineTo(3, -3); c.stroke();
    } else {
      c.fillStyle = C.ink; c.beginPath(); c.arc(7, -6, 2.8, 0, TAU); c.fill();
      c.strokeStyle = dark; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, -14); c.lineTo(12, -9); c.stroke();
    }
    c.restore();
    c.restore();
  }

  function drawFish(c, x, y, ang, s, flip) {
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s * flip);
    c.fillStyle = '#ef8a3c';
    c.beginPath(); c.moveTo(-12, 0); c.lineTo(-23, -8); c.quadraticCurveTo(-20, 0, -23, 8); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-3, -6); c.quadraticCurveTo(3, -14, 8, -6); c.closePath(); c.fill();
    const g = c.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, '#6fb9c4'); g.addColorStop(0.5, '#e9f6ef'); g.addColorStop(1, '#ffd9a8');
    c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 15, 7.5, 0, 0, TAU); c.fill();
    c.fillStyle = C.ink; c.beginPath(); c.arc(9, -1.8, 1.5, 0, TAU); c.fill();
    c.fillStyle = '#ef8a3c'; c.beginPath(); c.ellipse(0, 3, 4, 2, 0.5, 0, TAU); c.fill();
    c.restore();
  }

  function rings(c, x, y, age, s) {
    for (let i = 0; i < 3; i++) {
      const a = age - i * 0.17;
      if (a < 0 || a > 1.15) continue;
      const k = a / 1.15;
      c.globalAlpha = (1 - k) * 0.75; c.strokeStyle = '#f7fff8'; c.lineWidth = 1.4 * (1 - k * 0.5);
      c.beginPath(); c.ellipse(x, y, (5 + k * 34) * s, (1.6 + k * 8.5) * s, 0, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function splash(c, x, y, age, s, seed) {
    if (age < 0 || age > 0.5) return;
    const r = rngOf(seed);
    c.fillStyle = '#f4fff9';
    for (let i = 0; i < 9; i++) {
      const vx = (r() - 0.5) * 75 * s, vy = (40 + r() * 75) * s;
      const dx = vx * age, dy = -vy * age + 240 * s * age * age;
      if (dy > 3) continue;
      c.globalAlpha = 1 - age / 0.5;
      c.beginPath(); c.arc(x + dx, y + dy, 1.5 * s, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  function fxFish(c, S, t, list) {
    for (const [t0, x, y, hgt, s, dir] of S.fish) {
      const dur = 0.72 + hgt * 0.0024, u = (t - t0) / dur, reach = 46 * s * dir;
      const xe = x + reach;
      // Aneis e respingos ficam na agua, atras do peixe.
      if (t > t0) { rings(c, x, y, t - t0, s); splash(c, x, y, t - t0, s, Math.round(t0 * 100)); }
      if (t > t0 + dur) { rings(c, xe, y, t - t0 - dur, s); splash(c, xe, y, t - t0 - dur, s * 1.2, Math.round(t0 * 170)); }
      if (u > 0 && u < 1) {
        const px = lerp(x, xe, u), py = y - 4 * hgt * u * (1 - u);
        const ang = Math.atan2(-4 * hgt * (1 - 2 * u), reach);
        const stretch = 1 + Math.abs(1 - 2 * u) * 0.14;
        // Abaixo da superficie o peixe e cortado: entra e sai da agua de verdade.
        c.save(); c.beginPath(); c.rect(x - 200, y - 400, 400, 402); c.clip();
        drawFish(c, px, py, ang, s * stretch, dir < 0 ? -1 : 1);
        c.restore();
      }
    }
  }

  function fxWater(c, S, t, clear) {
    for (const m of S.shimmer) {
      const a = (0.5 + 0.5 * Math.sin(t * m.k * 2.1 + m.ph)) * clear;
      const near = Math.abs(m.x - SUN_X) < 80 + (m.y - G) * 0.45;
      c.globalAlpha = a * (near ? 0.85 : 0.3);
      c.strokeStyle = near ? '#fff0c4' : '#e6fff2'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(m.x, m.y); c.lineTo(m.x + m.w * (near ? 1.2 : 0.8), m.y); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function fxSmoke(c, t, clear) {
    const x0 = CABIN_X + 44, y0 = G - 158;
    for (let i = 0; i < 9; i++) {
      const u = ((t * 0.17 + i / 9) % 1);
      const x = x0 + u * 42 + Math.sin(u * 7 + i) * 8, y = y0 - u * 118;
      c.globalAlpha = (1 - u) * 0.42 * clear * sstep(0, 0.08, u);
      c.fillStyle = '#efe9e0';
      c.beginPath(); c.arc(x, y, 5 + u * 15, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  function fxRoar(c, b, t) {
    if (t < 7.48 || t > 8.62) return;
    const mx = b.x + 34, my = b.foot - 128;
    c.strokeStyle = C.fx; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const k = ((t - 7.48) * 1.5 + i * 0.25) % 1;
      c.globalAlpha = (1 - k) * 0.7; c.lineWidth = 2.6 * (1 - k) + 0.5;
      c.beginPath(); c.arc(mx, my, 16 + k * 118, -0.72, 0.56); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function fxBang(c, x, y, t, t0) {
    const a = t - t0;
    if (a < 0 || a > 0.75) return;
    const s = (1 - Math.exp(-a * 22)) * (1 + Math.sin(a * 26) * Math.exp(-a * 9) * 0.35), o = 1 - sstep(0.55, 0.75, a);
    c.save(); c.translate(x, y); c.scale(s, s); c.globalAlpha = o;
    c.fillStyle = '#fff3cf'; c.strokeStyle = '#2a1c14'; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-5, -26); c.lineTo(5, -26); c.lineTo(2.6, -5); c.lineTo(-2.6, -5); c.closePath(); c.stroke(); c.fill();
    c.beginPath(); c.arc(0, 3, 3.8, 0, TAU); c.stroke(); c.fill();
    c.restore();
  }

  function fxDizzy(c, b, t) {
    if (t < 11.66 || t > 14) return;
    const hx = b.x + 30, hy = b.foot - 88;
    for (let i = 0; i < 4; i++) {
      const a = t * 7 + i / 4 * TAU;
      star(c, hx + Math.cos(a) * 24, hy + Math.sin(a) * 7, 5.5, 0.95);
    }
  }

  function fxBirds(c, S, t) {
    const a = t - 7.52;
    if (a < 0 || a > 3) return;
    c.strokeStyle = '#102a28'; c.lineWidth = 1.9; c.lineCap = 'round';
    for (const b of S.birds) {
      const x = b.x + b.vx * a, y = b.y + b.vy * a;
      const fl = Math.sin(t * 24 + b.ph) * 5;
      c.beginPath(); c.moveTo(x - 7, y - fl); c.quadraticCurveTo(x - 3, y - 1, x, y + 1); c.quadraticCurveTo(x + 3, y - 1, x + 7, y - fl); c.stroke();
    }
  }

  function fxDust(c, S, t) {
    c.fillStyle = C.dust;
    for (const d of S.dust) {
      const a = t - d.t;
      if (a < 0 || a > 0.46) continue;
      const k = a / 0.46;
      c.globalAlpha = (1 - k) * 0.55;
      c.beginPath(); c.arc(d.x - k * 24, d.y - 3 - k * 15 * d.s, (3 + k * 10) * d.s, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  function fxSpeedLines(c, p, t) {
    if (t < 9.35 || t > 13.65) return;
    c.strokeStyle = 'rgba(255,246,220,.55)'; c.lineWidth = 1.3; c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const y = p.foot - 12 - i * 13;
      const off = ((t * 7 + i * 0.37) % 1);
      const len = 16 + (i % 3) * 13;
      c.globalAlpha = 0.7 * (1 - off);
      c.beginPath(); c.moveTo(p.x - 34 - off * 26, y); c.lineTo(p.x - 34 - off * 26 - len, y); c.stroke();
    }
    c.globalAlpha = 1;
  }

  /* ---------- Quadro ---------- */
  function drawLayer(ctx, S, L, fr) {
    const ss = S.ss, z = fr.z, a = fr.a;
    ctx.setTransform(ss * z, 0, 0, ss * z, ss * (640 - fr.cx * L.k * z), ss * (a - G * z));
    const halfW = 640 / z + 4, cx = fr.cx * L.k;
    const x0 = Math.max(cx - halfW, L.lx0), x1 = Math.min(cx + halfW, L.lx0 + L.W);
    if (x1 <= x0) return;
    const B = L.canvas.width / L.W, H = YBOT - YTOP;
    ctx.drawImage(L.canvas, (x0 - L.lx0) * B, 0, (x1 - x0) * B, H * B, x0, YTOP, x1 - x0, H);
  }

  function drawSky(ctx, S, fr, clear) {
    ctx.setTransform(S.ss, 0, 0, S.ss, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, 620);
    const mix = (a, b) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], clear))).join(',')})`;
    g.addColorStop(0, mix([22, 61, 64], [52, 107, 128]));
    g.addColorStop(0.42, mix([43, 106, 97], [234, 168, 122]));
    g.addColorStop(0.75, mix([93, 154, 124], [255, 214, 147]));
    g.addColorStop(1, mix([93, 154, 124], [255, 226, 170]));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
    // O sol: distante, quase nao se move com a camera.
    const sx = 640 + (SUN_X - FINAL_CAM) * fr.z + (FINAL_CAM - fr.cx) * 0.05 * fr.z;
    const sy = fr.a - 150 * fr.z;
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 380);
    const ga = lerp(0.32, 0.8, clear);
    glow.addColorStop(0, `rgba(255,236,178,${ga})`); glow.addColorStop(0.3, `rgba(255,205,135,${ga * 0.42})`); glow.addColorStop(1, 'rgba(255,205,135,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 1280, 720);
    if (clear > 0.02) {
      ctx.globalAlpha = clear; ctx.fillStyle = '#fff4cf';
      ctx.beginPath(); ctx.arc(sx, sy, 15 * fr.z, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  function ambient(c, S, fr, clear) {
    const t = fr.t, halfW = 640 / fr.z + 40;
    const span = 2 * halfW;
    const wrapX = (x, k) => fr.cx - halfW + (((x - fr.cx * k) % span) + span) % span;
    for (const l of S.leaves) {
      const u = (t * l.s + l.ph) % 1, x = wrapX(l.x + Math.sin(t * 1.7 + l.ph) * l.sw, 1);
      const y = G - 300 + u * 340;
      c.save(); c.translate(x, y); c.rotate(t * 3 + l.ph);
      c.fillStyle = l.col; c.globalAlpha = 0.85;
      c.beginPath(); c.ellipse(0, 0, 3.4, 1.7, 0, 0, TAU); c.fill(); c.restore();
    }
    for (const fl of S.flies) {
      const x = wrapX(fl.x + Math.sin(t * fl.k + fl.ph) * 22, 0.8), y = fl.y + Math.cos(t * fl.k * 1.3 + fl.ph) * 12;
      const a = (0.5 + 0.5 * Math.sin(t * fl.k * 2.6 + fl.ph * 2)) ** 2 * (1 - clear * 0.65);
      c.fillStyle = C.firefly;
      c.globalAlpha = a * 0.22; c.beginPath(); c.arc(x, y, 3.8, 0, TAU); c.fill();
      c.globalAlpha = a * 0.95; c.beginPath(); c.arc(x, y, 1.1, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawFrame(ctx, f) {
    const S = window.Story.state, fr = S.frames[((Math.round(f) % N) + N) % N];
    const { t, p, d, b, z, cx, a } = fr, ss = S.ss;
    const clear = sstep(1050, 1560, cx);
    drawSky(ctx, S, fr, clear);
    S.layers.forEach((L, i) => {
      if (i === 0 && clear <= 0) return;           // montanhas so existem na clareira
      ctx.globalAlpha = i === 0 ? clear : 1;
      drawLayer(ctx, S, L, fr);
      ctx.globalAlpha = 1;
    });

    // A partir daqui tudo vive no mundo, junto com o chao.
    ctx.setTransform(ss * z, 0, 0, ss * z, ss * (640 - cx * z), ss * (a - G * z));
    const shaking = t > 6.05 && t < 7.1;
    fxWater(ctx, S, t, clear);
    fxFish(ctx, S, t);
    fxSmoke(ctx, t, clear);

    fxDust(ctx, S, t);
    if (t > 6.5) {
      // Enquanto sobe, o urso e cortado na linha do chao: vem de tras do arbusto, nao de baixo da terra.
      if (b.foot <= G + 2) drawShadow(ctx, b.x, G, 62 * b.sx, 0.38);
      ctx.save(); ctx.beginPath(); ctx.rect(b.x - 300, G - 500, 600, 505); ctx.clip();
      drawBear(ctx, b, t);
      ctx.restore();
    }
    // O arbusto na frente do urso: treme antes de ele aparecer.
    if (cx < 1100) {
      const sh = shaking ? Math.sin(t * 34) * (2 + 3 * sstep(6.05, 6.9, t)) : t > 7.05 && t < 7.4 ? Math.sin(t * 50) * 3 * (7.4 - t) : 0;
      bushShape(ctx, BUSH_X + sh, G - 6, 1.32, '#1f5832', '#2f7640');
    }
    fxBirds(ctx, S, t);
    fxRoar(ctx, b, t);
    fxDizzy(ctx, b, t);

    drawShadow(ctx, d.x, G, 20 * d.sx * (1 - clamp(d.lift / 90, 0, 0.6)), 0.38);
    drawShadow(ctx, p.x, G, 26 * p.sx * (1 - clamp(p.air / 170, 0, 0.6)), 0.42);
    const collar = dogCollar(d);
    drawDog(ctx, d, null, t);
    const hand = drawPerson(ctx, p, collar);
    drawLeash(ctx, hand, collar, 1, f);
    fxSpeedLines(ctx, p, t);
    fxBang(ctx, d.x + 8, d.foot - 56, t, 5.68);
    fxBang(ctx, p.x, p.foot - 92 * p.sy, t, 7.5);
    ambient(ctx, S, fr, clear);

    drawLayer(ctx, S, S.front, fr);

    // Vinheta e abertura/fechamento em fade.
    ctx.setTransform(ss, 0, 0, ss, 0, 0);
    const vg = ctx.createRadialGradient(640, 380, 340, 640, 380, 800);
    vg.addColorStop(0, 'rgba(3,10,12,0)'); vg.addColorStop(1, `rgba(3,10,12,${lerp(0.5, 0.26, clear)})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, 1280, 720);
    const fade = Math.max(1 - sstep(0, 0.6, t), sstep(19.4, 20, t));
    if (fade > 0) { ctx.fillStyle = `rgba(4,10,12,${fade})`; ctx.fillRect(0, 0, 1280, 720); }
  }

  window.Story = { setup, drawFrame, FPS, N };
})();
