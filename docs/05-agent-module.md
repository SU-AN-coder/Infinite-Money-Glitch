# 模块五：Agent 主循环 (Agent)

## 概述

Agent 是整个系统的"大脑"，负责协调所有模块，执行主循环逻辑，做出"赚钱"和"花钱"的决策。它是将所有模块串联起来的核心调度器。

## 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                          Agent                              │
├─────────────────────────────────────────────────────────────┤
│  模块协调                                                    │
│  ├─ 初始化所有子模块                                         │
│  ├─ 连接模块间的事件回调                                     │
│  └─ 统一错误处理和日志                                       │
├─────────────────────────────────────────────────────────────┤
│  主循环逻辑                                                  │
│  ├─ 检查当前状态                                             │
│  ├─ 决定是否执行赚钱操作                                     │
│  ├─ 决定是否执行花钱操作                                     │
│  └─ 生成并展示报表                                           │
├─────────────────────────────────────────────────────────────┤
│  用户交互                                                    │
│  ├─ CLI 命令处理                                             │
│  ├─ 状态展示                                                 │
│  └─ 优雅退出                                                 │
└─────────────────────────────────────────────────────────────┘
```

## 接口设计

### 类型定义

```typescript
// Agent 配置
interface AgentConfig {
  // 网络
  network: 'testnet' | 'mainnet' | 'devnet';
  // 私钥来源
  keySource: 'generate' | 'import';
  // 私钥存储路径
  keyStorePath?: string;
  // Walrus 配置
  walrus: {
    publisherUrl: string;
    aggregatorUrl: string;
  };
  // 自动运行模式
  autoMode: boolean;
  // 自动运行间隔（毫秒）
  autoInterval: number;
}

// Agent 状态
interface AgentState {
  // 是否已初始化
  initialized: boolean;
  // 是否正在运行
  running: boolean;
  // 钱包地址
  address: string;
  // 当前余额
  balance: bigint;
  // 总收入
  totalIncome: bigint;
  // 总支出
  totalExpense: bigint;
  // 净利润
  netProfit: bigint;
  // 循环次数
  cycleCount: number;
  // 单周期燃烧率（支出）
  burnRate: bigint;
  // 预计可运行周期
  runwayCycles: number;
  // 生存状态
  healthStatus: 'PROFITABLE' | 'STABLE' | 'STARVATION_IMMINENT';
}

// 循环结果
interface CycleResult {
  // 循环编号
  cycleNumber: number;
  // 收入记录
  incomes: IncomeRecord[];
  // 支出记录
  expenses: ExpenseRecord[];
  // 本轮净利润
  netProfit: bigint;
  // 执行时间
  duration: number;
}
```

### 核心方法

```typescript
class Agent {
  /**
   * 初始化 Agent 和所有子模块
   */
  async initialize(config: AgentConfig): Promise<void>;

  /**
   * 启动 Agent（进入主循环）
   */
  async start(): Promise<void>;

  /**
   * 停止 Agent
   */
  async stop(): Promise<void>;

  /**
   * 执行单个循环
   */
  async runCycle(): Promise<CycleResult>;

  /**
   * 获取当前状态
   */
  getState(): AgentState;

  /**
   * 展示状态到 CLI
   */
  displayStatus(): void;

  /**
   * 展示最终报表
   */
  async displayFinalReport(): Promise<void>;
}
```

## 实现细节

### 1. 模块初始化

```typescript
class Agent {
  private walletManager: WalletManager;
  private earner: Earner;
  private spender: Spender;
  private ledger: Ledger;
  private config: AgentConfig;
  private running: boolean = false;
  private cycleCount: number = 0;
  private lastCycleExpense: bigint = 0n;

  async initialize(config: AgentConfig): Promise<void> {
    this.config = config;
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║        🤖 INFINITE MONEY GLITCH - INITIALIZING 🤖      ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');

    // 1. 初始化钱包
    this.walletManager = new WalletManager();
    await this.walletManager.initialize({
      keySource: config.keySource,
      network: config.network,
      keyStorePath: config.keyStorePath
    });

    // 2. 初始化账本
    this.ledger = new Ledger();
    await this.ledger.initialize({
      walletManager: this.walletManager,
      autoSaveInterval: 0
    });

    // 3. 初始化收入模块
    this.earner = new Earner();
    await this.earner.initialize({
      walletManager: this.walletManager,
      faucetCooldown: 60000, // 1分钟冷却
      maxRetries: 3
    });
    // 连接收入回调
    this.earner.onIncome((record) => {
      this.ledger.recordIncome(record);
    });

    // 4. 初始化支出模块
    this.spender = new Spender();
    await this.spender.initialize({
      walletManager: this.walletManager,
      walrus: config.walrus,
      maxSingleExpense: 100_000_000n // 0.1 SUI 上限
    });
    // 连接支出回调
    this.spender.onExpense((record) => {
      this.ledger.recordExpense(record);
    });

    console.log('');
    console.log('✓ All modules initialized');
    console.log('');

    // 显示初始状态
    await this.displayStatus();
  }
}
```

### 2. 主循环逻辑

```typescript
async start(): Promise<void> {
  if (this.running) {
    console.log('Agent is already running');
    return;
  }

  this.running = true;
  console.log('');
  console.log('🚀 Agent started');
  console.log('');

  if (this.config.autoMode) {
    // 自动模式：持续循环
    while (this.running) {
      await this.runCycle();
      
      if (this.running) {
        console.log(`⏳ Waiting ${this.config.autoInterval / 1000}s for next cycle...`);
        await this.sleep(this.config.autoInterval);
      }
    }
  } else {
    // 单次模式：执行一次循环后停止
    await this.runCycle();
    await this.stop();
  }
}

async stop(): Promise<void> {
  this.running = false;
  console.log('');
  console.log('🛑 Agent stopping...');
  
  // 显示最终报表
  await this.displayFinalReport();
  
  console.log('');
  console.log('✓ Agent stopped');
}

async runCycle(): Promise<CycleResult> {
  this.cycleCount++;
  const startTime = Date.now();
  
  console.log('');
  console.log(`═══════════════════ CYCLE #${this.cycleCount} ═══════════════════`);
  console.log('');

  const incomes: IncomeRecord[] = [];
  const expenses: ExpenseRecord[] = [];

  // 步骤 1: 显示当前余额
  const balanceBefore = await this.walletManager.getBalance();
  console.log(`💰 Current Balance: ${balanceBefore.suiFormatted}`);
  const burnRate = this.lastCycleExpense;
  const runwayCycles = burnRate > 0n ? Number(balanceBefore.sui / burnRate) : 999;
  const healthStatus = this.getHealthStatus(balanceBefore.sui, burnRate, this.ledger.getNetProfit());

  this.renderHealthBar(balanceBefore.sui, burnRate, runwayCycles, healthStatus);
  console.log('');

  // 步骤 2: 尝试赚钱（先执行真实本地任务，再链上结算）
  console.log('📥 EARNING PHASE');
  console.log('─────────────────');
  try {
    const income = await this.earner.requestFaucet();
    if (income.status === 'confirmed') {
      incomes.push(income);
    }
  } catch (error) {
    console.log(`   Reward settlement skipped: ${error}`);
  }
  console.log('');

  // 步骤 3: 尝试花钱（上传加密备份到 Walrus）
  console.log('📤 SPENDING PHASE');
  console.log('─────────────────');
  try {
    // 准备要上传的日志
    const logContent = this.prepareLogContent();
    const expense = await this.spender.uploadToWalrus(
      logContent,
      `agent_log_cycle_${this.cycleCount}.json`
    );
    if (expense.status === 'confirmed') {
      expenses.push(expense);
    }
  } catch (error) {
    console.log(`   Upload skipped: ${error}`);
  }
  console.log('');

  // 步骤 4: 显示本轮结果
  const balanceAfter = await this.walletManager.getBalance();
  const netProfit = this.calculateNetProfit(incomes, expenses);
  this.lastCycleExpense = this.sumRecords(expenses);
  
  console.log('📊 CYCLE RESULT');
  console.log('─────────────────');
  console.log(`   Income:  +${this.formatSui(this.sumRecords(incomes))}`);
  console.log(`   Expense: -${this.formatSui(this.sumRecords(expenses))}`);
  console.log(`   Net:     ${netProfit >= 0n ? '+' : ''}${this.formatSui(netProfit)}`);
  console.log(`   Balance: ${balanceAfter.suiFormatted}`);
  if (healthStatus === 'STARVATION_IMMINENT') {
    console.log('   🚨 STARVATION IMMINENT: Agent must earn immediately to survive.');
  } else if (healthStatus === 'PROFITABLE') {
    console.log('   ✅ PROFITABLE: Sustainable operating state.');
  }
  console.log('');

  const duration = Date.now() - startTime;
  
  return {
    cycleNumber: this.cycleCount,
    incomes,
    expenses,
    netProfit,
    duration
  };
}

private prepareLogContent(): string {
  return JSON.stringify({
    agentId: this.walletManager.getAddress(),
    cycle: this.cycleCount,
    timestamp: new Date().toISOString(),
    state: this.getState(),
    workProofMode: 'real-local-task',
    expectedTasks: ['tmp_scan', 'system_check', 'git_status'],
    message: 'Agent is running and profitable!'
  }, null, 2);
}

private sumRecords(records: (IncomeRecord | ExpenseRecord)[]): bigint {
  return records.reduce((sum, r) => sum + r.amount, 0n);
}

private calculateNetProfit(
  incomes: IncomeRecord[], 
  expenses: ExpenseRecord[]
): bigint {
  return this.sumRecords(incomes) - this.sumRecords(expenses);
}
```

### 3. 状态展示

```typescript
getState(): AgentState {
  const totalExpense = this.ledger.getTotalExpense();
  const burnRate = this.lastCycleExpense;
  const runwayCycles = burnRate > 0n ? Number(totalExpense / burnRate) : 999;
  const healthStatus = this.getHealthStatus(0n, burnRate, this.ledger.getNetProfit());

  return {
    initialized: true,
    running: this.running,
    address: this.walletManager.getAddress(),
    balance: 0n, // 需要异步获取
    totalIncome: this.ledger.getTotalIncome(),
    totalExpense,
    netProfit: this.ledger.getNetProfit(),
    cycleCount: this.cycleCount,
    burnRate,
    runwayCycles,
    healthStatus
  };
}

async displayStatus(): Promise<void> {
  const balance = await this.walletManager.getBalance();
  const burnRate = this.lastCycleExpense;
  const runwayCycles = burnRate > 0n ? Number(balance.sui / burnRate).toFixed(1) : '∞';
  const healthStatus = this.getHealthStatus(balance.sui, burnRate, this.ledger.getNetProfit());
  
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║               🤖 AGENT STATUS 🤖                       ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Address: ${this.walletManager.getAddress().slice(0, 20)}...║`);
  console.log(`║  Network: ${this.padRight(this.config.network, 44)}║`);
  console.log(`║  Balance: ${this.padRight(balance.suiFormatted, 44)}║`);
  console.log(`║  Burn Rate/Cycle: ${this.padRight(this.formatSui(burnRate), 35)}║`);
  console.log(`║  Runway: ${this.padRight(runwayCycles + ' cycles', 42)}║`);
  console.log(`║  Health: ${this.padRight(healthStatus, 42)}║`);
  console.log('╚════════════════════════════════════════════════════════╝');
}

async displayFinalReport(): Promise<void> {
  const report = await this.ledger.generateReport();
  const formatted = this.ledger.formatReportForCLI(report);
  console.log(formatted);
  
  // 显示成功/失败结论
  if (report.netProfit.isPositive) {
    console.log('🎉 SUCCESS: Agent made a profit!');
    console.log('   The Infinite Money Glitch is REAL.');
  } else {
    console.log('📉 Agent operated at a loss this session.');
    console.log('   Adjusting strategies for next run...');
  }
}

private padRight(str: string, length: number): string {
  return str.padEnd(length, ' ');
}

private formatSui(mist: bigint): string {
  const sui = Number(mist) / 1_000_000_000;
  return sui.toFixed(4) + ' SUI';
}

private getHealthStatus(balance: bigint, burnRate: bigint, netProfit: bigint): AgentState['healthStatus'] {
  if (netProfit > 0n) {
    return 'PROFITABLE';
  }

  if (burnRate > 0n) {
    const runway = Number(balance / burnRate);
    if (runway <= 3) {
      return 'STARVATION_IMMINENT';
    }
  }

  return 'STABLE';
}

private renderHealthBar(
  balance: bigint,
  burnRate: bigint,
  runwayCycles: number,
  healthStatus: AgentState['healthStatus']
): void {
  const maxFuel = 2_000_000_000n; // 2 SUI 作为展示上限
  const fuelPercent = Math.max(0, Math.min(100, Number((balance * 100n) / maxFuel)));
  const filled = Math.floor(fuelPercent / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  console.log(`🤖 AGENT HEALTH: [${bar}] ${fuelPercent}% (${healthStatus})`);
  console.log(`📉 Burn Rate: ${this.formatSui(burnRate)} / cycle`);
  console.log(`📈 Est. Runway: ${runwayCycles === 999 ? '∞' : runwayCycles + ' cycles'}`);
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## 主流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent.start()                            │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  while (running)     │
                    └──────────┬───────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        runCycle()                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ 1. 显示余额   │───▶│ 2. 赚钱      │───▶│ 3. 花钱      │       │
│  │              │    │ (Faucet)    │    │ (Walrus)    │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│                                                 │               │
│                                                 ▼               │
│                              ┌──────────────────────────┐       │
│                              │ 4. 显示本轮结果           │       │
│                              │    - Income              │       │
│                              │    - Expense             │       │
│                              │    - Net Profit          │       │
│                              └──────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  sleep(interval)     │
                    └──────────────────────┘
                               │
                               └──────────▶ (循环)
                               
                    ┌──────────────────────┐
                    │  Agent.stop()        │
                    └──────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  displayFinalReport()│
                    └──────────────────────┘
```

## 入口文件

```typescript
// src/index.ts
import { Agent } from './agent/Agent';

async function main() {
  const agent = new Agent();
  
  // 解析命令行参数
  const args = process.argv.slice(2);
  const autoMode = args.includes('--auto');
  
  await agent.initialize({
    network: 'testnet',
    keySource: process.env.PRIVATE_KEY ? 'import' : 'generate',
    keyStorePath: './.agent/wallet.json',
    walrus: {
      publisherUrl: 'https://publisher.testnet.walrus.wal.app',
      aggregatorUrl: 'https://aggregator.testnet.walrus.wal.app'
    },
    autoMode,
    autoInterval: 60000 // 1分钟
  });

  // 处理退出信号
  process.on('SIGINT', async () => {
    console.log('\n\nReceived SIGINT, stopping agent...');
    await agent.stop();
    process.exit(0);
  });

  // 启动
  await agent.start();
}

main().catch(console.error);
```

## 单元测试要点

```typescript
describe('Agent', () => {
  it('should initialize all modules', async () => {
    const agent = new Agent();
    await agent.initialize(mockConfig);
    
    const state = agent.getState();
    expect(state.initialized).toBe(true);
    expect(state.address).toMatch(/^0x/);
  });

  it('should run a single cycle', async () => {
    const agent = new Agent();
    await agent.initialize(mockConfig);
    
    const result = await agent.runCycle();
    expect(result.cycleNumber).toBe(1);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('should calculate net profit correctly', async () => {
    const agent = new Agent();
    await agent.initialize(mockConfig);
    
    await agent.runCycle();
    
    const state = agent.getState();
    expect(state.netProfit).toBe(
      state.totalIncome - state.totalExpense
    );
  });
});
```

## 开发优先级

1. **P0 必须**: `initialize()` - 模块初始化
2. **P0 必须**: `runCycle()` - 核心循环
3. **P0 必须**: `displayFinalReport()` - Demo 展示
4. **P1 重要**: `start()`, `stop()` - 生命周期
5. **P2 可选**: 自动模式循环

## 预计开发时间

| 任务 | 时间 |
|------|------|
| 模块初始化 | 2小时 |
| 主循环逻辑 | 3小时 |
| 状态展示 | 2小时 |
| 入口文件 | 1小时 |
| 单元测试 | 2小时 |
| **总计** | **10小时** |
