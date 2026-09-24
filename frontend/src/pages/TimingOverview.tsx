import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle, Clock, ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { WinRateCandles } from "@/components/ui/WinRateCandles";
import { api, type TimingData, type TimingStrategy } from "@/lib/api";
import { TIMING_STRATEGIES } from "@/lib/workspace/modules";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  "增量-抱团": "bg-red-500/15 text-red-400",
  "增量-普涨": "bg-emerald-500/15 text-emerald-400",
  "存量": "bg-blue-500/15 text-blue-400",
  "缩量": "bg-zinc-500/20 text-zinc-300",
  "增量-平衡": "bg-amber-500/15 text-amber-400",
  "过渡": "bg-zinc-500/10 text-zinc-400",
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[stage] ?? "bg-zinc-500/10 text-zinc-400"}`}>
      <Clock className="h-3 w-3" /> {stage}
    </span>
  );
}

// 顶部全局控制条: 粒度 + 剔除688 + 刷新
export function TimingControls({
  granularity, setGranularity, ex688, setEx688, data, setData,
}: {
  granularity: "month" | "day"; setGranularity: (g: "month" | "day") => void;
  ex688: boolean; setEx688: (v: boolean) => void;
  data: TimingData | null;
  setData: (d: TimingData) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!refreshing) return;
    const id = setInterval(async () => {
      try {
        const s = await api.timingRefreshStatus();
        if (s.state === "running" || s.state === "starting") {
          setRefreshMsg(s.elapsed_s != null ? `刷新中… ${Math.floor(s.elapsed_s / 60)}分${s.elapsed_s % 60}秒` : "刷新中…");
        } else if (s.state === "done") {
          setRefreshing(false);
          setRefreshMsg("已刷新");
          api.timing().then(setData).catch(() => {});
          setTimeout(() => setRefreshMsg(null), 3000);
        } else if (s.state === "error") {
          setRefreshing(false);
          setRefreshMsg("刷新失败");
          setTimeout(() => setRefreshMsg(null), 5000);
        }
      } catch { /* 轮询失败忽略 */ }
    }, 4000);
    return () => clearInterval(id);
  }, [refreshing, setData]);

  const onRefresh = useCallback(async () => {
    try {
      const r = await api.timingRefresh();
      if (r.state === "running" && r.already) { setRefreshMsg("刷新已在进行中"); setTimeout(() => setRefreshMsg(null), 3000); return; }
      setRefreshing(true);
      setRefreshMsg("已触发，后台跑完整数据链（约6-10分钟），完成自动重载");
    } catch (e) {
      setRefreshMsg(`触发失败: ${e instanceof Error ? e.message : ""}`);
      setTimeout(() => setRefreshMsg(null), 5000);
    }
  }, []);

  return (
    <GlassCard className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">当前阶段</span>
        {data ? <StageBadge stage={data.regime.stage} /> : <span className="text-xs text-muted-foreground">—</span>}
        {data && <span className="font-mono text-xs text-muted-foreground">截至 {data.regime.current}</span>}
      </div>
      {data?.regime.gap3m != null && <span className="text-xs text-muted-foreground">吸血度3月 <b className={data.regime.gap3m > 0 ? "text-red-400" : "text-emerald-400"}>{(data.regime.gap3m * 100).toFixed(1)}%</b></span>}
      {data?.regime.vol_chg3m != null && <span className="text-xs text-muted-foreground">量能3月 <b>{(data.regime.vol_chg3m * 100).toFixed(1)}%</b></span>}

      <div className="ml-auto flex items-center gap-2">
        {/* 粒度切换 */}
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["month", "day"] as const).map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              className={cn("px-3 py-1.5 text-xs font-medium transition-colors",
                granularity === g ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted")}>
              {g === "month" ? "月线" : "日线"}
            </button>
          ))}
        </div>
        {/* 剔除688 */}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
          <input type="checkbox" checked={ex688} onChange={e => setEx688(e.target.checked)} className="accent-primary" />
          剔除 688
        </label>
        {/* 刷新按钮 */}
        <button onClick={onRefresh} disabled={refreshing}
          className={cn("flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
            refreshing ? "text-muted-foreground/60" : "text-foreground")}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          {refreshing ? "刷新中" : "刷新数据"}
        </button>
      </div>
      {data && <div className="w-full text-right text-[11px] text-muted-foreground">数据生成于 {data.generated_at}（自动: K线每日16:35 / 战法周一9:00）</div>}
      {refreshMsg && <div className="w-full text-right text-[11px] text-amber-500">{refreshMsg}</div>}
    </GlassCard>
  );
}

function StrategyRow({ sig, strat, granularity, ex688 }: { sig: string; strat: TimingStrategy; granularity: "month" | "day"; ex688: boolean }) {
  const candles = ex688
    ? (granularity === "month" ? strat.candles_m_ex688 : strat.candles_d_ex688)
    : (granularity === "month" ? strat.candles_m : strat.candles_d);
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
              <span className="text-[11px] text-muted-foreground">最强阶段 <b className="text-primary">{bestStage}</b> {(best * 100).toFixed(0)}%</span>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          </div>
        </div>
        {candles.length ? (
          <WinRateCandles candles={candles} height={200} granularity={granularity} showVolume={false} />
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
  const [granularity, setGranularity] = useState<"month" | "day">("month");
  const [ex688, setEx688] = useState(false);

  useEffect(() => {
    api.timing().then(setData).catch((e) => setError(e instanceof Error ? e.message : "请求失败")).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="择时 · 战法胜率总览"
        subtitle="每个战法一条胜率 K 线（月线/日线可切）· 点击进单战法看阶段适配与本月信号池"
        actions={<Caliber text={
          "K线语义: 一根K线=该周期内全部持仓中信号的累计收益聚合。\n" +
          "月线: 开盘=上月T10均收益 收盘=本月 上影=当月最好单信号 下影=最差, 底部柱=信号数。\n" +
          "日线: 开盘=前日均收益 收盘=当日 上/下影=当日最好/最差单信号, 柱=覆盖信号数(该日处于10日持仓窗口内的信号)。\n" +
          "剔除688: 统计与信号池同时排除科创板(流动性差)。\n" +
          "红涨绿跌(A股)。数据=十年本地仓库回测, 自动刷新: K线每日16:35 / 战法周一9:00, 也可右上角手动刷新。"
        } />}
      />

      <TimingControls granularity={granularity} setGranularity={setGranularity} ex688={ex688} setEx688={setEx688} data={data} setData={setData} />

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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {TIMING_STRATEGIES.map(({ sig, title }) => {
            const strat = data.strategies[sig];
            return strat
              ? <StrategyRow key={sig} sig={sig} strat={strat} granularity={granularity} ex688={ex688} />
              : (
                <GlassCard key={sig}>
                  <div className="mb-2 text-sm font-semibold">{title}</div>
                  <p className="py-8 text-center text-xs text-muted-foreground">数据源中暂无此战法</p>
                </GlassCard>
              );
          })}
        </div>
      )}
      <Disclaimer />
    </div>
  );
}
