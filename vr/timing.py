"""择时（战法胜率动态）—— 读本地预生成的 timing_data.json + 手动刷新控制。

数据由 ~/.hermes/scripts/style_compass_cron.py 离线生成（周一 cron 自动刷新，gen_timing_data.py 是其中一环）。
手动刷新: POST 触发后台跑完整数据链(style_compass_cron.py), GET 查状态, 并发保护。
后端不做在线 K 线计算（启动零依赖）；刷新只是重跑离线脚本。
"""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import threading
import time

_TIMING_DATA = os.path.expanduser("~/.hermes/data/style_compass/timing_data.json")
_REFRESH_SCRIPT = os.path.expanduser("~/.hermes/scripts/style_compass_cron.py")
# 用跑 server 的解释器（与 launchd 的 /usr/local/bin/python3 一致，含 akshare/pandas），
# 而非硬编码路径——主版本升级或换机时不会静默 FileNotFoundError。可用 VR_REFRESH_PY 覆盖。
_PY = os.environ.get("VR_REFRESH_PY") or sys.executable
_LOCK_FILE = os.path.expanduser("~/.hermes/data/style_compass/.refresh.lock")

_state = {"state": "idle", "started_at": None, "last_error": None, "proc": None}
_lock = threading.Lock()


def load_timing() -> dict:
    if not os.path.exists(_TIMING_DATA):
        raise FileNotFoundError(
            "择时数据尚未生成：请先运行 ~/.hermes/scripts/gen_timing_data.py（周一 cron 会自动刷新）"
        )
    with open(_TIMING_DATA, "r", encoding="utf-8") as f:
        return json.load(f)


def _is_locked() -> tuple[bool, str | None]:
    """探测刷新是否在进行: 非阻塞试探同一把文件锁。
    拿不到=有进程持锁(周一cron 或 上次手动刷新在跑)。试探后立即释放, 不真正持有。
    锁内写有 "pid 启动时刻"——持锁进程已死(机器休眠/重启杀掉)时锁文件还在但锁已空闲,
    此处直接判空闲, 并顺带返回一句「上次刷新已中断」供前端透出, 避免用户对着
    过期数据等一个永远不会完成的刷新。"""
    try:
        os.makedirs(os.path.dirname(_LOCK_FILE), exist_ok=True)
        fh = open(_LOCK_FILE, "a+")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)  # 试探后立刻放
        note = _stale_lock_note(fh)
        fh.close()
        return False, note
    except (BlockingIOError, OSError):
        return True, None


def _stale_lock_note(fh) -> str | None:
    """锁空闲但文件非空（上次持锁进程死了）→ 拼中断提示；活持锁者会 truncate 重写, 这里只会读到死者的记录。"""
    try:
        fh.seek(0)
        raw = fh.read().strip()
        if not raw:
            return None
        pid_s, ts_s = raw.split()[:2]
        pid = int(pid_s)
        started = float(ts_s)
    except (ValueError, OSError):
        return None
    try:
        os.kill(pid, 0)
        return None  # pid 还活着(极端: 换 pid 后 flock 已放), 不提示
    except ProcessLookupError:
        pass
    except PermissionError:
        return None  # 进程存在但不是我们的, 保持安静
    age_h = (time.time() - started) / 3600
    when = f"（约 {age_h:.0f} 小时前）" if age_h >= 1 else f"（{time.strftime('%H:%M', time.localtime(started))} 开始）"
    return f"上次刷新已中断 {when}，本次将重新完整跑一遍"


def _run_refresh() -> None:
    """后台线程: spawn 入口脚本(它自己持锁+跑链)。锁由子进程持有, 进程退出内核自动释放。
    注意 state=running 已在 refresh_timing() 持 _lock 时预置，这里只记录起始时间，不再重复置 running。
    start_new_session=True 让数据链(入口+各 step 子脚本)独立成进程组——超时/终止时 killpg
    能连坐全部 step，否则只杀入口、step 变孤儿继续写数据文件，与下一次刷新互相踩踏。"""
    import signal
    with _lock:
        _state["started_at"] = time.time()
    proc = None
    try:
        proc = subprocess.Popen([_PY, "-u", _REFRESH_SCRIPT],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                start_new_session=True)
        with _lock:
            _state["proc"] = proc
        out, _ = proc.communicate(timeout=5400)  # 5 step × 900s 预算 + 余量
        tail = out.decode("utf-8", "replace")[-800:] if out else ""
        if proc.returncode != 0 and "SKIP" not in tail:
            _state["state"] = "error"
            _state["last_error"] = f"刷新失败 rc={proc.returncode}: {tail}"
        else:
            _state["state"] = "done"
            _state["last_error"] = None
    except subprocess.TimeoutExpired:
        if proc is not None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except OSError:
                proc.kill()
            try:
                proc.communicate(timeout=10)
            except Exception:  # noqa: BLE001
                pass
        _state["state"] = "error"
        _state["last_error"] = "刷新超时（>90分钟），已终止数据链；数据文件可能未更新，请稍后重试"
    except Exception as e:  # noqa: BLE001
        _state["state"] = "error"
        _state["last_error"] = f"{type(e).__name__}: {e}"
    finally:
        with _lock:
            _state["proc"] = None


def refresh_timing() -> dict:
    """触发后台刷新; 锁被占用(已有刷新在跑)则返回 running。"""
    with _lock:
        if _state["state"] == "running" and _state.get("proc") is not None and _state["proc"].poll() is None:
            return {"state": "running", "already": True}
        if not os.path.exists(_REFRESH_SCRIPT):
            return {"state": "error", "error": f"刷新脚本不存在: {_REFRESH_SCRIPT}"}
        locked, note = _is_locked()
        if locked:
            _state["state"] = "running"
            return {"state": "running", "already": True, "note": "已有刷新在跑（周一自动或上次手动）"}
        threading.Thread(target=_run_refresh, daemon=True).start()
        # 在持 _lock 期间就预置 running（占位），闭合「锁检查通过 → 线程真正置 running」
        # 的毫秒级窗口：此刻并发 POST 进来会命中下方 state==running 直接返回 already，
        # 不会各自 start 线程、重复 spawn 两个 style_compass_cron.py 子进程。
        _state["state"] = "running"
        _state["last_error"] = None
        resp = {"state": "starting", "already": False}
        if note:  # 上次刷新进程已死、锁文件残留 → 提示用户本次会重新完整跑
            resp["note"] = note
        return resp


def refresh_status() -> dict:
    with _lock:
        elapsed = (round(time.time() - _state["started_at"])
                   if _state["started_at"] is not None else None)
        return {
            "state": _state["state"],
            "started_at": _state["started_at"],
            "elapsed_s": elapsed,
            "last_error": _state["last_error"],
        }
