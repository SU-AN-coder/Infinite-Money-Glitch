import { Buffer } from 'node:buffer';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export type WalletNetwork = 'testnet' | 'mainnet' | 'devnet';

export interface WalletConfig {
  keySource: 'env' | 'generate';
  network: WalletNetwork;
  bountyPackageId: string;
  bountyBoardId: string;
}

export interface BalanceInfo {
  sui: bigint;
  suiFormatted: string;
  explorerUrl: string;
  updatedAt: Date;
}

export interface TransactionResult {
  digest: string;
  success: boolean;
  gasUsed: bigint;
  explorerUrl: string;
  error?: string;
}

interface OpenClawExecResponse {
  output?: string;
  error?: string;
}

export class WalletManager {
  private keypair: Ed25519Keypair | null = null;
  private client: SuiClient | null = null;
  private config: WalletConfig | null = null;

  private get openclawBaseUrl(): string {
    return process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
  }

  private hasUsableToken(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    const token = value.trim();
    return !!token && !token.includes('<') && !token.includes('YOUR_');
  }

  async initialize(config: WalletConfig): Promise<void> {
    this.config = config;
    this.client = new SuiClient({
      url: getFullnodeUrl(config.network)
    });

    const envPrivateKey = process.env.SUI_PRIVATE_KEY;

    const configuredPrivateKey = envPrivateKey?.trim();
    const hasUsablePrivateKey =
      !!configuredPrivateKey &&
      !configuredPrivateKey.includes('<') &&
      !configuredPrivateKey.includes('YOUR_');

    if (hasUsablePrivateKey) {
      const privateKey = configuredPrivateKey;

      if (privateKey.startsWith('suiprivkey')) {
        const decoded = decodeSuiPrivateKey(privateKey);
        this.keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
        return;
      }

      const secret = Buffer.from(privateKey, 'base64');
      this.keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(secret));
      return;
    }

    if (config.keySource === 'generate') {
      this.keypair = new Ed25519Keypair();
      if (this.hasUsableToken(process.env.OPENCLAW_TOKEN)) {
        await this.storeKeySecurely();
      } else {
        console.warn('OPENCLAW_TOKEN not set, generated wallet key is kept in-memory only for this session.');
      }
      return;
    }

    throw new Error('No usable wallet key found. Set a valid SUI_PRIVATE_KEY (suiprivkey... or Base64) or use keySource="generate".');
  }

  getAddress(): string {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    return this.keypair.getPublicKey().toSuiAddress();
  }

  getExplorerUrl(): string {
    const network = this.config?.network || 'testnet';
    return `https://suiscan.xyz/${network}/account/${this.getAddress()}`;
  }

  async getBalance(): Promise<BalanceInfo> {
    if (!this.client || !this.keypair) {
      throw new Error('Wallet not initialized');
    }

    const address = this.getAddress();
    const balance = await this.client.getBalance({
      owner: address,
      coinType: '0x2::sui::SUI'
    });

    const suiBalance = BigInt(balance.totalBalance);

    return {
      sui: suiBalance,
      suiFormatted: this.formatSui(suiBalance),
      explorerUrl: this.getExplorerUrl(),
      updatedAt: new Date()
    };
  }

  getKeypair(): Ed25519Keypair {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    return this.keypair;
  }

  async signAndExecute(transaction: Transaction): Promise<TransactionResult> {
    if (!this.client || !this.keypair) {
      throw new Error('Wallet not initialized');
    }

    try {
      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction,
        options: {
          showEffects: true,
          showEvents: true
        }
      });

      const success = result.effects?.status?.status === 'success';
      const gasComputation = BigInt(result.effects?.gasUsed?.computationCost || 0);
      const gasStorage = BigInt(result.effects?.gasUsed?.storageCost || 0);

      return {
        digest: result.digest,
        success,
        gasUsed: gasComputation + gasStorage,
        explorerUrl: this.getTxExplorerUrl(result.digest),
        error: success ? undefined : result.effects?.status?.error
      };
    } catch (error) {
      return {
        digest: '',
        success: false,
        gasUsed: 0n,
        explorerUrl: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async transferSui(to: string, amount: number): Promise<TransactionResult> {
    if (amount <= 0) {
      throw new Error('Transfer amount must be greater than 0');
    }

    const mist = BigInt(Math.floor(amount * 1_000_000_000));
    const tx = new Transaction();

    const coin = tx.splitCoins(tx.gas, [tx.pure.u64(mist)]);
    tx.transferObjects([coin], tx.pure.address(to));

    return this.signAndExecute(tx);
  }

  exportPublicInfo(): { address: string; publicKey: string; explorerUrl: string } {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    return {
      address: this.getAddress(),
      publicKey: this.keypair.getPublicKey().toBase64(),
      explorerUrl: this.getExplorerUrl()
    };
  }

  private async storeKeySecurely(): Promise<void> {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    const encodedSecret = this.keypair.getSecretKey();

    if (process.platform === 'win32') {
      const command = [
        'Add-Type -AssemblyName System.Security;',
        `$bytes = [Text.Encoding]::UTF8.GetBytes('${encodedSecret}');`,
        "$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser');",
        "$dir = Join-Path $env:USERPROFILE '.agent';",
        'if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null };',
        "[IO.File]::WriteAllBytes((Join-Path $dir 'wallet.enc'), $encrypted);",
        "Write-Output 'OK'"
      ].join(' ');

      await this.execViaOpenClaw(command);
      return;
    }

    if (process.platform === 'darwin') {
      await this.execViaOpenClaw(
        `security add-generic-password -a "img-agent" -s "sui-private-key" -w "${encodedSecret}" -U`
      );
      return;
    }

    await this.execViaOpenClaw(
      `echo "${encodedSecret}" | secret-tool store --label="img-agent" service img-agent key sui`
    );
  }

  private async execViaOpenClaw(command: string): Promise<string> {
    const token = process.env.OPENCLAW_TOKEN;

    if (!this.hasUsableToken(token)) {
      throw new Error('OPENCLAW_TOKEN is required for secure key storage');
    }

    const response = await fetch(`${this.openclawBaseUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        method: 'exec',
        params: {
          command,
          host: 'gateway',
          timeout: 15
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenClaw RPC failed with status ${response.status}`);
    }

    const result = (await response.json()) as OpenClawExecResponse;

    if (result.error) {
      throw new Error(result.error);
    }

    return result.output || '';
  }

  private getTxExplorerUrl(digest: string): string {
    const network = this.config?.network || 'testnet';
    return `https://suiscan.xyz/${network}/tx/${digest}`;
  }

  private formatSui(mist: bigint): string {
    return `${(Number(mist) / 1_000_000_000).toFixed(4)} SUI`;
  }
}
