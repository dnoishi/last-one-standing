'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SomniaMarkets, isBinaryMarket } from '@somnia-chain/markets-sdk';
import { formatUnits, parseUnits } from 'viem';
import type { Address, Hex, WalletClient } from 'viem';
import { useAccount, useConnect, useWalletClient } from 'wagmi';
import { publicClient } from '../lib/clients';
import { publicConfig } from '../lib/config';
import { erc20Abi, gameAbi } from '../lib/contracts';
import { matchingSeriesMarkets, registrationDeadline } from '../lib/schedule';
import { RoundFeed } from './RoundFeed';

interface RunData {
  seriesAsset: string;
  intervalSec: bigint;
  venueId: Hex;
  targetSurvivors: number;
  maxRounds: number;
  maxPlayers: number;
  roundCount: number;
  survivorCount: number;
  claimantCount: number;
  claimedCount: number;
  entryStake: bigint;
  minPosition: bigint;
  prizePool: bigint;
  unclaimedPrize: bigint;
  trackedMarketId: Hex;
  marketAddress: Address;
  yesId: bigint;
  noId: bigint;
  subscriptionId: bigint;
  status: number;
}

interface PlayerPosition {
  account: Address;
  marketId: Hex;
  up: bigint;
  down: bigint;
  decimals: number;
}

const statusName = ['Unknown', 'Registration', 'Live', 'Between rounds', 'Finalized'];

export function RunView({ runId }: { runId: number }) {
  const { address } = useAccount();
  const { connectors, connect } = useConnect();
  const { data: walletClient } = useWalletClient();
  const [run, setRun] = useState<RunData | null>(null);
  const [players, setPlayers] = useState<Address[]>([]);
  const [alive, setAlive] = useState<Address[]>([]);
  const [commentary, setCommentary] = useState('');
  const [marketExpiry, setMarketExpiry] = useState<bigint | null>(null);
  const [marketDecimals, setMarketDecimals] = useState<number | null>(null);
  const [registrationEndsAt, setRegistrationEndsAt] = useState<bigint | null>(null);
  const [position, setPosition] = useState<PlayerPosition | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [quantity, setQuantity] = useState('5');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!publicConfig.gameAddress) return;
    try {
      const [nextRun, allPlayers, survivors] = await Promise.all([
        publicClient.readContract({ address: publicConfig.gameAddress, abi: gameAbi, functionName: 'getRun', args: [runId] }),
        publicClient.readContract({ address: publicConfig.gameAddress, abi: gameAbi, functionName: 'getPlayers', args: [runId] }),
        publicClient.readContract({ address: publicConfig.gameAddress, abi: gameAbi, functionName: 'getAlive', args: [runId] }),
      ]);
      const data = nextRun as unknown as RunData;
      setRun(data);
      setPlayers([...allPlayers]);
      setAlive([...survivors]);
      setLoadError('');
      if (data.roundCount > 0) {
        const text = await publicClient.readContract({
          address: publicConfig.gameAddress,
          abi: gameAbi,
          functionName: 'commentary',
          args: [runId, data.roundCount],
        });
        setCommentary(text);
      }
      if (data.status === 1) {
        setMarketDecimals(null);
        setPosition(null);
        setPositionError('');
        setPositionLoading(false);
        const exchange = new SomniaMarkets({
          indexerUrl: publicConfig.indexerUrl,
          chain: publicConfig.chain,
          addresses: publicConfig.addresses,
        });
        try {
          const markets = matchingSeriesMarkets(
            Object.values(await exchange.loadMarkets(true)),
            data,
          );
          setRegistrationEndsAt(
            registrationDeadline(markets, BigInt(Math.floor(Date.now() / 1000))),
          );
        } finally {
          await exchange.close();
        }
      } else {
        setRegistrationEndsAt(null);
        if (data.status === 2 && data.trackedMarketId !== (`0x${'0'.repeat(64)}` as Hex)) {
          const exchange = new SomniaMarkets({
            indexerUrl: publicConfig.indexerUrl,
            chain: publicConfig.chain,
            addresses: publicConfig.addresses,
          });
          try {
            const market = await exchange.client.getMarketOnchain(data.trackedMarketId);
            setMarketExpiry(market.expiry);
            setMarketDecimals(market.decimals);
            if (address) {
              setPositionLoading(true);
              try {
                const [up, down] = await exchange.client.getBalances([
                  { token: market.outcomeToken, id: market.yesId },
                  { token: market.outcomeToken, id: market.noId },
                ], address);
                setPosition({
                  account: address,
                  marketId: data.trackedMarketId,
                  up,
                  down,
                  decimals: market.decimals,
                });
                setPositionError('');
              } catch (reason) {
                setPositionError(reason instanceof Error ? reason.message : String(reason));
              } finally {
                setPositionLoading(false);
              }
            } else {
              setPosition(null);
              setPositionError('');
              setPositionLoading(false);
            }
          } finally {
            await exchange.close();
          }
        } else {
          setMarketExpiry(null);
          setMarketDecimals(null);
          setPosition(null);
          setPositionError('');
          setPositionLoading(false);
        }
      }
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoaded(true);
    }
  }, [address, runId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, []);

  const aliveSet = useMemo(() => new Set(alive.map((p) => p.toLowerCase())), [alive]);
  const currentPosition = useMemo(() => {
    if (
      !address
      || !run
      || !position
      || position.account.toLowerCase() !== address.toLowerCase()
      || position.marketId.toLowerCase() !== run.trackedMarketId.toLowerCase()
    ) return null;
    return position;
  }, [address, position, run]);
  const isStanding = Boolean(address && aliveSet.has(address.toLowerCase()));
  const hasQualifyingCall = Boolean(
    run
    && currentPosition
    && (currentPosition.up >= run.minPosition || currentPosition.down >= run.minPosition),
  );
  const hasPartialPosition = Boolean(
    currentPosition && (currentPosition.up > 0n || currentPosition.down > 0n),
  );
  const registrationTime = useMemo(() => {
    if (!run || run.status !== 1 || registrationEndsAt === null) return null;
    return Number(registrationEndsAt - BigInt(now));
  }, [now, registrationEndsAt, run]);
  const quantityMeetsMinimum = useMemo(() => {
    if (!run) return false;
    try {
      return parseUnits(quantity || '0', marketDecimals ?? 6) >= run.minPosition;
    } catch {
      return false;
    }
  }, [marketDecimals, quantity, run]);

  async function transact(label: string, action: (wallet: WalletClient) => Promise<Hex>) {
    if (!address || !walletClient) {
      if (connectors[0]) connect({ connector: connectors[0] });
      return;
    }
    setBusy(label);
    setError('');
    try {
      const hash = await action(walletClient);
      await publicClient.waitForTransactionReceipt({ hash });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  async function register() {
    if (!run || !publicConfig.gameAddress) return;
    await transact('register', async (wallet) => {
      const allowance = await publicClient.readContract({
        address: publicConfig.collateralAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address!, publicConfig.gameAddress!],
      });
      if (allowance < run.entryStake) {
        const approval = await wallet.writeContract({
          address: publicConfig.collateralAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [publicConfig.gameAddress!, run.entryStake],
          chain: publicConfig.chain,
          account: address!,
        });
        await publicClient.waitForTransactionReceipt({ hash: approval });
      }
      return wallet.writeContract({
        address: publicConfig.gameAddress!,
        abi: gameAbi,
        functionName: 'register',
        args: [runId],
        chain: publicConfig.chain,
        account: address!,
      });
    });
  }

  async function faucet() {
    await transact('faucet', (wallet) => wallet.writeContract({
      address: publicConfig.collateralAddress,
      abi: erc20Abi,
      functionName: 'faucet',
      args: [10_000n * 10n ** 6n],
      chain: publicConfig.chain,
      account: address!,
    }));
  }

  async function trade(side: 'up' | 'down') {
    if (!run || !address || !walletClient || run.status !== 2) {
      if (!address && connectors[0]) connect({ connector: connectors[0] });
      return;
    }
    setBusy(side);
    setError('');
    try {
      const onchainExchange = new SomniaMarkets({
        indexerUrl: publicConfig.indexerUrl,
        chain: publicConfig.chain,
        addresses: publicConfig.addresses,
        account: address,
        walletClient,
      });
      const onchain = await onchainExchange.client.getMarketOnchain(run.trackedMarketId);
      if (onchain.status !== 1) throw new Error('This market is no longer trading.');
      const markets = Object.values(await onchainExchange.loadMarkets(true));
      const market = markets.find((m) => isBinaryMarket(m.info) && m.info.marketId === run.trackedMarketId);
      const symbol = market?.outcomes?.[side === 'up' ? 0 : 1]?.symbol;
      if (!symbol) throw new Error('Could not resolve the outcome symbol.');
      const book = await onchainExchange.fetchOrderBook(symbol, 5);
      const ask = book.asks[0]?.[0];
      if (ask === undefined) throw new Error('No resting liquidity is available.');
      await onchainExchange.createOrder(symbol, 'limit', 'buy', Number(quantity), Math.min(0.99, ask + 0.02), { timeInForce: 'IOC' });
      await onchainExchange.close();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  async function claim() {
    if (!publicConfig.gameAddress) return;
    await transact('claim', (wallet) => wallet.writeContract({
      address: publicConfig.gameAddress!,
      abi: gameAbi,
      functionName: 'claim',
      args: [runId],
      chain: publicConfig.chain,
      account: address!,
    }));
  }

  if (!publicConfig.gameAddress) return <SetupNotice />;
  if (!loaded) return <p className="text-neutral-400">Loading run…</p>;
  if (loadError && !run) {
    return <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{loadError}</p>;
  }
  if (!run || run.status === 0) return <p className="text-neutral-400">This run does not exist.</p>;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-400">Run #{runId}</span>
            <h1 className="mt-2 text-4xl font-black">{run.seriesAsset} · {Number(run.intervalSec) / 60} minute</h1>
            <p className="mt-2 text-neutral-400">{statusName[run.status]} · round {run.roundCount}/{run.maxRounds}</p>
            {run.status === 1 && (
              <>
                <p className="mt-2 text-sm text-neutral-400">
                  Registration lasts one {formatDuration(run.intervalSec)} {run.seriesAsset} window.
                </p>
                <p className="mt-1 font-mono text-sm text-orange-300">
                  {registrationCountdown(registrationTime, run.seriesAsset)}
                </p>
              </>
            )}
            {marketExpiry !== null && (
              <p className="mt-2 font-mono text-sm text-orange-300">
                {marketExpiry > BigInt(now)
                  ? `Locks in ${formatCountdown(Number(marketExpiry - BigInt(now)))}`
                  : 'Market locked — awaiting oracle resolution'}
              </p>
            )}
          </div>
          <div className="rounded-2xl bg-black/40 px-5 py-3 text-center">
            <div className="text-3xl font-black text-orange-400">{run.survivorCount}</div>
            <div className="text-xs uppercase tracking-widest text-neutral-500">standing</div>
          </div>
        </div>
        {commentary && <blockquote className="mt-6 border-l-2 border-orange-500 pl-4 italic text-neutral-300">“{commentary}”</blockquote>}
      </section>

      {run.status === 1 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-xl font-bold">Enter the bracket</h2>
          <p className="mt-1 text-sm text-neutral-400">Entry: {formatUnits(run.entryStake, 6)} tUSDC. Testnet only.</p>
          <p className="mt-2 font-mono text-sm text-orange-300">
            {registrationCountdown(registrationTime, run.seriesAsset)}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={faucet} disabled={!!busy} className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500">Get test tUSDC</button>
            <button onClick={register} disabled={!!busy} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-black hover:bg-orange-400">Approve & enter</button>
          </div>
        </section>
      )}

      {run.status === 2 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          {!address ? (
            <>
              <h2 className="text-xl font-bold">Your position</h2>
              <p className="mt-1 text-sm text-neutral-400">Connect your wallet to view or make your call for this round.</p>
            </>
          ) : !isStanding ? (
            <>
              <h2 className="text-xl font-bold">Spectating this round</h2>
              <p className="mt-1 text-sm text-neutral-400">Only players still standing can make a qualifying call.</p>
            </>
          ) : !currentPosition && positionLoading ? (
            <>
              <h2 className="text-xl font-bold">Your position</h2>
              <p className="mt-1 text-sm text-neutral-400">Loading your UP and DOWN balances…</p>
            </>
          ) : (
            <>
              {(hasQualifyingCall || hasPartialPosition) && currentPosition && (
                <div className={hasQualifyingCall ? 'rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4' : 'rounded-xl border border-amber-500/30 bg-amber-500/5 p-4'}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold">Your position</h2>
                      <p className={`mt-1 text-sm ${hasQualifyingCall ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {hasQualifyingCall
                          ? `Your call is active for round ${run.roundCount + 1}.`
                          : `Your filled position is below the ${formatUnits(run.minPosition, currentPosition.decimals)} contract minimum.`}
                      </p>
                    </div>
                    {hasQualifyingCall && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase text-emerald-300">Call confirmed</span>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {currentPosition.up > 0n && <PositionAmount side="UP" amount={currentPosition.up} decimals={currentPosition.decimals} />}
                    {currentPosition.down > 0n && <PositionAmount side="DOWN" amount={currentPosition.down} decimals={currentPosition.decimals} />}
                  </div>
                </div>
              )}

              {!hasQualifyingCall && (
                <div className={hasPartialPosition ? 'mt-5' : ''}>
                  <h2 className="text-xl font-bold">Make your call</h2>
                  <p className="mt-1 text-sm text-neutral-400">IOC order on dreamDEX. Hold at least {formatUnits(run.minPosition, currentPosition?.decimals ?? marketDecimals ?? 6)} winning contracts at resolution.</p>
                  {positionError && <p className="mt-2 text-sm text-amber-300">Could not verify your current position. {positionError}</p>}
                  <label className="mt-4 block max-w-48 text-sm text-neutral-400">
                    Contracts
                    <input value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" inputMode="decimal" />
                  </label>
                  <div className="mt-4 grid max-w-lg grid-cols-2 gap-3">
                    <button onClick={() => trade('up')} disabled={!!busy || !quantityMeetsMinimum} className="rounded-xl bg-emerald-500 px-5 py-3 font-black text-black hover:bg-emerald-400 disabled:opacity-40">UP</button>
                    <button onClick={() => trade('down')} disabled={!!busy || !quantityMeetsMinimum} className="rounded-xl bg-rose-500 px-5 py-3 font-black text-black hover:bg-rose-400 disabled:opacity-40">DOWN</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {run.status === 4 && address && (
        <button onClick={claim} disabled={!!busy} className="rounded-xl bg-orange-500 px-5 py-3 font-black text-black">Claim prize</button>
      )}

      <section>
        <h2 className="mb-3 text-xl font-bold">Field</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {players.map((player) => {
            const standing = aliveSet.has(player.toLowerCase());
            return (
              <div key={player} className={`flex items-center justify-between rounded-xl border p-3 ${standing ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-neutral-800 bg-neutral-900/40 opacity-55'}`}>
                <span className="font-mono text-sm">{player.slice(0, 8)}…{player.slice(-6)}</span>
                <span className={`text-xs font-bold uppercase ${standing ? 'text-emerald-400' : 'text-neutral-500'}`}>{standing ? 'Standing' : 'Out'}</span>
              </div>
            );
          })}
          {players.length === 0 && <p className="text-sm text-neutral-500">No players yet.</p>}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-bold">Round feed</h2>
        <RoundFeed runId={runId} />
      </section>
      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}

function SetupNotice() {
  return <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">Set NEXT_PUBLIC_GAME_ADDRESS to connect this frontend to the deployment.</p>;
}

function PositionAmount({ side, amount, decimals }: { side: 'UP' | 'DOWN'; amount: bigint; decimals: number }) {
  const up = side === 'UP';
  return (
    <div className={`min-w-32 rounded-lg border px-4 py-3 ${up ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
      <div className={`text-xs font-black uppercase ${up ? 'text-emerald-300' : 'text-rose-300'}`}>{side}</div>
      <div className="mt-1 text-lg font-bold">{formatUnits(amount, decimals)}</div>
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: bigint) {
  const minutes = Number(seconds) / 60;
  return `${minutes}-minute`;
}

function registrationCountdown(remaining: number | null, asset: string) {
  if (remaining === null) return `Waiting for the next ${asset} market`;
  if (remaining <= 0) return 'Starting round 1…';
  return `Round 1 starts in ${formatCountdown(remaining)}`;
}
