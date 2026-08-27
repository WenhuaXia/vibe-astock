"""LLM 配置 —— OpenAI 兼容接口（任意后端：MiMo / Qwen / OpenAI / vLLM 等）。

凭据来源（优先级高→低）：
  1. 环境变量 VIBE_LLM_CLI —— 用本机已登录的 AI CLI 订阅当 LLM（免 API key）
  2. 服务端配置文件 ~/.duanxian-agents/llm_config.json（设置页「接入 AI」写入）：
     格式 {"provider", "baseURL", "apiKey", "model"}；provider 为 cli-* 时走 CLI
  3. 环境变量 VIBE_API_KEY / VIBE_BASE_URL / VIBE_MODEL
  4. 兼容旧版 MiMo 变量 MIMO_API_KEY / MIMO_BASE_URL / MIMO_MODEL
  5. ~/.config/mimo/mimo.env 文件（兼容旧版）

**没有进程内缓存**：每次 make_llm 都重读文件/env → 改配置即生效，不用重启服务。
绝不硬编码 key。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import dotenv_values
from langchain_openai import ChatOpenAI

from . import cli_llm

_MIMO_ENV = Path.home() / ".config" / "mimo" / "mimo.env"

# 服务端单一配置源（设置页「接入 AI」通过 /api/llm-config 写入；0600 权限）
LLM_CONFIG_PATH = Path.home() / ".duanxian-agents" / "llm_config.json"

# 默认模型（可被 llm_config.json / VIBE_MODEL / MIMO_MODEL 覆盖）
DEFAULT_MODEL = "Qwen3.8-27B"


def _file_config() -> dict | None:
    """读 llm_config.json；不存在 / 损坏 / 缺 model → None（走兜底链）。"""
    try:
        raw = LLM_CONFIG_PATH.read_text(encoding="utf-8")
        cfg = json.loads(raw)
    except (OSError, ValueError):
        return None
    if not isinstance(cfg, dict) or not cfg.get("model"):
        return None
    return cfg


def _read_creds() -> dict[str, str]:
    """从 env 变量 / mimo.env 读凭据（每次重读，无缓存）。

    只用 dotenv_values（不碰 os.environ —— 凭据绝不能泄漏给 CLI 子进程）。
    返回 {"api_key", "base_url", "model"}，缺什么就没有什么键。
    """
    creds: dict[str, str] = {}
    # ① VIBE_* 环境变量（用户主动设的）
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
    return creds


def _make_from_api_cfg(provider: str, base_url: str, api_key: str, model: str,
                       temperature: float) -> ChatOpenAI:
    """用给定凭据构造 ChatOpenAI（文件配置与 env 兜底共用同一条构造路径）。"""
    return ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=api_key,
        temperature=temperature,
        timeout=180,
        max_retries=2,
    )


def make_llm(deep: bool = False, temperature: float = 0.6):
    """构造复盘/对话用的 LLM。每次调用都重新解析配置 → 改配置即生效。"""
    # a. VIBE_LLM_CLI 环境变量（保持现状，最高）
    kind = cli_llm.wanted_kind()
    if kind:
        return cli_llm.make_cli_llm(kind, deep=deep)

    # b. 服务端配置文件（设置页「接入 AI」的单一来源）
    cfg = _file_config()
    if cfg:
        provider = str(cfg.get("provider") or "").strip()
        model = str(cfg.get("model") or "").strip()
        if provider.startswith("cli-"):
            return cli_llm.make_cli_llm(provider[4:], deep=deep)
        base_url = str(cfg.get("baseURL") or "").strip() or "https://token-plan-cn.xiaomimimo.com/v1"
        api_key = str(cfg.get("apiKey") or "").strip()
        return _make_from_api_cfg(provider, base_url, api_key, model, temperature)

    # c. env / mimo.env 兜底（无头场景、老部署）
    creds = _read_creds()
    if not creds.get("api_key"):
        raise RuntimeError(
            f"LLM 凭据未配置。请在设置页「接入 AI」填写，\n"
            f"  或设置 VIBE_API_KEY / VIBE_BASE_URL / VIBE_MODEL 环境变量，\n"
            f"  或创建 ~/.config/mimo/mimo.env（含 MIMO_API_KEY / MIMO_BASE_URL）。\n"
            f"  示例：export VIBE_API_KEY=sk-xxx VIBE_BASE_URL=http://your-server/v1"
        )
    base_url = creds.get("base_url") or "https://token-plan-cn.xiaomimimo.com/v1"
    model = creds.get("model") or DEFAULT_MODEL
    return _make_from_api_cfg("", base_url, creds["api_key"], model, temperature)
