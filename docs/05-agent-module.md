# 模块五：Agent 核心 (Agent)

> **v2 — 基于 00-redesign-proposal.md 重构**
> 核心变更：移除 `while(running)` 轮询循环；改为 OpenClaw Cron 驱动的 Skill 服务；新增审计阶段和 Browser Tool 验证。

## 概述

Agent 是整个系统的"大脑"——协调 Wallet、Earner、Spender、Ledger 四个模块完成自主经济循环。它不再是一个自旋的 `while` 循环，而是一个由 OpenClaw Cron 触发的 **Skill 服务**，每次被调用时执行一个完整的 `runCycle()`。

## 核心变更

| 项目 | 旧方案 (v1) | 新方案 (v2) |
|------|-------------|-------------|
| 生命周期 | 🚨 `while(running)` 无限循环 | ✅ OpenClaw Cron 定时触发 |
| 触发方式 | 代码内 `setInterval` / `sleep` | ✅ Cron job → `every: "5m"` |
| 服务形态 | 独立 Node.js 脚本 | ✅ OpenClaw Skill 服务 |
| 周期内容 | 赚 → 花（2 步） | ✅ 健康检查 → 赚 → 花 → 审计 → 验证 → 报告（6 步） |
| 错误恢复 | `try/catch` + continue | ✅ STARVATION 模式 + 降级策略 |
| 验证 | 无 | ✅ OpenClaw Browser Tool 链上验证 |

## 技术依赖

```json
{
  "@mysten/sui": "^1.x.x",
  "@mysten/seal": "^0.x.x",
  "@mysten/walrus": "^1.x.x"
}
```

运行环境依赖：
- OpenClaw Gateway (`http://127.0.0.1:18789`)
- OpenClaw Cron（定时触发）
- BountyBoard Move 合约（已部署）

## Agent 作为 OpenClaw Skill

### SKILL.md

```markdown
---
name: infinite-money-glitch
description: Self-sustaining autonomous agent on Sui blockchain
metadata:
  openclaw:
    requires:
      bins:
        - node
        - npx
      env:
        - SUI_PRIVATE_KEY
        - BOUNTY_PACKAGE_ID
        - BOUNTY_BOARD_ID
    os:
      - macos
      - linux
      - windows
    emoji: 💰
---

# Infinite Money Glitch Agent

A self-sustaining agent that earns SUI through BountyBoard tasks,
spends SUI on Seal encryption and Walrus storage, and reports
profit/loss with on-chain proof.

## Usage

\`\`\`
Run a single economic cycle: earn → spend → audit → verify → report
\`\`\`
```

### OpenClaw Cron 配置

```json
{
  "cron": {
    "jobs": [
      {
        "id": "img-heartbeat",
        "schedule": {
          "every": "5m"
        },
        "skill": "infinite-money-glitch",
        "prompt": "Run one economic cycle: check health, earn bounty, spend on protection, audit, verify on explorer, report P&L",
        "session": "main",
        "delivery": "announce"
      }
    ]
  }
}
```

## 接口设计

### 类型定义

```typescript
// Agent 运行模式
type AgentMode = 'NORMAL' | 'STARVATION' | 'ERROR';

// Agent 状态
interface AgentState {
  // 当前模式
  mode: AgentMode;
  // 已执行周期数
  cycleCount: number;
  // 最后一次周期时间
  lastCycleAt: Date | null;
  // 连续失败次数
  consecutiveFailures: number;
  // 总收入（MIST）
  totalEarned: bigint;
  // 总支出（MIST）
  totalSpent: bigint;
  // Wallet Explorer URL
  walletExplorerUrl: string;
}

// 单次周期结果
interface CycleResult {
  // 周期编号
  cycleNumber: number;
  // 执行模式
  mode: AgentMode;
  // 各阶段结果
  phases: {
    healthCheck: HealthCheckResult;
    earn: EarnResult | null;
    spend: SpendResult | null;
    audit: AuditPackage | null;
    verify: VerifyResult | null;
    report: ReportResult;
  };
  // 总耗时
  duration: number;
  // 是否成功
  success: boolean;
  // 错误信息
  error?: string;
}

// 健康检查结果
interface HealthCheckResult {
  // 余额
  balance: bigint;
  // 是否足够操作
  sufficientBalance: boolean;
  // BountyBoard 合约可达
  bountyBoardReachable: boolean;
  // OpenClaw Gateway 可达
  openclawGatewayReachable: boolean;
  // 建议模式
  recommendedMode: AgentMode;
}

// 链上验证结果（从 Browser Tool 获取）
interface VerifyResult {
  // 验证的交易数
  transactionsVerified: number;
  // 所有交易是否可在 Explorer 中确认
  allVerified: boolean;
  // Explorer 截图 URL（可选）
  screenshotUrl?: string;
  // 验证详情
  details: {
    txDigest: string;
    verified: boolean;
    explorerUrl: string;
  }[];
}

// 报告结果
interface ReportResult {
  // P&L 摘要
  pnlSummary: string;
  // 生存状态
  survivalStatus: string;
  // 下次周期预计时间
  nextCycleAt: Date;
}
```

### 核心方法

```typescript
class Agent {
  /**
   * 初始化 Agent（组装所有模块）
   */
  constructor(config: AgentConfig);

  /**
   * 执行一个完整的经济周期（由 OpenClaw Cron 触发）
   * 这是 Agent 的核心入口点
   *
   * 6 步流程：
   * 1. 健康检查 — 余额、合约可达性
   * 2. 赚取 — BountyBoard 任务
   * 3. 支出 — Seal 加密 + Walrus 存储
   * 4. 审计 — 生成审计包
   * 5. 验证 — Browser Tool 检查 Explorer
   * 6. 报告 — P&L 输出
   */
  async runCycle(): Promise<CycleResult>;

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthCheckResult>;

  /**
   * 使用 OpenClaw Browser Tool 验证链上交易
   */
  async verifyOnChain(txDigests: string[]): Promise<VerifyResult>;

  /**
   * 获取当前状态
   */
  getState(): AgentState;
}
```

## 实现细节

### 1. Agent 初始化

```typescript
class Agent {
  private wallet: WalletManager;
  private earner: Earner;
  private spender: Spender;
  private ledger: Ledger;

  private state: AgentState;
  private config: AgentConfig;
  private openclawBaseUrl = 'http://127.0.0.1:18789';

  // STARVATION 阈值 — 低于此余额进入饥饿模式
  private STARVATION_THRESHOLD = 10_000_000n; // 0.01 SUI

  constructor(config: AgentConfig) {
    this.config = config;

    // 组装模块
    this.wallet = new WalletManager();
    this.ledger = new Ledger();
    this.earner = new Earner(this.wallet, {
      network: config.network,
      bountyPackageId: config.bountyPackageId,
      bountyBoardId: config.bountyBoardId
    });
    this.spender = new Spender(this.wallet, {
      network: config.network,
      sealPackageId: config.sealPackageId
    });

    this.state = {
      mode: 'NORMAL',
      cycleCount: 0,
      lastCycleAt: null,
      consecutiveFailures: 0,
      totalEarned: 0n,
      totalSpent: 0n,
      walletExplorerUrl: ''
    };
  }

  /**
   * 入口：初始化所有模块
   */
  async initialize(): Promise<void> {
    console.log('\n🤖 Agent initializing...\n');

    await this.wallet.initialize({
      keySource: 'env',
      network: this.config.network,
      bountyPackageId: this.config.bountyPackageId,
      bountyBoardId: this.config.bountyBoardId
    });

    this.state.walletExplorerUrl = this.wallet.getExplorerUrl();
    console.log(`\n✓ Agent initialized. Wallet: ${this.wallet.getAddress()}`);
    console.log(`  Explorer: ${this.state.walletExplorerUrl}\n`);
  }
}
```

### 2. 核心运行周期（6 步）

```typescript
/**
 * ✅ 新版 runCycle() — 由 OpenClaw Cron 触发
 * ❌ 旧版 while(running) 循环已删除
 */
async runCycle(): Promise<CycleResult> {
  const cycleNum = ++this.state.cycleCount;
  const startTime = Date.now();

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  🔄 Cycle #${cycleNum} | Mode: ${this.state.mode.padEnd(12)}        ║`);
  console.log('╠══════════════════════════════════════════════════╣');

  const phases: CycleResult['phases'] = {
    healthCheck: {} as HealthCheckResult,
    earn: null,
    spend: null,
    audit: null,
    verify: null,
    report: {} as ReportResult
  };

  try {
    // ━━━━━━━ Phase 1: 健康检查 ━━━━━━━
    console.log('\n📋 Phase 1: Health Check');
    phases.healthCheck = await this.healthCheck();
    this.state.mode = phases.healthCheck.recommendedMode;

    if (!phases.healthCheck.bountyBoardReachable) {
      throw new Error('BountyBoard contract unreachable');
    }

    // ━━━━━━━ Phase 2: 赚取 ━━━━━━━
    console.log('\n💼 Phase 2: Earn');
    if (this.state.mode === 'STARVATION') {
      console.log('  ⚠️ STARVATION mode — prioritizing earning');
    }
    phases.earn = await this.earner.earn();

    if (phases.earn.claims.length > 0) {
      for (const claim of phases.earn.claims) {
        if (claim.success) {
          this.ledger.recordEarning(claim);
          this.state.totalEarned += claim.rewardAmount;
        }
      }
    }

    // ━━━━━━━ Phase 3: 支出（STARVATION 模式跳过）━━━━━━━
    console.log('\n💸 Phase 3: Spend');
    if (this.state.mode === 'STARVATION') {
      console.log('  ⏭️ Skipping spend — STARVATION mode');
    } else {
      phases.spend = await this.spender.spend();

      if (phases.spend && phases.spend.protections.length > 0) {
        for (const protection of phases.spend.protections) {
          if (protection.success) {
            this.ledger.recordSpending(protection);
            this.state.totalSpent += protection.gasSpent;
          }
        }
      }
    }

    // ━━━━━━━ Phase 4: 审计 ━━━━━━━
    console.log('\n📦 Phase 4: Audit');
    phases.audit = this.ledger.generateAuditPackage(
      this.wallet.getAddress()
    );

    // ━━━━━━━ Phase 5: 链上验证（Browser Tool）━━━━━━━
    console.log('\n🔍 Phase 5: On-chain Verification');
    const txDigests = this.collectTxDigests(phases);
    if (txDigests.length > 0) {
      phases.verify = await this.verifyOnChain(txDigests);
    } else {
      console.log('  No transactions to verify this cycle');
    }

    // ━━━━━━━ Phase 6: 报告 ━━━━━━━
    console.log('\n📊 Phase 6: Report');
    this.ledger.printSummary();
    phases.report = this.generateReport();

    // 成功 → 重置失败计数
    this.state.consecutiveFailures = 0;
    this.state.lastCycleAt = new Date();

    const result: CycleResult = {
      cycleNumber: cycleNum,
      mode: this.state.mode,
      phases,
      duration: Date.now() - startTime,
      success: true
    };

    console.log(`\n✓ Cycle #${cycleNum} completed in ${result.duration}ms`);
    console.log('╚══════════════════════════════════════════════════╝\n');

    return result;

  } catch (error) {
    this.state.consecutiveFailures++;
    const errMsg = error instanceof Error ? error.message : String(error);

    console.error(`\n✗ Cycle #${cycleNum} failed: ${errMsg}`);
    console.log('╚══════════════════════════════════════════════════╝\n');

    return {
      cycleNumber: cycleNum,
      mode: this.state.mode,
      phases,
      duration: Date.now() - startTime,
      success: false,
      error: errMsg
    };
  }
}
```

### 3. 健康检查

```typescript
/**
 * 检查 Agent 运行环境是否正常
 */
async healthCheck(): Promise<HealthCheckResult> {
  // 1. 查余额
  const balance = await this.wallet.getBalance();
  const sufficientBalance = balance.sui > this.STARVATION_THRESHOLD;

  // 2. BountyBoard 可达性
  let bountyBoardReachable = false;
  try {
    const bounties = await this.earner.getAvailableBounties();
    bountyBoardReachable = true;
  } catch {
    bountyBoardReachable = false;
  }

  // 3. OpenClaw Gateway 可达性
  let openclawGatewayReachable = false;
  try {
    const resp = await fetch(`${this.openclawBaseUrl}/health`);
    openclawGatewayReachable = resp.ok;
  } catch {
    openclawGatewayReachable = false;
  }

  // 4. 推断模式
  let recommendedMode: AgentMode = 'NORMAL';
  if (!sufficientBalance) {
    recommendedMode = 'STARVATION';
  }
  if (this.state.consecutiveFailures >= 3) {
    recommendedMode = 'ERROR';
  }

  const result: HealthCheckResult = {
    balance: balance.sui,
    sufficientBalance,
    bountyBoardReachable,
    openclawGatewayReachable,
    recommendedMode
  };

  console.log(`  Balance: ${balance.suiFormatted}`);
  console.log(`  Sufficient: ${sufficientBalance ? '✓' : '✗'}`);
  console.log(`  BountyBoard: ${bountyBoardReachable ? '✓' : '✗'}`);
  console.log(`  Gateway: ${openclawGatewayReachable ? '✓' : '✗'}`);
  console.log(`  Mode: ${recommendedMode}`);

  return result;
}
```

### 4. Browser Tool 链上验证

```typescript
/**
 * 使用 OpenClaw Browser Tool 访问 Sui Explorer 验证交易
 * 这是 Agent"自证清白"的关键步骤
 */
async verifyOnChain(txDigests: string[]): Promise<VerifyResult> {
  console.log(`  Verifying ${txDigests.length} transactions...`);

  const details: VerifyResult['details'] = [];

  for (const digest of txDigests) {
    const explorerUrl = `https://suiscan.xyz/testnet/tx/${digest}`;

    try {
      // 使用 OpenClaw Browser Tool 访问 Explorer
      const response = await fetch(`${this.openclawBaseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
        },
        body: JSON.stringify({
          method: 'browser',
          params: {
            action: 'navigate',
            url: explorerUrl
          }
        })
      });

      const result = await response.json();

      // 检查页面快照中是否包含交易成功标志
      const snapshotResp = await fetch(`${this.openclawBaseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
        },
        body: JSON.stringify({
          method: 'browser',
          params: {
            action: 'snapshot'
          }
        })
      });

      const snapshot = await snapshotResp.json();
      const pageText = snapshot.text || '';
      const verified = pageText.includes('Success') || pageText.includes(digest);

      details.push({
        txDigest: digest,
        verified,
        explorerUrl
      });

      console.log(`  ${verified ? '✓' : '✗'} ${digest.slice(0, 12)}... → ${explorerUrl}`);

    } catch (error) {
      details.push({
        txDigest: digest,
        verified: false,
        explorerUrl
      });
      console.log(`  ✗ ${digest.slice(0, 12)}... → verification failed`);
    }
  }

  const allVerified = details.every(d => d.verified);
  console.log(`  Total: ${details.filter(d => d.verified).length}/${details.length} verified`);

  return {
    transactionsVerified: details.filter(d => d.verified).length,
    allVerified,
    details
  };
}

/**
 * 从周期各阶段收集所有 TX digests
 */
private collectTxDigests(phases: CycleResult['phases']): string[] {
  const digests: string[] = [];

  // 从 Earner claims 收集
  if (phases.earn?.claims) {
    for (const claim of phases.earn.claims) {
      if (claim.txDigest) digests.push(claim.txDigest);
    }
  }

  // 从 Spender protections 收集（upload TX）
  if (phases.spend?.protections) {
    for (const p of phases.spend.protections) {
      if (p.upload?.txDigest) digests.push(p.upload.txDigest);
    }
  }

  return digests;
}
```

### 5. 报告生成

```typescript
/**
 * 生成周期报告
 */
private generateReport(): ReportResult {
  const pnl = this.ledger.generatePnL();
  const netProfit = Number(pnl.netProfit) / 1e9;
  const totalIncome = Number(pnl.totalIncome) / 1e9;
  const totalExpense = Number(pnl.totalExpense) / 1e9;

  const survivalStatus = pnl.netProfit > 0n
    ? '🟢 PROFITABLE — Agent is self-sustaining'
    : pnl.netProfit === 0n
      ? '🟡 BREAK-EVEN — Agent is surviving'
      : '🔴 LOSS — Agent needs more bounties';

  const pnlSummary = [
    `Income: +${totalIncome.toFixed(4)} SUI`,
    `Expense: -${totalExpense.toFixed(4)} SUI`,
    `Net: ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(4)} SUI`,
    `Margin: ${(pnl.profitMargin * 100).toFixed(1)}%`,
    `Wallet: ${this.state.walletExplorerUrl}`
  ].join('\n');

  console.log(`  ${survivalStatus}`);
  console.log(`  P&L: ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(4)} SUI`);

  return {
    pnlSummary,
    survivalStatus,
    nextCycleAt: new Date(Date.now() + 5 * 60 * 1000) // 5 分钟后
  };
}
```

### 6. 程序入口

```typescript
/**
 * 程序入口 — 被 OpenClaw Cron 调用
 * 不再是 while(running)，而是单次执行
 */
async function main() {
  const agent = new Agent({
    network: 'testnet',
    bountyPackageId: process.env.BOUNTY_PACKAGE_ID!,
    bountyBoardId: process.env.BOUNTY_BOARD_ID!,
    sealPackageId: process.env.SEAL_PACKAGE_ID!
  });

  await agent.initialize();
  const result = await agent.runCycle();

  // 输出结果供 OpenClaw 读取
  console.log(JSON.stringify({
    success: result.success,
    cycle: result.cycleNumber,
    mode: result.mode,
    duration: result.duration,
    earned: result.phases.earn?.totalEarned?.toString() || '0',
    spent: result.phases.spend?.totalGasSpent?.toString() || '0'
  }));

  process.exit(result.success ? 0 : 1);
}

main().catch(console.error);
```

## 与 v1 的关键差异

```
旧版 Agent (v1):                     新版 Agent (v2):
┌──────────────────────┐              ┌──────────────────────┐
│ async run() {        │              │ // OpenClaw Cron ─→  │
│   while(running) {   │              │ async runCycle() {   │
│     await earn();    │              │   healthCheck();     │
│     await spend();   │              │   earn();            │
│     await sleep(60s);│              │   spend();           │
│   }                  │              │   audit();           │
│ }                    │              │   verifyOnChain();   │
│                      │              │   report();          │
│ ❌ 永不停止            │              │ }                    │
│ ❌ 无审计              │              │                      │
│ ❌ 无验证              │              │ ✅ Cron 定时触发      │
│ ❌ 无健康检查          │              │ ✅ 6 步完整周期       │
│ ❌ 无 STARVATION 模式  │              │ ✅ Browser Tool 验证 │
└──────────────────────┘              └──────────────────────┘
```

## STARVATION 模式

```
                  余额检查
                    │
          ┌─────────┤
          │         │
    余额 > 0.01    余额 ≤ 0.01
          │         │
    NORMAL 模式    STARVATION 模式
    ┌─────────┐    ┌─────────┐
    │ earn()  │    │ earn()  │ ← 只赚不花
    │ spend() │    │  skip   │ ← 跳过支出
    │ audit() │    │ audit() │
    │ verify()│    │ verify()│
    │ report()│    │ report()│
    └─────────┘    └─────────┘
```

## 单元测试要点

```typescript
describe('Agent v2', () => {
  it('should complete a full 6-phase cycle', async () => {
    const result = await agent.runCycle();
    expect(result.success).toBe(true);
    expect(result.phases.healthCheck).toBeTruthy();
    expect(result.phases.report).toBeTruthy();
  });

  it('should skip spending in STARVATION mode', async () => {
    // 模拟低余额
    agent['state'].mode = 'STARVATION';
    const result = await agent.runCycle();
    expect(result.phases.spend).toBeNull();
  });

  it('should NOT have while(running) loop', () => {
    const source = readFileSync('src/agent.ts', 'utf-8');
    expect(source).not.toContain('while(running)');
    expect(source).not.toContain('while (running)');
    expect(source).not.toContain('while(this.running)');
  });

  it('should verify transactions via Browser Tool', async () => {
    const verifyResult = await agent.verifyOnChain(['TX_DIGEST_1']);
    expect(verifyResult.details[0].explorerUrl).toContain('suiscan.xyz');
  });

  it('should increment cycle count', async () => {
    const before = agent.getState().cycleCount;
    await agent.runCycle();
    expect(agent.getState().cycleCount).toBe(before + 1);
  });

  it('should enter ERROR mode after 3 consecutive failures', async () => {
    agent['state'].consecutiveFailures = 3;
    const health = await agent.healthCheck();
    expect(health.recommendedMode).toBe('ERROR');
  });
});
```

## 与其他模块的关系

```
┌──────────────────────────────────────────────────────────────┐
│                    OpenClaw Cron                              │
│                  "every: 5m"                                 │
│                       │                                      │
│                  ┌────▼────┐                                │
│                  │  Agent  │ ◄── 本模块（大脑）               │
│                  └────┬────┘                                │
│                       │                                      │
│    ┌──────────────────┼──────────────────┐                   │
│    │           │             │           │                   │
│    ▼           ▼             ▼           ▼                   │
│ Wallet      Earner       Spender     Ledger                 │
│ (银行)      (赚钱)       (花钱)      (记账)                  │
│    │           │             │           │                   │
│    │      BountyBoard    Seal+Walrus   审计包                │
│    │      (Move合约)     (加密+存储)   (P&L)                 │
│    │           │             │           │                   │
│    └───────────┴─────────────┴───────────┘                   │
│                       │                                      │
│                   Sui Testnet                                │
│                       │                                      │
│              OpenClaw Browser Tool                           │
│              (Explorer 验证)                                 │
└──────────────────────────────────────────────────────────────┘
```

## 开发优先级

1. **P0 必须**: `initialize()` — 模块组装
2. **P0 必须**: `runCycle()` — 6 步核心周期
3. **P0 必须**: `healthCheck()` — 健康检查 + STARVATION 模式
4. **P1 重要**: `verifyOnChain()` — Browser Tool 验证
5. **P1 重要**: SKILL.md + Cron 配置
6. **P2 可选**: 多周期状态持久化

## 预计开发时间

| 任务 | 时间 |
|------|------|
| Agent 初始化 + 模块组装 | 2 小时 |
| `runCycle()` 6 步编排 | 4 小时 |
| `healthCheck()` + STARVATION 模式 | 2 小时 |
| Browser Tool 验证 | 3 小时 |
| SKILL.md + Cron 配置 | 1 小时 |
| 程序入口 + 错误处理 | 1 小时 |
| 单元测试 | 2 小时 |
| **总计** | **15 小时** |
