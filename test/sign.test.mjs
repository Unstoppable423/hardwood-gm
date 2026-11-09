import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionerSign, commissionerSignPlan, fairContract } from '../src/engine/offseason.js';
import { ROSTER_MAX } from '../src/engine/constants.js';

let n = 1;
function guy(o) {
  return { pid: o.pid ?? n++, name: o.name || 'Guy ' + n, age: o.age ?? 26, pos: 'SG', ovr: o.ovr ?? 70, pot: o.pot ?? 74, tid: o.tid ?? -1, il: !!o.il, retired: !!o.retired, formerTid: o.formerTid, contract: o.contract ?? null, stats: { tid: o.tid ?? -1 } };
}
function league(players, extra = {}) {
  return {
    season: extra.season ?? 2000, phase: 'FA1', day: 1, userTid: 0,
    settings: { difficulty: 'Medium', realHistory: true }, gm: { name: 'GM' }, news: [], transactions: [], deadMoney: [],
    fa: { offers: { 99: [{ tid: 1 }] } },
    teams: [
      { tid: 0, abbr: 'CLE', city: 'Cleveland', name: 'Cavaliers', inactive: false },
      { tid: 1, abbr: 'SAS', city: 'San Antonio', name: 'Spurs', inactive: false },
    ],
    players,
  };
}
const ids = (L, tid) => L.players.filter(p => p.tid === tid).map(p => p.pid).sort((a, b) => a - b);

test('a full roster blocks a commissioner signing and waives nobody', () => {
  const roster = Array.from({ length: ROSTER_MAX }, (_, i) => guy({ tid: 1, name: 'Spur ' + i, contract: { amt: 2000, exp: 2003 } }));
  const mobley = guy({ name: 'Cuttino Mobley', formerTid: 1, ovr: 78 });
  const L = league([...roster, mobley]);
  const before = ids(L, 1);
  const deals = roster.map(p => p.contract.amt);
  const plan = commissionerSignPlan(L, mobley, 1);
  assert.equal(plan.ok, false);
  assert.equal(plan.full, true);
  assert.equal(plan.active, 15);
  assert.equal(plan.max, 15);
  assert.equal(plan.previous, true);
  assert.equal(plan.years, 7);
  const signed = commissionerSign(L, mobley, 1);
  assert.equal(signed.ok, false);
  assert.equal(mobley.tid, -1);
  assert.equal(mobley.contract, null);
  assert.deepEqual(ids(L, 1), before);
  assert.deepEqual(roster.map(p => p.contract.amt), deals);
});

test('an injured-list player does not fill the roster, and a second sign does not run', () => {
  const roster = Array.from({ length: ROSTER_MAX - 1 }, (_, i) => guy({ tid: 1, name: 'Spur ' + i, contract: { amt: 1000, exp: 2002 } }));
  roster.push(guy({ tid: 1, name: 'Hurt', il: true, contract: { amt: 1000, exp: 2002 } }));
  const mobley = guy({ name: 'Cuttino Mobley', formerTid: 1, ovr: 78 });
  const L = league([...roster, mobley]);
  const plan = commissionerSignPlan(L, mobley, 1);
  assert.equal(plan.ok, true);
  assert.equal(plan.active, 14);
  assert.equal(plan.years, 7);
  assert.equal(plan.amt, fairContract(L, mobley));
  const first = commissionerSign(L, mobley, 1);
  assert.equal(first.ok, true);
  assert.equal(mobley.tid, 1);
  assert.equal(mobley.contract.amt, plan.amt);
  assert.equal(L.fa.offers[mobley.pid], undefined);
  const again = commissionerSign(L, mobley, 1);
  assert.equal(again.ok, false);
  assert.equal(L.players.filter(p => p.tid === 1 && !p.il).length, 15);
});

test('another team with room gets the shorter deal, and the salary cap is not a gate', () => {
  const rich = Array.from({ length: 10 }, (_, i) => guy({ tid: 0, name: 'Cav ' + i, contract: { amt: 20000, exp: 2004 } }));
  const mobley = guy({ name: 'Cuttino Mobley', formerTid: 1, ovr: 78 });
  const L = league([...rich, mobley]);
  const spurs = commissionerSignPlan(L, mobley, 1);
  const cavs = commissionerSignPlan(L, mobley, 0);
  assert.equal(spurs.ok, true);
  assert.equal(spurs.years, 7);
  assert.equal(spurs.previous, true);
  assert.equal(cavs.ok, true);
  assert.equal(cavs.years, 6);
  assert.equal(cavs.previous, false);
  const signed = commissionerSign(L, mobley, 0);
  assert.equal(signed.ok, true);
  assert.equal(signed.years, 6);
  assert.equal(mobley.tid, 0);
  assert.ok(mobley.contract.amt > 0);
});

test('a retired player and a missing team are refused without changes', () => {
  const mobley = guy({ name: 'Cuttino Mobley', retired: true, tid: -3 });
  const L = league([mobley]);
  const before = JSON.stringify(L.players);
  assert.equal(commissionerSignPlan(L, mobley, 1).ok, false);
  assert.equal(commissionerSignPlan(L, guy({ name: 'Open' }), 9).ok, false);
  assert.equal(JSON.stringify(L.players), before);
});
