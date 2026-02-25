import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import type { WalletNetwork } from '../wallet/WalletManager.js';
import { WalletManager } from '../wallet/WalletManager.js';
import type { EarnMode, EarnModeContext, EarnModeRunResult, ExecResult } from './modes/EarnMode.js';
import { CodeAuditMode } from './modes/CodeAuditMode.js';
import { AirdropMode } from './modes/AirdropMode.js';
import { ArbitrageMode } from './modes/ArbitrageMode.js';

export type TaskType = 'lint' | 'test' | 'format' | 'audit' | 'custom';

export interface EarnerConfig {
  network: WalletNetwork;
  bountyPackageId: string;
  bountyBoardId: string;
  openclawBaseUrl?: string;
}

export interface BountyTask {
  bountyId: number;
  objectId: string;
  description: string;
  rewardAmount: bigint;
  poster: string;
  completed: boolean;
  assignedAgent: string;
  taskType: TaskType;
}

export interface TaskResult {
  bounty: BountyTask;
  output: string;
  outputHash: string;
  success: boolean;
  duration: number;
  error?: string;
}

export interface ClaimResult {
  bountyId: number;
  rewardAmount: bigint;
  txDigest: string;
  explorerUrl: string;
  proofHash: string;
  success: boolean;
  error?: string;
}

export interface EarnResult {
  tasksFound: number;
  tasksCompleted: number;
  totalEarned: bigint;
  claims: ClaimResult[];
  modeResults: EarnModeRunResult[];
  timestamp: Date;
}

interface ExecRequest {
  command: string;
  host: 'gateway' | 'sandbox' | 'node';
  timeout?: number;
  security?: 'normal' | 'high';
}

interface ExecResponse {
  output: string;
  exitCode: number;
  duration: number;
}

interface OpenClawExecRpcResponse {
  output?: string;
  exitCode?: number;
  duration?: number;
  error?: string;
}

export class Earner {
  private readonly wallet: WalletManager;
  private readonly client: SuiClient;
  private readonly bountyPackageId: string;
  private bountyBoardId: string;
  private readonly openclawBaseUrl: string;
  private readonly network: WalletNetwork;
  private readonly modes: EarnMode[];

  constructor(wallet: WalletManager, config: EarnerConfig) {
    this.wallet = wallet;
    this.client = new SuiClient({ url: getFullnodeUrl(config.network) });
    this.bountyPackageId = config.bountyPackageId;
    this.bountyBoardId = config.bountyBoardId;
    this.openclawBaseUrl = config.openclawBaseUrl || process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
    this.network = config.network;

    // Register all EarnMode implementations
    this.modes = [
      new CodeAuditMode(),
      new AirdropMode(),
      new ArbitrageMode(),
    ];
  }

  async earn(): Promise<EarnResult> {
    const claims: ClaimResult[] = [];
    let totalEarned = 0n;

    let bounties = await this.getAvailableBounties();
    if (this.shouldForceSeedBounty()) {
      try {
        await this.seedDemoBounty();
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        bounties = await this.getAvailableBounties();
      } catch (error) {
        console.warn('⚠️ Force-seed bounty failed:', error instanceof Error ? error.message : error);
      }
    } else if (bounties.length === 0 && this.shouldAutoSeedBounty()) {
      try {
        await this.seedDemoBounty();
        // Give the indexer a moment to surface the new event.
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        bounties = await this.getAvailableBounties();
      } catch (error) {
        console.warn('⚠️ Auto-seed bounty failed:', error instanceof Error ? error.message : error);
      }
    }
    if (bounties.length === 0) {
      return {
        tasksFound: 0,
        tasksCompleted: 0,
        totalEarned,
        claims,
        modeResults: await this.runEarnModes(),
        timestamp: new Date()
      };
    }

    const orderedBounties = this.rankBounties(bounties);
    const prioritizedBounties = this.shouldForceSeedBounty()
      ? this.prioritizeSelfPostedBounties(orderedBounties)
      : orderedBounties;
    for (const bounty of prioritizedBounties) {
      const taskResult = await this.executeTask(bounty);
      if (!taskResult.success) {
        continue;
      }

      const claim = await this.claimBountyReward(taskResult);
      claims.push(claim);

      if (claim.success) {
        totalEarned += claim.rewardAmount;
        break;
      }
    }

    return {
      tasksFound: bounties.length,
      tasksCompleted: claims.some((claim) => claim.success) ? 1 : 0,
      totalEarned,
      claims,
      modeResults: await this.runEarnModes(),
      timestamp: new Date()
    };
  }

  /** Run all registered & enabled EarnModes, return their results. */
  private async runEarnModes(): Promise<EarnModeRunResult[]> {
    const ctx: EarnModeContext = {
      network: this.network,
      agentAddress: this.wallet.getAddress(),
      now: new Date(),
      exec: (command: string, timeoutSec?: number): ExecResult => {
        return this.execLocally({ command, host: 'node', timeout: timeoutSec ?? 30 });
      },
    };

    const results: EarnModeRunResult[] = [];
    for (const mode of this.modes) {
      if (!mode.isEnabled(process.env)) {
        continue;
      }
      console.log(`🔧 Running EarnMode: ${mode.name} (${mode.status})`);
      const result = await mode.run(ctx);
      results.push(result);
      if (result.success) {
        console.log(`  ✅ ${mode.name}: ${result.details?.findings ?? 0} findings`);
      } else {
        console.log(`  ⚠️ ${mode.name}: ${result.error || 'failed'}`);
      }
    }
    return results;
  }

  private shouldAutoSeedBounty(): boolean {
    return process.env.RUN_DEMO === 'true' || process.env.EARNER_AUTO_SEED_BOUNTY === 'true';
  }

  private shouldForceSeedBounty(): boolean {
    return process.env.EARNER_FORCE_SEED_BOUNTY === 'true';
  }

  private prioritizeSelfPostedBounties(bounties: BountyTask[]): BountyTask[] {
    const myAddress = this.wallet.getAddress().toLowerCase();
    const selfPosted = bounties.filter((bounty) => bounty.poster.toLowerCase() === myAddress);
    if (selfPosted.length === 0) {
      return bounties;
    }

    const others = bounties.filter((bounty) => bounty.poster.toLowerCase() !== myAddress);
    return [...selfPosted, ...others];
  }

  private async seedDemoBounty(): Promise<void> {
    const myAddress = this.wallet.getAddress();

    // Read treasury balance from board object.
    const board = await this.client.getObject({
      id: this.bountyBoardId,
      options: { showContent: true }
    });

    const fields = (board.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    const treasury = fields?.treasury as any;
    const treasuryValue = this.toBigInt(treasury?.fields?.value ?? treasury?.value ?? treasury?.fields?.balance ?? 0, 0n);

    // Keep the demo cheap.
    const rewardMist = BigInt(process.env.DEMO_BOUNTY_REWARD_MIST || '50000000'); // 0.05 SUI
    const depositMist = BigInt(process.env.DEMO_BOUNTY_DEPOSIT_MIST || '200000000'); // 0.2 SUI

    const tx = new Transaction();

    if (treasuryValue < rewardMist) {
      const coin = tx.splitCoins(tx.gas, [tx.pure.u64(depositMist)]);
      tx.moveCall({
        target: `${this.bountyPackageId}::bounty_board::deposit`,
        arguments: [tx.object(this.bountyBoardId), coin]
      });
    }

    const taskType = process.env.DEMO_BOUNTY_TASK_TYPE || 'git_status';
    const description = process.env.DEMO_BOUNTY_DESCRIPTION || 'Run git status and return output';

    const taskBytes = Array.from(new TextEncoder().encode(taskType));
    const descBytes = Array.from(new TextEncoder().encode(description));

    tx.moveCall({
      target: `${this.bountyPackageId}::bounty_board::post_bounty`,
      arguments: [
        tx.object(this.bountyBoardId),
        tx.pure.vector('u8', taskBytes),
        tx.pure.vector('u8', descBytes),
        tx.pure.u64(rewardMist),
        // Assign to this agent to make the demo deterministic.
        tx.pure.address(myAddress)
      ]
    });

    const result = await this.wallet.signAndExecute(tx);
    if (!result.success) {
      // Common demo failure: configured board isn't owned by this wallet.
      if ((result.error || '').includes('MoveAbort') && (result.error || '').includes('post_bounty') && (result.error || '').includes(', 0)')) {
        // Abort code 0 in this contract is E_NOT_OWNER.
        const newBoardId = await this.createPersonalBoardAndPersistEnv();
        this.bountyBoardId = newBoardId;
        console.warn(`⚠️ Switched to personal board: ${newBoardId}`);
        // Retry once on the new board.
        await this.seedDemoBounty();
        return;
      }
      throw new Error(result.error || 'post_bounty failed');
    }

    // Best-effort: verify the bounty was created by reading transaction events.
    try {
      const block = await this.client.getTransactionBlock({
        digest: result.digest,
        options: { showEvents: true }
      });
      const createdEventType = `${this.bountyPackageId}::bounty_board::BountyCreated`;
      const events = (block as any)?.events || [];
      const created = events.find((e: any) => e.type === createdEventType);
      const bountyId = (created?.parsedJson as any)?.bounty_id;
      if (bountyId) {
        console.log(`🧾 Seeded bounty: ${String(bountyId).slice(0, 16)}... reward=${Number(rewardMist) / 1e9} SUI`);
      }
    } catch {
      // ignore
    }
  }

  private async createPersonalBoardAndPersistEnv(): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.bountyPackageId}::bounty_board::create_board`,
      arguments: []
    });

    const result = await this.wallet.signAndExecute(tx);
    if (!result.success || !result.digest) {
      throw new Error(result.error || 'create_board failed');
    }

    const block = await this.client.getTransactionBlock({
      digest: result.digest,
      options: { showObjectChanges: true }
    });

    const changes = (block as any)?.objectChanges || [];
    const boardTypeIncludes = `${this.bountyPackageId}::bounty_board::BountyBoard`;
    const created = changes.find((c: any) => c.type === 'created' && typeof c.objectType === 'string' && c.objectType.includes(boardTypeIncludes));
    const boardObjectId = String(created?.objectId || '');
    if (!boardObjectId.startsWith('0x')) {
      throw new Error('Unable to locate created BountyBoard objectId from tx');
    }

    await this.updateDotEnvBoardId(boardObjectId);
    return boardObjectId;
  }

  private async updateDotEnvBoardId(newBoardId: string): Promise<void> {
    const envPath = join(process.cwd(), '.env');
    const raw = await readFile(envPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    let replaced = false;
    const next = lines.map((line) => {
      if (line.startsWith('BOUNTY_BOARD_ID=')) {
        replaced = true;
        return `BOUNTY_BOARD_ID=${newBoardId}`;
      }
      return line;
    });
    if (!replaced) {
      next.push(`BOUNTY_BOARD_ID=${newBoardId}`);
    }
    await writeFile(envPath, next.join('\n'), 'utf-8');
  }

  private rankBounties(bounties: BountyTask[]): BountyTask[] {
    const typePriority: Record<TaskType, number> = {
      lint: 5,
      test: 4,
      format: 3,
      audit: 2,
      custom: 1
    };

    return [...bounties].sort((left, right) => {
      if (left.rewardAmount === right.rewardAmount) {
        return typePriority[right.taskType] - typePriority[left.taskType];
      }

      return left.rewardAmount > right.rewardAmount ? -1 : 1;
    });
  }

  async getAvailableBounties(): Promise<BountyTask[]> {
    const board = await this.client.getObject({
      id: this.bountyBoardId,
      options: { showContent: true }
    });

    const fields = (board.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    const fromBoard = this.extractBountyList(fields?.bounties);
    const rawBounties = fromBoard.length > 0 ? fromBoard : await this.fetchBountiesFromEvents();

    const myAddress = this.wallet.getAddress().toLowerCase();
    const bounties = rawBounties
      .map((raw, index) => this.toBountyTask(raw, index + 1))
      .filter((task): task is BountyTask => task !== null)
      .filter((task) => !task.completed)
      .filter((task) => {
        const assigned = task.assignedAgent.toLowerCase();
        return assigned === '0x0' || assigned === '' || assigned === myAddress;
      });

    return bounties;
  }

  selectBestBounty(bounties: BountyTask[]): BountyTask | null {
    if (bounties.length === 0) {
      return null;
    }

    return this.rankBounties(bounties)[0];
  }

  async executeTask(bounty: BountyTask): Promise<TaskResult> {
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
    } catch (error) {
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

  async claimBountyReward(taskResult: TaskResult): Promise<ClaimResult> {
    const { bounty, outputHash } = taskResult;

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${this.bountyPackageId}::bounty_board::claim_reward`,
        arguments: [
          tx.object(this.bountyBoardId),
          tx.object(bounty.objectId),
          tx.pure.vector('u8', Array.from(Buffer.from(outputHash, 'hex'))),
          tx.object('0x6')
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
    } catch (error) {
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

  private extractBountyList(bountiesField: unknown): unknown[] {
    if (!bountiesField) {
      return [];
    }

    if (Array.isArray(bountiesField)) {
      return bountiesField;
    }

    if (typeof bountiesField === 'object' && bountiesField !== null) {
      const value = (bountiesField as { fields?: { contents?: unknown[] }; contents?: unknown[] });
      if (Array.isArray(value.fields?.contents)) {
        return value.fields.contents;
      }
      if (Array.isArray(value.contents)) {
        return value.contents;
      }
    }

    return [];
  }

  private async fetchBountiesFromEvents(): Promise<unknown[]> {
    const createdEventType = `${this.bountyPackageId}::bounty_board::BountyCreated`;
    const claimedEventType = `${this.bountyPackageId}::bounty_board::BountyClaimed`;

    const [createdPage, claimedPage] = await Promise.all([
      this.client.queryEvents({
        query: { MoveEventType: createdEventType },
        order: 'descending',
        limit: 100
      }),
      this.client.queryEvents({
        query: { MoveEventType: claimedEventType },
        order: 'descending',
        limit: 200
      })
    ]);

    const claimedBountyIds = new Set(
      claimedPage.data
        .map((event) => (event.parsedJson as { bounty_id?: string } | null | undefined)?.bounty_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    );

    const decodeBase64ToUtf8 = (value: string): string => {
      try {
        return Buffer.from(value, 'base64').toString('utf-8');
      } catch {
        return value;
      }
    };

    const seen = new Set<string>();
    return createdPage.data
      .map((event) => event.parsedJson as {
        bounty_id?: string;
        reward_amount?: string;
        task_type?: string;
        creator?: string;
      })
      .filter((payload) => typeof payload?.bounty_id === 'string' && payload.bounty_id.length > 0)
      .filter((payload) => {
        const objectId = String(payload.bounty_id);
        if (claimedBountyIds.has(objectId)) {
          return false;
        }
        if (seen.has(objectId)) {
          return false;
        }
        seen.add(objectId);
        return true;
      })
      .map((payload) => {
        const taskType = payload.task_type ? decodeBase64ToUtf8(payload.task_type) : 'custom';
        return {
          __objectId: String(payload.bounty_id),
          reward_amount: payload.reward_amount || '0',
          creator: payload.creator || '',
          description: taskType,
          is_active: true,
          assigned_agent: '0x0'
        };
      });
  }

  private toBountyTask(raw: unknown, fallbackId: number): BountyTask | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const withFields = raw as { fields?: Record<string, unknown> };
    const fields = withFields.fields ?? (raw as Record<string, unknown>);

    const description = this.decodeDescription(fields.description);
    const rewardAmount = this.toBigInt(fields.reward_amount, 0n);
    const poster = String(fields.poster ?? fields.creator ?? '');
    const objectId = this.extractObjectId(fields.__objectId ?? fields.id);
    const isActive = typeof fields.is_active === 'boolean' ? fields.is_active : undefined;
    const completed = typeof isActive === 'boolean' ? !isActive : Boolean(fields.completed ?? false);
    const assignedAgent = String(fields.assigned_agent ?? '0x0');
    const bountyId = this.toSafeNumber(fields.id) ?? fallbackId;

    if (!objectId) {
      return null;
    }

    return {
      bountyId,
      objectId,
      description,
      rewardAmount,
      poster,
      completed,
      assignedAgent,
      taskType: this.inferTaskType(description)
    };
  }

  private extractObjectId(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (value && typeof value === 'object') {
      const maybe = value as { id?: unknown; bytes?: unknown; objectId?: unknown };
      if (typeof maybe.objectId === 'string') {
        return maybe.objectId;
      }
      if (typeof maybe.id === 'string') {
        return maybe.id;
      }
      if (maybe.id && typeof maybe.id === 'object') {
        const nested = maybe.id as { id?: unknown };
        if (typeof nested.id === 'string') {
          return nested.id;
        }
      }
      if (typeof maybe.bytes === 'string') {
        return maybe.bytes;
      }
    }

    return '';
  }

  private decodeDescription(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      return new TextDecoder().decode(new Uint8Array(value));
    }

    if (value && typeof value === 'object') {
      const fieldsValue = value as { bytes?: number[]; fields?: { contents?: number[] }; contents?: number[] };
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

  private inferTaskType(description: string): TaskType {
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

  private getCommandForTaskType(taskType: TaskType): string {
    const commandMap: Record<TaskType, string> = {
      lint: 'npx eslint --format json . 2>&1 || true',
      test: 'npm test --if-present 2>&1 || true',
      format: 'npx prettier --check "src/**/*.ts" 2>&1 || true',
      audit: 'npm audit --json 2>&1; npx eslint --format json . 2>&1 || true',
      custom: 'node -e "console.log(JSON.stringify({status:\'ok\',ts:Date.now()}))"'
    };

    return commandMap[taskType];
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async execViaOpenClaw(request: ExecRequest): Promise<ExecResponse> {
    const token = process.env.OPENCLAW_TOKEN;
    if (!token) {
      throw new Error('OPENCLAW_TOKEN is required for Earner execution');
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
            command: request.command,
            host: request.host,
            timeout: request.timeout ?? 30,
            security: request.security ?? 'normal'
          }
        })
      });

      if (!response.ok) {
        if ([404, 405, 501].includes(response.status)) {
          return this.execLocally(request);
        }
        throw new Error(`OpenClaw exec failed: ${response.status}`);
      }

      const result = (await response.json()) as OpenClawExecRpcResponse;
      if (result.error) {
        throw new Error(result.error);
      }

      return {
        output: result.output || '',
        exitCode: result.exitCode ?? 0,
        duration: result.duration ?? 0
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('fetch failed') || message.includes('OpenClaw exec failed: 405')) {
        return this.execLocally(request);
      }
      throw error;
    }
  }

  private execLocally(request: ExecRequest): ExecResponse {
    const start = Date.now();
    try {
      const output = execSync(request.command, {
        encoding: 'utf-8',
        timeout: (request.timeout ?? 30) * 1000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return {
        output: output || '',
        exitCode: 0,
        duration: Date.now() - start
      };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return {
        output: `${err.stdout || ''}${err.stderr || ''}`,
        exitCode: typeof err.status === 'number' ? err.status : 1,
        duration: Date.now() - start
      };
    }
  }

  private toBigInt(value: unknown, fallback: bigint): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string') {
      try {
        return BigInt(value);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  private toSafeNumber(value: unknown): number | null {
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