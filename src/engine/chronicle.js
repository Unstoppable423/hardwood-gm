// Season storylines and the league archive. Both are read from what the save already recorded.
// Nothing here invents a score, a champion, or a stat line.
import { dispRating } from './players.js';
import { standings, confSeeds, getP, dateOf } from './league.js';

export const RACE_GP = 20;
export const BREAKOUT_GP = 15;
export const BREAKOUT_PRIOR_GP = 20;
export const BREAKOUT_JUMP = 5;
export const BIG_TRADE_OVR = 85;
export const RIVAL_GAMES = 2;
export const RIVAL_MARGIN = 5;

export const STORY_SCOPE = 'Storylines use this save only: the schedule, playoff series, player stat lines, and the transaction log. A claim appears only after the sample below. Nothing is filled in from real NBA history.';
export const ARCHIVE_SCOPE = 'Champions, awards, and season leaders are seasons this save has finished. Earlier NBA champions are not filled in.';
export const RECORDS_SCOPE = 'Single-game highs are the best line in games this save has simulated. Season records are per-game leaders from seasons this save has finished. They are not the NBA record book.';

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const gbOf = (lead, team) => ((lead.w - team.w) + (team.l - lead.l)) / 2;
const gbTxt = (g) => { const n = Math.round(g * 10) / 10; if (n === 0) return '0'; return Number.isInteger(n) ? String(n) : n.toFixed(1); };
const teamName = (L, tid) => L.teams?.[tid] ? `${L.teams[tid].city} ${L.teams[tid].name}` : null;

function meetings(L) {
  const map = new Map();
  const add = (a, b, hs, as, day, gid, kind) => {
    if (a == null || b == null || num(hs) == null || num(as) == null) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let row = map.get(key);
    if (!row) { row = { a: Math.min(a, b), b: Math.max(a, b), games: [] }; map.set(key, row); }
    if (gid != null && row.games.some(g => g.gid === gid)) return;
    const home = a, away = b;
    row.games.push({ home, away, hs, as, day: day ?? null, gid: gid ?? null, kind, margin: Math.abs(hs - as) });
  };
  for (const g of L.schedule || []) if (g.played) add(g.h, g.a, g.hs, g.as, g.day, g.gid, 'regular');
  for (const s of L.playoffs?.series || []) for (const g of s.games || []) add(g.h, g.a, g.hs, g.as, null, g.gid, 'playoff');
  return [...map.values()];
}

function rivalries(L) {
  const out = [];
  for (const row of meetings(L)) {
    if (row.games.length < RIVAL_GAMES) continue;
    const wins = { [row.a]: 0, [row.b]: 0 };
    for (const g of row.games) {
      const hw = g.hs > g.as; const winner = hw ? g.home : g.away;
      if (wins[winner] != null) wins[winner]++;
    }
    const close = row.games.some(g => g.margin <= RIVAL_MARGIN);
    const split = wins[row.a] > 0 && wins[row.b] > 0;
    const playoff = row.games.filter(g => g.kind === 'playoff').length >= RIVAL_GAMES;
    if (!close && !split && !playoff) continue;
    const na = teamName(L, row.a), nb = teamName(L, row.b);
    if (!na || !nb) continue;
    const scores = row.games.map(g => {
      const when = g.day != null ? dateOf(L, g.day) + ' ' : '';
      const hn = L.teams[g.home]?.abbr || 'Home', an = L.teams[g.away]?.abbr || 'Away';
      return `${when}${an} ${g.as} @ ${hn} ${g.hs}`;
    }).join('; ');
    const why = playoff ? 'They have met in the playoffs at least twice.' : close ? `At least one game was decided by ${RIVAL_MARGIN} points or fewer.` : 'Each team has won at least once.';
    out.push({
      a: row.a, b: row.b, games: row.games.length, winsA: wins[row.a], winsB: wins[row.b], close, split, playoff,
      text: `${na} and ${nb} have played ${row.games.length} times in this save (series ${L.teams[row.a].abbr} ${wins[row.a]}–${L.teams[row.b].abbr} ${wins[row.b]}). ${why} Scores: ${scores}.`,
    });
  }
  out.sort((a, b) => (b.playoff - a.playoff) || (b.close - a.close) || (b.games - a.games));
  const mine = out.filter(r => r.a === L.userTid || r.b === L.userTid);
  const rest = out.filter(r => r.a !== L.userTid && r.b !== L.userTid);
  return [...mine, ...rest].slice(0, 4);
}

function safeStandings(L) {
  if (!Array.isArray(L?.schedule) || !Array.isArray(L?.teams)) return [];
  try { return standings(L); } catch { return []; }
}
function races(L) {
  const rec = safeStandings(L);
  const most = rec.reduce((m, r) => Math.max(m, r.gp || 0), 0);
  const perConf = Math.max(1, Math.round((L.settings?.playoffTeams || 16) / 2));
  const leftOf = (tid) => Array.isArray(L.schedule) ? L.schedule.filter(g => !g.played && (g.h === tid || g.a === tid)).length : null;
  if (most < RACE_GP) {
    return { ready: false, most, perConf, rows: [], note: `Playoff races wait for ${RACE_GP} games. The most any team has played is ${most}.` };
  }
  const rows = [];
  for (const conf of ['E', 'W']) {
    let seeds = [];
    try { seeds = confSeeds(L, conf, rec); } catch { seeds = rec.filter(r => L.teams[r.tid]?.conf === conf); }
    if (!seeds.length) continue;
    const cutIdx = Math.min(perConf, seeds.length) - 1;
    const cut = seeds[cutIdx];
    const from = Math.max(0, cutIdx - 2), to = Math.min(seeds.length, cutIdx + 3);
    seeds.slice(from, to).forEach((r, i) => {
      const seed = from + i + 1;
      const gb = gbOf(cut, r);
      const left = leftOf(r.tid);
      const name = teamName(L, r.tid);
      if (!name) return;
      const spot = gb === 0 ? 'even with the last playoff spot' : gb > 0 ? `${gbTxt(gb)} games behind the last playoff spot` : `${gbTxt(-gb)} games ahead of the last playoff spot`;
      rows.push({
        conf, tid: r.tid, seed, w: r.w, l: r.l, gb, in: seed <= Math.min(perConf, seeds.length), left, cut: seed === cutIdx + 1,
        text: `${name} are ${r.w}-${r.l} (${conf === 'E' ? 'East' : 'West'} ${seed}). ${spot}. ${left == null ? 'Games left are not on the schedule.' : `${left} regular-season game${left === 1 ? '' : 's'} left.`}`,
      });
    });
  }
  return { ready: true, most, perConf, rows, note: `The last playoff spot is seed ${perConf} in each conference. Games back are against that team, from the current win-loss record.` };
}

function breakouts(L) {
  const out = [];
  for (const p of L.players || []) {
    const s = p.stats?.reg;
    const gp = num(s?.gp);
    if (!s || gp == null || gp < BREAKOUT_GP || num(s.pts) == null) continue;
    const rows = (p.career || []).filter(c => c && num(c.gp) != null && c.gp >= BREAKOUT_PRIOR_GP);
    const prev = rows[rows.length - 1];
    if (!prev) continue;
    const prevPpg = num(prev.ppg) != null ? prev.ppg : (num(prev.pts) != null ? prev.pts / prev.gp : null);
    if (prevPpg == null) continue;
    const ppg = s.pts / gp;
    const jump = ppg - prevPpg;
    if (jump < BREAKOUT_JUMP) continue;
    const when = prev.season ? `${prev.season - 1}-${String(prev.season).slice(2)}` : 'a prior season on file';
    out.push({
      pid: p.pid, name: p.name, tid: p.tid, gp, ppg: Math.round(ppg * 10) / 10, prevPpg: Math.round(prevPpg * 10) / 10, prevGp: prev.gp, prevSeason: prev.season ?? null, jump: Math.round(jump * 10) / 10,
      text: `${p.name} is at ${(Math.round(ppg * 10) / 10).toFixed(1)} points a game over ${gp} games. In ${when} (${prev.gp} GP) he averaged ${(Math.round(prevPpg * 10) / 10).toFixed(1)}. That is +${(Math.round(jump * 10) / 10).toFixed(1)}, which clears the ${BREAKOUT_JUMP}-point bar.`,
    });
  }
  out.sort((a, b) => b.jump - a.jump);
  return out.slice(0, 3);
}

function bigTrades(L) {
  const unlabeled = (L.transactions || []).filter(t => t && t.type === 'trade' && t.season === L.season && !(t.pids || []).length).length;
  const out = [];
  for (const t of L.transactions || []) {
    if (!t || t.type !== 'trade' || t.season !== L.season) continue;
    const players = (t.pids || []).map(id => getP(L, id)).filter(Boolean);
    const stars = players.filter(p => dispRating(p.ovr) >= BIG_TRADE_OVR);
    if (!stars.length) continue;
    const rec = safeStandings(L);
    const bits = [...new Set(players.map(p => p.tid).filter(tid => tid >= 0))].map(tid => {
      const r = rec.find(x => x.tid === tid);
      const name = L.teams?.[tid]?.abbr;
      return name && r ? `${name} ${r.w}-${r.l} today` : null;
    }).filter(Boolean);
    out.push({
      text: t.text, stars: stars.map(p => ({ pid: p.pid, name: p.name, ovr: dispRating(p.ovr) })),
      note: `${stars.map(p => `${p.name} is ${dispRating(p.ovr)} overall now`).join('. ')}. ${bits.length ? bits.join(', ') + '. Records are as of today, not the day of the deal.' : 'Team records were not available.'}`,
    });
    if (out.length >= 3) break;
  }
  return { rows: out, unlabeled };
}

export function seasonStorylines(L) {
  const race = races(L || {});
  const riv = L ? rivalries(L) : [];
  const brk = L ? breakouts(L) : [];
  const tr = L ? bigTrades(L) : { rows: [], unlabeled: 0 };
  const gaps = {
    races: race.ready ? '' : race.note,
    rivalries: riv.length ? '' : `No rivalry yet. Two teams need ${RIVAL_GAMES} played games in this save, and either a game decided by ${RIVAL_MARGIN} or fewer, a split series, or two playoff games.`,
    breakouts: brk.length ? '' : `No breakout yet. That needs ${BREAKOUT_GP} games this season and a prior season of ${BREAKOUT_PRIOR_GP}+ games, with scoring up at least ${BREAKOUT_JUMP} points a game.`,
    trades: tr.rows.length ? '' : `No big trade on the log this season. A big trade names a player who is ${BIG_TRADE_OVR}+ overall.${tr.unlabeled ? ` ${tr.unlabeled} trade${tr.unlabeled === 1 ? '' : 's'} had no player id, so ${tr.unlabeled === 1 ? 'it was' : 'they were'} not graded.` : ''}`,
  };
  const items = [];
  if (race.ready && race.rows.length) items.push({ kind: 'race', title: 'Playoff race', text: race.rows.find(r => r.tid === L.userTid)?.text || race.rows[0].text });
  else items.push({ kind: 'race', title: 'Playoff race', text: gaps.races });
  if (riv[0]) items.push({ kind: 'rivalry', title: 'Meetings', text: riv[0].text });
  if (brk[0]) items.push({ kind: 'breakout', title: 'Breakout', text: brk[0].text });
  if (tr.rows[0]) items.push({ kind: 'trade', title: 'Big trade', text: `${tr.rows[0].text} ${tr.rows[0].note}` });
  return { scope: STORY_SCOPE, race, rivalries: riv, breakouts: brk, trades: tr.rows, unlabeledTrades: tr.unlabeled, gaps, items };
}

export function leagueArchive(L) {
  const seasons = (L?.history || []).map(h => ({
    season: h.season ?? null,
    champ: h.champ ?? null,
    champName: h.champ != null ? (L.teams?.[h.champ]?.name || null) : null,
    runnerUp: h.runnerUp ?? null,
    runnerName: h.runnerUp != null ? (L.teams?.[h.runnerUp]?.name || null) : null,
    awards: h.awards || null,
    leaders: h.leaders || null,
    missingAwards: !h.awards,
  }));
  const realPrior = (L?.teamHist || []).filter(h => h && h.real).length;
  let priorNote = 'No pre-save champion list is stored.';
  if (realPrior) priorNote = `${realPrior} teams carry a real 1995-96 win-loss line on the team page. That season is not listed here as a champion of this save.`;
  else if (L?.histStart) priorNote = 'This save started before 1996-97. No 1995-96 champion list was attached.';
  return {
    scope: ARCHIVE_SCOPE,
    recordsScope: RECORDS_SCOPE,
    priorNote,
    seasons,
    gameRecords: L?.records?.game || {},
    seasonRecords: L?.records?.season || {},
  };
}
