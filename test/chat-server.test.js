'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

test('實際 HTTP／WebSocket：繞過前端仍遮字、擋聯絡資訊、清理名字', { timeout: 20000 }, async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hall-chat-'));
  const bootstrap = `const http = require('http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
      this.once('listening', () => console.log('QA_PORT=' + this.address().port));
      return listen.apply(this, args);
    }; require('./server.js');`;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', DATA_FILE: path.join(dir, 'state.json'), ADMIN_PASSWORD: 'isolated-chat-test' },
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
  const response = await fetch(`http://127.0.0.1:${port}/js/chat-filter.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);

  async function connect(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
    ws.messages = [];
    ws.on('message', raw => ws.messages.push(JSON.parse(raw)));
    const welcome = new Promise((resolve, reject) => {
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') resolve(m); });
      ws.once('error', reject);
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name })));
    ws.welcome = await welcome;
    return ws;
  }
  // pong 是同一連線中，前面所有 chat 已經處理完的屏障；不以任意延遲判定未廣播。
  async function barrier(ws) {
    const c = Math.random();
    const pong = new Promise(resolve => {
      const on = raw => { const m = JSON.parse(raw); if (m.t === 'pong' && m.c === c) { ws.off('message', on); resolve(); } };
      ws.on('message', on);
    });
    ws.send(JSON.stringify({ t: 'ping', c })); await pong;
  }
  const observer = await connect('旁觀者');
  const sender = await connect('白癡');
  assert.equal(sender.welcome.name, '＊＊');
  await barrier(observer);
  assert.equal(observer.messages.find(m => m.t === 'join' && m.id === sender.welcome.id).n, '＊＊');
  const chat = new Promise(resolve => observer.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'chat') resolve(m); }));
  sender.send(JSON.stringify({ t: 'chat', text: '幹 你 娘 f.u.c.k！' }));
  assert.equal((await chat).text, '＊ ＊ ＊ ＊.＊.＊.＊！');
  await barrier(sender);
  assert.equal(sender.messages.find(m => m.t === 'chat').text, '＊ ＊ ＊ ＊.＊.＊.＊！');

  for (const text of ['a@example.com', '加賴 abcd', 'example.com', '0912-345-678', 'ig player123', '玩家#1234']) {
    const client = await connect('測試者'); // 每例獨立連線，避免限流遮蔽過濾結果
    const before = observer.messages.filter(m => m.t === 'chat').length;
    client.send(JSON.stringify({ t: 'chat', text }));
    await barrier(client); await barrier(observer);
    assert.equal(client.messages.filter(m => m.t === 'chat').length, 0, text);
    assert.equal(observer.messages.filter(m => m.t === 'chat').length, before, text);
    // 被擋不消耗發送額度；緊接著的正常訊息應送出。
    const delivered = new Promise(resolve => observer.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'chat' && m.id === client.welcome.id) resolve(m); }));
    client.send(JSON.stringify({ t: 'chat', text: '3:1 2026 19:30 87 GEN.G 很爛' }));
    assert.equal((await delivered).text, '3:1 2026 19:30 87 GEN.G 很爛');
  }
  for (const name of ['a@example.com', '0912345678', '@player']) {
    const client = await connect(name);
    assert.match(client.welcome.name, /^訪客\d{4}$/);
    await barrier(observer);
    assert.equal(observer.messages.find(m => m.t === 'join' && m.id === client.welcome.id).n, client.welcome.name);
  }
  assert.equal((await connect('幹嘛操作')).welcome.name, '幹嘛操作');
});
