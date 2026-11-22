// Smart Mail : réunit les panneaux « Adresses » (relever les adresses que
// propose le champ À) et « Publipostage » (envoyer le message à chacune) en un
// seul panneau à deux onglets. Chaque panneau garde son code et son stockage ;
// ce fichier ne fait que :
//   - poser la barre d'onglets en haut de chacun, n'en montrer qu'un à la fois,
//     au même endroit (la position suit quand on déplace l'un ou l'autre) ;
//   - tenir l'annuaire commun : chaque personne relevée y entre en direct, et
//     l'onglet Envoyer s'en sert comme destinataires ;
//   - empêcher l'un de démarrer pendant que l'autre tourne : le relevé tape dans
//     « À » pour faire apparaître les suggestions, l'envoi y colle les adresses.
// Dernier script chargé, cadre principal d'Outlook uniquement (pas de Gmail :
// le Publipostage ne sait envoyer que depuis Outlook).

(function (root) {
  "use strict";
  if (root.top !== root.self) return;
  var api = root.chrome || root.browser;
  var CLE_ONGLET = "mega-onglet";

  var onglet = "adresses"; // onglet affiché : "adresses" ou "envoi"
  var masque = false;      // panneau masqué par le bouton de l'extension ou la croix
  var ao = null, pp = null; // { host, ombre } de chaque panneau, une fois prêts

  function envoiActif() { return !!(root.PP && root.PP.moteurActif); }
  function releveActif() { return !!(root.AOPanneau && root.AOPanneau.enCours()); }

  root.MEGA = {
    onglet: function () { return onglet; },
    // Démarrage automatique du relevé : seulement onglet « Relever » affiché et
    // aucun envoi en cours (lu par adresses/panel.js à chaque armement).
    relevePermis: function () { return !masque && onglet === "adresses" && !envoiActif(); }
  };

  var CSS = `
  .mega-tabs { display:flex;gap:4px;padding:8px 10px 0;background:var(--card);border-bottom:1px solid var(--line); }
  .mega-tab { flex:1;border:1px solid transparent;border-bottom:none;background:none;color:var(--muted);font:inherit;font-weight:600;font-size:12.5px;
    padding:7px 8px;border-radius:9px 9px 0 0;cursor:pointer;white-space:nowrap;position:relative;top:1px; }
  .mega-tab:hover { color:var(--ink2); }
  .mega-tab[aria-selected="true"] { background:var(--bg);color:var(--brand);border-color:var(--line); }
  .mega-tab .pastille { display:inline-block;width:7px;height:7px;border-radius:50%;background:#16A34A;margin-left:6px;vertical-align:1px; }
  .mega-tab .pastille[hidden] { display:none; }
  .mega-send { width:100%;margin:-2px 0 10px;display:inline-flex;align-items:center;justify-content:center;gap:8px;
    background:var(--brand-soft);color:var(--brand);border:1px solid transparent;border-radius:12px;padding:10px 16px;font-weight:700;
    transition:background .12s ease,border-color .12s ease; }
  .mega-send:hover:not(:disabled) { background:var(--brand-soft);border-color:var(--brand); }
  .mega-send:disabled { background:transparent;border:1px dashed var(--line);color:var(--faint);opacity:1; }
  .mega-send .compte { background:var(--brand);color:#fff;border-radius:999px;padding:1px 8px;font-size:11.5px;font-weight:700;min-width:20px;text-align:center; }
  .mega-send:disabled .compte { display:none; }
  .mega-send .fleche { display:inline-block;transition:transform .15s ease; }
  .mega-send:hover:not(:disabled) .fleche { transform:translateX(3px); }
  .mega-tri { padding:10px 12px;margin:0 0 10px; }
  .mega-tri .entete { display:flex;align-items:center;justify-content:space-between;gap:8px; }
  .mega-tri label { display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap; }
  .mega-tri .ligne { display:flex;gap:6px;margin-top:8px; }
  .mega-tri input[type=password] { flex:1;min-width:0;font:inherit;font-size:12.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;
    background:var(--bg);color:var(--ink); }
  .mega-tri .erreur { color:#B91C1C;margin-top:6px; }
  .mega-tri .erreur:empty { display:none; }
  .mega-tri .mega-trier { width:100%;margin-top:8px; }
  `;

  function barre(ombre, actif) {
    var st = document.createElement("style"); st.textContent = CSS; ombre.appendChild(st);
    var b = document.createElement("div"); b.className = "mega-tabs"; b.setAttribute("role", "tablist");
    [["adresses", "① Relever les adresses"], ["envoi", "② Envoyer"]].forEach(function (t) {
      var x = document.createElement("button");
      x.className = "mega-tab"; x.setAttribute("role", "tab"); x.dataset.onglet = t[0];
      x.setAttribute("aria-selected", String(t[0] === actif));
      x.appendChild(document.createTextNode(t[1]));
      var p = document.createElement("span"); p.className = "pastille"; p.hidden = true; p.title = "En cours";
      x.appendChild(p);
      x.addEventListener("click", function () { montrer(t[0]); });
      b.appendChild(x);
    });
    var panel = ombre.querySelector(".panel");
    panel.insertBefore(b, panel.firstChild);
    // Les boutons des panneaux ne volent pas le focus (champ « À » armé) : idem ici.
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
  }

  // Même position pour les deux panneaux : celui qu'on affiche prend la place
  // de celui qu'on quitte (déplacé à la main ou non).
  function copierPosition(de, vers) {
    ["top", "left", "right"].forEach(function (k) { vers.style[k] = de.style[k]; });
  }

  function montrer(o, sansSauver) {
    if (!ao || !pp) return;
    var avant = onglet === "envoi" ? pp.host : ao.host;
    onglet = o;
    var apres = o === "envoi" ? pp.host : ao.host;
    if (apres !== avant) copierPosition(avant, apres);
    ao.host.style.display = !masque && o === "adresses" ? "" : "none";
    pp.host.style.display = !masque && o === "envoi" ? "" : "none";
    [ao.ombre, pp.ombre].forEach(function (om) {
      om.querySelectorAll(".mega-tab").forEach(function (x) { x.setAttribute("aria-selected", String(x.dataset.onglet === o)); });
    });
    // Hors de l'onglet « Relever », le champ « À » ne déclenche plus de relevé.
    try {
      var A = root.AOArmement;
      if (A && !releveActif()) {
        if (root.MEGA.relevePermis()) A.resume(); else { A.suspend(); A.disarm(); }
      }
    } catch (e) {}
    if (!sansSauver) try { var s = {}; s[CLE_ONGLET] = o; api.storage.local.set(s); } catch (e) {}
  }

  function basculer() {
    masque = !masque;
    if (masque && releveActif()) { var stop = ao && ao.ombre.getElementById("ao-stop"); if (stop && !stop.disabled) stop.click(); }
    montrer(onglet, true);
  }

  // Pastille verte sur l'onglet de ce qui tourne, et armement coupé pendant un envoi.
  var etaitEnvoi = false;
  function veiller() {
    if (!ao || !pp) return;
    var r = releveActif(), e = envoiActif();
    [ao.ombre, pp.ombre].forEach(function (om) {
      om.querySelectorAll(".mega-tab").forEach(function (x) {
        x.querySelector(".pastille").hidden = !(x.dataset.onglet === "adresses" ? r : e);
      });
    });
    if (e !== etaitEnvoi) {
      etaitEnvoi = e;
      majTri();
      if (!e && masque) {
        var n = pp.ombre.getElementById("pp-notice");
        if (n && /warn/.test(n.className)) { masque = false; onglet = "envoi"; }
      }
      montrer(onglet, true);
    }
  }

  // ------------------------------------------------------------ annuaire commun
  // Toutes les personnes relevées, quelle que soit la messagerie : l'historique
  // d'« Adresses » (base-outlook, base-gmail) plus chaque adresse trouvée par le
  // relevé en cours, AU MOMENT où elle s'affiche (adresses/panel.js appelle
  // MEGA.trouve). L'onglet Envoyer s'en sert directement comme destinataires
  // (case « Annuaire commun »), sans copier-coller ni transfert.
  // « Vider l'historique » (⚙ d'Adresses) le vide aussi.
  var CLE_ANNUAIRE = "mega-annuaire", CLE_ANNUAIRE_ACTIF = "mega-annuaire-actif", BASES = ["base-outlook", "base-gmail"];
  var annuaire = new Set(), annuaireActif = true, annuaireCharge = false;
  var tPousser = null, tSauver = null;

  function lignes(v) { return v ? String(v).split(/\r?\n/) : []; }
  var ADRESSE_VALIDE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;
  function ajouter(mail) {
    var k = String(mail || "").trim().toLowerCase().replace(/^[.']+|[.']+$/g, "");
    if (!k || !ADRESSE_VALIDE.test(k) || /\.\.|^\.|\.@/.test(k) || annuaire.has(k)) return false;
    annuaire.add(k); return true;
  }
  function listeAnnuaire() { return Array.from(annuaire).sort(); }
  function annuaireChange() {
    clearTimeout(tPousser); tPousser = setTimeout(pousser, 200);
    clearTimeout(tSauver); tSauver = setTimeout(sauverAnnuaire, 1000);
  }
  function sauverAnnuaire() {
    if (!annuaireCharge) return;
    try { var o = {}; o[CLE_ANNUAIRE] = listeAnnuaire().join("\n"); api.storage.local.set(o); } catch (e) {}
  }
  // Affiche le compte des deux côtés et met à jour la liste de l'envoi.
  function pousser() {
    var n = annuaire.size;
    if (ao) {
      var b = ao.ombre.getElementById("mega-send");
      if (b) { b.querySelector(".compte").textContent = n.toLocaleString("fr-FR"); b.dataset.n = String(n); b.disabled = !n; b.title = n ? n.toLocaleString("fr-FR") + " personne(s) dans l'annuaire commun, utilisé par l'onglet ② Envoyer" : "L'annuaire se remplit pendant le relevé"; }
    }
    var P = root.PP && root.PP.Panneau;
    if (P && annuaireCharge) P.majAnnuaire(listeEnvoi(), annuaireActif, libelleEnvoi());
    majTri();
  }
  // Le nom affiché par Outlook aide le tri (« Prof. », « Service »…) : gardé à côté.
  root.MEGA.trouve = function (mail, nom) {
    var k = String(mail || "").trim().toLowerCase();
    if (nom && k && !noms[k]) { noms[k] = String(nom).trim().slice(0, 200); sauverNoms(); }
    if (ajouter(mail)) annuaireChange();
  };
  root.MEGA.annuaire = function () { return listeAnnuaire(); };

  // ------------------------------------------------------------ tri des élèves par IA
  // Option : le serveur Smart Mail classe l'annuaire (adresse et nom seulement, avec
  // le code d'accès de la personne) et l'envoi ne garde que les élèves.
  // Règles : le tri ne fait que RETIRER des destinataires, jamais en ajouter ; une
  // adresse pas encore triée, ou dont le classement est incertain, n'est PAS gardée.
  var CLE_CODE = "mega-code-ia", CLE_TRI = "mega-tri", CLE_TRI_ACTIF = "mega-tri-actif", CLE_LOGIQUE = "mega-tri-logique", CLE_NOMS = "mega-noms";
  var tri = {}, triActif = false, logique = null, noms = {}, codeIA = "", triEnCours = false, triMessage = "", triErreur = "";
  var tNoms = null;

  function compterTri() {
    var c = { etudiant: 0, hors: 0, incertain: 0, aTrier: 0 };
    annuaire.forEach(function (a) { var g = tri[a]; if (g) c[g]++; else c.aTrier++; });
    return c;
  }
  function listeEnvoi() {
    var l = listeAnnuaire();
    return triActif ? l.filter(function (a) { return tri[a] === "etudiant"; }) : l;
  }
  function libelleEnvoi() {
    if (!triActif) return "";
    var c = compterTri(), n = c.etudiant;
    return n.toLocaleString("fr-FR") + (n > 1 ? " élèves" : " élève") + " (tri IA sur " + annuaire.size.toLocaleString("fr-FR") + " relevées)";
  }
  function sauverTri() {
    try {
      var o = {}; o[CLE_TRI] = JSON.stringify(tri); o[CLE_TRI_ACTIF] = triActif; o[CLE_LOGIQUE] = logique ? JSON.stringify(logique) : "";
      api.storage.local.set(o);
    } catch (e) {}
  }
  function sauverNoms() {
    clearTimeout(tNoms);
    tNoms = setTimeout(function () { try { var o = {}; o[CLE_NOMS] = JSON.stringify(noms); api.storage.local.set(o); } catch (e) {} }, 1000);
  }
  async function chargerTri() {
    var o = {};
    try { o = await api.storage.local.get([CLE_CODE, CLE_TRI, CLE_TRI_ACTIF, CLE_LOGIQUE, CLE_NOMS]); } catch (e) {}
    try { tri = JSON.parse(o[CLE_TRI] || "{}") || {}; } catch (e) { tri = {}; }
    try { logique = o[CLE_LOGIQUE] ? JSON.parse(o[CLE_LOGIQUE]) : null; } catch (e) { logique = null; }
    try { var n = JSON.parse(o[CLE_NOMS] || "{}") || {}; Object.keys(n).forEach(function (k) { if (!noms[k]) noms[k] = n[k]; }); } catch (e) {}
    triActif = o[CLE_TRI_ACTIF] === true;
    codeIA = typeof o[CLE_CODE] === "string" ? o[CLE_CODE] : "";
  }

  // Le service worker de l'extension joint le serveur (permission d'hôte : pas de CORS).
  function appel(chemin, corps) {
    return new Promise(function (fini) {
      try {
        api.runtime.sendMessage({ mega: "api", chemin: chemin, corps: corps, code: codeIA }, function (r) {
          var e = api.runtime.lastError;
          fini(r || { ok: false, statut: 0, json: { detail: e ? e.message : "Extension indisponible." } });
        });
      } catch (e) { fini({ ok: false, statut: 0, json: { detail: e.message } }); }
    });
  }
  function erreurApi(r) {
    var d = r && r.json && typeof r.json.detail === "string" ? r.json.detail : "";
    var e = new Error(r.statut === 401 ? "Code d'accès refusé. Vérifiez-le ou demandez-en un nouveau."
      : r.statut === 0 ? (d || "Serveur Smart Mail injoignable.") : (d || "Erreur du serveur (" + r.statut + ")."));
    e.codeRefuse = r.statut === 401;
    return e;
  }
  // Une trentaine de personnes, celles qui ont un nom d'abord : elles révèlent la logique de l'école.
  function echantillon(liste) {
    var avec = liste.filter(function (a) { return noms[a]; }), sans = liste.filter(function (a) { return !noms[a]; });
    return avec.slice(0, 22).concat(sans.slice(0, 30 - Math.min(22, avec.length))).slice(0, 30)
      .map(function (a) { return { adresse: a, nom: noms[a] || "" }; });
  }

  async function trier() {
    if (triEnCours || !codeIA || envoiActif()) return;
    var aTrier = listeAnnuaire().filter(function (a) { return !tri[a]; });
    if (!aTrier.length) return;
    triEnCours = true; triErreur = ""; triMessage = "Analyse de l'annuaire…"; majTri();
    try {
      if (!logique) {
        var ech = echantillon(listeAnnuaire());
        if (ech.length >= 5) {
          var r = await appel("/v1/logique", { echantillon: ech });
          if (!r.ok) throw erreurApi(r);
          logique = r.json && r.json.logique ? r.json.logique : null;
        }
      }
      for (var i = 0; i < aTrier.length; i += 500) {
        triMessage = "Tri en cours… " + i.toLocaleString("fr-FR") + " / " + aTrier.length.toLocaleString("fr-FR"); majTri();
        var lot = aTrier.slice(i, i + 500).map(function (a) { return { adresse: a, nom: noms[a] || "" }; });
        var r2 = await appel("/v1/tri", logique ? { contacts: lot, logique: logique } : { contacts: lot });
        if (!r2.ok) throw erreurApi(r2);
        var demandees = new Set(aTrier.slice(i, i + 500));
        ((r2.json && r2.json.resultats) || []).forEach(function (x) {
          var a = x && String(x.adresse || "").toLowerCase();
          if (!a || !demandees.has(a)) return; // seulement les adresses demandées
          tri[a] = x.groupe === "etudiant" ? "etudiant" : x.groupe === "hors" ? "hors" : "incertain";
        });
        sauverTri();
      }
      triActif = true; // premier tri réussi : l'envoi ne garde plus que les élèves
      sauverTri();
    } catch (e) {
      triErreur = e.message;
      if (e.codeRefuse) { codeIA = ""; try { api.storage.local.remove(CLE_CODE); } catch (x) {} }
    } finally {
      triEnCours = false; triMessage = "";
      pousser();
    }
  }

  // Construit sans innerHTML, comme les panneaux d'origine.
  function el(tag, attrs, enfants) {
    var x = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "texte") x.textContent = attrs[k]; else x.setAttribute(k, attrs[k]); });
    (enfants || []).forEach(function (c) { x.appendChild(c); });
    return x;
  }
  function blocTri() {
    return el("div", { "class": "card mega-tri", id: "mega-tri" }, [
      el("div", { "class": "entete" }, [
        el("b", { texte: "Élèves seulement" }),
        el("label", { "class": "small" }, [el("input", { type: "checkbox", id: "mega-tri-actif" }), document.createTextNode(" Envoyer aux élèves seulement")]),
      ]),
      el("div", { "class": "small", id: "mega-tri-etat", style: "margin-top:3px" }),
      el("div", { "class": "ligne", id: "mega-tri-code-ligne" }, [
        el("input", { type: "password", id: "mega-tri-code", autocomplete: "off", placeholder: "Code d'accès Smart Mail", "aria-label": "Code d'accès Smart Mail" }),
        el("button", { "class": "btn mini", id: "mega-tri-code-ok", texte: "Enregistrer" }),
      ]),
      el("div", { "class": "small erreur", id: "mega-tri-erreur", role: "alert" }),
      el("button", { "class": "btn mega-trier", id: "mega-trier", texte: "Trier avec l'IA" }),
    ]);
  }
  function majTri() {
    if (!ao) return;
    var om = ao.ombre, el = function (id) { return om.getElementById(id); }; // (masque el() ici : lecture seule)
    if (!el("mega-tri")) return;
    var c = compterTri(), tries = c.etudiant + c.hors + c.incertain;
    var nb = function (n) { return n.toLocaleString("fr-FR"); };
    var etat;
    if (triMessage) etat = triMessage;
    else if (!codeIA) etat = "Le serveur Smart Mail garde les élèves et écarte le personnel, les services et les contacts personnels (adresse et nom seulement). Entrez votre code d'accès.";
    else if (!annuaire.size) etat = "L'annuaire est vide : relevez d'abord des adresses.";
    else if (!tries) etat = nb(c.aTrier) + (c.aTrier > 1 ? " personnes à trier." : " personne à trier.");
    else etat = nb(c.etudiant) + (c.etudiant > 1 ? " élèves" : " élève") + " · " + nb(c.hors + c.incertain) + " écartés" +
      (c.incertain ? " (dont " + nb(c.incertain) + (c.incertain > 1 ? " incertains)" : " incertain)") : "") + (c.aTrier ? " · " + nb(c.aTrier) + " à trier" : "");
    el("mega-tri-etat").textContent = etat;
    el("mega-tri-code-ligne").hidden = !!codeIA;
    el("mega-tri-erreur").textContent = triErreur;
    var b = el("mega-trier");
    b.hidden = !codeIA;
    b.disabled = triEnCours || !c.aTrier || envoiActif();
    b.textContent = triEnCours ? "Tri en cours…" : !c.aTrier && tries ? "Tout est trié" :
      tries ? (c.aTrier > 1 ? "Trier les " + nb(c.aTrier) + " nouvelles adresses" : "Trier la nouvelle adresse") : "Trier avec l'IA";
    var x = el("mega-tri-actif");
    x.checked = triActif; x.disabled = !tries || envoiActif();
  }
  function brancherTri() {
    var envoyer = ao.ombre.getElementById("mega-send");
    if (!envoyer) return;
    var d = blocTri();
    envoyer.after(d);
    var el = function (id) { return ao.ombre.getElementById(id); };
    el("mega-tri-code-ok").addEventListener("click", function () {
      var v = el("mega-tri-code").value.trim();
      if (!v) return;
      codeIA = v; el("mega-tri-code").value = ""; triErreur = "";
      try { var o = {}; o[CLE_CODE] = v; api.storage.local.set(o); } catch (e) {}
      majTri();
    });
    el("mega-tri-code").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); el("mega-tri-code-ok").click(); } });
    el("mega-trier").addEventListener("click", function () { trier(); });
    el("mega-tri-actif").addEventListener("change", function () { triActif = el("mega-tri-actif").checked; sauverTri(); pousser(); });
    // Comme les autres boutons du panneau : ne pas voler le focus du champ « À ».
    d.addEventListener("mousedown", function (e) { if (e.target.tagName !== "INPUT") e.preventDefault(); });
  }

  async function chargerAnnuaire() {
    var o = {};
    try { o = await api.storage.local.get([CLE_ANNUAIRE, CLE_ANNUAIRE_ACTIF].concat(BASES)); } catch (e) {}
    lignes(o[CLE_ANNUAIRE]).forEach(ajouter);
    BASES.forEach(function (k) { lignes(o[k]).forEach(ajouter); });
    if (typeof o[CLE_ANNUAIRE_ACTIF] === "boolean") annuaireActif = o[CLE_ANNUAIRE_ACTIF];
    annuaireCharge = true;
    annuaireChange();
  }
  // Historique d'Adresses modifié (fin de relevé, import, ou relevé fait dans
  // un onglet Gmail) : on complète. Historique vidé : on repart des historiques
  // qui restent (les trouvailles en direct non enregistrées partent avec).
  try {
    api.storage.onChanged.addListener(function (ch, zone) {
      if (zone !== "local") return;
      var vide = false, plus = false;
      BASES.forEach(function (k) {
        if (!ch[k]) return;
        if (ch[k].newValue == null) vide = true;
        else lignes(ch[k].newValue).forEach(function (m) { if (ajouter(m)) plus = true; });
      });
      if (vide) {
        api.storage.local.get(BASES).then(function (o) {
          annuaire.clear();
          BASES.forEach(function (k) { lignes(o[k]).forEach(ajouter); });
          annuaireChange();
        });
      } else if (plus) annuaireChange();
    });
  } catch (e) {}

  // Côté Relever : un raccourci vers l'onglet Envoyer, l'annuaire y est déjà.
  function boutonEnvoyer() {
    var demarrer = ao.ombre.getElementById("ao-run");
    if (!demarrer) return;
    var b = document.createElement("button");
    b.className = "btn mega-send"; b.id = "mega-send"; b.disabled = true;
    [["libelle", "Envoyer à l'annuaire"], ["compte", "0"], ["fleche", "→"]].forEach(function (p) {
      var x = document.createElement("span"); x.className = p[0]; x.textContent = p[1]; b.appendChild(x);
    });
    b.title = "Les personnes relevées sont déjà dans l'annuaire commun, utilisé par l'onglet ② Envoyer";
    demarrer.parentNode.after(b); // sous « Démarrer »
    b.addEventListener("click", function () {
      if (!annuaireActif) { annuaireActif = true; choixAnnuaire(true); pousser(); }
      montrer("envoi");
    });
  }
  function choixAnnuaire(actif) {
    annuaireActif = actif;
    try { var o = {}; o[CLE_ANNUAIRE_ACTIF] = actif; api.storage.local.set(o); } catch (e) {}
  }

  function brancher(host) {
    // La croix d'« Adresses » retirait son panneau pour de bon : ici elle masque
    // le panneau Smart Mail (le bouton de l'extension le fait revenir).
    var fermer = host.shadowRoot.getElementById("ao-close");
    if (fermer) {
      fermer.title = "Masquer (le bouton de l'extension le fait revenir)";
      fermer.addEventListener("click", function (e) { e.stopImmediatePropagation(); e.preventDefault(); basculer(); }, true);
    }
  }

  // Les deux panneaux finissent leur amorçage (lecture du stockage) chacun à
  // son rythme : on attend les deux.
  var fini = false;
  async function essayer() {
    if (fini) return;
    var hA = document.querySelector('[data-testid="ao-panel"]'), hP = document.querySelector("[data-pp-panneau]");
    if (!hA || !hP || !root.AOPanneau || !(root.PP && root.PP.Panneau) || !hA.shadowRoot || !hP.shadowRoot) return;
    fini = true;
    ao = { host: hA, ombre: hA.shadowRoot };
    pp = { host: hP, ombre: hP.shadowRoot };
    hP.style.right = "12px"; // le Publipostage s'était décalé à gauche d'Adresses
    var o = null;
    try { o = (await api.storage.local.get(CLE_ONGLET))[CLE_ONGLET]; } catch (e) {}
    // Un envoi en cours de route s'affiche d'abord (on y revient pour le reprendre).
    if (o !== "adresses" && o !== "envoi") o = "adresses";
    if (root.PP.Panneau && pp.ombre.getElementById("pp-reprise") && !pp.ombre.getElementById("pp-reprise").hidden) o = "envoi";
    onglet = o;
    barre(ao.ombre, o); barre(pp.ombre, o);
    brancher(hA);
    boutonEnvoyer();
    brancherTri();
    root.PP.Panneau.surChoixAnnuaire = choixAnnuaire;
    montrer(o, true);
    await chargerTri();
    await chargerAnnuaire();
    setInterval(veiller, 700);
    document.documentElement.dataset.megaPret = "1"; // repère pour les tests
  }
  document.addEventListener("mega-pret", essayer);
  var tentatives = 0, t = setInterval(function () { essayer(); if (fini || ++tentatives > 60) clearInterval(t); }, 500);
  essayer();

  try {
    api.runtime.onMessage.addListener(function (m) { if (m && m.mega === "basculer") basculer(); });
  } catch (e) {}
})(typeof globalThis !== "undefined" ? globalThis : this);
