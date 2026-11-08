import test from 'node:test';
import assert from 'node:assert/strict';
import { release, releaseConsequence } from '../src/engine/offseason.js';
import { payroll } from '../src/engine/league.js';

function guy(o) {
  return { pid: o.pid, name: o.name, pos: 'PF', tid: o.tid ?? 0, age: 28, ovr: 70, pot: 70, contract: o.contract, il: false };
}
function league(phase, players) {
  return {
    season: 2000, phase, day: 1, userTid: 0, deadMoney: [], news: [], transactions: [],
    teams: [{ tid: 0, abbr: 'LAL', city: 'Los Angeles', name: 'Lakers', inactive: false }],
    players,
  };
}
const mate = (id, name) => guy({ pid: id, name, contract: { amt: 2000, exp: 2003 } });

test('a guaranteed preseason release keeps one salary and cuts only that player', () => {
  const fox = guy({ pid: 1, name: 'Rick Fox', contract: { amt: 2700, exp: 2002 } });
  const stay = mate(2, 'Derek Fisher');
  const L = league('PRESEASON', [fox, stay]);
  const note = releaseConsequence(L, fox);
  assert.equal(note.dead, true);
  assert.equal(note.amt, 2700);
  assert.equal(note.exp, 2002);
  release(L, fox);
  release(L, fox);
  assert.equal(fox.tid, -1);
  assert.equal(fox.contract, null);
  assert.equal(stay.tid, 0);
  assert.equal(stay.contract.amt, 2000);
  assert.equal(L.deadMoney.length, 1);
  assert.equal(L.deadMoney[0].name, 'Rick Fox');
  assert.equal(payroll(L, 0), 2000 + 2700);
});

test('a non-guaranteed offseason deal adds no dead money, and the same deal does in the regular season', () => {
  const camp = guy({ pid: 3, name: 'Camp', contract: { amt: 350, exp: 2000, ng: true } });
  const off = league('PRESEASON', [camp, mate(4, 'Stay')]);
  assert.equal(releaseConsequence(off, camp).dead, false);
  assert.equal(releaseConsequence(off, camp).ng, true);
  release(off, camp);
  assert.equal(off.deadMoney.length, 0);
  assert.equal(payroll(off, 0), 2000);

  const reg = league('REGULAR', [guy({ pid: 5, name: 'Camp', contract: { amt: 350, exp: 2000, ng: true } })]);
  assert.equal(releaseConsequence(reg, reg.players[0]).dead, true);
  release(reg, reg.players[0]);
  assert.equal(reg.deadMoney.length, 1);
  assert.equal(reg.deadMoney[0].amt, 350);
});

test('an already-expired contract adds no dead money', () => {
  const old = guy({ pid: 6, name: 'Old', contract: { amt: 5000, exp: 1999 } });
  const L = league('PRESEASON', [old]);
  assert.equal(releaseConsequence(L, old).dead, false);
  release(L, old);
  assert.equal(L.deadMoney.length, 0);
  assert.equal(old.tid, -1);
});
