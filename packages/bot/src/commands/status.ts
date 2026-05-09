import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';
import { getNetworkMode } from '../network-mode.js';
import { getPrivacyService } from '../service-registry.js';
import { getBotStartTime } from '../uptime.js';

const formatUptime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
};

export const registerStatus = (bot: Bot<BotContext>): void => {
  bot.command('status', async (ctx) => {
    const mode = getNetworkMode();
    const privacy = getPrivacyService();
    const health = await privacy.healthCheck();
    const network = privacy.getNetworkStatus();
    const uptime = formatUptime(Date.now() - getBotStartTime());

    const yes = '✅';
    const no = '❌';
    const lines = [
      '<b>📊 PrivateBet Agent Status</b>',
      '',
      `Network mode: <b>${mode}</b>`,
      `Chain: <code>${network.network}</code>`,
      `ZAMA relayer: <code>${network.zamaRelayerUrl}</code>`,
      `Relayer reachable: ${health.relayerReachable ? yes : no}`,
      `Sepolia RPC configured: ${network.hasRpc ? yes : no}`,
      `Contract address configured: ${network.hasContractAddr ? yes : no}`,
      `Uptime: <code>${uptime}</code>`,
    ];

    try {
      const { JsonRpcProvider } = await import('ethers');
      const provider = new JsonRpcProvider(
        process.env['SEPOLIA_RPC_URL'] || 'https://ethereum-sepolia-rpc.publicnode.com',
      );
      const blockNumber = await provider.getBlockNumber();
      lines.push(`📦 Sepolia block: ${blockNumber}`);
    } catch {
      lines.push('📦 Sepolia block: ❌ RPC unreachable');
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
};
