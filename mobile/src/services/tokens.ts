// Token account fetching service
import { address } from '@solana/kit';
import { SOLANA_RPC_URL, FALLBACK_RPC_URL } from '../constants/solana';
import { getTokenMetadataBatch } from './tokenMetadata';

export interface TokenAccount {
  mint: string;
  amount: number;
  decimals: number;
  symbol?: string;
  name?: string;
  logoURI?: string;
}

// Helper to make RPC request with timeout and fallback (same as balances.ts)
async function rpcRequest(url: string, body: any, timeout = 15000, useFallback = true): Promise<any> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    };
    
    if (controller) {
      fetchOptions.signal = controller.signal;
    }

    const response = await fetch(url, fetchOptions);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    let jsonData;
    try {
      jsonData = JSON.parse(responseText);
    } catch (parseError: any) {
      throw new Error(`Failed to parse JSON response: ${parseError?.message || parseError}`);
    }
    
    if (jsonData.error) {
      throw new Error(`RPC error: ${JSON.stringify(jsonData.error)}`);
    }
    
    return jsonData;
  } catch (error: any) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    if (error?.name === 'AbortError' || error?.message?.includes('timeout')) {
      if (useFallback) {
        return rpcRequest(FALLBACK_RPC_URL, body, timeout, false);
      }
      throw new Error('Request timeout');
    }
    
    if (useFallback) {
      return rpcRequest(FALLBACK_RPC_URL, body, timeout, false);
    }
    
    throw error;
  }
}

// Get all token accounts for an address
export async function getTokenAccounts(addressStr: string): Promise<TokenAccount[]> {
  try {
    const addr = String(address(addressStr));
    
    const data = await rpcRequest(SOLANA_RPC_URL, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        addr,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, // SPL Token program
        { encoding: 'jsonParsed' },
      ],
    });

    const accounts = data.result?.value || [];
    const tokens: TokenAccount[] = [];
    const mints: string[] = [];

    for (const account of accounts) {
      const parsed = account.account?.data?.parsed?.info;
      if (!parsed) continue;

      const tokenAmount = parsed.tokenAmount;
      if (!tokenAmount || tokenAmount.uiAmount === null || tokenAmount.uiAmount === 0) {
        continue; // Skip zero balances
      }

      const mint = parsed.mint;
      mints.push(mint);
      tokens.push({
        mint,
        amount: tokenAmount.uiAmount || 0,
        decimals: tokenAmount.decimals || 0,
      });
    }

    // Fetch token metadata for all tokens
    if (mints.length > 0) {
      try {
        const metadataMap = await getTokenMetadataBatch(mints);
        tokens.forEach(token => {
          const metadata = metadataMap.get(token.mint);
          if (metadata) {
            token.symbol = metadata.symbol;
            token.name = metadata.name;
            token.logoURI = metadata.logoURI;
          }
        });
      } catch (error) {
        console.error('[Tokens] Error fetching token metadata:', error);
      }
    }

    // Also check for SOL balance
    try {
      const solData = await rpcRequest(SOLANA_RPC_URL, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [addr],
      });

      if (solData.result?.value > 0) {
        const solMint = 'So11111111111111111111111111111111111111112';
        // Get SOL metadata (includes logoURI)
        const solMetadata = await getTokenMetadataBatch([solMint]);
        const solMeta = solMetadata.get(solMint);
        
        tokens.unshift({
          mint: solMint,
          amount: solData.result.value / 1e9,
          decimals: 9,
          symbol: 'SOL',
          name: 'Solana',
          logoURI: solMeta?.logoURI,
        });
      }
    } catch (error) {
      console.error('[Tokens] Error fetching SOL balance:', error);
    }

    return tokens;
  } catch (error) {
    console.error('Error fetching token accounts:', error);
    return [];
  }
}
