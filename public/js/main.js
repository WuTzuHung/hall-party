import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld, SPAWN, HALL, SCREEN } from './world.js';
import { Avatar } from './avatar.js';
import { BigScreen } from './screen.js';
import { initChat } from './chat.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const params = new URLSearchParams(location.search);
const Q = { high: params.get('q') ? params.get('q') === 'high' : !isTouch };

// ---------- 渲染器 ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.high, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.high ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.12, 900);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const status = (t) => { $('#status-line').textContent = t; };
let world;
try {
  world = buildWorld(scene, renderer, Q);
} catch (e) { console.error(e); status('場景載入失敗：' + e.message); throw e; }
scene.traverse((o) => { if (o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = (o.material.envMapIntensity ?? 1) * 0.35; });

const screen = new BigScreen(scene, $('#stage'));
screen.setSize(innerWidth, innerHeight);

// ---------- 玩家 ----------
const me = {
  pos: new THREE.Vector3(SPAWN.x, 0.15, SPAWN.z), vy: 0, ry: SPAWN.ry, color: null, avatar: null,
  speed: 0, seat: null, id: null, name: '',
  onGround: true, airT: 0, jumping: false, camY: 0.15,
};
let jumpQueued = -1e9; // 按下跳躍的時間（容許落地前一點點就按）
const cam = { yaw: 0, pitch: 0.18, dist: 5.5, targetDist: 5.5, minD: 0, maxD: 14 };
const keys = {};
// 觀看模式：normal 一般 / seat 座位第一人稱 / best 正中央最佳視角 / full 螢幕放到最大
let viewMode = 'normal'; let bestD = 17; let savedSeatCam = null;
let joy = { active: false, x: 0, y: 0, id: null };
let entered = false;

// ---------- 碰撞與地面 ----------
const R = 0.32;
const JUMP_V = 6.0, GRAV = 22; // 跳躍初速與重力：最高約 0.82m，落在所有家具碰撞高度以下
function groundAt(x, z, y) {
  let best = -Infinity;
  for (const f of world.floors) {
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const fy = f.y !== undefined ? f.y : f.ya + (f.yb - f.ya) * ((z - f.z0) / (f.z1 - f.z0));
    if (fy <= y + 0.55 && fy > best) best = fy;
  }
  return best === -Infinity ? 0 : best;
}
// 牆擋住玩家的條件：腳高於 y1 - st 就可以跨上去（st 預設 0.35；台階型方塊用 0.55，與地面自動跨階一致）
const blocks = (c, y) => y + (c.st || 0.35) < c.y1 && y + 1.5 > c.y0;
function collide(p) {
  for (let it = 0; it < 2; it++) for (const c of world.walls) {
    if (!blocks(c, p.y)) continue;
    const cx = Math.max(c.x0, Math.min(p.x, c.x1)), cz = Math.max(c.z0, Math.min(p.z, c.z1));
    const dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x += dx / d * (R - d); p.z += dz / d * (R - d); }
    else { // 在方塊內：從最近的邊推出
      const pen = [p.x - c.x0, c.x1 - p.x, p.z - c.z0, c.z1 - p.z]; const m = Math.min(...pen); const k = pen.indexOf(m);
      if (k === 0) p.x = c.x0 - R; else if (k === 1) p.x = c.x1 + R; else if (k === 2) p.z = c.z0 - R; else p.z = c.z1 + R;
    }
  }
}
// 某個位置是否站得下（不與任何碰撞方塊重疊，且腳下有地面、不會掉下去）；回傳地面高度或 null
function freeSpot(x, y, z) {
  for (const c of world.walls) {
    if (!blocks(c, y)) continue;
    const cx = Math.max(c.x0, Math.min(x, c.x1)), cz = Math.max(c.z0, Math.min(z, c.z1));
    if ((x - cx) ** 2 + (z - cz) ** 2 < (R + 0.01) ** 2) return null;
  }
  const g = groundAt(x, z, y);
  return Math.abs(g - y) <= 0.45 ? g : null;
}
// 相機遮擋：射線 vs 方塊
function rayBox(o, d, maxT, c) {
  let t0 = 0, t1 = maxT;
  for (const [oa, da, a0, a1] of [[o.x, d.x, c.x0, c.x1], [o.y, d.y, c.y0, c.y1], [o.z, d.z, c.z0, c.z1]]) {
    if (Math.abs(da) < 1e-6) { if (oa < a0 || oa > a1) return Infinity; continue; }
    let ta = (a0 - oa) / da, tb = (a1 - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return Infinity;
  }
  return t0 > 0.05 ? t0 : Infinity;
}

// ---------- 輸入 ----------
const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
const clearKeys = () => { for (const k in keys) keys[k] = false; };
addEventListener('keydown', (e) => {
  if (!entered || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#help').classList.contains('hidden')) { if (e.code === 'Escape' || e.code === 'Enter') $('#help').classList.add('hidden'); return; }
  // 剛點過的 HUD 按鈕還留著焦點時，空白鍵／Enter 會再按一次那顆按鈕：先把焦點移走
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Slash' || e.code === 'KeyT') && viewMode !== 'full') {
    e.preventDefault(); clearKeys(); chat.open(); return;
  }
  keys[e.code] = true;
  if (e.code === 'KeyE' && !e.repeat) toggleSit();
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = performance.now(); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Space' && !typing(e)) e.preventDefault(); });
addEventListener('blur', clearKeys);

// 滑鼠鎖定（FPS 式轉視角）：點一下畫面就鎖定，移動滑鼠直接轉；Esc 放開。沒鎖定時仍可拖曳
const canLook = () => viewMode !== 'best' && viewMode !== 'full';
const locked = () => document.pointerLockElement === canvas;
function lockPointer() {
  if (isTouch || !entered || locked() || !canLook() || !canvas.requestPointerLock) return;
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (_) { }
}
function unlockPointer() { if (locked()) try { document.exitPointerLock(); } catch (_) { } }
document.addEventListener('pointerlockchange', () => { document.body.classList.toggle('locked', locked()); if (locked()) pointers.clear(); });
document.addEventListener('mousemove', (e) => {
  if (!locked() || !canLook()) return;
  const k = 0.0022;
  cam.yaw -= e.movementX * k; cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * k, -1.2, 1.35);
});
let downAt = null;

const pointers = new Map(); let pinchD = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (chat && chat.focused) chat.input.blur();
  if (e.pointerType === 'mouse') { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; if (locked()) return; }
  canvas.setPointerCapture(e.pointerId);
  if (isTouch && entered && e.clientX < innerWidth * 0.45 && e.clientY > innerHeight * 0.35 && !joy.active) {
    joy = { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
    const j = $('#joy'); j.classList.remove('hidden'); j.style.left = (e.clientX - 65) + 'px'; j.style.top = (e.clientY - 65) + 'px'; j.style.bottom = 'auto';
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  if (joy.active && e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const l = Math.hypot(dx, dy), m = 55;
    if (l > m) { dx *= m / l; dy *= m / l; }
    joy.x = dx / m; joy.y = dy / m; $('#joy-knob').style.transform = `translate(${dx}px,${dy}px)`;
    return;
  }
  const p = pointers.get(e.pointerId); if (!p) return;
  if (pointers.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD) {
      if (viewMode === 'best') bestD = THREE.MathUtils.clamp(bestD * (pinchD / d), 6, 42);
      else if (viewMode !== 'full') cam.targetDist = THREE.MathUtils.clamp(cam.targetDist * (pinchD / d), cam.minD, cam.maxD);
    }
    pinchD = d; return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (viewMode === 'best' || viewMode === 'full') return;
  const k = isTouch ? 0.006 : 0.0045;
  cam.yaw -= dx * k; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * k, -1.2, 1.35);
});
canvas.addEventListener('pointerup', (e) => {
  // 只有「點一下」才鎖定滑鼠；拖曳轉視角放開時不鎖定
  if (e.pointerType !== 'mouse' || !downAt || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), dt = performance.now() - downAt.t; downAt = null;
  if (moved < 6 && dt < 450) lockPointer();
});
const endPointer = (e) => {
  if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; $('#joy-knob').style.transform = ''; $('#joy').classList.add('hidden'); }
  pointers.delete(e.pointerId); if (pointers.size < 2) pinchD = 0;
};
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(e.deltaY * 0.0012);
  if (viewMode === 'best') { bestD = THREE.MathUtils.clamp(bestD * f, 6, 42); return; }
  if (viewMode === 'full') return;
  cam.targetDist = cam.targetDist < 0.3 && e.deltaY > 0 ? 0.8 : THREE.MathUtils.clamp(cam.targetDist * f, cam.minD, cam.maxD);
  if (cam.targetDist < 0.45 && e.deltaY < 0) cam.targetDist = 0;
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 坐下 ----------
let nearSeat = null;
function seatTaken(s) {
  for (const r of remotes.values()) if (r.sitting && Math.hypot(r.tx - s.x, r.tz - s.z) < 0.3) return true;
  return false;
}
function findSeat() {
  let best = null, bd = 1.25;
  for (const s of world.seats) {
    if (Math.abs((s.y - 0.5) - me.pos.y) > 0.6) continue;
    const d = Math.hypot(s.x - me.pos.x, s.z - me.pos.z);
    if (d < bd && !seatTaken(s)) { bd = d; best = s; }
  }
  return best;
}
function toggleSit() {
  if (me.seat) { standUp(); return; }
  if (!me.onGround) return;
  const s = nearSeat || findSeat(); if (!s) return;
  me.seat = s; me.pos.set(s.x, s.y - 0.5, s.z); me.ry = s.ry; me.speed = 0; me.vy = 0; me.jumping = false;
  seatView();
  $('#btn-sit').textContent = '站起來'; toast('已坐下 · 可用下方按鈕切換最佳視角或全螢幕');
  $('#seat-tools').classList.remove('hidden'); setMode('seat');
  sendNow();
}
function standUp() {
  const s = me.seat; me.seat = null;
  setMode('normal'); $('#seat-tools').classList.add('hidden');
  cam.dist = cam.targetDist = 5; cam.pitch = 0.18;
  // 站起來：從椅子的碰撞方塊外面找一個空位（先試前方，再試兩側、後方，最後往外繞圈找）
  const fx = Math.sin(s.ry), fz = Math.cos(s.ry), rx = Math.cos(s.ry), rz = -Math.sin(s.ry), y = s.y - 0.5;
  const tries = [[0.62, 0], [0.8, 0], [0, 0.62], [0, -0.62], [0.62, 0.5], [0.62, -0.5], [-0.7, 0], [1.0, 0], [-0.95, 0], [0, 0.9], [0, -0.9]];
  for (let r = 0.7; r <= 2.6; r += 0.3) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; tries.push([Math.cos(a) * r, Math.sin(a) * r]); }
  let spot = null;
  for (const [f, sd] of tries) {
    const x = s.x + fx * f + rx * sd, z = s.z + fz * f + rz * sd; const g = freeSpot(x, y, z);
    if (g !== null) { spot = [x, g, z]; break; }
  }
  if (spot) me.pos.set(spot[0], spot[1], spot[2]); else { me.pos.x += fx * 0.62; me.pos.z += fz * 0.62; }
  me.onGround = true; me.vy = 0;
  $('#btn-sit').textContent = '坐下'; sendNow();
}
$('#btn-sit').addEventListener('click', (e) => { e.stopPropagation(); toggleSit(); });

// 坐下時：第一人稱，從座位的眼睛高度看向大螢幕中央
function seatView() {
  const ex = me.pos.x, ey = me.pos.y + 1.25, ez = me.pos.z;
  const lx = SCREEN.x - ex, ly = SCREEN.y - ey, lz = SCREEN.z - ez; const l = Math.hypot(lx, ly, lz);
  cam.pitch = Math.asin(-ly / l); cam.yaw = Math.atan2(-lx, -lz);
  cam.dist = cam.targetDist = 0;
}
function setMode(m) {
  viewMode = m;
  if (!canLook()) unlockPointer();
  document.body.classList.toggle('seated', m === 'seat' || m === 'best');
  $('#btn-best').textContent = m === 'best' ? '✕ 取消最佳視角' : '🎯 最佳視角';
  $('#btn-best').classList.toggle('on', m === 'best');
  document.body.classList.toggle('mode-full', m === 'full');
  $('#full-exit').classList.toggle('hidden', m !== 'full');
}
$('#btn-best').addEventListener('click', (e) => {
  e.stopPropagation();
  if (viewMode === 'best') { setMode('seat'); seatView(); toast('回到座位視角'); }
  else { setMode('best'); toast('最佳視角 · 用滑鼠滾輪或雙指往前、往後拉'); }
});
$('#btn-watchfull').addEventListener('click', (e) => { e.stopPropagation(); enterFull(); });
$('#full-exit').addEventListener('click', (e) => { e.stopPropagation(); exitFull(); });
let modeBeforeFull = 'seat';
function enterFull() {
  modeBeforeFull = viewMode === 'full' ? modeBeforeFull : viewMode;
  setMode('full');
  try { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { }); } catch (_) { }
}
function exitFull() {
  if (viewMode !== 'full') return;
  setMode(modeBeforeFull); if (modeBeforeFull === 'seat') seatView();
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) { }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && viewMode === 'full') exitFull(); });
addEventListener('keydown', (e) => { if (e.code === 'Escape' && !typing(e)) exitFull(); }); // 滑鼠鎖定時 Esc 只會先放開滑鼠（瀏覽器行為），再按一次才離開全螢幕

// ---------- UI ----------
let toastT;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
let soundOn = false;
function setSound(on) { soundOn = on; screen.setSound(on); $('#btn-sound').textContent = on ? '🔊 聲音開啟' : '🔇 開啟聲音'; }
$('#btn-sound').addEventListener('click', () => setSound(!soundOn));
$('#btn-help').addEventListener('click', () => { unlockPointer(); $('#help').classList.remove('hidden'); });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.close).classList.add('hidden')));
$('#btn-full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });

// 選角預覽
const previews = [];
document.querySelectorAll('canvas.preview').forEach((c) => {
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Scene(); s.environment = scene.environment;
  s.add(new THREE.HemisphereLight(0xfff0f8, 0x403050, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 4); s.add(d);
  const a = new Avatar(c.dataset.color); s.add(a.root);
  const cm = new THREE.PerspectiveCamera(32, 1, 0.1, 20); cm.position.set(0, 0.95, 3.6); cm.lookAt(0, 0.62, 0);
  previews.push({ r, s, a, cm, c });
});
// 名字：記在 localStorage，沒填就用「訪客####」
const nameInput = $('#name-input');
const cleanName = (v) => Array.from(String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('').trim();
let defaultName = '訪客' + String(1000 + Math.floor(Math.random() * 9000));
try { const saved = localStorage.getItem('hall-name'); if (saved) nameInput.value = cleanName(saved); const d = localStorage.getItem('hall-default-name'); if (d) defaultName = d; else localStorage.setItem('hall-default-name', defaultName); } catch (_) { }
nameInput.placeholder = defaultName;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); if (chosen) $('#btn-enter').click(); } });
let chosen = null;
document.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => {
  chosen = b.dataset.color;
  document.querySelectorAll('.choice').forEach(x => x.classList.toggle('on', x === b));
  const btn = $('#btn-enter'); btn.disabled = false; btn.textContent = '走進光之殿堂';
}));
$('#btn-enter').addEventListener('click', () => {
  if (!chosen) return;
  me.color = chosen;
  me.name = cleanName(nameInput.value) || defaultName; nameInput.value = cleanName(nameInput.value);
  try { if (nameInput.value) localStorage.setItem('hall-name', nameInput.value); else localStorage.removeItem('hall-name'); } catch (_) { }
  setSound(true); // 使用者點擊時解除靜音（瀏覽器規定需要互動）
  status('連線中…');
  connect();
});

// ---------- 網路 ----------
let ws, serverOffset = 0, lastSend = 0, lastSent = '';
const remotes = new Map();
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', color: me.color, name: me.name })); ping(); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'welcome': onWelcome(m); break;
      case 'queue': $('#select').classList.add('hidden'); $('#queue').classList.remove('hidden');
        $('#queue-text').textContent = `目前 ${m.online} / ${m.max} 人在線，你排在第 ${m.position} 位。`; break;
      case 's': onSnapshot(m); break;
      case 'join': addRemote(m.id, m.c, m); break;
      case 'leave': removeRemote(m.id); break;
      case 'chat': onChat(m); break;
      case 'info': for (const o of m.p) { const r = remotes.get(o.id); if (r && r.needInfo) { removeRemote(o.id); addRemote(o.id, o.c, { ...r.last, n: o.n }); } } break;
      case 'video': screen.setState(m.video); break;
      case 'pong': { const rtt = performance.now() - m.c; serverOffset = m.s + rtt / 2 - Date.now(); break; }
    }
  };
  ws.onclose = () => {
    if (!entered) { status('連線中斷，2 秒後重試…'); setTimeout(connect, 2000); return; }
    toast('連線中斷，正在重新連線…', 4000);
    for (const id of [...remotes.keys()]) removeRemote(id);
    setTimeout(connect, 2000);
  };
}
function ping() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }
setInterval(ping, 20000);

function onWelcome(m) {
  me.id = m.id; if (m.name) me.name = m.name;
  for (const id of [...remotes.keys()]) removeRemote(id); // 重新連線：以伺服器的名單為準，不留下舊的角色
  $('#select').classList.add('hidden'); $('#queue').classList.add('hidden'); $('#hud').classList.remove('hidden');
  for (const p of previews) { p.r.dispose(); }
  previews.length = 0;
  screen.setState(m.video);
  for (const p of m.players) addRemote(p.id, p.c, p);
  if (!entered) {
    entered = true;
    me.avatar = new Avatar(me.color); scene.add(me.avatar.root);
    me.avatar.setName(me.name);
    me.pos.set(SPAWN.x + (Math.random() - 0.5) * 6, 0.15, SPAWN.z + (Math.random() - 0.5) * 1.5);
    me.ry = Math.PI; cam.yaw = 0; cam.pitch = 0.12; cam.dist = cam.targetDist = 6; me.camY = me.pos.y;
    if (isTouch) $('#btn-jump').classList.remove('hidden');
    toast('歡迎！往前走進大門，大螢幕就在大廳盡頭', 4500);
    setTimeout(() => $('#hint').classList.add('fade'), 12000);
  }
  else if (me.avatar.labels && me.avatar.labels.name !== me.name) me.avatar.setName(me.name);
  updateOnline(m.players.length + 1);
}
function updateOnline(n) { $('#online-n').textContent = n; }
function addRemote(id, color, p) {
  if (id === me.id || remotes.has(id)) return;
  const av = new Avatar(color); scene.add(av.root);
  av.root.position.set(p.x, p.y, p.z);
  if (p.n) av.setName(p.n);
  const a = p.a || 0;
  remotes.set(id, { av, name: p.n || '', color, tx: p.x, ty: p.y, tz: p.z, try: p.ry || 0, ry: p.ry || 0, a, sitting: a > 4.5 && a < 5.5, air: a >= 6, seen: performance.now(), needInfo: !p.n });
}
function removeRemote(id) { const r = remotes.get(id); if (r) { r.av.dispose(); remotes.delete(id); } }
// 動作欄位 a：0～4 地面速度、5 坐著、6 以上 = 在空中（a - 6 為速度）
function onSnapshot(m) {
  updateOnline(m.n);
  const now = performance.now(), unknown = [];
  for (const [id, x, y, z, ry, a] of m.p) {
    if (id === me.id) continue;
    let r = remotes.get(id);
    if (!r) { addRemote(id, 'pink', { x, y, z, ry, a }); r = remotes.get(id); unknown.push(id); }
    r.tx = x; r.ty = y; r.tz = z; r.try = ry; r.a = a; r.sitting = a > 4.5 && a < 5.5; r.air = a >= 6; r.seen = now; r.last = { x, y, z, ry, a };
  }
  if (unknown.length && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'info', ids: unknown }));
}
// 好幾秒沒出現在快照裡的角色（伺服器已移除但 leave 訊息遺失等情況）直接清掉，避免留下幽靈
function expireRemotes(now) {
  for (const [id, r] of remotes) if (now - r.seen > 4000) removeRemote(id);
}
function onChat(m) {
  chat.add(m);
  const av = m.id === me.id ? me.avatar : remotes.get(m.id)?.av;
  if (av) av.say(m.text);
}
const chat = initChat({
  isTouch, toast,
  send: (text) => { if (!ws || ws.readyState !== 1 || !me.id) return false; ws.send(JSON.stringify({ t: 'chat', text })); return true; },
  onFocus: () => { clearKeys(); unlockPointer(); },
});
function sendNow() { lastSend = 0; }
function netSend(now) {
  if (!ws || ws.readyState !== 1 || !entered) return;
  if (now - lastSend < 100) return;
  const sp = Math.min(3.9, +me.speed.toFixed(2));
  const a = me.seat ? 5 : (me.jumping || me.airT > 0.2) ? +(6 + Math.min(sp, 3)).toFixed(2) : sp;
  const msg = JSON.stringify({ t: 'p', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(2), a });
  if (msg === lastSent && now - lastSend < 2000) return;
  ws.send(msg); lastSent = msg; lastSend = now;
}

// ---------- 主迴圈 ----------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), camTarget = new THREE.Vector3(), dirV = new THREE.Vector3();
let lastVideoTick = 0, introT = 0;

function updateMe(dt) {
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1; if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.active) { ix += joy.x; iz += joy.y; }
  const il = Math.hypot(ix, iz);
  if (me.seat) { if (il > 0.3 && (viewMode === 'seat' || viewMode === 'normal')) standUp(); else { me.speed = 0; jumpQueued = -1e9; return; } }
  const run = keys.ShiftLeft || keys.ShiftRight || (joy.active && il > 0.95);
  // 跳躍：站著、走路、跑步時都可以（坐著、在空中不行；離地 0.1 秒內仍可起跳）
  const nowMs = performance.now();
  if (nowMs - jumpQueued < 160 && (me.onGround || me.airT < 0.1) && !me.jumping) {
    me.vy = JUMP_V; me.onGround = false; me.jumping = true; me.airT = 0.1; jumpQueued = -1e9;
  }
  const airBoost = me.onGround ? 1 : 1.15; // 在空中時稍微往前衝
  let sp = 0;
  if (il > 0.05) {
    ix /= Math.max(1, il); iz /= Math.max(1, il);
    const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
    const wx = ix * cos + iz * sin, wz = -ix * sin + iz * cos;
    const speed = (run ? 6.2 : 3.2) * Math.min(1, il) * airBoost;
    me.pos.x += wx * speed * dt; me.pos.z += wz * speed * dt;
    const want = Math.atan2(wx, wz);
    let d = want - me.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); me.ry += d * Math.min(1, dt * 12);
    sp = speed / 3.2 / airBoost;
  }
  me.speed += (sp - me.speed) * Math.min(1, dt * 10);
  collide(me.pos);
  const g = groundAt(me.pos.x, me.pos.z, me.pos.y);
  // 地面：往上的台階（≤0.55m）直接踩上去，腳不會陷進台階；往下 0.46m 以內（樓梯、觀賽席、舞台）快速貼回地面；更高的落差才自由落下
  if (me.vy > 0 || me.pos.y > g + (me.onGround ? 0.46 : 0.001)) {
    me.vy -= GRAV * dt; me.pos.y += me.vy * dt;
    if (me.pos.y <= g) { me.pos.y = g; me.vy = 0; me.onGround = true; me.jumping = false; me.airT = 0; }
    else { me.onGround = false; me.airT += dt; }
  } else { me.pos.y = me.pos.y > g ? Math.max(g, me.pos.y - Math.max(0.02, dt * 7)) : g; me.vy = 0; me.onGround = true; me.jumping = false; me.airT = 0; }
  if (me.pos.y < -5) { me.pos.set(SPAWN.x, 0.15, SPAWN.z); me.vy = 0; } // 保險：萬一掉出世界
}

const fullPos = new THREE.Vector3(), bestPos = new THREE.Vector3();
function updateCamera(dt) {
  if (viewMode === 'best' || viewMode === 'full') {
    let d;
    if (viewMode === 'full') {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      d = Math.max((SCREEN.h / 2) / t, (SCREEN.w / 2) / (t * camera.aspect)) * 1.0;
    } else d = bestD;
    const target = (viewMode === 'full' ? fullPos : bestPos).set(SCREEN.x, SCREEN.y, SCREEN.z + d);
    const k = viewMode === 'full' ? 1 : Math.min(1, dt * 6);
    camera.position.lerp(target, k);
    camera.quaternion.slerp(new THREE.Quaternion(), k); // 正對 -z，完全水平
    const hide = viewMode === 'full';
    if (me.avatar) me.avatar.root.visible = !hide && camera.position.distanceTo(me.avatar.root.position) > 1.2;
    for (const r of remotes.values()) r.av.root.visible = !hide;
    return;
  }
  for (const r of remotes.values()) r.av.root.visible = true;
  cam.dist += (cam.targetDist - cam.dist) * Math.min(1, dt * 8);
  const fp = cam.dist < 0.35;
  const eye = me.seat ? 1.25 : 1.32;
  // 相機高度平滑跟隨（上下樓梯、跳躍時不會一格一格抖動）
  if (Math.abs(me.pos.y - me.camY) > 2.5) me.camY = me.pos.y;
  me.camY += (me.pos.y - me.camY) * Math.min(1, dt * (me.jumping ? 9 : 14));
  camTarget.set(me.pos.x, me.camY + eye + (fp ? 0.0 : 0.1), me.pos.z);
  dirV.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  let d = Math.max(cam.dist, 0.001);
  if (!fp) {
    for (const c of world.camBlock) { const t = rayBox(camTarget, dirV, d, c); if (t < d) d = Math.max(0.3, t - 0.25); }
  }
  camera.position.copy(camTarget).addScaledVector(dirV, fp ? 0 : d);
  // 室內天花板與地板限制
  const inHall = camera.position.z < -6.4 && Math.abs(camera.position.x) < 14;
  if (inHall) {
    const maxY = Math.abs(camera.position.x) < 6.4 ? 17 : (me.pos.y > 3 || camera.position.y < 6.5 ? 13.3 : 13.3);
    camera.position.y = Math.min(camera.position.y, maxY);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -13.7, 13.7);
    camera.position.z = Math.max(camera.position.z, -57.6);
  }
  camera.position.y = Math.max(camera.position.y, me.pos.y + 0.25);
  if (fp) {
    camera.position.copy(camTarget);
    tmpV.copy(camTarget).addScaledVector(dirV, -1); camera.lookAt(tmpV);
  } else camera.lookAt(camTarget);
  if (me.avatar) me.avatar.root.visible = cam.dist > 0.7;
}
// 名牌與泡泡：只更新看得到的角色
function updateLabels(dt) {
  const h = innerHeight;
  if (me.avatar && me.avatar.root.visible) me.avatar.updateLabels(camera, dt, h);
  for (const r of remotes.values()) if (r.av.root.visible) r.av.updateLabels(camera, dt, h);
}

function updateVolume() {
  if (!soundOn) return;
  const z = me.pos.z, x = me.pos.x;
  let v;
  if (z < -6.3 && Math.abs(x) < 14.5) v = 100 - Math.max(0, (-z - 40)) * 0; // 大廳內
  else if (z < 0) v = 70;
  else v = Math.max(8, 45 - Math.hypot(x, z) * 2.2);
  screen.setVolume(v);
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime; const now = performance.now();
  for (const f of world.anim) f(t);
  if (entered) {
    updateMe(dt);
    me.avatar.root.position.set(me.pos.x, me.pos.y + (me.seat ? 0.55 : 0), me.pos.z);
    me.avatar.root.rotation.y = me.ry;
    me.avatar.update(dt, me.speed, !!me.seat, t, me.jumping || me.airT > 0.2);
    updateCamera(dt);
    updateLabels(dt);
    expireRemotes(now);
    $('#btn-jump').classList.toggle('hidden', !isTouch || !!me.seat);
    netSend(now);
    // 附近椅子提示
    if (!me.seat) {
      nearSeat = findSeat();
      $('#btn-sit').classList.toggle('hidden', !nearSeat);
    } else $('#btn-sit').classList.remove('hidden');
    if (now - lastVideoTick > 4000) { lastVideoTick = now; screen.tick(); updateVolume(); }
  } else {
    // 開場：環繞建築外觀
    introT += dt;
    const a = Math.sin(introT * 0.08) * 0.55;
    camera.position.set(Math.sin(a) * 26, 6 + Math.sin(introT * 0.11) * 2, 26 + Math.cos(a) * 2);
    camera.lookAt(0, 13, -2);
  }
  for (const r of remotes.values()) {
    const k = Math.min(1, dt * 10);
    const p = r.av.root.position;
    const ox = p.x, oz = p.z;
    p.x += (r.tx - p.x) * k; p.z += (r.tz - p.z) * k;
    const ty = r.ty + (r.sitting ? 0.55 : 0); p.y += (ty - p.y) * Math.min(1, dt * (r.air ? 14 : 10));
    let d = r.try - r.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); r.ry += d * k; r.av.root.rotation.y = r.ry;
    const moved = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3) / 3.2;
    const ra = r.air ? r.a - 6 : r.sitting ? 0 : r.a;
    r.av.update(dt, r.sitting ? 0 : Math.max(Math.min(ra, 2.2), moved * 0.5), r.sitting, t, r.air);
  }
  renderer.render(scene, camera);
  screen.render(camera);
  for (const p of previews) {
    const w = p.c.clientWidth, h = p.c.clientHeight;
    if (w && (p.c.width !== Math.round(w * p.r.getPixelRatio()))) { p.r.setSize(w, h, false); p.cm.aspect = w / h; p.cm.updateProjectionMatrix(); }
    p.a.root.rotation.y = Math.sin(t * 0.8) * 0.6;
    p.a.update(dt, 0, false, t);
    p.r.render(p.s, p.cm);
  }
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); screen.setSize(innerWidth, innerHeight);
});

status('');
requestAnimationFrame(frame);
setTimeout(() => $('#loading-veil').classList.add('gone'), 100);
// 手機跳躍按鈕
const jumpBtn = $('#btn-jump');
jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); jumpQueued = performance.now(); jumpBtn.classList.add('press'); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jumpBtn.addEventListener(ev, () => jumpBtn.classList.remove('press'));
jumpBtn.addEventListener('contextmenu', (e) => e.preventDefault());
window.__hall = { me, cam, camera, scene, world, remotes, toggleSit, collide, groundAt, freeSpot, chat, jump: () => { jumpQueued = performance.now(); }, get ws() { return ws; }, get viewMode() { return viewMode; }, enterFull, exitFull };
