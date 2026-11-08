import { applyEraRules } from './histstart.js';
import { stintsForArchive } from './leaders.js';
import { rand, randInt, normal, pick, shuffle, clamp, weighted, getSeed } from './rng.js';
import { teamFit } from './schemes.js';
import { applyHistory, lotteryRule } from './history.js';
import { ERA, gpReq } from './era.js';
import { managedSet, homeTid } from './control.js';
import { applyArc, careerOf, normName, careerMode, realTeamTid, arcYearsFrom, applyPeakNow, DEFAULT_PEAKS } from './careers.js';
import { taxActive, taxLine, applyRules, stableRosters } from './franchise.js';
import { capFor, minSalary, maxSalary, ROSTER_MAX, ROSTER_MIN, LOTTERY_WEIGHTS, PHASES } from './constants.js';
import { marketValue, progress, anchorRatings, attrTops, anchorAttrTails, longevity, devTrait, capFictional, floorReal, generateVeteran, generateProspect, prospectFromReal, dispRating, ovrFromAttrs, eligiblePos } from './players.js';
import { HOOKS, teamPlayers, getP, reindex, payroll, cap, msg, msgBatch, news, diff, teamName, teamOvr, standings, confSeeds, makeSchedule,
  startPlayoffs, seasonDone, resetSeasonStats, prodScore, createDraftClass, addPicksForSeason, ensureFuturePicks, genStaff, staffEffects, draftControls, logTx } from './league.js';

// ================= phase machine =================
export function advance(L) {
  if (L.fdraft) return { ok: false, error: 'Finish the fantasy draft first.' };
  applyRules(L);
  const ph = L.phase;
  // season review / awards / staff always belong to your home team, even while controlling another team
  if (L.homeTid != null && L.homeTid !== L.userTid && ['PLAYOFFS', 'AWARDS', 'STAFF'].includes(ph)) { const cur = L.userTid; L.userTid = L.homeTid; delete L.homeTid; const r = advance(L); if (L.homeTid == null && L.userTid !== cur) { L.homeTid = L.userTid; L.userTid = cur; } return r; }
  if (ph === 'PRESEASON') {
    const n = teamPlayers(L, L.userTid).length;
    if (n > ROSTER_MAX) return { ok: false, error: `Your roster has ${n} players. Release down to ${ROSTER_MAX}.` };
    if (n < ROSTER_MIN) return { ok: false, error: `You need at least ${ROSTER_MIN} players (have ${n}). Sign free agents.` };
    aiRosterFix(L); L.phase = 'REGULAR'; L.day = 1; news(L, `The ${L.season - 1}-${String(L.season).slice(2)} season tips off!`);
  } else if (ph === 'REGULAR') {
    if (!seasonDone(L)) return { ok: false, error: 'The regular season is not finished.' };
    startPlayoffs(L);
  } else if (ph === 'PLAYOFFS') {
    if (L.playoffs?.champ == null) return { ok: false, error: 'The playoffs are still going.' };
    enterAwards(L);
  } else if (ph === 'AWARDS') { leaveAwards(L); enterStaff(L); }
  else if (ph === 'STAFF') { leaveStaff(L); enterLottery(L); }
  else if (ph === 'LOTTERY') { enterDraft(L); }
  else if (ph === 'DRAFT') {
    if (L.draft.idx < L.draft.order.length) return { ok: false, error: 'The draft is not complete.' };
    leaveDraft(L); HOOKS.preResign?.(L); enterResign(L);
  } else if (ph === 'RESIGN') { leaveResign(L); L.phase = 'FA1'; enterFA(L); }
  else if (ph === 'FA1' || ph === 'FA2' || ph === 'FA3') {
    resolveFA(L, +ph[2]);
    if (ph === 'FA3') enterSummer(L); else { L.phase = 'FA' + (+ph[2] + 1); aiFAOffers(L, +ph[2] + 1); }
  } else if (ph === 'SUMMER') startPreseason(L);
  HOOKS.phase?.(L, ph);
  L.rng = getSeed();
  return { ok: true };
}

// ================= preseason =================
export function startPreseason(L, first = false) {
  L.phase = 'PRESEASON'; L.day = 0; L.allStarDone = false; L.playoffs = null; L.games = {};
  if (!first) {
    // 1996 start: notable free agents nobody could fit re-sign with their old team via Bird rights
    for (const p of L.players) if (p.tid === -1 && p.birdRights && p.formerTid >= 0 && p.formerTid !== L.userTid && p.ovr >= 60) {
      const ros = teamPlayers(L, p.formerTid); if (ros.length >= 15) release(L, ros.sort((a, b) => a.ovr - b.ovr)[0]);
      sign(L, p, p.formerTid, askingAmount(L, p, p.formerTid, 'fa', 3), prefYears(p));
      news(L, `${p.name} re-signs with the ${teamName(L, p.formerTid)}.`, 'sign');
    }
    // late market: good free agents still unsigned take a 1-year discount deal where it fits
    const late = L.players.filter(p => p.tid === -1 && !p.retired && dispRating(p.ovr) >= 72).sort((a, b) => b.ovr - a.ovr);
    for (const p of late) {
      const opts = L.teams.filter(t => t.tid !== L.userTid && !t.inactive && teamPlayers(L, t.tid).length < ROSTER_MAX).map(t => {
        const space = cap(L) - payroll(L, t.tid);
        const amt = Math.max(minSalary(L.season), Math.min(Math.round(cap(L) * 0.09), Math.round(marketValue(p, L.season) * 0.6), space > 0 ? space : 0));
        return { t, amt: Math.round(amt / 10) * 10, need: p.ovr - (teamPlayers(L, t.tid).sort((a, b) => b.ovr - a.ovr)[7]?.ovr || 0) };
      }).filter(o => o.need > 0 && canAfford(L, o.t.tid, o.amt).ok).sort((a, b) => b.need - a.need);
      const o = opts[0]; if (!o) continue;
      sign(L, p, o.t.tid, o.amt, 1);
      news(L, `${p.name} signs a late 1-year deal with ${o.t.abbr}.`, 'fa', o.t.tid);
    }
    // unsigned old free agents retire
    for (const p of L.players) { if (p.tid >= 0) p.faYears = 0; else if (p.tid === -1 && !p.retired) p.faYears = (p.faYears || 0) + 1; }
    for (const p of L.players) if (p.tid === -1 && !p.retired) {
      // v39: mainly 33+; 30-32 only clearly washed-up; under 30 only very low-rated after 3+ unsigned seasons
      const r = p.age >= 33 ? (p.ovr < 60 ? 0.6 : p.ovr < 68 ? 0.3 : 0.1) : p.age >= 30 ? (p.ovr < 50 ? 0.35 : p.ovr < 56 ? 0.12 : 0) : (p.ovr < 40 && p.faYears >= 3 ? 0.25 : 0);
      if (L.settings.retirement !== false && rand() < r) retire(L, p, true);
    }
    const pool = L.players.filter(p => p.tid === -1 && !p.retired).sort((a, b) => (b.ovr + (b.pot - b.ovr) * 0.5) - (a.ovr + (a.pot - a.ovr) * 0.5));
    for (const p of pool.slice(140)) if (p.age >= 30 || (p.faYears >= 3 && p.ovr < 40) || pool.length > 320) retire(L, p, true); // v39: young FAs stay in the pool // the rest sign overseas / leave the league
    createDraftClass(L, L.season);
  }
  for (const p of L.players) if (p.tid !== -3) resetSeasonStats(p, L.season);
  for (const t of L.teams) if (!t.inactive) { t.mleUsed = false; if (t.tid !== L.userTid || t.autoRotation) t.rotation = null; }
  applyEraRules(L); applyHistory(L, 'preseason');
  makeSchedule(L);
  setExpectation(L);
  reindex(L);
}
export function aiRosterFix(L) {
  const fas = () => L.players.filter(p => p.tid === -1 && !p.retired).sort((a, b) => b.ovr - a.ovr);
  const man = managedSet(L); ensureFAPool(L);
  for (const t of L.teams) if (!t.inactive) {
    if (t.tid === L.userTid || man.has(t.tid)) continue;
    let ps = teamPlayers(L, t.tid);
    while (ps.length > ROSTER_MAX) { const worst = ps.sort((a, b) => (a.ovr + (a.pot - a.ovr) * 0.3) - (b.ovr + (b.pot - b.ovr) * 0.3))[0]; release(L, worst, true); ps = teamPlayers(L, t.tid); }
    while (ps.length < ROSTER_MAX) { // v40: CPU teams always carry a full 15
      let f = fas()[0];
      if (!f) { f = generateVeteran(L.season, randInt(42, 52)); f.tid = -1; resetSeasonStats(f, L.season); L.players.push(f); reindex(L); }
      sign(L, f, t.tid, minSalary(L.season), 1, { ng: true }); ps = teamPlayers(L, t.tid);
    }
  }
  cpuUpgrade(L, 1);
  ensureFAPool(L);
}
// v39: CPU teams swap a fading end-of-bench vet for a younger, clearly better FA (cheap deal). Never user/managed teams.
export function cpuUpgrade(L, perTeam = 1) {
  let n = 0; const stable = stableRosters(L); // v40: runs with morale off too (bench swaps only; no trades/poaching)
  const man = managedSet(L); const minS = minSalary(L.season);
  const act = L.teams.filter(t => !t.inactive); const st = L.phase === 'REGULAR' ? standings(L) : null; // v40: real W/L (teams have no won/lost fields; standings are computed)
  const ranked = act.map(t => { const r = st?.[t.tid]; const gp = r?.gp || 0; return { tid: t.tid, o: teamOvr(L, t.tid) + (gp ? (r.pct - 0.5) * 40 * Math.min(1, gp / 30) : 0) }; }).sort((a, b) => b.o - a.o).map(x => x.tid);
  const third = Math.round(act.length / 3);
  // stable rosters in the offseason: don't grab another team's unsigned free agents (no poaching)
  const ok = (f) => !(stable && L.phase !== 'REGULAR' && f.formerTid >= 0 && !f.waived);
  for (const t of L.teams) { if (t.inactive || t.tid === L.userTid || man.has(t.tid)) continue;
    const rk = ranked.indexOf(t.tid); const strat = rk < third ? 'win' : rk >= act.length - third ? 'rebuild' : 'mid';
    let all = teamPlayers(L, t.tid).filter(p => !p.il);
    while (all.length > ROSTER_MAX) { release(L, all.sort((a, b) => (a.ovr + (a.pot - a.ovr) * 0.3) - (b.ovr + (b.pot - b.ovr) * 0.3))[0], true); all = teamPlayers(L, t.tid).filter(p => !p.il); }
    ensureFAPool(L);
    while (all.length < ROSTER_MAX) { const f = L.players.filter(x => x.tid === -1 && !x.retired && !x.injury && ok(x)).sort((a, b) => b.ovr - a.ovr)[0]; if (!f) break; sign(L, f, t.tid, minS, 1, { ng: true }); all = teamPlayers(L, t.tid).filter(p => !p.il); }
    for (let k = 0; k < perTeam; k++) {
      const ps = teamPlayers(L, t.tid); if (ps.length < ROSTER_MIN) break;
      const w = strat === 'win' ? 0.85 : strat === 'rebuild' ? 0.35 : 0.6;
      const val = (p) => w * dispRating(p.ovr) + (1 - w) * dispRating(p.pot ?? p.ovr) - (strat === 'rebuild' ? Math.max(0, p.age - 26) * 0.8 : strat === 'win' ? 0 : Math.max(0, p.age - 30) * 0.4);
      const protect = (p) => p.rs === p.tid || p.injury || (p.contract?.amt || 0) > minS * 2.2 || (strat !== 'win' && p.draft?.year >= L.season - 2) || (strat === 'win' && p.draft?.year >= L.season - 2 && dispRating(p.pot ?? p.ovr) >= 72);
      const cand = ps.filter(p => !protect(p)).sort((a, b) => val(a) - val(b))[0]; if (!cand) break;
      const need = strat === 'rebuild' ? 4 : 3; const cv = val(cand);
      const fa = L.players.filter(f => f.tid === -1 && !f.retired && !f.injury && ok(f) && val(f) >= cv + need && (strat !== 'rebuild' || f.age <= 27)).sort((a, b) => val(b) - val(a))[0]; if (!fa) break;
      release(L, cand, true); cand.waived = true; sign(L, fa, t.tid, Math.max(minS, Math.round(Math.min(marketValue(fa, L.season), minS * 2) / 10) * 10), 1, { ng: true });
      news(L, `${t.abbr} waive ${cand.name} and sign ${fa.name}${strat === 'win' ? ' (win-now)' : strat === 'rebuild' ? ' (youth movement)' : ''}.`, 'fa', t.tid); n++; }
  }
  return n;
}
function setExpectation(L) {
  const ranks = L.teams.map(t => ({ tid: t.tid, o: teamOvr(L, t.tid) })).sort((a, b) => b.o - a.o);
  const rank = ranks.findIndex(r => r.tid === L.userTid) + 1;
  const wins = Math.round(60 - (rank - 1) * 1.35);
  const goal = rank <= 3 ? 'Win the championship' : rank <= 7 ? 'Reach the conference finals' : rank <= 12 ? 'Win a playoff series' : rank <= 17 ? 'Make the playoffs' : 'Show progress and develop young players';
  const poRound = rank <= 3 ? 5 : rank <= 7 ? 3 : rank <= 12 ? 2 : rank <= 17 ? 1 : 0;
  L.expectation = { season: L.season, rank, wins, goal, poRound, text: `This season the board expects you to: ${goal} (about ${wins} wins). Preseason power rank: #${rank}.` };
}

// ================= contracts / roster moves =================
// ---------- contract raises (front/back-loading within NBA CBA limits) ----------
// Max annual raise (or decline) as a share of year-1 salary. Simplified by era: 1995 CBA (none stated, use 20%),
// 1999 CBA 12.5% Bird / 10% others, 2005 CBA 10.5% / 8%, 2011 CBA 7.5% / 4.5%, 2017 CBA 8% / 5%.
export function raiseCap(season, bird) {
  const t = season >= 2018 ? [0.08, 0.05] : season >= 2012 ? [0.075, 0.045] : season >= 2006 ? [0.105, 0.08] : season >= 1999 ? [0.125, 0.10] : [0.20, 0.20];
  return bird ? t[0] : t[1];
}
// amt is the average annual value; year-1 salary is chosen so the total equals amt * years.
export const yearOneFor = (aav, years, r = 0) => { if (!r || years <= 1) return aav; let s = 0; for (let i = 0; i < years; i++) s += 1 + r * i; return aav * years / s; };
export const salaryInYear = (c, season) => !c ? 0 : !c.raise ? c.amt : Math.round((c.base ?? c.amt) * (1 + c.raise * Math.max(0, season - (c.first ?? season))));
export const contractWords = (c, years) => `$${((c.aav ?? c.amt) / 1000).toFixed(2)}M/yr${c.raise ? ` (${c.raise > 0 ? 'back' : 'front'}-loaded ${c.raise > 0 ? '+' : ''}${Math.round(c.raise * 1000) / 10}%/yr)` : ''}`;
// players value money sooner: a front-loaded deal is worth a bit more to them than its average
export const loadValue = (r) => 1 - 0.3 * (r || 0);
export function sign(L, p, tid, amt, years, extra = {}) {
  const r = extra.raise || 0; const first = L.season + (isOffseasonBeforeNewYear(L) ? 1 : 0);
  const y1 = Math.round(yearOneFor(amt, years, r));
  p.tid = tid; p.contract = { amt: y1, exp: L.season + years - 1 + (isOffseasonBeforeNewYear(L) ? 1 : 0), signed: L.season, ...extra, ...(r ? { raise: r, base: y1, first, aav: Math.round(amt) } : {}) };
  if (!r) delete p.contract.raise;
  if (tid === L.userTid && L.phase.startsWith('FA')) { const g = L.gm; g.faBy ||= {}; g.faBy[L.season] = (g.faBy[L.season] || 0) + 1; if (dispRating(p.ovr) >= 87) g.bigFA = true; }
  p.formerTid = undefined; p.birdRights = undefined; p.stats.tid = tid; delete p.faAsk; delete p.faInterest;
  logTx(L, { type: 'sign', text: `${L.teams[tid].abbr} signed ${p.name} (${years}y, ${contractWords(p.contract, years)})` }, [p.pid]);
  if (L.fa.offers[p.pid]) delete L.fa.offers[p.pid];
  if (L.transactions.length > 400) L.transactions.length = 400;
}
// contracts signed between AWARDS and RESIGN (e.g. draft) belong to the next league year
export function isOffseasonBeforeNewYear(L) { return ['AWARDS', 'STAFF', 'LOTTERY', 'DRAFT'].includes(L.phase); }
export function release(L, p, auto = false) {
  const free = p.contract?.ng && (L.phase !== 'REGULAR' && L.phase !== 'PLAYOFFS');
  if (p.contract && !free) {
    const yrsLeft = p.contract.exp - L.season + 1;
    if (yrsLeft > 0) L.deadMoney.push({ tid: p.tid, amt: p.contract.amt, exp: p.contract.exp, name: p.name });
  }
  logTx(L, { type: 'release', text: `${L.teams[p.tid].abbr} released ${p.name}` }, [p.pid]);
  if (p.tid === L.userTid && !auto) news(L, `${L.teams[p.tid].abbr} waive ${p.name}.`, 'transaction', p.tid);
  p.formerTid = p.tid; p.tid = -1; p.contract = null;
}
// cap rules: under cap -> fits in space; min contract always ok; MLE from 2000 era; Bird rights in re-sign
export function canAfford(L, tid, amt, { bird = false } = {}) {
  const mode = L.settings.capMode || (L.settings.playerCap === false ? 'off' : 'soft');
  if (mode === 'off') return { ok: true, via: 'No salary cap' };
  if (mode === 'hard') { const space = cap(L) - payroll(L, tid); return amt <= space ? { ok: true, via: 'Cap space (hard cap)' } : { ok: false, error: `Hard cap: only ${(Math.max(0, space) / 1000).toFixed(2)}M of room.` }; }
  // CPU teams stay under the luxury tax line except to keep their own players or sign minimums
  // (deals up to the mid-level are still allowed, like the real taxpayer MLE)
  if (tid !== L.userTid && !bird && taxActive(L) && payroll(L, tid) + amt > taxLine(L) && amt > Math.round(cap(L) * 0.09)) return { ok: false, error: 'Over the luxury tax line' };
  if (bird) return { ok: true };
  if (amt <= minSalary(L.season) * 1.001) return { ok: true, via: 'Minimum exception' };
  const space = cap(L) - payroll(L, tid);
  if (amt <= space) return { ok: true, via: 'Cap space' };
  const mle = Math.round(cap(L) * 0.09);
  if (L.season >= 2000 && !L.teams[tid].mleUsed && amt <= mle) return { ok: true, via: 'Mid-level exception', mle: true };
  return { ok: false, error: `Not enough cap space (${(space / 1000).toFixed(2)}M available).` };
}
export function askingAmount(L, p, tid, ctx = 'fa', round = 1) {
  let a = p.faAsk?.amt != null && ctx !== 'resign' ? p.faAsk.amt : marketValue(p, L.season); // FA pool editor override
  if (tid === L.userTid && L.gm.archetype === 'Negotiator') a *= 0.9;
  if (tid === L.userTid) a *= diff(L).faMult;
  if (ctx === 'fa') { const base = [1, 1, 0.92, 0.84][round] ?? 0.75; a *= 1 - (1 - base) * (1.4 - (p.traits?.greed ?? 50) / 100); } // greedy players hold their price longer
  if (ctx === 'inseason') a *= 0.8;
  if (ctx === 'resign' && p.traits.loyalty > 70) a *= 0.93;
  return Math.round(clamp(a, minSalary(L.season), maxSalary(L.season, p)) / 10) * 10;
}
export function moodToward(L, p, tid) {
  if (p.faInterest != null && tid === L.userTid && p.tid === -1) return p.faInterest; // FA pool editor override
  const t = L.teams[tid]; const wp = t.lastWinPct ?? 0.5;
  let m = 1 + (p.traits.ambition / 100) * (wp - 0.5) * 0.6;
  if (p.formerTid === tid || p.tid === tid) m += (p.traits.loyalty - 50) / 400;
  const depth = teamPlayers(L, tid).filter(x => x.pos === p.pos && x.ovr >= p.ovr).length; m -= depth * 0.03; // playing time
  if (p.traits.personality === 'Mercenary') m = 1 + (m - 1) * 0.3;
  if (L.settings.morale !== false && p.mood != null && (p.tid === tid)) m += (p.mood - 50) / 250; // morale: happy players re-sign more easily
  return m;
}
export function willingToNegotiate(L, p, tid) {
  if (stableRosters(L)) return true;
  const m = moodToward(L, p, tid);
  return m > 0.82 || p.traits.personality === 'Mercenary';
}
// 1995 CBA: up to 7 years; 1999 CBA: 7 for own (Bird) players, 6 otherwise
// contract length: 1995 CBA 7 yrs; 1999 CBA 7 own / 6 others; 2005 CBA 6 / 5; 2011 CBA 5 / 4
export function maxYears(L, own) { if (L.settings?.realHistory === false) return L.season < 1999 ? 7 : own ? 7 : 6;
  const s = L.season; return s < 1999 ? 7 : s < 2005 ? (own ? 7 : 6) : s < 2012 ? (own ? 6 : 5) : (own ? 5 : 4); }
export function prefYears(p, L) { if (L && L.phase === 'REGULAR') return 1; return p.faAsk?.yrs || prefYear0(p); }
function prefYear0(p) { return p.age <= 24 ? 4 : p.age <= 28 ? 4 : p.age <= 31 ? 3 : p.age <= 33 ? 2 : 1; }
export function offerAcceptable(L, p, tid, amt, years, ask) {
  const yrPenalty = 1 + 0.04 * Math.abs(years - prefYears(p, L));
  return amt * (stableRosters(L) ? 1 : moodToward(L, p, tid)) >= ask * yrPenalty * 0.98;
}

// ================= awards & season review =================
function seasonLine(p, key = 'reg') { const s = p.stats[key]; const g = s.gp || 1; return { ppg: s.pts / g, rpg: (s.orb + s.drb) / g, apg: s.ast / g, gp: s.gp }; }
export function computeAwards(L) {
  const rec = standings(L); const wp = Object.fromEntries(rec.map(r => [r.tid, r.pct]));
  const elig = L.players.filter(p => p.tid >= 0 && p.stats.reg.gp >= gpReq(L, 50));
  // MVP voting: production + how good the player is (OVR) + best player on a top seed + voter fatigue
  const zP = zOf(elig.map(p => prodScore(p))), zO = zOf(elig.map(p => p.ovr));
  const best = {}; for (const p of elig) if (!best[p.tid] || p.ovr > best[p.tid].ovr) best[p.tid] = p;
  const seedRank = Object.fromEntries([...rec].sort((a, b) => b.pct - a.pct).map((r, i) => [r.tid, i]));
  const mvpRun = (p) => { let n = 0; while (p.awards.some(a => a.type === 'MVP' && a.season === L.season - 1 - n)) n++; return n; };
  const mvpCache = new Map();
  const mvpScore = (p) => { if (mvpCache.has(p.pid)) return mvpCache.get(p.pid);
    const sr = seedRank[p.tid] ?? 15; const v = 0.55 * zP(prodScore(p)) + 0.6 * zO(p.ovr) + 1.6 * (wp[p.tid] - 0.5) + (sr < 4 ? 0.25 - sr * 0.05 : 0)
      + (best[p.tid] === p ? 0.2 : -0.35) - (mvpRun(p) >= 2 ? 0.25 * (mvpRun(p) - 1) : 0) + normal(0, 0.08);
    mvpCache.set(p.pid, v); return v; };
  const by = (fn, arr = elig) => [...arr].sort((a, b) => fn(b) - fn(a));
  const mvp = by(mvpScore)[0];
  // DPOY: voters want an elite rim protector or ball hawk (z-scores of BLK/STL per game) on a top defensive team.
  // Team defense = points allowed relative to the scoring environment of its own games (so fast-paced schemes aren't punished).
  const stT = standings(L); const lgPts = stT.reduce((s, r) => s + r.pf, 0) / Math.max(1, stT.reduce((s, r) => s + r.w + r.l, 0));
  const tDef = stT.map(r => { const g = Math.max(1, r.w + r.l); return r.pa / g - ((r.pf + r.pa) / (2 * g) - lgPts) * 0.6; });
  const zT = zOf(tDef); const dEl = elig.filter(p => p.stats.reg.gp >= gpReq(L, 55) && p.stats.reg.min / p.stats.reg.gp >= 27);
  const per = (p, k) => p.stats.reg[k] / p.stats.reg.gp;
  const zB = zOf(dEl.map(p => per(p, 'blk'))), zS = zOf(dEl.map(p => per(p, 'stl'))), zD = zOf(dEl.map(p => per(p, 'drb')));
  const dScore = new Map(dEl.map((p, i) => { const b = zB(per(p, 'blk')), st = zS(per(p, 'stl')), d = zD(per(p, 'drb'));
    const run = (() => { let n = 0; while (p.awards.some(a => a.type === 'Defensive Player of the Year' && a.season === L.season - 1 - n)) n++; return n; })();
    const cb = Math.min(b, 2.6), cs = Math.min(st, 2.6); // diminishing returns: a 4.5-block specialist isn't automatically DPOY
    const impact = Math.max(cb, cs * 0.9) + 0.3 * Math.max(0, Math.min(cb, cs)) + 0.2 * d + 0.05 * (p.ovr - 75);
    return [p.pid, impact + 0.5 * -zT(tDef[p.tid]) + 0.004 * ((p.ratings.idef + p.ratings.pdef) - 150) + normal(0, 0.12) - (run >= 2 ? 0.3 * (run - 1) : 0)]; }));
  const dpoyList = by(p => dScore.get(p.pid), dEl.length ? dEl : elig);
  const dpoy = dpoyList[0]; if (globalThis.process?.env?.DPOYDIAG) console.log(L.season, dpoyList.slice(0, 5).map(p => { const s = p.stats.reg; return `${p.name} ${L.teams[p.tid].abbr} b${(s.blk / s.gp).toFixed(1)} s${(s.stl / s.gp).toFixed(1)} tDefRank${[...tDef].sort((a, b) => a - b).indexOf(tDef[p.tid]) + 1} sc${dScore.get(p.pid)?.toFixed(2)}`; }).join(' | '));
  const rookies = L.players.filter(p => p.tid >= 0 && p.career.length === 0 && (p.draft?.year === L.season - 1) && p.stats.reg.gp >= gpReq(L, 30));
  const roy = by(prodScore, rookies)[0];
  const sixth = by(prodScore, elig.filter(p => p.stats.reg.gs < p.stats.reg.gp * 0.4))[0];
  const mip = by(p => (p.ovr - (p.stats.ovrStart ?? p.ovr)) * 1.5 + (seasonLine(p).ppg - (p.career.at(-1)?.ppg ?? seasonLine(p).ppg)) * 0.8, elig.filter(p => p.career.length >= 1))[0];
  const allScore = (p) => 0.55 * zP(prodScore(p)) + 0.6 * zO(p.ovr) + 0.8 * (wp[p.tid] - 0.5);
  const ranked = by(allScore); const allNBA = [[], [], []];
  const slots = { G: 2, F: 2, C: 1 };
  const grp = (p) => p.pos === 'PG' || p.pos === 'SG' ? 'G' : p.pos === 'C' ? 'C' : 'F';
  const used = new Set();
  for (let t = 0; t < 3; t++) for (const g of ['G', 'F', 'C']) { let n = slots[g]; for (const p of ranked) { if (n <= 0) break; if (!used.has(p) && grp(p) === g) { allNBA[t].push(p); used.add(p); n--; } } }
  const champ = L.playoffs.champ;
  const fmvp = by(p => prodScore(p, 'po') * (p.stats.po.gp >= 4 ? 1 : 0.5), L.players.filter(p => p.tid === champ && p.stats.po.gp > 0))[0];
  const A = { mvp, dpoy, roy, sixth, mip, fmvp, allNBA };
  const give = (p, type) => { if (p) p.awards.push({ season: L.season, type }); };
  give(mvp, 'MVP'); give(dpoy, 'Defensive Player of the Year'); give(roy, 'Rookie of the Year'); give(sixth, 'Sixth Man of the Year'); give(mip, 'Most Improved Player'); give(fmvp, 'Finals MVP');
  allNBA.forEach((team, i) => team.forEach(p => give(p, `All-NBA ${['1st', '2nd', '3rd'][i]} Team`)));
  for (const p of L.players.filter(p => p.tid === champ)) p.awards.push({ season: L.season, type: 'Champion' });
  const name = (p) => p ? { pid: p.pid, name: p.name, tid: p.tid, abbr: L.teams[p.tid].abbr } : null;
  return { mvp: name(mvp), dpoy: name(dpoy), roy: name(roy), sixth: name(sixth), mip: name(mip), fmvp: name(fmvp), allNBA: allNBA.map(t => t.map(name)) };
}
export function enterAwards(L) {
  L.phase = 'AWARDS';
  const rec = standings(L); const P = L.playoffs;
  const awards = computeAwards(L);
  const ur = rec[L.userTid];
  const userSeries = P.series.filter(s => s.hi === L.userTid || s.lo === L.userTid);
  const roundsWon = userSeries.filter(s => s.winner === L.userTid).length;
  const madePO = userSeries.length > 0;
  const leaders = {};
  for (const st of ['pts', 'reb', 'ast', 'stl', 'blk']) {
    const elig = L.players.filter(p => p.tid >= 0 && p.stats.reg.gp >= gpReq(L, 58));
    const v = (p) => (st === 'reb' ? p.stats.reg.orb + p.stats.reg.drb : p.stats.reg[st]) / p.stats.reg.gp;
    const top = elig.sort((a, b) => v(b) - v(a))[0]; if (top) leaders[st] = { pid: top.pid, name: top.name, abbr: L.teams[top.tid].abbr, v: +v(top).toFixed(1) };
    const sr = L.records.season[st]; if (top && (!sr || v(top) > sr.v)) L.records.season[st] = { v: +v(top).toFixed(1), name: top.name, pid: top.pid, season: L.season };
  }
  L.history.push({ season: L.season, champ: P.champ, runnerUp: P.runnerUp, awards, leaders,
    user: { tid: L.userTid, w: ur.w, l: ur.l, madePO, roundsWon }, best: rec.slice().sort((a, b) => b.pct - a.pct)[0].tid });
  news(L, `🏆 The ${teamName(L, P.champ)} are ${L.season} champions! Finals MVP: ${awards.fmvp?.name ?? '—'}.`, 'award');
  news(L, `MVP: ${awards.mvp?.name} · DPOY: ${awards.dpoy?.name} · ROY: ${awards.roy?.name ?? '—'} · 6MOY: ${awards.sixth?.name} · MIP: ${awards.mip?.name ?? '—'}`, 'award');
  // owner review
  const E = L.expectation; const isChamp = P.champ === L.userTid;
  const poScore = isChamp ? 5 : madePO ? 1 + roundsWon : 0;
  const G82 = 82 / (L.seasonGames || 82); let delta = (ur.w * G82 - E.wins) * 0.9 + (poScore - E.poRound) * 6 + (isChamp ? 15 : 0);
  delta = delta >= 0 ? delta : delta / diff(L).ownerPatience;
  L.gm.jobSecurity = clamp(Math.round(L.gm.jobSecurity + delta), L.settings.gmFiring ? -50 : 10, 100); // v41: firing off -> floor 10
  L.gm.legacy += ur.w + roundsWon * 8 + (isChamp ? 40 : 0) - (madePO ? 0 : 5);
  L.gm.seasonsRun++; if (isChamp) L.gm.titles++;
  const grade = delta >= 10 ? 'A' : delta >= 3 ? 'B' : delta >= -3 ? 'C' : delta >= -10 ? 'D' : 'F';
  L.gm.history.push({ season: L.season, tid: L.userTid, w: ur.w, l: ur.l, goal: E.goal, grade, roundsWon, champ: isChamp, madePO, security: L.gm.jobSecurity });
  L.lastReview = { grade, delta: Math.round(delta), security: L.gm.jobSecurity, goal: E.goal, w: ur.w, l: ur.l, champ: isChamp, roundsWon, madePO };
  if (L.settings.gmFiring && L.gm.jobSecurity <= 0) {
    L.gm.fired = true;
    msg(L, 'Owner', 'You are fired', `Results did not meet expectations (${E.goal}). We're making a change. Other teams may still want you.`, { pri: 'high' });
  } else msg(L, 'Owner', `Season review: grade ${grade}`, `Goal: ${E.goal}. Record ${ur.w}-${ur.l}. Job security now ${L.gm.jobSecurity}/100.`, { pri: 'high' });
  for (const t of L.teams) if (!t.inactive) t.lastWinPct = rec[t.tid].pct;
  // luxury tax: $1.50 per $1 over the line; the owner notices
  if (taxActive(L)) { L.taxBills ||= {}; const line = taxLine(L);
    for (const t of L.teams) if (!t.inactive) { const over = payroll(L, t.tid) - line; if (over <= 0) continue; const bill = Math.round(over * 1.5); (L.taxBills[L.season] ||= {})[t.tid] = bill;
      if (t.tid === L.userTid) { const hit = Math.min(12, Math.round(bill / capFor(L.season) * 40)); L.gm.jobSecurity = clamp(L.gm.jobSecurity - hit, 0, 100);
        msg(L, 'Owner', 'Luxury tax bill', `We were $${(over / 1000).toFixed(1)}M over the tax line and owe $${(bill / 1000).toFixed(1)}M in luxury tax. Job security −${hit}.`, { pri: 'high' }); } } }
  // retirement candidates
  L.retiring = [];
  for (const p of L.players) {
    if (p.tid < -1 || p.retired) continue;
    let pr = 0;
    // rating-aware: good veterans keep playing (Stockton/Malone/Parish), fringe vets walk away
    const a = p.age, o = p.ovr;
    if (a >= 41) pr = 0.92; else if (a >= 38) pr = o >= 75 ? 0.3 : o >= 65 ? 0.55 : 0.8;
    else if (a >= 36) pr = o >= 78 ? 0.1 : o >= 68 ? 0.28 : 0.6;
    else if (a >= 34) pr = o >= 75 ? 0.04 : o >= 66 ? 0.14 : 0.4;
    else if (a >= 33) pr = o < 60 ? 0.2 : o < 66 ? 0.06 : 0.01;
    pr *= clamp(longevity(p), 0.6, 1.3);
    if (p.tid === -1 && a >= 33) pr += 0.2;
    if (p.tid >= 0 && p.contract && p.contract.exp > L.season && a < 37) pr *= a >= 35 ? 0.15 : 0; // under contract: essentially never before 37
    if (L.settings.retirement !== false && rand() < pr) L.retiring.push(p.pid);
  }
  const mine = L.retiring.map(id => getP(L, id)).filter(p => p.tid === L.userTid);
  if (mine.length) msg(L, 'Head Coach', 'Retirement watch', `${mine.map(p => p.name).join(', ')} ${mine.length > 1 ? 'are' : 'is'} considering retirement. You can try to convince them to return (Season Review screen).`);
}
export function convinceRetire(L, pid) {
  const p = getP(L, pid); if (!L.retiring.includes(pid) || p.convinced !== undefined) return null;
  const ok = rand() < (p.age >= 37 ? 0.25 : 0.55) * (p.traits.loyalty > 60 ? 1.2 : 1);
  p.convinced = ok; if (ok) L.retiring = L.retiring.filter(x => x !== pid);
  return ok;
}
// real-career gap: the player steps away (no Hall of Fame ballot or jersey ceremony yet) and comes back in free agency
export function startHiatus(L, p, until) {
  const ex = p.tid; const mine = ex === L.userTid;
  p.hiatus = { from: L.season - 1, until, age: p.age, exTid: ex }; p.retired = true; p.retiredSeason = L.season; p.tid = -3; p.contract = null;
  news(L, `${p.name} retires${ex >= 0 ? ` (${L.teams[ex].abbr})` : ''} at age ${p.age}.`, 'retire', ex >= 0 ? ex : null);
  if (mine) msg(L, 'Front Office', `${p.name} retires`, `${p.name} has decided to step away from basketball. Players sometimes un-retire — watch free agency.`);
}
// v40: a player retired by the sim (not a real-career hiatus) whose real career resumes this season comes back too (e.g. Jordan 2001-02)
export function realComebacks(L) {
  if (careerMode(L) === 'off' || L.settings.retirement === false) return 0; let n = 0;
  for (const p of L.players) { if (!p.retired || p.hiatus || p.tid !== -3 || p.overseas || p.hofSeason) continue;
    const c = careerOf(L, p); const K = L.season - 1; if (!c || !c.a[String(K)] || c.a[String(K - 1)] || p.retiredSeason == null || p.retiredSeason >= L.season) continue;
    p.hiatus = { from: p.retiredSeason - 1, until: K, age: p.age, exTid: p.formerTid ?? -1 }; endHiatus(L, p); n++; }
  return n;
}
// v46: real players drafted before the save's first draft whose NBA career starts later (Peja Stojakovic 1996 -> 1998-99 SAC,
// Ilgauskas, Rebraca, Rentzias...) are missing from the start rosters. Add them overseas holding a comeback-style arrival; if the save is
// already past their arrival, they arrive now (CPU real team; user's team -> free agency with a note).
const STASH_BIO = { 'Peja Stojakovic': ['SF', 208, 104, 1, 14], 'Zeljko Rebraca': ['C', 213, 116, 2, 55], 'Dragan Tarlac': ['C', 211, 113, 2, 31], 'Efthimios Rentzias': ['C', 211, 111, 1, 23],
  'Mark Pope': ['PF', 208, 107, 2, 52], 'Drew Barry': ['SG', 196, 86, 2, 57], 'Lawrence Funderburke': ['PF', 206, 104, 2, 51], 'Ed Stokes': ['C', 213, 118, 2, 35], 'Michael McDonald': ['C', 211, 113, 0, 0],
  "Dontae' Jones": ['SF', 201, 100, 1, 21], 'Jeff Nordgaard': ['SF', 201, 100, 2, 53], 'Zydrunas Ilgauskas': ['C', 221, 118, 1, 20] };
export function addStashedReal(L) {
  if (careerMode(L) !== 'real' || !L.data?.careers) return 0; const C = L.data.careers; const S0 = (L.histStart || 1997) - 1; let n = 0;
  const have = new Set(L.players.map(p => normName(p.name)));
  for (const [k, c] of Object.entries(C)) { const [nm, dyS] = k.split('|'); if (dyS === 'U') continue; const dy = +dyS; if (dy > S0 || dy < S0 - 12) continue;
    const ys = Object.keys(c.a).map(Number); const fy = Math.min(...ys); if (fy <= S0 || have.has(nm)) continue;
    const e = c.a[String(fy)]; const bio = STASH_BIO[c.n] || [null, 203, 100, 2, 45]; const ageAtDraft = (e[3] ?? 23) - (fy - dy);
    const raw = { n: c.n, age: ageAtDraft, h: bio[1], w: bio[2], pos: bio[0], col: 'Overseas', ctry: '', dy, dr: bio[3] || null, dp: bio[4] || null };
    const p = prospectFromReal(raw, dy, { histTendency: 0.5 }); p.arcKey = k; p.age = (e[3] ?? 23) - (fy - S0) + 1 - 1; p.draft = { year: dy, round: raw.dr, pick: raw.dp, tid: null };
    p.tid = -3; p.retired = true; p.overseas = true; p.stashed = true; p.retiredSeason = S0; p.devTrait = devTrait(p); resetSeasonStats(p, L.season);
    p.hiatus = { from: fy, until: fy, age: e[3] ?? p.age, exTid: -1, stash: true, rights: null }; L.players.push(p); have.add(nm); n++;
    if (fy <= L.season - 1 && L.phase !== 'PRESEASON_INIT') endHiatus(L, p); }
  if (n) reindex(L); return n;
}
export function endHiatus(L, p) {
  const h = p.hiatus; p.age = h.age + (h.until - h.from) - 1; p.retired = false; delete p.retiredSeason; p.tid = -1; delete p.hiatus; p.comebackSeason = L.season;
  resetSeasonStats(p, L.season);
  applyArc(L, p, L.season - 1); floorReal(p); // ratings for the comeback season (career keys = season start year = L.season - 1)
  const tid = realTeamTid(L, p, L.season - 1);
  const stash = h.stash; // v46: draft-and-stash player arriving from overseas
  news(L, stash ? `${p.name} arrives from overseas to start his NBA career.` : `${p.name} is coming out of retirement at ${p.age + 1}!`, 'sign', null);
  if (stash && h.rights != null && h.rights === L.userTid && !L.teams[h.rights]?.inactive) { // the user drafted him: he signs with the user
    sign(L, p, h.rights, minSalary(L.season), Math.max(2, Math.min(3, arcYearsFrom(L, p, L.season - 1))));
    msg(L, 'Front Office', `${p.name} arrives`, `${p.name}, whose draft rights you hold, has come over from overseas and signed with us.`); return; }
  if (tid != null && !managedSet(L).has(tid) && careerMode(L) === 'real' && teamPlayers(L, tid).length >= ROSTER_MAX) { // v40: CPU rosters are full (15); waive the weakest cheap player to make room
    const minS = minSalary(L.season); const cut = teamPlayers(L, tid).filter(q => (q.contract?.amt || 0) <= minS * 2.2).sort((a, b) => a.ovr - b.ovr)[0]; if (cut) { release(L, cut, true); cut.waived = true; } }
  if (tid != null && !managedSet(L).has(tid) && careerMode(L) === 'real' && (L.phase !== 'REGULAR' || teamPlayers(L, tid).length < ROSTER_MAX)) { // offseason: training camp trims CPU rosters to 15
    const ask = askingAmount(L, p, tid, 'fa', 3); const aff = canAfford(L, tid, ask);
    sign(L, p, tid, aff.ok ? ask : minSalary(L.season), arcYearsFrom(L, p, L.season - 1));
    news(L, `${p.name} signs with the ${teamName(L, tid)} in his comeback.`, 'fa', tid);
  } else { p.formerTid = h.exTid >= 0 ? h.exTid : undefined; msg(L, 'Front Office', stash ? `${p.name} arrives from overseas` : `${p.name} is un-retiring`, stash ? `${p.name} is starting his NBA career and is in free agency${tid === L.userTid ? ' — his real team was yours, so he is waiting for your offer (Free Agents)' : ''}.` : `${p.name} is back and available in free agency${tid === L.userTid ? ' — and he wants to play for you' : ''}.`); if (tid === L.userTid) p.faInterest = 1.25; }
}
function retire(L, p, quiet = false) {
  const ex = p.tid; p.retired = true; p.retiredSeason = L.season; p.tid = -3; p.contract = null;
  if (!quiet || p.ovr >= 65) news(L, `${p.name} retires${ex >= 0 ? ` (${L.teams[ex].abbr})` : ''} at age ${p.age}.`, 'retire', ex);
  const score = hofScore(p);
  p.hofScore = score;
  retireJerseys(L, p, score);
  maybeCoachingCareer(L, p);
  if (score >= 50) (L.hofBallot ||= []).push(p.pid);
}
// Hall of Fame class: one ballot each summer, at most 3 inductees (best scores first); the rest stay on the ballot.
export function inductHofClass(L) {
  const ballot = (L.hofBallot || []).map(id => getP(L, id)).filter(p => p && !p.hof).sort((a, b) => b.hofScore - a.hofScore);
  for (const p of ballot.slice(0, 3)) induct(L, p);
  L.hofBallot = ballot.slice(3).map(p => p.pid);
}
function induct(L, p) {
  const ex = p.career.length ? p.career[p.career.length - 1].tid : -1;
  { p.hof = L.season; L.hof.push({ pid: p.pid, name: p.name, season: L.season, score: p.hofScore, tids: [...new Set(p.career.map(c => c.tid))] }); news(L, `🏛️ ${p.name} is inducted into the Hall of Fame.`, 'hof'); if (ex === L.userTid) msg(L, 'League Office', 'Hall of Fame', `${p.name} has been inducted into the Hall of Fame.`); }
}
// Franchise legends: when a player retires, a team retires his number if he was a Hall of Famer with a real tenure there,
// or a long-time star for them (8+ seasons with 3+ All-Star picks there, or 6+ seasons with 2+ titles there).
export function retireJerseys(L, p, score = hofScore(p)) {
  const seasonsBy = {}; for (const c of p.career) if (c.tid >= 0 && c.gp > 0) seasonsBy[c.tid] = (seasonsBy[c.tid] || 0) + 1;
  // pre-1996 tenure isn't in the data; credit part of a vet's prior years to the team he started the sim with
  if (p.startTid >= 0 && seasonsBy[p.startTid] >= 3) seasonsBy[p.startTid] += Math.round(Math.min(p.prior?.yrs || 0, 10) * 0.6);
  const tidIn = (season) => p.career.find(c => c.season === season)?.tid;
  const at = (type, tid) => p.awards.filter(a => a.type === type && tidIn(a.season) === tid).length;
  const out = [];
  for (const [tidS, n] of Object.entries(seasonsBy)) {
    const tid = +tidS, t = L.teams[tid]; const num = p.numHist?.[tid] ?? (p.numTid === tid ? p.num : null); if (num == null) continue;
    const legend = (score >= 50 && n >= 5) || (n >= 8 && at('All-Star', tid) >= 3) || (n >= 6 && at('Champion', tid) >= 2 && at('All-Star', tid) >= 1);
    t.retiredNums ||= [];
    if (!legend || t.retiredNums.some(r => r.num === num)) continue;
    t.retiredNums.push({ num, name: p.name, pid: p.pid, season: L.season }); out.push(t.abbr);
    news(L, `👕 The ${t.city} ${t.name} will retire #${num} in honor of ${p.name}.`, 'retire', tid);
    if (tid === L.userTid) msg(L, 'Owner', `Jersey retirement: #${num}`, `We're raising ${p.name}'s #${num} to the rafters this season. ${n} seasons in our uniform — nobody will wear it again.`);
  }
  return out;
}
// Hall of Fame: Basketball-Reference-style logistic probability from honors, titles and career value.
// Weights were set so real 1996-97 benchmarks land sensibly (Jordan/Malone/Stockton ~100%, Richmond/Mourning likely,
// Kemp/K.Johnson coin-flip, Horace Grant/Anthony Mason/Tom Gugliotta near 0).
export function hofFactors(p) {
  const c = careerTotals(p); const pr = p.prior || {}; const aw = (t) => p.awards.filter(a => a.type === t).length;
  const an1 = aw('All-NBA 1st Team') + (pr.an1 || 0), an = aw('All-NBA 1st Team') + aw('All-NBA 2nd Team') + aw('All-NBA 3rd Team') + (pr.an || 0);
  return { as: aw('All-Star') + (pr.as || 0), an, an1, mvp: aw('MVP') + (pr.mvp || 0), t: aw('Champion') + (pr.t || 0), dpoy: aw('Defensive Player of the Year') + (pr.dpoy || 0),
    fmvp: aw('Finals MVP') + (pr.fmvp || 0), pts: c.pts + (pr.pts || 0), reb: c.reb + (pr.reb || 0), ast: c.ast + (pr.ast || 0), stl: c.stl, blk: c.blk };
}
export function hofValue(f) {
  // honors dominate (All-Star count is superlinear, as in B-Ref's HOF probability); counting stats reward longevity only
  return 0.2 * f.as + 0.04 * f.as * f.as + 0.45 * f.an + 0.4 * f.an1 + 1.4 * f.mvp + 0.6 * f.fmvp + 0.35 * f.t + 0.7 * f.dpoy
    + f.pts / 9000 + f.reb / 14000 + f.ast / 7000 + ((f.stl || 0) + (f.blk || 0)) / 10000;
}
export const HOF_MID = 6.7, HOF_SLOPE = 1.2;
// Sustained peak: seasons at an All-Star level (OVR 80+, 40+ games) plus pre-1996 All-Star selections.
// Short-peak careers are discounted hard: 7+ peak years = full credit, 3 or fewer = no chance; induction needs >= 50%.
export function peakYears(p) { return p.career.filter(c => c.ovr >= 80 && c.gp >= 40).length + Math.min(p.prior?.as || 0, p.prior?.yrs || 0); }
export function hofProb(p) {
  const v = hofValue(hofFactors(p)); const base = 1 / (1 + Math.exp(-(v - HOF_MID) * HOF_SLOPE));
  const gp = careerTotals(p).gp + (p.prior?.yrs || 0) * 70;
  return base * clamp((peakYears(p) - 3) / 4, 0, 1) * (gp >= 650 ? 1 : 0.5);
}
export function hofScore(p) { return Math.round(hofProb(p) * 1000) / 10; } // 0-100 (% chance), kept for callers
export function careerTotals(p) {
  const t = { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
  for (const c of p.career) { t.gp += c.gp; t.pts += c.pts; t.reb += c.reb; t.ast += c.ast; t.stl += c.stl; t.blk += c.blk; }
  return t;
}
function leaveAwards(L) {
  // archive stats into career
  for (const p of L.players) {
    if (p.tid < -1 && !(p.tid === -2)) continue;
    const s = p.stats.reg, po = p.stats.po;
    if (s.gp > 0 || po.gp > 0) p.career.push({ season: L.season, tid: p.stats.tid, abbr: L.teams[p.stats.tid]?.abbr ?? 'FA', gp: s.gp, gs: s.gs, min: s.min, pts: s.pts, reb: s.orb + s.drb, ast: s.ast, stl: s.stl, blk: s.blk, tov: s.tov,
      fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, ftm: s.ftm, fta: s.fta, orb: s.orb, drb: s.drb, pf: s.pf, ppg: s.gp ? s.pts / s.gp : 0, ovr: p.ovr, po: { gp: po.gp, pts: po.pts, reb: po.orb + po.drb, ast: po.ast }, ...(stintsForArchive(p.stats) ? { stints: stintsForArchive(p.stats) } : {}) });
    p.hist.push({ season: L.season, ovr: p.ovr, pot: p.pot, age: p.age });
  }
  for (const pid of L.retiring || []) { const p = getP(L, pid); if (p && !p.retired) retire(L, p); }
  L.retiring = [];
  inductHofClass(L);
}
// ================= staff =================
function enterStaff(L) {
  L.phase = 'STAFF';
  for (const t of L.teams) if (!t.inactive) for (const role of ['HC', 'AC', 'SC', 'TR']) {
    const s = t.staff[role]; if (!s) continue; s.years--; s.age++; s.tenure = (s.tenure || 0) + 1;
    s.rating = clamp(s.rating + (s.age < 50 ? randInt(-1, 3) : randInt(-3, 1)), 30, 99);
    if (s.years <= 0 || s.age > 72) {
      if (t.tid === L.userTid) msgBatch(L, 'staffexp', 'Front Office', 'Staff contracts expired', `Your ${roleName(role)} ${s.name} has left. Hire a replacement in My Team → Staff.`, { pri: role === 'HC' ? 'high' : 'normal', days: 30 });
      t.staff[role] = null; if (s.age <= 72) L.staffPool.push({ ...s, years: randInt(1, 4) });
    }
  }
  // CPU coaching carousel: bad teams fire head coach
  const rec = standings(L);
  for (const t of L.teams) if (!t.inactive) if (t.tid !== L.userTid && t.staff.HC && rec[t.tid].pct < 0.35 && rand() < 0.5) {
    news(L, `${t.abbr} fire head coach ${t.staff.HC.name}.`, 'staff', t.tid); L.staffPool.push({ ...t.staff.HC, years: randInt(1, 3) }); t.staff.HC = null;
  }
  for (let i = 0; i < 10; i++) L.staffPool.push(genStaff(['HC', 'AC', 'SC', 'TR'][i % 4], L.season));
  // former players who retired a season or two ago join the coaching ranks
  const ready = (L.staffQueue || []).filter(q => q.season <= L.season); L.staffQueue = (L.staffQueue || []).filter(q => q.season > L.season);
  for (const q of ready) { L.staffPool.push(q.s); news(L, `Former ${q.s.exTeam} star ${q.s.name} begins his coaching career (${roleName(q.s.role)}, ${q.s.role === 'HC' ? q.s.off + ' / ' + q.s.def : 'player development'}).`, 'staff'); }
  // AI teams sometimes promote a long-serving assistant to head coach
  for (const t of L.teams) if (!t.inactive) if (t.tid !== L.userTid && !t.staff.HC && t.staff.AC && (t.staff.AC.tenure || 0) >= 3 && rand() < 0.2) {
    promote(t); news(L, `${t.abbr} promote assistant ${t.staff.HC.name} to head coach.`, 'staff', t.tid); }
  for (const t of L.teams) if (!t.inactive) if (t.tid !== L.userTid) for (const role of ['HC', 'AC', 'SC', 'TR']) if (!t.staff[role]) aiHire(L, t, role);
}
// z-score helper: returns a function mapping a value to its z-score within arr
function zOf(arr) { const m = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length); const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, arr.length)) || 1; return (v) => (v - m) / sd; }
export const roleName = (r) => ({ HC: 'Head Coach', AC: 'Assistant / Development Coach', SC: 'Head Scout', TR: 'Head Trainer' })[r];
function aiHire(L, t, role) {
  // AI teams weigh a head coach's schemes against their roster (PGM-style scheme fit), not just his rating
  const ps = role === 'HC' ? teamPlayers(L, t.tid) : null;
  const sc = (s) => s.rating + (ps ? (() => { const f = teamFit(ps, s.off, s.def); return (f.off + f.def - 120) * 0.6; })() : 0);
  const pool = L.staffPool.filter(s => s.role === role).sort((a, b) => sc(b) - sc(a));
  const s = pool[randInt(0, Math.min(3, pool.length - 1))] || genStaff(role, L.season);
  L.staffPool = L.staffPool.filter(x => x !== s); t.staff[role] = s;
  if (role === 'HC') news(L, `${t.abbr} hire ${s.name} as head coach.`, 'staff', t.tid);
}
export function staffBudget(L) { return Math.round(capFor(L.season) * 0.075 * (1 + Math.max(0, L.gm.jobSecurity - 50) / 200)); }
export function staffSpend(L, tid = L.userTid) { return Object.values(L.teams[tid].staff).reduce((s, x) => s + (x?.salary || 0), 0); }
export function hireStaff(L, sid) {
  const s = L.staffPool.find(x => x.sid === sid); if (!s) return { ok: false, error: 'Not available' };
  const t = L.teams[L.userTid]; const cur = t.staff[s.role];
  if (L.settings.staffCap && staffSpend(L) - (cur?.salary || 0) + s.salary > staffBudget(L)) return { ok: false, error: 'Over the owner\'s staff budget.' };
  if (cur) L.staffPool.push(cur);
  L.staffPool = L.staffPool.filter(x => x !== s); t.staff[s.role] = { ...s, years: Math.max(2, s.years), tenure: 0 };
  msg(L, 'Front Office', `Hired ${s.name}`, `${s.name} is your new ${roleName(s.role)}.`); return { ok: true };
}
// Ex-players into staff (PGM-style): smart, long-career players may start coaching 1-3 seasons after retiring.
// Their schemes follow how they played: bigs post up / protect the paint, playmakers run motion or pick & roll, etc.
export function maybeCoachingCareer(L, p) {
  const yrs = p.career.length + (p.prior?.yrs || 0), r = p.ratings; if (yrs < 9 || r.iq < 70 || p.age > 42) return null;
  if (rand() > (p.hof ? 0.45 : 0.25) + (r.iq >= 85 ? 0.15 : 0)) return null;
  const big = p.pos === 'C' || p.pos === 'PF';
  const off = r.iq >= 88 && r.pas >= 70 ? 'Triangle' : big && r.ins >= 75 ? 'Post-Up' : r.pas >= 80 ? (r.han >= 78 ? 'Pick & Roll' : 'Motion') : r.out >= 80 ? 'Run & Gun' : r.sco >= 82 ? 'Isolation' : 'Motion';
  const def = (r.blk ?? 0) >= 80 ? 'Pack the Paint' : (r.stl ?? 0) >= 80 ? 'Aggressive Traps' : r.pdef >= 85 ? 'Switch Everything' : r.iq >= 86 && ERA.zone ? 'Zone Mix' : 'Man-to-Man';
  const hc = r.iq >= 78 && (p.hof || yrs >= 12 || rand() < 0.4);
  const rating = clamp(Math.round(52 + (r.iq - 70) * 0.8 + (p.hof ? 6 : 0) + normal(0, 6)), 40, 92);
  const delay = randInt(1, 3), ex = p.career.length ? p.career[p.career.length - 1].abbr : (L.teams[p.formerTid]?.abbr || '');
  const most = (() => { const c = {}; for (const x of p.career) c[x.abbr] = (c[x.abbr] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ex; })();
  const s = { sid: Math.floor(rand() * 1e9), name: p.name, role: hc ? 'HC' : 'AC', rating, age: p.age + delay, years: randInt(2, 4), exPid: p.pid, exYrs: yrs, exTeam: most,
    salary: Math.round((hc ? 600 : 250) * Math.exp((rating - 60) / 18) * capFor(L.season) / 24363 / 10) * 10, off, def, dev: clamp(rating + randInt(-6, 10), 30, 99) };
  (L.staffQueue ||= []).push({ season: L.season + delay, s }); return s;
}
// Promote the assistant (3+ seasons with the team) to head coach; his own philosophy becomes the team's schemes.
function promote(t) {
  const a = t.staff.AC; a.off ||= SCHEMES_OFF[(a.sid >>> 3) % SCHEMES_OFF.length]; a.def ||= SCHEMES_DEF[(a.sid >>> 5) % SCHEMES_DEF.length];
  t.staff.HC = { ...a, role: 'HC', rating: Math.max(a.rating, Math.round((a.rating + (a.dev || a.rating)) / 2) + 2), years: Math.max(3, a.years), tenure: 0, promoted: true };
  t.staff.AC = null;
}
const SCHEMES_OFF = ['Motion', 'Pick & Roll', 'Post-Up', 'Run & Gun', 'Triangle', 'Isolation'], SCHEMES_DEF = ['Man-to-Man', 'Switch Everything', 'Pack the Paint', 'Aggressive Traps', 'Zone Mix'];
export function canPromote(L) { const t = L.teams[L.userTid]; return L.phase === 'STAFF' && !!t.staff.AC && (t.staff.AC.tenure || 0) >= 3; }
export function promoteAssistant(L) {
  if (!canPromote(L)) return { ok: false, error: 'Your assistant needs 3+ seasons with the team, during Staff week.' };
  const t = L.teams[L.userTid]; const old = t.staff.HC; if (old) L.staffPool.push({ ...old, years: randInt(1, 3) });
  promote(t); msg(L, 'Front Office', `${t.staff.HC.name} promoted`, `${t.staff.HC.name} is your new head coach, bringing his ${t.staff.HC.off} offense and ${t.staff.HC.def} defense. Hire a new assistant.`);
  news(L, `${t.abbr} promote assistant ${t.staff.HC.name} to head coach.`, 'staff', t.tid); return { ok: true };
}
export function fireStaff(L, role) { const t = L.teams[L.userTid]; const s = t.staff[role]; if (!s) return; L.staffPool.push(s); t.staff[role] = null; }
function leaveStaff(L) { const t = L.teams[L.userTid]; for (const role of ['HC', 'AC', 'SC', 'TR']) if (!t.staff[role]) aiHire(L, t, role); }

// ================= lottery & draft =================
export function enterLottery(L) {
  L.phase = 'LOTTERY';
  applyHistory(L, 'lottery');
  const exps = [...new Set([...(L.expansions || []).filter(e => e.season === L.season).map(e => e.tid), ...(L.expansionSeason === L.season ? [L.expansionTid] : [])])];
  const exp = exps[0] ?? -1;
  const rec = standings(L).filter(r => !exps.includes(r.tid) && !L.teams[r.tid].inactive);
  const po = new Set(L.playoffs ? [...L.playoffs.seeds.E, ...L.playoffs.seeds.W] : []);
  const non = rec.filter(r => !po.has(r.tid)).sort((a, b) => a.pct - b.pct || a.diff - b.diff).map(r => r.tid);
  const rule = lotteryRule(L, non.length), weights = rule.weights, draws = L.settings.lottery === false ? 0 : rule.draws; // lottery off: worst record picks first
  const drawn = []; const pool = non.map((tid, i) => ({ tid, w: weights[i] ?? 1 }));
  for (let k = 0; k < draws; k++) { const x = weighted(pool.filter(p => !drawn.includes(p.tid)), p => p.w); drawn.push(x.tid); }
  const order1 = [...drawn, ...non.filter(t => !drawn.includes(t))];
  const poOrder = rec.filter(r => po.has(r.tid)).sort((a, b) => a.pct - b.pct || a.diff - b.diff).map(r => r.tid);
  const r1 = [...order1, ...poOrder];
  const r2 = rec.slice().sort((a, b) => a.pct - b.pct || a.diff - b.diff).map(r => r.tid);
  for (const [ei, exp] of exps.entries()) { r1.splice(3 + ei, 0, exp); r2.splice(ei, 0, exp); for (const r of [1, 2]) if (!L.picks.some(p => p.season === L.season && p.round === r && p.orig === exp)) L.picks.push({ id: `${L.season}-${r}-${L.teams[exp].abbr}`, season: L.season, round: r, orig: exp, tid: exp }); }
  L.lottery = { season: L.season, pre: non, result: order1.slice(0, non.length), odds: non.map((t, i) => ({ tid: t, combos: weights[i] })) };
  const S = L.season; const order = [];
  r1.forEach((orig, i) => { const pk = L.picks.find(p => p.season === S && p.round === 1 && p.orig === orig); if (pk) order.push({ ...pk, pick: i + 1 }); });
  r2.forEach((orig, i) => { const pk = L.picks.find(p => p.season === S && p.round === 2 && p.orig === orig); if (pk) order.push({ ...pk, pick: r1.length + i + 1 }); });
  L.draftOrder = order;
  const up = order.filter(o => o.tid === L.userTid && o.round === 1).map(o => `#${o.pick}`);
  news(L, `Draft lottery: ${order1.slice(0, draws).map((t, i) => `${i + 1}. ${L.teams[t].abbr}`).join(', ')}.`, 'draft');
  msg(L, 'League Office', 'Draft lottery results', `Top ${draws}: ${order1.slice(0, draws).map(t => L.teams[t].abbr).join(', ')}. Your first-round pick(s): ${up.join(', ') || 'none'}.`);
}
export function enterDraft(L) { L.phase = 'DRAFT'; L.draft = { order: L.draftOrder, idx: 0, log: [] }; }
export const prospects = (L) => L.players.filter(p => p.tid === -2 && p.draft?.year === L.season);
function aiPickValue(L, p, tid) {
  const sc = staffEffects(L, tid).scout;
  const potEst = p.pot + ((Math.sin(p.pid * 7.1 + tid) * 43758.5) % 1) * (100 - sc) / 5;
  const need = teamPlayers(L, tid).filter(x => x.pos === p.pos && x.ovr >= 65).length;
  const jit = (((Math.sin(p.pid * 12.9898 + tid * 78.233) * 43758.5453) % 1 + 1) % 1 - 0.5) * 3; // mild per-team noise
  const base = p.ovr * 0.45 + potEst * 0.55 - need * 0.8 + jit;
  // real classes: consensus/real draft slot dominates at the top (log scale), ratings still matter further down
  if (p.real || p.projPick) return base * 0.5 + 42 - 14 * Math.log(Math.min(p.projPick || 75, 75));
  if (L.settings.draftClasses === 'real') return base * 0.5 + 42 - 14 * Math.log(32); // filler prospects in a real class: late-1st value
  return base;
}
// v43: team needs for the draft screen. Per position: best eligible player (natural pos full value, secondary pos -3),
// next-best for depth, and penalties for an aging (33+) or expiring starter. Higher score = bigger need.
export function teamNeedsDetail(L, tid) {
  const ps = teamPlayers(L, tid); const yrsLeft = (p) => p.contract ? p.contract.exp - L.season + (['AWARDS', 'STAFF', 'LOTTERY', 'DRAFT'].includes(L.phase) ? 0 : 1) : 0;
  return ['PG', 'SG', 'SF', 'PF', 'C'].map(pos => {
    const el = ps.map(p => { const e = eligiblePos(p); const nat = p.pos === pos; const sec = !nat && e.includes(pos); return nat || sec ? { p, v: dispRating(p.ovr) - (nat ? 0 : 3) } : null; }).filter(Boolean).sort((a, b) => b.v - a.v);
    const st = el[0], dp = el[1]; const sv = st?.v ?? 40, dv = dp?.v ?? 40;
    const notes = []; let pen = 0;
    if (!st) notes.push('no player'); if (!dp) notes.push('no depth');
    if (st && st.p.age >= 33) { pen += 3 + (st.p.age - 33); notes.push(`aging starter (${st.p.age})`); }
    if (st && yrsLeft(st.p) <= (['AWARDS', 'STAFF', 'LOTTERY', 'DRAFT'].includes(L.phase) ? 0 : 1)) { pen += 2; notes.push('starter expiring'); }
    const score = Math.round((100 - (sv * 0.65 + dv * 0.35)) + pen);
    return { pos, score, starter: st ? { pid: st.p.pid, name: st.p.name, ovr: Math.round(st.v + (st.p.pos === pos ? 0 : 3)) } : null, depth: el.length, notes };
  }).sort((a, b) => b.score - a.score);
}
export const topNeeds = (L, tid, n = 2) => teamNeedsDetail(L, tid).slice(0, n).map(x => x.pos);
export const fillsNeed = (L, p, tid) => { const t = topNeeds(L, tid); return eligiblePos(p).some(x => t.includes(x)) || t.includes(p.pos); };
export function draftPlayer(L, pid) {
  const D = L.draft; const slot = D.order[D.idx]; if (!slot) return { ok: false, error: 'Draft over' };
  const p = getP(L, pid); if (!p || p.tid !== -2) return { ok: false, error: 'Not available' };
  p.tid = slot.tid; p.draft = { year: L.season, round: slot.round, pick: slot.pick, tid: slot.tid, byUser: draftControls(L, slot.tid) || undefined };
  if (slot.tid === L.userTid && slot.pick === 1) L.gm.draftedFirst = true;
  const yrs = slot.round === 1 ? 3 : 2;
  const amt = L.settings.rookieScale === false ? Math.round(clamp(marketValue(p, L.season + 1) * 0.85, minSalary(L.season + 1), maxSalary(L.season + 1, p)) / 10) * 10 : slot.round === 1 ? Math.max(minSalary(L.season + 1), Math.round(capFor(L.season + 1) * 0.105 * Math.pow(0.93, slot.pick - 1) / 10) * 10) : minSalary(L.season + 1);
  p.contract = { amt, exp: L.season + yrs, rookie: true, ng: slot.round === 2, signed: L.season };
  D.log.push({ pick: slot.pick, round: slot.round, tid: slot.tid, pid, name: p.name, pos: p.pos });
  { const c = careerMode(L) === 'real' && p.real ? careerOf(L, p) : null; const fy = c ? Math.min(...Object.keys(c.a).map(Number)) : null; // v46: draft-and-stash (Ginobili, Kirilenko)
    if (fy != null && fy > L.season) { p.contract = null; p.tid = -3; p.retired = true; p.overseas = true; p.stashed = true; p.retiredSeason = L.season;
      p.hiatus = { from: fy, until: fy, age: c.a[String(fy)][3] ?? p.age + (fy - L.season), exTid: slot.tid, stash: true, rights: slot.tid };
      news(L, `${L.teams[slot.tid].abbr} draft ${p.name} and stash him overseas (expected ${fy}-${String(fy + 1).slice(2)}).`, 'draft', slot.tid); } }
  L.picks = L.picks.filter(x => x.id !== slot.id);
  D.idx++;
  if (draftControls(L, slot.tid)) news(L, `${L.teams[slot.tid].abbr} select ${p.name} with pick #${slot.pick}.`, 'draft', slot.tid);
  return { ok: true };
}
// auto-pick the current pick (whoever's on the clock), using that team's scouting/needs
export function draftAutoOne(L) {
  const D = L.draft; const slot = D?.order[D.idx]; if (!slot) return null; const ps = prospects(L); if (!ps.length) { D.idx = D.order.length; return null; }
  const best = ps.sort((a, b) => aiPickValue(L, b, slot.tid) - aiPickValue(L, a, slot.tid))[0]; draftPlayer(L, best.pid); return best;
}
export function draftUntilUser(L, { all = false, one = false } = {}) {
  const D = L.draft; const start = D.idx;
  while (D.idx < D.order.length) {
    if (one && D.idx > start) return D.order[D.idx];
    const slot = D.order[D.idx];
    if (draftControls(L, slot.tid) && !all) return slot;
    const ps = prospects(L); if (!ps.length) { D.idx = D.order.length; break; }
    const best = ps.sort((a, b) => aiPickValue(L, b, slot.tid) - aiPickValue(L, a, slot.tid))[0];
    draftPlayer(L, best.pid);
  }
  return null;
}
function leaveDraft(L) {
  const S = L.season;
  for (const p of prospects(L)) { p.tid = -1; p.udfa = true; p.draft = { year: S, round: null, pick: null, tid: null }; }
  const real = L.settings.draftClasses === 'real' ? (L.data.udfa[String(S)] || []) : [];
  for (const r of real) { const p = prospectFromReal({ ...r, dr: null, dp: null }, S, { histTendency: L.settings.histTendency }); p.tid = -1; p.udfa = true; p.devTrait = devTrait(p); p.draft = { year: S, round: null, pick: null, tid: null }; resetSeasonStats(p, L.season); L.players.push(p); }
  addPicksForSeason(L, S + 2); ensureFuturePicks(L);
  const top = L.draft.log.slice(0, 5).map(d => `${d.pick}. ${d.name} (${L.teams[d.tid].abbr})`).join(' · ');
  news(L, `${S} Draft top picks: ${top}`, 'draft');
  reindex(L);
}
// ================= re-sign =================
function cpuResign(L, p) {
  const val = marketValue(p, L.season); const keep = p.ovr >= 60 + (p.age >= 32 ? 6 : 0) && payroll(L, p.tid) - p.contract.amt + val < capFor(L.season) * 1.6 && rand() < 0.75;
  if (stableRosters(L)) { const yrs = prefYears(p); p.contract = { amt: Math.round(val / 10) * 10, exp: L.season + yrs - 1, signed: L.season }; return; }
  if (keep && willingToNegotiate(L, p, p.tid)) { const yrs = prefYears(p); p.contract = { amt: Math.round(val * (0.95 + rand() * 0.15) / 10) * 10, exp: L.season + yrs - 1, signed: L.season }; }
  else { p.formerTid = p.tid; p.tid = -1; p.contract = null; }
}
export function enterResign(L) {
  L.phase = 'RESIGN'; L.season += 1; ensureFuturePicks(L);
  for (const p of L.players) { const c = p.contract; if (c?.raise && c.exp >= L.season && L.season > (c.first ?? L.season)) c.amt = salaryInYear(c, L.season); }
  L.deadMoney = L.deadMoney.filter(d => d.exp >= L.season);
  L.expiring = []; const managed = managedSet(L);
  for (const p of L.players) {
    if (p.tid < 0 || !p.contract || p.contract.exp >= L.season) continue;
    if (managed.has(p.tid)) { L.expiring.push(p.pid); p.resignAsk = askingAmount(L, p, p.tid, 'resign'); p.willing = willingToNegotiate(L, p, p.tid); }
    else cpuResign(L, p);
  }
  if (L.expiring.length) msg(L, 'Front Office', 'Contracts expiring', `${L.expiring.length} of your players have expiring contracts. Re-sign them now or they hit free agency.`, { pri: 'high' });
}
export function resignOffer(L, pid, amt, years, raise = 0) {
  raise = Math.max(-raiseCap(L.season, true), Math.min(raiseCap(L.season, true), raise || 0));
  const p = getP(L, pid); if (!L.expiring?.includes(pid)) return { ok: false, error: 'Not expiring' };
  if (p.tid !== L.userTid) return { ok: false, error: `${p.name} plays for ${L.teams[p.tid].abbr} — switch to that team to re-sign him.` };
  if (!p.willing) return { ok: false, error: `${p.name} refuses to negotiate with you.` };
  if (years < 1 || years > maxYears(L, true)) return { ok: false, error: `Contracts are 1–${maxYears(L, true)} years.` };
  if (amt > maxSalary(L.season, p)) return { ok: false, error: `Above the maximum salary ($${(maxSalary(L.season, p) / 1000).toFixed(2)}M for ${p.name}).` };
  if (!offerAcceptable(L, p, L.userTid, amt * loadValue(raise), years, p.resignAsk)) {
    p.resignAsk = Math.round(p.resignAsk * 1.02 / 10) * 10; // patience + talks-ending handled by frontoffice.negotiate
    return { ok: false, error: `${p.name} rejected the offer.${p.willing ? '' : ' He has ended talks.'}` };
  }
  { const y1 = Math.round(yearOneFor(amt, years, raise)); p.contract = { amt: y1, exp: L.season + years - 1, signed: L.season, ...(raise ? { raise, base: y1, first: L.season, aav: Math.round(amt) } : {}) }; }
  L.expiring = L.expiring.filter(x => x !== pid);
  logTx(L, { day: 0, type: 'sign', text: `${L.teams[L.userTid].abbr} re-signed ${p.name} (${years}y, ${contractWords(p.contract, years)})` }, [p.pid]);
  return { ok: true };
}
function leaveResign(L) {
  for (const pid of L.expiring || []) { const p = getP(L, pid); if (p.tid < 0) continue; if (p.tid === L.userTid || p.tid === homeTid(L)) { p.formerTid = p.tid; p.tid = -1; p.contract = null; } else cpuResign(L, p); }
  L.expiring = [];
}
// ================= free agency =================
export function freeAgents(L) { return L.players.filter(p => p.tid === -1 && !p.retired); }
export function enterFA(L) { realComebacks(L); for (const p of L.players) if (p.hiatus && p.hiatus.until <= L.season - 1) endHiatus(L, p);
  L.fa = { offers: {}, round: 1 }; aiFAOffers(L, 1); news(L, 'Free agency is open!', 'fa'); }
export function faRound(L) { return L.phase.startsWith('FA') ? +L.phase[2] : 0; }
export function userOffer(L, pid, amt, years, raise = 0) {
  raise = Math.max(-raiseCap(L.season, false), Math.min(raiseCap(L.season, false), raise || 0)); if (L.phase === 'REGULAR') raise = 0;
  const p = getP(L, pid); if (!p || p.tid !== -1) return { ok: false, error: 'Not a free agent' };
  if (years < 1 || years > maxYears(L, false)) return { ok: false, error: `Contracts are 1–${maxYears(L, false)} years.` };
  if (teamPlayers(L, L.userTid).filter(p => !p.il).length + Object.values(L.fa.offers).filter(o => o.some(x => x.tid === L.userTid)).length >= ROSTER_MAX + 2 && faRound(L))
    return { ok: false, error: 'Too many open offers for your roster size.' };
  if (teamPlayers(L, L.userTid).filter(p => !p.il).length >= ROSTER_MAX) return { ok: false, error: `Active roster full (${ROSTER_MAX}).` + ' Release a player or move an injured one to the injured list.' };
  const aff = canAfford(L, L.userTid, Math.round(yearOneFor(amt, years, raise))); if (!aff.ok) return aff;
  const r = faRound(L);
  if (!r) { // instant signing (in-season / after FA)
    const ask = askingAmount(L, p, L.userTid, L.phase === 'REGULAR' ? 'inseason' : 'fa', 3);
    if (!offerAcceptable(L, p, L.userTid, amt * loadValue(raise), years, ask)) return { ok: false, error: `${p.name} wants about $${(ask / 1000).toFixed(2)}M.` };
    if (aff.mle) L.teams[L.userTid].mleUsed = true;
    sign(L, p, L.userTid, amt, years, { ng: amt <= minSalary(L.season) * 1.001 && L.phase !== 'REGULAR', raise });
    return { ok: true, signed: true };
  }
  L.fa.offers[pid] = (L.fa.offers[pid] || []).filter(o => o.tid !== L.userTid);
  L.fa.offers[pid].push({ tid: L.userTid, amt: Math.round(amt), years, mle: !!aff.mle, raise });
  return { ok: true, pending: true };
}
export function aiFAOffers(L, round) {
  const fas = freeAgents(L).sort((a, b) => b.ovr - a.ovr);
  const teams = shuffle(L.teams.filter(t => t.tid !== L.userTid && !t.inactive));
  for (const t of teams) {
    const n = teamPlayers(L, t.tid).length + Object.values(L.fa.offers).filter(o => o.some(x => x.tid === t.tid)).length;
    if (n >= ROSTER_MAX) continue;
    const space = cap(L) - payroll(L, t.tid);
    const tries = round === 3 ? 3 : 2;
    let made = 0;
    for (const p of fas) {
      if (made >= tries) break;
      if (L.fa.offers[p.pid]?.some(o => o.tid === t.tid)) continue;
      if (stableRosters(L) && p.formerTid >= 0 && p.formerTid !== t.tid) continue; // no poaching other teams' players
      const ask = askingAmount(L, p, t.tid, 'fa', round);
      const amt = Math.round(ask * (0.95 + rand() * 0.15) / 10) * 10;
      const aff = canAfford(L, t.tid, amt, { bird: p.birdRights && p.formerTid === t.tid });
      const want = p.ovr >= teamPlayers(L, t.tid).sort((a, b) => b.ovr - a.ovr)[8]?.ovr - 2 || n < ROSTER_MIN;
      if (aff.ok && want && rand() < 0.55) { (L.fa.offers[p.pid] ||= []).push({ tid: t.tid, amt, years: prefYears(p), mle: !!aff.mle, raise: prefYears(p) > 1 && L.season >= 1999 && rand() < 0.6 ? raiseCap(L.season, false) * (rand() < 0.85 ? 1 : -1) : 0 }); made++; }
    }
  }
}
export function resolveFA(L, round) {
  const thresh = [0, 1.0, 0.93, 0.85][round];
  for (const pidS of Object.keys(L.fa.offers)) {
    const p = getP(L, +pidS); const offers = L.fa.offers[pidS]; if (!p || p.tid !== -1 || !offers?.length) { delete L.fa.offers[pidS]; continue; }
    const valid = offers.filter(o => teamPlayers(L, o.tid).length < ROSTER_MAX && canAfford(L, o.tid, o.amt, { bird: p.birdRights && p.formerTid === o.tid }).ok);
    const scored = valid.map(o => ({ o, s: o.amt * loadValue(o.raise) * moodToward(L, p, o.tid) / (1 + 0.04 * Math.abs(o.years - prefYears(p))) })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    const ask = askingAmount(L, p, best?.o.tid ?? 0, 'fa', round);
    if (best && best.s >= ask * thresh * 0.97) {
      const o = best.o; if (o.mle) L.teams[o.tid].mleUsed = true;
      sign(L, p, o.tid, o.amt, o.years, o.raise ? { raise: o.raise } : {});
      if (o.tid === L.userTid) msg(L, 'Front Office', `${p.name} signs!`, `${p.name} accepted your offer (${o.years}y, $${(o.amt / 1000).toFixed(2)}M/yr).`);
      else if (offers.some(x => x.tid === L.userTid)) msgBatch(L, 'faelse', 'Front Office', 'Free agency: signed elsewhere', `${p.name} chose the ${teamName(L, o.tid)}.`, { pri: 'normal', days: 30 });
      if (p.ovr >= 72) news(L, `${p.name} signs with ${L.teams[o.tid].abbr} (${o.years}y/$${(o.amt * o.years / 1000).toFixed(1)}M).`, 'fa', o.tid);
    } else if (offers.some(x => x.tid === L.userTid) && round < 3) msgBatch(L, 'faundecided', 'Front Office', 'Free agency: still deciding', `${p.name} wants to hear more offers next round.`, { days: 30 });
    delete L.fa.offers[pidS];
  }
}
// ================= summer progression =================
export function anchorTargets(L, top150 = null) {
  const x = L.players.filter(p => p.tid >= 0).map(p => p.ovr).sort((a, b) => b - a); const m = (a) => Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10;
  return { top150: top150 ?? m(x.slice(0, 150)), top10: m(x.slice(0, 10)) - 1 };
}
// smooth aging: one offseason (development + real-career pull + league anchor) can't move a player more than his age allows
export const PROG_CAP = { on: true };
export function ageBand(a) { return a <= 23 ? [-2, 99] : a <= 29 ? [-2, 3] : a <= 32 ? [-3, 2] : [-6, 1]; }
function capYearChange(p) {
  const [lo, hi] = ageBand(p.age);
  for (let i = 0; i < 4; i++) {
    const d = dispRating(p.ovr) - dispRating(p.prevOvr); const fix = d < lo ? lo - d : d > hi ? hi - d : 0; if (!fix) return;
    for (const k of Object.keys(p.ratings)) if (k !== 'sta' && k !== 'dur' && typeof p.ratings[k] === 'number' && typeof p.prevRatings[k] === 'number')
      p.ratings[k] = clamp(p.ratings[k] + Math.sign(fix) * Math.max(1, Math.round(Math.abs(fix) * 0.9)), 1, 99);
    p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.pot, p.ovr);
  }
}
function enterSummer(L) {
  L.phase = 'SUMMER'; L.progressReport = [];
  if (L.ratingAnchor == null || typeof L.ratingAnchor === 'number') L.ratingAnchor = anchorTargets(L, L.ratingAnchor); // old saves
  if (L.skipNextSummer) { L.skipNextSummer = false; L.anchorShift = 0; L.progressNote = 'Your league started in the 1996 offseason, so players have not aged yet — development begins after the 1996-97 season.'; L.progressReport.sort((a, b) => b.d - a.d); return; }
  L.progressNote = null;
  for (const p of L.players) {
    if (p.retired || p.tid === -3 || p.tid === -2) continue;
    p.prevRatings = { ...p.ratings }; p.prevOvr = p.ovr;
    const mins = p.stats.reg.gp ? p.stats.reg.min / p.stats.reg.gp : 0;
    const eff = p.tid >= 0 ? staffEffects(L, p.tid) : { dev: 50 };
    const motivator = p.tid === L.userTid && L.gm.archetype === 'Motivator';
    const hT = L.settings.histTendency || 0;
    if (p.histPot != null && hT > 0 && p.age <= 29) { const k = Math.min(0.9, hT * 0.8 + (p.histPot >= 85 ? 0.2 : 0)); p.pot = Math.round(Math.max(p.ovr - 1, (1 - k) * p.pot + k * p.histPot)); }
    progress(p, { coachDev: eff.dev, motivator, minutes: mins, season: L.season });
    // real-career stars develop on schedule: close part of the gap to their historical level each summer
    if (p.histPot >= 84 && hT > 0 && p.age <= 27 && p.ovr < p.histPot - 2) {
      const g = Math.min(4, Math.round((p.histPot - p.ovr) * hT * 0.45 * (0.7 + rand() * 0.6)));
      if (g > 0) { for (const k of Object.keys(p.ratings)) if (k !== 'sta' && k !== 'dur' && typeof p.ratings[k] === 'number') p.ratings[k] = clamp(p.ratings[k] + g, 1, 99);
        p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.pot, p.ovr); }
    }
    const spd = L.settings.progression ?? 1;
    if (spd !== 1) { for (const k of Object.keys(p.prevRatings)) if (typeof p.ratings[k] === 'number') p.ratings[k] = clamp(Math.round(p.prevRatings[k] + (p.ratings[k] - p.prevRatings[k]) * spd), 1, 99);
      p.ovr = ovrFromAttrs(p.ratings, p.pos); if (spd < 1) p.pot = Math.max(p.ovr, p.pot); }
  }
  // real career arcs (Player careers: Real / Mostly real)
  const arcRetire = [];
  const arcHiatus = [];
  for (const p of L.players) if (p.injury?.real) p.injury = null; // last year's real lost season is over
  for (const p of L.players) { if (p.retired || p.tid === -3 || p.tid === -2) continue; const r = applyArc(L, p, L.season - 1); // v40: off-by-one fix (L.season 1998 = 1997-98 = career key 1997)
    if (r === 'retire') { if (p.age >= 33 && !(p.tid >= 0 && p.contract && p.contract.exp > L.season && p.age < 37)) arcRetire.push(p); } // v39: real-career end only retires veterans
    else if (r?.hiatus) arcHiatus.push([p, r.hiatus]); // v40: restored (was commented out in v39)
    else if (r?.out) { p.injury = { type: 'Out for the season', games: 100, gamesTotal: 100, real: true }; if (p.tid === L.userTid) msg(L, 'Trainer', `${p.name} will miss the season`, `${p.name} will sit out the ${L.season}-${String(L.season + 1).slice(2)} season (his real career had a lost year here).`); } }
  if (L.settings.retirement !== false) {
    for (const p of arcRetire) { const mine = p.tid === L.userTid; retire(L, p); if (mine) msg(L, 'Front Office', `${p.name} retires`, `${p.name} has announced his retirement, as in his real career.`); }
    for (const [p, until] of arcHiatus) if (p.age >= 30 && !(p.tid >= 0 && p.contract && p.contract.exp > L.season)) startHiatus(L, p, until); // under contract: keeps playing
  }
  if (!L.ratingAnchor.attr?.sco) L.ratingAnchor.attr = { ...attrTops(L.players), ...(L.ratingAnchor.attr || {}) }; anchorAttrTails(L.players, L.ratingAnchor.attr);
  L.anchorShift = anchorRatings(L.players, L.ratingAnchor);
  for (const p of L.players) if (!p.retired && p.tid >= -1 && (p.peakTarget != null || DEFAULT_PEAKS[p.name])) applyPeakNow(L, p, L.season - 1); // peak targets survive the league anchor
  if (PROG_CAP.on) for (const p of L.players) if (!p.retired && p.tid >= -1 && p.prevOvr != null && p.prevRatings) capYearChange(p);
  for (const p of L.players) if (!p.retired && p.tid >= -2) { capFictional(p); floorReal(p); } // v47: filler stays filler; v48: real players >= 70
  for (const p of L.players) {
    if (p.tid !== L.userTid || p.prevOvr == null) continue; const d = p.ovr - p.prevOvr;
    L.progressReport.push({ pid: p.pid, name: p.name, d, ovr: p.ovr, age: p.age });
    if (Math.abs(d) >= 5) msgBatch(L, 'dev', 'Head Coach', 'Summer development report', `${p.name}: ${d > 0 ? 'big jump' : 'worrying drop'} — now ${dispRating(p.ovr)} (${d > 0 ? '+' : ''}${dispRating(p.ovr) - dispRating(p.ovr - d)}).`, { pri: 'normal', days: 60 });
  }
  L.progressReport.sort((a, b) => b.d - a.d);
}

// ================= alternative start points (PGM2: start at preseason / free agency / draft) =================
// Real players who were free agents in the summer of 1996 (public facts; their 1996-97 team is where they signed).
export const FA_1996 = { "Shaquille O'Neal": 'ORL', 'Alonzo Mourning': 'MIA', 'Juwan Howard': 'WAS', 'Gary Payton': 'SEA', 'Reggie Miller': 'IND', 'Dikembe Mutombo': 'DEN',
  'Dennis Rodman': 'CHI', 'Michael Jordan': 'CHI', 'Kenny Anderson': 'CHH', 'Allan Houston': 'DET', 'Chris Childs': 'NJN', 'P.J. Brown': 'NJN', 'Kevin Willis': 'GSW',
  'Jerome Kersey': 'GSW', 'Antonio Davis': 'IND', 'Buck Williams': 'POR', 'Byron Scott': 'VAN', 'Derek Harper': 'NYK', 'Brent Price': 'WAS' }; // name → 1995-96 team
function releaseToFA(L, p, prevAbbr) { const prev = L.teams.find(t => t.abbr === prevAbbr); p.formerTid = prev ? prev.tid : p.tid; p.birdRights = true; p.tid = -1; p.contract = null; p.stats.tid = -1; }
export function applyStart(L, start) {
  if (start === 'FA' || start === 'DRAFT') {
    for (const [n, ab] of Object.entries(FA_1996)) { const p = L.players.find(x => x.name === n && x.tid >= 0); if (p) releaseToFA(L, p, ab); }
    L.schedule = []; L.day = 0; L.skipNextSummer = true; L.startPoint = start;
  }
  if (start === 'FA') {
    L.phase = 'FA1'; enterFA(L);
    msg(L, 'League Office', 'Free agency is open', 'Your league starts at 1996 free agency. The summer of 1996 class is on the market — Shaq, Alonzo Mourning, Juwan Howard, Gary Payton, Reggie Miller and more. Offers are decided at the end of each week.', { pri: 'high' });
  } else if (start === 'DRAFT') {
    const S = 1996; L.season = S;
    const rookies = L.players.filter(p => p.draft?.year === S && p.draft.round && p.tid >= 0).sort((a, b) => a.draft.pick - b.draft.pick);
    const holder = {}; for (const p of rookies) holder[p.draft.pick] = p.tid;
    const nPicks = Math.max(58, ...rookies.map(p => p.draft.pick)); const order = []; const count = Object.fromEntries(L.teams.map(t => [t.tid, [0, 0]]));
    const weak = L.teams.map(t => ({ tid: t.tid, o: teamOvr(L, t.tid) })).sort((a, b) => a.o - b.o).map(x => x.tid);
    for (let pk = 1; pk <= nPicks; pk++) {
      const rd = pk <= 29 ? 1 : 2; let tid = holder[pk];
      if (tid == null) tid = weak.slice().sort((a, b) => count[a][rd - 1] - count[b][rd - 1])[0];
      count[tid][rd - 1]++;
      const id = `${S}-${rd}-${L.teams[tid].abbr}-${pk}`; const pick = { id, season: S, round: rd, orig: tid, tid }; L.picks.push(pick); order.push({ ...pick, pick: pk });
    }
    for (const p of rookies) { p.tid = -2; p.contract = null; p.draft = { year: S, round: null, pick: null, tid: null, realPick: p.draft.pick }; p.projPick = p.draft.realPick; }
    for (let i = 0; i < 26; i++) { const p = generateProspect(S, -3, { histTendency: L.settings.histTendency }); p.tid = -2; p.draft = { year: S, round: null, pick: null, tid: null }; p.devTrait = devTrait(p); resetSeasonStats(p, L.season + 1); L.players.push(p); }
    L.draftOrder = order; L.phase = 'DRAFT'; L.draft = { order, idx: 0, log: [] };
    msg(L, 'League Office', 'Welcome to the 1996 Draft', 'Your league starts on draft night 1996: Iverson, Camby, Abdur-Rahim, Marbury, Ray Allen, Kobe Bryant, Steve Nash and more are on the board. Pick order follows who held each pick after draft-day trades.');
  }
  reindex(L);
}
// keep a pool of fringe veterans available all year (min-deal depth); old saves are topped up on load
export function ensureFAPool(L, n = 24) {
  // v40: enough for every CPU team to reach 15, plus a buffer
  const man = managedSet(L); let open = 0; for (const t of L.teams) if (!t.inactive && t.tid !== L.userTid && !man.has(t.tid)) open += Math.max(0, ROSTER_MAX - teamPlayers(L, t.tid).length);
  n = Math.max(n, open + 24);
  let have = freeAgents(L).length; let added = 0;
  while (have < n) { const f = generateVeteran(L.season, randInt(40, 52)); f.tid = -1; resetSeasonStats(f, L.season); L.players.push(f); have++; added++; }
  if (added) reindex(L); return added;
}
export function fairContract(L, p) { return Math.round(clamp(marketValue(p, L.season), minSalary(L.season), maxSalary(L.season, p)) / 10) * 10; }
// commissioner-style signing: any FA to any team at a fair deal, ignoring interest and the cap
export function commissionerSign(L, p, tid) { L.fa ||= { offers: {}, round: 0 }; L.fa.offers ||= {}; delete L.fa.offers[p.pid]; sign(L, p, tid, fairContract(L, p), commishYears(L, p, tid)); return p; }
// longest deal the rules allow (previous team = Bird rights / own-player max)
export function commishYears(L, p, tid) { return maxYears(L, tid === p.formerTid); }
// A free agent's previous team is the club stored on him in this save (formerTid) when that stay
// was recent. Real-life clubs are never looked up, and a missing or stale mark is not a destination.
function recentFormerTid(L, p) {
  const tid = p.formerTid;
  if (!Number.isInteger(tid) || tid < 0) return null;
  const t = L.teams[tid];
  if (!t || t.inactive) return null;
  const recent = (p.career?.at(-1)?.season ?? 0) >= L.season - 1 || p.stats?.tid === tid;
  return recent ? tid : null;
}
const activeOn = (L, tid) => teamPlayers(L, tid).filter(p => !p.il).length;
// Who a return would move. `yours` is a team this GM manages. `full` means that roster is already
// at the active limit once earlier returns in this same pass are counted. Full teams are skipped;
// nobody is waived to make a spot, and the salary cap is not a gate (this is a commissioner signing).
export function returnPlan(L) {
  const managed = managedSet(L);
  const used = { other: {}, yours: {} };
  const rows = [];
  for (const p of freeAgents(L)) {
    const tid = recentFormerTid(L, p);
    if (tid == null) continue;
    const yours = managed.has(tid);
    const book = yours ? used.yours : used.other;
    const n = book[tid] ?? activeOn(L, tid);
    const full = n >= ROSTER_MAX;
    if (!full) book[tid] = n + 1;
    rows.push({ pid: p.pid, tid, yours, full });
  }
  return rows;
}
// Undo free-agent departures: every FA who played for a team last season goes back there on a fair deal.
// includeUser: also players whose previous team is one this GM manages (the UI asks first).
// A team already at the active roster limit is skipped. This does not waive anyone to clear a spot.
export function returnFreeAgents(L, { includeUser = false } = {}) {
  const returned = [], skippedFull = [];
  L.fa ||= { offers: {}, round: 0 }; L.fa.offers ||= {};
  const managed = managedSet(L);
  const used = {};
  for (const p of freeAgents(L)) {
    const tid = recentFormerTid(L, p);
    if (tid == null) continue;
    if (!includeUser && managed.has(tid)) continue;
    const n = used[tid] ?? activeOn(L, tid);
    if (n >= ROSTER_MAX) { skippedFull.push(p); continue; }
    commissionerSign(L, p, tid);
    used[tid] = n + 1;
    returned.push(p);
  }
  if (returned.length) { news(L, `${returned.length} free agents returned to their previous teams.`, 'fa'); ensureFAPool(L); }
  return { returned, skippedFull };
}
