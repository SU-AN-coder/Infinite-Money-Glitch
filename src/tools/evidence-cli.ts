/**
 * Evidence CLI - Generate and manage on-chain evidence
 * 
 * Usage:
 *   npm run evidence:generate           # Generate evidence package from ledger
 *   npm run evidence:generate -- --demo # Generate demo evidence with mock data
 */

import { EvidenceCollector, EvidencePackage } from '../evidence/EvidenceCollector.js';
import { Ledger } from '../ledger/Ledger.js';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const isDemoMode = process.argv.includes('--demo');
const network = (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet';
const outputDir = process.env.EVIDENCE_OUTPUT_DIR || './evidence';
const agentAddress = process.env.AGENT_ADDRESS || '0x_demo_agent_address';

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

  const collector = new EvidenceCollector({
    network,
    agentAddress,
    outputDir,
  });

  let financials = {
    totalEarned: 0n,
    totalSpent: 0n,
    tasksCompleted: 0,
  };

  if (isDemoMode) {
    log('🎭', 'Generating demo evidence...');
    generateDemoEvidence(collector);
    financials = {
      totalEarned: 1500000000n, // 1.5 SUI
      totalSpent: 150000000n,   // 0.15 SUI
      tasksCompleted: 3,
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
      log('⚠️', 'No ledger.json found. Run with --demo for sample data.');
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
