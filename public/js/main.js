import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld, SPAWN, HALL, SCREEN } from './world.js';
import { Avatar } from './avatar.js';
import { BigScreen, ScreenLayer } from './screen.js';
import { TSCREENS, TFOCUS, THEATER, inTheater } from './district.js';
import { tvLayout } from './tv-layout.js';
import { initChat } from './chat.js';
import { initAdminDock } from './admin-dock.js';
import { initOdm } from './odm.js';
import { initTravel } from './travel.js';

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

const layer = new ScreenLayer($('#stage'));
const screen = new BigScreen(scene, layer); // 殿堂大螢幕
// 城牆觀影館的兩台螢幕（同時視聽）：A＝作品畫面、B＝實況
const tIdle = (n, sub) => `<div style="width:640px;height:2px;background:linear-gradient(90deg,transparent,#b8954a,transparent);margin-bottom:40px"></div><div style="font-size:46px;letter-spacing:22px;padding-left:22px;color:#b8954a">MAUERHALLE</div><div style="margin-top:10px;font-size:260px;line-height:1;font-weight:600;letter-spacing:30px;padding-left:30px;color:#e8dcbc;text-shadow:0 5px 0 rgba(0,0,0,.45)">${n}</div><div style="margin-top:18px;font-size:34px;letter-spacing:14px;padding-left:14px;color:#9d8b66">${sub}</div><div style="width:640px;height:2px;background:linear-gradient(90deg,transparent,#b8954a,transparent);margin-top:40px"></div>`;
const tScreens = TSCREENS.map((c, i) => {
  const sc = new BigScreen(scene, layer, { ...c, elId: 'yt-theater-' + c.key, idleHTML: tIdle(i ? 'II' : 'I', 'AWAITING SIGNAL') });
  sc.el.idle.style.background = 'radial-gradient(ellipse at 50% 40%,#2a3528,#080a08 72%)';
  sc.setActive(false); return sc;
});
const allScreens = [screen, ...tScreens];
const anySound = () => allScreens.some((x) => x.isSoundOn());
let onZone = null;
let zoneWall = false; // 玩家在城牆區：只播觀影館兩台；否則只播殿堂大螢幕
function updateZone() {
  const x = me.pos.x, w = zoneWall ? x < -68.5 : x < -69.5;
  if (w === zoneWall) return;
  zoneWall = w;
  if (!w && viewMode === 'flat') tvSet('hall');
  screen.setActive(!w); for (const t of tScreens) t.setActive(w);
  updateVolume(); updateSoundButton();
  if (onZone) onZone(w); // 管理員控制台切換成觀影館／殿堂功能
}
// 目前要看的螢幕（坐下視角、最佳視角、全螢幕用）：{ x, y, z, w, h, ry }，ry 為螢幕面向（0 = 朝 +z）
const focusScreen = () => (zoneWall ? { ...TFOCUS, ry: Math.PI / 2 } : { x: SCREEN.x, y: SCREEN.y, z: SCREEN.z, w: SCREEN.w, h: SCREEN.h, ry: 0 });
layer.setSize(innerWidth, innerHeight);

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
let gear = null; // 立體機動裝置（odm.js，於下方初始化）
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
  if (gear && gear.on) best = Math.max(best, gear.tops(x, z, y)); // 裝上立體機動裝置：屋頂、牆頂也站得上去
  return best === -Infinity ? 0 : best;
}
// 牆擋住玩家的條件：腳高於 y1 - st 就可以跨上去（st 預設 0.35；台階型方塊用 0.55，與地面自動跨階一致）
const blocks = (c, y) => y + (c.st || 0.35) < c.y1 && y + 1.5 > c.y0;
// 圓弧城牆：牆中心線半徑 R、半厚（含牆腳）t；城門那段直牆（|dz| < L、在東側）由一般碰撞方塊處理
// 牆腳是三層往外收分的退台：腳的高度越高，碰撞半厚越接近牆身本身（貼牆站立時才會貼在牆面上）
const ringT = (g, y) => (y < 1.4 ? g.t : y < 2.8 ? g.top + 0.9 : y < 4.2 ? g.top + 0.45 : g.top);
const ringHit = (g, x, z, y) => {
  if (y > g.h) return null;
  const dx = x - g.x, dz = z - g.z; if (dx > 0 && Math.abs(dz) < g.L) return null;
  const d = Math.hypot(dx, dz), pen = ringT(g, y) + R - Math.abs(d - g.R);
  return pen > 0 ? { dx, dz, d } : null;
};
function collideRings(p) {
  for (const g of world.rings || []) {
    const h = ringHit(g, p.x, p.z, p.y); if (!h || h.d < 1e-6) continue;
    const t = ringT(g, p.y), r = h.d > g.R ? g.R + t + R : g.R - t - R;
    p.x = g.x + h.dx / h.d * r; p.z = g.z + h.dz / h.d * r;
  }
}
function collide(p) {
  collideRings(p);
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
  for (const g of world.rings || []) if (ringHit(g, x, z, y)) return null;
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
  if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Slash' || e.code === 'KeyT') && viewMode !== 'full' && viewMode !== 'flat') {
    e.preventDefault(); clearKeys(); chat.open(); return;
  }
  if (tvKey(e)) { e.preventDefault(); return; }
  keys[e.code] = true;
  // 回城（B）、傳送（F 開啟小地圖選點，1–9 直接選）、Esc 取消選點
  if (e.code === 'KeyB' && !e.repeat) { travel.recall(); return; }
  if (e.code === 'KeyF' && !e.repeat) { travel.togglePick(); return; }
  if (travel.picking && /^(Digit|Numpad)[1-9]$/.test(e.code)) { travel.teleport(Number(e.code.slice(-1)) - 1); return; }
  if (e.code === 'Escape' && travel.picking) { travel.setPick(false); return; }
  if (gear.key(e)) return;
  if (e.code === 'KeyE' && !e.repeat) toggleSit();
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = performance.now(); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Space' && !typing(e)) e.preventDefault(); });
addEventListener('blur', clearKeys);

// 滑鼠鎖定（FPS 式轉視角）：點一下畫面就鎖定，移動滑鼠直接轉；Esc 放開。沒鎖定時仍可拖曳
const canLook = () => viewMode !== 'best' && viewMode !== 'full' && viewMode !== 'flat';
const locked = () => document.pointerLockElement === canvas;
function lockPointer() {
  if (isTouch || !entered || locked() || !canLook() || !canvas.requestPointerLock) return;
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (_) { }
}
function unlockPointer() { if (locked()) try { document.exitPointerLock(); } catch (_) { } }
document.addEventListener('pointerlockchange', () => { document.body.classList.toggle('locked', locked()); if (locked()) pointers.clear(); });
document.addEventListener('mousemove', (e) => {
  if (!locked() || !canLook()) return;
  const k = 0.0022 * (camera.fov / 60);
  cam.yaw -= e.movementX * k; cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * k, -1.2, 1.35);
});
let downAt = null;

const pointers = new Map(); let pinchD = 0, targetFov = 60;
function zoomSeat(f) {
  if (viewMode !== 'seat' || cam.targetDist !== 0) return false;
  if (f < 1 || targetFov < 60 || camera.fov < 60) {
    targetFov = THREE.MathUtils.clamp(targetFov * f, 20, 60);
    return true;
  }
  return false;
}
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
      else if (viewMode !== 'full' && viewMode !== 'flat' && !zoomSeat(pinchD / d)) {
        const f = pinchD / d;
        cam.targetDist = viewMode === 'seat' && cam.targetDist < 0.3 && f > 1 ? 0.8 : THREE.MathUtils.clamp(cam.targetDist * f, cam.minD, cam.maxD);
        if (viewMode === 'seat' && cam.targetDist < 0.45 && f < 1) cam.targetDist = 0;
      }
    }
    pinchD = d; return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (viewMode === 'best' || viewMode === 'full' || viewMode === 'flat') return;
  const k = (isTouch ? 0.006 : 0.0045) * (camera.fov / 60);
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
  if (viewMode === 'best') { bestD = THREE.MathUtils.clamp(bestD * f, 6, zoneWall ? 30 : 42); return; }
  if (viewMode === 'full' || viewMode === 'flat') return;
  if (zoomSeat(f)) return;
  cam.targetDist = cam.targetDist < 0.3 && e.deltaY > 0 ? 0.8 : THREE.MathUtils.clamp(cam.targetDist * f, cam.minD, cam.maxD);
  if (cam.targetDist < 0.45 && e.deltaY < 0) cam.targetDist = 0;
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 坐下（一人一椅，伺服器為準） ----------
// 座位編號 = world.seats 的順序（world.js 依固定順序建立，所有用戶端一致）
world.seats.forEach((s, i) => { s.i = i; });
const seatOcc = new Map(); // 座位編號 -> 坐著的玩家 id（伺服器廣播）
let nearSeat = null, nearTaken = false;
function seatTaken(s) { const o = seatOcc.get(s.i); return !!o && o !== me.id; }
function setSeatOcc(list) { seatOcc.clear(); for (const [i, id] of list || []) seatOcc.set(Number(i), String(id)); }
// 找最近的空椅子；範圍內只有別人坐著的椅子時 nearTaken = true（按鈕顯示「已有人」）
function findSeat() {
  let best = null, bd = 1.25; nearTaken = false;
  for (const s of world.seats) {
    if (Math.abs((s.y - 0.5) - me.pos.y) > 0.6) continue;
    const d = Math.hypot(s.x - me.pos.x, s.z - me.pos.z);
    if (d >= 1.25) continue;
    if (seatTaken(s)) { nearTaken = true; continue; }
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function toggleSit() {
  if (travel.channeling) travel.cancel(false);
  if (me.seat) { standUp(); return; }
  if (!me.onGround) return;
  const s = (nearSeat && !seatTaken(nearSeat) ? nearSeat : null) || findSeat();
  if (!s) { if (nearTaken) toast('這個位子有人坐了'); return; }
  sitAt(s);
}
function sitAt(s, quiet) {
  me.seat = s; me.pos.set(s.x, s.y - 0.5, s.z); me.ry = s.ry; me.speed = 0; me.vy = 0; me.jumping = false;
  seatView();
  $('#btn-sit').textContent = '站起來'; $('#btn-sit').disabled = false; sitLabel = '站起來';
  if (!quiet) toast('已坐下 · 可用下方按鈕切換最佳視角或全螢幕');
  $('#seat-tools').classList.remove('hidden'); setMode('seat');
  wsSend({ t: 'sit', seat: s.i }); // 先坐下（樂觀），伺服器拒絕時再站起來
  sendNow();
}
function standUp() {
  const s = me.seat; me.seat = null;
  wsSend({ t: 'stand' });
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
  $('#btn-sit').textContent = '坐下'; sitLabel = '坐下'; sendNow();
}
let sitLabel = '坐下';
$('#btn-sit').addEventListener('click', (e) => { e.stopPropagation(); toggleSit(); });

// 坐下時：第一人稱，從座位的眼睛高度看向大螢幕中央
function seatView() {
  const ex = me.pos.x, ey = me.pos.y + 1.25, ez = me.pos.z;
  updateZone(); const F = focusScreen();
  const lx = F.x - ex, ly = F.y - ey, lz = F.z - ez; const l = Math.hypot(lx, ly, lz);
  cam.pitch = Math.asin(-ly / l); cam.yaw = Math.atan2(-lx, -lz);
  cam.dist = cam.targetDist = 0;
}
function setMode(m) {
  if (m !== 'seat' || viewMode !== 'seat') {
    targetFov = camera.fov = 60;
    camera.updateProjectionMatrix();
  }
  viewMode = m;
  if (!canLook()) unlockPointer();
  document.body.classList.toggle('seated', m === 'seat' || m === 'best');
  $('#btn-best').textContent = m === 'best' ? '✕ 取消最佳視角' : '🎯 最佳視角';
  $('#btn-best').classList.toggle('on', m === 'best');
  document.body.classList.toggle('mode-full', m === 'full');
  document.body.classList.toggle('mode-flat', m === 'flat');
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

// ---------- 觀影館的觀看方式（同時視聽，一個人看兩台） ----------
// hall：在館內看（坐下、最佳視角、走遠走近都可以）；a、b：只看 I 或 II（滿版）；split：兩台並排（拖中間的把手調大小）；pip：子母畫面（點小畫面交換、拖到四個角）
// 平面模式不畫 3D 場景，只把兩個 YouTube 播放器直接排在畫面上（播放器不重建、不中斷，同步照舊）
const TV_NAMES = { hall: '館內觀看 · 可坐下、最佳視角或走遠一點看', a: '只看 I（滿版）', b: '只看 II（滿版）', split: '兩台並排 · 拖中間把手調整大小', pip: '子母畫面 · 點小畫面交換，拖到四個角落' };
const TV_ORDER = ['hall', 'split', 'pip', 'a', 'b'];
const tvL = { layout: 'hall', ratio: 0.5, swap: false, main: 'a', corner: 3, pipSize: 0.3 };
const tvMute = { a: false, b: false };
try { const v = JSON.parse(localStorage.getItem('hall-tv') || '{}'); for (const k of ['ratio', 'swap', 'main', 'corner', 'pipSize']) if (k in v) tvL[k] = v[k]; } catch (_) { }
const tvSave = () => { try { localStorage.setItem('hall-tv', JSON.stringify({ ratio: tvL.ratio, swap: tvL.swap, main: tvL.main, corner: tvL.corner, pipSize: tvL.pipSize })); } catch (_) { } };
let tvSaved = null, tvPrevMode = 'normal', tvFs = false, tvIdleT = 0;
const tvCam = () => tScreens[0].obj.element.parentElement; // CSS3DRenderer 的相機層（螢幕元素的父層）
const tvEls = () => tScreens.map((t) => t.obj.element);
const tvHere = () => zoneWall && (viewMode === 'flat' || inTheater(me.pos.x, me.pos.z));
function tvSet(l, quiet) {
  if (!TV_ORDER.includes(l)) l = 'hall';
  if (l !== 'hall' && !zoneWall) return;
  const was = tvL.layout; tvL.layout = l;
  if (l === 'hall') {
    if (viewMode === 'flat') {
      tvRestore();
      setMode(me.seat ? (tvPrevMode === 'best' ? 'best' : 'seat') : 'normal');
      if (viewMode === 'seat') seatView();
      if (tvFs) { tvFs = false; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) { } }
    }
  } else if (viewMode !== 'flat') {
    tvPrevMode = viewMode === 'full' ? modeBeforeFull : viewMode;
    const c = tvCam();
    tvSaved = { t: c.style.transform, ts: c.style.transformStyle, els: tvEls().map((e) => ({ t: e.style.transform, d: e.style.display })) };
    c.style.transformStyle = 'flat';
    tvFs = !!document.fullscreenElement;
    setMode('flat');
    if (!document.fullscreenElement && !isTouch) { try { document.documentElement.requestFullscreen?.().then(() => { tvFs = true; }).catch(() => { }); } catch (_) { } }
  }
  tvPoke(); tvUI();
  if (!quiet && l !== was) toast(TV_NAMES[l], 2200);
}
function tvRestore() {
  const c = tvCam();
  if (tvSaved) { c.style.transform = tvSaved.t; c.style.transformStyle = tvSaved.ts; tvEls().forEach((e, i) => { e.style.transform = tvSaved.els[i].t; e.style.display = tvSaved.els[i].d; }); }
  for (const e of tvEls()) { e.style.opacity = ''; e.style.borderRadius = ''; e.style.boxShadow = ''; e.style.zIndex = ''; }
  tvSaved = null;
  $('#tv-hit').classList.add('hidden');
}
function tvSwap() {
  if (tvL.layout === 'split') tvL.swap = !tvL.swap;
  else if (tvL.layout === 'pip') tvL.main = tvL.main === 'a' ? 'b' : 'a';
  else if (tvL.layout === 'a' || tvL.layout === 'b') { tvSet(tvL.layout === 'a' ? 'b' : 'a'); return; }
  else return;
  tvSave(); tvPoke();
}
// 每幀排版（只改 CSS transform，很省）
let tvLast = null;
function tvFrame() {
  const W = innerWidth, H = innerHeight, single = tvL.layout === 'a' || tvL.layout === 'b';
  const L = tvLast = tvLayout(W, H, { ...tvL, margin: single ? 0 : Math.round(Math.min(W, H) * 0.012), gap: Math.max(6, Math.round(Math.min(W, H) * 0.012)) });
  const c = tvCam(); if (c.style.transform !== 'none') c.style.transform = 'none';
  tScreens.forEach((t, i) => {
    const r = L[i ? 'b' : 'a'], e = t.obj.element, s = r.w / 1280;
    const tf = `translate(${(r.x + r.w / 2 - 640).toFixed(1)}px,${(r.y + r.h / 2 - 360).toFixed(1)}px) scale(${s.toFixed(4)})`;
    if (e.style.transform !== tf) e.style.transform = tf;
    if (e.style.display) e.style.display = '';
    e.style.opacity = r.show ? '1' : '0';
    e.style.zIndex = r.pip ? '2' : '1';
    e.style.borderRadius = single ? '0' : (r.pip ? 8 : 4) / s + 'px';
    e.style.boxShadow = r.pip ? `0 0 0 ${1.5 / s}px rgba(232,220,188,.6),0 ${12 / s}px ${34 / s}px rgba(0,0,0,.65)` : 'none';
  });
  tvHits(L);
}
// 互動層：子畫面（點一下交換、拖到角落）、並排的中間把手、I／II 標籤
function tvHits(L) {
  const hit = $('#tv-hit'); hit.classList.remove('hidden');
  const pipK = L.a.pip ? 'a' : L.b.pip ? 'b' : null;
  const pb = $('#tv-pip'), dv = $('#tv-div');
  pb.classList.toggle('hidden', !pipK);
  if (pipK && !tvDrag) { const r = L[pipK]; pb.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; }
  dv.classList.toggle('hidden', !L.divider);
  if (L.divider) { dv.classList.toggle('col', L.dir === 'col'); dv.style.left = L.divider.x + 'px'; dv.style.top = L.divider.y + 'px'; }
  for (const k of ['a', 'b']) {
    const tag = $('#tv-tag-' + k), r = L[k];
    tag.classList.toggle('hidden', !r.show);
    tag.style.left = r.x + 10 + 'px'; tag.style.top = r.y + 10 + 'px';
    tag.classList.toggle('muted', tvMute[k]);
  }
}
let tvDrag = null;
$('#tv-pip').addEventListener('pointerdown', (e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); tvDrag = { k: 'pip', x: e.clientX, y: e.clientY, ox: r.left, oy: r.top, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); tvPoke(); });
$('#tv-pip').addEventListener('pointermove', (e) => {
  if (!tvDrag || tvDrag.k !== 'pip') return;
  const dx = e.clientX - tvDrag.x, dy = e.clientY - tvDrag.y; if (Math.hypot(dx, dy) > 8) tvDrag.moved = true;
  if (tvDrag.moved) { e.currentTarget.style.left = tvDrag.ox + dx + 'px'; e.currentTarget.style.top = tvDrag.oy + dy + 'px'; e.currentTarget.classList.add('dragging'); }
});
$('#tv-pip').addEventListener('pointerup', (e) => {
  if (!tvDrag || tvDrag.k !== 'pip') return;
  const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.classList.remove('dragging');
  if (tvDrag.moved) { tvL.corner = (r.left + r.width / 2 > innerWidth / 2 ? 1 : 0) + (r.top + r.height / 2 > innerHeight / 2 ? 2 : 0); tvSave(); }
  else tvSwap();
  tvDrag = null;
});
$('#tv-div').addEventListener('pointerdown', (e) => { e.preventDefault(); tvDrag = { k: 'div' }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.classList.add('dragging'); });
$('#tv-div').addEventListener('pointermove', (e) => {
  if (!tvDrag || tvDrag.k !== 'div' || !tvLast) return;
  const row = tvLast.dir === 'row', p = row ? e.clientX / innerWidth : e.clientY / innerHeight;
  tvL.ratio = Math.min(0.75, Math.max(0.25, p)); tvPoke();
});
const tvDivEnd = (e) => { if (tvDrag?.k !== 'div') return; tvDrag = null; e.currentTarget.classList.remove('dragging'); tvSave(); };
$('#tv-div').addEventListener('pointerup', tvDivEnd); $('#tv-div').addEventListener('pointercancel', tvDivEnd);
$('#tv-div').addEventListener('dblclick', () => { tvL.ratio = 0.5; tvSave(); });
// 工具列：館內時常駐；平面模式下 2.5 秒沒動作就淡出，動一下滑鼠或點畫面就回來
function tvPoke() { tvIdleT = performance.now(); $('#tv-bar').classList.remove('idle'); document.body.classList.remove('tv-idle'); }
addEventListener('pointermove', () => { if (viewMode === 'flat') tvPoke(); }, { passive: true });
addEventListener('pointerdown', () => { if (viewMode === 'flat') tvPoke(); }, { passive: true });
setInterval(() => { if (viewMode === 'flat' && !tvDrag && performance.now() - tvIdleT > 2600 && !$('#tv-bar').matches(':hover')) { $('#tv-bar').classList.add('idle'); document.body.classList.add('tv-idle'); } }, 400);
function tvUI() {
  const on = tvHere(); document.body.classList.toggle('tv-on', on);
  $('#tv-bar').classList.toggle('hidden', !on);
  if (!on) return;
  for (const b of document.querySelectorAll('#tv-bar [data-tv]')) b.classList.toggle('on', b.dataset.tv === tvL.layout);
  const l = tvL.layout;
  $('#tv-swap').classList.toggle('hidden', l === 'hall');
  $('#tv-corner').classList.toggle('hidden', l !== 'pip'); $('#tv-size').classList.toggle('hidden', l !== 'pip');
  for (const k of ['a', 'b']) { const b = $('#tv-m' + k); b.classList.toggle('off', tvMute[k]); b.querySelector('i').textContent = tvMute[k] ? '🔇' : '🔊'; }
}
document.querySelectorAll('#tv-bar [data-tv]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); tvSet(b.dataset.tv); }));
$('#tv-swap').addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); tvSwap(); });
$('#tv-corner').addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); tvL.corner = [1, 3, 2, 0][tvL.corner] ?? 3; tvSave(); tvPoke(); });
$('#tv-size').addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); const S = [0.22, 0.3, 0.4]; tvL.pipSize = S[(S.findIndex((v) => v >= tvL.pipSize - 0.001) + 1) % S.length]; tvSave(); tvPoke(); });
for (const k of ['a', 'b']) $('#tv-m' + k).addEventListener('click', (e) => {
  e.stopPropagation(); e.currentTarget.blur(); tvMute[k] = !tvMute[k]; updateVolume(); tvUI();
  if (!soundOn) toast('先按右上角開啟聲音');
  else toast(`${k === 'a' ? 'I' : 'II'} ${tvMute[k] ? '已靜音（只對你自己）' : '恢復聲音'}`);
});
// 鍵盤：V 切換觀看方式、X 交換、C 子畫面換角落、Esc 回到館內
function tvKey(e) {
  if (!tvHere() || e.repeat) return false;
  if (e.code === 'KeyV') { const i = TV_ORDER.indexOf(tvL.layout); tvSet(TV_ORDER[(i + (e.shiftKey ? TV_ORDER.length - 1 : 1)) % TV_ORDER.length]); return true; }
  if (viewMode !== 'flat') return false;
  if (e.code === 'KeyX') { tvSwap(); return true; }
  if (e.code === 'KeyC' && tvL.layout === 'pip') { $('#tv-corner').click(); return true; }
  if (e.code === 'Escape') { tvSet('hall'); return true; }
  return true; // 平面模式下其他按鍵（移動、跳）都不作用
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && viewMode === 'flat' && tvFs) { tvFs = false; tvSet('hall'); } });
setInterval(tvUI, 500);

// ---------- UI ----------
let toastT;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
let soundOn = false;
// 個人音量（0–100，只影響自己，記在這台裝置上）；與大廳內外的分區音量相乘
let userVol = 80;
try { const sv = Number(localStorage.getItem('hall-volume')); if (localStorage.getItem('hall-volume') !== null && sv >= 0 && sv <= 100) userVol = sv; } catch (_) { }
function showVol() { const el = $('#vol'); el.value = userVol; el.style.setProperty('--v', userVol + '%'); $('#vol-n').textContent = Math.round(userVol); }
$('#vol').addEventListener('input', (e) => { userVol = Number(e.target.value); showVol(); try { localStorage.setItem('hall-volume', String(userVol)); } catch (_) { } updateVolume(); });
$('#vol').addEventListener('change', (e) => e.target.blur()); // 放開後把焦點還給場景，方向鍵才不會去動拉桿
showVol();
function updateSoundButton() {
  const active = anySound(), btn = $('#btn-sound');
  $('#vol-pill').classList.toggle('hidden', !soundOn);
  btn.textContent = active ? (innerWidth <= 560 ? '🔊' : '🔊 聲音開啟') : soundOn ? '🔇 點一下開啟聲音' : '🔇 開啟聲音';
  btn.setAttribute('aria-pressed', String(active));
}
for (const x of allScreens) x.onSoundChange = updateSoundButton;
function setSound(on) { soundOn = on; if (on) updateVolume(); for (const x of allScreens) x.setSound(on); updateSoundButton(); }
$('#btn-sound').addEventListener('click', () => setSound(!anySound()));
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
const { filterChat: filterName } = globalThis.HallChatFilter; // chat.js 已載入共用模組
const validName = (name) => { const f = filterName(name); return f.ok && f.text === name; };
const nameInput = $('#name-input');
const cleanName = (v) => Array.from(String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 16).join('').trim();
let defaultName = '訪客' + String(1000 + Math.floor(Math.random() * 9000));
try {
  const saved = localStorage.getItem('hall-name');
  if (saved && validName(cleanName(saved))) nameInput.value = cleanName(saved);
  else if (saved) localStorage.removeItem('hall-name');
  const d = cleanName(localStorage.getItem('hall-default-name'));
  if (d && validName(d)) defaultName = d;
  else localStorage.setItem('hall-default-name', defaultName);
} catch (_) { }
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
  const name = cleanName(nameInput.value);
  if (!validName(name)) { status('名字不能包含不雅字眼或聯絡方式，請換一個'); nameInput.focus(); return; }
  me.color = chosen;
  me.name = name || defaultName; nameInput.value = name;
  try { if (nameInput.value) localStorage.setItem('hall-name', nameInput.value); else localStorage.removeItem('hall-name'); } catch (_) { }
  setSound(true); // 使用者點擊時解除靜音（瀏覽器規定需要互動）
  saveIdentity();
  status('連線中…');
  connect();
});

// ---------- 身分保存（重新整理、伺服器重啟後回到原位） ----------
// localStorage：hall-identity = { token, name, color }（token 由伺服器以 HMAC 簽章，用來認回同一個名額與座位）
//               hall-snap = { x,y,z,ry, seat, view, yaw,pitch,dist, sound, t }（每秒與離開頁面時存一次）
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { } },
};
let identity = LS.get('hall-identity') || {};
let kicked = false;
function saveIdentity() { identity = { ...identity, name: me.name, color: me.color }; LS.set('hall-identity', identity); }
function saveSnap() {
  if (!entered || kicked) return;
  LS.set('hall-snap', {
    x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(2),
    seat: me.seat ? me.seat.i : null, view: viewMode === 'flat' ? 'flat:' + tvL.layout : viewMode, yaw: +cam.yaw.toFixed(3), pitch: +cam.pitch.toFixed(3), dist: +cam.targetDist.toFixed(2),
    sound: soundOn || soundWanted, t: Date.now(),
  });
}
let lastSnapSave = 0;
function saveSnapMaybe(now) { if (now - lastSnapSave > 1000) { lastSnapSave = now; saveSnap(); } }
addEventListener('pagehide', saveSnap); addEventListener('beforeunload', saveSnap);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSnap(); });
// 30 分鐘內重新整理：跳過選角，直接回到原位
const RESTORE_MS = 30 * 60 * 1000;
let restoreSnap = null, soundWanted = false;
{
  const snap = LS.get('hall-snap');
  if (identity.color && identity.token && snap && Date.now() - snap.t < RESTORE_MS && !params.has('select')) restoreSnap = snap;
  if (identity.color) {
    const b = document.querySelector(`.choice[data-color=${identity.color === 'blue' ? 'blue' : 'pink'}]`);
    if (b) b.click();
  }
}
// 換角色：清掉保存的外觀與位置（token 保留，伺服器會把同一個名額改成新名字／顏色）
function changeCharacter() {
  LS.del('hall-snap'); identity = { token: identity.token }; LS.set('hall-identity', identity);
  kicked = true; // 不要在離開前又存一次
  location.replace(location.pathname);
}

// ---------- 網路 ----------
let ws, serverOffset = 0, lastSend = 0, lastSent = '';
let bootVersion = null, mediaState = null;
const remotes = new Map();
function wsSend(m) { if (ws && ws.readyState === 1 && me.id) ws.send(JSON.stringify(m)); }
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = async () => {
    // 管理員不佔名額：有保存管理密碼時，先換一張短效入場券再打招呼（密碼只送到同源的 /api/admin/*）
    let adm = null;
    try {
      const pw = localStorage.getItem('hall-admin') || sessionStorage.getItem('hall-admin');
      if (pw) { const r = await fetch('/api/admin/ticket', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { Authorization: 'Bearer ' + pw, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(4000) }); if (r.ok) adm = (await r.json()).ticket || null; }
    } catch (_) { }
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'hello', color: me.color, name: me.name, token: identity.token || null, keep: true, adm })); ping();
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'welcome': onWelcome(m); break;
      case 'queue': $('#select').classList.add('hidden'); $('#rejoin').classList.add('hidden'); $('#queue').classList.remove('hidden');
        $('#queue-text').textContent = `目前 ${m.online} / ${m.max} 人在線，你排在第 ${m.position} 位。`; break;
      case 's': onSnapshot(m); break;
      case 'join': addRemote(m.id, m.c, m); break;
      case 'leave': removeRemote(m.id); travel.forget(m.id); break;
      case 'fx': if (m.id !== me.id) travel.onRemote(m); break;
      case 'chat': onChat(m); break;
      case 'info': for (const o of m.p) { const r = remotes.get(o.id); if (r && r.needInfo) { removeRemote(o.id); addRemote(o.id, o.c, { ...r.last, n: o.n }); } } break;
      case 'media': onMedia(m.m); break;
      case 'video': screen.setState(m.video); break;
      case 'seats': setSeatOcc(m.s); break;
      case 'gears': case 'gearOk': case 'gearNo': gear.onMsg(m); break;
      case 'lights': applyLights(m.on); break;
      case 'tlights': applyTLights(m.on); break;
      case 'sitOk': break;
      case 'sitNo':
        if (me.seat && me.seat.i === Number(m.seat)) { standUp(); toast('這個位子有人坐了'); }
        break;
      case 'kicked': onKicked(m.reason); break;
      case 'pong': { const rtt = performance.now() - m.c; serverOffset = m.s + rtt / 2 - Date.now(); for (const x of allScreens) x.setServerOffset(serverOffset); break; }
    }
  };
  ws.onclose = () => {
    if (kicked) return;
    if (!entered) { status('連線中斷，2 秒後重試…'); setTimeout(connect, 2000); return; }
    toast('連線中斷，正在重新連線…', 4000);
    for (const id of [...remotes.keys()]) removeRemote(id);
    setTimeout(connect, 2000);
  };
}
function ping() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }
setInterval(ping, 20000);
function onKicked(reason) {
  kicked = true;
  $('#kicked-text').textContent = reason || '你在另一個分頁開啟了殿堂';
  $('#kicked').classList.remove('hidden'); $('#rejoin').classList.add('hidden');
  unlockPointer(); setSound(false);
  for (const id of [...remotes.keys()]) removeRemote(id);
}
$('#btn-kicked').addEventListener('click', () => location.reload());
function onMedia(m) {
  mediaState = m; screen.setMedia(m); dock.setMedia(m);
  const th = m.theater || {}; tScreens[0].setChannel(th.a || null); tScreens[1].setChannel(th.b || null);
}
// 室內燈（管理員控制，伺服器同步）：記住最新值；world.setLights 由 world.js 提供（還沒有時先略過，之後 applyLights() 會補上）
let lightsOn = true;
// 城牆觀影館的燈（同時視聽後台控制）
function applyTLights(on) { world?.setWallLights?.(!!on); dock?.setTLights?.(!!on); }
function applyLights(on) {
  if (typeof on === 'boolean') lightsOn = on;
  document.body.classList.toggle('lights-off', !lightsOn);
  world?.setLights?.(lightsOn);
  dock?.setLights?.(lightsOn);
}
// 播放器回報（片長、播完、無法播放），讓伺服器決定何時換下一首／比賽結束回到音樂
for (const x of allScreens) x.onReport = (msg) => wsSend(msg);

function onWelcome(m) {
  const firstEntry = !entered;
  me.id = m.id; if (m.name) me.name = m.name;
  if (m.token) { identity.token = m.token; saveIdentity(); }
  for (const id of [...remotes.keys()]) removeRemote(id); // 重新連線：以伺服器的名單為準，不留下舊的角色
  $('#select').classList.add('hidden'); $('#queue').classList.add('hidden'); $('#hud').classList.remove('hidden');
  $('#rejoin').classList.add('fade'); setTimeout(() => $('#rejoin').classList.add('hidden'), 600);
  for (const p of previews) { p.r.dispose(); }
  previews.length = 0;
  setSeatOcc(m.seats);
  if (m.media) onMedia(m.media); else screen.setState(m.video);
  applyLights(m.lights); applyTLights(m.tlights !== false);
  for (const p of m.players) addRemote(p.id, p.c, p);
  if (firstEntry) {
    entered = true;
    me.avatar = new Avatar(me.color); scene.add(me.avatar.root);
    me.avatar.setName(me.name);
    me.pos.set(SPAWN.x + (Math.random() - 0.5) * 6, 0.15, SPAWN.z + (Math.random() - 0.5) * 1.5);
    me.ry = Math.PI; cam.yaw = 0; cam.pitch = 0.12; cam.dist = cam.targetDist = 6; me.camY = me.pos.y;
    if (isTouch) $('#btn-jump').classList.remove('hidden');
    travel.show();
    if (restoreSnap) restoreFrom(restoreSnap);
    else { toast('歡迎！往前走進大門，大螢幕就在大廳盡頭', 4500); }
    setTimeout(() => $('#hint').classList.add('fade'), restoreSnap ? 2000 : 12000);
    restoreSnap = null;
  } else {
    if (me.avatar.labels && me.avatar.labels.name !== me.name) me.avatar.setName(me.name);
    if (me.seat) wsSend({ t: 'sit', seat: me.seat.i }); // 重新連線：再要一次同一張椅子（保留期間伺服器仍算你的）
  }
  gear.welcome(m.gears);
  updateOnline(m.players.length + 1);
  checkVersion(m.version);
}
// 回到重新整理前的位置、面向與視角；原本的椅子還空著就坐回去
function restoreFrom(sn) {
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  me.pos.set(n(sn.x, me.pos.x), n(sn.y, me.pos.y), n(sn.z, me.pos.z)); me.ry = n(sn.ry, me.ry); me.camY = me.pos.y;
  cam.yaw = n(sn.yaw, cam.yaw); cam.pitch = n(sn.pitch, cam.pitch); cam.dist = cam.targetDist = THREE.MathUtils.clamp(n(sn.dist, cam.dist), cam.minD, cam.maxD);
  const s = Number.isInteger(sn.seat) ? world.seats[sn.seat] : null;
  if (s && !seatTaken(s)) {
    sitAt(s, true);
    if (sn.view === 'best') setMode('best');
    else if (sn.view === 'full') enterFull();
  } else if (s) toast('原本的位子已經有人坐了');
  if (typeof sn.view === 'string' && sn.view.startsWith('flat:')) { updateZone(); if (zoneWall) tvSet(sn.view.slice(5), true); }
  if (!me.seat && freeSpot(me.pos.x, me.pos.y, me.pos.z) === null) collide(me.pos);
  // 瀏覽器規定要有使用者互動才能開聲音：點一下畫面或按任意鍵就恢復
  if (sn.sound) {
    soundWanted = true; toast('歡迎回來 · 點一下畫面即可恢復聲音', 4500);
    const on = (e) => { soundWanted = false; if (!anySound() && !kicked && !(e.target.closest && e.target.closest('#btn-sound'))) setSound(true); removeEventListener('click', on, true); removeEventListener('keydown', on, true); };
    // Android 的 pointerdown 尚未完成點擊手勢；使用 click 才能確實解鎖媒體。
    addEventListener('click', on, true); addEventListener('keydown', on, true);
  } else toast('歡迎回來', 2500);
}

// ---------- 新版本通知 ----------
let dismissedVersion = null;
function checkVersion(v) {
  if (!v) return;
  if (!bootVersion) { bootVersion = v; return; }
  if (v !== bootVersion && v !== dismissedVersion && entered && !kicked) { $('#update-note').classList.remove('hidden'); $('#update-note').dataset.v = v; }
}
fetch('/api/version', { cache: 'no-store' }).then(r => r.json()).then(j => { if (!bootVersion) bootVersion = j.version; }).catch(() => { });
setInterval(() => { fetch('/api/version', { cache: 'no-store' }).then(r => r.json()).then(j => checkVersion(j.version)).catch(() => { }); }, 60000);
$('#btn-update').addEventListener('click', () => { saveSnap(); location.reload(); });
$('#btn-later').addEventListener('click', () => { dismissedVersion = $('#update-note').dataset.v; $('#update-note').classList.add('hidden'); });

function updateOnline(n) { $('#online-n').textContent = n; }
function addRemote(id, color, p) {
  if (id === me.id || remotes.has(id)) return;
  const av = new Avatar(color); scene.add(av.root);
  av.root.position.set(p.x, p.y, p.z);
  if (p.n) av.setName(p.n);
  const a = p.a || 0;
  remotes.set(id, { av, name: p.n || '', color, tx: p.x, ty: p.y, tz: p.z, try: p.ry || 0, ry: p.ry || 0, a, sitting: a > 4.5 && a < 5.5, air: a >= 6, seen: performance.now(), needInfo: !p.n });
  if (p.g) gear.remoteState(remotes.get(id), p.g);
}
function removeRemote(id) { const r = remotes.get(id); if (r) { r.av.dispose(); remotes.delete(id); } }
// 動作欄位 a：0～4 地面速度、5 坐著、6 以上 = 在空中（a - 6 為速度）
function onSnapshot(m) {
  updateOnline(m.n);
  const now = performance.now(), unknown = [];
  for (const [id, x, y, z, ry, a, g] of m.p) {
    if (id === me.id) continue;
    let r = remotes.get(id);
    if (!r) { addRemote(id, 'pink', { x, y, z, ry, a }); r = remotes.get(id); unknown.push(id); }
    // 位置一次跳很遠（傳送、回城）：直接移過去，不要從半空中滑過整個大廳
    gear.remoteState(r, g);
    if (Math.hypot(x - r.av.root.position.x, z - r.av.root.position.z) > (r.odm && r.odm.f & 32 ? 20 : 6)) { r.av.root.position.set(x, y + (a > 4.5 && a < 5.5 ? 0.55 : 0), z); r.ry = ry; }
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
// 管理員控制台（有存管理密碼且驗證成功才顯示）
const dock = initAdminDock({ toast, onFocus: () => { clearKeys(); unlockPointer(); }, isTouch });
onZone = (w) => dock.setZone(w); dock.setZone(zoneWall);
$('#btn-rechar').addEventListener('click', changeCharacter);
// 傳送與回城（左上角小地圖）
const travel = initTravel({
  scene, hud: $('#hud'), isTouch, toast, send: wsSend, me,
  getAvatar: (id) => remotes.get(id)?.av || null,
  beforeChannel: () => { if (me.seat) standUp(); jumpQueued = -1e9; },
  onPickOpen: () => { clearKeys(); unlockPointer(); },
  // 抵達：在目的地附近找一個站得下的位置，面向大螢幕
  place: (d) => {
    let spot = null;
    for (let r = 0; r <= 3 && !spot; r += 0.5) for (let k = 0; k < (r ? 12 : 1) && !spot; k++) {
      const a = k / 12 * Math.PI * 2 + Math.random() * 0.3, x = d.x + Math.cos(a) * r + (r ? 0 : (Math.random() - 0.5) * 0.8), z = d.z + Math.sin(a) * r;
      let crowd = false; // 不要和其他人疊在一起
      for (const rr of remotes.values()) { const q = rr.av.root.position; if (Math.abs(q.y - d.y) < 2 && Math.hypot(q.x - x, q.z - z) < 0.85) { crowd = true; break; } }
      if (crowd) continue;
      const g = freeSpot(x, d.y, z); if (g !== null) spot = [x, g, z];
    }
    if (!spot) spot = [d.x, d.y, d.z];
    gear.reset();
    me.pos.set(spot[0], spot[1], spot[2]); me.vy = 0; me.onGround = true; me.jumping = false; me.airT = 0; me.camY = me.pos.y;
    me.ry = Math.PI; cam.yaw = 0; cam.pitch = Math.min(cam.pitch, 0.25); me.speed = 0;
    sendNow();
    return { x: spot[0], y: spot[1], z: spot[2] };
  },
});
travel.setAvatars(() => [...remotes].map(([id, r]) => [id, r.av]));
// 立體機動裝置（城牆區裝備庫借用）
gear = initOdm({
  scene, camera, world, me, keys, isTouch, toast, send: wsSend, collide, groundAt, inTheater, THEATER, hud: $('#hud'),
  locked, canUse: () => entered && viewMode === 'normal', yaw: () => cam.yaw, joy: () => joy,
  onAction: () => { if (travel.channeling) travel.interrupt(); },
  flush: () => { lastSend = 0; lastSent = ''; netSend(performance.now()); },
});
travel.setViewYaw(() => cam.yaw);
function sendNow() { lastSend = 0; }
function netSend(now) {
  if (!ws || ws.readyState !== 1 || !entered) return;
  if (now - lastSend < (gear.flying ? 66 : 100)) return;
  const sp = Math.min(3.9, +me.speed.toFixed(2));
  const a = me.seat ? 5 : (me.jumping || me.airT > 0.2) ? +(6 + Math.min(sp, 3)).toFixed(2) : sp;
  const msg = JSON.stringify({ t: 'p', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(2), a, g: gear.encode() });
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
  if (viewMode === 'flat') { me.speed = 0; return; } // 平面觀看模式：角色留在原地
  if (gear.stepMe(dt)) { if (travel.channeling) travel.interrupt(); return; } // 立體機動裝置飛行／貼牆中
  const il = Math.hypot(ix, iz);
  if (travel.channeling && (il > 0.05 || me.jumping || performance.now() - jumpQueued < 160)) travel.interrupt(); // 移動、跳躍會打斷回城／傳送
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
  collide(me.pos); gear.afterWalk(me.pos);
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
  if (viewMode === 'flat') return;
  if (camera.fov !== targetFov) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
    if (Math.abs(camera.fov - targetFov) < 0.01) camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  if (viewMode === 'best' || viewMode === 'full') {
    let d; const F = focusScreen();
    if (viewMode === 'full') {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      d = Math.max((F.h / 2) / t, (F.w / 2) / (t * camera.aspect)) * 1.0;
    } else d = zoneWall ? Math.min(bestD, 30) : bestD;
    const target = (viewMode === 'full' ? fullPos : bestPos).set(F.x + Math.sin(F.ry) * d, F.y, F.z + Math.cos(F.ry) * d);
    const k = viewMode === 'full' ? 1 : Math.min(1, dt * 6);
    camera.position.lerp(target, k);
    camera.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), F.ry), k); // 正對螢幕，完全水平
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
  if (Math.abs(me.pos.y - me.camY) > 2.5 || gear.flying) me.camY = me.pos.y;
  if (viewMode === 'normal') targetFov = 60 + Math.min(14, Math.max(0, gear.speed - 8) * 0.45); // 高速飛行時視野變寬
  me.camY += (me.pos.y - me.camY) * Math.min(1, dt * (me.jumping ? 9 : 14));
  camTarget.set(me.pos.x, me.camY + eye + (fp ? 0.0 : 0.1), me.pos.z);
  dirV.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  let d = Math.max(cam.dist, 0.001);
  if (!fp) {
    for (const c of world.camBlock) { const t = rayBox(camTarget, dirV, d, c); if (t < d) d = Math.max(0.3, t - 0.25); }
    if (zoneWall) for (let s = 0.5; s < d; s += 0.5) { // 圓弧城牆擋相機
      const x = camTarget.x + dirV.x * s, y = camTarget.y + dirV.y * s, z = camTarget.z + dirV.z * s;
      if ((world.rings || []).some((g) => { const dx = x - g.x, dz = z - g.z; return y < g.h + (me.pos.y > g.h - 1 ? 0 : 2.6) && !(dx > 0 && Math.abs(dz) < g.L) && Math.abs(Math.hypot(dx, dz) - g.R) < 3.2; })) { d = Math.max(0.3, s - 0.35); break; }
    }
  }
  // 裝上立體機動裝置：往上看時相機靠近頭部（不要被地面頂住），才瞄得到高處的牆面
  if (!fp && gear.on && dirV.y < -0.05) d = Math.min(d, Math.max(0.6, (camTarget.y - groundAt(me.pos.x, me.pos.z, me.pos.y) - 0.3) / -dirV.y));
  camera.position.copy(camTarget).addScaledVector(dirV, fp ? 0 : d);
  // 室內天花板與地板限制
  const inHall = camera.position.z < -6.4 && Math.abs(camera.position.x) < 14;
  if (inHall) {
    const maxY = Math.abs(camera.position.x) < 6.4 ? 17 : (me.pos.y > 3 || camera.position.y < 6.5 ? 13.3 : 13.3);
    camera.position.y = Math.min(camera.position.y, maxY);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -13.7, 13.7);
    camera.position.z = Math.max(camera.position.z, -57.6);
  }
  // 觀影館內：相機不穿出牆面與屋頂
  if (inTheater(me.pos.x, me.pos.z)) {
    const T_ = THEATER, I0 = T_.x0 + T_.t + 0.3, I1 = T_.x1 - T_.t - 0.3, Z0 = T_.z0 + T_.t + 0.3, Z1 = T_.z1 - T_.t - 0.3;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, I0, I1); camera.position.z = THREE.MathUtils.clamp(camera.position.z, Z0, Z1);
    const half = (T_.z1 - T_.z0) / 2, rY = T_.ridge - (T_.ridge - T_.eave) * Math.abs(camera.position.z - (T_.z0 + half)) / half;
    camera.position.y = Math.min(camera.position.y, rY - 0.8);
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
  if (zoneWall) {
    // 觀影館內兩台都是全音量；在廣場上隨距離變小
    const tv = inTheater(x, z) ? 100 : Math.max(0, 40 - Math.hypot(x - THEATER.x1, z - 15) * 1.2);
    tScreens.forEach((t, i) => t.setVolume(tvMute[i ? 'b' : 'a'] ? 0 : tv * userVol / 100));
    return;
  }
  let v;
  if (z < -6.3 && Math.abs(x) < 14.5) v = 100 - Math.max(0, (-z - 40)) * 0; // 大廳內
  else if (z < 0) v = 70;
  else v = Math.max(8, 45 - Math.hypot(x, z) * 2.2);
  screen.setVolume(v * userVol / 100);
}

function frame() {
  const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime; const now = performance.now();
  for (const f of world.anim) f(t);
  if (entered) {
    updateMe(dt);
    me.avatar.root.position.set(me.pos.x, me.pos.y + (me.seat ? 0.55 : 0), me.pos.z);
    me.avatar.root.rotation.y = me.ry;
    gear.poseMe();
    me.avatar.update(dt, me.speed, !!me.seat, t, me.jumping || me.airT > 0.2);
    updateCamera(dt);
    updateLabels(dt);
    expireRemotes(now);
    $('#btn-jump').classList.toggle('hidden', !isTouch || !!me.seat);
    travel.update(dt, t);
    netSend(now);
    // 附近椅子提示
    if (!me.seat) {
      nearSeat = findSeat();
      const sb = $('#btn-sit'); sb.classList.toggle('hidden', !nearSeat && !nearTaken);
      const lbl = nearSeat ? '坐下' : '已有人';
      if (lbl !== sitLabel) { sitLabel = lbl; sb.textContent = lbl; sb.disabled = !nearSeat; sb.classList.toggle('taken', !nearSeat); }
    } else $('#btn-sit').classList.remove('hidden');
    saveSnapMaybe(now);
    updateZone();
    if (now - lastVideoTick > 4000) { lastVideoTick = now; for (const x of allScreens) x.tick(); updateVolume(); }
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
    gear.poseRemote(r, dt);
    const moved = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3) / 3.2;
    const ra = r.air ? r.a - 6 : r.sitting ? 0 : r.a;
    r.av.update(dt, r.sitting ? 0 : Math.max(Math.min(ra, 2.2), moved * 0.5), r.sitting, t, r.air);
  }
  if (entered) gear.frame(dt, t, remotes.values());
  if (viewMode === 'flat') tvFrame(); // 平面排版：不畫 3D 場景，只排兩台螢幕
  else { renderer.render(scene, camera); screen.render(camera); }
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
if (restoreSnap) {
  // 重新整理後自動回到殿堂（不經過選角畫面）
  me.color = identity.color === 'blue' ? 'blue' : 'pink';
  me.name = cleanName(identity.name) || defaultName;
  $('#select').classList.add('hidden'); $('#rejoin').classList.remove('hidden');
  connect();
}
setTimeout(() => $('#loading-veil').classList.add('gone'), 100);
// 手機跳躍按鈕
const jumpBtn = $('#btn-jump');
jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); jumpQueued = performance.now(); jumpBtn.classList.add('press'); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jumpBtn.addEventListener(ev, () => jumpBtn.classList.remove('press'));
jumpBtn.addEventListener('contextmenu', (e) => e.preventDefault());
window.__hall = { sim: (n, dt = 1 / 60) => { // 測試用：不畫面、以固定時間步跑 n 幀的移動與裝備
  for (let i = 0; i < n; i++) { updateMe(dt); me.avatar.root.position.set(me.pos.x, me.pos.y + (me.seat ? 0.55 : 0), me.pos.z); me.avatar.root.rotation.y = me.ry; gear.poseMe(); gear.frame(dt, clock.elapsedTime, remotes.values()); }
}, gear, tvSet, get tvL() { return tvL; }, tScreens, get zoneWall() { return zoneWall; }, setMode, seatView, travel, seatOcc, checkVersion, get media() { return mediaState; }, screen, dock, me, cam, camera, scene, world, remotes, toggleSit, collide, groundAt, freeSpot, chat, jump: () => { jumpQueued = performance.now(); }, get ws() { return ws; }, get viewMode() { return viewMode; }, enterFull, exitFull };
