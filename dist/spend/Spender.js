import { TextEncoder } from 'node:util';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SealClient } from '@mysten/seal';
import { WalrusClient } from '@mysten/walrus';
const DEFAULT_TESTNET_KEY_SERVERS = [
    { objectId: '0x11', weight: 1 },
    { objectId: '0x22', weight: 1 },
    { objectId: '0x33', weight: 1 }
];
export class Spender {
    wallet;
    client;
    sealClient;
    walrusClient;
    sealPackageId;
    network;
    openclawBaseUrl;
    walrusEpochs;
    constructor(wallet, config) {
        this.wallet = wallet;
        this.network = config.network;
        this.client = new SuiClient({ url: getFullnodeUrl(config.network) });
        this.sealPackageId = config.sealPackageId;
        this.openclawBaseUrl = config.openclawBaseUrl || process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
        this.walrusEpochs = config.walrusEpochs ?? 3;
        this.sealClient = new SealClient({
            suiClient: this.client,
            serverConfigs: this.getSealKeyServerConfigs(),
            verifyKeyServers: false
        });
        this.walrusClient = new WalrusClient({
            network: this.toWalrusNetwork(config.network),
            suiClient: this.client
        });
    }
    async spend() {
        const protections = [];
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
    async encryptData(plaintext, policyId) {
        const start = Date.now();
        const encrypted = await this.sealClient.encrypt({
            threshold: 2,
            packageId: this.sealPackageId,
            id: policyId,
            data: plaintext
        });
        const ciphertext = (encrypted?.encryptedObject ?? encrypted?.ciphertext ?? new Uint8Array());
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
    async uploadToWalrus(ciphertext) {
        const start = Date.now();
        const result = await this.walrusClient.writeBlob({
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
    async createSealPolicy(config) {
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
        const created = txDetails.objectChanges?.find((change) => change.type === 'created');
        return created?.objectId || '';
    }
    async protectUserData(label, data) {
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
        }
        catch (error) {
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
    async collectSensitiveData() {
        const result = new Map();
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
    async readFileViaOpenClaw(path) {
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
        const rpcResult = (await response.json());
        if (rpcResult.error) {
            return '';
        }
        return rpcResult.output || '';
    }
    getSealKeyServerConfigs() {
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
    toWalrusNetwork(network) {
        return network === 'mainnet' ? 'mainnet' : 'testnet';
    }
}
