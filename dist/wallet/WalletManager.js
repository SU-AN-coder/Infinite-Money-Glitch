import { Buffer } from 'node:buffer';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
export class WalletManager {
    keypair = null;
    client = null;
    config = null;
    get openclawBaseUrl() {
        return process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
    }
    async initialize(config) {
        this.config = config;
        this.client = new SuiClient({
            url: getFullnodeUrl(config.network)
        });
        const envPrivateKey = process.env.SUI_PRIVATE_KEY;
        if (envPrivateKey) {
            const secret = Buffer.from(envPrivateKey, 'base64');
            this.keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(secret));
            return;
        }
        if (config.keySource === 'generate') {
            this.keypair = new Ed25519Keypair();
            await this.storeKeySecurely();
            return;
        }
        throw new Error('No wallet found. Set SUI_PRIVATE_KEY or use keySource="generate".');
    }
    getAddress() {
        if (!this.keypair) {
            throw new Error('Wallet not initialized');
        }
        return this.keypair.getPublicKey().toSuiAddress();
    }
    getExplorerUrl() {
        const network = this.config?.network || 'testnet';
        return `https://suiscan.xyz/${network}/account/${this.getAddress()}`;
    }
    async getBalance() {
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
    getKeypair() {
        if (!this.keypair) {
            throw new Error('Wallet not initialized');
        }
        return this.keypair;
    }
    async signAndExecute(transaction) {
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
        }
        catch (error) {
            return {
                digest: '',
                success: false,
                gasUsed: 0n,
                explorerUrl: '',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    async transferSui(to, amount) {
        if (amount <= 0) {
            throw new Error('Transfer amount must be greater than 0');
        }
        const mist = BigInt(Math.floor(amount * 1_000_000_000));
        const tx = new Transaction();
        const coin = tx.splitCoins(tx.gas, [tx.pure.u64(mist)]);
        tx.transferObjects([coin], tx.pure.address(to));
        return this.signAndExecute(tx);
    }
    exportPublicInfo() {
        if (!this.keypair) {
            throw new Error('Wallet not initialized');
        }
        return {
            address: this.getAddress(),
            publicKey: this.keypair.getPublicKey().toBase64(),
            explorerUrl: this.getExplorerUrl()
        };
    }
    async storeKeySecurely() {
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
            await this.execViaOpenClaw(`security add-generic-password -a "img-agent" -s "sui-private-key" -w "${encodedSecret}" -U`);
            return;
        }
        await this.execViaOpenClaw(`echo "${encodedSecret}" | secret-tool store --label="img-agent" service img-agent key sui`);
    }
    async execViaOpenClaw(command) {
        const token = process.env.OPENCLAW_TOKEN;
        if (!token) {
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
        const result = (await response.json());
        if (result.error) {
            throw new Error(result.error);
        }
        return result.output || '';
    }
    getTxExplorerUrl(digest) {
        const network = this.config?.network || 'testnet';
        return `https://suiscan.xyz/${network}/tx/${digest}`;
    }
    formatSui(mist) {
        return `${(Number(mist) / 1_000_000_000).toFixed(4)} SUI`;
    }
}
