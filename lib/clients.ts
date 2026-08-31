import { SomniaMarkets } from '@somnia-chain/markets-sdk';
import { SDK as StreamsSDK } from '@somnia-chain/streams';
import { createPublicClient, http } from 'viem';
import { publicConfig } from './config';

export const publicClient = createPublicClient({
  chain: publicConfig.chain,
  transport: http(publicConfig.chain.rpcUrls.default.http[0]),
});

export function readOnlyExchange() {
  return new SomniaMarkets({
    indexerUrl: publicConfig.indexerUrl,
    chain: publicConfig.chain,
    addresses: publicConfig.addresses,
  });
}

export function streamsReader() {
  return new StreamsSDK({ public: publicClient });
}

/** Somnia Data Streams reverts with NoData() when a publisher has not written any records yet. */
export function isStreamsNoDataError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NoData()');
}
