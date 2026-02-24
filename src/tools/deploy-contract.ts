import '../shared/loadEnv.js';
/**
 * Deploy BountyBoard Contract to Sui Network
 * 
 * This script:
 * 1. Builds the Move contract
 * 2. Deploys to configured network
 * 3. Creates BountyBoard shared object
 * 4. Saves deployment info for the agent
 * 
 * Prerequisites:
 * - Sui CLI installed (`sui --version`)
 * - Funded wallet for gas
 * - Environment configured in .env
 */

import { execSync, spawn, ChildProcess } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface DeploymentResult {
  success: boolean;
  network: string;
  packageId?: string;
  boardObjectId?: string;
  deployTxDigest?: string;
  explorerUrl?: string;
  error?: string;
  timestamp: string;
}

interface PublishOutput {
  objectChanges: Array<{
    type: string;
    packageId?: string;
    objectId?: string;
    objectType?: string;
  }>;
  digest: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const network = (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet';
const suiCliPath = process.env.SUI_CLI_PATH || 'sui';
const gasBudget = process.env.DEPLOY_GAS_BUDGET || '500000000';
const contractsDir = join(process.cwd(), 'contracts');
const deploymentFile = join(process.cwd(), 'deployment.json');

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function log(emoji: string, message: string): void {
  console.log(`${emoji} ${message}`);
}

function logSection(title: string): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60) + '\n');
}

async function checkPrerequisites(): Promise<void> {
  // Check Sui CLI
  try {
    const version = execSync(`${suiCliPath} --version`, { encoding: 'utf-8' }).trim();
    log('✅', `Sui CLI: ${version}`);
  } catch {
    throw new Error('Sui CLI not found. Install from https://docs.sui.io/');
  }

  // Check contracts directory
  try {
    await access(join(contractsDir, 'Move.toml'));
    log('✅', 'Move.toml found');
  } catch {
    throw new Error('contracts/Move.toml not found');
  }

  // Check active address has balance
  const client = new SuiClient({ url: getFullnodeUrl(network) });
  try {
    const address = execSync(`${suiCliPath} client active-address`, { encoding: 'utf-8' }).trim();
    log('📍', `Active address: ${address}`);
    
    const balance = await client.getBalance({ owner: address });
    const suiBalance = Number(balance.totalBalance) / 1_000_000_000;
    log('💰', `Balance: ${suiBalance.toFixed(4)} SUI`);
    
    if (suiBalance < 0.1) {
      log('⚠️', 'Low balance! Deployment may fail. Get testnet SUI from Discord faucet.');
    }
  } catch (error) {
    log('⚠️', `Could not check balance: ${error instanceof Error ? error.message : error}`);
  }
}

async function buildContract(): Promise<void> {
  log('🔨', 'Building contract...');
  
  try {
    execSync(`${suiCliPath} move build`, {
      cwd: contractsDir,
      stdio: 'inherit',
    });
    log('✅', 'Build successful');
  } catch {
    throw new Error('Contract build failed');
  }
}

async function deployContract(): Promise<{ packageId: string; digest: string }> {
  log('🚀', `Deploying to ${network}...`);

  let output = '';
  try {
    output = execSync(`${suiCliPath} client publish --gas-budget ${gasBudget} --json`, {
      cwd: contractsDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const stderr = (err.stderr || '').trim();
    const stdout = (err.stdout || '').trim();
    const message = [stderr, stdout, err.message || 'publish failed'].filter(Boolean).join('\n');
    throw new Error(`publish failed (gasBudget=${gasBudget}):\n${message}`);
  }

  const result: PublishOutput = JSON.parse(output);
  
  // Find package ID
  const publishedPackage = result.objectChanges.find(
    change => change.type === 'published'
  );
  
  if (!publishedPackage?.packageId) {
    throw new Error('Package ID not found in publish result');
  }

  log('✅', `Package deployed: ${publishedPackage.packageId}`);
  
  return {
    packageId: publishedPackage.packageId,
    digest: result.digest,
  };
}

async function createBoard(packageId: string): Promise<string> {
  log('📋', 'Creating BountyBoard...');
  
  const output = execSync(
    `${suiCliPath} client call --package ${packageId} --module bounty_board --function create_board --gas-budget ${gasBudget} --json`,
    { encoding: 'utf-8' }
  );

  const result = JSON.parse(output);
  
  // Find the created BountyBoard object
  const boardObject = result.objectChanges?.find(
    (change: { type: string; objectType?: string }) =>
      change.type === 'created' && change.objectType?.includes('BountyBoard')
  );

  if (!boardObject?.objectId) {
    throw new Error('BountyBoard object not found in result');
  }

  log('✅', `BountyBoard created: ${boardObject.objectId}`);
  
  return boardObject.objectId;
}

async function saveDeployment(result: DeploymentResult): Promise<void> {
  await writeFile(deploymentFile, JSON.stringify(result, null, 2), 'utf-8');
  log('💾', `Deployment info saved to: ${deploymentFile}`);

  if (result.success && result.packageId && result.boardObjectId) {
    console.log('\n📝 Add these to your .env file:\n');
    console.log(`BOUNTY_PACKAGE_ID=${result.packageId}`);
    console.log(`BOUNTY_BOARD_ID=${result.boardObjectId}`);
  }
}

function buildExplorerUrl(digest: string): string {
  const base = network === 'mainnet'
    ? 'https://suiscan.xyz/mainnet'
    : `https://suiscan.xyz/${network}`;
  return `${base}/tx/${digest}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\n🏗️  BountyBoard Contract Deployment');
  console.log(`   Network: ${network}`);
  
  const result: DeploymentResult = {
    success: false,
    network,
    timestamp: new Date().toISOString(),
  };

  try {
    logSection('PREREQUISITES');
    await checkPrerequisites();

    logSection('BUILD');
    await buildContract();

    logSection('DEPLOY');
    const { packageId, digest } = await deployContract();
    result.packageId = packageId;
    result.deployTxDigest = digest;
    result.explorerUrl = buildExplorerUrl(digest);

    logSection('INITIALIZE');
    const boardId = await createBoard(packageId);
    result.boardObjectId = boardId;
    result.success = true;

    logSection('COMPLETE');
    await saveDeployment(result);
    
    console.log('\n✅ Deployment successful!');
    console.log(`   Package: ${result.packageId}`);
    console.log(`   Board: ${result.boardObjectId}`);
    console.log(`   Explorer: ${result.explorerUrl}`);
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Deployment failed:', result.error);
    await saveDeployment(result);
    process.exit(1);
  }
}

main();
