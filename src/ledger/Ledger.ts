import { createHash, randomUUID } from 'node:crypto';
import type { ClaimResult } from '../earn/Earner.js';
import type { ProtectionResult } from '../spend/Spender.js';

export type TransactionDirection = 'income' | 'expense';

export type TransactionSource =
  | 'bounty_reward'
  | 'seal_encryption'
  | 'walrus_storage'
  | 'gas_fee'
  | 'transfer'
  | 'other';

export interface LedgerEntry {
  id: string;
  timestamp: Date;
  direction: TransactionDirection;
  source: TransactionSource;
  amount: bigint;
  description: string;
  taskHash?: string;
  bountyId?: number;
  txDigest?: string;
  blobId?: string;
  sealPolicyId?: string;
  explorerUrl?: string;
  taskType?: string;
  balanceAfter?: bigint;
}

export interface LedgerFilter {
  from?: Date;
  to?: Date;
  direction?: TransactionDirection;
  source?: TransactionSource;
}

export interface ProfitLossReport {
  period: {
    from: Date;
    to: Date;
  };
  totalIncome: bigint;
  totalExpense: bigint;
  netProfit: bigint;
  profitMargin: number;
  transactionCount: number;
  incomeBySource: Map<TransactionSource, bigint>;
  expenseBySource: Map<TransactionSource, bigint>;
  walletExplorerUrl: string;
}

export interface AuditPackage {
  generatedAt: Date;
  agentAddress: string;
  walletExplorerUrl: string;
  entries: LedgerEntry[];
  profitLoss: ProfitLossReport;
  onChainTransactions: {
    digest: string;
    explorerUrl: string;
    direction: TransactionDirection;
    amount: bigint;
    source: TransactionSource;
  }[];
  encryptedStorage: {
    blobId: string;
    sealPolicyId: string;
    label: string;
    size: number;
  }[];
  workProofs: {
    taskHash: string;
    bountyId: number;
    txDigest: string;
  }[];
  checksum: string;
}

export interface LedgerConfig {
  walletExplorerUrl?: string;
}

export class Ledger {
  private readonly entries: LedgerEntry[] = [];
  private walletExplorerUrl = '';

  constructor(config?: LedgerConfig) {
    if (config?.walletExplorerUrl) {
      this.walletExplorerUrl = config.walletExplorerUrl;
    }
  }

  record(entry: Omit<LedgerEntry, 'id' | 'timestamp'>): LedgerEntry {
    const fullEntry: LedgerEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      ...entry
    };

    this.entries.push(fullEntry);
    return fullEntry;
  }

  recordEarning(claimResult: ClaimResult): LedgerEntry {
    return this.record({
      direction: 'income',
      source: 'bounty_reward',
      amount: claimResult.rewardAmount,
      description: `Bounty #${claimResult.bountyId} reward claimed`,
      taskHash: claimResult.proofHash,
      bountyId: claimResult.bountyId,
      txDigest: claimResult.txDigest,
      explorerUrl: claimResult.explorerUrl
    });
  }

  recordSpending(protectionResult: ProtectionResult): LedgerEntry {
    return this.record({
      direction: 'expense',
      source: 'seal_encryption',
      amount: protectionResult.gasSpent,
      description: `Protected "${protectionResult.label}"`,
      blobId: protectionResult.upload?.blobId,
      sealPolicyId: protectionResult.encryption?.sealPolicyId,
      txDigest: protectionResult.upload?.txDigest,
      explorerUrl: protectionResult.upload?.explorerUrl
    });
  }

  getEntries(filter?: LedgerFilter): LedgerEntry[] {
    if (!filter) {
      return [...this.entries];
    }

    return this.entries.filter((entry) => {
      if (filter.from && entry.timestamp < filter.from) {
        return false;
      }
      if (filter.to && entry.timestamp > filter.to) {
        return false;
      }
      if (filter.direction && entry.direction !== filter.direction) {
        return false;
      }
      if (filter.source && entry.source !== filter.source) {
        return false;
      }
      return true;
    });
  }

  generatePnL(from?: Date, to?: Date): ProfitLossReport {
    const filtered = this.getEntries({ from, to });

    let totalIncome = 0n;
    let totalExpense = 0n;
    const incomeBySource = new Map<TransactionSource, bigint>();
    const expenseBySource = new Map<TransactionSource, bigint>();

    for (const entry of filtered) {
      if (entry.direction === 'income') {
        totalIncome += entry.amount;
        incomeBySource.set(entry.source, (incomeBySource.get(entry.source) || 0n) + entry.amount);
      } else {
        totalExpense += entry.amount;
        expenseBySource.set(entry.source, (expenseBySource.get(entry.source) || 0n) + entry.amount);
      }
    }

    const netProfit = totalIncome - totalExpense;
    const profitMargin = totalIncome > 0n ? Number(netProfit) / Number(totalIncome) : 0;

    return {
      period: {
        from: from || filtered[0]?.timestamp || new Date(),
        to: to || filtered[filtered.length - 1]?.timestamp || new Date()
      },
      totalIncome,
      totalExpense,
      netProfit,
      profitMargin,
      transactionCount: filtered.length,
      incomeBySource,
      expenseBySource,
      walletExplorerUrl: this.walletExplorerUrl
    };
  }

  generateAuditPackage(agentAddress: string): AuditPackage {
    const entries = this.getEntries();
    const profitLoss = this.generatePnL();

    const onChainTransactions = entries
      .filter((entry) => entry.txDigest)
      .map((entry) => ({
        digest: entry.txDigest || '',
        explorerUrl: entry.explorerUrl || '',
        direction: entry.direction,
        amount: entry.amount,
        source: entry.source
      }));

    const encryptedStorage = entries
      .filter((entry) => entry.blobId)
      .map((entry) => ({
        blobId: entry.blobId || '',
        sealPolicyId: entry.sealPolicyId || '',
        label: entry.description,
        size: 0
      }));

    const workProofs = entries
      .filter((entry) => entry.taskHash && entry.bountyId !== undefined)
      .map((entry) => ({
        taskHash: entry.taskHash || '',
        bountyId: entry.bountyId as number,
        txDigest: entry.txDigest || ''
      }));

    const packageData = {
      generatedAt: new Date(),
      agentAddress,
      walletExplorerUrl: this.walletExplorerUrl,
      entries,
      profitLoss,
      onChainTransactions,
      encryptedStorage,
      workProofs
    };

    const checksum = createHash('sha256')
      .update(
        JSON.stringify(packageData, (_, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value
        )
      )
      .digest('hex');

    return {
      ...packageData,
      checksum
    };
  }

  printSummary(): void {
    const pnl = this.generatePnL();
    const income = (Number(pnl.totalIncome) / 1e9).toFixed(4);
    const expense = (Number(pnl.totalExpense) / 1e9).toFixed(4);
    const net = (Number(pnl.netProfit) / 1e9).toFixed(4);
    const margin = (pnl.profitMargin * 100).toFixed(2);

    console.log('=== Ledger Summary ===');
    console.log(`Transactions: ${pnl.transactionCount}`);
    console.log(`Income: +${income} SUI`);
    console.log(`Expense: -${expense} SUI`);
    console.log(`Net: ${net} SUI`);
    console.log(`Margin: ${margin}%`);
    if (pnl.walletExplorerUrl) {
      console.log(`Wallet Explorer: ${pnl.walletExplorerUrl}`);
    }
  }

  exportToJson(): string {
    return JSON.stringify(
      this.entries,
      (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2
    );
  }
}