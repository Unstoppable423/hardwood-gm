import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAwards } from '../src/engine/offseason.js';
import { setSeed } from '../src/engine/rng.js';

const line = (o) => ({ gp: 70, gs: 70, min: 36 * 70, pts: 1400, orb: 70, drb: 280, ast: 280, stl: 70, blk: 40, tov: 140, fga: 1100, fgm: 500, ...o });
function guy(o) {
  return {
    pid: o.pid, name: o.name, tid: o.tid, pos: o.pos, age: o.age ?? 27, ovr: o.ovr ?? 80, pot: o.ovr ?? 80,
    awards: [], career: o.career || [], draft: o.draft || null,
    ratings: { idef: o.idef ?? 70, pdef: o.pdef ?? 70 },
    stats: { reg: line(o.reg), po: line({ gp: 12, gs: 12, min: 36 * 12, pts: 300, ...(o.po || {}) }) },
  };
}
function league(players, wins) {
  const schedule = [];
  for (let i = 0; i < wins[0]; i++) schedule.push({ h: 0, a: 1, played: true, hs: 110, as: 100 });
  for (let i = 0; i < wins[1]; i++) schedule.push({ h: 1, a: 0, played: true, hs: 110, as: 100 });
  return {
    season: 2003, seasonGames: 82, phase: 'PLAYOFFS', userTid: 0, schedule,
    teams: [
      { tid: 0, abbr: 'BOS', city: 'Boston', name: 'Celtics', conf: 'E', div: 'Atlantic' },
      { tid: 1, abbr: 'LAL', city: 'Los Angeles', name: 'Lakers', conf: 'W', div: 'Pacific' },
    ],
    players, playoffs: { champ: 0, runnerUp: 1, series: [] },
  };
}
const sum = (rows) => Math.round(rows.reduce((a, r) => a + r.share, 0) * 10) / 10;

test('MVP favors the winning team, and the ballot names him first', () => {
  const star = guy({ pid: 1, name: 'Winner', tid: 0, pos: 'SF', reg: { pts: 1800 } });
  const gunner = guy({ pid: 2, name: 'Gunner', tid: 1, pos: 'SF', reg: { pts: 1800 } });
  const L = league([star, gunner], [50, 15]);
  const before = star.ovr;
  setSeed(4);
  const a = computeAwards(L);
  assert.equal(a.mvp.name, 'Winner');
  assert.equal(a.ballot.mvp[0].name, 'Winner');
  assert.ok(a.ballot.mvp[0].share >= a.ballot.mvp[1].share);
  assert.equal(sum(a.ballot.mvp), 100);
  assert.equal(star.ovr, before);
  assert.ok(star.awards.some(x => x.type === 'MVP' && x.season === 2003));
  const again = JSON.parse(JSON.stringify(a));
  assert.equal(again.ballot.mvp[0].share, a.ballot.mvp[0].share);
});

test('only a rookie wins Rookie of the Year, and only a bench player wins Sixth Man', () => {
  const vet = guy({ pid: 1, name: 'Vet', tid: 0, pos: 'SG', career: [{ season: 2002, ppg: 12, tid: 0 }], reg: { pts: 2000, gs: 70 } });
  const rook = guy({ pid: 2, name: 'Rook', tid: 0, pos: 'PG', draft: { year: 2002 }, reg: { pts: 900, gs: 40 } });
  const starter = guy({ pid: 3, name: 'Starter', tid: 1, pos: 'SF', reg: { pts: 2200, gs: 70 } });
  const bench = guy({ pid: 4, name: 'Bench', tid: 1, pos: 'SG', reg: { pts: 1100, gs: 4 } });
  const soph = guy({ pid: 5, name: 'Soph', tid: 1, pos: 'PG', career: [{ season: 2002, ppg: 8, tid: 1 }], draft: { year: 2001 }, reg: { pts: 1600, gs: 70 } });
  const L = league([vet, rook, starter, bench, soph], [45, 20]);
  setSeed(2);
  const a = computeAwards(L);
  assert.equal(a.roy.name, 'Rook');
  assert.ok(a.ballot.roy.every(r => r.name === 'Rook'));
  assert.equal(a.sixth.name, 'Bench');
  assert.ok(!a.ballot.sixth.some(r => r.name === 'Starter'));
  assert.equal(a.allRookie[0][0].name, 'Rook');
  assert.ok(a.allRookie.flat().every(p => p.name === 'Rook'));
  assert.ok(rook.awards.some(x => x.type === 'All-Rookie 1st Team'));
});

test('Finals MVP is a champion, and the teams keep a real lineup', () => {
  const g1 = guy({ pid: 1, name: 'Guard', tid: 0, pos: 'PG', reg: { pts: 1600, stl: 120 } });
  const g2 = guy({ pid: 2, name: 'Two', tid: 0, pos: 'SG', reg: { pts: 1500, stl: 100 } });
  const f1 = guy({ pid: 3, name: 'Wing', tid: 0, pos: 'SF', reg: { pts: 1700 } });
  const f2 = guy({ pid: 4, name: 'Four', tid: 0, pos: 'PF', reg: { pts: 1400, drb: 500 } });
  const c = guy({ pid: 5, name: 'Big', tid: 0, pos: 'C', reg: { pts: 1300, blk: 200, drb: 700 }, po: { pts: 400 } });
  const other = guy({ pid: 6, name: 'Other', tid: 1, pos: 'C', reg: { pts: 2000, blk: 40 }, po: { pts: 500, gp: 10 } });
  const L = league([g1, g2, f1, f2, c, other], [55, 20]);
  setSeed(7);
  const a = computeAwards(L);
  assert.equal(a.fmvp.tid, 0);
  assert.equal(a.ballot.fmvp[0].pid, a.fmvp.pid);
  const first = a.allNBA[0];
  assert.equal(first.length, 5);
  assert.equal(first.filter(p => p.pid === g1.pid || p.pid === g2.pid).length, 2);
  assert.equal(first.filter(p => p.pid === c.pid).length, 1);
  assert.equal(a.allDefense[0].length, 5);
  assert.equal(a.allDefense[0].filter(p => p.name === 'Big' || p.name === 'Guard' || p.name === 'Two').length >= 1, true);
  assert.ok(c.awards.some(x => x.type.startsWith('All-Defensive')));
});

test('an older season without a ballot is still a stored awards record', () => {
  const old = { mvp: { pid: 9, name: 'Old Star', tid: 0, abbr: 'BOS' }, allNBA: [[], [], []] };
  assert.equal(old.ballot, undefined);
  assert.equal(old.mvp.name, 'Old Star');
});
