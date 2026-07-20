# Solana Blockchain Skill

Query Solana on-chain data enriched with USD pricing via CoinGecko.
8 commands: wallet portfolio, token info, transactions, activity, NFTs,
whale detection, network stats, and price lookup.

No API key needed. Uses only Python standard library (urllib, json, argparse).

## When to Use

- User asks for a Solana wallet balance, token holdings, or portfolio value
- User wants to inspect a specific transaction by signature
- User wants SPL token metadata, price, supply, or top holders
- User wants recent transaction history for an address
- User wants NFTs owned by a wallet
- User wants to find large SOL transfers (whale detection)
- User wants Solana network health, TPS, epoch, or SOL price
- User asks "what's the price of BONK/JUP/SOL?"

## Prerequisites

Python standard library only (urllib, json, argparse). No external packages.
Pricing from CoinGecko free API (no key needed, rate-limited ~10-30 req/min).

RPC endpoint (default): https://api.mainnet-beta.solana.com
Override: `export SOLANA_RPC_URL=https://your-private-rpc.com`

## Quick Reference

```
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py wallet   <address> [--limit N] [--all] [--no-prices]
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py tx       <signature>
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py token    <mint_address>
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py activity <address> [--limit N]
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py nft      <address>
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py whales   [--min-sol N]
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py stats
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py price    <mint_or_symbol>
```

## Key Commands

### Wallet Portfolio
Get SOL balance, SPL token holdings with USD values, NFT count, portfolio total.
```bash
python3 solana_client.py wallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
```

### Transaction Details
Inspect a full transaction by its base58 signature.
```bash
python3 solana_client.py tx 5j7s8K...signature_here
```

### Token Info
Get SPL token metadata, current price, market cap, supply, top holders.
```bash
python3 solana_client.py token DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```

### Network Stats
Live Solana network health: slot, epoch, TPS, supply, validator version, SOL price.
```bash
python3 solana_client.py stats
```

## Pitfalls

- CoinGecko rate-limits: ~10-30 req/min. Use `--no-prices` for speed.
- Public RPC rate-limits. For production, use a private endpoint (Helius, QuickNode).
- NFT detection is heuristic (amount=1 + decimals=0). Compressed NFTs not detected.
- Whale detector scans latest block only — point-in-time snapshot.
- Transaction history: public RPC keeps ~2 days. Older may not be available.
- Retry on 429: both RPC and CoinGecko calls retry up to 2 times with backoff.

## Verification

```bash
python3 ~/.hermes/skills/blockchain/solana/scripts/solana_client.py stats
# Should print current Solana slot, TPS, and SOL price
```