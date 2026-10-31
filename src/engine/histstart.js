// Historic starts (1946-47 .. 1995-96): rosters, per-season lines and honors from Wikipedia player articles
// (data/history.json, built by scripts/build_history.py). Lines are era-normalized; seasons whose stats the
// source lacks are ESTIMATED from honors and the player's other seasons (flag e: 1 partial, 2 fully estimated).
import { teamsAt, segAt, FRANCHISES, changesAt, rosterMaxAt, seasonGamesAt } from './timeline.js';
export const HIST_MIN = 1947, HIST_MAX = 1996;
// s[season] = [fid, fid2, gp, mpg, pts, reb, ast, ts, stl, blk, est]
export function lineOf(hp, S) { const v = hp.s[String(S)]; if (!v) return null; const [f, f2, gp, mpg, pts, reb, ast, ts, stl, blk, e] = v; return { f, f2, gp, mpg, pts, reb, ast, ts, stl, blk, e }; }
const BOOST = { mvp: 1.0, alnba1: 0.7, alnba2: 0.45, alnba3: 0.3, allstar: 0.2 };
export function honorBoost(hp, S) { let b = 0; for (const [k, v] of Object.entries(BOOST)) if (hp.hon?.[k]?.includes(S)) b = Math.max(b, v); return b; }
// raw row in the shape players.playerFromStats expects (same fields as the 1996-97 start file)
export function rawFor(hp, S) {
  const l = lineOf(hp, S); if (!l) return null;
  const mpg = Math.max(4, l.mpg || 15), h = hp.h || 198;
  const rr = (l.reb / mpg) / 0.178; // rebound rate vs league (lines are normalized to 1996-97 per-minute levels)
  const age = S - hp.by - ((hp.bm || 7) > 6 ? 1 : 0);
  return { n: hp.n, t: l.f, age, h, pos: hp.pos || undefined, w: hp.w || Math.round(h * 0.47), col: hp.col || '', ctry: 'USA', dy: hp.dy, dr: hp.dr, dp: hp.dp,
    gp: l.gp, pts: l.pts, reb: l.reb, ast: l.ast, net: 0,
    orb: +(0.06 * rr * (1 + (h - 201) / 30)).toFixed(3), drb: +(0.14 * rr).toFixed(3), usg: +Math.min(0.36, Math.max(0.08, 0.03 + 0.4 * l.pts / mpg)).toFixed(3),
    ts: l.ts || 0.51, astp: +Math.min(0.5, 1.45 * l.ast / mpg).toFixed(3), num: hp.num,
    ...(l.stl != null && l.blk != null ? { stl36: +(l.stl * 36 / mpg).toFixed(2), blk36: +(l.blk * 36 / mpg).toFixed(2), defMin: Math.round(l.gp * mpg) } : {}),
    _est: l.e, _key: hp.k, _boost: honorBoost(hp, S) };
}
// career totals and honors before season S (for Hall of Fame odds)
export function priorFor(hp, S) {
  let yrs = 0, pts = 0, reb = 0, ast = 0;
  for (const [y, v] of Object.entries(hp.s)) if (+y < S) { yrs++; const g = v[2] || 0; pts += g * v[4]; reb += g * v[5]; ast += g * v[6]; }
  const c = (k) => (hp.hon?.[k] || []).filter(y => y < S).length;
  return { yrs, pts: Math.round(pts), reb: Math.round(reb), ast: Math.round(ast), as: c('allstar'), an: c('alnba1') + c('alnba2') + c('alnba3'), an1: c('alnba1'), mvp: c('mvp'), t: c('champ') };
}
export function histTeams(S) { return teamsAt(S); }
export const firstSeason = (hp) => Math.min(...Object.keys(hp.s).map(Number));
export { changesAt, segAt, FRANCHISES, rosterMaxAt, seasonGamesAt };
// Era roster and cap rules for historic saves (Real NBA history on): active-roster limits by era, no salary cap
// before 1984-85 (the first cap, $3.6M), then the soft cap. From 1996-97 the sim's own 13-15 man rules take over.
import { applyRules } from './franchise.js';
export function applyEraRules(L) {
  if (!L.histStart || L.settings?.realHistory === false) return;
  const st = L.settings;
  if (L.season < 1997) { const mx = rosterMaxAt(L.season); st.rosterMax = mx; st.rosterMin = Math.max(8, mx - 2); st.capMode = L.season < 1985 ? 'off' : 'soft'; st.luxuryTax = false; L.eraManaged = true; }
  else if (L.eraManaged) { st.rosterMax = 15; st.rosterMin = 13; st.capMode = 'soft'; st.luxuryTax = true; L.eraManaged = false; }
  applyRules(L);
}
