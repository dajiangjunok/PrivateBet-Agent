/**
 * OPE-275 — Cross-chain bet orchestrator.
 *
 * State machine that runs the full private bet flow:
 *
 *     DepositStage   user USDC on source chain  → ConfidentialWrapper.wrap(amount)
 *         ↓
 *     PrivacyStage   encrypted-balance shuffle through cUSDC pool (mix)
 *         ↓
 *     BridgeStage    decrypt → bridge USDC to target market chain (Polygon/Base)
 *         ↓
 *     BetStage       place bet on Polymarket / Limitless on the target chain
 *
 * Each stage is a `Stage<...>` runner with `start()`, `getStatus()`, and a
 * timeout. The orchestrator advances stages sequentially; failure or timeout
 * in any stage moves the flow to a terminal `failed` status, leaving the
 * intermediate state available on `getStatus(flowId)` for diagnostics and
 * (eventually) recovery.
 *
 * Mock implementations only — every stage's body simulates the work and
 * returns deterministic success. The interfaces match the live wiring so
 * swapping internals does not break callers.
 */

import { randomUUID } from 'crypto';

import type { BridgeAdapter, BridgeDepositReceipt, ChainId, TokenRef } from './bridge-plan.js';
import type { Hex, PrivacyService } from './privacy-service.js';

// ────────────────────────────────────────────────────────────────────────────
//   Stage primitives
// ────────────────────────────────────────────────────────────────────────────

export type StageStatus = 'idle' | 'running' | 'complete' | 'failed' | 'timed-out';

export interface StageState<TOutput = unknown> {
  status: StageStatus;
  startedAt?: number;
  finishedAt?: number;
  output?: TOutput;
  error?: string;
}

export interface Stage<TInput, TOutput> {
  readonly name: BetFlowStage;
  readonly timeoutMs: number;
  start(input: TInput): Promise<StageState<TOutput>>;
  getStatus(): StageState<TOutput>;
}

export type BetFlowStage = 'deposit' | 'privacy' | 'bridge' | 'bet';

abstract class BaseStage<TInput, TOutput> implements Stage<TInput, TOutput> {
  abstract readonly name: BetFlowStage;
  readonly timeoutMs: number;
  protected state: StageState<TOutput> = { status: 'idle' };

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  async start(input: TInput): Promise<StageState<TOutput>> {
    this.state = { status: 'running', startedAt: Date.now() };
    try {
      const output = await this.withTimeout(this.run(input), this.timeoutMs);
      this.state = {
        status: 'complete',
        startedAt: this.state.startedAt,
        finishedAt: Date.now(),
        output,
      };
    } catch (e) {
      const isTimeout = e instanceof Error && e.message === '__stage_timeout__';
      this.state = {
        status: isTimeout ? 'timed-out' : 'failed',
        startedAt: this.state.startedAt,
        finishedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      };
    }
    return this.state;
  }

  getStatus(): StageState<TOutput> {
    return { ...this.state };
  }

  protected abstract run(input: TInput): Promise<TOutput>;

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('__stage_timeout__')), ms);
    });
    return Promise.race([p, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
//   Stage I/O types
// ────────────────────────────────────────────────────────────────────────────

export interface DepositStageInput {
  user: Hex;
  amount: bigint;
  sourceChainId: ChainId;
}

export interface DepositStageOutput {
  wrapTxHash: Hex;
  encryptedBalanceHandle: Hex;
}

export interface PrivacyStageInput {
  user: Hex;
  amount: bigint;
  encryptedBalanceHandle: Hex;
  /** Number of mix hops to perform inside the encrypted pool. */
  mixHops: number;
}

export interface PrivacyStageOutput {
  /** Final encrypted handle after the mix. */
  mixedHandle: Hex;
  hopTxHashes: Hex[];
}

export interface BridgeStageInput {
  user: Hex;
  amount: bigint;
  mixedHandle: Hex;
  destinationChainId: ChainId;
  destinationToken: TokenRef;
  sourceToken: TokenRef;
}

export interface BridgeStageOutput {
  unwrapTxHash: Hex;
  decryptCallbackTxHash: Hex;
  bridgeReceipt: BridgeDepositReceipt;
}

export interface BetStageInput {
  user: Hex;
  amount: bigint;
  marketId: string;
  outcome: 'YES' | 'NO';
  destinationChainId: ChainId;
}

export interface BetStageOutput {
  placeTxHash: Hex;
  filledAmount: bigint;
}

// ────────────────────────────────────────────────────────────────────────────
//   Concrete stages (mock implementations)
// ────────────────────────────────────────────────────────────────────────────

export class DepositStageRunner extends BaseStage<DepositStageInput, DepositStageOutput> {
  readonly name = 'deposit' as const;

  constructor(
    private readonly privacy: PrivacyService,
    timeoutMs = 10 * 60 * 1000,
  ) {
    super(timeoutMs);
  }

  protected async run(input: DepositStageInput): Promise<DepositStageOutput> {
    const opId = await this.privacy.depositToEncrypted(input.amount, input.user);
    const op = this.privacy.getStatus(opId);
    if (!op || op.status !== 'complete') {
      throw new Error(`deposit incomplete: ${op?.status ?? 'unknown'}`);
    }
    if (!op.txHash || !op.encryptedHandle) {
      throw new Error('deposit operation missing tx/handle');
    }
    return { wrapTxHash: op.txHash, encryptedBalanceHandle: op.encryptedHandle };
  }
}

export class PrivacyStageRunner extends BaseStage<PrivacyStageInput, PrivacyStageOutput> {
  readonly name = 'privacy' as const;

  constructor(
    private readonly privacy: PrivacyService,
    timeoutMs = 10 * 60 * 1000,
  ) {
    super(timeoutMs);
  }

  protected async run(input: PrivacyStageInput): Promise<PrivacyStageOutput> {
    const hops: Hex[] = [];
    let currentHandle = input.encryptedBalanceHandle;
    for (let i = 0; i < Math.max(1, input.mixHops); i++) {
      // Each hop: encrypted self-transfer that re-randomises the ciphertext.
      // In live mode the relayer chooses a fresh intermediate address per hop.
      const opId = await this.privacy.encryptedTransfer(input.user, input.user, input.amount);
      const op = this.privacy.getStatus(opId);
      if (!op || op.status !== 'complete' || !op.txHash) {
        throw new Error(`mix hop ${i} failed: ${op?.status ?? 'unknown'}`);
      }
      hops.push(op.txHash);
      if (op.encryptedHandle) currentHandle = op.encryptedHandle;
    }
    return { mixedHandle: currentHandle, hopTxHashes: hops };
  }
}

export class BridgeStageRunner extends BaseStage<BridgeStageInput, BridgeStageOutput> {
  readonly name = 'bridge' as const;

  constructor(
    private readonly privacy: PrivacyService,
    private readonly bridge: BridgeAdapter,
    timeoutMs = 30 * 60 * 1000,
  ) {
    super(timeoutMs);
  }

  protected async run(input: BridgeStageInput): Promise<BridgeStageOutput> {
    // 1) Decrypt the mixed cUSDC back to public USDC on the source chain.
    const withdrawOpId = await this.privacy.decryptAndWithdraw(input.amount, input.user);
    const withdrawOp = this.privacy.getStatus(withdrawOpId);
    if (!withdrawOp || withdrawOp.status !== 'complete') {
      throw new Error(`decrypt-withdraw failed: ${withdrawOp?.status ?? 'unknown'}`);
    }
    if (!withdrawOp.txHash || !withdrawOp.callbackTxHash) {
      throw new Error('decrypt-withdraw missing tx hashes');
    }

    // 2) Bridge the public USDC to the destination chain.
    if (!this.bridge.supports(input.sourceToken, input.destinationToken)) {
      throw new Error(
        `bridge ${this.bridge.kind} does not support route ${input.sourceToken.chainId}→${input.destinationToken.chainId}`,
      );
    }
    const quote = await this.bridge.quote({
      input: input.sourceToken,
      output: input.destinationToken,
      amount: input.amount,
      recipient: input.user,
    });
    let receipt = await this.bridge.submitDeposit({
      quote,
      sender: input.user,
      recipient: input.user,
    });
    while (receipt.status === 'pending') {
      receipt = await this.bridge.pollStatus(receipt);
      if (receipt.status === 'pending') break; // mock: no real polling loop
    }
    if (receipt.status !== 'filled') {
      throw new Error(`bridge ended in status=${receipt.status}`);
    }
    return {
      unwrapTxHash: withdrawOp.txHash,
      decryptCallbackTxHash: withdrawOp.callbackTxHash,
      bridgeReceipt: receipt,
    };
  }
}

export class BetStageRunner extends BaseStage<BetStageInput, BetStageOutput> {
  readonly name = 'bet' as const;

  constructor(timeoutMs = 5 * 60 * 1000) {
    super(timeoutMs);
  }

  protected async run(input: BetStageInput): Promise<BetStageOutput> {
    // Mock: live wiring delegates to @privatebet/polymarket-client (or limitless).
    void input;
    return {
      placeTxHash: `0x${'ff'.repeat(32)}` as Hex,
      filledAmount: input.amount,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
//   Orchestrator
// ────────────────────────────────────────────────────────────────────────────

export type FlowStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface FlowRequest {
  user: Hex;
  amount: bigint;
  sourceToken: TokenRef;
  destinationToken: TokenRef;
  marketId: string;
  outcome: 'YES' | 'NO';
  /** Optional override of the default mix hop count. */
  mixHops?: number;
}

export interface FlowState {
  id: string;
  status: FlowStatus;
  request: FlowRequest;
  currentStage: BetFlowStage | 'complete' | 'failed';
  stages: {
    deposit: StageState<DepositStageOutput>;
    privacy: StageState<PrivacyStageOutput>;
    bridge: StageState<BridgeStageOutput>;
    bet: StageState<BetStageOutput>;
  };
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export interface OrchestratorOptions {
  privacy: PrivacyService;
  bridge: BridgeAdapter;
  defaultMixHops?: number;
  stageTimeouts?: {
    deposit?: number;
    privacy?: number;
    bridge?: number;
    bet?: number;
  };
}

const idleStage = <T>(): StageState<T> => ({ status: 'idle' });

export class CrossChainBetOrchestrator {
  private readonly privacy: PrivacyService;
  private readonly bridge: BridgeAdapter;
  private readonly defaultMixHops: number;
  private readonly stageTimeouts: Required<NonNullable<OrchestratorOptions['stageTimeouts']>>;
  private readonly flows: Map<string, FlowState> = new Map();

  constructor(opts: OrchestratorOptions) {
    this.privacy = opts.privacy;
    this.bridge = opts.bridge;
    this.defaultMixHops = opts.defaultMixHops ?? 2;
    this.stageTimeouts = {
      deposit: opts.stageTimeouts?.deposit ?? 10 * 60 * 1000,
      privacy: opts.stageTimeouts?.privacy ?? 10 * 60 * 1000,
      bridge: opts.stageTimeouts?.bridge ?? 30 * 60 * 1000,
      bet: opts.stageTimeouts?.bet ?? 5 * 60 * 1000,
    };
  }

  /** Kick off a full deposit→mix→bridge→bet flow. Resolves when the flow terminates. */
  async startFlow(request: FlowRequest): Promise<FlowState> {
    const flow: FlowState = {
      id: randomUUID(),
      status: 'running',
      request,
      currentStage: 'deposit',
      stages: {
        deposit: idleStage<DepositStageOutput>(),
        privacy: idleStage<PrivacyStageOutput>(),
        bridge: idleStage<BridgeStageOutput>(),
        bet: idleStage<BetStageOutput>(),
      },
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.flows.set(flow.id, flow);

    // Stage 1: Deposit
    const deposit = new DepositStageRunner(this.privacy, this.stageTimeouts.deposit);
    flow.stages.deposit = await deposit.start({
      user: request.user,
      amount: request.amount,
      sourceChainId: request.sourceToken.chainId,
    });
    if (this.stageFailed(flow, 'deposit')) return this.snapshot(flow.id)!;

    const depositOut = flow.stages.deposit.output;
    if (!depositOut) {
      this.fail(flow, 'deposit returned no output');
      return this.snapshot(flow.id) as FlowState;
    }

    // Stage 2: Privacy mix
    flow.currentStage = 'privacy';
    flow.updatedAt = Date.now();
    const privacy = new PrivacyStageRunner(this.privacy, this.stageTimeouts.privacy);
    flow.stages.privacy = await privacy.start({
      user: request.user,
      amount: request.amount,
      encryptedBalanceHandle: depositOut.encryptedBalanceHandle,
      mixHops: request.mixHops ?? this.defaultMixHops,
    });
    if (this.stageFailed(flow, 'privacy')) return this.snapshot(flow.id)!;

    const privacyOut = flow.stages.privacy.output;
    if (!privacyOut) {
      this.fail(flow, 'privacy returned no output');
      return this.snapshot(flow.id) as FlowState;
    }

    // Stage 3: Bridge (decrypt + cross-chain transfer)
    flow.currentStage = 'bridge';
    flow.updatedAt = Date.now();
    const bridgeStage = new BridgeStageRunner(this.privacy, this.bridge, this.stageTimeouts.bridge);
    flow.stages.bridge = await bridgeStage.start({
      user: request.user,
      amount: request.amount,
      mixedHandle: privacyOut.mixedHandle,
      destinationChainId: request.destinationToken.chainId,
      destinationToken: request.destinationToken,
      sourceToken: request.sourceToken,
    });
    if (this.stageFailed(flow, 'bridge')) return this.snapshot(flow.id)!;

    // Stage 4: Bet placement
    flow.currentStage = 'bet';
    flow.updatedAt = Date.now();
    const betStage = new BetStageRunner(this.stageTimeouts.bet);
    flow.stages.bet = await betStage.start({
      user: request.user,
      amount: request.amount,
      marketId: request.marketId,
      outcome: request.outcome,
      destinationChainId: request.destinationToken.chainId,
    });
    if (this.stageFailed(flow, 'bet')) return this.snapshot(flow.id)!;

    flow.status = 'complete';
    flow.currentStage = 'complete';
    flow.updatedAt = Date.now();
    return this.snapshot(flow.id)!;
  }

  getStatus(flowId: string): FlowState | undefined {
    return this.snapshot(flowId);
  }

  listFlows(): FlowState[] {
    return [...this.flows.values()]
      .map((f) => structuredCloneFlow(f))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  private stageFailed(flow: FlowState, stage: BetFlowStage): boolean {
    const s = flow.stages[stage];
    if (s.status === 'complete') return false;
    flow.status = 'failed';
    flow.currentStage = 'failed';
    flow.updatedAt = Date.now();
    flow.error = `${stage}: ${s.status}${s.error ? ` — ${s.error}` : ''}`;
    return true;
  }

  private fail(flow: FlowState, error: string): void {
    flow.status = 'failed';
    flow.currentStage = 'failed';
    flow.error = error;
    flow.updatedAt = Date.now();
  }

  private snapshot(id: string): FlowState | undefined {
    const f = this.flows.get(id);
    return f ? structuredCloneFlow(f) : undefined;
  }
}

function structuredCloneFlow(f: FlowState): FlowState {
  return {
    ...f,
    request: { ...f.request },
    stages: {
      deposit: { ...f.stages.deposit },
      privacy: { ...f.stages.privacy },
      bridge: { ...f.stages.bridge },
      bet: { ...f.stages.bet },
    },
  };
}
