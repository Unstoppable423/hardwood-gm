import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newLeague, simDays, seasonDone } from '../src/engine/league.js';
import { advance } from '../src/engine/offseason.js';
import { setSeed } from '../src/engine/rng.js';

const start = JSON.parse(readFileSync(new URL('../data/start1996.json', import.meta.url), 'utf8'));
const classes = JSON.parse(readFileSync(new URL('../data/draftclasses.json', import.meta.url), 'utf8'));

function season(seed) {
  setSeed(seed);
  const L = newLeague({ start, classes }, { seed, gmName: 'Sim', userTid: 0, injuries: 1 });
  const adv = advance(L);
  assert.equal(adv.ok, true, adv.error);
  let guard = 0;
  while (!seasonDone(L) && guard++ < 400) simDays(L, 25);
  assert.equal(seasonDone(L), true);
  return L;
}
function line(L, name) {
  const p = L.players.find(x => x.name === name);
  const s = p.stats.reg;
  const g = s.gp || 1;
  return { p, gp: s.gp, mpg: s.min / g, ppg: s.pts / g, rpg: (s.orb + s.drb) / g, apg: s.ast / g, tpm: s.tpm / g };
}

test('a 1996-97 season keeps real shapes: boards, assists, threes, minutes, and the 70 floor', () => {
  const L = season(11);
  const mj = line(L, 'Michael Jordan');
  const rod = line(L, 'Dennis Rodman');
  const stock = line(L, 'John Stockton');
  const reg = line(L, 'Reggie Miller');
  assert.ok(mj.gp >= 30 && rod.gp >= 15 && stock.gp >= 40, [mj.gp, rod.gp, stock.gp]);
  assert.ok(mj.ppg > 22 && mj.ppg < 36, mj.ppg);
  assert.ok(mj.rpg < 8, mj.rpg);
  assert.ok(mj.tpm < 3.5, mj.tpm);
  assert.ok(mj.apg < 6.5, mj.apg);
  assert.ok(rod.rpg > 11 && rod.rpg > mj.rpg + 5, rod.rpg);
  assert.ok(stock.apg > 7.5 && stock.apg > mj.apg + 3, stock.apg);
  assert.ok(reg.tpm > 1, reg.tpm);
  assert.ok(mj.p.ovr >= 70 && rod.p.ovr >= 70 && stock.p.ovr >= 70);
  assert.ok(mj.p.shape && mj.p.shape.usg > 0.25);
  let maxMin = 0, pts = 0, games = 0;
  const wins = [];
  for (const t of L.teams) {
    let w = 0;
    for (const g of L.schedule) if (g.played && (g.h === t.tid || g.a === t.tid)) {
      const home = g.h === t.tid;
      if (home ? g.hs > g.as : g.as > g.hs) w++;
      if (home) { pts += g.hs + g.as; games++; }
    }
    wins.push(w);
  }
  for (const p of L.players) {
    const s = p.stats?.reg;
    if (s?.gp >= 20) maxMin = Math.max(maxMin, s.min / s.gp);
  }
  wins.sort((a, b) => b - a);
  assert.ok(maxMin < 42, maxMin);
  assert.ok(mj.mpg >= 32 && mj.mpg <= 40, mj.mpg);
  const teamPpg = pts / games / 2;
  assert.ok(teamPpg > 88 && teamPpg < 108, teamPpg);
  assert.ok(wins[0] >= 55 && wins[0] <= 75, wins[0]);
  assert.ok(wins.at(-1) >= 8 && wins.at(-1) <= 30, wins.at(-1));
});
