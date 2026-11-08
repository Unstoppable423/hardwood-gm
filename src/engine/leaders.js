// Save career leaders. Totals start at zero in the chosen season and count only
// games this save plays. Real-life history is not added.
import { FRANCHISES } from './timeline.js';

export const SAVE_LEADERS_TITLE = 'Save career leaders';
export const SAVE_LEADERS_NOTE = 'Recorded in this save only—no real-life historical totals.';

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

const COUNT_KEYS = ['gp', 'min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'reb', 'ast', 'stl', 'blk', 'tov'];
const ABBR_FID = new Map();
for (const f of FRANCHISES) for (const g of f.segs) if (!ABBR_FID.has(g.abbr)) ABBR_FID.set(g.abbr, f.id);

export function statDef(id) { return LEADER_STATS.find(s => s.id === id) || LEADER_STATS.find(s => s.id === 'pts'); }

export function franchiseIdOfTeam(t) {
  if (!t) return null;
  if (t.fid && FRANCHISES.some(f => f.id === t.fid)) return t.fid;
  if (ABBR_FID.has(t.abbr)) return ABBR_FID.get(t.abbr);
  for (const n of t.names || []) if (n?.abbr && ABBR_FID.has(n.abbr)) return ABBR_FID.get(n.abbr);
  return t.fid || (t.tid != null ? 'tid:' + t.tid : t.abbr || null);
}

function emptySide() { return { nba: {}, fid: {} }; }
function emptyLedger() { return { covered: {}, partial: {}, reg: emptySide(), po: emptySide() }; }

function addObj(dst, src) {
  if (!src) return;
  for (const k of COUNT_KEYS) if (src[k] != null && !Number.isNaN(+src[k])) dst[k] = (dst[k] || 0) + +src[k];
}
function fidBag(side, fid) { return side.fid[fid] ||= {}; }

function fromStats(s) {
  if (!s) return null;
  const o = {};
  for (const k of COUNT_KEYS) if (k !== 'reb' && s[k] != null) o[k] = +s[k];
  if (s.reb != null) o.reb = +s.reb;
  else if (s.orb != null && s.drb != null) o.reb = +s.orb + +s.drb;
  return o;
}
function fromLine(line) {
  const o = fromStats(line) || {};
  if (+line.min > 0) o.gp = (o.gp || 0) + 1;
  else delete o.gp;
  if (line.orb != null || line.drb != null) o.reb = (+line.orb || 0) + (+line.drb || 0);
  return o;
}
function fromStint(s) {
  const o = fromStats(s) || {};
  if (s.orb != null || s.drb != null) o.reb = s.reb != null ? +s.reb : (+s.orb || 0) + (+s.drb || 0);
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

// Called when a game is recorded. Seeds any stats already stored for this season
// once, then adds this game. Later reads use the ledger, so clearing boxes or
// career rows does not erase the running total.
export function recordSaveGame(p, side, teamTid, line, fid) {
  if (!p || !line) return;
  const which = side === 'po' ? 'po' : 'reg';
  const led = p.ledger ||= emptyLedger();
  const tag = String(p.stats?.season ?? '') + ':' + which;
  led.covered ||= {};
  led.partial ||= {};
  if (!led.covered[tag]) {
    const src = fromStats(p.stats?.[which]);
    if (src && (+src.gp > 0 || +src.min > 0 || +src.pts > 0)) {
      addObj(led[which].nba, src);
      const stints = (p.stats?.stints || []).filter(s => (s.side || 'reg') === which && (+s.gp > 0 || +s.min > 0));
      if (stints.length) {
        for (const s of stints) {
          const id = fidForTid(p, s.tid) || null;
          if (id) addObj(fidBag(led[which], id), fromStint(s));
        }
      } else led.partial[tag] = 'no-franchise-split';
    }
    led.covered[tag] = true;
  }
  const row = fromLine(line);
  addObj(led[which].nba, row);
  if (fid) addObj(fidBag(led[which], fid), row);
  if (p.stats) noteStint(p.stats, which, teamTid, line);
}

function fidForTid(p, tid) { return p._fidOfTid ? p._fidOfTid(tid) : null; }

function blankPlayer() {
  return { nba: emptyCount(), fid: new Map(), unknown: new Set(), unsplit: 0 };
}
function emptyCount() {
  const o = {};
  for (const k of COUNT_KEYS) o[k] = 0;
  return o;
}
function pour(into, src, keys) {
  if (!src) return;
  for (const k of keys) {
    if (src[k] == null || Number.isNaN(+src[k])) into.unknown.add(k);
    else into.nba[k] += +src[k];
  }
}
function pourFid(into, fid, src) {
  if (!fid || !src) return;
  let bag = into.fid.get(fid);
  if (!bag) { bag = emptyCount(); into.fid.set(fid, bag); }
  for (const k of COUNT_KEYS) if (src[k] != null) bag[k] += +src[k];
}

function legacyReg(c) {
  const o = {};
  for (const k of COUNT_KEYS) if (k !== 'reb' && c[k] != null) o[k] = +c[k];
  if (c.reb != null) o.reb = +c.reb;
  else if (c.orb != null && c.drb != null) o.reb = +c.orb + +c.drb;
  return o;
}
function legacyPo(po) {
  if (!po || !(+po.gp > 0)) return null;
  const o = {};
  for (const k of COUNT_KEYS) if (po[k] != null) o[k] = +po[k];
  return o;
}

export function careerBoard(L, opts = {}) {
  const side = opts.side === 'po' ? 'po' : 'reg';
  const def = statDef(opts.stat);
  const scope = opts.scope && opts.scope !== 'nba' ? opts.scope : 'nba';
  const teams = new Map();
  for (const t of L?.teams || []) {
    const id = franchiseIdOfTeam(t);
    if (id && !teams.has(id)) teams.set(id, t);
  }
  const fidOfTid = (tid) => franchiseIdOfTeam((L?.teams || [])[+tid]);
  const rows = [];
  let legacyUnsplit = 0;
  let legacyMissingStat = 0;

  for (const p of L?.players || []) {
    const acc = blankPlayer();
    const led = p.ledger;
    const covered = led?.covered || {};
    if (led?.[side]) {
      pour(acc, led[side].nba, COUNT_KEYS);
      for (const [fid, src] of Object.entries(led[side].fid || {})) pourFid(acc, fid, src);
      for (const tag of Object.keys(led.partial || {})) if (tag.endsWith(':' + side)) legacyUnsplit += 1;
    }
    const seen = new Set();
    for (const c of p.career || []) {
      if (!c || seen.has(c.season)) continue;
      seen.add(c.season);
      if (covered[c.season + ':' + side]) continue;
      if (side === 'reg') {
        const src = legacyReg(c);
        if (!(+src.gp > 0)) continue;
        pour(acc, src, COUNT_KEYS);
        const stints = (c.stints || []).filter(s => (s.side || 'reg') === 'reg' && +s.gp > 0);
        if (stints.length) for (const s of stints) pourFid(acc, fidOfTid(s.tid), fromStint(s));
        else legacyUnsplit += 1;
      } else {
        const stints = (c.stints || []).filter(s => s.side === 'po' && +s.gp > 0);
        const src = legacyPo(c.po);
        if (stints.length) {
          for (const s of stints) {
            const one = fromStint(s);
            pour(acc, one, COUNT_KEYS);
            pourFid(acc, fidOfTid(s.tid), one);
          }
        } else if (src) {
          pour(acc, src, COUNT_KEYS);
          legacyUnsplit += 1;
        }
      }
    }
    const liveSeason = p.stats?.season;
    const liveTag = liveSeason + ':' + side;
    if (liveSeason && !seen.has(liveSeason) && !covered[liveTag]) {
      const live = fromStats(side === 'po' ? p.stats.po : p.stats.reg);
      if (live && (+live.gp > 0 || +live.pts > 0)) {
        pour(acc, live, COUNT_KEYS);
        const stints = (p.stats.stints || []).filter(s => (s.side || 'reg') === side && (+s.gp > 0 || +s.min > 0));
        if (stints.length) for (const s of stints) pourFid(acc, fidOfTid(s.tid), fromStint(s));
        else legacyUnsplit += 1;
      }
    }
    const bag = scope === 'nba' ? acc.nba : acc.fid.get(scope);
    if (def.kind === 'rate') {
      if (!bag || acc.unknown.has(def.make) || acc.unknown.has(def.att)) { if (acc.unknown.has(def.make) || acc.unknown.has(def.att)) legacyMissingStat += 1; continue; }
      const att = bag[def.att] || 0;
      const make = bag[def.make] || 0;
      if (!(att >= def.minAtt)) continue;
      rows.push(rowOf(p, make / att, teams, scope));
    } else {
      if (acc.unknown.has(def.id)) { legacyMissingStat += 1; continue; }
      const value = bag ? bag[def.id] || 0 : 0;
      if (!(value > 0)) continue;
      rows.push(rowOf(p, value, teams, scope));
    }
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.pid - b.pid);
  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (prev == null || r.value !== prev) rank = i + 1;
    r.rank = rank;
    prev = r.value;
  });
  const legacyBits = [];
  if (legacyUnsplit && scope !== 'nba') legacyBits.push(`${legacyUnsplit} player-season${legacyUnsplit === 1 ? '' : 's'} in this save ha${legacyUnsplit === 1 ? 's' : 've'} no franchise split, so those games stay in the NBA total only.`);
  if (side === 'po' && legacyMissingStat) legacyBits.push('Some older playoff seasons stored only games, points, rebounds, and assists. Other playoff stats are counted from games played after this update.');
  else if (legacyMissingStat) legacyBits.push(`${legacyMissingStat} player${legacyMissingStat === 1 ? '' : 's'} left off this list because an older season did not store that stat. Missing is not shown as zero.`);
  return {
    rows,
    coverage: {
      title: SAVE_LEADERS_TITLE,
      note: SAVE_LEADERS_NOTE,
      stat: def.id,
      label: def.label,
      side,
      scope,
      rateMin: def.kind === 'rate' ? def.minAtt : null,
      rateNote: def.kind === 'rate' ? `${def.label} is makes divided by attempts in this save, for players with at least ${def.minAtt} attempts.` : '',
      legacyNote: legacyBits.join(' '),
      legacyUnsplit,
      legacyMissingStat,
    },
    franchises: franchiseChoices(L, teams),
  };
}

function rowOf(p, value, teams, scope) {
  const where = scope === 'nba' ? null : labelFor(scope, teams);
  return { id: p.pid, pid: p.pid, name: p.name, retired: !!p.retired, value, tid: where?.tid ?? null, team: where?.label || '', abbr: where?.abbr || '' };
}
function labelFor(fid, teams) {
  const t = teams.get(fid);
  if (t) return { label: `${t.city} ${t.name}`, abbr: t.abbr, tid: t.tid };
  const f = FRANCHISES.find(x => x.id === fid);
  const g = f ? f.segs[f.segs.length - 1] : null;
  if (g) return { label: `${g.city} ${g.name}`, abbr: g.abbr, tid: null };
  return { label: String(fid), abbr: String(fid), tid: null };
}
function franchiseChoices(L, teams) {
  const ids = new Set(teams.keys());
  for (const p of L?.players || []) {
    for (const side of ['reg', 'po']) for (const fid of Object.keys(p.ledger?.[side]?.fid || {})) ids.add(fid);
  }
  const rows = [...ids].map(id => ({ id, ...labelFor(id, teams) }));
  rows.sort((a, b) => (a.tid == null) - (b.tid == null) || a.label.localeCompare(b.label));
  return rows;
}
