// Read-only player audit. Writes CSV ledgers. Does not edit data files or saves.
// Run from the repo root: node scripts/audit-players.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dispRating, internalFor, floorReal, capFictional, fictionalCap, histPotFromPeak, prospectFromReal, isRealPlayer, isFictional } from '../src/engine/players.js';
import { newLeague } from '../src/engine/league.js';
import { teamsAt } from '../src/engine/timeline.js';
import { HIST_MIN } from '../src/engine/histstart.js';
import { setSeed } from '../src/engine/rng.js';

const OUT = process.argv[2] || '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const POS = new Set(['PG', 'SG', 'SF', 'PF', 'C']);
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const loose = (s) => norm(String(s).replace(/\([^)]*\)/g, ' ').replace(/["“”]/g, ' '));
function sameName(a, b) {
  const x = loose(a), y = loose(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' '), ys = y.split(' ');
  return xs.at(-1) === ys.at(-1) && (xs[0] === ys[0] || xs[0].startsWith(ys[0]) || ys[0].startsWith(xs[0]));
}

const start = JSON.parse(readFileSync('data/start1996.json', 'utf8'));
const drafts = JSON.parse(readFileSync('data/draftclasses.json', 'utf8'));
const history = JSON.parse(readFileSync('data/history.json', 'utf8'));
const contracts = JSON.parse(readFileSync('data/contracts1996.json', 'utf8'));
const data = { start, classes: drafts, history, contracts };

const issues = [];
const ledger = [];
const seasons = [];
function issue(row) { issues.push(row); }
function led(row) { ledger.push(row); }

function csv(rows, headers) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n') + '\n';
}

// ---------- source: 1996-97 start ----------
const startNames = new Map();
const startTeams = new Set();
for (const p of start.players) {
  const flags = [];
  if (!p.n || !String(p.n).trim()) flags.push('missing-name');
  else startNames.set(norm(p.n), (startNames.get(norm(p.n)) || 0) + 1);
  if (!p.t) flags.push('missing-team'); else startTeams.add(p.t);
  if (p.age == null || p.age < 18 || p.age > 45) flags.push('age-implausible');
  if (p.h != null && (p.h < 160 || p.h > 240)) flags.push('height-implausible');
  if (!p.pos) flags.push('position-missing');
  else if (!POS.has(p.pos)) flags.push('position-invalid');
  for (const k of ['gp', 'pts', 'reb', 'ast']) if (p[k] == null || Number.isNaN(+p[k])) flags.push('stat-missing-' + k);
  if (p.dy != null && (p.dy < 1946 || p.dy > 1997)) flags.push('draft-year-outside-career');
  if (p.dr != null && (!Number.isInteger(p.dr) || p.dr < 1 || p.dr > 20)) flags.push('draft-round-odd');
  led({ dataset: 'start1996', key: p.n, name: p.n, year: 1997, team: p.t, pos: p.pos || '', age: p.age, draftYear: p.dy, round: p.dr, pick: p.dp, peak: '', flags: flags.join('|') });
  for (const f of flags) issue({ severity: f === 'position-missing' ? 'P3' : 'P2', category: 'source', kind: 'machine', dataset: 'start1996', key: p.n, name: p.n, year: 1997, finding: f, evidence: JSON.stringify({ t: p.t, age: p.age, pos: p.pos, dy: p.dy, h: p.h }), source: start.source });
}
for (const [n, c] of startNames) if (c > 1) issue({ severity: 'P2', category: 'identity', kind: 'machine', dataset: 'start1996', key: n, name: n, year: 1997, finding: 'duplicate-name', evidence: `count ${c}`, source: start.source });

// ---------- source: historic player pool ----------
const histKeys = new Map();
const histBySeason = new Map();
for (const hp of history.players) {
  const flags = [];
  if (!hp.n) flags.push('missing-name');
  if (!hp.k) flags.push('missing-key');
  else histKeys.set(hp.k, (histKeys.get(hp.k) || 0) + 1);
  const seasonsOf = hp.s ? Object.keys(hp.s) : [];
  if (!seasonsOf.length) flags.push('no-seasons');
  if (hp.by != null && (hp.by < 1900 || hp.by > 1985)) flags.push('birth-year-odd');
  if (hp.h != null && (hp.h < 160 || hp.h > 240)) flags.push('height-implausible');
  if (hp.pos && !POS.has(hp.pos)) flags.push('position-invalid');
  if (!hp.pos) flags.push('position-missing');
  let est = 0;
  for (const y of seasonsOf) {
    const yr = +y;
    if (yr < HIST_MIN || yr > 1997) flags.push('season-outside-support-' + y);
    const row = hp.s[y];
    if (!Array.isArray(row) || row.length < 7) flags.push('malformed-season-' + y);
    else if (row[10] === 1 || row[10] === 2) est++;
    const fid = row?.[0];
    const known = teamsAt(yr).some(t => t.fid === fid);
    if (fid && !known) flags.push('unknown-franchise-' + y + '-' + fid);
    if (!histBySeason.has(yr)) histBySeason.set(yr, []);
    histBySeason.get(yr).push({ name: hp.n, fid, est: row?.[10] || 0, gp: row?.[2] });
    const age = hp.by ? yr - hp.by : null;
    if (age != null && (age < 17 || age > 48)) flags.push('age-implausible-' + y);
  }
  if (hp.dy != null && seasonsOf.length) {
    const first = Math.min(...seasonsOf.map(Number));
    if (hp.dy > first) flags.push('draft-after-debut');
  }
  led({ dataset: 'history', key: hp.k || hp.n, name: hp.n, year: seasonsOf[0] || '', team: '', pos: hp.pos || '', age: hp.by || '', draftYear: hp.dy, round: hp.dr, pick: hp.dp, peak: '', flags: flags.join('|') });
  for (const f of flags) issue({ severity: f.startsWith('position') || f.startsWith('season-outside') ? 'P3' : 'P2', category: 'source', kind: 'machine', dataset: 'history', key: hp.k, name: hp.n, year: seasonsOf[0] || '', finding: f, evidence: `seasons ${seasonsOf.length}; estimated lines ${est}`, source: history.source });
}
for (const [k, c] of histKeys) if (c > 1) issue({ severity: 'P1', category: 'identity', kind: 'machine', dataset: 'history', key: k, name: k, year: '', finding: 'duplicate-history-key', evidence: `count ${c}`, source: history.source });

// ---------- source: draft classes and UDFA ----------
const classNames = new Map();
const draftCounts = [];
for (const [year, list] of Object.entries(drafts.classes)) {
  const y = +year;
  const seenPick = new Map();
  let named = 0, missingPos = 0, noPick = 0;
  for (const r of list) {
    const flags = [];
    if (!r.n) flags.push('missing-name');
    else named++;
    const id = `${norm(r.n)}|${y}|${r.dp ?? ''}`;
    classNames.set(norm(r.n) + '|' + y, (classNames.get(norm(r.n) + '|' + y) || 0) + 1);
    if (!r.pos) { flags.push('position-missing'); missingPos++; }
    else if (!POS.has(r.pos)) flags.push('position-invalid');
    if (r.dp == null) { flags.push('pick-missing'); noPick++; }
    else {
      const pk = `${r.dr}|${r.dp}`;
      seenPick.set(pk, (seenPick.get(pk) || 0) + 1);
    }
    if (r.age != null && (r.age < 17 || r.age > 35)) flags.push('age-implausible');
    if (y >= 2006 && r.age != null && r.age < 19) flags.push('under-2006-age-floor');
    if (r.h != null && (r.h < 160 || r.h > 240)) flags.push('height-implausible');
    if (r.dy != null && r.dy !== y) flags.push('draft-year-mismatch');
    led({ dataset: 'draftclass', key: `${y}:${r.dp ?? '?'}:${r.n}`, name: r.n, year: y, team: '', pos: r.pos || '', age: r.age, draftYear: r.dy, round: r.dr, pick: r.dp, peak: r.peak ?? '', flags: flags.join('|') });
    for (const f of flags) issue({ severity: f === 'position-missing' || f === 'pick-missing' || f === 'under-2006-age-floor' ? 'P3' : 'P2', category: 'draft', kind: 'machine', dataset: 'draftclass', key: r.n, name: r.n, year: y, finding: f, evidence: JSON.stringify({ age: r.age, pos: r.pos, dr: r.dr, dp: r.dp, peak: r.peak }), source: drafts.sources.history || drafts.sources['2026'] || '' });
  }
  for (const [pk, c] of seenPick) if (c > 1) issue({ severity: 'P2', category: 'draft', kind: 'machine', dataset: 'draftclass', key: pk, name: pk, year: y, finding: 'duplicate-pick', evidence: `count ${c}`, source: '' });
  draftCounts.push({ year: y, names: named, rows: list.length, missingPos, noPick, uniquePicks: seenPick.size });
}
for (const [k, c] of classNames) if (c > 1) issue({ severity: 'P2', category: 'identity', kind: 'machine', dataset: 'draftclass', key: k, name: k, year: k.split('|')[1], finding: 'duplicate-name-in-class', evidence: `count ${c}`, source: '' });

let udfaN = 0;
for (const [year, list] of Object.entries(drafts.udfa || {})) {
  for (const r of list) {
    udfaN++;
    const flags = [];
    if (!r.n) flags.push('missing-name');
    if (r.dp != null) flags.push('udfa-has-pick');
    if (!r.pos) flags.push('position-missing');
    led({ dataset: 'udfa', key: `${year}:${r.n}`, name: r.n, year: +year, team: '', pos: r.pos || '', age: r.age, draftYear: r.dy, round: '', pick: '', peak: r.peak ?? '', flags: flags.join('|') });
    for (const f of flags) issue({ severity: 'P3', category: 'udfa', kind: 'machine', dataset: 'udfa', key: r.n, name: r.n, year: +year, finding: f, evidence: '', source: '' });
  }
}

// careers used for arcs and stash
let careerN = 0, careerNoName = 0, careerNoYears = 0;
const careerNames = new Map();
for (const [k, c] of Object.entries(drafts.careers || {})) {
  careerN++;
  if (!c?.n) careerNoName++;
  const years = c?.a ? Object.keys(c.a) : [];
  if (!years.length) careerNoYears++;
  if (c?.n) careerNames.set(norm(c.n), (careerNames.get(norm(c.n)) || 0) + 1);
  if (!c?.n || !years.length) issue({ severity: 'P3', category: 'career', kind: 'machine', dataset: 'careers', key: k, name: c?.n || '', year: '', finding: !c?.n ? 'missing-name' : 'no-season-lines', evidence: k, source: '' });
}

// ---------- runtime: one seeded pass of every real draft prospect ----------
setSeed(1);
const prospectRuntime = [];
for (const row of draftCounts) {
  const list = drafts.classes[String(row.year)] || [];
  for (const r of list) {
    if (!r.n) continue;
    const p = prospectFromReal(r, row.year, { histTendency: 0.5 });
    const dO = dispRating(p.ovr), dP = dispRating(p.pot);
    const hp = r.peak != null ? histPotFromPeak(r.peak) : null;
    prospectRuntime.push({ year: row.year, name: r.n, pick: r.dp, dO, dP, hp, pot: p.pot, ovr: p.ovr, real: p.real });
    if (isRealPlayer(p) && dO < 70) issue({ severity: 'P1', category: 'floor', kind: 'machine', dataset: 'prospect-runtime', key: r.n, name: r.n, year: row.year, finding: 'real-display-ovr-below-70', evidence: `display ${dO} internal ${p.ovr} floorInternal ${internalFor(70)}`, source: 'src/engine/players.js floorReal' });
    if (p.pot < p.ovr) issue({ severity: 'P1', category: 'potential', kind: 'machine', dataset: 'prospect-runtime', key: r.n, name: r.n, year: row.year, finding: 'pot-below-ovr', evidence: `${p.pot}<${p.ovr}`, source: '' });
    if (hp != null && hp <= 55 && dP >= 80) issue({ severity: 'P3', category: 'potential-judgment', kind: 'judgment', dataset: 'prospect-runtime', key: r.n, name: r.n, year: row.year, finding: 'low-stored-peak-high-runtime-pot', evidence: `stored peak ${r.peak}; histPot ${Math.round(hp)}; display ovr ${dO}; display pot ${dP}. Seed 1, tendency 0.5. A design assessment of one random draw, not a historical rating.`, source: '' });
  }
}

// ---------- runtime leagues: 1997 and every historic start ----------
function auditLeague(label, year, L) {
  const pids = new Map();
  let real = 0, fill = 0, below = 0, potBad = 0, ficHigh = 0, stash = 0;
  const byTeam = new Map();
  for (const p of L.players) {
    pids.set(p.pid, (pids.get(p.pid) || 0) + 1);
    const dO = dispRating(p.ovr), dP = dispRating(p.pot);
    if (p.stashed || p.tid === -3) stash++;
    if (p.fillIn || isFictional(p)) {
      fill++;
      const cap = fictionalCap(p);
      if (dO > cap + 1 || dP > cap + 1) { ficHigh++; issue({ severity: 'P2', category: 'cap', kind: 'machine', dataset: label, key: p.pid, name: p.name, year, finding: 'fictional-above-cap', evidence: `display ovr ${dO} pot ${dP} cap ${cap}`, source: 'src/engine/players.js capFictional' }); }
    } else if (p.real !== false && !p.edited && !p.custom) {
      real++;
      if (dO < 70) { below++; issue({ severity: 'P1', category: 'floor', kind: 'machine', dataset: label, key: p.pid, name: p.name, year, finding: 'real-display-ovr-below-70', evidence: `display ${dO} internal ${p.ovr} tid ${p.tid}`, source: 'src/engine/players.js floorReal default 70' }); }
    }
    if (p.pot < p.ovr) { potBad++; issue({ severity: 'P1', category: 'potential', kind: 'machine', dataset: label, key: p.pid, name: p.name, year, finding: 'pot-below-ovr', evidence: `${p.pot}<${p.ovr}`, source: '' }); }
    if (p.tid >= 0) {
      if (!byTeam.has(p.tid)) byTeam.set(p.tid, { real: 0, fill: 0 });
      const b = byTeam.get(p.tid);
      if (p.fillIn || isFictional(p)) b.fill++; else b.real++;
    }
    if (!POS.has(p.pos)) issue({ severity: 'P2', category: 'position', kind: 'machine', dataset: label, key: p.pid, name: p.name, year, finding: 'runtime-position-invalid', evidence: p.pos, source: '' });
    if (label === 'runtime-1997') led({ dataset: 'runtime-1997', key: p.pid, name: p.name, year, team: p.tid, pos: p.pos, age: p.age, draftYear: p.draft?.year ?? '', round: p.draft?.round ?? '', pick: p.draft?.pick ?? '', peak: p.histPot ?? '', flags: [p.real === false ? 'fictional' : 'real', p.fillIn ? 'fill' : '', p.tid < 0 ? 'not-on-roster' : ''].filter(Boolean).join('|'), dispOvr: dO, dispPot: dP });
  }
  for (const [pid, c] of pids) if (c > 1) issue({ severity: 'P1', category: 'identity', kind: 'machine', dataset: label, key: pid, name: '', year, finding: 'duplicate-pid', evidence: `count ${c}`, source: '' });
  let thin = 0;
  for (const t of L.teams) if (!t.inactive) {
    const b = byTeam.get(t.tid) || { real: 0, fill: 0 };
    if (b.real < 8) { thin++; issue({ severity: 'P3', category: 'roster-coverage', kind: 'machine', dataset: label, key: t.abbr, name: `${t.city} ${t.name}`, year, finding: 'thin-source-roster', evidence: `real ${b.real}; generated fillers added ${b.fill}`, source: year === 1997 ? start.source : history.source }); }
    seasons.push({ year, team: t.abbr, city: t.city, name: t.name, real: b.real, fill: b.fill, active: !t.inactive });
  }
  return { players: L.players.length, real, fill, below, potBad, ficHigh, stash, thin, teams: L.teams.filter(t => !t.inactive).length };
}

console.log('building 1997 league');
const t0 = Date.now();
const L97 = newLeague(data, { seed: 1, gmName: 'Audit', userTid: 0 });
const sum97 = auditLeague('runtime-1997', 1997, L97);
console.log('1997', sum97, 'ms', Date.now() - t0);
const yearSums = [{ year: 1997, ...sum97 }];
for (let y = HIST_MIN; y <= 1996; y++) {
  const t = Date.now();
  let L;
  try { L = newLeague(data, { seed: 1, startYear: y, gmName: 'Audit', userTid: 0 }); }
  catch (e) { issue({ severity: 'P1', category: 'runtime', kind: 'machine', dataset: 'runtime-hist', key: y, name: '', year: y, finding: 'newLeague-threw', evidence: e.message, source: '' }); console.log(y, 'THREW', e.message); continue; }
  const s = auditLeague('runtime-hist', y, L);
  yearSums.push({ year: y, ...s });
  console.log(y, 'teams', s.teams, 'real', s.real, 'fill', s.fill, 'thin', s.thin, 'ms', Date.now() - t);
}

// named prospects the public draft pages are expected to contain
const NOTABLES = [
  ['Allen Iverson', 1996], ['Kobe Bryant', 1996], ['Steve Nash', 1996], ['Ray Allen', 1996],
  ['Tim Duncan', 1997], ['Tracy McGrady', 1997],
  ['Dirk Nowitzki', 1998], ['Paul Pierce', 1998],
  ['Elton Brand', 1999], ['Manu Ginobili', 1999], ['William Avery', 1999], ['Aleksandar Radojevic', 1999],
  ['Pau Gasol', 2001], ['Tony Parker', 2001],
  ['Yao Ming', 2002], ['Amar\'e Stoudemire', 2002],
  ['LeBron James', 2003], ['Dwyane Wade', 2003], ['Chris Bosh', 2003],
  ['Kevin Durant', 2007], ['Stephen Curry', 2009], ['Kyrie Irving', 2011],
  ['Luka Doncic', 2018], ['Victor Wembanyama', 2023],
  ['Hakeem Olajuwon', 1984], ['Michael Jordan', 1984], ['Charles Barkley', 1984], ['John Stockton', 1984],
];
const classByYear = new Map(Object.entries(drafts.classes).map(([y, list]) => [+y, list.map(r => norm(r.n))]));
const missingNotables = [];
for (const [name, year] of NOTABLES) {
  const have = (classByYear.get(year) || []).includes(norm(name)) || [...(classByYear.get(year) || [])].some(n => n.includes(norm(name).split(' ').slice(-1)[0]) && n.includes(norm(name).split(' ')[0]));
  // William Avery may be stored as Will Avery
  const loose = (classByYear.get(year) || []).some(n => {
    const a = norm(name).split(' ');
    return n === norm(name) || (a.length > 1 && n.endsWith(a.at(-1)) && (n.includes(a[0]) || (a[0] === 'william' && n.startsWith('will')) || (a[0] === 'aleksandar' && (n.startsWith('aleksandar') || n.startsWith('alexander')))));
  });
  if (!have && !loose) missingNotables.push({ name, year });
}

async function wikiBatch(titles) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0&redirects=1&format=json&titles=' + encodeURIComponent(titles.join('|'));
  const res = await fetch(url, { headers: { 'User-Agent': 'HardwoodGMAudit/1.0 (local research; player-data audit)' } });
  if (!res.ok) throw new Error('wikipedia ' + res.status);
  return res.json();
}
function draftTitle(y) { return y <= 1949 ? `${y} BAA draft` : `${y} NBA draft`; }
const years = [...new Set([...draftCounts.map(d => d.year), ...Array.from({ length: 2026 - 1947 + 1 }, (_, i) => 1947 + i)])].sort((a, b) => a - b);
const wiki = new Map();
const titles = years.filter(y => y <= 2026).map(draftTitle);
for (let i = 0; i < titles.length; i += 40) {
  const chunk = titles.slice(i, i + 40);
  try {
    const body = await wikiBatch(chunk);
    const pages = Object.values(body.query?.pages || {});
    for (const page of pages) {
      if (page.missing) { wiki.set(page.title, { missing: true }); continue; }
      const text = page.revisions?.[0]?.slots?.main?.['*'] || page.revisions?.[0]?.['*'] || '';
      const overall = /overall\s*=\s*(\d+)/i.exec(text);
      const rounds = /rounds\s*=\s*(\d+)/i.exec(text);
      const first = /first\s*=\s*\[\[([^\]|]+)/i.exec(text);
      const m = /(\d{4})/.exec(page.title);
      wiki.set(+(m?.[1]), { title: page.title, overall: overall ? +overall[1] : null, rounds: rounds ? +rounds[1] : null, first: first ? first[1].trim() : null, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_')) });
    }
    console.log('wiki', i, chunk.length);
  } catch (e) {
    console.log('wiki chunk failed', e.message);
    issue({ severity: 'P3', category: 'source-gap', kind: 'gap', dataset: 'wikipedia', key: chunk[0], name: '', year: '', finding: 'draft-infobox-fetch-failed', evidence: e.message, source: '' });
  }
}

const draftCompare = [];
for (const row of draftCounts) {
  const w = wiki.get(row.year);
  draftCompare.push({ year: row.year, ourNames: row.names, ourPicks: row.uniquePicks, wikiOverall: w?.overall ?? '', wikiRounds: w?.rounds ?? '', wikiFirst: w?.first ?? '', wiki: w?.url || (w?.missing ? 'missing-page' : 'not-fetched') });
  if (!w || w.missing || w.overall == null) {
    issue({ severity: 'P3', category: 'source-gap', kind: 'gap', dataset: 'draftclass', key: row.year, name: '', year: row.year, finding: 'no-wikipedia-overall-count', evidence: w?.title || 'no page', source: w?.url || '' });
    continue;
  }
  const ours = (drafts.classes[String(row.year)] || []).map(r => r.n);
  const haveFirst = w.first && ours.some(n => sameName(n, w.first));
  if (w.first && !haveFirst) issue({ severity: 'P1', category: 'draft-omission', kind: 'source-verified', dataset: 'draftclass', key: w.first, name: w.first, year: row.year, finding: 'wikipedia-first-overall-not-in-class', evidence: `our class names ${row.names}; wikipedia overall ${w.overall}`, source: w.url });
  if (row.names + 3 < w.overall) issue({ severity: 'P2', category: 'draft-omission', kind: 'source-verified', dataset: 'draftclass', key: row.year, name: '', year: row.year, finding: 'class-shorter-than-wikipedia-overall', evidence: `names ${row.names}; unique picks ${row.uniquePicks}; wikipedia overall ${w.overall}; rounds ${w.rounds}. Many omitted names are draftees who never played and were not given a player article.`, source: w.url });
}

// confirm missing notables against the year page only when absent
const byMissingYear = new Map();
for (const m of missingNotables) {
  if (!byMissingYear.has(m.year)) byMissingYear.set(m.year, []);
  byMissingYear.get(m.year).push(m.name);
}
for (const [year, names] of byMissingYear) {
  const title = draftTitle(year);
  let text = '';
  let url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
  try {
    const body = await wikiBatch([title]);
    const page = Object.values(body.query?.pages || {})[0];
    text = page?.revisions?.[0]?.slots?.main?.['*'] || '';
    if (page?.title) url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_'));
  } catch (e) {
    issue({ severity: 'P3', category: 'source-gap', kind: 'gap', dataset: 'draftclass', key: year, name: names.join('; '), year, finding: 'could-not-verify-notable', evidence: e.message, source: url });
    continue;
  }
  for (const name of names) {
    const last = name.split(' ').at(-1);
    const onPage = text.includes(name) || text.includes(last);
    if (onPage) issue({ severity: 'P1', category: 'draft-omission', kind: 'source-verified', dataset: 'draftclass', key: name, name, year, finding: 'notable-draftee-absent-from-class', evidence: 'Name appears on the Wikipedia draft page and not in data/draftclasses.json for that year.', source: url });
    else issue({ severity: 'P3', category: 'source-gap', kind: 'gap', dataset: 'draftclass', key: name, name, year, finding: 'notable-not-confirmed-on-draft-page', evidence: 'Absent from our class, and the Wikipedia lead/infobox section did not contain the name. Not treated as a confirmed omission.', source: url });
  }
}

// judgment examples requested by the design rules
const examples = ['Manu Ginobili', 'William Avery', 'Will Avery', 'Aleksandar Radojevic', 'Tim Duncan', 'Kobe Bryant', 'LeBron James'];
const exampleRows = prospectRuntime.filter(p => examples.some(n => norm(p.name) === norm(n) || norm(p.name).endsWith(norm(n).split(' ').at(-1)) && norm(p.name).includes(norm(n).split(' ')[0].slice(0, 4))));

const summary = {
  baseline: 'origin/main fe297f1 (live v52). No data files were modified.',
  floorInternalForDisplay70: internalFor(70),
  counts: {
    start1996: start.players.length,
    startTeams: startTeams.size,
    historyPlayers: history.players.length,
    historySeasons: histBySeason.size,
    draftYears: draftCounts.length,
    draftRows: draftCounts.reduce((s, r) => s + r.rows, 0),
    udfa: udfaN,
    careers: careerN,
    careerMissingName: careerNoName,
    careerMissingYears: careerNoYears,
    contracts1996: Object.keys(contracts.players).length,
    runtime1997: sum97,
    prospectRuntimeRows: prospectRuntime.length,
    notableAbsentBeforeWiki: missingNotables,
  },
  yearSums,
  draftCompare,
  examples: exampleRows,
  issueCounts: issues.reduce((m, i) => { m[i.severity + ':' + i.finding] = (m[i.severity + ':' + i.finding] || 0) + 1; return m; }, {}),
  sources: { start: start.source, history: history.source, drafts: drafts.sources, contracts: contracts.source },
};
writeFileSync(`${OUT}/player-audit-summary.json`, JSON.stringify(summary, null, 2));
const ledgerHeaders = ['dataset', 'key', 'name', 'year', 'team', 'pos', 'age', 'draftYear', 'round', 'pick', 'peak', 'flags', 'dispOvr', 'dispPot'];
writeFileSync(`${OUT}/player-audit-ledger.csv`, csv(ledger, ledgerHeaders));
const issueHeaders = ['severity', 'category', 'kind', 'dataset', 'key', 'name', 'year', 'finding', 'evidence', 'source'];
writeFileSync(`${OUT}/player-audit-issues.csv`, csv(issues, issueHeaders));
writeFileSync(`${OUT}/player-audit-seasons.csv`, csv(seasons, ['year', 'team', 'city', 'name', 'real', 'fill', 'active']));
writeFileSync(`${OUT}/player-audit-draft-counts.csv`, csv(draftCompare, ['year', 'ourNames', 'ourPicks', 'wikiOverall', 'wikiRounds', 'wikiFirst', 'wiki']));
console.log('issues', issues.length, 'ledger', ledger.length, 'seasons', seasons.length);
console.log('notable missing before wiki', missingNotables);
console.log('examples', exampleRows);
