// Injured List (the NBA analog of Pocket GM 2's injured reserve). A player out >= IL_MIN_GAMES can be listed;
// listed players don't count toward the 15-man limit, so the team can sign a fill-in. Up to IL_MAX at once.
// Healed players stay listed until activated (the user decides; AI activates and trims its roster).
import { HOOKS, teamPlayers, getP, msg, news, logTx } from './league.js';
import { ROSTER_MAX, ROSTER_MIN, minSalary } from './constants.js';
import { sign, release, freeAgents } from './offseason.js';

export const IL_MAX = 3, IL_MIN_GAMES = 5;
export const ilPlayers = (L, tid) => teamPlayers(L, tid).filter(p => p.il);
export const activeCount = (L, tid) => teamPlayers(L, tid).filter(p => !p.il).length;
const inSeason = (L) => L.phase === 'REGULAR' || L.phase === 'PLAYOFFS';

export function canPlaceIL(L, p) {
  if (!inSeason(L)) return { ok: false, error: 'The injured list is used during the season.' };
  if (p.il) return { ok: false, error: 'Already on the injured list.' };
  if (!p.injury || p.injury.games < IL_MIN_GAMES) return { ok: false, error: `Only players out ${IL_MIN_GAMES}+ games can be listed.` };
  if (ilPlayers(L, p.tid).length >= IL_MAX) return { ok: false, error: `The injured list is full (${IL_MAX}).` };
  return { ok: true };
}
export function placeIL(L, pid) {
  const p = getP(L, pid); const c = canPlaceIL(L, p); if (!c.ok) return c;
  p.il = { day: L.day, season: L.season };
  logTx(L, { type: 'il', text: `${L.teams[p.tid].abbr} placed ${p.name} on the injured list (${p.injury.type})` }, [p.pid]);
  return { ok: true };
}
export function canActivate(L, p) {
  if (!p.il) return { ok: false, error: 'Not on the injured list.' };
  if (p.injury) return { ok: false, error: `${p.name} is still injured (~${Math.ceil(p.injury.games)} games).` };
  if (activeCount(L, p.tid) >= ROSTER_MAX) return { ok: false, error: `Active roster is full (${ROSTER_MAX}). Release someone first.` };
  return { ok: true };
}
export function activateIL(L, pid) {
  const p = getP(L, pid); const c = canActivate(L, p); if (!c.ok) return c;
  p.il = null; logTx(L, { type: 'il', text: `${L.teams[p.tid].abbr} activated ${p.name} from the injured list` }, [p.pid]);
  return { ok: true };
}
export function clearIL(L) { for (const p of L.players) if (p.il) p.il = null; }

const bestFA = (L) => freeAgents(L).filter(x => !x.injury).sort((a, b) => b.ovr - a.ovr)[0];
// AI: list long-term injured (prefer the best players), sign a min fill-in when short; activate healed players.
function aiIL(L) {
  for (const t of L.teams) if (!t.inactive) {
    if (t.tid === L.userTid || t.inactive) continue;
    const ps = teamPlayers(L, t.tid);
    for (const p of ps.filter(p => p.il && !p.injury)) {
      if (activeCount(L, t.tid) >= ROSTER_MAX) {
        const cut = teamPlayers(L, t.tid).filter(x => !x.il && x !== p).sort((a, b) => (a.ovr + (a.contract?.amt || 0) / 2000) - (b.ovr + (b.contract?.amt || 0) / 2000))[0];
        if (cut) release(L, cut, true);
      }
      activateIL(L, p.pid);
    }
    const hurt = ps.filter(p => p.tid === t.tid && !p.il && p.injury && p.injury.games >= 10).sort((a, b) => b.ovr - a.ovr);
    for (const p of hurt) {
      if (!canPlaceIL(L, p).ok) break;
      placeIL(L, p.pid);
      if (L.phase === 'REGULAR' && activeCount(L, t.tid) < ROSTER_MAX && teamPlayers(L, t.tid).filter(x => !x.injury).length < ROSTER_MIN + 1) {
        const f = freeAgents(L).filter(x => !x.injury).sort((a, b) => b.ovr - a.ovr)[0];
        if (f) { sign(L, f, t.tid, minSalary(L.season), 1); if (p.ovr >= 78) news(L, `${t.abbr} put ${p.name} on the injured list and signed ${f.name} to fill in.`, 'transaction', t.tid); }
      }
    }
  }
  // roster floor: AI refills to 13 active right away; the user is warned, then the league signs minimum players after 7 days
  if (L.phase === 'REGULAR') {
    for (const t of L.teams) if (!t.inactive) { if (t.inactive || t.tid === L.userTid) continue; while (activeCount(L, t.tid) < ROSTER_MIN) { const f = bestFA(L); if (!f) break; sign(L, f, t.tid, minSalary(L.season), 1); } }
    const u = L.userTid, n = activeCount(L, u);
    if (n >= ROSTER_MIN) L.shortSince = null;
    else if (L.shortSince == null) { L.shortSince = L.day; msg(L, 'League Office', 'Roster below the minimum', `You have ${n} active players; the league requires ${ROSTER_MIN}. Sign free agents within 7 days or the league will sign minimum players for you.`, { pri: 'high' }); }
    else if (L.day - L.shortSince >= 7) { const got = []; while (activeCount(L, u) < ROSTER_MIN) { const f = bestFA(L); if (!f) break; sign(L, f, u, minSalary(L.season), 1); got.push(f.name); } L.shortSince = null; if (got.length) msg(L, 'League Office', 'Roster filled by the league', `To meet the ${ROSTER_MIN}-player minimum the league signed ${got.join(', ')} to 1-year minimum deals.`, { pri: 'high' }); }
  }
  // user: nudge once when a listed player is healthy again
  for (const p of ilPlayers(L, L.userTid)) if (!p.injury && !p.il.told) { p.il.told = true; msg(L, 'Head Trainer', `${p.name} is ready to return`, `${p.name} is healthy. Activate him from the injured list (his player page) when you have an open roster spot.`, { pri: 'high' }); }
}
const prevDay = HOOKS.day;
HOOKS.day = (L) => { prevDay?.(L); if (inSeason(L)) aiIL(L); };
const prevPhase = HOOKS.phase;
HOOKS.phase = (L, from) => { prevPhase?.(L, from); if (from === 'PLAYOFFS') clearIL(L); };
