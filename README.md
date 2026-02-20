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
│   │   └── Earner.ts              # 赚钱逻辑
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

# 3. 部署合约（需要 Sui CLI）
npm run contract:build         # 构建 Move 合约
npm run contract:test          # 运行合约测试
npm run contract:deploy        # 部署到 testnet

# 4. 运行端到端测试
npm run test:e2e               # Mock 模式
npm run test:e2e:real          # 真实模式（需要 OpenClaw Gateway）

# 5. 模块演示（可选，按需打开 .env 中 RUN_* 开关）
npm run start

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

推荐演示开关：

- `RUN_DEMO=true`
- `RUN_AGENT=false`
- `RUN_EARNER=false`
- `RUN_SPENDER=false`
- `RUN_LEDGER=false`

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
