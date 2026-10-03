/** 匿名昵称与配色的确定性生成：同一用户始终得到同一昵称 */
const ADJ = [
  '安静的', '路过的', '深夜的', '半醒的', '温柔的', '沉默的', '发光的',
  '走神的', '微醺的', '晴朗的', '遥远的', '缓慢的', '安静的', '多云的',
];
const NOUN = [
  '水母', '灯塔', '苔藓', '纸鹤', '晚风', '候鸟', '月台',
  '贝壳', '蒲公英', '旧钟', '星轨', '浮标', '沙丘', '雨伞',
];

export const DANMAKU_COLORS = {
  azure: { label: '雾蓝', hex: '#6BA3F0' },
  teal: { label: '青碧', hex: '#4FB8AE' },
  sand: { label: '暖沙', hex: '#D9A05B' },
  sage: { label: '苔绿', hex: '#8FBF7F' },
  indigo: { label: '黛蓝', hex: '#8A8FE0' },
  rose: { label: '豆沙', hex: '#D98C93' },
  slate: { label: '石青', hex: '#93A5B8' },
  amber: { label: '琥珀', hex: '#D6B45C' },
};

export const EFFECTS = ['glow', 'trace', 'outline', 'shimmer'];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function anonIdentity(seed) {
  const h = hash(String(seed));
  const colorKeys = Object.keys(DANMAKU_COLORS);
  return {
    name: ADJ[h % ADJ.length] + NOUN[Math.floor(h / ADJ.length) % NOUN.length],
    color: colorKeys[Math.floor(h / 97) % colorKeys.length],
  };
}