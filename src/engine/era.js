// Era rules for the "Real NBA history" setting: how the game itself changed from 1996-97 on.
// Values are relative multipliers on the 1996-97 calibration. The 3PA and pace trends are rounded,
// approximate league-wide averages (public knowledge, see NOTES.md); no third-party stat tables are copied.
// Season = the year a season ends (1997 = 1996-97).
// 1979-80 .. 1995-96: the 3-point line's first seasons (public league averages, rounded); 1994-97 = short line
const T3 = { 1980: 2.8, 1981: 2.2, 1982: 2.6, 1983: 2.5, 1984: 2.4, 1985: 3.1, 1986: 3.3, 1987: 5.0, 1988: 5.6, 1989: 6.6, 1990: 7.1, 1991: 7.6, 1992: 8.6, 1993: 9.9, 1994: 11.3, 1995: 15.3, 1996: 16.0, 1997: 18.1, 1998: 12.7, 1999: 13.2, 2000: 13.7, 2001: 13.7, 2002: 14.7, 2003: 14.7, 2004: 14.9, 2005: 15.8, 2006: 16.0,
  2007: 16.9, 2008: 18.1, 2009: 18.1, 2010: 18.1, 2011: 18.0, 2012: 18.4, 2013: 20.0, 2014: 21.5, 2015: 22.4, 2016: 24.1, 2017: 27.0,
  2018: 29.0, 2019: 32.0, 2020: 34.1, 2021: 34.6, 2022: 35.2, 2023: 34.2, 2024: 35.1, 2025: 37.6 };
// game speed by era, tuned so sim scoring tracks the real league's points per game (public season averages, rounded):
// ~68 in 1946-47, ~80 before the 24-second clock (1954-55), ~115 around 1960, ~110 in the 1980s, ~96 by 1996-97
const PACE = { 1947: 66, 1949: 72, 1950: 76, 1952: 78, 1954: 80, 1955: 90, 1957: 98, 1958: 104, 1960: 112, 1962: 114, 1965: 106, 1968: 108, 1970: 106, 1973: 102, 1975: 100, 1978: 102, 1980: 102, 1983: 103, 1985: 104, 1988: 102, 1990: 100, 1992: 97, 1994: 94, 1996: 92, 1997: 90.1, 1998: 90.3, 1999: 88.9, 2000: 93.1, 2001: 91.3, 2002: 90.7, 2003: 91.0, 2004: 90.1, 2005: 92.0, 2006: 90.5,
  2007: 91.9, 2008: 92.4, 2009: 91.7, 2010: 92.7, 2011: 92.1, 2012: 91.3, 2013: 92.0, 2014: 93.9, 2015: 93.9, 2016: 95.8, 2017: 96.4,
  2018: 97.3, 2019: 100.0, 2020: 100.3, 2021: 99.2, 2022: 98.2, 2023: 99.2, 2024: 98.5, 2025: 99.6 };
// shortened seasons: games per team and the opening day offset from Nov 1
export const SHORT_SEASONS = { 1999: { games: 50, offset: 96, why: 'lockout' }, 2012: { games: 66, offset: 54, why: 'lockout' }, 2021: { games: 72, offset: 51, why: 'pandemic' } };
const tab = (T, s) => { const ks = Object.keys(T).map(Number); const lo = ks.filter(k => k <= s); return T[lo.length ? Math.max(...lo) : Math.min(...ks)]; };
import { seasonGamesAt } from './timeline.js';
const BASE = { three: 0.21, pace: 1.1, tp: 0, hand: 1, drawFoul: 0, zone: true, paint: 1, games: 82, offset: 0, on: false };
export function eraFor(season, on = true) {
  if (!on) return { ...BASE, season };
  const s = season, short = SHORT_SEASONS[s];
  return { season, on: true,
    // 3-point attempt tendency follows the league trend; damped a little because sim shooters do not improve with the era
    // no 3-point line before 1979-80 (the NBA adopted it that season; the ABA had it from 1967)
    three: s < 1980 ? 0 : +(0.21 * Math.pow(tab(T3, s) / 18.1, 0.85)).toFixed(4),
    noThree: s < 1980, shotClock: s >= 1955,
    pace: +(1.1 * tab(PACE, s) / 90.1).toFixed(4),
    // 1994-97 short line (22 ft all around) -> back to 23'9" in 1997-98: lower 3P%
    tp: s >= 1998 || s < 1995 ? -0.012 : 0,
    // 2004-05 hand-check ban: perimeter defenders lose some of their effect, drives draw more fouls
    hand: s >= 2005 ? 0.78 : 1, drawFoul: s >= 2005 ? 0.02 : 0,
    // illegal-defense rules until 2001-02: no true zones; packing the paint was limited
    zone: s >= 2002, paint: s >= 2002 ? 1 : 0.6,
    games: short?.games || (s < 1968 ? seasonGamesAt(s) : 82), offset: short?.offset || 0 };
}
export const ERA = { ...BASE, season: 1997 };
export function syncEra(L) {
  const on = L.settings?.realHistory !== false; if (ERA.season === L.season && ERA.on === on) return ERA;
  return Object.assign(ERA, eraFor(L.season, on));
}
export const gpReq = (L, n) => Math.round(n * (L.seasonGames || 82) / 82);
