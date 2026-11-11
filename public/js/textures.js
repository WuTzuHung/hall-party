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
  setSeed(11);
  const c = canvas(size); const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9dcc2'; ctx.fillRect(0, 0, size, size);
  const s = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * s, y = j * s, m = s * 0.12, m2 = s * 0.2;
    // 外框肋
    ctx.fillStyle = '#f3e8d2'; ctx.fillRect(x, y, s, s);
    // 斜面
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    g.addColorStop(0, '#fbf3e1'); g.addColorStop(1, '#bfae8e');
    ctx.fillStyle = g; ctx.fillRect(x + m, y + m, s - 2 * m, s - 2 * m);
    // 凹陷底
    ctx.fillStyle = '#d8c7a5'; ctx.fillRect(x + m2, y + m2, s - 2 * m2, s - 2 * m2);
    // 金色線框
    ctx.strokeStyle = '#b8913f'; ctx.lineWidth = s * 0.018;
    ctx.strokeRect(x + m2, y + m2, s - 2 * m2, s - 2 * m2);
    ctx.strokeStyle = 'rgba(160,120,50,0.6)'; ctx.lineWidth = s * 0.01;
    ctx.strokeRect(x + m * 0.6, y + m * 0.6, s - m * 1.2, s - m * 1.2);
    // 玫瑰花飾
    const cx = x + s / 2, cy = y + s / 2, r = s * 0.13;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      ctx.fillStyle = '#c9a24a';
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * r * .55, cy + Math.sin(a) * r * .55, r * .5, r * .22, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#8c6a26'; ctx.beginPath(); ctx.arc(cx, cy, r * .3, 0, Math.PI * 2); ctx.fill();
    // 蛋與箭飾（外框）
    ctx.fillStyle = 'rgba(150,120,70,0.5)';
    for (let k = 0; k < 10; k++) {
      ctx.beginPath(); ctx.ellipse(x + m * 1.5 + k * (s - m * 3) / 9, y + m * .55, s * .012, s * .022, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  return toTex(c);
}

// ---------- 彩繪玻璃（橢圓天窗，第凡內風格） ----------
export function stainedGlass(size = 768, variant = 0) {
  setSeed(100 + variant);
  const c = canvas(size); const ctx = c.getContext('2d');
  const pal = [
    ['#f2c14e', '#e8a33c', '#ffd98a', '#c97a2a'], // 琥珀
    ['#7fae5a', '#4f8a44', '#a8cf78', '#2f6b3a'], // 綠
    ['#e9e2c8', '#f6efd8', '#d9cfae', '#c7b98f'], // 乳白
    ['#d85f6b', '#b43f55', '#f08f8a', '#8a2a44'], // 玫瑰
    ['#5f86c9', '#3b5ea8', '#8fb0e6', '#24407a'], // 藍
  ];
  const cx = size / 2, cy = size / 2, R = size / 2;
  // 先以多邊形繪製環帶
  const rings = [
    { r0: 0, r1: .12, seg: 1, p: 0 },
    { r0: .12, r1: .3, seg: 12, p: 3, petal: true },
    { r0: .3, r1: .42, seg: 24, p: 0 },
    { r0: .42, r1: .62, seg: 16, p: 1, petal: true },
    { r0: .62, r1: .72, seg: 32, p: 2 },
    { r0: .72, r1: .88, seg: 20, p: 4, petal: true },
    { r0: .88, r1: .96, seg: 48, p: 0 },
    { r0: .96, r1: 1.0, seg: 1, p: 2 },
  ];
  ctx.fillStyle = '#2b2116'; ctx.fillRect(0, 0, size, size);
  for (const ring of rings) {
    for (let k = 0; k < ring.seg; k++) {
      const a0 = k / ring.seg * Math.PI * 2, a1 = (k + 1) / ring.seg * Math.PI * 2;
      // 每個扇形再細分成小塊玻璃
      const sub = Math.max(1, Math.round((ring.r1 - ring.r0) * 14));
      for (let s = 0; s < sub; s++) {
        const rr0 = (ring.r0 + (ring.r1 - ring.r0) * s / sub) * R, rr1 = (ring.r0 + (ring.r1 - ring.r0) * (s + 1) / sub) * R;
        const col = pal[ring.p][Math.floor(rand() * 4)];
        ctx.fillStyle = col;
        ctx.beginPath();
        if (ring.seg === 1) { ctx.arc(cx, cy, rr1, 0, Math.PI * 2); if (rr0 > 0) ctx.arc(cx, cy, rr0, 0, Math.PI * 2, true); }
        else { ctx.arc(cx, cy, rr1, a0, a1); ctx.arc(cx, cy, rr0, a1, a0, true); }
        ctx.closePath(); ctx.fill();
      }
      if (ring.petal) {
        // 花瓣
        const am = (a0 + a1) / 2; const rm = (ring.r0 + ring.r1) / 2 * R;
        const pc = pal[(ring.p + 2 + k % 2) % 5];
        ctx.save(); ctx.translate(cx + Math.cos(am) * rm, cy + Math.sin(am) * rm); ctx.rotate(am);
        ctx.fillStyle = pc[Math.floor(rand() * 4)];
        ctx.beginPath(); ctx.ellipse(0, 0, (ring.r1 - ring.r0) * R * .45, (a1 - a0) * rm * .38, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2b2116'; ctx.lineWidth = size * .004; ctx.stroke();
        ctx.fillStyle = pc[0]; ctx.beginPath(); ctx.ellipse(0, 0, (ring.r1 - ring.r0) * R * .18, (a1 - a0) * rm * .14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // 鉛條
    ctx.strokeStyle = '#2b2116'; ctx.lineWidth = size * .006;
    ctx.beginPath(); ctx.arc(cx, cy, ring.r1 * R, 0, Math.PI * 2); ctx.stroke();
    if (ring.seg > 1) {
      ctx.lineWidth = size * .003;
      for (let k = 0; k < ring.seg; k++) {
        const a = k / ring.seg * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * ring.r0 * R, cy + Math.sin(a) * ring.r0 * R);
        ctx.lineTo(cx + Math.cos(a) * ring.r1 * R, cy + Math.sin(a) * ring.r1 * R); ctx.stroke();
      }
    }
  }
  // 細鉛條紋理（不規則小玻璃）
  ctx.strokeStyle = 'rgba(43,33,22,0.55)'; ctx.lineWidth = size * .0015;
  for (let i = 0; i < 500; i++) {
    const a = rand() * Math.PI * 2, r = rand() * R * .95;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - .5) * size * .05, y + (rand() - .5) * size * .05); ctx.stroke();
  }
  // 中央光暈
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, 'rgba(255,240,200,0.35)'); g.addColorStop(.6, 'rgba(255,230,180,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return toTex(c, { repeat: false });
}

// ---------- 文字橫幅 ----------
export function textTexture(lines, { w = 2048, h = 160, bg = 'rgba(0,0,0,0)', color = '#6b5c46', font = '600 96px "Cinzel", "Times New Roman", serif', letter = 18, shadow = null } = {}) {
  const c = canvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ls = Array.isArray(lines) ? lines : [lines];
  ls.forEach((l, i) => {
    const txt = typeof l === 'string' ? { t: l } : l;
    ctx.font = txt.font || font; ctx.fillStyle = txt.color || color;
    if ('letterSpacing' in ctx) ctx.letterSpacing = (txt.letter ?? letter) + 'px';
    const y = txt.y ?? (h / (ls.length + 1)) * (i + 1);
    if (shadow) { ctx.shadowColor = shadow; ctx.shadowBlur = 12; }
    ctx.fillText(txt.t, w / 2, y);
  });
  return toTex(c, { repeat: false });
}

// 活動海報（黃色）
export function poster(variant = 0) {
  const w = 512, h = 1024; const c = canvas(w, h); const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f7d43b'); g.addColorStop(1, '#e9b81c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 金色抽象圖騰
  setSeed(40 + variant);
  ctx.save(); ctx.translate(w / 2, h * .42);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 190;
    ctx.fillStyle = ['#b8892a', '#1d1d1d', '#d6a22c', '#fff2b0', '#7c4a1a'][Math.floor(rand() * 5)];
    ctx.globalAlpha = .85;
    ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 1.4, 6 + rand() * 18, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#141414';
  ctx.font = '900 120px "Noto Sans TC", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(variant % 2 ? 'GEN' : 'TL', 0, 40);
  ctx.restore();
  ctx.fillStyle = '#141414'; ctx.textAlign = 'center';
  ctx.font = '800 54px "Cinzel", serif'; ctx.fillText('TL × GEN', w / 2, h * .78);
  ctx.font = '700 34px "Noto Sans TC", sans-serif'; ctx.fillText('冠軍賽觀賽派對', w / 2, h * .84);
  ctx.font = '600 22px "Cinzel", serif'; ctx.fillText('HALL DES LUMIÈRES · NEW YORK', w / 2, h * .9);
  ctx.strokeStyle = '#141414'; ctx.lineWidth = 6; ctx.strokeRect(16, 16, w - 32, h - 32);
  return toTex(c, { repeat: false });
}

// 旗幟（深藍）
export function flag() {
  const w = 256, h = 640; const c = canvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b2440'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f2ead8'; ctx.textAlign = 'center';
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI / 2);
  ctx.font = '700 58px "Cinzel", serif'; if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText('HALL DES', 0, -24); ctx.fillText('LUMIÈRES', 0, 50);
  ctx.restore();
  return toTex(c, { repeat: false });
}

// ---------- 窗戶 ----------
// 大窗：深色玻璃 + 綠色窗框 + 內部暖光
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
