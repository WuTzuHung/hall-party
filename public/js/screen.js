// 大螢幕：用 CSS3DRenderer 把 YouTube iframe 放進 3D 空間，並與伺服器同步播放進度
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { SCREEN } from './world.js';

const PX_W = 1280, PX_H = 720;

export class BigScreen {
  constructor(scene, container) {
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.domElement.id = 'css3d';
    container.prepend(this.cssRenderer.domElement);
    this.cssScene = new THREE.Scene();

    const el = document.createElement('div');
    el.style.cssText = `width:${PX_W}px;height:${PX_H}px;background:#000;overflow:hidden;`;
    const idle = document.createElement('div');
    idle.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,#3a1f66,#0b0718 70%);color:#f3e6c4;font-family:Cinzel,serif;text-align:center';
    idle.innerHTML = '<div style="width:420px;height:1px;background:linear-gradient(90deg,transparent,#c9a24a,transparent);margin-bottom:34px"></div><div style="font-size:84px;font-weight:600;letter-spacing:28px;padding-left:28px;color:#ecd9a8;text-shadow:0 2px 0 rgba(0,0,0,.35)">GEN.G<span style="font-size:34px;letter-spacing:10px;margin:0 34px;vertical-align:middle;color:#b8913f">VS</span>BLG</div><div style="width:420px;height:1px;background:linear-gradient(90deg,transparent,#c9a24a,transparent);margin-top:34px"></div>';
    el.style.position = 'relative'; el.appendChild(idle);
    const holder = document.createElement('div'); holder.id = 'yt-player'; holder.style.cssText = 'position:absolute;inset:0';
    el.appendChild(holder);
    const obj = new CSS3DObject(el);
    obj.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.01);
    obj.scale.setScalar(SCREEN.w / PX_W);
    this.cssScene.add(obj);

    // WebGL 中的「透明洞」，讓下層的 iframe 透出來，同時保留正確的前後遮擋
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, side: THREE.FrontSide }));
    hole.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.01);
    scene.add(hole);

    this.player = null; this.ready = false; this.state = null; this.offset = 0;
    this.muted = true; this.volume = 100;
    this.loadAPI();
  }
  loadAPI() {
    window.onYouTubeIframeAPIReady = () => this.createPlayer();
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }
  createPlayer() {
    const v = this.state;
    this.player = new YT.Player('yt-player', {
      width: PX_W, height: PX_H,
      videoId: v ? v.id : undefined,
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
      events: {
        onReady: () => { this.ready = true; try { this.player.getIframe().style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0'; } catch (_) { } this.player.mute(); this.apply(true); },
        onStateChange: (e) => {
          // 影片結束：非直播就停在最後
          if (e.data === YT.PlayerState.PAUSED && this.state && this.state.playing) setTimeout(() => this.apply(true), 500);
        },
      },
    });
  }
  setServerOffset(o) { this.offset = o; }
  setState(v) {
    const changed = !this.state || this.state.id !== v.id;
    this.state = { ...v, receivedAt: performance.now() };
    if (this.ready) this.apply(changed);
  }
  targetTime() {
    const v = this.state; if (!v) return 0;
    if (!v.playing) return v.position;
    return v.position + (performance.now() - v.receivedAt) / 1000;
  }
  apply(force) {
    const v = this.state; if (!v || !this.ready) return;
    const p = this.player;
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
  tick() { if (this.ready && this.state) this.apply(false); }
  setSound(on) {
    this.muted = !on; if (!this.ready) return;
    if (on) { this.player.unMute(); this.player.setVolume(this.volume); } else this.player.mute();
  }
  setVolume(v) { v = Math.round(v); if (v === this.volume) return; this.volume = v; if (this.ready && !this.muted) this.player.setVolume(v); }
  render(camera) { this.cssRenderer.render(this.cssScene, camera); }
  setSize(w, h) { this.cssRenderer.setSize(w, h); }
}
