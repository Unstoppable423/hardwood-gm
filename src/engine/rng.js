// Seeded RNG (mulberry32). State lives in league.rng so saves are reproducible.
let S = 123456789;
export function setSeed(s) { S = s >>> 0; }
export function getSeed() { return S >>> 0; }
export function rand() {
  S = (S + 0x6D2B79F5) >>> 0;
  let t = S;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(rand() * arr.length)];
export function normal(mu = 0, sd = 1) {
  const u = Math.max(1e-9, rand()), v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function weighted(items, wfn) {
  let tot = 0; const ws = items.map(x => { const w = Math.max(0, wfn(x)); tot += w; return w; });
  if (tot <= 0) return items[Math.floor(rand() * items.length)];
  let r = rand() * tot;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
