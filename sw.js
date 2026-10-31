const C = 'hgm-v38';
const FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'data/start1996.json', 'data/draftclasses.json', 'data/history.json', 'data/contracts1996.json', 'src/engine/timeline.js', 'src/engine/histstart.js', 'src/engine/draftclass.js',
  'src/ui/app.js', 'src/ui/icons.js', 'src/ui/storage.js', 'src/engine/index.js', 'src/engine/control.js', 'src/engine/constants.js', 'src/engine/rng.js', 'src/engine/players.js', 'src/engine/sim.js', 'src/engine/league.js', 'src/engine/offseason.js', 'src/engine/trade.js', 'src/engine/pgm2.js', 'src/engine/priorHonors.js', 'src/engine/retiredNumbers.js', 'src/engine/frontoffice.js', 'src/engine/schemes.js', 'src/engine/history.js', 'src/engine/era.js', 'src/engine/il.js', 'src/engine/rosterfile.js', 'src/engine/names.js', 'src/engine/franchise.js', 'src/engine/morale.js', 'src/engine/editor.js', 'src/engine/careers.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// network-first so updates arrive; cache fallback = offline play
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
