// Read-only playoff board. Scores and player lines come only from series already
// stored on the save and from box scores that were actually kept. Nothing here
// plays a game, writes a series, or fills a gap from real NBA history.
import { confSeeds, standings, seasonDone, playoffShape } from './league.js';
import { seriesLen } from './franchise.js';

export const PLAYOFF_SCOPE = 'Series scores and game results are the ones stored on this save. Player lines come only from box scores that were saved with those games. A missing box is left blank. Nothing is filled in from real NBA history.';
const ROUND = { 1: 'First Round', 2: 'Conference Semifinals', 3: 'Conference Finals', 4: 'Finals' };
const CONF = { E: 'East', W: 'West', F: 'Finals' };

const needOf = (s) => Math.ceil((+s.len || 7) / 2);
export function seriesStatus(s) {
  if (!s || s.pending) return 'not-started';
  if (s.winner != null || s.wh >= needOf(s) || s.wl >= needOf(s)) return 'complete';
  if (!(s.games || []).length && !s.wh && !s.wl) return 'not-started';
  return 'in-progress';
}

function teamOf(L, tid) {
  const t = L?.teams?.[tid];
  if (!t) return { tid, abbr: '—', name: 'Unknown team', city: '' };
  return { tid, abbr: t.abbr, name: t.name, city: t.city };
}
function playerName(L, pid) {
  const p = (L?.players || []).find(x => x.pid === pid);
  return p?.name || null;
}

// One pass over the stored game list. A game is counted once. The series win
// totals (wh/wl) are what the save says; the game list is checked against them
// and is not used to overwrite them.
export function seriesScore(s) {
  const games = s.games || [];
  let hi = 0, lo = 0, blank = 0;
  for (const g of games) {
    if (g.hs == null || g.as == null || g.hs === g.as) { blank++; continue; }
    const w = g.hs > g.as ? g.h : g.a;
    if (w === s.hi) hi++;
    else if (w === s.lo) lo++;
    else blank++;
  }
  const agree = blank === 0 && games.length === (s.wh || 0) + (s.wl || 0) && hi === s.wh && lo === s.wl;
  return { wh: s.wh || 0, wl: s.wl || 0, fromGamesHi: hi, fromGamesLo: lo, games: games.length, blank, agree, need: needOf(s) };
}

function tally(s, store, L) {
  const games = s.games || [];
  const played = games.length;
  const acc = new Map();
  let withBox = 0;
  for (const g of games) {
    const G = store?.[g.gid];
    if (!G?.box) continue;
    withBox++;
    for (const tid of Object.keys(G.box)) for (const pid of Object.keys(G.box[tid])) {
      const line = G.box[tid][pid];
      if (!line || !(line.min > 0)) continue;
      const id = +pid;
      const row = acc.get(id) || { pid: id, tid: +tid, name: playerName(L, id), gp: 0, pts: 0, reb: 0, ast: 0 };
      row.gp++;
      row.pts += line.pts || 0;
      row.reb += (line.orb || 0) + (line.drb || 0);
      row.ast += line.ast || 0;
      acc.set(id, row);
    }
  }
  const players = [...acc.values()].sort((a, b) => b.pts - a.pts || b.reb - a.reb || b.ast - a.ast || a.pid - b.pid);
  const byTeam = {};
  for (const p of players) (byTeam[p.tid] ||= []).push(p);
  for (const k of Object.keys(byTeam)) byTeam[k] = byTeam[k].slice(0, 3);
  const note = played === 0 ? 'No games have been played in this series.'
    : withBox === 0 ? `No box score was saved for ${played} game${played === 1 ? '' : 's'}. The scores below are the recorded results. Performers are not listed.`
    : withBox === played ? `Box scores on file for all ${played} game${played === 1 ? '' : 's'}.`
    : `Box scores on file for ${withBox} of ${played} games. Players are totaled from those games only.`;
  return { played, withBox, note, byTeam };
}

function performersOf(s, store, L) {
  const live = tally(s, store, L);
  if (live.withBox) return live;
  if (s.recap && typeof s.recap.withBox === 'number') return s.recap;
  return live;
}

function gameRows(L, s, store) {
  return (s.games || []).map((g, i) => {
    const home = teamOf(L, g.h), away = teamOf(L, g.a);
    const scored = g.hs != null && g.as != null;
    return {
      n: i + 1, gid: g.gid ?? null,
      hasBox: !!(g.gid != null && store?.[g.gid]?.box),
      text: scored ? `${away.abbr} ${g.as} @ ${home.abbr} ${g.hs}` : 'Score was not stored.',
    };
  });
}

function side(L, tid, seed, wins, winner) {
  const t = teamOf(L, tid);
  return { ...t, seed: seed ?? null, wins: wins || 0, win: winner === tid, out: winner != null && winner !== tid };
}

function scoreNote(L, s, score, status) {
  const len = `best of ${s.len || score.need * 2 - 1}`;
  if (status === 'not-started') return `Not started · ${len}`;
  const lead = score.wh === score.wl ? null : score.wh > score.wl ? s.hi : s.lo;
  const mark = `${Math.max(score.wh, score.wl)}-${Math.min(score.wh, score.wl)}`;
  const who = lead == null ? 'Tied' : teamOf(L, lead).city;
  if (status === 'complete') {
    const winner = s.winner != null ? s.winner : lead;
    const wWins = winner === s.hi ? score.wh : winner === s.lo ? score.wl : Math.max(score.wh, score.wl);
    const lWins = winner === s.hi ? score.wl : winner === s.lo ? score.wh : Math.min(score.wh, score.wl);
    const name = winner != null ? `${teamOf(L, winner).city} ${teamOf(L, winner).name}` : 'Winner';
    return `${name} wins ${wWins}-${lWins} · ${len}`;
  }
  return lead == null ? `Tied ${score.wh}-${score.wl} · ${len}` : `${who} leads ${mark} · ${len}`;
}

function cardFrom(L, s, store) {
  const score = seriesScore(s);
  const status = seriesStatus(s);
  const perf = performersOf(s, store, L);
  let clincher = null;
  if (status === 'complete' && score.agree && (s.games || []).length) {
    let hi = 0, lo = 0;
    for (const g of s.games) {
      if (g.hs > g.as) { if (g.h === s.hi) hi++; else lo++; }
      else if (g.as > g.hs) { if (g.a === s.hi) hi++; else lo++; }
    }
    const last = s.games[s.games.length - 1];
    if ((hi >= score.need || lo >= score.need) && last.hs != null) {
      clincher = `The series ended with ${teamOf(L, last.a).abbr} ${last.as} @ ${teamOf(L, last.h).abbr} ${last.hs}.`;
    }
  }
  const winnerAgrees = s.winner == null || (s.winner === s.hi && score.wh > score.wl) || (s.winner === s.lo && score.wl > score.wh);
  const disagree = ((!score.agree && (s.games || []).length > 0) || !winnerAgrees)
    ? 'The stored series result and the stored game list are not the same. Both are shown as stored.'
    : null;
  return {
    id: s.id, pending: false, round: s.round, conf: s.conf, slot: s.slot, len: s.len, status,
    winnerTid: s.winner ?? null,
    hi: side(L, s.hi, s.hiSeed, s.wh, s.winner ?? null),
    lo: side(L, s.lo, s.loSeed, s.wl, s.winner ?? null),
    scoreNote: scoreNote(L, s, score, status),
    disagree,
    clincher, games: gameRows(L, s, store),
    coverage: perf.note, performers: perf.byTeam || {},
    advances: status === 'complete' && s.round < 4 ? `Winner advances to the ${ROUND[s.round + 1] || 'next round'}.` : status === 'complete' && s.round === 4 ? 'This was the Finals.' : null,
  };
}

function pendingCard(id, round, conf, slot, hiLabel, loLabel, len) {
  return {
    id, pending: true, round, conf, slot, len, status: 'not-started', winnerTid: null,
    hi: { pending: true, label: hiLabel, wins: 0 },
    lo: { pending: true, label: loLabel, wins: 0 },
    scoreNote: len ? `Not started · best of ${len}` : 'Not started. The series length is set when the series is created.',
    disagree: null, clincher: null, games: [],
    coverage: 'This series has not started. The opponent is not known yet, and there is no score.',
    performers: {}, advances: null,
  };
}

function winnerLabel(card) {
  if (!card) return 'Winner to be decided';
  if (card.pending) return 'Winner to be decided';
  if (card.status === 'complete' && card.winnerTid != null) {
    const w = card.winnerTid === card.hi.tid ? card.hi : card.lo;
    return `${w.city} ${w.name}`.trim();
  }
  if (card.hi?.pending || card.lo?.pending) return 'Winner to be decided';
  return `Winner of (${card.hi.seed}) ${card.hi.abbr} vs (${card.lo.seed}) ${card.lo.abbr}`;
}

function fillRounds(L, series, r0, store, liveLen) {
  const have = new Map();
  for (const s of series) {
    if (!have.has(s.round)) have.set(s.round, []);
    have.get(s.round).push(s);
  }
  const rounds = [];
  let prev = null;
  for (let r = r0; r <= 3; r++) {
    const existing = (have.get(r) || []).slice().sort((a, b) => (a.conf < b.conf ? -1 : a.conf > b.conf ? 1 : 0) || a.slot - b.slot);
    let cards;
    if (existing.length) cards = existing.map(s => cardFrom(L, s, store));
    else if (prev) {
      cards = [];
      for (const conf of ['W', 'E']) {
        const src = prev.filter(c => c.conf === conf).sort((a, b) => a.slot - b.slot);
        for (let i = 0; i < src.length; i += 2) {
          const a = src[i], b = src[i + 1];
          if (!b) break;
          const len = liveLen ? seriesLen(L, r) : null;
          cards.push(pendingCard(`next-${conf}-${r}-${i / 2}`, r, conf, i / 2, winnerLabel(a), winnerLabel(b), len));
        }
      }
    } else cards = [];
    rounds.push({ round: r, name: ROUND[r] || `Round ${r}`, series: cards });
    prev = cards;
  }
  const fin = (have.get(4) || [])[0];
  let finals;
  if (fin) finals = cardFrom(L, fin, store);
  else {
    const last = prev || [];
    const east = last.find(c => c.conf === 'E');
    const west = last.find(c => c.conf === 'W');
    const len = liveLen ? seriesLen(L, 4) : null;
    finals = pendingCard('next-F-4-0', 4, 'F', 0, winnerLabel(west), winnerLabel(east), len);
  }
  const conferences = ['W', 'E'].map(conf => ({
    conf, name: CONF[conf],
    rounds: rounds.map(r => ({ round: r.round, name: r.name, series: r.series.filter(s => s.conf === conf) })).filter(r => r.series.length),
  })).filter(c => c.rounds.length);
  return { conferences, finals };
}

function boardFrom(L, pack, store, kind, season) {
  const series = pack.series || [];
  const r0 = pack.r0 || Math.min(...series.map(s => s.round));
  const built = fillRounds(L, series, r0, store, kind === 'live');
  const champTid = pack.champ ?? null;
  const champ = champTid != null ? teamOf(L, champTid) : null;
  return {
    kind, season: season ?? L?.season ?? null, note: PLAYOFF_SCOPE,
    champ, conferences: built.conferences, finals: built.finals,
    pastGap: (L?.history || []).some(h => h && h.champ != null && !h.bracket) ? 'Seasons finished before a bracket was stored are not shown.' : null,
  };
}

export function archiveBracket(L) {
  const P = L?.playoffs;
  if (!P?.series?.length) return null;
  const store = L.games || {};
  return {
    r0: P.r0 ?? Math.min(...P.series.map(s => s.round)),
    round: P.round ?? null,
    champ: P.champ ?? null,
    runnerUp: P.runnerUp ?? null,
    series: P.series.map(s => ({
      id: s.id, round: s.round, conf: s.conf, slot: s.slot,
      hi: s.hi, lo: s.lo, hiSeed: s.hiSeed, loSeed: s.loSeed,
      wh: s.wh || 0, wl: s.wl || 0, len: s.len, winner: s.winner ?? null,
      games: (s.games || []).map(g => ({ gid: g.gid, h: g.h, a: g.a, hs: g.hs, as: g.as })),
      recap: tally(s, store, L),
    })),
  };
}

function projected(L) {
  const shape = playoffShape(L);
  const conferences = ['W', 'E'].map(conf => {
    const name = CONF[conf];
    const ids = shape.seeds[conf] || [];
    const teams = ids.map((tid, i) => ({ seed: i + 1, ...teamOf(L, tid) }));
    const pairs = (shape.pairs || []).map(([a, b]) => ({
      hi: teams[a] || null, lo: teams[b] || null,
      len: seriesLen(L, 1),
    })).filter(p => p.hi && p.lo);
    return { conf, name, teams, pairs };
  });
  return {
    kind: 'projected', season: L.season, note: PLAYOFF_SCOPE,
    fieldNote: 'The regular season is over and the series have not been created. These are the current seeds. There are no scores.',
    conferences, finals: null, champ: null,
    pastGap: (L.history || []).some(h => h && h.champ != null && !h.bracket) ? 'Seasons finished before a bracket was stored are not shown.' : null,
  };
}

export function playoffBoard(L) {
  if (L?.playoffs?.series?.length) return boardFrom(L, L.playoffs, L.games || {}, 'live', L.season);
  const archived = [...(L?.history || [])].reverse().find(h => h?.bracket?.series?.length);
  if (archived) return boardFrom(L, archived.bracket, null, 'archive', archived.season);
  if (L && seasonDone(L) && L.phase === 'REGULAR') return projected(L);
  const past = (L?.history || []).some(h => h && (h.champ != null || h.season != null) && !h.bracket);
  return {
    kind: 'not-started', season: L?.season ?? null, conferences: [], finals: null, champ: null,
    note: past
      ? 'Playoffs have not started. Finished seasons in this save do not have a stored bracket, so those series are not shown.'
      : 'Playoffs have not started. No series or scores are stored yet.',
    pastGap: null,
  };
}

export { ROUND, CONF };
