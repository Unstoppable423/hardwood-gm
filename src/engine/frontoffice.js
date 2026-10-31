// Front office layer (PGM2 parity): fan support meter, owner check-ins, contract-negotiation patience with agent
// feedback, and GM-voice trade responses. Original text; registered on HOOKS after pgm2.js.
import { clamp } from './rng.js';
import { HOOKS, teamPlayers, getP, msg, msgBatch, teamOvr } from './league.js';
import { resignOffer, userOffer, askingAmount, moodToward, prefYears } from './offseason.js';
import { extendContract, extensionAsk } from './pgm2.js';
import { evaluateTrade, playerValue, pickValue, validateTrade, pickLabel } from './trade.js';

// ---------- Fans ----------
export function fanLabel(v) { return v >= 85 ? 'Electric' : v >= 70 ? 'Buzzing' : v >= 55 ? 'Loyal' : v >= 40 ? 'Restless' : v >= 25 ? 'Frustrated' : 'Apathetic'; }
export function fan(L, tid = L.userTid) {
  L.fans ||= {};
  if (L.fans[tid] == null) { const h = (L.teamHist || []).filter(x => x.tid === tid).at(-1); const pct = h ? h.w / (h.w + h.l) : 0.5; L.fans[tid] = Math.round(30 + pct * 45); }
  return L.fans[tid];
}
function bumpFan(L, d, why) {
  const tid = L.userTid; const v = fan(L, tid); L.fans[tid] = clamp(Math.round((v + d) * 10) / 10, 0, 100);
  if (why) { (L.fanLog ||= []).unshift({ season: L.season, day: L.day, d: Math.round(d * 10) / 10, why }); if (L.fanLog.length > 40) L.fanLog.length = 40; }
}
const userGames = (L) => L.schedule.filter(g => g.played && (g.h === L.userTid || g.a === L.userTid));
const won = (L, g) => (g.h === L.userTid) === (g.hs > g.as);

// ---------- Daily: fans react to results; owner checks in at the quarter marks ----------
const prevDay = HOOKS.day;
HOOKS.day = (L) => {
  prevDay?.(L);
  if (L.phase !== 'REGULAR') return;
  L.fo ||= {}; if (L.fo.season !== L.season) L.fo = { ...L.fo, season: L.season, seen: 0 };
  const gs = userGames(L); const n = gs.length;
  if (L.fo.seen === n) return;
  for (const g of gs.slice(L.fo.seen || 0)) {
    const w = won(L, g), margin = Math.abs(g.hs - g.as), home = g.h === L.userTid;
    bumpFan(L, (w ? 0.45 : -0.4) * (home ? 1.15 : 1) + (w && margin >= 20 ? 0.3 : 0) - (!w && margin >= 25 ? 0.3 : 0));
  }
  let st = 0; for (let i = gs.length - 1; i >= 0; i--) { const w = won(L, gs[i]); if (st === 0) st = w ? 1 : -1; else if ((st > 0) === w) st += w ? 1 : -1; else break; }
  const key = `${L.season}:${st > 0 ? 'w' : 'l'}${Math.floor(Math.abs(st) / 6)}`;
  if (Math.abs(st) >= 6 && L.fo.streakMail !== key) {
    L.fo.streakMail = key;
    if (st > 0) { bumpFan(L, 3, `${st}-game win streak`); msg(L, 'Fan Mail', `${st} straight wins!`, `The arena is sold out and the phones won't stop ringing. The season-ticket waitlist is growing. Fan support: ${fanLabel(fan(L))}.`, { pri: 'low' }); }
    else { bumpFan(L, -3, `${-st}-game losing streak`); msg(L, 'Fan Mail', `${-st} losses in a row`, `Empty seats in the upper deck and boos in the fourth quarter. The fans want changes. Fan support: ${fanLabel(fan(L))}.`, { pri: 'low' }); }
  }
  for (const mark of [20, 41, 62]) if (n >= Math.round(mark * (L.seasonGames || 82) / 82) && !(L.fo.checks || []).includes(`${L.season}:${mark}`)) { (L.fo.checks ||= []).push(`${L.season}:${mark}`); ownerCheckIn(L, mark, gs.slice(0, mark)); }
  L.fo.seen = n;
};
function ownerCheckIn(L, mark, gs) {
  const w = gs.filter(g => won(L, g)).length, l = gs.length - w; const ex = L.expectation; if (!ex) return;
  const G = L.seasonGames || 82; const pace = Math.round(w / gs.length * G); const tgt = Math.round(ex.wins * G / 82); const d = (pace - tgt) * 82 / G; const f = fan(L);
  const tone = d >= 6 ? 'ahead' : d >= -3 ? 'on' : d >= -9 ? 'behind' : 'far';
  const lines = { ahead: `We're ${w}-${l} and on pace for ${pace} wins — ahead of the ${tgt} I expected. Keep this going.`,
    on: `${w}-${l}, on pace for about ${pace} wins. That's where I expected us. Don't let it slip.`,
    behind: `${w}-${l}. That pace (${pace} wins) is short of the ${tgt} we talked about. I expect improvement.`,
    far: `${w}-${l}. On pace for ${pace} wins against a target of ${tgt}. This is not acceptable. Fix it, or I will.` }[tone];
  const fanLine = f >= 70 ? ' The fans are loving it — attendance is up.' : f < 40 ? ' The fans are turning on us, and that hits my wallet.' : '';
  const delta = { ahead: 2, on: 0, behind: -2, far: -4 }[tone] + (f >= 75 ? 1 : f < 30 ? -1 : 0);
  L.gm.jobSecurity = clamp(L.gm.jobSecurity + delta, 0, 100);
  msgBatch(L, 'ownerchk', 'Owner', 'Owner check-ins', `${mark === 41 ? 'Midseason' : mark === 20 ? 'Quarter-season' : 'Three-quarter'} check-in. ${lines}${fanLine}\n\nGoal: ${ex.goal}. Job security ${L.gm.jobSecurity}/100 (${delta >= 0 ? '+' : ''}${delta}).`, { pri: 'normal', days: 200 });
  L.fo.lastCheck = { season: L.season, mark, w, l, pace, target: tgt, tone, delta };
}

// ---------- Season-end fan reaction feeds the owner's view; preseason regression ----------
const prevPhase = HOOKS.phase;
HOOKS.phase = (L, from) => {
  prevPhase?.(L, from);
  if (L.phase === 'AWARDS' && L.lastReview) {
    const rv = L.lastReview; bumpFan(L, rv.champ ? 14 : rv.roundsWon * 3 + (rv.madePO ? 3 : -4), rv.champ ? 'Championship' : rv.madePO ? 'Playoff run' : 'Missed playoffs');
    const f = fan(L); const d = f >= 75 ? 3 : f >= 60 ? 1 : f < 30 ? -4 : f < 45 ? -2 : 0;
    if (d) { L.gm.jobSecurity = clamp(L.gm.jobSecurity + d, 0, 100); rv.fanDelta = d; }
    rv.fan = Math.round(f);
  }
  if (L.phase === 'PRESEASON') { const v = fan(L); L.fans[L.userTid] = Math.round(v + (50 - v) * 0.15); L.fo = { ...(L.fo || {}), seen: 0, season: L.season }; }
};
const prevNew = HOOKS.newLeague;
HOOKS.newLeague = (L) => { prevNew?.(L); fan(L); L.fo = { seen: 0, season: L.season }; };

// ---------- Contract negotiation (PGM2: counter feedback; talks end after repeated lowballs) ----------
export const MAX_TRIES = 3;
export function interestWord(m) { return m >= 1.12 ? 'Eager' : m >= 1.0 ? 'Interested' : m >= 0.9 ? 'Lukewarm' : m >= 0.8 ? 'Reluctant' : 'Not interested'; }
export function talks(L, p, kind) { const key = `${L.season}:${kind}`; if (p.talks?.key !== key) p.talks = { key, tries: 0, ended: false, last: null }; return p.talks; }
export function negotiate(L, pid, kind, amt, years, raise = 0) {
  const p = getP(L, pid); const t = talks(L, p, kind);
  if (L.settings?.morale === false && !L.settings?.cpuMoves) { t.ended = false; t.tries = 0; if (kind === "resign") p.willing = true; } // stable rosters: agent patience never runs out
  if (t.ended || (kind === 'resign' && !p.willing)) return { ok: false, error: `${p.name}'s agent: "We're not interested in further negotiations."`, agent: { ended: true, tries: t.tries, max: MAX_TRIES } };
  const r = kind === 'resign' ? resignOffer(L, pid, amt, years, raise) : kind === 'ext' ? extendContract(L, pid, amt, years) : userOffer(L, pid, amt, years, raise);
  if (r.ok) { p.talks = null; return r; }
  if (!/rejected|wants about/i.test(r.error || '')) return r; // validation errors (cap, roster, years) don't cost patience
  t.tries++;
  const ask = kind === 'resign' ? p.resignAsk : kind === 'ext' ? extensionAsk(L, p) : askingAmount(L, p, L.userTid, L.phase === 'REGULAR' ? 'inseason' : 'fa', 3);
  const mood = moodToward(L, p, L.userTid); const py = kind === 'ext' ? years : prefYears(p, L);
  const yrPen = 1 + 0.04 * Math.abs(years - prefYears(p, L));
  const need = Math.round((kind === 'ext' ? ask * 0.97 : ask * yrPen * 0.98 / Math.max(0.6, mood)) / 10 + 0.5) * 10;
  const gap = need / Math.max(1, amt) - 1; const M = (v) => v >= 1000 ? `$${(v / 1000).toFixed(2)}M` : `$${Math.round(v)}K`;
  let text;
  if (t.tries >= MAX_TRIES) { t.ended = true; if (kind === 'resign') p.willing = false; text = `That's three offers short of where we need to be. My client is done talking with you${kind === 'resign' ? ' and will test free agency' : ' for now'}.`; }
  else if (gap > 0.25) text = `That's not a serious offer. We're looking for around ${M(need)} a year${py !== years ? ` over ${py} years` : ''}.`;
  else if (gap > 0.08) text = `We're apart, but there's a deal here. ${M(need)} per year${py !== years ? ` on a ${py}-year deal` : ''} gets it done.`;
  else text = `Close. Bump it to ${M(need)}${py !== years ? ` and make it ${py} years` : ''} and we'll sign today.`;
  if (t.tries === MAX_TRIES - 1) text += ' This is your last chance.';
  t.last = { text, need, years: py };
  return { ok: false, error: text, agent: { text, need, years: py, tries: t.tries, max: MAX_TRIES, ended: t.ended } };
}

// ---------- Trade AI feedback: what they think, and what would close the gap ----------
export function teamMode(L, tid) { const o = L.teams.map(t => ({ tid: t.tid, o: teamOvr(L, t.tid) })).sort((a, b) => b.o - a.o); const r = o.findIndex(x => x.tid === tid) + 1; return r <= 9 ? 'contend' : r >= 21 ? 'rebuild' : 'middle'; }
export function tradeFeedback(L, o) {
  const v = validateTrade(L, o); if (!v.ok) return { ok: false, lines: [v.error], suggest: null };
  const ev = evaluateTrade(L, o); const them = L.teams[o.tidB]; const mode = teamMode(L, o.tidB); const lines = [];
  const theirBest = teamPlayers(L, o.tidB).sort((a, b) => b.ovr - a.ovr)[0];
  const get = o.aPids.map(id => getP(L, id)), give = o.bPids.map(id => getP(L, id));
  if (give.some(p => p.pid === theirBest?.pid)) lines.push(`${theirBest.name} is the face of our franchise. It would take a lot.`);
  if (mode === 'contend' && (o.aPicks.length || get.some(p => p.age <= 22 && p.ovr < 70))) lines.push(`We're trying to win now — picks and projects don't help us this year.`);
  if (mode === 'rebuild' && get.some(p => p.age >= 30)) lines.push(`We're rebuilding. Veterans over 30 aren't worth much to us.`);
  if (mode === 'rebuild' && (o.aPicks.length || get.some(p => p.age <= 23))) lines.push(`Young players and picks fit our timeline.`);
  let suggest = null;
  if (ev.ok) lines.unshift(ev.giveV >= ev.need * 1.25 ? `You're overpaying — but we'll take it.` : `That works for us. Send it over.`);
  else {
    const short = ev.need - ev.giveV; lines.unshift(short > ev.need * 0.5 ? `Not even close.` : short > ev.need * 0.2 ? `You'll need to add more.` : `We're close.`);
    const pool = [...teamPlayers(L, o.tidA).filter(p => !o.aPids.includes(p.pid)).map(p => ({ kind: 'p', id: p.pid, name: p.name, v: playerValue(L, p) })),
      ...L.picks.filter(k => k.tid === o.tidA && !o.aPicks.includes(k.id)).map(k => ({ kind: 'k', id: k.id, name: pickLabel(L, k), v: pickValue(L, k) }))]
      .filter(x => x.v >= short).sort((a, b) => a.v - b.v);
    for (const c of pool.slice(0, 6)) {
      const o2 = { ...o, aPids: c.kind === 'p' ? [...o.aPids, c.id] : o.aPids, aPicks: c.kind === 'k' ? [...o.aPicks, c.id] : o.aPicks };
      if (validateTrade(L, o2).ok && evaluateTrade(L, o2).ok) { suggest = c; break; }
    }
    if (suggest) lines.push(`Add ${suggest.name} and we have a deal.`);
  }
  return { ok: ev.ok, lines, suggest, mode, from: `${them.city} GM`, pct: ev.need ? Math.min(100, Math.round(ev.giveV / ev.need * 100)) : 0 };
}
