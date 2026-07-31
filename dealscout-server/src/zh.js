// EN→ZH query expansion for the China (Taobao) searches.
//
// Most Taobao listings are titled in Chinese — a user searching "adidas hoodie"
// in English misses the bulk of genuine Chinese-titled stock. This maps
// well-known brand names to their OFFICIAL Chinese names (the ones the brands
// themselves trade under in China) and common product nouns to Chinese, then
// the connector searches both versions and merges the results.
//
// Deliberately limited to official/legitimate names only. The obfuscated
// "hidden word" aliases some sellers use to evade brand enforcement are a
// counterfeit-finding vocabulary, and DealScout doesn't carry one.

const BRANDS = {
  'adidas': '阿迪达斯', 'nike': '耐克', 'puma': '彪马', 'new balance': '新百伦',
  'converse': '匡威', 'vans': '万斯', 'asics': '亚瑟士', 'reebok': '锐步',
  'fila': '斐乐', 'champion': '冠军', 'uniqlo': '优衣库', 'north face': '北面',
  'the north face': '北面', 'columbia': '哥伦比亚', 'levis': '李维斯',
  "levi's": '李维斯', 'lego': '乐高', 'sony': '索尼', 'nintendo': '任天堂',
  'xiaomi': '小米', 'casio': '卡西欧', 'anta': '安踏', 'li ning': '李宁',
};

const NOUNS = {
  'hoodie': '卫衣', 'hoodies': '卫衣', 'sweatshirt': '卫衣',
  't-shirt': 'T恤', 'tshirt': 'T恤', 'tee': 'T恤', 'shirt': '衬衫',
  'jeans': '牛仔裤', 'trainers': '运动鞋', 'sneakers': '运动鞋', 'shoes': '鞋',
  'boots': '靴子', 'jacket': '夹克', 'coat': '外套', 'shorts': '短裤',
  'tracksuit': '运动套装', 'joggers': '运动裤', 'jumper': '毛衣', 'sweater': '毛衣',
  'skirt': '半身裙', 'dress': '连衣裙', 'socks': '袜子', 'cap': '帽子', 'hat': '帽子',
  'backpack': '背包', 'bag': '包', 'watch': '手表', 'headphones': '耳机',
  'earbuds': '耳机', 'keyboard': '键盘', 'mouse': '鼠标', 'wallet': '钱包',
  'gloves': '手套', 'scarf': '围巾',
};

// Longest keys first so "new balance" wins over any shorter overlap.
const ENTRIES = [...Object.entries(BRANDS), ...Object.entries(NOUNS)]
  .sort((a, b) => b[0].length - a[0].length);

// "adidas hoodie" → ["adidas hoodie", "阿迪达斯 卫衣"]; unknown terms pass
// through untouched; queries with no known terms return just themselves.
export function expandChinaQuery(q) {
  const orig = String(q || '').trim();
  if (!orig) return [orig];
  let padded = ' ' + orig.toLowerCase().replace(/\s+/g, ' ') + ' ';
  let hit = false;
  for (const [en, cn] of ENTRIES) {
    const needle = ' ' + en + ' ';
    if (padded.includes(needle)) { padded = padded.split(needle).join(' ' + cn + ' '); hit = true; }
  }
  const zh = padded.trim().replace(/\s+/g, ' ');
  return hit && zh !== orig.toLowerCase() ? [orig, zh] : [orig];
}
