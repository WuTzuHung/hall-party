// BLG 海報（大螢幕正上方）：上排依淘汰順序 HLE → DK → T1 → GEN.G，下排 BLG Knight
// 關燈特效：Knight 雙眼亮起紅光 → 雙道雷射依序掃過四人（被掃過的變黑白、變暗）→ 掃完後眼睛恢復正常，聚光落在 Knight 身上
// 開燈後四人慢慢恢復彩色。圖片由 tools/bake_poster.py 產生。
import * as THREE from 'three';

const PX = new THREE.Vector2(1136, 1385); // 圖片像素尺寸（shader 內以像素計算，上方為 0）
const TOP = 694, PW = 284;                 // 上排高度、每格寬度
const EYES = [[488, 908], [578, 900]];     // Knight 雙眼（瞳孔）
const START = 1.6, STEP = 2.6;             // 第一位開始時間、每位間隔（秒）
const SCAN_DELAY = 0.35, SCAN = 1.4;       // 雷射到位後開始往下掃、掃完一位的時間

const vert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const frag = `
uniform sampler2D map; uniform vec2 uPx; uniform float uTime, uDark, uGone, uEye, uBeam, uFlash, uFocus;
uniform float uScan[4]; uniform vec2 uTarget; uniform vec2 uEyeA; uniform vec2 uEyeB;
varying vec2 vUv;
float segD(vec2 p, vec2 a, vec2 b){ vec2 v = b - a; float t = clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0); return length(p - (a + t * v)); }
float hash(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  vec3 c = texture2D(map, vUv).rgb;
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uPx;
  const vec3 RED = vec3(1.0, 0.06, 0.03);
  vec3 add = vec3(0.0);
  if (p.y < ${TOP}.0) {
    int i = int(clamp(floor(p.x / ${PW}.0), 0.0, 3.0));
    float s = uScan[i];
    float sy = mix(-20.0, ${TOP}.0 + 20.0, s);
    float passed = smoothstep(sy + 5.0, sy - 5.0, p.y) * uGone;
    float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(g * 0.30 + 0.004, g * 0.27, g * 0.27), passed);
    // 掃描線（正在掃的那一位）
    float scanning = step(0.001, s) * step(s, 0.999) * uGone;
    float dy = p.y - sy;
    add += RED * scanning * (exp(-dy * dy / 18.0) * 2.2 + exp(-dy * dy / 900.0) * 0.45 + step(dy, 0.0) * exp(dy / 60.0) * 0.12);
    // 被擊倒的瞬間整格閃一下紅光
    add += RED * uFlash * step(abs(float(i) - uTarget.x / ${PW}.0 + 0.5), 0.5) * 0.25;
  }
  // 整體隨燈光變暗（雷射與眼睛不受影響）
  c *= mix(0.9, 0.5, uDark);
  // 結尾：焦點回到 Knight，上排再壓暗、Knight 打上一盞柔和的聚光
  if (uFocus > 0.001) {
    vec2 q = (p - vec2(540.0, 1010.0)) / vec2(330.0, 400.0);
    float spot = exp(-dot(q, q) * 1.1);
    c *= mix(1.0, p.y < ${TOP}.0 ? 0.55 : mix(0.75, 2.0, spot), uFocus);
  }
  // 雷射（加粗）：雙眼各一道，白熱核心 + 紅色內光 + 大範圍外光，帶一點閃爍
  if (uBeam > 0.001) {
    float fl = 0.88 + 0.12 * sin(uTime * 53.0) * sin(uTime * 31.0);
    float d1 = segD(p, uEyeA, uTarget), d2 = segD(p, uEyeB, uTarget);
    float d = min(d1, d2);
    float beam = exp(-d * d / 160.0) * 2.6 + exp(-d * d / 1400.0) * 1.0 + exp(-d * d / 12000.0) * 0.35;
    float core = exp(-d * d / 28.0);
    float r = length(p - uTarget);
    float hit = exp(-r * r / 1800.0) * 2.8 + exp(-r * r / 20000.0) * 0.7;
    add += (RED * (beam + hit) + vec3(1.0, 0.75, 0.6) * (core * 1.4 + exp(-r * r / 400.0) * 1.4)) * uBeam * fl;
  }
  // 雙眼：白熱的紅色光點 + 兩層光暈
  if (uEye > 0.001) {
    for (int k = 0; k < 2; k++) {
      vec2 e = k == 0 ? uEyeA : uEyeB; vec2 q = p - e;
      float r2 = dot(q, q);
      float glow = exp(-r2 / 220.0) * 3.2 + exp(-r2 / 2600.0) * 1.0 + exp(-r2 / 22000.0) * 0.3;
      add += (RED * glow + vec3(1.0, 0.8, 0.7) * exp(-r2 / 40.0) * 1.6) * uEye;
    }
  }
  gl_FragColor = vec4(c + add, 1.0);
  #include <colorspace_fragment>
}`;

export function buildPoster(height) {
  const width = height * PX.x / PX.y;
  const map = new THREE.TextureLoader().load('/assets/blg-poster.jpg');
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const u = {
    map: { value: map }, uPx: { value: PX }, uTime: { value: 0 }, uDark: { value: 0 }, uGone: { value: 0 }, uEye: { value: 0 }, uBeam: { value: 0 }, uFlash: { value: 0 }, uFocus: { value: 0 },
    uScan: { value: [0, 0, 0, 0] }, uTarget: { value: new THREE.Vector2(PW / 2, 40) },
    uEyeA: { value: new THREE.Vector2(...EYES[0]) }, uEyeB: { value: new THREE.Vector2(...EYES[1]) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);

  let dark = false, t0 = 0, focusHeld = 0;
  const st = { halo: 0 }; // 畫框周圍紅光的強度（給 world.js 的光暈用）
  // e：1 = 開燈、0 = 關燈（已緩動）；t：秒
  const update = (t, e) => {
    u.uTime.value = t; u.uDark.value = 1 - e;
    if (!dark && e < 0.5) { dark = true; t0 = t; for (let i = 0; i < 4; i++) { u.uScan.value[i] = 0; } }
    else if (dark && e > 0.5) dark = false;
    const fade = dark ? 1 : 1 - e; // 開燈時特效整體淡出、四人恢復彩色
    u.uGone.value = fade;
    if (fade <= 0) { u.uEye.value = u.uBeam.value = u.uFlash.value = u.uFocus.value = st.halo = 0; return; }
    const r = t - t0, ss = THREE.MathUtils.smoothstep;
    const end = START + 4 * STEP;
    let beam = 0, flash = 0;
    if (dark) {
      for (let i = 0; i < 4; i++) {
        const a = START + i * STEP;
        u.uScan.value[i] = THREE.MathUtils.clamp((r - a - SCAN_DELAY) / SCAN, 0, 1);
        if (r >= a - 0.1 && r < a + STEP - 0.15) {
          beam = ss(r, a - 0.1, a + 0.2) * (1 - ss(r, a + SCAN_DELAY + SCAN + 0.15, a + SCAN_DELAY + SCAN + 0.5));
          const sy = THREE.MathUtils.lerp(-20, TOP + 20, u.uScan.value[i]);
          u.uTarget.value.set(i * PW + PW / 2 + Math.sin(r * 9.0) * 34, THREE.MathUtils.clamp(sy, 40, TOP - 30));
          const hitT = r - (a + SCAN_DELAY + SCAN);
          if (hitT > 0) flash = Math.exp(-hitT * 5);
        }
      }
    }
    // 眼睛：先亮起，雷射發射時更亮；四人掃完後紅光退去、眼睛恢復正常，聚光慢慢落到 Knight 身上
    const on = dark ? ss(r, 0.2, 1.3) * (1 - ss(r, end - 0.6, end + 0.6)) : 0;
    if (dark) focusHeld = ss(r, end - 0.3, end + 1.5);
    const focus = focusHeld;
    u.uEye.value = on * (0.75 + 0.35 * beam);
    u.uBeam.value = beam * fade;
    u.uFlash.value = flash * fade;
    u.uFocus.value = focus * fade;
    st.halo = on * (0.35 + 0.4 * beam + 0.5 * flash);
  };
  return { mesh, width, height, update, state: st };
}
