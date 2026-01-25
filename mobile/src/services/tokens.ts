// Token account fetching service
import { SOLANA_RPC_URL } from '../constants/solana';

export interface TokenAccount {
  mint: string;
  amount: number;
  decimals: number;
  symbol?: string;
  name?: string;
}

// Get all token accounts for an address
export async function getTokenAccounts(address: string): Promise<TokenAccount[]> {
  try {
    const response = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, // SPL Token program
          { encoding: 'jsonParsed' },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) {
      console.error('RPC error getting token accounts:', data.error);
      return [];
    }

    const accounts = data.result?.value || [];
    const tokens: TokenAccount[] = [];

    for (const account of accounts) {
      const parsed = account.account?.data?.parsed?.info;
      if (!parsed) continue;

      const tokenAmount = parsed.tokenAmount;
      if (!tokenAmount || tokenAmount.uiAmount === null || tokenAmount.uiAmount === 0) {
        continue; // Skip zero balances
      }

      const mint = parsed.mint;
      tokens.push({
        mint,
        amount: tokenAmount.uiAmount || 0,
        decimals: tokenAmount.decimals || 0,
      });
    }

    // Also check for SOL balance
    const solResponse = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
    });

    const solData = await solResponse.json();
    if (!solData.error && solData.result?.value > 0) {
      tokens.unshift({
        mint: 'So11111111111111111111111111111111111111112', // SOL mint
        amount: solData.result.value / 1e9,
        decimals: 9,
        symbol: 'SOL',
        name: 'Solana',
      });
    }

    return tokens;
  } catch (error) {
    console.error('Error fetching token accounts:', error);
    return [];
  }
}
