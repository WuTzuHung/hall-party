// 傳送與回城：左上角半透明小地圖、引導讀條、地面法陣與光柱特效（原創美術；操作手感參考 MOBA 的回城／傳送）
// - 回城（B / 手機「回城」）：原地引導 4 秒，移動、跳躍、坐下都會打斷；完成後回到大門口（家）
// - 傳送（F / 點小地圖上的傳送點 / 數字鍵 1–9）：引導 3 秒，目的地同時亮起信標；完成後冷卻 15 秒
// - 其他玩家看得到：開始／取消／完成都會透過伺服器轉播（t: 'fx'）
import * as THREE from 'three';
import { RINGS, RC, RING_T } from './district.js';
import { LAB_EDGE } from './lab.js';

export const HOME = { key: 'home', name: '大門口', x: 0, y: 0.18, z: 5.0 };
export const POINTS = [
  { key: 'entry', name: '入口平台', x: -3.4, y: 1.2, z: -8.0 },
  { key: 'hall', name: '大廳中央', x: 0, y: 0, z: -25.2 },
  { key: 'front', name: '螢幕前', x: 0, y: 0, z: -45.4 },
  { key: 'west', name: '二樓左側', x: -8.9, y: 7, z: -42.5 },
  { key: 'east', name: '二樓右側', x: 8.9, y: 7, z: -42.5 },
  // 城牆區
  { key: 'gate', name: '第一道城門', x: -77.5, y: 0.17, z: 15, area: 'wall' },
  { key: 'inner', name: '內城廣場', x: -146, y: 0.17, z: 15, area: 'wall' },
  { key: 'theater', name: '觀影館', x: -170.5, y: 0.15, z: 15, area: 'wall' },
  { key: 'tfront', name: '雙螢幕前', x: -191, y: 0.15, z: 15, area: 'wall' },
  { key: 'armory', name: '裝備庫', x: -76.6, y: 0.15, z: 6.1, area: 'wall' },
  // 研究所（街道東段的秋葉原老樓）
  { key: 'labshop', name: '電視店門口', x: 71, y: 0.15, z: 3.2, area: 'lab', ry: Math.PI },
  { key: 'labdoor', name: '研究所玄關', x: 67.9, y: 3.6, z: -7.3, area: 'lab', ry: Math.PI / 2 },
  { key: 'labsofa', name: '沙發前', x: 69.05, y: 3.6, z: -2.55, area: 'lab', ry: Math.atan2(0.55, -1.5) },
];
for (const p of POINTS) p.area ||= 'hall';
export const areaOf = (x) => (x < -69 ? 'wall' : x > LAB_EDGE ? 'lab' : 'hall');
export const RECALL_T = 4.0, TP_T = 3.0, TP_CD = 15, TP_CANCEL_CD = 4;
const destOf = (d) => (d === -1 ? HOME : POINTS[d]);

// 兩種配色：回城＝殿堂的香檳金；傳送＝星門紫與青
const PAL = {
  recall: { a: new THREE.Color(0xffd98a), b: new THREE.Color(0xfff4d6), c: new THREE.Color(0x8fd8ff), css: '#ffd98a' },
  tp: { a: new THREE.Color(0xa77bff), b: new THREE.Color(0x7fe9ff), c: new THREE.Color(0xffc6f2), css: '#b897ff' },
};

// ---------- 程序化貼圖 ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.translate(size / 2, size / 2); draw(g, size / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
let TEX;
function textures() {
  if (TEX) return TEX;
  // 外圈：雙線圓環＋刻度＋菱形與圓點交錯的紋章
  const outer = canvasTex(512, (g, R) => {
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 10;
    const ring = (r, w, a = 1) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
    ring(R * 0.955, 5); ring(R * 0.9, 2, 0.8); ring(R * 0.72, 2.5, 0.9);
    g.globalAlpha = 0.85;
    for (let i = 0; i < 72; i++) { // 刻度
      const a = i / 72 * Math.PI * 2, l = i % 6 === 0 ? 0.06 : 0.03;
      g.lineWidth = i % 6 === 0 ? 3 : 1.6; g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); g.lineTo(Math.cos(a) * R * (0.9 - l), Math.sin(a) * R * (0.9 - l)); g.stroke();
    }
    for (let i = 0; i < 12; i++) { // 環帶中的紋章：菱形、三點交錯
      const a = (i + 0.5) / 12 * Math.PI * 2, r = R * 0.785;
      g.save(); g.rotate(a); g.translate(r, 0);
      g.globalAlpha = 1;
      if (i % 2 === 0) { g.beginPath(); g.moveTo(-R * 0.045, 0); g.lineTo(0, R * 0.022); g.lineTo(R * 0.045, 0); g.lineTo(0, -R * 0.022); g.closePath(); g.fill(); }
      else for (const k of [-1, 0, 1]) { g.beginPath(); g.arc(k * R * 0.03, 0, R * (k ? 0.008 : 0.012), 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    g.globalAlpha = 0.6; g.lineWidth = 1.5; // 環帶中的細弧
    for (let i = 0; i < 12; i++) { const a0 = i / 12 * Math.PI * 2 + 0.06, a1 = a0 + Math.PI * 2 / 12 - 0.5; g.beginPath(); g.arc(0, 0, R * 0.81, a0 + 0.18, a1); g.stroke(); }
  });
  // 內圈：兩個正方形疊成八角星、內圓、中心柔光
  const inner = canvasTex(512, (g, R) => {
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 12;
    const sq = (rot, r) => { g.save(); g.rotate(rot); g.lineWidth = 3; g.strokeRect(-r, -r, r * 2, r * 2); g.restore(); };
    g.globalAlpha = 0.9; sq(0, R * 0.42); sq(Math.PI / 4, R * 0.42);
    g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, R * 0.6, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.7; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R * 0.3, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; g.beginPath(); g.arc(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.018, 0, Math.PI * 2); g.fill(); }
    g.shadowBlur = 0; g.globalAlpha = 1;
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.62);
    rg.addColorStop(0, 'rgba(255,255,255,0.55)'); rg.addColorStop(0.4, 'rgba(255,255,255,0.16)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, R * 0.62, 0, Math.PI * 2); g.fill();
  });
  // 擴散波紋（完成時的衝擊環）
  const shock = canvasTex(256, (g, R) => {
    const rg = g.createRadialGradient(0, 0, R * 0.62, 0, 0, R);
    rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.7, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.8, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  });
  // 柔光點（粒子、閃光）
  const dot = canvasTex(64, (g, R) => {
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.65)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(-R, -R, R * 2, R * 2);
  });
  // 四芒星閃光
  const flare = canvasTex(256, (g, R) => {
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.5);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(-R, -R, R * 2, R * 2);
    for (const rot of [0, Math.PI / 2]) {
      g.save(); g.rotate(rot);
      const lg = g.createLinearGradient(-R, 0, R, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(-R, 0); g.quadraticCurveTo(0, -R * 0.035, R, 0); g.quadraticCurveTo(0, R * 0.035, -R, 0); g.fill();
      g.restore();
    }
  });
  return (TEX = { outer, inner, shock, dot, flare });
}

const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
function flatMat(map, color) { return new THREE.MeshBasicMaterial({ map, color, ...add, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }); }
const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
function pillarMat(pal) {
  return new THREE.ShaderMaterial({
    ...add, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uA: { value: 0 }, uC1: { value: pal.a.clone() }, uC2: { value: pal.b.clone() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime, uA; uniform vec3 uC1, uC2;
      void main(){
        float h = vUv.y;
        float fade = pow(1.0 - h, 1.7) * smoothstep(0.0, 0.06, h);
        float x = vUv.x * 6.2831853;
        float streak = 0.45 + 0.55 * (0.5 + 0.5 * sin(x * 7.0 + uTime * 1.6 + h * 4.0)) * (0.5 + 0.5 * sin(x * 3.0 - uTime * 0.9));
        float rise = 0.7 + 0.3 * sin(h * 22.0 - uTime * 7.0);
        vec3 c = mix(uC1, uC2, h * 0.8);
        gl_FragColor = vec4(c, fade * streak * rise * uA);
      }`,
  });
}

// 旋轉上升的光點（CPU 更新位置；加法混合，以頂點色做淡入淡出）
class Motes {
  constructor(n, color, size) {
    this.n = n; this.p = []; this.color = color;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ map: textures().dot, size, vertexColors: true, ...add, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) this.p.push(this.spawn({}, true));
  }
  spawn(o, init) {
    o.a = Math.random() * Math.PI * 2; o.r = 0.25 + Math.random() * 0.75; o.h = init ? Math.random() * 2.6 : 0;
    o.v = 0.6 + Math.random() * 1.2; o.w = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.4); o.H = 1.6 + Math.random() * 1.6;
    o.tint = Math.random(); return o;
  }
  // mode 0：盤旋上升；mode 1：往外爆開（完成時）
  update(dt, k, mode = 0) {
    const { pos, col, color } = this;
    for (let i = 0; i < this.n; i++) {
      const o = this.p[i];
      if (mode === 0) {
        o.h += o.v * dt * (0.6 + k); o.a += o.w * dt; o.r = Math.max(0.12, o.r - dt * 0.08);
        if (o.h > o.H) this.spawn(o);
      } else { o.r += dt * (2.4 + o.v); o.h += dt * (o.v * 1.6); }
      pos[i * 3] = Math.cos(o.a) * o.r; pos[i * 3 + 1] = o.h; pos[i * 3 + 2] = Math.sin(o.a) * o.r;
      const f = mode === 0 ? Math.sin(Math.PI * Math.min(1, o.h / o.H)) * k : k;
      const c = o.tint < 0.7 ? color[0] : color[1];
      col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
  dispose() { this.points.geometry.dispose(); this.points.material.dispose(); }
}

// 引導中的法陣：地面雙層紋章、光柱、上升光點、腳下光暈
class ChannelFX {
  constructor(scene, kind, beacon = false) {
    const T = textures(), pal = PAL[kind];
    this.scene = scene; this.kind = kind; this.beacon = beacon; this.k = 0; this.t = 0; this.p = 0;
    this.g = new THREE.Group(); scene.add(this.g);
    this.ringA = new THREE.Mesh(planeGeo, flatMat(T.outer, pal.a)); this.ringA.position.y = 0.035;
    this.ringB = new THREE.Mesh(planeGeo, flatMat(T.inner, pal.b)); this.ringB.position.y = 0.04;
    this.pool = new THREE.Mesh(planeGeo, flatMat(T.dot, pal.a)); this.pool.position.y = 0.03;
    this.pillar = new THREE.Mesh(pillarGeo, pillarMat(pal));
    this.motes = new Motes(beacon ? 22 : 46, [pal.b, pal.c], beacon ? 0.1 : 0.12);
    this.g.add(this.pool, this.ringA, this.ringB, this.pillar, this.motes.points);
    this.size = beacon ? 1.9 : 2.5;
    for (const m of [this.ringA, this.ringB, this.pool, this.pillar]) m.renderOrder = 5;
  }
  // p：引導進度 0..1；k：整體強度（淡入淡出）
  update(dt, p, k) {
    this.t += dt; this.k = k; this.p = p;
    const s = this.size * (0.72 + 0.28 * Math.min(1, p * 3)) * (0.9 + 0.1 * k);
    this.ringA.scale.setScalar(s); this.ringB.scale.setScalar(s * (0.82 - 0.12 * p));
    this.ringA.rotation.y = this.t * 0.35; this.ringB.rotation.y = -this.t * (0.7 + p * 1.6);
    this.pool.scale.setScalar(s * 1.5);
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 6);
    this.ringA.material.opacity = k * (0.55 + 0.45 * p) * pulse;
    this.ringB.material.opacity = k * (0.45 + 0.55 * p);
    this.pool.material.opacity = k * (0.18 + 0.3 * p);
    const pr = this.beacon ? 0.55 : 0.62 - 0.22 * p;
    this.pillar.scale.set(pr, (this.beacon ? 3.2 : 2.4) + p * 2.2, pr);
    this.pillar.material.uniforms.uTime.value = this.t;
    this.pillar.material.uniforms.uA.value = k * (this.beacon ? 0.25 + 0.4 * p : 0.2 + 0.75 * p * p);
    this.motes.update(dt, k * (0.4 + 0.6 * p));
  }
  dispose() {
    this.scene.remove(this.g); this.motes.dispose();
    for (const m of [this.ringA, this.ringB, this.pool, this.pillar]) m.material.dispose();
  }
}

// 完成時的爆發：四芒星閃光、地面衝擊環、光柱一閃、光點四散
class BurstFX {
  constructor(scene, kind, x, y, z, big = 1) {
    const T = textures(), pal = PAL[kind];
    this.scene = scene; this.t = 0; this.life = 1.1; this.big = big;
    this.g = new THREE.Group(); this.g.position.set(x, y, z); scene.add(this.g);
    this.shock = new THREE.Mesh(planeGeo, flatMat(T.shock, pal.b)); this.shock.position.y = 0.05;
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flare, color: pal.b, ...add })); this.flare.position.y = 1.0;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.dot, color: pal.a, ...add })); this.glow.position.y = 0.9;
    this.pillar = new THREE.Mesh(pillarGeo, pillarMat(pal));
    this.motes = new Motes(40, [pal.b, pal.c], 0.13);
    for (const o of this.motes.p) { o.h = 0.2 + Math.random() * 1.4; o.r = 0.1 + Math.random() * 0.2; }
    this.g.add(this.shock, this.pillar, this.glow, this.flare, this.motes.points);
    for (const m of [this.shock, this.flare, this.glow, this.pillar]) m.renderOrder = 6;
  }
  update(dt) {
    this.t += dt; const u = Math.min(1, this.t / this.life), e = 1 - Math.pow(1 - u, 3), f = 1 - u;
    this.shock.scale.setScalar((0.6 + e * 4.2) * this.big); this.shock.material.opacity = f * f;
    const fl = u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 2);
    this.flare.scale.setScalar(3.6 * this.big * (0.6 + fl * 0.6)); this.flare.material.opacity = fl; this.flare.material.rotation = u * 0.6;
    this.glow.scale.setScalar(2.6 * this.big); this.glow.material.opacity = fl * 0.8;
    this.pillar.scale.set(0.5 * (1 - e * 0.6), 7 * (0.4 + e * 0.6), 0.5 * (1 - e * 0.6));
    this.pillar.material.uniforms.uTime.value = this.t * 3; this.pillar.material.uniforms.uA.value = 1.4 * f * f;
    this.motes.update(dt, f, 1);
    return u < 1;
  }
  dispose() {
    this.scene.remove(this.g); this.motes.dispose();
    for (const m of [this.shock, this.flare, this.glow, this.pillar]) m.material.dispose();
  }
}

// ---------- 小地圖 ----------
// 兩張平面圖共用同樣比例的畫布（31.2 : 67.8）：殿堂（螢幕在上）、城牆區（轉 90°，雙螢幕在上、城門在下）
const MAP = { x0: -15.6, x1: 15.6, z0: -59.4, z1: 8.4 };
const WMAP = { z0: -103, z1: 133, x0: -300 }; // 城牆區總覽：寬 236m（z），上方是西（最內圈的觀影館），下方是街道與殿堂
const LMAP = { x0: 61.5, x1: 80, z0: -12 }; // 研究所附近：大樓、樓梯、門口那段街
const PROJ = {
  hall: { span: MAP.x1 - MAP.x0, f: (x, z, s) => [(x - MAP.x0) * s, (z - MAP.z0) * s] },
  lab: { span: LMAP.x1 - LMAP.x0, f: (x, z, s) => [(x - LMAP.x0) * s, (z - LMAP.z0) * s] },
  wall: { span: WMAP.z1 - WMAP.z0, f: (x, z, s) => [(WMAP.z1 - z) * s, (x - WMAP.x0) * s] },
};
function drawWall(g, s) {
  const P = (x, z) => PROJ.wall.f(x, z, s);
  const rect = (x0, z0, x1, z1) => { const [a, b] = P(x0, z1), [c, d] = P(x1, z0); g.rect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); };
  const fillR = (x0, z0, x1, z1, c) => { g.fillStyle = c; g.beginPath(); rect(x0, z0, x1, z1); g.fill(); };
  const gold = 'rgba(224,189,106,', ink = 'rgba(245,238,221,', stone = 'rgba(170,176,168,';
  const DX = -60; // 觀影館的建模座標 → 世界座標
  // 街道與殿堂
  fillR(-66, 0, 60, 30, ink + '0.05)'); fillR(-66, 8, 60, 22, 'rgba(20,20,26,0.35)');
  fillR(-14.6, -58.6, 14.6, 0.35, 'rgba(120,90,190,0.30)');
  // 三圈內的地面（越內圈越亮）
  const [cx, cy] = P(RC.x, RC.z);
  RINGS.forEach((R, i) => { g.fillStyle = `rgba(120,128,110,${0.05 + i * 0.035})`; g.beginPath(); g.arc(cx, cy, (R.R - RING_T / 2) * s, 0, Math.PI * 2); g.fill(); });
  // 石板主路（從街道一路到觀影館）
  fillR(-160, 13.2, -66, 16.8, stone + '0.22)');
  // 民居
  for (const [x0, x1, z0, z1] of [[-100, -76, -13, -4], [-100, -76, 34, 43], [-128.5, -114, -13, -4], [-128.5, -114, 34, 43]]) fillR(x0, z0, x1, z1, 'rgba(10,8,14,0.6)');
  // 城牆：圓弧＋城門直牆＋門樓
  for (const R of RINGS) {
    const th0 = Math.atan2(R.L, Math.sqrt(R.R * R.R - R.L * R.L));
    g.strokeStyle = stone + '0.62)'; g.lineWidth = Math.max(1.6, RING_T * s); g.beginPath();
    g.arc(cx, cy, R.R * s, th0 + Math.PI / 2, 2 * Math.PI - th0 + Math.PI / 2); g.stroke();
    fillR(R.x0, 15 - R.L, R.x1, 10.5, stone + '0.62)'); fillR(R.x0, 19.5, R.x1, 15 + R.L, stone + '0.62)');
    fillR(R.x1, 5, R.x1 + 4, 10.5, stone + '0.55)'); fillR(R.x1, 19.5, R.x1 + 4, 25, stone + '0.55)');
  }
  // 觀影館
  fillR(-136 + DX, 2, -100 + DX, 28, 'rgba(10,6,16,0.75)');
  g.fillStyle = 'rgba(120,150,110,0.3)'; g.beginPath(); rect(-134.8 + DX, 3.2, -101.2 + DX, 26.8); g.fill();
  for (const x of [-129.2, -126.0, -122.8, -119.6]) for (const [z0, z1] of [[4.2, 13.8], [16.2, 25.8]]) fillR(x + DX - 0.4, z0, x + DX + 0.4, z1, gold + '0.4)');
  g.save(); g.shadowColor = 'rgba(160,190,255,0.9)'; g.shadowBlur = 4; g.fillStyle = 'rgba(210,225,255,0.95)';
  for (const z of [9.6, 20.4]) { g.beginPath(); rect(-135.4 + DX, z - 4.8, -133.8 + DX, z + 4.8); g.fill(); }
  g.restore();
  g.strokeStyle = gold + '0.6)'; g.lineWidth = 1; g.beginPath(); rect(-136 + DX, 2, -100 + DX, 28); g.stroke();
}
// 研究所平面：二樓的家具配置＋一樓店面、樓梯、門口的街
function drawLab(g, s) {
  const P = (x, z) => PROJ.lab.f(x, z, s);
  const rect = (x0, z0, x1, z1) => { const [a, b] = P(x0, z0), [c, d] = P(x1, z1); g.rect(a, b, c - a, d - b); };
  const fillR = (x0, z0, x1, z1, c) => { g.fillStyle = c; g.beginPath(); rect(x0, z0, x1, z1); g.fill(); };
  const strokeR = (x0, z0, x1, z1, c, w = 1) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); rect(x0, z0, x1, z1); g.stroke(); };
  const amber = 'rgba(255,179,71,', ink = 'rgba(245,238,221,';
  // 街道、人行道
  fillR(LMAP.x0, 0, LMAP.x1, 8, ink + '0.06)'); fillR(LMAP.x0, 8, LMAP.x1, 22, 'rgba(20,20,26,0.4)'); fillR(LMAP.x0, 22, LMAP.x1, 30, ink + '0.06)');
  g.strokeStyle = ink + '0.25)'; g.setLineDash([4, 5]); g.beginPath(); g.moveTo(...P(LMAP.x0, 15)); g.lineTo(...P(LMAP.x1, 15)); g.stroke(); g.setLineDash([]);
  // 鄰棟
  for (const [x0, z0, x1, z1] of [[60.2, -11, 64, 0], [76.05, -14, 86, 0], [60, 30, 86, 40]]) fillR(x0, z0, x1, z1, 'rgba(10,8,14,0.62)');
  // 大樓外框與研究所地板
  fillR(66, -11, 76, 0, 'rgba(12,9,6,0.75)');
  fillR(66.3, -10.7, 75.7, -0.3, 'rgba(160,112,66,0.30)');
  // 玄關、廚房、冰箱、淋浴、開發室
  fillR(66.3, -8.4, 67.35, -6.6, ink + '0.12)');
  fillR(66.4, -10.7, 68.8, -10.1, ink + '0.22)'); fillR(68.9, -10.7, 69.55, -10.05, ink + '0.4)');
  fillR(71.0, -10.7, 75.7, -7.45, 'rgba(120,140,110,0.16)');
  g.strokeStyle = 'rgba(185,196,174,0.7)'; g.lineWidth = 1.2; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(...P(71, -7.45)); g.lineTo(...P(75.7, -7.45)); g.stroke(); g.setLineDash([]);
  fillR(71.3, -10.7, 75.7, -9.95, ink + '0.2)');
  // 沙發、矮桌、電視、鐵架、白板、電腦桌、微波爐架、書架
  fillR(66.42, -5.45, 67.32, -2.75, 'rgba(160,130,92,0.75)');
  fillR(67.72, -4.75, 68.58, -3.45, 'rgba(200,160,110,0.55)');
  fillR(70.42, -5.35, 70.84, -2.85, ink + '0.28)');
  fillR(66.32, -2.55, 66.72, -0.45, 'rgba(110,80,50,0.7)');
  g.strokeStyle = ink + '0.85)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(...P(67.4, -6.55)); g.lineTo(...P(69.3, -6.55)); g.stroke();
  fillR(74.85, -4.7, 75.7, -1.0, 'rgba(200,160,110,0.45)');
  fillR(75.12, -6.4, 75.7, -5.1, ink + '0.3)');
  g.save(); g.shadowColor = 'rgba(150,200,255,0.9)'; g.shadowBlur = 6; fillR(75.35, -3.95, 75.48, -1.75, 'rgba(170,210,255,0.9)'); g.restore();
  g.save(); g.shadowColor = 'rgba(160,220,255,0.95)'; g.shadowBlur = 8; fillR(69.58, -4.42, 69.72, -3.78, 'rgba(210,235,255,0.95)'); g.restore();
  fillR(69.72, -4.5, 70.3, -3.7, 'rgba(40,40,44,0.85)');
  // 牆、門
  strokeR(66, -11, 76, 0, amber + '0.75)', 1.4);
  g.strokeStyle = 'rgba(12,9,6,1)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(...P(66, -7.95)); g.lineTo(...P(66, -7.0)); g.stroke();
  // 樓梯與平台
  fillR(64.15, -8.8, 65.9, 0, ink + '0.06)');
  g.strokeStyle = ink + '0.28)'; g.lineWidth = 0.7;
  for (let i = 0; i <= 20; i++) { const z = -0.7 - i * 0.27; g.beginPath(); g.moveTo(...P(64.15, z)); g.lineTo(...P(65.9, z)); g.stroke(); }
  fillR(64.15, -8.8, 65.9, -6.1, ink + '0.12)');
  g.strokeStyle = ink + '0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(...P(65.0, -0.9)); g.lineTo(...P(65.0, -5.6)); g.stroke();
  g.beginPath(); const [ax, ay] = P(65.0, -5.9); g.moveTo(ax, ay); g.lineTo(ax - 3, ay + 5); g.lineTo(ax + 3, ay + 5); g.closePath(); g.fillStyle = ink + '0.6)'; g.fill();
  // 一樓店門口（電視堆）、自動販賣機、電線桿
  fillR(66.5, -0.2, 75.5, 0, amber + '0.5)');
  fillR(61.0, 0.05, 63.03, 0.8, 'rgba(200,230,255,0.6)');
  for (const [x, z] of [[63.2, 7.55], [72, 22.45]]) { g.fillStyle = ink + '0.5)'; g.beginPath(); g.arc(...P(x, z), Math.max(1.5, s * 0.2), 0, Math.PI * 2); g.fill(); }
  // 文字標示
  g.font = `600 ${Math.max(9, s * 0.62)}px "Noto Sans TC",sans-serif`; g.textAlign = 'center'; g.fillStyle = amber + '0.85)';
  g.fillText('研究所 2F', ...P(71, -6.0)); g.fillStyle = ink + '0.5)'; g.fillText('街道', ...P(71, 12.2));
}
const PIER_Z = [-11, -18, -25, -32, -39, -46, -53];
function drawStatic(g, s) {
  const X = (x) => (x - MAP.x0) * s, Z = (z) => (z - MAP.z0) * s;
  const rect = (x0, z0, x1, z1) => g.rect(X(x0), Z(z0), (x1 - x0) * s, (z1 - z0) * s);
  const fillR = (x0, z0, x1, z1, c) => { g.fillStyle = c; g.beginPath(); rect(x0, z0, x1, z1); g.fill(); };
  const strokeR = (x0, z0, x1, z1, c, w = 1) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); rect(x0, z0, x1, z1); g.stroke(); };
  const gold = 'rgba(224,189,106,', ink = 'rgba(245,238,221,';
  // 人行道
  fillR(MAP.x0, 0.35, MAP.x1, MAP.z1, ink + '0.05)');
  g.strokeStyle = ink + '0.12)'; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(MAP.x0), Z(8)); g.lineTo(X(MAP.x1), Z(8)); g.stroke(); g.setLineDash([]);
  fillR(-1.4, 1.9, 1.4, 6.6, 'rgba(150,110,210,0.35)'); // 紫色地毯
  for (const sx of [-1.75, 1.75]) for (let z = 2.4; z <= 6.4; z += 2) { g.fillStyle = gold + '0.6)'; g.beginPath(); g.arc(X(sx), Z(z), Math.max(1, s * 0.12), 0, Math.PI * 2); g.fill(); }
  // 建築量體（外牆、立面）
  fillR(-14.6, -58.6, 14.6, -6, 'rgba(10,6,22,0.55)');
  fillR(-14.6, -6.5, 14.6, 0.35, 'rgba(10,6,22,0.55)');
  // 大廳地板
  const fl = g.createLinearGradient(0, Z(-58), 0, Z(-6));
  fl.addColorStop(0, 'rgba(120,90,190,0.30)'); fl.addColorStop(1, 'rgba(90,70,140,0.18)');
  g.fillStyle = fl; g.beginPath(); rect(-14, -58, 14, -6); g.fill();
  // 中央長毯
  fillR(-2.6, -43.5, 2.6, -27.5, 'rgba(170,120,230,0.20)');
  // 門廳、門口台階
  fillR(-2.5, -6.2, 2.5, -1.5, 'rgba(120,90,190,0.26)'); fillR(-1.5, -1.6, 1.5, 0.35, 'rgba(120,90,190,0.26)');
  fillR(-2.7, 0, 2.7, 1.9, ink + '0.1)');
  // 二樓迴廊（斜線）
  for (const sg of [-1, 1]) {
    const xa = sg > 0 ? 7.2 : -14, xb = sg > 0 ? 14 : -7.2;
    fillR(xa, -58, xb, -25, gold + '0.10)');
    g.save(); g.beginPath(); rect(xa, -58, xb, -25); g.clip();
    g.strokeStyle = gold + '0.16)'; g.lineWidth = 1;
    for (let k = -80; k < 80; k += 1.4) { g.beginPath(); g.moveTo(X(xa), Z(-58 + k)); g.lineTo(X(xb), Z(-58 + k + (xb - xa) * sg)); g.stroke(); }
    g.restore();
    strokeR(xa, -58, xb, -25, gold + '0.32)');
    const t1 = sg > 0 ? [9.6, 14] : [-14, -9.6];
    strokeR(t1[0], -53.7, t1[1], -26.2, gold + '0.22)', 0.8); // 觀賽席兩階
    // 樓梯
    const sx0 = sg > 0 ? 9 : -14, sx1 = sg > 0 ? 14 : -9;
    fillR(sx0, -25, sx1, -13, ink + '0.06)');
    g.strokeStyle = ink + '0.2)'; g.lineWidth = 0.7;
    for (let z = -13; z >= -25; z -= 0.9) { g.beginPath(); g.moveTo(X(sx0), Z(z)); g.lineTo(X(sx1), Z(z)); g.stroke(); }
  }
  // 入口平台與大階梯
  fillR(-7, -10, 7, -6, ink + '0.08)'); strokeR(-7, -10, 7, -6, ink + '0.18)', 0.8);
  g.strokeStyle = ink + '0.2)'; g.lineWidth = 0.7;
  for (let i = 0; i <= 8; i++) { const z = -10 - i * 0.375; g.beginPath(); g.moveTo(X(-4), Z(z)); g.lineTo(X(4), Z(z)); g.stroke(); }
  // 長桌與觀賽席
  for (const sg of [-1, 1]) {
    fillR(sg * 4.6 - 0.55, -44, sg * 4.6 + 0.55, -27, 'rgba(245,238,221,0.28)');
    const xa = sg > 0 ? 0.6 : -5.7, xb = sg > 0 ? 5.7 : -0.6;
    for (let r = 0; r < 4; r++) fillR(xa, -47.6 - r * 1.4, xb, -47.2 - r * 1.4, gold + '0.32)');
  }
  // 中央花台
  g.fillStyle = gold + '0.35)'; g.beginPath(); g.arc(X(0), Z(-21.5), 1.25 * s, 0, Math.PI * 2); g.fill();
  // 方柱
  g.fillStyle = ink + '0.42)';
  for (const z of PIER_Z) for (const sg of [-1, 1]) { g.beginPath(); rect(sg * 7.5 - 0.7, z - 0.7, sg * 7.5 + 0.7, z + 0.7); g.fill(); }
  // 獎盃
  g.fillStyle = gold + '0.85)'; g.beginPath(); g.arc(X(0), Z(-8.2), Math.max(1.2, s * 0.5), 0, Math.PI * 2); g.fill();
  // 舞台與大螢幕
  fillR(-7.5, -58, 7.5, -55.5, 'rgba(40,24,70,0.5)');
  g.save(); g.shadowColor = 'rgba(160,190,255,0.9)'; g.shadowBlur = 6 * (s / 4);
  g.fillStyle = 'rgba(210,225,255,0.95)'; g.beginPath(); rect(-7, -58.1, 7, -57.4); g.fill(); g.restore();
  // 外牆輪廓（金線）
  g.strokeStyle = gold + '0.55)'; g.lineWidth = 1.2;
  g.beginPath(); rect(-14, -58, 14, -6); g.stroke();
  g.beginPath(); g.moveTo(X(-14.6), Z(0.35)); g.lineTo(X(-1.5), Z(0.35)); g.moveTo(X(1.5), Z(0.35)); g.lineTo(X(14.6), Z(0.35)); g.stroke();
}

// 傳送點圖示（原創：圓中菱形）；家：拱門
function drawWaypoint(g, x, y, r, hot, cd, t) {
  g.save(); g.translate(x, y);
  const pulse = hot ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
  if (hot) { g.fillStyle = `rgba(167,123,255,${0.18 + pulse * 0.2})`; g.beginPath(); g.arc(0, 0, r * (1.7 + pulse * 0.25), 0, Math.PI * 2); g.fill(); }
  g.fillStyle = cd ? 'rgba(60,50,80,0.85)' : 'rgba(40,22,80,0.9)'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(1, r * 0.18); g.strokeStyle = cd ? 'rgba(200,190,220,0.55)' : '#c7a8ff'; g.stroke();
  g.fillStyle = cd ? 'rgba(200,190,220,0.6)' : '#8ff0ff';
  g.beginPath(); g.moveTo(0, -r * 0.55); g.lineTo(r * 0.4, 0); g.lineTo(0, r * 0.55); g.lineTo(-r * 0.4, 0); g.closePath(); g.fill();
  g.restore();
}
function drawHome(g, x, y, r) {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(60,40,10,0.9)'; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(1, r * 0.18); g.strokeStyle = '#f2cf7a'; g.stroke();
  g.fillStyle = '#ffe7a8'; const w = r * 0.5, h = r * 0.55;
  g.beginPath(); g.moveTo(-w, h); g.lineTo(-w, -h * 0.1); g.arc(0, -h * 0.1, w, Math.PI, 0); g.lineTo(w, h); g.lineTo(w * 0.45, h); g.lineTo(w * 0.45, 0); g.arc(0, 0, w * 0.45, 0, Math.PI, true); g.lineTo(-w * 0.45, h); g.closePath(); g.fill();
  g.restore();
}

const ICON_RECALL = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 27V14.5a9 9 0 0 1 18 0V27h-5.2V16.2a3.8 3.8 0 0 0-7.6 0V27z" fill="currentColor" opacity=".95"/><path d="M16 2.8l1.1 2.6 2.6 1.1-2.6 1.1L16 10.2l-1.1-2.6-2.6-1.1 2.6-1.1z" fill="currentColor"/><path d="M4 29h24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></svg>';
const ICON_TP = '<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="24.5" rx="11" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".75"/><ellipse cx="16" cy="24.5" rx="6" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".6"/><path d="M16 4l4.2 9.5L16 23l-4.2-9.5z" fill="currentColor"/><path d="M16 4v19" stroke="#1b1030" stroke-width=".9" opacity=".55"/></svg>';

export function initTravel({ scene, hud, isTouch, toast, send, me, getAvatar, place, beforeChannel, onPickOpen }) {
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  // ----- DOM -----
  const mm = el('div', 'hidden'); mm.id = 'minimap';
  const cv = el('canvas'); cv.setAttribute('aria-label', '小地圖：點傳送點即可傳送');
  const head = el('div', 'mm-head', '<span class="mm-t">MAP</span><span class="mm-sub">殿堂平面</span>');
  const pickHint = el('div', 'mm-pick', `選擇傳送地點<small>${isTouch ? '點空白處取消' : '點傳送點或按 1–9 · Esc 取消'}</small>`);
  mm.append(head, cv, pickHint);
  const legend = el('div', 'mm-names'); mm.append(legend);
  const btns = el('div', 'hidden'); btns.id = 'travel-btns';
  const mkBtn = (id, icon, key, label) => {
    const b = el('button', 'tv-btn', `<span class="tv-ico">${icon}</span><span class="tv-cd"></span><span class="tv-n"></span>${isTouch ? '' : `<b class="tv-key">${key}</b>`}<span class="tv-lbl">${label}</span>`);
    b.id = id; b.type = 'button'; return b;
  };
  const bRecall = mkBtn('btn-recall', ICON_RECALL, 'B', '回城'), bTp = mkBtn('btn-tp', ICON_TP, 'F', '傳送');
  btns.append(bRecall, bTp);
  const bar = el('div', 'hidden', '<div class="ch-top"><span class="ch-name"></span><span class="ch-t"></span></div><div class="ch-bar"><i></i><b></b></div><div class="ch-sub"></div>');
  bar.id = 'channel';
  const col = el('div'); col.id = 'travel-col'; col.append(mm, btns);
  hud.append(col, bar);
  const barFill = bar.querySelector('.ch-bar i'), barGlint = bar.querySelector('.ch-bar b');

  // ----- 狀態 -----
  let ch = null;            // 自己的引導：{ kind, d, t, dur, fx, beacon }
  let cdUntil = 0;          // 傳送冷卻結束時間（performance.now）
  let picking = false;
  const remote = new Map(); // id -> { ch: { kind, d, t, fx, beacon }, pop }
  const bursts = [];
  let selfPop = null;       // 到達時的縮放彈出動畫
  const now = () => performance.now();

  function emit(kind, s, d) { send({ t: 'fx', k: kind, s, d }); }

  function startChannel(kind, d) {
    if (ch) cancel(true);
    beforeChannel(); // 坐著就先站起來
    const fx = new ChannelFX(scene, kind);
    const dest = destOf(d);
    const beacon = kind === 'tp' ? new ChannelFX(scene, 'tp', true) : null;
    if (beacon) beacon.g.position.set(dest.x, dest.y, dest.z);
    ch = { kind, d, t: 0, t0: now(), dur: kind === 'recall' ? RECALL_T : TP_T, fx, beacon, fade: 0 };
    bar.classList.remove('hidden', 'done', 'fail'); bar.classList.toggle('tp', kind === 'tp');
    bar.querySelector('.ch-name').textContent = kind === 'recall' ? '回城' : '傳送';
    bar.querySelector('.ch-sub').textContent = kind === 'recall' ? `回到${HOME.name}` : `前往 ${dest.name}`;
    emit(kind, 'start', d);
    setPick(false);
  }
  function recall() {
    if (ch && ch.kind === 'recall') return;
    startChannel('recall', -1);
  }
  function teleport(i) {
    if (!POINTS[i]) return;
    const left = (cdUntil - now()) / 1000;
    if (left > 0) { toast(`傳送冷卻中 · ${Math.ceil(left)} 秒`, 1600); setPick(false); return; }
    const dest = POINTS[i];
    if (Math.hypot(me.pos.x - dest.x, me.pos.z - dest.z) < 2.5 && Math.abs(me.pos.y - dest.y) < 2) { toast(`你已經在${dest.name}了`, 1600); setPick(false); return; }
    startChannel('tp', i);
  }
  // quiet：被新的引導取代時不顯示「已中斷」
  function cancel(quiet) {
    if (!ch) return;
    emit(ch.kind, 'cancel', ch.d);
    if (ch.kind === 'tp') cdUntil = Math.max(cdUntil, now() + TP_CANCEL_CD * 1000);
    retire(ch); ch = null;
    if (!quiet) { bar.classList.add('fail'); bar.querySelector('.ch-sub').textContent = '已中斷'; setTimeout(() => { if (!ch) bar.classList.add('hidden'); }, 700); }
    else bar.classList.add('hidden');
  }
  // 讓特效淡出後再移除
  const fading = [];
  function retire(c) { if (c.fx) fading.push({ fx: c.fx, k: c.fx.k }); if (c.beacon) fading.push({ fx: c.beacon, k: c.beacon.k }); }
  function finish() {
    const c = ch; ch = null;
    const from = { x: me.pos.x, y: me.pos.y, z: me.pos.z };
    const dest = destOf(c.d);
    bursts.push(new BurstFX(scene, c.kind, from.x, from.y, from.z));
    c.fx.dispose(); if (c.beacon) c.beacon.dispose();
    const at = place(dest);
    bursts.push(new BurstFX(scene, c.kind, at.x, at.y, at.z, 0.85));
    selfPop = { t: 0 };
    emit(c.kind, 'done', c.d);
    if (c.kind === 'tp') cdUntil = now() + TP_CD * 1000;
    bar.classList.add('done'); bar.querySelector('.ch-sub').textContent = c.kind === 'recall' ? `已回到${HOME.name}` : `抵達 ${dest.name}`;
    setTimeout(() => { if (!ch) bar.classList.add('hidden'); }, 900);
  }
  function interrupt() { if (ch && ch.t > 0.08) cancel(false); }

  // ----- 遠端玩家 -----
  function onRemote(m) {
    const kind = m.k === 'tp' ? 'tp' : 'recall';
    const d = Number.isInteger(m.d) ? m.d : -1;
    let r = remote.get(m.id); if (!r) { r = {}; remote.set(m.id, r); }
    const av = getAvatar(m.id);
    if (m.s === 'start') {
      if (r.ch) retire(r.ch);
      const fx = new ChannelFX(scene, kind);
      const dest = destOf(d); let beacon = null;
      if (kind === 'tp' && dest) { beacon = new ChannelFX(scene, 'tp', true); beacon.g.position.set(dest.x, dest.y, dest.z); }
      r.ch = { kind, d, t: 0, t0: now(), dur: kind === 'recall' ? RECALL_T : TP_T, fx, beacon };
    } else if (m.s === 'cancel') {
      if (r.ch) { retire(r.ch); r.ch = null; }
    } else if (m.s === 'done') {
      if (r.ch) { r.ch.fx.dispose(); if (r.ch.beacon) r.ch.beacon.dispose(); r.ch = null; }
      if (av) { const p = av.root.position; bursts.push(new BurstFX(scene, kind, p.x, p.y, p.z)); }
      const dest = destOf(d);
      if (dest) { bursts.push(new BurstFX(scene, kind, dest.x, dest.y, dest.z, 0.85)); r.pop = { t: -1, x: dest.x, z: dest.z, wait: 0 }; }
    }
  }
  function forget(id) {
    const r = remote.get(id); if (!r) return;
    if (r.ch) { r.ch.fx.dispose(); if (r.ch.beacon) r.ch.beacon.dispose(); }
    remote.delete(id);
  }

  // ----- 傳送點選擇 -----
  function setPick(on) {
    if (on && !entered()) return;
    picking = on; mm.classList.toggle('picking', on); document.body.classList.toggle('tp-picking', on);
    if (on) { onPickOpen(); if ((cdUntil - now()) > 0) toast(`傳送冷卻中 · ${Math.ceil((cdUntil - now()) / 1000)} 秒`, 1600); }
    layoutNames();
  }
  const entered = () => !mm.classList.contains('hidden');
  function togglePick() { setPick(!picking); }

  // ----- 小地圖繪製 -----
  let W = 0, H = 0, S = 1, dpr = 1, bg = null, lastDraw = 0;
  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return false;
    dpr = Math.min(2.5, devicePixelRatio || 1);
    W = r.width; H = r.height; S = W / PROJ[view].span;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
    const g = bg.getContext('2d'); g.scale(dpr, dpr); (view === 'wall' ? drawWall : view === 'lab' ? drawLab : drawStatic)(g, S);
    head.querySelector('.mm-sub').textContent = view === 'wall' ? '城牆區' : view === 'lab' ? '研究所' : '殿堂平面';
    layoutNames();
    return true;
  }
  // 目前顯示哪一張地圖：跟著自己所在的區域；點標題可以切換看另一區（換區時自動回到所在區）
  let view = 'hall', viewArea = 'hall', manual = false;
  const PX = (x, z) => PROJ[view].f(x, z, S);
  const MX = (x, z = 0) => PX(x, z)[0], MZ = (z, x = 0) => PX(x, z)[1];
  const vis = (p) => (p.area || 'hall') === view;
  const mapAngle = (dx, dz) => { const [a, b] = PX(0, 0), [c, d] = PX(dx, dz); return Math.atan2(d - b, c - a); };
  head.style.cursor = 'pointer'; head.title = '切換殿堂／城牆區／研究所地圖';
  head.addEventListener('click', (e) => { e.stopPropagation(); manual = true; view = { hall: 'wall', wall: 'lab', lab: 'hall' }[view]; bg = null; });
  // 傳送點名稱（DOM 文字，放大選擇時顯示）
  function layoutNames() {
    legend.innerHTML = '';
    if (!W) return;
    const all = [...POINTS.map((p, i) => ({ ...p, i })), { ...HOME, i: -1 }].filter(vis);
    for (const p of all) {
      const n = el('span', 'mm-name' + (p.i < 0 ? ' home' : ''), (p.i >= 0 && !isTouch ? `<b>${p.i + 1}</b>` : '') + p.name);
      const [px, py] = PX(p.x, p.z);
      n.style.left = (px / W * 100) + '%'; n.style.top = (py / H * 100) + '%';
      n.dataset.side = p.key === 'front' ? 'ru' : p.key === 'west' ? 'rd' : 'r'; n.dataset.i = p.i; // 標籤一律往右，靠近的幾個上下錯開
      legend.append(n);
    }
  }
  function draw(t) {
    const here = areaOf(me.pos.x);
    if (here !== viewArea) { viewArea = here; manual = false; }
    if (!manual && view !== here) { view = here; bg = null; }
    if (cv.clientWidth && Math.abs(cv.clientWidth - W) > 0.5) bg = null; // 選擇模式放大縮小時重畫底圖（不用 CSS 縮放，避免模糊）
    if (!bg && !resize()) return;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.drawImage(bg, 0, 0, W, H);
    const cd = cdUntil > now();
    const r0 = picking ? 5.2 : 4.4;
    // 引導中的目的地：光環
    const pend = ch && ch.kind === 'tp' ? POINTS[ch.d] : null;
    if (pend && vis(pend)) {
      const k = ch.t / ch.dur; g.strokeStyle = `rgba(143,240,255,${0.5 + 0.5 * Math.sin(t * 10)})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(...PX(pend.x, pend.z), r0 + 3 + 6 * (1 - k), 0, Math.PI * 2); g.stroke();
    }
    // 其他玩家正在傳送的目的地
    for (const r of remote.values()) if (r.ch && r.ch.kind === 'tp' && POINTS[r.ch.d] && vis(POINTS[r.ch.d])) {
      const p = POINTS[r.ch.d]; g.strokeStyle = `rgba(184,151,255,${0.35 + 0.3 * Math.sin(t * 8)})`; g.lineWidth = 1;
      g.beginPath(); g.arc(...PX(p.x, p.z), r0 + 4, 0, Math.PI * 2); g.stroke();
    }
    if (vis(HOME)) drawHome(g, ...PX(HOME.x, HOME.z), r0);
    POINTS.forEach((p, i) => { if (vis(p)) drawWaypoint(g, ...PX(p.x, p.z), r0, picking && !cd, cd, t + i * 0.4); });
    // 其他玩家
    for (const [id, av] of avatarsIter()) {
      const p = av.root.position; if (areaOf(p.x) !== view) continue;
      const col = av.color === 'blue' ? '146,198,255' : '255,169,198';
      const up = p.y > (view === "lab" ? 3 : 4.5); // 二樓的人加一圈白邊
      const [ax, ay] = PX(p.x, p.z);
      g.fillStyle = `rgba(${col},0.95)`; g.beginPath(); g.arc(ax, ay, up ? 2.4 : 2.2, 0, Math.PI * 2); g.fill();
      if (up) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8; g.stroke(); }
      const rr = remote.get(id);
      if (rr && rr.ch) { g.strokeStyle = rr.ch.kind === 'tp' ? 'rgba(184,151,255,0.9)' : 'rgba(255,217,138,0.9)'; g.lineWidth = 1; g.beginPath(); g.arc(ax, ay, 4 + 2 * Math.sin(t * 8), 0, Math.PI * 2); g.stroke(); }
    }
    if (areaOf(me.pos.x) !== view) return; // 在看另一區的地圖時不畫自己
    // 自己：視野扇形 + 箭頭
    const [x, y] = PX(me.pos.x, me.pos.z);
    const yaw = viewYaw();
    const fwd = mapAngle(-Math.sin(yaw), -Math.cos(yaw)); // 地圖上的視線方向（相機面向 -dirV）
    const fan = g.createRadialGradient(x, y, 0, x, y, 26);
    fan.addColorStop(0, 'rgba(255,240,200,0.32)'); fan.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = fan; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 26, fwd - 0.55, fwd + 0.55); g.closePath(); g.fill();
    if (ch) { g.strokeStyle = ch.kind === 'tp' ? 'rgba(143,240,255,0.95)' : 'rgba(255,217,138,0.95)'; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y, 5.5 + 2 * Math.sin(t * 9), 0, Math.PI * 2); g.stroke(); }
    const a = mapAngle(Math.sin(me.ry), Math.cos(me.ry)); // 角色面向（ry：atan2(wx, wz)）
    g.save(); g.translate(x, y); g.rotate(a);
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 3;
    g.fillStyle = me.color === 'blue' ? '#bfe0ff' : '#ffd0e0'; g.strokeStyle = '#fff6dc'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(5.5, 0); g.lineTo(-3.5, 3.6); g.lineTo(-1.8, 0); g.lineTo(-3.5, -3.6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  let avatarsIter = () => [];
  let viewYaw = () => 0;

  // ----- 輸入 -----
  function mapHit(e) {
    const r = cv.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
    let best = null, bd = isTouch ? 16 : 11; // 螢幕像素
    const all = [...POINTS.map((p, i) => [p, i]), [HOME, -1]].filter(([p]) => vis(p));
    for (const [p, i] of all) { const [qx, qy] = PX(p.x, p.z); const d = Math.hypot(qx - px, qy - py) * (r.width / W); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  mm.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  mm.addEventListener('click', (e) => {
    e.stopPropagation();
    const nm = e.target.closest && e.target.closest('.mm-name');
    const i = nm ? Number(nm.dataset.i) : e.target === cv ? mapHit(e) : null;
    if (i === -1) { setPick(false); recall(); return; }
    if (i !== null) { teleport(i); return; }
    togglePick(); // 點地圖空白處：放大／縮回
  });
  const hold = (b, fn) => {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('press'); fn(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => b.classList.remove('press'));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold(bRecall, () => recall());
  hold(bTp, () => togglePick());
  // 手機：選擇模式時點地圖以外的地方就取消
  addEventListener('pointerdown', (e) => { if (picking && !mm.contains(e.target) && !bTp.contains(e.target)) setPick(false); }, true);
  addEventListener('resize', () => { bg = null; });

  // ----- 每幀更新 -----
  let lastBtn = '';
  function update(dt, t) {
    // 自己的引導
    if (ch) {
      ch.t = (now() - ch.t0) / 1000; // 以實際時間計時，不受幀率影響
      const p = Math.min(1, ch.t / ch.dur);
      ch.fade = Math.min(1, ch.fade + dt * 4);
      ch.fx.g.position.set(me.pos.x, me.pos.y, me.pos.z);
      ch.fx.update(dt, p, ch.fade); if (ch.beacon) ch.beacon.update(dt, p, ch.fade);
      barFill.style.transform = `scaleX(${p})`; barGlint.style.left = (p * 100) + '%';
      bar.querySelector('.ch-t').textContent = Math.max(0, ch.dur - ch.t).toFixed(1);
      if (p >= 1) finish();
    }
    // 遠端引導
    for (const [id, r] of remote) {
      const av = getAvatar(id);
      if (r.ch) {
        r.ch.t = (now() - r.ch.t0) / 1000; const p = Math.min(1, r.ch.t / r.ch.dur);
        if (av) r.ch.fx.g.position.set(av.root.position.x, av.root.position.y - (av.sitting ? 0.55 : 0), av.root.position.z);
        r.ch.fx.update(dt, p, Math.min(1, r.ch.t * 4)); if (r.ch.beacon) r.ch.beacon.update(dt, p, Math.min(1, r.ch.t * 4));
        if (r.ch.t > r.ch.dur + 2.5) { retire(r.ch); r.ch = null; } // 保險：完成訊息遺失
      }
      // 到達：等角色的位置跳到目的地附近才彈出（快照比特效晚到時先藏起來）
      if (r.pop && av) {
        const P = r.pop;
        if (P.t < 0) {
          P.wait += dt; av.root.scale.setScalar(0.001);
          if (Math.hypot(av.root.position.x - P.x, av.root.position.z - P.z) < 3 || P.wait > 1.5) P.t = 0;
        } else {
          P.t += dt; const s = popScale(P.t); av.root.scale.setScalar(s);
          if (P.t > 0.45) { av.root.scale.setScalar(1); r.pop = null; }
        }
      }
    }
    // 自己到達時的彈出
    if (selfPop && me.avatar) {
      selfPop.t += dt; me.avatar.root.scale.setScalar(popScale(selfPop.t));
      if (selfPop.t > 0.45) { me.avatar.root.scale.setScalar(1); selfPop = null; }
    }
    for (let i = fading.length - 1; i >= 0; i--) {
      const f = fading[i]; f.k -= dt * 3;
      if (f.k <= 0) { f.fx.dispose(); fading.splice(i, 1); } else f.fx.update(dt, f.fx.p, f.k);
    }
    for (let i = bursts.length - 1; i >= 0; i--) if (!bursts[i].update(dt)) { bursts[i].dispose(); bursts.splice(i, 1); }
    // 按鈕冷卻
    const left = Math.max(0, (cdUntil - now()) / 1000);
    const st = `${left > 0 ? Math.ceil(left) : 0}|${ch ? ch.kind : ''}|${picking}`;
    if (left > 0) bTp.style.setProperty('--cd', (left / TP_CD * 360).toFixed(1) + 'deg');
    if (st !== lastBtn) {
      lastBtn = st;
      bTp.classList.toggle('cooling', left > 0); bTp.querySelector('.tv-n').textContent = left > 0 ? Math.ceil(left) : '';
      if (left <= 0) bTp.style.setProperty('--cd', '0deg');
      bTp.classList.toggle('active', picking || (ch && ch.kind === 'tp'));
      bRecall.classList.toggle('active', !!(ch && ch.kind === 'recall'));
      if (left <= 0 && !bTp.dataset.ready) { bTp.dataset.ready = '1'; bTp.classList.remove('ready-flash'); void bTp.offsetWidth; bTp.classList.add('ready-flash'); }
      if (left > 0) delete bTp.dataset.ready;
    }
    // 小地圖約 30fps
    if (t - lastDraw > 0.033) { lastDraw = t; draw(t); }
  }
  const popScale = (t) => { const u = Math.min(1, t / 0.45); return Math.max(0.001, 1 + Math.sin(u * Math.PI) * 0.18 * (1 - u) - Math.pow(1 - u, 3)); };

  return {
    show() { mm.classList.remove('hidden'); btns.classList.remove('hidden'); bg = null; },
    update, onRemote, forget, recall, teleport, togglePick, setPick, interrupt, cancel,
    get channeling() { return !!ch; }, get picking() { return picking; },
    setAvatars(fn) { avatarsIter = fn; }, setViewYaw(fn) { viewYaw = fn; },
  };
}
