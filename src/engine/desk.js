// Trade-deadline board and draft scouting notes. Read-only: nothing here files or executes a trade,
// and nothing writes ratings, morale, or potential.
import { POS } from './constants.js';
import { dateOf, standings, confSeeds, teamPlayers } from './league.js';
import { teamMode } from './frontoffice.js';
import { playerValue } from './trade.js';
import { dispRating, ATTRS, ATTR_LABEL } from './players.js';

export const RECORD_GP = 15;
const CORE = ATTRS;

// Stylistic reference shapes on the same 40-99 display scale as the player page.
// firstSeason is the game season year of his rookie year (1997 = 1996-97). A draft may cite him
// only after that season, so a 1997 draft cannot call a 2003 draftee a former player.
export const ARCHETYPES = [
  { name: 'Magic Johnson', pos: 'PG', firstSeason: 1980, attrs: { pas: 96, han: 88, iq: 90, ath: 82, out: 72, ins: 78, reb: 74, pdef: 64, idef: 58 } },
  { name: 'John Stockton', pos: 'PG', firstSeason: 1985, attrs: { pas: 94, han: 86, iq: 90, out: 78, ins: 64, ath: 70, reb: 58, pdef: 76, idef: 52 } },
  { name: 'Gary Payton', pos: 'PG', firstSeason: 1991, attrs: { pdef: 94, han: 86, pas: 80, ath: 84, iq: 82, out: 74, ins: 70, reb: 62, idef: 60 } },
  { name: 'Michael Jordan', pos: 'SG', firstSeason: 1985, attrs: { ins: 94, out: 90, ath: 94, pdef: 90, han: 88, iq: 90, sco: 94, pas: 78, reb: 68, idef: 62 } },
  { name: 'Reggie Miller', pos: 'SG', firstSeason: 1988, attrs: { out: 96, iq: 86, han: 74, ath: 72, ins: 64, pas: 68, pdef: 70, reb: 56, idef: 48 } },
  { name: 'Clyde Drexler', pos: 'SG', firstSeason: 1984, attrs: { ath: 92, ins: 86, han: 84, out: 76, pas: 78, iq: 78, pdef: 74, reb: 70, idef: 58 } },
  { name: 'Larry Bird', pos: 'SF', firstSeason: 1980, attrs: { out: 92, iq: 94, pas: 86, ins: 84, reb: 78, han: 76, pdef: 68, ath: 66, idef: 60 } },
  { name: 'Scottie Pippen', pos: 'SF', firstSeason: 1988, attrs: { pdef: 92, ath: 90, iq: 88, pas: 82, han: 80, ins: 78, out: 74, reb: 74, idef: 72 } },
  { name: 'Karl Malone', pos: 'PF', firstSeason: 1986, attrs: { ins: 94, reb: 90, ath: 86, idef: 78, out: 72, iq: 78, pas: 68, han: 64, pdef: 66 } },
  { name: 'Charles Barkley', pos: 'PF', firstSeason: 1985, attrs: { ins: 90, reb: 92, ath: 84, han: 74, pas: 72, out: 70, iq: 76, idef: 64, pdef: 62 } },
  { name: 'Dennis Rodman', pos: 'PF', firstSeason: 1987, attrs: { reb: 98, idef: 90, pdef: 84, ath: 86, iq: 74, ins: 52, out: 42, pas: 48, han: 50 } },
  { name: 'Hakeem Olajuwon', pos: 'C', firstSeason: 1985, attrs: { idef: 94, ins: 90, reb: 88, ath: 86, iq: 84, han: 70, pas: 62, out: 48, pdef: 66 } },
  { name: 'Patrick Ewing', pos: 'C', firstSeason: 1986, attrs: { idef: 92, ins: 88, reb: 86, ath: 74, iq: 76, out: 52, pas: 54, han: 50, pdef: 58 } },
  { name: 'David Robinson', pos: 'C', firstSeason: 1990, attrs: { ath: 90, idef: 88, ins: 86, reb: 86, iq: 82, pdef: 70, han: 64, pas: 60, out: 50 } },
  { name: "Shaquille O'Neal", pos: 'C', firstSeason: 1993, attrs: { ins: 96, ath: 90, idef: 86, reb: 88, out: 40, han: 48, pas: 52, iq: 64, pdef: 50 } },
];

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const show = (v) => { const d = dispRating(v); return num(d); };

function safeStandings(L) {
  if (!Array.isArray(L?.schedule) || !Array.isArray(L?.teams)) return null;
  try { return standings(L); } catch { return null; }
}

export function tradeWindow(L) {
  const phase = L?.phase || '';
  const settingOff = L?.settings?.tradeDeadline === false;
  const stored = num(L?.tradeDeadline);
  const hasDate = !settingOff && stored != null;
  const day = num(L?.day) ?? 0;
  const dateText = hasDate ? dateOf(L, stored) : null;
  if (['PLAYOFFS', 'FA1', 'FA2', 'FA3'].includes(phase)) {
    return { open: false, past: false, hasDate, dateText, day, settingOff, daysLeft: null, note: phase === 'PLAYOFFS' ? 'Trades are closed during the playoffs.' : 'Trades are closed during free agency.' };
  }
  if (settingOff) return { open: true, past: false, hasDate: false, dateText: null, day, settingOff, daysLeft: null, note: 'The franchise setting turns the trade deadline off, so the calendar does not close trades.' };
  if (phase === 'REGULAR' && !hasDate) return { open: true, past: false, hasDate: false, dateText: null, day, settingOff, daysLeft: null, note: 'No deadline date is stored on this save, so the season is not closed by a date.' };
  if (phase === 'REGULAR' && day > stored) return { open: false, past: true, hasDate, dateText, day, settingOff, daysLeft: 0, note: `The deadline was ${dateText}. Trades are closed.` };
  if (phase === 'REGULAR') return { open: true, past: false, hasDate, dateText, day, settingOff, daysLeft: stored - day, note: `Deadline ${dateText}. ${stored - day} day${stored - day === 1 ? '' : 's'} left. Today is ${dateOf(L, day)}.` };
  return { open: true, past: false, hasDate, dateText, day, settingOff, daysLeft: null, note: hasDate ? `Trades are open in this phase. The regular-season deadline on file is ${dateText}.` : 'Trades are open in this phase. No regular-season deadline date is stored.' };
}

function listedNeeds(L, tid) {
  const ps = teamPlayers(L, tid);
  return POS.map(pos => {
    const at = ps.filter(p => p && p.pos === pos);
    const best = at.reduce((m, p) => Math.max(m, num(p.ovr) ?? 0), 0);
    return { pos, best: at.length ? best : 40, n: at.length };
  }).sort((a, b) => a.best - b.best || a.pos.localeCompare(b.pos)).slice(0, 2);
}

function recordLean(L, tid, rec, byConf) {
  if (!rec || rec.gp < RECORD_GP) return { lean: null, gp: rec?.gp ?? 0, text: rec ? `${rec.w}-${rec.l} after ${rec.gp} games. Fewer than ${RECORD_GP}, so the record is not used.` : 'No standings are available.' };
  const conf = L.teams?.[tid]?.conf;
  const list = byConf[conf] || [];
  const per = Math.max(1, Math.round((L.settings?.playoffTeams || 16) / 2));
  const idx = list.findIndex(r => r.tid === tid);
  const seed = idx >= 0 ? idx + 1 : null;
  const cut = list[Math.min(per, list.length) - 1];
  const gb = cut ? ((cut.w - rec.w) + (rec.l - cut.l)) / 2 : null;
  const inField = seed != null && seed <= per;
  let lean = 'middle';
  if (inField || (gb != null && gb <= 2 && rec.pct >= 0.45)) lean = 'buyer';
  else if ((gb != null && gb >= 6) || (rec.pct < 0.4 && !inField)) lean = 'seller';
  const gbTxt = gb == null ? '' : gb === 0 ? ', even with the last playoff spot' : gb > 0 ? `, ${Math.round(gb * 10) / 10} games behind the last playoff spot` : `, ${Math.round(-gb * 10) / 10} games ahead of the last playoff spot`;
  return { lean, gp: rec.gp, w: rec.w, l: rec.l, seed, text: `${rec.w}-${rec.l}${seed ? `, ${conf === 'E' ? 'East' : 'West'} seed ${seed}` : ''}${gbTxt}.` };
}

function combine(rosterMode, record) {
  const rosterSide = rosterMode === 'contend' ? 'buyer' : rosterMode === 'rebuild' ? 'seller' : 'middle';
  if (!record || record.lean == null) return { side: rosterSide === 'middle' ? 'unclear' : rosterSide, from: 'roster' };
  if (record.lean === 'middle' && rosterSide === 'middle') return { side: 'unclear', from: 'both' };
  if (record.lean === 'middle') return { side: rosterSide === 'middle' ? 'unclear' : rosterSide, from: 'roster' };
  if (rosterSide === 'middle' || rosterSide === record.lean) return { side: record.lean, from: 'record' };
  return { side: 'mixed', from: 'both' };
}

export function deadlineBoard(L) {
  const win = tradeWindow(L || {});
  const teams = Array.isArray(L?.teams) ? L.teams.filter(t => t && !t.inactive) : [];
  const recs = safeStandings(L);
  const byId = recs ? Object.fromEntries(recs.map(r => [r.tid, r])) : {};
  const byConf = {};
  if (recs) for (const c of ['E', 'W']) { try { byConf[c] = confSeeds(L, c, recs); } catch { byConf[c] = recs.filter(r => L.teams[r.tid]?.conf === c); } }
  const rows = teams.map(t => {
    const mode = teamMode(L, t.tid);
    const record = recordLean(L, t.tid, byId[t.tid], byConf);
    const judged = combine(mode, record);
    const rosterLine = mode === 'contend' ? `Roster rating rank is in the top 9 (${mode}).` : mode === 'rebuild' ? `Roster rating rank is 21st or worse (${mode}).` : `Roster rating rank is in the middle (${mode}).`;
    let why = `${record.text} ${rosterLine}`;
    if (judged.side === 'buyer') why += ' Those facts point to a buyer.';
    else if (judged.side === 'seller') why += ' Those facts point to a seller.';
    else if (judged.side === 'mixed') why += ' The record and the roster rating disagree, so this team is mixed rather than a clear buyer or seller.';
    else why += ' Not enough agreement to call this team a buyer or a seller.';
    return { tid: t.tid, abbr: t.abbr, side: judged.side, mode, record: record.lean, why };
  }).sort((a, b) => a.abbr.localeCompare(b.abbr));
  const opportunities = [];
  if (win.open && L?.userTid != null) {
    const needs = listedNeeds(L, L.userTid);
    const sellers = rows.filter(r => r.side === 'seller' && r.tid !== L.userTid);
    for (const need of needs) {
      let best = null;
      for (const s of sellers) {
        const roster = teamPlayers(L, s.tid).filter(p => p && !p.il);
        if (!roster.length) continue;
        const star = roster.slice().sort((a, b) => playerValue(L, b) - playerValue(L, a) || a.pid - b.pid)[0];
        const cand = roster.filter(p => p.pos === need.pos && p.pid !== star.pid && (show(p.ovr) ?? 0) >= 72).sort((a, b) => (b.ovr - a.ovr) || (a.pid - b.pid))[0];
        if (!cand) continue;
        if (!best || cand.ovr > best.p.ovr || (cand.ovr === best.p.ovr && cand.pid < best.p.pid)) best = { p: cand, seller: s };
      }
      if (!best) continue;
      opportunities.push({
        tid: best.seller.tid, pid: best.p.pid, name: best.p.name, pos: need.pos, ovr: show(best.p.ovr),
        why: `${best.seller.abbr} is a seller. ${best.p.name} is a listed ${need.pos} at ${show(best.p.ovr)} overall, and ${need.pos} is one of your two thinnest listed spots. He is not that team's highest-value player. This is not an offer.`,
      });
    }
  }
  return { ...win, teams: rows, opportunities: opportunities.slice(0, 4), scope: 'Buyers and sellers use the standings once a team has 15 games, plus roster-rating rank. No offer is created here. Opening a name only fills the propose screen.' };
}

function grades(p) {
  const rows = [];
  const src = p?.ratings;
  if (!src) return rows;
  for (const k of Object.keys(ATTR_LABEL)) {
    if (src[k] == null || num(src[k]) == null) continue;
    if (!CORE.includes(k) && !['sco', 'blk', 'stl'].includes(k)) continue;
    const v = show(src[k]);
    if (v == null) continue;
    rows.push({ k, label: ATTR_LABEL[k], v });
  }
  return rows;
}

function centeredCos(a, b, keys) {
  const ma = keys.reduce((s, k) => s + a[k], 0) / keys.length;
  const mb = keys.reduce((s, k) => s + b[k], 0) / keys.length;
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const x = a[k] - ma, y = b[k] - mb;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na < 1e-6 || nb < 1e-6) return 0;
  return dot / Math.sqrt(na * nb);
}

export function scoutReport(p, { draftYear = null, hidden = false, careers = 'real' } = {}) {
  const base = { hidden: !!hidden, strengths: [], weaknesses: [], comparison: null, lines: [] };
  if (!p) return { ...base, lines: ['No prospect.'] };
  if (hidden) return { ...base, lines: ['Rookie ratings are hidden until he is drafted, so strengths, weaknesses, and a comparison are not shown.'] };
  const g = grades(p);
  if (g.length < 4) {
    base.lines.push(g.length ? 'Too few attribute grades are on file to call strengths or a likeness.' : 'Attribute grades are not on file.');
  } else {
    const med = g.map(x => x.v).sort((a, b) => a - b)[Math.floor(g.length / 2)];
    base.strengths = g.filter(x => x.v >= 78 && x.v >= med + 6).sort((a, b) => b.v - a.v).slice(0, 2);
    base.weaknesses = g.filter(x => x.v <= 68 && x.v <= med - 6).sort((a, b) => a.v - b.v).slice(0, 2);
    base.lines.push(base.strengths.length ? `Strengths from his grades: ${base.strengths.map(s => `${s.label} ${s.v}`).join(', ')}.` : 'No grade stands far enough above his others to call a strength.');
    base.lines.push(base.weaknesses.length ? `Weaknesses from his grades: ${base.weaknesses.map(s => `${s.label} ${s.v}`).join(', ')}.` : 'No grade stands far enough below his others to call a weakness.');
  }
  const ovr = show(p.ovr), pot = show(p.pot);
  if (ovr == null) base.lines.push('Overall is not on file.');
  else if (pot == null) base.lines.push(`Overall on file is ${ovr}. Potential is not on file.`);
  else base.lines.push(`Overall on file is ${ovr}. Potential on file is ${pot}${pot > ovr ? ` (${pot - ovr} higher)` : pot === ovr ? ' (no gap)' : ''}.`);
  if (p.real && careers !== 'random') base.lines.push('Real-career mode is on. A real prospect’s stored potential can be pulled toward his real career later. This note does not change that number.');
  else base.lines.push('No real-career path is applied in this note. Potential stays the number stored on the prospect.');
  if (draftYear == null || !Number.isFinite(+draftYear)) {
    base.lines.push('Draft year is not on file, so there is no former-player comparison.');
    return base;
  }
  const year = +draftYear;
  const pool = ARCHETYPES.filter(a => a.firstSeason < year && a.pos === p.pos);
  const mine = Object.fromEntries(g.filter(x => CORE.includes(x.k) || ['sco'].includes(x.k)).map(x => [x.k, x.v]));
  let best = null;
  for (const a of pool) {
    const keys = Object.keys(a.attrs).filter(k => mine[k] != null);
    if (keys.length < 5) continue;
    const score = centeredCos(mine, a.attrs, keys);
    if (!best || score > best.score) best = { a, score, keys: keys.length };
  }
  if (!best || best.score < 0.72) {
    base.lines.push(`No reliable stylistic comparison among ${p.pos} references whose careers had already started before the ${year} draft.`);
    return base;
  }
  base.comparison = { name: best.a.name, pos: best.a.pos, firstSeason: best.a.firstSeason, score: Math.round(best.score * 100) / 100 };
  const debut = `${best.a.firstSeason - 1}-${String(best.a.firstSeason).slice(2)}`;
  base.lines.push(`Stylistic likeness, not a career projection: his grade shape is closest to ${best.a.name} (${best.a.pos}), whose career was already underway before this draft (first season ${debut}). This is not a scout quote and does not predict awards or how his career will go.`);
  return base;
}
