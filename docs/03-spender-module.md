# 模块三：支出引擎 (Spender)

> **v2 — 基于 00-redesign-proposal.md 重构**
> 核心变更：移除 `encryptData()` 的 `sleep(200)` 假加密；改用真实 `@mysten/seal` SDK + Walrus 存储，保护真实用户数据。

## 概述

Spender 是 Agent 的"安全支出引擎"。它使用赚取的 SUI 来购买加密和存储服务——用 **Seal** 对敏感用户数据进行链上策略加密，再用 **Walrus** 将密文上传到去中心化存储。

**这是真正的"有意义的支出"，不是模拟延迟假装加密。**

## 核心变更

| 项目 | 旧方案 (v1) | 新方案 (v2) |
|------|-------------|-------------|
| 加密实现 | 🚨 `await sleep(200)` 假装加密 | ✅ 真实 `@mysten/seal` SDK |
| 密文大小 | 🚨 与明文相同（伪造） | ✅ 密文 > 明文（真实加密开销） |
| 策略管理 | 无 | ✅ Allowlist 链上策略 |
| 保护对象 | "日志"（无价值） | ✅ 真实用户数据（SSH 密钥、Git 配置） |
| 存储 | 无真实存储 | ✅ Walrus 去中心化存储 |
| 存储证明 | 无 | ✅ blobId + 交易验证 |

## 技术依赖

```json
{
  "@mysten/seal": "^0.x.x",
  "@mysten/walrus": "^1.x.x",
  "@mysten/sui": "^1.x.x"
}
```

## 接口设计

### 类型定义

```typescript
// 加密结果
interface EncryptResult {
  // 加密后的密文（Uint8Array）
  ciphertext: Uint8Array;
  // 明文大小（字节）
  plaintextSize: number;
  // 密文大小（字节）
  ciphertextSize: number;
  // 大小膨胀率（必须 > 1.0，否则说明加密失败）
  sizeRatio: number;
  // Seal 策略 ID（链上）
  sealPolicyId: string;
  // 耗时
  duration: number;
}

// Walrus 上传结果
interface UploadResult {
  // Walrus blob ID
  blobId: string;
  // 上传交易摘要
  txDigest: string;
  // 上传大小（字节）
  size: number;
  // 存储有效期
  epochs: number;
  // Sui Explorer 链接
  explorerUrl: string;
  // 耗时
  duration: number;
}

// 保护数据结果（一次完整的 Seal + Walrus 流程）
interface ProtectionResult {
  // 数据标签（如 "ssh-keys", "git-config"）
  label: string;
  // 加密结果
  encryption: EncryptResult;
  // 上传结果
  upload: UploadResult;
  // 总花费（MIST）
  gasSpent: bigint;
  // 是否成功
  success: boolean;
  // 错误信息
  error?: string;
}

// 支出周期结果
interface SpendResult {
  // 本轮保护的数据项数
  itemsProtected: number;
  // 总花费
  totalGasSpent: bigint;
  // 各数据项的保护结果
  protections: ProtectionResult[];
  // 时间戳
  timestamp: Date;
}

// Seal 策略配置
interface SealPolicyConfig {
  // 策略包 ID
  packageId: string;
  // 允许解密的地址列表
  allowedAddresses: string[];
  // 最小签名阈值
  threshold: number;
}
```

### 核心方法

```typescript
class Spender {
  /**
   * 初始化 Spender
   */
  constructor(wallet: WalletManager, config: SpenderConfig);

  /**
   * 执行一个完整的支出周期
   * 1. 收集需保护的用户数据
   * 2. 创建 Seal Allowlist 策略
   * 3. 加密数据
   * 4. 上传到 Walrus
   * 5. 返回保护结果
   */
  async spend(): Promise<SpendResult>;

  /**
   * 用 Seal SDK 加密数据
   * ❌ 不再 sleep(200) 模拟
   * ✅ 真实 SealClient.encrypt()
   */
  async encryptData(
    plaintext: Uint8Array,
    policyId: string
  ): Promise<EncryptResult>;

  /**
   * 上传密文到 Walrus
   */
  async uploadToWalrus(ciphertext: Uint8Array): Promise<UploadResult>;

  /**
   * 创建 Seal Allowlist 链上策略
   */
  async createSealPolicy(config: SealPolicyConfig): Promise<string>;

  /**
   * 保护一项用户数据（加密 + 上传）
   */
  async protectUserData(
    label: string,
    data: Uint8Array
  ): Promise<ProtectionResult>;

  /**
   * 收集需要保护的真实用户数据
   * 保护对象：SSH 密钥、Git 配置、审计日志
   */
  async collectSensitiveData(): Promise<Map<string, Uint8Array>>;
}
```

## 实现细节

### 1. Seal 客户端初始化

```typescript
import { SealClient, getAllowlistKeyServers } from '@mysten/seal';
import { WalrusClient } from '@mysten/walrus';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';

class Spender {
  private wallet: WalletManager;
  private client: SuiClient;
  private sealClient: SealClient;
  private walrusClient: WalrusClient;
  private sealPackageId: string;


  constructor(wallet: WalletManager, config: SpenderConfig) {
    this.wallet = wallet;
    this.client = new SuiClient({ url: getFullnodeUrl(config.network) });
    this.sealPackageId = config.sealPackageId;

    // ✅ 真实 SealClient 初始化
    this.sealClient = new SealClient({
      suiClient: this.client,
      serverObjectIds: getAllowlistKeyServers('testnet'),
      verifyKeyServers: false   // Testnet 可以跳过验证
    });

    // ✅ 真实 WalrusClient 初始化
    this.walrusClient = new WalrusClient({
      network: 'testnet'
    });
  }
}
```

### 2. 创建 Seal Allowlist 策略

```typescript
/**
 * 在链上创建 Allowlist 策略
 * - 定义谁可以解密数据
 * - 策略 ID 将用于加密时的身份绑定
 */
async createSealPolicy(config: SealPolicyConfig): Promise<string> {
  console.log('🔐 Creating Seal Allowlist policy on-chain...');

  const tx = new Transaction();

  // 创建 Allowlist
  const allowlist = tx.moveCall({
    target: `${config.packageId}::allowlist::create`,
    arguments: []
  });

  // 添加允许解密的地址
  for (const addr of config.allowedAddresses) {
    tx.moveCall({
      target: `${config.packageId}::allowlist::add`,
      arguments: [
        allowlist,
        tx.pure.address(addr)
      ]
    });
  }

  // 发送交易
  const result = await this.wallet.signAndExecute(tx);

  if (!result.success) {
    throw new Error(`Failed to create Seal policy: ${result.error}`);
  }

  // 从交易事件中提取 Allowlist 对象 ID
  const createdObjects = await this.client.getTransactionBlock({
    digest: result.digest,
    options: { showObjectChanges: true }
  });

  const policyObject = createdObjects.objectChanges?.find(
    (change: any) => change.type === 'created'
  );

  const policyId = (policyObject as any)?.objectId || '';
  console.log(`  ✓ Policy created: ${policyId}`);
  console.log(`  Explorer: ${result.explorerUrl}`);

  return policyId;
}
```

### 3. 真实加密（核心改动）

```typescript
/**
 * ✅ 使用真实 Seal SDK 加密数据
 * ❌ 旧版：await sleep(200); return { encrypted: data }; — 完全伪造
 */
async encryptData(
  plaintext: Uint8Array,
  policyId: string
): Promise<EncryptResult> {
  console.log(`🔒 Encrypting ${plaintext.length} bytes with Seal...`);

  const startTime = Date.now();

  // ✅ 真实加密 — 使用 SealClient.encrypt()
  const { encryptedObject: ciphertext } = await this.sealClient.encrypt({
    threshold: 2,                              // 至少 2 个密钥服务器参与
    packageId: this.sealPackageId,             // Seal 包 ID
    id: policyId,                              // Allowlist 策略 ID
    data: plaintext                            // 明文数据
  });

  const duration = Date.now() - startTime;
  const sizeRatio = ciphertext.length / plaintext.length;

  // ✅ 关键验证：密文必须大于明文（加密一定有开销）
  if (ciphertext.length <= plaintext.length) {
    console.warn('⚠️ WARNING: Ciphertext is not larger than plaintext!');
    console.warn('   This may indicate encryption is not working correctly.');
  }

  console.log(`  ✓ Encrypted: ${plaintext.length} → ${ciphertext.length} bytes`);
  console.log(`  Size ratio: ${sizeRatio.toFixed(2)}x`);
  console.log(`  Duration: ${duration}ms`);

  return {
    ciphertext,
    plaintextSize: plaintext.length,
    ciphertextSize: ciphertext.length,
    sizeRatio,
    sealPolicyId: policyId,
    duration
  };
}
```

### 4. 上传到 Walrus

```typescript
/**
 * 将加密后的密文上传到 Walrus 去中心化存储
 * 返回 blobId 作为存储证明
 */
async uploadToWalrus(ciphertext: Uint8Array): Promise<UploadResult> {
  console.log(`📤 Uploading ${ciphertext.length} bytes to Walrus...`);

  const startTime = Date.now();

  // ✅ 真实 Walrus 上传
  const result = await this.walrusClient.writeBlob({
    blob: ciphertext,
    deletable: true,
    epochs: 3,                                  // 存储 3 个 epoch
    signer: this.wallet.getKeypair()            // 使用 WalletManager 的 keypair 签名
  });

  const blobId = result.blobId;
  const duration = Date.now() - startTime;

  console.log(`  ✓ Uploaded: blobId = ${blobId}`);
  console.log(`  Duration: ${duration}ms`);

  return {
    blobId,
    txDigest: result.txDigest || '',
    size: ciphertext.length,
    epochs: 3,
    explorerUrl: `https://suiscan.xyz/testnet/tx/${result.txDigest || ''}`,
    duration
  };
}
```

### 5. 保护用户数据（一次完整流程）

```typescript
/**
 * 保护一项用户数据 = 创建策略 + Seal 加密 + Walrus 上传
 */
async protectUserData(
  label: string,
  data: Uint8Array
): Promise<ProtectionResult> {
  console.log(`\n🛡️ Protecting "${label}" (${data.length} bytes)...`);

  const startTime = Date.now();
  let gasStart = (await this.wallet.getBalance()).sui;

  try {
    // Step 1: 创建 Seal 策略（仅 Agent 自己可解密）
    const policyId = await this.createSealPolicy({
      packageId: this.sealPackageId,
      allowedAddresses: [this.wallet.getAddress()],
      threshold: 2
    });

    // Step 2: Seal 加密
    const encryption = await this.encryptData(data, policyId);

    // Step 3: Walrus 上传
    const upload = await this.uploadToWalrus(encryption.ciphertext);

    // 计算 Gas 花费
    let gasEnd = (await this.wallet.getBalance()).sui;
    const gasSpent = gasStart - gasEnd;

    console.log(`  ✓ "${label}" protected successfully`);
    console.log(`  Gas spent: ${Number(gasSpent) / 1e9} SUI`);

    return {
      label,
      encryption,
      upload,
      gasSpent,
      success: true
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ Failed to protect "${label}": ${errMsg}`);

    let gasEnd = (await this.wallet.getBalance()).sui;

    return {
      label,
      encryption: {} as EncryptResult,
      upload: {} as UploadResult,
      gasSpent: gasStart - gasEnd,
      success: false,
      error: errMsg
    };
  }
}
```

### 6. 收集真实用户数据

```typescript
/**
 * 收集需要保护的真实用户数据
 * ✅ 保护有价值的数据，不是无意义的"日志"
 */
async collectSensitiveData(): Promise<Map<string, Uint8Array>> {
  const data = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  // 1. SSH 公钥（如果存在）
  try {
    const sshPubKey = await this.readFileViaOpenClaw('~/.ssh/id_ed25519.pub');
    if (sshPubKey) {
      data.set('ssh-public-key', encoder.encode(sshPubKey));
      console.log('  Found: SSH public key');
    }
  } catch { /* 文件不存在，跳过 */ }

  // 2. Git 全局配置
  try {
    const gitConfig = await this.readFileViaOpenClaw('~/.gitconfig');
    if (gitConfig) {
      data.set('git-config', encoder.encode(gitConfig));
      console.log('  Found: Git config');
    }
  } catch { /* 跳过 */ }

  // 3. 审计日志（如果 Ledger 已生成）
  try {
    const auditLog = await this.readFileViaOpenClaw('./audit-log.json');
    if (auditLog) {
      data.set('audit-log', encoder.encode(auditLog));
      console.log('  Found: Audit log');
    }
  } catch { /* 跳过 */ }

  console.log(`  Total items to protect: ${data.size}`);
  return data;
}

/**
 * 通过 OpenClaw Exec Tool 读取文件
 * ❌ 不直接使用 fs.readFileSync
 * ✅ 通过 Gateway 沙箱访问
 */
private async readFileViaOpenClaw(path: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:18789/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
    },
    body: JSON.stringify({
      method: 'exec',
      params: {
        command: `cat ${path}`,
        host: 'gateway',
        timeout: 5
      }
    })
  });
  const result = await response.json();
  return result.output || '';
}
```

### 7. 完整支出周期

```typescript
/**
 * 执行一个完整的支出周期
 * Agent 的 runCycle() 会调用此方法
 */
async spend(): Promise<SpendResult> {
  console.log('\n═══════════════════════════════════════');
  console.log('  💸 Spender: Starting spend cycle');
  console.log('═══════════════════════════════════════\n');

  const protections: ProtectionResult[] = [];
  let totalGasSpent = 0n;

  // Step 1: 收集需保护的数据
  console.log('📂 Collecting sensitive data...');
  const sensitiveData = await this.collectSensitiveData();

  if (sensitiveData.size === 0) {
    console.log('⚠️ No sensitive data found to protect.');
    return {
      itemsProtected: 0,
      totalGasSpent: 0n,
      protections: [],
      timestamp: new Date()
    };
  }

  // Step 2: 逐项保护
  for (const [label, data] of sensitiveData) {
    const result = await this.protectUserData(label, data);
    protections.push(result);
    totalGasSpent += result.gasSpent;
  }

  const successCount = protections.filter(p => p.success).length;

  console.log(`\n📊 Spend cycle summary:`);
  console.log(`  Items protected: ${successCount}/${protections.length}`);
  console.log(`  Total gas spent: ${Number(totalGasSpent) / 1e9} SUI`);

  return {
    itemsProtected: successCount,
    totalGasSpent,
    protections,
    timestamp: new Date()
  };
}
```

## 完整流程图

```
┌────────────────────────────────────────────────────────────────┐
│                   Spender.spend() 完整流程                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌───────────────────┐      ┌──────────────────────┐          │
│  │ 1. 收集用户数据     │──→   │ 2. 创建 Seal 策略     │          │
│  │  SSH/Git/AuditLog  │      │  Allowlist on-chain   │          │
│  └───────────────────┘      └──────────┬───────────┘          │
│                                        │                       │
│                             ┌──────────▼───────────┐          │
│                             │ 3. Seal 加密           │          │
│                             │  sealClient.encrypt() │          │
│                             │  密文 > 明文 ✓        │          │
│                             └──────────┬───────────┘          │
│                                        │                       │
│                             ┌──────────▼───────────┐          │
│                             │ 4. Walrus 上传         │          │
│                             │  walrus.writeBlob()   │          │
│                             │  → blobId             │          │
│                             └──────────┬───────────┘          │
│                                        │                       │
│                             ┌──────────▼───────────┐          │
│                             │ 5. 返回 SpendResult    │          │
│                             │  含 policyId + blobId │          │
│                             │  含 Gas 消耗统计       │          │
│                             └──────────────────────┘          │
└────────────────────────────────────────────────────────────────┘
```

## 与 v1 的关键差异

```typescript
// ❌ 旧版 v1 — 100% 伪造
async encryptData(data: Buffer): Promise<{ encrypted: Buffer }> {
  await sleep(200);                    // 假装加密在进行
  return { encrypted: data };          // 返回原始数据！密文 === 明文
}

// ✅ 新版 v2 — 真实加密
async encryptData(plaintext: Uint8Array, policyId: string): Promise<EncryptResult> {
  const { encryptedObject: ciphertext } = await this.sealClient.encrypt({
    threshold: 2,
    packageId: this.sealPackageId,
    id: policyId,
    data: plaintext
  });
  // ciphertext.length > plaintext.length — 真实加密的必然结果
  return { ciphertext, ciphertextSize: ciphertext.length, sizeRatio: ... };
}
```

## 安全设计

| 方面 | 说明 |
|------|------|
| 加密算法 | Seal 使用阈值加密（2-of-N 密钥服务器） |
| 策略控制 | Allowlist 链上策略，仅指定地址可解密 |
| 存储持久性 | Walrus 去中心化存储，3 epoch 存活期 |
| 访问控制 | 只有 Agent 地址在 Allowlist 中 |
| 数据选择 | 仅保护有价值的用户数据（SSH、Git 等） |

## 单元测试要点

```typescript
describe('Spender v2', () => {
  it('should encrypt with real Seal SDK', async () => {
    const plaintext = new TextEncoder().encode('test data');
    const result = await spender.encryptData(plaintext, testPolicyId);
    // 密文必须大于明文
    expect(result.ciphertextSize).toBeGreaterThan(result.plaintextSize);
    expect(result.sizeRatio).toBeGreaterThan(1.0);
  });

  it('should upload to Walrus and return blobId', async () => {
    const result = await spender.uploadToWalrus(testCiphertext);
    expect(result.blobId).toBeTruthy();
    expect(result.epochs).toBe(3);
  });

  it('should create Seal policy on-chain', async () => {
    const policyId = await spender.createSealPolicy({
      packageId: testPackageId,
      allowedAddresses: [agentAddress],
      threshold: 2
    });
    expect(policyId).toMatch(/^0x[a-f0-9]+$/);
  });

  it('should NOT have sleep-based fake encryption', () => {
    const source = readFileSync('src/spender.ts', 'utf-8');
    expect(source).not.toContain('sleep(200)');
    expect(source).not.toContain('return { encrypted: data }');
  });

  it('should protect SSH keys', async () => {
    const result = await spender.protectUserData(
      'ssh-key',
      new TextEncoder().encode('ssh-ed25519 AAAA...')
    );
    expect(result.success).toBe(true);
    expect(result.encryption.sealPolicyId).toBeTruthy();
    expect(result.upload.blobId).toBeTruthy();
  });
});
```

## 与其他模块的关系

```
┌──────────────────────────────────────────────────────────┐
│                    Agent (Cron 触发)                      │
│                         │                                │
│                    ┌────▼────┐                           │
│                    │ Spender │ ◄── 本模块                │
│                    └────┬────┘                           │
│                         │                                │
│         ┌───────────────┼───────────────┐                │
│         ▼               ▼               ▼                │
│   WalletManager     Seal SDK        Walrus SDK           │
│   (签名+付费)      (加密数据)       (存储密文)            │
│                        │               │                 │
│                   Seal Key          blob 存储             │
│                   Servers           节点网络              │
│                        │               │                 │
│                  ┌─────▼───────────────▼──┐              │
│                  │    Sui Testnet          │              │
│                  │  Allowlist 策略 + Walrus TX │          │
│                  └────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

## 开发优先级

1. **P0 必须**: SealClient 初始化 + `encryptData()`
2. **P0 必须**: WalrusClient 初始化 + `uploadToWalrus()`
3. **P0 必须**: `createSealPolicy()` — Allowlist 链上策略创建
4. **P1 重要**: `protectUserData()` — 完整保护流程
5. **P1 重要**: `collectSensitiveData()` — 真实数据收集
6. **P2 可选**: 解密验证流程

## 预计开发时间

| 任务 | 时间 |
|------|------|
| SealClient + WalrusClient 初始化 | 2 小时 |
| Allowlist 策略创建 | 2 小时 |
| `encryptData()` 真实加密 | 3 小时 |
| `uploadToWalrus()` 上传 | 2 小时 |
| `collectSensitiveData()` + 数据收集 | 2 小时 |
| `spend()` 编排 | 2 小时 |
| 单元测试 | 2 小时 |
| **总计** | **15 小时** |
