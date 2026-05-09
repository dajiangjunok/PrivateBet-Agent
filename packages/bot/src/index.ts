/**
 * @privatebet/bot — Telegram Bot service
 * Multi-prediction-market privacy betting agent
 */

import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Bot, session } from 'grammy';
import { BotContext, initialSession } from './types.js';
import { registerStart } from './commands/start.js';
import { registerHelp } from './commands/help.js';
import { registerWallet } from './commands/wallet.js';
import { registerPositions } from './commands/positions.js';
import { settingsCommand } from './commands/settings.js';
import { registerStatus } from './commands/status.js';
import { withdrawCommand } from './commands/withdraw.js';
import { registerBetHandlers, registerBetMessageHandler } from './handlers/bet.js';
import { registerRecommendationHandler } from './handlers/recommendation.js';
import {
  getAIEngine,
  getPrivacyService,
  getBridgeAdapter,
  getOrchestrator,
  getWalletService,
  getPolymarketAdapter,
  getLimitlessAdapter,
} from './service-registry.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

const bot = new Bot<BotContext>(BOT_TOKEN);

// Error handler — prevent a single bad message from crashing the bot
bot.catch((err) => {
  console.error('❌ Bot error:', err.message ?? err);
});

// Session middleware — in-memory storage (per-process, resets on restart)
bot.use(
  session({
    initial: initialSession,
  }),
);

// Register command handlers
registerStart(bot);
registerHelp(bot);
registerWallet(bot);
registerPositions(bot);
registerStatus(bot);
registerRecommendationHandler(bot);

// Simple command handlers
bot.command('settings', settingsCommand);
bot.command('withdraw', withdrawCommand);

// Bet flow callback handlers (inline keyboard buttons)
registerBetHandlers(bot);

// Custom amount text input handler
registerBetMessageHandler(bot);

// Settings callback handler
bot.callbackQuery(/^settings:/, async (ctx) => {
  const setting = ctx.callbackQuery.data?.split(':')[1] ?? '';
  await ctx.answerCallbackQuery({ text: `Setting: ${setting}` });
  await ctx.editMessageText(
    `⚙️ Setting: <b>${setting}</b>\n\nConfiguration changes are saved automatically. Use /settings to view all options.`,
    { parse_mode: 'HTML' },
  );
});

// ── Health-check HTTP server ──────────────────────────────────────────

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT ?? '3000', 10);

const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Warm up service singletons
  getAIEngine();
  getPrivacyService();
  getBridgeAdapter();
  getOrchestrator();
  getWalletService();
  getPolymarketAdapter();
  getLimitlessAdapter();
  console.log('✅ All services initialized');

  // Start health-check endpoint
  await new Promise<void>((resolve) => healthServer.listen(HEALTH_PORT, () => resolve()));
  console.log(`🏥 Health endpoint listening on port ${HEALTH_PORT}`);

  // ── Startup diagnostics ────────────────────────────────────────────────
  console.log('🔧 Configuration:');
  console.log(`  AI Provider: ${process.env['AI_PROVIDER'] || 'zhipu'}`);
  console.log(`  AI Model: ${process.env['AI_MODEL'] || 'glm-4-flash'}`);
  console.log(`  Network: ${process.env['NETWORK_MODE'] || 'testnet'}`);
  console.log(`  Sepolia RPC: ${process.env['SEPOLIA_RPC_URL'] ? '✅' : '❌'}`);
  console.log(`  Private Key: ${process.env['PRIVATE_KEY'] ? '✅' : '❌ (signing disabled)'}`);
  console.log(
    `  ZAMA Contract: ${process.env['CONFIDENTIAL_ERC20_ADDR'] ? '✅' : '❌ (ZAMA mock only)'}`,
  );
  console.log(`  Zhipu API: ${process.env['ZHIPU_API_KEY'] ? '✅' : '❌'}`);
  console.log('─────────────────────────────────────────────────────────────');

  // Register bot command menu with Telegram
  await bot.api.setMyCommands([
    { command: 'start', description: 'Welcome & privacy agreement' },
    { command: 'recommend', description: 'Get AI picks & place bets' },
    { command: 'create_wallet', description: 'Generate your MPC wallet' },
    { command: 'balance', description: 'Check your balances' },
    { command: 'positions', description: 'View current positions' },
    { command: 'deposit', description: 'Show deposit address' },
    { command: 'settings', description: 'Configure preferences' },
    { command: 'status', description: 'Show network & service status' },
    { command: 'help', description: 'Show all commands' },
  ]);
  console.log('✅ Bot commands registered with Telegram');

  // Start bot polling
  await bot.start({
    onStart: (info) => {
      console.log(`🤖 Bot @${info.username} is polling…`);
    },
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n🛑 Received ${signal}, shutting down…`);
  await bot.stop();
  healthServer.close();
  console.log('👋 Goodbye');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Exports ───────────────────────────────────────────────────────────

export { bot };
export default bot;

// Re-export types
export type { RecommendationItem } from './handlers/recommendation.js';
export type { BetRequest as BetFlowRequest, BetStage as BetFlowStage } from './handlers/bet.js';
export type { UserSettings } from './commands/settings.js';

// Start the bot when run directly (not imported)
main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
