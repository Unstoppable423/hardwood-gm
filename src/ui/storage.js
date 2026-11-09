// IndexedDB save slots (3) + JSON export/import
const DB = 'hardwood-gm', STORE = 'slots';
function open() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(mode, fn) { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const st = t.objectStore(STORE); const out = fn(st); t.oncomplete = () => res(typeof IDBRequest !== 'undefined' && out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); }
export const serialize = (L) => JSON.stringify(L, (k, v) => (k === '_pmap' ? undefined : v));
export async function saveSlot(slot, L) {
  const meta = { slot, team: `${L.teams[L.userTid].city} ${L.teams[L.userTid].name}`, abbr: L.teams[L.userTid].abbr, c1: L.teams[L.userTid].c1, season: L.season, phase: L.phase, savedAt: Date.now(), gm: L.gm.name };
  await tx('readwrite', st => { st.put(serialize(L), `L${slot}`); st.put(meta, `M${slot}`); });
  try { localStorage.setItem('hgm-last', String(slot)); } catch {}
  return meta;
}
export async function loadSlot(slot) { const s = await tx('readonly', st => st.get(`L${slot}`)); return s ? JSON.parse(s) : null; }
export async function slotMeta(slot) { return tx('readonly', st => st.get(`M${slot}`)); }
export async function listSlots() { const out = []; for (const s of [1, 2, 3]) out.push(await slotMeta(s) || null); return out; }
export async function deleteSlot(slot) { await tx('readwrite', st => { st.delete(`L${slot}`); st.delete(`M${slot}`); }); }
