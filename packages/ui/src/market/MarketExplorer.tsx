import React, { useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { FunctionSpaceContext, useMarketFilters } from '@functionspace/react';
import type { SortOption, UseMarketFiltersConfig } from '@functionspace/react';
import type { MarketState } from '@functionspace/core';
import { MarketCardGrid } from './MarketCardGrid.js';
import { MarketFilterBar } from './MarketFilterBar.js';
import { PulseCard, CompactCard, GaugeCard, SplitCard, TableView, HeatmapView, ChartsView } from './views/index.js';
import { Overlay } from '../components/index.js';
import '../styles/base.css';

// ── Types ──

export type MarketExplorerView =
  | 'cards' | 'pulse' | 'compact' | 'gauge' | 'split' | 'table' | 'heatmap' | 'charts';

export interface MarketExplorerProps {
  views?: MarketExplorerView[];
  children?: (marketId: number) => React.ReactNode;
  onSelect?: (marketId: number) => void;
  state?: string;
  categories?: string[];
  pollInterval?: number;
  emptyMessage?: string;
  showFilterBar?: boolean;
  featuredCategories?: string[];
  sortOptions?: SortOption[];
  searchPlaceholder?: string;
  filterBarMaxWidth?: string;
  /** Extra cards rendered at the start of the Cards grid view */
  cardsPrepend?: React.ReactNode;
}

// ── Tab labels ──

const VIEW_LABELS: Record<MarketExplorerView, string> = {
  cards: 'Cards',
  pulse: 'Pulse',
  compact: 'Compact',
  gauge: 'Gauge',
  split: 'Split',
  table: 'List',
  heatmap: 'Heatmap',
  charts: 'Charts',
};

// ── Grid views (pulse, compact, gauge, split) ──

function GridViewContainer({
  markets,
  loading,
  error,
  emptyMessage,
  onSelect,
  renderCard,
  gridClassName,
}: {
  markets: MarketState[];
  loading: boolean;
  error: Error | null;
  emptyMessage: string;
  onSelect?: (marketId: number) => void;
  renderCard: (market: MarketState, onSelect?: (marketId: number) => void) => React.ReactNode;
  gridClassName: string;
}) {
  if (loading) {
    return (
      <div className="fs-market-explorer-loading">
        <span style={{ color: 'var(--fs-text-secondary)' }}>Loading markets...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fs-market-explorer-error">
        <span style={{ color: 'var(--fs-negative)' }}>Error: {error.message}</span>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="fs-market-explorer-empty">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={gridClassName}>
      {markets.map(m => (
        <React.Fragment key={m.marketId}>
          {renderCard(m, onSelect)}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Component ──

export function MarketExplorer({
  views,
  children,
  onSelect,
  state,
  categories,
  pollInterval,
  emptyMessage = 'No markets found',
  showFilterBar,
  featuredCategories,
  sortOptions,
  searchPlaceholder,
  filterBarMaxWidth,
  cardsPrepend,
}: MarketExplorerProps) {
  const ctx = useContext(FunctionSpaceContext);
  if (!ctx) throw new Error('MarketExplorer must be used within FunctionSpaceProvider');

  // ── Tab system (follows MarketCharts pattern) ──
  const effectiveViews = views && views.length > 0 ? views : (['cards'] as MarketExplorerView[]);
  const showTabs = effectiveViews.length > 1;
  const [activeView, setActiveView] = useState<MarketExplorerView>(effectiveViews[0]);
  const safeActiveView = effectiveViews.includes(activeView) ? activeView : effectiveViews[0];

  // ── Data fetching (always via useMarketFilters) ──
  const filtersConfig = useMemo<UseMarketFiltersConfig>(() => ({
    categories,
    featuredCategories,
    sortOptions,
    pollInterval,
    state,
  }), [categories, featuredCategories, sortOptions, pollInterval, state]);

  const filters = useMarketFilters(filtersConfig);

  // ── Overlay state ──
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);

  const selectedMarket = useMemo<MarketState | undefined>(() => {
    if (selectedMarketId === null) return undefined;
    return filters.markets.find(m => m.marketId === selectedMarketId);
  }, [selectedMarketId, filters.markets]);

  // Auto-dismiss overlay when selected market disappears from filtered list
  useEffect(() => {
    if (selectedMarketId === null) return;
    const stillPresent = filters.markets.some(m => m.marketId === selectedMarketId);
    if (!stillPresent && filters.markets.length > 0 && !filters.loading) {
      setSelectedMarketId(null);
    }
  }, [selectedMarketId, filters.markets, filters.loading]);

  // ── Market selection handler ──
  const handleSelect = useCallback((marketId: number) => {
    if (children) {
      // Overlay mode: open overlay with render prop content
      setSelectedMarketId(marketId);
    } else if (onSelect) {
      // Callback mode: fire onSelect without overlay
      onSelect(marketId);
    }
  }, [children, onSelect]);

  const handleOverlayClose = useCallback(() => {
    setSelectedMarketId(null);
  }, []);

  // ── View rendering ──
  const renderActiveView = () => {
    switch (safeActiveView) {
      case 'cards':
        return (
          <MarketCardGrid
            markets={filters.markets}
            loading={filters.loading}
            error={filters.error}
            emptyMessage={emptyMessage}
            onSelect={handleSelect}
          >
            {cardsPrepend}
          </MarketCardGrid>
        );

      case 'pulse':
        return (
          <GridViewContainer
            markets={filters.markets}
            loading={filters.loading}
            error={filters.error}
            emptyMessage={emptyMessage}
            onSelect={handleSelect}
            renderCard={(m, sel) => <PulseCard market={m} onSelect={sel} />}
            gridClassName="fs-pulse-card-grid"
          />
        );

      case 'compact':
        return (
          <GridViewContainer
            markets={filters.markets}
            loading={filters.loading}
            error={filters.error}
            emptyMessage={emptyMessage}
            onSelect={handleSelect}
            renderCard={(m, sel) => <CompactCard market={m} onSelect={sel} />}
            gridClassName="fs-compact-card-grid"
          />
        );

      case 'gauge':
        return (
          <GridViewContainer
            markets={filters.markets}
            loading={filters.loading}
            error={filters.error}
            emptyMessage={emptyMessage}
            onSelect={handleSelect}
            renderCard={(m, sel) => <GaugeCard market={m} onSelect={sel} />}
            gridClassName="fs-gauge-card-grid"
          />
        );

      case 'split':
        return (
          <GridViewContainer
            markets={filters.markets}
            loading={filters.loading}
            error={filters.error}
            emptyMessage={emptyMessage}
            onSelect={handleSelect}
            renderCard={(m, sel) => <SplitCard market={m} onSelect={sel} />}
            gridClassName="fs-split-card-grid"
          />
        );

      case 'table':
        return (
          <TableView markets={filters.markets} onSelect={handleSelect} />
        );

      case 'heatmap':
        return (
          <HeatmapView markets={filters.markets} onSelect={handleSelect} />
        );

      case 'charts':
        return (
          <ChartsView markets={filters.markets} onSelect={handleSelect} />
        );

      default:
        return null;
    }
  };

  return (
    <div className="fs-market-explorer">
      {/* Filter bar */}
      {showFilterBar !== false && (
        <MarketFilterBar
          {...filters.filterBarProps}
          maxWidth={filterBarMaxWidth}
          searchPlaceholder={searchPlaceholder}
        />
      )}

      {/* Tab bar */}
      {showTabs && (
        <div className="fs-market-explorer-tabs">
          {effectiveViews.map((view) => (
            <button
              key={view}
              className={`fs-market-explorer-tab${safeActiveView === view ? ' active' : ''}`}
              onClick={() => setActiveView(view)}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      )}

      {/* Active view */}
      {renderActiveView()}

      {/* Overlay (only when children render prop is provided) */}
      {children && (
        <Overlay
          open={selectedMarketId !== null}
          onClose={handleOverlayClose}
          title={selectedMarket?.title ?? 'Trade'}
        >
          {selectedMarketId !== null && children(selectedMarketId)}
        </Overlay>
      )}
    </div>
  );
}
