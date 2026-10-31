// Custom roster files: export the current league's players to an editable JSON file, and start a new league
// from one (Pocket GM 2 lets you start from default, random or imported rosters). Our own format: hgm-roster-1.
import { dispRating, playerFromFile, FILE_KEYS } from './players.js';
import { teamPlayers, resetSeasonStats } from './league.js';
import { minSalary, maxSalary } from './constants.js';
export const ROSTER_FORMAT = 'hgm-roster-1';

export function exportRosterFile(L) {
  const players = L.players.filter(p => p.tid >= -1 && !p.retired).map(p => ({
    name: p.name, team: p.tid >= 0 ? L.teams[p.tid].abbr : 'FA', pos: p.pos, age: p.age, height: p.h, weight: p.w, num: p.num ?? null,
    college: p.college || undefined, country: p.country || undefined,
    ovr: dispRating(p.ovr), pot: dispRating(p.pot), ratings: Object.fromEntries(FILE_KEYS.filter(k => p.ratings[k] != null).map(k => [k, dispRating(p.ratings[k])])),
    exact: { ...Object.fromEntries(FILE_KEYS.filter(k => p.ratings[k] != null).map(k => [k, p.ratings[k]])), pot: p.pot }, // internal values; used only where the displayed number was not edited
    contract: p.contract ? { amt: p.contract.amt, exp: p.contract.exp } : null,
  }));
  return { format: ROSTER_FORMAT, scale: 'display 40-99', season: L.season, teams: L.teams.filter(t => !t.inactive).map(t => ({ abbr: t.abbr, city: t.city, name: t.name })),
    help: 'Edit names, teams (abbr or FA), positions (PG/SG/SF/PF/C), ages, heights (cm), jersey numbers, ratings (40-99), contracts (amt in $K per year, exp = last season, e.g. 1999 = 1998-99). Omit ratings to build a player from ovr. The exact block is optional (keeps unedited ratings precise).', players };
}

export function validateRosterFile(f) {
  if (!f || typeof f !== 'object') return { ok: false, error: 'Not a roster file.' };
  if (f.format !== ROSTER_FORMAT) return { ok: false, error: `Unknown format (expected ${ROSTER_FORMAT}).` };
  if (!Array.isArray(f.players) || !f.players.length) return { ok: false, error: 'The file has no players.' };
  if (f.players.length > 800) return { ok: false, error: 'Too many players (max 800).' };
  const bad = f.players.findIndex(r => !r || typeof r.name !== 'string' || !r.name.trim());
  if (bad >= 0) return { ok: false, error: `Player #${bad + 1} has no name.` };
  return { ok: true };
}

// Replace every rostered player and free agent with the file's players (draft classes, staff and teams stay).
export function applyRosterFile(L, f) {
  const v = validateRosterFile(f); if (!v.ok) return v;
  const warnings = [];
  const byAbbr = Object.fromEntries(L.teams.map(t => [t.abbr.toUpperCase(), t.tid]));
  L.players = L.players.filter(p => p.tid < -1); // keep draft prospects (tid -2)
  for (const rec of f.players) {
    const p = playerFromFile(rec, L.season);
    const ab = String(rec.team || 'FA').toUpperCase();
    p.tid = ab === 'FA' ? -1 : byAbbr[ab] ?? -1; if (ab !== 'FA' && byAbbr[ab] == null) warnings.push(`${p.name}: unknown team "${rec.team}", made a free agent`);
    if (p.tid >= 0) {
      const amt = rec.contract?.amt != null ? Math.round(Math.max(minSalary(L.season), Math.min(maxSalary(L.season, p), +rec.contract.amt))) : null;
      const exp = rec.contract?.exp != null ? Math.max(L.season, Math.min(L.season + 6, Math.round(+rec.contract.exp))) : L.season + 1 + (p.pid % 3);
      p.contract = { amt: amt ?? Math.max(minSalary(L.season), Math.round(p.ovr > 60 ? (p.ovr - 55) * 180 : 0)), exp };
    }
    resetSeasonStats(p, L.season); L.players.push(p);
  }
  // jersey numbers: fix duplicates within a team
  for (const t of L.teams) if (!t.inactive) { const used = new Set(); for (const p of teamPlayers(L, t.tid)) { let n = p.num; if (n == null || used.has(n)) { n = null; for (let k = 0; k < 100 && n == null; k++) if (!used.has(String(k))) n = String(k); p.num = n; } used.add(p.num); } }
  L.rosterImport = { n: f.players.length, warnings: warnings.slice(0, 20) };
  return { ok: true, n: f.players.length, warnings };
}
