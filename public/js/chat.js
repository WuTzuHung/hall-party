// 聊天：左下輸入框（可縮成小圖示）＋ 右上公開訊息串（類似 Twitch）
// 訊息串規則：最多顯示最新 15 則；第 16 則進來時最舊的淡出隱藏，隱藏 10 秒後從 DOM 移除；
// 任何訊息超過 5 分鐘也會自動隱藏並移除。伺服器不保存聊天，新進場的人從空白開始。
// 測試時可用 window.__CHAT_DEBUG = { max, ttl, removeAfter } 暫時縮短時間（毫秒）

const $ = (s) => document.querySelector(s);
const cfg = () => ({ max: 15, ttl: 5 * 60 * 1000, removeAfter: 10 * 1000, ...(window.__CHAT_DEBUG || {}) });
export const CHAT_MAX = 120;

export function initChat({ send, isTouch, onFocus, onBlur, toast }) {
  const feed = $('#chat-feed'), box = $('#chat'), form = $('#chat-form'), input = $('#chat-input');
  const items = []; // { el, hidden }
  const sentAt = [];

  // ---- 縮小／展開 ----
  let collapsed;
  try { collapsed = localStorage.getItem('hall-chat-collapsed'); } catch (_) { }
  collapsed = collapsed == null ? isTouch : collapsed === '1';
  const setCollapsed = (c) => {
    collapsed = c; box.classList.toggle('collapsed', c);
    try { localStorage.setItem('hall-chat-collapsed', c ? '1' : '0'); } catch (_) { }
  };
  setCollapsed(collapsed);
  $('#chat-toggle').addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(false); input.focus(); });
  $('#chat-min').addEventListener('click', (e) => { e.stopPropagation(); input.blur(); setCollapsed(true); });

  // ---- 輸入 ----
  input.maxLength = CHAT_MAX;
  input.addEventListener('focus', () => { box.classList.add('focus'); onFocus && onFocus(); });
  input.addEventListener('blur', () => { box.classList.remove('focus'); onBlur && onBlur(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // 打字時不要觸發移動、跳躍、坐下等快捷鍵
    if (e.key === 'Escape') { e.preventDefault(); input.blur(); }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = Array.from(input.value.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, CHAT_MAX).join('');
    if (!text) { input.blur(); return; }
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > 5000) sentAt.shift();
    if (sentAt.length >= 5 || (sentAt.length && now - sentAt[sentAt.length - 1] < 800)) { toast && toast('訊息送太快了，稍等一下再送'); return; }
    if (!send(text)) { toast && toast('尚未連線，訊息沒有送出'); return; }
    sentAt.push(now);
    input.value = '';
    if (!isTouch) input.blur(); // 桌機：送出後馬上可以繼續走動；手機保留鍵盤方便連續聊天
  });

  function open() { if (collapsed) setCollapsed(false); input.focus(); }

  // ---- 訊息串 ----
  function hide(it) {
    if (it.hidden) return;
    it.hidden = true; clearTimeout(it.ttlT);
    it.el.classList.add('gone');
    setTimeout(() => { it.el.remove(); const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); }, cfg().removeAfter);
  }
  function add({ name, color, text }) {
    const el = document.createElement('div'); el.className = 'cf-line';
    const n = document.createElement('span'); n.className = 'cf-name ' + (color === 'blue' ? 'blue' : 'pink'); n.textContent = name;
    const t = document.createElement('span'); t.className = 'cf-text'; t.textContent = text;
    el.append(n, document.createTextNode(': '), t);
    feed.appendChild(el);
    const it = { el, hidden: false };
    it.ttlT = setTimeout(() => hide(it), cfg().ttl);
    items.push(it);
    const vis = items.filter(i => !i.hidden);
    for (let k = 0; k < vis.length - cfg().max; k++) hide(vis[k]);
  }
  function clear() { for (const it of items) { clearTimeout(it.ttlT); it.el.remove(); } items.length = 0; }
  return { add, open, clear, input, get focused() { return document.activeElement === input; }, items };
}
