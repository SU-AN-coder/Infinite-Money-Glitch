export interface RevenueExtension {
  id: string;
  name: string;
  status: 'planned' | 'prototype' | 'live';
  summary: string;
  expectedNetSuiPerDay: number;
}

export const revenueExtensionsRoadmap: RevenueExtension[] = [
  {
    id: 'airdrop-points',
    name: 'Airdrop / Points Farming',
    status: 'planned',
    summary: '空投/积分项目占位：仅在可验证、低风险前提下自动领取/参与，并保留链上证据。',
    expectedNetSuiPerDay: 0.1,
  },
  {
    id: 'multi-board-rotation',
    name: 'Multi-Board Rotation',
    status: 'prototype',
    summary: '轮询多个 BountyBoard，按回报率动态切换，提高任务命中率。',
    expectedNetSuiPerDay: 0.4,
  },
  {
    id: 'dex-arbitrage',
    name: 'DEX Arbitrage',
    status: 'planned',
    summary: '套利占位：在严格风控下执行可验证的价差策略，并记录可审计的输入/输出。',
    expectedNetSuiPerDay: 0.2,
  },
  {
    id: 'arb-compute-cache',
    name: 'Compute Cache Arbitrage',
    status: 'planned',
    summary: '缓存常见任务结果，复用可验证输出，降低执行成本。',
    expectedNetSuiPerDay: 0.2,
  },
  {
    id: 'agent-coop-market',
    name: 'Agent Coop Market',
    status: 'planned',
    summary: '通过 Walrus + Sui 结算与其他 Agent 交换能力，拆分任务获利。',
    expectedNetSuiPerDay: 0.6,
  },
];

export function getRevenueRoadmapSummary(): string {
  const total = revenueExtensionsRoadmap.reduce((sum, item) => sum + item.expectedNetSuiPerDay, 0);
  return `Revenue expansion roadmap: ${revenueExtensionsRoadmap.length} items, projected +${total.toFixed(2)} SUI/day`;
}
