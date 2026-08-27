# task_plan — 执行：t_d70c71ac LLM 配置统一（服务端单一来源）

## 关键设计决策（开工前定死）
1. `duanxian/config.py`：
   - `LLM_CONFIG_PATH = Path.home()/".duanxian-agents"/"llm_config.json"`（模块级，测试可 monkeypatch）
   - `_file_config()`：读文件，不存在/损坏 → None
   - `_read_creds()`：共享 env 读取（VIBE_* → MIMO_* → mimo.env），**无缓存**，每次调用重读
   - `make_llm()` 优先级：a. `VIBE_LLM_CLI` env → b. llm_config.json（cli-* → make_cli_llm(provider)；否则 ChatOpenAI，model 必填、base_url 默认 xiaomimimo）→ c. env 兜底（逻辑与现状一致）
   - 删除 `_CREDS` / `_ensure_creds_loaded`
   - `cli_llm.make_cli_llm(kind, deep)`：新增可选 `kind` 参数（默认取 env，向后兼容）
2. `server.py`：
   - `_LLM_CONFIG_PATH` 模块级（Path，测试可 monkeypatch）+ `_load_llm_config_file()` / `_validate_llm_config_payload()` 助手（测试打这些）
   - `GET /api/llm-config`：文件存在 → `{configured: true, provider, baseURL, apiKey, model}`；不存在 → `{configured: false}`（不 404）
   - `POST /api/llm-config`：`_origin_ok` 保护；校验失败 400 `{"detail": msg}`；写入 0600（os.chmod），`{"ok": true}`
   - `_chat_model()` **改为每次 `make_llm(deep=False)`**（全局 `_chat_llm` 缓存一并去掉）——否则 A2（不重启换模型）必挂，属于"改配置要重启"同类根因
   - 路由不撞 vr/（TestNoRouteShadowing 自动盯）
3. `frontend/src/lib/llm.ts`：
   - `loadLlm(): Promise<LlmConfig|null>`（模块级 promise 缓存；GET /api/llm-config；401/网络错误 → 回退 localStorage 旧值但**不迁移**；configured:false → localStorage 有值则迁移写回服务端）
   - `saveLlm/clearLlm`: async POST（clear = 空 provider POST → 服务端删文件）；成功后 `invalidateLlmCache()`
   - `hasLlm(): Promise<boolean>`；`chatStream` 内 `await loadLlm()`
   - cli 校验（serverAllowsCli/cliAvailability）不动
4. `Settings.tsx`：useEffect 拉取回显；save 按钮 async + try/catch toast；文案按规格改
5. `main.tsx`：`void primeLlmConfig()` 与 `primeCliAvailability` 并列（不阻塞首屏）

## 阶段（TDD 追踪弹）
- [x] S1 红：config 无缓存 + _file_config 测试 → 绿（config.py + cli_llm.py）
- [x] S2 红：stale 的 TestCredsNotInEnviron 3 例改 _read_creds → 绿
- [x] S3 红：server 端点测试（GET/POST/校验/0600/_chat_model 无缓存）→ 绿
- [ ] S4 前端：llm.ts 异步化 + Settings.tsx + main.tsx（tsc build 验证）
- [ ] S5 README 快速开始段落
- [ ] S6 验收：8911 独立实例 A1/A2/A3；pytest 全套；npm build；A4 浏览器（computer_use 驱动用户 Edge）
- [ ] S7 commit（中英双语，突出"统一配置"；含基线未提交改动；不 merge；.llm-unify 不入库）

## 环境
- Python: /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12（系统，无 venv）
- vLLM: 192.168.250.10:8000（SSH focus/2025），key 在 .env VIBE_API_KEY
- 运行实例 :8910 别动；验收用 VIBE_PORT=8911
- 基线失败（不碰）：test_review_output_carries_no_personal_fields（任务确认）
  + test_js_engine_is_importable_and_can_eval（py_mini_racer 坏，与任务无关，报告里说明）

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| | | |
