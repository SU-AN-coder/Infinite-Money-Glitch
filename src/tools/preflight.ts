import '../shared/loadEnv.js';
import { execSync } from 'node:child_process';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { WalletManager } from '../wallet/WalletManager.js';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

function runCommand(command: string): { ok: boolean; output: string } {
  try {
    const output = execSync(command, { encoding: 'utf-8' }).trim();
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

function checkBinary(name: string, command: string): CheckResult {
  const result = runCommand(command);
  if (!result.ok) {
    return { name: `binary:${name}`, status: 'fail', detail: `${name} 不可用` };
  }
  return { name: `binary:${name}`, status: 'pass', detail: result.output.split('\n')[0] || `${name} 可用` };
}

function checkEnv(name: string, required = true): CheckResult {
  const value = process.env[name]?.trim();

  const isPlaceholder =
    !value ||
    value === '0x' ||
    value.includes('<') ||
    value.includes('YOUR_') ||
    value.includes('DEPLOYED_') ||
    value.includes('SEAL_KEY_SERVERS');

  if (!isPlaceholder) {
    return { name: `env:${name}`, status: 'pass', detail: '已配置' };
  }

  return {
    name: `env:${name}`,
    status: required ? 'fail' : 'warn',
    detail: required ? '缺失（必须）' : '未配置（可选）'
  };
}

async function checkOpenClawHealth(baseUrl: string): Promise<CheckResult> {
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      return { name: 'service:openclaw', status: 'warn', detail: `健康检查返回 ${response.status}` };
    }
    return { name: 'service:openclaw', status: 'pass', detail: 'Gateway 可达' };
  } catch {
    return { name: 'service:openclaw', status: 'warn', detail: 'Gateway 不可达（若仅本地 mock 可忽略）' };
  }
}

async function checkOpenClawExec(baseUrl: string): Promise<CheckResult> {
  const token = process.env.OPENCLAW_TOKEN;
  if (!token) {
    return { name: 'service:openclaw-rpc', status: 'warn', detail: 'OPENCLAW_TOKEN 缺失，无法检查 /rpc exec' };
  }

  try {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        method: 'exec',
        params: {
          command: 'echo preflight',
          host: 'gateway',
          timeout: 5
        }
      })
    });

    if (!response.ok) {
      return {
        name: 'service:openclaw-rpc',
        status: 'warn',
        detail: `/rpc exec 返回 ${response.status}（将回退到本地执行）`
      };
    }

    return { name: 'service:openclaw-rpc', status: 'pass', detail: '/rpc exec 可用' };
  } catch {
    return { name: 'service:openclaw-rpc', status: 'warn', detail: '/rpc exec 不可达（将回退到本地执行）' };
  }
}

async function checkWalrusFunding(): Promise<CheckResult> {
  const runSpender = process.env.RUN_SPENDER === 'true' || process.env.RUN_AGENT === 'true' || process.env.RUN_DEMO === 'true';
  if (!runSpender) {
    return { name: 'walrus:wal-balance', status: 'pass', detail: 'Spender 未启用，跳过' };
  }

  const walCoinType =
    process.env.WAL_COIN_TYPE ||
    '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL';

  const network = (process.env.SUI_NETWORK as 'testnet' | 'devnet' | 'mainnet') || 'testnet';
  const client = new SuiClient({ url: getFullnodeUrl(network) });

  try {
    const wallet = new WalletManager();
    await wallet.initialize({
      keySource: (process.env.WALLET_KEY_SOURCE as 'env' | 'generate') || 'env',
      network,
      bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x',
      bountyBoardId: process.env.BOUNTY_BOARD_ID || '0x'
    });

    const address = wallet.getAddress();
    const balance = await client.getBalance({ owner: address, coinType: walCoinType });
    const total = BigInt(balance.totalBalance);

    if (total === 0n) {
      return { name: 'walrus:wal-balance', status: 'warn', detail: `地址 ${address.slice(0, 10)}... 未发现 WAL，Walrus 写入将失败` };
    }

    return { name: 'walrus:wal-balance', status: 'pass', detail: `地址 ${address.slice(0, 10)}... WAL 余额已就绪` };
  } catch (error) {
    return { name: 'walrus:wal-balance', status: 'warn', detail: `WAL 余额检查失败：${error instanceof Error ? error.message : error}` };
  }
}

function checkModeRequirements(): CheckResult[] {
  const results: CheckResult[] = [];

  const runAgent = process.env.RUN_AGENT === 'true';
  const runDemo = process.env.RUN_DEMO === 'true';
  const runEarner = process.env.RUN_EARNER === 'true' || runAgent || runDemo;
  const runSpender = process.env.RUN_SPENDER === 'true' || runAgent || runDemo;

  if (runEarner) {
    results.push(checkEnv('BOUNTY_PACKAGE_ID', true));
    results.push(checkEnv('BOUNTY_BOARD_ID', true));
    results.push(checkEnv('OPENCLAW_TOKEN', true));
  }

  if (runSpender) {
    results.push(checkEnv('SEAL_PACKAGE_ID', true));
    results.push(checkEnv('SEAL_KEY_SERVERS', false));
  }

  results.push(checkEnv('SUI_PRIVATE_KEY', process.env.WALLET_KEY_SOURCE !== 'generate'));

  return results;
}

function printResults(results: CheckResult[]): number {
  const failCount = results.filter((r) => r.status === 'fail').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;

  console.log('\n=== Preflight Check ===');
  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
    console.log(`${icon} ${result.name} - ${result.detail}`);
  }

  console.log('\n--- Summary ---');
  console.log(`Pass: ${results.filter((r) => r.status === 'pass').length}`);
  console.log(`Warn: ${warnCount}`);
  console.log(`Fail: ${failCount}`);

  if (failCount > 0) {
    console.log('\nPreflight 未通过：请先补齐必需配置。');
  } else {
    console.log('\nPreflight 通过：可以进行真实链路测试。');
  }

  return failCount;
}

async function main(): Promise<void> {
  const baseUrl = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';

  const checks: CheckResult[] = [
    checkBinary('node', 'node -v'),
    checkBinary('npm', 'npm -v'),
    checkBinary('sui', 'sui --version')
  ];

  checks.push(checkEnv('SUI_NETWORK', true));
  checks.push(checkEnv('WALLET_KEY_SOURCE', true));
  checks.push(...checkModeRequirements());
  checks.push(await checkOpenClawHealth(baseUrl));
  checks.push(await checkOpenClawExec(baseUrl));
  checks.push(await checkWalrusFunding());

  const failCount = printResults(checks);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Preflight 执行失败:', error);
  process.exit(1);
});
