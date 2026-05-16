import React, { useContext } from 'react';
import { FunctionSpaceContext } from '@functionspace/react';
import type { MarketState } from '@functionspace/core';
import { MarketCard } from './MarketCard.js';
import '../styles/base.css';

export interface MarketCardGridProps {
  markets: MarketState[];
  onSelect?: (marketId: number) => void;
  loading?: boolean;
  error?: Error | null;
  emptyMessage?: string;
  children?: React.ReactNode;
}

const SKELETON_COUNT = 6;

function SkeletonCard() {
  return (
    <div className="fs-market-card" aria-hidden="true">
      {/* Header skeleton */}
      <div className="fs-market-card-header">
        <span className="fs-skeleton" style={{ width: '70%', height: '1rem' }} />
        <span className="fs-skeleton" style={{ width: '3.5rem', height: '1.25rem', borderRadius: '9999px' }} />
      </div>

      {/* Consensus skeleton */}
      <div className="fs-market-card-consensus">
        <span className="fs-skeleton" style={{ width: '4rem', height: '1.5rem' }} />
        <span className="fs-skeleton" style={{ width: '2rem', height: '0.75rem' }} />
      </div>

      {/* Stats skeleton */}
      <div className="fs-market-card-stats">
        <div className="fs-market-card-stat">
          <span className="fs-skeleton" style={{ width: '2.5rem', height: '0.75rem' }} />
          <span className="fs-skeleton" style={{ width: '2rem', height: '0.625rem' }} />
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-skeleton" style={{ width: '2.5rem', height: '0.75rem' }} />
          <span className="fs-skeleton" style={{ width: '2rem', height: '0.625rem' }} />
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-skeleton" style={{ width: '2.5rem', height: '0.75rem' }} />
          <span className="fs-skeleton" style={{ width: '2rem', height: '0.625rem' }} />
        </div>
      </div>

      {/* Footer skeleton */}
      <div className="fs-market-card-footer">
        <span className="fs-skeleton" style={{ width: '5rem', height: '0.75rem' }} />
        <span className="fs-skeleton" style={{ width: '3.5rem', height: '1.75rem', borderRadius: 'var(--fs-radius-sm)' }} />
      </div>
    </div>
  );
}

export function MarketCardGrid({ markets, onSelect, loading, error, emptyMessage, children }: MarketCardGridProps) {
  const ctx = useContext(FunctionSpaceContext);
  if (!ctx) throw new Error('MarketCardGrid must be used within FunctionSpaceProvider');

  if (loading) {
    return (
      <div className="fs-market-card-grid-loading">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="fs-market-card-grid-error">
        {error.message}
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="fs-market-card-grid-empty">
        {emptyMessage || 'No markets found'}
      </div>
    );
  }

  return (
    <div className="fs-market-card-grid">
      {children}
      {markets.map(m => (
        <MarketCard key={m.marketId} market={m} onSelect={onSelect} />
      ))}
    </div>
  );
}
