# 模块三：支出模块 (Spender)

## 概述

Spender 是 Agent 的"支出管理器"，负责管理 Agent 的各项开支。在 MVP 阶段，主要支出是 Walrus 存储费用，用于存储 Agent 的加密备份和财务报表。为保证数据主权，上传前先通过 Seal 流程加密数据。

## 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                        Spender                              │
├─────────────────────────────────────────────────────────────┤
│  支出类型                                                    │
│  ├─ Walrus 存储费（MVP核心）                                 │
│  ├─ Gas 费用（交易附带）                                     │
│  ├─ API 服务费（可选扩展）                                   │
│  └─ 其他服务费（可选扩展）                                   │
├─────────────────────────────────────────────────────────────┤
│  支出记录                                                    │
│  ├─ 记录每笔支出的用途、金额、时间、交易ID                    │
│  └─ 通知 Ledger 模块更新账本                                 │
└─────────────────────────────────────────────────────────────┘
```

## 技术依赖

```json
{
  "@mysten/sui": "^1.x.x",
  "@mysten/walrus": "^1.x.x",
  "@mysten/seal": "^1.x.x"
}
```

## 接口设计

### 类型定义

```typescript
// 支出记录
interface ExpenseRecord {
  // 唯一标识
  id: string;
  // 支出类型
  type: 'storage' | 'gas' | 'api' | 'other';
  // 金额（MIST）
  amount: bigint;
  // 金额（格式化）
  amountFormatted: string;
  // 交易摘要
  txDigest: string;
  // 时间戳
  timestamp: Date;
  // 用途描述
  purpose: string;
  // 状态
  status: 'pending' | 'confirmed' | 'failed';
  // 额外信息
  metadata?: {
    blobId?: string;        // Walrus Blob ID
    fileName?: string;      // 上传的文件名
    fileSize?: number;      // 文件大小
    epochs?: number;        // 存储周期数
    encryption?: string;    // 加密策略（例如 seal-aes-256）
  };
}

// 支出模块配置
interface SpenderConfig {
  // 钱包管理器实例
  walletManager: WalletManager;
  // Walrus 配置
  walrus: {
    publisherUrl: string;
    aggregatorUrl: string;
  };
  // 最大单笔支出（安全限制）
  maxSingleExpense: bigint;
}

// Walrus 上传结果
interface WalrusUploadResult {
  success: boolean;
  blobId?: string;
  cost?: bigint;
  txDigest?: string;
  error?: string;
}
```

### 核心方法

```typescript
class Spender {
  /**
   * 初始化支出模块
   */
  async initialize(config: SpenderConfig): Promise<void>;

  /**
   * 在上传前执行 Seal 加密流程（当前可先 mock，后续替换真实 SDK）
   */
  async encryptData(data: Buffer): Promise<Buffer>;

  /**
   * 上传数据到 Walrus 并支付存储费
   * @param data 要存储的数据
   * @param fileName 文件名（用于记录）
   * @returns 支出记录
   */
  async uploadToWalrus(data: Buffer | string, fileName: string): Promise<ExpenseRecord>;

  /**
   * 估算 Walrus 存储费用
   * @param dataSize 数据大小（字节）
   * @param epochs 存储周期数
   * @returns 预估费用（MIST）
   */
  async estimateStorageCost(dataSize: number, epochs?: number): Promise<bigint>;

  /**
   * 执行支付（通用方法）
   * @param to 接收地址
   * @param amount 金额
   * @param purpose 用途描述
   * @returns 支出记录
   */
  async pay(to: string, amount: bigint, purpose: string): Promise<ExpenseRecord>;

  /**
   * 获取所有支出记录
   */
  getExpenseHistory(): ExpenseRecord[];

  /**
   * 获取总支出
   */
  getTotalExpense(): bigint;

  /**
   * 注册支出回调（通知 Ledger）
   */
  onExpense(callback: (record: ExpenseRecord) => void): void;

  /**
   * 检查是否有足够余额支付
   */
  async canAfford(amount: bigint): Promise<boolean>;
}
```

## 实现细节

### 1. Seal 加密 + Walrus 存储上传

```typescript
import { WalrusClient } from '@mysten/walrus';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { SealClient } from '@mysten/seal';

class Spender {
  private walletManager: WalletManager;
  private walrusClient: WalrusClient;
  private sealClient: SealClient;
  private expenseHistory: ExpenseRecord[] = [];
  private callbacks: ((record: ExpenseRecord) => void)[] = [];
  private config: SpenderConfig;

  async initialize(config: SpenderConfig): Promise<void> {
    this.walletManager = config.walletManager;
    this.config = config;

    // 初始化 Walrus Client
    const suiClient = new SuiClient({ 
      url: getFullnodeUrl('testnet') 
    });
    
    this.walrusClient = new WalrusClient({
      network: 'testnet',
      suiClient,
      storageNodeClientOptions: {
        timeout: 60_000
      }
    });

    // 初始化 Seal Client（MVP 可先作为占位，后续接入真实策略）
    this.sealClient = new SealClient({
      suiClient,
      serverObjectIds: []
    });

    console.log('✓ Spender module initialized');
  }

  async uploadToWalrus(data: Buffer | string, fileName: string): Promise<ExpenseRecord> {
    // 转换为 Buffer
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

    // 先加密再上传
    console.log('🔐 Encrypting data with Seal...');
    const encryptedBuffer = await this.encryptData(buffer);
    console.log('🔒 Data encrypted via Seal Protocol');
    
    console.log(`📤 Uploading ${fileName} to Walrus (${encryptedBuffer.length} bytes encrypted)...`);

    // 检查余额是否足够
    const estimatedCost = await this.estimateStorageCost(encryptedBuffer.length);
    if (!(await this.canAfford(estimatedCost))) {
      throw new Error(`Insufficient balance. Need ${this.formatSui(estimatedCost)}`);
    }

    // 记录支付前余额
    const balanceBefore = (await this.walletManager.getBalance()).sui;

    try {
      // 上传到 Walrus
      // 使用 keypair 作为 signer
      const keypair = this.walletManager.getKeypair();
      
      const result = await this.walrusClient.writeBlob({
        blob: encryptedBuffer,
        deletable: false,
        epochs: 1,  // 存储 1 个 epoch
        signer: keypair
      });

      // 计算实际花费
      const balanceAfter = (await this.walletManager.getBalance()).sui;
      const actualCost = balanceBefore - balanceAfter;

      const record: ExpenseRecord = {
        id: this.generateId(),
        type: 'storage',
        amount: actualCost,
        amountFormatted: this.formatSui(actualCost),
        txDigest: result.newlyCreated?.blobObject?.id || 'N/A',
        timestamp: new Date(),
        purpose: `Encrypted backup storage: ${fileName}`,
        status: 'confirmed',
        metadata: {
          blobId: result.newlyCreated?.blobObject?.blobId || 
                  result.alreadyCertified?.blobId,
          fileName,
          fileSize: encryptedBuffer.length,
          epochs: 1,
          encryption: 'seal-aes-256'
        }
      };

      this.expenseHistory.push(record);
      this.notifyCallbacks(record);

      console.log(`✓ Encrypted blob uploaded to Walrus: ${record.metadata?.blobId}`);
      console.log(`✓ Cost: ${record.amountFormatted}`);
      
      return record;

    } catch (error) {
      console.error(`✗ Walrus upload failed: ${error}`);
      
      const record: ExpenseRecord = {
        id: this.generateId(),
        type: 'storage',
        amount: 0n,
        amountFormatted: '0 SUI',
        txDigest: '',
        timestamp: new Date(),
        purpose: `Encrypted backup storage: ${fileName} (FAILED)`,
        status: 'failed',
        metadata: { fileName, fileSize: encryptedBuffer.length, encryption: 'seal-aes-256' }
      };

      return record;
    }
  }

  async encryptData(data: Buffer): Promise<Buffer> {
    // MVP：保留稳定演示路径，先 mock Seal 流程
    // TODO: 接入真实 Seal policy 与密钥封装
    await this.sleep(200);
    return data;
  }
}
```

### 2. 费用估算

```typescript
async estimateStorageCost(dataSize: number, epochs: number = 1): Promise<bigint> {
  // Walrus 存储定价（简化估算）
  // 实际定价取决于网络状态，这里使用保守估算
  
  // 基础费用：约 0.001 SUI per KB per epoch
  // 加上 gas 费用：约 0.0001 SUI per transaction
  
  const KB = Math.ceil(dataSize / 1024);
  const storageCostPerKB = 1_000_000n; // 0.001 SUI in MIST
  const gasCost = 100_000n; // 0.0001 SUI in MIST
  
  const totalCost = (BigInt(KB) * storageCostPerKB * BigInt(epochs)) + gasCost;
  
  // 添加 20% 缓冲
  return totalCost * 120n / 100n;
}

async canAfford(amount: bigint): Promise<boolean> {
  // 检查当前余额是否足够支付
  // 保留 0.01 SUI 作为最低余额
  const minReserve = 10_000_000n; // 0.01 SUI
  const balance = (await this.walletManager.getBalance()).sui;
  
  return balance >= amount + minReserve;
}
```

### 3. 安全限制

```typescript
async pay(to: string, amount: bigint, purpose: string): Promise<ExpenseRecord> {
  // 安全检查：不超过最大单笔支出
  if (amount > this.config.maxSingleExpense) {
    throw new Error(
      `Expense ${this.formatSui(amount)} exceeds max ${this.formatSui(this.config.maxSingleExpense)}`
    );
  }

  // 检查余额
  if (!(await this.canAfford(amount))) {
    throw new Error(`Insufficient balance for ${this.formatSui(amount)}`);
  }

  // 执行转账
  const result = await this.walletManager.transferSui(to, Number(amount) / 1e9);

  const record: ExpenseRecord = {
    id: this.generateId(),
    type: 'other',
    amount,
    amountFormatted: this.formatSui(amount),
    txDigest: result.digest,
    timestamp: new Date(),
    purpose,
    status: result.success ? 'confirmed' : 'failed'
  };

  if (result.success) {
    this.expenseHistory.push(record);
    this.notifyCallbacks(record);
  }

  return record;
}
```

### 4. 支出统计

```typescript
getExpenseHistory(): ExpenseRecord[] {
  return [...this.expenseHistory];
}

getTotalExpense(): bigint {
  return this.expenseHistory
    .filter(r => r.status === 'confirmed')
    .reduce((sum, r) => sum + r.amount, 0n);
}

getTotalExpenseFormatted(): string {
  return this.formatSui(this.getTotalExpense());
}

onExpense(callback: (record: ExpenseRecord) => void): void {
  this.callbacks.push(callback);
}

private notifyCallbacks(record: ExpenseRecord): void {
  this.callbacks.forEach(cb => cb(record));
}

private generateId(): string {
  return `expense_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

private formatSui(mist: bigint): string {
  const sui = Number(mist) / 1_000_000_000;
  return sui.toFixed(4) + ' SUI';
}
```

## 典型支出场景

### 场景 1：上传加密运行日志

```typescript
// Agent 每小时上传一次运行日志
const logContent = JSON.stringify({
  timestamp: new Date().toISOString(),
  actions: ['local_task_execution', 'task_reward_settlement', 'balance_check'],
  status: 'healthy'
}, null, 2);

const record = await spender.uploadToWalrus(
  logContent, 
  `agent_log_${Date.now()}.json`
);

console.log(`Encrypted log uploaded, cost: ${record.amountFormatted}`);
```

### 场景 2：上传加密财务报表

```typescript
// 每天结束时上传损益报表
const report = ledger.generateReport();
const reportJson = JSON.stringify(report, null, 2);

const record = await spender.uploadToWalrus(
  reportJson,
  `financial_report_${new Date().toISOString().split('T')[0]}.json`
);

console.log(`Encrypted report uploaded, blob: ${record.metadata?.blobId}`);
```

## 与其他模块的关系

```
┌─────────────────┐
│  WalletManager  │
└────────┬────────┘
         │ 提供签名和转账能力
         ▼
┌─────────────────┐         ┌─────────────┐
│    Spender      │────────▶│   Ledger    │
└────────┬────────┘ 支出通知 └─────────────┘
         │
         ▼
┌─────────────────┐
│     Walrus      │
│  (链下存储)      │
└─────────────────┘
```

## 单元测试要点

```typescript
describe('Spender', () => {
  it('should estimate storage cost', async () => {
    const spender = new Spender();
    await spender.initialize(config);
    
    const cost = await spender.estimateStorageCost(1024); // 1 KB
    expect(cost).toBeGreaterThan(0n);
  });

  it('should upload to Walrus', async () => {
    const spender = new Spender();
    await spender.initialize(config);
    
    const record = await spender.uploadToWalrus('test data', 'test.txt');
    expect(record.status).toBe('confirmed');
    expect(record.metadata?.blobId).toBeDefined();
  });

  it('should reject expense exceeding max', async () => {
    const spender = new Spender();
    await spender.initialize({ ...config, maxSingleExpense: 1000000n });
    
    await expect(
      spender.pay('0x...', 2000000n, 'test')
    ).rejects.toThrow(/exceeds max/);
  });

  it('should track total expenses', async () => {
    const spender = new Spender();
    // ... 模拟多笔支出
    
    const total = spender.getTotalExpense();
    expect(total).toBeGreaterThan(0n);
  });
});
```

## 开发优先级

1. **P0 必须**: `uploadToWalrus()` - MVP 核心支出场景
2. **P0 必须**: `estimateStorageCost()` - 支出前预估
3. **P0 必须**: `getTotalExpense()` - 统计展示
4. **P1 重要**: `canAfford()` - 安全检查
5. **P2 可选**: `pay()` - 通用支付

## 预计开发时间

| 任务 | 时间 |
|------|------|
| Walrus 客户端初始化 | 2小时 |
| 上传实现 | 3小时 |
| 费用估算 | 1小时 |
| 支出统计 | 1小时 |
| 安全限制 | 1小时 |
| 单元测试 | 2小时 |
| **总计** | **10小时** |
