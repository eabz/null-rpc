import { sleep } from "bun";

const TARGET_URL = "https://nullrpc.dev"

// Cache categories matching cache.ts logic
type CacheCategory = "static" | "volatile" | "dynamic" | "never";

interface RpcCall {
  method: string;
  params: unknown[];
  cache: CacheCategory;
  desc: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CHAINS = [
  "eth", "bsc", "polygon", "arbitrum", "optimism", 
  "base", "unichain", "berachain", "plasma", "katana"
];

// ═══════════════════════════════════════════════════════════════════════════
// DATA GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

const SOME_ADDRESSES = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
];

const SOME_BLOCKS = [
  "0x10d4f", "0x11111", "0x12345", "0x20000", "0x54321"
];

const SOME_TXS = [
  "0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b"
];

function generateRpcCalls(): RpcCall[] {
  const calls: RpcCall[] = [];

  // Static
  calls.push({ method: "eth_chainId", params: [], cache: "static", desc: "Chain ID" });
  calls.push({ method: "net_version", params: [], cache: "static", desc: "Net Version" });
  
  // Blocks
  SOME_BLOCKS.forEach(block => {
    calls.push({ 
      method: "eth_getBlockByNumber", 
      params: [block, false], 
      cache: "static", 
      desc: `Block ${block}` 
    });
  });

  // Txs
  SOME_TXS.forEach(tx => {
    calls.push({
      method: "eth_getTransactionByHash",
      params: [tx],
      cache: "static",
      desc: `Tx ${tx.slice(0, 10)}...`
    });
  });

  // Volatile
  calls.push({ method: "eth_blockNumber", params: [], cache: "volatile", desc: "Block Number" });
  calls.push({ method: "eth_gasPrice", params: [], cache: "volatile", desc: "Gas Price" });

  return calls;
}

const RPC_CALLS = generateRpcCalls();

// Statistics collector
interface TestStats {
  success: number;
  limited: number;
  errors: number;
  latencies: number[];
  cacheHits: number;
  cacheMisses: number;
}

function createStats(): TestStats {
  return { success: 0, limited: 0, errors: 0, latencies: [], cacheHits: 0, cacheMisses: 0 };
}

function formatStats(stats: TestStats): string {
  const total = stats.success + stats.limited + stats.errors;
  const avgLatency = stats.latencies.length > 0 
    ? (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(1) 
    : "N/A";
  
  return `Requests: ${total} | ✅ ${stats.success} | 🚫 ${stats.limited} 429s | ❌ ${stats.errors} err | ⚡ Avg: ${avgLatency}ms | 📦 Cache: ${stats.cacheHits} HIT / ${stats.cacheMisses} MISS`;
}

async function makeRpcRequest(
  endpoint: string, 
  method: string, 
  params: unknown[], 
  stats: TestStats,
  trackCache = false
): Promise<void> {
  const start = Date.now();
  const requestId = stats.success + stats.errors + stats.limited + 1;
  
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    });
    
    const latency = Date.now() - start;
    stats.latencies.push(latency);

    if (res.status === 429) {
      stats.limited++;
      return;
    }
    
    if (!res.ok) {
      stats.errors++;
      console.log(`HTTP Error ${res.status} for ${method} on ${endpoint}`);
      return;
    }

    const body = await res.json() as any;
    
    if (body.error) {
       stats.errors++;
       console.log(`RPC Error for ${method} on ${endpoint}:`, JSON.stringify(body.error));
       return;
    }

    stats.success++;
    
    if (trackCache) {
      const cacheHeader = res.headers.get("X-NullRPC-Cache");
      if (cacheHeader === "HIT") stats.cacheHits++;
      else stats.cacheMisses++;
    }
  } catch (e) {
    stats.errors++;
    console.log(`Network Exception for ${method} on ${endpoint}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITED TEST
// ═══════════════════════════════════════════════════════════════════════════

async function runRateLimitedTest(targetRps: number, durationSecs: number): Promise<TestStats> {
  console.log(`\n🌊 MULTI-CHAIN LOAD TEST`);
  console.log(`   Target Limit: ${targetRps} RPS`);
  console.log(`   Duration: ${durationSecs}s`);
  console.log(`   Chains: ${CHAINS.length} (${CHAINS.join(', ')})\n`);

  const stats = createStats();
  const startTime = Date.now();
  const endTime = startTime + durationSecs * 1000;
  
  const intervalMs = 1000 / targetRps;
  let expectedNextRequest = startTime;

  while (Date.now() < endTime) {
    const now = Date.now();
    
    // If we are behind schedule, fire immediately. If ahead, sleep.
    if (now < expectedNextRequest) {
      await sleep(expectedNextRequest - now);
    }

    // Pick random chain and random call
    const chain = CHAINS[Math.floor(Math.random() * CHAINS.length)];
    const call = RPC_CALLS[Math.floor(Math.random() * RPC_CALLS.length)];
    const endpoint = `${TARGET_URL}/${chain}`;

    // Fire and forget (don't await) to maintain sending rate
    makeRpcRequest(endpoint, call.method, call.params, stats, true);

    expectedNextRequest += intervalMs;
  }
  
  // Wait a bit for pending requests
  await sleep(1000);
  
  const elapsed = (Date.now() - startTime) / 1000;
  const total = stats.success + stats.limited + stats.errors;
  const rps = total / elapsed;
  
  console.log(`\n   ${formatStats(stats)}`);
  console.log(`   ⏱️  Elapsed: ${elapsed.toFixed(1)}s | Actual RPS: ${rps.toFixed(0)}`);
  
  if (stats.limited > 0) {
     console.log(`   ⚠️  WARNING: Hit Rate Limits (${stats.limited})`);
  } else {
     console.log(`   ✅ SUCCESS: Stayed within limits.`);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(80));
  console.log("🚀 NULL-RPC RATE LIMIT TEST");
  console.log("═".repeat(80));

  await runRateLimitedTest(50, 20); // 50 RPS for 20 seconds
}

main().catch(console.error);
