import { sleep } from "bun";

const TARGET_URL = "https://nullrpc.dev/"

// Cache categories matching cache.ts logic
type CacheCategory = "static" | "volatile" | "dynamic" | "never";

interface RpcCall {
  method: string;
  params: unknown[];
  cache: CacheCategory;
  desc: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

const SOME_ADDRESSES = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // Vitalik
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
  "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", // UNI
  "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK
  "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0", // MATIC
  "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", // SHIB
];

const SOME_BLOCKS = [
  "0x10d4f", "0x11111", "0x12345", "0x20000", "0x54321", 
  "0xABCDE", "0xF0000", "0x100000", "0x200000", "0x300000"
];

const SOME_TXS = [
  "0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b",
  "0xdc0818cf78f21a8e70579cb46a43643f78291264dda342ae31049421c82d21ae",
  // Add some more random hashes if needed, but these are for static lookups
];

function generateRpcCalls(): RpcCall[] {
  const calls: RpcCall[] = [];

  // 1. Static Calls (High Volume possible because they should hit cache 100%)
  // -----------------------------------------------------------------------
  
  // Chain/Net versions
  calls.push({ method: "eth_chainId", params: [], cache: "static", desc: "Chain ID" });
  calls.push({ method: "net_version", params: [], cache: "static", desc: "Net Version" });
  calls.push({ method: "web3_clientVersion", params: [], cache: "static", desc: "Client Version" });

  // Get Block By Number (Static - old blocks)
  SOME_BLOCKS.forEach(block => {
    calls.push({ 
      method: "eth_getBlockByNumber", 
      params: [block, false], 
      cache: "static", 
      desc: `Block ${block}` 
    });
  });

  // Get Transaction By Hash (Static)
  SOME_TXS.forEach(tx => {
    calls.push({
      method: "eth_getTransactionByHash",
      params: [tx],
      cache: "static",
      desc: `Tx ${tx.slice(0, 10)}...`
    });
    calls.push({
      method: "eth_getTransactionReceipt",
      params: [tx],
      cache: "static",
      desc: `Receipt ${tx.slice(0, 10)}...`
    });
  });

  // 2. Dynamic Calls (Parameter specific)
  // -----------------------------------------------------------------------
  
  // Balance at specific blocks
  SOME_ADDRESSES.forEach((addr, i) => {
    // Mix addresses with blocks
    const block = SOME_BLOCKS[i % SOME_BLOCKS.length];
    calls.push({
      method: "eth_getBalance",
      params: [addr, block],
      cache: "dynamic",
      desc: `Balance ${addr.slice(0,6)} @ ${block}`
    });
  });

  // 3. Volatile Calls (Should refresh often)
  // -----------------------------------------------------------------------
  calls.push({ method: "eth_blockNumber", params: [], cache: "volatile", desc: "Block Number" });
  calls.push({ method: "eth_gasPrice", params: [], cache: "volatile", desc: "Gas Price" });
  calls.push({ method: "eth_maxPriorityFeePerGas", params: [], cache: "volatile", desc: "Priority Fee" });
  
  SOME_ADDRESSES.forEach(addr => {
    calls.push({
      method: "eth_getBalance",
      params: [addr, "latest"],
      cache: "volatile",
      desc: `Balance ${addr.slice(0,6)} @ latest`
    });
    calls.push({
      method: "eth_getTransactionCount",
      params: [addr, "latest"],
      cache: "never", // Critical
      desc: `Nonce ${addr.slice(0,6)}`
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
  trackCache = false,
  verboseError = false
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
      if (verboseError) {
        console.log(`HTTP Error ${res.status}: ${await res.text()}`);
      }
      return;
    }

    // Parse and validate JSON-RPC response
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      stats.errors++;
      if (verboseError) {
        console.log(`Invalid JSON response for ${method}`);
      }
      return;
    }

    // Validate JSON-RPC structure
    const rpcResponse = body as { 
      jsonrpc?: string; 
      id?: number; 
      result?: unknown; 
      error?: { code?: number; message?: string } 
    };

    // Check jsonrpc version
    if (rpcResponse.jsonrpc !== "2.0") {
      stats.errors++;
      if (verboseError) {
        console.log(`Invalid jsonrpc version for ${method}: ${rpcResponse.jsonrpc}`);
      }
      return;
    }

    // Check for RPC error (these are valid responses, but indicate upstream issues)
    if (rpcResponse.error) {
      stats.errors++;
      if (verboseError) {
        console.log(`RPC Error for ${method}: ${rpcResponse.error.code} - ${rpcResponse.error.message}`);
      }
      return;
    }

    // Check that we got a result (null is valid for some methods)
    if (!("result" in rpcResponse)) {
      stats.errors++;
      if (verboseError) {
        console.log(`No result field for ${method}`);
      }
      return;
    }

    // Valid response!
    stats.success++;
    
    if (trackCache) {
      const cacheHeader = res.headers.get("X-NullRPC-Cache");
      if (cacheHeader === "HIT") stats.cacheHits++;
      else stats.cacheMisses++;
    }
  } catch (e) {
    stats.errors++;
    if (verboseError) console.error(`Network error for ${method}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW: MASS DATA TEST
// ═══════════════════════════════════════════════════════════════════════════

async function runMassDataTest(chain: string = "eth"): Promise<TestStats> {
  console.log(`\n🌊 MASS DATA & UPSTREAM SAFETY TEST`);
  console.log(`   Detailed check to ensure high-volume static calls stay cached`);
  console.log(`   and do NOT hit upstream rate limits.\n`);

  const endpoint = `${TARGET_URL}/${chain}`;
  const stats = createStats();
  
  // 1. Warmup - Send one of each static call to populate cache
  console.log(`   🔥 Warming up cache with ${RPC_CALLS.length} unique calls...`);
  for (const call of RPC_CALLS) {
    if (call.cache === "static" || call.cache === "dynamic") {
      await makeRpcRequest(endpoint, call.method, call.params, stats, true);
    }
  }
  
  // 2. Blast - Send high volume of mixed calls
  const durationSecs = 20;
  const concurrency = 200; // Very high concurrency
  const targetRps = 2000;  // Try to hit 2000 RPS
  
  console.log(`   🚀 BLASTING: ${concurrency} concurrent workers for ${durationSecs}s`);
  console.log(`   Goal: ${targetRps} RPS (Expect mostly Cache Hits)`);
  
  const startTime = Date.now();
  const endTime = startTime + durationSecs * 1000;
  
  const workers = Array(concurrency).fill(null).map(async (_, workerId) => {
    while (Date.now() < endTime) {
      // Pick random call
      const call = RPC_CALLS[Math.floor(Math.random() * RPC_CALLS.length)];
      await makeRpcRequest(endpoint, call.method, call.params, stats, true);
      // Small sleep to control rate if needed, but we want max load
      await sleep(5); 
    }
  });
  
  await Promise.all(workers);
  
  const elapsed = (Date.now() - startTime) / 1000;
  const total = stats.success + stats.limited + stats.errors;
  const rps = total / elapsed;
  
  console.log(`\n   ${formatStats(stats)}`);
  console.log(`   ⏱️  Elapsed: ${elapsed.toFixed(1)}s | Actual RPS: ${rps.toFixed(0)}`);
  
  const hitRate = stats.cacheHits / (stats.cacheHits + stats.cacheMisses);
  console.log(`   🎯 Cache Hit Rate: ${(hitRate * 100).toFixed(1)}%`);
  
  // VERIFICATION
  if (stats.errors > 0 || stats.limited > 0) {
     console.log(`   ⚠️  WARNING: Encountered errors or rate limits!`);
     // Check if errors are upstream 429s? (Hard to distinguish from local 429s without body inspection, 
     // but local limit is 5000 now, so 429s are likely bad if Rps < 5000)
  } else {
     console.log(`   ✅ SUCCESS: No errors or rate limits under heavy load.`);
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(80));
  console.log("🚀 NULL-RPC ULTRA LOAD TEST");
  console.log("═".repeat(80));
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Method Count: ${RPC_CALLS.length}`);
  console.log("");

  // Check connection first
  try {
    const res = await fetch(`${TARGET_URL}/eth`, { method: "POST", body: JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]})});
    if (!res.ok) throw new Error("Status " + res.status);
    console.log("✅ Connection established!");
  } catch (e) {
    console.error(`❌ FATAL: Cannot connect to ${TARGET_URL}.`);
    console.error(`   Make sure 'bun run dev' is running in another terminal!`);
    console.error(`   If running on a different port, set TARGET_URL env var.`);
    process.exit(1);
  }

  await runMassDataTest("eth");
}

main().catch(console.error);
