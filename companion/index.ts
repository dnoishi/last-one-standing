import { SomniaMarkets, isBinaryMarket } from '@somnia-chain/markets-sdk';
import { SDK as ReactivitySDK } from '@somnia-chain/reactivity';
import { SchemaEncoder, SDK as StreamsSDK } from '@somnia-chain/streams';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  http,
  pad,
} from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { binaryModule, chain, indexerUrl, addresses, required } from '../lib/config';
import { gameAbi, marketCreatedEvent } from '../lib/contracts';
import { roundResultId, roundResultSchema, type RoundResult } from '../lib/schema';
import { firstRoundCandidate, matchingSeriesMarkets } from '../lib/schedule';

const gameAddress = required('GAME_ADDRESS') as Address;
const schemaId = required('ROUND_RESULT_SCHEMA_ID') as Hex;
const account = privateKeyToAccount(required('ARMORER_PRIVATE_KEY') as Hex);
const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
const wallet = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
const exchange = new SomniaMarkets({ indexerUrl, chain, addresses });
const reactivity = new ReactivitySDK({ public: exchange.client.getViemClient() });
const streams = new StreamsSDK({ public: publicClient, wallet });
const encoder = new SchemaEncoder(roundResultSchema);

const pending = new Map<string, RoundResult>();
const operatorRuns = new Set<number>();

function key(runId: number, round: number) {
  return `${runId}:${round}`;
}

async function publish(result: RoundResult) {
  const data = encoder.encodeData([
    { name: 'timestamp', type: 'uint64', value: result.timestamp },
    { name: 'runId', type: 'uint32', value: result.runId },
    { name: 'roundNumber', type: 'uint32', value: result.roundNumber },
    { name: 'marketId', type: 'bytes32', value: result.marketId },
    { name: 'winningSide', type: 'uint8', value: result.winningSide },
    { name: 'voided', type: 'bool', value: result.voided },
    { name: 'eliminatedCount', type: 'uint32', value: result.eliminatedCount },
    { name: 'survivorsRemaining', type: 'uint32', value: result.survivorsRemaining },
    { name: 'commentary', type: 'string', value: result.commentary },
  ]);
  const tx = await streams.setAndEmitEvents(
    [{ id: roundResultId(result.runId, result.marketId), schemaId, data }],
    [{
      id: 'LastOneStandingRoundResult',
      argumentTopics: [pad(`0x${result.runId.toString(16)}` as Hex, { size: 32 })],
      data: encodeAbiParameters([{ type: 'bytes32' }], [result.marketId]),
    }],
  );
  if (tx instanceof Error) throw tx;
  console.log(`[publisher] run=${result.runId} round=${result.roundNumber} tx=${tx}`);
}

async function discoverAndArm(runId: number, loadedMarkets?: Awaited<ReturnType<typeof exchange.loadMarkets>>) {
  const run = await publicClient.readContract({
    address: gameAddress, abi: gameAbi, functionName: 'getRun', args: [runId],
  });
  if (run.status !== 3) return;
  const source = loadedMarkets ?? await exchange.loadMarkets(true);
  const markets = matchingSeriesMarkets(Object.values(source), run)
    .filter((market) => market.active && isBinaryMarket(market.info))
    .filter(
      (market) => isBinaryMarket(market.info)
        && market.info.marketId.toLowerCase() !== run.trackedMarketId.toLowerCase(),
    )
    .sort((a, b) => {
      if (!isBinaryMarket(a.info) || !isBinaryMarket(b.info)) return 0;
      return Number(BigInt(a.info.expiry) - BigInt(b.info.expiry));
    });

  for (const candidate of markets) {
    if (!isBinaryMarket(candidate.info)) continue;
    const state = await exchange.client.getMarketOnchain(candidate.info.marketId);
    if (state.status !== 1) continue;
    const hash = await wallet.writeContract({
      address: gameAddress,
      abi: gameAbi,
      functionName: 'armForRound',
      args: [runId, candidate.info.marketId],
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[armorer] armed run ${runId} from live market scan`);
    return;
  }
  console.log(`[armorer] no live successor yet for run ${runId}`);
}

async function discoverAndStart(
  runId: number,
  loadedMarkets?: Awaited<ReturnType<typeof exchange.loadMarkets>>,
) {
  if (operatorRuns.has(runId)) return;
  operatorRuns.add(runId);
  try {
    const run = await publicClient.readContract({
      address: gameAddress, abi: gameAbi, functionName: 'getRun', args: [runId],
    });
    if (run.status !== 1 || run.survivorCount === 0) return;

    const source = loadedMarkets ?? await exchange.loadMarkets(true);
    const markets = matchingSeriesMarkets(Object.values(source), run);
    const candidate = firstRoundCandidate(
      markets,
      BigInt(Math.floor(Date.now() / 1000)),
    );
    if (!candidate || !isBinaryMarket(candidate.info)) return;

    const state = await exchange.client.getMarketOnchain(candidate.info.marketId);
    if (state.status !== 1) return;
    const hash = await wallet.writeContract({
      address: gameAddress,
      abi: gameAbi,
      functionName: 'startRun',
      args: [runId, candidate.info.marketId],
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[armorer] started run ${runId} for ${candidate.info.marketId}`);
  } finally {
    operatorRuns.delete(runId);
  }
}

async function watchGame() {
  publicClient.watchContractEvent({
    address: gameAddress,
    abi: gameAbi,
    eventName: 'RoundSettled',
    onLogs: (logs) => {
      for (const log of logs) {
        const a = log.args;
        if (a.runId === undefined || a.round === undefined || !a.marketId) continue;
        const result: RoundResult = {
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
          runId: Number(a.runId),
          roundNumber: Number(a.round),
          marketId: a.marketId,
          winningSide: Number(a.winningSide),
          voided: false,
          eliminatedCount: Number(a.eliminatedCount),
          survivorsRemaining: Number(a.survivorsRemaining),
          commentary: '',
        };
        pending.set(key(result.runId, result.roundNumber), result);
        void publish(result).catch(console.error);
        void discoverAndArm(result.runId).catch(console.error);
      }
    },
  });
  publicClient.watchContractEvent({
    address: gameAddress,
    abi: gameAbi,
    eventName: 'RoundVoided',
    onLogs: async (logs) => {
      for (const log of logs) {
        const a = log.args;
        if (a.runId === undefined || a.round === undefined || !a.marketId) continue;
        const run = await publicClient.readContract({
          address: gameAddress, abi: gameAbi, functionName: 'getRun', args: [a.runId],
        });
        void publish({
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
          runId: Number(a.runId),
          roundNumber: Number(a.round),
          marketId: a.marketId,
          winningSide: 0,
          voided: true,
          eliminatedCount: 0,
          survivorsRemaining: Number(run.survivorCount),
          commentary: 'Round voided — every survivor advances.',
        }).catch(console.error);
        void discoverAndArm(Number(a.runId)).catch(console.error);
      }
    },
  });
  publicClient.watchContractEvent({
    address: gameAddress,
    abi: gameAbi,
    eventName: 'CommentaryReady',
    onLogs: (logs) => {
      for (const log of logs) {
        const a = log.args;
        if (a.runId === undefined || a.round === undefined || a.text === undefined) continue;
        const result = pending.get(key(Number(a.runId), Number(a.round)));
        if (!result) continue;
        result.commentary = a.text;
        void publish(result).catch(console.error);
      }
    },
  });
}

async function tryAdvanceWithMarket(
  marketId: Hex,
  asset: string,
  intervalSec: bigint,
  venueId: Hex,
  tradingStart: bigint,
  expiry: bigint,
) {
  const next = await publicClient.readContract({
    address: gameAddress, abi: gameAbi, functionName: 'nextRunId',
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (let id = 1; id < Number(next); id++) {
    if (operatorRuns.has(id)) continue;
    const run = await publicClient.readContract({
      address: gameAddress, abi: gameAbi, functionName: 'getRun', args: [id],
    });
    if (
      (run.status !== 1 && run.status !== 3)
      || run.seriesAsset !== asset || run.intervalSec !== intervalSec
      || run.venueId.toLowerCase() !== venueId.toLowerCase()
    ) continue;
    if (
      run.status === 1
      && (
        run.survivorCount === 0
        || tradingStart > now
        || now >= expiry
        || now - tradingStart > 45n
      )
    ) continue;

    operatorRuns.add(id);
    try {
      const state = await exchange.client.getMarketOnchain(marketId);
      if (state.status !== 1) continue;
      const functionName = run.status === 1 ? 'startRun' : 'armForRound';
      const hash = await wallet.writeContract({
        address: gameAddress,
        abi: gameAbi,
        functionName,
        args: [id, marketId],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[armorer] ${run.status === 1 ? 'started' : 'armed'} run ${id} for ${marketId}`);
    } finally {
      operatorRuns.delete(id);
    }
  }
}

async function scanRuns() {
  const [next, markets] = await Promise.all([
    publicClient.readContract({
      address: gameAddress, abi: gameAbi, functionName: 'nextRunId',
    }),
    exchange.loadMarkets(true),
  ]);
  for (let runId = 1; runId < Number(next); runId++) {
    const run = await publicClient.readContract({
      address: gameAddress, abi: gameAbi, functionName: 'getRun', args: [runId],
    });
    if (run.status === 1) {
      await discoverAndStart(runId, markets);
    } else if (run.status === 3) {
      await discoverAndArm(runId, markets);
    }
  }
}

async function watchMarkets() {
  const result = await reactivity.subscribe({
    eventContractSources: [binaryModule],
    topicOverrides: [],
    ethCalls: [],
    onData: (notification: {
      result: { topics: Hex[]; data: Hex };
    }) => {
      try {
        const decoded = decodeEventLog({
          abi: [marketCreatedEvent],
          topics: notification.result.topics as [Hex, ...Hex[]],
          data: notification.result.data,
        });
        const a = decoded.args;
        const interval = a.expiry - a.tradingStart;
        void tryAdvanceWithMarket(
          a.marketId,
          a.asset,
          interval,
          a.venueId,
          a.tradingStart,
          a.expiry,
        ).catch(console.error);
      } catch {
        // The subscription is broad because topicOverrides differs across SDK versions.
      }
    },
    onError: console.error,
  });
  if (result instanceof Error) throw result;
  console.log('[armorer] watching MarketCreated');
}

async function main() {
  console.log(`[companion] ${account.address}`);
  await watchGame();
  await watchMarkets();
  await scanRuns();
  setInterval(() => void scanRuns().catch(console.error), 15_000);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
