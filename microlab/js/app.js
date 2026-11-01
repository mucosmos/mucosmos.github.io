/* MicroLab — interface */
(function () {
  'use strict';
  const E = window.Engine;
  const $ = id => document.getElementById(id);
  const STORE = 'microlab.v1';
  const MAX_ROWS_SHOWN = 2000;
  const CONSTS = new Set(['pi', 'e', 'E', 'PI', 'i', 'Infinity', 'NaN', 'true', 'false', 'null']);
  const COLUMN_FUNCS = { deriv: 2, integ: 2 };
  const AGG_FUNCS = new Set(['mean', 'min', 'max', 'std', 'sum', 'median']);

  if (window.math && !math.ln) math.import({ ln: x => Math.log(x) }, { silent: true });

  /* ---------- modèles prédéfinis ---------- */
  const PRESETS = [
    { id: 'lin',    label: 'Linéaire',                 tpl: 'a*x' },
    { id: 'aff',    label: 'Affine',                   tpl: 'a*x + b' },
    { id: 'para',   label: 'Parabole',                 tpl: 'a*x^2 + b*x + c' },
    { id: 'const',  label: 'Constante',                tpl: 'c' },
    { id: 'expdec', label: 'Exponentielle décroissante', tpl: 'A*exp(-x/tau) + B' },
    { id: 'charge', label: 'Charge (1er ordre)',       tpl: 'A*(1 - exp(-x/tau))' },
    { id: 'exp',    label: 'Exponentielle',            tpl: 'A*exp(k*x)' },
    { id: 'puiss',  label: 'Puissance',                tpl: 'A*x^n' },
    { id: 'ln',     label: 'Logarithme',               tpl: 'a*ln(x) + b' },
    { id: 'inv',    label: 'Inverse',                  tpl: 'a/x + b' },
    { id: 'sin',    label: 'Sinusoïde',                tpl: 'A*sin(2*pi*x/T + phi) + C' },
    { id: 'sinam',  label: 'Sinusoïde amortie',        tpl: 'A*exp(-x/tau)*sin(2*pi*x/T + phi) + C' },
    { id: 'gauss',  label: 'Gaussienne',               tpl: 'A*exp(-(x - m)^2/(2*s^2))' },
    { id: 'libre',  label: 'Expression libre',         tpl: '' }
  ];
  const presetExpr = (p, x) => p.tpl.replace(/\bx\b/g, x);

  /* ---------- état ---------- */
  let S = null;          // état sérialisable
  let D = null;          // données dérivées (colonnes calculées, incertitudes)

  function emptyState() {
    return {
      title: 'Sans titre',
      vars: [{ name: 'x', unit: '', u: '', data: Array(8).fill(NaN) },
             { name: 'y', unit: '', u: '', data: Array(8).fill(NaN) }],
      calc: '',
      graph: { x: 'x', ys: ['y'], lines: false, err: true, logx: false, logy: false, res: true },
      model: { y: 'y', preset: 'aff', expr: '', init: {}, fixed: {}, range: null, weight: true, result: null }
    };
  }

  function fromExample(ex) {
    const st = emptyState();
    st.title = ex.title; st.vars = ex.vars.map(v => ({ ...v, data: v.data.slice() }));
    st.calc = ex.calc || '';
    Object.assign(st.graph, ex.graph);
    Object.assign(st.model, ex.model, { expr: '', init: {}, fixed: {}, result: null, range: null });
    return st;
  }

  const nrows = () => S.vars.reduce((m, v) => Math.max(m, v.data.length), 0);

  /* ---------- calculs ---------- */

  function parseCalcLines(text) {
    const out = [];
    text.split('\n').forEach((raw, li) => {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^([A-Za-z_À-ɏΑ-ω][\wÀ-ɏΑ-ω]*)\s*(?:[\(\[]\s*([^\)\]]*?)\s*[\)\]])?\s*=\s*(.+)$/);
      if (!m) out.push({ line: li + 1, error: 'Écrivez « nom = expression ».' });
      else out.push({ line: li + 1, name: m[1], unit: m[2] || '', expr: m[3] });
    });
    return out;
  }

  /* Évalue une expression ligne par ligne. Les fonctions deriv/integ et
     les agrégats (mean, max…) sont d'abord remplacés par des colonnes ou des constantes. */
  function evalColumn(expr, cols, consts, n) {
    let node = math.parse(expr);
    let tmp = 0;
    const extra = {};
    const rowEval = (nd) => {
      const c = nd.compile(), sc = Object.assign({}, consts), arr = new Array(n);
      let firstErr = null, nerr = 0;
      for (let i = 0; i < n; i++) {
        for (const k in cols) sc[k] = cols[k][i];
        for (const k in extra) sc[k] = extra[k][i];
        try { const v = c.evaluate(sc); arr[i] = typeof v === 'number' ? v : NaN; } catch (e) { arr[i] = NaN; nerr++; firstErr = firstErr || e; }
      }
      if (n && nerr === n) throw firstErr;
      return arr;
    };
    node = node.transform(nd => {
      if (nd.isFunctionNode && nd.fn && COLUMN_FUNCS[nd.fn.name]) {
        if (nd.args.length !== 2) throw new Error(`${nd.fn.name}(y, x) attend deux arguments.`);
        const y = rowEval(nd.args[0]), x = rowEval(nd.args[1]);
        const r = nd.fn.name === 'deriv' ? E.derivative(y, x) : E.integral(y, x);
        const key = '__c' + (tmp++); extra[key] = r;
        return new math.SymbolNode(key);
      }
      if (nd.isFunctionNode && nd.fn && AGG_FUNCS.has(nd.fn.name) && nd.args.length === 1 && dependsOnColumns(nd.args[0], cols, extra)) {
        const v = rowEval(nd.args[0]).filter(isFinite);
        let r = NaN;
        if (v.length) {
          const st = E.describe(v);
          r = { mean: st.mean, min: st.min, max: st.max, std: st.s, sum: v.reduce((a, b) => a + b, 0), median: st.median }[nd.fn.name];
        }
        return new math.ConstantNode(r);
      }
      return nd;
    });
    const isCol = dependsOnColumns(node, cols, extra);
    if (!isCol) {
      const v = node.compile().evaluate(Object.assign({}, consts));
      if (typeof v !== 'number') throw new Error('Résultat non numérique.');
      return { scalar: v };
    }
    return { data: rowEval(node) };
  }

  function dependsOnColumns(node, cols, extra) {
    let dep = false;
    node.traverse(nd => { if (nd.isSymbolNode && (nd.name in cols || (extra && nd.name in extra))) dep = true; });
    return dep;
  }

  function symbolsOf(node) {
    const set = new Set();
    node.traverse((nd, path, parent) => {
      if (nd.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn')) set.add(nd.name);
    });
    return [...set];
  }

  function recompute() {
    const n = nrows();
    S.vars.forEach(v => { while (v.data.length < n) v.data.push(NaN); });
    const cols = {}, consts = {}, units = {}, calcVars = [], errors = [];
    S.vars.forEach(v => { cols[v.name] = v.data; units[v.name] = v.unit; });
    for (const c of parseCalcLines(S.calc)) {
      if (c.error) { errors.push(`Ligne ${c.line} : ${c.error}`); continue; }
      try {
        if (c.name in cols && S.vars.some(v => v.name === c.name)) throw new Error(`« ${c.name} » est déjà une variable mesurée.`);
        const r = evalColumn(c.expr, cols, consts, n);
        if ('scalar' in r) { consts[c.name] = r.scalar; units[c.name] = c.unit; calcVars.push({ name: c.name, unit: c.unit, scalar: r.scalar, expr: c.expr }); }
        else {
          cols[c.name] = r.data; units[c.name] = c.unit;
          calcVars.push({ name: c.name, unit: c.unit, data: r.data, expr: c.expr });
          if (r.data.every(v => !isFinite(v))) errors.push(`Ligne ${c.line} : « ${c.name} » ne donne aucune valeur numérique.`);
        }
      } catch (e) { errors.push(`Ligne ${c.line} : ${frErr(e)}`); }
    }
    // incertitudes
    const unc = {};
    const uDefs = {};
    S.vars.forEach(v => { if (v.u && String(v.u).trim()) uDefs[v.name] = v.u; });
    Object.entries(S.uCalc || {}).forEach(([k, u]) => { if (u && String(u).trim()) uDefs[k] = u; });
    for (const [name, expr] of Object.entries(uDefs)) {
      if (!(name in cols)) continue;
      try {
        const r = evalColumn(String(expr).replace(/,(?=\d)/g, '.'), cols, consts, n);
        unc[name] = 'scalar' in r ? Array(n).fill(Math.abs(r.scalar)) : r.data.map(Math.abs);
      } catch (e) { errors.push(`Incertitude de ${name} : ${frErr(e)}`); }
    }
    D = { cols, consts, units, calcVars, unc, errors, n,
      colNames: Object.keys(cols), calcNames: new Set(calcVars.filter(c => c.data).map(c => c.name)) };
  }

  function frErr(e) {
    let m = String(e && e.message || e);
    m = m.replace(/^Undefined symbol (.+)$/, 'symbole inconnu « $1 »')
      .replace(/^Undefined function (.+)$/, 'fonction inconnue « $1 »')
      .replace(/Unexpected end of expression.*/, 'expression incomplète')
      .replace(/Parenthesis \) expected.*/, 'parenthèse fermante manquante')
      .replace(/Value expected.*/, 'valeur attendue')
      .replace(/Unexpected operator (.+?) \(char (\d+)\)/, 'opérateur « $1 » inattendu (caractère $2)')
      .replace(/Syntax error in part "(.+?)".*/, 'syntaxe incorrecte près de « $1 »');
    return m;
  }

  /* ---------- utilitaires d'affichage ---------- */
  const fmt = v => (v === null || v === undefined || !isFinite(v)) ? '' : E.sig(v, 6);
  const unitOf = name => (D && D.units[name]) || '';
  const labelOf = name => unitOf(name) ? `${name} (${unitOf(name)})` : name;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const seriesColors = () => [cssVar('--accent'), cssVar('--s2'), cssVar('--s3'), cssVar('--s4'), '#c2255c', '#5c940d'];

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(serialize())); } catch (e) { /* stockage indisponible */ }
    }, 400);
  }
  function serialize() {
    const m = Object.assign({}, S.model, { result: null });
    return Object.assign({}, S, { model: m, vars: S.vars.map(v => ({ ...v, data: v.data.map(x => isFinite(x) ? x : null) })) });
  }
  function deserialize(o) {
    const st = emptyState();
    Object.assign(st, o);
    st.graph = Object.assign(emptyState().graph, o.graph || {});
    st.model = Object.assign(emptyState().model, o.model || {}, { result: null });
    st.vars = (o.vars || []).map(v => ({ name: v.name, unit: v.unit || '', u: v.u || '', data: (v.data || []).map(x => x === null ? NaN : +x) }));
    return st;
  }

  /* ---------- rendu général ---------- */
  function refreshAll(opts = {}) {
    recompute();
    fixSelections();
    $('projName').textContent = S.title || '';
    renderTable();
    renderVarList();
    renderCalcMsg();
    renderGraphControls();
    renderModelControls(opts.keepParams);
    renderPlot();
    renderStats();
    save();
  }

  function fixSelections() {
    const names = D.colNames;
    if (!names.includes(S.graph.x)) S.graph.x = names[0] || '';
    S.graph.ys = S.graph.ys.filter(y => names.includes(y) && y !== S.graph.x);
    if (!S.graph.ys.length) { const y = names.find(n => n !== S.graph.x); if (y) S.graph.ys = [y]; }
    if (!names.includes(S.model.y) || S.model.y === S.graph.x) S.model.y = S.graph.ys[0] || '';
  }

  /* ---------- tableau ---------- */
  function renderTable() {
    const t = $('dataTable'), n = D.n;
    const names = D.colNames;
    let h = '<thead><tr><th class="idx">n°</th>';
    names.forEach(nm => {
      const calc = D.calcNames.has(nm);
      h += `<th class="${calc ? 'calc' : ''}" title="${calc ? 'Grandeur calculée' : 'Variable mesurée'}">${esc(nm)}<span class="unit">${esc(unitOf(nm)) || '&nbsp;'}</span></th>`;
    });
    h += '</tr></thead><tbody>';
    const shown = Math.min(n, MAX_ROWS_SHOWN);
    for (let i = 0; i < shown; i++) {
      h += `<tr><td class="idx"><button class="del" data-del="${i}" title="Supprimer la ligne ${i + 1}" aria-label="Supprimer la ligne ${i + 1}">×</button>${i + 1}</td>`;
      names.forEach(nm => {
        const v = D.cols[nm][i], calc = D.calcNames.has(nm), txt = fmt(v);
        h += `<td class="${calc ? 'calc' : 'edit'}${txt === '' ? ' nan' : ''}" ${calc ? '' : `data-v="${esc(nm)}" data-r="${i}"`}>${txt}</td>`;
      });
      h += '</tr>';
    }
    if (n > shown) h += `<tr class="more"><td colspan="${names.length + 1}">${n - shown} lignes supplémentaires non affichées (elles sont utilisées dans les calculs et le graphe)</td></tr>`;
    h += '</tbody>';
    t.innerHTML = h;
    $('rowCount').textContent = `${n} ligne${n > 1 ? 's' : ''} · ${names.length} grandeur${names.length > 1 ? 's' : ''}`;
  }

  function startEdit(td) {
    if (td.isContentEditable) return;
    td.contentEditable = 'true'; td.classList.remove('nan');
    td.focus();
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(td); sel.removeAllRanges(); sel.addRange(r);
  }
  function commitEdit(td, move) {
    if (!td.isContentEditable) return;
    td.contentEditable = 'false';
    const v = S.vars.find(x => x.name === td.dataset.v), i = +td.dataset.r;
    const val = E.parseNumber(td.textContent);
    if (v) {
      const changed = !(Object.is(v.data[i], val) || (isNaN(v.data[i]) && isNaN(val)));
      v.data[i] = val;
      if (changed) refreshAll({ keepParams: true });
    }
    if (move) {
      const next = document.querySelector(`#dataTable td[data-v="${CSS.escape(td.dataset.v)}"][data-r="${i + move}"]`);
      if (next) startEdit(next);
    }
  }

  function bindTable() {
    const t = $('dataTable');
    t.addEventListener('dblclick', e => { const td = e.target.closest('td.edit'); if (td) startEdit(td); });
    t.addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { const i = +del.dataset.del; S.vars.forEach(v => v.data.splice(i, 1)); S.model.result = null; refreshAll({ keepParams: true }); return; }
      const td = e.target.closest('td.edit'); if (td && e.detail === 1 && document.activeElement && document.activeElement.isContentEditable) commitEdit(document.activeElement);
    });
    t.addEventListener('keydown', e => {
      const td = e.target.closest('td.edit');
      if (!td) return;
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(td, e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { td.contentEditable = 'false'; renderTable(); }
      if (e.key === 'Tab') { e.preventDefault(); const sib = e.shiftKey ? td.previousElementSibling : td.nextElementSibling; commitEdit(td); if (sib && sib.classList.contains('edit')) { const nt = document.querySelector(`#dataTable td[data-v="${CSS.escape(sib.dataset.v)}"][data-r="${td.dataset.r}"]`); if (nt) startEdit(nt); } }
    });
    t.addEventListener('focusout', e => { const td = e.target.closest('td.edit'); if (td && td.isContentEditable) commitEdit(td); });
    $('btnAddRow').onclick = () => {
      S.vars.forEach(v => v.data.push(NaN)); refreshAll({ keepParams: true });
      const w = $('tableWrap'); w.scrollTop = w.scrollHeight;
      const last = document.querySelector(`#dataTable td.edit[data-r="${D.n - 1}"]`); if (last) startEdit(last);
    };
    $('btnAddVar').onclick = () => { switchTab('vars'); showNewVar(); };
    // collage d'un tableau dans la page
    document.addEventListener('paste', e => {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a.isContentEditable && !/\n/.test(e.clipboardData.getData('text'))))) return;
      const txt = e.clipboardData.getData('text');
      if (!txt || !/\n/.test(txt.trim())) return;
      e.preventDefault();
      openImport(); $('pasteArea').value = txt; parsePasted();
    });
  }

  /* ---------- variables ---------- */
  function renderVarList() {
    const L = $('varList');
    let h = '<div class="varrow varhead"><span>nom</span><span>unité</span><span>incertitude</span><span></span></div>';
    S.vars.forEach((v, k) => {
      h += `<div class="varrow">
        <input data-k="${k}" data-f="name" value="${esc(v.name)}" aria-label="Nom">
        <input data-k="${k}" data-f="unit" value="${esc(v.unit)}" placeholder="—" aria-label="Unité de ${esc(v.name)}">
        <input data-k="${k}" data-f="u" value="${esc(v.u)}" placeholder="aucune" aria-label="Incertitude de ${esc(v.name)}" title="Nombre ou formule, par ex. 0.02*${esc(v.name)} + 0.01">
        <button class="btn sm ghost" data-delvar="${k}" title="Supprimer la variable ${esc(v.name)}" aria-label="Supprimer ${esc(v.name)}">×</button></div>`;
    });
    const calcCols = D.calcVars.filter(c => c.data);
    if (calcCols.length) {
      h += '<div class="varrow varhead" style="margin-top:6px"><span>calculée</span><span></span><span>incertitude</span><span></span></div>';
      calcCols.forEach(c => {
        h += `<div class="varrow"><input value="${esc(c.name)}" disabled aria-label="Nom"><input value="${esc(c.unit)}" disabled placeholder="—" aria-label="Unité">
          <input data-uc="${esc(c.name)}" value="${esc((S.uCalc || {})[c.name] || '')}" placeholder="aucune" aria-label="Incertitude de ${esc(c.name)}"><span></span></div>`;
      });
    }
    const sc = D.calcVars.filter(c => 'scalar' in c);
    if (sc.length) h += `<p class="hint">Constantes : ${sc.map(c => `<code>${esc(c.name)} = ${fmt(c.scalar)}${c.unit ? ' ' + esc(c.unit) : ''}</code>`).join(', ')}</p>`;
    L.innerHTML = h;
  }

  function bindVars() {
    $('varList').addEventListener('change', e => {
      const inp = e.target;
      if (inp.dataset.uc) { S.uCalc = S.uCalc || {}; S.uCalc[inp.dataset.uc] = inp.value.trim(); refreshAll({ keepParams: true }); return; }
      const k = +inp.dataset.k, f = inp.dataset.f; if (!f) return;
      const v = S.vars[k];
      if (f === 'name') {
        const nn = E.sanitizeName(inp.value, k);
        if (!nn || S.vars.some((x, j) => j !== k && x.name === nn)) { toast('Ce nom est déjà utilisé.'); inp.value = v.name; return; }
        const old = v.name; v.name = nn;
        if (S.graph.x === old) S.graph.x = nn;
        S.graph.ys = S.graph.ys.map(y => y === old ? nn : y);
        if (S.model.y === old) S.model.y = nn;
        S.calc = S.calc.replace(new RegExp(`\\b${old}\\b`, 'g'), nn);
        $('calcText').value = S.calc;
      } else v[f] = inp.value.trim();
      refreshAll({ keepParams: f !== 'name' });
    });
    $('varList').addEventListener('click', e => {
      const b = e.target.closest('[data-delvar]'); if (!b) return;
      const k = +b.dataset.delvar;
      if (b.dataset.armed) { S.vars.splice(k, 1); refreshAll(); toast('Variable supprimée'); }
      else { b.dataset.armed = '1'; b.textContent = 'Supprimer ?'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '×'; b.classList.remove('danger'); } }, 3000); }
    });
    $('btnNewVarOk').onclick = () => {
      const nm = E.sanitizeName($('newVarName').value, S.vars.length);
      if (!$('newVarName').value.trim()) { $('newVarName').focus(); return; }
      if (D.colNames.includes(nm)) { toast('Ce nom est déjà utilisé.'); return; }
      S.vars.push({ name: nm, unit: $('newVarUnit').value.trim(), u: '', data: Array(Math.max(nrows(), 1)).fill(NaN) });
      $('newVarForm').hidden = true; refreshAll(); switchTab('table');
      toast(`Variable ${nm} ajoutée : saisissez ses valeurs dans le tableau.`);
    };
    $('btnNewVarCancel').onclick = () => { $('newVarForm').hidden = true; };
    $('btnCalc').onclick = () => { S.calc = $('calcText').value; refreshAll({ keepParams: true }); if (!D.errors.length) toast('Calculs mis à jour'); };
    $('calcText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('btnCalc').click(); });
  }
  function showNewVar() { $('newVarForm').hidden = false; $('newVarName').value = ''; $('newVarUnit').value = ''; $('newVarName').focus(); }

  function renderCalcMsg() {
    if ($('calcText').value !== S.calc && document.activeElement !== $('calcText')) $('calcText').value = S.calc;
    $('calcMsg').innerHTML = D.errors.map(e => `<span class="err">${esc(e)}</span>`).join('');
  }

  /* ---------- graphe ---------- */
  function renderGraphControls() {
    const names = D.colNames;
    $('selX').innerHTML = names.map(n => `<option ${n === S.graph.x ? 'selected' : ''} value="${esc(n)}">${esc(labelOf(n))}</option>`).join('');
    const colors = seriesColors();
    $('yChips').innerHTML = names.filter(n => n !== S.graph.x).map(n => {
      const k = S.graph.ys.indexOf(n), on = k >= 0;
      return `<button class="chip ${on ? 'on' : ''}" data-y="${esc(n)}" aria-pressed="${on}" style="${on ? `--c:${colors[k % colors.length]};color:${colors[k % colors.length]}` : ''}"><span class="dot"></span><span style="color:var(--ink)">${esc(labelOf(n))}</span></button>`;
    }).join('');
    $('optLines').checked = !!S.graph.lines; $('optErr').checked = S.graph.err !== false;
    $('optLogX').checked = !!S.graph.logx; $('optLogY').checked = !!S.graph.logy; $('optRes').checked = S.graph.res !== false;
  }

  function bindGraph() {
    $('selX').onchange = e => { S.graph.x = e.target.value; S.model.result = null; S.model.range = null; S.model.init = {}; if (S.model.preset !== 'libre') S.model.expr = ''; refreshAll(); };
    $('yChips').onclick = e => {
      const c = e.target.closest('[data-y]'); if (!c) return;
      const y = c.dataset.y, k = S.graph.ys.indexOf(y);
      if (k >= 0) { if (S.graph.ys.length > 1) S.graph.ys.splice(k, 1); } else S.graph.ys.push(y);
      if (!S.graph.ys.includes(S.model.y)) { S.model.y = S.graph.ys[0]; S.model.result = null; }
      refreshAll();
    };
    [['optLines', 'lines'], ['optErr', 'err'], ['optLogX', 'logx'], ['optLogY', 'logy'], ['optRes', 'res']].forEach(([id, k]) => {
      $(id).onchange = e => { S.graph[k] = e.target.checked; renderPlot(); save(); };
    });
  }

  function plotLayoutBase() {
    const ink = cssVar('--ink'), muted = cssVar('--muted'), grid = cssVar('--grid'), minor = cssVar('--grid-minor'), line = cssVar('--line');
    const axis = (title, log) => ({
      title: { text: title, font: { size: 13, color: ink } }, type: log ? 'log' : 'linear',
      gridcolor: grid, zerolinecolor: line, linecolor: line, tickcolor: line, color: muted,
      minor: { showgrid: true, gridcolor: minor, ticks: '' }, mirror: true, showline: true, ticks: 'outside', ticklen: 4,
      automargin: true, exponentformat: 'power'
    });
    return {
      axis,
      layout: {
        paper_bgcolor: cssVar('--panel'), plot_bgcolor: cssVar('--panel'),
        font: { family: 'IBM Plex Sans, system-ui, sans-serif', color: ink, size: 12 },
        margin: { l: 64, r: 18, t: 18, b: 52 }, separators: ', ',
        legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { size: 12 } },
        hoverlabel: { font: { family: 'IBM Plex Mono, monospace' } },
        selections: [], dragmode: pickMode ? 'select' : 'zoom', selectdirection: 'h'
      }
    };
  }

  let pickMode = false, plotRev = 0;
  function renderPlot() {
    const el = $('plot');
    if (!window.Plotly) { el.innerHTML = '<p class="note" style="padding:16px">La bibliothèque graphique n’a pas pu être chargée. Vérifiez la connexion internet.</p>'; return; }
    const X = D.cols[S.graph.x] || [], colors = seriesColors();
    const ux = D.unc[S.graph.x];
    const traces = [];
    const res = S.model.result;
    const showRes = res && S.graph.res !== false;
    S.graph.ys.forEach((y, k) => {
      const Y = D.cols[y]; if (!Y) return;
      const uy = D.unc[y];
      const c = colors[k % colors.length];
      const tr = {
        x: X.slice(), y: Y.slice(), name: labelOf(y), type: 'scatter', mode: S.graph.lines ? 'lines+markers' : 'markers',
        marker: { color: c, size: 6, symbol: 'cross-thin', line: { width: 1.6, color: c } }, line: { color: c, width: 1 },
        hovertemplate: `${esc(S.graph.x)} = %{x}<br>${esc(y)} = %{y}<extra></extra>`
      };
      if (S.graph.err !== false && uy) tr.error_y = { type: 'data', array: uy, color: c, thickness: 1, width: 3 };
      if (S.graph.err !== false && ux) tr.error_x = { type: 'data', array: ux, color: c, thickness: 1, width: 3 };
      if (!S.graph.lines && !(S.graph.err !== false && (uy || ux))) tr.marker = { color: c, size: 7, symbol: 'cross-thin', line: { width: 2, color: c } };
      traces.push(tr);
    });
    const shapes = [];
    if (res && res.curve) {
      traces.push({ x: res.curve.x, y: res.curve.y, name: 'modèle', mode: 'lines', line: { color: cssVar('--model'), width: 2.2 }, hoverinfo: 'skip' });
      if (showRes) {
        traces.push({ x: res.xs, y: res.normRes || res.residuals, name: 'résidus', xaxis: 'x', yaxis: 'y2', mode: 'markers', showlegend: false,
          marker: { color: cssVar('--model'), size: 5 }, hovertemplate: (res.normRes ? 'écart normalisé = %{y}' : 'résidu = %{y}') + '<extra></extra>' });
      }
    }
    if (S.model.range) {
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: S.model.range[0], x1: S.model.range[1], y0: showRes ? 0.3 : 0, y1: 1,
        fillcolor: cssVar('--model-soft'), line: { width: 0 }, layer: 'below' });
    }
    const { layout, axis } = plotLayoutBase();
    layout.xaxis = axis(labelOf(S.graph.x), S.graph.logx);
    const ytitle = S.graph.ys.map(labelOf).join(', ');
    layout.yaxis = axis(ytitle, S.graph.logy);
    if (showRes) {
      layout.yaxis.domain = [0.3, 1];
      layout.yaxis2 = Object.assign(axis(res.normRes ? 'écart / u' : 'résidu', false), { domain: [0, 0.2], anchor: 'x', zeroline: true, zerolinecolor: cssVar('--model'), zerolinewidth: 1 });
      layout.yaxis2.title.font.size = 11;
      layout.xaxis.anchor = 'y2';
    }
    layout.showlegend = traces.length > 1;
    layout.shapes = shapes;
    layout.datarevision = ++plotRev;
    Plotly.react(el, traces, layout, {
      responsive: true, displaylogo: false, scrollZoom: false,
      modeBarButtonsToRemove: ['lasso2d', 'autoScale2d', 'toggleSpikelines'],
      toImageButtonOptions: { filename: (S.title || 'graphe').replace(/[^\w-]+/g, '_'), scale: 2 }
    });
    if (!el._microlabBound) {
      el._microlabBound = true;
      el.on('plotly_selected', ev => {
        if (!pickMode) return;
        let r = null;
        const pts = ev && ev.points ? ev.points.filter(p => p.data && p.data.yaxis !== 'y2') : [];
        if (pts.length >= 2) { const xs = pts.map(p => p.x); r = [Math.min(...xs), Math.max(...xs)]; }
        else if (ev && ev.range && ev.range.x && !S.graph.logx) r = ev.range.x;
        if (!r) { setPick(false); toast('Sélectionnez au moins deux points.'); return; }
        setPick(false);
        S.model.range = [Math.min(r[0], r[1]), Math.max(r[0], r[1])];
        S.model.result = null; renderModelRange(); doFit(true);
      });
    }
  }

  function setPick(on) {
    pickMode = on;
    $('btnPickRange').textContent = on ? 'Glissez sur le graphe…' : 'Choisir sur le graphe';
    $('btnPickRange').classList.toggle('primary', on);
    if (window.Plotly) Plotly.relayout($('plot'), { dragmode: on ? 'select' : 'zoom', selections: [] });
    if (on) { toast('Faites glisser horizontalement sur le graphe pour délimiter la zone à modéliser.'); $('plot').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  /* ---------- modélisation ---------- */
  function currentModelParams() {
    try {
      const node = math.parse(S.model.expr);
      const known = new Set([S.graph.x, ...Object.keys(D.consts)]);
      return symbolsOf(node).filter(s => !known.has(s) && !CONSTS.has(s) && !(s in D.cols));
    } catch (e) { return null; }
  }

  function renderModelControls(keepParams) {
    const names = D.colNames.filter(n => n !== S.graph.x);
    $('selModelY').innerHTML = names.map(n => `<option ${n === S.model.y ? 'selected' : ''} value="${esc(n)}">${esc(labelOf(n))}</option>`).join('');
    $('selPreset').innerHTML = PRESETS.map(p => `<option value="${p.id}" ${p.id === S.model.preset ? 'selected' : ''}>${p.label}${p.tpl ? ' — ' + presetExpr(p, S.graph.x) : ''}</option>`).join('');
    const p = PRESETS.find(q => q.id === S.model.preset);
    if (!S.model.expr && p && p.tpl) { S.model.expr = presetExpr(p, S.graph.x); S.model.init = {}; }
    $('modelLhs').textContent = (S.model.y || 'y') + ' =';
    if (document.activeElement !== $('modelExpr')) $('modelExpr').value = S.model.expr;
    const ok = !!D.unc[S.model.y];
    $('optWeight').checked = ok && S.model.weight !== false; $('optWeight').disabled = !ok;
    $('optWeight').parentElement.classList.toggle('off', !ok);
    $('optWeight').parentElement.title = ok ? '' : `Indiquez une incertitude pour ${S.model.y} dans l’onglet Grandeurs pour pondérer l’ajustement.`;
    renderModelRange();
    if (!keepParams || !S.model.result) ensureInit();
    renderParams();
    renderFitResult();
  }

  function renderModelRange() {
    const r = S.model.range;
    $('rangeText').innerHTML = r ? `Domaine : <b>${fmt(r[0])}</b> ≤ ${esc(S.graph.x)} ≤ <b>${fmt(r[1])}</b>` : 'Domaine : toutes les données';
    $('btnClearRange').hidden = !r;
  }

  function fitData() {
    const X = D.cols[S.graph.x], Y = D.cols[S.model.y];
    const ux = D.unc[S.graph.x], uy = D.unc[S.model.y];
    const r = S.model.range;
    const xs = [], ys = [], sx = [], sy = [];
    for (let i = 0; i < D.n; i++) {
      const x = X[i], y = Y[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (r && (x < r[0] || x > r[1])) continue;
      xs.push(x); ys.push(y); sx.push(ux ? ux[i] : 0); sy.push(uy ? uy[i] : 0);
    }
    return { xs, ys, sx: ux ? sx : null, sy: uy ? sy : null };
  }

  function ensureInit() {
    const params = currentModelParams();
    if (!params) return;
    const missing = params.some(p => !(p in S.model.init));
    if (missing) {
      const g = guessParams(params);
      params.forEach(p => { if (!(p in S.model.init)) S.model.init[p] = g[p]; });
    }
  }

  function guessParams(params) {
    const { xs, ys } = fitData();
    const g = {}; params.forEach(p => { g[p] = 1; });
    const n = xs.length; if (n < 2) return g;
    const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const X = idx.map(i => xs[i]), Y = idx.map(i => ys[i]);
    const xmin = X[0], xmax = X[n - 1], span = (xmax - xmin) || 1;
    const ymin = Math.min(...Y), ymax = Math.max(...Y), ymean = Y.reduce((a, b) => a + b, 0) / n;
    const id = S.model.preset;
    const p0 = PRESETS.find(p => p.id === id);
    if (!p0 || presetExpr(p0, S.graph.x).replace(/\s/g, '') !== S.model.expr.replace(/\s/g, '')) {
      // expression personnalisée : on part de 1, ou d'une estimation linéaire si possible
      return g;
    }
    const set = o => Object.entries(o).forEach(([k, v]) => { if (k in g && isFinite(v)) g[k] = v; });
    try {
      switch (id) {
        case 'lin': { let sxy = 0, sxx = 0; X.forEach((x, i) => { sxy += x * Y[i]; sxx += x * x; }); set({ a: sxy / sxx }); break; }
        case 'aff': { const L = E.linreg(X, Y); set({ a: L.a, b: L.b }); break; }
        case 'const': set({ c: ymean }); break;
        case 'para': { const r = polyfit(X, Y, 2); set({ a: r[2], b: r[1], c: r[0] }); break; }
        case 'expdec': {
          const B = Y[n - 1], A = Y[0] - B;
          const target = Math.abs(A) * Math.exp(-1);
          let tau = span / 3;
          for (let i = 0; i < n; i++) if (Math.abs(Y[i] - B) <= target) { tau = Math.max((X[i] - xmin) || span / 3, span / 50); break; }
          set({ A: A * Math.exp(xmin / tau), B, tau }); break;
        }
        case 'charge': {
          const A = Y[n - 1]; let tau = span / 3;
          for (let i = 0; i < n; i++) if (Math.abs(Y[i]) >= 0.63 * Math.abs(A)) { tau = X[i] || span / 3; break; }
          set({ A, tau }); break;
        }
        case 'exp': {
          const pos = X.map((x, i) => [x, Y[i]]).filter(p => p[1] !== 0);
          const sgn = Math.sign(ymean) || 1;
          const L = E.linreg(pos.map(p => p[0]), pos.map(p => Math.log(Math.abs(p[1]))));
          set({ A: sgn * Math.exp(L.b), k: L.a }); break;
        }
        case 'puiss': {
          const pos = X.map((x, i) => [x, Y[i]]).filter(p => p[0] > 0 && p[1] > 0);
          if (pos.length >= 2) { const L = E.linreg(pos.map(p => Math.log(p[0])), pos.map(p => Math.log(p[1]))); set({ A: Math.exp(L.b), n: L.a }); }
          break;
        }
        case 'ln': { const pos = X.map((x, i) => [x, Y[i]]).filter(p => p[0] > 0); const L = E.linreg(pos.map(p => Math.log(p[0])), pos.map(p => p[1])); set({ a: L.a, b: L.b }); break; }
        case 'inv': { const pos = X.map((x, i) => [x, Y[i]]).filter(p => p[0] !== 0); const L = E.linreg(pos.map(p => 1 / p[0]), pos.map(p => p[1])); set({ a: L.a, b: L.b }); break; }
        case 'gauss': {
          const k = Y.indexOf(ymax), half = ymax / 2;
          const above = X.filter((_, i) => Y[i] >= half);
          set({ A: ymax, m: X[k], s: Math.max((Math.max(...above) - Math.min(...above)) / 2.355, span / 50) }); break;
        }
        case 'sin': case 'sinam': {
          const C = ymean, A = (ymax - ymin) / 2;
          const cross = [];
          for (let i = 1; i < n; i++) if ((Y[i - 1] - C) * (Y[i] - C) < 0) cross.push(X[i - 1] + (X[i] - X[i - 1]) * (C - Y[i - 1]) / (Y[i] - Y[i - 1]));
          const T = cross.length >= 3 ? 2 * (cross[cross.length - 1] - cross[0]) / (cross.length - 1) : span;
          const base = { A, T, C, phi: 0 };
          if (id === 'sinam') {
            // enveloppe : amplitude début / fin
            const q = Math.max(3, Math.floor(n / 4));
            const a1 = Math.max(...Y.slice(0, q).map(y => Math.abs(y - C))), a2 = Math.max(...Y.slice(n - q).map(y => Math.abs(y - C)));
            base.tau = a2 > 0 && a1 > a2 ? (X[n - q] - X[0]) / Math.log(a1 / a2) : span;
            base.A = a1 * Math.exp(xmin / base.tau);
          }
          // balayage de la phase
          const f = compileModel(params);
          let best = Infinity, bphi = 0;
          for (let j = 0; j < 24; j++) {
            const phi = -Math.PI + j * Math.PI / 12;
            const pv = params.map(p => p === 'phi' ? phi : (p in base ? base[p] : 1));
            let s = 0; for (let i = 0; i < n; i++) s += (Y[i] - f(X[i], pv)) ** 2;
            if (s < best) { best = s; bphi = phi; }
          }
          base.phi = bphi; set(base); break;
        }
      }
    } catch (e) { /* on garde les valeurs par défaut */ }
    return g;
  }

  function polyfit(x, y, deg) {
    const m = deg + 1, A = Array.from({ length: m }, () => Array(m).fill(0)), b = Array(m).fill(0);
    x.forEach((xi, i) => { for (let r = 0; r < m; r++) { b[r] += y[i] * xi ** r; for (let c = 0; c < m; c++) A[r][c] += xi ** (r + c); } });
    return E.solve(A, b) || Array(m).fill(1);
  }

  function compileModel(params) {
    const c = math.parse(S.model.expr).compile();
    const scope = Object.assign({}, D.consts);
    const xn = S.graph.x;
    return (x, p) => {
      scope[xn] = x;
      for (let k = 0; k < params.length; k++) scope[params[k]] = p[k];
      try { const v = c.evaluate(scope); return typeof v === 'number' ? v : NaN; } catch (e) { return NaN; }
    };
  }

  function renderParams() {
    const params = currentModelParams();
    const t = $('paramTable');
    if (params === null) { t.innerHTML = '<tbody><tr class="empty"><td>L’expression du modèle est incorrecte.</td></tr></tbody>'; return; }
    if (!params.length) { t.innerHTML = '<tbody><tr class="empty"><td>Aucun paramètre à ajuster dans cette expression.</td></tr></tbody>'; return; }
    const res = S.model.result;
    let h = '<thead><tr><th>Paramètre</th><th>Valeur initiale</th><th>Fixé</th><th class="num">Valeur ajustée</th><th class="num">Incertitude u</th><th class="num">u relative</th></tr></thead><tbody>';
    params.forEach(p => {
      const k = res ? res.params.indexOf(p) : -1;
      let val = '', u = '', rel = '';
      if (k >= 0) {
        const v = res.fit.p[k], uu = res.fit.u[k];
        const f = S.model.fixed[p] ? { v: E.sig(v, 6), u: '' } : E.formatValU(v, uu);
        const ex = f.exp !== undefined ? ` ×10<sup>${f.exp}</sup>` : '';
        val = `<span class="val">${f.v}</span>${f.u ? '' : ex}`;
        u = f.u ? `${f.u}${ex}` : (S.model.fixed[p] ? 'fixé' : '—');
        rel = uu > 0 && v !== 0 && !S.model.fixed[p] ? E.sig(100 * uu / Math.abs(v), 2) + ' %' : '';
      }
      h += `<tr><td class="pname">${esc(p)}</td>
        <td><input type="text" data-init="${esc(p)}" value="${esc(E.sig(S.model.init[p] ?? 1, 6))}" inputmode="decimal" aria-label="Valeur initiale de ${esc(p)}"></td>
        <td><input type="checkbox" data-fix="${esc(p)}" ${S.model.fixed[p] ? 'checked' : ''} aria-label="Fixer ${esc(p)}"></td>
        <td class="num">${val}</td><td class="num">${u}</td><td class="num rel">${rel}</td></tr>`;
    });
    t.innerHTML = h + '</tbody>';
  }

  function doFit(silent) {
    $('fitMsg').innerHTML = '';
    const params = currentModelParams();
    if (!params) { $('fitMsg').innerHTML = '<span class="err">L’expression du modèle est incorrecte.</span>'; return; }
    if (!params.length) { $('fitMsg').innerHTML = '<span class="err">Ajoutez au moins un paramètre (par ex. a, b, tau) à l’expression.</span>'; return; }
    ensureInit();
    const { xs, ys, sx, sy } = fitData();
    const weight = S.model.weight !== false && !!sy && sy.every(v => v > 0);
    if (S.model.weight !== false && sy && !sy.every(v => v > 0)) $('fitMsg').innerHTML = '<span class="err">Certaines incertitudes sont nulles : ajustement non pondéré.</span>';
    const f = compileModel(params);
    try {
      const fit = E.fit(f, xs, ys, params.map(p => +S.model.init[p]), { sy: weight ? sy : null, sx: weight ? sx : null, fixed: params.map(p => !!S.model.fixed[p]) });
      if (fit.p.some(v => !isFinite(v))) throw new Error('L’ajustement a divergé. Modifiez les valeurs initiales.');
      // courbe lisse
      const all = (D.cols[S.graph.x] || []).filter(isFinite);
      let lo = S.model.range ? S.model.range[0] : Math.min(...all), hi = S.model.range ? S.model.range[1] : Math.max(...all);
      const N = 400, cx = [], cy = [];
      if (S.graph.logx && lo > 0) { const a = Math.log10(lo), b = Math.log10(hi); for (let i = 0; i <= N; i++) cx.push(10 ** (a + (b - a) * i / N)); }
      else for (let i = 0; i <= N; i++) cx.push(lo + (hi - lo) * i / N);
      cx.forEach(x => cy.push(f(x, fit.p)));
      const normRes = fit.normResiduals;
      S.model.result = { params, fit, xs, residuals: fit.residuals, normRes, curve: { x: cx, y: cy }, weighted: fit.weighted, expr: S.model.expr, y: S.model.y, x: S.graph.x };
      if (!fit.converged) $('fitMsg').innerHTML = '<span class="err">L’ajustement n’a pas complètement convergé : essayez d’autres valeurs initiales.</span>';
    } catch (e) {
      S.model.result = null;
      $('fitMsg').innerHTML = `<span class="err">${esc(frErr(e))}</span>`;
    }
    renderParams(); renderFitResult(); renderPlot(); save();
    if (!silent && S.model.result) toast('Modèle ajusté');
  }

  function equationText(res) {
    try {
      const node = math.parse(res.expr).transform(nd => {
        if (nd.isSymbolNode && res.params.includes(nd.name)) {
          const k = res.params.indexOf(nd.name);
          return new math.ConstantNode(+E.sig(res.fit.p[k], 4).replace(',', '.').replace(/e/, 'e'));
        }
        return nd;
      });
      return node.toString({ implicit: 'hide', parenthesis: 'auto' }).replace(/(\d)\.(\d)/g, '$1,$2').replace(/\+ -/g, '− ').replace(/ \* /g, '·');
    } catch (e) { return res.expr; }
  }

  function renderFitResult() {
    const res = S.model.result, out = $('fitResult');
    if (!res) { out.innerHTML = ''; return; }
    const f = res.fit;
    const items = [];
    items.push(['Points utilisés', `${f.n}`]);
    items.push(['Degrés de liberté', `${f.dof}`]);
    items.push(['Coefficient R²', isFinite(f.r2) ? f.r2.toFixed(f.r2 > 0.9999 ? 6 : 4).replace('.', ',') : '—',
      isFinite(f.r2) ? (f.r2 > 0.99 ? ['good', 'très bon'] : f.r2 > 0.95 ? ['mid', 'correct'] : ['badp', 'faible']) : null]);
    if (f.weighted) {
      const c = f.chi2red;
      items.push(['χ² réduit', E.sig(c, 3), c < 0.2 ? ['mid', 'u surestimées ?'] : c <= 2 ? ['good', 'compatible'] : c <= 5 ? ['mid', 'limite'] : ['badp', 'incompatible']]);
      items.push(['Probabilité du χ²', isFinite(f.chi2p) ? (100 * f.chi2p).toFixed(f.chi2p < 0.01 ? 2 : 0).replace('.', ',') + ' %' : '—']);
    } else {
      items.push(['Écart-type des résidus', E.sig(f.sres, 3) + (unitOf(res.y) ? ' ' + unitOf(res.y) : '')]);
    }
    items.push(['Coefficient de Student (95 %)', isFinite(f.t95) ? E.sig(f.t95, 4) : '—']);
    const ind = items.map(([k, v, pill]) => `<div class="ind"><div class="k">${k}</div><div class="v">${v}${pill ? `<span class="pill ${pill[0]}">${pill[1]}</span>` : ''}</div></div>`).join('');
    const ci = res.params.filter(p => !S.model.fixed[p]).map(p => {
      const k = res.params.indexOf(p), U = f.u[k] * f.t95;
      const fv = E.formatValU(f.p[k], U);
      return `<code>${esc(p)} = ${fv.v} ± ${fv.u}${fv.exp !== undefined ? ` ×10<sup>${fv.exp}</sup>` : ''}</code>`;
    }).join(' · ');
    const note = f.weighted
      ? 'Ajustement pondéré par les incertitudes (méthode des moindres carrés généralisée). Un χ² réduit proche de 1 indique que les écarts au modèle sont du même ordre que les incertitudes de mesure. Les résidus sont affichés divisés par l’incertitude : ils doivent rester majoritairement entre −2 et 2.'
      : 'Ajustement non pondéré. Les incertitudes sur les paramètres sont estimées à partir de la dispersion des points autour du modèle. Les résidus doivent se répartir au hasard autour de zéro, sans tendance.';
    out.innerHTML = `<div class="eq">${esc(res.y)} = ${esc(equationText(res))}</div>
      <div class="indic">${ind}</div>
      ${ci && isFinite(f.t95) ? `<p class="note">Intervalles de confiance à 95 % (u × t) : ${ci}</p>` : ''}
      <p class="note">${note}</p>`;
  }

  function resultsText() {
    const res = S.model.result; if (!res) return '';
    const f = res.fit;
    let s = `Modèle : ${res.y} = ${res.expr}\n`;
    res.params.forEach((p, k) => { const fv = E.formatValU(f.p[k], f.u[k]); s += `${p} = ${fv.v}${fv.u ? ' ± ' + fv.u : ''}${fv.exp !== undefined ? ' ×10^' + fv.exp : ''}${S.model.fixed[p] ? ' (fixé)' : ''}\n`; });
    s += `n = ${f.n}, ddl = ${f.dof}, R² = ${f.r2.toFixed(5)}`;
    if (f.weighted) s += `, χ² réduit = ${E.sig(f.chi2red, 3)}`; else s += `, écart-type des résidus = ${E.sig(f.sres, 3)}`;
    return s.replace(/(\d)\.(\d)/g, '$1,$2') + '\n';
  }

  function bindModel() {
    $('selModelY').onchange = e => { S.model.y = e.target.value; S.model.result = null; S.model.init = {}; refreshAll(); };
    $('selPreset').onchange = e => {
      S.model.preset = e.target.value; S.model.result = null; S.model.fixed = {};
      const p = PRESETS.find(q => q.id === S.model.preset);
      if (p.tpl) S.model.expr = presetExpr(p, S.graph.x);
      S.model.init = {};
      renderModelControls();
      if (p.tpl) doFit(true); else { $('modelExpr').focus(); renderPlot(); }
    };
    let exprTimer;
    $('modelExpr').addEventListener('input', e => {
      S.model.expr = e.target.value.replace(/,(?=\d)/g, '.');
      const p = PRESETS.find(q => q.id === S.model.preset);
      if (p && p.tpl && presetExpr(p, S.graph.x).replace(/\s/g, '') !== S.model.expr.replace(/\s/g, '')) {
        S.model.preset = 'libre'; $('selPreset').value = 'libre';
      }
      clearTimeout(exprTimer);
      exprTimer = setTimeout(() => { S.model.result = null; ensureInit(); renderParams(); renderFitResult(); renderPlot(); save(); }, 250);
    });
    $('modelExpr').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doFit(); } });
    $('paramTable').addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.init) { const v = E.parseNumber(t.value); if (isFinite(v)) S.model.init[t.dataset.init] = v; else t.value = E.sig(S.model.init[t.dataset.init], 6); }
      if (t.dataset.fix) S.model.fixed[t.dataset.fix] = t.checked;
      save();
    });
    $('paramTable').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.init) { e.target.dispatchEvent(new Event('change', { bubbles: true })); doFit(); } });
    $('btnFit').onclick = () => doFit();
    $('btnGuess').onclick = () => {
      const params = currentModelParams(); if (!params) return;
      const g = guessParams(params); params.forEach(p => { if (!S.model.fixed[p]) S.model.init[p] = g[p]; });
      renderParams(); toast('Valeurs initiales estimées à partir des données');
    };
    $('btnClearModel').onclick = () => { S.model.result = null; S.model.range = null; renderModelRange(); renderParams(); renderFitResult(); renderPlot(); save(); };
    $('btnPickRange').onclick = () => setPick(!pickMode);
    $('btnClearRange').onclick = () => { S.model.range = null; renderModelRange(); if (S.model.result) doFit(true); else renderPlot(); save(); };
    $('optWeight').onchange = e => { S.model.weight = e.target.checked; if (S.model.result) doFit(true); else save(); };
    $('btnCopyRes').onclick = async () => {
      const s = resultsText(); if (!s) { toast('Ajustez d’abord un modèle.'); return; }
      try { await navigator.clipboard.writeText(s); toast('Résultats copiés'); }
      catch (e) { $('fitMsg').innerHTML = `<pre class="mono" style="white-space:pre-wrap;margin:0">${esc(s)}</pre>`; toast('Copie impossible : sélectionnez le texte affiché.'); }
    };
  }

  /* ---------- statistiques ---------- */
  function renderStats() {
    const names = D.colNames;
    if (!S.statVar || !names.includes(S.statVar)) S.statVar = S.graph.ys[0] || names[0];
    $('selStat').innerHTML = names.map(n => `<option ${n === S.statVar ? 'selected' : ''} value="${esc(n)}">${esc(labelOf(n))}</option>`).join('');
    if ($('pane-stats').hidden) return;
    const v = D.cols[S.statVar] || [], st = E.describe(v), un = unitOf(S.statVar), U = un ? ' ' + esc(un) : '';
    if (!st.n || !window.Plotly) { $('statTable').innerHTML = '<p class="note">Aucune valeur numérique.</p>'; if (window.Plotly) Plotly.purge($('histo')); return; }
    const fu = E.formatValU(st.mean, st.u);
    const ex = fu.exp !== undefined ? ` ×10<sup>${fu.exp}</sup>` : '';
    const rows = [
      ['Nombre de mesures n', st.n],
      ['Moyenne', E.sig(st.mean, 6) + U],
      ['Écart-type expérimental s', E.sig(st.s, 3) + U],
      ['Incertitude-type u = s/√n', E.sig(st.u, 2) + U, 'hl'],
      ['Résultat', `${fu.v}${fu.u ? ' ± ' + fu.u : ''}${ex}${U}`, 'hl'],
      ['Intervalle à 95 % (t = ' + E.sig(st.t95, 3) + ')', '± ' + E.sig(st.u * st.t95, 2) + U],
      ['Médiane', E.sig(st.median, 6) + U],
      ['Minimum', E.sig(st.min, 6) + U],
      ['Maximum', E.sig(st.max, 6) + U]
    ];
    const ref = E.parseNumber($('statRef').value);
    if (isFinite(ref) && st.u > 0) {
      const z = Math.abs(st.mean - ref) / st.u;
      rows.push(['Écart normalisé z = |x̄ − réf| / u', `${E.sig(z, 2)} <span class="pill ${z <= 2 ? 'good' : 'badp'}">${z <= 2 ? 'compatible' : 'non compatible'}</span>`, 'hl']);
    }
    $('statTable').innerHTML = `<table class="stat-table"><tbody>${rows.map(r => `<tr class="${r[2] || ''}"><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table>`;
    // histogramme
    const vals = v.filter(isFinite);
    const nb = Math.max(4, Math.ceil(Math.log2(vals.length) + 1));
    const { layout, axis } = plotLayoutBase();
    layout.margin = { l: 44, r: 10, t: 10, b: 44 };
    layout.xaxis = axis(labelOf(S.statVar)); layout.yaxis = axis('effectif');
    layout.dragmode = 'zoom'; layout.bargap = 0.06; layout.showlegend = false;
    layout.shapes = [{ type: 'line', x0: st.mean, x1: st.mean, yref: 'paper', y0: 0, y1: 1, line: { color: cssVar('--model'), width: 2 } }];
    if (isFinite(ref)) layout.shapes.push({ type: 'line', x0: ref, x1: ref, yref: 'paper', y0: 0, y1: 1, line: { color: cssVar('--ink'), width: 1.5, dash: 'dash' } });
    Plotly.react($('histo'), [{ x: vals, type: 'histogram', nbinsx: nb, marker: { color: cssVar('--accent'), opacity: 0.75 }, hovertemplate: '%{x} : %{y}<extra></extra>' }], layout, { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] });
  }

  function bindStats() {
    $('selStat').onchange = e => { S.statVar = e.target.value; renderStats(); save(); };
    $('statRef').addEventListener('input', () => renderStats());
  }

  /* ---------- onglets ---------- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => {
      const group = b.parentElement;
      if (![...group.children].some(c => c.dataset.tab === name)) return;
      b.classList.toggle('active', b.dataset.tab === name);
      b.setAttribute('aria-selected', b.dataset.tab === name);
      $('pane-' + b.dataset.tab).hidden = b.dataset.tab !== name;
    });
    if (name === 'stats') renderStats();
    if (name === 'model' && window.Plotly) Plotly.Plots.resize($('plot'));
  }

  /* ---------- import ---------- */
  let pending = null, pendingBook = null;

  function openImport() {
    $('importModal').hidden = false; pending = null; pendingBook = null;
    $('sheetField').hidden = true; $('sepField').hidden = false;
    $('pasteArea').hidden = false; $('pasteArea').value = '';
    $('previewTable').innerHTML = ''; $('importInfo').innerHTML = '';
    $('btnImportOk').disabled = true; $('btnImportAdd').disabled = true;
    setTimeout(() => $('pasteArea').focus(), 30);
  }
  function closeImport() { $('importModal').hidden = true; }

  function showPreview(table, info) {
    pending = table;
    const v = table.vars, n = Math.min(table.nrows, 8);
    let h = '<thead><tr>' + v.map(c => `<th>${esc(c.name)}<span class="unit">${esc(c.unit) || '&nbsp;'}</span></th>`).join('') + '</tr></thead><tbody>';
    for (let i = 0; i < n; i++) h += '<tr>' + v.map(c => `<td>${fmt(c.data[i])}</td>`).join('') + '</tr>';
    if (table.nrows > n) h += `<tr class="more"><td colspan="${v.length}">… ${table.nrows - n} autres lignes</td></tr>`;
    $('previewTable').innerHTML = h + '</tbody>';
    $('importInfo').innerHTML = `<span class="ok">${table.nrows} lignes, ${v.length} colonnes numériques${info ? ' · ' + esc(info) : ''}.</span>`;
    $('btnImportOk').disabled = false;
    $('btnImportAdd').disabled = !(S.vars.length && table.nrows === nrows());
  }
  function importError(e) {
    pending = null; $('previewTable').innerHTML = '';
    $('importInfo').innerHTML = `<span class="err">${esc(e.message || e)}</span>`;
    $('btnImportOk').disabled = true; $('btnImportAdd').disabled = true;
  }
  const sepName = s => ({ ';': 'séparateur point-virgule', ',': 'séparateur virgule', '\t': 'séparateur tabulation', ' ': 'séparateur espace' }[s] || '');

  function parsePasted() {
    const txt = $('pasteArea').value;
    if (!txt.trim()) { importError({ message: '' }); $('importInfo').innerHTML = ''; return; }
    try { const r = E.textToRows(txt, $('selSep').value); showPreview(E.rowsToTable(r.rows), sepName(r.sep)); }
    catch (e) { importError(e); }
  }

  function parseSheet() {
    try {
      const ws = pendingBook.Sheets[$('selSheet').value];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      showPreview(E.rowsToTable(rows), 'feuille « ' + $('selSheet').value + ' »');
    } catch (e) { importError(e); }
  }

  let pendingName = '';
  function handleFile(file) {
    if (!file) return;
    const name = file.name, ext = name.split('.').pop().toLowerCase();
    pendingName = name.replace(/\.[^.]+$/, '');
    const reader = new FileReader();
    if (ext === 'json') {
      reader.onload = () => {
        try { S = deserialize(JSON.parse(reader.result)); $('calcText').value = S.calc; refreshAll(); if (S.model.expr) doFit(true); toast('Projet ouvert : ' + name); }
        catch (e) { toast('Ce fichier .json n’est pas un projet MicroLab.'); }
      };
      reader.readAsText(file); return;
    }
    openImport();
    if (['ods', 'xlsx', 'xls'].includes(ext)) {
      if (!window.XLSX) { importError({ message: 'La bibliothèque de lecture des tableurs n’a pas pu être chargée. Vérifiez la connexion internet.' }); return; }
      reader.onload = () => {
        try {
          pendingBook = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          $('pasteArea').hidden = true; $('sepField').hidden = true;
          $('selSheet').innerHTML = pendingBook.SheetNames.map(s => `<option>${esc(s)}</option>`).join('');
          $('sheetField').hidden = pendingBook.SheetNames.length < 2;
          parseSheet();
        } catch (e) { importError({ message: 'Impossible de lire ce classeur : ' + e.message }); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        let txt = reader.result;
        if (txt.includes('\uFFFD')) { // probablement en Latin-1 (Windows)
          const r2 = new FileReader(); r2.onload = () => { $('pasteArea').value = r2.result; parsePasted(); }; r2.readAsText(file, 'windows-1252'); return;
        }
        $('pasteArea').value = txt; parsePasted();
      };
      reader.readAsText(file, 'utf-8');
    }
  }

  function applyImport(append) {
    if (!pending) return;
    const vars = pending.vars.map(v => ({ name: v.name, unit: v.unit, u: '', data: v.data }));
    if (append) {
      const used = new Set(D.colNames);
      vars.forEach(v => { let nm = v.name, k = 2; while (used.has(nm)) nm = v.name + '_' + (k++); v.name = nm; used.add(nm); });
      S.vars.push(...vars);
    } else {
      S = emptyState(); S.vars = vars; S.title = pendingName || 'Données importées';
      S.graph.x = vars[0].name; S.graph.ys = vars.length > 1 ? [vars[1].name] : []; S.model.y = S.graph.ys[0] || '';
      $('calcText').value = '';
    }
    closeImport(); refreshAll(); switchTab('table');
    toast(append ? `${vars.length} colonne(s) ajoutée(s)` : `${pending.nrows} lignes importées`);
  }

  function bindImport() {
    $('btnOpen').onclick = () => $('fileInput').click();
    $('fileInput').onchange = e => { handleFile(e.target.files[0]); e.target.value = ''; };
    $('btnPaste').onclick = () => { pendingName = 'Données collées'; openImport(); };
    $('btnImportClose').onclick = closeImport;
    $('importModal').addEventListener('click', e => { if (e.target === $('importModal')) closeImport(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('importModal').hidden) closeImport(); });
    $('pasteArea').addEventListener('input', () => { pendingName = pendingName || 'Données collées'; parsePasted(); });
    $('selSep').onchange = parsePasted;
    $('selSheet').onchange = parseSheet;
    $('btnImportOk').onclick = () => applyImport(false);
    $('btnImportAdd').onclick = () => applyImport(true);
    let depth = 0;
    window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; $('dropOverlay').hidden = false; } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('dropOverlay').hidden = true; });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => { e.preventDefault(); depth = 0; $('dropOverlay').hidden = true; if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  }

  /* ---------- export ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const fileBase = () => (S.title || 'microlab').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

  function bindExport() {
    $('btnCsv').onclick = () => {
      const names = D.colNames;
      let s = names.map(n => unitOf(n) ? `${n} (${unitOf(n)})` : n).join(';') + '\n';
      for (let i = 0; i < D.n; i++) s += names.map(n => isFinite(D.cols[n][i]) ? String(+D.cols[n][i].toPrecision(10)).replace('.', ',') : '').join(';') + '\n';
      download(fileBase() + '.csv', '﻿' + s, 'text/csv;charset=utf-8');
      toast('Fichier CSV exporté (séparateur ; et virgule décimale)');
    };
    $('btnSave').onclick = () => { download(fileBase() + '.json', JSON.stringify(serialize(), null, 1), 'application/json'); toast('Projet enregistré : rouvrez-le avec « Ouvrir un fichier ».'); };
    $('btnNew').onclick = e => {
      const b = e.currentTarget;
      if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Nouveau'; b.classList.remove('danger'); S = emptyState(); $('calcText').value = ''; refreshAll(); switchTab('table'); toast('Nouveau tableau vide'); return; }
      b.dataset.armed = '1'; b.textContent = 'Effacer tout ?'; b.classList.add('danger');
      setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Nouveau'; b.classList.remove('danger'); } }, 3500);
    };
    $('selExample').onchange = e => {
      const id = e.target.value; if (!id) return; e.target.value = '';
      loadExample(id);
    };
  }

  function loadExample(id) {
    const ex = window.Examples[id]();
    S = fromExample(ex); $('calcText').value = S.calc;
    refreshAll();
    switchTab(ex.tab || 'model');
    if (S.model.preset) doFit(true);
    toast('Exemple chargé : ' + ex.title);
  }

  /* ---------- démarrage ---------- */
  function init() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    bindTable(); bindVars(); bindGraph(); bindModel(); bindStats(); bindImport(); bindExport();
    let saved = null;
    try { const t = localStorage.getItem(STORE) || localStorage.getItem('modelab.v1'); if (t) saved = JSON.parse(t); } catch (e) { /* rien */ }
    if (saved && saved.vars && saved.vars.length) {
      S = deserialize(saved); $('calcText').value = S.calc; refreshAll();
      if (S.model.expr && S.model.y) doFit(true);
    } else loadExample('rc');
    // suivre le thème clair / sombre
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const rerender = () => { renderGraphControls(); renderPlot(); if (!$('pane-stats').hidden) renderStats(); };
    mq.addEventListener && mq.addEventListener('change', rerender);
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
