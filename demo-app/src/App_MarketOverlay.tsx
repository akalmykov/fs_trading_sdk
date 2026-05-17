import React, { useState } from 'react';
import { FunctionSpaceProvider, useMarket } from '@functionspace/react';
import { MarketExplorer } from '@functionspace/ui';
import { config, widgetTheme } from './App';
import { BtcMultiTermHeatmap } from './components/BtcMultiTermHeatmap';
import { BtcMultiConeChart } from './components/BtcMultiConeChart';
import { SpMultiTermHeatmap } from './components/SpMultiTermHeatmap';

// -- Swap trading layout by changing this import --
import { BasicTradingLayout as TradingLayout } from './App_BasicTradingLayout';
// import { ShapeCutterTradingLayout as TradingLayout } from './App_ShapeCutterTradingLayout';
// import { DistRangeLayout as TradingLayout } from './App_DistRange';
// import { BinaryPanelLayout as TradingLayout } from './App_BinaryPanel';
// import { CustomShapeLayout as TradingLayout } from './App_CustomShapeLayout';
// import { TimelineBinaryLayout as TradingLayout } from './App_TimelineBinaryTradingLayout';

/* Virtual multi-term card — rendered as sibling, styled to match grid */
function MultiTermCard({ onClick }: { onClick: () => void }) {
  const m0 = useMarket(250), m1 = useMarket(251), m2 = useMarket(252), m3 = useMarket(253), m4 = useMarket(254);
  const allMarkets = [m0, m1, m2, m3, m4];

  const totalVolume = allMarkets.reduce((sum, m) => sum + (m.market?.totalVolume ?? 0), 0);
  const totalLiquidity = allMarkets.reduce((sum, m) => sum + (m.market?.poolBalance ?? 0), 0);
  const totalTraders = allMarkets.reduce((sum, m) => sum + (m.market?.positionsOpen ?? 0), 0);

  const formatNum = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="fs-market-card" role="button" tabIndex={0} onClick={onClick}>
      <div className="fs-market-card-hover-overlay" />
      <div className="fs-market-card-header">
        <h3 className="fs-market-card-title">Bitcoin Multi-Term Year-End Closing Price</h3>
        <span className="fs-market-card-badge open">Active</span>
      </div>
      <div className="fs-market-card-consensus">
        <div className="fs-market-card-consensus-header">
          <span className="fs-market-card-consensus-label">Market Consensus (5 markets)</span>
          <span className="fs-market-card-consensus-range">Range: 12,000 – 712,000</span>
        </div>
        <div className="fs-market-card-consensus-value">
          2026–2030 Term Structure
        </div>
      </div>
      <div className="fs-market-card-stats">
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-volume">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </span>
          <span className="fs-market-card-stat-value">{formatNum(totalVolume)}</span>
          <span className="fs-market-card-stat-label">Volume</span>
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-liquidity">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
              <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />
            </svg>
          </span>
          <span className="fs-market-card-stat-value">{formatNum(totalLiquidity)}</span>
          <span className="fs-market-card-stat-label">Liquidity</span>
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-traders">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <span className="fs-market-card-stat-value">{totalTraders}</span>
          <span className="fs-market-card-stat-label">Traders</span>
        </div>
      </div>
      <div className="fs-market-card-footer">
        <span className="fs-market-card-date">Resolves TBD</span>
        <span className="fs-market-card-trade-btn" aria-hidden="true">Trade</span>
      </div>
    </div>
  );
}

/* S&P 500 Multi-Month card */
/* Multi-Cone BTC card */
function MultiConeCard({ onClick }: { onClick: () => void }) {
  const m0 = useMarket(250), m1 = useMarket(251), m2 = useMarket(252), m3 = useMarket(253), m4 = useMarket(254);
  const allMarkets = [m0, m1, m2, m3, m4];
  const totalVolume = allMarkets.reduce((sum, m) => sum + (m.market?.totalVolume ?? 0), 0);
  const totalLiquidity = allMarkets.reduce((sum, m) => sum + (m.market?.poolBalance ?? 0), 0);
  const totalTraders = allMarkets.reduce((sum, m) => sum + (m.market?.positionsOpen ?? 0), 0);
  const formatNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

  return (
    <div className="fs-market-card" role="button" tabIndex={0} onClick={onClick} style={{ order: -2 }}>
      <div className="fs-market-card-hover-overlay" />
      <div className="fs-market-card-header">
        <h3 className="fs-market-card-title">Bitcoin Multi-Term Annual Closing Price #2</h3>
        <span className="fs-market-card-badge open">Active</span>
      </div>
      <div className="fs-market-card-consensus">
        <div className="fs-market-card-consensus-header">
          <span className="fs-market-card-consensus-label">Multi-Cone View (5 markets)</span>
          <span className="fs-market-card-consensus-range">Range: 12,000 – 712,000</span>
        </div>
        <div className="fs-market-card-consensus-value">2026–2030 Cone Projections</div>
      </div>
      <div className="fs-market-card-stats">
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-volume"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg></span>
          <span className="fs-market-card-stat-value">{formatNum(totalVolume)}</span>
          <span className="fs-market-card-stat-label">Volume</span>
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-liquidity"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" /><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" /></svg></span>
          <span className="fs-market-card-stat-value">{formatNum(totalLiquidity)}</span>
          <span className="fs-market-card-stat-label">Liquidity</span>
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-traders"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></span>
          <span className="fs-market-card-stat-value">{totalTraders}</span>
          <span className="fs-market-card-stat-label">Traders</span>
        </div>
      </div>
      <div className="fs-market-card-footer">
        <span className="fs-market-card-date">Resolves TBD</span>
        <span className="fs-market-card-trade-btn" aria-hidden="true">Trade</span>
      </div>
    </div>
  );
}

/* S&P 500 Multi-Month card */
function SpTermCard({ onClick }: { onClick: () => void }) {
  const m0 = useMarket(255), m1 = useMarket(256), m2 = useMarket(257), m3 = useMarket(258), m4 = useMarket(259), m5 = useMarket(260);
  const allMarkets = [m0, m1, m2, m3, m4, m5];

  const totalVolume = allMarkets.reduce((sum, m) => sum + (m.market?.totalVolume ?? 0), 0);
  const totalLiquidity = allMarkets.reduce((sum, m) => sum + (m.market?.poolBalance ?? 0), 0);
  const totalTraders = allMarkets.reduce((sum, m) => sum + (m.market?.positionsOpen ?? 0), 0);

  const formatNum = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="fs-market-card" role="button" tabIndex={0} onClick={onClick} style={{ order: -1 }}>
      <div className="fs-market-card-hover-overlay" />
      <div className="fs-market-card-header">
        <h3 className="fs-market-card-title">S&P 500 Multi-Month Term Structure</h3>
        <span className="fs-market-card-badge open">Active</span>
      </div>
      <div className="fs-market-card-consensus">
        <div className="fs-market-card-consensus-header">
          <span className="fs-market-card-consensus-label">Market Consensus (6 markets)</span>
          <span className="fs-market-card-consensus-range">Range: 3,700 – 11,100</span>
        </div>
        <div className="fs-market-card-consensus-value">
          Jun–Nov 2026 Term Structure
        </div>
      </div>
      <div className="fs-market-card-stats">
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-volume">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
            </svg>
          </span>
          <span className="fs-market-card-stat-value">{formatNum(totalVolume)}</span>
          <span className="fs-market-card-stat-label">Volume</span>
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-liquidity">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
              <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97" />
            </svg>
          </span>
          <span className="fs-market-card-stat-value">{formatNum(totalLiquidity)}</span>
          <span className="fs-market-card-stat-label">Liquidity</span>
        </div>
        <div className="fs-market-card-stat">
          <span className="fs-market-card-stat-icon fs-market-card-stat-icon-traders">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <span className="fs-market-card-stat-value">{totalTraders}</span>
          <span className="fs-market-card-stat-label">Traders</span>
        </div>
      </div>
      <div className="fs-market-card-footer">
        <span className="fs-market-card-date">Resolves TBD</span>
        <span className="fs-market-card-trade-btn" aria-hidden="true">Trade</span>
      </div>
    </div>
  );
}

export default function App_MarketOverlay() {
  const [multiTermOpen, setMultiTermOpen] = useState(false);
  const [multiConeOpen, setMultiConeOpen] = useState(false);
  const [spTermOpen, setSpTermOpen] = useState(false);

  return (
    <FunctionSpaceProvider
      config={config}
      theme={widgetTheme}
      cache={{ revalidateOnFocus: false, staleTime: 30_000 }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        <h1 style={{ color: 'var(--fs-text)', marginBottom: '1.5rem', fontFamily: 'inherit' }}>
          Market Explorer
        </h1>

        <MarketExplorer
          views={['cards', 'pulse', 'compact', 'gauge', 'split', 'table', 'heatmap', 'charts']}
          state="open"
          featuredCategories={['sports', 'crypto']}
          pollInterval={5000}
          cardsPrepend={<><MultiConeCard onClick={() => setMultiConeOpen(true)} /><MultiTermCard onClick={() => setMultiTermOpen(true)} /><SpTermCard onClick={() => setSpTermOpen(true)} /></>}
        >
          {(marketId) => <TradingLayout marketId={marketId} />}
        </MarketExplorer>
      </div>

      {/* BTC Multi-term overlay */}
      {multiTermOpen && (
        <div className="fs-overlay-backdrop fs-overlay-visible" onClick={() => setMultiTermOpen(false)}>
          <div className="fs-overlay-panel" style={{ maxWidth: 'min(1480px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="fs-overlay-header">
              <h2 className="fs-overlay-title">Bitcoin Multi-Term Year-End Closing Price</h2>
              <button className="fs-overlay-close" onClick={() => setMultiTermOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="fs-overlay-body">
              <BtcMultiTermHeatmap />
            </div>
          </div>
        </div>
      )}

      {/* S&P 500 Multi-term overlay */}
      {spTermOpen && (
        <div className="fs-overlay-backdrop fs-overlay-visible" onClick={() => setSpTermOpen(false)}>
          <div className="fs-overlay-panel" style={{ maxWidth: 'min(1050px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="fs-overlay-header">
              <h2 className="fs-overlay-title">S&P 500 Multi-Month Term Structure</h2>
              <button className="fs-overlay-close" onClick={() => setSpTermOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="fs-overlay-body">
              <SpMultiTermHeatmap />
            </div>
          </div>
        </div>
      )}

      {/* BTC Multi-Cone overlay */}
      {multiConeOpen && (
        <div className="fs-overlay-backdrop fs-overlay-visible" onClick={() => setMultiConeOpen(false)}>
          <div className="fs-overlay-panel" style={{ maxWidth: 'min(1480px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="fs-overlay-header">
              <h2 className="fs-overlay-title">Bitcoin Multi-Term Annual Closing Price #2</h2>
              <button className="fs-overlay-close" onClick={() => setMultiConeOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="fs-overlay-body">
              <BtcMultiConeChart />
            </div>
          </div>
        </div>
      )}
    </FunctionSpaceProvider>
  );
}
