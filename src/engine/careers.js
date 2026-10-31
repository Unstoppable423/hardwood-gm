// Real career arcs (Franchise Setting "Player careers"): each real player's season-by-season standing among NBA
// players (public box-score facts 1996-97..2020-21, scripts/build_careers.py) is mapped by OUR rating formula
// (same percentile curve as the 1996 start ratings) to a target OVR for that season. Real: follow closely;
// Mostly real: halfway; Random: ignore (old random development + optional real-career tendency).
import { pctToOvr, ovrFromAttrs, internalFor } from './players.js';
import { normal, rand, clamp } from './rng.js';
export const CAREER_W = { real: 0.85, mostly: 0.5, random: 0 };
const ARC_END = 2020; // last season in the source data
export const normName = (n) => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ jr\.?| iii| ii/g, '').replace(/[^a-z]/g, '');
let IDX = null, IDXsrc = null;
function index(C) {
  if (IDXsrc === C) return IDX; IDXsrc = C; IDX = {};
  for (const k of Object.keys(C)) { const nm = k.split('|')[0]; (IDX[nm] ||= []).push(k); }
  return IDX;
}
export function careerOf(L, p) {
  const C = L.data?.careers; if (!C || p.arcKey === null || p.real === false) return null;
  const nm = normName(p.name); const dy = p.draft?.realYear ?? p.draft?.year;
  let k = p.arcKey || (C[nm + '|' + (dy ?? 'U')] ? nm + '|' + (dy ?? 'U') : null);
  if (!k) { const ks = index(C)[nm] || []; k = ks.length === 1 ? ks[0] : null; }
  if (!k && p.aka) { const na = normName(p.aka); k = C[na + '|' + (dy ?? 'U')] ? na + '|' + (dy ?? 'U') : ((index(C)[na] || []).length === 1 ? index(C)[na][0] : null); } // v45: real name changes (William Avery, Metta World Peace)
  p.arcKey = k; return k ? C[k] : null;
}
// top 3%: our own curve on the absolute production gap above the 97th percentile, so only a handful of historic seasons reach 99
export const arcTarget = (e) => Math.round(e[0] > 0.97 && e[1] > 0 ? 83 + 14 * Math.pow(Math.min(1, e[1] / 17), 0.7) : pctToOvr(e[0]));
export function careerMode(L) { return L.settings?.careers || 'real'; }
// Peak rating targets (display 40-99): the real arc is rescaled so its best season lands on this number.
// Defaults (Mitchell's call): Jordan and Kobe 99, LeBron 96. A per-player editor value (p.peakTarget) wins; null = real arc.
export const DEFAULT_PEAKS = { 'Michael Jordan': 99, 'Kobe Bryant': 99, 'LeBron James': 96 };
export function peakTargetOf(L, p) { if (p.peakTarget != null) return p.peakTarget; return careerMode(L) !== 'random' ? DEFAULT_PEAKS[p.name] ?? null : null; }
// peak = best season from the save's first season on (a 1996-97 save: Jordan's 1996-97 is his peak; a 1984-85 save: his late-1980s seasons)
export function arcMax(L, p) { const c = careerOf(L, p); if (!c) return null; const from = (L.histStart || 1997) - 1; const v = Object.entries(c.a).filter(([y]) => +y >= from).map(([, e]) => arcTarget(e)); return v.length ? Math.max(...v) : Math.max(...Object.values(c.a).map(arcTarget)); }
// display value of the player's real-career peak (what "blank" means)
export function realPeak(L, p) { const m = arcMax(L, p); return m == null ? null : m; }
function scaledTarget(L, p, t) {
  const pk = peakTargetOf(L, p); if (pk == null) return t; const mx = arcMax(L, p); if (mx == null) return t;
  const goal = internalFor(pk) + (pk >= 99 ? 0.6 : 0); // a hair over the 99 threshold so noise doesn't drop him to 98
  const f = clamp((t - 50) / Math.max(1, mx - 50), 0, 1); return t + (goal - mx) * f;
}
export function arcPot(L, p, fromSeason) {
  const c = careerOf(L, p); if (!c) return null;
  const fut = Object.entries(c.a).filter(([y]) => +y >= fromSeason).map(([, e]) => Math.round(scaledTarget(L, p, arcTarget(e))));
  return fut.length ? Math.max(...fut) : null;
}
// season S is about to start: pull the player toward his real level. Returns 'retire' when his real career is over.
export function applyArc(L, p, S) {
  if (p.arcOff) return null; const w = CAREER_W[careerMode(L)] || 0; if (!w) return null;
  const c = careerOf(L, p); if (!c) return null;
  const e = c.a[String(S)];
  if (!e) {
    const later = Object.keys(c.a).map(Number).filter(y => y > S).sort((a, b) => a - b);
    if (!later.length) return S <= ARC_END && (w >= 0.85 || rand() < w) ? 'retire' : null;
    // real gap: a single missed season under contract = out for the year; longer gaps (or no team) = retirement + comeback
    if (w < 0.85 && rand() > w) return null;
    return later[0] - S === 1 && p.tid >= 0 ? { out: true } : { hiatus: later[0] };
  }
  const target = scaledTarget(L, p, arcTarget(e)); const ww = e[2] < 20 ? w * 0.5 : w; // injury-shortened year: weaker pull
  const d = Math.round(ww * (target - p.ovr) + normal(0, peakTargetOf(L, p) != null && target >= arcTarget(e) + 1 ? 0.4 : 1));
  if (d) { for (const k of Object.keys(p.ratings)) if (k !== 'sta' && k !== 'dur' && typeof p.ratings[k] === 'number') p.ratings[k] = k === 'sco' ? clamp(Math.round(p.ratings[k] + d * 0.5), 1, Math.max(92, p.ratings[k])) : clamp(p.ratings[k] + d, 20, 99); p.ovr = ovrFromAttrs(p.ratings, p.pos); }
  const ap = arcPot(L, p, S + 1); p.pot = Math.max(p.ovr, ap ?? p.ovr); p.histPot = null;
  return null;
}

// ---- real retirements, gap years and comebacks ----
export function realTeamTid(L, p, S) { const c = careerOf(L, p); const ab = c?.a[String(S)]?.[4]; if (!ab) return null;
  const alias = { NJN: 'BKN', BKN: 'NJN', SEA: 'OKC', OKC: 'SEA', VAN: 'MEM', MEM: 'VAN', CHH: 'NOH', NOH: 'NOP', NOP: 'NOH', NOK: 'NOH', CHA: 'CHH', WSB: 'WAS' };
  const t = L.teams.find(t => !t.inactive && t.abbr === ab) || L.teams.find(t => !t.inactive && t.abbr === alias[ab]); return t ? t.tid : null; }
export function arcYearsFrom(L, p, S) { const c = careerOf(L, p); if (!c) return 1; let n = 0; while (c.a[String(S + n)]) n++; return Math.max(1, n); }

// season-start pull used for the 1996 start players (their 1996-97 rating comes from the start formula, not the arc)
export function applyPeakNow(L, p, S) {
  const pk = peakTargetOf(L, p); const c = careerOf(L, p); const e = c?.a[String(S)]; if (pk == null || !e || p.arcOff) return;
  const t = scaledTarget(L, p, arcTarget(e)); if (t < arcTarget(e)) return; // only lifts (a lower peak is handled by the arc pull)
  for (let i = 0; i < 4; i++) { const d = Math.round(t - p.ovr); if (d <= 0) break;
    for (const k of Object.keys(p.ratings)) if (k !== 'sta' && k !== 'dur' && k !== 'sco' && typeof p.ratings[k] === 'number') p.ratings[k] = clamp(p.ratings[k] + d, 1, 99);
    p.ovr = ovrFromAttrs(p.ratings, p.pos); }
  p.pot = Math.max(p.ovr, arcPot(L, p, S + 1) ?? p.ovr);
}

// v45: real draftees' draft-day OVR from their real first NBA season (minus a bit per year before they arrived), blended with the
// draft-slot estimate; POT follows the real career (arcPot). Real draftees who never played in the NBA are busts.
export function calibrateRealProspect(L, p, s) {
  if (!p.real || p.calV45 || careerMode(L) === 'random') return; p.calV45 = true;
  const c = careerOf(L, p);
  if (!c) { if (s <= ARC_END - 1 && p.arcKey === null || !c) { p.arcKey = null; const d = -7; shiftAll(p, d); p.pot = Math.max(p.ovr, Math.min(p.pot, p.ovr + 3)); p.histPot = null; } return; }
  const ys = Object.keys(c.a).map(Number).sort((a, b) => a - b); const fy = ys[0]; const ft = arcTarget(c.a[String(fy)]);
  const est = ft - 2.5 * Math.max(0, fy - s) - 1; const goal = Math.round(0.65 * est + 0.35 * p.ovr);
  shiftAll(p, goal - p.ovr);
  const ap = arcPot(L, p, s); if (ap != null) { p.pot = Math.max(p.ovr, ap); p.histPot = null; }
}
function shiftAll(p, d) { if (!d) return; for (const k of Object.keys(p.ratings)) if (k !== 'sta' && k !== 'dur' && typeof p.ratings[k] === 'number') p.ratings[k] = k === 'sco' ? clamp(Math.round(p.ratings[k] + d * 0.5), 20, 92) : clamp(p.ratings[k] + d, 20, 99); p.ovr = ovrFromAttrs(p.ratings, p.pos); }
