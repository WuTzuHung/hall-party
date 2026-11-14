#!/usr/bin/env python3
"""把浮雕參考圖烘焙成 3D 場景用的貼圖（albedo / normal / height / glow）。
用法: python3 tools/bake_reliefs.py <relief-A.png> <relief-B.png> [輸出資料夾=public/assets]
只需要 Pillow 與 numpy。"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

def gauss(a, sigma):
    if sigma <= 0: return a
    r = int(sigma * 3 + 0.5); x = np.arange(-r, r + 1); k = np.exp(-x * x / (2 * sigma * sigma)); k /= k.sum()
    for axis in (0, 1):
        p = np.pad(a, [(r, r) if i == axis else (0, 0) for i in range(2)], mode='edge'); out = np.zeros_like(a)
        n = a.shape[axis]
        for i, w in enumerate(k):
            out += w * (p[i:i + n, :] if axis == 0 else p[:, i:i + n])
        a = out
    return a

def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def save_gray(a, path, size=None, q=90):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'L')
    if size: im = im.resize(size, Image.LANCZOS)
    im.save(path, quality=q) if path.endswith('.jpg') else im.save(path, optimize=True)

def bake(src, name, out, stone=(226, 214, 192), tone=0.55, glow_cfg=None, window=None):
    im = Image.open(src).convert('RGB'); W, H = im.size
    rgb = np.asarray(im).astype(np.float32) / 255
    L = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    mx, mn = rgb.max(2), rgb.min(2); sat = (mx - mn) / np.maximum(mx, 1e-3)
    local = gauss(L, 22)
    # ---- 發光遮罩：近白、低彩度、明顯比周圍石材亮 ----
    g = glow_cfg
    strong = sstep(g['l0'], g['l1'], L) * sstep(g['s0'], g['s1'], sat)
    if window is not None: strong *= window(W, H)
    dens = gauss(strong, 9)                    # 去掉孤立的石材高光：只留成串的光帶
    strong *= sstep(g['k0'], g['k1'], dens)
    if g.get('blob'): strong *= sstep(g['blob'] + 0.12, g['blob'], gauss(strong, 4.5))   # 成團的亮斑是石材高光，不是細光帶
    near = sstep(0.02, 0.10, gauss(strong, 3.5))   # 光帶核心附近較亮的邊也算進來
    core = np.maximum(strong, near * sstep(g['l0'] - 0.07, g['l0'], L) * sstep(g['s0'] + 0.05, g['s1'] + 0.03, sat) * sstep(g['d0'], g['d1'], L - local))
    core = np.clip(gauss(core, 0.8) * 1.25, 0, 1)
    halo = np.clip(gauss(core, 5) * 1.6 + gauss(core, 16) * 2.2, 0, 1)
    glow = np.stack([core, halo, np.clip(gauss(core, 2.2) * 1.5, 0, 1)], 2)
    gi = Image.fromarray((glow * 255 + 0.5).astype(np.uint8), 'RGB').resize((1024, round(1024 * H / W)), Image.LANCZOS)
    gi.save(os.path.join(out, name + '-glow.jpg'), quality=88)
    # ---- 高度：把光帶補成石材色，再用多尺度模糊亮度當高度 ----
    small = Image.fromarray((L * 255).astype(np.uint8), 'L').resize((W // 2, H // 2), Image.BILINEAR).filter(ImageFilter.MedianFilter(25))
    Lmed = np.asarray(small.resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    m = np.clip(gauss(core, 6) * 5 + halo * 1.6, 0, 1)
    Lc = L * (1 - m) + np.minimum(Lmed, local + 0.02) * m
    h = 0.50 * gauss(Lc, 12) + 0.32 * gauss(Lc, 4) + 0.18 * gauss(Lc, 1.5)
    lo, hi = np.percentile(h, 1.5), np.percentile(h, 99.5)
    h = np.clip((h - lo) / (hi - lo), 0, 1)
    # 邊緣收平，讓浮雕四周貼回石框
    yy, xx = np.mgrid[0:H, 0:W]; edge = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy)) / (0.035 * W)
    h *= sstep(0, 1, edge) * 0.35 + 0.65
    save_gray(h, os.path.join(out, name + '-height.png'), (512, round(512 * H / W)))
    # ---- 法線：細節尺度的高度梯度（OpenGL 慣例，+Y 朝上） ----
    hn = 0.45 * gauss(Lc, 1.0) + 0.35 * gauss(Lc, 2.5) + 0.20 * gauss(Lc, 7)
    gy, gx = np.gradient(hn); s = 9.0
    n = np.stack([-gx * s, gy * s, np.ones_like(gx)], 2); n /= np.linalg.norm(n, axis=2, keepdims=True)
    ni = Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), 'RGB')
    ni.resize((1024, round(1024 * H / W)), Image.LANCZOS).save(os.path.join(out, name + '-normal.jpg'), quality=90)
    # ---- albedo：色調往大廳石材靠（保留原圖的雕刻明暗） ----
    mean = rgb.reshape(-1, 3).mean(0); target = np.array(stone, np.float32) / 255
    gain = (target / target.mean()) / (mean / mean.mean())
    alb = np.clip(rgb * (1 + (gain - 1) * tone), 0, 1)
    ai = Image.fromarray((alb * 255 + 0.5).astype(np.uint8), 'RGB')
    ai.save(os.path.join(out, name + '.jpg'), quality=88, optimize=True, progressive=True)
    ai.resize((1024, round(1024 * H / W)), Image.LANCZOS).save(os.path.join(out, name + '-1k.jpg'), quality=86, optimize=True, progressive=True)
    print(name, W, H, 'glow coverage %.3f%%' % (100 * (core > 0.3).mean()))

if __name__ == '__main__':
    a, b = sys.argv[1], sys.argv[2]; out = sys.argv[3] if len(sys.argv) > 3 else 'public/assets'
    os.makedirs(out, exist_ok=True)
    bake(a, 'relief-a', out, glow_cfg=dict(l0=0.948, l1=0.985, s0=0.09, s1=0.04, d0=0.06, d1=0.16, k0=0.010, k1=0.024, blob=0.62),
         window=lambda W, H: sstep(0.29, 0.34, np.mgrid[0:H, 0:W][0] / H))
    def win(W, H):  # 浮雕 B：只取中央的太陽與瀑布
        yy, xx = np.mgrid[0:H, 0:W]; u = xx / W; v = yy / H
        return sstep(0.40, 0.45, u) * sstep(0.60, 0.55, u) * sstep(0.38, 0.42, v) * sstep(0.97, 0.9, v)
    bake(b, 'relief-b', out, glow_cfg=dict(l0=0.80, l1=0.95, s0=0.20, s1=0.08, d0=0.02, d1=0.10, k0=0.01, k1=0.05), window=win)
