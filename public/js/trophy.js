// 冠軍獎盃（依參考照片程序化建模）：拋光銀杯、層疊盾形杯身、淡金鑲嵌、深藍寶石、
// 分層收束的杯柱、四面圓徽的底座、帶深色銘牌的階梯台座。高約 1.06m，約 6k 三角形、4 個 draw call + 1 個閃光
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const xf = (g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) => { _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); return g.applyMatrix4(_m); };
// 切成平面著色（鏡面金屬上每個切面各自反光，像照片裡的多面切割）
const facet = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };

// 專用的攝影棚環境貼圖：深色背景 + 幾條亮的柔光條，鏡面銀才會有照片裡「黑底白高光」的質感
function studioEnv(renderer) {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x5c5d66);
  const strip = (w, h, c, k, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
  strip(14, 14, 0xffffff, 3.0, 0, 9, 0);            // 頂光
  strip(5, 12, 0xfff2e0, 3.2, 8, 2, 3); strip(5, 12, 0xe6ecff, 3.2, -8, 2, 3);
  strip(4, 10, 0xffffff, 2.6, 5, 1, -8); strip(4, 10, 0xfff0e0, 2.6, -5, 1, -8);
  strip(10, 5, 0xffeedd, 2.6, 0, 3.5, 9); strip(9, 1.2, 0x20202a, 1, 0, -1.5, 9);
  strip(14, 14, 0x3a3632, 1, 0, -9, 0);           // 地面（暖灰，杯底才不會全黑）
  for (let k = 0; k < 14; k++) { const a = k * 2.399, y = -2 + (k % 5) * 2.2; strip(0.5, 0.5, 0xffffff, 9, Math.cos(a) * 9, y, Math.sin(a) * 9); } // 小亮點
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(s, 0.012); pm.dispose();
  s.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}

export function buildTrophy(renderer) {
  const parts = { silver: [], gold: [], gem: [], plaque: [] };
  const add = (g, key, t) => {
    let n = g.index ? g.toNonIndexed() : g; if (t) xf(n, t);
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    parts[key].push(n); return n;
  };
  // 八角截面（方形切角）一圈的頂點
  const oct = (y, hw, ch) => [[hw - ch, hw], [hw, hw - ch], [hw, -hw + ch], [hw - ch, -hw], [-hw + ch, -hw], [-hw, -hw + ch], [-hw, hw - ch], [-hw + ch, hw]].map(([x, z]) => new THREE.Vector3(x, y, z));
  // 把一圈圈截面連成實體（平面著色）；上下加蓋
  const loft = (rings, capTop = true, capBottom = false) => {
    const pos = []; const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let r = 0; r < rings.length - 1; r++) { const A = rings[r], Bq = rings[r + 1], n = A.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(A[i], Bq[i], Bq[j]); tri(A[i], Bq[j], A[j]); } }
    const cap = (R, up) => { const c = R.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / R.length); for (let i = 0; i < R.length; i++) { const j = (i + 1) % R.length; up ? tri(c, R[j], R[i]) : tri(c, R[i], R[j]); } };
    if (capTop) cap(rings[rings.length - 1], true); if (capBottom) cap(rings[0], false);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  };
  // 多邊形薄板（帶倒角），pts 為右半邊的點（x>=0，由下往上），自動鏡射；背面在 z=0，往 +z 凸出
  const plate = (half, depth, bevel = 0.004, mirror = true) => {
    const pts = mirror ? [...half, ...half.slice().reverse().filter(([x]) => x > 1e-6).map(([x, y]) => [-x, y])] : half;
    const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, steps: 1, curveSegments: 1 });
    return facet(g);
  };
  // 月牙（金色鑲嵌）：外弧半徑 r、內弧往圓心偏 off
  const crescent = (r, off, a0, a1, n = 6) => { const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n, k = Math.sin(Math.PI * i / n); pts.push([Math.cos(a) * (r - off * k), Math.sin(a) * (r - off * k)]); } return pts; };
  const drop = (l, w) => [[0, 0], [w, l * 0.45], [w * 0.7, l * 0.8], [0, l], [-w * 0.7, l * 0.8], [-w, l * 0.45]];
  // 把「立在原點、面向 +z」的零件擺到杯身外圍：繞 y 軸轉 ang、離軸心 rad、高度 y、上緣外傾 tilt
  const around = (g, ang, rad, y, tilt = 0, key = 'silver') => { xf(g, { rx: tilt }); xf(g, { z: rad, y }); xf(g, { ry: ang }); return add(g, key); };

  // ---------- 台座（y 0 ~ 0.232）----------
  const CH = 0.04;
  add(loft([oct(0, 0.228, CH), oct(0.026, 0.228, CH), oct(0.034, 0.214, CH), oct(0.2, 0.18, CH * 0.85), oct(0.208, 0.19, CH * 0.85), oct(0.232, 0.19, CH * 0.85)], true, true), 'silver');
  // 四角的扶壁
  for (let k = 0; k < 4; k++) add(facet(new THREE.BoxGeometry(0.05, 0.19, 0.03)), 'silver', { ry: Math.PI / 4 + k * Math.PI / 2, x: Math.sin(Math.PI / 4 + k * Math.PI / 2) * 0.262, z: Math.cos(Math.PI / 4 + k * Math.PI / 2) * 0.262, y: 0.105, rx: -0.2 });
  // 銘牌（四面各一塊，深色亮面，細刻線看不清內容）
  const tilt = Math.atan2(0.214 - 0.18, 0.2 - 0.034);
  for (let k = 0; k < 4; k++) {
    const g = new THREE.PlaneGeometry(0.25, 0.118); xf(g, { rx: -tilt }); xf(g, { z: 0.197 + 0.011, y: 0.117 }); xf(g, { ry: k * Math.PI / 2 }); add(g, 'plaque'); // 與底板保持 4mm 以上，遠看不閃爍
    const fr = plate([[0, -0.066], [0.132, -0.066], [0.132, 0.066], [0, 0.066]], 0.008, 0.001); xf(fr, { rx: -tilt }); xf(fr, { z: 0.195, y: 0.117 }); xf(fr, { ry: k * Math.PI / 2 }); add(fr, 'silver');
  }
  // ---------- 凸緣（y 0.232 ~ 0.272）----------
  add(loft([oct(0.232, 0.196, 0.036), oct(0.24, 0.205, 0.038), oct(0.26, 0.205, 0.038), oct(0.272, 0.192, 0.034)], true), 'silver');
  // ---------- 圓徽底座（y 0.272 ~ 0.43）----------
  add(loft([oct(0.272, 0.168, 0.034), oct(0.395, 0.152, 0.03), oct(0.405, 0.158, 0.03), oct(0.414, 0.15, 0.03), oct(0.44, 0.112, 0.03)], true), 'silver');
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, fz = 0.158, fy = 0.336, tl = -Math.atan2(0.168 - 0.152, 0.123);
    around(new THREE.TorusGeometry(0.056, 0.0125, 5, 18), a, fz, fy, tl);
    around(new THREE.TorusGeometry(0.037, 0.009, 5, 16), a, fz + 0.004, fy, tl, 'gold');
    around(xf(new THREE.SphereGeometry(0.03, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), { rx: Math.PI / 2, sz: 0.5 }), a, fz, fy, tl);
    around(facet(xf(new THREE.BoxGeometry(0.02, 0.02, 0.008), { rz: Math.PI / 4 })), a, fz + 0.016, fy, tl);
    // 圓徽下方的三道爪
    for (const dx of [-0.022, 0, 0.022]) around(facet(xf(new THREE.BoxGeometry(0.012, 0.03, 0.012), { x: dx, y: -0.062 })), a, fz + 0.004, fy, tl);
    // 轉角立柱
    const ca = a + Math.PI / 4; add(facet(new THREE.BoxGeometry(0.044, 0.13, 0.03)), 'silver', { ry: ca, x: Math.sin(ca) * 0.2, z: Math.cos(ca) * 0.2, y: 0.338, rx: -0.12 });
  }
  // ---------- 杯柱：下段三層八角收束，上段細腰 ----------
  const lathe = (pts, seg, flat, rot = 0) => { let g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); if (flat) g = facet(g); return xf(g, { ry: rot }); };
  add(lathe([[0.128, 0.428], [0.128, 0.45], [0.108, 0.462], [0.114, 0.466], [0.114, 0.486], [0.094, 0.498], [0.1, 0.502], [0.1, 0.52], [0.08, 0.532], [0.072, 0.545]], 8, true, Math.PI / 8), 'silver');
  add(lathe([[0.074, 0.542], [0.062, 0.565], [0.068, 0.578], [0.066, 0.596], [0.048, 0.612], [0.041, 0.632], [0.045, 0.648], [0.062, 0.658], [0.082, 0.662], [0.086, 0.676], [0.078, 0.69], [0.07, 0.698], [0.056, 0.716], [0.05, 0.735]], 14, false), 'silver');
  // 杯柱上的六角藍寶石（四顆，在對角方向）與金色水滴
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    around(facet(xf(new THREE.CylinderGeometry(0.026, 0.03, 0.012, 6), { rx: Math.PI / 2 })), a, 0.1, 0.512, -0.25);
    around(facet(xf(new THREE.CylinderGeometry(0.01, 0.021, 0.012, 6), { rx: Math.PI / 2 })), a, 0.111, 0.515, -0.25, 'gem');
    around(plate(drop(0.036, 0.011), 0.006, 0.002, false), k * Math.PI / 2, 0.064, 0.566, -0.1, 'gold');
  }
  // 杯托下的金色鉤飾
  for (let k = 0; k < 8; k++) around(xf(new THREE.TorusGeometry(0.014, 0.0045, 4, 8, Math.PI), { rz: -Math.PI / 2, ry: Math.PI / 2 }), k * Math.PI / 4 + Math.PI / 8, 0.082, 0.672, 0, 'gold');

  // ---------- 杯身（y 0.715 ~ 1.06）----------
  // 內杯
  const cup = new THREE.LatheGeometry([[0.05, 0.725], [0.1, 0.775], [0.135, 0.85], [0.15, 0.94], [0.156, 1.0], [0.148, 1.0], [0.128, 0.86], [0.09, 0.79], [0.0, 0.77]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  add(cup, 'silver');
  const CY = 0.885, TL = 0.2;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, R0 = 0.136;
    // 後層：帶兩支尖角的大盾板
    around(plate([[0, -0.172], [0.05, -0.128], [0.096, -0.06], [0.112, 0.03], [0.118, 0.11], [0.128, 0.178], [0.096, 0.14], [0.07, 0.128], [0.052, 0.146], [0, 0.152]], 0.012), a, R0, CY, TL);
    // 中層：盾面
    around(plate([[0, -0.15], [0.04, -0.112], [0.078, -0.05], [0.09, 0.02], [0.092, 0.092], [0.06, 0.1], [0.044, 0.118], [0, 0.118]], 0.022), a, R0, CY, TL);
    // 前層：下方的 V 形小盾
    around(plate([[0, -0.142], [0.03, -0.11], [0.05, -0.066], [0.03, -0.05], [0, -0.075]], 0.031, 0.005), a, R0, CY, TL);
    // 頂端圓形寶石座 + 圓凸面藍寶石
    around(xf(new THREE.TorusGeometry(0.03, 0.009, 5, 14), { y: 0.132 }), a, R0 + 0.024, CY, TL);
    around(xf(new THREE.SphereGeometry(0.027, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), { rx: Math.PI / 2, sz: 0.62, y: 0.132 }), a, R0 + 0.022, CY, TL, 'gem');
    // 寶石座兩側的金色月牙
    for (const s of [-1, 1]) {
      const cr = plate(crescent(0.058, 0.024, s > 0 ? -0.5 : Math.PI + 0.5, s > 0 ? 1.05 : Math.PI - 1.05), 0.006, 0.002, false);
      around(xf(cr, { y: 0.058, x: s * 0.004 }), a, R0 + 0.022, CY, TL, 'gold');
      // 交叉的臂（從頂端寶石斜向中央六角寶石）
      around(facet(xf(new THREE.BoxGeometry(0.016, 0.085, 0.012), { rz: s * 0.62, x: s * 0.03, y: 0.05 })), a, R0 + 0.03, CY, TL);
      // 六角寶石兩側的金色水滴
      around(xf(plate(drop(0.05, 0.016), 0.006, 0.002, false), { rz: s * 2.5, x: s * 0.04, y: -0.012 }), a, R0 + 0.022, CY, TL, 'gold');
    }
    // 中央六角寶石座 + 六角切面藍寶石
    around(facet(xf(new THREE.CylinderGeometry(0.034, 0.038, 0.014, 6), { rx: Math.PI / 2, y: 0.005 })), a, R0 + 0.03, CY, TL);
    around(facet(xf(new THREE.CylinderGeometry(0.012, 0.028, 0.014, 6), { rx: Math.PI / 2, y: 0.005 })), a, R0 + 0.043, CY, TL, 'gem');
    // 對角方向的側板：圓環寶石座、圓寶石、菱形寶石
    const d = a + Math.PI / 4, R1 = 0.168;
    around(plate([[0, -0.135], [0.036, -0.09], [0.056, -0.02], [0.06, 0.06], [0.074, 0.135], [0.046, 0.1], [0, 0.108]], 0.014), d, R1, CY - 0.012, TL * 1.1);
    around(xf(new THREE.TorusGeometry(0.034, 0.01, 5, 14), { y: 0.04 }), d, R1 + 0.016, CY - 0.012, TL * 1.1);
    around(xf(new THREE.SphereGeometry(0.023, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), { rx: Math.PI / 2, sz: 0.6, y: 0.04 }), d, R1 + 0.014, CY - 0.012, TL * 1.1, 'gem');
    around(facet(xf(new THREE.CylinderGeometry(0.006, 0.024, 0.014, 4), { rx: Math.PI / 2, y: -0.052, sy: 1.25 })), d, R1 + 0.02, CY - 0.012, TL * 1.1, 'gem');
    around(xf(plate(drop(0.04, 0.012), 0.005, 0.002, false), { y: -0.012, x: 0 }), d, R1 + 0.013, CY - 0.012, TL * 1.1, 'gold');
  }

  const env = studioEnv(renderer);
  const mats = {
    silver: new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 1, roughness: 0.07, envMap: env }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf0cc86, metalness: 1, roughness: 0.16, envMap: env }),
    gem: new THREE.MeshStandardMaterial({ color: 0x0c2fc4, metalness: 0.35, roughness: 0.03, envMap: env, emissive: 0x0b36e0, emissiveIntensity: 0.6 }),
    plaque: new THREE.MeshStandardMaterial({ map: T.plaque(), metalness: 0.7, roughness: 0.14, envMap: env, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  };
  const group = new THREE.Group(); let tris = 0;
  for (const k of Object.keys(parts)) { const g = mergeGeometries(parts[k], false); tris += g.attributes.position.count / 3; const m = new THREE.Mesh(g, mats[k]); group.add(m); }

  // 閃光：幾個四角星芒，各自以不同節奏閃爍（一個 Points，一次 draw call）
  const SP = [[0, 1.02, 0.19], [0.13, 1.055, 0.12], [-0.13, 1.055, 0.12], [0.2, 0.93, 0], [-0.2, 0.93, 0], [0, 0.89, 0.2], [0.09, 0.52, 0.09], [-0.09, 0.52, 0.09], [0, 0.34, 0.2], [0.2, 0.34, 0], [-0.2, 0.34, 0], [0.19, 0.25, 0.19], [-0.19, 0.25, 0.19], [0, 1.02, -0.19], [0.13, 1.055, -0.12], [-0.13, 1.055, -0.12], [0, 0.34, -0.2], [0, 0.66, 0.085]];
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(SP.flat(), 3));
  pg.setAttribute('aSeed', new THREE.Float32BufferAttribute(SP.map((_, i) => [(i * 0.618) % 1, 0.35 + ((i * 0.37) % 1) * 0.5, 0.6 + ((i * 0.83) % 1) * 0.6]).flat(), 3));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTex: { value: T.star() }, uPx: { value: 500 }, uGain: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uPx; attribute vec3 aSeed; varying float vA;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0);
        float ph = uTime*aSeed.y + aSeed.x*6.2831; float tw = pow(max(0.0, sin(ph)), 10.0) + 0.35*pow(max(0.0, sin(ph*2.3+1.7)), 24.0);
        vA = tw; gl_PointSize = min(220.0, uPx * 0.27 * aSeed.z * (0.5 + 0.5*tw) / max(0.5, -mv.z)); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uTex; uniform float uGain; varying float vA;
      void main(){ float s = texture2D(uTex, gl_PointCoord).r; gl_FragColor = vec4(vec3(1.0,0.97,0.92)*s*vA*uGain, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sparks = new THREE.Points(pg, sparkMat); sparks.frustumCulled = false; group.add(sparks);
  const size = new THREE.Vector2();
  // k：室內燈光 1 開、0 關。每幀把環境反射強度設回去（main.js 會在建場景後把所有材質的 envMapIntensity 乘上 0.35）
  const update = (t, k) => {
    mats.silver.envMapIntensity = 1.5 + 0.15 * k; mats.gold.envMapIntensity = 1.5 + 0.15 * k; mats.gem.envMapIntensity = 1.6; mats.plaque.envMapIntensity = 1.0;
    mats.gem.emissiveIntensity = 0.75 - 0.2 * k;
    renderer.getDrawingBufferSize(size); sparkMat.uniforms.uPx.value = size.y; sparkMat.uniforms.uTime.value = t; sparkMat.uniforms.uGain.value = 1.15 - 0.25 * k;
  };
  update(0, 1);
  return { group, update, tris };
}
