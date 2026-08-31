#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV:-$ROOT/.env}"
RAILWAY_PROJECT_NAME="${RAILWAY_PROJECT_NAME:-last-one-standing-companion}"
RAILWAY_SERVICE_NAME="${RAILWAY_SERVICE_NAME:-companion}"
RAILWAY_WORKSPACE="${RAILWAY_WORKSPACE:-}"
VERCEL_PROJECT_NAME="${VERCEL_PROJECT_NAME:-last-one-standing}"
VERCEL_SCOPE="${VERCEL_SCOPE:-natachad-3044s-projects}"
CHECK_ONLY=false

if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: npm run deploy -- [--check]"
  exit 1
fi

cd "$ROOT"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing $1 CLI."
    if [[ "$1" == "railway" || "$1" == "vercel" ]]; then
      echo "Install deployment CLIs with: npm install --global vercel @railway/cli"
    fi
    exit 1
  fi
}

set_railway_variable() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" |
    railway variable set "$name" --stdin \
      --service "$RAILWAY_SERVICE_NAME" --skip-deploys >/dev/null
}

upsert_vercel_variable() {
  local name="$1"
  local value="$2"
  vercel env add "$name" production \
    --force --value "$value" --yes --no-sensitive >/dev/null
}

vercel_url_from_output() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(input);
        const url = data.deployment?.url ?? data.url;
        if (url) {
          process.stdout.write(String(url));
          return;
        }
      } catch {}
      const urls = input.match(/https:\/\/[^\s"]+\.vercel\.app/g);
      if (!urls?.length) process.exit(1);
      process.stdout.write(urls[urls.length - 1]);
    });
  '
}

vercel_alias_from_output() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      try {
        const aliases = JSON.parse(input).aliases || [];
        if (!aliases.length) process.exit(1);
        process.stdout.write(`https://${aliases[0]}`);
      } catch {
        process.exit(1);
      }
    });
  '
}

railway_project_is_linked() {
  local project_json
  project_json="$(railway status --json 2>/dev/null || true)"
  printf '%s' "$project_json" |
    node -e '
      let input = "";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
        try {
          process.exit(JSON.parse(input).name === process.argv[1] ? 0 : 1);
        } catch {
          process.exit(1);
        }
      });
    ' "$RAILWAY_PROJECT_NAME"
}

require_command node

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing deployment environment file: $ENV_FILE"
  echo "Copy .env.example to .env and populate the current Shannon values."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

node --input-type=module <<'NODE'
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const required = [
  'ARMORER_ADDRESS',
  'ARMORER_PRIVATE_KEY',
  'GAME_ADDRESS',
  'ROUND_RESULT_SCHEMA_ID',
  'INDEXER_URL',
  'NEXT_PUBLIC_GAME_ADDRESS',
  'NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID',
  'NEXT_PUBLIC_PUBLISHER_ADDRESS',
  'NEXT_PUBLIC_INDEXER_URL',
];

for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required deployment variable: ${name}`);
    process.exit(1);
  }
}

const address = (name) => {
  try {
    return getAddress(process.env[name]).toLowerCase();
  } catch {
    console.error(`${name} must be a valid address.`);
    process.exit(1);
  }
};
const bytes32 = (name) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[name])) {
    console.error(`${name} must be a 32-byte hex value.`);
    process.exit(1);
  }
  return process.env[name].toLowerCase();
};
const url = (name) => {
  try {
    const value = new URL(process.env[name]);
    if (value.protocol !== 'http:' && value.protocol !== 'https:') throw new Error();
  } catch {
    console.error(`${name} must be an HTTP(S) URL.`);
    process.exit(1);
  }
};

if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.ARMORER_PRIVATE_KEY)) {
  console.error('ARMORER_PRIVATE_KEY must be a 32-byte private key.');
  process.exit(1);
}

const armorer = address('ARMORER_ADDRESS');
const publisher = address('NEXT_PUBLIC_PUBLISHER_ADDRESS');
const derived = privateKeyToAccount(process.env.ARMORER_PRIVATE_KEY).address.toLowerCase();
if (derived !== armorer || derived !== publisher) {
  console.error('ARMORER_PRIVATE_KEY must derive to ARMORER_ADDRESS and NEXT_PUBLIC_PUBLISHER_ADDRESS.');
  process.exit(1);
}
if (address('GAME_ADDRESS') !== address('NEXT_PUBLIC_GAME_ADDRESS')) {
  console.error('GAME_ADDRESS and NEXT_PUBLIC_GAME_ADDRESS must match.');
  process.exit(1);
}
if (bytes32('ROUND_RESULT_SCHEMA_ID') !== bytes32('NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID')) {
  console.error('ROUND_RESULT_SCHEMA_ID and NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID must match.');
  process.exit(1);
}
url('INDEXER_URL');
url('NEXT_PUBLIC_INDEXER_URL');
NODE

if [[ "$CHECK_ONLY" == true ]]; then
  echo "Deployment configuration is valid."
  exit 0
fi

require_command railway
require_command vercel

if ! railway whoami >/dev/null 2>&1; then
  echo "Railway is not authenticated. Run: railway login"
  exit 1
fi
if ! vercel whoami >/dev/null 2>&1; then
  echo "Vercel is not authenticated. Run: vercel login"
  exit 1
fi

if [[ -z "$RAILWAY_WORKSPACE" ]]; then
  if ! RAILWAY_WORKSPACE="$(
    railway whoami --json |
      node -e '
        let input = "";
        process.stdin.on("data", (chunk) => input += chunk);
        process.stdin.on("end", () => {
          const workspaces = JSON.parse(input).workspaces || [];
          if (workspaces.length !== 1) process.exit(1);
          process.stdout.write(workspaces[0].id);
        });
      '
  )"; then
    echo "Multiple Railway workspaces found. Set RAILWAY_WORKSPACE to an ID or exact name."
    exit 1
  fi
fi

echo "Preparing Railway project and companion service..."
if ! railway_project_is_linked; then
  railway link --workspace "$RAILWAY_WORKSPACE" \
    --project "$RAILWAY_PROJECT_NAME" --json >/dev/null 2>&1 || true
fi
if ! railway_project_is_linked; then
  railway init --workspace "$RAILWAY_WORKSPACE" \
    --name "$RAILWAY_PROJECT_NAME" --json >/dev/null
fi

railway config apply --yes >/dev/null
railway link --workspace "$RAILWAY_WORKSPACE" --project "$RAILWAY_PROJECT_NAME" \
  --service "$RAILWAY_SERVICE_NAME" --json >/dev/null

set_railway_variable ARMORER_PRIVATE_KEY "$ARMORER_PRIVATE_KEY"
set_railway_variable GAME_ADDRESS "$GAME_ADDRESS"
set_railway_variable ROUND_RESULT_SCHEMA_ID "$ROUND_RESULT_SCHEMA_ID"
set_railway_variable INDEXER_URL "$INDEXER_URL"

echo "Deploying companion to Railway..."
railway up --detach --yes

echo "Preparing Vercel project..."
if [[ ! -f "$ROOT/.vercel/project.json" ]]; then
  vercel link --yes --project "$VERCEL_PROJECT_NAME" --scope "$VERCEL_SCOPE"
fi

upsert_vercel_variable NEXT_PUBLIC_GAME_ADDRESS "$NEXT_PUBLIC_GAME_ADDRESS"
upsert_vercel_variable NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID "$NEXT_PUBLIC_ROUND_RESULT_SCHEMA_ID"
upsert_vercel_variable NEXT_PUBLIC_PUBLISHER_ADDRESS "$NEXT_PUBLIC_PUBLISHER_ADDRESS"
upsert_vercel_variable NEXT_PUBLIC_INDEXER_URL "$NEXT_PUBLIC_INDEXER_URL"

echo "Deploying frontend to Vercel..."
VERCEL_OUTPUT="$(vercel deploy --prod --yes)"
VERCEL_URL="$(printf '%s' "$VERCEL_OUTPUT" | vercel_url_from_output)"
if VERCEL_INSPECT="$(vercel inspect "$VERCEL_URL" --scope "$VERCEL_SCOPE" --json 2>/dev/null)"; then
  VERCEL_ALIAS="$(printf '%s' "$VERCEL_INSPECT" | vercel_alias_from_output || true)"
  if [[ -n "$VERCEL_ALIAS" ]]; then
    VERCEL_URL="$VERCEL_ALIAS"
  fi
fi

echo
echo "Hosted deployment submitted:"
echo "  Website: $VERCEL_URL"
echo "  Railway project: $RAILWAY_PROJECT_NAME"
echo "  Railway service: $RAILWAY_SERVICE_NAME"
