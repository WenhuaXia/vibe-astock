"""LLM 配置 —— OpenAI 兼容接口（任意后端：MiMo / Qwen / OpenAI / vLLM 等）。

凭据来源（优先级高→低）：
  1. 环境变量 VIBE_API_KEY / VIBE_BASE_URL / VIBE_MODEL
  2. 兼容旧版 MiMo 变量 MIMO_API_KEY / MIMO_BASE_URL / MIMO_MODEL
  3. ~/.config/mimo/mimo.env 文件（兼容旧版）

绝不硬编码 key。
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values
from langchain_openai import ChatOpenAI

from . import cli_llm

_MIMO_ENV = Path.home() / ".config" / "mimo" / "mimo.env"

_CREDS: dict[str, str] | None = None

# 默认模型（可被 VIBE_MODEL / MIMO_MODEL 覆盖）
DEFAULT_MODEL = "Qwen3.8-27B"


def _ensure_creds_loaded() -> None:
    """把 LLM 凭据读进**进程内的字典**（只读一次）"""
    global _CREDS
    if _CREDS is not None:
        return
    creds = {}
    # ① VIBE_* 环境变量（用户主动设的，最高优先级）
    for k, dest in (("VIBE_API_KEY", "api_key"), ("VIBE_BASE_URL", "base_url"), ("VIBE_MODEL", "model")):
        v = os.environ.get(k)
        if v:
            creds[dest] = v
    # ② 兼容旧版 MIMO_* 环境变量
    if not creds.get("api_key"):
        for k, dest in (("MIMO_API_KEY", "api_key"), ("MIMO_BASE_URL", "base_url"), ("MIMO_MODEL", "model")):
            v = os.environ.get(k)
            if v:
                creds[dest] = v
    # ③ 回退到 mimo.env 文件
    if not creds.get("api_key") and _MIMO_ENV.exists():
        creds.update({k: v for k, v in dotenv_values(_MIMO_ENV).items() if v})
        # MIMO_* 映射
        if not creds.get("api_key"):
            creds["api_key"] = creds.pop("MIMO_API_KEY", "") or creds.get("api_key", "")
        if not creds.get("base_url"):
            creds["base_url"] = creds.pop("MIMO_BASE_URL", "")
        if not creds.get("model"):
            creds["model"] = creds.pop("MIMO_MODEL", "")
    if not creds.get("api_key"):
        raise RuntimeError(
            f"LLM 凭据未配置。请设置 VIBE_API_KEY / VIBE_BASE_URL / VIBE_MODEL 环境变量，\n"
            f"  或创建 ~/.config/mimo/mimo.env（含 MIMO_API_KEY / MIMO_BASE_URL）。\n"
            f"  示例：export VIBE_API_KEY=sk-xxx VIBE_BASE_URL=http://your-server/v1"
        )
    _CREDS = creds


def make_llm(deep: bool = False, temperature: float = 0.6):
    """构造复盘用的 LLM"""
    kind = cli_llm.wanted_kind()
    if kind:
        return cli_llm.make_cli_llm(deep=deep)

    _ensure_creds_loaded()
    assert _CREDS is not None
    base_url = _CREDS.get("base_url") or "https://token-plan-cn.xiaomimimo.com/v1"
    api_key = _CREDS["api_key"]
    model = _CREDS.get("model") or DEFAULT_MODEL
    return ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=api_key,
        temperature=temperature,
        timeout=180,
        max_retries=2,
    )
