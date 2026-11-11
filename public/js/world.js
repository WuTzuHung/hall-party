// 光之殿堂（Hall des Lumières，原 Emigrant Industrial Savings Bank，紐約 49 Chambers St）程序化 3D 場景
// 座標：單位公尺。x 東西向（街道方向），z>0 為街道，z<0 為建築內部，大螢幕在 z=-58
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';

export const SCREEN = { x: 0, y: 6.14, z: -57.9, w: 14, h: 7.875 };
export const HALL = { x0: -14, x1: 14, z0: -58, z1: -6 };
export const SPAWN = { x: 0, z: 6.5, ry: Math.PI };

const PIER_Z = [-11, -18, -25, -32, -39, -46, -53];
const VAULT = { r: 6.8, spring: 13.6, rise: 4, z0: -6, z1: -58 };

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
  const floor = T.marble({ size: 1024, base: [178, 168, 152], vein: [110, 96, 80], scale: 4, seedN: 12, tiles: 4, alt: { base: [74, 58, 54], vein: [130, 104, 88] } });
  const coffer = T.coffers({ n: 2 });
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
    cane: { mat: std({ color: 0xc9a46a, roughness: 0.5, metalness: 0.35 }) },
    cushion: { mat: std({ color: 0xf1e6d2, roughness: 0.95 }) },
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
}

// ---------- 主程式 ----------
export function buildWorld(scene, renderer, q) {
  makeMaterials(q);
  scene_ = scene;
  B = new Batch();
  const anim = []; // 每幀更新的東西
  const tex = {};

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
  return { walls, floors, seats, camBlock, anim };
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
  box(-160, -0.2, 8, 160, 0, 22, 'asphalt');
  box(-160, -0.2, 0, 160, 0.15, 8, 'pavers');
  box(-160, -0.2, 22, 160, 0.15, 30, 'pavers');
  box(-160, -0.2, 7.82, 160, 0.16, 8.0, 'curb');
  box(-160, -0.2, 22, 160, 0.16, 22.18, 'curb');
  floors.push({ x0: -160, x1: 160, z0: 0, z1: 8, y: 0.15 });
  floors.push({ x0: -160, x1: 160, z0: 22, z1: 30, y: 0.15 });
  // 邊界
  solidOnly(-160, -1, 29.5, 160, 50, 30.5); solidOnly(-61, -1, -2, -59, 50, 32); solidOnly(59, -1, -2, 61, 50, 32);
  // 道路標線
  for (let x = -150; x < 150; x += 6) box(x, 0, 14.92, x + 3, 0.012, 15.08, 'paint');
  box(-160, 0, 9.9, 160, 0.012, 10.02, 'paint');
  for (let i = 0; i < 8; i++) { box(-46 + i * 0.9, 0, 8.3, -45.4 + i * 0.9, 0.012, 21.7, 'paint'); box(45 + i * 0.9, 0, 8.3, 45.6 + i * 0.9, 0.012, 21.7, 'paint'); }

  // 街燈
  const lampPos = [[-20, 7.3], [20, 7.3], [-44, 7.3], [44, 7.3], [-30, 22.6], [0, 22.6], [30, 22.6]];
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
  const sl1 = new THREE.PointLight(0xffc98a, 60, 26, 2); sl1.position.set(-20, 6, 6.2); scene.add(sl1);
  const sl2 = new THREE.PointLight(0xffc98a, 60, 26, 2); sl2.position.set(20, 6, 6.2); scene.add(sl2);

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
  cyl(0.3, 0.26, 0.95, 9.5, 0.15, 7.1, 'green', 12);
  walls.push({ x0: -9.25, x1: -8.75, z0: 6.95, z1: 7.45, y0: 0, y1: 1 }, { x0: 9.15, x1: 9.85, z0: 6.75, z1: 7.45, y0: 0, y1: 1 });
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
  mesh.position.set((x0 + x1) / 2, h / 2, z + 0.02); scene_.add(mesh);
  box(x0, 0, z - 40, x1, h, z, 'curb', true);
  box(x0, 0, z, x1, 3.6, z + 0.25, 'dark');
  box(x0, h - 0.6, z, x1, h, z + 0.6, 'plain');
}
function neighborAcross(x0, x1, h, color, i) {
  const t = T.cityFacade({ seedN: 50 + i, brick: color, cols: Math.round((x1 - x0) / 4), floors: Math.round(h / 3.6) });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, h), m);
  mesh.position.set((x0 + x1) / 2, h / 2, 29.98); mesh.rotation.y = Math.PI; scene_.add(mesh);
  box(x0, 0, 30, x1, h, 50, 'curb');
  // 一樓店面
  box(x0 + 0.5, 0.15, 29.7, x1 - 0.5, 3.8, 29.95, 'dark');
  const shop = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 2, 2.6), new THREE.MeshBasicMaterial({ color: [0xffd9a8, 0xa8d8ff, 0xffb0d0, 0xfff0c0, 0xc0ffd8][i] }));
  shop.position.set((x0 + x1) / 2, 1.8, 29.68); shop.rotation.y = Math.PI; scene_.add(shop);
  box(x0, h - 0.8, 29.4, x1, h, 30, 'plain');
}
let scene_;

// 加法混合光暈
const glowTex = () => (glowTex.t ||= T.radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
function glow(scene, x, y, z, size, color, opacity = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.position.set(x, y, z); s.scale.set(size, size, 1); scene.add(s); return s;
}

// ---------- 外觀立面 ----------
function buildFacade(scene, anim, q) {
  const BAYS = [-18, -12, -6, 0, 6, 12, 18];
  const COLS = [-21, -15, -9, -3, 3, 9, 15, 21];
  // 花崗岩基座
  box(-30.3, 0, -0.2, -2.7, 0.7, 0.35, 'granite'); box(2.7, 0, -0.2, 30.3, 0.7, 0.35, 'granite');
  walls.push({ x0: -30.5, x1: -1.5, z0: -1.5, z1: 0.35, y0: -1, y1: 50 });
  walls.push({ x0: 1.5, x1: 30.5, z0: -1.5, z1: 0.35, y0: -1, y1: 50 });
  camBlock.push({ x0: -30.5, x1: -1.5, z0: -1.5, z1: 0.0, y0: 0, y1: 48 }, { x0: 1.5, x1: 30.5, z0: -1.5, z1: 0.0, y0: 0, y1: 48 }, { x0: -1.5, x1: 1.5, z0: -1.5, z1: 0, y0: 4.6, y1: 48 });

  // 窗間牆（柱後）
  const pierZones = [[-22.2, -19.8], ...BAYS.slice(0, -1).map(c => [c + 1.8, c + 4.2]), [19.8, 22.2]];
  for (const [a, b] of pierZones) { box(a, 0.7, -1.5, b, 3.0, 0, 'rustic'); box(a, 3.0, -1.5, b, 13.8, 0, 'stone'); }

  const winTex = T.bigWindow({ lit: 0.55 }); const winTexC = T.bigWindow({ lit: 0.8, rows: 4 });
  const winMat = new THREE.MeshStandardMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.5 });
  const winMatC = new THREE.MeshStandardMaterial({ map: winTexC, emissive: 0xffffff, emissiveMap: winTexC, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.5 });
  const posterMats = [0, 1].map(i => { const t = T.poster(i); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, roughness: 0.7 }); });

  for (const cx of BAYS) {
    const center = cx === 0;
    const wy0 = center ? 6.5 : 4.4;
    if (!center) box(cx - 1.8, 0.7, -1.5, cx + 1.8, wy0, 0, 'rustic');
    box(cx - 1.8, 12.6, -1.5, cx + 1.8, 13.8, 0, 'stone');
    // 窗台與窗楣
    box(cx - 2.0, wy0 - 0.22, -0.4, cx + 2.0, wy0, 0.28, 'plain');
    box(cx - 2.0, 12.6, -0.4, cx + 2.0, 12.8, 0.12, 'plain');
    // 玻璃
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 12.6 - wy0), center ? winMatC : winMat);
    win.position.set(cx, (12.6 + wy0) / 2, -0.45); scene.add(win);
    // 窗框直櫺
    for (const dx of [-1.2, 1.2]) box(cx + dx - 0.07, wy0, -0.5, cx + dx + 0.07, 12.6, -0.36, 'green');
    for (let y = wy0 + 1.6; y < 12.4; y += 1.6) box(cx - 1.8, y - 0.05, -0.5, cx + 1.8, y + 0.05, -0.36, 'green');
    if (!center) {
      // 窗下雕飾板與花環
      box(cx - 1.5, 3.25, 0, cx + 1.5, 4.0, 0.08, 'plain');
      const garland = new THREE.TorusGeometry(0.9, 0.07, 6, 20, Math.PI); place(garland, { x: cx, y: 3.95, z: 0.1, rz: Math.PI, sy: 0.4 }); B.add(garland, 'plain');
      // 海報（附圖中的黃色布條，改為 TL × GEN 冠軍派對）
      if (Math.abs(cx) === 12) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), posterMats[cx > 0 ? 1 : 0]);
        p.position.set(cx, 8.6, -0.3); scene.add(p);
        const p2 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), posterMats[cx > 0 ? 0 : 1]);
        p2.scale.set(1, 1, 1); p2.position.set(cx, 1.85, 0.04); scene.add(p2);
        box(cx - 0.85, 1.3, 0, cx + 0.85, 1.35, 0.08, 'dark'); box(cx - 0.85, 2.36, 0, cx + 0.85, 2.41, 0.08, 'dark');
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
    box(c - 0.8, 13.2, -0.15, c + 0.8, 13.45, 1.45, 'plain');
    for (const s of [-1, 1]) {
      const vol = new THREE.CylinderGeometry(0.21, 0.21, 1.5, 16); place(vol, { x: c + s * 0.66, y: 13.0, z: 0.65, rx: Math.PI / 2 }); B.add(vol, 'plain');
      const sp = new THREE.TorusGeometry(0.13, 0.04, 6, 16); place(sp, { x: c + s * 0.66, y: 13.0, z: 1.41 }); B.add(sp, 'plain');
    }
    camBlock.push({ x0: c - 0.6, x1: c + 0.6, z0: 0.1, z1: 1.2, y0: 0, y1: 13.8 });
    walls.push({ x0: c - 0.6, x1: c + 0.6, z0: 0, z1: 1.25, y0: 0, y1: 14 });
  }

  // 中央大門
  box(-1.8, 0.7, -1.5, -1.5, 6.5, 0, 'rustic'); box(1.5, 0.7, -1.5, 1.8, 6.5, 0, 'rustic');
  box(-1.5, 4.6, -1.5, 1.5, 6.5, 0, 'rustic');
  box(-1.5, 0.7, -1.5, 1.5, 1.2, 0, 'granite');
  // 門框雕飾
  box(-2.15, 1.2, 0, -1.5, 4.9, 0.42, 'plain'); box(1.5, 1.2, 0, 2.15, 4.9, 0.42, 'plain');
  box(-2.35, 4.6, -0.05, 2.35, 5.05, 0.55, 'plain');
  box(-2.5, 5.05, -0.05, 2.5, 5.2, 0.62, 'plain');
  const arch = new THREE.TorusGeometry(1.9, 0.16, 8, 32, Math.PI); place(arch, { x: 0, y: 5.2, z: 0.35, sy: 0.55 }); B.add(arch, 'plain');
  box(-2.0, 5.2, -0.05, 2.0, 5.95, 0.2, 'plain');
  box(-0.28, 5.1, 0.1, 0.28, 6.25, 0.55, 'plain'); // 拱心石
  const shield = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 24); place(shield, { x: 0, y: 5.6, z: 0.62, rx: Math.PI / 2, sx: 0.8, sz: 1.15 }); B.add(shield, 'plain');
  const signT = T.textTexture('HALL DES LUMIÈRES', { w: 1024, h: 96, color: '#3c3226', font: '700 62px "Cinzel", serif', letter: 10 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.4), new THREE.MeshStandardMaterial({ map: signT, transparent: true, roughness: 0.8 }));
  sign.position.set(0, 4.83, 0.56); scene.add(sign);
  // 打開的銅門
  box(-1.5, 1.2, -1.4, -1.42, 4.55, -0.12, 'bronze'); box(1.42, 1.2, -1.4, 1.5, 4.55, -0.12, 'bronze');
  // 門口台階（紫色地毯）
  for (let i = 0; i < 5; i++) {
    const y = 0.15 + (i + 1) * 0.21, z1 = 1.9 - i * 0.38;
    box(-2.7, 0, 0, 2.7, y, z1, 'granite');
    box(-1.4, y, 0, 1.4, y + 0.015, z1, 'carpet');
  }
  floors.push({ x0: -2.7, x1: 2.7, z0: 0, z1: 1.95, ya: 1.2, yb: 0.15 });
  floors.push({ x0: -1.5, x1: 1.5, z0: -1.6, z1: 0, y: 1.2 });
  box(-1.4, 0.15, 1.9, 1.4, 0.165, 6.6, 'carpet');
  // 紅絨柱繩
  for (const s of [-1, 1]) for (let z = 2.4; z <= 6.4; z += 2) {
    cyl(0.05, 0.05, 0.95, s * 1.75, 0.15, z, 'gold', 8); cyl(0.17, 0.17, 0.04, s * 1.75, 0.15, z, 'gold', 12);
    const top = new THREE.SphereGeometry(0.07, 8, 6); place(top, { x: s * 1.75, y: 1.12, z }); B.add(top, 'gold');
  }
  for (const s of [-1, 1]) {
    const rope = new THREE.TorusGeometry(1, 0.03, 5, 16, Math.PI); place(rope, { x: s * 1.75, y: 1.05, z: 4.4, ry: Math.PI / 2, rz: Math.PI, sy: 0.25, sx: 2, sz: 1 }); B.add(rope, 'carMaroon');
    walls.push({ x0: s * 1.75 - 0.08, x1: s * 1.75 + 0.08, z0: 2.3, z1: 6.5, y0: 0, y1: 1.2 });
  }
  // 門邊燈籠
  for (const s of [-1, 1]) {
    box(s * 2.55 - 0.06, 3.3, 0, s * 2.55 + 0.06, 3.5, 0.5, 'bronze');
    const l = new THREE.CylinderGeometry(0.16, 0.12, 0.5, 8); place(l, { x: s * 2.55, y: 3.65, z: 0.55 }); B.add(l, 'lampGlow');
    glow(scene, s * 2.55, 3.9, 0.6, 1.6, 0xffd090, 0.6);
  }
  // 「免費入場」看板
  const aT = T.textTexture([{ t: 'TL × GEN', font: '800 120px "Cinzel", serif', y: 110 }, { t: '冠軍賽觀賽派對', font: '700 90px "Noto Sans TC", sans-serif', y: 240 }, { t: 'FREE ENTRY 免費入場', font: '700 64px "Noto Sans TC", sans-serif', y: 360, color: '#f2c14e' }], { w: 800, h: 440, bg: '#1b1530', color: '#f3ead6', letter: 4 });
  const aMat = new THREE.MeshStandardMaterial({ map: aT, emissive: 0xffffff, emissiveMap: aT, emissiveIntensity: 0.5 });
  for (const s of [-1, 1]) {
    const pnl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), aMat); pnl.position.set(4.2, 1.1, 2.6 + s * 0.18); pnl.rotation.set(s * -0.28, s > 0 ? 0 : Math.PI, 0); scene.add(pnl);
  }
  box(3.62, 0.15, 2.4, 3.66, 1.45, 2.8, 'bronze'); box(4.74, 0.15, 2.4, 4.78, 1.45, 2.8, 'bronze');
  walls.push({ x0: 3.6, x1: 4.8, z0: 2.2, z1: 3.0, y0: 0, y1: 1.5 });

  // 兩側凸出翼樓
  for (const s of [-1, 1]) {
    const a = s < 0 ? -30 : 22.2, b = s < 0 ? -22.2 : 30;
    box(a, 0.7, -1.5, b, 13.8, 0.35, 'rustic');
    const dx = s * 26.1;
    box(dx - 1.3, 0.15, 0.36, dx + 1.3, 3.6, 0.4, 'dark');
    box(dx - 1.6, 0.15, 0.35, dx - 1.3, 4.0, 0.6, 'plain'); box(dx + 1.3, 0.15, 0.35, dx + 1.6, 4.0, 0.6, 'plain');
    box(dx - 1.75, 3.6, 0.35, dx + 1.75, 4.25, 0.7, 'plain');
    if (s > 0) box(dx - 1.7, 3.7, 0.35, dx + 1.7, 3.84, 2.4, 'dark');
    const w = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6.2), winMat); w.position.set(dx, 8.4, 0.37); scene.add(w);
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
  const friezeT = T.textTexture('EMIGRANT  ·  INDUSTRIAL  ·  SAVINGS  ·  BANK', { w: 2048, h: 128, color: '#7a6a52', font: '600 82px "Cinzel", serif', letter: 22 });
  const frieze = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.6), new THREE.MeshStandardMaterial({ map: friezeT, transparent: true, roughness: 0.9 }));
  frieze.position.set(0, 15.05, 1.33); scene.add(frieze);
  for (const x of [-24.5, -16, 16, 24.5]) { const md = new THREE.CylinderGeometry(0.32, 0.32, 0.1, 20); place(md, { x, y: 15.05, z: 1.35, rx: Math.PI / 2 }); B.add(md, 'plain'); }

  // 上層樓
  const upT = T.upperFacade({ floors: 9, cols: 10 });
  const upMat = new THREE.MeshStandardMaterial({ map: upT, roughness: 0.88, emissive: 0xffffff, emissiveMap: upT, emissiveIntensity: 0.12 });
  const up = new THREE.Mesh(new THREE.PlaneGeometry(60, 31.8), upMat); up.position.set(0, 16.2 + 15.9, 0.01); scene.add(up);
  box(-30, 16.2, -1.5, 30, 48, 0, 'stone');
  for (const y of [23.25, 37.4]) box(-30.2, y, -0.3, 30.2, y + 0.35, 0.45, 'plain');
  box(-30.6, 47.4, -0.3, 30.6, 48.0, 1.2, 'plain'); box(-30.9, 48.0, -0.3, 30.9, 48.5, 1.6, 'plain');
  box(-30, 48.5, -40, 30, 49.6, 0.2, 'stone');
  // 上層角落的方石
  for (const s of [-1, 1]) for (let y = 16.2; y < 47.4; y += 1.3) box(s > 0 ? 28.6 : -30.05, y, -0.2, s > 0 ? 30.05 : -28.6, y + 1.1, 0.15, 'plain');
  // 側面與後方（從街道角度可見）
  box(-30.5, 0, -60, -30, 49.6, -1.5, 'stone'); box(30, 0, -60, 30.5, 49.6, -1.5, 'stone');

  // 中央徽章雕飾（盾徽 + 兩側斜倚人像）
  const sh = new THREE.CylinderGeometry(1.25, 1.25, 0.4, 40); place(sh, { x: 0, y: 18.6, z: 0.5, rx: Math.PI / 2, sz: 1.35 }); B.add(sh, 'plain');
  const shr = new THREE.TorusGeometry(1.25, 0.14, 8, 40); place(shr, { x: 0, y: 18.6, z: 0.72, sy: 1.35 }); B.add(shr, 'plain');
  const crown = new THREE.CylinderGeometry(0.5, 0.75, 0.6, 16); place(crown, { x: 0, y: 20.6, z: 0.4 }); B.add(crown, 'plain');
  for (const s of [-1, 1]) {
    const scroll = new THREE.TorusGeometry(0.5, 0.15, 8, 20, Math.PI * 1.5); place(scroll, { x: s * 1.55, y: 17.2, z: 0.55, rz: s < 0 ? 0 : Math.PI / 2 }); B.add(scroll, 'plain');
    // 人像（抽象化雕塑）
    const torso = new THREE.CapsuleGeometry(0.35, 1.1, 6, 12); place(torso, { x: s * 2.5, y: 17.0, z: 0.7, rz: s * 1.15 }); B.add(torso, 'plain');
    const head = new THREE.SphereGeometry(0.3, 14, 10); place(head, { x: s * 2.05, y: 17.75, z: 0.75 }); B.add(head, 'plain');
    const leg = new THREE.CapsuleGeometry(0.28, 1.4, 6, 12); place(leg, { x: s * 3.4, y: 16.55, z: 0.8, rz: s * 1.45 }); B.add(leg, 'plain');
    const arm = new THREE.CapsuleGeometry(0.14, 0.8, 4, 8); place(arm, { x: s * 1.75, y: 17.4, z: 0.95, rz: s * -0.6 }); B.add(arm, 'plain');
  }
  box(-4.4, 16.2, -0.3, 4.4, 16.5, 1.3, 'plain');

  // 旗幟
  const flagT = T.flag();
  const flagMat = new THREE.MeshStandardMaterial({ map: flagT, side: THREE.DoubleSide, roughness: 0.85 });
  for (const s of [-1, 1]) {
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
  box(-2.8, 6.0, -6, 2.8, 6.3, -1.5, 'coffer');
  const vlamp = new THREE.SphereGeometry(0.35, 16, 12); place(vlamp, { x: 0, y: 5.4, z: -3.75 }); B.add(vlamp, 'lampGlow');
  cyl(0.02, 0.02, 0.6, 0, 5.4, -3.75, 'gold', 6);
  glow(scene, 0, 5.4, -3.75, 2.2, 0xffd9a0, 0.5);

  // 地板
  box(-14, -0.3, -58, 14, 0, -6, 'floor');
  floors.push({ x0: -14, x1: 14, z0: -58, z1: -6, y: 0 });

  // 南牆（入口那面）
  box(-14.6, 0, -6.5, -2.5, 17.8, -6, 'marbleWall', true);
  box(2.5, 0, -6.5, 14.6, 17.8, -6, 'marbleWall', true);
  box(-2.5, 6.0, -6.5, 2.5, 17.8, -6, 'marbleWall', true);
  box(-3.0, 1.2, -6.65, -2.5, 6.4, -6.4, 'plain'); box(2.5, 1.2, -6.65, 3.0, 6.4, -6.4, 'plain'); box(-3.1, 6.0, -6.7, 3.1, 6.6, -6.4, 'plain');
  // 北牆與側牆
  box(-14.6, 0, -58.6, 14.6, 17.8, -58, 'marbleWall', true);
  box(-14.6, 0, -58, -14, 17.8, -6, 'marbleWall', true);
  box(14, 0, -58, 14.6, 17.8, -6, 'marbleWall', true);
  // 踢腳線
  box(-14, 0, -58, -13.9, 0.3, -6, 'dark'); box(13.9, 0, -58, 14, 0.3, -6, 'dark');

  // 入口平台與往下的大階梯
  box(-7, 0, -10, 7, 1.2, -6.5, 'marble', true);
  floors.push({ x0: -7, x1: 7, z0: -10, z1: -6.0, y: 1.2 });
  for (let i = 0; i < 8; i++) {
    const y = 1.2 - (i + 1) * 0.15; const z0 = -10 - (i + 1) * 0.375;
    box(-4, 0, z0, 4, y, -10, 'marble');
  }
  floors.push({ x0: -4, x1: 4, z0: -13, z1: -10, ya: 0, yb: 1.2 });
  solidOnly(-4, 1.2 - 0.5, -10.2, 4, 1.25, -10); // 防止從平台前緣以下穿入
  // 欄杆
  balustrade('x', -10, -7, -4.3, 1.2); balustrade('x', -10, 4.3, 7, 1.2);
  balustrade('z', -7.2, -10, -6.5, 1.2, -7.2); balustrade('z', 7.0, -10, -6.5, 1.2, 7.0);
  for (const s of [-1, 1]) {
    slopedParapet(s > 0 ? 4 : -4.3, s > 0 ? 4.3 : -4, -13.1, -10, 0, 1.2);
    // 大型端柱
    box(s * 4.15 - 0.3, 0, -13.5, s * 4.15 + 0.3, 1.3, -12.9, 'marble', true);
    const urn = new THREE.SphereGeometry(0.26, 16, 12); place(urn, { x: s * 4.15, y: 1.55, z: -13.2 }); B.add(urn, 'gold');
    box(s * 4.15 - 0.36, 1.3, -13.56, s * 4.15 + 0.36, 1.38, -12.84, 'plain');
  }

  // 方柱（大理石）
  for (const z of PIER_Z) for (const s of [-1, 1]) {
    const x = s * 7.5;
    box(x - 0.85, 0, z - 0.85, x + 0.85, 0.65, z + 0.85, 'granite', true);
    box(x - 0.7, 0.65, z - 0.7, x + 0.7, 12.4, z + 0.7, 'marble', true);
    box(x - 0.8, 0.65, z - 0.8, x + 0.8, 0.8, z + 0.8, 'plain');
    box(x - 0.82, 6.6, z - 0.82, x + 0.82, 7.0, z + 0.82, 'plain');
    box(x - 0.86, 11.9, z - 0.86, x + 0.86, 12.4, z + 0.86, 'plain');
    box(x - 0.75, 11.6, z - 0.75, x + 0.75, 11.66, z + 0.75, 'gold');
    // 牆上壁柱
    box(s > 0 ? 13.55 : -14, 0, z - 0.6, s > 0 ? 14 : -13.55, 13.6, z + 0.6, 'marble', true);
  }
  // 中殿上方的簷部
  for (const s of [-1, 1]) {
    const xi = s * 6.6, xo = s * 8.4;
    box(Math.min(xi, xo), 12.4, -58, Math.max(xi, xo), 13.6, -6.5, 'plain');
    box(Math.min(s * 6.3, s * 6.6), 13.2, -58, Math.max(s * 6.3, s * 6.6), 13.65, -6.5, 'plain');
    box(Math.min(s * 6.55, s * 6.6), 12.75, -58, Math.max(s * 6.55, s * 6.6), 12.9, -6.5, 'gold');
    for (let z = -57.8; z < -6.6; z += 0.32) box(Math.min(s * 6.42, s * 6.6), 13.02, z, Math.max(s * 6.42, s * 6.6), 13.2, z + 0.16, 'plain');
    // 夾層樓面帶
    box(Math.min(s * 6.7, s * 8.4), 6.6, -58, Math.max(s * 6.7, s * 8.4), 7.0, -6.5, 'plain');
    box(Math.min(s * 6.68, s * 6.72), 6.72, -58, Math.max(s * 6.68, s * 6.72), 6.86, -6.5, 'gold');
  }

  // 筒形拱頂（藻井）
  scene.add(vaultMesh());
  // 拱肋
  for (const z of [...PIER_Z, -6.6, -57.4]) {
    const curve = new (class extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const a = Math.PI * t; return o.set(6.55 * Math.cos(a), VAULT.spring + (VAULT.rise - 0.15) * Math.sin(a), z); } })();
    B.add(new THREE.TubeGeometry(curve, 48, 0.3, 8, false), 'plain');
    const c2 = new (class extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const a = Math.PI * t; return o.set(6.3 * Math.cos(a), VAULT.spring + (VAULT.rise - 0.4) * Math.sin(a), z); } })();
    B.add(new THREE.TubeGeometry(c2, 48, 0.07, 6, false), 'gold');
  }
  // 三個橢圓彩繪玻璃天窗
  [-21.5, -35.5, -49.5].forEach((z, i) => {
    const t = T.stainedGlass(q.high ? 1024 : 640, i);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ map: t, color: 0xffffff }));
    glass.rotation.x = Math.PI / 2; glass.scale.set(2.7, 3.2, 1); glass.position.set(0, 17.22, z); scene.add(glass);
    const ring = new THREE.TorusGeometry(1, 0.06, 8, 72); place(ring, { x: 0, y: 17.18, z, rx: Math.PI / 2, sx: 2.75, sy: 3.25 }); B.add(ring, 'gold');
    const ring2 = new THREE.TorusGeometry(1, 0.1, 8, 72); place(ring2, { x: 0, y: 17.12, z, rx: Math.PI / 2, sx: 3.05, sy: 3.55 }); B.add(ring2, 'plain');
    const ring3 = new THREE.TorusGeometry(1, 0.05, 6, 72); place(ring3, { x: 0, y: 17.05, z, rx: Math.PI / 2, sx: 3.3, sy: 3.8 }); B.add(ring3, 'gold');
    const collar = new THREE.CylinderGeometry(1, 1, 0.5, 72, 1, true); place(collar, { x: 0, y: 17.45, z, sx: 2.72, sz: 3.22 }); B.add(collar, 'coffer');
    // 蛋形裝飾
    for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; const e = new THREE.SphereGeometry(0.09, 6, 4); place(e, { x: Math.cos(a) * 3.18, y: 17.08, z: z + Math.sin(a) * 3.68 }); B.add(e, 'gold'); }
    // 光束（體積光感）
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.6, 16, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.scale.z = 1.15; beam.position.set(0, 9, z); scene.add(beam);
  });

  // 側廊天花
  for (const s of [-1, 1]) box(Math.min(s * 8.4, s * 14), 13.6, -58, Math.max(s * 8.4, s * 14), 13.95, -6.5, 'coffer');
  // 夾層（二樓迴廊）與通往夾層的樓梯
  for (const s of [-1, 1]) {
    const xa = s > 0 ? 8.2 : -14, xb = s > 0 ? 14 : -8.2;
    box(xa, 6.6, -58, xb, 7.0, -25, 'marble');
    floors.push({ x0: xa, x1: xb, z0: -58, z1: -25, y: 7 });
    box(xa, 6.45, -25.1, xb, 6.6, -25, 'gold');
    // 樓梯 40 階
    const sx0 = s > 0 ? 9 : -14, sx1 = s > 0 ? 14 : -9;
    for (let i = 0; i < 40; i++) {
      const y = (i + 1) * 0.175; const z1 = -13 - i * 0.3, z0 = z1 - 0.3;
      box(sx0, Math.max(0, y - 0.6), z0, sx1, y, z1, 'marble');
    }
    floors.push({ x0: sx0, x1: sx1, z0: -25, z1: -13, ya: 7, yb: 0 });
    slopedParapet(s > 0 ? 8.75 : -9.0, s > 0 ? 9.0 : -8.75, -25, -13, 7, 0);
    solidOnly(sx0, -0.5, -25.4, sx1, 6.3, -25.0); // 樓梯下方
    solidOnly(Math.min(s * 8.2, s * 9), -0.5, -25.6, Math.max(s * 8.2, s * 9), 6.6, -13);
    // 夾層欄杆
    balustrade('z', s * 8.35, -58, -25.6, 7, s * 8.35);
    balustrade('x', -25.15, Math.min(s * 8.2, s * 8.75), Math.max(s * 8.2, s * 8.75), 7);
  }

  // 大螢幕牆與舞台
  box(-7.6, 1.85, -58, 7.6, 10.45, -57.95, 'black');
  box(-7.55, 1.85, -57.98, 7.55, 2.1, -57.85, 'gold'); box(-7.55, 10.2, -57.98, 7.55, 10.45, -57.85, 'gold');
  box(-7.55, 2.1, -57.98, -7.3, 10.2, -57.85, 'gold'); box(7.3, 2.1, -57.98, 7.55, 10.2, -57.85, 'gold');
  box(-7.5, 0, -58, 7.5, 0.45, -55.5, 'clothDark');
  box(-7.5, 0.3, -55.52, 7.5, 0.36, -55.48, 'ledPurple');
  floors.push({ x0: -7.5, x1: 7.5, z0: -58, z1: -55.5, y: 0.45 });
  // 拱頂端的山花拱
  const tymp = new THREE.TorusGeometry(6.4, 0.18, 8, 48, Math.PI); place(tymp, { x: 0, y: 13.6, z: -57.9, sy: 0.6 }); B.add(tymp, 'gold');
  // 螢幕光（面光源，照亮整個大廳）
  const ral = new THREE.RectAreaLight(0x9fb6ff, 3.2, SCREEN.w, SCREEN.h);
  ral.position.set(0, SCREEN.y, -57.6); ral.lookAt(0, SCREEN.y, 0); scene.add(ral);

  // 牆面與地面的沉浸式投影（動態）
  const proj = projectionMaterial();
  anim.push((t) => { proj.uniforms.uTime.value = t; rugMat.uniforms.uTime.value = t; });
  for (const s of [-1, 1]) {
    const x = s * 13.98;
    const lo = new THREE.Mesh(new THREE.PlaneGeometry(51, 6.3), proj); lo.position.set(x, 3.45, -32.25); lo.rotation.y = -s * Math.PI / 2; scene.add(lo);
    const hi = new THREE.Mesh(new THREE.PlaneGeometry(51, 6.4), proj); hi.position.set(x, 10.2, -32.25); hi.rotation.y = -s * Math.PI / 2; scene.add(hi);
    const end = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 12.8), proj); end.position.set(s * 11.1, 6.8, -57.97); scene.add(end);
  }
  const rugMat = rugMaterial();
  const rugs = [[0, -16.5, 5, 3.4], [-11.1, -17, 3.6, 7], [11.1, -17, 3.6, 7], [-11.1, -34, 3.6, 9], [11.1, -34, 3.6, 9], [-11.1, -49, 3.6, 9], [11.1, -49, 3.6, 9], [0, -36, 5.2, 16]];
  for (const [x, z, w, d] of rugs) { const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), rugMat); r.rotation.x = -Math.PI / 2; r.position.set(x, 0.012, z); scene.add(r); }

  // 家具：中央花台、宴會長桌、面向螢幕的座椅
  centerpiece(scene, 0, -19.5);
  for (const s of [-1, 1]) banquet(scene, s * 4.6, -27, -44);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 13; i++) {
    const x = -6 + i, z = -47.6 - r * 1.25;
    chair(x, 0, z, 0, true);
  }
  for (const s of [-1, 1]) for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) {
    chair(s * (9.4 + i * 0.95), 7, -49 - r * 1.3, 0, true);
  }
  // 側廊的雞尾酒桌
  for (const s of [-1, 1]) for (const z of [-14, -21]) cocktail(scene, s * 11, z);

  // 室內燈光
  const L = (c, i, x, y, z, d = 34) => { const l = new THREE.PointLight(c, i, d, 2); l.position.set(x, y, z); scene.add(l); return l; };
  L(0xffc58a, 110, 0, 9, -17);
  L(0xc47bff, 150, 0, 10, -34);
  L(0x9d7cff, 110, 0, 9, -50);
  L(0xffd8a0, 90, 0, 15.5, -35, 30);
  L(0xb070ff, 45, -11, 4.5, -36, 22); L(0xff8fc8, 45, 11, 4.5, -36, 22);
  // 柱頭向上打光的光暈
  for (const z of PIER_Z) for (const s of [-1, 1]) glow(scene, s * 6.6, 12.2, z, 2.4, 0xffcfa0, 0.22);
}

function vaultMesh() {
  const segA = 64, segZ = 26, { r, spring, rise, z0, z1 } = VAULT;
  const pos = [], uv = [], nor = [], idx = [];
  const arc = [0];
  for (let i = 1; i <= segA; i++) { const a0 = Math.PI * (i - 1) / segA, a1 = Math.PI * i / segA; arc.push(arc[i - 1] + Math.hypot(r * (Math.cos(a1) - Math.cos(a0)), rise * (Math.sin(a1) - Math.sin(a0)))); }
  for (let j = 0; j <= segZ; j++) {
    const z = z0 + (z1 - z0) * j / segZ;
    for (let i = 0; i <= segA; i++) {
      const a = Math.PI * i / segA; const x = r * Math.cos(a), y = spring + rise * Math.sin(a);
      pos.push(x, y, z); uv.push(arc[i] / 2.4, z / 2.4);
      const n = new THREE.Vector3(-Math.cos(a) / r, -Math.sin(a) / rise, 0).normalize(); nor.push(n.x, n.y, n.z);
    }
  }
  for (let j = 0; j < segZ; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = MATS.coffer.mat.clone(); m.side = THREE.DoubleSide;
  return new THREE.Mesh(g, m);
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
function balustrade(axis, fixed, a, b, y, cx) {
  // axis 'x'：沿 x 從 a 到 b，位於 z=fixed；'z'：沿 z 從 a 到 b，位於 x=fixed
  const len = b - a; const th = 0.3;
  if (axis === 'x') {
    box(a, y, fixed - th / 2, b, y + 0.14, fixed + th / 2, 'plain');
    box(a, y + 0.84, fixed - th / 2 - 0.03, b, y + 1.0, fixed + th / 2 + 0.03, 'plain');
    for (let x = a + 0.2; x < b - 0.1; x += 0.3) B.add(place(baluster(), { x, y: y + 0.14, z: fixed }), 'plain');
    walls.push({ x0: a, x1: b, z0: fixed - 0.2, z1: fixed + 0.2, y0: y - 0.4, y1: y + 3 });
  } else {
    box(fixed - th / 2, y, a, fixed + th / 2, y + 0.14, b, 'plain');
    box(fixed - th / 2 - 0.03, y + 0.84, a, fixed + th / 2 + 0.03, y + 1.0, b, 'plain');
    for (let z = a + 0.2; z < b - 0.1; z += 0.3) B.add(place(baluster(), { x: fixed, y: y + 0.14, z }), 'plain');
    for (let z = a; z <= b; z += 4) box(fixed - 0.2, y, z - 0.2, fixed + 0.2, y + 1.05, z + 0.2, 'plain');
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

// 椅子（金色籐椅，附圖宴會風格）
function chair(x, y, z, ry, seat = true) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
  // 椅腳
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const p = P(lx, lz); cyl(0.022, 0.022, 0.45, p.x, y, p.z, 'cane', 6); }
  const st = new THREE.BoxGeometry(0.46, 0.06, 0.46); place(st, { x, y: y + 0.46, z, ry }); B.add(st, 'cane');
  const cu = new RoundedBoxGeometry(0.42, 0.06, 0.42, 2, 0.03); place(cu, { x, y: y + 0.51, z, ry }); B.add(cu, 'cushion');
  // 椅背（朝向相反於面向）
  const bp = P(0, 0.21);
  for (const lx of [-0.2, 0.2]) { const p = P(lx, 0.21); cyl(0.02, 0.02, 0.5, p.x, y + 0.46, p.z, 'cane', 6); }
  const back = new THREE.TorusGeometry(0.2, 0.025, 6, 16, Math.PI); place(back, { x: bp.x, y: y + 0.92, z: bp.z, ry, sy: 0.6 }); B.add(back, 'cane');
  for (const yy of [0.7, 0.8]) { const r = new THREE.BoxGeometry(0.4, 0.02, 0.02); place(r, { x: bp.x, y: y + yy, z: bp.z, ry }); B.add(r, 'cane'); }
  // 面向：ry=0 面向 +z。 椅背在 +z 側 => 坐著時面向 -z ... 用 face 角度存
  if (seat) seats.push({ x, y: y + 0.5, z, ry: ry + Math.PI });
}

function banquet(scene, x, z0, z1) {
  const w = 1.1;
  box(x - w / 2, 0.73, z1, x + w / 2, 0.77, z0, 'cloth');
  box(x - w / 2 + 0.03, 0.0, z1 + 0.03, x + w / 2 - 0.03, 0.73, z0 - 0.03, 'cloth');
  box(x - 0.22, 0.77, z1, x + 0.22, 0.775, z0, 'clothDark');
  walls.push({ x0: x - w / 2, x1: x + w / 2, z0: z1, z1: z0, y0: 0, y1: 1 });
  for (let z = z0 - 0.55; z > z1; z -= 1.0) {
    chair(x - 0.95, 0, z, -Math.PI / 2); chair(x + 0.95, 0, z, Math.PI / 2);
  }
  for (let z = z0 - 1.2; z > z1; z -= 2.2) {
    // 燭台 + 花
    cyl(0.04, 0.06, 0.06, x, 0.775, z, 'gold', 8);
    cyl(0.03, 0.03, 0.18, x - 0.15, 0.78, z + 0.12, 'candle', 8);
    cyl(0.03, 0.03, 0.12, x + 0.13, 0.78, z - 0.1, 'candle', 8);
    glow(scene, x, 1.02, z, 0.7, 0xffb060, 0.7);
    for (let k = 0; k < 6; k++) { const f = new THREE.IcosahedronGeometry(0.07 + (k % 3) * 0.02, 0); place(f, { x: x + Math.cos(k) * 0.12, y: 0.86 + (k % 2) * 0.05, z: z + 0.55 + Math.sin(k) * 0.12 }); B.add(f, k % 2 ? 'flower' : 'flower2'); }
    const lv = new THREE.IcosahedronGeometry(0.12, 0); place(lv, { x, y: 0.82, z: z + 0.55, sy: 0.5 }); B.add(lv, 'leaf');
  }
}
function centerpiece(scene, x, z) {
  cyl(1.25, 1.25, 0.08, x, 0.85, z, 'black', 40);
  cyl(0.5, 0.9, 0.85, x, 0, z, 'black', 32);
  const ring = new THREE.TorusGeometry(1.25, 0.03, 6, 48); place(ring, { x, y: 0.93, z, rx: Math.PI / 2 }); B.add(ring, 'gold');
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2; const h = 0.15 + (k % 3) * 0.12;
    cyl(0.04, 0.04, h, x + Math.cos(a) * 0.95, 0.93, z + Math.sin(a) * 0.95, 'candle', 8);
    glow(scene, x + Math.cos(a) * 0.95, 0.93 + h + 0.06, z + Math.sin(a) * 0.95, 0.45, 0xffb060, 0.8);
  }
  for (let k = 0; k < 18; k++) { const f = new THREE.IcosahedronGeometry(0.14, 0); place(f, { x: x + Math.cos(k * 2.4) * 0.35 * (k % 3) / 2, y: 1.05 + (k % 4) * 0.08, z: z + Math.sin(k * 2.4) * 0.35 * (k % 3) / 2 }); B.add(f, k % 3 ? 'flower' : 'flower2'); }
  const lv = new THREE.IcosahedronGeometry(0.45, 1); place(lv, { x, y: 1.0, z, sy: 0.45 }); B.add(lv, 'leaf');
  walls.push({ x0: x - 1.25, x1: x + 1.25, z0: z - 1.25, z1: z + 1.25, y0: 0, y1: 1.5 });
}
function cocktail(scene, x, z) {
  cyl(0.4, 0.4, 0.04, x, 1.05, z, 'cloth', 24); cyl(0.05, 0.05, 1.05, x, 0, z, 'gold', 8); cyl(0.3, 0.3, 0.03, x, 0, z, 'gold', 16);
  cyl(0.03, 0.03, 0.12, x, 1.09, z, 'candle', 8); glow(scene, x, 1.28, z, 0.5, 0xffb060, 0.8);
  walls.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4, y0: 0, y1: 1.2 });
}

// 沉浸式投影：程序化彩繪玻璃花卉（像附圖第二張）
function projectionMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);} `,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
      vec2 h2(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
      vec3 pal(float t){ return 0.5+0.5*cos(6.2831*(vec3(0.9,0.7,0.5)*t+vec3(0.0,0.25,0.55))); }
      void main(){
        vec2 p = vec2(vW.z, vW.y) * 0.85 + vec2(uTime*0.05, 0.0);
        // Voronoi 玻璃格
        vec2 ip=floor(p), fp=fract(p); float d1=8., d2=8.; vec2 cid=vec2(0);
        for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j); vec2 o=h2(ip+g); o=0.5+0.4*sin(uTime*0.3+6.2831*o); vec2 r=g+o-fp; float d=dot(r,r); if(d<d1){d2=d1;d1=d;cid=ip+g;} else if(d<d2){d2=d;} }
        float edge = smoothstep(0.0,0.06, sqrt(d2)-sqrt(d1));
        // 大型花朵
        vec2 fc = vec2(vW.z, vW.y);
        float cycle = floor(uTime/20.0);
        vec2 c1 = vec2(-32.0 + sin(uTime*0.07)*14.0, 7.0); float r = length(fc-c1); float a = atan(fc.y-c1.y, fc.x-c1.x);
        float petal = smoothstep(0.3,0.0, abs(r - 4.0 - 1.4*sin(a*7.0+uTime*0.2)) -1.2);
        vec2 c2 = vec2(-20.0 + cos(uTime*0.05)*16.0, 4.0); float r2 = length(fc-c2); float a2 = atan(fc.y-c2.y, fc.x-c2.x);
        float petal2 = smoothstep(0.3,0.0, abs(r2 - 3.0 - 1.0*sin(a2*5.0-uTime*0.3)) -0.9);
        float stem = smoothstep(0.35,0.0, abs(fc.x - c1.x - sin(fc.y*0.4)*1.5)) * step(fc.y, c1.y-3.0);
        float hcell = h2(cid).x;
        vec3 base = mix(vec3(0.10,0.35,0.55), vec3(0.18,0.55,0.25), smoothstep(-0.2,1.2, sin(vW.y*0.3+vW.z*0.08+uTime*0.1)));
        base = mix(base, pal(hcell*0.6+uTime*0.01), 0.35);
        vec3 col = base;
        col = mix(col, mix(vec3(1.0,0.85,0.35), vec3(0.95,0.95,0.8), hcell), petal);
        col = mix(col, mix(vec3(0.95,0.3,0.4), vec3(1.0,0.6,0.5), hcell), petal2);
        col = mix(col, vec3(0.2,0.6,0.25), stem*0.8);
        col *= 0.35 + 0.65*edge;
        float fade = 0.75 + 0.25*sin(uTime*0.15 + cycle);
        col = pow(col, vec3(1.25)); gl_FragColor = vec4(col*fade*0.95, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
function rugMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);} `,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
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
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

export function setScene(s) { scene_ = s; }
