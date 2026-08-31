import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { ConnectWalletButton } from '../components/ConnectWalletButton';
import { WalletProvider } from '../components/WalletProvider';
import { getWagmiConfig } from '../lib/wagmi';
import './globals.css';

export const metadata: Metadata = {
  title: 'Last One Standing',
  description: 'A live elimination bracket on dreamDEX Event Contracts.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const initialState = cookieToInitialState(
    getWagmiConfig(),
    (await headers()).get('cookie'),
  );

  return (
    <html lang="en">
      <body>
        <WalletProvider initialState={initialState}>
          <header className="sticky top-0 z-10 border-b border-white/5 bg-black/70 backdrop-blur-xl">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
              <nav className="flex items-center gap-6">
                <a href="/" className="font-black tracking-tight"><span className="text-orange-500">LAST</span> ONE STANDING</a>
                <a href="/demo" className="hidden text-sm text-orange-400 hover:text-orange-300 sm:block">Demo</a>
                <a href="/runs" className="hidden text-sm text-neutral-400 hover:text-white sm:block">Runs</a>
                <a href="/owner" className="hidden text-sm text-neutral-400 hover:text-white sm:block">Owner</a>
              </nav>
              <ConnectWalletButton />
            </div>
          </header>
          <main className="mx-auto min-h-[calc(100vh-140px)] max-w-6xl px-5 py-10">{children}</main>
          <footer className="border-t border-neutral-900 px-5 py-7 text-center text-xs text-neutral-600">Built on Somnia · Positions trade on dreamDEX</footer>
        </WalletProvider>
      </body>
    </html>
  );
}
