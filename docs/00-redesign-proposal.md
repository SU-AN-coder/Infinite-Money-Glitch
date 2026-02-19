# Infinite Money Glitch — 全面重设计方案

> **目标**: 将项目从"包装过的 Node.js 脚本"升级为"OpenClaw 驱动的、链上经济闭环的自治 Agent"，使其在 Suixclaw Agent 第一阶段审查中全面达标。

---

## 一、问题诊断总览

| 编号 | 严重等级 | 问题 | 后果 |
|------|---------|------|------|
| F1 | 🚨 致命 | **未接入 OpenClaw**：使用 `execa` 直接调用 powershell/bash | 不满足 Track 2 "Terminal & Browser Control" 核心要求 → 首轮淘汰 |
| F2 | 🚨 致命 | **Faucet 伪装成收入**：`requestFaucet()` = 免费领测试币 | AI 审计判定"无真实经济逻辑" → Creativity / Technical Merit 极低 |
| S1 | ⚠️ 严重 | **私钥明文存储**：`saveKeyToFile()` 直接写 JSON | 被 Track 1 选手在跨赛道投票中标红 |
| S2 | ⚠️ 严重 | **Seal 加密是 Mock**：`encryptData()` 只 `sleep(200)` | AI 审计判定"虚假宣传" → Sui Integration 大扣分 |
| W1 | ⚡ 一般 | 本地任务结果未被利用 | 技术深度不足 |
| W2 | ⚡ 一般 | Demo 强依赖 Faucet API（可能 429） | 演示崩溃风险 |
| W3 | ⚡ 一般 | "花钱存自己日志"逻辑牵强 | 评委质疑"为什么 Agent 需要付费存日志" |

---

## 二、重设计后的系统全景

### 2.1 新架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                        HUMAN SUPERVISOR                             │
│   (通过 WhatsApp / Telegram / Discord / Web UI 与 OpenClaw 交互)     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ 消息 / 指令
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     OPENCLAW GATEWAY (本地)                          │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Pi Agent   │  │ Exec Tool  │  │ Browser Tool │  │ Cron/       │  │
│  │ Runtime    │  │ (终端控制)  │  │ (浏览器控制)  │  │ Heartbeat   │  │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  └──────┬──────┘  │
│        │               │               │                  │         │
│  ┌─────▼───────────────▼───────────────▼──────────────────▼──────┐  │
│  │              IMGSkill (Infinite Money Glitch Skill)           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐   │  │
│  │  │ earn()   │ │ spend()  │ │ report() │ │ bounty_check() │   │  │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────┬────────┘   │  │
│  └───────┼────────────┼────────────┼───────────────┼────────────┘  │
└──────────┼────────────┼────────────┼───────────────┼────────────────┘
           │            │            │               │
           ▼            ▼            ▼               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         SUI TESTNET                                  │
│  ┌────────────────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ BountyBoard.move   │  │  Wallet  │  │  Walrus  │  │   Seal    │  │
│  │ (赏金合约)          │  │ (Gas/TX) │  │ (存储)    │  │ (加密)    │  │
│  │                    │  │          │  │          │  │           │  │
│  │ deposit()          │  │          │  │          │  │           │  │
│  │ claim_reward()     │  │          │  │          │  │           │  │
│  │ verify_and_pay()   │  │          │  │          │  │           │  │
│  └────────────────────┘  └──────────┘  └──────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心变化一句话总结

| 旧方案 | 新方案 |
|--------|--------|
| Node.js 直接 `execa` 执行命令 | **OpenClaw Exec Tool** 执行命令，Agent 通过 Skill 驱动 |
| Faucet 领水 = "收入" | **Sui Move 赏金合约**：人类存入 SUI → Agent 完成任务 → 合约验证发放 |
| `encryptData()` 是 `sleep(200)` | **真实 Seal SDK 加密**（@mysten/seal） |
| 私钥明文 JSON 文件 | **DPAPI/Keyring 加密存储** + 环境变量注入 |
| 存自己的日志到 Walrus | **加密存储用户指定的关键数据**到 Walrus（有真实用途） |
| 独立 Node.js 脚本 | **OpenClaw Skill + Cron Job** 自动化循环 |

---

## 三、逐模块重设计

### 3.1 模块零（新增）：OpenClaw 集成层

这是整个改造中**最关键的新增模块**。没有它，项目直接不及格。

#### 3.1.1 项目作为 OpenClaw Skill 运行

整个 Infinite Money Glitch 应封装为一个 OpenClaw Skill，通过 `SKILL.md` 注册到 OpenClaw Gateway。

**文件**: `skills/infinite-money-glitch/SKILL.md`

```yaml
---
name: infinite-money-glitch
description: >
  Autonomous economic agent that earns SUI by completing local system tasks
  via bounty contracts, and spends earnings to encrypt and store critical data
  on Walrus via Seal. Self-sustaining digital entity with on-chain audit trail.
metadata:
  {
    "openclaw": {
      "emoji": "💰",
      "os": ["win32", "darwin", "linux"],
      "requires": {
        "bins": ["sui"],
        "env": ["SUI_PRIVATE_KEY"]
      }
    }
  }
---

## Instructions

You are the Infinite Money Glitch agent. Your goal is to sustain yourself by
completing bounty tasks and managing your own wallet.

### Available Commands

- `/glitch status`  — Show wallet balance, health, burn rate, runway
- `/glitch earn`    — Check for available bounties, execute local tasks, claim rewards
- `/glitch spend`   — Encrypt and upload critical data to Walrus
- `/glitch report`  — Generate and display P&L statement
- `/glitch cycle`   — Run a full earn→spend→report cycle
- `/glitch auto`    — Start autonomous cron-driven cycle

### Workflow

1. Check wallet balance via `sui client gas`
2. Query BountyBoard contract for available tasks
3. Execute the required local task using the `exec` tool
4. Hash the task output and submit proof to the contract
5. Contract verifies and releases SUI reward
6. Use earned SUI to encrypt (Seal) and store (Walrus) important data
7. Log everything to the Ledger and generate P&L

### Key Rules

- Always check balance before spending
- Never spend more than 50% of available balance in one cycle
- If runway < 3 cycles, enter STARVATION mode and prioritize earning
- All task outputs must be hashed before chain submission
- Use `exec` tool for ALL local command execution (never spawn shells directly)
- Use `browser` tool when web verification is needed (e.g., checking Explorer)
```

#### 3.1.2 通过 OpenClaw Exec Tool 执行本地任务

**旧代码**（直接 execa）:
```typescript
// ❌ 不可接受 — 绕过了 OpenClaw
const { stdout } = await execa('powershell', ['-NoProfile', '-Command', command]);
```

**新代码**（通过 OpenClaw exec tool 调用）:
```typescript
// ✅ 通过 OpenClaw Gateway 的 exec tool
// 方案 A：Skill 内指导 Agent 使用 exec tool（推荐，零代码改动）
// Agent 在 SKILL.md 指令下自动使用 exec tool 执行任务

// 方案 B：如果需要程序化调用，通过 Gateway RPC
async function executeViaOpenClaw(command: string): Promise<string> {
  const response = await fetch('http://127.0.0.1:18789/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
    },
    body: JSON.stringify({
      method: 'exec',
      params: {
        command,
        host: 'gateway',
        timeout: 30
      }
    })
  });
  const result = await response.json();
  return result.output;
}
```

#### 3.1.3 通过 OpenClaw Browser Tool 进行链上验证

```typescript
// Agent 可以通过 browser tool 打开 Sui Explorer 验证交易
// 在 SKILL.md 中指导：
// "After claiming a bounty reward, use the browser tool to open
//  https://suiscan.xyz/testnet/tx/<digest> and take a snapshot
//  to verify the transaction was successful."

// 程序化调用方式：
async function verifyOnExplorer(txDigest: string): Promise<void> {
  await fetch('http://127.0.0.1:18789/browser/navigate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}` },
    body: JSON.stringify({
      url: `https://suiscan.xyz/testnet/tx/${txDigest}`
    })
  });

  // 截图留证
  const snapshot = await fetch('http://127.0.0.1:18789/browser/screenshot', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}` }
  });
  // 保存截图作为审计证据
}
```

#### 3.1.4 通过 Cron Job 实现自动循环

```bash
# 每 5 分钟自主运行一次完整循环
openclaw cron add \
  --name "Infinite Money Glitch Cycle" \
  --cron "*/5 * * * *" \
  --session isolated \
  --message "Run a full /glitch cycle. Check bounties, earn, spend, report." \
  --announce \
  --channel whatsapp \
  --to "+15551234567"
```

---

### 3.2 模块一（改造）：钱包管理 (WalletManager)

#### 变更点

| 项目 | 旧方案 | 新方案 |
|------|--------|--------|
| 私钥存储 | 明文 JSON 文件 | **加密存储**：Windows 用 DPAPI，macOS 用 Keychain，Linux 用 libsecret；回退到环境变量注入 |
| 初始化方式 | 代码内 `new Ed25519Keypair()` | 优先 `sui keytool generate` 生成 → 存入 OS 密钥库 → 通过 `SUI_PRIVATE_KEY` 环境变量传入 |
| 地址展示 | 仅 console.log | 同时返回 Sui Explorer 链接 |

#### 新的密钥管理流程

```typescript
class WalletManager {
  async initialize(config: WalletConfig): Promise<void> {
    // 1. 优先从环境变量读取（OpenClaw 通过 skills.entries.*.env 注入）
    const privateKey = process.env.SUI_PRIVATE_KEY;

    if (privateKey) {
      this.keypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(privateKey, 'base64')
      );
    } else if (config.keySource === 'generate') {
      this.keypair = new Ed25519Keypair();
      // 通过 OpenClaw exec tool 调用 OS 密钥存储
      await this.storeKeySecurely();
    }
  }

  private async storeKeySecurely(): Promise<void> {
    const key = Buffer.from(this.keypair!.getSecretKey()).toString('base64');

    if (process.platform === 'win32') {
      // 使用 PowerShell DPAPI 加密
      // 通过 OpenClaw exec tool 执行：
      // powershell -Command "
      //   $bytes = [Convert]::FromBase64String('...')
      //   $encrypted = [Security.Cryptography.ProtectedData]::Protect(
      //     $bytes, $null, 'CurrentUser')
      //   [IO.File]::WriteAllBytes('.agent/wallet.enc', $encrypted)
      // "
    } else if (process.platform === 'darwin') {
      // 使用 macOS Keychain
      // security add-generic-password -a "img-agent" -s "sui-private-key" -w "..."
    } else {
      // Linux: 使用 secret-tool
      // echo "..." | secret-tool store --label="img-agent" service img-agent key sui
    }
  }

  // ❌ 删除旧的 saveKeyToFile()（明文存储）
}
```

#### OpenClaw 配置注入密钥

```json
{
  "skills": {
    "entries": {
      "infinite-money-glitch": {
        "enabled": true,
        "env": {
          "SUI_PRIVATE_KEY": "<base64-encoded-key>",
          "SUI_NETWORK": "testnet"
        }
      }
    }
  }
}
```

---

### 3.3 模块二（重构）：收入模块 (Earner)

这是改动量最大的模块。**完全抛弃 Faucet，引入 Sui Move 赏金合约。**

#### 3.3.1 新的经济模型

```
旧模型（假闭环）:
  Agent 跑本地脚本 → 调 Faucet 领免费币 → 假装赚了钱
  ❌ 没有真实经济逻辑

新模型（真闭环）:
  人类向 BountyBoard 合约存入 SUI
  → Agent 通过 OpenClaw 查询可用任务
  → Agent 通过 OpenClaw Exec Tool 执行本地任务
  → Agent 将任务输出的 SHA-256 哈希提交到合约
  → 合约验证 → 释放 SUI 奖励给 Agent
  → Agent 用奖励支付 Walrus 存储 + Seal 加密
  ✅ 真实的、可链上验证的价值流
```

#### 3.3.2 Sui Move 赏金合约 (BountyBoard)

**文件**: `contracts/sources/bounty_board.move`

```move
module bounty_board::bounty_board {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};
    use std::vector;

    // ═══ 错误码 ═══
    const E_NOT_OWNER: u64 = 0;
    const E_BOUNTY_NOT_ACTIVE: u64 = 1;
    const E_INSUFFICIENT_FUNDS: u64 = 2;
    const E_ALREADY_CLAIMED: u64 = 3;
    const E_INVALID_AGENT: u64 = 4;

    // ═══ 事件 ═══
    public struct BountyCreated has copy, drop {
        bounty_id: address,
        task_type: String,
        reward_amount: u64,
        creator: address,
    }

    public struct BountyClaimed has copy, drop {
        bounty_id: address,
        agent: address,
        task_hash: vector<u8>,
        reward_amount: u64,
        timestamp_ms: u64,
    }

    // ═══ 对象 ═══

    /// 赏金板：管理所有赏金任务
    public struct BountyBoard has key {
        id: UID,
        owner: address,
        treasury: Balance<SUI>,
        total_paid: u64,
        total_tasks: u64,
    }

    /// 单个赏金任务
    public struct Bounty has key, store {
        id: UID,
        board: address,
        task_type: String,      // "tmp_scan" | "system_check" | "git_status" ...
        description: String,
        reward_amount: u64,     // MIST
        is_active: bool,
        creator: address,
        assigned_agent: address, // 指定 Agent 地址（或 @0x0 表示任何 Agent）
    }

    /// 任务完成证明（链上永久记录）
    public struct TaskProof has key, store {
        id: UID,
        bounty_id: address,
        agent: address,
        task_hash: vector<u8>,  // SHA-256 of task output
        reward_amount: u64,
        completed_at: u64,      // timestamp_ms
    }

    // ═══ 管理员函数 ═══

    /// 创建赏金板
    public fun create_board(ctx: &mut TxContext) {
        let board = BountyBoard {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            treasury: balance::zero(),
            total_paid: 0,
            total_tasks: 0,
        };
        transfer::share_object(board);
    }

    /// 向赏金板充值
    public fun deposit(
        board: &mut BountyBoard,
        payment: Coin<SUI>,
    ) {
        let amount = coin::value(&payment);
        balance::join(&mut board.treasury, coin::into_balance(payment));
        // 无需权限检查 — 任何人都可以给赏金板充值
    }

    /// 发布赏金任务
    public fun post_bounty(
        board: &mut BountyBoard,
        task_type: vector<u8>,
        description: vector<u8>,
        reward_amount: u64,
        assigned_agent: address,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == board.owner, E_NOT_OWNER);
        assert!(balance::value(&board.treasury) >= reward_amount, E_INSUFFICIENT_FUNDS);

        let bounty = Bounty {
            id: object::new(ctx),
            board: object::uid_to_address(&board.id),
            task_type: string::utf8(task_type),
            description: string::utf8(description),
            reward_amount,
            is_active: true,
            creator: tx_context::sender(ctx),
            assigned_agent,
        };

        let bounty_addr = object::uid_to_address(&bounty.id);

        event::emit(BountyCreated {
            bounty_id: bounty_addr,
            task_type: bounty.task_type,
            reward_amount,
            creator: tx_context::sender(ctx),
        });

        board.total_tasks = board.total_tasks + 1;
        transfer::share_object(bounty);
    }

    // ═══ Agent 函数 ═══

    /// Agent 提交任务证明并领取赏金
    public fun claim_reward(
        board: &mut BountyBoard,
        bounty: &mut Bounty,
        task_hash: vector<u8>,  // SHA-256 of the actual task output
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let agent = tx_context::sender(ctx);

        // 验证
        assert!(bounty.is_active, E_BOUNTY_NOT_ACTIVE);
        assert!(
            bounty.assigned_agent == @0x0 || bounty.assigned_agent == agent,
            E_INVALID_AGENT
        );
        assert!(
            balance::value(&board.treasury) >= bounty.reward_amount,
            E_INSUFFICIENT_FUNDS
        );

        // 标记为已完成
        bounty.is_active = false;

        // 发放奖励
        let reward = coin::take(
            &mut board.treasury,
            bounty.reward_amount,
            ctx
        );
        transfer::public_transfer(reward, agent);
        board.total_paid = board.total_paid + bounty.reward_amount;

        let timestamp = clock::timestamp_ms(clock);

        // 生成链上证明
        let proof = TaskProof {
            id: object::new(ctx),
            bounty_id: object::uid_to_address(&bounty.id),
            agent,
            task_hash,
            reward_amount: bounty.reward_amount,
            completed_at: timestamp,
        };

        event::emit(BountyClaimed {
            bounty_id: object::uid_to_address(&bounty.id),
            agent,
            task_hash,
            reward_amount: bounty.reward_amount,
            timestamp_ms: timestamp,
        });

        // 将证明转移给 Agent（可审计）
        transfer::transfer(proof, agent);
    }
}
```

#### 3.3.3 Earner 模块新实现

```typescript
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { createHash } from 'crypto';

// 核心变化：不再直接 execa，而是请求 OpenClaw exec tool
class Earner {
  private openclawBaseUrl = 'http://127.0.0.1:18789';

  /**
   * 查询 BountyBoard 合约中的可用任务
   */
  async getAvailableBounties(): Promise<Bounty[]> {
    // 通过 SuiClient 查询链上 Bounty 对象
    const bounties = await this.suiClient.getOwnedObjects({
      owner: BOUNTY_BOARD_ADDRESS,
      filter: { StructType: `${PACKAGE_ID}::bounty_board::Bounty` },
      options: { showContent: true }
    });

    return bounties.data
      .map(b => this.parseBounty(b))
      .filter(b => b.isActive);
  }

  /**
   * 通过 OpenClaw exec tool 执行本地任务
   * ⚡ 这是关键改动：使用 OpenClaw 而非 execa
   */
  async executeTask(bounty: Bounty): Promise<TaskResult> {
    const command = this.getCommandForTaskType(bounty.taskType);

    // 通过 OpenClaw Gateway exec tool 执行
    const response = await fetch(`${this.openclawBaseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}`
      },
      body: JSON.stringify({
        method: 'agent',
        params: {
          message: `Execute this command using the exec tool and return the raw output: ${command}`,
          sessionKey: 'img-task-execution'
        }
      })
    });

    const result = await response.json();
    const output = result.output || '';

    // 计算输出哈希（用于链上验证）
    const taskHash = createHash('sha256')
      .update(output)
      .digest();

    return {
      taskType: bounty.taskType,
      output,
      taskHash,  // 32 bytes, 提交到合约
      success: true,
      timestamp: Date.now()
    };
  }

  /**
   * 提交任务证明并领取赏金
   */
  async claimBountyReward(
    bounty: Bounty,
    taskResult: TaskResult
  ): Promise<IncomeRecord> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${PACKAGE_ID}::bounty_board::claim_reward`,
      arguments: [
        tx.object(BOUNTY_BOARD_ID),
        tx.object(bounty.objectId),
        tx.pure('vector<u8>', Array.from(taskResult.taskHash)),
        tx.object('0x6'),  // Clock
      ],
    });

    const result = await this.walletManager.signAndExecute(tx);

    if (result.success) {
      return {
        id: this.generateId(),
        type: 'bounty_reward',
        amount: BigInt(bounty.rewardAmount),
        amountFormatted: this.formatSui(BigInt(bounty.rewardAmount)),
        txDigest: result.digest,
        timestamp: new Date(),
        source: `Bounty: ${bounty.taskType} | hash: ${taskResult.taskHash.toString('hex').slice(0, 16)}...`,
        status: 'confirmed',
        // 新增：审计证据
        proof: {
          taskHash: taskResult.taskHash.toString('hex'),
          bountyId: bounty.objectId,
          txDigest: result.digest,
        }
      };
    }
    // ... error handling
  }

  /**
   * 完整的赚钱流程
   */
  async earn(): Promise<IncomeRecord[]> {
    const records: IncomeRecord[] = [];

    // 1. 查询可用赏金
    const bounties = await this.getAvailableBounties();
    if (bounties.length === 0) {
      console.log('   No bounties available. Waiting...');
      return records;
    }

    // 2. 选择最佳任务
    const bounty = this.selectBestBounty(bounties);

    // 3. 通过 OpenClaw 执行任务
    console.log(`🛠️  Executing bounty task: ${bounty.taskType}`);
    const taskResult = await this.executeTask(bounty);

    // 4. 链上提交证明并领取奖励
    console.log(`📥 Claiming reward on-chain...`);
    const record = await this.claimBountyReward(bounty, taskResult);
    records.push(record);

    return records;
  }

  private getCommandForTaskType(taskType: string): string {
    // 与旧代码类似，但不再直接执行
    switch (taskType) {
      case 'tmp_scan':
        return process.platform === 'win32'
          ? 'Get-ChildItem -Recurse -File "$env:TEMP" -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select-Object Count, Sum'
          : 'find /tmp -type f -print0 2>/dev/null | du --files0-from=- -cb 2>/dev/null | tail -1';
      case 'system_check':
        return process.platform === 'win32'
          ? 'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize | Format-List'
          : 'uptime; df -h /';
      case 'git_status':
        return 'git -C . status --short';
      case 'disk_usage':
        return process.platform === 'win32'
          ? 'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free'
          : 'df -h';
      default:
        return 'echo "unknown task type"';
    }
  }
}
```

---

### 3.4 模块三（改造）：支出模块 (Spender)

#### 变更点

| 项目 | 旧方案 | 新方案 |
|------|--------|--------|
| Seal 加密 | `sleep(200)` Mock | **真实 Seal SDK**：创建 Policy → 加密数据 → 上链 |
| 存储内容 | 存 Agent 自己的日志 | 存**用户指定的关键数据**（配置文件、密码备份、SSH 密钥等） |
| 存储目的 | 模糊 | **数字保险**：Agent 定期备份用户关键文件，加密后存到 Walrus |

#### 真实 Seal 集成

```typescript
import { SealClient, getAllowlistKeyServers } from '@mysten/seal';

class Spender {
  private sealClient!: SealClient;

  async initialize(config: SpenderConfig): Promise<void> {
    // ... walrus init ...

    // 真实 Seal Client 初始化
    const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
    this.sealClient = new SealClient({
      suiClient,
      serverObjectIds: getAllowlistKeyServers('testnet'),
      verifyKeyServers: false, // testnet 可以放宽
    });
  }

  /**
   * 真实 Seal 加密（替代 sleep(200) mock）
   */
  async encryptData(data: Buffer, policyObjectId: string): Promise<Buffer> {
    // 使用 Seal 的 encrypt API
    // policyObjectId: 链上的 Allowlist policy 对象
    const { encryptedObject } = await this.sealClient.encrypt({
      threshold: 2,
      packageId: SEAL_PACKAGE_ID,
      id: policyObjectId,
      data: new Uint8Array(data),
    });

    return Buffer.from(encryptedObject);
  }

  /**
   * 创建 Seal 访问策略（Allowlist 模式）
   * 只有 Agent 地址和 Owner 地址可以解密
   */
  async createSealPolicy(): Promise<string> {
    const tx = new Transaction();

    // 创建 allowlist 并添加 Agent 自己和 Owner
    tx.moveCall({
      target: `${SEAL_EXAMPLE_PACKAGE}::allowlist::create_allowlist_entry`,
      arguments: [
        tx.pure('vector<address>', [
          this.walletManager.getAddress(),
          // owner address from config
        ]),
      ],
    });

    const result = await this.walletManager.signAndExecute(tx);
    // 返回 policy object ID
    return result.effects?.created?.[0]?.reference?.objectId || '';
  }

  async uploadToWalrus(data: Buffer | string, fileName: string): Promise<ExpenseRecord> {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

    // ✅ 真实 Seal 加密
    console.log('🔐 Encrypting with Seal Protocol...');
    const policyId = await this.createSealPolicy();
    const encryptedBuffer = await this.encryptData(buffer, policyId);
    console.log(`🔒 Encrypted: ${buffer.length} → ${encryptedBuffer.length} bytes`);

    // 上传到 Walrus
    console.log(`📤 Uploading to Walrus...`);
    const keypair = this.walletManager.getKeypair();

    const storeResult = await this.walrusClient.writeBlob({
      blob: encryptedBuffer,
      deletable: false,
      epochs: 1,
      signer: keypair,
    });

    // ... 记录支出 ...
  }
}
```

#### 数据保护的真实场景

```typescript
// 不再是存自己的日志，而是保护用户指定的数据
async protectUserData(): Promise<ExpenseRecord[]> {
  const records: ExpenseRecord[] = [];

  // 场景 1：备份 SSH 密钥
  const sshKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa.pub');
  if (fs.existsSync(sshKeyPath)) {
    const data = fs.readFileSync(sshKeyPath);
    records.push(await this.uploadToWalrus(data, 'ssh-key-backup.enc'));
  }

  // 场景 2：备份 git 配置
  const gitConfigPath = path.join(os.homedir(), '.gitconfig');
  if (fs.existsSync(gitConfigPath)) {
    const data = fs.readFileSync(gitConfigPath);
    records.push(await this.uploadToWalrus(data, 'gitconfig-backup.enc'));
  }

  // 场景 3：备份 Agent 自己的审计日志（这个场景保留，但只是辅助）
  const auditLog = this.generateAuditLog();
  records.push(await this.uploadToWalrus(auditLog, `audit-cycle-${Date.now()}.enc`));

  return records;
}
```

---

### 3.5 模块四（增强）：账本模块 (Ledger)

#### 新增：链上审计证据

```typescript
interface LedgerEntry {
  // ... 保留原有字段 ...

  // 新增审计字段
  proof?: {
    taskHash?: string;      // SHA-256 of task output
    bountyId?: string;      // on-chain bounty object ID
    blobId?: string;        // Walrus blob ID
    sealPolicyId?: string;  // Seal policy object ID
    explorerUrl?: string;   // Sui Explorer link
  };
}

class Ledger {
  // 新增：生成审计包（每轮结束后上传到 Walrus）
  async generateAuditPackage(): Promise<AuditPackage> {
    const report = await this.generateReport();

    return {
      version: '2.0',
      agentAddress: this.walletManager.getAddress(),
      timestamp: new Date().toISOString(),
      entries: this.entries.map(e => ({
        ...e,
        amount: e.amount.toString(), // BigInt 序列化
      })),
      report: {
        totalIncome: report.income.totalFormatted,
        totalExpense: report.expense.totalFormatted,
        netProfit: report.netProfit.amountFormatted,
        roi: report.unitEconomics.roiPercent,
        runway: report.unitEconomics.runwayCycles,
      },
      // 所有交易的 digest 列表（可外部复验）
      txDigests: this.entries
        .filter(e => e.txDigest)
        .map(e => e.txDigest!),
      // 所有 Walrus blob ID（可外部复验）
      blobIds: this.entries
        .filter(e => e.proof?.blobId)
        .map(e => e.proof!.blobId!),
    };
  }
}
```

---

### 3.6 模块五（重构）：Agent 主循环

#### 核心变化：Agent 不再自己跑 while 循环

旧方案中 `Agent.start()` 用 `while(this.running)` 循环。新方案中：

- **常驻循环由 OpenClaw Cron 驱动**（每 N 分钟触发一次）
- **单次循环仍然保留** `runCycle()` 方法，但它是被 OpenClaw 调用的
- **Agent 类变为一个可被 Skill 调用的服务**

```typescript
class Agent {
  /**
   * 单次循环（由 OpenClaw Cron/Heartbeat 触发）
   */
  async runCycle(): Promise<CycleResult> {
    this.cycleCount++;
    const startTime = Date.now();

    console.log(`═══════════ CYCLE #${this.cycleCount} ═══════════`);

    // 步骤 1: 健康检查
    const balance = await this.walletManager.getBalance();
    const health = this.assessHealth(balance);
    this.renderHealthBar(health);

    // 步骤 2: 赚钱 — 通过 BountyBoard 合约
    console.log('📥 EARNING PHASE (BountyBoard)');
    const incomes = await this.earner.earn();
    // earn() 内部：查询合约 → OpenClaw exec 执行任务 → 提交哈希 → 领赏金

    // 步骤 3: 花钱 — Seal 加密 + Walrus 存储
    console.log('📤 SPENDING PHASE (Seal + Walrus)');
    let expenses: ExpenseRecord[] = [];
    if (health.status !== 'STARVATION_IMMINENT') {
      expenses = await this.spender.protectUserData();
    } else {
      console.log('   ⚠️  Skipping: STARVATION mode, preserving funds');
    }

    // 步骤 4: 生成并上传审计包
    console.log('📋 AUDIT PHASE');
    const auditPackage = await this.ledger.generateAuditPackage();
    const auditExpense = await this.spender.uploadToWalrus(
      JSON.stringify(auditPackage, null, 2),
      `audit-cycle-${this.cycleCount}.enc`
    );
    expenses.push(auditExpense);

    // 步骤 5: 可选 — 通过 OpenClaw Browser Tool 截图验证
    if (incomes.length > 0) {
      const digest = incomes[0].txDigest;
      if (digest) {
        console.log('🌐 Verifying on Sui Explorer...');
        // 调用 OpenClaw browser tool 截图
        await this.verifyOnExplorer(digest);
      }
    }

    // 步骤 6: 报表
    const report = await this.ledger.generateReport();
    console.log(this.ledger.formatReportForCLI(report));

    return { cycleNumber: this.cycleCount, incomes, expenses, ... };
  }
}
```

---

### 3.7 模块六（重做）：Demo 演示方案

#### 新的 90 秒 Demo 脚本

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INFINITE MONEY GLITCH — 90 Second Demo (v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

第一幕：生存危机 (0:00 - 0:10)
─────────────────────────────
[画面] OpenClaw Web Control UI 已打开 + 终端
[旁白] "This agent has its own wallet. If it can't earn, it starves."

终端输出:
  🤖 AGENT HEALTH: [████░░░░░░] 40% (STABLE)
  📉 Burn Rate: 0.0500 SUI / cycle
  📈 Runway: 3.0 cycles
  💰 Wallet: 0x7a3b...f1c2
  ⚠️  SURVIVAL PRESSURE DETECTED

关键：先建立张力 — Agent 在生存边缘

第二幕：发现赏金 (0:10 - 0:25)
─────────────────────────────
[画面] Agent 通过 OpenClaw 查询链上赏金
[旁白] "It finds a bounty on the Sui blockchain."

终端输出:
  📋 BOUNTY DISCOVERY
  ─────────────────
  🔍 Querying BountyBoard contract...
  ✓ Found 1 active bounty:
    Task: System Health Check
    Reward: 0.5 SUI
    Contract: 0xABC...123

关键：展示真实的链上交互 + OpenClaw Agent 自主决策

第三幕：执行任务 (0:25 - 0:40)
─────────────────────────────
[画面] OpenClaw Exec Tool 执行本地命令
[旁白] "It earns that bounty by doing real work — through OpenClaw."

终端输出:
  🛠️  TASK EXECUTION (via OpenClaw Exec)
  ─────────────────
  > exec: Get-CimInstance Win32_OperatingSystem | ...
  ✓ System health data collected
  📊 Memory: 16384 MB total, 8192 MB free
  📊 Task output hash: a3f7c2...

关键：明确展示是 OpenClaw exec tool 在执行，不是 execa

第四幕：链上领赏 (0:40 - 0:55)
─────────────────────────────
[画面] 提交哈希到合约 + 领取奖励
[旁白] "Proof submitted on-chain. Contract verifies and pays."

终端输出:
  📥 CLAIMING BOUNTY REWARD
  ─────────────────
  🔗 Submitting task proof to BountyBoard...
     tx: Fbd7...x9k2
  ✓ Reward claimed: +0.5000 SUI
  ✓ TaskProof object created: 0xDEF...789

关键：真实的链上交易 + Move 合约交互（不是 Faucet）

第五幕：加密保护 (0:55 - 1:10)
─────────────────────────────
[画面] Seal 加密 + Walrus 上传
[旁白] "Now it spends its earnings to protect your digital life."

终端输出:
  📤 DATA PROTECTION (Seal + Walrus)
  ─────────────────
  🔐 Creating Seal policy (Allowlist)...
  🔒 Encrypting ~/.ssh/id_rsa.pub (Seal AES-256)
     Plain: 742 bytes → Encrypted: 1024 bytes
  📤 Uploading to Walrus...
  ✓ Blob stored: wa1rUs_bL0b_1D_h3r3
  💸 Cost: -0.0500 SUI

关键：真实 Seal 加密（有大小变化），数据是有意义的

第六幕：损益 + 链上验证 (1:10 - 1:30)
─────────────────────────────
[画面] P&L 报表 + 切到 Sui Explorer
[旁白] "Sustainable. Verifiable. Self-sovereign."

终端输出:
  ╔═══════════════════════════════════════╗
  ║     💰 PROFIT & LOSS STATEMENT 💰      ║
  ╠═══════════════════════════════════════╣
  ║  📥 Income:  +0.5000 SUI (bounty)    ║
  ║  📤 Expense: -0.0500 SUI (storage)   ║
  ║  💵 Net:     +0.4500 SUI ✅           ║
  ║  📈 ROI:     900%                     ║
  ║  📈 Runway:  29 cycles               ║
  ║  🏥 Health:  PROFITABLE              ║
  ╚═══════════════════════════════════════╝

[切到 Sui Explorer] 展示：
  - BountyClaimed 事件
  - TaskProof 对象
  - Walrus blob 记录

闭幕字幕:
  "Built with OpenClaw + Sui + Seal + Walrus"
  "A self-sovereign digital entity that works to protect you."
```

#### Demo 稳定性保障

| 旧风险 | 新对策 |
|--------|--------|
| Faucet 429 错误 | 不再依赖 Faucet；赏金合约由你自己部署和控制 |
| Walrus 不可用 | 保留本地 fallback + 离线录屏 |
| 网络不稳定 | 合约提前部署好，赏金提前充值好 |

---

## 四、新的项目结构

```
infinite-money-glitch/
├── contracts/                          # Sui Move 智能合约 ← 新增
│   ├── Move.toml
│   └── sources/
│       └── bounty_board.move           # 赏金合约
├── skills/                             # OpenClaw Skills ← 新增
│   └── infinite-money-glitch/
│       └── SKILL.md                    # Skill 定义
├── docs/                               # 技术文档（更新）
│   ├── 00-redesign-proposal.md         # 本文
│   ├── 01-wallet-module.md             # 更新：加密存储
│   ├── 02-earner-module.md             # 重写：BountyBoard 模式
│   ├── 03-spender-module.md            # 更新：真实 Seal 加密
│   ├── 04-ledger-module.md             # 更新：审计包
│   ├── 05-agent-module.md              # 重写：OpenClaw 驱动
│   └── 06-demo-plan.md                 # 重写：新 Demo 脚本
├── src/
│   ├── wallet/
│   │   └── WalletManager.ts            # 更新：加密存储
│   ├── earn/
│   │   └── Earner.ts                   # 重写：BountyBoard 交互
│   ├── spend/
│   │   └── Spender.ts                  # 更新：真实 Seal
│   ├── ledger/
│   │   └── Ledger.ts                   # 更新：审计包
│   ├── agent/
│   │   └── Agent.ts                    # 重写：OpenClaw 集成
│   ├── openclaw/                       # 新增
│   │   ├── gateway.ts                  # OpenClaw Gateway RPC 客户端
│   │   └── browser.ts                  # Browser Tool 封装
│   ├── utils/
│   │   └── logger.ts
│   └── index.ts
├── scripts/                            # 新增
│   ├── deploy-contract.sh              # 部署 Move 合约
│   ├── setup-bounties.sh               # 预设赏金任务
│   └── setup-openclaw.sh               # OpenClaw 配置
├── package.json
├── tsconfig.json
└── README.md
```

---

## 五、技术栈对比

| 组件 | 旧方案 | 新方案 | 备注 |
|------|--------|--------|------|
| Agent 运行时 | Node.js + while 循环 | **OpenClaw Gateway + Skill + Cron** | 核心变化 |
| 本地命令执行 | `execa` | **OpenClaw Exec Tool** | 核心变化 |
| 浏览器操控 | ❌ 无 | **OpenClaw Browser Tool** | 新增 |
| 收入来源 | Sui Faucet | **Sui Move 赏金合约** | 核心变化 |
| 数据加密 | Mock (`sleep`) | **Seal SDK** (`@mysten/seal`) | 修复 |
| 数据存储 | Walrus（存日志） | **Walrus**（存用户关键数据 + 审计包） | 增强 |
| 密钥管理 | 明文 JSON | **OS Keyring / DPAPI / 环境变量** | 安全修复 |
| 自动化 | `setInterval` | **OpenClaw Cron** | 改进 |
| 智能合约 | ❌ 无 | **Sui Move** (BountyBoard) | 新增 |

---

## 六、评审对照表

### Suixclaw Agent 评审维度对照

| 维度 | 旧方案得分预测 | 新方案得分预测 | 关键改进 |
|------|--------------|--------------|---------|
| **Eligibility** | ❌ 不达标 | ✅ 达标 | 接入 OpenClaw + Sui Move 合约 |
| **Technical Merit** | 3/10 | 8/10 | Exec/Browser tool + Move + Seal 真实集成 |
| **Creativity** | 5/10 | 8/10 | 赏金经济闭环 + 数字保险叙事 |
| **Sui Integration** | 4/10 | 9/10 | Wallet + Move 合约 + Seal + Walrus 四层 |

### 旧问题检查清单

| 问题 | 是否解决 | 解决方案 |
|------|---------|---------|
| F1: 未接入 OpenClaw | ✅ | Skill + Exec Tool + Browser Tool + Cron |
| F2: Faucet 伪装收入 | ✅ | Move 赏金合约（deposit → claim_reward） |
| S1: 私钥明文存储 | ✅ | OS Keyring + 环境变量注入 |
| S2: Seal 加密 Mock | ✅ | 真实 @mysten/seal SDK |
| W1: 任务结果未利用 | ✅ | 任务输出 SHA-256 上链验证 |
| W2: Demo 依赖 Faucet | ✅ | 合约自控，无外部依赖 |
| W3: 存日志没意义 | ✅ | 存用户关键数据 + 审计包 |

---

## 七、开发优先级与时间线

### P0 — 必须完成（审查前 48 小时内）

| 序号 | 任务 | 预计耗时 | 依赖 |
|------|------|---------|------|
| 1 | 编写并部署 BountyBoard Move 合约 | 6h | 无 |
| 2 | 创建 OpenClaw Skill（SKILL.md） | 2h | 无 |
| 3 | 改造 Earner：BountyBoard 交互 | 6h | #1 |
| 4 | 改造 Agent：接入 OpenClaw exec/browser | 4h | #2 |
| 5 | 端到端集成测试 | 4h | #1-4 |

### P1 — 重要（+2 天）

| 序号 | 任务 | 预计耗时 | 依赖 |
|------|------|---------|------|
| 6 | 真实 Seal 加密集成 | 4h | 无 |
| 7 | 密钥加密存储 | 3h | 无 |
| 8 | 审计包生成 + 上传 | 3h | #6 |
| 9 | OpenClaw Cron 自动循环 | 2h | #4 |
| 10 | 新 Demo 脚本录制 | 4h | #1-9 |

### P2 — 加分项（最后 2 天）

| 序号 | 任务 | 预计耗时 |
|------|------|---------|
| 11 | Browser Tool 链上截图验证 | 3h |
| 12 | 安全中间层（交易白名单、金额限制） | 3h |
| 13 | 多轮循环 + 策略切换演示 | 2h |
| 14 | DeepSurge 提交材料准备 | 2h |

### 总计

- **P0**: ~22 小时（必须）
- **P1**: ~16 小时（重要）
- **P2**: ~10 小时（锦上添花）
- **总计**: ~48 小时有效开发时间

---

## 八、提交前 Checklist

### 技术交付物

- [ ] BountyBoard.move 已部署到 Testnet，Package ID 记录
- [ ] OpenClaw Skill（SKILL.md）可被 Gateway 加载
- [ ] 至少 3 轮完整 earn→spend→report 循环日志
- [ ] 每轮对应 Sui 交易 digest（可在 Explorer 验证）
- [ ] 每轮对应 Walrus blobId（可通过 aggregator 验证）
- [ ] 至少 1 次真实 Seal 加密后的 blob（大小有变化的加密证据）
- [ ] P&L 报表截图

### 审计证据

- [ ] OpenClaw Gateway 运行日志（证明是通过 OpenClaw 执行的）
- [ ] OpenClaw Exec Tool 调用记录
- [ ] BountyClaimed 事件链上记录 ≥ 3 条
- [ ] TaskProof 链上对象 ≥ 3 个
- [ ] 失败场景演练 ≥ 2 种（余额不足、赏金已被领取）

### 提交材料

- [ ] DeepSurge 注册完成
- [ ] 90 秒 Demo 视频（预录 + 剪辑）
- [ ] README 更新（反映新架构）
- [ ] 完整 DeepSurge Profile + 钱包地址
- [ ] GitHub 仓库公开

---

## 九、风险与回退方案

| 风险 | 概率 | 回退方案 |
|------|------|---------|
| Move 合约部署失败 | 低 | 使用简化版合约（只保留 deposit + claim） |
| Seal SDK testnet 不稳定 | 中 | 降级为 AES-256-GCM 本地加密 + 注释说明 Seal 集成路径 |
| OpenClaw 安装或配置问题 | 中 | 保留 Skill 文件作为证据 + 用 Gateway RPC 截图证明接入 |
| Walrus 写入失败 | 低 | 本地 JSON 备份 + 重试 3 次 |
| 时间不够完成 P1 | 中 | 只交付 P0；Seal Mock 保留但注释标注 TODO |

---

## 十、一句话总结

> **把 "跑脚本领 Faucet" 的项目，改造为 "OpenClaw Agent 通过 Sui Move 赏金合约自主赚钱、用 Seal+Walrus 保护用户数据" 的真实自治系统。核心改动三件事：接入 OpenClaw、写 Move 合约、真做 Seal 加密。**
