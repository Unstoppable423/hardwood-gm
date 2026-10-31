// "Control any team" (2K-franchise style): jump to any team, run its roster, trades, signings and re-signings,
// then jump back to your own team. Your GM career (job security, season review, staff) stays with your home team.
// Teams you have controlled are "managed": in the re-sign phase their expiring players wait for your decision
// (unattended ones fall back to the CPU's own logic when the phase ends).
import { news, msg, logTx } from './league.js';
export const homeTid = (L) => L.homeTid ?? L.userTid;
export const isControlling = (L) => L.homeTid != null && L.homeTid !== L.userTid;
export function controlTeam(L, tid) {
  tid = +tid; const t = L.teams[tid]; if (!t || t.inactive) return { ok: false, error: 'No such team.' };
  if (L.fdraft) return { ok: false, error: 'Finish the fantasy draft first.' };
  if (tid === homeTid(L)) return returnHome(L);
  if (L.homeTid == null) L.homeTid = L.userTid;
  L.userTid = tid; L.managedTids = [...new Set([...(L.managedTids || []), tid])];
  logTx(L, { type: 'control', text: `${L.gm.name} took control of the ${t.city} ${t.name}` });
  return { ok: true, tid };
}
export function returnHome(L) {
  if (L.homeTid == null) return { ok: true, tid: L.userTid };
  L.userTid = L.homeTid; delete L.homeTid; return { ok: true, tid: L.userTid };
}
// switch teams for good: the new team becomes your GM's team
export function makeHomeTeam(L, tid) {
  tid = +tid; const t = L.teams[tid]; if (!t || t.inactive) return { ok: false, error: 'No such team.' };
  const from = homeTid(L); delete L.homeTid; L.userTid = tid; (L.gm.teams ||= [from]).push(tid); L.gm.jobSecurity = Math.max(L.gm.jobSecurity ?? 55, 55);
  L.teams[from].autoRotation = true;
  msg(L, 'Owner', `Welcome to ${t.city}`, `You are now the GM of the ${t.city} ${t.name}.`);
  news(L, `${L.gm.name} is the new GM of the ${t.city} ${t.name}.`, 'staff', tid);
  return { ok: true, tid };
}
export function managedSet(L) { return new Set([L.userTid, homeTid(L), ...(L.managedTids || [])]); }
