import { ETH_NODES, PUBLIC_ETH_NODES } from './chains'

export type ChainId = 'eth'

export const PUBLIC_NODES: Record<ChainId, string[]> = {
  eth: PUBLIC_ETH_NODES
}

export const CHAIN_NODES: Record<ChainId, string[]> = {
  eth: ETH_NODES
}

export const MEV_PROTECTION: Record<ChainId, string> = {
  eth: 'https://rpc.mevblocker.io/fullprivacy'
}
