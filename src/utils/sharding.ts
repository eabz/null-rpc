export const SHARD_COUNT = 16

/**
 * Computes a deterministic shard ID for a given user token.
 * Uses a simple hash function to distribute tokens across SHARD_COUNT shards.
 */
export function getShardId(token: string): string {
  let hash = 0
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32bit integer
  }

  // Normalize to positive integer and mod by shard count
  const shardIndex = Math.abs(hash) % SHARD_COUNT
  return `registry_shard_${shardIndex}`
}
