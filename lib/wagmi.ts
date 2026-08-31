import { cookieStorage, createConfig, createStorage, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { somniaShannon } from '@somnia-chain/markets-sdk/chains';

export function getWagmiConfig() {
  return createConfig({
    chains: [somniaShannon],
    connectors: [injected()],
    multiInjectedProviderDiscovery: false,
    transports: {
      [somniaShannon.id]: http(somniaShannon.rpcUrls.default.http[0]),
    },
    ssr: true,
    storage: createStorage({
      storage: cookieStorage,
    }),
  });
}
