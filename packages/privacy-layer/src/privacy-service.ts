/**
 * OPE-275 — Privacy Service (orchestration façade)
 *
 * Wraps the ZAMA fhEVM encrypted ERC-20 flow behind a small operation-id API
 * the rest of the system can drive without knowing about ciphertexts, EIP-712
 * reencrypt round-trips, or the gateway's decryption callback.
 *
 * Operations are tracked in-memory (Map keyed by `operationId`). Every method
 * returns the operation id so callers can poll `getStatus`.
 *
 * Supports two modes:
 *   mockMode=true  — pure mock, instant, deterministic (no network)
 *   mockMode=false — live ZAMA fhEVM on Sepolia using @zama-fhe/relayer-sdk + ethers
 */

import { randomUUID } from 'crypto';
import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/node';
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/node';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

export type Hex = `0x${string}`;

export type PrivacyOperationKind = 'deposit' | 'transfer' | 'withdraw';

export type PrivacyOperationStatus =
  | 'pending'
  | 'encrypting'
  | 'submitted'
  | 'awaiting-decrypt-callback'
  | 'complete'
  | 'failed';

export interface PrivacyOperation {
  id: string;
  kind: PrivacyOperationKind;
  status: PrivacyOperationStatus;
  amount: bigint;
  /** Plaintext-visible counterparty (set for deposit/withdraw; both set for transfer). */
  from?: Hex;
  to?: Hex;
  /** ZAMA encrypted handle (set after `encrypt()` resolves). */
  encryptedHandle?: Hex;
  /** Source-chain tx hash (deposit-wrap, transfer, or unwrap-initiate). */
  txHash?: Hex;
  /** Decryption-callback tx hash, withdraw flow only. */
  callbackTxHash?: Hex;
  /** Plaintext amount surfaced after decryption (withdraw flow only). */
  decryptedAmount?: bigint;
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export interface PrivacyServiceConfig {
  /** Sepolia chain id (11155111) or mainnet (1). */
  chainId: 1 | 11155111;
  /** ConfidentialERC20Wrapped (cUSDC) address on the target chain. */
  confidentialWrapper: Hex;
  /** Public USDC address (the `wrap` underlying). */
  underlyingUsdc: Hex;
  /** Max time to wait for ZAMA gateway decryption callback during withdraw. */
  decryptCallbackTimeoutMs: number;
  /** When true, all I/O is simulated (no RPC, no relayer). Default true. */
  mockMode: boolean;
  /** Sepolia RPC URL (live mode only). */
  rpcUrl?: string;
  /** Private key of the signer (live mode only). */
  privateKey?: string;
  /** ZAMA relayer URL override (live mode only). Defaults to SepoliaConfig.relayerUrl. */
  relayerUrl?: string;
}

export const ZAMA_DEFAULT_RELAYER_URL = 'https://relayer.testnet.zama.cloud/';

export const DEFAULT_PRIVACY_CONFIG: PrivacyServiceConfig = {
  chainId: 11155111,
  confidentialWrapper: '0x000000000000000000000000000000000000c0DE',
  underlyingUsdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  decryptCallbackTimeoutMs: 15 * 60 * 1000,
  mockMode: true,
};

export interface NetworkStatus {
  network: 'sepolia-testnet' | 'mainnet';
  zamaRelayerUrl: string;
  hasRpc: boolean;
  hasContractAddr: boolean;
}

export interface PrivacyHealthStatus {
  ok: boolean;
  network: string;
  relayerReachable: boolean;
  rpcConfigured: boolean;
}

const CONFIDENTIAL_ERC20_ABI = [
  'function transfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bool)',
  'function balanceOf(address account) view returns (bytes32)',
];

const WRAPPER_ABI = [
  'function wrap(uint256 amount) returns (bool)',
  'function unwrap(uint256 amount) returns (bool)',
  'event Wrap(address indexed from, uint256 amount)',
  'event Unwrap(address indexed from, uint256 amount)',
];

const USDC_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

const MOCK_TX = (): Hex => `0x${'cc'.repeat(32)}` as Hex;
const MOCK_HANDLE = (): Hex => `0x${'aa'.repeat(32)}` as Hex;

export class PrivacyService {
  private readonly config: PrivacyServiceConfig;
  private readonly operations: Map<string, PrivacyOperation> = new Map();

  // Cached live-mode helpers (lazy-initialised)
  private _provider: JsonRpcProvider | null = null;
  private _wallet: Wallet | null = null;
  private _fhevm: FhevmInstance | null = null;

  constructor(config: Partial<PrivacyServiceConfig> = {}) {
    const envContractAddr = process.env['CONFIDENTIAL_ERC20_ADDR'] as Hex | undefined;
    const envRpcUrl = process.env['SEPOLIA_RPC_URL'];
    const envRelayerUrl = process.env['ZAMA_RELAYER_URL'] ?? ZAMA_DEFAULT_RELAYER_URL;

    this.config = {
      ...DEFAULT_PRIVACY_CONFIG,
      ...(envContractAddr ? { confidentialWrapper: envContractAddr } : {}),
      ...(envRpcUrl ? { rpcUrl: envRpcUrl } : {}),
      relayerUrl: envRelayerUrl,
      ...config,
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Public USDC → encrypted cUSDC. The `amount` is plaintext on the wrap call
   * (same as ConfidentialERC20Wrapped.wrap) and becomes an encrypted balance
   * inside the wrapper. Returns the operation id; poll via `getStatus`.
   */
  async depositToEncrypted(amount: bigint, userAddress: Hex): Promise<string> {
    const op = this.createOperation('deposit', amount, { from: userAddress });

    if (this.config.mockMode) {
      this.advance(op, 'submitted', { txHash: MOCK_TX() });
      this.advance(op, 'complete', { encryptedHandle: MOCK_HANDLE() });
      return op.id;
    }

    return this.depositLive(op, amount, userAddress);
  }

  /**
   * Encrypted-balance transfer within the cUSDC pool. Both parties learn
   * nothing about the amount on-chain; the relayer SDK produces ciphertext +
   * input proof, the wrapper's `transfer(to, handle, proof)` is invoked.
   */
  async encryptedTransfer(from: Hex, to: Hex, amount: bigint): Promise<string> {
    const op = this.createOperation('transfer', amount, { from, to });

    if (this.config.mockMode) {
      this.advance(op, 'encrypting', { encryptedHandle: MOCK_HANDLE() });
      this.advance(op, 'submitted', { txHash: MOCK_TX() });
      this.advance(op, 'complete');
      return op.id;
    }

    return this.transferLive(op, from, to, amount);
  }

  /**
   * Encrypted cUSDC → public USDC. Submits an unwrap request to the wrapper,
   * which fires a decryption request to the ZAMA KMS gateway; the gateway
   * later calls back to release plaintext USDC to `destinationAddress`.
   *
   * In mock mode the callback resolves immediately. In live mode this method
   * resolves after the gateway callback is observed (or `decryptCallbackTimeoutMs`).
   */
  async decryptAndWithdraw(amount: bigint, destinationAddress: Hex): Promise<string> {
    const op = this.createOperation('withdraw', amount, { to: destinationAddress });

    if (this.config.mockMode) {
      this.advance(op, 'submitted', { txHash: MOCK_TX() });
      this.advance(op, 'awaiting-decrypt-callback');
      this.advance(op, 'complete', { callbackTxHash: MOCK_TX(), decryptedAmount: amount });
      return op.id;
    }

    return this.withdrawLive(op, amount, destinationAddress);
  }

  /** Returns a snapshot of the operation, or `undefined` if not tracked. */
  getStatus(operationId: string): PrivacyOperation | undefined {
    const op = this.operations.get(operationId);
    return op ? { ...op } : undefined;
  }

  /** All operations, newest first. Useful for diagnostics. */
  listOperations(): PrivacyOperation[] {
    return Array.from(this.operations.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getConfig(): PrivacyServiceConfig {
    return { ...this.config };
  }

  getNetworkStatus(): NetworkStatus {
    const placeholderWrapper = DEFAULT_PRIVACY_CONFIG.confidentialWrapper.toLowerCase();
    const hasContractAddr = this.config.confidentialWrapper.toLowerCase() !== placeholderWrapper;
    return {
      network: this.config.chainId === 11155111 ? 'sepolia-testnet' : 'mainnet',
      zamaRelayerUrl: this.config.relayerUrl ?? ZAMA_DEFAULT_RELAYER_URL,
      hasRpc: Boolean(this.config.rpcUrl),
      hasContractAddr,
    };
  }

  async healthCheck(): Promise<PrivacyHealthStatus> {
    const { network, zamaRelayerUrl, hasRpc } = this.getNetworkStatus();
    const relayerReachable = await this.pingRelayer(zamaRelayerUrl);
    return {
      ok: relayerReachable && hasRpc,
      network,
      relayerReachable,
      rpcConfigured: hasRpc,
    };
  }

  private async pingRelayer(url: string): Promise<boolean> {
    // eslint-disable-next-line no-undef
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      // Any HTTP response (even 404) implies the host is reachable.
      return res.status > 0;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Live-mode implementations ───────────────────────────────────────────

  private async depositLive(
    op: PrivacyOperation,
    amount: bigint,
    _userAddress: Hex,
  ): Promise<string> {
    try {
      const { wallet } = await this.initLive();

      // 1. Approve USDC → wrapper
      const usdc = new Contract(this.config.underlyingUsdc, USDC_ABI, wallet);
      const approveTx = await usdc.getFunction('approve')(this.config.confidentialWrapper, amount);
      await approveTx.wait();

      // 2. Wrap
      const wrapper = new Contract(this.config.confidentialWrapper, WRAPPER_ABI, wallet);
      const wrapTx = await wrapper.getFunction('wrap')(amount);
      this.advance(op, 'submitted', { txHash: wrapTx.hash as Hex });

      const receipt = await wrapTx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error(`Wrap tx reverted: ${wrapTx.hash}`);
      }

      // 3. Extract encrypted handle from the Wrap event
      const wrapEvent = receipt.logs
        .map((log: any) => {
          try {
            return wrapper.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === 'Wrap');

      const handle = (wrapEvent?.args?.['amount'] ?? `0x${'00'.repeat(32)}`) as Hex;
      this.advance(op, 'complete', { encryptedHandle: handle });
    } catch (err) {
      this.advance(op, 'failed', { error: String(err) });
    }
    return op.id;
  }

  private async transferLive(
    op: PrivacyOperation,
    from: Hex,
    to: Hex,
    amount: bigint,
  ): Promise<string> {
    try {
      const { wallet, fhevm } = await this.initLive();

      // 1. Encrypt the amount
      this.advance(op, 'encrypting');
      const input = fhevm.createEncryptedInput(this.config.confidentialWrapper, from);
      input.add64(amount);
      const { handles, inputProof } = await input.encrypt();
      const encryptedHandle =
        `0x${Buffer.from(handles[0] ?? new Uint8Array(32)).toString('hex')}` as Hex;
      this.advance(op, 'encrypting', { encryptedHandle });

      // 2. Submit encrypted transfer
      const token = new Contract(this.config.confidentialWrapper, CONFIDENTIAL_ERC20_ABI, wallet);
      const tx = await token.getFunction('transfer')(
        to,
        handles[0] ?? '0x' + '00'.repeat(32),
        inputProof,
      );
      this.advance(op, 'submitted', { txHash: tx.hash as Hex });

      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error(`Transfer tx reverted: ${tx.hash}`);
      }

      this.advance(op, 'complete');
    } catch (err) {
      this.advance(op, 'failed', { error: String(err) });
    }
    return op.id;
  }

  private async withdrawLive(
    op: PrivacyOperation,
    amount: bigint,
    _destinationAddress: Hex,
  ): Promise<string> {
    try {
      const { wallet } = await this.initLive();

      // 1. Unwrap — this triggers a decryption request to the ZAMA gateway
      const wrapper = new Contract(this.config.confidentialWrapper, WRAPPER_ABI, wallet);
      const unwrapTx = await wrapper.getFunction('unwrap')(amount);
      this.advance(op, 'submitted', { txHash: unwrapTx.hash as Hex });
      this.advance(op, 'awaiting-decrypt-callback');

      const receipt = await unwrapTx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error(`Unwrap tx reverted: ${unwrapTx.hash}`);
      }

      // 2. Poll for the decryption callback
      const callbackTxHash = await this.waitForDecryptionCallback(receipt.blockNumber!);
      if (callbackTxHash) {
        this.advance(op, 'complete', { callbackTxHash, decryptedAmount: amount });
      } else {
        this.advance(op, 'failed', { error: 'Timed out waiting for decryption callback' });
      }
    } catch (err) {
      this.advance(op, 'failed', { error: String(err) });
    }
    return op.id;
  }

  // ─── Live-mode helpers ───────────────────────────────────────────────────

  /** Lazily initialise provider, wallet, and fhevm instance for live mode. */
  private async initLive(): Promise<{
    provider: JsonRpcProvider;
    wallet: Wallet;
    fhevm: FhevmInstance;
  }> {
    if (!this.config.rpcUrl) throw new Error('rpcUrl is required for live mode');
    if (!this.config.privateKey) throw new Error('privateKey is required for live mode');

    if (!this._provider) {
      this._provider = new JsonRpcProvider(this.config.rpcUrl);
    }
    if (!this._wallet) {
      this._wallet = new Wallet(this.config.privateKey, this._provider);
    }
    if (!this._fhevm) {
      const instanceConfig = {
        ...SepoliaConfig,
        network: this.config.rpcUrl,
      };
      if (this.config.relayerUrl) {
        (instanceConfig as any).relayerUrl = this.config.relayerUrl;
      }
      this._fhevm = await createInstance(instanceConfig);
    }

    return { provider: this._provider, wallet: this._wallet, fhevm: this._fhevm };
  }

  /**
   * Poll the chain for a decryption callback tx from the ZAMA gateway.
   * Looks for incoming transactions to the wrapper contract after `fromBlock`.
   * Returns the callback tx hash, or null on timeout.
   */
  private async waitForDecryptionCallback(fromBlock: number): Promise<Hex | null> {
    const timeoutMs = this.config.decryptCallbackTimeoutMs;
    const provider = this._provider!;
    const wrapperAddr = this.config.confidentialWrapper;
    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 5_000;

    while (Date.now() < deadline) {
      try {
        const currentBlock = await provider.getBlockNumber();
        // Look for events/callbacks in recent blocks
        const toBlock = Math.min(currentBlock, fromBlock + 1000);
        if (toBlock > fromBlock) {
          const logs = await provider.getLogs({
            address: wrapperAddr,
            fromBlock: fromBlock + 1,
            toBlock,
          });
          // Any new log from the wrapper after the unwrap tx likely indicates
          // the gateway callback has been processed
          if (logs.length > 0) {
            return logs[0]!.transactionHash as Hex;
          }
        }
      } catch {
        // Network hiccup — keep polling
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
      );
    }

    return null;
  }

  // ─── Internal bookkeeping ────────────────────────────────────────────────

  private createOperation(
    kind: PrivacyOperationKind,
    amount: bigint,
    parties: { from?: Hex; to?: Hex },
  ): PrivacyOperation {
    const now = Date.now();
    const op: PrivacyOperation = {
      id: randomUUID(),
      kind,
      status: 'pending',
      amount,
      ...parties,
      startedAt: now,
      updatedAt: now,
    };
    this.operations.set(op.id, op);
    return op;
  }

  private advance(
    op: PrivacyOperation,
    status: PrivacyOperationStatus,
    patch: Partial<PrivacyOperation> = {},
  ): void {
    Object.assign(op, patch, { status, updatedAt: Date.now() });
  }
}
