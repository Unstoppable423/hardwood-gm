// Franchise settings (2K MyLeague-style). Every key here drives the engine; see tests "franchise settings".
// Stored in L.settings (older saves get defaults through ensureSettings). Changeable mid-save unless setupOnly.
import { setRules, capFor } from './constants.js';

export const FS_DEFAULTS = {
  capMode: 'soft',        // soft: NBA exceptions (Bird, min, MLE) · hard: payroll can never exceed the cap · off: no cap at all
  luxuryTax: true,        // tax line = 121.5% of cap; $1.50 per $1 over; from 2001-02 with real history on
  cpuOffers: true, cpuOfferFreq: 1,      // CPU trade offers to the user (Trade Center), incl. unsolicited ones
  cpuTrades: true, cpuTradeFreq: 1,      // CPU-CPU trades
  tradeDifficulty: 'Default',            // Default follows the difficulty slider
  tradeDeadline: true,
  injuries: 1,                           // 0 off, 0.5 low, 1 normal, 1.6 high
  progression: 1,                        // yearly rating change multiplier (0.5 slow .. 1.5 fast)
  simDifficulty: 'Normal',               // user team edge in games: Easy +, Hard −
  rookieScale: true,                     // off: drafted players get market-value deals
  rosterMin: 13, rosterMax: 15,
  seasonGames: 82,                       // 82 respects real lockout seasons (1999: 50, 2012: 66) when real history is on
  playoffTeams: 16, r1Len: 'era', laterLen: 7,
  lottery: true,
  draftAll: false,                       // draft for every team: the draft room stops on every pick (per-team picks: L.draftTeams)
  draftClasses: 'real',                  // real NBA draft classes (1997-2026 from Wikipedia, 2027 CBS mock) or generated
  realHistory: true,
  maxContract: true,
  retirement: true,
  morale: true,                          // player morale and trade requests
  careers: 'real',                       // real-life career arcs for real players: real | mostly | random
};
export const FREQ = { 0.5: 'Low', 1: 'Normal', 2: 'High' };
export const TRADE_MARGIN = { Easy: -0.05, Medium: 0.05, Hard: 0.15, Insane: 0.3 };
export const SIM_EDGE = { Easy: 0.012, Normal: 0, Hard: -0.012, Insane: -0.024 };

export function ensureSettings(L) {
  const st = L.settings ||= {};
  if (st.capMode == null && st.playerCap === false) st.capMode = 'off'; // old saves: "Salary cap: Off" was user-only
  for (const [k, v] of Object.entries(FS_DEFAULTS)) if (st[k] === undefined) st[k] = v;
  st.rosterMax = Math.max(st.rosterMin + 1, st.rosterMax);
  applyRules(L);
  return st;
}
export function applyRules(L) { const st = L.settings || FS_DEFAULTS; setRules({ rosterMin: st.rosterMin ?? 13, rosterMax: st.rosterMax ?? 15, maxContract: st.maxContract !== false }); }
const S = (L) => L.settings || FS_DEFAULTS;
export const deadlineDay = (L) => S(L).tradeDeadline === false ? Infinity : (L.tradeDeadline ?? Infinity);
export const tradeMargin = (L, fallback) => TRADE_MARGIN[S(L).tradeDifficulty] ?? fallback;
export const simEdge = (L) => SIM_EDGE[S(L).simDifficulty] ?? 0;
export const taxActive = (L) => S(L).luxuryTax !== false && S(L).capMode !== 'off' && (S(L).realHistory === false || L.season >= 2002);
export const taxLine = (L) => Math.round(capFor(L.season) * 1.215);
export function seriesLen(L, round) {
  const st = S(L);
  if (round > 1) return +st.laterLen || 7;
  if (st.r1Len !== 'era') return +st.r1Len;
  return st.realHistory !== false && L.season < 2003 ? 5 : 7; // first round went best-of-7 in 2003
}
// UI metadata: [key, label, options, group, setupOnly]
const YN = [[true, 'On'], [false, 'Off']];
export const FS_META = [
  ['capMode', 'Salary cap', [['soft', 'Soft (NBA)'], ['hard', 'Hard'], ['off', 'Off']], 'Money'],
  ['luxuryTax', 'Luxury tax', YN, 'Money'],
  ['maxContract', 'Max contract', YN, 'Money'],
  ['rookieScale', 'Rookie scale', YN, 'Money'],
  ['cpuOffers', 'CPU offers to you', YN, 'Trades'], ['cpuOfferFreq', 'Offer frequency', [[0.5, 'Low'], [1, 'Normal'], [2, 'High']], 'Trades'],
  ['cpuTrades', 'CPU-CPU trades', YN, 'Trades'], ['cpuTradeFreq', 'CPU-CPU frequency', [[0.5, 'Low'], [1, 'Normal'], [2, 'High']], 'Trades'],
  ['tradeDifficulty', 'Trade AI', [['Default', 'Follow difficulty'], ['Easy', 'Easy'], ['Medium', 'Medium'], ['Hard', 'Hard'], ['Insane', 'Insane']], 'Trades'],
  ['tradeDeadline', 'Trade deadline', YN, 'Trades'],
  ['injuries', 'Injuries', [[0, 'Off'], [0.5, 'Low'], [1, 'Normal'], [1.6, 'High']], 'Players'],
  ['progression', 'Progression speed', [[0.5, 'Slow'], [0.75, 'Slower'], [1, 'Normal'], [1.25, 'Faster'], [1.5, 'Fast']], 'Players'],
  ['morale', 'Morale & trade requests', YN, 'Players'],
  ['retirement', 'Retirements', YN, 'Players'],
  ['simDifficulty', 'Sim difficulty', [['Easy', 'Easy'], ['Normal', 'Normal'], ['Hard', 'Hard'], ['Insane', 'Insane']], 'League'],
  ['rosterMin', 'Roster minimum', [[8, '8'], [10, '10'], [12, '12'], [13, '13'], [14, '14']], 'League'],
  ['rosterMax', 'Roster maximum', [[13, '13'], [14, '14'], [15, '15'], [17, '17'], [20, '20']], 'League'],
  ['seasonGames', 'Season length', [[82, '82 (real lockouts)'], [72, '72'], [66, '66'], [58, '58'], [50, '50']], 'League'],
  ['playoffTeams', 'Playoff teams', [[16, '16'], [8, '8'], [4, '4']], 'League'],
  ['r1Len', 'First round', [['era', 'Era (Bo5 to 2002)'], [7, 'Best of 7'], [5, 'Best of 5'], [3, 'Best of 3'], [1, 'Single game']], 'League'],
  ['laterLen', 'Later rounds', [[7, 'Best of 7'], [5, 'Best of 5'], [3, 'Best of 3'], [1, 'Single game']], 'League'],
  ['lottery', 'Draft lottery', YN, 'Draft'],
  ['draftAll', 'Draft for all teams', YN, 'Draft'],
  ['draftClasses', 'Draft classes', [['real', 'Real NBA drafts'], ['generated', 'Generated']], 'Draft'],
  ['careers', 'Player careers', [['real', 'Real'], ['mostly', 'Mostly real'], ['random', 'Random']], 'Players'],
  ['histTendency', 'Random-mode real tendency', [[0, 'Off (random)'], [0.35, 'Light'], [0.5, 'Medium'], [0.7, 'Strong']], 'Draft'],
  ['realHistory', 'Real-history rules', YN, 'League'],
];
