# 模块一：钱包管理 (WalletManager)

> **v2 — 基于 00-redesign-proposal.md 重构**
> 核心变更：移除明文私钥存储，改用 OS 密钥库 / 环境变量注入；与 OpenClaw Skill 配置集成。

## 概述

WalletManager 是 Agent 的"银行账户"模块，负责密钥的安全管理、余额查询和交易签名。它是整个经济系统的基础设施层，同时也是安全审计的第一道防线。

## 核心职责

```
┌─────────────────────────────────────────────────────────────┐
│                     WalletManager v2                        │
├─────────────────────────────────────────────────────────────┤
│  安全密钥管理      │  余额查询        │  交易签名           │
│  ├─ 环境变量注入   │  ├─ 查询SUI余额  │  ├─ 构建交易        │
│  ├─ OS密钥库存储   │  ├─ Explorer链接 │  ├─ 签名交易        │
│  ├─ DPAPI/Keychain │  └─ 余额变化监听 │  └─ 广播交易        │
│  └─ ❌ 不再明文    │                  │                     │
└─────────────────────────────────────────────────────────────┘
```

## 与旧版差异

| 项目 | 旧方案 (v1) | 新方案 (v2) |
|------|-------------|-------------|
| 私钥存储 | `saveKeyToFile()` 明文 JSON | OS 密钥库加密 + 环境变量注入 |
| 初始化 | 代码内 `new Ed25519Keypair()` | 优先 `SUI_PRIVATE_KEY` 环境变量 |
| 地址展示 | `console.log` | 含 Sui Explorer 链接 |
| 安全等级 | 🚨 高危（明文私钥） | ✅ 生产级（加密存储 + 注入） |

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
  // 私钥来源：'env' 从环境变量读取（推荐） | 'generate' 自动生成并安全存储
  keySource: 'env' | 'generate';
  // 网络：testnet | mainnet | devnet
  network: 'testnet' | 'mainnet' | 'devnet';
  // BountyBoard 合约 Package ID
  bountyPackageId: string;
  // BountyBoard 共享对象 ID
  bountyBoardId: string;
}

// 余额信息
interface BalanceInfo {
  // SUI 余额（单位：MIST，1 SUI = 10^9 MIST）
  sui: bigint;
  // 格式化后的 SUI 余额
  suiFormatted: string;
  // Sui Explorer 链接
  explorerUrl: string;
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
  // Sui Explorer 交易链接
  explorerUrl: string;
  // 错误信息（如果失败）
  error?: string;
}
```

### 核心方法

```typescript
class WalletManager {
  /**
   * 初始化钱包
   * - 优先从 SUI_PRIVATE_KEY 环境变量读取（OpenClaw skills.entries.*.env 注入）
   * - 如果配置为 'generate'，创建新密钥对并安全存储
   * - ❌ 不再支持明文文件存储
   */
  async initialize(config: WalletConfig): Promise<void>;

  /**
   * 获取钱包地址
   * @returns Sui 地址（0x 开头的 64 字符十六进制）
   */
  getAddress(): string;

  /**
   * 获取 Sui Explorer 链接
   */
  getExplorerUrl(): string;

  /**
   * 获取当前余额（含 Explorer 链接）
   */
  async getBalance(): Promise<BalanceInfo>;

  /**
   * 获取 keypair（供 Walrus 签名使用）
   */
  getKeypair(): Ed25519Keypair;

  /**
   * 签名并发送交易
   */
  async signAndExecute(transaction: Transaction): Promise<TransactionResult>;

  /**
   * 转账 SUI
   */
  async transferSui(to: string, amount: number): Promise<TransactionResult>;

  /**
   * 导出公开信息（不含私钥）
   */
  exportPublicInfo(): { address: string; publicKey: string; explorerUrl: string };

  /**
   * 安全存储密钥到 OS 密钥库（通过 OpenClaw exec tool 执行）
   * Windows: DPAPI | macOS: Keychain | Linux: libsecret
   */
  private async storeKeySecurely(): Promise<void>;
}
```

## 实现细节

### 1. 安全密钥初始化（核心改动）

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

class WalletManager {
  private keypair: Ed25519Keypair | null = null;
  private client: SuiClient | null = null;
  private config: WalletConfig | null = null;
  private openclawBaseUrl = 'http://127.0.0.1:18789';

  async initialize(config: WalletConfig): Promise<void> {
    this.config = config;

    // 初始化 Sui Client
    this.client = new SuiClient({
      url: getFullnodeUrl(config.network)
    });

    // ✅ 新方案：优先从环境变量读取（OpenClaw 通过 skills.entries.*.env 注入）
    const privateKey = process.env.SUI_PRIVATE_KEY;

    if (privateKey) {
      // 从环境变量导入（最安全的方式—密钥不落盘）
      this.keypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(privateKey, 'base64')
      );
      console.log('✓ Wallet loaded from environment variable');
    } else if (config.keySource === 'generate') {
      // 生成新密钥对并安全存储
      this.keypair = new Ed25519Keypair();
      await this.storeKeySecurely();
      console.log('✓ New wallet generated and stored securely');
    } else {
      throw new Error(
        'No wallet found. Set SUI_PRIVATE_KEY env var or use keySource: "generate"'
      );
    }

    const address = this.getAddress();
    const explorerUrl = this.getExplorerUrl();
    console.log(`✓ Wallet initialized: ${address}`);
    console.log(`  Explorer: ${explorerUrl}`);
  }

  // ❌ 旧版 saveKeyToFile() 已删除 — 不再明文存储私钥
  // ✅ 新版使用 OS 级加密存储
  private async storeKeySecurely(): Promise<void> {
    const key = Buffer.from(this.keypair!.getSecretKey()).toString('base64');

    if (process.platform === 'win32') {
      // Windows: 使用 DPAPI 加密存储
      // 通过 OpenClaw exec tool 执行 PowerShell 命令
      const command = `
        Add-Type -AssemblyName System.Security;
        $bytes = [Convert]::FromBase64String('${key}');
        $encrypted = [Security.Cryptography.ProtectedData]::Protect(
          $bytes, $null, 'CurrentUser');
        $dir = Join-Path $env:USERPROFILE '.agent';
        if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force };
        [IO.File]::WriteAllBytes((Join-Path $dir 'wallet.enc'), $encrypted);
        Write-Output 'OK'
      `.trim();

      await this.execViaOpenClaw(command);
      console.log('  Key encrypted with DPAPI → ~/.agent/wallet.enc');

    } else if (process.platform === 'darwin') {
      // macOS: 使用 Keychain
      await this.execViaOpenClaw(
        `security add-generic-password -a "img-agent" -s "sui-private-key" -w "${key}" -U`
      );
      console.log('  Key stored in macOS Keychain');

    } else {
      // Linux: 使用 secret-tool (libsecret)
      await this.execViaOpenClaw(
        `echo "${key}" | secret-tool store --label="img-agent" service img-agent key sui`
      );
      console.log('  Key stored in Linux Keyring (libsecret)');
    }
  }

  /**
   * 通过 OpenClaw exec tool 执行命令（不直接 execa）
   */
  private async execViaOpenClaw(command: string): Promise<string> {
    const response = await fetch(`${this.openclawBaseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
      },
      body: JSON.stringify({
        method: 'exec',
        params: { command, host: 'gateway', timeout: 15 }
      })
    });
    const result = await response.json();
    return result.output || '';
  }
}
```

### 2. 余额查询（含 Explorer 链接）

```typescript
getAddress(): string {
  if (!this.keypair) throw new Error('Wallet not initialized');
  return this.keypair.getPublicKey().toSuiAddress();
}

getExplorerUrl(): string {
  const network = this.config?.network || 'testnet';
  return `https://suiscan.xyz/${network}/account/${this.getAddress()}`;
}

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
  const network = this.config?.network || 'testnet';

  return {
    sui: suiBalance,
    suiFormatted: this.formatSui(suiBalance),
    explorerUrl: `https://suiscan.xyz/${network}/account/${address}`,
    updatedAt: new Date()
  };
}

private formatSui(mist: bigint): string {
  const sui = Number(mist) / 1_000_000_000;
  return sui.toFixed(4) + ' SUI';
}
```

### 3. 交易签名与发送（含 Explorer 链接）

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

    const network = this.config?.network || 'testnet';

    return {
      digest: result.digest,
      success,
      gasUsed,
      explorerUrl: `https://suiscan.xyz/${network}/tx/${result.digest}`,
      error: success ? undefined : result.effects?.status?.error
    };
  } catch (error) {
    return {
      digest: '',
      success: false,
      gasUsed: 0n,
      explorerUrl: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

getKeypair(): Ed25519Keypair {
  if (!this.keypair) throw new Error('Wallet not initialized');
  return this.keypair;
}
```

### 4. OpenClaw 配置集成

密钥通过 OpenClaw `skills.entries.*.env` 安全注入到运行环境，不需要接触文件系统：

```json
// ~/.openclaw/openclaw.json
{
  "skills": {
    "entries": {
      "infinite-money-glitch": {
        "enabled": true,
        "env": {
          "SUI_PRIVATE_KEY": "<base64-encoded-key>",
          "SUI_NETWORK": "testnet",
          "BOUNTY_PACKAGE_ID": "0x...",
          "BOUNTY_BOARD_ID": "0x..."
        }
      }
    }
  }
}
```

OpenClaw 的环境注入机制确保：
- 密钥仅在 Agent 运行期间存在于进程内存
- Agent 运行结束后自动清除
- 密钥不会出现在日志、提示词或会话记录中

## 安全考虑

| 风险 | 旧方案 | 新方案 |
|------|--------|--------|
| 私钥泄露 | 🚨 明文 JSON 文件可被任何进程读取 | ✅ OS 密钥库加密 / 环境变量注入 |
| 进程内存泄露 | 无防护 | OpenClaw 运行结束后自动清除 env |
| 恶意 Agent 读文件 | 🚨 可直接读取 wallet.json | ✅ DPAPI 加密文件仅当前用户可解密 |
| 交易重放 | Sui 原生防重放（nonce机制） | 同左 |
| 余额不足 | 每次操作前检查 | 同左 + 最小保留额 |
| 网络错误 | 重试机制 | 同左 + 超时处理 |

## 单元测试要点

```typescript
describe('WalletManager v2', () => {
  it('should initialize from environment variable', async () => {
    process.env.SUI_PRIVATE_KEY = testKeyBase64;
    const wallet = new WalletManager();
    await wallet.initialize({ keySource: 'env', network: 'testnet', ... });
    expect(wallet.getAddress()).toMatch(/^0x[a-f0-9]{64}$/);
    delete process.env.SUI_PRIVATE_KEY;
  });

  it('should include explorer URL in balance', async () => {
    const balance = await wallet.getBalance();
    expect(balance.explorerUrl).toContain('suiscan.xyz/testnet/account/0x');
  });

  it('should include explorer URL in transaction result', async () => {
    const result = await wallet.signAndExecute(tx);
    expect(result.explorerUrl).toContain('suiscan.xyz/testnet/tx/');
  });

  it('should NOT have saveKeyToFile method', () => {
    expect((wallet as any).saveKeyToFile).toBeUndefined();
  });

  it('should reject initialization without key source', async () => {
    delete process.env.SUI_PRIVATE_KEY;
    const wallet = new WalletManager();
    await expect(
      wallet.initialize({ keySource: 'env', network: 'testnet', ... })
    ).rejects.toThrow(/SUI_PRIVATE_KEY/);
  });

  it('should format SUI correctly', () => {
    const formatted = wallet['formatSui'](1_500_000_000n);
    expect(formatted).toBe('1.5000 SUI');
  });
});
```

## 与其他模块的关系

```
                    ┌─────────────────────┐
                    │  WalletManager v2   │
                    │  (安全密钥管理)       │
                    └────────┬────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
    ▼                        ▼                        ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Earner     │     │   Spender    │     │   Ledger     │
│ (查余额      │     │ (签交易      │     │ (查余额      │
│  签BountyTX) │     │  付Walrus)   │     │  生成报表)   │
└──────────────┘     └──────────────┘     └──────────────┘
        │                    │
        ▼                    ▼
┌──────────────┐     ┌──────────────┐
│ BountyBoard  │     │ Seal + Walrus│
│ (Move 合约)   │     │ (加密+存储)  │
└──────────────┘     └──────────────┘
```

## 开发优先级

1. **P0 必须**: `initialize()` 从环境变量加载, `getAddress()`, `getBalance()`
2. **P0 必须**: `signAndExecute()`, `getKeypair()` — Earner/Spender 依赖
3. **P1 重要**: `storeKeySecurely()` — OS 密钥库加密存储
4. **P1 重要**: Explorer URL 集成
5. **P2 可选**: 从 OS 密钥库恢复密钥的反向流程

## 预计开发时间

| 任务 | 时间 |
|------|------|
| 环境变量初始化 | 1 小时 |
| 余额 + Explorer 集成 | 1 小时 |
| 交易签名 | 2 小时 |
| OS 密钥库存储（DPAPI/Keychain/libsecret） | 3 小时 |
| 单元测试 | 2 小时 |
| **总计** | **9 小时** |
