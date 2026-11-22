'use strict';
// 立體機動裝置：借用／歸還要站在裝備庫附近、一人一組、別人拿走的格位不能再借、位置訊息裡的裝備狀態會轉播
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

test('裝備庫：借用、歸還、距離檢查與狀態轉播', { timeout: 20000 }, async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hall-gear-'));
  const bootstrap = `const http = require('http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
      this.once('listening', () => console.log('QA_PORT=' + this.address().port));
      return listen.apply(this, args);
    }; require('./server.js');`;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', TICK_MS: '50', DATA_FILE: path.join(dir, 'state.json'), ADMIN_PASSWORD: 'isolated-gear-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    if (child.exitCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; const m = output.match(/QA_PORT=(\d+)/); if (m) resolve(Number(m[1])); });
    child.once('error', reject);
    child.once('exit', code => reject(new Error('server exit ' + code)));
  });
  async function connect(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
    const welcome = new Promise((resolve, reject) => {
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') resolve(m); });
      ws.once('error', reject);
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name })));
    ws.welcome = await welcome;
    return ws;
  }
  const next = (ws, pred) => new Promise(resolve => { const on = raw => { const m = JSON.parse(raw); if (pred(m)) { ws.off('message', on); resolve(m); } }; ws.on('message', on); });
  const at = (ws, x, z, g) => ws.send(JSON.stringify({ t: 'p', x, y: 0.15, z, ry: 0, a: 0, g }));

  const a = await connect('甲'), b = await connect('乙');
  assert.deepEqual(a.welcome.gears, []);
  // 離裝備庫太遠：不能借
  at(a, 0, 5); let r = next(a, m => m.t === 'gearOk' || m.t === 'gearNo');
  a.send(JSON.stringify({ t: 'gear', take: 0 })); assert.equal((await r).why, 'far');
  // 站到裝備庫前：借第 0 組，其他人收到借用狀態
  at(a, -76.5, 6); at(b, -76, 5.5);
  const seen = next(b, m => m.t === 'gears' && m.s.length === 1);
  r = next(a, m => m.t === 'gearOk' || m.t === 'gearNo');
  a.send(JSON.stringify({ t: 'gear', take: 0 })); assert.equal((await r).slot, 0);
  assert.deepEqual((await seen).s, [[0, a.welcome.id]]);
  // 同一格不能被別人借走；自己再借一次還是原本那組
  r = next(b, m => m.t === 'gearOk' || m.t === 'gearNo');
  b.send(JSON.stringify({ t: 'gear', take: 0 })); assert.equal((await r).why, 'taken');
  r = next(a, m => m.t === 'gearOk' || m.t === 'gearNo');
  a.send(JSON.stringify({ t: 'gear', take: 3 })); assert.equal((await r).slot, 0);
  // 位置訊息裡的裝備狀態（勾鎖位置）會出現在其他人的快照裡；不合法的值會被丟掉
  at(a, -80, 10, [35, -90, 12.5, 3, -91, 13, 4, 1, 0]);
  const snap = await next(b, m => m.t === 's' && m.p.some(e => e[0] === a.welcome.id && Array.isArray(e[6])));
  assert.deepEqual(snap.p.find(e => e[0] === a.welcome.id)[6], [35, -90, 12.5, 3, -91, 13, 4, 1, 0]);
  at(a, -80, 10, ['x']);
  await next(b, m => m.t === 's' && m.p.some(e => e[0] === a.welcome.id && e.length === 6));
  // 離線後自動歸還
  at(a, -76.5, 6);
  const freed = next(b, m => m.t === 'gears' && m.s.length === 0);
  a.close(); await freed;
  // 乙歸還（沒借也不會出錯）、再借
  r = next(b, m => m.t === 'gearOk');
  b.send(JSON.stringify({ t: 'gear', ret: 1 })); assert.equal((await r).slot, -1);
  r = next(b, m => m.t === 'gearOk');
  b.send(JSON.stringify({ t: 'gear', take: 0 })); assert.equal((await r).slot, 0);
});
