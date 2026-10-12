/** 择时 11 个战法 —— 从 v1 `frontend/src/lib/workspace/modules.ts` 的 TIMING_STRATEGIES 原样搬。
 *  sig 必须和后端 timing_data.json 里 strategies 的 key 对上(离线数据链产出)。 */
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
] as const;
