// BLG 2026 世界賽冠軍英雄雕像：深色古銅身體 + 鎏金細節，站在深綠大理石基座上（程序化建模，無模型檔）
// 依各英雄的招牌剪影重新雕塑的詮釋，不使用官方模型或原畫。
// 選手與英雄（2026-11-22 查到的狀態，正式公布後若有改，只要換 ROSTER 裡那一筆）：
//   Bin 格溫、Xun 悟空、Knight（FMVP 兩座）阿狸＋洛克、Viper 伊澤瑞爾、ON 璐璐
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const UP = v3(0, 1, 0);
// 端點收圓：t 在兩端 e 範圍內，半徑以四分之一圓收到 0
const cap = (t, e = 0.12) => {
  if (t < e) { const u = 1 - t / e; return Math.sqrt(Math.max(0, 1 - u * u)); }
  if (t > 1 - e) { const u = 1 - (1 - t) / e; return Math.sqrt(Math.max(0, 1 - u * u)); }
  return 1;
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = v3();

// ---------- 建模工具：所有零件依材質收集，最後每種材質合併成一個網格 ----------
class Kit {
  constructor(detail = 1) { this.d = detail; this.parts = {}; this.M = new THREE.Matrix4(); }
  push(g, key = 'bronze') {
    let n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    n.applyMatrix4(this.M);
    (this.parts[key] ||= []).push(n); return n;
  }
  // 把幾何從局部座標放到指定位置／旋轉／縮放
  static xf(g, { p = null, q = null, r = null, s = null } = {}) {
    if (r) { _e.set(r[0] || 0, r[1] || 0, r[2] || 0, 'YXZ'); _q.setFromEuler(_e); } else if (q) _q.copy(q); else _q.identity();
    if (s) { if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]); } else _s.set(1, 1, 1);
    _m.compose(p || v3(), _q, _s); return g.applyMatrix4(_m);
  }
  // 錐狀管：沿曲線掃一圈截面，半徑由 rFn(t) 決定；wx / wy 讓截面變扁；hint 決定截面的第一軸方向（平行傳遞，不會亂扭）
  tube(pts, rFn, o = {}) {
    const d = this.d, seg = o.seg ?? Math.max(6, Math.round((o.segK ?? 18) * d)), rad = o.rad ?? Math.max(6, Math.round((o.radK ?? 12) * d));
    const wx = o.wx ?? 1, wy = o.wy ?? 1, hint = o.hint || v3(0, 0, 1);
    const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, !!o.closed, 'centripetal');
    const P = [], Tg = [];
    for (let i = 0; i <= seg; i++) { const t = i / seg; P.push(curve.getPointAt(t)); Tg.push(curve.getTangentAt(t).normalize()); }
    let N = hint.clone().sub(Tg[0].clone().multiplyScalar(hint.dot(Tg[0])));
    if (N.lengthSq() < 1e-6) N = Math.abs(Tg[0].x) < 0.9 ? v3(1, 0, 0).cross(Tg[0]) : v3(0, 1, 0).cross(Tg[0]);
    N.normalize();
    const pos = [], idx = [], B = v3(), q = new THREE.Quaternion();
    for (let i = 0; i <= seg; i++) {
      if (i > 0) { q.setFromUnitVectors(Tg[i - 1], Tg[i]); N.applyQuaternion(q).normalize(); }
      B.crossVectors(Tg[i], N).normalize();
      const r = Math.max(0, rFn(i / seg));
      for (let j = 0; j < rad; j++) {
        const a = (j / rad) * Math.PI * 2 + (o.twist || 0) * i / seg;
        const c = Math.cos(a) * r * wx, s = Math.sin(a) * r * wy;
        pos.push(P[i].x + N.x * c + B.x * s, P[i].y + N.y * c + B.y * s, P[i].z + N.z * c + B.z * s);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
      const a = i * rad + j, b = i * rad + (j + 1) % rad, c = (i + 1) * rad + j, e = (i + 1) * rad + (j + 1) % rad;
      idx.push(a, c, b, b, c, e);
    }
    // 兩端加蓋
    const c0 = pos.length / 3; pos.push(P[0].x, P[0].y, P[0].z);
    const c1 = c0 + 1; pos.push(P[seg].x, P[seg].y, P[seg].z);
    for (let j = 0; j < rad; j++) { idx.push(c0, j, (j + 1) % rad); idx.push(c1, seg * rad + (j + 1) % rad, seg * rad + j); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return this.push(g, o.key);
  }
  // 肢體：兩端略為延伸並收圓，與相鄰肢體自然接合；bulge 讓中段鼓起（肌肉）
  limb(a, b, ra, rb, o = {}) {
    const dir = b.clone().sub(a).normalize(), A = a.clone().addScaledVector(dir, -ra * 0.7), Bp = b.clone().addScaledVector(dir, rb * 0.7);
    const len = A.distanceTo(Bp), ea = Math.min(0.45, ra * 1.0 / len), eb = Math.min(0.45, rb * 1.0 / len);
    return this.tube([A, Bp], (t) => {
      let r = lerp(ra, rb, t) * (1 + (o.bulge || 0) * Math.sin(Math.PI * t));
      if (t < ea) { const u = 1 - t / ea; r *= Math.sqrt(1 - u * u); } else if (t > 1 - eb) { const u = 1 - (1 - t) / eb; r *= Math.sqrt(1 - u * u); }
      return r;
    }, { segK: 14, ...o });
  }
  // 沿多點曲線的錐狀管（頭髮、尾巴、羽毛）：r0 → r1，可指定鼓起 mid
  strand(pts, r0, r1, o = {}) {
    const mid = o.mid || 0, e = o.e ?? 0.08;
    return this.tube(pts, (t) => (lerp(r0, r1, t) + mid * Math.sin(Math.PI * Math.pow(t, o.skew ?? 1))) * (o.round === false ? 1 : cap(t, e)) * (t > 1 - e && o.sharp ? 0.5 : 1), { segK: 24, ...o });
  }
  ell(c, rx, ry, rz, o = {}) {
    const d = this.d, g = new THREE.SphereGeometry(1, Math.max(8, Math.round((o.w ?? 20) * d)), Math.max(6, Math.round((o.h ?? 14) * d)));
    g.scale(rx, ry, rz);
    if (o.r) { _e.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0, 'YXZ'); g.applyQuaternion(_q.setFromEuler(_e)); }
    if (o.aim) g.applyQuaternion(_q.setFromUnitVectors(UP, o.aim.clone().normalize()));
    g.translate(c.x, c.y, c.z); return this.push(g, o.key);
  }
  // 旋轉體：profile 為 [半徑, 高度]；folds 讓布料有直向的褶；open 讓正面留一道開口（外套）
  lathe(profile, o = {}) {
    const seg = Math.max(12, Math.round((o.seg ?? 40) * this.d));
    const open = o.open || 0;
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg, open / 2, Math.PI * 2 - open);
    const f = o.folds;
    if (f) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z);
        const k = THREE.MathUtils.clamp((f.y0 - y) / (f.y0 - f.y1), 0, 1);
        const m = 1 + f.amp * Math.pow(k, f.pow ?? 1.4) * (Math.sin(a * f.n + (f.ph || 0)) + 0.35 * Math.sin(a * f.n * 2.3 + 1.7));
        p.setXYZ(i, x * m, y, z * m);
      }
    }
    g.scale(o.sx ?? 1, 1, o.sz ?? 1);
    if (o.r) { _e.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0, 'YXZ'); g.applyQuaternion(_q.setFromEuler(_e)); }
    if (o.aim) g.applyQuaternion(_q.setFromUnitVectors(UP, o.aim.clone().normalize()));
    const c = o.p || v3(); g.translate(c.x, c.y, c.z);
    g.computeVertexNormals();
    return this.push(g, o.key);
  }
  // 平面外形擠出（刀刃、耳朵、棺材）
  extrude(pts, depth, o = {}) {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const bv = o.bevel ?? Math.min(0.012, depth * 0.3);
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv * 0.8, bevelSegments: 2, curveSegments: 8 });
    g.translate(0, 0, -depth / 2);
    Kit.xf(g, o); return this.push(g, o.key);
  }
  torus(c, R, r, o = {}) {
    const g = new THREE.TorusGeometry(R, r, Math.max(6, Math.round(10 * this.d)), Math.max(12, Math.round((o.seg ?? 32) * this.d)), o.arc ?? Math.PI * 2);
    Kit.xf(g, { ...o, p: c }); return this.push(g, o.key);
  }
  cyl(a, b, ra, rb, o = {}) {
    const len = a.distanceTo(b), g = new THREE.CylinderGeometry(rb, ra, len, o.seg ?? Math.max(8, Math.round(20 * this.d)), 1, false);
    g.translate(0, len / 2, 0); g.applyQuaternion(_q.setFromUnitVectors(UP, b.clone().sub(a).normalize())); g.translate(a.x, a.y, a.z);
    return this.push(g, o.key);
  }
}

// ---------- 人體：依關節位置建出身體（臉部保持光滑，與遊戲裡無五官的角色一致） ----------
function body(k, J, o = {}) {
  const male = !!o.male, s = o.s ?? 1;
  // 骨盆、軀幹（橢圓截面的旋轉體，沿骨盆→脖子方向）
  k.ell(J.pelvis, 0.15 * s * (male ? 1 : 1.08), 0.12 * s, 0.11 * s, { r: o.pelvisR });
  const tv = J.neck.clone().sub(J.pelvis), L = tv.length();
  const prof = male
    ? [[0.001, 0], [0.14, 0.02], [0.145, 0.15], [0.15, 0.3], [0.18, 0.5], [0.2, 0.68], [0.19, 0.82], [0.12, 0.93], [0.06, 1], [0.001, 1]]
    : [[0.001, 0], [0.14, 0.02], [0.13, 0.16], [0.115, 0.3], [0.135, 0.5], [0.15, 0.66], [0.155, 0.8], [0.1, 0.93], [0.05, 1], [0.001, 1]];
  if (!o.noTorso) k.lathe(prof.map(([r, y]) => [r * s, y * L]), { aim: tv, p: J.pelvis, sz: male ? 0.66 : 0.62, key: o.torsoKey });
  if (!male && !o.noTorso && o.bust !== false) for (const sx of [-1, 1]) {
    const c = J.pelvis.clone().addScaledVector(tv, 0.7).add(v3(sx * 0.055 * s, 0, 0.065 * s));
    k.ell(c, 0.06 * s, 0.055 * s, 0.05 * s, { key: o.torsoKey });
  }
  // 脖子、頭
  const hr = o.head ?? 0.105;
  k.limb(J.neck, J.head.clone().add(v3(0, -hr * 0.6, -0.01)), 0.045 * s * (male ? 1.15 : 1), 0.04 * s * (male ? 1.1 : 1));
  k.ell(J.head, hr * (male ? 0.98 : 0.95), hr * 1.18, hr * 1.04, { r: o.headR });
  k.ell(J.head.clone().add(v3(0, -hr * 0.42, hr * 0.28)), hr * 0.68, hr * 0.62, hr * 0.7, { r: o.headR }); // 下巴
  // 手臂
  for (const sd of ['L', 'R']) {
    const sh = J['sh' + sd], el = J['el' + sd], wr = J['wr' + sd];
    if (!sh) continue;
    const ua = o.arm ?? (male ? 0.055 : 0.045);
    k.ell(sh, ua * 1.3, ua * 1.2, ua * 1.25);
    // 整條手臂是一根連續的管（肩→肘→腕），關節不會有接縫
    const dA = sh.distanceTo(el), dB = el.distanceTo(wr), tE = dA / (dA + dB);
    const armR = (t) => t < tE ? lerp(ua, ua * 0.8, t / tE) * (1 + (male ? 0.12 : 0.05) * Math.sin(Math.PI * t / tE))
      : lerp(ua * 0.8, ua * 0.6, (t - tE) / (1 - tE)) * (1 + (male ? 0.14 : 0.07) * Math.sin(Math.PI * Math.min(1, (t - tE) / (1 - tE) * 1.6)));
    const a0 = sh.clone().addScaledVector(el.clone().sub(sh).normalize(), -ua * 0.4);
    k.tube([a0, at(sh, el, 0.5), el, at(el, wr, 0.5), wr], (t) => armR(t) * cap(t, 0.05), { segK: 26, key: o['arm' + sd + 'Key'] });
    const fd = wr.clone().sub(el).normalize(), hd = (J['hand' + sd] || fd).clone().normalize();
    if (!o['noHand' + sd]) k.ell(wr.clone().addScaledVector(hd, 0.055 * s), 0.036 * s * (male ? 1.1 : 1), 0.06 * s, 0.024 * s * (male ? 1.2 : 1), { aim: hd, key: o['hand' + sd + 'Key'] });
  }
  // 腿
  for (const sd of ['L', 'R']) {
    const hp = J['hip' + sd], kn = J['knee' + sd], an = J['ank' + sd];
    if (!hp || o.noLegs) continue;
    const th = o.thigh ?? (male ? 0.085 : 0.078);
    // 整條腿一根連續的管（髖→膝→踝），從骨盆裡面長出來
    const dA = hp.distanceTo(kn), dB = kn.distanceTo(an), tK = dA / (dA + dB);
    const legR = (t) => t < tK ? lerp(th * 1.08, th * 0.64, Math.pow(t / tK, 0.8)) * (1 + 0.06 * Math.sin(Math.PI * t / tK))
      : lerp(th * 0.64, th * 0.42, (t - tK) / (1 - tK)) * (1 + 0.2 * Math.sin(Math.PI * Math.min(1, (t - tK) / (1 - tK) * 1.5)));
    const h0 = hp.clone().add(v3(-Math.sign(hp.x) * 0.02, 0.06, 0));
    if (!o.noThigh) k.tube([h0, at(hp, kn, 0.5), kn, at(kn, an, 0.5), an.clone().add(v3(0, -0.02, 0))], (t) => legR(t) * cap(t, 0.04), { segK: 30, key: o.thighKey });
    if (o.shinKey) k.limb(at(kn, an, 0.72), an, th * 0.47, th * 0.43, { key: o.shinKey });
    const fw = (J['toe' + sd] || v3(0, 0, 1)).clone().normalize();
    k.ell(an.clone().add(v3(0, -0.03, 0)).addScaledVector(fw, 0.06 * s), 0.045 * s, 0.04 * s, 0.115 * s, { aim: v3(0, 0.001, 0).add(fw.clone().multiplyScalar(1)), key: o.footKey, r: null });
  }
}
// 腳掌：ell 的 aim 會把 Y 軸轉到前方，所以 rz/ry 尺寸對調（上面已用 0.115 當長邊），這裡只是語意說明

// 兩點之間取比例位置
const at = (a, b, t) => a.clone().lerp(b, t);

// ---------- 格溫（Bin）：洋娃娃、雙螺旋捲髮、蓬蓬裙、巨大剪刀 ----------
function gwen(k) {
  const J = {
    pelvis: v3(0, 0.86, 0), neck: v3(0, 1.31, 0), head: v3(0.005, 1.45, 0.012),
    shL: v3(0.155, 1.27, -0.005), elL: v3(0.29, 1.36, 0.03), wrL: v3(0.33, 1.56, 0.07), handL: v3(0.1, 1, 0.1),
    shR: v3(-0.155, 1.27, -0.005), elR: v3(-0.25, 1.05, 0.02), wrR: v3(-0.3, 0.84, 0.09),
    hipL: v3(0.075, 0.82, 0), kneeL: v3(0.085, 0.46, 0.04), ankL: v3(0.1, 0.075, 0.01),
    hipR: v3(-0.075, 0.82, 0), kneeR: v3(-0.1, 0.46, -0.01), ankR: v3(-0.14, 0.075, -0.05), toeR: v3(-0.35, 0, 1),
  };
  body(k, J, { s: 0.92, head: 0.112, arm: 0.04, thigh: 0.07 });
  const H = J.head;
  // 蓬蓬裙（外層有褶 + 內層荷葉邊）與裙撐
  k.lathe([[0.12, 1.0], [0.14, 0.95], [0.22, 0.86], [0.33, 0.72], [0.4, 0.58], [0.43, 0.49], [0.42, 0.47], [0.001, 0.47]], { p: v3(0, 0, 0.0), sz: 0.9, folds: { n: 9, amp: 0.07, y0: 0.95, y1: 0.47 } });
  k.lathe([[0.4, 0.5], [0.46, 0.44], [0.47, 0.42], [0.001, 0.42]], { sz: 0.9, folds: { n: 26, amp: 0.05, y0: 0.52, y1: 0.42, pow: 0.5 }, key: 'gold' });
  k.torus(v3(0, 0.975, 0), 0.13, 0.018, { r: [Math.PI / 2, 0, 0], s: [1, 0.88, 1], key: 'gold' }); // 腰帶
  // 背後的大蝴蝶結
  for (const sx of [-1, 1]) {
    k.ell(v3(sx * 0.13, 1.02, -0.17), 0.12, 0.075, 0.035, { r: [0, sx * 0.5, sx * 0.25] });
    k.strand([v3(sx * 0.03, 0.98, -0.15), v3(sx * 0.09, 0.82, -0.25), v3(sx * 0.14, 0.62, -0.32)], 0.03, 0.022, { wx: 1.6, wy: 0.35, hint: v3(1, 0, 0) });
  }
  k.ell(v3(0, 0.99, -0.15), 0.04, 0.035, 0.03);
  // 泡泡袖、袖口、領口
  for (const sd of ['L', 'R']) { k.ell(J['sh' + sd].clone().add(v3(0, -0.01, 0)), 0.08, 0.075, 0.075); k.torus(at(J['el' + sd], J['wr' + sd], 0.85), 0.034, 0.01, { q: _q.setFromUnitVectors(v3(0, 0, 1), J['wr' + sd].clone().sub(J['el' + sd]).normalize()).clone(), key: 'gold' }); }
  k.torus(v3(0, 1.3, 0.005), 0.055, 0.014, { r: [Math.PI / 2 - 0.15, 0, 0], key: 'gold' });
  k.ell(v3(0, 1.22, 0.1), 0.035, 0.028, 0.02, { key: 'gold' }); // 胸前小結
  // 鞋子（瑪莉珍鞋）
  for (const sd of ['L', 'R']) k.torus(J['ank' + sd].clone().add(v3(0, 0.03, 0)), 0.036, 0.008, { r: [Math.PI / 2, 0, 0], key: 'gold' });
  // 頭髮：髮帽、瀏海、兩側各兩條螺旋捲（招牌）
  k.ell(H.clone().add(v3(0, 0.025, -0.02)), 0.118, 0.13, 0.12);
  for (let i = -3; i <= 3; i++) k.strand([H.clone().add(v3(i * 0.03, 0.125, 0.04)), H.clone().add(v3(i * 0.036, 0.08, 0.1)), H.clone().add(v3(i * 0.04, 0.03, 0.112))], 0.026, 0.008, { e: 0.15 });
  for (const sx of [-1, 1]) {
    for (const [dz, len, R, rr] of [[-0.035, 0.66, 0.05, 0.042], [0.03, 0.46, 0.042, 0.034]]) {
      const root = H.clone().add(v3(sx * 0.115, 0.02, dz)), pts = [];
      const n = 42, turns = len * 6.5;
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = t * turns * Math.PI * 2 * sx, rr2 = R * (1 - 0.35 * t);
        pts.push(root.clone().add(v3(sx * (0.04 + 0.05 * t) + Math.cos(a) * rr2 * sx, -t * len, Math.sin(a) * rr2)));
      }
      k.strand(pts, rr, 0.012, { segK: 90, e: 0.04 });
    }
    // 髮根的蝴蝶結（鎏金）
    const b = H.clone().add(v3(sx * 0.11, 0.07, -0.03));
    k.ell(b.clone().add(v3(sx * 0.04, 0.035, 0)), 0.05, 0.03, 0.018, { r: [0, sx * 0.4, sx * 0.6], key: 'gold' });
    k.ell(b.clone().add(v3(sx * 0.04, -0.02, 0.01)), 0.045, 0.026, 0.016, { r: [0, sx * 0.4, -sx * 0.5], key: 'gold' });
    k.ell(b, 0.02, 0.02, 0.02, { key: 'gold' });
  }
  // 巨大剪刀：握把在右手，刀尖斜指右前方地面
  const grip = J.wrR.clone().add(v3(-0.02, -0.04, 0.03)), tip = v3(-0.42, 0.03, 0.3);
  const dir = grip.clone().sub(tip).normalize(), q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const piv = grip.clone().addScaledVector(dir, -0.17);
  const blade = [[0.0, 0.07], [0.055, 0.03], [0.05, -0.25], [0.028, -0.6], [0.004, -0.86], [-0.012, -0.5], [-0.016, 0.0]];
  for (const sd of [-1, 1]) {
    const ang = sd * 0.1;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(blade.map(([x, y]) => new THREE.Vector2(x * sd, y))), { depth: 0.018, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1 });
    g.translate(0, 0, sd * 0.012 - 0.009); g.rotateZ(ang);
    // 握把：連桿 + 圓環
    const ring = new THREE.TorusGeometry(0.06, 0.014, 8, 24); ring.translate(sd * 0.075, 0.2, sd * 0.012);
    const shank = new THREE.CylinderGeometry(0.014, 0.018, 0.14, 8); shank.rotateZ(-sd * 0.4); shank.translate(sd * 0.03, 0.09, sd * 0.012);
    ring.rotateZ(ang); shank.rotateZ(ang);
    for (const gg of [g, ring, shank]) { gg.applyQuaternion(q); gg.translate(piv.x, piv.y, piv.z); k.push(gg, 'gold'); }
  }
  const pv = new THREE.CylinderGeometry(0.03, 0.03, 0.06, 16); pv.rotateX(Math.PI / 2); pv.applyQuaternion(q); pv.translate(piv.x, piv.y, piv.z); k.push(pv, 'gold');
  return { height: 1.62 };
}

// ---------- 悟空（Xun）：金箍棒、頭箍與兩根長翎、鎧甲、捲尾 ----------
function wukong(k) {
  const J = {
    pelvis: v3(0, 0.86, 0), neck: v3(0, 1.45, 0.04), head: v3(0, 1.6, 0.07),
    shL: v3(0.22, 1.39, 0.01), elL: v3(0.34, 1.18, 0.14), wrL: v3(0.2, 1.3, 0.38), handL: v3(-0.3, 0.2, 1),
    shR: v3(-0.22, 1.39, 0), elR: v3(-0.4, 1.12, -0.04), wrR: v3(-0.44, 1.25, 0.1), handR: v3(-0.2, 0.1, 1),
    hipL: v3(0.12, 0.82, 0), kneeL: v3(0.32, 0.5, 0.14), ankL: v3(0.38, 0.075, 0.06), toeL: v3(0.4, 0, 1),
    hipR: v3(-0.12, 0.82, 0), kneeR: v3(-0.3, 0.47, 0.02), ankR: v3(-0.38, 0.075, -0.08), toeR: v3(-0.5, 0, 1),
  };
  body(k, J, { male: true, s: 1.05, head: 0.11, arm: 0.06, thigh: 0.1, bust: false });
  const H = J.head;
  // 猴臉：口鼻、眉骨、耳朵
  k.ell(H.clone().add(v3(0, -0.045, 0.085)), 0.068, 0.052, 0.058);
  k.ell(H.clone().add(v3(0, 0.035, 0.08)), 0.085, 0.022, 0.035);
  for (const sx of [-1, 1]) { k.ell(H.clone().add(v3(sx * 0.125, 0.0, -0.01)), 0.025, 0.06, 0.045, { r: [0, sx * 0.5, -sx * 0.3] }); k.ell(H.clone().add(v3(sx * 0.07, -0.07, 0.06)), 0.05, 0.05, 0.045); } // 耳朵、兩頰的毛
  // 頭髮（往後的尖刺）
  k.ell(H.clone().add(v3(0, 0.03, -0.025)), 0.112, 0.115, 0.115);
  for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.2; k.strand([H.clone().add(v3(Math.sin(a) * 0.08, 0.07, -0.06)), H.clone().add(v3(Math.sin(a) * 0.14, 0.08 - Math.abs(a) * 0.04, -0.17))], 0.035, 0.004, { e: 0.06, sharp: true }); }
  // 頭箍與兩根長翎（鎏金）
  k.torus(H.clone().add(v3(0, 0.045, 0.0)), 0.113, 0.014, { r: [Math.PI / 2 + 0.25, 0, 0], key: 'gold' });
  k.ell(H.clone().add(v3(0, 0.07, 0.105)), 0.025, 0.03, 0.012, { key: 'gold' });
  for (const sx of [-1, 1]) {
    const r = H.clone().add(v3(sx * 0.05, 0.1, 0.07));
    k.strand([r, r.clone().add(v3(sx * 0.05, 0.2, -0.04)), r.clone().add(v3(sx * 0.14, 0.42, -0.22)), r.clone().add(v3(sx * 0.26, 0.5, -0.48)), r.clone().add(v3(sx * 0.4, 0.44, -0.7))], 0.016, 0.006, { mid: 0.012, key: 'gold', segK: 40, radK: 8 });
  }
  // 鎧甲：胸甲、肩甲、腰帶、前後垂片、護腕
  k.ell(v3(0, 1.27, 0.035), 0.19, 0.17, 0.13, { key: 'gold' });
  k.ell(v3(0, 1.27, 0.022), 0.205, 0.16, 0.13);
  for (const sx of [-1, 1]) {
    const sh = sx > 0 ? J.shL : J.shR;
    k.ell(sh.clone().add(v3(sx * 0.03, 0.03, 0)), 0.11, 0.06, 0.1, { r: [0, 0, -sx * 0.45], key: 'gold' });
    k.ell(sh.clone().add(v3(sx * 0.05, -0.02, 0)), 0.1, 0.05, 0.095, { r: [0, 0, -sx * 0.55] });
  }
  k.torus(v3(0, 0.97, 0), 0.165, 0.035, { r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1], key: 'gold' });
  k.extrude([[-0.11, 0], [0.11, 0], [0.13, -0.42], [0, -0.48], [-0.13, -0.42]], 0.025, { p: v3(0, 0.95, 0.15), r: [0.12, 0, 0] });
  k.extrude([[-0.13, 0], [0.13, 0], [0.15, -0.5], [0, -0.55], [-0.15, -0.5]], 0.025, { p: v3(0, 0.95, -0.14), r: [-0.18, 0, 0] });
  for (const sd of ['L', 'R']) k.cyl(at(J['el' + sd], J['wr' + sd], 0.35), at(J['el' + sd], J['wr' + sd], 0.95), 0.062, 0.056, { key: 'gold' });
  // 寬褲 + 綁腿
  for (const sd of ['L', 'R']) {
    k.limb(J['hip' + sd], J['knee' + sd], 0.115, 0.085, { bulge: 0.15 });
    k.cyl(at(J['knee' + sd], J['ank' + sd], 0.45), at(J['knee' + sd], J['ank' + sd], 0.9), 0.06, 0.05, { key: 'gold' });
  }
  // 捲尾
  k.strand([v3(0, 0.86, -0.12), v3(0, 0.66, -0.38), v3(-0.18, 0.5, -0.58), v3(-0.38, 0.72, -0.72), v3(-0.38, 1.0, -0.6), v3(-0.24, 1.08, -0.5)], 0.042, 0.022, { segK: 40 });
  // 金箍棒：右手握住，棒尾立在地上
  const sx0 = -0.5, sz0 = 0.12;
  k.cyl(v3(sx0, 0.02, sz0), v3(sx0 + 0.05, 2.24, sz0 - 0.02), 0.03, 0.03);
  for (const [y0, y1] of [[0.02, 0.24], [2.02, 2.24]]) {
    const a = v3(sx0 + 0.05 * y0 / 2.22, y0, sz0 - 0.02 * y0 / 2.22), b = v3(sx0 + 0.05 * y1 / 2.22, y1, sz0 - 0.02 * y1 / 2.22);
    k.cyl(a, b, 0.037, 0.037, { key: 'gold' });
    for (const t of [0.15, 0.85]) k.torus(at(a, b, t), 0.04, 0.008, { r: [Math.PI / 2, 0, 0], key: 'gold' });
  }
  return { height: 1.9 };
}

// ---------- 阿狸（Knight 第一座）：九尾、狐耳、長髮、法球 ----------
function ahri(k) {
  const J = {
    pelvis: v3(0.03, 0.92, 0), neck: v3(0, 1.42, 0.0), head: v3(-0.012, 1.56, 0.02),
    shL: v3(0.165, 1.38, 0.0), elL: v3(0.33, 1.2, 0.08), wrL: v3(0.42, 1.3, 0.26), handL: v3(0.05, 0.5, 1),
    shR: v3(-0.165, 1.37, 0.0), elR: v3(-0.27, 1.12, -0.03), wrR: v3(-0.36, 0.91, 0.07), handR: v3(-0.4, -1, 0.2),
    hipL: v3(0.1, 0.88, 0), kneeL: v3(0.075, 0.49, 0.05), ankL: v3(0.06, 0.075, 0.0),
    hipR: v3(-0.06, 0.88, 0), kneeR: v3(-0.02, 0.5, 0.11), ankR: v3(-0.08, 0.1, 0.04), toeR: v3(-0.2, -0.3, 1),
  };
  body(k, J, { s: 0.95, head: 0.105, arm: 0.04, thigh: 0.075 });
  const H = J.head;
  // 短裙（不對稱裙擺）與腰間垂帶
  k.lathe([[0.14, 1.0], [0.16, 0.94], [0.24, 0.8], [0.29, 0.68], [0.3, 0.64], [0.001, 0.64]], { p: v3(0.03, 0, 0), sz: 0.85, r: [0.05, 0, 0.05], folds: { n: 8, amp: 0.09, y0: 0.95, y1: 0.64 } });
  k.torus(v3(0.03, 0.985, 0), 0.14, 0.014, { r: [Math.PI / 2, 0, 0], s: [1, 0.85, 1], key: 'gold' });
  k.strand([v3(0.06, 0.98, 0.13), v3(0.09, 0.75, 0.2), v3(0.08, 0.45, 0.18)], 0.05, 0.035, { wx: 1, wy: 0.18, hint: v3(1, 0, 0) });
  k.ell(v3(0.06, 0.98, 0.13), 0.045, 0.035, 0.025, { key: 'gold' });
  // 寬袖（從手肘垂下）
  for (const sd of ['L', 'R']) {
    const el = J['el' + sd], wr = J['wr' + sd], st = at(el, wr, 0.2);
    k.lathe([[0.05, 0], [0.07, -0.1], [0.12, -0.3], [0.15, -0.42], [0.145, -0.44]], { p: st, sz: 0.6, r: [0, sd === 'L' ? 0.4 : -0.3, sd === 'L' ? 0.25 : -0.15], folds: { n: 5, amp: 0.12, y0: 0, y1: -0.44 }, open: 0.01 });
    k.torus(st, 0.05, 0.01, { r: [Math.PI / 2, 0, 0], key: 'gold' });
  }
  // 頭髮：髮帽、瀏海、垂到腰的長髮
  k.ell(H.clone().add(v3(0, 0.02, -0.02)), 0.112, 0.128, 0.118);
  for (let i = -3; i <= 3; i++) k.strand([H.clone().add(v3(i * 0.03, 0.12, 0.05)), H.clone().add(v3(i * 0.036, 0.07, 0.105)), H.clone().add(v3(i * 0.044, 0.0, 0.11))], 0.024, 0.006, { e: 0.15 });
  for (let i = 0; i < 9; i++) {
    const u = i / 8 - 0.5, x = u * 0.2;
    k.strand([H.clone().add(v3(x * 0.8, 0.06, -0.07)), H.clone().add(v3(x * 1.2, -0.12, -0.12)), v3(x * 1.5 + 0.01, 1.22, -0.17 + Math.abs(u) * 0.05), v3(x * 1.7 + 0.03, 1.02 + Math.abs(u) * 0.12, -0.16)], 0.04, 0.012, { e: 0.05 });
  }
  for (const sx of [-1, 1]) k.strand([H.clone().add(v3(sx * 0.1, 0.0, 0.03)), H.clone().add(v3(sx * 0.13, -0.15, 0.04)), v3(sx * 0.15 - 0.01, 1.25, 0.06)], 0.03, 0.01);
  // 狐耳
  for (const sx of [-1, 1]) {
    const ear = [[-0.045, 0], [0.045, 0], [0.012, 0.14], [0.0, 0.15], [-0.01, 0.14]];
    k.extrude(ear, 0.03, { p: H.clone().add(v3(sx * 0.072, 0.1, -0.015)), r: [0.15, 0, -sx * 0.4] });
    k.extrude([[-0.025, 0.01], [0.025, 0.01], [0.006, 0.1], [-0.006, 0.1]], 0.012, { p: H.clone().add(v3(sx * 0.074, 0.105, 0.002)), r: [0.15, 0, -sx * 0.4], key: 'gold' });
  }
  // 九條尾巴：扇形展開在身後，尾尖鎏金
  const base = v3(0.02, 0.9, -0.12), rng = mulberry(3);
  for (let i = 0; i < 9; i++) {
    const u = i / 8 - 0.5, ang = u * 3.5, e = rng() * 0.35, L = 0.95 + rng() * 0.25;
    const d = v3(Math.sin(ang), 0, -Math.cos(ang)), sd = v3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(Math.sign(u || 1));
    const lift = 1 - Math.abs(u) * 0.7;
    const pts = [base.clone(), base.clone().addScaledVector(d, 0.18).add(v3(0, -0.03, 0)),
      base.clone().addScaledVector(d, 0.45 * L).add(v3(0, 0.18 + e * 0.2, 0)),
      base.clone().addScaledVector(d, 0.62 * L).add(v3(0, (0.5 + e * 0.3) * lift + 0.08, 0)).addScaledVector(sd, 0.06),
      base.clone().addScaledVector(d, 0.5 * L).add(v3(0, (0.85 + e * 0.35) * lift + 0.12, 0)).addScaledVector(sd, 0.2),
      base.clone().addScaledVector(d, 0.32 * L).add(v3(0, (1.0 + e * 0.35) * lift + 0.12, 0)).addScaledVector(sd, 0.42)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const rr = (t) => (t < 0.5 ? lerp(0.035, 0.115, Math.sin(Math.PI / 2 * t / 0.5)) : lerp(0.115, 0.022, Math.pow((t - 0.5) / 0.5, 1.6))) * cap(t, 0.04);
    k.tube(pts, rr, { segK: 34, radK: 14, twist: 2 });
    const tp = []; for (let j = 0; j <= 8; j++) tp.push(curve.getPointAt(0.84 + 0.16 * j / 8));
    k.tube(tp, (t) => rr(0.84 + 0.16 * t) * 1.1 * (t < 0.5 ? 1 : cap(t, 0.5)), { segK: 12, radK: 12, key: 'gold' });
  }
  // 法球：左手掌上方（會發光）
  const orb = J.wrL.clone().add(v3(0.03, 0.13, 0.06));
  k.ell(orb, 0.075, 0.075, 0.075, { key: 'glow' });
  k.torus(orb, 0.1, 0.008, { r: [0.9, 0.3, 0.2], key: 'gold' });
  k.torus(orb, 0.11, 0.006, { r: [-0.6, 0.8, 0], key: 'gold' });
  return { height: 1.7, glows: [orb] };
}

// ---------- 洛克（Knight 第二座）：長外套、眼鏡、背上的棺材、巨釘、化為灰燼的雙腳 ----------
function locke(k) {
  const J = {
    pelvis: v3(0, 0.97, 0), neck: v3(0, 1.52, 0.0), head: v3(0.0, 1.665, 0.025),
    shL: v3(0.2, 1.47, -0.01), elL: v3(0.3, 1.3, 0.16), wrL: v3(0.15, 1.58, 0.1), handL: v3(-0.3, 1, 0.1),
    shR: v3(-0.2, 1.47, -0.01), elR: v3(-0.31, 1.2, 0.0), wrR: v3(-0.35, 0.97, 0.08), handR: v3(0, -1, 0.15),
    hipL: v3(0.1, 0.93, 0), kneeL: v3(0.12, 0.52, 0.03), ankL: v3(0.13, 0.075, 0.0),
    hipR: v3(-0.1, 0.93, 0), kneeR: v3(-0.14, 0.52, 0.07), ankR: v3(-0.17, 0.075, 0.06), toeR: v3(-0.25, 0, 1),
  };
  body(k, J, { male: true, s: 1.0, head: 0.105, arm: 0.065, thigh: 0.088, footKey: 'ash' });
  const H = J.head;
  // 長外套（正面開襟、下擺飄動）＋高領
  k.lathe([[0.15, 1.5], [0.215, 1.44], [0.21, 1.3], [0.19, 1.12], [0.19, 1.0], [0.24, 0.8], [0.3, 0.6], [0.34, 0.42], [0.335, 0.4]], { sz: 0.72, open: 0.55, folds: { n: 7, amp: 0.09, y0: 1.0, y1: 0.4 } });
  k.lathe([[0.07, 1.46], [0.09, 1.52], [0.115, 1.6], [0.12, 1.63]], { sz: 0.95, open: 0.9 });
  k.torus(v3(0, 1.03, 0.0), 0.19, 0.016, { r: [Math.PI / 2, 0, 0], s: [1, 0.74, 1], key: 'gold' });
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) k.ell(v3(sx * 0.075, 1.36 - i * 0.1, 0.152 - i * 0.004), 0.012, 0.012, 0.008, { key: 'gold' });
  // 斜背帶
  k.strand([v3(0.17, 1.47, 0.07), v3(0.05, 1.3, 0.155), v3(-0.12, 1.08, 0.14), v3(-0.19, 0.98, 0.0)], 0.022, 0.022, { wx: 1.6, wy: 0.4, round: false, hint: v3(0, 0, 1), key: 'gold' });
  // 眼鏡
  for (const sx of [-1, 1]) {
    k.torus(H.clone().add(v3(sx * 0.038, 0.01, 0.1)), 0.026, 0.0045, { seg: 20, key: 'gold' });
    k.cyl(H.clone().add(v3(sx * 0.064, 0.012, 0.098)), H.clone().add(v3(sx * 0.1, 0.02, 0.0)), 0.004, 0.004, { key: 'gold', seg: 6 });
  }
  k.cyl(H.clone().add(v3(-0.012, 0.016, 0.104)), H.clone().add(v3(0.012, 0.016, 0.104)), 0.004, 0.004, { key: 'gold', seg: 6 });
  // 頭髮：往後梳 + 幾縷垂在額前
  k.ell(H.clone().add(v3(0, 0.035, -0.025)), 0.11, 0.11, 0.115);
  for (let i = 0; i < 7; i++) { const x = (i / 6 - 0.5) * 0.17; k.strand([H.clone().add(v3(x, 0.1, 0.07)), H.clone().add(v3(x * 1.1, 0.135, -0.02)), H.clone().add(v3(x * 1.2, 0.08, -0.13))], 0.03, 0.01); }
  for (const x of [-0.03, 0.02]) k.strand([H.clone().add(v3(x, 0.12, 0.07)), H.clone().add(v3(x + 0.015, 0.06, 0.11)), H.clone().add(v3(x + 0.03, 0.0, 0.112))], 0.012, 0.004);
  // 背上的棺材（裝著投擲用的釘子）
  const coffin = [[-0.13, 0.72], [0.13, 0.72], [0.26, 0.38], [0.19, -0.72], [-0.19, -0.72], [-0.26, 0.38]];
  const cP = v3(0.02, 1.12, -0.29), cR = [0.08, 0, -0.14];
  k.extrude(coffin, 0.2, { p: cP, r: cR, bevel: 0.02 });
  const cq = new THREE.Quaternion().setFromEuler(new THREE.Euler(cR[0], cR[1], cR[2], 'YXZ'));
  const cpt = (x, y, z) => v3(x, y, z).applyQuaternion(cq).add(cP);
  for (const zf of [-0.12, 0.12]) coffin.forEach(([x, y], i) => { const [x2, y2] = coffin[(i + 1) % coffin.length]; k.cyl(cpt(x * 0.97, y * 0.97, zf), cpt(x2 * 0.97, y2 * 0.97, zf), 0.012, 0.012, { key: 'gold', seg: 6 }); k.ell(cpt(x * 0.97, y * 0.97, zf), 0.014, 0.014, 0.014, { key: 'gold', w: 8, h: 6 }); });
  k.cyl(cpt(0, -0.45, -0.125), cpt(0, 0.5, -0.125), 0.016, 0.016, { key: 'gold', seg: 6 });
  k.torus(cpt(0, 0.1, -0.13), 0.08, 0.011, { q: cq.clone(), key: 'gold' });
  // 巨釘：右手握在釘帽下方，釘尖斜插向右前方地面
  const grip = J.wrR.clone().add(v3(0.0, -0.04, 0.02)), tip = v3(-0.42, 0.0, 0.27);
  const dir = grip.clone().sub(tip).normalize(), top = grip.clone().addScaledVector(dir, 0.16);
  k.cyl(tip, tip.clone().addScaledVector(dir, 0.18), 0.002, 0.036, { seg: 4, key: 'gold' });
  k.cyl(tip.clone().addScaledVector(dir, 0.18), top, 0.036, 0.045, { seg: 4 });
  k.cyl(top, top.clone().addScaledVector(dir, 0.05), 0.11, 0.11, { key: 'gold' });
  k.cyl(top.clone().addScaledVector(dir, -0.04), top, 0.05, 0.065, { key: 'gold' });
  // 腳邊的灰燼
  const rng = mulberry(7);
  for (let i = 0; i < 40; i++) { // 低矮的灰燼堆，離腳越遠越扁
    const a = rng() * Math.PI * 2, r = 0.03 + Math.pow(rng(), 1.5) * 0.3, sd = rng() < 0.5 ? J.ankL : J.ankR, f = 1 - r / 0.36;
    k.ell(v3(sd.x + Math.cos(a) * r, 0.0, sd.z + Math.sin(a) * r * 0.8), 0.05 + rng() * 0.05, 0.015 + f * 0.05 * rng(), 0.05 + rng() * 0.05, { key: 'ash', w: 10, h: 7, r: [0, rng() * 3, 0] });
  }
  for (const sd of ['L', 'R']) k.limb(at(J['knee' + sd], J['ank' + sd], 0.7), J['ank' + sd], 0.045, 0.04, { key: 'ash' });
  return { height: 1.86 };
}

// ---------- 伊澤瑞爾（Viper）：探險家、圍巾、護目鏡、發光的護手 ----------
function ezreal(k) {
  const J = {
    pelvis: v3(0, 0.93, 0), neck: v3(0, 1.46, 0.02), head: v3(0.01, 1.6, 0.045),
    shL: v3(0.19, 1.41, 0.02), elL: v3(0.33, 1.42, 0.22), wrL: v3(0.42, 1.5, 0.48), handL: v3(0.2, 0.6, 1),
    shR: v3(-0.19, 1.41, 0.0), elR: v3(-0.33, 1.13, -0.08), wrR: v3(-0.2, 0.99, 0.02), handR: v3(1, -0.4, 0.2),
    hipL: v3(0.1, 0.89, 0), kneeL: v3(0.14, 0.53, 0.2), ankL: v3(0.15, 0.1, 0.22), toeL: v3(0.1, 0, 1),
    hipR: v3(-0.1, 0.89, 0), kneeR: v3(-0.12, 0.49, -0.08), ankR: v3(-0.14, 0.12, -0.28), toeR: v3(0, -0.5, 1),
  };
  body(k, J, { male: true, s: 1.0, head: 0.104, arm: 0.06, thigh: 0.088, bust: false, foreLKey: 'gold', handLKey: 'gold' });
  const H = J.head;
  // 夾克下擺、腰帶與小包
  k.lathe([[0.19, 1.15], [0.2, 1.05], [0.22, 0.9], [0.235, 0.82], [0.23, 0.8]], { sz: 0.7, open: 0.6, folds: { n: 6, amp: 0.05, y0: 1.05, y1: 0.8 } });
  k.torus(v3(0, 0.95, 0), 0.165, 0.02, { r: [Math.PI / 2, 0, 0], s: [1, 0.78, 1], key: 'gold' });
  for (const [x, z, ry] of [[0.14, 0.08, 0.9], [-0.15, 0.06, -0.9], [0.0, -0.13, 0]]) k.extrude([[-0.04, 0], [0.04, 0], [0.04, -0.08], [-0.04, -0.08]], 0.04, { p: v3(x, 0.95, z), r: [0, ry, 0] });
  // 立領與圍巾（往身後飄）
  k.lathe([[0.075, 1.4], [0.1, 1.46], [0.12, 1.52]], { sz: 0.95, open: 1.0 });
  k.torus(v3(0, 1.44, 0.015), 0.085, 0.032, { r: [Math.PI / 2 - 0.25, 0, 0] });
  k.strand([v3(-0.05, 1.45, -0.07), v3(-0.18, 1.38, -0.3), v3(-0.38, 1.3, -0.52), v3(-0.62, 1.28, -0.66)], 0.05, 0.04, { wx: 1, wy: 0.22, hint: v3(0, 1, 0), segK: 30 });
  k.strand([v3(0.02, 1.43, -0.07), v3(-0.05, 1.3, -0.28), v3(-0.18, 1.12, -0.46), v3(-0.34, 1.02, -0.6)], 0.045, 0.035, { wx: 1, wy: 0.22, hint: v3(0, 1, 0), segK: 30 });
  // 靴子
  for (const sd of ['L', 'R']) k.limb(at(J['knee' + sd], J['ank' + sd], 0.45), J['ank' + sd], 0.06, 0.055, { key: 'gold' });
  // 頭髮：往上往後翹的髮束
  k.ell(H.clone().add(v3(0, 0.03, -0.02)), 0.108, 0.115, 0.115);
  for (let i = 0; i < 8; i++) {
    const u = i / 7 - 0.5;
    k.strand([H.clone().add(v3(u * 0.17, 0.08, 0.08 - Math.abs(u) * 0.05)), H.clone().add(v3(u * 0.22, 0.17, 0.04)), H.clone().add(v3(u * 0.27, 0.2 + (0.5 - Math.abs(u)) * 0.04, -0.1))], 0.04, 0.004, { e: 0.06, sharp: true });
  }
  // 護目鏡（推在額頭上）
  k.torus(H.clone().add(v3(0, 0.075, 0)), 0.112, 0.01, { r: [Math.PI / 2 + 0.35, 0, 0], key: 'gold' });
  for (const sx of [-1, 1]) {
    const c = H.clone().add(v3(sx * 0.045, 0.1, 0.085));
    k.cyl(c, c.clone().add(v3(0, 0.02, 0.035)), 0.03, 0.028, { key: 'gold' });
  }
  // 護手：左前臂的鎏金臂甲 + 手背的寶石（會發光）
  const el = J.elL, wr = J.wrL, fd = wr.clone().sub(el).normalize();
  k.lathe([[0.07, 0], [0.075, 0.12], [0.066, 0.22], [0.072, 0.26]], { p: at(el, wr, 0.2), aim: fd, key: 'gold' });
  for (const t of [0.35, 0.65]) k.torus(at(el, wr, t), 0.076, 0.009, { q: new THREE.Quaternion().setFromUnitVectors(v3(0, 0, 1), fd), key: 'gold' });
  const gem = wr.clone().addScaledVector(fd, 0.05).add(v3(0, 0.035, 0));
  k.ell(gem, 0.028, 0.02, 0.028, { key: 'glow' });
  return { height: 1.78, glows: [wr.clone().addScaledVector(fd, 0.14)] };
}

// ---------- 璐璐（ON）：約德爾人、巨大巫師帽、尖耳、捲頂法杖、小精靈 Pix ----------
function lulu(k) {
  const J = {
    pelvis: v3(0, 0.42, 0), neck: v3(0, 0.64, 0), head: v3(0, 0.8, 0.012),
    shL: v3(0.1, 0.61, 0), elL: v3(0.19, 0.66, 0.05), wrL: v3(0.25, 0.79, 0.09), handL: v3(0.2, 1, 0.2),
    shR: v3(-0.1, 0.61, 0), elR: v3(-0.17, 0.5, 0.04), wrR: v3(-0.2, 0.45, 0.11), handR: v3(-0.3, 0.2, 1),
    hipL: v3(0.05, 0.4, 0), kneeL: v3(0.055, 0.22, 0.02), ankL: v3(0.06, 0.05, 0.0),
    hipR: v3(-0.05, 0.4, 0), kneeR: v3(-0.06, 0.22, 0.03), ankR: v3(-0.075, 0.05, 0.02), toeR: v3(-0.2, 0, 1),
  };
  body(k, J, { s: 0.62, head: 0.15, arm: 0.03, thigh: 0.05, bust: false });
  const H = J.head;
  // 洋裝
  k.lathe([[0.08, 0.64], [0.1, 0.56], [0.12, 0.48], [0.19, 0.36], [0.23, 0.27], [0.225, 0.255], [0.001, 0.255]], { sz: 0.9, folds: { n: 8, amp: 0.08, y0: 0.5, y1: 0.255 } });
  k.lathe([[0.22, 0.28], [0.245, 0.25], [0.001, 0.25]], { sz: 0.9, folds: { n: 22, amp: 0.05, y0: 0.29, y1: 0.25, pow: 0.4 }, key: 'gold' });
  k.torus(v3(0, 0.51, 0), 0.105, 0.012, { r: [Math.PI / 2, 0, 0], s: [1, 0.9, 1], key: 'gold' });
  // 長髮（垂到背後）
  k.ell(H.clone().add(v3(0, 0.0, -0.025)), 0.155, 0.16, 0.16);
  for (let i = 0; i < 9; i++) { const u = i / 8 - 0.5; k.strand([H.clone().add(v3(u * 0.22, 0.02, -0.11)), H.clone().add(v3(u * 0.3, -0.14, -0.16)), v3(u * 0.32, 0.42, -0.15 + Math.abs(u) * 0.05)], 0.045, 0.015); }
  for (let i = -3; i <= 3; i++) k.strand([H.clone().add(v3(i * 0.04, 0.12, 0.08)), H.clone().add(v3(i * 0.05, 0.06, 0.145)), H.clone().add(v3(i * 0.055, 0.0, 0.15))], 0.03, 0.008, { e: 0.15 });
  // 約德爾尖耳（往兩側斜下）
  for (const sx of [-1, 1]) k.strand([H.clone().add(v3(sx * 0.13, 0.0, -0.01)), H.clone().add(v3(sx * 0.24, 0.02, -0.04)), H.clone().add(v3(sx * 0.33, 0.06, -0.08))], 0.04, 0.003, { wx: 1, wy: 0.4, hint: v3(0, 1, 0), e: 0.05, sharp: true });
  // 巨大巫師帽：寬帽簷 + 彎折的高帽身 + 帽帶
  const hb = H.clone().add(v3(0, 0.1, -0.01));
  k.lathe([[0.001, 0.02], [0.2, 0.012], [0.33, -0.005], [0.36, -0.02], [0.355, -0.03], [0.2, -0.008], [0.001, 0.0]], { p: hb, r: [-0.1, 0, 0.06], folds: { n: 6, amp: 0.06, y0: 0.0, y1: -0.03, pow: 0.5 } });
  k.tube([hb.clone().add(v3(0, 0.0, 0)), hb.clone().add(v3(0.0, 0.2, -0.03)), hb.clone().add(v3(0.03, 0.4, -0.08)), hb.clone().add(v3(0.12, 0.55, -0.2)), hb.clone().add(v3(0.25, 0.58, -0.32))], (t) => (0.165 * (1 - t) ** 1.1 + 0.006) * (t > 0.96 ? cap(t, 0.04) : 1), { segK: 30, radK: 16 });
  k.torus(hb.clone().add(v3(0, 0.035, -0.005)), 0.155, 0.015, { r: [Math.PI / 2 - 0.1, 0, 0.06], key: 'gold' });
  k.ell(hb.clone().add(v3(0.0, 0.05, 0.15)), 0.035, 0.03, 0.012, { key: 'gold' });
  // 法杖：右手握住，杖頂是捲曲的螺旋
  const st = v3(-0.23, 0.0, 0.13), top = v3(-0.22, 0.96, 0.12);
  k.cyl(st, top, 0.014, 0.016);
  const sp = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40, a = t * Math.PI * 3.2, r = 0.09 * (1 - t * 0.75); sp.push(top.clone().add(v3(Math.cos(a) * r - 0.09, Math.sin(a) * r * 1.1 + 0.02 + t * 0.03, 0))); }
  k.strand([top.clone().add(v3(0, -0.02, 0)), ...sp], 0.016, 0.01, { key: 'gold', segK: 60, radK: 8 });
  k.ell(top.clone().add(v3(-0.09, 0.03, 0)), 0.025, 0.025, 0.025, { key: 'glow' });
  return { height: 1.0, glows: [top.clone().add(v3(-0.09, 0.03, 0))], pix: v3(0.36, 1.02, 0.16) };
}

// 小精靈 Pix：獨立物件（會上下飄）
function buildPix(detail, mats) {
  const k = new Kit(detail);
  k.ell(v3(), 0.045, 0.045, 0.045, { key: 'glow' });
  for (const sx of [-1, 1]) {
    k.extrude([[0, 0], [0.05, 0.035], [0.1, 0.03], [0.07, -0.01], [0.02, -0.02]], 0.006, { p: v3(sx * 0.02, 0.01, -0.02), r: [0, sx > 0 ? -0.5 : Math.PI + 0.5, 0], key: 'gold' });
  }
  k.lathe([[0.045, 0], [0.02, 0.05], [0.002, 0.08]], { p: v3(0, 0.03, 0), r: [0, 0, 0.3], key: 'gold' });
  return merged(k, mats);
}

// 亂數（固定種子，每次載入都一樣）
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function merged(k, mats) {
  const g = new THREE.Group();
  for (const [key, list] of Object.entries(k.parts)) {
    if (!list.length) continue;
    const geo = mergeGeometries(list, false); list.forEach((x) => x.dispose());
    const m = new THREE.Mesh(geo, mats[key]); m.name = key; g.add(m);
  }
  return g;
}

export const ROSTER = [
  { player: 'BIN', champ: 'GWEN', zh: '格溫', fn: gwen, scale: 1.6 },
  { player: 'XUN', champ: 'WUKONG', zh: '悟空', fn: wukong, scale: 1.45 },
  { player: 'KNIGHT', champ: 'AHRI', zh: '阿狸', fn: ahri, scale: 1.5, fmvp: true },
  { player: 'KNIGHT', champ: 'LOCKE', zh: '洛克', fn: locke, scale: 1.45, fmvp: true },
  { player: 'VIPER', champ: 'EZREAL', zh: '伊澤瑞爾', fn: ezreal, scale: 1.46 },
  { player: 'ON', champ: 'LULU', zh: '璐璐', fn: lulu, scale: 2.4 },
];

// 古銅的斑駁感：用物件座標的雜訊讓顏色深淺不一，凹處偏一點青綠銅鏽、凸出處偏亮（像被摸亮的銅像）
function patina(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPat; varying vec3 vPN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = position; vPN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vPat; varying vec3 vPN;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float pn = n3(vPat * 23.0) * 0.55 + n3(vPat * 61.0) * 0.45;
float down = clamp(-vPN.y * 0.5 + 0.5, 0.0, 1.0);
diffuseColor.rgb *= mix(0.86, 1.1, pn);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.36, 0.3), smoothstep(0.62, 0.9, pn * 0.55 + down * 0.5) * 0.3);`);
  };
  return m;
}

export function statueMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    // 古銅：深棕帶一點綠色銅鏽的反光；鎏金：亮金
    bronze: patina(std({ color: 0x8a5a36, metalness: 0.92, roughness: 0.36, envMapIntensity: 1.25, side: THREE.DoubleSide })),
    gold: std({ color: 0xe0b660, metalness: 1, roughness: 0.22, envMapIntensity: 1.5, side: THREE.DoubleSide }),
    glow: std({ color: 0xffe4b0, emissive: 0xffc870, emissiveIntensity: 1.2, roughness: 0.3 }),
    ash: std({ color: 0xd6d0c4, roughness: 0.9, metalness: 0 }),
  };
}

// 建一座雕像（不含基座），回傳 { group, glows: [局部座標], pix }
export function buildFigure(entry, { detail = 1, mats = statueMaterials() } = {}) {
  const k = new Kit(detail);
  const info = entry.fn(k) || {};
  const g = merged(k, mats); g.scale.setScalar(entry.scale);
  const out = new THREE.Group(); out.add(g);
  let pix = null;
  if (info.pix) { pix = buildPix(detail, mats); pix.position.copy(info.pix).multiplyScalar(entry.scale); pix.scale.setScalar(entry.scale); out.add(pix); }
  return { group: out, glows: (info.glows || []).map((p) => p.clone().multiplyScalar(entry.scale)), pix, height: (info.height || 1.8) * entry.scale };
}

// 深綠大理石基座 + 鎏金線腳 + 古銅銘牌（選手名、英雄名）
export function buildPlinth(entry, { mats, high = true } = {}) {
  const g = new THREE.Group();
  const verdeT = T.marble({ size: high ? 512 : 256, base: [30, 56, 48], vein: [150, 176, 160], scale: 2.5, seedN: 21 });
  const verde = (buildPlinth.verde ||= new THREE.MeshStandardMaterial({ map: verdeT, roughness: 0.22, metalness: 0.05, envMapIntensity: 0.9 }));
  const boxm = (w, h, d, y, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.y = y + h / 2; g.add(b); return b; };
  boxm(1.46, 0.16, 1.46, 0, verde);
  boxm(1.36, 0.04, 1.36, 0.16, mats.gold);
  boxm(1.22, 0.78, 1.22, 0.2, verde);
  boxm(1.34, 0.04, 1.34, 0.98, mats.gold);
  boxm(1.42, 0.12, 1.42, 1.02, verde);
  const tex = T.textTexture([
    { t: entry.player, font: '700 150px "Cinzel", "Times New Roman", serif', y: 150, letter: 26 },
    { rule: 230, y: 245 },
    { t: entry.champ, font: '500 84px "Cinzel", "Times New Roman", serif', y: 325, letter: 22 },
  ], { w: 1024, h: 440, bg: '#3b2818', color: '#f0cf86', engrave: 'rgba(0,0,0,0.55)', border: '#c9a24a' });
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.37), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));
  pl.position.set(0, 0.6, 0.612); g.add(pl);
  if (entry.fmvp) { // FMVP 的基座多一道金色桂冠線
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 32), mats.gold); r.position.set(0, 0.88, 0.62); g.add(r);
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.04), mats.gold); s.position.set(0, 0.88, 0.63); g.add(s);
  }
  return { group: g, top: 1.14 };
}
