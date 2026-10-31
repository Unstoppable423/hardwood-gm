// Inline SVG icons (original, simple strokes) so nothing depends on phone fonts having a glyph.
const S = (d, o = {}) => `<svg class="ico${o.cls ? ' ' + o.cls : ''}" viewBox="0 0 24 24" width="${o.s || 22}" height="${o.s || 22}" aria-hidden="true" fill="${o.fill || 'none'}" stroke="currentColor" stroke-width="${o.w || 2}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const P = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  jersey: '<path d="M8 3c0 2 1.8 3 4 3s4-1 4-3l3 1v5l-2 1v10H7V10L5 9V4z"/>',
  trade: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  tie: '<path d="M10 3h4l-1 3 2 11-3 4-3-4 2-11z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  eject: '<path d="M12 5l7 9H5z"/><path d="M5 19h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8 3l4 7 4-7"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>',
};
export const icon = (name, o = {}) => S(P[name] || '', o);
// medical cross for injuries (filled)
export const injIcon = () => `<svg class="ico inj-ico" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>`;
const STAR = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z';
// one star: kind = 'full' | 'half' | 'empty'. Half = outline star with the left half filled (clip, unique-id free).
export function starSvg(kind, size = 16) {
  const out = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${STAR}" fill="${kind === 'full' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  if (kind !== 'half') return `<span class="st">${out}</span>`;
  return `<span class="st">${out}<span class="st-half"><svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${STAR}" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span></span>`;
}
// n2 = half-stars 0..10
export function starRow(n2, size = 16) {
  const f = Math.floor(n2 / 2), h = n2 % 2, e = 5 - f - h;
  return `<span class="stars" role="img" aria-label="${n2 / 2} of 5 stars">${starSvg('full', size).repeat(f)}${h ? starSvg('half', size) : ''}${starSvg('empty', size).repeat(e)}</span>`;
}

// v45: current + potential. cur2/pot2 = half-stars 0..10. Solid gold = current, faded gold = potential, outline = beyond.
export function starRow2(cur2, pot2, size = 16) {
  pot2 = Math.max(cur2, pot2); const solid = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${STAR}" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const outline = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${STAR}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  let h = ''; for (let i = 0; i < 5; i++) { const c = Math.max(0, Math.min(2, cur2 - 2 * i)), q = Math.max(0, Math.min(2, pot2 - 2 * i));
    h += `<span class="st">${outline}${q ? `<span class="st-pot${q === 1 ? ' h' : ''}">${solid}</span>` : ''}${c ? `<span class="st-half${c === 2 ? ' f' : ''}">${solid}</span>` : ''}</span>`; }
  return `<span class="stars" role="img" aria-label="${cur2 / 2} of 5 stars now, potential ${pot2 / 2}">${h}</span>`;
}
