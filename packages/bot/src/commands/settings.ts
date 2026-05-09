/**
 * @privatebet/bot — /settings command
 */

import { Context, InlineKeyboard } from 'grammy';

export interface UserSettings {
  pushTime: string; // HH:MM UTC
  riskPreference: 'conservative' | 'moderate' | 'aggressive';
  preferredMarket: 'auto' | 'polymarket' | 'limitless';
  maxCostPct: number; // max fee as % of bet size
  minConfidence: number; // 0-100
}

const DEFAULT_SETTINGS: UserSettings = {
  pushTime: '02:00',
  riskPreference: 'moderate',
  preferredMarket: 'auto',
  maxCostPct: 10,
  minConfidence: 65,
};

export async function settingsCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;

  const keyboard = new InlineKeyboard()
    .text('⏰ Push Time', 'settings:push_time')
    .text('🎲 Risk Level', 'settings:risk')
    .row()
    .text('🏪 Preferred Market', 'settings:market')
    .text('💸 Max Fee %', 'settings:max_cost')
    .row()
    .text('🎯 Min Confidence', 'settings:min_confidence');

  await ctx.reply(
    '⚙️ <b>Settings</b>\n\nCurrent settings:\n' +
      `  ⏰ Push: ${DEFAULT_SETTINGS.pushTime} UTC\n` +
      `  🎲 Risk: ${DEFAULT_SETTINGS.riskPreference}\n` +
      `  🏪 Market: ${DEFAULT_SETTINGS.preferredMarket}\n` +
      `  💸 Max fee: ${DEFAULT_SETTINGS.maxCostPct}%\n` +
      `  🎯 Min confidence: ${DEFAULT_SETTINGS.minConfidence}%`,
    { parse_mode: 'HTML', reply_markup: keyboard },
  );
}

export { DEFAULT_SETTINGS };
