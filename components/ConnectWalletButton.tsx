'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { chain } from '../lib/config';

export function ConnectWalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect, isPending: isDisconnecting } = useDisconnect();
  const { switchChain, error: switchError, isPending: isSwitching } = useSwitchChain();
  const wrongChain = isConnected && chainId !== chain.id;
  const error = connectError || switchError;

  return (
    <div className="flex flex-col items-end gap-1">
      {isConnected && address ? (
        <div className="flex items-center gap-2">
          {wrongChain && (
            <button
              className="rounded-full bg-yellow-400 px-3 py-1.5 text-sm font-semibold text-black hover:bg-yellow-300 disabled:opacity-50"
              onClick={() => switchChain({ chainId: chain.id })}
              disabled={isSwitching}
            >
              {isSwitching ? 'Switching…' : 'Switch to Shannon'}
            </button>
          )}
          <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 font-mono text-sm text-orange-200">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          <button
            className="text-sm text-zinc-400 hover:text-white disabled:opacity-50"
            onClick={() => disconnect()}
            disabled={isDisconnecting}
          >
            {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <button
          className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-50"
          onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          disabled={isConnecting || connectors.length === 0}
        >
          {isConnecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
      {connectors.length === 0 && !isConnected && (
        <span className="text-xs text-red-400">Install an injected wallet such as MetaMask.</span>
      )}
      {error && <span className="max-w-64 text-right text-xs text-red-400">{error.message}</span>}
    </div>
  );
}
