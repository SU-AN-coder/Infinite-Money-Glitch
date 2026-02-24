import '../shared/loadEnv.js';
/**
 * Evidence CLI - Generate and manage on-chain evidence
 * 
 * Usage:
 *   npm run evidence:generate           # Generate evidence package from ledger
 *   npm run evidence:generate -- --demo # Generate demo evidence with mock data
 */

import { EvidenceCollector, EvidencePackage } from '../evidence/EvidenceCollector.js';
import { Ledger } from '../ledger/Ledger.js';
import { WalletManager } from '../wallet/WalletManager.js';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const isDemoMode = process.argv.includes('--demo');
const network = (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet';
const outputDir = process.env.EVIDENCE_OUTPUT_DIR || './evidence';
const configuredAgentAddress = process.env.AGENT_ADDRESS || '';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function log(emoji: string, message: string): void {
  console.log(`${emoji} ${message}`);
}

async function ensureOutputDir(): Promise<void> {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }
}

function safeBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

async function findLatestEvidencePackage(): Promise<string | null> {
  if (!existsSync(outputDir)) {
    return null;
  }

  const files = await readdir(outputDir);
  const candidates = files
    .filter((name) => name.startsWith(`evidence-${network}-`) && name.endsWith('.json'))
    .map((name) => ({
      name,
      path: join(outputDir, name)
    }))
    .sort((left, right) => right.name.localeCompare(left.name));

  return candidates.length > 0 ? candidates[0].path : null;
}

async function resolveAgentAddress(): Promise<string> {
  if (isDemoMode) {
    return configuredAgentAddress || '0x_demo_agent_address';
  }

  if (configuredAgentAddress && configuredAgentAddress.trim() !== '0x') {
    return configuredAgentAddress.trim();
  }

  try {
    const wallet = new WalletManager();
    await wallet.initialize({
      keySource: (process.env.WALLET_KEY_SOURCE as 'env' | 'generate') || 'env',
      network,
      bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x',
      bountyBoardId: process.env.BOUNTY_BOARD_ID || '0x'
    });
    return wallet.getAddress();
  } catch {
    return '0x_unknown';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO DATA
// ═══════════════════════════════════════════════════════════════════════════════

function generateDemoEvidence(collector: EvidenceCollector): void {
  const now = Date.now();
  
  // Record mock contract deployment
  collector.recordDeployment({
    packageId: '0x_demo_package_' + now.toString(36),
    boardObjectId: '0x_demo_board_' + now.toString(36),
    deployTxDigest: '0x_demo_deploy_tx_' + now.toString(36),
    network: network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
    timestamp: new Date().toISOString(),
    explorerUrl: `https://suiscan.xyz/${network}/tx/0x_demo_deploy_tx_${now.toString(36)}`,
  });

  // Record mock earning transactions
  for (let i = 0; i < 3; i++) {
    collector.recordTransaction({
      type: 'earn',
      txDigest: `0x_demo_earn_${i}_${now.toString(36)}`,
      timestamp: new Date(now - i * 60000).toISOString(),
      network: network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
      description: `Completed bounty task ${i + 1}: tmp_scan`,
      status: 'success',
      gasUsed: String(1000000 + i * 100000),
    });
  }

  // Record mock spending transactions
  for (let i = 0; i < 2; i++) {
    collector.recordTransaction({
      type: 'spend',
      txDigest: `0x_demo_spend_${i}_${now.toString(36)}`,
      timestamp: new Date(now - (i + 3) * 60000).toISOString(),
      network: network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
      description: `Uploaded audit data to Walrus ${i + 1}`,
      status: 'success',
      gasUsed: String(500000 + i * 50000),
    });
  }

  // Record mock Walrus blobs
  for (let i = 0; i < 2; i++) {
    collector.recordWalrusBlob({
      type: 'upload',
      blobId: `demo_blob_${i}_${now.toString(36)}`,
      timestamp: new Date(now - (i + 5) * 60000).toISOString(),
      dataType: i === 0 ? 'audit_package' : 'pnl_report',
      sizeBytes: 1024 + i * 512,
      encryptionUsed: true,
      sealPolicyId: `0x_demo_policy_${i}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\n📊 Evidence Generator');
  console.log(`   Mode: ${isDemoMode ? 'DEMO' : 'LIVE'}`);
  console.log(`   Network: ${network}`);
  console.log(`   Output: ${outputDir}\n`);

  await ensureOutputDir();

  const agentAddress = await resolveAgentAddress();

  const collector = new EvidenceCollector({
    network,
    agentAddress,
    outputDir,
  });

  let financials = {
    totalEarned: 0n,
    totalSpent: 0n,
    tasksCompleted: 0,
    sealAttempts: 0,
    sealFailures: 0,
    walrusAttempts: 0,
    walrusFailures: 0,
  };

  if (isDemoMode) {
    log('🎭', 'Generating demo evidence...');
    generateDemoEvidence(collector);
    financials = {
      totalEarned: 1500000000n, // 1.5 SUI
      totalSpent: 150000000n,   // 0.15 SUI
      tasksCompleted: 3,
      sealAttempts: 2,
      sealFailures: 0,
      walrusAttempts: 2,
      walrusFailures: 0,
    };
  } else {
    // Try to load from existing ledger file
    const ledgerPath = join(process.cwd(), 'ledger.json');
    if (existsSync(ledgerPath)) {
      log('📂', 'Loading ledger data...');
      const ledgerData = JSON.parse(await readFile(ledgerPath, 'utf-8'));
      
      // Convert ledger entries to evidence
      for (const entry of ledgerData.entries || []) {
        collector.recordTransaction({
          type: entry.type,
          txDigest: entry.txDigest || '0x_missing',
          timestamp: entry.timestamp,
          network: network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
          description: entry.description || entry.source || entry.purpose,
          status: 'success',
        });

        if (entry.type === 'earning') {
          financials.totalEarned += BigInt(entry.amount || 0);
          financials.tasksCompleted++;
        } else if (entry.type === 'spending') {
          financials.totalSpent += BigInt(entry.amount || 0);
        }
      }
      log('✅', `Loaded ${ledgerData.entries?.length || 0} entries`);
    } else {
      const latestEvidencePath = await findLatestEvidencePackage();
      if (latestEvidencePath) {
        log('📂', `Loading latest evidence package: ${latestEvidencePath}`);
        await collector.loadFromFile(latestEvidencePath);

        const previous = JSON.parse(await readFile(latestEvidencePath, 'utf-8')) as EvidencePackage;
        financials = {
          totalEarned: safeBigInt(previous.summary.totalEarned),
          totalSpent: safeBigInt(previous.summary.totalSpent),
          tasksCompleted: previous.summary.tasksCompleted || 0,
          sealAttempts: previous.summary.sealAttempts || 0,
          sealFailures: previous.summary.sealFailures || 0,
          walrusAttempts: previous.summary.walrusAttempts || 0,
          walrusFailures: previous.summary.walrusFailures || 0,
        };

        if (previous.contract) {
          collector.recordDeployment(previous.contract);
        }
      } else {
        log('⚠️', 'No ledger.json or prior evidence package found. Run npm run start first, or use --demo.');
      }
    }

    const deploymentPath = join(process.cwd(), 'deployment.json');
    const existingContract = collector.getContract();
    const shouldOverrideUnknown =
      !!existingContract &&
      (!existingContract.deployTxDigest || existingContract.deployTxDigest === 'unknown');

    if (existsSync(deploymentPath) && (!existingContract || shouldOverrideUnknown)) {
      try {
        const deployment = JSON.parse(await readFile(deploymentPath, 'utf-8')) as {
          success?: boolean;
          network?: string;
          packageId?: string;
          boardObjectId?: string;
          deployTxDigest?: string;
          timestamp?: string;
          explorerUrl?: string;
        };

        if (deployment.success && deployment.packageId && deployment.boardObjectId && deployment.deployTxDigest) {
          collector.recordDeployment({
            packageId: deployment.packageId,
            boardObjectId: deployment.boardObjectId,
            deployTxDigest: deployment.deployTxDigest,
            network: (deployment.network as 'testnet' | 'mainnet' | 'devnet' | 'localnet') || (network as 'testnet' | 'mainnet' | 'devnet' | 'localnet'),
            timestamp: deployment.timestamp || new Date().toISOString(),
            explorerUrl: deployment.explorerUrl || `https://suiscan.xyz/${network}/tx/${deployment.deployTxDigest}`,
          });
        }
      } catch {
        // ignore malformed deployment metadata
      }
    }

    if (!collector.getContract()) {
      const packageId = process.env.BOUNTY_PACKAGE_ID?.trim();
      const boardObjectId = process.env.BOUNTY_BOARD_ID?.trim();
      if (packageId && packageId !== '0x' && boardObjectId && boardObjectId !== '0x') {
        const deployTxDigest = process.env.BOUNTY_DEPLOY_TX_DIGEST?.trim() || 'unknown';
        collector.recordDeployment({
          packageId,
          boardObjectId,
          deployTxDigest,
          network: network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
          timestamp: new Date().toISOString(),
          explorerUrl:
            deployTxDigest !== 'unknown'
              ? `https://suiscan.xyz/${network}/tx/${deployTxDigest}`
              : `https://suiscan.xyz/${network}/object/${boardObjectId}`
        });
      }
    }
  }

  // Generate package
  log('📦', 'Generating evidence package...');
  const pkg = await collector.generatePackage(financials);
  
  // Save JSON
  const jsonPath = await collector.savePackage(pkg);
  
  // Generate markdown report
  await collector.generateMarkdownReport(pkg);

  // Print summary
  console.log('\n' + '═'.repeat(50));
  console.log('  EVIDENCE SUMMARY');
  console.log('═'.repeat(50));
  console.log(`  Transactions: ${pkg.transactions.length}`);
  console.log(`  Walrus Blobs: ${pkg.walrusBlobs.length}`);
  console.log(`  Contract: ${pkg.contract ? '✅' : '❌'}`);
  console.log(`  Total Earned: ${formatSui(pkg.summary.totalEarned)} SUI`);
  console.log(`  Total Spent: ${formatSui(pkg.summary.totalSpent)} SUI`);
  console.log(`  Net Profit: ${formatSui(pkg.summary.netProfit)} SUI`);
  console.log(`  Checksum: ${pkg.checksum.slice(0, 16)}...`);
  console.log('═'.repeat(50) + '\n');

  log('✅', 'Evidence generation complete!');
}

function formatSui(mist: string): string {
  const value = BigInt(mist);
  const sui = Number(value) / 1_000_000_000;
  return sui.toFixed(4);
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
