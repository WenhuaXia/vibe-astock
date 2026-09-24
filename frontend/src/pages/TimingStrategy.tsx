import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, AlertCircle, ArrowLeft, BarChart3, List } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { WinRateCandles } from "@/components/ui/WinRateCandles";
import { api, type TimingData, type TimingStrategy, type TimingSignal } from "@/lib/api";
import { TIMING_STRATEGIES } from "@/lib/workspace/modules";
import { cn } from "@/lib/utils";

const STAGE_ORDER = ["增量-抱团", "增量-平衡", "增量-普涨", "存量", "缩量", "过渡"];

function StageBar({ label, value, max, isBest }: { label: string; value: number | null; max: number; isBest: boolean }) {
  const pct = value == null ? 0 : (value / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-20 shrink-0 text-xs", isBest ? "font-semibold text-primary" : "text-muted-foreground")}>{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-muted/60">
        <div className={cn("h-full rounded transition-all", isBest ? "bg-primary" : "bg-primary/40")} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("w-12 shrink-0 text-right font-mono text-xs", value == null ? "text-muted-foreground/50" : isBest ? "font-semibold text-primary" : "text-foreground")}>
        {value == null ? "—" : `${(value * 100).toFixed(0)}%`}
      </span>
    </div>
  );
}

// 本月信号池: 至今表现 + 换手/近月涨停 + 过滤开关
function MonthPool({ strat }: { strat: TimingStrategy }) {
  const [ex688, setEx688] = useState(false);
  const [minTurnover, setMinTurnover] = useState(false);   // 剔除换手<1%
  const [ztOnly, setZtOnly] = useState(false);             // 只看近月有涨停的
  const [limit, setLimit] = useState(30);

  const rows = useMemo(() => {
    let r = strat.recent;
    if (ex688) r = r.filter(x => !x.is_688);
    if (minTurnover) r = r.filter(x => x.turnover != null && x.turnover >= 1);
    if (ztOnly) r = r.filter(x => x.zt_1m);
    // 按 至今收益 降序
    return [...r].sort((a, b) => (b.ret_now ?? -9) - (a.ret_now ?? -9));
  }, [strat.recent, ex688, minTurnover, ztOnly]);

  const shown = rows.slice(0, limit);
  return (
    <GlassCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><List className="h-4 w-4 text-primary" /> 本月信号池（{strat.month}）</div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            <input type="checkbox" checked={ex688} onChange={e => setEx688(e.target.checked)} className="accent-primary" /> 剔688
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            <input type="checkbox" checked={minTurnover} onChange={e => setMinTurnover(e.target.checked)} className="accent-primary" /> 换手≥1%
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            <input type="checkbox" checked={ztOnly} onChange={e => setZtOnly(e.target.checked)} className="accent-primary" /> 近月有涨停
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2">信号日</th>
              <th className="py-1.5 pr-2">代码</th>
              <th className="py-1.5 pr-2">名称</th>
              <th className="py-1.5 pr-2 text-right">信号日价</th>
              <th className="py-1.5 pr-2 text-right">现价</th>
              <th className="py-1.5 pr-2 text-right">至今</th>
              <th className="py-1.5 pr-2 text-right">换手</th>
              <th className="py-1.5">近月</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <PoolRow key={`${r.code}-${r.date}`} r={r} />
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">过滤后无信号</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button onClick={() => setLimit(l => l + 30)} className="mt-2 w-full rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted">
          显示更多（剩 {rows.length - limit} 条）
        </button>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        换手=最新日换手率快照（腾讯）；近月=信号近22个交易日内出现过涨停；至今收益=信号日收盘→最新收盘。点代码跳个股研究。
      </p>
    </GlassCard>
  );
}

function PoolRow({ r }: { r: TimingSignal }) {
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-muted/30">
      <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{r.date.slice(5)}</td>
      <td className="py-1.5 pr-2">
        <Link to={`/stock-data?symbol=${r.code}`} className="font-mono text-xs text-primary hover:underline">{r.code}</Link>
        {r.is_688 && <span className="ml-1 rounded bg-zinc-500/20 px-1 text-[9px] text-zinc-400">科</span>}
      </td>
      <td className="py-1.5 pr-2 text-xs">{r.name}</td>
      <td className="py-1.5 pr-2 text-right font-mono text-xs">{r.close0 != null ? r.close0.toFixed(2) : "—"}</td>
      <td className="py-1.5 pr-2 text-right font-mono text-xs">{r.price_now != null ? r.price_now.toFixed(2) : "—"}</td>
      <td className={cn("py-1.5 pr-2 text-right font-mono text-xs font-medium", r.ret_now == null ? "text-muted-foreground/50" : r.ret_now >= 0 ? "text-red-500" : "text-green-500")}>
        {r.ret_now == null ? "—" : `${r.ret_now >= 0 ? "+" : ""}${(r.ret_now * 100).toFixed(1)}%`}
      </td>
      <td className={cn("py-1.5 pr-2 text-right font-mono text-xs", r.turnover == null ? "text-muted-foreground/50" : r.turnover < 1 ? "text-muted-foreground/60" : "text-foreground")}>
        {r.turnover == null ? "—" : `${r.turnover.toFixed(1)}%`}
      </td>
      <td className="py-1.5 text-[11px]">
        {r.zt_1m ? <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-400">涨停</span> : <span className="text-muted-foreground/50">—</span>}
        <span className="ml-1 text-muted-foreground/70">{r.stage || ""}</span>
      </td>
    </tr>
  );
}

export function TimingStrategyPage() {
  const { sig } = useParams<{ sig: string }>();
  const [data, setData] = useState<TimingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<"month" | "day">("month");
  const [ex688, setEx688] = useState(false);

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
        <Link to="/timing" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="h-3 w-3" /> 返回择时总览</Link>
        <GlassCard className="flex flex-col items-center gap-3 py-16">
          <AlertCircle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">数据源中暂无此战法（{title}）</p>
        </GlassCard>
      </div>
    );
  }

  const wins = Object.entries(strat.stage_win ?? {}).filter(([, v]) => v !== null) as Array<[string, number]>;
  const maxWin = wins.length ? Math.max(...wins.map(([, v]) => v)) : 0;
  const mLast = strat.candles_m[strat.candles_m.length - 1];

  return (
    <div>
      <Link to="/timing" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回择时总览
      </Link>
      <PageHeader
        title={title}
        subtitle={`${strat.group}风格 · 胜率 K 线（月/日）+ 阶段适配 + 本月信号池`}
        actions={<Caliber text="胜率K线: 月线每根=当月全部信号T+10, 日线每根=当日全部持仓中信号的累计收益(近12月, 可滚轮缩放)。\n阶段适配: 六个市场阶段下该战法胜率, 橙色=最强阶段。\n本月信号池: 每只个股信号日→至今表现, 可剔688/换手<1%/只看近月涨停。" />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">十年基线</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{strat.baseline ? `${(strat.baseline.win * 100).toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">胜率</div>
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">近月均收益</div>
          <div className={cn("mt-1 font-mono text-lg font-bold", mLast && mLast.close >= 0 ? "text-red-500" : "text-green-500")}>{mLast ? `${mLast.close >= 0 ? "+" : ""}${mLast.close.toFixed(1)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{mLast?.month}</div>
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">近月胜率</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{mLast ? `${(mLast.win * 100).toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{mLast ? `${mLast.n} 信号` : ""}</div>
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">当前阶段</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{data.regime.stage}</div>
          <div className="text-[10px] text-muted-foreground">截至 {data.regime.current}</div>
        </GlassCard>
      </div>

      <GlassCard className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" /> 胜率 K 线（{granularity === "month" ? "月度 T+10" : "日线 持仓中信号累计"}）</div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["month", "day"] as const).map(g => (
                <button key={g} onClick={() => setGranularity(g)}
                  className={cn("px-3 py-1 text-xs font-medium transition-colors",
                    granularity === g ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted")}>
                  {g === "month" ? "月线" : "日线"}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
              <input type="checkbox" checked={ex688} onChange={e => setEx688(e.target.checked)} className="accent-primary" /> 剔688
            </label>
          </div>
        </div>
        {(() => {
          const candles = ex688
            ? (granularity === "month" ? strat.candles_m_ex688 : strat.candles_d_ex688)
            : (granularity === "month" ? strat.candles_m : strat.candles_d);
          return candles.length
            ? <WinRateCandles candles={candles} height={360} granularity={granularity} />
            : <p className="py-10 text-center text-xs text-muted-foreground">该战法暂无信号</p>;
        })()}
        {granularity === "day" && <p className="mt-1 text-[10px] text-muted-foreground">日线口径：每根=该日处于 10 日持仓窗口内的全部信号（信号日收盘买入、持有至 T+10）的平均累计收益。滚轮可缩放。</p>}
      </GlassCard>

      <div className="mt-4">
        <GlassCard>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" /> 阶段适配（哪个时期用它最准，十年 T10 胜率）</div>
          <div className="space-y-2">
            {STAGE_ORDER.filter(s => strat.stage_win[s] !== null && strat.stage_win[s] !== undefined).map(stage => (
              <StageBar key={stage} label={stage} value={strat.stage_win[stage]} max={maxWin} isBest={strat.stage_win[stage] === maxWin} />
            ))}
            {wins.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">暂无阶段数据</p>}
          </div>
        </GlassCard>
      </div>

      <div className="mt-4">
        <MonthPool strat={strat} />
      </div>
      <Disclaimer />
    </div>
  );
}

export default TimingStrategyPage;
