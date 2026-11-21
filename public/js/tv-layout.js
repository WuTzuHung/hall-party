// 觀影館「同時視聽」的平面排版：把兩台螢幕排在視窗裡（全螢幕單看、並排、子母畫面）
// 回傳每台螢幕在視窗中的矩形 { x, y, w, h, show }，一律保持 16:9。純函式，方便測試。
export const TV_LAYOUTS = ['hall', 'a', 'b', 'split', 'pip'];
const AR = 16 / 9;

// 在 W×H 內放一個最大的 16:9 矩形並置中
function fit(x, y, W, H) {
  let w = W, h = w / AR;
  if (h > H) { h = H; w = h * AR; }
  return { x: x + (W - w) / 2, y: y + (H - h) / 2, w, h };
}

// opt：{ layout, ratio（並排時「左／上」那台佔的比例 0.25–0.75）, main（'a'|'b'）, corner（0 左上 1 右上 2 左下 3 右下）, pipSize（0.18–0.5）, swap（並排時對調位置）, margin, gap }
export function tvLayout(W, H, opt = {}) {
  const m = opt.margin ?? 0, g = opt.gap ?? 10;
  const L = opt.layout || 'split';
  const hidden = (r) => ({ ...r, show: false });
  const iw = Math.max(1, W - 2 * m), ih = Math.max(1, H - 2 * m);
  if (L === 'a' || L === 'b') {
    const full = { ...fit(m, m, iw, ih), show: true };
    const other = hidden({ x: W - 32, y: H - 18, w: 32, h: 18 }); // 不顯示但保持播放（不能 display:none）
    return L === 'a' ? { a: full, b: other, dir: null } : { a: other, b: full, dir: null };
  }
  if (L === 'pip') {
    const main = opt.main === 'b' ? 'b' : 'a', sub = main === 'a' ? 'b' : 'a';
    const big = fit(m, m, iw, ih);
    const s = Math.min(0.5, Math.max(0.18, opt.pipSize ?? 0.3));
    let w = big.w * s, h = w / AR;
    // 直式手機：主畫面很矮，小畫面改以視窗寬度計算，放在主畫面上下的空白處
    const pad = Math.max(8, Math.min(W, H) * 0.02);
    const c = opt.corner ?? 3, right = c % 2 === 1, bottom = c >= 2;
    const x = right ? W - m - pad - w : m + pad;
    let y = bottom ? big.y + big.h - pad - h : big.y + pad;
    if (ih - big.h > h * 2 + pad) { // 上下有足夠空白就不要蓋住主畫面
      w = Math.min(iw * s * 1.6, iw - 2 * pad); h = w / AR;
      y = bottom ? Math.min(big.y + big.h + pad, H - m - h) : Math.max(big.y - pad - h, m);
      return { [main]: { ...big, show: true }, [sub]: { x: right ? W - m - pad - w : m + pad, y, w, h, show: true, pip: true }, dir: null };
    }
    return { [main]: { ...big, show: true }, [sub]: { x, y, w, h, show: true, pip: true }, dir: null };
  }
  // 並排：橫排或直排，自動選總面積較大的那種；ratio 決定兩台的大小比例
  const r = Math.min(0.75, Math.max(0.25, opt.ratio ?? 0.5));
  const first = opt.swap ? 'b' : 'a', second = first === 'a' ? 'b' : 'a';
  // 橫排
  let w1 = (iw - g) * r, w2 = (iw - g) - w1;
  let k = Math.min(1, ih / (Math.max(w1, w2) / AR));
  w1 *= k; w2 *= k;
  const hRow = { w1, w2, area: (w1 * w1 + w2 * w2) / AR };
  // 直排
  let h1 = (ih - g) * r, h2 = (ih - g) - h1;
  k = Math.min(1, iw / (Math.max(h1, h2) * AR));
  h1 *= k; h2 *= k;
  const vCol = { h1, h2, area: (h1 * h1 + h2 * h2) * AR };
  if (hRow.area >= vCol.area) {
    const tw = w1 + g + w2, x0 = m + (iw - tw) / 2, hh1 = w1 / AR, hh2 = w2 / AR;
    const cy = m + ih / 2;
    return {
      [first]: { x: x0, y: cy - hh1 / 2, w: w1, h: hh1, show: true },
      [second]: { x: x0 + w1 + g, y: cy - hh2 / 2, w: w2, h: hh2, show: true },
      dir: 'row', divider: { x: x0 + w1 + g / 2, y: cy },
    };
  }
  const th = h1 + g + h2, y0 = m + (ih - th) / 2, ww1 = h1 * AR, ww2 = h2 * AR, cx = m + iw / 2;
  return {
    [first]: { x: cx - ww1 / 2, y: y0, w: ww1, h: h1, show: true },
    [second]: { x: cx - ww2 / 2, y: y0 + h1 + g, w: ww2, h: h2, show: true },
    dir: 'col', divider: { x: cx, y: y0 + h1 + g / 2 },
  };
}
