
import { sleep } from "bun";

const TARGET_URL = process.env.TARGET_URL || "http://localhost:8787";

const PLANS = {
  hobbyist: "test_hobbyist",
  scaling: "test_scaling",
  business: "test_business",
  enterprise: "test_enterprise",
} as const;

async function setupUser(token: string, plan: string) {
  const params = new URLSearchParams({ token, plan });
  const response = await fetch(`${TARGET_URL}/admin/force-plan?${params}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Failed to set plan for ${token}: ${await response.text()}`);
  }
  console.log(`[Setup] User ${token} set to ${plan}`);
}

async function runBatchTest(token: string, requestsPerBatch: number, batchCount: number) {
  let successes = 0;
  let limited = 0;
  let errors = 0;
  const startTime = Date.now();

  const makeBatch = () => {
    return Array.from({ length: requestsPerBatch }).map((_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "eth_blockNumber",
      params: [],
    }));
  };

  for (let i = 0; i < batchCount; i++) {
    const batch = makeBatch();
    try {
      const response = await fetch(`${TARGET_URL}/eth/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });

      if (response.status === 200) {
        successes++;
      } else if (response.status === 429) {
        limited++;
      } else {
        errors++;
      }
    } catch (e) {
      errors++;
    }
  }

  const duration = Date.now() - startTime;
  return { successes, limited, errors, duration };
}

async function runCacheTest(token: string, iterations: number) {
  let hits = 0;
  let misses = 0;
  let totalLatency = 0;

  // Cacheable request
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId", // Should be cached (long TTL)
    params: [],
  };

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const response = await fetch(`${TARGET_URL}/eth/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const lat = Date.now() - start;
    totalLatency += lat;

    const cacheHeader = response.headers.get("X-NullRPC-Cache");
    if (cacheHeader === "HIT") {
      hits++;
    } else {
      misses++;
    }
    
    // Tiny sleep to yield
    await sleep(10);
  }

  return { hits, misses, avgLatency: totalLatency / iterations };
}

async function main() {
  console.log("🚀 Starting Load Test...");
  console.log(`Target: ${TARGET_URL}`);

  // 1. Setup Users
  console.log("\n--- Phase 1: Setting up Users ---");
  for (const [plan, token] of Object.entries(PLANS)) {
    await setupUser(token, plan);
  }

  // 2. Rate Limit Test
  console.log("\n--- Phase 2: Rate Limit Verifications ---");
  
  // Hobbyist: 10 RPS. We send 5 batches of 5 = 25 requests very fast.
  console.log("Testing Hobbyist (Limit: 10 RPS)...");
  const hobbyistResult = await runBatchTest(PLANS.hobbyist, 5, 5); 
  console.log(`Hobbyist Result: ${JSON.stringify(hobbyistResult)}`);
  if (hobbyistResult.limited > 0) {
    console.log("✅ Hobbyist correctly rate limited.");
  } else {
    console.log("❌ Hobbyist was NOT rate limited (investigate burst allowance).");
  }

  // Enterprise: Unlimited. We send 20 batches of 10 = 200 requests.
  console.log("Testing Enterprise (Unlimited)...");
  const enterpriseResult = await runBatchTest(PLANS.enterprise, 10, 20);
  console.log(`Enterprise Result: ${JSON.stringify(enterpriseResult)}`);
  if (enterpriseResult.limited === 0) {
    console.log("✅ Enterprise pass through.");
  } else {
    console.log("❌ Enterprise WAS rate limited.");
  }

  // 3. Cache Test
  console.log("\n--- Phase 3: Cache Performance ---");
  // Warmup first
  await fetch(`${TARGET_URL}/eth/${PLANS.enterprise}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_chainId", params: []})
  });

  const cacheResult = await runCacheTest(PLANS.enterprise, 50);
  console.log(`Cache Result: ${JSON.stringify(cacheResult)}`);
  if (cacheResult.hits > 0) {
    console.log("✅ Cache Hits detected.");
  } else {
    console.log("❌ No Cache Hits (check handlers or cache mechanics).");
  }

  console.log("\nLoad Test Complete.");
}

main().catch(console.error);
