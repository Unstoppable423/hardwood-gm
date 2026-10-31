// Possession-by-possession basketball simulation with optional play-by-play text.
import { rand, weighted, clamp, pick, randInt, normal } from './rng.js';

const QLEN = 720, OTLEN = 300;
// pas is graded relative to position, so a playmaking PF (86 pas) should not dish like a PG
const AST_ROLE = { PG: 1, SG: 0.6, SF: 0.5, PF: 0.33, C: 0.27 };
import { ERA } from './era.js';
export { ERA };
const NO_SCHEME = { ox: { pace: 1, rim: 1, mid: 1, three: 1, useExp: 1, ast: 1, tov: 0 }, dx: { rim: 0, mid: 0, three: 0, tov: 0, stl: 0, foul: 0 }, offEdge: 0, defEdge: 0 };
const INJ = [
  ['ankle sprain', 1, 6, 30], ['sore knee', 1, 4, 20], ['hamstring strain', 3, 12, 18], ['back spasms', 1, 5, 12],
  ['sprained wrist', 3, 10, 8], ['broken hand', 15, 35, 5], ['torn ligament (knee)', 40, 82, 3], ['stress fracture (foot)', 20, 50, 3], ['concussion', 2, 8, 6],
];
export let USE = (r, p) => Math.pow(r.sco / 60, 0.85) * Math.pow(p.ovr / 65, 0.55);
export const setUse = (f) => { USE = f; };
function composites(p) {
  const r = p.ratings, ht = (p.h / 2.54 - 79) / 3;
  return {
    p, pid: p.pid, name: p.name.split(' ').slice(-1)[0], full: p.name, pos: p.pos,
    rim: r.ins * 0.65 + r.ath * 0.2 + r.sco * 0.15,
    mid: r.out * 0.55 + r.sco * 0.3 + r.iq * 0.15,
    tre: r.out * 0.9 + r.iq * 0.1,
    use: USE(r, p),
    wRim: Math.exp((r.ins - r.out) / 18 + ht * 0.25), wMid: 0.85,
    w3: ERA.three * Math.exp((r.out - 62) / 12) * Math.exp(-1.1 * Math.max(0, ht - 0.3)),
    ft: clamp(0.39 + r.out * 0.0052 + r.iq * 0.0006 - Math.max(0, ht) * 0.045, 0.4, 0.92),
    han: r.han, pas: r.pas, reb: r.reb, idef: r.idef, pdef: r.pdef, iq: r.iq, h: p.h, dur: r.dur, blk: r.blk ?? r.idef - 10, stl: r.stl ?? r.pdef - 8,
    big: p.pos === 'PF' || p.pos === 'C', guard: p.pos === 'PG' || p.pos === 'SG',
  };
}
function emptyLine() { return { min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0, gs: 0 }; }

// team-level hot/cold night (shooting form) so lopsided matchups aren't near-certain; tuned with scripts/realism.mjs
export let FORM_SD = 0.09; export function setFormSd(v) { FORM_SD = v; }
export function autoRotation(players) {
  // starters: best at each slot-ish; minutes by OVR rank
  const avail = players.filter(p => !p.injury).sort((a, b) => b.ovr - a.ovr);
  const starters = [];
  const need = [['PG', 'SG'], ['SG', 'SF', 'PG'], ['SF', 'SG', 'PF'], ['PF', 'C', 'SF'], ['C', 'PF']];
  for (const opts of need) {
    const c = avail.find(p => !starters.includes(p) && opts.includes(p.pos) && p.ovr >= (avail[7]?.ovr ?? 0));
    if (c) starters.push(c);
  }
  for (const p of avail) if (starters.length < 5 && !starters.includes(p)) starters.push(p);
  const rest = avail.filter(p => !starters.includes(p));
  const order = [...starters.sort((a, b) => b.ovr - a.ovr), ...rest];
  const MIN = [36, 35, 33, 31, 29, 22, 18, 14, 10, 7, 5, 0, 0, 0, 0];
  const minutes = {}; let tot = 0;
  order.forEach((p, i) => { minutes[p.pid] = MIN[i] ?? 0; tot += minutes[p.pid]; });
  // normalize to 240
  const scale = tot > 0 ? 240 / tot : 1; for (const k in minutes) minutes[k] = Math.round(minutes[k] * scale);
  return { starters: starters.map(p => p.pid), minutes };
}

export function simGame(home, away, opts = {}) {
  // home/away: {tid, abbr, players:[player objs], rotation:{starters, minutes}, coach: 0-100}
  const T = [home, away].map((t, side) => {
    const rot = t.rotation && t.rotation.starters?.length === 5 ? t.rotation : autoRotation(t.players);
    // injury pile-ups: if fewer than 5 are healthy, the least-hurt injured players suit up so a game can always be played
    let avail = t.players.filter(p => !p.injury);
    if (avail.length < 5) avail = [...avail, ...t.players.filter(p => p.injury).sort((a, b) => a.injury.games - b.injury.games).slice(0, 5 - avail.length)];
    const cs = avail.map(composites);
    const map = new Map(cs.map(c => [c.pid, c]));
    let starters = rot.starters.map(id => map.get(id)).filter(Boolean);
    for (const c of cs.sort((a, b) => b.p.ovr - a.p.ovr)) if (starters.length < 5 && !starters.includes(c)) starters.push(c);
    const mins = {}; for (const c of cs) mins[c.pid] = (rot.minutes?.[c.pid] ?? 0) * 60;
    const totM = Object.values(mins).reduce((a, b) => a + b, 0);
    if (totM < 200 * 60) { const ar = autoRotation(avail); for (const c of cs) mins[c.pid] = (ar.minutes[c.pid] || 0) * 60; }
    const line = {}; for (const c of cs) line[c.pid] = emptyLine();
    starters.forEach(c => line[c.pid].gs = 1);
    const sx = t.scheme || NO_SCHEME; return { side, t, cs, starters, mins, line, on: [...starters], pts: 0, fouls: 0, qpts: [], coach: (t.coach ?? 60), tid: t.tid, ox: sx.ox, dx: sx.dx, offEdge: sx.offEdge || 0, defEdge: sx.defEdge || 0, form: normal(0, FORM_SD) };
  });
  const pbp = opts.pbp ? [] : null;
  const homeAdv = opts.neutral ? 0 : (opts.homeAdv ?? 0.018); // playoff crowds are louder (stronger edge)
  let q = 1, clock = QLEN, elapsed = 0, poss = rand() < 0.5 ? 0 : 1, lastSub = -999;
  const injuries = [];
  const snapTeam = (tm) => { const o = { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0 }; const pl = [];
    for (const [pid, l] of Object.entries(tm.line)) { o.fgm += l.fgm; o.fga += l.fga; o.tpm += l.tpm; o.tpa += l.tpa; o.ftm += l.ftm; o.fta += l.fta; o.reb += l.orb + l.drb; o.ast += l.ast; o.tov += l.tov; o.stl += l.stl; o.blk += l.blk; o.pf += l.pf; if (l.min > 0) pl.push([+pid, l.pts, l.orb + l.drb, l.ast, Math.round(l.min / 60)]); }
    o.pl = pl; return o; };
  const say = (txt) => { if (pbp) pbp.push({ q, t: Math.max(0, Math.round(clock)), txt, hs: T[0].pts, as: T[1].pts, o: poss, el: Math.round(elapsed), snap: [snapTeam(T[0]), snapTeam(T[1])] }); };
  const fmt = (c) => c.name;

  function chooseLineups(force) {
    for (const tm of T) {
      const regLen = 2880, horizon = elapsed + 150;
      const cand = tm.cs.filter(c => tm.line[c.pid].pf < 6 && !c.p.injury);
      if (force && (q === 1 || q === 3) && clock === QLEN) { tm.on = tm.starters.filter(c => cand.includes(c)); }
      else {
        const needOf = (c) => {
          let n = tm.mins[c.pid] * Math.min(1, horizon / regLen) - tm.line[c.pid].min;
          if (q <= 4 && tm.line[c.pid].pf >= q + 2) n -= 400;
          if (tm.on.includes(c)) n += 40; // hysteresis
          if (q >= 4 && clock < 300 && tm.mins[c.pid] >= 28 * 60) n += 500; // closers
          return n;
        };
        const sorted = [...cand].sort((a, b) => needOf(b) - needOf(a));
        let on = sorted.slice(0, 5);
        const fix = (pred) => {
          if (!on.some(pred)) { const inC = sorted.find(c => pred(c) && !on.includes(c)); if (inC) { const outI = on.map((c, i) => [c, i]).reverse().find(([c]) => !pred(c)); if (outI) on[outI[1]] = inC; } }
        };
        fix(c => c.guard); fix(c => c.big);
        tm.on = on;
      }
      while (tm.on.length < 5) { const extra = tm.cs.find(c => !tm.on.includes(c)); if (!extra) break; tm.on.push(extra); }
    }
  }
  chooseLineups(true);

  function addTime(dt) {
    for (const tm of T) for (const c of tm.on) tm.line[c.pid].min += dt;
    clock -= dt; elapsed += dt;
  }
  function score(tm, n) {
    tm.pts += n; const opp = T[1 - tm.side];
    for (const c of tm.on) tm.line[c.pid].pm += n; for (const c of opp.on) opp.line[c.pid].pm -= n;
  }
  function freeThrows(tm, shooter, n) {
    let made = 0;
    for (let i = 0; i < n; i++) { tm.line[shooter.pid].fta++; if (rand() < shooter.ft) { tm.line[shooter.pid].ftm++; tm.line[shooter.pid].pts++; score(tm, 1); made++; } }
    return made;
  }
  function rebound(off, def, shotType) {
    const offReb = off.on.reduce((s, c) => s + c.reb, 0) / 5, defReb = def.on.reduce((s, c) => s + c.reb, 0) / 5;
    const orbP = clamp(0.29 + (offReb - defReb) / 220 + (shotType === 3 ? 0.02 : 0), 0.15, 0.45);
    if (rand() < orbP) { const r = weighted(off.on, c => Math.pow(c.reb, 1.6) * (c.h - 175)); off.line[r.pid].orb++; say(`${fmt(r)} grabs the offensive board.`); return true; }
    const r = weighted(def.on, c => Math.pow(c.reb, 1.6) * (c.h - 175)); def.line[r.pid].drb++; return false;
  }
  function foulCheck(tm, c) {
    if (tm.line[c.pid].pf < 6) return;
    const repl = tm.cs.filter(x => !tm.on.includes(x) && !x.p.injury && tm.line[x.pid].pf < 6).sort((a, b) => b.p.ovr - a.p.ovr)[0];
    if (repl) tm.on = tm.on.map(x => x === c ? repl : x);
  }
  const qLen = () => (q <= 4 ? QLEN : OTLEN);
  let quarterFouls = [0, 0];
  let safety = 0;
  while (safety++ < 5000) {
    if (clock <= 0) {
      T.forEach(tm => tm.qpts.push(tm.pts - tm.qpts.reduce((a, b) => a + b, 0)));
      if (q >= 4 && T[0].pts !== T[1].pts) break;
      say(q < 4 ? `End of Q${q}.` : `End of regulation — overtime!`);
      q++; clock = qLen(); quarterFouls = [0, 0];
      if (q === 3) poss = 1 - poss;
      chooseLineups(true); lastSub = elapsed; continue;
    }
    if (elapsed - lastSub >= 100) { chooseLineups(false); lastSub = elapsed; }
    const off = T[poss], def = T[1 - poss];
    for (const tm of T) for (const c of tm.on) if (tm.line[c.pid].pf >= 6) foulCheck(tm, c); // nobody with 6 fouls stays on the floor
    let oreb = true, first = true;
    while (oreb) {
      oreb = false;
      const dt = Math.min(clock, first ? (5 + rand() * 20) / (ERA.pace * Math.sqrt(off.ox.pace * def.ox.pace)) : 3 + rand() * 10); first = false;
      addTime(dt);
      // injury check
      for (const tm of T) for (const c of tm.on) {
        if (rand() < 0.00011 * (1.6 - c.dur / 100) * (opts.injuryMult ?? 1) * dt / 15) {
          const ty = weighted(INJ, x => x[3]); const games = randInt(ty[1], ty[2]);
          c.p.injury = { type: ty[0], games, gamesTotal: games }; injuries.push({ pid: c.pid, tid: tm.tid, type: ty[0], games });
          say(`⚠️ ${c.full} is hurt (${ty[0]}) and heads to the locker room.`);
          tm.on = tm.on.filter(x => x !== c); const repl = tm.cs.find(x => !tm.on.includes(x) && !x.p.injury && tm.line[x.pid].pf < 6) || tm.cs.find(x => !tm.on.includes(x) && tm.line[x.pid].pf < 6) || tm.cs.find(x => !tm.on.includes(x));
          if (repl) tm.on.push(repl);
        }
      }
      const defP = 60 + (def.on.reduce((s, c) => s + c.pdef, 0) / 5 - 60) * ERA.hand;
      const idefs = def.on.map(c => c.idef).sort((a, b) => b - a);
      const defI = (idefs[0] + idefs[1]) / 2 * 0.6 + idefs.reduce((a, b) => a + b, 0) / 5 * 0.4;
      const offH = off.on.reduce((s, c) => s + c.han, 0) / 5;
      const coachEdge = (off.coach - def.coach) / 2000;
      // non-shooting foul
      if (rand() < 0.075 + def.dx.foul) {
        const fouler = weighted(def.on, c => 1 + (100 - c.iq) / 50); def.line[fouler.pid].pf++; quarterFouls[def.side]++; foulCheck(def, fouler);
        if (quarterFouls[def.side] > 4) { const s = weighted(off.on, c => c.use); say(`Foul on ${fmt(fouler)} — ${fmt(s)} to the line (bonus).`); freeThrows(off, s, 2); break; }
        say(`Reach-in foul on ${fmt(fouler)}.`); oreb = true; first = false; if (clock <= 0) break; continue;
      }
      // turnover
      if (rand() < clamp(0.152 + (defP - offH) / 650 + off.ox.tov + def.dx.tov, 0.09, 0.23)) {
        const tov = weighted(off.on, c => c.use * (115 - c.han)); off.line[tov.pid].tov++;
        if (rand() < 0.53 + def.dx.stl) { const st = weighted(def.on, c => Math.pow(c.stl / 50, 1.15) * (0.6 + c.pdef / 250)); def.line[st.pid].stl++; say(`${fmt(st)} picks off ${fmt(tov)}! Turnover.`); }
        else say(`${fmt(tov)} turns it over.`);
        break;
      }
      const ox = off.ox, dx = def.dx;
      const sh = weighted(off.on, c => Math.pow(c.use, ox.useExp));
      const type = weighted([1, 2, 3], t => t === 1 ? sh.wRim * ox.rim * (ox.postBig && sh.big ? ox.postBig : 1) : t === 2 ? sh.wMid * ox.mid : sh.w3 * ox.three);
      const rating = type === 1 ? sh.rim : type === 2 ? sh.mid : sh.tre;
      let pMake = type === 1 ? 0.505 + (rating - 60) * 0.0055 - (defI - 60) * 0.0045
        : type === 2 ? 0.36 + (rating - 60) * 0.005 - (defP - 60) * 0.003
          : 0.262 + ERA.tp + (rating - 60) * 0.0058 - (defP - 60) * 0.002;
      pMake += (off.side === 0 ? homeAdv : 0) + (opts.edge ? opts.edge[off.side] : 0) + coachEdge + off.offEdge - def.defEdge + off.form + (type === 1 ? dx.rim : type === 2 ? dx.mid : dx.three);
      pMake = clamp(pMake, 0.12, 0.8);
      const foulP = type === 1 ? 0.24 + ERA.drawFoul : type === 2 ? 0.065 : 0.015;
      const fouled = rand() < foulP;
      const made = rand() < (fouled ? pMake * 0.4 : pMake);
      const L = off.line[sh.pid];
      const desc = type === 1 ? pick(['drives to the rim', 'posts up', 'cuts baseline', 'attacks off the dribble']) : type === 2 ? pick(['pulls up from 16 feet', 'fires a baseline jumper', 'turns and shoots', 'rises from the elbow']) : pick(['launches from deep', 'lets it fly from three', 'spots up in the corner']);
      if (fouled) {
        const fouler = weighted(def.on, c => (type === 1 ? c.idef : c.pdef)); def.line[fouler.pid].pf++; quarterFouls[def.side]++;
        if (made) {
          L.fga++; L.fgm++; const v = type === 3 ? 3 : 2; if (type === 3) { L.tpa++; L.tpm++; } L.pts += v; score(off, v);
          maybeAssist(off, sh, type); say(`${fmt(sh)} ${desc} — AND ONE! Foul on ${fmt(fouler)}.`); freeThrows(off, sh, 1);
        } else {
          const n = type === 3 ? 3 : 2; const m = freeThrows(off, sh, n); say(`${fmt(sh)} fouled by ${fmt(fouler)}, hits ${m} of ${n} at the line.`);
          if (m < n && rand() < 0.12) { oreb = rebound(off, def, 1); }
        }
        if (def.line[fouler.pid].pf >= 6) { say(`${fouler.full} has fouled out.`); foulCheck(def, fouler); }
        continue;
      }
      L.fga++; if (type === 3) L.tpa++;
      if (made) {
        L.fgm++; const v = type === 3 ? 3 : 2; if (type === 3) L.tpm++; L.pts += v; score(off, v);
        const a = maybeAssist(off, sh, type);
        say(`${fmt(sh)} ${desc}... ${type === 3 ? 'BANG! Three.' : 'good.'}${a ? ` (assist ${fmt(a)})` : ''}`);
      } else {
        if (type !== 3 && rand() < (type === 1 ? 0.3 : 0.07)) { const b = weighted(def.on, c => Math.pow(c.blk / 50, 2.5) * Math.max(4, c.h - 182)); def.line[b.pid].blk++; say(`${fmt(sh)} ${desc} — REJECTED by ${fmt(b)}!`); }
        else say(`${fmt(sh)} ${desc}... no good.`);
        oreb = rebound(off, def, type);
      }
      if (clock <= 0) break;
    }
    poss = 1 - poss;
  }
  function maybeAssist(tm, sh, type) {
    if (rand() < Math.min(0.95, (type === 1 ? 0.6 : type === 2 ? 0.66 : 0.88) * tm.ox.ast)) {
      const mates = tm.on.filter(c => c !== sh); if (!mates.length) return null;
      const a = weighted(mates, c => Math.pow(c.pas / 60, 3.5) * (AST_ROLE[c.pos] ?? 0.5)); tm.line[a.pid].ast++; return a;
    }
    return null;
  }
  say(`Final: ${home.abbr} ${T[0].pts}, ${away.abbr} ${T[1].pts}`);
  for (const tm of T) for (const k in tm.line) tm.line[k].min = Math.round(tm.line[k].min / 6) / 10;
  return { hs: T[0].pts, as: T[1].pts, ot: Math.max(0, q - 4), qh: T[0].qpts, qa: T[1].qpts, box: { [home.tid]: T[0].line, [away.tid]: T[1].line }, pbp, injuries };
}
