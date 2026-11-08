import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seasonStorylines, leagueArchive, RACE_GP, BREAKOUT_GP, BREAKOUT_JUMP, BIG_TRADE_OVR } from '../src/engine/chronicle.js';
import { makeCounter, fileCounter } from '../src/engine/frontoffice.js';
import { evaluateTrade, validateTrade } from '../src/engine/trade.js';
import { refreshOffers, acceptOffer } from '../src/engine/pgm2.js';
import { newLeague } from '../src/engine/league.js';
import { dispRating } from '../src/engine/players.js';

let seq = 1;
const R = (o = 60) => ({ ins: o, out: o, pas: o, han: o, reb: o, idef: o, pdef: o, ath: o, iq: o });
function P(o) {
  return { pid: o.pid ?? seq++, name: o.name, age: o.age ?? 27, pos: o.pos || 'SG', h: 198, w: 95, tid: o.tid ?? 0, ovr: o.ovr ?? 60, pot: o.pot ?? o.ovr ?? 60, ratings: R(o.ovr ?? 60), contract: o.contract === undefined ? { amt: 3000, exp: 2000 } : o.contract, il: false, stats: o.stats, career: o.career || [] };
}
function teams(n) {
  return Array.from({ length: n }, (_, i) => ({ tid: i, abbr: 'T' + i, city: 'City' + i, name: 'Name' + i, conf: i % 2 ? 'W' : 'E', div: 'D', inactive: false }));
}
function base(players, extra = {}) {
  const n = extra.n ?? Math.max(2, ...players.map(p => p.tid)) + 1;
  return { season: extra.season ?? 1998, phase: extra.phase ?? 'REGULAR', day: extra.day ?? 40, userTid: extra.userTid ?? 0, settings: { difficulty: 'Medium', capMode: 'soft', playoffTeams: extra.playoffTeams ?? 16 }, teams: extra.teams || teams(n), players, picks: extra.picks || [], schedule: extra.schedule ?? [], deadMoney: [], transactions: extra.transactions || [], news: [], playoffs: extra.playoffs || null, history: extra.history || [], teamHist: extra.teamHist || [], records: extra.records || { game: {}, season: {} }, tradeOffers: extra.tradeOffers || [], offerId: 1, inbox: [], msgId: 1, gm: { archetype: 'Scout' }, tradeDeadline: 120 };
}
const snap = (L) => JSON.stringify({ tids: L.players.map(p => [p.pid, p.tid]), picks: L.picks.map(k => [k.id, k.tid]), offers: (L.tradeOffers || []).length });

test('no games means no rivalry and no race', () => {
  const L = base([P({ name: 'A', tid: 0, pos: 'PG' }), P({ name: 'B', tid: 1, pos: 'PG' })]);
  const s = seasonStorylines(L);
  assert.equal(s.rivalries.length, 0);
  assert.match(s.gaps.rivalries, /2 played games/);
  assert.equal(s.race.ready, false);
  assert.match(s.race.note, new RegExp(String(RACE_GP)));
  assert.doesNotMatch(JSON.stringify(s.rivalries), /rivalry|classic/i);
});

test('two close games become a meeting with the actual scores', () => {
  const schedule = [
    { gid: 1, day: 10, h: 0, a: 1, played: true, hs: 100, as: 98 },
    { gid: 2, day: 20, h: 1, a: 0, played: true, hs: 90, as: 88 },
    { gid: 3, day: 30, h: 0, a: 1, played: false, hs: 0, as: 0 },
  ];
  const L = base([P({ tid: 0, name: 'A' }), P({ tid: 1, name: 'B' })], { schedule });
  const s = seasonStorylines(L);
  assert.equal(s.rivalries.length, 1);
  assert.equal(s.rivalries[0].games, 2);
  assert.match(s.rivalries[0].text, /100/);
  assert.match(s.rivalries[0].text, /98/);
  assert.match(s.rivalries[0].text, /90/);
  assert.doesNotMatch(s.rivalries[0].text, /unplayed|0 @/);
});

test('a blowout sweep is not called a rivalry', () => {
  const schedule = [
    { gid: 1, day: 10, h: 0, a: 1, played: true, hs: 120, as: 90 },
    { gid: 2, day: 20, h: 0, a: 1, played: true, hs: 130, as: 95 },
  ];
  const s = seasonStorylines(base([P({ tid: 0, name: 'A' }), P({ tid: 1, name: 'B' })], { schedule }));
  assert.equal(s.rivalries.length, 0);
});

test('playoff race uses the record and waits for a sample', () => {
  const players = [];
  for (let t = 0; t < 4; t++) players.push(P({ tid: t, name: 'P' + t, ovr: 70 }));
  const schedule = [];
  for (let g = 0; g < 20; g++) {
    schedule.push({ gid: g, day: g + 1, h: 0, a: 1, played: true, hs: 100, as: 90 });
    schedule.push({ gid: 100 + g, day: g + 1, h: 2, a: 3, played: true, hs: 100, as: 98 });
  }
  const early = seasonStorylines(base(players, { schedule: schedule.slice(0, 8), playoffTeams: 2, n: 4 }));
  assert.equal(early.race.ready, false);
  const L = base(players, { schedule, playoffTeams: 2, n: 4 });
  const s = seasonStorylines(L);
  assert.equal(s.race.ready, true);
  const mine = s.race.rows.find(r => r.tid === 0);
  assert.ok(mine);
  assert.equal(mine.w, 20);
  assert.equal(mine.l, 0);
  assert.equal(mine.left, 0);
  assert.match(mine.text, /20-0/);
});

test('breakouts need 15 games and a real prior season', () => {
  const short = P({ name: 'Short', tid: 0, stats: { reg: { gp: 10, pts: 200 } }, career: [{ season: 1997, gp: 60, pts: 600, ppg: 10 }] });
  const noPrior = P({ name: 'Rook', tid: 0, stats: { reg: { gp: 20, pts: 400 } }, career: [] });
  const thinPrior = P({ name: 'Cup', tid: 0, stats: { reg: { gp: 20, pts: 400 } }, career: [{ season: 1997, gp: 8, pts: 40, ppg: 5 }] });
  const real = P({ name: 'Leap', tid: 0, stats: { reg: { gp: BREAKOUT_GP, pts: BREAKOUT_GP * 20 } }, career: [{ season: 1997, gp: 50, pts: 500, ppg: 10 }] });
  const s = seasonStorylines(base([short, noPrior, thinPrior, real]));
  assert.deepEqual(s.breakouts.map(b => b.name), ['Leap']);
  assert.ok(s.breakouts[0].jump >= BREAKOUT_JUMP);
  assert.match(s.breakouts[0].text, /Leap/);
  assert.match(s.breakouts[0].text, /1996-97/);
  assert.equal(s.breakouts[0].gp, BREAKOUT_GP);
});

test('a big trade is quoted from the log and a small trade is not upgraded', () => {
  const star = P({ pid: 50, name: 'Star', tid: 1, ovr: 92 });
  assert.ok(dispRating(star.ovr) >= BIG_TRADE_OVR);
  const L = base([star, P({ pid: 51, name: 'Role', tid: 0, ovr: 70 })], {
    transactions: [
      { type: 'trade', season: 1998, text: 'T0 trade Role to T1 for Star.', pids: [50, 51] },
      { type: 'trade', season: 1998, text: 'T2 trade Bench to T3 for a pick.', pids: [] },
    ],
  });
  const s = seasonStorylines(L);
  assert.equal(s.trades.length, 1);
  assert.match(s.trades[0].text, /Star/);
  assert.doesNotMatch(s.trades[0].text, /Bench/);
  assert.match(s.trades[0].note, /today/);
  assert.equal(s.unlabeledTrades, 1);
});

test('counteroffers do not move assets, stay legal, and do not hand over a star', () => {
  const star = P({ pid: 1, name: 'Star', tid: 1, ovr: 90, age: 28 });
  const role = P({ pid: 2, name: 'Role', tid: 1, ovr: 74, age: 27 });
  const offer = P({ pid: 3, name: 'Offer', tid: 0, ovr: 76, age: 28 });
  const sweet = P({ pid: 4, name: 'Sweet', tid: 0, ovr: 68, age: 26 });
  const best = P({ pid: 5, name: 'Best', tid: 0, ovr: 88, age: 27 });
  const L = base([star, role, offer, sweet, best], { picks: [{ id: 'p98', season: 1998, round: 2, orig: 0, tid: 0 }] });
  const low = { tidA: 0, tidB: 1, aPids: [3], aPicks: [], bPids: [1], bPicks: [] };
  const before = snap(L);
  assert.equal(makeCounter(L, low), null);
  assert.equal(fileCounter(L, low), null);
  assert.equal(snap(L), before);
  const near = { tidA: 0, tidB: 1, aPids: [4], aPicks: [], bPids: [2], bPicks: [] };
  assert.equal(evaluateTrade(L, near).ok, false);
  const c = makeCounter(L, near);
  assert.ok(c, 'a short deal for a role player should draw a counter');
  assert.equal(snap(L), before);
  assert.ok(!c.offer.bPids.includes(star.pid));
  assert.ok(!c.offer.aPids.includes(best.pid));
  assert.ok(c.offer.aPids.includes(4));
  assert.equal(validateTrade(L, c.offer).ok, true);
  assert.equal(evaluateTrade(L, c.offer).ok, true);
  const row = fileCounter(L, near);
  const again = fileCounter(L, near);
  assert.equal(again.id, row.id);
  assert.equal(L.tradeOffers.length, 1);
  assert.deepEqual(L.players.map(p => p.tid), [1, 1, 0, 0, 0]);
  const acc = acceptOffer(L, row.id);
  assert.equal(acc.ok, true);
  assert.notEqual(L.players.find(p => p.pid === 2).tid, 1);
  assert.equal(L.players.find(p => p.pid === 1).tid, 1);
});

test('an empty offer is not filed and does not move a rebuilding roster', () => {
  const players = [P({ pid: 1, name: 'Vet', tid: 0, age: 34, ovr: 72 }), P({ pid: 2, name: 'Young', tid: 1, age: 23, ovr: 64 })];
  for (let t = 2; t < 24; t++) players.push(P({ pid: 100 + t, name: 'F' + t, tid: t, ovr: 85, age: 27 }));
  const L = base(players, { n: 24, picks: [{ id: 'late', season: 2002, round: 2, orig: 0, tid: 0 }] });
  const o = { tidA: 0, tidB: 1, aPids: [], aPicks: [], bPids: [2], bPicks: [] };
  const c = makeCounter(L, o);
  assert.equal(snap(L).includes('[1,0]'), true);
  if (c) {
    assert.ok(!c.offer.aPids.includes(1));
    assert.equal(evaluateTrade(L, c.offer).ok, true);
  }
});

test('a moved player makes the counter stale', () => {
  const a = P({ pid: 1, name: 'A', tid: 0, ovr: 80, age: 28 });
  const b = P({ pid: 2, name: 'B', tid: 1, ovr: 74, age: 27 });
  const c = P({ pid: 3, name: 'C', tid: 0, ovr: 70, age: 26 });
  const L = base([a, b, c]);
  const row = fileCounter(L, { tidA: 0, tidB: 1, aPids: [1], aPicks: [], bPids: [2], bPicks: [] });
  if (!row) return;
  a.tid = 3;
  assert.equal(validateTrade(L, row.offer).ok, false);
  refreshOffers(L, true);
  assert.ok(!L.tradeOffers.some(x => x.id === row.id));
});

test('archive does not invent champions and survives a save round trip', () => {
  const L = base([], { history: [], teamHist: [{ season: 1996, tid: 0, w: 72, l: 10, result: 'Champions', real: true }] });
  const a = leagueArchive(L);
  assert.equal(a.seasons.length, 0);
  assert.match(a.scope, /not filled in/);
  assert.match(a.priorNote, /1995-96/);
  assert.match(a.recordsScope, /not the NBA record book/);
  L.history.push({ season: 1998, champ: 0, runnerUp: 1, awards: { mvp: { pid: 9, name: 'Star' } }, leaders: { pts: { name: 'Star', v: 28.1 } } });
  const b = leagueArchive(JSON.parse(JSON.stringify(L)));
  assert.equal(b.seasons.length, 1);
  assert.equal(b.seasons[0].champName, 'Name0');
  assert.equal(b.seasons[0].awards.mvp.name, 'Star');
  const old = base([]);
  old.history = [{ season: 1999, champ: 0, runnerUp: null }];
  const c = leagueArchive(old);
  assert.equal(c.seasons[0].missingAwards, true);
  assert.equal(c.seasons[0].champName, 'Name0');
});

test('a fresh 1996 camp has no simulated champion', () => {
  const start = JSON.parse(readFileSync(new URL('../data/start1996.json', import.meta.url)));
  const L = newLeague({ start, classes: {} }, { seed: 2, userTid: 0, draftClasses: 'generated' });
  const arch = leagueArchive(L);
  assert.equal(arch.seasons.length, 0);
  assert.ok((L.teamHist || []).some(h => h.real));
  assert.match(arch.priorNote, /not listed here as a champion/);
  const s = seasonStorylines(L);
  assert.equal(s.breakouts.length, 0);
  assert.equal(s.trades.length, 0);
  assert.equal(s.race.ready, false);
  const raw = JSON.parse(JSON.stringify(L, (k, v) => (k === '_pmap' || k === '_stC' ? undefined : v)));
  assert.equal(leagueArchive(raw).seasons.length, 0);
});
