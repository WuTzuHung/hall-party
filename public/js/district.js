// 城牆區：街道西端的巨大城牆與城門、城內的德式石造廣場，以及有兩台螢幕的「城牆觀影館」（同時視聽用）
// 原創的中世紀氛圍建築（灰石城牆、半木構造民居、錘式木桁架大廳），不使用任何作品的角色或官方圖像
// 座標沿用 world.js：x 沿街道（西為負），z>0 為街道方向；城牆內側 x < -72
import * as THREE from 'three';
import * as T from './textures.js';
import * as TW from './textures-wall.js';

// ---- 配置 ----
// 三層同心圓城牆（圓心 RC）：外城牆、中城牆、內城牆，城門都開在正東（朝街道），穿過三道門才到最內圈的觀影館
export const RC = { x: -178, z: 15 };
// R：牆中心線半徑；L：城門那一段直牆的半長（直牆兩端剛好接上圓弧）；X：城門直牆的中心 x
export const RINGS = [
  { key: 'outer', R: Math.hypot(109, 20), L: 20, h: 40, x0: -72, x1: -66, label: 'TOR · DER · MAUER', roman: 'I' },
  { key: 'middle', R: Math.hypot(72, 16), L: 16, h: 34, x0: -109, x1: -103, label: 'ZWEITES · TOR', roman: 'II' },
  { key: 'inner', R: Math.hypot(41, 13), L: 13, h: 28, x0: -140, x1: -134, label: 'INNERES · TOR', roman: 'III' },
];
export const RING_T = 6, RING_FOOT = 1.35; // 牆厚、牆腳最外一階
const GATE = { gate0: 10.5, gate1: 19.5, spring: 8.5 };
export const GREAT_WALL = { ...RINGS[0], ...GATE, z0: 15 - RINGS[0].L, z1: 15 + RINGS[0].L };
// 觀影館的建模座標沿用原本的位置（x -136..-100），建好後整棟往西移 DX 到最內圈的中央
const DX = -60;
const TH0 = { x0: -136, x1: -100, z0: 2, z1: 28, t: 1.2, eave: 10.6, ridge: 25.4 };
const IN = { x0: TH0.x0 + TH0.t, x1: TH0.x1 - TH0.t, z0: TH0.z0 + TH0.t, z1: TH0.z1 - TH0.t }; // 室內（建模座標）
// 兩台螢幕（掛在西牆、面向 +x）
const TS0 = [
  // 面向螢幕（-x）時左手邊是 +z：A（I）在左、B（II）在右
  { key: 'a', x: IN.x0 + 0.42, y: 5.75, z: 15 + 5.4, w: 9.6, h: 5.4, ry: Math.PI / 2 },
  { key: 'b', x: IN.x0 + 0.42, y: 5.75, z: 15 - 5.4, w: 9.6, h: 5.4, ry: Math.PI / 2 },
];
// 兩台螢幕合起來的觀看焦點（坐下、最佳視角、全螢幕用）
const TF0 = { x: IN.x0 + 0.42, y: 5.75, z: 15, w: 20.4, h: 5.4 };
// 對外（世界座標）
export const THEATER = { ...TH0, x0: TH0.x0 + DX, x1: TH0.x1 + DX };
export const TSCREENS = TS0.map((c) => ({ ...c, x: c.x + DX }));
export const TFOCUS = { ...TF0, x: TF0.x + DX };
export const DISTRICT = { x0: RC.x - RINGS[0].R - 4, x1: -66, z0: RC.z - RINGS[0].R - 4, z1: RC.z + RINGS[0].R + 4 }; // 小地圖用
export const inTheater = (x, z) => x > IN.x0 + DX - 0.2 && x < IN.x1 + DX + 0.3 && z > IN.z0 && z < IN.z1;
export const inDistrict = (x) => x < -69;

const roofY = (z) => { // 屋頂下緣（室內天花）的高度
  const T_ = TH0, half = (T_.z1 - T_.z0) / 2, d = Math.abs(z - (T_.z0 + half));
  return T_.ridge - (T_.ridge - T_.eave) * (d / half);
};

let W; // world.js 提供的工具
const FLAMES = []; // { s: sprite, base, ph, k }
const SHEETS = []; // 會隨風擺動的旗幟

export function buildWallDistrict(api, scene, anim, q) {
  W = api;
  makeMats(q);
  // 觀影館：用原本的建模座標建，整棟平移到最內圈
  shifted(scene, DX, (sc) => { theaterHall(sc); theaterInterior(sc); theaterYard(sc); });
  ground();
  for (const R of RINGS) { greatWall(scene, { ...R, ...GATE, z0: RC.z - R.L, z1: RC.z + R.L }); ringWall(scene, R); }
  countryside(scene);
  plaza(scene);
  midTown(scene);
  innerYard(scene);
  // 火光閃爍（只在城牆區時更新，省效能）
  anim.push((t) => {
    if (!W.zone.wall) return;
    for (const f of FLAMES) {
      const n = Math.sin(t * 11 * f.k + f.ph) * 0.5 + Math.sin(t * 23 * f.k + f.ph * 2) * 0.3 + Math.sin(t * 5.3 + f.ph) * 0.2;
      f.s.scale.set(f.base[0] * (1 + n * 0.06), f.base[1] * (1 + n * 0.12), 1);
      if (f.g) f.g.material.opacity = f.go * (0.85 + n * 0.15);
    }
    for (const sh of SHEETS) {
      const p = sh.g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = sh.base[i * 3 + 1], x = sh.base[i * 3]; p.setZ(i, sh.base[i * 3 + 2] + Math.sin(t * 1.3 + y * 1.1 + x * 0.8 + sh.ph) * sh.amp * Math.min(1, -y / sh.h + 0.15)); }
      p.needsUpdate = true; sh.g.computeVertexNormals();
    }
  });
  return { lights: LIGHTS, rings: RINGS.map((R) => ({ x: RC.x, z: RC.z, R: R.R, L: R.L, h: R.h, t: RING_T / 2 + RING_FOOT })), ral: { x: TFOCUS.x + 0.25, y: TFOCUS.y, z: TFOCUS.z, w: TFOCUS.w, h: TFOCUS.h } };
}

// ---------- 材質 ----------
function makeMats(q) {
  const aniso = q.high ? 8 : 4;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const hi = q.high ? 1024 : 512;
  const wallStone = TW.rubble({ size: hi, tileMeters: 8, rows: 10, base: [146, 142, 134], moss: 1, seedN: 41 });
  const hallStone = TW.rubble({ size: hi, tileMeters: 5, rows: 9, base: [156, 148, 136], warm: 6, seedN: 42 });
  const hallStoneIn = TW.rubble({ size: hi, tileMeters: 4.5, rows: 9, base: [176, 164, 146], warm: 12, seedN: 43, joint: [96, 86, 72], streaks: 0.03 });
  const trim = T.limestone({ blockW: 1.2, blockH: 0.6, tileMeters: 3, seedN: 44, base: [178, 170, 156] });
  const cob = TW.cobbles({ size: hi, n: 16 });
  const oak = TW.planks({ base: [86, 58, 38], seedN: 61 }), oakDark = TW.planks({ base: [52, 36, 26], seedN: 62, n: 4 }), roofBoards = TW.planks({ base: [96, 68, 46], seedN: 63, n: 8 });
  const slate = TW.slate({}), flag = TW.flagstones({ size: hi });
  const plaster = TW.limePlaster({}), plasterW = TW.limePlaster({ base: [214, 196, 168], seedN: 112 });
  const earth = T.limestone({ blockW: 0, tileMeters: 8, seedN: 45, base: [70, 62, 52] });
  for (const t of [wallStone, hallStone, hallStoneIn, trim, cob, oak, oakDark, roofBoards, slate, flag, plaster, plasterW, earth]) t.anisotropy = aniso;
  const ban = TW.banner({ seedN: 91 }), banR = TW.banner({ field: '#5b1f22', seedN: 92 });
  const crestC = document.createElement('canvas'); crestC.width = crestC.height = 512;
  TW.drawCrest(crestC.getContext('2d'), 256, 236, 180, '#d9c08a', 'rgba(0,0,0,0)');
  const crest = new THREE.CanvasTexture(crestC); crest.colorSpace = THREE.SRGBColorSpace;
  const crestS = document.createElement('canvas'); crestS.width = crestS.height = 512;
  TW.drawCrest(crestS.getContext('2d'), 256, 236, 180, '#b9b0a0', 'rgba(0,0,0,0)');
  const crestStone = new THREE.CanvasTexture(crestS); crestStone.colorSpace = THREE.SRGBColorSpace;
  const lit = TW.leaded({ lit: true }), night = TW.leaded({ lit: false });
  W.addMats({
    gwStone: { mat: std({ map: wallStone, roughness: 0.95, emissive: 0xffffff, emissiveMap: wallStone, emissiveIntensity: 0.13 }), tile: 8 },
    hStone: { mat: std({ map: hallStone, roughness: 0.92 }), tile: 5 },
    hStoneIn: { mat: std({ map: hallStoneIn, roughness: 0.9 }), tile: 4.5 },
    trim: { mat: std({ map: trim, roughness: 0.85 }), tile: 3 },
    cobble: { mat: std({ map: cob, roughness: 0.85 }), tile: 3.2 },
    earth: { mat: std({ map: earth, roughness: 1 }), tile: 8 },
    oak: { mat: std({ map: oak, roughness: 0.75 }), tile: 2.4 },
    oakDark: { mat: std({ map: oakDark, roughness: 0.8 }), tile: 2 },
    timber: { mat: std({ color: 0x3a281c, roughness: 0.85 }) },
    roofWood: { mat: std({ map: roofBoards, roughness: 0.85, side: THREE.DoubleSide }), tile: 3 },
    slate: { mat: std({ map: slate, roughness: 0.6, metalness: 0.1 }), tile: 3 },
    flagstone: { mat: std({ map: flag, roughness: 0.6, envMapIntensity: 0.6 }), tile: 4 },
    limeP: { mat: std({ map: plaster, roughness: 0.95 }), tile: 4 },
    limeW: { mat: std({ map: plasterW, roughness: 0.95 }), tile: 4 },
    iron: { mat: std({ color: 0x2a2826, roughness: 0.55, metalness: 0.85 }) },
    ironRust: { mat: std({ color: 0x4a3426, roughness: 0.8, metalness: 0.5 }) },
    brass: { mat: std({ color: 0xa8843e, roughness: 0.4, metalness: 0.9 }) },
    wax: { mat: std({ color: 0xefe2c4, roughness: 0.6, emissive: 0x2a1a08 }) },
    straw: { mat: std({ color: 0xb49a5a, roughness: 1 }) },
    leaf: { mat: std({ color: 0x56693a, roughness: 1, flatShading: true }) },
    leafD: { mat: std({ color: 0x435430, roughness: 1, flatShading: true }) },
    field: { mat: std({ color: 0x5d5a33, roughness: 1 }) },
    fieldG: { mat: std({ color: 0x4b5a2e, roughness: 1 }) },
    canvasC: { mat: std({ color: 0xcbbd9c, roughness: 1, side: THREE.DoubleSide }) },
    ember: { mat: new THREE.MeshBasicMaterial({ color: 0xff7a26 }) },
    soot: { mat: std({ color: 0x0d0b0a, roughness: 1 }) },
    glassLit: { mat: new THREE.MeshBasicMaterial({ map: lit, color: 0xffd8a0 }) },
    glassNight: { mat: new THREE.MeshBasicMaterial({ map: night, color: 0x9aa8c8 }) },
    glassHouse: { mat: new THREE.MeshBasicMaterial({ map: lit, color: 0xffc070 }) },
    glassDarkH: { mat: std({ map: night, roughness: 0.2, metalness: 0.4, color: 0x8090b0 }) },
    bannerG: { mat: std({ map: ban, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }) },
    bannerR: { mat: std({ map: banR, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }) },
    crestGold: { mat: std({ map: crest, transparent: true, alphaTest: 0.4, roughness: 0.4, metalness: 0.75, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }) },
    crestStone: { mat: std({ map: crestStone, transparent: true, alphaTest: 0.4, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }) },
    screenBlack: { mat: std({ color: 0x050505, roughness: 0.9 }) },
  });
}

// ---------- 幾何小工具 ----------
const box = (...a) => W.box(...a);
const add = (g, k) => W.add(g, k);
const P = (g, o) => W.place(g, o);
// 在 z-y 平面（固定 x）上兩點之間的方木
function beamZY(x, z0, y0, z1, y1, w, d, key) {
  const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
  add(P(new THREE.BoxGeometry(d, w, len), { x, y: (y0 + y1) / 2, z: (z0 + z1) / 2, rx: -Math.atan2(dy, dz) }), key);
}
// 在 x-y 平面（固定 z）上兩點之間的方木
function beamXY(z, x0, y0, x1, y1, w, d, key) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  add(P(new THREE.BoxGeometry(len, w, d), { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z, rz: Math.atan2(dy, dx) }), key);
}
// 在 x-y 平面（固定 z）上兩點之間的方木（給沿 x 的立面：與 beamXY 相同；給沿 z 的立面用 beamZY）
function beamFace(face, a0, y0, a1, y1, w, d, key) { if (face.axis === 'x') beamXY(face.at, a0, y0, a1, y1, w, d, key); else beamZY(face.at, a0, y0, a1, y1, w, d, key); }
// 曲線方木（弧形斜撐）
function curved(pts, r, key, seg = 10) {
  const c = new THREE.QuadraticBezierCurve3(...pts.map((p) => new THREE.Vector3(...p)));
  add(new THREE.TubeGeometry(c, seg, r, 4, false), key);
}
// 尖拱／半圓拱的路徑（u：水平座標，y：高度），回傳 THREE.Path
function archPath(u0, u1, yb, ys, pointed, Ctor = THREE.Path) {
  const p = new Ctor(), w = u1 - u0, cx = (u0 + u1) / 2;
  p.moveTo(u0, yb); p.lineTo(u1, yb); p.lineTo(u1, ys);
  if (pointed) {
    const a = Math.acos((w / 2) / w); // 60°
    p.absarc(u0, ys, w, 0, a, false); p.absarc(u1, ys, w, Math.PI - a, Math.PI, false);
  } else p.absarc(cx, ys, w / 2, 0, Math.PI, false);
  p.lineTo(u0, yb);
  return p;
}
function archTop(u0, u1, ys, pointed) { const w = u1 - u0; return pointed ? ys + w * Math.sin(Math.PI / 3) : ys + w / 2; }
// 帶開口的牆：輪廓點 outline（[u, y]...）、開口 holes（Path），厚 t
//   face.axis 'z'：牆面沿 z 展開（東西兩端的山牆），厚度往 -x，從 x = face.at 開始
//   face.axis 'x'：牆面沿 x 展開（南北側牆），厚度往 +z，從 z = face.at 開始
function holedWall(face, outline, holes, t, key) {
  const sh = new THREE.Shape(outline.map(([u, y]) => new THREE.Vector2(u, y)));
  for (const h of holes) sh.holes.push(h);
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 14 });
  const m = new THREE.Matrix4();
  if (face.axis === 'z') m.set(0, 0, -1, face.at, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1); // (u,y,e) -> (at - e, y, u)
  else m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, face.at, 0, 0, 0, 1); // (u,y,e) -> (u, y, at + e)
  g.applyMatrix4(m); add(g, key);
  return g;
}
// 平面形狀（玻璃、旗幟）放到牆面上：face 同上，off：沿厚度方向的位置；flip：反面朝外
function shapePlane(face, path, off, flip, key) {
  const sh = new THREE.Shape(path.getPoints(24));
  const g = new THREE.ShapeGeometry(sh, 16);
  g.computeBoundingBox(); const bb = g.boundingBox, uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  const m = new THREE.Matrix4();
  // ShapeGeometry 朝 +z；flip 時把三角形反向、法線反過來（形狀左右對稱，貼圖不受影響）
  if (flip) {
    const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0, -1);
  }
  if (face.axis === 'z') m.set(0, 0, -1, face.at - off, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  else m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, face.at + off, 0, 0, 0, 1);
  g.applyMatrix4(m); add(g, key);
}
// 火焰（加法混合的火舌＋光暈），會閃爍
let flameTex = null;
function fire(scene, x, y, z, s = 1, glowSize = 2.4, glowOp = 0.5, color = 0xffb060) {
  flameTex ||= TW.flame();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.center.set(0.5, 0.08); sp.position.set(x, y, z); sp.scale.set(0.16 * s, 0.34 * s, 1); scene.add(sp);
  const g = glowSize ? W.glow(scene, x, y + 0.12 * s, z, glowSize, color, glowOp) : null;
  FLAMES.push({ s: sp, base: [0.16 * s, 0.34 * s], ph: Math.random() * 10, k: 0.8 + Math.random() * 0.5, g, go: glowOp });
}
// 牆上的鐵火把架＋火把
function torch(scene, x, y, z, nx, nz) {
  // nx/nz：從牆面往外的方向
  box(x - 0.09 - nx * 0.02, y - 0.35, z - 0.09 - nz * 0.02, x + 0.09 - nx * 0.02, y + 0.05, z + 0.09 - nz * 0.02, 'iron'); // 牆上的鐵板
  const arm = new THREE.CylinderGeometry(0.025, 0.025, 0.46, 6); P(arm, { x: x + nx * 0.22, y: y - 0.12, z: z + nz * 0.22, rx: nz ? Math.PI / 2 : 0, rz: nx ? Math.PI / 2 : 0 }); add(arm, 'iron');
  const cup = new THREE.CylinderGeometry(0.1, 0.05, 0.16, 8, 1, true); P(cup, { x: x + nx * 0.42, y: y + 0.08, z: z + nz * 0.42 }); add(cup, 'iron');
  const stick = new THREE.CylinderGeometry(0.035, 0.03, 0.42, 6); P(stick, { x: x + nx * 0.42, y: y, z: z + nz * 0.42 }); add(stick, 'oakDark');
  fire(scene, x + nx * 0.42, y + 0.18, z + nz * 0.42, 1.25, 2.6, 0.5);
}
// 會擺動的旗幟：上緣在 (x, top, z)，ry：面向
function hangBanner(scene, x, top, z, w, h, ry, key = 'bannerG', amp = 0.05) {
  const g = new THREE.PlaneGeometry(w, h, 2, 14); g.translate(0, -h / 2, 0);
  const mesh = new THREE.Mesh(g, W.mats[key].mat); mesh.position.set(x, top, z); mesh.rotation.y = ry; scene.add(mesh);
  SHEETS.push({ g, base: g.attributes.position.array.slice(), ph: Math.random() * 6, amp, h });
  const rod = new THREE.CylinderGeometry(0.035, 0.035, w + 0.3, 8); P(rod, { x, y: top + 0.03, z, rz: Math.PI / 2, ry }); add(rod, 'iron');
  for (const s of [-1, 1]) { const k = new THREE.SphereGeometry(0.06, 8, 6); P(k, { x: x + Math.cos(ry) * s * (w / 2 + 0.15), y: top + 0.03, z: z - Math.sin(ry) * s * (w / 2 + 0.15) }); add(k, 'brass'); }
}
function barrel(x, y, z, r = 0.38, h = 0.95) {
  const g = new THREE.CylinderGeometry(r, r, h, 14, 4); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i) / (h / 2), k = 1 + 0.12 * (1 - yy * yy); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  g.computeVertexNormals(); P(g, { x, y: y + h / 2, z }); add(g, 'oak');
  for (const f of [0.14, 0.86]) { const hoop = new THREE.TorusGeometry(r * (1 + 0.12 * (1 - (f * 2 - 1) ** 2)) + 0.008, 0.016, 4, 20); P(hoop, { x, y: y + h * f, z, rx: Math.PI / 2 }); add(hoop, 'iron'); }
  W.walls.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y, y1: y + 1.6 });
}
function crate(x, y, z, s = 0.8, ry = 0) {
  add(P(new THREE.BoxGeometry(s, s, s), { x, y: y + s / 2, z, ry }), 'oak');
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(P(new THREE.BoxGeometry(0.06, s + 0.01, 0.06), { x: x + (a * Math.cos(ry) + b * Math.sin(ry)) * s / 2, y: y + s / 2, z: z + (-a * Math.sin(ry) + b * Math.cos(ry)) * s / 2, ry }), 'oakDark');
  W.walls.push({ x0: x - s * 0.6, x1: x + s * 0.6, z0: z - s * 0.6, z1: z + s * 0.6, y0: y, y1: y + Math.max(1.6, s) });
}

// 用原本的建模座標建造，再整體沿 x 平移 dx（觀影館從舊位置移到最內圈）：所有幾何、碰撞、座位、光源、場景物件都跟著移
function shifted(scene, dx, fn) {
  const W0 = W, L0 = LIGHTS.length;
  const mv = (c) => ({ ...c, x0: c.x0 + dx, x1: c.x1 + dx });
  W = {
    ...W0,
    box: (x0, y0, z0, x1, y1, z1, ...r) => W0.box(x0 + dx, y0, z0, x1 + dx, y1, z1, ...r),
    add: (g, k) => { g.translate(dx, 0, 0); return W0.add(g, k); },
    cyl: (rt, rb, h, x, ...r) => W0.cyl(rt, rb, h, x + dx, ...r),
    glow: (_sc, x, ...r) => W0.glow(scene, x + dx, ...r),
    walls: { push: (...cs) => W0.walls.push(...cs.map(mv)) },
    camBlock: { push: (...cs) => W0.camBlock.push(...cs.map(mv)) },
    floors: { push: (...cs) => W0.floors.push(...cs.map(mv)) },
    seats: { push: (...cs) => W0.seats.push(...cs.map((c) => ({ ...c, x: c.x + dx }))) },
  };
  const sc = { add: (...os) => { for (const o of os) { o.position.x += dx; scene.add(o); } } };
  try { fn(sc); } finally { W = W0; }
  for (const l of LIGHTS.slice(L0)) l.x += dx;
}
// 城內的地面（三層城牆都在上面）
function ground() {
  const D = DISTRICT;
  box(D.x0 - 30, -0.3, D.z0 - 30, -66, 0.05, D.z1 + 30, 'earth');
  // 外城牆以外（街道兩側看不到的地方）也擋住，維持原本街道的邊界
  W.solidOnly(-72, -1, D.z0 - 30, -66, 60, RC.z - RINGS[0].L);
  W.solidOnly(-72, -1, RC.z + RINGS[0].L, -66, 60, D.z1 + 30);
}
// 圓弧城牆：城門那段直牆以外的整圈，用很多段直牆拼成；外側每三段一座扶壁，頂端雙側女兒牆＋雉堞
function ringWall(scene, Rg) {
  const { R, L, h } = Rg, t = RING_T / 2, C = RC;
  const th0 = Math.atan2(L, Math.sqrt(R * R - L * L));
  const span = 2 * Math.PI - 2 * th0, N = Math.ceil(span * R / 7.5), d = span / N, half = Math.sin(d / 2), cd = Math.cos(d / 2);
  // 在角度 a、半徑 r0..r1、高度 y0..y1 放一段（沿切線長度 len，可再沿切線偏移 u）
  const seg = (a, r0, r1, y0, y1, key, len = null, u = 0) => {
    const ca = Math.cos(a), sa = Math.sin(a), rm = (r0 + r1) / 2 * cd;
    const g = new THREE.BoxGeometry(len ?? 2 * r1 * half + 0.06, y1 - y0, r1 - r0);
    P(g, { x: C.x + rm * ca - sa * u, y: (y0 + y1) / 2, z: C.z + rm * sa + ca * u, ry: -(a + Math.PI / 2) }); add(g, key);
  };
  for (let i = 0; i < N; i++) {
    const a = th0 + (i + 0.5) * d;
    seg(a, R - t, R + t, 0, h, 'gwStone');
    // 往外收分的牆腳（三層退台）＋石帶
    for (let k = 0; k < 3; k++) {
      const dd = (3 - k) * 0.45, y1 = 1.4 + k * 1.4;
      seg(a, R + t, R + t + dd, 0, y1, 'gwStone'); seg(a, R - t - dd, R - t, 0, y1, 'gwStone');
      seg(a, R + t + dd - 0.02, R + t + dd + 0.1, y1 - 0.25, y1, 'trim'); seg(a, R - t - dd - 0.1, R - t - dd + 0.02, y1 - 0.25, y1, 'trim');
    }
    for (const y of [14, 27]) if (y < h - 3) { seg(a, R + t, R + t + 0.35, y, y + 0.55, 'trim'); seg(a, R - t - 0.35, R - t, y, y + 0.55, 'trim'); }
    // 頂端：女兒牆與雉堞（兩側）
    seg(a, R + t - 0.5, R + t + 0.2, h, h + 1.3, 'gwStone'); seg(a, R - t - 0.2, R - t + 0.5, h, h + 1.3, 'gwStone');
    const segL = 2 * R * half, nm = Math.max(1, Math.round(segL / 2.6));
    for (let m = 0; m < nm; m++) {
      const u = (m + 0.5) * segL / nm - segL / 2;
      seg(a, R + t - 0.5, R + t + 0.2, h + 1.3, h + 2.6, 'gwStone', 1.4, u); seg(a, R - t - 0.2, R - t + 0.5, h + 1.3, h + 2.6, 'gwStone', 1.4, u);
    }
    // 牆頂步道（木棧板）
    seg(a, R - t + 0.5, R + t - 0.5, h, h + 0.08, 'oakDark');
    // 外側扶壁（三層收分）
    if (i % 3 === 1) for (let k = 0; k < 3; k++) {
      const y1 = Math.min(h - 6, 12 + k * 9), dd = 2.2 - k * 0.6;
      if (y1 <= 0) continue;
      seg(a, R + t, R + t + dd, 0, y1, 'gwStone', 2.6);
      seg(a, R + t, R + t + dd + 0.05, y1, y1 + 0.35, 'trim', 2.7);
    }
    // 內側牆面的火把（只有火光精靈，不加真的光源）
    if (i % 4 === 2) {
      const ca = Math.cos(a), sa = Math.sin(a), r = R - t - 0.42;
      const g = new THREE.BoxGeometry(0.18, 0.4, 0.18); P(g, { x: C.x + (R - t - 0.05) * ca, y: 4.2, z: C.z + (R - t - 0.05) * sa }); add(g, 'iron');
      fire(scene, C.x + r * ca, 4.55, C.z + r * sa, 1.25, 2.8, 0.55);
    }
  }
  // 塔樓：每隔約 45° 一座方塔，往外突出、比城牆高（城門兩側已有門樓）
  const nT = 8;
  for (let k = 1; k < nT; k++) {
    const a = (k / nT) * 2 * Math.PI; if (a < th0 + 0.2 || a > 2 * Math.PI - th0 - 0.2) continue;
    const H = h + 7, w = 8;
    seg(a, R - t - 0.6, R + t + 3.5, 0, H, 'gwStone', w);
    seg(a, R - t - 0.8, R + t + 3.7, H, H + 1.1, 'gwStone', w + 0.4);
    for (const u of [-3.4, -1.1, 1.1, 3.4]) { seg(a, R + t + 2.7, R + t + 3.7, H + 1.1, H + 2.3, 'gwStone', 1.2, u); seg(a, R - t - 0.8, R - t + 0.2, H + 1.1, H + 2.3, 'gwStone', 1.2, u); }
    for (const rr of [R - t - 0.3, R + t + 2.7]) for (const u of [-3.4, 3.4]) seg(a, rr - 0.5, rr + 1, H + 1.1, H + 2.3, 'gwStone', 1.2, u);
    for (const y of [10, 18, 26]) if (y < H - 4) seg(a, R + t + 3.5, R + t + 3.56, y, y + 1.6, 'soot', 0.24); // 箭孔
    // 木造防禦廊（頂端外挑的木棚，參考圖的 hoarding）
    seg(a, R + t + 3.5, R + t + 5.0, H - 3.2, H - 0.4, 'oakDark', w - 0.6);
    for (const u of [-3, -1, 1, 3]) seg(a, R + t + 3.5, R + t + 5.1, H - 3.6, H - 3.2, 'oak', 0.3, u);
    const roof = new THREE.BoxGeometry(w + 0.2, 0.12, 2.2); const ca = Math.cos(a), sa = Math.sin(a), rm = R + t + 4.6;
    P(roof, { x: C.x + rm * ca, y: H - 0.1, z: C.z + rm * sa, ry: -(a + Math.PI / 2), rx: -0.45 }); add(roof, 'roofWood');
  }
}
// 觀影館前方的石圍牆（原本在廣場上，跟著觀影館一起移）
function theaterYard(scene) {
  box(-101, 0, -12, -99.4, 3.2, -1.4, 'hStone', true); box(-101, 0, 31.4, -99.4, 3.2, 42, 'hStone', true);
  box(-101.15, 3.2, -12, -99.25, 3.45, -1.4, 'trim'); box(-101.15, 3.2, 31.4, -99.25, 3.45, 42, 'trim');
}
// 街燈（鐵柱＋燈籠）
function lantern(scene, x, z) {
  W.cyl(0.07, 0.1, 3.8, x, 0.15, z, 'iron', 8); W.cyl(0.18, 0.22, 0.3, x, 0.15, z, 'iron', 8);
  box(x - 0.2, 3.95, z - 0.2, x + 0.2, 4.5, z + 0.2, 'glassHouse');
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x + a * 0.2 - 0.02, 3.95, z + b * 0.2 - 0.02, x + a * 0.2 + 0.02, 4.5, z + b * 0.2 + 0.02, 'iron');
  const cap = new THREE.ConeGeometry(0.34, 0.36, 4); P(cap, { x, y: 4.68, z, ry: Math.PI / 4 }); add(cap, 'iron');
  W.glow(scene, x, 4.22, z, 3, 0xffc070, 0.6);
  W.walls.push({ x0: x - 0.22, x1: x + 0.22, z0: z - 0.22, z1: z + 0.22, y0: 0, y1: 5 });
}
// 石板主路（城門到城門）＋兩側卵石
function road(x0, x1, cob = true) {
  if (cob) { box(x0, -0.2, -8, x1, 0.15, 38, 'cobble'); W.floors.push({ x0, x1, z0: -8, z1: 38, y: 0.15 }); }
  box(x0, 0.15, 13.2, x1, 0.17, 16.8, 'flagstone'); W.floors.push({ x0, x1, z0: 13.2, z1: 16.8, y: 0.17 });
}
// 中城（第二道與第三道城牆之間）：兩排民居、街燈、市集攤子
function midTown(scene) {
  road(-130, -109);
  const north = [[-114, -121.5, 12.8, 8], [-121.5, -128.5, 14.2, 9]];
  const south = [[-114, -120.8, 14.6, 10], [-120.8, -128.5, 12.0, 11]];
  for (const [x0, x1, hh, i] of north) house(scene, x1, x0, -4, 1, hh, i);
  for (const [x0, x1, hh, i] of south) house(scene, x1, x0, 34, -1, hh, i);
  for (const [x, z] of [[-114, 9.4], [-114, 20.6], [-125, 9.4], [-125, 20.6]]) lantern(scene, x, z);
  LIGHTS.push({ x: -119.5, y: 4.4, z: 9.4, d: 22, off: [0xffb46a, 40], on: [0xffb46a, 40], flick: 0.2 });
  LIGHTS.push({ x: -119.5, y: 4.4, z: 20.6, d: 22, off: [0xffb46a, 40], on: [0xffb46a, 40], flick: 0.2 });
  stall(scene, -118, 2.2, 1); stall(scene, -123.5, 27.8, -1);
  barrel(-112.6, 0.15, 3.2); barrel(-113.4, 0.15, 2.4, 0.34, 0.85); crate(-128, 0.15, 27.2, 0.9, 0.4);
}
// 市集攤子：木架＋斜帆布頂＋貨物；dir：+1 朝 +z
function stall(scene, x, z, dir) {
  const w = 3.6, dpt = 1.8, zb = z - dir * dpt;
  for (const [a, b] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { const zz = b ? zb : z; W.cyl(0.06, 0.07, b ? 2.9 : 2.3, x + a * w / 2, 0.15, zz, 'oakDark', 6); }
  box(x - w / 2, 0.85, Math.min(z, zb), x + w / 2, 0.95, Math.max(z, zb), 'oak');
  box(x - w / 2, 0.15, Math.min(z, zb) + 0.1, x + w / 2, 0.85, Math.min(z, zb) + 0.18, 'oakDark');
  const cv = new THREE.BoxGeometry(w + 0.4, 0.04, dpt + 0.6); P(cv, { x, y: 2.75, z: (z + zb) / 2, rx: dir * 0.32 }); add(cv, 'canvasC');
  for (let k = 0; k < 4; k++) crate(x - w / 2 + 0.55 + k * 0.85, 0.95, (z + zb) / 2, 0.45, k * 0.3);
  W.walls.push({ x0: x - w / 2 - 0.1, x1: x + w / 2 + 0.1, z0: Math.min(z, zb), z1: Math.max(z, zb), y0: 0, y1: 2 });
}
// 內城廣場（第三道城牆內、觀影館門前）
function innerYard(scene) {
  road(-160.2, -140);
  for (const [x, z] of [[-145, 9.4], [-145, 20.6], [-154, 9.4], [-154, 20.6]]) lantern(scene, x, z);
  LIGHTS.push({ x: -149.5, y: 4.4, z: 15, d: 24, off: [0xffb46a, 44], on: [0xffb46a, 44], flick: 0.2 });
  // 旗桿（觀影館兩側）
  for (const z of [6.4, 23.6]) {
    const x = -157.6;
    W.cyl(0.08, 0.12, 9, x, 0.15, z, 'oakDark', 8);
    W.cyl(0.25, 0.32, 0.5, x, 0.15, z, 'hStone', 10);
    const k = new THREE.SphereGeometry(0.14, 10, 8); P(k, { x, y: 9.25, z }); add(k, 'brass');
    hangBanner(scene, x, 8.6, z + (z < 15 ? -0.95 : 0.95), 1.6, 4.6, 0, 'bannerG', 0.09);
    W.walls.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3, y0: 0, y1: 3 });
  }
}

// 外城與中城的田野：麥田、草垛、樹、木柵欄、農舍（三圈之間空著的地方）
function countryside(scene) {
  const C = RC, rng = mulberry(7);
  const inBand = (x, z, r0, r1) => { const d = Math.hypot(x - C.x, z - C.z); return d > r0 && d < r1; };
  const clearOfRoads = (x, z) => !(x > C.x && Math.abs(z - C.z) < 30); // 東邊的主街區不放
  // 田地：外城一圈（半徑 79–102），中城一圈（45–68）
  const HOUSES = [[-182, -174.5, -68, 1, 9.5, 12], [-201, -193, -64, 1, 10.5, 13], [-182, -174.5, 98, -1, 10, 14], [-158, -150.5, 92, -1, 9, 15], [-266, -258.5, 22, 1, 9.8, 16]];
  const fields = HOUSES.map(([x0, x1, zf, dir]) => ({ x: (x0 + x1) / 2, z: zf - dir * 4.5, w: x1 - x0 + 3, d: 12, house: true }));
  for (const [r0, r1, n] of [[80, 101, 22], [46, 67, 12]]) {
    for (let k = 0; k < n; k++) {
      const a = 0.45 + (k + rng() * 0.4) / n * (2 * Math.PI - 0.9), r = r0 + 3 + rng() * (r1 - r0 - 12);
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      const w = 7 + rng() * 6, d = 5 + rng() * 5;
      if (!clearOfRoads(x, z) || !inBand(x - w / 2, z - d / 2, r0, r1) || !inBand(x + w / 2, z + d / 2, r0, r1) || !inBand(x - w / 2, z + d / 2, r0, r1) || !inBand(x + w / 2, z - d / 2, r0, r1)) continue;
      if (fields.some((f) => Math.abs(f.x - x) < (f.w + w) / 2 + 1.5 && Math.abs(f.z - z) < (f.d + d) / 2 + 1.5)) continue;
      fields.push({ x, z, w, d });
      const key = rng() < 0.55 ? 'field' : 'fieldG';
      box(x - w / 2, 0.05, z - d / 2, x + w / 2, 0.09, z + d / 2, key);
      const along = rng() < 0.5;
      for (let q = 0.6; q < (along ? d : w) - 0.3; q += 0.75) { // 犁溝
        if (along) box(x - w / 2 + 0.15, 0.09, z - d / 2 + q, x + w / 2 - 0.15, 0.2, z - d / 2 + q + 0.32, key === 'field' ? 'straw' : 'leaf');
        else box(x - w / 2 + q, 0.09, z - d / 2 + 0.15, x - w / 2 + q + 0.32, 0.2, z + d / 2 - 0.15, key === 'field' ? 'straw' : 'leaf');
      }
      // 木柵欄（兩邊）
      for (const zz of [z - d / 2 - 0.4, z + d / 2 + 0.4]) {
        box(x - w / 2, 0.55, zz - 0.04, x + w / 2, 0.65, zz + 0.04, 'oakDark'); box(x - w / 2, 0.95, zz - 0.04, x + w / 2, 1.05, zz + 0.04, 'oakDark');
        for (let xx = x - w / 2; xx <= x + w / 2 + 0.01; xx += w / Math.ceil(w / 2.2)) box(xx - 0.06, 0.05, zz - 0.06, xx + 0.06, 1.2, zz + 0.06, 'oak');
        W.walls.push({ x0: x - w / 2, x1: x + w / 2, z0: zz - 0.1, z1: zz + 0.1, y0: 0, y1: 1.2 });
      }
      if (key === 'field' && rng() < 0.7) { // 草垛
        const hx = x + (rng() - 0.5) * (w - 2), hz = z + (rng() - 0.5) * (d - 2);
        W.cyl(0.9, 1.0, 1.2, hx, 0.09, hz, 'straw', 12);
        const cn = new THREE.ConeGeometry(1.0, 1.1, 12); P(cn, { x: hx, y: 1.84, z: hz }); add(cn, 'straw');
        W.walls.push({ x0: hx - 1, x1: hx + 1, z0: hz - 1, z1: hz + 1, y0: 0, y1: 2.4 });
      }
    }
  }
  // 樹：沿著城牆內側與田邊
  for (const [r0, r1, n] of [[79, 103, 46], [45, 69, 24], [12, 39, 10]]) {
    for (let k = 0; k < n; k++) {
      const a = 0.5 + rng() * (2 * Math.PI - 1), r = r0 + 1.5 + rng() * (r1 - r0 - 3);
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      if (!clearOfRoads(x, z)) continue;
      if (fields.some((f) => Math.abs(f.x - x) < f.w / 2 + 2 && Math.abs(f.z - z) < f.d / 2 + 2)) continue;
      if (Math.abs(x - (C.x)) < 22 && Math.abs(z - C.z) < 18) continue; // 觀影館周圍
      tree(x, z, 0.8 + rng() * 0.6, rng);
    }
  }
  // 農舍（外城的北、南、西）
  for (const [x0, x1, zf, dir, hh, i] of HOUSES) house(scene, x0, x1, zf, dir, hh, i);
}
function tree(x, z, k, rng) {
  W.cyl(0.18 * k, 0.26 * k, 2.6 * k, x, 0.05, z, 'oakDark', 7);
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry((1.3 + rng() * 0.6) * k, 0);
    P(g, { x: x + (rng() - 0.5) * 1.4 * k, y: (2.8 + i * 0.9 + rng() * 0.4) * k, z: z + (rng() - 0.5) * 1.4 * k, ry: rng() * 3 });
    add(g, i % 2 ? 'leaf' : 'leafD');
  }
  W.walls.push({ x0: x - 0.3 * k, x1: x + 0.3 * k, z0: z - 0.3 * k, z1: z + 0.3 * k, y0: 0, y1: 3 });
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 巨大城牆與城門 ----------
function greatWall(scene, G) {
  const top = G.h, r = (G.gate1 - G.gate0) / 2, gz = (G.gate0 + G.gate1) / 2;
  // 牆身：城門兩側與城門上方（城門上方用帶半圓開口的擠出形狀）
  box(G.x0, 0, G.z0, G.x1, top, G.gate0, 'gwStone', true);
  box(G.x0, 0, G.gate1, G.x1, top, G.z1, 'gwStone', true);
  {
    const outline = [[G.gate0, 0], [G.gate1, 0], [G.gate1, top], [G.gate0, top]];
    const sh = new THREE.Shape(outline.map(([u, y]) => new THREE.Vector2(u, y)));
    const hole = new THREE.Path(); hole.moveTo(G.gate0, -0.01); hole.lineTo(G.gate1, -0.01); hole.lineTo(G.gate1, G.spring); hole.absarc(gz, G.spring, r, 0, Math.PI, false); hole.lineTo(G.gate0, -0.01);
    // 用外輪廓扣掉拱洞：把開口做成外框的一部分（洞碰到邊界時 Shape 洞不可靠）
    const s2 = new THREE.Shape(); s2.moveTo(G.gate0, 0); s2.lineTo(G.gate0, G.spring); s2.absarc(gz, G.spring, r, Math.PI, 0, true); s2.lineTo(G.gate1, 0); s2.lineTo(G.gate1, top); s2.lineTo(G.gate0, top); s2.lineTo(G.gate0, 0);
    const g = new THREE.ExtrudeGeometry(s2, { depth: G.x1 - G.x0, bevelEnabled: false, curveSegments: 28 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, G.x1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)); add(g, 'gwStone');
    W.camBlock.push({ x0: G.x0, x1: G.x1, z0: G.gate0, z1: G.gate1, y0: G.spring + r - 0.2, y1: top });
  }
  // 往外收分的牆腳（三層退台）與水平石帶
  for (const [face, sgn] of [[G.x1, 1], [G.x0, -1]]) {
    for (let k = 0; k < 3; k++) {
      const d = (3 - k) * 0.45, y1 = 1.4 + k * 1.4;
      const xa = sgn > 0 ? face : face - d, xb = sgn > 0 ? face + d : face;
      box(xa, 0, G.z0, xb, y1, G.gate0 - (k === 0 ? 0 : 0), 'gwStone', k === 0 ? 'nocam' : false);
      box(xa, 0, G.gate1, xb, y1, G.z1, 'gwStone', k === 0 ? 'nocam' : false);
      box(xa, y1 - 0.25, G.z0, xb + (sgn > 0 ? 0.12 : 0), y1, G.gate0, 'trim'); box(xa - (sgn < 0 ? 0.12 : 0), y1 - 0.25, G.gate1, xb, y1, G.z1, 'trim');
    }
    for (const y of [14, 27]) {
      const xa = sgn > 0 ? face : face - 0.35, xb = sgn > 0 ? face + 0.35 : face;
      box(xa, y, G.z0, xb, y + 0.55, G.z1, 'trim');
    }
    // 雉堞與女兒牆
    const xa = sgn > 0 ? face - 0.2 : face, xb = sgn > 0 ? face + 0.25 : face - 0.45 + 0.45;
    box(Math.min(xa, xb) - (sgn < 0 ? 0.25 : 0), top, G.z0, Math.max(xa, xb) + (sgn > 0 ? 0 : 0.2), top + 1.3, G.z1, 'gwStone');
    for (let z = G.z0 + 0.8; z < G.z1 - 0.8; z += 2.6) box(sgn > 0 ? face - 0.6 : face, top + 1.3, z, sgn > 0 ? face + 0.25 : face + 0.6 - 0.35, top + 2.6, z + 1.4, 'gwStone');
    // 扶壁（每 18m 一座，城門附近讓給門樓）
    for (let z = G.z0 + 6; z < G.z1; z += 18) {
      if (z > G.gate0 - 9 && z < G.gate1 + 9) continue;
      const w = 2.6, d = 2.2;
      for (let k = 0; k < 3; k++) {
        const y1 = 12 + k * 9, dd = d - k * 0.6;
        box(sgn > 0 ? face : face - dd, 0, z - w / 2, sgn > 0 ? face + dd : face, y1, z + w / 2, 'gwStone', 'nocam');
        // 斜面收頭
        const cap = new THREE.BoxGeometry(dd * 1.05, 0.5, w + 0.1); P(cap, { x: face + sgn * dd / 2, y: y1, z, rz: sgn * 0.6 }); add(cap, 'trim');
      }
    }
  }
  // 城門門樓：街道側兩座方塔（高出城牆），開箭孔
  for (const [z0, z1] of [[G.gate0 - 5.5, G.gate0], [G.gate1, G.gate1 + 5.5]]) {
    box(G.x1, 0, z0, G.x1 + 4, top + 6, z1, 'gwStone', true);
    box(G.x1 - 0.2, top + 6, z0 - 0.2, G.x1 + 4.2, top + 7.2, z1 + 0.2, 'gwStone');
    for (const [a, b] of [[0, 1], [2.2, 3.2]]) for (const [za, zb] of [[z0 - 0.2, z0 + 1.1], [z0 + 2.1, z0 + 3.4], [z1 - 1.1, z1 + 0.2]]) box(G.x1 - 0.2 + a, top + 7.2, za, G.x1 - 0.2 + b + 0.8, top + 8.4, zb, 'gwStone');
    for (const y of [8, 16, 24, 32]) { // 箭孔
      box(G.x1 + 4, y, (z0 + z1) / 2 - 0.12, G.x1 + 4.02, y + 1.6, (z0 + z1) / 2 + 0.12, 'soot');
      box(G.x1 + 3.98, y + 0.7, (z0 + z1) / 2 - 0.4, G.x1 + 4.02, y + 0.85, (z0 + z1) / 2 + 0.4, 'soot');
    }
    for (const y of [14, 27]) box(G.x1 + 4, y, z0, G.x1 + 4.35, y + 0.55, z1, 'trim');
    W.walls.push({ x0: G.x1, x1: G.x1 + 4, z0, z1, y0: 0, y1: 60 });
    // 門樓頂端外挑的木造防禦廊
    box(G.x1 + 4, top + 2.4, z0 - 0.3, G.x1 + 5.4, top + 5.2, z1 + 0.3, 'oakDark');
    for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 3) box(G.x1 + 4, top + 2.0, z - 0.12, G.x1 + 5.5, top + 2.4, z + 0.12, 'oak');
    add(P(new THREE.BoxGeometry(2.2, 0.12, z1 - z0 + 1), { x: G.x1 + 4.9, y: top + 5.5, z: (z0 + z1) / 2, rz: 0.45 }), 'roofWood');
  }
  // 城門拱：外圈楔石（拱石）環，兩面都有
  for (const fx of [G.x1 + 0.0, G.x0]) {
    const ring = new THREE.Shape(); ring.absarc(0, 0, r + 1.1, 0, Math.PI, false); ring.lineTo(-r, 0); ring.absarc(0, 0, r, Math.PI, 0, true); ring.lineTo(r + 1.1, 0);
    const g = new THREE.ExtrudeGeometry(ring, { depth: 0.35, bevelEnabled: false, curveSegments: 28 });
    const dir = fx === G.x0 ? -1 : 1;
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, dir, fx, 0, 1, 0, G.spring, -dir, 0, 0, gz, 0, 0, 0, 1)); add(g, 'trim');
    for (let i = 0; i <= 14; i++) { // 拱石分縫
      const a = i / 14 * Math.PI; const c = Math.cos(a), s = Math.sin(a);
      add(P(new THREE.BoxGeometry(0.04, 1.12, 0.38), { x: fx + dir * 0.17, y: G.spring + s * (r + 0.55), z: gz + c * (r + 0.55), rx: -(a - Math.PI / 2) }), 'soot');
    }
    // 門柱基座
    for (const z of [G.gate0, G.gate1]) box(fx === G.x0 ? G.x0 - 0.5 : G.x1, 0, z - (z === G.gate0 ? 1.2 : 0), fx === G.x0 ? G.x0 : G.x1 + 0.5, G.spring, z + (z === G.gate1 ? 1.2 : 0), 'trim');
  }
  // 城門通道：卵石地面、通道兩側的石牆面就是牆身
  box(G.x0, 0, G.gate0, G.x1, 0.15, G.gate1, 'cobble');
  W.floors.push({ x0: G.x0 - 0.5, x1: G.x1 + 0.6, z0: G.gate0, z1: G.gate1, y: 0.15 });
  // 吊起的鐵柵門（只露出下緣的尖齒）
  {
    const xg = (G.x0 + G.x1) / 2 + 1.2;
    for (let z = G.gate0 + 0.35; z < G.gate1; z += 0.62) {
      const ah = G.spring + Math.sqrt(Math.max(0, r * r - (z - gz) ** 2));
      const y0 = Math.min(ah - 0.25, G.spring + 1.6);
      box(xg - 0.07, y0, z - 0.07, xg + 0.07, ah + 0.5, z + 0.07, 'iron');
      const tip = new THREE.ConeGeometry(0.09, 0.42, 4); P(tip, { x: xg, y: y0 - 0.2, z, rx: Math.PI }); add(tip, 'iron');
    }
    for (const y of [G.spring + 1.0, G.spring + 2.2, G.spring + 3.4]) {
      const half = Math.sqrt(Math.max(0, r * r - (y + 0.2 - G.spring) ** 2));
      if (half > 0.3) box(xg - 0.05, y, gz - half, xg + 0.05, y + 0.12, gz + half, 'iron');
    }
  }
  // 敞開的兩扇大木門（貼著通道內側的牆）
  for (const [zs, s] of [[G.gate0, 1], [G.gate1, -1]]) {
    const z0 = zs + (s > 0 ? 0.02 : -0.3), z1 = zs + (s > 0 ? 0.3 : -0.02), xa = G.x0 + 0.4, xb = G.x0 + 0.4 + r;
    box(xa, 0.15, Math.min(z0, z1), xb, G.spring, Math.max(z0, z1), 'oakDark');
    for (const y of [1.2, 3.6, 6.0, 8.0]) box(xa - 0.02, y, Math.min(z0, z1) - 0.03, xb + 0.02, y + 0.18, Math.max(z0, z1) + 0.03, 'iron');
    for (let k = 0; k < 6; k++) { const x = xa + 0.3 + k * (r - 0.6) / 5; for (const y of [1.29, 3.69, 6.09, 8.09]) { const n = new THREE.SphereGeometry(0.045, 6, 4); P(n, { x, y, z: s > 0 ? Math.max(z0, z1) + 0.04 : Math.min(z0, z1) - 0.04 }); add(n, 'iron'); } }
  }
  // 城門上方的石刻紋章（兩面）
  for (const [fx, ry] of [[G.x1 + 0.03, Math.PI / 2], [G.x0 - 0.03, -Math.PI / 2]]) {
    const m = new THREE.PlaneGeometry(5.2, 5.2); P(m, { x: fx, y: G.spring + r + 4.8, z: gz, ry }); add(m, 'crestStone');
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1), new THREE.MeshStandardMaterial({ map: T.textTexture([G.label], { w: 2048, h: 250, font: '600 150px "Cinzel", serif', color: '#3d3a35', letter: 30, fit: 1900 }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.9 }));
  plate.position.set(G.x1 + 0.04, G.spring + r + 1.75, gz); plate.rotation.y = Math.PI / 2; scene.add(plate);
  box(G.x1, G.spring + r + 1.05, gz - 5, G.x1 + 0.3, G.spring + r + 1.2, gz + 5, 'trim'); box(G.x1, G.spring + r + 2.35, gz - 5, G.x1 + 0.3, G.spring + r + 2.5, gz + 5, 'trim');
  // 火把：街道側與城內側各兩支
  for (const z of [G.gate0 - 0.9, G.gate1 + 0.9]) { torch(scene, G.x1 + 4, 4.4, z < gz ? G.gate0 - 2.75 : G.gate1 + 2.75, 1, 0); torch(scene, G.x0, 4.4, z, -1, 0); }
  LIGHTS.push({ x: G.x0 - 2.5, y: 4.6, z: gz, d: 18, off: [0xff9a48, 34], on: [0xff9a48, 34], flick: 1 });
  // 城牆上懸掛的長旗（街道側，門樓兩側）
  for (const z of [Math.max(G.z0 + 2.2, G.gate0 - 14), Math.min(G.z1 - 2.2, G.gate1 + 14)]) hangBanner(scene, G.x1 + 0.2, top - 6, z, 3.2, Math.min(11, top * 0.3), Math.PI / 2, 'bannerG', 0.12);
}

// ---------- 城內廣場與民居 ----------
function plaza(scene) {
  // 外城（第一道與第二道城牆之間）：卵石廣場，中央一條石板路通往下一道城門
  road(-103, -72);
  // 兩排民居（山牆面向廣場）
  const north = [[-76, -82, 13.5, 0], [-82, -87.6, 11.6, 1], [-87.6, -93.8, 14.6, 2], [-93.8, -100, 12.4, 3]];
  const south = [[-76, -81.6, 12.2, 4], [-81.6, -88, 15, 5], [-88, -93.6, 11.8, 6], [-93.6, -100, 13.6, 7]];
  for (const [x0, x1, h, i] of north) house(scene, x1, x0, -4, 1, h, i);
  for (const [x0, x1, h, i] of south) house(scene, x1, x0, 34, -1, h, i);
  // 水井
  {
    const x = -84, z = 4.2;
    W.cyl(1.25, 1.35, 0.95, x, 0.15, z, 'hStone', 20);
    W.cyl(1.32, 1.32, 0.12, x, 1.1, z, 'trim', 20);
    W.cyl(1.0, 1.0, 0.02, x, 0.9, z, 'soot', 16);
    for (const s of [-1, 1]) box(x - 0.08 + s * 1.05, 1.1, z - 0.08, x + 0.08 + s * 1.05, 3.4, z + 0.08, 'oakDark');
    const ax = new THREE.CylinderGeometry(0.06, 0.06, 2.3, 8); P(ax, { x, y: 2.75, z, rz: Math.PI / 2 }); add(ax, 'oak');
    const rope = new THREE.CylinderGeometry(0.012, 0.012, 1.3, 4); P(rope, { x, y: 2.1, z }); add(rope, 'straw');
    W.cyl(0.16, 0.13, 0.26, x, 1.3, z, 'oak', 10);
    for (const s of [-1, 1]) { const rf = new THREE.BoxGeometry(2.6, 0.08, 1.2); P(rf, { x, y: 3.65, z: z + s * 0.42, rx: s * 0.75 }); add(rf, 'slate'); }
    W.walls.push({ x0: x - 1.35, x1: x + 1.35, z0: z - 1.35, z1: z + 1.35, y0: 0, y1: 1.8 });
  }
  for (const [x, z] of [[-77, 9.4], [-77, 20.6], [-93, 9.4], [-93, 20.6]]) lantern(scene, x, z);
  LIGHTS.push({ x: -85, y: 4.4, z: 9.4, d: 22, off: [0xffb46a, 40], on: [0xffb46a, 40], flick: 0.2 });
  LIGHTS.push({ x: -85, y: 4.4, z: 20.6, d: 22, off: [0xffb46a, 40], on: [0xffb46a, 40], flick: 0.2 });
  // 推車、木桶、木箱、乾草
  {
    const x = -80, z = 29.4;
    box(x - 1.4, 0.75, z - 0.75, x + 1.4, 0.85, z + 0.75, 'oak');
    for (const s of [-1, 1]) box(x - 1.4, 0.85, z + s * 0.72 - 0.04, x + 1.4, 1.3, z + s * 0.72 + 0.04, 'oak');
    box(x - 1.44, 0.85, z - 0.75, x - 1.36, 1.3, z + 0.75, 'oak');
    for (const s of [-1, 1]) { const wh = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 16); P(wh, { x: x + 0.3, y: 0.7, z: z + s * 0.86, rx: Math.PI / 2 }); add(wh, 'oakDark'); const hub = new THREE.TorusGeometry(0.55, 0.04, 4, 20); P(hub, { x: x + 0.3, y: 0.7, z: z + s * 0.92 }); add(hub, 'iron'); }
    const shaft = new THREE.BoxGeometry(2.2, 0.08, 0.08); for (const s of [-1, 1]) { P(shaft.clone(), { x: x + 2.4, y: 0.55, z: z + s * 0.5, rz: 0.22 }); add(P(shaft.clone(), { x: x + 2.4, y: 0.55, z: z + s * 0.5, rz: 0.22 }), 'oak'); }
    const hay = new THREE.SphereGeometry(1, 12, 8); hay.scale(1.3, 0.45, 0.68); P(hay, { x, y: 1.25, z }); add(hay, 'straw');
    W.walls.push({ x0: x - 1.5, x1: x + 3.4, z0: z - 1, z1: z + 1, y0: 0, y1: 1.8 });
  }
  barrel(-76, 0.15, -2.4); barrel(-76.8, 0.15, -1.6, 0.34, 0.85); barrel(-97.6, 0.15, 32.2); crate(-96.4, 0.15, 32.4, 0.9, 0.3); crate(-96.4, 1.05, 32.4, 0.7, 0.1);
  crate(-76.4, 0.15, 32.2, 0.9, 0.2); barrel(-77.6, 0.15, 32.4);
  // 廣場上的旗桿
  for (const z of [9.6, 20.4]) {
    W.cyl(0.08, 0.12, 9, -96.4, 0.15, z, 'oakDark', 8);
    W.cyl(0.25, 0.32, 0.5, -96.4, 0.15, z, 'hStone', 10);
    const k = new THREE.SphereGeometry(0.14, 10, 8); P(k, { x: -96.4, y: 9.25, z }); add(k, 'brass');
    hangBanner(scene, -96.4, 8.6, z + (z < 15 ? -0.95 : 0.95), 1.6, 4.6, 0, z < 15 ? 'bannerG' : 'bannerR', 0.09);
    W.walls.push({ x0: -98.9, x1: -98.3, z0: z - 0.3, z1: z + 0.3, y0: 0, y1: 3 });
  }
}

// 半木構造民居：x0..x1、正面在 zf，dir：+1 正面朝 +z（北排），-1 朝 -z（南排）
function house(scene, x0, x1, zf, dir, h, i) {
  const D = 9, zb = zf - dir * D, zA = Math.min(zf, zb), zB = Math.max(zf, zb), w = x1 - x0, cx = (x0 + x1) / 2;
  const jet = 0.4, gf = 3.3; // 二樓外挑、一樓高度
  const plaster = i % 3 === 1 ? 'limeW' : 'limeP';
  // 一樓石造
  box(x0, 0, zA, x1, gf, zB, 'hStone', true);
  // 樓上（外挑）
  const zfJ = zf + dir * jet;
  const za2 = Math.min(zfJ, zb), zb2 = Math.max(zfJ, zb);
  box(x0, gf, za2, x1, h, zb2, plaster, 'nocam');
  W.camBlock.push({ x0, x1, z0: za2, z1: zb2, y0: gf, y1: h });
  // 山牆（三角形）＋陡峭屋頂
  const pitch = 1.05, rise = (w / 2) * Math.tan(pitch);
  {
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: zb2 - za2, bevelEnabled: false }); g.translate(cx, h, za2); add(g, plaster);
    const len = (w / 2 + 0.55) / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const rf = new THREE.BoxGeometry(len, 0.22, zb2 - za2 + 0.9);
      P(rf, { x: cx + s * (w / 4 - 0.55 / 2) + s * 0.05, y: h + rise / 2 - 0.15 + 0.12, z: (za2 + zb2) / 2, rz: -s * pitch }); add(rf, 'slate');
    }
    add(P(new THREE.BoxGeometry(0.3, 0.3, zb2 - za2 + 0.9), { x: cx, y: h + rise + 0.05, z: (za2 + zb2) / 2, rz: Math.PI / 4 }), 'slate');
    // 屋頂老虎窗
    if (w > 6.6) for (const s of [-1, 1]) {
      const dz = (za2 + zb2) / 2 + s * 1.8 * 0, dx = cx + s * w * 0.22, dy = h + rise * 0.38;
      box(dx - 0.55, dy, dz - 0.6, dx + 0.55, dy + 1.2, dz + 0.6, plaster);
      const dr = new THREE.BoxGeometry(0.9, 0.12, 1.5); for (const t of [-1, 1]) add(P(dr.clone(), { x: dx + t * 0.35, y: dy + 1.45, z: dz, rz: -t * 0.75 }), 'slate');
    }
  }
  // 木構架（正面）：face 在 zfJ 外側 0.05
  const fz = zfJ + dir * 0.06, face = { axis: 'x', at: fz };
  const bw = 0.2, bd = 0.12;
  const floorsY = [gf, gf + (h - gf) / 2, h];
  for (const y of floorsY) box(x0 - 0.1, y - 0.14, fz - bd / 2, x1 + 0.1, y + 0.1, fz + bd / 2, 'timber');
  const nB = Math.max(3, Math.round(w / 1.6)), bwid = w / nB;
  for (let k = 0; k <= nB; k++) { const x = x0 + k * bwid; box(x - bw / 2, gf, fz - bd / 2, x + bw / 2, h, fz + bd / 2, 'timber'); }
  // 斜撐（「人字」與 K 形交替），窗戶放在中間開間
  for (let f = 0; f < 2; f++) {
    const ya = floorsY[f], yb = floorsY[f + 1];
    for (let k = 0; k < nB; k++) {
      const xa = x0 + k * bwid, xb = xa + bwid;
      const isWin = k > 0 && k < nB - 1;
      if (isWin) {
        const wy0 = ya + 0.75, wy1 = yb - 0.45, wx0 = xa + 0.28, wx1 = xb - 0.28;
        box(xa, wy0 - 0.12, fz - bd / 2, xb, wy0, fz + bd / 2, 'timber'); // 窗台橫木
        const lit = ((i * 7 + k * 3 + f * 5) % 5) < 2;
        box(wx0, wy0, Math.min(fz, fz - dir * 0.08), wx1, wy1, Math.max(fz, fz - dir * 0.08), lit ? 'glassHouse' : 'glassDarkH');
        for (const xm of [(wx0 + wx1) / 2]) box(xm - 0.03, wy0, fz - 0.04, xm + 0.03, wy1, fz + 0.04, 'timber');
        box(wx0, (wy0 + wy1) / 2 - 0.03, fz - 0.04, wx1, (wy0 + wy1) / 2 + 0.03, fz + 0.04, 'timber');
        // 百葉窗板（打開貼在兩側）
        for (const sx of [-1, 1]) { const sxx = sx < 0 ? wx0 - 0.03 : wx1 + 0.03; box(Math.min(sxx, sxx + sx * 0.34), wy0, fz + dir * 0.02, Math.max(sxx, sxx + sx * 0.34), wy1, fz + dir * 0.09, i % 2 ? 'oak' : 'oakDark'); }
        if (lit) W.glow(scene, (wx0 + wx1) / 2, (wy0 + wy1) / 2, fz + dir * 0.3, 1.6, 0xffb860, 0.3);
      } else {
        const up = (k === 0) === (f === 0);
        beamFace(face, xa + bw / 2, up ? ya : yb, xb - bw / 2, up ? yb : ya, 0.17, bd, 'timber');
      }
    }
  }
  // 山牆上的木構：沿屋頂斜邊、中柱、橫梁
  beamFace(face, x0, h, cx, h + rise, 0.2, bd, 'timber'); beamFace(face, cx, h + rise, x1, h, 0.2, bd, 'timber');
  box(cx - bw / 2, h, fz - bd / 2, cx + bw / 2, h + rise, fz + bd / 2, 'timber');
  box(x0 + w * 0.2, h + rise * 0.45 - 0.1, fz - bd / 2, x1 - w * 0.2, h + rise * 0.45 + 0.1, fz + bd / 2, 'timber');
  // 山牆上的小窗
  { const wy = h + rise * 0.15; const lit = i % 2 === 0; box(cx - 0.75, wy, Math.min(fz, fz - dir * 0.08), cx - 0.2, wy + 0.8, Math.max(fz, fz - dir * 0.08), lit ? 'glassHouse' : 'glassDarkH'); box(cx + 0.2, wy, Math.min(fz, fz - dir * 0.08), cx + 0.75, wy + 0.8, Math.max(fz, fz - dir * 0.08), lit ? 'glassHouse' : 'glassDarkH'); }
  // 一樓：拱形木門、店面窗、門燈
  const sf = zf + dir * 0.02, dxm = i % 2 ? x0 + 1.4 : x1 - 1.4;
  {
    const dw = 1.2, dh = 2.3;
    box(dxm - dw / 2 - 0.2, 0, Math.min(sf, sf + dir * 0.12), dxm + dw / 2 + 0.2, dh + 0.35, Math.max(sf, sf + dir * 0.12), 'trim');
    box(dxm - dw / 2, 0.15, Math.min(sf, sf + dir * 0.14), dxm + dw / 2, dh, Math.max(sf, sf + dir * 0.14), 'oakDark');
    for (const y of [0.6, 1.7]) box(dxm - dw / 2, y, Math.min(sf, sf + dir * 0.17), dxm + dw / 2, y + 0.07, Math.max(sf, sf + dir * 0.17), 'iron');
    const sx0 = i % 2 ? dxm + 1.2 : x0 + 0.9, sx1 = i % 2 ? x1 - 0.9 : dxm - 1.2;
    if (sx1 - sx0 > 1) {
      box(sx0 - 0.15, 0.85, Math.min(sf, sf + dir * 0.1), sx1 + 0.15, 2.65, Math.max(sf, sf + dir * 0.1), 'trim');
      box(sx0, 1.0, Math.min(sf, sf + dir * 0.14), sx1, 2.5, Math.max(sf, sf + dir * 0.14), i % 3 ? 'glassHouse' : 'glassDarkH');
      for (let x = sx0 + 0.5; x < sx1 - 0.2; x += 0.5) box(x - 0.025, 1.0, Math.min(sf, sf + dir * 0.17), x + 0.025, 2.5, Math.max(sf, sf + dir * 0.17), 'timber');
      if (i % 3) W.glow(scene, (sx0 + sx1) / 2, 1.8, sf + dir * 0.4, 2.2, 0xffb05a, 0.28);
      // 遮雨棚
      add(P(new THREE.BoxGeometry(sx1 - sx0 + 0.6, 0.05, 1.0), { x: (sx0 + sx1) / 2, y: 2.85, z: sf + dir * 0.45, rx: dir * 0.35 }), i % 2 ? 'canvasC' : 'oak');
    }
    // 門邊的壁燈
    const lx = dxm + (i % 2 ? -1 : 1) * 1.0;
    box(lx - 0.12, 2.5, Math.min(sf, sf + dir * 0.36), lx + 0.12, 2.85, Math.max(sf, sf + dir * 0.36), 'glassHouse');
    W.glow(scene, lx, 2.68, sf + dir * 0.3, 1.6, 0xffc070, 0.45);
    // 吊招牌
    if (i % 2 === 0) {
      const ax = new THREE.BoxGeometry(0.05, 0.05, 1.1); P(ax, { x: dxm + (i % 4 ? 1 : -1) * 1.6, y: 3.0, z: sf + dir * 0.55 }); add(ax, 'iron');
      add(P(new THREE.BoxGeometry(0.06, 0.6, 0.8), { x: dxm + (i % 4 ? 1 : -1) * 1.6, y: 2.6, z: sf + dir * 0.75 }), 'oak');
    }
  }
}

// ---------- 觀影館外觀 ----------
const LIGHTS = []; // 借用殿堂的光源：[{ x, y, z, d, off:[色, 強度], on:[色, 強度], flick }]
function theaterHall(scene) {
  const H = TH0, t = H.t, gz = (H.z0 + H.z1) / 2;
  // 階梯山牆的輪廓（u = z），比屋頂高出 0.7m
  const stepped = () => {
    const pts = [[H.z0, 0], [H.z1, 0], [H.z1, H.eave]];
    const N = 6, half = (H.z1 - H.z0) / 2, sw = half / (N + 0.5);
    const hAt = (z) => roofY(z) + 0.9;
    let y = H.eave;
    for (let k = 0; k < N; k++) { const z = H.z1 - k * sw; const ny = hAt(z - sw); pts.push([z, ny]); pts.push([z - sw, ny]); y = ny; }
    const apex = H.ridge + 2.2;
    pts.push([gz + sw / 2, apex]); pts.push([gz - sw / 2, apex]);
    for (let k = N - 1; k >= 0; k--) { const z = H.z0 + k * sw; const ny = hAt(z + sw); pts.push([z + sw, ny]); pts.push([z, ny]); }
    pts.push([H.z0, H.eave]);
    return { pts, N, sw, hAt, apex };
  };
  const sg = stepped();
  // 東面（入口）：圓拱大門、兩扇尖拱長窗、山牆上的圓窗
  const door = { z0: gz - 2.2, z1: gz + 2.2, ys: 4.2 };
  const winE = [[gz - 8.4, gz - 7.0], [gz + 7.0, gz + 8.4]];
  const rose = { y: 14.5, r: 1.7 };
  {
    const holes = [archPath(door.z0, door.z1, 0, door.ys, false)];
    for (const [a, b] of winE) holes.push(archPath(a, b, 3.2, 7.4, true));
    const rh = new THREE.Path(); rh.absarc(gz, rose.y, rose.r, 0, Math.PI * 2, true); holes.push(rh);
    // 門的開口碰到地面：把外框在門的位置往上折
    const o = sg.pts.slice();
    const sh = new THREE.Shape();
    sh.moveTo(H.z0, 0); sh.lineTo(door.z0, 0); sh.lineTo(door.z0, door.ys); sh.absarc(gz, door.ys, 2.2, Math.PI, 0, true); sh.lineTo(door.z1, 0);
    for (const [u, y] of o.slice(1)) sh.lineTo(u, y);
    for (const h of holes.slice(1)) sh.holes.push(h);
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 18 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, H.x1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)); add(g, 'hStone');
  }
  // 西面（螢幕牆）：只有山牆上的圓窗
  {
    const rh = new THREE.Path(); rh.absarc(gz, rose.y, rose.r * 0.8, 0, Math.PI * 2, true);
    holedWall({ axis: 'z', at: H.x0 + t }, sg.pts, [rh], t, 'hStone');
  }
  // 南北側牆：尖拱長窗（北牆中間是壁爐，不開窗）
  const trussX = [-105, -110, -115, -120, -125, -130];
  const winX = [-107.5, -112.5, -122.5, -127.5];
  for (const [z, north] of [[H.z0, true], [H.z1 - t, false]]) {
    const holes = winX.map((x) => archPath(x - 0.75, x + 0.75, 3.4, 7.3, true));
    if (!north) holes.splice(2, 0, archPath(-118.25, -116.75, 3.4, 7.3, true));
    holedWall({ axis: 'x', at: z }, [[H.x0, 0], [H.x1, 0], [H.x1, H.eave], [H.x0, H.eave]], holes, t, 'hStone');
    // 扶壁
    const zo = north ? z : z + t, s = north ? -1 : 1;
    for (const x of [...trussX, H.x0 + 0.8]) {
      if (x === H.x0 + 0.8) continue;
      box(x - 0.55, 0, Math.min(zo, zo + s * 1.4), x + 0.55, 6.5, Math.max(zo, zo + s * 1.4), 'hStone', 'nocam');
      box(x - 0.55, 6.5, Math.min(zo, zo + s * 0.8), x + 0.55, 9.6, Math.max(zo, zo + s * 0.8), 'hStone', 'nocam');
      add(P(new THREE.BoxGeometry(1.15, 0.35, 1.0), { x, y: 6.55, z: zo + s * 1.0, rx: -s * 0.75 }), 'trim');
      add(P(new THREE.BoxGeometry(1.15, 0.35, 0.7), { x, y: 9.62, z: zo + s * 0.5, rx: -s * 0.75 }), 'trim');
      W.walls.push({ x0: x - 0.55, x1: x + 0.55, z0: Math.min(zo, zo + s * 1.4), z1: Math.max(zo, zo + s * 1.4), y0: 0, y1: 10 });
    }
    // 牆頂簷口、牆腳
    box(H.x0, H.eave - 0.35, Math.min(zo, zo + s * 0.35), H.x1, H.eave, Math.max(zo, zo + s * 0.35), 'trim');
    box(H.x0, 0, Math.min(zo, zo + s * 0.3), H.x1, 0.8, Math.max(zo, zo + s * 0.3), 'trim', 'nocam');
  }
  // 窗戶玻璃：外面看是暖光、裡面看是夜色
  const glass = (face, path, inOff, outOff, outFlip) => { shapePlane(face, path, outOff, outFlip, 'glassLit'); shapePlane(face, path, inOff, !outFlip, 'glassNight'); };
  for (const x of winX) { glass({ axis: 'x', at: H.z0 }, archPath(x - 0.75, x + 0.75, 3.4, 7.3, true, THREE.Shape), 0.7, 0.5, true); glass({ axis: 'x', at: H.z1 - t }, archPath(x - 0.75, x + 0.75, 3.4, 7.3, true, THREE.Shape), 0.5, 0.7, false); }
  glass({ axis: 'x', at: H.z1 - t }, archPath(-118.25, -116.75, 3.4, 7.3, true, THREE.Shape), 0.5, 0.7, false);
  for (const [a, b] of winE) glass({ axis: 'z', at: H.x1 }, archPath(a, b, 3.2, 7.4, true, THREE.Shape), 0.7, 0.5, true);
  { const c = new THREE.Shape(); c.absarc(gz, rose.y, rose.r, 0, Math.PI * 2, false); glass({ axis: 'z', at: H.x1 }, c, 0.7, 0.5, true); }
  { const c = new THREE.Shape(); c.absarc(gz, rose.y, rose.r * 0.8, 0, Math.PI * 2, false); glass({ axis: 'z', at: H.x0 + t }, c, 0.5, 0.7, false); }
  // 圓窗石框與輻條（東面）
  {
    const ring = new THREE.TorusGeometry(rose.r + 0.14, 0.2, 8, 40); P(ring, { x: H.x1 + 0.08, y: rose.y, z: gz, ry: Math.PI / 2 }); add(ring, 'trim');
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI; add(P(new THREE.BoxGeometry(0.1, rose.r * 2, 0.1), { x: H.x1 - 0.5, y: rose.y, z: gz, rx: a }), 'trim'); }
    const hub = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16); P(hub, { x: H.x1 - 0.5, y: rose.y, z: gz, rz: Math.PI / 2 }); add(hub, 'trim');
  }
  // 窗框石材（東面長窗）
  for (const [a, b] of winE) { box(H.x1, 3.0, a - 0.25, H.x1 + 0.18, 3.25, b + 0.25, 'trim'); }
  // 階梯山牆的壓頂石
  {
    const { N, sw, hAt, apex } = sg;
    for (const [x, xo] of [[H.x1, 1], [H.x0, -1]]) {
      for (let k = 0; k < N; k++) for (const [za, zb] of [[H.z1 - (k + 1) * sw, H.z1 - k * sw], [H.z0 + k * sw, H.z0 + (k + 1) * sw]]) {
        const yy = hAt(za < gz ? zb : za);
        box(Math.min(x, x - xo * t) - 0.12, yy, za - 0.08, Math.max(x, x - xo * t) + 0.12, yy + 0.25, zb + 0.08, 'trim');
      }
      box(Math.min(x, x - xo * t) - 0.12, apex, gz - sw / 2 - 0.08, Math.max(x, x - xo * t) + 0.12, apex + 0.25, gz + sw / 2 + 0.08, 'trim');
      const fin = new THREE.ConeGeometry(0.3, 1.4, 4); P(fin, { x: x - xo * t / 2, y: apex + 0.95, z: gz }); add(fin, 'trim');
    }
  }
  // 屋頂（石板瓦；室內是木板）
  for (const s of [-1, 1]) {
    const zE = s < 0 ? H.z0 - 0.7 : H.z1 + 0.7, yE = H.eave - 0.7 * ((H.ridge - H.eave) / ((H.z1 - H.z0) / 2)) + 0.35;
    const zR = gz, yR = H.ridge + 0.35;
    const dz = zR - zE, dy = yR - yE, len = Math.hypot(dz, dy), ang = -Math.atan2(dy, dz);
    add(P(new THREE.BoxGeometry(H.x1 - H.x0 - 0.6, 0.3, len), { x: (H.x0 + H.x1) / 2, y: (yE + yR) / 2 + 0.15, z: (zE + zR) / 2, rx: ang }), 'slate');
    // 室內天花木板：在屋頂下面
    const zi = s < 0 ? IN.z0 : IN.z1, yi = roofY(zi);
    const dz2 = zR - zi, dy2 = H.ridge - yi, len2 = Math.hypot(dz2, dy2);
    add(P(new THREE.BoxGeometry(IN.x1 - IN.x0 + 0.02, 0.06, len2), { x: (IN.x0 + IN.x1) / 2, y: (yi + H.ridge) / 2 - 0.03, z: (zi + zR) / 2, rx: -Math.atan2(dy2, dz2) }), 'roofWood');
  }
  add(P(new THREE.BoxGeometry(H.x1 - H.x0 - 0.6, 0.4, 0.4), { x: (H.x0 + H.x1) / 2, y: H.ridge + 0.55, z: gz, rx: Math.PI / 4 }), 'slate');
  // 屋脊上的小塔樓（鐘樓）
  {
    const x = -118, yb = H.ridge - 0.2;
    box(x - 1.2, yb, gz - 1.2, x + 1.2, yb + 3.6, gz + 1.2, 'timber');
    for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) box(x + a * 1.2 - (a ? 0.04 : 0.8), yb + 1.6, gz + b * 1.2 - (b ? 0.04 : 0.8), x + a * 1.2 + (a ? 0.04 : 0.8), yb + 3.0, gz + b * 1.2 + (b ? 0.04 : 0.8), 'soot');
    const sp = new THREE.ConeGeometry(1.9, 5.6, 8); P(sp, { x, y: yb + 3.6 + 2.8, z: gz, ry: Math.PI / 8 }); add(sp, 'slate');
    const ball = new THREE.SphereGeometry(0.2, 10, 8); P(ball, { x, y: yb + 9.6, z: gz }); add(ball, 'brass');
    add(P(new THREE.BoxGeometry(0.05, 1.2, 0.05), { x, y: yb + 10.2, z: gz }), 'iron');
  }
  // 兩座前角圓塔（錐形石板瓦頂）
  for (const z of [H.z0, H.z1]) {
    const x = H.x1, R = 2.9, th = 19;
    W.cyl(R, R + 0.25, th, x, 0, z, 'hStone', 28);
    W.cyl(R + 0.35, R + 0.35, 0.5, x, th - 0.2, z, 'trim', 28);
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; box(x + Math.cos(a) * R - 0.12, 2.5, z + Math.sin(a) * R - 0.12, x + Math.cos(a) * R + 0.12, 2.8, z + Math.sin(a) * R + 0.12, 'trim'); }
    const cone = new THREE.ConeGeometry(R + 0.6, 8.5, 28); P(cone, { x, y: th + 0.3 + 4.25, z }); add(cone, 'slate');
    const ball = new THREE.SphereGeometry(0.18, 10, 8); P(ball, { x, y: th + 8.85, z }); add(ball, 'brass');
    add(P(new THREE.BoxGeometry(0.06, 1.4, 0.06), { x, y: th + 9.5, z }), 'iron');
    // 箭孔窗（透出暖光）
    for (const [y, a] of [[6, 0.35], [11, -0.35], [15.4, 0]]) {
      const ax = x + Math.cos(a) * (R + 0.02), az = z + Math.sin(a) * (R + 0.02) * (z < 15 ? -1 : 1) * -1;
      add(P(new THREE.BoxGeometry(0.06, 1.3, 0.28), { x: ax, y: y + 0.65, z: az, ry: -a * (z < 15 ? -1 : 1) }), 'glassLit');
    }
    W.walls.push({ x0: x - R, x1: x + R, z0: z - R, z1: z + R, y0: 0, y1: 30 });
    W.camBlock.push({ x0: x - R * 0.8, x1: x + R * 0.8, z0: z - R * 0.8, z1: z + R * 0.8, y0: 0, y1: 28 });
  }
  // 羅馬式大門：三層退縮的拱圈、門框、敞開的鐵件木門
  {
    for (let k = 0; k < 3; k++) {
      const rr = 2.2 + 0.32 * (k + 1), xo = H.x1 + 0.02 + k * 0.0;
      const ring = new THREE.Shape(); ring.absarc(0, 0, rr + 0.3, 0, Math.PI, false); ring.lineTo(-rr, 0); ring.absarc(0, 0, rr, Math.PI, 0, true); ring.lineTo(rr + 0.3, 0);
      const g = new THREE.ExtrudeGeometry(ring, { depth: 0.3 + (2 - k) * 0.25, bevelEnabled: false, curveSegments: 24 });
      g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, xo, 0, 1, 0, door.ys, -1, 0, 0, gz, 0, 0, 0, 1)); add(g, 'trim');
      for (const s of [-1, 1]) { const cz = gz + s * (rr + 0.15); const col = new THREE.CylinderGeometry(0.15, 0.15, door.ys, 12); P(col, { x: xo + 0.15, y: door.ys / 2, z: cz }); add(col, 'trim'); const cap = new THREE.BoxGeometry(0.5, 0.25, 0.5); P(cap, { x: xo + 0.15, y: door.ys - 0.1, z: cz }); add(cap, 'trim'); }
    }
    const lint = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.85), new THREE.MeshStandardMaterial({ map: T.textTexture(['MAUERHALLE'], { w: 2048, h: 240, font: '600 160px "Cinzel", serif', color: '#2f2b26', letter: 34, fit: 1900 }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.9 }));
    lint.position.set(H.x1 + 0.04, 8.25, gz); lint.rotation.y = Math.PI / 2; scene.add(lint);
    box(H.x1, 7.65, gz - 3.8, H.x1 + 0.22, 7.8, gz + 3.8, 'trim'); box(H.x1, 8.7, gz - 3.8, H.x1 + 0.22, 8.85, gz + 3.8, 'trim');
    const cr = new THREE.PlaneGeometry(2.6, 2.6); P(cr, { x: H.x1 + 0.05, y: 10.4, z: gz, ry: Math.PI / 2 }); add(cr, 'crestGold');
    // 兩扇向內敞開的門
    for (const s of [-1, 1]) {
      const zh = gz + s * 2.15, x0 = H.x1 - t - 2.1, x1 = H.x1 - t + 0.0;
      box(x0, 0.15, Math.min(zh, zh - s * 0.14), x1, 5.2, Math.max(zh, zh - s * 0.14), 'oakDark');
      for (const y of [0.8, 2.4, 4.0]) box(x0 - 0.02, y, Math.min(zh, zh - s * 0.18), x1, y + 0.12, Math.max(zh, zh - s * 0.18), 'iron');
      const ring = new THREE.TorusGeometry(0.16, 0.025, 6, 16); P(ring, { x: x0 + 0.4, y: 2.0, z: zh - s * 0.2 }); add(ring, 'iron');
    }
    // 門檻
    box(H.x1 - t, 0, door.z0, H.x1 + 0.6, 0.27, door.z1, 'trim');
    W.floors.push({ x0: H.x1 - t - 0.1, x1: H.x1 + 0.6, z0: door.z0, z1: door.z1, y: 0.27 });
  }
  // 立面上的長旗與火把
  hangBanner(scene, H.x1 + 0.35, 10.0, gz - 4.6, 1.7, 5.6, Math.PI / 2, 'bannerG', 0.04);
  hangBanner(scene, H.x1 + 0.35, 10.0, gz + 4.6, 1.7, 5.6, Math.PI / 2, 'bannerG', 0.04);
  torch(scene, H.x1, 3.6, gz - 3.3, 1, 0); torch(scene, H.x1, 3.6, gz + 3.3, 1, 0);
  // 碰撞：牆身（門留開口）
  W.walls.push({ x0: H.x0, x1: H.x0 + t, z0: H.z0, z1: H.z1, y0: 0, y1: 30 });
  W.walls.push({ x0: H.x0, x1: H.x1, z0: H.z0, z1: H.z0 + t, y0: 0, y1: 30 });
  W.walls.push({ x0: H.x0, x1: H.x1, z0: H.z1 - t, z1: H.z1, y0: 0, y1: 30 });
  W.walls.push({ x0: H.x1 - t, x1: H.x1, z0: H.z0, z1: door.z0, y0: 0, y1: 30 });
  W.walls.push({ x0: H.x1 - t, x1: H.x1, z0: door.z1, z1: H.z1, y0: 0, y1: 30 });
  W.walls.push({ x0: H.x1 - t - 2.1, x1: H.x1 - t, z0: door.z0 - 0.2, z1: door.z0 + 0.05, y0: 0, y1: 6 }, { x0: H.x1 - t - 2.1, x1: H.x1 - t, z0: door.z1 - 0.05, z1: door.z1 + 0.2, y0: 0, y1: 6 });
  for (const c of [[H.x0, H.x0 + t, H.z0, H.z1], [H.x0, H.x1, H.z0, H.z0 + t], [H.x0, H.x1, H.z1 - t, H.z1], [H.x1 - t, H.x1, H.z0, door.z0], [H.x1 - t, H.x1, door.z1, H.z1]]) W.camBlock.push({ x0: c[0], x1: c[1], z0: c[2], z1: c[3], y0: 0, y1: 30 });
  W.camBlock.push({ x0: H.x1 - t, x1: H.x1, z0: door.z0, z1: door.z1, y0: door.ys + 2.2, y1: 30 });
  // 光源（借用）：立面火把
  LIGHTS.push({ x: H.x1 + 3.2, y: 5, z: gz, d: 30, off: [0xffa858, 110], on: [0xffa858, 110], flick: 0.5 });
}

// ---------- 觀影館室內 ----------
function theaterInterior(scene) {
  const H = TH0, gz = (H.z0 + H.z1) / 2;
  // 地面：石板，中央走道鋪木板
  box(IN.x0, 0, IN.z0, IN.x1 + 0.0, 0.15, IN.z1, 'flagstone');
  W.floors.push({ x0: IN.x0, x1: IN.x1, z0: IN.z0, z1: IN.z1, y: 0.15 });
  // 內牆面：暖色石材的薄面層（不與外牆共面）、牆腳石凳、腰線
  box(IN.x0, 0.15, IN.z0, IN.x1, H.eave - 0.4, IN.z0 + 0.02, 'hStoneIn');
  box(IN.x0, 0.15, IN.z1 - 0.02, IN.x1, H.eave - 0.4, IN.z1, 'hStoneIn');
  for (const [z0, z1] of [[IN.z0, IN.z0 + 0.45], [IN.z1 - 0.45, IN.z1]]) { box(IN.x0, 0.15, z0, IN.x1, 0.6, z1, 'trim', 'nocam'); W.walls.push({ x0: IN.x0, x1: IN.x1, z0, z1, y0: 0, y1: 0.6, st: 0.55 }); }
  for (const [z0, z1] of [[IN.z0, IN.z0 + 0.12], [IN.z1 - 0.12, IN.z1]]) box(IN.x0, 2.8, z0, IN.x1, 3.0, z1, 'trim');
  // 窗洞內側的石材收邊（讓窗戶有深度）：側牆窗下的窗台
  for (const x of [-107.5, -112.5, -122.5, -127.5]) for (const [z0, z1] of [[IN.z0, IN.z0 + 0.3], [IN.z1 - 0.3, IN.z1]]) box(x - 0.95, 3.2, z0, x + 0.95, 3.4, z1, 'trim');
  box(-118.45, 3.2, IN.z1 - 0.3, -116.55, 3.4, IN.z1, 'trim');
  // 錘式木桁架
  const trussX = [-105, -110, -115, -120, -125, -130];
  const slope = (H.ridge - H.eave) / ((H.z1 - H.z0) / 2);
  for (const x of trussX) {
    for (const s of [-1, 1]) {
      const zw = s < 0 ? IN.z0 : IN.z1, k = -s; // k：往室內的方向
      const ry = roofY(zw);
      // 石牛腿
      add(P(new THREE.BoxGeometry(0.5, 0.5, 0.5), { x, y: 5.9, z: zw + k * 0.22 }), 'trim');
      add(P(new THREE.BoxGeometry(0.42, 0.3, 0.42), { x, y: 5.55, z: zw + k * 0.17 }), 'trim');
      // 牆柱
      box(x - 0.16, 6.15, Math.min(zw, zw + k * 0.32), x + 0.16, ry, Math.max(zw, zw + k * 0.32), 'timber');
      // 錘梁（水平外挑）
      const zh = zw + k * 2.4;
      box(x - 0.17, ry - 0.2, Math.min(zw, zh), x + 0.17, ry + 0.2, Math.max(zw, zh), 'timber');
      // 錘柱
      const yHP = ry + 3.0;
      box(x - 0.15, ry + 0.2, Math.min(zh, zh - k * 0.3), x + 0.15, yHP, Math.max(zh, zh - k * 0.3), 'timber');
      // 下弧形斜撐：牆柱 → 錘梁端
      curved([[x, 6.4, zw + k * 0.3], [x, ry - 0.2, zw + k * 0.3], [x, ry - 0.2, zh - k * 0.2]], 0.12, 'timber');
      // 錘梁端的垂飾（雕花）
      const pend = new THREE.CylinderGeometry(0.12, 0.05, 0.6, 8); P(pend, { x, y: ry - 0.55, z: zh }); add(pend, 'timber');
      const knob = new THREE.SphereGeometry(0.1, 8, 6); P(knob, { x, y: ry - 0.9, z: zh }); add(knob, 'brass');
      // 主椽（沿屋面）
      beamZY(x, zw, ry - 0.25, gz, H.ridge - 0.25, 0.3, 0.3, 'timber');
      // 上弧形斜撐：錘柱頂 → 領梁
      const yC = H.ridge - 6.2, zC = gz + (s < 0 ? -1 : 1) * ((H.ridge - 0.3 - yC) / slope);
      curved([[x, yHP, zh - k * 0.15], [x, yC, zh - k * 0.15], [x, yC - 0.1, gz]], 0.13, 'timber');
      void zC;
    }
    // 領梁、中柱
    const yC = H.ridge - 6.2, half = (H.ridge - 0.3 - yC) / slope;
    box(x - 0.17, yC - 0.2, gz - half, x + 0.17, yC + 0.2, gz + half, 'timber');
    box(x - 0.13, yC + 0.2, gz - 0.13, x + 0.13, H.ridge - 0.2, gz + 0.13, 'timber');
    for (const s of [-1, 1]) beamZY(x, gz, yC + 1.6, gz + s * half * 0.6, yC + 0.2, 0.16, 0.16, 'timber');
  }
  // 檁條（沿 x 方向）與脊梁
  for (const s of [-1, 1]) for (const f of [0.22, 0.48, 0.74]) {
    const z = s < 0 ? IN.z0 + f * (gz - IN.z0) : IN.z1 - f * (IN.z1 - gz); const y = roofY(z) - 0.2;
    box(IN.x0, y - 0.16, z - 0.15, IN.x1, y + 0.12, z + 0.15, 'timber');
  }
  box(IN.x0, H.ridge - 0.6, gz - 0.2, IN.x1, H.ridge - 0.1, gz + 0.2, 'timber');
  box(IN.x0, H.eave - 0.5, IN.z0, IN.x1, H.eave + 0.3, IN.z0 + 0.35, 'timber'); box(IN.x0, H.eave - 0.5, IN.z1 - 0.35, IN.x1, H.eave + 0.3, IN.z1, 'timber');
  // 東西兩端的內牆面（暖色石材）
  box(IN.x0, 0.15, IN.z0, IN.x0 + 0.02, H.eave + 2, IN.z1, 'hStoneIn');

  // ---- 兩台螢幕（西牆）：橡木外框、鐵角片與鉚釘、上方的橫楣與編號牌 ----
  const xs = IN.x0 + 0.4;
  // 平台（比地面高 0.4m，可走上去）
  box(IN.x0, 0.15, IN.z0 + 0.45, IN.x0 + 2.6, 0.55, IN.z1 - 0.45, 'oak');
  box(IN.x0 + 2.6, 0.15, IN.z0 + 0.45, IN.x0 + 2.68, 0.58, IN.z1 - 0.45, 'timber');
  W.floors.push({ x0: IN.x0, x1: IN.x0 + 2.68, z0: IN.z0 + 0.45, z1: IN.z1 - 0.45, y: 0.55 });
  // 兩台螢幕中間的石柱
  box(IN.x0, 0.55, gz - 0.62, IN.x0 + 0.75, H.eave - 0.5, gz + 0.62, 'trim', true);
  add(P(new THREE.BoxGeometry(0.95, 0.35, 1.5), { x: IN.x0 + 0.42, y: H.eave - 0.55, z: gz }), 'trim');
  for (const S of TS0) {
    const z0 = S.z - S.w / 2, z1 = S.z + S.w / 2, y0 = S.y - S.h / 2, y1 = S.y + S.h / 2, fw = 0.3;
    box(IN.x0, y0, z0, xs - 0.01, y1, z1, 'screenBlack'); // 螢幕背板
    // 外框
    box(IN.x0, y0 - fw, z0 - fw, xs + 0.14, y0, z1 + fw, 'oakDark'); box(IN.x0, y1, z0 - fw, xs + 0.14, y1 + fw, z1 + fw, 'oakDark');
    box(IN.x0, y0, z0 - fw, xs + 0.14, y1, z0, 'oakDark'); box(IN.x0, y0, z1, xs + 0.14, y1, z1 + fw, 'oakDark');
    box(xs + 0.14, y0 - 0.06, z0 - 0.06, xs + 0.18, y0, z1 + 0.06, 'brass'); box(xs + 0.14, y1, z0 - 0.06, xs + 0.18, y1 + 0.06, z1 + 0.06, 'brass');
    box(xs + 0.14, y0, z0 - 0.06, xs + 0.18, y1, z0, 'brass'); box(xs + 0.14, y0, z1, xs + 0.18, y1, z1 + 0.06, 'brass');
    // 鐵角片＋鉚釘
    for (const [cz, cy] of [[z0, y0], [z1, y0], [z0, y1], [z1, y1]]) {
      const sz = cz === z0 ? 1 : -1, sy = cy === y0 ? 1 : -1;
      box(xs + 0.14, cy - sy * fw, Math.min(cz - sz * fw, cz + sz * 0.5), xs + 0.2, cy + sy * 0.0 - sy * fw + sy * 0.12, Math.max(cz - sz * fw, cz + sz * 0.5), 'iron');
      box(xs + 0.14, Math.min(cy - sy * fw, cy + sy * 0.5), Math.min(cz - sz * fw, cz - sz * fw + sz * 0.12), xs + 0.2, Math.max(cy - sy * fw, cy + sy * 0.5), Math.max(cz - sz * fw, cz - sz * fw + sz * 0.12), 'iron');
      for (const [a, b] of [[0.15, 0.06], [0.35, 0.06], [0.06, 0.25], [0.06, 0.42]]) { const n = new THREE.SphereGeometry(0.03, 6, 4); P(n, { x: xs + 0.21, y: cy - sy * fw + sy * b, z: cz - sz * fw + sz * a }); add(n, 'iron'); }
    }
    // 上方的橫楣與編號牌（I／II）
    box(IN.x0, y1 + fw, z0 - 0.5, xs + 0.35, y1 + fw + 0.45, z1 + 0.5, 'oakDark');
    for (let k = 0; k <= 12; k++) { const z = z0 - 0.3 + k * (S.w + 0.6) / 12; const c = new THREE.BoxGeometry(0.2, 0.18, 0.2); P(c, { x: xs + 0.25, y: y1 + fw - 0.06, z }); add(c, 'oakDark'); }
    const label = S.key === 'a' ? 'I' : 'II';
    const lt = T.textTexture([label], { w: 256, h: 160, font: '700 120px "Cinzel", serif', color: '#e2c27a', letter: 10, fit: 220 });
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshStandardMaterial({ map: lt, transparent: true, depthWrite: false, metalness: 0.7, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    lm.position.set(xs + 0.36, y1 + fw + 0.225, S.z); lm.rotation.y = Math.PI / 2; scene.add(lm);
    // 螢幕下緣的燭台（兩端）
    for (const z of [z0 + 0.5, z1 - 0.5]) {
      W.cyl(0.12, 0.18, 0.12, IN.x0 + 1.6, 0.55, z, 'brass', 10); W.cyl(0.03, 0.04, 1.0, IN.x0 + 1.6, 0.67, z, 'brass', 8); W.cyl(0.12, 0.08, 0.06, IN.x0 + 1.6, 1.67, z, 'brass', 10);
      W.cyl(0.045, 0.045, 0.32, IN.x0 + 1.6, 1.73, z, 'wax', 8); fire(scene, IN.x0 + 1.6, 2.06, z, 0.5, 1.0, 0.45);
      W.walls.push({ x0: IN.x0 + 1.4, x1: IN.x0 + 1.8, z0: z - 0.2, z1: z + 0.2, y0: 0, y1: 2 });
    }
  }
  // 螢幕上方：大型鍍金紋章與兩面長旗
  { const cr = new THREE.PlaneGeometry(4.2, 4.2); P(cr, { x: IN.x0 + 0.04, y: 12.4, z: gz, ry: Math.PI / 2 }); add(cr, 'crestGold'); }
  hangBanner(scene, IN.x0 + 0.8, H.eave - 0.8, gz, 1.0, 5.6, Math.PI / 2, 'bannerG', 0.015);
  // 側牆的長旗（窗與窗之間）與火把
  for (const x of [-110, -120, -130]) for (const [z, ry, nz] of [[IN.z0 + 0.12, 0, 1], [IN.z1 - 0.12, Math.PI, -1]]) {
    torch(scene, x, 4.3, z - nz * 0.1, 0, nz);
  }
  for (const x of [-105, -115, -125]) for (const [z, ry] of [[IN.z0 + 0.36, 0], [IN.z1 - 0.36, Math.PI]]) if (!(x === -115 && z < gz)) hangBanner(scene, x, 5.5, z, 1.3, 3.4, ry, x === -115 ? 'bannerR' : 'bannerG', 0.015);

  // ---- 壁爐（北牆中央） ----
  {
    const x = -117.5, z = IN.z0;
    box(x - 2.1, 0.15, z, x + 2.1, 0.45, z + 1.5, 'trim', 'nocam');
    box(x - 2.0, 0.45, z, x - 1.4, 2.5, z + 1.1, 'trim'); box(x + 1.4, 0.45, z, x + 2.0, 2.5, z + 1.1, 'trim');
    box(x - 2.2, 2.5, z, x + 2.2, 2.9, z + 1.25, 'trim');
    box(x - 1.4, 0.45, z, x + 1.4, 2.5, z + 0.25, 'soot');
    // 煙罩（往上收）
    const hood = new THREE.CylinderGeometry(0.9, 1.6, 4.2, 4, 1, false); hood.rotateY(Math.PI / 4); hood.scale(1.35, 1, 0.6); P(hood, { x, y: 5.0, z: z + 0.55 }); add(hood, 'hStoneIn');
    box(x - 0.9, 7.1, z, x + 0.9, H.eave - 0.4, z + 0.75, 'hStoneIn');
    for (const [a, b] of [[-0.6, 0.2], [0.5, -0.25]]) { const lg = new THREE.CylinderGeometry(0.11, 0.11, 1.3, 8); P(lg, { x: x + a * 0.3, y: 0.58, z: z + 0.6, rz: Math.PI / 2, ry: b }); add(lg, 'oakDark'); }
    box(x - 0.8, 0.45, z + 0.3, x + 0.8, 0.5, z + 0.95, 'ember');
    for (const dx of [-0.45, 0, 0.45]) fire(scene, x + dx, 0.55, z + 0.62, 2.6 - Math.abs(dx) * 1.5, 0, 0);
    W.glow(scene, x, 1.2, z + 0.9, 4.2, 0xff8a3a, 0.55);
    W.walls.push({ x0: x - 2.2, x1: x + 2.2, z0: z, z1: z + 1.55, y0: 0, y1: 3 });
    // 壁爐上方掛的交叉長槍與盾（原創紋章盾）
    const sh = new THREE.PlaneGeometry(1.5, 1.5); P(sh, { x, y: 4.1, z: z + 0.9 }); add(sh, 'crestGold');
  }

  // ---- 鐵環吊燈（三盞，懸在領梁下） ----
  for (const x of [-107.5, -117.5, -127.5]) {
    const y = 8.4;
    W.cyl(0.02, 0.02, H.ridge - 6.4 - y, x, y + 0.6, gz, 'iron', 4);
    for (const [r, t] of [[1.5, 0.05], [0.8, 0.04]]) { const rg = new THREE.TorusGeometry(r, t, 6, 40); P(rg, { x, y: r > 1 ? y : y + 0.35, z: gz, rx: Math.PI / 2 }); add(rg, 'iron'); }
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2; const ch = new THREE.CylinderGeometry(0.012, 0.012, 1.9, 4); const dx = Math.cos(a) * 0.75, dz = Math.sin(a) * 0.75; P(ch, { x: x + dx, y: y + 0.85, z: gz + dz, rz: -Math.atan2(Math.cos(a) * 1.5, 1.7) * 0.5 * 0 }); add(ch, 'iron'); }
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, cx = x + Math.cos(a) * 1.5, cz = gz + Math.sin(a) * 1.5;
      W.cyl(0.07, 0.05, 0.05, cx, y + 0.04, cz, 'iron', 6);
      W.cyl(0.035, 0.035, 0.24, cx, y + 0.08, cz, 'wax', 6);
      fire(scene, cx, y + 0.34, cz, 0.42, 0.9, 0.35);
    }
    W.glow(scene, x, y + 0.4, gz, 5.5, 0xffb060, 0.22);
    LIGHTS.push({ x, y: y - 0.3, z: gz, d: 22, off: [0xffa050, 22], on: [0xffd8a8, 70], flick: 0.4 });
  }
  // 其他借用光源：壁爐、兩側火把、入口
  LIGHTS.push({ x: -117.5, y: 1.4, z: IN.z0 + 1.6, d: 14, off: [0xff7a2a, 30], on: [0xff8a3a, 26], flick: 1 });
  LIGHTS.push({ x: -120, y: 4.4, z: IN.z1 - 1.0, d: 12, off: [0xff9040, 12], on: [0xffb070, 14], flick: 1 });
  LIGHTS.push({ x: -110, y: 4.4, z: IN.z0 + 1.0, d: 12, off: [0xff9040, 12], on: [0xffb070, 14], flick: 1 });
  LIGHTS.push({ x: -103, y: 7, z: gz, d: 18, off: [0xffa060, 8], on: [0xffe0c0, 40], flick: 0 });

  // ---- 座位：螢幕前 7 排長椅（面向螢幕），後方兩張長餐桌 ----
  const rowX = [-129.2, -127.6, -126.0, -124.4, -122.8, -121.2, -119.6];
  for (const x of rowX) for (const [z0, z1] of [[IN.z0 + 1.0, gz - 1.2], [gz + 1.2, IN.z1 - 1.0]]) pew(x, z0, z1);
  for (const z of [gz - 4.6, gz + 4.6]) messTable(scene, -116.4, -104.2, z);
  // 道具：木桶、木箱、武器架
  barrel(IN.x1 - 0.6, 0.15, IN.z0 + 0.9); barrel(IN.x1 - 1.4, 0.15, IN.z0 + 0.8, 0.34, 0.85); crate(IN.x1 - 0.7, 0.15, IN.z0 + 2.0, 0.8, 0.2);
  barrel(IN.x1 - 0.6, 0.15, IN.z1 - 0.9); crate(IN.x1 - 1.6, 0.15, IN.z1 - 0.8, 0.85, -0.15); crate(IN.x1 - 1.6, 1.0, IN.z1 - 0.8, 0.6, 0.3);
  weaponRack(IN.x1 - 4.2, IN.z1 - 0.55);
  weaponRack(IN.x1 - 4.2, IN.z0 + 0.55);
}

// 長椅（有靠背）：在 x 這一排，從 z0 到 z1；坐的人面向 -x（螢幕）
let pewTpl = null;
function pew(x, z0, z1) {
  const L = z1 - z0, zc = (z0 + z1) / 2, sy = 0.15;
  box(x - 0.22, sy + 0.42, z0, x + 0.22, sy + 0.48, z1, 'oak'); // 座板
  box(x + 0.2, sy + 0.5, z0, x + 0.26, sy + 0.98, z1, 'oak'); // 靠背板
  box(x + 0.18, sy + 0.96, z0 - 0.02, x + 0.29, sy + 1.03, z1 + 0.02, 'oakDark'); // 靠背頂
  box(x - 0.2, sy + 0.12, z0 + 0.2, x + 0.2, sy + 0.18, z1 - 0.2, 'oakDark'); // 下方擱腳橫木
  // 兩端的側板（上緣圓弧）
  pewTpl ||= (() => {
    const s = new THREE.Shape(); s.moveTo(-0.26, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 1.02); s.quadraticCurveTo(0.3, 1.18, 0.14, 1.18); s.lineTo(0.06, 1.18); s.quadraticCurveTo(-0.02, 0.7, -0.26, 0.62); s.lineTo(-0.26, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, -0.035); return g;
  })();
  for (const z of [z0, z1]) add(P(pewTpl.clone(), { x, y: sy, z: z + (z === z0 ? 0.035 : -0.035) }), 'oakDark');
  const n = Math.max(1, Math.floor(L / 0.72));
  for (let k = 0; k < n; k++) W.seats.push({ x: x - 0.02, y: sy + 0.5, z: z0 + (k + 0.5) * (L / n), ry: -Math.PI / 2 });
  W.walls.push({ x0: x - 0.24, x1: x + 0.3, z0, z1, y0: sy, y1: sy + 1.6, chair: true });
  void zc;
}
// 長餐桌＋兩側長凳（坐的人面向桌子）
function messTable(scene, x0, x1, z) {
  const ty = 0.15 + 0.78;
  box(x0, ty - 0.08, z - 0.55, x1, ty, z + 0.55, 'oak');
  for (const x of [x0 + 0.4, (x0 + x1) / 2, x1 - 0.4]) { box(x - 0.08, 0.15, z - 0.42, x + 0.08, ty - 0.08, z - 0.3, 'oakDark'); box(x - 0.08, 0.15, z + 0.3, x + 0.08, ty - 0.08, z + 0.42, 'oakDark'); box(x - 0.06, 0.4, z - 0.42, x + 0.06, 0.48, z + 0.42, 'oakDark'); }
  W.walls.push({ x0, x1, z0: z - 0.55, z1: z + 0.55, y0: 0, y1: 1.6 });
  for (const s of [-1, 1]) {
    const bz = z + s * 0.95;
    box(x0 + 0.2, 0.15 + 0.4, bz - 0.17, x1 - 0.2, 0.15 + 0.46, bz + 0.17, 'oak');
    for (const x of [x0 + 0.5, (x0 + x1) / 2, x1 - 0.5]) box(x - 0.06, 0.15, bz - 0.14, x + 0.06, 0.55, bz + 0.14, 'oakDark');
    const n = Math.floor((x1 - x0 - 0.4) / 0.78);
    for (let k = 0; k < n; k++) W.seats.push({ x: x0 + 0.2 + (k + 0.5) * ((x1 - x0 - 0.4) / n), y: 0.15 + 0.5, z: bz, ry: s < 0 ? 0 : Math.PI });
    W.walls.push({ x0: x0 + 0.2, x1: x1 - 0.2, z0: bz - 0.17, z1: bz + 0.17, y0: 0.15, y1: 1.75, chair: true });
  }
  // 桌上的燭台、木杯、攤開的地圖
  for (const x of [x0 + 1.6, (x0 + x1) / 2, x1 - 1.6]) {
    W.cyl(0.08, 0.1, 0.05, x, ty, z, 'brass', 10); W.cyl(0.035, 0.035, 0.22, x, ty + 0.05, z, 'wax', 8);
    fire(scene, x, ty + 0.28, z, 0.38, 0.9, 0.4);
  }
  for (let k = 0; k < 7; k++) { const x = x0 + 0.9 + k * (x1 - x0 - 1.8) / 6, zz = z + ((k % 2) ? 0.32 : -0.32); W.cyl(0.055, 0.05, 0.14, x, ty, zz, 'oakDark', 8); }
  add(P(new THREE.BoxGeometry(1.1, 0.01, 0.7), { x: (x0 + x1) / 2 + 2.4, y: ty + 0.005, z, ry: 0.2 }), 'canvasC');
}
// 武器架（長槍）：靠在牆邊
function weaponRack(x, z) {
  const dz = z < 15 ? 1 : -1;
  box(x - 1.2, 0.15, z - 0.1, x + 1.2, 0.3, z + 0.1, 'oakDark');
  box(x - 1.2, 1.6, z - 0.06, x + 1.2, 1.7, z + 0.06, 'oakDark');
  for (const s of [-1, 1]) box(x + s * 1.15 - 0.05, 0.15, z - 0.06, x + s * 1.15 + 0.05, 1.8, z + 0.06, 'oakDark');
  for (let k = 0; k < 6; k++) {
    const xx = x - 0.95 + k * 0.38;
    const sp = new THREE.CylinderGeometry(0.022, 0.022, 2.6, 6); P(sp, { x: xx, y: 1.45, z: z + dz * 0.02, rx: -dz * 0.06 }); add(sp, 'oak');
    const tip = new THREE.ConeGeometry(0.045, 0.32, 4); P(tip, { x: xx, y: 2.9, z: z - dz * 0.06 }); add(tip, 'iron');
  }
  W.walls.push({ x0: x - 1.25, x1: x + 1.25, z0: z - 0.2, z1: z + 0.2, y0: 0, y1: 3 });
}
