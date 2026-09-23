"""择时（战法胜率动态）—— 只读本地预生成的 timing_data.json。

数据由 ~/.hermes/scripts/gen_timing_data.py 离线生成（风格罗盘 events + 阶段适配矩阵）。
后端不做在线计算，启动零依赖；文件不存在时返回友好错误，前端优雅降级。
"""

from __future__ import annotations

import json
import os

_TIMING_DATA = os.path.expanduser("~/.hermes/data/style_compass/timing_data.json")


def load_timing() -> dict:
    if not os.path.exists(_TIMING_DATA):
        raise FileNotFoundError(
            "择时数据尚未生成：请先运行 ~/.hermes/scripts/gen_timing_data.py（周一 cron 会自动刷新）"
        )
    with open(_TIMING_DATA, "r", encoding="utf-8") as f:
        return json.load(f)
