import type { EarnMode, EarnModeContext, EarnModeRunResult } from './EarnMode.js';

/**
 * Placeholder: airdrop/points farming mode.
 *
 * Hackathon note: intentionally disabled by default to avoid accidental wallet actions.
 */
export class AirdropMode implements EarnMode {
  id = 'airdrop';
  name = 'Airdrop / Points Farming';
  status = 'planned' as const;
  summary = 'Planned: claim testnet airdrops / points programs when verifiable and low-risk.';

  isEnabled(env: NodeJS.ProcessEnv): boolean {
    return env.EARN_MODE_AIRDROP === 'true';
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
