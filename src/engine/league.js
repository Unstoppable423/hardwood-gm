import { applyGlobal } from './draftclass.js';
import { RETIRED_1996 } from './retiredNumbers.js';
import { rawFor, priorFor, histTeams, HIST_MIN, applyEraRules } from './histstart.js';
import { schemeFor } from './schemes.js';
import { PRIOR_HONORS } from './priorHonors.js';
import { rand, randInt, normal, pick, shuffle, clamp, setSeed, getSeed, weighted } from './rng.js';
import { ERA, syncEra } from './era.js';
import { applyRosterFile } from './rosterfile.js';
import { ensureSettings, applyRules, deadlineDay, simEdge, seriesLen } from './franchise.js';
import { TEAMS, capFor, minSalary, maxSalary, ROSTER_MAX, ROSTER_MIN, DIFFICULTY, PHASE_LABEL } from './constants.js';
import { careerMode, arcPot, applyPeakNow, calibrateRealProspect } from './careers.js';
import { START_FUTURE, histPotFromPeak, attrTops, playerFromStats, finalizeStartRatings, prospectFromReal, generateProspect, generateVeteran, devTrait, marketValue,
  setNextPid, getNextPid, POS_OVERRIDE, REAL_STARTERS, POS_ELIG, eligiblePos, genName, ovrFromAttrs, capFictional, floorReal } from './players.js';
import { simGame, autoRotation } from './sim.js';
import { recordSaveGame, franchiseIdOfTeam } from './leaders.js';
import { startPreseason, cpuUpgrade, addStashedReal } from './offseason.js';

export const VERSION = 1;
// ---------- helpers ----------
export const teamPlayers = (L, tid) => L.players.filter(p => p.tid === tid);
export const getP = (L, pid) => L._pmap?.get(pid) ?? L.players.find(p => p.pid === pid);
export function reindex(L) { let mx = 0; for (const p of L.players) if (p.pid > mx) mx = p.pid; if (getNextPid() <= mx) setNextPid(mx + 1); // saves don't store the id counter: never hand out an id in use
  L._pmap = new Map(L.players.map(p => [p.pid, p])); ensureNumbers(L); }
// Old saves: the id counter restarted at 1 after loading, so generated prospects/players reused existing ids
// (tapping one player opened another). Give every duplicate a fresh id; the player on a roster keeps his.
export function markRealStarters(L) { if (L.rsMarked || L.season < 1997 || L.season > 1999) return; L.rsMarked = true;
  for (const t of L.teams) { const names = REAL_STARTERS[t.abbr]; if (!names) continue; for (const p of L.players) if (p.tid === t.tid && names.includes(p.name)) { p.rs = t.tid; } }
  for (const t of L.teams) if (REAL_STARTERS[t.abbr] && t.autoRotation !== false) t.rotation = null; }
export function repairSave(L) {
  if (L.picks && L.teams && L.season) ensureFuturePicks(L);
  if (L.players && !L.capV47) { L.capV47 = true; for (const p of L.players) if (!p.retired) capFictional(p); } // v47 migration: clamp fictional stars
  if (L.players && !L.floorV48) { L.floorV48 = true; for (const p of L.players) if (!p.retired) floorReal(p); } // v48 migration
  if (L.players && L.data?.careers && !L.stashV46) { L.stashV46 = true; addStashedReal(L); } // v46 migration: missing draft-and-stash real players
  if (L.players && L.data?.careers) for (const p of L.players) if (p.tid === -2 && p.real && !p.calV45 && p.draft?.year) calibrateRealProspect(L, p, p.draft.year); // v45 migration // v45 migration: fill missing future years for original owners
  let mx = 0; for (const p of L.players) if (p.pid > mx) mx = p.pid; setNextPid(Math.max(getNextPid(), mx + 1));
  const groups = new Map(); for (const p of L.players) { if (!groups.has(p.pid)) groups.set(p.pid, []); groups.get(p.pid).push(p); }
  let fixed = 0;
  for (const [, ps] of groups) if (ps.length > 1) {
    const rank = (p) => (p.tid >= 0 ? 0 : p.tid === -1 ? 1 : p.retired ? 2 : 3) + (p.tid === -2 ? 1 : 0);
    const keep = ps.slice().sort((a, b) => rank(a) - rank(b))[0];
    for (const p of ps) if (p !== keep) { p.pid = getNextPid(); setNextPid(p.pid + 1); fixed++; }
  }
  if (!L.posFix2) { L.posFix2 = true; for (const p of L.players) { const o = POS_OVERRIDE[p.name]; if (!o || p.real === false) continue; p.natPos = o; if (p.pos !== o) { p.pos = o; p.ovr = Math.max(25, Math.round(ovrFromAttrs(p.ratings, p.pos))); } } } // once (natural position too), so later manual changes stick
  if (!L.posFix3) { L.posFix3 = true; for (const p of L.players) { const e = POS_ELIG[p.name]; if (e && p.real !== false) { p.pos2 = e.slice(1); if (p.natPos && p.natPos !== e[0] && p.pos === p.natPos) { p.natPos = e[0]; p.pos = e[0]; } } else if (!p.pos2) eligiblePos(p); } }
  // roster players without a contract (e.g. traded before signing): give a fair deal
  for (const p of L.players) if (p.tid >= 0 && !p.retired && !p.contract) p.contract = { amt: Math.round(Math.max(minSalary(L.season), marketValue(p, L.season)) / 10) * 10, exp: L.season + 2, signed: L.season, rookie: !!p.draft?.year && p.draft.year >= L.season - 1 };
  // lineups store player ids: drop any lineup that names someone not on that team (stale/colliding ids) so it is rebuilt
  for (const t of L.teams) { const r = t.rotation; if (!r) continue; const ids = new Set(L.players.filter(p => p.tid === t.tid).map(p => p.pid));
    if (!r.starters?.every(id => ids.has(id)) || new Set(r.starters).size !== r.starters.length || Object.keys(r.minutes || {}).some(id => !ids.has(+id))) t.rotation = null; }
  markRealStarters(L);
  reindex(L); return fixed;
}
// Jersey numbers: real 1996-97 numbers from the data; anyone joining a team (draft, FA, trade) keeps his old number
// if it's free there, otherwise takes a position-appropriate unused one. Retired numbers are not modeled.
const NUM_POOL = { G: '1 2 3 4 5 7 8 9 10 11 12 13 14 15 20 21 22 23 24 25 30 31 0 6'.split(' '), F: '21 22 23 24 25 30 31 32 33 34 35 40 42 44 3 5 8 9 11 12 13 14 15 20'.split(' '), C: '33 34 40 41 42 43 44 45 50 52 54 55 00 0 30 31 32 35 11 12 13 14 15 21'.split(' ') };
export function ensureNumbers(L) {
  for (const p of L.players) if (typeof p.num === 'number') p.num = String(p.num);
  const byTeam = new Map();
  for (const p of L.players) if (p.tid >= 0 && !p.retired) { if (!byTeam.has(p.tid)) byTeam.set(p.tid, []); byTeam.get(p.tid).push(p); }
  for (const [tid, ps] of byTeam) {
    const used = new Set(); const need = []; const retired = new Set((L.teams[tid].retiredNums || []).map(r => r.num));
    for (const p of ps) if (p.numTid === tid && p.num != null && !used.has(p.num)) used.add(p.num); else need.push(p);
    for (const n of retired) used.add(n); // never hand out a retired number (players already wearing one when it's retired keep it)
    for (const p of need) {
      const back = p.numHist?.[tid]; let n = back != null && !used.has(back) ? back : p.num != null && !used.has(p.num) ? p.num : null;
      if (n == null) { const pool = NUM_POOL[p.pos === 'C' ? 'C' : p.pos === 'PF' || p.pos === 'SF' ? 'F' : 'G']; const off = (p.pid * 7) % pool.length;
        for (let i = 0; i < pool.length && n == null; i++) if (!used.has(pool[(off + i) % pool.length])) n = pool[(off + i) % pool.length];
        for (let k = 0; n == null; k++) if (!used.has(String(k))) n = String(k); }
      p.num = n; p.numTid = tid; used.add(n); (p.numHist ||= {})[tid] = n;
    }
  }
}
// Fantasy draft mid-save (Franchise Settings, training camp only): every rostered player goes back in the pool and
// all teams, yours included, snake-draft in a random order (best value first; your picks use the same logic).
export function canFantasyDraft(L) { return L.phase === 'PRESEASON' && (L.day || 0) === 0; }
const fdVal = (p) => p.ovr + Math.max(0, p.pot - p.ovr) * (p.age <= 24 ? 0.5 : 0.2) - Math.max(0, p.age - 31) * 1.5;
// interactive fantasy draft (PGM2 draft-room style): pool players wait at tid -6 until picked
export function startFantasyDraft(L) {
  if (!canFantasyDraft(L)) return { ok: false, error: 'The fantasy draft can only be run at training camp, before the season starts.' };
  if (L.fdraft) return { ok: true };
  const teams = shuffle(L.teams.filter(t => !t.inactive).map(t => t.tid));
  const pool = L.players.filter(p => p.tid >= 0 && !p.retired);
  for (const p of pool) { p.fdFrom = p.tid; p.tid = -6; p.birdRights = false; }
  const order = []; for (let i = 0; i < pool.length; i++) { const r = Math.floor(i / teams.length), k = i % teams.length; order.push({ tid: teams[r % 2 ? teams.length - 1 - k : k], round: r + 1, pick: i + 1 }); }
  L.fdraft = { order, idx: 0, log: [], teams };
  news(L, 'Fantasy draft: every roster goes back in the pool.', 'trade'); reindex(L);
  return { ok: true };
}
// teams whose draft picks the user makes: his own, every team with "Draft for all teams", or the ones he ticked
export function draftControls(L, tid) { return tid === L.userTid || !!L.settings?.draftAll || !!L.draftTeams?.includes(tid); }
export function setDraftTeams(L, tids) { L.draftTeams = [...new Set((tids || []).map(Number).filter(t => L.teams[t] && !L.teams[t].inactive && t !== L.userTid))]; return L.draftTeams; }
export function fdAvailable(L) { return L.players.filter(p => p.tid === -6).sort((a, b) => fdVal(b) - fdVal(a)); }
function fdNeed(L, tid, p) { const ps = teamPlayers(L, tid); const n = ps.filter(x => x.pos === p.pos).length; return n >= 4 ? -4 : n === 0 && ps.length >= 5 ? 2 : 0; }
export function fdPick(L, pid) {
  const D = L.fdraft; if (!D) return { ok: false, error: 'No fantasy draft running.' };
  const slot = D.order[D.idx]; const p = getP(L, pid); if (!slot || !p || p.tid !== -6) return { ok: false, error: 'Player not available.' };
  p.tid = slot.tid; delete p.fdFrom; D.log.push({ ...slot, pid: p.pid, name: p.name, pos: p.pos }); D.idx++;
  if (D.idx >= D.order.length || !L.players.some(x => x.tid === -6)) finishFantasyDraft(L);
  return { ok: true, slot };
}
export function fdAuto(L, { all = false, one = false } = {}) {
  let n = 0;
  while (L.fdraft) { const slot = L.fdraft.order[L.fdraft.idx]; if (!all && !one && draftControls(L, slot.tid)) break;
    const av = fdAvailable(L); const best = av.slice(0, 8).sort((a, b) => (fdVal(b) + fdNeed(L, slot.tid, b)) - (fdVal(a) + fdNeed(L, slot.tid, a)))[0];
    fdPick(L, best.pid); n++; if (one) break; }
  return n;
}
function finishFantasyDraft(L) {
  const D = L.fdraft; for (const t of L.teams) if (!t.inactive) t.rotation = null;
  L.fantasyDraft = { season: L.season, order: D.teams, log: D.log }; L.fdraft = null;
  news(L, `Fantasy draft complete. ${L.teams[D.teams[0]].abbr} picked first.`, 'trade'); reindex(L);
}
export function fantasyRedraft(L) { // instant version
  const r = startFantasyDraft(L); if (!r.ok) return r; const order = L.fdraft.teams; fdAuto(L, { all: true });
  return { ok: true, order, userPick: order.indexOf(L.userTid) + 1 };
}
export function payroll(L, tid) {
  let s = 0; for (const p of L.players) if (p.tid === tid && p.contract) s += p.contract.amt;
  for (const d of L.deadMoney) if (d.tid === tid && d.exp >= L.season) s += d.amt; return s;
}
export const cap = (L) => capFor(L.season);
// Inbox. pri: 'high' (decisions, owner, firing, offers you must answer), 'normal' (default), 'low' (routine: arrives read).
export function msg(L, from, subject, body, extra = {}) { const pri = extra.pri || 'normal';
  L.inbox.unshift({ id: L.msgId++, season: L.season, day: L.day, phase: L.phase, from, subject, body, read: pri === 'low', ...extra, pri }); if (L.inbox.length > 250) L.inbox.length = 250; }
// Batched digest: routine items of the same kind within `days` days (same phase) are appended to one message instead of
// creating a new one each time (e.g. "Injury report (4)").
export function msgBatch(L, key, from, title, line, { pri = 'low', days = 7 } = {}) {
  const m = L.inbox.find(x => x.batch === key && x.season === L.season && x.phase === L.phase && L.day - x.batchDay <= days);
  if (m) { m.lines.push(line); m.subject = `${title} (${m.lines.length})`; m.body = m.lines.join('\n'); m.day = L.day; if (pri !== 'low') m.read = false;
    L.inbox.splice(L.inbox.indexOf(m), 1); L.inbox.unshift(m); return m; }
  msg(L, from, title, line, { pri, batch: key, batchDay: L.day, lines: [line] }); return L.inbox[0];
}
// Transactions: league log plus each player's own history (player page)
export function logTx(L, e, pids = []) {
  const x = { season: L.season, day: L.day, ...e, pids }; L.transactions.unshift(x); if (L.transactions.length > 400) L.transactions.length = 400;
  for (const id of pids) { const p = getP(L, id); if (!p) continue; (p.tx ||= []).unshift({ season: x.season, day: x.day, type: x.type, text: x.text }); if (p.tx.length > 40) p.tx.length = 40; }
}
export function news(L, text, type = 'league', tid = null) { L.news.unshift({ season: L.season, day: L.day, text, type, tid }); if (L.news.length > 400) L.news.length = 400; }
export const diff = (L) => DIFFICULTY[L.settings.difficulty] || DIFFICULTY.Medium;
export const teamName = (L, tid) => tid >= 0 ? `${L.teams[tid].city} ${L.teams[tid].name}` : tid === -1 ? 'Free Agent' : tid === -2 ? 'Draft Prospect' : 'Retired';
export function dateOf(L, day = L.day) {
  const d = new Date(Date.UTC(L.season - 1, 10, 1)); d.setUTCDate(d.getUTCDate() + day - 1 + (L.dayOffset || 0));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function teamOvr(L, tid) {
  const ps = teamPlayers(L, tid).filter(p => !p.injury).sort((a, b) => b.ovr - a.ovr);
  const w = [4, 4, 4, 4, 4, 3, 3, 2, 1, 1]; let s = 0, t = 0;
  ps.slice(0, 10).forEach((p, i) => { s += p.ovr * w[i]; t += w[i]; });
  return t ? Math.round(s / t) : 0;
}
function emptyStats() { return { gp: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 }; }
export function resetSeasonStats(p, season) { p.stats = { season, tid: p.tid, reg: emptyStats(), po: emptyStats(), ovrStart: p.ovr }; }

// ---------- new league ----------
export function newLeague(data, opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  setSeed(seed); setNextPid(1);
  // historic start (1946-47 .. 1995-96) from data/history.json; otherwise the original 1996-97 start
  const H = opts.startYear && opts.startYear < 1997 && data.history ? data.history : null;
  const season = H ? Math.max(HIST_MIN, opts.startYear) : 1997;
  const L = { version: VERSION, seed, rng: 0, season, phase: 'PRESEASON', day: 0, msgId: 1,
    settings: { realHistory: opts.realHistory ?? true, difficulty: opts.difficulty || 'Medium', histTendency: opts.histTendency ?? 0.5, draftClasses: opts.draftClasses || 'real',
      injuries: opts.injuries ?? 1, scoutAccuracy: opts.scoutAccuracy ?? 'Normal', devVisibility: opts.devVisibility || 'All',
      hideRookieRatings: opts.hideRookieRatings ?? false, playerCap: opts.playerCap ?? true, staffCap: opts.staffCap ?? false, cpuTrades: opts.cpuTrades ?? true, dark: false },
    userTid: opts.userTid ?? 12,
    gm: { name: opts.gmName || 'You', archetype: opts.archetype || 'Scout', legacy: 0, jobSecurity: 60, seasonsRun: 0, titles: 0, fired: false, history: [] },
    teams: (H ? histTeams(season).map((t, tid) => ({ ...t, tid })) : TEAMS).map(t => ({ ...t, retiredNums: (H ? [] : RETIRED_1996[t[0]] || RETIRED_1996[t.abbr] || []).map(([num, name]) => ({ num, name, season: null, real: true })), rotation: null, autoRotation: true, strategy: { pace: 'Normal', focus: 'Balanced' }, staff: {}, mleUsed: false, lastWinPct: 0.5 })),
    players: [], schedule: [], games: {}, playoffs: null, picks: [], draft: null, lottery: null, fa: { offers: {} },
    history: [], hof: [], records: { game: {}, season: {} }, inbox: [], news: [], deadMoney: [], staffPool: [], transactions: [], expectation: null,
    data: { classes: data.classes?.classes || {}, udfa: data.classes?.udfa || {}, careers: data.classes?.careers || {} } };
  if (H) { L.histStart = season; L.data.history = H; }
  if (!L.teams[L.userTid]) L.userTid = 0; // smaller historic leagues
  Object.assign(L.settings, opts.franchise || {}); ensureSettings(L); applyEraRules(L);
  const abbrIdx = Object.fromEntries(L.teams.map(t => [H ? t.fid : t.abbr, t.tid]));
  const startRows = H ? H.players.map(hp => rawFor(hp, season)).filter(Boolean) : data.start.players;
  const hpBy = H ? Object.fromEntries(H.players.map(hp => [hp.k, hp])) : {};
  for (const raw of startRows) {
    const p = playerFromStats(raw, season); p.tid = abbrIdx[raw.t] ?? -1;
    if (H) { p._prod += raw._boost || 0; p.histKey = raw._key; p.arcKey = raw._key; p.real = true; if (raw._est) p.estSeason = raw._est; } if (raw.num != null) { p.num = String(raw.num); p.numTid = p.tid; if (p.tid >= 0) p.numHist = { [p.tid]: p.num }; } if (p.tid >= 0) p.startTid = p.tid; p._r96 = { pts: raw.pts, reb: raw.reb, ast: raw.ast }; L.players.push(p);
  }
  finalizeStartRatings(L.players, H ? H.teamWins?.[String(season)] : data.start.teamWins);
  // real-career tendency for young 1996 players: future stars head toward stardom, the rest stay grounded
  const hT = careerMode(L) === 'random' ? (L.settings.histTendency || 0) : 0;
  if (careerMode(L) !== 'random') for (const p of L.players) applyPeakNow(L, p, season - 1);
  if (careerMode(L) !== 'random') for (const p of L.players) { const ap = arcPot(L, p, season); if (ap != null) p.pot = Math.max(p.ovr, Math.round(0.85 * ap + 0.15 * p.pot)); }
  if (hT > 0 && !H) for (const p of L.players) if (p.age <= 25) {
    const fp = START_FUTURE[p.name]; const hp = fp != null ? histPotFromPeak(fp) : Math.min(p.pot, 76); p.histPot = hp;
    const hh = fp != null && hp >= 85 ? Math.min(0.92, hT + (1 - hT) * 0.5) : hT;
    p.pot = Math.round(Math.max(p.ovr, (1 - hh) * p.pot + hh * Math.max(p.ovr + 1, hp)));
  }
  for (const p of L.players) {
    p.devTrait = devTrait(p);
    const yrsPro = p.draft?.year ? Math.max(0, season - 1 - p.draft.year) : Math.max(0, p.age - 23);
    // pre-1996-97 career: factual honors table + counting stats estimated from the 1996-97 per-game line
    // (younger seasons discounted), so Hall of Fame odds account for careers that started before the sim.
    const r96 = p._r96 || { pts: 0, reb: 0, ast: 0 }; delete p._r96;
    const gEst = yrsPro * 70 * (p.age >= 31 ? 1.05 : 0.85);
    p.prior = H && p.histKey && hpBy[p.histKey] ? priorFor(hpBy[p.histKey], season) : { yrs: yrsPro, pts: Math.round(gEst * r96.pts), reb: Math.round(gEst * r96.reb), ast: Math.round(gEst * r96.ast), ...(PRIOR_HONORS[p.name] || {}) };
    let exp;
    if (p.draft?.round === 1 && p.draft.year >= season - 3) exp = p.draft.year + 3; else exp = season + randInt(0, clamp(Math.round((32 - p.age) / 2), 0, 5));
    const rookie = p.draft?.round === 1 && p.draft.year >= season - 3 && exp >= season;
    let amt = Math.max(minSalary(season), Math.round(marketValue(p, season) * (0.9 + rand() * 0.8) / 10) * 10);
    if (rookie) amt = rookieScale(season, p.draft.pick || 20);
    p.contract = { amt, exp, rookie };
    // real 1996-97 contracts (public salary lists): real salary, real/inferred end year, raises along the real salary path
    const rc = !H && season === 1997 && data.contracts?.players?.[p.name];
    if (rc) { const ys = rc.years || [rc.amt]; const raise = ys.length > 1 ? clamp((ys.at(-1) - ys[0]) / (ys.length - 1) / ys[0], 0, 0.25) : 0;
      p.contract = { amt: rc.amt, exp: rc.exp, rookie, real: true, ...(raise ? { raise: Math.round(raise * 1000) / 1000, base: rc.amt, first: season } : {}) }; }
    if (p.draft) p.draft.tid = null;
  }
  // Random rosters (PGM2-style "random league"): the real 1996-97 players are dealt to teams by a snake draft in random order
  if (opts.rosters === 'random' && (!opts.start || opts.start === 'PRESEASON')) {
    const pool = L.players.filter(p => p.tid >= 0).sort((a, b) => b.ovr - a.ovr); const order = shuffle(L.teams.map(t => t.tid));
    pool.forEach((p, i) => { const r = Math.floor(i / order.length), k = i % order.length; p.tid = order[r % 2 ? order.length - 1 - k : k]; });
    L.randomRosters = true;
  }
  // Imported roster file replaces the real players (training-camp start only)
  if (opts.rosterFile && (!opts.start || opts.start === 'PRESEASON')) { const r = applyRosterFile(L, opts.rosterFile); if (!r.ok) throw new Error(r.error); }
  // trim rosters to 15 (lowest OVR become free agents), keep at least the rest
  for (const t of L.teams) if (!t.inactive) {
    const ps = teamPlayers(L, t.tid).sort((a, b) => b.ovr - a.ovr);
    ps.slice(ROSTER_MAX).forEach(p => { p.tid = -1; p.contract = null; });
    let pr = payroll(L, t.tid); const lim = cap(L) * 1.45;
    if (pr > lim) { const est = teamPlayers(L, t.tid).filter(p => !p.contract.real); const fix = pr - est.reduce((a, p) => a + p.contract.amt, 0); // real deals stay as signed
      const f = Math.max(0.3, (lim - fix) / Math.max(1, pr - fix)); if (f < 1) for (const p of est) p.contract.amt = Math.max(minSalary(season), Math.round(p.contract.amt * f / 10) * 10); }
  }
  // historic start: teams whose real roster the source only partly covers get generated fill-ins; plus a small FA pool
  if (H) { for (const t of L.teams) if (!t.inactive) while (teamPlayers(L, t.tid).length < ROSTER_MIN) { const f = generateVeteran(season, randInt(40, 50)); f.tid = t.tid; f.fillIn = true; f.contract = { amt: minSalary(season), exp: season, rookie: false }; L.players.push(f); }
    for (let i = 0; i < 20; i++) { const f = generateVeteran(season, randInt(40, 50)); f.tid = -1; f.fillIn = true; f.contract = null; L.players.push(f); } }
  for (const p of L.players) resetSeasonStats(p, season);
  // staff
  syncEra(L);
  for (const t of L.teams) if (!t.inactive) for (const role of ['HC', 'AC', 'SC', 'TR']) t.staff[role] = genStaff(role, season);
  L.staffPool = Array.from({ length: 24 }, (_, i) => genStaff(['HC', 'AC', 'SC', 'TR'][i % 4], season));
  // draft picks for next 2 drafts
  for (const s of [season, season + 1]) addPicksForSeason(L, s); ensureFuturePicks(L); if (!L.stashV46) { L.stashV46 = true; addStashedReal(L); } L.floorV48 = true; for (const p of L.players) if (!p.retired) floorReal(p);
  L.dcGlobal = opts.dcGlobal && typeof opts.dcGlobal === 'object' ? JSON.parse(JSON.stringify(opts.dcGlobal)) : {};
  createDraftClass(L, season);
  startPreseason(L, true);
  msg(L, 'Owner', `Welcome to ${teamName(L, L.userTid)}`, `You've been hired as General Manager. ${L.expectation.text} Build a winner — and keep me happy.`);
  { const t = L.players.filter(p => p.tid >= 0).map(p => p.ovr).sort((a, b) => b - a); const m = (a) => Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10; L.ratingAnchor = { top150: m(t.slice(0, 150)), top10: m(t.slice(0, 10)) - 1, attr: attrTops(L.players) }; }
  HOOKS.newLeague?.(L);
  if (opts.start && opts.start !== 'PRESEASON') HOOKS.applyStart?.(L, opts.start);
  L.rng = getSeed(); reindex(L);
  markRealStarters(L);
  return L;
}
export function rookieScale(season, pick) { return Math.max(minSalary(season), Math.round(capFor(season) * 0.105 * Math.pow(0.93, pick - 1) / 10) * 10); }
// v45: every team owns/tracks R1+R2 picks this many seasons ahead (setting pickYears, default 7). Traded picks keep their owner.
export function ensureFuturePicks(L) { const n = Math.max(1, Math.min(10, +(L.settings?.pickYears ?? 7) || 7)); let added = 0; const before = L.picks.length;
  for (let s = L.season + 1; s <= L.season + n; s++) addPicksForSeason(L, s); added = L.picks.length - before; return added; }
export function addPicksForSeason(L, s) {
  for (const t of L.teams) if (!t.inactive) for (const r of [1, 2]) if (!L.picks.some(p => p.season === s && p.round === r && p.orig === t.tid))
    L.picks.push({ id: `${s}-${r}-${t.abbr}`, season: s, round: r, orig: t.tid, tid: t.tid });
}
const STAFF_FIRST = ['Phil', 'Larry', 'Don', 'Jerry', 'Rick', 'Pat', 'George', 'Doc', 'Mike', 'Paul', 'Lenny', 'Del', 'Chuck', 'Brian', 'Flip', 'Bernie', 'Jeff', 'Stan', 'Dwane', 'Nate'];
const SCHEMES = ['Motion', 'Pick & Roll', 'Post-Up', 'Run & Gun', 'Triangle', 'Isolation'];
const DSCHEMES = ['Man-to-Man', 'Switch Everything', 'Pack the Paint', 'Aggressive Traps', 'Zone Mix'];
export function genStaff(role, season) {
  const r = clamp(Math.round(normal(64, 10)), 35, 95);
  const s = { sid: Math.floor(rand() * 1e9), name: `${pick(STAFF_FIRST)} ${genName().split(' ')[1]}`, role, rating: r, age: randInt(34, 68),
    years: randInt(1, 4), salary: Math.round((role === 'HC' ? 600 : 250) * Math.exp((r - 60) / 18) * capFor(season) / 24363 / 10) * 10 };
  const DS = ERA.zone ? DSCHEMES : DSCHEMES.filter(d => d !== 'Zone Mix');
  if (role === 'HC') { s.off = pick(SCHEMES); s.def = pick(DS); s.dev = clamp(r + randInt(-10, 10), 30, 99); }
  if (role === 'AC') { s.dev = clamp(r + randInt(-5, 8), 30, 99); s.off = pick(SCHEMES); s.def = pick(DS); }
  if (role === 'SC') s.spec = pick(['Current ability', 'Potential']);
  if (role === 'TR') s.spec = pick(['Prevention', 'Recovery']);
  return s;
}
export function staffEffects(L, tid) {
  const st = L.teams[tid].staff;
  const hc = st.HC?.rating ?? 50, ac = st.AC?.dev ?? 50, sc = st.SC?.rating ?? 50, tr = st.TR?.rating ?? 50;
  const user = tid === L.userTid;
  return {
    coach: hc, dev: ((st.HC?.dev ?? 50) * 0.4 + ac * 0.6),
    scout: clamp(sc + (user ? diff(L).scoutBonus + (L.gm.archetype === 'Scout' ? 15 : 0) : 0) + (L.settings.scoutAccuracy === 'High' ? 15 : L.settings.scoutAccuracy === 'Low' ? -15 : 0), 20, 100),
    injury: (1.25 - tr / 200) * (st.TR?.spec === 'Prevention' ? 0.9 : 1) * (user && L.gm.archetype === 'Disciplinarian' ? 0.85 : 1),
    recovery: st.TR?.spec === 'Recovery' ? 1.3 : 1,
  };
}

// ---------- draft class ----------
// global custom classes (edited once in the draft class manager, applied to every franchise that reaches that draft)
export function createDraftClass(L, s) {
  const had = L.players.some(p => p.tid === -2 && p.draft?.year === s && !p.custom) || L.dcApplied?.[s];
  baseDraftClass(L, s);
  const g = L.dcGlobal?.[s]; if (g && !had) { (L.dcApplied ||= {})[s] = true; applyGlobal(L, g, s); }
}
function baseDraftClass(L, s) {
  // custom prospects added early (Create Player / draft class manager) don't stop the real class; a class loaded in 'replace' mode does
  if (L.dcReplace?.[s]) return;
  if (L.players.some(p => p.tid === -2 && p.draft?.year === s && !p.custom)) return;
  const nCustom = L.players.filter(p => p.tid === -2 && p.draft?.year === s && p.custom).length;
  const opts = { histTendency: careerMode(L) === 'random' ? L.settings.histTendency : 0.5 };
  const real = L.settings.draftClasses === 'real' ? (L.data.classes[String(s)] || []) : [];
  const ps = real.map(r => prospectFromReal(r, s, opts));
  const target = Math.max(ps.length, 75 - nCustom);
  for (let i = ps.length; i < target; i++) ps.push(generateProspect(s, i < 12 && real.length === 0 ? 8 - i * 0.5 : -2, real.length ? { ...opts, fillIn: true } : opts));
  // 2005 CBA age limit: from the 2006 Draft every prospect is at least 19 and a year out of high school
  if (L.settings.realHistory !== false && s >= 2006) for (const p of ps) if (p.age < 19) { p.age = 19; if (/high school/i.test(p.college || '')) p.college = 'College (1 yr)'; }
  for (const p of ps) { p.tid = -2; p.draft = { year: s, round: null, pick: null, tid: null }; p.devTrait = devTrait(p); resetSeasonStats(p, L.season); L.players.push(p); }
  for (const p of ps) calibrateRealProspect(L, p, s);
  if (careerMode(L) !== 'random') for (const p of ps) { if (p.calV45) continue; const ap = p.real ? arcPot(L, p, s) : null; if (ap != null) { p.pot = Math.max(p.ovr, Math.round(0.85 * ap + 0.15 * p.pot)); p.histPot = null; } else if (p.real) p.arcKey = null; }
  reindex(L);
}

// ---------- schedule ----------
// Generic NBA-style schedule for any league size / season length (29 or 30 teams; 82, 66 or 50 games).
// Inter-conference pairs meet b times (+e extra via a bipartite circulant when conferences are equal);
// intra-conference pairs meet k or k+1 times (k+1 along an r-regular circulant ordered by division).
function circulant(n, r) {
  const E = []; if (r <= 0) return E;
  for (let d = 1; d <= Math.floor(r / 2); d++) for (let i = 0; i < n; i++) { const j = (i + d) % n; if (d * 2 === n && i >= j) continue; E.push([i, j]); }
  if (r % 2) for (let i = 0; i < n / 2; i++) E.push([i, i + n / 2]);
  return E;
}
export function makeSchedule(L) {
  syncEra(L); const G = (L.settings.seasonGames && L.settings.seasonGames !== 82) ? L.settings.seasonGames : (ERA.games || 82); L.seasonGames = G; // franchise setting overrides; 82 keeps real lockout seasons
   L.dayOffset = ERA.offset || 0;
  const confT = (c) => { const ts = L.teams.filter(t => t.conf === c); const divs = shuffle([...new Set(ts.map(t => t.div))]);
    return divs.flatMap(d => shuffle(ts.filter(t => t.div === d).map(t => t.tid))); };
  const A = confT('E'), B = confT('W');
  const games = [];
  const addN = (a, b, n) => { const f = rand() < 0.5; for (let i = 0; i < n; i++) games.push((i % 2 === 0) === f ? [a, b] : [b, a]); };
  const b = G >= 80 ? 2 : G >= 60 ? 1 : 0;
  const plan = (n, need) => { const k = Math.floor(need / (n - 1)), r = need - k * (n - 1); return (n * r) % 2 === 0 ? { k, r } : null; };
  let e = 0, pA, pB;
  for (; e < 6; e++) { if (e && A.length !== B.length) break; pA = plan(A.length, G - b * B.length - e); pB = plan(B.length, G - b * A.length - e); if (pA && pB) break; }
  if (!pA || !pB) { e = 0; pA = plan(A.length, G - b * B.length) || { k: Math.floor((G - b * B.length) / (A.length - 1)), r: 0 }; pB = plan(B.length, G - b * A.length) || { k: Math.floor((G - b * A.length) / (B.length - 1)), r: 0 }; }
  const n = A.length; const rot = randInt(0, n - 1);
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    let c = b; if (e && ((j - i - rot + 2 * n) % n) < e) c++; if (c) addN(A[i], B[j], c);
  }
  for (const [ts, { k, r }] of [[A, pA], [B, pB]]) {
    const extra = new Set(circulant(ts.length, r).map(([x, y]) => `${Math.min(x, y)}-${Math.max(x, y)}`));
    for (let x = 0; x < ts.length; x++) for (let y = x + 1; y < ts.length; y++) addN(ts[x], ts[y], k + (extra.has(`${x}-${y}`) ? 1 : 0));
  }
  shuffle(games);
  const sched = []; let day = 1, remaining = games; const asDay = G === 82 ? 100 : ERA.games === 50 ? -1 : Math.round(100 * G / 82);
  while (remaining.length) {
    const busy = new Set(); const next = [];
    const cap = day % 7 === 5 ? 4 : randInt(5, 10);
    let n = 0;
    for (const g of remaining) {
      if (n < cap && !busy.has(g[0]) && !busy.has(g[1]) && !(L._lastPlayed?.[g[0]] === day - 1 && L._lastPlayed?.[g[1]] === day - 1 && rand() < 0.5)) {
        busy.add(g[0]); busy.add(g[1]); sched.push({ gid: sched.length, day, h: g[0], a: g[1], played: false }); n++;
      } else next.push(g);
    }
    remaining = next; day++;
    if (day === asDay) day += 4; // All-Star break
  }
  L.schedule = sched; L.tradeDeadline = Math.round(sched[sched.length - 1].day * 0.62); L.allStarDay = asDay > 0 ? asDay : Infinity; // no All-Star Game in the 1999 lockout season
  delete L._lastPlayed;
}

// ---------- standings ----------
// standings are recomputed from the schedule; cache per (season, schedule, games played) since many systems ask every day
export function standings(L) {
  const key = `${L.teams.length}:${L.season}:${L.schedule?.length}:${L._played || 0}`; const c = L._stC;
  if (c && c.key === key && c.sched === L.schedule) return c.val.slice();
  const val = standingsRaw(L); Object.defineProperty(L, '_stC', { value: { key, sched: L.schedule, val }, writable: true, configurable: true, enumerable: false });
  return val.slice();
}
function standingsRaw(L) {
  const rec = L.teams.map(t => ({ tid: t.tid, w: 0, l: 0, hw: 0, hl: 0, aw: 0, al: 0, cw: 0, cl: 0, dw: 0, dl: 0, pf: 0, pa: 0, streak: '', last: [] }));
  for (const g of L.schedule) {
    if (!g.played) continue;
    const H = rec[g.h], A = rec[g.a]; const hw = g.hs > g.as;
    H.pf += g.hs; H.pa += g.as; A.pf += g.as; A.pa += g.hs;
    const same = L.teams[g.h].conf === L.teams[g.a].conf, sameDiv = L.teams[g.h].div === L.teams[g.a].div;
    if (hw) { H.w++; H.hw++; A.l++; A.al++; } else { A.w++; A.aw++; H.l++; H.hl++; }
    if (same) { if (hw) { H.cw++; A.cl++; } else { A.cw++; H.cl++; } }
    if (sameDiv) { if (hw) { H.dw++; A.dl++; } else { A.dw++; H.dl++; } }
    H.last.push(hw ? 'W' : 'L'); A.last.push(hw ? 'L' : 'W');
  }
  for (const r of rec) {
    r.gp = r.w + r.l; r.pct = r.gp ? r.w / r.gp : 0; r.diff = r.gp ? (r.pf - r.pa) / r.gp : 0;
    let s = 0; const lst = r.last; const last = lst[lst.length - 1];
    for (let i = lst.length - 1; i >= 0 && lst[i] === last; i--) s++;
    r.streak = last ? `${last}${s}` : '-'; const l10 = lst.slice(-10); r.l10 = `${l10.filter(x => x === 'W').length}-${l10.filter(x => x === 'L').length}`;
    delete r.last;
  }
  return rec;
}
export function confSeeds(L, conf, rec = standings(L)) {
  const ts = rec.filter(r => L.teams[r.tid].conf === conf);
  const sorter = (a, b) => b.pct - a.pct || b.cw - a.cw || b.diff - a.diff;
  const divs = [...new Set(ts.map(r => L.teams[r.tid].div))];
  const winners = divs.map(d => ts.filter(r => L.teams[r.tid].div === d).sort(sorter)[0]).sort(sorter);
  const rest = ts.filter(r => !winners.includes(r)).sort(sorter);
  const hist = L.settings?.realHistory !== false;
  // 2006-07 to 2014-15: division winners (plus the best other team) take the top 4, seeded by record; from 2015-16 seeding is by record only
  if (hist && L.season >= 2016) return ts.slice().sort(sorter);
  if (hist && L.season >= 2007) { const top = [...winners, rest[0]].filter(Boolean).sort(sorter); return [...top, ...rest.slice(1)]; }
  return [...winners, ...rest];
}

// ---------- season sim ----------
export function rosterFor(L, tid) {
  const t = L.teams[tid]; const ps = teamPlayers(L, tid).filter(p => !p.il); // injured-list players sit
  let rot = t.rotation;
  if (t.autoRotation || !rot || tid !== L.userTid) rot = autoRotation(ps);
  else {
    // drop injured from user's rotation; redistribute their minutes automatically
    const bad = rot.starters.some(id => { const p = getP(L, id); return !p || p.tid !== tid || p.injury; });
    if (bad) rot = autoRotation(ps);
  }
  return { tid, abbr: t.abbr, players: ps, rotation: rot, coach: staffEffects(L, tid).coach, scheme: schemeFor(t.staff?.HC, ps) };
}
function accumulate(L, box, key, gameMeta) {
  for (const tid in box) for (const pid in box[tid]) {
    const line = box[tid][pid]; const p = getP(L, +pid); if (!p) continue;
    if (p.stats.season !== L.season) resetSeasonStats(p, L.season);
    const S = p.stats[key]; if (line.min > 0) S.gp++;
    if (gameMeta && line.min > 0) { const home = +tid === gameMeta.h; const won = home ? gameMeta.hs > gameMeta.as : gameMeta.as > gameMeta.hs; // compact season game log: [gid, opp, home, win, min, pts, reb, ast, fgm, fga, +/-, playoff]
      (p.stats.glog ||= []).push([gameMeta.gid, home ? gameMeta.a : gameMeta.h, home ? 1 : 0, won ? 1 : 0, Math.round(line.min), line.pts, line.orb + line.drb, line.ast, line.fgm, line.fga, line.pm, gameMeta.po ? 1 : 0, line.gs ? 1 : 0, line.tpm, line.tpa, line.ftm, line.fta, line.orb, line.drb, line.stl, line.blk, line.tov, line.pf]); }
    recordSaveGame(p, key, +tid, line, franchiseIdOfTeam(L.teams[+tid]));
    for (const k in line) if (k !== 'gs') S[k] += line[k]; else S.gs += line.gs;
    p.stats.tid = p.tid;
    for (const st of ['pts', 'reb', 'ast']) {
      const v = st === 'reb' ? line.orb + line.drb : line[st];
      const rec = L.records.game[st];
      if (!rec || v > rec.v) L.records.game[st] = { v, pid: p.pid, name: p.name, season: L.season, tid: p.tid };
    }
  }
}
function tickInjuries(L, tids) {
  for (const p of L.players) if (p.injury && (tids.has(p.tid) || p.tid < 0)) {
    p.injury.games -= p.tid >= 0 ? staffEffects(L, p.tid).recovery : 1;
    if (p.injury.games <= 0) { if (p.tid === L.userTid) msgBatch(L, 'cleared', 'Head Trainer', 'Cleared to play', `${p.name} has recovered from his ${p.injury.type}.`); p.injury = null; }
  }
}
export function playGame(L, g, opts = {}) {
  syncEra(L);
  const H = rosterFor(L, g.h), A = rosterFor(L, g.a);
  const inj = L.settings.injuries * diff(L).injury;
  const ue = simEdge(L), edge = ue ? [g.h === L.userTid ? ue : 0, g.a === L.userTid ? ue : 0] : null; // sim difficulty: user team edge
  const res = simGame(H, A, { pbp: !!opts.pbp, edge, homeAdv: opts.playoff ? 0.018 : undefined, injuryMult: inj * (staffEffects(L, g.h).injury + staffEffects(L, g.a).injury) / 2 });
  g.played = true; g.hs = res.hs; g.as = res.as; g.ot = res.ot; L._played = (L._played || 0) + 1;
  accumulate(L, res.box, opts.playoff ? 'po' : 'reg', { gid: g.gid ?? `${g.id}`, h: g.h, a: g.a, hs: res.hs, as: res.as, po: !!opts.playoff });
  if (g.h === L.userTid || g.a === L.userTid || opts.keepBox) L.games[g.gid ?? `${g.id}`] = { box: res.box, qh: res.qh, qa: res.qa, pbp: res.pbp ? res.pbp.map(({ snap, ...e }) => e) : null, h: g.h, a: g.a, hs: res.hs, as: res.as, ot: res.ot, day: L.day, season: L.season };
  for (const i of res.injuries) {
    const p = getP(L, i.pid);
    if (i.tid === L.userTid) if (i.games >= 10) msg(L, 'Head Trainer', `Injury: ${p.name}`, `${p.name} suffered a ${i.type}. Expected out ~${i.games} game(s).`, { pri: 'high' });
      else msgBatch(L, 'inj', 'Head Trainer', 'Injury report', `${p.name}: ${i.type}, out ~${i.games} game(s).`);
    if (i.games >= 15) news(L, `${p.name} (${L.teams[i.tid].abbr}) will miss ~${i.games} games with a ${i.type}.`, 'injury', i.tid);
  }
  return res;
}
export function seasonDone(L) { return L.schedule.length > 0 && L.schedule.every(g => g.played); }
export const HOOKS = {};
export function simDay(L, opts = {}) {
  if (L.phase === 'PLAYOFFS') return simPlayoffDay(L, opts);
  if (L.phase !== 'REGULAR') return null;
  const nextDay = L.schedule.find(g => !g.played)?.day; if (nextDay == null) return null;
  L.day = nextDay;
  const todays = L.schedule.filter(g => g.day === nextDay && !g.played);
  const tids = new Set(); let userRes = null;
  for (const g of todays) {
    const isUser = g.h === L.userTid || g.a === L.userTid;
    const r = playGame(L, g, { pbp: isUser && opts.pbp }); tids.add(g.h); tids.add(g.a); if (isUser) userRes = { g, r };
  }
  tickInjuries(L, tids);
  if (L.day >= L.allStarDay && !L.allStarDone) allStars(L);
  if (L.settings.cpuTrades && !(L.settings.morale === false && !L.settings.cpuMoves) && L.day <= deadlineDay(L) && rand() < 0.04 * (L.settings.cpuTradeFreq || 1)) cpuTrade(L);
  if (L.day % 20 === 10 && L.day <= deadlineDay(L) + 30) cpuUpgrade(L, 1); // periodic, max 1 per team
  HOOKS.day?.(L);
  L.rng = getSeed();
  return userRes;
}
export function simDays(L, n, opts = {}) { applyRules(L); let c = 0; while (c < n && (L.phase === 'REGULAR' ? !seasonDone(L) : L.phase === 'PLAYOFFS' && L.playoffs.champ == null)) { simDay(L, opts); c++; } return c; }
export function simUntilUserGame(L) { // sims days before the user's next game; returns that game (unplayed)
  while (L.phase === 'REGULAR') {
    const nextDay = L.schedule.find(g => !g.played)?.day; if (nextDay == null) return null;
    const ug = L.schedule.find(g => g.day === nextDay && !g.played && (g.h === L.userTid || g.a === L.userTid));
    if (ug) return ug; simDay(L);
  }
  return null;
}

// ---------- all-stars, cpu trades (simple) ----------
export function prodScore(p, key = 'reg') {
  const s = p.stats?.[key]; if (!s || !s.gp) return 0;
  const g = s.gp; return (s.pts + 1.2 * (s.orb + s.drb) + 1.5 * s.ast + 2 * (s.stl + s.blk) - s.tov - 0.4 * (s.fga - s.fgm)) / g;
}
function allStars(L) {
  L.allStarDone = true;
  for (const conf of ['E', 'W']) {
    const ps = L.players.filter(p => p.tid >= 0 && L.teams[p.tid].conf === conf && p.stats.reg.gp >= 10).sort((a, b) => prodScore(b) - prodScore(a)).slice(0, 12);
    ps.forEach(p => p.awards.push({ season: L.season, type: 'All-Star' }));
    news(L, `${conf === 'E' ? 'East' : 'West'} All-Stars: ${ps.map(p => p.name).join(', ')}.`, 'award');
    if (ps.some(p => p.tid === L.userTid)) msg(L, 'League Office', 'All-Star selection', `Congratulations: ${ps.filter(p => p.tid === L.userTid).map(p => p.name).join(', ')} named All-Star(s).`);
  }
}
export let cpuTrade = () => {};
export function setCpuTrade(fn) { cpuTrade = fn; }

// ---------- playoffs ----------
export function startPlayoffs(L) {
  const rec = standings(L);
  // franchise setting: 16 / 8 / 4 playoff teams (8 / 4 / 2 per conference); fewer teams start at a later round
  let k = { 16: 8, 8: 4, 4: 2 }[L.settings.playoffTeams] || 8;
  // historic eras (Real NBA history): smaller leagues had smaller fields; 16 teams from 1983-84. Approximation in
  // powers of two per conference (the real 1947-83 formats used byes and 3-team divisions).
  const nMin = Math.min(...['E', 'W'].map(c => L.teams.filter(t => t.conf === c && !t.inactive).length));
  if (L.settings.realHistory !== false && L.season < 1984) k = Math.min(k, nMin >= 8 ? 4 : 2);
  while (k > 2 && k > nMin) k /= 2;
  const r0 = { 8: 1, 4: 2, 2: 3 }[k];
  const seeds = { E: confSeeds(L, 'E', rec).slice(0, k).map(r => r.tid), W: confSeeds(L, 'W', rec).slice(0, k).map(r => r.tid) };
  const pairs = { 8: [[0, 7], [3, 4], [2, 5], [1, 6]], 4: [[0, 3], [1, 2]], 2: [[0, 1]] }[k];
  const series = [];
  for (const c of ['E', 'W']) pairs.forEach(([a, b], i) => series.push({ id: `${c}${r0}-${i}`, round: r0, conf: c, slot: i, hi: seeds[c][a], lo: seeds[c][b], hiSeed: a + 1, loSeed: b + 1, wh: 0, wl: 0, games: [], len: seriesLen(L, 1) }));
  L.playoffs = { seeds, series, round: r0, r0, champ: null, gid: 0 };
  L.phase = 'PLAYOFFS'; L.day = (L.schedule[L.schedule.length - 1]?.day || 170) + 2;
  for (const c of ['E', 'W']) news(L, `${c === 'E' ? 'East' : 'West'} playoff field: ${seeds[c].map((t, i) => `${i + 1}. ${L.teams[t].abbr}`).join(', ')}`, 'playoffs');
  const inPO = [...seeds.E, ...seeds.W].includes(L.userTid);
  msg(L, 'League Office', inPO ? 'You made the playoffs!' : 'Season over', inPO ? 'Your team has qualified for the postseason. Good luck!' : 'Your team missed the playoffs. Time to look ahead to the lottery.');
}
const HOME7 = [1, 1, 0, 0, 1, 0, 1], HOME5 = [1, 1, 0, 0, 1];
export function seriesOver(s) { const need = Math.ceil(s.len / 2); return s.wh >= need || s.wl >= need; }
export function simPlayoffDay(L, opts = {}) {
  const P = L.playoffs; if (!P || P.champ != null) return null;
  const active = P.series.filter(s => s.round === P.round && !seriesOver(s));
  let userRes = null; const tids = new Set();
  for (const s of active) {
    const gnum = s.wh + s.wl; const hiHome = (s.len === 5 ? HOME5 : HOME7)[gnum];
    const g = { gid: `po${P.gid++}`, h: hiHome ? s.hi : s.lo, a: hiHome ? s.lo : s.hi, played: false };
    const isUser = g.h === L.userTid || g.a === L.userTid;
    const r = playGame(L, g, { playoff: true, pbp: isUser && opts.pbp });
    const hiWon = (g.h === s.hi) === (r.hs > r.as);
    if (hiWon) s.wh++; else s.wl++;
    s.games.push({ gid: g.gid, h: g.h, a: g.a, hs: r.hs, as: r.as });
    tids.add(s.hi); tids.add(s.lo);
    if (isUser) userRes = { g, r, s };
    if (seriesOver(s)) {
      const w = s.wh > s.wl ? s.hi : s.lo, l = w === s.hi ? s.lo : s.hi; s.winner = w;
      news(L, `${L.teams[w].city} ${L.teams[w].name} defeat ${L.teams[l].abbr} ${Math.max(s.wh, s.wl)}-${Math.min(s.wh, s.wl)}${s.round === 4 ? ' to win the championship!' : ''}`, 'playoffs');
    }
  }
  L.day++; tickInjuries(L, tids);
  if (P.series.filter(s => s.round === P.round).every(seriesOver)) advanceRound(L);
  L.rng = getSeed();
  return userRes;
}
function advanceRound(L) {
  const P = L.playoffs; const cur = P.series.filter(s => s.round === P.round);
  if (P.round === 4) { P.champ = cur[0].winner; P.runnerUp = cur[0].winner === cur[0].hi ? cur[0].lo : cur[0].hi; return; }
  const rec = standings(L); const pct = Object.fromEntries(rec.map(r => [r.tid, r.pct]));
  const next = [];
  if (P.round < 3) {
    for (const c of ['E', 'W']) {
      const cs = cur.filter(s => s.conf === c).sort((a, b) => a.slot - b.slot);
      for (let i = 0; i < cs.length; i += 2) {
        const a = cs[i], b = cs[i + 1];
        const sa = a.winner === a.hi ? a.hiSeed : a.loSeed, sb = b.winner === b.hi ? b.hiSeed : b.loSeed;
        const [hi, lo, hs, ls] = sa < sb ? [a.winner, b.winner, sa, sb] : [b.winner, a.winner, sb, sa];
        next.push({ id: `${c}${P.round + 1}-${i / 2}`, round: P.round + 1, conf: c, slot: i / 2, hi, lo, hiSeed: hs, loSeed: ls, wh: 0, wl: 0, games: [], len: seriesLen(L, P.round + 1) });
      }
    }
  } else {
    const [e, w] = [cur.find(s => s.conf === 'E').winner, cur.find(s => s.conf === 'W').winner];
    const [hi, lo] = pct[e] >= pct[w] ? [e, w] : [w, e];
    next.push({ id: 'F', round: 4, conf: 'F', slot: 0, hi, lo, hiSeed: 1, loSeed: 1, wh: 0, wl: 0, games: [], len: seriesLen(L, 4) });
  }
  P.series.push(...next); P.round++;
}
export { PHASE_LABEL };
