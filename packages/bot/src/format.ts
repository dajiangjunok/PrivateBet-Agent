import type {
  BetStatus,
  CostEstimate,
  MarketInfo,
  PrivacyLevel,
  Recommendation,
} from '@privatebet/shared';

export const formatPrivacyLevel = (level: PrivacyLevel): string => '🔒'.repeat(level);

export const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`;

export const formatCostBrief = (cost: CostEstimate, market: MarketInfo): string => {
  const bridgePart =
    cost.bridgeFeeUsd > 0 ? `~$${cost.bridgeFeeUsd.toFixed(0)} bridge fee` : '~$0 bridge fee';
  return `${market.displayName} (${market.chainDisplayName}) | ${bridgePart}`;
};

export const formatCostBreakdown = (cost: CostEstimate): string =>
  [
    `• Gas: ${formatUsd(cost.gasFeeUsd)}`,
    `• Bridge: ${formatUsd(cost.bridgeFeeUsd)}`,
    `• ZAMA FHE: ${formatUsd(cost.fheFeeUsd)}`,
    `• Total: ${formatUsd(cost.totalFeeUsd)}`,
  ].join('\n');

export const formatRecommendation = (rec: Recommendation): string => {
  const odds = `YES ${(rec.currentOdds.yes * 100).toFixed(0)}% / NO ${(rec.currentOdds.no * 100).toFixed(0)}%`;
  const cost = formatCostBrief(rec.costEstimate, rec.market);
  const privacy = formatPrivacyLevel(rec.privacyLevel);
  const confidence = `${(rec.confidence * 100).toFixed(0)}%`;
  return [
    `📊 <b>${rec.title}</b>`,
    '',
    `Source: ${rec.market.displayName} (${rec.market.chainDisplayName})`,
    `Odds: ${odds}`,
    `AI Direction: <b>${rec.aiDirection}</b> (confidence ${confidence})`,
    `Cost: ${cost} | ${privacy}`,
    '',
    rec.rationale,
  ].join('\n');
};

const STAGE_LABELS: Record<BetStatus['stage'], string> = {
  pending: '⏳ Pending',
  mixing: '🔀 Privacy mixing...',
  bridging: '🌉 Bridging funds...',
  placing: '📡 Placing order...',
  placed: '✅ Order placed',
  filled: '🎯 Order filled',
  failed: '❌ Failed',
};

export const formatBetStatus = (status: BetStatus): string => {
  const lines = [STAGE_LABELS[status.stage]];
  if (status.message) lines.push(status.message);
  if (status.txHash) lines.push(`Tx: \`${status.txHash}\``);
  if (status.filledAmountUsd !== undefined) {
    lines.push(`Filled: ${formatUsd(status.filledAmountUsd)}`);
  }
  return lines.join('\n');
};
