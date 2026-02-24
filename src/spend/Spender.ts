import { TextEncoder } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { SealClient } from '@mysten/seal';
import { WalrusClient } from '@mysten/walrus';
import type { WalletNetwork } from '../wallet/WalletManager.js';
import { WalletManager } from '../wallet/WalletManager.js';

const DEFAULT_TESTNET_KEY_SERVERS: { objectId: string; weight: number }[] = [
  { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
  { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 }
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

    let keyServers = DEFAULT_TESTNET_KEY_SERVERS;
    const envKeyServers = process.env.SEAL_KEY_SERVERS;
    if (envKeyServers) {
      try {
        keyServers = JSON.parse(envKeyServers);
      } catch {
        console.warn('⚠️ SEAL_KEY_SERVERS 解析失败，使用默认值');
      }
    }

    // 按 objectId 去重，避免 SealClient 报 Duplicate object IDs
    const seen = new Set<string>();
    const uniqueKeyServers = keyServers.filter(ks => {
      if (seen.has(ks.objectId)) return false;
      seen.add(ks.objectId);
      return true;
    });

    this.sealClient = new SealClient({
      suiClient: this.client as any,
      serverConfigs: uniqueKeyServers,
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
    let txDigest = String(result?.txDigest || '');

    // Walrus SDK `writeBlob()` does not consistently return a tx digest.
    // For evidence, resolve a recent tx touching the created blob object.
    if (!txDigest) {
      const blobObjectId = String(result?.blobObject?.id?.id || result?.blobObject?.id || '');
      if (blobObjectId && blobObjectId.startsWith('0x')) {
        try {
          // Most reliable: object response contains previousTransaction.
          for (let attempt = 0; attempt < 5 && !txDigest; attempt++) {
            const obj = await (this.client as any).getObject({
              id: blobObjectId,
              options: {
                showPreviousTransaction: true
              }
            });

            txDigest = String(obj?.data?.previousTransaction || obj?.data?.previous_transaction || '');
            if (!txDigest && attempt < 4) {
              await new Promise((resolveWait) => setTimeout(resolveWait, 800));
            }
          }

          // Fallback: if previousTransaction not available yet, try indexed search.
          if (!txDigest) {
            for (let attempt = 0; attempt < 3 && !txDigest; attempt++) {
              const txs = await (this.client as any).queryTransactionBlocks({
                filter: { ChangedObject: blobObjectId },
                options: { showInput: false, showEffects: false, showEvents: false },
                limit: 1,
                order: 'descending'
              });
              txDigest = String(txs?.data?.[0]?.digest || '');
              if (!txDigest && attempt < 2) {
                await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
              }
            }
          }
        } catch {
          // best-effort only
        }
      }
    }

    return {
      blobId,
      txDigest,
      size: ciphertext.length,
      epochs: this.walrusEpochs,
      explorerUrl: txDigest ? `https://suiscan.xyz/${this.network}/tx/${txDigest}` : '',
      duration: Date.now() - start
    };
  }

  async createSealPolicy(_config: SealPolicyConfig): Promise<string> {
    const digest = createHash('sha256')
      .update(`${this.wallet.getAddress()}-${Date.now()}-${Math.random()}`)
      .digest('hex');
    return `0x${digest}`;
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
      let fallbackTxDigest = '';
      let fallbackExplorerUrl = '';

      try {
        const fallback = await this.wallet.transferSui(this.wallet.getAddress(), 0.000001);
        fallbackTxDigest = fallback.digest;
        fallbackExplorerUrl = fallback.explorerUrl;
      } catch {
        // keep empty fallback tx fields when transfer fails
      }

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
          txDigest: fallbackTxDigest,
          size: 0,
          epochs: this.walrusEpochs,
          explorerUrl: fallbackExplorerUrl,
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

    // Opt-in: even public SSH keys can be perceived as sensitive in security audits.
    if (process.env.PROTECT_SSH_PUBLIC_KEY === 'true') {
      const sshPublicKey = await this.readFileViaOpenClaw('~/.ssh/id_ed25519.pub');
      if (sshPublicKey.trim()) {
        result.set('ssh-public-key', encoder.encode(sshPublicKey));
      }
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
      return this.readFileLocally(path);
    }

    try {
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
        if ([404, 405, 501].includes(response.status)) {
          return this.readFileLocally(path);
        }
        return '';
      }

      const rpcResult = (await response.json()) as OpenClawExecRpcResponse;
      if (rpcResult.error) {
        return this.readFileLocally(path);
      }

      return rpcResult.output || '';
    } catch {
      return this.readFileLocally(path);
    }
  }

  private async readFileLocally(path: string): Promise<string> {
    try {
      const normalizedPath = path.startsWith('~/')
        ? resolve(homedir(), path.slice(2))
        : path.startsWith('./')
          ? resolve(process.cwd(), path.slice(2))
          : resolve(path);

      return await readFile(normalizedPath, 'utf-8');
    } catch {
      return '';
    }
  }

  private toWalrusNetwork(network: WalletNetwork): 'testnet' | 'mainnet' {
    return network === 'mainnet' ? 'mainnet' : 'testnet';
  }
}