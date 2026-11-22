// 研究所的映像管電視：遙控器面板（觀眾用）
// 研究所裡的人看的是同一台電視、同一個進度；選集、播放／暫停、快轉都會讓研究所裡所有人一起換
// 研究所後台可以把遙控器鎖起來（只剩管理員能操作）；伺服器會檢查人是不是真的在研究所裡
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const I = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.4v14H6zM20 5v14L9.5 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5H18v14h-2.4zM4 5v14l10.5-7z" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 6v12l-8-6zM20 6v12l-8-6z" fill="currentColor"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 6v12l8-6zM4 6v12l8-6z" fill="currentColor"/></svg>',
  tv: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="7" width="18" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 2.5l3.5 4 3.5-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const WHY = { lock: '遙控器被研究所後台鎖住了，現在只有管理員能轉台', far: '要走進研究所裡才能用遙控器', busy: '按慢一點，電視還在換台', err: '' };

export function initLabTv({ send, toast, isTouch, onFocus, here, wantSound, isAdmin, enterFull }) {
  const hudRight = document.querySelector('.hud-right'), help = document.querySelector('#btn-help');
  const btn = document.createElement('button');
  btn.className = 'pill btn hidden'; btn.id = 'btn-lab'; btn.type = 'button'; btn.title = '研究所的電視遙控器（R）';
  btn.innerHTML = `${I.tv}<span class="lab-l">遙控器</span>`;
  hudRight.insertBefore(btn, help);
  const panel = document.createElement('aside'); panel.id = 'lab-panel'; panel.className = 'hidden'; panel.setAttribute('aria-label', '研究所的電視');
  panel.innerHTML = `
    <header class="lab-head">
      <div><div class="lab-kicker">LAB · CRT TV</div><h2>研究所的電視</h2><div class="lab-sub">研究所裡的人一起看同一台</div></div>
      <button type="button" class="lab-close" aria-label="關閉">✕</button>
    </header>
    <div class="lab-now">
      <div class="lab-scr"><img alt=""><span class="lab-state"></span></div>
      <div class="lab-meta"><div class="lab-ep"></div><div class="lab-t"></div><div class="lab-pos"></div></div>
    </div>
    <div class="lab-ctl" role="group" aria-label="遙控器">
      <button type="button" data-a="prev" aria-label="上一集">${I.prev}</button>
      <button type="button" data-a="back" aria-label="倒退 10 秒">${I.back}<small>10</small></button>
      <button type="button" data-a="toggle" class="lab-pp" aria-label="播放／暫停">${I.play}</button>
      <button type="button" data-a="fwd" aria-label="快轉 10 秒">${I.fwd}<small>10</small></button>
      <button type="button" data-a="next" aria-label="下一集">${I.next}</button>
    </div>
    <div class="lab-lock hidden" role="status"></div>
    <div class="lab-list-h"><span>片庫</span><small class="lab-count"></small></div>
    <ol class="lab-list"></ol>
    <footer class="lab-foot"><button type="button" class="lab-full">⛶ 全螢幕看電視</button><span class="lab-tip">${isTouch ? '' : 'R 開關遙控器 · 坐到沙發上按 E'}</span></footer>`;
  document.querySelector('#hud').append(panel);
  const q = (s) => panel.querySelector(s);
  let lab = null, at = 0, open = false, shown = false;
  const tvPos = () => { const c = lab && lab.tv; return !c || c.live ? 0 : c.position + (c.playing ? (performance.now() - at) / 1000 : 0); };
  function setOpen(o) {
    open = o && shown; panel.classList.toggle('hidden', !open); btn.classList.toggle('on', open);
    if (open) { render(); onFocus && onFocus(); }
  }
  function act(a, extra = {}) {
    const c = lab && lab.tv;
    if (lab && lab.lock && !isAdmin()) { toast(WHY.lock); return; }
    if (a === 'back' || a === 'fwd') { if (!c) return; if (c.live) { toast('直播不能快轉'); return; } send({ t: 'lab', a: 'skip', s: a === 'back' ? -10 : 10 }); }
    else send({ t: 'lab', a, ...extra });
    wantSound && wantSound();
  }
  for (const b of panel.querySelectorAll('.lab-ctl button')) b.addEventListener('click', () => act(b.dataset.a));
  q('.lab-close').addEventListener('click', () => setOpen(false));
  q('.lab-full').addEventListener('click', () => { setOpen(false); enterFull && enterFull(); });
  q('.lab-list').addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) act('pick', { i: Number(li.dataset.i) }); });
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  for (const ev of ['keydown', 'keyup']) panel.addEventListener(ev, (e) => { if (e.key === 'Escape') setOpen(false); e.stopPropagation(); });
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  function render() {
    if (!open) return;
    const c = lab && lab.tv, list = (lab && lab.list) || [];
    const img = q('.lab-scr img');
    if (c) { const src = `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`; if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; } else img.hidden = true;
    q('.lab-scr').classList.toggle('off', !c);
    q('.lab-state').textContent = !c ? 'NO SIGNAL' : c.live ? 'LIVE' : c.playing ? 'PLAY ▶' : 'PAUSE ❚❚';
    q('.lab-ep').textContent = c ? (c.idx >= 0 ? `片庫第 ${c.idx + 1} 集` : '後台直接播放') : '電視還沒有片子';
    q('.lab-t').textContent = c ? (c.title || c.id) : (list.length ? '從下面的片庫選一集開始看' : '片庫是空的，請管理員在研究所後台加片');
    q('.lab-pos').textContent = c && !c.live ? clock(tvPos()) + (c.dur ? ' / ' + clock(c.dur) : '') : '';
    const pp = q('.lab-pp'); pp.innerHTML = c && c.playing ? I.pause : I.play; pp.disabled = !c;
    q('[data-a="prev"]').disabled = !list.length || (c && c.idx === 0);
    q('[data-a="next"]').disabled = !list.length || (c && c.idx >= list.length - 1);
    for (const a of ['back', 'fwd']) q(`[data-a="${a}"]`).disabled = !c || c.live;
    const locked = !!(lab && lab.lock) && !isAdmin();
    panel.classList.toggle('locked', locked);
    const lk = q('.lab-lock'); lk.classList.toggle('hidden', !lab || !lab.lock); lk.textContent = locked ? '🔒 遙控器被研究所後台鎖住了，現在只能看' : '🔒 遙控器已鎖定（你是管理員，仍可操作）';
    q('.lab-count').textContent = list.length ? `${list.length} 集` : '';
    const ol = q('.lab-list'), key = JSON.stringify([list, c ? c.idx : -2, locked]);
    if (ol.dataset.k !== key) {
      ol.dataset.k = key;
      ol.innerHTML = list.length ? list.map((x, i) => `<li data-i="${i}" class="${c && c.idx === i ? 'cur' : ''}" tabindex="0" role="button" aria-label="播第 ${i + 1} 集"><span class="n">${i + 1}</span><span class="t">${esc(x.title || x.id)}</span>${x.live ? '<span class="lv">LIVE</span>' : ''}<span class="go">${c && c.idx === i ? '播放中' : '播這集'}</span></li>`).join('') : '<li class="empty">片庫是空的</li>';
    }
  }
  panel.querySelector('.lab-list').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.i) { e.preventDefault(); act('pick', { i: Number(e.target.dataset.i) }); } });
  setInterval(() => { if (open && lab && lab.tv && lab.tv.playing) q('.lab-pos').textContent = clock(tvPos()) + (lab.tv.dur ? ' / ' + clock(lab.tv.dur) : ''); }, 500);
  // 只有在研究所裡才顯示遙控器按鈕
  function refresh() {
    const h = here();
    if (h !== shown) { shown = h; btn.classList.toggle('hidden', !h); if (!h) setOpen(false); }
  }
  return {
    setMedia(l) { lab = l || null; at = performance.now(); render(); },
    refresh, toggle: () => { if (shown) setOpen(!open); else toast('走進二樓的研究所才能用遙控器'); },
    get open() { return open; }, close: () => setOpen(false),
    onNo(m) { toast(m.why === 'err' ? (m.msg || '沒辦法操作') : WHY[m.why] || '沒辦法操作'); },
    onFx(m, meId, names) {
      if (m.id === meId || !here()) return;
      const who = m.n || names(m.id) || '有人';
      const what = { pick: m.i >= 0 ? `轉到第 ${m.i + 1} 集` : '換了片', next: `轉到第 ${m.i + 1} 集`, prev: `轉到第 ${m.i + 1} 集`, toggle: '按了播放／暫停', play: '按了播放', pause: '按了暫停', skip: '快轉了一下', restart: '從頭開始' }[m.a] || '動了遙控器';
      toast(`📺 ${who} ${what}`);
    },
  };
}
