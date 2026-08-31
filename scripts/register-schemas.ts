import { SDK, zeroBytes32 } from '@somnia-chain/streams';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, required } from '../lib/config';
import { roundResultSchema } from '../lib/schema';

async function main() {
  const account = privateKeyToAccount(required('ARMORER_PRIVATE_KEY') as Hex);
  const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
  const wallet = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
  const streams = new SDK({ public: publicClient, wallet });

  const schemaTx = await streams.registerDataSchemas([{
    schemaName: 'last_one_standing_round_result',
    schema: roundResultSchema,
    parentSchemaId: zeroBytes32 as Hex,
  }], true);
  if (schemaTx instanceof Error) throw schemaTx;
  await publicClient.waitForTransactionReceipt({ hash: schemaTx });

  const eventTx = await streams.registerEventSchemas([{
    id: 'LastOneStandingRoundResult',
    schema: {
      params: [{ name: 'runId', paramType: 'uint32', isIndexed: true }],
      eventTopic: 'LastOneStandingRoundResult(uint32 indexed runId)',
    },
  }]);
  if (eventTx instanceof Error) throw eventTx;
  await publicClient.waitForTransactionReceipt({ hash: eventTx });

  const schemaId = await streams.computeSchemaId(roundResultSchema);
  if (schemaId instanceof Error) throw schemaId;
  console.log(`ROUND_RESULT_SCHEMA_ID=${schemaId}`);
  console.log(`PUBLISHER_ADDRESS=${account.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
