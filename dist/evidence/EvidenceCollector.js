/**
 * EvidenceCollector - Collects and persists on-chain evidence
 *
 * Records tx digests, blob IDs, and Explorer URLs for:
 * - Hackathon submission proof
 * - Audit trail
 * - Demo verification
 */
import { createHash } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// ═══════════════════════════════════════════════════════════════════════════════
// EVIDENCE COLLECTOR
// ═══════════════════════════════════════════════════════════════════════════════
export class EvidenceCollector {
    transactions = [];
    walrusBlobs = [];
    contract;
    outputDir;
    network;
    agentAddress;
    constructor(config) {
        this.outputDir = config.outputDir || './evidence';
        this.network = config.network;
        this.agentAddress = config.agentAddress;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // RECORD METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Record a transaction on Sui blockchain
     */
    recordTransaction(evidence) {
        const explorerUrl = this.buildExplorerUrl(evidence.txDigest, 'tx');
        this.transactions.push({
            ...evidence,
            explorerUrl
        });
        console.log(`📝 Recorded ${evidence.type} tx: ${evidence.txDigest.slice(0, 16)}...`);
    }
    /**
     * Record a Walrus blob upload
     */
    recordWalrusBlob(evidence) {
        this.walrusBlobs.push(evidence);
        console.log(`📝 Recorded Walrus blob: ${evidence.blobId.slice(0, 16)}...`);
    }
    /**
     * Record contract deployment
     */
    recordDeployment(deployment) {
        this.contract = deployment;
        console.log(`📝 Recorded contract deployment: ${deployment.packageId}`);
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORT METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Generate complete evidence package
     */
    async generatePackage(financials) {
        const totalGasUsed = this.transactions
            .filter(t => t.gasUsed)
            .reduce((sum, t) => sum + BigInt(t.gasUsed || '0'), 0n);
        const pkg = {
            projectName: 'Infinite Money Glitch',
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            agentAddress: this.agentAddress,
            network: this.network,
            contract: this.contract,
            transactions: this.transactions,
            walrusBlobs: this.walrusBlobs,
            summary: {
                totalEarned: financials.totalEarned.toString(),
                totalSpent: financials.totalSpent.toString(),
                netProfit: (financials.totalEarned - financials.totalSpent).toString(),
                tasksCompleted: financials.tasksCompleted,
                blobsUploaded: this.walrusBlobs.length,
                totalGasUsed: totalGasUsed.toString()
            },
            checksum: '' // Will be computed
        };
        // Compute checksum
        pkg.checksum = this.computeChecksum(pkg);
        return pkg;
    }
    /**
     * Save evidence package to file
     */
    async savePackage(pkg) {
        await this.ensureOutputDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `evidence-${this.network}-${timestamp}.json`;
        const filepath = join(this.outputDir, filename);
        await writeFile(filepath, JSON.stringify(pkg, null, 2), 'utf-8');
        console.log(`💾 Evidence saved to: ${filepath}`);
        return filepath;
    }
    /**
     * Generate markdown report for hackathon submission
     */
    async generateMarkdownReport(pkg) {
        const lines = [
            '# 🧾 Infinite Money Glitch - On-Chain Evidence Report',
            '',
            `**Generated:** ${pkg.generatedAt}`,
            `**Network:** ${pkg.network}`,
            `**Agent Address:** \`${pkg.agentAddress}\``,
            '',
            '---',
            '',
            '## 📊 Summary',
            '',
            '| Metric | Value |',
            '|--------|-------|',
            `| Total Earned | ${this.formatSui(pkg.summary.totalEarned)} SUI |`,
            `| Total Spent | ${this.formatSui(pkg.summary.totalSpent)} SUI |`,
            `| Net Profit | ${this.formatSui(pkg.summary.netProfit)} SUI |`,
            `| Tasks Completed | ${pkg.summary.tasksCompleted} |`,
            `| Blobs Uploaded | ${pkg.summary.blobsUploaded} |`,
            `| Gas Used | ${this.formatSui(pkg.summary.totalGasUsed)} SUI |`,
            '',
        ];
        if (pkg.contract) {
            lines.push('## 🏗️ Contract Deployment', '', `- **Package ID:** \`${pkg.contract.packageId}\``, `- **BountyBoard Object:** \`${pkg.contract.boardObjectId}\``, `- **Deploy TX:** [${pkg.contract.deployTxDigest.slice(0, 16)}...](${pkg.contract.explorerUrl})`, `- **Deployed At:** ${pkg.contract.timestamp}`, '');
        }
        lines.push('## 💰 Transactions', '', '| Type | TX Digest | Status | Explorer |', '|------|-----------|--------|----------|');
        for (const tx of pkg.transactions) {
            lines.push(`| ${tx.type} | \`${tx.txDigest.slice(0, 16)}...\` | ${tx.status} | [View](${tx.explorerUrl}) |`);
        }
        if (pkg.walrusBlobs.length > 0) {
            lines.push('', '## 🐋 Walrus Blobs', '', '| Type | Blob ID | Size | Encrypted |', '|------|---------|------|-----------|');
            for (const blob of pkg.walrusBlobs) {
                lines.push(`| ${blob.dataType} | \`${blob.blobId.slice(0, 16)}...\` | ${this.formatBytes(blob.sizeBytes)} | ${blob.encryptionUsed ? '✅' : '❌'} |`);
            }
        }
        lines.push('', '## 🔐 Integrity', '', `**Package Checksum (SHA-256):** \`${pkg.checksum}\``, '', '---', '', '*This report was automatically generated by Infinite Money Glitch agent.*');
        const markdown = lines.join('\n');
        // Save markdown
        await this.ensureOutputDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filepath = join(this.outputDir, `evidence-report-${timestamp}.md`);
        await writeFile(filepath, markdown, 'utf-8');
        console.log(`📄 Markdown report saved to: ${filepath}`);
        return markdown;
    }
    /**
     * Load existing evidence from file
     */
    async loadFromFile(filepath) {
        const content = await readFile(filepath, 'utf-8');
        const pkg = JSON.parse(content);
        this.transactions = pkg.transactions;
        this.walrusBlobs = pkg.walrusBlobs;
        this.contract = pkg.contract;
        console.log(`📂 Loaded ${this.transactions.length} transactions from ${filepath}`);
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // GETTERS
    // ═══════════════════════════════════════════════════════════════════════════
    getTransactions() {
        return [...this.transactions];
    }
    getWalrusBlobs() {
        return [...this.walrusBlobs];
    }
    getContract() {
        return this.contract;
    }
    getStats() {
        return {
            txCount: this.transactions.length,
            blobCount: this.walrusBlobs.length,
            hasContract: !!this.contract
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    buildExplorerUrl(digest, type) {
        const base = this.network === 'mainnet'
            ? 'https://suiscan.xyz/mainnet'
            : `https://suiscan.xyz/${this.network}`;
        return `${base}/${type}/${digest}`;
    }
    computeChecksum(pkg) {
        const data = JSON.stringify({
            ...pkg,
            checksum: undefined
        });
        return createHash('sha256').update(data).digest('hex');
    }
    async ensureOutputDir() {
        if (!existsSync(this.outputDir)) {
            await mkdir(this.outputDir, { recursive: true });
        }
    }
    formatSui(mist) {
        const value = BigInt(mist);
        const sui = Number(value) / 1_000_000_000;
        return sui.toFixed(4);
    }
    formatBytes(bytes) {
        if (bytes < 1024)
            return `${bytes} B`;
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
let instance = null;
export function getEvidenceCollector(config) {
    if (!instance && config) {
        instance = new EvidenceCollector(config);
    }
    if (!instance) {
        throw new Error('EvidenceCollector not initialized. Call with config first.');
    }
    return instance;
}
export function resetEvidenceCollector() {
    instance = null;
}
