/**
 * @privatebet/bot — Bet flow handler
 * Handles the multi-step betting process with cost transparency,
 * wired to AI Engine, Wallet Service, and Privacy Layer.
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';
import { getWalletService, getOrchestrator, getMarketAdapter } from '../service-registry.js';
import { resolveFullId } from './recommendation.js';
import type { MarketAnalysis } from '@privatebet/ai-engine';
import type { FlowState, Hex } from '@privatebet/privacy-layer';

// ── Types ───────────────────────────────────────────────────────────────

export type BetStage =
  | 'select_amount'
  | 'confirm'
  | 'executing'
  | 'privacy_mixing'
  | 'bridging'
  | 'order_placed'
  | 'filled'
  | 'failed';

export interface BetRequest {
  recommendationId: string;
  marketSource: string;
  side: 'YES' | 'NO';
  amount: number;
  gasEstimate: number;
  bridgeFeeEstimate: number;
  fheFeeEstimate: number;
  totalFeeEstimate: number;
  privacyLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ── In-memory cache of recent AI analyses (keyed by recommendationId) ───

const analysisCache = new Map<string, MarketAnalysis>();

export function cacheAnalysis(analysis: MarketAnalysis): void {
  analysisCache.set(analysis.marketId, analysis);
}

export function getCachedAnalysis(recId: string): MarketAnalysis | undefined {
  return analysisCache.get(recId);
}

// ── Keyboard / formatting helpers ───────────────────────────────────────

export function createAmountKeyboard(recId: string, side: 'YES' | 'NO'): InlineKeyboard {
  return new InlineKeyboard()
    .text('$10', `amount:${recId}:${side}:10`)
    .text('$50', `amount:${recId}:${side}:50`)
    .text('$100', `amount:${recId}:${side}:100`)
    .row()
    .text('$200', `amount:${recId}:${side}:200`)
    .text('✏️ Custom', `amount:${recId}:${side}:custom`);
}

export function formatConfirmation(bet: BetRequest): string {
  const totalCost = bet.amount + bet.totalFeeEstimate;
  const feePct = ((bet.totalFeeEstimate / bet.amount) * 100).toFixed(1);

  return [
    '📋 <b>Confirm Your Bet</b>',
    '',
    `🏪 Market: ${bet.marketSource}`,
    `${bet.side === 'YES' ? '🟢' : '🔴'} Side: ${bet.side}`,
    `💵 Amount: $${bet.amount}`,
    '',
    '💸 <b>Fee Breakdown</b>',
    `  Gas: $${bet.gasEstimate.toFixed(2)}`,
    `  Bridge: $${bet.bridgeFeeEstimate.toFixed(2)}`,
    `  Privacy (ZAMA FHE): $${bet.fheFeeEstimate.toFixed(2)}`,
    `  <b>Total fees: $${bet.totalFeeEstimate.toFixed(2)} (${feePct}%)</b>`,
    '',
    `💰 Total: $${totalCost.toFixed(2)}`,
    '',
    '⚠️ Fees are estimates. Final cost may vary.',
  ].join('\n');
}

export function createConfirmKeyboard(
  recId: string,
  side: 'YES' | 'NO',
  amount: number,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm', `confirm:${recId}:${side}:${amount}`)
    .text('❌ Cancel', `cancel:${recId}`);
}

export function formatStatusUpdate(stage: BetStage, detail?: string): string {
  const messages: Record<BetStage, string> = {
    select_amount: '💰 Select your bet amount',
    confirm: '📋 Review and confirm',
    executing: '⏳ Executing your bet...',
    privacy_mixing: '🔐 Privacy mixing in progress...',
    bridging: '🌉 Bridging funds...',
    order_placed: '📤 Order placed, waiting for fill...',
    filled: '✅ Bet filled!',
    failed: '❌ Bet failed. Please try again.',
  };

  let msg = messages[stage];
  if (detail) {
    msg += `\n${detail}`;
  }
  return msg;
}

// ── Build a BetRequest with live cost estimates ─────────────────────────

async function buildBetRequest(
  recId: string,
  side: 'YES' | 'NO',
  amountUsd: number,
): Promise<BetRequest> {
  const analysis = getCachedAnalysis(recId);

  // Get cost estimates from the market adapter
  let gasEstimate = 0.05;
  let bridgeFeeEstimate = 0;
  let fheFeeEstimate = 0.5;
  let marketSource = recId;
  let privacyLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

  if (analysis) {
    marketSource = analysis.title;
    privacyLevel = analysis.privacyLevel;
    bridgeFeeEstimate = analysis.bridgeFeeEstimate;

    try {
      const adapter = getMarketAdapter(analysis.source);
      const gasCost = await adapter.estimateGasCost();
      gasEstimate = gasCost.gasUsd ?? gasCost.totalUsd;

      const bridgeCost = await adapter.estimateBridgeCost?.();
      if (bridgeCost) {
        bridgeFeeEstimate = bridgeCost.bridgeFeeUsd ?? bridgeCost.totalUsd;
      }
    } catch {
      // Fall back to analysis estimates
    }
  }

  const totalFeeEstimate = gasEstimate + bridgeFeeEstimate + fheFeeEstimate;

  return {
    recommendationId: recId,
    marketSource,
    side,
    amount: amountUsd,
    gasEstimate,
    bridgeFeeEstimate,
    fheFeeEstimate,
    totalFeeEstimate,
    privacyLevel,
  };
}

// ── Execute the full bet flow ───────────────────────────────────────────

async function executeBetFlow(
  ctx: BotContext,
  recId: string,
  side: 'YES' | 'NO',
  amountUsd: number,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const wallet = getWalletService();
  const orchestrator = getOrchestrator();
  const analysis = getCachedAnalysis(recId);

  // Validate recommendation with AI Engine
  if (analysis && analysis.recommendation !== side) {
    // AI suggested a different direction — warn but allow
    void analysis;
  }

  // Check balance via wallet service
  const tgUserId = String(ctx.from?.id ?? 'unknown');
  const walletData = wallet.getWallet(tgUserId);
  if (!walletData) {
    await ctx.api.sendMessage(chatId, '❌ No wallet found. Run /create_wallet first.');
    return;
  }

  const polygonAddress = walletData.addresses[137] ?? '';
  const balance = await wallet.getBalance(polygonAddress, 137);
  const balanceNum = Number(balance.formatted);

  if (balanceNum < amountUsd) {
    await ctx.api.sendMessage(
      chatId,
      `❌ Insufficient balance. You have $${balance.formatted} but need $${amountUsd.toFixed(2)}.`,
    );
    return;
  }

  // Push status: executing
  const statusMsg = await ctx.api.sendMessage(
    chatId,
    formatStatusUpdate('executing', 'Preparing your private bet...'),
  );

  try {
    // Determine source/destination tokens for the orchestrator
    const sourceChainId = 1 as const; // Ethereum (ZAMA cUSDC)
    const destChainId = analysis?.source === 'limitless' ? (8453 as const) : (137 as const);

    // Start the cross-chain bet flow via the Privacy Layer orchestrator
    const flowState: FlowState = await orchestrator.startFlow({
      user: polygonAddress as Hex,
      amount: BigInt(Math.round(amountUsd * 1_000_000)), // USDC has 6 decimals
      sourceToken: {
        chainId: sourceChainId,
        address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Hex,
        variant: 'usdc-l1',
        decimals: 6,
      },
      destinationToken: {
        chainId: destChainId,
        address:
          destChainId === 137
            ? ('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Hex)
            : ('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex),
        variant: destChainId === 137 ? 'usdc-e' : 'native-usdc',
        decimals: 6,
      },
      marketId: recId,
      outcome: side,
      mixHops: 2,
    });

    // Push stage updates based on the flow result
    if (flowState.status === 'complete') {
      // Push updates for each completed stage
      await ctx.api.sendMessage(
        chatId,
        formatStatusUpdate('privacy_mixing', '✅ Privacy mixing complete'),
      );
      await ctx.api.sendMessage(chatId, formatStatusUpdate('bridging', '✅ Funds bridged'));
      await ctx.api.sendMessage(
        chatId,
        formatStatusUpdate('order_placed', '✅ Order placed on market'),
      );

      const betOutput = flowState.stages.bet.output;
      const filledAmount = betOutput?.filledAmount
        ? Number(betOutput.filledAmount) / 1_000_000
        : amountUsd;

      await ctx.api.sendMessage(
        chatId,
        formatStatusUpdate(
          'filled',
          `Bet of $${filledAmount.toFixed(2)} ${side} filled successfully! 🎉`,
        ),
      );
    } else if (flowState.status === 'failed') {
      // Determine which stage failed for a more helpful message
      const failedStage = flowState.currentStage;
      const errorDetail = flowState.error ?? 'Unknown error';
      await ctx.api.sendMessage(
        chatId,
        formatStatusUpdate('failed', `Stage: ${failedStage}. ${errorDetail}`),
      );
    }

    // Try to delete the intermediate "executing" message
    try {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id);
    } catch {
      // Ignore — old message may have been deleted already
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.api.sendMessage(chatId, formatStatusUpdate('failed', `Error: ${msg}`));
  }
}

// ── Register callback handlers ──────────────────────────────────────────

export function registerBetHandlers(bot: Bot<BotContext>): void {
  // "bet:<recId>:<YES|NO|SKIP>" — user chose a side from recommendation
  bot.callbackQuery(/^bet:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const shortId = parts[1] ?? '';
    const side = parts[2] as 'YES' | 'NO' | 'SKIP';

    await ctx.answerCallbackQuery({ text: 'Processing...' });

    if (side === 'SKIP') {
      await ctx.editMessageText('⏭️ Skipped this recommendation.');
      return;
    }

    // Store pending bet in session (keep short ID for keyboard creation)
    ctx.session.pendingBet = {
      recommendationId: shortId,
      side,
    };

    // Show amount selection keyboard (short ID keeps callback data under 64 bytes)
    const keyboard = createAmountKeyboard(shortId, side);
    await ctx.editMessageText(
      formatStatusUpdate('select_amount', `You chose <b>${side}</b>. How much do you want to bet?`),
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  });

  // "amount:<recId>:<side>:<amount|custom>"
  bot.callbackQuery(/^amount:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const shortId = parts[1] ?? '';
    const side = parts[2] as 'YES' | 'NO';
    const amountStr = parts[3] ?? '10';

    await ctx.answerCallbackQuery({ text: 'Amount selected' });

    // Resolve short ID → full market ID for cache lookups
    const fullId = resolveFullId(shortId) ?? shortId;

    if (amountStr === 'custom') {
      ctx.session.pendingBet = {
        recommendationId: shortId,
        side,
        awaitingCustomAmount: true,
      };
      await ctx.editMessageText('✏️ Enter your custom amount (in USD):', {
        parse_mode: 'HTML',
      });
      return;
    }

    const amount = Number(amountStr);

    // Build bet request with cost estimates (use full ID for cache lookup)
    const betRequest = await buildBetRequest(fullId, side, amount);

    // Show confirmation (short ID keeps callback data under 64 bytes)
    const keyboard = createConfirmKeyboard(shortId, side, amount);
    await ctx.editMessageText(formatConfirmation(betRequest), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });

  // "confirm:<recId>:<side>:<amount>"
  bot.callbackQuery(/^confirm:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    const shortId = parts[1] ?? '';
    const side = parts[2] as 'YES' | 'NO';
    const amount = Number(parts[3] ?? '10');

    // Resolve short ID → full market ID for cache lookups and bet execution
    const fullId = resolveFullId(shortId) ?? shortId;

    await ctx.answerCallbackQuery({ text: 'Confirming bet...' });
    await ctx.editMessageText(formatStatusUpdate('executing', 'Starting private bet flow...'));

    // Clear pending bet from session
    ctx.session.pendingBet = undefined;

    // Execute the bet flow (runs the full deposit→mix→bridge→bet pipeline)
    await executeBetFlow(ctx, fullId, side, amount);
  });

  // "cancel:<recId>"
  bot.callbackQuery(/^cancel:/, async (ctx) => {
    ctx.session.pendingBet = undefined;
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.editMessageText('❌ Bet cancelled.');
  });
}

// ── Handle custom amount text input ─────────────────────────────────────

export function registerBetMessageHandler(bot: Bot<BotContext>): void {
  bot.on('message:text', async (ctx) => {
    // Only intercept if user is in custom-amount flow
    if (!ctx.session.pendingBet?.awaitingCustomAmount) return;

    const text = ctx.message.text.trim();
    const amount = parseFloat(text);

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('Please enter a valid positive number.');
      return;
    }

    if (amount > 10000) {
      await ctx.reply('Maximum bet amount is $10,000.');
      return;
    }

    const { recommendationId, side } = ctx.session.pendingBet;
    ctx.session.pendingBet.awaitingCustomAmount = false;
    ctx.session.pendingBet.selectedAmountUsd = amount;

    // Resolve short ID → full market ID for cache lookups
    const fullId = resolveFullId(recommendationId) ?? recommendationId;

    // Build bet request with cost estimates
    const betRequest = await buildBetRequest(fullId, side, amount);

    // Show confirmation (keep short ID in callback data to stay under 64 bytes)
    const keyboard = createConfirmKeyboard(recommendationId, side, amount);
    await ctx.reply(formatConfirmation(betRequest), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  });
}
