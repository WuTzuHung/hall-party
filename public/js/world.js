// 光之殿堂（Hall des Lumières，原 Emigrant Industrial Savings Bank，紐約 49 Chambers St）程序化 3D 場景
// 座標：單位公尺。x 東西向（街道方向），z>0 為街道，z<0 為建築內部，大螢幕在 z=-58
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';
import { buildTrophy } from './trophy.js';
import { reliefPanel } from './relief.js';

export const SCREEN = { x: 0, y: 6.14, z: -57.9, w: 14, h: 7.875 };
export const HALL = { x0: -14, x1: 14, z0: -58, z1: -6 };
export const SPAWN = { x: 0, z: 6.5, ry: Math.PI };

const PIER_Z = [-11, -18, -25, -32, -39, -46, -53];
const VAULT = { r: 6.8, spring: 13.6, rise: 4, z0: -6, z1: -58, n: 3.4 };
// 拱頂斷面：超橢圓（中央近乎平頂、兩側圓弧收到簷口），依現場照片的平頂＋弧形收邊
// a：0（東側起拱點）→ π（西側起拱點）；off：往室內偏移的距離
function vaultPt(a, off = 0) {
  const c = Math.cos(a), sn = Math.sin(a), e = 2 / VAULT.n;
  return [(VAULT.r - off) * Math.sign(c) * Math.pow(Math.abs(c), e), VAULT.spring + (VAULT.rise - off) * Math.pow(Math.abs(sn), e)];
}
const vaultYAt = (x) => VAULT.spring + VAULT.rise * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / VAULT.r, VAULT.n)), 1 / VAULT.n);

// ---------- 室內燈光狀態（開燈／關燈兩種樣貌，約 1.5 秒平滑過渡） ----------
// hooks：每幀呼叫 fn(e, inside, t)。e：1 = 開燈、0 = 關燈（已緩動）；inside：相機在室內的程度（0 街上 ~ 1 大廳內）
const LIGHT = { target: 1, k: 1, hooks: [], cam: new THREE.Vector3(0, 6, 26), lastT: null };
const onLights = (fn) => LIGHT.hooks.push(fn);
const lerp = (a, b, t) => a + (b - a) * t;
const _c0 = new THREE.Color(), _c1 = new THREE.Color();
const mixColor = (out, a, b, t) => out.copy(_c0.set(a)).lerp(_c1.set(b), t);

// ---------- 合併繪製（大幅降低 draw call） ----------
class Batch {
  constructor() { this.groups = new Map(); }
  add(geo, key) {
    const info = MATS[key]; if (!info) throw new Error('mat ' + key);
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (info.tile) worldUV(g, info.tile);
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
  }
  build(scene) {
    for (const [key, list] of this.groups) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, MATS[key].mat);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
  }
}
function worldUV(g, tile) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
  return geo.applyMatrix4(_m);
}

let MATS = {};
let B; // 目前的 batch
const walls = []; // 碰撞方塊 {x0,x1,z0,z1,y0,y1}
const floors = []; // 地面 {x0,x1,z0,z1,y} 或 坡道 {.., ya, yb} (沿 z: z0 -> ya, z1 -> yb)
const seats = []; // 可坐位置
const camBlock = []; // 相機遮擋方塊

function box(x0, y0, z0, x1, y1, z1, key, solid = false) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  place(g, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });
  B.add(g, key);
  if (globalThis.__HALL_DEBUG) (globalThis.__hallBoxes /* 測試用：記錄所有方塊，供共面檢查工具分析 */ ||= []).push({ x0, y0, z0, x1, y1, z1, key });
  if (solid) { const c = { x0, x1, z0, z1, y0, y1 }; walls.push(c); if (solid !== 'nocam') camBlock.push(c); }
}
function solidOnly(x0, y0, z0, x1, y1, z1, cam = false) { const c = { x0, x1, z0, z1, y0, y1 }; walls.push(c); if (cam) camBlock.push(c); }
function cyl(rt, rb, h, x, y, z, key, seg = 24, opts = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!opts.open);
  place(g, { x, y: y + h / 2, z, ...opts });
  B.add(g, key);
}

// ---------- 材質 ----------
function makeMaterials(q) {
  const aniso = q.high ? 8 : 4;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const ashlar = T.limestone({ blockW: 2, blockH: 0.66, tileMeters: 4, seedN: 3 });
  const rustic = T.limestone({ blockW: 1.6, blockH: 0.6, tileMeters: 4.8, rustic: true, seedN: 4 });
  const plain = T.limestone({ blockW: 0, tileMeters: 4, seedN: 5, base: [222, 212, 190] });
  const granite = T.limestone({ blockW: 1.5, blockH: 0.7, tileMeters: 4, seedN: 6, base: [140, 138, 134] });
  const marbleCream = T.marble({ base: [236, 226, 206], vein: [176, 156, 128], scale: 2, seedN: 8 });
  const marbleWall = T.limestone({ blockW: 1.8, blockH: 0.9, tileMeters: 3.6, seedN: 9, base: [226, 214, 192] });
  const floor = T.marble({ size: 1024, base: [178, 168, 152], vein: [110, 96, 80], scale: 4, seedN: 12, tiles: 4, alt: { base: [160, 140, 124], vein: [120, 98, 84] } });
  const coffer = T.coffers({ n: 2, size: q.high ? 1024 : 512 });
  const gild = T.gildBand(); gild.anisotropy = aniso;
  const asphalt = T.asphalt(), pavers = T.pavers();
  [ashlar, rustic, plain, granite, marbleCream, marbleWall, floor, coffer, asphalt, pavers].forEach(t => t.anisotropy = aniso);
  MATS = {
    stone: { mat: std({ map: ashlar, roughness: 0.88, color: 0xffffff }), tile: 4 },
    rustic: { mat: std({ map: rustic, roughness: 0.92 }), tile: 4.8 },
    plain: { mat: std({ map: plain, roughness: 0.8 }), tile: 4 },
    granite: { mat: std({ map: granite, roughness: 0.7 }), tile: 4 },
    marble: { mat: std({ map: marbleCream, roughness: 0.32, envMapIntensity: 0.6 }), tile: 3 },
    marbleWall: { mat: std({ map: marbleWall, roughness: 0.55, envMapIntensity: 0.4 }), tile: 3.6 },
    floor: { mat: std({ map: floor, roughness: 0.14, metalness: 0.0, envMapIntensity: 1.0 }), tile: 4 },
    plaster: { mat: std({ color: 0xf2e9d6, roughness: 0.93, side: THREE.DoubleSide }) }, // 拱頂的素面石膏
    gild: { mat: std({ map: gild, roughness: 0.5, metalness: 0.3, envMapIntensity: 0.8 }) }, // 鎏金石膏花邊（自帶 UV）
    coffer: { mat: std({ map: coffer, roughness: 0.7, envMapIntensity: 0.4 }), tile: 2.4 },
    gold: { mat: std({ color: 0xc9a24a, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 }) },
    bronze: { mat: std({ color: 0x3b2e22, metalness: 0.8, roughness: 0.45 }) },
    dark: { mat: std({ color: 0x15151a, roughness: 0.6, metalness: 0.3 }) },
    black: { mat: std({ color: 0x050507, roughness: 0.9 }) },
    green: { mat: std({ color: 0x2f5c55, roughness: 0.5, metalness: 0.4 }) },
    asphalt: { mat: std({ map: asphalt, roughness: 0.95 }), tile: 6 },
    pavers: { mat: std({ map: pavers, roughness: 0.9 }), tile: 4 },
    curb: { mat: std({ color: 0x8d8a84, roughness: 0.85 }) },
    paint: { mat: std({ color: 0xe9e4d8, roughness: 0.6 }) },
    paintY: { mat: std({ color: 0xe8b62a, roughness: 0.6 }) },
    cloth: { mat: std({ color: 0xe8dcc6, roughness: 0.95 }) },
    clothDark: { mat: std({ color: 0x4a2b52, roughness: 0.9 }) },
    plainIn: { mat: std({ map: plain, roughness: 0.8, side: THREE.BackSide }), tile: 4 },
    cane: { mat: std({ color: 0xd8b46a, roughness: 0.36, metalness: 0.8, envMapIntensity: 1.1 }) },
    cushion: { mat: std({ color: 0xf4ecdc, roughness: 0.92 }) },
    leaf: { mat: std({ color: 0x3d5e34, roughness: 0.9 }) },
    flower: { mat: std({ color: 0xf0b9c8, roughness: 0.8, emissive: 0x2a0d18 }) },
    flower2: { mat: std({ color: 0xf6efe0, roughness: 0.8, emissive: 0x1a1612 }) },
    candle: { mat: new THREE.MeshBasicMaterial({ color: 0xffd28a }) },
    lampGlow: { mat: new THREE.MeshBasicMaterial({ color: 0xffe2a8 }) },
    ledPurple: { mat: new THREE.MeshBasicMaterial({ color: 0xb26bff }) },
    carpet: { mat: std({ color: 0x4b1f6b, roughness: 1 }) },
    carWhite: { mat: std({ color: 0xe8e8ea, roughness: 0.25, metalness: 0.6 }) },
    carGray: { mat: std({ color: 0x4a4f58, roughness: 0.25, metalness: 0.7 }) },
    carBlack: { mat: std({ color: 0x101114, roughness: 0.2, metalness: 0.7 }) },
    carMaroon: { mat: std({ color: 0x4a1a2a, roughness: 0.25, metalness: 0.7 }) },
    tire: { mat: std({ color: 0x111111, roughness: 0.9 }) },
    glassDark: { mat: std({ color: 0x0b1118, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.5 }) },
    tailLight: { mat: new THREE.MeshBasicMaterial({ color: 0xff2030 }) },
  };
  MATS.cofferUV = { mat: MATS.coffer.mat.clone() }; // 同一張藻井貼圖，但用幾何自帶的 UV（對齊柱距）
}

// ---------- 主程式 ----------
export function buildWorld(scene, renderer, q) {
  makeMaterials(q);
  scene_ = scene;
  B = new Batch();
  const anim = []; // 每幀更新的東西

  // 天空
  scene.add(sky());
  scene.fog = new THREE.Fog(0x1b1834, 90, 320);

  // 光源
  const hemi = new THREE.HemisphereLight(0x7d78c8, 0x4a3050, 0.42); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x9db0ff, 0.35); moon.position.set(-40, 80, 60); scene.add(moon);

  buildStreet(scene, anim);
  buildFacade(scene, anim, q);
  buildInterior(scene, anim, q, renderer);

  B.build(scene);

  // 室內燈光開關：world.setLights(true|false)；預設開燈。相機位置由 scene.onBeforeRender 取得（不需要改 main.js）
  scene.onBeforeRender = (_r, _s, camera) => { LIGHT.cam.copy(camera.position); };
  const night = { sky: 0x7d78c8, ground: 0x4a3050, i: 0.42 };
  onLights((e, inside) => {
    // 半球光：街上永遠是夜晚；進到室內才換成室內的環境光
    mixColor(hemi.color, 0x64548a, 0xfff2de, e).lerp(_c1.set(night.sky), 1 - inside);
    mixColor(hemi.groundColor, 0x3c2832, 0xe9d9bd, e).lerp(_c1.set(night.ground), 1 - inside);
    hemi.intensity = lerp(night.i, lerp(0.2, 1.15, e), inside);
  });
  const stepLights = (t) => {
    const dt = LIGHT.lastT === null ? 0 : Math.min(0.5, Math.max(0, t - LIGHT.lastT)); LIGHT.lastT = t;
    if (LIGHT.k !== LIGHT.target) LIGHT.k = LIGHT.k < LIGHT.target ? Math.min(LIGHT.target, LIGHT.k + dt / 1.5) : Math.max(LIGHT.target, LIGHT.k - dt / 1.5);
    const e = LIGHT.k * LIGHT.k * (3 - 2 * LIGHT.k);
    const c = LIGHT.cam, inside = Math.abs(c.x) < 15 ? THREE.MathUtils.smoothstep(-c.z, -0.5, 3.5) : 0;
    for (const f of LIGHT.hooks) f(e, inside, t);
  };
  anim.push(stepLights);
  stepLights(0);
  return {
    walls, floors, seats, camBlock, anim,
    // on：true 開燈、false 關燈；instant：true 時不做過渡（例如剛連線時套用伺服器狀態）
    setLights(on, instant = false) { LIGHT.target = on ? 1 : 0; if (instant) LIGHT.k = LIGHT.target; return LIGHT.target === 1; },
    get lightsOn() { return LIGHT.target === 1; },
    get lightLevel() { return LIGHT.k; },
  };
}

// ---------- 天空 ----------
function sky() {
  const g = new THREE.SphereGeometry(500, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){
        vec3 d = normalize(vP); float y = d.y;
        vec3 top = vec3(0.025,0.035,0.11), mid = vec3(0.11,0.08,0.22), hor = vec3(0.42,0.24,0.30);
        vec3 c = mix(hor, mid, smoothstep(0.0,0.18,y)); c = mix(c, top, smoothstep(0.15,0.7,y));
        vec3 q = floor(d*380.0); float s = step(0.9975, h(q)) * smoothstep(0.1,0.5,y);
        c += vec3(s)*0.8;
        gl_FragColor = vec4(c,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -10; return mesh;
}

// ---------- 街道 ----------
function buildStreet(scene, anim) {
  // 地面與道路
  // 各塊只佔自己的範圍、互不重疊；路緣石比人行道高 4cm、比路面寬出一點，避免共面閃爍
  box(-160, -0.2, 7.9, 160, 0, 22.1, 'asphalt');
  box(-160, -0.3, -1.6, 160, 0.15, 7.8, 'pavers');
  box(-160, -0.3, 22.2, 160, 0.15, 30.4, 'pavers');
  box(-160, -0.3, 7.8, 160, 0.19, 8.0, 'curb');
  box(-160, -0.3, 22, 160, 0.19, 22.2, 'curb');
  floors.push({ x0: -160, x1: 160, z0: 0, z1: 8, y: 0.15 });
  floors.push({ x0: -160, x1: 160, z0: 22, z1: 30, y: 0.15 });
  // 邊界
  solidOnly(-160, -1, 29.5, 160, 50, 30.5); solidOnly(-61, -1, -2, -59, 50, 32); solidOnly(59, -1, -2, 61, 50, 32);
  // 道路標線
  // 標線厚 3cm（埋入路面 1cm），遠看不會與路面搶深度；斑馬線範圍內不畫中線與邊線
  const PY0 = -0.01, PY1 = 0.03;
  const inCross = (x0, x1) => (x1 > -46.6 && x0 < -38.5) || (x1 > 44.4 && x0 < 52.5);
  for (let x = -150; x < 150; x += 6) if (!inCross(x, x + 3)) box(x, PY0, 14.92, x + 3, PY1, 15.08, 'paint');
  for (const [x0, x1] of [[-160, -46.6], [-38.5, 44.4], [52.5, 160]]) box(x0, PY0, 9.9, x1, PY1, 10.02, 'paint');
  for (let i = 0; i < 8; i++) { box(-46 + i * 0.9, PY0, 8.3, -45.4 + i * 0.9, PY1, 21.7, 'paint'); box(45 + i * 0.9, PY0, 8.3, 45.6 + i * 0.9, PY1, 21.7, 'paint'); }

  // 街燈
  const lampPos = [[-18, 7.3], [18, 7.3], [-42, 7.3], [42, 7.3], [-30, 22.7], [0, 22.7], [30, 22.7]]; // 近側路燈對準立面開間的中央
  for (const [x, z] of lampPos) {
    const dir = z < 15 ? 1 : -1;
    cyl(0.1, 0.16, 6.5, x, 0.15, z, 'dark', 10);
    cyl(0.22, 0.26, 0.6, x, 0.15, z, 'dark', 10);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6); place(arm, { x, y: 6.5, z: z - dir * 0.7, rx: Math.PI / 2 }); B.add(arm, 'dark');
    const head = new THREE.CylinderGeometry(0.18, 0.36, 0.4, 10); place(head, { x, y: 6.35, z: z - dir * 1.4 }); B.add(head, 'dark');
    const bulb = new THREE.SphereGeometry(0.2, 10, 8); place(bulb, { x, y: 6.18, z: z - dir * 1.4 }); B.add(bulb, 'lampGlow');
    glow(scene, x, 6.1, z - dir * 1.4, 2.2, 0xffd9a0, 0.55);
    walls.push({ x0: x - 0.2, x1: x + 0.2, z0: z - 0.2, z1: z + 0.2, y0: 0, y1: 7 });
  }
  const sl1 = new THREE.PointLight(0xffc98a, 60, 26, 2); sl1.position.set(-18, 6, 6.2); scene.add(sl1);
  const sl2 = new THREE.PointLight(0xffc98a, 60, 26, 2); sl2.position.set(18, 6, 6.2); scene.add(sl2);

  // 停在路邊的車（附圖裡有的）
  car(-31, 9.3, 'carWhite', 1); car(-22, 9.3, 'carGray', 1); car(28, 9.3, 'carBlack', 1); car(37, 9.4, 'carWhite', 1);
  car(-8, 19.8, 'carMaroon', -1); car(15, 20.0, 'carGray', -1);

  // 旁邊與對街的建築
  neighbor(-60, -30.4, 0, 34, '#7a5444', 3, 12);
  neighbor(30.4, 60, 0, 42, '#8c7a62', 4, 14);
  const across = [[-60, -38, 26, '#5d3f34'], [-38, -12, 44, '#7c6b58'], [-12, 6, 22, '#6a4a3c'], [6, 34, 58, '#8a8070'], [34, 60, 30, '#5b4636']];
  across.forEach(([x0, x1, h, c], i) => neighborAcross(x0, x1, h, c, i));
  // 遠方天際線
  const sky = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2; const r = 180 + (i % 3) * 30; const h = 40 + ((i * 37) % 90);
    const t = T.cityFacade({ seedN: 300 + i, brick: ['#2b2a3a', '#30283a', '#24283a'][i % 3], cols: 8, floors: 20 });
    const m = new THREE.MeshBasicMaterial({ map: t, color: 0x9a92b8 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(30, h, 30), m);
    b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r - 20); b.lookAt(0, h / 2, -20);
    sky.add(b);
  }
  scene.add(sky);

  // 消防栓、垃圾桶、圍欄
  cyl(0.18, 0.2, 0.7, -9, 0.15, 7.2, 'carMaroon', 10);
  cyl(0.3, 0.26, 0.95, 9, 0.15, 7.2, 'green', 12);
  walls.push({ x0: -9.25, x1: -8.75, z0: 6.95, z1: 7.45, y0: 0, y1: 1.7 }, { x0: 8.65, x1: 9.35, z0: 6.85, z1: 7.55, y0: 0, y1: 1.7 }); // 碰撞高度高於跳躍高度，跳起來也不會落進物件裡
}

function car(x, z, key, dir) {
  const body = new RoundedBoxGeometry(4.6, 0.8, 1.9, 3, 0.25); place(body, { x, y: 0.75, z }); B.add(body, key);
  const cab = new RoundedBoxGeometry(2.6, 0.7, 1.7, 3, 0.25); place(cab, { x: x - 0.2 * dir, y: 1.4, z }); B.add(cab, 'glassDark');
  const roof = new RoundedBoxGeometry(2.3, 0.12, 1.6, 2, 0.05); place(roof, { x: x - 0.2 * dir, y: 1.76, z }); B.add(roof, key);
  for (const sx of [-1.45, 1.45]) for (const sz of [-0.85, 0.85]) {
    const w = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16); place(w, { x: x + sx, y: 0.36, z: z + sz, rx: Math.PI / 2 }); B.add(w, 'tire');
  }
  const hl = new THREE.BoxGeometry(0.06, 0.12, 0.4);
  for (const sz of [-0.6, 0.6]) {
    B.add(place(hl.clone(), { x: x + 2.3 * dir, y: 0.85, z: z + sz }), 'lampGlow');
    B.add(place(hl.clone(), { x: x - 2.3 * dir, y: 0.88, z: z + sz }), 'tailLight');
  }
  walls.push({ x0: x - 2.35, x1: x + 2.35, z0: z - 1, z1: z + 1, y0: 0, y1: 2 });
  camBlock.push(walls[walls.length - 1]);
}

function neighbor(x0, x1, z, h, color, seedN, floors_) {
  const t = T.cityFacade({ seedN, brick: color, cols: Math.round((x1 - x0) / 4), floors: floors_ });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), m);
  mesh.position.set((x0 + x1) / 2, h / 2, z + 0.08); scene_.add(mesh);
  box(x0, 0, z - 40, x1, h, z, 'curb', true);
  box(x0, 0.15, z - 0.05, x1, 3.6, z + 0.25, 'dark');
  box(x0, h - 0.6, z - 0.05, x1, h + 0.05, z + 0.6, 'plain');
}
function neighborAcross(x0, x1, h, color, i) {
  const t = T.cityFacade({ seedN: 50 + i, brick: color, cols: Math.round((x1 - x0) / 4), floors: Math.round(h / 3.6) });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), m);
  mesh.position.set((x0 + x1) / 2, h / 2, 29.92); mesh.rotation.y = Math.PI; scene_.add(mesh);
  box(x0, 0, 30, x1, h, 50, 'curb');
  // 一樓店面
  box(x0 + 0.5, 0.15, 29.7, x1 - 0.5, 3.8, 30.05, 'dark');
  const shop = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 2, 2.6), new THREE.MeshBasicMaterial({ color: [0xffd9a8, 0xa8d8ff, 0xffb0d0, 0xfff0c0, 0xc0ffd8][i] }));
  shop.position.set((x0 + x1) / 2, 1.8, 29.63); shop.rotation.y = Math.PI; scene_.add(shop);
  box(x0, h - 0.8, 29.4, x1, h + 0.05, 30.05, 'plain');
}
let scene_;
// 貼在牆面上的文字／貼花：加 polygonOffset，確保不與後方牆面搶深度
function decal(o) { return new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...o }); }

// 加法混合光暈
const glowTex = () => (glowTex.t ||= T.radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
const GLOWS = { candle: [], rig: [] }; // 會跟著室內燈光變化的光暈
function glow(scene, x, y, z, size, color, opacity = 0.6, tag = null) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.position.set(x, y, z); s.scale.set(size, size, 1); scene.add(s);
  if (tag) GLOWS[tag].push({ m: s.material, o: opacity });
  return s;
}

// ---------- 外觀立面 ----------
function buildFacade(scene, anim, q) {
  const BAYS = [-18, -12, -6, 0, 6, 12, 18];
  const COLS = [-21, -15, -9, -3, 3, 9, 15, 21];
  // 花崗岩基座
  box(-30.3, 0, -0.2, -2.7, 0.7, 0.35, 'granite'); box(2.7, 0, -0.2, 30.3, 0.7, 0.35, 'granite');
  // 巨柱下方的花崗岩柱座（原本柱礎懸空在人行道上方）
  for (const c of COLS) box(c - 0.86, 0, 0.35, c + 0.86, 0.7, 1.44, 'granite');
  walls.push({ x0: -30.5, x1: -1.5, z0: -1.5, z1: 0.35, y0: -1, y1: 50 });
  walls.push({ x0: 1.5, x1: 30.5, z0: -1.5, z1: 0.35, y0: -1, y1: 50 });
  camBlock.push({ x0: -30.5, x1: -1.5, z0: -1.5, z1: 0.0, y0: 0, y1: 48 }, { x0: 1.5, x1: 30.5, z0: -1.5, z1: 0.0, y0: 0, y1: 48 }, { x0: -1.5, x1: 1.5, z0: -1.5, z1: 0, y0: 4.6, y1: 48 });

  // 窗間牆（柱後）
  const pierZones = [[-22.2, -19.8], ...BAYS.slice(0, -1).map(c => [c + 1.8, c + 4.2]), [19.8, 22.2]];
  for (const [a, b] of pierZones) { box(a, 0.7, -1.5, b, 3.0, 0, 'rustic'); box(a, 3.0, -1.5, b, 13.8, 0, 'stone'); }

  const winTex = T.bigWindow({ lit: 0.55 }); const winTexC = T.bigWindow({ lit: 0.8, rows: 1 }); // 中央開間：浮雕上方的橫窗
  const winMat = new THREE.MeshStandardMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.5 });
  const winMatC = new THREE.MeshStandardMaterial({ map: winTexC, emissive: 0xffffff, emissiveMap: winTexC, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.5 });
  const posterMats = [0, 1].map(i => { const t = T.poster(i); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3, roughness: 0.8, alphaTest: 0.5, side: THREE.DoubleSide }); });

  for (const cx of BAYS) {
    const center = cx === 0;
    const wy0 = center ? 10.9 : 4.4; // 中央開間：門上方是石雕浮雕，窗子縮成上方的橫窗
    if (!center) box(cx - 1.8, 0.7, -1.5, cx + 1.8, wy0 - 0.06, 0, 'rustic');
    else box(cx - 1.8, 6.44, -1.5, cx + 1.8, wy0 - 0.06, 0, 'stone');
    box(cx - 1.8, 12.6, -1.5, cx + 1.8, 13.8, 0, 'stone');
    // 窗台與窗楣（上下各自凸出牆面，不與牆塊的頂／底面共面）
    box(cx - 2.0, wy0 - 0.22, -0.56, cx + 2.0, wy0, 0.28, 'plain');
    box(cx - 2.0, 12.52, -0.56, cx + 2.0, 12.8, 0.12, 'plain');
    // 玻璃
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 12.6 - wy0), center ? winMatC : winMat);
    win.position.set(cx, (12.6 + wy0) / 2, -0.45); scene.add(win);
    // 窗框直櫺
    for (const dx of [-1.2, 1.2]) box(cx + dx - 0.07, wy0 - 0.02, -0.5, cx + dx + 0.07, 12.56, -0.34, 'green');
    for (let y = wy0 + 1.6; y < 12.4; y += 1.6) box(cx - 1.84, y - 0.05, -0.5, cx + 1.84, y + 0.05, -0.37, 'green');
    if (!center) {
      // 窗下雕飾板與花環
      box(cx - 1.5, 3.25, 0, cx + 1.5, 4.0, 0.08, 'plain');
      const garland = new THREE.TorusGeometry(0.9, 0.07, 6, 20, Math.PI); place(garland, { x: cx, y: 3.95, z: 0.1, rz: Math.PI, sy: 0.4 }); B.add(garland, 'plain');
      // 海報（附圖中的黃色布條，改為 TL × GEN 冠軍派對）
      if (Math.abs(cx) === 12) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.6), posterMats[cx > 0 ? 1 : 0]);
        p.position.set(cx, 8.75, -0.24); scene.add(p);
        // 掛旗的橫桿
        const rod = new THREE.CylinderGeometry(0.035, 0.035, 3.7, 8); place(rod, { x: cx, y: 11.08, z: -0.24, rz: Math.PI / 2 }); B.add(rod, 'gold'); // 兩端插進窗框側牆
      }
    }
  }

  // 巨柱（愛奧尼克式，帶凹槽）
  for (const c of COLS) {
    box(c - 0.78, 0.7, -0.1, c + 0.78, 3.0, 1.36, 'rustic', true);
    box(c - 0.85, 2.85, -0.1, c + 0.85, 3.05, 1.43, 'plain');
    cyl(0.68, 0.72, 0.18, c, 3.05, 0.65, 'plain', 24);
    const tb = new THREE.TorusGeometry(0.62, 0.08, 6, 24); place(tb, { x: c, y: 3.3, z: 0.65, rx: Math.PI / 2 }); B.add(tb, 'plain');
    const shaft = new THREE.CylinderGeometry(0.5, 0.56, 9.5, 72, 6, true);
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const a = Math.atan2(z, x); const k = 1 - 0.045 * Math.pow(0.5 + 0.5 * Math.cos(a * 24), 2); p.setX(i, x * k); p.setZ(i, z * k); }
    shaft.computeVertexNormals();
    place(shaft, { x: c, y: 3.35 + 4.75, z: 0.65 }); B.add(shaft, 'plain');
    cyl(0.6, 0.52, 0.35, c, 12.85, 0.65, 'plain', 24);
    box(c - 0.8, 13.2, -0.15, c + 0.8, 13.5, 1.4, 'plain');
    box(c - 0.7, 13.5, -0.1, c + 0.7, 13.8, 1.34, 'plain'); // 柱頂墊塊：接到楣梁底，不再懸空
    for (const s of [-1, 1]) {
      const vol = new THREE.CylinderGeometry(0.21, 0.21, 1.5, 16); place(vol, { x: c + s * 0.66, y: 13.0, z: 0.65, rx: Math.PI / 2 }); B.add(vol, 'plain');
      const sp = new THREE.TorusGeometry(0.13, 0.04, 6, 16); place(sp, { x: c + s * 0.66, y: 13.0, z: 1.41 }); B.add(sp, 'plain');
    }
    camBlock.push({ x0: c - 0.6, x1: c + 0.6, z0: 0.1, z1: 1.2, y0: 0, y1: 13.8 });
    walls.push({ x0: c - 0.6, x1: c + 0.6, z0: 0, z1: 1.25, y0: 0, y1: 14 });
  }

  // 中央大門
  box(-1.8, 0.7, -1.5, -1.5, 6.44, 0, 'rustic'); box(1.5, 0.7, -1.5, 1.8, 6.44, 0, 'rustic');
  box(-1.5, 4.6, -1.5, 1.5, 6.44, 0, 'rustic');
  box(-1.5, 0.7, -1.5, 1.5, 1.2, 0, 'granite');
  // 門框雕飾
  box(-2.15, 1.2, 0, -1.5, 4.9, 0.42, 'plain'); box(1.5, 1.2, 0, 2.15, 4.9, 0.42, 'plain');
  box(-2.35, 4.54, 0, 2.35, 5.05, 0.55, 'plain');
  box(-2.5, 5.05, 0, 2.5, 5.2, 0.62, 'plain');
  const arch = new THREE.TorusGeometry(1.9, 0.16, 8, 32, Math.PI); place(arch, { x: 0, y: 5.2, z: 0.35, sy: 0.55 }); B.add(arch, 'plain');
  box(-2.0, 5.2, 0, 2.0, 5.95, 0.2, 'plain');
  box(-0.28, 5.1, 0.1, 0.28, 6.25, 0.55, 'plain'); // 拱心石
  const shield = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 24); place(shield, { x: 0, y: 5.6, z: 0.62, rx: Math.PI / 2, sx: 0.8, sz: 1.15 }); B.add(shield, 'plain');
  // 門楣刻字：決賽兩隊（陰刻羅馬大寫）
  const signT = T.textTexture('GENG   ·   BLG', { w: 1024, h: 96, color: '#4a3d2c', engrave: 'rgba(255,250,235,0.75)', font: '700 54px "Cinzel", "Times New Roman", serif', letter: 18 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.4), decal({ map: signT, roughness: 0.8 }));
  sign.position.set(0, 4.8, 0.585); scene.add(sign);
  // 門上方的石雕浮雕（浮雕 B：隔著瀑布相望的兩人），嵌在石框裡：外框、內框、上簷、下台
  {
    const RW = 4.3, RH = RW * 1024 / 1536, RY = 8.5, y0 = RY - RH / 2, y1 = RY + RH / 2, hw = RW / 2;
    const rb = reliefPanel({ name: 'relief-b', w: RW, h: RH, depth: 0.1, high: q.high, flow: 'fall', glowColor: 0xffdca0, normalScale: 1.1, tint: 0xd9d2c4, segs: 80 });
    rb.mesh.position.set(0, RY, 0.05); scene.add(rb.mesh);
    anim.push((t) => rb.update(t, 0.55, 0.35));
    const iw = 0.115, ow = 0.2, xi = hw - 0.015, xo = xi + iw, xe = xo + ow; // 內框蓋住浮雕邊緣 1.5cm
    for (const sg of [-1, 1]) {
      box(Math.min(sg * xi, sg * xo), y0 + 0.015 - iw, 0, Math.max(sg * xi, sg * xo), y1 - 0.015 + iw, 0.26, 'plain');
      box(Math.min(sg * xo, sg * xe), y0 + 0.015 - iw - ow, 0, Math.max(sg * xo, sg * xe), y1 - 0.015 + iw + ow, 0.18, 'plain');
    }
    box(-xi, y1 - 0.015, 0, xi, y1 - 0.015 + iw, 0.26, 'plain'); box(-xi, y0 + 0.015 - iw, 0, xi, y0 + 0.015, 0.26, 'plain');
    box(-xo, y1 - 0.015 + iw, 0, xo, y1 - 0.015 + iw + ow, 0.18, 'plain'); box(-xo, y0 + 0.015 - iw - ow, 0, xo, y0 + 0.015 - iw, 0.18, 'plain');
    const ft = y1 - 0.015 + iw + ow, fb = y0 + 0.015 - iw - ow;
    box(-xe - 0.06, ft, 0, xe + 0.06, ft + 0.13, 0.34, 'plain'); box(-xe + 0.02, ft + 0.13, 0, xe - 0.02, ft + 0.19, 0.27, 'plain');
    box(-xe - 0.06, fb - 0.12, 0, xe + 0.06, fb, 0.3, 'plain');
    for (const sg of [-1, 1]) box(Math.min(sg * 1.75, sg * 2.05), fb - 0.3, 0, Math.max(sg * 1.75, sg * 2.05), fb - 0.12, 0.22, 'plain'); // 下台的托座
  }
  // 打開的銅門
  box(-1.5, 1.2, -1.4, -1.42, 4.55, -0.12, 'bronze'); box(1.42, 1.2, -1.4, 1.5, 4.55, -0.12, 'bronze');
  // 門口台階（紫色地毯）
  for (let i = 0; i < 5; i++) {
    // 每一階只建自己那一段（不互相包住）；地毯包住踏面與立面，各凸出 3cm
    const y = 0.15 + (i + 1) * 0.21, z1 = 1.9 - i * 0.38, z0 = i === 4 ? 0 : z1 - 0.38;
    box(-2.7, 0, z0, 2.7, y, z1, 'granite');
    box(-1.4, y - 0.21, i === 4 ? 0 : z0 + 0.03, 1.4, y + 0.03, z1 + 0.03, 'carpet');
  }
  // 每一階都是平的踏面（原本用斜坡近似，腳會陷進台階裡）；地毯比石階高 3cm
  for (let i = 0; i < 5; i++) {
    const y = 0.15 + (i + 1) * 0.21, z1 = 1.9 - i * 0.38, z0 = i === 4 ? 0 : z1 - 0.38;
    floors.push({ x0: -2.7, x1: 2.7, z0, z1, y });
    floors.push({ x0: -1.4, x1: 1.4, z0: i === 4 ? 0 : z0 + 0.03, z1: z1 + 0.03, y: y + 0.03 });
  }
  floors.push({ x0: -1.4, x1: 1.4, z0: 1.93, z1: 6.6, y: 0.18 }); // 人行道上的地毯
  floors.push({ x0: -1.5, x1: 1.5, z0: -1.6, z1: 0, y: 1.2 });
  box(-1.4, 0.1, 1.9, 1.4, 0.18, 6.6, 'carpet');
  // 紅絨柱繩
  for (const s of [-1, 1]) for (let z = 2.4; z <= 6.4; z += 2) {
    cyl(0.05, 0.05, 0.95, s * 1.75, 0.15, z, 'gold', 8); cyl(0.17, 0.17, 0.04, s * 1.75, 0.15, z, 'gold', 12);
    const top = new THREE.SphereGeometry(0.07, 8, 6); place(top, { x: s * 1.75, y: 1.12, z }); B.add(top, 'gold');
  }
  for (const s of [-1, 1]) {
    // 絨繩：每兩根柱子之間各垂一段（原本一整條會穿過中間那根柱子）
    for (const zc of [3.4, 5.4]) { const rope = new THREE.TorusGeometry(1, 0.028, 5, 14, Math.PI); place(rope, { x: s * 1.75, y: 1.06, z: zc, ry: Math.PI / 2, rz: Math.PI, sy: 0.24 }); B.add(rope, 'carMaroon'); }
    walls.push({ x0: s * 1.75 - 0.08, x1: s * 1.75 + 0.08, z0: 2.3, z1: 6.5, y0: 0, y1: 1.7 });
  }
  // 門邊燈籠：掛在門框正面（原本的位置插進了兩旁的巨柱裡）
  for (const s of [-1, 1]) {
    const lx = s * 1.83;
    box(lx - 0.05, 3.72, 0.4, lx + 0.05, 3.8, 0.7, 'bronze'); box(lx - 0.09, 3.5, 0.4, lx + 0.09, 3.86, 0.45, 'bronze');
    cyl(0.012, 0.012, 0.1, lx, 3.62, 0.66, 'bronze', 6);
    cyl(0.13, 0.04, 0.07, lx, 3.57, 0.66, 'bronze', 8);
    const l = new THREE.CylinderGeometry(0.13, 0.09, 0.36, 8); place(l, { x: lx, y: 3.39, z: 0.66 }); B.add(l, 'lampGlow');
    cyl(0.05, 0.1, 0.05, lx, 3.16, 0.66, 'bronze', 8);
    glow(scene, lx, 3.4, 0.8, 1.5, 0xffd090, 0.6);
  }
  // 入口旁的立牌：決賽對戰組合（深色牌面、金線框、Cinzel 刻字風）
  const aT = T.textTexture([{ rule: 150, y: 96 }, { t: 'GENG', y: 176 }, { t: 'VS', font: '500 34px "Cinzel", "Times New Roman", serif', y: 250, letter: 12 }, { t: 'BLG', y: 326 }, { rule: 150, y: 404 }],
    { w: 800, h: 500, bg: '#171320', color: '#e6c77c', font: '700 76px "Cinzel", "Times New Roman", serif', letter: 16, border: '#c9a24a' });
  const aMat = new THREE.MeshStandardMaterial({ map: aT, emissive: 0xffffff, emissiveMap: aT, emissiveIntensity: 0.45, roughness: 0.6 });
  box(3.66, 0.93, 2.585, 4.74, 1.69, 2.615, 'dark');
  for (const s of [-1, 1]) {
    const pnl = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.6), aMat); pnl.position.set(4.2, 1.31, 2.6 + s * 0.04); pnl.rotation.y = s > 0 ? 0 : Math.PI; scene.add(pnl);
    cyl(0.022, 0.022, 1.62, 4.2 + s * 0.55, 0.15, 2.6, 'gold', 8);
    const fin = new THREE.SphereGeometry(0.04, 8, 6); place(fin, { x: 4.2 + s * 0.55, y: 1.79, z: 2.6 }); B.add(fin, 'gold');
    box(4.2 + s * 0.55 - 0.05, 0.15, 2.38, 4.2 + s * 0.55 + 0.05, 0.19, 2.82, 'gold');
  }
  box(3.65, 0.89, 2.58, 4.75, 0.94, 2.62, 'gold'); box(3.65, 1.68, 2.58, 4.75, 1.73, 2.62, 'gold');
  walls.push({ x0: 3.6, x1: 4.8, z0: 2.3, z1: 2.9, y0: 0, y1: 1.8 });

  // 兩側凸出翼樓
  for (const s of [-1, 1]) {
    const a = s < 0 ? -30 : 22.2, b = s < 0 ? -22.2 : 30;
    box(a, 0.7, -1.5, b, 13.8, 0.35, 'rustic');
    const dx = s * 26.1;
    box(dx - 1.3, 0.15, 0.3, dx + 1.3, 3.6, 0.41, 'dark');
    box(dx - 1.6, 0.15, 0.35, dx - 1.3, 4.0, 0.6, 'plain'); box(dx + 1.3, 0.15, 0.35, dx + 1.6, 4.0, 0.6, 'plain');
    box(dx - 1.75, 3.6, 0.35, dx + 1.75, 4.25, 0.7, 'plain');
    if (s > 0) box(dx - 1.7, 3.7, 0.35, dx + 1.7, 3.84, 2.4, 'dark');
    const w = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6.2), winMat); w.position.set(dx, 8.4, 0.41); scene.add(w);
    box(dx - 1.5, 5.1, 0.35, dx + 1.5, 5.3, 0.7, 'plain'); box(dx - 1.5, 11.5, 0.35, dx + 1.5, 11.9, 0.6, 'plain');
    box(dx - 1.45, 5.3, 0.35, dx - 1.3, 11.5, 0.55, 'plain'); box(dx + 1.3, 5.3, 0.35, dx + 1.45, 11.5, 0.55, 'plain');
    // 花盆
    for (const pz of [-1, 1]) {
      const px = dx + pz * 2.3;
      cyl(0.42, 0.34, 0.6, px, 0.15, 0.9, 'dark', 16);
      const shrub = new THREE.IcosahedronGeometry(0.5, 1); place(shrub, { x: px, y: 1.05, z: 0.9 }); B.add(shrub, 'leaf');
      walls.push({ x0: px - 0.45, x1: px + 0.45, z0: 0.45, z1: 1.35, y0: 0, y1: 1.5 });
    }
  }

  // 簷部：楣梁、刻字飾帶、齒飾、簷口
  box(-30.4, 13.8, -0.3, 30.4, 14.6, 1.45, 'plain');
  box(-30.4, 14.6, -0.3, 30.4, 15.5, 1.32, 'plain');
  box(-30.5, 15.5, -0.3, 30.5, 15.75, 1.75, 'plain');
  for (let x = -30.3; x < 30.3; x += 0.3) box(x, 15.3, 1.32, x + 0.16, 15.5, 1.48, 'plain');
  box(-30.7, 15.75, -0.3, 30.7, 16.2, 2.15, 'plain');
  const friezeT = T.textTexture('EMIGRANT  ·  INDUSTRIAL  ·  SAVINGS  ·  BANK', { w: 4096, h: 112, color: '#7a6a52', font: '600 82px "Cinzel", serif', letter: 22, fit: 0.92 });
  const frieze = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.7), decal({ map: friezeT, roughness: 0.9 }));
  frieze.position.set(0, 14.95, 1.335); scene.add(frieze);
  for (const x of [-24.5, -16, 16, 24.5]) { const md = new THREE.CylinderGeometry(0.3, 0.3, 0.14, 20); place(md, { x, y: 15.0, z: 1.35, rx: Math.PI / 2 }); B.add(md, 'plain'); }

  // 上層樓
  const upT = T.upperFacade({ floors: 9, cols: 10 });
  const upMat = new THREE.MeshStandardMaterial({ map: upT, roughness: 0.88, emissive: 0xffffff, emissiveMap: upT, emissiveIntensity: 0.12 });
  const up = new THREE.Mesh(new THREE.PlaneGeometry(60, 31.8), upMat); up.position.set(0, 16.2 + 15.9, 0.07); scene.add(up);
  box(-30, 16.2, -1.5, 30, 48, 0, 'stone');
  for (const y of [23.25, 37.4]) box(-30.2, y, -0.3, 30.2, y + 0.35, 0.45, 'plain');
  box(-30.6, 47.4, -0.3, 30.6, 48.04, 1.2, 'plain'); box(-30.9, 48.04, -0.3, 30.9, 48.5, 1.6, 'plain');
  box(-30.4, 48.5, -40, 30.4, 49.6, 0.2, 'stone');
  // 上層角落的方石（用整數計數，避免浮點誤差多出一塊埋在簷口裡）
  for (const s of [-1, 1]) for (let k = 0; k < 24; k++) { const y = 16.2 + k * 1.3; box(s > 0 ? 28.6 : -30.08, y, -0.2, s > 0 ? 30.08 : -28.6, y + 1.1, 0.16, 'plain'); }
  // 側面與後方（從街道角度可見）；側牆一路接到正面，轉角不留缺口
  box(-30.5, 0, -60, -30, 49.56, -0.04, 'stone'); box(30, 0, -60, 30.5, 49.56, -0.04, 'stone');

  // 中央徽章雕飾（盾徽 + 兩側斜倚人像）
  const sh = new THREE.CylinderGeometry(1.25, 1.25, 0.76, 40); place(sh, { x: 0, y: 18.6, z: 0.32, rx: Math.PI / 2, sz: 1.35 }); B.add(sh, 'plain'); // 盾徽背面貼到牆面
  const shr = new THREE.TorusGeometry(1.25, 0.14, 8, 40); place(shr, { x: 0, y: 18.6, z: 0.72, sy: 1.35 }); B.add(shr, 'plain');
  const crown = new THREE.CylinderGeometry(0.5, 0.75, 0.6, 16); place(crown, { x: 0, y: 20.55, z: 0.4 }); B.add(crown, 'plain');
  for (const s of [-1, 1]) {
    const scroll = new THREE.TorusGeometry(0.5, 0.2, 8, 20, Math.PI * 1.5); place(scroll, { x: s * 1.55, y: 17.2, z: 0.24, rz: s < 0 ? 0 : Math.PI / 2 }); B.add(scroll, 'plain');
    // 人像（抽象化雕塑）
    const torso = new THREE.CapsuleGeometry(0.35, 1.1, 6, 12); place(torso, { x: s * 2.5, y: 17.0, z: 0.42, rz: s * 1.15 }); B.add(torso, 'plain');
    const head = new THREE.SphereGeometry(0.3, 14, 10); place(head, { x: s * 2.05, y: 17.75, z: 0.45 }); B.add(head, 'plain');
    const leg = new THREE.CapsuleGeometry(0.28, 1.4, 6, 12); place(leg, { x: s * 3.4, y: 16.72, z: 0.5, rz: s * 1.45 }); B.add(leg, 'plain');
    const arm = new THREE.CapsuleGeometry(0.14, 0.8, 4, 8); place(arm, { x: s * 1.75, y: 17.4, z: 0.68, rz: s * -0.6 }); B.add(arm, 'plain');
  }
  box(-4.4, 16.2, -0.3, 4.4, 16.5, 1.3, 'plain');

  // 旗幟
  for (const s of [-1, 1]) {
    // 左旗 GENG、右旗 BLG
    const flagT = s < 0 ? T.flag('GENG', '#2a0f18') : T.flag('BLG', '#131d40');
    const flagMat = new THREE.MeshStandardMaterial({ map: flagT, side: THREE.DoubleSide, roughness: 0.85 });
    const x = s * 9.6;
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 3.4, 8); place(pole, { x, y: 19.6, z: 1.45, rx: 1.05 }); B.add(pole, 'dark');
    const fg = new THREE.PlaneGeometry(1.1, 3.0, 1, 12); fg.translate(0, -1.5, 0);
    const f = new THREE.Mesh(fg, flagMat); f.position.set(x, 20.45, 2.85); f.rotation.y = s * 0.25; scene.add(f);
    const base = fg.attributes.position.array.slice();
    anim.push((t) => {
      const p = fg.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = base[i * 3 + 1]; p.setZ(i, Math.sin(t * 1.6 + y * 1.3 + s) * 0.08 * (-y / 3)); }
      p.needsUpdate = true; fg.computeVertexNormals();
    });
  }

  // 立面泛光燈（暖色投光，營造夜晚氣氛）
  for (const x of [-15, 0, 15]) {
    const sp = new THREE.SpotLight(0xffd2a0, 1500, 60, 0.62, 0.7, 2);
    sp.position.set(x, 0.5, 6.5); sp.target.position.set(x, 20, 0); scene.add(sp, sp.target);
  }
  for (const x of [-24, -12, 12, 24]) { // 地面投光燈具
    box(x - 0.25, 0.15, 6.4, x + 0.25, 0.45, 6.9, 'dark');
    walls.push({ x0: x - 0.25, x1: x + 0.25, z0: 6.4, z1: 6.9, y0: 0, y1: 1.5 });
  }
  // 入口內透出的光
  const doorL = new THREE.PointLight(0xc58bff, 30, 12, 2); doorL.position.set(0, 3, 1); scene.add(doorL);
}

// ---------- 室內大廳 ----------
function buildInterior(scene, anim, q, renderer) {
  RectAreaLightUniformsLib.init();

  // 門廳
  box(-2.5, 0.7, -6, 2.5, 1.2, -1.5, 'marble');
  floors.push({ x0: -2.5, x1: 2.5, z0: -6.2, z1: -1.5, y: 1.2 });
  box(-2.8, 1.2, -6, -2.5, 6.0, -1.5, 'marbleWall', true); box(2.5, 1.2, -6, 2.8, 6.0, -1.5, 'marbleWall', true);
  box(-2.8, 6.0, -6, 2.8, 6.3, -1.5, 'plain');
  // 門廳天花：鎏金放射圓盤 + 長桿吊燈（依現場照片）
  {
    const VZ = -3.75, MA = 1.7, MB = 1.45;
    const drum = new THREE.CylinderGeometry(1, 1, 0.1, 48); place(drum, { x: 0, y: 5.98, z: VZ, sx: MA, sz: MB }); B.add(drum, 'plain');
    const sunT = T.sunburst(q.high ? 512 : 256);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ map: sunT, roughness: 0.55, metalness: 0.25, emissive: 0xffffff, emissiveMap: sunT, emissiveIntensity: 0.25 }));
    sun.rotation.x = Math.PI / 2; sun.scale.set(MA - 0.08, MB - 0.08, 1); sun.position.set(0, 5.922, VZ); scene.add(sun);
    const rim = new THREE.TorusGeometry(1, 0.03, 6, 48); place(rim, { x: 0, y: 5.93, z: VZ, rx: Math.PI / 2, sx: MA, sy: MB }); B.add(rim, 'gold');
    cyl(0.05, 0.1, 0.07, 0, 5.85, VZ, 'gold', 12); cyl(0.012, 0.012, 1.58, 0, 4.3, VZ, 'gold', 6);
    cyl(0.1, 0.36, 0.09, 0, 4.22, VZ, 'bronze', 20); cyl(0.37, 0.37, 0.025, 0, 4.2, VZ, 'gold', 20);
    cyl(0.3, 0.26, 0.03, 0, 4.172, VZ, 'lampGlow', 20);
    const pg = glow(scene, 0, 4.1, VZ, 2.6, 0xffd9a0, 0.5);
    const pl = new THREE.PointLight(0xffdcb0, 30, 11, 2); pl.position.set(0, 3.9, VZ); scene.add(pl); // 吊燈：門廳的暖光
    onLights((e) => { pg.material.opacity = lerp(0.4, 0.6, e); sun.material.emissiveIntensity = lerp(0.12, 0.3, e); pl.intensity = lerp(16, 34, e); });
  }

  // 地板
  box(-14, -0.3, -58, 14, 0, -6, 'floor');
  floors.push({ x0: -14, x1: 14, z0: -58, z1: -6, y: 0 });

  // 南牆（入口那面）
  box(-14.6, 0, -6.5, -2.5, 17.8, -6, 'marbleWall', true);
  box(2.5, 0, -6.5, 14.6, 17.8, -6, 'marbleWall', true);
  box(-2.5, 6.0, -6.5, 2.5, 17.8, -6, 'marbleWall', true);
  // 門套：內緣比牆洞多凸出 5cm，避免與牆洞側面／頂面共面
  box(-3.0, 1.2, -6.65, -2.45, 6.0, -6.4, 'plain'); box(2.45, 1.2, -6.65, 3.0, 6.0, -6.4, 'plain'); box(-3.1, 5.94, -6.7, 3.1, 6.6, -6.4, 'plain');
  // 北牆與側牆
  box(-14.6, 0, -58.6, 14.6, 17.8, -58, 'marbleWall', true);
  box(-14.6, 0, -58, -14, 17.8, -6, 'marbleWall', true);
  box(14, 0, -58, 14.6, 17.8, -6, 'marbleWall', true);
  // 踢腳線
  box(-14.05, 0, -58.05, -13.88, 0.3, -6.45, 'dark'); box(13.88, 0, -58.05, 14.05, 0.3, -6.45, 'dark');

  // 入口平台與往下的大階梯
  box(-7, 0, -10, 7, 1.2, -6.0, 'marble', true);
  floors.push({ x0: -7, x1: 7, z0: -10, z1: -6.0, y: 1.2 });
  for (let i = 0; i < 8; i++) {
    // 每一階只建自己那一段，避免面重疊閃爍；最低一階高 0.15，不與地板同高
    const y = 1.2 - i * 0.15; const z1 = -10 - i * 0.375, z0 = z1 - 0.375;
    box(-4, 0, z0, 4, y, z1, 'marble');
  }
  for (let i = 0; i < 8; i++) { const z1 = -10 - i * 0.375; floors.push({ x0: -4, x1: 4, z0: z1 - 0.375, z1, y: 1.2 - i * 0.15 }); } // 平的踏面，不用斜坡
  solidOnly(-4, 1.2 - 0.5, -10.2, 4, 1.25, -10); // 防止從平台前緣以下穿入
  // 欄杆：整圈都收在平台邊緣以內（原本左側整條懸在平台外、前緣有一半懸空）
  for (const s of [-1, 1]) {
    balustrade('x', -9.8, Math.min(s * 4.3, s * 6.8), Math.max(s * 4.3, s * 6.8), 1.2, 0, false, s > 0 ? 0.3 : 0.36, s > 0 ? 0.36 : 0.3);
    balustrade('z', s * 6.8, -9.8, -6.44, 1.2, s * 6.8);
    // 樓梯頂的端柱：收住斜扶手與平台欄杆的交接
    box(Math.min(s * 3.95, s * 4.45), 1.2, -10.24, Math.max(s * 3.95, s * 4.45), 2.44, -9.56, 'marble');
    box(Math.min(s * 3.9, s * 4.5), 2.44, -10.29, Math.max(s * 3.9, s * 4.5), 2.52, -9.51, 'plain');
    box(Math.min(s * 3.95, s * 4.45), 0, -10.24, Math.max(s * 3.95, s * 4.45), 1.2, -10.0, 'marble');
    slopedParapet(s > 0 ? 4 : -4.3, s > 0 ? 4.3 : -4, -13.1, -10, 0, 1.2);
    // 大型端柱
    box(s * 4.15 - 0.3, 0, -13.5, s * 4.15 + 0.3, 1.3, -12.9, 'marble', true);
    const urn = new THREE.SphereGeometry(0.26, 16, 12); place(urn, { x: s * 4.15, y: 1.55, z: -13.2 }); B.add(urn, 'gold');
    box(s * 4.15 - 0.36, 1.3, -13.56, s * 4.15 + 0.36, 1.38, -12.84, 'plain');
  }

  // 冠軍獎盃與展示台：入口平台正中央，一進門就看到；兩側到欄杆各留 6m 以上，樓梯口（x ±4）完全暢通
  {
    const TX = 0, TZ = -8.2, PY = 1.2;
    const sq = (hw, y0, y1, key) => box(TX - hw, PY + y0, TZ - hw, TX + hw, PY + y1, TZ + hw, key);
    sq(0.58, 0, 0.1, 'marble'); sq(0.5, 0.1, 0.17, 'plain'); sq(0.42, 0.17, 0.72, 'plain'); sq(0.47, 0.72, 0.775, 'plain');
    sq(0.44, 0.775, 0.795, 'gold'); sq(0.53, 0.795, 0.865, 'marble'); sq(0.275, 0.865, 0.89, 'dark');
    // 台身四面的金線框
    for (let k = 0; k < 4; k++) {
      const fr = (u0, y0, u1, y1) => { const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, 0.012); place(g, { x: (u0 + u1) / 2, y: PY + (y0 + y1) / 2, z: 0.424 }); place(g, { ry: k * Math.PI / 2 }); place(g, { x: TX, z: TZ }); B.add(g, 'gold'); };
      fr(-0.31, 0.25, -0.292, 0.64); fr(0.292, 0.25, 0.31, 0.64); fr(-0.292, 0.25, 0.292, 0.268); fr(-0.292, 0.622, 0.292, 0.64);
    }
    const col = { x0: TX - 0.58, x1: TX + 0.58, z0: TZ - 0.58, z1: TZ + 0.58, y0: PY, y1: PY + 1.9 }; // 只有展示台有碰撞；高度高於跳躍高度
    walls.push(col); camBlock.push({ ...col, y1: PY + 0.9 });
    const trophy = buildTrophy(renderer);
    trophy.group.position.set(TX, PY + 0.89, TZ); scene.add(trophy.group);
    // 假的聚光：地面光池、台面光暈、從上方打下來的光錐（不增加真實光源）
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffe6c0, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(TX, PY + 0.012, TZ - 0.3); scene.add(pool);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.62, 5.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.set(TX, PY + 0.89 + 2.6, TZ); scene.add(cone);
    onLights((e, _in, t) => { trophy.update(t, e); pool.material.opacity = lerp(0.42, 0.16, e); cone.material.opacity = lerp(0.075, 0.022, e); });
  }

  // 入口牆（面向大螢幕的那面）門上方的巨幅浮雕（浮雕 A），嵌在希臘式石框裡：內外兩層框、下台與托座、上簷、三角山花
  {
    const RW = 8, RH = 6, RY = 10.3, WZ = -6.5, y0 = RY - RH / 2, y1 = RY + RH / 2;
    const ra = reliefPanel({ name: 'relief-a', w: RW, h: RH, depth: 0.15, high: q.high, flow: 'radial', origin: [0.47, 0.57], glowColor: 0xffdf9c, normalScale: 1.15, segs: 112 });
    ra.mesh.rotation.y = Math.PI; ra.mesh.position.set(0, RY, WZ - 0.05); scene.add(ra.mesh);
    onLights((e, _in, t) => ra.update(t, lerp(1.35, 0.5, e), lerp(0.95, 0.3, e)));
    const zb = (x0, ya, x1, yb, d, key = 'plain') => box(x0, ya, WZ - d, x1, yb, WZ, key);
    const iw = 0.14, ow = 0.3, xi = RW / 2 - 0.02, xo = xi + iw, xe = xo + ow, yi0 = y0 + 0.02, yi1 = y1 - 0.02;
    for (const sg of [-1, 1]) {
      zb(Math.min(sg * xi, sg * xo), yi0 - iw, Math.max(sg * xi, sg * xo), yi1 + iw, 0.3);
      zb(Math.min(sg * xo, sg * xe), yi0 - iw - ow, Math.max(sg * xo, sg * xe), yi1 + iw + ow, 0.2);
      zb(Math.min(sg * (xi - 0.03), sg * xi), yi0, Math.max(sg * (xi - 0.03), sg * xi), yi1, 0.27, 'gold'); // 內緣金線
    }
    zb(-xi, yi1, xi, yi1 + iw, 0.3); zb(-xi, yi0 - iw, xi, yi0, 0.3);
    zb(-xi + 0.03, yi1 - 0.03, xi - 0.03, yi1, 0.27, 'gold'); zb(-xi + 0.03, yi0, xi - 0.03, yi0 + 0.03, 0.27, 'gold');
    zb(-xo, yi1 + iw, xo, yi1 + iw + ow, 0.2); zb(-xo, yi0 - iw - ow, xo, yi0 - iw, 0.2);
    const ft = yi1 + iw + ow, fb = yi0 - iw - ow;
    // 下台與兩個托座
    zb(-xe - 0.14, fb - 0.14, xe + 0.14, fb, 0.42);
    for (const sg of [-1, 1]) { zb(Math.min(sg * 3.62, sg * 3.98), fb - 0.58, Math.max(sg * 3.62, sg * 3.98), fb - 0.14, 0.3); zb(Math.min(sg * 3.66, sg * 3.94), fb - 0.66, Math.max(sg * 3.66, sg * 3.94), fb - 0.58, 0.2); }
    // 上簷：齒飾 + 簷口
    zb(-xe - 0.02, ft, xe + 0.02, ft + 0.1, 0.26);
    for (let x = -xe; x < xe - 0.1; x += 0.3) zb(x + 0.06, ft + 0.1, x + 0.24, ft + 0.22, 0.34);
    zb(-xe - 0.02, ft + 0.1, xe + 0.02, ft + 0.22, 0.24);
    zb(-xe - 0.18, ft + 0.22, xe + 0.18, ft + 0.36, 0.48); zb(-xe - 0.1, ft + 0.36, xe + 0.1, ft + 0.42, 0.4);
    // 三角山花：山牆面 + 兩道斜簷 + 中央金色月桂環 + 頂端石座
    const pb = ft + 0.42, ph = 1.3, phw = xe + 0.1;
    const tri = new THREE.Shape(); tri.moveTo(-phw, 0); tri.lineTo(phw, 0); tri.lineTo(0, ph); tri.closePath();
    const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.18, bevelEnabled: false }); place(tg, { x: 0, y: pb, z: WZ - 0.18 }); B.add(tg, 'plain');
    const ang = Math.atan2(ph, phw), len = Math.hypot(ph, phw) + 0.2;
    for (const sg of [-1, 1]) {
      const rk = new THREE.BoxGeometry(len, 0.2, 0.46); place(rk, { x: sg * (phw / 2 + Math.sin(ang) * 0.1) , y: pb + ph / 2 + Math.cos(ang) * 0.1, z: WZ - 0.23, rz: -sg * ang }); B.add(rk, 'plain');
      const fl = new THREE.BoxGeometry(len - 0.3, 0.06, 0.52); place(fl, { x: sg * (phw / 2 + Math.sin(ang) * 0.23), y: pb + ph / 2 + Math.cos(ang) * 0.23, z: WZ - 0.26, rz: -sg * ang }); B.add(fl, 'plain');
    }
    const wr = new THREE.TorusGeometry(0.34, 0.055, 6, 28); place(wr, { x: 0, y: pb + 0.5, z: WZ - 0.2 }); B.add(wr, 'gold');
    const wd = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 24); place(wd, { x: 0, y: pb + 0.5, z: WZ - 0.2, rx: Math.PI / 2 }); B.add(wd, 'gold');
    zb(-0.3, pb + ph + 0.02, 0.3, pb + ph + 0.42, 0.5); zb(-0.36, pb + ph + 0.42, 0.36, pb + ph + 0.5, 0.56);
    const orb = new THREE.SphereGeometry(0.2, 16, 12); place(orb, { x: 0, y: pb + ph + 0.68, z: WZ - 0.28 }); B.add(orb, 'gold');
  }

  // 方柱（大理石）
  for (const z of PIER_Z) for (const s of [-1, 1]) {
    const x = s * 7.5;
    box(x - 0.85, 0, z - 0.85, x + 0.85, 0.65, z + 0.85, 'granite', true);
    box(x - 0.7, 0.65, z - 0.7, x + 0.7, 12.4, z + 0.7, 'marble', true);
    box(x - 0.8, 0.6, z - 0.8, x + 0.8, 0.8, z + 0.8, 'plain');
    box(x - 0.86, 6.52, z - 0.86, x + 0.86, 7.08, z + 0.86, 'plain');
    box(x - 0.86, 11.9, z - 0.86, x + 0.86, 12.44, z + 0.86, 'plain');
    box(x - 0.76, 11.6, z - 0.76, x + 0.76, 11.67, z + 0.76, 'gold');
    // 牆上壁柱
    box(s > 0 ? 13.55 : -14, 0, z - 0.6, s > 0 ? 14 : -13.55, 13.6, z + 0.6, 'marble', true);
  }
  // 中殿上方的簷部
  for (const s of [-1, 1]) {
    const xi = s * 6.6, xo = s * 8.4;
    box(Math.min(xi, xo), 12.4, -58.2, Math.max(xi, xo), 13.6, -6.3, 'plain');
    box(Math.min(s * 6.3, s * 6.65), 13.2, -58.15, Math.max(s * 6.3, s * 6.65), 13.7, -6.35, 'plain');
    box(Math.min(s * 6.5, s * 6.64), 12.75, -58.15, Math.max(s * 6.5, s * 6.64), 12.9, -6.35, 'gold');
    for (let z = -57.8; z < -6.6; z += 0.32) box(Math.min(s * 6.42, s * 6.6), 13.02, z, Math.max(s * 6.42, s * 6.6), 13.2, z + 0.16, 'plain');
    // 夾層樓面帶
    // 只延伸到最後一根方柱，不伸到大螢幕前面
    box(Math.min(s * 6.7, s * 8.4), 6.6, -54.0, Math.max(s * 6.7, s * 8.4), 7.0, -6.3, 'plain');
    box(Math.min(s * 6.58, s * 6.76), 6.72, -53.95, Math.max(s * 6.58, s * 6.76), 6.86, -6.35, 'gold');
  }

  // 拱頂（依現場照片）：素面奶油色石膏、中央近乎平頂；只有沿簷口的一圈與每道橫向拱肋的底面是玫瑰花藻井
  scene.add(vaultMesh());
  for (const g of vaultCofferBands()) B.add(g, 'cofferUV');
  // 拱肋：每 7m 一道、對齊方柱；底面一排玫瑰花藻井，兩側各一道金線。兩端貼牆的那兩道維持素面窄肋
  const vaultCurve = (z, off) => new (class extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const [x, y] = vaultPt(Math.PI * t, off); return o.set(x, y, z); } })();
  for (const z of PIER_Z) {
    const { soffit, sides } = ribGeometry(z, 0.5, 0.22, true);
    B.add(soffit, 'cofferUV'); B.add(sides, 'plain');
    for (const e of [-1, 1]) B.add(new THREE.TubeGeometry(vaultCurve(z + e * 0.5, 0.22), 56, 0.04, 4, false), 'gold');
  }
  for (const z of [-6.72, -57.72]) {
    const { soffit, sides } = ribGeometry(z, 0.34, 0.2, false);
    B.add(soffit, 'plain'); B.add(sides, 'plain');
    B.add(new THREE.TubeGeometry(vaultCurve(z + (z > -30 ? -0.34 : 0.34), 0.2), 56, 0.04, 4, false), 'gold');
  }
  // 橢圓彩繪玻璃天窗：每個柱距一座、長軸橫跨大廳；深藍菱格玻璃、中央玫瑰窗、左右花卉畫板，外面一圈厚重的鎏金石膏框
  // 拱頂中央不是完全平的，所以用一圈石膏鼓座把平的橢圓框接回拱頂，不讓它懸空
  const GA = 3.7, GB = 2.25, FA = 4.2, FB = 2.75, FY = 17.3, GY = 17.4;
  const ellipseTube = (a, b, y, z, r, key, rad = 5) => {
    const cv = new (class extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const an = Math.PI * 2 * t; return o.set(a * Math.cos(an), y, z + b * Math.sin(an)); } })();
    B.add(new THREE.TubeGeometry(cv, 72, r, rad, true), key);
  };
  const glassMats = [0, 1].map((v) => new THREE.MeshBasicMaterial({ map: T.laylight(q.high ? 1024 : 512, v, GA / GB) }));
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  [-14.5, -21.5, -28.5, -35.5, -42.5, -49.5].forEach((z, i) => {
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 64), glassMats[i % 2]);
    glass.rotation.x = Math.PI / 2; glass.scale.set(GA, GB, 1); glass.position.set(0, GY, z); scene.add(glass);
    // 內側窗筒（從框面退到玻璃）與外側鼓座
    const reveal = new THREE.CylinderGeometry(1, 1, GY - FY + 0.3, 64, 1, true); place(reveal, { x: 0, y: (GY + FY) / 2 + 0.15, z, sx: GA + 0.02, sz: GB + 0.02 }); B.add(reveal, 'plainIn');
    const drum = new THREE.CylinderGeometry(1, 1, 0.5, 64, 1, true); place(drum, { x: 0, y: FY + 0.25, z, sx: FA, sz: FB }); B.add(drum, 'plain');
    // 框面：朝下的橢圓環，貼鎏金莨苕葉花邊
    B.add(ellipseRing(GA, GB, FA, FB, FY, z, 96, 12), 'gild');
    // 線腳：玻璃邊金線、內緣金線、外緣石膏圓線 + 金線
    ellipseTube(GA - 0.01, GB - 0.01, GY - 0.03, z, 0.035, 'gold', 4);
    ellipseTube(GA + 0.03, GB + 0.03, FY - 0.01, z, 0.05, 'gold');
    ellipseTube(FA - 0.03, FB - 0.03, FY - 0.02, z, 0.09, 'plain', 6);
    ellipseTube(FA + 0.07, FB + 0.07, FY + 0.03, z, 0.04, 'gold', 4);
    // 光束（體積光感）：只放兩道，離螢幕近的不放，避免擋到畫面
    if (i === 1 || i === 3) { const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.35, 16, 32, 1, true), beamMat); beam.scale.set(GA * 0.8, 1, GB * 0.8); beam.position.set(0, 9.2, z); scene.add(beam); }
  });
  onLights((e) => { for (const m of glassMats) m.color.setScalar(lerp(0.5, 1.0, e)); beamMat.opacity = lerp(0.018, 0.05, e); });

  // 側廊天花
  // 藻井每個柱距剛好 6 格、橫向 5 格，格線對齊方柱；每根方柱到壁柱之間加一道橫梁
  for (const s of [-1, 1]) {
    box(Math.min(s * 8.4, s * 14.05), 13.64, -58.2, Math.max(s * 8.4, s * 14.05), 13.95, -6.3, 'plain');
    B.add(cofferPlane(Math.min(s * 8.4, s * 14), Math.max(s * 8.4, s * 14), -58, -6.5, 13.6, 5), 'cofferUV');
    for (const z of PIER_Z) {
      box(Math.min(s * 8.3, s * 14.05), 13.3, z - 0.34, Math.max(s * 8.3, s * 14.05), 13.66, z + 0.34, 'plain');
      box(Math.min(s * 8.3, s * 14.05), 13.34, z - 0.38, Math.max(s * 8.3, s * 14.05), 13.4, z + 0.38, 'gold');
    }
  }
  // 夾層（二樓迴廊）與通往夾層的樓梯
  for (const s of [-1, 1]) {
    box(s > 0 ? 8.4 : -14, 6.6, -58, s > 0 ? 14 : -8.4, 7.0, -25, 'marble');
    floors.push({ x0: s > 0 ? 7.2 : -14, x1: s > 0 ? 14 : -7.2, z0: -54.0, z1: -25, y: 7 });
    floors.push({ x0: s > 0 ? 8.4 : -14, x1: s > 0 ? 14 : -8.4, z0: -58, z1: -54.0, y: 7 });
    // 樓梯下方的空間用一道牆封起來（原本只有看不見的碰撞牆，從側廊會看進樓梯底）
    box(s > 0 ? 8.7 : -13.6, 0, -25.3, s > 0 ? 13.6 : -8.7, 6.64, -25.06, 'marbleWall');
    box(s > 0 ? 8.7 : -13.6, 6.3, -25.36, s > 0 ? 13.6 : -8.7, 6.48, -25.3, 'gold');
    // 樓梯 40 階
    const sx0 = s > 0 ? 9 : -14, sx1 = s > 0 ? 14 : -9;
    for (let i = 0; i < 40; i++) {
      const y = (i + 1) * 0.175; const z1 = -13 - i * 0.3, z0 = z1 - 0.3;
      box(sx0, Math.max(0, y - 0.6), z0, sx1, y, z1, 'marble');
    }
    for (let i = 0; i < 40; i++) { const z1 = -13 - i * 0.3; floors.push({ x0: sx0, x1: sx1, z0: z1 - 0.3, z1, y: (i + 1) * 0.175 }); } // 每階 17.5cm 的平踏面
    slopedParapet(s > 0 ? 8.75 : -9.0, s > 0 ? 9.0 : -8.75, -25, -13, 7, 0);
    solidOnly(sx0, -0.5, -25.4, sx1, 6.3, -25.0); // 樓梯下方
    solidOnly(Math.min(s * 8.2, s * 9), -0.5, -25.6, Math.max(s * 8.2, s * 9), 6.6, -13);
    // 夾層欄杆
    // 欄杆只放在兩根方柱之間，與柱子對齊、不互相穿插
    // 欄杆兩端各伸進柱身 4cm（原本離柱面還有 16cm 的空隙）
    const segs = [[-31.34, -25.66], [-38.34, -32.66], [-45.34, -39.66], [-52.34, -46.66]];
    for (const [a, b] of segs) balustrade('z', s * 7.5, a, b, 7, s * 7.5, true);
    // 螢幕旁：迴廊收在最後一根柱子後方，欄杆貼著柱子北面轉向，再沿樓板邊緣走到北牆
    balustrade('x', -53.82, Math.min(s * 7.4, s * 8.62), Math.max(s * 7.4, s * 8.62), 7, 0, false, s > 0 ? 0.2 : 0.36, s > 0 ? 0.36 : 0.2);
    balustrade('z', s * 8.62, -57.82, -53.82, 7, s * 8.62);
    // 樓梯頂的端柱：包住斜扶手的頂端，但與方柱分開（中間留 35cm 的陰影縫），不再跟柱身同寬同面、看起來黏成一道牆
    // 比柱身窄、前後各退 10cm；自帶花崗岩座與石膏帽，座／帽都不碰到方柱的柱礎與柱頭線腳
    const nx = (a, b) => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
    { const [a, b] = nx(8.55, 9.05); box(a, 0.5, -25.6, b, 8.1, -24.4, 'marble', true); }
    { const [a, b] = nx(8.49, 9.11); box(a, 0, -25.66, b, 0.5, -24.34, 'granite'); box(a, 8.1, -25.66, b, 8.2, -24.34, 'plain'); }
    { const [a, b] = nx(8.52, 9.08); box(a, 0.5, -25.63, b, 0.6, -24.37, 'plain'); box(a, 8.02, -25.63, b, 8.1, -24.37, 'gold'); }
  }

  // 大螢幕牆與舞台
  box(-7.6, 1.85, -58, 7.6, 10.45, -57.95, 'black');
  // 金框比黑色背板外擴 5cm，四邊互不共面
  box(-7.65, 1.8, -57.99, 7.65, 2.1, -57.85, 'gold'); box(-7.65, 10.2, -57.99, 7.65, 10.5, -57.85, 'gold');
  box(-7.65, 2.1, -57.99, -7.3, 10.2, -57.85, 'gold'); box(7.3, 2.1, -57.99, 7.65, 10.2, -57.85, 'gold');
  // 螢幕上方的石雕橫楣：下線腳、素面飾帶、齒飾、上簷。安靜的建築裝飾，把螢幕框進牆面
  {
    const EZ = -57.99;
    box(-7.95, 10.78, EZ, 7.95, 10.9, -57.74, 'plain'); box(-7.88, 10.9, EZ, 7.88, 10.98, -57.8, 'gold');
    box(-7.8, 10.98, EZ, 7.8, 12.06, -57.86, 'plain');
    for (let i = -25; i <= 25; i++) box(i * 0.3 - 0.085, 12.06, EZ, i * 0.3 + 0.085, 12.2, -57.79, 'plain');
    box(-7.86, 12.06, EZ, 7.86, 12.2, -57.845, 'plain');
    box(-7.98, 12.2, EZ, 7.98, 12.3, -57.7, 'plain'); box(-8.06, 12.3, EZ, 8.06, 12.38, -57.64, 'plain');
    for (const sg of [-1, 1]) { // 兩端的小托座
      box(sg * 7.62 - 0.16, 10.5, EZ, sg * 7.62 + 0.16, 10.78, -57.8, 'plain');
    }
  }
  box(-7.5, 0, -58, 7.5, 0.45, -55.5, 'clothDark');
  box(-7.54, 0.3, -55.56, 7.54, 0.36, -55.46, 'ledPurple');
  floors.push({ x0: -7.5, x1: 7.5, z0: -58, z1: -55.5, y: 0.45 });
  // 拱頂端的山花拱
  B.add(new THREE.TubeGeometry(new (class extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const [x, y] = vaultPt(Math.PI * t, 0.62); return o.set(x, y + 0.08, -57.96); } })(), 64, 0.11, 6, false), 'gold');
  // 螢幕光（面光源，照亮整個大廳）
  const ral = new THREE.RectAreaLight(0x9fb6ff, 3.2, SCREEN.w, SCREEN.h);
  ral.position.set(0, SCREEN.y, -57.6); ral.lookAt(0, SCREEN.y, 0); scene.add(ral);

  // 牆面與地面的沉浸式投影（動態）：關燈時才投影，開燈時淡出、露出後面的石牆與地板
  const proj = projectionMaterial();
  const rugMat = rugMaterial();
  anim.push((t) => { proj.uniforms.uTime.value = t; rugMat.uniforms.uTime.value = t; });
  const projMeshes = [];
  for (const s of [-1, 1]) {
    const x = s * 13.93;
    const lo = new THREE.Mesh(new THREE.PlaneGeometry(51, 6.3), proj); lo.position.set(x, 3.45, -32.25); lo.rotation.y = -s * Math.PI / 2; scene.add(lo);
    const hi = new THREE.Mesh(new THREE.PlaneGeometry(51, 6.4), proj); hi.position.set(x, 10.2, -32.25); hi.rotation.y = -s * Math.PI / 2; scene.add(hi);
    const end = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 12.8), proj); end.position.set(s * 11.1, 6.8, -57.93); scene.add(end);
    projMeshes.push(lo, hi, end);
  }
  // 地毯都以柱距（7m）為準：側廊兩塊各在一個柱距正中央，中央長毯對齊長桌
  const rugs = [[0, -16.6, 5, 4], [-11.1, -35.5, 3.6, 5.6], [11.1, -35.5, 3.6, 5.6], [-11.1, -49.5, 3.6, 5.6], [11.1, -49.5, 3.6, 5.6], [0, -35.5, 5.2, 16]];
  for (const [x, z, w, d] of rugs) { const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), rugMat); r.rotation.x = -Math.PI / 2; r.position.set(x, 0.02, z); scene.add(r); projMeshes.push(r); }
  onLights((e) => {
    // 開燈時也保留牆面花卉投影與地面光毯（使用者偏好原本的牆面），只有略為柔和
    proj.uniforms.uMix.value = lerp(1, 0.94, e); rugMat.uniforms.uMix.value = lerp(1, 0.85, e);
    for (const o of projMeshes) o.visible = true;
  });
  // 開燈時看得到的側牆分格：每個開間上下各一個石膏線框（比投影面退後，關燈時被投影蓋住）
  {
    const bays = [[-10.4, -6.6], ...PIER_Z.slice(0, -1).map((z) => [z - 6.4, z - 0.6]), [-57.9, -53.6]];
    for (const s of [-1, 1]) for (const [za, zb] of bays) {
      const xw = (d) => (s > 0 ? [14 - d, 14.02] : [-14.02, -14 + d]);
      const frame = (ya, yb, m) => {
        const [x0, x1] = xw(0.045), z0 = za + m, z1 = zb - m, t = 0.13;
        box(x0, ya, z0, x1, ya + t, z1, 'plain'); box(x0, yb - t, z0, x1, yb, z1, 'plain');
        box(x0, ya + t, z0, x1, yb - t, z0 + t, 'plain'); box(x0, ya + t, z1 - t, x1, yb - t, z1, 'plain');
      };
      frame(8.5, 12.7, 0.55);
      if (zb < -25.5) frame(1.3, 5.9, 0.55); // 樓梯段的下層牆面被樓梯擋住，不放
    }
  }

  // 家具：中央花台、宴會長桌、面向螢幕的座椅
  centerpiece(scene, 0, -21.5); // 第一個天窗正下方
  for (const s of [-1, 1]) banquet(scene, s * 4.6, -27, -44);
  // 螢幕前的觀賽席：左右各 6 張、中間留 1.3m 走道（對齊中軸與長毯），4 排置中於最後一個柱距
  for (let r = 0; r < 4; r++) for (const s of [-1, 1]) for (let i = 0; i < 6; i++) chair(s * (0.9 + i * 0.95), 0, -47.4 - r * 1.4, 0, true);
  // 二樓迴廊：兩排椅子沿著欄杆排列，面向中間大廳（左側朝右、右側朝左）
  // 往後退並做成兩階的觀賽席，坐下時視線能越過欄杆
  for (const s of [-1, 1]) {
    const T1 = [9.6, 11.4], T2 = [11.4, 13.55];
    box(Math.min(s * T1[0], s * T1[1]), 7.0, -53.7, Math.max(s * T1[0], s * T1[1]), 7.42, -26.2, 'marble');
    box(Math.min(s * T2[0], s * 14.02), 7.0, -53.7, Math.max(s * T2[0], s * 14.02), 7.84, -26.2, 'marble'); // 一路接到側牆，不在壁柱之間留溝
    // 兩階前緣的金色收邊條（比階面凸出 4cm，兩端也多出 4cm）
    for (const [tx, ty] of [[T1[0], 7.42], [T2[0], 7.84]]) box(Math.min(s * (tx - 0.04), s * (tx + 0.05)), ty - 0.09, -53.74, Math.max(s * (tx - 0.04), s * (tx + 0.05)), ty + 0.04, -26.16, 'gold');
    floors.push({ x0: Math.min(s * T1[0], s * T1[1]), x1: Math.max(s * T1[0], s * T1[1]), z0: -53.7, z1: -26.2, y: 7.42 });
    floors.push({ x0: Math.min(s * T2[0], s * 14), x1: Math.max(s * T2[0], s * 14), z0: -53.7, z1: -26.2, y: 7.84 });
    for (const [tx, ty] of [[T1[0], 7.42], [T2[0], 7.84]]) floors.push({ x0: Math.min(s * (tx - 0.04), s * (tx + 0.05)), x1: Math.max(s * (tx - 0.04), s * (tx + 0.05)), z0: -53.74, z1: -26.16, y: ty + 0.04 });
    // 第二階比迴廊地面高 0.84m，跨不上去：兩端（z 方向）的立面要擋住，但從第一階（高 0.42m）仍可以直接踏上去
    // st：可跨上的高度；腳高於 y1 - st 時不擋（踏上去），否則擋住
    walls.push({ x0: Math.min(s * T2[0], s * 14), x1: Math.max(s * T2[0], s * 14), z0: -53.7, z1: -26.2, y0: 7.0, y1: 7.84, st: 0.55 });
    for (let k = 0; k < 24; k++) { // 24 張、間距 1.1m，前後各留 1.1m
      const z = -27.3 - k * 1.1;
      chair(s * 10.55, 7.42, z, s * Math.PI / 2, true);
      chair(s * 12.6, 7.84, z, s * Math.PI / 2, true);
    }
  }
  // 側廊的雞尾酒桌
  for (const s of [-1, 1]) for (const z of [-28.5, -42.5]) cocktail(scene, s * 11.1, z); // 二樓下方的側廊，各在柱距正中央、與地毯交錯

  // 室內燈光：同一組光源，在「開燈」與「關燈」兩組顏色／強度之間過渡（不增減光源數量，shader 不必重編）
  //   開燈：均勻明亮的暖白場燈，石材呈象牙白
  //   關燈：場燈全暗，只剩桌上燭光的暖色、燈架上的冷藍點光，大螢幕與牆面投影是最亮的東西
  const lamps = [];
  const L = (x, y, z, d, off, on) => { const l = new THREE.PointLight(off[0], off[1], d, 2); l.position.set(x, y, z); scene.add(l); lamps.push({ l, off, on }); return l; };
  L(0, 9, -17, 34, [0xffb070, 55], [0xfff0d6, 130]);
  L(0, 10, -34, 34, [0x8f84ff, 55], [0xfff0d6, 150]);
  L(0, 9, -50, 34, [0x7f8cff, 45], [0xfff0d6, 120]);
  L(0, 15.4, -35, 30, [0x5f9cff, 60], [0xfff4e2, 150]);   // 燈架上的冷藍光／開燈時的天花洗牆光
  L(-11, 4.5, -36, 22, [0xff9a58, 40], [0xffecd0, 60]); L(11, 4.5, -36, 22, [0xff9a58, 40], [0xffecd0, 60]);
  L(0, 2.3, -35.5, 17, [0xff9440, 75], [0xffc890, 0]);    // 長桌上的燭光（只在關燈時）
  // 簷口上的舞台燈具：關燈時是冷藍色的點光，開燈時只剩很淡的暖光
  for (const z of PIER_Z) for (const s of [-1, 1]) {
    box(Math.min(s * 6.36, s * 6.6), 13.7, z - 0.12, Math.max(s * 6.36, s * 6.6), 13.9, z + 0.12, 'dark');
    glow(scene, s * 6.3, 13.82, z, 1.5, 0xffcfa0, 0.22, 'rig');
  }
  onLights((e) => {
    for (const { l, off, on } of lamps) { mixColor(l.color, off[0], on[0], e); l.intensity = lerp(off[1], on[1], e); }
    ral.intensity = lerp(3.4, 2.4, e);
    for (const g of GLOWS.candle) g.m.opacity = g.o * lerp(1, 0.5, e);
    for (const g of GLOWS.rig) { mixColor(g.m.color, 0x4d9dff, 0xffd8a8, e); g.m.opacity = lerp(0.75, 0.1, e); }
  });
}

function vaultMesh() {
  const segA = 72, segZ = 2, { z0, z1 } = VAULT;
  const P = []; for (let i = 0; i <= segA; i++) P.push(vaultPt(Math.PI * i / segA));
  const pos = [], uv = [], nor = [], idx = [];
  for (let j = 0; j <= segZ; j++) {
    const z = z0 + (z1 - z0) * j / segZ;
    for (let i = 0; i <= segA; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(segA, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty);
      pos.push(P[i][0], P[i][1], z); uv.push(i / segA, j / segZ); nor.push(-ty / l, tx / l, 0); // 法線朝室內
    }
  }
  for (let j = 0; j < segZ; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, MATS.plaster.mat); m.matrixAutoUpdate = false;
  return m;
}
// 沿拱頂斷面的弧長取樣：回傳 [{a, x, y, s}]，off 為往室內的偏移
function vaultArc(off, n = 240) {
  const out = []; let s = 0, px, py;
  for (let i = 0; i <= n; i++) { const a = Math.PI * i / n; const [x, y] = vaultPt(a, off); if (i) s += Math.hypot(x - px, y - py); out.push({ a, x, y, s }); px = x; py = y; }
  return out;
}
// 簷口上方、拱頂兩側各一排玫瑰花藻井（每個 7m 柱距 6 格，格線對齊拱肋），貼在拱面內側 3cm
function vaultCofferBands() {
  const arc = vaultArc(0.03), W = 7 / 6, { z0, z1 } = VAULT, out = [];
  const pts = arc.filter((p) => p.s <= W); const last = arc[pts.length]; // 補上剛好一格寬的端點
  if (last) { const p0 = pts[pts.length - 1], k = (W - p0.s) / (last.s - p0.s); pts.push({ x: lerp(p0.x, last.x, k), y: lerp(p0.y, last.y, k), s: W }); }
  const step = Math.max(1, Math.floor(pts.length / 10)); const sel = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  for (const sg of [-1, 1]) {
    const pos = [], uv = [], nor = [], idx = [];
    sel.forEach((p, i) => {
      const q = sel[Math.min(sel.length - 1, i + 1)], r = sel[Math.max(0, i - 1)]; const tx = q.x - r.x, ty = q.y - r.y, l = Math.hypot(tx, ty);
      for (const z of [z0, z1]) { pos.push(sg * p.x, p.y, z); uv.push(p.s / W * 0.5, (z + 11) / (7 / 3)); nor.push(sg * -ty / l, tx / l, 0); }
    });
    for (let i = 0; i < sel.length - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; sg > 0 ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    out.push(g);
    // 藻井帶上緣的金線
    const top = sel[sel.length - 1]; const bar = new THREE.BoxGeometry(0.07, 0.07, z0 - z1 - 1.2); place(bar, { x: sg * (top.x - 0.02), y: top.y, z: (z0 + z1) / 2 }); B.add(bar, 'gold');
  }
  return out;
}

// 拱肋：矩形斷面、貼著拱頂的肋帶（halfW：半寬，depth：凸出拱面的深度）；coffer：底面貼一排玫瑰花藻井（自帶 UV）
function ribGeometry(z, halfW, depth, coffer) {
  const N = 56, pos = [], uv = [], side = [];
  const arc = vaultArc(depth, N), total = arc[N].s, cells = Math.max(1, Math.round(total / (halfW * 2)));
  const P = (i, off, dz) => { const [x, y] = vaultPt(Math.PI * i / N, off); return [x, y, z + dz]; };
  const quad = (list, a, b, c, d) => list.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < N; i++) {
    quad(pos, P(i, depth, halfW), P(i + 1, depth, halfW), P(i + 1, depth, -halfW), P(i, depth, -halfW)); // 底面
    const u0 = arc[i].s / total * cells * 0.5, u1 = arc[i + 1].s / total * cells * 0.5;
    uv.push(u0, 0, u1, 0, u1, 0.5, u0, 0, u1, 0.5, u0, 0.5);
    quad(side, P(i, -0.1, halfW), P(i + 1, -0.1, halfW), P(i + 1, depth, halfW), P(i, depth, halfW)); // +z 側
    quad(side, P(i, depth, -halfW), P(i + 1, depth, -halfW), P(i + 1, -0.1, -halfW), P(i, -0.1, -halfW)); // -z 側
  }
  const soffit = new THREE.BufferGeometry(); soffit.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (coffer) soffit.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); soffit.computeVertexNormals();
  const sides = new THREE.BufferGeometry(); sides.setAttribute('position', new THREE.Float32BufferAttribute(side, 3)); sides.computeVertexNormals();
  return { soffit, sides };
}
// 朝下的橢圓環（內 a0×b0、外 a1×b1），UV 沿圓周重複 rep 次（貼花邊用）
function ellipseRing(a0, b0, a1, b1, y, z, n, rep) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    pos.push(a0 * c, y, z + b0 * sn, a1 * c, y, z + b1 * sn); uv.push(k / n * rep, 0.04, k / n * rep, 0.96); nor.push(0, -1, 0, 0, -1, 0);
  }
  for (let k = 0; k < n; k++) { const a = k * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
// 朝下的藻井天花（自訂 UV：nx 格寬、每 7m 柱距 6 格，格線對齊方柱）
function cofferPlane(x0, x1, z0, z1, y, nx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3));
  const v = (z) => (z + 11) / (7 / 3);
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v(z0), nx / 2, v(z0), nx / 2, v(z1), 0, v(z1)], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// 石欄杆（瓶形欄杆柱）
let balGeo;
function baluster() {
  if (!balGeo) {
    const pts = [[0.07, 0], [0.07, 0.06], [0.05, 0.1], [0.06, 0.16], [0.1, 0.3], [0.09, 0.42], [0.05, 0.52], [0.04, 0.58], [0.07, 0.62], [0.07, 0.7]].map(([x, y]) => new THREE.Vector2(x, y));
    balGeo = new THREE.LatheGeometry(pts, 8);
  }
  return balGeo.clone();
}
function balustrade(axis, fixed, a, b, y, cx, between = false, m0 = between ? 0.27 : 0.36, m1 = m0) {
  // axis 'x'：沿 x 從 a 到 b，位於 z=fixed；'z'：沿 z 從 a 到 b，位於 x=fixed
  const len = b - a; const th = 0.3;
  // 欄杆柱等距排列（約 0.3m 一支），兩端留一樣的空隙
  // m0／m1：第一支、最後一支離兩端的距離（端柱或方柱旁要多留一點，才不會插進柱子裡）
  const n = Math.max(1, Math.round((len - m0 - m1) / 0.3)), step = (len - m0 - m1) / n;
  const at = (k) => a + m0 + k * step;
  if (axis === 'x') {
    box(a, y, fixed - th / 2, b, y + 0.14, fixed + th / 2, 'plain');
    box(a, y + 0.84, fixed - th / 2 - 0.03, b, y + 1.0, fixed + th / 2 + 0.03, 'plain');
    for (let k = 0; k <= n; k++) B.add(place(baluster(), { x: at(k), y: y + 0.14, z: fixed }), 'plain');
    walls.push({ x0: a, x1: b, z0: fixed - 0.2, z1: fixed + 0.2, y0: y - 0.4, y1: y + 3 });
  } else {
    box(fixed - th / 2, y, a, fixed + th / 2, y + 0.14, b, 'plain');
    box(fixed - th / 2 - 0.03, y + 0.84, a, fixed + th / 2 + 0.03, y + 1.0, b, 'plain');
    for (let k = 0; k <= n; k++) B.add(place(baluster(), { x: fixed, y: y + 0.14, z: at(k) }), 'plain');
    if (!between) { // 端柱：比扶手高一點、寬一點，四面都不與欄杆共面
      const np = Math.max(1, Math.round(len / 4));
      for (let k = 0; k <= np; k++) { const z = a + len * k / np; box(fixed - 0.21, y, z - 0.21, fixed + 0.21, y + 1.06, z + 0.21, 'plain'); box(fixed - 0.25, y + 1.06, z - 0.25, fixed + 0.25, y + 1.12, z + 0.25, 'plain'); }
    }
    walls.push({ x0: fixed - 0.2, x1: fixed + 0.2, z0: a, z1: b, y0: y - 0.4, y1: y + 3 });
  }
}
function slopedParapet(x0, x1, z0, z1, y0, y1) {
  // 從 (z0,y0) 到 (z1,y1) 的實心石扶手牆
  const g = new THREE.BoxGeometry(x1 - x0, 1, z1 - z0, 1, 1, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const lz = p.getZ(i) / (z1 - z0) + 0.5; const ly = p.getY(i) + 0.5;
    const base = y0 + (y1 - y0) * lz;
    p.setY(i, ly > 0.5 ? base + 1.05 : 0);
    p.setX(i, p.getX(i) + (x0 + x1) / 2); p.setZ(i, p.getZ(i) + (z0 + z1) / 2);
  }
  g.computeVertexNormals();
  B.add(g, 'plain');
  const cap = new THREE.BoxGeometry(x1 - x0 + 0.08, 0.1, Math.hypot(z1 - z0, y1 - y0));
  place(cap, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 1.1, z: (z0 + z1) / 2, rx: Math.atan2(y1 - y0, z1 - z0) * -1 });
  B.add(cap, 'gold');
  walls.push({ x0, x1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0: -1, y1: Math.max(y0, y1) + 3 });
}

// 椅子：金色 Chiavari 宴會椅（車製椅腳、微彎靠背、直櫺、象牙白坐墊）
// 幾何只建一次、之後每張椅子複製後擺位；每張約 390 個三角形
let chairTpl;
function chairTemplate() {
  if (chairTpl) return chairTpl;
  const cane = [], cush = [];
  const add = (g, list = cane) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); list.push(n); };
  // 兩點之間的圓桿
  const rod = (ax, ay, az, bx, by, bz, r0, r1, seg = 4) => {
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); add(g);
  };
  const SH = 0.4;          // 座框頂面高度
  const W = 0.2;           // 椅腳中心到中線的距離
  const ZF = -0.2, ZB = 0.25; // 前、後椅腳的位置（+z 是椅背）
  // 靠背柱在高度 y 的 z 位置（往後微彎）
  const backZ = (y) => ZB + 0.11 * Math.pow((y - SH) / 0.54, 1.4);
  for (const sx of [-1, 1]) {
    // 前腳：上粗下細的車製腳
    rod(sx * W, 0, ZF, sx * W, SH - 0.01, ZF, 0.015, 0.024, 6);
    // 後腳 + 靠背柱：一根連續的軍刀形彎腳
    const pts = [new THREE.Vector3(sx * W, 0, ZB + 0.05), new THREE.Vector3(sx * W, 0.2, ZB + 0.012), new THREE.Vector3(sx * W, SH, ZB), new THREE.Vector3(sx * W, 0.7, backZ(0.7)), new THREE.Vector3(sx * W, 0.945, backZ(0.945))];
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, 0.0185, 5, false));
    // 柱頂小圓球
    const fin = new THREE.IcosahedronGeometry(0.027, 0); fin.translate(sx * W, 0.955, backZ(0.955)); add(fin);
    // 側橫撐
    rod(sx * W, 0.17, ZF, sx * W, 0.2, ZB + 0.012, 0.011, 0.011);
  }
  rod(-W, 0.24, ZF, W, 0.24, ZF, 0.011, 0.011);
  rod(-W, 0.15, ZB + 0.022, W, 0.15, ZB + 0.022, 0.011, 0.011);
  // 座框與坐墊
  const frame = new THREE.BoxGeometry(0.45, 0.04, 0.51); frame.translate(0, SH - 0.02, 0.025); add(frame);
  const cu = new RoundedBoxGeometry(0.42, 0.055, 0.45, 2, 0.026); cu.translate(0, SH + 0.02, 0.0); add(cu, cush);
  // 靠背：三道往後微彎的橫桿，下兩道之間五支直櫺
  const rail = (y, r, bow) => {
    const zc = backZ(y);
    const cv = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-W, y, zc), new THREE.Vector3(0, y, zc + bow * 2), new THREE.Vector3(W, y, zc));
    add(new THREE.TubeGeometry(cv, 4, r, 4, false));
  };
  rail(0.925, 0.017, 0.035); rail(0.855, 0.012, 0.035); rail(0.66, 0.012, 0.035);
  for (let k = -2; k <= 2; k++) {
    const lx = k * 0.066, f = 1 - (lx / W) * (lx / W);
    rod(lx, 0.66, backZ(0.66) + 0.035 * f, lx, 0.855, backZ(0.855) + 0.035 * f, 0.008, 0.008);
  }
  chairTpl = { cane: mergeGeometries(cane, false), cushion: mergeGeometries(cush, false) };
  return chairTpl;
}
function chair(x, y, z, ry, seat = true) {
  const t = chairTemplate();
  B.add(place(t.cane.clone(), { x, y, z, ry }), 'cane');
  B.add(place(t.cushion.clone(), { x, y, z, ry }), 'cushion');
  // 面向：ry=0 時椅背在 +z 側，坐著面向 -z
  if (seat) seats.push({ x, y: y + 0.5, z, ry: ry + Math.PI });
  // 椅子的碰撞方塊：約椅腳範圍（寬 0.38、深 0.45，比椅面略小，排與排之間才走得過去），高度高於跳躍高度，避免跳上去後落進椅子裡
  const c = Math.cos(ry), sn = Math.sin(ry); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.26], [0.19, 0.26]]) {
    const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
  }
  walls.push({ x0, x1, z0, z1, y0: y, y1: y + 1.6, chair: true });
}

function banquet(scene, x, z0, z1) {
  const w = 1.1;
  box(x - w / 2, 0.72, z1, x + w / 2, 0.77, z0, 'cloth');
  box(x - w / 2 + 0.04, 0.0, z1 + 0.04, x + w / 2 - 0.04, 0.72, z0 - 0.04, 'cloth');
  box(x - 0.22, 0.66, z1 - 0.03, x + 0.22, 0.8, z0 + 0.03, 'clothDark'); // 桌旗：比桌面高 3cm，兩端垂下
  walls.push({ x0: x - w / 2, x1: x + w / 2, z0: z1, z1: z0, y0: 0, y1: 1.6 });
  // 椅子等距排列，兩端留一樣的空位
  const len = z0 - z1, n = Math.floor(len), m = (len - (n - 1)) / 2;
  for (let k = 0; k < n; k++) { const z = z0 - m - k; chair(x - 0.98, 0, z, -Math.PI / 2); chair(x + 0.98, 0, z, Math.PI / 2); }
  // 桌上擺設：每 2m 一組燭台，中間夾一盆花，前後對稱
  const sets = Math.floor((len - 1) / 2), m2 = (len - (sets - 1) * 2) / 2;
  for (let k = 0; k < sets; k++) {
    const z = z0 - m2 - k * 2;
    cyl(0.07, 0.09, 0.03, x, 0.8, z, 'gold', 10); cyl(0.018, 0.03, 0.2, x, 0.83, z, 'gold', 6); cyl(0.05, 0.03, 0.02, x, 1.03, z, 'gold', 8);
    cyl(0.025, 0.025, 0.14, x, 1.05, z, 'candle', 8);
    cyl(0.03, 0.03, 0.1, x - 0.11, 0.8, z + 0.13, 'candle', 8);
    cyl(0.03, 0.03, 0.07, x + 0.11, 0.8, z - 0.13, 'candle', 8);
    glow(scene, x, 1.2, z, 0.7, 0xffb060, 0.7, 'candle');
    if (k === sets - 1) break;
    const zf = z - 1;
    cyl(0.1, 0.07, 0.07, x, 0.8, zf, 'gold', 10);
    for (let j = 0; j < 7; j++) { const a = j * 0.9; const rr = j ? 0.09 : 0; const f = new THREE.IcosahedronGeometry(0.06 + (j % 3) * 0.012, 0); place(f, { x: x + Math.cos(a) * rr, y: 0.93 + (j ? 0 : 0.05) + (j % 2) * 0.02, z: zf + Math.sin(a) * rr }); B.add(f, j % 2 ? 'flower' : 'flower2'); }
    const lv = new THREE.IcosahedronGeometry(0.13, 0); place(lv, { x, y: 0.88, z: zf, sy: 0.45 }); B.add(lv, 'leaf');
  }
}
function centerpiece(scene, x, z) {
  cyl(1.25, 1.25, 0.08, x, 0.85, z, 'black', 40);
  cyl(0.5, 0.9, 0.85, x, 0, z, 'black', 32);
  const ring = new THREE.TorusGeometry(1.25, 0.03, 6, 48); place(ring, { x, y: 0.93, z, rx: Math.PI / 2 }); B.add(ring, 'gold');
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2; const h = 0.15 + (k % 3) * 0.12;
    cyl(0.04, 0.04, h, x + Math.cos(a) * 0.95, 0.93, z + Math.sin(a) * 0.95, 'candle', 8);
    glow(scene, x + Math.cos(a) * 0.95, 0.93 + h + 0.06, z + Math.sin(a) * 0.95, 0.45, 0xffb060, 0.8, 'candle');
  }
  for (let k = 0; k < 18; k++) { const f = new THREE.IcosahedronGeometry(0.14, 0); place(f, { x: x + Math.cos(k * 2.4) * 0.35 * (k % 3) / 2, y: 1.05 + (k % 4) * 0.08, z: z + Math.sin(k * 2.4) * 0.35 * (k % 3) / 2 }); B.add(f, k % 3 ? 'flower' : 'flower2'); }
  const lv = new THREE.IcosahedronGeometry(0.45, 1); place(lv, { x, y: 1.0, z, sy: 0.45 }); B.add(lv, 'leaf');
  walls.push({ x0: x - 1.25, x1: x + 1.25, z0: z - 1.25, z1: z + 1.25, y0: 0, y1: 1.6 });
}
function cocktail(scene, x, z) {
  cyl(0.4, 0.4, 0.04, x, 1.05, z, 'cloth', 24); cyl(0.405, 0.43, 0.16, x, 0.9, z, 'cloth', 24, { open: true }); // 桌面與垂下的桌巾邊
  cyl(0.035, 0.05, 1.03, x, 0.03, z, 'gold', 8); cyl(0.2, 0.3, 0.035, x, 0, z, 'gold', 20); cyl(0.07, 0.035, 0.05, x, 1.0, z, 'gold', 8);
  cyl(0.045, 0.055, 0.02, x, 1.09, z, 'gold', 8); cyl(0.03, 0.03, 0.12, x, 1.11, z, 'candle', 8); glow(scene, x, 1.3, z, 0.5, 0xffb060, 0.8, 'candle');
  walls.push({ x0: x - 0.42, x1: x + 0.42, z0: z - 0.42, z1: z + 0.42, y0: 0, y1: 1.6 });
}

// 沉浸式投影：程序化彩繪玻璃花卉（像附圖第二張）
function projectionMaterial() {
  // 細緻的第凡內風格彩繪玻璃花卉：小玻璃格、細鉛條、多朵花與藤蔓，緩慢呼吸變化
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMix: { value: 1 } }, transparent: true,
    vertexShader: `varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);} `,
    fragmentShader: `uniform float uTime, uMix; varying vec3 vW;
      vec2 h2(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
      float h1(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      vec3 voro(vec2 p){ vec2 ip=floor(p), fp=fract(p); float d1=8., d2=8.; vec2 cid=vec2(0);
        for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j); vec2 o=0.5+0.42*sin(6.2831*h2(ip+g)); vec2 r=g+o-fp; float d=dot(r,r); if(d<d1){d2=d1;d1=d;cid=ip+g;} else if(d<d2){d2=d;} }
        return vec3(sqrt(d2)-sqrt(d1), cid); }
      float flower(vec2 q, vec2 c, float R, float n, float rot){ vec2 d=q-c; float r=length(d); float a=atan(d.y,d.x)+rot;
        float pr = R*(0.62+0.38*abs(cos(a*n*0.5))); return smoothstep(0.04,0.0, r-pr); }
      void main(){
        float t = uTime*0.12;
        vec2 q = vec2(vW.z + vW.x, vW.y);
        vec3 v = voro(q*2.4);
        float lead = smoothstep(0.015,0.07, v.x);
        float hc = h1(v.yz);
        // 背景：上方天空藍到下方葉綠
        vec3 sky = mix(vec3(0.28,0.46,0.72), vec3(0.55,0.72,0.86), hc);
        vec3 leaf = mix(vec3(0.16,0.42,0.22), vec3(0.42,0.62,0.30), hc);
        float hy = smoothstep(2.0,8.0, vW.y + sin(q.x*0.35+t)*1.2);
        vec3 col = mix(leaf, sky, hy);
        // 藤蔓
        float vine = smoothstep(0.18,0.0, abs(vW.y - 3.0 - sin(q.x*0.45)*1.6));
        col = mix(col, vec3(0.20,0.50,0.22), vine);
        // 重複排列的花朵（大小交錯）
        vec2 cell = vec2(floor((q.x+2.0)/7.0), 0.0);
        float fx = cell.x*7.0 + 1.5 + sin(cell.x*3.1)*1.2;
        float fy = 4.2 + sin(cell.x*1.7)*1.5 + (vW.y>7.0 ? 6.5 : 0.0);
        float rot = t*0.6 + cell.x;
        float f1 = flower(q, vec2(fx, fy), 1.5, 10.0, rot);
        float f1c = flower(q, vec2(fx, fy), 0.55, 6.0, -rot);
        float f2 = flower(q, vec2(fx+3.5, fy-1.6+sin(cell.x)*0.8), 0.9, 8.0, -rot*0.7);
        vec3 petalA = mix(vec3(0.98,0.80,0.36), vec3(1.0,0.93,0.70), hc);
        vec3 petalB = mix(vec3(0.88,0.36,0.46), vec3(0.98,0.62,0.62), hc);
        col = mix(col, petalA, f1);
        col = mix(col, vec3(0.86,0.45,0.15), f1c);
        col = mix(col, petalB, f2);
        // 光線緩慢掃過
        float sweep = 0.75 + 0.25*sin(q.x*0.12 - uTime*0.25);
        col *= (0.28 + 0.72*lead) * sweep;
        gl_FragColor = vec4(col*1.0, uMix);
        #include <colorspace_fragment>
      }`,
  });
}
function rugMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMix: { value: 1 } }, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);} `,
    fragmentShader: `uniform float uTime, uMix; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec2 u = vUv; float b = min(min(u.x,1.-u.x), min(u.y,1.-u.y));
        vec3 col = vec3(0.12,0.10,0.42);
        vec2 g = floor(vW.xz*6.0); float s = step(0.985, h(g)) * (0.5+0.5*sin(uTime*2.0 + h(g+3.0)*40.0));
        col += vec3(1.0,0.9,0.7)*s;
        float pattern = 0.5+0.5*sin(length(u-0.5)*40.0 - uTime*0.8);
        col += vec3(0.25,0.1,0.35)*pattern*0.3;
        float border = smoothstep(0.035,0.03,b) + smoothstep(0.075,0.07,b)*smoothstep(0.06,0.065,b);
        col = mix(col, vec3(1.0,0.8,0.4), clamp(border,0.,1.));
        float alpha = 0.85*smoothstep(0.0,0.01,b);
        gl_FragColor = vec4(col, alpha * uMix);
        #include <colorspace_fragment>
      }`,
  });
}

export function setScene(s) { scene_ = s; }
