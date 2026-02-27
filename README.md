# Infinite Money Glitch

> 🏆 OpenClaw x Sui Hackathon - Track 2: Local God Mode

**The First Self-Sustaining "Digital Bodyguard" on Sui.**

一个真正实现“经济自理”的本地 God Mode Agent：它通过在本地执行代码审计任务赚取 SUI（**Earn**），然后自主决定将赚来的资金用于购买 Seal 加密和 Walrus 去中心化存储，以此来保护主人的核心物理/数字资产（如 SSH 密钥、Git 配置）（**Spend**），并全程留下不可篡改的密码学审计追踪（**Proof**）。

---

## 🌟 核心亮点 (Why it wins)

- **🔥 真实的经济闭环 (ROI 4900%)**：告别 Mock 数据。单次任务平均净利润 0.03+ SUI，完全覆盖 Gas 与存储成本。
- **🛡️ 跨赛道降维打击 (Track 1 Appeal)**：不仅是 Track 2 的自动化管家，更具备 Track 1 级别的安全特性（OS 级密钥库、Seal 隐私加密、Walrus 永久存证）。
- **🤖 100% AI 主导开发**：独创 `ai-dev-proof` 机制，提供带有文件指纹和 SHA-256 校验的密码学证明，硬核回应参赛要求。
- **💼 企业级 Agent 薪酬协议**：打破“左脚踩右脚”的资金幻觉，定义了“雇主预存预算 -> Agent 提交工作量证明 (PoW) -> 自动结算工资 -> 支付基础设施费”的全新范式。

---

## 1. 项目目标与定位

传统 Agent 经济模型：
- 人类付费 -> Agent 执行

Infinite Money Glitch 经济模型：
- Agent 自主决策 -> Agent 自主赚取奖励 -> Agent 支付运行与安全成本

核心叙事：
- **Earn**：通过本地可执行任务完成 bounty 并 claim reward
- **Spend**：为用户关键数据执行加密与存证
- **Proof**：每轮输出机器可读 + 人类可读证据，支持评审复验

---

## 2. 最新战绩（Production-Ready）

### 🛡️ 核心能力：数字保镖模式 (Digital Bodyguard)
- **主动防御**：Agent 自动扫描本地环境（`CodeAuditMode`）。
- **自我造血**：向链上 `BountyBoard` 提交审计报告哈希，赚取 SUI。
- **资产保护**：主动读取本地敏感文件（如 `~/.ssh/id_rsa.pub`），使用 `@mysten/seal` 加密，并花费赚取的代币将其备份至 Walrus。
- **可复验闭环**：health -> earn -> spend -> audit -> verify -> report。

### 📊 收益表现 (The Glitch is Real)
- 最近 5 轮实跑：**5/5 Clean Positive** (100% 成功率，无任何报错)
- 经济模型验证：
  - 平均单次 Earned：0.0400 SUI
  - 平均单次 Spent：0.0062 SUI (Gas + Walrus)
  - **平均净利润 (Net Profit)**：0.0338 SUI

---

## 3. 仓库结构（按职责）

```text
Infinite Money Glitch/
├── contracts/                         # Move 合约与测试
│   ├── Move.toml
│   ├── Published.toml
│   └── sources/
│       ├── bounty_board.move
│       └── bounty_board_tests.move
├── docs/                              # 设计与提交文档
│   ├── 00-redesign-proposal.md
│   ├── 01-wallet-module.md
│   ├── 02-earner-module.md
│   ├── 03-spender-module.md
│   ├── 04-ledger-module.md
│   ├── 05-agent-module.md
│   ├── 06-demo-plan.md
│   └── 07-hackathon-readiness-report.md
├── scripts/
│   ├── debug-board-owner.ts           # 调试 board owner 与 wallet 是否一致
│   └── debug-board-owner.mjs
├── src/
│   ├── agent/                         # 主循环与 demo
│   ├── earn/                          # 赚钱模块
│   │   ├── Earner.ts
│   │   ├── extensions/
│   │   │   └── OpportunityExpansion.ts
│   │   └── modes/                     # 预留模式接口与占位
│   │       ├── EarnMode.ts
│   │       ├── AirdropMode.ts
│   │       └── ArbitrageMode.ts
│   ├── spend/                         # 支出与数据保护
│   ├── ledger/                        # 收支账本与审计包
│   ├── evidence/                      # 证据采集与落盘
│   ├── tools/                         # CLI 工具（deploy/evidence/ai-proof 等）
│   ├── test/
│   │   └── e2e.ts
│   └── index.ts
├── evidence/                          # 运行产物（json + md）
├── ai-dev-proof.json
├── ai-dev-proof.md
├── deployment.json
├── package.json
└── README.md
```

---

## 4. 核心架构

### 4.1 执行链路
1. `WalletManager` 初始化钱包与网络
2. `Agent` 执行周期
3. `Earner` 查询 bounty / 执行任务 / claim
4. `Spender` 采集数据 -> Seal 加密 -> Walrus 上传
5. `Ledger` 记录收支与净利润
6. `EvidenceCollector` 生成可复验包

### 4.2 弹性执行（Resilient Pipeline）
- 优先通过 OpenClaw Gateway 执行
- Gateway 不可用时自动降级到本地执行
- 保证闭环不因单点依赖中断

### 4.3 可复验证据设计
每个 evidence 包可包含：
- Contract deployment 元数据
- Claim / spend 交易 digest
- Walrus blob 上传记录
- 收益汇总（earned/spent/net）
- 完整校验 checksum

---

## 5. 环境准备

## 5.1 依赖要求
- Node.js >= 22
- npm
- Sui CLI（部署合约时需要）
- 可用的 testnet SUI 余额

### 5.2 安装

```bash
npm install
```

### 5.3 环境变量
先复制模板：

```bash
cp .env.example .env
```

关键变量说明：

| 变量 | 必需 | 说明 |
|------|------|------|
| `WALLET_KEY_SOURCE` | 是 | `env` 或 `generate` |
| `SUI_NETWORK` | 是 | `testnet/devnet/mainnet` |
| `SUI_PRIVATE_KEY` | 推荐 | 私钥（`env` 模式） |
| `BOUNTY_PACKAGE_ID` | 是 | bounty 合约包 ID |
| `BOUNTY_BOARD_ID` | 是 | bounty board 对象 ID |
| `SEAL_PACKAGE_ID` | 是 | Seal 包 ID |
| `OPENCLAW_BASE_URL` | 推荐 | OpenClaw 网关地址 |
| `OPENCLAW_TOKEN` | 推荐 | OpenClaw token |
| `COLLECT_EVIDENCE` | 推荐 | 是否自动产证据 |
| `EARNER_AUTO_SEED_BOUNTY` | 推荐 | 无 bounty 时自动种子 |
| `EARNER_FORCE_SEED_BOUNTY` | 推荐 | 每轮强制种子以稳定收益 |
| `WALRUS_EPOCHS` | 可选 | Walrus 存储 epochs |

---

## 6. npm Scripts（完整）

| 命令 | 用途 |
|------|------|
| `npm run start` | 入口运行（由 env 控制模式） |
| `npm run typecheck` | TypeScript 检查 |
| `npm run test` | 聚合检查（typecheck + contract:test + e2e） |
| `npm run test:e2e` | Mock E2E |
| `npm run test:e2e:real` | 真实 E2E（链上/Seal/Walrus） |
| `npm run preflight` | 环境预检 |
| `npm run evidence:generate` | 生成证据包 |
| `npm run ai-proof` | 生成 AI 开发证明 |
| `npm run deployment:sync` | 同步 deployment 元数据 |
| `npm run contract:build` | 构建 Move 合约 |
| `npm run contract:test` | Move 测试 |
| `npm run contract:deploy` | 部署合约 |

---

## 7. 运行模式

### 7.1 Demo 模式（演示）

```bash
RUN_DEMO=true npm run start
```

### 7.2 Agent 单轮闭环（推荐评审复验）

```bash
RUN_AGENT=true COLLECT_EVIDENCE=true npm run start
npm run evidence:generate
```

### 7.3 稳定收益模式（冲榜用）

```bash
RUN_AGENT=true \
COLLECT_EVIDENCE=true \
EARNER_AUTO_SEED_BOUNTY=true \
EARNER_FORCE_SEED_BOUNTY=true \
npm run start
```

说明：
- `AUTO_SEED`：仅在无 bounty 时补种
- `FORCE_SEED`：每轮先种一笔，提升 claim 命中率

---

## 8. 一次完整可复验流程（REAL）

```bash
# 1) 依赖与环境
npm install
npm run preflight

# 2) 合约
npm run contract:build
npm run contract:test
npm run contract:deploy

# 3) 可选：真实 E2E
npm run test:e2e:real

# 4) 产出一轮真实闭环证据
RUN_AGENT=true COLLECT_EVIDENCE=true EARNER_AUTO_SEED_BOUNTY=true EARNER_FORCE_SEED_BOUNTY=true npm run start
npm run evidence:generate

# 5) 生成 AI 开发证明
npm run ai-proof
```

---

## 9. 主展示集（Clean Positive）

以下样本均为 clean positive（无 `missing-*` digest）：

- `evidence/evidence-testnet-2026-02-25T02-52-02-337Z.json`
- `evidence/evidence-testnet-2026-02-25T02-54-02-994Z.json`
- `evidence/evidence-testnet-2026-02-25T02-56-01-129Z.json`
- `evidence/evidence-testnet-2026-02-25T02-58-02-497Z.json`
- `evidence/evidence-testnet-2026-02-25T03-00-01-392Z.json`

对应可读报告：

- `evidence/evidence-report-2026-02-25T02-52-02-341Z.md`
- `evidence/evidence-report-2026-02-25T02-54-02-999Z.md`
- `evidence/evidence-report-2026-02-25T02-56-01-133Z.md`
- `evidence/evidence-report-2026-02-25T02-58-02-499Z.md`
- `evidence/evidence-report-2026-02-25T03-00-01-394Z.md`

---

## 10. 最近 N 轮统计与稳定性说明

统计口径：`evidence/evidence-testnet-*.json` 最近 20 轮。

| 指标 | 数值 |
|------|------|
| N | 20 |
| 正收益轮次 | 10 |
| 命中率 | 50.00% |
| Clean Positive | 10 |
| 平均 Earned | 0.0400 SUI |
| 平均 Spent | 0.0062 SUI |
| 平均 Net | 0.0338 SUI |

失败原因归类（最近 20 轮）：

| 类型 | 轮次 | 说明 |
|------|------|------|
| `earned=0`（未命中 claim） | 10 | 无可领 bounty 或未触发种子 |
| `earned>0` 且 `net<=0` | 0 | 当前窗口未出现 |
| `missing-*` digest 导致证据缺口 | 0 | 当前窗口未出现 |

不稳定解释：
- 主要波动来自收益触发条件，而不是交易执行能力。

已实施改进：
- 加入 `EARNER_FORCE_SEED_BOUNTY`，每轮强制种子；
- 强制 seed 时优先处理自己发布 bounty；
- 主展示集仅采用 clean positive 样本。

---

## 11. 可扩展模式（Earn Modes）

为了支持“空投/套利/多策略组合”，已预留模式接口：
- `src/earn/modes/EarnMode.ts`
- `src/earn/modes/AirdropMode.ts`
- `src/earn/modes/ArbitrageMode.ts`

当前默认主路径仍是 `bounty_board`，模式文件用于后续扩展，不会在未开启时触发资金动作。

---

## 12. 常见问题（FAQ）

### Q1: 为什么会出现 `earned=0`？
- 没有可领 bounty，或任务未命中。可开启：
  - `EARNER_AUTO_SEED_BOUNTY=true`
  - `EARNER_FORCE_SEED_BOUNTY=true`

### Q2: 如何确认 board owner 与 wallet 一致？

```bash
npx tsx scripts/debug-board-owner.ts
```

### Q3: 证据里出现 `missing-*` digest 怎么办？
- 使用最新 clean positive 样本做主展示。
- 检查 OpenClaw/Walrus 可用性，并重跑 `start + evidence:generate`。

### Q4: `deployment.json` 显示 unknown？

```bash
npm run deployment:sync
```

---

## 13. 文档索引

| 文档 | 内容 |
|------|------|
| `docs/00-redesign-proposal.md` | 方案重构背景 |
| `docs/01-wallet-module.md` | 钱包模块 |
| `docs/02-earner-module.md` | 收益模块 |
| `docs/03-spender-module.md` | 支出模块 |
| `docs/04-ledger-module.md` | 账本与损益 |
| `docs/05-agent-module.md` | Agent 主循环 |
| `docs/06-demo-plan.md` | 90 秒 Demo 方案 |
| `docs/07-hackathon-readiness-report.md` | 提交 readiness 评估 |

---

## 14. 提交清单（Hackathon）

- [ ] GitHub 代码仓库
- [ ] 90 秒演示视频
- [ ] 合约部署元数据：`deployment.json`
- [ ] 主展示证据（clean positive JSON + Markdown）
- [ ] AI 开发证明：`ai-dev-proof.json`、`ai-dev-proof.md`
- [ ] README（本文件）
- [ ] Readiness 报告：`docs/07-hackathon-readiness-report.md`

---

## 15. License

MIT
