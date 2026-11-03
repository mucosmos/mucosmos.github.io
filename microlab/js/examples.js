/* MicroLab — jeux de données d'exemple (bruit pseudo-aléatoire reproductible) */
(function (root) {
  'use strict';
  function rng(seed) { // mulberry32 + Box-Muller
    let a = seed >>> 0;
    const u = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  }
  const r3 = v => Math.round(v * 1000) / 1000;
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  const EX = {
    rc() {
      const g = rng(7), t = range(26, i => i * 2);
      return {
        title: 'Décharge d’un condensateur',
        vars: [
          { name: 't', unit: 'ms', u: '', data: t },
          { name: 'uC', unit: 'V', u: '0.05', data: t.map(x => r3(5.02 * Math.exp(-x / 11.8) + 0.04 * g())) }
        ],
        calc: '# Intensité : i = C·duC/dt avec C = 10 µF\nC (µF) = 10\ni (mA) = C*deriv(uC, t)',
        graph: { x: 't', ys: ['uC'] },
        model: { y: 'uC', preset: 'expdec' }
      };
    },
    chute() {
      const g = rng(11), t = range(18, i => +(i * 0.04).toFixed(2));
      return {
        title: 'Chute libre',
        vars: [
          { name: 't', unit: 's', u: '', data: t },
          { name: 'y', unit: 'm', u: '0.005', data: t.map(x => r3(1.20 - 0.5 * 9.81 * x * x + 0.003 * g())) }
        ],
        calc: 'vy (m/s) = deriv(y, t)\nay (m/s²) = deriv(vy, t)',
        graph: { x: 't', ys: ['y'] },
        model: { y: 'y', preset: 'para' }
      };
    },
    ohm() {
      const g = rng(3), I = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
      return {
        title: 'Loi d’Ohm',
        vars: [
          { name: 'I', unit: 'mA', u: '0.01*I + 0.2', data: I },
          { name: 'U', unit: 'V', u: '0.005*U + 0.02', data: I.map(x => r3(0.2195 * x + 0.03 * g())) }
        ],
        calc: 'P (mW) = U*I',
        graph: { x: 'I', ys: ['U'] },
        model: { y: 'U', preset: 'lin' }
      };
    },
    pendule() {
      const g = rng(21), n = range(20, i => i + 1);
      return {
        title: 'Période d’un pendule',
        vars: [
          { name: 'essai', unit: '', u: '', data: n },
          { name: 'T', unit: 's', u: '', data: n.map(() => +(1.418 + 0.012 * g()).toFixed(3)) }
        ],
        calc: '# Longueur du fil\nL (m) = 0.500\ngexp (m/s²) = 4*pi^2*L/T^2',
        graph: { x: 'essai', ys: ['T'] },
        model: { y: 'T', preset: 'const' },
        hist: { law: 'gauss' },
        statVar: 'T',
        tab: 'stats'
      };
    },
    refraction() {
      // air -> plexiglas : sin(i1) = n sin(i2), n = 1,49 ; angles lus au rapporteur (0,5°)
      const g = rng(17), i1 = [10, 20, 30, 40, 50, 60, 70, 80];
      return {
        title: 'Réfraction (Snell-Descartes)',
        angle: 'deg',
        vars: [
          { name: 'i1', unit: '°', u: '0.5', data: i1 },
          { name: 'i2', unit: '°', u: '0.5', data: i1.map(a => Math.round(2 * (Math.asin(Math.sin(a * Math.PI / 180) / 1.49) * 180 / Math.PI + 0.35 * g())) / 2) }
        ],
        calc: '# angles en degrés (réglage « Angles » ci-dessus)\nsin_i1 = sin(i1)\nsin_i2 = sin(i2)',
        uCalc: { sin_i1: 'abs(cos(i1))*0.5*pi/180', sin_i2: 'abs(cos(i2))*0.5*pi/180' },
        graph: { x: 'sin_i2', ys: ['sin_i1'] },
        model: { y: 'sin_i1', preset: 'lin' }
      };
    },
    titrage_ph() {
      // 20,0 mL d'acide éthanoïque (pKa 4,76, c = 0,063 mol/L) titré par la soude à 0,100 mol/L : VE = 12,6 mL
      const g = rng(31), Ka = 10 ** -4.76, Kw = 1e-14, Ca = 0.063, Va = 20, Cb = 0.100;
      const V = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10.5, 11, 11.5, 12, 12.2, 12.4, 12.6, 12.8, 13, 13.2, 13.5, 14, 14.5, 15, 16, 17, 18, 19, 20, 22];
      const pH = V.map(v => {
        const c = Ca * Va / (Va + v), na = Cb * v / (Va + v);
        let lo = -14, hi = 0;
        for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, h = 10 ** m; if (h + na - Kw / h - c * Ka / (Ka + h) > 0) hi = m; else lo = m; }
        return Math.round((-(lo + hi) / 2 + 0.015 * g()) * 100) / 100;
      });
      return {
        title: 'Titrage pH-métrique',
        vars: [
          { name: 'V', unit: 'mL', u: '', data: V },
          { name: 'pH', unit: '', u: '', data: pH }
        ],
        calc: '# dérivée affichée par l’onglet Titrage ; on peut aussi la calculer ici\ndpH = deriv(pH, V)',
        graph: { x: 'V', ys: ['pH'] },
        model: { y: 'pH', preset: 'aff' },
        titr: { type: 'ph' },
        tab: 'titr'
      };
    },
    titrage_cond() {
      // 10 mL d'acide chlorhydrique + 190 mL d'eau, titrés par la soude à 0,100 mol/L : VE = 11,2 mL
      const g = rng(41), n = 1.12, V0 = 200, Cb = 0.100; // n en mmol
      const lH = 34.98, lNa = 5.01, lCl = 7.63, lOH = 19.86;  // mS·m²/mol
      const V = Array.from({ length: 21 }, (_, i) => i);
      const s = V.map(v => {
        const vt = V0 + v, nb = Cb * v;
        const H = Math.max(n - nb, 0) / vt, OH = Math.max(nb - n, 0) / vt, Na = nb / vt, Cl = n / vt; // mol/L
        const sig = (lH * H + lOH * OH + lNa * Na + lCl * Cl) * 1000 / 100; // mS/cm
        return Math.round(sig * (1 + 0.004 * g()) * 1000) / 1000;
      });
      return {
        title: 'Titrage conductimétrique',
        vars: [
          { name: 'V', unit: 'mL', u: '', data: V },
          { name: 'sigma', unit: 'mS/cm', u: '', data: s }
        ],
        calc: '# correction de la dilution : volume initial V0 = 200 mL\nV0 (mL) = 200\nsigma_c (mS/cm) = sigma*(V0 + V)/V0',
        graph: { x: 'V', ys: ['sigma_c'] },
        model: { y: 'sigma_c', preset: 'aff' },
        titr: { type: 'cond' },
        tab: 'titr'
      };
    },
    muon() {
      // durées entre l'arrivée d'un muon et l'électron de désintégration (τ = 2,197 µs),
      // mêlées à des coïncidences fortuites réparties sur toute la fenêtre de 525 µs
      let a = 77;
      const u = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const d = [];
      for (let i = 0; i < 650; i++) d.push(Math.round((100 - 2197 * Math.log(1 - u())) / 8) * 8);
      for (let i = 0; i < 850; i++) d.push(Math.round(525000 * u() / 8) * 8);
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
      return {
        title: 'Vie du muon (simulation)',
        vars: [
          { name: 'n', unit: '', u: '', data: d.map((_, i) => i + 1) },
          { name: 'duree', unit: 'ns', u: '', data: d }
        ],
        calc: '',
        graph: { x: 'n', ys: ['duree'] },
        model: { y: 'duree', preset: 'const' },
        hist: { width: '500', start: '500', end: '15000' },
        statVar: 'duree',
        tab: 'stats'
      };
    },
    comptage() {
      // nombre de désintégrations détectées par intervalle de 10 s (loi de Poisson, λ ≈ 4,3)
      let a = 2026;
      const u = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const pois = lam => { let k = 0, p = 1; const L = Math.exp(-lam); do { k++; p *= u(); } while (p > L); return k - 1; };
      const n = range(120, i => i + 1);
      return {
        title: 'Comptage radioactif',
        vars: [
          { name: 'essai', unit: '', u: '', data: n },
          { name: 'N', unit: 'coups', u: '', data: n.map(() => pois(4.3)) }
        ],
        calc: '# Activité mesurée sur 10 s\nA (Bq) = N/10',
        graph: { x: 'essai', ys: ['N'] },
        model: { y: 'N', preset: 'const' },
        hist: { width: '1', law: 'poisson' },
        statVar: 'N',
        tab: 'stats'
      };
    },
    ressort() {
      const g = rng(5), t = range(80, i => +(i * 0.05).toFixed(2));
      return {
        title: 'Oscillations amorties',
        vars: [
          { name: 't', unit: 's', u: '', data: t },
          { name: 'x', unit: 'cm', u: '0.1', data: t.map(s => r3(4.2 * Math.exp(-s / 1.6) * Math.sin(2 * Math.PI * s / 0.82 + 1.1) + 0.08 * g())) }
        ],
        calc: 'v (cm/s) = deriv(x, t)',
        graph: { x: 't', ys: ['x'], lines: true },
        model: { y: 'x', preset: 'sinam' }
      };
    }
  };
  root.Examples = EX;
})(typeof window !== 'undefined' ? window : globalThis);
