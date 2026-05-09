/**
 * @privatebet/bot — /withdraw command
 */

import { Context } from 'grammy';

export async function withdrawCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  await ctx.reply(
    '💸 <b>Withdraw</b>\n\n' +
      'To withdraw, please provide:\n' +
      '1. Amount (USDC)\n' +
      '2. Destination address\n\n' +
      'Format: /withdraw <amount> <address>\n' +
      'Example: /withdraw 100 0x1234...\n\n' +
      '⚠️ Withdrawal will go through the privacy channel.\n' +
      'Estimated fee: varies by chain.\n' +
      'Estimated time: 10-30 minutes.',
    { parse_mode: 'HTML' },
  );
}
