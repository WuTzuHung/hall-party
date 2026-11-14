// 共用純函式：Node 18 以 require 載入，瀏覽器以 ES module side-effect import 載入。
(function () {
  'use strict';

  // 清單集中在這裡；白名單僅保護該次完整命中的正常詞，不豁免整則訊息。
  const WORDS = [
    '幹你娘', '幹拎', '干你娘', '干拎', '幹', '操', '肏', '白癡', '白痴', '笨蛋', '笨',
    '智障', '腦殘', '脑残', '靠北', '靠杯', '他媽的', '他妈的', '你媽', '你妈', '雞掰', '鸡掰',
    '機掰', '机掰', '婊子', '三小', '北七', '去死', 'fuck', 'shit', 'bitch', 'wtf',
    '做愛', '做爱', '性交', '口交', '肛交', '自慰', '打手槍', '打手枪', '陰莖', '阴茎',
    '陰道', '阴道', '懶叫', '懒叫', '奶子', '巨乳', '內射', '内射', 'porn', 'sex', 'nude',
  ];
  const ALLOWED_WORDS = [
    '幹嘛', '幹部', '才幹', '能幹', '骨幹', '幹活', '干嘛', '干部', '才干', '能干', '骨干', '干活',
    '操作', '體操', '体操', '操場', '操场', '節操', '节操', '操心', '笨重',
    '乾淨', '干净', '乾燥', '干燥', '乾杯', '干杯', '干涉', '干擾', '干扰', '干預', '干预',
    '幹掉', '主幹', '樹幹', '幹線', '幹勁', '幹練', '實幹', '苦幹', '精幹', '若干', '相干', '干貝',
    '操控', '操縱', '操盤', '操練', '操守', '情操', '早操', '出操',
  ];
  const TLDS = ['com', 'net', 'org', 'tw', 'jp', 'io', 'gg', 'me', 'cc', 'xyz', 'co', 'edu', 'gov', 'info', 'biz', 'tv', 'app', 'dev', 'ai', 'us', 'uk', 'de', 'fr'];
  const CONTACT_NOTICE = '公開頻道不能留聯絡方式（電話、信箱、LINE、IG、Discord）或網址';
  const DOMAIN = new RegExp('(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:' + TLDS.join('|') + ')(?![a-z0-9])', 'i');
  const GAP = '[\\p{P}\\p{S}\\s\\p{Cf}]*';
  const labelRule = (labels, min) => new RegExp('(?:^|[^a-z0-9_])(?:' + labels.map(l => Array.from(l).join(GAP)).join('|')
    + ')' + GAP + '(?:是|為|为)?' + GAP + '[a-z0-9_](?:' + GAP + '[a-z0-9_]){' + (min - 1) + ',}', 'iu');
  const CONTACT_LABEL = labelRule(['lineid', 'line', '加賴', '加赖', '賴', '赖'], 4);
  const SOCIAL_LABEL = new RegExp('(?:^|[^a-z0-9_])(' + ['instagram', 'ig', '哀居', 'discord', 'dc', 'id'].map(l => Array.from(l).join(GAP)).join('|')
    + ')\\s*(?:(:|是|為|为|帳號|账号|@)\\s*)?([a-z0-9_][a-z0-9_.#-]*)', 'giu');
  const SOCIAL_HANDLE = /(?:^|[^a-z0-9_])@[a-z0-9_][a-z0-9_.]{2,}|[\p{L}\p{N}_.-]{2,32}#\d{4}(?!\d)/u;
  const PHONE = /(?:^|[^\d])\+?\d(?:[\s().-]*\d){7,}(?!\d)/;

  function hasSocial(text) {
    for (const [, label, connector, handle] of text.matchAll(SOCIAL_LABEL)) {
      if (handle.length < 4) continue;
      // 泛用 ID 也用來討論選手；純字母的選手名稱不視為聯絡帳號。
      const genericId = label.replace(/[^a-z]/g, '') === 'id';
      if ((!genericId && connector) || /[0-9_.]/.test(handle)) return true;
    }
    return false;
  }

  function hasContact(text) {
    const s = text.normalize('NFKC').toLowerCase().replace(/\p{Cf}/gu, '').replace(/。/g, '.');
    // 保留 @ 和 . 的結構；只轉換明確的信箱／網域分隔寫法。
    const address = s.replace(/\s+at\s+|小老鼠/g, '@').replace(/\s+dot\s+|[點点]\s*(?=[a-z])/g, '.').replace(/\s+/g, '');
    return /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(address)
      || /https?:|www\./.test(address) || DOMAIN.test(address)
      || CONTACT_LABEL.test(s) || hasSocial(s) || SOCIAL_HANDLE.test(s) || PHONE.test(s);
  }

  function filterChat(value) {
    const text = String(value ?? '');
    if (hasContact(text)) return { ok: false, text, reason: 'contact' };
    const original = Array.from(text), chars = [], positions = [];
    original.forEach((c, i) => {
      for (const n of c.normalize('NFKC').toLowerCase()) {
        if (/[\p{L}\p{N}]/u.test(n)) {
          chars.push(n);
          for (let j = 0; j < n.length; j++) positions.push(i); // indexOf 使用 UTF-16 索引
        }
      }
    });
    const normalized = chars.join('');
    const allowed = [];
    for (const word of ALLOWED_WORDS) {
      for (let i = normalized.indexOf(word); i !== -1; i = normalized.indexOf(word, i + 1)) allowed.push([i, i + word.length]);
    }
    const masked = new Set();
    for (const word of WORDS) {
      for (let i = normalized.indexOf(word); i !== -1; i = normalized.indexOf(word, i + 1)) {
        if (allowed.some(([a, b]) => i >= a && i + word.length <= b)) continue;
        if (/^[a-z]+$/.test(word)) {
          const start = positions[i], end = positions[i + word.length - 1];
          const before = original.slice(0, start).join('').normalize('NFKC').replace(/\p{Cf}/gu, '');
          const after = original.slice(end + 1).join('').normalize('NFKC').replace(/\p{Cf}/gu, '');
          if (/[a-z]$/i.test(before) || /^[a-z]/i.test(after)) continue;
        }
        for (let j = i; j < i + word.length; j++) masked.add(positions[j]);
      }
    }
    return { ok: true, text: original.map((c, i) => masked.has(i) ? '＊' : c).join(''), reason: null };
  }

  const api = Object.freeze({ filterChat, CONTACT_NOTICE });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.HallChatFilter = api;
})();
