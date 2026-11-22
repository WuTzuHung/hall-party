// 立體機動裝置：在城牆區的裝備庫借用，裝在身上後可以射出左右勾鎖、靠捲線器與瓦斯在城牆與屋頂之間飛行
// 操作（桌機，需先點畫面鎖定滑鼠）：按住左鍵／右鍵＝射出左／右勾鎖（放開收回）；空中按空白鍵＝噴瓦斯；WASD＝空中調整方向
//   勾鎖釘在牆上時撞到牆面會「貼牆站立」（身體與牆面垂直），按住勾鎖會被捲線器沿牆往上拉，接近牆頂會自動翻上去；空白鍵蹬牆跳開
//   G：在裝備庫借用／歸還（伺服器管理六組裝備的借用狀態）
// 勾鎖的命中判定用簡化的碰撞方塊與圓弧城牆（不對整個場景的三角形做射線檢測），線條從腰側發射口拉到錨點，被擋住就會斷開收回
import * as THREE from 'three';
import { radial } from './textures.js';
import { buildGearModel, buildHookHead } from './gear-model.js';
import { ARMORY } from './district.js';

const RANGE = 80; // 勾鎖射程
const HOOK_OUT = 150, HOOK_BACK = 110; // 勾錨飛出／收回速度
const GRAV = 20, REEL_A = 34, GAS_A = 30, GAS_FREE_A = 24, STEER_A = 9, VMAX = 46;
const GAS_USE = 1 / 9, GAS_REGEN = 0.05; // 一罐瓦斯約可連續噴 9 秒；站在地上會慢慢回充，回到裝備庫補滿
const HIP = 0.47; // 勾鎖拉力作用點（腰）
export const inGearZone = (x) => x < -69; // 只能在城牆區使用

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function initOdm(ctx) {
  const { scene, camera, world, me, keys, isTouch, toast, send, collide, groundAt, inTheater, THEATER } = ctx;
  const S = {
    on: false, slot: -1, fly: false, cling: null, v: V(), gas: 1, armed: false, spPrev: false, gasOn: false,
    held: [false, false], prev: V(), grounded: true, contact: null, refillMsg: 0, touchGas: false, lastHint: 0,
  };
  const occ = new Map(); // 格位 -> 借用者 id

  // ---------- 勾鎖的命中目標：城牆區的碰撞方塊＋屋頂方塊＋圓弧城牆＋地面 ----------
  let BOX = null;
  const boxes = () => {
    if (BOX) return BOX;
    const set = new Set();
    for (const c of [...world.walls, ...world.camBlock, ...(world.hooks || [])]) if (!c.ghost && c.y1 < 55 && c.x1 < -62 && c.y1 > 0.5) set.add(c);
    return (BOX = [...set]);
  };
  const rings = () => world.rings || [];
  const gateGap = (g, dx, dz) => dx > 0 && Math.abs(dz) < g.L;
  // 射線：回傳 { t, n } 或 null（只算 minT 之後的命中）
  const _n = V();
  function cast(o, d, maxT, minT = 0.05, skipLow = 0) {
    let best = maxT, bn = null;
    for (const c of boxes()) {
      if (c.y1 < skipLow) continue; // 鋼索檢查時忽略矮的小東西（井、木箱、木桶：鋼索會從上面滑過）
      let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
      const o3 = [o.x, o.y, o.z], d3 = [d.x, d.y, d.z], lo = [c.x0, c.y0, c.z0], hi = [c.x1, c.y1, c.z1];
      let ok = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d3[k]) < 1e-9) { if (o3[k] < lo[k] || o3[k] > hi[k]) { ok = false; break; } continue; }
        let ta = (lo[k] - o3[k]) / d3[k], tb = (hi[k] - o3[k]) / d3[k], s = -1;
        if (ta > tb) { const q = ta; ta = tb; tb = q; s = 1; }
        if (ta > t0) { t0 = ta; ax = k; sg = s; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok || ax < 0 || t0 < minT || t0 >= best) continue;
      best = t0; bn = [0, 0, 0]; bn[ax] = d3[ax] > 0 ? -1 : 1;
    }
    for (const g of rings()) {
      const px = o.x - g.x, pz = o.z - g.z, a = d.x * d.x + d.z * d.z; if (a < 1e-9) continue;
      const b = 2 * (px * d.x + pz * d.z), top = g.h + 1.3;
      for (const [r, outer] of [[g.R + g.top, true], [g.R - g.top, false]]) {
        const c = px * px + pz * pz - r * r, disc = b * b - 4 * a * c; if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
          if (t < minT || t >= best) continue;
          const y = o.y + d.y * t; if (y < 0 || y > top) continue;
          const xx = px + d.x * t, zz = pz + d.z * t; if (gateGap(g, xx, zz)) continue;
          const nx = xx / r, nz = zz / r, rad = d.x * nx + d.z * nz;
          if (outer ? rad >= 0 : rad <= 0) continue; // 只算「進入牆體」的那一面
          best = t; bn = outer ? [nx, 0, nz] : [-nx, 0, -nz];
        }
      }
      if (d.y < -1e-6) { // 牆頂步道
        const t = (g.h + 0.08 - o.y) / d.y;
        if (t >= minT && t < best) {
          const xx = px + d.x * t, zz = pz + d.z * t, rr = Math.hypot(xx, zz);
          if (Math.abs(rr - g.R) <= g.top && !gateGap(g, xx, zz)) { best = t; bn = [0, 1, 0]; }
        }
      }
    }
    if (d.y < -1e-6) { const t = (0.15 - o.y) / d.y; if (t >= minT && t < best) { best = t; bn = [0, 1, 0]; } }
    return bn ? { t: best, n: _n.set(bn[0], bn[1], bn[2]).clone() } : null;
  }
  // 腳下可以站的「頂面」（屋頂、牆頂、木箱頂…）：只在裝上裝備時加進地面判定
  function tops(x, z, y) {
    let best = -Infinity;
    for (const c of boxes()) if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && c.y1 <= y + 0.55 && c.y1 > best) best = c.y1;
    for (const g of rings()) {
      const dx = x - g.x, dz = z - g.z;
      if (g.h + 0.08 <= y + 0.55 && Math.abs(Math.hypot(dx, dz) - g.R) <= g.top && !gateGap(g, dx, dz)) best = Math.max(best, g.h + 0.08);
    }
    return best;
  }
  // 在牆頂步道上走路：兩側女兒牆擋住（飛行時不擋）
  function afterWalk(p) {
    if (!S.on || S.fly) return;
    for (const g of rings()) {
      if (p.y < g.h - 0.3) continue;
      const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz), lim = g.top - 0.82;
      if (gateGap(g, dx, dz)) { // 城門那段直牆
        if (Math.abs(d - g.R) < g.top + 1 || (p.x > g.gx0 - 1 && p.x < g.gx1 + 1)) p.x = Math.max(g.gx0 + 0.82, Math.min(g.gx1 - 0.82, p.x));
        continue;
      }
      const off = d - g.R; if (Math.abs(off) > g.top + 0.6 || Math.abs(off) <= lim) continue;
      const r = g.R + Math.sign(off) * lim; p.x = g.x + dx / d * r; p.z = g.z + dz / d * r;
    }
  }

  // ---------- 勾鎖 ----------
  const mkHook = () => ({ s: 0, head: V(), tgt: V(), n: V(), miss: false, L: 0, los: 0, wob: 0 });
  const hooks = [mkHook(), mkHook()];
  const hipOf = (p, out) => out.set(p.x, p.y + HIP, p.z);
  const launchPos = (av, i, out) => {
    const m = av && av.gear && av.gear.userData.launch[i];
    if (!m) return out.set(me.pos.x + (i ? 0.3 : -0.3), me.pos.y + HIP, me.pos.z);
    return m.getWorldPosition(out);
  };
  const canUse = () => S.on && inGearZone(me.pos.x) && !inTheater(me.pos.x, me.pos.z) && !me.seat && ctx.canUse(); // 觀影館內不能用（不要打擾看片的人）
  const _o = V(), _d = V(), _l = V(), _h = V(), _t = V();
  function fire(i) {
    if (!canUse()) { if (S.on && !inGearZone(me.pos.x)) hintOnce('立體機動裝置只能在城牆區使用'); else if (S.on && inTheater(me.pos.x, me.pos.z)) hintOnce('觀影館內不能使用立體機動裝置'); return; }
    camera.getWorldDirection(_d); _o.copy(camera.position);
    const skip = Math.max(0.2, camera.position.distanceTo(_h.set(me.pos.x, me.pos.y + 1.3, me.pos.z)) + 0.4);
    const hit = cast(_o, _d, skip + RANGE, skip);
    const H = hooks[i];
    if (me.avatar) me.avatar.root.updateMatrixWorld(true);
    launchPos(me.avatar, i, _l);
    if (hit) { H.tgt.copy(_o).addScaledVector(_d, hit.t); H.n.copy(hit.n); H.miss = false; }
    else { H.tgt.copy(_o).addScaledVector(_d, skip + RANGE); H.miss = true; }
    // 發射口到目標之間若有東西擋住，就釘在擋住的地方
    _t.subVectors(H.tgt, _l); const len = _t.length(); _t.divideScalar(len || 1);
    const h2 = cast(_l, _t, len - 0.05, 0.3);
    if (h2) { H.tgt.copy(_l).addScaledVector(_t, h2.t); H.n.copy(h2.n); H.miss = false; }
    if (H.tgt.distanceTo(hipOf(me.pos, _h)) > RANGE + 4) H.miss = true;
    H.s = 1; H.head.copy(_l); H.wob = 1;
    ctx.onAction();
  }
  function retract(i) { if (hooks[i].s === 1 || hooks[i].s === 2) hooks[i].s = 3; }
  const anchored = () => hooks.filter((h) => h.s === 2);

  // ---------- 飛行 ----------
  function startFly() {
    if (S.fly || S.cling) return;
    S.fly = true; S.grounded = false;
    S.v.set((me.pos.x - S.prev.x) / Math.max(1e-3, S.dtPrev || 0.016), me.onGround ? 0 : me.vy, (me.pos.z - S.prev.z) / Math.max(1e-3, S.dtPrev || 0.016));
    if (S.v.length() > 12) S.v.setLength(12);
    if (me.onGround) S.v.y = Math.max(S.v.y, 4.5); // 從地面被捲線器拉起：先往上彈一下

    me.onGround = false; me.jumping = false; me.vy = 0;
    ctx.onAction();
  }
  function endFly() {
    S.fly = false; S.cling = null; S.v.set(0, 0, 0);
    me.onGround = true; me.jumping = false; me.vy = 0; me.airT = 0; me.speed = 0;
  }
  const camFwd = V(), camRight = V(), inp = V();
  function inputDir(out) { // 鍵盤／搖桿方向（相機水平方向）
    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz -= 1; if (keys.KeyS || keys.ArrowDown) iz += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
    const j = ctx.joy(); ix += j.x; iz += j.y;
    const yaw = ctx.yaw(), sin = Math.sin(yaw), cos = Math.cos(yaw);
    out.set(ix * cos + iz * sin, 0, -ix * sin + iz * cos);
    if (out.lengthSq() > 1) out.normalize();
    return { ix, iz };
  }
  // 翻上頂面：在牆面上（法線 n）時，牆內側 1.1m 的地方有沒有 2.4m 以內可以站的頂面
  function tryClimb(n, minH = 0) {
    const q = _t.set(me.pos.x - n.x * 1.1, 0, me.pos.z - n.z * 1.1);
    const top = Math.max(-Infinity, tops(q.x, q.z, me.pos.y + 1.9));
    if (!(top > 0.5 && top > me.pos.y - 0.3 && top >= minH)) return false;
    let x = q.x - n.x * 0.6, z = q.z - n.z * 0.6;
    if (tops(x, z, top + 0.1) < top - 0.05) { x = q.x; z = q.z; }
    me.pos.set(x, top, z);
    hooks.forEach((_, i) => retract(i));
    endFly(); afterWalk(me.pos);
    return true;
  }
  const _a = V(), _sum = V(), _dn = V(), _b = V();
  function flyStep(dt) {
    const A = anchored();
    camera.getWorldDirection(camFwd);
    const steer = inputDir(inp);
    const n = Math.min(10, Math.max(1, Math.ceil(S.v.length() * dt / 0.3))), h = dt / n;
    let contact = null; S.grounded = false;
    for (let k = 0; k < n; k++) {
      _a.set(0, -GRAV, 0);
      hipOf(me.pos, _h); _sum.set(0, 0, 0);
      for (const H of A) _sum.add(_dn.subVectors(H.tgt, _h).normalize());
      if (A.length && _sum.lengthSq() > 1e-6) { _sum.normalize(); _a.addScaledVector(_sum, REEL_A * (A.length === 2 ? 1.15 : 1)); }
      if (S.gasOn) {
        if (A.length) _a.addScaledVector(_sum, GAS_A * 0.7).addScaledVector(camFwd, GAS_A * 0.35);
        else _a.addScaledVector(_b.copy(camFwd).addScaledVector(UP, 0.3).normalize(), GAS_FREE_A);
        S.gas = Math.max(0, S.gas - GAS_USE * h);
      }
      _a.addScaledVector(inp, STEER_A);
      S.v.addScaledVector(_a, h).multiplyScalar(1 - 0.08 * h);
      if (S.v.length() > VMAX) S.v.setLength(VMAX);
      me.pos.addScaledVector(S.v, h);
      // 鋼索不能伸長：超過長度就拉回、去掉往外的速度；捲線器把鬆掉的部分收起來
      for (const H of A) {
        hipOf(me.pos, _h); _dn.subVectors(_h, H.tgt); const dist = _dn.length(); if (dist < 1e-4) continue; _dn.divideScalar(dist);
        if (dist > H.L) { me.pos.addScaledVector(_dn, H.L - dist); const vr = S.v.dot(_dn); if (vr > 0) S.v.addScaledVector(_dn, -vr); }
        H.L = Math.max(0.8, Math.min(H.L, dist));
      }
      // 牆：水平推出，去掉撞進牆的速度
      _b.copy(me.pos); collide(me.pos);
      const dx = me.pos.x - _b.x, dz = me.pos.z - _b.z, dl = Math.hypot(dx, dz);
      if (dl > 1e-5) { const nx = dx / dl, nz = dz / dl, vn = S.v.x * nx + S.v.z * nz; if (vn < 0) { S.v.x -= nx * vn; S.v.z -= nz * vn; } contact = { x: nx, z: nz }; }
      // 地面與頂面
      const g = groundAt(me.pos.x, me.pos.z, me.pos.y);
      if (me.pos.y <= g) {
        me.pos.y = g; if (S.v.y < 0) S.v.y = 0; S.grounded = true;
        if (!A.length && !S.gasOn) { const f = 1 - Math.min(1, 7 * h); S.v.x *= f; S.v.z *= f; }
      }
      if (inTheater(me.pos.x, me.pos.z)) { const cap = THEATER.eave - 1.7; if (me.pos.y > cap) { me.pos.y = cap; S.v.y = Math.min(0, S.v.y); } }
      if (me.pos.y > 80) { me.pos.y = 80; S.v.y = Math.min(0, S.v.y); }
    }
    S.contact = contact;
    if (contact) {
      const n3 = _dn.set(contact.x, 0, contact.z);
      if (A.length && tryClimb(n3, 2.6)) return; // 被拉到牆頂（或屋頂）邊緣：直接翻上去（矮的木箱、井不算）
      const g = groundAt(me.pos.x, me.pos.z, me.pos.y);
      // 被拉過矮的東西（井、木箱、攤子）：往上跳過去，不要卡在旁邊
      const lowTop = tops(me.pos.x - n3.x * 0.6, me.pos.z - n3.z * 0.6, me.pos.y + 2.2);
      if (lowTop > me.pos.y - 0.2 && lowTop - g < 2.6) { if (A.length || S.gasOn) S.v.y = Math.max(S.v.y, 6.5); }
      else if (A.length && me.pos.y - g > 1.2) { S.cling = { n: n3.clone() }; S.fly = false; S.v.set(0, 0, 0); return; }
    }
    if (S.grounded && !A.length && !S.gasOn) { endFly(); return; }
    const hs = Math.hypot(S.v.x, S.v.z);
    if (hs > 1.5) { const want = Math.atan2(S.v.x, S.v.z); let d = want - me.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); me.ry += d * Math.min(1, dt * 8); }
    else if (steer.ix || steer.iz) me.ry = Math.atan2(inp.x, inp.z);
  }
  const _f = V(), _r = V(), _m = V();
  function clingStep(dt, spEdge) {
    const n = S.cling.n, A = anchored();
    if (!A.length) { S.cling = null; S.fly = true; S.v.copy(n).multiplyScalar(2); return; }
    camera.getWorldDirection(camFwd);
    if (spEdge) { // 蹬牆跳開
      _b.set(camFwd.x, 0, camFwd.z); if (_b.lengthSq() > 1e-6) _b.normalize();
      S.v.copy(n).multiplyScalar(7).addScaledVector(UP, 6.5).addScaledVector(_b, 3);
      S.cling = null; S.fly = true; S.armed = false;
      return;
    }
    hipOf(me.pos, _h);
    for (const H of A) { const i = hooks.indexOf(H); if (S.held[i] && _dn.subVectors(H.tgt, _h).normalize().dot(n) > 0.35) { S.cling = null; S.fly = true; S.v.set(0, 0, 0); return; } } // 新的勾鎖往牆外拉：離開牆面
    const st = inputDir(inp);
    _f.copy(camFwd).addScaledVector(n, -camFwd.dot(n)); if (_f.lengthSq() > 1e-6) _f.normalize();
    _r.crossVectors(_f, n).normalize().negate();
    _m.set(0, 0, 0).addScaledVector(_f, -st.iz).addScaledVector(_r, st.ix);
    if (_m.lengthSq() > 1) _m.normalize();
    _m.multiplyScalar(3.2);
    for (const H of A) { // 捲線器：按住勾鎖時沿牆面被拉向錨點
      const i = hooks.indexOf(H); if (!S.held[i]) continue;
      // 錨點離牆頂不遠：一路拉到頂端翻上去
      const tp = tops(H.tgt.x - n.x * 1.2, H.tgt.z - n.z * 1.2, H.tgt.y + 7);
      _p.copy(H.tgt); if (tp > H.tgt.y - 0.6) _p.y = tp + 1.2;
      _b.subVectors(_p, _h); _b.addScaledVector(n, -_b.dot(n));
      if (_b.length() > 1.0) _m.addScaledVector(_b.normalize(), 6);
    }
    me.pos.addScaledVector(_m, dt);
    for (const H of A) { hipOf(me.pos, _h); H.L = Math.max(0.8, _h.distanceTo(H.tgt)); }
    // 貼回牆面；牆面沒了（走到邊緣）就掉下去，到了頂端就翻上去
    me.pos.addScaledVector(n, -0.15); _b.copy(me.pos); collide(me.pos);
    const dl = Math.hypot(me.pos.x - _b.x, me.pos.z - _b.z);
    if (tryClimb(n)) return;
    if (dl < 1e-4) { me.pos.addScaledVector(n, 0.15); S.cling = null; S.fly = true; S.v.set(0, 0, 0); return; }
    n.set(me.pos.x - _b.x, 0, me.pos.z - _b.z).normalize();
    const g = groundAt(me.pos.x, me.pos.z, me.pos.y);
    if (me.pos.y <= g + 0.05) { me.pos.y = g; endFly(); }
  }

  // ---------- 每幀：由 main.js 的 updateMe 一開始呼叫；回傳 true 代表這一幀的移動由裝備接手 ----------
  function stepMe(dt) {
    const sp = !!keys.Space || S.touchGas;
    const edge = sp && !S.spPrev; S.spPrev = sp;
    const airborne = S.fly || S.cling || !me.onGround;
    if (edge && airborne && !S.cling) S.armed = true;
    if (!sp) S.armed = false;
    if (S.touchGas && edge && !S.cling) S.armed = true;
    if (!S.on) { S.prev.copy(me.pos); S.dtPrev = dt; return false; }
    const usable = canUse();
    if (!usable) { hooks.forEach((_, i) => retract(i)); if (S.cling) { S.cling = null; S.fly = true; } }
    S.gasOn = S.armed && sp && S.gas > 0.002 && usable && !S.cling;
    if (!S.fly && !S.cling) {
      if (anchored().length || (S.gasOn && !me.onGround)) startFly();
      else {
        if (me.onGround) S.gas = Math.min(1, S.gas + GAS_REGEN * dt);
        S.prev.copy(me.pos); S.dtPrev = dt; return false;
      }
    }
    if (S.cling) clingStep(dt, edge);
    else if (S.fly) flyStep(dt);
    me.onGround = !(S.fly || S.cling); me.airT = S.fly || S.cling ? 1 : 0; me.jumping = false; me.speed = 0;
    S.prev.copy(me.pos); S.dtPrev = dt;
    return true;
  }

  // ---------- 勾鎖線（面向相機的細帶）、勾錨頭、瓦斯煙 ----------
  const ropeMat = new THREE.MeshBasicMaterial({ color: 0x9ea6ad, side: THREE.DoubleSide, fog: true });
  const SEG = 18;
  function mkRope() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 6), 3));
    const idx = []; for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    const m = new THREE.Mesh(g, ropeMat); m.frustumCulled = false; m.visible = false; scene.add(m);
    const head = buildHookHead(); head.visible = false; scene.add(head);
    return { m, head };
  }
  const _p = V(), _q = V(), _side = V(), _vd = V(), _dir = V();
  function drawRope(R, a, b, wob, t, seed) {
    const pos = R.m.geometry.attributes.position, len = a.distanceTo(b);
    _dir.subVectors(b, a).divideScalar(len || 1);
    _vd.subVectors(camera.position, a);
    _side.crossVectors(_dir, _vd).normalize();
    if (!Number.isFinite(_side.x) || _side.lengthSq() < 0.5) _side.set(1, 0, 0);
    const w = Math.max(0.018, Math.min(0.06, camera.position.distanceTo(a) * 0.0016));
    const perp = _q.crossVectors(_dir, UP); if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0); perp.normalize();
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, env = Math.sin(u * Math.PI);
      _p.lerpVectors(a, b, u);
      if (wob > 0.001) { // 飛出／收回時的波動與下垂
        _p.addScaledVector(perp, Math.sin(u * 9 + t * 40 + seed) * 0.18 * wob * env);
        _p.y -= env * Math.min(1.5, len * 0.04) * wob;
      }
      const ww = w * (0.6 + 0.4 * (1 - u));
      pos.setXYZ(i * 2, _p.x + _side.x * ww, _p.y + _side.y * ww, _p.z + _side.z * ww);
      pos.setXYZ(i * 2 + 1, _p.x - _side.x * ww, _p.y - _side.y * ww, _p.z - _side.z * ww);
    }
    pos.needsUpdate = true; R.m.visible = true;
    R.head.visible = true; R.head.position.copy(b); R.head.lookAt(_p.copy(b).add(_dir));
  }
  const hideRope = (R) => { R.m.visible = false; R.head.visible = false; };
  const myRopes = [mkRope(), mkRope()];
  // 瓦斯煙（白色柔光精靈）
  const puffTex = radial('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
  const puffs = [];
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0, color: 0xf4f1ea }));
    s.visible = false; s.renderOrder = 3; scene.add(s); puffs.push({ s, life: 0, max: 1, v: V(), s0: 0.2, s1: 1.4, op: 0.5 });
  }
  let puffI = 0;
  function puff(at, vel, max = 0.7, s0 = 0.25, s1 = 1.5, op = 0.45, color = 0xf4f1ea) {
    const P = puffs[puffI++ % puffs.length];
    P.s.position.copy(at); P.v.copy(vel); P.life = 0; P.max = max; P.s0 = s0; P.s1 = s1; P.op = op;
    P.s.material.color.setHex(color); P.s.visible = true;
  }
  const _pv = V();
  function dust(at, n) { // 勾錨釘進牆面時的石屑
    for (let k = 0; k < 6; k++) puff(at, _pv.copy(n).multiplyScalar(1.5).add(_q.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(2)), 0.6, 0.1, 0.7, 0.55, 0xb9ad98);
  }
  function updatePuffs(dt) {
    for (const P of puffs) {
      if (!P.s.visible) continue;
      P.life += dt; const u = P.life / P.max;
      if (u >= 1) { P.s.visible = false; continue; }
      P.s.position.addScaledVector(P.v, dt); P.v.multiplyScalar(1 - 2.2 * dt);
      const sc = P.s0 + (P.s1 - P.s0) * Math.sqrt(u); P.s.scale.set(sc, sc, 1);
      P.s.material.opacity = P.op * (1 - u) * Math.min(1, u * 6);
    }
  }
  const _nz = V(), _gv = V();
  function gasPuffs(av, dir, dt) { // 從腰後噴氣口往推力反方向噴
    const nz = av && av.gear && av.gear.userData.nozzle; if (!nz) return;
    nz.getWorldPosition(_nz);
    const k = Math.min(3, Math.ceil(dt * 90));
    for (let i = 0; i < k; i++) puff(_nz, _gv.copy(dir).multiplyScalar(-6).add(_q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6)), 0.55 + Math.random() * 0.3);
  }

  // ---------- 姿勢 ----------
  const _qa = new THREE.Quaternion(), _eu = new THREE.Euler(0, 0, 0, 'YXZ'), _mx = new THREE.Matrix4(), _c = V();
  function pose(av, st) {
    const root = av.root;
    if (st.cling) { // 貼牆站立：身體與牆面垂直，腳踩在牆上，頭朝外
      const n = st.cling;
      _f.copy(st.look || UP).addScaledVector(n, -(st.look || UP).dot(n)); if (_f.lengthSq() < 0.05) _f.copy(UP); _f.normalize();
      _r.crossVectors(n, _f).normalize();
      _mx.makeBasis(_r, n, _f); root.quaternion.setFromRotationMatrix(_mx);
      return;
    }
    if (st.fly) { // 飛行：依水平速度往前傾，繞身體中心旋轉
      const hs = Math.hypot(st.v.x, st.v.z), pitch = Math.min(1, hs / 26) * 1.05 - Math.max(-0.4, Math.min(0.3, st.v.y / 40));
      _eu.set(pitch, st.ry, 0); root.quaternion.setFromEuler(_eu);
      _c.set(0, 0.6, 0).applyQuaternion(root.quaternion);
      root.position.y += 0.6 - _c.y; root.position.x -= _c.x; root.position.z -= _c.z;
      return;
    }
    root.rotation.set(0, st.ry, 0);
  }
  function poseMe() {
    if (!me.avatar) return;
    camera.getWorldDirection(camFwd);
    pose(me.avatar, { cling: S.cling && S.cling.n, fly: S.fly, v: S.v, ry: me.ry, look: _b.copy(camFwd).negate().add(UP) });
  }

  // ---------- 網路：位置訊息裡的裝備狀態 ----------
  const r2 = (v) => Math.round(v * 100) / 100;
  function encode() {
    if (!S.on) return undefined;
    const f = 1 | (hooks[0].s ? 2 : 0) | (hooks[1].s ? 4 : 0) | (S.gasOn ? 8 : 0) | (S.cling ? 16 : 0) | (S.fly ? 32 : 0);
    if (!(f & (2 | 4 | 16))) return [f];
    const a = hooks[0].head, b = hooks[1].head, n = S.cling ? S.cling.n : UP;
    return [f, r2(a.x), r2(a.y), r2(a.z), r2(b.x), r2(b.y), r2(b.z), r2(n.x), r2(n.z)];
  }
  function remoteState(r, g) {
    const f = Array.isArray(g) ? g[0] | 0 : 0;
    r.av.setGear(!!(f & 1));
    const R = r.odm ||= { ropes: null, heads: [V(), V()], f: 0, n: V(), seen: [false, false], v: V(), lp: null };
    R.f = f;
    for (let i = 0; i < 2; i++) {
      const on = !!(f & (2 << i));
      if (on && g.length >= 9) { const t = _t.set(g[1 + i * 3], g[2 + i * 3], g[3 + i * 3]); if (!R.seen[i]) R.heads[i].copy(t); R.tgt ||= [V(), V()]; R.tgt[i].copy(t); }
      R.seen[i] = on;
    }
    if (f & 16 && g.length >= 9) R.n.set(g[7], 0, g[8]).normalize();
  }
  function poseRemote(r, dt) {
    const R = r.odm; if (!R || !(R.f & 1)) { if (r.odm && r.odm.ropes) r.odm.ropes.forEach(hideRope); if (r.av.root.rotation.x || r.av.root.rotation.z) r.av.root.rotation.set(0, r.ry, 0); return; }
    const p = r.av.root.position;
    if (R.lp) R.v.lerp(_t.subVectors(p, R.lp).divideScalar(Math.max(dt, 1e-3)), Math.min(1, dt * 6)); R.lp ||= V(); R.lp.copy(p);
    pose(r.av, { cling: R.f & 16 ? R.n : null, fly: !!(R.f & 32), v: R.v, ry: r.ry, look: UP });
  }

  // ---------- 裝備庫 ----------
  // 每一格是一個深色木製的半身架（形狀跟角色身體一樣），裝備穿在上面；被借走時只剩木架
  // 半身架輪廓：腰細、胸寬、肩膀收到脖子
  const prof = [[0.001, 0], [0.25, 0], [0.27, 0.06], [0.25, 0.22], [0.27, 0.42], [0.26, 0.54], [0.18, 0.64], [0.07, 0.68], [0.06, 0.78], [0.001, 0.8]].map(([r, y]) => new THREE.Vector2(r, y));
  const formGeo = new THREE.LatheGeometry(prof, 28), formMat = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.55, metalness: 0.05 });
  const rack = ARMORY.slots.map((sl) => {
    const form = new THREE.Mesh(formGeo, formMat); form.position.set(sl.x, sl.y + 0.2, sl.z); scene.add(form);
    const g = buildGearModel(); g.position.set(sl.x, sl.y, sl.z); g.rotation.y = sl.ry; scene.add(g); return g;
  });
  const showRack = () => rack.forEach((g, i) => { g.visible = !occ.has(i); });
  showRack();
  const nearRack = () => { const A = ARMORY; return me.pos.x > A.x0 - 0.6 && me.pos.x < A.x1 && me.pos.z > A.z0 && me.pos.z < A.z1 && me.pos.y < 1.5; };
  let pending = false;
  function toggleGear() {
    if (!nearRack()) { if (S.on) toast('要回到外城廣場的裝備庫（第一道城門內側）才能歸還'); return; }
    if (pending) return;
    ctx.flush(); // 先把目前位置送出去（伺服器要確認人在裝備庫前）
    if (S.on) { pending = true; send({ t: 'gear', ret: 1 }); setTimeout(() => { pending = false; }, 3000); return; }
    let slot = -1, bd = Infinity;
    ARMORY.slots.forEach((sl, i) => { if (occ.has(i)) return; const d = Math.hypot(sl.x - me.pos.x, sl.z - me.pos.z); if (d < bd) { bd = d; slot = i; } });
    if (slot < 0) { toast('六組裝備都被借走了，等其他人歸還'); return; }
    pending = true; send({ t: 'gear', take: slot });
    setTimeout(() => { pending = false; }, 3000);
  }
  function equip(slot, quiet) {
    S.on = true; S.slot = slot; S.gas = 1; me.avatar && me.avatar.setGear(true);
    if (!quiet) toast(isTouch ? '已裝上立體機動裝置：按住「左勾」「右勾」射出勾鎖，「噴氣」加速；勾著撞牆會貼牆站立，往上拉到頂可以翻上城牆' : '已裝上立體機動裝置：按住滑鼠左／右鍵射出勾鎖，空中按空白鍵噴氣，WASD 調整方向；勾著撞牆會貼牆站立，拉到頂端會翻上城牆。G 在這裡歸還', 9000);
    ui();
  }
  function unequip(quiet) {
    S.on = false; S.slot = -1; hooks.forEach((H) => { H.s = 0; }); myRopes.forEach(hideRope);
    if (S.fly || S.cling) endFly();
    me.avatar && me.avatar.setGear(false);
    if (!quiet) toast('已歸還立體機動裝置');
    ui();
  }
  function onMsg(m) {
    if (m.t === 'gears') { occ.clear(); for (const [i, id] of m.s || []) occ.set(Number(i), String(id)); showRack(); if (S.on && ![...occ.values()].includes(me.id)) unequip(true); return; }
    if (m.t === 'gearOk') { pending = false; if (m.slot >= 0) { if (!S.on) equip(m.slot); } else if (S.on) unequip(); return; }
    if (m.t === 'gearNo') { pending = false; toast(m.why === 'taken' ? '這組剛被別人拿走了，再按一次換一組' : m.why === 'far' ? '要站在裝備庫前面才能借用或歸還' : '無法借用'); }
  }
  function welcome(list) {
    occ.clear(); for (const [i, id] of list || []) occ.set(Number(i), String(id)); showRack();
    const mine = [...occ.entries()].find(([, id]) => id === me.id);
    if (mine && !S.on) equip(mine[0], true); else if (!mine && S.on) unequip(true);
  }
  function reset() { hooks.forEach((H) => { H.s = 0; }); myRopes.forEach(hideRope); if (S.fly || S.cling) endFly(); }

  // ---------- 介面：準心、瓦斯錶、借用按鈕、手機按鈕 ----------
  const hud = ctx.hud;
  const el = document.createElement('div'); el.id = 'odm-hud'; el.className = 'hidden';
  el.innerHTML = '<div id="odm-ret"><i class="l"></i><i class="r"></i><b></b><span id="odm-dist"></span></div><div id="odm-gas"><span>瓦斯</span><div><i></i></div></div>';
  hud.appendChild(el);
  const btn = document.createElement('button'); btn.id = 'btn-gear'; btn.className = 'hidden'; hud.appendChild(btn);
  btn.addEventListener('click', (e) => { e.preventDefault(); btn.blur(); toggleGear(); });
  const tb = document.createElement('div'); tb.id = 'odm-touch'; tb.className = 'hidden';
  tb.innerHTML = '<button data-k="0">左勾</button><button data-k="gas">噴氣</button><button data-k="1">右勾</button>';
  hud.appendChild(tb);
  for (const b of tb.querySelectorAll('button')) {
    const k = b.dataset.k;
    const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('press'); if (k === 'gas') S.touchGas = true; else { S.held[+k] = true; fire(+k); } };
    const up = () => { b.classList.remove('press'); if (k === 'gas') S.touchGas = false; else { S.held[+k] = false; if (!S.cling) retract(+k); } };
    b.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const ret = el.querySelector('#odm-ret'), dist = el.querySelector('#odm-dist'), gasBar = el.querySelector('#odm-gas i');
  let btnLbl = '', retT = 0;
  function ui() {
    const show = S.on && canUse();
    el.classList.toggle('hidden', !show);
    document.body.classList.toggle('odm-on', show);
    tb.classList.toggle('hidden', !(show && isTouch));
    const near = nearRack() && inGearZone(me.pos.x) && !me.seat;
    btn.classList.toggle('hidden', !near);
    const lbl = S.on ? (isTouch ? '歸還裝備' : '歸還裝備（G）') : (isTouch ? '借用立體機動裝置' : '借用立體機動裝置（G）');
    if (lbl !== btnLbl) { btnLbl = lbl; btn.textContent = lbl; }
  }
  function hintOnce(t) { const now = performance.now(); if (now - S.lastHint > 4000) { S.lastHint = now; toast(t); } }
  // 桌機：滑鼠鎖定時左右鍵射勾鎖
  document.addEventListener('mousedown', (e) => {
    if (!S.on || !ctx.locked() || (e.button !== 0 && e.button !== 2)) return;
    const i = e.button === 0 ? 0 : 1; S.held[i] = true; fire(i);
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const i = e.button === 0 ? 0 : 1; S.held[i] = false; if (!S.cling) retract(i);
  });
  addEventListener('blur', () => { S.held[0] = S.held[1] = false; S.touchGas = false; });
  function key(e) {
    if (e.code !== 'KeyG' || e.repeat) return false;
    if (!nearRack() && !S.on) return false;
    toggleGear(); return true;
  }

  // ---------- 每幀繪製（角色姿勢都設好之後、渲染之前） ----------
  const _la = V();
  function frame(dt, t, remotes) {
    if (S.on && me.avatar) {
      me.avatar.root.updateMatrixWorld(true);
      hipOf(me.pos, _h);
      hooks.forEach((H, i) => {
        launchPos(me.avatar, i, _la);
        if (H.s === 1) {
          const step = HOOK_OUT * dt, d = H.head.distanceTo(H.tgt);
          if (d <= step) {
            H.head.copy(H.tgt);
            if (H.miss || !canUse()) H.s = 3;
            else { H.s = 2; H.L = Math.max(0.8, _h.distanceTo(H.tgt)); H.los = 0; dust(H.tgt, H.n); if (!S.held[i] && !S.cling) H.s = 3; }
          } else H.head.addScaledVector(_t.subVectors(H.tgt, H.head).normalize(), step);
          H.wob = Math.max(0.15, H.wob - dt * 2);
        } else if (H.s === 2) {
          H.wob = Math.max(0, H.wob - dt * 4);
          if (!S.held[i] && !S.cling) H.s = 3;
          else if ((H.los += dt) > 0.12) { // 鋼索被東西擋住就斷開收回
            H.los = 0; _t.subVectors(H.tgt, _h); const L = _t.length(); _t.divideScalar(L || 1);
            const hit = L > 1.5 ? cast(_h, _t, L - 0.8, 0.5, 2.6) : null; if (hit) H.s = 3;
          }
        }
        if (H.s === 3) {
          const step = HOOK_BACK * dt, d = H.head.distanceTo(_la);
          H.wob = Math.min(1, H.wob + dt * 3);
          if (d <= step) H.s = 0; else H.head.addScaledVector(_t.subVectors(_la, H.head).normalize(), step);
        }
        if (H.s) drawRope(myRopes[i], _la, H.head, H.wob, t, i * 3); else hideRope(myRopes[i]);
      });
      if (S.gasOn && (S.fly)) gasPuffs(me.avatar, _t.copy(S.v).lengthSq() > 1 ? _t.normalize() : UP, dt);
      if (nearRack() && S.gas < 1) { S.gas = 1; if (performance.now() - S.refillMsg > 8000) { S.refillMsg = performance.now(); toast('瓦斯已補滿'); } }
    }
    // 其他玩家的勾鎖
    for (const r of remotes) {
      const R = r.odm; if (!R) continue;
      if (!(R.f & 1)) { if (R.ropes) R.ropes.forEach(hideRope); continue; }
      R.ropes ||= [mkRope(), mkRope()];
      r.av.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) {
        if (!(R.f & (2 << i)) || !R.tgt) { hideRope(R.ropes[i]); continue; }
        R.heads[i].lerp(R.tgt[i], Math.min(1, dt * 12));
        launchPos(r.av, i, _la); drawRope(R.ropes[i], _la, R.heads[i], 0, t, i);
      }
      if (R.f & 8 && R.f & 32) gasPuffs(r.av, R.v.lengthSq() > 1 ? _t.copy(R.v).normalize() : UP, dt);
    }
    updatePuffs(dt);
    ui();
    if (S.on && canUse()) {
      gasBar.style.width = (S.gas * 100).toFixed(1) + '%';
      el.classList.toggle('low', S.gas < 0.2);
      if ((retT += dt) > 0.08) { // 準心：目標在射程內就亮起
        retT = 0;
        camera.getWorldDirection(_d);
        const skip = camera.position.distanceTo(_h.set(me.pos.x, me.pos.y + 1.3, me.pos.z)) + 0.4;
        const hit = cast(camera.position, _d, skip + RANGE, skip);
        ret.classList.toggle('ok', !!hit);
        dist.textContent = hit ? Math.round(hit.t - skip + 0.4) + ' m' : '';
      }
      ret.classList.toggle('hl', hooks[0].s === 2); ret.classList.toggle('hr', hooks[1].s === 2);
    }
  }

  return {
    get on() { return S.on; }, get flying() { return S.fly || !!S.cling; }, get speed() { return S.fly ? S.v.length() : 0; },
    stepMe, afterWalk, tops, key, frame, toggleGear,
    fire: (i) => { S.held[i] = true; fire(i); }, release: (i) => { S.held[i] = false; if (!S.cling) retract(i); }, poseMe, encode, remoteState, poseRemote, onMsg, welcome, reset, cast,
    state: S, hooks,
  };
}
