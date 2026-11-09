import test from 'node:test';
import assert from 'node:assert/strict';
import { aiRosterFix, birdRightsReturns, cpuUpgrade, endHiatus, enterResign, rosterScore } from '../src/engine/offseason.js';
import { setSeed } from '../src/engine/rng.js';

let n = 1;
function guy(o) {
  return {
    pid: n++, name: o.name, age: o.age, pos: o.pos || 'SG', ovr: o.ovr, pot: o.pot ?? o.ovr,
    tid: o.tid, il: false, retired: false,
    contract: o.contract ?? { amt: o.amt ?? 400, exp: o.exp ?? 2003, ng: o.ng !== false },
    stats: { tid: o.tid, reg: { gp: 10 } }, mood: 55,
    traits: { work: 'Medium', ambition: 50, loyalty: 60, personality: 'Team Player', greed: 40 },
    ratings: { dur: 70 },
  };
}
function fillers(tid, k, ovr, pos = 'PF') {
  return Array.from({ length: k }, (_, i) => guy({ tid, name: `F${tid}-${i}`, age: 28, ovr, pot: ovr, pos, amt: 5000, ng: false, exp: 2004 }));
}
function league(players) {
  const pad = [...fillers(0, 15, 70), ...fillers(2, 15, 55)];
  return {
    season: 2001, phase: 'PRESEASON', day: 1, userTid: 0, rng: 1, picks: [], schedule: [],
    settings: { difficulty: 'Medium', morale: true, cpuMoves: false, playerCap: true, capMode: 'soft', realHistory: true, careers: 'real' },
    gm: { name: 'GM' }, news: [], transactions: [], deadMoney: [], fa: { offers: {} }, inbox: [],
    teams: [
      { tid: 0, abbr: 'CLE', city: 'Cleveland', name: 'Cavaliers', inactive: false },
      { tid: 1, abbr: 'SAS', city: 'San Antonio', name: 'Spurs', inactive: false },
      { tid: 2, abbr: 'VAN', city: 'Vancouver', name: 'Grizzlies', inactive: false },
    ],
    players: [...pad, ...players],
  };
}
const on = (L, name) => L.players.find(p => p.name === name).tid;

test('upside is worth a small current gap, not a large one, and a contender discounts it', () => {
  const young = guy({ name: 'Young', age: 21, ovr: 60, pot: 78, tid: 1 });
  const old = guy({ name: 'Old', age: 31, ovr: 62, pot: 62, tid: 1 });
  const vet = guy({ name: 'Vet', age: 29, ovr: 70, pot: 72, tid: 1 });
  const raw = guy({ name: 'Raw', age: 20, ovr: 48, pot: 74, tid: 1 });
  const L = league([young, old, vet, raw]);
  assert.ok(rosterScore(L, young, { strat: 'mid', money: false }) > rosterScore(L, old, { strat: 'mid', money: false }));
  assert.ok(rosterScore(L, young, { strat: 'win', money: false }) > rosterScore(L, old, { strat: 'win', money: false }));
  assert.ok(rosterScore(L, vet, { strat: 'win', money: false }) > rosterScore(L, young, { strat: 'win', money: false }));
  assert.ok(rosterScore(L, vet, { strat: 'rebuild', money: false }) > rosterScore(L, raw, { strat: 'rebuild', money: false }));
  assert.ok(rosterScore(L, raw, { strat: 'win', money: false }) < 60);
});

test('an over-limit contender cuts the older fringe player, not the similar young one or the better veteran', () => {
  const young = guy({ tid: 1, name: 'Young', age: 21, ovr: 60, pot: 78, pos: 'SG' });
  const old = guy({ tid: 1, name: 'Old', age: 31, ovr: 62, pot: 62, pos: 'SG' });
  const L = league([...fillers(1, 14, 85), young, old]);
  setSeed(1);
  aiRosterFix(L);
  assert.equal(on(L, 'Young'), 1);
  assert.equal(on(L, 'Old'), -1);
  assert.equal(L.players.filter(p => p.tid === 1).length, 15);

  const raw = guy({ tid: 1, name: 'Raw', age: 20, ovr: 52, pot: 78, pos: 'SF' });
  const vet = guy({ tid: 1, name: 'Vet', age: 29, ovr: 70, pot: 72, pos: 'SF' });
  const L2 = league([...fillers(1, 14, 84), raw, vet]);
  setSeed(2);
  cpuUpgrade(L2, 0);
  assert.equal(on(L2, 'Raw'), -1);
  assert.equal(on(L2, 'Vet'), 1);
});

test('an open roster spot prefers the young upside free agent over a slightly better older one', () => {
  const young = guy({ tid: -1, name: 'YoungFA', age: 21, ovr: 60, pot: 78, pos: 'PG' });
  const old = guy({ tid: -1, name: 'OldFA', age: 31, ovr: 63, pot: 63, pos: 'SG' });
  const L = league([...fillers(1, 14, 84), young, old]);
  setSeed(3);
  aiRosterFix(L);
  assert.equal(on(L, 'YoungFA'), 1);
  assert.equal(on(L, 'OldFA'), -1);
  setSeed(4);
  cpuUpgrade(L, 2);
  assert.equal(on(L, 'YoungFA'), 1, 'a second pass does not waive him for the older free agent');
  assert.equal(on(L, 'OldFA'), -1);
});

test('the only center is signed ahead of a redundant wing with similar value', () => {
  const wing = guy({ tid: -1, name: 'Wing', age: 22, ovr: 60, pot: 70, pos: 'SG' });
  const center = guy({ tid: -1, name: 'Center', age: 30, ovr: 62, pot: 62, pos: 'C' });
  const L = league([...fillers(1, 13, 84, 'PF'), guy({ tid: 1, name: 'OtherWing', age: 27, ovr: 75, pot: 75, pos: 'SG', amt: 4000, ng: false }), wing, center]);
  setSeed(5);
  aiRosterFix(L);
  assert.equal(on(L, 'Center'), 1);
  assert.equal(on(L, 'Wing'), -1);
});

test('a comeback waives the older minimum, not the young upside player or a guaranteed salary', () => {
  const young = guy({ tid: 1, name: 'Young', age: 21, ovr: 58, pot: 78, amt: 400, ng: true });
  const old = guy({ tid: 1, name: 'Old', age: 32, ovr: 61, pot: 61, amt: 400, ng: true });
  const star = guy({ tid: 1, name: 'Star', age: 30, ovr: 70, pot: 70, amt: 12000, ng: false, exp: 2005 });
  const arrive = guy({ tid: -3, name: 'Comeback', age: 28, ovr: 75, pot: 75, amt: 0 });
  arrive.real = true;
  arrive.draft = { year: 1996 };
  arrive.arcKey = 'comeback|1996';
  arrive.hiatus = { from: 1999, until: 2000, age: 28, exTid: 1 };
  const L = league([...fillers(1, 12, 86), young, old, star, arrive]);
  L.data = { careers: { 'comeback|1996': { n: 'Comeback', a: { '2000': [0.8, 5, 70, 28, 'SAS'] } } } };
  setSeed(6);
  endHiatus(L, arrive);
  assert.equal(on(L, 'Young'), 1);
  assert.equal(on(L, 'Star'), 1);
  assert.equal(on(L, 'Old'), -1);
  assert.equal(arrive.tid, 1);
  assert.equal(L.players.filter(p => p.tid === 1).length, 15);
});

test('an expiring young high-upside player is re-signed more often than the old ovr cutoff allowed', () => {
  let youngKept = 0, oldKept = 0, rawKept = 0;
  for (let s = 1; s <= 24; s++) {
    const young = guy({ tid: 1, name: 'Young', age: 21, ovr: 58, pot: 78, amt: 400, ng: false, exp: 2001 });
    const old = guy({ tid: 1, name: 'Old', age: 30, ovr: 61, pot: 61, amt: 400, ng: false, exp: 2001 });
    const raw = guy({ tid: 1, name: 'Raw', age: 20, ovr: 48, pot: 70, amt: 400, ng: false, exp: 2001 });
    const L = league([...fillers(1, 6, 80), young, old, raw]);
    L.phase = 'AWARDS';
    setSeed(100 + s);
    enterResign(L);
    if (young.tid === 1) youngKept++;
    if (old.tid === 1) oldKept++;
    if (raw.tid === 1) rawKept++;
  }
  assert.ok(youngKept >= 12, `young kept ${youngKept}/24`);
  assert.ok(oldKept >= 12, `old kept ${oldKept}/24`);
  assert.equal(rawKept, 0);
});

test('a Bird-rights return does not waive a young upside player for a lesser veteran', () => {
  const young = guy({ tid: 1, name: 'Young', age: 21, ovr: 58, pot: 78, pos: 'SG' });
  const old = guy({ tid: 1, name: 'Old', age: 31, ovr: 61, pot: 61, pos: 'SG' });
  const back = guy({ tid: -1, name: 'Returner', age: 30, ovr: 66, pot: 66, pos: 'SF' });
  back.birdRights = true; back.formerTid = 1;
  const L = league([...fillers(1, 13, 86), young, old, back]);
  setSeed(11);
  birdRightsReturns(L);
  assert.equal(on(L, 'Young'), 1);
  assert.equal(on(L, 'Old'), -1);
  assert.equal(on(L, 'Returner'), 1);

  const kid = guy({ tid: 1, name: 'Kid', age: 21, ovr: 60, pot: 78, pos: 'PG' });
  const modest = guy({ tid: -1, name: 'Modest', age: 30, ovr: 61, pot: 61, pos: 'SG' });
  modest.birdRights = true; modest.formerTid = 1;
  const L2 = league([...fillers(1, 14, 86), kid, modest]);
  setSeed(12);
  birdRightsReturns(L2);
  assert.equal(on(L2, 'Kid'), 1);
  assert.equal(on(L2, 'Modest'), -1);
});

test('a saved starter and the user roster are not the CPU cut', () => {
  const young = guy({ tid: 1, name: 'Young', age: 21, ovr: 60, pot: 78, pos: 'SG' });
  const old = guy({ tid: 1, name: 'Old', age: 31, ovr: 62, pot: 62, pos: 'SG' });
  const L = league([...fillers(1, 14, 84), young, old]);
  const sas = L.teams[1];
  sas.manualLineup = true;
  sas.rotation = { starters: [old.pid, 1, 2, 3, 4], minutes: {} };
  setSeed(8);
  aiRosterFix(L);
  assert.equal(on(L, 'Old'), 1);
  assert.equal(sas.manualLineup, true);

  const mine = guy({ tid: 0, name: 'Mine', age: 21, ovr: 58, pot: 80 });
  const myOld = guy({ tid: 0, name: 'MyOld', age: 33, ovr: 64, pot: 64 });
  const U = league([...fillers(0, 14, 75), mine, myOld]);
  const before = U.players.filter(p => p.tid === 0).map(p => p.pid).sort();
  setSeed(9);
  aiRosterFix(U);
  cpuUpgrade(U, 2);
  assert.deepEqual(U.players.filter(p => p.tid === 0).map(p => p.pid).sort(), before);
});

test('a CPU team re-signs a clearly better young player when the new deal is over the cap', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const star = guy({ tid: 1, name: 'Star', age: 24, ovr: 82, pot: 88, pos: 'PF', amt: 4000, exp: 2001, ng: false });
    const cheap = Array.from({ length: 8 }, (_, i) => guy({ tid: 1, name: `Cheap${seed}-${i}`, age: 30, ovr: 55, pot: 55, pos: 'C', amt: 12000, exp: 2005, ng: false }));
    const mine = guy({ tid: 0, name: 'Mine', age: 24, ovr: 82, pot: 88, pos: 'PF', amt: 4000, exp: 2001, ng: false });
    const L = league([star, ...cheap, mine]);
    setSeed(seed);
    enterResign(L);
    assert.equal(star.tid, 1, `seed ${seed}`);
    assert.ok(star.contract && star.contract.exp >= L.season);
    assert.ok(cheap.every(p => p.tid === 1));
    assert.equal(mine.tid, 0);
    assert.ok(L.expiring.includes(mine.pid));
  }
});

test('a non-guaranteed fringe player can be released so the star deal is closer to fitting', () => {
  const star = guy({ tid: 1, name: 'Star', age: 24, ovr: 82, pot: 88, pos: 'PF', amt: 4000, exp: 2001, ng: false });
  const camp = Array.from({ length: 6 }, (_, i) => guy({ tid: 1, name: `Camp${i}`, age: 30, ovr: 55, pot: 55, pos: 'C', amt: 14000, exp: 2005, ng: true }));
  const saved = guy({ tid: 1, name: 'Saved', age: 30, ovr: 55, pot: 55, pos: 'C', amt: 14000, exp: 2005, ng: true });
  const L = league([star, ...camp, saved]);
  L.teams[1].manualLineup = true;
  L.teams[1].rotation = { starters: [saved.pid], minutes: {} };
  setSeed(5);
  enterResign(L);
  assert.equal(star.tid, 1);
  assert.equal(saved.tid, 1);
  const cut = camp.filter(p => p.tid === -1);
  assert.ok(cut.length >= 1 && cut.length <= 3);
  assert.ok(cut.every(p => p.formerTid === 1 && p.contract === null));
});

test('a solid expiring player still walks when the deal does not fit, and nobody else is cut', () => {
  const solid = guy({ tid: 1, name: 'Solid', age: 29, ovr: 64, pot: 64, pos: 'SG', amt: 3000, exp: 2001, ng: false });
  const mates = Array.from({ length: 6 }, (_, i) => guy({ tid: 1, name: `Mate${i}`, age: 28, ovr: 60, pot: 60, pos: 'PF', amt: 14000, exp: 2005, ng: true }));
  const L = league([solid, ...mates]);
  setSeed(4);
  enterResign(L);
  assert.equal(solid.tid, -1);
  assert.equal(solid.formerTid, 1);
  assert.ok(mates.every(p => p.tid === 1));
});
