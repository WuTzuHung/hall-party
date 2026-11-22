// 大螢幕：用 CSS3DRenderer 把 YouTube iframe 放進 3D 空間，並與伺服器同步播放進度
// 大廳音樂／比賽兩種模式共用同一個播放器：換曲或換模式時先把音量淡出、換片、再淡入（約 2 秒）
// 音樂模式可顯示「正在播放」卡片：播放器仍以原尺寸在卡片下方播放（不能 display:none，否則 YouTube 可能停播）
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { SCREEN } from './world.js';

const PX_W = 1280, PX_H = 720;
// YouTube 依播放器本身的像素大小挑畫質：1280×720 的播放器最高只會給 720p，放大到全螢幕就糊了。
// 所以讓 iframe 內部以 Q 倍尺寸排版（1920×1080 或 2560×1440），再用 transform 縮回原本的版面大小，
// 這樣 YouTube 會給 1080p／1440p，畫面位置與卡片排版都不變。
const Q = (() => {
  try {
    const big = Math.max(window.screen.width, window.screen.height) * (window.devicePixelRatio || 1) >= 2500;
    return big && !window.matchMedia('(pointer: coarse)').matches ? 2 : 1.5;
  } catch (_) { return 1.5; }
})();
const RULE = (w, m) => `<div style="width:${w}px;height:1px;background:linear-gradient(90deg,transparent,#c9a24a,transparent);${m}"></div>`;
// 3D 場景裡不放中文：標題含中日韓文字時改顯示曲目編號
const latinOnly = (s) => (s && !/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(s) ? s : '');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (d ? d + 'D ' : '') + (d || h ? p(h) + ':' : '') + p(m) + ':' + p(x);
}

// 所有螢幕共用一個 CSS3D 圖層（一個 DOM 層、每幀只渲染一次）
export class ScreenLayer {
  constructor(container) {
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.domElement.id = 'css3d';
    container.prepend(this.cssRenderer.domElement);
    this.cssScene = new THREE.Scene();
  }
  render(camera) { this.cssRenderer.render(this.cssScene, camera); }
  setSize(w, h) { this.cssRenderer.setSize(w, h); }
}
// YouTube IFrame API 只載入一次，所有螢幕共用
let ytPromise = null;
function ytReady() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((res) => {
    if (window.YT?.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch (_) { } res(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytPromise;
}

export class BigScreen {
  // cfg：{ x, y, z, w, h, ry（面向；0 = 朝 +z）, elId, idleHTML }；不給就是殿堂大螢幕
  constructor(scene, layer, cfg = {}) {
    if (!(layer instanceof ScreenLayer)) layer = new ScreenLayer(layer); // 兼容舊用法：第二個參數是容器
    this.layer = layer; this.cssScene = layer.cssScene; this.cssRenderer = layer.cssRenderer;
    const S = this.cfg = { x: SCREEN.x, y: SCREEN.y, z: SCREEN.z, w: SCREEN.w, h: SCREEN.h, ry: 0, elId: 'yt-player', idleHTML: null, ...cfg };
    this.active = true;

    const el = document.createElement('div');
    el.style.cssText = `width:${PX_W}px;height:${PX_H}px;background:#000;overflow:hidden;position:relative`;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes hs-eq{0%,100%{transform:scaleY(.18)}50%{transform:scaleY(1)}}
      @keyframes hs-glow{0%,100%{opacity:.55}50%{opacity:1}}
      .hs-layer{position:absolute;inset:0;transition:opacity 1s ease}
      .hs-card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#f3e6c4;font-family:Cinzel,serif;
        background:radial-gradient(ellipse at 50% 38%,#3a1f66,#0b0718 72%)}
      .hs-eq{display:flex;gap:9px;align-items:flex-end;height:64px;margin:6px 0 30px}
      .hs-eq i{display:block;width:8px;height:64px;border-radius:2px;background:linear-gradient(180deg,#f6dc95,#a97f2e);transform-origin:50% 100%;animation:hs-eq 1.2s ease-in-out infinite}
      .hs-card.paused .hs-eq i{animation-play-state:paused}
      .hs-banner{position:absolute;left:50%;top:26px;transform:translateX(-50%);padding:12px 34px 13px;border:1px solid rgba(224,189,106,.55);border-radius:3px;
        background:rgba(11,7,24,.78);color:#ecd9a8;font-family:Cinzel,serif;letter-spacing:6px;font-size:22px;white-space:nowrap;transition:opacity .8s}
      .hs-banner b{font-weight:600;font-size:30px;letter-spacing:4px;color:#fff3d1;margin-left:18px}`;
    el.appendChild(style);
    // 待機畫面（沒有任何內容時）
    const idle = document.createElement('div'); idle.className = 'hs-layer';
    idle.style.cssText += ';display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,#3a1f66,#0b0718 70%);color:#f3e6c4;font-family:Cinzel,serif;text-align:center';
    idle.innerHTML = S.idleHTML || RULE(420, 'margin-bottom:34px') + '<div style="font-size:84px;font-weight:600;letter-spacing:28px;padding-left:28px;color:#ecd9a8;text-shadow:0 2px 0 rgba(0,0,0,.35)">GENG<span style="font-size:34px;letter-spacing:10px;margin:0 34px;vertical-align:middle;color:#b8913f">VS</span>BLG</div>' + RULE(420, 'margin-top:34px');
    el.appendChild(idle);
    const holder = document.createElement('div'); holder.className = 'hs-layer'; holder.style.opacity = '0';
    const ph = document.createElement('div'); ph.id = S.elId; ph.style.cssText = 'position:absolute;inset:0';
    holder.appendChild(ph); el.appendChild(holder);
    // 正在播放卡片（蓋在播放器上方）
    const card = document.createElement('div'); card.className = 'hs-layer hs-card'; card.style.opacity = '0'; card.style.pointerEvents = 'none';
    card.innerHTML = `<div style="font-size:20px;letter-spacing:12px;padding-left:12px;color:#b8913f;margin-bottom:22px">GENG · BLG</div>${RULE(520, 'margin-bottom:30px')}
      <div class="hs-eq">${Array.from({ length: 13 }, (_, i) => `<i style="animation-delay:${(-(i * 0.37) % 1.2).toFixed(2)}s;animation-duration:${(0.9 + (i * 7 % 5) * 0.12).toFixed(2)}s"></i>`).join('')}</div>
      <div style="font-size:18px;letter-spacing:10px;padding-left:10px;color:#c9a24a">NOW PLAYING</div>
      <div class="hs-title" style="max-width:1040px;margin-top:16px;font-size:52px;line-height:1.2;font-weight:600;letter-spacing:3px;color:#fff3d1;text-shadow:0 2px 0 rgba(0,0,0,.35);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      <div class="hs-sub" style="margin-top:14px;font-size:18px;letter-spacing:6px;color:#b8913f"></div>
      ${RULE(520, 'margin-top:30px')}
      <div class="hs-cd" style="margin-top:30px;display:none"><div style="font-size:16px;letter-spacing:9px;color:#c9a24a">MATCH BEGINS IN</div><div class="hs-cd-t" style="margin-top:8px;font-size:58px;font-weight:600;letter-spacing:8px;color:#ecd9a8;animation:hs-glow 2.4s ease-in-out infinite"></div></div>`;
    el.appendChild(card);
    // 「我的螢幕」個人播放時的角標（3D 場景裡只用拉丁字）
    const ptag = document.createElement('div'); ptag.style.cssText = 'position:absolute;left:22px;top:20px;padding:8px 16px 9px;border:1px solid rgba(224,189,106,.6);border-radius:3px;background:rgba(11,7,24,.72);color:#ecd9a8;font:600 17px Cinzel,serif;letter-spacing:5px;opacity:0;transition:opacity .6s;pointer-events:none';
    ptag.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e0bd6a;box-shadow:0 0 8px #e0bd6a;margin-right:12px;vertical-align:2px"></span>PERSONAL VIEW';
    el.appendChild(ptag);
    const banner = document.createElement('div'); banner.className = 'hs-banner'; banner.style.opacity = '0';
    banner.innerHTML = 'MATCH BEGINS IN<b></b>';
    el.appendChild(banner);
    this.el = { idle, holder, card, banner, ptag, title: card.querySelector('.hs-title'), sub: card.querySelector('.hs-sub'), cd: card.querySelector('.hs-cd'), cdT: card.querySelector('.hs-cd-t'), bannerT: banner.querySelector('b') };

    const obj = this.obj = new CSS3DObject(el);
    const nx = Math.sin(S.ry) * 0.01, nz = Math.cos(S.ry) * 0.01;
    obj.position.set(S.x + nx, S.y, S.z + nz); obj.rotation.y = S.ry;
    obj.scale.setScalar(S.w / PX_W);
    this.cssScene.add(obj);

    // WebGL 中的「透明洞」，讓下層的 iframe 透出來，同時保留正確的前後遮擋
    const hole = this.hole = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, side: THREE.FrontSide }));
    hole.position.copy(obj.position); hole.rotation.y = S.ry;
    scene.add(hole);

    this.player = null; this.ready = false; this.state = null; this.media = null; this.offset = 0;
    this.muted = true; this.volume = 100; this.fade = 1; this.fadeTimer = null; this.transId = 0;
    this.reported = {}; // seq -> 已回報片長
    this.onReport = null; // (msg) => 送給伺服器 { t:'dur'|'ended'|'err', seq, id, ... }
    this.personal = null; this.pSeq = 0; // 「我的螢幕」：只在自己瀏覽器播放的影片（本機時鐘）
    this.onPersonalEnd = null; // (reason) => 'match' | 'ended' | 'error' | 'admin'
    this.onSoundChange = null; // 按鈕必須依播放器確認的狀態顯示，不能只反映使用者意圖
    setInterval(() => this.updateCountdown(), 1000);
    this.loadAPI();
  }
  loadAPI() { ytReady().then(() => this.createPlayer()); }
  createPlayer() {
    const v = this.state;
    // API 可能比入場的媒體同步先到；明確傳入 undefined 會讓 YT.Player 直接拋例外。
    // 不在這一區（例如人在城牆區時的殿堂大螢幕）就先不建立播放器，省流量與效能
    if (this.player || !v || !this.active || !window.YT?.Player) return;
    this.player = new YT.Player(this.cfg.elId, {
      width: PX_W, height: PX_H,
      videoId: v.id,
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
      events: {
        onReady: () => {
          this.ready = true; try { this.player.getIframe().style.cssText = `position:absolute;left:0;top:0;width:${Q * 100}%;height:${Q * 100}%;border:0;transform:scale(${1 / Q});transform-origin:0 0`; } catch (_) { }
          // 入場可能早於 iframe 就緒；先靜音播放，之後由聲音按鈕的手勢解鎖。
          this.disableCaptions();
          this.player.mute(); this.applyVolume(); this.apply(true); this.updateSound();
          if (!this.active) { try { this.player.pauseVideo(); } catch (_) { } }
        },
        onApiChange: () => this.disableCaptions(),
        onStateChange: (e) => this.onPlayerState(e.data),
        onError: (e) => { const v = this.state; if (!v) return; if (v.kind === 'personal') { this.endPersonal('error'); return; } this.report({ t: 'err', seq: v.seq, id: v.id, code: e.data }); },
        onAutoplayBlocked: () => { this.player.mute(); this.updateSound(); },
      },
    });
  }
  disableCaptions() {
    // 字幕模組會非同步載入，換片也可能重新啟用；不依賴觀眾的 YouTube 字幕偏好。
    if (!this.ready) return;
    try { this.player.unloadModule('captions'); } catch (_) { }
  }
  report(m) { try { this.onReport && this.onReport(m); } catch (_) { } }
  isSoundOn() {
    try { return this.active && this.ready && !this.muted && !this.player.isMuted() && (this.player.getPlayerState() === 1 || this.state?.playing === false); } catch (_) { return false; }
  }
  updateSound() { this.onSoundChange && this.onSoundChange(this.isSoundOn()); }
  onPlayerState(s) {
    this.updateSound();
    const v = this.state; if (!v || !this.ready) return;
    if (s === 1) this.disableCaptions();
    let cur = ''; try { cur = this.player.getVideoData()?.video_id; } catch (_) { }
    if (cur !== v.id) return;
    if (v.kind === 'personal') { if (s === 0 && !v.live) this.endPersonal('ended'); return; } // 個人播放不回報伺服器
    if (s === 1 && !v.live && !this.reported[v.seq]) {
      // 第一次真的開始播放：回報片長（伺服器取第一個合理的回報，用來判斷何時換下一首）
      let d = 0, title = ''; try { d = this.player.getDuration(); title = this.player.getVideoData()?.title || ''; } catch (_) { }
      if (d > 0) { this.reported[v.seq] = true; this.report({ t: 'dur', seq: v.seq, id: v.id, seconds: d, title }); }
    }
    if (s === 0 && !v.live) this.report({ t: 'ended', seq: v.seq, id: v.id });
    // 暫停但伺服器說在播放（例如瀏覽器擋了自動播放後恢復）：重新套用
    if (s === 2 && v.playing) setTimeout(() => this.apply(true), 500);
  }
  setServerOffset(o) { this.offset = o; }
  // 伺服器的媒體狀態：{ mode, video, music:{ track, position, playing, seq, display… }, countdown, serverTime }
  setMedia(m) {
    this.media = { ...m, receivedAt: performance.now() };
    // 比賽開始（直播或影片）或管理員操作了大螢幕：個人播放結束，切回大家的畫面
    if (this.personal) {
      const ha = m.hallAdmin, kicked = ha && this.pEpoch != null && ha.epoch !== this.pEpoch;
      if (m.mode === 'match' || kicked) { this.personal = null; this.updateOverlay(); this.firePersonalEnd(m.mode === 'match' ? 'match' : 'admin'); }
    }
    if (this.personal) { this.updateOverlay(); return; }
    let want = null;
    if (m.mode === 'match') { const v = m.video; want = { kind: 'match', id: v.id, live: !!v.live, playing: v.playing, position: v.position, seq: v.seq }; }
    else if (m.music && m.music.track) { const mu = m.music; want = { kind: 'music', id: mu.track.id, live: !!mu.track.live, playing: mu.playing, position: mu.position, seq: mu.seq, title: mu.track.title }; }
    const prev = this.state;
    const changed = !prev !== !want || (prev && want && (prev.seq !== want.seq || prev.id !== want.id));
    this.state = want ? { ...want, receivedAt: performance.now() } : null;
    this.updateOverlay();
    if (!this.player) this.createPlayer();
    if (!this.ready) return;
    if (changed) this.transition(); else this.apply(false);
  }
  // ===== 我的螢幕（個人播放）=====
  // 只有在大廳音樂時可以用；p = { id, live, title, start }
  personalAllowed() {
    const m = this.media; if (!m || m.mode !== 'music') return { ok: false, why: 'match' };
    const ha = m.hallAdmin, left = ha ? ha.lockUntil - this.serverNow() : 0;
    if (left > 0) return { ok: false, why: 'admin', left };
    return { ok: true };
  }
  setPersonal(p) {
    if (!this.personalAllowed().ok) return false;
    this.pEpoch = this.media.hallAdmin ? this.media.hallAdmin.epoch : 0;
    this.personal = { id: p.id, live: !!p.live, title: p.title || '' };
    this.state = { kind: 'personal', id: p.id, live: !!p.live, title: p.title || '', playing: true, position: Math.max(0, p.start || 0), seq: 'p' + (++this.pSeq), receivedAt: performance.now() };
    this.updateOverlay();
    if (!this.player) this.createPlayer();
    if (this.ready) this.transition();
    return true;
  }
  personalCtl(action, sec) {
    const v = this.state; if (!v || v.kind !== 'personal') return;
    const t = this.targetTime();
    if (action === 'toggle') { v.playing = !v.playing; v.position = t; }
    else if (action === 'seek') v.position = Math.max(0, sec);
    else if (action === 'skip') v.position = Math.max(0, t + sec);
    v.receivedAt = performance.now();
    this.apply(true);
  }
  personalInfo() {
    const v = this.state; if (!v || v.kind !== 'personal') return null;
    let dur = 0; try { dur = this.ready ? this.player.getDuration() : 0; } catch (_) { }
    return { id: v.id, title: v.title, live: v.live, playing: v.playing, time: v.live ? 0 : this.targetTime(), dur };
  }
  endPersonal(reason = 'user') {
    if (!this.personal) return;
    this.personal = null;
    // 回到大家的畫面：用最後一次的伺服器狀態，加上經過的時間
    const m = this.media;
    if (m && m.mode) {
      const dt = (performance.now() - m.receivedAt) / 1000;
      const adv = (c) => (c && c.playing && !c.live ? { ...c, position: c.position + dt } : c);
      const music = m.music ? { ...m.music, position: m.music.playing && m.music.track && !m.music.track.live ? m.music.position + dt : m.music.position } : m.music;
      const { receivedAt, ...raw } = m;
      this.setMedia({ ...raw, video: adv(m.video), music });
    } else { this.state = null; this.updateOverlay(); }
    this.firePersonalEnd(reason);
  }
  firePersonalEnd(reason) { try { this.onPersonalEnd && this.onPersonalEnd(reason); } catch (_) { } }
  // 觀影館的單一頻道：{ id, live, playing, position, seq, title, gain } 或 null
  setChannel(c) {
    this.media = null;
    const want = c ? { kind: 'theater', id: c.id, live: !!c.live, playing: c.playing, position: c.position, seq: c.seq, title: c.title } : null;
    this.gain = c ? (c.gain ?? 100) : 100;
    const prev = this.state;
    const changed = !prev !== !want || (prev && want && (prev.seq !== want.seq || prev.id !== want.id));
    this.state = want ? { ...want, receivedAt: performance.now() } : null;
    this.updateOverlay();
    if (!this.player) this.createPlayer();
    if (!this.ready || !this.active) { if (this.ready) this.applyVolume(); return; }
    if (changed) this.transition(); else { this.applyVolume(); this.apply(false); }
  }
  // 這一區有沒有人在看：不在時暫停並隱藏 iframe；回來時從伺服器進度接著播
  setActive(on) {
    on = !!on; if (on === this.active) return;
    this.active = on;
    this.obj.visible = on; this.hole.visible = on;
    if (!on) { try { if (this.ready) { this.player.mute(); this.player.pauseVideo(); } } catch (_) { } this.updateSound(); return; }
    if (!this.player) { this.createPlayer(); return; }
    if (this.ready) {
      this.applyVolume();
      if (!this.muted) { try { this.player.unMute(); } catch (_) { } }
      this.apply(true); this.updateSound();
    }
  }
  // 兼容舊格式（只有比賽影片）
  setState(v) { this.setMedia({ mode: 'match', video: v, music: null, countdown: null }); }
  updateOverlay() {
    const m = this.media, v = this.state, E = this.el;
    const showCard = !!(v && v.kind === 'music' && m && m.music && m.music.display === 'card');
    E.ptag.style.opacity = v && v.kind === 'personal' ? '1' : '0';
    E.holder.style.opacity = v && !showCard ? '1' : '0';
    E.card.style.opacity = showCard ? '1' : '0';
    E.idle.style.opacity = v ? '0' : '1';
    if (showCard) {
      const mu = m.music, t = latinOnly(mu.track.title);
      E.title.textContent = t || 'LOBBY MUSIC';
      E.sub.textContent = `TRACK ${String(mu.index + 1).padStart(2, '0')} / ${String(mu.count).padStart(2, '0')}` + (mu.loop === 'one' ? '  ·  REPEAT ONE' : mu.shuffle ? '  ·  SHUFFLE' : '');
      E.card.classList.toggle('paused', !mu.playing);
    }
    this.updateCountdown();
  }
  serverNow() { return Date.now() + this.offset; }
  updateCountdown() {
    const m = this.media, E = this.el; if (!m) { E.cd.style.display = 'none'; E.banner.style.opacity = '0'; return; }
    const cd = m.mode === 'music' && m.countdown ? m.countdown : null;
    const left = cd ? cd.at - this.serverNow() : 0;
    const txt = cd ? (left > 0 ? fmtCountdown(left) : 'NOW') : '';
    const inCard = !!cd && E.card.style.opacity === '1';
    E.cd.style.display = inCard ? '' : 'none'; E.cdT.textContent = txt;
    E.banner.style.opacity = cd && !inCard ? '1' : '0'; E.bannerT.textContent = txt;
  }
  targetTime() {
    const v = this.state; if (!v) return 0;
    if (!v.playing) return v.position;
    return v.position + (performance.now() - v.receivedAt) / 1000;
  }
  // 換曲／換模式：淡出 → 換片 → 淡入
  transition() {
    const id = ++this.transId;
    const audible = !this.muted && this.fade > 0.05 && this.ready && this.player.getPlayerState?.() === 1;
    const go = () => { if (id !== this.transId) return; this.fade = 0; this.applyVolume(); this.apply(true); this.fadeTo(1, 1100); };
    if (audible) this.fadeTo(0, 1000, go); else go();
  }
  fadeTo(target, ms, done) {
    clearInterval(this.fadeTimer);
    const from = this.fade, t0 = performance.now();
    this.fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.fade = from + (target - from) * k; this.applyVolume();
      if (k >= 1) { clearInterval(this.fadeTimer); this.fadeTimer = null; done && done(); }
    }, 50);
  }
  // 實際音量 = 區域音量 × 淡入淡出；靜音開關獨立
  applyVolume() {
    if (!this.ready) return;
    const v = Math.round(this.volume * this.fade * (this.gain ?? 100) / 100);
    // 淡入與分區音量更新不可在手勢之外解除靜音。
    try { this.player.setVolume(v); if (this.muted) this.player.mute(); } catch (_) { }
  }
  apply(force) {
    const v = this.state; if (!this.ready || !this.active) return;
    const p = this.player;
    if (!v) { try { if (p.getPlayerState() === 1) p.pauseVideo(); } catch (_) { } return; }
    let cur = '';
    try { cur = p.getVideoData()?.video_id; } catch (_) { }
    if (cur !== v.id) {
      if (v.live) p.loadVideoById({ videoId: v.id });
      else p.loadVideoById({ videoId: v.id, startSeconds: this.targetTime() });
      if (!v.playing) setTimeout(() => p.pauseVideo(), 800);
      return;
    }
    if (v.live) { if (p.getPlayerState() !== 1) p.playVideo(); return; }
    const t = this.targetTime(); const now = p.getCurrentTime();
    if (force || Math.abs(now - t) > 2) p.seekTo(t, true);
    if (v.playing && p.getPlayerState() !== 1) p.playVideo();
    if (!v.playing && p.getPlayerState() === 1) p.pauseVideo();
  }
  tick() { if (this.ready && this.active) { this.disableCaptions(); this.apply(false); this.updateSound(); } }
  setSound(on) {
    this.muted = !on; this.applyVolume();
    if (on && this.ready && this.active) {
      // 直接在 click／keydown 手勢內呼叫，不能延到同步 tick 或淡入計時器。
      this.player.unMute();
      if (this.state?.playing) this.player.playVideo();
    }
    this.updateSound();
    // API 的靜音快取要等 iframe 回覆，已在播放時不一定再發 state change。
    setTimeout(() => this.updateSound(), 250);
  }
  setVolume(v) { v = Math.round(v); if (v === this.volume) return; this.volume = v; if (!this.fadeTimer) this.applyVolume(); }
  render(camera) { this.layer.render(camera); }
  setSize(w, h) { this.layer.setSize(w, h); }
}
