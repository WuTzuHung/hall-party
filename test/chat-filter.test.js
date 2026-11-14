'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { filterChat } = require('../public/js/chat-filter.js');

const banned = [
  '幹', '幹你娘', '幹拎', '干你娘', '干拎', '操', '肏', '白癡', '白痴', '笨蛋', '笨', '智障',
  '腦殘', '脑残', '靠北', '靠杯', '他媽的', '他妈的', '你媽', '你妈', '雞掰', '鸡掰', '機掰', '机掰',
  '婊子', '三小', '北七', '去死', 'fuck', 'shit', 'bitch', 'wtf', '做愛', '做爱', '性交', '口交', '肛交',
  '自慰', '打手槍', '打手枪', '陰莖', '阴茎', '陰道', '阴道', '懶叫', '懒叫', '奶子', '巨乳', '內射', '内射', 'porn', 'sex', 'nude',
];
const allowed = ['幹嘛', '幹部', '才幹', '能幹', '骨幹', '幹活', '操作', '體操', '操場', '節操', '操心', '笨重',
  '干嘛', '干部', '才干', '能干', '骨干', '干活', '体操', '操场', '节操', '干净', '干燥', '干杯', '干涉', '干扰', '干预',
  '爛', '垃圾', '好難看', 'GEN.G', 'GENG', 'BLG', '3.5', '1.5倍', '3:1', '2026', '19:30', '87', '1234567', '@大家',
  'LINE 很方便', 'IG 上看比賽', 'Discord 語音', 'onlineabcd', '做操作，幹嘛這麼笨重？',
  'IG 2:0 贏了', 'IG vs BLG', 'id 是 Chovy', 'IG Chovy', 'ig abc', 'ig x', 'dc hi',
  '幹掉對面中路', '這操控好強', '操盤手', '主幹道', '樹幹', '幹線', '幹勁', '幹練', '實幹', '苦幹', '精幹',
  '若干', '相干', '干貝', '操縱', '操練', '操守', '情操', '早操', '出操', '干',
  'Essex', 'Sussex', 'Scunthorpe', 'Ｅｓｓｅｘ', 'Es\u200bsex', 'IG 2018 冠軍', 'IG 2018年拿冠軍'];
const contacts = [
  'a@example.com', 'a＠example.com', 'user at example dot com', 'user 小老鼠 example 點com', 'user＠example點com',
  'https://example.com', 'http://example.invalid', 'www.example.com', 'example.net', 'example.org', 'example.tw', 'example.jp',
  'example.io', 'example.gg', 'example.me', 'example.cc', 'example.xyz', 'ｅｘａｍｐｌｅ．ｃｏｍ', 'exam\u200bple.com',
  'LINE: abcd1234', 'lineid=abcd', '賴 abcd', '加賴：abcd', 'ID abc123', 'line abcd_12',
  '0912345678', '09 1234 5678', '(02) 1234-5678', '+886 912-345-678', '090-1234-5678', '+81 (90) 1234.5678',
  '１２３４５６７８', '12345678', '09\u200b12-345-678', 'ig abc_123', 'instagram: player.123', '哀居 abc123',
  'IG: abc_123', 'dc是 hall#1234', '我的賴 abc123', '@abc', '@a_b', 'dc: player123', 'discord player123', 'discord.gg/hallparty', '玩家#1234', 'player#1234',
  'l.i.n.e: a b c d', 'L Ｉ N E ID：a.b.c.d', 'i.g:player', 'd i s c o r d：player', 'example。com',
  'IG：player', 'instagram帳號 player', '哀居@player', 'dc abc_123', 'id abc_123', 'IG: 12345678', 'IG: 2018',
];

for (const word of banned) test('遮字：' + word, () => {
  assert.deepEqual(filterChat(word), { ok: true, text: '＊'.repeat(Array.from(word).length), reason: null });
  const separated = Array.from(word).join(' .\u200b ');
  assert.equal(filterChat(separated).text, Array.from(word).map(() => '＊').join(' .\u200b '));
});
for (const text of allowed) test('通過：' + text, () => assert.deepEqual(filterChat(text), { ok: true, text, reason: null }));
for (const text of contacts) test('阻擋聯絡方式：' + text, () => assert.deepEqual(filterChat(text), { ok: false, text, reason: 'contact' }));

test('NFKC、大小寫、emoji 與原文位置保持正確', () => {
  assert.equal(filterChat('🙂𐐀 Ｆ．Ｕ．Ｃ．Ｋ！白 癡！').text, '🙂𐐀 ＊．＊．＊．＊！＊ ＊！');
  assert.equal(filterChat('幹嘛？幹！操作，操！笨重，笨！').text, '幹嘛？＊！操作，＊！笨重，＊！');
  assert.equal(filterChat('幹幹你娘').text, '＊＊＊＊');
  assert.equal(filterChat('幹你娘 example.com').ok, false);
  assert.deepEqual(filterChat(null), { ok: true, text: '', reason: null });
});

test('英文邊界依原文判斷，句中英文與拆字仍遮罩', () => {
  for (const word of ['fuck', 'shit', 'bitch', 'wtf', 'porn', 'sex', 'nude']) {
    for (const variant of [word, word.toUpperCase(), Array.from(word).join('.'), Array.from(word).join(' ')]) {
      assert.equal(filterChat('看！' + variant + ' 好扯').text, '看！' + variant.replace(/[a-z]/gi, '＊') + ' 好扯');
    }
    assert.equal(filterChat('a' + word).text, 'a' + word);
    assert.equal(filterChat(word + 'z').text, '＊'.repeat(word.length) + 'z');
  }
  assert.equal(filterChat('操控好強，操！幹掉對手，幹你娘').text, '操控好強，＊！幹掉對手，＊＊＊');
});

for (const [text, masked] of [
  ['fucking', '＊＊＊＊ing'], ['fuckkk', '＊＊＊＊kk'], ['shitty', '＊＊＊＊ty'], ['bitches', '＊＊＊＊＊es'],
  ['sexy', '＊＊＊y'], ['shitake', '＊＊＊＊ake'], ['sexton', '＊＊＊ton'], ['nudes', '＊＊＊＊s'],
]) test('英文變形遮字：' + text, () => assert.deepEqual(filterChat(text), { ok: true, text: masked, reason: null }));

test('重複過濾不改變已遮字結果', () => {
  for (const word of banned) {
    const once = filterChat('你好！' + Array.from(word).join('.'));
    assert.deepEqual(filterChat(once.text), once);
  }
});

test('同一檔案的瀏覽器 global 與 CommonJS 結果相同', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../public/js/chat-filter.js'), 'utf8'), context);
  for (const text of [...banned, ...allowed, ...contacts]) {
    assert.equal(JSON.stringify(context.HallChatFilter.filterChat(text)), JSON.stringify(filterChat(text)));
  }
});
