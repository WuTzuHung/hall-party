// 立體機動裝置的外觀（原創設計：皮革腰帶與胸背帶、腰後的雙捲線器主機、兩側水平的瓦斯罐、腰側的勾錨發射口）
// 座標是角色本身的座標（腳底為原點、面向 +z）；裝備架上的展示品也用同一個模型
import * as THREE from 'three';

let S;
function shared() {
  if (S) return S;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  S = {
    leather: std({ color: 0x4a3221, roughness: 0.78, metalness: 0.05 }),
    strap: std({ color: 0x2e1f15, roughness: 0.85 }),
    steel: std({ color: 0xa9b1b8, roughness: 0.32, metalness: 0.85 }),
    dark: std({ color: 0x2a2d31, roughness: 0.45, metalness: 0.7 }),
    brass: std({ color: 0xc9a253, roughness: 0.35, metalness: 0.9 }),
    glass: std({ color: 0xf2ead2, roughness: 0.2, metalness: 0.1, emissive: 0x2a2010, emissiveIntensity: 0.6 }),
    belt: new THREE.TorusGeometry(0.305, 0.024, 6, 32),
    strapG: new THREE.BoxGeometry(0.05, 0.5, 0.018),
    can: new THREE.CylinderGeometry(0.056, 0.056, 0.4, 16, 1),
    capG: new THREE.SphereGeometry(0.056, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    valve: new THREE.CylinderGeometry(0.018, 0.022, 0.05, 8),
    ring: new THREE.TorusGeometry(0.058, 0.008, 4, 18),
    body: new THREE.BoxGeometry(0.27, 0.15, 0.1),
    drum: new THREE.CylinderGeometry(0.052, 0.052, 0.055, 18),
    drumHub: new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8),
    launch: new THREE.CylinderGeometry(0.028, 0.034, 0.13, 10),
    tip: new THREE.ConeGeometry(0.03, 0.07, 6),
    gauge: new THREE.CylinderGeometry(0.035, 0.035, 0.018, 16),
    bracket: new THREE.BoxGeometry(0.03, 0.09, 0.2),
    thigh: new THREE.TorusGeometry(0.1, 0.014, 4, 16),
  };
  return S;
}
const mesh = (g, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };

// 回傳 Group；userData.launch = [左, 右] 勾鎖發射口（Object3D，用來算勾鎖線的起點）、userData.nozzle = 噴氣口
export function buildGearModel() {
  const s = shared(), g = new THREE.Group(); g.name = 'odm-gear';
  // 腰帶與前方的壓力錶
  g.add(mesh(s.belt, s.leather, 0, 0.42, 0, Math.PI / 2));
  g.add(mesh(s.gauge, s.brass, 0, 0.42, 0.315, Math.PI / 2));
  { const gl = mesh(s.gauge, s.glass, 0, 0.42, 0.323, Math.PI / 2); gl.scale.set(0.75, 0.5, 0.75); g.add(gl); }
  // 胸前交叉的背帶（前後各兩條）
  for (const sd of [-1, 1]) {
    g.add(mesh(s.strapG, s.strap, sd * 0.1, 0.62, 0.27, -0.12, 0, sd * 0.42));
    g.add(mesh(s.strapG, s.strap, sd * 0.1, 0.62, -0.27, 0.12, 0, sd * 0.42));
  }
  // 腰後主機：外殼＋左右兩個捲線鼓（黃銅）
  const back = new THREE.Group(); back.position.set(0, 0.42, -0.33); g.add(back);
  back.add(mesh(s.body, s.dark, 0, 0, 0));
  for (const sd of [-1, 1]) {
    back.add(mesh(s.drum, s.brass, sd * 0.085, 0.0, -0.06, 0, 0, Math.PI / 2));
    back.add(mesh(s.drumHub, s.steel, sd * 0.085, 0.0, -0.06, 0, 0, Math.PI / 2));
  }
  const nozzle = new THREE.Object3D(); nozzle.position.set(0, -0.02, -0.08); back.add(nozzle);
  back.add(mesh(s.valve, s.steel, 0, -0.08, -0.03));
  // 兩側瓦斯罐（水平、往後略微下傾），黃銅端蓋與束環
  const launch = [];
  for (const sd of [-1, 1]) {
    const side = new THREE.Group(); side.position.set(sd * 0.335, 0.37, -0.1); side.rotation.x = 0.2; g.add(side);
    side.add(mesh(s.can, s.steel, 0, 0, 0, Math.PI / 2));
    side.add(mesh(s.capG, s.brass, 0, 0, -0.2, -Math.PI / 2));
    side.add(mesh(s.capG, s.brass, 0, 0, 0.2, Math.PI / 2));
    for (const z of [-0.1, 0.1]) side.add(mesh(s.ring, s.dark, 0, 0, z));
    side.add(mesh(s.bracket, s.dark, -sd * 0.05, 0.03, 0.05));
    // 勾錨發射口：在罐子前上方，朝前
    const l = new THREE.Group(); l.position.set(sd * 0.33, 0.49, 0.09); g.add(l);
    l.add(mesh(s.launch, s.dark, 0, 0, 0, Math.PI / 2));
    l.add(mesh(s.tip, s.steel, 0, 0, 0.09, Math.PI / 2));
    const m = new THREE.Object3D(); m.position.set(0, 0, 0.1); l.add(m); launch.push(m);
  }
  // 大腿束帶
  for (const sd of [-1, 1]) g.add(mesh(s.thigh, s.strap, sd * 0.12, 0.2, 0, Math.PI / 2));
  g.userData.launch = launch; g.userData.nozzle = nozzle;
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

// 勾錨頭（飛出去、釘在牆上的那一端）
let headGeo;
export function buildHookHead() {
  const s = shared();
  headGeo ||= { cone: new THREE.ConeGeometry(0.05, 0.2, 8), barb: new THREE.BoxGeometry(0.16, 0.025, 0.025), col: new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8) };
  const g = new THREE.Group();
  g.add(mesh(headGeo.cone, s.steel, 0, 0, 0.1, Math.PI / 2));
  g.add(mesh(headGeo.barb, s.dark, 0, 0, 0.04, 0, 0, 0.0));
  g.add(mesh(headGeo.barb, s.dark, 0, 0, 0.04, 0, 0, Math.PI / 2));
  g.add(mesh(headGeo.col, s.brass, 0, 0, -0.02, Math.PI / 2));
  return g;
}
