import { Earner, type EarnResult } from '../earn/Earner.js';
import { Ledger, type AuditPackage } from '../ledger/Ledger.js';
import { Spender, type SpendResult } from '../spend/Spender.js';
import { WalletManager, type WalletConfig, type WalletNetwork } from '../wallet/WalletManager.js';

export type AgentMode = 'NORMAL' | 'STARVATION' | 'ERROR';

export interface AgentState {
  mode: AgentMode;
  cycleCount: number;
  lastCycleAt: Date | null;
  consecutiveFailures: number;
  totalEarned: bigint;
  totalSpent: bigint;
  walletExplorerUrl: string;
}

export interface HealthCheckResult {
  balance: bigint;
  sufficientBalance: boolean;
  bountyBoardReachable: boolean;
  openclawGatewayReachable: boolean;
  recommendedMode: AgentMode;
}

export interface VerifyResult {
  transactionsVerified: number;
  allVerified: boolean;
  screenshotUrl?: string;
  details: {
    txDigest: string;
    verified: boolean;
    explorerUrl: string;
  }[];
}

export interface ReportResult {
  pnlSummary: string;
  survivalStatus: string;
  nextCycleAt: Date;
}

export interface CycleResult {
  cycleNumber: number;
  mode: AgentMode;
  phases: {
    healthCheck: HealthCheckResult;
    earn: EarnResult | null;
    spend: SpendResult | null;
    audit: AuditPackage | null;
    verify: VerifyResult | null;
    report: ReportResult;
  };
  duration: number;
  success: boolean;
  error?: string;
}

export interface AgentConfig {
  network: WalletNetwork;
  keySource: WalletConfig['keySource'];
  bountyPackageId: string;
  bountyBoardId: string;
  sealPackageId: string;
  openclawBaseUrl?: string;
  starvationThresholdMist?: bigint;
  cycleIntervalMinutes?: number;
}

interface OpenClawBrowserRpcResponse {
  output?: string;
  text?: string;
  screenshotUrl?: string;
  error?: string;
}

export class Agent {
  private readonly wallet = new WalletManager();
  private readonly ledger = new Ledger();
  private readonly earner: Earner;
  private readonly spender: Spender;
  private readonly config: AgentConfig;

  private readonly openclawBaseUrl: string;
  private readonly starvationThreshold: bigint;
  private readonly cycleIntervalMinutes: number;

  private state: AgentState = {
    mode: 'NORMAL',
    cycleCount: 0,
    lastCycleAt: null,
    consecutiveFailures: 0,
    totalEarned: 0n,
    totalSpent: 0n,
    walletExplorerUrl: ''
  };

  constructor(config: AgentConfig) {
    this.config = config;
    this.openclawBaseUrl = config.openclawBaseUrl || process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
    this.starvationThreshold = config.starvationThresholdMist ?? 10_000_000n;
    this.cycleIntervalMinutes = config.cycleIntervalMinutes ?? 5;

    this.earner = new Earner(this.wallet, {
      network: config.network,
      bountyPackageId: config.bountyPackageId,
      bountyBoardId: config.bountyBoardId,
      openclawBaseUrl: this.openclawBaseUrl
    });

    this.spender = new Spender(this.wallet, {
      network: config.network,
      sealPackageId: config.sealPackageId,
      openclawBaseUrl: this.openclawBaseUrl,
      walrusEpochs: Number(process.env.WALRUS_EPOCHS || '3')
    });
  }

  async initialize(): Promise<void> {
    await this.wallet.initialize({
      keySource: this.config.keySource,
      network: this.config.network,
      bountyPackageId: this.config.bountyPackageId,
      bountyBoardId: this.config.bountyBoardId
    });

    this.state.walletExplorerUrl = this.wallet.getExplorerUrl();
  }

  async runCycle(): Promise<CycleResult> {
    const cycleNumber = ++this.state.cycleCount;
    const start = Date.now();

    const phases: CycleResult['phases'] = {
      healthCheck: {
        balance: 0n,
        sufficientBalance: false,
        bountyBoardReachable: false,
        openclawGatewayReachable: false,
        recommendedMode: this.state.mode
      },
      earn: null,
      spend: null,
      audit: null,
      verify: null,
      report: {
        pnlSummary: '',
        survivalStatus: '',
        nextCycleAt: new Date()
      }
    };

    try {
      phases.healthCheck = await this.healthCheck();
      this.state.mode = phases.healthCheck.recommendedMode;

      if (!phases.healthCheck.bountyBoardReachable) {
        throw new Error('BountyBoard contract unreachable');
      }

      phases.earn = await this.earner.earn();
      for (const claim of phases.earn.claims) {
        if (claim.success) {
          this.ledger.recordEarning(claim);
          this.state.totalEarned += claim.rewardAmount;
        }
      }

      if (this.state.mode !== 'STARVATION') {
        phases.spend = await this.spender.spend();
        for (const protection of phases.spend.protections) {
          if (protection.success) {
            this.ledger.recordSpending(protection);
            this.state.totalSpent += protection.gasSpent;
          }
        }
      }

      phases.audit = this.ledger.generateAuditPackage(this.wallet.getAddress());

      const digests = this.collectTxDigests(phases);
      phases.verify = digests.length > 0 ? await this.verifyOnChain(digests) : null;

      this.ledger.printSummary();
      phases.report = this.generateReport();

      this.state.consecutiveFailures = 0;
      this.state.lastCycleAt = new Date();

      return {
        cycleNumber,
        mode: this.state.mode,
        phases,
        duration: Date.now() - start,
        success: true
      };
    } catch (error) {
      this.state.consecutiveFailures += 1;

      return {
        cycleNumber,
        mode: this.state.mode,
        phases,
        duration: Date.now() - start,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const balance = await this.wallet.getBalance();
    const sufficientBalance = balance.sui > this.starvationThreshold;

    let bountyBoardReachable = false;
    try {
      await this.earner.getAvailableBounties();
      bountyBoardReachable = true;
    } catch {
      bountyBoardReachable = false;
    }

    let openclawGatewayReachable = false;
    try {
      const response = await fetch(`${this.openclawBaseUrl}/health`);
      openclawGatewayReachable = response.ok;
    } catch {
      openclawGatewayReachable = false;
    }

    let recommendedMode: AgentMode = 'NORMAL';
    if (!sufficientBalance) {
      recommendedMode = 'STARVATION';
    }
    if (this.state.consecutiveFailures >= 3) {
      recommendedMode = 'ERROR';
    }

    return {
      balance: balance.sui,
      sufficientBalance,
      bountyBoardReachable,
      openclawGatewayReachable,
      recommendedMode
    };
  }

  async verifyOnChain(txDigests: string[]): Promise<VerifyResult> {
    const token = process.env.OPENCLAW_TOKEN;
    const details: VerifyResult['details'] = [];
    let screenshotUrl: string | undefined;

    for (const digest of txDigests) {
      const explorerUrl = `https://suiscan.xyz/${this.config.network}/tx/${digest}`;
      let verified = false;

      if (token) {
        try {
          await this.callBrowserRpc(token, {
            action: 'navigate',
            url: explorerUrl
          });

          const snapshot = await this.callBrowserRpc(token, {
            action: 'snapshot'
          });

          const text = `${snapshot.text || ''} ${snapshot.output || ''}`;
          verified = text.includes('Success') || text.includes(digest);
          screenshotUrl = screenshotUrl || snapshot.screenshotUrl;
        } catch {
          verified = false;
        }
      }

      details.push({
        txDigest: digest,
        verified,
        explorerUrl
      });
    }

    const transactionsVerified = details.filter((item) => item.verified).length;

    return {
      transactionsVerified,
      allVerified: details.length > 0 ? transactionsVerified === details.length : true,
      screenshotUrl,
      details
    };
  }

  getState(): AgentState {
    return {
      ...this.state
    };
  }

  private collectTxDigests(phases: CycleResult['phases']): string[] {
    const digests: string[] = [];

    if (phases.earn?.claims) {
      for (const claim of phases.earn.claims) {
        if (claim.txDigest) {
          digests.push(claim.txDigest);
        }
      }
    }

    if (phases.spend?.protections) {
      for (const protection of phases.spend.protections) {
        if (protection.upload?.txDigest) {
          digests.push(protection.upload.txDigest);
        }
      }
    }

    return [...new Set(digests)];
  }

  private generateReport(): ReportResult {
    const pnl = this.ledger.generatePnL();
    const netProfit = Number(pnl.netProfit) / 1e9;
    const totalIncome = Number(pnl.totalIncome) / 1e9;
    const totalExpense = Number(pnl.totalExpense) / 1e9;

    const survivalStatus =
      pnl.netProfit > 0n
        ? '🟢 PROFITABLE — Agent is self-sustaining'
        : pnl.netProfit === 0n
          ? '🟡 BREAK-EVEN — Agent is surviving'
          : '🔴 LOSS — Agent needs more bounties';

    return {
      pnlSummary: [
        `Income: +${totalIncome.toFixed(4)} SUI`,
        `Expense: -${totalExpense.toFixed(4)} SUI`,
        `Net: ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(4)} SUI`,
        `Margin: ${(pnl.profitMargin * 100).toFixed(1)}%`,
        `Wallet: ${this.state.walletExplorerUrl}`
      ].join('\n'),
      survivalStatus,
      nextCycleAt: new Date(Date.now() + this.cycleIntervalMinutes * 60 * 1000)
    };
  }

  private async callBrowserRpc(
    token: string,
    params: { action: 'navigate'; url: string } | { action: 'snapshot' }
  ): Promise<OpenClawBrowserRpcResponse> {
    const response = await fetch(`${this.openclawBaseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        method: 'browser',
        params
      })
    });

    if (!response.ok) {
      throw new Error(`OpenClaw browser RPC failed: ${response.status}`);
    }

    const payload = (await response.json()) as OpenClawBrowserRpcResponse;
    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload;
  }
}