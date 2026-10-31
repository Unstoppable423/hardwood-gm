// Hardwood GM UI — PGM2-style page flow (hamburger drawer, teal header, page stack, green CTAs)
import * as E from '../engine/index.js';
import { icon, injIcon, starRow, starSvg } from './icons.js';
import { saveSlot, loadSlot, listSlots, deleteSlot, exportJSON } from './storage.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { L: null, slot: null, view: 'title', page: { n: 'home' }, stack: [], tab: {}, modal: null, drawer: false, ng: null, slots: [], trade: null, live: null,
  lotteryReveal: 0, draftTab: 'avail', draftPos: 'All', shortOnly: false, faPos: 'All', statPos: 'All', statExp: 0, apQ: '', apPos: 'All', hofMine: false };
let DATA = null;
window.__S = S; window.__E = E; window.__avatar = (...a) => avatar(...a); window.__go = (...a) => go(...a);

// ---------- utils ----------
const M = (k) => E.fmtMoney(k);
const T = (tid) => (S.L || S.preL).teams[tid];
// Ratings: internal values drive the sim; players see the 40-99 display scale (E.dispRating). Bands are in display terms.
const R = (v) => E.dispRating(v);
const qcD = (d) => d >= 90 ? 'q5' : d >= 82 ? 'q4' : d >= 78 ? 'q3' : 'q1';
const qc = (v) => qcD(R(v));
const sq = (v, cls = '') => v == null || v === '?' ? `<span class="sq qx ${cls}">?</span>` : `<span class="sq ${qc(v)} ${cls}">${R(v)}</span>`;
// staff ratings are not player ratings: keep their own 0-100 scale and bands
const qcRaw = (v) => v >= 85 ? 'q5' : v >= 70 ? 'q4' : v >= 65 ? 'q3' : 'q1';
const sqRaw = (v, cls = '') => v == null ? `<span class="sq qx ${cls}">?</span>` : `<span class="sq ${qcRaw(v)} ${cls}">${v}</span>`;
const DEVW = { Super: 'SUPER', Quick: 'QUICK', Normal: 'NORMAL', Slow: 'SLOW', Peaked: 'PEAK', 'Slow Decline': 'DECLINE', Decline: 'DECLINE', 'Fast Decline': 'FAST DECLINE' };
const devVisible = (p) => { const v = S.L.settings.devVisibility; return !(v === 'Hidden' || (v === 'Own' && p.tid !== S.L.userTid)); };
const devWord = (p) => devVisible(p) ? DEVW[E.devTrait(p)] || '' : '';
const scoutAcc = () => E.staffEffects(S.L, S.L.userTid).scout;
const potOf = (p) => p.tid === S.L.userTid && p.age >= 25 ? p.pot : E.scoutedPot(p, scoutAcc());
const hideR = (p) => p.tid === -2 && (S.L.settings.hideRookieRatings || p.draft?.year > S.L.season);
const stars = (pot) => { const n2 = Math.max(1, Math.min(10, Math.round((pot - 45) / 4.5))); return starRow(n2); };
const pg = (s, k) => s.gp ? (s[k] / s.gp).toFixed(1) : '0.0';
const rebOf = (s) => s.orb + s.drb;
const ht = (cm) => { const t = Math.round(cm / 2.54); return `${Math.floor(t / 12)}' ${t % 12}"`; };
const yrsPro = (p) => p.draft?.year ? Math.max(0, S.L.season - p.draft.year - 1) : (p.prior?.yrs || 0) + p.career.length;
const yrsLeft = (p) => p.contract ? p.contract.exp - S.L.season + 1 - (['AWARDS', 'STAFF', 'LOTTERY', 'DRAFT'].includes(S.L.phase) ? 1 : 0) : 0;
const seasonLbl = (s) => `${s - 1}-${String(s).slice(2)}`;
const POSN = { PG: 'Point Guards', SG: 'Shooting Guards', SF: 'Small Forwards', PF: 'Power Forwards', C: 'Centers' };
function toast(t, ms = 2400) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), ms); }
function overlay(t) { let o = $('.overlay'); if (!t) { o?.remove(); return; } if (!o) { o = document.createElement('div'); o.className = 'overlay'; document.body.appendChild(o); } o.innerHTML = `<div style="color:#e8772e">${icon('ball', { s: 40 })}</div><div>${esc(t)}</div>`; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let saveTimer = null;
function autosave() { if (!S.L || !S.slot) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSlot(S.slot, S.L).catch(e => toast('Save failed: ' + e.message)), 400); }

// ---------- original art: team disc + procedural player avatar ----------
function disc(tid, size = 40) {
  if (tid == null || tid < 0) return `<span class="disc" style="width:${size}px;height:${size}px;background:#8a95a3;font-size:${size * 0.3}px">${tid === -1 ? 'FA' : tid === -2 ? 'NCAA' : '—'}</span>`;
  const t = T(tid); return `<span class="disc" style="width:${size}px;height:${size}px;background:${t.c1};box-shadow:inset 0 0 0 ${Math.max(2, size / 14)}px ${t.c2};font-size:${size * (t.abbr.length > 3 ? .26 : .3)}px">${t.abbr}</span>`;
}
function hsh(n) { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x ^ (x >>> 16)) >>> 0; }
// Jersey "portrait": a tank-top drawn in the team's colors with the player's number (no logos, no names).
const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
function jerseyColors(p) {
  const tid = p.tid >= 0 ? p.tid : null;
  if (tid == null) return { body: '#8a96a3', trim: '#e9edf1', num: '#ffffff', edge: '#5f6b77' }; // free agent / prospect / retired
  const t = T(tid); let body = t.c1, trim = t.c2;
  let num = contrast(body, trim) >= 2.2 ? trim : lum(body) > 0.35 ? '#111111' : '#ffffff';
  const edge = lum(num) > 0.5 ? shade(body, -0.45) : (lum(body) < 0.08 ? '#ffffff' : shade(body, 0.55));
  if (contrast(body, trim) < 1.6) trim = lum(body) > 0.35 ? '#111111' : '#ffffff';
  return { body, trim, num, edge };
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function avatar(p, size = 48) {
  const { body, trim, num, edge } = jerseyColors(p); const n = p.tid >= 0 || p.tid === -1 ? (p.num ?? '') : '';
  const fs = String(n).length >= 2 ? 23 : 27, small = size < 44;
  return `<svg class="jsy" width="${size}" height="${size}" viewBox="0 0 64 64" style="flex:none;border-radius:${small ? 10 : 14}px;background:${small ? '#e6ebf0' : '#e9eef3'}" role="img" aria-label="${n !== '' ? '#' + n : 'jersey'}">
  <path d="M19 6h7.5q6 11 12 0H46q0 13 9 17v35.5q0 2-2 2H11q-2 0-2-2V23q9-4 9-17z" fill="${body}"/>
  <path d="M26.5 6q6 11 12 0" fill="none" stroke="${trim}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M19 6q0 13-10 17M46 6q0 13 9 17" fill="none" stroke="${trim}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M11.5 56h41" stroke="${trim}" stroke-width="${small ? 0 : 1.6}" opacity=".9"/>
  ${n !== '' ? `<text x="32.5" y="${small ? 46 : 45.5}" text-anchor="middle" font-family="'Arial Black','Helvetica Neue',Arial,sans-serif" font-weight="900" font-size="${fs}" letter-spacing="-1" fill="${num}" stroke="${edge}" stroke-width="${small ? 1.6 : 1.3}" paint-order="stroke" stroke-linejoin="round">${esc(String(n))}</text>` : ''}</svg>`;
}
function ring(label, v0) {
  const v = R(v0); const r = 30, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, (v - 40) / 59));
  const col = v >= 90 ? 'var(--q5)' : v >= 84 ? 'var(--q4)' : v >= 78 ? 'var(--gold)' : 'var(--q1)';
  return `<div class="ring"><svg viewBox="0 0 74 74"><circle cx="37" cy="37" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/><circle cx="37" cy="37" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 37 37)" stroke-linecap="round"/>
  <text x="37" y="31" text-anchor="middle" font-size="10" fill="var(--sub)">${label}</text><text x="37" y="49" text-anchor="middle" font-size="20" font-weight="700" fill="var(--ink)">${v}</text></svg></div>`;
}
function teamRatings(L, tid) {
  const ps = E.teamPlayers(L, tid).filter(p => !p.injury); const rot = E.autoRotation(ps); let o = 0, d = 0, w = 0;
  for (const p of ps) { const m = rot.minutes[p.pid] || 0; if (!m) continue; const r = p.ratings;
    o += m * (r.ins * .2 + r.out * .22 + r.pas * .14 + r.han * .12 + r.sco * .2 + r.iq * .12); d += m * (r.idef * .3 + r.pdef * .3 + r.reb * .2 + r.ath * .1 + r.iq * .1); w += m; }
  const sc = (x) => Math.round(Math.max(40, Math.min(99, 50 + (x / w - 55) * 1.35)));
  return { off: w ? sc(o) : 50, def: w ? sc(d) : 50, ovr: E.teamOvr(L, tid) };
}

// ---------- boot / data ----------
async function boot() {
  try { S.slots = await listSlots(); } catch { S.slots = [null, null, null]; }
  if (localStorage.getItem('hgm-dark') === '1') document.documentElement.classList.add('dark');
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
async function loadData() {
  if (DATA) return DATA;
  const [start, classes, history, contracts] = await Promise.all([fetch('data/start1996.json').then(r => r.json()), fetch('data/draftclasses.json').then(r => r.json()), fetch('data/history.json').then(r => r.json()).catch(() => null), fetch('data/contracts1996.json').then(r => r.json()).catch(() => null)]);
  DATA = { start, classes, history, contracts }; return DATA;
}
function attach(L) {
  L.dcGlobal = dcGlobal();
  E.repairSave(L); E.setSeed(L.rng || L.seed); S.L = L;
  if (!L.data && DATA) L.data = { classes: DATA.classes.classes || {}, udfa: DATA.classes.udfa || {} };
  E.ensureSettings(L);
  L.gm.reputation ??= 40; L.gm.teams ||= [L.userTid]; L.achievements ||= {}; L.tradeBlock ||= []; L.tradeOffers ||= []; L.shortlist ||= [];
  if (!L.players.some(p => p.tid === -2 && p.draft?.year > L.season)) E.ensureWorld(L);
  E.ensureFAPool(L); // old saves: never an empty free-agent list
}

// ---------- render ----------
function render() {
  const app = $('#app'); if (S.L) E.ensureNumbers(S.L);
  if (S.view === 'title') app.innerHTML = titleView();
  else if (S.view === 'slots') app.innerHTML = slotsView();
  else if (S.view === 'setup') app.innerHTML = setupView();
  else if (S.view === 'pickteam') app.innerHTML = pickTeamView();
  else if (S.view === 'preview') app.innerHTML = previewView();
  else app.innerHTML = shellView();
  renderDrawer(); renderModal(); fitCta();
}
// keep the last row of every page clear of the fixed bottom action bar (its height varies with button count / safe area)
function fitCta() { const app = $('#app'), c = app?.querySelector('.cta'); const h = (c ? Math.ceil(c.getBoundingClientRect().height) : 0) + 'px'; app?.style.setProperty('--ctaH', h); document.documentElement.style.setProperty('--ctaH', h); }
window.addEventListener('resize', () => fitCta());
// Safari/in-app browsers: when a toolbar overlays the bottom of the layout viewport, lift the bar above it and pad the page by the same amount
function fitVV() { const vv = window.visualViewport; const gap = vv && Math.abs((vv.scale || 1) - 1) < 0.01 ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0; document.documentElement.style.setProperty('--vvGap', (gap < 200 ? gap : 0) + 'px'); }
window.visualViewport?.addEventListener('resize', fitVV); window.visualViewport?.addEventListener('scroll', fitVV); fitVV();
const modalKey = () => `${S.modal?.type}:${S.modal?.pid ?? ''}:${S.modal?.kind ?? ''}`;
function renderModal() {
  let m = $('#modal'); if (!S.modal) { m?.remove(); return; }
  if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; document.body.appendChild(m); }
  const sc = m.querySelector('.sheet')?.scrollTop || 0;
  m.innerHTML = `<div class="sheet">${modalView()}</div>`;
  if (S.modal.keepScroll || m.dataset.key === modalKey()) m.querySelector('.sheet').scrollTop = sc; // re-render of the same sheet keeps its scroll
  m.dataset.key = modalKey();
}
function hdr(title, right = '', backable = S.stack.length > 0) {
  const unread = S.L ? S.L.inbox.filter(m => !m.read).length : 0;
  return `<div class="hdr">${backable ? `<button class="lb" data-a="back" aria-label="Back">${icon('back')}</button>` : `<button class="lb" data-a="drawer" aria-label="Menu">${icon('menu')}${unread ? `<span class="bdg">${unread}</span>` : ''}</button>`}<div class="ttl">${title}</div>${right || '<span></span>'}</div>`;
}
function tabs(group, items, def) {
  const cur = S.tab[group] ?? def ?? items[0][0];
  return `<div class="tabs">${items.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-a="tab" data-g="${group}" data-k="${k}">${l}</button>`).join('')}</div>`;
}
const curTab = (g, d) => S.tab[g] ?? d;
function pillSeg(stateKey, items) { return `<div class="pill-seg">${items.map(([k, l]) => `<button class="${S[stateKey] === k ? 'on' : ''}" data-a="setS" data-k="${stateKey}" data-v="${k}">${l}</button>`).join('')}</div>`; }

// ---------- title / slots / setup ----------
function titleView() {
  return `<div class="title"><div class="logo">HARDWOOD<br><span>GM</span></div>
  <div style="opacity:.85;margin:10px 0 34px;letter-spacing:.5px">Basketball front office · 1996-97 and beyond</div>
  <button class="go" data-a="toSlots" data-mode="new">New Game</button>
  <button class="blue" style="background:#ffffff22" data-a="toSlots" data-mode="load">Continue / Load</button>
  <button class="ghost" style="color:#fff;border-color:#ffffff55" data-a="importPick">Import Save (.json)</button>
  <input type="file" id="importFile" accept=".json,application/json" style="display:none">
  <div style="color:#cfe3ea;margin-top:28px;font-size:11px;line-height:1.5">Unofficial fan project — not affiliated with the NBA, NBPA or any app maker. Player bios/box-score facts: Kaggle "NBA Players" dataset (J. Cirtautas, NBA Stats API). Ratings are this game's own estimates. Team names are text only; no logos.</div></div>`;
}
function slotsView() {
  const mode = S.slotMode;
  return hdr(mode === 'new' ? 'New Game' : 'Load Game', `<button class="rb" data-a="toTitle" aria-label="Close">${icon('close')}</button>`, false).replace('data-a="drawer"', 'data-a="toTitle"') + `<div class="wrap"><div class="sect">Save slots</div><div class="list">
  ${[1, 2, 3].map(i => { const m = S.slots[i - 1]; return `<div class="it">${m ? `<span class="disc" style="width:42px;height:42px;background:${m.c1};font-size:12px">${m.abbr}</span>` : `<span class="disc" style="width:42px;height:42px;background:#b8c1ca">${i}</span>`}
    <div class="grow"><div class="nm">Slot ${i} ${m ? `· ${esc(m.team)}` : '· Empty'}</div><div class="meta">${m ? `${seasonLbl(m.season)} · ${E.PHASE_LABEL[m.phase]} · GM ${esc(m.gm || '')}` : 'No save'}</div></div>
    ${mode === 'new' ? `<button class="go sm" data-a="newInSlot" data-slot="${i}">${m ? 'Overwrite' : 'Start'}</button>` : m ? `<button class="blue sm" data-a="loadSlot" data-slot="${i}">Load</button>` : ''}
    ${m ? `<button class="sm ghost" data-a="delSlot" data-slot="${i}" aria-label="Delete">${icon('trash', { s: 18 })}</button>` : ''}</div>`; }).join('')}</div>
  <div class="muted" style="padding:0 14px">Three independent saves live on this device. Settings → Export makes a backup file you can import on another phone.</div></div>`;
}
const DEF_NG = () => ({ gmName: '', archetype: 'Scout', difficulty: 'Medium', draftClasses: 'real', histTendency: 0.5, injuries: 1, scoutAccuracy: 'Normal', devVisibility: 'All', hideRookieRatings: false, playerCap: true, staffCap: false, cpuTrades: true, custom: false, start: 'PRESEASON', rosters: 'real', startYear: 1997 });
function opt(name, val, opts, label) { return `<div style="margin:6px 0"><div class="muted">${label}</div><select data-ng="${name}">${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`; }
function setupView() {
  const n = S.ng;
  return `<div class="hdr"><button class="lb" data-a="toSlots" data-mode="new">${icon('back')}</button><div class="ttl">Create GM</div><span></span></div><div class="wrap">
  <div class="card"><h3>General Manager</h3><div class="muted">Your name</div><input data-ng="gmName" value="${esc(n.gmName)}" placeholder="Mitchell">
  ${opt('archetype', n.archetype, Object.keys(E.ARCHETYPES).map(k => [k, k]), 'GM style (locked for this save)')}<div class="muted">${esc(E.ARCHETYPES[n.archetype])}</div></div>
  <div class="card"><h3>League</h3>${(() => { const y = +n.startYear || 1997; const nt = y < 1997 ? E.teamsAt(y).length : 29;
    const yrs = []; for (let k = 1997; k >= E.HIST_MIN; k--) yrs.push([k, k === 1997 ? '1996-97 (full data)' : seasonLbl(k) + (k <= 1949 ? ' · BAA' : '')]);
    return `<div class="kv"><span>Season</span><b>${seasonLbl(y)} · ${nt} teams</b></div>${opt('startYear', y, yrs, 'Start year')}
    ${y < 1997 ? `<div class="muted small" id="eraNote">Real ${seasonLbl(y)} rosters from Wikipedia player articles. ${y < 1980 ? 'No 3-point line until 1979-80. ' : ''}${y < 1955 ? 'No shot clock until 1954-55. ' : ''}${y < 1985 ? 'No salary cap until 1984-85. ' : ''}Rosters of ${E.rosterMaxAt(y)}. Every real expansion, relocation, fold and the 1976 ABA merger happen in their real years. ${y < 1965 ? 'Early data is thin: many ratings are estimated from honors, minutes and team records, and short rosters get generated fill-ins.' : 'Some ratings are estimated where a player has no stats table.'}</div>` : ''}`; })()}
  ${(+n.startYear || 1997) < 1997 ? '' : opt('start', n.start, [['PRESEASON', 'Preseason — rosters as they opened 1996-97'], ['FA', 'Free agency — summer of 1996 (Shaq, Mourning, Payton, Howard on the market)'], ['DRAFT', 'Draft — 1996 draft night (Iverson, Kobe, Nash, Ray Allen…)']], 'Start point')}
  ${(+n.startYear || 1997) < 1997 ? '' : opt('rosters', n.rosters || 'real', [['real', 'Real 1996-97 rosters'], ['random', 'Random: real players dealt to teams by a snake draft'], ['file', 'Roster file (imported .json)']], 'Rosters')}${n.rosters === 'file' ? `<div class="card" style="margin:6px 14px"><div class="row sp"><span>${n.rosterFile ? `<b>${esc(n.rosterName || 'roster file')}</b> · ${n.rosterFile.players.length} players` : 'No file chosen. Export one from Settings in any league, edit it, then load it here.'}</span><button class="sm" data-a="rosterPick">${n.rosterFile ? 'Change' : 'Choose file'}</button></div>${n.rosterFile ? '<button class="sm ghost" data-a="rosterClear" style="margin-top:6px">Use real rosters</button>' : ''}</div><input type="file" id="rosterFile" accept=".json,application/json" style="display:none">` : ''}${n.rosters === 'random' && n.start !== 'PRESEASON' ? '<div class="muted small" style="padding:0 14px">Random rosters apply to the 1996-97 training camp start.</div>' : ''}
  ${opt('draftClasses', n.draftClasses, [['real', (+n.startYear || 1997) < 1997 ? 'Real drafts (NBA players) + 2027 mock' : 'Real NBA drafts (1997–2026) + 2027 mock, then generated'], ['generated', 'Generated prospects only']], 'Draft classes')}
  ${opt('histTendency', n.histTendency, [[0, 'Off — careers fully random'], [0.35, 'Light — mostly random'], [0.5, 'Medium — real stars usually emerge (default)'], [0.7, 'Strong — close to real careers']], 'Real-career tendency for drafted rookies')}</div>
  <div class="card"><h3>Difficulty</h3><div class="pill-seg" style="margin:0 0 8px">${['Easy', 'Medium', 'Hard', 'Custom'].map(d => `<button class="${(n.custom ? 'Custom' : n.difficulty) === d ? 'on' : ''}" data-a="ngDiff" data-d="${d}">${d}</button>`).join('')}</div>
  ${n.custom ? `<div class="grid2">
   <div>${opt('difficulty', n.difficulty, [['Easy', 'Easy'], ['Medium', 'Medium'], ['Hard', 'Hard']], 'Base (trades / owner)')}</div>
   <div>${opt('injuries', n.injuries, [[0, 'Off'], [0.5, 'Low'], [1, 'Normal'], [1.6, 'High']], 'Injury frequency')}</div>
   <div>${opt('scoutAccuracy', n.scoutAccuracy, [['Low', 'Low'], ['Normal', 'Normal'], ['High', 'High']], 'Scout accuracy')}</div>
   <div>${opt('devVisibility', n.devVisibility, [['All', 'Show all'], ['Own', 'Own team only'], ['Hidden', 'Hide all']], 'Development visibility')}</div>
   <div>${opt('hideRookieRatings', n.hideRookieRatings, [[false, 'Visible'], [true, 'Hidden until drafted']], 'Rookie ratings')}</div>
   <div>${opt('staffCap', n.staffCap, [[false, 'Off'], [true, 'On']], 'Staff budget')}</div>
</div>` : `<div class="muted">${n.difficulty === 'Easy' ? 'Generous trades, patient owner, fewer injuries.' : n.difficulty === 'Hard' ? 'Tough trade partners, impatient owner, pricier free agents.' : 'Balanced.'}</div>`}</div>
  </div><div class="card"><h3>Franchise settings</h3><div class="muted">Salary cap, trades, injuries, roster limits, season length, playoff format, lottery and more. Also changeable later in Settings.</div><button style="width:100%;margin-top:8px" data-a="ngFs">${n.showFs ? 'Hide' : 'Customize'}</button></div>${n.showFs ? fsGroups({ ...n.franchise, draftClasses: n.draftClasses }, 'data-ngf') : ''}
  </div><div class="cta"><button class="go" data-a="toPickTeam">Choose Team</button></div>`;
}
function pickTeamView() {
  const L = S.preL;
  const ts = L.teams.map(t => ({ t, o: E.teamOvr(L, t.tid) })).sort((a, b) => a.t.city.localeCompare(b.t.city));
  return `<div class="hdr"><button class="lb" data-a="toSetup">${icon('back')}</button><div class="ttl">Select Team</div><span></span></div><div class="wrap">
  <div class="muted" style="padding:0 14px 8px">Fall ${L.season - 1}: ${L.teams.length} teams. Tap a team to preview its roster.</div>
  <div class="tgrid">${ts.map(({ t, o }) => `<button class="tcard" style="background:linear-gradient(135deg,${t.c1},${t.c2})" data-a="previewTeam" data-tid="${t.tid}"><div class="c">${esc(t.city)}</div><div class="n">${esc(t.name)}</div><div class="c">${t.conf === 'E' ? 'East' : 'West'} · ${t.div}</div><span class="o">${R(o)}</span></button>`).join('')}</div></div>`;
}
function previewView() {
  const L = S.preL, tid = S.previewTid, t = L.teams[tid];
  const ps = E.teamPlayers(L, tid).sort((a, b) => b.ovr - a.ovr); const tr = teamRatings(L, tid);
  return `<div class="hdr"><button class="lb" data-a="toPickTeam">${icon('back')}</button><div class="ttl">${esc(t.name)}</div><span></span></div>
  <div class="thead">${disc(tid, 58)}<div class="rings">${ring('DEF', tr.def)}${ring('OFF', tr.off)}${ring('OVR', tr.ovr)}</div></div>
  <div class="wrap"><div class="sect">Staff</div><div class="list">${['HC', 'AC', 'SC', 'TR'].map(r => `<div class="it"><div class="grow"><div class="nm">${esc(t.staff[r].name)}</div><div class="meta">${E.roleName(r)}</div></div>${sqRaw(t.staff[r].rating)}</div>`).join('')}</div>
  <div class="sect">Roster</div><div class="list">${ps.map(p => `<div class="it">${avatar(p, 36)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">${p.pos} · Age ${p.age} · ${M(p.contract.amt)}</div></div>${sq(p.ovr)}</div>`).join('')}</div></div>
  <div class="cta"><button class="go" data-a="takeOver">Take over the ${esc(t.name)}</button></div>`;
}

// ---------- shell + drawer ----------
const PAGES = {};
function shellView() {
  const pg0 = S.page; const fn = PAGES[pg0.n] || PAGES.home;
  const v = fn(pg0) || {};
  const ctl = S.L && E.isControlling(S.L) ? `<div class="ctlbar" style="background:${T(S.L.userTid).c1}"><span>Controlling <b>${esc(T(S.L.userTid).abbr)}</b></span><button class="sm" data-a="ctlHome">Back to ${esc(T(E.homeTid(S.L)).abbr)}</button></div>` : '';
  return hdr(v.title || '', v.right || '') + ctl + (v.top || '') + `<div class="wrap">${v.body || ''}</div>` + (v.cta ? `<div class="cta">${v.cta}</div>` : '');
}
const MENU = [['home', 'home', 'Home'], ['team', 'jersey', 'My Team'], ['trade', 'trade', 'Trade Center'], ['fa', 'pen', 'Free Agents'], ['draft', 'cap', 'Draft'], ['league', 'trophy', 'League'],
  ['world', 'globe', 'World'], ['gm', 'tie', 'GM'], ['messages', 'mail', 'Messages'], ['settings', 'gear', 'Settings']];
function renderDrawer() {
  let d = $('#drawer'); if (!S.drawer || !S.L) { d?.remove(); return; }
  if (!d) { d = document.createElement('div'); d.id = 'drawer'; d.className = 'drawer'; document.body.appendChild(d); }
  const L = S.L, r = E.standings(L)[L.userTid], unread = L.inbox.filter(m => !m.read).length, offers = (L.tradeOffers || []).length;
  d.innerHTML = `<div class="pane"><div class="who">${disc(L.userTid, 48)}<div><div class="t1">${esc(T(L.userTid).city)} ${esc(T(L.userTid).name)}</div><div class="t2">${r.w}-${r.l} · ${E.PHASE_LABEL[L.phase]} · ${seasonLbl(L.season)}</div><div class="t2">GM ${esc(L.gm.name)}</div></div></div>
  ${MENU.map(([k, ic, lb]) => `<button class="mi ${S.page.n === k ? 'on' : ''}" data-a="nav" data-p="${k}"><span class="ic">${icon(ic)}</span>${lb}${k === 'messages' && unread ? `<span class="n">${unread}</span>` : ''}${k === 'trade' && offers ? `<span class="n">${offers}</span>` : ''}</button>`).join('')}
  <button class="mi" data-a="saveNow"><span class="ic">${icon('save')}</span>Save</button><button class="mi" data-a="quit"><span class="ic">${icon('eject')}</span>Main Menu</button></div><div class="shade" data-a="drawerClose"></div>`;
}

// ---------- HOME ----------
function nextUserGame(L) { return L.schedule.find(x => !x.played && (x.h === L.userTid || x.a === L.userTid)); }
function lastUserGame(L) { const gs = L.schedule.filter(x => x.played && (x.h === L.userTid || x.a === L.userTid)); return gs[gs.length - 1]; }
function matchup(L, h, a, sub) {
  const rec = E.standings(L);
  const side = (tid) => `<div class="center" style="flex:1">${disc(tid, 56)}<div style="font-weight:800;margin-top:6px">${esc(T(tid).name)}</div><div class="muted">${rec[tid].w}-${rec[tid].l} · OVR ${R(E.teamOvr(L, tid))}</div></div>`;
  return `<div class="card"><div class="row">${side(a)}<div class="center"><div class="muted">${sub}</div><div style="font-weight:800;font-size:20px">@</div></div>${side(h)}</div></div>`;
}
PAGES.home = () => {
  const L = S.L; const parts = [];
  const cta = [];
  if (L.gm.fired) { parts.push(`<div class="card"><h3>Fired</h3>Your owner has let you go. Some teams are interested — check the GM page.</div>`); cta.push(`<button class="go" data-a="nav" data-p="gm" data-t="jobs">View job offers</button>`); }
  if (L.phase === 'REGULAR' && E.activeCount(L, L.userTid) < E.ROSTER_MIN) { const n = E.activeCount(L, L.userTid); parts.push(`<div class="card warn" data-a="nav" data-p="fa"><b>Roster below minimum: ${n}/${E.ROSTER_MIN} active.</b> Sign free agents${L.shortSince != null ? ` within ${Math.max(0, 7 - (L.day - L.shortSince))} day(s)` : ''} or the league fills your roster with minimum players. Tap to open Free Agents.</div>`); }
  switch (L.phase) {
    case 'PRESEASON': parts.push(ownerCard(L), rosterCheck(L)); cta.push(`<button class="go" data-a="advance">Start Season</button>`); break;
    case 'REGULAR': {
      if (E.seasonDone(L)) { parts.push(`<div class="card"><h3>Regular season complete</h3>Final standings are in. The playoffs are next.</div>`); cta.push(`<button class="go" data-a="advance">Start Playoffs</button>`); break; }
      const g = nextUserGame(L);
      if (g) parts.push(matchup(L, g.h, g.a, E.dateOf(L, g.day)));
      const lg = lastUserGame(L); if (lg) { const home = lg.h === L.userTid, won = (home ? lg.hs > lg.as : lg.as > lg.hs);
        parts.push(`<div class="list"><div class="it" data-a="box" data-gid="${lg.gid}"><span class="tag" style="background:${won ? 'var(--q4)' : 'var(--q1)'}">${won ? 'W' : 'L'}</span><div class="grow"><div class="nm">Last game: ${home ? 'vs' : '@'} ${esc(T(home ? lg.a : lg.h).name)}</div><div class="meta">${T(lg.a).abbr} ${lg.as} - ${lg.hs} ${T(lg.h).abbr}${lg.ot ? ' OT' : ''} · tap for box score</div></div><span class="chev">${icon('back', { s: 18, cls: 'flip' })}</span></div></div>`); }
      parts.push(ownerCard(L, true), divisionCard(L));
      cta.push(`<button class="blue" data-a="holiday">Go on Holiday</button>`, `<button class="go" data-a="playNext">Play Game</button>`);
      break;
    }
    case 'PLAYOFFS': {
      const P = L.playoffs;
      if (P.champ != null) { parts.push(`<div class="card center"><div class="muted">${seasonLbl(L.season)} Champions</div>${disc(P.champ, 70)}<div class="big">${esc(T(P.champ).city)} ${esc(T(P.champ).name)}</div></div>`); cta.push(`<button class="go" data-a="advance">Season Summary</button>`); break; }
      const mine = P.series.find(s => s.round === P.round && (s.hi === L.userTid || s.lo === L.userTid) && !E.seriesOver(s));
      if (mine) { const gn = mine.wh + mine.wl; parts.push(matchup(L, ([1, 1, 0, 0, 1, 0, 1][gn] ? mine.hi : mine.lo), ([1, 1, 0, 0, 1, 0, 1][gn] ? mine.lo : mine.hi), `Game ${gn + 1}`)); }
      parts.push(`<div class="sect">${['First Round', 'Conference Semifinals', 'Conference Finals', 'Finals'][P.round - 1]}</div>${seriesList(P.series.filter(s => s.round === P.round))}`);
      cta.push(`<button class="blue" data-a="simRound">Sim Round</button>`, `<button class="go" data-a="playNext">${mine ? 'Play Game' : 'Sim Day'}</button>`);
      break;
    }
    case 'AWARDS': parts.push(summaryCard(L)); cta.push(`<button class="go" data-a="advance">Continue to Staff</button>`); break;
    case 'STAFF': parts.push(`<div class="card"><h3>Staff changes</h3>Coaches, scouts and physios can only be changed once a year — now. Expired contracts are vacant.</div>`);
      cta.push(`<button class="blue" data-a="nav" data-p="team" data-t="staff">Manage Staff</button>`, `<button class="go" data-a="advance">Draft Lottery</button>`); break;
    case 'LOTTERY': parts.push(lotteryCard(L)); cta.push(`<button class="go" data-a="advance">Go to Draft Day</button>`); break;
    case 'DRAFT': { const D = L.draft; const done = D.idx >= D.order.length; parts.push(`<div class="card"><h3>Draft day</h3>${done ? 'The draft is complete. Undrafted players are now free agents.' : `Pick ${D.order[D.idx].pick} · ${esc(T(D.order[D.idx].tid).name)} on the clock.`}</div>`);
      cta.push(done ? `<button class="go" data-a="advance">Re-sign Players</button>` : `<button class="go" data-a="nav" data-p="draft">Enter Draft Room</button>`); break; }
    case 'RESIGN': parts.push(resignCard(L)); cta.push(`<button class="go" data-a="advance">Start Free Agency</button>`); break;
    case 'FA1': case 'FA2': case 'FA3': parts.push(faCard(L)); cta.push(`<button class="blue" data-a="nav" data-p="fa">Free Agents</button>`, `<button class="go" data-a="advance">${L.phase === 'FA3' ? 'End Free Agency' : 'Next Week'}</button>`); break;
    case 'SUMMER': parts.push(summerCard(L)); cta.push(`<button class="go" data-a="advance">Preseason</button>`); break;
  }
  const nw = L.news.slice(0, 4);
  parts.push(`<div class="sect">League news</div><div class="list">${nw.map(n => `<div class="it"><div class="grow"><div style="font-size:13px">${esc(n.text)}</div><div class="meta">${seasonLbl(n.season)}${n.day ? ' · ' + E.dateOf(L, n.day) : ''}</div></div></div>`).join('') || '<div class="it muted">Nothing yet.</div>'}<div class="it" data-a="nav" data-p="league" data-t="news"><div class="grow muted">All news</div><span class="chev">${icon('back', { s: 18, cls: 'flip' })}</span></div></div>`);
  return { title: `${T(L.userTid).name}`, right: `<button class="rb" data-a="nav" data-p="messages" aria-label="Messages">${icon('mail')}</button>`, top: phaseStrip(L), body: parts.join(''), cta: cta.join('') };
};
function phaseStrip(L) {
  const r = E.standings(L)[L.userTid];
  return `<div class="caprow" style="padding-top:10px;border-bottom:1px solid var(--line)"><span><b>${seasonLbl(L.season)}</b> · ${E.PHASE_LABEL[L.phase]}</span><span>${L.phase === 'REGULAR' || L.phase === 'PLAYOFFS' ? E.dateOf(L) : ''}</span><span>Record <b>${r.w}-${r.l}</b></span></div>`;
}
function secBar(sec) { return `<div class="bar" style="margin-top:4px"><i style="width:${Math.max(0, sec)}%;background:${sec >= 60 ? 'var(--q4)' : sec >= 30 ? 'var(--gold)' : 'var(--q1)'}"></i></div>`; }
function ownerCard(L, compact) {
  const ex = L.expectation, sec = L.gm.jobSecurity;
  return `<div class="card"><h3>Owner's goal · ${seasonLbl(ex.season)}</h3><div style="font-weight:700;font-size:16px">${esc(ex.goal)}</div><div class="muted">Non-negotiable. Target ≈ ${ex.wins} wins · preseason rank #${ex.rank}</div>
  <div class="meters"><div><div class="kv"><span>Owner · security</span><b>${sec}</b></div>${secBar(sec)}</div>
  <div><div class="kv"><span>Fans · ${E.fanLabel(E.fan(L))}</span><b>${Math.round(E.fan(L))}</b></div>${secBar(E.fan(L))}</div></div>
  ${L.fo?.lastCheck?.season === L.season ? `<div class="muted" style="margin-top:6px">Owner check-in (game ${L.fo.lastCheck.mark}): ${L.fo.lastCheck.w}-${L.fo.lastCheck.l}, on pace for ${L.fo.lastCheck.pace} vs ${L.fo.lastCheck.target} · <b class="${L.fo.lastCheck.delta >= 0 ? 'tg' : 'tr'}">${L.fo.lastCheck.delta >= 0 ? '+' : ''}${L.fo.lastCheck.delta} security</b></div>` : ''}</div>`;
}
function rosterCheck(L) {
  const n = E.teamPlayers(L, L.userTid).length, pr = E.payroll(L, L.userTid), c = E.cap(L);
  return `<div class="card"><h3>Roster check</h3><div class="kv"><span>Players</span><b class="${n > E.ROSTER_MAX || n < E.ROSTER_MIN ? 'tr' : 'tg'}">${n} (${E.ROSTER_MIN}–${E.ROSTER_MAX})</b></div><div class="kv"><span>Payroll</span><b>${M(pr)}</b></div><div class="kv"><span>Cap room</span><b class="${pr <= c ? 'tg' : 'tr'}">${pr <= c ? M(c - pr) : '−' + M(pr - c)}</b></div>
  ${n > E.ROSTER_MAX ? `<button class="red" style="width:100%;margin-top:8px" data-a="autoCut">Let the coaches cut to ${E.ROSTER_MAX}</button>` : ''}${n < E.ROSTER_MIN ? `<button class="blue" style="width:100%;margin-top:8px" data-a="nav" data-p="fa">Sign free agents</button>` : ''}
  <div class="grid2" style="margin-top:8px"><button data-a="nav" data-p="reorder">Reorder rotation</button><button data-a="nav" data-p="team" data-t="staff">Staff</button></div></div>`;
}
function divisionCard(L) {
  const rec = E.standings(L); const d = T(L.userTid).div;
  const ts = rec.filter(r => T(r.tid).div === d).sort((a, b) => b.pct - a.pct);
  return `<div class="sect">${d} Division</div><div class="tscroll"><table><tr><th class="l">Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>STRK</th></tr>${ts.map(r => `<tr class="${r.tid === L.userTid ? 'hl' : ''}" data-a="teamPage" data-tid="${r.tid}"><td class="l">${esc(T(r.tid).name)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.pct.toFixed(3).replace(/^0/, '')}</td><td>${(((ts[0].w - r.w) + (r.l - ts[0].l)) / 2 || '-')}</td><td>${r.streak}</td></tr>`).join('')}</table></div>`;
}
function summaryCard(L) {
  const h = L.history.at(-1); const rv = L.lastReview; const a = h.awards;
  const aw = (k, lbl) => a[k] ? `<div class="kv"><span>${lbl}</span><b data-a="player" data-pid="${a[k].pid}">${esc(a[k].name)} <span class="muted">${a[k].abbr}</span></b></div>` : '';
  const ret = (L.retiring || []).map(id => E.getP(L, id)).filter(p => p.tid === L.userTid);
  const gcol = rv.grade <= 'B' ? 'var(--q4)' : rv.grade === 'C' ? 'var(--gold)' : 'var(--q1)';
  return `<div class="card center"><div class="muted">${seasonLbl(L.season)} Champions</div>${disc(h.champ, 64)}<div class="big">${esc(T(h.champ).city)} ${esc(T(h.champ).name)}</div><div class="muted">def. ${esc(T(h.runnerUp).name)}</div></div>
  <div class="sect">Season summary</div><div class="card"><div class="row"><div class="sq big" style="background:${gcol};min-width:56px;height:56px;font-size:28px">${rv.grade}</div><div class="grow"><div style="font-weight:700">Goal: ${esc(rv.goal)}</div><div class="muted">${rv.w}-${rv.l}${rv.champ ? ' · Champions!' : rv.madePO ? ` · won ${rv.roundsWon} playoff round(s)` : ' · missed playoffs'}</div></div></div>
  <div class="kv" style="margin-top:8px"><span>Job security</span><b>${rv.delta >= 0 ? '+' : ''}${rv.delta} → ${rv.security}/100</b></div>
  ${rv.fan != null ? `<div class="kv"><span>Fan support</span><b>${rv.fan} · ${E.fanLabel(rv.fan)}${rv.fanDelta ? ` (${rv.fanDelta > 0 ? '+' : ''}${rv.fanDelta} security)` : ''}</b></div>` : ''}
  <div class="kv"><span>GM reputation</span><b>${rv.repDelta >= 0 ? '+' : ''}${rv.repDelta ?? 0} → ${rv.reputation ?? L.gm.reputation} (${E.repLabel(L.gm.reputation)})</b></div>
  <div class="kv"><span>Legacy score</span><b>${L.gm.legacy}</b></div><div class="kv"><span>Your award winners</span><b>${rv.awardWinners ?? 0}</b></div>
  ${(L.jobMarket || []).length ? `<button class="blue" style="width:100%;margin-top:8px" data-a="nav" data-p="gm" data-t="jobs">${L.gm.fired ? 'Find a new job' : 'Stay — or explore other jobs'} (${L.jobMarket.length} interested)</button>` : ''}</div>
  <div class="sect">Awards</div><div class="card">${aw('mvp', 'MVP')}${aw('fmvp', 'Finals MVP')}${aw('dpoy', 'Defensive POY')}${aw('roy', 'Rookie of the Year')}${aw('sixth', 'Sixth Man')}${aw('mip', 'Most Improved')}
  ${a.allNBA.map((tm, i) => `<div class="kv"><span>All-NBA ${['1st', '2nd', '3rd'][i]}</span><span style="text-align:right;font-size:13px">${tm.map(x => esc(x.name)).join(', ')}</span></div>`).join('')}</div>
  ${ret.length ? `<div class="sect">Retirement watch</div><div class="list">${ret.map(p => `<div class="it">${avatar(p, 36)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">Age ${p.age} · OVR ${R(p.ovr)}${p.convinced === false ? ' · not coming back' : ''}</div></div>${p.convinced === undefined ? `<button class="sm blue" data-a="convince" data-pid="${p.pid}">Convince</button>` : ''}</div>`).join('')}</div>` : ''}`;
}
function lotteryCard(L) {
  const lo = L.lottery; const n = lo.result.length; const rev = S.lotteryReveal;
  const shown = lo.result.map((tid, i) => ({ tid, pick: i + 1 })).reverse().slice(0, rev);
  return `<div class="card"><h3>${lo.season} draft lottery</h3><div class="muted">Non-playoff teams. The top 3 picks are drawn (1,000 combinations); the rest follow reverse record.</div></div>
  <div class="list">${shown.map(x => `<div class="it"><b style="width:30px">#${x.pick}</b>${disc(x.tid, 32)}<div class="grow"><div class="nm">${esc(T(x.tid).city)} ${esc(T(x.tid).name)}</div><div class="meta">Pre-lottery ${lo.pre.indexOf(x.tid) + 1} · ${lo.odds.find(o => o.tid === x.tid).combos} combos</div></div>${x.pick < lo.pre.indexOf(x.tid) + 1 ? '<b class="tg">▲</b>' : x.pick > lo.pre.indexOf(x.tid) + 1 ? '<b class="tr">▼</b>' : ''}</div>`).join('')}</div>
  ${rev < n ? `<div class="grid2" style="padding:0 10px"><button class="blue" data-a="lotNext">Reveal #${n - rev}</button><button data-a="lotAll">Reveal all</button></div>` : ''}`;
}
function resignCard(L) {
  const ps = (L.expiring || []).map(id => E.getP(L, id)).filter(p => p && p.tid === L.userTid);
  return `<div class="card"><h3>Expiring contracts</h3>Bird rights let you exceed the cap to keep your own players. Anyone unsigned becomes a free agent.<div class="kv" style="margin-top:6px"><span>Payroll next season</span><b>${M(E.payroll(L, L.userTid))} / cap ${M(E.cap(L))}</b></div></div>
  <div class="list">${ps.map(p => `<div class="it">${avatar(p, 40)}<div class="grow" data-a="player" data-pid="${p.pid}"><div class="nm">${esc(p.name)}</div><div class="meta">${p.pos} · Age ${p.age} · ${p.willing ? `asks ${M(p.resignAsk)} · ${E.prefYears(p, L)} yrs` : '<span class="tr">not interested</span>'}</div></div>
   <div class="rt">${sq(p.ovr)}<div class="dw">${devWord(p)}</div></div>${p.willing ? `<button class="sm go" data-a="offerSheet" data-pid="${p.pid}" data-kind="resign">Offer</button>` : ''}</div>`).join('') || '<div class="it muted">No expiring contracts.</div>'}</div>`;
}
function faCard(L) {
  const mine = Object.entries(L.fa.offers).filter(([, os]) => os.some(o => o.tid === L.userTid));
  return `<div class="card"><h3>Free agency · week ${L.phase[2]} of 3</h3>Make offers; players decide at the end of each week. Money matters, but so do team success, playing time and loyalty. Demands drop as free agency goes on.
  <div class="kv" style="margin-top:6px"><span>Cap room</span><b>${M(Math.max(0, E.cap(L) - E.payroll(L, L.userTid)))}</b></div><div class="kv"><span>Roster</span><b>${E.activeCount(L, L.userTid)}/${E.ROSTER_MAX}</b></div></div>
  <div class="sect">Your offers</div><div class="list">${mine.map(([pid, os]) => { const p = E.getP(L, +pid); const o = os.find(x => x.tid === L.userTid); return `<div class="it" data-a="player" data-pid="${p.pid}">${avatar(p, 36)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">${o.years} yrs × ${M(o.amt)} · ${os.length} offer(s)</div></div>${sq(p.ovr)}</div>`; }).join('') || '<div class="it muted">No pending offers.</div>'}</div>`;
}
function summerCard(L) {
  return `<div class="card"><h3>Offseason development</h3>${L.progressNote ? esc(L.progressNote) : "Players aged a year. Here's how your roster changed."}</div><div class="list">${(L.progressReport || []).map(x => { const p = E.getP(L, x.pid); return `<div class="it" data-a="player" data-pid="${x.pid}">${avatar(p, 36)}<div class="grow"><div class="nm">${esc(x.name)}</div><div class="meta">Age ${x.age} · ${devWord(p)}</div></div><b class="${x.d > 0 ? 'tg' : x.d < 0 ? 'tr' : ''}">${x.d > 0 ? '▲' : x.d < 0 ? '▼' : ''}${Math.abs(x.d) || '–'}</b>${sq(x.ovr)}</div>`; }).join('')}</div>`;
}
function seriesList(series) {
  return `<div class="list">${series.map(s => `<div class="it">${disc(s.hi, 30)}<div class="grow center"><div class="nm" style="font-size:13px">(${s.hiSeed}) ${T(s.hi).abbr}  ${s.wh} - ${s.wl}  ${T(s.lo).abbr} (${s.loSeed})</div><div class="meta">${s.winner != null ? `${T(s.winner).abbr} win series` : `best of ${s.len}`}</div></div>${disc(s.lo, 30)}</div>`).join('')}</div>`;
}

// ---------- MY TEAM (any team) ----------
function playerRow(p, opts = {}) {
  const L = S.L; const inj = (p.il ? '<span class="iltag">IL</span> ' : '') + (p.injury ? `<span class="inj">${injIcon()} ${Math.ceil(p.injury.games)}g</span>` : '');
  const yl = yrsLeft(p); const blk = (L.tradeBlock || []).includes(p.pid) ? ' <span class="tag" style="background:var(--gold)">BLOCK</span>' : '';
  const delta = p.prevOvr != null && p.ovr !== p.prevOvr ? `<span class="${p.ovr > p.prevOvr ? 'up' : 'dn'}">${p.ovr > p.prevOvr ? '↑' : '↓'}${Math.max(1, Math.abs(R(p.ovr) - R(p.prevOvr)))}</span>` : '';
  return `<div class="it" data-a="${opts.act || 'player'}" data-pid="${p.pid}">${avatar(p, 42)}
   <div class="grow"><div class="nm">${esc(p.name)}${blk} ${inj}</div><div class="meta">${opts.meta ?? `${p.pos} · ${yrsPro(p) ? `EXP ${yrsPro(p)} yrs` : 'Rookie'} · ${p.contract ? `${M(p.contract.amt)} · ${yl} yr${yl === 1 ? '' : 's'}` : 'No contract'}`}</div></div>
   ${opts.extra || ''}<div class="rt">${hideR(p) ? sq(null) : sq(p.ovr)}<div class="dw">${delta} ${devWord(p)}</div></div></div>`;
}
PAGES.team = (pg0) => {
  const L = S.L; const tid = pg0.tid ?? L.userTid; const own = tid === L.userTid; const t = T(tid);
  const tr = teamRatings(L, tid); const pr = E.payroll(L, tid), c = E.cap(L); const n = E.activeCount(L, tid), nIL = E.ilPlayers(L, tid).length;
  const tb = curTab('team', 'roster');
  const top = `<div class="thead">${disc(tid, 62)}<div class="rings">${ring('DEF', tr.def)}${ring('OFF', tr.off)}${ring('OVR', tr.ovr)}</div></div>
  <div class="caprow"><span>Cap Room <b class="${pr <= c ? 'tg' : 'tr'}">${pr <= c ? M(c - pr) : '−' + M(pr - c)}</b></span><span>Space <b class="${n < E.ROSTER_MIN ? 'tr' : ''}">${n}/${E.ROSTER_MAX}</b>${nIL ? ` <span class="iltag">IL ${nIL}</span>` : ''}</span><span>${E.standings(L)[tid].w}-${E.standings(L)[tid].l}</span></div>` +
    tabs('team', [['roster', 'Roster'], ['staff', 'Staff'], ['stats', 'Stats'], ['schedule', 'Schedule'], ['history', 'History'], ['cap', 'Cap']], 'roster');
  let body = '';
  if (tb === 'roster') {
    const ps = E.teamPlayers(L, tid);
    body = E.POS.map(pos => { const g = ps.filter(p => p.pos === pos).sort((a, b) => b.ovr - a.ovr); if (!g.length) return '';
      return `<div class="sect">${POSN[pos]} <span>${g.length}</span></div><div class="list">${g.map(p => playerRow(p)).join('')}</div>`; }).join('');
    const picks = L.picks.filter(k => k.tid === tid).sort((a, b) => a.season - b.season || a.round - b.round);
    body += `<div class="sect">Draft picks</div><div class="list">${picks.map(k => `<div class="it"><div class="grow"><div class="nm">${k.season} Round ${k.round}</div><div class="meta">${k.orig === tid ? 'Own pick' : `via ${esc(T(k.orig).city)}`}</div></div>${disc(k.orig, 28)}</div>`).join('') || '<div class="it muted">No picks.</div>'}</div>`;
  } else if (tb === 'staff') body = staffTab(L, tid, own);
  else if (tb === 'stats') body = statsTable(E.teamPlayers(L, tid));
  else if (tb === 'schedule') body = scheduleTab(L, tid);
  else if (tb === 'history') body = teamHistTab(L, tid);
  else body = capTab(L, tid);
  return { title: own ? 'My Team' : esc(t.name), right: own && tb === 'roster' ? `<button class="rb" data-a="nav" data-p="reorder">Reorder</button>` : '', top, body };
};
function staffTab(L, tid, own) {
  const t = T(tid); const role = S.staffRole || 'HC';
  const card = (s, r, mine) => !s ? `<div class="it"><div class="grow"><div class="nm tr">${E.roleName(r)} — vacant</div></div></div>` :
    `<div class="it"><span class="disc" style="width:40px;height:40px;background:#5d6d7e;font-size:11px">${r}</span><div class="grow"><div class="nm">${esc(s.name)}${s.exPid ? ` <span class="tag expl">Ex-player · ${s.exYrs} yrs · ${esc(s.exTeam || '')}</span>` : ''}${s.promoted ? ' <span class="tag expl">Promoted</span>' : ''}</div><div class="meta">${mine ? E.roleName(r) + ' · ' : ''}${r === 'HC' ? `${esc(s.off)} · ${esc(s.def)} · DEV ${s.dev}${(() => { const f = E.teamFit(E.teamPlayers(L, tid), s.off, s.def); return ` · <b class="fit${f.off + f.def >= 128 ? ' good' : f.off + f.def < 112 ? ' bad' : ''}">Fit ${Math.round((f.off + f.def) / 2)}</b>`; })()}` : r === 'AC' ? `Development ${s.dev}${s.off ? ` · leans ${esc(s.off)}` : ''}${mine && s.tenure ? ` · ${s.tenure} yr${s.tenure > 1 ? 's' : ''} here` : ''}` : `Specialty: ${s.spec}`} · age ${s.age} · ${M(s.salary)} · ${s.years}y</div></div>${sqRaw(s.rating)}
    ${own && mine && r === 'AC' && E.canPromote(L) ? `<button class="sm blue" data-a="promoteAC">Promote</button>` : ''}${own && mine && L.phase === 'STAFF' ? `<button class="sm ghost" data-a="fire" data-role="${r}">Fire</button>` : ''}${!mine ? `<button class="sm go" data-a="hire" data-sid="${s.sid}">Hire</button>` : ''}</div>`;
  let h = `<div class="list">${['HC', 'AC', 'SC', 'TR'].map(r => card(t.staff[r], r, true)).join('')}</div>`;
  h += schemeCard(L, tid);
  if (own) {
    h += `<div class="muted" style="padding:6px 14px">${L.phase === 'STAFF' ? 'Staff week: hire and fire now.' : 'Staff changes happen once a year, after the season (Staff phase). Vacancies can be filled any time.'}${L.settings.staffCap ? ` Budget ${M(E.staffSpend(L))} / ${M(E.staffBudget(L))}.` : ''}</div>`;
    const vacant = ['HC', 'AC', 'SC', 'TR'].filter(r => !t.staff[r]);
    if (L.phase === 'STAFF' || vacant.length) {
      const r0 = L.phase === 'STAFF' ? role : vacant.includes(role) ? role : vacant[0];
      const pool = L.staffPool.filter(s => s.role === r0).sort((a, b) => b.rating - a.rating).slice(0, 12);
      h += `<div class="pill-seg">${(L.phase === 'STAFF' ? ['HC', 'AC', 'SC', 'TR'] : vacant).map(r => `<button class="${r0 === r ? 'on' : ''}" data-a="staffRole" data-r="${r}">${r}</button>`).join('')}</div>
      <div class="sect">Available · ${E.roleName(r0)}</div><div class="list">${pool.map(s => card(s, r0, false)).join('') || '<div class="it muted">Nobody available.</div>'}</div>`;
    }
  }
  return h;
}
// Scheme fit (PGM-style): the head coach's systems, how the roster fits them, and each rotation player's fit
function schemeCard(L, tid) {
  const hc = T(tid).staff.HC; if (!hc) return '';
  const ps = E.teamPlayers(L, tid).sort((a, b) => b.ovr - a.ovr); const f = E.teamFit(ps, hc.off, hc.def);
  const bar = (v) => `<div class="bar"><i style="width:${clampN(v, 0, 100)}%;background:${v >= 64 ? 'var(--q4)' : v >= 52 ? 'var(--q3)' : 'var(--q1)'}"></i></div>`;
  const chip = (v) => `<span class="fitw ${E.fitWord(v).toLowerCase()}">${E.fitWord(v)}</span>`;
  return `<div class="sect">Schemes · ${esc(hc.name)}</div><div class="card scheme">
    <div class="sc"><div class="kv"><span>Offense · <b>${esc(hc.off)}</b></span><b>${f.off}</b></div>${bar(f.off)}<div class="muted">${esc(E.OFF_SCHEMES[hc.off]?.blurb || '')}</div></div>
    <div class="sc"><div class="kv"><span>Defense · <b>${esc(hc.def)}</b></span><b>${f.def}</b></div>${bar(f.def)}<div class="muted">${esc(E.DEF_SCHEMES[hc.def]?.blurb || '')}</div></div></div>
    <div class="list">${ps.slice(0, 9).map(p => { const pf = E.playerFit(p, hc.off, hc.def); return `<div class="it" data-a="player" data-pid="${p.pid}">${avatar(p, 34)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">${p.pos} · OVR ${R(p.ovr)}</div></div><div class="fitc"><small>OFF</small>${chip(pf.off)}</div><div class="fitc"><small>DEF</small>${chip(pf.def)}</div></div>`; }).join('')}</div>`;
}
function statsTable(ps, key = 'reg') {
  const rows = ps.filter(p => p.stats[key]?.gp).sort((a, b) => b.stats[key].pts / b.stats[key].gp - a.stats[key].pts / a.stats[key].gp);
  return `<div class="tscroll"><table><tr><th class="l">Player</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>3P%</th><th>FT%</th></tr>
  ${rows.map(p => { const s = p.stats[key]; return `<tr data-a="player" data-pid="${p.pid}"><td class="l">${esc(p.name.split(' ').slice(-1)[0])}</td><td>${s.gp}</td><td>${pg(s, 'min')}</td><td><b>${pg(s, 'pts')}</b></td><td>${(rebOf(s) / s.gp).toFixed(1)}</td><td>${pg(s, 'ast')}</td><td>${pg(s, 'stl')}</td><td>${pg(s, 'blk')}</td><td>${s.fga ? (s.fgm / s.fga * 100).toFixed(1) : '-'}</td><td>${s.tpa ? (s.tpm / s.tpa * 100).toFixed(1) : '-'}</td><td>${s.fta ? (s.ftm / s.fta * 100).toFixed(1) : '-'}</td></tr>`; }).join('') || '<tr><td colspan="11" class="l muted">No games played yet.</td></tr>'}</table></div>`;
}
function scheduleTab(L, tid) {
  const gs = L.schedule.filter(g => g.h === tid || g.a === tid);
  if (!gs.length) return '<div class="card muted">The schedule is released at the start of the regular season.</div>';
  return `<div class="list">${gs.map(g => { const home = g.h === tid; const opp = home ? g.a : g.h; const won = g.played && ((home && g.hs > g.as) || (!home && g.as > g.hs));
    return `<div class="it" ${g.played && L.games[g.gid] ? `data-a="box" data-gid="${g.gid}"` : ''}><span class="muted" style="width:50px;font-size:12px">${E.dateOf(L, g.day).replace(/, \d+$/, '')}</span>${disc(opp, 30)}<div class="grow nm">${home ? 'vs' : '@'} ${esc(T(opp).name)}</div>${g.played ? `<b class="${won ? 'tg' : 'tr'}">${won ? 'W' : 'L'} ${home ? g.hs : g.as}-${home ? g.as : g.hs}${g.ot ? ' OT' : ''}</b>` : ''}</div>`; }).join('')}</div>`;
}
// Franchise career leaders (totals with this team, regular season, since the league start)
function franchiseLeaders(L, tid) {
  const tot = new Map();
  for (const p of L.players) for (const c of p.career || []) if (c.tid === tid) {
    const t = tot.get(p.pid) || { p, gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 }; for (const k of ['gp', 'pts', 'reb', 'ast', 'stl', 'blk']) t[k] += c[k] || 0; tot.set(p.pid, t);
  }
  const all = [...tot.values()]; if (!all.length) return '';
  const cats = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['gp', 'Games']];
  return `<div class="sect">Franchise leaders · since 1996-97</div><div class="card fl">${cats.map(([k, lb]) => { const top = all.slice().sort((a, b) => b[k] - a[k]).slice(0, 3).filter(x => x[k] > 0);
    return `<div class="flr"><div class="muted flc">${lb}</div>${top.map((x, i) => `<div class="fli" data-a="player" data-pid="${x.p.pid}"><span class="fln">${i + 1}. ${esc(x.p.name)}${x.p.tid === tid ? ' <span class="cur">•</span>' : ''}</span><b>${x[k].toLocaleString()}</b></div>`).join('')}</div>`; }).join('')}</div>`;
}
function teamHistTab(L, tid) {
  const rows = (L.teamHist || []).filter(h => h.tid === tid).slice().reverse();
  const titles = L.history.filter(h => h.champ === tid).length;
  const ret = (T(tid).retiredNums || []).slice().sort((a, b) => (+a.num) - (+b.num) || a.num.length - b.num.length);
  const rafters = `<div class="sect">Retired numbers · ${ret.length}</div><div class="card rafters">${ret.length ? ret.map(r => `<div class="rn" ${r.pid ? `data-a="player" data-pid="${r.pid}"` : ''}>${avatar({ tid, num: r.num }, 46)}<div class="rnn">${esc(r.name.split(' ').slice(-1)[0])}</div><div class="rns">${r.season ? seasonLbl(r.season) : 'pre-1996'}</div></div>`).join('') : '<div class="muted">No numbers retired yet. Franchise legends get theirs raised when they retire.</div>'}</div>`;
  return `<div class="card"><div class="kv"><span>Championships (since 1997)</span><b>${titles}</b></div><div class="kv"><span>Seasons</span><b>${rows.length}</b></div></div>${rafters}${franchiseLeaders(L, tid)}
  <div class="tscroll"><table><tr><th>Season</th><th>W-L</th><th class="l">Result</th><th class="l">Top player</th></tr>${rows.map(h => `<tr><td>${seasonLbl(h.season)}</td><td>${h.w}-${h.l}</td><td class="l">${esc(h.result)}</td><td class="l">${esc(h.best || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="l muted">Team history is written at the end of each season.</td></tr>'}</table></div>`;
}
function capTab(L, tid) {
  const ps = E.teamPlayers(L, tid).sort((a, b) => (b.contract?.amt || 0) - (a.contract?.amt || 0));
  const years = [0, 1, 2, 3, 4].map(i => L.season + i);
  const dead = L.deadMoney.filter(d => d.tid === tid && d.exp >= L.season);
  const pr = E.payroll(L, tid), c = E.cap(L);
  const amtIn = (p, y) => p.contract && p.contract.exp >= y ? M(E.salaryInYear(p.contract, y)) : p.contract?.ext && p.contract.ext.exp >= y ? `<span class="tg">${M(p.contract.ext.amt)}</span>` : '';
  return `<div class="card"><div class="kv"><span>Salary cap ${seasonLbl(L.season)}</span><b>${M(c)}</b></div><div class="kv"><span>Payroll</span><b>${M(pr)}</b></div><div class="kv"><span>Cap room</span><b class="${pr <= c ? 'tg' : 'tr'}">${pr <= c ? M(c - pr) : 'Over by ' + M(pr - c)}</b></div>
  <div class="kv"><span>Minimum salary</span><b>${M(E.minSalary(L.season))}</b></div><div class="kv"><span>Max contract length</span><b>${E.maxYears(L, true)} yrs (own) · ${E.maxYears(L, false)} yrs (others)</b></div>
  <div class="muted">Soft cap: over the cap you can still re-sign your own players (Bird rights) and sign minimum deals. Trades over the cap must match salaries (≤125% + $0.1M).</div></div>
  <div class="tscroll"><table><tr><th class="l">Player</th>${years.map(y => `<th>${String(y - 1).slice(2)}-${String(y).slice(2)}</th>`).join('')}</tr>
  ${ps.map(p => `<tr data-a="player" data-pid="${p.pid}"><td class="l">${esc(p.name)}</td>${years.map(y => `<td>${amtIn(p, y)}</td>`).join('')}</tr>`).join('')}
  ${dead.map(d => `<tr><td class="l tr">${esc(d.name)} (waived)</td>${years.map(y => `<td class="tr">${d.exp >= y ? M(d.amt) : ''}</td>`).join('')}</tr>`).join('')}</table></div>`;
}

// ---------- REORDER (depth chart = starters + rotation order + minutes) ----------
function ensureRotation() {
  const L = S.L, t = T(L.userTid);
  if (!t.rotation || t.autoRotation) t.rotation = E.autoRotation(E.teamPlayers(L, L.userTid));
  for (const p of E.teamPlayers(L, L.userTid)) if (t.rotation.minutes[p.pid] == null) t.rotation.minutes[p.pid] = 0;
  t.rotation.order ||= [];
  const ids = E.teamPlayers(L, L.userTid).map(p => p.pid);
  t.rotation.order = [...t.rotation.starters.filter(x => ids.includes(x)), ...t.rotation.order.filter(x => ids.includes(x) && !t.rotation.starters.includes(x)), ...ids.filter(x => !t.rotation.starters.includes(x) && !t.rotation.order.includes(x)).sort((a, b) => t.rotation.minutes[b] - t.rotation.minutes[a])];
  t.rotation.order = [...new Set(t.rotation.order)];
  return t.rotation;
}
PAGES.reorder = () => {
  const L = S.L, t = T(L.userTid); const rot = ensureRotation(); const auto = t.autoRotation;
  const ps = rot.order.map(id => E.getP(L, id));
  const tot = ps.reduce((s, p) => s + (p.injury ? 0 : rot.minutes[p.pid] || 0), 0);
  const row = (p, i) => { const st = i < 5; return `<div class="it">${!auto ? `<div style="display:flex;flex-direction:column;gap:2px"><button class="sm ghost" style="padding:0 8px" data-a="mv" data-pid="${p.pid}" data-d="-1">▲</button><button class="sm ghost" style="padding:0 8px" data-a="mv" data-pid="${p.pid}" data-d="1">▼</button></div>` : `<b style="width:22px" class="muted">${i + 1}</b>`}
    <div class="grow" data-a="player" data-pid="${p.pid}"><div class="nm">${esc(p.name)} ${p.injury ? `<span class="inj">${injIcon()}</span>` : ''}</div><div class="meta"><b>${p.pos}</b>${p.natPos && p.natPos !== p.pos ? ` (natural ${p.natPos})` : ''} · ${E.bestRole(p)}</div></div>
    ${!auto ? `<button class="sm ghost" data-a="mins" data-pid="${p.pid}" data-d="-2">−</button>` : ''}<b style="width:24px;text-align:center">${rot.minutes[p.pid] || 0}</b>${!auto ? `<button class="sm ghost" data-a="mins" data-pid="${p.pid}" data-d="2">+</button>` : ''}${sq(p.ovr)}</div>`; };
  return { title: 'Reorder', right: `<button class="rb" data-a="autoRot">${auto ? `Auto ${icon('check', { s: 16 })}` : 'Auto'}</button>`,
    body: `<div class="card"><div class="kv"><span>Rotation minutes</span><b class="${Math.abs(tot - 240) <= 5 ? 'tg' : 'tr'}">${tot} / 240</b></div><div class="muted">${auto ? 'Your head coach sets the lineup. Turn Auto off to set your own starters, order and minutes.' : 'Top five start. Use ▲▼ to reorder, −/+ for minutes. Tap a player to change his position.'}</div></div>
    <div class="sect">Starters</div><div class="list">${ps.slice(0, 5).map(row).join('')}</div><div class="sect">Bench</div><div class="list">${ps.slice(5).map((p, i) => row(p, i + 5)).join('')}</div>` };
};

// ---------- PLAYER ----------
PAGES.player = (pg0) => {
  const L = S.L, p = E.getP(L, pg0.pid); if (!p) return { title: 'Player', body: '<div class="card">Not found.</div>' };
  const own = p.tid === L.userTid; const tb = curTab('player', 'skills'); const pot = potOf(p); const age = E.ageNow(L, p);
  const shortl = (L.shortlist || []).includes(p.pid);
  const top = `<div class="phead">${avatar(p, 64)}<div class="grow"><div style="font-weight:800;font-size:16px">${esc(p.name)}</div>
   <div class="muted">${p.tid >= 0 && p.num != null ? `#${esc(p.num)} · ` : ''}${p.pos} · Age ${age} · <span class="nw">${ht(p.h)}</span> · <span class="nw">${Math.round(p.w * 2.20462)} lb</span></div><div class="muted">${p.tid >= 0 ? esc(T(p.tid).city + ' ' + T(p.tid).name) : p.tid === -1 ? 'Free agent' : p.tid === -2 ? `${esc(p.college || p.country)} · ${p.draft?.year} draft` : p.tid === -6 ? 'Fantasy draft pool' : p.hiatus ? `Retired (${p.hiatus.from})` : 'Retired'}</div>
   ${p.injury ? `<div class="inj">${injIcon()} ${esc(p.injury.type)} — out ~${Math.ceil(p.injury.games)} game(s)</div>` : ''}</div>
   <div class="rbox"><div class="h">RATING</div><div class="n ${hideR(p) ? '' : qc(p.ovr)}">${hideR(p) ? '?' : R(p.ovr)}</div><div class="w">${devWord(p) || '&nbsp;'}</div></div></div>
   <div class="pcols"><div><span class="muted">POT</span> ${stars(pot)}</div><div><span class="muted">EXP</span> <b>${yrsPro(p)}</b></div><div><span class="muted">Contract</span> <b>${p.contract ? M(p.contract.amt) : '—'}</b></div></div>` +
    tabs('player', [['skills', 'Skills'], ['contract', 'Contract'], ['games', 'Games'], ['career', 'Career']], 'skills');
  let body = tb === 'skills' ? skillsTab(p) : tb === 'contract' ? contractTab(p) + txSection(p) : tb === 'games' ? gamesTab(p) : careerTab(p, pot);
  const acts = [];
  if (own && !['PLAYOFFS'].includes(L.phase)) acts.push(`<button class="${(L.tradeBlock || []).includes(p.pid) ? 'red' : 'blue'}" data-a="block" data-pid="${p.pid}">${(L.tradeBlock || []).includes(p.pid) ? 'Remove from block' : 'Trade Block'}</button>`);
  if (own && tradeOpen(L)) acts.push(`<button class="go" data-a="getOffers" data-pid="${p.pid}">Get Offers</button>`);
  if (own && L.phase === 'RESIGN' && L.expiring?.includes(p.pid) && p.willing) acts.push(`<button class="go" data-a="offerSheet" data-pid="${p.pid}" data-kind="resign">Re-sign</button>`);
  if (own && ['PRESEASON', 'REGULAR'].includes(L.phase) && p.contract && !p.contract.ext) acts.push(`<button class="go" data-a="offerSheet" data-pid="${p.pid}" data-kind="ext">Extend</button>`);
  if (own && p.il) acts.push(`<button data-a="ilAct" data-pid="${p.pid}">Activate from IL</button>`);
  else if (own && p.injury && E.canPlaceIL(L, p).ok) acts.push(`<button data-a="ilPlace" data-pid="${p.pid}">Move to Injured List</button>`);
  if (own && L.phase !== 'PLAYOFFS') acts.push(`<button class="red" data-a="release" data-pid="${p.pid}">Release</button>`);
  if (p.tid === -1) acts.push(`<button class="go" data-a="offerSheet" data-pid="${p.pid}" data-kind="fa">Offer Contract</button>`);
  if (p.tid === -1 && !p.retired) acts.push(`<button data-a="signToSheet" data-pid="${p.pid}">Sign to team…</button>`);
  if (p.tid >= 0 && !own && L.phase !== 'PLAYOFFS') acts.push(`<button class="blue" data-a="tradeFor" data-pid="${p.pid}">Trade For</button>`);
  if (p.tid === -2 && L.phase === 'DRAFT' && L.draft.order[L.draft.idx] && E.draftControls(L, L.draft.order[L.draft.idx].tid) && p.draft?.year === L.season) acts.push(`<button class="go" data-a="draftPick" data-pid="${p.pid}">Draft</button>`);
  const editBtn = `<button class="rb" data-a="edit" data-pid="${p.pid}" aria-label="Edit player">${icon('pen', { s: 22 })}</button>`;
  return { title: 'Player', right: (p.tid === -2 ? `<button class="rb" data-a="short" data-pid="${p.pid}" aria-label="Shortlist">${starSvg(shortl ? 'full' : 'empty', 24)}</button>` : '') + editBtn, top, body, cta: acts.slice(0, 3).join('') };
};
function skillsTab(p) {
  const R = p.ratings; const hid = hideR(p); const prev = p.prevRatings;
  const at = (k) => { const v = hid ? null : R[k]; const d = prev && !hid && prev[k] != null ? R[k] - prev[k] : 0; return `<div class="at"><span class="grow">${E.ATTR_LABEL[k]}</span>${d ? `<span class="${d > 0 ? 'up' : 'dn'}" style="margin-right:4px">${d > 0 ? '↑' : '↓'}${Math.abs(d)}</span>` : ''}${sq(v)}</div>`; };
  const roles = hid ? [] : E.roleRatings(p);
  const pen = E.posPenalty(p);
  return `${p.tid === S.L.userTid ? `<div class="sect">Position</div><div class="pill-seg">${E.POS.map(pos => `<button class="${p.pos === pos ? 'on' : ''}" data-a="chgPos" data-pid="${p.pid}" data-pos="${pos}">${pos}</button>`).join('')}</div>` : ''}
  ${roles.length ? `<div class="roles">${roles.map(([n, v]) => `<div><div class="muted">${n}</div>${sq(v, 'big')}</div>`).join('')}</div>` : ''}
  ${p.tid >= 0 && T(p.tid).staff?.HC && !hid ? (() => { const hc = T(p.tid).staff.HC, f = E.playerFit(p, hc.off, hc.def); return `<div class="card fitline">Scheme fit · <b>${esc(hc.off)}</b> <span class="fitw ${E.fitWord(f.off).toLowerCase()}">${E.fitWord(f.off)}</span> · <b>${esc(hc.def)}</b> <span class="fitw ${E.fitWord(f.def).toLowerCase()}">${E.fitWord(f.def)}</span></div>`; })() : ''}
  ${pen ? `<div class="card" style="color:var(--q1)">Playing out of position (natural ${p.natPos}). Adaptability ${p.adapt ?? 50} — penalty −${pen} OVR, shrinking each offseason.</div>` : ''}
  <div class="grp"><h4>Physical</h4><div class="attrs">${['ath', 'sta', 'dur', 'reb'].map(at).join('')}</div></div>
  <div class="grp"><h4>Mental</h4><div class="attrs">${at('iq')}<div class="at"><span class="grow">Work Ethic</span><span class="tag" style="background:${{ High: 'var(--q4)', Medium: 'var(--q3)', Low: 'var(--q1)' }[p.traits.work] || 'var(--sub)'}">${esc(String(p.traits.work).toUpperCase())}</span></div>${p.adapt != null || p.tid === S.L.userTid ? `<div class="at"><span class="grow">Adaptability</span>${sq(p.adapt ?? 50)}</div>` : ''}</div></div>
  <div class="grp"><h4>Technical</h4><div class="attrs">${['ins', 'out', 'sco', 'pas', 'han', 'idef', 'pdef', 'blk', 'stl'].filter(k => p.ratings[k] != null).map(at).join('')}</div></div>
  ${p.awards.length || p.hof ? `<div class="sect">Honors</div><div class="card">${p.hof ? '<span class="tag" style="background:var(--gold)">HALL OF FAME</span> ' : ''}${awardSummary(p)}</div>` : ''}`;
}
function awardSummary(p) {
  const c = {}; for (const a of p.awards) (c[a.type] = c[a.type] || []).push(a.season);
  const yy = (s) => "'" + String(s % 100).padStart(2, '0');
  return `<div class="accol">${Object.entries(c).map(([k, ss]) => `<div class="acc"><span class="tag" style="background:var(--navy)">${ss.length > 1 ? ss.length + '× ' : ''}${esc(k)}</span><span class="muted small">${ss.map(yy).join(' ')}</span></div>`).join('')}</div>`;
}
function contractTab(p) {
  const L = S.L; const c = p.contract; const tr = p.traits; const lvl = (v) => v >= 70 ? 'High' : v >= 40 ? 'Medium' : 'Low';
  return `<div class="card">${c ? `<div class="kv"><span>Salary ${seasonLbl(L.season)}</span><b>${M(c.amt)}</b></div>${c.raise ? `<div class="kv"><span>Structure</span><b>${c.raise > 0 ? 'Back' : 'Front'}-loaded ${c.raise > 0 ? '+' : ''}${Math.round(c.raise * 1000) / 10}%/yr</b></div><div class="kv"><span>By season</span><b class="small">${Array.from({ length: c.exp - L.season + 1 }, (_, i) => M(E.salaryInYear(c, L.season + i))).join(' · ')}</b></div>` : ''}<div class="kv"><span>Years left</span><b>${yrsLeft(p)} (through ${seasonLbl(c.exp)})</b></div><div class="kv"><span>Type</span><b>${c.rookie ? 'Rookie scale' : c.ng ? 'Non-guaranteed' : 'Guaranteed'}</b></div>
   ${c.ext ? `<div class="kv"><span>Extension</span><b class="tg">${M(c.ext.amt)}/yr through ${seasonLbl(c.ext.exp)}</b></div>` : ''}` : '<div class="muted">No contract.</div>'}
  <div class="kv"><span>Market value</span><b>${M(E.marketValue(p, L.season))}/yr</b></div>${p.tid >= 0 ? `<div class="kv"><span>Trade value</span><b>${E.playerValue(L, p)}</b></div>` : ''}</div>
  <div class="sect">Personality</div><div class="card"><div class="kv"><span>Type</span><b>${esc(tr.personality)}</b></div><div class="kv"><span>Wants to win</span><b>${lvl(tr.ambition)}</b></div><div class="kv"><span>Loyalty</span><b>${lvl(tr.loyalty)}</b></div><div class="kv"><span>Money-motivated</span><b>${lvl(tr.greed)}</b></div>
  ${p.tid !== L.userTid && p.tid !== -2 ? `<div class="kv"><span>Interest in your team</span><b>${(() => { const m = E.moodToward(L, p, L.userTid); return m > 1.05 ? '<span class="tg">Keen</span>' : m > 0.9 ? 'Open' : m > 0.82 ? '<span class="ty">Lukewarm</span>' : '<span class="tr">Not interested</span>'; })()}</b></div>` : ''}</div>`;
}
// Per-player transaction history (signings, trades, releases, injured list) plus how he entered the league
function txSection(p) {
  const L = S.L; const rows = (p.tx || []).slice();
  const d = p.draft; const dr = d?.round ? `Drafted ${d.year}: round ${d.round}, pick ${d.pick} by ${L.teams[d.tid]?.abbr || '—'}` : d?.year && d.year > 1996 ? `Undrafted (${d.year})` : null;
  const icon2 = { sign: icon('pen', { s: 14 }), trade: icon('trade', { s: 14 }), release: icon('close', { s: 14 }), il: injIcon() };
  return `<div class="sect">Transactions</div><div class="card tx">${rows.length || dr ? rows.map(t => `<div class="txr"><span class="txs">${seasonLbl(t.season)}</span><span class="txi txi-${t.type}">${icon2[t.type] || ''}</span><span class="grow">${esc(t.text)}</span></div>`).join('') + (dr ? `<div class="txr"><span class="txs">${d.year}</span><span class="txi">${icon('ball', { s: 14 })}</span><span class="grow">${esc(dr)}</span></div>` : '') : '<div class="muted">No transactions since 1996.</div>'}</div>`;
}
function gamesTab(p) {
  const L = S.L; const rows = [];
  for (const gid of Object.keys(L.games).reverse()) { const G = L.games[gid]; const l = G.box[p.tid]?.[p.pid] || G.box[G.h]?.[p.pid] || G.box[G.a]?.[p.pid]; if (l) rows.push({ G, l, gid }); if (rows.length >= 20) break; }
  if (!rows.length) return '<div class="card muted">No recent game logs. (Box scores are kept for recent games.)</div>';
  return `<div class="tscroll"><table><tr><th class="l">Game</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>+/-</th></tr>${rows.map(({ G, l, gid }) => { const home = G.box[G.h]?.[p.pid]; const opp = home ? G.a : G.h; const won = home ? G.hs > G.as : G.as > G.hs;
    return `<tr data-a="box" data-gid="${gid}"><td class="l">${home ? 'vs' : '@'} ${T(opp).abbr} <span class="${won ? 'tg' : 'tr'}">${won ? 'W' : 'L'}</span></td><td>${l.min.toFixed(0)}</td><td><b>${l.pts}</b></td><td>${l.orb + l.drb}</td><td>${l.ast}</td><td>${l.fgm}-${l.fga}</td><td>${l.pm > 0 ? '+' : ''}${l.pm}</td></tr>`; }).join('')}</table></div>`;
}
function careerTab(p, pot) {
  const L = S.L;
  const rows = p.career.map(c => ({ ...c }));
  const s = p.stats.reg; if (s.gp) rows.push({ season: p.stats.season, abbr: L.teams[p.tid]?.abbr || 'FA', gp: s.gp, pts: s.pts, reb: rebOf(s), ast: s.ast, fgm: s.fgm, fga: s.fga, min: s.min, cur: true });
  const t = E.careerTotals(p);
  const pts = [...p.hist.map(h => ({ s: h.season, o: R(h.ovr) })), { s: L.season, o: R(p.ovr) }];
  const w = 320, h = 80, mn = Math.min(...pts.map(x => x.o)) - 3, mx = Math.max(R(pot), ...pts.map(x => x.o)) + 2;
  const X = (i) => pts.length === 1 ? w / 2 : 12 + i * (w - 24) / (pts.length - 1), Y = (v) => h - 8 - (v - mn) / (mx - mn || 1) * (h - 18);
  const path = pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.o).toFixed(1)}`).join(' ');
  return `<div class="card"><h3>Rating history</h3><svg class="spark" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${Y(R(pot))}" y2="${Y(R(pot))}" stroke="var(--gold)" stroke-dasharray="4 4"/><path d="${path}" fill="none" stroke="var(--hdr)" stroke-width="3"/>${pts.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.o)}" r="3.5" fill="var(--hdr)"/><text x="${X(i)}" y="${Y(x.o) - 7}" font-size="10" text-anchor="middle" fill="var(--sub)">${x.o}</text>`).join('')}</svg>
  ${p.draft?.year ? `<div class="kv"><span>Draft</span><b>${p.draft.year}${p.draft.round ? ` · Rd ${p.draft.round}, #${p.draft.pick}${p.draft.tid != null && T(p.draft.tid) ? ' by ' + T(p.draft.tid).abbr : ''}` : p.draft.year > L.season ? ' (upcoming)' : ' · undrafted'}</b></div>` : ''}<div class="kv"><span>From</span><b>${esc(p.college || p.country)}</b></div></div>
  <div class="tscroll"><table><tr><th>Yr</th><th>Tm</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG%</th></tr>${rows.map(r => `<tr class="${r.cur ? 'hl' : ''}"><td>${r.season}</td><td>${r.abbr}</td><td>${r.gp}</td><td>${(r.min / r.gp).toFixed(1)}</td><td>${(r.pts / r.gp).toFixed(1)}</td><td>${(r.reb / r.gp).toFixed(1)}</td><td>${(r.ast / r.gp).toFixed(1)}</td><td>${r.fga ? (r.fgm / r.fga * 100).toFixed(1) : '-'}</td></tr>`).join('') || '<tr><td colspan="8" class="l muted">No NBA games yet.</td></tr>'}</table></div>
  <div class="muted" style="padding:6px 14px">In this league: ${t.gp} GP · ${t.pts} PTS · ${t.reb} REB · ${t.ast} AST${p.prior?.yrs ? ` · plus ~${p.prior.yrs} seasons before 1996-97` : ''}</div>`;
}

// ---------- GAMEDAY ----------
const clk = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
PAGES.live = () => {
  const lv = S.live; if (!lv) return PAGES.home();
  const r = lv.r, g = lv.g; const evs = r.pbp.slice(0, lv.i); const done = lv.i >= r.pbp.length;
  const last = evs[evs.length - 1] || { hs: 0, as: 0, q: 1, t: 720, o: 0, el: 0, txt: 'Opening tip.' };
  const hs = done ? r.hs : last.hs, as = done ? r.as : last.as;
  const qLen = last.q > 4 ? 300 : 720; const qpct = done ? 100 : Math.round((1 - last.t / qLen) * 100);
  const posH = last.o === 0; // possession: 0 = home
  const sbRow = (tid, pts, has) => `<div class="sbr"><span class="ab">${disc(tid, 30)}${T(tid).abbr} <span style="font-size:12px;opacity:.7;font-weight:600">${E.standings(S.L)[tid].w}-${E.standings(S.L)[tid].l}</span><span class="dot ${has && !done ? 'on' : ''}"></span></span><span class="sc">${pts}</span></div>`;
  // momentum: last ~16 events score diff swing
  const recent = evs.slice(-16); const swing = recent.length ? (recent.at(-1).hs - recent.at(-1).as) - (recent[0].hs - recent[0].as) : 0;
  const mx = 50 + Math.max(-40, Math.min(40, swing * 4)); // >50 home pushing
  const court = `<svg class="court" viewBox="0 0 300 120"><rect x="1" y="1" width="298" height="118" rx="6" fill="#d9a066" stroke="#fff" stroke-width="2"/><line x1="150" y1="1" x2="150" y2="119" stroke="#fff" stroke-width="2"/><circle cx="150" cy="60" r="16" fill="none" stroke="#fff" stroke-width="2"/>
   <rect x="1" y="38" width="46" height="44" fill="${T(g.a).c1}" opacity=".55" stroke="#fff" stroke-width="2"/><rect x="253" y="38" width="46" height="44" fill="${T(g.h).c1}" opacity=".55" stroke="#fff" stroke-width="2"/>
   <path d="M1 12 H18 A52 52 0 0 1 18 108 H1" fill="none" stroke="#fff" stroke-width="2"/><path d="M299 12 H282 A52 52 0 0 0 282 108 H299" fill="none" stroke="#fff" stroke-width="2"/>
   <circle cx="${done ? 150 : posH ? 230 + (qpct % 7) : 70 - (qpct % 7)}" cy="${60 + ((lv.i * 13) % 30) - 15}" r="7" fill="#e8771e" stroke="#7a3a0b" stroke-width="1.5"/>
   <rect x="0" y="0" width="${mx * 3}" height="5" fill="${T(g.h).c1}" opacity=".0"/></svg>
   <div class="mom"><span style="width:${100 - mx}%;background:${T(g.a).c1}"></span><span style="width:${mx}%;background:${T(g.h).c1}"></span></div>`;
  const tb = curTab('live', 'feed');
  const snap = last.snap || (done ? null : null);
  let body = '';
  if (tb === 'feed') body = `<div class="pbp">${evs.slice().reverse().slice(0, 120).map(e => `<div><span class="clk">${e.q > 4 ? 'OT' : 'Q' + e.q} ${clk(e.t)}</span>${esc(e.txt)} <span class="muted">${e.as}-${e.hs}</span></div>`).join('')}</div>`;
  else if (tb === 'team') { const sn = lv.lastSnap; body = sn ? teamStatCmp(g, sn) : '<div class="card muted">Stats appear once the game starts.</div>'; }
  else { const sn = lv.lastSnap; body = sn ? [1, 0].map(i => { const tid = i === 0 ? g.h : g.a; const pl = sn[i].pl.slice().sort((a, b) => b[1] - a[1]);
      return `<div class="sect">${esc(T(tid).name)}</div><div class="tscroll"><table><tr><th class="l">Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr>${pl.map(x => { const p = E.getP(S.L, x[0]); return `<tr><td class="l">${esc(p?.name.split(' ').slice(-1)[0] || '')}</td><td>${x[4]}</td><td><b>${x[1]}</b></td><td>${x[2]}</td><td>${x[3]}</td></tr>`; }).join('')}</table></div>`; }).join('') : '<div class="card muted">—</div>'; }
  if (last.snap) lv.lastSnap = last.snap;
  return { title: 'Gameday', right: `<button class="rb" data-a="box" data-gid="${g.gid}">Box</button>`,
    top: `<div class="sb"><div class="sbx">${sbRow(g.a, as, !posH)}${sbRow(g.h, hs, posH)}</div><div class="sbq"><span>${done ? 'FINAL' + (r.ot ? ' / OT' : '') : `${last.q > 4 ? 'OT' + (last.q - 4) : 'QTR ' + last.q} - ${clk(last.t)}`}</span><span>${lv.s ? `Series ${T(lv.s.hi).abbr} ${lv.s.wh}-${lv.s.wl}` : E.dateOf(S.L, g.day)}</span></div><div class="sbp"><i style="width:${qpct}%"></i></div></div>
     ${court}<div class="lastplay">${esc(done ? `Final: ${T(g.a).abbr} ${r.as}, ${T(g.h).abbr} ${r.hs}` : last.txt)}</div>` + tabs('live', [['feed', 'Game Log'], ['team', 'Team Stats'], ['players', 'Player Stats']], 'feed'),
    body, cta: done ? `<button class="go" data-a="liveDone">Continue</button>` : `<div class="pill-seg" style="margin:0;flex:1">${[['1', '1×'], ['4', '4×'], ['20', '20×']].map(([k, l]) => `<button class="${String(lv.speed) === k ? 'on' : ''}" data-a="speed" data-v="${k}">${l}</button>`).join('')}</div><button class="go" style="flex:.6" data-a="speed" data-v="999">Sim to end</button>` };
};
function teamStatCmp(g, sn) {
  const a = sn[1], h = sn[0];
  const pct = (m, x) => x ? Math.round(m / x * 100) + '%' : '-';
  const rows = [['FG', `${a.fgm}-${a.fga}`, `${h.fgm}-${h.fga}`], ['FG%', pct(a.fgm, a.fga), pct(h.fgm, h.fga)], ['3PT', `${a.tpm}-${a.tpa}`, `${h.tpm}-${h.tpa}`], ['FT', `${a.ftm}-${a.fta}`, `${h.ftm}-${h.fta}`], ['Rebounds', a.reb, h.reb], ['Assists', a.ast, h.ast], ['Steals', a.stl, h.stl], ['Blocks', a.blk, h.blk], ['Turnovers', a.tov, h.tov], ['Fouls', a.pf, h.pf]];
  return `<div class="gst" style="font-weight:800">${disc(g.a, 28)}<span></span>${disc(g.h, 28)}</div>${rows.map(([k, x, y]) => `<div class="gst"><b>${x}</b><span class="l">${k}</span><b>${y}</b></div>`).join('')}`;
}
PAGES.box = (pg0) => {
  const L = S.L; const G = L.games[pg0.gid]; if (!G) return { title: 'Box Score', body: '<div class="card muted">Not available.</div>' };
  const team = (tid) => { const box = G.box[tid]; const rows = Object.entries(box).map(([pid, l]) => ({ p: E.getP(L, +pid), l })).filter(x => x.p).sort((a, b) => b.l.gs - a.l.gs || b.l.min - a.l.min);
    return `<div class="sect">${esc(T(tid).city)} ${esc(T(tid).name)} — ${tid === G.h ? G.hs : G.as}</div><div class="tscroll"><table><tr><th class="l">Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3P</th><th>FT</th><th>TO</th><th>PF</th><th>+/-</th></tr>
    ${rows.map(({ p, l }) => `<tr data-a="player" data-pid="${p.pid}"><td class="l">${l.gs ? '<b>' : ''}${esc(p.name.split(' ').slice(-1)[0])}${l.gs ? '</b>' : ''}</td><td>${l.min.toFixed(0)}</td><td><b>${l.pts}</b></td><td>${l.orb + l.drb}</td><td>${l.ast}</td><td>${l.stl}</td><td>${l.blk}</td><td>${l.fgm}-${l.fga}</td><td>${l.tpm}-${l.tpa}</td><td>${l.ftm}-${l.fta}</td><td>${l.tov}</td><td>${l.pf}</td><td>${l.pm > 0 ? '+' : ''}${l.pm}</td></tr>`).join('')}</table></div>`; };
  const q = (arr) => arr.map(x => `<td>${x}</td>`).join('');
  return { title: 'Box Score', top: `<div class="sb"><div class="sbx">${[[G.a, G.as], [G.h, G.hs]].map(([tid, s]) => `<div class="sbr"><span class="ab">${disc(tid, 30)}${T(tid).abbr}</span><span class="sc">${s}</span></div>`).join('')}</div><div class="sbq"><span>FINAL${G.ot ? ' / OT' : ''}</span><span>${G.day != null ? E.dateOf(L, G.day) : ''}</span></div></div>`,
    body: `<div class="tscroll"><table><tr><th class="l">Team</th>${G.qh.map((_, i) => `<th>${i < 4 ? 'Q' + (i + 1) : 'OT' + (i - 3)}</th>`).join('')}<th>T</th></tr><tr><td class="l">${T(G.a).abbr}</td>${q(G.qa)}<td><b>${G.as}</b></td></tr><tr><td class="l">${T(G.h).abbr}</td>${q(G.qh)}<td><b>${G.hs}</b></td></tr></table></div>${team(G.a)}${team(G.h)}` };
};

// ---------- TRADE CENTER ----------
function tradeOpen(L) { return !(L.phase === 'PLAYOFFS' || (L.phase === 'REGULAR' && L.day > L.tradeDeadline)); }
function descOffer(L, o) {
  const side = (pids, picks) => [...pids.map(id => { const x = E.getP(L, id); return `${esc(x.name)} <span class="muted">(${x.pos} ${R(x.ovr)})</span>`; }), ...picks.map(id => { const k = L.picks.find(z => z.id === id); return k ? `${k.season} Rd ${k.round} pick (${T(k.orig).abbr})` : id; })].join('<br>') || '—';
  return { give: side(o.aPids, o.aPicks), get: side(o.bPids, o.bPicks) };
}
PAGES.trade = () => {
  const L = S.L; const tb = curTab('trade', 'offers'); const offers = L.tradeOffers || [];
  const top = tabs('trade', [['offers', `Offers${offers.length ? ' (' + offers.length + ')' : ''}`], ['block', 'Trade Block'], ['machine', 'Propose'], ['all', 'All Players']], 'offers');
  let body = '';
  const closed = !tradeOpen(L) ? `<div class="card" style="color:var(--q1)">${L.phase === 'PLAYOFFS' ? 'Trades are closed during the playoffs.' : 'The trade deadline has passed. Trades reopen after the season.'}</div>` : '';
  if (tb === 'offers') {
    body = closed + (offers.length ? offers.map(x => { const d = descOffer(L, x.offer); const left = L.phase === 'REGULAR' ? Math.max(0, 14 - (L.day - x.day)) : null;
      return `<div class="card"><div class="row">${disc(x.offer.tidB, 40)}<div class="grow"><div class="nm">${esc(T(x.offer.tidB).city)} ${esc(T(x.offer.tidB).name)}</div><div class="meta">${left != null ? `Expires in ${left} day(s)` : 'Expires at the end of this phase'}</div></div></div>
      <div class="grid2" style="margin-top:8px;font-size:13px"><div><div class="muted">You give</div>${d.give}</div><div><div class="muted">You get</div>${d.get}</div></div>
      <div class="grid3" style="margin-top:8px"><button class="go" data-a="offAccept" data-id="${x.id}">Accept</button><button class="red" data-a="offDecline" data-id="${x.id}">Decline</button><button data-a="offCounter" data-id="${x.id}">Counter</button></div></div>`; }).join('')
      : `<div class="card muted">No trade offers. Put players on your Trade Block and AI teams that need them — usually contenders — will call with offers. Offers expire after two weeks or at the deadline.</div>`);
    const tx = L.transactions.filter(t => t.type === 'trade').slice(0, 10);
    body += `<div class="sect">Recent league trades</div><div class="list">${tx.map(t => `<div class="it" style="font-size:13px">${esc(t.text)}</div>`).join('') || '<div class="it muted">None yet.</div>'}</div>`;
  } else if (tb === 'block') {
    const ps = E.teamPlayers(L, L.userTid).sort((a, b) => b.ovr - a.ovr);
    body = closed + `<div class="muted" style="padding:4px 14px">Tap BLOCK to shop a player. Offers arrive as the season goes on.</div><div class="list">${ps.map(p => playerRow(p, { extra: `<button class="sm ${(L.tradeBlock || []).includes(p.pid) ? 'red' : 'ghost'}" data-a="block" data-pid="${p.pid}">${(L.tradeBlock || []).includes(p.pid) ? 'ON BLOCK' : 'BLOCK'}</button>` })).join('')}</div>
    ${tradeOpen(L) && (L.tradeBlock || []).length ? `<button class="blue" style="width:calc(100% - 20px);margin:10px" data-a="callAround">Call around now</button>` : ''}`;
  } else if (tb === 'machine') body = closed + tradeMachine(L);
  else body = allPlayers(L);
  return { title: 'Trade Center', top, body };
};
function tradeMachine(L) {
  S.trade ||= { tid: (L.userTid + 1) % 29, a: [], ap: [], b: [], bp: [] }; const tr = S.trade;
  const mine = E.teamPlayers(L, L.userTid).sort((a, b) => b.ovr - a.ovr), theirs = E.teamPlayers(L, tr.tid).sort((a, b) => b.ovr - a.ovr);
  const myPicks = L.picks.filter(p => p.tid === L.userTid), thPicks = L.picks.filter(p => p.tid === tr.tid);
  const o = { tidA: L.userTid, tidB: tr.tid, aPids: tr.a, aPicks: tr.ap, bPids: tr.b, bPicks: tr.bp };
  const ev = (tr.a.length + tr.ap.length + tr.b.length + tr.bp.length) ? E.evaluateTrade(L, o) : null;
  const pct = ev && ev.need ? Math.min(100, Math.round(ev.giveV / ev.need * 100)) : 0;
  const chk = (arr, id, side, kind) => `<input type="checkbox" style="width:auto" data-a="tsel" data-side="${side}" data-kind="${kind}" data-id="${id}" ${arr.includes(id) ? 'checked' : ''}>`;
  const prow = (p, side) => `<label class="it">${chk(side === 'a' ? tr.a : tr.b, p.pid, side, 'p')}${avatar(p, 34)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">${p.pos} · ${p.age} · ${M(p.contract?.amt || 0)} · ${yrsLeft(p)}y</div></div>${sq(p.ovr)}</label>`;
  const krow = (k, side) => `<label class="it">${chk(side === 'a' ? tr.ap : tr.bp, k.id, side, 'k')}<div class="grow"><div class="nm">${k.season} Round ${k.round}</div><div class="meta">${T(k.orig).abbr} pick</div></div></label>`;
  return `<div class="card"><div class="muted">Trade partner</div><select data-a="tteam">${L.teams.filter(t => t.tid !== L.userTid).map(t => `<option value="${t.tid}" ${t.tid === tr.tid ? 'selected' : ''}>${esc(t.city)} ${esc(t.name)}</option>`).join('')}</select>
  ${ev ? (() => { const fb = E.tradeFeedback(L, o); return `<div style="margin-top:10px"><div class="agent ${fb.ok ? 'ok' : ''}"><div class="who">${esc(fb.from || T(tr.tid).city + ' GM')}${fb.mode ? ` · ${{ contend: 'Contending', rebuild: 'Rebuilding', middle: 'Middle of the pack' }[fb.mode]}` : ''}</div>${fb.lines.map(l => `<div>${esc(l)}</div>`).join('')}${fb.suggest ? `<button class="sm go" data-a="tAddSuggest" data-kind="${fb.suggest.kind}" data-id="${fb.suggest.id}">Add ${esc(fb.suggest.name)}</button>` : ''}</div>
  ${ev.need ? `<div class="kv" style="margin-top:6px"><span>Deal value</span><b class="${ev.ok ? 'tg' : ''}">${pct}%</b></div><div class="bar"><i style="width:${pct}%;background:${ev.ok ? 'var(--q4)' : 'var(--gold)'}"></i></div>` : ''}</div>`; })() : '<div class="muted" style="margin-top:8px">Pick players and picks from both sides.</div>'}
  <div class="grid2" style="margin-top:10px"><button class="go" data-a="propose" ${ev?.ok && tradeOpen(L) ? '' : 'disabled'}>Propose</button><button data-a="tclear">Clear</button></div></div>
  <div class="sect">You send</div><div class="list">${mine.map(p => prow(p, 'a')).join('')}${myPicks.map(k => krow(k, 'a')).join('')}</div>
  <div class="sect">You receive · ${esc(T(tr.tid).name)}</div><div class="list">${theirs.map(p => prow(p, 'b')).join('')}${thPicks.map(k => krow(k, 'b')).join('')}</div>`;
}
function allPlayers(L) {
  let ps = L.players.filter(p => p.tid >= 0 && p.tid !== L.userTid);
  if (S.apPos !== 'All') ps = ps.filter(p => p.pos === S.apPos);
  if (S.apQ) { const q = S.apQ.toLowerCase(); ps = ps.filter(p => p.name.toLowerCase().includes(q)); }
  ps.sort((a, b) => b.ovr - a.ovr);
  return `<div style="padding:8px 10px"><input data-a="apQ" placeholder="Search players" value="${esc(S.apQ)}"></div>${pillSeg('apPos', ['All', ...E.POS].map(x => [x, x]))}
  <div class="list">${ps.slice(0, 60).map(p => playerRow(p, { meta: `${p.pos} · ${T(p.tid).abbr} · Age ${p.age} · ${M(p.contract?.amt || 0)}` })).join('')}</div>`;
}

// ---------- FREE AGENTS ----------
PAGES.fa = () => {
  const L = S.L; let ps = E.freeAgents(L); const r = E.faRound(L);
  if (S.faPos !== 'All') ps = ps.filter(p => p.pos === S.faPos);
  ps.sort((a, b) => b.ovr - a.ovr);
  const ctx = L.phase === 'REGULAR' ? 'inseason' : 'fa';
  const pr = E.payroll(L, L.userTid), c = E.cap(L);
  const poolBtn = E.faPoolOpen(L) ? `<button class="rb" data-a="goto" data-n="fapool" aria-label="Edit FA pool">${icon('pen', { s: 22 })}</button>` : '';
  return { title: 'Free Agents', right: poolBtn, top: `<div class="caprow"><span>Cap Room <b class="${pr <= c ? 'tg' : 'tr'}">${pr <= c ? M(c - pr) : '−' + M(pr - c)}</b></span><span>Space <b>${E.activeCount(L, L.userTid)}/${E.ROSTER_MAX}</b></span><span>${r ? `Week ${r}/3` : L.phase === 'REGULAR' ? 'In-season' : E.PHASE_LABEL[L.phase]}</span></div>` + pillSeg('faPos', ['All', ...E.POS].map(x => [x, x])),
    body: `<div class="muted" style="padding:2px 14px 6px">${r ? 'Offers are decided at the end of each week.' : L.phase === 'REGULAR' ? 'In-season free agents sign 1-year deals and decide right away.' : 'Free agents decide right away outside free agency weeks.'}</div>
    ${L.phase !== 'REGULAR' && ps.some(p => p.formerTid >= 0) ? `<div style="padding:0 14px 8px"><button class="sm" style="width:100%" data-a="returnFAs">Return free agents to previous teams</button></div>` : ''}
    <div class="list">${ps.slice(0, 80).map(p => playerRow(p, { meta: `${p.pos} · Age ${p.age} · asks ${M(E.askingAmount(L, p, L.userTid, ctx, r || 3))}`, extra: (L.fa?.offers?.[p.pid] || []).some(o => o.tid === L.userTid) ? '<span class="tag" style="background:var(--q4)">OFFER</span>' : '' })).join('') || '<div class="it muted">No free agents.</div>'}</div>` };
};

// ---------- DRAFT ----------
function scoutRank(ps) { return ps.slice().sort((a, b) => (potOf(b) * 0.55 + b.ovr * 0.45) - (potOf(a) * 0.55 + a.ovr * 0.45)); }
function projRound(rank) { return rank < 30 ? 1 : rank < 58 ? 2 : 'UDFA'; }
function teamNeeds(L, tid) {
  const ps = E.teamPlayers(L, tid);
  return E.POS.map(pos => { const b = ps.filter(p => p.pos === pos).sort((a, b) => b.ovr - a.ovr); return { pos, v: (b[0]?.ovr || 40) * 0.7 + (b[1]?.ovr || 40) * 0.3 }; }).sort((a, b) => a.v - b.v).slice(0, 2).map(x => x.pos);
}
function prospectRow(p, rank, onClock) {
  const sl = (S.L.shortlist || []).includes(p.pid);
  return `<div class="it" data-a="player" data-pid="${p.pid}"><b style="width:24px" class="muted">${rank}</b>${avatar(p, 38)}
  <div class="grow"><div class="nm">${sl ? starSvg('full', 14) + ' ' : ''}${esc(p.name)}</div><div class="meta">${p.pos} · ${E.ageNow(S.L, p)}y · ${ht(p.h)} · ${esc(p.college || p.country)}</div><div class="meta">RD ${projRound(rank - 1)} PROJ · ${stars(potOf(p))}</div></div>
  ${onClock ? `<button class="sm go" data-a="draftPick" data-pid="${p.pid}">Draft</button>` : ''}<div class="rt">${hideR(p) ? sq(null) : sq(p.ovr)}</div></div>`;
}
// ---------- fantasy draft room (PGM2 draft-room style) ----------
PAGES.fdraft = () => {
  const L = S.L, D = L.fdraft;
  if (!D) { const F = L.fantasyDraft; return { title: 'Fantasy Draft', body: F?.log ? `<div class="clock"><span>FANTASY DRAFT COMPLETE</span><span></span></div><div class="sect">Your picks</div><div class="list">${F.log.filter(d => d.tid === L.userTid).map(d => { const p = E.getP(L, d.pid); return p ? `<div class="it" data-a="player" data-pid="${p.pid}"><b style="width:34px" class="muted">${d.pick}</b>${avatar(p, 38)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">Rd ${d.round} · ${p.pos} · Age ${p.age}</div></div><div class="rt">${sq(p.ovr)}</div></div>` : ''; }).join('')}</div>` : '<div class="card muted">No fantasy draft running.</div>', cta: `<button class="go" data-a="nav" data-p="team">Go to roster</button>` }; }
  const slot = D.order[D.idx]; const onClock = slot && E.draftControls(L, slot.tid); const all = E.fdAvailable(L);
  let ps = S.draftPos && S.draftPos !== 'All' ? all.filter(p => p.pos === S.draftPos) : all;
  const last = D.log.at(-1), lp = last ? E.getP(L, last.pid) : null; const tb = curTab('fdraft', 'avail');
  const mineN = E.teamPlayers(L, L.userTid).length; const nextMine = D.order.slice(D.idx + (onClock ? 1 : 0)).findIndex(o => E.draftControls(L, o.tid));
  const top = `${last ? `<div class="lastpick">${lp ? avatar(lp, 52) : disc(last.tid, 44)}<div class="grow"><div class="lp-k">LAST PICK · RD ${last.round} #${last.pick} · ${esc(T(last.tid).abbr)}</div><div class="lp-v">${esc(last.name)}</div><div class="muted">${lp ? `${lp.pos} · Age ${lp.age} · ${R(lp.ovr)} OVR` : ''}</div></div></div>` : ''}
   <div class="clock"><span>FANTASY RD ${slot.round} PICK ${slot.pick}</span><span>${onClock ? (slot.tid === L.userTid ? 'YOU ARE ON THE CLOCK' : 'YOU PICK FOR ' + esc(T(slot.tid).abbr)) : esc(T(slot.tid).abbr) + ' ON THE CLOCK'}</span></div>
   <div class="ribbon">${D.order.slice(D.idx, D.idx + 12).map((o, i) => `<div class="${i === 0 ? 'on' : ''} ${E.draftControls(L, o.tid) ? 'me' : ''}">${disc(o.tid, 30)}<small>${o.pick}</small></div>`).join('')}</div>` +
    tabs('fdraft', [['avail', 'Available'], ['mine', `My Team (${mineN})`], ['picked', 'Picked']], 'avail');
  const row = (p, i) => `<div class="it" data-a="player" data-pid="${p.pid}"><b style="width:26px" class="muted">${i + 1}</b>${avatar(p.fdFrom >= 0 ? { ...p, tid: p.fdFrom, numTid: p.fdFrom } : p, 38)}<div class="grow"><div class="nm" style="white-space:normal;line-height:1.2">${esc(p.name)}</div><div class="meta">${p.pos} · ${p.age}y · ${p.contract ? M(p.contract.amt) + '/' + yrsLeft(p) + 'y' : 'no deal'}${p.fdFrom >= 0 ? ' · ' + esc(T(p.fdFrom).abbr) : ''}</div></div>${onClock ? `<button class="sm go" data-a="fdPick" data-pid="${p.pid}">Pick</button>` : ''}<div class="rt">${sq(p.ovr)}</div></div>`;
  let body = '';
  if (tb === 'avail') body = `<div class="muted small" style="padding:4px 14px">${onClock ? 'Your pick — tap Pick, or let the auto-pick choose.' : nextMine >= 0 ? `Your next pick is in ${nextMine} pick${nextMine === 1 ? '' : 's'}.` : 'You have no picks left.'} ${all.length} players left.</div>
    <div class="row" style="padding:4px 10px">${pillSeg('draftPos', ['All', ...E.POS].map(x => [x, x])).replace('class="pill-seg"', 'class="pill-seg" style="flex:1;margin:0"')}</div>
    <div class="list">${ps.slice(0, 60).map((p, i) => row(p, all.indexOf(p))).join('') || '<div class="it muted">Nobody here.</div>'}</div>`;
  else if (tb === 'mine') body = `<div class="list">${E.teamPlayers(L, L.userTid).sort((a, b) => b.ovr - a.ovr).map(p => playerRow(p)).join('') || '<div class="it muted">No picks yet.</div>'}</div>`;
  else body = `<div class="list">${D.log.slice().reverse().slice(0, 80).map(d => `<div class="it ${d.tid === L.userTid ? 'hl' : ''}" data-a="player" data-pid="${d.pid}"><b style="width:34px">${d.pick}</b>${disc(d.tid, 30)}<div class="grow"><div class="nm">${esc(d.name)}</div><div class="meta">${d.pos} · Rd ${d.round}</div></div></div>`).join('') || '<div class="it muted">No picks yet.</div>'}</div>`;
  const cta = onClock ? `<button class="go" data-a="fdPick" data-pid="${all[0]?.pid}">Pick ${esc(all[0]?.name.split(' ').slice(-1)[0] || '')}</button><button class="blue" data-a="fdAutoMe">Auto-pick this pick</button><button class="ghost" style="flex:.6" data-a="fdToMe">${nextMine >= 0 ? 'Auto to my next' : 'Sim rest'}</button>`
    : `<button class="blue" data-a="fdNext">Next Pick</button><button class="go" data-a="fdToMe">${nextMine >= 0 ? 'Sim to My Pick' : 'Sim to End'}</button>`;
  return { title: 'Fantasy Draft', top, body, cta: cta + `<button class="ghost" style="flex:.6" data-a="fdEnd" aria-label="Auto-draft the rest">To End</button>` };
};
PAGES.draft = () => {
  const L = S.L;
  if (L.phase !== 'DRAFT') return draftBoard(L);
  const D = L.draft; const slot = D.order[D.idx]; const onClock = slot && E.draftControls(L, slot.tid); const nextCtl = D.order.slice(D.idx + 1).findIndex(o => E.draftControls(L, o.tid));
  let all = scoutRank(E.prospects(L)); let ps = all;
  if (S.draftPos !== 'All') ps = ps.filter(p => p.pos === S.draftPos);
  if (S.shortOnly) ps = ps.filter(p => (L.shortlist || []).includes(p.pid));
  const lastP = D.log.at(-1); const tb = curTab('draft', 'avail');
  const lp = lastP ? E.getP(L, lastP.pid) : null;
  let top = `${lastP ? `<div class="lastpick">${lp ? avatar(lp, 52) : disc(lastP.tid, 44)}<div class="grow"><div class="lp-k">LAST PICK · RD ${lastP.round} #${lastP.pick}</div><div class="lp-v">${esc(lastP.name)}</div><div class="muted">${lp ? `Age ${lp.age} · ` : ''}${lastP.pos}${lp ? ' · ' + esc(lp.college || lp.country) : ''}</div></div>${lp && !hideR(lp) ? sq(lp.ovr) : ''}<span class="lp-to">→</span>${disc(lastP.tid, 36)}</div>` : ''}
   ${slot ? `<div class="clock"><span>DRAFT RD ${slot.round} PICK ${slot.pick}</span><span>${onClock ? (slot.tid === L.userTid ? 'YOU ARE ON THE CLOCK' : 'YOU PICK FOR ' + esc(T(slot.tid).abbr)) : esc(T(slot.tid).abbr) + ' ON THE CLOCK'}</span></div>
   <div class="ribbon">${D.order.slice(D.idx, D.idx + 12).map((o, i) => `<div class="${i === 0 ? 'on' : ''} ${o.tid === L.userTid ? 'me' : ''}">${disc(o.tid, 30)}<small>${o.pick}</small></div>`).join('')}</div>` : `<div class="clock"><span>DRAFT COMPLETE</span><span></span></div>`}` +
    tabs('draft', [['avail', 'Available'], ['upcoming', 'Upcoming Picks'], ['picked', 'Picked']], 'avail');
  let body = '';
  if (tb === 'avail') {
    const best = all[0];
    if (onClock && slot.tid === L.userTid) { const offs = E.clockOffers(L); S.clockOffs = offs;
      if (offs.length) body += `<div class="sect">Offers for your pick</div>${offs.map((o, i) => `<div class="card"><div class="row">${disc(o.tidB, 34)}<div class="grow" style="font-size:13px">${esc(T(o.tidB).name)} offer ${o.bPicks.map(id => { const k = L.picks.find(z => z.id === id); return `${k.season} Rd ${k.round} (${T(k.orig).abbr})`; }).join(' + ')}</div><button class="sm go" data-a="clockAccept" data-i="${i}">Accept</button></div></div>`).join('')}`; }
    if (best) body += `<div class="sect">Best player available</div><div class="list">${prospectRow(best, 1, onClock)}</div>`;
    body += `<div class="row" style="padding:4px 10px">${pillSeg('draftPos', ['All', ...E.POS].map(x => [x, x])).replace('class="pill-seg"', 'class="pill-seg" style="flex:1;margin:0"')}<button class="sm ${S.shortOnly ? 'blue' : 'ghost'}" data-a="shortOnly" aria-label="Shortlist only">${starSvg('full', 16)}</button></div>
    <div class="list">${ps.slice(0, 70).map(p => prospectRow(p, all.indexOf(p) + 1, onClock)).join('') || '<div class="it muted">Nobody here.</div>'}</div>`;
  } else if (tb === 'upcoming') body = `<div class="list">${D.order.slice(D.idx, D.idx + 30).map(o => `<div class="it ${o.tid === L.userTid ? 'hl' : ''}"><b style="width:30px">${o.pick}</b>${disc(o.tid, 30)}<div class="grow"><div class="nm">${esc(T(o.tid).name)}</div><div class="meta">Rd ${o.round} · needs ${teamNeeds(L, o.tid).join(', ')}</div></div></div>`).join('')}</div>`;
  else body = `<div class="list">${D.log.slice().reverse().map(d => `<div class="it" data-a="player" data-pid="${d.pid}"><b style="width:30px">${d.pick}</b>${disc(d.tid, 30)}<div class="grow"><div class="nm">${esc(d.name)}</div><div class="meta">${d.pos} · Rd ${d.round}</div></div></div>`).join('') || '<div class="it muted">No picks yet.</div>'}</div>`;
  const cta = slot ? (onClock ? `<button class="go" data-a="draftPick" data-pid="${all[0]?.pid}">Draft ${esc(all[0]?.name.split(' ').slice(-1)[0] || '')}</button><button class="blue" data-a="draftAutoOne">Auto-pick this pick</button>` : `<button class="blue" data-a="draftNext">Next Pick</button>`) + `<button class="go" style="flex:.8" data-a="draftToMe">${nextCtl >= 0 || !onClock ? 'Auto to my next' : 'Sim rest'}</button><button class="ghost" style="flex:.5" data-a="draftAuto" aria-label="Sim rest of draft">Sim rest</button>` : `<button class="go" data-a="advance">Re-sign Players</button>`;
  return { title: 'Draft', top, body, cta };
};
function draftBoard(L) { // pre-draft scouting board (any phase)
  const year = L.season; let ps = scoutRank(L.players.filter(p => p.tid === -2 && p.draft?.year === year)); const all = ps;
  if (S.draftPos !== 'All') ps = ps.filter(p => p.pos === S.draftPos);
  if (S.shortOnly) ps = ps.filter(p => (L.shortlist || []).includes(p.pid));
  const mine = L.picks.filter(k => k.tid === L.userTid && k.season === year);
  return { title: 'Draft', top: `<div class="clock"><span>${year} DRAFT CLASS</span><span>${mine.length ? 'YOUR PICKS: ' + mine.map(k => 'RD ' + k.round).join(', ') : 'NO PICKS'}</span></div>`,
    body: `<div class="muted" style="padding:6px 14px">Head scout accuracy ${scoutAcc()}/100. Star ratings are scouted potential — busts and late bloomers happen. Tap the star on a player to shortlist him.</div>
    <div class="row" style="padding:4px 10px">${pillSeg('draftPos', ['All', ...E.POS].map(x => [x, x])).replace('class="pill-seg"', 'class="pill-seg" style="flex:1;margin:0"')}<button class="sm ${S.shortOnly ? 'blue' : 'ghost'}" data-a="shortOnly" aria-label="Shortlist only">${starSvg('full', 16)}</button></div>
    <div class="list">${ps.slice(0, 70).map(p => prospectRow(p, all.indexOf(p) + 1, false)).join('') || '<div class="it muted">Nobody here.</div>'}</div>` };
}

// ---------- LEAGUE ----------
PAGES.league = () => {
  const L = S.L; const tb = curTab('league', 'standings');
  const top = tabs('league', [['standings', 'Standings'], ['tstat', 'Team Stat'], ['pstat', 'Player Stat'], ['records', 'Records'], ['playoffs', 'Playoffs'], ['awards', 'Awards'], ['history', 'History'], ['hof', 'Hall of Fame'], ['news', 'News'], ['tx', 'Transactions']], 'standings');
  const f = { standings: standingsTab, tstat: teamStatTab, pstat: playerStatTab, records: recordsTab, playoffs: playoffsTab, awards: awardsTab, history: historyTab, hof: hofTab, news: newsTab, tx: txTab }[tb];
  return { title: 'League', top, body: f(L) };
};
function standingsTab(L) {
  const rec = E.standings(L);
  return ['E', 'W'].map(c => { const seeds = E.confSeeds(L, c, rec); return `<div class="sect">${c === 'E' ? 'Eastern' : 'Western'} Conference</div><div class="tscroll"><table><tr><th>#</th><th class="l">Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>DIFF</th><th>L10</th><th>STRK</th></tr>
  ${seeds.map((r, i) => { const gb = ((seeds[0].w - r.w) + (r.l - seeds[0].l)) / 2; return `<tr class="${r.tid === L.userTid ? 'hl' : ''}" style="${i === 8 ? 'border-top:2px solid var(--hdr)' : ''}" data-a="teamPage" data-tid="${r.tid}"><td>${i + 1}</td><td class="l">${esc(T(r.tid).name)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.pct.toFixed(3).replace(/^0/, '')}</td><td>${gb ? gb.toFixed(1) : '-'}</td><td>${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)}</td><td>${r.l10}</td><td>${r.streak}</td></tr>`; }).join('')}</table></div>`; }).join('') + '<div class="muted" style="padding:6px 14px">Division winners are guaranteed a top-4 seed (1996-97 rules). Top 8 per conference make the playoffs. Tap a team to view it.</div>';
}
function teamStatTab(L) {
  const rows = L.teams.map(t => { const ps = E.teamPlayers(L, t.tid); const s = { gp: 0, pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 }; for (const p of ps) { const r = p.stats.reg; s.pts += r.pts; s.reb += rebOf(r); s.ast += r.ast; s.fgm += r.fgm; s.fga += r.fga; s.tpm += r.tpm; s.tpa += r.tpa; }
    const rec = E.standings(L)[t.tid]; const gp = rec.gp || 0; return { t, gp, ppg: gp ? rec.pf / gp : 0, opp: gp ? rec.pa / gp : 0, rpg: gp ? s.reb / gp : 0, apg: gp ? s.ast / gp : 0, fg: s.fga ? s.fgm / s.fga : 0, tp: s.tpa ? s.tpm / s.tpa : 0 }; });
  const k = S.tstatSort || 'ppg'; rows.sort((a, b) => k === 'opp' ? a.opp - b.opp : b[k] - a[k]);
  const th = (key, l) => `<th data-a="setS" data-k="tstatSort" data-v="${key}" style="${k === key ? 'color:var(--hdr)' : ''}">${l}</th>`;
  return `<div class="tscroll"><table><tr><th class="l">Team</th>${th('ppg', 'PPG')}${th('opp', 'OPP')}${th('rpg', 'RPG')}${th('apg', 'APG')}${th('fg', 'FG%')}${th('tp', '3P%')}</tr>${rows.map(r => `<tr class="${r.t.tid === L.userTid ? 'hl' : ''}" data-a="teamPage" data-tid="${r.t.tid}"><td class="l">${r.t.abbr}</td><td>${r.ppg.toFixed(1)}</td><td>${r.opp.toFixed(1)}</td><td>${r.rpg.toFixed(1)}</td><td>${r.apg.toFixed(1)}</td><td>${(r.fg * 100).toFixed(1)}</td><td>${(r.tp * 100).toFixed(1)}</td></tr>`).join('')}</table></div>`;
}
function playerStatTab(L) {
  const minG = Math.max(1, Math.min(20, L.schedule.filter(g => g.played).length / 29 * 0.5));
  let ps = L.players.filter(p => p.tid >= 0 && p.stats.reg.gp >= minG); if (S.statPos !== 'All') ps = ps.filter(p => p.pos === S.statPos); if (+S.statExp) ps = ps.filter(p => expYr(L, p) === +S.statExp);
  const k = S.pstatSort || 'pts'; const val = (p) => { const s = p.stats.reg; return k === 'fnt' ? E.fantasy(s) / s.gp : k === 'reb' ? rebOf(s) / s.gp : k === 'fg' ? (s.fga / s.gp >= 5 ? s.fgm / s.fga * 100 : 0) : s[k] / s.gp; };
  ps = ps.map(p => ({ p, v: val(p) })).sort((a, b) => b.v - a.v).slice(0, 50);
  const th = (key, l) => `<button class="${k === key ? 'on' : ''}" data-a="setS" data-k="pstatSort" data-v="${key}">${l}</button>`;
  return `${pillSeg('statPos', ['All', ...E.POS].map(x => [x, x]))}${pillSeg('statExp', [[0, 'All'], [1, 'Rookie'], [2, '2nd'], [3, '3rd'], [4, '4th'], [5, '5th']])}<div class="pill-seg">${th('pts', 'PTS')}${th('reb', 'REB')}${th('ast', 'AST')}${th('stl', 'STL')}${th('blk', 'BLK')}${th('fg', 'FG%')}${th('fnt', 'FntPt')}</div>
  <div class="list">${ps.map((x, i) => `<div class="it" data-a="player" data-pid="${x.p.pid}"><b style="width:22px" class="muted">${i + 1}</b>${avatar(x.p, 34)}<div class="grow"><div class="nm">${esc(x.p.name)}</div><div class="meta">${x.p.pos} · ${T(x.p.tid).abbr} · ${x.p.stats.reg.gp} GP</div></div><b>${x.v.toFixed(1)}</b></div>`).join('') || '<div class="it muted">No games played yet.</div>'}</div>`;
}
function recordsTab(L) {
  const g = L.records.game, s = L.records.season;
  const careers = L.players.filter(p => p.career.length).map(p => ({ p, t: E.careerTotals(p) }));
  const top = (k) => careers.sort((a, b) => b.t[k] - a.t[k]).slice(0, 5);
  return `<div class="sect">Single game (since 1996-97)</div><div class="card">${['pts', 'reb', 'ast'].map(k => g[k] ? `<div class="kv"><span>${k.toUpperCase()}</span><b>${g[k].v} · ${esc(g[k].name)} (${g[k].season})</b></div>` : '').join('') || '<div class="muted">No games yet.</div>'}</div>
  <div class="sect">Season averages</div><div class="card">${['pts', 'reb', 'ast', 'stl', 'blk'].map(k => s[k] ? `<div class="kv"><span>${k.toUpperCase()}/G</span><b>${s[k].v} · ${esc(s[k].name)} (${s[k].season})</b></div>` : '').join('') || '<div class="muted">After the first season.</div>'}</div>
  ${['pts', 'reb', 'ast'].map(k => `<div class="sect">Career ${k.toUpperCase()} (this league)</div><div class="list">${top(k).map(x => `<div class="it" data-a="player" data-pid="${x.p.pid}"><div class="grow nm">${esc(x.p.name)}</div><b>${x.t[k]}</b></div>`).join('') || '<div class="it muted">—</div>'}</div>`).join('')}`;
}
function playoffsTab(L) {
  const P = L.playoffs; if (!P) return `<div class="card muted">Playoffs begin after the regular season. Top 8 per conference qualify; round 1 is best-of-5, then best-of-7.</div>`;
  return [1, 2, 3, 4].filter(r => P.series.some(s => s.round === r)).map(r => `<div class="sect">${['First Round', 'Conference Semifinals', 'Conference Finals', 'Finals'][r - 1]}</div>${seriesList(P.series.filter(s => s.round === r))}`).join('') + (P.champ != null ? `<div class="card center">${disc(P.champ, 56)}<div class="big">${esc(T(P.champ).name)}</div><div class="muted">Champions</div></div>` : '');
}
function awardsTab(L) {
  const pow = (L.pow || []).filter(x => x.season === L.season).slice(0, 30);
  const h = L.history.at(-1);
  return `<div class="sect">Player of the Week · ${seasonLbl(L.season)}</div><div class="list">${pow.map(x => `<div class="it" data-a="player" data-pid="${x.pid}">${disc(x.tid, 30)}<div class="grow"><div class="nm">${esc(x.name)}</div><div class="meta">Week ${x.week} · ${x.conf === 'E' ? 'East' : 'West'}</div></div></div>`).join('') || '<div class="it muted">Awarded weekly during the regular season.</div>'}</div>
  ${h ? `<div class="sect">${seasonLbl(h.season)} season awards</div><div class="card">${[['mvp', 'MVP'], ['fmvp', 'Finals MVP'], ['dpoy', 'Defensive POY'], ['roy', 'Rookie of the Year'], ['sixth', 'Sixth Man'], ['mip', 'Most Improved']].map(([k, l]) => h.awards[k] ? `<div class="kv"><span>${l}</span><b data-a="player" data-pid="${h.awards[k].pid}">${esc(h.awards[k].name)}</b></div>` : '').join('')}</div>` : ''}`;
}
function historyTab(L) {
  const H = L.history.slice().reverse();
  return `<div class="tscroll"><table><tr><th>Season</th><th class="l">Champion</th><th class="l">MVP</th><th class="l">ROY</th></tr>${H.map(h => `<tr><td>${seasonLbl(h.season)}</td><td class="l">${esc(T(h.champ).name)}</td><td class="l">${esc(h.awards.mvp?.name || '')}</td><td class="l">${esc(h.awards.roy?.name || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="l muted">History is written at the end of each season.</td></tr>'}</table></div>`;
}
function hofTab(L) {
  let hof = L.hof.slice().reverse(); if (S.hofMine) hof = hof.filter(h => (h.tids || []).includes(L.userTid));
  const watch = E.hofWatch(L, 12);
  return `<div class="row" style="padding:6px 10px"><b class="grow">Inductees (${hof.length})</b><button class="sm ${S.hofMine ? 'blue' : 'ghost'}" data-a="hofMine">My team only</button></div>
  <div class="list">${hof.map(h => `<div class="it" data-a="player" data-pid="${h.pid}"><span class="tag" style="background:var(--gold)">HOF</span><div class="grow"><div class="nm">${esc(h.name)}</div><div class="meta">Inducted ${h.season} · ${h.score}% HOF probability</div></div></div>`).join('') || '<div class="it muted">No inductees yet. Retired players are inducted when their Hall of Fame probability (honors, titles, career value) is 50%+.</div>'}</div>
  <div class="sect">Hall of Fame watch (active)</div><div class="list">${watch.map(x => `<div class="it" data-a="player" data-pid="${x.p.pid}">${avatar(x.p, 32)}<div class="grow"><div class="nm">${esc(x.p.name)}</div><div class="meta">${x.p.tid >= 0 ? T(x.p.tid).abbr : 'FA'} · Age ${x.p.age}</div></div><div style="width:90px"><div class="bar"><i style="width:${x.s}%;background:var(--gold)"></i></div><div class="meta center">${x.s}% chance</div></div></div>`).join('')}</div>`;
}
function newsTab(L) { return `<div class="list">${L.news.slice(0, 120).map(n => `<div class="it"><div class="grow"><div style="font-size:13px">${esc(n.text)}</div><div class="meta">${seasonLbl(n.season)}${n.day ? ' · ' + E.dateOf(L, n.day) : ''}</div></div>${n.tid != null && n.tid >= 0 ? disc(n.tid, 26) : ''}</div>`).join('')}</div>`; }
function txTab(L) { return `<div class="list">${L.transactions.slice(0, 150).map(t => `<div class="it"><div class="grow" style="font-size:13px">${esc(t.text)}<div class="meta">${seasonLbl(t.season)} · ${t.type}</div></div></div>`).join('') || '<div class="it muted">No transactions yet.</div>'}</div>`; }

// ---------- WORLD ----------
PAGES.world = () => {
  const L = S.L; const W = E.worldClasses(L); const yr = S.worldYear ?? W[0].year; const C = W.find(w => w.year === yr) || W[0];
  let ps = scoutRank(C.players); const all = ps; if (S.draftPos !== 'All') ps = ps.filter(p => p.pos === S.draftPos);
  return { title: 'World', top: `<div class="pill-seg" style="margin-top:8px">${W.map(w => `<button class="${w.year === C.year ? 'on' : ''}" data-a="setS" data-k="worldYear" data-v="${w.year}">${w.year}</button>`).join('')}</div>`,
    body: `<div class="card"><div class="row"><div class="sq big ${C.grade <= 'B' ? 'q5' : C.grade === 'C' ? 'q3' : 'q1'}" style="min-width:52px;height:52px;font-size:26px">${C.grade}</div><div class="grow"><div style="font-weight:800">${C.year} draft class</div><div class="muted">${C.n} prospects · ${C.year === L.season ? 'this year' : `${C.year - L.season} yr(s) away`} · class quality ${C.quality}</div></div></div>
    <div class="muted" style="margin-top:6px">College and international players who will enter future drafts. Ratings shown are today's; they keep developing until draft day.</div></div>
    ${pillSeg('draftPos', ['All', ...E.POS].map(x => [x, x]))}<div class="list">${ps.slice(0, 50).map(p => prospectRow(p, all.indexOf(p) + 1, false)).join('')}</div>` };
};

// ---------- GM ----------
PAGES.gm = () => {
  const L = S.L; const g = L.gm; const tb = curTab('gm', 'profile');
  const top = `<div class="thead" style="justify-content:flex-start;gap:14px">${disc(L.userTid, 56)}<div><div style="font-weight:800;font-size:18px">${esc(g.name)}</div><div class="muted">${g.archetype} · ${E.repLabel(g.reputation ?? 40)} (${g.reputation ?? 40})</div><div class="muted">${g.seasonsRun} season(s) · ${g.titles} title(s)</div></div></div>` +
    tabs('gm', [['profile', 'Profile'], ['owner', 'Owner'], ['ach', 'Achievements'], ['career', 'Career'], ['jobs', 'Jobs']], 'profile');
  let body = '';
  if (tb === 'profile') body = `<div class="card"><div class="kv"><span>Reputation</span><b>${g.reputation ?? 40} · ${E.repLabel(g.reputation ?? 40)}</b></div><div class="bar"><i style="width:${g.reputation ?? 40}%;background:var(--hdr)"></i></div>
    <div class="kv"><span>Legacy score</span><b>${g.legacy}</b></div><div class="kv"><span>Championships</span><b>${g.titles}</b></div><div class="kv"><span>Trades made</span><b>${g.trades || 0}</b></div><div class="kv"><span>Teams</span><b>${(g.teams || [L.userTid]).map(t => T(t).abbr).join(' → ')}</b></div>
    <div class="kv"><span>Achievements</span><b>${Object.keys(L.achievements || {}).length}/${E.ACHIEVEMENTS.length}</b></div><div class="muted" style="margin-top:6px">${esc(E.ARCHETYPES[g.archetype])}</div></div>`;
  else if (tb === 'owner') body = ownerCard(L) + `<div class="card muted">Each preseason the owner sets one non-negotiable goal. Meeting or beating it raises job security; missing it badly can get you fired.</div>`;
  else if (tb === 'ach') { const got = L.achievements || {}; body = `<div class="list">${E.ACHIEVEMENTS.map(([id, n, d]) => `<div class="it ach ${got[id] ? 'got' : ''}"><span style="font-size:22px">${got[id] ? icon('medal', { s: 24 }) : icon('lock', { s: 22 })}</span><div class="grow"><div class="nm">${esc(n)}</div><div class="meta">${esc(d)}${got[id] ? ` · ${seasonLbl(got[id])}` : ''}</div></div></div>`).join('')}</div>`; }
  else if (tb === 'career') body = `<div class="tscroll"><table><tr><th>Season</th><th>Team</th><th>W-L</th><th class="l">Goal</th><th>Grade</th></tr>${g.history.slice().reverse().map(h => `<tr><td>${seasonLbl(h.season)}</td><td>${T(h.tid).abbr}</td><td>${h.w}-${h.l}</td><td class="l" style="font-size:11px">${esc(h.goal)}${h.champ ? ' 🏆' : ''}</td><td><b>${h.grade}</b></td></tr>`).join('') || '<tr><td colspan="5" class="l muted">First season in progress.</td></tr>'}</table></div>`;
  else { const jm = L.gm.fired ? E.jobMarket(L) : (L.jobMarket || []); const rec = E.standings(L);
    body = `<div class="card">${L.gm.fired ? 'You were fired. These teams will talk to you.' : jm.length ? 'Your reputation has attracted interest. Stay — or take over an underperforming franchise.' : 'No openings right now. Teams come calling after the season, based on your reputation.'}</div>
    <div class="list">${jm.map(tid => `<div class="it">${disc(tid, 40)}<div class="grow"><div class="nm">${esc(T(tid).city)} ${esc(T(tid).name)}</div><div class="meta">${rec[tid].w}-${rec[tid].l} · OVR ${R(E.teamOvr(L, tid))}</div></div><button class="sm go" data-a="takeJob" data-tid="${tid}">Join</button></div>`).join('')}</div>`; }
  return { title: 'GM', top, body };
};

// ---------- MESSAGES ----------
PAGES.messages = () => {
  const L = S.L; const f = S.msgFilter || 'all';
  const list = L.inbox.filter(m => f === 'all' || (f === 'imp' ? m.pri === 'high' || (!m.read && m.pri !== 'low') : !m.read));
  const unread = L.inbox.filter(m => !m.read).length;
  const row = (m) => `<div class="it msg ${m.read ? '' : 'unread'} ${m.pri === 'high' ? 'hi' : m.pri === 'low' ? 'lo' : ''}" data-a="readMsg" data-id="${m.id}"><div class="grow"><div class="row sp"><span class="nm">${m.pri === 'high' ? '<span class="pdot"></span>' : ''}${esc(m.subject)}</span><span class="meta">${m.day ? E.dateOf(L, m.day).replace(/, \d{4}$/, '') : seasonLbl(m.season)}</span></div><div class="meta">${esc(m.from)}${m.lines?.length > 1 ? ` · ${m.lines.length} items` : ''}</div>${S.openMsg === m.id ? `<div class="body" style="white-space:pre-wrap;margin-top:6px">${esc(m.body)}</div>` : m.lines?.length > 1 ? `<div class="muted prev">${esc(m.lines[m.lines.length - 1])}</div>` : ''}</div></div>`;
  return { title: 'Messages', right: unread ? `<button class="rb" data-a="readAll">Mark all read</button>` : '',
    body: `<div class="pill-seg">${[['all', 'All'], ['imp', 'Important'], ['unread', `Unread${unread ? ' · ' + unread : ''}`]].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-a="msgFilter" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="muted" style="padding:2px 14px 6px">Routine updates (minor injuries, recoveries, other teams' signings) are grouped into digests and arrive already read.</div>
    <div class="list">${list.map(row).join('') || '<div class="it muted">Nothing here.</div>'}</div>` };
};

// ---------- SETTINGS ----------
PAGES.settings = () => {
  const L = S.L; const st = L.settings;
  const sel = (k, opts) => `<select data-set="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(st[k]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  return { title: 'Settings', body: `<div class="sect">Save</div><div class="card"><div class="kv"><span>Slot</span><b>${S.slot}</b></div><div class="grid2" style="margin-top:8px"><button class="go" data-a="saveNow">Save now</button><button data-a="export">Export backup</button><button data-a="exportRoster">Export roster file</button></div></div>
  <div class="sect">Franchise</div><div class="card"><div class="muted">Salary cap ${({ soft: 'Soft', hard: 'Hard', off: 'Off' })[st.capMode] || 'Soft'} · CPU trades ${st.cpuTrades ? 'On' : 'Off'} · ${st.seasonGames || 82} games · ${st.playoffTeams || 16}-team playoffs · ${st.draftClasses === 'real' ? 'Real drafts' : 'Generated drafts'}</div><button class="go" style="width:100%;margin-top:8px" data-a="goto" data-n="franchise">Franchise Settings</button></div>
  <div class="sect">Difficulty sliders</div><div class="card"><div class="grid2">
   <div><div class="muted">Trades / owner</div>${sel('difficulty', [['Easy', 'Easy'], ['Medium', 'Medium'], ['Hard', 'Hard']])}</div>
   <div><div class="muted">Injuries</div>${sel('injuries', [[0, 'Off'], [0.5, 'Low'], [1, 'Normal'], [1.6, 'High']])}</div>
   <div><div class="muted">Development</div>${sel('devVisibility', [['All', 'Show all'], ['Own', 'Own team'], ['Hidden', 'Hidden']])}</div>
   <div><div class="muted">Rookie ratings</div>${sel('hideRookieRatings', [[false, 'Visible'], [true, 'Hidden']])}</div>
   <div><div class="muted">Staff budget</div>${sel('staffCap', [[false, 'Off'], [true, 'On']])}</div>
   <div><div class="muted">Theme</div><button style="width:100%" data-a="dark">${document.documentElement.classList.contains('dark') ? 'Light' : 'Dark'}</button></div></div></div>
  <div class="card muted">Hardwood GM (working title). Unofficial fan project; not affiliated with the NBA/NBPA or any app maker. Player facts from Kaggle "NBA Players" (Justinas Cirtautas; NBA Stats API data). Ratings, contracts and careers after 1996-97 are this game's own simulation. Team names are text only.</div>`,
    cta: `<button class="ghost" data-a="quit">Main Menu</button>` };
};


// ---------- FRANCHISE SETTINGS (2K MyLeague-style) ----------
const FS_NOTE = { careers: 'Real: real players follow their real NBA careers (rise, peak, decline, retirement; 1996-97 to 2020-21 facts) with small random variation. Editing a player’s ratings takes him off his real arc.', seasonGames: 'Applies from the next schedule (next preseason).', playoffTeams: 'Applies at the next playoffs.', r1Len: 'Applies at the next playoffs.', rosterMin: 'AI teams refill to the minimum; you get a warning.', draftClasses: 'Applies to classes not created yet (about 3 seasons ahead are already scouted).', histTendency: 'Only used when Player careers is Random: how strongly real draftees lean toward their real careers.', realHistory: 'Relocations, expansion, lockouts and rule changes on the real timeline.' };
function fsGroups(vals, attr) {
  const groups = [...new Set(E.FS_META.map(m => m[3]))];
  return groups.map(g => `<div class="sect">${g}</div><div class="card"><div class="grid2">${E.FS_META.filter(m => m[3] === g).map(([k, label, opts]) =>
    `<div><div class="muted">${label}</div><select ${attr}="${k}" aria-label="${label}">${opts.map(([v, t]) => `<option value="${v}" ${String(vals[k] ?? E.FS_DEFAULTS[k]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>${FS_NOTE[k] ? `<div class="muted small">${FS_NOTE[k]}</div>` : ''}</div>`).join('')}</div></div>`).join('');
}
// ---------- draft class manager ----------
const DC_KEY = 'hgm-dc-presets';
const dcPresets = () => { try { return JSON.parse(localStorage.getItem(DC_KEY) || '[]'); } catch { return []; } };
const dcSave = (a) => localStorage.setItem(DC_KEY, JSON.stringify(a));
// global custom classes: one edit per draft year, stored on the device outside any save, applied to every franchise
const DCG_KEY = 'hgm-dc-global';
function dcGlobal() { try { const o = JSON.parse(localStorage.getItem(DCG_KEY) || '{}'); return E.validateGlobal(o).ok ? o : {}; } catch { return {}; } }
function dcGSave(o) { for (const [y, g] of Object.entries(o)) if (!g.prospects.length && !(g.remove || []).length && g.mode !== 'replace') delete o[y]; localStorage.setItem(DCG_KEY, JSON.stringify(o)); if (S.L) S.L.dcGlobal = o; }
PAGES.dcglobal = () => {
  const G = dcGlobal(); const y = S.dcgYear || 1984; S.dcgYear = y; const g = G[y] || { name: `Custom ${y} class`, mode: 'merge', prospects: [], remove: [] };
  const real = E.realClass(DATA, y); const rm = new Set((g.remove || []).map(n => n.toLowerCase()));
  const yrs = []; for (let v = 2036; v >= 1947; v--) yrs.push(v);
  const used = S.L && (S.L.dcApplied?.[y] || S.L.players.some(p => p.draft?.year === y && p.tid !== -2) || y < S.L.season);
  return { title: 'Custom Draft Classes', body: `<div class="muted" style="padding:2px 14px 6px">Edits here are saved on this device, outside any one save, and apply automatically to every franchise (new or existing) that reaches that draft.</div>
  <div class="card"><div class="muted">Draft year</div><select data-a="dcgYear" aria-label="Draft year">${yrs.map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${v} draft${G[v] ? ' ✎' : ''}</option>`).join('')}</select>
   <div class="muted" style="margin-top:8px">Mode</div><select data-a="dcgMode" aria-label="Mode"><option value="merge" ${g.mode !== 'replace' ? 'selected' : ''}>Merge: real class + my edits</option><option value="replace" ${g.mode === 'replace' ? 'selected' : ''}>Replace: only my prospects</option></select>
   ${used ? `<div class="muted small" style="margin-top:6px">The ${y} draft is already set in this save; the edit applies to other franchises.</div>` : ''}</div>
  <div class="sect">Add a player to the ${y} class</div><div class="card"><div class="grid2"><input id="dcgName" maxlength="40" placeholder="Name" aria-label="Name"><select id="dcgPos" aria-label="Position">${['PG', 'SG', 'SF', 'PF', 'C'].map(v => `<option>${v}</option>`).join('')}</select>
   <input id="dcgAge" type="number" min="17" max="30" value="21" aria-label="Age on draft night"><input id="dcgOvr" type="number" min="40" max="99" value="60" aria-label="OVR"></div>
   <div class="muted small" style="margin-top:4px">Age on draft night · starting OVR (40-99)</div><button class="sm go" style="margin-top:8px" data-a="dcgAdd">Add to ${y}</button></div>
  <div class="sect">My additions (${g.prospects.length})</div><div class="list">${g.prospects.map((r, i) => `<div class="it"><div class="grow"><div class="nm">${esc(r.name)} <span class="tag">custom</span></div><div class="meta">${r.pos || ''} · Age ${r.draftAge ?? '?'}${r.ovr ? ` · OVR ${r.ovr}` : ''}</div></div><button class="sm ghost" data-a="dcgDel" data-i="${i}" aria-label="Remove ${esc(r.name)}">${icon('trash', { s: 18 })}</button></div>`).join('') || '<div class="it"><div class="muted">None yet.</div></div>'}</div>
  <div class="sect">Real ${y} class (${real.length})${g.mode === 'replace' ? ' · not used' : ''}</div><div class="list">${real.slice(0, 120).map(r => `<div class="it"><div class="grow"><div class="nm" ${rm.has(r.name.toLowerCase()) ? 'style="text-decoration:line-through;opacity:.5"' : ''}>${esc(r.name)}</div><div class="meta">${r.pick ? `R${r.round} #${r.pick}` : 'Undrafted'} · ${r.pos || ''} · ${esc(r.college || '')}</div></div><button class="sm ghost" data-a="dcgTog" data-n="${esc(r.name)}">${rm.has(r.name.toLowerCase()) ? 'Restore' : 'Remove'}</button></div>`).join('') || '<div class="it"><div class="muted">No real class on file (generated draft).</div></div>'}</div>` };
};
PAGES.dclass = () => {
  const L = S.L; const ys = E.classYears(L); const y = ys.includes(S.dcYear) ? S.dcYear : ys[0]; S.dcYear = y;
  const ps = E.classOf(L, y).sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0) || b.pot - a.pot); const pre = dcPresets();
  return { title: 'Draft Classes', body: `<div class="card"><div class="muted">Draft</div><select data-a="dcYear" aria-label="Draft year">${ys.map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${v} draft${L.dcReplace?.[v] ? ' (custom class)' : ''}</option>`).join('')}</select>
   <div class="muted small" style="margin-top:6px">${ps.length ? `${ps.length} prospects so far${ps.some(p => p.custom) ? ` · ${ps.filter(p => p.custom).length} custom` : ''}.` : 'Not generated yet: the real/generated class is added when that season starts. Custom prospects you add now stay in it.'}</div>
   <button class="sm" style="margin-top:8px" data-a="goto" data-n="dcglobal">Edit any year's class for all franchises</button>
   <div class="grid2" style="margin-top:8px"><input id="dcName" maxlength="40" placeholder="New prospect name" aria-label="Prospect name"><button class="sm go" data-a="dcAdd">Add & edit</button></div></div>
  <div class="sect">Presets on this device</div><div class="card"><div class="grid2"><input id="dcPreset" maxlength="60" placeholder="Preset name" aria-label="Preset name"><button class="sm" data-a="dcSavePreset">Save class as preset</button></div>
   <div class="row" style="gap:8px;margin-top:8px"><button class="sm" data-a="dcImport">Import JSON</button><input type="file" id="dcFile" accept=".json,application/json" style="display:none"></div>
   ${pre.length ? `<div class="list" style="margin-top:8px">${pre.map((c, i) => `<div class="it"><div class="grow"><div class="nm">${esc(c.name)}</div><div class="meta">${c.prospects.length} prospects</div>
     <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap"><button class="sm go" data-a="dcLoad" data-i="${i}" data-m="replace">Replace ${y}</button><button class="sm" data-a="dcLoad" data-i="${i}" data-m="merge">Merge into ${y}</button><button class="sm" data-a="dcExport" data-i="${i}">Export</button><button class="sm ghost" data-a="dcDelPreset" data-i="${i}" aria-label="Delete preset">${icon('trash', { s: 18 })}</button></div></div></div>`).join('')}</div>` : '<div class="muted small" style="margin-top:8px">No presets yet.</div>'}</div>
  <div class="sect">${y} prospects</div><div class="list">${ps.slice(0, 80).map(p => `<div class="it">${avatar(p, 36)}<div class="grow" style="min-height:44px;display:flex;flex-direction:column;justify-content:center" data-a="player" data-pid="${p.pid}"><div class="nm">${esc(p.name)}${p.custom ? ' <span class="tag">custom</span>' : ''}</div><div class="meta">${p.pos} · Age ${p.age} · Pot ${R(p.pot)}</div></div>${sq(p.ovr)}<button class="sm ghost" data-a="dcEdit" data-pid="${p.pid}" aria-label="Edit ${esc(p.name)}">${icon('pen', { s: 18 })}</button><button class="sm ghost" data-a="dcDel" data-pid="${p.pid}" aria-label="Remove ${esc(p.name)}">${icon('trash', { s: 18 })}</button></div>`).join('') || '<div class="it"><div class="muted">No prospects yet.</div></div>'}</div>` };
};
PAGES.franchise = () => {
  const L = S.L; E.ensureSettings(L);
  return { title: 'Franchise Settings', body: `<div class="muted" style="padding:2px 14px 6px">Commissioner rules for this save. Changes take effect right away unless noted.</div>${fsGroups(L.settings, 'data-set')}
  <div class="sect">Create Player</div><div class="card"><div class="muted small">Make a fully custom player, then edit everything about him — team, position, number, size, every rating, potential and peak, dev trait, contract.</div>
   <div class="grid2" style="margin-top:8px"><div><div class="muted">Name</div><input id="cpName" maxlength="40" placeholder="Custom Player" aria-label="Name"></div><div><div class="muted">Add as</div><select id="cpKind" aria-label="Add as"><option value="fa">Free agent</option><option value="prospect">Draft prospect</option></select></div></div>
   <div style="margin-top:8px"><div class="muted">Draft class (for prospects)</div><select id="cpYear" aria-label="Draft class year">${E.classYears(L).map(y => `<option value="${y}">${y} draft</option>`).join('')}</select></div>
   <button class="sm go" style="margin-top:8px" data-a="cpCreate">Create & edit</button></div>
  <div class="sect">Draft room: teams you pick for</div><div class="card"><div class="muted small">${L.settings.draftAll ? '"Draft for all teams" is on: you make every pick.' : 'Your team always. Tick others to make their picks too (or turn on "Draft for all teams" above).'}</div>
   <div class="row" style="gap:8px;margin-top:6px"><button class="sm" data-a="dtAll" data-on="1">All</button><button class="sm" data-a="dtAll" data-on="0">Only mine</button></div>
   <div class="dtgrid" style="margin-top:8px">${L.teams.filter(t => !t.inactive).map(t => { const on = t.tid === L.userTid || L.settings.draftAll || (L.draftTeams || []).includes(t.tid); return `<button class="sm ${on ? 'go' : ''}" data-a="dtTog" data-tid="${t.tid}" ${t.tid === L.userTid || L.settings.draftAll ? 'disabled' : ''} aria-pressed="${on}">${esc(t.abbr)}</button>`; }).join('')}</div></div>
  <div class="sect">Draft classes</div><div class="card"><div class="muted small">Build custom classes for any upcoming draft (up to ${E.DC_AHEAD} years ahead), save them as presets, import/export JSON files, and load one into any draft, replacing or merging with the real class.</div><button class="sm go" style="margin-top:8px" data-a="goto" data-n="dclass">Open draft class manager</button> <button class="sm" style="margin-top:8px" data-a="goto" data-n="dcglobal">Edit any year (all franchises)</button></div>
  ${L.season >= 2026 ? `<div class="sect">Expansion team</div><div class="card" id="expCard"><div class="muted small">${E.canExpand(L) ? `Add a new franchise (up to ${E.MAX_TEAMS} teams). It picks 12 players in an expansion draft (each team protects 8; at most one player per team) and gets a top-5 pick in this year's draft.` : `New teams join in the offseason before the draft lottery (Awards or Staff phase), up to ${E.MAX_TEAMS} teams.`}</div>
   ${E.canExpand(L) ? `<div class="row" style="gap:8px;margin-top:8px"><input id="exCity" placeholder="City" maxlength="24" style="flex:1;min-width:0"><input id="exName" placeholder="Team name" maxlength="24" style="flex:1;min-width:0"></div>
   <div class="row" style="gap:8px;margin-top:8px;align-items:center"><input id="exAbbr" placeholder="ABR" maxlength="4" style="width:64px;text-transform:uppercase"><select id="exConf"><option value="E">East</option><option value="W">West</option></select></div><div class="row" style="gap:10px;margin-top:8px;align-items:center"><label class="small" for="exC1">Primary</label><input type="color" id="exC1" value="#1d6f42" class="swatch"><label class="small" for="exC2">Secondary</label><input type="color" id="exC2" value="#f2c14e" class="swatch"></div>
   <button class="sm go" style="margin-top:8px" data-a="exCreate">Create team & run expansion draft</button>` : ''}</div>` : ''}
  <div class="sect">Control any team</div><div class="card"><div class="muted small">Jump to any team to run its roster, trades, signings and re-signings, then jump back. Your GM career stays with ${esc(T(E.homeTid(L)).abbr)}. Teams you've controlled keep their own free agents: in the re-sign phase you decide for them (anything you skip falls back to the CPU).</div>
   <div class="row" style="gap:8px;margin-top:8px"><select id="ctlTeam" aria-label="Team" style="flex:1">${L.teams.filter(t => !t.inactive).map(t => `<option value="${t.tid}" ${t.tid === L.userTid ? 'selected' : ''}>${esc(t.city + ' ' + t.name)}${t.tid === E.homeTid(L) ? ' (yours)' : ''}</option>`).join('')}</select></div>
   <div class="row" style="gap:8px;margin-top:8px"><button class="sm go" data-a="ctlTeam">Control team</button><button class="sm" data-a="ctlMake">Make it my team</button></div></div>
  <div class="sect">Fantasy draft</div><div class="card">${L.fdraft ? '<div class="muted small">A fantasy draft is in progress.</div><button class="sm go" style="margin-top:8px" data-a="goto" data-n="fdraft">Resume draft room</button>' : E.canFantasyDraft(L) ? `<div class="muted small">Put every rostered player back in a pool and let all 29 teams, yours included, snake-draft them in a random order. Contracts stay with the players.</div><div class="row" style="gap:8px;margin-top:8px"><button class="sm go" data-a="fdStart">Start draft room</button><button class="sm" data-a="fantasyDraft">Auto-draft instantly</button></div>` : '<div class="muted small">Available at training camp (preseason, before the first game). Start rosters (real / random / file) are also chosen when you create a league.</div>'}</div>`, cta: `<button data-a="fsReset">Reset to defaults</button>` };
};

// ---------- PLAYER EDITOR ----------
function edGet(path) { return path.split('.').reduce((o, k) => o?.[k], S.ed.m); }
function edSet(path, v) { const ks = path.split('.'); let o = S.ed.m; for (const k of ks.slice(0, -1)) o = o[k] ||= {}; o[ks.at(-1)] = v; }
PAGES.editPlayer = (pg0) => {
  const L = S.L, p = E.getP(L, pg0.pid); if (!p) return { title: 'Edit', body: 'Not found' };
  if (!S.ed || S.ed.pid !== p.pid) S.ed = { pid: p.pid, m: E.editorModel(L, p), errors: [] };
  const m = S.ed.m; const onTeam = +m.tid >= 0;
  const num = (path, lo, hi, step = 1, extra = '') => `<input type="number" inputmode="numeric" data-ed="${path}" value="${edGet(path) ?? ''}" min="${lo}" max="${hi}" step="${step}" ${extra}>`;
  const sel = (path, opts, label) => `<select data-ed="${path}" aria-label="${label}">${opts.map(([v, t]) => `<option value="${v}" ${String(edGet(path)) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const field = (label, html) => `<div><div class="muted">${label}</div>${html}</div>`;
  const slider = (path, label) => `<div class="edr"><span>${label}</span><input type="range" min="40" max="99" data-ed="${path}" value="${edGet(path)}" aria-label="${label}"><b id="v-${path.replace('.', '-')}" class="${qc(E.internalFor(edGet(path)))}">${edGet(path)}</b></div>`;
  const teams = [[-1, 'Free agent'], ...(p.tid === -2 ? [[-2, 'Draft prospect']] : []), ...(p.retired ? [[p.tid, 'Retired']] : []), ...L.teams.filter(t => !t.inactive).map(t => [t.tid, `${t.city} ${t.name}`])];
  const rc = E.raiseCap(L.season, true); const c = m.contract;
  const body = `${S.ed.errors.length ? `<div class="card warn"><b>Fix before saving:</b><ul>${S.ed.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  <div class="sect">Bio</div><div class="card"><div class="muted">Name</div><input data-ed="name" value="${esc(m.name)}" maxlength="40" aria-label="Name">
   <div class="grid2" style="margin-top:6px">${field('Team', sel('tid', teams, 'Team'))}${field('Position', sel('pos', E.POS.map(x => [x, x]), 'Position'))}
   ${onTeam ? field('Jersey #', `<input data-ed="num" value="${esc(m.num)}" maxlength="2" inputmode="numeric" aria-label="Jersey number">`) : ''}${field(`Age (born ${L.season - m.age})`, num('age', 17, 45))}
   ${(() => { const ti = Math.round((+m.h || 0) / 2.54); const ft = Math.floor(ti / 12), inch = ti % 12; const o = (a, b, cur) => Array.from({ length: b - a + 1 }, (_, i) => a + i).map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
     return field(`Height (${ft}' ${inch}")`, `<div class="row" style="gap:4px"><select data-edh="ft" aria-label="Height feet">${o(5, 7, ft)}</select><span>ft</span><select data-edh="in" aria-label="Height inches">${o(0, 11, inch)}</select><span>in</span></div>`); })()}
   ${field('Weight (lb)', `<input type="number" inputmode="numeric" data-edh="lb" value="${Math.round((+m.w || 0) * 2.20462)}" min="135" max="370" aria-label="Weight in pounds">`)}</div></div>
  <div class="sect">Ratings</div><div class="card"><div class="edr"><span><b>All ratings</b></span><div class="stepper" style="margin:0"><button data-a="edAll" data-d="-1" data-hold="1" aria-label="Lower all ratings">−</button><b id="edAllAvg" style="min-width:44px;text-align:center">${Math.round(E.EDIT_ATTRS.reduce((t, k) => t + (+edGet('attrs.' + k) || 0), 0) / E.EDIT_ATTRS.length)}</b><button data-a="edAll" data-d="1" data-hold="1" aria-label="Raise all ratings">+</button></div></div>${E.EDIT_ATTRS.map(k => slider('attrs.' + k, E.EDIT_LABEL[k])).join('')}${slider('pot', 'Potential')}</div>
  <div class="sect">Development</div><div class="card"><div class="grid2">${field('Dev trait', sel('devTrait', [...new Set([m.devTrait, ...E.DEV_TRAITS])].map(x => [x, x]), 'Dev trait'))}
   ${field('Work ethic', sel('work', [['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']], 'Work ethic'))}${field('Career length', sel('lon', E.CAREER_LEN, 'Career length'))}
   ${field(`Morale (${E.moraleWord(+m.mood)})`, num('mood', 0, 100))}</div><div class="muted small">Durability is the rating above; dev trait sets potential headroom.</div></div>
  <div class="sect">Peak rating</div><div class="card">${(() => { const rp = E.realPeak(L, p), dp = E.DEFAULT_PEAKS[p.name], arc = rp != null && L.settings.careers !== 'random';
    const def = arc ? (dp ?? R(rp)) : null;
    return `<div class="row" style="gap:10px;align-items:flex-end"><div style="flex:1">${field('Target peak OVR (40-99)', `<input type="number" inputmode="numeric" data-ed="peak" value="${m.peak ?? ''}" min="40" max="99" placeholder="${def != null ? 'Default ' + def : 'Blank = none'}" aria-label="Target peak rating">`)}</div><button class="sm ghost" data-a="edPeakClear">Use default</button></div>
    <div class="muted small" style="margin-top:6px">${arc ? `He follows his real career and peaks at this number in his best real season (${E.careerOf(L, p) ? 'real-career peak ' + R(rp) : ''}${dp ? `; game default ${dp}` : ''}). Leave blank for the default. Unlike the Potential slider, this keeps him on his real career path.` : 'No real-career data for this player (or Player careers is Random): the peak becomes his potential ceiling.'}</div>`; })()}</div>
  ${onTeam ? `<div class="sect">Contract</div><div class="card"><div class="grid2">${field('Salary/yr ($K)', num('contract.amt', E.minSalary(L.season), E.maxSalary(L.season, p), 10))}
   ${field('Years', sel('contract.yrs', Array.from({ length: E.maxYears(L, true) }, (_, i) => [i + 1, `${i + 1}`]), 'Years'))}
   ${field('Structure', sel('contract.raise', [[-rc, 'Front-loaded'], [0, 'Flat'], [rc, 'Back-loaded']], 'Structure'))}<div class="muted small" style="align-self:end">${c ? M(+c.amt) + '/yr avg' : 'New deal: minimum, 1 yr'}</div></div></div>` : ''}
  <div class="sect">Health</div><div class="card"><div class="grid2">${field('Injury', sel('injury.type', [['', 'Healthy'], ...E.INJURY_TYPES.map(x => [x, x]), ...(m.injury?.type && !E.INJURY_TYPES.includes(m.injury.type) ? [[m.injury.type, m.injury.type]] : [])], 'Injury'))}
   ${m.injury?.type ? field('Games out', num('injury.games', 0, 200)) : ''}</div></div>`;
  return { title: 'Edit Player', right: '', top: `<div class="edtop">${avatar(p, 44)}<div class="grow"><div style="font-weight:800">${esc(m.name || p.name)}</div><div class="muted">${m.pos} · Age ${m.age}</div></div><div class="rbox"><div class="h">OVR</div><div class="n ${qc(E.internalFor(E.previewOvr(p, m)))}" id="edOvr">${E.previewOvr(p, m)}</div></div></div>`,
    body, cta: `<button data-a="edCancel">Cancel</button><button class="go" data-a="edSave">Save</button>` };
};

// ---------- FREE AGENT POOL EDITOR ----------
PAGES.fapool = () => {
  const L = S.L; const open = E.faPoolOpen(L);
  const ps = E.faPool(L).sort((a, b) => b.ovr - a.ovr); const q = (S.fpQ || '').toLowerCase();
  const back = L.players.filter(p => p.retired && (p.overseas || p.retiredSeason >= L.season - 2) && !p.hof && (!q || p.name.toLowerCase().includes(q))).sort((a, b) => b.ovr - a.ovr).slice(0, 12);
  const terms = (p) => { const t = S.fpT === p.pid; const ask = E.askingAmount(L, p, L.userTid, 'fa', E.faRound(L) || 1);
    return `<div class="it"><div class="grow" data-a="player" data-pid="${p.pid}"><div class="nm">${esc(p.name)}${p.custom ? ' <span class="tag">CUSTOM</span>' : ''}</div><div class="meta">${p.pos} · Age ${p.age} · asks ${M(ask)} · ${E.prefYears(p, L)} yr${p.faInterest != null ? ` · interest ${p.faInterest >= 1.1 ? 'High' : p.faInterest <= 0.9 ? 'Low' : 'Normal'}` : ''}</div></div>${sq(p.ovr)}
    <button class="sm" data-a="fpTerms" data-pid="${p.pid}">Terms</button><button class="sm" data-a="edit" data-pid="${p.pid}" aria-label="Edit ${esc(p.name)}">${icon('pen', { s: 16 })}</button><button class="sm red" data-a="fpRemove" data-pid="${p.pid}" aria-label="Remove ${esc(p.name)}">✕</button></div>
    ${t ? `<div class="card" style="margin:0 14px 8px"><div class="grid3"><div><div class="muted">Ask ($K/yr)</div><input id="fpAmt" type="number" step="10" value="${p.faAsk?.amt ?? ask}"></div>
      <div><div class="muted">Years</div><select id="fpYrs">${Array.from({ length: E.maxYears(L, false) }, (_, i) => `<option ${E.prefYears(p, L) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
      <div><div class="muted">Interest in you</div><select id="fpInt">${[['', 'Natural'], [0.8, 'Low'], [1.0, 'Normal'], [1.2, 'High']].map(([v, l]) => `<option value="${v}" ${String(p.faInterest ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="grid2" style="margin-top:8px"><button data-a="fpClear" data-pid="${p.pid}">Reset to market</button><button class="go" data-a="fpSave" data-pid="${p.pid}">Save terms</button></div></div>` : ''}`; };
  return { title: 'Edit FA Pool', body: `${open ? '' : '<div class="card warn">The free-agent pool can be edited in the offseason (and at the 1996 free agency start).</div>'}
  <div class="muted" style="padding:2px 14px 6px">Free-agent pool · ${ps.length} players. Edit asking price, years and interest, or open the full player editor.</div>
  <div class="sect">Add players</div><div class="card"><div class="grid2"><div><div class="muted">Name</div><input id="fpName" placeholder="New player" maxlength="40"></div><div><div class="muted">Position</div><select id="fpPos">${E.POS.map(x => `<option>${x}</option>`).join('')}</select></div>
   <div><div class="muted">Age</div><input id="fpAge" type="number" value="27" min="18" max="42"></div><div><div class="muted">OVR</div><input id="fpOvr" type="number" value="75" min="40" max="99"></div></div>
   <button class="go" style="width:100%;margin-top:8px" data-a="fpCreate" ${open ? '' : 'disabled'}>Create free agent</button>
   <div class="muted" style="margin-top:10px">Bring back a retired / overseas player</div><input data-a="fpQ" value="${esc(S.fpQ || '')}" placeholder="Search name">
   <div class="list">${back.map(p => `<div class="it"><div class="grow"><div class="nm">${esc(p.name)}</div><div class="meta">${p.pos} · Age ${p.age} · ${p.overseas ? 'overseas' : `retired ${p.retiredSeason}`}</div></div>${sq(p.ovr)}<button class="sm" data-a="fpBack" data-pid="${p.pid}" ${open ? '' : 'disabled'}>Add</button></div>`).join('') || '<div class="it muted">No matches.</div>'}</div></div>
  <div class="sect">Pool</div><div class="list">${ps.slice(0, 120).map(terms).join('')}</div>` };
};

// NBA season number (1 = rookie): from draft year, else seasons in the career log
const expYr = (L, p) => p.draft?.year ? L.season - p.draft.year : (p.prior?.yrs || 0) + (p.career?.length || 0) + 1;
// ---------- MODALS ----------
function sheetHead(title, sub = '') { return `<div class="sh"><div><div style="font-weight:800">${title}</div>${sub ? `<div style="font-size:12px;opacity:.85">${sub}</div>` : ''}</div><button class="x sm" data-a="close" aria-label="Close">${icon('close', { s: 18 })}</button></div>`; }
function modalView() { return ({ offers: offersModal, signTo: signToModal, offer: offerModal, holiday: holidayModal, cut: cutModal }[S.modal.type] || (() => ''))(); }
const structOK = (L, kind) => kind !== 'ext' && !(L.phase === 'REGULAR' && kind === 'fa');
function offersModal() {
  const L = S.L, p = E.getP(L, S.modal.pid); const list = (L.tradeOffers || []).filter(x => S.modal.ids.includes(x.id));
  const onBlock = (L.tradeBlock || []).includes(p.pid);
  return sheetHead(`Offers for ${esc(p.name)}`, `${list.length} team(s) · ${p.pos} · OVR ${R(p.ovr)}`) + `<div class="wrap">
  ${list.length ? list.map(x => { const d = descOffer(L, x.offer); return `<div class="card"><div class="row">${disc(x.offer.tidB, 32)}<div class="grow"><div class="nm">${esc(T(x.offer.tidB).city)} ${esc(T(x.offer.tidB).name)}</div><div class="meta">Value ${Math.round(x.offer.value || 0)}</div></div><button class="go sm" data-a="offAccept" data-id="${x.id}">Accept</button></div><div style="font-size:13px;margin-top:4px"><span class="muted">You get:</span> ${d.get}</div></div>`; }).join('') : '<div class="card muted">No team made an offer right now. Put him on the block and offers may come later.</div>'}
  <div class="grid2" style="margin-top:8px">${onBlock ? '<button disabled>On trade block</button>' : `<button class="blue" data-a="block" data-pid="${p.pid}">Add to Trade Block</button>`}<button data-a="close">Back</button></div></div>`;
}
function signToModal() {
  const L = S.L, p = E.getP(L, S.modal.pid); const amt = E.fairContract(L, p);
  return sheetHead(`Sign ${esc(p.name)} to…`, `Commissioner signing · ${M(amt)}/yr · max length · ignores interest and cap`) + `<div class="wrap"><div class="list">${L.teams.filter(t => !t.inactive).map(t => `<button class="it" style="width:100%;text-align:left" data-a="signToTeam" data-tid="${t.tid}">${esc(t.city + ' ' + t.name)}${t.tid === p.formerTid ? ' <span class="tag" style="background:#e3e7ec;color:#111">Previous team</span>' : ''} <span class="muted">${E.commishYears(L, p, t.tid)} yrs · ${E.activeCount(L, t.tid)}/${E.ROSTER_MAX}</span></button>`).join('')}</div></div>`;
}
function offerModal() {
  const L = S.L, p = E.getP(L, S.modal.pid); const kind = S.modal.kind;
  const ask = kind === 'resign' ? p.resignAsk : kind === 'ext' ? E.extensionAsk(L, p) : E.askingAmount(L, p, L.userTid, L.phase === 'REGULAR' ? 'inseason' : 'fa', E.faRound(L) || 3);
  const maxY = kind === 'ext' ? E.maxYears(L, true) - 1 : L.phase === 'REGULAR' && kind === 'fa' ? 1 : E.maxYears(L, kind === 'resign');
  const amt = S.modal.amt ?? ask, yrs = Math.min(maxY, S.modal.yrs ?? (kind === 'ext' ? 3 : E.prefYears(p, L)));
  const aff = kind !== 'fa' ? { ok: true, via: kind === 'ext' ? 'Starts after current deal' : 'Bird rights' } : E.canAfford(L, L.userTid, amt);
  return sheetHead(`${kind === 'resign' ? 'Re-sign' : kind === 'ext' ? 'Extend' : 'Offer'}: ${esc(p.name)}`, `${p.pos} · Age ${p.age} · OVR ${R(p.ovr)}`) + `<div class="wrap"><div class="card">
  <div class="kv"><span>Asking</span><b>~${M(ask)}/yr${kind === 'ext' ? '' : ` · ${E.prefYears(p, L)} yrs`}</b></div>${(() => { const m = E.moodToward(L, p, L.userTid), w = E.interestWord(m), t = kind === 'fa' && E.faRound(L) ? null : E.talks(L, p, kind);
    return `<div class="kv"><span>Interest in your team</span><b class="${m >= 1 ? 'tg' : m >= 0.9 ? '' : 'tr'}">${w}</b></div><div class="bar"><i style="width:${Math.round(clampN((m - 0.7) / 0.6, 0, 1) * 100)}%;background:${m >= 1 ? 'var(--q4)' : m >= 0.9 ? 'var(--gold)' : 'var(--q1)'}"></i></div>
    ${t ? `<div class="kv"><span>Agent patience</span><b class="pat">${[...Array(E.MAX_TRIES)].map((_, i) => `<i class="${i < E.MAX_TRIES - t.tries ? 'on' : ''}"></i>`).join('')}</b></div>` : ''}
    ${t?.last || t?.ended ? `<div class="agent ${t.ended ? 'end' : ''}"><div class="who">${esc(p.name.split(' ').slice(-1)[0])}'s agent</div>${esc(t.ended && !t.last ? "We're not interested in further negotiations." : t.last.text)}${t.last && !t.ended ? `<button type="button" class="sm go" data-a="offUseCounter">Use ${M(t.last.need)} · ${t.last.years}y</button>` : ''}</div>` : ''}`; })()}
  <div class="muted">Average salary per year: <b>${M(amt)}</b></div><input type="range" min="${E.minSalary(L.season)}" max="${Math.max(E.maxSalary(L.season, p), ask * 1.3)}" step="10" value="${amt}" data-a="offAmt">
  <div class="muted">${kind === 'ext' ? 'Extra years' : 'Years'}: <b>${yrs}</b></div><div class="stepper"><button data-a="offYrs" data-d="-1">−</button><b>${yrs}</b><button data-a="offYrs" data-d="1">+</button><span class="muted">max ${maxY}</span></div>
  ${structOK(L, kind) ? (() => { const rc = E.raiseCap(L.season, kind === 'resign'), r = S.modal.raise || 0, y1 = E.yearOneFor(amt, yrs, r), yN = y1 * (1 + r * (yrs - 1));
    return `<div class="muted" style="margin-top:8px">Structure</div><div class="pill-seg">${[[-rc, 'Front-loaded'], [0, 'Flat'], [rc, 'Back-loaded']].map(([v, l]) => `<button class="${Math.abs(r - v) < 1e-9 ? 'on' : ''}" data-a="offRaise" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="kv"><span>Year 1 → year ${yrs}</span><b>${M(y1)} → ${M(yN)}</b></div><div class="muted small">${r ? `${r > 0 ? 'Raises' : 'Declines'} of ${Math.round(rc * 1000) / 10}% of year 1 per season (CBA limit${kind === 'resign' ? ', Bird rights' : ''}). Same total money; players value front-loaded deals a little more.` : 'Same salary every season.'}</div>`; })() : ''}
  <div class="kv"><span>Cap</span><b class="${aff.ok ? 'tg' : 'tr'}">${aff.ok ? aff.via : aff.error}</b></div>
  <div class="grid2" style="margin-top:10px"><button data-a="offMin">Minimum</button><button data-a="offAsk">Match ask</button></div>
  <button class="go" style="width:100%;margin-top:10px" data-a="submitOffer">${kind === 'resign' ? 'Offer Contract' : kind === 'ext' ? 'Offer Extension' : E.faRound(L) ? 'Submit Offer (decides at week end)' : 'Sign Now'}</button></div></div>`;
}
function holidayModal() {
  const L = S.L; const n = S.modal.n; const left = L.schedule.filter(g => !g.played && (g.h === L.userTid || g.a === L.userTid)).length;
  return sheetHead('Go on Holiday', 'Sim several games at once') + `<div class="wrap"><div class="card center"><div class="muted">Games to sim</div>
  <div class="stepper" style="justify-content:center;margin:10px 0"><button data-a="holN" data-d="-1" data-hold="1">−</button><b style="font-size:30px;min-width:60px">${n}</b><button data-a="holN" data-d="1" data-hold="1">+</button></div>
  <div class="grid3"><button data-a="holSet" data-v="7">Week</button><button data-a="holSet" data-v="15">Month</button><button data-a="holSet" data-v="${left}">Season</button></div>
  <div class="muted" style="margin-top:6px">${left} game(s) left${L.day <= L.tradeDeadline ? ` · trade deadline ${E.dateOf(L, L.tradeDeadline)}` : ''}</div>
  <button class="go" style="width:100%;margin-top:12px" data-a="holGo">Go on Holiday</button></div></div>`;
}
function cutModal() {
  const L = S.L; const ps = E.teamPlayers(L, L.userTid).sort((a, b) => a.ovr - b.ovr); const over = ps.length - 15;
  return sheetHead('Roster over the limit', `${ps.length} players · max 15`) + `<div class="wrap"><div class="card">You must release ${over} player(s) before the season starts. Released guaranteed salary stays on your cap.</div>
  <div class="list">${ps.map(p => playerRow(p, { act: 'noop', extra: `<button class="sm red" data-a="release" data-pid="${p.pid}">Cut</button>` })).join('')}</div>
  <button class="go" style="width:calc(100% - 20px);margin:10px" data-a="autoCut">Auto-cut and start</button></div>`;
}

// ---------- ACTIONS ----------
function go(n, extra = {}, push = true) { if (push && S.view === 'main') S.stack.push(S.page); S.page = { n, ...extra }; S.drawer = false; render(); window.scrollTo(0, 0); }
function root(n, extra = {}) { S.stack = []; S.page = { n, ...extra }; S.drawer = false; render(); window.scrollTo(0, 0); }
async function simChunked(nGames, label = 'Simulating') {
  const L = S.L; let c = 0; const startW = E.standings(L)[L.userTid].w;
  overlay(label + '…'); await sleep(20); let lastY = performance.now();
  while (c < nGames || (L.phase === 'REGULAR' && !E.seasonDone(L) && !nextUserGame(L))) {
    if (L.phase === 'REGULAR' && E.seasonDone(L)) break;
    if (L.phase === 'PLAYOFFS' && L.playoffs.champ != null) break;
    if (L.phase !== 'REGULAR' && L.phase !== 'PLAYOFFS') break;
    const before = L.schedule.filter(g => g.played && (g.h === L.userTid || g.a === L.userTid)).length;
    E.simDay(L);
    const after = L.schedule.filter(g => g.played && (g.h === L.userTid || g.a === L.userTid)).length;
    c += L.phase === 'REGULAR' ? after - before : 1;
    // yield to the browser on a time budget (keeps phones responsive without slowing fast devices)
    if (performance.now() - lastY > 40) { overlay(`${label}… ${E.dateOf(L)}`); await sleep(0); lastY = performance.now(); }
  }
  overlay(null); autosave(); render();
  const r = E.standings(L)[L.userTid]; if (L.phase === 'REGULAR') toast(`Back from holiday: ${r.w - startW}-${c - (r.w - startW)} · now ${r.w}-${r.l}`);
}
let liveTimer = null;
function startLive(res) {
  S.live = { g: res.g, r: res.r, s: res.s, i: 0, speed: 4 };
  if (S.page.n !== 'live') S.stack.push(S.page); S.page = { n: 'live' }; render();
  clearInterval(liveTimer);
  liveTimer = setInterval(() => { if (!S.live || S.page.n !== 'live') { clearInterval(liveTimer); return; } S.live.i = Math.min(S.live.r.pbp.length, S.live.i + S.live.speed); render(); if (S.live.i >= S.live.r.pbp.length) clearInterval(liveTimer); }, 450);
}
const curAsk = (L, p, kind) => kind === 'resign' ? p.resignAsk : kind === 'ext' ? E.extensionAsk(L, p) : E.askingAmount(L, p, L.userTid, L.phase === 'REGULAR' ? 'inseason' : 'fa', E.faRound(L) || 3);
let holdT = null;
const A = {
  noop() {},
  toTitle() { S.view = 'title'; render(); },
  async toSlots(d) { S.slotMode = d.mode; S.slots = await listSlots(); S.view = 'slots'; render(); },
  newInSlot(d) { S.slot = +d.slot; S.ng = DEF_NG(); S.view = 'setup'; render(); },
  ngDiff(d) { if (d.d === 'Custom') S.ng.custom = true; else { S.ng.custom = false; S.ng.difficulty = d.d; } render(); },
  toSetup() { S.view = 'setup'; render(); },
  async toPickTeam() {
    if (S.ng.rosters === 'file' && !S.ng.rosterFile) return toast('Choose a roster file first.');
    const hy = +S.ng.startYear || 1997; if (hy < 1997) { S.ng.start = 'PRESEASON'; S.ng.rosters = 'real'; }
    overlay(hy < 1997 ? `Building the ${seasonLbl(hy)} league` : S.ng.start === 'DRAFT' ? 'Building the 1996 draft' : S.ng.start === 'FA' ? 'Opening 1996 free agency' : 'Building the 1996-97 league'); await sleep(20);
    await loadData(); S.ngSeed = Math.floor(Math.random() * 2 ** 31);
    try { S.preL = E.newLeague(DATA, { dcGlobal: dcGlobal(), ...S.ng, rosterFile: S.ng.rosters === 'file' ? S.ng.rosterFile : null, seed: S.ngSeed }); } catch (e) { overlay(null); return toast('Could not build the league: ' + e.message, 4000); } overlay(null); S.view = 'pickteam'; render();
  },
  previewTeam(d) { S.previewTid = +d.tid; S.view = 'preview'; render(); window.scrollTo(0, 0); },
  async takeOver() {
    overlay('Taking over…'); await sleep(20);
    const L = E.newLeague(DATA, { dcGlobal: dcGlobal(), ...S.ng, rosterFile: S.ng.rosters === 'file' ? S.ng.rosterFile : null, gmName: S.ng.gmName || 'GM', seed: S.ngSeed, userTid: S.previewTid });
    attach(L); S.preL = null; S.tab = {}; await saveSlot(S.slot, L); overlay(null); S.view = 'main'; root(L.phase === 'DRAFT' ? 'draft' : L.phase.startsWith('FA') ? 'fa' : 'home');
  },
  async loadSlot(d) { overlay('Loading'); const L = await loadSlot(+d.slot); overlay(null); if (!L) return toast('Empty slot'); await loadData().catch(() => {}); attach(L); S.slot = +d.slot; S.view = 'main'; root('home'); },
  async delSlot(d) { if (!confirm(`Delete save in slot ${d.slot}?`)) return; await deleteSlot(+d.slot); S.slots = await listSlots(); render(); },
  importPick() { $('#importFile').click(); },
  drawer() { S.drawer = true; renderDrawer(); }, drawerClose() { S.drawer = false; renderDrawer(); },
  nav(d) { if (d.t) S.tab[d.p] = d.t; if (d.p === 'team') S.tab.team = d.t || 'roster'; S.drawer = false; S.modal = null; renderModal(); if (['reorder', 'player', 'box'].includes(d.p)) go(d.p); else root(d.p); },
  back() { if (S.page.n === 'live') { clearInterval(liveTimer); S.live = null; } S.page = S.stack.pop() || { n: 'home' }; render(); },
  tab(d) { S.tab[d.g] = d.k; render(); },
  setS(d) { S[d.k] = isNaN(+d.v) || d.v === '' ? d.v : +d.v; render(); },
  teamPage(d) { const tid = +d.tid; if (tid === S.L.userTid) { S.tab.team = 'roster'; return root('team'); } S.tab.team = 'roster'; go('team', { tid }); },
  player(d) { S.tab.player = 'skills'; go('player', { pid: +d.pid }); },
  goto(d) { go(d.n); },
  edit(d) { S.ed = null; go('editPlayer', { pid: +d.pid }); },
  edPeakClear() { if (!S.ed) return; S.ed.m.peak = ''; render(); },
  edCancel() { S.ed = null; A.back(); },
  edSave() {
    const m = S.ed.m; const model = { ...m, injury: m.injury?.type ? { type: m.injury.type, games: +(m.injury.games ?? 5) } : null, contract: +m.tid >= 0 ? m.contract : null };
    const r = E.applyEdit(S.L, S.ed.pid, model);
    if (!r.ok) { S.ed.errors = r.errors; render(); window.scrollTo(0, 0); return toast(r.errors[0], 3000); }
    S.ed = null; autosave(); A.back(); toast(r.changed.length ? `Saved: ${r.changed.slice(0, 4).join(', ')}${r.changed.length > 4 ? '…' : ''}` : 'No changes');
  },
  dcAdd() { const r = E.addProspect(S.L, { year: S.dcYear, name: (document.getElementById('dcName').value || '').trim() || undefined }); if (!r.ok) return toast(r.error); S.ed = null; autosave(); go('editPlayer', { pid: r.pid }); },
  dcEdit(d) { S.ed = null; go('editPlayer', { pid: +d.pid }); },
  dcDel(d) { const r = E.removeProspect(S.L, d.pid); if (!r.ok) return toast(r.error); autosave(); toast(`Removed ${r.name}`); render(); },
  dcSavePreset() { const nm = (document.getElementById('dcPreset').value || '').trim() || `${S.dcYear} class`; const f = E.exportClass(S.L, S.dcYear, nm); if (!f.prospects.length) return toast('That class is empty.'); const a = dcPresets(); a.push(f); dcSave(a); toast(`Saved "${nm}" (${f.prospects.length})`); render(); },
  dcLoad(d) { const f = dcPresets()[+d.i]; if (!f) return; if (d.m === 'replace' && !confirm(`Replace the ${S.dcYear} draft class with "${f.name}"?`)) return; const r = E.applyClass(S.L, f, S.dcYear, d.m); if (!r.ok) return toast(r.error); autosave(); toast(`${d.m === 'replace' ? 'Replaced' : 'Merged'}: ${r.added} prospects (${r.size} in class)`); render(); },
  dcExport(d) { const f = dcPresets()[+d.i]; if (!f) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(f, null, 1)], { type: 'application/json' })); a.download = `draft-class-${f.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Exported'); },
  dcDelPreset(d) { const a = dcPresets(); const [x] = a.splice(+d.i, 1); dcSave(a); toast(`Deleted "${x?.name}"`); render(); },
  dcgAdd() { const nm = (document.getElementById('dcgName').value || '').trim(); if (!nm) return toast('Enter a name.'); const G = dcGlobal(); const y = S.dcgYear; const g = G[y] ||= { name: `Custom ${y} class`, mode: 'merge', prospects: [], remove: [] };
    if (g.prospects.some(r => r.name.toLowerCase() === nm.toLowerCase())) return toast('Already added.');
    g.prospects.push({ name: nm, pos: document.getElementById('dcgPos').value, draftAge: Math.max(17, Math.min(30, +document.getElementById('dcgAge').value || 21)), ovr: Math.max(40, Math.min(99, +document.getElementById('dcgOvr').value || 60)) }); dcGSave(G); toast(`Added ${nm} to the ${y} class`); render(); },
  dcgDel(d) { const G = dcGlobal(); const g = G[S.dcgYear]; if (!g) return; g.prospects.splice(+d.i, 1); dcGSave(G); render(); },
  dcgTog(d) { const G = dcGlobal(); const y = S.dcgYear; const g = G[y] ||= { name: `Custom ${y} class`, mode: 'merge', prospects: [], remove: [] }; g.remove ||= []; const i = g.remove.findIndex(n => n.toLowerCase() === d.n.toLowerCase()); if (i >= 0) g.remove.splice(i, 1); else g.remove.push(d.n); dcGSave(G); render(); },
  dcImport() { document.getElementById('dcFile').click(); },
  cpCreate() { const kind = document.getElementById('cpKind').value; const r = E.createPlayer(S.L, { name: (document.getElementById('cpName').value || '').trim() || undefined, kind, year: kind === 'prospect' ? +document.getElementById('cpYear').value : null }); if (!r.ok) return toast(r.error); S.ed = null; autosave(); go('editPlayer', { pid: r.pid }); },
  ctlTeam() { const tid = +document.getElementById('ctlTeam').value; const r = E.controlTeam(S.L, tid); if (!r.ok) return toast(r.error); S.trade = null; autosave(); root('team'); toast(E.isControlling(S.L) ? `Now controlling the ${T(tid).name}` : 'Back to your team'); },
  ctlHome() { E.returnHome(S.L); S.trade = null; autosave(); root('home'); toast(`Back to the ${T(S.L.userTid).name}`); },
  exCreate() { const v = id => (document.getElementById(id).value || '').trim(); const r = E.createExpansionTeam(S.L, { city: v('exCity'), name: v('exName'), abbr: v('exAbbr'), conf: v('exConf'), c1: v('exC1'), c2: v('exC2') }); if (!r.ok) return toast(r.error); autosave(); toast(`${T(r.tid).city} ${T(r.tid).name} join the league`); go('team', { tid: r.tid }); },
  ctlMake() { const tid = +document.getElementById('ctlTeam').value; if (tid === E.homeTid(S.L) && !E.isControlling(S.L)) return toast('That is already your team.'); if (!confirm(`Become the GM of the ${T(tid).city} ${T(tid).name} for good?`)) return; const r = E.makeHomeTeam(S.L, tid); if (!r.ok) return toast(r.error); S.trade = null; autosave(); root('home'); },
  fdStart() { if (!confirm('Start a fantasy draft? Every roster, including yours, goes back in the pool. This cannot be undone (except by loading an older save).')) return;
    const r = E.startFantasyDraft(S.L); if (!r.ok) return toast(r.error); autosave(); go('fdraft'); },
  fdPick(d) { const L = S.L; const sl = L.fdraft?.order[L.fdraft.idx]; if (!sl || !E.draftControls(L, sl.tid)) return toast('Not your pick'); const p = E.getP(L, +d.pid); const r = E.fdPick(L, +d.pid); if (!r.ok) return toast(r.error); toast(sl.tid === L.userTid ? `You picked ${p.name}` : `${T(sl.tid).abbr} pick ${p.name}`); autosave(); if (S.page.n !== 'fdraft') go('fdraft'); else render(); },
  fdAutoMe() { E.fdAuto(S.L, { one: true }); autosave(); render(); },
  fdNext() { const L = S.L; if (!L.fdraft || E.draftControls(L, L.fdraft.order[L.fdraft.idx].tid)) return render(); E.fdAuto(L, { one: true }); autosave(); render(); },
  fdToMe() { const L = S.L; if (L.fdraft && E.draftControls(L, L.fdraft.order[L.fdraft.idx].tid)) E.fdAuto(L, { one: true }); if (L.fdraft) E.fdAuto(L); autosave(); render(); },
  fdEnd() { if (!confirm('Auto-draft the rest, including your picks?')) return; E.fdAuto(S.L, { all: true }); autosave(); render(); toast('Fantasy draft complete'); },
  fantasyDraft() { if (!confirm('Run a fantasy draft? Every roster, including yours, is re-drafted. This cannot be undone (except by loading an older save).')) return;
    const r = E.fantasyRedraft(S.L); if (!r.ok) return toast(r.error); autosave(); render(); toast(`Fantasy draft done — you picked ${r.userPick}${['th', 'st', 'nd', 'rd'][r.userPick % 10 > 3 || [11, 12, 13].includes(r.userPick % 100) ? 0 : r.userPick % 10]}.`, 3500); },
  fsReset() { if (!confirm('Reset all franchise settings to defaults?')) return; Object.assign(S.L.settings, E.FS_DEFAULTS); E.ensureSettings(S.L); autosave(); render(); toast('Defaults restored'); },
  ngFs() { S.ng.showFs = !S.ng.showFs; S.ng.franchise ||= {}; render(); },
  fpTerms(d) { S.fpT = S.fpT === +d.pid ? null : +d.pid; render(); },
  fpSave(d) { const v = (id) => document.getElementById(id)?.value; const int = v('fpInt');
    const r = E.faSetTerms(S.L, +d.pid, { amt: +v('fpAmt'), yrs: +v('fpYrs'), interest: int === '' ? null : +int });
    if (!r.ok) return toast(r.error, 3000); S.fpT = null; autosave(); render(); toast('Terms saved'); },
  fpClear(d) { E.faSetTerms(S.L, +d.pid, {}); S.fpT = null; autosave(); render(); toast('Back to market value'); },
  fpRemove(d) { const p = E.getP(S.L, +d.pid); const r = E.faRemove(S.L, +d.pid); if (!r.ok) return toast(r.error); autosave(); render(); toast(`${p.name} removed (overseas)`); },
  fpBack(d) { const r = E.faAddExisting(S.L, +d.pid); if (!r.ok) return toast(r.error); autosave(); render(); toast('Added to the pool'); },
  fpCreate() { const v = (id) => document.getElementById(id)?.value; const r = E.faCreate(S.L, { name: (v('fpName') || '').trim() || undefined, pos: v('fpPos'), age: +v('fpAge'), ovr: +v('fpOvr') });
    if (!r.ok) return toast(r.error); autosave(); S.ed = null; go('editPlayer', { pid: r.pid }); toast('Created — fine-tune in the editor'); },
  box(d) { go('box', { gid: isNaN(+d.gid) ? d.gid : +d.gid }); },
  close() { S.modal = null; render(); },
  async saveNow() { await saveSlot(S.slot, S.L); S.drawer = false; render(); toast('Saved to slot ' + S.slot); },
  export() { exportJSON(S.L); },
  exportRoster() { const f = E.exportRosterFile(S.L); const blob = new Blob([JSON.stringify(f, null, 1)], { type: 'application/json' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `hardwood-gm-rosters-${S.L.season}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast(`Exported ${f.players.length} players. Edit the file and pick it under New Game → Rosters → Roster file.`, 4000); },
  rosterPick() { $('#rosterFile').click(); },
  rosterClear() { S.ng.rosterFile = null; S.ng.rosterName = null; S.ng.rosters = 'real'; render(); },
  dark() { const on = document.documentElement.classList.toggle('dark'); localStorage.setItem('hgm-dark', on ? '1' : '0'); render(); },
  async quit() { clearInterval(liveTimer); await saveSlot(S.slot, S.L); S.L = null; S.modal = null; S.drawer = false; S.view = 'title'; S.stack = []; render(); },
  async advance() {
    const L = S.L; const before = L.phase;
    if (before === 'REGULAR' && !E.seasonDone(L)) return toast('Finish the regular season first.');
    if (before === 'PRESEASON' && E.teamPlayers(L, L.userTid).length > E.ROSTER_MAX) { S.modal = { type: 'cut' }; return renderModal(); }
    overlay('Advancing'); await sleep(20);
    const r = E.advance(L); overlay(null);
    if (!r.ok) { toast(r.error, 3500); return; }
    if (L.phase === 'LOTTERY') S.lotteryReveal = 0;
    if (L.phase === 'DRAFT') { E.draftUntilUser(L); autosave(); return root('draft'); }
    if (['FA2', 'FA3', 'SUMMER'].includes(L.phase)) toast('Free agency week complete — check Messages.');
    autosave(); root('home');
  },
  async playNext() {
    const L = S.L;
    if (L.phase === 'REGULAR') {
      if (E.seasonDone(L)) return;
      overlay('Simulating to your next game'); await sleep(10);
      if (!nextUserGame(L)) { overlay(null); return simChunked(0, 'Finishing the regular season'); }
      const g = E.simUntilUserGame(L); overlay(null);
      if (!g) { render(); return; }
      const res = E.simDay(L, { pbp: true }); autosave();
      if (res) startLive(res); else render();
    } else if (L.phase === 'PLAYOFFS') {
      const res = E.simPlayoffDay(L, { pbp: true }); autosave();
      if (res) startLive(res); else { render(); toast(L.playoffs.champ != null ? 'Playoffs complete!' : 'Simulated a playoff day.'); }
    }
  },
  holiday() { S.modal = { type: 'holiday', n: 7 }; renderModal(); },
  holN(d) { S.modal.n = Math.max(1, Math.min(82, S.modal.n + +d.d)); renderModal(); },
  holSet(d) { S.modal.n = Math.max(1, +d.v); renderModal(); },
  holGo() { const n = S.modal.n; S.modal = null; renderModal(); simChunked(n, 'On holiday'); },
  async simRound() { const r = S.L.playoffs.round; overlay('Simulating round'); await sleep(10); while (S.L.playoffs.round === r && S.L.playoffs.champ == null) E.simDay(S.L); overlay(null); autosave(); render(); },
  speed(d) { S.live.speed = +d.v; if (+d.v === 999) S.live.i = S.live.r.pbp.length; render(); },
  liveDone() { clearInterval(liveTimer); S.live = null; root('home'); },
  lotNext() { S.lotteryReveal++; render(); }, lotAll() { S.lotteryReveal = 99; render(); },
  draftPick(d) { const L = S.L; const sl = L.draft.order[L.draft.idx]; if (!sl || !E.draftControls(L, sl.tid)) return toast('Not your pick'); const p = E.getP(L, +d.pid); const r = E.draftPlayer(L, +d.pid); if (!r.ok) return toast(r.error); toast(sl.tid === L.userTid ? `You drafted ${p.name}!` : `${T(sl.tid).abbr} draft ${p.name}`); autosave(); if (S.page.n !== 'draft') root('draft'); else render(); },
  draftNext() { const L = S.L, D = L.draft; const slot = D.order[D.idx]; if (!slot || E.draftControls(L, slot.tid)) return render(); E.draftUntilUser(L, { one: true }); autosave(); render(); },
  draftToMe() { const L = S.L, D = L.draft; const sl = D.order[D.idx]; if (sl && E.draftControls(L, sl.tid)) E.draftAutoOne(L); E.draftUntilUser(L); autosave(); render(); },
  draftAutoOne() { const p = E.draftAutoOne(S.L); if (p) toast(`Auto-pick: ${p.name}`); autosave(); render(); },
  dtTog(d) { const L = S.L; const cur = new Set(L.draftTeams || []); const t = +d.tid; cur.has(t) ? cur.delete(t) : cur.add(t); E.setDraftTeams(L, [...cur]); autosave(); render(); },
  dtAll(d) { const L = S.L; E.setDraftTeams(L, d.on === '1' ? L.teams.filter(t => !t.inactive).map(t => t.tid) : []); autosave(); render(); },
  draftAuto() { E.draftUntilUser(S.L, { all: true }); autosave(); render(); },
  clockAccept(d) { const o = S.clockOffs?.[+d.i]; if (!o) return; const v = E.validateTrade(S.L, o); if (!v.ok) return toast(v.error); const t = E.executeTrade(S.L, o);
    const D = S.L.draft; for (const s of D.order) { const k = S.L.picks.find(z => z.id === s.id); if (k) s.tid = k.tid; }
    S.L.inbox.unshift({ id: S.L.msgId++, season: S.L.season, day: S.L.day, from: 'Front Office', subject: 'Draft-day trade', body: t, read: false }); toast('Pick traded!'); E.draftUntilUser(S.L); autosave(); render(); },
  short(d) { const L = S.L; L.shortlist ||= []; const id = +d.pid; const i = L.shortlist.indexOf(id); if (i >= 0) L.shortlist.splice(i, 1); else L.shortlist.push(id); autosave(); render(); },
  shortOnly() { S.shortOnly = !S.shortOnly; render(); },
  hofMine() { S.hofMine = !S.hofMine; render(); },
  block(d) { const on = E.toggleBlock(S.L, +d.pid); toast(on ? 'Added to the trade block' : 'Removed from the trade block'); autosave(); render(); if (S.modal) renderModal(); },
  callAround() { overlay('Calling around the league'); E.refreshOffers(S.L, true); overlay(null); autosave(); S.tab.trade = 'offers'; render(); toast(`${S.L.tradeOffers.length} offer(s) on the table`); },
  offAccept(d) { const r = E.acceptOffer(S.L, +d.id); if (!r.ok) return toast(r.error); S.L.inbox.unshift({ id: S.L.msgId++, season: S.L.season, day: S.L.day, from: 'Front Office', subject: 'Trade completed', body: r.text, read: false }); toast('Trade completed!'); if (S.modal?.type === 'offers') { S.modal = null; renderModal(); } autosave(); render(); },
  offDecline(d) { E.declineOffer(S.L, +d.id); autosave(); render(); },
  offCounter(d) { const x = S.L.tradeOffers.find(o => o.id === +d.id); if (!x) return; const o = x.offer; S.trade = { tid: o.tidB, a: [...o.aPids], ap: [...o.aPicks], b: [...o.bPids], bp: [...o.bPicks] }; E.declineOffer(S.L, x.id); S.tab.trade = 'machine'; render(); },
  convince(d) { const ok = E.convinceRetire(S.L, +d.pid); toast(ok ? 'He agreed to play another season!' : 'His mind is made up — he will retire.'); autosave(); render(); },
  offerSheet(d) { S.modal = { type: 'offer', pid: +d.pid, kind: d.kind }; renderModal(); },
  offRaise(d) { S.modal.raise = +d.v; renderModal(); },
  getOffers(d) { const L = S.L; overlay('Calling every team'); const ids = E.instantOffers(L, +d.pid); overlay(null); S.modal = { type: 'offers', pid: +d.pid, ids }; autosave(); renderModal(); },
  signToSheet(d) { S.modal = { type: 'signTo', pid: +d.pid }; renderModal(); },
  signToTeam(d) { const L = S.L, p = E.getP(L, S.modal.pid); const tid = +d.tid; if (E.activeCount(L, tid) >= E.ROSTER_MAX && !confirm(`${L.teams[tid].abbr} already has ${E.ROSTER_MAX} active players. Sign anyway?`)) return;
    E.commissionerSign(L, p, tid); S.modal = null; renderModal(); toast(`${p.name} signed with ${L.teams[tid].abbr}`); autosave(); render(); },
  returnFAs() { const L = S.L; if (!confirm('Re-sign every free agent who played for a team last season back to that team at a fair contract?')) return;
    const mine = E.freeAgents(L).filter(p => p.formerTid === L.userTid).length; const inc = mine > 0 && confirm(`Also bring back ${mine} of your own former players to your team?`);
    const r = E.returnFreeAgents(L, { includeUser: inc }); E.aiRosterFix(L); toast(`${r.length} free agents returned to their teams`); autosave(); render(); },
  edAll(d) { if (!S.ed) return; const step = +d.d; let tot = 0;
    for (const k of E.EDIT_ATTRS) { const path = 'attrs.' + k; const v = Math.max(40, Math.min(99, (+edGet(path) || 0) + step)); edSet(path, v); tot += v;
      const inp = document.querySelector(`[data-ed="${path}"]`); if (inp) inp.value = v; const b = document.getElementById('v-' + path.replace('.', '-')); if (b) { b.textContent = v; b.className = qc(E.internalFor(v)); } }
    const avg = document.getElementById('edAllAvg'); if (avg) avg.textContent = Math.round(tot / E.EDIT_ATTRS.length);
    const o = document.getElementById('edOvr'); const p = E.getP(S.L, S.ed.pid); if (o && p) { const ov = E.previewOvr(p, S.ed.m); o.textContent = ov; o.className = 'n ' + qc(E.internalFor(ov)); } },
  offMin() { S.modal.amt = E.minSalary(S.L.season); renderModal(); },
  offAsk() { const L = S.L, p = E.getP(L, S.modal.pid); S.modal.amt = curAsk(L, p, S.modal.kind); renderModal(); },
  offYrs(d) { const L = S.L, p = E.getP(L, S.modal.pid), k = S.modal.kind; const maxY = k === 'ext' ? E.maxYears(L, true) - 1 : L.phase === 'REGULAR' && k === 'fa' ? 1 : E.maxYears(L, k === 'resign');
    S.modal.yrs = Math.max(1, Math.min(maxY, (S.modal.yrs ?? (k === 'ext' ? 3 : E.prefYears(p, L))) + +d.d)); renderModal(); },
  offUseCounter() { const L = S.L, p = E.getP(L, S.modal.pid); const t = E.talks(L, p, S.modal.kind); if (t.last) { S.modal.amt = t.last.need; S.modal.yrs = t.last.years; toast(`Offer set to ${M(t.last.need)} · ${t.last.years}y`); } S.modal.keepScroll = true; renderModal(); },
  submitOffer() {
    const L = S.L, m = S.modal, p = E.getP(L, m.pid);
    const amt = m.amt ?? curAsk(L, p, m.kind); const yrs = m.yrs ?? (m.kind === 'ext' ? 3 : E.prefYears(p, L));
    const rz = structOK(L, m.kind) ? (m.raise || 0) : 0; const r = m.kind === 'fa' && E.faRound(L) ? E.userOffer(L, p.pid, amt, yrs, rz) : E.negotiate(L, p.pid, m.kind, amt, yrs, rz);
    if (!r.ok) { if (!r.agent) toast(r.error, 3000); renderModal(); return; }
    toast(m.kind === 'resign' ? `${p.name} re-signed!` : m.kind === 'ext' ? `${p.name} extended!` : r.signed ? `${p.name} signed!` : 'Offer submitted.'); S.modal = null; autosave(); render();
  },
  ilPlace(d) { const r = E.placeIL(S.L, +d.pid); if (!r.ok) return toast(r.error); toast('Moved to the injured list. That opens a roster spot.'); autosave(); render(); },
  ilAct(d) { const r = E.activateIL(S.L, +d.pid); if (!r.ok) return toast(r.error); toast('Activated.'); autosave(); render(); },
  release(d) { const p = E.getP(S.L, +d.pid); const g = p.contract && !(p.contract.ng && S.L.phase !== 'REGULAR'); if (!confirm(`Release ${p.name}?${g ? ` His remaining salary (${M(p.contract.amt)}/yr through ${p.contract.exp}) stays on your cap.` : ''}`)) return; E.release(S.L, p);
    if (S.modal?.type === 'cut') { if (E.teamPlayers(S.L, S.L.userTid).length <= E.ROSTER_MAX) S.modal = null; autosave(); render(); return; }
    if (S.page.n === 'player') S.page = S.stack.pop() || { n: 'team' }; autosave(); render(); },
  autoCut() { const cut = E.autoCut(S.L); S.modal = null; if (cut.length) toast('Released: ' + cut.join(', '), 3500); autosave(); render(); },
  tradeFor(d) { const p = E.getP(S.L, +d.pid); S.trade = { tid: p.tid, a: [], ap: [], b: [p.pid], bp: [] }; S.tab.trade = 'machine'; root('trade'); },
  tAddSuggest(d) { const tr = S.trade; if (d.kind === 'p') tr.a.push(+d.id); else tr.ap.push(d.id); render(); },
  tclear() { S.trade = { tid: S.trade.tid, a: [], ap: [], b: [], bp: [] }; render(); },
  propose() { const L = S.L, tr = S.trade; const o = { tidA: L.userTid, tidB: tr.tid, aPids: tr.a, aPicks: tr.ap, bPids: tr.b, bPicks: tr.bp }; const ev = E.evaluateTrade(L, o); if (!ev.ok) return toast(ev.error); const t = E.executeTrade(L, o); L.inbox.unshift({ id: L.msgId++, season: L.season, day: L.day, from: 'Front Office', subject: 'Trade completed', body: t, read: false }); toast('Trade accepted!'); S.trade = null; autosave(); render(); },
  staffRole(d) { S.staffRole = d.r; render(); },
  hire(d) { const r = E.hireStaff(S.L, +d.sid); if (!r.ok) return toast(r.error); toast('Hired!'); autosave(); render(); },
  promoteAC() { if (!confirm('Promote your assistant to head coach? Your current head coach leaves.')) return; const r = E.promoteAssistant(S.L); if (!r.ok) return toast(r.error); toast('Promoted to head coach'); autosave(); render(); },
  fire(d) { if (!confirm('Fire this staff member?')) return; E.fireStaff(S.L, d.role); autosave(); render(); },
  autoRot() { const t = T(S.L.userTid); t.autoRotation = !t.autoRotation; if (!t.autoRotation) t.rotation = E.autoRotation(E.teamPlayers(S.L, S.L.userTid)); autosave(); render(); },
  mv(d) { const rot = ensureRotation(); const pid = +d.pid; const o = rot.order; const i = o.indexOf(pid), j = i + +d.d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]];
    rot.starters = o.slice(0, 5); for (const s of rot.starters) if ((rot.minutes[s] || 0) < 20) rot.minutes[s] = 28; autosave(); render(); },
  mins(d) { const rot = ensureRotation(); const pid = +d.pid; rot.minutes[pid] = Math.max(0, Math.min(48, (rot.minutes[pid] || 0) + +d.d)); autosave(); render(); },
  chgPos(d) { const r = E.changePosition(S.L, +d.pid, d.pos); if (!r.ok) return toast(r.error); toast(`Now playing ${d.pos} · OVR ${R(r.ovr)}`); autosave(); render(); },
  readMsg(d) { const m = S.L.inbox.find(x => x.id === +d.id); m.read = true; S.openMsg = S.openMsg === m.id ? null : m.id; autosave(); render(); },
  readAll() { S.L.inbox.forEach(m => m.read = true); autosave(); render(); },
  msgFilter(d) { S.msgFilter = d.k; render(); },
  takeJob(d) { const L = S.L; if (L.gm.fired) L.jobMarket = E.jobMarket(L); const r = E.changeTeam(L, +d.tid); if (!r.ok) return toast(r.error); S.trade = null; toast(`Welcome to ${T(L.userTid).city}!`); autosave(); root('home'); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
  if (el.dataset.hold && e.detail === 0) return;
  const a = A[el.dataset.a]; if (a) { e.preventDefault(); e.stopPropagation(); Promise.resolve(a(el.dataset, el)).catch(err => { console.error(err); overlay(null); toast('Error: ' + err.message, 4000); }); }
});
// hold-to-repeat on +/- steppers (PGM2 Go On Holiday)
document.addEventListener('pointerdown', (e) => { const el = e.target.closest('[data-hold]'); if (!el) return; let n = 0; clearInterval(holdT); holdT = setInterval(() => { if (++n > 2) A[el.dataset.a](el.dataset); }, 120); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, () => clearInterval(holdT)));
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.ng) { const k = el.dataset.ng; let v = el.value; if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v) && k !== 'gmName') v = +v; S.ng[k] = v; if (['archetype', 'rosters', 'start', 'startYear'].includes(k)) render(); return; }
  if (el.dataset.set) { const k = el.dataset.set; let v = el.value; if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v)) v = +v; S.L.settings[k] = v; E.ensureSettings(S.L); autosave(); render(); toast('Setting saved'); return; }
  if (el.dataset.ngf) { const k = el.dataset.ngf; let v = el.value; if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v)) v = +v; if (k === 'draftClasses') S.ng.draftClasses = v; else (S.ng.franchise ||= {})[k] = v; render(); return; }
  if (el.dataset.edh) { edUS(el); return; }
  if (el.dataset.ed) { edInput(el, true); return; }
  if (el.dataset.a === 'tteam') { S.trade = { tid: +el.value, a: [], ap: [], b: [], bp: [] }; render(); return; }
  if (el.dataset.a === 'tsel') { const tr = S.trade; const key = el.dataset.side + (el.dataset.kind === 'k' ? 'p' : ''); const id = el.dataset.kind === 'k' ? el.dataset.id : +el.dataset.id; tr[key] = el.checked ? [...tr[key], id] : tr[key].filter(x => x !== id); render(); return; }
  if (el.dataset.a === 'dcgYear') { S.dcgYear = +el.value; render(); return; }
  if (el.dataset.a === 'dcgMode') { const G = dcGlobal(); const y = S.dcgYear; const g = G[y] ||= { name: `Custom ${y} class`, mode: 'merge', prospects: [], remove: [] }; g.mode = el.value; dcGSave(G); render(); return; }
  if (el.dataset.a === 'dcYear') { S.dcYear = +el.value; render(); return; }
  if (el.id === 'dcFile' && el.files[0]) { el.files[0].text().then((txt) => { const f = JSON.parse(txt); const v = E.validateClass(f); if (!v.ok) throw new Error(v.error); const a = dcPresets(); a.push(f); dcSave(a); toast(`Imported "${f.name}" (${f.prospects.length})`); render(); }).catch(err => toast('Draft class: ' + err.message, 4000)); return; }
  if (el.id === 'rosterFile' && el.files[0]) {
    const name = el.files[0].name; el.files[0].text().then((txt) => { const f = JSON.parse(txt); const v = E.validateRosterFile(f); if (!v.ok) throw new Error(v.error);
      S.ng.rosterFile = f; S.ng.rosterName = name; S.ng.start = 'PRESEASON'; toast(`Loaded ${f.players.length} players.`); render(); }).catch(err => toast('Roster file: ' + err.message, 4000));
    return;
  }
  if (el.id === 'importFile' && el.files[0]) {
    el.files[0].text().then(async (txt) => {
      const L = JSON.parse(txt); if (!L.teams || !L.players) throw new Error('Not a Hardwood GM save');
      const slot = +(prompt('Import into which slot (1-3)?', '1') || 0); if (![1, 2, 3].includes(slot)) return;
      await loadData().catch(() => {}); attach(L); S.slot = slot; await saveSlot(slot, L); S.view = 'main'; root('home'); toast('Imported!');
    }).catch(err => toast('Import failed: ' + err.message, 4000));
  }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.a === 'offAmt') { S.modal.amt = +el.value; S.modal.keepScroll = true; renderModal(); }
  if (el.dataset.ed) { edInput(el, false); }
  if (el.dataset.a === 'fpQ') { S.fpQ = el.value; clearTimeout(S._fpT); S._fpT = setTimeout(() => { render(); const i = document.querySelector('[data-a="fpQ"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }
  if (el.dataset.a === 'apQ') { S.apQ = el.value; clearTimeout(S._apT); S._apT = setTimeout(() => { render(); const i = document.querySelector('[data-a="apQ"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }
  if (el.dataset.ng === 'gmName') S.ng.gmName = el.value;
});
// editor fields: sliders update live (OVR + value) without re-rendering; selects that change layout re-render
function edUS(el) {
  if (!S.ed) return; const m = S.ed.m, k = el.dataset.edh;
  if (k === 'lb') { if (el.value !== '') m.w = Math.round(+el.value / 2.20462 * 10) / 10; return; }
  const ti = Math.round((+m.h || 0) / 2.54); let ft = Math.floor(ti / 12), inch = ti % 12;
  if (k === 'ft') ft = +el.value; else inch = +el.value;
  m.h = Math.round((ft * 12 + inch) * 2.54 * 10) / 10; render();
}
function edInput(el, commit) {
  if (!S.ed) return; const path = el.dataset.ed; let v = el.value;
  const numeric = /^(attrs\.|pot$|peak$|age$|h$|w$|mood$|lon$|tid$|contract\.|injury\.games$)/.test(path);
  if (numeric && v !== '') v = +v;
  if (path === 'injury.type' && !S.ed.m.injury) S.ed.m.injury = { type: '', games: 5 };
  if (path.startsWith('contract.') && !S.ed.m.contract) S.ed.m.contract = { amt: E.minSalary(S.L.season), yrs: 1, raise: 0 };
  edSet(path, v);
  if (path.startsWith('attrs.') || path === 'pot') {
    const b = document.getElementById('v-' + path.replace('.', '-')); if (b) { b.textContent = v; b.className = qc(E.internalFor(+v)); }
    const o = document.getElementById('edOvr'); const p = E.getP(S.L, S.ed.pid); if (o && p) { const ov = E.previewOvr(p, S.ed.m); o.textContent = ov; o.className = 'n ' + qc(E.internalFor(ov)); }
    return;
  }
  if (commit && ['tid', 'injury.type', 'pos', 'devTrait'].includes(path)) { const y = window.scrollY; render(); window.scrollTo(0, y); }
}
boot();
