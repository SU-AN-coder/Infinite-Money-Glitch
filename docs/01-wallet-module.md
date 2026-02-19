# 模块一：钱包管理 (WalletManager)

## 概述

WalletManager 是 Agent 的"银行账户"模块，负责密钥管理、余额查询和交易签名。这是整个经济系统的基础设施层。

## 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                     WalletManager                           │
├─────────────────────────────────────────────────────────────┤
│  密钥管理        │  余额查询        │  交易签名             │
│  ├─ 生成密钥对   │  ├─ 查询SUI余额  │  ├─ 构建交易          │
│  ├─ 导入私钥     │  ├─ 查询代币余额 │  ├─ 签名交易          │
│  └─ 安全存储     │  └─ 余额变化监听 │  └─ 广播交易          │
└─────────────────────────────────────────────────────────────┘
```

## 技术依赖

```json
{
  "@mysten/sui": "^1.x.x"
}
```

## 接口设计

### 类型定义

```typescript
// 钱包配置
interface WalletConfig {
  // 私钥来源：'generate' 自动生成 | 'import' 从环境变量导入
  keySource: 'generate' | 'import';
  // 网络：testnet | mainnet | devnet
  network: 'testnet' | 'mainnet' | 'devnet';
  // 私钥存储路径（可选）
  keyStorePath?: string;
}

// 余额信息
interface BalanceInfo {
  // SUI 余额（单位：MIST，1 SUI = 10^9 MIST）
  sui: bigint;
  // 格式化后的 SUI 余额
  suiFormatted: string;
  // 最后更新时间
  updatedAt: Date;
}

// 交易结果
interface TransactionResult {
  // 交易摘要
  digest: string;
  // 是否成功
  success: boolean;
  // Gas 消耗
  gasUsed: bigint;
  // 错误信息（如果失败）
  error?: string;
}
```

### 核心方法

```typescript
class WalletManager {
  /**
   * 初始化钱包
   * - 如果配置为 'generate'，创建新密钥对
   * - 如果配置为 'import'，从 PRIVATE_KEY 环境变量读取
   */
  async initialize(config: WalletConfig): Promise<void>;

  /**
   * 获取钱包地址
   * @returns Sui 地址（0x 开头的 64 字符十六进制）
   */
  getAddress(): string;

  /**
   * 获取当前余额
   * @returns 余额信息
   */
  async getBalance(): Promise<BalanceInfo>;

  /**
   * 签名并发送交易
   * @param transaction 构建好的交易对象
   * @returns 交易结果
   */
  async signAndExecute(transaction: Transaction): Promise<TransactionResult>;

  /**
   * 转账 SUI
   * @param to 接收地址
   * @param amount 金额（单位：SUI）
   * @returns 交易结果
   */
  async transferSui(to: string, amount: number): Promise<TransactionResult>;

  /**
   * 导出钱包信息（用于调试/恢复）
   * @returns 地址和公钥（不含私钥）
   */
  exportPublicInfo(): { address: string; publicKey: string };
}
```

## 实现细节

### 1. 密钥生成与存储

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import * as fs from 'fs';
import * as path from 'path';

class WalletManager {
  private keypair: Ed25519Keypair | null = null;
  private client: SuiClient | null = null;
  private config: WalletConfig | null = null;

  async initialize(config: WalletConfig): Promise<void> {
    this.config = config;
    
    // 初始化 Sui Client
    this.client = new SuiClient({ 
      url: getFullnodeUrl(config.network) 
    });

    // 根据配置获取或生成密钥
    if (config.keySource === 'import') {
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('PRIVATE_KEY environment variable not set');
      }
      // 从 Base64 或 Hex 导入
      this.keypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(privateKey, 'base64')
      );
    } else {
      // 生成新密钥对
      this.keypair = new Ed25519Keypair();
      
      // 可选：保存到文件
      if (config.keyStorePath) {
        this.saveKeyToFile(config.keyStorePath);
      }
    }

    console.log(`✓ Wallet initialized: ${this.getAddress()}`);
  }

  private saveKeyToFile(filePath: string): void {
    const data = {
      address: this.getAddress(),
      publicKey: this.keypair!.getPublicKey().toBase64(),
      // 警告：实际生产环境应加密存储
      privateKey: Buffer.from(this.keypair!.getSecretKey()).toString('base64'),
      createdAt: new Date().toISOString()
    };
    
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
```

### 2. 余额查询

```typescript
async getBalance(): Promise<BalanceInfo> {
  if (!this.client || !this.keypair) {
    throw new Error('Wallet not initialized');
  }

  const address = this.getAddress();
  const balance = await this.client.getBalance({
    owner: address,
    coinType: '0x2::sui::SUI'
  });

  const suiBalance = BigInt(balance.totalBalance);
  
  return {
    sui: suiBalance,
    suiFormatted: this.formatSui(suiBalance),
    updatedAt: new Date()
  };
}

private formatSui(mist: bigint): string {
  // 1 SUI = 10^9 MIST
  const sui = Number(mist) / 1_000_000_000;
  return sui.toFixed(4) + ' SUI';
}
```

### 3. 交易签名与发送

```typescript
async signAndExecute(transaction: Transaction): Promise<TransactionResult> {
  if (!this.client || !this.keypair) {
    throw new Error('Wallet not initialized');
  }

  try {
    const result = await this.client.signAndExecuteTransaction({
      transaction,
      signer: this.keypair,
      options: {
        showEffects: true,
        showEvents: true
      }
    });

    const success = result.effects?.status?.status === 'success';
    const gasUsed = BigInt(
      result.effects?.gasUsed?.computationCost || 0
    ) + BigInt(
      result.effects?.gasUsed?.storageCost || 0
    );

    return {
      digest: result.digest,
      success,
      gasUsed,
      error: success ? undefined : result.effects?.status?.error
    };
  } catch (error) {
    return {
      digest: '',
      success: false,
      gasUsed: 0n,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
```

## 安全考虑

| 风险 | 缓解措施 |
|------|----------|
| 私钥泄露 | 使用环境变量，不硬编码；文件存储时加密 |
| 交易重放 | Sui 原生防重放（nonce机制） |
| 余额不足 | 每次操作前检查余额，设置最小保留额 |
| 网络错误 | 重试机制 + 超时处理 |

## 单元测试要点

```typescript
describe('WalletManager', () => {
  it('should generate new keypair', async () => {
    const wallet = new WalletManager();
    await wallet.initialize({ keySource: 'generate', network: 'testnet' });
    expect(wallet.getAddress()).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should query balance', async () => {
    const wallet = new WalletManager();
    await wallet.initialize({ keySource: 'generate', network: 'testnet' });
    const balance = await wallet.getBalance();
    expect(balance.sui).toBeGreaterThanOrEqual(0n);
  });

  it('should format SUI correctly', () => {
    // 1 SUI = 1_000_000_000 MIST
    const formatted = wallet['formatSui'](1_500_000_000n);
    expect(formatted).toBe('1.5000 SUI');
  });
});
```

## 与其他模块的关系

```
                    ┌─────────────────┐
                    │  WalletManager  │
                    └────────┬────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
   ┌──────────┐       ┌──────────┐       ┌──────────┐
   │  Earner  │       │ Spender  │       │  Ledger  │
   │  (查余额) │       │ (签交易) │       │ (查余额) │
   └──────────┘       └──────────┘       └──────────┘
```

## 开发优先级

1. **P0 必须**: `initialize()`, `getAddress()`, `getBalance()`
2. **P0 必须**: `signAndExecute()`
3. **P1 重要**: `transferSui()`
4. **P2 可选**: 密钥文件加密存储

## 预计开发时间

| 任务 | 时间 |
|------|------|
| 基础框架 + 密钥生成 | 2小时 |
| 余额查询 | 1小时 |
| 交易签名 | 2小时 |
| 单元测试 | 2小时 |
| **总计** | **7小时** |
