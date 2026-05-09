import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';
import { getNetworkMode } from '../network-mode.js';

const TESTNET_BANNER =
  '<i>🧪 Testnet Mode — all transactions are on Sepolia testnet, no real funds</i>';

const buildWelcome = (mode: 'testnet' | 'mainnet'): string => {
  const lines = [
    '🔒 <b>Welcome to PrivateBet Agent</b>',
    '',
    'A privacy-first AI betting assistant for prediction markets.',
    'Supported markets: Polymarket (Polygon), Limitless (Base).',
    '',
    '🔮 <b>Use /recommend to see AI picks and place bets!</b>',
    '',
    '<b>Privacy notice:</b>',
    '• Your bets are mixed via ZAMA FHE before settlement.',
    '• An MPC wallet is generated for you on /create_wallet.',
    '• We never store private keys in plaintext.',
    '',
    'Reply /agree to accept and continue, or /help to see commands.',
  ];
  if (mode === 'testnet') {
    lines.push('', TESTNET_BANNER);
  }
  return lines.join('\n');
};

export const registerStart = (bot: Bot<BotContext>): void => {
  bot.command('start', async (ctx) => {
    if (!ctx.session.privacyAgreed) {
      await ctx.reply(buildWelcome(getNetworkMode()), { parse_mode: 'HTML' });
      return;
    }
    await ctx.reply(
      'You are all set. Use /recommend to see AI picks and place bets, or /help to see all commands.',
    );
  });

  bot.command('agree', async (ctx) => {
    if (ctx.session.privacyAgreed) {
      await ctx.reply('Already accepted. Try /create_wallet next.');
      return;
    }
    ctx.session.privacyAgreed = true;
    await ctx.reply('Thanks! You can now use /create_wallet to begin.');
  });
};
