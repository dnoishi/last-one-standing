# Last One Standing — Deep Dive Build Plan
### A scheduled elimination-bracket prediction game on dreamDEX Event Contracts

> **A note on the links in this doc.** Somnia links (`docs.somnia.network`) were fetched and confirmed directly. dreamDEX links (`docs.dreamdex.io`) are built from the confirmed root domain plus the exact relative paths the dreamDEX docs use to cross-reference each other internally (e.g. `/developers/event-contracts/gotchas.md`) — the docs site itself blocks automated fetching, so these paths weren't individually re-verified. If any link 404s, the docs' own search or the `/developers/event-contracts` hub page will get you there.

---

## 1. Recap: the pitch

A cohort of players enters a run. Each round is one live [dreamDEX Event Contracts](https://docs.dreamdex.io/developers/event-contracts) window (e.g. BTC 15-minute Up/Down). Every survivor must hold a real, correctly-called position when that window resolves — call it wrong (or don't call at all) and you're out. Last player(s) standing split a prize pool. It's a bracket, not a leaderboard: scheduled, appointment-viewing, over in a fixed number of rounds — the opposite engagement shape from an always-on stats page.

The engineering core of this one is different from Streaks: instead of continuously tracking state, **everything has to happen automatically, exactly at each window's resolution, with no human running the bracket** — that's what makes it a good showcase for [Somnia's on-chain Reactivity](https://docs.somnia.network/developer/reactivity) rather than just another Data Streams exercise.

---

## 2. Format & rules (V1 default — tune freely)

- **Entry:** players register into a run before it starts. A run is bound to one Event Contracts series (e.g. `WBTC:USDso` 15-minute windows) and a target survivor count (e.g. "last 1 standing" or "last 3 split the pool").
- **Each round = one live window.** Players must hold a position on the correct side (Up or Down) by the window's `Locked` transition. Docs reference: [Market Structure & Lifecycle](https://docs.dreamdex.io/developers/event-contracts/market-structure) — the `Listed → Trading → Locked → Resolved | Voided` state machine is the actual clock the whole bracket runs on.
- **Wrong call, or no call at all, eliminates you.** A voided round is a push for everyone still in — see [Settlement & Voids](https://prd.oracle.somnia.host/explore) behavior below (§7).
- **Minimum stake per round** (small, e.g. 5 USDso worth of contracts) — enough to prove a real position was taken, not so much that it becomes the actual game. This reuses the anti-farming guardrail from the Streaks project's edge-case list.
- **Run ends** when the survivor count hits the target, or after a fixed max-round cap (so a run can't theoretically never end if everyone keeps calling correctly).

---

## 3. Architecture overview

```
                dreamDEX Event Contracts series (one venue, rolling windows)
                    (Trading → Locked → Resolved | Voided per window)
                                    │
                                    │ market resolution event
                                    ▼
                ┌─────────────────────────────────────────┐
                │      LastOneStanding.sol (on-chain)      │
                │  owns an on-chain Reactivity subscription │
                │  to the tracked market's resolution event │
                └───────────────────┬───────────────────────┘
                                    │ handler runs atomically, same block
                                    ▼
        reads each active player's outcome-token balance for the winning side
        (OutcomeToken6909, same balance check as Streaks §5.1)
                                    │
                ┌───────────────────┴───────────────────────┐
                ▼                                             ▼
     survivors carry into next round                eliminated players marked out
     (subscription re-arms for next window)          `PlayerEliminated` event emitted
                                    │
                                    ▼
                when survivorCount == targetSurvivors:
                finalize run, publish Merkle root, open claims
                                    │
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │  Data Streams: RoundResult records (spectator feed) │
        │  + optional Agents LLM commentary per round          │
        └───────────────────────────────────────────────────┘
```

Everything that has to be trustworthy and on-time (elimination, run-ending, prize finalization) lives on-chain, driven by Reactivity. Everything that's for humans to watch (bracket visualization, commentary) is a thin off-chain layer reading public state.

---

## 4. Entry & registration

A small `Run` struct tracks: `marketSeriesId` (which asset/window length), `targetSurvivors`, `entryStake`, `players[]`, `eliminated mapping`, `roundCount`, `currentTrackedMarketId`.

Registration is a simple deposit into the run's escrow (reusing the pull-based-claim pattern from the Streaks monetization deep dive's `SeasonVault`, rather than re-deriving it here). Reference for the underlying trading mechanics players will actually use to take each round's position: [`POST /v0/markets/{symbol}/orders`](https://docs.dreamdex.io/developers/http-api/trading) for the HTTP path, or `placeOrder`/`placeOrderFor` directly per [Contracts — Functions](https://docs.dreamdex.io/developers/contracts/functions) for a wallet integrating at the contract level.

**A note on what "the call" actually is:** this design deliberately requires a *real* Up/Down position on dreamDEX for each round, not a separate off-chain vote. That's what makes it a dreamDEX Event Contracts demo rather than a generic prediction game bolted on top — every round of Last One Standing is real trading volume on the actual order book, matched the same way any other order is: see [Market Structure & Lifecycle](https://docs.dreamdex.io/developers/event-contracts/market-structure) for the order book / mint-a-pair mechanics behind it.

---

## 5. Round mechanics, tied precisely to the Event Contracts lifecycle

Each round needs the bracket to know three timestamps, all of which come directly off the tracked market's on-chain record (per [Market Structure & Lifecycle](https://docs.dreamdex.io/developers/event-contracts/market-structure)):

| Lifecycle state | What it means for the bracket |
|---|---|
| **Trading** | Registration window for this round is open — active survivors must place their position before it ends. |
| **Locked** | Cutoff. No more entries for this round. This is also the moment to snapshot "who has a position" if you want to give a UI grace period before elimination is computed at resolution. |
| **Resolved** | The round's outcome is fixed. This is the trigger for the elimination handler (§6). |
| **Voided** | No reliable settlement price — the round doesn't count. See §7. |

Per the docs: *["Nobody has to [trigger resolution] — the chain does. Each market's settlement question is scheduled on the oracle hub at creation... Somnia's on-chain reactivity delivers that event straight to the hub's callback."](https://docs.dreamdex.io/developers/event-contracts/market-structure)* Last One Standing's elimination handler piggybacks on exactly that same guarantee — it doesn't need its own timer or keeper, it subscribes to the *result* of dreamDEX's own reactive settlement.

**Rolling to the next round:** dreamDEX's windows expire on a schedule and the venue opens a successor automatically. Per the [Recipes](https://docs.dreamdex.io/developers/event-contracts/recipes) guidance, key state by `marketId` or symbol, never by pool address, and re-resolve the live window for the series each cycle rather than caching it — the run contract needs to re-derive "which market is the current round" every time it re-arms its subscription, exactly the pattern the docs warn is easy to get wrong.

---

## 6. The elimination handler — the core Reactivity contract

This is the piece that makes the bracket run itself. It's the same primitive Settlement Pulse (the auto-redeem project) uses, applied to elimination instead of redemption.

### 6.1 Subscribing to the round's resolution

Two workable designs, in increasing order of directness:

**A. Subscribe to the tracked market's own resolution-related event**, filtered on that specific `marketId`, using the general on-chain Reactivity subscription mechanism described in the [on-chain Reactivity reference](https://docs.somnia.network/developer/reactivity) and demonstrated end-to-end in the [Solidity on-chain Reactivity tutorial](https://docs.somnia.network/developer/reactivity/tutorials/solidity-on-chain-reactivity-tutorial). Filter fields (`emitter`, `eventTopics`) target the `BinaryMarketsModule` and the specific market's resolution topic — a direct application of the [Contracts — Events](https://docs.dreamdex.io/developers/contracts/events) reference for identifying the right topic0/selector.

**B. Schedule a one-shot timestamp check instead**, using `scheduleSubscriptionAtTimestamp` a few seconds after the window's known settlement-window close, and have the handler read the market's on-chain status directly rather than reacting to a specific log. This is simpler to reason about (no dependency on exact event shape) at the cost of a small, deliberate delay. The [Cron subscriptions via SDK tutorial](https://docs.somnia.network/somnia-data-streams/getting-started/sdk-methods-guide) — despite living under the Data Streams docs tree — walks through exactly this `scheduleSubscriptionAtTimestamp` pattern from TypeScript, useful if the run owner is an EOA/service rather than a contract.

**Recommendation: A for production, B for the fastest working demo.** Design A is the "real" reactive pattern (zero added latency, no polling of any kind); design B is a good fallback if the exact resolution event topic proves fiddly to filter on during a hackathon timeline.

### 6.2 Handler logic (contract-owned subscription, pattern A)

```solidity
pragma solidity 0.8.30;

import { SomniaEventHandler } from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import { SomniaExtensions } from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/// @notice Owns a Reactivity subscription to the tracked market's resolution
///         event and eliminates players who didn't hold the winning side.
contract LastOneStanding is SomniaEventHandler {
    // ... Run struct, players[], eliminated mapping, etc. (see §4) ...

    uint256 public subscriptionId;
    bytes32 public trackedMarketId;

    /// @dev Called by the run owner (or automatically at run creation) once
    ///      the next round's market is known. Re-arms the subscription for
    ///      the new marketId — see §5's note on never caching a pool address.
    function _armForRound(bytes32 marketId, address binaryMarketsModule) internal {
        trackedMarketId = marketId;

        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [
                MARKET_RESOLVED_TOPIC0,      // BinaryMarketsModule resolution topic
                bytes32(marketId),           // this specific market only
                bytes32(0),
                bytes32(0)
            ],
            origin: address(0),
            emitter: binaryMarketsModule
        });

        SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: 1,
            maxFeePerGas: 0,
            gasLimit: 5_000_000 // bounded by active player count — see §6.3
        });

        subscriptionId = SomniaExtensions.subscribe(address(this), filter, options);
    }

    /// @dev Fired by the Reactivity precompile when the tracked market resolves.
    function _onEvent(address emitter, bytes32[] memory eventTopics, bytes memory data) internal override {
        (uint8 winningSide, bool voided) = _decodeResolution(data);

        if (voided) {
            emit RoundVoided(trackedMarketId);
            // no eliminations — advance to next round unchanged
        } else {
            for (uint256 i = 0; i < activePlayers.length; i++) {
                address player = activePlayers[i];
                uint256 winningBalance = IOutcomeToken6909(outcomeTokenAddr)
                    .balanceOf(player, _outcomeId(trackedMarketId, winningSide));
                if (winningBalance == 0) {
                    _eliminate(player);
                }
            }
        }

        if (_survivorCount() <= targetSurvivors) {
            _finalizeRun();
        } else {
            _armForRound(_resolveNextMarketId(), binaryMarketsModuleAddr);
        }
    }
}
```

The winning-side balance check is the same technique used in the Streaks project's detector (checking `OutcomeToken6909` balance rather than trying to net every fill leg by hand) — worth building the two projects to share that helper if both are in scope, since `Last One Standing` is essentially Streaks' elimination-mode sibling.

### 6.3 The gas-bound cohort size

The handler loop's cost scales with active player count. The precompile's [system reference](https://docs.somnia.network/developer/reactivity) caps a subscription's handler at a fixed maximum gas limit, and the handler runs entirely within that budget — if the loop exceeds it, the reactive transaction reverts and the subscription owner pays for the failed attempt regardless. Concretely: cap `Run.maxPlayers` to a number comfortably inside that budget (a few hundred is safe; test the actual per-player gas cost of a `balanceOf` read and back-calculate the cap rather than guessing). This is a real design constraint worth stating explicitly in any docs or README that comes out of this project — it's the kind of thing that works fine in a 20-person hackathon demo and silently reverts at 2,000 players.

### 6.4 Funding the subscription

Per the [on-chain Reactivity reference](https://docs.somnia.network/developer/reactivity), a subscription owner must hold a minimum SOMI balance at the moment of subscribing, and the reactive transaction pays normal gas out of that owner's balance on every firing. For a contract-owned subscription (as above), the `LastOneStanding` contract itself needs to be funded at deploy time and topped up as rounds burn gas — budget for `roundCount × (per-round handler gas cost)` up front, or add a top-up path callable by the run owner.

---

## 7. Voided rounds — a push, not an elimination

Per [Settlement & Voids](https://prd.oracle.somnia.host/explore) (auditable per-market on the [oracle explorer](https://prd.oracle.somnia.host/explore) — every market's `oracleQuestionId` deep-links straight to its own resolution pipeline at `https://prd.oracle.somnia.host/questions/{oracleQuestionId}?view=graph`), a market voids — rather than settling on bad data — when no reliable settlement price is found inside the settlement window, and **both sides redeem at 0.5 USDso per contract**. Treat a voided round in Last One Standing exactly like the Streaks project treats it: **no eliminations that round**, survivors carry forward unchanged, and the bracket simply re-arms for the next window. This is the same design rationale as Streaks §9 — a void is a refund, not a loss, and the game should never punish players for something that wasn't a real call.

---

## 8. Prize settlement

Reuses the `SeasonVault` Merkle-claim pattern from the Streaks monetization deep dive, rather than re-deriving a new payout mechanism:

1. `_finalizeRun()` (§6.2) fires once `survivorCount <= targetSurvivors`.
2. Off-chain (or in a final handler step), compute the payout split among the remaining survivors and publish a Merkle root of `(address, amount)` pairs.
3. Survivors claim via a pull-based `claim(runId, amount, proof)` — same shape as `SeasonVault.claim`, just keyed by `runId` instead of `seasonId`.

This keeps the actual money-movement code identical across both projects, which is a good argument for building it once as a shared library if both ship.

---

## 9. Spectator layer — Data Streams + optional commentary

Last One Standing is explicitly an *appointment-viewing* format (§1) — the spectator experience matters more here than in Streaks' always-on leaderboard.

**`RoundResult` schema**, published via [`setAndEmitEvents`](https://docs.somnia.network/somnia-data-streams/getting-started/sdk-methods-guide) so a live "who just got eliminated" toast can be driven by an off-chain subscription rather than polling:

```typescript
// Following the schema-design conventions from the Data Streams SDK Methods Guide
// https://docs.somnia.network/somnia-data-streams/getting-started/sdk-methods-guide
export const roundResultSchema =
  'uint64 timestamp, uint32 runId, uint32 roundNumber, bytes32 marketId, ' +
  'uint8 winningSide, bool voided, uint32 eliminatedCount, uint32 survivorsRemaining';
```

Register once via `registerDataSchemas` per the [SDK Methods Guide](https://docs.somnia.network/somnia-data-streams/getting-started/sdk-methods-guide), publish one record per round from the handler's off-chain companion service (or directly from a small relayer watching the `PlayerEliminated`/`RoundVoided` events), and a bracket-visualization frontend reads it the same way the [Streams "Hello World" app](https://docs.somnia.network/somnia-data-streams/getting-started/hello-world-app) or the [chat-app tutorial](https://docs.somnia.network/somnia-data-streams/tutorials/build-a-minimal-on-chain-chat-app) demonstrate reading structured records back.

**Optional: LLM color commentary per round**, reusing the same flourish proposed for Spectator Mode — a single [`inferString`](https://docs.somnia.network/agents/base-agents/llm-inference) call per round, prompted with that round's `RoundResult` plus the surviving player count, producing a one-line broadcast-style summary ("Half the field just got wiped on a surprise Down move — 12 players left"). Since [Somnia Agents](https://docs.somnia.network/agents) run deterministically with on-chain consensus and a receipted execution trail, the commentary is itself auditable, not just decorative — see [Invoking Agents — Quickstart](https://docs.somnia.network/agents/invoking-agents/quickstart) for the request/callback shape, or [Invoking from Solidity](https://docs.somnia.network/agents/invoking-agents/from-solidity) if the commentary call is made directly from the `LastOneStanding` contract rather than an off-chain service.

---

## 10. Edge cases worth designing for up front

- **A player who never places a position for the round.** Treat identically to a wrong call — zero balance on either outcome id at resolution means eliminated. No special-case needed; the balance check in §6.2 already covers it.
- **Indexer lag vs. on-chain truth.** Per the [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas) doc: *"The indexer lags by seconds. Before every write, read the market's on-chain state."* Any off-chain service that needs to know the current round's status (e.g. the frontend showing a countdown) should read on-chain state directly for anything gating an action, and only use the indexer for historical/display data — the elimination handler itself never touches the indexer at all, since it reacts to the on-chain event directly.
- **Order expiry.** Per [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas), every order requires an explicit `expireTimestampNs`, no later than the market's own expiry — worth surfacing to players in the entry UI so a resting order doesn't silently miss the round's lock.
- **Lot size / price precision on order placement.** Also from [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas) — relevant if `LastOneStanding` or its companion UI constructs orders programmatically on a player's behalf (e.g. a "one-click enter this round" button) rather than deep-linking to dreamDEX's own order form.
- **Venue scoping.** A deployment can host more than one venue; per [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas), filter by venue id everywhere the run contract resolves "the next market in this series," or a run could silently pick up a market from the wrong venue.
- **Settled markets dropping out of `loadMarkets()`.** Per [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas), a finalized binary market doesn't show up in the default active-market sweep — irrelevant to the on-chain handler (which reacts to the resolution event directly and never calls `loadMarkets()`), but relevant to any off-chain reporting/history view built on top, which should query the binary tier's `Finalized` status filter instead.
- **Ties for the last surviving spot.** If `targetSurvivors` is reached mid-round with more players tied than slots (e.g. target is 1 but 3 players are simultaneously eliminated down from 4), decide up front whether it's sudden-death (one more round among the tied survivors) or an even split — document the choice in the run's public rules before it starts, since it's exactly the kind of ambiguity a spectator audience will call out live.

---

## 11. Build phases

**Phase 0 — Plumbing (S)**
- Deploy a minimal `LastOneStanding` skeleton on testnet, hardcoded to one market series.
- Get the on-chain Reactivity subscription (§6.1, design B — the scheduled-timestamp fallback) firing reliably and reading a single test player's outcome-token balance correctly.

**Phase 1 — MVP (M)**
- Full player registry, elimination loop, round-advance logic (§6.2).
- Manual testnet run with a handful of team-member wallets, watching eliminations happen live.
- Switch to design A (direct resolution-event subscription) once the topic filtering is confirmed working.

**Phase 2 — Prize settlement (M)**
- `SeasonVault`-style Merkle claim contract, wired to `_finalizeRun()`.
- Entry-fee deposit flow for players.

**Phase 3 — Spectator layer (M)**
- `RoundResult` Data Streams publishing + a bracket-visualization frontend.
- Optional LLM commentary via Agents' `inferString`.

**Phase 4 — Polish for a live event (S/M)**
- Rules page, tie-handling copy, a countdown/registration UI with clear cutoffs tied to each round's `Trading → Locked` transition.
- Dry-run a full bracket on testnet end-to-end before running it live with real entry stakes.

---

## 12. Doc reference appendix

**dreamDEX**
- [Event Contracts hub](https://docs.dreamdex.io/developers/event-contracts)
- [Market Structure & Lifecycle](https://docs.dreamdex.io/developers/event-contracts/market-structure)
- [Recipes](https://docs.dreamdex.io/developers/event-contracts/recipes)
- [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas)
- [Contracts & Addresses](https://docs.dreamdex.io/developers/event-contracts/contracts-and-addresses)
- [Contracts — Events](https://docs.dreamdex.io/developers/contracts/events)
- [Contracts — Functions](https://docs.dreamdex.io/developers/contracts/functions)
- [HTTP API — Trading](https://docs.dreamdex.io/developers/http-api/trading)
- [HTTP API — Vault](https://docs.dreamdex.io/developers/http-api/vault)
- [HTTP API — Builder Fees](https://docs.dreamdex.io/developers/http-api/builder-fees)
- [Oracle explorer](https://prd.oracle.somnia.host/explore) (settlement audit trail, per-market via `/questions/{oracleQuestionId}?view=graph`)
- [`@somnia-chain/markets-sdk` on npm](https://www.npmjs.com/package/@somnia-chain/markets-sdk)

**Somnia**
- [On-chain Reactivity — reference](https://docs.somnia.network/developer/reactivity)
- [On-chain Reactivity — concept](https://docs.somnia.network/concepts/somnia-blockchain/on-chain-reactivity)
- [Solidity on-chain Reactivity tutorial](https://docs.somnia.network/developer/reactivity/tutorials/solidity-on-chain-reactivity-tutorial)
- [Subscription management](https://docs.somnia.network/developer/reactivity/tooling/subscription-management)
- [Data Streams overview](https://docs.somnia.network/somnia-data-streams)
- [Data Streams introduction](https://docs.somnia.network/somnia-data-streams/basics/editor/introduction-to-somnia-data-streams)
- [Data Streams quickstart](https://docs.somnia.network/somnia-data-streams/getting-started/quickstart)
- [Data Streams SDK Methods Guide](https://docs.somnia.network/somnia-data-streams/getting-started/sdk-methods-guide)
- [Data Streams "Hello World" app](https://docs.somnia.network/somnia-data-streams/getting-started/hello-world-app)
- [Data Streams chat-app tutorial](https://docs.somnia.network/somnia-data-streams/tutorials/build-a-minimal-on-chain-chat-app)
- [Agents overview](https://docs.somnia.network/agents)
- [Agents — LLM Inference](https://docs.somnia.network/agents/base-agents/llm-inference)
- [Agents — Invoking Quickstart](https://docs.somnia.network/agents/invoking-agents/quickstart)
- [Agents — Invoking from Solidity](https://docs.somnia.network/agents/invoking-agents/from-solidity)
- [`@somnia-chain/reactivity` on npm](https://www.npmjs.com/package/@somnia-chain/reactivity)
- [`@somnia-chain/reactivity-contracts` on npm](https://www.npmjs.com/package/@somnia-chain/reactivity-contracts)
- [`@somnia-chain/streams` on npm](https://www.npmjs.com/package/@somnia-chain/streams)