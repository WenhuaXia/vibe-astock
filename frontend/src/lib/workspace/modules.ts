import { Home, Radio, Swords, Eye, LineChart, Briefcase, FlaskConical, Clock } from 'lucide-react';
// Primary navigation follows daily workflows; existing deep links remain valid.

// 择时目录下的战法选项（sig 为 /timing/:sig 路由参数，须与 style_compass SIGNALS code 一致）
export const TIMING_STRATEGIES = [
  { sig: 'deep_dip_coil', title: '深跌双洗底' },
  { sig: 'low_golden', title: '低位12/25金叉' },
  { sig: 'low_reversal', title: '10日新低次日' },
  { sig: 'pullback_ma20', title: '回踩20日线' },
  { sig: 'above_ma60_turn', title: '站60日线拐头' },
  { sig: 'breakout_250', title: '突破250日新高' },
  { sig: 'vol_break_60', title: '放量突破60日高' },
  { sig: 'break_retest', title: '突破后缩量回踩' },
  { sig: 'first_board', title: '首板' },
  { sig: 'consec_board', title: '2连板' },
  { sig: 'wave1_break', title: '1浪突破' },
];

export const MODULES = [
  { title: '首页', to: '/', icon: Home, pages: [{ to: '/', title: '首页' }] },
  { title: '盯盘', to: '/daily-review', icon: Eye, pages: [
    { to: '/daily-review', title: '盘面数据' }, { to: '/watch', title: '实时动态' },
    { to: '/yesterday-ladder', title: '昨日梯队' }, { to: '/agent/intraday', title: '盘中核验' },
  ] },
  { title: '复盘', to: '/agent/review', icon: Swords, pages: [
    { to: '/agent/review', title: '复盘报告' }, { to: '/first-board', title: '首板分析' },
    { to: '/heat', title: '近5天热度' }, { to: '/backtest', title: '历史统计' },
  ] },
  { title: '择时', to: '/timing', icon: Clock, pages: [
    { to: '/timing', title: '胜率总览' },
    ...TIMING_STRATEGIES.map(s => ({ to: `/timing/${s.sig}`, title: s.title })),
  ] },
  { title: '资讯雷达', to: '/intel', icon: Radio, pages: [{ to: '/intel', title: '资讯雷达' }] },
  { title: '个股研究', to: '/stock-data', icon: LineChart, pages: [
    { to: '/stock-data', title: '个股研究' },
    { to: '/agent/deepdive', title: '多空辩论' },
  ] },
  { title: '回测', to: '/backtest-agent', icon: FlaskConical, pages: [{ to: '/backtest-agent', title: '回测' }] },
  { title: '我的股票', to: '/my-stocks', icon: Briefcase, pages: [
    { to: '/my-stocks', title: '持仓自选' }, { to: '/journal', title: '交易日志' }, { to: '/notes', title: '研究记录' },
  ] },
];
export function navigationPath(pathname: string) {
  return ['/portfolio', '/watchlist'].includes(pathname) ? '/my-stocks' : pathname;
}
export function moduleFor(pathname: string) {
  const p = navigationPath(pathname);
  return MODULES.find(module => module.pages.some(page => page.to === p || (p.startsWith('/timing/') && module.to === '/timing')));
}

// These legacy identities are persisted in conversation records and browser recovery keys.
// Keep them stable when navigation labels change; never migrate by display title.
const CHAT_PAGES: Record<string, string> = {
  '/notes': '研究记录',
  '/': '首页', '/intel': '资讯雷达', '/agent/review': '复盘看板',
  '/daily-review': '盘面数据', '/first-board': '首板分析', '/heat': '近5天热度',
  '/backtest': '涨停样本统计', '/watch': '盯盘', '/agent/intraday': '盘中核验',
  '/stock-data': '个股数据', '/timing': '择时总览', '/agent/deepdive': '个股深挖',
  '/portfolio': '持仓股', '/watchlist': '自选股', '/journal': '交易日志',
  '/settings': '接入 AI', '/my-stocks': '我的股票',
  '/yesterday-ladder': '昨日梯队', '/backtest-agent': '策略回测',
};
const TIMING_TITLES: Record<string, string> = Object.fromEntries(TIMING_STRATEGIES.map(s => [`/timing/${s.sig}`, s.title]));
export function chatPageFor(pathname: string) {
  return TIMING_TITLES[pathname] ?? CHAT_PAGES[pathname] ?? '工作空间';
}
