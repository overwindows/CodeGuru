# EVM Blockchain Skill

Query EVM-compatible blockchain data across 8 chains with USD pricing.
14 commands: wallet portfolio, token info, transactions, activity, gas tracker,
network stats, price lookup, multi-chain scan, whale detection, ENS resolution,
allowance checker, contract inspector, and transaction decoder.

Supports 8 chains: Ethereum, BNB Chain (BSC), Base, Arbitrum One, Polygon,
Optimism, Avalanche (C-Chain), zkSync Era.

No API key needed. Zero external dependencies — Python standard library only
(urllib, json, argparse, threading).

## When to Use
- User asks for a wallet balance or portfolio on any EVM chain
- User wants to check the same wallet across ALL chains at once
- User wants to inspect a transaction by hash (or decode what it did)
- User wants ERC-20 token metadata, price, supply, or market cap
- User wants recent transaction history for an address
- User wants current gas prices or to compare fees across chains
- User wants to find large whale transfers in recent blocks
- User asks to resolve an ENS name (vitalik.eth) or reverse-lookup an address
- User wants to check if a contract has dangerous token approvals
- User wants to inspect a smart contract (proxy? ERC-20? ERC-721? bytecode size?)
- User wants to compare gas costs across chains before a transaction

## Prerequisites
Python 3.8+ standard library only. No pip installs required.
Pricing: CoinGecko free API (rate-limited, ~10-30 req/min).
ENS: ensideas.com public API.
Tx decoding: 4byte.directory public API.

Override RPC endpoint: `export EVM_RPC_URL=https://your-rpc.com`

Helper script path: `~/.hermes/skills/blockchain/evm/scripts/evm_client.py`

## Quick Reference

```
SCRIPT=~/.hermes/skills/blockchain/evm/scripts/evm_client.py

# Network & prices
python3 $SCRIPT stats                            # Ethereum stats
python3 $SCRIPT stats --chain arbitrum           # Arbitrum stats
python3 $SCRIPT compare                          # Gas + prices ALL 8 chains

# Wallet
python3 $SCRIPT wallet 0xd8dA...96045            # Portfolio (ETH + ERC-20)
python3 $SCRIPT multichain 0xd8dA...96045        # Same wallet on ALL chains

# Tokens & prices
python3 $SCRIPT price ETH
python3 $SCRIPT token 0xdAC1...1ec7              # ERC-20 metadata + market cap

# Transactions
python3 $SCRIPT tx 0x5c50...f060                 # Transaction details
python3 $SCRIPT decode 0x5c50...f060             # Decode input data

# Gas
python3 $SCRIPT gas                              # Gas prices + cost estimates

# Security
python3 $SCRIPT allowance 0xd8dA...96045         # Dangerous ERC-20 approvals
python3 $SCRIPT contract 0xdAC1...1ec7           # Contract inspection

# ENS
python3 $SCRIPT ens vitalik.eth                  # Name -> address + profile

# Whale detection
python3 $SCRIPT whale                            # Large transfers (last 20 blocks, >$10k)
```

## Supported Chains
| Key       | Name           | Native | Chain ID |
|-----------|----------------|--------|----------|
| ethereum  | Ethereum       | ETH    | 1        |
| bsc       | BNB Chain      | BNB    | 56       |
| base      | Base           | ETH    | 8453     |
| arbitrum  | Arbitrum One   | ETH    | 42161    |
| polygon   | Polygon        | POL    | 137      |
| optimism  | Optimism       | ETH    | 10       |
| avalanche | Avalanche C    | AVAX   | 43114    |
| zksync    | zkSync Era     | ETH    | 324      |

## Pitfalls
- CoinGecko free tier: ~10-30 req/min. Use `--no-prices` for faster wallet scans.
- Public RPCs may throttle. Set EVM_RPC_URL to a private endpoint for production.
- `wallet` and `allowance` only check known token list (~30 tokens per chain).
- `multichain` runs 8 parallel threads — can trigger rate limits on public RPCs.
- ENS resolution depends on a single public endpoint. If down, re-run later.
- Tx decoding depends on 4byte.directory — selectors not in database show as `unknown`.