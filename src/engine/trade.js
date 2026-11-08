import { rand, shuffle, clamp, randInt } from './rng.js';
import { capFor, ROSTER_MAX } from './constants.js';
import { marketValue, dispRating } from './players.js';
import { teamPlayers, getP, payroll, cap, msg, news, logTx, diff, standings, teamOvr } from './league.js';
import { deadlineDay, tradeMargin } from './franchise.js';

export function playerValue(L, p, forTid = null) {
  let v = p.ovr; if (p.age <= 25) v = p.ovr * 0.6 + p.pot * 0.4; if (p.age >= 31) v -= (p.age - 30) * 1.5;
  let val = Math.pow(Math.max(0, v - 40), 2.1) / 12;
  if (p.contract) {
    const yrs = Math.max(1, p.contract.exp - L.season + 1);
    const surplus = (marketValue(p, L.season) - p.contract.amt) / capFor(L.season); // fraction of cap per year
    val += surplus * 60 * Math.min(yrs, 4);
  }
  if (p.injury && p.injury.games > 20) val *= 0.7;
  return Math.max(0, Math.round(val));
}
export function projectedSlot(L, tid) {
  const rec = standings(L); const r = rec[tid];
  const ovrRank = L.teams.map(t => ({ tid: t.tid, o: teamOvr(L, t.tid) })).sort((a, b) => a.o - b.o).findIndex(x => x.tid === tid) + 1;
  const pctRank = rec.slice().sort((a, b) => a.pct - b.pct).findIndex(x => x.tid === tid) + 1;
  const w = r.gp / 82; return Math.round(pctRank * w + ovrRank * (1 - w));
}
export function pickValue(L, pk) {
  let slot = projectedSlot(L, pk.orig);
  const years = pk.season - L.season - (['RESIGN', 'FA1', 'FA2', 'FA3', 'SUMMER', 'PRESEASON', 'REGULAR', 'PLAYOFFS'].includes(L.phase) ? 0 : 0);
  if (years >= 1) { const w = Math.max(0, 0.5 - 0.1 * (years - 1)); slot = Math.round(slot * w + 15 * (1 - w)); } // future picks regress to middle (fully by ~5 years out)
  if (L.draftOrder && pk.season === L.season) { const o = L.draftOrder.find(x => x.id === pk.id); if (o) slot = o.pick - (pk.round === 2 ? 29 : 0); }
  const base = pk.round === 1 ? 260 * Math.pow(0.9, slot - 1) + 25 : 18 * Math.pow(0.97, slot - 1) + 4;
  return Math.round(base * (years >= 1 ? 0.85 * Math.pow(0.88, years - 1) : 1)); // v45: far-future picks discounted
}
const salaryOf = (L, pids) => pids.reduce((s, id) => s + (getP(L, id).contract?.amt || 0), 0);
const sideArr = (xs) => Array.isArray(xs) ? xs : [];
// offer: { tidA, tidB, aPids, aPicks, bPids, bPicks } — A gives aPids/aPicks to B, receives bPids/bPicks
function ownedHere(L, tid, pids, picks) {
  const abbr = L.teams?.[tid]?.abbr || 'that team';
  for (const id of pids) { const p = getP(L, id); if (!p || p.tid !== tid) return `${p?.name || 'A player'} is not on ${abbr}.`; }
  for (const id of picks) { const k = (L.picks || []).find(p => p.id === id); if (!k || k.tid !== tid) return `A pick in this trade is no longer owned by ${abbr}.`; }
  if (new Set(pids).size !== pids.length || new Set(picks).size !== picks.length) return 'This trade lists the same asset twice.';
  return null;
}
export function tradeKey(o) {
  const j = (xs) => sideArr(xs).slice().sort().join(',');
  return `${o.tidA}:${o.tidB}:${j(o.aPids)}:${j(o.aPicks)}:${j(o.bPids)}:${j(o.bPicks)}`;
}
export function validateTrade(L, o) {
  if (!o || o.tidA == null || o.tidB == null || o.tidA === o.tidB) return { ok: false, error: 'Pick two different teams.' };
  if (L.phase === 'REGULAR' && L.day > deadlineDay(L)) return { ok: false, error: 'The trade deadline has passed.' };
  if (['PLAYOFFS', 'FA1', 'FA2', 'FA3'].includes(L.phase)) return { ok: false, error: `Trades are closed during ${L.phase.startsWith('FA') ? 'free agency' : 'the playoffs'}.` };
  const aPids = sideArr(o.aPids), aPicks = sideArr(o.aPicks), bPids = sideArr(o.bPids), bPicks = sideArr(o.bPicks);
  if (!aPids.length && !aPicks.length && !bPids.length && !bPicks.length) return { ok: false, error: 'Empty trade.' };
  if (new Set([...aPids, ...bPids]).size !== aPids.length + bPids.length) return { ok: false, error: 'The same player is listed on both sides.' };
  const own = ownedHere(L, o.tidA, aPids, aPicks) || ownedHere(L, o.tidB, bPids, bPicks);
  if (own) return { ok: false, error: own };
  for (const [tid, give, get] of [[o.tidA, aPids, bPids], [o.tidB, bPids, aPids]]) {
    const n = teamPlayers(L, tid).filter(p => !p.il).length - give.filter(id => !getP(L, id).il).length + get.filter(id => !getP(L, id).il).length;
    if (n > ROSTER_MAX) return { ok: false, error: `${L.teams[tid].abbr} would have ${n} players (max ${ROSTER_MAX}).` };
    const out = salaryOf(L, give), inc = salaryOf(L, get);
    const after = payroll(L, tid) - out + inc;
    if (L.settings?.capMode === 'hard' && after > cap(L) && inc > out) return { ok: false, error: `${L.teams[tid].abbr} would be over the hard cap.` };
    if (L.settings?.capMode !== 'off' && after > cap(L) && inc > out * 1.25 + 100) return { ok: false, error: `${L.teams[tid].abbr} is over the cap: incoming salary must be ≤125% of outgoing + $0.1M.` };
  }
  return { ok: true };
}
export function evaluateTrade(L, o) {
  const v = validateTrade(L, o); if (!v.ok) return v;
  const giveV = o.aPids.reduce((s, id) => s + playerValue(L, getP(L, id)), 0) + o.aPicks.reduce((s, id) => s + pickValue(L, L.picks.find(p => p.id === id)), 0);
  const getV = o.bPids.reduce((s, id) => s + playerValue(L, getP(L, id)), 0) + o.bPicks.reduce((s, id) => s + pickValue(L, L.picks.find(p => p.id === id)), 0);
  // CPU side is B; buying costs more than selling
  const margin = (o.tidA === L.userTid ? tradeMargin(L, diff(L).tradeMargin) - (L.gm.archetype === 'Dealmaker' ? 0.05 : 0) : 0) + 0.05;
  const need = getV * (1 + margin) + 3;
  return { ok: giveV >= need, giveV, getV, need: Math.round(need), error: giveV >= need ? null : `${L.teams[o.tidB].abbr} wants more value (${giveV} vs ${Math.round(need)} needed).` };
}
// Commissioner multi-team trade (2-4 teams): moves = [{ pid | pick, to }]; all-or-nothing
export function executeMultiTrade(L, tids, moves) {
  if (new Set(tids).size !== tids.length || tids.length < 2 || tids.length > 4) return { ok: false, error: 'Pick 2-4 different teams' };
  for (const m of moves) { const from = m.pid != null ? getP(L, m.pid)?.tid : L.picks.find(k => k.id === m.pick)?.tid;
    if (from == null || !tids.includes(from) || !tids.includes(m.to) || from === m.to) return { ok: false, error: 'An asset is no longer with its team' }; m.from = from; }
  if (!moves.length) return { ok: false, error: 'Nothing selected' };
  for (const m of moves) { if (m.pid != null) getP(L, m.pid).tid = m.to; else L.picks.find(k => k.id === m.pick).tid = m.to; }
  syncDraftOrder(L);
  for (const tid of tids) { const t = L.teams[tid]; if (t.rotation) t.rotation = null; }
  const nm = (m) => m.pid != null ? getP(L, m.pid).name : pickShort(L, m.pick);
  const text = `${tids.length}-team trade: ` + tids.map(t => `${L.teams[t].abbr} get ${moves.filter(m => m.to === t).map(nm).join(', ') || 'nothing'}`).join('; ') + '.';
  news(L, `🔁 ${text}`, 'trade', tids[0]); logTx(L, { type: 'trade', text }, moves.filter(m => m.pid != null).map(m => m.pid));
  return { ok: true, text };
}
// v43: after a pick changes hands, both the stored order and the live draft's order follow it (they are separate arrays after a save reload)
// v44: pick numbers. Exact once this year's order is set (lottery done / draft live); otherwise projected from current records (worst = #1).
export function pickNumber(L, k) {
  if (!k) return null; const ord = L.draft?.order?.some(d => d.id === k.id) ? L.draft.order : L.draftOrder;
  const d = ord?.find(o => o.id === k.id && o.pick); if (d) return { n: d.pick, inRound: d.pick - (k.round - 1) * Math.round(ord.length / Math.max(1, Math.max(...ord.map(o => o.round)))), exact: true };
  const act = L.teams.filter(t => !t.inactive); const N = act.length;
  const st = standings(L); const gp = st.some(r => r.gp > 0);
  const pct = (tid) => gp ? st[tid]?.pct ?? 0.5 : (L.teams[tid].lastWinPct ?? 0.5);
  const rk = act.map(t => t.tid).sort((a, b) => pct(a) - pct(b) || a - b).indexOf(k.orig);
  if (rk < 0) return null; return { n: (k.round - 1) * N + rk + 1, inRound: rk + 1, exact: false };
}
export function pickLabel(L, k) { const q = pickNumber(L, k); const ab = L.teams[k.orig]?.abbr || '?';
  return !q ? `${k.season} Rd ${k.round} (${ab})` : q.exact ? `${k.season} Rd ${k.round} #${q.n} (${ab})` : `${k.season} Rd ${k.round} (${ab}, proj. #${q.n})`; }
export function pickShort(L, id) { const k = L.picks.find(z => z.id === id) || L.pickLog?.[id]; if (!k) return id.replace(/-(\d)-/, ' R$1 ');
  const q = pickNumber(L, k); const ab = L.teams[k.orig]?.abbr || '?'; return `${k.season} R${k.round} ${q ? (q.exact ? '#' : 'proj #') + q.n + ' ' : ''}${ab}`; }
export function syncDraftOrder(L) { for (const arr of [L.draftOrder, L.draft?.order]) if (arr) for (const d of arr) { const pk = L.picks.find(p => p.id === d.id); if (pk) d.tid = pk.tid; } }
export function executeTrade(L, o) {
  for (const id of o.aPids) { const p = getP(L, id); p.tid = o.tidB; }
  for (const id of o.bPids) { const p = getP(L, id); p.tid = o.tidA; }
  for (const id of o.aPicks) L.picks.find(p => p.id === id).tid = o.tidB;
  for (const id of o.bPicks) L.picks.find(p => p.id === id).tid = o.tidA;
  syncDraftOrder(L);
  for (const tid of [o.tidA, o.tidB]) { const t = L.teams[tid]; if (t.rotation) t.rotation = null; }
  const desc = (pids, picks) => [...pids.map(id => getP(L, id).name), ...picks.map(id => pickShort(L, id))].join(', ') || 'nothing';
  const text = `${L.teams[o.tidA].abbr} trade ${desc(o.aPids, o.aPicks)} to ${L.teams[o.tidB].abbr} for ${desc(o.bPids, o.bPicks)}.`;
  if (o.tidA === L.userTid || o.tidB === L.userTid) {
    const g = L.gm; g.trades = (g.trades || 0) + 1; g.tradesBy ||= {}; g.tradesBy[L.season] = (g.tradesBy[L.season] || 0) + 1;
    const got = o.tidA === L.userTid ? o.bPids : o.aPids; if (got.some(id => dispRating(getP(L, id).ovr) >= 90)) g.blockbuster = true;
  }
  news(L, `🔁 ${text}`, 'trade', o.tidA); logTx(L, { type: 'trade', text }, [...o.aPids, ...o.bPids]);
  return text;
}
// "Shop this player": CPU teams build packages for a user asset
export function findOffers(L, pid, max = 4) {
  const p = getP(L, pid); const target = playerValue(L, p); const offers = [];
  for (const t of shuffle(L.teams.filter(t => t.tid !== L.userTid && !t.inactive))) {
    const roster = teamPlayers(L, t.tid).map(x => ({ x, v: playerValue(L, x) })).filter(y => y.v < target * 0.95).sort((a, b) => b.v - a.v);
    const picks = L.picks.filter(k => k.tid === t.tid).map(k => ({ k, v: pickValue(L, k) })).sort((a, b) => b.v - a.v);
    const pkg = { pids: [], picks: [] }; let sum = 0; const goal = target * 0.92;
    for (const y of roster) { if (sum >= goal || pkg.pids.length >= 3) break; if (sum + y.v <= target * 1.05) { pkg.pids.push(y.x.pid); sum += y.v; } }
    for (const y of picks) { if (sum >= goal || pkg.picks.length >= 2) break; if (sum + y.v <= target * 1.15) { pkg.picks.push(y.k.id); sum += y.v; } }
    if (sum < goal) continue;
    const o = { tidA: L.userTid, tidB: t.tid, aPids: [pid], aPicks: [], bPids: pkg.pids, bPicks: pkg.picks };
    if (validateTrade(L, o).ok) offers.push({ ...o, value: sum });
    if (offers.length >= max) break;
  }
  return offers;
}
export function cpuTrade(L) {
  const ts = shuffle(L.teams.filter(t => t.tid !== L.userTid && !t.inactive)).slice(0, 2); if (ts.length < 2) return;
  const [A, B] = ts; const pa = teamPlayers(L, A.tid).sort(() => rand() - 0.5)[0]; if (!pa) return;
  const va = playerValue(L, pa);
  const cand = teamPlayers(L, B.tid).map(x => ({ x, v: playerValue(L, x) })).filter(y => Math.abs(y.v - va) <= Math.max(8, va * 0.12) && y.x.pos !== pa.pos);
  if (!cand.length) return; const pb = cand[randInt(0, cand.length - 1)].x;
  const o = { tidA: A.tid, tidB: B.tid, aPids: [pa.pid], aPicks: [], bPids: [pb.pid], bPicks: [] };
  if (validateTrade(L, o).ok) executeTrade(L, o);
}
