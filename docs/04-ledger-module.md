# 模块四：账本系统 (Ledger)

> **v2 — 基于 00-redesign-proposal.md 重构**
> 核心变更：新增审计包生成、链上证明字段（taskHash / bountyId / blobId / sealPolicyId / explorerUrl），保留 P&L 报表和 CLI 格式化。

## 概述

Ledger 是 Agent 的"财务审计"模块。它记录每一笔收入和支出，生成可审计的审计包（audit package），并提供链上交易的 Explorer 链接，使 Agent 的全部经济活动可追溯、可验证。

## 核心变更

| 项目 | 旧方案 (v1) | 新方案 (v2) |
|------|-------------|-------------|
| 交易记录 | 仅金额 + 方向 | ✅ 含链上证明字段 |
| 审计能力 | 无 | ✅ `generateAuditPackage()` 导出完整审计包 |
| 链上关联 | 无 | ✅ txDigest + Explorer URL |
| 工作证明 | 无 | ✅ taskHash (SHA-256) |
| 存储证明 | 无 | ✅ blobId + sealPolicyId |
| 报表能力 | P&L 报表 | ✅ P&L + 审计报表 |

## 技术依赖

```json
{
  // 无额外依赖，纯 TypeScript 实现
}
```

## 接口设计

### 类型定义

```typescript
// 交易方向
type TransactionDirection = 'income' | 'expense';

// 交易来源
type TransactionSource =
  | 'bounty_reward'     // BountyBoard 赏金奖励
  | 'seal_encryption'   // Seal 加密费用
  | 'walrus_storage'    // Walrus 存储费用
  | 'gas_fee'           // 链上 Gas 费用
  | 'transfer'          // SUI 转账
  | 'other';            // 其他

// 账本条目（v2 新增链上证明字段）
interface LedgerEntry {
  // 唯一 ID
  id: string;
  // 时间戳
  timestamp: Date;
  // 交易方向
  direction: TransactionDirection;
  // 交易来源
  source: TransactionSource;
  // 金额（MIST）
  amount: bigint;
  // 说明
  description: string;

  // ─── v2 新增：链上证明字段 ───
  // 任务输出 SHA-256 哈希（Earner 提交的工作证明）
  taskHash?: string;
  // BountyBoard 赏金 ID
  bountyId?: number;
  // 交易摘要
  txDigest?: string;
  // Walrus blob ID
  blobId?: string;
  // Seal 策略 ID
  sealPolicyId?: string;
  // Sui Explorer 链接
  explorerUrl?: string;

  // ─── 衍生字段 ───
  // 关联的任务类型
  taskType?: string;
  // 交易后余额（快照）
  balanceAfter?: bigint;
}

// P&L 报表
interface ProfitLossReport {
  // 报表期间
  period: {
    from: Date;
    to: Date;
  };
  // 总收入
  totalIncome: bigint;
  // 总支出
  totalExpense: bigint;
  // 净利润
  netProfit: bigint;
  // 净利润率
  profitMargin: number;
  // 交易笔数
  transactionCount: number;
  // 按来源的收入明细
  incomeBySource: Map<TransactionSource, bigint>;
  // 按来源的支出明细
  expenseBySource: Map<TransactionSource, bigint>;
  // Wallet Explorer 链接
  walletExplorerUrl: string;
}

// 审计包（v2 新增）
interface AuditPackage {
  // 生成时间
  generatedAt: Date;
  // Agent 地址
  agentAddress: string;
  // Wallet Explorer 链接
  walletExplorerUrl: string;
  // 所有账本条目
  entries: LedgerEntry[];
  // P&L 报表
  profitLoss: ProfitLossReport;
  // 链上交易汇总
  onChainTransactions: {
    digest: string;
    explorerUrl: string;
    direction: TransactionDirection;
    amount: bigint;
    source: TransactionSource;
  }[];
  // 加密存储汇总
  encryptedStorage: {
    blobId: string;
    sealPolicyId: string;
    label: string;
    size: number;
  }[];
  // 工作证明汇总
  workProofs: {
    taskHash: string;
    bountyId: number;
    txDigest: string;
  }[];
  // 校验和（整个审计包的 SHA-256）
  checksum: string;
}
```

### 核心方法

```typescript
class Ledger {
  /**
   * 初始化 Ledger
   */
  constructor(config?: LedgerConfig);

  /**
   * 记录一笔交易（v2 增强版，含链上证明字段）
   */
  record(entry: Omit<LedgerEntry, 'id' | 'timestamp'>): LedgerEntry;

  /**
   * 记录 Earner 收入（便捷方法）
   */
  recordEarning(claimResult: ClaimResult): LedgerEntry;

  /**
   * 记录 Spender 支出（便捷方法）
   */
  recordSpending(protectionResult: ProtectionResult): LedgerEntry;

  /**
   * 获取所有条目
   */
  getEntries(filter?: LedgerFilter): LedgerEntry[];

  /**
   * 生成 P&L 报表
   */
  generatePnL(from?: Date, to?: Date): ProfitLossReport;

  /**
   * 生成审计包（v2 新增）
   */
  generateAuditPackage(agentAddress: string): AuditPackage;

  /**
   * CLI 格式化输出
   */
  printSummary(): void;

  /**
   * 导出为 JSON
   */
  exportToJson(): string;
}
```

## 实现细节

### 1. 核心记录逻辑

```typescript
import { createHash, randomUUID } from 'node:crypto';

class Ledger {
  private entries: LedgerEntry[] = [];
  private walletExplorerUrl: string = '';

  constructor(config?: LedgerConfig) {
    if (config?.walletExplorerUrl) {
      this.walletExplorerUrl = config.walletExplorerUrl;
    }
  }

  /**
   * 通用记录方法 — 支持所有 v2 证明字段
   */
  record(entry: Omit<LedgerEntry, 'id' | 'timestamp'>): LedgerEntry {
    const fullEntry: LedgerEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      ...entry
    };

    this.entries.push(fullEntry);

    const icon = entry.direction === 'income' ? '💰' : '💸';
    const sign = entry.direction === 'income' ? '+' : '-';
    const amount = Number(entry.amount) / 1e9;

    console.log(
      `${icon} [Ledger] ${sign}${amount.toFixed(4)} SUI | ${entry.source} | ${entry.description}`
    );

    // 如果有 Explorer 链接，一并输出
    if (fullEntry.explorerUrl) {
      console.log(`  ↳ Explorer: ${fullEntry.explorerUrl}`);
    }

    return fullEntry;
  }
}
```

### 2. 便捷记录方法

```typescript
/**
 * 记录 Earner 的赏金收入
 * 自动填充 taskHash、bountyId、txDigest、explorerUrl
 */
recordEarning(claimResult: ClaimResult): LedgerEntry {
  return this.record({
    direction: 'income',
    source: 'bounty_reward',
    amount: claimResult.rewardAmount,
    description: `Bounty #${claimResult.bountyId} reward claimed`,
    taskHash: claimResult.proofHash,              // SHA-256 工作证明
    bountyId: claimResult.bountyId,               // BountyBoard ID
    txDigest: claimResult.txDigest,                // 链上交易摘要
    explorerUrl: claimResult.explorerUrl           // Sui Explorer 链接
  });
}

/**
 * 记录 Spender 的保护支出
 * 自动填充 blobId、sealPolicyId
 */
recordSpending(protectionResult: ProtectionResult): LedgerEntry {
  return this.record({
    direction: 'expense',
    source: 'seal_encryption',
    amount: protectionResult.gasSpent,
    description: `Protected "${protectionResult.label}"`,
    blobId: protectionResult.upload?.blobId,                  // Walrus blobId
    sealPolicyId: protectionResult.encryption?.sealPolicyId,  // Seal 策略
    explorerUrl: protectionResult.upload?.explorerUrl          // 上传 TX Explorer
  });
}
```

### 3. P&L 报表生成

```typescript
/**
 * 生成 P&L（Profit & Loss）报表
 */
generatePnL(from?: Date, to?: Date): ProfitLossReport {
  const filtered = this.getEntries({ from, to });

  let totalIncome = 0n;
  let totalExpense = 0n;
  const incomeBySource = new Map<TransactionSource, bigint>();
  const expenseBySource = new Map<TransactionSource, bigint>();

  for (const entry of filtered) {
    if (entry.direction === 'income') {
      totalIncome += entry.amount;
      incomeBySource.set(
        entry.source,
        (incomeBySource.get(entry.source) || 0n) + entry.amount
      );
    } else {
      totalExpense += entry.amount;
      expenseBySource.set(
        entry.source,
        (expenseBySource.get(entry.source) || 0n) + entry.amount
      );
    }
  }

  const netProfit = totalIncome - totalExpense;
  const profitMargin = totalIncome > 0n
    ? Number(netProfit) / Number(totalIncome)
    : 0;

  return {
    period: {
      from: from || filtered[0]?.timestamp || new Date(),
      to: to || filtered[filtered.length - 1]?.timestamp || new Date()
    },
    totalIncome,
    totalExpense,
    netProfit,
    profitMargin,
    transactionCount: filtered.length,
    incomeBySource,
    expenseBySource,
    walletExplorerUrl: this.walletExplorerUrl
  };
}

/**
 * 获取条目（可选过滤）
 */
getEntries(filter?: LedgerFilter): LedgerEntry[] {
  if (!filter) return [...this.entries];

  return this.entries.filter(entry => {
    if (filter.from && entry.timestamp < filter.from) return false;
    if (filter.to && entry.timestamp > filter.to) return false;
    if (filter.direction && entry.direction !== filter.direction) return false;
    if (filter.source && entry.source !== filter.source) return false;
    return true;
  });
}
```

### 4. 审计包生成（v2 新增核心功能）

```typescript
/**
 * 生成完整的审计包
 * 包含所有交易记录、链上证明、加密存储记录和工作证明
 * 整个审计包会计算 SHA-256 校验和
 */
generateAuditPackage(agentAddress: string): AuditPackage {
  console.log('\n📦 Generating audit package...');

  const entries = this.getEntries();
  const profitLoss = this.generatePnL();

  // 链上交易汇总
  const onChainTransactions = entries
    .filter(e => e.txDigest)
    .map(e => ({
      digest: e.txDigest!,
      explorerUrl: e.explorerUrl || '',
      direction: e.direction,
      amount: e.amount,
      source: e.source
    }));

  // 加密存储汇总
  const encryptedStorage = entries
    .filter(e => e.blobId)
    .map(e => ({
      blobId: e.blobId!,
      sealPolicyId: e.sealPolicyId || '',
      label: e.description,
      size: 0  // 需从 Spender 结果中获取
    }));

  // 工作证明汇总
  const workProofs = entries
    .filter(e => e.taskHash && e.bountyId !== undefined)
    .map(e => ({
      taskHash: e.taskHash!,
      bountyId: e.bountyId!,
      txDigest: e.txDigest || ''
    }));

  // 构建审计包（不含 checksum）
  const packageData = {
    generatedAt: new Date(),
    agentAddress,
    walletExplorerUrl: this.walletExplorerUrl,
    entries,
    profitLoss,
    onChainTransactions,
    encryptedStorage,
    workProofs
  };

  // 计算校验和
  const checksum = createHash('sha256')
    .update(JSON.stringify(packageData, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ))
    .digest('hex');

  const auditPackage: AuditPackage = {
    ...packageData,
    checksum
  };

  console.log(`  ✓ Audit package generated`);
  console.log(`  Entries: ${entries.length}`);
  console.log(`  On-chain TXs: ${onChainTransactions.length}`);
  console.log(`  Encrypted blobs: ${encryptedStorage.length}`);
  console.log(`  Work proofs: ${workProofs.length}`);
  console.log(`  Checksum: ${checksum.slice(0, 16)}...`);

  return auditPackage;
}
```

### 5. CLI 格式化输出

```typescript
/**
 * CLI 摘要输出 — 适合 demo 演示
 */
printSummary(): void {
  const pnl = this.generatePnL();
  const entries = this.getEntries();

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║           💰 Agent Financial Report 💰           ║');
  console.log('╠══════════════════════════════════════════════════╣');

  // 交易明细
  console.log('║ Recent Transactions:                             ║');
  const recent = entries.slice(-5);
  for (const entry of recent) {
    const icon = entry.direction === 'income' ? '📈' : '📉';
    const sign = entry.direction === 'income' ? '+' : '-';
    const amount = (Number(entry.amount) / 1e9).toFixed(4);
    const source = entry.source.padEnd(16);
    console.log(`║  ${icon} ${sign}${amount} SUI  ${source}  ${entry.description.slice(0, 20)}║`);
    if (entry.explorerUrl) {
      console.log(`║     ↳ ${entry.explorerUrl.slice(0, 44)}║`);
    }
  }

  // P&L 汇总
  console.log('╠══════════════════════════════════════════════════╣');
  const income = (Number(pnl.totalIncome) / 1e9).toFixed(4);
  const expense = (Number(pnl.totalExpense) / 1e9).toFixed(4);
  const net = (Number(pnl.netProfit) / 1e9).toFixed(4);
  const margin = (pnl.profitMargin * 100).toFixed(1);
  const status = pnl.netProfit > 0n ? '🟢 PROFITABLE' : '🔴 LOSS';

  console.log(`║  Total Income:  +${income} SUI                  ║`);
  console.log(`║  Total Expense: -${expense} SUI                  ║`);
  console.log(`║  Net Profit:    ${net} SUI                       ║`);
  console.log(`║  Margin:        ${margin}%                       ║`);
  console.log(`║  Status:        ${status}                        ║`);
  console.log(`║  Transactions:  ${pnl.transactionCount}          ║`);

  // Explorer 链接
  if (pnl.walletExplorerUrl) {
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  🔗 Wallet: ${pnl.walletExplorerUrl}            ║`);
  }

  console.log('╚══════════════════════════════════════════════════╝\n');
}

/**
 * 导出为 JSON（支持 bigint 序列化）
 */
exportToJson(): string {
  return JSON.stringify(
    this.entries,
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2
  );
}
```

## 数据结构示例

### 一条完整的 v2 LedgerEntry

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-02-28T14:30:00.000Z",
  "direction": "income",
  "source": "bounty_reward",
  "amount": "500000000",
  "description": "Bounty #3 reward claimed",
  "taskHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "bountyId": 3,
  "txDigest": "HZzz...abc",
  "blobId": null,
  "sealPolicyId": null,
  "explorerUrl": "https://suiscan.xyz/testnet/tx/HZzz...abc"
}
```

### 审计包 JSON 片段

```json
{
  "generatedAt": "2026-02-28T15:00:00.000Z",
  "agentAddress": "0x1234...abcd",
  "walletExplorerUrl": "https://suiscan.xyz/testnet/account/0x1234...abcd",
  "entries": [ "..." ],
  "profitLoss": {
    "totalIncome": "1500000000",
    "totalExpense": "200000000",
    "netProfit": "1300000000",
    "profitMargin": 0.8667
  },
  "onChainTransactions": [
    {
      "digest": "HZzz...abc",
      "explorerUrl": "https://suiscan.xyz/testnet/tx/HZzz...abc",
      "direction": "income",
      "amount": "500000000",
      "source": "bounty_reward"
    }
  ],
  "workProofs": [
    {
      "taskHash": "e3b0c44298fc...",
      "bountyId": 3,
      "txDigest": "HZzz...abc"
    }
  ],
  "checksum": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
}
```

## 单元测试要点

```typescript
describe('Ledger v2', () => {
  it('should record entry with proof fields', () => {
    const entry = ledger.record({
      direction: 'income',
      source: 'bounty_reward',
      amount: 500_000_000n,
      description: 'test bounty',
      taskHash: 'abc123...',
      bountyId: 1,
      txDigest: 'TX123...',
      explorerUrl: 'https://suiscan.xyz/testnet/tx/TX123...'
    });
    expect(entry.taskHash).toBe('abc123...');
    expect(entry.bountyId).toBe(1);
    expect(entry.explorerUrl).toContain('suiscan.xyz');
  });

  it('should generate P&L with correct calculations', () => {
    ledger.record({ direction: 'income', source: 'bounty_reward', amount: 1000n, description: 'a' });
    ledger.record({ direction: 'expense', source: 'gas_fee', amount: 200n, description: 'b' });
    const pnl = ledger.generatePnL();
    expect(pnl.netProfit).toBe(800n);
    expect(pnl.profitMargin).toBeCloseTo(0.8);
  });

  it('should generate audit package with checksum', () => {
    const pkg = ledger.generateAuditPackage('0xtest');
    expect(pkg.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(pkg.agentAddress).toBe('0xtest');
    expect(pkg.entries.length).toBeGreaterThan(0);
  });

  it('should include Explorer links in audit package', () => {
    const pkg = ledger.generateAuditPackage('0xtest');
    for (const tx of pkg.onChainTransactions) {
      expect(tx.explorerUrl).toContain('suiscan.xyz');
    }
  });

  it('recordEarning should auto-fill proof fields from ClaimResult', () => {
    const entry = ledger.recordEarning({
      bountyId: 5,
      rewardAmount: 1_000_000_000n,
      txDigest: 'TX_EARN_1',
      explorerUrl: 'https://suiscan.xyz/testnet/tx/TX_EARN_1',
      proofHash: 'sha256hash...',
      success: true
    });
    expect(entry.taskHash).toBe('sha256hash...');
    expect(entry.bountyId).toBe(5);
    expect(entry.txDigest).toBe('TX_EARN_1');
  });
});
```

## 与其他模块的关系

```
┌──────────────────────────────────────────────────────────┐
│                  Agent (runCycle)                         │
│                       │                                  │
│           ┌───────────┼───────────┐                      │
│           ▼           ▼           ▼                      │
│       Earner      Spender     ┌──────┐                  │
│           │           │       │Ledger│ ◄─ 本模块        │
│           │           │       └──┬───┘                  │
│           │           │          │                       │
│           └─── recordEarning ────┘                       │
│           └─── recordSpending ───┘                       │
│                                  │                       │
│                        generateAuditPackage              │
│                                  │                       │
│                           ┌──────▼──────┐               │
│                           │  审计报表    │               │
│                           │  P&L + TXs  │               │
│                           │  + Explorer │               │
│                           └─────────────┘               │
└──────────────────────────────────────────────────────────┘
```

## 开发优先级

1. **P0 必须**: `record()` — 含 v2 证明字段
2. **P0 必须**: `recordEarning()` / `recordSpending()` — 便捷方法
3. **P0 必须**: `generatePnL()` — P&L 报表
4. **P1 重要**: `generateAuditPackage()` — 审计包 + 校验和
5. **P1 重要**: `printSummary()` — CLI 格式化
6. **P2 可选**: 持久化（写入文件 / 上传 Walrus）

## 预计开发时间

| 任务 | 时间 |
|------|------|
| 类型定义 + 核心 `record()` | 1 小时 |
| 便捷记录方法 | 1 小时 |
| P&L 报表 | 2 小时 |
| 审计包生成 + 校验和 | 3 小时 |
| CLI 格式化 | 1 小时 |
| 单元测试 | 2 小时 |
| **总计** | **10 小时** |
