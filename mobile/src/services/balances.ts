// Balance fetching service for Solana wallets
import { address } from '@solana/kit';
import { SOLANA_RPC_URL, FALLBACK_RPC_URL } from '../constants/solana';

// USDC mint address on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Helper to make RPC request with timeout and fallback
async function rpcRequest(url: string, body: any, timeout = 15000, useFallback = true): Promise<any> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    console.log(`[RPC] Making request to ${url}`);
    console.log(`[RPC] Method: ${body.method}, Params:`, JSON.stringify(body.params));
    
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
    
    console.log(`[RPC] Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[RPC] HTTP error response:`, errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    console.log(`[RPC] Response received, length: ${responseText.length}`);
    
    let jsonData;
    try {
      jsonData = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error(`[RPC] JSON parse error:`, parseError);
      console.error(`[RPC] Response text (first 500 chars):`, responseText.substring(0, 500));
      throw new Error(`Failed to parse JSON response: ${parseError?.message || parseError}`);
    }
    
    if (jsonData.error) {
      console.error(`[RPC] RPC error:`, jsonData.error);
      throw new Error(`RPC error: ${JSON.stringify(jsonData.error)}`);
    }
    
    console.log(`[RPC] Request successful`);
    return jsonData;
  } catch (error: any) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    const errorMessage = error?.message || String(error);
    console.error(`[RPC] Request error to ${url}:`, errorMessage);
    console.error(`[RPC] Error type:`, error?.constructor?.name);
    console.error(`[RPC] Error name:`, error?.name);
    
    if (error?.name === 'AbortError' || errorMessage.includes('timeout')) {
      const timeoutError = new Error('Request timeout');
      if (useFallback) {
        console.log(`[RPC] Timeout, trying fallback RPC`);
        return rpcRequest(FALLBACK_RPC_URL, body, timeout, false);
      }
      throw timeoutError;
    }
    
    // If primary RPC fails and we haven't tried fallback, try fallback
    if (useFallback && !errorMessage.includes('timeout')) {
      console.log(`[RPC] Primary RPC failed, trying fallback: ${errorMessage}`);
      return rpcRequest(FALLBACK_RPC_URL, body, timeout, false);
    }
    
    throw error;
  }
}

export interface WalletBalances {
  sol: number;
  usdc: number;
}

// Get SOL balance for an address
async function getSolBalance(addressStr: string): Promise<number> {
  try {
    console.log(`[SOL] Fetching balance for ${addressStr}`);
    
    // Validate address format using @solana/kit
    const addr = address(addressStr);
    const addressBase58 = String(addr);
    
    const requestBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [addressBase58],
    };
    
    const data = await rpcRequest(SOLANA_RPC_URL, requestBody);

    const lamports = data.result?.value || 0;
    const sol = lamports / 1e9;
    
    console.log(`[SOL] Balance for ${addressStr}: ${lamports} lamports = ${sol} SOL`);

    return sol;
  } catch (error: any) {
    console.error(`[SOL] Error fetching balance for ${addressStr}:`, error?.message || error);
    return 0;
  }
}

// Parse token amount from account data
function parseTokenAmount(tokenAmount: any): number {
  if (!tokenAmount) return 0;

  // Prefer uiAmountString (recommended), fallback to uiAmount, then calculate from amount
  if (tokenAmount.uiAmountString) {
    return parseFloat(tokenAmount.uiAmountString);
  }
  
  if (tokenAmount.uiAmount !== null && tokenAmount.uiAmount !== undefined) {
    return tokenAmount.uiAmount;
  }
  
  if (tokenAmount.amount) {
    // Fallback: calculate from raw amount
    const decimals = tokenAmount.decimals || 0;
    const rawAmount = typeof tokenAmount.amount === 'string' 
      ? parseInt(tokenAmount.amount, 10) 
      : tokenAmount.amount;
    return rawAmount / Math.pow(10, decimals);
  }

  return 0;
}

// Get token balance for a specific mint address
export async function getTokenBalance(walletAddress: string, mint: string): Promise<number> {
  try {
    console.log(`[Token] Fetching balance for ${walletAddress}, mint: ${mint}`);
    
    // Validate addresses using @solana/kit
    const walletAddr = String(address(walletAddress));
    const mintAddr = String(address(mint));
    
    // Try method 1: getTokenAccountsByOwner with mint filter
    const requestBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        walletAddr,
        { mint: mintAddr },
        { encoding: 'jsonParsed' },
      ],
    };
    
    const data = await rpcRequest(SOLANA_RPC_URL, requestBody);

    const accounts = data.result?.value || [];
    if (accounts.length === 0) {
      console.log(`[Token] No token accounts found for ${walletAddress}, mint ${mint}, trying alternative method`);
      return await getTokenBalanceAlternative(walletAddress, mint);
    }

    // With jsonParsed encoding, the balance is in the account data
    const accountData = accounts[0].account?.data?.parsed?.info;
    if (!accountData) {
      console.log(`[Token] No account data for ${walletAddress}, mint ${mint}`, accounts[0]);
      return await getTokenBalanceAlternative(walletAddress, mint);
    }

    const tokenAmount = accountData.tokenAmount;
    if (!tokenAmount) {
      console.log(`[Token] No tokenAmount for ${walletAddress}, mint ${mint}`, accountData);
      return await getTokenBalanceAlternative(walletAddress, mint);
    }

    const balance = parseTokenAmount(tokenAmount);

    console.log(`[Token] Balance for ${walletAddress}, mint ${mint}:`, {
      uiAmountString: tokenAmount.uiAmountString,
      uiAmount: tokenAmount.uiAmount,
      amount: tokenAmount.amount,
      decimals: tokenAmount.decimals,
      calculated: balance,
    });

    return balance;
  } catch (error: any) {
    console.error(`[Token] Error fetching balance for ${walletAddress}, mint ${mint}:`, error?.message || error);
    // Try alternative method on error
    return await getTokenBalanceAlternative(walletAddress, mint);
  }
}

// Alternative method: get all token accounts and filter for specific mint
async function getTokenBalanceAlternative(walletAddress: string, mint: string): Promise<number> {
  try {
    console.log(`[Token] Trying alternative method for ${walletAddress}, mint ${mint}`);
    
    const walletAddr = String(address(walletAddress));
    const tokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'; // SPL Token program
    
    const requestBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        walletAddr,
        { programId: tokenProgramId },
        { encoding: 'jsonParsed' },
      ],
    };
    
    const data = await rpcRequest(SOLANA_RPC_URL, requestBody);

    const accounts = data.result?.value || [];
    console.log(`[Token] Found ${accounts.length} token accounts for ${walletAddress}`);

    // Find account with matching mint
    for (const account of accounts) {
      const accountData = account.account?.data?.parsed?.info;
      const accountMint = accountData?.mint;
      if (accountMint === mint) {
        const tokenAmount = accountData?.tokenAmount;
        if (tokenAmount) {
          const balance = parseTokenAmount(tokenAmount);
          console.log(`[Token] Found balance via alternative method: ${balance}`);
          return balance;
        }
      }
    }

    console.log(`[Token] No account found for mint ${mint} in ${accounts.length} token accounts`);
    return 0;
  } catch (error: any) {
    console.error(`[Token] Alternative method error for ${walletAddress}, mint ${mint}:`, error?.message || error);
    return 0;
  }
}

// Get USDC token balance for an address (convenience wrapper)
async function getUsdcBalance(address: string): Promise<number> {
  return getTokenBalance(address, USDC_MINT);
}

// Get both SOL and USDC balances for an address
export async function getWalletBalances(address: string): Promise<WalletBalances> {
  console.log(`[getWalletBalances] Starting fetch for ${address}`);
  
  try {
    const [sol, usdc] = await Promise.all([
      getSolBalance(address),
      getUsdcBalance(address),
    ]);

    console.log(`[getWalletBalances] Final balances for ${address}: SOL=${sol}, USDC=${usdc}`);

    return { sol, usdc };
  } catch (error: any) {
    console.error(`[getWalletBalances] Error fetching balances for ${address}:`, error?.message || error);
    return { sol: 0, usdc: 0 };
  }
}

// Test basic network connectivity
export async function testNetworkConnectivity(): Promise<boolean> {
  try {
    console.log('[NetworkTest] Testing basic connectivity...');
    
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
    
    try {
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller?.signal,
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      
      console.log('[NetworkTest] Google.com responded:', response.status);
      return response.ok;
    } catch (fetchError: any) {
      if (timeoutId) clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error: any) {
    console.error('[NetworkTest] Network connectivity test failed:', error?.message || error);
    console.error('[NetworkTest] Error details:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });
    return false;
  }
}

// Test function to verify RPC is working
export async function testRpcConnection(): Promise<boolean> {
  try {
    // First test basic network
    const networkOk = await testNetworkConnectivity();
    if (!networkOk) {
      console.error('[testRpcConnection] Basic network connectivity failed - check Android emulator network settings');
      return false;
    }
    
    // Test actual balance fetch
    const testAddress = 'arhZbFtC7v7RMk1sSDp5pENaY3bWVJmU1U4BvYVFwos';
    const balance = await getSolBalance(testAddress);
    console.log(`[testRpcConnection] Test balance: ${balance} SOL`);
    return balance > 0;
  } catch (error: any) {
    console.error('[testRpcConnection] Test failed:', error?.message || error);
    return false;
  }
}
