// Read a Hardwood GM JSON save before anything is written.
// Returns the parsed league only when it has the fields the game already loads.
// It does not rewrite, migrate, or fill in a file that is a different format.
export function parseImportedSave(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, error: 'That file is not valid JSON.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'That file is not a Hardwood GM save.' };
  if (data.format === 'hgm-roster-1') return { ok: false, error: 'This is a roster file, not a saved game. Nothing was imported. To use it, start a new game and choose Roster file.' };
  if (Array.isArray(data.prospects) && !Array.isArray(data.teams)) return { ok: false, error: 'This is a draft-class file, not a saved game. Nothing was imported.' };
  if (!Array.isArray(data.teams) || !data.teams.length || !Array.isArray(data.players) || !data.players.length) return { ok: false, error: 'That file has no teams or players, so it is not a Hardwood GM save. Nothing was imported.' };
  if (data.version != null && Number(data.version) !== 1) return { ok: false, error: `This save is marked version ${data.version}. This game loads version 1 saves and did not change the file.` };
  const tid = data.userTid;
  if (tid == null || !data.teams[tid] || data.teams[tid].name == null) return { ok: false, error: 'This save does not say which team you control. Nothing was imported.' };
  if (data.season == null || data.phase == null) return { ok: false, error: 'This save is missing its season or phase. Nothing was imported.' };
  return { ok: true, league: data };
}

// Identity of the controlled team, used to confirm an import did not move players, picks, or the lineup.
export function controlledSnapshot(L) {
  const tid = L.userTid;
  const t = L.teams?.[tid] || {};
  const roster = (L.players || []).filter(p => p.tid === tid).map(p => [p.pid, p.tid, p.ovr, p.pot, p.contract ? p.contract.amt : null]).sort((a, b) => a[0] - b[0]);
  const picks = (L.picks || []).filter(k => k.tid === tid).map(k => [k.id, k.tid, k.orig, k.season, k.round]).sort();
  const rot = t.rotation || null;
  return {
    season: L.season, phase: L.phase, day: L.day, userTid: tid, abbr: t.abbr || null,
    roster, picks,
    starters: rot?.starters ? [...rot.starters] : null,
    order: rot?.order ? [...rot.order] : null,
    minutes: rot?.minutes ? { ...rot.minutes } : null,
    played: (L.schedule || []).filter(g => g.played).length,
    offers: (L.tradeOffers || []).length,
  };
}
