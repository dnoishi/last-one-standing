import { isBinaryMarket } from '@somnia-chain/markets-sdk';
import type { UnifiedMarket } from '@somnia-chain/markets-sdk';
import type { Hex } from 'viem';

export interface RunSeries {
  seriesAsset: string;
  intervalSec: bigint;
  venueId: Hex;
}

export function matchingSeriesMarkets(
  markets: Iterable<UnifiedMarket>,
  run: RunSeries,
): UnifiedMarket[] {
  return [...markets]
    .filter((market) => {
      if (!isBinaryMarket(market.info)) return false;
      const info = market.info;
      return info.asset === run.seriesAsset
        && BigInt(info.intervalSec || 0) === run.intervalSec
        && info.venueId?.toLowerCase() === run.venueId.toLowerCase();
    })
    .sort((a, b) => {
      if (!isBinaryMarket(a.info) || !isBinaryMarket(b.info)) return 0;
      return Number(BigInt(a.info.tradingStart) - BigInt(b.info.tradingStart));
    });
}

export function registrationDeadline(
  markets: Iterable<UnifiedMarket>,
  now: bigint,
): bigint | null {
  let nextStart: bigint | null = null;

  for (const market of markets) {
    if (!isBinaryMarket(market.info)) continue;
    const tradingStart = BigInt(market.info.tradingStart);
    const expiry = BigInt(market.info.expiry);
    if (tradingStart <= now && now < expiry) return expiry;
    if (tradingStart > now && (nextStart === null || tradingStart < nextStart)) {
      nextStart = tradingStart;
    }
  }

  return nextStart;
}

export function firstRoundCandidate(
  markets: Iterable<UnifiedMarket>,
  now: bigint,
  openingGraceSec = 45n,
): UnifiedMarket | null {
  let candidate: UnifiedMarket | null = null;
  let candidateStart: bigint | null = null;

  for (const market of markets) {
    if (!market.active || !isBinaryMarket(market.info)) continue;
    const tradingStart = BigInt(market.info.tradingStart);
    const expiry = BigInt(market.info.expiry);
    if (tradingStart > now || now >= expiry || now - tradingStart > openingGraceSec) continue;
    if (candidateStart === null || tradingStart > candidateStart) {
      candidate = market;
      candidateStart = tradingStart;
    }
  }

  return candidate;
}
