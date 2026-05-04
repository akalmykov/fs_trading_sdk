import { useCallback, useRef, useState } from 'react';
import { FunctionSpaceProvider } from '@functionspace/react';
import { ConsensusChart, TradePanel, MarketStats, PositionTable, PasswordlessAuthWidget } from '@functionspace/ui';
import { ArticlePage } from './pages/ArticlePage';
import { config, MARKET_ID, widgetTheme } from './App';
import { ConePriceChart } from './components/ConePriceChart';

const CHART_RATIO = 7
const PANEL_RATIO = 3;

// Reusable layout content (used by both demo-app and docs site)
export function BasicTradingLayout({ marketId }: { marketId: string | number }) {
  const isWtiConeMarket = Number(marketId) === 174;
  const [prediction, setPrediction] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(65);
  const predictionInitRef = useRef(false);

  const handleLatestClose = useCallback((latestClose: number) => {
    if (predictionInitRef.current) return;
    predictionInitRef.current = true;
    setPrediction(latestClose);
  }, []);

  return (
    <div className={isWtiConeMarket ? 'wti-cone-trading-layout' : undefined}>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ flex: 7, minWidth: 0 }}>
          <MarketStats marketId={marketId} />
        </div>
        <div style={{ flex: 3, minWidth: 0 }}>
          <PasswordlessAuthWidget />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', marginBottom: '1rem', minHeight: '520px' }}>
        <div style={{ flex: CHART_RATIO, minWidth: 0 }}>
          {isWtiConeMarket ? (
            <ConePriceChart
              marketId={marketId}
              height={655}
              prediction={prediction}
              confidence={confidence}
              onPredictionChange={setPrediction}
              onConfidenceChange={setConfidence}
              onLatestClose={handleLatestClose}
            />
          ) : (
            <ConsensusChart marketId={marketId} height={655} zoomable />
          )}
        </div>
        <div style={{ flex: PANEL_RATIO, minWidth: 0 }}>
          {isWtiConeMarket && prediction !== null ? (
            <TradePanel
              marketId={marketId}
              modes={['gaussian']}
              prediction={prediction}
              confidence={confidence}
              onPredictionChange={setPrediction}
              onConfidenceChange={setConfidence}
            />
          ) : isWtiConeMarket ? (
            <div className="fs-trade-panel" style={{ opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--fs-text-secondary)' }}>Loading price data…</span>
            </div>
          ) : (
            <TradePanel marketId={marketId} modes={['gaussian', 'range']} />
          )}
        </div>
      </div>

      <PositionTable marketId={marketId} tabs={['open-orders', 'trade-history', 'market-positions']} />
    </div>
  );
}

// Basic trading layout: TradePanel beside chart
export default function App_BasicTradingLayout() {
  return (
    <ArticlePage widgetWidth='150%'>
      <FunctionSpaceProvider config={config} theme={widgetTheme}>
        <BasicTradingLayout marketId={MARKET_ID} />
      </FunctionSpaceProvider>
    </ArticlePage>
  );
}
