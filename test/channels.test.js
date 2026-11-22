'use strict';
// 我的螢幕頻道：RSS 解析、頻道輸入解析、快取與直播置頂
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed, parseChannelPage, parseLivePage, parseChannelInput, createChannels, DEFAULT_CHANNELS } = require('../channels.js');

const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>LoL Esports 中文</title>
 <entry><id>yt:video:AAAAAAAAAAA</id><yt:videoId>AAAAAAAAAAA</yt:videoId><title>[中文] GEN vs BLG &amp; T1 &#39;決賽&#39;</title><link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/><published>2026-11-20T10:00:00+00:00</published></entry>
 <entry><id>yt:video:BBBBBBBBBBB</id><yt:videoId>BBBBBBBBBBB</yt:videoId><title>Highlights</title><link rel="alternate" href="https://www.youtube.com/shorts/BBBBBBBBBBB"/><published>2026-11-19T10:00:00+00:00</published></entry>
 <entry><yt:videoId>bad</yt:videoId><title>x</title></entry>
</feed>`;

test('parseFeed 取出頻道名、影片與上架時間，並解碼 HTML 實體', () => {
  const f = parseFeed(FEED);
  assert.equal(f.name, 'LoL Esports 中文');
  assert.equal(f.videos.length, 2);
  assert.equal(f.videos[0].id, 'AAAAAAAAAAA');
  assert.equal(f.videos[0].title, "[中文] GEN vs BLG & T1 '決賽'");
  assert.equal(f.videos[0].published, Date.parse('2026-11-20T10:00:00Z'));
  assert.equal(f.videos[1].short, true);
});

test('parseChannelInput 支援頻道 ID、@帳號、頻道網址與影片網址', () => {
  assert.deepEqual(parseChannelInput('UCvqRdlKsE5Q8mf8YXbdIJLw'), { id: 'UCvqRdlKsE5Q8mf8YXbdIJLw' });
  assert.deepEqual(parseChannelInput('@lolesportstw'), { handle: 'lolesportstw' });
  assert.deepEqual(parseChannelInput('https://www.youtube.com/@lolesportstw/videos'), { handle: 'lolesportstw' });
  assert.deepEqual(parseChannelInput('https://www.youtube.com/channel/UC2t5bjwHdUX4vM2g8TRDq5g'), { id: 'UC2t5bjwHdUX4vM2g8TRDq5g' });
  assert.equal(parseChannelInput('https://youtu.be/AAAAAAAAAAA').url, 'https://youtu.be/AAAAAAAAAAA');
  assert.equal(parseChannelInput('https://example.com/@x'), null);
  assert.equal(parseChannelInput(''), null);
});

test('parseChannelPage／parseLivePage', () => {
  assert.equal(parseChannelPage('..."externalId":"UCvqRdlKsE5Q8mf8YXbdIJLw"...').id, 'UCvqRdlKsE5Q8mf8YXbdIJLw');
  assert.equal(parseLivePage('<link rel="canonical" href="https://www.youtube.com/watch?v=AAAAAAAAAAA">'), null);
  const l = parseLivePage('"isLiveNow":true <link rel="canonical" href="https://www.youtube.com/watch?v=CCCCCCCCCCC"><meta name="title" content="決賽直播">');
  assert.deepEqual(l, { id: 'CCCCCCCCCCC', title: '決賽直播' });
});

test('list：解析 @帳號、正在直播的置頂、Shorts 不列出，且 10 分鐘內只抓一次', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = url.includes('/@lolesportstw') ? '"externalId":"UCaaaaaaaaaaaaaaaaaaaaaa"'
      : url.includes('feeds/videos.xml') ? FEED
      : url.endsWith('/live') ? '"isLiveNow":true <link rel="canonical" href="https://www.youtube.com/watch?v=CCCCCCCCCCC"><meta name="title" content="LIVE 決賽">'
      : '';
    return { ok: true, status: 200, text: async () => body };
  };
  let t = 1e12; const ch = createChannels({ fetchImpl, now: () => t });
  const [c] = await ch.list([{ handle: 'lolesportstw', name: 'LoL Esports 中文', tag: '中文官方' }]);
  assert.equal(c.key, 'UCaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(c.name, 'LoL Esports 中文');
  assert.deepEqual(c.videos.map((v) => v.id), ['CCCCCCCCCCC', 'AAAAAAAAAAA']);
  assert.equal(c.videos[0].live, true);
  const n = calls.length;
  t += 60e3; await ch.list([{ handle: 'lolesportstw' }]);
  assert.equal(calls.length, n, '快取期間不重新抓');
  t += 11 * 60e3; await ch.list([{ handle: 'lolesportstw' }]);
  assert.ok(calls.length > n, '快取過期後重新抓');
});

test('抓取失敗時回傳錯誤訊息而不是丟例外', async () => {
  const ch = createChannels({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }) });
  const [c] = await ch.list([{ id: 'UCvqRdlKsE5Q8mf8YXbdIJLw', name: 'LoL Esports' }]);
  assert.equal(c.videos.length, 0);
  assert.ok(c.error);
  const [d] = await ch.list([{ handle: 'nope' }]);
  assert.ok(d.error);
});

test('預設頻道包含中文官方 @lolesportstw', () => {
  assert.equal(DEFAULT_CHANNELS[0].handle, 'lolesportstw');
});
