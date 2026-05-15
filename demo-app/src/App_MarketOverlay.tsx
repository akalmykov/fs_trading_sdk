import React from 'react';
import { FunctionSpaceProvider } from '@functionspace/react';
import { MarketExplorer } from '@functionspace/ui';
import { config, widgetTheme } from './App';

// -- Swap trading layout by changing this import --
import { BasicTradingLayout as TradingLayout } from './App_BasicTradingLayout';
// import { ShapeCutterTradingLayout as TradingLayout } from './App_ShapeCutterTradingLayout';
// import { DistRangeLayout as TradingLayout } from './App_DistRange';
// import { BinaryPanelLayout as TradingLayout } from './App_BinaryPanel';
// import { CustomShapeLayout as TradingLayout } from './App_CustomShapeLayout';
// import { TimelineBinaryLayout as TradingLayout } from './App_TimelineBinaryTradingLayout';

export default function App_MarketOverlay() {
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
        >
          {(marketId) => <TradingLayout marketId={marketId} />}
        </MarketExplorer>
      </div>
    </FunctionSpaceProvider>
  );
}
