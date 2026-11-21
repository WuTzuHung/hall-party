# BLG 海報：上排依淘汰順序重排（HLE → DK → T1 → GEN.G），四格之間與上下排之間加細金線，不加任何文字
# 用法：python3 tools/bake_poster.py <原圖.png> public/assets/blg-poster.jpg
import sys
from PIL import Image, ImageDraw
src = Image.open(sys.argv[1]).convert('RGB')
W, H, TOP = 1136, 1385, 694
assert src.size == (W, H), src.size
cols = [(0, 287), (857, 1136), (572, 857), (287, 572)]  # 原圖順序：HLE、GEN.G、T1、DK
pw = W // 4
out = Image.new('RGB', (W, H))
out.paste(src.crop((0, TOP, W, H)), (0, TOP))
for i, (a, b) in enumerate(cols):
    out.paste(src.crop((a, 0, b, TOP)).resize((pw, TOP), Image.LANCZOS), (i * pw, 0))
d = ImageDraw.Draw(out)
gold, dark = (206, 168, 96), (92, 68, 30)
for i in range(1, 4):
    x = i * pw; d.rectangle([x - 2, 0, x + 1, TOP], fill=gold); d.line([(x + 2, 0), (x + 2, TOP)], fill=dark)
d.rectangle([0, TOP - 2, W, TOP + 3], fill=gold); d.line([(0, TOP + 4), (W, TOP + 4)], fill=dark)
out.save(sys.argv[2], quality=90, optimize=True, progressive=True)
