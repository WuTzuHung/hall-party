'use strict';
// 城牆觀影館：兩台螢幕各自獨立的播放時鐘（管理 API）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('觀影館 API：同時開始、單台微調、同時暫停、音量、清除', { timeout: 20000 }, async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hall-theater-'));
  const bootstrap = `const http = require('http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
      this.once('listening', () => console.log('QA_PORT=' + this.address().port));
      return listen.apply(this, args);
    }; require('./server.js');`;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', DATA_FILE: path.join(dir, 'state.json'), ADMIN_PASSWORD: 'theater-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
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
  const call = async (body, expect = 200) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/theater`, { method: 'POST', headers: { Authorization: 'Bearer theater-test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, expect); return r.json();
  };
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
