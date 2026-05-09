/**
 * @privatebet/wallet-service — Multi-chain wallet management
 * MVP uses HD wallet derivation; production will swap to MPC (Privy/Turnkey)
 */

import { createHmac } from 'crypto';
import { ethers } from 'ethers';

// --- Types ---

export interface MultiChainWallet {
  userId: string;
  addresses: Record<number, string>; // chainId -> address
  createdAt: Date;
}

export interface WalletBalance {
  address: string;
  chainId: number;
  symbol: string;
  decimals: number;
  raw: bigint;
  formatted: string;
}

export interface AssetInfo {
  symbol: string;
  decimals: number;
  contractAddress?: string;
}

export interface TransactionRequest {
  from: string;
  to: string;
  value: bigint;
  data?: string;
  chainId: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
}

export interface SignedTransaction {
  rawTx: string;
  hash: string;
}

export interface ApproveParams {
  tokenAddress: string;
  spender: string;
  amount: bigint;
  chainId: number;
}

export interface CostEstimate {
  gasCost: number;
  gasCostUsd: number;
  bridgeFeeUsd: number | null;
  totalUsd: number;
}

export const SUPPORTED_CHAINS = {
  ETHEREUM: 1,
  POLYGON: 137,
  BASE: 8453,
} as const;

export const CHAIN_ASSETS: Record<number, AssetInfo> = {
  [SUPPORTED_CHAINS.ETHEREUM]: { symbol: 'USDC', decimals: 6 },
  [SUPPORTED_CHAINS.POLYGON]: { symbol: 'pUSD', decimals: 6 },
  [SUPPORTED_CHAINS.BASE]: { symbol: 'USDC', decimals: 6 },
};

// --- Wallet Derivation (MVP: HMAC-based, not real BIP-32) ---

const DERIVATION_SALT = 'privatebet-wallet-derivation-v1';

function deriveAddress(userId: string, chainId: number, masterKey: string): string {
  const hmac = createHmac('sha256', masterKey);
  hmac.update(`${DERIVATION_SALT}:${userId}:${chainId}`);
  const derived = hmac.digest('hex');
  // Take first 20 bytes as Ethereum address
  return `0x${derived.slice(0, 40)}`;
}

// --- WalletService ---

export class WalletService {
  private masterKey: string;
  private wallets: Map<string, MultiChainWallet> = new Map();

  constructor(masterKey?: string) {
    this.masterKey = masterKey || process.env.WALLET_MASTER_KEY || 'dev-master-key-change-in-prod';
    if (this.masterKey === 'dev-master-key-change-in-prod') {
      console.warn('⚠️ Using default master key. Set WALLET_MASTER_KEY in production!');
    }
  }

  /**
   * Generate or retrieve a multi-chain wallet for a user
   */
  generateWallet(tgUserId: string): MultiChainWallet {
    const existing = this.wallets.get(tgUserId);
    if (existing) return existing;

    const addresses: Record<number, string> = {};
    for (const chainId of Object.values(SUPPORTED_CHAINS)) {
      addresses[chainId as number] = deriveAddress(tgUserId, chainId as number, this.masterKey);
    }

    const wallet: MultiChainWallet = {
      userId: tgUserId,
      addresses,
      createdAt: new Date(),
    };

    this.wallets.set(tgUserId, wallet);
    return wallet;
  }

  /**
   * Get deposit address for a specific chain
   */
  getDepositAddress(tgUserId: string, chainId: number): string {
    const wallet = this.wallets.get(tgUserId) || this.generateWallet(tgUserId);
    return wallet.addresses[chainId] ?? '';
  }

  /**
   * Get all addresses for a user
   */
  getWallet(tgUserId: string): MultiChainWallet | null {
    return this.wallets.get(tgUserId) || null;
  }

  /**
   * Get balance for an address on a specific chain
   */
  async getBalance(address: string, chainId: number): Promise<WalletBalance> {
    const asset = CHAIN_ASSETS[chainId];

    const rpcUrls: Record<number, string> = {
      1: process.env['ETHEREUM_RPC_URL'] || '',
      11155111: process.env['SEPOLIA_RPC_URL'] || 'https://ethereum-sepolia-rpc.publicnode.com',
      137: process.env['POLYGON_RPC_URL'] || 'https://polygon-rpc.com',
      8453: process.env['BASE_RPC_URL'] || 'https://mainnet.base.org',
    };

    const rpcUrl = rpcUrls[chainId];
    if (rpcUrl) {
      try {
        const { JsonRpcProvider } = await import('ethers');
        const provider = new JsonRpcProvider(rpcUrl);
        const balance = await provider.getBalance(address);
        const formatted = parseFloat(ethers.formatEther(balance)).toFixed(4);
        return {
          address,
          chainId,
          symbol: asset?.symbol || 'ETH',
          decimals: asset?.decimals || 18,
          raw: balance,
          formatted,
        };
      } catch {
        // Fall through to placeholder
      }
    }

    return {
      address,
      chainId,
      symbol: asset?.symbol || 'UNKNOWN',
      decimals: asset?.decimals || 18,
      raw: BigInt(0),
      formatted: '0.00',
    };
  }

  /**
   * Estimate gas cost for a transaction on a specific chain
   */
  async estimateGasCost(chainId: number): Promise<CostEstimate> {
    const gasEstimates: Record<number, number> = {
      [SUPPORTED_CHAINS.ETHEREUM]: 2.0, // ~$2 per tx on L1
      [SUPPORTED_CHAINS.POLYGON]: 0.01, // ~$0.01 per tx
      [SUPPORTED_CHAINS.BASE]: 0.02, // ~$0.02 per tx
    };

    const gasCost = gasEstimates[chainId] || 0.05;
    return {
      gasCost: gasCost,
      gasCostUsd: gasCost,
      bridgeFeeUsd: null,
      totalUsd: gasCost,
    };
  }

  /**
   * Resolve the signing wallet from PRIVATE_KEY + RPC URL for the chain.
   * MVP uses a single funded test wallet; per-user HD signing is a future step.
   */
  private resolveSigner(chainId: number): ethers.Wallet {
    const privateKey = process.env['PRIVATE_KEY'];
    if (!privateKey) {
      throw new Error(
        'PRIVATE_KEY not configured. Add a funded Sepolia wallet private key to .env.',
      );
    }

    const rpcUrls: Record<number, string> = {
      1: process.env['ETHEREUM_RPC_URL'] || '',
      11155111: process.env['SEPOLIA_RPC_URL'] || 'https://ethereum-sepolia-rpc.publicnode.com',
      137: process.env['POLYGON_RPC_URL'] || 'https://polygon-rpc.com',
      8453: process.env['BASE_RPC_URL'] || 'https://mainnet.base.org',
    };
    const rpcUrl = rpcUrls[chainId] || rpcUrls[11155111] || '';
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chainId ${chainId}`);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Wallet(privateKey, provider);
  }

  /**
   * Sign and broadcast a transaction. Uses PRIVATE_KEY for the signing
   * wallet (MVP); per-user HD-derived keys are a future enhancement.
   */
  async signTransaction(request: TransactionRequest): Promise<SignedTransaction> {
    const wallet = this.resolveSigner(request.chainId);

    const populated = await wallet.populateTransaction({
      to: request.to,
      value: request.value,
      data: request.data,
      chainId: request.chainId,
      ...(request.gasLimit !== undefined ? { gasLimit: request.gasLimit } : {}),
      ...(request.maxFeePerGas !== undefined ? { maxFeePerGas: request.maxFeePerGas } : {}),
    });

    const rawTx = await wallet.signTransaction(populated);
    const provider = wallet.provider;
    if (!provider) {
      throw new Error('Signer is missing a provider; cannot broadcast transaction');
    }
    const response = await provider.broadcastTransaction(rawTx);

    return { rawTx, hash: response.hash };
  }

  /**
   * Submit an ERC20 approve() call from the configured signing wallet.
   */
  async approveERC20(params: ApproveParams): Promise<SignedTransaction> {
    const erc20 = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
    ]);
    const data = erc20.encodeFunctionData('approve', [params.spender, params.amount]);

    return this.signTransaction({
      from: '',
      to: params.tokenAddress,
      value: BigInt(0),
      data,
      chainId: params.chainId,
    });
  }

  /**
   * @deprecated Use approveERC20 instead. Kept for source compatibility.
   */
  async approveToken(params: ApproveParams): Promise<string> {
    const signed = await this.approveERC20(params);
    return signed.hash;
  }
}

// Singleton instance
let instance: WalletService | null = null;

export function getWalletService(): WalletService {
  if (!instance) {
    instance = new WalletService();
  }
  return instance;
}
