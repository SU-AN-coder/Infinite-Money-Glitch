import { WalletManager } from './wallet/WalletManager.js';
import { Earner } from './earn/Earner.js';
import { Spender } from './spend/Spender.js';
import { Ledger } from './ledger/Ledger.js';
import { Agent } from './agent/Agent.js';
import { runDemo } from './agent/DemoRunner.js';
async function main() {
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
async function runAgentMode() {
    const config = getAgentConfig();
    const agent = new Agent(config);
    await agent.initialize();
    const result = await agent.runCycle();
    console.log('=== Agent Cycle Result ===');
    console.log(JSON.stringify({
        success: result.success,
        cycle: result.cycleNumber,
        mode: result.mode,
        duration: result.duration,
        earned: result.phases.earn?.totalEarned?.toString() || '0',
        spent: result.phases.spend?.totalGasSpent?.toString() || '0',
        error: result.error
    }, null, 2));
}
async function runDemoMode() {
    const config = getAgentConfig();
    const result = await runDemo(config);
    console.log('=== Demo Result ===');
    console.log(JSON.stringify({
        success: result.success,
        cycle: result.cycle,
        duration: result.duration,
        summary: result.summary
    }, null, 2));
}
function getAgentConfig() {
    return {
        network: process.env.SUI_NETWORK || 'testnet',
        keySource: process.env.WALLET_KEY_SOURCE || 'env',
        bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x',
        bountyBoardId: process.env.BOUNTY_BOARD_ID || '0x',
        sealPackageId: process.env.SEAL_PACKAGE_ID || '0x',
        openclawBaseUrl: process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789',
        cycleIntervalMinutes: Number(process.env.AGENT_CYCLE_MINUTES || '5')
    };
}
async function runModuleDemos() {
    const config = {
        keySource: process.env.WALLET_KEY_SOURCE || 'env',
        network: process.env.SUI_NETWORK || 'testnet',
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
    const earnerConfig = {
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
    const spenderConfig = {
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
