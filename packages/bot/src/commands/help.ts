import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';

const HELP = [
  '<b>PrivateBet Agent — commands</b>',
  '',
  '🪪 Onboarding:',
  '/start — Welcome & privacy agreement',
  '/agree — Accept privacy notice',
  '',
  '👛 Wallet:',
  '/create_wallet — Generate your MPC wallet',
  '/deposit — Show deposit address',
  '/balance — Check your balances',
  '',
  '📈 Bets:',
  '/recommend — Get AI picks & place bets',
  '/positions — View current positions',
  '/history — View betting history',
  '/withdraw — Withdraw to external address',
  '/cancel — Cancel an in-progress flow',
  '',
  '⚙️ Other:',
  '/settings — Push time, risk, market, cost limits',
  '/help — Show this message',
].join('\n');

export const registerHelp = (bot: Bot<BotContext>): void => {
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP, { parse_mode: 'HTML' });
  });
};
