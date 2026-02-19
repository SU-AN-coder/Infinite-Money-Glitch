# 模块六：Demo 演示方案

## 概述

这是一份详细的 90 秒演示脚本，用于在黑客松中展示 "Infinite Money Glitch" 项目。目标是在有限时间内清晰展示 Agent 的核心价值：在“生存压力”下自主打工赚取 Gas，并将收入用于 Seal 加密后的 Walrus 备份，形成可持续保护循环。

## Demo 核心信息

| 项目 | 内容 |
|------|------|
| **项目名** | Infinite Money Glitch |
| **赛道** | Track 2: Local God Mode |
| **一句话** | A self-sovereign digital entity that works to protect you. |
| **时长** | 90 秒 |
| **评审重点** | 资格、技术价值、创造力、Sui 集成 |

## 90 秒脚本（The Sustainable Cycle）

### 第一幕：生存危机（0:00 - 0:15）

**画面**：终端启动，顶部常驻生存面板

**旁白/字幕**：
> "If this agent stops earning, it loses gas. If it loses gas, it loses memory protection."

**终端输出**：
```
🤖 AGENT HEALTH: [████░░░░░░] 40% (STABLE)
📉 Burn Rate: 0.0500 SUI / cycle
📈 Est. Runway: 3.0 cycles

⚠️  SURVIVAL PRESSURE DETECTED: earnings required.
```

**关键点**：
- 先展示“为什么必须赚钱”
- 给评委直接张力（不是普通记账脚本）

---

### 第二幕：工作换酬（0:15 - 0:35）

**画面**：Agent 执行本地任务并结算奖励

**旁白/字幕**：
> "The agent works first, then settles reward on-chain."

**终端输出**：
```
📥 EARNING PHASE
─────────────────
🛠️  Working: Temp Cleanup Audit
   > powershell -NoProfile -Command "Get-ChildItem $env:TEMP -Recurse -File ..."
   ✓ Scanned C:\Users\...\AppData\Local\Temp
   ✓ Reclaimable size ≈ 842.31 MB

# 备选任务（现场按环境二选一）
# 1) System Health Check: uptime / df -h 或 Win32_OperatingSystem
# 2) Git Integrity Check: git status --short

📥 Settling task reward via Faucet...
✓ Task reward received: +0.5000 SUI
```

**关键点**：
- 叙事从“领水龙头”升级为“真实本地工作 + 结算”
- 符合 Local God Mode（本地执行能力）

---

### 第三幕：加密保护（0:35 - 0:55）

**画面**：Agent 使用收入为“加密备份”付费

**旁白/字幕**：
> "Now it spends that income to protect your digital life."

**终端输出**：
```
📤 SPENDING PHASE
─────────────────
🔐 Encrypting data with Seal...
🔒 Data encrypted via Seal Protocol
📤 Uploading encrypted backup to Walrus...
✓ Encrypted blob uploaded: blob_id_abc123...
✓ Cost: 0.0500 SUI
```

**关键点**：
- 补齐 Seal 安全层
- 支出有意义：用于保护，而不是“存日志而存日志”

---

### 第四幕：经营结果（0:55 - 1:15）

**画面**：展示 P&L + 单位经济指标

**旁白/字幕**：
> "This is a sustainable cycle: work, earn, protect, survive."

**终端输出**：
```
💰 P&L: +0.4500 SUI
📈 ROI: 900.00%
📉 Burn Rate: 0.0500 SUI / cycle
📈 Runway: 29.0 cycles
✅ Health: PROFITABLE
```

**关键点**：
- 展示可持续经营，不是单次好运
- 评委能快速看到商业可行性

---

### 第五幕：链上复验（1:15 - 1:30）

**画面**：切换到 Sui Explorer + Blob 记录

**旁白/字幕**：
> "Every step is verifiable on-chain. A self-sovereign digital entity that works to protect you."

**Sui Explorer 展示**：
- Task reward settlement 交易
- Walrus 支付交易
- 对应加密 blob 记录

## 演示准备清单

### 演示前 24 小时

- [ ] 从 Testnet Faucet 预先领取足够代币
- [ ] 测试完整流程 10 次，确保稳定
- [ ] 准备备用钱包（已有余额）
- [ ] 测试网络连接稳定性
- [ ] 准备离线录屏作为备用

### 演示前 1 小时

- [ ] 检查 Sui Testnet 状态
- [ ] 检查 Walrus 服务状态
- [ ] 重置 Agent 到干净状态
- [ ] 准备好 Sui Explorer 标签页
- [ ] 关闭无关程序，清理桌面
- [ ] 预跑 3 类本地任务（tmp_scan/system_check/git_status）各 1 次
- [ ] 确认演示目录有 git 仓库（用于 git status 备选）

### 演示设备

- [ ] 终端字体放大（便于录屏）
- [ ] 深色主题（视觉效果好）
- [ ] 录屏软件准备就绪
- [ ] 麦克风测试（如需旁白）

## 备用方案

### 方案 A：Faucet 不可用

如果 Testnet Faucet 临时下线：
1. 使用预充值的钱包
2. 保留“真实本地工作”步骤，改为展示本地任务报告 + 预充值结算
3. 修改旁白："Agent completed real local work and settled from pre-funded budget"

### 方案 B：Walrus 上传失败

如果 Walrus 服务不稳定：
1. 使用模拟上传（本地保存日志）
2. 减少上传数据量
3. 展示之前成功上传的加密 Blob ID

### 方案 C：网络完全不可用

使用预先录制的视频：
- 录制一份完整的成功演示
- 保存为备用
- 演示时播放视频 + 现场讲解

## 评审加分点

| 评审维度 | Demo 中如何体现 |
|----------|----------------|
| **资格** | 使用 Sui Testnet，真实交易 |
| **技术价值** | Wallet + Work-to-Reward + Seal + Walrus + Ledger 完整架构 |
| **创造力** | "Agent 在生存压力下自主打工并保护用户数据" |
| **Sui 集成** | 钱包、交易、Walrus、Seal |
| **可验证** | Sui Explorer + Blob 记录链上复验 |

## 社区投票钩子

**Slogan 选项**：
1. "The Autonomous Insurance Agent for Your Digital Life"
2. "Work. Earn. Encrypt. Protect."
3. "A Self-Sovereign Digital Entity That Works for You"

**传播要点**：
- 简单易懂：Agent 先干活，再结算奖励
- 新奇有趣：Infinite Money Glitch 名字本身就是梗
- 可验证：链上可查

## 时间分配总结

| 幕数 | 时间 | 内容 | 秒数 |
|------|------|------|------|
| 1 | 0:00-0:15 | 开场 + 初始化 | 15s |
| 2 | 0:15-0:35 | 赚钱阶段 | 20s |
| 3 | 0:35-0:55 | 花钱阶段 | 20s |
| 4 | 0:55-1:15 | 损益报表 | 20s |
| 5 | 1:15-1:30 | 链上验证 + 结尾 | 15s |

**总计**: 90 秒

## 演示脚本（逐字稿）

```
[0:00] If this agent cannot earn, it cannot buy gas.

[0:05] If it cannot buy gas, it cannot protect your digital memory.

[0:10] This is Infinite Money Glitch.

[0:15] Watch: it starts in survival mode and needs to work.

[0:20] It performs a real local task first.

[0:25] Then it settles that work as an on-chain task reward.

[0:30] No prompt required. Fully autonomous.

[0:35] Now it spends that reward to protect your data.

[0:40] Data is encrypted via Seal and stored on Walrus.

[0:45] Every spend is a security decision, not just an expense.

[0:50] And the result?

[0:55] Income: 0.5 SUI. Expense: 0.05 SUI.

[1:00] Net Profit: 0.45 SUI.

[1:05] Burn rate and runway show this cycle is sustainable.

[1:10] Every transaction and blob record is verifiable on-chain.

[1:15] This is Infinite Money Glitch.

[1:20] Built with OpenClaw, Sui, Walrus, and Seal.

[1:25] A self-sovereign digital entity that works to protect you.

[1:30] [END]
```

## 后续改进方向

如果时间允许，可以在 Demo 中增加：

1. **多轮循环**：展示 Agent 持续运行多个周期
2. **策略切换**：展示不同的赚钱策略
3. **风险控制**：展示余额不足时的处理
4. **历史记录**：展示从 Walrus 读取历史报表
