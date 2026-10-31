// Draft class manager: custom prospects in any upcoming class (up to 10 drafts ahead), add/remove, export/import
// as JSON (format hgm-draftclass-1) and apply a saved class to any upcoming draft, replacing or merging with the
// real/generated class. Presets themselves live on the device (UI localStorage); the engine only reads/writes classes.
import { generateVeteran, ovrFromAttrs, devTrait, internalFor, FILE_KEYS } from './players.js';
import { clamp } from './rng.js';
import { POS } from './constants.js';
import { reindex, logTx, resetSeasonStats } from './league.js';
export const DC_FORMAT = 'hgm-draftclass-1', DC_AHEAD = 10, DC_MAX = 120;
// the next draft: this season's if the draft hasn't happened yet, otherwise next season's
export function nextDraftYear(L) { const after = ['RESIGN', 'FA1', 'FA2', 'FA3', 'SUMMER'].includes(L.phase) || (L.phase === 'DRAFT' && L.draft?.done); return after ? L.season + 1 : L.season; }
export function classYears(L) { const y0 = nextDraftYear(L); return Array.from({ length: DC_AHEAD + 1 }, (_, i) => y0 + i); }
export const classOf = (L, y) => L.players.filter(p => p.tid === -2 && p.draft?.year === y);
function okYear(L, y) { y = +y; return classYears(L).includes(y) ? y : null; }
export function addProspect(L, { year, name, pos = 'SF', age = 19, ovr = 55 } = {}) {
  const y = okYear(L, year); if (y == null) return { ok: false, error: `Pick a draft from ${classYears(L)[0]} to ${classYears(L).at(-1)}.` };
  if (classOf(L, y).length >= DC_MAX) return { ok: false, error: `That class is full (${DC_MAX}).` };
  const p = generateVeteran(L.season, internalFor(clamp(+ovr || 55, 40, 99)));
  p.name = name ? String(name).slice(0, 40) : 'Custom Prospect'; if (POS.includes(pos)) p.pos = pos;
  // age is his age on draft night; until then he ages with the league
  const ageNow = clamp(+age || 19, 17, 30) - (y - L.season); p.age = Math.max(14, ageNow); p.born = L.season - p.age;
  p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.pot, p.ovr + 6); p.devTrait = devTrait(p);
  p.custom = true; p.real = false; p.arcKey = null; p.contract = null; p.tid = -2; p.draft = { year: y, round: null, pick: null, tid: null };
  resetSeasonStats(p, L.season); L.players.push(p); reindex(L);
  logTx(L, { type: 'edit', text: `Created and added to the ${y} draft class` }, [p.pid]);
  return { ok: true, pid: p.pid };
}
export function removeProspect(L, pid) {
  const i = L.players.findIndex(p => p.pid === +pid); const p = L.players[i];
  if (!p || p.tid !== -2) return { ok: false, error: 'Only undrafted prospects can be removed.' };
  L.players.splice(i, 1); reindex(L); return { ok: true, name: p.name };
}
const pick = (p) => ({ name: p.name, pos: p.pos, born: p.born, h: p.h, w: p.w, college: p.college || '', country: p.country || '',
  ratings: Object.fromEntries(FILE_KEYS.filter(k => typeof p.ratings[k] === 'number').map(k => [k, p.ratings[k]])), pot: p.pot, devTrait: p.devTrait, num: p.num || null });
export function exportClass(L, year, name) {
  const y = +year; const ps = classOf(L, y);
  return { format: DC_FORMAT, name: String(name || `${y} draft class`).slice(0, 60), year: y, size: ps.length, prospects: ps.map(p => ({ ...pick(p), draftAge: p.age + (y - L.season) })) };
}
export function validateClass(f) {
  if (!f || f.format !== DC_FORMAT || !Array.isArray(f.prospects)) return { ok: false, error: `Not a draft class file (format ${DC_FORMAT}).` };
  if (!f.prospects.length) return { ok: false, error: 'The class has no prospects.' };
  if (f.prospects.length > DC_MAX) return { ok: false, error: `Too many prospects (max ${DC_MAX}).` };
  for (const [i, r] of f.prospects.entries()) { if (!r || typeof r.name !== 'string' || !r.name.trim()) return { ok: false, error: `Prospect ${i + 1} has no name.` }; if (r.ratings && typeof r.ratings !== 'object') return { ok: false, error: `Prospect ${i + 1}: bad ratings.` }; }
  return { ok: true };
}
// mode 'replace': this draft uses ONLY the loaded class (the real/generated class is removed, or never generated
// for a future year); 'merge': the loaded prospects join it.
export function applyClass(L, f, year, mode = 'merge') {
  const v = validateClass(f); if (!v.ok) return v;
  const y = okYear(L, year); if (y == null) return { ok: false, error: `Pick a draft from ${classYears(L)[0]} to ${classYears(L).at(-1)}.` };
  if (L.phase === 'DRAFT' && y === L.season && L.draft) return { ok: false, error: 'This draft is already under way.' };
  if (mode === 'replace') { L.players = L.players.filter(p => !(p.tid === -2 && p.draft?.year === y)); (L.dcReplace ||= {})[y] = true; }
  const room = DC_MAX - classOf(L, y).length; const add = f.prospects.slice(0, Math.max(0, room)); const pids = [];
  for (const r of add) pids.push(mkProspect(L, r, y, f.name).pid);
  reindex(L); logTx(L, { type: 'edit', text: `${mode === 'replace' ? 'Replaced' : 'Merged into'} the ${y} draft class: "${f.name}" (${pids.length} prospects)` }, pids);
  return { ok: true, added: pids.length, size: classOf(L, y).length };
}
function mkProspect(L, r, y, from) {
  const p = generateVeteran(L.season, internalFor(clamp(+r.ovr || 55, 40, 99)));
  p.name = String(r.name).slice(0, 40); if (POS.includes(r.pos)) p.pos = r.pos;
  for (const k of FILE_KEYS) if (typeof r.ratings?.[k] === 'number') p.ratings[k] = clamp(Math.round(r.ratings[k]), 1, 99);
  const dAge = clamp(+(r.draftAge ?? r.age) || 19, 17, 30); p.age = Math.max(14, dAge - (y - L.season)); p.born = L.season - p.age;
  if (r.h) p.h = clamp(+r.h, 160, 240); if (r.w) p.w = clamp(+r.w, 60, 160); p.college = String(r.college || '').slice(0, 40); p.country = String(r.country || '').slice(0, 30);
  p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.ovr, clamp(+r.pot || p.ovr + 6, 40, 99)); p.devTrait = ['Super', 'Quick', 'Normal', 'Slow'].includes(r.devTrait) ? r.devTrait : devTrait(p);
  p.custom = true; p.real = false; p.arcKey = null; p.contract = null; p.tid = -2; p.draft = { year: y, round: null, pick: null, tid: null }; if (from) p.fromClass = from;
  resetSeasonStats(p, L.season); L.players.push(p); return p;
}
// Global edit for one draft year: { name, mode: 'merge'|'replace', prospects: [...], remove: [names of real prospects to drop] }.
// Applied right after the real/generated class is built, in every league (old saves pick it up for drafts not yet generated).
export function applyGlobal(L, g, y) {
  if (!g || !Array.isArray(g.prospects)) return 0;
  if (g.mode === 'replace') (L.dcReplace ||= {})[y] = true;
  const drop = new Set((g.remove || []).map(n => String(n).toLowerCase()));
  L.players = L.players.filter(p => !(p.tid === -2 && p.draft?.year === y && (g.mode === 'replace' ? !p.custom : drop.has(p.name.toLowerCase()))));
  const have = new Set(L.players.filter(p => p.draft?.year === y || p.tid >= -1).map(p => p.name.toLowerCase())); let n = 0;
  for (const r of g.prospects.slice(0, DC_MAX)) if (r?.name && !have.has(String(r.name).toLowerCase())) { mkProspect(L, r, y, g.name || 'Custom class'); n++; }
  reindex(L); if (n || drop.size) logTx(L, { type: 'edit', text: `Custom ${y} draft class applied (${n} added${drop.size ? `, ${drop.size} removed` : ''})` }, []);
  return n;
}
export function validateGlobal(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'Bad custom classes.' };
  for (const [y, g] of Object.entries(o)) { if (!/^\d{4}$/.test(y)) return { ok: false, error: `Bad year ${y}` }; if (!Array.isArray(g?.prospects)) return { ok: false, error: `${y}: no prospects list` }; }
  return { ok: true };
}
// the real class for any year straight from the data (to show/edit before a league reaches it)
export function realClass(data, y) { return (data?.classes?.classes?.[y] || []).map(r => ({ name: r.n, pos: r.pos, draftAge: r.age, pick: r.dp, round: r.dr, college: r.col })); }
