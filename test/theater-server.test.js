'use strict';
// 城牆觀影館：兩台螢幕各自獨立的播放時鐘（管理 API）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');

async function startServer(t, { steppedClock = false, fixture } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hall-theater-'));
  if (fixture) writeFileSync(path.join(dir, 'state.json'), JSON.stringify(fixture));
  const bootstrap = `const http = require('http');
    // 每次讀取都推進 7ms，讓「兩台各自讀時鐘」的錯誤必然浮現，避免靠執行速度碰巧通過。
    if (${steppedClock}) { let now = 1800000000000; Date.now = () => now += 7; }
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
      this.once('listening', () => console.log('QA_PORT=' + this.address().port));
      return listen.apply(this, args);
    }; require('./server.js');`;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', DATA_FILE: path.join(dir, 'state.json'), ADMIN_PASSWORD: 'theater-test' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; const m = output.match(/QA_PORT=(\d+)/); if (m) resolve(Number(m[1])); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error('server exit ' + code)));
  });
  const request = async (route, body, expect = 200, password = 'theater-test') => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + password, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(r.status, expect); return r.json();
  };
  return { call: (body, expect, password) => request('theater', body, expect, password), get: () => request('state') };
}

test('觀影館 API：同時開始、單台微調、同時暫停、音量、清除', { timeout: 20000 }, async (t) => {
  const { call } = await startServer(t);
  let st = await call({ screen: 'both', action: 'set', urlA: 'https://youtu.be/dQw4w9WgXcQ?t=20', urlB: 'https://www.youtube.com/live/jfKfPfyJRdk' });
  assert.equal(st.theater.a.id, 'dQw4w9WgXcQ'); assert.ok(st.theater.a.position >= 20 && st.theater.a.position < 21);
  assert.equal(st.theater.b.id, 'jfKfPfyJRdk'); assert.equal(st.theater.b.live, true);
  assert.notEqual(st.theater.a.seq, st.theater.b.seq);
  st = await call({ screen: 'a', action: 'skip', seconds: -5 });
  assert.ok(st.theater.a.position >= 15 && st.theater.a.position < 16);
  st = await call({ screen: 'both', action: 'pause' });
  assert.equal(st.theater.a.playing, false); assert.equal(st.theater.b.playing, false);
  st = await call({ screen: 'b', action: 'gain', gain: 40 });
  assert.equal(st.theater.b.gain, 40); assert.equal(st.theater.a.gain, 100);
  await call({ screen: 'b', action: 'gain', gain: 140 }, 400);
  await call({ screen: 'c', action: 'play' }, 400);
  await call({ screen: 'a', action: 'set', url: 'not a url' }, 400);
  st = await call({ screen: 'b', action: 'clear' });
  assert.equal(st.theater.b, null); assert.equal(st.theater.a.id, 'dQw4w9WgXcQ');
  // 換片後音量比例保留；大廳大螢幕不受影響
  st = await call({ screen: 'a', action: 'set', url: 'https://youtu.be/C3GouGa0noM' });
  assert.equal(st.theater.a.id, 'C3GouGa0noM'); assert.equal(st.mode, 'music');
});

const pair = { screen: 'both', action: 'set', urlA: 'https://youtu.be/dQw4w9WgXcQ?t=20', urlB: 'https://youtu.be/C3GouGa0noM?t=20' };
function delta(st, seconds) { assert.ok(Math.abs(st.theater.b.position - st.theater.a.position - seconds) < 1e-8, JSON.stringify(st.theater)); }

test('雙台共用時間點：開始、從頭、暫停、繼續、跳轉與小數微調', { timeout: 20000 }, async (t) => {
  const { call, get } = await startServer(t, { steppedClock: true });
  delta(await call(pair), 0);
  for (const action of ['pause', 'play', 'restart', 'pause', 'restart']) {
    const st = await call({ screen: 'both', action });
    delta(st, 0);
    assert.equal(st.theater.a.playing, action !== 'pause');
    assert.equal(st.theater.b.playing, action !== 'pause');
  }
  delta(await call({ screen: 'both', action: 'seek', seconds: 30.25 }), 0);
  delta(await call({ screen: 'both', action: 'skip', seconds: -0.5 }), 0);
  const paused = await call({ screen: 'both', action: 'pause' });
  let st = await call({ screen: 'b', action: 'skip', seconds: 0.5 });
  assert.equal(st.theater.a.position, paused.theater.a.position);
  assert.equal(st.theater.a.seq, paused.theater.a.seq);
  assert.notEqual(st.theater.b.seq, paused.theater.b.seq); // 讓播放器強制套用小於 2 秒的跳轉
  delta(st, 0.5);
  const nudgedSeq = st.theater.b.seq;
  st = await call({ screen: 'b', action: 'skip', seconds: -0.5 });
  assert.notEqual(st.theater.b.seq, nudgedSeq);
  delta(st, 0);
  assert.deepEqual((await get()).theater, st.theater);
});

test('以 I 對齊 II：播放中維持正負小數偏移，強制同步 II 並保留 I 與音量', { timeout: 20000 }, async (t) => {
  const { call, get } = await startServer(t, { steppedClock: true });
  const initial = await call(pair);
  await call({ screen: 'b', action: 'gain', gain: 35 });
  for (const offset of [-3.5, 1.25, 0]) {
    const aligned = await call({ screen: 'b', action: 'align', offset });
    delta(aligned, offset);
    assert.equal(aligned.theater.a.seq, initial.theater.a.seq);
    assert.notEqual(aligned.theater.b.seq, initial.theater.b.seq);
    assert.equal(aligned.theater.b.id, initial.theater.b.id);
    assert.equal(aligned.theater.b.gain, 35);
    assert.equal(aligned.theater.a.playing, true); assert.equal(aligned.theater.b.playing, true);
    for (let i = 0; i < 3; i++) delta(await get(), offset);
    delta(await call({ screen: 'both', action: 'pause' }), offset);
    delta(await call({ screen: 'both', action: 'play' }), offset);
  }
});

test('對齊保留暫停狀態、以零與已知片長為界，並支援單邊暫停', { timeout: 20000 }, async (t) => {
  const channel = (id, pos, dur) => ({ id, live: false, playing: false, pausedAt: pos, startedAt: 0, dur, seq: 10, gain: 60 });
  const fixture = { theater: { a: channel('dQw4w9WgXcQ', 10, 120), b: channel('C3GouGa0noM', 3, 12) } };
  const { call } = await startServer(t, { fixture });
  for (const [offset, expected] of [[50, 12], [-20, 0], [-3.5, 6.5], ['0.125', 10.125]]) {
    const st = await call({ screen: 'both', action: 'align', offset });
    assert.equal(st.theater.a.position, 10); assert.equal(st.theater.b.position, expected);
    assert.equal(st.theater.b.dur, 12); assert.equal(st.theater.b.gain, 60);
    assert.equal(st.theater.a.playing, false); assert.equal(st.theater.b.playing, false);
  }
  await call({ screen: 'a', action: 'play' });
  let st = await call({ screen: 'b', action: 'align', offset: -3.5 });
  assert.equal(st.theater.a.playing, true); assert.equal(st.theater.b.playing, false);
  await call({ screen: 'a', action: 'pause' }); await call({ screen: 'b', action: 'play' });
  st = await call({ screen: 'b', action: 'align', offset: -3.5 });
  assert.equal(st.theater.a.playing, false); assert.equal(st.theater.b.playing, true);
});

test('組合套用在一次請求換兩片並對齊；無效輸入不得部分套用', { timeout: 20000 }, async (t) => {
  const { call, get } = await startServer(t, { steppedClock: true });
  delta(await call({ ...pair, offset: -3.5 }), -3.5);
  const paused = await call({ screen: 'both', action: 'pause' });
  for (const offset of [undefined, null, '', 'bad', 'Infinity', '1e309', {}, [], true, 1e308]) {
    await call({ screen: 'b', action: 'align', offset }, 400);
    assert.deepEqual((await get()).theater, paused.theater);
  }
  for (const invalid of [
    { ...pair, offset: 'bad' }, { ...pair, offset: null }, { ...pair, urlB: 'bad', offset: 2 },
    { ...pair, startB: 'Infinity', offset: 2 }, { ...pair, urlB: '', offset: 2 },
    { screen: 'a', action: 'set', url: pair.urlA, offset: 2 },
    { screen: 'a', action: 'align', offset: 2 },
    { screen: 'both', action: 'seek', seconds: null }, { screen: 'both', action: 'skip', seconds: 'bad' },
    { screen: 'both', action: 'gain', gain: 101 }, { screen: 'both', action: 'unknown' },
  ]) {
    await call(invalid, 400); assert.deepEqual((await get()).theater, paused.theater);
  }
  await call({ screen: 'b', action: 'align', offset: 0 }, 401, 'wrong-password');
  assert.deepEqual((await get()).theater, paused.theater);
});

test('直播任一端略過對齊並提示；缺片拒絕，組合仍可換片', { timeout: 20000 }, async (t) => {
  const { call, get } = await startServer(t);
  await call({ screen: 'b', action: 'align', offset: 0 }, 400);
  await call({ screen: 'a', action: 'set', url: pair.urlA });
  await call({ screen: 'b', action: 'align', offset: 0 }, 400);
  for (const live of [{ liveA: true }, { liveB: true }]) {
    const st = await call({ ...pair, ...live, offset: -3.5 });
    assert.equal(st.skipped, true); assert.match(st.message, /直播.*略過/);
    const paused = await call({ screen: 'both', action: 'pause' });
    const skipped = await call({ screen: 'b', action: 'align', offset: 2.5 });
    assert.equal(skipped.skipped, true); assert.match(skipped.message, /直播.*略過/);
    assert.deepEqual(skipped.theater, paused.theater);
    assert.deepEqual((await get()).theater, paused.theater);
    assert.equal(skipped.theater.a.id, 'dQw4w9WgXcQ'); assert.equal(skipped.theater.b.id, 'C3GouGa0noM');
  }
});

test('實際播放器同步契約：API 的半秒跳轉會觸發 seek，不會被兩秒容差忽略', { timeout: 20000 }, async (t) => {
  const { call } = await startServer(t);
  await call(pair);
  const before = (await call({ screen: 'both', action: 'pause' })).theater.b;
  const source = readFileSync(path.join(__dirname, '../public/js/screen.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export class ScreenLayer', 'class ScreenLayer').replace('export class BigScreen', 'globalThis.BigScreen = class BigScreen');
  const sandbox = { window: {}, performance: { now: () => 0 }, setInterval: () => 0, clearInterval() {} };
  vm.runInNewContext(source, sandbox);
  const screen = Object.create(sandbox.BigScreen.prototype), seeks = [];
  Object.assign(screen, { ready: true, active: true, muted: true, volume: 100, fade: 1, transId: 0, state: { ...before }, updateOverlay() {} });
  screen.player = { getVideoData: () => ({ video_id: before.id }), getPlayerState: () => 2, getCurrentTime: () => before.position, seekTo: s => seeks.push(s), setVolume() {}, mute() {} };
  screen.setChannel(before);
  assert.equal(seeks.length, 0);
  for (const seconds of [0.5, -0.5]) {
    const after = (await call({ screen: 'b', action: 'skip', seconds })).theater.b;
    screen.setChannel(after);
    assert.equal(seeks.at(-1), after.position);
  }
  assert.equal(seeks.length, 2);
});
