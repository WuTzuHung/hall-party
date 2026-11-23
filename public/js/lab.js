// 第三棟：秋葉原後巷的老樓（一樓映像管電視店，旁邊的窄樓梯通到二樓研究所）
// 位置：殿堂門口的街道一路往東走到底（x 60 以東）。座標單位公尺，z>0 是街道，大樓正面朝街（+z）
// 還原的是空間配置、家具與氛圍；店名、門牌只用一般字體打字，沒有描原作的標誌，也沒有放角色
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as LT from './lab-tex.js';

// ---------- 對外的座標 ----------
export const LAB_EDGE = 61.5; // x 大於這裡就算「研究所區」
const BX = { x0: 66, x1: 76, z0: -11, z1: 0 }; // 大樓外框
const F1 = 0.17, F2 = 3.6, C2 = 6.35, F3 = 6.6, ROOF = 9.6; // 一樓地面、二樓地板、二樓天花板、三樓地板、屋頂
export const LAB_ROOM = { x0: 66.3, x1: 75.7, z0: -10.7, z1: -0.3, y: F2, top: C2 }; // 二樓研究所室內（server.js 的 LAB_ROOM 要一致）
export const LAB_SHOP = { x0: 66.3, x1: 75.7, z0: -7.2, z1: 0, y: F1, top: 3.42 };
const ST = { x0: 64.15, x1: 65.9, zs: -0.7, n: 20, run: 0.27 }; // 樓梯：從街邊往後爬
const ST_TOP = ST.zs - ST.n * ST.run; // -6.1
const LAND = { z0: -8.8, z1: ST_TOP }; // 二樓平台
const DOOR = { z0: -7.95, z1: -7.0, y1: F2 + 2.05 }; // 研究所大門（西牆）
// 研究所的映像管電視（面向 -x，朝沙發）：w、h 是 16:9 影像的大小（在 4:3 的映像管裡上下留黑邊）
export const LABTV = { x: 69.6, y: F2 + 0.5 + 0.33, z: -4.1, w: 0.54, h: 0.304, ry: -Math.PI / 2 };
export const LAB_MAP = { x0: 58, x1: 106, z0: -14, z1: 34 }; // 小地圖範圍
export const inLabRoom = (x, y, z) => x > LAB_ROOM.x0 && x < LAB_ROOM.x1 && z > LAB_ROOM.z0 && z < LAB_ROOM.z1 && y > F2 - 0.6 && y < C2;
export const inLabShop = (x, y, z) => x > LAB_SHOP.x0 && x < LAB_SHOP.x1 && z > LAB_SHOP.z0 && z < LAB_SHOP.z1 && y < 2.5;
export const onLabStairs = (x, z) => x > ST.x0 - 0.1 && x < ST.x1 + 0.1 && z < ST.zs + 0.2 && z > LAND.z0 - 0.1;
export const inLabArea = (x) => x > LAB_EDGE;

let W, scene_;
const LIGHTS = []; // 借用殿堂的點光源：{ x, y, z, d, off:[色, 強度], on:[色, 強度], flick }
const LAB_STD = []; // 研究所的標準材質（關燈時壓暗環境反射）
let CRT = null;
const box = (...a) => W.box(...a);
const add = (g, k) => W.add(g, k);
const P = (g, o) => W.place(g, o);
const solid = (x0, y0, z0, x1, y1, z1, cam = true) => W.solidOnly(x0, y0, z0, x1, y1, z1, cam);
function rbox(w, h, d, x, y, z, key, r = 0.03, ry = 0) { const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)); P(g, { x, y, z, ry }); add(g, key); }
function cyl(rt, rb, h, x, y, z, key, seg = 16, o = {}) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!o.open); P(g, { x, y: y + (o.center ? 0 : h / 2), z, rx: o.rx || 0, rz: o.rz || 0, ry: o.ry || 0 }); add(g, key); }
// 沿著一串點的管子（電線、扶手、香蕉）
function tube(pts, r, key, seg = 24, rs = 5) { add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rs, false), key); }
// 貼在面上的平面（有自己的貼圖）：face 'z+'、'z-'、'x+'、'x-'
function plane(w, h, x, y, z, face, mat, order = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.y = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }[face];
  m.renderOrder = order; scene_.add(m); return m;
}
const decal = (map, o = {}) => W.decal({ map, roughness: 0.8, ...o });
const lit = (map, o = {}) => new THREE.MeshBasicMaterial({ map, toneMapped: false, ...o });

export function buildLab(api, scene, anim, q) {
  W = api; scene_ = scene;
  mats(q);
  alley(scene);
  building(scene);
  stairs(scene);
  shop(scene);
  labRoom(scene);
  rooftop();
  neighbors(scene);
  // 研究所的燈：日光燈管的亮度跟著開關，窗戶外觀也一起變暗
  const M = W.mats;
  let envBase = null;
  W.onLights((e, inside) => {
    if (!W.zone.lab) return;
    M.lbFluor.mat.color.setScalar(0.12 + 0.88 * e);
    M.lbWinLab.mat.color.setScalar(0.18 + 0.82 * e);
    envBase ||= LAB_STD.map((m) => m.envMapIntensity);
    const k = inside > 0.9 ? 0.12 + 0.88 * e : 1; // 只有人在研究所裡時（室外看不出差別）
    LAB_STD.forEach((m, i) => { m.envMapIntensity = envBase[i] * k; });
  });
  anim.push((t) => { if (W.zone.lab && CRT) CRT.update(t); });
  return { lights: LIGHTS, tv: { x: LABTV.x - 0.02, y: LABTV.y, z: LABTV.z, w: 0.6, h: 0.45 } };
}

// ---------- 材質 ----------
function mats(q) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const aniso = q.high ? 8 : 4;
  const tile = LT.mosaic({}), tileD = LT.mosaic({ base: [150, 140, 124], joint: [96, 90, 82], seedN: 12, dirt: 0.25 }), tileG = LT.mosaic({ base: [168, 176, 170], joint: [110, 114, 110], seedN: 13 });
  const conc = LT.concrete({}), concD = LT.concrete({ base: [118, 116, 110], seedN: 23, dirt: 0.35 }), concW = LT.concrete({ base: [176, 172, 160], seedN: 24, dirt: 0.3 });
  const paper = LT.wallpaper(), ceil = LT.ceiling(), floor = LT.linoleum(), sfloor = LT.shopFloor();
  for (const t of [tile, tileD, tileG, conc, concD, concW, paper, ceil, floor, sfloor]) t.anisotropy = aniso;
  CRT = LT.crtScreens();
  W.addMats({
    lbTile: { mat: std({ map: tile, roughness: 0.6, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.06 }), tile: 1 },
    lbTileD: { mat: std({ map: tileD, roughness: 0.65 }), tile: 1 },
    lbTileG: { mat: std({ map: tileG, roughness: 0.6, emissive: 0xffffff, emissiveMap: tileG, emissiveIntensity: 0.05 }), tile: 1 },
    lbConc: { mat: std({ map: conc, roughness: 0.95 }), tile: 3 },
    lbConcD: { mat: std({ map: concD, roughness: 0.95 }), tile: 3 },
    lbConcW: { mat: std({ map: concW, roughness: 0.95, emissive: 0xffffff, emissiveMap: concW, emissiveIntensity: 0.05 }), tile: 3 },
    lbPaper: { mat: std({ map: paper, roughness: 0.95 }), tile: 2.2 },
    lbCeil: { mat: std({ map: ceil, roughness: 0.95 }), tile: 0.91 },
    lbFloor: { mat: std({ map: floor, roughness: 0.62 }), tile: 1.6 },
    lbSFloor: { mat: std({ map: sfloor, roughness: 0.5 }), tile: 3 },
    lbSteel: { mat: std({ color: 0x4b554f, roughness: 0.55, metalness: 0.55 }) },
    lbSteelL: { mat: std({ color: 0x7b817c, roughness: 0.62, metalness: 0.35 }) },
    lbRust: { mat: std({ color: 0x5a3a28, roughness: 0.85, metalness: 0.35 }) },
    lbAlu: { mat: std({ color: 0xb4b8bb, roughness: 0.35, metalness: 0.85 }) },
    lbChrome: { mat: std({ color: 0xdadde0, roughness: 0.18, metalness: 1 }) },
    lbGlass: { mat: std({ color: 0x1a2232, roughness: 0.08, metalness: 0.7 }) },
    lbShutter: { mat: std({ color: 0x8d918f, roughness: 0.5, metalness: 0.6 }) },
    lbSofa: { mat: std({ color: 0x8c7658, roughness: 0.98 }) },
    lbSofaD: { mat: std({ color: 0x6d5a42, roughness: 1 }) },
    lbCRT: { mat: std({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.15 }) },
    lbCRTb: { mat: std({ color: 0xb9b1a0, roughness: 0.55 }) },
    lbCRTg: { mat: std({ color: 0x6e6f72, roughness: 0.5 }) },
    lbCRTw: { mat: std({ color: 0x6b4a30, roughness: 0.6 }) },
    lbScrOff: { mat: std({ color: 0x0b0e0c, roughness: 0.12, metalness: 0.3 }) },
    lbScr0: { mat: lit(CRT.list[0], { color: 0xb8c0b8 }) },
    lbScr1: { mat: lit(CRT.list[1], { color: 0xd0d0d0 }) },
    lbScr2: { mat: lit(CRT.list[2], { color: 0xd0d0d0 }) },
    lbScr3: { mat: lit(CRT.list[3], { color: 0xd0d0d0 }) },
    lbWood: { mat: std({ color: 0x5c3f2a, roughness: 0.7 }) },
    lbWoodL: { mat: std({ color: 0x9a7350, roughness: 0.7 }) },
    lbPly: { mat: std({ color: 0xb89a70, roughness: 0.85 }) },
    lbWhite: { mat: std({ color: 0xe6e4dc, roughness: 0.5 }) },
    lbIvory: { mat: std({ color: 0xd8cfb8, roughness: 0.6 }) },
    lbBlack: { mat: std({ color: 0x141414, roughness: 0.6 }) },
    lbRubber: { mat: std({ color: 0x0c0c0c, roughness: 0.9 }) },
    lbCard: { mat: std({ color: 0xa8804e, roughness: 1 }) },
    lbCardD: { mat: std({ color: 0x8a643a, roughness: 1 }) },
    lbCurtain: { mat: std({ color: 0xb9c4ae, roughness: 1, side: THREE.DoubleSide }) },
    lbCan: { mat: std({ color: 0x6a1420, roughness: 0.3, metalness: 0.7 }) },
    lbBanana: { mat: std({ color: 0xe9c64a, roughness: 0.5 }) },
    lbBananaS: { mat: std({ color: 0x7a7a34, roughness: 0.75 }) },
    lbBananaD: { mat: std({ color: 0x5a4a20, roughness: 0.8 }) },
    lbCup: { mat: std({ color: 0xf0ece2, roughness: 0.6 }) },
    lbRed: { mat: std({ color: 0xb02222, roughness: 0.5 }) },
    lbBlue: { mat: std({ color: 0x2a4a8a, roughness: 0.5 }) },
    lbGreen: { mat: std({ color: 0x3a6a3a, roughness: 0.6 }) },
    lbOrange: { mat: std({ color: 0xd8742a, roughness: 0.6 }) },
    lbPole: { mat: std({ color: 0x8e8c84, roughness: 0.9 }) },
    lbWire: { mat: std({ color: 0x111111, roughness: 0.7 }) },
    lbFluor: { mat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }) },
    lbLamp: { mat: new THREE.MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false }) },
    lbWinLab: { mat: lit(LT.blindsLit(), { color: 0xffffff }) },
    lbWinDark: { mat: std({ map: LT.windowDark(0), roughness: 0.15, metalness: 0.5 }) },
    lbWinWarm: { mat: lit(LT.windowDark(1), { color: 0xc8b8a0 }) },
    lbGlow: { mat: new THREE.MeshBasicMaterial({ color: 0x9fd0ff, toneMapped: false }) },
    lbLed: { mat: new THREE.MeshBasicMaterial({ color: 0x40ff70, toneMapped: false }) },
    lbNight: { mat: lit(LT.nightView(), { color: 0xb0b0c0 }) },
    lbPeg: { mat: std({ map: LT.pegboard(), roughness: 0.9 }) },
    lbCoat: { mat: std({ color: 0xf2f2ee, roughness: 0.9 }) },
  });
  // 關燈時把研究所材質的環境反射也一起壓暗（不然整間房還是亮亮的）
  for (const k of Object.keys(W.mats)) if (k.startsWith('lb') && W.mats[k].mat.isMeshStandardMaterial) LAB_STD.push(W.mats[k].mat);
}

// ---------- 街道東段：秋葉原後巷 ----------
function alley(scene) {
  // 街道到這裡收尾（原本在 x 60 的邊界往東移到 x 100，盡頭是一排橫向建築）
  solid(99.5, -1, -2, 101, 50, 32, false);
  // 電線桿＋橫擔＋變壓器＋路燈，電線拉過街
  const poles = [[63.2, 7.55], [83, 7.55], [97.5, 7.55], [72, 22.45], [90, 22.45]];
  for (const [x, z] of poles) {
    cyl(0.13, 0.19, 10.5, x, 0.15, z, 'lbPole', 10);
    box(x - 0.9, 9.0, z - 0.06, x + 0.9, 9.12, z + 0.06, 'lbSteel'); box(x - 0.7, 9.9, z - 0.05, x + 0.7, 10.0, z + 0.05, 'lbSteel');
    for (const dx of [-0.75, -0.25, 0.25, 0.75]) cyl(0.025, 0.035, 0.12, x + dx, 9.12, z, 'lbWhite', 6);
    if (Math.abs(x - 83) < 1 || Math.abs(x - 72) < 1) { cyl(0.22, 0.22, 0.62, x + (z < 15 ? -0.36 : 0.36), 7.6, z, 'lbSteelL', 12); }
    // 黃黑相間的防撞套
    for (let k = 0; k < 4; k++) cyl(0.2, 0.2, 0.25, x, 0.4 + k * 0.5, z, k % 2 ? 'lbBlack' : 'lbBanana', 10);
    // 路燈（彎臂、往街心照）
    const dir = z < 15 ? 1 : -1;
    tube([[x, 6.2, z], [x, 6.8, z + dir * 0.4], [x, 6.9, z + dir * 1.2]], 0.04, 'lbSteel', 8, 6);
    rbox(0.26, 0.1, 0.5, x, 6.86, z + dir * 1.3, 'lbSteel', 0.03); box(x - 0.1, 6.79, z + dir * 1.3 - 0.2, x + 0.1, 6.81, z + dir * 1.3 + 0.2, 'lbLamp');
    W.glow(scene, x, 6.7, z + dir * 1.3, 2.0, 0xfff2d8, 0.5);
    LIGHTS.push({ x, y: 6.4, z: z + dir * 1.4, d: 18, off: [0xffe8c8, 34], on: [0xffe8c8, 34] });
    W.walls.push({ x0: x - 0.22, x1: x + 0.22, z0: z - 0.22, z1: z + 0.22, y0: 0, y1: 8 });
  }
  // 電線：每對電線桿之間三條、下垂成懸鏈；還有幾條斜拉過街
  const wire = (a, b, sag, y0, y1) => { const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([a[0] + (b[0] - a[0]) * t, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t]); } tube(pts, 0.012, 'lbWire', 16, 4); };
  const N = poles.filter((p) => p[1] < 15), S = poles.filter((p) => p[1] > 15);
  for (let i = 0; i < N.length - 1; i++) for (const [dx, y, s] of [[-0.75, 9.18, 0.5], [0.25, 9.18, 0.55], [0, 9.96, 0.4]]) wire([N[i][0] + dx, N[i][1]], [N[i + 1][0] + dx, N[i + 1][1]], s, y, y);
  wire([63.2, 7.55], [50, 7.55], 0.6, 9.18, 8.4);
  wire([63.2, 7.55], [72, 22.45], 0.9, 9.96, 9.96); wire([83, 7.55], [72, 22.45], 0.9, 9.18, 9.96); wire([83, 7.55], [90, 22.45], 1.0, 9.96, 9.96); wire([97.5, 7.55], [90, 22.45], 0.8, 9.18, 9.18);
  wire([72, 22.45], [90, 22.45], 0.6, 9.18, 9.18);
  // 電線接到研究所大樓屋頂
  wire([63.2, 7.55], [66.5, 0], 0.5, 9.18, 9.9);
  // 自動販賣機兩台（西側窄樓前）
  const vend = [LT.vending(0), LT.vending(1)];
  [[61.0, 0], [62.05, 1]].forEach(([x, v]) => {
    rbox(0.98, 1.84, 0.72, x + 0.49, 0.15 + 0.92, 0.42, v ? 'lbRed' : 'lbWhite', 0.04);
    plane(0.84, 1.62, x + 0.49, 0.15 + 0.96, 0.785, 'z+', lit(vend[v], { color: 0xe8e8e8 }));
    W.walls.push({ x0: x, x1: x + 0.98, z0: 0.05, z1: 0.8, y0: 0, y1: 2.1 });
    W.glow(scene, x + 0.49, 1.4, 0.95, 1.6, 0xd8ecff, 0.35);
  });
  cyl(0.2, 0.18, 0.62, 63.3, 0.15, 0.55, 'lbSteelL', 12); // 回收桶
  cyl(0.06, 0.06, 0.02, 63.3, 0.77, 0.55, 'lbBlack', 8);
  LIGHTS.push({ x: 61.9, y: 1.4, z: 1.6, d: 6, off: [0xcfe4ff, 9], on: [0xcfe4ff, 9] });
  // 路邊的腳踏車（簡化）
  for (const [x, z] of [[78.4, 6.9], [79.3, 6.9]]) {
    for (const dx of [-0.42, 0.42]) { const g = new THREE.TorusGeometry(0.3, 0.025, 6, 20); g.rotateY(Math.PI / 2); P(g, { x, y: 0.47, z: z + dx }); add(g, 'lbRubber'); }
    tube([[x, 0.47, z - 0.42], [x, 0.85, z - 0.05], [x, 0.47, z + 0.42]], 0.02, 'lbSteelL', 8, 5);
    tube([[x, 0.85, z - 0.05], [x, 1.0, z - 0.1]], 0.02, 'lbSteelL', 4, 5);
    tube([[x, 0.47, z + 0.42], [x, 1.02, z + 0.36]], 0.02, 'lbSteelL', 4, 5);
    tube([[x - 0.25, 1.04, z + 0.36], [x + 0.25, 1.04, z + 0.36]], 0.015, 'lbBlack', 2, 5);
    W.walls.push({ x0: x - 0.15, x1: x + 0.15, z0: z - 0.75, z1: z + 0.75, y0: 0, y1: 1.6 });
  }
}

// ---------- 大樓外殼 ----------
function building(scene) {
  const { x0, x1, z0, z1 } = BX, H = ROOF + 0.8;
  // 地基、一樓兩側柱、二樓以上正面
  box(x0, F1 - 0.2, z0, x1, F1, z1, 'lbSFloor');
  box(x0, 0.15, z1 - 0.3, x0 + 0.5, 3.75, z1, 'lbTileD', true);
  box(x1 - 0.5, 0.15, z1 - 0.3, x1, 3.75, z1, 'lbTileD', true);
  // 鐵捲門（捲起來的捲軸盒＋露出一截門片）、店招
  box(x0 + 0.5, 2.86, z1 - 0.28, x1 - 0.5, 3.12, z1 + 0.06, 'lbShutter');
  for (let k = 0; k < 4; k++) box(x0 + 0.5, 2.72 + k * 0.035, z1 - 0.26, x1 - 0.5, 2.745 + k * 0.035, z1 - 0.24, 'lbShutter');
  box(x0 - 0.05, 3.1, z1, x1 + 0.05, 3.78, z1 + 0.32, 'lbSteel');
  const sign = plane(x1 - x0 - 0.2, 0.6, (x0 + x1) / 2, 3.44, z1 + 0.325, 'z+', new THREE.MeshStandardMaterial({ map: LT.shopSign(), roughness: 0.6, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 }));
  sign.material.emissiveMap = sign.material.map; sign.material.emissiveIntensity = 0.55;
  // 招牌上方的燈
  for (const x of [68, 71, 74]) { tube([[x, 3.8, z1 + 0.05], [x, 3.95, z1 + 0.35], [x, 3.92, z1 + 0.55]], 0.015, 'lbSteel', 6, 5); rbox(0.2, 0.06, 0.12, x, 3.9, z1 + 0.56, 'lbSteel', 0.02); box(x - 0.07, 3.865, z1 + 0.51, x + 0.07, 3.87, z1 + 0.6, 'lbLamp'); W.glow(scene, x, 3.7, z1 + 0.6, 1.2, 0xfff0d0, 0.4); }
  // 二樓以上正面：磁磚牆＋窗
  const win = [[67.0, 69.8], [71.6, 74.8]];
  const frontWall = (y0, y1, wy0, wy1, key) => {
    box(x0, y0, z1 - 0.3, win[0][0], y1, z1, key, true);
    box(win[0][1], y0, z1 - 0.3, win[1][0], y1, z1, key, true);
    box(win[1][1], y0, z1 - 0.3, x1, y1, z1, key, true);
    for (const [a, b] of win) { box(a, y0, z1 - 0.3, b, wy0, z1, key, true); box(a, wy1, z1 - 0.3, b, y1, z1, key, true); }
  };
  frontWall(3.78, F3, 4.5, 5.85, 'lbTile');
  frontWall(F3, ROOF, 7.4, 8.75, 'lbTile');
  box(x0 - 0.04, F3 - 0.12, z1 - 0.04, x1 + 0.04, F3 + 0.06, z1 + 0.08, 'lbTileD'); // 樓板線
  // 窗：鋁框、窗台、玻璃（二樓：百葉窗後面亮著日光燈）
  for (const [a, b] of win) for (const [wy0, wy1, k] of [[4.5, 5.85, 'lbWinLab'], [7.4, 8.75, a < 70 ? 'lbWinDark' : 'lbWinWarm']]) {
    box(a, wy0, z1 - 0.2, b, wy1, z1 - 0.16, k);
    box(a, wy0 - 0.02, z1 - 0.22, b, wy0 + 0.04, z1 + 0.1, 'lbAlu'); box(a, wy1 - 0.04, z1 - 0.22, b, wy1, z1 - 0.1, 'lbAlu');
    box(a, wy0, z1 - 0.22, a + 0.05, wy1, z1 - 0.1, 'lbAlu'); box(b - 0.05, wy0, z1 - 0.22, b, wy1, z1 - 0.1, 'lbAlu'); box((a + b) / 2 - 0.025, wy0, z1 - 0.15, (a + b) / 2 + 0.025, wy1, z1 - 0.1, 'lbAlu');
    box(a - 0.06, wy0 - 0.08, z1, b + 0.06, wy0 - 0.02, z1 + 0.14, 'lbConcW');
  }
  // 冷氣室外機（二樓窗下）、雨遮
  rbox(0.8, 0.55, 0.3, 70.6, 4.15, z1 + 0.18, 'lbWhite', 0.02); cyl(0.2, 0.2, 0.01, 70.4, 4.15, z1 + 0.335, 'lbBlack', 18, { rx: Math.PI / 2, center: true });
  box(70.4, 3.85, z1, 70.8, 3.87, z1 + 0.3, 'lbSteel');
  tube([[70.9, 4.3, z1 + 0.05], [71.3, 4.6, z1 + 0.05], [71.35, 4.9, z1 - 0.05]], 0.02, 'lbWhite', 8, 5);
  // 西牆（樓梯那面）：二樓大門開口
  const wx0 = x0, wx1 = x0 + 0.3;
  box(wx0, 0.15, z0, wx1, H - 0.8, DOOR.z0, 'lbConcW', true);
  box(wx0, 0.15, DOOR.z1, wx1, H - 0.8, z1 - 0.3, 'lbConcW', true);
  box(wx0, 0.15, DOOR.z0, wx1, F2, DOOR.z1, 'lbConcW', true);
  box(wx0, DOOR.y1, DOOR.z0, wx1, H - 0.8, DOOR.z1, 'lbConcW', true);
  // 東牆、後牆
  box(x1 - 0.3, 0.15, z0, x1, H - 0.8, z1 - 0.3, 'lbConcW', true);
  box(x0, 0.15, z0, x1, H - 0.8, z0 + 0.3, 'lbConcW', true);
  // 東側立面也貼磁磚（從街上看得到的一小段）
  box(x1, 3.78, z1 - 1.2, x1 + 0.02, ROOF, z1, 'lbTile');
  // 樓板（二樓地板、二樓天花板＝三樓地板、屋頂）
  box(x0 + 0.3, 3.45, z0 + 0.3, x1 - 0.3, F2, z1 - 0.3, 'lbFloor');
  box(x0, 3.42, z1 - 0.3, x1, 3.78, z1, 'lbConcW');
  box(x0 + 0.3, C2, z0 + 0.3, x1 - 0.3, F3, z1 - 0.3, 'lbCeil');
  box(x0, ROOF - 0.25, z0, x1, ROOF, z1, 'lbConc');
  W.floors.push({ x0: LAB_ROOM.x0, x1: LAB_ROOM.x1, z0: LAB_ROOM.z0, z1: LAB_ROOM.z1, y: F2 });
  // 屋頂女兒牆
  box(x0, ROOF, z1 - 0.2, x1, ROOF + 0.85, z1, 'lbTile'); box(x0, ROOF, z0, x1, ROOF + 0.85, z0 + 0.2, 'lbConc');
  box(x0, ROOF, z0, x0 + 0.2, ROOF + 0.85, z1, 'lbConc'); box(x1 - 0.2, ROOF, z0, x1, ROOF + 0.85, z1, 'lbConc');
  box(x0 - 0.03, ROOF + 0.85, z1 - 0.25, x1 + 0.03, ROOF + 0.92, z1 + 0.03, 'lbAlu');
  // 大樓名牌（樓梯口）
  plane(0.42, 0.12, x0 - 0.005, 2.1, -0.45, 'x-', decal(LT.plate('大檜山ビル', { w: 420, h: 120, size: 60, bg: '#d8d2c0', ink: '#3a3226' })));
}

// ---------- 樓梯：鋼骨踏板，從街邊沿著西牆往後爬到二樓 ----------
function stairs(scene) {
  const { x0, x1, zs, n, run } = ST, rise = (F2 - 0.15) / n;
  // 樓梯間地面與兩側牆（西邊是隔壁窄樓的側牆）
  box(x0 - 0.15, 0, LAND.z0 - 0.3, x1 + 0.1, 0.16, 0, 'lbConcD');
  W.floors.push({ x0, x1, z0: ST_TOP, z1: 0, y: 0.16 });
  for (let i = 0; i < n; i++) {
    const za = zs - i * run, zb = za - run, y = 0.15 + (i + 1) * rise;
    box(x0, y - 0.045, zb, x1, y, za + 0.02, 'lbSteel');
    box(x0, y - 0.05, za - 0.02, x1, y - 0.04, za + 0.02, 'lbSteelL'); // 止滑條
    W.floors.push({ x0, x1, z0: zb, z1: za, y });
    if (y > 0.95) W.walls.push({ x0, x1, z0: zb, z1: za, y0: -1, y1: y - 0.45 }); // 樓梯下方：從底下走不過去
  }
  // 斜樑
  for (const x of [x0 + 0.03, x1 - 0.03]) {
    const len = Math.hypot(n * run, F2 - 0.15), g = new THREE.BoxGeometry(0.06, 0.22, len);
    P(g, { x, y: (0.15 + F2) / 2 - 0.12, z: zs - n * run / 2, rx: Math.atan2(F2 - 0.15, n * run) }); add(g, 'lbSteel');
  }
  // 平台（鐵板）
  box(x0, F2 - 0.06, LAND.z0, x1, F2, LAND.z1, 'lbSteel');
  W.floors.push({ x0, x1, z0: LAND.z0, z1: LAND.z1, y: F2 });
  W.walls.push({ x0, x1, z0: LAND.z0 - 0.3, z1: LAND.z0, y0: -1, y1: 20 });
  W.walls.push({ x0, x1, z0: LAND.z0, z1: LAND.z1, y0: -1, y1: F2 - 0.45 });
  // 扶手（兩側牆上）
  for (const x of [x0 + 0.06, x1 - 0.06]) {
    tube([[x, 1.05, zs + 0.2], [x, F2 + 0.9, ST_TOP], [x, F2 + 0.9, LAND.z0 + 0.2]], 0.022, 'lbSteelL', 12, 6);
    for (let i = 0; i <= 4; i++) { const t = i / 4, z = zs + 0.2 + (ST_TOP - zs - 0.2) * t, y = 1.05 + (F2 + 0.9 - 1.05) * t; cyl(0.012, 0.012, 0.12, x + (x < 65 ? -0.06 : 0.06), y - 0.06, z, 'lbSteelL', 5, { rz: Math.PI / 2, center: true }); }
  }
  // 隔壁窄樓的側牆（樓梯西側）＋平台上方的雨遮
  box(60, 0, -11, ST.x0 - 0.01, 14.5, 0, 'lbConcD', true);
  box(ST.x0 - 0.05, 6.2, LAND.z0, BX.x0, 6.3, LAND.z1 + 0.8, 'lbSteel');
  box(ST.x0 - 0.05, 0, BX.z0, BX.x0, 9.2, LAND.z0, 'lbConcD'); // 樓梯間盡頭的牆
  // 樓梯口的信箱、日光燈
  for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) { rbox(0.08, 0.18, 0.26, BX.x0 - 0.045, 1.25 + r * 0.21, -0.42 - k * 0.29, 'lbSteelL', 0.01); box(BX.x0 - 0.09, 1.3 + r * 0.21, -0.5 - k * 0.29, BX.x0 - 0.085, 1.32 + r * 0.21, -0.34 - k * 0.29, 'lbBlack'); }
  box(x0 + 0.02, 5.6, -7.9, x0 + 0.06, 5.64, -7.1, 'lbFluor'); cyl(0.03, 0.03, 0.8, x0 + 0.1, 5.62, -7.5, 'lbFluor', 8, { rx: Math.PI / 2, center: true });
  W.glow(scene, x0 + 0.2, 5.5, -7.5, 1.4, 0xe0fff0, 0.45);
  LIGHTS.push({ x: 65, y: 5.4, z: -7.4, d: 8, off: [0xe0f4ff, 10], on: [0xe0f4ff, 10] });
  LIGHTS.push({ x: 65, y: 2.4, z: -1.2, d: 6, off: [0xe0f4ff, 6], on: [0xe0f4ff, 6] });
  box(x0 + 0.02, 2.6, -1.6, x0 + 0.06, 2.64, -0.9, 'lbFluor');
  // 研究所的門：鐵門往內開、貼了手寫的門牌
  const dz = (DOOR.z0 + DOOR.z1) / 2;
  box(BX.x0 + 0.3, F2, DOOR.z0 - 0.04, BX.x0 + 1.22, DOOR.y1 - 0.02, DOOR.z0, 'lbIvory', true);
  box(BX.x0 + 1.1, F2 + 0.95, DOOR.z0, BX.x0 + 1.16, F2 + 1.0, DOOR.z0 + 0.06, 'lbChrome');
  box(BX.x0 - 0.04, F2, DOOR.z0 - 0.05, BX.x0 + 0.3, DOOR.y1 + 0.05, DOOR.z0, 'lbSteel'); box(BX.x0 - 0.04, F2, DOOR.z1, BX.x0 + 0.3, DOOR.y1 + 0.05, DOOR.z1 + 0.05, 'lbSteel');
  box(BX.x0 - 0.04, DOOR.y1, DOOR.z0, BX.x0 + 0.3, DOOR.y1 + 0.05, DOOR.z1, 'lbSteel');
  plane(0.42, 0.3, BX.x0 + 0.76, F2 + 1.5, DOOR.z0 + 0.003, 'z+', decal(LT.plate([{ t: '未来ガジェット', s: 0.82 }, { t: '研究所', s: 1.05 }], { w: 420, h: 300, size: 74, bg: '#f3efe2', ink: '#1a1a1a', border: null, paper: true, rot: -0.04 })));
  void dz;
}

// ---------- 一樓：映像管電視店 ----------
function shop(scene) {
  const S = LAB_SHOP;
  W.floors.push({ x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1, y: F1 });
  box(S.x0, S.top, S.z0, S.x1, 3.45, S.z1 - 0.3, 'lbCeil'); // 一樓天花板
  box(S.x0, F1, S.z0 - 0.2, S.x1, S.top, S.z0, 'lbPly', true); // 後面的隔間（倉庫）
  box(S.x0, F1, S.z0 - 0.05, S.x1, S.top, S.z0 - 0.02, 'lbConcW');
  box(S.x0, F1, -10.7, S.x1, S.top, S.z0 - 0.2, 'lbConcD');
  // 日光燈
  for (const x of [68.6, 73.4]) for (const z of [-2.2, -5.2]) { box(x - 0.62, S.top - 0.06, z - 0.08, x + 0.62, S.top, z + 0.08, 'lbWhite'); cyl(0.018, 0.018, 1.16, x, S.top - 0.08, z, 'lbLamp', 6, { rz: Math.PI / 2, center: true }); }
  LIGHTS.push({ x: 69.5, y: 3.1, z: -2.6, d: 10, off: [0xfff6e6, 22], on: [0xfff6e6, 22], lvl: 1 });
  LIGHTS.push({ x: 73.5, y: 3.1, z: -4.8, d: 10, off: [0xfff6e6, 18], on: [0xfff6e6, 18], lvl: 1 });
  // 三面牆的鐵架：一層一層堆滿映像管電視
  const shelf = (ax, az, len, dir, along) => {
    // along 'x'：沿 x 排，面向 dir（+1 = +z）；along 'z'：沿 z 排，面向 dir（+1 = +x）
    const depth = 0.62;
    for (const lv of [0, 0.78, 1.56, 2.3]) {
      if (along === 'x') box(ax, F1 + lv + 0.02, az, ax + len, F1 + lv + 0.05, az + dir * depth, 'lbSteelL');
      else box(az, F1 + lv + 0.02, ax, az + dir * depth, F1 + lv + 0.05, ax + len, 'lbSteelL');
    }
    for (let k = 0; k <= Math.round(len / 1.2); k++) for (const d of [0.02, depth - 0.02]) {
      const t = Math.min(len, k * 1.2);
      if (along === 'x') box(ax + t - 0.02, F1, az + dir * d - 0.02, ax + t + 0.02, F1 + 2.75, az + dir * d + 0.02, 'lbSteelL');
      else box(az + dir * d - 0.02, F1, ax + t - 0.02, az + dir * d + 0.02, F1 + 2.75, ax + t + 0.02, 'lbSteelL');
    }
    LT.reseed(Math.round(ax * 10 + az));
    for (const lv of [0.05, 0.83, 1.61]) {
      let t = 0.06;
      while (t < len - 0.3) {
        const s = 0.34 + LT.rnd() * 0.24; if (t + s > len - 0.04) break;
        const at = t + s / 2, y = F1 + lv;
        if (along === 'x') crt(ax + at, y, az + dir * 0.34, s, dir > 0 ? 0 : Math.PI);
        else crt(az + dir * 0.34, y, ax + at, s, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        t += s + 0.04 + LT.rnd() * 0.05;
      }
    }
    if (along === 'x') W.walls.push({ x0: ax, x1: ax + len, z0: Math.min(az, az + dir * depth), z1: Math.max(az, az + dir * depth), y0: 0, y1: 3 });
    else W.walls.push({ x0: Math.min(az, az + dir * depth), x1: Math.max(az, az + dir * depth), z0: ax, z1: ax + len, y0: 0, y1: 3 });
  };
  shelf(S.x0 + 0.05, S.z0 + 0.02, S.x1 - S.x0 - 0.1, 1, 'x'); // 後牆，面向街
  shelf(S.z0 + 0.7, S.x0 + 0.02, 6.1, 1, 'z'); // 西牆，面向 +x
  shelf(S.z0 + 0.7, S.x1 - 0.02, 3.2, -1, 'z'); // 東牆後段
  // 櫃台（東側前段）：收銀機、修理到一半的電視、工具
  const cx0 = 73.2, cx1 = 75.6, cz0 = -2.6, cz1 = -1.9;
  box(cx0, F1, cz0, cx1, F1 + 0.95, cz1, 'lbWood', true); box(cx0 - 0.04, F1 + 0.95, cz0 - 0.04, cx1, F1 + 0.99, cz1 + 0.06, 'lbWoodL');
  rbox(0.36, 0.2, 0.3, 75.1, F1 + 1.1, -2.25, 'lbCRTb', 0.03); box(74.95, F1 + 1.13, -2.105, 75.25, F1 + 1.18, -2.1, 'lbLed');
  crt(74.1, F1 + 0.99, -2.25, 0.5, 0, true);
  cyl(0.012, 0.012, 0.3, 73.6, F1 + 1.0, -2.0, 'lbOrange', 6, { rz: 1.3 });
  rbox(0.5, 0.12, 0.3, 73.7, F1 + 1.05, -2.4, 'lbBlue', 0.02);
  // 店主的椅子（坐得下）
  stool(74.4, -3.1, F1);
  // 店門口：特價的小電視堆、紙箱
  crt(67.2, F1, -0.55, 0.46, 0); crt(67.75, F1, -0.6, 0.4, 0.15); crt(67.45, F1 + 0.42, -0.6, 0.36, -0.1);
  box(68.25, F1, -0.9, 68.85, F1 + 0.45, -0.4, 'lbCard'); box(68.3, F1 + 0.45, -0.85, 68.8, F1 + 0.8, -0.45, 'lbCardD');
  W.walls.push({ x0: 66.9, x1: 68.9, z0: -0.95, z1: -0.3, y0: 0, y1: 1.6 });
  plane(0.32, 0.22, 68.55, F1 + 0.6, -0.395, 'z+', decal(LT.plate([{ t: '特価', s: 1 }, { t: '¥3,000', s: 0.7 }], { w: 320, h: 220, size: 82, bg: '#ffe23a', ink: '#c41818', border: '#c41818' })));
}
// 映像管電視：s = 寬度（公尺）；ry 面向（0 = +z）；screen 指定畫面，沒給就隨機
function crt(x, y, z, s, ry, broken = false) {
  const h = s * 0.82, d = s * 0.85;
  const c = Math.cos(ry), sn = Math.sin(ry), at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
  const body = ['lbCRTb', 'lbCRTg', 'lbCRT', 'lbCRTw'][Math.floor(LT.rnd() * 4)];
  const [fx, fz] = at(0, -d * 0.2);
  rbox(s, h, d * 0.55, fx, y + h / 2, fz, body, s * 0.05, ry);
  const [bx, bz] = at(0, -d * 0.62);
  rbox(s * 0.7, h * 0.72, d * 0.36, bx, y + h * 0.46, bz, body, s * 0.08, ry);
  const scr = broken ? 'lbScrOff' : ['lbScr0', 'lbScr1', 'lbScr2', 'lbScr3', 'lbScrOff', 'lbScr0'][Math.floor(LT.rnd() * 6)];
  const g = new THREE.PlaneGeometry(s * 0.76, h * 0.72);
  const [sx, sz] = at(-s * 0.04, d * 0.075 + 0.004);
  P(g, { x: sx, y: y + h * 0.55, z: sz, ry }); add(g, scr);
  // 右邊的旋鈕
  const [kx, kz] = at(s * 0.43, d * 0.078);
  const k = new THREE.CylinderGeometry(s * 0.025, s * 0.025, 0.012, 8); k.rotateX(Math.PI / 2); P(k, { x: kx, y: y + h * 0.7, z: kz, ry }); add(k, 'lbBlack');
}
function stool(x, z, y, seat = true) {
  cyl(0.18, 0.18, 0.06, x, y + 0.42, z, 'lbRed', 16); cyl(0.025, 0.025, 0.42, x, y, z, 'lbChrome', 6);
  cyl(0.2, 0.22, 0.03, x, y, z, 'lbChrome', 12);
  if (seat) W.seats.push({ x, y: y + 0.5, z, ry: Math.PI / 2, noScreen: true }); // 店裡的圓凳看不到研究所電視
  W.walls.push({ x0: x - 0.18, x1: x + 0.18, z0: z - 0.18, z1: z + 0.18, y0: y, y1: y + 1.6, chair: true });
}

// ---------- 二樓：研究所 ----------
function labRoom(scene) {
  const R = LAB_ROOM, y = F2;
  // 牆面壁紙（貼在四面牆的內側）、踢腳板
  box(R.x0, y, R.z1 - 0.01, R.x1, C2, R.z1, 'lbPaper'); box(R.x0, y, R.z0, R.x1, C2, R.z0 + 0.01, 'lbPaper');
  box(R.x0, y, R.z0, R.x0 + 0.01, C2, DOOR.z0, 'lbPaper'); box(R.x0, y, DOOR.z1, R.x0 + 0.01, C2, R.z1, 'lbPaper'); box(R.x0, DOOR.y1, DOOR.z0, R.x0 + 0.01, C2, DOOR.z1, 'lbPaper');
  box(R.x1 - 0.01, y, R.z0, R.x1, C2, R.z1, 'lbPaper');
  for (const [a, b, c, d] of [[R.x0, R.z1 - 0.03, R.x1, R.z1 - 0.01], [R.x0, R.z0 + 0.01, R.x1, R.z0 + 0.03], [R.x1 - 0.03, R.z0, R.x1 - 0.01, R.z1]]) box(a, y, b, c, y + 0.08, d, 'lbWood');
  // 二樓窗（裡面看出去）：百葉窗＋街燈的光
  for (const [a, b] of [[67.0, 69.8], [71.6, 74.8]]) {
    box(a, 4.5, R.z1 - 0.02, b, 5.85, R.z1 - 0.01, 'lbNight');
    for (let k = 0; k < 26; k++) { const sy = 5.82 - k * 0.032; if (sy < 5.0) break; box(a + 0.03, sy, R.z1 - 0.07, b - 0.03, sy + 0.022, R.z1 - 0.05, 'lbIvory'); }
    box(a, 4.47, R.z1 - 0.18, b, 4.5, R.z1, 'lbIvory'); // 窗台
  }
  // 日光燈（吸頂、兩支燈管）
  for (const [x, z] of [[68.9, -3.4], [73.3, -3.4], [68.9, -8.7], [73.3, -9.0]]) {
    box(x - 0.66, C2 - 0.07, z - 0.13, x + 0.66, C2, z + 0.13, 'lbWhite');
    for (const dz of [-0.06, 0.06]) cyl(0.016, 0.016, 1.2, x, C2 - 0.09, z + dz, 'lbFluor', 6, { rz: Math.PI / 2, center: true });
    LIGHTS.push({ x, y: C2 - 0.4, z, d: 9, off: [0x000000, 0], on: [0xf4f7ff, 20], lvl: 2 });
  }
  // 拉繩開關
  tube([[68.9, C2 - 0.07, -3.4], [68.92, C2 - 0.6, -3.38]], 0.004, 'lbIvory', 2, 3);

  // 玄關：磁磚地、鞋櫃、鞋子
  box(R.x0, y, -8.4, 67.35, y + 0.012, -6.6, 'lbTileG');
  box(R.x0 + 0.02, y, -10.3, R.x0 + 0.38, y + 0.95, -8.5, 'lbPly', true);
  for (const [x, z, k] of [[66.85, -7.9, 'lbBlack'], [66.95, -7.6, 'lbRed'], [67.05, -7.1, 'lbBlue']]) { rbox(0.11, 0.08, 0.27, x, y + 0.05, z, k, 0.03); rbox(0.11, 0.08, 0.27, x + 0.14, y + 0.05, z - 0.04, k, 0.03); }

  // ---- 沙發（西牆、面向 +x 電視）----
  const sx0 = 66.42, sx1 = 67.32, sz0 = -5.45, sz1 = -2.75;
  rbox(sx1 - sx0, 0.26, sz1 - sz0, (sx0 + sx1) / 2, y + 0.2, (sz0 + sz1) / 2, 'lbSofaD', 0.05);
  rbox(0.26, 0.56, sz1 - sz0, sx0 + 0.13, y + 0.6, (sz0 + sz1) / 2, 'lbSofa', 0.08); // 靠背
  for (const z of [sz0 + 0.12, sz1 - 0.12]) rbox(sx1 - sx0, 0.32, 0.24, (sx0 + sx1) / 2, y + 0.46, z, 'lbSofa', 0.08); // 扶手
  const cush = (sz1 - sz0 - 0.48) / 3;
  for (let k = 0; k < 3; k++) {
    const cz = sz0 + 0.24 + cush * (k + 0.5);
    rbox(sx1 - sx0 - 0.28, 0.12, cush - 0.02, (sx0 + 0.26 + sx1) / 2, y + 0.38, cz, 'lbSofa', 0.05);
    rbox(0.14, 0.34, cush - 0.04, sx0 + 0.33, y + 0.62, cz, 'lbSofa', 0.06); // 靠墊
    W.seats.push({ x: 66.98, y: y + 0.5, z: cz, ry: Math.PI / 2 });
  }
  for (const [a, b] of [[sx0 + 0.05, sz0 + 0.05], [sx1 - 0.05, sz0 + 0.05], [sx0 + 0.05, sz1 - 0.05], [sx1 - 0.05, sz1 - 0.05]]) cyl(0.025, 0.02, 0.07, a, y, b, 'lbWood', 6);
  W.walls.push({ x0: sx0, x1: sx0 + 0.3, z0: sz0, z1: sz1, y0: y, y1: y + 1.6 });
  W.walls.push({ x0: sx0, x1: sx1, z0: sz0, z1: sz0 + 0.24, y0: y, y1: y + 1.6 }, { x0: sx0, x1: sx1, z0: sz1 - 0.24, z1: sz1, y0: y, y1: y + 1.6 });
  // 毯子（隨手丟在扶手上）
  rbox(0.5, 0.05, 0.34, 66.95, y + 0.64, sz1 - 0.14, 'lbBlue', 0.02);

  // ---- 矮桌：泡麵、香蕉、汽水罐、筆電 ----
  const tx0 = 67.72, tx1 = 68.58, tz0 = -4.75, tz1 = -3.45, th = y + 0.4;
  box(tx0, th - 0.04, tz0, tx1, th, tz1, 'lbWoodL');
  for (const [a, b] of [[tx0 + 0.05, tz0 + 0.05], [tx1 - 0.05, tz0 + 0.05], [tx0 + 0.05, tz1 - 0.05], [tx1 - 0.05, tz1 - 0.05]]) box(a - 0.025, y, b - 0.025, a + 0.025, th - 0.04, b + 0.025, 'lbWood');
  box(tx0 + 0.04, y + 0.1, tz0 + 0.04, tx1 - 0.04, y + 0.12, tz1 - 0.04, 'lbWood'); // 下層板
  W.walls.push({ x0: tx0, x1: tx1, z0: tz0, z1: tz1, y0: y, y1: y + 0.9 });
  for (const [x, z] of [[67.9, -3.7], [68.05, -3.62]]) { cyl(0.05, 0.042, 0.11, x, th, z, 'lbCup', 12); cyl(0.051, 0.051, 0.02, x, th + 0.09, z, 'lbRed', 12); }
  for (const [x, z] of [[68.4, -3.62], [68.46, -3.75], [67.85, -4.55]]) cyl(0.033, 0.033, 0.12, x, th, z, 'lbCan', 10);
  banana(68.3, th, -4.15);
  // 筆電（打開）
  rbox(0.34, 0.02, 0.24, 68.1, th + 0.01, -4.45, 'lbBlack', 0.008, 0.3);
  { const g = new THREE.BoxGeometry(0.34, 0.22, 0.012); g.translate(0, 0.11, 0); g.rotateX(-0.25); g.rotateY(0.3 + Math.PI / 2); P(g, { x: 67.97, y: th + 0.02, z: -4.4 }); add(g, 'lbBlack'); }
  // 遙控器
  rbox(0.05, 0.02, 0.17, 68.45, th + 0.01, -4.55, 'lbBlack', 0.008, 0.4);

  // ---- 電視櫃＋映像管電視（這台就是可以播片的那台）----
  const vx = LABTV.x, vz = LABTV.z, ty = y + 0.5;
  box(vx + 0.08, y, vz - 0.55, vx + 0.62, ty, vz + 0.55, 'lbWood', true); // 電視櫃
  box(vx + 0.06, y + 0.2, vz - 0.5, vx + 0.07, ty - 0.03, vz + 0.5, 'lbBlack'); // 櫃門玻璃
  rbox(0.34, 0.08, 0.42, vx + 0.32, y + 0.27, vz + 0.2, 'lbCRTg', 0.01); box(vx + 0.145, y + 0.27, vz + 0.05, vx + 0.15, y + 0.29, vz + 0.12, 'lbLed'); // 錄影機
  rbox(0.3, 0.06, 0.34, vx + 0.32, y + 0.12, vz - 0.22, 'lbBlack', 0.01); // 遊戲機
  // 電視本體：前框（面向 -x）＋後面的映像管凸起
  rbox(0.46, 0.66, 0.78, vx + 0.25, ty + 0.33, vz, 'lbCRT', 0.05);
  rbox(0.34, 0.5, 0.56, vx + 0.58, ty + 0.3, vz, 'lbCRT', 0.08);
  rbox(0.08, 0.02, 0.6, vx + 0.2, ty + 0.665, vz, 'lbCRTg', 0.008); // 散熱孔
  // 螢幕玻璃（影片以外的黑邊）、前面的弧形玻璃反光
  box(vx + 0.015, LABTV.y - 0.23, vz - 0.31, vx + 0.03, LABTV.y + 0.23, vz + 0.31, 'lbScrOff');
  for (const [a, b, c, d] of [[-0.255, -0.235, -0.335, 0.335], [0.235, 0.255, -0.335, 0.335]]) box(vx - 0.005, LABTV.y + a, vz + c, vx + 0.03, LABTV.y + b, vz + d, 'lbCRTg');
  for (const s of [-1, 1]) box(vx - 0.005, LABTV.y - 0.255, vz + s * 0.335 - 0.02, vx + 0.03, LABTV.y + 0.255, vz + s * 0.335 + 0.02, 'lbCRTg');
  // 下方的控制列、銀色品牌條（無字）、旋鈕
  box(vx + 0.01, ty + 0.02, vz - 0.37, vx + 0.03, ty + 0.06, vz + 0.37, 'lbAlu');
  for (let k = 0; k < 5; k++) box(vx + 0.0, ty + 0.03, vz + 0.12 + k * 0.045, vx + 0.012, ty + 0.05, vz + 0.145 + k * 0.045, 'lbBlack');
  box(vx - 0.002, ty + 0.035, vz - 0.3, vx + 0.01, ty + 0.045, vz - 0.29, 'lbLed');
  // 兔耳天線
  cyl(0.06, 0.07, 0.04, vx + 0.4, ty + 0.66, vz + 0.05, 'lbBlack', 12);
  tube([[vx + 0.4, ty + 0.69, vz + 0.03], [vx + 0.36, ty + 1.1, vz - 0.22]], 0.004, 'lbChrome', 2, 4);
  tube([[vx + 0.4, ty + 0.69, vz + 0.07], [vx + 0.44, ty + 1.05, vz + 0.36]], 0.004, 'lbChrome', 2, 4);
  // 電視後面的鐵架（隔開電腦區），塞滿雜物
  const rx0 = 70.42, rx1 = 70.84, rz0 = -5.35, rz1 = -2.85;
  metalRack(rx0, rx1, rz0, rz1, y, 1.85, [0.05, 0.6, 1.2, 1.8]);
  W.walls.push({ x0: vx + 0.08, x1: rx1, z0: rz0, z1: rz1, y0: y, y1: y + 2 });
  boxes(70.47, rz0 + 0.1, y + 0.62, 4, 0.3); boxes(70.47, rz0 + 0.1, y + 1.22, 3, 0.35); boxes(70.47, rz0 + 0.12, y + 0.07, 3, 0.4);
  books(rx1 + 0.002, y + 1.82 - 0.58, rz0 + 0.1, rz1 - 0.1, 'x+', 0.5);

  // ---- 白板（滾輪架，在沙發左手邊）----
  whiteboard(scene, 68.35, -6.55, y);

  // ---- 書架（沙發和窗之間）----
  box(66.32, y, -2.55, 66.72, y + 1.8, -0.45, 'lbWood', true);
  for (const k of [0.02, 0.45, 0.9, 1.35, 1.78]) box(66.34, y + k, -2.53, 66.72, y + k + 0.025, -0.47, 'lbWoodL');
  for (const k of [0.045, 0.475, 0.925, 1.375]) books(66.725, y + k, -2.5, -0.5, 'x+', 0.4);
  // 書架上的小東西：地球儀、模型槍（原創造型）
  cyl(0.11, 0.11, 0.02, 66.52, y + 1.805, -1.0, 'lbWood', 10); { const g = new THREE.SphereGeometry(0.11, 14, 10); P(g, { x: 66.52, y: y + 2.0, z: -1.0 }); add(g, 'lbBlue'); }
  rbox(0.09, 0.08, 0.42, 66.52, y + 1.85, -1.8, 'lbSteelL', 0.02); cyl(0.025, 0.025, 0.18, 66.52, y + 1.85, -2.08, 'lbOrange', 8, { rx: Math.PI / 2, center: true });

  // ---- 電腦桌（東牆）：三台螢幕、主機、電競椅 ----
  const dx0 = 74.95, dx1 = R.x1 - 0.02, dz0 = -4.7, dz1 = -1.0;
  box(dx0 - 0.1, y + 0.72, dz0, dx1, y + 0.76, dz1, 'lbWoodL');
  for (const z of [dz0 + 0.04, dz1 - 0.04]) box(dx0 - 0.06, y, z - 0.03, dx1 - 0.02, y + 0.72, z + 0.03, 'lbSteelL');
  W.walls.push({ x0: dx0 - 0.1, x1: dx1, z0: dz0, z1: dz1, y0: y, y1: y + 1.6 });
  const scr = [LT.codeScreen(0), LT.codeScreen(1), LT.codeScreen(0)];
  [[-3.65, 0.25, 0], [-2.85, 0, 1], [-2.05, -0.25, 2]].forEach(([z, rot, i]) => {
    const mx = 75.42, my = y + 1.12;
    rbox(0.05, 0.42, 0.66, mx + 0.03, my, z, 'lbBlack', 0.01, rot);
    const m = plane(0.6, 0.36, mx + 0.002 - Math.sin(rot) * 0.0, my, z, 'x-', lit(scr[i], { color: 0xc8d0d8 }));
    m.rotation.y = -Math.PI / 2 + rot; m.position.x = mx - 0.001;
    cyl(0.02, 0.02, 0.3, mx + 0.08, y + 0.76, z, 'lbBlack', 6); rbox(0.18, 0.015, 0.22, mx + 0.08, y + 0.765, z, 'lbBlack', 0.005);
  });
  rbox(0.18, 0.03, 0.5, 74.85, y + 0.775, -2.85, 'lbBlack', 0.01); // 鍵盤
  rbox(0.07, 0.025, 0.11, 74.9, y + 0.775, -2.4, 'lbBlack', 0.02);
  rbox(0.48, 0.46, 0.2, 75.3, y + 0.25, -1.3, 'lbBlack', 0.02); box(75.05, y + 0.38, -1.32, 75.06, y + 0.4, -1.28, 'lbGlow'); // 主機
  for (const [z, k] of [[-4.3, 'lbCan'], [-4.42, 'lbCan'], [-1.6, 'lbCup']]) cyl(0.033, 0.033, 0.12, 75.1, y + 0.76, z, k, 10);
  officeChair(74.25, -2.85, y);
  LIGHTS.push({ x: 75.0, y: y + 1.2, z: -2.85, d: 4, off: [0x8fb8ff, 3.5], on: [0x8fb8ff, 1.5], lvl: 2 });
  // 桌上的檯燈
  cyl(0.07, 0.08, 0.02, 75.4, y + 0.76, -4.4, 'lbBlack', 10); tube([[75.4, y + 0.78, -4.4], [75.38, y + 1.12, -4.32], [75.2, y + 1.18, -4.25]], 0.01, 'lbBlack', 6, 5);
  cyl(0.06, 0.03, 0.08, 75.18, y + 1.12, -4.25, 'lbBlack', 10);

  // ---- 微波爐（鐵架上，電線連到電腦和掀蓋手機）----
  const mzc = -5.75;
  metalRack(75.12, R.x1 - 0.02, -6.4, -5.1, y, 1.6, [0.05, 0.55, 1.05, 1.55]);
  W.walls.push({ x0: 75.1, x1: R.x1, z0: -6.4, z1: -5.1, y0: y, y1: y + 2 });
  rbox(0.38, 0.3, 0.52, 75.38, y + 0.55 + 0.03 + 0.15, mzc, 'lbWhite', 0.02);
  box(75.185, y + 0.62, mzc - 0.22, 75.19, y + 0.82, mzc + 0.1, 'lbGlass');
  box(75.185, y + 0.62, mzc + 0.13, 75.19, y + 0.82, mzc + 0.23, 'lbSteelL');
  box(75.18, y + 0.78, mzc + 0.14, 75.185, y + 0.8, mzc + 0.22, 'lbLed');
  box(75.18, y + 0.6, mzc - 0.24, 75.19, y + 0.84, mzc - 0.22, 'lbAlu'); // 門把
  plane(0.22, 0.07, 75.18, y + 0.9, mzc - 0.05, 'x-', decal(LT.plate('電話レンジ(仮)', { w: 360, h: 110, size: 46, bg: '#fbf7e8', ink: '#222', border: null, paper: true, rot: 0.03 })), 1);
  // 掀蓋手機、電線、示波器
  rbox(0.05, 0.02, 0.1, 75.38, y + 0.885, mzc + 0.12, 'lbSteelL', 0.008); rbox(0.05, 0.02, 0.1, 75.4, y + 0.905, mzc + 0.2, 'lbSteelL', 0.008);
  tube([[75.4, y + 0.88, mzc + 0.08], [75.45, y + 0.6, mzc + 0.4], [75.5, y + 0.76, -4.6], [75.45, y + 0.78, -4.0]], 0.008, 'lbBlack', 24, 4);
  tube([[75.55, y + 0.6, mzc - 0.2], [75.6, y + 0.1, mzc - 0.3], [75.55, y + 0.02, -4.9], [75.4, y + 0.1, -1.4]], 0.01, 'lbRed', 24, 4);
  rbox(0.3, 0.2, 0.34, 75.4, y + 0.1 + 1.05 - 0.04, mzc, 'lbCRTb', 0.02); box(75.245, y + 1.08, mzc - 0.1, 75.25, y + 1.2, mzc + 0.08, 'lbLed');
  boxes(75.15, -6.35, y + 0.07, 2, 0.32);
  // 輝光管計數器（電腦桌上）
  nixieMeter(scene, 75.3, y + 0.76, -3.95);

  // ---- 小廚房（後牆西段）＋冰箱 ----
  const kx0 = 66.4, kx1 = 68.8, kz0 = R.z0, kz1 = R.z0 + 0.6;
  box(kx0, y, kz0, kx1, y + 0.85, kz1, 'lbIvory', true); box(kx0 - 0.01, y + 0.85, kz0, kx1 + 0.01, y + 0.88, kz1 + 0.02, 'lbAlu');
  box(kx0 + 0.3, y + 0.86, kz0 + 0.12, kx0 + 0.85, y + 0.885, kz1 - 0.1, 'lbSteel'); // 水槽
  tube([[kx0 + 0.58, y + 0.88, kz0 + 0.06], [kx0 + 0.58, y + 1.15, kz0 + 0.08], [kx0 + 0.58, y + 1.12, kz0 + 0.28]], 0.012, 'lbChrome', 8, 5);
  box(kx0 + 1.2, y + 0.88, kz0 + 0.1, kx0 + 1.75, y + 0.95, kz1 - 0.08, 'lbBlack'); // 瓦斯爐
  cyl(0.09, 0.08, 0.16, kx0 + 1.35, y + 0.95, kz0 + 0.3, 'lbChrome', 12); // 水壺
  box(kx0, y + 1.5, kz0, kx1, y + 2.1, kz0 + 0.35, 'lbIvory'); // 吊櫃
  for (const [x, z] of [[67.9, -10.25], [68.05, -10.22], [68.2, -10.3]]) cyl(0.04, 0.036, 0.1, x, y + 0.88, z, 'lbCup', 10);
  // 冰箱（小型、雙門）
  rbox(0.62, 1.28, 0.6, 69.22, y + 0.64, kz0 + 0.32, 'lbWhite', 0.03);
  box(68.905, y + 0.88, kz0 + 0.62, 69.53, y + 0.89, kz0 + 0.63, 'lbSteelL');
  box(69.45, y + 0.95, kz0 + 0.62, 69.47, y + 1.2, kz0 + 0.65, 'lbAlu'); box(69.45, y + 0.4, kz0 + 0.62, 69.47, y + 0.8, kz0 + 0.65, 'lbAlu');
  W.walls.push({ x0: 68.9, x1: 69.55, z0: kz0, z1: kz0 + 0.65, y0: y, y1: y + 1.6 });
  for (let k = 0; k < 4; k++) cyl(0.033, 0.033, 0.12, 69.0 + k * 0.08, y + 1.28, kz0 + 0.3, 'lbCan', 10); // 冰箱上的汽水箱
  box(68.98, y + 1.28, kz0 + 0.12, 69.5, y + 1.5, kz0 + 0.55, 'lbCardD');
  // 淋浴間的門
  box(69.9, y, R.z0 + 0.005, 70.72, y + 2.0, R.z0 + 0.04, 'lbIvory'); box(70.6, y + 0.95, R.z0 + 0.04, 70.66, y + 1.0, R.z0 + 0.08, 'lbChrome');

  // ---- 開發室：布簾後面的工作台 ----
  curtain(71.0, 75.7, -7.45, y);
  box(71.3, y + 0.82, R.z0, R.x1 - 0.02, y + 0.86, R.z0 + 0.75, 'lbPly');
  for (const x of [71.35, 73.5, R.x1 - 0.06]) box(x - 0.03, y, R.z0 + 0.03, x + 0.03, y + 0.82, R.z0 + 0.72, 'lbSteelL');
  W.walls.push({ x0: 71.3, x1: R.x1, z0: R.z0, z1: R.z0 + 0.75, y0: y, y1: y + 1.6 });
  // 示波器、焊台、零件盒、拆開的電路板
  rbox(0.42, 0.24, 0.34, 72.0, y + 0.98, R.z0 + 0.3, 'lbCRTb', 0.02); box(71.86, y + 0.9, R.z0 + 0.475, 72.1, y + 1.06, R.z0 + 0.48, 'lbLed');
  rbox(0.2, 0.1, 0.16, 72.7, y + 0.91, R.z0 + 0.4, 'lbBlue', 0.01); tube([[72.75, y + 0.96, R.z0 + 0.4], [72.9, y + 1.05, R.z0 + 0.5], [73.0, y + 0.9, R.z0 + 0.55]], 0.006, 'lbBlack', 8, 4);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) box(73.7 + k * 0.17, y + 0.87 + j * 0.06, R.z0 + 0.05, 73.85 + k * 0.17, y + 0.92 + j * 0.06, R.z0 + 0.3, ['lbBlue', 'lbOrange', 'lbWhite', 'lbRed'][(k + j) % 4]);
  box(74.6, y + 0.86, R.z0 + 0.35, 75.0, y + 0.875, R.z0 + 0.6, 'lbGreen');
  // 開發室牆上的層架（工具、零件、紙箱）
  metalRack(R.x1 - 0.45, R.x1 - 0.02, -10.0, -7.6, y, 2.0, [0.05, 0.6, 1.2, 1.95]);
  W.walls.push({ x0: R.x1 - 0.45, x1: R.x1, z0: -10.0, z1: -7.6, y0: y, y1: y + 2.2 });
  boxes(R.x1 - 0.42, -9.95, y + 0.07, 4, 0.38); boxes(R.x1 - 0.42, -9.95, y + 0.62, 3, 0.3); boxes(R.x1 - 0.42, -9.95, y + 1.22, 4, 0.34);
  // 開發室的紙箱堆（地上）
  box(71.2, y, -8.2, 71.8, y + 0.45, -7.65, 'lbCard'); box(71.25, y + 0.45, -8.15, 71.75, y + 0.8, -7.7, 'lbCardD');
  W.walls.push({ x0: 71.2, x1: 71.8, z0: -8.2, z1: -7.65, y0: y, y1: y + 1.6 });

  // ---- 牆上：時鐘、月曆、海報、電線 ----
  { const g = new THREE.CylinderGeometry(0.15, 0.15, 0.04, 24); g.rotateX(Math.PI / 2); P(g, { x: 70.5, y: 5.6, z: R.z1 - 0.035 }); add(g, 'lbWhite'); }
  { const g = new THREE.TorusGeometry(0.15, 0.012, 6, 24); P(g, { x: 70.5, y: 5.6, z: R.z1 - 0.055 }); add(g, 'lbBlack'); }
  box(70.49, 5.58, R.z1 - 0.06, 70.51, 5.7, R.z1 - 0.055, 'lbBlack'); box(70.5, 5.59, R.z1 - 0.06, 70.6, 5.61, R.z1 - 0.055, 'lbBlack');
  plane(0.42, 0.6, 72.2, 5.1, R.z0 + 0.012, 'z+', decal(LT.posterTex(0)));
  plane(0.42, 0.6, 66.312, 5.2, -4.1, 'x+', decal(LT.posterTex(1)));
  plane(0.34, 0.48, 75.688, 5.3, -2.85, 'x-', decal(LT.posterTex(2)));
  tube([[66.32, C2 - 0.05, -0.4], [66.32, C2 - 0.05, -6.5], [66.32, 3.7, -6.6]], 0.006, 'lbWhite', 8, 4); // 沿牆的電線
  // 地上的紙箱、雜誌、垃圾袋
  box(75.05, y, -7.25, 75.65, y + 0.4, -6.6, 'lbCard'); box(75.1, y + 0.4, -7.2, 75.6, y + 0.62, -6.7, 'lbCardD');
  W.walls.push({ x0: 75.05, x1: 75.7, z0: -7.3, z1: -6.6, y0: y, y1: y + 1.6 });
  clutter(scene, y);
  { const g = new THREE.SphereGeometry(0.22, 10, 8); g.scale(1, 0.8, 1); P(g, { x: 69.6, y: y + 0.17, z: -10.05 }); add(g, 'lbWhite'); }
  box(69.2, y, -6.3, 69.55, y + 0.05, -6.0, 'lbWhite'); box(69.25, y + 0.05, -6.28, 69.6, y + 0.07, -6.05, 'lbBlue');
}

// 香蕉：沿弧線掃出有稜角的果身（五條稜、兩端收細），果柄聚在一起成一串，尾端是褐色的果尖
function bananaFinger(c, f, bend, L, arc, R, key) {
  const RS = 15, N = 22, pos = [], idx = [], rad = L / arc;
  const up = new THREE.Vector3().crossVectors(f, bend).normalize();
  const center = (t) => c.clone().addScaledVector(f, rad * Math.sin(t * arc)).addScaledVector(bend, rad * (1 - Math.cos(t * arc)));
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = center(t);
    const tan = f.clone().multiplyScalar(Math.cos(t * arc)).addScaledVector(bend, Math.sin(t * arc)).normalize();
    const nx = new THREE.Vector3().crossVectors(up, tan).normalize(), ny = new THREE.Vector3().crossVectors(tan, nx).normalize();
    // 粗細：果柄細、中段飽滿、尾端收成鈍尖
    const r = t < 0.14 ? R * (0.32 + 0.25 * t / 0.14) : R * (0.57 + 0.43 * Math.sin(Math.min(1, (t - 0.14) / 0.72) * Math.PI * 0.5)) * (t > 0.86 ? Math.max(0.25, 1 - (t - 0.86) / 0.14 * 0.75) : 1);
    const ridge = t < 0.14 ? 0 : 0.09;
    for (let j = 0; j < RS; j++) {
      const th = j / RS * Math.PI * 2, rr = r * (1 - ridge * (1 - Math.abs(Math.cos(th * 2.5))));
      const v = p.clone().addScaledVector(nx, Math.cos(th) * rr * 1.05).addScaledVector(ny, Math.sin(th) * rr * 0.95);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < RS; j++) { const a = i * RS + j, b = i * RS + (j + 1) % RS, c2 = a + RS, d = b + RS; idx.push(a, c2, b, b, c2, d); }
  // 兩端封口
  const e0 = pos.length / 3, p0 = center(0); pos.push(p0.x, p0.y, p0.z); const e1 = e0 + 1, p1 = center(1); pos.push(p1.x, p1.y, p1.z);
  for (let j = 0; j < RS; j++) { idx.push(e0, j, (j + 1) % RS); idx.push(e1, N * RS + (j + 1) % RS, N * RS + j); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  add(g, key);
  // 果尖（深褐色小鈍頭）
  const tip = center(1), tg = new THREE.SphereGeometry(R * 0.3, 8, 6); tg.translate(tip.x, tip.y, tip.z); add(tg, 'lbBananaD');
  return center(0);
}
function banana(x, y, z) {
  const crown = new THREE.Vector3(x - 0.07, y + 0.03, z - 0.06), Y = new THREE.Vector3(0, 1, 0);
  const n = 5, R = 0.025, L = 0.21;
  for (let k = 0; k < n; k++) {
    const a = 0.55 + (k - (n - 1) / 2) * 0.26;
    const f = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3().crossVectors(Y, f).normalize().negate();
    // 整串一起往同一側彎，尾端微微翹起；中間的幾根疊高一點
    const bend = side.multiplyScalar(0.82).addScaledVector(Y, 0.42).normalize();
    const lift = 0.009 * (2 - Math.abs(k - 2));
    const c = crown.clone().add(new THREE.Vector3(0, lift, 0)).addScaledVector(f, 0.012);
    bananaFinger(c, f.clone().addScaledVector(Y, -0.12).normalize(), bend, L * (0.94 + 0.06 * Math.cos(k * 1.7)), 0.95, R * (0.95 + 0.05 * Math.sin(k * 2.3)), 'lbBanana');
  }
  // 果軸：一小段粗的綠褐色梗，端面是深色切口
  const sg = new THREE.CylinderGeometry(0.011, 0.014, 0.05, 8); sg.rotateZ(Math.PI / 2); sg.rotateY(-0.55); sg.translate(crown.x - 0.02, crown.y + 0.004, crown.z - 0.012); add(sg, 'lbBananaS');
  const cg = new THREE.CylinderGeometry(0.0115, 0.0115, 0.004, 8); cg.rotateZ(Math.PI / 2); cg.rotateY(-0.55); cg.translate(crown.x - 0.043, crown.y + 0.004, crown.z - 0.026); add(cg, 'lbBananaD');
}
function metalRack(x0, x1, z0, z1, y, h, levels) {
  for (const lv of levels) box(x0, y + lv, z0, x1, y + lv + 0.025, z1, 'lbSteelL');
  for (const [a, b] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(a - 0.015, y, b - 0.015, a + 0.015, y + h, b + 0.015, 'lbSteelL');
}
function boxes(x, z, y, n, w) {
  LT.reseed(Math.round(x * 13 + z * 7 + y * 31));
  let zz = z;
  for (let i = 0; i < n; i++) {
    const d = w * (0.7 + LT.rnd() * 0.4), hh = 0.18 + LT.rnd() * 0.25, k = ['lbCard', 'lbCardD', 'lbCRTb', 'lbBlue', 'lbWhite'][Math.floor(LT.rnd() * 5)];
    box(x, y, zz, x + 0.32, y + hh, zz + d - 0.03, k);
    zz += d;
  }
}
function books(x, y, z0, z1, face, h) {
  const t = (books.t ||= [LT.bookSpines(131), LT.bookSpines(132)]);
  plane(Math.abs(z1 - z0), h, x, y + h / 2, (z0 + z1) / 2, face, new THREE.MeshStandardMaterial({ map: t[(books.i = (books.i || 0) + 1) % 2], roughness: 0.85 }));
}
function officeChair(x, z, y) {
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; tube([[x, y + 0.08, z], [x + Math.cos(a) * 0.3, y + 0.05, z + Math.sin(a) * 0.3]], 0.018, 'lbBlack', 2, 5); cyl(0.03, 0.03, 0.04, x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3, 'lbRubber', 8); }
  cyl(0.03, 0.03, 0.36, x, y + 0.08, z, 'lbChrome', 8);
  rbox(0.5, 0.09, 0.5, x, y + 0.48, z, 'lbBlack', 0.04);
  rbox(0.08, 0.66, 0.48, x - 0.27, y + 0.88, z, 'lbBlack', 0.04, 0);
  rbox(0.04, 0.14, 0.4, x - 0.25, y + 1.0, z, 'lbRed', 0.02);
  for (const s of [-1, 1]) rbox(0.3, 0.03, 0.06, x - 0.02, y + 0.68, z + s * 0.25, 'lbBlack', 0.01);
  W.seats.push({ x, y: y + 0.5, z, ry: Math.PI / 2, noScreen: true }); // 電腦椅背對電視：坐下只看前方，不給最佳視角／全螢幕
  W.walls.push({ x0: x - 0.3, x1: x + 0.25, z0: z - 0.27, z1: z + 0.27, y0: y, y1: y + 1.6, chair: true });
}
function whiteboard(scene, x, z, y) {
  const w = 1.9, h = 1.15, by = y + 0.85;
  box(x - w / 2, by, z - 0.02, x + w / 2, by + h, z, 'lbWhite');
  for (const [a, b, c, d] of [[-w / 2 - 0.025, w / 2 + 0.025, -0.025, 0], [-w / 2 - 0.025, w / 2 + 0.025, h, h + 0.025]]) box(x + a, by + c, z - 0.03, x + b, by + d, z + 0.01, 'lbAlu');
  for (const s of [-1, 1]) box(x + s * (w / 2 + 0.0125) - 0.0125, by, z - 0.03, x + s * (w / 2 + 0.0125) + 0.0125, by + h, z + 0.01, 'lbAlu');
  box(x - w / 2, by - 0.05, z, x + w / 2, by - 0.03, z + 0.08, 'lbAlu'); // 筆槽
  for (const [dx, k] of [[-0.5, 'lbBlue'], [-0.4, 'lbRed'], [-0.3, 'lbBlack']]) cyl(0.01, 0.01, 0.12, x + dx, by - 0.02, z + 0.04, k, 6, { rz: Math.PI / 2, center: true });
  plane(w - 0.04, h - 0.04, x, by + h / 2, z + 0.003, 'z+', new THREE.MeshStandardMaterial({ map: LT.whiteboard(), roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  // 架子：兩支腳、滾輪
  for (const s of [-1, 1]) {
    box(x + s * 0.88 - 0.02, y + 0.06, z - 0.05, x + s * 0.88 + 0.02, by + h * 0.6, z - 0.01, 'lbAlu');
    box(x + s * 0.88 - 0.03, y + 0.06, z - 0.32, x + s * 0.88 + 0.03, y + 0.1, z + 0.26, 'lbAlu');
    for (const dz of [-0.3, 0.24]) cyl(0.035, 0.035, 0.04, x + s * 0.88, y + 0.035, z + dz, 'lbRubber', 8, { rz: Math.PI / 2, center: true });
  }
  W.walls.push({ x0: x - 0.95, x1: x + 0.95, z0: z - 0.32, z1: z + 0.26, y0: y + 0.2, y1: y + 2.2 });
  void scene;
}
function curtain(x0, x1, z, y) {
  box(x0, C2 - 0.06, z - 0.02, x1, C2 - 0.03, z + 0.02, 'lbAlu');
  // 兩片布簾：左邊拉開收在牆邊、右邊半拉；用正弦波做出皺褶
  for (const [a, b, amp] of [[x0, x0 + 1.4, 0.07], [x1 - 1.6, x1, 0.06]]) {
    const n = 40, g = new THREE.PlaneGeometry(b - a, C2 - y - 0.1, n, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) / (b - a) * n * 0.5 * Math.PI) * amp);
    g.computeVertexNormals(); P(g, { x: (a + b) / 2, y: y + (C2 - y - 0.1) / 2 + 0.02, z }); add(g, 'lbCurtain');
    W.walls.push({ x0: a, x1: b, z0: z - 0.08, z1: z + 0.08, y0: y, y1: C2 });
  }
}
function nixieMeter(scene, x, y, z) {
  rbox(0.1, 0.06, 0.34, x, y + 0.03, z, 'lbWood', 0.01);
  for (let k = 0; k < 8; k++) cyl(0.017, 0.017, 0.1, x - 0.01, y + 0.06, z - 0.15 + k * 0.043, 'lbGlass', 10);
  const m = plane(0.32, 0.06, x - 0.04, y + 0.11, z, 'x-', new THREE.MeshBasicMaterial({ map: LT.nixie(), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2);
  W.glow(scene, x - 0.06, y + 0.11, z, 0.5, 0xff8a30, 0.5);
  void m;
}

// ---------- 屋頂：水塔、冷氣外機、天線 ----------
function rooftop() {
  const y = ROOF;
  for (const [x, z] of [[73.6, -8.6], [74.6, -8.6], [73.6, -9.6], [74.6, -9.6]]) box(x - 0.05, y, z - 0.05, x + 0.05, y + 1.2, z + 0.05, 'lbSteel');
  cyl(0.85, 0.85, 1.5, 74.1, y + 1.2, -9.1, 'lbIvory', 20); cyl(0.86, 0.6, 0.25, 74.1, y + 2.7, -9.1, 'lbIvory', 20);
  for (const x of [67.4, 68.4]) { rbox(0.8, 0.6, 0.32, x, y + 0.3, -2.0, 'lbWhite', 0.03); cyl(0.22, 0.22, 0.01, x, y + 0.3, -1.835, 'lbBlack', 16, { rx: Math.PI / 2, center: true }); }
  cyl(0.02, 0.02, 2.4, 70.5, y, -6, 'lbSteelL', 6);
  for (let k = 0; k < 6; k++) box(70.5 - 0.5 + k * 0.03, y + 2.0 - k * 0.1, -6.01, 70.5 + 0.5 - k * 0.03, y + 2.02 - k * 0.1, -5.99, 'lbSteelL');
}

// ---------- 鄰棟：西邊的窄樓、東邊兩棟、對街一排、街底橫向建築 ----------
function neighbors(scene) {
  const fac = (x0, x1, z, h, face, o) => { const t = LT.slimFacade(o); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.22 }); return plane(x1 - x0, h, (x0 + x1) / 2, h / 2, z, face, m); };
  // 西側窄樓（自動販賣機那棟）
  box(60.2, 0, -11, 64, 14.5, 0, 'lbConcD', true);
  fac(60.2, 64, 0.01, 14.5, 'z+', { seedN: 201, base: '#7d776c', cols: 2, floors: 5, lit: 0.3 });
  box(60.2, 0.15, 0, 64, 3.0, 0.05, 'lbBlack');
  vertSign(scene, 63.8, 0.45, 5.5, 'パーツ', '#1f4f9a');
  // 東側
  box(76.05, 0, -14, 86, 14, 0, 'lbConcD', true);
  fac(76.05, 86, 0.01, 14, 'z+', { seedN: 202, base: '#9a9080', cols: 4, floors: 4, lit: 0.45 });
  storefront(76.4, 85.6, 0.02, 'z+', '#ffe8c0', 'PCパーツ・中古', '#1d2a50');
  vertSign(scene, 76.3, 0.45, 6.5, '電子部品', '#c62828');
  box(86, 0, -14, 99.5, 21, 0, 'lbConcD', true);
  fac(86, 99.5, 0.01, 21, 'z+', { seedN: 203, base: '#6f6a66', cols: 5, floors: 7, lit: 0.4 });
  storefront(86.4, 99.1, 0.02, 'z+', '#d8f0ff', 'ゲーム・ホビー', '#7a1430');
  vertSign(scene, 86.3, 0.45, 8, 'ゲーム', '#e0a020', '#2a1a00');
  vertSign(scene, 99.2, 0.45, 9, 'カラオケ', '#7a2a9a');
  // 對街（南側，面向 -z）
  const S = [[60, 72, 18, '#7a6a5a', 'ジャンク通り', '#2a5a2a'], [72, 86, 26, '#8a8a90', '中古PC', '#1d2a50'], [86, 99.5, 15, '#6a5040', '喫茶', '#5a2a1a']];
  S.forEach(([x0, x1, h, c, name, col], i) => {
    box(x0, 0, 30, x1, h, 48, 'lbConcD');
    fac(x0, x1, 29.99, h, 'z-', { seedN: 210 + i, base: c, cols: Math.round((x1 - x0) / 3), floors: Math.round(h / 3.4), lit: 0.4 });
    storefront(x0 + 0.4, x1 - 0.4, 29.98, 'z-', ['#fff0c0', '#cfe8ff', '#ffd8b0'][i], name, col);
    vertSign(scene, x1 - 0.4, 29.55, h * 0.55, ['ジャンク', '秋葉原', '珈琲'][i], ['#2a6a2a', '#c62828', '#3a2a1a'][i], '#fff', -1);
  });
  // 街底（x 100，面向 -x）
  box(100, 0, -14, 112, 24, 44, 'lbConcD');
  const endF = fac(0, 46, 0, 24, 'x-', { seedN: 220, base: '#6a6460', cols: 12, floors: 7, lit: 0.5 }); endF.position.set(99.99, 12, 15);
  const big = plane(10, 2.4, 99.95, 7, 15, 'x-', lit(LT.plate([{ t: 'AKIHABARA', s: 1 }, { t: '電気街', s: 0.7 }], { w: 1024, h: 246, size: 120, bg: '#14181e', ink: '#ffe080', border: '#ff4060' }), { color: 0xffffff }));
  void big;
  storefront(-14 + 14, 30, 99.98, 'x-', '#fff0d0', '電気街口', '#c62828', true);
  W.glow(scene, 99.2, 7, 15, 9, 0xffd080, 0.25);
  LIGHTS.push({ x: 97.5, y: 5, z: 15, d: 22, off: [0xffd8a0, 30], on: [0xffd8a0, 30] });
  LIGHTS.push({ x: 81, y: 2.6, z: 1.4, d: 9, off: [0xffe4c0, 14], on: [0xffe4c0, 14] });
  LIGHTS.push({ x: 79, y: 2.6, z: 28.6, d: 10, off: [0xd8ecff, 14], on: [0xd8ecff, 14] });
}
// 一樓店面：亮著的櫥窗＋招牌（along x，或 alongZ 時沿 z）
function storefront(a, b, at, face, glowCol, name, col, alongZ = false) {
  const w = b - a, c = (a + b) / 2;
  const win = new THREE.MeshBasicMaterial({ map: LT.windowDark(1), color: new THREE.Color(glowCol), toneMapped: false });
  const sign = lit(LT.plate(name, { w: 1024, h: 160, size: 96, bg: col, ink: '#fff8e0', border: '#ffffff30' }), { color: 0xeeeeee });
  if (alongZ) { plane(w, 2.4, at, 1.4, c, face, win); plane(Math.min(w, 9), 0.8, at - 0.02, 3.2, c, face, sign); return; }
  plane(w, 2.4, c, 1.4, at, face, win); plane(Math.min(w, 9), 0.75, c, 3.2, at + (face === 'z+' ? 0.02 : -0.02), face, sign);
}
// 直立招牌（垂直於牆面、兩面都有字）
function vertSign(scene, x, z, y, text, bg, ink = '#fff', dir = 1) {
  const t = LT.vSign(text, { bg, ink }), m = lit(t, { color: 0xe8e8e8, side: THREE.DoubleSide }), h = 0.7 * [...text].length + 0.5;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, h), m); p.position.set(x, y + h / 2, z + dir * 0.35); p.rotation.y = Math.PI / 2; scene.add(p);
  box(x - 0.04, y - 0.05, z + dir * 0.02, x + 0.04, y + h + 0.05, z + dir * 0.06, 'lbSteel');
  W.glow(scene, x, y + h / 2, z + dir * 0.4, h * 0.8, new THREE.Color(bg).getHex(), 0.18);
}

// 生活感：洞洞板與工具、白袍、電風扇、雜誌堆、零食、垃圾袋、桌下的箱子
function clutter(scene, y) {
  const R = LAB_ROOM;
  // 開發室：工作台上方的洞洞板、桌下的箱子與主機殼、放大鏡檯燈、拆開的機板
  box(71.4, y + 1.05, R.z0, 74.6, y + 2.05, R.z0 + 0.02, 'lbPeg');
  box(71.4, y, R.z0 + 0.05, 71.95, y + 0.45, R.z0 + 0.6, 'lbCard'); box(72.0, y, R.z0 + 0.05, 72.5, y + 0.5, R.z0 + 0.55, 'lbBlack');
  box(73.7, y, R.z0 + 0.05, 74.3, y + 0.32, R.z0 + 0.65, 'lbCardD'); box(74.35, y, R.z0 + 0.1, 74.8, y + 0.28, R.z0 + 0.6, 'lbBlue');
  cyl(0.08, 0.09, 0.03, 73.3, y + 0.86, R.z0 + 0.25, 'lbWhite', 12);
  tube([[73.3, y + 0.89, R.z0 + 0.25], [73.25, y + 1.25, R.z0 + 0.3], [73.1, y + 1.3, R.z0 + 0.5]], 0.012, 'lbWhite', 8, 5);
  { const g = new THREE.TorusGeometry(0.09, 0.02, 6, 18); g.rotateX(Math.PI / 2); P(g, { x: 73.05, y: y + 1.26, z: R.z0 + 0.55 }); add(g, 'lbWhite'); }
  box(72.9, y + 0.86, R.z0 + 0.45, 73.3, y + 0.875, R.z0 + 0.7, 'lbGreen');
  for (let k = 0; k < 6; k++) box(72.95 + k * 0.06, y + 0.875, R.z0 + 0.5, 72.98 + k * 0.06, y + 0.895, R.z0 + 0.53 + (k % 2) * 0.05, ['lbBlack', 'lbRed', 'lbBanana'][k % 3]);
  rbox(0.1, 0.16, 0.05, 72.45, y + 0.94, R.z0 + 0.6, 'lbBanana', 0.01); // 三用電表
  tube([[72.4, y + 0.88, R.z0 + 0.62], [72.2, y + 0.87, R.z0 + 0.7], [71.9, y + 0.88, R.z0 + 0.6]], 0.005, 'lbRed', 10, 4);
  // 掛在門邊牆上的白袍
  cyl(0.015, 0.015, 0.1, 66.35, y + 1.85, -6.35, 'lbChrome', 6, { rz: Math.PI / 2, center: true });
  { const g = new THREE.CylinderGeometry(0.16, 0.27, 1.05, 12, 1, true); g.scale(0.55, 1, 1); P(g, { x: 66.47, y: y + 1.3, z: -6.35 }); add(g, 'lbCoat'); }
  { const g = new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4); g.scale(0.55, 0.5, 1); P(g, { x: 66.47, y: y + 1.8, z: -6.35 }); add(g, 'lbCoat'); }
  for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.05, 0.06, 0.75, 8); P(g, { x: 66.5, y: y + 1.42, z: -6.35 + s * 0.24, rx: s * 0.1 }); add(g, 'lbCoat'); }
  // 電風扇（沙發旁）
  const fx = 67.25, fz = -2.35;
  cyl(0.16, 0.18, 0.04, fx, y, fz, 'lbWhite', 16); cyl(0.022, 0.022, 0.85, fx, y + 0.04, fz, 'lbWhite', 8);
  rbox(0.14, 0.14, 0.16, fx + 0.02, y + 0.95, fz, 'lbWhite', 0.04);
  { const g = new THREE.TorusGeometry(0.2, 0.008, 4, 28); g.rotateY(Math.PI / 2 - 0.5); P(g, { x: fx + 0.12, y: y + 0.95, z: fz - 0.06 }); add(g, 'lbWhite'); }
  for (let k = 0; k < 3; k++) { const g = new THREE.CircleGeometry(0.17, 6, k * 2.1, 0.7); g.rotateY(Math.PI / 2 - 0.5); P(g, { x: fx + 0.11, y: y + 0.95, z: fz - 0.06 }); add(g, 'lbBlue'); }
  W.walls.push({ x0: fx - 0.18, x1: fx + 0.18, z0: fz - 0.18, z1: fz + 0.18, y0: y, y1: y + 1.6 });
  // 雜誌堆、零食袋、垃圾袋
  for (let k = 0; k < 7; k++) box(69.0 - k * 0.004, y + k * 0.018, -1.0 + k * 0.006, 69.32 + k * 0.004, y + k * 0.018 + 0.016, -0.6 + k * 0.006, ['lbRed', 'lbWhite', 'lbBlue', 'lbBanana', 'lbWhite', 'lbGreen', 'lbOrange'][k]);
  rbox(0.16, 0.04, 0.24, 67.95, y + 0.42, -4.35, 'lbOrange', 0.02, 0.5);
  { const g = new THREE.SphereGeometry(0.2, 10, 8); g.scale(1, 0.85, 1); P(g, { x: 70.05, y: y + 0.17, z: -10.2 }); add(g, 'lbBlack'); }
  // 鐵架最上層：疊起來的映像管小電視、書
  crt(70.63, y + 1.825, -4.6, 0.36, Math.PI / 2, true); crt(70.63, y + 1.825, -3.4, 0.3, Math.PI / 2, true);
  // 電腦桌上方的層板：公仔、杯麵、遊戲盒
  box(75.45, y + 1.55, -4.6, R.x1 - 0.01, y + 1.58, -1.1, 'lbWoodL');
  for (let k = 0; k < 9; k++) box(75.5, y + 1.58, -4.55 + k * 0.17, 75.66, y + 1.58 + 0.18 + (k % 3) * 0.03, -4.42 + k * 0.17, ['lbBlue', 'lbRed', 'lbBlack', 'lbGreen', 'lbWhite', 'lbOrange'][k % 6]);
  for (const z of [-2.6, -2.3, -2.0]) { cyl(0.045, 0.04, 0.1, 75.55, y + 1.58, z, 'lbCup', 10); cyl(0.046, 0.046, 0.015, 75.55, y + 1.67, z, 'lbRed', 10); }
  // 天花板到牆角的電線束
  tube([[75.65, y + 0.75, -1.3], [75.66, C2 - 0.1, -1.0], [72.0, C2 - 0.05, -0.35], [69.0, C2 - 0.05, -0.35]], 0.009, 'lbBlack', 24, 4);
  void scene;
}
