# Hyperliquid Skill

A read-only Hyperliquid integration that queries the public `/info` endpoint using only Python standard library modules (`urllib`, `json`, `argparse`). No API key or signing required.

## Core Capabilities

12 commands for retrieving market data, account history, and trade analytics:

- **Market Discovery**: `dexs`, `markets`, `spots`
- **Market Data**: `candles`, `funding`, `l2`
- **Account Data**: `state`, `spot-balances`, `fills`, `orders`
- **Analytics**: `review`, `export`

## Prerequisites

The script reads `${HERMES_HOME:-~/.hermes}/.env` for optional defaults:
- `HYPERLIQUID_API_URL` (defaults to mainnet endpoint)
- `HYPERLIQUID_USER_ADDRESS` (sets a default wallet address for account queries)

## Key Limitations

- Public endpoints are rate-limited
- `fills --hours` uses a recent rolling window only
- `historicalOrders` returns limited recent orders
- `review` command is heuristic-based and cannot fully reconstruct trading intent

## Usage

```bash
python3 ~/.hermes/skills/blockchain/hyperliquid/scripts/hyperliquid_client.py <command> [args]
```

Use `--json` flag for machine-readable output.

## Trade Review Feature

The `review` command generates post-trade analysis combining recent fills with market context:
- Realized PnL, fees, win/loss counts
- Coin breakdowns, market trends, average funding per traded perpetual
- Heuristics for fee drag, concentration, and counter-trend losses