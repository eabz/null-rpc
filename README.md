# NullRPC

High-performance, privacy-focused Ethereum JSON-RPC proxy built on Cloudflare Workers. Designed for speed, reliability, and zero-logging privacy.

## Features

- **Global Edge Network** — Deployed on Cloudflare Workers for sub-millisecond routing decisions and global availability.
- **Intelligent Caching** — Protocol-aware caching for JSON-RPC methods reducing upstream load.
- **Privacy First** — No IP logging, no user tracking, and no personally identifiable information (PII) retention.

## Supported Chains

NullRPC provides dedicated endpoints for the following networks:

| Chain | Endpoint | Description |
|-------|----------|-------------|
| **Ethereum** | `/eth` | Mainnet RPC |
| **Binance Smart Chain** | `/bsc` | BSC Mainnet RPC |
| **Polygon** | `/polygon` | Polygon PoS Mainnet |
| **Arbitrum One** | `/arbitrum` | Arbitrum Optimistic Rollup |
| **Optimism** | `/optimism` | Optimism Mainnet |
| **Base** | `/base` | Base L2 |
| **Unichain** | `/unichain` | Unichain Testnet/Mainnet |
| **Berachain** | `/berachain` | Berachain Testnet/Mainnet |
| **Plasma** | `/plasma` | Plasma Network |
| **Katana Network** | `/katana` | Ronin/Katana Sidechain |

## Usage

NullRPC allows direct public access via simple HTTP POST requests.

### Standard RPC Request

```bash
curl -X POST https://nullrpc.dev/eth \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Chain-Specific Dashboards

Visit `https://nullrpc.dev/[chain]` (e.g., `https://nullrpc.dev/eth`) to view performance metrics for that specific network.

## Caching Strategy

Caching is strictly defined by method type to ensure data consistency while maximizing performance:

| Type | TTL | Examples |
|------|-----|----------|
| **Immutable** | 15 mins | `eth_chainId`, `eth_getBlockByHash`, `eth_getTransactionReceipt` |
| **Volatile** | 3 sec | `eth_blockNumber`, `eth_gasPrice` |
| **Block-Dependent** | Adaptive | `eth_call`, `eth_getBalance` (Latest vs Historical) |
| **Passthrough** | None | `eth_sendRawTransaction`, `eth_newFilter` |

## License

MIT
