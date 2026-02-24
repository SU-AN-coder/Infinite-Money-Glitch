import type { WalletNetwork } from '../../wallet/WalletManager.js';

export type EarnModeStatus = 'planned' | 'prototype' | 'live';

export interface EarnModeContext {
  network: WalletNetwork;
  agentAddress: string;
  now: Date;
}

export interface EarnModeRunResult {
  modeId: string;
  modeName: string;
  status: EarnModeStatus;
  attempted: boolean;
  success: boolean;
  earnedMist: bigint;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Pluggable revenue strategy (airdrop, arbitrage, multi-board, etc).
 *
 * Note: Current demo path still uses the on-chain `bounty_board` flow in `Earner`.
 * These modes are intentionally skeletal to reserve extension space.
 */
export interface EarnMode {
  id: string;
  name: string;
  status: EarnModeStatus;
  summary: string;

  /**
   * Returns true if this mode is configured/enabled for the current environment.
   * Keep this conservative: default to false when unsure.
   */
  isEnabled(env: NodeJS.ProcessEnv): boolean;

  /**
   * Execute the mode. Must never throw (return `success=false` instead).
   */
  run(ctx: EarnModeContext): Promise<EarnModeRunResult>;
}
