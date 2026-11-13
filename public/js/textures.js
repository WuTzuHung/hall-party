// 程序化貼圖：全部用 canvas 生成，不需要下載任何圖檔，載入快
import * as THREE from 'three';

let seed = 1337;
export function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function setSeed(s) { seed = s; }

// ---------- value noise ----------
const P = new Uint8Array(512);
(() => { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; })();
function hash(x, y) { return P[(P[x & 255] + y) & 511] / 255; }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// 可平鋪的 fbm：週期 period
function tnoise(x, y, per) {
  const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (n) => ((n % per) + per) % per;
  const a = hash(m(xi), m(yi)), b = hash(m(xi + 1), m(yi)), c = hash(m(xi), m(yi + 1)), d = hash(m(xi + 1), m(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, per, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * tnoise(x * f, y * f, per * f); a *= 0.5; f *= 2; }
  return s;
}

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function toTex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function pixelFill(c, fn) {
  const ctx = c.getContext('2d'); const img = ctx.createImageData(c.width, c.height); const d = img.data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const [r, g, b] = fn(x, y); const i = (y * c.width + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return ctx;
}

// ---------- 石灰岩（立面）：可選擇石塊縫 ----------
// 一張貼圖代表 tileMeters 公尺見方
export function limestone({ size = 512, blockW = 2, blockH = 0.6, tileMeters = 4, rustic = false, base = [216, 205, 182], seedN = 3 } = {}) {
  setSeed(seedN);
  const c = canvas(size); const px = size / tileMeters;
  const ctx = pixelFill(c, (x, y) => {
    const n = fbm(x / size * 8, y / size * 8, 8, 5);
    const n2 = tnoise(x / size * 64, y / size * 64, 64);
    const k = 0.86 + n * 0.22 + n2 * 0.05;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  if (blockW) {
    const rows = Math.round(tileMeters / blockH); const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const off = (r % 2) * blockW * px / 2;
      // 每塊石頭微微不同色
      for (let bx = -blockW * px; bx < size + blockW * px; bx += blockW * px) {
        ctx.fillStyle = `rgba(${rand() > .5 ? '255,250,240' : '120,105,85'},${rand() * 0.06})`;
        ctx.fillRect(bx + off, y, blockW * px, rh);
      }
      const jw = rustic ? 5 : 1.5;
      ctx.fillStyle = rustic ? 'rgba(70,58,44,0.75)' : 'rgba(110,95,78,0.45)';
      ctx.fillRect(0, y, size, jw);
      if (rustic) { ctx.fillStyle = 'rgba(255,250,235,0.35)'; ctx.fillRect(0, y + jw, size, 2); }
      for (let bx = off % (blockW * px); bx < size; bx += blockW * px) {
        ctx.fillStyle = rustic ? 'rgba(70,58,44,0.6)' : 'rgba(110,95,78,0.35)';
        ctx.fillRect(bx, y, rustic ? 3 : 1.2, rh);
      }
    }
  }
  // 歲月痕跡
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(rand() * size, rand() * size, 0, rand() * size, rand() * size, 40 + rand() * 80);
    g.addColorStop(0, 'rgba(90,80,65,0.05)'); g.addColorStop(1, 'rgba(90,80,65,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
  return toTex(c);
}

// ---------- 大理石 ----------
export function marble({ size = 512, base = [232, 222, 205], vein = [150, 130, 110], scale = 3, seedN = 7, tiles = 0, alt = null } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ctx = pixelFill(c, (x, y) => {
    const u = x / size, v = y / size;
    let b = base, vc = vein;
    if (tiles && alt) {
      const tx = Math.floor(u * tiles), ty = Math.floor(v * tiles);
      if ((tx + ty) % 2) { b = alt.base; vc = alt.vein; }
    }
    const f = fbm(u * scale * 2, v * scale * 2, scale * 2, 5);
    const w = Math.abs(Math.sin((u * 3 + v * 2) * Math.PI * 2 * scale / 3 + f * 9));
    const veinAmt = Math.pow(1 - w, 10) * 0.9 + Math.pow(1 - Math.abs(Math.sin((u - v * 1.5) * 12 + f * 14)), 30) * 0.4;
    const cloud = fbm(u * 4, v * 4, 4, 3) * 0.15;
    const m = Math.min(1, veinAmt);
    return [
      b[0] * (1 - cloud) * (1 - m) + vc[0] * m,
      b[1] * (1 - cloud) * (1 - m) + vc[1] * m,
      b[2] * (1 - cloud) * (1 - m) + vc[2] * m,
    ];
  });
  if (tiles) {
    const s = size / tiles;
    ctx.strokeStyle = 'rgba(40,30,20,0.55)'; ctx.lineWidth = 2;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(size, i * s); ctx.stroke();
    }
  }
  return toTex(c);
}

// ---------- 格狀天花（藻井） ----------
export function coffers({ size = 512, n = 2 } = {}) {
  // 藻井：石膏肋條 → 蛋箭飾帶 → 兩層內凹線腳 → 金線 → 凹陷底板與金色玫瑰花飾
  setSeed(11);
  const c = canvas(size); const ctx = c.getContext('2d');
  const s = size / n;
  // 光從左上來：內凹線腳的上、左面在陰影裡，下、右面受光
  const bevel = (x, y, a, b, cols) => {
    const o0 = [x + a, y + a, x + s - a, y + s - a], o1 = [x + b, y + b, x + s - b, y + s - b];
    const quad = (p, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.lineTo(p[6], p[7]); ctx.closePath(); ctx.fill(); };
    quad([o0[0], o0[1], o0[2], o0[1], o1[2], o1[1], o1[0], o1[1]], cols[0]); // 上
    quad([o0[0], o0[1], o1[0], o1[1], o1[0], o1[3], o0[0], o0[3]], cols[1]); // 左
    quad([o0[0], o0[3], o1[0], o1[3], o1[2], o1[3], o0[2], o0[3]], cols[2]); // 下
    quad([o0[2], o0[1], o0[2], o0[3], o1[2], o1[3], o1[2], o1[1]], cols[3]); // 右
  };
  const petals = (cx, cy, r, cnt, rot, wide, c0, c1) => {
    for (let k = 0; k < cnt; k++) {
      const a = rot + k / cnt * Math.PI * 2;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, r, 0); g.addColorStop(0, c0); g.addColorStop(1, c1);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(r * 0.12, 0);
      ctx.quadraticCurveTo(r * 0.55, -r * wide, r, 0); ctx.quadraticCurveTo(r * 0.55, r * wide, r * 0.12, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(90,62,18,0.55)'; ctx.lineWidth = Math.max(1, s * 0.004); ctx.beginPath(); ctx.moveTo(r * 0.2, 0); ctx.lineTo(r * 0.85, 0); ctx.stroke();
      ctx.restore();
    }
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * s, y = j * s;
    // 肋條（平面）
    ctx.fillStyle = '#f1e7d1'; ctx.fillRect(x, y, s, s);
    // 蛋箭飾帶
    const e0 = s * 0.085, e1 = s * 0.135;
    ctx.fillStyle = '#e2d3b4'; ctx.fillRect(x + e0, y + e0, s - 2 * e0, s - 2 * e0);
    const ne = 11, em = (e0 + e1) / 2;
    for (let k = 0; k < ne; k++) {
      const t = e1 + (k + 0.5) * (s - 2 * e1) / ne;
      for (const [px, py, rot] of [[x + t, y + em, 0], [x + t, y + s - em, 0], [x + em, y + t, Math.PI / 2], [x + s - em, y + t, Math.PI / 2]]) {
        ctx.fillStyle = '#fbf4e3'; ctx.beginPath(); ctx.ellipse(px, py, s * 0.013, s * 0.019, rot, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(150,118,62,0.75)'; ctx.lineWidth = Math.max(1, s * 0.004); ctx.stroke();
      }
    }
    // 第一層內凹線腳、平台、第二層內凹線腳
    bevel(x, y, s * 0.135, s * 0.195, ['#a8946f', '#bca883', '#fffaee', '#f1e6cd']);
    ctx.fillStyle = '#eadfc6'; ctx.fillRect(x + s * 0.195, y + s * 0.195, s * 0.61, s * 0.61);
    bevel(x, y, s * 0.225, s * 0.285, ['#9c8862', '#b29d78', '#fbf3df', '#eadcbf']);
    // 凹陷底板：邊緣較暗
    const px0 = x + s * 0.285, pw = s * 0.43, cx = x + s / 2, cy = y + s / 2;
    const pg = ctx.createRadialGradient(cx, cy, s * 0.04, cx, cy, s * 0.34);
    pg.addColorStop(0, '#d9c8a4'); pg.addColorStop(1, '#bda57c');
    ctx.fillStyle = pg; ctx.fillRect(px0, y + s * 0.285, pw, pw);
    ctx.fillStyle = 'rgba(70,50,20,0.22)'; ctx.fillRect(px0, y + s * 0.285, pw, s * 0.02); ctx.fillRect(px0, y + s * 0.285, s * 0.02, pw);
    // 金線
    ctx.strokeStyle = '#b98f3a'; ctx.lineWidth = s * 0.014; ctx.strokeRect(x + s * 0.21, y + s * 0.21, s * 0.58, s * 0.58);
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = s * 0.011; ctx.strokeRect(px0, y + s * 0.285, pw, pw);
    // 玫瑰花飾：兩層花瓣 + 花心，帶一點落影
    ctx.save(); ctx.shadowColor = 'rgba(60,40,10,0.55)'; ctx.shadowBlur = s * 0.03; ctx.shadowOffsetX = s * 0.012; ctx.shadowOffsetY = s * 0.012;
    petals(cx, cy, s * 0.15, 8, Math.PI / 8, 0.36, '#9c7426', '#e6c670');
    ctx.restore();
    petals(cx, cy, s * 0.1, 8, 0, 0.42, '#b8892f', '#f6e09a');
    const bg = ctx.createRadialGradient(cx - s * 0.01, cy - s * 0.01, 0, cx, cy, s * 0.04);
    bg.addColorStop(0, '#fff0b8'); bg.addColorStop(1, '#8c6520');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, s * 0.036, 0, Math.PI * 2); ctx.fill();
  }
  // 肋條正中的細金線，交叉點一顆金色圓釘
  for (let i = 0; i <= n; i++) {
    ctx.fillStyle = '#c4a050'; const t = i * s, lw = s * 0.012;
    ctx.fillRect(t - lw / 2, 0, lw, size); ctx.fillRect(0, t - lw / 2, size, lw);
  }
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const g = ctx.createRadialGradient(i * s - s * 0.008, j * s - s * 0.008, 0, i * s, j * s, s * 0.034);
    g.addColorStop(0, '#fff0b8'); g.addColorStop(1, '#96702a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(i * s, j * s, s * 0.032, 0, Math.PI * 2); ctx.fill();
  }
  return toTex(c);
}

// ---------- 彩繪玻璃（橢圓天窗，第凡內風格） ----------
// 畫布本身就是橢圓的長寬比（0.8:1），所有環帶都是「等寬內縮」的橢圓，不是把圓形拉長
export function stainedGlass(size = 768, variant = 0) {
  setSeed(100 + variant);
  const w = Math.round(size * 0.8), h = size;
  const c = canvas(w, h); const ctx = c.getContext('2d');
  const A = w / 2, B = h / 2, cx = A, cy = B;
  const LEAD = '#241b12';
  const amber = ['#f2c14e', '#e8a33c', '#ffd98a', '#d98f32'], green = ['#7fae5a', '#4f8a44', '#a8cf78', '#3a7a40'], cream = ['#efe7cc', '#f8f1dc', '#e2d8b6', '#d6c99e'];
  const rose = ['#d85f6b', '#bf4860', '#f08f8a', '#9c3350'], blue = ['#6f96d6', '#4a6fb8', '#9fbdea', '#34549a'], violet = ['#a17bd0', '#8259b8', '#c4a6e6', '#63409a'];
  const opal = ['#f6efd8', '#efe6c8', '#f3e9cf', '#e9dfc0'];
  const theme = [
    { field: [opal, amber], flower: rose, bud: blue, petal: rose, leaf: green, core: amber, ring: amber },
    { field: [opal, violet], flower: cream, bud: amber, petal: violet, leaf: green, core: rose, ring: amber },
    { field: [opal, blue], flower: amber, bud: rose, petal: blue, leaf: green, core: amber, ring: amber },
  ][variant % 3];
  const pick = (p) => p[Math.floor(rand() * p.length)];
  const pt = (d, t) => [cx + (A - d * A) * Math.cos(t), cy + (B - d * A) * Math.sin(t)]; // d：往內縮的距離（以短半徑為 1）
  const lw = (k) => Math.max(1.2, size * k);
  const piece = (d0, d1, t0, t1, col, lead = 0.0042) => {
    const st = Math.max(2, Math.ceil((t1 - t0) / 0.05));
    ctx.beginPath();
    for (let i = 0; i <= st; i++) { const p = pt(d0, t0 + (t1 - t0) * i / st); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    for (let i = st; i >= 0; i--) { const p = pt(d1, t0 + (t1 - t0) * i / st); ctx.lineTo(p[0], p[1]); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = LEAD; ctx.lineWidth = lw(lead); ctx.lineJoin = 'round'; ctx.stroke();
  };
  const band = (d0, d1, seg, pal, rows = 1, stagger = true) => {
    for (let r = 0; r < rows; r++) {
      const a = d0 + (d1 - d0) * r / rows, b = d0 + (d1 - d0) * (r + 1) / rows, off = stagger && r % 2 ? 0.5 : 0;
      for (let k = 0; k < seg; k++) piece(a, b, (k + off) / seg * Math.PI * 2, (k + 1 + off) / seg * Math.PI * 2, typeof pal === 'function' ? pal(k, r) : pick(pal));
    }
  };
  // 葉形／花瓣形玻璃：沿著徑向從 dIn 到 dOut，最寬處 wmax（弧度）
  const leafShape = (dIn, dOut, tc, wmax, col, vein = true) => {
    ctx.beginPath(); const N = 14;
    for (let i = 0; i <= N; i++) { const u = i / N; const p = pt(dIn + (dOut - dIn) * u, tc + wmax * Math.pow(Math.sin(Math.PI * u), 0.75)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    for (let i = N; i >= 0; i--) { const u = i / N; const p = pt(dIn + (dOut - dIn) * u, tc - wmax * Math.pow(Math.sin(Math.PI * u), 0.75)); ctx.lineTo(p[0], p[1]); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = LEAD; ctx.lineWidth = lw(0.005); ctx.stroke();
    if (vein) { const p0 = pt(dIn, tc), p1 = pt(dOut, tc); ctx.lineWidth = lw(0.0028); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
  };
  const disc = (x, y, r, col, lead = 0.004) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = LEAD; ctx.lineWidth = lw(lead); ctx.stroke(); };

  ctx.fillStyle = LEAD; ctx.fillRect(0, 0, w, h);
  // 1. 外緣：琥珀色小方格 + 一圈乳白珠
  band(0, 0.055, 84, theme.ring);
  band(0.055, 0.08, 120, cream);
  // 2. 花環帶：深淺綠葉的碎玻璃底 + 16 朵花，花與花之間一顆小花苞
  band(0.08, 0.25, 56, green, 3);
  for (let k = 0; k < 16; k++) {
    const t = k / 16 * Math.PI * 2, [fx, fy] = pt(0.165, t), r = A * 0.034;
    for (let j = 0; j < 6; j++) { const a = t + j / 6 * Math.PI * 2; disc(fx + Math.cos(a) * r * 1.05, fy + Math.sin(a) * r * 1.05, r * 0.8, theme.flower[(j + k) % 4]); }
    disc(fx, fy, r * 0.62, amber[2]);
    const [bx, by] = pt(0.165, t + Math.PI / 16); disc(bx, by, A * 0.022, pick(theme.bud));
  }
  band(0.25, 0.28, 72, (k) => (k % 2 ? cream[1] : theme.ring[0]));
  // 3. 主畫面：放射狀的乳白玻璃，越往中心越帶主題色
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const a = 0.28 + (0.74 - 0.28) * r / rows, b = 0.28 + (0.74 - 0.28) * (r + 1) / rows;
    const seg = [48, 32, 32, 16][r];
    for (let k = 0; k < seg; k++) piece(a, b, k / seg * Math.PI * 2, (k + 1) / seg * Math.PI * 2, rand() < r * 0.3 - 0.1 ? theme.field[1][2] : pick(theme.field[0]));
  }
  // 8 片大花瓣 + 8 片葉子交錯
  for (let k = 0; k < 8; k++) {
    const t = k / 8 * Math.PI * 2;
    leafShape(0.33, 0.73, t + Math.PI / 8, 0.085, k % 2 ? green[1] : green[0]);
    leafShape(0.31, 0.74, t, 0.15, theme.petal[k % 2 ? 0 : 2]);
    leafShape(0.44, 0.74, t, 0.07, theme.petal[k % 2 ? 2 : 0], false);
    const [gx, gy] = pt(0.305, t + Math.PI / 8); disc(gx, gy, A * 0.02, theme.bud[2]);
  }
  // 4. 中央：琥珀色環 + 橢圓花心
  band(0.74, 0.79, 28, theme.ring);
  const ra = A * 0.21, rb = B - 0.79 * A;
  ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, ra, rb, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = cream[1]; ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 12; k++) {
    const t0 = k / 12 * Math.PI * 2, t1 = (k + 1) / 12 * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(t0) * ra * 1.2, cy + Math.sin(t0) * rb * 1.2); ctx.lineTo(cx + Math.cos(t1) * ra * 1.2, cy + Math.sin(t1) * rb * 1.2); ctx.closePath();
    ctx.fillStyle = k % 2 ? theme.core[2] : theme.core[0]; ctx.fill(); ctx.strokeStyle = LEAD; ctx.lineWidth = lw(0.004); ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath(); ctx.ellipse(cx, cy, ra * 0.4, rb * 0.4, 0, 0, Math.PI * 2); ctx.fillStyle = theme.petal[0]; ctx.fill(); ctx.strokeStyle = LEAD; ctx.lineWidth = lw(0.005); ctx.stroke();
  // 環帶之間較粗的鉛條
  for (const d of [0.055, 0.08, 0.25, 0.28, 0.74, 0.79]) { ctx.beginPath(); ctx.ellipse(cx, cy, A - d * A, B - d * A, 0, 0, Math.PI * 2); ctx.strokeStyle = LEAD; ctx.lineWidth = lw(0.0065); ctx.stroke(); }
  // 乳白玻璃的流紋（很淡）
  ctx.lineCap = 'round';
  for (let i = 0; i < 900; i++) {
    const x = rand() * w, y = rand() * h, a = rand() * Math.PI, l = size * (0.01 + rand() * 0.03);
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(40,20,0,0.05)'; ctx.lineWidth = 1 + rand() * size * 0.004;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  // 透光感：中央較亮、邊緣略暗
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, B / A);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, A);
  g.addColorStop(0, 'rgba(255,244,210,0.30)'); g.addColorStop(0.6, 'rgba(255,236,190,0.04)'); g.addColorStop(1, 'rgba(20,10,0,0.28)');
  ctx.fillStyle = g; ctx.fillRect(-A, -A, 2 * A, 2 * A); ctx.restore();
  return toTex(c, { repeat: false });
}

// ---------- 文字橫幅 ----------
export function textTexture(lines, { w = 2048, h = 160, bg = 'rgba(0,0,0,0)', color = '#6b5c46', font = '700 96px "Cinzel", "Times New Roman", serif', letter = 18, shadow = null, engrave = null, border = null } = {}) {
  const c = canvas(w, h); const ctx = c.getContext('2d');
  const draw = () => {
  ctx.clearRect(0, 0, w, h); ctx.shadowBlur = 0;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (border) { // 細金線雙框
    ctx.strokeStyle = border; ctx.lineWidth = 5; ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.lineWidth = 1.5; ctx.strokeRect(28, 28, w - 56, h - 56);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ls = Array.isArray(lines) ? lines : [lines];
  ls.forEach((l, i) => {
    const txt = typeof l === 'string' ? { t: l } : l;
    const y = txt.y ?? (h / (ls.length + 1)) * (i + 1);
    if (txt.rule) { // 裝飾橫線 + 中央菱形
      const hw = txt.rule; ctx.fillStyle = txt.color || color;
      ctx.fillRect(w / 2 - hw, y - 1, hw - 14, 2); ctx.fillRect(w / 2 + 14, y - 1, hw - 14, 2);
      ctx.save(); ctx.translate(w / 2, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
      return;
    }
    ctx.font = txt.font || font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (txt.letter ?? letter) + 'px';
    if (shadow) { ctx.shadowColor = shadow; ctx.shadowBlur = 12; }
    if (engrave) { ctx.fillStyle = engrave; ctx.fillText(txt.t, w / 2 + 1.5, y + 2); } // 陰刻的受光邊
    ctx.fillStyle = txt.color || color;
    ctx.fillText(txt.t, w / 2, y);
  });
  };
  draw();
  return refont(toTex(c, { repeat: false }), draw);
}
// 網頁字型（Cinzel）可能比場景晚載入：載入完成後把文字貼圖重畫一次，確保刻字字體一致
let fontsReady;
function refont(tex, draw) {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return tex;
  fontsReady ||= Promise.all(['500', '700'].map(wt => document.fonts.load(wt + ' 48px "Cinzel"'))).catch(() => { });
  fontsReady.then(() => { draw(); tex.needsUpdate = true; });
  return tex;
}
// 月桂花環（古典紋飾）
function laurel(ctx, cx, cy, r, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI / 2 - side * 0.12, Math.PI / 2 - side * 2.75, side > 0); ctx.stroke();
    for (let i = 0; i < 11; i++) {
      const a = Math.PI / 2 - side * (0.3 + i * 0.235);
      for (const o of [-1, 1]) {
        ctx.save(); ctx.translate(Math.cos(a) * r, Math.sin(a) * r); ctx.rotate(a - side * (Math.PI / 2) + o * side * 0.6);
        ctx.beginPath(); ctx.ellipse(r * 0.17, 0, r * 0.17, r * 0.055, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }
  ctx.restore();
}
// 立面上的古典垂掛旗幟：深色底、金線框、月桂花環與決賽隊名（variant 0 = GEN.G，1 = BLG）
export function poster(variant = 0) {
  const w = 512, h = 1024; const c = canvas(w, h); const ctx = c.getContext('2d');
  const gold = '#d9b25c', goldHi = '#f0d898';
  const tail = 86; // 底部燕尾
  const draw = () => {
  ctx.save(); ctx.clearRect(0, 0, w, h);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(w / 2, h - tail); ctx.lineTo(0, h); ctx.closePath(); ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (variant % 2) { g.addColorStop(0, '#16224a'); g.addColorStop(1, '#0c1430'); } else { g.addColorStop(0, '#3a1420'); g.addColorStop(1, '#220a14'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 布料的細微直紋
  setSeed(40 + variant);
  for (let x = 0; x < w; x += 3) { ctx.fillStyle = `rgba(255,255,255,${0.012 + rand() * 0.02})`; ctx.fillRect(x, 0, 1, h); }
  // 雙金線框（跟著燕尾走）
  const frame = (m, lw) => { ctx.lineWidth = lw; ctx.strokeStyle = gold; ctx.beginPath(); ctx.moveTo(m, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, h - m * 2.2); ctx.lineTo(w / 2, h - tail - m * 1.2); ctx.lineTo(m, h - m * 2.2); ctx.closePath(); ctx.stroke(); };
  frame(22, 5); frame(36, 1.5);
  // 花環與星
  laurel(ctx, w / 2, 330, 92, gold);
  ctx.fillStyle = goldHi; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 13 : 32; ctx.lineTo(w / 2 + Math.cos(a) * r, 330 + Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
  // 隊名：刻字風格的羅馬大寫
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const rule = (y, hw) => { ctx.fillStyle = gold; ctx.fillRect(w / 2 - hw, y - 1, hw - 14, 2); ctx.fillRect(w / 2 + 14, y - 1, hw - 14, 2); ctx.save(); ctx.translate(w / 2, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore(); };
  rule(520, 150);
  ctx.font = '700 64px "Cinzel", "Times New Roman", serif'; if ('letterSpacing' in ctx) ctx.letterSpacing = '14px';
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(variant % 2 ? 'BLG' : 'GEN.G', w / 2 + 9, 603);
  ctx.fillStyle = goldHi; ctx.fillText(variant % 2 ? 'BLG' : 'GEN.G', w / 2 + 7, 600);
  rule(680, 150);
  ctx.restore();
  };
  draw();
  return refont(toTex(c, { repeat: false }), draw);
}
export function flag(text = 'GEN.G', field = '#1b2440') {
  const w = 256, h = 640; const c = canvas(w, h); const ctx = c.getContext('2d');
  const draw = () => {
  ctx.fillStyle = field; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d9b25c'; ctx.lineWidth = 4; ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.lineWidth = 1.5; ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.fillStyle = '#ecd592'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI / 2);
  ctx.font = '700 60px "Cinzel", "Times New Roman", serif'; if ('letterSpacing' in ctx) ctx.letterSpacing = '16px';
  ctx.fillText(text, 8, 4);
  ctx.restore();
  };
  draw();
  return refont(toTex(c, { repeat: false }), draw);
}
export function bigWindow({ lit = 0.6, cols = 3, rows = 5 } = {}) {
  setSeed(77);
  const w = 256, h = 512; const c = canvas(w, h); const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(${40 + 180 * lit},${40 + 120 * lit},${50 + 60 * lit},1)`);
  g.addColorStop(1, `rgba(${30 + 120 * lit},${25 + 70 * lit},${40 + 30 * lit},1)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 內部紫光
  const rg = ctx.createRadialGradient(w / 2, h * .7, 10, w / 2, h * .7, h * .6);
  rg.addColorStop(0, 'rgba(170,90,255,0.45)'); rg.addColorStop(1, 'rgba(170,90,255,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2f5c55'; ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.lineWidth = 6;
  for (let i = 1; i < cols; i++) { ctx.beginPath(); ctx.moveTo(i * w / cols, 0); ctx.lineTo(i * w / cols, h); ctx.stroke(); }
  for (let j = 1; j < rows; j++) { ctx.beginPath(); ctx.moveTo(0, j * h / rows); ctx.lineTo(w, j * h / rows); ctx.stroke(); }
  // 反光
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(0, h * .1); ctx.lineTo(w, 0); ctx.lineTo(w, h * .25); ctx.lineTo(0, h * .45); ctx.fill();
  return toTex(c, { repeat: false });
}

// 高樓層立面：石材 + 規則窗格（部分亮燈）
export function upperFacade({ floors = 8, cols = 10, w = 1024, h = 1024, seedN = 5, stone = '#d6cab2', frame = '#2f5c55' } = {}) {
  setSeed(seedN);
  const c = canvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = stone; ctx.fillRect(0, 0, w, h);
  // 石材噪點
  for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(${rand() > .5 ? '255,255,255' : '90,75,60'},${rand() * .05})`; ctx.fillRect(rand() * w, rand() * h, 3 + rand() * 6, 2 + rand() * 4); }
  const fh = h / floors, cw = w / cols;
  for (let f = 0; f < floors; f++) {
    ctx.fillStyle = 'rgba(110,95,78,0.35)'; ctx.fillRect(0, f * fh, w, 2);
    ctx.fillStyle = 'rgba(255,248,232,0.4)'; ctx.fillRect(0, f * fh + fh * .86, w, fh * .04); // 窗台線
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * .27, y = f * fh + fh * .2, ww = cw * .46, wh = fh * .62;
      const lit = rand();
      const col = lit > .62 ? `rgb(${230 + rand() * 25},${180 + rand() * 40},${110 + rand() * 40})` : lit > .5 ? '#5a4a7a' : '#1f2a33';
      ctx.fillStyle = '#4b4136'; ctx.fillRect(x - 6, y - 6, ww + 12, wh + 12); // 窗套
      ctx.fillStyle = col; ctx.fillRect(x, y, ww, wh);
      ctx.strokeStyle = frame; ctx.lineWidth = 4; ctx.strokeRect(x, y, ww, wh);
      ctx.beginPath(); ctx.moveTo(x + ww / 2, y); ctx.lineTo(x + ww / 2, y + wh); ctx.moveTo(x, y + wh * .4); ctx.lineTo(x + ww, y + wh * .4); ctx.stroke();
      // 窗楣
      ctx.fillStyle = 'rgba(240,232,215,0.9)'; ctx.fillRect(x - 10, y - 14, ww + 20, 8);
    }
  }
  return toTex(c, { repeat: false });
}

// 對街建築（紅磚/石材）
export function cityFacade({ seedN = 9, brick = '#6a4436', cols = 6, floors = 12 } = {}) {
  setSeed(seedN);
  const w = 512, h = 1024; const c = canvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = brick; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) { ctx.fillStyle = `rgba(0,0,0,${rand() * .12})`; ctx.fillRect(rand() * w, rand() * h, 6, 3); }
  const fh = h / floors, cw = w / cols;
  for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
    const lit = rand();
    ctx.fillStyle = lit > .55 ? `rgb(${220 + rand() * 35},${170 + rand() * 50},${100 + rand() * 50})` : lit > .45 ? '#3b5878' : '#141a22';
    ctx.fillRect(k * cw + cw * .2, f * fh + fh * .22, cw * .6, fh * .58);
    ctx.fillStyle = 'rgba(230,220,200,0.6)'; ctx.fillRect(k * cw + cw * .16, f * fh + fh * .8, cw * .68, 4);
  }
  return toTex(c, { repeat: false });
}

// 柏油路
export function asphalt() {
  setSeed(21);
  const c = canvas(512); pixelFill(c, (x, y) => { const n = tnoise(x / 4, y / 4, 128) * .5 + fbm(x / 64, y / 64, 8) * .5; const k = 38 + n * 28; return [k, k, k + 3]; });
  return toTex(c);
}
// 人行道方磚
export function pavers() {
  setSeed(22);
  const c = canvas(512); const ctx = pixelFill(c, (x, y) => { const n = fbm(x / 64, y / 64, 8); const k = 120 + n * 40; return [k + 4, k, k - 6]; });
  ctx.strokeStyle = 'rgba(40,35,30,0.5)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, 512); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(512, i * 128); ctx.stroke(); }
  return toTex(c);
}

// 柔和圓形（陰影/光暈）
export function radial(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)') {
  const c = canvas(128); const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return toTex(c, { repeat: false });
}

// 欄杆柱（瓶形）側影 alpha
export function noiseNormalLike() { return null; }
