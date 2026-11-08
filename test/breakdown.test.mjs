// Targeted tests for the read-only team breakdown. The published repo has no prior suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamBreakdown, depthAt } from '../src/engine/breakdown.js';
import { teamNeedsDetail, topNeeds } from '../src/engine/offseason.js';
import { dispRating } from '../src/engine/players.js';
import { newLeague } from '../src/engine/league.js';

let pid = 1;
const R = (ovr = 60) => ({ ins: ovr, out: ovr, pas: ovr, han: ovr, reb: ovr, idef: ovr, pdef: ovr, ath: ovr, iq: ovr, sco: ovr, sta: 70, dur: 70, blk: ovr, stl: ovr });
function P(o) {
  return {
    pid: o.pid ?? pid++, name: o.name, age: o.age ?? 27, h: o.h ?? 198, w: 95,
    pos: o.pos, natPos: o.natPos, pos2: o.pos2, tid: o.tid ?? 0,
    ovr: o.ovr ?? 60, pot: o.ovr ?? 60, real: false,
    ratings: o.ratings === undefined ? R(o.ovr ?? 60) : o.ratings,
    contract: o.contract === undefined ? { amt: 2000, exp: 2000 } : o.contract,
    injury: o.injury ?? null, il: !!o.il, adapt: o.adapt, stats: o.stats, tx: o.tx,
  };
}
function team(tid, name) {
  return { tid, abbr: name.slice(0, 3).toUpperCase(), city: name, name, inactive: false, autoRotation: true, rotation: null, conf: tid < 4 ? 'E' : 'W', div: 'D' };
}
function league(players, extra = {}) {
  const n = extra.teams ?? 2;
  return {
    season: extra.season ?? 1997, phase: extra.phase ?? 'REGULAR', userTid: extra.userTid ?? 0,
    teams: Array.from({ length: n }, (_, i) => team(i, 'T' + i)),
    players, schedule: extra.schedule ?? [], settings: {},
  };
}
const textOf = (b) => JSON.stringify({ s: b.strengths, w: b.weaknesses, r: b.results, n: b.needs, p: b.positions });

test('empty and thin rosters stay honest', () => {
  const b = teamBreakdown(league([]), 0);
  assert.equal(b.empty, true);
  assert.equal(b.players, 0);
  assert.equal(b.strengths.length, 0);
  assert.match(b.lineupNote, /No players/);
  assert.equal(b.needs.length, 5);
  assert.ok(b.needs.every(n => /Nobody on the roster is eligible/.test(n.text)));
  const thin = teamBreakdown(league([P({ name: 'A', pos: 'PG' }), P({ name: 'B', pos: 'SG' }), P({ name: 'C', pos: 'C' })]), 0);
  assert.equal(thin.empty, false);
  assert.equal(thin.thin, true);
  assert.equal(thin.healthy, 3);
});

test('missing team does not throw', () => {
  const b = teamBreakdown(league([]), 9);
  assert.equal(b.empty, true);
  assert.match(b.lineupNote, /not found/i);
});

test('need order and scores match the draft sheet', () => {
  const ps = [
    P({ name: 'Point', pos: 'PG', ovr: 80 }),
    P({ name: 'Wing', pos: 'SG', ovr: 75, pos2: ['SF'] }),
    P({ name: 'Big', pos: 'C', ovr: 62, age: 36 }),
    P({ name: 'Four', pos: 'PF', ovr: 70 }),
    P({ name: 'Two', pos: 'SG', ovr: 68 }),
  ];
  const L = league(ps);
  const before = teamNeedsDetail(L, 0).map(n => ({ pos: n.pos, score: n.score, notes: n.notes.join('|') }));
  const b = teamBreakdown(L, 0);
  const after = teamNeedsDetail(L, 0).map(n => ({ pos: n.pos, score: n.score, notes: n.notes.join('|') }));
  assert.deepEqual(before, after);
  assert.deepEqual(b.needs.map(n => n.pos), before.map(n => n.pos));
  assert.deepEqual(b.needs.map(n => n.score), before.map(n => n.score));
  assert.deepEqual(b.needs.slice(0, 2).map(n => n.pos), topNeeds(L, 0));
  assert.ok(b.needs[0].hot && b.needs[1].hot && !b.needs[2].hot);
});

test('secondary position is overall minus 3, and the player can count at two spots', () => {
  const wing = P({ name: 'Combo Guard', pos: 'SG', ovr: 80, pos2: ['PG'] });
  const L = league([wing, P({ name: 'Big', pos: 'C', ovr: 70 }), P({ name: 'F', pos: 'SF', ovr: 70 }), P({ name: 'PF', pos: 'PF', ovr: 70 })]);
  const show = dispRating(80);
  const pg = depthAt(L.players.filter(p => p.tid === 0), 'PG');
  assert.equal(pg[0].p.name, 'Combo Guard');
  assert.equal(pg[0].secondary, true);
  assert.equal(pg[0].fitOvr, show - 3);
  const sg = depthAt(L.players.filter(p => p.tid === 0), 'SG');
  assert.equal(sg[0].listed, true);
  assert.equal(sg[0].fitOvr, show);
  const b = teamBreakdown(L, 0);
  const need = b.needs.find(n => n.pos === 'PG');
  assert.match(need.text, /Combo Guard/);
  assert.match(need.text, /secondary/);
  assert.match(need.text, new RegExp(String(show - 3)));
  assert.ok(b.positions.filter(p => p.eligible > 0 && (p.onFloor?.name === 'Combo Guard' || p.bench.some(c => c.name === 'Combo Guard'))).length >= 2);
});

test('aging and expiring starters are named, not just scored', () => {
  const L = league([
    P({ name: 'Old Center', pos: 'C', ovr: 78, age: 36 }),
    P({ name: 'Exp PG', pos: 'PG', ovr: 76, contract: { amt: 1000, exp: 1997 } }),
    P({ name: 'SG', pos: 'SG', ovr: 74 }), P({ name: 'SF', pos: 'SF', ovr: 74 }), P({ name: 'PF', pos: 'PF', ovr: 74 }),
  ], { season: 1997, phase: 'REGULAR' });
  const b = teamBreakdown(L, 0);
  assert.match(b.needs.find(n => n.pos === 'C').text, /Old Center is 36/);
  assert.match(b.needs.find(n => n.pos === 'C').text, /33 or older/);
  assert.match(b.needs.find(n => n.pos === 'PG').text, /Exp PG is in the last year/);
});

test('injured best player stays in the need, and a healthy player starts', () => {
  const ps = [
    P({ name: 'Star Center', pos: 'C', ovr: 90, injury: { type: 'knee', games: 12 } }),
    P({ name: 'Backup Center', pos: 'C', ovr: 72 }),
    P({ name: 'PG', pos: 'PG', ovr: 75 }), P({ name: 'SG', pos: 'SG', ovr: 75 }),
    P({ name: 'SF', pos: 'SF', ovr: 75 }), P({ name: 'PF', pos: 'PF', ovr: 75 }),
  ];
  const L = league(ps);
  const b = teamBreakdown(L, 0);
  const need = b.needs.find(n => n.pos === 'C');
  assert.equal(need.starter.name, 'Star Center');
  assert.match(need.text, /injured/);
  assert.match(need.text, /12/);
  assert.equal(b.positions.find(p => p.pos === 'C').onFloor.name, 'Backup Center');
  assert.match(b.positions.find(p => p.pos === 'C').plain, /Star Center/);
});

test('injured list is roster context, not tonight’s lineup', () => {
  const L = league([
    P({ name: 'Shelf Center', pos: 'C', ovr: 88, il: true }),
    P({ name: 'Active Center', pos: 'C', ovr: 70 }),
    P({ name: 'PG', pos: 'PG', ovr: 74 }), P({ name: 'SG', pos: 'SG', ovr: 74 }),
    P({ name: 'SF', pos: 'SF', ovr: 74 }), P({ name: 'PF', pos: 'PF', ovr: 74 }),
  ]);
  const b = teamBreakdown(L, 0);
  assert.match(b.needs.find(n => n.pos === 'C').text, /injured list/);
  assert.equal(b.positions.find(p => p.pos === 'C').onFloor.name, 'Active Center');
});

test('manual lineup is the five you set, not the coach’s best five', () => {
  const star = P({ pid: 501, name: 'Bench Star', pos: 'SG', ovr: 95 });
  const starters = ['PG', 'SG', 'SF', 'PF', 'C'].map((pos, i) => P({ pid: 510 + i, name: 'Start ' + pos, pos, ovr: 60 }));
  const L = league([star, ...starters]);
  L.teams[0].autoRotation = false;
  L.teams[0].rotation = { starters: starters.map(p => p.pid), minutes: Object.fromEntries(starters.map(p => [p.pid, 30])), slots: null };
  const b = teamBreakdown(L, 0);
  assert.equal(b.lineup, 'yours');
  const floor = b.positions.map(p => p.onFloor?.pid).filter(Boolean);
  assert.deepEqual(floor.slice().sort(), starters.map(p => p.pid).sort());
  assert.ok(!floor.includes(star.pid));
  assert.match(b.lineupNote, /Reorder/);
});

test('no stats, small samples, and missing fields are not treated as production', () => {
  const bare = teamBreakdown(league([
    P({ name: 'PG', pos: 'PG' }), P({ name: 'SG', pos: 'SG' }), P({ name: 'SF', pos: 'SF' }),
    P({ name: 'PF', pos: 'PF' }), P({ name: 'C', pos: 'C', stats: undefined }),
  ]), 0);
  assert.equal(bare.stat.kind, 'none');
  assert.doesNotMatch(textOf(bare), /\d+\.\d pts/);
  const few = P({ name: 'Hot', pos: 'SG', ovr: 80, stats: { season: 1997, reg: { gp: 4, pts: 80, tpm: 20, tpa: 40 } } });
  const small = teamBreakdown(league([few, P({ name: 'PG', pos: 'PG' }), P({ name: 'SF', pos: 'SF' }), P({ name: 'PF', pos: 'PF' }), P({ name: 'C', pos: 'C' })]), 0);
  assert.equal(small.stat.kind, 'small');
  assert.match(small.stat.text, /too small/);
  const line = small.positions.flatMap(p => [p.onFloor, ...p.bench]).find(c => c?.name === 'Hot')?.line;
  assert.equal(line.small, true);
  assert.match(line.text, /too few/);
  assert.doesNotMatch(line.text, /20\.0/);
  const hole = P({ name: 'Scorer', pos: 'SG', ovr: 78, stats: { season: 1997, reg: { gp: 20, pts: 400, min: 640, ast: 80 } } });
  const partial = teamBreakdown(league([hole, P({ name: 'PG', pos: 'PG' }), P({ name: 'SF', pos: 'SF' }), P({ name: 'PF', pos: 'PF' }), P({ name: 'C', pos: 'C' })]), 0);
  const ln = partial.positions.flatMap(p => [p.onFloor, ...p.bench]).find(c => c?.name === 'Scorer').line.text;
  assert.match(ln, /20\.0 pts/);
  assert.match(ln, /4\.0 ast/);
  assert.doesNotMatch(ln, /reb/);
});

test('offseason lines keep last season’s year and do not pretend it is this year', () => {
  const p = P({ name: 'Vet', pos: 'PG', ovr: 80, stats: { season: 1997, reg: { gp: 70, pts: 1400, orb: 40, drb: 200, ast: 400, min: 2400 } } });
  const L = league([p, P({ name: 'SG', pos: 'SG' }), P({ name: 'SF', pos: 'SF' }), P({ name: 'PF', pos: 'PF' }), P({ name: 'C', pos: 'C' })], { season: 1998, phase: 'SUMMER' });
  const b = teamBreakdown(L, 0);
  assert.equal(b.stat.kind, 'prior');
  assert.match(b.stat.text, /1996-97/);
  assert.match(b.stat.text, /not 1997-98/);
  const line = b.positions.flatMap(x => [x.onFloor, ...x.bench]).find(c => c?.name === 'Vet').line.text;
  assert.match(line, /1996-97/);
  assert.match(line, /20\.0 pts/);
});

test('old saves without shot-blocking or creation grades do not invent them', () => {
  const ratings = { ins: 60, out: 60, pas: 60, han: 60, reb: 60, idef: 60, pdef: 60, ath: 60, iq: 60 };
  const ps = ['PG', 'SG', 'SF', 'PF', 'C'].map(pos => P({ name: pos, pos, ratings }));
  const b = teamBreakdown(league(ps), 0);
  const keys = [...b.strengths, ...b.weaknesses].map(f => f.key);
  assert.ok(!keys.includes('blk') && !keys.includes('stl') && !keys.includes('create'));
  assert.equal(b.stat.kind, 'none');
});

test('a ratings strength and a bad three-point line are both shown, and labeled apart', () => {
  const shoot = (tid, out, pct) => P({
    tid, name: 'S' + tid, pos: 'SG', ovr: out, ratings: { ...R(out), out },
    stats: { season: 1997, reg: { gp: 20, pts: 300, tpm: Math.round(200 * pct), tpa: 200, orb: 20, drb: 60, ast: 40, min: 640 } },
  });
  const ps = [];
  for (let t = 0; t < 8; t++) {
    ps.push(shoot(t, t === 0 ? 90 : 55, t === 0 ? 0.2 : 0.4));
    for (const pos of ['PG', 'SF', 'PF', 'C']) ps.push(P({ tid: t, name: pos + t, pos, ovr: 60 }));
  }
  const b = teamBreakdown(league(ps, { teams: 8, phase: 'REGULAR', season: 1997 }), 0);
  const out = [...b.strengths, ...b.weaknesses].find(f => f.key === 'out');
  assert.ok(out, 'outside shooting should stand out');
  assert.equal(out.basis, 'both');
  assert.match(out.text, /rating, not a season stat/);
  assert.match(out.conflict, /20\.0%/);
  assert.match(out.conflict, /disagree/);
  assert.equal(out.rating.rank, 1);
  assert.equal(out.stat.rank.rank, 8);
});

test('point differential comes from the schedule only', () => {
  const ps = [];
  for (let t = 0; t < 4; t++) for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) ps.push(P({ tid: t, name: pos + t, pos, ovr: 70 }));
  const schedule = [];
  for (let g = 0; g < 16; g++) schedule.push({ h: 0, a: 1, played: true, hs: 110, as: 90 });
  for (let g = 0; g < 12; g++) {
    schedule.push({ h: 2, a: 3, played: true, hs: 100, as: 98 });
    schedule.push({ h: 1, a: 2, played: true, hs: 100, as: 100 });
  }
  const b = teamBreakdown(league(ps, { teams: 4, schedule, phase: 'REGULAR' }), 0);
  const m = b.results.find(r => r.key === 'margin');
  assert.ok(m);
  assert.equal(m.basis, 'stats');
  assert.match(m.text, /results, not a rating/);
  assert.match(m.text, /\+20\.0/);
  assert.equal(m.stat.gp, 16);
});

test('out-of-position penalty is the player-page penalty, separate from the secondary −3', () => {
  const misfit = P({ name: 'Guard Center', pos: 'C', natPos: 'SG', pos2: ['SF'], ovr: 74, adapt: 40, h: 190 });
  const L = league([misfit, P({ name: 'PG', pos: 'PG', ovr: 70 }), P({ name: 'SG', pos: 'SG', ovr: 70 }), P({ name: 'SF', pos: 'SF', ovr: 70 }), P({ name: 'PF', pos: 'PF', ovr: 70 })]);
  const b = teamBreakdown(L, 0);
  const row = b.positions.find(p => p.pos === 'C').bench.find(c => c.name === 'Guard Center') || b.positions.find(p => p.pos === 'C').onFloor;
  assert.equal(row.fit, 'penalty');
  assert.equal(row.penalty, Math.round((100 - 40) / 12));
  assert.match(b.needs.find(n => n.pos === 'C').text, /listed at C/);
  assert.doesNotMatch(b.needs.find(n => n.pos === 'C').text, /three lower/);
});

test('real 1996-97 camp: preseason breakdown matches draft needs and does not invent stats', async () => {
  const start = JSON.parse(readFileSync(new URL('../data/start1996.json', import.meta.url)));
  const L = newLeague({ start, classes: {} }, { seed: 3, userTid: 0, draftClasses: 'generated', gmName: 'Test' });
  const snap = L.players.filter(p => p.tid === 0).map(p => [p.pid, p.ovr, p.pos]);
  const t0 = Date.now();
  const b = teamBreakdown(L, L.userTid);
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, 'breakdown took ' + ms + 'ms');
  assert.equal(b.empty, false);
  assert.equal(b.stat.kind, 'none');
  assert.equal(b.needs.length, 5);
  assert.deepEqual(b.needs.map(n => n.pos).sort(), ['C', 'PF', 'PG', 'SF', 'SG']);
  assert.ok(b.needs.every(n => Number.isFinite(n.score)));
  assert.deepEqual(topNeeds(L, L.userTid), b.needs.slice(0, 2).map(n => n.pos));
  assert.deepEqual(teamNeedsDetail(L, L.userTid).map(n => n.score), b.needs.map(n => n.score));
  assert.doesNotMatch(textOf(b), /\d+\.\d pts/);
  assert.ok(b.strengths.every(f => f.basis === 'ratings'));
  assert.ok(b.weaknesses.every(f => f.basis === 'ratings'));
  const after = L.players.filter(p => p.tid === 0).map(p => [p.pid, p.ovr, p.pos]);
  assert.deepEqual(after, snap);
  assert.ok(b.positions.filter(p => p.onFloor).length >= 1);
});
