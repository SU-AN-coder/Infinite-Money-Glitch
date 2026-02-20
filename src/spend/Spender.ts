import { TextEncoder } from 'node:util';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SealClient } from '@mysten/seal';
import { WalrusClient } from '@mysten/walrus';
import type { WalletNetwork } from '../wallet/WalletManager.js';
import { WalletManager } from '../wallet/WalletManager.js';

const DEFAULT_TESTNET_KEY_SERVERS: { objectId: string; weight: number }[] = [
  { objectId: '0x11', weight: 1 },
  { objectId: '0x22', weight: 1 },
  { objectId: '0x33', weight: 1 }
];

export interface SpenderConfig {
  network: WalletNetwork;
  sealPackageId: string;
  openclawBaseUrl?: string;
  walrusEpochs?: number;
}

export interface EncryptResult {
  ciphertext: Uint8Array;
  plaintextSize: number;
  ciphertextSize: number;
  sizeRatio: number;
  sealPolicyId: string;
  duration: number;
}

export interface UploadResult {
  blobId: string;
  txDigest: string;
  size: number;
  epochs: number;
  explorerUrl: string;
  duration: number;
}

export interface ProtectionResult {
  label: string;
  encryption: EncryptResult;
  upload: UploadResult;
  gasSpent: bigint;
  success: boolean;
  error?: string;
}

export interface SpendResult {
  itemsProtected: number;
  totalGasSpent: bigint;
  protections: ProtectionResult[];
  timestamp: Date;
}

export interface SealPolicyConfig {
  packageId: string;
  allowedAddresses: string[];
  threshold: number;
}

interface OpenClawExecRpcResponse {
  output?: string;
  error?: string;
}

export class Spender {
  private readonly wallet: WalletManager;
  private readonly client: SuiClient;
  private readonly sealClient: SealClient;
  private readonly walrusClient: WalrusClient;
  private readonly sealPackageId: string;
  private readonly network: WalletNetwork;
  private readonly openclawBaseUrl: string;
  private readonly walrusEpochs: number;

  constructor(wallet: WalletManager, config: SpenderConfig) {
    this.wallet = wallet;
    this.network = config.network;
    this.client = new SuiClient({ url: getFullnodeUrl(config.network) });
    this.sealPackageId = config.sealPackageId;
    this.openclawBaseUrl = config.openclawBaseUrl || process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
    this.walrusEpochs = config.walrusEpochs ?? 3;

    this.sealClient = new SealClient({
      suiClient: this.client as any,
      serverConfigs: this.getSealKeyServerConfigs(),
      verifyKeyServers: false
    });

    this.walrusClient = new WalrusClient({
      network: this.toWalrusNetwork(config.network),
      suiClient: this.client as any
    });
  }

  async spend(): Promise<SpendResult> {
    const protections: ProtectionResult[] = [];
    let totalGasSpent = 0n;

    const sensitiveData = await this.collectSensitiveData();
    if (sensitiveData.size === 0) {
      return {
        itemsProtected: 0,
        totalGasSpent,
        protections,
        timestamp: new Date()
      };
    }

    for (const [label, data] of sensitiveData.entries()) {
      const result = await this.protectUserData(label, data);
      protections.push(result);
      totalGasSpent += result.gasSpent;
    }

    return {
      itemsProtected: protections.filter((item) => item.success).length,
      totalGasSpent,
      protections,
      timestamp: new Date()
    };
  }

  async encryptData(plaintext: Uint8Array, policyId: string): Promise<EncryptResult> {
    const start = Date.now();

    const encrypted = await (this.sealClient as any).encrypt({
      threshold: 2,
      packageId: this.sealPackageId,
      id: policyId,
      data: plaintext
    });

    const ciphertext = (encrypted?.encryptedObject ?? encrypted?.ciphertext ?? new Uint8Array()) as Uint8Array;
    const duration = Date.now() - start;
    const sizeRatio = plaintext.length === 0 ? 1 : ciphertext.length / plaintext.length;

    return {
      ciphertext,
      plaintextSize: plaintext.length,
      ciphertextSize: ciphertext.length,
      sizeRatio,
      sealPolicyId: policyId,
      duration
    };
  }

  async uploadToWalrus(ciphertext: Uint8Array): Promise<UploadResult> {
    const start = Date.now();

    const result = await (this.walrusClient as any).writeBlob({
      blob: ciphertext,
      deletable: true,
      epochs: this.walrusEpochs,
      signer: this.wallet.getKeypair()
    });

    const blobId = String(result?.blobId || '');
    const txDigest = String(result?.txDigest || '');

    return {
      blobId,
      txDigest,
      size: ciphertext.length,
      epochs: this.walrusEpochs,
      explorerUrl: txDigest ? `https://suiscan.xyz/${this.network}/tx/${txDigest}` : '',
      duration: Date.now() - start
    };
  }

  async createSealPolicy(config: SealPolicyConfig): Promise<string> {
    const tx = new Transaction();

    const allowlist = tx.moveCall({
      target: `${config.packageId}::allowlist::create`,
      arguments: []
    });

    for (const address of config.allowedAddresses) {
      tx.moveCall({
        target: `${config.packageId}::allowlist::add`,
        arguments: [allowlist, tx.pure.address(address)]
      });
    }

    const execution = await this.wallet.signAndExecute(tx);
    if (!execution.success || !execution.digest) {
      throw new Error(execution.error || 'Failed to create Seal policy');
    }

    const txDetails = await this.client.getTransactionBlock({
      digest: execution.digest,
      options: { showObjectChanges: true }
    });

    const created = txDetails.objectChanges?.find((change) => change.type === 'created') as
      | { objectId?: string }
      | undefined;

    return created?.objectId || '';
  }

  async protectUserData(label: string, data: Uint8Array): Promise<ProtectionResult> {
    const gasStart = (await this.wallet.getBalance()).sui;

    try {
      const policyId = await this.createSealPolicy({
        packageId: this.sealPackageId,
        allowedAddresses: [this.wallet.getAddress()],
        threshold: 2
      });

      const encryption = await this.encryptData(data, policyId);
      const upload = await this.uploadToWalrus(encryption.ciphertext);

      const gasEnd = (await this.wallet.getBalance()).sui;

      return {
        label,
        encryption,
        upload,
        gasSpent: gasStart - gasEnd,
        success: true
      };
    } catch (error) {
      const gasEnd = (await this.wallet.getBalance()).sui;

      return {
        label,
        encryption: {
          ciphertext: new Uint8Array(),
          plaintextSize: data.length,
          ciphertextSize: 0,
          sizeRatio: 0,
          sealPolicyId: '',
          duration: 0
        },
        upload: {
          blobId: '',
          txDigest: '',
          size: 0,
          epochs: this.walrusEpochs,
          explorerUrl: '',
          duration: 0
        },
        gasSpent: gasStart - gasEnd,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async collectSensitiveData(): Promise<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>();
    const encoder = new TextEncoder();

    const sshPublicKey = await this.readFileViaOpenClaw('~/.ssh/id_ed25519.pub');
    if (sshPublicKey.trim()) {
      result.set('ssh-public-key', encoder.encode(sshPublicKey));
    }

    const gitConfig = await this.readFileViaOpenClaw('~/.gitconfig');
    if (gitConfig.trim()) {
      result.set('git-config', encoder.encode(gitConfig));
    }

    const auditLog = await this.readFileViaOpenClaw('./audit-log.json');
    if (auditLog.trim()) {
      result.set('audit-log', encoder.encode(auditLog));
    }

    return result;
  }

  private async readFileViaOpenClaw(path: string): Promise<string> {
    const token = process.env.OPENCLAW_TOKEN;
    if (!token) {
      return '';
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
          command: `cat ${path}`,
          host: 'gateway',
          timeout: 5
        }
      })
    });

    if (!response.ok) {
      return '';
    }

    const rpcResult = (await response.json()) as OpenClawExecRpcResponse;
    if (rpcResult.error) {
      return '';
    }

    return rpcResult.output || '';
  }

  private getSealKeyServerConfigs(): { objectId: string; weight: number }[] {
    const raw = process.env.SEAL_KEY_SERVERS?.trim();

    if (!raw) {
      return DEFAULT_TESTNET_KEY_SERVERS;
    }

    const parsed = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((item) => {
        const [objectId, weightRaw] = item.split(':').map((value) => value.trim());
        const weight = Number(weightRaw || '1');

        return {
          objectId,
          weight: Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : 1
        };
      })
      .filter((entry) => entry.objectId.length > 0);

    return parsed.length > 0 ? parsed : DEFAULT_TESTNET_KEY_SERVERS;
  }

  private toWalrusNetwork(network: WalletNetwork): 'testnet' | 'mainnet' {
    return network === 'mainnet' ? 'mainnet' : 'testnet';
  }
}