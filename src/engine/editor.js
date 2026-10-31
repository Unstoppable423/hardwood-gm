// Player editor + free-agent pool editor (2K MyLeague-style commissioner tools).
// The editor works on the DISPLAY scale (40-99); unchanged values keep their exact internal number.
import { addProspect } from './draftclass.js';
import { clamp } from './rng.js';
import { eligiblePos, ATTRS, ovrFromAttrs, dispRating, internalFor, deriveDefSkills, devTrait, generateVeteran, posFrom } from './players.js';
import { getP, teamPlayers, reindex, logTx, ensureNumbers, news } from './league.js';
import { minSalary, maxSalary, ROSTER_MAX, POS } from './constants.js';
import { raiseCap, yearOneFor, maxYears, isOffseasonBeforeNewYear } from './offseason.js';
import { careerOf, careerMode, arcPot } from './careers.js';

export const EDIT_ATTRS = [...ATTRS, 'sco', 'sta', 'dur'];
export const EDIT_LABEL = { ins: 'Inside scoring', out: 'Outside shooting', pas: 'Passing', han: 'Ball handling', reb: 'Rebounding', idef: 'Interior D', pdef: 'Perimeter D', ath: 'Athleticism', iq: 'IQ', sco: 'Scoring', sta: 'Stamina', dur: 'Durability' };
export const DEV_TRAITS = ['Super', 'Quick', 'Normal', 'Slow', 'Peaked'];
const DEV_GAP = { Super: 13, Quick: 8, Normal: 4.5, Slow: 2, Peaked: 0 };
export const CAREER_LEN = [[0.8, 'Short'], [1, 'Normal'], [1.2, 'Long']]; // multiplies decline/retirement (longevity)
export const INJURY_TYPES = ['Sprained ankle', 'Knee sprain', 'Hamstring strain', 'Back spasms', 'Broken hand', 'Torn ACL', 'Achilles tear', 'Concussion'];

const contractYears = (L, c) => !c ? 0 : c.exp - L.season + (isOffseasonBeforeNewYear(L) ? 0 : 1);
export function editorModel(L, p) {
  const r = Object.fromEntries(EDIT_ATTRS.map(k => [k, dispRating(p.ratings[k] ?? 50)]));
  const c = p.contract;
  return { name: p.name, tid: p.tid, pos: p.pos, pos2: eligiblePos(p).filter(x => x !== p.pos).slice(0, 2), num: p.num ?? '', age: p.age, h: p.h, w: p.w, attrs: r, pot: dispRating(p.pot),
    devTrait: devTrait(p), work: p.traits?.work || 'Medium', lon: (p.lon ?? 1) <= 0.9 ? 0.8 : (p.lon ?? 1) >= 1.1 ? 1.2 : 1,
    contract: c ? { amt: c.aav ?? c.amt, yrs: Math.max(1, contractYears(L, c)), raise: c.raise || 0 } : null,
    injury: p.injury ? { type: p.injury.type, games: p.injury.games } : null, mood: p.mood ?? 50, peak: p.peakTarget ?? '' };
}
// live OVR while editing (display scale)
export function previewOvr(p, m) {
  const ratings = { ...p.ratings }; for (const k of EDIT_ATTRS) if (m.attrs[k] !== dispRating(p.ratings[k] ?? 50)) ratings[k] = internalFor(m.attrs[k]);
  return dispRating(ovrFromAttrs(ratings, m.pos || p.pos));
}
export function validateEdit(L, p, m) {
  const e = []; const int = (v) => Number.isInteger(+v) && String(v).trim() !== '';
  if (!m.name || !String(m.name).trim() || String(m.name).length > 40) e.push('Name must be 1-40 characters.');
  if (!POS.includes(m.pos)) e.push('Position must be PG, SG, SF, PF or C.');
  if (!int(m.age) || m.age < 17 || m.age > 45) e.push('Age must be 17-45.');
  if (!(m.h >= 160 && m.h <= 240)) e.push('Height must be 5\' 3" to 7\' 10".');
  if (!(m.w >= 60 && m.w <= 170)) e.push('Weight must be 135-370 lb.');
  for (const k of EDIT_ATTRS) if (!int(m.attrs?.[k]) || m.attrs[k] < 40 || m.attrs[k] > 99) e.push(`${EDIT_LABEL[k]} must be 40-99.`);
  if (!int(m.pot) || m.pot < 40 || m.pot > 99) e.push('Potential must be 40-99.');
  if (m.peak !== '' && m.peak != null && (!int(+m.peak) || +m.peak < 40 || +m.peak > 99)) e.push('Peak rating must be 40-99, or blank for the real-career default.');
  if (m.devTrait && !DEV_TRAITS.includes(m.devTrait) && m.devTrait !== devTrait(p)) e.push('Unknown development trait.');
  if (!['Low', 'Medium', 'High'].includes(m.work)) e.push('Work ethic must be Low, Medium or High.');
  if (!(m.mood >= 0 && m.mood <= 100)) e.push('Morale must be 0-100.');
  const tid = +m.tid;
  if (!(tid === -1 || tid === p.tid || (tid >= 0 && L.teams[tid] && !L.teams[tid].inactive))) e.push('Unknown team.');
  if (tid >= 0 && tid !== p.tid && teamPlayers(L, tid).filter(x => !x.il).length >= ROSTER_MAX) e.push(`${L.teams[tid].abbr} already has ${ROSTER_MAX} active players.`);
  if (tid >= 0) {
    const n = String(m.num ?? '').trim();
    if (!/^\d{1,2}$/.test(n) || (n.length === 2 && n[0] === '0' && n !== '00')) e.push('Jersey number must be 0-99 or 00.');
    else {
      const mate = teamPlayers(L, tid).find(x => x.pid !== p.pid && x.num === n); if (mate) e.push(`#${n} is worn by ${mate.name}.`);
      const ret = (L.teams[tid].retiredNums || []).find(r => r.num === n); if (ret && !(p.num === n && p.tid === tid)) e.push(`#${n} is retired by the ${L.teams[tid].name} (${ret.name}).`);
    }
    if (m.contract) {
      const mx = maxSalary(L.season, p), my = maxYears(L, true), rc = raiseCap(L.season, true);
      if (!(m.contract.amt >= minSalary(L.season) && m.contract.amt <= mx)) e.push(`Salary must be $${(minSalary(L.season) / 1000).toFixed(2)}M-$${(mx / 1000).toFixed(2)}M.`);
      if (!int(m.contract.yrs) || m.contract.yrs < 1 || m.contract.yrs > my) e.push(`Contract years must be 1-${my}.`);
      if (Math.abs(m.contract.raise || 0) > rc + 1e-9) e.push(`Raise must be within ±${Math.round(rc * 1000) / 10}%.`);
    }
  }
  if (m.injury && (!int(m.injury.games) || m.injury.games < 0 || m.injury.games > 200)) e.push('Injury games must be 0-200.');
  return e;
}
export function applyEdit(L, pid, m) {
  const p = getP(L, pid); if (!p) return { ok: false, errors: ['Player not found'] };
  m = { ...m, tid: +m.tid, age: +m.age, h: +m.h, w: +m.w, pot: +m.pot, mood: +m.mood, attrs: Object.fromEntries(Object.entries(m.attrs || {}).map(([k, v]) => [k, +v])),
    contract: m.contract ? { amt: Math.round(+m.contract.amt / 10) * 10, yrs: +m.contract.yrs, raise: +(m.contract.raise || 0) } : null, injury: m.injury ? { ...m.injury, games: +m.injury.games } : null };
  const errors = validateEdit(L, p, m); if (errors.length) return { ok: false, errors };
  const before = editorModel(L, p); const changed = [];
  if (m.name.trim() !== p.name) { changed.push('name'); p.name = m.name.trim(); }
  if (m.pos !== p.pos) { changed.push('position'); p.pos = m.pos; p.natPos = m.pos; }
  if (Array.isArray(m.pos2)) { const n = m.pos2.filter(x => POS.includes(x) && x !== p.pos).slice(0, 2); if (n.join() !== (p.pos2 || []).join()) { changed.push('secondary positions'); p.pos2 = n; } }
  if (m.age !== p.age) { changed.push('age'); p.born = (p.born || L.season - p.age) - (m.age - p.age); p.age = m.age; }
  if (m.h !== p.h) { p.h = m.h; changed.push('height'); } if (m.w !== p.w) { p.w = m.w; changed.push('weight'); }
  for (const k of EDIT_ATTRS) if (m.attrs[k] !== before.attrs[k]) { p.ratings[k] = internalFor(m.attrs[k]); changed.push(k); p.arcOff = true; }
  deriveDefSkills(p); p.ovr = ovrFromAttrs(p.ratings, p.pos);
  let pot = m.pot !== before.pot ? internalFor(m.pot) : p.pot; if (m.pot !== before.pot) p.arcOff = true;
  if (m.devTrait && m.devTrait !== before.devTrait && DEV_TRAITS.includes(m.devTrait)) { pot = p.ovr + DEV_GAP[m.devTrait]; changed.push('dev trait'); }
  p.pot = clamp(Math.max(pot, p.ovr), 0, 100); p.devTrait = devTrait(p); if (m.pot !== before.pot) changed.push('potential');
  const pk = m.peak === '' || m.peak == null ? null : +m.peak;
  if (pk !== (p.peakTarget ?? null)) { if (pk == null) delete p.peakTarget; else p.peakTarget = pk; p.arcOff = false; changed.push('peak rating');
    // no real arc (or Random careers): the peak becomes his potential ceiling
    if (!careerOf(L, p) || careerMode(L) === 'random') { if (pk != null) p.pot = Math.max(p.ovr, internalFor(pk)); p.devTrait = devTrait(p); }
    else { const ap = arcPot(L, p, L.season + (isOffseasonBeforeNewYear(L) ? 0 : 1)); if (ap != null) p.pot = Math.max(p.ovr, ap); } }
  if (m.work !== before.work) { p.traits.work = m.work; changed.push('work ethic'); }
  if (m.lon !== before.lon) { p.lon = m.lon; changed.push('career length'); }
  if (m.mood !== before.mood) { p.mood = m.mood; if (p.mood >= 45 && p.tradeReq) p.tradeReq = null; changed.push('morale'); }
  // injury
  if (m.injury && m.injury.games > 0) { if (!p.injury || p.injury.games !== m.injury.games || p.injury.type !== m.injury.type) { p.injury = { type: m.injury.type || 'Injury', games: m.injury.games, gamesTotal: Math.max(m.injury.games, p.injury?.gamesTotal || 0) }; changed.push('injury'); } }
  else if (p.injury) { p.injury = null; if (p.il) p.il = false; changed.push('healed'); }
  // team / contract
  const wasRetired = p.retired;
  if (m.tid !== p.tid) {
    const from = p.tid; p.tid = m.tid; changed.push('team');
    if (wasRetired) { p.retired = false; p.retiredSeason = undefined; p.overseas = undefined; }
    if (m.tid === -1) { p.contract = null; p.il = false; }
    if (p.stats) p.stats.tid = m.tid;
    for (const t of [from, m.tid]) if (t >= 0) L.teams[t].rotation = null;
  }
  if (p.tid >= 0) {
    const c = m.contract || (p.contract ? null : { amt: minSalary(L.season), yrs: 1, raise: 0 });
    if (c && JSON.stringify(c) !== JSON.stringify(before.contract)) {
      const y1 = Math.round(yearOneFor(c.amt, c.yrs, c.raise)); const first = L.season + (isOffseasonBeforeNewYear(L) ? 1 : 0);
      p.contract = { amt: y1, exp: first + c.yrs - 1, signed: L.season, ...(c.raise ? { raise: c.raise, base: y1, first, aav: c.amt } : {}) }; changed.push('contract');
    }
    const n = String(m.num).trim(); if (n !== p.num || p.numTid !== p.tid) { p.num = n; p.numTid = p.tid; (p.numHist ||= {})[p.tid] = n; changed.push('number'); }
  }
  p.edited = true; reindex(L); ensureNumbers(L);
  if (changed.length) logTx(L, { type: 'edit', text: `Edited: ${[...new Set(changed)].join(', ')}` }, [p.pid]);
  return { ok: true, changed: [...new Set(changed)], ovr: dispRating(p.ovr) };
}

// ---------- free-agent pool editor (offseason and the 1996 FA start) ----------
export const faPoolOpen = (L) => !['REGULAR', 'PLAYOFFS'].includes(L.phase);
export const faPool = (L) => L.players.filter(p => p.tid === -1 && !p.retired);
export function faRemove(L, pid) { // leaves the pool: signs overseas (can be brought back)
  const p = getP(L, pid); if (!faPoolOpen(L)) return { ok: false, error: 'The FA pool can be edited in the offseason.' };
  if (!p || p.tid !== -1) return { ok: false, error: 'Not a free agent.' };
  p.tid = -3; p.retired = true; p.overseas = true; p.retiredSeason = L.season; delete p.faAsk; delete p.faInterest;
  logTx(L, { type: 'edit', text: 'Removed from the free-agent pool (signed overseas)' }, [p.pid]); reindex(L); return { ok: true };
}
export function faAddExisting(L, pid) { // retired / overseas player returns, or a commissioner release (no dead money)
  const p = getP(L, pid); if (!faPoolOpen(L)) return { ok: false, error: 'The FA pool can be edited in the offseason.' };
  if (!p || p.tid === -1) return { ok: false, error: 'Already a free agent.' };
  const from = p.tid; if (p.tid === -2) return { ok: false, error: 'Draft prospects enter through the draft.' };
  if (p.retired) { p.retired = false; p.overseas = undefined; p.retiredSeason = undefined; }
  if (from >= 0) { p.formerTid = from; L.teams[from].rotation = null; }
  p.tid = -1; p.contract = null; p.il = false; if (p.stats) p.stats.tid = -1;
  logTx(L, { type: 'edit', text: from >= 0 ? `Commissioner release to free agency (from ${L.teams[from].abbr})` : 'Added to the free-agent pool' }, [p.pid]); reindex(L);
  return { ok: true };
}
export function faCreate(L, { name, pos = 'SF', age = 27, ovr = 70 } = {}) {
  if (!faPoolOpen(L)) return { ok: false, error: 'The FA pool can be edited in the offseason.' };
  const p = generateVeteran(L.season, internalFor(clamp(+ovr || 70, 40, 99))); p.tid = -1; p.draft = null; p.custom = true;
  if (name) p.name = String(name).slice(0, 40); if (POS.includes(pos)) p.pos = pos; p.age = clamp(+age || 27, 18, 42); p.born = L.season - p.age;
  p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.pot, p.ovr); p.devTrait = devTrait(p); p.stats = p.stats || {};
  L.players.push(p); reindex(L); logTx(L, { type: 'edit', text: 'Created and added to the free-agent pool' }, [p.pid]);
  return { ok: true, pid: p.pid };
}
// Create Player (any time): a fully custom player as a free agent or a prospect in the next draft class;
// the UI then opens the full player editor on him (team, ratings, contract, looks, peak...).
export function createPlayer(L, { name, pos = 'SF', age = 22, ovr = 70, kind = 'fa', year = null } = {}) {
  if (kind === 'prospect' && year != null) return addProspect(L, { year, name, pos, age: age === 22 ? 19 : age, ovr: ovr === 70 ? 55 : ovr });
  const p = generateVeteran(L.season, internalFor(clamp(+ovr || 70, 40, 99))); p.draft = null; p.custom = true; p.real = false; p.arcKey = null;
  p.name = name ? String(name).slice(0, 40) : 'Custom Player'; if (POS.includes(pos)) p.pos = pos; p.age = clamp(+age || 22, 17, 42); p.born = L.season - p.age;
  p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.pot, p.ovr); p.devTrait = devTrait(p); p.contract = null; p.stats = p.stats || {};
  if (kind === 'prospect') { const yrs = L.players.filter(x => x.tid === -2 && x.draft?.year).map(x => x.draft.year); const y = yrs.length ? Math.min(...yrs) : L.season;
    p.tid = -2; p.draft = { year: y, round: null, pick: null, tid: null }; }
  else p.tid = -1;
  L.players.push(p); reindex(L); logTx(L, { type: 'edit', text: kind === 'prospect' ? `Created and added to the ${p.draft.year} draft class` : 'Created as a free agent' }, [p.pid]);
  return { ok: true, pid: p.pid };
}
// asking price / years / interest overrides (cleared when the player signs)
export function faSetTerms(L, pid, { amt = null, yrs = null, interest = null } = {}) {
  const p = getP(L, pid); if (!faPoolOpen(L)) return { ok: false, error: 'The FA pool can be edited in the offseason.' };
  if (!p || p.tid !== -1) return { ok: false, error: 'Not a free agent.' };
  if (amt != null && !(amt >= minSalary(L.season) && amt <= maxSalary(L.season, p))) return { ok: false, error: 'Asking price outside the min/max salary.' };
  if (yrs != null && !(yrs >= 1 && yrs <= maxYears(L, false))) return { ok: false, error: `Years must be 1-${maxYears(L, false)}.` };
  if (interest != null && !(interest >= 0.6 && interest <= 1.4)) return { ok: false, error: 'Interest must be 0.6-1.4.' };
  p.faAsk = amt == null && yrs == null ? undefined : { amt: amt == null ? null : Math.round(amt / 10) * 10, yrs };
  p.faInterest = interest == null ? undefined : interest;
  return { ok: true };
}
