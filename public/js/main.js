import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld, SPAWN, HALL } from './world.js';
import { Avatar } from './avatar.js';
import { BigScreen } from './screen.js';

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
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 1500);
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
  speed: 0, seat: null, id: null,
};
const cam = { yaw: 0, pitch: 0.18, dist: 5.5, targetDist: 5.5, minD: 0, maxD: 14 };
const keys = {};
let joy = { active: false, x: 0, y: 0, id: null };
let entered = false;

// ---------- 碰撞與地面 ----------
const R = 0.32;
function groundAt(x, z, y) {
  let best = -Infinity;
  for (const f of world.floors) {
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const fy = f.y !== undefined ? f.y : f.ya + (f.yb - f.ya) * ((z - f.z0) / (f.z1 - f.z0));
    if (fy <= y + 0.55 && fy > best) best = fy;
  }
  return best === -Infinity ? 0 : best;
}
function collide(p) {
  for (let it = 0; it < 2; it++) for (const c of world.walls) {
    if (p.y + 0.35 >= c.y1 || p.y + 1.5 <= c.y0) continue;
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
addEventListener('keydown', (e) => {
  if (!entered) return;
  keys[e.code] = true;
  if (e.code === 'KeyE') toggleSit();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const pointers = new Map(); let pinchD = 0;
canvas.addEventListener('pointerdown', (e) => {
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
    if (pinchD) cam.targetDist = THREE.MathUtils.clamp(cam.targetDist * (pinchD / d), cam.minD, cam.maxD);
    pinchD = d; return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  const k = isTouch ? 0.006 : 0.0045;
  cam.yaw -= dx * k; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * k, -1.2, 1.35);
});
const endPointer = (e) => {
  if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; $('#joy-knob').style.transform = ''; $('#joy').classList.add('hidden'); }
  pointers.delete(e.pointerId); if (pointers.size < 2) pinchD = 0;
};
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = Math.exp(e.deltaY * 0.0012);
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
  const s = nearSeat || findSeat(); if (!s) return;
  me.seat = s; me.pos.set(s.x, s.y - 0.5, s.z); me.ry = s.ry; me.speed = 0;
  cam.yaw = s.ry + Math.PI; // 看向椅子面對的方向
  $('#btn-sit').textContent = '站起來'; toast('已坐下 · 再按一次 E 或移動就會站起來');
  sendNow();
}
function standUp() {
  const s = me.seat; me.seat = null;
  me.pos.x -= Math.sin(s.ry) * 0.6; me.pos.z -= Math.cos(s.ry) * 0.6;
  $('#btn-sit').textContent = '坐下'; sendNow();
}
$('#btn-sit').addEventListener('click', (e) => { e.stopPropagation(); toggleSit(); });

// ---------- UI ----------
let toastT;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
let soundOn = false;
function setSound(on) { soundOn = on; screen.setSound(on); $('#btn-sound').textContent = on ? '🔊 聲音開啟' : '🔇 開啟聲音'; }
$('#btn-sound').addEventListener('click', () => setSound(!soundOn));
$('#btn-help').addEventListener('click', () => $('#help').classList.remove('hidden'));
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
let chosen = null;
document.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => {
  chosen = b.dataset.color;
  document.querySelectorAll('.choice').forEach(x => x.classList.toggle('on', x === b));
  const btn = $('#btn-enter'); btn.disabled = false; btn.textContent = '走進光之殿堂';
}));
$('#btn-enter').addEventListener('click', () => {
  if (!chosen) return;
  me.color = chosen;
  setSound(true); // 使用者點擊時解除靜音（瀏覽器規定需要互動）
  status('連線中…');
  connect();
});

// ---------- 網路 ----------
let ws, serverOffset = 0, lastSend = 0, lastSent = '';
const remotes = new Map();
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', color: me.color })); ping(); };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case 'welcome': onWelcome(m); break;
      case 'queue': $('#select').classList.add('hidden'); $('#queue').classList.remove('hidden');
        $('#queue-text').textContent = `目前 ${m.online} / ${m.max} 人在線，你排在第 ${m.position} 位。`; break;
      case 's': onSnapshot(m); break;
      case 'join': addRemote(m.id, m.c, m); break;
      case 'leave': { const r = remotes.get(m.id); if (r) { r.av.dispose(); remotes.delete(m.id); } break; }
      case 'video': screen.setState(m.video); break;
      case 'pong': { const rtt = performance.now() - m.c; serverOffset = m.s + rtt / 2 - Date.now(); break; }
    }
  };
  ws.onclose = () => {
    if (!entered) { status('連線中斷，2 秒後重試…'); setTimeout(connect, 2000); return; }
    toast('連線中斷，正在重新連線…', 4000);
    for (const r of remotes.values()) r.av.dispose(); remotes.clear();
    setTimeout(connect, 2000);
  };
}
function ping() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }
setInterval(ping, 20000);

function onWelcome(m) {
  me.id = m.id;
  $('#select').classList.add('hidden'); $('#queue').classList.add('hidden'); $('#hud').classList.remove('hidden');
  for (const p of previews) { p.r.dispose(); }
  previews.length = 0;
  screen.setState(m.video);
  for (const p of m.players) addRemote(p.id, p.c, p);
  if (!entered) {
    entered = true;
    me.avatar = new Avatar(me.color); scene.add(me.avatar.root);
    me.pos.set(SPAWN.x + (Math.random() - 0.5) * 6, 0.15, SPAWN.z + (Math.random() - 0.5) * 1.5);
    me.ry = Math.PI; cam.yaw = 0; cam.pitch = 0.12; cam.dist = cam.targetDist = 6;
    toast('歡迎！往前走進大門，大螢幕就在大廳盡頭', 4500);
    setTimeout(() => $('#hint').classList.add('fade'), 12000);
  }
  updateOnline(m.players.length + 1);
}
function updateOnline(n) { $('#online-n').textContent = n; }
function addRemote(id, color, p) {
  if (id === me.id || remotes.has(id)) return;
  const av = new Avatar(color); scene.add(av.root);
  av.root.position.set(p.x, p.y, p.z);
  remotes.set(id, { av, tx: p.x, ty: p.y, tz: p.z, try: p.ry || 0, ry: p.ry || 0, a: p.a || 0, sitting: false });
}
function onSnapshot(m) {
  updateOnline(m.n);
  for (const [id, x, y, z, ry, a] of m.p) {
    if (id === me.id) continue;
    let r = remotes.get(id);
    if (!r) { addRemote(id, 'pink', { x, y, z, ry }); r = remotes.get(id); }
    r.tx = x; r.ty = y; r.tz = z; r.try = ry; r.a = a; r.sitting = a >= 5;
  }
}
function sendNow() { lastSend = 0; }
function netSend(now) {
  if (!ws || ws.readyState !== 1 || !entered) return;
  if (now - lastSend < 100) return;
  const a = me.seat ? 5 : +me.speed.toFixed(2);
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
  if (me.seat) { if (il > 0.3) standUp(); else { me.speed = 0; return; } }
  const run = keys.ShiftLeft || keys.ShiftRight || (joy.active && il > 0.95);
  let sp = 0;
  if (il > 0.05) {
    ix /= Math.max(1, il); iz /= Math.max(1, il);
    const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
    const wx = ix * cos + iz * sin, wz = -ix * sin + iz * cos;
    const speed = (run ? 6.2 : 3.2) * Math.min(1, il);
    me.pos.x += wx * speed * dt; me.pos.z += wz * speed * dt;
    const want = Math.atan2(wx, wz);
    let d = want - me.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); me.ry += d * Math.min(1, dt * 12);
    sp = speed / 3.2;
  }
  me.speed += (sp - me.speed) * Math.min(1, dt * 10);
  collide(me.pos);
  const g = groundAt(me.pos.x, me.pos.z, me.pos.y);
  if (me.pos.y > g + 0.02) { me.vy -= 22 * dt; me.pos.y = Math.max(g, me.pos.y + me.vy * dt); if (me.pos.y === g) me.vy = 0; }
  else { me.pos.y += (g - me.pos.y) * Math.min(1, dt * 18); me.vy = 0; }
}

function updateCamera(dt) {
  cam.dist += (cam.targetDist - cam.dist) * Math.min(1, dt * 8);
  const fp = cam.dist < 0.35;
  const eye = me.seat ? 1.05 : 1.32;
  camTarget.set(me.pos.x, me.pos.y + eye + (fp ? 0.0 : 0.1), me.pos.z);
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
    me.avatar.update(dt, me.speed, !!me.seat, t);
    updateCamera(dt);
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
    const ty = r.ty + (r.sitting ? 0.55 : 0); p.y += (ty - p.y) * k;
    let d = r.try - r.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); r.ry += d * k; r.av.root.rotation.y = r.ry;
    const moved = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3) / 3.2;
    r.av.update(dt, r.sitting ? 0 : Math.max(Math.min(r.a, 2.2), moved * 0.5), r.sitting, t);
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
window.__hall = { me, cam, camera, scene, world, remotes, toggleSit };
