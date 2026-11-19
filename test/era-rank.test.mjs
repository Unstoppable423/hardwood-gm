import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newLeague } from '../src/engine/league.js';
import { dispRating, ensureShapes } from '../src/engine/players.js';
import { teamsAt } from '../src/engine/timeline.js';

const start = JSON.parse(readFileSync(new URL('../data/start1996.json', import.meta.url), 'utf8'));
const classes = JSON.parse(readFileSync(new URL('../data/draftclasses.json', import.meta.url), 'utf8'));
const history = JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url), 'utf8'));
const pack = (y) => JSON.parse(readFileSync(new URL(`../data/seasons/${y}.json`, import.meta.url), 'utf8'));

function league(year, extra = {}) {
  return newLeague({ start, classes, history, season: pack(year) }, { seed: 7, startYear: year, userTid: 0, draftClasses: 'generated', injuries: 0, ...extra });
}
const names = (L, n = 10) => L.players.filter(p => p.tid >= 0 && p.real !== false).sort((a, b) => b.ovr - a.ovr).slice(0, n).map(p => p.name);

test('franchise map keeps 1995-96 and follows later moves', () => {
  const y96 = teamsAt(1996).map(t => t.abbr);
  assert.ok(y96.includes('VAN') && y96.includes('SEA') && !y96.includes('MEM'));
  assert.equal(teamsAt(1996).find(t => t.fid === 'WAS').name, 'Bullets');
  const y15 = teamsAt(2015);
  assert.equal(y15.length, 30);
  assert.ok(y15.some(t => t.abbr === 'OKC' && t.city === 'Oklahoma City'));
  assert.ok(y15.some(t => t.abbr === 'NOP'));
  assert.ok(!y15.some(t => t.abbr === 'VAN' || t.abbr === 'SEA' || t.abbr === 'NJN'));
});

test('1960 ranks Wilt with the era and does not invent threes or steals', () => {
  const L = league(1960);
  const top = names(L, 5);
  assert.ok(top.includes('Wilt Chamberlain'), top.join(', '));
  const wilt = L.players.find(p => p.name === 'Wilt Chamberlain');
  assert.equal(wilt.shape?.tshare, undefined);
  assert.equal(wilt.shape?.spg, undefined);
  assert.ok(wilt.shape?.rpg > 20, wilt.shape?.rpg);
  for (const p of L.players) if (p.real !== false && !p.retired) assert.ok(dispRating(p.ovr) >= 70, p.name + ' ' + dispRating(p.ovr));
  const bos = L.teams.find(t => t.abbr === 'BOS');
  assert.ok(L.players.some(p => p.tid === bos.tid && p.name === 'Bill Russell'));
});

test('1975 tracks steals and blocks and still has no three-point share', () => {
  const L = league(1975);
  const kareem = L.players.find(p => p.name === 'Kareem Abdul-Jabbar');
  assert.ok(kareem, names(L, 8).join(', '));
  assert.ok(names(L, 8).includes('Kareem Abdul-Jabbar'));
  assert.equal(kareem.shape?.tshare, undefined);
  assert.ok(kareem.shape?.spg != null && kareem.shape?.bpg != null);
});

test('2005 and 2024 starts use that season’s real ranking and franchises', () => {
  const L = league(2005);
  assert.equal(L.teams.length, 30);
  assert.equal(L.season, 2005);
  const top = names(L, 12);
  for (const n of ['Allen Iverson', 'Kobe Bryant', 'LeBron James']) assert.ok(top.includes(n), top.join(', '));
  const iv = L.players.find(p => p.name === 'Allen Iverson');
  assert.ok(iv.shape.tshare > 0 && iv.shape.tshare < 0.35, iv.shape.tshare);
  assert.ok(iv.shape.mpg > 38, iv.shape.mpg);
  const cle = L.teams.find(t => t.abbr === 'CLE');
  assert.equal(L.players.find(p => p.name === 'LeBron James').tid, cle.tid);
  for (const p of L.players) if (p.real !== false) assert.ok(dispRating(p.ovr) >= 70, p.name);
  const y24 = league(2024);
  const top24 = names(y24, 8);
  assert.ok(top24.includes('Luka Dončić') || top24.includes('Joel Embiid') || top24.includes('Nikola Jokić'), top24.join(', '));
  assert.ok(y24.teams.some(t => t.abbr === 'OKC'));
});

test('loading a profile only adds missing shape fields', () => {
  const L = league(1997);
  const mj = L.players.find(p => p.name === 'Michael Jordan');
  const before = { ovr: mj.ovr, contract: mj.contract.amt, tid: mj.tid, usg: mj.shape.usg };
  delete mj.shape.tshare;
  ensureShapes(L, { start, history, season: pack(1997) });
  assert.equal(mj.ovr, before.ovr);
  assert.equal(mj.contract.amt, before.contract);
  assert.equal(mj.tid, before.tid);
  assert.equal(mj.shape.usg, before.usg);
  assert.ok(mj.shape.tshare > 0 && mj.shape.tshare < 0.2, mj.shape.tshare);
});
