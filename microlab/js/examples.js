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
