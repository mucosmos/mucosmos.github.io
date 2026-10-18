/*
 * Microcosmos — version web (Web Serial)
 * Détecteur Microcosmos et programmes Arduino : Cédric Vanden Driessche ;
 * interface Python-web puis web — conception et direction du projet : Cédric Vanden Driessche (2026),
 * professeur de physique-chimie au lycée Charles de Gaulle à Caen (cedric.vanden-driessche@ac-normandie.fr) ;
 * développement du code : Claude (Anthropic), sous sa direction.
 * Copyright (C) 2026 Cédric Vanden Driessche — logiciel libre, GNU GPL v3 ou ultérieure.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Moteur : lecture de l'Arduino (Web Serial ou simulation), études « rayons cosmiques »,
 * « radioactivité » (séries de 10 s) et « demi-vie » (décroissance longue, ajustement), fichiers.
 *
 * Programmes Arduino reconnus :
 *  - DetectionCosmiques3_0 : chaque seconde « D;seconde;GM1;GM2;coincidences » (sert à tout) ;
 *  - MicroCosmosRadioactivite : toutes les 10 s « nombre impulsion : N  duree experience : T s ».
 */
"use strict";

const FENETRE_S = 10;                 // durée d'une mesure de radioactivité
const MAX_MESURES = 1000;
const PROG_SECONDES = "DetectionCosmiques3_0";
const PROG_RADIO = "MicroCosmosRadioactivite";
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
              "septembre", "octobre", "novembre", "décembre"];

class Erreur extends Error {}

// ------------------------------------------------------------------ outils
const fr = (x, d = 2) => x.toFixed(d).replace(".", ",");
const deux = n => String(n).padStart(2, "0");
const heureTexte = d => `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`;
const horodatage = d => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}_${deux(d.getHours())}h${deux(d.getMinutes())}m${deux(d.getSeconds())}`;
const enteteDate = d => [`Date du: ${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`,
                         `Heure:${deux(d.getHours())}:${deux(d.getMinutes())}`];

function analyserLigne(ligne) {
  if (ligne.startsWith("D;")) {
    const m = ligne.trim().split(";");
    if (m.length === 5 && m.slice(1).every(x => /^\d+$/.test(x))) return ["seconde", m.slice(1).map(Number)];
    return null;
  }
  const r = /nombre impulsion\s*:\s*(\d+)/i.exec(ligne);       // pas « nombre impulsion 1 : » (version 2.0)
  return r ? ["fenetre", Number(r[1])] : null;
}
const ancienProgramme = l => l.includes("nombre de coincidences") || l.includes("nombre impulsion 1") || l.includes("but exp");

function poisson(lam) {
  if (lam <= 0) return 0;
  if (lam > 30) { // approximation gaussienne
    let u = 0, v = 0; while (u === 0) u = Math.random(); v = Math.random();
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
  }
  const L = Math.exp(-lam); let k = 0, p = 1;
  for (;;) { p *= Math.random(); if (p <= L) return k; k++; }
}

// ------------------------------------------------------------- simulation
/* Faux Arduino : mêmes lignes que DetectionCosmiques3_0.
 * Chaque tube voit le rayonnement ambiant (≈ 25 coups/min) ; les muons qui traversent les deux tubes
 * donnent ≈ 1,5 coïncidence/min. Une « source radon » peut être posée sur un tube : filtre d'aspirateur
 * après 40 min de collecte (filiation plomb 214 → bismuth 214, modèle de Bateman). */
class ArduinoSimule {
  constructor(acceleration, recevoir) {
    this.k = acceleration; this.recevoir = recevoir; this.s = 0; this.source = null;
    this.minuterie = null;
  }
  demarrer() {
    setTimeout(() => this.recevoir("# MICROCOSMOS 3.0 (simulation) - D;seconde;impulsions GM1;impulsions GM2;coincidences"), 300 / this.k);
    this.minuterie = setInterval(() => this.seconde(), 1000 / this.k);
  }
  arreter() { clearInterval(this.minuterie); }
  poserFiltreRadon(tube) { this.source = { tube, t0: this.s }; }
  retirerSource() { this.source = null; }
  tauxSource(t) {                       // impulsions/s dues au filtre, t en s après la pose
    const lP = Math.LN2 / (26.8 * 60), lB = Math.LN2 / (19.9 * 60);
    const P0 = 0.65 / lP, B0 = 0.68 / lB;   // activités relatives à la fin de l'aspiration
    const P = P0 * Math.exp(-lP * t);
    const B = B0 * Math.exp(-lB * t) + P0 * lP / (lB - lP) * (Math.exp(-lP * t) - Math.exp(-lB * t));
    return 24 * (0.5 * lP * P + lB * B) / (0.5 * 0.65 + 0.68);
  }
  seconde() {
    this.s += 1;
    let n1 = poisson(0.40), n2 = poisson(0.40), n12 = 0;
    for (let i = poisson(0.025); i > 0; i--) {
      const v1 = Math.random() < 0.95, v2 = Math.random() < 0.95;
      n1 += v1; n2 += v2; n12 += (v1 && v2);
    }
    if (n1 && n2 && Math.random() < n1 * n2 * 0.001) n12 += 1;
    if (this.source) {
      const n = poisson(this.tauxSource(this.s - this.source.t0));
      if (this.source.tube === 1) n1 += n; else n2 += n;
    }
    this.recevoir(`D;${this.s};${n1};${n2};${n12}`);
  }
}

// ---------------------------------------------------------- liaison série
class LiaisonSerie {
  constructor(port, recevoir, perdue) { this.port = port; this.recevoir = recevoir; this.perdue = perdue; }
  async ouvrir() {
    await this.port.open({ baudRate: 9600 });
    const dec = new TextDecoderStream();
    this.tuyau = this.port.readable.pipeTo(dec.writable).catch(() => {});
    this.lecteur = dec.readable.getReader();
    this.boucle();
  }
  async boucle() {
    let tampon = "";
    try {
      for (;;) {
        const { value, done } = await this.lecteur.read();
        if (done) break;
        tampon += value;
        let i;
        while ((i = tampon.indexOf("\n")) >= 0) {
          const l = tampon.slice(0, i).trim(); tampon = tampon.slice(i + 1);
          if (l) this.recevoir(l);
        }
        if (tampon.length > 4096) tampon = "";
      }
    } catch (e) { if (!this.fermeture) this.perdue(e); }
  }
  async fermer() {
    this.fermeture = true;
    try { await this.lecteur.cancel(); } catch (e) {}
    try { await this.tuyau; } catch (e) {}
    try { await this.port.close(); } catch (e) {}
  }
}

// ----------------------------------------------------- ajustement demi-vie
/* N(t) = A·Δ·exp(−λt) + F·Δ (A et F en impulsions/s, Δ durée de la classe). Pour λ fixé, A et F
 * s'obtiennent par moindres carrés pondérés ; λ par section dorée ; incertitude par Δχ² = 1. */
function ajusterDecroissance(classes, fond) {
  const t = classes.map(c => c.t), d = classes.map(c => c.d), n = classes.map(c => c.n);
  let poids = n.map(x => 1 / Math.max(x, 1));
  const resoudre = lam => {
    const f = t.map((ti, i) => d[i] * Math.exp(-lam * ti));
    let A, F;
    if (fond !== null) {
      let sff = 0, sfr = 0;
      f.forEach((fi, i) => { sff += poids[i] * fi * fi; sfr += poids[i] * fi * (n[i] - fond * d[i]); });
      A = sfr / sff; F = fond;
    } else {
      let sff = 0, sgg = 0, sfg = 0, sfn = 0, sgn = 0;
      f.forEach((fi, i) => { const w = poids[i], g = d[i];
        sff += w * fi * fi; sgg += w * g * g; sfg += w * fi * g; sfn += w * fi * n[i]; sgn += w * g * n[i]; });
      const det = sff * sgg - sfg * sfg;
      if (Math.abs(det) < 1e-12 * sff * sgg) return { chi2: Infinity, A: 0, F: 0 };
      A = (sfn * sgg - sgn * sfg) / det; F = (sff * sgn - sfg * sfn) / det;
    }
    let chi2 = 0;
    t.forEach((ti, i) => { const m = A * d[i] * Math.exp(-lam * ti) + F * d[i]; chi2 += poids[i] * (n[i] - m) ** 2; });
    return { chi2, A, F };
  };
  const duree = t[t.length - 1] - t[0] + d[d.length - 1];
  const lams = [];
  for (let k = 0; k < 120; k++) { const l = Math.LN2 / (duree * 30) * 1.15 ** k; if (Math.LN2 / l > 5) lams.push(l); }
  const vals = lams.map(l => resoudre(l).chi2);
  let k = 0; vals.forEach((v, i) => { if (v < vals[k]) k = i; });
  let a = lams[Math.max(k - 1, 0)], b = lams[Math.min(k + 1, lams.length - 1)], lam = lams[k];
  for (let passe = 0; passe < 2; passe++) {
    const g = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 80; i++) {
      const c1 = b - g * (b - a), c2 = a + g * (b - a);
      if (resoudre(c1).chi2 < resoudre(c2).chi2) b = c2; else a = c1;
    }
    lam = (a + b) / 2;
    const r = resoudre(lam);
    poids = t.map((ti, i) => 1 / Math.max(r.A * d[i] * Math.exp(-lam * ti) + r.F * d[i], 1));   // poids de Poisson
    a = lam / 3; b = lam * 3;
  }
  const best = resoudre(lam);
  const ndf = n.length - (fond !== null ? 2 : 3);
  const res = { lambda: lam, T: Math.LN2 / lam, errT: null, A: best.A, F: best.F, chi2: best.chi2, ndf, fondImpose: fond !== null };
  if (best.A <= 0) return res;
  const borne = sens => {
    let pas = lam * 0.01, l = lam;
    for (let i = 0; i < 4000; i++) {
      const l2 = l + sens * pas; if (l2 <= 0) return null;
      if (resoudre(l2).chi2 > best.chi2 + 1) return l2;
      l = l2; pas *= 1.05;
    }
    return null;
  };
  const bas = borne(-1), haut = borne(+1);
  if (bas && haut) {
    res.errT = (Math.LN2 / bas - Math.LN2 / haut) / 2;
    if (ndf > 0 && best.chi2 / ndf > 1) res.errT *= Math.sqrt(best.chi2 / ndf);
  }
  return res;
}

/* Demi-vies apparentes par tranches : régression de ln(N − F) sur chaque tranche. */
function tranchesApparentes(classes, F, largeur) {
  const res = [];
  if (!classes.length) return res;
  const fin = classes[classes.length - 1].t;
  for (let t0 = 0; t0 < fin; t0 += largeur) {
    const pts = classes.filter(c => c.t >= t0 && c.t < t0 + largeur && c.n - F * c.d > 0)
                       .map(c => [c.t, Math.log(c.n - F * c.d)]);
    if (pts.length < 3) continue;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    const pente = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx;
    res.push({ debut: t0, fin: Math.min(t0 + largeur, fin), pente, T: pente < 0 ? -Math.LN2 / pente : null });
  }
  return res;
}

// ------------------------------------------------------------- fichiers
const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
                 "–": 0x96, "—": 0x97, "œ": 0x9C, "Œ": 0x8C, "τ": null, "≈": null };
function versCp1252(texte) {                     // même encodage que les logiciels Python (tableurs Windows)
  const octets = [];
  for (const c of texte.replace(/τ/g, "tau").replace(/≈/g, "~").replace(/→/g, "->")) {
    const code = c.codePointAt(0);
    if (code < 256) octets.push(code);
    else if (CP1252[c]) octets.push(CP1252[c]);
    else octets.push(63);
  }
  return new Uint8Array(octets);
}

class Fichiers {
  constructor() {
    this.liste = [];
    try { this.liste = JSON.parse(localStorage.getItem("microcosmos-fichiers") || "[]"); } catch (e) { this.liste = []; }
  }
  sauver() { try { localStorage.setItem("microcosmos-fichiers", JSON.stringify(this.liste.slice(0, 60))); } catch (e) {} }
  creer(nom, lignes) { const f = { nom, date: Date.now(), texte: lignes.join("\r\n") + "\r\n" }; this.liste.unshift(f); this.sauver(); return f; }
  ajouter(f, ligne) { if (!f) return; f.texte += ligne + "\r\n"; f.date = Date.now(); this.sauver(); }
  supprimer(nom) { this.liste = this.liste.filter(f => f.nom !== nom); this.sauver(); }
  octets(nom) { const f = this.liste.find(x => x.nom === nom); return f ? versCp1252(f.texte) : null; }
}

// --------------------------------------------------------------- station
class Station {
  constructor() {
    this.fichiers = new Fichiers();
    this.journalLignes = [];
    this.journalBrut = false;
    this.serie = null;
    this.decroissance = null;
    this.fond = null;               // mesure du bruit de fond en cours
    this.raz0();
  }
  raz0() {
    this.connecte = false; this.simulation = false; this.k = 1; this.port = null; this.message = "";
    this.version = null; this.programme = null; this.derniereDonnee = null; this.ouverture = 0;
    this.derniere = [0, 0, 0]; this.totaux = [0, 0, 0]; this.secondes = 0;
    this.manip = null; this.historique = [];
    this.fenetreN = null; this.fenetreInstant = null; this.radioCumul = [0, 0]; this.radioSecondes = 0;
    this.horlogeArduino = 0;        // secondes comptées par l'Arduino depuis la connexion
    this.liaison = null; this.sim = null;
  }
  journal(texte, brut = false) {
    if (brut && !this.journalBrut) return;
    this.journalLignes.push(`${heureTexte(new Date())}  ${texte}`);
    if (this.journalLignes.length > 500) this.journalLignes.shift();
  }
  maintenant() { return this.ouvertureDate ? new Date(this.ouvertureDate + this.horlogeArduino * 1000) : new Date(); }

  // ------------------------------------------------------------ connexion
  async connecter(simulation, accelere) {
    await this.deconnecter();
    this.raz0();
    const recevoir = l => this.ligne(l);
    if (simulation) {
      this.k = accelere ? 60 : 1;
      this.sim = new ArduinoSimule(this.k, recevoir);
      this.simulation = true; this.port = "simulation";
      this.sim.demarrer();
    } else {
      if (!("serial" in navigator)) throw new Erreur("Ce navigateur ne permet pas d'accéder au port USB. Utilisez Chrome, Edge ou Firefox (version 151 ou plus récente).");
      let port;
      try { port = await navigator.serial.requestPort(); }
      catch (e) { throw new Erreur("Aucun port choisi."); }
      const liaison = new LiaisonSerie(port, recevoir, e => this.perte(e));
      try { await liaison.ouvrir(); }
      catch (e) {
        throw new Erreur(/access|denied|permission|NetworkError/i.test(String(e))
          ? "Accès refusé au port. Fermez l'IDE Arduino ou l'autre logiciel Microcosmos s'il est ouvert. Sous Linux : sudo usermod -aG dialout $USER, puis fermez la session."
          : `Impossible d'ouvrir le port : ${e.message || e}`);
      }
      this.liaison = liaison;
      const info = port.getInfo ? port.getInfo() : {};
      this.port = info.usbVendorId ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId || 0).toString(16).padStart(4, "0")}` : "port série";
    }
    this.connecte = true; this.ouverture = Date.now(); this.ouvertureDate = Date.now();
    this.journal(`Connexion (${this.port}) : l'Arduino redémarre, premières données dans 2 à 3 s` + (this.k > 1 ? " — simulation accélérée × 60" : ""));
  }
  async deconnecter() {
    if (!this.connecte) return;
    this.terminerManip("déconnexion"); this.terminerSerie("déconnexion"); this.terminerDecroissance("déconnexion");
    if (this.sim) this.sim.arreter();
    if (this.liaison) await this.liaison.fermer();
    this.connecte = false; this.liaison = null; this.sim = null;
    this.journal("Déconnecté");
  }
  perte(e) {
    this.journal(`Erreur de lecture : ${e && e.message ? e.message : e}`);
    this.message = "Liaison avec l'Arduino perdue (câble débranché ?). Reconnectez-vous.";
    this.terminerManip("liaison perdue"); this.terminerSerie("liaison perdue"); this.terminerDecroissance("liaison perdue");
    this.connecte = false;
  }
  occupe() { return !!(this.manip || (this.serie && this.serie.enCours) || (this.decroissance && this.decroissance.enCours) || this.fond); }
  verifierLibre() {
    if (!this.connecte) throw new Erreur("Le détecteur n'est pas connecté.");
    if (this.occupe()) throw new Erreur("Une mesure est déjà en cours : arrêtez-la d'abord.");
  }

  // ---------------------------------------------------------- réception
  ligne(l) {
    const d = analyserLigne(l);
    if (d && d[0] === "seconde") { this.journal(l, true); this.seconde(...d[1]); return; }
    if (d) {
      this.journal(l);
      this.programme = PROG_RADIO; this.version = PROG_RADIO; this.derniereDonnee = Date.now();
      this.horlogeArduino += FENETRE_S;
      this.fenetre([d[1], d[1]]);
      return;
    }
    if (l.startsWith("#")) { this.journal(l); this.version = l.replace(/^#\s*/, "").split(" - ")[0]; return; }
    this.journal(`ligne non reconnue : ${l}`);
    if (ancienProgramme(l) && !this.avertiAncien) {
      this.avertiAncien = true;
      this.message = "L'Arduino utilise l'ancien programme (DetectionCosmiques 2.0). Téléversez DetectionCosmiques3_0.ino (onglet Fichiers) puis reconnectez-vous.";
    }
  }
  seconde(s, n1, n2, n12) {
    const v = [n1, n2, n12];
    this.programme = PROG_SECONDES; if (!this.version) this.version = "MICROCOSMOS 3.0";
    this.derniereDonnee = Date.now(); this.horlogeArduino += 1;
    this.derniere = v; this.totaux = this.totaux.map((a, i) => a + v[i]); this.secondes += 1;
    // bruit de fond en cours de mesure
    if (this.fond) { this.fond.n += this.fond.tube === 1 ? n1 : n2; this.fond.s += 1; if (this.fond.s >= this.fond.duree) this.finFond(); }
    // radioactivité et demi-vie : regroupement par 10 s
    const s0 = this.serie, d0 = this.decroissance;
    if ((s0 && s0.enCours && s0.attente) || (d0 && d0.enCours && d0.attente)) {
      if (s0 && s0.attente) s0.attente = false; if (d0 && d0.attente) d0.attente = false;
      this.radioCumul = [0, 0]; this.radioSecondes = 0;
    }
    this.radioCumul = [this.radioCumul[0] + n1, this.radioCumul[1] + n2]; this.radioSecondes += 1;
    let fen = null;
    if (this.radioSecondes >= FENETRE_S) { fen = this.radioCumul; this.radioCumul = [0, 0]; this.radioSecondes = 0; }
    // rayons cosmiques
    const m = this.manip;
    if (m) {
      m.cumul = m.cumul.map((a, i) => a + v[i]); m.totaux = m.totaux.map((a, i) => a + v[i]);
      m.n += 1; m.ecoulees += 1;
      if (m.n >= m.intervalle) {
        const h = heureTexte(this.maintenant());
        this.historique.push({ t: m.ecoulees, heure: h, valeurs: m.cumul });
        this.fichiers.ajouter(m.fichier, h + "\t" + m.cumul.join("\t"));
        m.cumul = [0, 0, 0]; m.n = 0; m.lignes += 1;
      }
      if (m.duree && m.ecoulees >= m.duree) this.terminerManip("durée atteinte");
    }
    if (fen) this.fenetre(fen);
  }
  fenetre(v) {
    const s = this.serie, d = this.decroissance;
    const tube = (s && s.enCours) ? s.tube : (d && d.enCours) ? d.tube : 1;
    const n = v[tube - 1];
    this.fenetreN = n; this.fenetreInstant = Date.now();
    if (s && s.enCours) {
      if (s.attente) { s.attente = false; }
      else {
        const h = heureTexte(this.maintenant());
        s.mesures.push({ num: s.mesures.length + 1, heure: h, n });
        this.fichiers.ajouter(s.fichier, `${s.mesures.length}\t${h}\t${n}`);
        if (s.mesures.length >= s.voulu) this.terminerSerie("série terminée");
      }
    }
    if (d && d.enCours) {
      if (d.attente) { d.attente = false; }
      else {
        const h = heureTexte(this.maintenant());
        d.mesures.push(n);
        this.fichiers.ajouter(d.fichier, `${d.mesures.length}\t${h}\t${n}`);
        if (d.duree && d.mesures.length * FENETRE_S >= d.duree) this.terminerDecroissance("durée atteinte");
      }
    }
  }

  // ------------------------------------------------------ rayons cosmiques
  raz() { if (this.manip) throw new Erreur("Une expérience est en cours : arrêtez-la avant de remettre à zéro."); this.totaux = [0, 0, 0]; this.secondes = 0; }
  lancerManip(duree, intervalle, fichier, commentaire) {
    this.verifierLibre();
    if (this.programme === PROG_RADIO) throw new Erreur("L'Arduino contient le programme MicroCosmosRadioactivite (un seul tube) : téléversez DetectionCosmiques3_0 pour les rayons cosmiques.");
    duree = Math.round(duree); intervalle = Math.round(intervalle);
    if (intervalle < 1) throw new Erreur("L'intervalle doit être d'au moins 1 seconde.");
    if (duree && duree < intervalle) throw new Erreur("La durée de l'expérience doit être plus longue que l'intervalle.");
    let f = null;
    if (fichier) {
      const t = new Date();
      f = this.fichiers.creer(`microcosmos_${horodatage(t)}.txt`, ["Microcosmos - comptage Geiger", ...enteteDate(t),
        ...(commentaire || "").split("\n"), "", `Intervalle de comptage : ${intervalle} s\tDurée prévue : ` + (duree ? `${duree} s` : "sans limite"),
        "", "HEURE\tGM1\tGM2\tCOINCIDENCES"]);
    }
    this.historique = []; this.totaux = [0, 0, 0]; this.secondes = 0;
    this.manip = { debut: Date.now(), duree, intervalle, ecoulees: 0, n: 0, cumul: [0, 0, 0], totaux: [0, 0, 0], lignes: 0, fichier: f };
    this.journal("Expérience lancée" + (f ? ` (fichier ${f.nom})` : ""));
  }
  arreterManip() { this.terminerManip("arrêt demandé"); }
  terminerManip(raison) {
    const m = this.manip; if (!m) return;
    this.journal(`Fin de l'expérience (${raison}) : ${m.ecoulees} s, GM1 ${m.totaux[0]}, GM2 ${m.totaux[1]}, coïncidences ${m.totaux[2]}`);
    if (m.fichier) {
      if (m.n) this.fichiers.ajouter(m.fichier, `(dernier intervalle incomplet non enregistré : ${m.n} s)`);
      this.fichiers.ajouter(m.fichier, ""); this.fichiers.ajouter(m.fichier, `TOTAL (${m.ecoulees} s)\t${m.totaux.join("\t")}`);
    }
    this.manip = null;
  }

  // -------------------------------------------------------- radioactivité
  lancerSerie(nombre, fichier, commentaire, tube) {
    this.verifierLibre();
    nombre = Math.round(nombre);
    if (!(nombre >= 1 && nombre <= MAX_MESURES)) throw new Erreur(`Le nombre de mesures doit être compris entre 1 et ${MAX_MESURES}.`);
    if (this.programme === PROG_RADIO) tube = 1;
    let f = null;
    if (fichier) {
      const t = new Date();
      f = this.fichiers.creer(`radioactivite_${horodatage(t)}.txt`, ["Microcosmos - comptage de la radioactivite", ...enteteDate(t),
        ...(commentaire || "").split("\n"), "", `Série de ${nombre} mesures de ${FENETRE_S} s - tube Geiger ${tube}`, "",
        `MESURE\tHEURE\tIMPULSIONS EN ${FENETRE_S} s`]);
    }
    this.serie = { voulu: nombre, enCours: true, attente: this.programme !== PROG_SECONDES, debut: Date.now(), tube, mesures: [], fichier: f };
    if (this.programme === PROG_SECONDES) { this.radioCumul = [0, 0]; this.radioSecondes = 0; }
    this.journal(`Série de ${nombre} mesures lancée (tube ${tube})`);
  }
  arreterSerie() { this.terminerSerie("arrêt demandé"); }
  effacerSerie() { if (this.serie && this.serie.enCours) throw new Erreur("Arrêtez d'abord la série en cours."); this.serie = null; }
  terminerSerie(raison) {
    const s = this.serie; if (!s || !s.enCours) return;
    s.enCours = false; s.attente = false;
    const v = s.mesures.map(m => m.n);
    this.journal(`Fin de la série (${raison}) : ${v.length} mesure(s)`);
    if (s.fichier) {
      this.fichiers.ajouter(s.fichier, "");
      if (raison !== "série terminée") this.fichiers.ajouter(s.fichier, `Série interrompue (${raison}) après ${v.length} mesure(s) sur ${s.voulu}`);
      if (v.length) {
        const n = v.length, moy = v.reduce((a, b) => a + b, 0) / n;
        const et = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - moy) ** 2, 0) / (n - 1)) : 0;
        [`Nombre de mesures\t${n}`, `Moyenne\t${fr(moy)}`, `Ecart-type\t${fr(et)}`, `Racine de la moyenne\t${fr(Math.sqrt(moy))}`,
         `Minimum\t${Math.min(...v)}`, `Maximum\t${Math.max(...v)}`].forEach(x => this.fichiers.ajouter(s.fichier, x));
      }
    }
  }

  // ------------------------------------------------- demi-vie (décroissance)
  mesurerFond(duree, tube) {
    this.verifierLibre();
    if (this.programme === PROG_RADIO) throw new Erreur("Avec le programme MicroCosmosRadioactivite, mesurez le fond avec une série de l'onglet Radioactivité.");
    if (this.sim) this.sim.retirerSource();
    this.fond = { duree: Math.round(duree), tube, n: 0, s: 0 };
    this.journal(`Mesure du bruit de fond : ${this.fond.duree} s, tube ${tube}`);
  }
  finFond() {
    const f = this.fond; this.fond = null;
    this.fondMesure = { valeur: f.n / f.s * FENETRE_S, err: Math.sqrt(Math.max(f.n, 1)) / f.s * FENETRE_S, duree: f.s, n: f.n };
    this.journal(`Bruit de fond : ${fr(this.fondMesure.valeur)} ± ${fr(this.fondMesure.err)} impulsions en 10 s (${f.n} en ${f.s} s)`);
  }
  arreterFond() { if (this.fond && this.fond.s > 0) this.finFond(); else this.fond = null; }
  lancerDecroissance({ tube, duree, fond, commentaire, fichier }) {
    this.verifierLibre();
    if (this.programme === PROG_RADIO) tube = 1;
    let f = null;
    const t = new Date();
    if (fichier) {
      f = this.fichiers.creer(`decroissance_${horodatage(t)}.txt`, ["Microcosmos - decroissance radioactive (demi-vie)", ...enteteDate(t),
        ...(commentaire || "").split("\n"), "",
        `Mesures de ${FENETRE_S} s - tube Geiger ${tube} - durée prévue : ` + (duree ? `${Math.round(duree / 60)} min` : "sans limite")
          + (fond !== null ? ` - bruit de fond : ${fr(fond)} impulsions en 10 s` : ""), "",
        `MESURE\tHEURE\tIMPULSIONS EN ${FENETRE_S} s`]);
    }
    this.decroissance = { enCours: true, attente: this.programme !== PROG_SECONDES, debut: Date.now(), tube, duree: Math.round(duree || 0),
                          fond, mesures: [], fichier: f };
    if (this.programme === PROG_SECONDES) { this.radioCumul = [0, 0]; this.radioSecondes = 0; }
    if (this.sim) { this.sim.poserFiltreRadon(tube); this.journal("Simulation : un filtre d'aspirateur (descendants du radon) est posé sur le tube " + tube); }
    this.journal("Mesure de décroissance lancée" + (f ? ` (fichier ${f.nom})` : ""));
  }
  arreterDecroissance() { this.terminerDecroissance("arrêt demandé"); }
  effacerDecroissance() { if (this.decroissance && this.decroissance.enCours) throw new Erreur("Arrêtez d'abord la mesure en cours."); this.decroissance = null; }
  terminerDecroissance(raison) {
    const d = this.decroissance; if (!d || !d.enCours) return;
    d.enCours = false; d.attente = false;
    if (this.sim) this.sim.retirerSource();
    this.journal(`Fin de la mesure de décroissance (${raison}) : ${d.mesures.length} mesures de 10 s`);
    if (d.fichier) {
      this.fichiers.ajouter(d.fichier, "");
      if (raison !== "durée atteinte") this.fichiers.ajouter(d.fichier, `Mesure arrêtée (${raison}) après ${d.mesures.length * FENETRE_S} s`);
      const cl = classesDecroissance(d.mesures, 300);
      if (cl.length >= 5) {
        const r = ajusterDecroissance(cl, d.fond !== null ? d.fond / FENETRE_S : null);
        if (r.A > 0) this.fichiers.ajouter(d.fichier, `Ajustement N0.exp(-lambda.t) + fond (classes de 300 s) : demi-vie ${fr(r.T / 60, 1)}` +
          (r.errT ? ` ± ${fr(r.errT / 60, 1)}` : "") + ` min ; bruit de fond ${fr(r.F * 10)} impulsions en 10 s`);
      }
    }
  }

  // ------------------------------------------------------------------ état
  etat() {
    const now = Date.now();
    let message = this.message;
    if (this.connecte && !message) {
      const delai = this.programme === PROG_RADIO ? 25000 : 8000 * (this.k > 1 ? 1 : 1);
      if (this.derniereDonnee === null && now - this.ouverture > 15000)
        message = "Aucune donnée reçue de l'Arduino. Vérifiez le câble et que le programme DetectionCosmiques3_0 est bien téléversé dans l'Arduino.";
      else if (this.derniereDonnee && now - this.derniereDonnee > delai)
        message = "L'Arduino n'envoie plus de données depuis quelques secondes (câble débranché ?).";
    }
    let avance = null;
    if (this.programme === PROG_SECONDES) avance = this.radioSecondes;
    else if (this.fenetreInstant) avance = Math.min(FENETRE_S, (now - this.fenetreInstant) / 1000 * this.k);
    return { connecte: this.connecte, simulation: this.simulation, acceleration: this.k, port: this.port, message,
             version: this.version, programme: this.programme, derniere: this.derniere, totaux: this.totaux, secondes: this.secondes,
             manip: this.manip, historique: this.historique, fenetre: FENETRE_S, fenetreN: this.fenetreN, fenetreInstant: this.fenetreInstant,
             fenetreAvance: avance, serie: this.serie, decroissance: this.decroissance, fond: this.fond, fondMesure: this.fondMesure || null,
             journalBrut: this.journalBrut };
  }
}

/* Classes de durée `classe` (multiple de 10 s) à partir des mesures de 10 s. t = milieu de la classe. */
function classesDecroissance(mesures, classe) {
  const k = Math.max(1, Math.round(classe / FENETRE_S)), res = [];
  for (let i = 0; i + k <= mesures.length; i += k) {
    let n = 0; for (let j = i; j < i + k; j++) n += mesures[j];
    res.push({ t: (i + k / 2) * FENETRE_S, d: k * FENETRE_S, n });
  }
  return res;
}

if (typeof module !== "undefined") module.exports = { Station, ArduinoSimule, analyserLigne, ajusterDecroissance, tranchesApparentes, classesDecroissance, versCp1252, Erreur, FENETRE_S };
