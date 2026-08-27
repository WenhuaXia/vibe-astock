## 任务：LLM 配置统一为服务端单一来源

### 背景
复盘 agent（duanxian/config.py）读 `.env` VIBE_*（进程内缓存 _CREDS，改配置要重启）；
首板/问AI（vr/chat）读浏览器 localStorage（前端 Settings.tsx 手动填）。两套配置割裂。

### 规格（Phase 1 后端）
1. 新增服务端配置文件：`~/.duanxian-agents/llm_config.json`
   - 格式：`{"provider": "...", "baseURL": "...", "apiKey": "...", "model": "..."}`
   - CLI 型 provider（`cli-*` 前缀）：baseURL/apiKey 可为空
2. server.py 新增两个端点（走现有 `_origin_ok` 写保护，与其他写操作一致）：
   - `GET /api/llm-config` → 返回当前配置（不存在时返回 `{configured: false}`，不 404）
   - `POST /api/llm-config` → body 同格式，校验（model 必填；cli-* 免 key/baseURL；API 型需 baseURL+apiKey），写文件（0600 权限），返回 `{ok: true}`
3. duanxian/config.py 改造：
   - 新增 `_file_config()`：读 `~/.duanxian-agents/llm_config.json`，不存在/损坏返回 None
   - `make_llm()` 优先级改为：
     a. `VIBE_LLM_CLI` 环境变量（保持现状，最高）
     b. llm_config.json：provider 为 cli-* → 走 cli_llm.make_cli_llm；否则用其 baseURL/apiKey/model 建 ChatOpenAI
     c. .env VIBE_* / MIMO_* / mimo.env（现有逻辑，作为兜底）
   - **去掉 `_CREDS` 进程内缓存**（每次 make_llm 都重新读文件/env）—— 改配置即生效不用重启
   - 注意：tests/test_core_logic.py::TestCredsNotInEnviron 有 3 个用例引用 `_CREDS` / `_ensure_mimo_loaded`，
     这些测试本身已 stale（基线代码已迁移 VIBE_*），把它们更新为匹配新实现，
     保持其核心约束不变：①凭据不泄漏进 os.environ 传给 CLI 子进程 ②用 dotenv_values 不用 load_dotenv（在 config.py 内）③用户主动设的 env 仍被尊重
   - **pre-existing 失败** `test_review_output_carries_no_personal_fields` 在基线上就挂（已验证），与本任务无关，不要碰它
4. vr/chat.py `/api/chat` 逻辑不动（请求仍带 cfg；当 cfg 完整时用它，兼容现有前端行为）
5. README.md：更新「快速开始」里关于 LLM 配置的段落（改为：设置页「接入 AI」统一配置，存 ~/.duanxian-agents/llm_config.json；.env 仅兜底/无头场景）

### 规格（Phase 2 前端）
6. frontend/src/lib/llm.ts：
   - `saveLlm`/`loadLlm`/`clearLlm` 改为异步走 `GET/POST /api/llm-config`（fetch，复用 authHeaders）
   - **过渡兼容**：loadLlm 若服务端无配置，回退读一次 localStorage 旧值并**自动迁移**写回服务端（清掉 localStorage），保证用户已存的配置不丢
   - cli-* 校验逻辑（serverAllowsCli / cliAvailability）保留不变
   - `hasLlm()` 改为可缓存的异步结果或模块级 promise；AskAiButton/DeepDive 的 useEffect 里 await
7. frontend/src/pages/Settings.tsx：
   - 初始化时 `await loadLlm()` 回显；保存后 toast 文案改为「已保存到本机，全站「问 AI / 复盘」可用，改配置即生效不用重启」
   - 安全提示文案：API key 从「只存在你本地浏览器」改为「只存在你本机后端（~/.duanxian-agents/llm_config.json），不上传、不进仓库」
   - 删除「已保存到本地」字样（localStorage 时代的文案）
8. frontend/src/lib/ai-models.ts 不动

### 验收标准（QA 会验）
- A1: `POST /api/llm-config` {provider:"openai-compatible",baseURL:"http://192.168.250.10:8002/v1",apiKey:"<key>",model:"Qwen3.8-27B"} → 文件生成、权限 0600、GET 读回一致
- A2: **不重启服务**，改 llm_config.json 的 model 后 `/api/review/chat` 仍正常回复（证明无缓存）
- A3: 删 llm_config.json → 行为回退 .env（与现在一致）
- A4: 浏览器设置页：填 API 配置保存 → 刷新页面回显 → 首板分析页「问 AI」可用
- A5: `pytest tests/ -q` 除 pre-existing 的 test_review_output_carries_no_personal_fields 外全过
- A6: 前端 `npm run build`（frontend/ 下）通过

### 约束
- 非侵入优先：不动 vr/chat.py 的请求协议；不动其他业务逻辑
- 一分支一问题：在 `fix/llm-config-unify` 分支上开发（从当前工作区基线切，基线含未提交的 config.py/server.py 改动）
- 完成后 commit（消息中英双语，突出「统一配置」），**不要** merge 到 local-fixes（PM 在 QA Gate 后统一处理）
- 项目 Python 用系统 /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12（无 venv）
- 服务当前跑在 :8910（proc 托管，别动运行实例；验收时用独立端口 VIBE_PORT=8911 起第二个实例）

### 参考文件
- 计划：.llm-unify/task_plan.md
- 端点写保护参考：server.py `_origin_ok` + 现有写操作
- 前端 fetch 封装：frontend/src/lib/api.ts（authHeaders）
