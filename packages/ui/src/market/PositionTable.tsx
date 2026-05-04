import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import type { Position, SellResult } from '@functionspace/core';
import { FunctionSpaceContext, usePositions, useSell, usePreviewSell } from '@functionspace/react';
import '../styles/base.css';

export type PositionTabId = 'open-orders' | 'trade-history' | 'market-positions';

export interface PositionTableProps {
  marketId: string | number;
  onSell?: (result: SellResult) => void;
  onError?: (error: Error) => void;
  pageSize?: number;
  selectedPositionId?: string | number | null;
  onSelectPosition?: (id: string | number | null) => void;
  tabs?: PositionTabId[];
}

const TAB_LABELS: Record<PositionTabId, string> = {
  'open-orders': 'Open Orders',
  'trade-history': 'Trade History',
  'market-positions': 'Market Positions',
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '--';
  return `$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatTimestamp = (iso: string | null): string => {
  if (!iso) return '--';
  return iso.replace('T', ' ').slice(0, 19);
};

const formatPnlPercent = (profitLoss: number | null, collateral: number): string | null => {
  if (profitLoss === null || collateral <= 0) return null;
  const pct = (profitLoss / collateral) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
};

const sortByIdDesc = (positions: Position[]): Position[] => {
  return [...positions].sort((a, b) => {
    const aNum = typeof a.positionId === 'string' ? parseInt(a.positionId.match(/\d+$/)?.[0] || '0') : a.positionId;
    const bNum = typeof b.positionId === 'string' ? parseInt(b.positionId.match(/\d+$/)?.[0] || '0') : b.positionId;
    return bNum - aNum;
  });
};

export function PositionTable({
  marketId,
  onSell,
  onError,
  pageSize = 20,
  selectedPositionId,
  onSelectPosition,
  tabs,
}: PositionTableProps) {
  const ctx = useContext(FunctionSpaceContext);
  if (!ctx) throw new Error('PositionTable must be used within FunctionSpaceProvider');

  const { execute: executeSell } = useSell(marketId);
  const { execute: executePreviewSell } = usePreviewSell(marketId);

  const effectiveUsername = ctx.user?.username;

  // Tab management (follows MarketCharts pattern)
  const effectiveTabs: PositionTabId[] = tabs && tabs.length > 0 ? tabs : ['open-orders', 'trade-history'];
  const showTabs = effectiveTabs.length > 1;
  const [activeTab, setActiveTab] = useState<PositionTabId>(effectiveTabs[0]);

  // Data fetching -- single API call
  const hasMarketTab = effectiveTabs.includes('market-positions');
  const { positions: rawPositions, loading, error, refetch } = usePositions(
    marketId,
    hasMarketTab ? undefined : effectiveUsername
  );

  // Per-tab data filtering
  const userPositions = useMemo(() => {
    if (!rawPositions) return [];
    return hasMarketTab ? rawPositions.filter(p => p.owner === effectiveUsername) : rawPositions;
  }, [rawPositions, hasMarketTab, effectiveUsername]);

  const tabData = useMemo((): Record<PositionTabId, Position[]> => ({
    'open-orders': userPositions.filter(p => p.status === 'open'),
    'trade-history': userPositions.filter(p => p.status === 'sold' || p.status === 'settled' || p.status === 'closed'),
    'market-positions': rawPositions ?? [],
  }), [userPositions, rawPositions]);

  // Active tab's data, sorted by ID desc
  const activeData = useMemo(() => {
    return sortByIdDesc(tabData[activeTab] ?? []);
  }, [tabData, activeTab]);

  // Per-tab independent pagination
  const [tabPages, setTabPages] = useState<Record<string, number>>({});
  const currentPage = tabPages[activeTab] ?? 1;
  const setCurrentPage = useCallback((page: number | ((prev: number) => number)) => {
    setTabPages(prev => ({
      ...prev,
      [activeTab]: typeof page === 'function' ? page(prev[activeTab] ?? 1) : page,
    }));
  }, [activeTab]);

  const totalPages = Math.ceil(activeData.length / pageSize);
  const paginatedPositions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return activeData.slice(start, start + pageSize);
  }, [activeData, currentPage, pageSize]);

  // Reset to page 1 on tab switch
  useEffect(() => {
    setTabPages(prev => ({ ...prev, [activeTab]: 1 }));
  }, [activeTab]);

  // Reset to page 1 when active tab's data count changes
  const activeDataLength = activeData.length;
  useEffect(() => {
    setTabPages(prev => ({ ...prev, [activeTab]: 1 }));
  }, [activeDataLength, activeTab]);

  // State for market values and sell operations
  const [marketValues, setMarketValues] = useState<Record<string, number | null>>({});
  const [sellInProgress, setSellInProgress] = useState<Set<string | number>>(new Set());
  const [sellError, setSellError] = useState<string | null>(null);

  // Fetch market values for visible open positions
  const refreshMarketValues = useCallback(async (visiblePositions: Position[]) => {
    const openPositions = visiblePositions.filter((p) => p.status === 'open');
    if (openPositions.length === 0) return;

    const results = await Promise.allSettled(
      openPositions.map((p) =>
        executePreviewSell(p.positionId as number).then((r) => ({
          positionId: p.positionId,
          value: r.collateralReturned,
        }))
      )
    );

    const newValues: Record<string, number | null> = {};
    results.forEach((result, index) => {
      const positionId = openPositions[index].positionId;
      if (result.status === 'fulfilled') {
        newValues[String(positionId)] = result.value.value;
      } else {
        newValues[String(positionId)] = null;
      }
    });

    setMarketValues((prev) => ({ ...prev, ...newValues }));
  }, [executePreviewSell]);

  // Tab-aware market value refresh -- never fetch for Trade History
  useEffect(() => {
    if (activeTab === 'trade-history') return;
    if (paginatedPositions.length > 0) {
      refreshMarketValues(paginatedPositions);
    }
  }, [paginatedPositions, refreshMarketValues, activeTab]);

  const handleSell = async (positionId: number | string) => {
    setSellInProgress((prev) => new Set(prev).add(positionId));
    setSellError(null);

    try {
      const result = await executeSell(positionId as number);
      onSell?.(result);
      await refetch();
    } catch (err) {
      const errObj = err instanceof Error ? err : new Error(String(err) || 'Failed to sell position');
      setSellError(errObj.message);
      onError?.(errObj);
    } finally {
      setSellInProgress((prev) => {
        const copy = new Set(prev);
        copy.delete(positionId);
        return copy;
      });
    }
  };

  const getMarketValue = (p: Position): number | null => {
    if (p.status !== 'open') return null;
    return marketValues[String(p.positionId)] ?? null;
  };

  const getProfitLoss = (p: Position): number | null => {
    const cost = p.collateral;
    let realized: number | null = null;

    if ((p.status === 'sold' || p.status === 'closed') && p.soldPrice !== null) {
      realized = p.soldPrice;
    } else if (p.settlementPayout !== null) {
      realized = p.settlementPayout;
    } else {
      realized = getMarketValue(p);
    }

    return realized === null ? null : realized - cost;
  };

  // Per-tab column headers
  const renderColumnHeaders = () => {
    switch (activeTab) {
      case 'open-orders':
        return (
          <tr>
            <th>ID</th><th>Timestamp</th><th>Status</th><th>Prediction</th>
            <th>Cost</th><th>Market Value</th><th>P/L</th><th>P/L %</th><th>Actions</th>
          </tr>
        );
      case 'trade-history':
        return (
          <tr>
            <th>ID</th><th>Timestamp</th><th>Status</th><th>Prediction</th>
            <th>Cost</th><th>Sold Value</th><th>P/L</th><th>P/L %</th><th>Resolution Payout</th>
          </tr>
        );
      case 'market-positions':
        return (
          <tr>
            <th>ID</th><th>Timestamp</th><th>Owner</th><th>Status</th><th>Prediction</th>
            <th>Cost</th><th>Sold Value</th><th>Market Value</th><th>P/L</th>
          </tr>
        );
    }
  };

  // Per-tab row cells
  const renderRowCells = (p: Position) => {
    const marketValue = getMarketValue(p);
    const profitLoss = getProfitLoss(p);
    const isOpen = p.status === 'open';
    const isSelling = sellInProgress.has(p.positionId);
    const pnlPct = formatPnlPercent(profitLoss, p.collateral);

    const idCell = <td className="fs-table-id">{String(p.positionId)}</td>;
    const timestampCell = <td>{formatTimestamp(p.createdAt)}</td>;
    const statusCell = (
      <td>
        <span className={`fs-status-badge ${isOpen ? 'open' : 'closed'}`}>
          {p.status}
        </span>
      </td>
    );
    const predictionCell = <td>{p.prediction?.toFixed(2) ?? '--'}</td>;
    const costCell = <td>{formatCurrency(p.collateral)}</td>;
    const plCell = (
      <td>
        {profitLoss !== null ? (
          <span className={`fs-pl ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
            {profitLoss >= 0 ? '+' : ''}{formatCurrency(profitLoss)}
          </span>
        ) : '--'}
      </td>
    );
    const plPctCell = (
      <td>
        {pnlPct !== null ? (
          <span className={`fs-pl ${profitLoss! >= 0 ? 'profit' : 'loss'}`}>{pnlPct}</span>
        ) : '--'}
      </td>
    );

    switch (activeTab) {
      case 'open-orders':
        return (
          <>
            {idCell}{timestampCell}{statusCell}{predictionCell}{costCell}
            <td>{marketValue !== null ? formatCurrency(marketValue) : '--'}</td>
            {plCell}{plPctCell}
            <td>
              {isOpen && !isSelling && (
                <button className="fs-sell-btn" onClick={(e) => { e.stopPropagation(); handleSell(p.positionId); }}>
                  Sell
                </button>
              )}
              {isOpen && isSelling && <span className="fs-selling">Selling...</span>}
              {!isOpen && <span className="fs-no-action">--</span>}
            </td>
          </>
        );

      case 'trade-history':
        return (
          <>
            {idCell}{timestampCell}{statusCell}{predictionCell}{costCell}
            <td>{formatCurrency(p.soldPrice)}</td>
            {plCell}{plPctCell}
            <td>{formatCurrency(p.settlementPayout)}</td>
          </>
        );

      case 'market-positions':
        return (
          <>
            {idCell}{timestampCell}
            <td>
              <span className={p.owner === effectiveUsername ? 'fs-owner-you' : ''}>
                {p.owner}
                {p.owner === effectiveUsername && <span className="fs-owner-tag"> (you)</span>}
              </span>
            </td>
            {statusCell}{predictionCell}{costCell}
            <td>{formatCurrency(p.soldPrice)}</td>
            <td>{marketValue !== null ? formatCurrency(marketValue) : '--'}</td>
            {plCell}
          </>
        );
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="fs-table-container">
        <div className="fs-table-loading">
          <div className="fs-spinner" />
          <p>Loading positions...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fs-table-container">
        <div className="fs-table-error">
          <p>{error.message}</p>
          <button className="fs-retry-btn" onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  // No data at all (no positions fetched from API)
  if (!rawPositions || rawPositions.length === 0) {
    return (
      <div className="fs-table-container">
        <div className="fs-table-empty">
          <p>No positions yet</p>
          <p className="fs-table-empty-hint">Submit your first trade to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fs-table-container">
      <div className="fs-table-header">
        <h3>Your Positions</h3>
        <span className="fs-table-count">{rawPositions.length} total</span>
      </div>

      {showTabs && (
        <div className="fs-table-tabs">
          {effectiveTabs.map((tab) => (
            <button
              key={tab}
              className={`fs-table-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {sellError && (
        <div className="fs-table-sell-error">{sellError}</div>
      )}

      {activeData.length === 0 ? (
        <div className="fs-table-empty">
          <p>No {TAB_LABELS[activeTab].toLowerCase()}</p>
          <p className="fs-table-empty-hint">
            {activeTab === 'open-orders' ? 'Submit your first trade to get started' :
             activeTab === 'trade-history' ? 'No closed positions yet' :
             'No positions in this market yet'}
          </p>
        </div>
      ) : (
        <>
          <div className="fs-table-wrapper">
            <table className="fs-table">
              <thead>
                {renderColumnHeaders()}
              </thead>
              <tbody>
                {paginatedPositions.map((p) => {
                  const effectiveSelectedId = selectedPositionId ?? ctx.selectedPosition?.positionId ?? null;
                  const isSelected = effectiveSelectedId === p.positionId;

                  const handleRowClick = () => {
                    const newSelection = isSelected ? null : p;
                    if (onSelectPosition) {
                      onSelectPosition(isSelected ? null : p.positionId);
                    } else {
                      ctx.setSelectedPosition(newSelection);
                    }
                  };

                  return (
                    <tr
                      key={String(p.positionId)}
                      className={isSelected ? 'fs-row-selected' : ''}
                      onClick={handleRowClick}
                      style={{ cursor: 'pointer' }}
                    >
                      {renderRowCells(p)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="fs-table-pagination">
            <span className="fs-page-info">Total {TAB_LABELS[activeTab]}: {activeData.length}</span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  className="fs-page-btn"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  ‹
                </button>
                <span className="fs-page-info">
                  {currentPage} / {totalPages}
                </span>
                <button
                  className="fs-page-btn"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
