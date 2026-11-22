// Smart Mail : la partie « Adresses » n'a pas besoin du service worker (tout se
// passe dans le script de contenu) ; la partie « Publipostage » s'en sert pour
// écrire « Déjà envoyés » dans Téléchargements et pour l'envoi en arrière-plan.

// Bouton de l'extension : affiche ou masque le panneau dans l'onglet (mega.js).
chrome.action.onClicked.addListener(function (tab) {
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { mega: "basculer" }).catch(function () {});
});

// Fichier texte écrit dans Téléchargements, en remplaçant le précédent du même nom
// (liste « Déjà envoyés » : publipostage-deja-envoyes.txt).
chrome.runtime.onMessage.addListener(function (m, envoyeur, repondre) {
  if (!m || m.pp !== "fichier" || typeof m.texte !== "string" || !/^[\w.-]+\.txt$/.test(m.nom || "")) return;
  var url = "data:text/plain;charset=utf-8," + encodeURIComponent(m.texte);
  chrome.downloads.download({ url: url, filename: m.nom, conflictAction: "overwrite", saveAs: false }, function (id) {
    var err = chrome.runtime.lastError;
    repondre(err || id == null ? { ok: false, raison: err ? err.message : "téléchargement refusé" } : { ok: true });
  });
  return true;
});

// Envoi en arrière-plan. Chrome ralentit les minuteries d'un onglet caché (un
// réveil par minute après 5 min) : l'onglet Outlook demande ici ses réveils, qui
// ne sont pas ralentis (attendre, dans outlook.js). Pendant l'envoi, l'onglet
// n'est pas déchargé par l'économiseur de mémoire et le Mac ne se met pas en
// veille (l'écran, lui, peut s'éteindre).
chrome.runtime.onMessage.addListener(function (m, envoyeur, repondre) {
  if (!m) return;
  if (m.pp === "reveil") {
    setTimeout(function () { repondre(true); }, Math.min(Math.max(0, Number(m.ms) || 0), 20000));
    return true;
  }
  if (m.pp === "envoi") {
    if (m.actif) chrome.power.requestKeepAwake("system"); else chrome.power.releaseKeepAwake();
    if (envoyeur.tab && envoyeur.tab.id != null) chrome.tabs.update(envoyeur.tab.id, { autoDiscardable: !m.actif }).catch(function () {});
    repondre(true);
  }
});

// Tri des élèves par IA : le script de contenu passe par ici pour joindre le
// serveur Smart Mail (permission d'hôte de l'extension : pas de souci de CORS
// avec la page Outlook). Seules les routes de tri sont autorisées.
var SERVEUR = "https://2-25-7-244.sslip.io";
chrome.runtime.onMessage.addListener(function (m, envoyeur, repondre) {
  if (!m || m.mega !== "api" || !/^\/v1\/(tri|logique|moi)$/.test(m.chemin || "")) return;
  var options = { method: m.corps ? "POST" : "GET", headers: { "Authorization": "Bearer " + String(m.code || "") } };
  if (m.corps) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(m.corps); }
  fetch(SERVEUR + m.chemin, options)
    .then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { repondre({ ok: r.ok, statut: r.status, json: j }); });
    })
    .catch(function (e) { repondre({ ok: false, statut: 0, json: { detail: "Serveur Smart Mail injoignable (" + e.message + ")." } }); });
  return true;
});

// Verrou d'envoi entre onglets (moteur.js) : l'onglet qui le tient est-il encore là ?
// Un délai seul ne suffit pas. Trop court, un onglet caché ou gelé par Chrome perd son
// verrou et un autre onglet envoie en double ; trop long, un onglet fermé, déchargé
// ou un navigateur redémarré bloque la reprise pour rien. On regarde donc l'onglet.
// Le registre vit dans storage.session : vidé quand le navigateur ou l'extension
// redémarre, ce qui rend mort tout verrou pris avant.
chrome.runtime.onMessage.addListener(function (m, envoyeur, repondre) {
  if (!m || (m.pp !== "verrou-pris" && m.pp !== "verrou-vivant")) return;
  if (m.pp === "verrou-pris") {
    var o = {}; o["verrou-" + String(m.id || "")] = envoyeur.tab && envoyeur.tab.id != null ? envoyeur.tab.id : -1;
    chrome.storage.session.set(o).then(function () { repondre(true); }, function () { repondre(false); });
    return true;
  }
  verrouVivant(String(m.id || "")).then(repondre, function () { repondre("inconnu"); });
  return true;
});
async function verrouVivant(id) {
  var cle = "verrou-" + id, o = await chrome.storage.session.get(cle);
  if (!(cle in o)) return "mort"; // pris avant un redémarrage du navigateur ou de l'extension
  var tab;
  try { tab = await chrome.tabs.get(o[cle]); } catch (e) { return "mort"; } // onglet fermé
  if (tab.discarded) return "mort"; // onglet déchargé : son script n'existe plus
  if (tab.frozen) return "vivant";  // gelé par Chrome : il reprendra, son verrou tient
  // L'onglet existe : son script tient-il toujours CE verrou (ni rechargé, ni redirigé) ?
  var r = await Promise.race([
    chrome.tabs.sendMessage(tab.id, { pp: "tiens-tu", id: id }).catch(function () { return false; }),
    new Promise(function (ok) { setTimeout(function () { ok("muet"); }, 3000); }),
  ]);
  return r === true ? "vivant" : r === "muet" ? "muet" : "mort";
}
