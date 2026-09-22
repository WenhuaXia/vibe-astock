import { apiUrl } from "./base";
// 用户 LLM 配置 —— **服务端单一来源**（GET/POST /api/llm-config →
// ~/.duanxian-agents/llm_config.json，0600）。改配置即生效，不用重启后端。
// localStorage 仅作**迁移/离线回退**：服务端无配置时读一次旧值并自动迁回服务端。

import { ApiError, authHeaders } from "./api";
import { blockedReason, cliAvailability, cliKindOf, isCliProvider, serverAllowsCli,
  type ProviderId } from "./ai-models";

export interface LlmConfig {
  provider: ProviderId;
  baseURL: string; // CLI 订阅时留空
  apiKey: string;  // CLI 订阅时留空
  model: string;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  trace: { tool: string; args: Record<string, unknown> }[];
  rounds: number;
}

const KEY = "vr-llm";

// 服务端原始配置（与 /api/llm-config 的 GET/POST body 同形）
interface ServerCfg {
  configured?: boolean;
  provider?: string;
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

// 配置是否完整：CLI 有 model 即可；API 需 baseURL + key + model。
function cfgComplete(c: LlmConfig | null | undefined): boolean {
  return !!c && !!c.model && (isCliProvider(c.provider) || (!!c.baseURL && !!c.apiKey));
}

// ---------------------------------------------------------------- 迁移/回退（localStorage 旧值）
function readLocalRaw(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LlmConfig;
  } catch {
    return null;
  }
}

export function staleBlockedProvider(cfg?: LlmConfig | null): string | null {
  // cfg 缺省 → 读 localStorage 旧值（迁移窗口 / 首屏未拉回前）；
  // 传了（通常是服务端配置）→ 直接判它。判据**只能用服务端答案**（serverAllowsCli），
  // 不能按静态表一律拒绝 —— 否则 VIBE_ALLOW_UNSAFE_CLI opt-in 放开的 provider 会被误报成「已禁用」。
  try {
    const c = cfg === undefined ? readLocalRaw() : cfg;
    if (!c) return null;
    const p = c.provider;
    if (serverAllowsCli(p) !== false) return null;   // 能用 / 还不知道 → 不报
    const st = cliAvailability()?.clis.find((x) => x.kind === cliKindOf(p));
    if (st && !st.allowed) return blockedReason(p) ?? st.reason ?? "已禁用";
    if (st && !st.installed) return "本机未安装这个命令";
    return blockedReason(p) ?? "不可用";
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 服务端读写 + 模块级缓存
// 全站都在问"配没配 AI"（AskAiButton / DeepDive / chatStream / Settings）。
// 用一个 in-flight promise：首屏 primeLlmConfig() 拉一次，之后同页共用；
// 保存/清除后 invalidateLlmConfig() 让下一次 loadLlm 重新拉。
let _inflight: Promise<LlmConfig | null> | null = null;

async function fetchLlm(): Promise<LlmConfig | null> {
  let resp: Response;
  try {
    resp = await fetch(apiUrl("/api/llm-config"), { headers: authHeaders() });
  } catch {
    return null; // 后端没起来 → 交给下面的 localStorage 回退
  }
  if (resp.status === 401) {
    // 鉴权失败不该静默丢配置 —— 让调用方（Settings 回显）看到错误
    throw new ApiError("后端开启了访问鉴权（VR_API_KEY）：请在「接入 AI」页底部填写后端访问密钥", 401);
  }
  if (!resp.ok) return null;
  const data = (await resp.json().catch(() => null)) as ServerCfg | null;
  if (!data || !data.configured) return null;
  return {
    provider: (data.provider || "") as ProviderId,
    baseURL: data.baseURL || "",
    apiKey: data.apiKey || "",
    model: data.model || "",
  };
}

async function resolveLlm(): Promise<LlmConfig | null> {
  const srv = await fetchLlm();
  if (srv && cfgComplete(srv) && serverAllowsCli(srv.provider) !== false) {
    try { localStorage.removeItem(KEY); } catch { /* 隐私模式等 */ }  // 服务端胜出 → 清掉迁移残留
    return srv;
  }

  // 服务端无配置（或该 CLI 被服务端禁）→ 回退读一次 localStorage 旧值。
  // 本地旧值同样**用服务端答案**判（serverAllowsCli），不能按静态表一律拒绝。
  const c = readLocalRaw();
  if (!c || !cfgComplete(c) || serverAllowsCli(c.provider) === false) {
    if (c) { try { localStorage.removeItem(KEY); } catch { /* 隐私模式等 */ } }
    return null;
  }
  // **自动迁移**：仅当服务端确实「无配置」时才把旧值搬回服务端（saveLlm 成功后清 localStorage），
  // 保证不丢；迁移失败不清 localStorage（下次 loadLlm 再试）。
  if (srv === null) saveLlm(c).catch(() => { /* 迁移失败不阻塞回显 */ });
  return c;
}

export function loadLlm(): Promise<LlmConfig | null> {
  if (!_inflight) _inflight = resolveLlm();
  return _inflight;
}

/** 让下一次 loadLlm 重新拉服务端（保存/清除后调）。 */
export function invalidateLlmConfig() {
  _inflight = null;
}

/** 首屏预热（main.tsx 调一次，不阻塞渲染）。 */
export function primeLlmConfig(): Promise<LlmConfig | null> {
  return loadLlm();
}

export async function saveLlm(cfg: LlmConfig): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(apiUrl("/api/llm-config"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(cfg),
    });
  } catch {
    throw new ApiError("连接不到后端，配置没保存成功", 0);
  }
  if (resp.status === 401) {
    throw new ApiError("后端开启了访问鉴权（VR_API_KEY）：请在「接入 AI」页底部填写后端访问密钥", 401);
  }
  if (!resp.ok) {
    const body: any = await resp.json().catch(() => null);
    throw new ApiError(body?.detail || `HTTP ${resp.status}`, resp.status);
  }
  invalidateLlmConfig();
  try { localStorage.removeItem(KEY); } catch { /* 迁移源清掉，避免旧值复活 */ }
}

export async function clearLlm(): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(apiUrl("/api/llm-config"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ provider: "", baseURL: "", apiKey: "", model: "" }),
    });
  } catch {
    throw new ApiError("连接不到后端，配置没清除", 0);
  }
  if (!resp.ok) throw new ApiError(`HTTP ${resp.status}`, resp.status);
  invalidateLlmConfig();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function hasLlm(): Promise<boolean> {
  return loadLlm().then((c) => c !== null);
}

export interface ChatHandlers {
  sessionId?: string;                          // UI 侧会话分组（后端 /api/chat 不消费，仅前端多轮窗口用）
  onDelta?: (text: string) => void;             // 答案逐块吐字
  onTool?: (tool: string, args: Record<string, unknown>) => void; // AI 调了某数据工具
}

// 流式调后端 /api/chat（NDJSON：每行一个事件 {type: tool|delta|done|error}）。
// 边流边回调 onDelta/onTool；返回累积的最终 {content, trace, rounds}。
// signal：调用方可传 AbortController.signal，用户关面板/换问题时中止请求（省订阅/API 额度）。
export async function chatStream(messages: ChatMsg[], context: string, handlers: ChatHandlers = {}, signal?: AbortSignal): Promise<ChatResult> {
  const llm = await loadLlm();
  if (!llm) throw new ApiError("尚未接入 AI，请先在「接入 AI」里配置", 400);

  let resp: Response;
  try {
    resp = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ messages, context, llm }),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e; // 主动中止，原样抛给调用方
    throw new ApiError("连接不到后端，请先在项目根目录启动：python server.py（默认 8910）", 0);
  }
  // 配置错误（缺 key / 未装 CLI）在流开始前以 HTTP 400 返回
  if (!resp.ok) {
    let body: any = null;
    try { body = await resp.json(); } catch { /* ignore */ }
    if (resp.status === 401) {
      throw new ApiError("后端开启了访问鉴权（VR_API_KEY）：请在「接入 AI」页底部填写后端访问密钥", 401);
    }
    throw new ApiError(body?.detail || `HTTP ${resp.status}`, resp.status);
  }
  if (!resp.body) throw new ApiError("后端无响应流", 502);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let trace: ChatResult["trace"] = [];
  let rounds = 0;
  let errMsg: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let ev: any;
      try { ev = JSON.parse(t); } catch { continue; }
      if (ev.type === "delta") { content += ev.text; handlers.onDelta?.(ev.text); }
      else if (ev.type === "tool") { handlers.onTool?.(ev.tool, ev.args || {}); }
      else if (ev.type === "done") { trace = ev.trace || []; rounds = ev.rounds || 0; }
      else if (ev.type === "error") { errMsg = ev.message; }
    }
  }
  if (errMsg) throw new ApiError(errMsg, 502);
  return { content, trace, rounds };
}

// 非流式便捷包装（不需要逐字 UI 的调用方用它）。
export function chat(messages: ChatMsg[], context: string): Promise<ChatResult> {
  return chatStream(messages, context);
}
