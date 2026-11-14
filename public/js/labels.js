// 頭上的名牌與對話泡泡：用 canvas 畫成 Sprite（有正確的前後遮擋、一個角色只多 1～2 個 draw call）
// 尺寸以「螢幕像素」計算：每幀依距離換算成世界尺寸，近看約 13px 字、遠處略縮小，並限制在一定範圍
import * as THREE from 'three';

const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';
const DPR = Math.min(3, Math.max(2, Math.ceil(globalThis.devicePixelRatio || 1)));
const DOT = { pink: '#ffa9c6', blue: '#92c6ff' };
const TAG_H = 22; // 名牌高度（px）

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR); return c; }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const measurer = document.createElement('canvas').getContext('2d');
function texFrom(canvas) {
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return tex;
}
function setCanvas(sprite, canvas) { sprite.material.map.dispose(); sprite.material.map = texFrom(canvas); sprite.material.needsUpdate = true; }
function spriteFrom(canvas) {
  const tex = texFrom(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const s = new THREE.Sprite(mat); s.renderOrder = 20; return s;
}

// 把文字折行：中日文逐字、英文以單字為單位；超過行數時最後一行加上省略號
function wrap(ctx, text, maxW, maxLines) {
  const tokens = text.match(/[A-Za-z0-9'’\-_.,!?@#%&*+=/:;~]+\s*|\s+|./gu) || [];
  const lines = []; let cur = '';
  const push = () => { lines.push(cur.trimEnd()); cur = ''; };
  for (let tk of tokens) {
    if (ctx.measureText(cur + tk).width <= maxW) { cur += tk; continue; }
    if (cur) push();
    if (lines.length >= maxLines) break;
    tk = tk.trimStart();
    while (ctx.measureText(tk).width > maxW) { // 單一長字：硬切
      let k = 1; while (k < tk.length && ctx.measureText(tk.slice(0, k + 1)).width <= maxW) k++;
      lines.push(tk.slice(0, k)); tk = tk.slice(k);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    cur = tk;
  }
  if (cur && lines.length < maxLines) push();
  const used = lines.join('').replace(/\s/g, '').length, total = text.replace(/\s/g, '').length;
  if (lines.length > maxLines || used < total) {
    lines.length = Math.min(lines.length, maxLines);
    let last = lines[lines.length - 1] || '';
    while (last && ctx.measureText(last + '…').width > maxW) last = Array.from(last).slice(0, -1).join('');
    lines[lines.length - 1] = last.trimEnd() + '…';
  }
  return lines;
}

let fontsReady = null;
function whenFonts(fn) {
  if (!document.fonts || !document.fonts.load) return;
  fontsReady ||= Promise.all([document.fonts.load(`500 13px ${FONT}`), document.fonts.load(`400 13px ${FONT}`)]).catch(() => { });
  fontsReady.then(fn);
}

export class Labels {
  constructor(parent, color) {
    this.color = color;
    this.group = new THREE.Group(); parent.add(this.group);
    this.tag = null; this.name = '';
    this.bubble = null; this.bubbleStart = 0; this.bubbleLife = 0;
  }
  setName(name) {
    this.name = name;
    const draw = () => {
      measurer.font = `500 13px ${FONT}`;
      const tw = Math.ceil(measurer.measureText(name).width);
      const w = tw + 30, h = TAG_H, pad = 6; // 多留陰影空間
      const c = makeCanvas(w + pad * 2, h + pad * 2), ctx = c.getContext('2d'); ctx.scale(DPR, DPR);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
      roundRect(ctx, pad, pad, w, h, h / 2); ctx.fillStyle = 'rgba(16,10,30,0.62)'; ctx.fill(); ctx.restore();
      roundRect(ctx, pad + 0.5, pad + 0.5, w - 1, h - 1, h / 2 - 0.5); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(pad + 11, pad + h / 2, 3, 0, Math.PI * 2); ctx.fillStyle = DOT[this.color] || DOT.pink; ctx.fill();
      ctx.font = `500 13px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 2;
      ctx.fillText(name, pad + 19, pad + h / 2 + 0.5);
      if (!this.tag) { this.tag = spriteFrom(c); this.tag.center.set(0.5, 0); this.group.add(this.tag); }
      else setCanvas(this.tag, c);
      this.tagPx = [w + pad * 2, h + pad * 2]; this.tagPad = pad;
    };
    draw(); whenFonts(draw);
  }
  say(text) {
    const draw = () => {
      const maxW = 200, padX = 10, padY = 7, lh = 17, tailH = 7;
      measurer.font = `400 13px ${FONT}`;
      const lines = wrap(measurer, text, maxW - padX * 2, 4);
      const tw = Math.min(maxW - padX * 2, Math.ceil(Math.max(...lines.map(l => measurer.measureText(l).width))));
      const bw = Math.max(tw + padX * 2, 34), bh = lines.length * lh + padY * 2;
      const pad = 6, below = TAG_H + 1; // 泡泡底部留出名牌的高度
      const W = bw + pad * 2 + 4, H = bh + tailH + below + pad;
      const c = makeCanvas(W, H), ctx = c.getContext('2d'); ctx.scale(DPR, DPR);
      const bx = pad + 4, by = pad, tipY = by + bh + tailH;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#fff';
      roundRect(ctx, bx, by, bw, bh, Math.min(12, bh / 2)); ctx.fill();
      // 尾巴：從泡泡左下往左下方指向頭頂
      ctx.beginPath(); ctx.moveTo(bx + 10, by + bh - 1); ctx.quadraticCurveTo(bx + 9, by + bh + tailH * 0.6, bx + 3, tipY - 0.5);
      ctx.quadraticCurveTo(bx + 14, by + bh + tailH * 0.4, bx + 21, by + bh - 1); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = `400 13px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1e1630';
      lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + lh * (i + 0.5) + 0.5));
      if (!this.bubble) { this.bubble = spriteFrom(c); this.group.add(this.bubble); }
      else setCanvas(this.bubble, c);
      // 讓尾巴尖端落在頭頂正上方、名牌上緣再往右 4px
      this.bubble.center.set((bx + 3 - 4) / W, 0); this.bubblePx = [W, H];
    };
    draw();
    this.bubbleStart = performance.now(); // 用實際時間計算（低幀率裝置上也準時淡出）
    const n = Array.from(text).length;
    this.bubbleLife = Math.min(9, 5 + n * 0.035); // 一般 5～6 秒，長訊息稍久
    this.bubble.visible = true;
  }
  // 每幀：依距離換算尺寸；dist = 相機到頭頂的距離
  update(camera, dt, viewH) {
    if (!this.tag && !this.bubble) return;
    const d = Math.max(0.5, camera.position.distanceTo(this.group.getWorldPosition(_wp)));
    const perPx = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / viewH; // 每 1 螢幕 px 對應的世界尺寸
    const f = THREE.MathUtils.clamp(Math.pow(7 / d, 0.25), 0.8, 1.12);
    const k = perPx * f;
    const fade = THREE.MathUtils.clamp((48 - d) / 14, 0, 1);
    if (this.tag) {
      this.tag.scale.set(this.tagPx[0] * k, this.tagPx[1] * k, 1);
      this.tag.material.opacity = fade; this.tag.visible = fade > 0.01;
      this.tag.position.y = -this.tagPad * k; // 陰影留白不算在名牌高度裡
    }
    if (this.bubble && this.bubble.visible) {
      const t = (performance.now() - this.bubbleStart) / 1000, life = this.bubbleLife;
      if (t > life) { this.bubble.visible = false; return; }
      const a = Math.min(1, t / 0.18) * Math.min(1, (life - t) / 0.6);
      const pop = 0.86 + 0.14 * Math.min(1, t / 0.18);
      this.bubble.scale.set(this.bubblePx[0] * k * pop, this.bubblePx[1] * k * pop, 1);
      this.bubble.material.opacity = a * fade;
    }
  }
  dispose() {
    for (const s of [this.tag, this.bubble]) if (s) { s.material.map.dispose(); s.material.dispose(); }
    this.group.removeFromParent();
  }
}
const _wp = new THREE.Vector3();
