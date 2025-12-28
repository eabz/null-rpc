export type ChainId = 'eth'

export const CHAIN_NODES: Record<ChainId, string[]> = {
  eth: [
    'https://eth.llamarpc.com',
    'https://eth.blockrazor.xyz',
    'https://eth-mainnet.nodereal.io/v1/1659dfb40aa24bbb8153a677b98064d7',
    'https://1rpc.io/eth',
    'https://rpc.mevblocker.io',
    'https://rpc.flashbots.net',
    'https://cloudflare-eth.com',
    'https://singapore.rpc.blxrbdn.com',
    'https://ethereum-rpc.publicnode.com',
    'https://singapore.rpc.blxrbdn.com',
    'https://eth.rpc.blxrbdn.com',
    'https://eth-mainnet.public.blastapi.io',
    'https://eth-mainnet.rpcfast.com?api_key=xbhWBI1Wkguk8SNMu1bvvLurPGLXmgwYeC4S6g2H7WdwFigZSmPWVZRxrskEQwIf',
    'https://eth.meowrpc.com',
    'https://ethereum-mainnet.gateway.tatum.io'
  ]
}

export const MEV_PROTECTION: Record<ChainId, string> = {
  eth: 'https://rpc.mevblocker.io/fullprivacy'
}
