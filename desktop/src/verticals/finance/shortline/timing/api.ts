/** 择时(战法胜率动态)的前端 api —— 移植自 v1 `frontend/src/lib/api.ts` 的 timing 系列。
 *
 *  v1 打的是 Python FastAPI 的 `/market/timing*` 语义端点;v2 底座改成 Node 编排器的
 *  `/api/view/<id>`(view run = 只读, act = POST 动作)。数据形状两版本完全一致
 *  (timing_data.json 离线生成),这里只改路径与解包,页面代码不动。
 *
 *  行情 quote 直接复用 v2 的 `api.quote`(签名与 v1 兼容,页面只读 .name / .float_mcap_yi)。
 */
import { api as v2Api } from "@/lib/api";
import type { TimingData, TimingRefreshResp, TimingRefreshStatus } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(`连接不到编排器 API:${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* 代理错误页是 HTML */ }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in body
      ? String((body as { message: unknown }).message)
      : `请求失败(${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const api = {
  /** 择时总览 + 11 战法胜率 K 线(月) + 阶段适配 + 近期信号 */
  timing: () => call<TimingData>("/view/shortline_timing"),
  /** 手动触发后台刷新(约 6-10 分钟),立即返回 starting/running */
  timingRefresh: () => call<TimingRefreshResp>("/view/shortline_timing", { method: "POST", body: "{}" }),
  /** 轮询刷新进度 */
  timingRefreshStatus: () => call<TimingRefreshStatus>("/view/shortline_timing_status"),
  /** 行情,复用 v2 实现 */
  quote: (codes: string) => v2Api.quote(codes),
};
