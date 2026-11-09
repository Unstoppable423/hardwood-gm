// Backup export routes. The old Export button clicked a detached <a download>
// and revoked the blob URL two seconds later. Browsers that ignore that click
// (common in mobile Safari and in-app web views) raise no error, so the tap
// looks dead. These helpers pick a route from capabilities the page can see,
// and they never describe a file as saved unless the caller observed a
// confirmed write.

const CANCEL_MESSAGE = 'Cancelled. Nothing was saved, and your game was not changed.';

export function backupFilename(L) {
  const team = L && L.teams ? L.teams[L.userTid] : null;
  const part = (v, fallback) => String(v == null || v === '' ? fallback : v).replace(/[^A-Za-z0-9._-]+/g, '') || fallback;
  return `hardwood-gm-${part(team && team.abbr, 'save')}-${part(L && L.season, 'season')}-${part(L && L.phase, 'game')}.json`;
}

// Same string the slot writer stores. The serializer is passed in so this file
// cannot drift onto a second JSON shape. It must not rewrite the league.
export function backupText(L, serialize) {
  if (typeof serialize !== 'function') throw new Error('Could not build the backup.');
  const text = serialize(L);
  if (typeof text !== 'string' || !text) throw new Error('The backup was empty.');
  return text;
}

export function backupByteSize(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).length;
  return String(text).length;
}

export function backupSizeLabel(text) {
  const n = backupByteSize(text);
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function canShareFiles(nav, file) {
  if (!nav || typeof nav.canShare !== 'function' || typeof nav.share !== 'function' || !file) return false;
  try { return nav.canShare({ files: [file] }) === true; }
  catch { return false; }
}

// Prefer a JSON file type. If this browser will only share plain text, use
// that for the share sheet and keep the same bytes and .json name.
export function shareFileFor(nav, filename, text, FileCtor = globalThis.File) {
  if (typeof FileCtor !== 'function') return null;
  const json = new FileCtor([text], filename, { type: 'application/json' });
  if (canShareFiles(nav, json)) return json;
  const plain = new FileCtor([text], filename, { type: 'text/plain' });
  if (canShareFiles(nav, plain)) return plain;
  return null;
}

export function backupRoutes(caps = {}) {
  const routes = [];
  if (caps.canSave) routes.push('save');
  if (caps.canShare) routes.push('share');
  if (caps.canDownload) routes.push('download');
  routes.push('copy');
  return routes;
}

export function backupIntro(caps = {}) {
  const base = 'This is a complete copy of this game, the same JSON the Import button reads. Slots on this device stay as they are. Nothing is uploaded.';
  if (caps.canSave) return `${base} Save file asks where to write it. This game says the file was saved only after the browser confirms the write.`;
  if (caps.canShare) return `${base} Share or Save to Files opens the system share sheet. This game cannot see whether you saved a file, sent it, or cancelled.`;
  return `${base} This browser has no save dialog and cannot share a file. Download may do nothing, including inside an in-app browser. Copy backup text keeps the whole file so you can paste it into Notes or Mail.`;
}

export function downloadAttemptResult(filename) {
  return {
    ok: true,
    route: 'download',
    confirmed: false,
    filename,
    message: `This browser was asked to download ${filename}. It does not confirm that the file finished saving. If no file appeared, use Copy or another option on this screen. Your game was not changed. Nothing was uploaded.`,
  };
}

function isAbort(err) {
  return !!err && err.name === 'AbortError';
}

function detail(err, fallback) {
  const msg = err && err.message ? String(err.message).trim() : '';
  return msg || fallback;
}

function cancelled(route) {
  return { ok: false, cancelled: true, route, confirmed: false, message: CANCEL_MESSAGE };
}

function failed(route, why) {
  const lead = route === 'share' ? 'Could not open the share sheet'
    : route === 'copy' ? 'Could not copy automatically'
      : 'Could not save the file';
  const next = route === 'share' ? 'Try Download or Copy. '
    : route === 'copy' ? 'Select the backup text below and copy it yourself. '
      : '';
  const detail = String(why || 'Something went wrong.').trim().replace(/[.]+$/, '');
  return {
    ok: false,
    route,
    confirmed: false,
    error: why,
    reveal: route === 'copy',
    message: `${lead}: ${detail}. ${next}Nothing was saved, and your game was not changed.`,
  };
}

export async function runBackupRoute(route, ctx) {
  const text = ctx && ctx.text;
  const filename = ctx && ctx.filename;
  const file = ctx && ctx.file;
  const io = (ctx && ctx.io) || {};
  if (route === 'save') {
    if (typeof io.showSaveFilePicker !== 'function') return failed('save', 'This browser has no save dialog.');
    let handle;
    try {
      handle = await io.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Hardwood GM backup', accept: { 'application/json': ['.json'] } }],
      });
    } catch (err) {
      if (isAbort(err)) return cancelled('save');
      return failed('save', detail(err, 'The save dialog failed.'));
    }
    let writable = null;
    try {
      writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    } catch (err) {
      try { if (writable && writable.abort) await writable.abort(); } catch { /* leave the failed write closed */ }
      if (isAbort(err)) return cancelled('save');
      return failed('save', detail(err, 'The file was not finished.'));
    }
    return {
      ok: true,
      route: 'save',
      confirmed: true,
      filename,
      message: `Saved ${filename}. The browser confirmed the file was written. Your game slots were not changed. Nothing was uploaded.`,
    };
  }
  if (route === 'share') {
    if (typeof io.share !== 'function' || !file) return failed('share', 'This browser cannot share a file.');
    try {
      await io.share({ files: [file], title: filename });
    } catch (err) {
      if (isAbort(err)) return cancelled('share');
      return failed('share', detail(err, 'The share sheet failed.'));
    }
    return {
      ok: true,
      route: 'share',
      confirmed: false,
      filename,
      message: `The share sheet finished for ${filename}. This browser does not say whether a file was saved. Check the app you picked. Your game slots were not changed. Nothing was uploaded.`,
    };
  }
  if (route === 'copy') {
    if (typeof text !== 'string' || !text) return failed('copy', 'The backup was empty.');
    if (typeof io.writeText !== 'function') return failed('copy', 'Clipboard is not available in this browser.');
    try {
      await io.writeText(text);
    } catch (err) {
      if (isAbort(err)) return cancelled('copy');
      return failed('copy', detail(err, 'Clipboard is not available in this browser.'));
    }
    return {
      ok: true,
      route: 'copy',
      confirmed: false,
      copied: true,
      message: 'Copied the backup text. Paste it into Notes or Mail to keep it. The game did not write a file. Your slots were not changed. Nothing was uploaded.',
    };
  }
  if (route === 'download') return downloadAttemptResult(filename);
  return failed('save', 'That export option is not available in this browser.');
}

export { CANCEL_MESSAGE };
