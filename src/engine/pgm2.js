// PGM2-parity systems: World (college pool), Player of the Week, GM reputation + job market,
// achievements, trade block / trade center offers, draft-day offers, extensions, position changes, roles.
import { rand, shuffle, clamp } from './rng.js';
import { ATTRS, ovrFromAttrs, marketValue, dispRating, eligiblePos } from './players.js';
import { HOOKS, teamPlayers, getP, msg, msgBatch, news, logTx, standings, teamOvr, createDraftClass, payroll, cap, staffEffects } from './league.js';
import { gpReq } from './era.js';
import { ROSTER_MAX } from './constants.js';
import { deadlineDay } from './franchise.js';
import { moraleTick } from './morale.js';
import { askingAmount, moodToward, maxYears, hofScore, careerTotals, release, applyStart } from './offseason.js';
import { playerValue, pickValue, validateTrade, executeTrade, findOffers } from './trade.js';

const WORLD_YEARS = 3;
// ---------- World: future draft classes visible as a college pool ----------
export function ensureWorld(L) {
  for (let s = L.season + 1; s <= L.season + WORLD_YEARS; s++) createDraftClass(L, s);
}
export function worldClasses(L) {
  const out = [];
  for (let s = L.season; s <= L.season + WORLD_YEARS; s++) {
    const ps = L.players.filter(p => p.tid === -2 && p.draft?.year === s);
    const top = ps.map(p => p.pot).sort((a, b) => b - a).slice(0, 10);
    const q = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
    out.push({ year: s, n: ps.length, quality: Math.round(q), grade: q >= 80 ? 'A' : q >= 76 ? 'B' : q >= 72 ? 'C' : q >= 68 ? 'D' : 'E', players: ps });
  }
  return out;
}
export const ageNow = (L, p) => p.tid === -2 && p.draft?.year > L.season ? p.age - (p.draft.year - L.season) : p.age;

// ---------- Player roles (PGM2 shows 3 role ratings per position) ----------
const ROLES = {
  PG: [['Floor General', { pas: .45, han: .35, iq: .2 }], ['Scoring Guard', { out: .4, sco: .35, ins: .25 }], ['Lockdown', { pdef: .6, ath: .25, iq: .15 }]],
  SG: [['Sharpshooter', { out: .7, iq: .3 }], ['Slasher', { ins: .4, ath: .35, han: .25 }], ['3-and-D', { out: .5, pdef: .5 }]],
  SF: [['Wing Scorer', { sco: .4, out: .3, ins: .3 }], ['3-and-D', { out: .5, pdef: .5 }], ['Point Forward', { pas: .45, han: .3, iq: .25 }]],
  PF: [['Stretch Four', { out: .55, reb: .25, iq: .2 }], ['Banger', { ins: .35, reb: .35, idef: .3 }], ['Athletic Forward', { ath: .5, ins: .25, reb: .25 }]],
  C: [['Rim Protector', { idef: .6, reb: .4 }], ['Post Scorer', { ins: .6, sco: .4 }], ['Stretch Big', { out: .6, iq: .4 }]],
};
export function roleRatings(p, ratings = p.ratings) {
  return ROLES[p.pos].map(([name, w]) => [name, Math.round(Object.entries(w).reduce((s, [k, v]) => s + ratings[k] * v, 0))]);
}
export const bestRole = (p) => roleRatings(p).sort((a, b) => b[1] - a[1])[0][0];

// ---------- Position change with adaptability ----------
export function posPenalty(p) { return p.natPos && p.natPos !== p.pos && !eligiblePos(p).includes(p.pos) ? Math.round((100 - (p.adapt ?? 50)) / 12) : 0; }
export function applyPos(p) { const nat = p.natPos || p.pos; const base = eligiblePos(p).includes(p.pos) ? Math.max(ovrFromAttrs(p.ratings, p.pos), ovrFromAttrs(p.ratings, nat)) : ovrFromAttrs(p.ratings, p.pos); p.ovr = Math.max(25, Math.round(base) - posPenalty(p)); }
export function changePosition(L, pid, pos) {
  const p = getP(L, pid); if (!p || p.tid !== L.userTid) return { ok: false, error: 'Not your player' };
  if (!p.natPos) p.natPos = p.pos;
  if (p.adapt == null) p.adapt = clamp(Math.round(35 + p.ratings.iq * 0.35 + (rand() - 0.5) * 20), 20, 90);
  p.pos = pos; applyPos(p);
  const t = L.teams[L.userTid]; if (t.rotation) t.rotation = null;
  return { ok: true, ovr: p.ovr };
}

// ---------- Fantasy points (NBA standard-ish) ----------
export const fantasy = (s) => s.pts + 1.2 * (s.orb + s.drb) + 1.5 * s.ast + 3 * s.stl + 3 * s.blk - s.tov;

// ---------- Player of the Week (by conference) ----------
function snapWeek(L) { L.powSnap = {}; for (const p of L.players) if (p.tid >= 0) { const r = p.stats.reg; L.powSnap[p.pid] = [r.gp, fantasy(r)]; } L.powDay = L.day; }
function playerOfWeek(L) {
  const best = { E: null, W: null };
  for (const p of L.players) {
    if (p.tid < 0) continue; const r = p.stats.reg; const s0 = L.powSnap[p.pid] || [0, 0];
    const gp = r.gp - s0[0]; if (gp < 2) continue;
    const rec = standings(L)[p.tid]; const score = (fantasy(r) - s0[1]) / gp + rec.pct * 6;
    const c = L.teams[p.tid].conf; if (!best[c] || score > best[c].score) best[c] = { p, score, gp, line: r, s0 };
  }
  const week = Math.round(L.day / 7);
  for (const c of ['E', 'W']) {
    const b = best[c]; if (!b) continue;
    b.p.awards.push({ season: L.season, type: 'Player of the Week' });
    (L.pow ||= []).unshift({ season: L.season, week, conf: c, pid: b.p.pid, name: b.p.name, tid: b.p.tid });
    news(L, `⭐ ${c === 'E' ? 'East' : 'West'} Player of the Week: ${b.p.name} (${L.teams[b.p.tid].abbr})`, 'award', b.p.tid);
    if (b.p.tid === L.userTid) msgBatch(L, 'pow', 'League Office', 'Player of the Week', `Week ending day ${L.day}: ${b.p.name} (${c === 'E' ? 'East' : 'West'}).`, { pri: 'low', days: 200 });
  }
}

// ---------- GM reputation + job market ----------
export function repLabel(r) { return r >= 85 ? 'Legendary' : r >= 70 ? 'Elite' : r >= 55 ? 'Respected' : r >= 40 ? 'Established' : r >= 25 ? 'Unproven' : 'Poor'; }
function afterAwards(L) {
  const g = L.gm; g.reputation ??= 40;
  const rv = L.lastReview; if (!rv) return;
  const d = { A: 8, B: 4, C: 0, D: -4, F: -8 }[rv.grade] + (rv.champ ? 10 : 0) + rv.roundsWon * 2;
  const before = g.reputation; g.reputation = clamp(Math.round(g.reputation + d), 0, 100); rv.repDelta = g.reputation - before; rv.reputation = g.reputation;
  rv.awardWinners = L.players.filter(p => p.tid === L.userTid && p.awards.some(a => a.season === L.season && !['Champion', 'Player of the Week'].includes(a.type))).length;
  rv.legacy = g.legacy;
  L.jobMarket = jobMarket(L);
  checkAchievements(L);
}
export function jobMarket(L) {
  const rec = standings(L); const rep = L.gm.reputation ?? 40;
  // only recently underperforming teams are open; better reputations attract better franchises
  const under = L.teams.filter(t => t.tid !== L.userTid && !t.inactive).map(t => ({ tid: t.tid, pct: rec[t.tid].pct, o: teamOvr(L, t.tid) }))
    .filter(x => x.pct < 0.5 || (L.playoffs && ![...L.playoffs.seeds.E, ...L.playoffs.seeds.W].includes(x.tid)));
  under.sort((a, b) => b.o - a.o);
  const skip = Math.max(0, Math.round((60 - rep) / 8)); // weak rep → only the worst jobs
  const n = L.gm.fired ? 4 : clamp(1 + Math.floor(rep / 25), 1, 5);
  return under.slice(Math.min(skip, Math.max(0, under.length - n))).slice(0, n).map(x => x.tid);
}
export function changeTeam(L, tid) {
  if (!(L.jobMarket || []).includes(tid) && !L.gm.fired) return { ok: false, error: 'That team is not interested.' };
  const from = L.userTid; L.userTid = tid; L.gm.fired = false; L.gm.jobSecurity = 55; (L.gm.teams ||= [from]).push(tid);
  L.teams[from].autoRotation = true; L.teams[tid].autoRotation = true; L.jobMarket = [];
  msg(L, 'Owner', `Welcome to ${L.teams[tid].city}`, `Fresh start. Our goal will be set before next season.`);
  news(L, `${L.gm.name} leaves ${L.teams[from].abbr} to become GM of the ${L.teams[tid].city} ${L.teams[tid].name}.`, 'staff', tid);
  return { ok: true };
}

// ---------- Achievements ----------
const userAward = (L, type) => L.players.some(p => p.tid === L.userTid && p.awards.some(a => a.season === L.season && a.type === type));
export const ACHIEVEMENTS = [
  ['first_season', 'Rookie GM', 'Complete your first season.', L => L.gm.seasonsRun >= 1],
  ['winning', 'Above .500', 'Finish with a winning record.', L => L.lastReview.w > L.lastReview.l],
  ['w50', 'Fifty Club', 'Win 50 games in a season.', L => L.lastReview.w >= 50],
  ['w60', 'Juggernaut', 'Win 60 games in a season.', L => L.lastReview.w >= 60],
  ['w70', 'Seventy', 'Win 70 games in a season.', L => L.lastReview.w >= 70],
  ['playoffs', 'Postseason Bound', 'Make the playoffs.', L => L.lastReview.madePO],
  ['series', 'Advance', 'Win a playoff series.', L => L.lastReview.roundsWon >= 1],
  ['finals', 'Conference Champs', 'Reach the Finals.', L => L.lastReview.roundsWon >= 3],
  ['champ', 'Champions', 'Win the championship.', L => L.lastReview.champ],
  ['b2b', 'Back-to-Back', 'Win two titles in a row.', L => { const h = L.gm.history; return h.length >= 2 && h.at(-1).champ && h.at(-2).champ; }],
  ['three', 'Three-Peat', 'Win three titles in a row.', L => { const h = L.gm.history; return h.length >= 3 && h.slice(-3).every(x => x.champ); }],
  ['dynasty', 'Dynasty', 'Win 5 titles as GM.', L => L.gm.titles >= 5],
  ['last_first', 'Last to First', 'Go from last in your division to first the next season.', L => L.gm.history.length >= 2 && L.divRank?.prev === 'last' && L.divRank?.now === 1],
  ['tank', 'Tank Commander', 'Finish with the worst record in the league.', L => { const r = standings(L); return r.slice().sort((a, b) => a.pct - b.pct)[0].tid === L.userTid; }],
  ['underdog', 'Underdog', 'Win the title with a preseason team rating outside the top 7.', L => L.lastReview.champ && (L.expectation?.rank ?? 1) > 7],
  ['mvp', 'MVP Factory', 'Have the league MVP.', L => userAward(L, 'MVP')],
  ['dpoy', 'Lockdown', 'Have the Defensive Player of the Year.', L => userAward(L, 'Defensive Player of the Year')],
  ['roy', 'Rookie Sensation', 'Have the Rookie of the Year.', L => userAward(L, 'Rookie of the Year')],
  ['smoy', 'Bench Mob', 'Have the Sixth Man of the Year.', L => userAward(L, 'Sixth Man of the Year')],
  ['mip', 'Player Development', 'Have the Most Improved Player.', L => userAward(L, 'Most Improved Player')],
  ['fmvp', 'Finals Hero', 'Have the Finals MVP.', L => userAward(L, 'Finals MVP')],
  ['allnba', 'First Team', 'Have an All-NBA 1st Team player.', L => userAward(L, 'All-NBA 1st Team')],
  ['homegrown', 'Homegrown', 'Win MVP with a player you drafted.', L => L.players.some(p => p.tid === L.userTid && p.draft?.byUser && p.awards.some(a => a.season === L.season && a.type === 'MVP'))],
  ['steal', 'Steal of the Draft', 'A 2nd-rounder or undrafted player you signed reaches 80 OVR for you.', L => L.players.some(p => p.tid === L.userTid && (p.draft?.round === 2 || p.udfa) && p.ovr >= 80)],
  ['hof', 'Hall of Famer', 'A player who played for your franchise enters the Hall of Fame.', L => L.hof.some(h => (h.tids || []).some(t => (L.gm.teams || [L.userTid]).includes(t)))],
  ['s5', 'Survivor', 'Run a team for 5 seasons.', L => L.gm.seasonsRun >= 5],
  ['s10', 'Decade', 'Run a team for 10 seasons.', L => L.gm.seasonsRun >= 10],
  ['s20', 'Lifer', 'Run a team for 20 seasons.', L => L.gm.seasonsRun >= 20],
  ['journey', 'Journeyman', 'GM three different franchises.', L => new Set(L.gm.teams || [L.userTid]).size >= 3],
  ['legacy500', 'Legacy', 'Reach a legacy score of 500.', L => L.gm.legacy >= 500],
  ['legacy1000', 'Legend', 'Reach a legacy score of 1000.', L => L.gm.legacy >= 1000],
  ['rep85', 'Legendary Reputation', 'Reach a Legendary GM reputation.', L => (L.gm.reputation ?? 0) >= 85],
  ['trader', 'Wheeler Dealer', 'Complete 10 trades.', L => (L.gm.trades || 0) >= 10],
  ['owner', "Owner's Favorite", 'Max out your job security.', L => L.gm.jobSecurity >= 100],
  ['cap', 'Cap Wizard', 'Win the title while under the salary cap.', L => L.lastReview.champ && payroll(L, L.userTid) <= cap(L)],
  ['lottery', 'Lottery Luck', 'Jump to the #1 pick from outside the top-3 lottery odds.', L => !!L.lotteryJump],
  // --- added (PGM2 parity: player feats, playoff runs, roster building, front office) ---
  ['scoring', 'Scoring Champ', 'Have the league scoring leader (min. 50 games).', L => leader(L, s => s.pts / s.gp)?.tid === L.userTid],
  ['ppg30', 'Thirty Club', 'Have a player average 30+ points per game.', L => uLines(L).some(s => s.ppg >= 30)],
  ['apg10', 'Floor General', 'Have a player average 10+ assists per game.', L => uLines(L).some(s => s.apg >= 10)],
  ['rpg12', 'Glass Cleaner', 'Have a player average 12+ rebounds per game.', L => uLines(L).some(s => s.rpg >= 12)],
  ['allstars3', 'All-Star Weekend', 'Have three All-Stars in one season.', L => L.players.filter(p => p.tid === L.userTid && p.awards.some(a => a.season === L.season && a.type === 'All-Star')).length >= 3],
  ['ovr90', 'Generational', 'Have a 95+ OVR player on your roster.', L => teamPlayers(L, L.userTid).some(p => dispRating(p.ovr) >= 95)],
  ['big3', 'Big Three', 'Have three 90+ OVR players at once.', L => teamPlayers(L, L.userTid).filter(p => dispRating(p.ovr) >= 90).length >= 3],
  ['topseed', 'Top Seed', 'Finish as the #1 seed in your conference.', L => !!L.playoffs && L.playoffs.seeds[L.teams[L.userTid].conf][0] === L.userTid],
  ['sweep', 'Brooms Out', 'Sweep a playoff series.', L => userSeries(L).some(s => s.winner === L.userTid && Math.min(s.wh, s.wl) === 0)],
  ['upset', 'Giant Killer', 'Win a playoff series as the lower seed.', L => userSeries(L).some(s => s.winner === L.userTid && s.lo === L.userTid)],
  ['cinderella', 'Cinderella', 'Win the title as a 5th seed or lower.', L => L.lastReview.champ && (L.playoffs?.seeds[L.teams[L.userTid].conf].indexOf(L.userTid) ?? 0) >= 4],
  ['perfect', 'Perfect Postseason', 'Win the title losing 3 or fewer playoff games.', L => L.lastReview.champ && userSeries(L).reduce((n, s) => n + (s.hi === L.userTid ? s.wl : s.wh), 0) <= 3],
  ['rings3', 'Ring Collector', 'Win 3 titles as GM.', L => L.gm.titles >= 3],
  ['po5', 'Perennial Contender', 'Make the playoffs 5 seasons in a row.', L => streak(L, h => h.madePO) >= 5],
  ['po10', 'Model Franchise', 'Make the playoffs 10 seasons in a row.', L => streak(L, h => h.madePO) >= 10],
  ['w50x3', 'Consistency', 'Win 50+ games three seasons in a row.', L => streak(L, h => h.w >= 50) >= 3],
  ['turnaround', 'Turnaround', 'Improve by 20+ wins from the previous season.', L => { const h = L.gm.history; return h.length >= 2 && h.at(-1).tid === h.at(-2).tid && h.at(-1).w - h.at(-2).w >= 20; }],
  ['gradeA3', "Straight A's", 'Earn an A from the owner three seasons in a row.', L => streak(L, h => h.grade === 'A') >= 3],
  ['bigfa', 'Big Fish', 'Sign a free agent rated 87+ OVR.', L => !!L.gm.bigFA],
  ['spree', 'Shopping Spree', 'Sign 4 free agents in one offseason.', L => Object.values(L.gm.faBy || {}).some(n => n >= 4)],
  ['blockbuster', 'Blockbuster', 'Trade for a player rated 90+ OVR.', L => !!L.gm.blockbuster],
  ['busy', 'Phone Never Stops', 'Make 5 trades in one season.', L => Object.values(L.gm.tradesBy || {}).some(n => n >= 5)],
  ['first_pick', 'Number One', 'Make the #1 overall pick.', L => !!L.gm.draftedFirst],
  ['roy_drafted', 'Draft Day Winner', 'Win Rookie of the Year with a player you drafted.', L => L.players.some(p => p.tid === L.userTid && p.draft?.byUser && p.awards.some(a => a.season === L.season && a.type === 'Rookie of the Year'))],
  ['late_gem', 'Late Gem', 'A player you drafted after pick 20 reaches 75 OVR.', L => L.players.some(p => p.draft?.byUser && p.draft.pick > 20 && p.ovr >= 75 && !p.retired)],
  ['icon', 'Franchise Icon', 'A player spends 10 seasons with your team.', L => teamPlayers(L, L.userTid).some(p => p.career.filter(c => c.tid === L.userTid).length >= 10)],
  ['youth', 'Youth Movement', 'Make the playoffs with a top-8 rotation averaging 25 or younger.', L => L.lastReview.madePO && top8Age(L) <= 25],
  ['vets', 'Old School', 'Win the title with a top-8 rotation averaging 30 or older.', L => L.lastReview.champ && top8Age(L) >= 30],
];
const uLines = (L) => teamPlayers(L, L.userTid).filter(p => p.stats.reg.gp >= gpReq(L, 50)).map(p => { const s = p.stats.reg; return { ppg: s.pts / s.gp, apg: s.ast / s.gp, rpg: (s.orb + s.drb) / s.gp }; });
const leader = (L, f) => L.players.filter(p => p.tid >= 0 && p.stats.reg.gp >= gpReq(L, 50)).sort((a, b) => f(b.stats.reg) - f(a.stats.reg))[0];
const userSeries = (L) => (L.playoffs?.series || []).filter(s => s.winner != null && (s.hi === L.userTid || s.lo === L.userTid));
const streak = (L, f) => { let n = 0; for (const h of [...L.gm.history].reverse()) { if (f(h)) n++; else break; } return n; };
const top8Age = (L) => { const r = teamPlayers(L, L.userTid).sort((a, b) => b.ovr - a.ovr).slice(0, 8); return r.reduce((s, p) => s + p.age, 0) / Math.max(1, r.length); };
export function checkAchievements(L) {
  L.achievements ||= {};
  const got = [];
  for (const [id, name, , fn] of ACHIEVEMENTS) {
    if (L.achievements[id]) continue;
    let ok = false; try { ok = !!fn(L); } catch { ok = false; }
    if (ok) { L.achievements[id] = L.season; got.push(name); }
  }
  if (got.length) msgBatch(L, 'ach', 'Achievements', 'Achievements unlocked', got.map(n => `🏅 ${n}`).join('\n'), { pri: 'low', days: 400 }); if (false) msg(L, 'Achievements', `Achievement${got.length > 1 ? 's' : ''} unlocked`, got.map(n => `🏅 ${n}`).join('\n'));
  return got;
}
function divRank(L) {
  const rec = standings(L); const d = L.teams[L.userTid].div;
  const ts = rec.filter(r => L.teams[r.tid].div === d).sort((a, b) => b.pct - a.pct);
  const i = ts.findIndex(r => r.tid === L.userTid); return i === ts.length - 1 ? 'last' : i + 1;
}

// ---------- Trade block + Trade Center offers ----------
export function toggleBlock(L, pid) {
  L.tradeBlock ||= []; const i = L.tradeBlock.indexOf(pid);
  if (i >= 0) L.tradeBlock.splice(i, 1); else L.tradeBlock.push(pid);
  return i < 0;
}
export function refreshOffers(L, force = false) {
  L.tradeOffers ||= []; L.tradeBlock ||= []; L.offerId ||= 1;
  const now = L.phase === 'REGULAR' ? L.day : 0;
  L.tradeBlock = L.tradeBlock.filter(pid => getP(L, pid)?.tid === L.userTid);
  // expire after ~2 weeks, at the deadline, or when assets are gone
  L.tradeOffers = L.tradeOffers.filter(o => (L.phase !== 'REGULAR' || (now - o.day <= 14 && now <= deadlineDay(L))) && validateTrade(L, o.offer).ok && o.season === L.season);
  if (L.phase === 'REGULAR' && now > deadlineDay(L)) return;
  if (!force && L.settings.cpuOffers === false) return; // franchise setting: no CPU offers (Call Around still works)
  const fq = L.settings.cpuOfferFreq || 1;
  // unsolicited: CPU teams sometimes call about one of your better players (not on the block)
  if (!force && L.phase === 'REGULAR' && rand() < 0.18 * fq) {
    const mine = teamPlayers(L, L.userTid).filter(p => !L.tradeBlock.includes(p.pid) && !p.il).sort((a, b) => b.ovr - a.ovr).slice(0, 8);
    const p = mine[Math.floor(rand() * mine.length)];
    const o = p && findOffers(L, p.pid)[0];
    if (o && !L.tradeOffers.some(x => x.pid === p.pid && x.offer.tidB === o.tidB)) { L.tradeOffers.push({ id: L.offerId++, pid: p.pid, day: now, season: L.season, phase: L.phase, offer: o, unsolicited: true });
      msgBatch(L, 'tradeoffers', 'Trade Center', 'Trade offers received', `${L.teams[o.tidB].city} called about ${p.name}. Open the Trade Center to Accept, Decline or Counter.`, { days: 14 }); }
  }
  for (const pid of L.tradeBlock) {
    if (L.tradeOffers.filter(o => o.pid === pid).length >= 3) continue;
    if (!force && rand() > Math.min(0.95, 0.4 * fq)) continue;
    const offers = findOffers(L, pid).slice(0, 2);
    for (const o of offers) {
      if (L.tradeOffers.some(x => x.offer.tidB === o.tidB && x.pid === pid)) continue;
      L.tradeOffers.push({ id: L.offerId++, pid, day: now, season: L.season, phase: L.phase, offer: o });
      msgBatch(L, 'tradeoffers', 'Trade Center', 'Trade offers received', `${L.teams[o.tidB].city}: offer for ${getP(L, pid).name}. Open the Trade Center to Accept, Decline or Counter.`, { days: 14 }); // the Trade Center badge carries the count
    }
  }
}
// 2K-style instant offers: ask every CPU team now; offers land in the Trade Center list too
export function instantOffers(L, pid) {
  L.tradeOffers ||= []; L.offerId ||= 1; const now = L.phase === 'REGULAR' ? L.day : 0; const ids = [];
  for (const o of findOffers(L, pid, 40).sort((a, b) => b.value - a.value)) {
    let x = L.tradeOffers.find(y => y.pid === pid && y.offer.tidB === o.tidB);
    if (!x) { x = { id: L.offerId++, pid, day: now, season: L.season, phase: L.phase, offer: o }; L.tradeOffers.push(x); }
    ids.push(x.id);
  }
  return ids;
}
export function acceptOffer(L, id) {
  const o = (L.tradeOffers || []).find(x => x.id === id); if (!o) return { ok: false, error: 'Offer expired' };
  const v = validateTrade(L, o.offer); if (!v.ok) return v;
  const text = executeTrade(L, o.offer); L.tradeOffers = L.tradeOffers.filter(x => x.id !== id);
  return { ok: true, text };
}
export function declineOffer(L, id) { L.tradeOffers = (L.tradeOffers || []).filter(x => x.id !== id); }

// ---------- Draft day: AI offers when you're on the clock ----------
export function clockOffers(L) {
  const D = L.draft; if (!D) return [];
  const slot = D.order[D.idx]; if (!slot || slot.tid !== L.userTid) return [];
  const myPick = L.picks.find(k => k.id === slot.id); if (!myPick) return [];
  const want = pickValue(L, myPick); const out = [];
  const later = D.order.slice(D.idx + 1).filter(s => s.tid !== L.userTid);
  for (const s of shuffle(later.slice(0, 14))) {
    if (out.length >= 3 || out.some(o => o.tidB === s.tid)) continue;
    const theirs = L.picks.filter(k => k.tid === s.tid).map(k => ({ k, v: pickValue(L, k) }));
    const first = theirs.find(x => x.k.id === s.id); if (!first) continue;
    const pkg = [first.k.id]; let sum = first.v;
    for (const x of theirs.filter(x => x.k.id !== s.id).sort((a, b) => b.v - a.v)) { if (sum >= want * 1.02) break; if (sum + x.v <= want * 1.35) { pkg.push(x.k.id); sum += x.v; } }
    if (sum < want * 1.02) continue;
    const o = { tidA: L.userTid, tidB: s.tid, aPids: [], aPicks: [myPick.id], bPids: [], bPicks: pkg, value: sum };
    if (validateTrade(L, o).ok) out.push(o);
  }
  return out;
}

// ---------- Contract extension (allowed before the final year, PGM2 1.5.3) ----------
export function extensionAsk(L, p) { return Math.round(askingAmount(L, p, L.userTid, 'resign') * 1.04 / 10) * 10; }
export function extendContract(L, pid, amt, years) {
  const p = getP(L, pid); if (!p || p.tid !== L.userTid || !p.contract) return { ok: false, error: 'Not your player' };
  if (p.contract.rookie && p.contract.exp > L.season + 0 && L.season - p.contract.signed < 2) return { ok: false, error: 'Rookie deals can be extended in their final year.' };
  if (p.contract.ext) return { ok: false, error: 'Already extended.' };
  if (!['PRESEASON', 'REGULAR'].includes(L.phase)) return { ok: false, error: 'Extensions are negotiated in preseason or during the season.' };
  if (years < 1 || years > maxYears(L, true) - 1) return { ok: false, error: `Extensions are 1–${maxYears(L, true) - 1} extra years.` };
  if (moodToward(L, p, L.userTid) < 0.85) return { ok: false, error: `${p.name} is not interested in extending right now.` };
  const ask = extensionAsk(L, p);
  if (amt < ask * 0.97) { p.extTries = (p.extTries || 0) + 1; return { ok: false, error: `${p.name} wants about $${(ask / 1000).toFixed(2)}M/yr.` }; }
  p.contract.ext = { amt: Math.round(amt), exp: p.contract.exp + years };
  logTx(L, { type: 'sign', text: `${L.teams[L.userTid].abbr} extended ${p.name} (+${years}y, $${(amt / 1000).toFixed(2)}M/yr from ${p.contract.exp + 1})` }, [p.pid]);
  return { ok: true };
}
function applyExtensions(L) { // called before contracts expire at the draft→re-sign rollover
  for (const p of L.players) if (p.contract?.ext && p.contract.exp <= L.season) p.contract = { amt: p.contract.ext.amt, exp: p.contract.ext.exp, signed: L.season + 1 };
}

// ---------- HOF watch ----------
export function hofWatch(L, n = 20) {
  return L.players.filter(p => !p.retired && p.tid !== -2).map(p => ({ p, s: hofScore(p) })).sort((a, b) => b.s - a.s).slice(0, n);
}

// ---------- per-team season history ----------
function recordTeamHist(L) {
  L.teamHist ||= []; const rec = standings(L); const P = L.playoffs;
  for (const t of L.teams) if (!t.inactive) {
    const r = rec[t.tid]; let result = 'Missed playoffs';
    if (P) { const ss = P.series.filter(s => s.hi === t.tid || s.lo === t.tid); if (ss.length) { const lastS = ss[ss.length - 1];
      result = P.champ === t.tid ? 'Champions' : ['Lost 1st round', 'Lost conf. semis', 'Lost conf. finals', 'Lost Finals'][lastS.round - 1]; } }
    const best = teamPlayers(L, t.tid).sort((a, b) => b.ovr - a.ovr)[0];
    L.teamHist.push({ season: L.season, tid: t.tid, w: r.w, l: r.l, result, best: best ? `${best.name} (${dispRating(best.ovr)})` : '' });
  }
}
// ---------- user roster auto-cut (PGM2: over the limit at preseason → cut or let the game cut) ----------
export function autoCut(L, max = ROSTER_MAX) {
  let ps = teamPlayers(L, L.userTid); const out = [];
  while (ps.length > max) { const w = ps.sort((a, b) => (a.ovr + Math.max(0, a.pot - a.ovr) * 0.3 - (a.contract?.amt || 0) / 4000) - (b.ovr + Math.max(0, b.pot - b.ovr) * 0.3 - (b.contract?.amt || 0) / 4000))[0];
    release(L, w, true); out.push(w.name); ps = teamPlayers(L, L.userTid); }
  return out;
}

// ---------- hooks ----------
HOOKS.day = (L) => {
  if (L.phase !== 'REGULAR') return;
  if (L.powDay == null || L.powSnapSeason !== L.season) { snapWeek(L); L.powSnapSeason = L.season; return; }
  if (L.day - L.powDay >= 7) { playerOfWeek(L); snapWeek(L); refreshOffers(L); moraleTick(L); }
};
HOOKS.preResign = (L) => applyExtensions(L);
HOOKS.applyStart = applyStart;
// Real 1995-96 final records + playoff results, so franchise History isn't empty on day one.
const HIST_1996 = { CHI: [72, 10, 'Champions'], ORL: [60, 22, 'Lost conf. finals'], IND: [52, 30, 'Lost 1st round'], CLE: [47, 35, 'Lost 1st round'], NYK: [47, 35, 'Lost conf. semis'],
  ATL: [46, 36, 'Lost conf. semis'], DET: [46, 36, 'Lost 1st round'], MIA: [42, 40, 'Lost 1st round'], CHH: [41, 41], WAS: [39, 43], BOS: [33, 49], NJN: [30, 52], MIL: [25, 57], TOR: [21, 61], PHI: [18, 64],
  SEA: [64, 18, 'Lost Finals'], SAS: [59, 23, 'Lost conf. semis'], UTA: [55, 27, 'Lost conf. finals'], LAL: [53, 29, 'Lost 1st round'], HOU: [48, 34, 'Lost conf. semis'], POR: [44, 38, 'Lost 1st round'],
  PHX: [41, 41, 'Lost 1st round'], SAC: [39, 43, 'Lost 1st round'], GSW: [36, 46], DEN: [35, 47], LAC: [29, 53], DAL: [26, 56], MIN: [26, 56], VAN: [15, 67] };
export function seedTeamHist(L) {
  L.teamHist ||= []; if (L.histStart || L.teamHist.some(h => h.season === 1996)) return;
  for (const t of L.teams) if (!t.inactive) { const h = HIST_1996[t.abbr]; if (h) L.teamHist.push({ season: 1996, tid: t.tid, w: h[0], l: h[1], result: h[2] || 'Missed playoffs', best: '—', real: true }); }
}
HOOKS.newLeague = (L) => { ensureWorld(L); seedTeamHist(L); L.gm.reputation ??= 40; L.gm.teams = [L.userTid]; L.achievements = {}; L.tradeBlock = []; L.tradeOffers = []; };
HOOKS.phase = (L, from) => {
  if (L.phase === 'AWARDS') { L.divRank = { prev: L.divRank?.now, now: divRank(L) }; recordTeamHist(L); afterAwards(L); }
  if (L.phase === 'LOTTERY' && L.lottery?.result?.[0] === L.userTid && L.lottery.pre.indexOf(L.userTid) >= 3) L.lotteryJump = true;
  if (L.phase === 'PRESEASON') { ensureWorld(L); L.powDay = null; }
  if (L.phase === 'SUMMER') for (const p of L.players) if (p.natPos && p.natPos !== p.pos && p.tid >= 0) { p.adapt = clamp((p.adapt ?? 50) + Math.round((p.stats.reg.gp || 0) * 0.25), 0, 99); applyPos(p); }
  if (['RESIGN', 'PRESEASON', 'DRAFT'].includes(L.phase)) refreshOffers(L, true);
  if (L.phase === 'PRESEASON' || L.phase === 'LOTTERY') checkAchievements(L);
};
