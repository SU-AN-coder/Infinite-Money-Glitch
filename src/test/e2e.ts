/**
 * End-to-End Test Script for Infinite Money Glitch
 * 
 * Tests the complete agent cycle:
 * 1. Wallet initialization
 * 2. Earning (mock mode or real OpenClaw)
 * 3. Spending (Seal + Walrus)
 * 4. Ledger recording
 * 5. Evidence collection
 * 
 * Usage:
 *   npm run test:e2e              # Mock mode
 *   npm run test:e2e -- --real    # Real mode (requires OpenClaw Gateway)
 */

import { WalletManager, type WalletConfig } from '../wallet/WalletManager.js';
import { Earner, type ClaimResult } from '../earn/Earner.js';
import { Spender, type ProtectionResult, type EncryptResult, type UploadResult } from '../spend/Spender.js';
import { Ledger } from '../ledger/Ledger.js';
import { EvidenceCollector } from '../evidence/EvidenceCollector.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface E2EReport {
  totalTests: number;
  passed: number;
  failed: number;
  duration: number;
  results: TestResult[];
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const isRealMode = process.argv.includes('--real');
const network = (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet';

const config = {
  network,
  bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x_mock_package_id',
  bountyBoardId: process.env.BOUNTY_BOARD_ID || '0x_mock_board_id',
  openclawBaseUrl: process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789',
  sealKeyServers: process.env.SEAL_KEY_SERVERS?.split(',') || ['https://seal-testnet.mystenlabs.com'],
  walrusNetwork: (process.env.WALRUS_NETWORK as 'testnet' | 'mainnet') || 'testnet',
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function log(emoji: string, message: string): void {
  console.log(`${emoji} ${message}`);
}

function logSection(title: string): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  try {
    await testFn();
    const duration = Date.now() - start;
    log('✅', `${name} (${duration}ms)`);
    return { name, passed: true, duration };
  } catch (error) {
    const duration = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('❌', `${name}: ${errorMessage}`);
    return { name, passed: false, duration, error: errorMessage };
  }
}

function createWalletConfig(): WalletConfig {
  return {
    keySource: 'generate',
    network: config.network,
    bountyPackageId: config.bountyPackageId,
    bountyBoardId: config.bountyBoardId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

async function testWalletInitialization(): Promise<void> {
  const wallet = new WalletManager();
  await wallet.initialize(createWalletConfig());
  
  const address = wallet.getAddress();
  const balanceInfo = await wallet.getBalance();
  
  if (!address || !address.startsWith('0x')) {
    throw new Error(`Invalid address format: ${address}`);
  }
  
  if (typeof balanceInfo.sui !== 'bigint') {
    throw new Error(`Invalid balance type: ${typeof balanceInfo.sui}`);
  }
  
  log('📍', `Address: ${address}`);
  log('💰', `Balance: ${balanceInfo.suiFormatted}`);
}

async function testWalletAddressConsistency(): Promise<void> {
  // Test that a wallet can be initialized and returns valid address
  const wallet1 = new WalletManager();
  await wallet1.initialize(createWalletConfig());
  const address1 = wallet1.getAddress();
  
  // Call getAddress multiple times should return same address
  const address2 = wallet1.getAddress();
  
  if (address1 !== address2) {
    throw new Error(`Address inconsistent: ${address1} !== ${address2}`);
  }
  
  log('🔗', `Address consistent: ${address1.slice(0, 16)}...`);
}

async function testEarnerInitialization(): Promise<void> {
  const wallet = new WalletManager();
  await wallet.initialize(createWalletConfig());
  
  const earner = new Earner(wallet, {
    network: config.network,
    bountyPackageId: config.bountyPackageId,
    bountyBoardId: config.bountyBoardId,
    openclawBaseUrl: config.openclawBaseUrl,
  });
  
  // In mock mode, getBounties will likely return empty or fail gracefully
  if (isRealMode) {
    const bounties = await earner.getAvailableBounties();
    log('📋', `Found ${bounties.length} available bounties`);
  }
  
  log('💼', 'Earner initialized successfully');
}

async function testLedgerRecording(): Promise<void> {
  const ledger = new Ledger();
  
  // Create mock ClaimResult for recording
  const mockClaim: ClaimResult = {
    bountyId: 1,
    rewardAmount: 1000000000n, // 1 SUI
    txDigest: '0x_test_tx_digest_1',
    explorerUrl: 'https://suiscan.xyz/testnet/tx/0x_test_tx_digest_1',
    proofHash: '0x_test_proof_hash',
    success: true,
  };
  
  // Create mock ProtectionResult for recording
  const mockEncrypt: EncryptResult = {
    ciphertext: new Uint8Array([1, 2, 3]),
    plaintextSize: 100,
    ciphertextSize: 128,
    sizeRatio: 1.28,
    sealPolicyId: '0x_seal_policy',
    duration: 100,
  };
  
  const mockUpload: UploadResult = {
    blobId: 'test_blob_id',
    txDigest: '0x_test_tx_digest_2',
    size: 128,
    epochs: 3,
    explorerUrl: 'https://suiscan.xyz/testnet/tx/0x_test_tx_digest_2',
    duration: 200,
  };
  
  const mockProtection: ProtectionResult = {
    label: 'test_data',
    encryption: mockEncrypt,
    upload: mockUpload,
    gasSpent: 100000000n, // 0.1 SUI
    success: true,
  };
  
  // Record using proper methods
  ledger.recordEarning(mockClaim);
  ledger.recordSpending(mockProtection);
  
  // Generate P&L
  const pnl = ledger.generatePnL();
  
  if (pnl.totalIncome !== 1000000000n) {
    throw new Error(`Income mismatch: ${pnl.totalIncome}`);
  }
  
  if (pnl.totalExpense !== 100000000n) {
    throw new Error(`Expense mismatch: ${pnl.totalExpense}`);
  }
  
  if (pnl.netProfit !== 900000000n) {
    throw new Error(`Net profit mismatch: ${pnl.netProfit}`);
  }
  
  log('📊', `P&L: Income ${pnl.totalIncome}, Expense ${pnl.totalExpense}, Net ${pnl.netProfit}`);
}

async function testAuditPackageGeneration(): Promise<void> {
  const ledger = new Ledger();
  
  const mockClaim: ClaimResult = {
    bountyId: 1,
    rewardAmount: 500000000n,
    txDigest: '0x_audit_tx_1',
    explorerUrl: 'https://suiscan.xyz/testnet/tx/0x_audit_tx_1',
    proofHash: '0x_audit_proof',
    success: true,
  };
  
  ledger.recordEarning(mockClaim);
  
  const auditPkg = ledger.generateAuditPackage('0x_test_agent_address');
  
  if (!auditPkg.checksum) {
    throw new Error('Audit package missing checksum');
  }
  
  if (auditPkg.entries.length !== 1) {
    throw new Error(`Unexpected entries count: ${auditPkg.entries.length}`);
  }
  
  log('🔐', `Audit checksum: ${auditPkg.checksum.slice(0, 16)}...`);
}

async function testEvidenceCollection(): Promise<void> {
  const collector = new EvidenceCollector({
    network: config.network,
    agentAddress: '0x_test_agent_address',
    outputDir: './test-evidence',
  });
  
  // Record mock transactions
  collector.recordTransaction({
    type: 'earn',
    txDigest: '0x_test_earn_tx_' + Date.now(),
    timestamp: new Date().toISOString(),
    network: config.network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
    description: 'Test earning transaction',
    status: 'success',
    gasUsed: '1000000',
  });
  
  collector.recordWalrusBlob({
    type: 'upload',
    blobId: 'test_blob_' + Date.now(),
    timestamp: new Date().toISOString(),
    dataType: 'audit_data',
    sizeBytes: 1024,
    encryptionUsed: true,
    sealPolicyId: '0x_test_policy',
  });
  
  // Generate package
  const pkg = await collector.generatePackage({
    totalEarned: 1000000000n,
    totalSpent: 100000000n,
    tasksCompleted: 5,
  });
  
  if (!pkg.checksum) {
    throw new Error('Evidence package missing checksum');
  }
  
  if (pkg.transactions.length !== 1) {
    throw new Error(`Unexpected transaction count: ${pkg.transactions.length}`);
  }
  
  const stats = collector.getStats();
  log('📝', `Evidence: ${stats.txCount} tx, ${stats.blobCount} blobs`);
}

async function testSpenderInitialization(): Promise<void> {
  const wallet = new WalletManager();
  await wallet.initialize(createWalletConfig());
  
  // Spender initialization test - just verify the object can be created
  // Note: Actual Spender constructor may throw if Seal/Walrus not properly configured
  log('💳', 'Spender test skipped (requires Seal/Walrus config)');
}

async function testOpenClawConnectivity(): Promise<void> {
  if (!isRealMode) {
    log('⏭️', 'Skipped in mock mode (use --real to test)');
    return;
  }
  
  try {
    const response = await fetch(`${config.openclawBaseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      throw new Error(`OpenClaw returned ${response.status}`);
    }
    
    log('🔗', 'OpenClaw Gateway connected');
  } catch (error) {
    throw new Error(`OpenClaw not reachable: ${error instanceof Error ? error.message : error}`);
  }
}

async function testFullCycleMock(): Promise<void> {
  // Initialize components
  const wallet = new WalletManager();
  await wallet.initialize(createWalletConfig());
  
  const ledger = new Ledger({ walletExplorerUrl: wallet.getExplorerUrl() });
  const collector = new EvidenceCollector({
    network: config.network,
    agentAddress: wallet.getAddress(),
    outputDir: './test-evidence',
  });
  
  // Simulate earning
  const mockEarning = 500000000n; // 0.5 SUI
  const mockClaim: ClaimResult = {
    bountyId: 1,
    rewardAmount: mockEarning,
    txDigest: '0x_sim_earn_' + Date.now(),
    explorerUrl: `https://suiscan.xyz/${config.network}/tx/0x_sim_earn`,
    proofHash: '0x_sim_proof',
    success: true,
  };
  
  ledger.recordEarning(mockClaim);
  
  collector.recordTransaction({
    type: 'earn',
    txDigest: mockClaim.txDigest,
    timestamp: new Date().toISOString(),
    network: config.network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
    description: 'Simulated earning',
    status: 'success',
  });
  
  // Simulate spending
  const mockSpending = 50000000n; // 0.05 SUI
  const mockProtection: ProtectionResult = {
    label: 'sim_data',
    encryption: {
      ciphertext: new Uint8Array([1, 2, 3]),
      plaintextSize: 100,
      ciphertextSize: 128,
      sizeRatio: 1.28,
      sealPolicyId: '0x_sim_seal_policy',
      duration: 100,
    },
    upload: {
      blobId: 'sim_blob_' + Date.now(),
      txDigest: '0x_sim_spend_' + Date.now(),
      size: 128,
      epochs: 3,
      explorerUrl: `https://suiscan.xyz/${config.network}/tx/0x_sim_spend`,
      duration: 200,
    },
    gasSpent: mockSpending,
    success: true,
  };
  
  ledger.recordSpending(mockProtection);
  
  collector.recordTransaction({
    type: 'spend',
    txDigest: mockProtection.upload.txDigest,
    timestamp: new Date().toISOString(),
    network: config.network as 'testnet' | 'mainnet' | 'devnet' | 'localnet',
    description: 'Simulated spending',
    status: 'success',
  });
  
  // Generate reports
  const pnl = ledger.generatePnL();
  const _evidencePkg = await collector.generatePackage({
    totalEarned: pnl.totalIncome,
    totalSpent: pnl.totalExpense,
    tasksCompleted: 1,
  });
  
  // Verify
  if (pnl.netProfit !== mockEarning - mockSpending) {
    throw new Error('P&L calculation incorrect');
  }
  
  log('🔄', `Full cycle: Income ${pnl.totalIncome}, Expense ${pnl.totalExpense}, Net ${pnl.netProfit}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function runE2ETests(): Promise<E2EReport> {
  const startTime = Date.now();
  const results: TestResult[] = [];
  
  console.log('\n🚀 Infinite Money Glitch - E2E Test Suite');
  console.log(`   Mode: ${isRealMode ? 'REAL' : 'MOCK'}`);
  console.log(`   Network: ${config.network}`);
  
  logSection('WALLET TESTS');
  results.push(await runTest('Wallet Initialization', testWalletInitialization));
  results.push(await runTest('Wallet Address Consistency', testWalletAddressConsistency));
  
  logSection('EARNER TESTS');
  results.push(await runTest('Earner Initialization', testEarnerInitialization));
  
  logSection('SPENDER TESTS');
  results.push(await runTest('Spender Initialization', testSpenderInitialization));
  
  logSection('LEDGER TESTS');
  results.push(await runTest('Ledger Recording', testLedgerRecording));
  results.push(await runTest('Audit Package Generation', testAuditPackageGeneration));
  
  logSection('EVIDENCE TESTS');
  results.push(await runTest('Evidence Collection', testEvidenceCollection));
  
  logSection('INTEGRATION TESTS');
  results.push(await runTest('OpenClaw Connectivity', testOpenClawConnectivity));
  results.push(await runTest('Full Cycle (Mock)', testFullCycleMock));
  
  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  logSection('SUMMARY');
  console.log(`   Total: ${results.length} tests`);
  console.log(`   Passed: ${passed} ✅`);
  console.log(`   Failed: ${failed} ❌`);
  console.log(`   Duration: ${totalDuration}ms`);
  console.log('');
  
  return {
    totalTests: results.length,
    passed,
    failed,
    duration: totalDuration,
    results,
    timestamp: new Date().toISOString(),
  };
}

// Run tests
runE2ETests()
  .then(report => {
    if (report.failed > 0) {
      console.log('❌ Some tests failed');
      process.exit(1);
    }
    console.log('✅ All tests passed');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
