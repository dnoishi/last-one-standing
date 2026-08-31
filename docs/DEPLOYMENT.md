# Vercel and Railway deployment

The production topology separates the browser application from the always-on operator:

- **Vercel** hosts the Next.js interface.
- **Railway** runs the companion as a background worker.
- **Somnia Shannon** hosts the game contract, dreamDEX markets, Reactivity subscriptions,
  and Data Streams records.

The companion is not suitable for a Vercel Function. It holds event subscriptions open,
signs transactions, and must continue running between requests.

## Prerequisites

- A Git repository available to both Vercel and Railway.
- Node.js 20 or newer and Foundry on the secure operator machine.
- Authenticated Vercel and Railway CLIs.
- A funded Shannon deployer wallet.
- A separate funded armorer wallet for the Railway worker.
- A deployed game contract and registered Data Streams schema.

Never commit `.env` or place a private key in a `NEXT_PUBLIC_` variable.

## 1. Deploy the contract

On a secure operator machine, populate the Foundry variables from `.env.example`:

```bash
PRIVATE_KEY=0x...
RPC_URL=https://dream-rpc.somnia.network
ARMORER_ADDRESS=0x...
```

`ARMORER_ADDRESS` must be the public address derived from the private key that Railway
will use. The deployment sends 33 STT to the game for its Reactivity subscription and
callback budget.

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

Record the printed `LastOneStanding` address. If the worker address changes later, the
contract owner must call `setArmorer(newArmorer)` before the new worker can arm rounds.

## 2. Register the Data Streams schema

Set the armorer key locally, then register the schemas once:

```bash
ARMORER_PRIVATE_KEY=0x... npm run register-schemas
```

Record the printed `ROUND_RESULT_SCHEMA_ID` and `PUBLISHER_ADDRESS`. The publisher is
the armorer account used by both schema registration and the companion.

## 3. Deploy both hosted services from the CLI

Install and authenticate the platform CLIs once:

```bash
npm install --global vercel @railway/cli
vercel login
railway login
```

Keep the current deployment values in the root `.env`. Check the values and their
cross-service relationships without making any external changes:

```bash
npm run deploy -- --check
```

Then deploy the Railway companion and Vercel frontend from the current working tree:

```bash
npm run deploy
```

The command creates or links both projects, uploads only each platform's required
variables, submits both deployments, and prints the production website URL. It does not
redeploy the contract or register a new schema.

The default resource names can be overridden for another account or environment:

```bash
RAILWAY_PROJECT_NAME=my-project \
RAILWAY_SERVICE_NAME=my-companion \
RAILWAY_WORKSPACE=my-workspace \
VERCEL_PROJECT_NAME=my-web-app \
VERCEL_SCOPE=my-vercel-team \
npm run deploy
```

Set `DEPLOY_ENV=/path/to/file` to read a different dotenv file. The default is the root
`.env`. `RAILWAY_WORKSPACE` is inferred when the account has exactly one workspace and
is required when it has more than one. `VERCEL_SCOPE` selects the owning Vercel account
or team and defaults to `natachad-3044s-projects`. The script validates that the armorer key derives to both `ARMORER_ADDRESS` and
`NEXT_PUBLIC_PUBLISHER_ADDRESS`, and that private/public game and schema identifiers
match. Secret values are never printed.

## 4. Manual Vercel setup

1. Import the Git repository into Vercel.
2. Keep the repository root as the project root.
3. Vercel will read `vercel.json`, use Next.js, install with the required peer override,
   and run `npm run build`.
4. Set the following variables for Production and any Preview environments that should
   connect to Shannon:

```bash
NEXT_PUBLIC_GAME_ADDRESS=0x...
NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID=0x...
NEXT_PUBLIC_PUBLISHER_ADDRESS=0x...
NEXT_PUBLIC_INDEXER_URL=https://dev.smk.somnia.host/v1/graphql
```

Only the first three values are deployment-specific. The indexer URL already has the
shown default, but setting it explicitly makes the deployment easier to audit.

Do not add `PRIVATE_KEY` or `ARMORER_PRIVATE_KEY` to Vercel. Public variables are
embedded into the browser bundle at build time, so changing them requires a new Vercel
deployment.

After deployment:

- open `/demo` to verify rendering without RPC or wallet access;
- open `/runs` to verify contract reads; and
- connect a wallet to verify Shannon chain switching.

## 5. Manual Railway setup

1. Create a Railway project and add a service from the same Git repository.
2. Use the repository root as the service root.
3. Keep the service private and do not generate a public domain.
4. Railway will apply `.railway/railway.ts` and run `npm run companion`.
5. Add these service variables:

```bash
ARMORER_PRIVATE_KEY=0x...
GAME_ADDRESS=0x...
ROUND_RESULT_SCHEMA_ID=0x...
INDEXER_URL=https://dev.smk.somnia.host/v1/graphql
```

`GAME_ADDRESS` must match Vercel's `NEXT_PUBLIC_GAME_ADDRESS`.
`ROUND_RESULT_SCHEMA_ID` must match Vercel's public schema ID. The public address derived
from `ARMORER_PRIVATE_KEY` must match `NEXT_PUBLIC_PUBLISHER_ADDRESS` and the contract's
configured armorer.

This is a background worker, so it does not expose an HTTP port and should not have a
Railway health-check path. The configured restart policy restarts it after failures.

Check the Railway logs for companion startup and subsequent publisher/armorer messages.
Keep enough Shannon STT in the armorer wallet for `armForRound` and Data Streams
transactions.

## 6. Operational smoke test

1. Confirm the Vercel `/demo` and `/runs` routes return successfully.
2. Confirm Railway remains running without a missing-variable or authorization error.
3. Create a test run from `/owner` using the deployed owner wallet.
4. Register players and start the first market through an owner or armorer contract call.
5. After settlement, confirm Railway publishes the round record and arms a matching
   successor.
6. Confirm the Vercel run page displays updated survivors and the round feed.

If Railway is offline, on-chain settlement remains authoritative. Automatic successor
arming and stream publication pause, and a valid market can still be armed manually by
the owner or armorer.

## Updating deployments

- Pushes to the connected branch trigger both services.
- Frontend-only changes can be redeployed on Vercel without rotating worker secrets.
- Companion-only changes can be redeployed on Railway without changing public variables.
- Contract or schema replacements require synchronized updates to both platforms.
- Rotate the armorer key by updating the contract first, then Railway, then the public
  publisher address if a new schema publisher is used.
