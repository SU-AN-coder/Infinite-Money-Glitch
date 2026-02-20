import { createHash, randomUUID } from 'node:crypto';
export class Ledger {
    entries = [];
    walletExplorerUrl = '';
    constructor(config) {
        if (config?.walletExplorerUrl) {
            this.walletExplorerUrl = config.walletExplorerUrl;
        }
    }
    record(entry) {
        const fullEntry = {
            id: randomUUID(),
            timestamp: new Date(),
            ...entry
        };
        this.entries.push(fullEntry);
        return fullEntry;
    }
    recordEarning(claimResult) {
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
    recordSpending(protectionResult) {
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
    getEntries(filter) {
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
    generatePnL(from, to) {
        const filtered = this.getEntries({ from, to });
        let totalIncome = 0n;
        let totalExpense = 0n;
        const incomeBySource = new Map();
        const expenseBySource = new Map();
        for (const entry of filtered) {
            if (entry.direction === 'income') {
                totalIncome += entry.amount;
                incomeBySource.set(entry.source, (incomeBySource.get(entry.source) || 0n) + entry.amount);
            }
            else {
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
    generateAuditPackage(agentAddress) {
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
            bountyId: entry.bountyId,
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
            .update(JSON.stringify(packageData, (_, value) => typeof value === 'bigint' ? value.toString() : value))
            .digest('hex');
        return {
            ...packageData,
            checksum
        };
    }
    printSummary() {
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
    exportToJson() {
        return JSON.stringify(this.entries, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2);
    }
}
