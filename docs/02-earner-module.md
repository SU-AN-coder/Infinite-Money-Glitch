# 模块二：赚取引擎 (Earner)

> **v2 — 基于 00-redesign-proposal.md 重构**
> 核心变更：完全移除 Faucet + execa；改用 BountyBoard Move 合约 + OpenClaw Exec Tool 实现真实链上收入。

## 概述

Earner 是 Agent 的"收入引擎"。它在 Sui 链上的 BountyBoard 合约中发现可用赏金任务，通过 OpenClaw Exec Tool 执行任务，并将输出的 SHA-256 哈希作为工作证明提交到链上领取奖励。

**这不是"假装赚钱"，而是"做任务领奖金"。**

## 核心变更

| 项目 | 旧方案 (v1) | 新方案 (v2) |
|------|-------------|-------------|
| 收入来源 | 🚨 Sui Faucet（开发者工具，非收入） | ✅ BountyBoard 合约（链上赏金） |
| 执行方式 | 🚨 `execa` 裸调子进程 | ✅ OpenClaw Exec Tool RPC |
| 工作证明 | 无 | ✅ SHA-256(task_output) 提交链上 |
| 合约交互 | 无合约 | ✅ 自部署 BountyBoard Move 合约 |
| 任务类型 | 只有 `requestFromFaucet()` | ✅ lint / test / format / audit / custom |

## 技术依赖

```json
{
  "@mysten/sui": "^1.x.x"
}
```

运行环境依赖：
- OpenClaw Gateway (`http://127.0.0.1:18789`)
- BountyBoard Move 合约（已部署到 Sui Testnet）

## BountyBoard 合约概要

详细合约代码见 [00-redesign-proposal.md](00-redesign-proposal.md) § 3.3。核心函数：

```move
module bounty_board::bounty_board {
    // 赏金发布者存入 SUI 到奖池
    public entry fun deposit(board: &mut BountyBoard, coin: Coin<SUI>, ctx: &mut TxContext);

    // 发布赏金任务
    public entry fun post_bounty(
        board: &mut BountyBoard,
        description: vector<u8>,
        reward_amount: u64,
        ctx: &mut TxContext
    );

    // Agent 领取赏金 — 需提交 SHA-256 工作证明
    public entry fun claim_reward(
        board: &mut BountyBoard,
        bounty_id: u64,
        proof_hash: vector<u8>,
        ctx: &mut TxContext
    );
}
```

## 接口设计

### 类型定义

```typescript
// 赏金任务
interface BountyTask {
  // 链上赏金 ID
  bountyId: number;
  // 任务描述
  description: string;
  // 奖励金额（MIST）
  rewardAmount: bigint;
  // 发布者地址
  poster: string;
  // 是否已完成
  completed: boolean;
  // 任务类型推断
  taskType: TaskType;
}

// 任务类型
type TaskType = 'lint' | 'test' | 'format' | 'audit' | 'custom';

// 任务执行结果
interface TaskResult {
  // 执行的赏金任务
  bounty: BountyTask;
  // 任务输出内容
  output: string;
  // 输出的 SHA-256 哈希（工作证明）
  outputHash: string;
  // 执行是否成功
  success: boolean;
  // 执行耗时（ms）
  duration: number;
  // 错误信息
  error?: string;
}

// 赏金领取结果
interface ClaimResult {
  // 赏金 ID
  bountyId: number;
  // 领取金额
  rewardAmount: bigint;
  // 交易摘要
  txDigest: string;
  // 交易 Explorer 链接
  explorerUrl: string;
  // 工作证明哈希
  proofHash: string;
  // 是否成功
  success: boolean;
  // 错误信息
  error?: string;
}

// 一次完整赚取周期的结果
interface EarnResult {
  // 本轮找到的任务数
  tasksFound: number;
  // 本轮完成的任务数
  tasksCompleted: number;
  // 本轮赚取的总金额（MIST）
  totalEarned: bigint;
  // 各任务的领取结果
  claims: ClaimResult[];
  // 时间戳
  timestamp: Date;
}

// OpenClaw Exec 请求
interface ExecRequest {
  command: string;
  host: 'gateway' | 'sandbox' | 'node';
  timeout?: number;
  security?: 'normal' | 'high';
}

// OpenClaw Exec 响应
interface ExecResponse {
  output: string;
  exitCode: number;
  duration: number;
}
```

### 核心方法

```typescript
class Earner {
  /**
   * 初始化 Earner
   * @param wallet WalletManager 实例
   * @param config 赏金板配置（合约地址等）
   */
  constructor(wallet: WalletManager, config: EarnerConfig);

  /**
   * 执行一个完整的赚取周期
   * 1. 查询可用赏金
   * 2. 选择最优任务
   * 3. 通过 OpenClaw Exec Tool 执行任务
   * 4. 计算 SHA-256 哈希
   * 5. 调用合约 claim_reward
   * 6. 返回赚取结果
   */
  async earn(): Promise<EarnResult>;

  /**
   * 查询 BountyBoard 上所有可用（未完成）赏金
   */
  async getAvailableBounties(): Promise<BountyTask[]>;

  /**
   * 选择最优赏金（按奖励金额降序 + 任务类型匹配度）
   */
  selectBestBounty(bounties: BountyTask[]): BountyTask | null;

  /**
   * 通过 OpenClaw Exec Tool 执行任务
   */
  async executeTask(bounty: BountyTask): Promise<TaskResult>;

  /**
   * 调用 BountyBoard 合约 claim_reward
   */
  async claimBountyReward(taskResult: TaskResult): Promise<ClaimResult>;
}
```

## 实现细节

### 1. 查询 BountyBoard 可用赏金

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { createHash } from 'node:crypto';

class Earner {
  private wallet: WalletManager;
  private client: SuiClient;
  private openclawBaseUrl = 'http://127.0.0.1:18789';
  private bountyPackageId: string;
  private bountyBoardId: string;

  constructor(wallet: WalletManager, config: EarnerConfig) {
    this.wallet = wallet;
    this.client = new SuiClient({ url: getFullnodeUrl(config.network) });
    this.bountyPackageId = config.bountyPackageId;
    this.bountyBoardId = config.bountyBoardId;
  }

  async getAvailableBounties(): Promise<BountyTask[]> {
    // 读取 BountyBoard 共享对象
    const boardObj = await this.client.getObject({
      id: this.bountyBoardId,
      options: { showContent: true }
    });

    const fields = (boardObj.data?.content as any)?.fields;
    if (!fields?.bounties) return [];

    // 解析赏金列表，过滤已完成的
    const bounties: BountyTask[] = fields.bounties
      .map((b: any, index: number) => ({
        bountyId: index,
        description: new TextDecoder().decode(
          new Uint8Array(b.fields.description)
        ),
        rewardAmount: BigInt(b.fields.reward_amount),
        poster: b.fields.poster,
        completed: b.fields.completed,
        taskType: this.inferTaskType(
          new TextDecoder().decode(new Uint8Array(b.fields.description))
        )
      }))
      .filter((b: BountyTask) => !b.completed);

    console.log(`📋 Found ${bounties.length} available bounties`);
    return bounties;
  }

  /**
   * 从赏金描述推断任务类型
   */
  private inferTaskType(description: string): TaskType {
    const desc = description.toLowerCase();
    if (desc.includes('lint')) return 'lint';
    if (desc.includes('test')) return 'test';
    if (desc.includes('format')) return 'format';
    if (desc.includes('audit')) return 'audit';
    return 'custom';
  }
}
```

### 2. 通过 OpenClaw Exec Tool 执行任务

```typescript
/**
 * 核心改动：不再使用 execa 直接调用子进程
 * 改为通过 OpenClaw Gateway 的 exec RPC 执行命令
 * - 有安全沙箱保护
 * - 有超时自动终止
 * - 有审计日志
 */
async executeTask(bounty: BountyTask): Promise<TaskResult> {
  const startTime = Date.now();
  const command = this.getCommandForTaskType(bounty.taskType);

  console.log(`⚙️ Executing task #${bounty.bountyId}: ${bounty.description}`);
  console.log(`  Command: ${command}`);

  try {
    // 通过 OpenClaw Exec Tool 执行，而不是直接 execa
    const execResult = await this.execViaOpenClaw({
      command,
      host: 'gateway',   // 在 Gateway 主机上执行
      timeout: 30,        // 30 秒超时
      security: 'normal'
    });

    const output = execResult.output;
    const outputHash = this.sha256(output);

    console.log(`  ✓ Task completed (${Date.now() - startTime}ms)`);
    console.log(`  Output hash: ${outputHash.slice(0, 16)}...`);

    return {
      bounty,
      output,
      outputHash,
      success: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ Task failed: ${errMsg}`);

    return {
      bounty,
      output: '',
      outputHash: '',
      success: false,
      duration: Date.now() - startTime,
      error: errMsg
    };
  }
}

/**
 * 根据任务类型返回对应的命令
 */
private getCommandForTaskType(taskType: TaskType): string {
  const commands: Record<TaskType, string> = {
    lint:   'npx eslint . --fix --format json 2>&1 || true',
    test:   'npx vitest run --reporter=json 2>&1 || true',
    format: 'npx prettier --write "src/**/*.ts" 2>&1 || true',
    audit:  'npm audit --json 2>&1 || true',
    custom: 'echo "custom task placeholder"'
  };
  return commands[taskType];
}

/**
 * 计算 SHA-256 哈希 — 这就是提交到链上的工作证明
 */
private sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 通过 OpenClaw Gateway RPC 执行命令
 * ❌ 不再使用 execa / child_process
 * ✅ 改用 HTTP RPC → OpenClaw Exec Tool
 */
private async execViaOpenClaw(req: ExecRequest): Promise<ExecResponse> {
  const response = await fetch(`${this.openclawBaseUrl}/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
    },
    body: JSON.stringify({
      method: 'exec',
      params: {
        command: req.command,
        host: req.host,
        timeout: req.timeout || 30,
        security: req.security || 'normal'
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenClaw exec failed: ${response.status}`);
  }

  const result = await response.json();
  return {
    output: result.output || '',
    exitCode: result.exitCode ?? 0,
    duration: result.duration ?? 0
  };
}
```

### 3. 链上领取赏金

```typescript
/**
 * 构建并发送 claim_reward 交易
 * - 将 SHA-256 工作证明提交到链上
 * - 合约验证后将 SUI 奖励转入 Agent 地址
 */
async claimBountyReward(taskResult: TaskResult): Promise<ClaimResult> {
  const { bounty, outputHash } = taskResult;

  console.log(`💰 Claiming reward for bounty #${bounty.bountyId}...`);
  console.log(`  Reward: ${Number(bounty.rewardAmount) / 1e9} SUI`);
  console.log(`  Proof: ${outputHash.slice(0, 16)}...`);

  try {
    const tx = new Transaction();

    tx.moveCall({
      target: `${this.bountyPackageId}::bounty_board::claim_reward`,
      arguments: [
        tx.object(this.bountyBoardId),                              // BountyBoard
        tx.pure.u64(bounty.bountyId),                               // bounty_id
        tx.pure.vector('u8', Buffer.from(outputHash, 'hex'))        // proof_hash
      ]
    });

    const result = await this.wallet.signAndExecute(tx);

    if (result.success) {
      console.log(`  ✓ Claimed! TX: ${result.digest}`);
      console.log(`  Explorer: ${result.explorerUrl}`);
    } else {
      console.log(`  ✗ Claim failed: ${result.error}`);
    }

    return {
      bountyId: bounty.bountyId,
      rewardAmount: bounty.rewardAmount,
      txDigest: result.digest,
      explorerUrl: result.explorerUrl,
      proofHash: outputHash,
      success: result.success,
      error: result.error
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      bountyId: bounty.bountyId,
      rewardAmount: bounty.rewardAmount,
      txDigest: '',
      explorerUrl: '',
      proofHash: outputHash,
      success: false,
      error: errMsg
    };
  }
}
```

### 4. 完整赚取周期编排

```typescript
/**
 * 执行一个完整的赚取周期
 * Agent 的 runCycle() 会调用此方法
 */
async earn(): Promise<EarnResult> {
  console.log('\n═══════════════════════════════════════');
  console.log('  💼 Earner: Starting earn cycle');
  console.log('═══════════════════════════════════════\n');

  const startTime = Date.now();
  const claims: ClaimResult[] = [];
  let totalEarned = 0n;

  // Step 1: 查询可用赏金
  const bounties = await this.getAvailableBounties();

  if (bounties.length === 0) {
    console.log('⚠️ No bounties available. Waiting for next cycle.');
    return {
      tasksFound: 0,
      tasksCompleted: 0,
      totalEarned: 0n,
      claims: [],
      timestamp: new Date()
    };
  }

  // Step 2: 选择最优赏金
  const bestBounty = this.selectBestBounty(bounties);
  if (!bestBounty) {
    return {
      tasksFound: bounties.length,
      tasksCompleted: 0,
      totalEarned: 0n,
      claims: [],
      timestamp: new Date()
    };
  }

  // Step 3: 执行任务
  const taskResult = await this.executeTask(bestBounty);

  if (!taskResult.success) {
    console.log('⚠️ Task execution failed');
    return {
      tasksFound: bounties.length,
      tasksCompleted: 0,
      totalEarned: 0n,
      claims: [],
      timestamp: new Date()
    };
  }

  // Step 4: 领取赏金
  const claimResult = await this.claimBountyReward(taskResult);
  claims.push(claimResult);

  if (claimResult.success) {
    totalEarned += claimResult.rewardAmount;
  }

  const result: EarnResult = {
    tasksFound: bounties.length,
    tasksCompleted: claimResult.success ? 1 : 0,
    totalEarned,
    claims,
    timestamp: new Date()
  };

  console.log(`\n📊 Earn cycle summary:`);
  console.log(`  Tasks found: ${result.tasksFound}`);
  console.log(`  Tasks completed: ${result.tasksCompleted}`);
  console.log(`  Total earned: ${Number(totalEarned) / 1e9} SUI`);
  console.log(`  Duration: ${Date.now() - startTime}ms\n`);

  return result;
}

/**
 * 选择最优赏金 — 按奖励金额降序
 */
selectBestBounty(bounties: BountyTask[]): BountyTask | null {
  if (bounties.length === 0) return null;

  // 按奖励金额排序，优先高奖励
  const sorted = [...bounties].sort(
    (a, b) => Number(b.rewardAmount - a.rewardAmount)
  );

  return sorted[0];
}
```

## 完整流程图

```
┌────────────────────────────────────────────────────────────────┐
│                     Earner.earn() 完整流程                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────┐     ┌──────────────────┐                 │
│  │ 1. 查询 BountyBoard  │──→│ 2. 选择最优赏金   │                │
│  │    getAvailableBounties│   selectBestBounty │                │
│  └─────────────────┘     └────────┬─────────┘                 │
│           │                       │                            │
│     Sui RPC 读取            按奖励金额排序                      │
│     BountyBoard 对象                                           │
│                                   │                            │
│                       ┌───────────▼──────────┐                │
│                       │ 3. OpenClaw Exec Tool │                │
│                       │    executeTask()      │                │
│                       └───────────┬──────────┘                │
│                                   │                            │
│                          HTTP RPC → Gateway                   │
│                          command 在沙箱中执行                   │
│                                   │                            │
│                       ┌───────────▼──────────┐                │
│                       │ 4. SHA-256 哈希计算    │                │
│                       │    sha256(output)     │                │
│                       └───────────┬──────────┘                │
│                                   │                            │
│                       ┌───────────▼──────────┐                │
│                       │ 5. claim_reward TX    │                │
│                       │    Move 合约调用      │                │
│                       └───────────┬──────────┘                │
│                                   │                            │
│                          链上验证 + SUI 转入                   │
│                                   │                            │
│                       ┌───────────▼──────────┐                │
│                       │ 6. 返回 EarnResult    │                │
│                       │    含 TX + Explorer   │                │
│                       └──────────────────────┘                │
└────────────────────────────────────────────────────────────────┘
```

## 安全设计

| 方面 | 说明 |
|------|------|
| 命令注入 | OpenClaw Exec Tool 有内置的命令过滤和安全策略 |
| 超时保护 | 每个任务 30 秒超时，防止无限挂起 |
| 工作证明 | SHA-256(output) 提交链上，可事后审计 |
| 合约权限 | 任何地址可领取，但每个赏金只能领取一次 |
| 重入保护 | Move 语言原生防重入 |

## 与旧版的关键差异

```
旧版 Earner（v1）:                    新版 Earner（v2）:
┌──────────────────────┐              ┌──────────────────────┐
│ requestFromFaucet()  │              │ getAvailableBounties()│
│   ↓                  │              │   ↓                  │
│ import { execa }     │              │ executeTask()        │
│ execa('curl', [...]) │              │   → OpenClaw exec RPC│
│   ↓                  │              │   ↓                  │
│ balance += faucetAmt │              │ sha256(output)       │
│                      │              │   ↓                  │
│ ❌ 无合约交互         │              │ claimBountyReward()  │
│ ❌ Faucet ≠ 收入      │              │   → Move TX on-chain │
│ ❌ 无工作证明         │              │   ↓                  │
│                      │              │ ✅ 含 Explorer 链接   │
│                      │              │ ✅ 含工作证明哈希     │
└──────────────────────┘              └──────────────────────┘
```

## 单元测试要点

```typescript
describe('Earner v2', () => {
  it('should query available bounties from BountyBoard', async () => {
    const bounties = await earner.getAvailableBounties();
    expect(Array.isArray(bounties)).toBe(true);
    bounties.forEach(b => {
      expect(b.bountyId).toBeGreaterThanOrEqual(0);
      expect(b.rewardAmount).toBeGreaterThan(0n);
      expect(b.completed).toBe(false);
    });
  });

  it('should execute task via OpenClaw exec tool (not execa)', async () => {
    const result = await earner.executeTask(mockBounty);
    expect(result.output).toBeTruthy();
    expect(result.outputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should claim reward on-chain with proof hash', async () => {
    const claim = await earner.claimBountyReward(mockTaskResult);
    expect(claim.txDigest).toBeTruthy();
    expect(claim.explorerUrl).toContain('suiscan.xyz');
    expect(claim.proofHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should NOT import or use execa', () => {
    // 确保旧版依赖已完全移除
    const sourceCode = readFileSync('src/earner.ts', 'utf-8');
    expect(sourceCode).not.toContain('execa');
    expect(sourceCode).not.toContain('faucet');
    expect(sourceCode).not.toContain('Faucet');
  });

  it('should select highest reward bounty', () => {
    const bounties = [
      { ...mockBounty, rewardAmount: 100n },
      { ...mockBounty, rewardAmount: 500n },
      { ...mockBounty, rewardAmount: 200n }
    ];
    const best = earner.selectBestBounty(bounties);
    expect(best?.rewardAmount).toBe(500n);
  });
});
```

## 与其他模块的关系

```
┌──────────────────────────────────────────────────────────┐
│                    Agent (Cron 触发)                      │
│                         │                                │
│                    ┌────▼────┐                           │
│                    │ Earner  │ ◄── 本模块                │
│                    └────┬────┘                           │
│                         │                                │
│           ┌─────────────┼─────────────┐                  │
│           ▼             ▼             ▼                  │
│     WalletManager   OpenClaw       BountyBoard           │
│     (签名+广播TX)    Exec Tool      Move 合约            │
│                     (执行命令)      (赏金管理)            │
│                                       │                  │
│                                  Sui Testnet             │
└──────────────────────────────────────────────────────────┘
```

## 开发优先级

1. **P0 必须**: `getAvailableBounties()` — 合约读取
2. **P0 必须**: `executeTask()` — OpenClaw Exec Tool 调用
3. **P0 必须**: `claimBountyReward()` — Move TX 构建与发送
4. **P0 必须**: `earn()` — 完整编排流程
5. **P1 重要**: 任务类型推断与命令映射
6. **P2 可选**: 多任务并行执行策略

## 预计开发时间

| 任务 | 时间 |
|------|------|
| BountyBoard 合约部署 | 3 小时 |
| `getAvailableBounties()` 合约读取 | 2 小时 |
| `executeTask()` OpenClaw Exec 集成 | 2 小时 |
| `claimBountyReward()` Move TX | 3 小时 |
| `earn()` 编排 + SHA-256 哈希 | 2 小时 |
| 单元测试 | 2 小时 |
| **总计** | **14 小时** |
