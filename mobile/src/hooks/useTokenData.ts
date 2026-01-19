import { useState, useEffect, useCallback } from 'react';
import {
  getTokenOverview,
  TokenOverview,
  LUMEN_TOKEN,
} from '../services/birdeye';

// Simple in-memory cache
let overviewCache: { data: TokenOverview | null; timestamp: number } | null = null;
const CACHE_DURATION = 30000; // 30 seconds

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_DURATION;
}

export function useTokenOverview(tokenAddress: string = LUMEN_TOKEN.address) {
  const [overview, setOverview] = useState<TokenOverview | null>(
    overviewCache?.data || null
  );
  const [loading, setLoading] = useState(!overviewCache?.data);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    // Check cache first
    if (overviewCache && isCacheValid(overviewCache.timestamp)) {
      setOverview(overviewCache.data);
      setLoading(false);
      return;
    }

    try {
      // Don't show loading if we have cached data
      if (!overviewCache?.data) {
        setLoading(true);
      }
      
      const data = await getTokenOverview(tokenAddress);
      
      // Update cache
      overviewCache = { data, timestamp: Date.now() };
      
      setOverview(data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch token data');
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  useEffect(() => {
    fetchOverview();
    // Refresh every 30 seconds
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  return { overview, loading, error, refetch: fetchOverview };
}
