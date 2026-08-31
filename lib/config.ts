import 'dotenv/config';
import { SOMNIA_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { somniaShannon } from '@somnia-chain/markets-sdk/chains';
import { getAddress, isHex } from 'viem';
import type { Address, Hex } from 'viem';

export const chain = somniaShannon;
export const addresses = SOMNIA_TESTNET_ADDRESSES;
export const indexerUrl = process.env.INDEXER_URL || 'https://dev.smk.somnia.host/v1/graphql';
export const binaryModule = addresses.binaryModule as Address;
export const collateralAddress = '0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E' as Address;

function optionalAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}

function optionalHex(value: string | undefined): Hex | undefined {
  return value && isHex(value) ? value : undefined;
}

export const publicConfig = {
  gameAddress: optionalAddress(process.env.NEXT_PUBLIC_GAME_ADDRESS),
  schemaId: optionalHex(process.env.NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID),
  publisherAddress: optionalAddress(process.env.NEXT_PUBLIC_PUBLISHER_ADDRESS),
  indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL || indexerUrl,
  chain,
  addresses,
  binaryModule,
  collateralAddress,
};

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
