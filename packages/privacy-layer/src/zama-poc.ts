/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OPE-265 — ZAMA fhEVM Proof of Concept
 *
 * Demonstrates the encrypted ERC20 flow on Sepolia:
 *   1. createInstance(SepoliaConfig) — bootstrap the relayer SDK
 *   2. createEncryptedInput(...).add64(amount).encrypt() — produce ciphertext + proof
 *   3. contract.transfer(handle, proof) — encrypted on-chain transfer
 *   4. userDecrypt(handle) — read own encrypted balance via EIP-712 reencrypt
 *
 * Run modes:
 *   DEMO_MODE=mock   — print the flow without network calls (default)
 *   DEMO_MODE=live   — actually connect to Sepolia (requires RPC + private key + deployed wrapper)
 *
 * Required deps (add via `pnpm add` inside packages/privacy-layer):
 *   @zama-fhe/relayer-sdk
 *   ethers
 *
 * Required env (live mode):
 *   SEPOLIA_RPC_URL          — e.g. https://eth-sepolia.g.alchemy.com/v2/<key>
 *   PRIVATE_KEY              — funded Sepolia account
 *   CONFIDENTIAL_ERC20_ADDR  — address of ConfidentialERC20Wrapped or ERC-7984 token on Sepolia
 *   RECIPIENT_ADDR           — counterparty for the demo transfer
 */

type DemoMode = 'mock' | 'live';

const log = (step: string, detail?: unknown): void => {
  if (detail === undefined) {
    console.log(`[zama-poc] ${step}`);
  } else {
    console.log(`[zama-poc] ${step}`, detail);
  }
};

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

interface PocConfig {
  mode: DemoMode;
  rpcUrl: string;
  privateKey: string;
  tokenAddress: string;
  recipient: string;
  amount: bigint;
}

const loadConfig = (): PocConfig => {
  const mode = (process.env['DEMO_MODE'] ?? 'mock') as DemoMode;
  if (mode === 'mock') {
    return {
      mode,
      rpcUrl: 'https://eth-sepolia.public.example/mock',
      privateKey: '0x' + '11'.repeat(32),
      tokenAddress: '0x000000000000000000000000000000000000c0DE',
      recipient: '0x000000000000000000000000000000000000bEEF',
      amount: 1_000_000n,
    };
  }
  return {
    mode,
    rpcUrl: requireEnv('SEPOLIA_RPC_URL'),
    privateKey: requireEnv('PRIVATE_KEY'),
    tokenAddress: requireEnv('CONFIDENTIAL_ERC20_ADDR'),
    recipient: requireEnv('RECIPIENT_ADDR'),
    amount: BigInt(process.env['AMOUNT'] ?? '1000000'),
  };
};

const CONFIDENTIAL_ERC20_ABI = [
  'function transfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bool)',
  'function balanceOf(address account) view returns (bytes32)',
];

async function dynImport(spec: string): Promise<any> {
  return await (Function('s', 'return import(s)') as (s: string) => Promise<any>)(spec);
}

async function runMock(cfg: PocConfig): Promise<void> {
  log('mode = mock — no network traffic, illustrating the flow');
  log('1) createInstance(SepoliaConfig)', {
    network: 'sepolia',
    chainId: 11155111,
    relayerUrl: 'https://relayer.testnet.zama.cloud',
  });
  log('2) instance.createEncryptedInput(token, sender)', {
    token: cfg.tokenAddress,
    sender: '0xMOCK_SENDER',
  });
  log('   .add64(amount)', { amount: cfg.amount.toString() });
  log('   .encrypt() ⇒ { handles[0], inputProof }', {
    handle: '0x' + 'aa'.repeat(32),
    inputProofBytes: 1234,
  });
  log('3) contract.transfer(to, handle, inputProof)', {
    to: cfg.recipient,
    txHash: '0x' + 'cc'.repeat(32),
  });
  log('4) instance.userDecrypt(balanceHandle, eip712Sig) ⇒ plaintext', {
    plaintext: '99000000',
  });
  log('done — mock flow ok. Set DEMO_MODE=live + env vars for real Sepolia run.');
}

async function runLive(cfg: PocConfig): Promise<void> {
  log('mode = live — connecting to Sepolia');

  const sdk = await dynImport('@zama-fhe/relayer-sdk/node').catch((e) => {
    throw new Error(
      `Failed to import @zama-fhe/relayer-sdk/node — run "pnpm add @zama-fhe/relayer-sdk" inside packages/privacy-layer. (${String(e)})`,
    );
  });
  const ethersMod = await dynImport('ethers').catch((e) => {
    throw new Error(
      `Failed to import ethers — run "pnpm add ethers" inside packages/privacy-layer. (${String(e)})`,
    );
  });
  const { createInstance, SepoliaConfig } = sdk;
  const { JsonRpcProvider, Wallet, Contract } = ethersMod;

  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const wallet = new Wallet(cfg.privateKey, provider);
  log('wallet', { address: await wallet.getAddress() });

  log('initializing fhEVM instance (Sepolia)…');
  const fhevm = await createInstance(SepoliaConfig);

  log('encrypting input', { token: cfg.tokenAddress, amount: cfg.amount.toString() });
  const input = fhevm.createEncryptedInput(cfg.tokenAddress, await wallet.getAddress());
  input.add64(cfg.amount);
  const { handles, inputProof } = await input.encrypt();
  const encryptedAmountHandle = handles[0];
  log('encrypted', { handle: encryptedAmountHandle, proofBytes: inputProof.length });

  const token = new Contract(cfg.tokenAddress, CONFIDENTIAL_ERC20_ABI, wallet);
  log('submitting encrypted transfer…');
  const tx = await token['transfer'](cfg.recipient, encryptedAmountHandle, inputProof);
  const receipt = await tx.wait();
  log('transfer mined', { txHash: receipt?.hash, gasUsed: receipt?.gasUsed?.toString() });

  log('reading own balance handle…');
  const balanceHandle: string = await token['balanceOf'](await wallet.getAddress());
  log('balanceHandle', balanceHandle);

  log('requesting userDecrypt of own balance (EIP-712 sign + relayer round-trip)…');
  const plaintextBalance = await fhevm.userDecrypt(
    [{ handle: balanceHandle, contractAddress: cfg.tokenAddress }],
    wallet,
  );
  log('decrypted balance', plaintextBalance);

  log('done — live flow ok.');
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  log('config', {
    mode: cfg.mode,
    rpcUrl: cfg.mode === 'live' ? cfg.rpcUrl : '<mock>',
    token: cfg.tokenAddress,
    recipient: cfg.recipient,
    amount: cfg.amount.toString(),
  });
  if (cfg.mode === 'live') {
    await runLive(cfg);
  } else {
    await runMock(cfg);
  }
}

main().catch((err) => {
  console.error('[zama-poc] fatal:', err);
  process.exitCode = 1;
});
