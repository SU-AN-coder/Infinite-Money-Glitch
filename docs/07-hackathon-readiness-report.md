# Hackathon Readiness Report (2026-02-24)

项目：Infinite Money Glitch（`PROJECT_NAME` 当前为 “Autonomous Yield Operator”）

## 1) 结论（可提交度）

- **Eligibility（参赛门槛）**：✅ 已满足
  - AI Agent 主导开发：✅（可生成 `ai-dev-proof.json/.md`）
  - 至少使用一个 Sui Stack 组件：✅（Move 合约 + Sui tx；同时集成 Seal + Walrus SDK）
  - 可验证 Demo：✅（本机可复跑 `npm run start` 产生链上 txDigest + Walrus blobId + evidence report）
  - DeepSurge Profile + 钱包地址：⏳ 需你在网站填写/提交（非代码问题）

- **当前最影响夺冠的因素**：
  - 现在的 live 跑通链路偏“支出/防护”侧更强（Seal + Walrus + evidence），但 **earned=0** 时叙事会偏弱；建议再跑出至少一次真实 `claim` 收益并进入 evidence。

## 2) 与赛道契合度

### Track 2: Local God Mode（契合度高）
- OpenClaw 本地执行/浏览器控制：项目具备（Gateway `/health` 可达；`/rpc exec` 在当前版本返回 405，但代码已有本地 fallback，不影响 Demo）
- Always-on / 自动循环：具备 Agent 循环结构（`Agent.runCycle()`），可通过 env 开关控制。

### Track 1: Safety & Security（可作为加分点）
- Seal + Walrus 作为“可审计轨迹 + 加密隐私”证据链：你已实现并产出 Walrus blob evidence。

## 3) 复测结果（本机）

以下命令在 Windows 工作区已通过：

- `npm run typecheck`：✅
- `npm run contract:test`：✅（6/6 PASS；仅 lint warnings）
- `npm run test:e2e`（MOCK）：✅（9/9 PASS）
- `npm run preflight`：✅（仅 1 条 warn：OpenClaw `/rpc exec` 405，将回退到本地执行）

Live Demo（可复验链上证据）建议按以下顺序：

1. `npm run start`
2. `npm run evidence:generate`
3. `set AI_MODEL=GPT-5.3-Codex` 后 `npm run ai-proof`

## 4) 可验证证据产物（提交材料）

### Evidence
- evidence JSON：`evidence/evidence-testnet-2026-02-24T09-34-57-316Z.json`
- evidence 报告：`evidence/evidence-report-2026-02-24T09-34-57-320Z.md`

报告中应包含：
- 交易 digest（spend / claim / deploy 等）
- Walrus blobId（至少 1 个）
- 合约 deployment 元数据（packageId / boardObjectId）

### AI proof
- `ai-dev-proof.json`
- `ai-dev-proof.md`

（当前生成器支持通过 `AI_MODEL`/`AI_PLATFORM` 环境变量覆盖口径。）

## 5) 风险与改进建议（面向“冲 Top 5”）

- **P0：把 earned 做成稳定可复验**
  - 现在 spend 侧链路很硬（Seal/Walrus/txDigest/证据齐全），但 “Infinite Money Glitch” 的主题需要至少一笔稳定收入。
  - 建议：跑出 1 次 `claim` 并在 evidence 报告中出现（Earn txDigest + explorer link）。

- **P1：安全叙事补齐**
  - 当前项目包含热私钥（`.env`），建议提交前声明：Demo 使用 testnet/临时 key，且提供轮换/最小权限策略。

- **P2：OpenClaw RPC 405 的解释**
  - 预检会提示 warn，建议在 README/演示稿里明确：Gateway 版本差异导致 `/rpc exec` 不可用，系统自动 fallback，不影响执行。

## 6) 夺冠概率（现实评估）

- **进 Top 10（短名单）**：概率较高（Sui 深度集成 + Walrus/Seal 证据链 + 可运行 demo）。
- **进 Top 5（获奖）**：取决于你是否能把“收益端”稳定跑出来并能让评审一键复验（earned > 0，最好净收益为正）。

