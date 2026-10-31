// Franchise timeline 1946-47 .. 1995-96 (season = the year a season ends; 1947 = 1946-47 BAA). Public league history
// (Wikipedia franchise and season articles). Each franchise is a list of segments; a new segment in a later year is a
// relocation/rename, a franchise's first segment is its entry year (expansion, NBL move, ABA merger) and the last
// segment's `to` is the year it folded. Segments reaching 1996 hand over to the real 1996-97 team list (constants.TEAMS).
// Lat/lon place teams on the map: before 1996-97 conferences/divisions are a geographic approximation of the real ones.
const F = (id, how, segs) => ({ id, how, segs: segs.map(([from, to, abbr, city, name, c1, c2, lat, lon]) => ({ from, to, abbr, city, name, c1, c2, lat, lon })) });
const NOW = 9999;
export const FRANCHISES = [
  F('BOS', 'BAA charter', [[1947, NOW, 'BOS', 'Boston', 'Celtics', '#007a33', '#ffffff', 42.4, -71.1]]),
  F('NYK', 'BAA charter', [[1947, NOW, 'NYK', 'New York', 'Knicks', '#006bb6', '#f58426', 40.8, -74.0]]),
  F('GSW', 'BAA charter', [[1947, 1962, 'PHW', 'Philadelphia', 'Warriors', '#1d428a', '#ffc72c', 40.0, -75.2], [1963, 1971, 'SFW', 'San Francisco', 'Warriors', '#1d428a', '#ffc72c', 37.8, -122.4], [1972, NOW, 'GSW', 'Golden State', 'Warriors', '#1d428a', '#ffc72c', 37.8, -122.3]]),
  F('PRO', 'BAA charter', [[1947, 1949, 'PRO', 'Providence', 'Steamrollers', '#5c2d91', '#c0c0c0', 41.8, -71.4]]),
  F('TRH', 'BAA charter', [[1947, 1947, 'TRH', 'Toronto', 'Huskies', '#003da5', '#ffffff', 43.7, -79.4]]),
  F('WSC', 'BAA charter', [[1947, 1951, 'WSC', 'Washington', 'Capitols', '#002868', '#bf0a30', 38.9, -77.0]]),
  F('CHS', 'BAA charter', [[1947, 1950, 'CHS', 'Chicago', 'Stags', '#8b0000', '#f5f5dc', 41.9, -87.6]]),
  F('CLR', 'BAA charter', [[1947, 1947, 'CLR', 'Cleveland', 'Rebels', '#0033a0', '#c8102e', 41.5, -81.7]]),
  F('DTF', 'BAA charter', [[1947, 1947, 'DTF', 'Detroit', 'Falcons', '#1f3f7a', '#d4af37', 42.3, -83.0]]),
  F('PIT', 'BAA charter', [[1947, 1947, 'PIT', 'Pittsburgh', 'Ironmen', '#000000', '#ffb612', 40.4, -80.0]]),
  F('STB', 'BAA charter', [[1947, 1950, 'STB', 'St. Louis', 'Bombers', '#c8102e', '#002f6c', 38.6, -90.2]]),
  F('BLB', 'joined from the ABL', [[1948, 1954, 'BLB', 'Baltimore', 'Bullets', '#e03a3e', '#00205b', 39.3, -76.6]]),
  F('DET', 'joined from the NBL', [[1949, 1957, 'FTW', 'Fort Wayne', 'Pistons', '#c8102e', '#1d42ba', 41.1, -85.1], [1958, NOW, 'DET', 'Detroit', 'Pistons', '#00848e', '#7c2529', 42.3, -83.0]]),
  F('INJ', 'joined from the NBL', [[1949, 1949, 'INJ', 'Indianapolis', 'Jets', '#003087', '#ffcd00', 39.8, -86.2]]),
  F('LAL', 'joined from the NBL', [[1949, 1960, 'MNL', 'Minneapolis', 'Lakers', '#1d4f91', '#c0c0c0', 45.0, -93.3], [1961, NOW, 'LAL', 'Los Angeles', 'Lakers', '#552583', '#fdb927', 34.0, -118.3]]),
  F('SAC', 'joined from the NBL', [[1949, 1957, 'ROC', 'Rochester', 'Royals', '#002d72', '#e31837', 43.2, -77.6], [1958, 1972, 'CIN', 'Cincinnati', 'Royals', '#002d72', '#e31837', 39.1, -84.5],
    [1973, 1975, 'KCO', 'Kansas City-Omaha', 'Kings', '#0046ad', '#e31837', 39.1, -94.6], [1976, 1985, 'KCK', 'Kansas City', 'Kings', '#0046ad', '#e31837', 39.1, -94.6], [1986, NOW, 'SAC', 'Sacramento', 'Kings', '#5a2d81', '#a2aaad', 38.6, -121.5]]),
  F('AND', 'joined from the NBL', [[1950, 1950, 'AND', 'Anderson', 'Packers', '#006400', '#ffd700', 40.1, -85.7]]),
  F('SHE', 'joined from the NBL', [[1950, 1950, 'SHE', 'Sheboygan', 'Red Skins', '#b22222', '#ffffff', 43.8, -87.7]]),
  F('WAT', 'joined from the NBL', [[1950, 1950, 'WAT', 'Waterloo', 'Hawks', '#000080', '#ffd700', 42.5, -92.3]]),
  F('DNN', 'joined from the NBL', [[1950, 1950, 'DNN', 'Denver', 'Nuggets', '#4b2e83', '#ffc72c', 39.7, -105.0]]),
  F('INO', 'joined from the NBL', [[1950, 1953, 'INO', 'Indianapolis', 'Olympians', '#003087', '#c8102e', 39.8, -86.2]]),
  F('PHI', 'joined from the NBL', [[1950, 1963, 'SYR', 'Syracuse', 'Nationals', '#002b5c', '#f47b20', 43.0, -76.1], [1964, NOW, 'PHI', 'Philadelphia', '76ers', '#006bb6', '#ed174c', 40.0, -75.2]]),
  F('ATL', 'joined from the NBL', [[1950, 1951, 'TRI', 'Tri-Cities', 'Blackhawks', '#c8102e', '#000000', 41.5, -90.6], [1952, 1955, 'MLH', 'Milwaukee', 'Hawks', '#c8102e', '#000000', 43.0, -87.9],
    [1956, 1968, 'STL', 'St. Louis', 'Hawks', '#002f6c', '#c8102e', 38.6, -90.2], [1969, NOW, 'ATL', 'Atlanta', 'Hawks', '#c8102e', '#fdb927', 33.8, -84.4]]),
  F('WAS', 'expansion', [[1962, 1962, 'CHP', 'Chicago', 'Packers', '#2e7d32', '#ffd700', 41.9, -87.6], [1963, 1963, 'CHZ', 'Chicago', 'Zephyrs', '#f47b20', '#002b5c', 41.9, -87.6],
    [1964, 1973, 'BAL', 'Baltimore', 'Bullets', '#e03a3e', '#00205b', 39.3, -76.6], [1974, 1974, 'CAP', 'Capital', 'Bullets', '#c8102e', '#002b5c', 38.9, -76.9], [1975, NOW, 'WAS', 'Washington', 'Bullets', '#c8102e', '#002b5c', 38.9, -77.0]]),
  F('CHI', 'expansion', [[1967, NOW, 'CHI', 'Chicago', 'Bulls', '#ce1141', '#111111', 41.9, -87.6]]),
  F('HOU', 'expansion', [[1968, 1971, 'SDR', 'San Diego', 'Rockets', '#00843d', '#ffc72c', 32.7, -117.2], [1972, NOW, 'HOU', 'Houston', 'Rockets', '#ba0c2f', '#0a2240', 29.8, -95.4]]),
  F('SEA', 'expansion', [[1968, NOW, 'SEA', 'Seattle', 'SuperSonics', '#00653a', '#ffc200', 47.6, -122.3]]),
  F('MIL', 'expansion', [[1969, NOW, 'MIL', 'Milwaukee', 'Bucks', '#00471b', '#702f8a', 43.0, -87.9]]),
  F('PHX', 'expansion', [[1969, NOW, 'PHX', 'Phoenix', 'Suns', '#1d1160', '#e56020', 33.4, -112.1]]),
  F('LAC', 'expansion', [[1971, 1978, 'BUF', 'Buffalo', 'Braves', '#002f6c', '#f47b20', 42.9, -78.9], [1979, 1984, 'SDC', 'San Diego', 'Clippers', '#0067b1', '#f47b20', 32.7, -117.2], [1985, NOW, 'LAC', 'Los Angeles', 'Clippers', '#c8102e', '#1d428a', 34.0, -118.3]]),
  F('CLE', 'expansion', [[1971, NOW, 'CLE', 'Cleveland', 'Cavaliers', '#0a50a1', '#f26c1f', 41.5, -81.7]]),
  F('POR', 'expansion', [[1971, NOW, 'POR', 'Portland', 'Trail Blazers', '#e03a3e', '#111111', 45.5, -122.7]]),
  F('UTA', 'expansion', [[1975, 1979, 'NOJ', 'New Orleans', 'Jazz', '#4b2e83', '#00843d', 30.0, -90.1], [1980, NOW, 'UTA', 'Utah', 'Jazz', '#3e2680', '#b87333', 40.8, -111.9]]),
  F('DEN', 'ABA merger', [[1977, NOW, 'DEN', 'Denver', 'Nuggets', '#0d2240', '#ffc72c', 39.7, -105.0]]),
  F('IND', 'ABA merger', [[1977, NOW, 'IND', 'Indiana', 'Pacers', '#002d62', '#fdbb30', 39.8, -86.2]]),
  F('NJN', 'ABA merger', [[1977, 1977, 'NYN', 'New York', 'Nets', '#002a60', '#cd1041', 40.7, -73.6], [1978, NOW, 'NJN', 'New Jersey', 'Nets', '#002a60', '#cd1041', 40.8, -74.1]]),
  F('SAS', 'ABA merger', [[1977, NOW, 'SAS', 'San Antonio', 'Spurs', '#111111', '#c4ced4', 29.4, -98.5]]),
  F('DAL', 'expansion', [[1981, NOW, 'DAL', 'Dallas', 'Mavericks', '#0b4ea2', '#00a352', 32.8, -96.8]]),
  F('CHH', 'expansion', [[1989, NOW, 'CHH', 'Charlotte', 'Hornets', '#00788c', '#3d1f78', 35.2, -80.8]]),
  F('MIA', 'expansion', [[1989, NOW, 'MIA', 'Miami', 'Heat', '#98002e', '#f9a01b', 25.8, -80.2]]),
  F('ORL', 'expansion', [[1990, NOW, 'ORL', 'Orlando', 'Magic', '#0077c0', '#111111', 28.5, -81.4]]),
  F('MIN', 'expansion', [[1990, NOW, 'MIN', 'Minnesota', 'Timberwolves', '#0c4a8f', '#00a94f', 45.0, -93.3]]),
  F('TOR', 'expansion', [[1996, NOW, 'TOR', 'Toronto', 'Raptors', '#6f2da8', '#ce1141', 43.7, -79.4]]),
  F('VAN', 'expansion', [[1996, NOW, 'VAN', 'Vancouver', 'Grizzlies', '#00b2a9', '#bc7844', 49.3, -123.1]]),
];
export const EARLIEST = 1947, LAST_HIST = 1996; // a 1996-97 start uses the original data/start1996.json path
export const segAt = (f, s) => f.segs.find(g => g.from <= s && s <= g.to) || null;
export const franchisesAt = (s) => FRANCHISES.filter(f => segAt(f, s));
// from 1980-81 (23 teams, the four-division layout that lasted to 2004) each franchise uses its 1996-97 conference/division; earlier seasons: split east/west by longitude,
// then (with 4+ teams a side from 1970-71, when the NBA first used conferences with divisions) north/south divisions.
const DIVN = { E: ['Atlantic', 'Central'], W: ['Midwest', 'Pacific'] };
import { TEAMS } from './constants.js';
const AL96 = Object.fromEntries(TEAMS.map(t => [t.abbr, { conf: t.conf, div: t.div }]));
export function alignment(s) {
  if (s >= 1981) return Object.fromEntries(franchisesAt(s).map(f => [f.id, AL96[f.id]]));
  const fs = franchisesAt(s).map(f => ({ f, g: segAt(f, s) })).sort((a, b) => b.g.lon - a.g.lon);
  const nE = Math.ceil(fs.length / 2); const out = {};
  fs.forEach((x, i) => { out[x.f.id] = { conf: i < nE ? 'E' : 'W' }; });
  for (const c of ['E', 'W']) {
    const side = fs.filter(x => out[x.f.id].conf === c);
    if (s < 1971 || side.length < 6) { for (const x of side) out[x.f.id].div = c === 'E' ? 'Eastern' : 'Western'; continue; }
    // Atlantic/Pacific = the coastal half (east: farthest east; west: farthest west)
    const byCoast = side.slice().sort((a, b) => c === 'E' ? b.g.lon - a.g.lon : a.g.lon - b.g.lon);
    byCoast.forEach((x, i) => { out[x.f.id].div = DIVN[c][i < Math.ceil(side.length / 2) ? (c === 'E' ? 0 : 1) : (c === 'E' ? 1 : 0)]; });
  }
  return out;
}
// team specs for a season (what newLeague builds L.teams from)
export function teamsAt(s) { const al = alignment(s); return franchisesAt(s).map(f => { const g = segAt(f, s); return { fid: f.id, abbr: g.abbr, city: g.city, name: g.name, c1: g.c1, c2: g.c2, ...al[f.id] }; }); }
// what changes going from season s-1 to s: joins (with how), folds, relocations/renames
export function changesAt(s) {
  const out = { join: [], fold: [], move: [] };
  for (const f of FRANCHISES) {
    const a = segAt(f, s - 1), b = segAt(f, s);
    if (!a && b) out.join.push({ f, g: b }); else if (a && !b) out.fold.push({ f, g: a }); else if (a && b && a !== b) out.move.push({ f, from: a, to: b });
  }
  return out;
}
// era facts by season (public league history)
export const GAMES = { 1947: 60, 1948: 48, 1949: 60, 1950: 68, 1951: 68, 1952: 66, 1953: 70, 1954: 72, 1960: 75, 1961: 79, 1962: 80, 1967: 81, 1968: 82 };
export const seasonGamesAt = (s) => { let g = 82; for (const [y, n] of Object.entries(GAMES)) if (s >= +y) g = n; return s >= 1968 ? (s === 1999 ? 50 : 82) : g; };
// active-roster limit by era (approximate public rule history): 10 in the BAA/early NBA, 12 from the late 1960s, 15 with inactive list in the sim from 1996-97
export const rosterMaxAt = (s) => s < 1958 ? 10 : s < 1966 ? 11 : s < 1997 ? 12 : 15;
