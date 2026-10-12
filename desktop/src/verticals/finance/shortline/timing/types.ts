/** 择时(战法胜率动态)的前端类型 —— 从 v1 `frontend/src/lib/api.ts` 原样搬运。
 *  数据由后端离线生成(timing_data.json),结构两版本完全一致,这里只做类型声明。 */

export interface TimingStat { win: number; avg: number; n: number; avg_net?: number }
export interface TimingExpected {
  payoff: number | null;          // 盈亏比 = 均盈/|均亏|
  avg_win: number | null; avg_loss: number | null;
  median: number; p90: number; p10: number;  // 十年已结算T10分位(税前)
  max_consec_lose_months: number; // 月度K线 win<50% 最长连续段
  worst_month: { month: string; close: number; n: number } | null;
}
export interface TimingMae {
  median: number;                 // 持有10日内最大回撤中位数
  p10: number;                    // 10%信号回撤比这还深
  below_8pct: number;             // 触及-8%止损线的信号占比
  n: number;                      // 采样数(2万固定种子)
}
export interface TimingCandle {
  month: string; // 月线=YYYY-MM, 日线=YYYY-MM-DD
  open: number; close: number; high: number; low: number; // 均收益%(open=上一期, close=本期) / 最好 / 最差
  win: number; n: number; // 胜率 / 样本数
}
export interface TimingSignal {
  date: string; code: string; name: string;
  close0: number | null; price_now: number | null; ret_now: number | null; // 信号日价 / 现价 / 至今收益
  turnover: number | null; zt_1m: boolean; is_688: boolean; stage: string; // 换手率(%) / 近月涨停 / 是否688 / 阶段
  settled: boolean; hold_days: number | null; t10: number | null; // T10是否结算 / 已持交易日数 / T10税后收益
  mae: number | null; // 持有10日内最大回撤(负数, 已结算信号)
  industry: string | null; same_ind_n: number | null; // 行业(证监会) / 同日同板块被本战法命中的个股数
  is_bj: boolean; is_st: boolean; // 北交所 / ST
}
export interface TimingRecRow {
  sig: string; name: string; group: string;
  stage_win: number | null; stage_n: number | null;      // 当前阶段胜率/样本
  stage_avg_net: number | null;                           // 当前阶段税后均收益
  excess_vs_random: number | null;                        // 当前阶段胜率超额随机基线
  settled3_win: number | null; settled3_n: number | null; // 近3月已结算胜率/样本
  opp3: number; n_recent: number;
  score: number | null;
  light: "prefer" | "watch" | "avoid" | "insufficient";  // 优先/观望/禁用/样本不足
}
export interface TimingStrategy {
  name: string; group: string;
  candles_m: TimingCandle[]; candles_m_ex688: TimingCandle[];   // 月度
  candles_d: TimingCandle[]; candles_d_ex688: TimingCandle[];   // 日线(近12月)
  baseline: TimingStat | null;                                    // 十年 T10 (税前, 税后见 avg_net)
  stage_win: Record<string, number | null>;                        // 兼容: 纯胜率
  stage_stats: Record<string, TimingStat | null>;                  // 阶段 {win,avg,n,avg_net}
  decay: Record<"y10" | "y3" | "y1", TimingStat | null>;           // 三档衰减
  hold_curve: Record<"T5" | "T10" | "T20", TimingStat | null>;     // 持有期衰减
  expected: TimingExpected | null;                                 // 期望画像(盈亏比/分位/连亏月)
  mae: TimingMae | null;                                           // 持有期最大不利波动(错了亏多少)
  board_open: TimingStat | null;                                   // 打板组: 次日开盘价入场口径(对照收盘买入失真)
  month: string;
  recent: TimingSignal[]; // 本月全量信号
}
export interface TimingData {
  generated_at: string;
  regime: { current: string; stage: string; gap3m: number | null; vol_chg3m: number | null; breadth3m: number | null;
            months_in: number; prev_stage: string | null; provisional: boolean };
  stages: string[];
  daily_range: [string, string];
  stage_month: Record<string, string>;                             // 逐月市场阶段(色带用)
  random_baseline: TimingStat | null;                              // 随机入场T10基准(48%胜率=无脑买入线)
  cost: { round_trip: number; note: string };
  recommendation: { rows: TimingRecRow[]; top: string[]; no_prefer: boolean; all_below_half: boolean };
  survivorship: { kline_codes: number; delisted_in_warehouse: number; note: string };
  strategies: Record<string, TimingStrategy>;
}

/** 刷新触发返回 */
export interface TimingRefreshResp { state: string; already?: boolean; error?: string; note?: string }
/** 刷新进度(前端轮询) */
export interface TimingRefreshStatus { state: string; started_at: number | null; elapsed_s: number | null; last_error: string | null }
