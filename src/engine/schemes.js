// Coach schemes (Pocket-GM-style): the Head Coach's offensive and defensive systems change how games play,
// and players fit a scheme better or worse depending on their skills. Original design for Hardwood GM.
import { clamp } from './rng.js';
import { ERA } from './era.js';

// sim effects: pace multiplier, shot-type weights, usage concentration exponent, assist rate, turnovers
export const OFF_SCHEMES = {
  'Motion':      { bias: -2.0, pace: 1.0,  rim: 1.0,  mid: 1.05, three: 1.05, useExp: 0.9, ast: 1.08, tov: -0.004, fit: { pas: .3, iq: .3, out: .25, han: .15 },
    blurb: 'Constant ball and player movement. Rewards passing, IQ and shooting.' },
  'Pick & Roll': { bias: -3.4, pace: 1.01, rim: 1.12, mid: 0.95, three: 1.0,  useExp: 1.0, ast: 1.04, tov: 0,      fit: { han: .25, pas: .2, ins: .2, ath: .2, sco: .15 },
    blurb: 'Ball handlers and rolling bigs. Needs a creator and an athletic big.' },
  'Post-Up':     { bias: -2.9, pace: 0.95, rim: 1.2,  mid: 1.0,  three: 0.82, useExp: 1.0, ast: 0.96, tov: 0.002,  fit: { ins: .4, reb: .25, iq: .15, pas: .2 }, postBig: 1.25,
    blurb: 'Play through the low post. Slower, physical, inside-out.' },
  'Run & Gun':   { bias: -2.0, pace: 1.08, rim: 1.05, mid: 0.85, three: 1.18, useExp: 1.0, ast: 1.0,  tov: 0.008,  fit: { ath: .35, out: .3, sta: .2, han: .15 },
    blurb: 'Push the pace, shoot early. Athletes and shooters thrive.' },
  'Triangle':    { bias: -2.1, pace: 0.97, rim: 1.0,  mid: 1.18, three: 0.9,  useExp: 0.95, ast: 1.06, tov: -0.006, fit: { iq: .35, pas: .25, out: .2, ins: .2 },
    blurb: 'Read-and-react sets with spacing and high-post passing. IQ heavy.' },
  'Isolation':   { bias: -3.4, pace: 0.98, rim: 1.02, mid: 1.05, three: 1.0,  useExp: 1.25, ast: 0.9, tov: -0.002, fit: { sco: .4, han: .3, out: .15, ath: .15 },
    blurb: 'Clear out for your best scorer. Stars get more shots.' },
};
// defensive effects on opponent make% by shot type, turnovers forced, steal share, fouls
export const DEF_SCHEMES = {
  'Man-to-Man':        { bias: -2.6, rim: 0,      mid: -0.004, three: -0.004, tov: 0,      stl: 0,    foul: 0,     fit: { pdef: .4, idef: .3, iq: .3 },
    blurb: 'Classic man coverage. Solid everywhere, needs individual defenders.' },
  'Switch Everything': { bias: -3.9, rim: 0.008,  mid: -0.006, three: -0.012, tov: 0.003,  stl: 0.02, foul: 0,     fit: { pdef: .4, ath: .35, idef: .25 },
    blurb: 'Switch every screen. Smothers shooters; needs versatile athletes.' },
  'Pack the Paint':    { bias: -7.0, rim: -0.03,  mid: 0.004,  three: 0.012,  tov: -0.004, stl: -0.04, foul: -0.006, fit: { idef: .4, blk: .3, reb: .3 },
    blurb: 'Wall off the rim and concede jumpers. Built around a shot blocker.' },
  'Aggressive Traps':  { bias: -5.6, rim: 0.006,  mid: 0,      three: 0.01,   tov: 0.02,   stl: 0.1,  foul: 0.01,  fit: { stl: .35, ath: .3, pdef: .25, sta: .1 },
    blurb: 'Blitz ball handlers, force turnovers, gamble for steals.' },
  'Zone Mix':          { bias: -4.4, rim: -0.012, mid: -0.01,  three: 0.008,  tov: 0.004,  stl: 0.01, foul: -0.004, fit: { iq: .35, idef: .3, pdef: .2, blk: .15 },
    blurb: 'Mix zones to confuse offenses. Smart, long defenders.' },
};
const val = (p, k) => p.ratings[k] ?? (k === 'blk' ? p.ratings.idef - 10 : k === 'stl' ? p.ratings.pdef - 8 : 55);
export function playerFit(p, off, def) {
  const O = OFF_SCHEMES[off], D = DEF_SCHEMES[def]; const sc = (S) => !S ? p.ovr : Object.entries(S.fit).reduce((s, [k, w]) => s + val(p, k) * w, 0) - S.bias;
  // fit is relative to the player's overall level, so it says "suits the system", not "is good"
  const base = p.ovr;
  return { off: clamp(Math.round(60 + (sc(O) - base) * 2.4), 0, 100), def: clamp(Math.round(60 + (sc(D) - base) * 2.4), 0, 100) };
}
export const fitWord = (f) => f >= 75 ? 'Ideal' : f >= 64 ? 'Good' : f >= 52 ? 'OK' : 'Poor';
// team fit: top-9 by OVR, weighted toward starters
export function teamFit(players, off, def) {
  const ps = [...players].filter(p => !p.injury).sort((a, b) => b.ovr - a.ovr).slice(0, 9); if (!ps.length) return { off: 60, def: 60 };
  const w = [1.3, 1.25, 1.2, 1.15, 1.1, 0.8, 0.7, 0.55, 0.45]; let o = 0, d = 0, W = 0;
  ps.forEach((p, i) => { const f = playerFit(p, off, def); o += f.off * w[i]; d += f.def * w[i]; W += w[i]; });
  return { off: Math.round(o / W), def: Math.round(d / W) };
}
// what the sim needs for one team
// before 2001-02 the illegal-defense rules ban zones (a Zone Mix coach plays man) and limit packing the paint
export const legalDef = (def) => def === 'Zone Mix' && !ERA.zone ? 'Man-to-Man' : def;
const eraDx = (def) => { const d = DEF_SCHEMES[def] || DEF_SCHEMES['Man-to-Man']; if (def !== 'Pack the Paint' || ERA.paint === 1) return d;
  const k = ERA.paint; return { ...d, rim: d.rim * k, mid: d.mid * k, three: d.three * k, stl: d.stl * k, tov: d.tov * k, foul: d.foul * k }; };
export function schemeFor(staffHC, players) {
  const off = staffHC?.off || 'Motion', def = legalDef(staffHC?.def || 'Man-to-Man'); const fit = teamFit(players, off, def);
  return { off, def, ox: OFF_SCHEMES[off] || OFF_SCHEMES.Motion, dx: eraDx(def), fit,
    // fit edge: ~±1% make probability for a well/badly fitting rotation, capped at 2.5%
    offEdge: clamp((fit.off - 60) / 700, -0.025, 0.025), defEdge: clamp((fit.def - 60) / 700, -0.025, 0.025) };
}
