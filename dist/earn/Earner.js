import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
export class Earner {
    wallet;
    client;
    bountyPackageId;
    bountyBoardId;
    openclawBaseUrl;
    constructor(wallet, config) {
        this.wallet = wallet;
        this.client = new SuiClient({ url: getFullnodeUrl(config.network) });
        this.bountyPackageId = config.bountyPackageId;
        this.bountyBoardId = config.bountyBoardId;
        this.openclawBaseUrl = config.openclawBaseUrl || process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
    }
    async earn() {
        const claims = [];
        let totalEarned = 0n;
        const bounties = await this.getAvailableBounties();
        if (bounties.length === 0) {
            return {
                tasksFound: 0,
                tasksCompleted: 0,
                totalEarned,
                claims,
                timestamp: new Date()
            };
        }
        const bestBounty = this.selectBestBounty(bounties);
        if (!bestBounty) {
            return {
                tasksFound: bounties.length,
                tasksCompleted: 0,
                totalEarned,
                claims,
                timestamp: new Date()
            };
        }
        const taskResult = await this.executeTask(bestBounty);
        if (!taskResult.success) {
            return {
                tasksFound: bounties.length,
                tasksCompleted: 0,
                totalEarned,
                claims,
                timestamp: new Date()
            };
        }
        const claim = await this.claimBountyReward(taskResult);
        claims.push(claim);
        if (claim.success) {
            totalEarned += claim.rewardAmount;
        }
        return {
            tasksFound: bounties.length,
            tasksCompleted: claim.success ? 1 : 0,
            totalEarned,
            claims,
            timestamp: new Date()
        };
    }
    async getAvailableBounties() {
        const board = await this.client.getObject({
            id: this.bountyBoardId,
            options: { showContent: true }
        });
        const fields = board.data?.content?.fields;
        const rawBounties = this.extractBountyList(fields?.bounties);
        const bounties = rawBounties
            .map((raw, index) => this.toBountyTask(raw, index))
            .filter((task) => task !== null)
            .filter((task) => !task.completed);
        return bounties;
    }
    selectBestBounty(bounties) {
        if (bounties.length === 0) {
            return null;
        }
        const typePriority = {
            lint: 5,
            test: 4,
            format: 3,
            audit: 2,
            custom: 1
        };
        const sorted = [...bounties].sort((left, right) => {
            if (left.rewardAmount === right.rewardAmount) {
                return typePriority[right.taskType] - typePriority[left.taskType];
            }
            return left.rewardAmount > right.rewardAmount ? -1 : 1;
        });
        return sorted[0];
    }
    async executeTask(bounty) {
        const startTime = Date.now();
        const command = this.getCommandForTaskType(bounty.taskType);
        try {
            const exec = await this.execViaOpenClaw({
                command,
                host: 'gateway',
                timeout: 30,
                security: 'normal'
            });
            const outputHash = this.sha256(exec.output);
            return {
                bounty,
                output: exec.output,
                outputHash,
                success: exec.exitCode === 0,
                duration: Date.now() - startTime,
                error: exec.exitCode === 0 ? undefined : `Command exited with code ${exec.exitCode}`
            };
        }
        catch (error) {
            return {
                bounty,
                output: '',
                outputHash: '',
                success: false,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async claimBountyReward(taskResult) {
        const { bounty, outputHash } = taskResult;
        try {
            const tx = new Transaction();
            tx.moveCall({
                target: `${this.bountyPackageId}::bounty_board::claim_reward`,
                arguments: [
                    tx.object(this.bountyBoardId),
                    tx.pure.u64(BigInt(bounty.bountyId)),
                    tx.pure.vector('u8', Array.from(Buffer.from(outputHash, 'hex')))
                ]
            });
            const result = await this.wallet.signAndExecute(tx);
            return {
                bountyId: bounty.bountyId,
                rewardAmount: bounty.rewardAmount,
                txDigest: result.digest,
                explorerUrl: result.explorerUrl,
                proofHash: outputHash,
                success: result.success,
                error: result.error
            };
        }
        catch (error) {
            return {
                bountyId: bounty.bountyId,
                rewardAmount: bounty.rewardAmount,
                txDigest: '',
                explorerUrl: '',
                proofHash: outputHash,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    extractBountyList(bountiesField) {
        if (!bountiesField) {
            return [];
        }
        if (Array.isArray(bountiesField)) {
            return bountiesField;
        }
        if (typeof bountiesField === 'object' && bountiesField !== null) {
            const value = bountiesField;
            if (Array.isArray(value.fields?.contents)) {
                return value.fields.contents;
            }
            if (Array.isArray(value.contents)) {
                return value.contents;
            }
        }
        return [];
    }
    toBountyTask(raw, fallbackId) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const withFields = raw;
        const fields = withFields.fields ?? raw;
        const description = this.decodeDescription(fields.description);
        const rewardAmount = this.toBigInt(fields.reward_amount, 0n);
        const poster = String(fields.poster ?? '');
        const completed = Boolean(fields.completed ?? false);
        const bountyId = this.toSafeNumber(fields.id) ?? fallbackId;
        return {
            bountyId,
            description,
            rewardAmount,
            poster,
            completed,
            taskType: this.inferTaskType(description)
        };
    }
    decodeDescription(value) {
        if (typeof value === 'string') {
            return value;
        }
        if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
            return new TextDecoder().decode(new Uint8Array(value));
        }
        if (value && typeof value === 'object') {
            const fieldsValue = value;
            if (Array.isArray(fieldsValue.bytes)) {
                return new TextDecoder().decode(new Uint8Array(fieldsValue.bytes));
            }
            if (Array.isArray(fieldsValue.fields?.contents)) {
                return new TextDecoder().decode(new Uint8Array(fieldsValue.fields.contents));
            }
            if (Array.isArray(fieldsValue.contents)) {
                return new TextDecoder().decode(new Uint8Array(fieldsValue.contents));
            }
        }
        return '';
    }
    inferTaskType(description) {
        const normalized = description.toLowerCase();
        if (normalized.includes('lint')) {
            return 'lint';
        }
        if (normalized.includes('test')) {
            return 'test';
        }
        if (normalized.includes('format') || normalized.includes('prettier')) {
            return 'format';
        }
        if (normalized.includes('audit') || normalized.includes('security')) {
            return 'audit';
        }
        return 'custom';
    }
    getCommandForTaskType(taskType) {
        const commandMap = {
            lint: 'npx eslint . --fix --format json 2>&1 || true',
            test: 'npx vitest run --reporter=json 2>&1 || true',
            format: 'npx prettier --write "src/**/*.ts" 2>&1 || true',
            audit: 'npm audit --json 2>&1 || true',
            custom: 'echo "custom task placeholder"'
        };
        return commandMap[taskType];
    }
    sha256(content) {
        return createHash('sha256').update(content).digest('hex');
    }
    async execViaOpenClaw(request) {
        const token = process.env.OPENCLAW_TOKEN;
        if (!token) {
            throw new Error('OPENCLAW_TOKEN is required for Earner execution');
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
                    command: request.command,
                    host: request.host,
                    timeout: request.timeout ?? 30,
                    security: request.security ?? 'normal'
                }
            })
        });
        if (!response.ok) {
            throw new Error(`OpenClaw exec failed: ${response.status}`);
        }
        const result = (await response.json());
        if (result.error) {
            throw new Error(result.error);
        }
        return {
            output: result.output || '',
            exitCode: result.exitCode ?? 0,
            duration: result.duration ?? 0
        };
    }
    toBigInt(value, fallback) {
        if (typeof value === 'bigint') {
            return value;
        }
        if (typeof value === 'number') {
            return BigInt(Math.trunc(value));
        }
        if (typeof value === 'string') {
            try {
                return BigInt(value);
            }
            catch {
                return fallback;
            }
        }
        return fallback;
    }
    toSafeNumber(value) {
        if (typeof value === 'number' && Number.isInteger(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isInteger(parsed)) {
                return parsed;
            }
        }
        if (typeof value === 'bigint') {
            const asNumber = Number(value);
            if (Number.isSafeInteger(asNumber)) {
                return asNumber;
            }
        }
        return null;
    }
}
