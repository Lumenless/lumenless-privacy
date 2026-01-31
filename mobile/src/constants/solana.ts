// Solana network configuration

export const SOLANA_RPC_URL = 'https://melitta-xw3ac1-fast-mainnet.helius-rpc.com';
export const FALLBACK_RPC_URL = 'https://api.mainnet-beta.solana.com';

export const SOLANA_NETWORK = 'mainnet-beta';

// Mints that can be claimed into PrivacyCash (SOL, USDC, USDT only)
export const PRIVACYCASH_CLAIMABLE_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;

export const PRIVACYCASH_CLAIMABLE_MINT_LIST = Object.values(PRIVACYCASH_CLAIMABLE_MINTS);
