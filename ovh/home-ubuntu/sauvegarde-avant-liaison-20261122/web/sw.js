// Service worker : rend Smart Mail installable et ouvre l'app même hors ligne
// (l'interface est en cache ; les données, elles, viennent toujours du serveur).
var VERSION = "smartmail-v47";
var COQUILLE = ["./", "app.css?v=44", "app.js?v=41", "manifest.webmanifest", "icones/icone-192.png", "icones/apple-touch-icon.png", "icones/favicon-32.png"];
var PREFIXE = new URL("./", location.href).pathname.replace(/\/$/, "");  // "" ou "/tool"

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(COQUILLE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url), p = url.pathname.slice(PREFIXE.length);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (p.startsWith("/v1/") || p.startsWith("/demo/") || p === "/sante") return; // API : toujours le réseau
  // Interface : le réseau d'abord (mises à jour immédiates), le cache si hors ligne.
  e.respondWith(fetch(e.request).then(function (r) {
    var copie = r.clone();
    caches.open(VERSION).then(function (c) { c.put(e.request, copie); });
    return r;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match("./"); }); }));
});
