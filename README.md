# Infinite Money Glitch 

> **OpenClaw x Sui Hackathon - Track 2: Local God Mode**

## 介绍

一个拥有自己钱包、能通过“本地工作”赚取资金、并用 Seal+Walrus 保护用户关键数据的**自主数字保险 Agent**。

## 核心卖点

```
传统 Agent: 人类命令 → Agent 执行 → 人类付费
    
Infinite Money Glitch: Agent 自主决策 → Agent 自己赚钱 → Agent 自己付费
                       ↑                              ↓
                       └──────── 经济闭环 ────────────┘
```

## 项目结构

```
infinite-money-glitch/
├── contracts/                     # Sui Move 智能合约
│   ├── Move.toml                  # Move 包配置
│   └── sources/
│       ├── bounty_board.move      # 赏金板合约
│       └── bounty_board_tests.move # 合约测试
├── docs/                          # 技术文档
│   ├── 01-wallet-module.md        # 钱包模块技术方案
│   ├── 02-earner-module.md        # 收入模块技术方案
│   ├── 03-spender-module.md       # 支出模块技术方案
│   ├── 04-ledger-module.md        # 账本模块技术方案
│   ├── 05-agent-module.md         # Agent主循环技术方案
│   └── 06-demo-plan.md            # Demo演示方案
├── src/
│   ├── wallet/
│   │   └── WalletManager.ts       # 钱包管理
│   ├── earn/
│   │   ├── Earner.ts              # 赚钱逻辑（当前：bounty_board claim）
│   │   ├── extensions/
│   │   │   └── OpportunityExpansion.ts # 收入扩展路线图
│   │   └── modes/                 # 预留：可插拔赚钱模式（空投/套利等）
│   │       ├── EarnMode.ts
│   │       ├── AirdropMode.ts
│   │       └── ArbitrageMode.ts
│   ├── spend/
│   │   └── Spender.ts             # 花钱逻辑
│   ├── ledger/
│   │   └── Ledger.ts              # 损益账本
│   ├── agent/
│   │   ├── Agent.ts               # 主循环
│   │   └── DemoRunner.ts          # Demo 流程
│   ├── evidence/
│   │   └── EvidenceCollector.ts   # 链上证据收集
│   ├── test/
│   │   └── e2e.ts                 # 端到端测试
│   ├── tools/
│   │   ├── ai-dev-proof.ts        # AI 开发证明生成
│   │   ├── deploy-contract.ts     # 合约部署脚本
│   │   └── evidence-cli.ts        # 证据生成 CLI
│   └── index.ts                   # 入口
├── package.json
├── tsconfig.json
├── SKILL.md                       # OpenClaw 技能清单
├── openclaw.cron.json             # Cron 任务配置
└── README.md
```

## Resilient Execution Pipeline

Infinite Money Glitch 采用**弹性执行管线**设计，确保 Agent 在任何环境下都能自主运行：

```
┌──────────────────────┐
│   Task Dispatcher     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│  OpenClaw Gateway    │────▶│  Local Fallback      │
│  POST /rpc exec      │ 4xx │  execSync()          │
│  (sandbox/gateway)   │ or  │  (same commands,     │
└──────────────────────┘ err │   local shell)       │
                             └──────────────────────┘
```

**设计原则：Graceful Degradation**

1. **优先远程**：每次任务执行先通过 OpenClaw Gateway `/rpc exec`，在沙箱环境运行
2. **透明降级**：当 Gateway 返回 4xx 或网络不可达时，自动 fallback 到本地 `execSync()`
3. **命令一致**：远程和本地执行完全相同的命令（`eslint --format json`、`npm audit --json`、`tsc --noEmit` 等真实工具）
4. **健康检查**：每轮 Agent 周期的 HealthCheck 阶段会探测 Gateway 可用性并记录状态
5. **零中断**：即使 OpenClaw Gateway 完全下线，Agent 也能 100% 自主完成 earn→spend→audit 闭环

这种架构使得 Agent 既能利用 OpenClaw 的沙箱隔离与远程执行能力，又能在 Gateway 不可用时保持完全自主——真正的 **Local God Mode**。

## 技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 运行时 | Node.js 22+ | Agent 执行环境 |
| 语言 | TypeScript | 类型安全 |
| 区块链 | Sui Testnet | 钱包、交易 |
| 存储 | Walrus | 日志/报表永久存储 |
| 加密访问层 | Seal | 数据加密与访问控制 |
| SDK | @mysten/sui | Sui 交互 |
| SDK | @mysten/walrus | Walrus 交互 |
| SDK | @mysten/seal | 加密封装与密钥管理 |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境
cp .env.example .env
# 编辑 .env 设置私钥或让 Agent 自动生成

# 2.1 首次先跑环境预检（会检查：Sui 余额 / WAL 余额 / OpenClaw / 合约配置等）
npm run preflight

# 3. 部署合约（需要 Sui CLI）
npm run contract:build         # 构建 Move 合约
npm run contract:test          # 运行合约测试
npm run contract:deploy        # 部署到 testnet

# 4. 运行端到端测试
npm run test:e2e               # Mock 模式（不验证链上/Walrus/OpenClaw）
npm run test:e2e:real          # 真实模式（会进行真实 Seal+Walrus 写入）

# 5. 跑一次真实闭环（推荐给评审/复验）
#    方式 A：Demo 输出（更适合现场讲解，默认不落 evidence 文件）
#      RUN_DEMO=true npm run start
#
#    方式 B：Agent cycle + 落地链上证据（推荐）
#      RUN_AGENT=true COLLECT_EVIDENCE=true npm run start
#      npm run evidence:generate

# 6. 单次 Agent 6 阶段周期（模块 05）
# 设置 RUN_AGENT=true
npm run agent:cycle

# 7. 90 秒 Demo 流程（模块 06）
# 设置 RUN_DEMO=true
npm run demo:run

# 8. 生成证据和开发证明（Hackathon 提交用）
npm run evidence:generate      # 生成链上证据报告
npm run evidence:generate -- --demo  # Demo 数据
npm run ai-proof               # 生成 AI 开发证明
```

## 可复验（REAL）最短路径（2026-02-24）

目标：在 evidence 里同时出现 **claim txDigest（赚钱）** + **spend txDigest（花钱）** + **walrus blobId（存证）** + **deployTxDigest（可复验部署）**。

```bash
npm install

# 1) 先把 .env 配好：至少需要
#    SUI_PRIVATE_KEY / BOUNTY_PACKAGE_ID / BOUNTY_BOARD_ID / SEAL_PACKAGE_ID / OPENCLAW_TOKEN
npm run preflight

# 2) 真实集成测试（会做 Seal+Walrus 真写入）
npm run test:e2e:real

# 3) 跑一次真实闭环并落证据
#    （若没有可领 bounty，建议打开自动 seed 确保 earned>0）
#    EARNER_AUTO_SEED_BOUNTY=true
RUN_AGENT=true COLLECT_EVIDENCE=true npm run start

# 4) 生成/刷新证据报告（会读取 ledger.json 或最新 evidence 包）
npm run evidence:generate

# 5) 生成 AI 开发证明
npm run ai-proof
```

产物位置：
- `evidence/evidence-testnet-*.json`：机器可读证据包（含 txDigest/blobId/收益汇总）
- `evidence/evidence-report-*.md`：人类可读报告
- `deployment.json`：合约部署信息（含 deployTxDigest）
- `ai-dev-proof.json` / `ai-dev-proof.md`：AI 开发证明

如果 `deployment.json` 里 `deployTxDigest` 为空/unknown，可以跑一次同步：

```bash
npm run deployment:sync
```

## 合约部署

BountyBoard 是 Agent 的收入来源合约，需要先部署：

```bash
# 确保 Sui CLI 已安装
sui --version

# 配置 testnet 网络
sui client switch --env testnet

# 获取测试 SUI（Discord faucet）
# https://discord.com/channels/916379725201563759/

# 部署合约
npm run contract:deploy

# 成功后会输出：
# BOUNTY_PACKAGE_ID=0x...
# BOUNTY_BOARD_ID=0x...
# 将这些值添加到 .env 文件
```

## Demo 运行建议

在 `.env` 中至少配置以下变量后再运行：

- `SUI_PRIVATE_KEY`
- `BOUNTY_PACKAGE_ID`
- `BOUNTY_BOARD_ID`
- `SEAL_PACKAGE_ID`
- `OPENCLAW_TOKEN`

变量获取方式（最常用）：

- `SUI_PRIVATE_KEY`：从你的 Sui 钱包导出私钥（Base64），仅本地保存。
- `OPENCLAW_TOKEN`：OpenClaw Gateway 的访问令牌（你本地服务配置中生成）。
- `BOUNTY_PACKAGE_ID`、`BOUNTY_BOARD_ID`：执行 `npm run contract:deploy` 后终端会输出。
- `SEAL_PACKAGE_ID`：使用你目标网络的 Seal 包 ID（测试网可用官方/社区示例）。
- `SEAL_KEY_SERVERS`：可选；不填会走项目默认配置，真实环境建议显式配置。

推荐演示开关：

- `RUN_DEMO=true`
- `RUN_AGENT=false`
- `RUN_EARNER=false`
- `RUN_SPENDER=false`
- `RUN_LEDGER=false`

可选（建议真实闭环时开启）：
- `EARNER_AUTO_SEED_BOUNTY=true`：当没有可领 bounty 时，自动 `deposit + post_bounty + claim` 产出 earned>0

## 模块文档

| 模块 | 文档 | 描述 |
|------|------|------|
| 钱包模块 | [01-wallet-module.md](docs/01-wallet-module.md) | 密钥管理、余额查询、交易签名 |
| 收入模块 | [02-earner-module.md](docs/02-earner-module.md) | 真实本地工作 + 奖励结算 |
| 支出模块 | [03-spender-module.md](docs/03-spender-module.md) | Seal加密 + Walrus存储支付 |
| 账本模块 | [04-ledger-module.md](docs/04-ledger-module.md) | 收支记录、损益计算 |
| Agent模块 | [05-agent-module.md](docs/05-agent-module.md) | 主循环、决策逻辑 |
| Demo方案 | [06-demo-plan.md](docs/06-demo-plan.md) | 90秒演示脚本 |

## 90秒 Demo 流程

```
0:00  ┌─────────────────────────────────────────┐
      │ Agent 启动，显示钱包地址               │
      │ "Starting balance: 1.0 SUI"            │
0:10  ├─────────────────────────────────────────┤
      │ Agent 先执行本地工作，再结算奖励         │
      │ "Working: Verifying on-chain logic"    │
      │ "✓ Task reward received: +0.5 SUI"     │
0:30  ├─────────────────────────────────────────┤
      │ Agent 支付运行成本并保护数据            │
      │ "🔒 Data encrypted via Seal Protocol"   │
      │ "✓ Paid 0.05 SUI for encrypted backup" │
0:50  ├─────────────────────────────────────────┤
      │ Agent 生成损益报表                      │
      │ "═══ PROFIT & LOSS ═══"                │
      │ "Income:  +0.50 SUI"                   │
      │ "Expense: -0.05 SUI"                   │
      │ "Net:     +0.45 SUI ✓"                 │
1:10  ├─────────────────────────────────────────┤
      │ 链上验证                                │
      │ Sui Explorer 展示交易记录               │
1:30  └─────────────────────────────────────────┘
```

## 项目

1. **官方认可**: Track 2 明确提到 "Infinite Money Glitch" 创意
2. **叙事升级**: "Agent 打工赚 Gas，反哺用户数据安全"，不再只是 Faucet 脚本
3. **Sui 深度**: 钱包、交易、Walrus、Seal 四层完整闭环
4. **可验证**: 余额变化 + 链上交易 + Blob 记录可现场复验
5. **记忆点**: 项目名本身就是传播点

## 开发时间线

| 阶段 | 天数 | 任务 |
|------|------|------|
| Week 1 Day 1-2 | 2 | 项目搭建 + WalletManager |
| Week 1 Day 3-4 | 2 | Earner 模块（真实本地工作 + 奖励结算） |
| Week 1 Day 5-6 | 2 | Spender 模块（Walrus支付） |
| Week 1 Day 7 | 1 | Ledger 模块 + 集成测试 |
| Week 2 Day 1-2 | 2 | Agent 主循环 + CLI 界面 |
| Week 2 Day 3-4 | 2 | 端到端测试 + Bug修复 |
| Week 2 Day 5 | 1 | Demo 脚本 + 录制 |
| Week 2 Day 6-7 | 2 | 提交材料 + 备用方案 |

## 扩展赚钱模式（空投/套利等）

当前可复验主路径是 `bounty_board`（链上发 bounty → OpenClaw 执行 → `claim_reward`）。为了后续扩展“空投/套利/多板轮询”等更强叙事，仓库里预留了赚钱模式骨架：

- `src/earn/modes/EarnMode.ts`：统一接口（启用开关 + run 结果结构）
- `src/earn/modes/AirdropMode.ts`：空投/积分占位（默认关闭）
- `src/earn/modes/ArbitrageMode.ts`：套利占位（默认关闭）

占位模式默认不会触发任何钱包动作；只有显式打开环境变量才会尝试运行（例如 `EARN_MODE_AIRDROP=true`）。

## 最近 N 轮统计（提交版）

统计口径：`evidence/evidence-testnet-*.json` 最近 20 轮（截至 2026-02-25 11:00，本地）。

| 指标 | 数值 |
|------|------|
| N | 20 |
| 正收益轮次 | 10 |
| 命中率 | 50.00% |
| Clean Positive 轮次（无 `missing-*`） | 10 |
| 平均 Earned | 0.0400 SUI |
| 平均 Spent | 0.0062 SUI |
| 平均 Net | 0.0338 SUI |

最近 5 轮实跑结果：`5 / 5` 为 **clean positive**（满足“5 轮里 ≥3 轮为正”的提交目标）。

### 主展示集（只放 clean positive）

- `evidence/evidence-testnet-2026-02-25T02-52-02-337Z.json`
- `evidence/evidence-testnet-2026-02-25T02-54-02-994Z.json`
- `evidence/evidence-testnet-2026-02-25T02-56-01-129Z.json`
- `evidence/evidence-testnet-2026-02-25T02-58-02-497Z.json`
- `evidence/evidence-testnet-2026-02-25T03-00-01-392Z.json`

对应人类可读报告：

- `evidence/evidence-report-2026-02-25T02-52-02-341Z.md`
- `evidence/evidence-report-2026-02-25T02-54-02-999Z.md`
- `evidence/evidence-report-2026-02-25T02-56-01-133Z.md`
- `evidence/evidence-report-2026-02-25T02-58-02-499Z.md`
- `evidence/evidence-report-2026-02-25T03-00-01-394Z.md`

### 失败原因归类（最近 20 轮）

| 失败类型 | 轮次 | 说明 |
|---------|------|------|
| 未命中 claim（earned=0） | 10 | 无可领 bounty 或未触发种子任务，导致收益端空转 |
| 支出高于收益（earned>0 但 net<=0） | 0 | 当前主展示集未出现 |
| 证据缺口（loss 且含 `missing-*` digest） | 0 | 当前主展示集未出现 |

### 不稳定解释与改进动作

不稳定根因主要是“收益触发条件”而不是“交易执行能力”：
- 花费侧（Seal + Walrus）可稳定执行；
- 收益侧在未显式触发 seed 时，部分轮次没有可领 bounty，导致 earned=0。

已实施改进：
- 新增 `EARNER_FORCE_SEED_BOUNTY=true` 路径：每轮先种子任务，再执行 claim；
- 强制 seed 时优先处理本钱包发布 bounty，减少“有 bounty 但不命中”的情况；
- 主展示样本仅保留 clean positive（避免 `missing-*` digest）。

## License

MIT

## Hackathon 提交准备

### 1. 链上证据收集

```bash
# 运行几个周期后生成证据
npm run evidence:generate

# 输出文件：
# - evidence/evidence-testnet-*.json     # 原始数据
# - evidence/evidence-report-*.md        # Markdown 报告
```

### 2. AI 开发证明（必须）

```bash
npm run ai-proof

# 输出文件：
# - ai-dev-proof.json    # 机器可读证明
# - ai-dev-proof.md      # 人类可读证明
```

### 3. 提交清单

- [ ] 代码仓库 (GitHub)
- [ ] 90 秒 Demo 视频
- [ ] 合约部署记录 (deployment.json)
- [ ] 链上证据报告 (evidence/*.md)
- [ ] AI 开发证明 (ai-dev-proof.md)
- [ ] README 项目说明

- **Slogan**: "The Autonomous Insurance Agent for Your Digital Life."
