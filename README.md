# Last One Standing

A scheduled elimination bracket built on dreamDEX Event Contracts and Somnia. Players enter a run, take a real Up or Down position every round, and are eliminated automatically when the market resolves.

## Rules

- A correct position must meet the run's `minPosition`.
- Wrong, absent, or undersized positions are eliminated.
- Voids are pushes and do not consume a round.
- A run finalizes at `targetSurvivors` or `maxRounds`; remaining players split equally.
- If a round wipes out everybody, the players alive at that round's start split the pool.

## Stack

- `src/LastOneStanding.sol`: escrow, registry, Somnia Reactivity handler, equal-split claims, Agents commentary callback
- `companion/`: discovers successor dreamDEX windows and publishes `RoundResult` records
- `app/` + `components/`: Next.js player/spectator interface
- `test/`: Foundry unit tests

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design, trust
boundaries, run state machine, settlement flow, and companion architecture.

For hosted deployment, use Vercel for the Next.js frontend and Railway for the
always-on companion worker. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the
environment split, platform setup, secret handling, and smoke-test runbook.
With the current Shannon values in `.env` and both CLIs authenticated, deploy them
together with `npm run deploy`.

## Local setup

Requires Node 20+, Foundry, and a Somnia Shannon testnet wallet.

```bash
npm install --legacy-peer-deps
cp .env.example .env
forge test
npm run typecheck
npm run dev
```

The explicit npm peer override is currently necessary: `@somnia-chain/streams@0.12.2` expects Reactivity 0.1.x while markets-sdk 0.28.x declares Reactivity 0.2.x as an optional peer. The companion uses only the 0.1.x API shared with Streams.

## Guided demo

Open `/demo` to watch a complete sample run without connecting a wallet. The deterministic local simulation covers registration, timed Up/Down rounds, automatic eliminations, a voided market, commentary, and the final payout. Pause or replay it at any time; it does not use RPC calls, transactions, or testnet funds.

## Deploy to Shannon (chain 50312)

1. Fund the deployer and armorer with STT. The game must receive at least **33 STT** at deployment: 32 STT is the Reactivity subscription-owner floor and the remainder pays callbacks.
1. Set `PRIVATE_KEY`, `RPC_URL`, and `ARMORER_ADDRESS`.
1. Deploy:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

1. Put the deployed address in `GAME_ADDRESS` and `NEXT_PUBLIC_GAME_ADDRESS`.
1. Register the Data Streams schemas:

```bash
npm run register-schemas
```

1. Copy the printed schema and publisher values into both server and `NEXT_PUBLIC_` variables.
1. Start the companion and app:

```bash
npm run companion
npm run dev
```

## Starting a run

`createRun` is owner-only. Values are raw token units: Shannon tUSDC and its dreamDEX outcome positions use 6 decimals.

After registration, the owner or armorer calls `startRun(runId, marketId)` with a live Trading market for the configured venue. From then on:

1. The contract subscribes to the per-market `StatusChanged(uint8,uint8)` event.
2. A Resolved transition checks every survivor's ERC-6909 winning-token balance.
3. A Voided transition carries everyone forward.
4. The companion watches `MarketCreated` and calls `armForRound` for matching `(asset, interval, venue)` successors.

The contract supports at most 32 players per run. This intentionally bounds the reactive handler's loop and cold storage writes.

## Important addresses

- BinaryMarketsModule: `0x3ecC694Cef705358864a646142ac17A90E29e388`
- OutcomeToken6909: `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9`
- Shannon tUSDC: `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`
- Shannon Agents platform: `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`

Never key state by a dreamDEX pool address; pools are recycled. This project keys every round by `marketId`.

## License & disclaimer

Licensed under the [MIT License](LICENSE) (© DreamDEX S.A.).

Please read the [**Legal Disclaimer**](DISCLAIMER.md) before using anything here. In short: this is
educational reference code — **not financial advice, and not audited.** Any strategy can lose funds.
You are responsible for the keys you load, the parameters you set, and the orders you sign. Test on
testnet first.
