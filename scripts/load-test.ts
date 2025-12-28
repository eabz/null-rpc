import { sleep } from "bun";

const TARGET_URL = process.env.TARGET_URL || "http://localhost:8787";

// Use fixed tokens created manually in the database
const RUN_ID = "manual";

// Test tokens for each plan tier
const PLANS = {
  hobbyist: "user_hobbyist",
  scaling: "user_scaling",
  business: "user_business",
  enterprise: "user_enterprise",
} as const;

// Plan rate limits for reference
const PLAN_LIMITS = {
  public: { rps: 20, desc: "Public (IP-based, 1200/60s) [Remote CF Rate Limiter]" },
  hobbyist: { rps: 10, desc: "Hobbyist (10 RPS)" },
  scaling: { rps: 100, desc: "Scaling (100 RPS)" },
  business: { rps: 500, desc: "Business (500 RPS)" },
  enterprise: { rps: Infinity, desc: "Enterprise (Unlimited)" },
} as const;

// Cache categories matching cache.ts logic
type CacheCategory = "static" | "volatile" | "dynamic" | "never";

interface RpcCall {
  method: string;
  params: unknown[];
  cache: CacheCategory;
  desc: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE RPC METHOD LIBRARY  
// Organized by cache category with realistic test parameters
// ═══════════════════════════════════════════════════════════════════════════

const RPC_CALLS: RpcCall[] = [
  // ════════════════════════════════════════════════════════════════════════
  // STATIC (15 min cache) - Chain/Network constants and immutable data
  // ════════════════════════════════════════════════════════════════════════
  { method: "eth_chainId", params: [], cache: "static", desc: "Chain ID (immutable)" },
  { method: "net_version", params: [], cache: "static", desc: "Network version (immutable)" },
  { method: "web3_clientVersion", params: [], cache: "static", desc: "Client version (static)" },
  { method: "web3_sha3", params: ["0x68656c6c6f"], cache: "static", desc: "Keccak hash (pure function)" },
  
  // Block by hash (immutable)
  { 
    method: "eth_getBlockByHash", 
    params: ["0xdc0818cf78f21a8e70579cb46a43643f78291264dda342ae31049421c82d21ae", false], 
    cache: "static", 
    desc: "Block by hash (immutable)" 
  },
  { 
    method: "eth_getBlockTransactionCountByHash", 
    params: ["0xdc0818cf78f21a8e70579cb46a43643f78291264dda342ae31049421c82d21ae"], 
    cache: "static", 
    desc: "Tx count by block hash" 
  },
  
  // Transaction by hash (immutable once confirmed)
  { 
    method: "eth_getTransactionByHash", 
    params: ["0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b"], 
    cache: "static", 
    desc: "Tx by hash (immutable)" 
  },
  { 
    method: "eth_getTransactionReceipt", 
    params: ["0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b"], 
    cache: "static", 
    desc: "Tx receipt (immutable)" 
  },
  
  // Block by specific number (immutable)
  { 
    method: "eth_getBlockByNumber", 
    params: ["0x10d4f", true],  // Specific block
    cache: "static", 
    desc: "Block by specific number (immutable)" 
  },
  { 
    method: "eth_getBlockTransactionCountByNumber", 
    params: ["0x10d4f"], 
    cache: "static", 
    desc: "Tx count at specific block" 
  },

  // ════════════════════════════════════════════════════════════════════════
  // VOLATILE (3-5s cache) - Changes frequently but cacheable briefly
  // ════════════════════════════════════════════════════════════════════════
  { method: "eth_blockNumber", params: [], cache: "volatile", desc: "Current block (volatile)" },
  { method: "eth_gasPrice", params: [], cache: "volatile", desc: "Gas price (volatile)" },
  { method: "eth_maxPriorityFeePerGas", params: [], cache: "volatile", desc: "Priority fee (volatile)" },
  { method: "eth_blobBaseFee", params: [], cache: "volatile", desc: "Blob base fee (volatile)" },
  { method: "eth_feeHistory", params: ["0x5", "latest", [25, 75]], cache: "volatile", desc: "Fee history" },
  { method: "eth_syncing", params: [], cache: "volatile", desc: "Sync status" },
  { method: "eth_mining", params: [], cache: "volatile", desc: "Mining status" },
  { method: "eth_hashrate", params: [], cache: "volatile", desc: "Hashrate" },
  { method: "net_listening", params: [], cache: "volatile", desc: "Net listening" },
  { method: "net_peerCount", params: [], cache: "volatile", desc: "Peer count" },
  
  // Block by 'latest' tag (volatile)
  { 
    method: "eth_getBlockByNumber", 
    params: ["latest", false], 
    cache: "volatile", 
    desc: "Block at 'latest' (volatile)" 
  },
  { 
    method: "eth_getBlockTransactionCountByNumber", 
    params: ["latest"], 
    cache: "volatile", 
    desc: "Tx count at 'latest'" 
  },
  { 
    method: "eth_getUncleCountByBlockNumber", 
    params: ["latest"], 
    cache: "volatile", 
    desc: "Uncle count at 'latest'" 
  },
  
  // Balance/Code at 'latest' (volatile)
  { 
    method: "eth_getBalance", 
    params: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "latest"], // Vitalik's address
    cache: "volatile", 
    desc: "Balance at 'latest'" 
  },
  { 
    method: "eth_getCode", 
    params: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "latest"], // USDT contract
    cache: "volatile", 
    desc: "Code at 'latest'" 
  },
  { 
    method: "eth_getStorageAt", 
    params: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "0x0", "latest"], 
    cache: "volatile", 
    desc: "Storage at 'latest'" 
  },

  // ════════════════════════════════════════════════════════════════════════
  // DYNAMIC - Cache depends on parameters (block-tag aware)
  // ════════════════════════════════════════════════════════════════════════
  
  // Balance at specific block (cacheable longer)
  { 
    method: "eth_getBalance", 
    params: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "0x10d4f"], 
    cache: "dynamic", 
    desc: "Balance at specific block (cacheable)" 
  },
  
  // Code at specific block
  { 
    method: "eth_getCode", 
    params: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", "0x1000000"], 
    cache: "dynamic", 
    desc: "Code at specific block" 
  },

  // ════════════════════════════════════════════════════════════════════════
  // COMPLEX CALLS - eth_call and eth_getLogs with various parameters
  // ════════════════════════════════════════════════════════════════════════
  
  // eth_call at latest (volatile)
  { 
    method: "eth_call", 
    params: [
      { to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x06fdde03" }, // name()
      "latest"
    ], 
    cache: "volatile", 
    desc: "eth_call name() at 'latest'" 
  },
  { 
    method: "eth_call", 
    params: [
      { to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x95d89b41" }, // symbol()
      "latest"
    ], 
    cache: "volatile", 
    desc: "eth_call symbol() at 'latest'" 
  },
  { 
    method: "eth_call", 
    params: [
      { to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x313ce567" }, // decimals()
      "latest"
    ], 
    cache: "volatile", 
    desc: "eth_call decimals() at 'latest'" 
  },
  { 
    method: "eth_call", 
    params: [
      { to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x18160ddd" }, // totalSupply()
      "latest"
    ], 
    cache: "volatile", 
    desc: "eth_call totalSupply() at 'latest'" 
  },
  
  // eth_call at specific block (cacheable)
  { 
    method: "eth_call", 
    params: [
      { to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x18160ddd" }, 
      "0x1000000" // Specific block
    ], 
    cache: "dynamic", 
    desc: "eth_call at specific block (cacheable)" 
  },
  
  // eth_getLogs with specific block range (cacheable)
  // Using recent blocks with small range to avoid 413 errors
  { 
    method: "eth_getLogs", 
    params: [{ 
      fromBlock: "0x13D6200",  // Block ~20,800,000
      toBlock: "0x13D6210",    // +16 blocks
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    }], 
    cache: "dynamic", 
    desc: "getLogs specific range (cacheable)" 
  },
  
  // eth_getLogs with 'latest' - use very recent fromBlock to avoid huge range
  { 
    method: "eth_getLogs", 
    params: [{ 
      fromBlock: "0x13D6200",  // Recent block
      toBlock: "latest",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] // Transfer event
    }], 
    cache: "volatile", 
    desc: "getLogs to 'latest' (volatile)" 
  },
  
  // eth_estimateGas
  { 
    method: "eth_estimateGas", 
    params: [{ 
      to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", 
      value: "0x1" 
    }], 
    cache: "volatile", 
    desc: "Estimate gas (volatile)" 
  },
  
  // eth_getProof (merkle proof)
  { 
    method: "eth_getProof", 
    params: [
      "0xdAC17F958D2ee523a2206206994597C13D831ec7", 
      ["0x0"], 
      "latest"
    ], 
    cache: "volatile", 
    desc: "getProof at 'latest'" 
  },

  // ════════════════════════════════════════════════════════════════════════
  // NEVER CACHE - Critical state or mutations
  // ════════════════════════════════════════════════════════════════════════
  { method: "eth_accounts", params: [], cache: "never", desc: "Accounts (never cache)" },
  { 
    method: "eth_getTransactionCount", 
    params: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "latest"], 
    cache: "never", 
    desc: "Nonce (CRITICAL - never cache)" 
  },
  { 
    method: "eth_getTransactionCount", 
    params: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "pending"], 
    cache: "never", 
    desc: "Pending nonce (never cache)" 
  },
  
  // Txpool methods
  { method: "txpool_status", params: [], cache: "never", desc: "TxPool status" },
  { method: "txpool_content", params: [], cache: "never", desc: "TxPool content" },
  { method: "txpool_inspect", params: [], cache: "never", desc: "TxPool inspect" },
];

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
  const p95 = stats.latencies.length > 0
    ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)]
    : 0;
  
  return `Total: ${total} | ✅ ${stats.success} | 🚫 ${stats.limited} 429s | ❌ ${stats.errors} errors | ⚡ Avg: ${avgLatency}ms P95: ${p95}ms | Cache: ${stats.cacheHits} HITs / ${stats.cacheMisses} MISSes`;
}

async function makeRpcRequest(
  endpoint: string, 
  method: string, 
  params: unknown[], 
  stats: TestStats,
  trackCache = false
): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: stats.success, method, params }),
    });
    
    const latency = Date.now() - start;
    stats.latencies.push(latency);

    if (res.status === 429) {
      stats.limited++;
    } else if (res.ok) {
      stats.success++;
      if (trackCache) {
        const cacheHeader = res.headers.get("X-NullRPC-Cache");
        if (cacheHeader === "HIT") stats.cacheHits++;
        else stats.cacheMisses++;
      }
    } else {
      stats.errors++;
    }
  } catch {
    stats.errors++;
  }
}

async function runHighConcurrencyTest(
  endpoint: string,
  targetRps: number,
  durationSecs: number,
  concurrency: number,
  desc: string
): Promise<TestStats> {
  // Calculate fixed number of requests based on target RPS and duration
  const totalRequests = Math.ceil(targetRps * durationSecs);
  
  console.log(`\n🔥 ${desc}`);
  console.log(`   Requests: ${totalRequests} | Concurrency: ${concurrency}`);
  
  const stats = createStats();
  const startTime = Date.now();
  
  // Process in batches of `concurrency` parallel requests
  for (let i = 0; i < totalRequests; i += concurrency) {
    const batchSize = Math.min(concurrency, totalRequests - i);
    const batch = Array(batchSize).fill(null).map(() => 
      makeRpcRequest(endpoint, "eth_blockNumber", [], stats)
    );
    await Promise.all(batch);
  }
  
  const elapsed = (Date.now() - startTime) / 1000;
  const actualRps = (stats.success + stats.limited) / elapsed;
  
  console.log(`   ${formatStats(stats)}`);
  console.log(`   Elapsed: ${elapsed.toFixed(1)}s | Actual RPS: ${actualRps.toFixed(1)}`);
  
  return stats;
}

async function testTierRateLimit(
  token: string | null,
  tier: keyof typeof PLAN_LIMITS,
  burstMultiplier = 2.5
): Promise<{ passed: boolean; stats: TestStats }> {
  const limit = PLAN_LIMITS[tier];
  const targetRps = Math.min(limit.rps * burstMultiplier, 1000);
  const endpoint = token ? `${TARGET_URL}/eth/${token}` : `${TARGET_URL}/eth`;
  
  const stats = await runHighConcurrencyTest(
    endpoint,
    targetRps,
    3,
    Math.min(50, Math.ceil(targetRps / 10)),
    `${limit.desc} - Stress Test`
  );
  
  const expectLimits = tier !== "enterprise";
  const passed = expectLimits ? stats.limited > 0 : stats.limited === 0;
  
  if (passed) {
    console.log(`   ✅ PASSED: ${expectLimits ? "Rate limiting active" : "No rate limiting (as expected)"}`);
  } else {
    console.log(`   ❌ FAILED: ${expectLimits ? "No 429s detected - rate limit not working!" : "Unexpected rate limiting!"}`);
  }
  
  return { passed, stats };
}

async function testBusinessThroughput(): Promise<{ passed: boolean; stats: TestStats }> {
  console.log(`\n📊 Business Tier - Sustained Throughput Test`);
  console.log(`   Testing at ~400 RPS (under 500 limit) to verify no rate limiting...`);
  
  const endpoint = `${TARGET_URL}/eth/${PLANS.business}`;
  const stats = createStats();
  const durationSecs = 5;
  const targetRps = 400;
  const concurrency = 40;
  
  const startTime = Date.now();
  const endTime = startTime + durationSecs * 1000;
  
  const worker = async () => {
    while (Date.now() < endTime) {
      await makeRpcRequest(endpoint, "eth_blockNumber", [], stats);
      await sleep(1000 / targetRps * concurrency);
    }
  };
  
  const workers = Array(concurrency).fill(null).map(() => worker());
  await Promise.all(workers);
  await sleep(500);
  
  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`   ${formatStats(stats)}`);
  console.log(`   Actual RPS: ${((stats.success + stats.limited) / elapsed).toFixed(1)}`);
  
  const passed = stats.limited < stats.success * 0.05;
  if (passed) {
    console.log(`   ✅ PASSED: Sustained throughput under limit works`);
  } else {
    console.log(`   ❌ FAILED: Too many 429s (${stats.limited}) for under-limit traffic`);
  }
  
  console.log(`\n   Now bursting to 800 RPS (over 500 limit)...`);
  const burstStats = await runHighConcurrencyTest(
    endpoint,
    800,
    3,
    80,
    "Business Tier - Over-limit Burst"
  );
  
  const burstPassed = burstStats.limited > 0;
  if (burstPassed) {
    console.log(`   ✅ PASSED: Rate limiting kicked in at high RPS`);
  } else {
    console.log(`   ❌ FAILED: No 429s - rate limit not enforcing 500 RPS cap`);
  }
  
  return { passed: passed && burstPassed, stats };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE CACHE DETECTION SUITE
// Tests cache behavior for all method categories with parameter awareness
// ═══════════════════════════════════════════════════════════════════════════

async function runCacheDetectionSuite(token: string): Promise<void> {
  console.log(`\n🔬 Comprehensive Cache Detection Suite`);
  console.log("   Testing all RPC methods with parameter-aware cache expectations...\n");
  
  const endpoint = `${TARGET_URL}/eth/${token}`;
  const results: { method: string; cache: CacheCategory; detected: string; latency1: number; latency2: number; match: boolean }[] = [];
  
  // Group by category for organized output
  const categories: CacheCategory[] = ["static", "volatile", "dynamic", "never"];
  
  for (const category of categories) {
    const categoryMethods = RPC_CALLS.filter(c => c.cache === category);
    if (categoryMethods.length === 0) continue;
    
    console.log(`   ── ${category.toUpperCase()} METHODS ──`);
    
    for (const call of categoryMethods) {
      const methodPadded = call.method.padEnd(45);
      process.stdout.write(`   ${methodPadded}`);
      
      // First request (cache fill)
      const start1 = Date.now();
      const res1 = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: call.method, params: call.params }),
      });
      const latency1 = Date.now() - start1;
      
      if (!res1.ok) {
        console.log(`⚠️  Error (${res1.status})`);
        continue;
      }
      
      // Brief delay for async cache write
      await sleep(50);
      
      // Second request (should hit cache if cacheable)
      const start2 = Date.now();
      const res2 = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: call.method, params: call.params }),
      });
      const latency2 = Date.now() - start2;
      
      const cacheHeader = res2.headers.get("X-NullRPC-Cache");
      
      // Detect cache behavior
      let detected: string;
      if (cacheHeader === "HIT") {
        detected = "HIT";
      } else if (cacheHeader === "MISS") {
        detected = "MISS";
      } else {
        // Heuristic: significant latency reduction suggests cache hit
        detected = latency2 < latency1 * 0.3 ? "HIT?" : "MISS?";
      }
      
      // Determine if behavior matches expectation
      const expectHit = category !== "never";
      const actualHit = detected.includes("HIT");
      const match = (expectHit && actualHit) || (!expectHit && !actualHit);
      
      // Choose status icon
      let icon: string;
      if (match) {
        icon = "✅";
      } else if (category === "volatile" || category === "dynamic") {
        icon = "🆗"; // Short TTL methods might miss due to timing
      } else {
        icon = "❌";
      }
      
      console.log(`${icon} ${detected.padEnd(5)} | ${latency1}ms → ${latency2}ms`);
      results.push({ method: call.method, cache: category, detected, latency1, latency2, match });
    }
    console.log("");
  }
  
  // Summary
  const matches = results.filter(r => r.match).length;
  console.log(`   Cache Detection Summary: ${matches}/${results.length} methods matched expected behavior`);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLEX WORKLOAD TESTS
// Simulates real-world DeFi/dApp traffic patterns
// ═══════════════════════════════════════════════════════════════════════════

async function runComplexWorkloadTest(token: string): Promise<TestStats> {
  console.log(`\n🏗️  Complex Workload Test (DeFi Pattern)`);
  console.log("   Simulating realistic dApp traffic: balances, calls, logs, blocks...\n");
  
  const endpoint = `${TARGET_URL}/eth/${token}`;
  const stats = createStats();
  const durationSecs = 10;
  const concurrency = 50;
  
  // DeFi-like workload distribution
  const workloadMethods = [
    // Token balance checks (40%)
    { method: "eth_call", params: [{ to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" }, "latest"], weight: 4 },
    // Block number (20%)
    { method: "eth_blockNumber", params: [], weight: 2 },
    // Balance check (15%)
    { method: "eth_getBalance", params: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "latest"], weight: 1.5 },
    // Gas price (10%)
    { method: "eth_gasPrice", params: [], weight: 1 },
    // Transaction receipt (10%)
    { method: "eth_getTransactionReceipt", params: ["0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b"], weight: 1 },
    // Chain ID (5%)
    { method: "eth_chainId", params: [], weight: 0.5 },
  ];
  
  // Normalize weights to probabilities
  const totalWeight = workloadMethods.reduce((sum, m) => sum + m.weight, 0);
  const methodProbabilities = workloadMethods.map(m => ({
    ...m,
    probability: m.weight / totalWeight
  }));
  
  const selectMethod = () => {
    const rand = Math.random();
    let cumulative = 0;
    for (const m of methodProbabilities) {
      cumulative += m.probability;
      if (rand < cumulative) return m;
    }
    return methodProbabilities[0];
  };
  
  const startTime = Date.now();
  const endTime = startTime + durationSecs * 1000;
  
  const worker = async () => {
    while (Date.now() < endTime) {
      const method = selectMethod();
      await makeRpcRequest(endpoint, method.method, method.params, stats, true);
    }
  };
  
  console.log(`   Running ${concurrency} concurrent workers for ${durationSecs}s...`);
  const workers = Array(concurrency).fill(null).map(() => worker());
  await Promise.all(workers);
  await sleep(500);
  
  const elapsed = (Date.now() - startTime) / 1000;
  const totalRequests = stats.success + stats.limited + stats.errors;
  
  console.log(`\n   ${formatStats(stats)}`);
  console.log(`   Total Requests: ${totalRequests} | Elapsed: ${elapsed.toFixed(1)}s | Actual RPS: ${(totalRequests / elapsed).toFixed(1)}`);
  
  const cacheRate = stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100;
  console.log(`   Cache Hit Rate: ${cacheRate.toFixed(1)}%`);
  
  return stats;
}

// Heavy mixed workload with ALL methods
async function runHeavyMixedWorkload(token: string): Promise<TestStats> {
  console.log(`\n💪 Heavy Mixed Workload Test`);
  console.log("   Hitting ALL RPC methods with maximum throughput...\n");
  
  const endpoint = `${TARGET_URL}/eth/${token}`;
  const stats = createStats();
  const durationSecs = 15;
  const concurrency = 100;
  
  const startTime = Date.now();
  const endTime = startTime + durationSecs * 1000;
  
  const worker = async () => {
    let callIndex = 0;
    while (Date.now() < endTime) {
      const call = RPC_CALLS[callIndex % RPC_CALLS.length];
      await makeRpcRequest(endpoint, call.method, call.params, stats, true);
      callIndex++;
    }
  };
  
  console.log(`   Running ${concurrency} parallel workers for ${durationSecs}s...`);
  const workers = Array(concurrency).fill(null).map(() => worker());
  await Promise.all(workers);
  await sleep(500);
  
  const elapsed = (Date.now() - startTime) / 1000;
  const totalRequests = stats.success + stats.limited + stats.errors;
  
  console.log(`\n   ${formatStats(stats)}`);
  console.log(`   Total Requests: ${totalRequests} | Elapsed: ${elapsed.toFixed(1)}s | Actual RPS: ${(totalRequests / elapsed).toFixed(1)}`);
  
  if (stats.cacheHits + stats.cacheMisses > 0) {
    const cacheRate = stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100;
    console.log(`   Cache Hit Rate: ${cacheRate.toFixed(1)}%`);
  }
  
  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(80));
  console.log("🚀 NULL-RPC COMPREHENSIVE LOAD TEST");
  console.log("═".repeat(80));
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`RPC Methods: ${RPC_CALLS.length}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log("");

  // Setup
  console.log("📋 Setup: Using manual test users (ensure they exist in DB)...");
  // We assume users are already created via SQL
  // (admin endpoints were removed)

  const results: { test: string; passed: boolean }[] = [];

  // Section 1: Public Tier
  console.log("\n" + "─".repeat(80));
  console.log("SECTION 1: PUBLIC TIER RATE LIMITING");
  console.log("─".repeat(80));
  
  const publicTest = await testTierRateLimit(null, "public", 3);
  results.push({ test: "Public Tier Rate Limit", passed: publicTest.passed });

  // Section 2: User Tiers
  console.log("\n" + "─".repeat(80));
  console.log("SECTION 2: USER TIER RATE LIMITING");
  console.log("─".repeat(80));
  
  const hobbyistTest = await testTierRateLimit(PLANS.hobbyist, "hobbyist", 3);
  results.push({ test: "Hobbyist Rate Limit", passed: hobbyistTest.passed });
  
  const scalingTest = await testTierRateLimit(PLANS.scaling, "scaling", 3);
  results.push({ test: "Scaling Rate Limit", passed: scalingTest.passed });

  const businessTest = await testBusinessThroughput();
  results.push({ test: "Business Tier (Sustained + Burst)", passed: businessTest.passed });
  
  const enterpriseTest = await testTierRateLimit(PLANS.enterprise, "enterprise", 10);
  results.push({ test: "Enterprise (No Limits)", passed: enterpriseTest.passed });

  // Section 3: Cache Detection
  console.log("\n" + "─".repeat(80));
  console.log("SECTION 3: CACHE DETECTION (Parameter-Aware)");
  console.log("─".repeat(80));
  
  await runCacheDetectionSuite(PLANS.enterprise);

  // Section 4: Complex Workload
  console.log("\n" + "─".repeat(80));
  console.log("SECTION 4: COMPLEX WORKLOAD (DeFi Pattern)");
  console.log("─".repeat(80));
  
  await runComplexWorkloadTest(PLANS.enterprise);

  // Section 5: Heavy Mixed Workload
  console.log("\n" + "─".repeat(80));
  console.log("SECTION 5: HEAVY MIXED WORKLOAD");
  console.log("─".repeat(80));
  
  await runHeavyMixedWorkload(PLANS.enterprise);

  // Final Summary
  console.log("\n" + "═".repeat(80));
  console.log("📊 FINAL TEST RESULTS");
  console.log("═".repeat(80));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  for (const r of results) {
    console.log(`   ${r.passed ? "✅" : "❌"} ${r.test}`);
  }
  
  console.log("");
  console.log(`   Total: ${passed} passed, ${failed} failed`);
  console.log("");
  
  if (failed === 0) {
    console.log("🎉 ALL TESTS PASSED!");
  } else {
    console.log("⚠️  SOME TESTS FAILED - Review output above");
    console.log("   Note: Public tier requires Cloudflare Remote Rate Limiter (production only)");
    console.log("   Note: Cache headers may not work in local dev (Cloudflare Cache API)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
