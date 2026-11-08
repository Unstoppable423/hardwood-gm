import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playoffBoard, archiveBracket, seriesScore, PLAYOFF_SCOPE } from '../src/engine/bracket.js';
import { startPlayoffs } from '../src/engine/league.js';
import { seriesLen } from '../src/engine/franchise.js';

const teams = [
  { tid: 0, abbr: 'BOS', city: 'Boston', name: 'Celtics', conf: 'E', div: 'A', c1: '#007A33', c2: '#ffffff', inactive: false },
  { tid: 1, abbr: 'NYK', city: 'New York', name: 'Knicks', conf: 'E', div: 'A', c1: '#006BB6', c2: '#F58426', inactive: false },
  { tid: 2, abbr: 'LAL', city: 'Los Angeles', name: 'Lakers', conf: 'W', div: 'P', c1: '#552583', c2: '#FDB927', inactive: false },
  { tid: 3, abbr: 'POR', city: 'Portland', name: 'Trail Blazers', conf: 'W', div: 'P', c1: '#E03A3E', c2: '#000000', inactive: false },
];
function sched() {
  const schedule = [];
  for (let i = 0; i < 4; i++) {
    schedule.push({ gid: 'r' + i, h: 0, a: 1, played: true, hs: 100, as: 90, day: i + 1 });
    schedule.push({ gid: 'w' + i, h: 2, a: 3, played: true, hs: 110, as: 100, day: i + 1 });
  }
  return schedule;
}
function league(extra = {}) {
  return {
    season: extra.season ?? 1999, phase: extra.phase ?? 'PLAYOFFS', day: 20, userTid: 0,
    settings: { playoffTeams: 4, realHistory: true, r1Len: 'era', laterLen: 7, difficulty: 'Medium' },
    teams, players: extra.players || [{ pid: 10, name: 'Paul Pierce', tid: 0, pos: 'SF' }],
    schedule: extra.schedule ?? sched(), picks: [], games: extra.games || {},
    playoffs: extra.playoffs === undefined ? null : extra.playoffs,
    history: extra.history || [], news: [], inbox: [], msgId: 1, _played: 8,
  };
}
const series = (o) => ({ id: 'E3-0', round: 3, conf: 'E', slot: 0, hi: 0, lo: 1, hiSeed: 1, loSeed: 2, wh: 0, wl: 0, len: 5, games: [], winner: null, ...o });
const snap = (L) => JSON.stringify({
  players: L.players, playoffs: L.playoffs, games: L.games, schedule: L.schedule, picks: L.picks, history: L.history, phase: L.phase,
});

test('playoffs that have not started do not invent a bracket', () => {
  const L = league({ phase: 'REGULAR', schedule: [{ gid: 1, h: 0, a: 1, played: false, hs: 0, as: 0, day: 1 }], history: [{ season: 1998, champ: 0 }] });
  const b = playoffBoard(L);
  assert.equal(b.kind, 'not-started');
  assert.match(b.note, /have not started/);
  assert.match(b.note, /do not have a stored bracket/);
  assert.equal(b.finals, null);
  assert.equal(JSON.stringify(b).includes('100'), false);
});

test('a finished regular season shows seeds and no scores', () => {
  const L = league({ phase: 'REGULAR' });
  const before = snap(L);
  const b = playoffBoard(L);
  assert.equal(b.kind, 'projected');
  assert.match(b.fieldNote, /no scores/i);
  const east = b.conferences.find(c => c.conf === 'E');
  assert.equal(east.pairs[0].hi.abbr, 'BOS');
  assert.equal(east.pairs[0].lo.abbr, 'NYK');
  assert.equal(east.pairs[0].len, seriesLen(L, 1));
  assert.equal(snap(L), before);
});

test('the opening series uses the engine series length', () => {
  const early = league({ season: 1999 });
  startPlayoffs(early);
  assert.equal(early.playoffs.series[0].len, 5);
  assert.equal(early.playoffs.r0, 3);
  const later = league({ season: 2005 });
  startPlayoffs(later);
  assert.equal(later.playoffs.series[0].len, 7);
  const board = playoffBoard(early);
  const east = board.conferences.find(c => c.conf === 'E').rounds[0].series[0];
  assert.match(east.scoreNote, /Not started/);
  assert.match(east.scoreNote, /best of 5/);
  assert.match(board.finals.hi.label + board.finals.lo.label, /Winner of \(1\) BOS/);
});

test('an in-progress series keeps the recorded score and names the next opponent only when known', () => {
  const s = series({
    wh: 2, wl: 1,
    games: [
      { gid: 'g1', h: 0, a: 1, hs: 110, as: 99 },
      { gid: 'g2', h: 0, a: 1, hs: 90, as: 100 },
      { gid: 'g3', h: 1, a: 0, hs: 88, as: 102 },
    ],
  });
  const west = series({ id: 'W3-0', conf: 'W', hi: 2, lo: 3, hiSeed: 1, loSeed: 2, wh: 0, wl: 0 });
  const L = league({ playoffs: { seeds: { E: [0, 1], W: [2, 3] }, series: [s, west], round: 3, r0: 3, champ: null, gid: 3 } });
  L.schedule.push({ gid: 'not-a-playoff-game', h: 0, a: 1, played: true, hs: 140, as: 80, day: 9 });
  const before = snap(L);
  const b = playoffBoard(L);
  const card = b.conferences.find(c => c.conf === 'E').rounds[0].series[0];
  assert.equal(card.status, 'in-progress');
  assert.equal(card.hi.wins, 2);
  assert.equal(card.lo.wins, 1);
  assert.equal(card.games.length, 3);
  assert.equal(card.games[0].text, 'NYK 99 @ BOS 110');
  assert.ok(!card.games.some(g => g.text.includes('140')));
  assert.match(card.scoreNote, /Boston leads 2-1/);
  assert.match(b.finals.hi.label, /Winner of \(1\) LAL/);
  assert.match(b.finals.coverage, /has not started/);
  assert.equal(snap(L), before);
});

test('a winner advances and a finished series is not double-counted', () => {
  const games = [
    { gid: 'g1', h: 0, a: 1, hs: 110, as: 99 },
    { gid: 'g2', h: 0, a: 1, hs: 108, as: 101 },
    { gid: 'g3', h: 1, a: 0, hs: 90, as: 100 },
  ];
  const s = series({ wh: 3, wl: 0, winner: 0, games });
  const score = seriesScore(s);
  assert.equal(score.agree, true);
  assert.equal(score.fromGamesHi, 3);
  assert.equal(score.games, 3);
  const west = series({ id: 'W3-0', conf: 'W', hi: 2, lo: 3, winner: 2, wh: 3, wl: 1, games: [
    { gid: 'a', h: 2, a: 3, hs: 100, as: 90 }, { gid: 'b', h: 2, a: 3, hs: 100, as: 90 },
    { gid: 'c', h: 3, a: 2, hs: 100, as: 90 }, { gid: 'd', h: 2, a: 3, hs: 100, as: 90 },
  ] });
  const L = league({ playoffs: { series: [s, west], round: 3, r0: 3, champ: null } });
  const b = playoffBoard(L);
  const card = b.conferences.find(c => c.conf === 'E').rounds[0].series[0];
  assert.equal(card.status, 'complete');
  assert.match(card.scoreNote, /Boston Celtics wins 3-0/);
  assert.match(card.advances, /Finals/);
  assert.match(card.clincher, /BOS 100 @ NYK 90/);
  assert.equal(b.finals.pending, true);
  assert.match(b.finals.hi.label, /Los Angeles Lakers/);
  assert.match(b.finals.lo.label, /Boston Celtics/);
});

test('performers use only saved box scores and say when some games have none', () => {
  const games = [
    { gid: 'g1', h: 0, a: 1, hs: 110, as: 99 },
    { gid: 'g2', h: 1, a: 0, hs: 100, as: 90 },
  ];
  const s = series({ wh: 1, wl: 1, games });
  const L = league({
    playoffs: { series: [s, series({ id: 'W3-0', conf: 'W', hi: 2, lo: 3 })], round: 3, r0: 3, champ: null },
    games: { g1: { box: { 0: { 10: { min: 36, pts: 20, orb: 1, drb: 9, ast: 4 } } }, h: 0, a: 1, hs: 110, as: 99 } },
  });
  const card = playoffBoard(L).conferences.find(c => c.conf === 'E').rounds[0].series[0];
  assert.match(card.coverage, /1 of 2/);
  assert.equal(card.games[1].hasBox, false);
  assert.equal(card.performers[0][0].pts, 20);
  assert.equal(card.performers[0][0].reb, 10);
  assert.equal(card.performers[0][0].name, 'Paul Pierce');
  assert.equal(card.performers[1], undefined);
  const none = series({ id: 'W3-0', conf: 'W', hi: 2, lo: 3, wh: 1, wl: 0, games: [{ gid: 'z', h: 2, a: 3, hs: 100, as: 90 }] });
  const bare = playoffBoard(league({ playoffs: { series: [none], round: 3, r0: 3, champ: null } }));
  const west = bare.conferences.find(c => c.conf === 'W').rounds[0].series[0];
  assert.match(west.coverage, /No box score was saved/);
  assert.deepEqual(west.performers, {});
  assert.equal(west.games[0].text, 'POR 90 @ LAL 100');
});

test('a mismatched game list is shown and not corrected', () => {
  const s = series({ wh: 4, wl: 1, winner: 0, games: [{ gid: 'g1', h: 0, a: 1, hs: 110, as: 99 }] });
  const L = league({ playoffs: { series: [s], round: 3, r0: 3, champ: null } });
  const card = playoffBoard(L).conferences[0].rounds[0].series[0];
  assert.match(card.scoreNote, /wins 4-1/);
  assert.match(card.disagree, /not the same/);
  assert.equal(card.games.length, 1);
  assert.equal(card.clincher, null);
});

test('an archived bracket survives without box scores and old seasons stay blank', () => {
  const s = series({ wh: 3, wl: 0, winner: 0, games: [{ gid: 'g1', h: 0, a: 1, hs: 110, as: 99 }] });
  const live = league({
    playoffs: { series: [s], round: 3, r0: 3, champ: 0, runnerUp: 1 },
    games: { g1: { box: { 0: { 10: { min: 30, pts: 18, orb: 0, drb: 7, ast: 2 } } } } },
  });
  const before = JSON.stringify(live.playoffs);
  const archived = archiveBracket(live);
  assert.equal(JSON.stringify(live.playoffs), before);
  assert.equal(archived.series[0].recap.withBox, 1);
  assert.equal(archived.series[0].recap.byTeam[0][0].pts, 18);
  const saved = JSON.parse(JSON.stringify({ history: [{ season: 1999, champ: 0, bracket: archived }, { season: 1998, champ: 2 }] }));
  const later = league({ phase: 'REGULAR', playoffs: null, games: {}, history: saved.history, schedule: [{ gid: 1, h: 0, a: 1, played: false, day: 1 }] });
  const b = playoffBoard(later);
  assert.equal(b.kind, 'archive');
  assert.equal(b.season, 1999);
  const card = b.conferences.find(c => c.conf === 'E').rounds[0].series[0];
  assert.equal(card.games[0].hasBox, false);
  assert.equal(card.performers[0][0].pts, 18);
  assert.match(card.coverage, /all 1 game/);
  assert.match(b.pastGap, /not shown/);
  assert.match(PLAYOFF_SCOPE, /real NBA history/);
  assert.equal(readFileSync(new URL('../src/engine/bracket.js', import.meta.url), 'utf8').includes('morale'), false);
});
