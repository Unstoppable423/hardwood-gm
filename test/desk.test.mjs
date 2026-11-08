import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineBoard, scoutReport, STYLE_COMPS } from '../src/engine/desk.js';
import { dispRating } from '../src/engine/players.js';

let n = 1;
const ratings = (o) => ({ ins: 60, out: 60, pas: 60, han: 60, reb: 60, idef: 60, pdef: 60, ath: 60, iq: 60, ...o });
function P(o) {
  return { pid: o.pid ?? n++, name: o.name, age: o.age ?? 26, pos: o.pos || 'SG', tid: o.tid ?? 0, ovr: o.ovr ?? 60, pot: o.pot ?? o.ovr ?? 60, il: false, ratings: o.ratings === undefined ? ratings({ out: o.ovr ?? 60 }) : o.ratings, contract: { amt: 2000, exp: 2001 }, real: o.real };
}
function league(players, extra = {}) {
  const nt = extra.n ?? Math.max(2, ...players.map(p => p.tid + 1));
  return {
    season: 1998, phase: extra.phase ?? 'REGULAR', day: extra.day ?? 30, userTid: 0,
    settings: { difficulty: 'Medium', capMode: 'soft', playoffTeams: extra.playoffTeams ?? 2, morale: extra.morale !== false, tradeDeadline: extra.tradeDeadline, careers: extra.careers || 'real' },
    teams: Array.from({ length: nt }, (_, i) => ({ tid: i, abbr: 'T' + i, city: 'C' + i, name: 'N' + i, conf: i % 2 ? 'W' : 'E', div: 'D', inactive: false })),
    players, picks: [], schedule: extra.schedule ?? [], deadMoney: [], tradeDeadline: extra.deadline ?? 80,
  };
}
const snap = (L) => JSON.stringify(L.players.map(p => [p.pid, p.tid, p.ovr, p.pot, p.ratings && { ...p.ratings }]));

test('deadline uses the stored date and closes after it', () => {
  const L = league([P({ tid: 0, name: 'A' }), P({ tid: 1, name: 'B' })], { day: 40, deadline: 80 });
  const open = deadlineBoard(L);
  assert.equal(open.open, true);
  assert.equal(open.past, false);
  assert.equal(open.daysLeft, 40);
  assert.match(open.note, /Deadline/);
  L.day = 81;
  const shut = deadlineBoard(L);
  assert.equal(shut.open, false);
  assert.equal(shut.past, true);
  assert.equal(shut.opportunities.length, 0);
  assert.match(shut.note, /closed/);
});

test('playoffs and a missing date are labeled, not invented', () => {
  const L = league([P({ tid: 0, name: 'A' }), P({ tid: 1, name: 'B' })], { phase: 'PLAYOFFS' });
  assert.match(deadlineBoard(L).note, /playoffs/);
  const old = league([P({ tid: 0, name: 'A' }), P({ tid: 1, name: 'B' })]);
  old.tradeDeadline = undefined;
  const b = deadlineBoard(old);
  assert.match(b.note, /No deadline date is stored/);
  assert.equal(b.dateText, null);
});

test('a bad record is a seller even with morale off, and viewing changes nothing', () => {
  const players = [];
  for (let t = 0; t < 4; t++) players.push(P({ tid: t, name: 'P' + t, ovr: 70, pos: t === 1 ? 'C' : 'SG' }));
  players.push(P({ tid: 1, name: 'Spare', pid: 50, pos: 'C', ovr: 78 }));
  players.push(P({ tid: 1, name: 'Backup', pid: 51, pos: 'C', ovr: 74 }));
  const schedule = [];
  for (let g = 0; g < 20; g++) {
    schedule.push({ h: 0, a: 2, played: true, hs: 100, as: 90 });
    schedule.push({ h: 3, a: 1, played: true, hs: 110, as: 80 });
  }
  const L = league(players, { n: 4, schedule, playoffTeams: 2, morale: false, day: 20, deadline: 90 });
  const before = snap(L);
  const b = deadlineBoard(L);
  assert.equal(snap(L), before);
  assert.doesNotMatch(JSON.stringify(b), /morale|mood/i);
  const mixed = b.teams.find(t => t.tid === 1);
  assert.equal(mixed.side, 'mixed');
  assert.match(mixed.why, /disagree/);
  const big = [];
  for (let t = 0; t < 24; t++) big.push(P({ tid: t, name: 'F' + t, ovr: t === 1 ? 50 : 80, pos: 'SG' }));
  big.push(P({ tid: 1, name: 'Center', pid: 80, pos: 'C', ovr: 76 }));
  big.push(P({ tid: 1, name: 'Forward', pid: 82, pos: 'PF', ovr: 73 }));
  const sched = [];
  for (let g = 0; g < 16; g++) sched.push({ h: 0, a: 1, played: true, hs: 110, as: 90 });
  const L2 = league(big, { n: 24, schedule: sched, playoffTeams: 16, morale: false, day: 20, deadline: 90 });
  const before2 = snap(L2);
  const b2 = deadlineBoard(L2);
  assert.equal(snap(L2), before2);
  assert.equal(b2.teams.find(t => t.tid === 1).side, 'seller');
  assert.ok(b2.opportunities.length >= 1);
  assert.match(b2.opportunities[0].why, /not an offer|not that team/);
  assert.ok(b2.opportunities.every(o => o.pid !== 80));
});

test('a shooter matches Miller in 1997 and not a player from the future', () => {
  const p = P({ name: 'Shooter', pos: 'SG', ovr: 70, pot: 78, ratings: ratings({ out: 92, iq: 80, han: 68, ath: 66, ins: 58, pas: 62, pdef: 64, reb: 52, idef: 46 }) });
  const before = p.pot;
  const r = scoutReport(p, { draftYear: 1997, careers: 'random' });
  assert.equal(p.pot, before);
  assert.equal(r.comparison?.name, 'Reggie Miller');
  assert.ok(r.comparison.firstSeason < 1997);
  assert.ok(!STYLE_COMPS.some(a => a.name === 'LeBron James'));
  assert.match(r.lines.join(' '), /Stylistic likeness, not a career projection/);
  assert.match(r.lines.join(' '), /not a scout quote/);
  const early = scoutReport(p, { draftYear: 1986 });
  assert.notEqual(early.comparison?.name, 'Reggie Miller');
  assert.notEqual(early.comparison?.name, "Shaquille O'Neal");
});

test('missing grades, a missing draft year, and hidden ratings stay honest', () => {
  const bare = scoutReport({ name: 'X', pos: 'PG', ovr: 60, pot: 70, ratings: null }, { draftYear: 1997 });
  assert.match(bare.lines.join(' '), /not on file/);
  assert.equal(bare.comparison, null);
  const nodraft = scoutReport(P({ name: 'Y', pos: 'C', ratings: ratings({ ins: 90, reb: 88, idef: 90, ath: 80, iq: 70 }) }), { draftYear: null });
  assert.equal(nodraft.comparison, null);
  assert.match(nodraft.lines.join(' '), /Draft year is not on file/);
  const hid = scoutReport(P({ name: 'Z', pos: 'PG', ovr: 88, pot: 94, ratings: ratings({ pas: 95 }) }), { draftYear: 1997, hidden: true });
  assert.equal(hid.strengths.length, 0);
  assert.equal(hid.comparison, null);
  assert.doesNotMatch(hid.lines.join(' '), /\d/);
});

test('real-career sentence does not rewrite potential', () => {
  const p = P({ name: 'Real', pos: 'PF', ovr: 64, pot: 80, real: true, ratings: ratings({ ins: 86, reb: 84, ath: 80, out: 60, idef: 70 }) });
  const pot = p.pot;
  const r = scoutReport(p, { draftYear: 1997, careers: 'real' });
  assert.equal(p.pot, pot);
  assert.equal(dispRating(p.pot), dispRating(pot));
  assert.match(r.lines.join(' '), /does not change that number/);
});
