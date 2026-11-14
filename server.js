// 光之殿堂 觀賽派對 — 多人同步伺服器
// 功能：靜態檔案、WebSocket 位置同步、同時在線人數上限與排隊、YouTube 播放狀態同步、管理員 API
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { filterChat } = require('./public/js/chat-filter.js');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TICK_MS = 100; // 每秒 10 次廣播位置

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[警告] 尚未設定 ADMIN_PASSWORD 環境變數，目前管理密碼為預設值 changeme，請務必在部署時設定。');
}

// ---------- 持久化設定 ----------
const defaults = {
  maxUsers: Number(process.env.MAX_USERS || 60),
  video: {
    id: 'jfKfPfyJRdk', // 預設：一支 24 小時直播，管理員可隨時更換
    live: true,
    title: '',
    playing: true,
    // 非直播影片：以「伺服器時間起點」計算目前進度，所有人一致
    startedAt: Date.now(), // ms，播放中時：進度 = (now - startedAt)/1000
    pausedAt: 0, // 秒，暫停時的進度
  },
};
let state = structuredClone(defaults);
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  state = { ...state, ...saved, video: { ...state.video, ...(saved.video || {}) } };
} catch (_) { /* 第一次啟動 */ }
function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.error('save failed', e.message); }
}

// ---------- YouTube 網址解析 ----------
function parseYouTube(input) {
  if (!input) return null;
  input = String(input).trim();
  if (/^[\w-]{11}$/.test(input)) return { id: input, start: 0 };
  let u;
  try { u = new URL(input); } catch (_) { return null; }
  let id = null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    if (u.searchParams.get('v')) id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/\/(embed|live|shorts|v)\/([\w-]{11})/);
      if (m) id = m[2];
    }
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '0';
  let start = 0;
  const hms = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
  if (/^\d+$/.test(t)) start = Number(t);
  else if (hms) start = (Number(hms[1] || 0) * 3600) + (Number(hms[2] || 0) * 60) + Number(hms[3] || 0);
  return { id, start };
}

function videoPosition() {
  const v = state.video;
  if (v.live) return 0;
  return v.playing ? (Date.now() - v.startedAt) / 1000 : v.pausedAt;
}
function publicVideo() {
  return { ...state.video, position: videoPosition(), serverTime: Date.now() };
}

// ---------- 連線管理 ----------
const players = new Map(); // id -> { ws, color, x,y,z, ry, anim }
const queue = []; // 等候進場的 ws
let nextId = 1;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
}
function broadcastQueue() {
  queue.forEach((ws, i) => send(ws, { t: 'queue', position: i + 1, online: players.size, max: state.maxUsers }));
}

// 名字／聊天文字清理：去掉控制字元、雙向覆寫與零寬字元、角括號，合併空白，依「字」（code point）截斷
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb<>]/g;
function cleanText(v, max) {
  const s = String(v ?? '').replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}
function admit(ws) {
  const id = String(nextId++);
  const name = ws._name || ('訪客' + String(1000 + Math.floor(Math.random() * 9000)));
  const p = { id, ws, color: ws._color, name, x: 0, y: 0, z: 30, ry: Math.PI, anim: 0 };
  players.set(id, p);
  ws._playerId = id;
  send(ws, {
    t: 'welcome', id, name, serverTime: Date.now(), video: publicVideo(), max: state.maxUsers,
    players: [...players.values()].filter(o => o.id !== id).map(o => ({ id: o.id, c: o.color, n: o.name, x: o.x, y: o.y, z: o.z, ry: o.ry, a: o.anim })),
  });
  broadcast({ t: 'join', id, c: p.color, n: name, x: p.x, y: p.y, z: p.z, ry: p.ry }, ws);
}
function tryAdmitQueue() {
  while (queue.length && players.size < state.maxUsers) {
    const ws = queue.shift();
    if (ws.readyState === 1) admit(ws);
  }
  broadcastQueue();
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function checkAdmin(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-admin-password'] || '');
  const a = Buffer.from(String(token)); const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (_) { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // 公開狀態（人數）
  if (p === '/api/status' && req.method === 'GET') {
    return json(res, 200, { online: players.size, queue: queue.length, max: state.maxUsers });
  }

  // ----- 管理員 API -----
  if (p.startsWith('/api/admin/')) {
    if (!checkAdmin(req)) return json(res, 401, { error: '密碼錯誤' });
    if (req.method === 'GET' && p === '/api/admin/state') {
      return json(res, 200, { video: publicVideo(), maxUsers: state.maxUsers, online: players.size, queue: queue.length });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const body = await readBody(req);
    if (p === '/api/admin/video') {
      const parsed = parseYouTube(body.url);
      if (!parsed) return json(res, 400, { error: '無法辨識的 YouTube 網址' });
      const start = Number(body.start ?? parsed.start) || 0;
      state.video = {
        id: parsed.id, live: !!body.live, title: String(body.title || '').slice(0, 120), playing: true,
        startedAt: Date.now() - start * 1000, pausedAt: start,
      };
    } else if (p === '/api/admin/control') {
      const v = state.video; const pos = videoPosition();
      switch (body.action) {
        case 'play': if (!v.playing) { v.playing = true; v.startedAt = Date.now() - v.pausedAt * 1000; } break;
        case 'pause': if (v.playing) { v.playing = false; v.pausedAt = pos; } break;
        case 'restart': v.startedAt = Date.now(); v.pausedAt = 0; break;
        case 'seek': {
          const s = Math.max(0, Number(body.seconds) || 0);
          v.startedAt = Date.now() - s * 1000; v.pausedAt = s; break;
        }
        case 'skip': {
          const s = Math.max(0, pos + (Number(body.seconds) || 0));
          v.startedAt = Date.now() - s * 1000; v.pausedAt = s; break;
        }
        default: return json(res, 400, { error: 'unknown action' });
      }
    } else if (p === '/api/admin/settings') {
      const m = Math.round(Number(body.maxUsers));
      if (m >= 1 && m <= 500) state.maxUsers = m;
      tryAdmitQueue();
    } else return json(res, 404, { error: 'not found' });
    save();
    broadcast({ t: 'video', video: publicVideo() });
    for (const ws of queue) send(ws, { t: 'queue', position: queue.indexOf(ws) + 1, online: players.size, max: state.maxUsers });
    return json(res, 200, { ok: true, video: publicVideo(), maxUsers: state.maxUsers });
  }

  // ----- 靜態檔案 -----
  let file = p === '/' ? '/index.html' : p === '/admin' ? '/admin.html' : p;
  if (file.startsWith('/vendor/three/')) {
    file = path.join(__dirname, 'node_modules', 'three', file.slice('/vendor/three/'.length));
    if (!file.startsWith(path.join(__dirname, 'node_modules', 'three'))) return json(res, 403, {});
  } else {
    file = path.join(PUBLIC_DIR, path.normalize(file));
    if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, {});
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': file.includes('node_modules') ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const CHAT_MAX = 120, NAME_MAX = 16;
wss.on('connection', (ws) => {
  ws._seen = Date.now();
  ws._chat = []; // 最近送出聊天的時間（只用來限流，不存內容）
  ws.on('pong', () => { ws._seen = Date.now(); });
  ws.on('message', (raw) => {
    ws._seen = Date.now();
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (ws._playerId || queue.includes(ws)) return;
      ws._color = m.color === 'blue' ? 'blue' : 'pink';
      ws._name = cleanText(m.name, NAME_MAX);
      const name = filterChat(ws._name);
      ws._name = name.ok ? name.text : ''; // 空白會由 admit 產生預設訪客名稱
      if (players.size < state.maxUsers) admit(ws);
      else { queue.push(ws); broadcastQueue(); }
    } else if (m.t === 'p' && ws._playerId) {
      const p = players.get(ws._playerId);
      if (!p) return;
      const n = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
      p.x = n(m.x, 200); p.y = n(m.y, 50); p.z = n(m.z, 200); p.ry = n(m.ry, 20); p.anim = n(m.a, 10);
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong', c: m.c, s: Date.now() });
    } else if (m.t === 'wave' && ws._playerId) {
      broadcast({ t: 'wave', id: ws._playerId }, ws);
    } else if (m.t === 'chat' && ws._playerId) {
      // 聊天：只轉發、絕不儲存（不寫檔、不留歷史，新進場的人看不到之前的訊息）
      const p = players.get(ws._playerId); if (!p) return;
      const now = Date.now();
      ws._chat = ws._chat.filter(t => now - t < 5000);
      if (ws._chat.length >= 5 || (ws._chat.length && now - ws._chat[ws._chat.length - 1] < 800)) return; // 限流：0.8 秒 1 則、5 秒最多 5 則
      const text = cleanText(m.text, CHAT_MAX); if (!text) return;
      const filtered = filterChat(text); if (!filtered.ok) return;
      ws._chat.push(now);
      broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text: filtered.text });
    } else if (m.t === 'info' && ws._playerId && Array.isArray(m.ids)) {
      // 用戶端遇到不認得的玩家時補要名字與顏色
      const list = [];
      for (const id of m.ids.slice(0, 80)) { const o = players.get(String(id)); if (o) list.push({ id: o.id, c: o.color, n: o.name }); }
      if (list.length) send(ws, { t: 'info', p: list });
    }
  });
  ws.on('error', () => { });
  ws.on('close', () => {
    const qi = queue.indexOf(ws);
    if (qi >= 0) { queue.splice(qi, 1); broadcastQueue(); }
    if (ws._playerId && players.get(ws._playerId)?.ws === ws) {
      players.delete(ws._playerId);
      broadcast({ t: 'leave', id: ws._playerId });
      tryAdmitQueue();
    }
  });
});

// 位置廣播
setInterval(() => {
  if (!players.size) return;
  const list = [];
  for (const p of players.values()) list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), +p.anim.toFixed(2)]);
  broadcast({ t: 's', p: list, n: players.size });
}, TICK_MS);
// 心跳：每 2 秒 ping 一次，超過 11 秒沒有任何回應（pong 或訊息）就視為斷線（分頁被直接關掉、網路中斷時不會留下幽靈角色）
const DEAD_MS = Number(process.env.DEAD_MS || 11000);
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (now - ws._seen > DEAD_MS) { ws.terminate(); continue; }
    try { ws.ping(); } catch (_) { }
  }
}, 2000);
// 定期校正影片進度
setInterval(() => broadcast({ t: 'video', video: publicVideo() }), 10000);

server.listen(PORT, () => console.log(`光之殿堂伺服器啟動： http://localhost:${PORT}  （管理頁 /admin）`));
