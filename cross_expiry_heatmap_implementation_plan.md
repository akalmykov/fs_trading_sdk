# Cross-Expiry Term Structure Heatmap

Build a vertically-stacked thermal heatmap showing Bitcoin price consensus distributions across 5 expiry years (2025–2029), with click-to-expand PDF detail and trade integration.

## Overview

- **Real data**: BTC 2026 market (ID 242, 80 buckets, range [0, 200000]) via `useMarket` + `useConsensus`
- **Synthetic data**: Derive 2025/2027/2028/2029 from the real 2026 consensus by scaling mean and spread
- **Rendering**: HTML `<canvas>` for the heatmap (per-row thermal colormap), React for the UI chrome and PDF detail panel
- **Click interaction**: Click a row → expand PDF curve below with full distribution + ConsensusChart + TradePanel for the real market

---

## Proposed Changes

### Component: TermStructureHeatmap

#### [NEW] [TermStructureHeatmap.tsx](file:///Users/alexey.kalmykov/Developer/fs_trading_sdk/demo-app/src/components/TermStructureHeatmap.tsx)

~400 lines. Renders the full heatmap card + expandable PDF detail.

**Data pipeline:**

```typescript
// 1. Fetch real BTC 2026 consensus
const { market } = useMarket(242);
const { consensus } = useConsensus(242, 300);

// 2. From real 2026 consensus, compute stats
const stats2026 = computeStatistics(market.consensus, lb, ub);

// 3. Generate synthetic consensus for other years
// Each year has a different mean and spread
const syntheticRows = [
  { year: 2025, meanShift: 0.7,  spreadScale: 0.6 },  // tighter, lower
  { year: 2026, meanShift: 1.0,  spreadScale: 1.0 },  // real data
  { year: 2027, meanShift: 1.3,  spreadScale: 1.4 },  // wider, higher
  { year: 2028, meanShift: 1.6,  spreadScale: 1.8 },  // wider still
  { year: 2029, meanShift: 2.0,  spreadScale: 2.2 },  // widest, highest
];

// For each synthetic year, generate a belief vector using generateGaussian
// with scaled mean and spread, then evaluateDensityCurve to get density points
```

**Canvas rendering (per row):**

Each row is a horizontal strip of pixels. For each pixel column:
1. Map pixel x → price value
2. Look up density at that price from the row's density curve
3. Normalize by that row's peak density (`t = density / rowMax`)
4. Apply the thermal colormap function → OKLCH → RGB → paint pixel

The thermal colormap (10-stop OKLCH ramp from deep navy to white-hot) is implemented as specified in the requirements.

**Consensus mean dot**: A small white circle (r=5px, 2px dark stroke) plotted at the (price, row) corresponding to each row's mean.

**State:**
- `selectedRow: number | null` — which expiry row is expanded
- `hoverRow: number | null` — visual hover highlight

**On click:** Sets `selectedRow`, animates the PDF detail panel open below the heatmap. For the real 2026 market, show `ConsensusChart` + `TradePanel`. For synthetic years, show a static PDF curve.

---

#### [MODIFY] [App_BasicTradingLayout.tsx](file:///Users/alexey.kalmykov/Developer/fs_trading_sdk/demo-app/src/App_BasicTradingLayout.tsx)

- Add `isBtcHeatmapMarket = Number(marketId) === 242` check
- When true, render the full-width `<TermStructureHeatmap>` layout (similar to how Tesla Optimus uses BrickDropBuilder — full-width, self-contained with its own trade panel that appears on row click)

```tsx
if (isBtcHeatmapMarket) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ flex: 7 }}><MarketStats marketId={marketId} /></div>
        <div style={{ flex: 3 }}><PasswordlessAuthWidget /></div>
      </div>
      <TermStructureHeatmap marketId={marketId} />
      <PositionTable marketId={marketId} tabs={[...]} />
    </div>
  );
}
```

---

#### [MODIFY] [index.css](file:///Users/alexey.kalmykov/Developer/fs_trading_sdk/demo-app/src/index.css)

Add ~100 lines of styles for:

- `.heatmap-card` — main container (dark bg, border, border-radius)
- `.heatmap-header` — title bar with "Term Structure Heatmap" + subtitle + view dropdown
- `.heatmap-canvas-wrap` — positioned container for the canvas
- `.heatmap-row-label` — year labels on the left axis
- `.heatmap-x-axis` — price labels along the bottom
- `.heatmap-row` — hover highlight effect
- `.heatmap-row.selected` — selected row with blue border glow
- `.heatmap-mean-dot` — white circle overlay for consensus mean
- `.heatmap-detail` — expandable PDF detail panel below the heatmap
- `.heatmap-detail-header` — "2027 Distribution Detail" + Selected Expiry badge + Collapse button
- Transition animations for expand/collapse

---

### Thermal Colormap Implementation

The thermal ramp is implemented as a pure TypeScript function — no external dependencies:

```typescript
const THERMAL_STOPS = [
  { t: 0.00, r:  10, g:  12, b:  28 },  // deep navy
  { t: 0.10, r:  20, g:  30, b:  80 },  // dark blue
  { t: 0.25, r:  30, g:  60, b: 140 },  // medium blue
  { t: 0.40, r:  40, g: 170, b: 190 },  // cyan
  { t: 0.55, r:  50, g: 190, b: 140 },  // green-cyan
  { t: 0.68, r: 140, g: 210, b:  60 },  // yellow-green
  { t: 0.80, r: 230, g: 210, b:  40 },  // yellow
  { t: 0.90, r: 220, g: 140, b:  30 },  // orange
  { t: 0.97, r: 200, g:  50, b:  20 },  // red
  { t: 1.00, r: 255, g: 255, b: 245 },  // white-hot
];
```

> [!NOTE]
> OKLCH is specified in the user's design doc but isn't supported in Canvas `fillStyle`. I'll convert the OKLCH stops to approximate sRGB values and interpolate in sRGB space. The visual result is nearly identical and avoids the need for a color-space conversion library.

---

### Synthetic Data Generation

For years other than 2026, we generate synthetic distributions based on the real data:

| Year | Mean Multiplier | Spread Scale | Rationale |
|------|----------------|--------------|-----------|
| 2025 | 0.70× | 0.6× | Near-term: tighter, lower mean |
| 2026 | 1.00× | 1.0× | **Real data from API** |
| 2027 | 1.35× | 1.4× | More uncertainty, trending up |
| 2028 | 1.70× | 1.8× | Even wider cone |
| 2029 | 2.10× | 2.3× | Maximum uncertainty, highest mean |

Each synthetic year uses `generateGaussian(scaledMean, scaledSpread, numBuckets, lb, ub)` → `evaluateDensityCurve(belief, lb, ub, 300)` to produce density points.

---

## Verification Plan

### Automated Tests
- `npm run dev` → open in browser
- BTC market card → click Trade
- Verify heatmap renders with 5 rows, proper thermal colors
- Verify per-row normalization (each row shows full color range)
- Verify mean dots are white circles at correct positions
- Click a row → PDF detail expands with animation
- For 2026 row: ConsensusChart + TradePanel render correctly
- For synthetic rows: static PDF shown

### Manual Verification
- Check thermal colormap gradient quality — sharp peaks should have tight hot colors, wide distributions should have gradual gradients
- Verify the heatmap is visually beautiful on dark background
- Test row hover and selection interactions
