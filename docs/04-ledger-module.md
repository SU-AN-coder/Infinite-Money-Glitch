# 模块四：账本模块 (Ledger)

## 概述

Ledger 是 Agent 的"财务总管"，负责统一管理所有收支记录，计算损益，生成财务报表。它是连接 Earner 和 Spender 的核心数据层。

## 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                         Ledger                              │
├─────────────────────────────────────────────────────────────┤
│  数据汇总                                                    │
│  ├─ 接收 Earner 的收入记录                                   │
│  ├─ 接收 Spender 的支出记录                                  │
│  └─ 维护完整的交易历史                                       │
├─────────────────────────────────────────────────────────────┤
│  损益计算                                                    │
│  ├─ 实时计算总收入                                           │
│  ├─ 实时计算总支出                                           │
│  └─ 计算净利润 = 收入 - 支出                                 │
├─────────────────────────────────────────────────────────────┤
│  报表生成                                                    │
│  ├─ 生成损益表 (P&L Statement)                               │
│  ├─ 生成交易明细表                                           │
│  └─ 生成 Demo 展示用的格式化报表                             │
└─────────────────────────────────────────────────────────────┘
```

## 接口设计

### 类型定义

```typescript
// 账本条目（统一格式）
interface LedgerEntry {
  // 唯一标识
  id: string;
  // 条目类型
  type: 'income' | 'expense';
  // 金额（MIST，正数）
  amount: bigint;
  // 金额（格式化）
  amountFormatted: string;
  // 交易摘要
  txDigest?: string;
  // 时间戳
  timestamp: Date;
  // 描述
  description: string;
  // 分类标签
  category: string;
}

// 损益报表
interface ProfitLossReport {
  // 报表生成时间
  generatedAt: Date;
  // 报表周期
  period: {
    start: Date;
    end: Date;
  };
  // 收入汇总
  income: {
    total: bigint;
    totalFormatted: string;
    byCategory: Record<string, bigint>;
    count: number;
  };
  // 支出汇总
  expense: {
    total: bigint;
    totalFormatted: string;
    byCategory: Record<string, bigint>;
    count: number;
  };
  // 净利润
  netProfit: {
    amount: bigint;
    amountFormatted: string;
    isPositive: boolean;
  };
  // 钱包余额
  currentBalance: {
    amount: bigint;
    amountFormatted: string;
  };
  // 经营指标
  unitEconomics: {
    cycles: number;
    avgIncomePerCycle: string;
    avgExpensePerCycle: string;
    roiPercent: string;
    burnRatePerCycle: string;
    runwayCycles: string;
  };
}

// 账本配置
interface LedgerConfig {
  // 钱包管理器（用于查询当前余额）
  walletManager: WalletManager;
  // 自动保存间隔（毫秒，0 表示不自动保存）
  autoSaveInterval: number;
}
```

### 核心方法

```typescript
class Ledger {
  /**
   * 初始化账本
   */
  async initialize(config: LedgerConfig): Promise<void>;

  /**
   * 记录收入
   */
  recordIncome(record: IncomeRecord): void;

  /**
   * 记录支出
   */
  recordExpense(record: ExpenseRecord): void;

  /**
   * 获取所有账本条目
   */
  getEntries(): LedgerEntry[];

  /**
   * 获取总收入
   */
  getTotalIncome(): bigint;

  /**
   * 获取总支出
   */
  getTotalExpense(): bigint;

  /**
   * 获取净利润
   */
  getNetProfit(): bigint;

  /**
   * 生成损益报表
   */
  async generateReport(): Promise<ProfitLossReport>;

  /**
   * 生成 CLI 展示用的格式化报表
   */
  formatReportForCLI(report: ProfitLossReport): string;

  /**
   * 导出为 JSON
   */
  exportToJson(): string;

  /**
   * 清空账本（重置）
   */
  clear(): void;
}
```

## 实现细节

### 1. 收支记录

```typescript
class Ledger {
  private entries: LedgerEntry[] = [];
  private config: LedgerConfig;
  private walletManager: WalletManager;

  async initialize(config: LedgerConfig): Promise<void> {
    this.config = config;
    this.walletManager = config.walletManager;
    console.log('✓ Ledger initialized');
  }

  recordIncome(record: IncomeRecord): void {
    if (record.status !== 'confirmed') {
      return; // 只记录已确认的交易
    }

    const entry: LedgerEntry = {
      id: record.id,
      type: 'income',
      amount: record.amount,
      amountFormatted: record.amountFormatted,
      txDigest: record.txDigest,
      timestamp: record.timestamp,
      description: record.source,
      category: record.type // faucet, airdrop, task_reward, etc.
    };

    this.entries.push(entry);
    this.logEntry(entry);
  }

  recordExpense(record: ExpenseRecord): void {
    if (record.status !== 'confirmed') {
      return;
    }

    const entry: LedgerEntry = {
      id: record.id,
      type: 'expense',
      amount: record.amount,
      amountFormatted: record.amountFormatted,
      txDigest: record.txDigest,
      timestamp: record.timestamp,
      description: record.purpose,
      category: record.type // storage, gas, api, etc.
    };

    this.entries.push(entry);
    this.logEntry(entry);
  }

  private logEntry(entry: LedgerEntry): void {
    const symbol = entry.type === 'income' ? '📥' : '📤';
    const sign = entry.type === 'income' ? '+' : '-';
    console.log(`${symbol} [Ledger] ${sign}${entry.amountFormatted} | ${entry.description}`);
  }
}
```

### 2. 损益计算

```typescript
getTotalIncome(): bigint {
  return this.entries
    .filter(e => e.type === 'income')
    .reduce((sum, e) => sum + e.amount, 0n);
}

getTotalExpense(): bigint {
  return this.entries
    .filter(e => e.type === 'expense')
    .reduce((sum, e) => sum + e.amount, 0n);
}

getNetProfit(): bigint {
  return this.getTotalIncome() - this.getTotalExpense();
}

isProfit(): boolean {
  return this.getNetProfit() > 0n;
}

getIncomeByCategory(): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  
  this.entries
    .filter(e => e.type === 'income')
    .forEach(e => {
      result[e.category] = (result[e.category] || 0n) + e.amount;
    });
  
  return result;
}

getExpenseByCategory(): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  
  this.entries
    .filter(e => e.type === 'expense')
    .forEach(e => {
      result[e.category] = (result[e.category] || 0n) + e.amount;
    });
  
  return result;
}
```

### 3. 报表生成

```typescript
async generateReport(): Promise<ProfitLossReport> {
  const currentBalance = await this.walletManager.getBalance();
  
  const incomeEntries = this.entries.filter(e => e.type === 'income');
  const expenseEntries = this.entries.filter(e => e.type === 'expense');
  
  const totalIncome = this.getTotalIncome();
  const totalExpense = this.getTotalExpense();
  const netProfit = totalIncome - totalExpense;
  const cycles = Math.max(1, expenseEntries.length || incomeEntries.length || 1);
  const avgIncome = totalIncome / BigInt(cycles);
  const avgExpense = totalExpense / BigInt(cycles);
  const roiBasis = totalExpense === 0n ? 1n : totalExpense;
  const roiPercent = Number((netProfit * 10000n) / roiBasis) / 100;
  const runwayCycles = avgExpense > 0n
    ? Number(currentBalance.sui / avgExpense).toFixed(1)
    : '∞';
  
  // 确定报表周期
  const timestamps = this.entries.map(e => e.timestamp.getTime());
  const periodStart = timestamps.length > 0 
    ? new Date(Math.min(...timestamps)) 
    : new Date();
  const periodEnd = new Date();

  return {
    generatedAt: new Date(),
    period: {
      start: periodStart,
      end: periodEnd
    },
    income: {
      total: totalIncome,
      totalFormatted: this.formatSui(totalIncome),
      byCategory: this.getIncomeByCategory(),
      count: incomeEntries.length
    },
    expense: {
      total: totalExpense,
      totalFormatted: this.formatSui(totalExpense),
      byCategory: this.getExpenseByCategory(),
      count: expenseEntries.length
    },
    netProfit: {
      amount: netProfit,
      amountFormatted: this.formatSui(netProfit < 0n ? -netProfit : netProfit),
      isPositive: netProfit >= 0n
    },
    currentBalance: {
      amount: currentBalance.sui,
      amountFormatted: currentBalance.suiFormatted
    },
    unitEconomics: {
      cycles,
      avgIncomePerCycle: this.formatSui(avgIncome),
      avgExpensePerCycle: this.formatSui(avgExpense),
      roiPercent: `${roiPercent.toFixed(2)}%`,
      burnRatePerCycle: this.formatSui(avgExpense),
      runwayCycles
    }
  };
}
```

### 4. CLI 格式化输出

```typescript
formatReportForCLI(report: ProfitLossReport): string {
  const lines: string[] = [];
  
  // 标题
  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════╗');
  lines.push('║          💰 AGENT PROFIT & LOSS STATEMENT 💰          ║');
  lines.push('╠════════════════════════════════════════════════════════╣');
  
  // 周期
  const periodStr = `${this.formatDate(report.period.start)} ~ ${this.formatDate(report.period.end)}`;
  lines.push(`║  Period: ${this.padRight(periodStr, 45)}║`);
  lines.push('╠════════════════════════════════════════════════════════╣');
  
  // 收入部分
  lines.push('║  📥 INCOME                                             ║');
  lines.push(`║     Total: ${this.padRight('+' + report.income.totalFormatted, 43)}║`);
  for (const [category, amount] of Object.entries(report.income.byCategory)) {
    const formatted = this.formatSui(amount as bigint);
    lines.push(`║       └─ ${this.padRight(category + ': +' + formatted, 44)}║`);
  }
  lines.push('╠════════════════════════════════════════════════════════╣');
  
  // 支出部分
  lines.push('║  📤 EXPENSE                                            ║');
  lines.push(`║     Total: ${this.padRight('-' + report.expense.totalFormatted, 43)}║`);
  for (const [category, amount] of Object.entries(report.expense.byCategory)) {
    const formatted = this.formatSui(amount as bigint);
    lines.push(`║       └─ ${this.padRight(category + ': -' + formatted, 44)}║`);
  }
  lines.push('╠════════════════════════════════════════════════════════╣');
  
  // 净利润
  const profitSign = report.netProfit.isPositive ? '+' : '-';
  const profitEmoji = report.netProfit.isPositive ? '✅' : '❌';
  lines.push('║  💵 NET PROFIT                                         ║');
  lines.push(`║     ${profitEmoji} ${this.padRight(profitSign + report.netProfit.amountFormatted, 48)}║`);
  lines.push('╠════════════════════════════════════════════════════════╣');
  
  // 当前余额
  lines.push('║  🏦 CURRENT BALANCE                                    ║');
  lines.push(`║     ${this.padRight(report.currentBalance.amountFormatted, 49)}║`);
  lines.push('╠════════════════════════════════════════════════════════╣');

  // 经营指标
  lines.push('║  📈 UNIT ECONOMICS                                    ║');
  lines.push(`║     Cycles: ${this.padRight(String(report.unitEconomics.cycles), 43)}║`);
  lines.push(`║     Avg Income/Cycle: ${this.padRight('+' + report.unitEconomics.avgIncomePerCycle, 33)}║`);
  lines.push(`║     Avg Expense/Cycle: ${this.padRight('-' + report.unitEconomics.avgExpensePerCycle, 32)}║`);
  lines.push(`║     ROI: ${this.padRight(report.unitEconomics.roiPercent, 46)}║`);
  lines.push(`║     Burn Rate: ${this.padRight(report.unitEconomics.burnRatePerCycle, 40)}║`);
  lines.push(`║     Runway: ${this.padRight(report.unitEconomics.runwayCycles + ' cycles', 41)}║`);
  lines.push('╚════════════════════════════════════════════════════════╝');
  lines.push('');
  
  return lines.join('\n');
}

private padRight(str: string, length: number): string {
  return str.padEnd(length, ' ');
}

private formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

private formatSui(mist: bigint): string {
  const sui = Number(mist) / 1_000_000_000;
  return sui.toFixed(4) + ' SUI';
}
```

### 5. JSON 导出

```typescript
exportToJson(): string {
  const data = {
    exportedAt: new Date().toISOString(),
    entries: this.entries.map(e => ({
      ...e,
      amount: e.amount.toString(),
      timestamp: e.timestamp.toISOString()
    })),
    summary: {
      totalIncome: this.getTotalIncome().toString(),
      totalExpense: this.getTotalExpense().toString(),
      netProfit: this.getNetProfit().toString(),
      entryCount: this.entries.length
    }
  };
  
  return JSON.stringify(data, null, 2);
}

getEntries(): LedgerEntry[] {
  return [...this.entries];
}

clear(): void {
  this.entries = [];
  console.log('✓ Ledger cleared');
}
```

## CLI 输出示例

```
╔════════════════════════════════════════════════════════╗
║          💰 AGENT PROFIT & LOSS STATEMENT 💰          ║
╠════════════════════════════════════════════════════════╣
║  Period: 2026-02-16 ~ 2026-02-16                       ║
╠════════════════════════════════════════════════════════╣
║  📥 INCOME                                             ║
║     Total: +0.5000 SUI                                 ║
║       └─ task_reward: +0.5000 SUI                      ║
╠════════════════════════════════════════════════════════╣
║  📤 EXPENSE                                            ║
║     Total: -0.0500 SUI                                 ║
║       └─ storage: -0.0500 SUI                          ║
╠════════════════════════════════════════════════════════╣
║  💵 NET PROFIT                                         ║
║     ✅ +0.4500 SUI                                     ║
╠════════════════════════════════════════════════════════╣
║  🏦 CURRENT BALANCE                                    ║
║     1.4500 SUI                                         ║
╚════════════════════════════════════════════════════════╝
```

## 与其他模块的关系

```
┌─────────────┐                        ┌─────────────┐
│   Earner    │──── recordIncome() ───▶│             │
└─────────────┘                        │             │
                                       │   Ledger    │
┌─────────────┐                        │             │
│   Spender   │──── recordExpense() ──▶│             │
└─────────────┘                        └──────┬──────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │   Report    │
                                       │ (CLI/JSON)  │
                                       └─────────────┘
```

## 单元测试要点

```typescript
describe('Ledger', () => {
  it('should record income', () => {
    const ledger = new Ledger();
    ledger.recordIncome(mockIncomeRecord);
    
    expect(ledger.getTotalIncome()).toBe(mockIncomeRecord.amount);
  });

  it('should calculate net profit', () => {
    const ledger = new Ledger();
    ledger.recordIncome({ ...mockIncome, amount: 1000n });
    ledger.recordExpense({ ...mockExpense, amount: 300n });
    
    expect(ledger.getNetProfit()).toBe(700n);
  });

  it('should group by category', () => {
    const ledger = new Ledger();
    ledger.recordIncome({ ...mockIncome, type: 'task_reward', amount: 100n });
    ledger.recordIncome({ ...mockIncome, type: 'task_reward', amount: 200n });
    
    const byCategory = ledger.getIncomeByCategory();
    expect(byCategory['task_reward']).toBe(300n);
  });

  it('should generate report', async () => {
    const ledger = new Ledger();
    await ledger.initialize({ walletManager, autoSaveInterval: 0 });
    
    const report = await ledger.generateReport();
    expect(report.generatedAt).toBeDefined();
    expect(report.netProfit).toBeDefined();
  });
});
```

## 开发优先级

1. **P0 必须**: `recordIncome()`, `recordExpense()` - 收支记录
2. **P0 必须**: `getNetProfit()` - 核心计算
3. **P0 必须**: `formatReportForCLI()` - Demo 展示
4. **P1 重要**: `generateReport()` - 完整报表
5. **P2 可选**: `exportToJson()` - 数据持久化

## 预计开发时间

| 任务 | 时间 |
|------|------|
| 收支记录 | 1小时 |
| 损益计算 | 1小时 |
| 报表生成 | 2小时 |
| CLI 格式化 | 2小时 |
| JSON 导出 | 1小时 |
| 单元测试 | 1小时 |
| **总计** | **8小时** |
