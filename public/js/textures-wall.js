// 城牆區（原創中世紀德式石造風格）的程序化貼圖：粗石、卵石、橡木板、石板瓦、石板地、旗幟紋章、鉛條玻璃
import { fbm, tnoise, canvas, pixelFill, setSeed, rand, toTex } from './textures.js';

const clamp = (v) => Math.max(0, Math.min(255, v));

// ---------- 粗石砌（亂層砌：每排石塊寬度不同、邊緣有倒角的亮面與陰影） ----------
// tileMeters：一張貼圖代表幾公尺見方；rows：一張貼圖幾排石頭
export function rubble({ size = 1024, tileMeters = 6, rows = 9, base = [150, 146, 138], warm = 0, moss = 0, seedN = 41, joint = [58, 54, 50], streaks = 0.10 } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ctx = pixelFill(c, (x, y) => {
    const n = fbm(x / size * 10, y / size * 10, 10, 5), n2 = tnoise(x / size * 90, y / size * 90, 90);
    const k = 0.8 + n * 0.32 + n2 * 0.08;
    return [base[0] * k + warm, base[1] * k + warm * 0.6, base[2] * k];
  });
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    // 這一排的石塊寬度：0.6–1.7 倍排高，最後一塊補到可無縫重複
    const ws = []; let sum = 0;
    while (sum < size - rh * 0.6) { const w = rh * (1.1 + rand() * 1.5); ws.push(w); sum += w; }
    const sc = size / sum; let x = (rand() * 0.5) * rh;
    for (const w0 of ws) {
      const w = w0 * sc, h = rh;
      // 每塊石頭的色差
      const t = rand();
      const tint = t > 0.66 ? `rgba(255,248,232,${0.04 + rand() * 0.08})` : t > 0.33 ? `rgba(60,55,50,${0.05 + rand() * 0.12})` : `rgba(${120 + warm},${110 + warm * 0.5},90,${rand() * 0.08})`;
      for (const ox of [-size, 0, size]) {
        const X = x + ox;
        ctx.fillStyle = tint; ctx.fillRect(X + 3, y0 + 3, w - 6, h - 6);
        // 倒角：上、左亮；下、右暗
        const gT = ctx.createLinearGradient(0, y0, 0, y0 + h);
        gT.addColorStop(0, 'rgba(255,250,240,0.20)'); gT.addColorStop(0.12, 'rgba(255,250,240,0)'); gT.addColorStop(0.84, 'rgba(0,0,0,0)'); gT.addColorStop(1, 'rgba(0,0,0,0.32)');
        ctx.fillStyle = gT; ctx.fillRect(X + 2, y0 + 2, w - 4, h - 4);
        const gL = ctx.createLinearGradient(X, 0, X + w, 0);
        gL.addColorStop(0, 'rgba(255,250,240,0.10)'); gL.addColorStop(0.08, 'rgba(255,250,240,0)'); gL.addColorStop(0.92, 'rgba(0,0,0,0)'); gL.addColorStop(1, 'rgba(0,0,0,0.22)');
        ctx.fillStyle = gL; ctx.fillRect(X + 2, y0 + 2, w - 4, h - 4);
        // 灰縫
        ctx.fillStyle = `rgb(${joint[0]},${joint[1]},${joint[2]})`;
        ctx.fillRect(X - 1.5, y0, 3.5, h);
        // 石頭表面的鑿痕與裂紋
        ctx.strokeStyle = 'rgba(40,36,32,0.25)'; ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) { ctx.beginPath(); let px = X + rand() * w, py = y0 + rand() * h; ctx.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (rand() - 0.5) * rh * 0.5; py += (rand() - 0.5) * rh * 0.4; ctx.lineTo(px, py); } ctx.stroke(); }
      }
      x += w;
    }
    ctx.fillStyle = `rgb(${joint[0]},${joint[1]},${joint[2]})`; ctx.fillRect(0, y0 - 1.5, size, 3.5);
  }
  // 雨水痕、青苔（越下面越多）
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, w = 6 + rand() * 30, g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, 'rgba(30,28,26,0)'); g.addColorStop(0.5 + rand() * 0.3, `rgba(30,28,26,${streaks})`); g.addColorStop(1, `rgba(30,28,26,${streaks * 0.3})`);
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, size);
  }
  if (moss) for (let i = 0; i < 60; i++) {
    const x = rand() * size, y = size * (0.55 + rand() * 0.45), r = 10 + rand() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(70,86,48,${0.18 * moss})`); g.addColorStop(1, 'rgba(70,86,48,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTex(c);
}

// ---------- 石塊路（手鑿的方石，交錯排列、邊角圓滑、表面微凸） ----------
export function cobbles({ size = 1024, n = 16, seedN = 51 } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ctx = pixelFill(c, (x, y) => { const k = 44 + fbm(x / size * 6, y / size * 6, 6) * 26; return [k + 4, k, k - 6]; });
  const rh = size / n;
  for (let j = 0; j < n; j++) {
    // 每一排的石塊寬度不同（0.8–1.5 倍排高），排與排錯開
    const ws = []; let sum = 0;
    while (sum < size - rh * 0.7) { const w = rh * (0.85 + rand() * 0.65); ws.push(w); sum += w; }
    const sc = size / sum; let x = rand() * rh;
    for (const w0 of ws) {
      const w = w0 * sc, v = rand() * 18, t = rand();
      const b = t < 0.2 ? [104 + v, 94 + v, 82 + v] : t < 0.4 ? [88 + v, 92 + v, 96 + v] : [110 + v, 106 + v, 98 + v];
      const g0 = 1.5 + rand() * 1.5, jit = () => (rand() - 0.5) * rh * 0.07;
      const pts = [[g0 + jit(), g0 + jit()], [w - g0 + jit(), g0 + jit()], [w - g0 + jit(), rh - g0 + jit()], [g0 + jit(), rh - g0 + jit()]];
      for (const ox of [-size, 0, size]) {
        const X = x + ox, Y = j * rh;
        if (X > size + rh * 2 || X + w < -rh) continue;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const p = pts[k], q = pts[(k + 1) % 4], r = 0.16;
          const ax = p[0] + (q[0] - p[0]) * r, ay = p[1] + (q[1] - p[1]) * r, bx = p[0] + (q[0] - p[0]) * (1 - r), by = p[1] + (q[1] - p[1]) * (1 - r);
          if (k === 0) ctx.moveTo(X + ax, Y + ay); else ctx.quadraticCurveTo(X + p[0], Y + p[1], X + ax, Y + ay);
          ctx.lineTo(X + bx, Y + by);
        }
        ctx.quadraticCurveTo(X + pts[0][0], Y + pts[0][1], X + pts[0][0] + (pts[1][0] - pts[0][0]) * 0.16, Y + pts[0][1] + (pts[1][1] - pts[0][1]) * 0.16);
        const cx = X + w / 2, cy = Y + rh / 2;
        const gr = ctx.createRadialGradient(cx - w * 0.15, cy - rh * 0.2, rh * 0.05, cx, cy, Math.max(w, rh) * 0.62);
        gr.addColorStop(0, `rgb(${clamp(b[0] + 26)},${clamp(b[1] + 25)},${clamp(b[2] + 22)})`); gr.addColorStop(0.55, `rgb(${b[0] | 0},${b[1] | 0},${b[2] | 0})`); gr.addColorStop(1, `rgb(${b[0] * 0.6 | 0},${b[1] * 0.6 | 0},${b[2] * 0.6 | 0})`);
        ctx.fillStyle = gr; ctx.fill();
        // 表面的斑點與磨痕
        ctx.fillStyle = 'rgba(30,26,22,0.18)';
        for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(X + rand() * w, Y + rand() * rh, 1 + rand() * 2.2, 0, 7); ctx.fill(); }
      }
      x += w;
    }
  }
  return toTex(c);
}

// ---------- 橡木板（紋理沿 u 方向） ----------
export function planks({ size = 512, n = 6, base = [92, 62, 40], seedN = 61, worn = 0.4 } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ph = size / n, shade = Array.from({ length: n }, () => 0.82 + rand() * 0.3);
  const ctx = pixelFill(c, (x, y) => {
    const r = Math.floor(y / ph), k0 = shade[r];
    const g = Math.sin((y * 0.9 + fbm(x / size * 3, y / size * 16 + r * 3, 16, 3) * 40) * 0.55) * 0.5 + 0.5;
    const k = k0 * (0.78 + g * 0.16 + tnoise(x / size * 200, y / size * 12, 200) * 0.1);
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  for (let r = 0; r < n; r++) {
    ctx.fillStyle = 'rgba(20,12,6,0.8)'; ctx.fillRect(0, r * ph, size, 2);
    ctx.fillStyle = `rgba(255,220,170,${0.05 * worn})`; ctx.fillRect(0, r * ph + 2, size, 2);
    // 板與板的接頭、鐵釘
    const jx = rand() * size; ctx.fillStyle = 'rgba(20,12,6,0.7)'; ctx.fillRect(jx, r * ph, 2, ph);
    ctx.fillStyle = 'rgba(30,26,24,0.9)';
    for (const dx of [-6, 6]) { ctx.beginPath(); ctx.arc(jx + dx, r * ph + ph * 0.3, 2.2, 0, 7); ctx.arc(jx + dx, r * ph + ph * 0.7, 2.2, 0, 7); ctx.fill(); }
    // 節眼
    if (rand() < 0.7) { const kx = rand() * size, ky = r * ph + ph * (0.3 + rand() * 0.4); const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, ph * 0.22); g.addColorStop(0, 'rgba(30,16,8,0.7)'); g.addColorStop(1, 'rgba(30,16,8,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(kx, ky, ph * 0.4, ph * 0.18, 0, 0, 7); ctx.fill(); }
  }
  return toTex(c);
}

// ---------- 石板瓦（屋頂；v 方向為屋面上下） ----------
export function slate({ size = 512, cols = 8, rows = 10, base = [62, 66, 76], seedN = 71 } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ctx = pixelFill(c, (x, y) => { const k = 0.85 + fbm(x / size * 8, y / size * 8, 8) * 0.25; return [base[0] * k, base[1] * k, base[2] * k]; });
  const w = size / cols, h = size / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * w / 2;
    for (let i = -1; i <= cols; i++) {
      const x = i * w + off, y = r * h, t = 0.75 + rand() * 0.45;
      ctx.fillStyle = `rgba(${base[0] * t | 0},${base[1] * t | 0},${base[2] * t | 0},0.9)`;
      // 下緣圓角的魚鱗瓦
      ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + w - 1, y); ctx.lineTo(x + w - 1, y + h * 0.7);
      ctx.quadraticCurveTo(x + w - 1, y + h, x + w / 2, y + h); ctx.quadraticCurveTo(x + 1, y + h, x + 1, y + h * 0.7); ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.25, 'rgba(0,0,0,0)'); g.addColorStop(0.92, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g; ctx.fill();
    }
  }
  return toTex(c);
}

// ---------- 石板地（大塊不規則矩形） ----------
export function flagstones({ size = 1024, tileMeters = 4, seedN = 81, base = [132, 124, 112] } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ctx = pixelFill(c, (x, y) => { const k = 0.82 + fbm(x / size * 8, y / size * 8, 8, 5) * 0.3 + tnoise(x / size * 120, y / size * 120, 120) * 0.06; return [base[0] * k, base[1] * k, base[2] * k]; });
  const rows = 5, rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = rand() * rh * 0.5; const ws = []; let sum = 0;
    while (sum < size - rh * 0.5) { const w = rh * (0.8 + rand() * 0.9); ws.push(w); sum += w; }
    const sc = size / sum;
    for (const w0 of ws) {
      const w = w0 * sc, t = rand();
      for (const ox of [-size, 0, size]) {
        ctx.fillStyle = t > 0.5 ? `rgba(255,245,225,${rand() * 0.08})` : `rgba(40,34,28,${rand() * 0.14})`; ctx.fillRect(x + ox + 2, r * rh + 2, w - 4, rh - 4);
        ctx.fillStyle = 'rgba(38,32,26,0.85)'; ctx.fillRect(x + ox - 1.5, r * rh, 3, rh);
      }
      x += w;
    }
    ctx.fillStyle = 'rgba(38,32,26,0.85)'; ctx.fillRect(0, r * rh - 1.5, size, 3);
  }
  // 磨損：走道中央較亮
  for (let i = 0; i < 30; i++) { const x = rand() * size, y = rand() * size, r = 30 + rand() * 90; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(30,24,18,0.10)'); g.addColorStop(1, 'rgba(30,24,18,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  return toTex(c);
}

// ---------- 原創紋章：城門塔＋兩把交叉長劍＋盾形，底下一條緞帶 ----------
// 不使用任何作品的官方標誌
export function drawCrest(g, cx, cy, s, ink = '#e8dcbc', dark = '#1d3326') {
  g.save(); g.translate(cx, cy); g.scale(s, s);
  g.lineJoin = 'round'; g.lineCap = 'round';
  // 交叉長劍（在盾牌後面）
  const sword = (rot) => {
    g.save(); g.rotate(rot);
    g.fillStyle = ink;
    g.beginPath(); g.moveTo(-0.035, -1.05); g.lineTo(0, -1.18); g.lineTo(0.035, -1.05); g.lineTo(0.035, 0.62); g.lineTo(-0.035, 0.62); g.closePath(); g.fill(); // 劍身
    g.fillRect(-0.22, 0.62, 0.44, 0.06); // 護手
    g.fillRect(-0.03, 0.68, 0.06, 0.24); // 握柄
    g.beginPath(); g.arc(0, 0.97, 0.06, 0, 7); g.fill(); // 柄頭
    g.restore();
  };
  sword(-0.62); sword(0.62);
  // 盾牌
  const shield = () => { g.beginPath(); g.moveTo(-0.55, -0.62); g.lineTo(0.55, -0.62); g.lineTo(0.55, 0.05); g.quadraticCurveTo(0.52, 0.55, 0, 0.82); g.quadraticCurveTo(-0.52, 0.55, -0.55, 0.05); g.closePath(); };
  shield(); g.fillStyle = dark; g.fill(); g.lineWidth = 0.07; g.strokeStyle = ink; g.stroke();
  g.save(); shield(); g.clip();
  // 盾內：城牆與城門塔
  g.fillStyle = ink;
  g.fillRect(-0.6, 0.12, 1.2, 0.7); // 城牆
  for (let i = -5; i <= 5; i += 2) g.fillRect(i * 0.1 - 0.04, 0.04, 0.08, 0.1); // 雉堞
  g.fillRect(-0.18, -0.42, 0.36, 0.6); // 塔身
  for (const x of [-0.18, -0.05, 0.08]) g.fillRect(x, -0.52, 0.1, 0.12); // 塔頂雉堞
  g.fillStyle = dark;
  g.beginPath(); g.moveTo(-0.1, 0.82); g.lineTo(-0.1, 0.42); g.arc(0, 0.42, 0.1, Math.PI, 0); g.lineTo(0.1, 0.82); g.closePath(); g.fill(); // 城門
  g.fillRect(-0.035, -0.3, 0.07, 0.14); // 塔窗
  g.restore();
  // 緞帶
  g.fillStyle = ink; g.beginPath(); g.moveTo(-0.85, 1.0); g.quadraticCurveTo(0, 1.16, 0.85, 1.0); g.lineTo(0.78, 1.14); g.lineTo(0.88, 1.24); g.quadraticCurveTo(0, 1.34, -0.88, 1.24); g.lineTo(-0.78, 1.14); g.closePath(); g.fill();
  g.restore();
}

// 長旗（燕尾、流蘇、布料陰影）；回傳帶透明度的貼圖
export function banner({ w = 256, h = 768, field = '#1f3b2c', ink = '#e8dcbc', trim = '#b8954a', seedN = 91 } = {}) {
  setSeed(seedN);
  const c = canvas(w, h), g = c.getContext('2d');
  const tail = h * 0.1;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(w / 2, h - tail); g.lineTo(0, h); g.closePath(); g.clip();
  g.fillStyle = field; g.fillRect(0, 0, w, h);
  // 布紋
  const id = g.getImageData(0, 0, w, h), d = id.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, k = 0.9 + ((x + y) % 3 === 0 ? 0.04 : 0) + tnoise(x / 6, y / 6, 64) * 0.08; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
  g.putImageData(id, 0, 0);
  // 金邊
  g.strokeStyle = trim; g.lineWidth = w * 0.035; g.strokeRect(w * 0.06, w * 0.06, w * 0.88, h);
  g.lineWidth = w * 0.012; g.strokeRect(w * 0.1, w * 0.1, w * 0.8, h);
  // 上方橫桿套的陰影
  const gt = g.createLinearGradient(0, 0, 0, w * 0.18); gt.addColorStop(0, 'rgba(0,0,0,0.55)'); gt.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gt; g.fillRect(0, 0, w, w * 0.18);
  drawCrest(g, w / 2, h * 0.4, w * 0.36, ink, field);
  // 下方兩道橫紋
  g.fillStyle = trim; g.fillRect(w * 0.1, h * 0.72, w * 0.8, w * 0.025); g.fillRect(w * 0.1, h * 0.75, w * 0.8, w * 0.01);
  // 布料垂墜的縱向明暗
  for (let i = 0; i < 4; i++) { const x = (i + 0.5) * w / 4 + (rand() - 0.5) * 20, gg = g.createLinearGradient(x - w / 8, 0, x + w / 8, 0); gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.5, 'rgba(0,0,0,0.18)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gg; g.fillRect(x - w / 8, 0, w / 4, h); }
  const t = toTex(c, { repeat: false }); return t;
}

// ---------- 鉛條玻璃（菱形格）：夜裡從外面看透出暖光，從室內看是深藍夜色 ----------
export function leaded({ w = 256, h = 512, lit = true } = {}) {
  setSeed(lit ? 101 : 102);
  const c = canvas(w, h), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  if (lit) { grd.addColorStop(0, '#ffcf7a'); grd.addColorStop(1, '#e88a38'); } else { grd.addColorStop(0, '#2a3a66'); grd.addColorStop(1, '#141d38'); }
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const s = w / 5;
  for (let y = -s; y < h + s; y += s) for (let x = 0; x < w + s; x += s) {
    const k = rand(); g.fillStyle = lit ? `rgba(255,240,200,${k * 0.25})` : `rgba(120,150,220,${k * 0.18})`;
    g.beginPath(); g.moveTo(x, y - s / 2); g.lineTo(x + s / 2, y); g.lineTo(x, y + s / 2); g.lineTo(x - s / 2, y); g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(18,14,10,0.95)'; g.lineWidth = 3;
  for (let k = -h; k < w + h; k += s) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k, 0); g.lineTo(k - h, h); g.stroke(); }
  return toTex(c, { repeat: false });
}

// ---------- 半木構造民居的灰泥牆面（帶歲月污漬） ----------
export function limePlaster({ size = 512, base = [222, 214, 196], seedN = 111 } = {}) {
  setSeed(seedN);
  const c = canvas(size);
  const ctx = pixelFill(c, (x, y) => { const k = 0.86 + fbm(x / size * 6, y / size * 6, 6, 5) * 0.2 + tnoise(x / size * 150, y / size * 150, 150) * 0.05; return [base[0] * k, base[1] * k, base[2] * k]; });
  for (let i = 0; i < 24; i++) { const x = rand() * size, y = rand() * size, r = 20 + rand() * 70; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(110,96,70,0.10)'); g.addColorStop(1, 'rgba(110,96,70,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  return toTex(c);
}

// 火焰（加法混合用的柔光火舌）
export function flame() {
  const c = canvas(64, 128), g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 92, 2, 32, 80, 60);
  grd.addColorStop(0, 'rgba(255,250,220,1)'); grd.addColorStop(0.25, 'rgba(255,196,90,0.9)'); grd.addColorStop(0.6, 'rgba(255,110,30,0.35)'); grd.addColorStop(1, 'rgba(255,60,10,0)');
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(52, 50, 60, 84, 32, 124); g.bezierCurveTo(4, 84, 12, 50, 32, 4); g.fill();
  return toTex(c, { repeat: false });
}
