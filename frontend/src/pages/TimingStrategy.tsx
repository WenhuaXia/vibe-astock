import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, AlertCircle, ArrowLeft, BarChart3, List, ArrowUp, ArrowDown, Star, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { WinRateCandles } from "@/components/ui/WinRateCandles";
import { api, type TimingData, type TimingStrategy, type TimingSignal } from "@/lib/api";
import { TIMING_STRATEGIES } from "@/lib/workspace/modules";
import { loadWatch, saveWatch, addCodes } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

const STAGE_ORDER = ["增量-抱团", "增量-平衡", "增量-普涨", "存量", "缩量", "过渡"];
const SMALL_N = 30; // 阶段样本量低于此 → 灰条"样本不足"

function StageBar({ label, value, n, isBest, currentStage }: { label: string; value: number | null; n: number | null; isBest: boolean; currentStage?: boolean }) {
  // 100% 硬显示: 条宽=该阶段胜率本身(0.45→45%条宽, 1.0→满格), 不按最大值归一化
  const small = n == null || n < SMALL_N;
  const pct = value == null || small ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-20 shrink-0 text-xs", isBest && !small ? "font-semibold text-primary" : "text-muted-foreground", currentStage && "underline decoration-dotted")}>{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-muted/60">
        <div className={cn("h-full rounded transition-all", small ? "bg-muted-foreground/25" : isBest ? "bg-primary" : "bg-primary/40")} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("w-28 shrink-0 text-right font-mono text-[11px]", small || value == null ? "text-muted-foreground/50" : isBest ? "font-semibold text-primary" : "text-foreground")}>
        {value == null || small
          ? "样本不足"
          : `${(value * 100).toFixed(0)}% · n=${n?.toLocaleString()}`}
      </span>
    </div>
  );
}

// 三档衰减卡: 10年/3年/1年 胜率, 衰减>10pct 警示
function DecayCard({ decay }: { decay: TimingStrategy["decay"] }) {
  const y10 = decay?.y10, y1 = decay?.y1;
  const decayed = y10 && y1 ? (y10.win - y1.win) * 100 : null;
  return (
    <GlassCard className="py-3 text-center">
      <div className="text-xs text-muted-foreground">三档胜率（10年/3年/1年）</div>
      <div className="mt-1 font-mono text-sm">
        {(["y10", "y3", "y1"] as const).map((k, i) => (
          <span key={k} className={cn("text-base font-bold", k === "y10" ? "text-primary" : "text-foreground/80", i < 2 && "mr-1")}>
            {i < 2 && <span className="text-xs text-muted-foreground/60 mr-1">{["10年", "3年"][i]}</span>}
            {decay?.[k] ? `${(decay[k].win * 100).toFixed(0)}%` : "—"}
          </span>
        ))}
      </div>
      <div className={cn("text-[10px]", decayed != null && decayed > 10 ? "font-medium text-amber-500" : "text-muted-foreground")}>
        {decayed == null ? "" : decayed > 10 ? `⚠ 近1年较10年衰减 ${decayed.toFixed(0)}pct` : `近1年较10年 ${decayed >= 0 ? "-" : "+"}${Math.abs(decayed).toFixed(0)}pct`}
      </div>
    </GlassCard>
  );
}

// 持有期衰减: T5/T10/T20 胜率+均收益
function HoldCurve({ curve }: { curve: TimingStrategy["hold_curve"] }) {
  const keys = ["T5", "T10", "T20"] as const;
  return (
    <GlassCard className="py-3">
      <div className="mb-1.5 text-xs text-muted-foreground">持有期衰减（T5/T10/T20 · 税前）</div>
      <div className="flex items-end gap-4">
        {keys.map((k) => {
          const s = curve?.[k];
          return (
            <div key={k} className="flex-1 text-center">
              <div className={cn("font-mono text-base font-bold", s ? (s.win >= 0.5 ? "text-red-400" : "text-foreground") : "text-muted-foreground/50")}>
                {s ? `${(s.win * 100).toFixed(0)}%` : "—"}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {s ? `${s.avg >= 0 ? "+" : ""}${(s.avg * 100).toFixed(2)}%` : ""}
              </div>
              <div className="text-[10px] text-muted-foreground/70">{k}</div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// 期望画像(P2-1) + 持有期回撤(P2-2): 盈亏比 / 中位数 / 最大连亏月 / 最差单月 / MAE —— 回测与实盘之间最大的鸿沟
function ExpectedCard({ expected, mae }: { expected: NonNullable<TimingStrategy["expected"]>; mae?: NonNullable<TimingStrategy["mae"]> }) {
  const e = expected;
  return (
    <GlassCard className="py-3">
      <div className="mb-1.5 text-xs text-muted-foreground">期望画像（十年已结算 T10 · 税前）</div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-center">
        <div>
          <div className={cn("font-mono text-sm font-bold", (e.payoff ?? 0) >= 1.3 ? "text-red-400" : (e.payoff ?? 0) < 1 ? "text-green-400" : "text-foreground")}>{e.payoff == null ? "—" : e.payoff.toFixed(2)}</div>
          <div className="text-[9px] text-muted-foreground/70">盈亏比</div>
        </div>
        <div>
          <div className="font-mono text-sm font-bold">{e.median >= 0 ? "+" : ""}{(e.median * 100).toFixed(1)}%</div>
          <div className="text-[9px] text-muted-foreground/70">中位数</div>
        </div>
        <div>
          <div className="font-mono text-sm font-bold">{e.max_consec_lose_months}<span className="text-[10px] text-muted-foreground/60"> 月</span></div>
          <div className="text-[9px] text-muted-foreground/70">最大连亏月</div>
        </div>
      </div>
      <div className="mt-1.5 border-t border-border/50 pt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
        <div>P90 <span className="text-red-400/80">{e.p90 >= 0 ? "+" : ""}{(e.p90 * 100).toFixed(1)}%</span> · P10 <span className="text-green-400/80">{e.p10 >= 0 ? "+" : ""}{(e.p10 * 100).toFixed(1)}%</span>{e.avg_win != null && e.avg_loss != null && <> · 均盈 <span className="text-red-400/80">+{(e.avg_win * 100).toFixed(1)}%</span> / 均亏 <span className="text-green-400/80">{(e.avg_loss * 100).toFixed(1)}%</span></>}</div>
        {e.worst_month && <div>最差单月 <span className="text-green-400/80">{e.worst_month.close >= 0 ? "+" : ""}{e.worst_month.close.toFixed(1)}%</span>（{e.worst_month.month}）</div>}
        {mae && (
          <div className="mt-1 rounded bg-muted/40 px-1.5 py-1">
            <div className="text-[9px] text-muted-foreground/70">持有10日内最大回撤（错了亏多少）</div>
            <div>中位 <span className="text-green-400/90">{(mae.median * 100).toFixed(1)}%</span> · <b className={cn(mae.below_8pct >= 0.4 ? "text-red-400" : "text-foreground")}>{(mae.below_8pct * 100).toFixed(0)}%</b> 信号触 -8% 止损线</div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// 本月信号池: T+10已结算/持有中 分区 + 同股去重 + 可买性过滤默认开
type SortKey = "date" | "code" | "name" | "close0" | "price_now" | "ret_now" | "t10" | "mae" | "turnover" | "float_mcap" | "zt_1m";
const SETTLED_COLS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: "date", label: "信号日" },
  { key: "code", label: "代码" },
  { key: "name", label: "名称" },
  { key: "close0", label: "信号日价", num: true },
  { key: "t10", label: "T+10税后", num: true },
  { key: "mae", label: "最大回撤", num: true },
  { key: "turnover", label: "换手", num: true },
  { key: "float_mcap", label: "流通市值", num: true },
  { key: "zt_1m", label: "近月" },
];
const HOLD_COLS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: "date", label: "信号日" },
  { key: "code", label: "代码" },
  { key: "name", label: "名称" },
  { key: "close0", label: "信号日价", num: true },
  { key: "price_now", label: "现价", num: true },
  { key: "ret_now", label: "至今", num: true },
  { key: "turnover", label: "换手", num: true },
  { key: "float_mcap", label: "流通市值", num: true },
  { key: "zt_1m", label: "近月" },
];

function isBuyable(x: TimingSignal, turnoverMin: boolean) {
  if (x.is_st) return false;
  if (x.is_bj) return false;
  if (turnoverMin && (x.turnover == null || x.turnover < 1)) return false;
  return true;
}

function MonthPool({ strat }: { strat: TimingStrategy }) {
  const [ex688, setEx688] = useState(false);
  const [minTurnover, setMinTurnover] = useState(true);   // 默认剔除换手<1%(可买性)
  const [ztOnly, setZtOnly] = useState(false);            // 只看近月有涨停的
  const [expandAll, setExpandAll] = useState(false);       // 展开同股全部信号
  const [showUnbuyable, setShowUnbuyable] = useState(false); // 显示被可买性过滤掉的
  const [limit, setLimit] = useState(30);
  const [watch, setWatch] = useState<string[]>(() => loadWatch());
  // 流通市值: 数据链离线生成时没有, 按当前展示行的去重代码实时拉(腾讯 f44, 批 400)
  const [floatMcap, setFloatMcap] = useState<Record<string, number | null>>({});

  // 分区 + 过滤
  const { settled, holding, filteredOut } = useMemo(() => {
    let r = strat.recent;
    const total = r.length;
    if (ex688) r = r.filter(x => !x.is_688);
    if (ztOnly) r = r.filter(x => x.zt_1m);
    let filteredOut = 0;
    let buyable = r;
    if (!showUnbuyable) {
      buyable = r.filter(x => isBuyable(x, minTurnover));
      filteredOut = r.length - buyable.length;
    }
    const settled = buyable.filter(x => x.settled);
    const holding = buyable.filter(x => !x.settled);
    return { settled, holding, filteredOut, total };
  }, [strat.recent, ex688, ztOnly, showUnbuyable, minTurnover]);

  // 同股去重: 每区各自按 code 聚合, 取最新信号代表 + 次数
  const dedupe = (rows: TimingSignal[]) => {
    const byCode = new Map<string, { latest: TimingSignal; count: number }>();
    for (const x of rows) {
      const cur = byCode.get(x.code);
      if (!cur) byCode.set(x.code, { latest: x, count: 1 });
      else {
        cur.count += 1;
        if (x.date >= cur.latest.date) cur.latest = x;
      }
    }
    return Array.from(byCode.values());
  };
  const settledView: { latest: TimingSignal; count: number }[] = expandAll ? settled.map(x => ({ latest: x, count: 1 })) : dedupe(settled);
  const holdingView: { latest: TimingSignal; count: number }[] = expandAll ? holding.map(x => ({ latest: x, count: 1 })) : dedupe(holding);

  const [sKey, setSKey] = useState<SortKey>("t10");
  const [sDesc, setSDesc] = useState(true);
  const [hKey, setHKey] = useState<SortKey>("date");
  const [hDesc, setHDesc] = useState(true);

  const sortRows = (rows: { latest: TimingSignal; count: number }[], key: SortKey, desc: boolean, floatMcap: Record<string, number | null>) => {
    const dir = desc ? -1 : 1;
    const val = (x: { latest: TimingSignal; count: number }): string | number | boolean | null => {
      const r = x.latest;
      if (key === "float_mcap") return floatMcap[r.code] ?? null;
      return (r as unknown as Record<string, unknown>)[key] as string | number | boolean | null;
    };
    return [...rows].sort((a, b) => {
      const av = val(a); const bv = val(b);
      if (av == null && bv == null) return (b.count - a.count) || 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  };
  const settledShown = sortRows(settledView, sKey, sDesc, floatMcap).slice(0, limit);
  const holdingShown = sortRows(holdingView, hKey, hDesc, floatMcap).slice(0, limit);
  const shown = [...settledShown, ...holdingShown].map(v => v.latest);

  const onSort = (key: SortKey, zone: "s" | "h") => {
    const set = zone === "s" ? [sKey, setSKey, sDesc, setSDesc] : [hKey, setHKey, hDesc, setHDesc];
    const [cur, setCur, curDesc, setCurDesc] = set as [SortKey, (k: SortKey) => void, boolean, (d: boolean) => void];
    if (key === cur) setCurDesc(!curDesc);
    else { setCur(key); setCurDesc(key === "date" || key === "close0" || key === "price_now" || key === "ret_now" || key === "t10" || key === "turnover" || key === "float_mcap"); }
  };

  // 展示行(去重代码)变化时, 分批拉流通市值。依赖"排序后去重的代码串"(与顺序无关),
  // 避免 rows 因 floatMcap 变化重排 → shown 新引用 → 反复重拉的死循环。
  const shownCodes = useMemo(
    () => Array.from(new Set(shown.map(r => r.code))).sort().join(","),
    [settledShown, holdingShown],
  );
  useEffect(() => {
    if (!shownCodes) { setFloatMcap({}); return; }
    const codes = shownCodes.split(",");
    let alive = true;
    (async () => {
      const acc: Record<string, number | null> = {};
      for (let i = 0; i < codes.length; i += 400) {
        const chunk = codes.slice(i, i + 400);
        try {
          const q = await api.quote(chunk.join(","));
          for (const c of chunk) acc[c] = q[c]?.float_mcap_yi ?? null;
        } catch {
          for (const c of chunk) acc[c] = null;
        }
        if (!alive) return;
      }
      if (alive) setFloatMcap(acc);
    })();
    return () => { alive = false; }
  }, [shownCodes]);

  // 星标: 已自选→点掉(取消); 未自选→加入
  const toggleWatch = (code: string, name: string) => {
    const inWatch = watch.includes(code);
    try {
      if (inWatch) {
        const next = watch.filter(c => c !== code);
        saveWatch(next); setWatch(next);
        toast(`已取消自选：${code} ${name}`);
      } else {
        const { next } = addCodes(watch, code);
        saveWatch(next); setWatch(next);
        toast(`已加入自选：${code} ${name}`);
      }
    } catch (e) { toast(e instanceof Error ? e.message : "更新自选失败"); }
  };
  // 把当前过滤+排序后的展示行(去重)一键并入自选
  const addShown = () => {
    const codes = Array.from(new Set(shown.map(r => r.code)));
    if (codes.length === 0) { toast("当前没有可加入的信号"); return; }
    try {
      const { next, added } = addCodes(watch, codes.join(","));
      saveWatch(next); setWatch(next);
      toast(added > 0 ? `已加入自选 ${added} 只（去重后共 ${codes.length} 只）` : "这些代码都已在自选中");
    } catch (e) { toast(e instanceof Error ? e.message : "加入自选失败"); }
  };

  const renderTable = (cols: Array<{ key: SortKey; label: string; num?: boolean }>, view: { latest: TimingSignal; count: number }[], key: SortKey, desc: boolean, zone: "s" | "h", isSettled: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {cols.map(col => {
              const active = key === col.key;
              return (
                <th key={col.key} className={cn("py-1.5 pr-2", col.num && "text-right")}>
                  <button onClick={() => onSort(col.key, zone)}
                    className={cn("inline-flex items-center gap-0.5 hover:text-foreground transition-colors",
                      col.num && "flex-row-reverse", active && "text-primary")}>
                    {col.label}
                    {active
                      ? (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)
                      : <span className="inline-block h-1 w-1 rounded-full bg-muted-foreground/40" />}
                  </button>
                </th>
              );
            })}
            <th className="py-1.5 pr-1 text-right"><Star className="ml-auto h-3 w-3" /></th>
          </tr>
        </thead>
        <tbody>
          {view.map((v) => {
            const r = v.latest;
            return (
              <PoolRow key={`${r.code}-${r.date}`} r={r} count={v.count} floatMcap={floatMcap[r.code]}
                watched={watch.includes(r.code)} onToggle={() => toggleWatch(r.code, r.name)} showT10={isSettled} />
            );
          })}
          {view.length === 0 && (
            <tr><td colSpan={cols.length + 1} className="py-5 text-center text-xs text-muted-foreground">过滤后无信号</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <GlassCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><List className="h-4 w-4 text-primary" /> 本月信号池（{strat.month}）</div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={addShown} title="把当前列表（过滤+排序后）去重一键加入自选"
            className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20">
            <BookmarkPlus className="h-3 w-3" /> 列表加入自选
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            <input type="checkbox" checked={ex688} onChange={e => setEx688(e.target.checked)} className="accent-primary" /> 剔688
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] text-primary hover:bg-primary/10">
            <input type="checkbox" checked={minTurnover} onChange={e => setMinTurnover(e.target.checked)} className="accent-primary" /> 剔除难买(换手&lt;1%/ST/北交所)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            <input type="checkbox" checked={ztOnly} onChange={e => setZtOnly(e.target.checked)} className="accent-primary" /> 近月有涨停
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            <input type="checkbox" checked={expandAll} onChange={e => setExpandAll(e.target.checked)} className="accent-primary" /> 展开全部信号
          </label>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>已结算 <b className="text-foreground">{settled.length.toLocaleString()}</b> 条 · 持有中 <b className="text-foreground">{holding.length.toLocaleString()}</b> 条</span>
        {!expandAll && <span>同股已去重（×N=当月信号次数）</span>}
        {!showUnbuyable && filteredOut > 0 && (
          <button onClick={() => setShowUnbuyable(true)} className="text-primary hover:underline">已滤 {filteredOut.toLocaleString()} 条难买信号，点击查看</button>
        )}
        {showUnbuyable && filteredOut > 0 && (
          <button onClick={() => setShowUnbuyable(false)} className="text-primary hover:underline">隐藏 {filteredOut.toLocaleString()} 条难买信号</button>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500/70" /> T+10 已结算（持有期满，真实战绩）
          </div>
          {renderTable(SETTLED_COLS, settledShown, sKey, sDesc, "s", true)}
          {settled.length > limit && (
            <button onClick={() => setLimit(l => l + 30)} className="mt-1.5 w-full rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted">
              显示更多（剩 {settled.length - limit} 条）
            </button>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-amber-400/90">
            <span className="h-2 w-2 rounded-full bg-amber-500/60" /> 持有中（未结算 · 仅供参考，持满10个交易日后移入上区）
          </div>
          {renderTable(HOLD_COLS, holdingShown, hKey, hDesc, "h", false)}
          {holding.length > limit && (
            <button onClick={() => setLimit(l => l + 30)} className="mt-1.5 w-full rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted">
              显示更多（剩 {holding.length - limit} 条）
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        T+10税后=信号日收盘买入持有10个交易日、扣往返成本(约0.2%)；至今=信号日收盘→最新收盘(未结算)。
        换手=最新日换手率快照（腾讯）；流通市值=实时行情（腾讯 f44，当前页展示行，千亿/亿自适应）；近月=信号近22个交易日内出现过涨停。
        点代码跳个股研究；点星标加入/取消自选（实心=已在自选，点击可取消）；右上「列表加入自选」批量并入。
        默认过滤: 换手&lt;1%(难成交) / ST / 北交所。
      </p>
    </GlassCard>
  );
}

function PoolRow({ r, count, floatMcap, watched, onToggle, showT10 }: { r: TimingSignal; count: number; floatMcap: number | null; watched: boolean; onToggle: () => void; showT10: boolean }) {
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-muted/30">
      <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{r.date.slice(5)}</td>
      <td className="py-1.5 pr-2">
        <Link to={`/stock-data?symbol=${r.code}`} className="font-mono text-xs text-primary hover:underline">{r.code}</Link>
        {count > 1 && <span className="ml-1 rounded bg-primary/15 px-1 text-[10px] font-medium text-primary" title={`当月共 ${count} 次信号`}>×{count}</span>}
        {r.is_688 && <span className="ml-1 rounded bg-zinc-500/20 px-1 text-[9px] text-zinc-400">科</span>}
      </td>
      <td className="py-1.5 pr-2 text-xs">
        {r.name}
        {r.is_st && <span className="ml-1 rounded bg-red-500/20 px-1 text-[9px] font-medium text-red-400">ST</span>}
      </td>
      <td className="py-1.5 pr-2 text-right font-mono text-xs">{r.close0 != null ? r.close0.toFixed(2) : "—"}</td>
      {showT10 ? (
        <>
          <td className={cn("py-1.5 pr-2 text-right font-mono text-xs font-medium", r.t10 == null ? "text-muted-foreground/50" : r.t10 >= 0 ? "text-red-500" : "text-green-500")}>
            {r.t10 == null ? "—" : `${r.t10 >= 0 ? "+" : ""}${(r.t10 * 100).toFixed(2)}%`}
          </td>
          <td className={cn("py-1.5 pr-2 text-right font-mono text-xs", r.mae == null ? "text-muted-foreground/50" : r.mae <= -0.08 ? "text-amber-400" : "text-muted-foreground")}>
            {r.mae == null ? "—" : `${(r.mae * 100).toFixed(1)}%`}
          </td>
        </>
      ) : (
        <>
          <td className="py-1.5 pr-2 text-right font-mono text-xs">{r.price_now != null ? r.price_now.toFixed(2) : "—"}</td>
          <td className={cn("py-1.5 pr-2 text-right font-mono text-xs font-medium", r.ret_now == null ? "text-muted-foreground/50" : r.ret_now >= 0 ? "text-red-500" : "text-green-500")}>
            {r.ret_now == null ? "—" : `${r.ret_now >= 0 ? "+" : ""}${(r.ret_now * 100).toFixed(1)}%`}
            {r.hold_days != null && <span className="ml-1 text-[10px] font-normal text-muted-foreground/60">D{r.hold_days}</span>}
          </td>
        </>
      )}
      <td className={cn("py-1.5 pr-2 text-right font-mono text-xs", r.turnover == null ? "text-muted-foreground/50" : r.turnover < 1 ? "text-muted-foreground/60" : "text-foreground")}>
        {r.turnover == null ? "—" : `${r.turnover.toFixed(1)}%`}
      </td>
      <td className="py-1.5 pr-2 text-right font-mono text-xs">
        {floatMcap == null ? <span className="text-muted-foreground/50">—</span>
          : floatMcap >= 100 ? <span>{(floatMcap / 100).toFixed(2)}千亿</span>
          : <span>{floatMcap.toFixed(0)}亿</span>}
      </td>
      <td className="py-1.5 text-[11px]">
        {r.zt_1m ? <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-400">涨停</span> : <span className="text-muted-foreground/50">—</span>}
        <span className="ml-1 text-muted-foreground/70">{r.stage || ""}</span>
      </td>
      <td className="py-1.5 pr-1 text-right">
        <button onClick={onToggle} title={watched ? "点击取消自选" : "点击加入自选股"}
          className={cn("rounded p-1 transition-colors",
            watched ? "text-primary hover:text-red-500" : "text-muted-foreground/40 hover:text-primary hover:bg-muted")}>
          <Star className={cn("h-3.5 w-3.5", watched && "fill-current")} />
        </button>
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
  const [net, setNet] = useState(false); // 成本口径切换: 税前/税后

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

  const stats = strat.stage_stats ?? {};
  const bestStage = STAGE_ORDER
    .filter(s => (stats[s]?.n ?? 0) >= SMALL_N)
    .sort((a, b) => (stats[b]?.win ?? 0) - (stats[a]?.win ?? 0))[0] ?? null;
  const curStageStat = stats[data.regime.stage] ?? null;
  const mLast = strat.candles_m[strat.candles_m.length - 1];
  const baseAvg = net && strat.baseline?.avg_net != null ? strat.baseline.avg_net : strat.baseline?.avg;

  return (
    <div>
      <Link to="/timing" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回择时总览
      </Link>
      <PageHeader
        title={title}
        subtitle={`${strat.group}风格 · 胜率 K 线 + 三档衰减 + 阶段适配(含样本量) + 本月信号池(已结算/持有中分区)`}
        actions={<Caliber text={
          "胜率K线: 月线每根=当月全部信号T+10, 日线每根=当日全部持仓中信号的累计收益(近12月, 可滚轮缩放)。最后一根灰色=进行中, 未结算。K线背景色带=该期市场阶段(红=增量抱团/橙=增量平衡/绿=增量普涨/蓝=存量/灰=缩量/浅灰=过渡), 把战法表现与环境对照着看。\n" +
          "期望画像: 盈亏比=十年已结算T10的均盈/均亏; 最大连亏月=月度胜率<50%的最长连续段; 最差单月=十年里均收益最低的月。用来判断拿得住拿不住——中位数为负说明一半信号是亏的, 靠少数大赚拉回来。\n" +
          "成本口径: 默认【税前】; 勾选税后=税前-往返约0.2%(佣金万2.5双边+印花税0.05%卖出+滑点0.1%)。\n" +
          "三档胜率: 10年/3年/1年全部已结算T+10信号; 近1年较10年衰减>10pct标黄警示。\n" +
          "持有期衰减: T5/T10/T20 三持有期的胜率与均收益, 看收益集中在哪段。\n" +
          "阶段适配: 六个市场阶段下该战法的T10胜率/样本量/均收益(税前), 橙色=最强阶段(样本≥30); 样本<30灰条标\"样本不足\"; 带下划线=当前阶段。\n" +
          "本月信号池: 分【T+10已结算】(真实战绩, 含税后列)与【持有中】(未结算·参考, 显示已持天数D N); 同股去重×N=当月信号次数; 默认过滤难买(换手<1%/ST/北交所)。\n" +
          "幸存者偏差: K线仓库含3只退市股(0.06%), 影响可忽略(2026-09-24审计)。\n" +
          "红涨绿跌(A股)。"
        } />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <GlassCard className="relative py-3 text-center">
          <button onClick={() => setNet(v => !v)} title="税前/税后切换"
            className={cn("absolute right-1.5 top-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              net ? "border-amber-500/50 bg-amber-500/15 text-amber-400" : "border-border text-muted-foreground hover:bg-muted")}>
            {net ? "税后" : "税前"}
          </button>
          <div className="text-xs text-muted-foreground">十年基线（T10）</div>
          <div className="mt-1 font-mono text-lg font-bold text-primary">{strat.baseline ? `${(strat.baseline.win * 100).toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">胜率{baseAvg != null && ` · 均${baseAvg >= 0 ? "+" : ""}${(baseAvg * 100).toFixed(2)}%`}</div>
          {strat.baseline && <div className="text-[10px] text-muted-foreground/60">n={strat.baseline.n.toLocaleString()}</div>}
        </GlassCard>
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">当前阶段（{data.regime.stage}）</div>
          <div className={cn("mt-1 font-mono text-lg font-bold", curStageStat ? (curStageStat.win >= 0.5 ? "text-red-400" : "text-foreground") : "text-muted-foreground/50")}>
            {curStageStat ? `${(curStageStat.win * 100).toFixed(0)}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">{curStageStat ? `n=${curStageStat.n.toLocaleString()}` : "无样本"}</div>
        </GlassCard>
        <DecayCard decay={strat.decay} />
        <HoldCurve curve={strat.hold_curve} />
        <GlassCard className="py-3 text-center">
          <div className="text-xs text-muted-foreground">近月（{mLast?.month}）</div>
          <div className={cn("mt-1 font-mono text-lg font-bold", mLast && mLast.close >= 0 ? "text-red-500" : "text-green-500")}>{mLast ? `${mLast.close >= 0 ? "+" : ""}${mLast.close.toFixed(1)}%` : "—"}</div>
          <div className="text-[10px] text-muted-foreground">{mLast ? `胜率 ${(mLast.win * 100).toFixed(0)}% · n=${mLast.n.toLocaleString()} ⏳进行中` : ""}</div>
        </GlassCard>
        {strat.expected && <ExpectedCard expected={strat.expected} mae={strat.mae ?? undefined} />}
      </div>

      <GlassCard className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" /> 胜率 K 线（{granularity === "month" ? "月度 T+10" : "日线 持仓中信号累计"} · 税前）</div>
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
            ? <WinRateCandles candles={candles} height={360} granularity={granularity} inProgress stageByMonth={data.stage_month} />
            : <p className="py-10 text-center text-xs text-muted-foreground">该战法暂无信号</p>;
        })()}
        {granularity === "day" && <p className="mt-1 text-[10px] text-muted-foreground">日线口径：每根=该日处于 10 日持仓窗口内的全部信号（信号日收盘买入、持有至 T+10）的平均累计收益。滚轮可缩放。最后一根=当日未走完。</p>}
      </GlassCard>

      <div className="mt-4">
        <GlassCard>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" /> 阶段适配（哪个时期用它最准 · T10 税前 · 橙色=最强{bestStage ? `（${bestStage}）` : ""}）
          </div>
          <div className="space-y-2">
            {STAGE_ORDER.map(stage => {
              const st = stats[stage];
              return (
                <div key={stage} className="flex items-center gap-3">
                  <StageBar label={stage} value={st?.win ?? null} n={st?.n ?? null} isBest={stage === bestStage} currentStage={stage === data.regime.stage} />
                  <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {st ? `均${st.avg >= 0 ? "+" : ""}${(st.avg * 100).toFixed(2)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">样本量 n&lt;30 的阶段标灰「样本不足」，其胜率不做参考；下划线=当前市场阶段。</p>
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
