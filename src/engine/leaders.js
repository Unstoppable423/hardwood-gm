// All-time counting totals. Regular season and playoffs stay separate.
// Historical points and shooting are not invented from the era-normalized per-game lines in history.json.
import { FRANCHISES } from './timeline.js';

export const LEADER_STATS = [
  { id: 'gp', label: 'Games', kind: 'count' },
  { id: 'min', label: 'Minutes', kind: 'count' },
  { id: 'pts', label: 'Points', kind: 'count' },
  { id: 'fgm', label: 'FGM', kind: 'count' },
  { id: 'fga', label: 'FGA', kind: 'count' },
  { id: 'tpm', label: '3PM', kind: 'count' },
  { id: 'tpa', label: '3PA', kind: 'count' },
  { id: 'ftm', label: 'FTM', kind: 'count' },
  { id: 'fta', label: 'FTA', kind: 'count' },
  { id: 'orb', label: 'OREB', kind: 'count' },
  { id: 'drb', label: 'DREB', kind: 'count' },
  { id: 'reb', label: 'REB', kind: 'count' },
  { id: 'ast', label: 'Assists', kind: 'count' },
  { id: 'stl', label: 'Steals', kind: 'count' },
  { id: 'blk', label: 'Blocks', kind: 'count' },
  { id: 'tov', label: 'Turnovers', kind: 'count' },
  { id: 'fg', label: 'FG%', kind: 'rate', make: 'fgm', att: 'fga', minAtt: 100 },
  { id: 'tp', label: '3P%', kind: 'rate', make: 'tpm', att: 'tpa', minAtt: 50 },
  { id: 'ft', label: 'FT%', kind: 'rate', make: 'ftm', att: 'fta', minAtt: 50 },
];

export const HISTORICAL_COUNTING_NOTE = 'The bundled history file stores era-normalized per-game rates, not counting totals. Points, rebounds, assists, steals, blocks, minutes, and shooting makes and attempts from before this save are not added. Games from seasons the file marks as estimated are left out. A line that names two teams is counted once in the NBA games total and is not given to either franchise.';
export const PLAYOFF_HISTORY_NOTE = 'No historical playoff counting totals are in the file. Simulated playoff archives keep games, points, rebounds, and assists. Other playoff totals exist only for seasons whose box lines were stored.';
export const SIM_NOTE = 'Simulated totals are the sum of counting stats from games this save has played. They are not mixed into one regular-season-plus-playoffs number.';

const COUNT_KEYS = ['gp', 'min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'reb', 'ast', 'stl', 'blk', 'tov'];
const ABBR_FID = new Map();
for (const f of FRANCHISES) for (const g of f.segs) if (!ABBR_FID.has(g.abbr)) ABBR_FID.set(g.abbr, f.id);

export function statDef(id) { return LEADER_STATS.find(s => s.id === id) || LEADER_STATS[2]; }

export function franchiseIdOfTeam(t) {
  if (!t) return null;
  if (t.fid && FRANCHISES.some(f => f.id === t.fid)) return t.fid;
  if (ABBR_FID.has(t.abbr)) return ABBR_FID.get(t.abbr);
  for (const n of t.names || []) if (n?.abbr && ABBR_FID.has(n.abbr)) return ABBR_FID.get(n.abbr);
  return t.fid || (t.tid != null ? 'tid:' + t.tid : t.abbr || null);
}

export function startSeasonOf(L) {
  if (L?.histStart) return L.histStart;
  const seasons = [];
  for (const p of L?.players || []) for (const c of p.career || []) if (c?.season) seasons.push(c.season);
  for (const h of L?.history || []) if (h?.season) seasons.push(h.season);
  if (L?.season) seasons.push(L.season);
  return seasons.length ? Math.min(...seasons) : null;
}

function blankSums() {
  const sum = {};
  for (const k of COUNT_KEYS) sum[k] = 0;
  return { sum, unknown: new Set(), franchises: new Map(), simSeasons: 0 };
}

function addCounts(into, src, keys) {
  for (const k of keys) {
    if (src[k] == null || Number.isNaN(+src[k])) into.unknown.add(k);
    else into.sum[k] += +src[k];
  }
}

function regFromSeason(c) {
  const o = {};
  for (const k of COUNT_KEYS) {
    if (k === 'reb') {
      if (c.reb != null) o.reb = +c.reb;
      else if (c.orb != null && c.drb != null) o.reb = +c.orb + +c.drb;
      continue;
    }
    if (c[k] != null) o[k] = +c[k];
  }
  return o;
}

function regFromLive(s) {
  if (!s) return null;
  const o = regFromSeason(s);
  if (s.orb != null && s.drb != null) o.reb = +s.orb + +s.drb;
  return o;
}

function poFromArchive(po) {
  if (!po || !(+po.gp > 0)) return null;
  const o = {};
  for (const k of ['gp', 'pts', 'reb', 'ast']) if (po[k] != null) o[k] = +po[k];
  for (const k of COUNT_KEYS) if (po[k] != null) o[k] = +po[k];
  return o;
}

export function noteStint(stats, side, tid, line) {
  if (!stats || tid == null || +tid < 0 || !line) return;
  const list = stats.stints ||= [];
  const tidN = +tid;
  const which = side === 'po' ? 'po' : 'reg';
  let s = list.find(x => x.tid === tidN && x.side === which);
  if (!s) {
    s = { tid: tidN, side: which, gp: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 };
    list.push(s);
  }
  if (+line.min > 0) s.gp += 1;
  if (line.gs) s.gs += +line.gs;
  for (const k of ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm']) {
    if (line[k]) s[k] += +line[k];
  }
}

export function stintsForArchive(stats) {
  if (!stats?.stints?.length) return undefined;
  return stats.stints.map(s => ({ ...s }));
}

function teamByFid(L) {
  const map = new Map();
  for (const t of L?.teams || []) {
    const id = franchiseIdOfTeam(t);
    if (id && !map.has(id)) map.set(id, t);
  }
  return map;
}

function labelFor(fid, teams) {
  const t = teams.get(fid);
  if (t) return { label: `${t.city} ${t.name}`, abbr: t.abbr, tid: t.tid };
  const f = FRANCHISES.find(x => x.id === fid);
  const g = f ? f.segs[f.segs.length - 1] : null;
  if (g) return { label: `${g.city} ${g.name}`, abbr: g.abbr, tid: null };
  return { label: String(fid), abbr: String(fid), tid: null };
}

export function franchiseChoices(L, history, startSeason) {
  const teams = teamByFid(L);
  const ids = new Set(teams.keys());
  for (const hp of history?.players || []) {
    for (const [y, v] of Object.entries(hp.s || {})) {
      if (+y >= startSeason) continue;
      if (v[10]) continue;
      if (v[0] && v[0] === v[1]) ids.add(v[0]);
    }
  }
  const rows = [...ids].map(id => ({ id, ...labelFor(id, teams) }));
  rows.sort((a, b) => (a.tid == null) - (b.tid == null) || a.label.localeCompare(b.label));
  return rows;
}

function bumpFranchise(row, fid, src) {
  if (!fid) return;
  let bag = row.byFid.get(fid);
  if (!bag) { bag = blankSums(); row.byFid.set(fid, bag); }
  addCounts(bag, src, COUNT_KEYS);
}

function histId(hp) { return hp.k + '|' + (hp.by ?? 'x'); }

function historyIdFor(p, history, season) {
  const people = history?.players || [];
  if (p.histKey) {
    const cands = people.filter(hp => hp.k === p.histKey);
    if (cands.length === 1) return histId(cands[0]);
    if (cands.length > 1 && season != null && p.age != null) {
      const by = season - p.age;
      const hit = cands.find(hp => hp.by != null && Math.abs(hp.by - by) <= 1);
      if (hit) return histId(hit);
    }
    return 'pid:' + p.pid;
  }
  if (season != null && p.age != null && p.name) {
    const by = season - p.age;
    const cands = people.filter(hp => hp.n === p.name && hp.by != null && Math.abs(hp.by - by) <= 1);
    if (cands.length === 1) return histId(cands[0]);
  }
  return 'pid:' + p.pid;
}

function ensure(map, id, name, pid) {
  let row = map.get(id);
  if (!row) {
    row = { id, name, pid: pid ?? null, nba: blankSums(), byFid: new Map(), recordedNba: 0, recordedFid: new Map(), retired: false };
    map.set(id, row);
  }
  if (pid != null) row.pid = pid;
  if (name && !row.name) row.name = name;
  return row;
}

function applyStints(row, stints, side, fidOfTid) {
  const mine = (stints || []).filter(s => (s.side || 'reg') === side && +s.gp > 0);
  if (!mine.length) return false;
  for (const s of mine) {
    const src = regFromSeason({ ...s, reb: s.reb != null ? s.reb : (s.orb != null && s.drb != null ? +s.orb + +s.drb : null) });
    const fid = fidOfTid(s.tid);
    if (fid) bumpFranchise(row, fid, src);
  }
  return true;
}

export function careerBoard(L, opts = {}) {
  const side = opts.side === 'po' ? 'po' : 'reg';
  const def = statDef(opts.stat);
  const history = opts.history || null;
  const startSeason = opts.startSeason ?? startSeasonOf(L);
  const scope = opts.scope && opts.scope !== 'nba' ? opts.scope : 'nba';
  const teams = teamByFid(L);
  const fidOfTid = (tid) => franchiseIdOfTeam((L?.teams || [])[tid]);
  const people = new Map();
  let unsplitSeasons = 0;
  let seasonsMissingStat = 0;

  for (const p of L?.players || []) {
    const row = ensure(people, historyIdFor(p, history, startSeason), p.name, p.pid);
    if (p.retired) row.retired = true;
    const seen = new Set();
    for (const c of p.career || []) {
      if (!c || seen.has(c.season)) continue;
      seen.add(c.season);
      if (side === 'reg') {
        const src = regFromSeason(c);
        if (!(+src.gp > 0)) continue;
        addCounts(row.nba, src, COUNT_KEYS);
        row.nba.simSeasons += 1;
        const split = applyStints(row, c.stints, 'reg', fidOfTid);
        if (!split) unsplitSeasons += 1;
      } else {
        const src = poFromArchive(c.po);
        const poStints = (c.stints || []).filter(s => s.side === 'po' && +s.gp > 0);
        const fromStints = poStints.length ? poStints.reduce((a, s) => {
          const one = regFromSeason({ ...s, reb: s.reb != null ? s.reb : (s.orb != null && s.drb != null ? +s.orb + +s.drb : null) });
          for (const k of COUNT_KEYS) if (one[k] != null) a[k] = (a[k] || 0) + one[k];
          return a;
        }, {}) : null;
        const use = fromStints ? { ...(src || {}), ...fromStints } : src;
        if (!use || !(+use.gp > 0)) continue;
        addCounts(row.nba, use, COUNT_KEYS);
        row.nba.simSeasons += 1;
        if (!applyStints(row, c.stints, 'po', fidOfTid)) unsplitSeasons += 1;
      }
    }
    const liveSeason = p.stats?.season;
    if (liveSeason && !seen.has(liveSeason)) {
      const live = side === 'po' ? regFromLive(p.stats.po) : regFromLive(p.stats.reg);
      if (live && +live.gp > 0) {
        addCounts(row.nba, live, COUNT_KEYS);
        row.nba.simSeasons += 1;
        if (!applyStints(row, p.stats.stints, side, fidOfTid)) unsplitSeasons += 1;
      }
    }
  }

  let recordedGames = 0;
  let omittedEstimated = 0;
  let omittedTwoTeam = 0;
  let twoTeamGames = 0;
  if (side === 'reg' && history?.players && startSeason != null) {
    for (const hp of history.players) {
      let nbaGp = 0;
      const fidGp = new Map();
      for (const [y, v] of Object.entries(hp.s || {})) {
        if (+y >= startSeason) continue;
        const est = v[10] || 0;
        const gp = +v[2] || 0;
        if (!gp) continue;
        if (est) { omittedEstimated += 1; continue; }
        const a = v[0], b = v[1];
        nbaGp += gp;
        recordedGames += gp;
        if (a && a === b) fidGp.set(a, (fidGp.get(a) || 0) + gp);
        else { omittedTwoTeam += 1; twoTeamGames += gp; }
      }
      if (!nbaGp) continue;
      const row = ensure(people, histId(hp), hp.n, null);
      row.recordedNba += nbaGp;
      for (const [fid, gp] of fidGp) row.recordedFid.set(fid, (row.recordedFid.get(fid) || 0) + gp);
    }
  }

  const rows = [];
  for (const row of people.values()) {
    const bag = scope === 'nba' ? row.nba : row.byFid.get(scope);
    const recorded = scope === 'nba' ? row.recordedNba : (row.recordedFid.get(scope) || 0);
    const simulatedKnown = bag && !bag.unknown.has(def.kind === 'rate' ? def.make : def.id) && !bag.unknown.has(def.kind === 'rate' ? def.att : def.id);
    if (bag && def.kind === 'count' && bag.unknown.has(def.id)) seasonsMissingStat += 1;
    let value = null;
    let simulated = null;
    let partial = false;
    if (def.kind === 'rate') {
      if (!simulatedKnown) continue;
      const att = bag.sum[def.att];
      const make = bag.sum[def.make];
      if (!(att >= def.minAtt)) continue;
      value = make / att;
      simulated = value;
    } else if (def.id === 'gp') {
      simulated = simulatedKnown ? bag.sum.gp : (bag && bag.unknown.has('gp') ? null : 0);
      if (bag && bag.unknown.has('gp')) partial = true;
      const rec = side === 'reg' ? recorded : 0;
      if (partial) continue;
      value = (simulated || 0) + rec;
      if (!(value > 0)) continue;
    } else {
      if (!simulatedKnown) { partial = true; continue; }
      simulated = bag ? bag.sum[def.id] : 0;
      value = simulated;
      if (!(value > 0)) continue;
    }
    const where = scope === 'nba' ? null : labelFor(scope, teams);
    rows.push({
      id: row.id,
      pid: row.pid,
      name: row.name,
      retired: row.retired,
      value,
      simulated,
      recorded: def.id === 'gp' && side === 'reg' ? recorded : null,
      tid: where?.tid ?? null,
      team: where?.label || '',
      abbr: where?.abbr || '',
    });
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (prev == null || r.value !== prev) rank = i + 1;
    r.rank = rank;
    prev = r.value;
  });

  const rate = def.kind === 'rate';
  const coverage = {
    stat: def.id,
    label: def.label,
    side,
    scope,
    startSeason,
    simulatedNote: SIM_NOTE,
    historicalCounting: def.id === 'gp' && side === 'reg' ? 'games-only' : 'unavailable',
    historicalNote: side === 'po' ? PLAYOFF_HISTORY_NOTE : HISTORICAL_COUNTING_NOTE,
    recordedGames: side === 'reg' ? recordedGames : 0,
    omittedEstimatedSeasons: side === 'reg' ? omittedEstimated : 0,
    unsplitFranchiseSeasons: omittedTwoTeam,
    unsplitFranchiseGames: twoTeamGames,
    simulatedSeasonsWithoutTeamSplit: unsplitSeasons,
    playersLeftOffThisStat: seasonsMissingStat,
    rateMin: rate ? def.minAtt : null,
    rateNote: rate ? `${def.label} is makes divided by attempts in this save, and only players with at least ${def.minAtt} attempts are listed. It is not an average of season percentages.` : '',
    source: history?.source || 'data/history.json was not loaded, so recorded games before this save are omitted.',
  };
  return { rows, coverage, franchises: franchiseChoices(L, history, startSeason) };
}
