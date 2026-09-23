import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, AlertCircle, ArrowLeft, BarChart3, List } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { WinRateCandles } from "@/components/ui/WinRateCandles";
import { api, type TimingData, type TimingStrategy } from "@/lib/api";
import { TIMING_STRATEGIES } from "@/lib/workspace/modules";
import { cn } from "@/lib/utils";

const STAGE_ORDER = ["增量-抱团", "增量-平衡", "增量-普涨", "存量", "缩量", "过渡"];

function StageBar({ label, value, max, isBest }: { label: string; value: number | null; max: number; isBest: boolean }) {
  const pct = value == null ? 0 : (value / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-20 shrink-0 text-xs", isBest ? "font-semibold text-primary" : "text-muted-foreground")}>{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-muted/60">
        <div
          className={cn("h-full rounded transition-all", isBest ? "bg-primary" : "bg-primary/40")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("w-12 shrink-0 text-right font-mono text-xs", value == null ? "text-muted-foreground/50" : isBest ? "font-semibold text-primary" : "text-foreground")}>
        {value == null ? "—" : `${(value * 100).toFixed(0)}%`}
      </span>
    </div>
  );
}

export function TimingStrategyPage() {
  const { sig } = useParams<{ sig: string }>();
  const [data, setData] = useState<TimingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.timing().then(setData).catch((e) => setError(e instanceof Error ? e.message : "请求失败")).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <GlassCard className="flex flex-col items-center gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">加载战法数据…</p>
      </GlassCard>
    );
  }
  if (error) {
    return (
      <GlassCard className="flex flex-col items-center gap-3 py-16">
        <AlertCircle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-medium">{error}</p>
      </GlassCard>
    );
  }
  if (!data) return null;

  const title = TIMING_STRATEGIES.find(s => s.sig === sig)?.title ?? sig ?? "战法";
  const strat: TimingStrategy | undefined = data?.strategies[sig!];
  if (!strat) {
    return (
      <div>
        <Link to="/timing" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> 返回择时总览</Link>
        <GlassCard className="flex flex-col items-center gap-3 py-16">
          <AlertCircle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">数据源中暂无此战法（{title}）</p>
        </GlassCard>
      </div>
    );
  }

  const wins = Object.entries(strat.stage_win ?? {}).filter(([, v]) => v !== null) as Array<[string, number]>;
  const maxWin = wins.length ? Math.max(...wins.map(([, v]) => v)) : 0;
  const last = strat.candles[strat.candles.length - 1];

  return (
    <div>
      <Link to="/timing" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回择时总览
      </Link>
      <PageHeader
        title={title}
        subtitle={`${strat.group}风格 · 月度胜率 K 线 + 阶段适配 + 近期信号池`}
        actions={<Caliber text="上=该战法月度胜率K线(每根=当月全部信号T+10)；中=六个市场阶段下的胜率对比(哪阶段最适合)；下=近期信号明细(点代码跳个股研究)。" />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">十年基线</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{strat.baseline ? `${(strat.baseline.win * 100).toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">胜率</div>
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">近月均收益</div>
          <div className={cn("mt-1 font-mono text-lg font-bold", last && last.close >= 0 ? "text-red-500" : "text-green-500")}>{last ? `${last.close >= 0 ? "+" : ""}${last.close.toFixed(1)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{last?.month}</div>
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">近月胜率</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{last ? `${(last.win * 100).toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{last ? `${last.n} 信号` : ""}</div>
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">当前阶段</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{data.regime.stage}</div>
          <div className="text-[10px] text-muted-foreground">截至 {data.regime.current}</div>
        </GlassCard>
      </div>

      <GlassCard className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" /> 月度胜率 K 线（T+10 口径）</div>
        {strat.candles.length ? <WinRateCandles candles={strat.candles} height={340} /> : <p className="py-10 text-center text-xs text-muted-foreground">该战法暂无信号</p>}
      </GlassCard>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassCard>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" /> 阶段适配（哪个时期用它最准）</div>
          <div className="space-y-2">
            {STAGE_ORDER.filter(s => strat.stage_win[s] !== null && strat.stage_win[s] !== undefined).map(stage => (
              <StageBar key={stage} label={stage} value={strat.stage_win[stage]} max={maxWin} isBest={strat.stage_win[stage] === maxWin} />
            ))}
            {wins.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">暂无阶段数据</p>}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">橙色高亮=该战法胜率最高的市场阶段。T10 口径。</p>
        </GlassCard>

        <GlassCard>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><List className="h-4 w-4 text-primary" /> 近期信号池（最新 {Math.min(strat.recent.length, 12)} 条）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2">日期</th>
                  <th className="py-1.5 pr-2">代码</th>
                  <th className="py-1.5 pr-2">名称</th>
                  <th className="py-1.5 pr-2 text-right">T+10</th>
                  <th className="py-1.5">阶段</th>
                </tr>
              </thead>
              <tbody>
                {strat.recent.slice(-12).reverse().map((r) => (
                  <tr key={`${r.code}-${r.date}`} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{r.date.slice(5)}</td>
                    <td className="py-1.5 pr-2"><Link to={`/stock-data?code=${r.code}`} className="font-mono text-xs text-primary hover:underline">{r.code}</Link></td>
                    <td className="py-1.5 pr-2 text-xs">{r.name}</td>
                    <td className={cn("py-1.5 pr-2 text-right font-mono text-xs", r.t10 == null ? "text-muted-foreground/50" : r.t10 >= 0 ? "text-red-500" : "text-green-500")}>
                      {r.t10 == null ? "—" : `${r.t10 >= 0 ? "+" : ""}${(r.t10 * 100).toFixed(1)}%`}
                    </td>
                    <td className="py-1.5 text-[11px] text-muted-foreground">{r.stage || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
      <Disclaimer />
    </div>
  );
}

// 路由默认导出名
export default TimingStrategyPage;
