// 由圖片烘焙成的淺浮雕石板：albedo + 法線 + 位移（真的有凹凸）+ 發光遮罩（能量光帶／太陽、瀑布的高光）
// 貼圖由 tools/bake_reliefs.py 產生，放在 /assets/relief-*.jpg|png
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
function tex(url, srgb, aniso) {
  const t = loader.load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}
// opts: name（檔名前綴）, w/h（公尺）, depth（最大凸出）, high（畫質）, flow: 'radial' 從 origin 往外流動 | 'fall' 往下流動
//       origin [u,v]、glowColor、tint（整體石色微調）
export function reliefPanel({ name, w, h, depth = 0.12, high = true, flow = 'radial', origin = [0.5, 0.5], glowColor = 0xffe2a8, tint = 0xffffff, normalScale = 1.0, segs = 112 }) {
  const sx = high ? segs : Math.round(segs / 2), sy = Math.max(8, Math.round(sx * h / w));
  const geo = new THREE.PlaneGeometry(w, h, sx, sy);
  const aniso = high ? 8 : 2;
  const uniforms = {
    uGlowMap: { value: tex(`/assets/${name}-glow.jpg`, false, 2) }, uTime: { value: 0 }, uGlow: { value: 1 }, uHalo: { value: 0.5 },
    uGlowColor: { value: new THREE.Color(glowColor) }, uOrigin: { value: new THREE.Vector2(origin[0], origin[1]) }, uAspect: { value: w / h }, uFall: { value: flow === 'fall' ? 1 : 0 },
  };
  const mat = new THREE.MeshStandardMaterial({
    map: tex(`/assets/${name}${high ? '' : '-1k'}.jpg`, true, aniso), color: tint,
    normalMap: tex(`/assets/${name}-normal.jpg`, false, aniso), normalScale: new THREE.Vector2(normalScale, normalScale),
    displacementMap: tex(`/assets/${name}-height.png`, false, 1), displacementScale: depth, displacementBias: 0,
    roughness: 0.86, metalness: 0,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGlowMap; uniform float uTime, uGlow, uHalo, uAspect, uFall; uniform vec3 uGlowColor; uniform vec2 uOrigin;
        float rh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float rn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rh(i),rh(i+vec2(1,0)),f.x), mix(rh(i+vec2(0,1)),rh(i+vec2(1,1)),f.x), f.y); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 gm = texture2D(uGlowMap, vMapUv).rgb;   // r：光帶核心，g：大範圍光暈，b：近光暈
          vec2 q = (vMapUv - uOrigin) * vec2(uAspect, 1.0);
          float n = rn(vMapUv*vec2(uAspect,1.0)*9.0 + uTime*0.07);
          // 沿著光帶往外（或往下）流動的脈衝：兩組不同速度的波疊加，再加一點閃爍
          float ph = mix(length(q)*15.0, -vMapUv.y*26.0, uFall) + n*3.2;
          float p1 = pow(0.5 + 0.5*sin(ph - uTime*2.1), 4.0);
          float p2 = pow(0.5 + 0.5*sin(ph*0.43 - uTime*0.9 + 1.7), 2.0);
          float fl = 0.85 + 0.15*sin(uTime*7.0 + n*20.0);
          float core = gm.r * (0.5 + 1.5*p1 + 0.55*p2) * fl;
          float halo = (gm.b*0.55 + gm.g*uHalo) * (0.55 + 0.45*p2 + 0.5*p1);
          totalEmissiveRadiance += uGlowColor * (core*1.5 + halo) * uGlow + vec3(1.0,0.97,0.9) * gm.r * p1 * 0.8 * uGlow;
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  // level：發光強度（關燈時較強），halo：大範圍光暈的量
  const update = (t, level, halo = 0.5) => { uniforms.uTime.value = t; uniforms.uGlow.value = level; uniforms.uHalo.value = halo; };
  return { mesh, mat, update, tris: sx * sy * 2 };
}
