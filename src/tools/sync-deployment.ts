import '../shared/loadEnv.js';

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

interface DeploymentResult {
  success: boolean;
  network: string;
  timestamp: string;
  packageId?: string;
  boardObjectId?: string;
  deployTxDigest?: string;
  explorerUrl?: string;
  error?: string;
}

async function main(): Promise<void> {
  const network = (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet';
  const packageId = (process.env.BOUNTY_PACKAGE_ID || '').trim();
  const boardObjectId = (process.env.BOUNTY_BOARD_ID || '').trim();

  const deploymentFile = join(process.cwd(), 'deployment.json');

  const result: DeploymentResult = {
    success: false,
    network,
    timestamp: new Date().toISOString()
  };

  if (!packageId.startsWith('0x') || packageId.length < 10) {
    result.error = 'BOUNTY_PACKAGE_ID missing/invalid';
    await writeFile(deploymentFile, JSON.stringify(result, null, 2), 'utf-8');
    console.error('❌ sync-deployment:', result.error);
    process.exit(1);
  }

  if (!boardObjectId.startsWith('0x') || boardObjectId.length < 10) {
    result.error = 'BOUNTY_BOARD_ID missing/invalid';
    await writeFile(deploymentFile, JSON.stringify(result, null, 2), 'utf-8');
    console.error('❌ sync-deployment:', result.error);
    process.exit(1);
  }

  const client = new SuiClient({ url: getFullnodeUrl(network) });

  try {
    const pkgObj = await client.getObject({ id: packageId, options: { showPreviousTransaction: true } });
    const deployTxDigest = (pkgObj.data as any)?.previousTransaction as string | undefined;

    // also verify board exists
    await client.getObject({ id: boardObjectId, options: { showType: true } });

    result.success = true;
    result.packageId = packageId;
    result.boardObjectId = boardObjectId;
    result.deployTxDigest = deployTxDigest || 'unknown';
    result.explorerUrl = deployTxDigest
      ? `https://suiscan.xyz/${network}/tx/${deployTxDigest}`
      : `https://suiscan.xyz/${network}/object/${boardObjectId}`;

    await writeFile(deploymentFile, JSON.stringify(result, null, 2), 'utf-8');

    console.log('✅ deployment.json synced');
    console.log(`   packageId: ${packageId}`);
    console.log(`   boardObjectId: ${boardObjectId}`);
    console.log(`   deployTxDigest: ${result.deployTxDigest}`);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await writeFile(deploymentFile, JSON.stringify(result, null, 2), 'utf-8');
    console.error('❌ sync-deployment failed:', result.error);
    process.exit(1);
  }
}

main();
