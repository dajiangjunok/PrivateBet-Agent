import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';
import {
  getPolymarketAdapter,
  getLimitlessAdapter,
  getWalletService,
} from '../service-registry.js';
import { SUPPORTED_CHAINS } from '@privatebet/wallet-service';
import type { Position } from '@privatebet/polymarket-client';

function formatPosition(pos: Position, index: number): string {
  const lines = [`${index + 1}. 📊 Market: \`${pos.marketId}\``];
  if (pos.outcomeLabel) {
    lines.push(`   Outcome: ${pos.outcomeLabel}`);
  }
  lines.push(`   Size: ${pos.size} shares`);
  if (pos.price !== undefined) {
    lines.push(`   Mark price: ${(pos.price * 100).toFixed(1)}%`);
  }
  if (pos.valueUsd !== undefined) {
    lines.push(`   Value: $${pos.valueUsd.toFixed(2)}`);
  }
  return lines.join('\n');
}

export const registerPositions = (bot: Bot<BotContext>): void => {
  bot.command('positions', async (ctx) => {
    const wallet = getWalletService();
    const tgUserId = String(ctx.from?.id ?? 'unknown');
    const multiChainWallet = wallet.getWallet(tgUserId);

    if (!multiChainWallet) {
      await ctx.reply('No wallet yet. Run /create_wallet first.');
      return;
    }

    const polygonAddress = multiChainWallet.addresses[SUPPORTED_CHAINS.POLYGON] ?? '';

    await ctx.reply('📈 Fetching your positions...');

    const allPositions: Position[] = [];

    // Fetch from Polymarket
    try {
      const polyAdapter = getPolymarketAdapter();
      const polyPositions = await polyAdapter.getPositions(polygonAddress);
      allPositions.push(...polyPositions);
    } catch {
      // Polymarket API unavailable — skip
    }

    // Fetch from Limitless
    try {
      const limitAdapter = getLimitlessAdapter();
      const limitPositions = await limitAdapter.getPositions();
      allPositions.push(...limitPositions);
    } catch {
      // Limitless API unavailable — skip
    }

    if (allPositions.length === 0) {
      await ctx.reply(
        '📈 You have no open positions yet.\n\n' +
          'Use /recommend to see AI picks and place your first bet!',
      );
      return;
    }

    const lines = [`📈 <b>Open Positions (${allPositions.length})</b>`, ''];

    let totalValue = 0;
    for (let i = 0; i < allPositions.length; i++) {
      const pos = allPositions[i]!;
      lines.push(formatPosition(pos, i));
      if (pos.valueUsd !== undefined) totalValue += pos.valueUsd;
      lines.push('');
    }

    lines.push(`💰 <b>Total portfolio value: $${totalValue.toFixed(2)}</b>`);

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('history', async (ctx) => {
    const wallet = getWalletService();
    const tgUserId = String(ctx.from?.id ?? 'unknown');
    const multiChainWallet = wallet.getWallet(tgUserId);

    if (!multiChainWallet) {
      await ctx.reply('No wallet yet. Run /create_wallet first.');
      return;
    }

    // Check the privacy layer orchestrator for completed flows
    const { getOrchestrator } = await import('../service-registry.js');
    const orchestrator = getOrchestrator();
    const flows = orchestrator.listFlows();

    if (flows.length === 0) {
      await ctx.reply('📜 No betting history yet.');
      return;
    }

    const lines = ['📜 <b>Betting History</b>', ''];

    for (const flow of flows.slice(0, 10)) {
      const amount = Number(flow.request.amount) / 1_000_000;
      const status = flow.status === 'complete' ? '✅' : flow.status === 'failed' ? '❌' : '⏳';
      const date = new Date(flow.startedAt).toLocaleDateString();
      lines.push(
        `${status} $${amount.toFixed(2)} ${flow.request.outcome} on \`${flow.request.marketId}\` — ${date}`,
      );
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
};
