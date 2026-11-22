// 殿堂內的管理員控制台：有保存管理密碼（localStorage 或 sessionStorage 的 hall-admin）且 /api/admin/state 驗證成功才顯示
// 密碼只會放在 Authorization 標頭送到同源的 /api/admin/*，不會送到其他地方
const $ = (s) => document.querySelector(s);
const KEY = 'hall-admin';
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>';
function storedPw() {
  try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ''; } catch (_) { return ''; }
}

export function initAdminDock({ toast, onFocus, isTouch }) {
  const dock = $('#admin-dock'), panel = $('#ad-panel');
  let pw = '', media = null, active = false, open = false, lights = true, wall = false, thAt = 0;
  async function api(path, body) {
    const r = await fetch('/api/admin/' + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Authorization': 'Bearer ' + pw, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || String(r.status)); e.status = r.status; throw e; }
    return j;
  }
  const msg = (t, ok = true) => { const m = $('#ad-msg'); m.textContent = t; m.className = ok ? 'ok' : 'bad'; clearTimeout(msg.t); msg.t = setTimeout(() => { m.textContent = ''; }, 4000); };
  function setOpen(o) {
    open = o; dock.classList.toggle('open', o);
    try { localStorage.setItem('hall-dock-open', o ? '1' : '0'); } catch (_) { }
  }
  async function check() {
    pw = storedPw();
    if (!pw) { hide(); return false; }
    try { const st = await api('state'); show(); render(st); return true; } catch (e) { if (e.status === 401) hide(); return false; }
  }
  function show() {
    if (active) return; active = true;
    dock.classList.remove('hidden'); document.body.classList.add('has-dock');
    let o = null; try { o = localStorage.getItem('hall-dock-open'); } catch (_) { }
    setOpen(o == null ? !isTouch : o === '1');
    $('#ad-login-row').classList.add('hidden'); $('#ad-logged').classList.remove('hidden');
  }
  function hide() {
    active = false; dock.classList.add('hidden'); document.body.classList.remove('has-dock');
    $('#ad-login-row').classList.remove('hidden'); $('#ad-logged').classList.add('hidden');
  }
  function render(st) {
    const m = st.mode ? { mode: st.mode, video: st.video, music: st.music, countdown: st.countdown, theater: st.theater } : st;
    if (m && m.mode) setMedia(m);
    if (typeof st.lights === 'boolean') setLights(st.lights);
  }
  // 室內燈按鈕：燈開著時顯示「關燈」（亮金色），關著時顯示「開燈」（暗色）
  function setLights(on) {
    lights = !!on; const b = $('#ad-lights'); if (!b) return;
    b.textContent = lights ? '💡 關燈' : '💡 開燈'; b.classList.toggle('off', !lights);
    b.setAttribute('aria-pressed', String(lights)); b.title = '室內燈：' + (lights ? '開' : '關');
  }
  function setMedia(m) {
    media = m; if (!active) return;
    thAt = performance.now(); renderTheater();
    const isMusic = m.mode === 'music';
    const label = isMusic ? '音樂' : '比賽';
    if (!wall) { $('#ad-mode').textContent = label; $('#ad-mode-mini').textContent = label; }
    dock.classList.toggle('match', !isMusic && !wall);
    let playing = false, title = '';
    if (isMusic) {
      const t = m.music && m.music.track; playing = !!(t && m.music.playing);
      title = t ? `${m.music.index + 1}/${m.music.count} · ${t.title || t.id}` : '歌單是空的（待機畫面）';
    } else { playing = !!m.video.playing; title = (m.video.live ? '直播 · ' : '') + (m.video.title || m.video.id); }
    $('#ad-now').textContent = title;
    $('#ad-play').innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    $('#ad-play').setAttribute('aria-label', playing ? '暫停' : '播放');
    $('#ad-next').disabled = !isMusic || !(m.music && m.music.count);
    $('#ad-music').disabled = isMusic && !!(m.music && m.music.track);
    const live = !isMusic && m.video.live;
    $('#ad-back').disabled = live; $('#ad-fwd').disabled = live;
  }
  // ===== 觀影館（人在城牆區時）：螢幕 I、II =====
  // 依所在建築切換控制台內容：殿堂是一台大螢幕＋音樂＋燈光；觀影館是 I、II 兩台
  function setZone(w) {
    w = !!w; if (w === wall) return; wall = w;
    dock.classList.toggle('wall', w);
    $('#ad-hall').classList.toggle('hidden', w); $('#ad-th').classList.toggle('hidden', !w);
    $('#ad-title').textContent = w ? '同時視聽控制' : '直播控制';
    $('#ad-panel').setAttribute('aria-label', w ? '城牆觀影館控制' : '大螢幕控制');
    if (w) { $('#ad-mode').textContent = 'I + II'; $('#ad-mode-mini').textContent = '同時視聽'; dock.classList.remove('match'); renderTheater(); }
    else if (media) setMedia(media);
  }
  const thCh = (k) => (media && media.theater && media.theater[k]) || null;
  const thPos = (c) => (!c || c.live ? 0 : c.position + (c.playing ? (performance.now() - thAt) / 1000 : 0));
  const clock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  function renderTheater() {
    if (!active || !wall) return;
    let anyPlaying = false, any = false;
    for (const k of ['a', 'b']) {
      const c = thCh(k), row = $(`.ad-ch[data-k="${k}"]`), btn = row.querySelector('.ad-cp');
      row.classList.toggle('empty', !c);
      row.querySelector('.ad-ct').textContent = c ? (c.title || c.id) : '尚未設定';
      row.querySelector('.ad-cs').textContent = !c ? '' : c.live ? '直播' : clock(thPos(c));
      btn.disabled = !c; btn.innerHTML = c && c.playing ? ICON_PAUSE : ICON_PLAY;
      btn.setAttribute('aria-label', (k === 'a' ? 'I ' : 'II ') + (c && c.playing ? '暫停' : '播放'));
      if (c) { any = true; if (c.playing) anyPlaying = true; }
    }
    const a = thCh('a'), b = thCh('b'), d = $('#ad-delta');
    if (a && b && !a.live && !b.live) {
      const x = thPos(b) - thPos(a);
      d.textContent = 'II − I：' + (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + ' 秒'; d.classList.toggle('warn', Math.abs(x) > 2);
    } else { d.textContent = a && b ? '其中一台是直播，不需對齊進度' : '兩台都設定後，這裡會顯示進度差'; d.classList.remove('warn'); }
    $('#ad-tboth').textContent = anyPlaying ? '同時暫停' : '同時播放'; $('#ad-tboth').disabled = !any;
    $('#ad-trestart').disabled = !any;
    const vod = !!(b && !b.live); $('#ad-tbm').disabled = !vod; $('#ad-tbp').disabled = !vod;
  }
  setInterval(() => { if (open && wall) renderTheater(); }, 500);
  const thKey = () => (document.querySelector('input[name="ad-tk"]:checked') || {}).value || 'a';
  const thName = (k) => (k === 'a' ? 'I' : 'II');
  async function act(fn, ok) {
    try { const st = await fn(); render(st); if (ok) msg(ok); }
    catch (e) { msg('失敗：' + e.message, false); if (e.status === 401) hide(); }
  }
  const playing = () => {
    if (!media) return false;
    return media.mode === 'music' ? !!(media.music && media.music.playing) : !!media.video.playing;
  };
  $('#ad-toggle').addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  $('#ad-close').addEventListener('click', (e) => { e.stopPropagation(); setOpen(false); });
  $('#ad-play').addEventListener('click', () => act(() => api('control', { action: playing() ? 'pause' : 'play' })));
  $('#ad-back').addEventListener('click', () => act(() => api('control', { action: 'skip', seconds: -10 }), '−10 秒'));
  $('#ad-fwd').addEventListener('click', () => act(() => api('control', { action: 'skip', seconds: 10 }), '+10 秒'));
  $('#ad-next').addEventListener('click', () => act(() => api('music', { action: 'next' }), '下一首'));
  $('#ad-music').addEventListener('click', () => act(() => api('mode', { mode: 'music' }), '已回到大廳音樂'));
  $('#ad-lights').addEventListener('click', () => { const on = !lights; act(() => api('lights', { on }), on ? '室內燈已開' : '室內燈已關'); });
  for (const b of document.querySelectorAll('.ad-cp')) b.addEventListener('click', () => {
    const k = b.dataset.k, c = thCh(k); if (!c) return;
    act(() => api('theater', { screen: k, action: c.playing ? 'pause' : 'play' }), `${thName(k)} 已${c.playing ? '暫停' : '播放'}`);
  });
  $('#ad-tboth').addEventListener('click', () => {
    const p = ['a', 'b'].some((k) => thCh(k) && thCh(k).playing);
    act(() => api('theater', { screen: 'both', action: p ? 'pause' : 'play' }), p ? '兩台已同時暫停' : '兩台已同時播放');
  });
  $('#ad-trestart').addEventListener('click', () => act(() => api('theater', { screen: 'both', action: 'restart' }), '兩台已從頭開始'));
  $('#ad-tbm').addEventListener('click', () => act(() => api('theater', { screen: 'b', action: 'skip', seconds: -0.5 }), 'II −0.5 秒'));
  $('#ad-tbp').addEventListener('click', () => act(() => api('theater', { screen: 'b', action: 'skip', seconds: 0.5 }), 'II +0.5 秒'));
  for (const r of document.querySelectorAll('input[name="ad-tk"]')) r.addEventListener('change', () => { $('#ad-tgo').textContent = '播到 ' + thName(thKey()); });
  $('#ad-turl').addEventListener('input', () => { if (/\/live\//.test($('#ad-turl').value)) $('#ad-tlive').checked = true; });
  $('#ad-tform').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#ad-turl').value.trim(); if (!url) return;
    const k = thKey();
    act(async () => { const r = await api('theater', { screen: k, action: 'set', url, live: $('#ad-tlive').checked }); $('#ad-turl').value = ''; $('#ad-turl').blur(); return r; }, `已播到螢幕 ${thName(k)}`);
  });
  $('#ad-url').addEventListener('input', () => { if (/\/live\//.test($('#ad-url').value)) $('#ad-live').checked = true; });
  $('#ad-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#ad-url').value.trim(); if (!url) return;
    act(async () => { const r = await api('video', { url, live: $('#ad-live').checked }); $('#ad-url').value = ''; $('#ad-url').blur(); return r; }, '已播到大螢幕');
  });
  // 在控制台裡打字時，不要觸發移動、跳躍、坐下、聊天等快捷鍵（與聊天框相同做法）
  for (const el of [dock, $('#ad-login')]) {
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && e.target.blur) e.target.blur(); });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('focusin', () => onFocus && onFocus());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // 說明面板裡的「管理員登入」
  $('#btn-admin-login').addEventListener('click', () => { $('#ad-login').classList.toggle('hidden'); $('#ad-pw').focus(); });
  $('#ad-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#ad-pw').value; if (!v) return;
    pw = v;
    try {
      const st = await api('state');
      try { sessionStorage.setItem(KEY, v); } catch (_) { }
      $('#ad-pw').value = ''; $('#ad-login').classList.add('hidden');
      show(); render(st); setOpen(true);
      $('#help').classList.add('hidden');
      toast && toast(wall ? '已登入管理員 · 右下角是同時視聽控制台' : '已登入管理員 · 右下角是直播控制台');
    } catch (err) { pw = ''; $('#ad-login-msg').textContent = err.status === 401 ? '密碼錯誤' : '無法連線'; }
  });
  $('#btn-admin-logout').addEventListener('click', () => {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (_) { }
    pw = ''; hide(); toast && toast('已登出管理員');
  });

  check();
  return { setMedia, setLights, setZone, check, get active() { return active; } };
}
