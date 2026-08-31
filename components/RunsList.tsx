'use client';

import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { publicClient } from '../lib/clients';
import { publicConfig } from '../lib/config';
import { gameAbi } from '../lib/contracts';

interface RunSummary {
  id: number;
  asset: string;
  interval: number;
  round: number;
  maxRounds: number;
  survivors: number;
  pot: bigint;
  status: number;
}

const names = ['Unknown', 'Registration', 'Live', 'Between rounds', 'Finalized'];

export function RunsList({ limit }: { limit?: number }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    const gameAddress = publicConfig.gameAddress;
    if (!gameAddress) return;
    let cancelled = false;
    void (async () => {
      const next = await publicClient.readContract({
        address: gameAddress,
        abi: gameAbi,
        functionName: 'nextRunId',
      });
      const ids = Array.from({ length: Number(next) - 1 }, (_, i) => i + 1).reverse();
      const selected = limit ? ids.slice(0, limit) : ids;
      const data = await Promise.all(selected.map(async (id) => {
        const run = await publicClient.readContract({
          address: gameAddress,
          abi: gameAbi,
          functionName: 'getRun',
          args: [id],
        });
        return {
          id,
          asset: run.seriesAsset,
          interval: Number(run.intervalSec),
          round: Number(run.roundCount),
          maxRounds: Number(run.maxRounds),
          survivors: Number(run.survivorCount),
          pot: run.prizePool,
          status: run.status,
        };
      }));
      if (!cancelled) setRuns(data);
    })();
    return () => { cancelled = true; };
  }, [limit]);

  if (!publicConfig.gameAddress) return <p className="text-sm text-neutral-500">Deploy the contract and set NEXT_PUBLIC_GAME_ADDRESS to list runs.</p>;
  if (!runs) return <p className="text-sm text-neutral-500">Loading runs…</p>;
  if (runs.length === 0) return <p className="text-sm text-neutral-500">No runs have been created yet.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {runs.map((run) => (
        <a key={run.id} href={`/run/${run.id}`} className="group rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 transition hover:-translate-y-0.5 hover:border-orange-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-400">Run #{run.id}</span>
            <span className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">{names[run.status]}</span>
          </div>
          <h3 className="mt-3 text-2xl font-black">{run.asset} · {run.interval / 60}m</h3>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Round" value={`${run.round}/${run.maxRounds}`} />
            <Stat label="Standing" value={String(run.survivors)} />
            <Stat label="Pot" value={`${formatUnits(run.pot, 6)} tUSDC`} />
          </div>
        </a>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-neutral-500">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}
