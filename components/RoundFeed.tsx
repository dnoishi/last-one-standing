'use client';

import { useEffect, useState } from 'react';
import { isStreamsNoDataError, streamsReader } from '../lib/clients';
import { publicConfig } from '../lib/config';
import { decodedItemsToRound, type RoundResult } from '../lib/schema';

export function RoundFeed({ runId }: { runId: number }) {
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!publicConfig.schemaId || !publicConfig.publisherAddress) return;
    let cancelled = false;
    async function load() {
      try {
        const records = await fetchPublishedRounds(runId);
        if (cancelled) return;
        setRounds(records);
        setError('');
      } catch (reason) {
        if (cancelled) return;
        setRounds([]);
        setError(reason instanceof Error ? reason.message.split('Docs:')[0].trim() : String(reason));
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  if (!publicConfig.schemaId || !publicConfig.publisherAddress) {
    return <p className="text-sm text-neutral-500">Round stream will appear after NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID and NEXT_PUBLIC_PUBLISHER_ADDRESS are configured.</p>;
  }
  if (error) return <p className="text-sm text-red-400">Round stream: {error}</p>;
  if (rounds.length === 0) return <p className="text-sm text-neutral-500">No settled rounds yet.</p>;

  return (
    <ol className="space-y-3">
      {rounds.map((round) => (
        <li key={`${round.marketId}:${round.timestamp}`} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold">Round {round.roundNumber}</span>
            <span className={`text-xs font-bold uppercase ${round.voided ? 'text-amber-400' : round.winningSide === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {round.voided ? 'Voided' : round.winningSide === 0 ? 'Up won' : 'Down won'}
            </span>
          </div>
          <p className="mt-2 text-sm text-neutral-400">{round.eliminatedCount} eliminated · {round.survivorsRemaining} standing</p>
          {round.commentary && <p className="mt-2 text-sm italic text-neutral-300">“{round.commentary}”</p>}
        </li>
      ))}
    </ol>
  );
}

async function fetchPublishedRounds(runId: number): Promise<RoundResult[]> {
  const schemaId = publicConfig.schemaId!;
  const publisher = publicConfig.publisherAddress!;
  const streams = streamsReader();
  const total = await streams.totalPublisherDataForSchema(schemaId, publisher);
  if (total instanceof Error) {
    if (isStreamsNoDataError(total)) return [];
    throw total;
  }
  if (total === 0n) return [];

  const result = await streams.getAllPublisherDataForSchema(schemaId, publisher);
  if (result instanceof Error) {
    if (isStreamsNoDataError(result)) return [];
    throw result;
  }

  const records: RoundResult[] = [];
  for (const row of result) {
    if (!Array.isArray(row)) continue;
    try {
      const record = decodedItemsToRound(row as Array<{ name: string; value: { value: unknown } }>);
      if (record.runId === runId) records.push(record);
    } catch {
      // Ignore raw or stale rows that do not match this schema.
    }
  }
  records.sort((a, b) => b.roundNumber - a.roundNumber || Number(b.timestamp - a.timestamp));
  return records;
}
