import { useContext, useState, useCallback, useRef, useEffect } from 'react';
import { previewPayoutCurve } from '@functionspace/core';
import type { BeliefVector, PayoutCurve, MarketState } from '@functionspace/core';
import { FunctionSpaceContext } from './context.js';
import { useQueryCache } from './QueryCacheContext.js';

export interface UsePreviewPayoutReturn {
  execute: (belief: BeliefVector, collateral: number, numOutcomes?: number) => Promise<PayoutCurve>;
  loading: boolean;
  error: Error | null;
  reset: () => void;
}

export function usePreviewPayout(marketId: string | number): UsePreviewPayoutReturn {
  const ctx = useContext(FunctionSpaceContext);
  if (!ctx) throw new Error('usePreviewPayout must be used within FunctionSpaceProvider');

  const cache = useQueryCache();
  const { client } = ctx;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const clearErrorTimer = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  const execute = useCallback(async (
    belief: BeliefVector,
    collateral: number,
    numOutcomes?: number,
  ): Promise<PayoutCurve> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    clearErrorTimer();
    try {
      const marketSnapshot = cache.getSnapshot<MarketState>(['marketState', String(marketId)]);
      const numBuckets = marketSnapshot.data?.config?.numBuckets;
      if (!numBuckets) throw new Error('Market data not loaded. Cannot determine numBuckets for validation.');

      const result = await previewPayoutCurve(client, marketId, belief, collateral, numBuckets, numOutcomes, { signal: controller.signal });
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      errorTimerRef.current = setTimeout(() => {
        setError(null);
        errorTimerRef.current = null;
      }, 5000);
      throw error;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [client, marketId, cache, clearErrorTimer]);

  const reset = useCallback(() => {
    setError(null);
    clearErrorTimer();
  }, [clearErrorTimer]);

  return { execute, loading, error, reset };
}
