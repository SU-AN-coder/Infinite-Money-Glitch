import './shared/loadEnv.js';
import { WalletManager, type WalletConfig } from './wallet/WalletManager.js';
import { Earner, type EarnerConfig } from './earn/Earner.js';
import { Spender, type SpenderConfig } from './spend/Spender.js';
import { Ledger } from './ledger/Ledger.js';
import { Agent, type AgentConfig } from './agent/Agent.js';
import { runDemo } from './agent/DemoRunner.js';
import { EvidenceCollector } from './evidence/EvidenceCollector.js';
import { getRevenueRoadmapSummary } from './earn/extensions/OpportunityExpansion.js';

async function main(): Promise<void> {
  if (process.env.RUN_DEMO === 'true') {
    await runDemoMode();
    return;
  }

  if (process.env.RUN_AGENT === 'true') {
    await runAgentMode();
    return;
  }

  await runModuleDemos();
}

async function runAgentMode(): Promise<void> {
  const config = getAgentConfig();
  console.log(`📈 ${getRevenueRoadmapSummary()}`);

  const agent = new Agent(config);
  await agent.initialize();
  const result = await agent.runCycle();

  console.log('=== Agent Cycle Result ===');
  console.log(
    JSON.stringify(
      {
        success: result.success,
        cycle: result.cycleNumber,
        mode: result.mode,
        duration: result.duration,
        earned: result.phases.earn?.totalEarned?.toString() || '0',
        spent: result.phases.spend?.totalGasSpent?.toString() || '0',
        error: result.error
      },
      null,
      2
    )
  );

  if (process.env.COLLECT_EVIDENCE === 'true') {
    await persistCycleEvidence(config, result);
  }
}

async function runDemoMode(): Promise<void> {
  const config = getAgentConfig();
  const result = await runDemo(config);

  console.log('=== Demo Result ===');
  console.log(
    JSON.stringify(
      {
        success: result.success,
        cycle: result.cycle,
        duration: result.duration,
        summary: result.summary
      },
      null,
      2
    )
  );
}

function getAgentConfig(): AgentConfig {
  return {
    network: (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet',
    keySource: (process.env.WALLET_KEY_SOURCE as 'env' | 'generate') || 'env',
    bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x',
    bountyBoardId: process.env.BOUNTY_BOARD_ID || '0x',
    sealPackageId: process.env.SEAL_PACKAGE_ID || '0x',
    openclawBaseUrl: process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789',
    cycleIntervalMinutes: Number(process.env.AGENT_CYCLE_MINUTES || '5')
  };
}

async function persistCycleEvidence(config: AgentConfig, result: Awaited<ReturnType<Agent['runCycle']>>): Promise<void> {
  const agentAddress = await resolveAgentAddress(config);
  const collector = new EvidenceCollector({
    network: config.network,
    agentAddress,
    outputDir: process.env.EVIDENCE_OUTPUT_DIR || './evidence'
  });

  const packageId = process.env.BOUNTY_PACKAGE_ID?.trim();
  const boardObjectId = process.env.BOUNTY_BOARD_ID?.trim();
  if (packageId && packageId !== '0x' && boardObjectId && boardObjectId !== '0x') {
    const deployTxDigest = process.env.BOUNTY_DEPLOY_TX_DIGEST?.trim() || 'unknown';
    collector.recordDeployment({
      packageId,
      boardObjectId,
      deployTxDigest,
      network: config.network,
      timestamp: new Date().toISOString(),
      explorerUrl:
        deployTxDigest !== 'unknown'
          ? `https://suiscan.xyz/${config.network}/tx/${deployTxDigest}`
          : `https://suiscan.xyz/${config.network}/object/${boardObjectId}`
    });
  }

  if (result.phases.earn?.claims) {
    for (const claim of result.phases.earn.claims) {
      collector.recordTransaction({
        type: 'claim',
        txDigest: claim.txDigest || `missing-claim-${Date.now()}`,
        timestamp: new Date().toISOString(),
        network: config.network,
        description: `Bounty #${claim.bountyId} claim`,
        status: claim.success ? 'success' : 'failure'
      });
    }
  }

  if (result.phases.spend?.protections) {
    for (const protection of result.phases.spend.protections) {
      collector.recordTransaction({
        type: 'spend',
        txDigest: protection.upload?.txDigest || `missing-spend-${Date.now()}`,
        timestamp: new Date().toISOString(),
        network: config.network,
        description: `Protect ${protection.label}`,
        status: protection.success ? 'success' : 'failure'
      });

      if (protection.upload?.blobId) {
        collector.recordWalrusBlob({
          type: 'upload',
          blobId: protection.upload.blobId,
          timestamp: new Date().toISOString(),
          dataType: protection.label,
          sizeBytes: protection.upload.size,
          encryptionUsed: true,
          sealPolicyId: protection.encryption?.sealPolicyId
        });
      }
    }
  }

  const totalEarned = result.phases.earn?.totalEarned || 0n;
  const totalSpent = result.phases.spend?.totalGasSpent || 0n;
  const tasksCompleted = result.phases.earn?.tasksCompleted || 0;
  const protections = result.phases.spend?.protections || [];
  const sealAttempts = protections.length;
  const sealFailures = protections.filter((item) => !item.success).length;
  const walrusAttempts = protections.length;
  const walrusFailures = protections.filter((item) => !item.upload?.blobId).length;

  const pkg = await collector.generatePackage({
    totalEarned,
    totalSpent,
    tasksCompleted,
    sealAttempts,
    sealFailures,
    walrusAttempts,
    walrusFailures
  });

  const jsonPath = await collector.savePackage(pkg);
  await collector.generateMarkdownReport(pkg);
  console.log(`Evidence package generated: ${jsonPath}`);
}

async function resolveAgentAddress(config: AgentConfig): Promise<string> {
  const configured = process.env.AGENT_ADDRESS?.trim();
  if (configured && configured !== '0x') {
    return configured;
  }

  try {
    const wallet = new WalletManager();
    await wallet.initialize({
      keySource: config.keySource,
      network: config.network,
      bountyPackageId: config.bountyPackageId,
      bountyBoardId: config.bountyBoardId
    });
    return wallet.getAddress();
  } catch {
    return '0x';
  }
}

async function runModuleDemos(): Promise<void> {
  const config: WalletConfig = {
    keySource: (process.env.WALLET_KEY_SOURCE as 'env' | 'generate') || 'env',
    network: (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet',
    bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x',
    bountyBoardId: process.env.BOUNTY_BOARD_ID || '0x'
  };

  const wallet = new WalletManager();
  await wallet.initialize(config);

  const info = wallet.exportPublicInfo();
  const balance = await wallet.getBalance();

  console.log('=== Wallet Module Demo ===');
  console.log(`Address: ${info.address}`);
  console.log(`Explorer: ${info.explorerUrl}`);
  console.log(`Balance: ${balance.suiFormatted}`);
  console.log(`Updated: ${balance.updatedAt.toISOString()}`);

  const ledger = new Ledger({
    walletExplorerUrl: info.explorerUrl
  });

  const shouldRunEarner = process.env.RUN_EARNER === 'true';
  if (!shouldRunEarner) {
    return;
  }

  const earnerConfig: EarnerConfig = {
    network: config.network,
    bountyPackageId: config.bountyPackageId,
    bountyBoardId: config.bountyBoardId,
    openclawBaseUrl: process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789'
  };

  const earner = new Earner(wallet, earnerConfig);
  const earnResult = await earner.earn();

  for (const claim of earnResult.claims) {
    if (claim.success) {
      ledger.recordEarning(claim);
    }
  }

  console.log('=== Earner Module Demo ===');
  console.log(`Tasks found: ${earnResult.tasksFound}`);
  console.log(`Tasks completed: ${earnResult.tasksCompleted}`);
  console.log(`Total earned: ${Number(earnResult.totalEarned) / 1_000_000_000} SUI`);

  const shouldRunSpender = process.env.RUN_SPENDER === 'true';
  if (!shouldRunSpender) {
    return;
  }

  const spenderConfig: SpenderConfig = {
    network: config.network,
    sealPackageId: process.env.SEAL_PACKAGE_ID || '0x',
    openclawBaseUrl: process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789',
    walrusEpochs: Number(process.env.WALRUS_EPOCHS || '3')
  };

  const spender = new Spender(wallet, spenderConfig);
  const spendResult = await spender.spend();

  for (const protection of spendResult.protections) {
    if (protection.success) {
      ledger.recordSpending(protection);
    }
  }

  console.log('=== Spender Module Demo ===');
  console.log(`Items protected: ${spendResult.itemsProtected}`);
  console.log(`Total gas spent: ${Number(spendResult.totalGasSpent) / 1_000_000_000} SUI`);

  const shouldPrintLedger = process.env.RUN_LEDGER === 'true';
  if (!shouldPrintLedger) {
    return;
  }

  ledger.printSummary();

  const shouldGenerateAuditPackage = process.env.RUN_LEDGER_AUDIT === 'true';
  if (shouldGenerateAuditPackage) {
    const auditPackage = ledger.generateAuditPackage(info.address);
    console.log('=== Ledger Audit Package ===');
    console.log(`Checksum: ${auditPackage.checksum}`);
    console.log(`Entries: ${auditPackage.entries.length}`);
    console.log(`On-chain TXs: ${auditPackage.onChainTransactions.length}`);
  }
}

main().catch((error) => {
  console.error('Wallet demo failed:', error);
  process.exit(1);
});
