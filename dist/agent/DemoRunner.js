import { Agent } from './Agent.js';
export async function runDemo(config) {
    const agent = new Agent(config);
    console.log('🎬 Act 1 — 生存危机 / 初始化');
    await agent.initialize();
    console.log('🎬 Act 2~6 — 赏金发现 → OpenClaw 执行 → 链上领取 → Seal+Walrus → 报表验证');
    const cycle = await agent.runCycle();
    const earned = cycle.phases.earn?.totalEarned ?? 0n;
    const spent = cycle.phases.spend?.totalGasSpent ?? 0n;
    const verified = cycle.phases.verify?.transactionsVerified ?? 0;
    const verifyTotal = cycle.phases.verify?.details.length ?? 0;
    const summary = [
        `cycle=${cycle.cycleNumber}`,
        `mode=${cycle.mode}`,
        `earned=${Number(earned) / 1e9} SUI`,
        `spent=${Number(spent) / 1e9} SUI`,
        `verified=${verified}/${verifyTotal}`
    ].join(' | ');
    console.log('🎬 Demo Summary');
    console.log(summary);
    return {
        success: cycle.success,
        cycle: cycle.cycleNumber,
        duration: cycle.duration,
        summary
    };
}
