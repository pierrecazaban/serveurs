// Gestes de l'envoi dans Gmail : la même interface que PP.Outlook (ouvrir une rédaction,
// remplir « À » ou « Cci », l'objet, le corps, envoyer), pour que le moteur d'envoi
// (packs, « jamais deux fois », suivi) marche tel quel dans Gmail. Chargé seulement sur
// mail.google.com, avant moteur.js.
//
// Mêmes principes de prudence que pour Outlook : on vérifie chaque destinataire validé,
// le texte et chaque lien du message avant d'envoyer ; après « Envoyer », on distingue
// « envoyé », « rien n'est parti » et « à vérifier » (jamais renvoyé tout seul).
// Gmail n'a pas d'« importance haute » : l'option est ignorée sans bloquer l'envoi.

(function (root) {
  "use strict";
  var PP = (root.PP = root.PP || {});
  var MAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;

  // Pages de test : <html data-pp-test="rapide"> divise toutes les attentes par 100.
  function facteur() {
    try { return document.documentElement.dataset.ppTest === "rapide" ? 0.01 : 1; } catch (e) { return 1; }
  }
  function attendre(ms) {
    var d = Math.max(1, ms * facteur());
    if (G.surAttente && ms >= 1500) { try { G.surAttente("Pause"); } catch (e) {} }
    return new Promise(function (r) { setTimeout(r, d); });
  }
  function hasard(min, max) { return min + Math.random() * (max - min); }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var s = root.getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }
  function premier(selecteurs, portee) {
    for (var i = 0; i < selecteurs.length; i++) {
      var l = (portee || document).querySelectorAll(selecteurs[i]);
      for (var j = l.length - 1; j >= 0; j--) if (visible(l[j])) return l[j];
    }
    return null;
  }
  function tous(selecteur, portee) { return [].slice.call((portee || document).querySelectorAll(selecteur)); }
  function normaliser(t) { return String(t || "").replace(/[\s ]+/g, " ").trim(); }
  function compact(t) { return String(t || "").replace(/[\s ​-‍⁠﻿]+/g, ""); }
  function sansBarre(h) { return String(h || "").replace(/\/+$/, "").toLowerCase(); }

  var SEL = {
    // (Gmail a retiré gh="cm" du bouton dans sa nouvelle présentation : la classe et le conteneur restent)
    nouveau: ['div[gh="cm"]', '.aic [role="button"]', '.T-I.T-I-KE.L3[role="button"]', '[role="button"][aria-label="Nouveau message"]',
              '[role="button"][aria-label="Compose"]'],
    objet: ['input[name="subjectbox"]'],
    a: ['div[name="to"] input[peoplekit-id]', 'div[name="to"] input', 'input[aria-label="To recipients"]', 'input[aria-label="À destinataires"]'],
    cci: ['div[name="bcc"] input[peoplekit-id]', 'div[name="bcc"] input', 'input[aria-label="Bcc recipients"]', 'input[aria-label="Cci destinataires"]'],
    lienCci: ['span[role="link"][data-tooltip*="Cci"]', 'span[role="link"][data-tooltip*="Bcc"]', 'span[role="link"][aria-label*="Cci"]',
              'span[role="link"][aria-label*="Bcc"]'],
    corps: ['div[aria-label="Corps du message"][contenteditable="true"]', 'div[aria-label="Message Body"][contenteditable="true"]',
            'div[role="textbox"][g_editable="true"]', 'div.Am.Al.editable'],
    envoyer: ['div[role="button"][data-tooltip^="Envoyer"]', 'div[role="button"][data-tooltip^="Send"]',
              'div[role="button"][aria-label^="Envoyer"]', 'div[role="button"][aria-label^="Send"]'],
    signature: ['div.gmail_signature', '[data-smartmail="signature"]']
  };

  var redaction = null;         // la fenêtre « Nouveau message » en cours
  var dernierMessage = "";      // texte compact du dernier message envoyé (garde-fou anti-reste)

  function dansRedaction(sel) { return redaction && redaction.isConnected ? premier(sel, redaction) : null; }
  // La fenêtre de rédaction : le plus proche conteneur qui a « À » ET le corps du message. Dans la
  // nouvelle présentation de Gmail, le <form> n'englobe plus le corps (ESCP, 13/11).
  function racineDe(objet) {
    for (var el = objet; el && el !== document.body; el = el.parentElement) {
      if (premier(SEL.a, el) && premier(SEL.corps, el)) return el;
    }
    return (objet.closest && (objet.closest('[role="dialog"]') || objet.closest(".M9") || objet.closest("form"))) || document.body;
  }
  function cliquer(el) {
    var r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, view: root, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) {
      try { var C = /^pointer/.test(t) && root.PointerEvent ? root.PointerEvent : root.MouseEvent; el.dispatchEvent(new C(t, o)); } catch (e) {}
    });
  }
  function taper(el, texte) {
    el.focus();
    var ok = false;
    try { ok = document.execCommand("insertText", false, texte); } catch (e) { ok = false; }
    // Repli seulement si la frappe a échoué : Gmail vide le champ en créant la pastille du
    // destinataire, un champ vide ne veut donc pas dire « rien n'a été tapé ».
    if (!ok) {
      var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      if (d && d.set) d.set.call(el, (el.value || "") + texte); else el.value = (el.value || "") + texte;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: texte }));
    }
  }
  function touche(el, key) {
    ["keydown", "keypress", "keyup"].forEach(function (t) {
      el.dispatchEvent(new KeyboardEvent(t, { key: key, code: key, bubbles: true, cancelable: true }));
    });
  }
  // Les destinataires validés (« pastilles ») d'un champ À ou Cci.
  // La ligne entière d'un champ (À ou Cci) : dans la nouvelle présentation, les pastilles sont dans
  // une liste à côté de div[name=…], plus dedans (ESCP, 13/11). On remonte tant qu'on ne contient
  // qu'un seul champ de saisie de destinataires.
  function ligneChamp(nom) {
    var z = redaction ? redaction.querySelector('div[name="' + nom + '"]') : null;
    if (!z) return null;
    var r = z;
    while (r.parentElement && r.parentElement !== redaction && r.parentElement.querySelectorAll("input[peoplekit-id]").length <= 1) r = r.parentElement;
    return r;
  }
  function pastilles(nom) {
    var zone = ligneChamp(nom);
    var p = tous("[data-hovercard-id], [email]", zone || redaction || document).filter(function (e) {
      // Les pastilles sont dans une liste à sélection multiple ; une suggestion du menu déroulant, non.
      var l = e.closest('[role="listbox"]');
      return !l || l.getAttribute("aria-multiselectable") === "true";
    });
    return p.map(function (e) { return String(e.getAttribute("data-hovercard-id") || e.getAttribute("email") || "").toLowerCase(); })
            .filter(function (a) { return MAIL.test(a); });
  }

  // Dernier recours : le bouton dont le texte est « Compose », « Nouveau message » ou « Écrire » (toutes langues courantes).
  function boutonParTexte() {
    return tous('[role="button"], button').filter(visible).filter(function (b) {
      return /^\s*(compose|nouveau message|écrire|redactar|scrivi|schreiben)\s*$/i.test(b.getAttribute("aria-label") || b.innerText || "");
    })[0] || null;
  }

  async function ouvrirRedaction() {
    var avant = tous(SEL.objet[0]).filter(visible).length;
    var bouton = premier(SEL.nouveau) || boutonParTexte();
    if (!bouton) return { ok: false, raison: "Bouton « Nouveau message » de Gmail introuvable : rien n'est envoyé." };
    cliquer(bouton);
    for (var i = 0; i < 60; i++) {
      await attendre(250);
      var objets = tous(SEL.objet[0]).filter(visible);
      if (objets.length > avant || (objets.length && i > 8)) {
        redaction = racineDe(objets[objets.length - 1]);
        if (premier(SEL.a, redaction) && premier(SEL.corps, redaction)) return { ok: true };
      }
    }
    return { ok: false, raison: "La fenêtre « Nouveau message » de Gmail ne s'est pas ouverte : rien n'est envoyé." };
  }

  async function remplirChamp(nom, selecteurs, adresses) {
    var champ = dansRedaction(selecteurs);
    if (!champ) return { ok: false, raison: "Champ « " + (nom === "to" ? "À" : "Cci") + " » introuvable dans Gmail : rien n'est envoyé." };
    // Nouvelle présentation de Gmail (13/11) : les frappes simulées sont ignorées. Le serveur, qui pilote
    // le navigateur, colle la liste avec un vrai Ctrl+V (toutes les pastilles d'un coup). Sans réponse
    // du serveur (page de test), on revient à la frappe adresse par adresse.
    var voulues = adresses.map(function (x) { return x.toLowerCase(); });
    var toutes = function () { var v = pastilles(nom); return voulues.every(function (x) { return v.indexOf(x) >= 0; }); };
    var jeton = "c" + Date.now() + Math.random().toString(36).slice(2, 7), racine = document.documentElement;
    champ.setAttribute("data-pp-cible", jeton);
    racine.setAttribute("data-pp-texte", adresses.join(", ") + ", ");
    racine.setAttribute("data-pp-coller", jeton);
    for (var w = 0; w < 80 && !toutes() && racine.getAttribute("data-pp-colle") !== jeton; w++) await attendre(250);
    for (var w2 = 0; w2 < 40 && !toutes() && racine.getAttribute("data-pp-colle") === jeton; w2++) await attendre(250);
    racine.removeAttribute("data-pp-coller"); racine.removeAttribute("data-pp-texte"); champ.removeAttribute("data-pp-cible");
    var dejaLa = pastilles(nom);
    adresses = adresses.filter(function (x) { return dejaLa.indexOf(x.toLowerCase()) < 0; });
    for (var i = 0; i < adresses.length; i++) {
      // La virgule valide l'adresse TAPÉE ; « Entrée » choisirait la suggestion en surbrillance
      // (un autre contact, parfois) : seulement en dernier recours.
      taper(champ, adresses[i] + ",");
      var cible = adresses[i].toLowerCase();
      var ok = function () { return pastilles(nom).indexOf(cible) >= 0; };
      // Gmail peut mettre quelques secondes à transformer l'adresse en pastille (13/11) : on surveille.
      for (var k = 0; k < 12 && !ok(); k++) await attendre(250);
      if (!ok()) { touche(champ, "Enter"); for (var k2 = 0; k2 < 16 && !ok(); k2++) await attendre(250); }
    }
    champ.blur && champ.blur();
    await attendre(400);
    var vus = pastilles(nom);
    adresses = voulues;
    var manquants = adresses.filter(function (a) { return vus.indexOf(a.toLowerCase()) < 0; });
    if (manquants.length) return { ok: false, raison: "Gmail n'a pas validé le destinataire " + manquants[0] + " : rien n'est envoyé." };
    var autres = vus.filter(function (a) { return adresses.map(function (x) { return x.toLowerCase(); }).indexOf(a) < 0; });
    if (autres.length) return { ok: false, raison: "Un destinataire inattendu est apparu (" + autres[0] + ") : rien n'est envoyé." };
    if (vus.length !== adresses.length) return { ok: false, raison: "Gmail montre " + vus.length + " destinataire(s) au lieu de " + adresses.length + " (doublon ?) : rien n'est envoyé." };
    return { ok: true };
  }
  function remplirA(adresse) { return remplirChamp("to", SEL.a, [adresse]); }
  async function remplirCci(liste) {
    if (!dansRedaction(SEL.cci)) {
      var lien = dansRedaction(SEL.lienCci);
      if (lien) { cliquer(lien); await attendre(500); }
    }
    return remplirChamp("bcc", SEL.cci, liste);
  }

  async function remplirObjet(objet) {
    var champ = dansRedaction(SEL.objet);
    if (!champ) return { ok: false, raison: "Champ « Objet » introuvable dans Gmail." };
    champ.focus();
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(champ), "value");
    if (d && d.set) d.set.call(champ, objet); else champ.value = objet;
    champ.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: objet }));
    champ.dispatchEvent(new Event("change", { bubbles: true }));
    await attendre(200);
    if (normaliser(champ.value) !== normaliser(objet)) return { ok: false, raison: "L'objet n'a pas pu être écrit dans Gmail : rien n'est envoyé." };
    return { ok: true };
  }

  async function remplirCorps(html, options) {
    var M = PP.Message;
    var champ = dansRedaction(SEL.corps);
    if (!champ) return { ok: false, raison: "Corps du message introuvable dans Gmail." };
    var propre = M.nettoyer(html), brut = M.texteBrut(propre);
    if (dernierMessage && compact(champ.textContent).indexOf(dernierMessage) >= 0)
      return { ok: false, raison: "Le nouveau message contient déjà le texte d'un message précédent : rien n'est envoyé." };
    var avant = normaliser(champ.textContent);
    champ.focus();
    var sel = root.getSelection(), r = document.createRange();
    r.setStart(champ, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    var ok = false;
    try { ok = document.execCommand("insertHTML", false, propre); } catch (e) { ok = false; }
    if (!ok) {  // repli : collage simulé (text/html)
      try {
        var dt = new DataTransfer(); dt.setData("text/html", propre); dt.setData("text/plain", brut);
        champ.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) {}
    }
    await attendre(hasard(400, 900));
    var ajoute = normaliser(champ.textContent).length - avant.length, attendu = normaliser(brut).length;
    if (ajoute > attendu + Math.max(40, attendu * 0.2)) return { ok: false, raison: "Le mail contient plus de texte que le message prévu : rien n'est envoyé." };
    var premiere = normaliser(brut.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || "").slice(0, 30);
    if (premiere && normaliser(champ.textContent).indexOf(premiere) < 0) return { ok: false, raison: "Le texte n'apparaît pas dans le corps du message Gmail." };
    var presents = tous("a[href]", champ).map(function (a) { return sansBarre(a.getAttribute("href")); });
    var manquants = M.liens(propre).filter(function (l) { return presents.indexOf(sansBarre(l.href)) < 0; });
    if (manquants.length) return { ok: false, raison: "Lien absent du mail : " + manquants[0].href };
    G._prevu = compact(brut);
    if (options && options.sansTexteSignature) return retirerTexteSignature();
    return { ok: true };
  }

  function retirerTexteSignature() {
    var s = dansRedaction(SEL.signature);
    if (s) {
      var noeuds = [], w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) noeuds.push(w.currentNode);
      noeuds.forEach(function (n) { n.nodeValue = ""; });
    }
    return { ok: true };
  }

  // Gmail n'a pas d'« importance haute » : on continue sans elle.
  async function importanceHaute() { return { ok: true, ignore: true }; }

  function texteAlerte() {
    return tous('[role="alert"], [role="alertdialog"], .vh, .bAq').filter(visible).map(function (e) { return normaliser(e.textContent); }).join(" ");
  }

  async function envoyer() {
    if (!redaction || !redaction.isConnected) return { ok: false, envoye: false, raison: "La rédaction a disparu avant l'envoi : rien n'est parti." };
    var bouton = dansRedaction(SEL.envoyer);
    if (!bouton) return { ok: false, envoye: false, raison: "Bouton « Envoyer » introuvable dans Gmail : rien n'est envoyé." };
    if (bouton.getAttribute("aria-disabled") === "true") return { ok: false, envoye: false, raison: "Gmail a désactivé « Envoyer » : rien n'est envoyé." };
    if (root.navigator && root.navigator.onLine === false) return { ok: false, envoye: false, raison: "Hors connexion : rien n'est envoyé." };
    var fenetre = redaction;
    cliquer(bouton);
    for (var i = 0; i < 80; i++) {
      await attendre(250);
      var alerte = texteAlerte();
      if (/envoy[ée]|message sent|\bsent\b/i.test(alerte)) { dernierMessage = G._prevu || ""; redaction = null; return { ok: true }; }
      if (!fenetre.isConnected || !visible(fenetre.querySelector(SEL.objet[0]) || fenetre)) {
        if (/erreur|error|impossible|échec|failed/i.test(alerte)) return { ok: false, envoye: null, raison: "Gmail signale un problème après « Envoyer » (« " + alerte.slice(0, 80) + " ») : à vérifier." };
        if (i > 12) { dernierMessage = G._prevu || ""; redaction = null; return { ok: true }; }  // fenêtre fermée sans erreur : parti
      } else if (/destinataire|recipient|adresse|address/i.test(alerte)) {
        return { ok: false, envoye: false, raison: "Gmail refuse l'envoi (« " + alerte.slice(0, 80) + " ») : rien n'est parti." };
      }
    }
    return { ok: false, envoye: null, raison: "Après « Envoyer », la fenêtre de Gmail est restée ouverte : à vérifier dans « Messages envoyés »." };
  }

  function diagnostic() {
    return { messagerie: "gmail", redaction: !!(redaction && redaction.isConnected), nouveau: !!premier(SEL.nouveau),
             a: !!premier(SEL.a), objet: !!premier(SEL.objet), corps: !!premier(SEL.corps), envoyer: !!premier(SEL.envoyer) };
  }

  var G = {
    surAttente: null,
    MAIL: MAIL,
    attendre: attendre,
    hasard: hasard,
    redactionOuverte: function () { return !!premier(SEL.objet); },
    champA: function () { return premier(SEL.a); },
    ouvrirRedaction: ouvrirRedaction,
    remplirA: remplirA,
    remplirCci: remplirCci,
    remplirObjet: remplirObjet,
    remplirCorps: remplirCorps,
    retirerTexteSignature: retirerTexteSignature,
    importanceHaute: importanceHaute,
    envoyer: envoyer,
    diagnostic: diagnostic
  };
  PP.Gmail = G;
  PP.Outlook = G;  // le moteur et le panneau s'adressent à « PP.Outlook » : dans Gmail, ce sont ces gestes-ci
})(typeof globalThis !== "undefined" ? globalThis : this);
