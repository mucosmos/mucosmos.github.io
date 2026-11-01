/* MicroLab — moteur de calcul (sans dépendance au DOM)
 * Lecture de tableaux texte, ajustement Levenberg-Marquardt,
 * statistiques et loi de Student.
 */
(function (root) {
  'use strict';

  /* ---------- Nombres ---------- */

  function parseNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    let s = String(v).trim().replace(/ | /g, '').replace(/\s+/g, '');
    if (s === '') return NaN;
    s = s.replace(/×10\^?/i, 'e').replace(/,/g, '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }

  function isNumericCell(v) { return !isNaN(parseNumber(v)); }

  /* ---------- Lecture de texte (CSV, TXT, collage) ---------- */

  function detectSeparator(lines) {
    const cands = ['\t', ';', ',', ' '];
    let best = '\t', bestScore = -1;
    const sample = lines.slice(0, 40);
    for (const sep of cands) {
      const counts = sample.map(l => splitLine(l, sep).length);
      const freq = {}; counts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const mode = +Object.keys(freq).sort((a, b) => freq[b] - freq[a] || b - a)[0];
      if (mode < 2) continue;
      const consistent = counts.filter(c => c === mode).length / counts.length;
      // la virgule est pénalisée : elle peut être un séparateur décimal
      const score = consistent * 10 + mode * 0.01 - (sep === ',' ? 0.5 : 0) - (sep === ' ' ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = sep; }
    }
    return best;
  }

  function splitLine(line, sep) {
    if (sep === ' ') return line.trim().split(/\s+/);
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function textToRows(text, sep) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
    if (!sep || sep === 'auto') sep = detectSeparator(lines);
    return { rows: lines.map(l => splitLine(l, sep)), sep };
  }

  /* "t (s)", "t[s]", "t / s", "t_s" -> {name:'t', unit:'s'} */
  function splitNameUnit(h) {
    h = String(h ?? '').trim();
    let m = h.match(/^(.*?)\s*[\(\[]\s*(.*?)\s*[\)\]]\s*$/) || h.match(/^(.*?)\s+\/\s*(.+)$/) || h.match(/^(.*?)\s+en\s+(.+)$/i);
    if (m && m[1]) return { name: m[1], unit: m[2] };
    return { name: h, unit: '' };
  }

  function sanitizeName(n, i) {
    let s = String(n || '').trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_À-ɏΑ-ω]/g, '');
    if (!s) s = 'c' + (i + 1);
    if (/^[0-9]/.test(s)) s = '_' + s;
    return s;
  }

  /* Transforme un tableau de lignes (cellules brutes) en variables.
   * Repère automatiquement une ligne de noms et une ligne d'unités. */
  function rowsToTable(rows) {
    rows = rows.filter(r => r.some(c => String(c ?? '').trim() !== ''));
    if (!rows.length) throw new Error('Aucune donnée trouvée dans ce fichier.');
    const ncol = Math.max(...rows.map(r => r.length));
    let start = 0, header = null, units = null;
    // on saute les lignes de titre (moins de la moitié de cellules numériques)
    const numRatio = r => r.filter(isNumericCell).length / Math.max(1, r.filter(c => String(c ?? '').trim() !== '').length);
    while (start < rows.length && numRatio(rows[start]) < 0.5) start++;
    if (start >= 1) header = rows[start - 1];
    if (start >= 2) {
      const prev = rows[start - 2];
      // deux lignes de texte : noms puis unités (unités courtes, même nombre de cellules)
      const filled = r => r.filter(c => String(c ?? '').trim()).length;
      const unitLike = header.every(c => { const s = String(c ?? '').trim(); return s.length <= 12 && !/[\(\)\[\]]/.test(s) || /^[\(\[].*[\)\]]$/.test(s); });
      if (filled(prev) === filled(header) && filled(prev) > 0 && unitLike) {
        units = header; header = prev;
      }
    }
    const body = rows.slice(start);
    if (!body.length) throw new Error('Aucune ligne numérique trouvée.');
    const used = new Set();
    const vars = [];
    for (let j = 0; j < ncol; j++) {
      const col = body.map(r => parseNumber(r[j]));
      if (col.every(isNaN)) continue;
      const nu = splitNameUnit(header ? header[j] : '');
      let name = sanitizeName(nu.name, j);
      let unit = nu.unit;
      if (units && String(units[j] ?? '').trim()) unit = String(units[j]).trim().replace(/^[\(\[]|[\)\]]$/g, '');
      let base = name, k = 2;
      while (used.has(name)) name = base + '_' + (k++);
      used.add(name);
      vars.push({ name, unit, data: col });
    }
    if (!vars.length) throw new Error('Aucune colonne numérique trouvée.');
    return { vars, nrows: body.length, skipped: start };
  }

  /* ---------- Algèbre linéaire ---------- */

  function solve(A, b) { // Gauss avec pivot partiel
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  function invert(A) {
    const n = A.length, inv = [];
    for (let j = 0; j < n; j++) {
      const e = new Array(n).fill(0); e[j] = 1;
      const col = solve(A, e);
      if (!col || col.some(v => !isFinite(v))) return null;
      for (let i = 0; i < n; i++) (inv[i] = inv[i] || [])[j] = col[i];
    }
    return inv;
  }

  /* ---------- Loi de Student ---------- */

  function lnGamma(z) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1; let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function studentCdf(t, df) {
    const x = df / (df + t * t), p = 0.5 * betai(df / 2, 0.5, x);
    return t > 0 ? 1 - p : p;
  }

  /* quantile bilatéral : P(|T| < t) = conf */
  function studentT(conf, df) {
    if (!(df > 0)) return NaN;
    const target = 0.5 + conf / 2;
    let lo = 0, hi = 1e4;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (studentCdf(mid, df) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function gammp(a, x) { // gamma incomplète régularisée P(a,x)
    if (x <= 0) return 0;
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
      return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }
  /* probabilité d'obtenir un χ² au moins aussi grand */
  function chi2Q(chi2, df) { return df > 0 ? 1 - gammp(df / 2, chi2 / 2) : NaN; }

  /* ---------- Statistiques descriptives ---------- */

  function describe(arr) {
    const v = arr.filter(x => isFinite(x));
    const n = v.length;
    if (!n) return { n: 0 };
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const s = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
    const sorted = [...v].sort((a, b) => a - b);
    const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return { n, mean, s, u: s / Math.sqrt(n), min: sorted[0], max: sorted[n - 1], median: med,
      t95: studentT(0.95, n - 1) };
  }

  /* ---------- Dérivée et intégrale numériques ---------- */

  function derivative(y, x) {
    const n = y.length, d = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : i, b = i < n - 1 ? i + 1 : i;
      if (a === b) continue;
      d[i] = (y[b] - y[a]) / (x[b] - x[a]);
    }
    return d;
  }

  function integral(y, x) {
    const n = y.length, I = new Array(n).fill(NaN);
    if (!n) return I;
    I[0] = 0;
    for (let i = 1; i < n; i++) I[i] = I[i - 1] + 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
    return I;
  }

  /* ---------- Ajustement Levenberg-Marquardt ----------
   * f(x, p) -> y ; xs, ys : données ; sy : incertitudes sur y (ou null) ;
   * sx : incertitudes sur x (ou null) ; p0 : valeurs initiales ; fixed : booléens.
   */
  function fit(f, xs, ys, p0, opts = {}) {
    const sy = opts.sy || null, sx = opts.sx || null;
    const fixed = opts.fixed || p0.map(() => false);
    const n = xs.length, free = p0.map((_, i) => i).filter(i => !fixed[i]);
    const m = free.length;
    if (n < m + 1 && !(n === m && m > 0)) throw new Error(`Pas assez de points : ${n} points pour ${m} paramètre(s).`);
    const weighted = !!sy;
    let p = p0.slice();

    const model = (pp, x) => { const v = f(x, pp); return typeof v === 'number' ? v : NaN; };
    const slope = (pp, x) => { const h = 1e-6 * (Math.abs(x) || 1); return (model(pp, x + h) - model(pp, x - h)) / (2 * h); };
    const sigmas = pp => xs.map((x, i) => {
      let s2 = sy ? sy[i] * sy[i] : 1;
      if (sy && sx && sx[i]) s2 += (slope(pp, x) * sx[i]) ** 2; // variance effective
      return Math.sqrt(s2) || 1;
    });
    let sig = sigmas(p);
    const resid = pp => xs.map((x, i) => (ys[i] - model(pp, x)) / sig[i]);
    const ssr = r => r.reduce((a, b) => a + b * b, 0);
    const jac = pp => {
      const J = xs.map(() => new Array(m));
      free.forEach((pi, k) => {
        const h = 1e-7 * Math.max(Math.abs(pp[pi]), 1e-3);
        const pa = pp.slice(), pb = pp.slice(); pa[pi] += h; pb[pi] -= h;
        xs.forEach((x, i) => { J[i][k] = (model(pa, x) - model(pb, x)) / (2 * h) / sig[i]; });
      });
      return J;
    };

    let r = resid(p), S = ssr(r);
    if (!isFinite(S)) throw new Error('Le modèle ne peut pas être calculé avec ces valeurs initiales (division par zéro, log d’un négatif…).');
    let lambda = 1e-3, iter = 0, converged = false;
    for (let outer = 0; outer < (sx && sy ? 3 : 1); outer++) {
      if (outer) { sig = sigmas(p); r = resid(p); S = ssr(r); lambda = 1e-3; }
      for (iter = 0; iter < 500; iter++) {
        const J = jac(p);
        const JtJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => {
          let s = 0; for (let i = 0; i < n; i++) s += J[i][a] * J[i][b]; return s; }));
        const Jtr = Array.from({ length: m }, (_, a) => { let s = 0; for (let i = 0; i < n; i++) s += J[i][a] * r[i]; return s; });
        let improved = false;
        for (let tries = 0; tries < 30; tries++) {
          const A = JtJ.map((row, a) => row.map((v, b) => a === b ? v * (1 + lambda) + 1e-12 : v));
          const delta = solve(A, Jtr);
          if (!delta) { lambda *= 10; continue; }
          const pn = p.slice(); free.forEach((pi, k) => { pn[pi] += delta[k]; });
          const rn = resid(pn), Sn = ssr(rn);
          if (isFinite(Sn) && Sn <= S) {
            const rel = (S - Sn) / (S || 1);
            const step = Math.max(...delta.map((d, k) => Math.abs(d) / (Math.abs(p[free[k]]) + 1e-12)));
            p = pn; r = rn; S = Sn; lambda = Math.max(lambda / 10, 1e-12); improved = true;
            if (rel < 1e-12 || step < 1e-10) converged = true;
            break;
          }
          lambda *= 10;
        }
        if (!improved) { converged = true; break; }
        if (converged) break;
      }
    }

    // matrice de covariance
    const J = jac(p);
    const JtJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => {
      let s = 0; for (let i = 0; i < n; i++) s += J[i][a] * J[i][b]; return s; }));
    const cov = invert(JtJ);
    const dof = n - m;
    const s2 = dof > 0 ? S / dof : NaN;
    const scale = weighted ? 1 : s2;
    const u = p.map(() => 0);
    if (cov) free.forEach((pi, k) => { u[pi] = Math.sqrt(Math.max(cov[k][k] * scale, 0)); });
    const corr = cov ? cov.map((row, a) => row.map((v, b) => v / Math.sqrt(cov[a][a] * cov[b][b]))) : null;

    // indicateurs
    const yfit = xs.map(x => model(p, x));
    const raw = ys.map((y, i) => y - yfit[i]);
    const ymean = ys.reduce((a, b) => a + b, 0) / n;
    const sst = ys.reduce((a, y) => a + (y - ymean) ** 2, 0);
    const sse = raw.reduce((a, b) => a + b * b, 0);
    const r2 = sst > 0 ? 1 - sse / sst : NaN;
    const t95 = dof > 0 ? studentT(0.95, dof) : NaN;
    const res = {
      p, u, cov, corr, free, iter, converged, n, dof,
      yfit, residuals: raw, normResiduals: weighted ? raw.map((e, i) => e / sig[i]) : null,
      r2, r2adj: dof > 0 ? 1 - (1 - r2) * (n - 1) / dof : NaN,
      rmse: Math.sqrt(sse / n), sres: dof > 0 ? Math.sqrt(sse / dof) : NaN,
      weighted, t95
    };
    if (weighted) { res.chi2 = S; res.chi2red = s2; res.chi2p = chi2Q(S, dof); }
    return res;
  }

  /* Régression linéaire y = a x + b (formules fermées) */
  function linreg(x, y) {
    const n = x.length;
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
    const a = sxy / sxx;
    return { a, b: my - a * mx, r: sxy / Math.sqrt(sxx * syy) };
  }

  /* ---------- Mise en forme : valeur ± incertitude ---------- */

  function sig(x, n = 4) {
    if (!isFinite(x)) return x === Infinity ? '∞' : '—';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e5 || a < 1e-3) return x.toExponential(n - 1).replace('.', ',');
    return String(+x.toPrecision(n)).replace('.', ',');
  }

  /* arrondit u à 2 chiffres significatifs et la valeur à la même décimale */
  function formatValU(v, u) {
    if (!isFinite(v)) return { v: '—', u: '' };
    if (!(u > 0) || !isFinite(u)) return { v: sig(v, 6), u: '' };
    const e = Math.floor(Math.log10(u)) - 1;
    const useExp = Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 && Math.abs(v) > 0 || u >= 1e5 || u < 1e-4;
    if (useExp) {
      const E = Math.floor(Math.log10(Math.abs(v) || u));
      const k = Math.max(0, E - e);
      const m = v / 10 ** E, um = u / 10 ** E;
      return { v: m.toFixed(k).replace('.', ','), u: um.toFixed(k).replace('.', ','), exp: E };
    }
    const d = Math.max(0, -e);
    return { v: v.toFixed(d).replace('.', ','), u: u.toFixed(d).replace('.', ',') };
  }

  const Engine = { parseNumber, textToRows, rowsToTable, splitNameUnit, sanitizeName, detectSeparator,
    fit, linreg, describe, studentT, chi2Q, derivative, integral, solve, invert, sig, formatValU };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
