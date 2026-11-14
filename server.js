// 光之殿堂 觀賽派對 — 多人同步伺服器
// 功能：靜態檔案、WebSocket 位置同步、同時在線人數上限與排隊、YouTube 播放狀態同步、管理員 API
//       大廳音樂／比賽模式、開賽倒數、重新連線保留位置（簽章 token）、一人一椅、版本更新通知
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
const RESERVE_MS = Number(process.env.RESERVE_MS || 120000); // 斷線後保留名額（與座位）的時間；測試時可用環境變數縮短
const BOOT_GRACE_MS = Number(process.env.BOOT_GRACE_MS || 120000); // 伺服器重啟後這段時間內，持有有效 token 的人優先進場
const TOKEN_PRIORITY_AGE = 24 * 3600 * 1000; // 重啟後優先進場：token 須在 24 小時內簽發
const TOKEN_MAX_AGE = 7 * 24 * 3600 * 1000; // token 可用來認回同一個身分的最長時間
const BOOT_AT = Date.now();

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[警告] 尚未設定 ADMIN_PASSWORD 環境變數，目前管理密碼為預設值 changeme，請務必在部署時設定。');
}

// ---------- 版本（用來提示用戶端「有新版本」） ----------
function computeVersion() {
  if (process.env.RENDER_GIT_COMMIT) return String(process.env.RENDER_GIT_COMMIT).slice(0, 12);
  const h = crypto.createHash('sha256');
  const walk = (dir) => {
    let names = []; try { names = fs.readdirSync(dir).sort(); } catch (_) { return; }
    for (const n of names) {
      const f = path.join(dir, n); let st; try { st = fs.statSync(f); } catch (_) { continue; }
      if (st.isDirectory()) walk(f); else { h.update(path.relative(PUBLIC_DIR, f)); try { h.update(fs.readFileSync(f)); } catch (_) { } }
    }
  };
  walk(PUBLIC_DIR);
  try { h.update(fs.readFileSync(__filename)); } catch (_) { }
  return h.digest('hex').slice(0, 12);
}
const VERSION = process.env.APP_VERSION || computeVersion();

// ---------- 持久化設定 ----------
const defaults = {
  maxUsers: Number(process.env.MAX_USERS || 60),
  mode: 'music', // 'music' 大廳音樂 | 'match' 比賽（影片／直播）；兩者不會同時播放
  seq: 1, // 每換一首歌／一支比賽影片就 +1，用來辨識「哪一次播放」（結束回報去重、淡入淡出）
  video: {
    id: 'jfKfPfyJRdk', // 預設：一支 24 小時直播，管理員可隨時更換
    live: true,
    title: '',
    playing: true,
    // 非直播影片：以「伺服器時間起點」計算目前進度，所有人一致
    startedAt: Date.now(), // ms，播放中時：進度 = (now - startedAt)/1000
    pausedAt: 0, // 秒，暫停時的進度
    dur: 0, seq: 1,
  },
  music: {
    // 預設大廳歌單（重新部署後免費方案資料會清空，所以寫在程式裡）
    list: [{ id: 'HYsz1hP0BFo', title: '' }, { id: 'C3GouGa0noM', title: '' }, { id: '5FrhtahQiRc', title: '' }], // [{ id, title, live?, dur? }]
    index: -1, loop: 'all', shuffle: false, display: 'card',
    playing: true, startedAt: Date.now(), pausedAt: 0, seq: 0,
  },
  countdown: null, // { at, id, start, live, title }
  lights: true, // 室內燈（管理員控制，所有人同步）
};
let state = structuredClone(defaults);
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  state = { ...state, ...saved, video: { ...state.video, ...(saved.video || {}) }, music: { ...state.music, ...(saved.music || {}) } };
  if (!Array.isArray(state.music.list)) state.music.list = [];
  if (state.mode !== 'match') state.mode = 'music';
  if (typeof state.lights !== 'boolean') state.lights = true;
  if (state.music.index >= state.music.list.length) state.music.index = state.music.list.length ? 0 : -1;
} catch (_) { /* 第一次啟動 */ }
if (state.mode === 'music' && state.music.list.length && state.music.index < 0) startTrack(0);
let saveT = null;
function saveNow() {
  clearTimeout(saveT); saveT = null;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.error('save failed', e.message); }
}
function save() { if (!saveT) saveT = setTimeout(saveNow, 50); } // 合併短時間內的多次寫入
// 部署重啟（SIGTERM）時先把還沒寫入的設定存好
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (saveT) saveNow(); process.exit(0); });

// ---------- YouTube 網址解析 ----------
function parseYouTube(input) {
  if (!input) return null;
  input = String(input).trim();
  if (/^[\w-]{11}$/.test(input)) return { id: input, start: 0, live: false };
  let u;
  try { u = new URL(input); } catch (_) { return null; }
  let id = null;
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
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
  return { id, start, live: /\/live\//.test(u.pathname) };
}

// 名字／聊天文字清理：去掉控制字元、雙向覆寫與零寬字元、角括號，合併空白，依「字」（code point）截斷
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb<>]/g;
function cleanText(v, max) {
  const s = String(v ?? '').replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

// ---------- 播放時鐘（比賽影片與大廳音樂共用） ----------
function clockPos(c) { return c.playing ? (Date.now() - c.startedAt) / 1000 : c.pausedAt; }
function clockSet(c, s) { s = Math.max(0, s); c.startedAt = Date.now() - s * 1000; c.pausedAt = s; }
function videoPosition() { const v = state.video; return v.live ? 0 : clockPos(v); }
function publicVideo() {
  const { dur, errAt, ...v } = state.video;
  return { ...v, position: videoPosition(), serverTime: Date.now() };
}
const curTrack = () => { const m = state.music; return m.index >= 0 && m.index < m.list.length ? m.list[m.index] : null; };
// 目前正在播的媒體：{ kind, item（存 dur/title 的地方）, clock, live, seq }；大廳音樂沒有歌單時為 null（大螢幕顯示待機畫面）
function currentMedia() {
  if (state.mode === 'match') { const v = state.video; return { kind: 'match', item: v, clock: v, live: !!v.live, seq: v.seq, id: v.id }; }
  const t = curTrack(); if (!t) return null;
  return { kind: 'music', item: t, clock: state.music, live: !!t.live, seq: state.music.seq, id: t.id };
}
function publicMedia() {
  const m = state.music, t = curTrack(), cd = state.countdown;
  return {
    mode: state.mode, serverTime: Date.now(),
    video: publicVideo(),
    music: {
      track: t ? { id: t.id, title: t.title || '', live: !!t.live } : null,
      index: m.index, count: m.list.length, loop: m.loop, shuffle: m.shuffle, display: m.display,
      playing: m.playing, position: t && !t.live ? clockPos(m) : 0, seq: m.seq, dur: t ? t.dur || 0 : 0,
    },
    countdown: cd ? { at: cd.at, title: cd.title || '', live: !!cd.live } : null,
  };
}
function adminState() {
  let connected = 0, reserved = 0;
  for (const p of players.values()) if (p.ws) connected++; else reserved++;
  return {
    ok: true, video: publicVideo(), maxUsers: state.maxUsers, online: connected, reserved, queue: queue.length,
    mode: state.mode, serverTime: Date.now(), version: VERSION,
    music: { ...publicMedia().music, list: state.music.list.map(x => ({ id: x.id, title: x.title || '', live: !!x.live, dur: x.dur || 0 })) },
    countdown: state.countdown ? { ...state.countdown } : null,
    lights: state.lights,
  };
}
function broadcastMedia() { broadcast({ t: 'media', m: publicMedia() }); }

function startTrack(i) {
  const m = state.music;
  if (!m.list.length) { m.index = -1; m.seq = ++state.seq; return; }
  m.index = Math.max(0, Math.min(m.list.length - 1, i));
  m.seq = ++state.seq; m.playing = true; clockSet(m, 0);
  delete m.list[m.index].errAt;
}
// 下一首：shuffle → 隨機另一首；否則依序（最後一首後回到第一首）。forceNext 為 true 時忽略「單曲循環」
function nextIndex(forceNext) {
  const m = state.music, n = m.list.length;
  if (!n) return -1;
  if (m.index < 0) return 0;
  if (m.loop === 'one' && !forceNext) return m.index;
  if (m.shuffle && n > 1) { let k; do { k = Math.floor(Math.random() * n); } while (k === m.index); return k; }
  return (m.index + 1) % n;
}
function startMatch({ id, start = 0, live = false, title = '' }) {
  state.mode = 'match';
  state.video = { id, live: !!live, title: String(title || '').slice(0, 120), playing: true, startedAt: Date.now() - start * 1000, pausedAt: start, dur: 0, seq: ++state.seq };
}
function backToMusic() {
  state.mode = 'music';
  const m = state.music;
  if (!m.list.length) { m.index = -1; m.seq = ++state.seq; return; }
  startTrack(m.index < 0 ? 0 : nextIndex(true));
}
// 目前媒體播完：比賽影片 → 回到大廳音樂（下一首）；音樂 → 依循環／隨機設定前進
function handleEnd(reason) {
  const cur = currentMedia(); if (!cur) return;
  if (cur.kind === 'match') { if (cur.live) return; backToMusic(); }
  else startTrack(nextIndex(false));
  console.log(`[media] ${cur.kind} ${cur.id} seq ${cur.seq} ended (${reason}) -> mode ${state.mode} seq ${state.mode === 'match' ? state.video.seq : state.music.seq}`);
  save(); broadcastMedia();
}

// ---------- 重新連線 token（HMAC-SHA256） ----------
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.createHash('sha256').update(ADMIN_PASSWORD + '|hall-party-rejoin-v1').digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
function signToken(uid) {
  const body = b64u(JSON.stringify({ u: uid, i: Date.now() }));
  return body + '.' + b64u(crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest());
}
function verifyToken(tok) {
  if (typeof tok !== 'string' || tok.length > 300) return null;
  const [body, sig] = tok.split('.'); if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest();
  let got; try { got = Buffer.from(sig, 'base64url'); } catch (_) { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let d; try { d = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (_) { return null; }
  if (!d || typeof d.u !== 'string' || !/^[\w-]{8,40}$/.test(d.u) || !Number.isFinite(d.i)) return null;
  const age = Date.now() - d.i; if (age < -60000 || age > TOKEN_MAX_AGE) return null;
  return { uid: d.u, iat: d.i };
}

// ---------- 連線管理 ----------
// players：已進場（佔名額）的玩家。p.ws 為 null 表示「斷線保留中」：不顯示角色、不算在線人數，但仍佔名額與座位直到 reservedUntil
const players = new Map(); // id -> { id, uid, ws, color, name, x,y,z, ry, anim, reservedUntil }
const byUid = new Map(); // uid -> player
const queue = []; // 等候進場的 ws（ws._prio 為 true 的排在前面）
const seats = new Map(); // seatIndex -> player id（一人一椅，伺服器為準）
let nextId = 1;

const connectedCount = () => { let n = 0; for (const p of players.values()) if (p.ws) n++; return n; };
const roomFree = () => players.size < state.maxUsers;
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws && p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
}
function broadcastQueue() {
  const online = connectedCount();
  queue.forEach((ws, i) => send(ws, { t: 'queue', position: i + 1, online, max: state.maxUsers }));
}
const seatList = () => [...seats.entries()];
function broadcastSeats() { broadcast({ t: 'seats', s: seatList() }); }
function freeSeatsOf(id) {
  let changed = false;
  for (const [i, pid] of seats) if (pid === id) { seats.delete(i); changed = true; }
  return changed;
}
// 這個 ws 目前代表的玩家（被另一個分頁取代後就不再是）
function playerOf(ws) { const p = ws._playerId && players.get(ws._playerId); return p && p.ws === ws ? p : null; }

function admit(ws) {
  const uid = ws._uid || crypto.randomBytes(12).toString('base64url');
  let p = byUid.get(uid);
  const name = ws._name || (p && p.name) || ('訪客' + String(1000 + Math.floor(Math.random() * 9000)));
  if (p) {
    // 同一個身分：重新整理／重新連線（保留中）或另一個分頁（仍在線，把舊分頁關掉）
    const old = p.ws;
    p.ws = ws; p.reservedUntil = 0;
    if (old && old !== ws) {
      send(old, { t: 'kicked', reason: '你在另一個分頁開啟了殿堂' });
      try { old.close(4001, 'replaced'); } catch (_) { }
      broadcast({ t: 'leave', id: p.id }, ws); // 先讓其他人移除舊角色，下面再以新名字／顏色加入
    }
    p.color = ws._color; p.name = name; p.keep = !!ws._keep;
  } else {
    p = { id: String(nextId++), uid, ws, color: ws._color, name, x: 0, y: 0, z: 30, ry: Math.PI, anim: 0, keep: !!ws._keep, reservedUntil: 0 };
    players.set(p.id, p); byUid.set(uid, p);
  }
  ws._playerId = p.id;
  send(ws, {
    t: 'welcome', id: p.id, name, serverTime: Date.now(), media: publicMedia(), video: publicVideo(), max: state.maxUsers,
    token: signToken(uid), version: VERSION, seats: seatList(), lights: state.lights,
    players: [...players.values()].filter(o => o.id !== p.id && o.ws).map(o => ({ id: o.id, c: o.color, n: o.name, x: o.x, y: o.y, z: o.z, ry: o.ry, a: o.anim })),
  });
  broadcast({ t: 'join', id: p.id, c: p.color, n: name, x: p.x, y: p.y, z: p.z, ry: p.ry }, ws);
}
function enqueue(ws) {
  if (ws._prio) { let i = queue.findIndex(q => !q._prio); if (i < 0) i = queue.length; queue.splice(i, 0, ws); }
  else queue.push(ws);
  broadcastQueue();
}
function tryAdmitQueue() {
  while (queue.length && roomFree()) {
    const ws = queue.shift();
    if (ws.readyState === 1) admit(ws);
  }
  broadcastQueue();
}
function dropPlayer(p) {
  players.delete(p.id); if (byUid.get(p.uid) === p) byUid.delete(p.uid);
  if (freeSeatsOf(p.id)) broadcastSeats();
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
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // 公開狀態（人數）與版本
  if (p === '/api/status' && req.method === 'GET') {
    return json(res, 200, { online: connectedCount(), queue: queue.length, max: state.maxUsers });
  }
  if (p === '/api/version' && req.method === 'GET') return json(res, 200, { version: VERSION });

  // ----- 管理員 API -----
  if (p.startsWith('/api/admin/')) {
    if (!checkAdmin(req)) return json(res, 401, { error: '密碼錯誤' });
    if (req.method === 'GET' && p === '/api/admin/state') return json(res, 200, adminState());
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const body = await readBody(req);
    if (p === '/api/admin/lights') {
      // 室內燈：{ on: true|false } 或 { toggle: true }；只廣播 { t:'lights', on }，不動播放狀態
      if (body.toggle === true) state.lights = !state.lights;
      else if (typeof body.on === 'boolean') state.lights = body.on;
      else return json(res, 400, { error: '請提供 on（true／false）或 toggle: true' });
      save();
      broadcast({ t: 'lights', on: state.lights });
      return json(res, 200, adminState());
    }
    if (p === '/api/admin/video') {
      // 開始比賽：自動切到比賽模式，大廳音樂停止
      const parsed = parseYouTube(body.url);
      if (!parsed) return json(res, 400, { error: '無法辨識的 YouTube 網址' });
      const start = Number(body.start ?? parsed.start) || 0;
      startMatch({ id: parsed.id, start, live: !!body.live, title: body.title });
    } else if (p === '/api/admin/control') {
      // 控制「目前模式」正在播的東西（比賽影片或大廳音樂）
      const cur = currentMedia();
      if (!cur) return json(res, 400, { error: '目前沒有播放中的內容' });
      const c = cur.clock; const pos = clockPos(c);
      switch (body.action) {
        case 'play': if (!c.playing) { c.playing = true; c.startedAt = Date.now() - c.pausedAt * 1000; } break;
        case 'pause': if (c.playing) { c.playing = false; c.pausedAt = pos; } break;
        case 'restart': clockSet(c, 0); break;
        case 'seek': clockSet(c, Number(body.seconds) || 0); break;
        case 'skip': clockSet(c, pos + (Number(body.seconds) || 0)); break;
        default: return json(res, 400, { error: 'unknown action' });
      }
    } else if (p === '/api/admin/settings') {
      const m = Math.round(Number(body.maxUsers));
      if (m >= 1 && m <= 500) state.maxUsers = m;
      tryAdmitQueue();
    } else if (p === '/api/admin/music') {
      const m = state.music, n = m.list.length;
      switch (body.action) {
        case 'add': {
          const parsed = parseYouTube(body.url);
          if (!parsed) return json(res, 400, { error: '無法辨識的 YouTube 網址' });
          if (n >= 200) return json(res, 400, { error: '歌單最多 200 首' });
          m.list.push({ id: parsed.id, title: cleanText(body.title, 120), live: !!(body.live ?? parsed.live) });
          if (state.mode === 'music' && m.index < 0) startTrack(m.list.length - 1);
          break;
        }
        case 'remove': {
          const i = int(body.index); if (!(i >= 0 && i < n)) return json(res, 400, { error: 'index' });
          m.list.splice(i, 1);
          if (i < m.index) m.index--;
          else if (i === m.index) {
            if (!m.list.length) { m.index = -1; m.seq = ++state.seq; }
            else if (state.mode === 'music') startTrack(i % m.list.length);
            else m.index = i % m.list.length;
          }
          break;
        }
        case 'move': {
          const f = int(body.from), t = int(body.to);
          if (!(f >= 0 && f < n && t >= 0 && t < n)) return json(res, 400, { error: 'index' });
          const curItem = curTrack();
          const [it] = m.list.splice(f, 1); m.list.splice(t, 0, it);
          if (curItem) m.index = m.list.indexOf(curItem);
          break;
        }
        case 'play': {
          if (!n) return json(res, 400, { error: '歌單是空的' });
          if (body.index !== undefined && body.index !== null) {
            const i = int(body.index); if (!(i >= 0 && i < n)) return json(res, 400, { error: 'index' });
            state.mode = 'music'; startTrack(i);
          } else if (state.mode === 'match') backToMusic();
          else if (!m.playing) { m.playing = true; m.startedAt = Date.now() - m.pausedAt * 1000; }
          break;
        }
        case 'next':
          if (state.mode !== 'music') return json(res, 400, { error: '比賽進行中，請先回到大廳音樂' });
          if (!n) return json(res, 400, { error: '歌單是空的' });
          startTrack(nextIndex(true));
          break;
        case 'settings':
          if (body.loop === 'all' || body.loop === 'one') m.loop = body.loop;
          if (typeof body.shuffle === 'boolean') m.shuffle = body.shuffle;
          if (body.musicDisplay === 'video' || body.musicDisplay === 'card') m.display = body.musicDisplay;
          break;
        default: return json(res, 400, { error: 'unknown action' });
      }
    } else if (p === '/api/admin/mode') {
      if (body.mode === 'music') { if (state.mode !== 'music' || !curTrack()) backToMusic(); }
      else if (body.mode === 'match') { if (state.mode !== 'match') { state.mode = 'match'; state.video.seq = ++state.seq; } }
      else return json(res, 400, { error: 'mode' });
    } else if (p === '/api/admin/countdown') {
      if (body.cancel) state.countdown = null;
      else {
        const at = Number(body.at);
        if (!Number.isFinite(at) || at < Date.now() - 1000 || at > Date.now() + 60 * 86400e3) return json(res, 400, { error: '開賽時間不正確' });
        const parsed = parseYouTube(body.url);
        if (!parsed) return json(res, 400, { error: '無法辨識的 YouTube 網址' });
        state.countdown = { at: Math.round(at), id: parsed.id, start: parsed.start, live: !!(body.live ?? parsed.live), title: cleanText(body.title, 120) };
      }
    } else return json(res, 404, { error: 'not found' });
    save();
    broadcastMedia();
    broadcastQueue();
    return json(res, 200, adminState());
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
const CHAT_MAX = 120, NAME_MAX = 16, SEAT_MAX = 2000;
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
      { const nm = filterChat(ws._name); ws._name = nm.ok ? nm.text : ''; } // 空白會由 admit 產生預設訪客名稱
      ws._keep = !!m.keep; // 用戶端會保存 token、支援重新整理後回到原位：斷線時才保留名額
      const tok = verifyToken(m.token);
      if (tok) ws._uid = tok.uid;
      const known = tok && byUid.get(tok.uid);
      if (known) admit(ws); // 名額（與座位）還保留著，或另一個分頁仍在線：直接進場
      else if (roomFree() && !queue.length) admit(ws);
      else if (tok && Date.now() - BOOT_AT < BOOT_GRACE_MS && Date.now() - tok.iat < TOKEN_PRIORITY_AGE) {
        // 伺服器剛重啟：原本在場內的人優先（仍遵守人數上限，但排在沒有 token 的人前面）
        ws._prio = true;
        if (roomFree()) admit(ws); else enqueue(ws);
      } else enqueue(ws);
      return;
    }
    if (m.t === 'ping') { send(ws, { t: 'pong', c: m.c, s: Date.now() }); return; }
    const p = playerOf(ws); if (!p) return;
    if (m.t === 'p') {
      const n = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
      p.x = n(m.x, 200); p.y = n(m.y, 50); p.z = n(m.z, 200); p.ry = n(m.ry, 20); p.anim = n(m.a, 10);
      // 不是坐著的姿勢（a≠5）就代表離開椅子了
      if (!(p.anim > 4.5 && p.anim < 5.5) && freeSeatsOf(p.id)) broadcastSeats();
    } else if (m.t === 'sit') {
      const i = int(m.seat);
      if (!(i >= 0 && i < SEAT_MAX)) return send(ws, { t: 'sitNo', seat: m.seat });
      const owner = seats.get(i);
      if (owner && owner !== p.id && players.has(owner)) return send(ws, { t: 'sitNo', seat: i });
      freeSeatsOf(p.id); seats.set(i, p.id);
      send(ws, { t: 'sitOk', seat: i }); broadcastSeats();
    } else if (m.t === 'stand') {
      if (freeSeatsOf(p.id)) broadcastSeats();
    } else if (m.t === 'wave') {
      broadcast({ t: 'wave', id: p.id }, ws);
    } else if (m.t === 'chat') {
      // 聊天：只轉發、絕不儲存（不寫檔、不留歷史，新進場的人看不到之前的訊息）
      const now = Date.now();
      ws._chat = ws._chat.filter(t => now - t < 5000);
      if (ws._chat.length >= 5 || (ws._chat.length && now - ws._chat[ws._chat.length - 1] < 800)) return; // 限流：0.8 秒 1 則、5 秒最多 5 則
      const text = cleanText(m.text, CHAT_MAX); if (!text) return;
      const filtered = filterChat(text); if (!filtered.ok) return;
      ws._chat.push(now);
      broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text: filtered.text });
    } else if (m.t === 'info' && Array.isArray(m.ids)) {
      // 用戶端遇到不認得的玩家時補要名字與顏色
      const list = [];
      for (const id of m.ids.slice(0, 80)) { const o = players.get(String(id)); if (o && o.ws) list.push({ id: o.id, c: o.color, n: o.name }); }
      if (list.length) send(ws, { t: 'info', p: list });
    } else if (m.t === 'dur' || m.t === 'ended' || m.t === 'err') {
      onMediaReport(m);
    }
  });
  ws.on('error', () => { });
  ws.on('close', () => {
    const qi = queue.indexOf(ws);
    if (qi >= 0) { queue.splice(qi, 1); broadcastQueue(); }
    const p = playerOf(ws);
    if (p) {
      broadcast({ t: 'leave', id: p.id }); // 其他人立刻移除角色；保留中的玩家不會出現在快照裡
      if (p.keep && RESERVE_MS > 0) { p.ws = null; p.reservedUntil = Date.now() + RESERVE_MS; }
      else { dropPlayer(p); tryAdmitQueue(); }
    }
  });
});

// 播放回報：用戶端的 YouTube 播放器回報片長（dur）、播完（ended）、無法播放（err）
// 以 seq 判斷是不是「目前這一次播放」，過時或重複的回報一律忽略
function onMediaReport(m) {
  const cur = currentMedia();
  if (!cur || cur.live || Number(m.seq) !== cur.seq || (m.id && m.id !== cur.id)) return;
  const it = cur.item, pos = clockPos(cur.clock);
  if (m.t === 'dur') {
    const s = Number(m.seconds);
    if (!it.dur && Number.isFinite(s) && s >= 5 && s <= 6 * 3600) { it.dur = Math.round(s * 10) / 10; save(); }
    if (!it.title && m.title) { const t = cleanText(m.title, 120); if (t) { it.title = t; save(); broadcastMedia(); } }
  } else if (m.t === 'ended') {
    if (!cur.clock.playing) return;
    // 片長已知：只接受接近片尾的回報；未知：至少播了 3 秒（避免剛換歌時舊播放器的回報）
    if (it.dur ? pos >= it.dur - 10 : pos >= 3) handleEnd('ended report');
  } else if (m.t === 'err') {
    if (!it.dur && !it.errAt) it.errAt = Date.now();
  }
}

// 位置廣播（只有在線的玩家；斷線保留中的人不會出現）
setInterval(() => {
  if (!players.size) return;
  const list = [];
  for (const p of players.values()) if (p.ws) list.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), +p.anim.toFixed(2)]);
  broadcast({ t: 's', p: list, n: list.length });
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
// 每秒：保留名額到期、開賽倒數、片長已知時由伺服器判斷播完
setInterval(() => {
  const now = Date.now();
  let freed = false;
  for (const p of [...players.values()]) if (!p.ws && p.reservedUntil && now > p.reservedUntil) { dropPlayer(p); freed = true; }
  if (freed) tryAdmitQueue();
  const cd = state.countdown;
  if (cd && now >= cd.at) {
    state.countdown = null;
    startMatch({ id: cd.id, start: cd.start || 0, live: cd.live, title: cd.title });
    console.log(`[media] countdown reached -> match ${cd.id}`);
    save(); broadcastMedia();
  }
  const cur = currentMedia();
  if (cur && !cur.live && cur.clock.playing) {
    const pos = clockPos(cur.clock);
    if (cur.item.dur && pos >= cur.item.dur + 1.5) handleEnd('duration');
    else if (cur.kind === 'music' && cur.item.errAt && !cur.item.dur && now - cur.item.errAt > 4000) handleEnd('error');
  }
}, 1000);
// 定期校正影片進度
setInterval(broadcastMedia, 10000);

server.listen(PORT, () => console.log(`光之殿堂伺服器啟動： http://localhost:${PORT}  （管理頁 /admin） 版本 ${VERSION}`));
