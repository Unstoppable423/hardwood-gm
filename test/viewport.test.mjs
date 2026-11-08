import test from 'node:test';
import assert from 'node:assert/strict';
import { viewportBox } from '../src/ui/viewport.js';

test('top browser chrome shifts the shell below it and keeps the visible height', () => {
  const b = viewportBox({ innerHeight: 844, offsetTop: 94, height: 650, scale: 1 });
  assert.equal(b.active, true);
  assert.equal(b.top, 94);
  assert.equal(b.height, 650);
  assert.equal(b.bottom, 100);
});

test('a bottom toolbar is only the gap under the visible area', () => {
  const b = viewportBox({ innerHeight: 844, offsetTop: 0, height: 700, scale: 1 });
  assert.deepEqual(b, { active: true, top: 0, height: 700, bottom: 144 });
});

test('rotation uses the visual height, not the old portrait height', () => {
  const b = viewportBox({ innerHeight: 390, offsetTop: 40, height: 320, scale: 1 });
  assert.equal(b.top, 40);
  assert.equal(b.height, 320);
  assert.equal(b.bottom, 30);
});

test('pinch zoom does not move the shell', () => {
  const b = viewportBox({ innerHeight: 800, offsetTop: 120, height: 400, scale: 1.6 });
  assert.equal(b.active, false);
  assert.equal(b.top, 0);
});

test('rubber-band and nonsense offsets are not treated as chrome', () => {
  assert.equal(viewportBox({ innerHeight: 800, offsetTop: -30, height: 800 }).top, 0);
  assert.equal(viewportBox({ innerHeight: 800, offsetTop: 900, height: 800 }).top, 0);
  const tiny = viewportBox({ innerHeight: 700, offsetTop: 0, height: 80 });
  assert.equal(tiny.height, 700);
});
