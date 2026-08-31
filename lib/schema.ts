import { encodePacked, keccak256 } from 'viem';
import type { Hex } from 'viem';

export const roundResultSchema =
  'uint64 timestamp, uint32 runId, uint32 roundNumber, bytes32 marketId, ' +
  'uint8 winningSide, bool voided, uint32 eliminatedCount, uint32 survivorsRemaining, string commentary';

export function roundResultId(runId: number, marketId: Hex): Hex {
  return keccak256(encodePacked(['uint32', 'bytes32'], [runId, marketId]));
}

export interface RoundResult {
  timestamp: bigint;
  runId: number;
  roundNumber: number;
  marketId: Hex;
  winningSide: number;
  voided: boolean;
  eliminatedCount: number;
  survivorsRemaining: number;
  commentary: string;
}

export function decodedItemsToRound(items: Array<{ name: string; value: { value: unknown } }>): RoundResult {
  const values = Object.fromEntries(items.map((item) => [item.name, item.value.value]));
  return {
    timestamp: values.timestamp as bigint,
    runId: Number(values.runId),
    roundNumber: Number(values.roundNumber),
    marketId: values.marketId as Hex,
    winningSide: Number(values.winningSide),
    voided: Boolean(values.voided),
    eliminatedCount: Number(values.eliminatedCount),
    survivorsRemaining: Number(values.survivorsRemaining),
    commentary: String(values.commentary || ''),
  };
}
