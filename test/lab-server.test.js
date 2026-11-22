'use strict';
// 研究所：一台共用的映像管電視、片庫、觀眾遙控器（位置檢查、鎖定、限流）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

async function startServer(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hall-lab-'));
  const bootstrap = `const http = require('http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) { this.once('listening', () => console.log('QA_PORT=' + this.address().port)); return listen.apply(this, args); };
    require('./server.js');`;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', DATA_FILE: path.join(dir, 'state.json'), ADMIN_PASSWORD: 'lab-test' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', d => { out += d; const m = out.match(/QA_PORT=(\d+)/); if (m) resolve(Number(m[1])); });
    child.once('exit', code => reject(new Error('server exit ' + code)));
  });
  const call = async (body, expect = 200) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/lab`, { method: 'POST', headers: { Authorization: 'Bearer lab-test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); assert.equal(r.status, expect, JSON.stringify(j)); return j;
  };
  return { port, call };
}
function player(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d); const w = waiters.find(x => x.f(m)); if (w) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } else inbox.push(m); });
  const next = (f, ms = 3000) => new Promise((r, j) => { const hit = inbox.find(f); if (hit) { inbox.splice(inbox.indexOf(hit), 1); return r(hit); } const w = { f, r }; waiters.push(w); setTimeout(() => j(new Error('timeout')), ms); });
  return new Promise((res) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', color: 'blue', name: 'lab' })); res({ ws, next, send: (m) => ws.send(JSON.stringify(m)) }); }));
}

test('研究所後台：片庫、選集、上下一集、移動時跟著正在播的那一集', { timeout: 20000 }, async (t) => {
  const { call } = await startServer(t);
  await call({ action: 'add', url: 'https://youtu.be/aaaaaaaaaa1', title: '第 1 話' });
  await call({ action: 'add', url: 'https://youtu.be/aaaaaaaaaa2', title: '第 2 話' });
  let st = await call({ action: 'add', url: 'https://youtu.be/aaaaaaaaaa3' });
  assert.equal(st.lab.list.length, 3);
  await call({ action: 'add', url: 'nope' }, 400);
  st = await call({ action: 'pick', index: 1 });
  assert.equal(st.lab.tv.id, 'aaaaaaaaaa2'); assert.equal(st.lab.tv.idx, 1); assert.equal(st.lab.tv.title, '第 2 話');
  st = await call({ action: 'next' }); assert.equal(st.lab.tv.idx, 2);
  await call({ action: 'next' }, 400);
  st = await call({ action: 'prev' }); assert.equal(st.lab.tv.idx, 1);
  st = await call({ action: 'move', index: 1, dir: -1 });
  assert.equal(st.lab.list[0].id, 'aaaaaaaaaa2'); assert.equal(st.lab.tv.idx, 0);
  st = await call({ action: 'remove', index: 0 }); assert.equal(st.lab.tv.idx, -1); assert.equal(st.lab.list.length, 2);
  st = await call({ action: 'pause' }); assert.equal(st.lab.tv.playing, false);
  st = await call({ action: 'skip', seconds: 30 }); assert.ok(st.lab.tv.position >= 30 && st.lab.tv.position < 31);
  st = await call({ action: 'set', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb&t=90', title: '直接播' });
  assert.equal(st.lab.tv.idx, -1); assert.ok(st.lab.tv.position >= 90);
  st = await call({ action: 'lock', on: true }); assert.equal(st.lab.lock, true);
  st = await call({ action: 'clear' }); assert.equal(st.lab.tv, null);
});

test('觀眾遙控器：要在研究所裡、鎖定時不能用、限流', { timeout: 20000 }, async (t) => {
  const { port, call } = await startServer(t);
  await call({ action: 'add', url: 'https://youtu.be/aaaaaaaaaa1' });
  await call({ action: 'add', url: 'https://youtu.be/aaaaaaaaaa2' });
  const p = await player(port);
  await p.next(m => m.t === 'welcome');
  // 在街上：太遠
  p.send({ t: 'p', x: 0, y: 0.15, z: 5, ry: 0, a: 0 });
  await new Promise(r => setTimeout(r, 80));
  p.send({ t: 'lab', a: 'pick', i: 0 });
  assert.equal((await p.next(m => m.t === 'labNo')).why, 'far');
  // 走進研究所（二樓）
  p.send({ t: 'p', x: 70, y: 3.6, z: -4, ry: 0, a: 0 });
  await new Promise(r => setTimeout(r, 80));
  p.send({ t: 'lab', a: 'pick', i: 1 });
  const fx = await p.next(m => m.t === 'labFx');
  assert.equal(fx.i, 1);
  const media = await p.next(m => m.t === 'media' && m.m.lab.tv);
  assert.equal(media.m.lab.tv.id, 'aaaaaaaaaa2');
  p.send({ t: 'lab', a: 'toggle' });
  assert.equal((await p.next(m => m.t === 'labNo')).why, 'busy');
  await call({ action: 'lock', on: true });
  await new Promise(r => setTimeout(r, 1300));
  p.send({ t: 'lab', a: 'toggle' });
  assert.equal((await p.next(m => m.t === 'labNo')).why, 'lock');
  p.ws.close();
});
