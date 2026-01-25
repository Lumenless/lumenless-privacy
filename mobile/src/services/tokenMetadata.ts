// Token metadata fetching service
// Uses Jupiter token list API for common tokens, falls back to mint address

const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/strict';
const SOLANA_TOKEN_LIST_URL = 'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json';

interface TokenListToken {
  address: string;
  symbol?: string;
  name?: string;
  logoURI?: string;
  decimals?: number;
}

interface TokenList {
  tokens: TokenListToken[];
}

// Cache for token metadata
const tokenMetadataCache: Map<string, { symbol?: string; name?: string; logoURI?: string }> = new Map();
let tokenListCache: TokenList | null = null;

// Well-known tokens (fallback for common tokens)
const WELL_KNOWN_TOKENS: Record<string, { symbol: string; name: string; logoURI?: string }> = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'SOL',
    name: 'Solana',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    symbol: 'USDC',
    name: 'USD Coin',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    symbol: 'USDT',
    name: 'Tether',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': {
    symbol: 'mSOL',
    name: 'Marinade SOL',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png',
  },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': {
    symbol: 'ETH',
    name: 'Ethereum (Wormhole)',
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png',
  },
};

// Load token list from Jupiter
async function loadTokenList(): Promise<TokenList | null> {
  if (tokenListCache) {
    return tokenListCache;
  }

  try {
    console.log('[TokenMetadata] Loading token list from Jupiter...');
    const response = await fetch(JUPITER_TOKEN_LIST_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn('[TokenMetadata] Jupiter token list failed, trying Solana official list...');
      // Fallback to Solana official list
      const solanaResponse = await fetch(SOLANA_TOKEN_LIST_URL);
      if (!solanaResponse.ok) {
        throw new Error('Both token lists failed');
      }
      const data = await solanaResponse.json();
      tokenListCache = data;
      return tokenListCache;
    }

    const data = await response.json();
    tokenListCache = data;
    console.log(`[TokenMetadata] Loaded ${data.tokens?.length || 0} tokens from Jupiter`);
    return tokenListCache;
  } catch (error: any) {
    console.error('[TokenMetadata] Error loading token list:', error?.message || error);
    return null;
  }
}

// Get token metadata for a mint address
export async function getTokenMetadata(mint: string): Promise<{ symbol?: string; name?: string; logoURI?: string }> {
  // Check cache first
  if (tokenMetadataCache.has(mint)) {
    return tokenMetadataCache.get(mint)!;
  }

  // Check well-known tokens
  if (WELL_KNOWN_TOKENS[mint]) {
    const metadata = WELL_KNOWN_TOKENS[mint];
    tokenMetadataCache.set(mint, metadata);
    return metadata;
  }

  // Load token list and search
  const tokenList = await loadTokenList();
  if (tokenList?.tokens) {
    const token = tokenList.tokens.find(t => t.address === mint);
    if (token) {
      const metadata = {
        symbol: token.symbol,
        name: token.name,
        logoURI: token.logoURI,
      };
      tokenMetadataCache.set(mint, metadata);
      return metadata;
    }
  }

  // No metadata found - return empty
  const empty = {};
  tokenMetadataCache.set(mint, empty);
  return empty;
}

// Batch get token metadata for multiple mints
export async function getTokenMetadataBatch(mints: string[]): Promise<Map<string, { symbol?: string; name?: string; logoURI?: string }>> {
  const results = new Map<string, { symbol?: string; name?: string; logoURI?: string }>();

  // Check cache and well-known tokens first
  for (const mint of mints) {
    if (tokenMetadataCache.has(mint)) {
      results.set(mint, tokenMetadataCache.get(mint)!);
    } else if (WELL_KNOWN_TOKENS[mint]) {
      const metadata = WELL_KNOWN_TOKENS[mint];
      tokenMetadataCache.set(mint, metadata);
      results.set(mint, metadata);
    }
  }

  // Load token list for remaining tokens
  const remainingMints = mints.filter(m => !results.has(m));
  if (remainingMints.length > 0) {
    const tokenList = await loadTokenList();
    if (tokenList?.tokens) {
      for (const mint of remainingMints) {
        const token = tokenList.tokens.find(t => t.address === mint);
        if (token) {
          const metadata = {
            symbol: token.symbol,
            name: token.name,
            logoURI: token.logoURI,
          };
          tokenMetadataCache.set(mint, metadata);
          results.set(mint, metadata);
        } else {
          // Not found - cache empty result
          const empty = {};
          tokenMetadataCache.set(mint, empty);
          results.set(mint, empty);
        }
      }
    } else {
      // Token list failed - cache empty results
      for (const mint of remainingMints) {
        const empty = {};
        tokenMetadataCache.set(mint, empty);
        results.set(mint, empty);
      }
    }
  }

  return results;
}
