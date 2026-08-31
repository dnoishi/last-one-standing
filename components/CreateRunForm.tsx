'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { SomniaMarkets, isBinaryMarket } from '@somnia-chain/markets-sdk';
import { decodeEventLog, parseUnits } from 'viem';
import type { Address, Hex } from 'viem';
import { useAccount, useConnect, useWalletClient } from 'wagmi';
import { publicClient } from '../lib/clients';
import { publicConfig } from '../lib/config';
import { gameAbi } from '../lib/contracts';

interface SeriesOption {
  key: string;
  asset: string;
  intervalSec: bigint;
  venueId: Hex;
}

export function CreateRunForm() {
  const router = useRouter();
  const { address } = useAccount();
  const { connectors, connect } = useConnect();
  const { data: walletClient } = useWalletClient();
  const [owner, setOwner] = useState<Address | null>(null);
  const [series, setSeries] = useState<SeriesOption[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [targetSurvivors, setTargetSurvivors] = useState('1');
  const [maxRounds, setMaxRounds] = useState('5');
  const [maxPlayers, setMaxPlayers] = useState('16');
  const [entryStake, setEntryStake] = useState('5');
  const [minPosition, setMinPosition] = useState('5');

  useEffect(() => {
    const gameAddress = publicConfig.gameAddress;
    if (!gameAddress) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const exchange = new SomniaMarkets({
        indexerUrl: publicConfig.indexerUrl,
        chain: publicConfig.chain,
        addresses: publicConfig.addresses,
      });
      try {
        const [contractOwner, markets] = await Promise.all([
          publicClient.readContract({
            address: gameAddress,
            abi: gameAbi,
            functionName: 'owner',
          }),
          exchange.loadMarkets(true),
        ]);
        const choices = new Map<string, SeriesOption>();
        for (const market of Object.values(markets)) {
          if (!market.active || !isBinaryMarket(market.info)) continue;
          const info = market.info;
          if (!info.venueId || !info.intervalSec) continue;
          const intervalSec = BigInt(info.intervalSec);
          const key = `${info.asset}:${intervalSec}:${info.venueId.toLowerCase()}`;
          choices.set(key, {
            key,
            asset: info.asset,
            intervalSec,
            venueId: info.venueId,
          });
        }
        const sorted = [...choices.values()].sort(
          (a, b) => a.asset.localeCompare(b.asset) || Number(a.intervalSec - b.intervalSec),
        );
        if (!cancelled) {
          setOwner(contractOwner);
          setSeries(sorted);
          setSelectedKey((current) => current || sorted[0]?.key || '');
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        await exchange.close();
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => series.find((option) => option.key === selectedKey),
    [selectedKey, series],
  );
  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());

  function validate() {
    if (!selected) throw new Error('Select an active dreamDEX market series.');
    const target = Number(targetSurvivors);
    const rounds = Number(maxRounds);
    const players = Number(maxPlayers);
    if (![target, rounds, players].every(Number.isInteger)) {
      throw new Error('Survivors, rounds, and players must be whole numbers.');
    }
    if (target < 1) throw new Error('Target survivors must be at least 1.');
    if (rounds < 1) throw new Error('Max rounds must be at least 1.');
    if (players < target || players > 32) {
      throw new Error('Max players must be between target survivors and 32.');
    }
    const stake = parseUnits(entryStake, 6);
    const position = parseUnits(minPosition, 6);
    if (stake <= 0n || position <= 0n) throw new Error('Stake and position must be positive.');
    return { target, rounds, players, stake, position };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!address || !walletClient) {
      if (connectors[0]) connect({ connector: connectors[0] });
      return;
    }
    if (!isOwner || !publicConfig.gameAddress || !selected) return;

    setSubmitting(true);
    setError('');
    try {
      const values = validate();
      const hash = await walletClient.writeContract({
        address: publicConfig.gameAddress,
        abi: gameAbi,
        functionName: 'createRun',
        args: [
          selected.asset,
          selected.intervalSec,
          selected.venueId,
          values.target,
          values.rounds,
          values.players,
          values.stake,
          values.position,
        ],
        chain: publicConfig.chain,
        account: address,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      let runId: number | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== publicConfig.gameAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: gameAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'RunCreated') {
            runId = Number(decoded.args.runId);
            break;
          }
        } catch {
          // Ignore unrelated logs from the same transaction.
        }
      }
      if (runId === null) throw new Error('Run was created, but its RunCreated event was not found.');
      router.push(`/run/${runId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (!publicConfig.gameAddress) {
    return <Notice>Set NEXT_PUBLIC_GAME_ADDRESS before creating runs.</Notice>;
  }
  if (loading) return <Notice>Loading contract owner and dreamDEX series…</Notice>;
  if (!address) {
    return (
      <Notice>
        <p>Connect the owner wallet to configure a run.</p>
        <button
          onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          disabled={connectors.length === 0}
          className="mt-4 rounded-xl bg-orange-500 px-4 py-2 font-bold text-black hover:bg-orange-400 disabled:opacity-50"
        >
          Connect owner wallet
        </button>
      </Notice>
    );
  }
  if (!isOwner) {
    return (
      <Notice>
        <p className="font-semibold text-red-300">This wallet is not the contract owner.</p>
        <p className="mt-2 font-mono text-xs text-neutral-500">Owner: {owner || 'unavailable'}</p>
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
      <Field label="dreamDEX series" hint="Only currently active binary series are shown.">
        <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className={inputClass} disabled={series.length === 0}>
          {series.length === 0 && <option value="">No active series found</option>}
          {series.map((option) => (
            <option key={option.key} value={option.key}>
              {option.asset} · {formatInterval(option.intervalSec)} · venue {shortHex(option.venueId)}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Target survivors" hint="Run ends at or below this count.">
          <input className={inputClass} type="number" min="1" max="32" step="1" value={targetSurvivors} onChange={(event) => setTargetSurvivors(event.target.value)} />
        </Field>
        <Field label="Max rounds" hint="Remaining players split at the cap.">
          <input className={inputClass} type="number" min="1" step="1" value={maxRounds} onChange={(event) => setMaxRounds(event.target.value)} />
        </Field>
        <Field label="Max players" hint="Reactive gas cap: 32.">
          <input className={inputClass} type="number" min="1" max="32" step="1" value={maxPlayers} onChange={(event) => setMaxPlayers(event.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Entry stake (tUSDC)" hint="Six-decimal testnet collateral.">
          <input className={inputClass} type="number" min="0.000001" step="0.000001" value={entryStake} onChange={(event) => setEntryStake(event.target.value)} />
        </Field>
        <Field label="Minimum position (contracts)" hint="Outcome positions mirror the six-decimal collateral scale.">
          <input className={inputClass} type="number" min="0.000001" step="0.000001" value={minPosition} onChange={(event) => setMinPosition(event.target.value)} />
        </Field>
      </div>

      {selected && (
        <div className="rounded-xl border border-neutral-800 bg-black/30 p-4 text-xs text-neutral-400">
          <div>Asset: <span className="text-white">{selected.asset}</span></div>
          <div className="mt-1">Interval: <span className="text-white">{selected.intervalSec.toString()} seconds</span></div>
          <div className="mt-1 break-all">Venue: <span className="font-mono text-white">{selected.venueId}</span></div>
        </div>
      )}

      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <button type="submit" disabled={submitting || !selected} className="w-full rounded-xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? 'Creating run…' : 'Create run'}
      </button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <span className="mt-1 block text-xs text-neutral-500">{hint}</span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 text-neutral-300">{children}</div>;
}

function formatInterval(seconds: bigint) {
  if (seconds % 3600n === 0n) return `${seconds / 3600n}h`;
  if (seconds % 60n === 0n) return `${seconds / 60n}m`;
  return `${seconds}s`;
}

function shortHex(value: Hex) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

const inputClass = 'w-full rounded-xl border border-neutral-700 bg-black px-3 py-2.5 text-white outline-none focus:border-orange-500 disabled:opacity-50';
