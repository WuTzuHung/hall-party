// 大螢幕：用 CSS3DRenderer 把 YouTube iframe 放進 3D 空間，並與伺服器同步播放進度
// 大廳音樂／比賽兩種模式共用同一個播放器：換曲或換模式時先把音量淡出、換片、再淡入（約 2 秒）
// 音樂模式可顯示「正在播放」卡片：播放器仍以原尺寸在卡片下方播放（不能 display:none，否則 YouTube 可能停播）
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { SCREEN } from './world.js';

const PX_W = 1280, PX_H = 720;
const RULE = (w, m) => `<div style="width:${w}px;height:1px;background:linear-gradient(90deg,transparent,#c9a24a,transparent);${m}"></div>`;
// 3D 場景裡不放中文：標題含中日韓文字時改顯示曲目編號
const latinOnly = (s) => (s && !/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(s) ? s : '');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return (d ? d + 'D ' : '') + (d || h ? p(h) + ':' : '') + p(m) + ':' + p(x);
}

export class BigScreen {
  constructor(scene, container) {
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.domElement.id = 'css3d';
    container.prepend(this.cssRenderer.domElement);
    this.cssScene = new THREE.Scene();

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
    idle.innerHTML = RULE(420, 'margin-bottom:34px') + '<div style="font-size:84px;font-weight:600;letter-spacing:28px;padding-left:28px;color:#ecd9a8;text-shadow:0 2px 0 rgba(0,0,0,.35)">GENG<span style="font-size:34px;letter-spacing:10px;margin:0 34px;vertical-align:middle;color:#b8913f">VS</span>BLG</div>' + RULE(420, 'margin-top:34px');
    el.appendChild(idle);
    const holder = document.createElement('div'); holder.className = 'hs-layer'; holder.style.opacity = '0';
    const ph = document.createElement('div'); ph.id = 'yt-player'; ph.style.cssText = 'position:absolute;inset:0';
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
    const banner = document.createElement('div'); banner.className = 'hs-banner'; banner.style.opacity = '0';
    banner.innerHTML = 'MATCH BEGINS IN<b></b>';
    el.appendChild(banner);
    this.el = { idle, holder, card, banner, title: card.querySelector('.hs-title'), sub: card.querySelector('.hs-sub'), cd: card.querySelector('.hs-cd'), cdT: card.querySelector('.hs-cd-t'), bannerT: banner.querySelector('b') };

    const obj = new CSS3DObject(el);
    obj.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.01);
    obj.scale.setScalar(SCREEN.w / PX_W);
    this.cssScene.add(obj);

    // WebGL 中的「透明洞」，讓下層的 iframe 透出來，同時保留正確的前後遮擋
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, side: THREE.FrontSide }));
    hole.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.01);
    scene.add(hole);

    this.player = null; this.ready = false; this.state = null; this.media = null; this.offset = 0;
    this.muted = true; this.volume = 100; this.fade = 1; this.fadeTimer = null; this.transId = 0;
    this.reported = {}; // seq -> 已回報片長
    this.onReport = null; // (msg) => 送給伺服器 { t:'dur'|'ended'|'err', seq, id, ... }
    this.onSoundChange = null; // 按鈕必須依播放器確認的狀態顯示，不能只反映使用者意圖
    setInterval(() => this.updateCountdown(), 1000);
    this.loadAPI();
  }
  loadAPI() {
    window.onYouTubeIframeAPIReady = () => this.createPlayer();
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }
  createPlayer() {
    const v = this.state;
    // API 可能比入場的媒體同步先到；明確傳入 undefined 會讓 YT.Player 直接拋例外。
    if (this.player || !v || !window.YT?.Player) return;
    this.player = new YT.Player('yt-player', {
      width: PX_W, height: PX_H,
      videoId: v.id,
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
      events: {
        onReady: () => {
          this.ready = true; try { this.player.getIframe().style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0'; } catch (_) { }
          // 入場可能早於 iframe 就緒；先靜音播放，之後由聲音按鈕的手勢解鎖。
          this.player.mute(); this.applyVolume(); this.apply(true); this.updateSound();
        },
        onStateChange: (e) => this.onPlayerState(e.data),
        onError: (e) => { const v = this.state; if (v) this.report({ t: 'err', seq: v.seq, id: v.id, code: e.data }); },
        onAutoplayBlocked: () => { this.player.mute(); this.updateSound(); },
      },
    });
  }
  report(m) { try { this.onReport && this.onReport(m); } catch (_) { } }
  isSoundOn() {
    try { return this.ready && !this.muted && !this.player.isMuted() && (this.player.getPlayerState() === 1 || this.state?.playing === false); } catch (_) { return false; }
  }
  updateSound() { this.onSoundChange && this.onSoundChange(this.isSoundOn()); }
  onPlayerState(s) {
    this.updateSound();
    const v = this.state; if (!v || !this.ready) return;
    let cur = ''; try { cur = this.player.getVideoData()?.video_id; } catch (_) { }
    if (cur !== v.id) return;
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
  // 兼容舊格式（只有比賽影片）
  setState(v) { this.setMedia({ mode: 'match', video: v, music: null, countdown: null }); }
  updateOverlay() {
    const m = this.media, v = this.state, E = this.el;
    const showCard = !!(v && v.kind === 'music' && m.music.display === 'card');
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
    const m = this.media, E = this.el; if (!m) return;
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
    const v = Math.round(this.volume * this.fade);
    // 淡入與分區音量更新不可在手勢之外解除靜音。
    try { this.player.setVolume(v); if (this.muted) this.player.mute(); } catch (_) { }
  }
  apply(force) {
    const v = this.state; if (!this.ready) return;
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
  tick() { if (this.ready) { this.apply(false); this.updateSound(); } }
  setSound(on) {
    this.muted = !on; this.applyVolume();
    if (on && this.ready) {
      // 直接在 click／keydown 手勢內呼叫，不能延到同步 tick 或淡入計時器。
      this.player.unMute();
      if (this.state?.playing) this.player.playVideo();
    }
    this.updateSound();
    // API 的靜音快取要等 iframe 回覆，已在播放時不一定再發 state change。
    setTimeout(() => this.updateSound(), 250);
  }
  setVolume(v) { v = Math.round(v); if (v === this.volume) return; this.volume = v; if (!this.fadeTimer) this.applyVolume(); }
  render(camera) { this.cssRenderer.render(this.cssScene, camera); }
  setSize(w, h) { this.cssRenderer.setSize(w, h); }
}
