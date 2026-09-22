"""Regression coverage for public fixes integrated into the local Agent branch."""

import json

import pytest


@pytest.mark.parametrize("cache", ["deepdive", "backtest"])
def test_first_cache_write_creates_directory_and_remains_replaceable(tmp_path, cache):
    import server

    path = tmp_path / "new-user" / cache / "result.json"
    assert not path.parent.exists()
    server._atomic_write(str(path), {"generation": 1, "description": "首次缓存"})
    assert json.loads(path.read_text()) == {"generation": 1, "description": "首次缓存"}
    server._atomic_write(str(path), {"generation": 2})
    assert json.loads(path.read_text()) == {"generation": 2}
    assert list(path.parent.iterdir()) == [path]


@pytest.mark.parametrize("field", ["MIMO_QUICK_MODEL", "MIMO_MODEL", "MIMO_BASE_URL"])
def test_explicit_model_config_wins_when_key_comes_from_file(tmp_path, monkeypatch, field):
    import duanxian.config as config

    for key in ("MIMO_API_KEY", "MIMO_BASE_URL", "MIMO_MODEL", "MIMO_QUICK_MODEL"):
        monkeypatch.delenv(key, raising=False)
    # FIX(t_5e96d2ad) 2026-09-22: 本机真实 VIBE_* 环境变量会进 ① 优先级盖住 mimo.env，
    # 测试须清掉它们，才能验证「env 字段 > 文件字段」这条兜底链。
    for key in ("VIBE_API_KEY", "VIBE_BASE_URL", "VIBE_MODEL"):
        monkeypatch.delenv(key, raising=False)
    env_file = tmp_path / "mimo.env"
    env_file.write_text(f"MIMO_API_KEY=test-only-key\n{field}=file-value\n")
    monkeypatch.setattr(config, "_MIMO_ENV", env_file)
    # FIX(t_5e96d2ad) 2026-09-22: config.py 重构（c479828）移除了 _ensure_mimo_loaded/_CREDS
    # 缓存机制，改为无缓存的 _read_creds() 优先级链：
    #   ② MIMO_* 环境变量（key 优先，其余字段各自兜底）→ ③ mimo.env 文件（key 存在时才读）。
    # MIMO_QUICK_MODEL 已不在优先级链中（文件值胜出，不再被 env 覆盖）。
    monkeypatch.setenv(field, "explicit-value")
    creds = config._read_creds()
    assert creds["api_key"] == "test-only-key"
    if field == "MIMO_QUICK_MODEL":
        # 该 env 变量已不在兜底链中（v1.1.3 无 QUICK 概念），MIMO_QUICK_MODEL 键不映射
        # 为 model（映射处 pop 成空串 → make_llm 里 falsy 落到 DEFAULT_MODEL）。
        assert not creds.get("model")
    else:
        assert creds["model" if field == "MIMO_MODEL" else "base_url"] == "explicit-value"
