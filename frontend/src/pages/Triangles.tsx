import { useCallback, useEffect, useRef, useState } from "react";
import { Triangle, Loader2, RefreshCw, AlertCircle, Zap, Layers } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { Caliber } from "@/components/ui/Caliber";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api, type TriangleData, type TriangleStock } from "@/lib/api";

const SHAPE_LABEL: Record<TriangleStock["shape"], string> = {
  symmetric: "对称三角",
  descending: "下降三角",
  ascending: "上升三角",
  box: "箱体收敛",
};

const posLabel = (pos: number) =>
  pos > 0.85 ? "贴上沿" : pos < 0.15 ? "贴下沿" : `通道${Math.round(pos * 100)}%`;

const pctCls = (v: number | null) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-red-500" : v < 0 ? "text-green-500" : "text-muted-foreground";

function StockRow({ s, rank }: { s: TriangleStock; rank?: number }) {
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/40">
      {rank != null && (
        <td className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground w-10">
          {rank <= 3 ? <span className="text-primary font-bold">{rank}</span> : rank}
        </td>
      )}
      <td className="px-3 py-2.5">
        <div className="font-medium">{s.name}</div>
        <div className="font-mono text-xs text-muted-foreground">{s.code}</div>
      </td>
      <td className="px-3 py-2.5 text-right font-mono">
        <div>{s.price.toFixed(2)}</div>
        <div className={`text-xs ${pctCls(s.change_pct)}`}>{s.change_pct == null ? "—" : `${s.change_pct > 0 ? "+" : ""}${s.change_pct.toFixed(2)}%`}</div>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs">{s.mcap_yi ? `${s.mcap_yi.toFixed(0)}亿` : "—"}</td>
      <td className="px-3 py-2.5">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{SHAPE_LABEL[s.shape]}</span>
      </td>
      <td className="px-3 py-2.5 text-center font-mono text-xs">{s.window}日</td>
      <td className="px-3 py-2.5 text-center font-mono text-xs" title="1 − 通道右端宽/左端宽，越大收敛越强">
        {Math.round((1 - s.conv_ratio) * 100)}%
      </td>
      <td className="px-3 py-2.5 text-center font-mono text-xs" title="后1/3均量 ÷ 前1/3均量，<1 为缩量">
        {s.vol_shrink.toFixed(2)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs" title="当前通道：下沿~上沿">
        {s.bot_now.toFixed(2)}~{s.top_now.toFixed(2)}
      </td>
      <td className="px-3 py-2.5 text-xs">{posLabel(s.price_pos)}</td>
      <td className="px-3 py-2.5">
        {s.near_break && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Zap className="h-3 w-3" /> 临爆
          </span>
        )}
      </td>
    </tr>
  );
}

const HEAD = (withRank: boolean) => (
  <thead>
    <tr className="border-b border-border text-left text-xs text-muted-foreground">
      {withRank && <th className="px-3 py-2 text-center w-10">#</th>}
      <th className="px-3 py-2">名称 / 代码</th>
      <th className="px-3 py-2 text-right">现价</th>
      <th className="px-3 py-2 text-right">市值</th>
      <th className="px-3 py-2">形态</th>
      <th className="px-3 py-2 text-center">窗口</th>
      <th className="px-3 py-2 text-center">收敛度</th>
      <th className="px-3 py-2 text-center">量缩</th>
      <th className="px-3 py-2">当前通道</th>
      <th className="px-3 py-2">价格位置</th>
      <th className="px-3 py-2">标记</th>
    </tr>
  </thead>
);

export function Triangles() {
  const [data, setData] = useState<TriangleData | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef(0);

  const stopPolling = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setScanning(false);
  }, []);

  const startPolling = useCallback(() => {
    setScanning(true);
    setError(null);
    stopAt.current = Date.now() + 900000; // 15 分钟兜底（熔断态 baostock 串行约 10-12 分钟）
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      if (Date.now() > stopAt.current) { stopPolling(); return; }
      try {
        const st = await api.trianglesStatus();
        if (st.state === "ready" && Array.isArray(st.stocks)) {
          setData(st);
          stopPolling();
        } else if (st.state === "error") {
          setError(st.error || "数据源暂不可用，请稍后重试");
          stopPolling();
        }
      } catch { /* 网络抖动忽略，下一轮再试 */ }
    }, 15000);
  }, [stopPolling]);

  useEffect(() => {
    // 挂载：触发扫描（冷启动/过期自动拉起后台任务），随即开始轮询
    api.triangles(false).then((d) => {
      if (d.state === "ready" && Array.isArray(d.stocks)) { setData(d); stopPolling(); }
      else if (d.state === "error") { setError(d.error || "数据源暂不可用"); stopPolling(); }
      else startPolling();
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : "请求失败"); stopPolling(); });
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startPolling, stopPolling]);

  const rescan = () => {
    setError(null);
    api.triangles(true).then((d) => {
      if (d.state === "ready" && Array.isArray(d.stocks) && !d.stale) { setData(d); stopPolling(); }
      else if (d.state === "error") { setError(d.error || "数据源暂不可用，请稍后再试"); stopPolling(); }
      else startPolling();
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : "重扫请求失败"));
  };

  const stocks = data?.stocks ?? [];
  const candidates = data?.candidates ?? [];
  const hasData = data && Array.isArray(stocks);

  return (
    <div>
      <PageHeader
        title="收敛三角形"
        subtitle="全市场日线形态筛选 · 通道收敛 + 缩量 + 双侧触边 + 未破位"
        actions={
          <button
            type="button"
            onClick={rescan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {scanning ? "扫描中…" : "重新扫描"}
          </button>
        }
      />

      {error && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {hasData && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { label: "扫描范围", value: `${data.scanned} 只`, sub: "市值5~300亿·非ST" },
            { label: "形态命中", value: `${data.hits} 只`, sub: "任一窗口收敛" },
            { label: "严格三角形", value: `${data.strict_count} 只`, sub: "缩量+强收敛+双侧触边" },
            { label: "临爆位", value: `${data.near_break_count} 只`, sub: "价格贴上/下沿" },
            { label: "更新时间", value: data.updated, sub: `耗时 ${data.duration_s}s${data.stale ? " · 重扫中" : ""}` },
          ].map((c) => (
            <GlassCard key={c.label} className="py-3 text-center">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 truncate font-mono text-lg font-bold text-primary">{c.value}</div>
              <div className="text-[10px] text-muted-foreground">{c.sub}</div>
            </GlassCard>
          ))}
        </div>
      )}

      {scanning && !hasData && (
        <GlassCard className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">全市场扫描中…</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">
            约 2500 只沪深 A 股日线 K 线，限速扫描需 3~5 分钟。页面会自动刷新，完成后即展示名单。
          </p>
        </GlassCard>
      )}

      {!scanning && !hasData && error && (
        <GlassCard className="flex flex-col items-center gap-3 py-12">
          <AlertCircle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">{error}</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">
            行情数据源（腾讯/东财 K 线）在高频访问后可能触发临时限流，通常十几分钟到半小时自动恢复。
            恢复后点右侧「重新扫描」即可。
          </p>
          <button
            type="button"
            onClick={rescan}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 重新扫描
          </button>
        </GlassCard>
      )}

      {hasData && (
        <GlassCard>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Triangle className="h-4 w-4 text-primary" /> 严格三角形名单
            {scanning && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Caliber text={
              "判据：日线高低点包络通道（5日）在 20~120 日窗口内单调收窄 ≥30%，右端压缩到 ≤5 倍 ATR，" +
              "后 1/3 量能较前 1/3 萎缩 ≥20%，窗口内上沿与下沿各被 K 线触碰 ≥2 次。\n" +
              "「收敛度」= 1 − 通道右端宽/左端宽；「量缩」= 后1/3均量 ÷ 前1/3均量（<1 为缩量）；" +
              "「临爆」= 价格已贴上沿(>85%)或下沿(<15%)，方向选择临近。\n" +
              "形态分类按包络斜率：对称=顶压低+底抬高；下降=顶压低+底横盘；上升=底抬高+顶横盘；箱体=两侧近平。\n" +
              "全部为客观形态数据，非推荐、非预测，最终确认需人工看图。"
            } />
          </div>
          {stocks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              当前无符合条件的严格三角形（{data.updated} 扫描，基础形态命中 {data.hits} 只）
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-175 text-sm">
                {HEAD(true)}
                <tbody>
                  {stocks.map((s, i) => <StockRow key={s.code} s={s} rank={i + 1} />)}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {hasData && candidates.length > 0 && (
        <GlassCard className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Layers className="h-4 w-4 text-muted-foreground" /> 基础形态候选（未达严格条件，按分数 Top20）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-sm">
              {HEAD(false)}
              <tbody>
                {candidates.map((s) => <StockRow key={s.code} s={s} />)}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {data?.note && <p className="mt-3 text-xs text-muted-foreground">{data.note}</p>}
      <Disclaimer />
    </div>
  );
}
