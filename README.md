# NullRPC

A high-performance Ethereum JSON-RPC proxy built on Cloudflare Workers with intelligent caching, rate limiting, and tiered access control.

## Features

- **⚡ Edge Performance** — Runs on Cloudflare's global edge network for ultra-low latency
- **🔄 Smart Caching** — Parameter-aware caching with method-specific TTLs (3s to 15min)
- **🛡️ Rate Limiting** — Token bucket algorithm with per-second and monthly limits
- **📊 Tiered Plans** — Hobbyist, Scaling, Business, and Enterprise tiers
- **🔀 Load Balancing** — Round-robin distribution across multiple RPC nodes
- **🔐 Token Authentication** — Optional authenticated access with usage tracking

## Supported Chains

| Chain    | Endpoint      |
|----------|---------------|
| Ethereum | `/eth`        |

## Usage

### Public Access

```bash
curl -X POST https://your-worker.workers.dev/eth \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Authenticated Access

```bash
curl -X POST https://your-worker.workers.dev/eth/YOUR_API_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## API Routes

| Route | Description |
|-------|-------------|
| `/` | Health check endpoint |
| `/:chain` | Public RPC access (rate limited by IP) |
| `/:chain/:token` | Authenticated RPC access (rate limited by token) |

## Plans & Rate Limits

| Plan | Requests/Second | Requests/Month |
|------|-----------------|----------------|
| Hobbyist | 10 | 100,000 |
| Scaling | 100 | 50,000,000 |
| Business | 500 | 250,000,000 |
| Enterprise | Unlimited | Unlimited |

## Caching Strategy

Responses are cached based on the RPC method and parameters:

| Category | TTL | Methods |
|----------|-----|---------|
| **Static** | 15 min | `eth_chainId`, `eth_getTransactionReceipt`, `eth_getBlockByHash` |
| **Block-dependent** | 15 min / 3s | `eth_getBlockByNumber`, `eth_call` (specific block vs latest) |
| **Volatile** | 3s | `eth_blockNumber`, `eth_gasPrice`, `eth_estimateGas` |
| **Never** | — | `eth_sendRawTransaction`, `eth_getTransactionCount`, filters |

Cache hits are indicated via the `X-NullRPC-Cache: HIT` header.

## Development

### Prerequisites

- [Bun](https://bun.sh/) or Node.js
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### Setup

```bash
# Install dependencies
bun install

# Generate TypeScript types
bun run typegen

# Start local development server
bun run dev
```

### Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start local development server |
| `bun run deploy` | Deploy to Cloudflare Workers |
| `bun run format` | Format code with Biome |
| `bun run lint` | Lint code with Biome |
| `bun run typegen` | Generate TypeScript types from wrangler config |

## Architecture

```
src/
├── index.ts          # Worker entry point & routing
├── handlers.ts       # Request handlers & upstream proxying
├── cache.ts          # Smart caching logic
├── constants.ts      # Chain configuration & RPC nodes
├── response.ts       # Response utilities
├── objects/
│   └── session.ts    # Durable Object for user sessions
└── types/
    ├── plans.ts      # Plan configurations
    ├── rates.ts      # Rate limit types
    └── user.ts       # User data types
```

### Key Components

- **Durable Objects** — `UserSession` manages per-user rate limiting and usage tracking with persistent storage
- **Rate Limiter** — Public requests use Cloudflare's built-in rate limiter (20 req/s per IP)
- **Token Bucket** — Authenticated users get a token bucket algorithm with 1.5x burst capacity

## Environment Variables

Configure these secrets in your Cloudflare Worker:

| Variable | Description |
|----------|-------------|
| `NULLRPC_AUTH` | Auth header sent to upstream nodes (optional) |

## License

MIT
