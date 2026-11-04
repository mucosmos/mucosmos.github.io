/* MicroLab — moteur de calcul (sans dépendance au DOM)
 * Lecture de tableaux texte, ajustement Levenberg-Marquardt,
 * statistiques et loi de Student.
 */
(function (root) {
  'use strict';

  /* ---------- Nombres ---------- */

  // exposants en caractères Unicode : utilisables partout (tableau, champs, graphes, listes)
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '−': '⁻', '+': '⁺' };
  const UNSUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
  const sup = str => String(str).split('').map(c => SUP[c] || c).join('');
  /* « 10⁻⁷ » à partir de l'exposant -7 */
  const pow10 = e => '10' + sup(String(+e));

  /* Unités : m^3 → m³, s^-2 → s⁻², kg.m^(-1) → kg.m⁻¹, m^{2} → m² */
  function unitFmt(u) {
    return String(u ?? '').replace(/\^\s*[\(\{]?\s*([+\-−]?\d+)\s*[\)\}]?/g, (m, n) => sup(n));
  }

  /* dec : 'auto' (virgule ou point), ',' ou '.' ; l'autre caractère est alors
     traité comme séparateur de milliers. */
  function parseNumber(v, dec = 'auto') {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === null || v === undefined) return NaN;
    let s = String(v).trim().replace(/[  \s]+/g, '');
    if (s === '') return NaN;
    // accepte 2,5×10⁻⁷, 2,5×10^-7, 2,5·10^-7, 2,5*10^-7 et 2,5e-7
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, c => UNSUP[c]).replace(/(?:×|·|\*|x)10\^?/i, 'e');
    if (dec === ',') s = s.replace(/\./g, '').replace(/,/g, '.');
    else if (dec === '.') s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }

  function isNumericCell(v) { return !isNaN(parseNumber(v)); }

  /* ---------- Lecture de texte (CSV, TXT, collage) ---------- */

  function detectSeparator(lines) {
    const cands = ['\t', ';', '|', ',', ' '];
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
    if (sep.length > 1) return line.split(sep).map(x => x.trim());
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

  /* Lignes du texte ; les lignes vides sont conservées (elles délimitent les blocs
     de données) sauf en début et en fin. */
  function textLines(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
  }

  function textToRows(text, sep) {
    const lines = textLines(text);
    if (!sep || sep === 'auto') sep = detectSeparator(lines.filter(l => l.trim()));
    return { rows: lines.map(l => l.trim() ? splitLine(l, sep) : []), sep };
  }

  /* Devine le séparateur décimal : virgule si des nombres comme 3,14 apparaissent
     dans des cellules (et pas de point décimal). */
  function detectDecimal(rows) {
    let comma = 0, dot = 0;
    rows.slice(0, 60).forEach(r => r.forEach(c => {
      const s = String(c ?? '').trim();
      if (/^[-+]?\d*,\d+(e[-+]?\d+)?$/i.test(s)) comma++;
      if (/^[-+]?\d*\.\d+(e[-+]?\d+)?$/i.test(s)) dot++;
    }));
    return comma > dot ? ',' : '.';
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

  /* Repère la ligne des noms, celle des unités et la première ligne de données.
     Les indices renvoyés sont ceux du tableau rows (0 = première ligne), -1 = aucune. */
  const SUMMARY = /^(total|totaux|somme|sum|moyenne|mean|average|écart|ecart|std|min|max|bilan)\b/i;
  const isEmptyRow = r => !r || !r.some(c => String(c ?? '').trim() !== '');

  function detectLayout(rows, dec = 'auto') {
    const filled = r => r.filter(c => String(c ?? '').trim()).length;
    const numRatio = r => r.filter(c => !isNaN(parseNumber(c, dec))).length / Math.max(1, filled(r));
    let start = 0;
    while (start < rows.length && (isEmptyRow(rows[start]) || numRatio(rows[start]) < 0.5)) start++;
    if (start >= rows.length) start = 0;
    let headerRow = -1, unitRow = -1;
    let h = start - 1;
    while (h >= 0 && isEmptyRow(rows[h])) h--;
    if (h >= 0) headerRow = h;
    let p = h - 1;
    while (p >= 0 && isEmptyRow(rows[p])) p--;
    if (h >= 0 && p >= 0) {
      const prev = rows[p], header = rows[h];
      const unitLike = header.every(c => { const s = String(c ?? '').trim(); return s.length <= 12 && !/[\(\)\[\]]/.test(s) || /^[\(\[].*[\)\]]$/.test(s); });
      if (filled(header) > 0 && filled(header) <= filled(prev) && unitLike) { headerRow = p; unitRow = h; }
    }
    // fin des données : première ligne vide suivie d'autres lignes, ou ligne de total
    let end = rows.length - 1;
    for (let i = start + 1; i < rows.length; i++) {
      const first = String((rows[i] || []).find(c => String(c ?? '').trim() !== '') ?? '').trim();
      if (isEmptyRow(rows[i]) || SUMMARY.test(first)) { end = i - 1; break; }
    }
    while (end > start && isEmptyRow(rows[end])) end--;
    return { headerRow, unitRow, dataStart: start, dataEnd: end };
  }

  /* Transforme un tableau de lignes (cellules brutes) en variables.
     opts : decimal, headerRow, unitRow, dataStart, dataEnd (indice ou 'auto'), include (booléens par colonne). */
  function rowsToTable(rows, opts = {}) {
    if (!rows.some(r => !isEmptyRow(r))) throw new Error('Aucune donnée trouvée.');
    const dec = !opts.decimal || opts.decimal === 'auto' ? detectDecimal(rows) : opts.decimal;
    const auto = detectLayout(rows, dec);
    const pick = (k) => (opts[k] === undefined || opts[k] === 'auto') ? auto[k] : +opts[k];
    const headerRow = pick('headerRow'), unitRow = pick('unitRow');
    const dataStart = Math.min(Math.max(0, pick('dataStart')), rows.length);
    const dataEnd = Math.min(Math.max(dataStart, pick('dataEnd')), rows.length - 1);
    const header = headerRow >= 0 ? rows[headerRow] : null;
    const units = unitRow >= 0 ? rows[unitRow] : null;
    const ncol = Math.max(...rows.map(r => r.length));
    const body = rows.slice(dataStart, dataEnd + 1).filter((r, i) => i + dataStart !== headerRow && i + dataStart !== unitRow && !isEmptyRow(r));
    const used = new Set(), vars = [], columns = [];
    for (let j = 0; j < ncol; j++) {
      const col = body.map(r => parseNumber(r[j], dec));
      const nu = splitNameUnit(header ? header[j] : '');
      let name = sanitizeName(nu.name, j);
      let unit = nu.unit;
      if (units && String(units[j] ?? '').trim()) unit = String(units[j]).trim().replace(/^[\(\[]|[\)\]]$/g, '');
      unit = unitFmt(unit);
      let base = name, k = 2;
      while (used.has(name)) name = base + '_' + (k++);
      const numeric = col.filter(v => !isNaN(v)).length;
      const info = { index: j, name, unit, numeric, total: col.length, data: col };
      columns.push(info);
      const wanted = opts.include && opts.include[j] !== undefined ? opts.include[j] : numeric > 0;
      if (!wanted) continue;
      used.add(name);
      vars.push({ name, unit, data: col });
    }
    const error = !body.length ? 'Aucune ligne de données : choisissez la ligne où commencent les données.'
      : !vars.length ? 'Aucune colonne retenue : cochez au moins une colonne contenant des nombres.' : '';
    return { error, vars, columns, nrows: body.length, decimal: dec, layout: { headerRow, unitRow, dataStart, dataEnd }, auto, rows };
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
    if (a >= 1e5 || a < 1e-3) { const [m, e] = x.toExponential(n - 1).split('e'); return m.replace('.', ',') + ' × ' + pow10(e); }
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

  /* ---------- Histogramme et lois ---------- */

  /* Classes [start ; start + width[, … jusqu'à end (exclu) si end est fini, sinon jusqu'au maximum. */
  function histogram(values, width, start, end) {
    const v = values.filter(x => isFinite(x));
    if (!v.length || !(width > 0)) return { edges: [], counts: [], below: 0, above: 0 };
    const hasEnd = isFinite(end) && end > start;
    const max = Math.max(...v);
    let nb = hasEnd ? Math.ceil((end - start) / width - 1e-9) : Math.floor((max - start) / width + 1e-9) + 1;
    if (nb > 2000) throw new Error('Trop de classes : augmentez la largeur ou réduisez l’intervalle.');
    nb = Math.max(1, nb);
    const counts = new Array(nb).fill(0);
    let below = 0, above = 0;
    const last = start + nb * width;
    v.forEach(x => {
      if (x < start - 1e-12 * Math.abs(start || 1)) { below++; return; }
      if (hasEnd && x >= last) { above++; return; }
      const k = Math.floor((x - start) / width + 1e-9);
      counts[Math.min(k, nb - 1)]++;
    });
    const edges = Array.from({ length: nb + 1 }, (_, i) => start + i * width);
    return { edges, counts, below, above };
  }

  function normCdf(x, mu, s) { return 0.5 * (1 + (x - mu >= 0 ? 1 : -1) * gammp(0.5, ((x - mu) / s) ** 2 / 2)); }
  function poissonPmf(k, lam) { return k < 0 || k !== Math.floor(k) ? 0 : Math.exp(-lam + k * Math.log(lam) - lnGamma(k + 1)); }

  /* ---------- Titrages ---------- */

  /* Trie par x croissant, retire les valeurs manquantes et moyenne les x identiques. */
  function cleanXY(x, y) {
    const p = x.map((v, i) => [v, y[i]]).filter(q => isFinite(q[0]) && isFinite(q[1])).sort((a, b) => a[0] - b[0]);
    const X = [], Y = [];
    for (let i = 0; i < p.length;) {
      let j = i, s = 0;
      while (j < p.length && p[j][0] === p[i][0]) { s += p[j][1]; j++; }
      X.push(p[i][0]); Y.push(s / (j - i)); i = j;
    }
    return { X, Y };
  }

  /* Lissage par polynôme local de degré 2 sur w points (w impair ≥ 3) :
     valeur lissée et dérivée en chaque point. Avec w = 3, c'est la dérivée de la
     parabole passant par le point et ses deux voisins (valable pour un pas irrégulier). */
  function localQuad(X, Y, w) {
    const n = X.length, h = Math.floor(w / 2), ys = new Array(n).fill(NaN), d = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let a = i - h, b = i + h;
      if (a < 0) { b -= a; a = 0; }
      if (b > n - 1) { a -= b - (n - 1); b = n - 1; }
      a = Math.max(0, a);
      const m = b - a + 1;
      if (m < 3) continue;
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      for (let j = a; j <= b; j++) {
        const t = X[j] - X[i], pw = [1, t, t * t];
        for (let p = 0; p < 3; p++) { r[p] += pw[p] * Y[j]; for (let q = 0; q < 3; q++) A[p][q] += pw[p] * pw[q]; }
      }
      const c = solve(A, r);
      if (c) { ys[i] = c[0]; d[i] = c[1]; }
    }
    return { ys, d };
  }

  function interp(X, Y, x) {
    if (x <= X[0]) return Y[0];
    for (let i = 1; i < X.length; i++) if (x <= X[i]) return Y[i - 1] + (Y[i] - Y[i - 1]) * (x - X[i - 1]) / (X[i] - X[i - 1]);
    return Y[Y.length - 1];
  }

  /* Titrage pH-métrique : méthode de la dérivée et méthode des tangentes parallèles.
     opts.w : nombre de points du lissage de la dérivée ; opts.v1 : abscisse imposée
     pour le point de contact d'une des deux tangentes (sinon choisie automatiquement). */
  function titrationPH(x, y, opts = {}) {
    const { X, Y } = cleanXY(x, y);
    const n = X.length;
    if (n < 7) throw new Error('Il faut au moins 7 mesures pour repérer le saut.');
    const w = Math.max(3, (opts.w | 0) || 3);
    const { d } = localQuad(X, Y, w);
    const sgn = Y[n - 1] >= Y[0] ? 1 : -1;            // courbe croissante ou décroissante
    const dd = d.map(v => sgn * v);
    let ip = 0;
    for (let i = 1; i < n; i++) if (dd[i] > dd[ip]) ip = i;
    if (ip < 1 || ip > n - 2) throw new Error('Le saut de pH est au bord des mesures : l’équivalence n’est pas encadrée.');
    // sommet de la parabole passant par les trois points autour du maximum de la dérivée
    const [x0, x1, x2] = [X[ip - 1], X[ip], X[ip + 1]], [d0, d1, d2] = [dd[ip - 1], dd[ip], dd[ip + 1]];
    const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
    const A2 = (x2 * (d1 - d0) + x1 * (d0 - d2) + x0 * (d2 - d1)) / den;
    const B2 = (x2 * x2 * (d0 - d1) + x1 * x1 * (d2 - d0) + x0 * x0 * (d1 - d2)) / den;
    let vD = A2 < 0 ? -B2 / (2 * A2) : x1;
    if (!(vD >= x0 && vD <= x2)) vD = x1;
    const deriv = { ve: vD, ye: interp(X, Y, vD), dmax: sgn * (A2 < 0 ? d1 - A2 * (vD - x1) ** 2 : d1) };
    const step = Math.min(X[ip] - X[ip - 1], X[ip + 1] - X[ip]);

    // tangentes parallèles : dérivée lissée sur au moins 5 points, plus robuste au bruit
    const S5 = localQuad(X, Y, Math.max(5, w));
    const ds = S5.d.map(v => sgn * v), ysm = S5.ys;
    let jp = 0;
    for (let i = 1; i < n; i++) if (ds[i] > ds[jp]) jp = i;
    let iL = jp; while (iL > 0 && ds[iL - 1] < ds[iL]) iL--;
    let iR = jp; while (iR < n - 1 && ds[iR + 1] < ds[iR]) iR++;
    const crossL = m => { for (let i = jp; i > iL; i--) if (ds[i - 1] <= m && m <= ds[i]) return X[i - 1] + (X[i] - X[i - 1]) * (m - ds[i - 1]) / (ds[i] - ds[i - 1]); return NaN; };
    const crossR = m => { for (let i = jp; i < iR; i++) if (ds[i] >= m && m >= ds[i + 1]) return X[i] + (X[i + 1] - X[i]) * (ds[i] - m) / (ds[i] - ds[i + 1]); return NaN; };
    let m, xL, xR, err = '';
    const dsAt = v => interp(X, ds, v);
    if (isFinite(opts.v1)) {
      m = dsAt(opts.v1);
      if (opts.v1 < X[jp]) { xL = opts.v1; xR = crossR(m); } else { xR = opts.v1; xL = crossL(m); }
      if (!isFinite(xL) || !isFinite(xR)) err = 'Aucune tangente parallèle de l’autre côté du saut : choisissez un point plus proche du saut.';
    } else {
      const lo = Math.max(ds[iL], ds[iR]);
      m = lo + 0.15 * (ds[jp] - lo);
      xL = crossL(m); xR = crossR(m);
      if (!isFinite(xL) || !isFinite(xR)) err = 'Impossible de placer automatiquement les tangentes : indiquez le point de contact de la première tangente.';
    }
    let tang = null;
    if (!err) {
      const M = sgn * m, yL = interp(X, ysm, xL), yR = interp(X, ysm, xR);
      const cL = yL - M * xL, cR = yR - M * xR, cM = (cL + cR) / 2;
      // intersection de la parallèle médiane avec la courbe (interpolation linéaire des mesures)
      let ve = NaN;
      const g = i => Y[i] - (M * X[i] + cM);
      for (let i = 0; i < n - 1; i++) {
        if (X[i + 1] < xL || X[i] > xR) continue;
        const g0 = g(i), g1 = g(i + 1);
        if (g0 === 0) { ve = X[i]; break; }
        if (g0 * g1 < 0) { ve = X[i] + (X[i + 1] - X[i]) * g0 / (g0 - g1); break; }
      }
      if (!isFinite(ve)) err = 'La parallèle médiane ne coupe pas la courbe entre les deux tangentes.';
      else tang = { ve, ye: M * ve + cM, slope: M, xL, yL, xR, yR, cL, cR, cM };
    }
    return { X, Y, d, w, deriv, tang, tangErr: err, step, sgn };
  }

  /* Droite y = a x + b par moindres carrés (pondérée si sy), avec matrice de covariance. */
  function linFit(x, y, sy) {
    const n = x.length;
    if (n < 2) throw new Error('Il faut au moins deux points par droite.');
    const w = sy && sy.every(s => s > 0) ? sy.map(s => 1 / (s * s)) : x.map(() => 1);
    let S = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
    for (let i = 0; i < n; i++) { S += w[i]; Sx += w[i] * x[i]; Sy += w[i] * y[i]; Sxx += w[i] * x[i] * x[i]; Sxy += w[i] * x[i] * y[i]; }
    const Dl = S * Sxx - Sx * Sx;
    if (!(Math.abs(Dl) > 0)) throw new Error('Points alignés verticalement : droite impossible.');
    const a = (S * Sxy - Sx * Sy) / Dl, b = (Sxx * Sy - Sx * Sxy) / Dl;
    let chi = 0; for (let i = 0; i < n; i++) chi += w[i] * (y[i] - a * x[i] - b) ** 2;
    const weighted = w !== undefined && sy && sy.every(s => s > 0);
    const sc = weighted ? 1 : (n > 2 ? chi / (n - 2) : 0);
    const cov = [[S / Dl * sc, -Sx / Dl * sc], [-Sx / Dl * sc, Sxx / Dl * sc]];
    const my = y.reduce((p, q) => p + q, 0) / n, sst = y.reduce((p, q) => p + (q - my) ** 2, 0);
    const sse = y.reduce((p, q, i) => p + (q - a * x[i] - b) ** 2, 0);
    return { a, b, cov, n, r2: sst > 0 ? 1 - sse / sst : NaN, sse };
  }

  /* Titrage conductimétrique : deux droites, équivalence à leur intersection.
     r1, r2 : intervalles [x min, x max] des deux droites ; découpage automatique sinon. */
  function titrationCond(x, y, opts = {}) {
    const { X, Y } = cleanXY(x, y);
    const n = X.length;
    if (n < 6) throw new Error('Il faut au moins 6 mesures (3 par droite).');
    let r1 = opts.r1, r2 = opts.r2, auto = false;
    if (!(r1 && r2 && isFinite(r1[0]) && isFinite(r1[1]) && isFinite(r2[0]) && isFinite(r2[1]))) {
      auto = true;
      let best = Infinity, kb = -1;
      for (let k = 2; k <= n - 4; k++) {
        try {
          const s = linFit(X.slice(0, k + 1), Y.slice(0, k + 1)).sse + linFit(X.slice(k + 1), Y.slice(k + 1)).sse;
          if (s < best) { best = s; kb = k; }
        } catch (e) { /* découpage impossible */ }
      }
      if (kb < 0) throw new Error('Découpage automatique impossible.');
      r1 = [X[0], X[kb]]; r2 = [X[kb + 1], X[n - 1]];
    }
    const pick = r => { const i = X.map((v, k) => k).filter(k => X[k] >= Math.min(r[0], r[1]) - 1e-12 && X[k] <= Math.max(r[0], r[1]) + 1e-12); return { x: i.map(k => X[k]), y: i.map(k => Y[k]), sy: opts.sy ? i.map(k => opts.syAt(X[k])) : null }; };
    const p1 = pick(r1), p2 = pick(r2);
    if (p1.x.length < 2 || p2.x.length < 2) throw new Error('Chaque droite doit contenir au moins deux points.');
    const L1 = linFit(p1.x, p1.y, p1.sy), L2 = linFit(p2.x, p2.y, p2.sy);
    if (Math.abs(L1.a - L2.a) < 1e-15) throw new Error('Les deux droites sont parallèles : pas d’intersection.');
    const da = L1.a - L2.a, ve = (L2.b - L1.b) / da;
    const g1 = [-ve / da, -1 / da], g2 = [ve / da, 1 / da];
    const q = (g, C) => g[0] * g[0] * C[0][0] + 2 * g[0] * g[1] * C[0][1] + g[1] * g[1] * C[1][1];
    const uve = Math.sqrt(Math.max(0, q(g1, L1.cov) + q(g2, L2.cov)));
    return { X, Y, L1, L2, r1, r2, n1: p1.x.length, n2: p2.x.length, ve, uve, ye: L1.a * ve + L1.b, auto };
  }

  const Engine = { sup, pow10, unitFmt, titrationPH, titrationCond, linFit, localQuad, cleanXY, interp, parseNumber, textToRows, textLines, splitLine, detectDecimal, detectLayout, histogram, normCdf, poissonPmf, rowsToTable, splitNameUnit, sanitizeName, detectSeparator,
    fit, linreg, describe, studentT, chi2Q, derivative, integral, solve, invert, sig, formatValU };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
