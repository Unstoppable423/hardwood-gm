// Player morale (0-100, 50 neutral) and trade requests — franchise setting `morale`.
// Weekly: morale drifts toward a target from playing time vs. role, team success (weighted by ambition) and personality.
// Below 25 for a user player -> a trade request (inbox). Morale feeds contract interest (moodToward).
import { clamp } from './rng.js';
import { teamPlayers, msg, news, standings } from './league.js';

export const moraleOn = (L) => L.settings?.morale !== false;
export function moraleWord(m) { return m >= 75 ? 'Thrilled' : m >= 60 ? 'Happy' : m >= 40 ? 'Content' : m >= 25 ? 'Unhappy' : 'Furious'; }
export function moraleTick(L) {
  if (!moraleOn(L)) return;
  const rec = Object.fromEntries(standings(L).map(r => [r.tid, r.pct]));
  for (const t of L.teams) if (!t.inactive) {
    if (t.inactive) continue;
    const ps = teamPlayers(L, t.tid).sort((a, b) => b.ovr - a.ovr); const wp = rec[t.tid] ?? 0.5;
    ps.forEach((p, i) => {
      if (p.mood == null) p.mood = 50;
      const g = p.stats.reg.gp || 0, mpg = g ? p.stats.reg.min / g : 0;
      const expect = i < 5 ? 30 : i < 9 ? 20 : 8;
      let target = 55 + clamp((mpg - expect) * 1.2, -25, 10) * (g >= 5 ? 1 : 0) + (wp - 0.5) * 50 * ((p.traits?.ambition ?? 50) / 100);
      if (p.traits?.personality === 'Diva') target -= 6; if (p.traits?.personality === 'Team Player' || p.traits?.personality === 'Loyal') target += 6;
      if (p.injury) target = p.mood; // no new information while hurt
      p.mood = Math.round(clamp(p.mood + (target - p.mood) * 0.25, 0, 100));
      if (t.tid === L.userTid && p.mood < 25 && p.tradeReq !== L.season && !p.locked) {
        p.tradeReq = L.season;
        msg(L, p.name, 'Trade request', `${p.name} is unhappy (${mpg.toFixed(1)} min/g, team ${Math.round(wp * 100)}% wins) and has asked to be traded. Morale affects his interest in re-signing.`, { pri: 'high' });
        news(L, `${p.name} requests a trade from the ${t.name}.`, 'transaction', t.tid);
      }
      if (p.tradeReq === L.season && p.mood >= 45) p.tradeReq = null; // happy again: request withdrawn
    });
  }
}
