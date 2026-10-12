/**
 * 择时(战法胜率动态)视图 — 从 v1 的 `vr/timing.py` 移植。
 *
 * 数据是**离线预生成**的:周一 cron 与前端手动刷新都调 `~/.hermes/scripts/style_compass_cron.py`,
 * 它自己跑 5 step 数据链、写 `~/.hermes/data/style_compass/timing_data.json`,并用 flock 做跨进程互斥
 * (两个入口谁先拿谁跑,另一个静默 SKIP)。后端**零在线依赖** —— run 只读 JSON,刷新只是 spawn 那个脚本。
 *
 * 映射成 v2 的两个 view:
 *   - `shortline_timing`        run = 读 timing_data.json;act = 触发后台刷新
 *   - `shortline_timing_status` run = 查刷新进度(前端轮询)
 *
 * 🔴 锁探测用 pid 探活复刻 v1 语义,不直接 acquire flock:Node 无内置 flock syscall,而 v1 的 `_is_locked`
 *    本来就是"非阻塞试探 + 读锁内 pid 判死"。真正的互斥仍由入口脚本的 flock 兜底(多 spawn 一个只会 SKIP),
 *    所以读锁文件的 "pid 起始时刻" 探活即可,跨平台、无原生依赖。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ServiceContext } from "../../service.ts";
import { ServiceError } from "../../service.ts";

const home = os.homedir();
const SC = path.join(home, ".hermes", "data", "style_compass");
const TIMING_DATA = path.join(SC, "timing_data.json");
const REFRESH_SCRIPT = path.join(home, ".hermes", "scripts", "style_compass_cron.py");
const LOCK_FILE = path.join(SC, ".refresh.lock");

/** 本服务触发的刷新状态(机器重启/休眠丢失后,靠锁文件 pid 探活兜底)。 */
const state: {
  running: boolean;
  started_at: number | null; // epoch ms
  last_error: string | null;
  child_pid: number | null;
} = { running: false, started_at: null, last_error: null, child_pid: null };

/** 读离线数据文件;不存在时报友好错误(前端提示先跑 gen_timing_data)。 */
export function loadTiming(): unknown {
  if (!fs.existsSync(TIMING_DATA)) {
    throw new ServiceError("not_found", "择时数据尚未生成:请先运行 ~/.hermes/scripts/gen_timing_data.py(周一 cron 会自动刷新)");
  }
  return JSON.parse(fs.readFileSync(TIMING_DATA, "utf8"));
}

/** 探活:pid 是否还在(同 v1 os.kill(pid,0) 语义)。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true; // EPERM = 进程存在但不是我们的,视为存活
  }
}

/**
 * 锁是否在被人持有(刷新在跑) + 若持锁进程已死的"中断"提示。
 * 复刻 v1 `_is_locked` + `_stale_lock_note`:锁文件写有 "pid 起始时刻"。
 */
function lockState(): { locked: boolean; note: string | null } {
  let raw: string;
  try {
    raw = fs.readFileSync(LOCK_FILE, "utf8").trim();
  } catch {
    return { locked: false, note: null };
  }
  if (!raw) return { locked: false, note: null };
  const [pidS, tsS] = raw.split(/\s+/);
  const pid = Number.parseInt(pidS, 10);
  const started = Number.parseFloat(tsS);
  if (!Number.isFinite(pid) || !Number.isFinite(started)) return { locked: false, note: null };
  if (pidAlive(pid)) return { locked: true, note: null };
  // 持锁进程已死:锁已空闲(flock 随进程退出释放),但文件残留 → 给前端一句"上次中断"
  const ageH = (Date.now() / 1000 - started) / 3600;
  const when = ageH >= 1 ? `(约 ${Math.round(ageH)} 小时前)` : `(起始 ${new Date(started * 1000).toLocaleTimeString()} 本地)`;
  return { locked: false, note: `上次刷新已中断 ${when},本次将重新完整跑一遍` };
}

/** 触发后台刷新(detached 成独立进程组,子链各 step 由入口脚本自管;超时/终止时入口脚本自己 killpg)。 */
function startRefresh(ctx: ServiceContext): { state: string; already?: boolean; note?: string; error?: string } {
  if (!fs.existsSync(REFRESH_SCRIPT)) {
    return { state: "error", error: `刷新脚本不存在: ${REFRESH_SCRIPT}` };
  }
  const { locked, note } = lockState();
  if (locked || state.running) {
    return { state: "running", already: true, note: note ?? "已有刷新在跑(周一自动或上次手动)" };
  }
  // 入口脚本内部用硬编码 /usr/local/bin/python3 跑各 step;这里用什么 python 启动入口无关紧要。
  const child = spawn(ctx.python, ["-u", REFRESH_SCRIPT], {
    cwd: home,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.running = true;
  state.started_at = Date.now();
  state.last_error = null;
  state.child_pid = child.pid ?? null;
  let tail = "";
  const onChunk = (b: Buffer) => { tail = (tail + b.toString("utf8")).slice(-800); };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  const finish = (code: number | null) => {
    const hadSkip = tail.includes("SKIP");
    state.last_error = code !== 0 && !hadSkip ? `刷新失败 rc=${code}: ${tail}` : null;
    state.running = false;
    state.started_at = null;
    state.child_pid = null;
  };
  child.on("close", (code) => finish(code));
  child.on("error", (e) => {
    state.last_error = `${(e as NodeJS.ErrnoException).code ?? "Error"}: ${e.message}`;
    state.running = false;
    state.started_at = null;
    state.child_pid = null;
  });
  child.unref();
  const resp: { state: string; already: boolean; note?: string } = { state: "starting", already: false };
  if (note) resp.note = note;
  return resp;
}

/** 刷新进度(前端轮询):state=idle/starting/running/done/error + 计时。 */
export function refreshStatus(): { state: string; started_at: number | null; elapsed_s: number | null; last_error: string | null } {
  const { locked } = lockState();
  let st: string;
  if (state.running) st = state.last_error ? "error" : "running";
  else if (locked) st = "running"; // 外部(cron)在跑
  else st = state.last_error ? "error" : "idle";
  const elapsed = state.started_at !== null ? Math.round((Date.now() - state.started_at) / 1000) : null;
  return { state: st, started_at: state.started_at, elapsed_s: elapsed, last_error: state.last_error };
}

/** view 入口:供 register.ts 包进 registerView。 */
export const timingViewRun = (_ctx: ServiceContext, _query: Record<string, string>, _signal: AbortSignal): Promise<unknown> =>
  Promise.resolve(loadTiming());
export const timingViewAct = (ctx: ServiceContext, _body: Record<string, unknown>, _signal: AbortSignal): Promise<unknown> =>
  Promise.resolve(startRefresh(ctx));
export const timingStatusRun = (_ctx: ServiceContext, _query: Record<string, string>, _signal: AbortSignal): Promise<unknown> =>
  Promise.resolve(refreshStatus());
