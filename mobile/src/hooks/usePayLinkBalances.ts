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
  const previousLinksRef = useRef<Set<string>>(new Set());

  // Function to clear cache for a specific address or all addresses
  const clearCache = useCallback((publicKey?: string) => {
    if (publicKey) {
      delete balanceCache[publicKey];
    } else {
      // Clear all cache
      Object.keys(balanceCache).forEach(key => {
        delete balanceCache[key];
      });
    }
  }, []);

  const fetchBalances = useCallback(async (links: PayLink[], forceRefresh = false, onlyNewLinks = false) => {
    // If force refresh, clear cache for all links
    if (forceRefresh) {
      links.forEach(link => {
        delete balanceCache[link.publicKey];
      });
    }

    // If onlyNewLinks is true, only fetch links that weren't in the previous list
    let linksToConsider = links;
    if (onlyNewLinks) {
      const currentPublicKeys = new Set(links.map(link => link.publicKey));
      linksToConsider = links.filter(link => !previousLinksRef.current.has(link.publicKey));
      console.log(`[usePayLinkBalances] Only fetching ${linksToConsider.length} newly added link(s)`);
    }

    const toFetch = linksToConsider.filter(
      (link) => (!isCacheValid(link.publicKey) || forceRefresh) && !loadingRef.current[link.publicKey]
    );

    if (toFetch.length === 0) {
      // Use cached values for all links
      const cached: BalanceMap = {};
      links.forEach((link) => {
        const cachedData = balanceCache[link.publicKey];
        cached[link.publicKey] = cachedData?.balances || null;
        if (cachedData) {
          console.log(`[usePayLinkBalances] Using cached balance for ${link.publicKey}:`, cachedData.balances);
        }
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

    // Update state with all links (including cached ones)
    setBalances((prev) => {
      const next = { ...prev };
      // Add newly fetched results
      results.forEach(({ publicKey, balances }) => {
        next[publicKey] = balances;
      });
      // Add cached values for links that weren't fetched
      links.forEach((link) => {
        if (!results.find(r => r.publicKey === link.publicKey)) {
          const cachedData = balanceCache[link.publicKey];
          if (cachedData) {
            next[link.publicKey] = cachedData.balances;
          }
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (payLinks.length > 0) {
      // Check if this is a new set of links (e.g., showing hidden links)
      const currentPublicKeys = new Set(payLinks.map(link => link.publicKey));
      const previousPublicKeys = previousLinksRef.current;
      
      // Determine if we're adding new links (e.g., showing hidden)
      const hasNewLinks = Array.from(currentPublicKeys).some(key => !previousPublicKeys.has(key));
      const hasRemovedLinks = Array.from(previousPublicKeys).some(key => !currentPublicKeys.has(key));
      
      // If we have new links, only fetch those. Otherwise, fetch all that need it.
      const onlyNewLinks = hasNewLinks && !hasRemovedLinks;
      
      fetchBalances(payLinks, false, onlyNewLinks);
      
      // Update previous links reference
      previousLinksRef.current = currentPublicKeys;
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

  // Return balances and refresh function
  return {
    balances,
    refresh: () => fetchBalances(payLinks, true),
    clearCache,
  };
}
