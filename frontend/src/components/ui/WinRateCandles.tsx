import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { TimingCandle } from "@/lib/api";

// 战法胜率 K 线：一根月线 = 该月全部信号 T+10 收益的"一根K线"
//   open=上月均收益 close=本月均收益 high=本月最好单信号 low=本月最差单信号
// A股配色：本月上月=红、跌=绿。底部叠加样本数 n（第二 grid）。
interface Props {
  candles: TimingCandle[];
  height?: number;
  showVolume?: boolean; // 底部叠加样本数
}

export function WinRateCandles({ candles, height = 300, showVolume = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const months = candles.map(c => c.month);
    const kdata = candles.map(c => [c.open, c.close, c.low, c.high]);
    const vols = candles.map(c => c.n);
    const meta = candles;

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
          const arr = params as Array<{ seriesName: string; data: number[]; axisValue: string; dataIndex: number }>;
          const k = arr.find(x => x.seriesName === "胜率K线");
          if (!k) return "";
          const m = meta[k.dataIndex];
          const d = m.close - m.open;
          const col = d >= 0 ? "text-red-500" : "text-green-500";
          return `<div style="font-size:12px;line-height:1.7">
            <b>${m.month}</b>
            <div>本月均收益 <b class="${col}">${m.close >= 0 ? "+" : ""}${m.close.toFixed(2)}%</b>（上月 ${m.open >= 0 ? "+" : ""}${m.open.toFixed(2)}%）</div>
            <div>当月最好 <span class="text-red-500">+${m.high.toFixed(1)}%</span> · 最差 <span class="text-green-500">${m.low.toFixed(1)}%</span></div>
            <div>T10 胜率 <b>${(m.win * 100).toFixed(0)}%</b> · 信号 ${m.n} 个</div>
          </div>`;
        },
      },
      xAxis: showVolume
        ? [
            { type: "category", data: months, gridIndex: 0, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#2a2d36" } } },
            { type: "category", data: months, gridIndex: 1, axisLabel: { fontSize: 10, color: "#8b8f9a" }, axisLine: { lineStyle: { color: "#2a2d36" } } },
          ]
        : [{ type: "category", data: months, axisLabel: { fontSize: 10, color: "#8b8f9a" }, axisLine: { lineStyle: { color: "#2a2d36" } } }],
      yAxis: showVolume
        ? [
            { type: "value", gridIndex: 0, name: "T10均收益%", nameTextStyle: { fontSize: 10, color: "#8b8f9a" }, axisLabel: { fontSize: 10, color: "#8b8f9a", formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#23252d", type: "dashed" } } },
            { type: "value", gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false }, name: "信号数", nameTextStyle: { fontSize: 9, color: "#8b8f9a" } },
          ]
        : [{ type: "value", name: "T10均收益%", nameTextStyle: { fontSize: 10, color: "#8b8f9a" }, axisLabel: { fontSize: 10, color: "#8b8f9a", formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#23252d", type: "dashed" } } }],
      series: [
        {
          name: "胜率K线", type: "candlestick", data: kdata,
          xAxisIndex: 0, yAxisIndex: 0, barWidth: "62%",
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
        },
        ...(showVolume ? [{
          name: "样本数", type: "bar" as const, data: vols,
          xAxisIndex: 1, yAxisIndex: 1, barWidth: "55%",
          itemStyle: { color: "rgba(139,143,154,0.4)", borderRadius: [2, 2, 0, 0] },
        }] : []),
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.dispose(); chartRef.current = null; };
  }, [candles, height, showVolume]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
