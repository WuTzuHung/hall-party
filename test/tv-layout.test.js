import test from 'node:test';
import assert from 'node:assert/strict';
import { tvLayout } from '../public/js/tv-layout.js';

const ar = (r) => r.w / r.h;
test('單看 I：滿版 16:9，II 隱藏但保留', () => {
  const L = tvLayout(1920, 1080, { layout: 'a' });
  assert.equal(L.a.show, true); assert.equal(L.b.show, false);
  assert.ok(Math.abs(L.a.w - 1920) < 1 && Math.abs(L.a.h - 1080) < 1);
});
test('並排：橫向螢幕左右排，比例可調，兩台都 16:9 且不重疊', () => {
  for (const ratio of [0.25, 0.5, 0.7]) {
    const L = tvLayout(1600, 900, { layout: 'split', ratio, gap: 10 });
    assert.equal(L.dir, 'row');
    assert.ok(Math.abs(ar(L.a) - 16 / 9) < 1e-6 && Math.abs(ar(L.b) - 16 / 9) < 1e-6);
    assert.ok(L.a.x + L.a.w <= L.b.x + 1e-6);
    assert.ok(L.b.x + L.b.w <= 1600 + 1e-6 && L.a.x >= -1e-6);
  }
});
test('並排：直式手機改成上下排', () => {
  const L = tvLayout(390, 844, { layout: 'split', gap: 8 });
  assert.equal(L.dir, 'col');
  assert.ok(L.a.y + L.a.h <= L.b.y + 1e-6);
});
test('並排交換：swap 後 II 在前', () => {
  const L = tvLayout(1600, 900, { layout: 'split', swap: true });
  assert.ok(L.b.x < L.a.x);
});
test('子母畫面：主畫面滿版，小畫面在指定角落、在畫面內', () => {
  for (const corner of [0, 1, 2, 3]) {
    const L = tvLayout(1600, 900, { layout: 'pip', main: 'b', corner, pipSize: 0.3 });
    assert.equal(L.a.pip, true);
    assert.ok(L.a.w < L.b.w);
    assert.ok(L.a.x >= 0 && L.a.y >= 0 && L.a.x + L.a.w <= 1600 && L.a.y + L.a.h <= 900);
    assert.equal(L.a.x + L.a.w / 2 > 800, corner % 2 === 1);
    assert.equal(L.a.y + L.a.h / 2 > 450, corner >= 2);
  }
});
test('子母畫面：直式手機小畫面放在主畫面外，不遮住', () => {
  const L = tvLayout(390, 844, { layout: 'pip', main: 'a', corner: 3 });
  assert.ok(L.b.y >= L.a.y + L.a.h - 1e-6);
});
