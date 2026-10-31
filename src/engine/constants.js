// Teams of the 1996-97 season. Text only: city + nickname; colors are each franchise's 1996-97 primary/secondary (colors only, no logos or marks).
export const TEAMS = [
  ['ATL','Atlanta','Hawks','E','Central','#c8102e','#fdb927'],
  ['BOS','Boston','Celtics','E','Atlantic','#007a33','#ffffff'],
  ['CHH','Charlotte','Hornets','E','Central','#00788c','#3d1f78'],
  ['CHI','Chicago','Bulls','E','Central','#ce1141','#111111'],
  ['CLE','Cleveland','Cavaliers','E','Central','#0a50a1','#f26c1f'],
  ['DAL','Dallas','Mavericks','W','Midwest','#0b4ea2','#00a352'],
  ['DEN','Denver','Nuggets','W','Midwest','#0d2240','#ffc72c'],
  ['DET','Detroit','Pistons','E','Central','#00848e','#7c2529'],
  ['GSW','Golden State','Warriors','W','Pacific','#1d428a','#ffc72c'],
  ['HOU','Houston','Rockets','W','Midwest','#ba0c2f','#0a2240'],
  ['IND','Indiana','Pacers','E','Central','#002d62','#fdbb30'],
  ['LAC','Los Angeles','Clippers','W','Pacific','#c8102e','#1d428a'],
  ['LAL','Los Angeles','Lakers','W','Pacific','#552583','#fdb927'],
  ['MIA','Miami','Heat','E','Atlantic','#98002e','#f9a01b'],
  ['MIL','Milwaukee','Bucks','E','Central','#00471b','#702f8a'],
  ['MIN','Minnesota','Timberwolves','W','Midwest','#0c4a8f','#00a94f'],
  ['NJN','New Jersey','Nets','E','Atlantic','#002a60','#cd1041'],
  ['NYK','New York','Knicks','E','Atlantic','#006bb6','#f58426'],
  ['ORL','Orlando','Magic','E','Atlantic','#0077c0','#111111'],
  ['PHI','Philadelphia','76ers','E','Atlantic','#006bb6','#ed174c'],
  ['PHX','Phoenix','Suns','W','Pacific','#1d1160','#e56020'],
  ['POR','Portland','Trail Blazers','W','Pacific','#e03a3e','#111111'],
  ['SAC','Sacramento','Kings','W','Pacific','#5a2d81','#a2aaad'],
  ['SAS','San Antonio','Spurs','W','Midwest','#111111','#c4ced4'],
  ['SEA','Seattle','SuperSonics','W','Pacific','#00653a','#ffc200'],
  ['TOR','Toronto','Raptors','E','Central','#6f2da8','#ce1141'],
  ['UTA','Utah','Jazz','W','Midwest','#3e2680','#b87333'],
  ['VAN','Vancouver','Grizzlies','W','Midwest','#00b2a9','#bc7844'],
  ['WAS','Washington','Bullets','E','Atlantic','#c8102e','#002b5c'],
].map(([abbr, city, name, conf, div, c1, c2], tid) => ({ tid, abbr, city, name, conf, div, c1, c2 }));

// Historical salary cap by season end-year ($ thousands). Beyond the table we grow 4.5%/yr.
export const CAP_HISTORY = {1997:24363,1998:26900,1999:30000,2000:34000,2001:35500,2002:42500,2003:40271,2004:43840,
  2005:43870,2006:49500,2007:53135,2008:55630,2009:58680,2010:57700,2011:58044,2012:58044,2013:58044,2014:58679,
  2015:63065,2016:70000,2017:94143,2018:99093,2019:101869,2020:109140,2021:109140,2022:112414,2023:123655,
  2024:136021,2025:140588,2026:154647};
// 1984-85 .. 1995-96 real caps ($ thousands, public league history). Before 1984-85 there was no cap: this is a
// salary SCALE only (the cap rule itself is off in those seasons), shrinking ~7%/yr so 1946-47 salaries land in the low thousands.
const CAP_EARLY = { 1985: 3600, 1986: 4233, 1987: 4945, 1988: 6164, 1989: 7232, 1990: 9802, 1991: 11871, 1992: 12500, 1993: 14000, 1994: 15175, 1995: 15964, 1996: 23000 };
export function capFor(season) {
  if (CAP_HISTORY[season]) return CAP_HISTORY[season];
  if (CAP_EARLY[season]) return CAP_EARLY[season];
  if (season < 1985) return Math.round(3600 * Math.pow(0.93, 1985 - season));
  return Math.round(CAP_HISTORY[2026] * Math.pow(1.045, season - 2026));
}
export const minSalary = (season) => Math.round(capFor(season) * 0.0102);
// years of NBA service (pre-1996 years + seasons played in the sim)
export const serviceYears = (p) => !p ? 99 : (p.prior?.yrs || 0) + new Set((p.career || []).filter(c => c.gp > 0).map(c => c.season)).size;
// 1995 CBA: no individual max (we cap at 125% of the cap as a sanity limit). 1999 CBA (lockout, Jan 1999): max by service —
// 0-6 yrs 25% of the cap, 7-9 yrs 30%, 10+ yrs 35% — or 105% of the player's previous salary, whichever is higher.
export const maxSalary = (season, p) => {
  if (!RULES.maxContract) return Math.round(capFor(season) * 1.25); // franchise setting: no individual max (sanity ceiling only)
  if (season < 1999) return Math.round(capFor(season) * 1.25);
  const y = serviceYears(p); const pct = y >= 10 ? 0.35 : y >= 7 ? 0.30 : 0.25;
  return Math.round(Math.max(capFor(season) * pct, p?.contract ? p.contract.amt * 1.05 : 0) / 10) * 10;
};
// 1995-2004 style lottery (13 non-playoff teams of 29; 1000 combinations, top 3 drawn)
export const LOTTERY_WEIGHTS = [250, 200, 157, 120, 89, 64, 44, 29, 18, 11, 7, 6, 5];
// live bindings: franchise settings (roster min/max, max contract) update these through setRules()
export let ROSTER_MAX = 15, ROSTER_MIN = 13;
export const RULES = { maxContract: true };
export function setRules({ rosterMin = 13, rosterMax = 15, maxContract = true } = {}) { ROSTER_MIN = rosterMin; ROSTER_MAX = rosterMax; RULES.maxContract = maxContract; }
export const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const PHASES = ['PRESEASON','REGULAR','PLAYOFFS','AWARDS','STAFF','LOTTERY','DRAFT','RESIGN','FA1','FA2','FA3','SUMMER'];
export const PHASE_LABEL = {PRESEASON:'Training Camp',REGULAR:'Regular Season',PLAYOFFS:'Playoffs',AWARDS:'Season Review',
  STAFF:'Staff Week',LOTTERY:'Draft Lottery',DRAFT:'Draft',RESIGN:'Re-sign Players',FA1:'Free Agency — Round 1',
  FA2:'Free Agency — Round 2',FA3:'Free Agency — Round 3',SUMMER:'Summer League Review'};
export const DIFFICULTY = {
  Easy:   { tradeMargin: -0.05, faMult: 0.9, ownerPatience: 1.5, scoutBonus: 10, injury: 0.7 },
  Medium: { tradeMargin: 0.05,  faMult: 1.0, ownerPatience: 1.0, scoutBonus: 0,  injury: 1.0 },
  Hard:   { tradeMargin: 0.15,  faMult: 1.12, ownerPatience: 0.7, scoutBonus: -8, injury: 1.2 },
};
export const ARCHETYPES = {
  Scout: 'Sharper draft and potential reads (+15 scouting accuracy).',
  Negotiator: 'Players ask for ~10% less when signing with you.',
  Motivator: 'Your young players develop a little faster.',
  Dealmaker: 'CPU teams accept slightly less in trades.',
  Disciplinarian: 'Fewer injuries (better conditioning).',
};
export const fmtMoney = (k) => k >= 1000 ? `$${(k / 1000).toFixed(k >= 10000 ? 1 : 2)}M` : `$${Math.round(k)}K`;
