import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseImportedSave, controlledSnapshot } from '../src/ui/savefile.js';
import { repairSave } from '../src/engine/league.js';
import { ensureSettings } from '../src/engine/franchise.js';

const mini = () => JSON.stringify({
  version: 1, season: 1999, phase: 'DRAFT', day: 128, userTid: 0,
  settings: { playerCap: true, staffCap: false, morale: false },
  teams: [{ tid: 0, abbr: 'LAL', city: 'Los Angeles', name: 'Lakers', rotation: { starters: [1], order: [1, 2], minutes: { 1: 36 } } }],
  players: [
    { pid: 1, tid: 0, ovr: 80, pot: 80, contract: { amt: 1000 } },
    { pid: 2, tid: -1, ovr: 60, pot: 70, contract: null },
  ],
  picks: [{ id: '0-1999-1', tid: 0, orig: 0, season: 1999, round: 1 }],
  schedule: [{ played: true }, { played: false }],
  tradeOffers: [],
});

test('a version 1 league save is accepted and not rewritten', () => {
  const text = mini();
  const r = parseImportedSave(text);
  assert.equal(r.ok, true);
  assert.equal(r.league.season, 1999);
  assert.equal(r.league.phase, 'DRAFT');
  assert.equal(r.league.settings.playerCap, true);
  assert.equal(r.league.settings.morale, false);
  assert.equal(JSON.stringify(r.league), text);
});

test('an older save with no version field still loads', () => {
  const o = JSON.parse(mini());
  delete o.version;
  const r = parseImportedSave(JSON.stringify(o));
  assert.equal(r.ok, true);
  assert.equal(r.league.version, undefined);
});

test('bad files are refused with a reason and no league', () => {
  for (const [text, needle] of [
    ['{', 'not valid JSON'],
    ['[]', 'not a Hardwood GM save'],
    ['null', 'not a Hardwood GM save'],
    [JSON.stringify({ format: 'hgm-roster-1', players: [{ name: 'A' }] }), 'roster file'],
    [JSON.stringify({ name: 'Class', prospects: [{ name: 'A' }] }), 'draft-class'],
    [JSON.stringify({ version: 2, season: 1999, phase: 'DRAFT', userTid: 0, teams: [{ name: 'Lakers' }], players: [{ pid: 1 }] }), 'version 2'],
    [JSON.stringify({ version: 1, season: 1999, phase: 'DRAFT', userTid: 3, teams: [{ name: 'Lakers' }], players: [{ pid: 1 }] }), 'which team'],
    [JSON.stringify({ version: 1, userTid: 0, teams: [{ name: 'Lakers' }], players: [{ pid: 1 }] }), 'season or phase'],
  ]) {
    const r = parseImportedSave(text);
    assert.equal(r.ok, false, text.slice(0, 40));
    assert.equal(r.league, undefined);
    assert.match(r.error, new RegExp(needle, 'i'));
  }
});

test('the controlled roster, picks, and lineup can be snapshotted without simulating', () => {
  const L = JSON.parse(mini());
  const s = controlledSnapshot(L);
  assert.equal(s.abbr, 'LAL');
  assert.deepEqual(s.roster, [[1, 0, 80, 80, 1000]]);
  assert.deepEqual(s.picks, [['0-1999-1', 0, 0, 1999, 1]]);
  assert.deepEqual(s.starters, [1]);
  assert.equal(s.played, 1);
});

const REAL = process.env.HGM_IMPORT_FILE || '/home/ubuntu/.cursor/projects/workspace/uploads/hgm-mitchell-import_9b94.json';

test('the supplied version 1 save parses, and loading it keeps the controlled assets', { skip: existsSync(REAL) ? false : 'personal save is not in this checkout' }, () => {
  const text = readFileSync(REAL, 'utf8');
  const r = parseImportedSave(text);
  assert.equal(r.ok, true);
  assert.equal(r.league.version, 1);
  assert.equal(r.league.season, 1999);
  assert.equal(r.league.phase, 'DRAFT');
  assert.equal(r.league.userTid, 12);
  assert.equal(r.league.teams.length, 29);
  assert.equal(r.league.players.length, 988);
  assert.equal(r.league.teams[12].abbr, 'LAL');
  const before = controlledSnapshot(r.league);
  repairSave(r.league);
  ensureSettings(r.league);
  const after = controlledSnapshot(r.league);
  const ident = (s) => s.roster.map(row => [row[0], row[1], row[4]]);
  assert.deepEqual(ident(after), ident(before));
  assert.deepEqual(after.picks, before.picks);
  assert.deepEqual(after.starters, before.starters);
  assert.deepEqual(after.order, before.order);
  assert.equal(after.played, before.played);
  assert.equal(after.offers, before.offers);
  assert.equal(after.season, 1999);
  assert.equal(after.phase, 'DRAFT');
  // Opening any save from before the v48 floor runs that existing load migration.
  // It may raise a sub-floor rating. It does not move the player, the contract, or a pick.
  for (let i = 0; i < before.roster.length; i++) {
    assert.equal(after.roster[i][0], before.roster[i][0]);
    assert.ok(after.roster[i][2] >= before.roster[i][2]);
  }
});
