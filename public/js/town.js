// 城牆區的城鎮：每道城門內側沿著城牆排成弧形的密集街區（德式半木構造民居、紅色魚鱗瓦、煙囪）＋一座尖塔石造教堂
// 原創造型，參考中歐古城（城牆圍繞、紅瓦屋頂密集排列）的一般印象；不使用任何作品的角色或官方圖像
// 房子沿圓弧旋轉擺放：幾何用區域座標建好再套旋轉矩陣；碰撞用沿外框排列的小方塊近似（每塊外擴不超過 0.4m）
import * as THREE from 'three';

let A; // { W, add, HOOK_BOXES }
const M = new THREE.Matrix4();
let TH = 0, CX = 0, CZ = 0; // 目前這棟的旋轉角與中心
const setFrame = (cx, cz, th) => { CX = cx; CZ = cz; TH = th; M.makeRotationY(th); M.setPosition(cx, 0, cz); };
// 區域座標的方塊（x：寬、y：高、z：深，正面在 +z）
function lb(x0, y0, z0, x1, y1, z1, key) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); g.applyMatrix4(M); A.add(g, key);
}
const lg = (g, key) => { g.applyMatrix4(M); A.add(g, key); };
// 正面上兩點之間的斜木（區域 x-y 平面，z 固定）
function beam(xa, ya, xb, yb, z, w, d, key) {
  const len = Math.hypot(xb - xa, yb - ya); const g = new THREE.BoxGeometry(len, w, d);
  g.rotateZ(Math.atan2(yb - ya, xb - xa)); g.translate((xa + xb) / 2, (ya + yb) / 2, z); lg(g, key);
}
const toWorld = (lx, lz) => { const c = Math.cos(TH), s = Math.sin(TH); return [CX + lx * c + lz * s, CZ - lx * s + lz * c]; };
// 碰撞：沿外框排一圈小方塊（旋轉後取外接方塊），再加一塊內接的頂面（站得上屋頂、勾得到）
function footprint(w, d, h, cam = true) {
  const c = Math.abs(Math.cos(TH)), s = Math.abs(Math.sin(TH));
  const cell = 2, he = cell / 2 * (c + s);
  const pts = [];
  for (const [len, other, axis] of [[w, d, 'x'], [d, w, 'z']]) {
    const n = Math.max(1, Math.round(len / cell)), st = len / n;
    for (let k = 0; k < n; k++) {
      const u = -len / 2 + st * (k + 0.5);
      for (const sg of [-1, 1]) { const v = sg * (other / 2 - cell / 2); pts.push(axis === 'x' ? [u, v] : [v, u]); }
    }
  }
  for (const [lx, lz] of pts) {
    const [x, z] = toWorld(lx, lz);
    const b = { x0: x - he, x1: x + he, z0: z - he, z1: z + he, y0: 0, y1: h };
    A.W.walls.push(b); if (cam) A.W.camBlock.push(b);
  }
  return inscribed(w, d);
}
// 旋轉矩形的內接軸向方塊（取中央的正方形）
function inscribed(w, d) {
  const c = Math.abs(Math.cos(TH)), s = Math.abs(Math.sin(TH));
  const half = Math.min(w, d) / 2 / (c + s);
  const [x, z] = toWorld(0, 0);
  // 長邊方向可以再延伸：沿長軸多放幾塊
  const out = [];
  const long = Math.max(w, d), n = Math.max(1, Math.floor(long / Math.min(w, d)));
  for (let k = 0; k < n; k++) {
    const u = -long / 2 + long / n * (k + 0.5);
    const [px, pz] = w >= d ? toWorld(u, 0) : toWorld(0, u);
    out.push({ x0: px - half, x1: px + half, z0: pz - half, z1: pz + half });
  }
  return out.length ? out : [{ x0: x - half, x1: x + half, z0: z - half, z1: z + half }];
}

// 屋頂板：從屋脊到屋簷外 o 公尺，板底貼在山牆斜面上；回傳 [斜長, 中心水平距離, 中心高度（相對屋簷）]
function slab(half, o, rise, pitch, t) {
  const xc = (half + o) / 2;
  return [(half + o) / Math.cos(pitch), xc, rise - xc * Math.tan(pitch) + t / 2 / Math.cos(pitch)];
}
// ---------- 民居 ----------
// w：寬（沿街）、d：深、h：屋簷高；gableFront：山牆朝街（否則屋簷朝街）
function townHouse(rng, w, d, h, gableFront, idx) {
  const gf = 3.0 + rng() * 0.5, jet = 0.35, pitch = 0.98 + rng() * 0.12;
  const plaster = ['limeP', 'limeW', 'limeO', 'limeP', 'limeW'][idx % 5];
  const roofK = rng() < 0.55 ? 'tileR' : 'tileR2';
  const fz = d / 2; // 正面
  // 一樓石造、樓上灰泥（正面外挑）
  lb(-w / 2, 0, -d / 2, w / 2, gf, d / 2, rng() < 0.7 ? 'hStone' : 'trim');
  lb(-w / 2, gf, -d / 2, w / 2, h, d / 2 + jet, plaster);
  lb(-w / 2 - 0.08, gf - 0.18, d / 2 - 0.1, w / 2 + 0.08, gf + 0.06, d / 2 + jet + 0.1, 'timber'); // 外挑的地梁
  const zf = fz + jet + 0.05; // 木構架貼在外挑正面外側
  let rise;
  if (gableFront) {
    rise = (w / 2) * Math.tan(pitch);
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: d + jet, bevelEnabled: false }); g.translate(0, h, -d / 2); lg(g, plaster);
    const [len, xc, yc] = slab(w / 2, 0.5, rise, pitch, 0.22);
    for (const s of [-1, 1]) {
      const rf = new THREE.BoxGeometry(len, 0.22, d + jet + 0.8);
      rf.rotateZ(-s * pitch); rf.translate(s * xc, h + yc, jet / 2); lg(rf, roofK);
    }
    const rg = new THREE.BoxGeometry(0.3, 0.3, d + jet + 0.9); rg.rotateZ(Math.PI / 4); rg.translate(0, h + rise + 0.05, jet / 2); lg(rg, roofK);
    // 山牆上的木構：斜邊、中柱、一道橫梁、小窗
    beam(-w / 2, h, 0, h + rise, zf, 0.2, 0.12, 'timber'); beam(0, h + rise, w / 2, h, zf, 0.2, 0.12, 'timber');
    lb(-0.1, h, zf - 0.06, 0.1, h + rise, zf + 0.06, 'timber');
    lb(-w * 0.3, h + rise * 0.42 - 0.09, zf - 0.06, w * 0.3, h + rise * 0.42 + 0.09, zf + 0.06, 'timber');
    const lit = rng() < 0.4;
    for (const s of [-1, 1]) lb(s > 0 ? 0.25 : -0.85, h + rise * 0.1, zf - 0.08, s > 0 ? 0.85 : -0.25, h + rise * 0.1 + 0.85, zf + 0.02, lit ? 'glassHouse' : 'glassDarkH');
  } else {
    rise = (d / 2) * Math.tan(pitch) * 0.85;
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2 - jet / 2, 0), new THREE.Vector2(d / 2 + jet / 2, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(-w / 2, h, jet / 2); lg(g, plaster);
    const p2 = Math.atan2(rise, d / 2 + jet / 2), [len, zc, yc] = slab(d / 2 + jet / 2, 0.5, rise, p2, 0.22);
    for (const s of [-1, 1]) {
      const rf = new THREE.BoxGeometry(w + 0.7, 0.22, len);
      rf.rotateX(s * p2); rf.translate(0, h + yc, jet / 2 + s * zc); lg(rf, roofK);
    }
    const rg = new THREE.BoxGeometry(w + 0.8, 0.3, 0.3); rg.rotateX(Math.PI / 4); rg.translate(0, h + rise + 0.05, jet / 2); lg(rg, roofK);
    // 屋簷朝街：屋頂上一到兩座老虎窗
    const nD = w > 7.5 ? 2 : 1;
    for (let k = 0; k < nD; k++) {
      const dx = nD === 1 ? 0 : (k ? 1 : -1) * w * 0.22, dz = jet / 2 + (d / 2) * 0.68, dy = h + rise * 0.12;
      lb(dx - 0.6, dy, dz - 1.4, dx + 0.6, dy + 1.6, dz + 0.35, plaster);
      lb(dx - 0.38, dy + 0.3, dz + 0.3, dx + 0.38, dy + 1.2, dz + 0.37, rng() < 0.4 ? 'glassHouse' : 'glassDarkH');
      for (const t of [-1, 1]) { const dr = new THREE.BoxGeometry(0.95, 0.1, 2.0); dr.rotateZ(-t * 0.75); dr.translate(dx + t * 0.36, dy + 1.85, dz - 0.5); lg(dr, roofK); }
    }
  }
  // 木構架（正面）：樓板梁、立柱、窗戶、端間的斜撐
  const floorsY = [gf, gf + (h - gf) / 2, h];
  for (const y of floorsY) lb(-w / 2 - 0.08, y - 0.13, zf - 0.06, w / 2 + 0.08, y + 0.09, zf + 0.06, 'timber');
  const nB = Math.max(3, Math.round(w / 1.55)), bw = w / nB;
  for (let k = 0; k <= nB; k++) { const x = -w / 2 + k * bw; lb(x - 0.09, gf, zf - 0.06, x + 0.09, h, zf + 0.06, 'timber'); }
  for (let f = 0; f < 2; f++) {
    const ya = floorsY[f], yb = floorsY[f + 1];
    for (let k = 0; k < nB; k++) {
      const xa = -w / 2 + k * bw, xb = xa + bw;
      if (k > 0 && k < nB - 1) {
        const wy0 = ya + 0.7, wy1 = yb - 0.42, wx0 = xa + 0.26, wx1 = xb - 0.26;
        lb(xa, wy0 - 0.12, zf - 0.06, xb, wy0, zf + 0.07, 'timber');
        const lit = rng() < 0.33;
        lb(wx0, wy0, zf - 0.1, wx1, wy1, zf + 0.02, lit ? 'glassHouse' : 'glassDarkH');
        lb((wx0 + wx1) / 2 - 0.03, wy0, zf - 0.04, (wx0 + wx1) / 2 + 0.03, wy1, zf + 0.05, 'timber');
        lb(wx0, (wy0 + wy1) / 2 - 0.03, zf - 0.04, wx1, (wy0 + wy1) / 2 + 0.03, zf + 0.05, 'timber');
        if (rng() < 0.45) for (const sx of [-1, 1]) { const e = sx < 0 ? wx0 : wx1; lb(Math.min(e, e + sx * 0.3), wy0, zf + 0.02, Math.max(e, e + sx * 0.3), wy1, zf + 0.08, idx % 2 ? 'oak' : 'oakDark'); }
      } else {
        const up = (k === 0) === (f === 0);
        beam(xa + 0.09, up ? ya : yb, xb - 0.09, up ? yb : ya, zf, 0.16, 0.11, 'timber');
      }
    }
  }
  // 一樓：拱門、小窗、門燈
  const sf = fz + 0.02, dxm = (idx % 2 ? 1 : -1) * (w / 2 - 1.3);
  lb(dxm - 0.78, 0, sf - 0.02, dxm + 0.78, 2.55, sf + 0.12, 'trim');
  lb(dxm - 0.58, 0.1, sf - 0.02, dxm + 0.58, 2.3, sf + 0.15, 'oakDark');
  lb(dxm - 0.58, 1.6, sf + 0.14, dxm + 0.58, 1.66, sf + 0.18, 'iron');
  const wx = -dxm * 0.55;
  if (w > 5.5) { lb(wx - 0.75, 1.0, sf - 0.02, wx + 0.75, 2.35, sf + 0.1, 'trim'); lb(wx - 0.6, 1.12, sf - 0.02, wx + 0.6, 2.22, sf + 0.13, rng() < 0.5 ? 'glassHouse' : 'glassDarkH'); }
  // 背面：簡單的木構與小窗（從城牆上俯瞰也看得到）
  const bz = -d / 2 - 0.05;
  for (const y of [gf, h]) lb(-w / 2, y - 0.12, bz - 0.06, w / 2, y + 0.08, bz + 0.06, 'timber');
  for (let k = 0; k <= 2; k++) { const x = -w / 2 + k * w / 2; lb(x - 0.09, gf, bz - 0.06, x + 0.09, h, bz + 0.06, 'timber'); }
  for (const s of [-1, 1]) lb(s * w / 4 - 0.4, gf + 1.1, bz - 0.08, s * w / 4 + 0.4, gf + 2.1, bz + 0.02, rng() < 0.3 ? 'glassHouse' : 'glassDarkH');
  // 煙囪（一到兩支）
  const nC = rng() < 0.35 ? 2 : 1;
  for (let k = 0; k < nC; k++) {
    const cx = gableFront ? (k ? 1 : -1) * w * 0.22 : (rng() - 0.5) * w * 0.6, cz = gableFront ? -d * 0.15 + k * d * 0.3 : -d * 0.12;
    const top = h + rise + 0.8 + rng() * 0.6;
    lb(cx - 0.38, h + rise * 0.3, cz - 0.38, cx + 0.38, top, cz + 0.38, 'hStone');
    lb(cx - 0.48, top, cz - 0.48, cx + 0.48, top + 0.18, cz + 0.48, 'trim');
    lb(cx - 0.2, top + 0.18, cz - 0.2, cx + 0.2, top + 0.3, cz + 0.2, 'soot');
  }
  // 碰撞＋勾鎖／站立用的頂面（屋簷高）與屋頂的階梯近似
  const tops = footprint(w, d + jet, h);
  for (const t of tops) {
    A.HOOK_BOXES.push({ ...t, y0: h - 0.6, y1: h });
    const sx = (t.x1 - t.x0) * 0.22, sz = (t.z1 - t.z0) * 0.22;
    A.HOOK_BOXES.push({ x0: t.x0 + sx, x1: t.x1 - sx, z0: t.z0 + sz, z1: t.z1 - sz, y0: h, y1: h + rise * 0.45 });
  }
}

// ---------- 教堂（石造、陡峭紅瓦屋頂、正面方塔＋八角尖塔） ----------
function church(rng) {
  const w = 11, L = 24, h = 12.5, z0 = -L / 2, z1 = L / 2, tw = 6.6, tz1 = z0 + tw, TH_ = 25;
  // 中殿
  lb(-w / 2, 0, tz1 - 0.2, w / 2, h, z1, 'hStone');
  const pitch = 1.05, rise = (w / 2) * Math.tan(pitch);
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
  const g = new THREE.ExtrudeGeometry(tri, { depth: z1 - tz1, bevelEnabled: false }); g.translate(0, h, tz1); lg(g, 'hStone');
  const [len, xc, yc] = slab(w / 2, 0.7, rise, pitch, 0.26);
  for (const s of [-1, 1]) { const rf = new THREE.BoxGeometry(len, 0.26, z1 - tz1 + 0.8); rf.rotateZ(-s * pitch); rf.translate(s * xc, h + yc, (tz1 + z1) / 2 + 0.3); lg(rf, 'tileR2'); }
  // 扶壁與尖拱高窗（兩側）
  for (let k = 0; k < 5; k++) {
    const z = tz1 + 2.2 + k * (z1 - tz1 - 3.4) / 4;
    for (const s of [-1, 1]) {
      lb(s > 0 ? w / 2 : -w / 2 - 1.1, 0, z - 0.45, s > 0 ? w / 2 + 1.1 : -w / 2, 7.5, z + 0.45, 'hStone');
      const cap = new THREE.BoxGeometry(1.3, 0.4, 1.0); cap.rotateZ(s * 0.7); cap.translate(s * (w / 2 + 0.55), 7.6, z); lg(cap, 'trim');
      if (k < 4) { const zw = z + (z1 - tz1 - 3.4) / 8; lb(s > 0 ? w / 2 - 0.05 : -w / 2 - 0.08, 3.2, zw - 0.6, s > 0 ? w / 2 + 0.08 : -w / 2 + 0.05, 9.6, zw + 0.6, 'glassLit'); }
    }
  }
  // 後殿圓窗（玫瑰窗）
  { const rw = new THREE.CylinderGeometry(1.5, 1.5, 0.2, 20); rw.rotateX(Math.PI / 2); rw.translate(0, h + 1.6, z1 + 0.05); lg(rw, 'glassLit'); const rr = new THREE.TorusGeometry(1.55, 0.18, 6, 24); rr.translate(0, h + 1.6, z1 + 0.12); lg(rr, 'trim'); }
  // 方塔（正面）
  lb(-tw / 2, 0, z0, tw / 2, TH_, tz1, 'hStone');
  for (const y of [h, TH_ - 6]) lb(-tw / 2 - 0.15, y, z0 - 0.15, tw / 2 + 0.15, y + 0.4, tz1 + 0.15, 'trim');
  lb(-tw / 2 - 0.3, TH_, z0 - 0.3, tw / 2 + 0.3, TH_ + 0.6, tz1 + 0.3, 'trim');
  // 鐘樓的開口（四面）與鐘面
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (const o of [-1.1, 1.1]) {
      const cx = nx ? nx * (tw / 2 + 0.01) : o, cz = nz ? (nz < 0 ? z0 - 0.01 : tz1 + 0.01) : (z0 + tz1) / 2 + o;
      lb(cx - (nx ? 0.04 : 0.45), TH_ - 4.8, cz - (nz ? 0.04 : 0.45), cx + (nx ? 0.04 : 0.45), TH_ - 1.4, cz + (nz ? 0.04 : 0.45), 'soot');
    }
    if (nz < 0) { const cf = new THREE.CylinderGeometry(1.25, 1.25, 0.12, 24); cf.rotateX(Math.PI / 2); cf.translate(0, TH_ - 8.2, z0 - 0.06); lg(cf, 'limeW'); const rim = new THREE.TorusGeometry(1.3, 0.12, 6, 24); rim.translate(0, TH_ - 8.2, z0 - 0.12); lg(rim, 'brass'); lb(-0.05, TH_ - 8.2, z0 - 0.2, 0.05, TH_ - 7.3, z0 - 0.15, 'iron'); lb(-0.05, TH_ - 8.25, z0 - 0.2, 0.7, TH_ - 8.15, z0 - 0.15, 'iron'); }
  }
  // 大門（尖拱）
  lb(-1.6, 0, z0 - 0.25, 1.6, 4.6, z0 + 0.02, 'trim'); lb(-1.2, 0.05, z0 - 0.3, 1.2, 4.0, z0, 'oakDark');
  // 八角尖塔＋四個小角塔
  const sp = new THREE.ConeGeometry(tw * 0.62, 15, 8); sp.rotateY(Math.PI / 8); sp.translate(0, TH_ + 0.6 + 7.5, (z0 + tz1) / 2); lg(sp, 'spire');
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const c = new THREE.ConeGeometry(0.55, 3.2, 8); c.translate(a * (tw / 2 - 0.1), TH_ + 0.6 + 1.6, (z0 + tz1) / 2 + b * (tw / 2 - 0.1)); lg(c, 'spire'); }
  const ball = new THREE.SphereGeometry(0.32, 10, 8); ball.translate(0, TH_ + 15.8, (z0 + tz1) / 2); lg(ball, 'brass');
  lb(-0.05, TH_ + 15.9, (z0 + tz1) / 2 - 0.05, 0.05, TH_ + 17.2, (z0 + tz1) / 2 + 0.05, 'iron');
  // 碰撞
  const save = [CX, CZ, TH];
  // 中殿
  setFrame(...toWorld(0, (tz1 + z1) / 2), TH); const nave = footprint(w + 2.2, z1 - tz1, h);
  for (const t of nave) { A.HOOK_BOXES.push({ ...t, y0: h - 0.6, y1: h }); const sx = (t.x1 - t.x0) * 0.25, sz = (t.z1 - t.z0) * 0.25; A.HOOK_BOXES.push({ x0: t.x0 + sx, x1: t.x1 - sx, z0: t.z0 + sz, z1: t.z1 - sz, y0: h, y1: h + rise * 0.5 }); }
  setFrame(save[0], save[1], save[2]);
  setFrame(...toWorld(0, (z0 + tz1) / 2), TH); const tower = footprint(tw, tw, TH_ + 0.6);
  for (const t of tower) A.HOOK_BOXES.push({ ...t, y0: TH_, y1: TH_ + 0.6 });
  setFrame(save[0], save[1], save[2]);
}

// ---------- 配置 ----------
// opt：{ C 圓心, rows:[{ r 中心半徑, d 深度, face:+1 朝外/-1 朝內, a0, a1 角度範圍(弧度，取絕對值) }], blocked(x,z,pad) 已有東西的地方, churchAt:{ ring, a } }
export function buildTown(api, opt) {
  A = api;
  const rng = mulberry(31);
  const { C } = opt; const placed = [];
  let idx = 0;
  // 教堂
  if (opt.church) {
    const { r, a } = opt.church; const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    // 正面（方塔）朝圓心：區域 -z 朝內 → 區域 +z 朝外
    setFrame(x, z, Math.atan2(Math.cos(a), Math.sin(a)));
    church(rng);
    placed.push({ x, z, rad: 14 });
  }
  for (const row of opt.rows) {
    for (const side of [1, -1]) {
      const rIn = row.r - row.d / 2; // 用內側半徑排，外側自然留出窄巷
      let s = rIn * row.a0;
      while (s < rIn * row.a1) {
        const w = 5.6 + rng() * 3.6, gap = rng() < 0.28 ? 2.4 : 0.25;
        const a = side * (s + w / 2) / rIn;
        s += w + gap;
        if (Math.abs(a) > row.a1) break;
        const x = C.x + Math.cos(a) * row.r, z = C.z + Math.sin(a) * row.r;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + w / 2)) continue;
        // 四個角都要避開已有的街道與建物
        const ux = Math.cos(a), uz = Math.sin(a), tx = -uz, tz = ux;
        const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([p, q]) => [x + tx * p * w / 2 + ux * q * row.d / 2, z + tz * p * w / 2 + uz * q * row.d / 2]);
        if (corners.some(([cx, cz]) => opt.blocked(cx, cz))) continue;
        const h = 9.5 + rng() * 5.5;
        // 正面朝向：face +1 朝外（u），-1 朝內（-u）
        const fx = ux * row.face, fz = uz * row.face;
        setFrame(x, z, Math.atan2(fx, fz));
        townHouse(rng, w, row.d, h, rng() < 0.55, idx++);
        placed.push({ x, z, rad: 0 });
      }
    }
  }
  return placed;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
