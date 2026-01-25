// Hook to fetch and cache balances for pay links
import { useState, useEffect, useCallback, useRef } from 'react';
import { getWalletBalances, WalletBalances } from '../services/balances';
import { PayLink } from '../services/paylink';

interface BalanceMap {
  [publicKey: string]: WalletBalances | null;
}

// Cache balances for 30 seconds
const CACHE_DURATION = 30000;
const balanceCache: {
  [publicKey: string]: { balances: WalletBalances; timestamp: number };
} = {};

function isCacheValid(publicKey: string): boolean {
  const cached = balanceCache[publicKey];
  if (!cached) return false;
  return Date.now() - cached.timestamp < CACHE_DURATION;
}

export function usePayLinkBalances(payLinks: PayLink[]) {
  const [balances, setBalances] = useState<BalanceMap>({});
  const loadingRef = useRef<Record<string, boolean>>({});

  const fetchBalances = useCallback(async (links: PayLink[]) => {
    const toFetch = links.filter(
      (link) => !isCacheValid(link.publicKey) && !loadingRef.current[link.publicKey]
    );

    if (toFetch.length === 0) {
      // Use cached values
      const cached: BalanceMap = {};
      links.forEach((link) => {
        const cachedData = balanceCache[link.publicKey];
        cached[link.publicKey] = cachedData?.balances || null;
        console.log(`[usePayLinkBalances] Using cached balance for ${link.publicKey}:`, cachedData?.balances);
      });
      setBalances(cached);
      return;
    }

    // Mark as loading
    toFetch.forEach((link) => {
      loadingRef.current[link.publicKey] = true;
    });

    // Fetch balances in parallel
    const results = await Promise.all(
      toFetch.map(async (link) => {
        try {
          console.log(`[usePayLinkBalances] Fetching balance for ${link.publicKey}`);
          const walletBalances = await getWalletBalances(link.publicKey);
          console.log(`[usePayLinkBalances] Got balances for ${link.publicKey}:`, walletBalances);
          
          balanceCache[link.publicKey] = {
            balances: walletBalances,
            timestamp: Date.now(),
          };
          return { publicKey: link.publicKey, balances: walletBalances };
        } catch (error) {
          console.error(`[usePayLinkBalances] Error fetching balance for ${link.publicKey}:`, error);
          // Don't cache errors - return null so we can retry
          return { publicKey: link.publicKey, balances: null };
        } finally {
          delete loadingRef.current[link.publicKey];
        }
      })
    );

    // Update state
    setBalances((prev) => {
      const next = { ...prev };
      results.forEach(({ publicKey, balances }) => {
        next[publicKey] = balances;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (payLinks.length > 0) {
      fetchBalances(payLinks);
    }
  }, [payLinks, fetchBalances]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (payLinks.length === 0) return;

    const interval = setInterval(() => {
      fetchBalances(payLinks);
    }, 30000);

    return () => clearInterval(interval);
  }, [payLinks, fetchBalances]);

  return balances;
}
