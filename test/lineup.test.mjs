import test from 'node:test';
import assert from 'node:assert/strict';
import { lineupPreview, saveManualLineup, rosterFor, repairSave } from '../src/engine/league.js';
import { release } from '../src/engine/offseason.js';
import { simGame } from '../src/engine/sim.js';

const ratings = () => ({ ins: 60, out: 60, pas: 60, han: 60, reb: 60, idef: 60, pdef: 60, ath: 60, iq: 60, sco: 60, dur: 60, sta: 60, blk: 50, stl: 50 });
let n = 1;
function P(o) {
  return { pid: o.pid ?? n++, name: o.name, pos: o.pos, ovr: o.ovr, pot: o.ovr, h: 198, age: 27, tid: o.tid, il: !!o.il, injury: o.injury || null, ratings: ratings(), contract: { amt: 1000, exp: 2002 } };
}
function team(tid, abbr) {
  return { tid, abbr, city: abbr, name: abbr, inactive: false, rotation: null, autoRotation: true, staff: {}, manualLineup: false };
}
function league(players) {
  return { season: 2000, phase: 'REGULAR', day: 10, userTid: 0, settings: {}, gm: {}, news: [], transactions: [], deadMoney: [], teams: [team(0, 'LAL'), team(1, 'MIN'), team(2, 'BOS')], players };
}
const snap = (L) => JSON.stringify(L.teams.map(t => [t.rotation, t.autoRotation, t.manualLineup]));

test('opening a lineup does not write it, and an old save still previews the automatic five', () => {
  const weak = P({ name: 'Weak', pos: 'SG', ovr: 60, tid: 1 });
  const strong = P({ name: 'Strong', pos: 'SG', ovr: 90, tid: 1 });
  const rest = ['PG', 'SF', 'PF', 'C'].map((pos, i) => P({ name: pos, pos, ovr: 75, tid: 1 }));
  const L = league([weak, strong, ...rest, P({ name: 'Mine', pos: 'PG', ovr: 80, tid: 0 })]);
  L.teams[0].rotation = { starters: [L.players.find(p => p.tid === 0).pid], minutes: {} };
  const before = snap(L);
  const view = lineupPreview(L, 1);
  assert.equal(view.source, 'auto');
  assert.equal(view.saved, false);
  assert.ok(view.simIds.includes(strong.pid));
  assert.equal(snap(L), before);
  const old = JSON.parse(JSON.stringify(L));
  delete old.teams[1].manualLineup;
  assert.equal(lineupPreview(old, 1).source, 'auto');
  assert.equal(old.teams[1].rotation, null);
});

test('a saved starter is who the simulation starts, and cancel-sized reads do not spread', () => {
  const weak = P({ name: 'Weak', pos: 'SG', ovr: 60, tid: 1 });
  const strong = P({ name: 'Strong', pos: 'SG', ovr: 90, tid: 1 });
  const rest = ['PG', 'SF', 'PF', 'C'].map(pos => P({ name: pos + 'a', pos, ovr: 78, tid: 1 }));
  const mine = P({ name: 'Mine', pos: 'PG', ovr: 88, tid: 0 });
  const other = P({ name: 'Other', pos: 'PG', ovr: 70, tid: 2 });
  const L = league([weak, strong, ...rest, mine, other]);
  L.teams[0].rotation = { starters: [mine.pid], minutes: { [mine.pid]: 30 }, order: [mine.pid] };
  L.teams[0].autoRotation = false;
  const auto = lineupPreview(L, 1).simIds;
  assert.ok(auto.includes(strong.pid));
  assert.ok(!auto.includes(weak.pid));
  const chosen = auto.map(id => id === strong.pid ? weak.pid : id);
  // put the stronger player in by replacing the weak one: chosen currently has strong, swap to weak then back
  const withStrong = auto.slice();
  if (!withStrong.includes(strong.pid)) withStrong[0] = strong.pid;
  const r = saveManualLineup(L, 1, withStrong);
  assert.equal(r.ok, true);
  assert.equal(L.teams[1].manualLineup, true);
  assert.deepEqual(L.teams[0].rotation.starters, [mine.pid]);
  assert.equal(L.teams[2].manualLineup, false);
  assert.equal(L.teams[2].rotation, null);
  const used = rosterFor(L, 1);
  assert.ok(used.rotation.starters.includes(strong.pid));
  const away = ['PG', 'SG', 'SF', 'PF', 'C'].map(pos => P({ name: 'B' + pos, pos, ovr: 70, tid: 2 }));
  L.players.push(...away);
  const game = simGame(rosterFor(L, 1), rosterFor(L, 2));
  assert.equal(game.box[1][strong.pid].gs, 1);
  assert.equal(game.box[1][weak.pid]?.gs || 0, 0);
  const round = JSON.parse(JSON.stringify(L));
  assert.equal(lineupPreview(round, 1).source, 'saved');
  assert.ok(lineupPreview(round, 1).simIds.includes(strong.pid));
});

test('an injured or moved starter falls back for that game and a release clears the saved five', () => {
  const star = P({ name: 'Star', pos: 'PG', ovr: 92, tid: 1 });
  const next = P({ name: 'Next', pos: 'PG', ovr: 80, tid: 1 });
  const rest = ['SG', 'SF', 'PF', 'C'].map(pos => P({ name: pos + 'b', pos, ovr: 76, tid: 1 }));
  const L = league([star, next, ...rest]);
  const ids = lineupPreview(L, 1).simIds;
  assert.equal(saveManualLineup(L, 1, ids).ok, true);
  const kept = JSON.stringify(L.teams[1].rotation.starters);
  star.injury = { type: 'ankle', games: 4 };
  const hurt = lineupPreview(L, 1);
  assert.equal(hurt.source, 'auto');
  assert.equal(hurt.saved, true);
  assert.equal(JSON.stringify(L.teams[1].rotation.starters), kept);
  assert.ok(!rosterFor(L, 1).rotation.starters.includes(star.pid));
  star.injury = null;
  assert.equal(lineupPreview(L, 1).source, 'saved');
  assert.equal(saveManualLineup(L, 1, [star.pid, star.pid, rest[0].pid, rest[1].pid, rest[2].pid]).ok, false);
  release(L, star);
  assert.equal(L.teams[1].manualLineup, false);
  assert.equal(L.teams[1].rotation, null);
  assert.equal(lineupPreview(L, 1).source, 'auto');
  const broken = league([P({ name: 'Gone', pos: 'PG', ovr: 70, tid: 1 })]);
  broken.teams[1].manualLineup = true;
  broken.teams[1].autoRotation = false;
  broken.teams[1].rotation = { starters: [999, 998, 997, 996, 995], minutes: {} };
  repairSave(broken);
  assert.equal(broken.teams[1].rotation, null);
  assert.equal(broken.teams[1].manualLineup, false);
});
