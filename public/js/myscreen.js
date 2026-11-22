// 「我的螢幕」：觀眾在光之殿堂把大螢幕暫時換成只有自己看得到的影片
// 規則：只在殿堂、大螢幕放大廳音樂時可用；管理員操作直播後台或比賽開始時自動結束並鎖住一段時間（由 screen.js 判斷）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>';
const ICON_TV = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 20h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function ago(t) {
  if (!t) return '';
  const d = (Date.now() - t) / 1000;
  if (d < 3600) return Math.max(1, Math.floor(d / 60)) + ' 分鐘前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小時前';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
  const x = new Date(t); return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
}
function parseYT(input) {
  input = String(input || '').trim();
  if (/^[\w-]{11}$/.test(input)) return { id: input, start: 0, live: false };
  let u; try { u = new URL(input); } catch (_) { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (host.endsWith('youtube.com')) id = u.searchParams.get('v') || (u.pathname.match(/\/(embed|live|shorts|v)\/([\w-]{11})/) || [])[2];
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const t = u.searchParams.get('t') || '0', hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = /^\d+$/.test(t) ? Number(t) : hms ? (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0) : 0;
  return { id, start, live: /\/live\//.test(u.pathname) };
}

export function initMyScreen({ screen, toast, isTouch, onFocus, wantSound, inHall }) {
  const hudRight = document.querySelector('.hud-right'), help = document.querySelector('#btn-help');
  // HUD 按鈕
  const btn = document.createElement('button');
  btn.className = 'pill btn'; btn.id = 'btn-my'; btn.type = 'button';
  btn.innerHTML = `${ICON_TV}<span class="my-l">我的螢幕</span>`;
  hudRight.insertBefore(btn, help);
  // 播放中的小膠囊（面板收起時）
  const bar = document.createElement('div'); bar.id = 'my-bar'; bar.className = 'hidden';
  bar.innerHTML = `<span class="my-dot" aria-hidden="true"></span><span class="my-bk">只有你看得到</span><span class="my-bt"></span>
    <button type="button" class="my-bp" aria-label="播放／暫停"></button><button type="button" class="my-bo">選片</button><button type="button" class="my-bx">回到大廳音樂</button>`;
  // 面板
  const panel = document.createElement('aside'); panel.id = 'my-panel'; panel.className = 'hidden'; panel.setAttribute('aria-label', '我的螢幕');
  panel.innerHTML = `
    <header class="my-head">
      <div><div class="my-kicker">MY SCREEN</div><h2>我的螢幕</h2><div class="my-sub">只有你看得到，其他人照常看大螢幕</div></div>
      <button type="button" class="my-close" aria-label="關閉">✕</button>
    </header>
    <nav class="my-tabs" role="tablist" aria-label="頻道"></nav>
    <div class="my-body">
      <div class="my-lock hidden" role="status"></div>
      <div class="my-grid" role="list"></div>
      <form class="my-url hidden" autocomplete="off">
        <label for="my-url-in">貼上 YouTube 影片或直播網址</label>
        <input id="my-url-in" type="text" placeholder="https://www.youtube.com/watch?v=… 或 youtu.be/…" spellcheck="false" enterkeyhint="go">
        <button type="submit" class="my-go">在我的螢幕播放</button>
        <p>直播網址（/live/）會自動以直播方式播放。</p>
      </form>
    </div>
    <footer class="my-now hidden">
      <div class="my-now-t"><span class="my-dot" aria-hidden="true"></span><span class="my-nt"></span></div>
      <div class="my-prog"><span class="my-cur">0:00</span><input type="range" class="my-seek" min="0" max="1000" value="0" aria-label="播放進度"><span class="my-dur">0:00</span></div>
      <div class="my-ctl">
        <button type="button" data-skip="-10">−10 秒</button>
        <button type="button" class="my-pp" aria-label="播放／暫停"></button>
        <button type="button" data-skip="10">+10 秒</button>
        <button type="button" class="my-back">回到大廳音樂</button>
      </div>
    </footer>`;
  const hud = document.querySelector('#hud'); hud.append(bar, panel);
  const $ = (s) => panel.querySelector(s);
  let open = false, data = null, loadedAt = 0, loading = false, tab = null, seeking = false;

  function setOpen(o) {
    open = o; panel.classList.toggle('hidden', !o); document.body.classList.toggle('my-open', o);
    btn.setAttribute('aria-expanded', String(o));
    if (o) { onFocus && onFocus(); if (data) renderGrid(); load(); }
    refresh();
  }
  async function load(force) {
    if (loading || (!force && data && Date.now() - loadedAt < 120000)) { renderTabs(); return; }
    loading = true; if (!data) $('.my-grid').innerHTML = '<div class="my-empty">正在載入頻道影片…</div>';
    try {
      const r = await fetch('/api/channels', { cache: 'no-store' }); const j = await r.json();
      data = j.channels || []; loadedAt = Date.now();
    } catch (_) { if (!data) data = []; }
    loading = false;
    if (tab == null || (tab !== 'url' && !data.some((c) => c.key === tab))) tab = data[0] ? data[0].key : 'url';
    renderTabs(); renderGrid();
  }
  function renderTabs() {
    const nav = $('.my-tabs'); nav.replaceChildren();
    for (const c of data || []) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.k = c.key;
      const live = c.videos && c.videos[0] && c.videos[0].live;
      b.innerHTML = `${live ? '<i class="my-live-dot" aria-label="直播中"></i>' : ''}<span>${esc(c.name)}</span>${c.tag ? `<small>${esc(c.tag)}</small>` : ''}`;
      b.setAttribute('aria-selected', String(tab === c.key));
      b.onclick = () => { tab = c.key; renderTabs(); renderGrid(); };
      nav.append(b);
    }
    const u = document.createElement('button'); u.type = 'button'; u.setAttribute('role', 'tab'); u.innerHTML = '<span>貼網址</span>';
    u.setAttribute('aria-selected', String(tab === 'url')); u.onclick = () => { tab = 'url'; renderTabs(); renderGrid(); };
    nav.append(u);
  }
  function renderGrid() {
    const grid = $('.my-grid'), form = $('.my-url');
    form.classList.toggle('hidden', tab !== 'url'); grid.classList.toggle('hidden', tab === 'url');
    if (tab === 'url') return;
    const c = (data || []).find((x) => x.key === tab);
    grid.replaceChildren();
    if (!c) return;
    if (!c.videos.length) { grid.innerHTML = `<div class="my-empty">${esc(c.error || '這個頻道目前沒有影片')}</div>`; return; }
    const cur = screen.personalInfo();
    for (const v of c.videos) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'my-card' + (cur && cur.id === v.id ? ' on' : ''); b.setAttribute('role', 'listitem');
      b.innerHTML = `<span class="my-th"><img loading="lazy" alt="" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg">${v.live ? '<b class="my-live">LIVE</b>' : ''}${cur && cur.id === v.id ? '<b class="my-playing">播放中</b>' : ''}</span>
        <span class="my-ct">${esc(v.title || v.id)}</span><span class="my-cm">${v.live ? '正在直播' : ago(v.published)}</span>`;
      b.onclick = () => play({ id: v.id, live: !!v.live, title: v.title });
      grid.append(b);
    }
  }
  function play(p) {
    const a = screen.personalAllowed();
    if (!a.ok) { refresh(); toast(a.why === 'match' ? '比賽進行中，結束後才能用我的螢幕' : '管理員正在操作大螢幕，請稍候'); return; }
    wantSound && wantSound(); // 在點擊手勢內打開聲音
    if (screen.setPersonal(p)) { toast('在你的螢幕播放 · 只有你看得到'); if (isTouch) setOpen(false); }
    renderGrid(); refresh();
  }
  $('.my-url').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = parseYT($('#my-url-in').value);
    if (!p) { toast('無法辨識的 YouTube 網址'); return; }
    $('#my-url-in').value = ''; $('#my-url-in').blur();
    play({ ...p, title: '' });
  });
  const end = () => { screen.endPersonal('user'); };
  $('.my-back').onclick = end; bar.querySelector('.my-bx').onclick = end;
  $('.my-pp').onclick = () => { screen.personalCtl('toggle'); refresh(); };
  bar.querySelector('.my-bp').onclick = () => { screen.personalCtl('toggle'); refresh(); };
  bar.querySelector('.my-bo').onclick = () => setOpen(true);
  for (const b of panel.querySelectorAll('[data-skip]')) b.onclick = () => { screen.personalCtl('skip', Number(b.dataset.skip)); refresh(); };
  const seek = $('.my-seek');
  seek.addEventListener('input', () => { seeking = true; const i = screen.personalInfo(); if (i && i.dur) $('.my-cur').textContent = clock(seek.value / 1000 * i.dur); });
  seek.addEventListener('change', () => { const i = screen.personalInfo(); if (i && i.dur) screen.personalCtl('seek', seek.value / 1000 * i.dur); seeking = false; refresh(); });
  btn.addEventListener('click', () => setOpen(!open));
  $('.my-close').onclick = () => setOpen(false);
  // 面板裡打字或點擊時，不要觸發走路、聊天等快捷鍵
  for (const el of [panel, bar]) {
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { if (e.target.blur) e.target.blur(); setOpen(false); } });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('focusin', () => onFocus && onFocus());
  }

  // 依狀態更新按鈕、鎖定提示與播放列
  function refresh() {
    const here = inHall(), a = screen.personalAllowed(), info = screen.personalInfo();
    btn.classList.toggle('hidden', !here);
    btn.classList.toggle('locked', !a.ok && !info); btn.classList.toggle('on', !!info);
    const lockText = a.why === 'match' ? '比賽進行中' : a.why === 'admin' ? `管理員操作中 ${clock((a.left || 0) / 1000)}` : '';
    btn.querySelector('.my-l').textContent = info ? '我的螢幕 · 播放中' : a.ok ? '我的螢幕' : lockText;
    btn.title = a.ok || info ? '選一支影片在大螢幕播放，只有你看得到' : (a.why === 'match' ? '比賽或影片播放中，回到大廳音樂後才能用' : '管理員正在操作大螢幕，倒數結束後可以用');
    if (!here && open) setOpen(false);
    const lock = $('.my-lock');
    lock.classList.toggle('hidden', a.ok || !!info);
    if (!a.ok) lock.innerHTML = a.why === 'match'
      ? '<b>比賽進行中</b><span>大螢幕正在播放直播或比賽影片，回到大廳音樂後就能用我的螢幕。</span>'
      : `<b>管理員正在操作大螢幕</b><span>為了避免衝突，暫停使用 <em>${clock((a.left || 0) / 1000)}</em>，管理員繼續操作會再延長。</span>`;
    panel.classList.toggle('locked', !a.ok && !info);
    const now = $('.my-now');
    now.classList.toggle('hidden', !info);
    bar.classList.toggle('hidden', !info || open || !here);
    if (info) {
      const t = info.title || 'YouTube 影片';
      $('.my-nt').textContent = t; bar.querySelector('.my-bt').textContent = t;
      for (const b of [$('.my-pp'), bar.querySelector('.my-bp')]) { b.innerHTML = info.playing ? ICON_PAUSE : ICON_PLAY; b.setAttribute('aria-label', info.playing ? '暫停' : '播放'); }
      const vod = !info.live && info.dur > 0;
      $('.my-prog').classList.toggle('live', !vod);
      for (const b of panel.querySelectorAll('[data-skip]')) b.disabled = info.live;
      if (vod) {
        if (!seeking) { seek.value = Math.round(Math.min(1, info.time / info.dur) * 1000); $('.my-cur').textContent = clock(info.time); }
        $('.my-dur').textContent = clock(info.dur);
      } else { $('.my-cur').textContent = info.live ? 'LIVE' : clock(info.time); $('.my-dur').textContent = info.live ? '' : '--:--'; }
    }
  }
  setInterval(refresh, 500);

  const REASONS = {
    match: '比賽開始了，已切回直播',
    admin: '管理員正在操作大螢幕，已切回大家的畫面',
    ended: '影片播完了，回到大廳音樂',
    error: '這支影片不能在外部播放，已回到大廳音樂',
    zone: '離開殿堂，我的螢幕已結束',
  };
  screen.onPersonalEnd = (reason) => { if (REASONS[reason]) toast(REASONS[reason], 3600); renderGrid(); refresh(); };
  return { refresh, setOpen, get open() { return open; } };
}
