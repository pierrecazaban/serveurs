// Smart Mail. Connexion → objectif → analyse de l'annuaire (rien n'est montré) →
// les étudiants arrivent jusqu'à l'objectif → message et paramètres → envoi.
// Tout est enregistré dans le compte : on reprend sur n'importe quel appareil.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var CLE = "smartmail";
  // Écran de la console d'administration : l'application d'un ambassadeur, ouverte par un
  // administrateur avec une session à part, donnée par la console. Jamais la session de cet
  // appareil ni son cookie ; rien n'est gardé sur l'appareil.
  var CONSOLE = /[?&]console=1(&|$)/.test(location.search), JETON_CONSOLE = "";
  if (CONSOLE) {
    var mj = /[#&]jeton=([^&]+)/.exec(location.hash);
    JETON_CONSOLE = mj ? decodeURIComponent(mj[1]) : "";
    history.replaceState(null, "", location.pathname + location.search);
    document.documentElement.classList.add("mode-console");
  }
  function consoleExpiree() {
    if (!document.querySelector(".console-expiree")) {
      var d = document.createElement("div"); d.className = "console-expiree";
      d.textContent = "Cet écran n'est plus ouvert (session de la console fermée ou expirée). Il se rouvre tout seul…";
      document.body.appendChild(d);
    }
    try { window.parent.postMessage({ smartmail: "ecran-expire" }, location.origin); } catch (e) {}
  }
  // Envoi par packs : « pack » mails (un par élève), puis « attente » minutes de pause.
  var DEFAUT_ENVOI = { pack: 2, attente: 70, destinataires: 495, max_jour: 9995, heure_debut: 8, heure_fin: 20, taille_pack: 1, preset: "packs",
                       limites: { nom: "Microsoft", destinataires: 495, max_jour: 9995 } };
  var etat = {
    config: { demo: false }, code: "", compte: "", nom: "", role: "ambassadeur", outlook: null,
    objectif: 500, logique: null, resume: "", trouves: [], vus: new Set(), aEnregistrer: [],
    ecartes: 0, pause: false, enCours: false, fini: false, depart: 0, pageDepart: 0,
    tampon: [], // résultats triés pas encore affichés (repris après une pause)
    parametres: Object.assign({}, DEFAUT_ENVOI), retourParametres: "objectif"
  };

  function sauverLocal() { if (CONSOLE) return; try { localStorage.setItem(CLE, JSON.stringify({ code: etat.code })); } catch (e) {} }
  function chargerLocal() {
    if (CONSOLE) { etat.code = JETON_CONSOLE; return; }
    try { etat.code = (JSON.parse(localStorage.getItem(CLE) || "{}").code) || ""; } catch (e) {}
  }
  function nb(n) { return Number(n).toLocaleString("fr-FR"); }
  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var ETAPE = { connexion: 0, objectif: 1, lancement: 1, recolte: 1, envoi: 2, envoye: 3 };
  function ecran(nom) {
    etat.ecranVu = nom;  // l'écran affiché, quel qu'il soit (l'administration n'est pas une étape)
    document.querySelectorAll(".ecran").forEach(function (e) { e.hidden = e.id !== "e-" + nom; });
    if (nom in ETAPE) {
      var n = ETAPE[nom];
      document.body.dataset.etape = String(n);
      document.querySelectorAll(".etapes-nav li").forEach(function (li) {
        var k = Number(li.dataset.n);
        li.classList.toggle("active", k === n);
        li.classList.toggle("faite", k < n);
      });
      etat.ecranCourant = nom;
    }
    document.body.classList.toggle("navigable", !etat.config.demo && !!etat.code);
    // Barre d'étapes : seulement pendant le parcours (pas sur la connexion, les paramètres, l'administration).
    document.body.classList.toggle("hors-parcours", !(nom in ETAPE) || nom === "connexion");
    var connecte = nom !== "connexion";
    $("compte-barre").textContent = connecte ? etat.compte : "";
    $("ouvrir-parametres").hidden = true;  // plus de paramètres côté ambassadeur
    $("ouvrir-admin").hidden = !connecte || etat.role !== "administrateur" || nom === "admin";
    if (connecte && etat.role === "administrateur" && !etat.config.demo && !CONSOLE) surveillerAlertes();
    $("ouvrir-test").hidden = !connecte || !!etat.config.demo;
    window.scrollTo(0, 0);
  }

  // Deux serveurs (22/11). Le site envoie /tool vers l'un ou l'autre d'après le cookie « sm_srv » de
  // l'appareil. Un appareil qui a une session reste sur son serveur ; un appareil sans session va sur
  // celui des nouveaux comptes. Si une connexion aboutit sur le mauvais serveur, celui-ci le dit
  // (« [serveur:nom] … ») et l'appareil change de serveur.
  function serveurAppareil() { var m = /(?:^|; )sm_srv=([a-z]+)/.exec(document.cookie); return m ? m[1] : ""; }
  function noterServeur(nom) {
    document.cookie = "sm_srv=" + nom + "; path=/; max-age=" + 400 * 86400 + "; samesite=lax" + (location.protocol === "https:" ? "; secure" : "");
  }
  var RE_SERVEUR = /^\[serveur:([a-z]+)\]\s*/;
  function changerServeur(message) {
    var m = RE_SERVEUR.exec(message || "");
    if (!m || !BASE || CONSOLE) return false;
    etat.code = ""; sauverLocal();
    noterServeur(m[1]);
    setTimeout(function () { location.reload(); }, 2500);
    return true;
  }

  // Espace ambassadeur sur le site (23/11) : venu de /login (« Continuer avec mon école ») ou bouton après programmation.
  try { if (new URLSearchParams(location.search).get("espace")) sessionStorage.setItem("sm-espace", "1"); } catch (e) {}
  async function versEspace() {
    try {
      var r = await api("/v1/site/jeton");
      location.href = "https://the-ai-certification.com/api/smartmail/sso?t=" + encodeURIComponent(r.t);
    } catch (e) { var x = $("s-espace-erreur") || $("s-erreur"); if (x) x.textContent = e.message || "Impossible d'ouvrir votre espace."; }
  }
  async function api(chemin, corps, methode) {
    var r = await fetch(BASE + chemin, {
      credentials: "same-origin",
      method: methode || (corps ? "POST" : "GET"),
      headers: Object.assign({ "Content-Type": "application/json", "X-Base": BASE }, etat.code ? { Authorization: "Bearer " + etat.code } : {}),
      body: corps ? JSON.stringify(corps) : undefined
    });
    if (!r.ok) {
      var detail = ""; try { var j = await r.json(); detail = typeof j.detail === "string" ? j.detail : ""; } catch (e) {}
      if (changerServeur(detail)) detail = detail.replace(RE_SERVEUR, "");
      var err = new Error(detail || ("Erreur " + r.status)); err.statut = r.status; throw err;
    }
    return r.json();
  }

  // ------------------------------------------------------------ connexion
  $("form-demo").onsubmit = async function (ev) {
    ev.preventDefault();
    var bouton = this.querySelector("button"); bouton.disabled = true;
    try {
      var s = await api("/demo/session", { email: $("email-demo").value.trim() });
      etat.code = s.code; sauverLocal();
      await ouvrirCompte();
    } catch (e) { alert("Connexion impossible : " + e.message); }
    bouton.disabled = false;
  };

  // Connexion avec Outlook : la vraie page de connexion Microsoft, ouverte dans le
  // navigateur du serveur et affichée ici en direct. On touche et on tape comme sur
  // outlook.office.com ; le serveur garde ensuite la session Outlook.
  var dx = { id: "", ws: null, vw: 0, vh: 0, fini: false, ouvert: false, depart: null, glisse: 0, champ: null };
  function attenteDirect(texte, rond, reessayer) {
    $("direct-attente").hidden = !texte;
    $("direct-attente-texte").textContent = texte || "";
    $("direct-rond").hidden = !rond;
    $("direct-reessayer").hidden = !reessayer;
  }
  function envoyerDirect(m) { if (dx.ws && dx.ws.readyState === 1) dx.ws.send(JSON.stringify(m)); }
  async function ouvrirDirect(messagerie) {
    messagerie = messagerie === "gmail" ? "gmail" : "outlook";
    dx.messagerie = messagerie;
    var nom = messagerie === "gmail" ? "Google" : "Microsoft";
    $("connexion-erreur").hidden = true;
    $("direct").hidden = false; dx.ouvert = true; dx.fini = false;
    $("direct-nom").textContent = "Connexion " + nom;
    $("direct-ecran").removeAttribute("src");
    attenteDirect("Ouverture de la page " + nom + "…", true, false);
    var zone = $("direct-zone");
    try {
      var r = await api("/v1/direct", { largeur: Math.max(280, Math.min(1600, zone.clientWidth)), hauteur: Math.max(360, Math.min(1400, zone.clientHeight)),
                                        dpr: Math.min(2, window.devicePixelRatio || 1), messagerie: messagerie });
      dx.id = r.id; brancherDirect();
    } catch (e) { attenteDirect(e.message, false, true); }
  }
  function brancherDirect() {
    if (!dx.ouvert || dx.fini || !dx.id) return;
    if (dx.ws && dx.ws.readyState <= 1) return;
    var ws = new WebSocket((BASE ? (etat.config.ws || "wss://158-69-232-131.sslip.io") : (location.protocol === "https:" ? "wss://" : "ws://") + location.host) + "/v1/direct/" + encodeURIComponent(dx.id) + "/flux");
    dx.ws = ws;
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "image") {
        dx.vw = m.w; dx.vh = m.h;
        $("direct-ecran").src = "data:image/jpeg;base64," + m.d;
        if (dx.champ) placerChampDirect();
        if ($("direct-rond").hidden === false && $("direct-attente-texte").textContent.indexOf("Ouverture de la page") === 0) attenteDirect("");
      } else if (m.t === "clavier") {
        clavierDirect(m.champ);
      } else if (m.t === "etat") {
        if (m.etat === "reussie") terminerDirect();
        else if (m.etat === "echec") {
          dx.fini = true;
          var autre = changerServeur(m.message);  // compte sur l'autre serveur : la page se recharge là-bas
          attenteDirect((m.message || "Connexion impossible.").replace(RE_SERVEUR, ""), autre, !autre); $("direct-saisie").blur();
        }
        else if (m.message) attenteDirect(m.message, true, false);
      }
    };
    ws.onclose = function () { if (dx.ouvert && !dx.fini) setTimeout(brancherDirect, 1200); }; // Authenticator, réseau : on se rebranche
  }
  async function terminerDirect() {
    if (dx.fini) return;
    dx.fini = true;
    attenteDirect("Connexion réussie. Ouverture de Smart Mail…", true, false);
    $("direct-saisie").blur();
    try {
      var r = await api("/v1/direct/" + encodeURIComponent(dx.id) + "/terminer", {});
      etat.code = r.code; sauverLocal();
      fermerDirect(false);
      await ouvrirCompte();
    } catch (e) { attenteDirect(e.message, false, true); }
  }
  function fermerDirect(annuler) {
    var id = dx.id;
    dx.ouvert = false; dx.id = "";
    if (dx.ws) { try { dx.ws.close(); } catch (e) {} dx.ws = null; }
    if (annuler && id && !dx.fini) api("/v1/direct/" + encodeURIComponent(id), null, "DELETE").catch(function () {});
    $("direct-saisie").blur();
    $("direct-champ").hidden = true; $("direct-texte").value = ""; dx.champ = null; clearTimeout(dx.envoi);
    $("direct").hidden = true;
  }
  // Champ actif dans la page Microsoft / Google : un VRAI champ est posé exactement par-dessus (même place,
  // même taille). On tape, colle ou remplit avec le trousseau dedans, comme sur un site normal ; son contenu
  // part dans la page au fil de la frappe, Entrée valide (17/11 : fini la barre de saisie en bas).
  function placerChampDirect() {
    var c = dx.champ, f = $("direct-champ"), img = $("direct-ecran"), zone = $("direct-zone");
    if (!c || !dx.vw || !c.l || !c.h) { f.hidden = true; return; }
    var r = img.getBoundingClientRect(), z = zone.getBoundingClientRect();
    var e = Math.min(r.width / dx.vw, r.height / dx.vh);
    var ox = r.left - z.left + (r.width - dx.vw * e) / 2, oy = r.top - z.top + (r.height - dx.vh * e) / 2;
    var bord = Math.max(1, Math.round(2 * e)); // la ligne du bas du champ de la page reste visible
    var l = Math.max(40, c.l * e - 2 * bord), h = Math.max(24, c.h * e - 2 * bord);
    f.style.left = (ox + c.x * e + bord) + "px"; f.style.width = l + "px"; f.style.height = h + "px";
    f.style.top = (oy + c.y * e + c.h * e / 2 - h / 2) + "px"; // centré sur le champ de la page
    var t = $("direct-texte");
    t.style.fontSize = Math.max(16, c.fs * e) + "px"; // 16 px : sinon l'iPhone zoome
    t.style.padding = "0 " + Math.max(4, (c.pg || 0) * e - bord) + "px";
    f.hidden = false;
  }
  function clavierDirect(champ) {
    var f = $("direct-champ"), t = $("direct-texte");
    var nouveau = !dx.champ || !champ || dx.champ.id !== champ.id;
    dx.champ = champ;
    if (!champ) $("direct-saisie").blur();
    if (!champ) { envoyerChampDirect(true); f.hidden = true; t.blur(); return; }
    var type = champ.type === "password" ? "password" : champ.type === "email" ? "email" : (champ.type === "tel" || champ.type === "number") ? "tel" : "text";
    var code = champ.auto === "one-time-code" || type === "tel";
    if (nouveau) {
      clearTimeout(dx.envoi); dx.envoye = null;
      if (t.type !== type) t.type = type;
      t.setAttribute("autocomplete", type === "password" ? "current-password" : type === "email" ? "username" : code ? "one-time-code" : "off");
      t.setAttribute("inputmode", type === "email" ? "email" : code ? "numeric" : "text");
      t.value = champ.valeur || ""; dx.envoye = t.value;
    }
    placerChampDirect();
    if (nouveau) { t.focus(); $("direct-saisie").blur(); } // ordinateur : on tape tout de suite ; iPhone : le clavier s'ouvre au toucher du champ
  }
  // Ce qui est tapé part dans la page (légèrement groupé), et toujours avant un clic ou Entrée.
  function envoyerChampDirect(maintenant, entree) {
    clearTimeout(dx.envoi);
    var t = $("direct-texte");
    var go = function () {
      if (!dx.champ) return;
      var v = t.value;
      if (dx.champ.type !== "password") v = v.replace(/[\r\n]+/g, "");
      if (v === dx.envoye && !entree) return;
      dx.envoye = v;
      envoyerDirect({ t: "remplir", s: v, entree: !!entree });
    };
    if (maintenant) go(); else dx.envoi = setTimeout(go, 120);
  }
  $("direct-texte").addEventListener("input", function () { envoyerChampDirect(false); });
  $("direct-texte").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); envoyerChampDirect(true, true); }
    else if (ev.key === "Tab") { ev.preventDefault(); envoyerChampDirect(true); envoyerDirect({ t: "touche", k: "Tab" }); }
  });
  window.addEventListener("resize", function () { if (dx.ouvert) placerChampDirect(); });
  // Toucher le champ posé : le clavier s'ouvre (geste natif), et le toucher part aussi dans la page,
  // au cas où elle a changé de champ entre-temps.
  $("direct-champ").addEventListener("pointerup", function (ev) {
    var p = versPage(ev);
    if (p) { envoyerChampDirect(true); envoyerDirect({ t: "clic", x: p.x, y: p.y }); }
  });
  function versPage(ev) {
    var r = $("direct-ecran").getBoundingClientRect();
    if (!dx.vw || !r.width) return null;
    var echelle = Math.min(r.width / dx.vw, r.height / dx.vh);
    var ox = (r.width - dx.vw * echelle) / 2, oy = (r.height - dx.vh * echelle) / 2;
    return { x: (ev.clientX - r.left - ox) / echelle, y: (ev.clientY - r.top - oy) / echelle };
  }
  var ecranDirect = $("direct-ecran");
  ecranDirect.addEventListener("pointerdown", function (ev) {
    dx.depart = { x: ev.clientX, y: ev.clientY, y0: ev.clientY, bouge: false };
    try { ecranDirect.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  ecranDirect.addEventListener("pointermove", function (ev) {
    if (!dx.depart) return;
    var dy = ev.clientY - dx.depart.y0;
    if (Math.abs(ev.clientY - dx.depart.y) > 10 || Math.abs(ev.clientX - dx.depart.x) > 10) dx.depart.bouge = true;
    if (dx.depart.bouge && Math.abs(dy) > 4) { envoyerDirect({ t: "defile", dy: -dy * 1.5 }); dx.depart.y0 = ev.clientY; }
  });
  ecranDirect.addEventListener("pointerup", function (ev) {
    var d = dx.depart; dx.depart = null;
    if (!d || d.bouge) return;
    var p = versPage(ev);
    if (!p) return;
    envoyerChampDirect(true); // ce qui est tapé arrive dans la page avant le clic (bouton « Suivant »)
    // iPhone : le clavier ne s'ouvre que pendant un toucher. On l'ouvre ici ; si la page a bien un champ à
    // cet endroit, le champ posé par-dessus prend la main aussitôt (sinon il se referme).
    if ($("direct-champ").hidden) $("direct-saisie").focus();
    envoyerDirect({ t: "clic", x: p.x, y: p.y });
  });
  ecranDirect.addEventListener("wheel", function (ev) { ev.preventDefault(); envoyerDirect({ t: "defile", dy: ev.deltaY }); }, { passive: false });
  var saisie = $("direct-saisie");
  saisie.addEventListener("beforeinput", function (ev) {
    var t = ev.inputType || "";
    if (t === "deleteContentBackward") { ev.preventDefault(); envoyerDirect({ t: "touche", k: "Backspace" }); }
    else if (t === "insertLineBreak" || t === "insertParagraph") { ev.preventDefault(); envoyerDirect({ t: "touche", k: "Enter" }); }
    else if (t.indexOf("insert") === 0) {
      var txt = ev.data || (ev.dataTransfer && ev.dataTransfer.getData("text/plain")) || "";
      // Un collage dont le navigateur ne donne pas encore le texte : on le laisse arriver dans le
      // champ, « paste » ou « input » l'envoient (sinon il était perdu, 14/11).
      if (!txt) return;
      ev.preventDefault();
      envoyerDirect({ t: "texte", s: t === "insertFromPaste" ? nettoyerColle(txt) : txt });
    }
  });
  // Coller (Ctrl+V, Cmd+V, menu « Coller ») : l'adresse ou le mot de passe copié part d'un coup.
  function nettoyerColle(txt) { return String(txt).replace(/[\r\n]+/g, "").trim(); }
  function collerDirect(txt) {
    txt = nettoyerColle(txt || "");
    if (txt) envoyerDirect({ t: "texte", s: txt });
  }
  saisie.addEventListener("paste", function (ev) {
    var txt = ev.clipboardData && ev.clipboardData.getData("text/plain");
    if (!txt) return;
    ev.preventDefault();
    collerDirect(txt);
  });
  document.addEventListener("paste", function (ev) {
    if (!dx.ouvert || ev.target === saisie || ev.target === $("direct-texte")) return;
    var txt = ev.clipboardData && ev.clipboardData.getData("text/plain");
    if (!txt) return;
    ev.preventDefault();
    collerDirect(txt);
  });
  // Le bouton « Coller » (iPhone : pas de menu « Coller » sur l'image de la page) : lit le
  // presse-papiers ; si le navigateur refuse, une petite fenêtre où coller à la main.
  $("direct-coller").onclick = async function () {
    var txt = "";
    try { txt = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : ""; } catch (e) { txt = ""; }
    if (!txt) txt = window.prompt("Colle ici ton adresse ou ton mot de passe :") || "";
    if (!$("direct-champ").hidden) { $("direct-texte").value = nettoyerColle(txt); $("direct-texte").focus(); envoyerChampDirect(true); return; }
    collerDirect(txt);
  };
  // Remplissage automatique (trousseau) ou navigateur sans « beforeinput » : on envoie ce qui est arrivé.
  saisie.addEventListener("input", function (ev) { if (saisie.value) { var v = saisie.value; saisie.value = ""; envoyerDirect({ t: "texte", s: ev && ev.inputType === "insertFromPaste" ? nettoyerColle(v) : v }); } });
  saisie.addEventListener("keydown", function (ev) {
    // Touches spéciales traitées ici, une seule fois (le champ invisible reste vide :
    // sur iPhone, « effacer » n'y produit pas toujours d'autre événement).
    var k = { Enter: "Enter", Tab: "Tab", Backspace: "Backspace", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Escape: "Escape" }[ev.key];
    if (k && !ev.isComposing) { ev.preventDefault(); envoyerDirect({ t: "touche", k: k }); }
  });
  $("connexion-outlook").onclick = function () { ouvrirDirect("outlook"); };
  $("connexion-gmail").onclick = function () { ouvrirDirect("gmail"); };
  // Connexion universelle (16/11) : toute autre messagerie d'école, par adresse + mot de passe (IMAP/SMTP).
  $("connexion-universelle").onclick = function () {
    var f = $("form-universel"); f.hidden = !f.hidden;
    if (!f.hidden) $("univ-email").focus();
  };
  $("form-universel").onsubmit = async function (ev) {
    ev.preventDefault();
    var err = $("univ-erreur"), bouton = $("univ-valider");
    err.hidden = true; bouton.disabled = true; bouton.textContent = "Vérification auprès de votre école…";
    try {
      var r = await api("/v1/universel", { email: $("univ-email").value.trim(), mot_de_passe: $("univ-mdp").value,
                                           identifiant: $("univ-identifiant").value.trim() });
      $("univ-mdp").value = "";
      etat.code = r.code; sauverLocal();
      await ouvrirCompte();
    } catch (e) {
      err.textContent = e.message || "Connexion impossible."; err.hidden = false;
    } finally {
      bouton.disabled = false; bouton.textContent = "Se connecter";
    }
  };
  $("direct-fermer").onclick = function () { fermerDirect(true); };
  $("direct-reessayer").onclick = function () { fermerDirect(true); ouvrirDirect(dx.messagerie); };
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && dx.ouvert) brancherDirect(); });

  // Le compte : identité, destinataires déjà trouvés, recherche en cours, paramètres.
  async function ouvrirCompte() {
    var c = await api("/v1/compte");
    etat.compte = c.email || c.nom; etat.nom = c.nom; etat.role = c.role || "ambassadeur"; etat.outlook = c.outlook || null;
    etat.parametres = Object.assign({}, DEFAUT_ENVOI, c.parametres || {});
    etat.recherche = c.recherche; etat.nbEnregistres = c.destinataires; etat.nbRecus = c.recus || 0; etat.nbExtraits = c.extraits || 0;
    // Un administrateur ne collecte pas : il arrive sur la console, où il patrouille entre les
    // écrans des ambassadeurs (et agit dans chacun).
    if (etat.role === "administrateur" && !CONSOLE && !etat.config.demo) { location.replace(BASE + "/admin#ecrans"); return; }
    // Un ambassadeur ne voit que la date de son envoi : tout le reste se règle depuis la console.
    if (!CONSOLE && !etat.config.demo) { await voirSimple(); return; }
    if (etat.config.demo) versObjectif(); else await allerAuTravail();
    if (programmerDemande) { programmerDemande = false; voirMessage(true); }
  }

  // ------------------------------------------------------------ ambassadeur : la date de l'envoi
  function pourChamp(ts) {  // horodatage → valeur d'un champ datetime-local (heure de l'appareil)
    var d = new Date(ts * 1000), z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes());
  }
  function quandLisible(ts) {
    var d = new Date(ts * 1000);
    var j = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return j.charAt(0).toUpperCase() + j.slice(1) + " à " + d.getHours() + " h " + String(d.getMinutes()).padStart(2, "0");
  }
  function montrerSimple(v, modifier, anime) {
    v = v || {};
    var ok = !!v.debut && !modifier;
    $("s-choix").hidden = ok; $("s-ok").hidden = !ok; $("s-erreur").textContent = "";
    $("s-reconnecter").hidden = !v.reconnecter;
    if (ok) {
      try { if (sessionStorage.getItem("sm-espace")) { sessionStorage.removeItem("sm-espace"); versEspace(); } } catch (e) {}
      $("s-quand").textContent = "Envoi programmé : " + quandLisible(v.debut);
      var carte = $("s-ok"); carte.classList.remove("joue");
      if (anime) { void carte.offsetWidth; carte.classList.add("joue"); }
      carte.querySelectorAll(".s-anim *").forEach(function (x) { x.style.animation = anime ? "" : "none"; x.style.strokeDashoffset = anime ? "" : "0"; });
    }
    var demain = new Date(); demain.setDate(demain.getDate() + 1); demain.setHours(10, 0, 0, 0);
    $("s-date").value = pourChamp(v.debut || demain.getTime() / 1000);
    $("s-date").min = pourChamp(Date.now() / 1000 + 3600);
  }
  async function voirSimple() {
    document.body.classList.add("mode-simple");
    $("ouvrir-test").hidden = true;
    ecran("simple");
    etat.pilote = null;
    try { etat.pilote = await api("/v1/pilote"); } catch (e) {}
    montrerSimple(etat.pilote);
    // Toutes les 30 s : si la messagerie a fermé la session, « Reconnectez votre messagerie » s'affiche.
    clearInterval(etat.suiviSimple);
    etat.suiviSimple = setInterval(async function () {
      if (etat.ecranVu !== "simple" || document.visibilityState !== "visible") return;
      try { var v = await api("/v1/pilote"); $("s-reconnecter").hidden = !v.reconnecter; } catch (e) {}
    }, 30000);
  }
  var CONDITIONS_VERSION = "2026-11-13";  // conditions.html : à changer si le texte change
  $("s-programmer").onclick = async function () {
    var v = $("s-date").value, b = $("s-programmer");
    if (!v) { $("s-erreur").textContent = "Choisissez la date et l'heure de l'envoi."; return; }
    if (!$("s-cgu").checked) { $("s-erreur").textContent = "Cochez la case pour accepter les conditions d'utilisation."; return; }
    b.disabled = true;
    try {
      etat.pilote = await api("/v1/pilote", { debut: new Date(v).getTime() / 1000, conditions: CONDITIONS_VERSION });
      montrerSimple(etat.pilote, false, true);
    } catch (e) { $("s-erreur").textContent = e.message; }
    b.disabled = false;
  };
  $("s-cgu").onchange = function () { if (this.checked) $("s-erreur").textContent = ""; };
  $("s-reconnexion").onclick = function () { $("s-deconnexion").click(); };  // retour à la connexion Outlook / Gmail
  $("s-modifier").onclick = function () { montrerSimple(etat.pilote, true); };
  if ($("s-espace")) $("s-espace").onclick = versEspace;
  $("s-deconnexion").onclick = function () { $("deconnexion").click(); document.body.classList.remove("mode-simple"); };

  // ------------------------------------------------------------ objectif / reprise
  function versObjectif() {
    $("bonjour").textContent = "Connecté en tant que " + etat.compte;
    var r = etat.recherche, n = etat.nbEnregistres || 0;
    $("reprise").hidden = !(r || n);
    if (r || n) {
      var obj = r ? r.objectif : n;
      $("reprise-texte").textContent = nb(n) + " étudiants identifiés" + (r ? " sur un objectif de " + nb(obj) : "") +
        (n >= obj ? ". Objectif atteint." : ".");
      $("reprendre").textContent = !etat.config.demo ? "Voir la collecte" : n >= obj ? "Voir les destinataires" : "Reprendre";
      $("objectif").value = obj;
    } else {
      $("objectif").value = etat.objectif;
    }
    majPuces();
    ecran("objectif");
  }
  function lireObjectif() {
    var v = parseInt($("objectif").value, 10);
    if (!isFinite(v)) v = 500;
    return Math.max(10, v);  // sans limite haute : 60 000, 200 000…
  }
  function majPuces() {
    var v = lireObjectif();
    document.querySelectorAll("#raccourcis .puce").forEach(function (p) { p.classList.toggle("actif", Number(p.dataset.v) === v); });
  }
  $("objectif").addEventListener("input", majPuces);
  $("moins").onclick = function () { $("objectif").value = Math.max(10, lireObjectif() - (lireObjectif() > 1000 ? 500 : 50)); majPuces(); };
  $("plus").onclick = function () { $("objectif").value = lireObjectif() + (lireObjectif() >= 1000 ? 500 : 50); majPuces(); };  // sans limite
  document.querySelectorAll("#raccourcis .puce").forEach(function (p) { p.onclick = function () { $("objectif").value = p.dataset.v; majPuces(); }; });

  function erreur(e) {
    if (e.statut === 401) { etat.code = ""; sauverLocal(); retrouverSession(); return; }
    alert(e.statut ? "Une erreur est survenue : " + e.message : "Pas de connexion au serveur. Vérifiez votre réseau et réessayez.");
    versObjectif();
  }

  $("start").onclick = function () {
    if (etat.nbEnregistres && !confirm("Une nouvelle recherche remplace les " + nb(etat.nbEnregistres) + " destinataires déjà identifiés. Continuer ?")) return;
    nouvelleRecherche().catch(erreur);
  };
  $("nouvelle").onclick = function () { $("reprise").hidden = true; etat.recherche = null; $("objectif").focus(); };
  $("reprendre").onclick = function () { reprendre().catch(erreur); };

  function remiseAZero() {
    etat.trouves = []; etat.vus = new Set(); etat.aEnregistrer = []; etat.ecartes = 0; etat.depart = 0; etat.pageDepart = 0;
    etat.logique = null; etat.resume = ""; etat.pause = false; etat.fini = false; etat.tampon = [];
    $("liste").textContent = "";
  }

  async function nouvelleRecherche() {
    etat.objectif = lireObjectif();
    remiseAZero();
    await api("/v1/destinataires", null, "DELETE");
    etat.nbEnregistres = 0; etat.recherche = null;
    await lancer();
  }

  // Reprise (même sur un autre appareil) : liste et logique relues depuis le compte.
  async function reprendre() {
    remiseAZero();
    var r = etat.recherche || {};
    etat.objectif = r.objectif || lireObjectif();
    etat.depart = r.depart == null ? 0 : r.depart; etat.fini = !!r.fini || r.depart == null; etat.ecartes = r.ecartes || 0;
    etat.logique = r.logique || null; etat.resume = r.resume || "";
    for (var d = 0; ; d += 2000) {
      var l = await api("/v1/destinataires?depart=" + d + "&taille=2000");
      l.personnes.forEach(function (p) { etat.trouves.push(p); etat.vus.add(p.adresse); });
      if (l.personnes.length < 2000) break;
    }
    etat.trouves.slice(-300).forEach(function (p) { ajouter(p, p.source, true); });
    if (!etat.logique && etat.trouves.length < etat.objectif) { await lancer(); return; }
    entrerRecolte();
    await recolter();
  }

  // ------------------------------------------------------------ source des contacts
  // Démonstration : faux annuaire du serveur. Version réelle : annuaire Microsoft (Graph).
  var ECOLE = new URLSearchParams(location.search).get("ecole") || "prenom-nom"; // démo : école fictive
  function pageAnnuaire(depart, taille) {
    if (!etat.config.demo) {
      var e = new Error("La lecture de l'annuaire par le serveur n'est pas encore disponible. Votre session Outlook est bien gardée sur le serveur.");
      return Promise.reject(e);
    }
    return api("/demo/annuaire?depart=" + depart + "&taille=" + taille + "&ecole=" + encodeURIComponent(ECOLE));
  }

  // Échantillon d'environ 30 personnes, en privilégiant celles qui ont un intitulé
  // (poste, programme) : ce sont elles qui révèlent la logique de l'école.
  function echantillon(personnes) {
    var avec = personnes.filter(function (p) { return p.intitule; }), sans = personnes.filter(function (p) { return !p.intitule; });
    return avec.slice(0, 22).concat(sans.slice(0, 30 - Math.min(22, avec.length))).slice(0, 30);
  }

  // ------------------------------------------------------------ analyse
  function etape(n, classe) { document.querySelector('#etapes li[data-e="' + n + '"]').className = classe || ""; }

  async function lancer() {
    ecran("lancement");
    [1, 2, 3].forEach(function (n) { etape(n, ""); });
    var t0 = Date.now();
    etape(1, "encours");
    var premiere = await pageAnnuaire(0, 200);
    await dormir(Math.max(0, 900 - (Date.now() - t0)));
    etape(1, "fait"); etape(2, "encours");
    var t1 = Date.now();
    var appris = await api("/v1/logique", { echantillon: echantillon(premiere.personnes) });
    etat.logique = appris.logique; etat.resume = appris.resume || "";
    await dormir(Math.max(0, 1100 - (Date.now() - t1)));
    etape(2, "fait"); etape(3, "encours");
    await dormir(800);
    etape(3, "fait");
    await enregistrer();
    await dormir(350);
    entrerRecolte();
    await recolter();
  }

  function entrerRecolte() {
    $("logique-resume").textContent = etat.resume;
    $("objectif-rappel").textContent = nb(etat.objectif);
    majCompteurs();
    $("vers-envoi").hidden = true; $("pause").hidden = false; $("pause").textContent = "Mettre en pause";
    etat.pause = false;
    statut("Recherche en cours", true);
    ecran("recolte");
  }

  // ------------------------------------------------------------ recherche
  function statut(texte, actif) { $("statut-texte").textContent = texte; $("pouls").classList.toggle("arret", !actif); }
  function majCompteurs() { $("trouves").textContent = nb(etat.trouves.length); $("ecartes").textContent = nb(etat.ecartes); }
  var METHODE = { regle: "Règle", logique: "Format", ia: "IA", cache: "Mémoire", extrait: "Extrait", manuel: "Ajouté" };
  function ligneCollecte(p, calme) {
    var li = document.createElement("li"); if (!calme) li.className = "nouveau";
    var n = document.createElement("span"); n.className = "n"; n.textContent = p.nom || p.adresse.split("@")[0];
    var a = document.createElement("span"); a.className = "a"; a.textContent = p.adresse;
    var m = document.createElement("span"); m.className = "source"; m.textContent = METHODE[p.source] || "IA";
    li.appendChild(n); li.appendChild(a); li.appendChild(m);
    // Un élève gardé à tort : « Retirer » (il passe dans « Exclus », d'où l'on peut le rajouter).
    if (!etat.config.demo && p.source !== "extrait") {
      var b = document.createElement("button"); b.type = "button"; b.className = "lien btn-retirer"; b.textContent = "Retirer";
      b.setAttribute("aria-label", "Retirer " + (p.nom || p.adresse) + " de la liste");
      b.onclick = function () { retirerDeLaListe([p.adresse], b); };
      li.appendChild(b);
    }
    return li;
  }
  async function retirerDeLaListe(adresses, bouton) {
    bouton.disabled = true;
    try {
      var r = await api("/v1/destinataires/retirer", { adresses: adresses });
      adresses.forEach(function (a) {
        var e = L.lignes[a.toLowerCase()];
        if (!e) return;
        if (e.liC) e.liC.remove();
        if (e.liE) e.liE.remove();
        delete L.lignes[a.toLowerCase()];
      });
      L.affiches = Math.max(0, L.affiches - r.retires);  // la liste du serveur a raccourci d'autant
      $("ecartes").textContent = nb(r.exclus);
      compterParties();
      if (!r.retires) { bouton.disabled = false; alert("Cet élève a déjà reçu le message : il ne peut plus être retiré."); }
    } catch (e) { bouton.disabled = false; erreurAction(e); }
  }
  function ajouter(p, source, calme) {
    var li = ligneCollecte({ adresse: p.adresse, nom: p.nom, source: source }, calme);
    var l = $("liste"); l.insertBefore(li, l.firstChild);
    if (etat.config.demo) while (l.children.length > 300) l.removeChild(l.lastChild);
  }

  // Enregistre dans le compte les nouveaux destinataires et l'endroit où reprendre.
  async function enregistrer() {
    var lot = etat.aEnregistrer; etat.aEnregistrer = [];
    for (var k = 0; k < lot.length; k += 2000) await api("/v1/destinataires", { personnes: lot.slice(k, k + 2000) });
    etat.nbEnregistres = etat.trouves.length;
    etat.recherche = { objectif: etat.objectif, depart: etat.tampon.length ? etat.pageDepart : etat.depart, fini: etat.fini && !etat.tampon.length,
                       ecartes: etat.ecartes, logique: etat.logique, resume: etat.resume };
    await api("/v1/recherche", etat.recherche, "PUT");
  }

  async function recolter() {
    if (etat.enCours) return;
    etat.enCours = true;
    try {
      while (!etat.pause && etat.trouves.length < etat.objectif && (etat.tampon.length || !etat.fini)) {
        if (!etat.tampon.length) {
          etat.pageDepart = etat.depart;
          var page = await pageAnnuaire(etat.depart, 200);
          var parAdresse = {};
          page.personnes.forEach(function (p) { parAdresse[p.adresse.toLowerCase()] = p; });
          var r = await api("/v1/tri", { contacts: page.personnes, logique: etat.logique });
          etat.tampon = r.resultats.map(function (x) { return { x: x, p: parAdresse[x.adresse] || { adresse: x.adresse, nom: "" } }; });
          etat.depart = page.suivant == null ? null : page.suivant;
          if (page.suivant == null) etat.fini = true;
        }
        // Une adresse à la fois ; une suspension arrête net, le reste du paquet attend.
        var k = 0;
        while (etat.tampon.length && !etat.pause && etat.trouves.length < etat.objectif) {
          var e = etat.tampon.shift();
          if (e.x.groupe === "etudiant") {
            if (etat.vus.has(e.x.adresse)) continue; // déjà dans le compte (reprise)
            var p = { adresse: e.x.adresse, nom: e.p.nom || "", source: e.x.source };
            etat.vus.add(p.adresse); etat.trouves.push(p); etat.aEnregistrer.push(p);
            ajouter(p, p.source);
            majCompteurs();
            await dormir(etat.objectif > 1500 ? 4 : 18); // les adresses arrivent une à une
          } else {
            etat.ecartes++;
            if (++k % 10 === 0) majCompteurs();
          }
        }
        majCompteurs();
        await enregistrer();
      }
    } finally { etat.enCours = false; }
    if (etat.trouves.length >= etat.objectif) {
      statut("Objectif atteint", false); $("pause").hidden = true; $("vers-envoi").hidden = false;
    } else if (etat.fini && !etat.tampon.length) {
      statut("Annuaire entièrement parcouru — " + nb(etat.trouves.length) + " étudiants identifiés", false);
      $("pause").hidden = true; $("vers-envoi").hidden = !etat.trouves.length;
    }
  }

  $("pause").onclick = function () {
    etat.pause = !etat.pause;
    this.textContent = etat.pause ? "Reprendre" : "Mettre en pause";
    statut(etat.pause ? "En pause" : "Recherche en cours", !etat.pause);
    $("vers-envoi").hidden = !(etat.pause && etat.trouves.length);
    if (etat.pause) enregistrer().catch(function () {}); else recolter().catch(erreur);
  };

  // ------------------------------------------------------------ paramètres d'envoi (packs)
  var SECONDES_PAR_MAIL = 25, SECONDES_CCI = 35;  // un mail d'un pack (plus long avec des centaines de destinataires en Cci)
  function limites(p) { return (p && p.limites) || DEFAUT_ENVOI.limites; }
  function dpm(p) { return Math.max(1, p.destinataires || 1); }
  // Destinataires servis en une journée (comme le serveur), jamais plus que le maximum par jour.
  function capaciteJour(p) {
    var pack = p.pack || 2, attente = (p.attente || 70) * 60, plage = Math.max(1, p.heure_fin - p.heure_debut) * 3600;
    var parMail = SECONDES_PAR_MAIL + (dpm(p) > 1 ? SECONDES_CCI : 0);
    var packs = Math.max(1, Math.floor((plage + attente) / (pack * parMail + attente)));
    return Math.max(1, Math.min(p.max_jour || limites(p).max_jour, packs * pack * dpm(p)));
  }
  function duree(min) { return min < 60 ? min + " min" : Math.floor(min / 60) + " h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") : ""); }
  function texteMode(p) {
    p = p || etat.parametres;
    return dpm(p) > 1 ? "Jusqu'à " + nb(dpm(p)) + " élèves par mail, en Cci (aucun ne voit les autres)" : "Un mail par élève";
  }
  function texteRythme(p) {
    return "Packs de " + nb(p.pack) + " mail" + (p.pack > 1 ? "s" : "") + (dpm(p) > 1 ? " (jusqu'à " + nb(dpm(p)) + " destinataires chacun)" : "") +
      ", " + duree(p.attente) + " de pause entre deux packs";
  }
  function alertes(p) {
    var a = [], parPack = p.pack * dpm(p);
    if (parPack > 2000) a.push("Plus de 2 000 destinataires d'affilée : votre messagerie risque de bloquer l'envoi. Étalez avec des packs plus petits.");
    if (p.pack > 100) a.push("Plus de 100 mails d'affilée : votre messagerie risque de ralentir ou de bloquer l'envoi.");
    return a;
  }
  function borne(v, min, max, def) { v = parseInt(v, 10); return isFinite(v) ? Math.max(min, Math.min(max, v)) : def; }
  function remplirParametres(p) {
    var l = limites(p);
    $("p-pack").value = p.pack; $("p-attente").value = p.attente;
    $("p-dest").value = p.destinataires; $("p-dest").max = l.destinataires; $("p-max").value = p.max_jour; $("p-max").max = l.max_jour;
    $("p-dest-aide").textContent = nb(l.destinataires) + " au plus avec " + l.nom + ".";
    $("p-max-aide").textContent = nb(l.max_jour) + " au plus par jour avec " + l.nom + ".";
    $("p-debut").value = p.heure_debut; $("p-fin").value = p.heure_fin;
    majParametres();
  }
  function lireParametres() {
    var l = limites(etat.parametres);
    var p = Object.assign({}, etat.parametres, { pack: borne($("p-pack").value, 1, 500, 2), attente: borne($("p-attente").value, 1, 1440, 70),
              destinataires: borne($("p-dest").value, 1, l.destinataires, l.destinataires), max_jour: borne($("p-max").value, 1, l.max_jour, l.max_jour),
              heure_debut: borne($("p-debut").value, 0, 23, 8), heure_fin: borne($("p-fin").value, 1, 24, 20), taille_pack: 1, preset: "packs" });
    if (p.heure_fin <= p.heure_debut) p.heure_fin = Math.min(24, p.heure_debut + 1);
    return p;
  }
  function majParametres() {
    var p = lireParametres();
    $("capacite").textContent = texteRythme(p) + ". Environ " + nb(capaciteJour(p)) + " destinataires par jour (au plus " + nb(p.max_jour) + ").";
    var a = alertes(p);
    $("alerte-param").hidden = !a.length; $("alerte-param").textContent = a.join(" ");
  }
  ["p-pack", "p-attente", "p-dest", "p-max", "p-debut", "p-fin"].forEach(function (id) { $(id).addEventListener("input", majParametres); });

  // La carte « Envoi par packs » de l'écran Message : réglage direct, enregistré tout seul.
  var sauvePacks = null;
  function majPacks() {
    var p = etat.parametres, n = etat.config.demo ? etat.trouves.length : (etat.nbEnregistres || 0), l = limites(p);
    [["pk-pack", p.pack], ["pk-attente", p.attente], ["pk-dest", p.destinataires], ["pk-max", p.max_jour]].forEach(function (x) {
      if (document.activeElement !== $(x[0])) $(x[0]).value = x[1];
    });
    $("pk-dest").max = l.destinataires; $("pk-max").max = l.max_jour;
    $("pk-limites").textContent = "Avec " + l.nom + " : " + nb(l.destinataires) + " destinataires par mail et " + nb(l.max_jour) + " par jour au plus.";
    var cap = capaciteJour(p), jours = Math.ceil(n / Math.max(1, cap));
    $("pk-resume").textContent = nb(p.pack) + " mail" + (p.pack > 1 ? "s" : "") + (dpm(p) > 1 ? " de " + nb(dpm(p)) + " destinataires au plus" : "") + ", puis " + duree(p.attente) +
      " de pause. Environ " + nb(cap) + " destinataires par jour" +
      (n ? ". Vos " + nb(n) + " élèves : " + (jours <= 1 ? "terminé dans la journée." : "environ " + jours + " jours.") : ".");
    $("texte-mode").textContent = texteMode(p) + ", en importance élevée, depuis votre adresse. Ceux trouvés plus tard le recevront au prochain envoi, jamais deux fois.";
    $("pk-plage").textContent = p.heure_debut + " h à " + p.heure_fin + " h";
    var a = alertes(p); $("pk-alerte").hidden = !a.length; $("pk-alerte").textContent = a.join(" ");
    // Frise : trois packs et leurs pauses, à l'échelle du temps.
    var f = $("pk-frise"); f.textContent = "";
    for (var i = 0; i < 3; i++) {
      var b = document.createElement("span"); b.className = "pk-bloc"; b.style.flexGrow = String(p.pack * SECONDES_PAR_MAIL);
      b.textContent = nb(p.pack) + " × " + nb(dpm(p)); f.appendChild(b);
      if (i < 2) { var z = document.createElement("span"); z.className = "pk-pause"; z.style.flexGrow = String(p.attente * 60); z.textContent = duree(p.attente); f.appendChild(z); }
    }
  }
  var CHAMPS_PACKS = { "pk-pack": "pack", "pk-attente": "attente", "pk-dest": "destinataires", "pk-max": "max_jour" };
  function changerPacks(champs) {
    var p = etat.parametres, l = limites(p);
    var v = Object.assign({ pack: p.pack, attente: p.attente, destinataires: p.destinataires, max_jour: p.max_jour }, champs);
    etat.parametres = Object.assign({}, p, { pack: borne(v.pack, 1, 500, 2), attente: borne(v.attente, 1, 1440, 70),
      destinataires: borne(v.destinataires, 1, l.destinataires, l.destinataires), max_jour: borne(v.max_jour, 1, l.max_jour, l.max_jour),
      taille_pack: 1, preset: "packs" });
    majPacks(); majRecap();
    clearTimeout(sauvePacks);
    sauvePacks = setTimeout(function () { sauverParametres(etat.parametres).catch(function () {}); }, 600);
  }
  document.querySelectorAll(".pas-btn").forEach(function (b) {
    b.onclick = function () {
      var cible = $(b.dataset.cible), d = parseInt(b.dataset.d, 10), v = parseInt(cible.value, 10) || 0, c = {};
      v = d > 0 ? (v < Math.abs(d) && Math.abs(d) <= 5 ? Math.abs(d) : v + d) : Math.max(1, v + d);
      c[CHAMPS_PACKS[b.dataset.cible]] = v;
      changerPacks(c);
    };
  });
  Object.keys(CHAMPS_PACKS).forEach(function (id) {
    $(id).addEventListener("change", function () { var c = {}; c[CHAMPS_PACKS[id]] = $(id).value; changerPacks(c); });
  });
  function ouvrirParametres(retour) {
    etat.retourParametres = retour || etat.ecranCourant || "objectif";
    remplirParametres(etat.parametres);
    $("p-email").textContent = etat.compte;
    $("p-role").textContent = etat.role === "administrateur" ? "Administrateur" : "Ambassadeur";
    majOutlook(etat.outlook);
    $("retirer-outlook").hidden = !(etat.outlook && etat.outlook.connecte);
    $("p-admin").hidden = etat.role !== "administrateur";
    chargerAppareils().catch(function () {});
    ecran("parametres");
  }
  function quand(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  function majOutlook(o) {
    $("p-outlook").textContent = o && o.connecte
      ? "Session Outlook gardée sur le serveur pour " + o.adresse + ", ouverte le " + quand(o.depuis) + ". Elle reste active même quand vos appareils sont éteints."
      : (etat.config.demo ? "Démonstration : aucune session Outlook réelle." : "Aucune session Outlook sur le serveur. Reconnectez-vous pour en ouvrir une.");
  }
  async function chargerAppareils() {
    var l = await api("/v1/sessions"), ul = $("appareils");
    ul.textContent = "";
    l.sessions.forEach(function (s) {
      var li = document.createElement("li");
      var g = document.createElement("span"); g.textContent = s.appareil + (s.ici ? " (cet appareil)" : "");
      var q = document.createElement("span"); q.className = "quand"; q.textContent = "actif le " + quand(s.vu);
      g.appendChild(document.createElement("br")); g.appendChild(q);
      li.appendChild(g);
      if (!s.ici) {
        var b = document.createElement("button"); b.className = "lien"; b.type = "button"; b.textContent = "Déconnecter";
        b.onclick = function () { api("/v1/sessions/" + s.ref, null, "DELETE").then(chargerAppareils).catch(function (e) { alert(e.message); }); };
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    $("fermer-autres").hidden = l.sessions.length < 2;
  }
  $("fermer-autres").onclick = function () { api("/v1/sessions", null, "DELETE").then(chargerAppareils).catch(function (e) { alert(e.message); }); };
  $("retirer-outlook").onclick = async function () {
    if (!confirm("Le serveur oubliera votre session Outlook et vos appareils seront déconnectés.\n\nVos élèves, vos exclus et votre recherche sont gardés : reconnectez-vous avec Outlook pour reprendre là où vous en étiez. Continuer ?")) return;
    try { await api("/v1/outlook", null, "DELETE"); } catch (e) {}
    etat.code = ""; sauverLocal(); remiseAZero(); ecran("connexion");
  };
  $("ouvrir-parametres").onclick = function () { ouvrirParametres(); };
  $("modifier-param").onclick = function () { ouvrirParametres("envoi"); };
  $("retour-parametres").onclick = function () { revenir(); };
  function revenir() { if (etat.retourParametres === "envoi") majRecap(); ecran(etat.retourParametres); }
  async function sauverParametres(p) {
    etat.parametres = Object.assign({}, DEFAUT_ENVOI, await api("/v1/parametres", p, "PUT"));
  }
  $("enregistrer-parametres").onclick = async function () {
    try { await sauverParametres(lireParametres()); revenir(); } catch (e) { alert("Enregistrement impossible : " + e.message); }
  };
  $("deconnexion").onclick = async function () {
    try { await api("/v1/deconnexion", {}); } catch (e) {}
    etat.code = ""; sauverLocal(); remiseAZero(); ecran("connexion");
  };

  // ------------------------------------------------------------ administration
  // La console d'administration est une page à part (/admin), pensée pour le téléphone.
  // Ici : le nombre d'alertes sur « Administration » (ordinateur) et « Paramètres » (téléphone).
  function majBadge(nombre, critiques) {
    ["admin-badge", "param-badge", "p-admin-badge"].forEach(function (id) {
      var b = $(id); b.hidden = !nombre; b.textContent = nombre ? String(nombre) : ""; b.classList.toggle("critique", !!critiques);
    });
  }
  var minuterieAlertes = null;
  function surveillerAlertes() {
    if (minuterieAlertes) return;
    var tour = function () {
      api("/v1/admin/alertes").then(function (r) { majBadge(r.nombre, r.critiques); }).catch(function () {});
      minuterieAlertes = setTimeout(tour, 60000);
    };
    tour();
  }
  function ouvrirConsole() { location.href = BASE + "/admin"; }
  $("ouvrir-admin").onclick = ouvrirConsole;
  $("p-admin").onclick = ouvrirConsole;

  // ------------------------------------------------------------ message
  $("vers-envoi").onclick = function () {
    etat.pause = true;
    enregistrer().catch(function () {});
    $("nb-dest").textContent = nb(etat.trouves.length);
    majRecap();
    ecran("envoi");
  };
  function majRecap() {
    var p = etat.parametres, n = etat.config.demo ? etat.trouves.length : (etat.nbEnregistres || 0), cap = capaciteJour(p), jours = Math.ceil(n / Math.max(1, cap));
    majPacks();
    $("r-dest").textContent = nb(n) + " étudiants";
    $("r-mode").textContent = texteMode(p);
    $("r-rythme").textContent = texteRythme(p) + " (environ " + nb(cap) + " par jour)";
    $("r-duree").textContent = jours <= 1 ? "Moins d'une journée" : jours + " jours";
    $("r-exp").textContent = etat.compte;
  }
  $("retour-recolte").onclick = function () { ecran("recolte"); };
  $("lancer-envoi").onclick = function () {
    if (!$("objet").value.trim() || !$("message").value.trim()) { alert("Indiquez un objet et un message."); return; }
    var n = etat.trouves.length, cap = capaciteJour(etat.parametres);
    $("envoyes").textContent = "0"; $("restants").textContent = nb(n);
    var jours = Math.ceil(n / Math.max(1, cap));
    var fin = new Date(Date.now() + jours * 86400000);
    $("fin-estimee").textContent = jours <= 1 ? "Aujourd'hui" : fin.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    document.querySelectorAll(".demo-seulement").forEach(function (e) { e.hidden = !etat.config.demo; });
    ecran("envoye");
    // Démonstration : le compteur avance et les élèves passent dans « Reçu », rien n'est envoyé.
    viderListe(true);
    var eleves = etat.trouves.slice(0, n).map(function (p) { return placer({ adresse: p.adresse, nom: p.nom, source: p.source }, false, true); });
    compterParties(); montrerPartie("a-envoyer");
    var envoyes = 0, pas = 1;
    clearInterval(etat.minuterie);
    etat.minuterie = setInterval(function () {
      if (envoyes >= n) { clearInterval(etat.minuterie); return; }
      var avant = envoyes;
      envoyes = Math.min(n, envoyes + pas); $("envoyes").textContent = nb(envoyes); $("restants").textContent = nb(n - envoyes);
      for (var i = avant; i < envoyes; i++) changer(eleves[i], "envoye", true);
      for (var j = envoyes; j < Math.min(n, envoyes + pas); j++) { changer(eleves[j], "envoi", false); garderEnVue(eleves[j].liE); }
      compterParties();
    }, 1500);
  };
  $("recommencer").onclick = function () { clearInterval(etat.minuterie); etat.recherche = null; etat.nbEnregistres = etat.trouves.length; versObjectif(); };

  // ------------------------------------------------------------ parcours réel (serveur)
  // Hors démonstration, c'est le serveur qui travaille, avec la session Outlook de
  // l'étudiant : il relève l'annuaire et il envoie, les deux en même temps si on veut.
  // L'app lance, suspend, reprend, montre tout, et on passe librement d'un écran à
  // l'autre (onglets du haut) : rien ne s'arrête en changeant d'écran.
  var suivi = { minuterie: null, affiches: 0, travail: { annuaire: {}, envoi: {} }, objectif: 0, suspension: false };
  function arreterSuivi() { clearTimeout(suivi.minuterie); suivi.minuterie = null; }
  function erreurAction(e) { if (e.statut === 401) erreur(e); else alert(e.message); }
  function tourne(t) { return !!t && (t.actif || t.statut === "attente"); }

  async function allerAuTravail() {
    var t = await api("/v1/travail");
    suivi.travail = t;
    if (tourne(t.annuaire)) return voirCollecte();
    if (tourne(t.envoi) || t.envoi.statut === "pause" || t.envoi.statut === "erreur") return voirEnvoi();
    if (etat.nbEnregistres || etat.nbExtraits) return voirCollecte();  // élèves à envoyer, ou annuaire extrait à trier
    if (etat.nbRecus) return voirEnvoi();
    versObjectif();
  }

  async function regrouper(nouvelle) {
    var objectif = nouvelle ? lireObjectif() : (suivi.objectif || lireObjectif());
    // Objectif déjà atteint : on demande le nouveau (jamais de nombre choisi à la place de l'étudiant).
    if (!nouvelle && suivi.trouves >= objectif) { ouvrirObjectif(true); return; }
    // Extraction d'abord : tout l'annuaire, sans IA ; « Garder seulement les étudiants » trie ensuite.
    await api("/v1/annuaire/regrouper", { objectif: objectif, nouvelle: !!nouvelle, extraction: true });
    suivi.objectif = objectif;
    if (nouvelle) etat.nbEnregistres = 0;
    await voirCollecte();
  }

  async function voirCollecte() {
    arreterSuivi();
    $("logique-resume").textContent = "";
    ecran("recolte");
    try { await chargerListe(true); await majStatuts(false); } catch (e) { if (e.statut === 401) return erreur(e); }
    await suivreCollecte();
  }

  function chiffresEnvoi(p) {
    p = p || {};
    var servis = (p.envoyes || 0) + (p.a_verifier || 0) + (p.deja || 0) + (p.echecs || 0);
    return { envoyes: p.envoyes || 0, reste: Math.max(0, (p.total || 0) - servis), total: p.total || 0 };
  }

  async function suivreCollecte() {
    arreterSuivi();
    if (etat.ecranCourant !== "recolte") return;
    try {
      var t = await api("/v1/travail"); suivi.travail = t;
      var a = t.annuaire || {}, en = t.envoi || {};
      var lu = await chargerListe(false); await majStatuts(true);
      var parts = compterParties(), total = parts.aEnvoyer;
      await majExtraction(lu, t.tri || {}, a);
      var p = a.progression || {};
      if (p.objectif) suivi.objectif = p.objectif;
      if (!suivi.objectif) suivi.objectif = Math.max(total, lireObjectif());
      suivi.trouves = Math.max(p.trouves || 0, total);  // après « Garder seulement les étudiants », les élèves de la liste
      etat.nbEnregistres = total; etat.nbRecus = parts.recus;
      $("trouves").textContent = nb(suivi.trouves);
      $("ecartes").textContent = nb(lu && lu.exclus != null ? lu.exclus : (p.ecartes || 0));  // total gardé, jamais remis à 0
      $("objectif-rappel").textContent = nb(suivi.objectif);
      var enCours = tourne(a), enErreur = a.statut === "erreur";
      $("statut-texte").parentNode.classList.toggle("erreur", enErreur);
      if (!enCours) suivi.suspension = false;
      if (enCours && suivi.suspension) statut("Mise en pause…", false);
      else if (enCours) statut(a.statut === "attente" ? "En attente d'un navigateur libre sur le serveur…" : (a.message || "Recherche en cours"), true);
      else if (a.statut && a.statut !== "aucun") statut(a.message || "Recherche terminée", false);
      else statut(nb(total) + " élèves à qui envoyer", false);
      if (p.deja_contactes) $("logique-resume").textContent = nb(p.deja_contactes) + " déjà contactés ignorés (jamais deux fois la même personne).";
      $("pause").hidden = false; $("pause").disabled = !!(enCours && suivi.suspension);
      var atteint = suivi.trouves >= suivi.objectif;
      $("pause").textContent = enCours ? (suivi.suspension ? "Mise en pause…" : "Mettre en pause")
        : !(total + parts.recus + (lu.extraits || 0)) ? "Lancer la recherche"
        : atteint ? "Augmenter l'objectif" : "Reprendre la recherche";
      $("vers-envoi").hidden = !total;  // à tout moment, même pendant la recherche
      // L'envoi, à un geste : en cours, ou ceux qui ont déjà reçu le message.
      var c = chiffresEnvoi(en.progression);
      $("bandeau-envoi").hidden = !tourne(en) && !parts.recus;
      if (!tourne(en)) suivi.pauseEnvoi = false;
      $("bandeau-envoi-pause").hidden = !tourne(en);
      $("bandeau-envoi-pause").disabled = !!suivi.pauseEnvoi;
      $("bandeau-envoi-pause").textContent = suivi.pauseEnvoi ? "Mise en pause…" : "Mettre l'envoi en pause";
      var programme = en.statut === "attente" && (en.progression || {}).programme;
      if (programme) $("bandeau-envoi-pause").hidden = true;
      $("bandeau-envoi").textContent = programme ? "Envoi programmé : il commencera " + quandLocal(en.progression.programme) + ". Voir l'envoi"
        : tourne(en)
        ? "Envoi en cours : " + nb(c.envoyes) + " envoyés, " + nb(c.reste) + " restants. Voir l'envoi"
        : nb(parts.recus) + " élèves ont reçu le message. Voir l'envoi";
      if (!total && !enCours && !$("liste").querySelector("li:not(.vide)")) {
        if (!$("liste").querySelector("li.vide")) {
          var li = document.createElement("li"); li.className = "vide"; $("liste").appendChild(li);
        }
        $("liste").querySelector("li.vide").textContent = parts.recus ? "Tous les élèves collectés ont reçu le message. Relancez la recherche pour en trouver d'autres."
          : enErreur ? "Aucune adresse pour l'instant." : "Les adresses trouvées s'afficheront ici.";
      } else if (total) {
        var v = $("liste").querySelector("li.vide"); if (v) v.remove();
      }
    } catch (e) { if (e.statut === 401) return erreur(e); }
    if (etat.ecranCourant === "recolte") suivi.minuterie = setTimeout(suivreCollecte, 2000);
  }

  // ------------------------------------------------------------ extraire, puis garder les étudiants
  // Avant le premier tri, la liste montre ce qui est extrait (les 1 000 plus récents) ; la
  // carte « Garder seulement les étudiants » lance le tri sur tout l'annuaire.
  var XE = { actif: false, affiches: 0 };
  async function majExtraction(lu, tr, an) {
    var enTri = tourne(tr), pt = tr.progression || {};
    // Logique apprise et recherche en cours : chaque nouveau contact est trié dès qu'il est lu
    // (ceux restés sans tri sont rattrapés tout seuls) : rien à lancer.
    var auto = !enTri && !!lu.logique && tourne(an || {});
    $("extraits").textContent = nb(lu.extraits || 0); etat.nbExtraits = lu.extraits || 0;
    $("carte-tri").hidden = !(lu.extraits || enTri);
    $("lancer-tri").hidden = auto;
    $("lancer-tri").disabled = !enTri && !lu.a_trier;
    $("lancer-tri").textContent = enTri ? "Mettre en pause le tri"
      : lu.a_trier ? (lu.total || lu.recus ? "Trier les " + nb(lu.a_trier) + " nouveaux contacts" : "Garder seulement les étudiants")
      : "Tout est trié";
    $("barre-tri").hidden = !enTri;
    $("barre-tri-plein").style.width = (pt.total ? Math.max(4, Math.round(100 * (pt.tries || 0) / pt.total)) : 4) + "%";
    $("tri-etat").textContent = enTri ? (tr.message || "Tri en cours…")
      : auto ? "Tri automatique : chaque nouveau contact est trié dès que la recherche le lit, avec la logique de votre école. Rien à lancer." +
               (lu.a_trier ? " " + nb(lu.a_trier) + " en cours de tri." : "")
      : (tr.statut && tr.statut !== "aucun") ? (tr.message || "") + (lu.a_trier ? "" : " Les contacts extraits ensuite sont triés automatiquement.")
      : (lu.a_trier ? nb(lu.a_trier) + " contacts extraits, pas encore triés." : "");
    $("tri-etat").classList.toggle("erreur", tr.statut === "erreur");
    $("tri-logique").textContent = lu.logique ? "Logique de votre école : " + lu.logique : "";
    // Tant qu'aucun étudiant n'est trié, la collecte montre tout ce qui est extrait.
    var extraction = !lu.total && !lu.recus && (lu.extraits || 0) > 0;
    if (extraction) {
      if (!XE.actif) { XE.actif = true; $("liste").textContent = ""; XE.affiches = Math.max(0, lu.extraits - 1000); }
      for (;;) {
        var r = await api("/v1/extraits?depart=" + XE.affiches + "&taille=1000");
        r.personnes.forEach(function (p) {
          var li = ligneCollecte({ adresse: p.adresse, nom: p.nom, source: "extrait" }, true);
          $("liste").insertBefore(li, $("liste").firstChild); XE.affiches++;
        });
        while ($("liste").children.length > 1000) $("liste").removeChild($("liste").lastChild);
        if (r.personnes.length < 1000) break;
      }
    } else if (XE.actif) {
      XE.actif = false;  // le tri a gardé des étudiants : la collecte montre la liste à envoyer
      await chargerListe(true);
    }
  }
  // ------------------------------------------------------------ objectif, modifiable à tout moment
  function arrondi(n) { return Math.ceil(n / 500) * 500; }
  function ouvrirObjectif(atteint) {
    var f = $("objectif-edition"), trouves = suivi.trouves || 0, actuel = suivi.objectif || lireObjectif();
    $("objectif-nouveau").value = atteint ? arrondi(Math.max(trouves, actuel) + 1000) : actuel;
    $("objectif-aide").textContent = atteint
      ? "Objectif atteint : " + nb(trouves) + " étudiants. Choisissez le nouvel objectif : la recherche reprend là où elle en était, sans jamais rechercher deux fois les mêmes personnes."
      : "La recherche s'arrête quand ce nombre d'étudiants est atteint. Changez-le quand vous voulez, même pendant la recherche : c'est pris en compte tout de suite.";
    f.dataset.reprendre = atteint ? "1" : "";
    f.hidden = false;
    $("objectif-nouveau").focus();
  }
  $("modifier-objectif").onclick = function () { if (!$("objectif-edition").hidden) { $("objectif-edition").hidden = true; return; } ouvrirObjectif(false); };
  $("objectif-annuler").onclick = function () { $("objectif-edition").hidden = true; };
  document.querySelectorAll("#objectif-raccourcis .puce").forEach(function (p) {
    p.onclick = function () { $("objectif-nouveau").value = Math.max(suivi.trouves || 0, suivi.objectif || 0) + Number(p.dataset.plus); };
  });
  $("objectif-edition").onsubmit = async function (ev) {
    ev.preventDefault();
    var v = parseInt($("objectif-nouveau").value, 10), f = this, b = $("objectif-ok");
    if (!(v >= 1)) { $("objectif-nouveau").focus(); return; }
    b.disabled = true;
    try {
      await api("/v1/annuaire/objectif", { objectif: v }, "PUT");
      suivi.objectif = v; $("objectif").value = v; $("objectif-rappel").textContent = nb(v);
      f.hidden = true;
      var a = (suivi.travail || {}).annuaire || {};
      if (f.dataset.reprendre === "1" && !tourne(a) && v > (suivi.trouves || 0)) await regrouper(false);
      else suivreCollecte();
    } catch (e) { erreurAction(e); }
    b.disabled = false;
  };

  $("lancer-tri").onclick = function () {
    var b = this, tr = (suivi.travail || {}).tri || {};
    b.disabled = true;
    (tourne(tr) ? api("/v1/tri/arreter", {}) : api("/v1/tri/lancer", {}))
      .catch(erreurAction).then(function () { b.disabled = false; suivreCollecte(); });
  };

  // ------------------------------------------------------------ la liste, en deux parties
  // « À envoyer » : les élèves collectés à qui le message n'est pas encore parti. C'est
  // ce que montre la collecte, et ce que la recherche remplit en direct. « Reçu » :
  // ceux qui l'ont reçu ; ils y restent et ne seront plus jamais collectés ni contactés.
  var ETATS_ENVOI = { "": "En attente", envoi: "Envoi…", envoye: "Reçu", deja: "Déjà reçu", verifier: "À vérifier", echec: "Non envoyé",
                      pris: "Déjà contacté", nondistribue: "Non distribué" };
  var SIGNES = { envoye: "✓", deja: "✓", pris: "✓", verifier: "!", echec: "✕", nondistribue: "✕" };
  // « Non distribué » : le mail est parti mais n'est pas arrivé (adresse introuvable…) ; jamais renvoyé.
  var RECU = { envoye: 1, deja: 1, verifier: 1, pris: 1, nondistribue: 1 };
  var L = { lignes: {}, affiches: 0, curseur: 0, toucheA: 0, partie: "a-envoyer" };
  function estRecu(s) { return !!RECU[s]; }
  function viderListe(sansCollecte) {
    L.lignes = {}; L.affiches = 0; L.curseur = 0;
    $("liste-a-envoyer").textContent = ""; $("liste-recus").textContent = "";
    if (!sansCollecte) { $("liste").textContent = ""; XE.actif = false; }
  }
  function ligneEnvoi(p) {
    var li = document.createElement("li");
    var c = document.createElement("span"); c.className = "coche"; c.setAttribute("aria-hidden", "true");
    var n = document.createElement("span"); n.className = "n"; n.textContent = p.nom || p.adresse.split("@")[0];
    var a = document.createElement("span"); a.className = "a"; a.textContent = p.adresse;
    var e = document.createElement("span"); e.className = "etat";
    li.appendChild(c); li.appendChild(n); li.appendChild(a); li.appendChild(e);
    return li;
  }
  function habiller(li, s, frais) {
    li.className = (s || "attente") + (frais && s === "envoye" ? " frais" : "");
    li.querySelector(".coche").textContent = SIGNES[s] || "";
    li.querySelector(".etat").textContent = ETATS_ENVOI[s] || ETATS_ENVOI[""];
  }
  // Un élève entre dans la liste : dans « À envoyer » (et la collecte), ou dans « Reçu ».
  function placer(p, frais, sansCollecte) {
    var e = { p: p, s: p.statut || "", liE: ligneEnvoi(p), liC: null, sansCollecte: !!sansCollecte };
    L.lignes[p.adresse.toLowerCase()] = e;
    habiller(e.liE, e.s, false);
    if (estRecu(e.s)) { var r = $("liste-recus"); r.insertBefore(e.liE, r.firstChild); }
    else {
      $("liste-a-envoyer").appendChild(e.liE);
      if (!sansCollecte) { e.liC = ligneCollecte(p, !frais); $("liste").insertBefore(e.liC, $("liste").firstChild); }
    }
    return e;
  }
  // L'élève change d'état ; dès qu'il a reçu le message, il quitte « À envoyer » et la
  // collecte pour « Reçu ». Quelqu'un qui a reçu le message n'est jamais décoché.
  function changer(e, s, frais) {
    if (!e || e.s === s || (e.s === "envoye" && (s === "deja" || s === ""))) return;
    var avant = estRecu(e.s);
    e.s = s; habiller(e.liE, s, frais);
    if (estRecu(s) && !avant) {
      var r = $("liste-recus"); r.insertBefore(e.liE, r.firstChild);
      if (e.liC) { e.liC.remove(); e.liC = null; }
    } else if (!estRecu(s) && avant) {
      $("liste-a-envoyer").appendChild(e.liE);
      if (!e.sansCollecte) { e.liC = ligneCollecte(e.p, true); $("liste").insertBefore(e.liC, $("liste").firstChild); }
    }
  }
  function compterParties() {
    var r = 0, t = 0;
    for (var k in L.lignes) { t++; if (estRecu(L.lignes[k].s)) r++; }
    $("nb-a-envoyer").textContent = nb(t - r); $("nb-recus").textContent = nb(r);
    videPartie("liste-a-envoyer", t - r, r ? "Tout le monde a reçu le message. Collectez d'autres élèves : ils arriveront ici."
                                          : "Aucun élève pour l'instant. Lancez la collecte : les élèves trouvés arriveront ici.");
    videPartie("liste-recus", r, "Personne n'a encore reçu le message.");
    return { aEnvoyer: t - r, recus: r };
  }
  function videPartie(id, n, texte) {
    var l = $(id), v = l.querySelector("li.vide");
    if (n) { if (v) v.remove(); return; }
    if (!v) { v = document.createElement("li"); v.className = "vide"; l.appendChild(v); }
    v.textContent = texte;
  }
  // Les élèves pas encore affichés (tous la première fois ; ensuite ceux que la
  // recherche vient d'ajouter).
  async function chargerListe(tout) {
    if (tout) viderListe();
    var l;
    for (;;) {
      l = await api("/v1/destinataires?depart=" + L.affiches + "&taille=2000");
      if (l.total < L.affiches) { viderListe(); continue; }  // nouvelle recherche : liste refaite
      l.personnes.forEach(function (p) { placer(p, !tout); L.affiches++; });
      if (l.personnes.length < 2000) break;
    }
    return l;
  }
  // Ce qui a changé depuis le dernier passage ; on garde en vue l'élève en train de
  // recevoir (sauf si l'étudiant fait défiler la liste lui-même).
  async function majStatuts(frais) {
    var r = await api("/v1/envoi/suivi?depuis=" + L.curseur), courant = null;
    r.changes.forEach(function (c) {
      var e = L.lignes[c.adresse.toLowerCase()];
      changer(e, c.statut, frais);
      if (e && c.statut === "envoi") courant = e.liE;
    });
    L.curseur = r.curseur;
    if (courant && L.partie === "a-envoyer") garderEnVue(courant);
  }
  function garderEnVue(li) {
    if (Date.now() - L.toucheA < 8000) return;
    var l = $("liste-a-envoyer"), rl = l.getBoundingClientRect(), ri = li.getBoundingClientRect();
    if (ri.top < rl.top || ri.bottom > rl.bottom) l.scrollTop += ri.top - rl.top - l.clientHeight / 3;
  }
  ["touchstart", "wheel", "mousedown", "keydown"].forEach(function (ev) {
    $("liste-a-envoyer").addEventListener(ev, function () { L.toucheA = Date.now(); }, { passive: true });
  });
  function montrerPartie(nom) {
    L.partie = nom;
    document.querySelectorAll("#parties .option").forEach(function (o) {
      var oui = o.dataset.partie === nom; o.classList.toggle("actif", oui); o.setAttribute("aria-selected", oui ? "true" : "false");
    });
    $("liste-a-envoyer").hidden = nom !== "a-envoyer"; $("liste-recus").hidden = nom !== "recus";
  }
  document.querySelectorAll("#parties .option").forEach(function (o) { o.onclick = function () { montrerPartie(o.dataset.partie); }; });
  $("collecter-plus").onclick = function () {
    if (etat.config.demo) { clearInterval(etat.minuterie); ecran("recolte"); return; }
    voirCollecte().catch(erreurAction);
  };

  // ------------------------------------------------------------ personnes exclues
  // Ce que le tri a écarté, avec la raison ; l'étudiant ajoute ceux qu'il reconnaît.
  var GENRES = { incertain: "Incertains", personnel: "Personnel", service: "Services", externe: "Externes",
                 association: "Associations", perso: "Perso", retire: "Retirés à la main", autre: "Autres" };
  var X = { genre: "", affiches: 0, total: 0, par: {} };
  function nomGenre(g) { return GENRES[g] || (g ? g.charAt(0).toUpperCase() + g.slice(1) : "Tous"); }
  function filtresExclus() {
    var f = $("x-filtres"); f.textContent = "";
    var genres = [""].concat(Object.keys(X.par).sort(function (a, b) { return X.par[b] - X.par[a]; }));
    genres.forEach(function (g) {
      var b = document.createElement("button"); b.type = "button"; b.className = "puce" + (g === X.genre ? " actif" : "");
      b.textContent = (g ? nomGenre(g) : "Tous") + " · " + nb(g ? X.par[g] : X.total);
      b.onclick = function () { X.genre = g; chargerExclus(true).catch(erreurAction); };
      f.appendChild(b);
    });
  }
  function ligneExclu(p) {
    var li = document.createElement("li");
    var t = document.createElement("div"); t.className = "x-texte";
    var n = document.createElement("span"); n.className = "n"; n.textContent = p.nom || p.adresse.split("@")[0];
    var a = document.createElement("span"); a.className = "a"; a.textContent = p.adresse;
    var r = document.createElement("span"); r.className = "x-raison"; r.textContent = nomGenre(p.genre) + " — " + (p.raison || "");
    t.appendChild(n); t.appendChild(a); t.appendChild(r);
    var b = document.createElement("button"); b.type = "button"; b.className = "btn secondaire x-ajouter"; b.textContent = "Ajouter";
    b.onclick = function () {
      b.disabled = true;
      ajouterExclus([p.adresse]).then(function () { li.classList.add("ajoute"); b.textContent = "Ajouté ✓"; })
        .catch(function (e) { b.disabled = false; erreurAction(e); });
    };
    li.appendChild(t); li.appendChild(b);
    return li;
  }
  async function chargerExclus(tout) {
    if (tout) { X.affiches = 0; $("x-liste").textContent = ""; }
    var r = await api("/v1/exclus?depart=" + X.affiches + "&taille=200" + (X.genre ? "&genre=" + encodeURIComponent(X.genre) : ""));
    X.par = r.par_genre || {}; X.total = r.total || 0;
    filtresExclus();
    r.personnes.forEach(function (p) { $("x-liste").appendChild(ligneExclu(p)); X.affiches++; });
    var n = X.genre ? (X.par[X.genre] || 0) : X.total;
    $("x-plus").hidden = X.affiches >= n;
    $("x-tous").hidden = !X.genre || !n;
    $("x-tous").textContent = "Ajouter les " + nb(n) + " " + nomGenre(X.genre).toLowerCase();
    if (!X.affiches) {
      var v = document.createElement("li"); v.className = "vide";
      v.textContent = X.total ? "Personne dans cette catégorie." : "Personne n'a été exclu pour l'instant.";
      $("x-liste").appendChild(v);
    }
  }
  async function ajouterExclus(adresses) {
    var r = null;
    for (var k = 0; k < adresses.length; k += 1000) r = await api("/v1/exclus/ajouter", { adresses: adresses.slice(k, k + 1000) });
    if (r) $("ecartes").textContent = nb(r.exclus);
    return r;
  }
  $("voir-exclus").onclick = function () {
    if (etat.config.demo) { alert("Démonstration : la liste des exclus apparaît avec un vrai compte."); return; }
    X.genre = ""; $("feuille-exclus").hidden = false; chargerExclus(true).catch(erreurAction);
  };
  $("x-plus").onclick = function () { chargerExclus(false).catch(erreurAction); };
  $("x-tous").onclick = async function () {
    var n = X.par[X.genre] || 0, b = this;
    if (!confirm("Ajouter les " + nb(n) + " personnes « " + nomGenre(X.genre) + " » à « À envoyer » ? Vérifiez d'abord la liste : ajoutez seulement des élèves.")) return;
    b.disabled = true;
    try {
      var toutes = [];
      for (var d = 0; d < n; d += 500) {
        var r = await api("/v1/exclus?depart=" + d + "&taille=500&genre=" + encodeURIComponent(X.genre));
        r.personnes.forEach(function (p) { toutes.push(p.adresse); });
        if (r.personnes.length < 500) break;
      }
      var res = await ajouterExclus(toutes);
      alert(nb(res ? res.ajoutes : 0) + " personnes ajoutées à « À envoyer ».");
      await chargerExclus(true);
    } catch (e) { erreurAction(e); }
    b.disabled = false;
  };
  $("x-fermer").onclick = function () { $("feuille-exclus").hidden = true; };
  $("feuille-exclus").onclick = function (e) { if (e.target === this) this.hidden = true; };

  async function voirEnvoi() {
    arreterSuivi();
    document.querySelectorAll(".demo-seulement").forEach(function (e) { e.hidden = true; });
    ecran("envoye");
    try { await chargerListe(true); await majStatuts(false); compterParties(); }
    catch (e) { if (e.statut === 401) return erreur(e); }
    await suivreEnvoi();
  }

  async function suivreEnvoi() {
    arreterSuivi();
    if (etat.ecranCourant !== "envoye") return;
    try {
      var t = await api("/v1/travail"); suivi.travail = t;
      var en = t.envoi || {}, a = t.annuaire || {};
      var p = en.progression || {}, c = chiffresEnvoi(p);
      await chargerListe(false);  // la collecte remplit « À envoyer » en direct
      await majStatuts(true);
      var parts = compterParties();
      etat.nbEnregistres = parts.aEnvoyer; etat.nbRecus = parts.recus;
      var aucun = !en.statut || en.statut === "aucun";
      $("envoyes").textContent = nb(c.envoyes);
      $("restants").textContent = nb(c.reste);
      $("a-verifier").textContent = nb(p.a_verifier || 0);
      $("indic-verifier").hidden = !p.a_verifier; $("envoi-verifier-aide").hidden = !p.a_verifier;
      var cap = capaciteJour(etat.parametres), jours = Math.ceil(c.reste / Math.max(1, cap));
      $("fin-estimee").textContent = !c.reste ? "—" : jours <= 1 ? "Aujourd'hui" :
        new Date(Date.now() + (jours - 1) * 86400000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      var actif = tourne(en), programme = en.statut === "attente" && p.programme;
      var titres = { fini: "Envoi terminé", pause: "Envoi en pause", erreur: "Envoi arrêté" };
      $("titre-envoi").textContent = aucun ? "Aucun envoi pour l'instant" : programme ? "Envoi programmé" : actif ? "Envoi en cours" : (titres[en.statut] || "Envoi");
      $("statut-envoi").textContent = aucun ? "Rédigez le message, puis « Lancer l'envoi »" : programme ? "Commencera " + quandLocal(p.programme) : actif ? "En cours" :
        en.statut === "fini" ? "Terminé" : en.statut === "pause" ? "En pause" : "Arrêté";
      $("pouls-envoi").classList.toggle("arret", !actif || !!programme);
      $("envoi-message").textContent = programme
        ? "Il partira tout seul à l'heure choisie, même si l'application est fermée : " + nb(p.total || 0) + " élèves à envoyer pour l'instant, et ceux trouvés d'ici là."
        : en.message || "";
      $("envoi-maintenant").hidden = !programme;
      // Aucun envoi (ou le précédent terminé) : on prépare le suivant ici même.
      var preparer = aucun || en.statut === "fini";
      $("preparer-envoi").hidden = !preparer;
      if (preparer && !etat.prepAffichee) { etat.prepAffichee = true; $("nb-dest").textContent = nb(etat.nbEnregistres || 0); majRecap(); majDebut(); }
      if (!preparer) etat.prepAffichee = false;
      if (aucun) $("statut-envoi").textContent = "Choisissez quand envoyer, puis « Lancer l'envoi »";
      $("envoi-message").classList.toggle("erreur", en.statut === "erreur" || !!p.blocage);
      $("envoi-nd").hidden = !p.non_distribues;
      $("envoi-nd").textContent = nb(p.non_distribues || 0) + (p.non_distribues > 1 ? " élèves n'ont" : " élève n'a") +
        " pas reçu le message (adresse introuvable ou boîte pleine) : marqué" + (p.non_distribues > 1 ? "s" : "") + " « Non distribué » dans « Reçu », l'envoi continue.";
      if (!actif) suivi.pauseEnvoi = false;
      $("pause-envoi").hidden = aucun || en.statut === "fini";
      $("pause-envoi").disabled = !!(actif && suivi.pauseEnvoi);
      $("pause-envoi").textContent = programme ? "Annuler la programmation" : actif ? (suivi.pauseEnvoi ? "Mise en pause…" : "Mettre en pause") : "Reprendre l'envoi";
      if (actif && suivi.pauseEnvoi) $("statut-envoi").textContent = "Mise en pause après le mail en cours…";
      $("voir-collecte").hidden = false;
      // La recherche tourne pendant qu'on regarde l'envoi : on la montre.
      $("bandeau-recherche").hidden = !tourne(a);
      $("bandeau-recherche").textContent = "Recherche en cours : " + nb((a.progression || {}).trouves || 0) + " élèves trouvés. Voir la collecte";
      if (etat.ecranCourant === "envoye") suivi.minuterie = setTimeout(suivreEnvoi, actif ? 2000 : tourne(a) ? 3000 : 8000);
    } catch (e) {
      if (e.statut === 401) return erreur(e);
      if (etat.ecranCourant === "envoye") suivi.minuterie = setTimeout(suivreEnvoi, 5000);
    }
  }

  // « Envoi » : quand envoyer, rythme, récapitulatif et lancement (le message reste dans « Message »).
  async function voirPreparation(programmer) {
    if (programmer === true) document.querySelector('input[name="debut"][value="programme"]').checked = true;
    etat.prepAffichee = false;
    await voirEnvoi();
    if (programmer === true) {
      var c = $("carte-debut");
      c.classList.add("eclaire"); setTimeout(function () { c.classList.remove("eclaire"); }, 2400);
      c.scrollIntoView({ block: "start", behavior: "smooth" });
      setTimeout(function () { try { $("debut-quand").focus(); } catch (e) {} }, 400);
    }
  }
  $("vers-preparation").onclick = function () { voirPreparation().catch(erreurAction); };
  $("retour-message").onclick = function () { voirMessage(); };
  function voirMessage(programmer) {
    if (programmer === true) return voirPreparation(true);
    arreterSuivi();
    $("nb-dest").textContent = nb(etat.nbEnregistres || 0);
    $("test-etat").textContent = "";
    majApercuDate();
    majRecap();
    majDebut();
    ecran("envoi");
  }
  // La console demande « Programmer » : l'écran Message s'ouvre, date et heure prêtes.
  var programmerDemande = false;
  window.addEventListener("message", function (ev) {
    if (!CONSOLE || ev.origin !== location.origin || !ev.data || ev.data.smartmail !== "programmer") return;
    if (etat.compte) voirMessage(true); else programmerDemande = true;
  });

  // ------------------------------------------------------------ début de l'envoi : tout de suite, ou à une date et une heure
  // L'heure est celle de l'appareil ; le serveur reçoit un instant exact, et lance l'envoi tout
  // seul à ce moment-là, même si l'application est fermée.
  function quandLocal(t) {
    return new Date(t * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }
  function valeurLocale(d) {
    var z = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes());
  }
  function programmeChoisi() { return document.querySelector('input[name="debut"][value="programme"]').checked; }
  function debutChoisi() {  // secondes depuis 1970 ; null : tout de suite ; NaN : à compléter
    if (!programmeChoisi()) return null;
    var t = new Date($("debut-quand").value).getTime() / 1000;
    return $("debut-quand").value && isFinite(t) ? t : NaN;
  }
  function fuseauServeur() { return (etat.config && etat.config.fuseau) || "Europe/Paris"; }
  function heureServeur(t) {
    try { return parseInt(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: fuseauServeur() }).format(new Date(t * 1000)), 10); }
    catch (e) { return new Date(t * 1000).getHours(); }
  }
  function majDebut() {
    var prog = programmeChoisi();
    $("debut-programme").hidden = !prog;
    $("debut-quand").min = valeurLocale(new Date());
    if (prog && !$("debut-quand").value) { var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); $("debut-quand").value = valeurLocale(d); }
    var t = debutChoisi(), aide = "", p = etat.parametres || {};
    if (prog) {
      if (!isFinite(t)) aide = "Choisissez la date et l'heure du début.";
      else if (t < Date.now() / 1000 + 60) aide = "Choisissez un moment dans le futur.";
      else {
        aide = "L'envoi commencera tout seul " + quandLocal(t) + ", même si l'application est fermée. Les élèves trouvés d'ici là seront inclus.";
        var h = heureServeur(t), deb = p.heure_debut != null ? p.heure_debut : 8, fin = p.heure_fin != null ? p.heure_fin : 20;
        if (h < deb || h >= fin) aide += " Attention : c'est en dehors de votre plage d'envoi (" + deb + " h – " + fin + " h, heure de " +
          fuseauServeur().split("/").pop() + ") : les premiers mails partiront à " + deb + " h.";
      }
    }
    $("debut-aide").textContent = aide;
    $("lancer-envoi").textContent = prog ? "Programmer l'envoi" : "Lancer l'envoi";
    $("r-debut").textContent = prog && isFinite(t) ? quandLocal(t) : "Tout de suite";
  }
  document.querySelectorAll('input[name="debut"]').forEach(function (r) { r.addEventListener("change", majDebut); });
  $("debut-quand").addEventListener("input", majDebut);
  $("debut-quand").addEventListener("change", majDebut);

  // « {date} » devient la date limite au moment de l'envoi : J+6 (lancé le 8 : November 14).
  // « {date_fr} » : la même en français. « [texte](lien) » devient un lien cliquable.
  function jourLimite() { var d = new Date(); d.setDate(d.getDate() + 6); return d; }
  function majApercuDate() {
    var tout = $("objet").value + $("message").value, infos = [];
    if (tout.indexOf("{date}") >= 0) infos.push("{date} deviendra « " + jourLimite().toLocaleDateString((LOCALES || {})[etat.langue] || "en-US", { month: "long", day: "numeric" }) + " »");
    if (tout.indexOf("{date_fr}") >= 0) infos.push("{date_fr} deviendra « " + jourLimite().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " »");
    if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(tout)) infos.push("[texte](lien) deviendra un lien cliquable");
    $("apercu-date").textContent = infos.length ? infos.join(" · ") + " (date limite : aujourd'hui + 6 jours)." : "";
  }
  ["objet", "message"].forEach(function (id) { $(id).addEventListener("input", majApercuDate); });

  // Les étapes du haut deviennent des onglets : on passe librement de l'un à l'autre.
  document.querySelectorAll(".etapes-nav li").forEach(function (li) {
    li.setAttribute("role", "button"); li.tabIndex = 0;
    var aller = function () {
      if (etat.config.demo || !etat.code) return;
      var n = li.dataset.n;
      if (n === "1") { if (etat.nbEnregistres || etat.nbRecus || etat.nbExtraits || tourne(suivi.travail.annuaire)) voirCollecte().catch(erreurAction); else { arreterSuivi(); versObjectif(); } }
      else if (n === "2") voirMessage();
      else voirEnvoi().catch(erreurAction);
    };
    li.addEventListener("click", aller);
    li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aller(); } });
  });
  $("bandeau-envoi").onclick = function () { voirEnvoi().catch(erreurAction); };
  $("bandeau-recherche").onclick = function () { voirCollecte().catch(erreurAction); };

  // Les boutons : en démonstration, le parcours d'origine ; sinon, le serveur.
  var demoStart = $("start").onclick, demoReprendre = $("reprendre").onclick, demoPause = $("pause").onclick,
      demoVersEnvoi = $("vers-envoi").onclick, demoRetour = $("retour-recolte").onclick,
      demoLancer = $("lancer-envoi").onclick, demoRecommencer = $("recommencer").onclick;
  $("start").onclick = function () {
    if (etat.config.demo) return demoStart.call(this);
    if (etat.nbEnregistres && !confirm("Une nouvelle recherche retire les " + nb(etat.nbEnregistres) + " élèves pas encore contactés. Ceux qui ont reçu le message restent dans « Reçu » et ne seront jamais recontactés. Continuer ?")) return;
    regrouper(true).catch(erreurAction);
  };
  $("reprendre").onclick = function () { if (etat.config.demo) return demoReprendre.call(this); voirCollecte().catch(erreurAction); };
  $("pause").onclick = function () {
    if (etat.config.demo) return demoPause.call(this);
    var a = suivi.travail.annuaire || {}, b = $("pause");
    b.disabled = true;
    var action = tourne(a)
      ? api("/v1/annuaire/arreter", {}).then(function () { suivi.suspension = true; statut("Mise en pause…", false); b.textContent = "Mise en pause…"; })
      : regrouper(false);
    action.catch(erreurAction).then(function () { b.disabled = false; suivreCollecte(); });
  };
  $("vers-envoi").onclick = function () { if (etat.config.demo) return demoVersEnvoi.call(this); voirMessage(); };
  $("retour-recolte").onclick = function () { if (etat.config.demo) return demoRetour.call(this); voirCollecte().catch(erreurAction); };
  $("voir-collecte").onclick = function () { voirCollecte().catch(erreurAction); };
  $("lancer-envoi").onclick = async function () {
    if (etat.config.demo) return demoLancer.call(this);
    var objet = $("objet").value.trim(), texte = $("message").value.trim();
    if (!objet || !texte) { alert("Indiquez un objet et un message."); return; }
    var debut = debutChoisi(), langue = $("langue").selectedOptions[0].textContent;
    if (debut !== null && !(debut > Date.now() / 1000 + 60)) { alert("Choisissez une date et une heure de début dans le futur."); return; }
    if (!confirm(debut
      ? "Programmer l'envoi de ce message (" + langue + ") " + quandLocal(debut) + ", depuis votre adresse ? Il partira tout seul, même si l'application est fermée, aux " + nb(etat.nbEnregistres || 0) + " élèves trouvés et à ceux trouvés d'ici là. Personne ne le reçoit deux fois."
      : "Envoyer ce message (" + langue + ") aux " + nb(etat.nbEnregistres || 0) + " élèves trouvés, depuis votre adresse Outlook ? (Ceux qui l'ont déjà reçu sont retirés.)")) return;
    var b = this; b.disabled = true;
    try { await api("/v1/envoi", { objet: objet, texte: texte, langue: etat.langue, debut: debut || null }); await voirEnvoi(); } catch (e) { erreurAction(e); }
    b.disabled = false;
  };
  // Pause de l'envoi, à tout moment : le mail en cours finit de partir, puis plus rien
  // jusqu'à « Reprendre l'envoi » (rien n'est perdu, personne ne reçoit deux fois).
  function pauseEnvoi(b) {
    b.disabled = true;
    return api("/v1/envoi/arreter", {}).then(function () { suivi.pauseEnvoi = true; b.textContent = "Mise en pause…"; }).catch(erreurAction);
  }
  $("envoi-maintenant").onclick = function () {
    if (!confirm("Commencer l'envoi maintenant, sans attendre l'heure programmée ?")) return;
    var b = this; b.disabled = true;
    api("/v1/envoi/programmer", {}).catch(erreurAction).then(function () { b.disabled = false; suivreEnvoi(); });
  };
  $("pause-envoi").onclick = function () {
    var en = suivi.travail.envoi || {}, b = this;
    if (en.statut === "attente" && (en.progression || {}).programme && !confirm("Annuler l'envoi programmé ? Rien n'est parti ; vous pourrez le relancer quand vous voulez.")) return;
    if (tourne(en)) pauseEnvoi(b).then(function () { suivreEnvoi(); });
    else { b.disabled = true; api("/v1/envoi/reprendre", {}).catch(erreurAction).then(function () { suivi.pauseEnvoi = false; suivreEnvoi(); }); }
  };
  $("bandeau-envoi-pause").onclick = function () { pauseEnvoi(this); };
  $("recommencer").onclick = function () {
    if (etat.config.demo) return demoRecommencer.call(this);
    arreterSuivi(); versObjectif();
  };
  // Tester l'envoi, à tout moment : le message part à soi-même, à côté d'une
  // recherche ou d'un envoi en cours, sans rien changer pour les élèves.
  // Un seul brouillon (objet et message), gardé sur l'appareil.
  var CLE_BROUILLON_BASE = "smartmail-brouillon-v3";
  // Dans un écran de la console : un brouillon à part par ambassadeur (jamais celui de l'administrateur).
  function cleBrouillon() { return CONSOLE ? CLE_BROUILLON_BASE + "-console-" + (etat.compte || "") : CLE_BROUILLON_BASE; }
  function brouillon(objet, texte) {
    if (objet != null) { try { localStorage.setItem(cleBrouillon(), JSON.stringify({ objet: objet, texte: texte, langue: etat.langue })); } catch (e) {} return; }
    try { return JSON.parse(localStorage.getItem(cleBrouillon()) || "null"); } catch (e) { return null; }
  }

  // ------------------------------------------------------------ langue du message
  // Le message type dans chaque langue ; « {date} » s'écrit dans la langue choisie
  // (« November 14 », « 14 novembre », « 14 de noviembre », « 14. November »…).
  var MODELES = {
    en: { objet: $("objet").defaultValue, texte: $("message").defaultValue },
    fr: { objet: "The AI Certification : inscrivez-vous avant le {date}",
          texte: "Chers étudiants,\n\nL'IA devient l'une des compétences les plus recherchées par les employeurs : inscrivez-vous avant le {date}.\n\nEn 3 heures, vous construisez votre propre agent IA et vous obtenez votre certification. Vous pourrez ajouter votre certificat directement à votre profil LinkedIn et à votre CV : une preuve visible, pour les recruteurs, de votre expérience pratique de l'IA.\n\n[OBTENEZ VOTRE CERTIFICATION IA](https://the-ai-certification.com/ecole)\n\n71 % des dirigeants préféreraient recruter un candidat moins expérimenté qui maîtrise l'IA plutôt qu'un candidat plus expérimenté qui ne la maîtrise pas.\n\nLes places sont limitées. Réservez votre place et commencez la certification → https://the-ai-certification.com/ecole\n\nAlors que l'IA prend une place croissante dans tous les secteurs, démontrer ces compétences peut considérablement renforcer votre profil lorsque vous postulez à des stages et à des postes de jeunes diplômés.\n\nBien cordialement,\nL'équipe The AI Certification" },
    es: { objet: "The AI Certification: inscríbete antes del {date}",
          texte: "Queridos estudiantes:\n\nLa IA se está convirtiendo en una de las competencias más valoradas por las empresas: inscríbete antes del {date}.\n\nEn 3 horas, construyes tu propio agente de IA y obtienes tu certificación. Podrás añadir tu certificado directamente a tu perfil de LinkedIn y a tu CV, ofreciendo a los reclutadores una prueba visible de tu experiencia práctica en IA.\n\n[OBTÉN TU CERTIFICACIÓN DE IA](https://the-ai-certification.com/school)\n\nEl 71 % de los directivos preferiría contratar a un candidato con menos experiencia pero con competencias en IA antes que a uno con más experiencia sin ellas.\n\nLas plazas son limitadas. Reserva tu plaza y empieza la certificación → https://the-ai-certification.com/school\n\nA medida que la IA gana importancia en todos los sectores, demostrar estas competencias puede reforzar considerablemente tu perfil al solicitar prácticas y puestos para recién titulados.\n\nUn cordial saludo,\nEl equipo de The AI Certification" },
    de: { objet: "The AI Certification: Jetzt bis zum {date} anmelden",
          texte: "Liebe Studierende,\n\nKI wird zu einer der gefragtesten Kompetenzen bei Arbeitgebern: Melden Sie sich bis zum {date} an.\n\nIn 3 Stunden bauen Sie Ihren eigenen KI-Agenten und erhalten Ihre Zertifizierung. Sie können Ihr Zertifikat direkt in Ihr LinkedIn-Profil und Ihren Lebenslauf aufnehmen und Recruitern so einen sichtbaren Nachweis Ihrer praktischen KI-Erfahrung liefern.\n\n[JETZT KI-ZERTIFIZIERUNG ERHALTEN](https://the-ai-certification.com/school)\n\n71 % der Führungskräfte würden lieber eine weniger erfahrene Person mit KI-Kenntnissen einstellen als eine erfahrenere ohne diese Kenntnisse.\n\nDie Plätze sind begrenzt. Sichern Sie sich Ihren Platz und starten Sie die Zertifizierung → https://the-ai-certification.com/school\n\nDa KI in allen Branchen immer wichtiger wird, können diese Kompetenzen Ihr Profil bei Bewerbungen für Praktika und Einstiegspositionen deutlich stärken.\n\nMit freundlichen Grüßen\nDas Team von The AI Certification" },
    it: { objet: "The AI Certification: iscriviti entro il {date}",
          texte: "Cari studenti,\n\nL'IA sta diventando una delle competenze più ricercate dai datori di lavoro: iscriviti entro il {date}.\n\nIn 3 ore costruisci il tuo agente IA e ottieni la certificazione. Potrai aggiungere il tuo certificato direttamente al tuo profilo LinkedIn e al tuo CV, offrendo ai recruiter una prova visibile della tua esperienza pratica con l'IA.\n\n[OTTIENI LA TUA CERTIFICAZIONE IA](https://the-ai-certification.com/school)\n\nIl 71% dei dirigenti preferirebbe assumere un candidato con meno esperienza ma con competenze in IA piuttosto che uno più esperto senza di esse.\n\nI posti sono limitati. Prenota il tuo posto e inizia la certificazione → https://the-ai-certification.com/school\n\nPoiché l'IA sta diventando sempre più importante in tutti i settori, dimostrare queste competenze può rafforzare notevolmente il tuo profilo quando ti candidi per stage e posizioni per neolaureati.\n\nCordiali saluti,\nIl team di The AI Certification" }
  };
  var LOCALES = { en: "en-US", fr: "fr-FR", es: "es-ES", de: "de-DE", it: "it-IT" };
  var NOMS_LANGUES = { en: "anglais", fr: "français", es: "espagnol", de: "allemand", it: "italien" };
  etat.langue = "en";
  (function () {
    var b = brouillon();
    if (b && b.objet) { $("objet").value = b.objet; $("message").value = b.texte || ""; }
    if (b && MODELES[b.langue]) etat.langue = b.langue;
    $("langue").value = etat.langue;
  })();
  ["objet", "message"].forEach(function (id) { $(id).addEventListener("input", function () { brouillon($("objet").value, $("message").value); }); });
  function estUnModele(objet, texte) {
    return Object.keys(MODELES).some(function (k) { return MODELES[k].objet.trim() === objet.trim() && MODELES[k].texte.trim() === texte.trim(); });
  }
  $("langue").onchange = function () {
    var l = this.value, m = MODELES[l];
    // Message d'origine (dans n'importe quelle langue) : on le remplace directement.
    // Message retouché : on demande ; sinon on garde le texte, seule la date change de langue.
    if (estUnModele($("objet").value, $("message").value) ||
        confirm("Remplacer votre message par le message type en " + NOMS_LANGUES[l] + " ?\n\nAnnuler : garder votre texte (seule la date s'écrira en " + NOMS_LANGUES[l] + ").")) {
      $("objet").value = m.objet; $("message").value = m.texte;
    }
    etat.langue = l;
    brouillon($("objet").value, $("message").value);
    majApercuDate();
  };

  async function lancerTest(objet, texte, et, bouton) {
    if (etat.config.demo) { et.textContent = "Démonstration : aucun message n'est envoyé."; return; }
    objet = objet.trim(); texte = texte.trim();
    if (!objet || !texte) { et.textContent = "Indiquez un objet et un message."; et.classList.add("erreur"); return; }
    $("objet").value = objet; $("message").value = texte; brouillon(objet, texte);
    bouton.disabled = true;
    et.classList.remove("erreur");
    et.textContent = "Envoi du test à " + etat.compte + " depuis votre Outlook…";
    try {
      await api("/v1/envoi/test", { objet: objet, texte: texte, langue: etat.langue });
      for (var i = 0; i < 150; i++) {
        await dormir(2000);
        var t = await api("/v1/envoi/test");
        if (t.statut === "fini" || t.statut === "erreur" || t.statut === "pause") {
          et.textContent = t.message; et.classList.toggle("erreur", t.statut !== "fini"); break;
        }
      }
    } catch (e) { et.textContent = e.message; et.classList.add("erreur"); }
    bouton.disabled = false;
  }
  $("tester-envoi").onclick = function () { lancerTest($("objet").value, $("message").value, $("test-etat"), this); };
  $("ouvrir-test").onclick = function () {
    $("t-objet").value = $("objet").value; $("t-message").value = $("message").value;
    $("feuille-test").hidden = false;
    if (!$("t-etat").textContent) $("t-etat").textContent = "";
  };
  $("t-envoyer").onclick = function () { lancerTest($("t-objet").value, $("t-message").value, $("t-etat"), this); };
  $("t-fermer").onclick = function () { $("feuille-test").hidden = true; };
  $("feuille-test").onclick = function (e) { if (e.target === this) this.hidden = true; };

  // ------------------------------------------------------------ installation
  // Chrome, Edge, Android : bouton d'installation natif. iPhone/iPad et Safari Mac :
  // pas de bouton automatique, on montre les gestes à faire.
  var invite = null;
  var autonome = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var safariMac = !ios && /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invite = e; if (!autonome) $("installer").hidden = false; });
  window.addEventListener("appinstalled", function () { $("installer").hidden = true; $("carte-installer").hidden = true; });
  if (!autonome && (ios || safariMac)) { $("installer").hidden = false; $("carte-installer").hidden = false; }
  window.addEventListener("beforeinstallprompt", function () { if (!autonome) $("carte-installer").hidden = false; });
  $("installer-carte").onclick = function () { $("installer").click(); };
  if (safariMac) {
    var ol = document.querySelector("#feuille-ios ol");
    ol.textContent = "";
    ["Dans la barre des menus, ouvrez Fichier.", "Choisissez « Ajouter au Dock ».", "Smart Mail s'ouvre ensuite comme une application."].forEach(function (t) {
      var li = document.createElement("li"); li.textContent = t; ol.appendChild(li);
    });
  }
  $("installer").onclick = async function () {
    if (invite) { invite.prompt(); try { await invite.userChoice; } catch (e) {} invite = null; $("installer").hidden = true; return; }
    $("feuille-ios").hidden = false;
  };
  $("fermer-feuille").onclick = function () { $("feuille-ios").hidden = true; };
  $("feuille-ios").onclick = function (e) { if (e.target === this) this.hidden = true; };
  if ("serviceWorker" in navigator && !CONSOLE) navigator.serviceWorker.register(BASE + "/sw.js").catch(function () {});

  // ------------------------------------------------------------ démarrage
  (async function () {
    chargerLocal();
    try { etat.config = await api("/v1/config"); } catch (e) {}
    $("badge-demo").hidden = !etat.config.demo;
    $("form-demo").hidden = !etat.config.demo;
    $("bloc-outlook").hidden = !!etat.config.demo;
    await retrouverSession();
  })();

  // Toujours connecté : la session vit sur le serveur. Au lancement on la reprend
  // (jeton local, sinon cookie de secours) ; une coupure réseau ne déconnecte jamais,
  // on réessaie tout seul. Seul le serveur peut dire qu'une session est fermée (401).
  async function retrouverSession() {
    var autreEssaye = 0, origine = "";
    for (var essai = 0; ; essai++) {
      try {
        if (!etat.code && CONSOLE) return consoleExpiree();  // jamais le cookie de l'administrateur
        if (!etat.code) {
          var r = await api("/v1/session/reprendre", {});
          if (!r.code) {
            // Aucune session sur cet appareil : s'il n'a encore jamais été rangé sur un serveur, il va
            // sur celui des nouveaux comptes (une seule fois : ensuite le cookie existe).
            // (23/11) Sans recharger la page : l'interface est la même sur les deux serveurs, seules les
            // requêtes changent de serveur dès que le cookie est posé.
            if (BASE && etat.config.ailleurs && !serveurAppareil()) {
              noterServeur(etat.config.ailleurs);
              try { etat.config = await api("/v1/config"); } catch (e) {}
              if (!etat.config.ailleurs) continue;  // arrivé sur l'autre serveur : on y cherche la session
            }
            $("hors-ligne").hidden = true; ecran("connexion"); return;
          }
          etat.code = r.code; sauverLocal();
        }
        await ouvrirCompte();
        // Session ouverte ici : cet appareil reste sur ce serveur.
        if (BASE && !CONSOLE && etat.config.serveur && serveurAppareil() !== etat.config.serveur) noterServeur(etat.config.serveur);
        $("hors-ligne").hidden = true;
        return;
      } catch (e) {
        if (e.statut === 401 && CONSOLE) return consoleExpiree();
        if (e.statut === 401 && BASE && etat.code && etat.config.serveur && autreEssaye < 2) {
          // (23/11) Session inconnue ici : c'est peut-être un compte de l'autre serveur (appareil arrivé sur le
          // mauvais). On y essaie la même session avant de la jeter ; si elle n'y est pas non plus, retour au premier.
          var cible = autreEssaye ? origine : (etat.config.serveur === "paris" ? "ovh" : "paris");
          if (!autreEssaye) origine = etat.config.serveur;
          autreEssaye++;
          noterServeur(cible);
          try { etat.config = await api("/v1/config"); } catch (x) {}
          if (autreEssaye === 2) { etat.code = ""; sauverLocal(); }
          continue;
        }
        if (e.statut === 401) { etat.code = ""; sauverLocal(); continue; } // jeton local périmé : le cookie peut encore servir
        $("hors-ligne").hidden = false;
        await dormir(Math.min(15000, 1500 * (essai + 1)));
      }
    }
  }
  // Retour au premier plan (iPhone) ou réseau revenu : on vérifie que tout est à jour.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && etat.code && !etat.enCours && etat.ecranCourant === "objectif") {
      ouvrirCompte().catch(function (e) { if (e.statut === 401) { etat.code = ""; sauverLocal(); retrouverSession(); } });
    }
  });
  window.addEventListener("online", function () { if (!$("hors-ligne").hidden) retrouverSession(); });
})();
