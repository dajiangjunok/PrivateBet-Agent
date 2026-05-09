import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';
import { getWalletService, getPrivacyService } from '../service-registry.js';
import { SUPPORTED_CHAINS } from '@privatebet/wallet-service';

const CHAIN_NAMES: Record<number, string> = {
  [SUPPORTED_CHAINS.ETHEREUM]: 'Ethereum',
  [SUPPORTED_CHAINS.POLYGON]: 'Polygon',
  [SUPPORTED_CHAINS.BASE]: 'Base',
};

export const registerWallet = (bot: Bot<BotContext>): void => {
  bot.command('create_wallet', async (ctx) => {
    if (!ctx.session.privacyAgreed) {
      await ctx.reply('Please /agree to the privacy notice first.');
      return;
    }
    if (ctx.session.walletAddress) {
      await ctx.reply(`You already have a wallet:\n\`${ctx.session.walletAddress}\``, {
        parse_mode: 'HTML',
      });
      return;
    }

    // Generate wallet via wallet-service
    const wallet = getWalletService();
    const tgUserId = String(ctx.from?.id ?? 'unknown');
    const multiChainWallet = wallet.generateWallet(tgUserId);

    // Store the Polygon address as the primary wallet address in session
    ctx.session.walletAddress = multiChainWallet.addresses[SUPPORTED_CHAINS.POLYGON] ?? '';

    const lines = ['👛 <b>Wallet generated successfully!</b>', '', 'Your deposit addresses:'];

    for (const [chainIdStr, address] of Object.entries(multiChainWallet.addresses)) {
      const chainName = CHAIN_NAMES[Number(chainIdStr)] ?? `Chain ${chainIdStr}`;
      lines.push(`• ${chainName}: \`${address}\``);
    }

    lines.push('');
    lines.push('🔐 Wallet keys are managed by MPC — you never handle private keys directly.');
    lines.push('Use /deposit for details on funding your account.');

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('deposit', async (ctx) => {
    const wallet = getWalletService();
    const tgUserId = String(ctx.from?.id ?? 'unknown');

    // Ensure wallet exists
    const multiChainWallet = wallet.getWallet(tgUserId);
    if (!multiChainWallet) {
      await ctx.reply('No wallet yet. Run /create_wallet first.');
      return;
    }

    const lines = ['💸 <b>Deposit Addresses</b> (USDC)', ''];

    for (const [chainIdStr, address] of Object.entries(multiChainWallet.addresses)) {
      const chainName = CHAIN_NAMES[Number(chainIdStr)] ?? `Chain ${chainIdStr}`;
      const chainId = Number(chainIdStr);
      const asset = chainId === SUPPORTED_CHAINS.POLYGON ? 'USDC.e' : 'USDC';
      lines.push(`• <b>${chainName}</b> (${asset}):`);
      lines.push(`  \`${address}\``);
      lines.push('');
    }

    lines.push('Supported tokens:');
    lines.push('• Polygon: USDC.e / native USDC');
    lines.push('• Base: native USDC');
    lines.push('• Ethereum: native USDC');
    lines.push('');
    lines.push('Funds are auto-detected and credited to your account.');
    lines.push('');
    lines.push('🚰 <b>Testnet Faucets (Sepolia ETH for gas):</b>');
    lines.push('• Google: https://cloud.google.com/application/web3/faucet/ethereum/sepolia');
    lines.push('• Alchemy: https://sepoliafaucet.com');
    lines.push('');
    lines.push(
      '<i>⚠️ Sepolia testnet — no real funds. Send Sepolia ETH to your Ethereum address above.</i>',
    );

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('balance', async (ctx) => {
    const wallet = getWalletService();
    const tgUserId = String(ctx.from?.id ?? 'unknown');

    const multiChainWallet = wallet.getWallet(tgUserId);
    if (!multiChainWallet) {
      await ctx.reply('No wallet yet. Run /create_wallet first.');
      return;
    }

    const lines = ['💰 <b>Balances</b>', ''];

    // Fetch balances from wallet service for each chain
    let totalUsd = 0;
    for (const [chainIdStr, address] of Object.entries(multiChainWallet.addresses)) {
      const chainId = Number(chainIdStr);
      const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainIdStr}`;
      try {
        const balance = await wallet.getBalance(address, chainId);
        const amount = Number(balance.formatted);
        totalUsd += amount;
        lines.push(`• ${chainName} ${balance.symbol}: <b>${balance.formatted}</b>`);
      } catch {
        lines.push(`• ${chainName}: ⚠️ unable to fetch`);
      }
    }

    lines.push('');
    lines.push(`📊 <b>Total: $${totalUsd.toFixed(2)}</b>`);

    lines.push('');
    lines.push('🧪 Sepolia Testnet — balances are real on-chain (test ETH only)');

    // Also show encrypted balance info from the privacy service
    const privacyService = getPrivacyService();
    const privacyOps = privacyService.listOperations();
    const depositOps = privacyOps.filter((op) => op.kind === 'deposit' && op.status === 'complete');
    if (depositOps.length > 0) {
      lines.push('');
      lines.push('🔐 <b>Encrypted Balances (ZAMA FHE)</b>');
      for (const op of depositOps.slice(0, 5)) {
        const amount = Number(op.amount) / 1_000_000;
        lines.push(
          `  • Deposited: $${amount.toFixed(2)} (handle: \`${op.encryptedHandle ?? 'n/a'}\`)`,
        );
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
};
