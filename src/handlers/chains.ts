import { createRawJsonResponse } from '@/utils'

interface ChainStats {
  slug: string
  name: string
  icon: string | null
  chainId: number
  nodes: number
  archiveNodes: number
  mevNodes: number
  updatedAt: number
}

export async function handleChains(env: Env): Promise<Response> {
  try {
    const results = await env.DB.prepare(
      `SELECT slug, name, icon, chainId, nodes, archive_nodes, mev_protection, updated_at FROM chains ORDER BY chainId`
    ).all()

    const chains: ChainStats[] = results.results.map((row) => {
      const nodes = row.nodes ? JSON.parse(row.nodes as string) : []
      const archiveNodes = row.archive_nodes ? JSON.parse(row.archive_nodes as string) : []
      const mevNodes = row.mev_protection ? JSON.parse(row.mev_protection as string) : []

      // Construct icon URL from icon name (using llamao.fi CDN)
      const iconName = row.icon as string | null
      const iconUrl = iconName ? `https://icons.llamao.fi/icons/chains/rsz_${iconName}.jpg` : null

      return {
        slug: row.slug as string,
        name: (row.name as string) || (row.slug as string),
        icon: iconUrl,
        chainId: row.chainId as number,
        nodes: nodes.length,
        archiveNodes: archiveNodes.length,
        mevNodes: mevNodes.length,
        updatedAt: row.updated_at as number
      }
    })

    return createRawJsonResponse(
      JSON.stringify({
        chains,
        totalChains: chains.length,
        totalNodes: chains.reduce((sum, c) => sum + c.nodes, 0),
        totalArchiveNodes: chains.reduce((sum, c) => sum + c.archiveNodes, 0)
      })
    )
  } catch (error) {
    return createRawJsonResponse(JSON.stringify({ error: 'Failed to fetch chain data' }), 500)
  }
}
