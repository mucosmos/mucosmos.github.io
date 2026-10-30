/*
 * Cosmodétecteur — version web (Web Serial)
 * Adaptation du logiciel « Roue Cosmique » [Sciences à l'École, CPPM] [Michel Jevaud, Marta Rodo Bordera, 2011]
 * pour le Cosmodétecteur [José Busto] ; version web — conception et direction du projet : Cédric Vanden Driessche (2026),
 * professeur de physique-chimie au lycée Charles de Gaulle à Caen (cedric.vanden-driessche@ac-normandie.fr) ;
 * développement du code : Claude (Anthropic), sous sa direction.
 * Copyright (C) 2026 Cédric Vanden Driessche — logiciel libre, GNU GPL v3 ou ultérieure.
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Moteur : dialogue avec le boîtier (Web Serial ou boîtier simulé), boucle de lecture, manips de comptage
 * et vie du muon, fichiers au format du logiciel LabVIEW d'origine. Traduction fidèle de boitier.py et station.py.
 *
 * Protocole (retrouvé dans KA2.llb) : 9600 bauds 8N1 ; chaque commande = 6 octets « # Cmd D1 D2 D3 ? »,
 * réponse de 6 octets de même forme ; pour une lecture, valeur = réponse[3]·256 + réponse[4].
 */
"use strict";

const CMD = { SEUIL: 0, LIRE_VOIE: 1, RAZ_VOIE: 2, LIRE_FONCTION: 3, RAZ_FONCTION: 4,
              LIRE_VIEMUON: 5, RAZ_VIEMUON: 6, ECRIRE_HT: 7, LIRE_HT: 8 };
const NOMS_VOIES = ["PM1", "PM2", "PM3", "PM4"];
const NOMS_FONCTIONS = ["PM1xPM2", "PM1xPM3", "PM1xPM4", "PM2xPM3", "PM2xPM4", "PM3xPM4", "PM1xPM2xPM3", "PM1xPM2xPM3xPM4", "PM1xPM2*xPM3*"];
const NOMS_VIEMUON = ["START = PM4 / STOP = PM4", "START = PM4xPM1 / STOP = PM4 x PM1* x PM2*"];
const GAIN_AMPLI_ENTREE = 10, DAC_MAX_MV = 3300, DAC_MAX_CODE = 4095;
const HT_MAX_VOLTS = 1500, HT_COMMANDE_MAX = 5, HT_DAC_PLEINE_ECHELLE = 6.6;
const ADC_MAX_VOLTS = 3.3, ADC_BITS = 12, HT_FACTEUR_LECTURE = 485, HORLOGE_NS = 8;
const TIMEOUT_MS = 3000;
const SEUIL_DEFAUT_MV = 40, PAUSE_CYCLE_MS = 200, ECHECS_MAX = 3;
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

class Erreur extends Error {}
class ErreurBoitier extends Error {}

const pause = ms => new Promise(r => setTimeout(r, ms));
const hex = o => Array.from(o, x => x.toString(16).padStart(2, "0")).join(" ");
const deux = n => String(n).padStart(2, "0");
const heureTexte = d => `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`;
const nombre = x => String(x);   // comme f"{x:g}" en Python : 1000, 16.5

function codeSeuil(mv) { return Math.max(0, Math.min(DAC_MAX_CODE, Math.round(mv * GAIN_AMPLI_ENTREE / DAC_MAX_MV * DAC_MAX_CODE))); }
function codeHT(volts) {
  const commande = Math.min(Math.max(0, volts) * HT_COMMANDE_MAX / HT_MAX_VOLTS, HT_COMMANDE_MAX);
  return Math.max(0, Math.min(DAC_MAX_CODE, Math.round(commande / HT_DAC_PLEINE_ECHELLE * DAC_MAX_CODE)));
}
const voltsDepuisAdc = code => code * ADC_MAX_VOLTS / 2 ** ADC_BITS * HT_FACTEUR_LECTURE;
const trame = (c, d1 = 0, d2 = 0, d3 = 0) => new Uint8Array([0x23, c & 255, d1 & 255, d2 & 255, d3 & 255, 0x3F]);

// ------------------------------------------------------------------ hasard
function gauss(m, s) { let u = 0; while (!u) u = Math.random(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }
function poisson(l) {
  if (l <= 0) return 0;
  if (l > 30) return Math.max(0, Math.round(gauss(l, Math.sqrt(l))));
  const L = Math.exp(-l); let k = 0, p = 1;
  for (;;) { p *= Math.random(); if (p <= L) return k; k++; }
}
const sigmoide = x => 1 / (1 + Math.exp(-x));

// ------------------------------------------------------------------ liaisons
/* Port série réel (Web Serial) lu octet par octet. */
class LiaisonSerie {
  constructor(port) { this.port = port; this.tampon = []; this.attente = null; }
  async ouvrir(dtr, rts) {
    await this.port.open({ baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none" });
    try { await this.port.setSignals({ dataTerminalReady: dtr, requestToSend: rts }); } catch (e) {}
    this.ecrivain = this.port.writable.getWriter();
    this.lecteur = this.port.readable.getReader();
    this.perdue = false;
    this.boucle = (async () => {
      try {
        for (;;) {
          const { value, done } = await this.lecteur.read();
          if (done) break;
          for (const b of value) this.tampon.push(b);
          if (this.attente) this.attente();
        }
      } catch (e) { if (!this.fermeture) this.perdue = true; }
    })();
  }
  get enAttente() { return this.tampon.length; }
  vider() { const r = this.tampon; this.tampon = []; return r; }
  async ecrire(o) { if (this.perdue) throw new ErreurBoitier("liaison perdue"); await this.ecrivain.write(o); }
  async lire(n, delai) {
    const limite = performance.now() + delai;
    while (this.tampon.length < n) {
      if (this.perdue) break;
      const reste = limite - performance.now();
      if (reste <= 0) break;
      await new Promise(r => { this.attente = r; setTimeout(r, Math.min(reste, 50)); });
      this.attente = null;
    }
    return this.tampon.splice(0, n);
  }
  async fermer() {
    this.fermeture = true;
    try { await this.lecteur.cancel(); } catch (e) {}
    try { await this.boucle; } catch (e) {}
    try { this.lecteur.releaseLock(); } catch (e) {}
    try { this.ecrivain.releaseLock(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
  }
}

/* Boîtier simulé : même protocole, modèle calé sur les mesures du lycée Charles de Gaulle (Caen) :
 * étalonnage HT des PM1-PM3 (déc. 2023), balayage en seuil à 1000 V (janv. 2024),
 * comptage de 72 h à 900 V / 16 mV (mars 2025), vies du muon (2023 et 2025). */
class BoitierSimule {
  constructor(acceleration = 1) {
    this.acceleration = acceleration;
    this.seuilCode = [0, 0, 0, 0]; this.htCode = [0, 0, 0, 0]; this.htReelle = [0, 0, 0, 0];
    this.voies = [0, 0, 0, 0]; this.fonctions = new Array(9).fill(0); this.viemuon = [0, 0];
    this.dernier = performance.now(); this.tampon = [];
  }
  static ORDRE = [0, 2, 1];
  static FLUX_TROIS = 1.75; static FLUX_VOISINES = 1.30;
  static A_SIMPLES = [31.1, 28.5, 31.8, 30.0];
  static EFF_MAX = [0.99, 0.97, 0.88, 0.95]; static EFF_H50 = [805, 815, 790, 800];
  static POSTIMPULSIONS = 0.318; static DESINTEGRATIONS = 0.084; static TAU_MUON_NS = 1950; static FENETRE_NS = 65528;
  static COURBE_SEUIL = [[2, 4.66], [4, 3.15], [6, 2.47], [8, 2.14], [10, 1.73], [12, 1.55], [14, 1.36],
                         [16, 1.30], [18, 1.13], [20, 1.0], [25, 0.90], [30, 0.71], [40, 0.51], [50, 0.41]];
  static VETO_PM1 = 0.905;

  seuilMv(i) { return Math.max(1, this.seuilCode[i] / DAC_MAX_CODE * DAC_MAX_MV / GAIN_AMPLI_ENTREE); }
  gain(i) { return Math.max(this.htReelle[i], 1) / 1000; }
  facteurSeuil(s) {
    const c = BoitierSimule.COURBE_SEUIL;
    if (s <= c[0][0]) return c[0][1] * (s / c[0][0]) ** -0.55;
    if (s >= c[c.length - 1][0]) return c[c.length - 1][1] * (s / c[c.length - 1][0]) ** -0.9;
    for (let k = 0; k < c.length - 1; k++) {
      const [s0, f0] = c[k], [s1, f1] = c[k + 1];
      if (s0 <= s && s <= s1) { const u = Math.log(s / s0) / Math.log(s1 / s0); return Math.exp(Math.log(f0) + u * (Math.log(f1) - Math.log(f0))); }
    }
  }
  simples(i) {
    const ht = this.htReelle[i];
    if (ht < 300) return 0;
    return BoitierSimule.A_SIMPLES[i] * this.facteurSeuil(this.seuilMv(i)) * this.gain(i) ** 6.4 * sigmoide((ht - 780) / 40);
  }
  efficacite(i) { return BoitierSimule.EFF_MAX[i] * sigmoide((this.htReelle[i] - BoitierSimule.EFF_H50[i]) / 20) * sigmoide((150 - this.seuilMv(i)) / 30); }
  excesBasSeuil(a, b, amp, ech) {
    const s = Math.max(this.seuilMv(a) / this.gain(a) ** 8, this.seuilMv(b) / this.gain(b) ** 8);
    return amp * Math.exp(-s / ech) * Math.min(this.efficacite(a), this.efficacite(b));
  }
  avancer() {
    const maintenant = performance.now();
    const dt = (maintenant - this.dernier) / 1000 * this.acceleration;
    this.dernier = maintenant;
    if (dt <= 0) return;
    for (let i = 0; i < 4; i++) {   // la HT rejoint la consigne à ~200 V/s
      const cible = Math.min(this.htCode[i] / DAC_MAX_CODE * HT_DAC_PLEINE_ECHELLE, HT_COMMANDE_MAX) * HT_MAX_VOLTS / HT_COMMANDE_MAX;
      const pas = 200 * dt;
      this.htReelle[i] += Math.max(-pas, Math.min(pas, cible - this.htReelle[i]));
    }
    const eff = [0, 1, 2, 3].map(i => this.efficacite(i));
    const vus = [0, 0, 0, 0];
    const [h, m, b] = BoitierSimule.ORDRE;
    for (const [touches, taux] of [[[h, m, b], BoitierSimule.FLUX_TROIS], [[h, m], BoitierSimule.FLUX_VOISINES], [[m, b], BoitierSimule.FLUX_VOISINES]]) {
      for (const i of touches) vus[i] += taux * eff[i];
      for (let k = poisson(taux * dt); k > 0; k--) this.compter(new Set(touches.filter(i => Math.random() < eff[i])));
    }
    for (const [[a, c], amp, ech] of [[[h, m], 3.6, 3.2], [[m, b], 3.6, 3.2], [[h, b], 1.2, 4.0]]) {
      const taux = this.excesBasSeuil(a, c, amp, ech);
      vus[a] += taux; vus[c] += taux;
      for (let k = poisson(taux * dt); k > 0; k--) this.compter(new Set([a, c]));
    }
    for (let i = 0; i < 4; i++) {
      const n = poisson(Math.max(0, this.simples(i) - vus[i]) * dt);
      this.voies[i] = (this.voies[i] + n) & 0xFFFF;
      if (i === 0) {
        let isoles = 0;
        if (n < 500) for (let k = 0; k < n; k++) isoles += Math.random() < BoitierSimule.VETO_PM1; else isoles = Math.round(n * BoitierSimule.VETO_PM1);
        this.fonctions[8] = (this.fonctions[8] + isoles) & 0xFFFF;
      }
    }
    if (this.htReelle[3] > 300) {   // vie du muon : START = STOP = PM4
      const reference = BoitierSimule.EFF_MAX[3] * sigmoide(200 / 20) * sigmoide(130 / 30);
      const taux = 0.376 * eff[3] / reference;
      for (let k = poisson(taux * dt); k > 0; k--) {
        const u = Math.random(); let t;
        if (u < BoitierSimule.POSTIMPULSIONS) {
          const v = Math.random();
          t = v < 0.82 ? gauss(300, 25) : v < 0.85 ? gauss(1450, 220) : Math.random() * 1000;
        } else if (u < BoitierSimule.POSTIMPULSIONS + BoitierSimule.DESINTEGRATIONS) t = -Math.log(1 - Math.random()) * BoitierSimule.TAU_MUON_NS;
        else t = Math.random() * BoitierSimule.FENETRE_NS;
        const ticks = Math.floor(Math.max(0, t) / HORLOGE_NS);
        if (ticks > 0 && ticks <= Math.floor(BoitierSimule.FENETRE_NS / HORLOGE_NS) && this.viemuon[0] === 0) this.viemuon[0] = ticks;
      }
    }
  }
  compter(vus) {
    for (const i of vus) this.voies[i] = (this.voies[i] + 1) & 0xFFFF;
    [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].forEach(([a, b], k) => { if (vus.has(a) && vus.has(b)) this.fonctions[k] = (this.fonctions[k] + 1) & 0xFFFF; });
    if (vus.has(0) && vus.has(1) && vus.has(2)) this.fonctions[6] = (this.fonctions[6] + 1) & 0xFFFF;
    if (vus.has(0) && vus.has(1) && vus.has(2) && vus.has(3)) this.fonctions[7] = (this.fonctions[7] + 1) & 0xFFFF;
    if (vus.has(0) && !vus.has(1) && !vus.has(2) && Math.random() < BoitierSimule.VETO_PM1) this.fonctions[8] = (this.fonctions[8] + 1) & 0xFFFF;
  }
  // -- interface de liaison
  async ouvrir() {}
  get enAttente() { return this.tampon.length; }
  vider() { const r = this.tampon; this.tampon = []; return r; }
  async ecrire(o) {
    await pause(12.5 / this.acceleration);      // durée d'un échange réel à 9600 bauds
    if (o.length !== 6 || o[0] !== 0x23 || o[5] !== 0x3F) return;
    this.avancer();
    const [, cmd, d1] = o; let d2 = o[3], d3 = o[4], valeur = null;
    if (cmd === CMD.SEUIL && d1 < 4) this.seuilCode[d1] = (d2 << 8) | d3;
    else if (cmd === CMD.ECRIRE_HT && d1 < 4) this.htCode[d1] = (d2 << 8) | d3;
    else if (cmd === CMD.LIRE_VOIE && d1 < 4) valeur = this.voies[d1];
    else if (cmd === CMD.RAZ_VOIE && d1 < 4) this.voies[d1] = 0;
    else if (cmd === CMD.LIRE_FONCTION && d1 < 9) valeur = this.fonctions[d1];
    else if (cmd === CMD.RAZ_FONCTION && d1 < 9) this.fonctions[d1] = 0;
    else if (cmd === CMD.LIRE_VIEMUON && d1 < 2) valeur = this.viemuon[d1];
    else if (cmd === CMD.RAZ_VIEMUON && d1 < 2) this.viemuon[d1] = 0;
    else if (cmd === CMD.LIRE_HT && d1 < 4) {
      const v = this.htReelle[d1] / HT_FACTEUR_LECTURE / ADC_MAX_VOLTS * 2 ** ADC_BITS;
      valeur = Math.max(0, Math.min(4095, Math.floor(v + Math.random() * 12)));
    }
    if (valeur !== null) { d2 = (valeur >> 8) & 255; d3 = valeur & 255; }
    this.tampon.push(0x23, cmd, d1, d2, d3, 0x3F);
  }
  async lire(n) { return this.tampon.splice(0, n); }
  async fermer() {}
}

// ------------------------------------------------------------------ boîtier
class Boitier {
  constructor(liaison, journal) { this.l = liaison; this.journal = journal || (() => {}); }
  async purger(ms = 300) {
    await pause(ms);
    const restes = this.l.vider();
    if (restes.length) this.journal(`octets en trop jetés : ${hex(restes)}`);
  }
  async echangeBrut(message, delai = TIMEOUT_MS) {
    if (this.l.enAttente) this.journal(`attention : ${this.l.enAttente} octets en attente avant l'envoi (${hex(this.l.vider())})`);
    await this.l.ecrire(message);
    const r = await this.l.lire(6, delai);
    this.journal(`-> ${hex(message)}   <- ${r.length ? hex(r) : "(rien)"}`);
    return r;
  }
  static valide(r) { return r.length === 6 && r[0] === 0x23 && r[5] === 0x3F; }
  async echange(cmd, d1 = 0, d2 = 0, d3 = 0, essais = 3) {
    const message = trame(cmd, d1, d2, d3); let r = [];
    for (let essai = 1; essai <= essais; essai++) {
      r = await this.echangeBrut(message);
      if (Boitier.valide(r)) return r;
      this.journal(`réponse incorrecte (${r.length} octets : ${r.length ? hex(r) : "rien"}), essai ${essai}/${essais}`);
      await this.purger();
    }
    throw new ErreurBoitier(`réponse incorrecte : ${r.length} octets reçus au lieu de 6 (${r.length ? hex(r) : "rien"})`);
  }
  /* Remet l'échange en phase (octets d'une trame incomplète restés dans le boîtier) : lecture HT voie 1,
   * sinon un octet nul pour décaler d'un cran. Ces trames ne contiennent que 23, 08, 00, 3F :
   * elles ne peuvent pas programmer une haute tension. */
  async synchroniser(decalages = 6) {
    const message = trame(CMD.LIRE_HT, 0);
    await this.purger(100);
    for (let d = 0; d <= decalages; d++) {
      const r = await this.echangeBrut(message, 600);
      if (Boitier.valide(r)) { if (d) this.journal(`échange resynchronisé après ${d} octet(s) de décalage`); return true; }
      await this.purger(200);
      await this.l.ecrire(new Uint8Array([0]));
      await this.purger(200);
    }
    return false;
  }
  async lireValeur(cmd, i) { const r = await this.echange(cmd, i); return r[3] * 256 + r[4]; }
  async programmerSeuil(v, mv) { const c = codeSeuil(mv); await this.echange(CMD.SEUIL, v, (c & 0xF00) >> 8, c & 255); return c; }
  async programmerHT(v, volts) { const c = codeHT(volts); await this.echange(CMD.ECRIRE_HT, v, (c & 0xF00) >> 8, c & 255); return c; }
  async lireHT(v) { return voltsDepuisAdc(await this.lireValeur(CMD.LIRE_HT, v)); }
  lireVoie(v) { return this.lireValeur(CMD.LIRE_VOIE, v); }
  lireFonction(f) { return this.lireValeur(CMD.LIRE_FONCTION, f); }
  lireViemuon(i) { return this.lireValeur(CMD.LIRE_VIEMUON, i); }
  razVoie(v) { return this.echange(CMD.RAZ_VOIE, v); }
  razFonction(f) { return this.echange(CMD.RAZ_FONCTION, f); }
  razViemuon(i) { return this.echange(CMD.RAZ_VIEMUON, i); }
  async razTout() {
    for (let v = 0; v < 4; v++) await this.razVoie(v);
    for (let f = 0; f < 9; f++) await this.razFonction(f);
    for (let m = 0; m < 2; m++) await this.razViemuon(m);
  }
  fermer() { return this.l.fermer(); }
}

// ------------------------------------------------------------------ fichiers
const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "œ": 0x9C, "Œ": 0x8C };
function versCp1252(texte) {
  const o = [];
  for (const c of texte.replace(/τ/g, "tau").replace(/≈/g, "~").replace(/→/g, "->")) {
    const code = c.codePointAt(0);
    o.push(code < 256 ? code : (CP1252[c] || 63));
  }
  return new Uint8Array(o);
}
class Fichiers {
  constructor() {
    this.local = typeof window !== "undefined" && !!window.COSMO_LOCAL;
    this.file = Promise.resolve(); this.liste = [];
    if (!this.local) try { this.liste = JSON.parse(localStorage.getItem("cosmodetecteur-fichiers") || "[]"); } catch (e) { this.liste = []; }
  }
  sauver() { if (!this.local) try { localStorage.setItem("cosmodetecteur-fichiers", JSON.stringify(this.liste.slice(0, 60))); } catch (e) {} }
  disque(nom, texte, mode) {
    if (!this.local) return;
    this.file = this.file.then(() => fetch("/fichiers/ecrire", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom, texte, mode }) })).catch(() => {});
  }
  creer(nom, lignes) { const f = { nom, date: Date.now(), texte: lignes.join("\r\n") + "\r\n" }; this.liste.unshift(f); this.sauver(); this.disque(nom, f.texte, "w"); return f; }
  ajouter(f, ligne) { if (!f) return; f.texte += ligne + "\r\n"; f.date = Date.now(); this.sauver(); this.disque(f.nom, ligne + "\r\n", "a"); }
  supprimer(nom) { this.liste = this.liste.filter(f => f.nom !== nom); this.sauver(); }
  octets(nom) { const f = this.liste.find(x => x.nom === nom); return f ? versCp1252(f.texte) : null; }
}

// ------------------------------------------------------------------ station
class Station {
  constructor() {
    this.fichiers = new Fichiers();
    this.journalLignes = []; this.journalTrames = false;
    this.boitier = null; this.file = Promise.resolve();
    this.reinitialiser();
  }
  reinitialiser() {
    this.connecte = false; this.port = null; this.simulation = false; this.message = "";
    this.voies = [0, 0, 0, 0]; this.fonctions = new Array(9).fill(0);
    this.htConsigne = [0, 0, 0, 0]; this.htMesure = [0, 0, 0, 0]; this.seuils = new Array(4).fill(SEUIL_DEFAUT_MV);
    this.dureeCycle = 0; this.manip = null; this.historique = []; this.muon = null; this.muons = []; this.dernierMuon = [0, 0];
  }
  journal(texte) {
    if (texte.startsWith("->") && !this.journalTrames) return;
    this.journalLignes.push(`${heureTexte(new Date())}  ${texte}`);
    if (this.journalLignes.length > 400) this.journalLignes.shift();
  }
  /* Exécute les accès au boîtier un par un (boucle de lecture et commandes de l'utilisateur). */
  exclusif(f) { const p = this.file.then(f); this.file = p.catch(() => {}); return p; }

  etat() {
    const s = x => x / 1000;
    const m = this.manip, u = this.muon;
    return {
      connecte: this.connecte, port: this.port, simulation: this.simulation, message: this.message, heure: Date.now() / 1000,
      voies: this.voies, fonctions: this.fonctions, noms_voies: NOMS_VOIES, noms_fonctions: NOMS_FONCTIONS, noms_viemuon: NOMS_VIEMUON,
      ht_consigne: this.htConsigne, ht_mesure: this.htMesure.map(v => Math.round(v * 10) / 10), seuils: this.seuils,
      duree_cycle: Math.round(this.dureeCycle) / 1000,
      manip: m ? { debut: s(m.debut), fin: m.fin ? s(m.fin) : null, intervalle: m.intervalle / 1000, prochaine: s(m.prochaine),
                   fichier: m.fichier ? m.fichier.nom : null, lignes: m.lignes } : null,
      muon: u ? { debut: s(u.debut), fin: u.fin ? s(u.fin) : null, fichier: u.fichier ? u.fichier.nom : null, evenements: u.evenements } : null,
      dernier_muon: this.dernierMuon, n_historique: this.historique.length, n_muons: this.muons.length, journal_trames: this.journalTrames,
    };
  }
  historiqueDepuis(i, j) { return { historique: this.historique.slice(i), muons: this.muons.slice(j), n_historique: this.historique.length, n_muons: this.muons.length }; }

  // ------------------------------------------------------- connexion
  async connecter(simulation, portImpose) {
    await this.deconnecter();
    let boitier, nom, port = null;
    const journal = t => this.journal(t);
    if (simulation) { boitier = new Boitier(new BoitierSimule(), journal); nom = "simulation"; }
    else {
      if (!("serial" in navigator)) throw new Erreur("Ce navigateur ne peut pas accéder au port USB : utilisez Chrome, Edge ou Chromium (ou Firefox 151 et plus récent).");
      if (portImpose) port = portImpose;
      else {
        try { port = await navigator.serial.requestPort(); }
        catch (e) { throw new Erreur("Aucun port choisi. Si la liste était vide : le boîtier est-il allumé et branché ? (onglet Fichiers et aide)"); }
      }
      const info = port.getInfo ? port.getInfo() : {};
      nom = info.usbVendorId ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId || 0).toString(16).padStart(4, "0")}` : "port série";
      boitier = await this.ouvrirPort(port, true, true, 200);
      if (!(await boitier.synchroniser())) {
        // comme « choisir un autre port puis revenir » avec l'ancien logiciel : fermer, rouvrir, essayer d'autres états DTR / RTS
        let ok = false;
        for (const [dtr, rts] of [[true, true], [false, false], [true, false], [false, true]]) {
          await boitier.fermer(); await pause(1000);
          this.journal(`Réouverture du port (DTR=${dtr ? "oui" : "non"}, RTS=${rts ? "oui" : "non"})`);
          boitier = await this.ouvrirPort(port, dtr, rts, 2000);
          if (await boitier.synchroniser(2)) { this.journal(`Le boîtier répond avec DTR=${dtr ? "oui" : "non"}, RTS=${rts ? "oui" : "non"}`); ok = true; break; }
        }
        if (!ok) {
          await boitier.fermer();
          throw new Erreur("Le boîtier ne répond pas correctement. Éteignez puis rallumez le boîtier (ou débranchez puis rebranchez le câble USB), "
                           + "attendez quelques secondes et cliquez de nouveau sur « Connecter ». Si cela persiste, regardez l'onglet Journal.");
        }
      }
    }
    try {
      this.journal(`Connexion à ${nom} : seuils à ${SEUIL_DEFAUT_MV} mV, HT à 0 V, remise à zéro`);
      for (let v = 0; v < 4; v++) await boitier.programmerSeuil(v, SEUIL_DEFAUT_MV);
      for (let v = 0; v < 4; v++) await boitier.programmerHT(v, 0);
      await boitier.razTout();
    } catch (e) {
      await boitier.fermer();
      throw new Erreur(`Le boîtier ne répond pas (${e.message}). Vérifiez le câble, l'alimentation du boîtier et le choix du port.`);
    }
    this.reinitialiser();
    this.boitier = boitier; this.portSerie = port; this.connecte = true; this.port = nom; this.simulation = simulation;
    this.generation = (this.generation || 0) + 1;
    this.boucle(this.generation);
  }
  async ouvrirPort(port, dtr, rts, attente) {
    const l = new LiaisonSerie(port);
    try { await l.ouvrir(dtr, rts); }
    catch (e) {
      throw new Erreur(/access|denied|NetworkError|InvalidState/i.test(String(e))
        ? "Accès refusé au port : fermez l'ancien logiciel « Roue Cosmique », le logiciel Cosmodétecteur installé ou un autre onglet qui l'utilise. Sous Linux : sudo usermod -aG dialout $USER, puis fermez et rouvrez la session."
        : `Impossible d'ouvrir le port : ${e.message || e}`);
    }
    await pause(attente); l.vider();
    return new Boitier(l, t => this.journal(t));
  }
  async deconnecter(couperHT = true) {
    if (!this.boitier) return;
    this.generation++;
    const b = this.boitier;
    this.terminerManip("déconnexion"); this.terminerMuon("déconnexion");
    await this.exclusif(async () => {
      if (couperHT) {
        try { for (let v = 0; v < 4; v++) await b.programmerHT(v, 0); this.htConsigne = [0, 0, 0, 0]; this.journal("HT remises à 0 V"); }
        catch (e) { this.journal(`Impossible de remettre les HT à 0 : ${e.message}`); }
      }
      await b.fermer();
    });
    this.boitier = null; this.connecte = false;
  }
  /* Fermeture de l'onglet : envoie aussitôt « HT = 0 V » aux quatre voies, sans attendre les réponses
   * (on ne peut pas attendre pendant la fermeture d'une page). */
  coupureUrgence() {
    const b = this.boitier;
    if (!b || !this.connecte || this.htConsigne.every(v => !v)) return;
    try { for (let v = 0; v < 4; v++) b.l.ecrire(trame(CMD.ECRIRE_HT, v, 0, 0)).catch(() => {}); } catch (e) {}
  }
  perteConnexion() {
    this.terminerManip("perte de connexion"); this.terminerMuon("perte de connexion");
    const b = this.boitier; this.boitier = null; this.connecte = false; this.generation++;
    if (b) b.fermer();
  }

  // ------------------------------------------------------- commandes
  async executer(f) {
    if (!this.connecte) throw new Erreur("Le boîtier n'est pas connecté.");
    try { return await this.exclusif(f); }
    catch (e) { if (e instanceof ErreurBoitier) throw new Erreur(`Le boîtier ne répond pas : ${e.message}`); throw e; }
  }
  verifierReglagesLibres() { if (this.manip || this.muon) throw new Erreur("Une manip est en cours : arrêtez-la avant de modifier les réglages."); }
  async reglerHT(voie, volts) {
    volts = Number(volts);
    if (!(volts >= 0 && volts <= 1500)) throw new Erreur("La consigne HT doit être comprise entre 0 et 1500 V.");
    this.verifierReglagesLibres();
    await this.executer(async () => { await this.boitier.programmerHT(voie, volts); this.htConsigne[voie] = volts; this.journal(`HT ${NOMS_VOIES[voie]} = ${nombre(volts)} V`); });
  }
  async reglerSeuil(voie, mv) {
    mv = Number(mv);
    if (!(mv >= 0 && mv <= 330)) throw new Erreur("Le seuil doit être compris entre 0 et 330 mV.");
    this.verifierReglagesLibres();
    await this.executer(async () => { await this.boitier.programmerSeuil(voie, mv); this.seuils[voie] = mv; this.journal(`Seuil ${NOMS_VOIES[voie]} = ${nombre(mv)} mV`); });
  }
  async raz(quoi, i) {
    await this.executer(async () => {
      const b = this.boitier;
      if (quoi === "voie") { await b.razVoie(i); this.voies[i] = 0; }
      else if (quoi === "fonction") { await b.razFonction(i); this.fonctions[i] = 0; }
      else if (quoi === "muon") { await b.razViemuon(i); this.dernierMuon[i] = 0; }
      else if (quoi === "tout") { await b.razTout(); this.voies = [0, 0, 0, 0]; this.fonctions = new Array(9).fill(0); this.dernierMuon = [0, 0]; }
    });
  }

  // ------------------------------------------------------- manips
  async lancerManip(dureeS, intervalleS, fichier, commentaire) {
    if (this.manip) throw new Erreur("Une manip de comptage est déjà en cours.");
    intervalleS = Number(intervalleS); dureeS = Number(dureeS);
    if (!(intervalleS >= 1)) throw new Erreur("L'intervalle doit être d'au moins 1 seconde.");
    if (dureeS && dureeS < intervalleS) throw new Erreur("La durée de manip doit être plus longue que l'intervalle.");
    await this.executer(async () => {
      for (let v = 0; v < 4; v++) await this.boitier.razVoie(v);
      for (let f = 0; f < 9; f++) await this.boitier.razFonction(f);
      const debut = Date.now();
      const f = fichier ? this.creerFichier("comptage", commentaire, false) : null;
      this.voies = [0, 0, 0, 0]; this.fonctions = new Array(9).fill(0); this.historique = [];
      this.manip = { debut, fin: dureeS ? debut + dureeS * 1000 : null, intervalle: intervalleS * 1000, prochaine: debut + intervalleS * 1000, fichier: f, lignes: 0 };
      this.journal("Manip de comptage lancée" + (f ? ` (fichier ${f.nom})` : ""));
    });
  }
  arreterManip() { this.terminerManip("arrêt demandé"); }
  async lancerMuon(dureeS, fichier, commentaire) {
    if (this.muon) throw new Erreur("Une manip vie du muon est déjà en cours.");
    dureeS = Number(dureeS);
    await this.executer(async () => {
      for (let m = 0; m < 2; m++) await this.boitier.razViemuon(m);
      const debut = Date.now();
      const f = fichier ? this.creerFichier("viemuon", commentaire, true) : null;
      this.muons = []; this.dernierMuon = [0, 0];
      this.muon = { debut, fin: dureeS ? debut + dureeS * 1000 : null, fichier: f, evenements: 0 };
      this.journal("Manip vie du muon lancée" + (f ? ` (fichier ${f.nom})` : ""));
    });
  }
  arreterMuon() { this.terminerMuon("arrêt demandé"); }
  effacerMuons() { this.muons = []; }
  terminerManip(raison) { if (this.manip) { this.journal(`Fin de la manip de comptage (${raison}), ${this.manip.lignes} intervalles`); this.manip = null; } }
  terminerMuon(raison) { if (this.muon) { this.journal(`Fin de la manip vie du muon (${raison}), ${this.muon.evenements} événements`); this.muon = null; } }

  creerFichier(prefixe, commentaire, viemuon) {
    const d = new Date();
    const nom = `${prefixe}_${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}_${deux(d.getHours())}h${deux(d.getMinutes())}m${deux(d.getSeconds())}.txt`;
    const L = [];
    if (viemuon) L.push("Vie du muon");
    L.push(`Date du: ${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`, `Heure:${deux(d.getHours())}:${deux(d.getMinutes())}`);
    L.push(...(commentaire || "").replace(/\r\n/g, "\n").split("\n"), "");
    const h = this.htConsigne.map(nombre);
    L.push(`HT PM1: ${h[0]}V\tHT PM2:${h[1]}V\tHT PM3:${h[2]}V\tHT PM4: ${h[3]}V`);
    L.push(this.seuils.map((s, i) => `Seuil PM${i + 1}: ${nombre(s)}mV`).join("\t"), "");
    if (viemuon) L.push("HEURE\tVIE DU MUON 1 (ns) ");
    else L.push(["HEURE", "COMPTAGE VOIE 1   ", "COMPTAGE VOIE 2", "COMPTAGE VOIE 3   ", "COMPTAGE VOIE 4", ...NOMS_FONCTIONS.map(n => `COMPTAGE FONCTION ${n}`)].join("\t"));
    return this.fichiers.creer(nom, L);
  }

  // ------------------------------------------------------- boucle principale
  async boucle(gen) {
    let echecs = 0;
    while (this.generation === gen && this.connecte) {
      const t0 = performance.now();
      try {
        await this.exclusif(() => (this.generation === gen ? this.cycle() : null));
        echecs = 0;
      } catch (e) {
        if (this.generation !== gen) return;
        if (e instanceof ErreurBoitier || this.boitier?.l.perdue) {
          echecs++;
          this.journal(`Erreur de communication : ${e.message}`);
          if (this.boitier?.l.perdue || echecs >= ECHECS_MAX) {
            this.message = "Le boîtier ne répond plus : vérifiez le câble et l'alimentation, puis reconnectez.";
            this.perteConnexion(); return;
          }
          try { await this.exclusif(() => this.boitier.synchroniser()); } catch (x) {}
        } else this.journal("Erreur interne : " + (e.message || e));
      }
      this.dureeCycle = performance.now() - t0;
      let attente = PAUSE_CYCLE_MS;
      if (this.manip) {   // se caler sur la fin de l'intervalle si elle tombe avant le prochain cycle
        const reste = this.manip.prochaine - Date.now();
        if (reste < PAUSE_CYCLE_MS + this.dureeCycle) attente = Math.max(0, reste);
      }
      await pause(attente);
    }
  }
  async cycle() {
    const b = this.boitier;
    if (this.manip && Date.now() >= this.manip.prochaine) {
      const voies = [], fonctions = [];   // lecture puis remise à zéro immédiate (temps mort minimal)
      for (let v = 0; v < 4; v++) { voies.push(await b.lireVoie(v)); await b.razVoie(v); }
      for (let f = 0; f < 9; f++) { fonctions.push(await b.lireFonction(f)); await b.razFonction(f); }
      this.enregistrerIntervalle(voies, fonctions);
    } else {
      const voies = [], fonctions = [];
      for (let v = 0; v < 4; v++) voies.push(await b.lireVoie(v));
      for (let f = 0; f < 9; f++) fonctions.push(await b.lireFonction(f));
      this.voies = voies; this.fonctions = fonctions;
    }
    const brut = await b.lireViemuon(0);      // méthode « vie du muon 1 » (START = STOP = PM4)
    if (brut) { await b.razViemuon(0); this.evenementMuon(0, brut * HORLOGE_NS); }
    const mesures = [];
    for (let v = 0; v < 4; v++) mesures.push(await b.lireHT(v));
    this.htMesure = mesures;
    const now = Date.now();
    if (this.manip && this.manip.fin && now >= this.manip.fin) this.terminerManip("durée atteinte");
    if (this.muon && this.muon.fin && now >= this.muon.fin) this.terminerMuon("durée atteinte");
  }
  enregistrerIntervalle(voies, fonctions) {
    const t = Date.now(), heure = heureTexte(new Date(t)), valeurs = [...voies, ...fonctions], m = this.manip;
    this.voies = [0, 0, 0, 0]; this.fonctions = new Array(9).fill(0);
    this.historique.push({ t: t / 1000, heure, valeurs });
    m.lignes++; m.prochaine += m.intervalle;
    if (m.prochaine < t) m.prochaine = t + m.intervalle;   // rattrapage si l'ordinateur a pris du retard
    this.fichiers.ajouter(m.fichier, heure + "\t" + valeurs.join("\t"));
  }
  evenementMuon(i, ns) {
    const t = Date.now(), heure = heureTexte(new Date(t));
    this.dernierMuon[i] = ns;
    this.muons.push({ t: t / 1000, heure, index: i, ns });
    if (this.muon) { this.muon.evenements++; this.fichiers.ajouter(this.muon.fichier, `${heure}\t${ns}`); }
  }

  // ------------------------------------------------------- « API » utilisée par l'interface
  async api(chemin, d = {}) {
    switch (chemin) {
      case "/api/connecter": this.message = ""; return this.connecter(!!d.simulation);
      case "/api/deconnecter": return this.deconnecter();
      case "/api/ht": return this.reglerHT(d.voie, d.volts);
      case "/api/seuil": return this.reglerSeuil(d.voie, d.mv);
      case "/api/raz": return this.raz(d.quoi, d.index);
      case "/api/manip/lancer": return this.lancerManip(d.duree, d.intervalle, !!d.fichier, d.commentaire || "");
      case "/api/manip/arreter": return this.arreterManip();
      case "/api/muon/lancer": return this.lancerMuon(d.duree, !!d.fichier, d.commentaire || "");
      case "/api/muon/arreter": return this.arreterMuon();
      case "/api/muon/effacer": return this.effacerMuons();
      case "/api/journal/trames": this.journalTrames = !!d.actif; return null;
    }
    throw new Erreur("Action inconnue.");
  }
}

if (typeof module !== "undefined") module.exports = { Station, Boitier, BoitierSimule, codeSeuil, codeHT, voltsDepuisAdc, trame, versCp1252, Erreur };
