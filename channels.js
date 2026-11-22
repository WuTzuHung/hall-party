// 「我的螢幕」頻道選單：用 YouTube 公開的頻道 RSS 取最新影片（不需要 API 金鑰），並檢查頻道目前是否在直播
// 只在伺服器抓取並快取，觀眾的瀏覽器只跟本站要清單
'use strict';

const FEED_TTL = 10 * 60 * 1000; // 影片清單快取 10 分鐘
const LIVE_TTL = 3 * 60 * 1000; // 直播狀態快取 3 分鐘
const FAIL_TTL = 60 * 1000; // 抓取失敗後 1 分鐘內不重試
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', 'Cookie': 'CONSENT=YES+1; SOCS=CAI' };

// 預設頻道（使用者可在直播後台增刪）
const DEFAULT_CHANNELS = [
  { handle: 'lolesportstw', name: 'LoL Esports 中文', tag: '中文官方' },
  { id: 'UCvqRdlKsE5Q8mf8YXbdIJLw', name: 'LoL Esports', tag: '官方電競' },
  { id: 'UC2t5bjwHdUX4vM2g8TRDq5g', name: 'League of Legends', tag: '官方' },
];

const CH_ID = /^UC[\w-]{22}$/;
const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// 解析頻道 RSS（Atom）：回傳 { name, videos:[{ id, title, published }] }
function parseFeed(xml) {
  xml = String(xml || '');
  const head = xml.split('<entry>')[0];
  const name = decode((head.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
  const videos = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!id) continue;
    const title = decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const published = Date.parse((e.match(/<published>([^<]+)<\/published>/) || [])[1] || '') || 0;
    const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    videos.push({ id, title: title.slice(0, 160), published, short: /\/shorts\//.test(link) });
  }
  return { name, videos };
}

// 從頻道／影片頁面找出頻道 ID 與名稱
function parseChannelPage(html) {
  html = String(html || '');
  const id = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/\/channel\/(UC[\w-]{22})/) || [])[1] || null;
  const name = decode((html.match(/"ownerChannelName":"([^"]+)"/) || html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || '');
  return { id, name: name.replace(/\\u0026/g, '&').trim() };
}

// 頻道 /live 頁面：正在直播就回傳 { id, title }
function parseLivePage(html) {
  html = String(html || '');
  if (!/"isLiveNow":true|"isLive":true/.test(html)) return null;
  const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/) || [])[1];
  if (!id) return null;
  const title = decode((html.match(/<meta name="title" content="([^"]*)"/) || html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
  return { id, title: title.slice(0, 160) };
}

// 使用者在後台貼的東西 → 怎麼找頻道：{ id } 或 { handle } 或 { url }（影片網址，要抓頁面）
function parseChannelInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (CH_ID.test(s)) return { id: s };
  const h = s.match(/^@([\w.\-·　-鿿]{2,60})$/);
  if (h) return { handle: h[1] };
  let u; try { u = new URL(s); } catch (_) { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return null;
  const c = u.pathname.match(/^\/channel\/(UC[\w-]{22})/); if (c) return { id: c[1] };
  const at = u.pathname.match(/^\/@([^/]+)/); if (at) return { handle: decodeURIComponent(at[1]) };
  const legacy = u.pathname.match(/^\/(c|user)\/([^/]+)/); if (legacy) return { url: `https://www.youtube.com/${legacy[1]}/${legacy[2]}` };
  if (host === 'youtu.be' || u.searchParams.get('v') || /^\/(live|shorts)\//.test(u.pathname)) return { url: u.href };
  return null;
}

function createChannels({ fetchImpl = globalThis.fetch, now = () => Date.now(), onResolved = null } = {}) {
  const feeds = new Map(); // channelId -> { at, ok, name, videos }
  const lives = new Map(); // channelId -> { at, live }
  const handles = new Map(); // handle -> channelId
  const handleFail = new Map(); // handle -> 失敗時間（1 分鐘內不重試）
  const inflight = new Map();
  async function get(url) {
    const r = await fetchImpl(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  const once = (key, fn) => { if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key))); return inflight.get(key); };

  async function resolve(spec) {
    if (spec.id && CH_ID.test(spec.id)) return { id: spec.id, name: spec.name || '' };
    if (spec.handle) {
      if (handles.has(spec.handle)) return { id: handles.get(spec.handle), name: spec.name || '' };
      if (now() - (handleFail.get(spec.handle) || -Infinity) < FAIL_TTL) throw new Error('暫時抓不到這個頻道，稍後再試');
      let info;
      try { info = parseChannelPage(await get('https://www.youtube.com/@' + encodeURIComponent(spec.handle))); }
      catch (_) { handleFail.set(spec.handle, now()); throw new Error('暫時抓不到這個頻道，稍後再試'); }
      if (!info.id) { handleFail.set(spec.handle, now()); throw new Error('找不到這個頻道'); }
      handles.set(spec.handle, info.id);
      return info;
    }
    if (spec.url) {
      let info; try { info = parseChannelPage(await get(spec.url)); } catch (_) { throw new Error('暫時連不上 YouTube，稍後再試'); }
      if (!info.id) throw new Error('找不到這支影片的頻道');
      return info;
    }
    throw new Error('無法辨識的頻道');
  }
  async function feed(id) {
    const c = feeds.get(id);
    if (c && now() - c.at < (c.ok ? FEED_TTL : FAIL_TTL)) return c;
    return once('feed:' + id, async () => {
      try {
        const f = parseFeed(await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + id));
        const v = { at: now(), ok: true, name: f.name, videos: f.videos };
        feeds.set(id, v); return v;
      } catch (e) {
        const v = { ...(c || { name: '', videos: [] }), at: now(), ok: false, error: e.message };
        feeds.set(id, v); return v;
      }
    });
  }
  async function live(id) {
    const c = lives.get(id);
    if (c && now() - c.at < LIVE_TTL) return c.live;
    return once('live:' + id, async () => {
      let l = null; try { l = parseLivePage(await get(`https://www.youtube.com/channel/${id}/live`)); } catch (_) { }
      lives.set(id, { at: now(), live: l }); return l;
    });
  }
  // 公開清單：[{ key, name, tag, live, videos }]
  async function list(specs) {
    return Promise.all(specs.map(async (s) => {
      let id = s.id;
      try { if (!id) { id = (await resolve(s)).id; s.id = id; onResolved && onResolved(); } } /* 記住解析到的頻道 ID */ catch (e) { return { key: s.handle || s.id || '', name: s.name || s.handle || '', tag: s.tag || '', videos: [], error: e.message }; }
      const [f, l] = await Promise.all([feed(id), live(id)]);
      const videos = f.videos.filter((v) => !v.short).slice(0, 24);
      if (l) { const i = videos.findIndex((v) => v.id === l.id); if (i >= 0) videos.splice(i, 1); videos.unshift({ id: l.id, title: l.title || '正在直播', published: now(), live: true }); }
      return { key: id, name: s.name || f.name || s.handle || id, tag: s.tag || '', videos, ...(f.ok ? {} : { error: '暫時抓不到影片，稍後再試' }) };
    }));
  }
  return { resolve, feed, live, list };
}

module.exports = { DEFAULT_CHANNELS, parseFeed, parseChannelPage, parseLivePage, parseChannelInput, createChannels };
