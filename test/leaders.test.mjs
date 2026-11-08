import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { careerBoard, recordSaveGame, franchiseIdOfTeam, SAVE_LEADERS_NOTE } from '../src/engine/leaders.js';
import { newLeague } from '../src/engine/league.js';

const line = (pts, extra = {}) => ({ min: 20, pts, fgm: 4, fga: 8, tpm: 1, tpa: 2, ftm: 2, fta: 2, orb: 1, drb: 3, ast: 2, stl: 1, blk: 1, tov: 1, ...extra });
function P(o = {}) {
  return { pid: o.pid ?? 1, name: o.name || 'Ada', tid: o.tid ?? 0, age: 24, retired: !!o.retired, prior: o.prior, career: o.career || [], stats: o.stats || { season: 1998, reg: { gp: 0, pts: 0, min: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0 }, po: { gp: 0, pts: 0, min: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0 } }, ledger: o.ledger };
}
function league(players, extra = {}) {
  return { season: extra.season ?? 1998, teams: extra.teams || [{ tid: 0, fid: 'LAL', abbr: 'LAL', city: 'Los Angeles', name: 'Lakers' }, { tid: 1, fid: 'BOS', abbr: 'BOS', city: 'Boston', name: 'Celtics' }], players };
}
const snap = (L) => JSON.stringify(L);

test('a new game at several start years begins at zero and ignores real career estimates', () => {
  const start = JSON.parse(readFileSync(new URL('../data/start1996.json', import.meta.url)));
  const history = JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url)));
  for (const year of [1997, 1980, 1955]) {
    const data = year < 1997 ? { start, history, classes: {} } : { start, classes: {} };
    const L = newLeague(data, { seed: 3, startYear: year, userTid: 0, draftClasses: 'generated' });
    assert.ok(L.players.some(p => (p.prior?.pts || 0) > 0));
    const board = careerBoard(L, { stat: 'pts' });
    assert.equal(board.rows.length, 0);
    assert.equal(board.coverage.note, SAVE_LEADERS_NOTE);
    assert.equal(board.coverage.title, 'Save career leaders');
  }
});

test('games add to the save total, playoffs stay separate, and ties share a rank', () => {
  const p = P();
  recordSaveGame(p, 'reg', 0, line(10), 'LAL');
  recordSaveGame(p, 'reg', 0, line(15), 'LAL');
  recordSaveGame(p, 'po', 0, line(22), 'LAL');
  const L = league([p, P({ pid: 2, name: 'Bea' })]);
  recordSaveGame(L.players[1], 'reg', 0, line(25), 'LAL');
  const reg = careerBoard(L, { stat: 'pts' });
  assert.equal(reg.rows.find(r => r.name === 'Ada').value, 25);
  assert.equal(reg.rows.find(r => r.name === 'Bea').value, 25);
  assert.equal(reg.rows[0].rank, 1);
  assert.equal(reg.rows[1].rank, 1);
  const po = careerBoard(L, { stat: 'pts', side: 'po' });
  assert.equal(po.rows.length, 1);
  assert.equal(po.rows[0].value, 22);
  const ft = careerBoard(L, { stat: 'ftm' });
  assert.equal(ft.rows.find(r => r.name === 'Ada').value, 4);
  const fg = careerBoard(L, { stat: 'fg' });
  assert.equal(fg.rows.length, 0);
});

test('a trade counts each franchise only for the games played there', () => {
  const p = P();
  recordSaveGame(p, 'reg', 0, line(30), 'LAL');
  recordSaveGame(p, 'reg', 1, line(10), 'BOS');
  const L = league([p]);
  assert.equal(careerBoard(L, { stat: 'pts' }).rows[0].value, 40);
  assert.equal(careerBoard(L, { stat: 'pts', scope: 'LAL' }).rows[0].value, 30);
  assert.equal(careerBoard(L, { stat: 'pts', scope: 'BOS' }).rows[0].value, 10);
  assert.equal(franchiseIdOfTeam({ abbr: 'MEM', names: [{ abbr: 'VAN' }] }), 'VAN');
});

test('season rollover and a second load do not count the archived season twice', () => {
  const p = P({ stats: { season: 1998, reg: { gp: 0, pts: 0, min: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0 }, po: {} } });
  recordSaveGame(p, 'reg', 0, line(12), 'LAL');
  recordSaveGame(p, 'reg', 0, line(8), 'LAL');
  p.career.push({ season: 1998, gp: 2, pts: 20, min: 40, fgm: 8, fga: 16, tpm: 2, tpa: 4, ftm: 4, fta: 4, orb: 2, drb: 6, reb: 8, ast: 4, stl: 2, blk: 2, tov: 2, stints: p.stats.stints.map(s => ({ ...s })) });
  p.stats = { season: 1999, reg: { gp: 0, pts: 0, min: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0 }, po: {} };
  const again = JSON.parse(JSON.stringify(p));
  const L = league([again]);
  assert.equal(careerBoard(L, { stat: 'pts' }).rows[0].value, 20);
  recordSaveGame(again, 'reg', 0, line(5), 'LAL');
  const reloaded = JSON.parse(JSON.stringify(again));
  assert.equal(careerBoard(league([reloaded]), { stat: 'pts' }).rows[0].value, 25);
});

test('retirement keeps the total, a generated player counts, and viewing changes nothing', () => {
  const star = P({ pid: 4, name: 'Star', retired: true });
  recordSaveGame(star, 'reg', 0, line(40), 'LAL');
  const gen = P({ pid: 5, name: 'Generated' });
  recordSaveGame(gen, 'reg', 1, line(7), 'BOS');
  const L = league([star, gen]);
  const before = snap(L);
  const board = careerBoard(L, { stat: 'pts' });
  assert.equal(snap(L), before);
  assert.equal(board.rows.find(r => r.name === 'Star').retired, true);
  assert.equal(board.rows.find(r => r.name === 'Star').value, 40);
  assert.equal(board.rows.find(r => r.name === 'Generated').value, 7);
});

test('an older save keeps stored season totals and does not invent a franchise split or a missing stat', () => {
  const p = P({
    pid: 9, name: 'Old', prior: { pts: 50000 },
    career: [{ season: 1998, gp: 10, pts: 100, reb: 20, ast: 15, stl: 4, blk: 2, min: 200, po: { gp: 4, pts: 40, reb: 8, ast: 6 } }],
    stats: { season: 1999, reg: { gp: 3, pts: 21, min: 60, fgm: 8, fga: 18, tpm: 1, tpa: 3, ftm: 4, fta: 5, orb: 2, drb: 5, ast: 4, stl: 1, blk: 0, tov: 2 }, po: { gp: 0 } },
  });
  const L = league([p]);
  const before = snap(L);
  const pts = careerBoard(L, { stat: 'pts' });
  assert.equal(pts.rows[0].value, 121);
  const po = careerBoard(L, { stat: 'pts', side: 'po' });
  assert.equal(po.rows[0].value, 40);
  const ftmPo = careerBoard(L, { stat: 'ftm', side: 'po' });
  assert.equal(ftmPo.rows.length, 0);
  assert.match(ftmPo.coverage.legacyNote, /older playoff seasons/i);
  const lal = careerBoard(L, { stat: 'pts', scope: 'LAL' });
  assert.equal(lal.rows.length, 0);
  assert.match(lal.coverage.legacyNote, /no franchise split/);
  assert.equal(snap(L), before);
  recordSaveGame(p, 'reg', 0, line(9), 'LAL');
  assert.equal(careerBoard(league([p]), { stat: 'pts' }).rows[0].value, 130);
  assert.equal(careerBoard(league([p]), { stat: 'pts', scope: 'LAL' }).rows[0].value, 9);
});
