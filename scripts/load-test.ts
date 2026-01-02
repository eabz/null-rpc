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

  // Account State (Balances, Code, Nonce)
  SOME_ADDRESSES.forEach(addr => {
    calls.push({ 
      method: "eth_getBalance", 
      params: [addr, "latest"], 
      cache: "volatile", 
      desc: `Bal ${addr.slice(0,6)}` 
    });
    calls.push({ 
      method: "eth_getCode", 
      params: [addr, "latest"], 
      cache: "volatile", // Code *can* change if contract redeployed, but rare. effectively static.
      desc: `Code ${addr.slice(0,6)}` 
    });
    calls.push({ 
      method: "eth_getTransactionCount", 
      params: [addr, "latest"], 
      cache: "never", 
      desc: `Nonce ${addr.slice(0,6)}` 
    });
  });

  // Volatile / Network Status
  calls.push({ method: "eth_blockNumber", params: [], cache: "volatile", desc: "Block Number" });
  calls.push({ method: "eth_gasPrice", params: [], cache: "volatile", desc: "Gas Price" });
  calls.push({ method: "eth_maxPriorityFeePerGas", params: [], cache: "volatile", desc: "Priority Fee" });
  
  // Fee History (last 5 blocks)
  calls.push({ 
    method: "eth_feeHistory", 
    params: ["0x5", "latest", []], 
    cache: "volatile", 
    desc: "Fee History" 
  });

  // Estimate Gas (simple transfer)
  calls.push({ 
    method: "eth_estimateGas", 
    params: [{ to: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }], 
    cache: "volatile", 
    desc: "Est Gas" 
  });

  // Smart Contract Calls (eth_call)
  // WETH Balance of Vitalik
  const wethAddr = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const vitalikAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  // balanceOf(address) = 0x70a08231 + 32-byte padded address
  const data = "0x70a08231000000000000000000000000" + vitalikAddr.slice(2).toLowerCase();
  
  calls.push({
    method: "eth_call",
    params: [{ to: wethAddr, data: data }, "latest"],
    cache: "volatile",
    desc: "eth_call (WETH Bal)"
  });

  // Archive / Historical Calls
  calls.push({
    method: "eth_getBalance",
    params: [vitalikAddr, "0x10"], // Block 16 (very old)
    cache: "static", // Immutable
    desc: "Archive: Bal @ Blk 16"
  });
  
  calls.push({
    method: "eth_getCode",
    params: [wethAddr, "0x493E0"], // Block 300,000
    cache: "static", // Immutable
    desc: "Archive: Code @ 300k"
  });

  // ERC20 Standard Calls (DeFi)
  const ERC20_TOKENS = [
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
  ];

  ERC20_TOKENS.forEach(token => {
    // decimals() = 0x313ce567
    calls.push({
      method: "eth_call",
      params: [{ to: token, data: "0x313ce567" }, "latest"],
      cache: "static", // static because decimals don't change
      desc: `ERC20 Decimals ${token.slice(0,6)}`
    });
    // symbol() = 0x95d89b41
    calls.push({
      method: "eth_call",
      params: [{ to: token, data: "0x95d89b41" }, "latest"],
      cache: "static", 
      desc: `ERC20 Symbol ${token.slice(0,6)}`
    });
  });

  // NFT Standard Calls (DeFi/NFT)
  const NFT_TOKENS = [
    "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", // BAYC
    "0xED5AF388653567Af2F388E6224dC7C4b3241C544", // Azuki
  ];

  NFT_TOKENS.forEach(nft => {
    // ownerOf(1) = 0x6352211e + padded(1)
    const tokenId1 = "0000000000000000000000000000000000000000000000000000000000000001";
    calls.push({
      method: "eth_call",
      params: [{ to: nft, data: "0x6352211e" + tokenId1 }, "latest"],
      cache: "volatile", // owner changes
      desc: `NFT OwnerOf(1) ${nft.slice(0,6)}`
    });
    // tokenURI(1) = 0xc87b56dd + padded(1)
    calls.push({
      method: "eth_call",
      params: [{ to: nft, data: "0xc87b56dd" + tokenId1 }, "latest"],
      cache: "static", // URI usually static
      desc: `NFT URI(1) ${nft.slice(0,6)}`
    });
  });

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

  await runRateLimitedTest(500, 20); // 100 RPS for 60 seconds
}

main().catch(console.error);
