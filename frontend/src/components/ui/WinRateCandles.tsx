import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { TimingCandle } from "@/lib/api";

// 战法胜率 K 线：一根 K 线 = 该周期内全部持仓中信号的累计收益聚合
//   月线: open=上月均收益 close=本月均收益 high/low=本月最好/最差单信号
//   日线: open=前日均收益 close=当日均收益 high/low=当日最好/最差单信号
// 底部柱=样本数 n。A股配色: close>=open 红, else 绿。
interface Props {
  candles: TimingCandle[];
  height?: number;
  granularity?: "month" | "day";
  showVolume?: boolean; // 底部叠加样本数
  inProgress?: boolean; // 最后一根周期未走完(当月/当日信号不全) → 半透明+"进行中"
}

export function WinRateCandles({ candles, height = 300, granularity = "month", showVolume = true, inProgress = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const isDay = granularity === "day";
    const months = candles.map(c => c.month);
    const lastIdx = candles.length - 1;
    // 进行中: 最后一根半透明灰色(K线未走完, 信号不全), tooltip 标注
    const kdata = candles.map((c, i) => {
      const base = [c.open, c.close, c.low, c.high];
      if (inProgress && i === lastIdx) {
        return { value: base, itemStyle: { opacity: 0.5, color: "#9aa0ab", color0: "#9aa0ab", borderColor: "#9aa0ab", borderColor0: "#9aa0ab" } };
      }
      return base;
    });
    const vols = candles.map(c => c.n);
    const meta = candles;
    const periodLabel = isDay ? "当日" : "本月";
    const prevLabel = isDay ? "前日" : "上月";

    chart.setOption({
      animation: false,
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: showVolume
        ? [{ left: 48, right: 14, top: 24, bottom: "26%" }, { left: 48, right: 14, top: "78%", bottom: 18 }]
        : [{ left: 48, right: 14, top: 24, bottom: 28 }],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: unknown) => {
          const arr = params as Array<{ seriesName: string; dataIndex: number }>;
          const k = arr.find(x => x.seriesName === "胜率K线");
          if (!k) return "";
          const m = meta[k.dataIndex];
          const d = m.close - m.open;
          const col = d >= 0 ? "text-red-500" : "text-green-500";
          const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
          const inProg = inProgress && k.dataIndex === candles.length - 1
            ? `<div style="color:#9aa0ab">⏳ 进行中，本周期未结算（信号不全）</div>` : "";
          return `<div style="font-size:12px;line-height:1.7">
            <b>${m.month}</b>
            <div>${periodLabel}均收益 <b class="${col}">${m.close >= 0 ? "+" : ""}${m.close.toFixed(2)}%</b>（${prevLabel} ${m.open >= 0 ? "+" : ""}${m.open.toFixed(2)}%）</div>
            <div>当期最好 <span class="text-red-500">${sign(m.high)}</span> · 最差 <span class="text-green-500">${sign(m.low)}</span></div>
            <div>胜率 <b>${(m.win * 100).toFixed(0)}%</b> · 覆盖信号 ${m.n} 个</div>
            ${inProg}
          </div>`;
        },
      },
      // 日线样本可能少(稀疏月), x轴标签密度自适应
      dataZoom: isDay ? [{ type: "inside", xAxisIndex: showVolume ? [0, 1] : 0 }] : [],
      xAxis: showVolume
        ? [
            { type: "category", data: months, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#2a2d36" } } },
            { type: "category", data: months, gridIndex: 1,
              axisLabel: { fontSize: 10, color: "#8b8f9a", formatter: (v: string) => (isDay ? v.slice(5) : v) },
              axisLine: { lineStyle: { color: "#2a2d36" } } },
          ]
        : [{ type: "category", data: months, axisLabel: { fontSize: 10, color: "#8b8f9a", formatter: (v: string) => (isDay ? v.slice(5) : v) }, axisLine: { lineStyle: { color: "#2a2d36" } } }],
      yAxis: showVolume
        ? [
            { type: "value", gridIndex: 0, name: isDay ? "持仓中信号均收益%" : "T10均收益%", nameTextStyle: { fontSize: 10, color: "#8b8f9a" }, axisLabel: { fontSize: 10, color: "#8b8f9a", formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#23252d", type: "dashed" } } },
            { type: "value", gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false }, name: "信号数", nameTextStyle: { fontSize: 9, color: "#8b8f9a" } },
          ]
        : [{ type: "value", name: isDay ? "持仓中信号均收益%" : "T10均收益%", nameTextStyle: { fontSize: 10, color: "#8b8f9a" }, axisLabel: { fontSize: 10, color: "#8b8f9a", formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#23252d", type: "dashed" } } }],
      series: [
        {
          name: "胜率K线", type: "candlestick", data: kdata,
          xAxisIndex: 0, yAxisIndex: 0,
          barWidth: isDay ? "55%" : "62%",
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
        },
        ...(showVolume ? [{
          name: "样本数", type: "bar" as const, data: vols,
          xAxisIndex: 1, yAxisIndex: 1,
          barWidth: isDay ? "45%" : "55%",
          itemStyle: { color: "rgba(139,143,154,0.4)", borderRadius: [2, 2, 0, 0] },
        }] : []),
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.dispose(); chartRef.current = null; };
  }, [candles, height, granularity, showVolume, inProgress]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
