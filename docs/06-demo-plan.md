# 模块六：演示计划 (Demo Plan)

> **v2 — 基于 00-redesign-proposal.md 重构**
> 核心变更：完全重设 6 幕演示剧本；移除 Faucet 依赖；以 BountyBoard 合约 + OpenClaw 工具链 + 链上验证为核心。

## 概述

90 秒 Demo，展示 Agent 从"生存危机"到"链上盈利"的完整自主经济循环。每一步都有真实的链上交易和 Explorer 链接可验证。

**核心叙事：Agent 快没钱了 → 发现链上赏金 → 用 OpenClaw 做任务 → 领取 SUI → 用 Seal 保护数据 → 用 Walrus 存储 → 展示盈利报表**

## 与旧版差异

| 项目 | 旧方案 (v1) | 新方案 (v2) |
|------|-------------|-------------|
| 收入来源 | 🚨 Faucet 水龙头 | ✅ BountyBoard 合约赏金 |
| 执行工具 | 🚨 execa 子进程 | ✅ OpenClaw Exec Tool |
| 加密 | 🚨 sleep(200) 假加密 | ✅ Seal SDK 真实加密 |
| 验证 | 无 | ✅ Browser Tool → Explorer |
| 稳定性 | 🚨 依赖外部 Faucet | ✅ 自建合约，完全自控 |
| 可审计性 | 无 | ✅ 审计包 + SHA-256 校验和 |

## 演前准备

### 环境要求

```bash
# 1. OpenClaw Gateway 运行中
openclaw gateway start

# 2. 环境变量就绪（通过 OpenClaw skills.entries 注入）
# SUI_PRIVATE_KEY=<base64>
# BOUNTY_PACKAGE_ID=0x...
# BOUNTY_BOARD_ID=0x...
# SEAL_PACKAGE_ID=0x...

# 3. BountyBoard 合约已部署 + 已存入 SUI + 已发布赏金
# （见下方"合约预置"）

# 4. Agent 代码已编译
npm run build
```

### 合约预置（Demo 前 10 分钟完成）

```bash
# 部署 BountyBoard Move 合约
sui client publish --path ./contracts/bounty_board --gas-budget 100000000

# 存入 SUI 到奖池（2 SUI）
sui client call \
  --package $BOUNTY_PACKAGE_ID \
  --module bounty_board \
  --function deposit \
  --args $BOUNTY_BOARD_ID <coin_object_id> \
  --gas-budget 10000000

# 发布 3 个赏金任务
sui client call \
  --package $BOUNTY_PACKAGE_ID \
  --module bounty_board \
  --function post_bounty \
  --args $BOUNTY_BOARD_ID '"Run eslint on the project"' 500000000 \
  --gas-budget 10000000

sui client call \
  --package $BOUNTY_PACKAGE_ID \
  --module bounty_board \
  --function post_bounty \
  --args $BOUNTY_BOARD_ID '"Run test suite"' 300000000 \
  --gas-budget 10000000

sui client call \
  --package $BOUNTY_PACKAGE_ID \
  --module bounty_board \
  --function post_bounty \
  --args $BOUNTY_BOARD_ID '"Format source code"' 200000000 \
  --gas-budget 10000000
```

### 稳定性保证

| 风险 | 缓解措施 |
|------|----------|
| BountyBoard 无赏金 | 演前预发布 3 个赏金，确保至少有 1 个可领取 |
| Seal Key Server 不可达 | Testnet Key Server 有冗余；提前验证连通性 |
| Walrus 节点延迟 | 设置 30 秒超时；演前上传一次预热 |
| OpenClaw Gateway 崩溃 | 演前 restart + health check |
| 余额不足 | Agent 钱包预留 ≥ 0.5 SUI |

## 演示剧本：6 幕 (90 秒)

### 🎬 Act 1 — 生存危机 (0:00 ~ 0:15)

**目标**：让观众看到 Agent 的"求生欲"

```
讲述：
"这是一个自主经济 Agent。它有一个 Sui 钱包，但余额快见底了。"

终端输出：
╔══════════════════════════════════════════════════╗
║  🤖 Agent Status: STARVATION MODE               ║
║  💰 Balance: 0.0100 SUI                         ║
║  ⚠️  Below survival threshold (0.01 SUI)         ║
║  🔗 Wallet: https://suiscan.xyz/testnet/account/0x1234...abcd ║
╚══════════════════════════════════════════════════╝

操作：
- 运行 `node dist/main.js`
- 展示 Agent 初始化，钱包地址 + Explorer 链接
- 强调：这是一个真实的链上钱包，不是模拟
```

**评审看点**：
- ✅ 真实 Sui 钱包地址
- ✅ Explorer 链接可点击验证
- ✅ STARVATION 模式激活（非静态文本）

---

### 🎬 Act 2 — 赏金发现 (0:15 ~ 0:25)

**目标**：展示 Agent 如何在链上发现赚钱机会

```
讲述：
"Agent 扫描了链上的 BountyBoard 合约，发现了 3 个可用赏金。"

终端输出：
📋 Found 3 available bounties:
  #0  "Run eslint on the project"    → 0.5000 SUI
  #1  "Run test suite"               → 0.3000 SUI
  #2  "Format source code"           → 0.2000 SUI

⚙️ Selected bounty #0 (highest reward: 0.5000 SUI)

操作：
- Agent 自动读取 BountyBoard 合约
- 展示赏金列表（来自链上，非硬编码）
- 指出 Agent 选择了奖励最高的任务
```

**评审看点**：
- ✅ 数据来自链上合约（可用 Explorer 验证 BountyBoard 对象）
- ✅ 智能选择策略（奖励排序）
- ✅ 不是 Faucet，是真正的"工作任务"

---

### 🎬 Act 3 — OpenClaw 执行 (0:25 ~ 0:40)

**目标**：展示 Agent 通过 OpenClaw 执行任务（核心 OpenClaw 集成展示）

```
讲述：
"Agent 通过 OpenClaw 的 Exec Tool 执行 lint 任务——不是直接调用子进程，
而是通过 Gateway RPC，有安全沙箱和超时保护。"

终端输出：
⚙️ Executing task #0: "Run eslint on the project"
  Command: npx eslint . --fix --format json 2>&1 || true
  → Sent to OpenClaw Gateway (http://127.0.0.1:18789/rpc)
  → Method: exec | Host: gateway | Timeout: 30s

  ✓ Task completed (2847ms)
  Output hash: e3b0c44298fc1c14...  (SHA-256 proof)

操作：
- 展示 HTTP RPC 调用（不是 execa）
- 强调 OpenClaw Exec Tool 的安全特性
- SHA-256 哈希 = 工作证明（将提交到链上）
```

**评审看点**：
- ✅ **OpenClaw Exec Tool** 直接集成（非 execa wrapper）
- ✅ Gateway RPC URL 可见
- ✅ SHA-256 工作证明机制
- ✅ 超时保护

---

### 🎬 Act 4 — 链上领取 (0:40 ~ 0:55)

**目标**：展示 Agent 在链上领取赏金（Move 合约交互）

```
讲述：
"Agent 将工作证明的 SHA-256 哈希提交到 BountyBoard 合约，
领取了 0.5 SUI 的赏金。这是真实的链上交易。"

终端输出：
💰 Claiming reward for bounty #0...
  Reward: 0.5000 SUI
  Proof: e3b0c44298fc1c14...

  ✓ Claimed! TX: 7YKz...9fD
  Explorer: https://suiscan.xyz/testnet/tx/7YKz...9fD

  💰 [Ledger] +0.5000 SUI | bounty_reward | Bounty #0 reward claimed
    ↳ Explorer: https://suiscan.xyz/testnet/tx/7YKz...9fD

操作：
- 展示 Move call 交易发送
- 点击 Explorer 链接验证交易成功
- 展示 Ledger 自动记录
```

**评审看点**：
- ✅ Move 合约调用（`bounty_board::claim_reward`）
- ✅ 链上交易 + Explorer 验证
- ✅ SHA-256 proof_hash 提交链上
- ✅ Ledger 自动记账

---

### 🎬 Act 5 — Seal 加密 + Walrus 存储 (0:55 ~ 1:15)

**目标**：展示 Agent 用赚来的 SUI 购买安全服务

```
讲述：
"Agent 用赚来的 SUI 做了一件有意义的事：用 Seal 加密保护 SSH 密钥，
然后上传到 Walrus 去中心化存储。注意密文比明文大——这证明加密是真实的。"

终端输出：
🛡️ Protecting "ssh-public-key" (742 bytes)...

🔐 Creating Seal Allowlist policy on-chain...
  ✓ Policy created: 0xABCD...1234
  Allowed addresses: [0x1234...abcd] (Agent only)

🔒 Encrypting 742 bytes with Seal...
  ✓ Encrypted: 742 → 1184 bytes
  Size ratio: 1.60x  ← 密文 > 明文！真实加密！
  Duration: 834ms

📤 Uploading 1184 bytes to Walrus...
  ✓ Uploaded: blobId = WRs7...xyz
  Duration: 1203ms

  💸 [Ledger] -0.0023 SUI | seal_encryption | Protected "ssh-public-key"

操作：
- 强调 1.60x 的大小膨胀（v1 是 1.0x，假加密）
- Seal Allowlist 策略创建在链上
- Walrus blobId 是真实的存储凭证
```

**评审看点**：
- ✅ **真实 Seal SDK** 加密（非 `sleep(200)`）
- ✅ 密文 > 明文（加密开销可验证）
- ✅ Allowlist 策略链上创建
- ✅ Walrus 上传 + blobId
- ✅ 保护的是有价值的数据（SSH 密钥）

---

### 🎬 Act 6 — 盈利报表 + Explorer 验证 (1:15 ~ 1:30)

**目标**：展示 Agent 的自我审计和盈利能力

```
讲述：
"最后，Agent 生成了财务报表。它赚了 0.5 SUI，花了 0.0023 SUI——
净利润 0.4977 SUI，利润率 99.5%。这就是 Infinite Money Glitch。"

终端输出：
📦 Generating audit package...
  Entries: 2
  On-chain TXs: 2
  Work proofs: 1
  Checksum: 7f83b165...

╔══════════════════════════════════════════════════╗
║           💰 Agent Financial Report 💰           ║
╠══════════════════════════════════════════════════╣
║  📈 +0.5000 SUI  bounty_reward   Bounty #0      ║
║     ↳ https://suiscan.xyz/testnet/tx/7YKz...9fD  ║
║  📉 -0.0023 SUI  seal_encryption SSH key         ║
╠══════════════════════════════════════════════════╣
║  Total Income:  +0.5000 SUI                      ║
║  Total Expense: -0.0023 SUI                      ║
║  Net Profit:    +0.4977 SUI                      ║
║  Margin:        99.5%                            ║
║  Status:        🟢 PROFITABLE                    ║
╠══════════════════════════════════════════════════╣
║  🔗 Wallet: https://suiscan.xyz/testnet/account/0x1234...abcd ║
╚══════════════════════════════════════════════════╝

🔍 On-chain Verification (Browser Tool):
  ✓ 7YKz...9fD → Verified on Explorer
  Total: 1/1 verified

✓ Cycle #1 completed in 8234ms

操作：
- 展示 P&L 报表（每一行都有 Explorer 链接）
- 指出净利润为正 → Agent 可以自我维持
- Browser Tool 验证交易在 Explorer 上可查
- 最后点击 Wallet Explorer 链接，展示链上资产变化
```

**评审看点**：
- ✅ 完整 P&L 报表（含 Explorer 链接）
- ✅ 审计包 + SHA-256 校验和
- ✅ Browser Tool 链上验证
- ✅ Agent 盈利 → "Infinite Money Glitch" 叙事成立
- ✅ 所有数据可在 Sui Explorer 上独立验证

---

## 时间线总览

```
0:00          0:15         0:25         0:40         0:55         1:15         1:30
  │            │            │            │            │            │            │
  ▼            ▼            ▼            ▼            ▼            ▼            ▼
┌──────────┬──────────┬──────────────┬──────────────┬────────────┬──────────────┐
│ Act 1    │ Act 2    │ Act 3        │ Act 4        │ Act 5      │ Act 6        │
│ 生存危机  │ 赏金发现  │ OpenClaw执行  │ 链上领取     │ Seal+Walrus│ 报表+验证    │
│          │          │              │              │            │              │
│ STARVE   │ BountyBd │ Exec Tool    │ Move TX      │ 真实加密   │ P&L + Audit  │
│ 余额展示  │ 链上查询  │ SHA-256      │ claim_reward │ 密文>明文  │ Browser验证  │
│ Explorer │ 任务选择  │ Gateway RPC  │ Explorer✓    │ blobId     │ Explorer✓    │
└──────────┴──────────┴──────────────┴──────────────┴────────────┴──────────────┘
  15s         10s         15s           15s           20s          15s
```

## 关键评审对标

根据 Hackathon Track 2 (Local God Mode) 评审标准：

| 评审维度 | Demo 展示点 | 对应幕 |
|---------|------------|--------|
| **OpenClaw 集成深度** | Exec Tool RPC 执行任务 | Act 3 |
| | Browser Tool Explorer 验证 | Act 6 |
| | Cron 定时触发（可提及） | Act 1 |
| | Skill 服务形态（可提及） | Act 1 |
| **Sui 链上交互** | Move 合约 claim_reward | Act 4 |
| | BountyBoard 合约读取 | Act 2 |
| | 链上 Allowlist 策略 | Act 5 |
| **创新性** | 自主经济循环 | 全程 |
| | SHA-256 工作证明 | Act 3-4 |
| | 审计包 + 校验和 | Act 6 |
| **完成度** | 端到端可运行 | 全程 |
| | 真实链上交易可验证 | Act 4, 6 |

## 备用方案

### 如果赏金已被领完

```bash
# 快速补发赏金
sui client call \
  --package $BOUNTY_PACKAGE_ID \
  --module bounty_board \
  --function post_bounty \
  --args $BOUNTY_BOARD_ID '"Emergency lint task"' 500000000 \
  --gas-budget 10000000
```

### 如果 Seal Key Server 超时

```
# 跳过 Seal 加密步骤，展示到 Act 4 即可
# 讲述："在生产环境中，Agent 还会用 Seal 加密保护数据..."
```

### 如果时间不足

```
# 精简版：Act 1 + Act 3 + Act 4 + Act 6 = 60 秒
# 跳过 Act 2（赏金发现）和 Act 5（Seal+Walrus）
# 重点突出 OpenClaw Exec Tool + Move 合约 + P&L
```

## 演后 Q&A 准备

| 可能问题 | 回答要点 |
|---------|---------|
| "这跟用 Faucet 有什么区别？" | BountyBoard 是自部署合约，赏金来自存入的 SUI，不是免费水龙头 |
| "OpenClaw 在哪里体现？" | Exec Tool (Act 3), Browser Tool (Act 6), Cron 触发, Skill 配置 |
| "Agent 怎么知道做什么任务？" | 读取链上 BountyBoard 合约的 bounties 数组 |
| "工作怎么验证？" | SHA-256(task_output) 作为 proof_hash 提交链上 |
| "Seal 加密是真的吗？" | 看密文大小膨胀率 — 1.6x 证明有真实加密开销 |
| "不依赖外部服务吗？" | 合约自部署自控 + OpenClaw 本地网关 + Sui/Walrus/Seal 用公共测试网 |
