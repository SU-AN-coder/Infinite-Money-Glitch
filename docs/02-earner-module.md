# 模块二：收入模块 (Earner)

## 概述

Earner 是 Agent 的"赚钱引擎"，负责执行各种收入策略。在 MVP 阶段，采用“真实本地工作 -> 链上奖励结算”的叙事：先执行可验证的系统任务（文件扫描/系统体检/git状态），再通过 Testnet Faucet 完成奖励结算。

## 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                        Earner                               │
├─────────────────────────────────────────────────────────────┤
│  收入策略                                                    │
│  ├─ Work-to-Reward（MVP核心）                               │
│  ├─ 空投领取（可选扩展）                                     │
│  ├─ 任务奖励（可选扩展）                                     │
│  └─ 套利策略（高级扩展）                                     │
├─────────────────────────────────────────────────────────────┤
│  收入记录                                                    │
│  ├─ 记录每笔收入的来源、金额、时间、交易ID                    │
│  └─ 通知 Ledger 模块更新账本                                 │
└─────────────────────────────────────────────────────────────┘
```

## 技术依赖

```json
{
  "@mysten/sui": "^1.x.x",
  "axios": "^1.x.x",
  "execa": "^9.x.x"
}
```

## 接口设计

### 类型定义

```typescript
// 收入记录
interface IncomeRecord {
  // 唯一标识
  id: string;
  // 收入类型
  type: 'faucet' | 'airdrop' | 'task_reward' | 'arbitrage';
  // 金额（MIST）
  amount: bigint;
  // 金额（格式化）
  amountFormatted: string;
  // 交易摘要（如果有）
  txDigest?: string;
  // 时间戳
  timestamp: Date;
  // 来源描述
  source: string;
  // 状态
  status: 'pending' | 'confirmed' | 'failed';
}

// 收入策略配置
interface EarnerConfig {
  // 钱包管理器实例
  walletManager: WalletManager;
  // Faucet 请求间隔（毫秒）
  faucetCooldown: number;
  // 最大重试次数
  maxRetries: number;
}

// Faucet 响应
interface FaucetResponse {
  success: boolean;
  txDigest?: string;
  amount?: bigint;
  error?: string;
}

// 本地工作证明
interface WorkProof {
  // 任务类型
  taskType: 'tmp_scan' | 'system_check' | 'git_status';
  // 人类可读任务名
  taskName: string;
  // 关键输出摘要（用于日志和上链描述）
  summary: string;
  // 原始命令输出（可选保存到本地）
  rawOutput: string;
  // 执行耗时
  durationMs: number;
  // 是否成功
  success: boolean;
}
```

### 核心方法

```typescript
class Earner {
  /**
   * 初始化收入模块
   */
  async initialize(config: EarnerConfig): Promise<void>;

  /**
   * 执行一轮赚钱操作
   * @returns 本轮所有收入记录
   */
  async earn(): Promise<IncomeRecord[]>;

  /**
    * 执行真实本地工作（用于证明 Agent 在“打工”）
    */
    async simulateWork(): Promise<WorkProof>;

    /**
   * 从 Faucet 领取测试代币（MVP核心）
   * @returns 收入记录
   */
  async requestFaucet(): Promise<IncomeRecord>;

  /**
   * 获取所有收入记录
   */
  getIncomeHistory(): IncomeRecord[];

  /**
   * 获取总收入
   */
  getTotalIncome(): bigint;

  /**
   * 注册收入回调（通知 Ledger）
   */
  onIncome(callback: (record: IncomeRecord) => void): void;
}
```

## 实现细节

### 1. Real Local Work + Faucet 结算

```typescript
import axios from 'axios';
import { execa } from 'execa';
import os from 'node:os';
import path from 'node:path';

class Earner {
  private walletManager: WalletManager;
  private incomeHistory: IncomeRecord[] = [];
  private callbacks: ((record: IncomeRecord) => void)[] = [];
  private lastFaucetTime: number = 0;
  private config: EarnerConfig;

  async initialize(config: EarnerConfig): Promise<void> {
    this.walletManager = config.walletManager;
    this.config = config;
    console.log('✓ Earner module initialized');
  }

  async requestFaucet(): Promise<IncomeRecord> {
    const address = this.walletManager.getAddress();
    
    // 检查冷却时间
    const now = Date.now();
    if (now - this.lastFaucetTime < this.config.faucetCooldown) {
      const waitTime = this.config.faucetCooldown - (now - this.lastFaucetTime);
      throw new Error(`Faucet cooldown: wait ${waitTime}ms`);
    }

    // 记录请求前余额
    const balanceBefore = (await this.walletManager.getBalance()).sui;

    // 先执行真实本地工作，再进行链上奖励结算
    const workProof = await this.simulateWork();
    if (!workProof.success) {
      throw new Error(`Local work failed: ${workProof.taskName}`);
    }

    console.log(`📥 Settling task reward via Faucet for ${address}...`);

    try {
      // Sui Testnet Faucet API
      const response = await axios.post(
        'https://faucet.testnet.sui.io/v1/gas',
        {
          FixedAmountRequest: {
            recipient: address
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      this.lastFaucetTime = Date.now();

      // 等待交易确认
      await this.waitForBalanceChange(balanceBefore);

      // 计算实际收入
      const balanceAfter = (await this.walletManager.getBalance()).sui;
      const amount = balanceAfter - balanceBefore;

      const record: IncomeRecord = {
        id: this.generateId(),
        type: 'task_reward',
        amount,
        amountFormatted: this.formatSui(amount),
        txDigest: response.data?.transferredGasObjects?.[0]?.digest,
        timestamp: new Date(),
        source: `Task Reward: ${workProof.taskName} | ${workProof.summary} (settled via Sui Faucet)`,
        status: 'confirmed'
      };

      this.incomeHistory.push(record);
      this.notifyCallbacks(record);

      console.log(`✓ Task reward received: ${record.amountFormatted}`);
      return record;

    } catch (error) {
      const record: IncomeRecord = {
        id: this.generateId(),
        type: 'task_reward',
        amount: 0n,
        amountFormatted: '0 SUI',
        timestamp: new Date(),
        source: 'Task Reward Settlement (FAILED)',
        status: 'failed'
      };

      console.error(`✗ Faucet request failed: ${error}`);
      return record;
    }
  }

  async simulateWork(): Promise<WorkProof> {
    const taskTypePool: WorkProof['taskType'][] = ['tmp_scan', 'system_check', 'git_status'];
    const taskType = taskTypePool[Math.floor(Math.random() * taskTypePool.length)];
    const startedAt = Date.now();

    try {
      if (taskType === 'tmp_scan') {
        console.log('🛠️  Working: Scanning temp directory for reclaimable space');
        const tmpDir = os.tmpdir();
        const command = process.platform === 'win32'
          ? `Get-ChildItem -Recurse -File \"${tmpDir}\" -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select-Object -ExpandProperty Sum`
          : `find \"${tmpDir}\" -type f -print0 | du --files0-from=- -cb 2>/dev/null | tail -1 | awk '{print $1}'`;

        const { stdout } = await execa(process.platform === 'win32' ? 'powershell' : 'bash', process.platform === 'win32'
          ? ['-NoProfile', '-Command', command]
          : ['-lc', command]);

        const bytes = Number((stdout || '0').trim() || '0');
        const mb = (bytes / 1024 / 1024).toFixed(2);
        return {
          taskType,
          taskName: 'Temp Cleanup Audit',
          summary: `Scanned ${tmpDir}, reclaimable ≈ ${mb} MB`,
          rawOutput: stdout,
          durationMs: Date.now() - startedAt,
          success: true
        };
      }

      if (taskType === 'system_check') {
        console.log('🛠️  Working: Running system health check');
        const command = process.platform === 'win32'
          ? 'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize,LoadPercentage | Format-List'
          : 'uptime; df -h /';

        const { stdout } = await execa(process.platform === 'win32' ? 'powershell' : 'bash', process.platform === 'win32'
          ? ['-NoProfile', '-Command', command]
          : ['-lc', command]);

        return {
          taskType,
          taskName: 'System Health Check',
          summary: 'Collected CPU/Memory/Disk snapshot',
          rawOutput: stdout,
          durationMs: Date.now() - startedAt,
          success: true
        };
      }

      console.log('🛠️  Working: Checking git repository status');
      const cwd = process.cwd();
      const { stdout } = await execa('git', ['status', '--short'], { cwd });
      const changed = stdout.trim() ? stdout.trim().split('\n').length : 0;

      return {
        taskType,
        taskName: 'Git Integrity Check',
        summary: `Scanned repo ${path.basename(cwd)}, changed files: ${changed}`,
        rawOutput: stdout,
        durationMs: Date.now() - startedAt,
        success: true
      };
    } catch (error) {
      return {
        taskType,
        taskName: 'Local Work Failed',
        summary: error instanceof Error ? error.message : 'Unknown local task error',
        rawOutput: '',
        durationMs: Date.now() - startedAt,
        success: false
      };
    }
  }

  private async waitForBalanceChange(
    previousBalance: bigint, 
    maxWait: number = 30000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const currentBalance = (await this.walletManager.getBalance()).sui;
      if (currentBalance > previousBalance) {
        return;
      }
      await this.sleep(1000);
    }
    
    throw new Error('Timeout waiting for balance change');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 2. 备选收入策略（扩展）

```typescript
// 模拟任务奖励（用于演示）
async simulateTaskReward(taskName: string): Promise<IncomeRecord> {
  // 这是一个模拟方法，用于演示 Agent 完成任务获得报酬
  // 实际实现可以对接真实的任务平台
  
  console.log(`📋 Completing task: ${taskName}...`);
  
  // 模拟任务执行时间
  await this.sleep(2000);
  
  // 模拟奖励（实际中会从链上获取）
  const simulatedReward = 100_000_000n; // 0.1 SUI
  
  const record: IncomeRecord = {
    id: this.generateId(),
    type: 'task_reward',
    amount: simulatedReward,
    amountFormatted: this.formatSui(simulatedReward),
    timestamp: new Date(),
    source: `Task: ${taskName}`,
    status: 'confirmed'
  };

  this.incomeHistory.push(record);
  this.notifyCallbacks(record);

  console.log(`✓ Task completed, earned: ${record.amountFormatted}`);
  return record;
}
```

### 3. 收入统计

```typescript
getIncomeHistory(): IncomeRecord[] {
  return [...this.incomeHistory];
}

getTotalIncome(): bigint {
  return this.incomeHistory
    .filter(r => r.status === 'confirmed')
    .reduce((sum, r) => sum + r.amount, 0n);
}

getTotalIncomeFormatted(): string {
  return this.formatSui(this.getTotalIncome());
}

onIncome(callback: (record: IncomeRecord) => void): void {
  this.callbacks.push(callback);
}

private notifyCallbacks(record: IncomeRecord): void {
  this.callbacks.forEach(cb => cb(record));
}

private generateId(): string {
  return `income_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

private formatSui(mist: bigint): string {
  const sui = Number(mist) / 1_000_000_000;
  return sui.toFixed(4) + ' SUI';
}
```

## Faucet 限制与应对

| Faucet 限制 | 应对策略 |
|-------------|----------|
| 每地址每天限额 | 演示前预先领取足够代币 |
| 请求频率限制 | 设置 cooldown，避免被封 |
| 网络不稳定 | 重试机制 + 超时处理 |
| 可能临时下线 | 准备备用 Faucet 或预充值，保留 simulateTaskReward 兜底 |

## 演示注意事项

```
⚠️ 重要：演示前准备

1. 提前24小时从 Faucet 领取足够代币，避免实时领取失败
2. 准备一个有余额的备用钱包
3. 测试 simulateWork() 是否真的执行了本地命令（tmp/system/git 至少命中其一）
4. 如果 Faucet 不可用，使用 simulateTaskReward() 模拟“任务奖励结算”
```

## 与其他模块的关系

```
┌─────────────────┐
│  WalletManager  │
└────────┬────────┘
         │ 提供地址和余额查询
         ▼
┌─────────────────┐         ┌─────────────┐
│     Earner      │────────▶│   Ledger    │
└─────────────────┘ 收入通知 └─────────────┘
```

## 单元测试要点

```typescript
describe('Earner', () => {
  it('should request faucet successfully', async () => {
    const earner = new Earner();
    await earner.initialize({ walletManager, faucetCooldown: 0, maxRetries: 3 });
    
    const record = await earner.requestFaucet();
    expect(record.status).toBe('confirmed');
    expect(record.amount).toBeGreaterThan(0n);
    expect(record.type).toBe('task_reward');
  });

  it('should simulate work before settlement', async () => {
    const earner = new Earner();
    await earner.initialize({ walletManager, faucetCooldown: 0, maxRetries: 3 });

    const workProof = await earner.simulateWork();
    expect(workProof.taskName.length).toBeGreaterThan(0);
    expect(workProof.durationMs).toBeGreaterThan(0);
    expect(typeof workProof.success).toBe('boolean');
  });

  it('should track total income', async () => {
    const earner = new Earner();
    // ... 模拟多笔收入
    
    const total = earner.getTotalIncome();
    expect(total).toBeGreaterThan(0n);
  });

  it('should respect faucet cooldown', async () => {
    const earner = new Earner();
    await earner.initialize({ walletManager, faucetCooldown: 60000, maxRetries: 3 });
    
    await earner.requestFaucet();
    await expect(earner.requestFaucet()).rejects.toThrow(/cooldown/);
  });
});
```

## 开发优先级

1. **P0 必须**: `simulateWork()` - 执行真实本地工作（不是纯日志）
2. **P0 必须**: `requestFaucet()` - 奖励结算通道
3. **P0 必须**: `getTotalIncome()` - 统计展示
4. **P1 重要**: `onIncome()` - 与 Ledger 联动
5. **P2 可选**: `simulateTaskReward()` - 演示备用

## 预计开发时间

| 任务 | 时间 |
|------|------|
| Faucet 请求实现 | 3小时 |
| 本地工作执行（tmp/system/git） | 3小时 |
| 余额变化检测 | 1小时 |
| 收入统计 | 1小时 |
| 回调机制 | 1小时 |
| 单元测试 | 2小时 |
| **总计** | **11小时** |
