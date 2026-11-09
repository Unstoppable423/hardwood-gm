import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from '../src/ui/storage.js';
import { parseImportedSave, controlledSnapshot } from '../src/ui/savefile.js';
import {
  CANCEL_MESSAGE, backupByteSize, backupFilename, backupIntro, backupRoutes, backupSizeLabel, backupText,
  canShareFiles, downloadAttemptResult, runBackupRoute, shareFileFor,
} from '../src/ui/backup.js';

function league() {
  return {
    version: 1, season: 1999, phase: 'REGULAR', day: 40, userTid: 0, _pmap: new Map([[1, 'skip-me']]),
    settings: { cpuTrades: false, seasonGames: 82, playoffTeams: 16, injuries: 1, difficulty: 'Medium' },
    teams: [{ tid: 0, abbr: 'CLE', city: 'Cleveland', name: 'Cavaliers', rotation: { starters: [1, 2], order: [1, 2, 3], minutes: { 1: 36 } } }],
    players: [
      { pid: 1, name: 'Terrell Brandon', tid: 0, ovr: 88, pot: 88, contract: { amt: 5000 } },
      { pid: 2, name: 'Chris Mills', tid: 0, ovr: 81, pot: 81, contract: null },
      { pid: 3, name: 'Bench', tid: -1, ovr: 72, pot: 76, contract: null },
    ],
    picks: [{ id: '0-1999-1', tid: 0, orig: 0, season: 1999, round: 1 }],
    schedule: [{ played: true }, { played: false }],
    tradeOffers: [{ id: 7 }],
    gm: { name: 'Mitchell' },
  };
}

const abort = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });

test('the backup is the slot JSON, drops only the index, and does not mutate the league', () => {
  const L = league();
  const before = serialize(L);
  const text = backupText(L, serialize);
  assert.equal(text, before);
  assert.equal(serialize(L), before);
  assert.equal(L._pmap.get(1), 'skip-me');
  assert.equal(text.includes('_pmap'), false);
  assert.equal(text.includes('Terrell Brandon'), true);
  const parsed = JSON.parse(text);
  assert.equal(parsed.settings.cpuTrades, false);
  assert.equal(parsed.settings.seasonGames, 82);
  assert.equal(parsed.settings.playoffTeams, 16);
  assert.equal(parsed.settings.injuries, 1);
  assert.equal(parsed.players[0].ovr, 88);
  assert.deepEqual(parsed.picks, L.picks);
});

test('a backup round-trips through the import reader without rewriting fields', () => {
  const L = league();
  const text = backupText(L, serialize);
  const r = parseImportedSave(text);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r.league), text);
  const snap = controlledSnapshot(r.league);
  assert.equal(snap.abbr, 'CLE');
  assert.equal(snap.season, 1999);
  assert.equal(snap.phase, 'REGULAR');
  assert.deepEqual(snap.starters, [1, 2]);
  assert.equal(snap.roster.length, 2);
  assert.equal(snap.roster[0][2], 88);
});

test('filenames stay import-friendly and size is the UTF-8 byte count', () => {
  assert.equal(backupFilename(league()), 'hardwood-gm-CLE-1999-REGULAR.json');
  assert.equal(backupFilename({ season: 2000, phase: 'FA 1', userTid: 0, teams: [{ abbr: 'N Y' }] }), 'hardwood-gm-NY-2000-FA1.json');
  assert.equal(backupFilename({}), 'hardwood-gm-save-season-game.json');
  const text = '{"n":"é"}';
  assert.equal(backupByteSize(text), new TextEncoder().encode(text).length);
  assert.match(backupSizeLabel('x'.repeat(2048)), /KB/);
});

test('routes follow the capabilities this browser reports', () => {
  assert.deepEqual(backupRoutes({ canSave: true, canShare: true, canDownload: true }), ['save', 'share', 'download', 'copy']);
  assert.deepEqual(backupRoutes({ canShare: true, canDownload: true }), ['share', 'download', 'copy']);
  assert.deepEqual(backupRoutes({ canDownload: true }), ['download', 'copy']);
  assert.deepEqual(backupRoutes({}), ['copy']);
  assert.match(backupIntro({ canSave: true }), /confirms the write/);
  assert.match(backupIntro({ canShare: true }), /share sheet/);
  assert.match(backupIntro({}), /in-app browser/);
  for (const caps of [{ canSave: true }, { canShare: true }, {}]) assert.match(backupIntro(caps), /Nothing is uploaded/);
});

test('share detection accepts JSON, then plain text, and treats a throw as unsupported', () => {
  class FakeFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } }
  const jsonOnly = { share() {}, canShare({ files }) { return files[0].type === 'application/json'; } };
  const plainOnly = { share() {}, canShare({ files }) { return files[0].type === 'text/plain'; } };
  const neither = { share() {}, canShare() { return false; } };
  const exploding = { share() {}, canShare() { throw new Error('nope'); } };
  const json = shareFileFor(jsonOnly, 'hardwood-gm-CLE-1999-REGULAR.json', '{"ok":1}', FakeFile);
  assert.equal(json.type, 'application/json');
  assert.equal(json.name, 'hardwood-gm-CLE-1999-REGULAR.json');
  assert.equal(json.parts[0], '{"ok":1}');
  const plain = shareFileFor(plainOnly, 'a.json', '{"ok":1}', FakeFile);
  assert.equal(plain.type, 'text/plain');
  assert.equal(plain.name, 'a.json');
  assert.equal(shareFileFor(neither, 'a.json', '{}', FakeFile), null);
  assert.equal(shareFileFor(exploding, 'a.json', '{}', FakeFile), null);
  assert.equal(canShareFiles(null, {}), false);
  assert.equal(canShareFiles({ canShare() { return true; } }, {}), false);
});

test('a confirmed save is the only route that says the file was written', async () => {
  const text = backupText(league(), serialize);
  let written = null;
  let closed = false;
  const r = await runBackupRoute('save', {
    text, filename: 'hardwood-gm-CLE-1999-REGULAR.json',
    io: {
      showSaveFilePicker: async (opts) => {
        assert.equal(opts.suggestedName, 'hardwood-gm-CLE-1999-REGULAR.json');
        return { createWritable: async () => ({ write: async (data) => { written = data; }, close: async () => { closed = true; } }) };
      },
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.confirmed, true);
  assert.equal(written, text);
  assert.equal(closed, true);
  assert.match(r.message, /confirmed the file was written/);
  assert.match(r.message, /Nothing was uploaded/);
});

test('cancelling a save or a share writes nothing and does not claim a file', async () => {
  let wrote = 0;
  const save = await runBackupRoute('save', { text: '{}', filename: 'a.json', io: { showSaveFilePicker: async () => { throw abort(); }, write: () => { wrote++; } } });
  assert.equal(save.cancelled, true);
  assert.equal(save.confirmed, false);
  assert.equal(save.message, CANCEL_MESSAGE);
  assert.equal(wrote, 0);
  let shared = 0;
  const share = await runBackupRoute('share', { text: '{}', filename: 'a.json', file: { name: 'a.json' }, io: { share: async () => { shared++; throw abort(); } } });
  assert.equal(share.cancelled, true);
  assert.equal(share.confirmed, false);
  assert.equal(share.message, CANCEL_MESSAGE);
  assert.equal(shared, 1);
});

test('a failed write after the dialog opens is an error, not a saved file', async () => {
  const r = await runBackupRoute('save', {
    text: '{"a":1}', filename: 'a.json',
    io: { showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: async () => { throw new Error('should not close'); }, abort: async () => {} }) }) },
  });
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, undefined);
  assert.equal(r.confirmed, false);
  assert.match(r.message, /disk full/);
  assert.match(r.message, /Nothing was saved/);
  assert.doesNotMatch(r.message, /confirmed the file/);
});

test('share success, download, and copy never claim the browser saved a file', async () => {
  let payload = null;
  const share = await runBackupRoute('share', {
    text: '{"a":1}', filename: 'a.json', file: { name: 'a.json' },
    io: { share: async (data) => { payload = data; } },
  });
  assert.equal(share.ok, true);
  assert.equal(share.confirmed, false);
  assert.deepEqual(payload.files, [{ name: 'a.json' }]);
  assert.equal(payload.url, undefined);
  assert.match(share.message, /does not say whether a file was saved/);
  assert.doesNotMatch(share.message, /confirmed the file/);

  const dl = downloadAttemptResult('a.json');
  assert.equal(dl.confirmed, false);
  assert.match(dl.message, /does not confirm/);
  assert.match(dl.message, /Nothing was uploaded/);

  let copied = null;
  const copy = await runBackupRoute('copy', { text: '{"a":1}', filename: 'a.json', io: { writeText: async (t) => { copied = t; } } });
  assert.equal(copy.copied, true);
  assert.equal(copy.confirmed, false);
  assert.equal(copied, '{"a":1}');
  assert.match(copy.message, /did not write a file/);
});

test('share and copy failures stay visible and ask for another route', async () => {
  const share = await runBackupRoute('share', {
    text: '{}', filename: 'a.json', file: { name: 'a.json' },
    io: { share: async () => { throw Object.assign(new Error('Share blocked'), { name: 'NotAllowedError' }); } },
  });
  assert.equal(share.ok, false);
  assert.equal(share.cancelled, undefined);
  assert.match(share.message, /Share blocked/);
  assert.match(share.message, /Try Download or Copy/);

  const copy = await runBackupRoute('copy', { text: '{"keep":1}', filename: 'a.json', io: { writeText: async () => { throw new Error('Clipboard denied'); } } });
  assert.equal(copy.reveal, true);
  assert.match(copy.message, /Select the backup text/);
  assert.match(copy.message, /Clipboard denied/);

  const missing = await runBackupRoute('share', { text: '{}', filename: 'a.json', io: {} });
  assert.match(missing.message, /cannot share a file/);
  const noClip = await runBackupRoute('copy', { text: '{}', filename: 'a.json', io: {} });
  assert.equal(noClip.reveal, true);
});
