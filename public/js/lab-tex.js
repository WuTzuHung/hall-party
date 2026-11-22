// 研究所大樓（秋葉原老樓）的程序化貼圖：馬賽克磁磚、水泥、壁紙、招牌、白板、映像管畫面、販賣機、輝光管……
// 全部用 canvas 畫，沒有外部圖檔；招牌與門牌只是用一般字體打字，不描原作的標誌
import * as THREE from 'three';

export const JP = '"Noto Sans TC","Noto Sans JP","Hiragino Sans","Yu Gothic","Microsoft JhengHei",sans-serif';
let seed = 7;
export const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
export const reseed = (n) => { seed = n; };
export function cv(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); return c; }
export function tex(c, rep = false, aniso = 4) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// 有字的貼圖：網頁字型載入後重畫一次（Noto Sans TC 依字元分批下載，要帶 text 參數才會載到假名）
export function textTex(w, h, draw, sample = 'ア研究所', rep = false) {
  const c = cv(w, h, draw), t = tex(c, rep);
  if (document.fonts && document.fonts.load) {
    Promise.all(['400', '700', '900'].map((wt) => document.fonts.load(`${wt} 40px "Noto Sans TC"`, sample))).then(() => {
      const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true;
    }).catch(() => { });
  }
  return t;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function grain(g, w, h, n, a, dark = true) {
  for (let i = 0; i < n; i++) { g.fillStyle = dark ? `rgba(0,0,0,${rnd() * a})` : `rgba(255,255,255,${rnd() * a})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
}
// 雨水垂流的髒污（垂直方向可連續拼接）
function streaks(g, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, ww = 2 + rnd() * 14, gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, `rgba(40,34,28,${a * rnd()})`); gr.addColorStop(0.5, `rgba(40,34,28,${a * rnd()})`); gr.addColorStop(1, `rgba(40,34,28,${a * rnd()})`);
    g.fillStyle = gr; g.fillRect(x, 0, ww, h);
  }
}

// 外牆小口馬賽克磁磚（一張 = 1 公尺見方，45mm 磚＋縫）
export function mosaic({ base = [196, 184, 160], joint = [128, 122, 112], seedN = 11, dirt = 0.18 } = {}) {
  reseed(seedN);
  return tex(cv(512, 512, (g, w, h) => {
    g.fillStyle = rgb(...joint); g.fillRect(0, 0, w, h);
    const n = 21, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const k = (rnd() - 0.5) * 22, warm = (rnd() - 0.5) * 8;
      g.fillStyle = rgb(base[0] + k + warm, base[1] + k, base[2] + k - warm);
      g.fillRect(x * s + 1.6, y * s + 1.6, s - 3.2, s - 3.2);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x * s + 1.6, y * s + 1.6, s - 3.2, 2);
    }
    streaks(g, w, h, 26, dirt); grain(g, w, h, 1800, 0.12);
  }), true);
}
export function concrete({ base = [150, 148, 142], seedN = 21, dirt = 0.25, size = 512 } = {}) {
  reseed(seedN);
  return tex(cv(size, size, (g, w, h) => {
    g.fillStyle = rgb(...base); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) { const r = 10 + rnd() * 60, x = rnd() * w, y = rnd() * h, d = (rnd() - 0.5) * 30; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgb(base[0] + d, base[1] + d, base[2] + d, 0.35)); gr.addColorStop(1, rgb(base[0], base[1], base[2], 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    streaks(g, w, h, 18, dirt); grain(g, w, h, 5000, 0.14); grain(g, w, h, 1500, 0.08, false);
  }), true);
}
// 研究所的壁紙：米黃底、淡淡直條紋、泛黃的水漬
export function wallpaper() {
  reseed(31);
  return tex(cv(512, 512, (g, w, h) => {
    g.fillStyle = '#ddd2b6'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = x % 32 ? 'rgba(255,250,235,0.18)' : 'rgba(150,130,96,0.10)'; g.fillRect(x, 0, 6, h); }
    for (let i = 0; i < 4; i++) { const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(170,140,80,0.07)'); gr.addColorStop(0.85, 'rgba(150,118,60,0.05)'); gr.addColorStop(1, 'rgba(150,118,60,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    grain(g, w, h, 3000, 0.06);
  }), true);
}
// 天花板：白色石膏板，0.455m 一格的接縫（一張 = 0.91m）
export function ceiling() {
  reseed(41);
  return tex(cv(256, 256, (g, w, h) => {
    g.fillStyle = '#e4e1d6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,110,90,${rnd() * 0.25})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    g.fillStyle = 'rgba(90,84,70,0.35)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(0, h / 2, w, 1); g.fillRect(w / 2, 0, 1, h);
  }), true);
}
// 一樓店面：被磨亮的水泥地，有拖痕
export function shopFloor() { return concrete({ base: [112, 110, 104], seedN: 22, dirt: 0.05 }); }
export function linoleum() {
  reseed(51);
  return tex(cv(512, 512, (g, w, h) => {
    // 木紋地板：一張 = 1.6m，淺褐色、窄條
    const n = 8, s = h / n;
    for (let i = 0; i < n; i++) {
      const k = (rnd() - 0.5) * 26; g.fillStyle = rgb(146 + k, 104 + k * 0.8, 66 + k * 0.6); g.fillRect(0, i * s, w, s);
      for (let j = 0; j < 40; j++) { g.strokeStyle = `rgba(70,44,24,${rnd() * 0.18})`; g.lineWidth = 1; g.beginPath(); const y = i * s + rnd() * s; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 6, w * 0.6, y + (rnd() - 0.5) * 6, w, y); g.stroke(); }
      g.fillStyle = 'rgba(40,24,12,0.55)'; g.fillRect(0, i * s, w, 1.5);
      const cut = rnd() * w; g.fillRect(cut, i * s, 1.5, s);
    }
    // 磨損：常走的地方比較亮
    for (let i = 0; i < 30; i++) { const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 80; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(230,200,160,0.08)'); gr.addColorStop(1, 'rgba(230,200,160,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    grain(g, w, h, 2000, 0.1);
  }), true);
}

// 一樓招牌：店名用一般粗黑體打字（不是原作標誌）
export function shopSign() {
  return textTex(2048, 300, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f4efdd'); gr.addColorStop(1, '#ddd5bc'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d3b78'; g.fillRect(0, 0, w, 16); g.fillRect(0, h - 16, w, 16);
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#13285a';
    g.font = `900 176px ${JP}`; if ('letterSpacing' in g) g.letterSpacing = '22px';
    g.fillText('ブラウン管工房', w / 2 + 40, h / 2 + 8);
    if ('letterSpacing' in g) g.letterSpacing = '4px';
    // 左側：映像管小圖示
    g.save(); g.translate(170, h / 2 + 4); g.fillStyle = '#c4322b'; g.beginPath(); g.roundRect(-92, -70, 184, 140, 26); g.fill();
    g.fillStyle = '#f4efdd'; g.beginPath(); g.roundRect(-70, -50, 140, 100, 30); g.fill(); g.restore();
    g.fillStyle = '#c4322b'; g.font = `700 44px ${JP}`; g.textAlign = 'right'; g.fillText('TV・修理・買取', w - 60, h - 52);
    // 日曬、灰塵
    reseed(61); streaks(g, w, h, 40, 0.06); grain(g, w, h, 6000, 0.08);
  }, 'ブラウン管工房TV・修理・買取');
}
// 小招牌／門牌（白底黑字或手寫紙）
export function plate(lines, { w = 512, h = 160, bg = '#e9e4d6', ink = '#222', size = 64, weight = 700, border = '#8a8270', paper = false, rot = 0 } = {}) {
  return textTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12); }
    if (paper) { reseed(71); grain(g, w, h, 900, 0.08); g.fillStyle = 'rgba(200,190,150,0.35)'; g.fillRect(w * 0.42, -4, 70, 26); g.fillRect(w * 0.42, h - 22, 70, 26); }
    g.save(); g.translate(w / 2, h / 2); g.rotate(rot);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    const ls = Array.isArray(lines) ? lines : [lines];
    ls.forEach((l, i) => { const s = (l.s || 1) * size; g.font = `${l.w || weight} ${s}px ${JP}`; g.fillText(l.t ?? l, 0, (i - (ls.length - 1) / 2) * size * 1.15); });
    g.restore();
  }, (Array.isArray(lines) ? lines.map((l) => l.t ?? l).join('') : lines));
}
// 直立招牌：一個字一個字往下排
export function vSign(text, { bg = '#b8262b', ink = '#fff', w = 160, h = 720, sub = '', edge = '#f2d36b' } = {}) {
  return textTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = edge; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    const ch = [...text], s = Math.min(w * 0.62, (h - 60 - (sub ? 70 : 0)) / ch.length * 0.9);
    g.font = `900 ${s}px ${JP}`;
    ch.forEach((c, i) => g.fillText(c, w / 2, 40 + s * 0.55 + i * s * 1.08));
    if (sub) { g.font = `700 ${w * 0.18}px ${JP}`; g.fillText(sub, w / 2, h - 44); }
  }, text + sub);
}

// 二樓窗戶：從外面看，拉下一半的百葉窗，後面是日光燈的光
export function blindsLit() {
  return tex(cv(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f2f4e8'); gr.addColorStop(1, '#c9cbb8'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h * 0.62; y += 9) { g.fillStyle = 'rgba(205,200,180,1)'; g.fillRect(0, y, w, 6.5); g.fillStyle = 'rgba(120,115,96,0.55)'; g.fillRect(0, y + 6.5, w, 1); }
    g.fillStyle = 'rgba(90,80,60,0.6)'; g.fillRect(w * 0.3, 0, 2, h * 0.62); g.fillRect(w * 0.7, 0, 2, h * 0.62);
    // 下半露出室內：白板、架子的剪影
    g.fillStyle = 'rgba(60,54,40,0.55)'; g.fillRect(w * 0.08, h * 0.7, w * 0.25, h * 0.3); g.fillRect(w * 0.62, h * 0.66, w * 0.3, h * 0.34);
    g.fillStyle = 'rgba(240,240,230,0.7)'; g.fillRect(w * 0.1, h * 0.72, w * 0.21, h * 0.12);
  }));
}
export function windowDark(lit = 0) {
  reseed(81 + lit);
  return tex(cv(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1a2230'); gr.addColorStop(1, '#0c1018'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(160,180,220,0.10)'; g.beginPath(); g.moveTo(w * 0.1, 0); g.lineTo(w * 0.35, 0); g.lineTo(w * 0.05, h); g.lineTo(0, h); g.fill();
    if (lit) { g.fillStyle = 'rgba(255,214,150,0.35)'; g.fillRect(w * 0.15, h * 0.2, w * 0.7, h * 0.7); for (let x = 0; x < w; x += 22) { g.fillStyle = 'rgba(80,60,40,0.4)'; g.fillRect(x, 0, 9, h); } }
  }));
}

// ----- 映像管畫面（共用給一樓整排電視） -----
export function crtScreens() {
  const mk = (draw) => { const c = cv(256, 192, draw); return { c, t: tex(c) }; };
  // 1. 雜訊（每幀重畫）
  const noise = mk((g, w, h) => { g.fillStyle = '#777'; g.fillRect(0, 0, w, h); });
  const ng = noise.c.getContext('2d'), img = ng.createImageData(256, 192);
  // 2. 彩色條
  const bars = mk((g, w, h) => {
    const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * w / 7, 0, w / 7 + 1, h * 0.68); });
    ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * w / 7, h * 0.68, w / 7 + 1, h * 0.08); });
    g.fillStyle = '#00214c'; g.fillRect(0, h * 0.76, w * 0.18, h); g.fillStyle = '#fff'; g.fillRect(w * 0.18, h * 0.76, w * 0.18, h); g.fillStyle = '#32006a'; g.fillRect(w * 0.36, h * 0.76, w * 0.18, h); g.fillStyle = '#131313'; g.fillRect(w * 0.54, h * 0.76, w, h);
  });
  // 3. 藍畫面（錄影機待機）
  const blue = textTexLike((g, w, h) => {
    g.fillStyle = '#1834c8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8ecff'; g.font = `700 22px ${JP}`; g.textBaseline = 'top'; g.fillText('ビデオ 1', 16, 14); g.fillText('▶ 再生', 16, 44);
    g.font = '700 20px monospace'; g.fillText('0:00:00', w - 104, h - 34);
  });
  // 4. 節目畫面（原創：夕陽與城市剪影）
  const show = mk((g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a3a7a'); gr.addColorStop(0.55, '#e07a4a'); gr.addColorStop(1, '#3a1a2a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd090'; g.beginPath(); g.arc(w * 0.66, h * 0.56, 24, 0, Math.PI * 2); g.fill();
    reseed(91); g.fillStyle = '#1a1020';
    for (let x = 0; x < w; x += 14 + rnd() * 10) { const bh = 30 + rnd() * 70; g.fillRect(x, h - bh, 12 + rnd() * 10, bh); }
  });
  const list = [noise, bars, blue, show];
  let last = 0, roll = 0;
  return {
    list: list.map((x) => x.t),
    // 雜訊、捲動的掃描線
    update(t) {
      if (t - last < 0.07) return; last = t;
      const d = img.data;
      roll = (roll + 7) % 192;
      for (let y = 0; y < 192; y++) {
        const band = Math.abs(y - roll) < 10 ? 50 : 0;
        for (let x = 0; x < 256; x++) { const v = (Math.random() * 200 + band) | 0, i = (y * 256 + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      }
      ng.putImageData(img, 0, 0); noise.t.needsUpdate = true;
    },
  };
  function textTexLike(draw) { const t = textTex(256, 192, draw, 'ビデオ再生'); return { t }; }
}

// 研究所白板：手寫的世界線分歧圖、算式與待辦（原創內容）
export function whiteboard() {
  return textTex(1024, 640, (g, w, h) => {
    g.fillStyle = '#f7f8f4'; g.fillRect(0, 0, w, h);
    // 擦不乾淨的舊痕跡
    reseed(101);
    for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(120,130,150,${0.05 + rnd() * 0.06})`; g.lineWidth = 10 + rnd() * 26; g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + 80 + rnd() * 160, y + (rnd() - 0.5) * 30); g.stroke(); }
    const pen = (c, lw = 4) => { g.strokeStyle = c; g.fillStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; };
    const wob = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + (rnd() - 0.5) * 2, y + (rnd() - 0.5) * 2) : g.moveTo(x, y))); g.stroke(); };
    const txt = (s, x, y, size, c, rot = 0, wt = 500) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = c; g.font = `${wt} ${size}px ${JP}`; g.fillText(s, 0, 0); g.restore(); };
    // 世界線：一條主線分出兩條
    pen('#1b2c8a', 5);
    wob([[60, 330], [300, 330]]); wob([[300, 330], [520, 230], [940, 200]]); wob([[300, 330], [520, 420], [940, 450]]);
    for (const [x, y] of [[300, 330], [520, 230], [520, 420]]) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
    txt('α', 950, 210, 44, '#1b2c8a', 0, 700); txt('β', 950, 462, 44, '#1b2c8a', 0, 700);
    txt('分歧點', 236, 380, 30, '#1b2c8a', -0.03);
    txt('0.337187', 560, 200, 34, '#c0262b', -0.02, 700); txt('1.130205', 560, 470, 34, '#c0262b', 0.01, 700);
    // 標題
    txt('タイムリープ 理論メモ', 60, 80, 52, '#111', -0.02, 700);
    pen('#111', 4); wob([[56, 96], [600, 90]]);
    // 算式
    txt('Δt = 2^n × 36h ?', 640, 70, 34, '#111', 0.02);
    txt('E = mc²  →  圧縮 → 36byte', 620, 120, 28, '#1d6a3a', 0.01);
    txt('① 電話 → レンジ  ② 43 秒  ③ 焦げたバナナ…', 60, 160, 28, '#111', -0.01);
    // 待辦（右下）
    txt('TODO', 700, 540, 30, '#c0262b', 0, 700);
    txt('・ジュース補充', 700, 580, 26, '#111'); txt('・ブラウン氏に家賃', 700, 614, 26, '#111');
    // 塗鴉小人（原創，沒有五官）
    pen('#1d6a3a', 4); g.beginPath(); g.arc(120, 520, 34, 0, Math.PI * 2); g.stroke(); wob([[120, 554], [120, 610]]); wob([[90, 580], [150, 580]]);
    txt('!?', 170, 500, 40, '#1d6a3a', 0.2, 700);
    // 磁鐵
    for (const [x, y, c] of [[40, 30, '#d43a2a'], [980, 40, '#2a6ad4'], [960, 600, '#e0b020']]) { g.fillStyle = c; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); }
  }, 'タイムリープ理論メモ分歧点電話レンジ秒焦げたバナナジュース補充ブラウン氏に家賃圧縮');
}
// 電腦螢幕：程式碼／討論版（原創介面）
export function codeScreen(kind = 0) {
  reseed(111 + kind);
  return textTex(512, 320, (g, w, h) => {
    if (kind === 0) {
      g.fillStyle = '#0b1210'; g.fillRect(0, 0, w, h);
      g.font = '15px monospace';
      for (let y = 22, i = 0; y < h; y += 18, i++) { const ind = (rnd() * 4 | 0) * 16; g.fillStyle = ['#7fe08a', '#d8e8d0', '#6ab0ff', '#e0c070'][i % 4]; g.fillText(['int jump(char *d) {', '  sync(SPLIT);', '  if (lift > 0.42) {', '    send(msg, 36);', '  }', '  return 0x5F;', '}', '// TODO: 43s', 'while (!done) tick();'][i % 9], 12 + ind, y); }
    } else {
      g.fillStyle = '#efefe6'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a1c1c'; g.fillRect(0, 0, w, 30);
      g.fillStyle = '#fff'; g.font = `700 16px ${JP}`; g.fillText('＠ちゃんねる  オカルト板', 12, 21);
      g.font = `14px ${JP}`;
      for (let y = 54, i = 1; y < h; y += 24, i++) { g.fillStyle = '#2a7a2a'; g.fillText(`${i} ：名無しさん`, 12, y); g.fillStyle = '#222'; g.fillText(['未来から来たって本当？', 'kwsk', 'うpしろ', '電話レンジって何', 'ソースは？', '>>3 釣りだろ', 'ジョン・タイターの再来か', '42型のブラウン管ほしい', 'ｗｗｗ'][i % 9], 170, y); }
    }
  }, '＠ちゃんねるオカルト板名無しさん未来から来たって本当うpしろ電話レンジって何ソースは釣りだろジョン・タイターの再来か型のブラウン管ほしいｗ');
}
// 輝光管計數器的數字
export function nixie(text = '1.048596') {
  return tex(cv(512, 96, (g, w, h) => {
    g.fillStyle = '#0a0604'; g.fillRect(0, 0, w, h);
    const n = text.length, cw = w / n;
    g.font = '300 76px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...text].forEach((c, i) => {
      const x = cw * (i + 0.5);
      // 管內沒點亮的其他數字（暗暗的網格）
      g.strokeStyle = 'rgba(120,70,40,0.35)'; g.lineWidth = 1; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x - cw * 0.34, 12 + k * 18); g.lineTo(x + cw * 0.34, 12 + k * 18); g.stroke(); }
      g.shadowColor = '#ff7a1a'; g.shadowBlur = 16; g.fillStyle = '#ffb050'; g.fillText(c, x, h / 2 + 4); g.shadowBlur = 6; g.fillStyle = '#ffe2b0'; g.fillText(c, x, h / 2 + 4); g.shadowBlur = 0;
    });
  }));
}
// 自動販賣機正面（原創：飲料一排一排，沒有品牌）
export function vending(variant = 0) {
  reseed(121 + variant);
  return textTex(256, 512, (g, w, h) => {
    g.fillStyle = variant ? '#c8282c' : '#e8e8ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9f4ff'; g.fillRect(14, 20, w - 28, 280);
    const cols = ['#b02a2a', '#2a5ab0', '#f0c020', '#3a9a4a', '#e07020', '#6a3a1a', '#f0f0f0', '#2aa0c0'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const x = 24 + c * 36, y = 34 + r * 68, col = cols[(r * 6 + c * 5) % cols.length];
      g.fillStyle = col; g.beginPath(); g.roundRect(x, y, 26, 44, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(x + 4, y + 6, 5, 30);
      g.fillStyle = '#222'; g.fillRect(x - 2, y + 50, 30, 10); g.fillStyle = '#ff4030'; g.font = '700 9px monospace'; g.fillText(r % 2 ? '160' : '130', x + 3, y + 58);
    }
    g.fillStyle = variant ? '#7a1414' : '#9a9aa6'; g.fillRect(14, 310, w - 28, 70);
    g.fillStyle = '#fff'; g.font = `900 30px ${JP}`; g.textAlign = 'center'; g.fillText(variant ? 'つめた～い' : 'あったか～い', w / 2, 356);
    g.fillStyle = '#222'; g.fillRect(40, 400, w - 80, 70); g.fillStyle = '#444'; g.fillRect(48, 410, w - 96, 50);
    g.fillStyle = '#ffd040'; g.fillRect(w - 50, 300, 20, 6);
  }, 'つめた～いあったか～い');
}
// 書背（漫畫、雜誌、技術書）
export function bookSpines(seedN = 131) {
  reseed(seedN);
  return tex(cv(512, 256, (g, w, h) => {
    g.fillStyle = '#2a2018'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 2; row++) {
      let x = 0; const y0 = row * h / 2, bh = h / 2;
      while (x < w) {
        const bw = 8 + rnd() * 18, hh = bh * (0.72 + rnd() * 0.26);
        const hue = rnd() * 360, s = 30 + rnd() * 50, l = 25 + rnd() * 45;
        g.fillStyle = `hsl(${hue},${s}%,${l}%)`; g.fillRect(x, y0 + bh - hh, bw - 1, hh);
        g.fillStyle = `hsla(${hue},${s}%,${l + 25}%,0.8)`; g.fillRect(x + 2, y0 + bh - hh + 8, bw - 5, 5); g.fillRect(x + 2, y0 + bh - 18, bw - 5, 4);
        x += bw;
      }
    }
  }));
}
// 原創海報
export function posterTex(kind = 0) {
  reseed(141 + kind);
  return textTex(256, 360, (g, w, h) => {
    if (kind === 0) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0e1838'); gr.addColorStop(1, '#5a1c4a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(255,255,255,${rnd()})`; g.fillRect(rnd() * w, rnd() * h * 0.7, 1.5, 1.5); }
      g.strokeStyle = '#f0c070'; g.lineWidth = 3; for (let r = 30; r < 110; r += 22) { g.beginPath(); g.arc(w / 2, h * 0.45, r, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#ffe2a0'; g.font = `900 34px ${JP}`; g.textAlign = 'center'; g.fillText('時空の果て', w / 2, h - 60); g.font = `700 16px ${JP}`; g.fillText('劇場版 近日公開', w / 2, h - 30);
    } else if (kind === 1) {
      g.fillStyle = '#e8d8a8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#28324a'; g.beginPath(); g.moveTo(w * 0.5, 40); g.lineTo(w * 0.78, 150); g.lineTo(w * 0.7, 300); g.lineTo(w * 0.3, 300); g.lineTo(w * 0.22, 150); g.closePath(); g.fill();
      g.fillStyle = '#d83a2a'; g.fillRect(w * 0.42, 110, w * 0.16, 30); g.fillStyle = '#f0c020'; g.beginPath(); g.arc(w * 0.5, 210, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#28324a'; g.font = `900 40px ${JP}`; g.textAlign = 'center'; g.fillText('鋼鉄巨兵', w / 2, h - 22);
    } else {
      g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#222'; g.font = `700 22px ${JP}`; g.textAlign = 'center'; g.fillText('2010', w / 2, 36);
      g.font = `700 16px ${JP}`;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) { const d = r * 7 + c - 1; g.fillStyle = c === 0 ? '#c22' : c === 6 ? '#22a' : '#333'; if (d > 0 && d < 32) g.fillText(String(d), 24 + c * 34, 90 + r * 50); }
      g.fillStyle = '#c22'; g.beginPath(); g.arc(24 + 34 * 4, 90 + 50 * 4 - 6, 16, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = '#c22'; g.stroke();
    }
  }, '時空の果て劇場版近日公開鋼鉄巨兵');
}
// 鄰棟的外牆：小窗戶格子（有些亮）
export function slimFacade({ seedN = 151, base = '#8d8576', cols = 3, floors = 5, w = 256, h = 512, lit = 0.35 } = {}) {
  reseed(seedN);
  return tex(cv(w, h, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h); grain(g, w, h, 3000, 0.12); streaks(g, w, h, 20, 0.2);
    const fh = h / floors, cw = w / cols;
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.16, y = f * fh + fh * 0.22, ww = cw * 0.68, hh = fh * 0.5;
      g.fillStyle = '#2a2a2a'; g.fillRect(x - 3, y - 3, ww + 6, hh + 6);
      const on = rnd() < lit; const gr = g.createLinearGradient(x, y, x, y + hh);
      if (on) { gr.addColorStop(0, '#fff2cc'); gr.addColorStop(1, '#e8b870'); } else { gr.addColorStop(0, '#2a3446'); gr.addColorStop(1, '#141a24'); }
      g.fillStyle = gr; g.fillRect(x, y, ww, hh);
      if (on && rnd() < 0.6) { g.fillStyle = 'rgba(120,90,60,0.5)'; for (let k = 0; k < hh; k += 6) g.fillRect(x, y + k, ww, 3); }
      g.fillStyle = '#555'; g.fillRect(x - 4, y + hh + 3, ww + 8, 4);
    }
  }));
}

// 從研究所裡看出去的夜景：對面大樓的窗、招牌的光暈（亮著，不受室內燈影響）
export function nightView() {
  reseed(171);
  return tex(cv(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0d1226'); gr.addColorStop(1, '#1c1a2c'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { const x = rnd() * w, y = h * (0.3 + rnd() * 0.6), r = 40 + rnd() * 80; const c = ['255,80,90', '255,200,90', '90,170,255', '200,90,255'][i]; const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(${c},0.35)`); rg.addColorStop(1, `rgba(${c},0)`); g.fillStyle = rg; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    let x = 0;
    while (x < w) {
      const bw = 70 + rnd() * 90, top = h * (0.05 + rnd() * 0.3);
      g.fillStyle = `rgb(${24 + rnd() * 16},${22 + rnd() * 14},${30 + rnd() * 16})`; g.fillRect(x, top, bw - 4, h);
      for (let yy = top + 10; yy < h - 8; yy += 18) for (let xx = x + 6; xx < x + bw - 14; xx += 16) if (rnd() < 0.42) { g.fillStyle = rnd() < 0.7 ? 'rgba(255,226,170,0.85)' : 'rgba(190,220,255,0.8)'; g.fillRect(xx, yy, 9, 10); }
      x += bw;
    }
  }));
}
// 洞洞板：掛著工具的剪影
export function pegboard() {
  reseed(181);
  return tex(cv(512, 256, (g, w, h) => {
    g.fillStyle = '#b89a70'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(60,40,20,0.55)'; for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
    const tools = [['#c62828', 0.12], ['#2a5ab0', 0.22], ['#333', 0.3], ['#e0b020', 0.42], ['#777', 0.52], ['#2a7a3a', 0.62], ['#333', 0.72], ['#c62828', 0.84]];
    for (const [c, fx] of tools) {
      const x = fx * w, y = 30 + rnd() * 30, l = 80 + rnd() * 90;
      g.fillStyle = '#9a9aa0'; g.fillRect(x - 3, y, 6, l * 0.55);
      g.fillStyle = c; g.beginPath(); g.roundRect(x - 9, y + l * 0.5, 18, l * 0.5, 6); g.fill();
    }
    g.strokeStyle = '#222'; g.lineWidth = 6; g.beginPath(); g.arc(w * 0.92, 90, 30, 0, Math.PI * 2); g.stroke(); // 一捆電線
    g.strokeStyle = '#c62828'; g.beginPath(); g.arc(w * 0.92, 90, 22, 0, Math.PI * 2); g.stroke();
  }));
}
