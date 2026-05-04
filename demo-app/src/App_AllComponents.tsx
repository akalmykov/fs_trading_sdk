import { FunctionSpaceProvider, useDistributionState } from '@functionspace/react';
import {
  MarketStats,
  PasswordlessAuthWidget,
  ConsensusChart,
  DistributionChart,
  TimelineChart,
  MarketCharts,
  TradePanel,
  ShapeCutter,
  BinaryPanel,
  BucketRangeSelector,
  BucketTradePanel,
  CustomShapeEditor,
  PositionTable,
  TimeSales,
} from '@functionspace/ui';
import { config, MARKET_ID } from './App';
import type { FSThemeInput } from '@functionspace/react';

const theme: FSThemeInput = 'fs-dark';

function AllComponentsInner() {
  const distState = useDistributionState(MARKET_ID);

  return (
    <>
      {/* Each component gets a wrapper div with a data-capture attribute for Playwright targeting */}

      <div data-capture="MarketStats" style={{ marginBottom: '2rem' }}>
        <MarketStats marketId={MARKET_ID} />
      </div>

      <div data-capture="AuthWidget" style={{ marginBottom: '2rem', maxWidth: 400 }}>
        <PasswordlessAuthWidget />
      </div>

      <div data-capture="ConsensusChart" style={{ marginBottom: '2rem' }}>
        <ConsensusChart marketId={MARKET_ID} height={400} />
      </div>

      <div data-capture="DistributionChart" style={{ marginBottom: '2rem' }}>
        <DistributionChart marketId={MARKET_ID} height={300} distributionState={distState} />
      </div>

      <div data-capture="TimelineChart" style={{ marginBottom: '2rem' }}>
        <TimelineChart marketId={MARKET_ID} height={400} />
      </div>

      <div data-capture="MarketCharts" style={{ marginBottom: '2rem' }}>
        <MarketCharts marketId={MARKET_ID} height={400} views={['consensus', 'distribution', 'timeline']} />
      </div>

      <div data-capture="TradePanel" style={{ marginBottom: '2rem', maxWidth: 420 }}>
        <TradePanel marketId={MARKET_ID} modes={['gaussian', 'range']} />
      </div>

      <div data-capture="ShapeCutter" style={{ marginBottom: '2rem' }}>
        <ShapeCutter marketId={MARKET_ID} />
      </div>

      <div data-capture="BinaryPanel" style={{ marginBottom: '2rem', maxWidth: 420 }}>
        <BinaryPanel marketId={MARKET_ID} />
      </div>

      <div data-capture="BucketRangeSelector" style={{ marginBottom: '2rem' }}>
        <BucketRangeSelector marketId={MARKET_ID} distributionState={distState} />
      </div>

      <div data-capture="BucketTradePanel" style={{ marginBottom: '2rem' }}>
        <BucketTradePanel marketId={MARKET_ID} />
      </div>

      <div data-capture="CustomShapeEditor" style={{ marginBottom: '2rem' }}>
        <CustomShapeEditor marketId={MARKET_ID} />
      </div>

      <div data-capture="PositionTable" style={{ marginBottom: '2rem' }}>
        <PositionTable marketId={MARKET_ID} tabs={['open-orders', 'trade-history', 'market-positions']} />
      </div>

      <div data-capture="TimeSales" style={{ marginBottom: '2rem', maxWidth: 600 }}>
        <TimeSales marketId={MARKET_ID} />
      </div>
    </>
  );
}

export default function App_AllComponents() {
  return (
    <div style={{ padding: '2rem', background: '#0a0a0f', minHeight: '100vh' }}>
      <FunctionSpaceProvider config={config} theme={theme}>
        <AllComponentsInner />
      </FunctionSpaceProvider>
    </div>
  );
}
