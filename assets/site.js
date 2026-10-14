// MicroCosmos — menu mobile et simulateur de coïncidences
(function () {
  var b = document.querySelector(".burger"), n = document.querySelector(".nav");
  if (b && n) b.addEventListener("click", function () {
    var o = n.classList.toggle("ouvert");
    b.setAttribute("aria-expanded", o ? "true" : "false");
  });
})();

(function () {
  var cv = document.getElementById("simu-canvas");
  if (!cv) return;
  var ctx = cv.getContext("2d");
  var W = 960, H = 420;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);

  // géométrie de la vue en coupe (pixels) ; 140 px ≈ 3 cm
  var CX = 230, Y1 = 150, Y2 = 290, R = 26;
  var TOP = 30, BOT = H - 20;
  var BAND = 200; // demi-largeur de la zone visée par les muons

  // taux réels (par seconde de temps simulé)
  var R_BRUIT = 0.38;      // bruit de fond par tube (β, γ…)
  var R_VRAIES = 0.02;     // coïncidences vraies visées (≈ 1,2 par minute)

  function tireAngle() { // distribution ≈ cos²θ
    for (;;) {
      var th = (Math.random() * 2 - 1) * Math.PI * 0.42;
      if (Math.random() < Math.pow(Math.cos(th), 2)) return th;
    }
  }
  function distSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }
  function trajet() { // un muon : passe par un point de la bande à mi-hauteur
    var th = tireAngle(), xm = CX + (Math.random() * 2 - 1) * BAND, ym = (Y1 + Y2) / 2;
    var tn = Math.tan(th);
    var ax = xm - (ym - TOP) * tn, bx = xm + (BOT - ym) * tn;
    return { ax: ax, ay: TOP, bx: bx, by: BOT,
      t1: distSeg(CX, Y1, ax, TOP, bx, BOT) < R, t2: distSeg(CX, Y2, ax, TOP, bx, BOT) < R };
  }
  // calibrage : fraction de muons qui traversent les deux tubes
  var f = 0; for (var i = 0; i < 40000; i++) { var m = trajet(); if (m.t1 && m.t2) f++; }
  var R_MUONS = R_VRAIES / Math.max(f / 40000, 1e-4);

  var el = function (id) { return document.getElementById(id); };
  var vitesse = 10, fenetre = 0.001, enPause = false;
  var t = 0, tranche = 0, drap = [0, 0], idDrap = [null, null];
  var N1, N2, N12, Nvraies, Nfort, traces, impulsions, eclairs;
  function raz() {
    t = 0; tranche = 0; drap = [0, 0]; idDrap = [null, null];
    N1 = N2 = N12 = Nvraies = Nfort = 0; traces = []; impulsions = []; eclairs = [];
    affiche();
  }
  var nextId = 1;
  function impulsion(k, id, ts) {
    if (k === 0) N1++; else N2++;
    drap[k] = 1; idDrap[k] = id;
    impulsions.push({ k: k, t: ts, c: 0 });
    eclairs.push({ k: k, age: 0 });
  }
  function finTranche(ts) {
    if (drap[0] && drap[1]) {
      N12++;
      var vraie = idDrap[0] !== null && idDrap[0] === idDrap[1] && idDrap[0] > 0;
      if (vraie) Nvraies++; else Nfort++;
      for (var j = impulsions.length - 1; j >= 0 && j > impulsions.length - 8; j--) {
        if (ts - impulsions[j].t <= fenetre * 1.01) impulsions[j].c = vraie ? 1 : 2;
      }
    }
    drap = [0, 0]; idDrap = [null, null];
  }
  function avance(dt) {
    var fin = t + dt;
    // événements tirés selon des lois de Poisson
    var evts = [];
    var nb = poisson(R_BRUIT * dt); for (var i = 0; i < nb; i++) evts.push({ t: t + Math.random() * dt, type: "b", k: 0 });
    nb = poisson(R_BRUIT * dt); for (i = 0; i < nb; i++) evts.push({ t: t + Math.random() * dt, type: "b", k: 1 });
    nb = poisson(R_MUONS * dt); for (i = 0; i < nb; i++) evts.push({ t: t + Math.random() * dt, type: "m" });
    evts.sort(function (a, b) { return a.t - b.t; });
    for (i = 0; i < evts.length; i++) {
      var e = evts[i];
      while ((tranche + 1) * fenetre <= e.t) { finTranche((tranche + 1) * fenetre); tranche++; }
      if (e.type === "b") {
        impulsion(e.k, -nextId++, e.t);
        var cote = Math.random() < .5 ? -1 : 1, yy = e.k ? Y2 : Y1;
        traces.push({ type: "b", ax: CX + cote * (150 + Math.random() * 80), ay: yy + (Math.random() * 2 - 1) * 70 + (e.k ? 40 : -10), bx: CX + cote * (R - 4), by: yy + (Math.random() * 2 - 1) * 10, age: 0 });
      } else {
        var m = trajet(), id = nextId++;
        if (m.t1) impulsion(0, id, e.t);
        if (m.t2) impulsion(1, id, e.t);
        m.type = "m"; m.age = 0; m.both = m.t1 && m.t2;
        if (m.t1 || m.t2 || Math.random() < .25) traces.push(m);
      }
    }
    while ((tranche + 1) * fenetre <= fin) { finTranche((tranche + 1) * fenetre); tranche++; }
    t = fin;
  }
  function poisson(l) { var L = Math.exp(-l), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }

  function fmt(x) { return x.toLocaleString("fr-FR"); }
  function affiche() {
    el("simu-n1").textContent = fmt(N1); el("simu-n2").textContent = fmt(N2);
    el("simu-n12").textContent = fmt(N12);
    el("simu-detail").textContent = Nvraies + " vraies · " + Nfort + " fortuites";
    var s = Math.floor(t), mn = Math.floor(s / 60);
    el("simu-t").textContent = mn + " min " + String(s % 60).padStart(2, "0") + " s";
    var r1 = t > 0 ? N1 / t : 0, r2 = t > 0 ? N2 / t : 0;
    el("simu-attendu").textContent = t > 5 ? (r1 * r2 * fenetre * 3600).toLocaleString("fr-FR", { maximumFractionDigits: fenetre < 0.01 ? 2 : 0 }) + " fortuites / h attendues (R₁ × R₂ × fenêtre)" : "";
  }

  function dessine() {
    ctx.clearRect(0, 0, W, H);
    // panneau gauche : coupe
    ctx.fillStyle = "#0b1029"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(139,92,246,.10)"; ctx.fillRect(0, 0, 470, 26);
    ctx.fillStyle = "#aeb5dd"; ctx.font = "600 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("haute atmosphère ↓ muons", CX, 17);
    traces.forEach(function (tr) {
      var a = Math.max(0, 1 - tr.age / 1.1);
      if (tr.type === "m") {
        ctx.strokeStyle = tr.both ? "rgba(52,211,153," + a + ")" : "rgba(248,113,113," + a * .9 + ")";
        ctx.lineWidth = 2.4; ctx.setLineDash(tr.both ? [] : [7, 5]);
      } else { ctx.strokeStyle = "rgba(251,191,36," + a + ")"; ctx.lineWidth = 2; ctx.setLineDash([2, 5]); }
      ctx.beginPath(); ctx.moveTo(tr.ax, tr.ay); ctx.lineTo(tr.bx, tr.by); ctx.stroke();
    });
    ctx.setLineDash([]);
    [Y1, Y2].forEach(function (y, k) {
      var glow = 0; eclairs.forEach(function (e) { if (e.k === k) glow = Math.max(glow, 1 - e.age / .35); });
      if (glow > 0) { ctx.fillStyle = "rgba(167,139,250," + glow * .55 + ")"; ctx.beginPath(); ctx.arc(CX, y, R + 14 * glow, 0, 7); ctx.fill(); }
      var g = ctx.createLinearGradient(0, y - R, 0, y + R);
      g.addColorStop(0, "#eef2f8"); g.addColorStop(.5, "#97a3b8"); g.addColorStop(1, "#6f7a8d");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, y, R, 0, 7); ctx.fill();
      ctx.strokeStyle = "#cfd6e6"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#1d2236"; ctx.fillRect(CX - 120, y + R + 8, 240, 7);
      ctx.fillStyle = "#fff"; ctx.font = "800 13px Inter, system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("tube " + (k + 1), CX + 136, y + 5);
    });
    // panneau droit : chronogramme défilant
    var X0 = 500, X1 = W - 20, span = 6; // secondes affichées
    ctx.fillStyle = "#121a3d"; ctx.fillRect(X0 - 10, 40, X1 - X0 + 20, 300);
    ctx.fillStyle = "#aeb5dd"; ctx.font = "600 12px Inter, system-ui, sans-serif"; ctx.textAlign = "left";
    ctx.fillText("impulsions des 6 dernières secondes (temps du détecteur)", X0, 32);
    var lanes = [110, 200];
    ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1;
    for (var s = 0; s <= span; s++) { var gx = X1 - s / span * (X1 - X0); ctx.beginPath(); ctx.moveTo(gx, 48); ctx.lineTo(gx, 332); ctx.stroke(); }
    lanes.forEach(function (ly, k) {
      ctx.strokeStyle = k ? "#fb923c" : "#60a5fa"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X0, ly); ctx.lineTo(X1, ly); ctx.stroke();
      ctx.fillStyle = k ? "#fb923c" : "#60a5fa"; ctx.font = "800 12px Inter, system-ui, sans-serif";
      ctx.fillText("tube " + (k + 1), X0, ly - 30);
    });
    impulsions = impulsions.filter(function (p) { return t - p.t < span + .5; });
    impulsions.forEach(function (p) {
      var x = X1 - (t - p.t) / span * (X1 - X0); if (x < X0) return;
      var ly = lanes[p.k];
      ctx.strokeStyle = p.c === 1 ? "#34d399" : p.c === 2 ? "#fbbf24" : (p.k ? "#fb923c" : "#60a5fa");
      ctx.lineWidth = p.c ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x, ly + 34); ctx.stroke();
      if (p.c && p.k === 1) {
        ctx.fillStyle = p.c === 1 ? "rgba(52,211,153,.18)" : "rgba(251,191,36,.18)";
        ctx.fillRect(x - 6, lanes[0] - 6, 12, lanes[1] - lanes[0] + 46);
        ctx.fillStyle = p.c === 1 ? "#34d399" : "#fbbf24"; ctx.font = "800 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(p.c === 1 ? "N12+1" : "fortuite", x, 280);
        ctx.textAlign = "left";
      }
    });
    ctx.fillStyle = "#7d86b8"; ctx.font = "500 11px Inter, system-ui, sans-serif"; ctx.textAlign = "right";
    ctx.fillText("maintenant", X1, 326); ctx.textAlign = "left"; ctx.fillText("− 6 s", X0, 326);
    ctx.fillStyle = "#aeb5dd"; ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.fillText("fenêtre de coïncidence : " + (fenetre < 1 ? (fenetre * 1000) + " ms" : fenetre + " s"), X0, 368);
    ctx.fillText("temps de mesure simulé : " + el("simu-t").textContent, X0, 390);
  }

  var last = null;
  function boucle(ts) {
    if (last === null) last = ts;
    var dtr = Math.min((ts - last) / 1000, .1); last = ts;
    if (!enPause) {
      avance(dtr * vitesse);
      traces.forEach(function (x) { x.age += dtr; }); traces = traces.filter(function (x) { return x.age < 1.1; });
      eclairs.forEach(function (x) { x.age += dtr; }); eclairs = eclairs.filter(function (x) { return x.age < .35; });
      affiche();
    }
    dessine();
    requestAnimationFrame(boucle);
  }
  el("simu-pause").addEventListener("click", function () { enPause = !enPause; this.textContent = enPause ? "▶ Reprendre" : "❚❚ Pause"; });
  el("simu-raz").addEventListener("click", raz);
  el("simu-vitesse").addEventListener("input", function () { vitesse = +this.value; el("simu-vitesse-v").textContent = "× " + vitesse; });
  el("simu-fenetre").addEventListener("change", function () { fenetre = +this.value; raz(); });
  raz();
  // ne pas animer hors écran
  if ("IntersectionObserver" in window) {
    var auto = false;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting && !enPause) { enPause = true; auto = true; }
        else if (e.isIntersecting && auto) { enPause = false; auto = false; last = null; }
      });
    }).observe(cv);
  }
  requestAnimationFrame(boucle);
})();
