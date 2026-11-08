import test from 'node:test';
import assert from 'node:assert/strict';
import { returnPlan, returnFreeAgents } from '../src/engine/offseason.js';
import { cap, payroll } from '../src/engine/league.js';
import { ROSTER_MAX } from '../src/engine/constants.js';

let n = 1;
function guy(o) {
  return { pid: o.pid ?? n++, name: o.name || 'P' + n, age: o.age ?? 28, pos: 'SF', ovr: o.ovr ?? 70, pot: o.pot ?? 70, tid: o.tid ?? -1, il: false, formerTid: o.formerTid, stats: { tid: o.statsTid }, career: o.career || [], contract: o.contract ?? null };
}
function league(players, extra = {}) {
  return {
    season: extra.season ?? 2000, phase: 'FA1', day: 0, userTid: 0,
    settings: { difficulty: 'Medium' }, gm: {}, news: [], transactions: [], deadMoney: [],
    fa: { offers: {}, round: 1 },
    teams: [
      { tid: 0, abbr: 'LAL', city: 'Los Angeles', name: 'Lakers', inactive: false },
      { tid: 1, abbr: 'MIL', city: 'Milwaukee', name: 'Bucks', inactive: !!extra.milInactive },
    ],
    players,
  };
}
const ids = (L, tid) => L.players.filter(p => p.tid === tid).map(p => p.pid).sort((a, b) => a - b);
const deals = (L, tid) => L.players.filter(p => p.tid === tid).map(p => [p.pid, p.contract?.amt]);

test('a recent previous team in this save is the only destination', () => {
  const back = guy({ name: 'Vin', formerTid: 1, statsTid: 1, ovr: 80 });
  const byCareer = guy({ name: 'Ron', formerTid: 1, statsTid: -1, career: [{ season: 1999, gp: 10 }], ovr: 75 });
  const L = league([
    ...Array.from({ length: 10 }, (_, i) => guy({ tid: 1, name: 'Buck ' + i, contract: { amt: 1000, exp: 2002 } })),
    back, byCareer,
  ]);
  const moved = returnFreeAgents(L, { includeUser: false });
  assert.deepEqual(moved.returned.map(p => p.name).sort(), ['Ron', 'Vin']);
  assert.equal(moved.skippedFull.length, 0);
  assert.equal(back.tid, 1);
  assert.equal(byCareer.tid, 1);
  assert.ok(back.contract?.amt > 0);
  assert.equal(back.formerTid, undefined);
});

test('a missing, stale, or inactive previous team is not guessed', () => {
  const none = guy({ name: 'Nobody', statsTid: 1 });
  const stale = guy({ name: 'Old', formerTid: 1, statsTid: -1, career: [{ season: 1990, gp: 10 }] });
  const dead = guy({ name: 'Gone', formerTid: 1, statsTid: 1 });
  const L = league([none, stale, dead], { milInactive: true });
  const before = JSON.stringify(L.players.map(p => [p.pid, p.tid, p.contract]));
  const plan = returnPlan(L);
  assert.equal(plan.length, 0);
  const moved = returnFreeAgents(L);
  assert.equal(moved.returned.length, 0);
  assert.equal(JSON.stringify(L.players.map(p => [p.pid, p.tid, p.contract])), before);
});

test('a full roster is skipped and nobody already there is waived', () => {
  const roster = Array.from({ length: ROSTER_MAX }, (_, i) => guy({ tid: 1, name: 'Stay ' + i, ovr: 50 + i, contract: { amt: 1500 + i, exp: 2003 } }));
  const extra = guy({ name: 'Extra', formerTid: 1, statsTid: 1, ovr: 90 });
  const L = league([...roster, extra]);
  const beforeIds = ids(L, 1);
  const beforeDeals = deals(L, 1);
  const plan = returnPlan(L);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].full, true);
  const moved = returnFreeAgents(L);
  assert.equal(moved.returned.length, 0);
  assert.equal(moved.skippedFull.length, 1);
  assert.equal(extra.tid, -1);
  assert.equal(extra.contract, null);
  assert.deepEqual(ids(L, 1), beforeIds);
  assert.deepEqual(deals(L, 1), beforeDeals);
});

test('your own former players stay put unless included, and a full roster still blocks them', () => {
  const mine = guy({ name: 'Mine', formerTid: 0, statsTid: 0, ovr: 88 });
  const room = Array.from({ length: 10 }, (_, i) => guy({ tid: 0, name: 'Laker ' + i, contract: { amt: 2000, exp: 2002 } }));
  const open = league([...room, mine]);
  assert.equal(returnPlan(open).find(r => r.pid === mine.pid).yours, true);
  let moved = returnFreeAgents(open, { includeUser: false });
  assert.equal(moved.returned.length, 0);
  assert.equal(mine.tid, -1);
  moved = returnFreeAgents(open, { includeUser: true });
  assert.equal(mine.tid, 0);
  assert.ok(mine.contract?.amt > 0);

  const packed = Array.from({ length: ROSTER_MAX }, (_, i) => guy({ tid: 0, name: 'Full ' + i, contract: { amt: 2000, exp: 2002 } }));
  const blocked = guy({ name: 'Blocked', formerTid: 0, statsTid: 0, ovr: 88 });
  const full = league([...packed, blocked]);
  const dealsBefore = deals(full, 0);
  moved = returnFreeAgents(full, { includeUser: true });
  assert.equal(blocked.tid, -1);
  assert.equal(moved.skippedFull.length, 1);
  assert.deepEqual(deals(full, 0), dealsBefore);
});

test('the salary cap does not stop a return, and planning does not change the roster', () => {
  const roster = Array.from({ length: 10 }, (_, i) => guy({ tid: 1, name: 'Cap ' + i, contract: { amt: 20000, exp: 2004 } }));
  const star = guy({ name: 'Star', formerTid: 1, statsTid: 1, ovr: 85 });
  const L = league([...roster, star]);
  assert.ok(payroll(L, 1) > cap(L));
  const snap = JSON.stringify(L.players.map(p => [p.pid, p.tid, p.contract]));
  returnPlan(L);
  assert.equal(JSON.stringify(L.players.map(p => [p.pid, p.tid, p.contract])), snap);
  const moved = returnFreeAgents(L);
  assert.equal(moved.returned.length, 1);
  assert.equal(star.tid, 1);
  assert.ok(payroll(L, 1) > cap(L));
});
