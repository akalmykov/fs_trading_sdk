import React, { useContext, useMemo, useState } from 'react';
import { FunctionSpaceContext, usePositions, useAuth } from '@functionspace/react';
import type { Position } from '@functionspace/core';

interface MarketDef {
  id: number;
  label: string;
}

export function MultiMarketPositionTable({ markets }: { markets: MarketDef[] }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');

  // Fetch positions for all markets (hooks called in stable order)
  const p0 = usePositions(markets[0]?.id ?? 0, user?.username);
  const p1 = usePositions(markets[1]?.id ?? 0, user?.username);
  const p2 = usePositions(markets[2]?.id ?? 0, user?.username);
  const p3 = usePositions(markets[3]?.id ?? 0, user?.username);
  const p4 = usePositions(markets[4]?.id ?? 0, user?.username);
  const p5 = usePositions(markets[5]?.id ?? 0, user?.username);
  const posHooks = [p0, p1, p2, p3, p4, p5].slice(0, markets.length);

  const allPositions = useMemo(() => {
    const result: (Position & { marketLabel: string })[] = [];
    for (let i = 0; i < markets.length; i++) {
      const positions = posHooks[i]?.positions ?? [];
      for (const pos of positions) {
        if (pos.owner === user?.username) {
          result.push({ ...pos, marketLabel: markets[i].label });
        }
      }
    }
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return result;
  }, [markets, user?.username, ...posHooks.map(h => h.positions)]);

  const loading = posHooks.some(h => h.loading);

  const filtered = useMemo(() => {
    if (activeTab === 'open') return allPositions.filter(p => p.status === 'open');
    return allPositions;
  }, [allPositions, activeTab]);

  const formatCurrency = (v: number | null | undefined) => {
    if (v === null || v === undefined) return '--';
    return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="fs-table-container">
      <div className="fs-table-header">
        <h3>Your Positions</h3>
        <span className="fs-table-count">{allPositions.length} total</span>
      </div>

      <div className="fs-table-tabs">
        <button className={`fs-table-tab ${activeTab === 'open' ? 'active' : ''}`} onClick={() => setActiveTab('open')}>
          Open Orders
        </button>
        <button className={`fs-table-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          Trade History
        </button>
      </div>

      {loading ? (
        <div className="fs-table-loading"><div className="fs-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="fs-table-empty">
          <p>{activeTab === 'open' ? 'No open positions' : 'No trade history'}</p>
          <p className="fs-table-empty-hint">Submit your first trade to get started</p>
        </div>
      ) : (
        <div className="fs-table-wrapper">
          <table className="fs-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>ID</th>
                <th>Cost</th>
                <th>Claims</th>
                <th>P&L</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(pos => {
                const profitLoss = pos.claims - pos.collateral;
                const pnlPct = pos.collateral > 0 ? `${(profitLoss / pos.collateral * 100).toFixed(1)}%` : '--';
                return (
                  <tr key={`${pos.marketLabel}-${pos.positionId}`}>
                    <td><span className="multi-pos-market-badge">{pos.marketLabel}</span></td>
                    <td className="fs-table-id">{String(pos.positionId)}</td>
                    <td>{formatCurrency(pos.collateral)}</td>
                    <td>{formatCurrency(pos.claims)}</td>
                    <td>
                      <span className={`fs-pl ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
                        {profitLoss >= 0 ? '+' : ''}{formatCurrency(profitLoss)} ({pnlPct})
                      </span>
                    </td>
                    <td>
                      <span className={`fs-status-badge ${pos.status === 'open' ? 'open' : 'closed'}`}>
                        {pos.status}
                      </span>
                    </td>
                    <td>{new Date(pos.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
