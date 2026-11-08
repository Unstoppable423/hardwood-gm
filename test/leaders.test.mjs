import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { careerBoard, noteStint, franchiseIdOfTeam, startSeasonOf, HISTORICAL_COUNTING_NOTE } from '../src/engine/leaders.js';

const snap = (L) => JSON.stringify(L);

function player(o) {
  return { pid: o.pid, name: o.name, histKey: o.histKey, age: o.age, retired: !!o.retired, tid: o.tid ?? 0, career: o.career || [], stats: o.stats, prior: o.prior };
}

test('sums simulated totals, keeps playoffs separate, and ranks ties', () => {
  const L = {
    season: 1999, histStart: 1998,
    teams: [{ tid: 0, fid: 'LAL', abbr: 'LAL', city: 'Los Angeles', name: 'Lakers' }],
    players: [
      player({ pid: 1, name: 'Ada', career: [{ season: 1998, gp: 10, pts: 100, reb: 20, ast: 10, min: 300, fgm: 40, fga: 80, tpm: 5, tpa: 15, ftm: 15, fta: 20, orb: 4, drb: 16, stl: 3, blk: 2, tov: 7 }] }),
      player({ pid: 2, name: 'Bea', career: [{ season: 1998, gp: 8, pts: 100, reb: 10, ast: 4, min: 200, fgm: 30, fga: 90, tpm: 1, tpa: 4, ftm: 10, fta: 12, orb: 2, drb: 8, stl: 1, blk: 1, tov: 2 }],
        stats: { season: 1999, reg: { gp: 2, pts: 30, min: 40, fgm: 10, fga: 20, tpm: 2, tpa: 6, ftm: 8, fta: 10, orb: 1, drb: 3, ast: 4, stl: 1, blk: 0, tov: 1 }, po: { gp: 3, pts: 50, min: 90, fgm: 20, fga: 40, tpm: 4, tpa: 10, ftm: 6, fta: 8, orb: 2, drb: 5, ast: 7, stl: 2, blk: 1, tov: 3 } } }),
    ],
  };
  const before = snap(L);
  const reg = careerBoard(L, { stat: 'pts', side: 'reg' });
  assert.equal(snap(L), before);
  assert.equal(reg.rows[0].name, 'Bea');
  assert.equal(reg.rows[0].value, 130);
  assert.equal(reg.rows[1].value, 100);
  assert.equal(reg.rows[0].rank, 1);
  const tied = careerBoard({ ...L, players: L.players.map(p => p.pid === 2 ? { ...p, stats: undefined, career: [{ season: 1998, gp: 8, pts: 100, reb: 1, ast: 1, min: 1, fgm: 1, fga: 2, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 1, stl: 0, blk: 0, tov: 0 }] } : p) }, { stat: 'pts' });
  assert.equal(tied.rows[0].rank, 1);
  assert.equal(tied.rows[1].rank, 1);
  assert.equal(tied.rows.length, 2);
  const po = careerBoard(L, { stat: 'pts', side: 'po' });
  assert.equal(po.rows.length, 1);
  assert.equal(po.rows[0].name, 'Bea');
  assert.equal(po.rows[0].value, 50);
  assert.match(po.coverage.historicalNote, /playoff/i);
});

test('franchise totals use stints, not the team on the final career row', () => {
  const L = {
    season: 1999, histStart: 1998,
    teams: [
      { tid: 0, fid: 'LAL', abbr: 'LAL', city: 'Los Angeles', name: 'Lakers' },
      { tid: 1, fid: 'BOS', abbr: 'BOS', city: 'Boston', name: 'Celtics' },
    ],
    players: [player({
      pid: 1, name: 'Cara', tid: 1,
      career: [{
        season: 1998, tid: 1, gp: 10, pts: 100, reb: 10, ast: 4, min: 200, fgm: 40, fga: 80, tpm: 0, tpa: 1, ftm: 20, fta: 20, orb: 2, drb: 8, stl: 1, blk: 1, tov: 2,
        stints: [
          { tid: 0, side: 'reg', gp: 4, pts: 30, reb: 4, ast: 1, min: 80, fgm: 12, fga: 30, tpm: 0, tpa: 1, ftm: 6, fta: 6, orb: 1, drb: 3, stl: 0, blk: 0, tov: 1 },
          { tid: 1, side: 'reg', gp: 6, pts: 70, reb: 6, ast: 3, min: 120, fgm: 28, fga: 50, tpm: 0, tpa: 0, ftm: 14, fta: 14, orb: 1, drb: 5, stl: 1, blk: 1, tov: 1 },
        ],
      }],
    })],
  };
  const nba = careerBoard(L, { stat: 'pts', scope: 'nba' });
  assert.equal(nba.rows[0].value, 100);
  const lal = careerBoard(L, { stat: 'pts', scope: 'LAL' });
  const bos = careerBoard(L, { stat: 'pts', scope: 'BOS' });
  assert.equal(lal.rows[0].value, 30);
  assert.equal(bos.rows[0].value, 70);
  const noSplit = careerBoard({
    ...L,
    players: [player({ pid: 1, name: 'Cara', career: [{ season: 1998, tid: 1, gp: 10, pts: 100, reb: 10, ast: 4, min: 1, fgm: 1, fga: 2, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 1, drb: 9, stl: 0, blk: 0, tov: 0 }] })],
  }, { stat: 'pts', scope: 'BOS' });
  assert.equal(noSplit.rows.length, 0);
  assert.equal(noSplit.coverage.simulatedSeasonsWithoutTeamSplit, 1);
});

test('recorded games stop at the save start and two-team lines are not split', () => {
  const history = {
    source: 'test source',
    players: [
      { k: 'old|1970', n: 'Old Player', s: { 1979: ['LAL', 'LAL', 80, 30, 20, 5, 4, 0.5, 1, 1, 0], 1985: ['LAL', 'LAL', 82, 30, 22, 5, 4, 0.5, 1, 1, 0] } },
      { k: 'est|1970', n: 'Estimated', s: { 1978: ['BOS', 'BOS', 70, 20, 10, 4, 2, 0.5, 1, 1, 2] } },
      { k: 'two|1970', n: 'Traded', s: { 1977: ['BOS', 'NYK', 60, 20, 10, 4, 2, 0.5, 1, 1, 0] } },
    ],
  };
  const L = { season: 1980, histStart: 1980, teams: [{ tid: 0, fid: 'LAL', abbr: 'LAL', city: 'Los Angeles', name: 'Lakers' }, { tid: 1, fid: 'BOS', abbr: 'BOS', city: 'Boston', name: 'Celtics' }], players: [] };
  const gp = careerBoard(L, { history, stat: 'gp', side: 'reg' });
  const old = gp.rows.find(r => r.name === 'Old Player');
  assert.equal(old.value, 80);
  assert.equal(old.recorded, 80);
  assert.equal(gp.rows.find(r => r.name === 'Estimated'), undefined);
  const traded = gp.rows.find(r => r.name === 'Traded');
  assert.equal(traded.value, 60);
  const lal = careerBoard(L, { history, stat: 'gp', scope: 'LAL' });
  assert.equal(lal.rows.find(r => r.name === 'Old Player').value, 80);
  assert.equal(lal.rows.find(r => r.name === 'Traded'), undefined);
  const bos = careerBoard(L, { history, stat: 'gp', scope: 'BOS' });
  assert.equal(bos.rows.find(r => r.name === 'Traded'), undefined);
  const pts = careerBoard(L, { history, stat: 'pts' });
  assert.equal(pts.rows.length, 0);
  assert.equal(pts.coverage.historicalCounting, 'unavailable');
  assert.match(pts.coverage.historicalNote, /era-normalized/);
  assert.equal(HISTORICAL_COUNTING_NOTE.length > 40, true);
});

test('a live player does not gain the real career from after the save start, and prior estimates are ignored', () => {
  const history = {
    players: [{ k: 'mj|1984', n: 'Michael Jordan', s: {
      1984: ['CHI', 'CHI', 10, 30, 20, 5, 4, 0.5, 1, 1, 0],
      1997: ['CHI', 'CHI', 82, 37, 29, 6, 4, 0.55, 1, 1, 0],
    } }],
  };
  const L = {
    season: 1986, histStart: 1985,
    teams: [{ tid: 0, fid: 'CHI', abbr: 'CHI', city: 'Chicago', name: 'Bulls' }],
    players: [player({ pid: 7, name: 'Michael Jordan', histKey: 'mj|1984', prior: { pts: 999999, reb: 999999, ast: 999999 }, career: [{ season: 1985, gp: 82, pts: 2000, reb: 400, ast: 300, min: 2800, fgm: 800, fga: 1600, tpm: 10, tpa: 40, ftm: 400, fta: 500, orb: 80, drb: 320, stl: 100, blk: 40, tov: 150, stints: [{ tid: 0, side: 'reg', gp: 82, pts: 2000, reb: 400, ast: 300, min: 2800, fgm: 800, fga: 1600, tpm: 10, tpa: 40, ftm: 400, fta: 500, orb: 80, drb: 320, stl: 100, blk: 40, tov: 150 }] }] })],
  };
  const gp = careerBoard(L, { history, stat: 'gp' });
  assert.equal(gp.rows[0].recorded, 10);
  assert.equal(gp.rows[0].simulated, 82);
  assert.equal(gp.rows[0].value, 92);
  const pts = careerBoard(L, { history, stat: 'pts' });
  assert.equal(pts.rows[0].value, 2000);
  const before = snap(L);
  careerBoard(L, { history, stat: 'pts', scope: 'CHI' });
  assert.equal(snap(L), before);
});

test('old saves keep missing shooting off the list instead of as zero, and retired players stay', () => {
  const L = {
    season: 2000,
    teams: [{ tid: 0, fid: 'CHI', abbr: 'CHI', city: 'Chicago', name: 'Bulls' }],
    players: [
      player({ pid: 1, name: 'Old Save', retired: true, career: [{ season: 1998, gp: 10, pts: 40, reb: 8, ast: 6, stl: 1, blk: 1 }] }),
      player({ pid: 2, name: 'Full', career: [{ season: 1998, gp: 10, pts: 20, reb: 4, ast: 2, min: 100, fgm: 8, fga: 120, tpm: 1, tpa: 4, ftm: 3, fta: 4, orb: 1, drb: 3, stl: 1, blk: 0, tov: 2, stints: [{ tid: 0, side: 'reg', gp: 10, pts: 20, reb: 4, ast: 2, min: 100, fgm: 8, fga: 120, tpm: 1, tpa: 4, ftm: 3, fta: 4, orb: 1, drb: 3, stl: 1, blk: 0, tov: 2 }] }] }),
    ],
  };
  const before = snap(L);
  const pts = careerBoard(L, { stat: 'pts' });
  assert.equal(pts.rows.find(r => r.name === 'Old Save').value, 40);
  assert.equal(pts.rows.find(r => r.name === 'Old Save').retired, true);
  const fgm = careerBoard(L, { stat: 'fgm' });
  assert.equal(fgm.rows.some(r => r.name === 'Old Save'), false);
  assert.equal(fgm.rows[0].name, 'Full');
  assert.equal(fgm.rows[0].value, 8);
  assert.ok(fgm.coverage.playersLeftOffThisStat >= 1);
  const fg = careerBoard(L, { stat: 'fg' });
  assert.equal(fg.rows.length, 1);
  assert.equal(fg.rows[0].value, 8 / 120);
  assert.equal(snap(L), before);
});

test('duplicate season rows and a current line for that same season are counted once', () => {
  const L = {
    season: 1998,
    teams: [{ tid: 0, fid: 'NYK', abbr: 'NYK', city: 'New York', name: 'Knicks' }],
    players: [player({
      pid: 3, name: 'Dup',
      career: [
        { season: 1998, gp: 5, pts: 11, reb: 1, ast: 1, min: 10, fgm: 4, fga: 9, tpm: 0, tpa: 1, ftm: 3, fta: 4, orb: 0, drb: 1, stl: 0, blk: 0, tov: 1 },
        { season: 1998, gp: 5, pts: 11, reb: 1, ast: 1, min: 10, fgm: 4, fga: 9, tpm: 0, tpa: 1, ftm: 3, fta: 4, orb: 0, drb: 1, stl: 0, blk: 0, tov: 1 },
      ],
      stats: { season: 1998, reg: { gp: 5, pts: 11, min: 10, fgm: 4, fga: 9, tpm: 0, tpa: 1, ftm: 3, fta: 4, orb: 0, drb: 1, ast: 1, stl: 0, blk: 0, tov: 1 } },
    })],
  };
  assert.equal(careerBoard(L, { stat: 'pts' }).rows[0].value, 11);
});

test('a 1997 player with no history key still keeps his recorded games on one row', () => {
  const history = { players: [{ k: 'robertparish|1976', n: 'Robert Parish', by: 1953, s: { 1990: ['BOS', 'BOS', 80, 30, 15, 10, 2, 0.55, 1, 1, 0] } }] };
  const L = {
    season: 1997,
    teams: [{ tid: 0, fid: 'BOS', abbr: 'BOS', city: 'Boston', name: 'Celtics' }],
    players: [player({ pid: 4, name: 'Robert Parish', age: 43, career: [{ season: 1997, gp: 5, pts: 40, reb: 20, ast: 4, min: 100, fgm: 16, fga: 30, tpm: 0, tpa: 1, ftm: 8, fta: 10, orb: 6, drb: 14, stl: 1, blk: 2, tov: 3, stints: [{ tid: 0, side: 'reg', gp: 5, pts: 40, reb: 20, ast: 4, min: 100, fgm: 16, fga: 30, tpm: 0, tpa: 1, ftm: 8, fta: 10, orb: 6, drb: 14, stl: 1, blk: 2, tov: 3 }] }] })],
  };
  const gp = careerBoard(L, { history, stat: 'gp' });
  assert.equal(gp.rows.length, 1);
  assert.equal(gp.rows[0].pid, 4);
  assert.equal(gp.rows[0].recorded, 80);
  assert.equal(gp.rows[0].value, 85);
});

test('two people who share a history key are not added into one career', () => {
  const history = { players: [
    { k: 'eddiejohnson|1981', n: 'Eddie Johnson', by: 1955, s: { 1980: ['ATL', 'ATL', 80, 20, 10, 3, 2, 0.5, 1, 1, 0] } },
    { k: 'eddiejohnson|1981', n: 'Eddie Johnson', by: 1959, s: { 1982: ['KC', 'KC', 70, 20, 12, 2, 3, 0.5, 1, 1, 0] } },
  ] };
  const L = {
    season: 1997,
    teams: [{ tid: 0, fid: 'ATL', abbr: 'ATL', city: 'Atlanta', name: 'Hawks' }],
    players: [player({ pid: 9, name: 'Eddie Johnson', histKey: 'eddiejohnson|1981', age: 38, career: [{ season: 1997, gp: 10, pts: 40, reb: 4, ast: 8, min: 200, fgm: 12, fga: 30, tpm: 1, tpa: 3, ftm: 5, fta: 6, orb: 1, drb: 3, stl: 2, blk: 0, tov: 3, stints: [{ tid: 0, side: 'reg', gp: 10, pts: 40, reb: 4, ast: 8, min: 200, fgm: 12, fga: 30, tpm: 1, tpa: 3, ftm: 5, fta: 6, orb: 1, drb: 3, stl: 2, blk: 0, tov: 3 }] }] })],
  };
  const gp = careerBoard(L, { history, stat: 'gp' });
  const rows = gp.rows.filter(r => r.name === 'Eddie Johnson');
  assert.equal(rows.length, 2);
  const live = rows.find(r => r.pid === 9);
  assert.equal(live.recorded, 70);
  assert.equal(live.value, 80);
  const other = rows.find(r => r.pid == null);
  assert.equal(other.value, 80);
});

test('stint notes follow the team that played the game, and a relocation keeps the franchise id', () => {
  const stats = { reg: { gp: 0 }, stints: [] };
  noteStint(stats, 'reg', 0, { min: 20, pts: 15, fgm: 6, fga: 12, gs: 1 });
  noteStint(stats, 'reg', 1, { min: 18, pts: 9, fgm: 3, fga: 8 });
  noteStint(stats, 'po', 1, { min: 30, pts: 22, fgm: 8, fga: 16 });
  assert.equal(stats.stints.length, 3);
  assert.equal(stats.stints.find(s => s.tid === 0 && s.side === 'reg').pts, 15);
  assert.equal(stats.stints.find(s => s.tid === 1 && s.side === 'reg').gp, 1);
  assert.equal(stats.stints.find(s => s.side === 'po').pts, 22);
  const moved = { tid: 4, abbr: 'MEM', city: 'Memphis', name: 'Grizzlies', names: [{ abbr: 'VAN', city: 'Vancouver', name: 'Grizzlies' }] };
  assert.equal(franchiseIdOfTeam(moved), 'VAN');
  assert.equal(startSeasonOf({ season: 2004, history: [{ season: 1998 }], players: [{ career: [{ season: 1997 }] }] }), 1997);
});

const tinySeasons = {
  trackedFrom: { reb: 1951, stl: 1974, tpm: 1980, tpa: 1980 },
  source: 'fixture',
  players: [
    ['Michael Jordan', 1963, 2, 'jordami01', [
      [1985, 'CHI', [82, 2400, 2313, 800, 1600, 9, 20, 630, 700, 100, 300, 400, 400, 150, 30, 100], [4, 100, 117, 40, 80, 1, 2, 20, 25, 5, 15, 20, 20, 8, 2, 10]],
      [1997, 'CHI', [82, 3106, 2431, 920, 1892, 111, 297, 480, 576, 113, 369, 482, 352, 140, 44, 166], [19, 800, 590, 200, 400, 13, 40, 123, 150, 30, 90, 120, 91, 30, 5, 40]],
    ]],
    ['Joe Fulks', 1921, 10, 'fulksjo01', [
      [1947, 'GSW', [60, null, 1389, 475, 1557, null, null, 439, 601, null, null, null, 25, null, null, null], null],
    ]],
    ['Split Guy', 1950, 1, 'split01', [
      [1980, 'BOS', [40, 1000, 400, 150, 300, 10, 30, 90, 100, 20, 80, 100, 50, 20, 5, 30], null],
      [1980, 'NYK', [30, 800, 250, 100, 200, 5, 15, 40, 50, 10, 40, 50, 20, 10, 2, 15], null],
    ]],
  ],
};
const emptyLeague = (season) => ({ season, teams: [{ tid: 0, fid: 'CHI', abbr: 'CHI', city: 'Chicago', name: 'Bulls' }, { tid: 1, fid: 'BOS', abbr: 'BOS', city: 'Boston', name: 'Celtics' }, { tid: 2, fid: 'NYK', abbr: 'NYK', city: 'New York', name: 'Knicks' }], players: [] });

test('season totals stop at the save start, split stints, and do not treat untracked stats as zero', () => {
  const before = snap(tinySeasons);
  const pts97 = careerBoard(emptyLeague(1997), { seasons: tinySeasons, stat: 'pts' });
  assert.equal(pts97.rows.find(r => r.name === 'Michael Jordan').value, 2313);
  const pts98 = careerBoard(emptyLeague(1998), { seasons: tinySeasons, stat: 'pts' });
  assert.equal(pts98.rows.find(r => r.name === 'Michael Jordan').value, 2313 + 2431);
  const po97 = careerBoard(emptyLeague(1997), { seasons: tinySeasons, stat: 'pts', side: 'po' });
  assert.equal(po97.rows.find(r => r.name === 'Michael Jordan').value, 117);
  const po98 = careerBoard(emptyLeague(1998), { seasons: tinySeasons, stat: 'pts', side: 'po' });
  assert.equal(po98.rows.find(r => r.name === 'Michael Jordan').value, 117 + 590);
  assert.equal(careerBoard(emptyLeague(1985), { seasons: tinySeasons, stat: 'pts' }).rows.find(r => r.name === 'Michael Jordan'), undefined);
  const fulks = careerBoard(emptyLeague(1948), { seasons: tinySeasons, stat: 'pts' });
  assert.equal(fulks.rows.find(r => r.name === 'Joe Fulks').value, 1389);
  assert.equal(careerBoard(emptyLeague(1948), { seasons: tinySeasons, stat: 'reb' }).rows.find(r => r.name === 'Joe Fulks'), undefined);
  assert.equal(careerBoard(emptyLeague(1948), { seasons: tinySeasons, stat: 'tpm' }).rows.find(r => r.name === 'Joe Fulks'), undefined);
  const nba = careerBoard(emptyLeague(1981), { seasons: tinySeasons, stat: 'pts' });
  assert.equal(nba.rows.find(r => r.name === 'Split Guy').value, 650);
  assert.equal(careerBoard(emptyLeague(1981), { seasons: tinySeasons, stat: 'pts', scope: 'BOS' }).rows.find(r => r.name === 'Split Guy').value, 400);
  assert.equal(careerBoard(emptyLeague(1981), { seasons: tinySeasons, stat: 'pts', scope: 'NYK' }).rows.find(r => r.name === 'Split Guy').value, 250);
  const live = careerBoard({
    season: 1997,
    teams: emptyLeague(1997).teams,
    players: [player({ pid: 8, name: 'Michael Jordan', age: 34, career: [{ season: 1997, gp: 2, pts: 50, reb: 6, ast: 8, min: 70, fgm: 20, fga: 40, tpm: 2, tpa: 5, ftm: 8, fta: 10, orb: 2, drb: 4, stl: 3, blk: 1, tov: 4, stints: [{ tid: 0, side: 'reg', gp: 2, pts: 50, reb: 6, ast: 8, min: 70, fgm: 20, fga: 40, tpm: 2, tpa: 5, ftm: 8, fta: 10, orb: 2, drb: 4, stl: 3, blk: 1, tov: 4 }] }] })],
  }, { seasons: tinySeasons, stat: 'pts' });
  const mj = live.rows.find(r => r.name === 'Michael Jordan');
  assert.equal(mj.pid, 8);
  assert.equal(mj.recorded, 2313);
  assert.equal(mj.simulated, 50);
  assert.equal(mj.value, 2363);
  assert.equal(snap(tinySeasons), before);
});

test('the shipped season file matches published totals and every cutoff stays inside completed seasons', () => {
  const seasons = JSON.parse(readFileSync(new URL('../data/season-totals.json', import.meta.url)));
  const idx = Object.fromEntries(seasons.keys.map((k, i) => [k, i]));
  const sum = (start, key, fid, side = 2) => {
    let n = 0;
    for (const p of seasons.players) for (const ln of p[4]) {
      if (ln[0] >= start) continue;
      if (fid && ln[1] !== fid) continue;
      const arr = side === 3 ? ln[3] : ln[2];
      if (!arr || arr[idx[key]] == null) continue;
      n += arr[idx[key]];
    }
    return n;
  };
  const board = (start, stat, scope = 'nba', side = 'reg') => careerBoard({
    season: start,
    teams: [
      { tid: 0, fid: 'LAL', abbr: 'LAL', city: 'Los Angeles', name: 'Lakers' },
      { tid: 1, fid: 'CHI', abbr: 'CHI', city: 'Chicago', name: 'Bulls' },
      { tid: 2, fid: 'GSW', abbr: 'GSW', city: 'Golden State', name: 'Warriors' },
    ],
    players: [],
  }, { seasons, startSeason: start, stat, scope, side });
  const kareem = board(1997, 'pts').rows.find(r => r.name === 'Kareem Abdul-Jabbar');
  assert.equal(kareem.value, 38387);
  const jordan97 = board(1997, 'pts').rows.find(r => r.name === 'Michael Jordan').value;
  const jordan98 = board(1998, 'pts').rows.find(r => r.name === 'Michael Jordan').value;
  assert.equal(jordan98 - jordan97, 2431);
  assert.equal(board(1985, 'pts').rows.find(r => r.name === 'Michael Jordan'), undefined);
  const wilt = seasons.players.find(p => p[3] === 'chambwi01');
  const wilt62 = wilt[4].find(ln => ln[0] === 1962);
  assert.equal(wilt62[2][idx.pts], 4029);
  assert.equal(board(1963, 'pts').rows.find(r => r.name === 'Wilt Chamberlain').value - board(1962, 'pts').rows.find(r => r.name === 'Wilt Chamberlain').value, 4029);
  const fulks = seasons.players.find(p => p[3] === 'fulksjo01');
  assert.equal(fulks[4].find(ln => ln[0] === 1947)[2][idx.reb], null);
  assert.equal(fulks[4].find(ln => ln[0] === 1947)[2][idx.tpm], null);
  assert.equal(board(1974, 'stl').rows.length, 0);
  assert.ok(board(1975, 'stl').rows[0].value > 0);
  assert.equal(board(1980, 'tpm').rows.length, 0);
  assert.ok(board(1981, 'tpm').rows[0].value > 0);
  for (const start of [1948, 1960, 1974, 1980, 1990, 1997]) {
    const listed = board(start, 'pts').rows.reduce((a, r) => a + r.value, 0);
    assert.equal(listed, sum(start, 'pts'));
    const lakers = board(start, 'pts', 'LAL').rows.reduce((a, r) => a + r.value, 0);
    assert.equal(lakers, sum(start, 'pts', 'LAL'));
    const ftm = board(start, 'ftm').rows.reduce((a, r) => a + r.value, 0);
    assert.equal(ftm, sum(start, 'ftm'));
    assert.equal(board(start, 'stl').rows.some(r => r.value === 0), false);
  }
  const po = board(1998, 'pts', 'nba', 'po').rows.find(r => r.name === 'Michael Jordan').value;
  const poPrev = board(1997, 'pts', 'nba', 'po').rows.find(r => r.name === 'Michael Jordan').value;
  assert.equal(po - poPrev, 590);
});

test('the shipped history file is per-game, so a 1980 cutoff does not import Jordan\'s later points', () => {
  const history = JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url)));
  const mj = history.players.find(p => p.n === 'Michael Jordan');
  assert.ok(mj.s['1997'][4] < 80, 'stored points are a per-game rate, not a season total');
  const L = { season: 1980, histStart: 1980, teams: [{ tid: 0, fid: 'CHI', abbr: 'CHI', city: 'Chicago', name: 'Bulls' }], players: [] };
  const pts = careerBoard(L, { history, stat: 'pts' });
  assert.equal(pts.rows.find(r => r.name === 'Michael Jordan'), undefined);
  const gp = careerBoard(L, { history, stat: 'gp', scope: 'CHI' });
  assert.equal(gp.rows.find(r => r.name === 'Michael Jordan'), undefined);
});
