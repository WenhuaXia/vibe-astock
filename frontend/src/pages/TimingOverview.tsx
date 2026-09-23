import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle, Clock, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { WinRateCandles } from "@/components/ui/WinRateCandles";
import { api, type TimingData, type TimingStrategy } from "@/lib/api";
import { TIMING_STRATEGIES } from "@/lib/workspace/modules";

const STAGE_COLORS: Record<string, string> = {
  "增量-抱团": "bg-red-500/15 text-red-400",
  "增量-普涨": "bg-emerald-500/15 text-emerald-400",
  "存量": "bg-blue-500/15 text-blue-400",
  "缩量": "bg-zinc-500/20 text-zinc-300",
  "增量-平衡": "bg-amber-500/15 text-amber-400",
  "过渡": "bg-zinc-500/10 text-zinc-400",
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[stage] ?? "bg-zinc-500/10 text-zinc-400"}`}>
      <Clock className="h-3 w-3" /> {stage}
    </span>
  );
}

function StrategyRow({ sig, strat }: { sig: string; strat: TimingStrategy }) {
  const wins = Object.entries(strat.stage_win ?? {}).filter(([, v]) => v !== null) as Array<[string, number]>;
  const best = wins.length ? Math.max(...wins.map(([, v]) => v)) : 0;
  const bestStage = wins.find(([, v]) => v === best)?.[0] ?? "—";
  return (
    <Link to={`/timing/${sig}`} className="block">
      <GlassCard className="hover:border-primary/40 transition-colors">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{strat.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{strat.group}</span>
            {strat.baseline && (
              <span className="font-mono text-[11px] text-muted-foreground">
                十年基线 胜率 {(strat.baseline.win * 100).toFixed(0)}% · 均 {strat.baseline.avg >= 0 ? "+" : ""}{(strat.baseline.avg * 100).toFixed(2)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {bestStage !== "—" && (
              <span className="text-[11px] text-muted-foreground">
                最强阶段 <b className="text-primary">{bestStage}</b> {(best * 100).toFixed(0)}%
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          </div>
        </div>
        {strat.candles.length ? (
          <WinRateCandles candles={strat.candles} height={200} showVolume={false} />
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">该战法暂无信号</p>
        )}
      </GlassCard>
    </Link>
  );
}

export function TimingOverview() {
  const [data, setData] = useState<TimingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.timing().then(setData).catch((e) => setError(e instanceof Error ? e.message : "请求失败")).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="择时 · 战法胜率总览"
        subtitle="每个战法一条月度胜率 K 线 · 点击进单战法看阶段适配与信号池"
        actions={
          <Caliber text={
            "每根月线=该月全部信号 T+10 收益的一根K线：\n" +
            "上影=当月最好单信号，下影=当月最差单信号；开盘=上月均收益，收盘=本月均收益；" +
            "本月上月红、跌绿（A股配色）。底部柱=当月信号数（样本量）。\n" +
            "数据=十年本地K线仓库回测，周一 cron 自动刷新。当前市场阶段用吸血度gap/量能/广度判定（增量抱团/普涨/存量/缩量）。"
          } />
        }
      />

      {loading && (
        <GlassCard className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">加载择时数据…</p>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="flex flex-col items-center gap-3 py-12">
          <AlertCircle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">{error}</p>
        </GlassCard>
      )}

      {data && (
        <>
          <GlassCard className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">当前阶段</span>
              <StageBadge stage={data.regime.stage} />
            </div>
            <span className="font-mono text-xs text-muted-foreground">截至 {data.regime.current}</span>
            {data.regime.gap3m != null && <span className="text-xs text-muted-foreground">吸血度 3月 <b className={data.regime.gap3m > 0 ? "text-red-400" : "text-emerald-400"}>{(data.regime.gap3m * 100).toFixed(1)}%</b></span>}
            {data.regime.vol_chg3m != null && <span className="text-xs text-muted-foreground">量能 3月 <b>{(data.regime.vol_chg3m * 100).toFixed(1)}%</b></span>}
            <span className="ml-auto text-[11px] text-muted-foreground">生成于 {data.generated_at}</span>
          </GlassCard>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {TIMING_STRATEGIES.map(({ sig, title }) => {
              const strat = data.strategies[sig];
              return strat
                ? <StrategyRow key={sig} sig={sig} strat={strat} />
                : (
                  <GlassCard key={sig}>
                    <div className="mb-2 text-sm font-semibold">{title}</div>
                    <p className="py-8 text-center text-xs text-muted-foreground">数据源中暂无此战法</p>
                  </GlassCard>
                );
            })}
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}
