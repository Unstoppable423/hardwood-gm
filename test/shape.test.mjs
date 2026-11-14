import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureShapes } from '../src/engine/players.js';

const start = JSON.parse(readFileSync(new URL('../data/start1996.json', import.meta.url), 'utf8'));

function player(o) {
  return {
    pid: o.pid, name: o.name, tid: o.tid ?? 0, ovr: o.ovr ?? 80, pos: 'SG',
    contract: { amt: 5000, exp: 2000 },
    stats: { reg: { gp: 10, pts: 100 } },
    awards: [{ season: 1998, type: 'MVP' }],
    shape: o.shape,
    real: o.real !== false,
  };
}

test('loading a save adds a real profile and does not touch the rest of the player', () => {
  const jordan = player({ pid: 1, name: 'Michael Jordan', ovr: 98 });
  const kept = player({ pid: 2, name: 'Someone Else', ovr: 77, shape: { usg: 0.2, astp: 0.2, drb: 0.1, orb: 0.05, rpg: 9 } });
  const fictional = player({ pid: 3, name: 'Not A Real Player', ovr: 64, real: false });
  const before = JSON.stringify({ jordan, kept, fictional });
  const L = {
    season: 2001, histStart: null, userTid: 0, picks: [], teams: [{ tid: 0, abbr: 'CHI' }],
    players: [jordan, kept, fictional], news: [], transactions: [],
  };
  const n = ensureShapes(L, { start });
  assert.equal(n, 1);
  assert.ok(jordan.shape.usg > 0.3);
  assert.ok(jordan.shape.astp > 0.15 && jordan.shape.astp < 0.3);
  assert.equal(jordan.shape.rpg, 5.9);
  assert.equal(jordan.ovr, 98);
  assert.equal(jordan.contract.amt, 5000);
  assert.equal(jordan.stats.reg.pts, 100);
  assert.equal(jordan.awards[0].type, 'MVP');
  assert.equal(jordan.tid, 0);
  assert.equal(kept.shape.rpg, 9);
  assert.equal(fictional.shape, undefined);
  ensureShapes(L, { start });
  assert.equal(jordan.shape.usg > 0.3, true);
  const snap = JSON.parse(before);
  assert.equal(snap.jordan.ovr, 98);
  assert.equal(snap.jordan.stats.reg.pts, 100);
  assert.equal(snap.kept.shape.rpg, 9);
});

test('a historic save uses that season\'s line, not the 1996 box score', () => {
  const hp = { n: 'Sample Guard', k: 'sample|1988', by: 1964, bm: 1, h: 190, pos: 'PG', s: {
    1988: ['BOS', 'BOS', 80, 36, 20, 4, 8, 0.55, 1.5, 0.2, 0],
    1996: ['BOS', 'BOS', 70, 30, 10, 3, 5, 0.52, 1, 0.2, 0],
  } };
  const p = player({ pid: 8, name: 'Sample Guard' });
  p.arcKey = 'sample|1988';
  const L = { season: 1990, histStart: 1988, players: [p], teams: [], picks: [] };
  const n = ensureShapes(L, { history: { players: [hp] }, start });
  assert.equal(n, 1);
  assert.ok(p.shape.usg > 0.2, p.shape.usg);
  assert.ok(p.shape.astp > 0.25, p.shape.astp);
  assert.equal(p.ovr, 80);
});
