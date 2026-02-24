import type { EarnMode, EarnModeContext, EarnModeRunResult } from './EarnMode.js';

/**
 * Placeholder: simple, verifiable arbitrage mode.
 *
 * Examples (future): price discrepancy checks, liquidity incentives, compute caching.
 */
export class ArbitrageMode implements EarnMode {
  id = 'arbitrage';
  name = 'Arbitrage';
  status = 'planned' as const;
  summary = 'Planned: verifiable arbitrage strategies with on-chain proof + audit trail.';

  isEnabled(env: NodeJS.ProcessEnv): boolean {
    return env.EARN_MODE_ARBITRAGE === 'true';
  }

  async run(ctx: EarnModeContext): Promise<EarnModeRunResult> {
    try {
      return {
        modeId: this.id,
        modeName: this.name,
        status: this.status,
        attempted: false,
        success: false,
        earnedMist: 0n,
        details: {
          note: 'Not implemented (skeleton only).'
        }
      };
    } catch (error) {
      return {
        modeId: this.id,
        modeName: this.name,
        status: this.status,
        attempted: true,
        success: false,
        earnedMist: 0n,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
