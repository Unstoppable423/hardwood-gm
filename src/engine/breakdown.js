// Read-only team breakdown. Reuses the v43 draft need score (teamNeedsDetail): listed position
// counts full, a secondary position counts 3 display points lower, aging and expiring starters add need.
// Nothing here signs, trades, sets a lineup, or changes a rating.
import { POS, PHASE_LABEL } from './constants.js';
import { teamPlayers, standings } from './league.js';
import { teamNeedsDetail } from './offseason.js';
import { eligiblePos, dispRating, ATTR_LABEL } from './players.js';
import { posPenalty } from './pgm2.js';
import { autoRotation } from './sim.js';

const SLOT = ['PG', 'SG', 'SF', 'PF', 'C'];
const ADJ = { PG: ['SG'], SG: ['PG', 'SF'], SF: ['SG', 'PF'], PF: ['SF', 'C'], C: ['PF'] };
const MIN_AVG_GP = 8;      // quote a player's per-game line only after this many games
const MIN_TEAM_GP = 10;    // team trends (ranks, point differential) wait for a real sample
const MIN_3PA = 80;        // don't rank a three-point percentage on a handful of shots
const OFFSEASON = new Set(['AWARDS', 'STAFF', 'LOTTERY', 'DRAFT', 'RESIGN', 'FA1', 'FA2', 'FA3', 'SUMMER']);
const CATS = [
  { key: 'out', label: 'Outside shooting', attrs: ['out'], shoot: true },
  { key: 'ins', label: 'Inside scoring', attrs: ['ins'] },
  { key: 'create', label: 'Shot creation', attrs: ['sco'] },
  { key: 'play', label: 'Playmaking', attrs: ['pas', 'han'] },
  { key: 'reb', label: 'Rebounding', attrs: ['reb'] },
  { key: 'pdef', label: 'Perimeter defense', attrs: ['pdef'] },
  { key: 'idef', label: 'Interior defense', attrs: ['idef'] },
  { key: 'blk', label: 'Shot blocking', attrs: ['blk'] },
  { key: 'stl', label: 'Steals', attrs: ['stl'] },
  { key: 'ath', label: 'Athleticism', attrs: ['ath'] },
];

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const seasonLabel = (s) => (s ? `${s - 1}-${String(s).slice(2)}` : '');
const place = (rk) => rk.tied ? `tied for ${ord(rk.rank)}` : `${ord(rk.rank)}`;
const round1 = (v) => Math.round(v * 10) / 10;

function dispAttr(p, k) {
  const v = num(p?.ratings?.[k]);
  return v == null ? null : dispRating(v);
}
function showOvr(p) {
  const v = dispRating(p?.ovr);
  return num(v);
}
function safeStandings(L) {
  if (!Array.isArray(L?.schedule) || !Array.isArray(L?.teams)) return null;
  try { return standings(L); } catch { return null; }
}
function median(xs) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function rankOf(values, mine, higherBetter = true) {
  const better = values.filter(v => higherBetter ? v > mine + 1e-9 : v < mine - 1e-9).length;
  const tied = values.filter(v => Math.abs(v - mine) <= 1e-9).length;
  return { rank: better + 1, tied: tied > 1, n: values.length };
}

// Same eligibility the draft need score uses: listed position, or a secondary from eligiblePos.
export function depthAt(players, pos) {
  const rows = [];
  for (const p of players || []) {
    if (!p || p.pos == null) continue;
    let el = [];
    try { el = eligiblePos(p) || []; } catch { el = [p.pos]; }
    const listed = p.pos === pos;
    const secondary = !listed && el.includes(pos);
    if (!listed && !secondary) continue;
    const show = showOvr(p);
    rows.push({
      p, listed, secondary, show,
      fitOvr: show == null ? -999 : show - (listed ? 0 : 3),
      penalty: listed ? posPenalty(p) : 0,
    });
  }
  rows.sort((a, b) => b.fitOvr - a.fitOvr || (b.p.ovr || 0) - (a.p.ovr || 0) || a.p.pid - b.p.pid);
  return rows;
}

function slotPen(slot, p) {
  let el = [];
  try { el = eligiblePos(p) || []; } catch { el = []; }
  if (el.includes(slot) || p.pos === slot) return 0;
  if ((ADJ[slot] || []).some(x => el.includes(x))) return 4;
  return 14;
}
// Place a known set of starters into the five slots. Does not change who starts.
function assignSlots(starters) {
  const n = starters.length;
  if (!n) return {};
  let best = null, bv = -1e9;
  const cur = new Array(5).fill(null);
  const rec = (i, mask, sc) => {
    if (i === 5) { if (sc > bv) { bv = sc; best = cur.slice(); } return; }
    if (n < 5) { cur[i] = null; rec(i + 1, mask, sc); }
    for (let j = 0; j < n; j++) if (!(mask & (1 << j))) {
      cur[i] = starters[j];
      rec(i + 1, mask | (1 << j), sc + (num(starters[j].ovr) ?? 0) - slotPen(SLOT[i], starters[j]));
    }
  };
  rec(0, 0, 0);
  const slots = {};
  (best || []).forEach((p, i) => { if (p) slots[SLOT[i]] = p.pid; });
  return slots;
}

function lineupPlan(L, tid, roster) {
  const t = L.teams?.[tid];
  const active = roster.filter(p => !p.il);
  const healthy = active.filter(p => !p.injury);
  const avail = healthy.length ? healthy : active;
  const manual = !!(t && tid === L.userTid && t.autoRotation === false && t.rotation?.starters?.length === 5);
  let source = 'coach';
  let rot = null;
  if (manual) {
    const bad = t.rotation.starters.some(id => { const p = roster.find(x => x.pid === id); return !p || p.injury || p.il; });
    if (!bad) { rot = t.rotation; source = 'yours'; }
    else { rot = autoRotation(avail); source = 'auto'; }
  } else rot = autoRotation(avail);
  const byId = new Map(roster.map(p => [p.pid, p]));
  let slots = {};
  if (source === 'yours') slots = assignSlots(rot.starters.map(id => byId.get(id)).filter(Boolean));
  else if (rot?.slots) slots = { ...rot.slots };
  const starterIds = [];
  for (const pos of SLOT) if (slots[pos] != null && byId.has(slots[pos])) starterIds.push(slots[pos]);
  // coach lineup with no slots (empty roster): nothing starts
  if (!starterIds.length && source !== 'yours' && rot?.starters) {
    slots = assignSlots(rot.starters.map(id => byId.get(id)).filter(Boolean));
    for (const pos of SLOT) if (slots[pos] != null) starterIds.push(slots[pos]);
  }
  return { source, slots, starterIds: new Set(starterIds), minutes: rot?.minutes || {}, healthy: healthy.length };
}

function lineupNote(source, healthy) {
  if (!healthy) return 'No healthy players are available to start. Positions below are the roster, not a lineup for tonight.';
  if (source === 'yours') return 'Starting five is your Reorder lineup, which is what games use while Auto is off. Each of those five is shown at the slot he fits best. That does not change who starts.';
  if (source === 'auto') return 'Your saved lineup has an injured or missing starter, so this is the coach’s fill-in. Games use that fill-in too.';
  return 'Starting five is the head coach’s lineup (Auto). Games use this same lineup.';
}

function statContext(L, tid, roster) {
  const rows = roster.filter(p => num(p.stats?.reg?.gp) > 0 && p.stats?.season != null);
  const phase = L.phase || '';
  if (!rows.length) {
    const camp = phase === 'PRESEASON' || phase === '';
    return { kind: 'none', season: null, teamGp: 0, scheduleGp: null, text: camp
      ? `${PHASE_LABEL[phase] || 'This phase'}: no games yet, so everything below is from ratings.`
      : 'No regular-season stat line is stored for this roster, so everything below is from ratings.' };
  }
  const counts = new Map();
  for (const p of rows) counts.set(p.stats.season, (counts.get(p.stats.season) || 0) + 1);
  let season = rows[0].stats.season, best = 0;
  for (const [s, n] of counts) if (n > best) { best = n; season = s; }
  const rec = safeStandings(L)?.find(r => r.tid === tid);
  const scheduleGp = rec && season === L.season && (phase === 'REGULAR' || phase === 'PLAYOFFS') ? rec.gp : null;
  const maxGp = Math.max(...rows.filter(p => p.stats.season === season).map(p => num(p.stats.reg.gp) || 0));
  // Trust the schedule when it has games. A 0-game schedule with stored lines (older or partial save) falls back to those lines.
  const teamGp = scheduleGp > 0 ? scheduleGp : maxGp;
  const scheduleEmpty = scheduleGp === 0 && maxGp > 0;
  const priorYear = season !== L.season;
  const over = OFFSEASON.has(phase);
  let kind = 'current';
  if (priorYear) kind = 'prior';
  else if (over) kind = 'final';
  else if (teamGp < MIN_TEAM_GP) kind = 'small';
  const lab = seasonLabel(season);
  const traded = roster.some(p => (p.tx || []).some(t => t && t.type === 'trade' && t.season === season));
  let text = '';
  if (kind === 'small') text = `${lab} regular season, ${teamGp} team game${teamGp === 1 ? '' : 's'} played. That is too small to treat as a trend, so team ranks stay off. A player average is shown only at ${MIN_AVG_GP}+ games.`;
  else if (kind === 'final') text = `${lab} regular season is over (${PHASE_LABEL[phase] || phase}). Lines below are that season’s box score, kept separate from today’s ratings.`;
  else if (kind === 'prior') text = `Regular-season lines still on file are from ${lab}, not ${seasonLabel(L.season)}. They describe games already played by whoever has a line, not a new season. Ratings describe the roster now.`;
  else text = `${lab} regular season, ${teamGp} game${teamGp === 1 ? '' : 's'} on the schedule. Season lines are box-score totals. Ratings are the attribute grades.`;
  if (scheduleEmpty && kind !== 'prior') text += ' The schedule shows no played games, so this sample is the stored player lines.';
  if (phase === 'PLAYOFFS') text += ' Playoff games are not mixed into these averages.';
  if (traded) text += ' A player’s line is his whole season, including any games before he joined this team.';
  return { kind, season, teamGp, scheduleGp, text };
}

function playerLine(p, ctx) {
  if (!ctx.season) return null;
  const s = p.stats?.reg;
  if (!s || p.stats.season !== ctx.season || !(num(s.gp) > 0)) return null;
  const gp = num(s.gp);
  if (gp < MIN_AVG_GP) return { gp, small: true, text: `${gp} GP — too few games for averages` };
  const per = (k) => num(s[k]) == null ? null : round1(s[k] / gp);
  const parts = [];
  const pts = per('pts'); if (pts != null) parts.push(`${pts.toFixed(1)} pts`);
  const orb = num(s.orb), drb = num(s.drb);
  if (orb != null && drb != null) parts.push(`${round1((orb + drb) / gp).toFixed(1)} reb`);
  else if (num(s.reb) != null) parts.push(`${round1(s.reb / gp).toFixed(1)} reb`);
  const ast = per('ast'); if (ast != null) parts.push(`${ast.toFixed(1)} ast`);
  const min = per('min'); if (min != null) parts.push(`${min.toFixed(1)} min`);
  const prefix = ctx.kind === 'prior' || ctx.kind === 'final' ? `${seasonLabel(ctx.season)}: ` : '';
  return { gp, small: false, text: `${prefix}${parts.join(', ')} · ${gp} GP` };
}

function notableAttrs(p) {
  const rows = [];
  for (const [k, label] of Object.entries(ATTR_LABEL)) {
    const v = dispAttr(p, k);
    if (v == null) continue;
    if (!p.ratings || p.ratings[k] == null) continue;
    rows.push({ k, label, v });
  }
  if (!rows.length) return [];
  rows.sort((a, b) => b.v - a.v);
  const hi = rows[0], lo = rows[rows.length - 1];
  const out = [];
  if (hi.v >= 86) out.push(hi);
  if (lo.k !== hi.k && lo.v <= 68 && hi.v - lo.v >= 8) out.push(lo);
  return out;
}

function card(p, pos, plan, ctx) {
  const listed = p.pos === pos;
  let el = [];
  try { el = eligiblePos(p) || []; } catch { el = []; }
  const secondary = !listed && el.includes(pos);
  const penalty = listed ? posPenalty(p) : 0;
  const show = showOvr(p);
  let fit = 'out';
  if (listed) fit = penalty > 0 ? 'penalty' : 'listed';
  else if (secondary) fit = 'secondary';
  const fitOvr = show == null ? null : (listed || secondary ? show - (listed ? 0 : 3) : null);
  return {
    pid: p.pid, name: p.name, pos: p.pos, natPos: p.natPos || null, age: p.age ?? null,
    show, fitOvr, fit, penalty, listed, secondary,
    injured: !!p.injury, injGames: p.injury ? Math.ceil(num(p.injury.games) || 0) : 0, il: !!p.il,
    minutes: num(plan.minutes?.[p.pid]) || 0,
    attrs: notableAttrs(p),
    line: playerLine(p, ctx),
  };
}

function rotationWeights(plan, roster) {
  const weights = [];
  for (const p of roster) {
    if (p.il || p.injury) continue;
    const m = num(plan.minutes?.[p.pid]) || 0;
    if (m > 0) weights.push([p, m]);
  }
  if (weights.length) return weights;
  const pool = roster.filter(p => !p.il && !p.injury);
  const top = (pool.length ? pool : roster).slice().sort((a, b) => (b.ovr || 0) - (a.ovr || 0)).slice(0, 8);
  const MIN = [36, 35, 33, 31, 29, 22, 18, 14];
  top.forEach((p, i) => weights.push([p, MIN[i] || 8]));
  return weights;
}
function catValue(weights, cat) {
  let s = 0, w = 0, seen = 0, have = 0;
  for (const [p, m] of weights) {
    seen++;
    const vals = [];
    for (const k of cat.attrs) {
      if (p.ratings?.[k] == null) continue;
      const v = dispAttr(p, k);
      if (v != null) vals.push(v);
    }
    if (!vals.length) continue;
    have++;
    s += m * vals.reduce((a, b) => a + b, 0) / vals.length;
    w += m;
  }
  if (!w || have < Math.max(1, Math.ceil(seen * 0.5))) return null;
  return round1(s / w);
}
function threePoint(roster, season) {
  if (season == null) return null;
  let tpm = 0, tpa = 0, players = 0;
  for (const p of roster) {
    const s = p.stats?.reg;
    if (!s || p.stats.season !== season || !(num(s.gp) > 0)) continue;
    if (num(s.tpm) == null || num(s.tpa) == null) continue;
    tpm += s.tpm; tpa += s.tpa; players++;
  }
  if (tpa < MIN_3PA) return null;
  return { pct: tpm / tpa, tpm, tpa, players };
}

function explainNeed(n, roster) {
  const rows = depthAt(roster, n.pos);
  const st = n.starter ? roster.find(p => p.pid === n.starter.pid) : null;
  const bits = [];
  if (!st) bits.push(`Nobody on the roster is eligible at ${n.pos}.`);
  else if (n.starter.ovr == null || Number.isNaN(n.starter.ovr)) bits.push(`Best fit is ${st.name}, but he has no overall on file, so the score cannot use a rating.`);
  else if (st.pos === n.pos) bits.push(`Best fit is ${st.name}, overall ${n.starter.ovr}, listed at ${n.pos}.`);
  else bits.push(`Best fit is ${st.name}, overall ${n.starter.ovr}. ${n.pos} is a secondary position, so the need score counts him at ${n.starter.ovr - 3}, three lower than that overall.`);
  if (st?.injury) bits.push(`He is injured${num(st.injury.games) != null ? ` (about ${Math.ceil(st.injury.games)} games)` : ''}. The score is about the roster, not who can play tonight.`);
  else if (st?.il) bits.push('He is on the injured list. The score is about the roster, not who can play tonight.');
  const next = rows[1];
  if (!rows.length) bits.push('The spot is empty.');
  else if (!next) bits.push('No other eligible player.');
  else if (next.show == null) bits.push(`Next is ${next.p.name}, with no overall on file.`);
  else if (next.listed) bits.push(`Next is ${next.p.name}, overall ${next.show}, listed at ${n.pos}.`);
  else bits.push(`Next is ${next.p.name}, overall ${next.show}, secondary, so he counts at ${next.fitOvr}.`);
  for (const note of n.notes || []) {
    const who = st?.name || 'The best fit';
    if (note.startsWith('aging starter')) bits.push(`${who} is ${st?.age ?? note.replace(/\D/g, '')}. A best fit who is 33 or older adds to the score.`);
    else if (note === 'starter expiring') bits.push(st?.contract ? `${who} is in the last year of his deal, which adds to the score.` : `${who} has no contract on file, so the need score treats the spot as expiring.`);
  }
  return bits.join(' ');
}

function shootingSample(L, tid, clubs, ctx) {
  if (!ctx.season || ctx.kind === 'none' || ctx.kind === 'small') return null;
  const samples = [];
  let mineS = null;
  for (const t of clubs) {
    const s = threePoint(teamPlayers(L, t.tid), ctx.season);
    if (!s) continue;
    samples.push(s.pct);
    if (t.tid === tid) mineS = s;
  }
  if (!mineS) return null;
  const when = ctx.kind === 'prior' ? `${seasonLabel(ctx.season)} line for players still here: ` : 'Season line: ';
  if (samples.length < 4) {
    return { conflict: false, stat: { pct: mineS.pct, tpm: mineS.tpm, tpa: mineS.tpa, rank: null, n: samples.length }, text: `${when}${(mineS.pct * 100).toFixed(1)}% on ${mineS.tpa} threes. Fewer than 4 teams have ${MIN_3PA}+ attempts on file, so this is not ranked.` };
  }
  const sr = rankOf(samples, mineS.pct, true);
  const sm = median(samples);
  return {
    conflict: false, pending: true, median: sm, pct: mineS.pct,
    stat: { pct: mineS.pct, tpm: mineS.tpm, tpa: mineS.tpa, rank: sr, median: sm, n: samples.length },
    text: `${when}${(mineS.pct * 100).toFixed(1)}% on ${mineS.tpa} threes, ${place(sr)} of ${sr.n} (median ${(sm * 100).toFixed(1)}%).`,
  };
}
function findingText(cat, value, rk, med, smallLeague) {
  if (smallLeague) return `${cat.label} is ${value} on the display scale used on the player page. Only ${rk.n} team${rk.n === 1 ? '' : 's'} to compare, so this is the rating level, not a league rank.`;
  const gap = round1(value - med);
  const dir = gap > 0 ? `${gap} above` : `${Math.abs(gap)} below`;
  return `${cat.label} is ${value} on the display scale, ${place(rk)} of ${rk.n}, ${dir} the league median ${round1(med)}. That number is a rating, not a season stat.`;
}

/**
 * @returns read-only breakdown for one team. Safe on empty, thin, and older saves.
 */
export function teamBreakdown(L, tid) {
  const roster = (L && Array.isArray(L.players) && L.teams?.[tid]) ? teamPlayers(L, tid) : [];
  const phase = L?.phase || '';
  const read = 'Overall is his rating at the listed position. The need score gives that full credit and counts a secondary position 3 points lower. It is the same score as the draft team sheet. Ratings and season stats are labeled apart: a stat line does not change a rating, and a rating is not a result.';
  if (!L?.teams?.[tid]) {
    return { tid, empty: true, thin: true, players: 0, healthy: 0, phase, read, lineup: 'coach', lineupNote: 'Team not found.', stat: { kind: 'none', season: null, teamGp: 0, text: '' }, strengths: [], weaknesses: [], results: [], positions: [], needs: [] };
  }
  const plan = lineupPlan(L, tid, roster);
  const ctx = statContext(L, tid, roster);
  const needsRaw = teamNeedsDetail(L, tid);
  const needs = needsRaw.map((n, i) => ({ pos: n.pos, score: n.score, rank: i + 1, hot: i < 2, notes: [...(n.notes || [])], starter: n.starter, depth: n.depth, text: explainNeed(n, roster) }));
  const byId = new Map(roster.map(p => [p.pid, p]));
  const positions = SLOT.map(pos => {
    const rows = depthAt(roster, pos);
    const on = plan.slots[pos] != null ? byId.get(plan.slots[pos]) : null;
    const onFloor = on ? card(on, pos, plan, ctx) : null;
    const bench = rows.filter(r => !onFloor || r.p.pid !== onFloor.pid).slice(0, 6).map(r => card(r.p, pos, plan, ctx));
    let plain = '';
    if (!onFloor && !rows.length) plain = `No ${pos} on the roster.`;
    else if (!onFloor) plain = `Nobody starts at ${pos}. Best fit on the roster is ${rows[0].p.name}.`;
    else if (rows[0] && rows[0].p.pid !== onFloor.pid) plain = `${onFloor.name} is on the floor. Best need-score fit is ${rows[0].p.name}, who is not starting at ${pos}.`;
    else plain = `${onFloor.name} starts and is the best fit at ${pos}.`;
    return { pos, onFloor, bench, eligible: rows.length, plain };
  });
  const healthy = roster.filter(p => !p.il && !p.injury).length;
  const empty = roster.length === 0;
  const thin = !empty && (roster.length < 8 || healthy < 5);

  // League rating context: same minute-weighted display grades for every active team that has a player.
  const clubs = (L.teams || []).filter(t => t && !t.inactive);
  const weightsBy = new Map();
  for (const t of clubs) {
    const ps = teamPlayers(L, t.tid);
    if (!ps.length) continue;
    const pl = t.tid === tid ? plan : lineupPlan(L, t.tid, ps);
    weightsBy.set(t.tid, rotationWeights(pl, ps));
  }
  const smallLeague = weightsBy.size < 4;
  const strengths = [], weaknesses = [];
  const shoot = shootingSample(L, tid, clubs, ctx);
  if (!empty && weightsBy.has(tid)) {
    const mineW = weightsBy.get(tid);
    for (const cat of CATS) {
      const mine = catValue(mineW, cat);
      if (mine == null) continue;
      const all = [];
      for (const [, w] of weightsBy) { const v = catValue(w, cat); if (v != null) all.push(v); }
      if (!all.length) continue;
      const med = median(all);
      const rk = rankOf(all, mine, true);
      const gap = mine - med;
      const good = smallLeague ? mine >= 84 : gap >= 3;
      const bad = smallLeague ? mine <= 70 : gap <= -3;
      if (!good && !bad) continue;
      let linked = null;
      if (cat.shoot && shoot?.stat?.rank) {
        const statGood = shoot.pct >= shoot.median + 0.02, statBad = shoot.pct <= shoot.median - 0.02;
        const conflict = (good && statBad) || (bad && statGood);
        linked = { ...shoot, conflict, text: conflict ? `${shoot.text} The rating and the shot-making disagree; both are shown because they measure different things.` : shoot.text };
      }
      const text = findingText(cat, mine, rk, med, smallLeague);
      const row = {
        key: cat.key, label: cat.label, basis: linked ? 'both' : 'ratings', text,
        conflict: linked?.conflict ? linked.text : null,
        support: linked && !linked.conflict ? linked.text : null,
        rating: { value: mine, rank: rk.rank, tied: rk.tied, n: rk.n, median: round1(med) },
        stat: linked?.stat || null, gap: good ? gap : -gap,
      };
      if (good) strengths.push(row); else weaknesses.push(row);
    }
  }
  strengths.sort((a, b) => b.gap - a.gap);
  weaknesses.sort((a, b) => b.gap - a.gap);
  const topS = strengths.slice(0, 3).map(({ gap, ...r }) => r);
  const topW = weaknesses.slice(0, 3).map(({ gap, ...r }) => r);
  const outKept = [...topS, ...topW].some(r => r.key === 'out' && (r.support || r.conflict));
  const results = [];
  if (shoot && !outKept) results.push({ key: 'three', label: 'Three-point shooting', basis: 'stats', text: shoot.text, conflict: null, stat: shoot.stat });
  const rec = safeStandings(L)?.find(r => r.tid === tid);
  if (rec && rec.gp >= 15 && (phase === 'REGULAR' || phase === 'PLAYOFFS')) {
    const all = safeStandings(L).filter(r => r.gp >= MIN_TEAM_GP);
    if (all.length >= 4 && Math.abs(rec.diff) >= 2) {
      const rk = rankOf(all.map(r => r.diff), rec.diff, true);
      const med = median(all.map(r => r.diff));
      const ppg = round1(rec.pf / rec.gp), opp = round1(rec.pa / rec.gp), diff = round1(rec.diff);
      results.push({
        key: 'margin', label: 'Point differential', basis: 'stats', conflict: null,
        text: `From the schedule, after ${rec.gp} games: ${diff > 0 ? '+' : ''}${diff.toFixed(1)} points per game (${ppg.toFixed(1)} scored, ${opp.toFixed(1)} allowed), ${place(rk)} of ${rk.n}. League median is ${round1(med) > 0 ? '+' : ''}${round1(med).toFixed(1)}. That is results, not a rating.`,
        rating: null, stat: { value: diff, rank: rk.rank, n: rk.n, gp: rec.gp },
      });
    }
  }

  return {
    tid, empty, thin, players: roster.length, healthy, phase, read,
    lineup: plan.source, lineupNote: empty ? 'No players on this roster, so there is nothing to grade. Every position is open.' : lineupNote(plan.source, plan.healthy),
    stat: { kind: ctx.kind, season: ctx.season, teamGp: ctx.teamGp, text: empty ? '' : ctx.text },
    strengths: topS,
    weaknesses: topW,
    results: results.slice(0, 2),
    positions, needs,
  };
}
