// 可愛版 3D 角色：圓潤豆豆身形，沒有眼睛、沒有五官，只有粉色或藍色
import * as THREE from 'three';
import { radial } from './textures.js';

export const COLORS = {
  pink: { body: 0xffa9c6, sheen: 0xffe0ec, emissive: 0x3a0f20 },
  blue: { body: 0x92c6ff, sheen: 0xe0f0ff, emissive: 0x0d2240 },
};

let shared;
function geos() {
  if (shared) return shared;
  // 身體：由下而上圓潤的水滴輪廓
  const prof = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 底部 -> 1 頂端
    const y = t * 0.62;
    const r = t < 0.15 ? Math.sqrt(1 - Math.pow(1 - t / 0.15, 2)) * 0.3 : 0.3 - Math.pow((t - 0.15) / 0.85, 2) * 0.1;
    prof.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  prof.push(new THREE.Vector2(0.001, 0.62));
  shared = {
    body: new THREE.LatheGeometry(prof, 32),
    head: new THREE.SphereGeometry(0.33, 32, 24),
    arm: new THREE.CapsuleGeometry(0.075, 0.2, 6, 12),
    leg: new THREE.CapsuleGeometry(0.095, 0.1, 6, 12),
    shadow: new THREE.PlaneGeometry(0.9, 0.9),
    shadowTex: radial('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'),
  };
  return shared;
}

const matCache = {};
function mat(color) {
  if (matCache[color]) return matCache[color];
  const c = COLORS[color] || COLORS.pink;
  return (matCache[color] = new THREE.MeshPhysicalMaterial({
    color: c.body, roughness: 0.55, metalness: 0, sheen: 1, sheenColor: new THREE.Color(c.sheen), sheenRoughness: 0.5,
    clearcoat: 0.25, clearcoatRoughness: 0.6, emissive: c.emissive, emissiveIntensity: 1,
  }));
}

export class Avatar {
  constructor(color = 'pink') {
    const g = geos();
    this.color = color;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); // 走路時上下彈跳
    this.root.add(this.pivot);
    const m = mat(color);
    this.legL = new THREE.Mesh(g.leg, m); this.legR = new THREE.Mesh(g.leg, m);
    this.legL.position.set(-0.12, 0.15, 0); this.legR.position.set(0.12, 0.15, 0);
    this.legGroupL = new THREE.Group(); this.legGroupL.position.set(-0.12, 0.25, 0); this.legL.position.set(0, -0.12, 0); this.legGroupL.add(this.legL);
    this.legGroupR = new THREE.Group(); this.legGroupR.position.set(0.12, 0.25, 0); this.legR.position.set(0, -0.12, 0); this.legGroupR.add(this.legR);
    this.body = new THREE.Mesh(g.body, m); this.body.position.y = 0.2;
    this.head = new THREE.Mesh(g.head, m); this.head.position.y = 1.08; this.head.scale.set(1, 0.94, 1);
    this.armL = new THREE.Group(); this.armR = new THREE.Group();
    const aL = new THREE.Mesh(g.arm, m), aR = new THREE.Mesh(g.arm, m);
    aL.position.y = -0.15; aR.position.y = -0.15;
    this.armL.add(aL); this.armR.add(aR);
    this.armL.position.set(-0.27, 0.68, 0); this.armR.position.set(0.27, 0.68, 0);
    this.armL.rotation.z = -0.35; this.armR.rotation.z = 0.35;
    this.pivot.add(this.legGroupL, this.legGroupR, this.body, this.head, this.armL, this.armR);
    for (const o of [this.body, this.head, aL, aR, this.legL, this.legR]) { o.castShadow = false; }
    const sh = new THREE.Mesh(g.shadow, new THREE.MeshBasicMaterial({ map: g.shadowTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; sh.renderOrder = 1;
    this.shadow = sh; this.root.add(sh);
    this.phase = Math.random() * 10;
    this.sit = 0; // 0 站 -> 1 坐（平滑過渡）
  }
  // speed: 0..1+（走路幅度），sitting: bool
  update(dt, speed, sitting, t) {
    const target = sitting ? 1 : 0;
    this.sit += (target - this.sit) * Math.min(1, dt * 8);
    const s = this.sit;
    this.phase += dt * (4 + speed * 7) * (speed > 0.05 ? 1 : 0.25);
    const sw = Math.sin(this.phase) * Math.min(1, speed) * (1 - s);
    const breathe = Math.sin(t * 2.2 + this.phase * 0.1) * 0.012;
    this.pivot.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * Math.min(1, speed) * (1 - s) + breathe - s * 0.3;
    this.legGroupL.rotation.x = sw * 0.7 - s * 1.45;
    this.legGroupR.rotation.x = -sw * 0.7 - s * 1.45;
    this.armL.rotation.x = -sw * 0.8 - s * 0.5; this.armR.rotation.x = sw * 0.8 - s * 0.5;
    this.armL.rotation.z = -0.35 - (1 - Math.min(1, speed)) * 0.05 + s * 0.15; this.armR.rotation.z = 0.35 + s * -0.15;
    this.pivot.rotation.z = Math.sin(this.phase) * 0.05 * Math.min(1, speed) * (1 - s);
    this.head.rotation.z = Math.sin(t * 1.3 + this.phase) * 0.04;
    this.body.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
    this.shadow.visible = s < 0.5;
  }
  dispose() { this.root.removeFromParent(); }
}
