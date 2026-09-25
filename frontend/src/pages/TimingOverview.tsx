import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertCircle, Clock, ChevronRight, RefreshCw, TrendingUp, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { WinRateCandles } from "@/components/ui/WinRateCandles";
import { api, type TimingData, type TimingStrategy, type TimingRecRow } from "@/lib/api";
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

// 本月推荐排序表: 当前阶段胜率 × 近3月已结算, 直接给"下周一用什么"的结论
const LIGHT_META: Record<TimingRecRow["light"], { label: string; cls: string }> = {
  prefer: { label: "优先", cls: "bg-emerald-500/15 text-emerald-400" },
  watch: { label: "观望", cls: "bg-zinc-500/20 text-zinc-300" },
  avoid: { label: "禁用", cls: "bg-red-500/15 text-red-400" },
  insufficient: { label: "样本不足", cls: "bg-zinc-500/10 text-zinc-500" },
};

function RecTable({ data }: { data: TimingData }) {
  const rec = data.recommendation;
  const rows = rec.rows;
  return (
    <GlassCard className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">本月推荐 · {data.regime.stage}阶段战法排序</span>
        <Caliber text={
          "按【当前阶段胜率】(十年该阶段全部信号) ×【近3月已结算胜率】综合打分, 当前阶段胜率权重1、近3月权重0.5。\n" +
          "灯号: 优先=当前阶段≥50%且近3月已结算≥50%; 禁用=当前阶段<45%; 观望=中间; 样本不足=当前阶段或近3月样本<5个。\n" +
          "去重机会=近3月该战法覆盖的不同个股数(同一只票多信号计1次)。\n" +
          "胜率均为税前口径(往返成本约0.2%见页面底部)。"
        } />
        {rec.all_below_half && (
          <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
            当前阶段全部战法胜率 &lt;50% → 建议降仓/空仓
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2">战法</th>
              <th className="py-1.5 pr-2 text-right">当前阶段胜率</th>
              <th className="py-1.5 pr-2 text-right">近3月已结算</th>
              <th className="py-1.5 pr-2 text-right">去重机会(近3月)</th>
              <th className="py-1.5 pr-2 text-right">本月信号</th>
              <th className="py-1.5 text-right">结论</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const light = LIGHT_META[r.light];
              return (
                <tr key={r.sig} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                  <td className="py-1.5 pr-2">
                    <Link to={`/timing/${r.sig}`} className="text-xs font-medium hover:text-primary hover:underline">{r.name}</Link>
                    <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{r.group}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs">
                    {r.stage_win == null ? <span className="text-muted-foreground/50">—</span> : (
                      <span className={r.stage_win >= 0.5 ? "text-red-400" : r.stage_win < 0.45 ? "text-green-400" : ""}>
                        {(r.stage_win * 100).toFixed(1)}%
                      </span>
                    )}
                    <span className="ml-1 text-[10px] text-muted-foreground/60">n={r.stage_n ?? 0}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs">
                    {r.settled3_win == null ? <span className="text-muted-foreground/50">—</span> :
                      <span>{(r.settled3_win * 100).toFixed(0)}% <span className="text-[10px] text-muted-foreground/60">n={r.settled3_n}</span></span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs text-muted-foreground">{r.opp3.toLocaleString()}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs text-muted-foreground">{r.n_recent.toLocaleString()}</td>
                  <td className="py-1.5 text-right">
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${light.cls}`}>{light.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

// 多战法共振(P2-7): 同一信号日被≥2战法同时指向的个股, 跨风格共振(左侧+右侧)最强
function ResonanceView({ data }: { data: TimingData }) {
  // (code,date) → 命中的战法签名集合; 只取本月
  const dayHits = useMemo(() => {
    const m = new Map<string, { code: string; date: string; name: string; sigs: string[]; groups: Set<string>; ret?: number }>();
    const curMonth = data.regime.current;
    for (const [sig, st] of Object.entries(data.strategies)) {
      for (const r of st.recent) {
        if (r.date.slice(0, 7) !== curMonth) continue;
        const key = `${r.code}|${r.date}`;
        let e = m.get(key);
        if (!e) { e = { code: r.code, date: r.date, name: r.name, sigs: [], groups: new Set() }; m.set(key, e); }
        e.sigs.push(sig);
        e.groups.add(st.group);
      }
    }
    return Array.from(m.values()).filter(e => e.sigs.length >= 2).sort((a, b) =>
      (b.sigs.length - a.sigs.length) || a.date.localeCompare(b.date));
  }, [data]);

  const isCrossStyle = (g: Set<string>) => g.has("左侧超跌") && (g.has("趋势右侧") || g.has("短线动量") || g.has("打板"));
  const cross = dayHits.filter(e => isCrossStyle(e.groups));
  const [minSigs, setMinSigs] = useState(2);
  const shown = dayHits.filter(e => e.sigs.length >= minSigs).slice(0, 40);
  const sigName = (s: string) => data.strategies[s]?.name ?? s;

  return (
    <GlassCard className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">多战法共振 · {data.regime.current} 同日被≥2战法指向</span>
        <Caliber text={
          "同一信号日被多个战法同时命中的个股(不同战法独立触发, 非人为凑)。\n" +
          "跨风格共振=左侧超跌战法与右侧(趋势/动量/打板)战法同日同时看多同一只——底部超跌与右侧信号互相印证, 比单一风格内共振更强(单风格常是同一天普涨的集体反应)。\n" +
          "注意: 共振=信号聚合度, 不是胜率保证, 需结合当前阶段胜率判断。"
        } />
        <span className="ml-auto text-[11px] text-muted-foreground">
          共 {dayHits.length} 个 · 跨风格 {cross.length} 个
        </span>
        <select value={minSigs} onChange={e => setMinSigs(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground">
          <option value={2}>≥2 战法</option>
          <option value={3}>≥3 战法</option>
          <option value={4}>≥4 战法</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2">信号日</th>
              <th className="py-1.5 pr-2">代码</th>
              <th className="py-1.5 pr-2">名称</th>
              <th className="py-1.5 pr-2 text-center">共振数</th>
              <th className="py-1.5 pr-2">命中战法（跨风格标黄）</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(e => {
              const isCross = isCrossStyle(e.groups);
              return (
                <tr key={`${e.code}-${e.date}`} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                  <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{e.date.slice(5)}</td>
                  <td className="py-1.5 pr-2"><Link to={`/stock-data?symbol=${e.code}`} className="font-mono text-xs text-primary hover:underline">{e.code}</Link></td>
                  <td className="py-1.5 pr-2 text-xs">{e.name}</td>
                  <td className="py-1.5 pr-2 text-center">
                    <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold",
                      e.sigs.length >= 4 ? "bg-emerald-500/20 text-emerald-300" : e.sigs.length === 3 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                      ×{e.sigs.length}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-[11px]">
                    <div className="flex flex-wrap gap-1">
                      {e.sigs.map(s => (
                        <Link key={s} to={`/timing/${s}`}
                          className={cn("rounded px-1.5 py-0.5 hover:underline",
                            isCross ? "bg-amber-500/15 text-amber-300" : "bg-muted text-foreground/80")}>
                          {sigName(s)}
                        </Link>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">本月暂无 {minSigs} 战法以上共振</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length < dayHits.length && <div className="mt-1 text-right text-[11px] text-muted-foreground">显示前 40 条 / 共 {dayHits.length}</div>}
    </GlassCard>
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
        } else {
          // idle / 未知状态兜底：后端重启会让内存态 _state 重置为 idle（不在上述分支），
          // 若不处理则 refreshing 永不为 false → 按钮永久转圈且无恢复路径。后端没进程=没在跑。
          setRefreshing(false);
          setRefreshMsg(null);
        }
      } catch { /* 轮询失败忽略 */ }
    }, 4000);
    return () => clearInterval(id);
  }, [refreshing, setData]);

  const onRefresh = useCallback(async () => {
    try {
      const r = await api.timingRefresh();
      if (r.state === "error") { setRefreshMsg(`触发失败: ${r.error ?? ""}`); setTimeout(() => setRefreshMsg(null), 5000); return; }
      if (r.state === "running" && r.already) { setRefreshMsg(r.note ?? "刷新已在进行中"); setTimeout(() => setRefreshMsg(null), 3000); return; }
      setRefreshing(true);
      setRefreshMsg(r.note ?? "已触发，后台跑完整数据链（约6-10分钟），完成自动重载");
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
        {data && (
          <span className="font-mono text-xs text-muted-foreground">
            第{data.regime.months_in}个月{data.regime.prev_stage ? `（上月：${data.regime.prev_stage}）` : ""}
            {data.regime.provisional && <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-400">月中初判</span>}
          </span>
        )}
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
        subtitle="本月推荐 → 每个战法一条胜率 K 线（月线/日线可切）· 点击进单战法看阶段适配与本月信号池"
        actions={<Caliber text={
          "K线语义: 一根K线=该周期内全部持仓中信号的累计收益聚合。\n" +
          "月线: 开盘=上月T10均收益 收盘=本月 上影=当月最好单信号 下影=最差, 底部柱=信号数。\n" +
          "日线: 开盘=前日均收益 收盘=当日 上/下影=当日最好/最差单信号, 柱=覆盖信号数(该日处于10日持仓窗口内的信号)。\n" +
          "最后一根K线灰色半透明=该周期未走完(信号不全), 仅供参考。\n" +
          "成本口径: 全部胜率/收益为【税前】; 税后=税前-往返约0.2%(佣金万2.5双边+印花税0.05%卖出+滑点0.1%), 单战法页可切换。\n" +
          "幸存者偏差: K线仓库含3只退市股(000004/002731/301139, 占0.06%), 胜率口径已含, 影响可忽略(2026-09-24审计)。\n" +
          "剔除688: 统计与信号池同时排除科创板(流动性差)。\n" +
          "红涨绿跌(A股)。数据=十年本地仓库回测, 自动刷新: K线每日16:35 / 战法周一9:00, 也可右上角手动刷新。"
        } />}
      />

      {data && <RecTable data={data} />}
      {data && <ResonanceView data={data} />}
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
