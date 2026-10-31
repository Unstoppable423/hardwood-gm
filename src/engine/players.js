import { rand, randInt, normal, pick, clamp } from './rng.js';
import { capFor, minSalary, maxSalary } from './constants.js';
import { NAME_DATA } from './names.js';

export const ATTRS = ['ins', 'out', 'pas', 'han', 'reb', 'idef', 'pdef', 'ath', 'iq'];
export const ATTR_LABEL = { ins: 'Inside Scoring', out: 'Outside Shooting', pas: 'Passing', han: 'Ball Handling',
  reb: 'Rebounding', idef: 'Interior Defense', pdef: 'Perimeter Defense', ath: 'Athleticism', iq: 'Basketball IQ',
  sco: 'Shot Creation', sta: 'Stamina', dur: 'Durability', blk: 'Shot Blocking', stl: 'Steals' };
// Derived defensive event skills for players without data (prospects, old saves).
export function deriveDefSkills(p) { const r = p.ratings, ht = (p.h / 2.54 - 79) / 3;
  // specialists: shot blocking is mostly size + interior defense, steals mostly hands/feet on the perimeter, both with wide spread
  if (r.blk == null) r.blk = clamp(Math.round(36 + (r.idef - 50) * 0.45 + ht * 13 + normal(0, 9)), 20, 95);
  if (r.stl == null) r.stl = clamp(Math.round(44 + (r.pdef - 50) * 0.45 - ht * 4 + normal(0, 10)), 20, 95); }
const W = {
  PG: { pas: .22, han: .18, out: .2, ins: .08, pdef: .12, idef: .02, reb: .03, ath: .08, iq: .07 },
  SG: { out: .25, ins: .12, han: .12, pas: .1, pdef: .13, idef: .03, reb: .05, ath: .1, iq: .1 },
  SF: { out: .17, ins: .17, han: .08, pas: .08, pdef: .12, idef: .08, reb: .1, ath: .1, iq: .1 },
  PF: { ins: .22, out: .07, reb: .2, idef: .17, pdef: .06, pas: .05, han: .03, ath: .1, iq: .1 },
  C:  { ins: .22, reb: .22, idef: .25, out: .02, pdef: .03, pas: .04, han: .02, ath: .1, iq: .1 },
};
export function ovrFromAttrs(r, pos) {
  const w = W[pos]; let s = 0; for (const k of ATTRS) s += (r[k] || 0) * w[k]; return Math.round(clamp(s, 25, 99));
}
const inches = (cm) => cm / 2.54;
export function posFrom(hcm, astp = null, drb = null) {
  const h = inches(hcm);
  if (astp != null && drb != null) {
    const big = (h - 79) + clamp((drb - 0.14) / 0.06, -2, 2) * 1.2 - clamp((astp - 0.13) / 0.09, -2, 3) * 1.0;
    return big < -4 ? 'PG' : big < -1.5 ? 'SG' : big < 0.5 ? 'SF' : big < 3.6 ? 'PF' : 'C';
  }
  if (astp != null && astp > 0.26 && h < 79) return 'PG';
  if (h < 75.5) return 'PG';
  if (h < 78.5) return astp != null && astp > 0.2 ? 'PG' : 'SG';
  if (h < 80.5) return 'SF';
  if (h < 82.5) return 'PF';
  return 'C';
}
// percentile -> OVR anchor table (our own calibration)
const PCT = [[0, 40], [0.1, 45], [0.3, 51], [0.5, 57], [0.7, 64], [0.85, 71], [0.93, 77], [0.97, 83], [0.99, 89], [1, 96]];
export function pctToOvr(p) {
  for (let i = 1; i < PCT.length; i++) if (p <= PCT[i][0]) {
    const [p0, o0] = PCT[i - 1], [p1, o1] = PCT[i]; return o0 + (o1 - o0) * (p - p0) / (p1 - p0);
  }
  return 96;
}
const z = (x, m, s) => clamp((x - m) / s, -3, 3.5);

// Own formula: production index from public per-game facts, shrunk by games played.
// Round 7 audit vs public 1996-97 context (All-NBA teams, MVP voting; see NOTES.md):
// - scoring z capped at 4.5 (was 3.5) so a scoring champion keeps his edge over the next scorer
// - on-court net rating 0.4 (was 0.25): team impact matters for stars
// - per-game rebounds 0.3 (was 0.45); elite rebounding *rate* beyond 2.3 SD earns a specialist credit (Rodman-type)
// - steals 0.42 (was 0.35)
// Round 8 audit (All-NBA 1st-3rd, All-Defensive; defensive box data now complete for 436/441 incl. Kevin Johnson / Iverson):
// - assists 0.45 (was 0.5), per-game rebounds 0.4 (was 0.3): the old mix over-rated pass-first PGs vs forwards
// - scoring-volume premium 1.6 x max(0, z(pts) - 2) (~18.5+ ppg, convex): high-volume efficient scorers (Rice, Richmond)
// - all-around credit 0.45 x weakest of z(pts, reb, ast) (Mason 16/11/6 type)
// - net 0.45; plus a team-context term in finalizeStartRatings (lead players on winning teams)
const zt = (x, m, s, hi) => clamp((x - m) / s, -3, hi);
export function productionIndex(r) {
  const w = r.gp / (r.gp + 12);
  const s = 1.0 * zt(r.pts, 7.5, 5.5, 4.5) + 0.4 * zt(r.reb, 3.6, 2.5, 4.5) + 0.45 * zt(r.ast, 1.9, 1.7, 4.5)
    + 0.35 * z(r.ts, 0.51, 0.06) * clamp(r.usg / 0.18, 0.5, 1.5) + 0.45 * z(r.net, -2, 9)
    + (r.blk36 != null ? 0.5 * clamp(z(r.blk36, 0.75, 0.65), -1.5, 4) * clamp((r.defMin || 1200) / 1500, 0.3, 1) + 0.42 * clamp(z(r.stl36, 1.15, 0.4), -1.5, 3.5) * clamp(r.gp / 60, 0.3, 1) : 0);
  const trb = ((r.orb ?? 0.06) + (r.drb ?? 0.14)) / 2, spec = 1.6 * Math.max(0, zt(trb, 0.10, 0.045, 5) - 2.3);
  const zp = zt(r.pts, 7.5, 5.5, 9), zr = zt(r.reb, 3.6, 2.5, 9), za = zt(r.ast, 1.9, 1.7, 9);
  const vol = 1.6 * Math.max(0, zp - 2), vers = 0.45 * clamp(Math.min(zp, zr, za), 0, 2.5);
  return w * (s + spec + vol + vers) + (1 - w) * -1.2;
}
// Team context: the top three players of each real 1996-97 team (by production) get credit for team wins vs .500,
// weighted 1 / 0.7 / 0.4 and by games played (public team records; how award voters weigh winning).
export function applyTeamContext(players, teamWins) {
  if (!teamWins) return;
  const byT = {}; for (const p of players) if (p._raw?.t && p._prod != null) (byT[p._raw.t] ||= []).push(p);
  for (const [t, xs] of Object.entries(byT)) {
    const tw = clamp(((teamWins[t] ?? 41) - 41) / 20, -1, 1.4); xs.sort((a, b) => b._prod - a._prod);
    xs.slice(0, 3).forEach((p, i) => { p._prod += 0.9 * tw * [1, 0.7, 0.4][i] * clamp((p._raw.gp || 0) / 60, 0, 1); });
  }
}

let NEXT_PID = 1;
export const setNextPid = (n) => { NEXT_PID = n; };
export const getNextPid = () => NEXT_PID;

function baseShell(name, age, hcm, wkg, pos, extra = {}) {
  return { pid: NEXT_PID++, name, age: Math.floor(age), born: 0, h: hcm, w: wkg, pos, tid: -1, ratings: {}, ovr: 0, pot: 0,
    contract: null, injury: null, stats: {}, career: [], awards: [], hist: [], college: '', country: 'USA',
    draft: null, traits: genTraits(), devTrait: 'Normal', mood: 50, retired: false, ...extra };
}
function genTraits() {
  return { work: pick(['Low', 'Medium', 'Medium', 'High', 'High']), personality: pick(['Leader', 'Team Player', 'Quiet', 'Competitor', 'Diva', 'Mercenary', 'Loyal']),
    ambition: randInt(20, 95), loyalty: randInt(10, 95), greed: randInt(10, 95) };
}
// Build attribute set around a target OVR with tilts, then re-center so ovrFromAttrs == target.
export function buildAttrs(target, pos, tilt) {
  const r = {};
  for (const k of ATTRS) r[k] = target + (tilt[k] || 0) + normal(0, 2.5);
  let calc = 0; const w = W[pos]; for (const k of ATTRS) calc += r[k] * w[k];
  const shift = target - calc; for (const k of ATTRS) r[k] = clamp(Math.round(r[k] + shift), 20, 99);
  // clamping at 20/99 loses OVR for extreme players (a 99 can't go higher): push the remainder onto attributes with room
  for (let it = 0; it < 4; it++) {
    let cur = 0; for (const k of ATTRS) cur += r[k] * w[k]; const d = target - cur; if (Math.abs(d) < 0.5) break;
    const room = ATTRS.filter(k => d > 0 ? r[k] < 99 : r[k] > 20), ws = room.reduce((t, k) => t + w[k], 0); if (!ws) break;
    for (const k of room) r[k] = clamp(Math.round(r[k] + d / ws), 20, 99);
  }
  return r;
}
function heightTilt(hcm) { return (inches(hcm) - 79) / 3; }

// well-known players' real primary positions, so height/stat inference can't mislabel stars
export const POS_OVERRIDE = { 'Kobe Bryant': 'SG', 'Robert Horry': 'PF', 'Michael Jordan': 'SG', 'Scottie Pippen': 'SF', 'Reggie Miller': 'SG', 'Ray Allen': 'SG', 'Allen Iverson': 'PG', 'Grant Hill': 'SF', "Shaquille O'Neal": 'C', 'Tim Duncan': 'PF', 'Kevin Garnett': 'PF', 'Dirk Nowitzki': 'PF', 'Vince Carter': 'SG', 'Tracy McGrady': 'SF', 'Clyde Drexler': 'SG', 'Mitch Richmond': 'SG', 'Penny Hardaway': 'PG', 'Anfernee Hardaway': 'PG', 'Gary Payton': 'PG', 'John Stockton': 'PG', 'Jason Kidd': 'PG', 'Karl Malone': 'PF', 'Charles Barkley': 'PF', 'Dennis Rodman': 'PF', 'Hakeem Olajuwon': 'C', 'David Robinson': 'C', 'Patrick Ewing': 'C', 'Alonzo Mourning': 'C', 'Shawn Kemp': 'PF', 'Chris Webber': 'PF', 'Glen Rice': 'SF', 'Latrell Sprewell': 'SG', 'Paul Pierce': 'SF', 'Kevin Durant': 'SF', 'LeBron James': 'SF', 'Dwyane Wade': 'SG', 'Carmelo Anthony': 'SF', 'Yao Ming': 'C', 'Steve Nash': 'PG', 'Pau Gasol': 'PF', 'Tony Parker': 'PG', 'Manu Ginobili': 'SG' };
// multi-position eligibility: primary + 1-2 secondaries playable with no penalty
export const POS_ELIG = { 'Kobe Bryant': ['SG', 'SF'], 'Derek Fisher': ['PG', 'SG'], 'LeBron James': ['SF', 'PF', 'PG'], 'Tim Duncan': ['PF', 'C'], 'Kevin Garnett': ['PF', 'C'],
  'Scottie Pippen': ['SF', 'PF', 'SG'], 'Michael Jordan': ['SG', 'SF'], 'Magic Johnson': ['PG', 'SF'], 'Robert Horry': ['PF', 'SF'], 'Rasheed Wallace': ['PF', 'C'], 'Nick Van Exel': ['PG', 'SG'], 'Eddie Jones': ['SG', 'SF'], 'Ron Harper': ['SG', 'PG'], 'Toni Kukoc': ['PF', 'SF'],
  'Grant Hill': ['SF', 'PG'], 'Tracy McGrady': ['SF', 'SG'], 'Vince Carter': ['SG', 'SF'], 'Dirk Nowitzki': ['PF', 'C'], 'Chris Webber': ['PF', 'C'], 'Karl Malone': ['PF'], "Shaquille O'Neal": ['C'], 'Dennis Rodman': ['PF', 'C'],
  'Allen Iverson': ['PG', 'SG'], 'Penny Hardaway': ['PG', 'SG'], 'Anfernee Hardaway': ['PG', 'SG'], 'Toni Kukoc': ['PF', 'SF'], 'Charles Barkley': ['PF', 'SF'], 'Paul Pierce': ['SF', 'SG'], 'Kevin Durant': ['SF', 'PF'] };
const ADJ_UP = { PG: 'SG', SG: 'SF', SF: 'PF', PF: 'C', C: null }, ADJ_DN = { PG: null, SG: 'PG', SF: 'SG', PF: 'SF', C: 'PF' };
const POS_H = { PG: 188, SG: 196, SF: 201, PF: 206, C: 211 };
export function derivePos2(p) { const nat = p.natPos || p.pos; const up = ADJ_UP[nat], dn = ADJ_DN[nat]; if (!up) return [dn]; if (!dn) return [up]; return [(p.h || POS_H[nat]) >= POS_H[nat] ? up : dn]; }
export function eligiblePos(p) { if (!p.pos2) { const e = POS_ELIG[p.name]; p.pos2 = e && p.real !== false ? e.slice(1) : derivePos2(p); } return [p.natPos || p.pos, ...p.pos2.filter(x => x !== (p.natPos || p.pos))]; }
export function posLabel(p) { const e = eligiblePos(p); return [p.pos, ...e.filter(x => x !== p.pos)].slice(0, 3).join('/'); }
// real 1996-97 opening-night-style starting fives (lineup tiebreak only; ratings unchanged)
export const REAL_STARTERS = { CHI: ['Ron Harper', 'Michael Jordan', 'Scottie Pippen', 'Dennis Rodman', 'Luc Longley'], UTA: ['John Stockton', 'Jeff Hornacek', 'Bryon Russell', 'Karl Malone', 'Greg Ostertag'],
  LAL: ['Nick Van Exel', 'Eddie Jones', 'Robert Horry', 'Elden Campbell', "Shaquille O'Neal"], MIA: ['Tim Hardaway', 'Voshon Lenard', 'Jamal Mashburn', 'P.J. Brown', 'Alonzo Mourning'],
  SEA: ['Gary Payton', 'Hersey Hawkins', 'Detlef Schrempf', 'Shawn Kemp', 'Jim McIlvaine'], HOU: ['Matt Maloney', 'Clyde Drexler', 'Mario Elie', 'Charles Barkley', 'Hakeem Olajuwon'],
  NYK: ['Chris Childs', 'Allan Houston', 'Larry Johnson', 'Charles Oakley', 'Patrick Ewing'], ORL: ['Anfernee Hardaway', 'Dennis Scott', 'Nick Anderson', 'Horace Grant', 'Rony Seikaly'],
  PHO: ['Jason Kidd', 'Rex Chapman', 'Cedric Ceballos', 'Danny Manning', 'John Williams'], IND: ['Mark Jackson', 'Reggie Miller', 'Derrick McKey', 'Dale Davis', 'Rik Smits'],
  DET: ['Lindsey Hunter', 'Joe Dumars', 'Grant Hill', 'Otis Thorpe', 'Terry Mills'], ATL: ['Mookie Blaylock', 'Steve Smith', 'Tyrone Corbin', 'Christian Laettner', 'Dikembe Mutombo'],
  POR: ['Kenny Anderson', 'Isaiah Rider', 'Clifford Robinson', 'Rasheed Wallace', 'Arvydas Sabonis'], CHH: ['Muggsy Bogues', 'Anthony Mason', 'Glen Rice', 'Larry Johnson', 'Vlade Divac'] };
const ovPos = (name, pos) => POS_OVERRIDE[name] || pos;
export function playerFromStats(raw, season) {
  const pos = ovPos(raw.n, /^(PG|SG|SF|PF|C)$/.test(raw.pos || '') ? raw.pos : posFrom(raw.h, raw.astp, raw.drb)); // historic rows carry the listed position
  const p = baseShell(raw.n, raw.age, raw.h, raw.w, pos, { college: raw.col, country: raw.ctry });
  const ht = heightTilt(raw.h);
  const zp = z(raw.pts, 7.5, 5.5), zu = z(raw.usg, 0.18, 0.045), zts = z(raw.ts, 0.51, 0.06), za = z(raw.astp, 0.13, 0.09);
  const zo = z(raw.orb, 0.06, 0.04), zd = z(raw.drb, 0.14, 0.06), zn = z(raw.net, -2, 9);
  const tilt = {
    ins: 6 * (ht * 0.6 + zo * 0.4 + zts * 0.3), out: 6 * (-ht * 0.6 + zts * 0.3 + za * 0.2),
    pas: 8 * za, han: 6 * (za * 0.6 - ht * 0.4), reb: 8 * (zo * 0.5 + zd * 0.5), idef: 6 * (ht * 0.7 + zd * 0.3),
    pdef: 5 * (-ht * 0.5) + 3 * zn, ath: 5 * ((27 - raw.age) / 4), iq: 4 * ((raw.age - 26) / 4) + 3 * zn,
  };
  if (raw.blk36 != null) { const zb = clamp(z(raw.blk36, 0.75, 0.65), -1.5, 4), zs = clamp(z(raw.stl36, 1.15, 0.4), -1.5, 3.5);
    tilt.idef += 4 * zb; tilt.pdef += 4 * zs;
    p.ratings.blk = clamp(Math.round(52 + 12 * zb), 20, 99); p.ratings.stl = clamp(Math.round(52 + 13 * zs), 20, 99); }
  // injury-shortened 1996-97 (e.g. David Robinson, 6 GP): blend in the 1995-96 line from Wikipedia so the rating reflects the player (weight 0.6: the older season is less certain)
  const alt = raw.alt && raw.gp < 30 ? { ...raw, gp: Math.round(raw.gp + raw.alt.gp * 0.6), pts: (raw.pts * raw.gp + raw.alt.pts * raw.alt.gp * 0.6) / (raw.gp + raw.alt.gp * 0.6),
    reb: (raw.reb * raw.gp + raw.alt.reb * raw.alt.gp * 0.6) / (raw.gp + raw.alt.gp * 0.6), ast: (raw.ast * raw.gp + raw.alt.ast * raw.alt.gp * 0.6) / (raw.gp + raw.alt.gp * 0.6) } : raw;
  // two-season window: blend the 1995-96 box line (Wikipedia) 70/30 into points/rebounds/assists for everyone
  // with a full 1996-97 (efficiency and net rating stay 1996-97) to smooth one-season noise
  let cur = alt;
  if (raw.prev && raw.gp >= 30) { const wp = 0.3 * Math.min(1, raw.prev.gp / 60), wc = 1 - wp;
    cur = { ...alt, pts: wc * alt.pts + wp * raw.prev.pts, reb: wc * alt.reb + wp * raw.prev.reb, ast: wc * alt.ast + wp * raw.prev.ast }; }
  p._prod = productionIndex(cur); p._tilt = tilt; p._raw = raw;
  p.ratings.sco = clamp(Math.round(55 + 10 * zu + 5 * zp), 25, 99);
  p.ratings.sta = clamp(Math.round(68 + (raw.gp - 55) / 3 + (27 - raw.age) * 0.6), 40, 99);
  p.ratings.dur = clamp(Math.round(55 + raw.gp / 2.4 + normal(0, 6)), 30, 99);
  p.draft = raw.dy ? { year: raw.dy, round: raw.dr, pick: raw.dp, tid: null } : { year: null, round: null, pick: null };
  p.born = season - Math.round(raw.age) - 1;
  return p;
}
// Called after all start players created: assign OVR by percentile of production.
export function finalizeStartRatings(players, teamWins) {
  applyTeamContext(players, teamWins);
  const sorted = [...players].sort((a, b) => a._prod - b._prod);
  // top end: above the 97th percentile, OVR follows the size of the production gap (not just rank),
  // so near-equal stars get near-equal ratings and a clear #1 stands out
  const i97 = Math.round(0.97 * (sorted.length - 1)), v97 = sorted[i97]._prod, vMax = sorted.at(-1)._prod;
  sorted.forEach((p, i) => {
    const pct = i / (sorted.length - 1);
    const target = Math.round(i > i97 && vMax > v97 ? 83 + 11 * Math.pow((p._prod - v97) / (vMax - v97), 0.5) : pctToOvr(pct));
    Object.assign(p.ratings, buildAttrs(target, p.pos, p._tilt));
    deriveDefSkills(p);
    p.ovr = ovrFromAttrs(p.ratings, p.pos);
    p.pot = Math.max(p.ovr, Math.round(p.ovr + expectedGrowth(p.age) + Math.abs(normal(0, 2.5)) * (p.age < 25 ? 1 : 0.3)));
    delete p._prod; delete p._tilt; delete p._raw;
  });
}
export function expectedGrowth(age) {
  return age <= 18 ? 18 : age <= 19 ? 15 : age <= 20 ? 12 : age <= 21 ? 10 : age <= 22 ? 8 : age <= 23 ? 6 : age <= 24 ? 4 : age <= 25 ? 2.5 : age <= 26 ? 1 : 0;
}
// histPot maps real-career peak production to a peak OVR (used only with the optional historical-tendency setting)
// steeper map so only true superstars reach the top: Odom 35 -> 75, Bosh 41 -> 81, Dirk 45 -> 88, Duncan 49 -> 94, LeBron 55 -> 97
export const histPotFromPeak = (peak) => clamp(40 + peak + Math.max(0, peak - 40) * 0.6, 50, 97);
// 1996 start roster: young players whose real careers made them stars (public award history), in the same peak units
export const START_FUTURE = { 'Kobe Bryant': 50, 'Kevin Garnett': 50, 'Steve Nash': 46, 'Allen Iverson': 46, 'Ray Allen': 42, 'Jermaine O\'Neal': 40, 'Ben Wallace': 38, 'Stephon Marbury': 40, 'Shareef Abdur-Rahim': 39, 'Antoine Walker': 37, 'Peja Stojakovic': 39, 'Rasheed Wallace': 39, 'Michael Finley': 37, 'Zydrunas Ilgauskas': 36 };

export function prospectFromReal(raw, draftYear, opts = {}) {
  const pos = ovPos(raw.n, /^(PG|SG|SF|PF|C)$/.test(raw.pos || '') ? raw.pos : posFrom(raw.h, null)); // real listed position when the draft page has it
  const p = baseShell(raw.n, raw.age, raw.h, raw.w, pos, { college: raw.col, country: raw.ctry });
  const slot = raw.dp || 61;
  let base = raw.dr === 1 ? 61 - 0.33 * (slot - 1) : raw.dr === 2 ? 49 - 0.12 * (slot - 30) : 44;
  base += -(22 - raw.age) * 1.0 + normal(0, 3);
  fillProspect(p, base, opts, raw.peak);
  p.real = true; p.projPick = raw.dp || null; p.born = draftYear - Math.round(raw.age);
  return p;
}
function fillProspect(p, base, opts, peak = null) {
  const ht = heightTilt(p.h);
  const tilt = { ins: 5 * ht, out: -5 * ht, pas: -4 * ht + normal(0, 4), han: -5 * ht + normal(0, 3), reb: 6 * ht, idef: 6 * ht, pdef: -3 * ht, ath: normal(3, 4), iq: -4 };
  const target = Math.round(clamp(base, 35, 72));
  Object.assign(p.ratings, buildAttrs(target, p.pos, tilt));
  p.ratings.sco = clamp(Math.round(42 + (target - 50) * 0.8 + normal(0, 9)), 25, 92); // scorers come in all sizes; develops with the player
  p.ratings.sta = clamp(Math.round(70 + normal(0, 7)), 45, 95);
  p.ratings.dur = clamp(Math.round(72 + normal(0, 10)), 35, 99);
  deriveDefSkills(p);
  p.ovr = ovrFromAttrs(p.ratings, p.pos);
  const E = Math.max(2, (24.5 - p.age) * 3.4 + 5);
  let growth = E * (0.25 + 1.5 * Math.pow(rand(), 1.4));
  if (rand() < (opts.fillIn ? 0.02 : 0.07)) growth += randInt(6, 14); // late bloomers / hidden stars
  let pot = p.ovr + growth;
  const h = opts.histTendency || 0;
  // real careers: stars (high real peak) follow history more firmly so Duncan/KG/Kobe/LeBron usually become stars
  if (h > 0 && peak != null) { const hp = histPotFromPeak(peak); p.histPot = hp; const hh = Math.min(0.92, h + (hp >= 85 ? (1 - h) * 0.5 : 0)); pot = (1 - hh) * pot + hh * Math.max(p.ovr + 1, hp); }
  // generated fill-ins in real-draft years rarely become superstars
  if (opts.fillIn && h > 0) { p.histPot = rand() < 0.04 ? 84 : 74; pot = Math.min(pot, p.histPot + 2); }
  p.pot = Math.round(clamp(pot, p.ovr, 99));
}
const FIRST = ['Marcus','Darnell','Tyrone','Kevin','Andre','Jamal','Chris','Brandon','Derrick','Travis','Lamar','Corey','Jalen','Isaiah','Trevor','Malik','Damon','Reggie','Terrence','Elijah','Jordan','Xavier','Rashad','Victor','Dante','Lionel','Caleb','Rodney','Shawn','Quentin','Bryce','Omar','Felipe','Luka','Nikos','Tomas','Andrei','Yusuf','Kofi','Emeka','Hugo','Mateo','Darius','Aaron','Julian','Wesley','Cedric','Garrett','Mason','Tobias'];
const LAST = ['Whitfield','Carver','Holloway','Bannister','Pruitt','Calloway','Mercer','Dawkins','Rutledge','Ashby','Langford','Beaumont','Okafor','Petrovic','Marquez','Hensley','Sutton','Vance','Maddox','Kimbrough','Stroud','Ellery','Fairchild','Grissom','Hawthorne','Ingram','Jessup','Kearney','Lockett','Mabry','Norwood','Oakes','Pettiford','Quarles','Radcliffe','Sandoval','Tolliver','Underwood','Varga','Winslow','Yarbrough','Zeller','Achebe','Brankovic','Delacroix','Esposito','Fontaine','Gallardo','Halvorsen','Ivanov'];
const COLLEGES = ['State U.','Tech','A&M','Central','Pacific','Northern','Coastal','Valley','Baptist','Methodist'];
// Names weighted by real frequency (PGM2 1.5.0 idea): ~65% of names come from public NBA roster frequency tables,
// first names from the debut era matching the draft year (so 2015 classes read differently from 1998), the rest from
// our invented pool for variety. Exact matches with real players are re-rolled.
const NW = {}; let REAL = null;
function wpick(key, list) {
  const t = NW[key] ||= (() => { let c = 0; const cum = list.map(([, w]) => (c += w)); return { cum, tot: c }; })();
  const x = rand() * t.tot; let lo = 0, hi = t.cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t.cum[m] > x) hi = m; else lo = m + 1; }
  return list[lo][0];
}
export function nameEra(year) {
  if (year == null) return 'e1';
  const b = year <= 2003 ? 0 : year <= 2011 ? 1 : 2, eras = ['e1', 'e2', 'e3'];
  const r = rand(); return eras[clamp(b + (r < 0.12 ? -1 : r > 0.88 ? 1 : 0), 0, 2)];
}
export function genName(year) {
  REAL ||= new Set(NAME_DATA.real);
  for (let i = 0; i < 8; i++) {
    const era = nameEra(year);
    const f = rand() < 0.65 ? wpick(era, NAME_DATA.first[era]) : pick(FIRST);
    const l = rand() < 0.65 ? wpick('last', NAME_DATA.last) : pick(LAST);
    const n = `${f} ${l}`; if (!REAL.has(n)) return n;
  }
  return `${pick(FIRST)} ${pick(LAST)}`;
}
export function generateProspect(draftYear, quality = 0, opts = {}) {
  const pos = pick(['PG', 'SG', 'SF', 'PF', 'C']);
  const hcm = { PG: 188, SG: 196, SF: 201, PF: 206, C: 211 }[pos] + normal(0, 3);
  const age = randInt(19, 23);
  const p = baseShell(genName(draftYear), age, Math.round(hcm * 10) / 10, Math.round((hcm - 100) * 1.05), pos,
    { college: rand() < 0.2 ? 'International' : `${pick(LAST)} ${pick(COLLEGES)}`, country: rand() < 0.2 ? pick(['France', 'Serbia', 'Spain', 'Nigeria', 'Australia', 'Brazil', 'Lithuania']) : 'USA' });
  fillProspect(p, 46 + quality + normal(0, 5) - (22 - age), opts);
  p.real = false; p.born = draftYear - age;
  return p;
}
export function generateVeteran(season, ovrTarget) {
  const p = generateProspect(season, 0);
  p.age = randInt(24, 33); p.born = season - p.age;
  Object.assign(p.ratings, buildAttrs(ovrTarget, p.pos, {}));
  p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = p.ovr; return p;
}

// Displayed development trait (Pocket-GM-style arrows), derived from hidden remaining growth + age.
export function devTrait(p) {
  if (p.age >= 35) return 'Fast Decline'; if (p.age >= 33) return 'Decline'; if (p.age >= 31) return 'Slow Decline';
  const rem = p.pot - p.ovr;
  if (p.age >= 28 || rem < 2) return 'Peaked';
  return rem >= 12 ? 'Super' : rem >= 7 ? 'Quick' : rem >= 3.5 ? 'Normal' : 'Slow';
}
export const DEV_ICON = { Super: '▲▲▲', Quick: '▲▲', Normal: '▲', Slow: '△', Peaked: '—', 'Slow Decline': '▼', Decline: '▼▼', 'Fast Decline': '▼▼▼' };

// Annual progression. ctx: {coachDev (0-100), motivator, minutes (per game last season)}
// Offseason development. Age curve modeled on public NBA aging studies (box-score metrics rise ~+3/yr at 20-22,
// flatten by 26-28, fall ~-1/yr at 30 and faster after 32). Young players move toward a hidden, drifting potential;
// rare events create late bloomers (potential jumps) and busts (potential collapses). No upward ratchets: noise is
// symmetric and growth past potential is capped, so the league-wide level stays stable over decades.
export const PROG = { frac0: 0.06, fracR: 0.3, bloom: 0.045, bust: 0.05, potDrift: -0.35 };
const AGE_W = { ath: 1.6, pdef: 1.3, sta: 1.1, dur: 1.0, han: 0.85, sco: 0.85, ins: 0.75, reb: 0.8, idef: 0.75, out: 0.35, pas: 0.4, iq: 0 };
// Real players known for unusually long primes (public career facts) get a longevity tendency; everyone else rolls one.
const IRONMEN = new Set(['John Stockton', 'Karl Malone', 'Robert Parish', 'Reggie Miller', 'Dikembe Mutombo', 'Kevin Willis', 'Sam Perkins',
  'Hakeem Olajuwon', 'Michael Jordan', 'Patrick Ewing', 'Clifford Robinson', 'Buck Williams', 'Kevin Garnett', 'Tim Duncan', 'Jason Kidd', 'Steve Nash', 'Ray Allen', 'Dirk Nowitzki', 'Vince Carter', 'Kobe Bryant']);
export function longevity(p) {
  if (p.lon == null) { let l = clamp(normal(1, 0.18), 0.7, 1.35); if (IRONMEN.has(p.name)) l = Math.min(l, 0.62); p.lon = Math.round(l * 100) / 100; }
  const work = p.traits?.work === 'High' ? 0.88 : p.traits?.work === 'Low' ? 1.1 : 1;
  return p.lon * work * ((p.ratings?.dur ?? 70) >= 85 ? 0.92 : 1);
}
export function progress(p, ctx = {}) {
  const before = p.ovr; p.age += 1; const a = p.age;
  const work = p.traits.work === 'High' ? 1 : p.traits.work === 'Low' ? -1 : 0;
  let gain, event = null;
  if (a <= 26) {
    if (rand() < PROG.bloom * (a <= 23 ? 1 : 0.6)) { p.pot = Math.min(99, p.pot + randInt(4, 10)); event = 'bloom'; }
    else if (rand() < PROG.bust) { p.pot = Math.max(p.ovr, p.pot - randInt(4, 10)); event = 'bust'; }
    p.pot = Math.round(clamp(p.pot + normal(PROG.potDrift, 1.3), p.ovr - 1, 99));
    const rem = Math.max(0, p.pot - p.ovr);
    let frac = PROG.frac0 + rand() * PROG.fracR + work * 0.07 + ((ctx.coachDev || 60) - 60) / 450 + (ctx.motivator ? 0.04 : 0) + ((ctx.minutes || 0) >= 20 ? 0.04 : 0);
    if (a >= 25) frac *= 0.85;
    if (rand() < 0.08) frac += 0.25; if (rand() < 0.07) frac = 0;
    gain = rem * clamp(frac, 0, 0.9) + normal(0, 1.1);
    if (p.ovr + gain > p.pot + 1) gain = p.pot + 1 - p.ovr;
  } else if (a <= 28) gain = normal(a === 27 ? 0.1 : -0.5, 1.3) + work * 0.3;
  else if (a <= 30) gain = normal(a === 29 ? -1.0 : -1.4, 1.3) + work * 0.3;
  else gain = -(1.3 + (a - 31) * 0.6) - rand() * 1.4 + work * 0.4;
  const lon = longevity(p), declining = a >= 28 && gain < 0, big = p.pos === 'C' || p.pos === 'PF';
  for (const k of ATTRS) {
    let g = gain * (0.7 + rand() * 0.6);
    // skill-based aging: athleticism and perimeter defense go first; shooting, passing, IQ and size skills hold
    if (declining) g *= (big && (k === 'idef' || k === 'reb' || k === 'ins') ? 0.6 : AGE_W[k]) * lon;
    if (k === 'ath' && a >= 29) g -= (0.4 + rand() * 0.8) * lon;
    if (k === 'iq' && a >= 24 && a <= 34) g += 0.5;
    p.ratings[k] = clamp(Math.round(p.ratings[k] + g), 20, 99);
  }
  { // shot creation (usage) develops and ages like a skill
    let gs = gain * (0.8 + rand() * 0.4) + (a <= 25 ? 0.6 : 0); if (declining) gs *= AGE_W.sco * lon;
    p.ratings.sco = clamp(Math.round(p.ratings.sco + gs), 25, 99);
    deriveDefSkills(p);
    for (const [k, aw] of [['blk', 0.55], ['stl', 1.2]]) { let gd = gain * (0.25 + rand() * 0.35) + (a <= 24 ? 0.3 : 0); if (declining) gd *= aw * lon; p.ratings[k] = clamp(Math.round(p.ratings[k] + gd), 20, 99); } }
  if (a >= 30) p.ratings.sta = clamp(p.ratings.sta - randInt(0, 3), 30, 99);
  p.ovr = ovrFromAttrs(p.ratings, p.pos);
  if (a > 26) p.pot = p.ovr; else p.pot = Math.max(p.pot, p.ovr);
  if (event) p.devEvent = { season: ctx.season, type: event };
  p.devTrait = devTrait(p);
  return p.ovr - before;
}
// League anchor: keep the league's level (top-150 mean) and its star tail (top-10 mean) near their starting values.
// Level: everyone's attributes shift equally. Tail: only players above 78 are stretched/compressed, proportional to how
// far above 78 they are, so ordering is preserved and busts/late bloomers are unaffected.
// Per-attribute elite tail (top-40 mean of each attribute) — keeps e.g. shot creation from fading once the real 1996 stars retire.
export function attrTops(players) { const act = players.filter(p => p.tid >= 0); const o = {};
  for (const k of [...ATTRS, 'sco', 'blk', 'stl']) { const v = act.map(p => p.ratings[k]).filter(x => x != null).sort((a, b) => b - a).slice(0, 40); o[k] = Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10; } return o; }
export function anchorAttrTails(players, tops, strength = 0.5) {
  if (!tops) return; const act = players.filter(p => p.tid >= 0);
  for (const k of [...ATTRS, 'sco', 'blk', 'stl']) {
    if (tops[k] == null) continue; const v = act.map(p => p.ratings[k]).filter(x => x != null).sort((a, b) => b - a); if (v.length < 60) continue;
    const top = v.slice(0, 40); const cur = top.reduce((s, x) => s + x, 0) / 40; const d = (tops[k] - cur) * strength; if (Math.abs(d) < 0.6) continue;
    const thr = v[60], span = Math.max(1, v[0] - thr);
    for (const p of players) { if (p.retired || p.tid < -1) continue; const r = p.ratings[k]; if (r == null || r <= thr) continue;
      p.ratings[k] = clamp(Math.round(r + d * 1.6 * (r - thr) / span), 20, 99); }
  }
  for (const p of players) if (!p.retired && p.tid >= -1) { p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.pot, p.ovr); }
}
export function anchorRatings(players, target, strength = 0.6, tail = null) {
  const T = typeof target === 'object' && target ? target : { top150: target, top10: tail };
  const act = () => players.filter(p => p.tid >= 0).map(p => p.ovr).sort((a, b) => b - a);
  let a0 = act(); if (a0.length < 150 || T.top150 == null) return 0;
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const apply = (fn) => { for (const p of players) { if (p.retired || p.tid < -1) continue; const sh = fn(p); if (!sh) continue;
    for (const k of ATTRS) p.ratings[k] = clamp(Math.round(p.ratings[k] - sh + (rand() - 0.5) * 0.98), 20, 99);
    p.ovr = ovrFromAttrs(p.ratings, p.pos); p.pot = Math.max(p.ovr, Math.round(p.pot - sh)); } };
  let sh = Math.round((mean(a0.slice(0, 150)) - T.top150) * strength * 10) / 10;
  if (Math.abs(sh) >= 0.25) apply(() => sh); else sh = 0;
  if (T.top10 != null) {
    const a1 = act(); const d = (mean(a1.slice(0, 10)) - T.top10) * 0.45; const span = Math.max(1, a1[0] - 78);
    if (Math.abs(d) >= 0.4) apply(p => p.ovr > 78 ? Math.round(d * (p.ovr - 78) / span * 1.6 * 10) / 10 : 0);
  }
  return sh;
}

// Market value per year ($K) using our own curve against the cap
export function marketValue(p, season) {
  const cap = capFor(season);
  let v = p.ovr; if (p.age <= 24) v = 0.65 * p.ovr + 0.35 * p.pot; if (p.age >= 32) v -= (p.age - 31) * 1.2;
  const amt = cap * 0.015 * Math.exp(0.095 * (v - 50));
  return Math.round(clamp(amt, minSalary(season), maxSalary(season, p)) / 10) * 10;
}
export function scoutedPot(p, accuracy, salt = 0) {
  // deterministic noise per player so the display doesn't flicker
  const s = Math.sin((p.pid + 1) * 12.9898 + salt * 78.233) * 43758.5453; const n = (s - Math.floor(s)) * 2 - 1;
  const err = (100 - clamp(accuracy, 20, 100)) / 6;
  return Math.round(clamp(p.pot + n * err, p.ovr, 99));
}

// ---------- displayed rating scale (40-99) ----------
// Internal ratings drive the sim unchanged. What players see is a monotonic remap onto a familiar
// 40-99 basketball-game scale, calibrated on our own 1996-97 ratings (not copied from any game):
// MVP tier 94-98, All-Stars ~86-92, starters ~78-84, rotation ~72-77, bench ~62-70, floor 40.
const DISP_KNOTS = [[0, 40], [20, 40], [40, 62], [55, 69.5], [60, 71.5], [64, 78], [72, 83], [78, 86], [85, 90], [89, 92.5], [91, 95], [94, 98], [99, 99], [120, 99]];
export function dispRating(v) {
  if (v == null || typeof v !== 'number' || Number.isNaN(v)) return v;
  for (let i = 1; i < DISP_KNOTS.length; i++) { const [x1, y1] = DISP_KNOTS[i]; if (v <= x1) { const [x0, y0] = DISP_KNOTS[i - 1]; return Math.round(y0 + (y1 - y0) * (v - x0) / (x1 - x0 || 1)); } }
  return 99;
}
// inverse (smallest internal value that displays at least d), for thresholds written in display terms
export function internalFor(d) { for (let v = 0; v <= 100; v++) if (dispRating(v) >= d) return v; return 100; }

// ---------- custom roster files (PGM2-style imported leagues) ----------
// Ratings in files use the displayed 40-99 scale; they are converted to internal values here.
export const FILE_KEYS = [...ATTRS, 'blk', 'stl', 'sco', 'sta', 'dur'];
const POSS = ['PG', 'SG', 'SF', 'PF', 'C'];
export function playerFromFile(rec, season) {
  const hcm = clamp(+rec.height || { PG: 188, SG: 196, SF: 201, PF: 206, C: 211 }[rec.pos] || 200, 160, 235);
  const pos = POSS.includes(rec.pos) ? rec.pos : ovPos(rec.name, posFrom(hcm));
  const age = clamp(Math.round(+rec.age || 25), 18, 45);
  const p = baseShell(String(rec.name).slice(0, 40), age, hcm, clamp(+rec.weight || Math.round((hcm - 100) * 1.05), 60, 180), pos, { college: rec.college || '', country: rec.country || 'USA' });
  const R = rec.ratings || {}, X = rec.exact || {}, inv0 = (d) => internalFor(clamp(Math.round(+d), 40, 99));
  const inv = (d, k) => k && X[k] != null && dispRating(+X[k]) === Math.round(+d) ? clamp(Math.round(+X[k]), 20, 99) : inv0(d);
  const given = ATTRS.filter(k => R[k] != null && !Number.isNaN(+R[k]));
  if (given.length === ATTRS.length) for (const k of ATTRS) p.ratings[k] = clamp(inv(R[k], k), 20, 99);
  else { // partial or none: build around the given overall, keeping any attributes that were provided
    const target = rec.ovr != null ? inv(rec.ovr) : 55;
    Object.assign(p.ratings, buildAttrs(target, pos, { ins: 4 * heightTilt(hcm), out: -4 * heightTilt(hcm), reb: 5 * heightTilt(hcm), idef: 5 * heightTilt(hcm) }));
    for (const k of given) p.ratings[k] = clamp(inv(R[k], k), 20, 99);
  }
  for (const k of ['blk', 'stl', 'sco', 'sta', 'dur']) if (R[k] != null && !Number.isNaN(+R[k])) p.ratings[k] = clamp(inv(R[k], k), 20, 99);
  p.ratings.sco ??= clamp(Math.round(45 + (ovrFromAttrs(p.ratings, pos) - 50) * 0.8), 25, 92);
  p.ratings.sta ??= 75; p.ratings.dur ??= 75;
  deriveDefSkills(p);
  p.ovr = ovrFromAttrs(p.ratings, pos);
  p.pot = rec.pot != null ? Math.max(p.ovr, inv(rec.pot, 'pot')) : Math.max(p.ovr, Math.round(p.ovr + expectedGrowth(age)));
  if (rec.num != null && /^\d{1,2}$/.test(String(rec.num))) p.num = String(rec.num);
  p.born = season - age - 1; p.custom = true;
  p.draft = rec.draftYear ? { year: +rec.draftYear, round: +rec.draftRound || null, pick: +rec.draftPick || null, tid: null } : { year: null, round: null, pick: null };
  return p;
}
