// "Real NBA history" mode: league events from 1997-98 on happen on schedule — rule changes, CBAs,
// relocations, rebrands, the 2004 Charlotte expansion and the 2004-05 realignment. Each one posts a news
// item and a League Office message the season it happens. Facts: public league history (see NOTES.md).
import { rand, shuffle } from './rng.js';
import { LOTTERY_WEIGHTS, ROSTER_MIN } from './constants.js';
import { marketValue, dispRating } from './players.js';
import { teamPlayers, payroll, cap, msg, news, genStaff, addPicksForSeason, reindex, teamName, resetSeasonStats } from './league.js';
import { syncEra } from './era.js';
import { changesAt, alignment, FRANCHISES, segAt } from './timeline.js';
import { rawFor, firstSeason } from './histstart.js';
import { playerFromStats, buildAttrs, deriveDefSkills, ovrFromAttrs, pctToOvr, devTrait } from './players.js';
import { arcTarget, arcPot, normName } from './careers.js';
import { release } from './offseason.js';

const on = (L) => L.settings?.realHistory !== false;
const byAbbr = (L, a) => L.teams.find(t => t.abbr === a);
function rebrand(L, from, to) {
  const t = byAbbr(L, from); if (!t) return null;
  (t.names ||= []).push({ until: L.season - 1, abbr: t.abbr, city: t.city, name: t.name, c1: t.c1, c2: t.c2 });
  Object.assign(t, to); return t;
}
const REALIGN_2005 = { Atlantic: ['BOS', 'NJN', 'NYK', 'PHI', 'TOR'], Central: ['CHI', 'CLE', 'DET', 'IND', 'MIL'], Southeast: ['ATL', 'CHA', 'MIA', 'ORL', 'WAS'],
  Northwest: ['DEN', 'MIN', 'POR', 'SEA', 'UTA'], Pacific: ['GSW', 'LAC', 'LAL', 'PHX', 'SAC'], Southwest: ['DAL', 'HOU', 'MEM', 'NOH', 'SAS'] };
const WEST = new Set(['Northwest', 'Pacific', 'Southwest']);

export const HISTORY = [
  { season: 1998, at: 'preseason', id: 'line98', title: '3-point line moves back',
    text: "The shortened 3-point line of 1994-97 (22 ft all around) is gone. For 1997-98 it is back to 23'9\" (22 ft in the corners). Expect fewer threes and a lower 3P%." },
  { season: 1998, at: 'preseason', id: 'wizards98', title: 'Bullets become the Wizards',
    text: 'The Washington Bullets are now the Washington Wizards, with new colors.', apply: (L) => rebrand(L, 'WAS', { name: 'Wizards', c1: '#0b2a5b', c2: '#a8875a' }) },
  { season: 1999, at: 'preseason', id: 'lockout99', title: 'Lockout ends: 50-game season',
    text: 'The owners and players settled the lockout on Jan 20, 1999. The 1998-99 season is 50 games, all within the conference, starting Feb 5. There is no All-Star Game this year.' },
  { season: 1999, at: 'preseason', id: 'cba99', title: 'New CBA: maximum salaries',
    text: 'The 1999 CBA adds individual max salaries by years of service: 0-6 years 25% of the cap, 7-9 years 30%, 10+ years 35% (or 105% of the previous salary). Contracts run up to 7 years when re-signing your own player, 6 years otherwise. The rookie scale stays.' },
  { season: 2002, at: 'preseason', id: 'zone02', title: 'Zone defenses legalized',
    text: 'The illegal-defense rules are gone for 2001-02. Zones are legal, and a new defensive 3-second rule stops defenders from camping in the lane. Coaches can now run Zone Mix, and Pack the Paint is fully effective.',
    apply: (L) => { const hcs = shuffle(L.teams.filter(t => t.tid !== L.userTid && t.staff.HC && t.staff.HC.def === 'Man-to-Man')).slice(0, 4);
      for (const t of hcs) t.staff.HC.def = 'Zone Mix'; return hcs.length ? `Switching to zone: ${hcs.map(t => `${t.staff.HC.name} (${t.abbr})`).join(', ')}.` : ''; } },
  { season: 2002, at: 'preseason', id: 'mem02', title: 'Grizzlies move to Memphis',
    text: 'The Vancouver Grizzlies have relocated and are now the Memphis Grizzlies.', apply: (L) => rebrand(L, 'VAN', { abbr: 'MEM', city: 'Memphis', c1: '#5d76a9', c2: '#12173f' }) },
  { season: 2003, at: 'preseason', id: 'noh03', title: 'Hornets move to New Orleans',
    text: 'The Charlotte Hornets have relocated and are now the New Orleans Hornets.', apply: (L) => rebrand(L, 'CHH', { abbr: 'NOH', city: 'New Orleans' }) },
  { season: 2004, at: 'lottery', id: 'cha04', title: 'Expansion: the Charlotte Bobcats',
    text: 'The league grows to 30 teams. The Charlotte Bobcats pick unprotected players in the expansion draft (each team protects 8; at most one player per team), and they pick 4th and 31st (the first pick of round 2) in the 2004 Draft.', apply: (L) => expansionDraft(L) },
  { season: 2005, at: 'preseason', id: 'realign05', title: 'Realignment: six divisions',
    text: 'With 30 teams the league now has six divisions: Atlantic, Central and Southeast in the East; Northwest, Pacific and Southwest in the West. New Orleans moves to the West. The three division winners get the top three seeds, and the draft lottery now has 14 teams.',
    apply: (L) => { for (const [div, abs] of Object.entries(REALIGN_2005)) for (const a of abs) { const t = byAbbr(L, a); if (t) { t.div = div; t.conf = WEST.has(div) ? 'W' : 'E'; } } } },
  { season: 2005, at: 'preseason', id: 'hand05', title: 'Hand-checking banned',
    text: 'For 2004-05, defenders can no longer hand-check ball handlers on the perimeter. Perimeter defense loses some impact, drivers draw more fouls, and scoring and pace go up.' },
  { season: 2005, at: 'lottery', id: 'cba05', title: 'New CBA: age limit and shorter deals',
    text: 'The 2005 CBA sets a minimum draft age: 19 years old and one year out of high school, starting with the 2006 Draft. Max contract length drops to 6 years for your own players and 5 for others.' },
  { season: 2006, at: 'preseason', id: 'nok06', title: 'Hornets play in Oklahoma City',
    text: 'After Hurricane Katrina, the Hornets play most of their 2005-06 and 2006-07 home games in Oklahoma City as the New Orleans/Oklahoma City Hornets.',
    apply: (L) => rebrand(L, 'NOH', { abbr: 'NOK', city: 'New Orleans/OKC' }) },
  { season: 2006, at: 'lottery', id: 'age06', title: 'First draft under the age limit',
    text: 'The 2006 Draft is the first under the age limit. No high-school seniors are eligible, and every prospect is at least 19.' },
  { season: 2007, at: 'preseason', id: 'seed07', title: 'Playoff seeding change',
    text: 'Division winners are no longer automatically seeded 1-3. The three division winners and the best other team get the top four seeds, ordered by record.' },
  { season: 2008, at: 'preseason', id: 'noh08', title: 'Hornets return to New Orleans',
    text: 'The Hornets are back in New Orleans full-time.', apply: (L) => rebrand(L, 'NOK', { abbr: 'NOH', city: 'New Orleans' }) },
  { season: 2009, at: 'preseason', id: 'okc09', title: 'SuperSonics move to Oklahoma City',
    text: "The Seattle SuperSonics have relocated and are now the Oklahoma City Thunder. Seattle keeps the Sonics' name, colors and retired numbers.",
    apply: (L) => { const t = rebrand(L, 'SEA', { abbr: 'OKC', city: 'Oklahoma City', name: 'Thunder', c1: '#007ac1', c2: '#ef3b24' }); if (t) { t.legacyRetired = [...(t.legacyRetired || []), ...(t.retiredNums || [])]; t.retiredNums = []; } } },
  { season: 2012, at: 'preseason', id: 'lockout12', title: 'Lockout ends: 66-game season',
    text: 'The 2011 lockout ended in late November. The 2011-12 season is 66 games, starting Dec 25. The new CBA caps contracts at 5 years for your own players and 4 for others.' },
  { season: 2013, at: 'preseason', id: 'bkn13', title: 'Nets move to Brooklyn',
    text: 'The New Jersey Nets have moved to Brooklyn.', apply: (L) => rebrand(L, 'NJN', { abbr: 'BKN', city: 'Brooklyn', c1: '#111111', c2: '#ffffff' }) },
  { season: 2014, at: 'preseason', id: 'nop14', title: 'Hornets become the Pelicans',
    text: 'New Orleans has changed its name from the Hornets to the Pelicans.', apply: (L) => rebrand(L, 'NOH', { abbr: 'NOP', name: 'Pelicans', c1: '#0c2340', c2: '#c8102e' }) },
  { season: 2015, at: 'preseason', id: 'cha15', title: 'Bobcats become the Hornets',
    text: 'Charlotte has taken back the Hornets name, and the teal and purple are back.', apply: (L) => rebrand(L, 'CHA', { name: 'Hornets', c1: '#00788c', c2: '#1d1160' }) },
  { season: 2016, at: 'preseason', id: 'seed16', title: 'Seeding by record only',
    text: 'Division winners no longer get a guaranteed top-4 seed. Playoff seeds go strictly by record.' },
  { season: 2019, at: 'lottery', id: 'lot19', title: 'Lottery reform',
    text: 'New lottery odds: the three worst teams each have a 14% chance at #1, and the top four picks are drawn, which discourages tanking.' },
  { season: 2021, at: 'preseason', id: 'short21', title: '72-game season',
    text: 'After the pandemic-shortened 2019-20 season, 2020-21 is 72 games, starting Dec 22.' },
];

export function applyHistory(L, at) {
  if (!on(L)) return [];
  applyTimeline(L, at);
  L.histDone ||= []; const done = [];
  for (const ev of HISTORY) {
    if (ev.season !== L.season || ev.at !== at || L.histDone.includes(ev.id)) continue;
    L.histDone.push(ev.id);
    let extra = ev.apply?.(L); if (typeof extra !== 'string') extra = '';
    news(L, `${ev.title}. ${ev.text.split('. ')[0].replace(/\.$/, '')}.`, 'history');
    msg(L, 'League Office', ev.title, ev.text + (extra ? `\n\n${extra}` : ''), { pri: ev.apply && /expansion/i.test(ev.title) ? 'high' : 'normal', hist: ev.id });
    done.push(ev.id);
  }
  if (done.length) { syncEra(L); reindex(L); }
  return done;
}

// lottery odds by era: 1995-2004 (13 teams), 2005-2018 (14 teams), 2019+ (flattened, top 4 drawn)
export function lotteryRule(L, n) {
  // before 1985 no lottery: worst record picks first (the 1966-84 coin flip for #1 is not modeled); 1985-89 every
  // non-playoff team equal (1985-86 all picks drawn, 1987-89 top 3); 1990-94 weighted odds (66 combinations of 11 teams, top 3)
  if (on(L) && L.season < 1985) return { weights: Array(n).fill(1), draws: 0 };
  if (on(L) && L.season < 1990) return { weights: Array(n).fill(1), draws: L.season < 1987 ? n : 3 };
  if (on(L) && L.season < 1994) return { weights: Array.from({ length: n }, (_, i) => Math.max(1, 11 - i)), draws: 3 };
  if (!on(L) || L.season < 2005) return { weights: LOTTERY_WEIGHTS.slice(0, n), draws: 3 };
  if (L.season < 2019) return { weights: [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6, 5].slice(0, n), draws: 3 };
  return { weights: [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5].slice(0, n), draws: 4 };
}

// ---------- 2004 expansion ----------
const CHARLOTTE = { abbr: 'CHA', city: 'Charlotte', name: 'Bobcats', conf: 'E', div: 'Southeast', c1: '#f26532', c2: '#2c5aa0' };
export function expansionDraft(L, spec = CHARLOTTE) {
  if (L.teams.some(t => t.abbr === spec.abbr && !t.inactive)) return '';
  const tid = L.teams.length; const nm = `${spec.city} ${spec.name}`;
  const t = { tid, fid: spec.fid, abbr: spec.abbr, city: spec.city, name: spec.name, conf: spec.conf, div: spec.div, c1: spec.c1, c2: spec.c2, retiredNums: [], custom: !!spec.custom,
    rotation: null, autoRotation: true, strategy: { pace: 'Normal', focus: 'Balanced' }, staff: {}, mleUsed: false, lastWinPct: 0.3, expansion: L.season + 1 };
  L.teams.push(t);
  for (const role of ['HC', 'AC', 'SC', 'TR']) { t.staff[role] = genStaff(role, L.season); t.staff[role].tenure = 0; }
  for (const s of [...new Set(L.picks.map(p => p.season))].filter(s => s > L.season)) addPicksForSeason(L, s);
  if (spec.noDraft) { reindex(L); return ''; }
  L.expansionTid = tid; L.expansionSeason = L.season; (L.expansions ||= []).push({ tid, season: L.season });
  // each team protects its 8 most valuable players (earlier expansion teams this year are exempt); the new team takes at most one unprotected player per team
  const val = (p) => p.ovr + (p.age <= 25 ? (p.pot - p.ovr) * 0.4 : 0) - Math.max(0, p.age - 30) * 1.5 - 6 * Math.max(0, p.contract.amt / Math.max(1, marketValue(p, L.season)) - 1.3);
  const cands = [];
  const newThisYear = new Set((L.expansions || []).filter(e => e.season === L.season).map(e => e.tid));
  for (const o of L.teams) if (!newThisYear.has(o.tid) && !o.inactive) {
    const ps = teamPlayers(L, o.tid).filter(p => p.contract);
    const prot = new Set(ps.slice().sort((a, b) => val(b) - val(a)).slice(0, 8).map(p => p.pid));
    for (const p of ps) if (!prot.has(p.pid) && p.contract.exp > L.season) cands.push({ p, o, v: val(p) + rand() * 2 });
  }
  cands.sort((a, b) => b.v - a.v);
  const taken = new Set(), picks = []; const lim = cap(L) * 0.8; let pay = 0;
  for (const c of cands) {
    if (picks.length >= 12) break; if (taken.has(c.o.tid) || pay + c.p.contract.amt > lim) continue;
    taken.add(c.o.tid); pay += c.p.contract.amt; picks.push(c);
  }
  for (const { p, o } of picks) {
    p.tid = tid; p.formerTid = o.tid;
    if (o.tid === L.userTid) msg(L, 'League Office', 'Expansion draft: you lost a player', `The ${nm} selected ${p.name} (${p.pos}, ${dispRating(p.ovr)} OVR) from your roster in the expansion draft. Your 8 most valuable players were protected.`, { pri: 'high' });
  }
  news(L, `Expansion draft: the ${nm} select ${picks.slice(0, 5).map(c => `${c.p.name} (${c.o.abbr})`).join(', ')}${picks.length > 5 ? ` and ${picks.length - 5} more` : ''}.`, 'history', tid);
  reindex(L);
  return `${spec.city}'s picks: ${picks.map(c => `${c.p.name} (${c.o.abbr})`).join(', ')}.`;
}

// ---------- custom expansion (after the 2026 season) ----------
export const MAX_TEAMS = 36;
export function canExpand(L) { return L.season >= 2026 && ['AWARDS', 'STAFF'].includes(L.phase) && L.teams.filter(t => !t.inactive).length < MAX_TEAMS; }
export function createExpansionTeam(L, spec) {
  if (!canExpand(L)) return { ok: false, error: L.season < 2026 ? 'Custom expansion opens after the 2026 season.' : L.teams.filter(t => !t.inactive).length >= MAX_TEAMS ? `The league is full (${MAX_TEAMS} teams).` : 'New teams join in the offseason, before the draft lottery (Awards or Staff phase).' };
  const abbr = String(spec.abbr || '').toUpperCase().trim(), city = String(spec.city || '').trim(), name = String(spec.name || '').trim();
  if (!/^[A-Z]{2,4}$/.test(abbr)) return { ok: false, error: 'Abbreviation must be 2-4 letters.' };
  if (L.teams.some(t => t.abbr === abbr)) return { ok: false, error: `${abbr} is already taken.` };
  if (!city || !name || city.length > 24 || name.length > 24) return { ok: false, error: 'City and name are required (up to 24 characters).' };
  const hex = (c) => /^#[0-9a-f]{6}$/i.test(c || ''); if (!hex(spec.c1) || !hex(spec.c2)) return { ok: false, error: 'Pick two colors.' };
  const conf = spec.conf === 'W' ? 'W' : 'E'; const divs = [...new Set(L.teams.filter(t => t.conf === conf && !t.inactive).map(t => t.div))];
  const div = divs.includes(spec.div) ? spec.div : divs[0];
  const text = expansionDraft(L, { abbr, city, name, conf, div, c1: spec.c1, c2: spec.c2, custom: true });
  const tid = L.teams.findIndex(t => t.abbr === abbr);
  msg(L, 'League Office', `Expansion: the ${city} ${name}`, `The league grows to ${L.teams.filter(t => !t.inactive).length} teams. ${text} They also get a top-5 pick in this year's draft.`, { pri: 'high' });
  return { ok: true, tid, text };
}

// ---------- historic timeline (saves that start before 1996-97) ----------
// Every real franchise change from 1946-47 on, in its real year (timeline.js): expansion teams (expansion draft),
// NBL teams (1948-49, 1949-50) and ABA teams (1976 merger) arriving with their real rosters, folds (players enter
// free agency, our stand-in for the dispersal drafts) and relocations/renames. Players who reached the NBA from
// another league (NBL, ABA, abroad, late debuts) arrive as free agents the summer before their real first season.
const byFid = (L, fid) => L.teams.find(t => t.fid === fid && !t.inactive);
export function histPlayer(L, hp, S) {
  const raw = rawFor(hp, S); if (!raw) return null;
  const p = playerFromStats(raw, S); const e = L.data.careers?.[hp.k]?.a?.[String(S - 1)];
  const target = e ? arcTarget(e) : pctToOvr(0.35);
  Object.assign(p.ratings, buildAttrs(target, p.pos, p._tilt)); deriveDefSkills(p); p.ovr = ovrFromAttrs(p.ratings, p.pos);
  delete p._prod; delete p._tilt; delete p._raw;
  p.real = true; p.arcKey = hp.k; p.histKey = hp.k; if (raw._est) p.estSeason = raw._est; if (hp.num) p.num = String(hp.num);
  p.pot = Math.max(p.ovr, arcPot(L, p, S) ?? p.ovr); p.devTrait = devTrait(p); p.prior = { yrs: 0, pts: 0, reb: 0, ast: 0 };
  p.tid = -1; p.contract = null; resetSeasonStats(p, L.season); L.players.push(p); return p;
}
function present(L) { return new Set(L.players.map(p => p.histKey || normName(p.name))); }
function signReal(L, p, tid, S) { p.tid = tid; p.contract = { amt: Math.max(minSal(L), Math.round(marketValue(p, S) / 10) * 10), exp: S + 1 + Math.floor(rand() * 3), rookie: false }; if (tid >= 0) p.startTid ??= tid; }
const minSal = (L) => Math.round(cap(L) * 0.0102);
export function applyTimeline(L, at) {
  if (!L.histStart || !on(L)) return;
  L.tlDone ||= [];
  if (at === 'lottery') {
    const next = L.season + 1; if (next > 1997) return; const id = `tl-l-${next}`; if (L.tlDone.includes(id)) return; L.tlDone.push(id);
    const ch = changesAt(next); const al = alignment(next); const H = L.data.history?.players || []; const notes = [];
    for (const { f, g } of ch.fold) {
      const t = byFid(L, f.id); if (!t) continue;
      const ps = teamPlayers(L, t.tid); for (const p of ps) release(L, p, true);
      t.inactive = true; t.conf = 'X'; t.foldedAfter = L.season;
      L.picks = L.picks.filter(pk => pk.season <= L.season - 1 || (pk.orig !== t.tid && pk.tid !== t.tid));
      L.draftOrder = (L.draftOrder || []).filter(o => o.tid !== t.tid);
      const txt = `The ${g.city} ${g.name} have folded after the ${L.season - 1}-${String(L.season).slice(2)} season. Their ${ps.length} players are free agents (the real league held dispersal drafts).`;
      news(L, txt, 'history'); msg(L, 'League Office', `${g.city} ${g.name} fold`, txt, { pri: 'high' }); notes.push(`${g.abbr} folded`);
    }
    const have = present(L);
    for (const { f, g } of ch.join) {
      const spec = { fid: f.id, abbr: g.abbr, city: g.city, name: g.name, c1: g.c1, c2: g.c2, conf: al[f.id]?.conf || 'E', div: al[f.id]?.div || 'Eastern' };
      if (f.how === 'expansion') {
        const text = expansionDraft(L, spec);
        msg(L, 'League Office', `Expansion: the ${g.city} ${g.name}`, `The ${g.city} ${g.name} join the league for ${next - 1}-${String(next).slice(2)}. ${text}`, { pri: 'high' }); notes.push(`${g.abbr} expansion`);
      } else {
        expansionDraft(L, { ...spec, noDraft: true }); const t = byFid(L, f.id); let n = 0;
        for (const hp of H) { const v = hp.s[String(next)]; if (!v || v[0] !== f.id || have.has(hp.k) || have.has(normName(hp.n))) continue; const p = histPlayer(L, hp, next); if (p) { signReal(L, p, t.tid, next); have.add(hp.k); n++; } }
        const lg = /ABA/.test(f.how) ? 'ABA' : 'NBL';
        const txt = `The ${g.city} ${g.name} join from the ${lg} with ${n} players from their real ${next - 1}-${String(next).slice(2)} roster.`;
        news(L, txt, 'history'); msg(L, 'League Office', `${g.city} ${g.name} join the league`, txt, { pri: 'high' }); notes.push(`${g.abbr} from the ${lg}`);
      }
    }
    // arrivals: veterans from other leagues / late debuts become free agents now (drafted-this-summer and young undrafted rookies come through the draft)
    let arr = 0; const names = [];
    for (const hp of H) {
      if (firstSeason(hp) !== next || have.has(hp.k) || have.has(normName(hp.n))) continue;
      if (hp.dy === L.season) continue; if (hp.dy == null && next - hp.by <= 23) continue;
      const p = histPlayer(L, hp, next); if (!p) continue; have.add(hp.k); arr++; if (names.length < 6 && p.ovr >= 60) names.push(p.name);
    }
    if (arr) news(L, `${arr} players from other leagues are now NBA free agents${names.length ? `, including ${names.join(', ')}` : ''}.`, 'history');
    // teams that joined from another league fill out first from the arriving players (stand-in for the 1976 ABA dispersal draft), then the free-agent pool
    const joined = ch.join.filter(j => j.f.how !== 'expansion').map(j => byFid(L, j.f.id)).filter(Boolean);
    for (let round = 0; round < 12; round++) for (const t of joined) {
      if (teamPlayers(L, t.tid).length >= ROSTER_MIN) continue;
      const f = L.players.filter(p => p.tid === -1 && !p.retired).sort((a, b) => b.ovr - a.ovr)[0]; if (!f) break;
      signReal(L, f, t.tid, next);
    }
    reindex(L); syncEra(L);
  }
  if (at === 'preseason') {
    const S = L.season; if (S > 1997) return; const id = `tl-p-${S}`; if (L.tlDone.includes(id)) return; L.tlDone.push(id);
    for (const { f, from, to } of changesAt(S).move) {
      const t = byFid(L, f.id); if (!t) continue;
      rebrand(L, t.abbr, { abbr: to.abbr, city: to.city, name: to.name, c1: to.c1, c2: to.c2 });
      const moved = from.city !== to.city; const txt = moved ? `The ${from.city} ${from.name} have moved and are now the ${to.city} ${to.name}.` : `The ${from.city} ${from.name} are now the ${to.city} ${to.name}.`;
      news(L, txt, 'history'); msg(L, 'League Office', moved ? `${from.name} move to ${to.city}` : `${from.city} ${from.name} renamed`, txt);
    }
    const al = alignment(S); for (const t of L.teams) if (!t.inactive && t.fid && al[t.fid]) Object.assign(t, al[t.fid]);
    if (S === 1980) msg(L, 'League Office', 'The 3-point line arrives', 'For 1979-80 the NBA adopts the 3-point field goal (the ABA had used it since 1967). Expect only a handful of attempts per game at first.');
    if (S === 1955) msg(L, 'League Office', 'The 24-second shot clock', 'From 1954-55 teams must shoot within 24 seconds, and team fouls are limited. Scoring and pace jump.');
    if (S === 1985) msg(L, 'League Office', 'The salary cap arrives', 'For 1984-85 the NBA has its first salary cap ($3.6 million per team), with the Larry Bird exception for re-signing your own players.');
    if (S === 1997) msg(L, 'League Office', 'Modern roster rules', 'From 1996-97 rosters run 13-15 players with an inactive list, and the 1995 CBA rules apply.');
    reindex(L);
  }
}
