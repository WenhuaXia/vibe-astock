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


def _is_locked() -> bool:
    """探测刷新是否在进行: 非阻塞试探同一把文件锁。
    拿不到=有进程持锁(周一cron 或 上次手动刷新在跑)。试探后立即释放, 不真正持有。"""
    try:
        os.makedirs(os.path.dirname(_LOCK_FILE), exist_ok=True)
        fh = open(_LOCK_FILE, "a+")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)  # 试探后立刻放
        fh.close()
        return False
    except (BlockingIOError, OSError):
        return True


def _run_refresh() -> None:
    """后台线程: spawn 入口脚本(它自己持锁+跑链)。锁由子进程持有, 进程退出内核自动释放。
    注意 state=running 已在 refresh_timing() 持 _lock 时预置，这里只记录起始时间，不再重复置 running。"""
    with _lock:
        _state["started_at"] = time.time()
    try:
        proc = subprocess.Popen([_PY, "-u", _REFRESH_SCRIPT],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        with _lock:
            _state["proc"] = proc
        out, _ = proc.communicate(timeout=1800)
        tail = out.decode("utf-8", "replace")[-800:] if out else ""
        if proc.returncode != 0 and "SKIP" not in tail:
            _state["state"] = "error"
            _state["last_error"] = f"刷新失败 rc={proc.returncode}: {tail}"
        else:
            _state["state"] = "done"
            _state["last_error"] = None
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
        if _is_locked():
            _state["state"] = "running"
            return {"state": "running", "already": True, "note": "已有刷新在跑（周一自动或上次手动）"}
        threading.Thread(target=_run_refresh, daemon=True).start()
        # 在持 _lock 期间就预置 running（占位），闭合「锁检查通过 → 线程真正置 running」
        # 的毫秒级窗口：此刻并发 POST 进来会命中下方 state==running 直接返回 already，
        # 不会各自 start 线程、重复 spawn 两个 style_compass_cron.py 子进程。
        _state["state"] = "running"
        _state["last_error"] = None
    return {"state": "starting", "already": False}


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
