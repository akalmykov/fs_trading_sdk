import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMarket,
  useConsensus,
  FunctionSpaceContext,
} from '@functionspace/react';
import type { FSContext } from '@functionspace/react';
import {
  computeStatistics,
  computePercentiles,
  evaluateDensityCurve,
  generateBelief,
} from '@functionspace/core';
import type { Region } from '@functionspace/core';
import { ConsensusChart, ConsensusChartContent, TradePanel } from '@functionspace/ui';

/* ── BeliefInterceptor: patches context to capture TradePanel's belief writes ── */
function BeliefInterceptor({ rowIdx, lb, ub, onBeliefChange, children }: {
  rowIdx: number; lb: number; ub: number;
  onBeliefChange: (rowIdx: number, belief: { mean: number; p10: number; p90: number }) => void;
  children: React.ReactNode;
}) {
  const parentCtx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const patchedCtx = useMemo(() => {
    if (!parentCtx) return null;
    return {
      ...parentCtx,
      setPreviewBelief: (belief: number[] | null) => {
        parentCtx.setPreviewBelief(belief);
        if (belief) {
          const stats = computeStatistics(belief, lb, ub);
          const pctiles = computePercentiles(belief, lb, ub);
          onBeliefChange(rowIdx, { mean: stats.mean, p10: pctiles.p12_5, p90: pctiles.p87_5 });
        }
      },
    };
  }, [parentCtx, rowIdx, lb, ub, onBeliefChange]);

  if (!patchedCtx) return null;
  return (
    // @ts-expect-error React types version mismatch between demo-app and packages
    <FunctionSpaceContext.Provider value={patchedCtx as any}>
      {children}
    </FunctionSpaceContext.Provider>
  );
}

/* ── Thermal colormap ── */
const THERMAL_STOPS = [
  { t: 0.00, r:  10, g:  12, b:  28 },
  { t: 0.10, r:  18, g:  28, b:  78 },
  { t: 0.25, r:  25, g:  55, b: 138 },
  { t: 0.40, r:  30, g: 165, b: 190 },
  { t: 0.55, r:  40, g: 188, b: 138 },
  { t: 0.68, r: 130, g: 208, b:  55 },
  { t: 0.80, r: 228, g: 208, b:  35 },
  { t: 0.90, r: 218, g: 135, b:  25 },
  { t: 0.97, r: 198, g:  45, b:  18 },
  { t: 1.00, r: 255, g: 252, b: 240 },
];

function thermalRGB(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  let lo = THERMAL_STOPS[0], hi = THERMAL_STOPS[1];
  for (let i = 1; i < THERMAL_STOPS.length; i++) {
    if (clamped <= THERMAL_STOPS[i].t) {
      lo = THERMAL_STOPS[i - 1];
      hi = THERMAL_STOPS[i];
      break;
    }
    if (i === THERMAL_STOPS.length - 1) {
      lo = THERMAL_STOPS[i - 1];
      hi = THERMAL_STOPS[i];
    }
  }
  const s = hi.t === lo.t ? 1 : (clamped - lo.t) / (hi.t - lo.t);
  return [
    Math.round(lo.r + s * (hi.r - lo.r)),
    Math.round(lo.g + s * (hi.g - lo.g)),
    Math.round(lo.b + s * (hi.b - lo.b)),
  ];
}

/* ── Synthetic expiry configuration ── */
interface ExpiryRow {
  year: number;
  label: string;
  sublabel: string;
  isReal: boolean;
  regions?: Region[];  // used for synthetic years
}

const EXPIRY_ROWS: ExpiryRow[] = [
  { year: 2026, label: '2026', sublabel: 'Dec 31, 2026', isReal: true },
  {
    year: 2027, label: '2027', sublabel: 'Dec 31, 2027', isReal: false,
    // Unimodal, slight right skew, peak ~90-95K
    regions: [
      { type: 'point', center: 92000, spread: 22000, weight: 1, skew: 0.3 },
    ],
  },
  {
    year: 2028, label: '2028', sublabel: 'Dec 31, 2028', isReal: false,
    // Narrower, drifting right, clean unimodal ~110-120K
    regions: [
      { type: 'point', center: 115000, spread: 18000, weight: 1 },
    ],
  },
  {
    year: 2029, label: '2029', sublabel: 'Dec 31, 2029', isReal: false,
    // Still narrowing, confident ~130-140K
    regions: [
      { type: 'point', center: 135000, spread: 15000, weight: 1 },
    ],
  },
  {
    year: 2030, label: '2030', sublabel: 'Dec 31, 2030', isReal: false,
    // Wide uncertainty, fat tails both directions
    regions: [
      { type: 'point', center: 140000, spread: 38000, weight: 1 },
      { type: 'point', center: 30000, spread: 12000, weight: 0.15 },  // bear tail spike
      { type: 'point', center: 195000, spread: 8000, weight: 0.12 },  // bull tail spike
    ],
  },
];

const HEATMAP_COLS = 300;  // horizontal resolution
const ROW_HEIGHT = 72;     // px per expiry row

/* ── helpers ── */
function formatPrice(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return v.toFixed(0);
}

/* ── types ── */
interface RowData {
  year: number;
  label: string;
  sublabel: string;
  densities: number[];     // length = HEATMAP_COLS
  maxDensity: number;
  mean: number;
  isReal: boolean;
  densityCurve: { x: number; y: number }[];
}

/* ── Per-row canvas sub-component ── */
function HeatmapRowCanvas({
  row,
  isSelected,
  isHovered,
  lb,
  ub,
}: {
  row: RowData;
  isSelected: boolean;
  isHovered: boolean;
  lb: number;
  ub: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    if (w === 0) return;

    canvas.width = w * dpr;
    canvas.height = ROW_HEIGHT * dpr;
    canvas.style.height = `${ROW_HEIGHT}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Paint thermal heatmap with Gaussian blur kernel
    const cellW = w / HEATMAP_COLS;
    for (let col = 0; col < HEATMAP_COLS; col++) {
      let blurred = 0;
      let weightSum = 0;
      const kernelSize = 5;
      for (let k = -kernelSize; k <= kernelSize; k++) {
        const idx = col + k;
        if (idx < 0 || idx >= HEATMAP_COLS) continue;
        const weight = Math.exp(-0.5 * (k / 2) * (k / 2));
        blurred += row.densities[idx] * weight;
        weightSum += weight;
      }
      blurred /= weightSum;

      const t = row.maxDensity > 0 ? blurred / row.maxDensity : 0;
      const [r, g, b] = thermalRGB(t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col * cellW, 0, cellW + 0.5, ROW_HEIGHT);
    }

    // Hover / selected border
    if (isSelected || isHovered) {
      ctx.strokeStyle = isSelected ? '#60a5fa' : 'rgba(96,165,250,0.4)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(0, 0.5, w - 0.5, ROW_HEIGHT - 1);
    }
  }, [row, isSelected, isHovered, lb, ub]);

  return (
    <canvas
      ref={canvasRef}
      className="heatmap-canvas"
      style={{ width: '100%', display: 'block' }}
    />
  );
}

/* ── Component ── */
export interface TermStructureHeatmapProps {
  marketId: string | number;
}

/* ── Synthetic PDF Chart (re-uses ConsensusChartContent with synthetic data) ── */
function SyntheticPdfChart({ curve, lb, ub, height, market }: { curve: { x: number; y: number }[]; lb: number; ub: number; height: number; market: any }) {
  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const hasPreview = !!ctx?.previewBelief;
  const syntheticConsensus = useMemo(() => ({ points: curve, config: market.config }), [curve, market.config]);
  const subtitle = hasPreview ? 'Compare market consensus with your trade preview' : 'Current market probability density';
  return (
    <div className="fs-chart-container">
      <div className="fs-chart-header">
        <div className="fs-chart-header-row">
          <div>
            <h3 className="fs-chart-title">{market.title || 'Consensus'}</h3>
            <p className="fs-chart-subtitle">{subtitle}</p>
          </div>
        </div>
      </div>
      <ConsensusChartContent market={market} consensus={syntheticConsensus} height={height} />
    </div>
  );
}

/* ── Belief bracket (drawn below selected heatmap row, draggable) ── */
function BeliefBracket({ lb, ub, userBelief, onDrag }: {
  lb: number; ub: number;
  userBelief: { mean: number; p10: number; p90: number };
  onDrag?: (mean: number, halfWidth: number) => void;
}) {
  const p10Pct = ((userBelief.p10 - lb) / (ub - lb)) * 100;
  const p90Pct = ((userBelief.p90 - lb) / (ub - lb)) * 100;
  const meanPct = ((userBelief.mean - lb) / (ub - lb)) * 100;
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: 'left' | 'right' | 'move') => {
    if (!onDrag || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef.current;
    const startX = e.clientX;
    const startMean = userBelief.mean;
    const startP10 = userBelief.p10;
    const startP90 = userBelief.p90;
    const range = ub - lb;

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = ((ev.clientX - startX) / rect.width) * range;
      if (mode === 'move') {
        const newMean = Math.max(lb, Math.min(ub, startMean + dx));
        const hw = (startP90 - startP10) / 2;
        onDrag(newMean, hw);
      } else if (mode === 'left') {
        const newP10 = Math.max(lb, Math.min(startP90 - range * 0.02, startP10 + dx));
        const newHw = (startP90 - newP10) / 2;
        const newMean = newP10 + newHw;
        onDrag(newMean, newHw);
      } else {
        const newP90 = Math.min(ub, Math.max(startP10 + range * 0.02, startP90 + dx));
        const newHw = (newP90 - startP10) / 2;
        const newMean = startP10 + newHw;
        onDrag(newMean, newHw);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onDrag, userBelief, lb, ub]);

  return (
    <div className="heatmap-belief-bracket" ref={containerRef}>
      <div className="heatmap-bracket-line" style={{ left: `${p10Pct}%`, width: `${p90Pct - p10Pct}%`, cursor: onDrag ? 'grab' : undefined }}
        onPointerDown={onDrag ? (e) => handlePointerDown(e, 'move') : undefined} />
      <div className="heatmap-bracket-tick" style={{ left: `${p10Pct}%`, cursor: onDrag ? 'ew-resize' : undefined }}
        onPointerDown={onDrag ? (e) => handlePointerDown(e, 'left') : undefined} />
      <div className="heatmap-bracket-tick" style={{ left: `${p90Pct}%`, cursor: onDrag ? 'ew-resize' : undefined }}
        onPointerDown={onDrag ? (e) => handlePointerDown(e, 'right') : undefined} />
      <div className="heatmap-bracket-dot" style={{ left: `${meanPct}%`, cursor: onDrag ? 'grab' : undefined }}
        onPointerDown={onDrag ? (e) => handlePointerDown(e, 'move') : undefined} />
    </div>
  );
}

export function TermStructureHeatmap({ marketId }: TermStructureHeatmapProps) {
  const { market } = useMarket(marketId);
  const { consensus } = useConsensus(marketId, 300);
  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [savedBeliefs, setSavedBeliefs] = useState<Record<number, { mean: number; p10: number; p90: number }>>({});
  const [perRowState, setPerRowState] = useState<Record<number, { prediction?: number; confidence?: number; amount?: string }>>({});

  // Per-row prediction/confidence (no cross-contamination)
  const prediction = selectedRow !== null ? perRowState[selectedRow]?.prediction : undefined;
  const confidence = selectedRow !== null ? perRowState[selectedRow]?.confidence : undefined;
  const setPrediction = useCallback((val: number) => {
    if (selectedRow !== null) setPerRowState(prev => ({ ...prev, [selectedRow]: { ...prev[selectedRow], prediction: val } }));
  }, [selectedRow]);
  const setConfidence = useCallback((val: number) => {
    if (selectedRow !== null) setPerRowState(prev => ({ ...prev, [selectedRow]: { ...prev[selectedRow], confidence: val } }));
  }, [selectedRow]);
  const amount = selectedRow !== null ? perRowState[selectedRow]?.amount : undefined;
  const setAmount = useCallback((val: string) => {
    if (selectedRow !== null) setPerRowState(prev => ({ ...prev, [selectedRow]: { ...prev[selectedRow], amount: val } }));
  }, [selectedRow]);

  const lb = market?.config?.lowerBound ?? 0;
  const ub = market?.config?.upperBound ?? 200000;
  const numBuckets = market?.config?.numBuckets ?? 80;

  // Convert halfWidth to confidence (inverse of TradePanel's formula)
  const halfWidthToConfidence = useCallback((hw: number) => {
    const range = ub - lb;
    const minSigma = range * 0.01;
    const maxSigma = range * 0.20;
    const sigma = hw / 1.15; // p12.5/p87.5 ≈ ±1.15σ
    return Math.max(0, Math.min(100, ((maxSigma - sigma) / (maxSigma - minSigma)) * 100));
  }, [lb, ub]);

  const handleBracketDrag = useCallback((mean: number, halfWidth: number) => {
    setPrediction(+mean.toFixed(2));
    setConfidence(Math.round(halfWidthToConfidence(halfWidth)));
    if (selectedRow !== null) {
      setSavedBeliefs(prev => ({ ...prev, [selectedRow]: { mean: +mean.toFixed(2), p10: +mean.toFixed(2) - halfWidth, p90: +mean.toFixed(2) + halfWidth } }));
    }
  }, [halfWidthToConfidence, selectedRow]);

  // Callback for BeliefInterceptor
  const handleBeliefFromPanel = useCallback((rowIdx: number, belief: { mean: number; p10: number; p90: number }) => {
    setSavedBeliefs(prev => ({ ...prev, [rowIdx]: belief }));
  }, []);

  // userBelief for display: from savedBeliefs only (never from shared previewBelief)
  const userBelief = useMemo(() => selectedRow !== null ? (savedBeliefs[selectedRow] ?? null) : null, [savedBeliefs, selectedRow]);

  /* ── Build row data from real consensus + synthetic ── */
  const rows = useMemo<RowData[]>(() => {
    if (!market || !consensus) return [];

    const stats = computeStatistics(market.consensus, lb, ub);

    return EXPIRY_ROWS.map((expiry) => {
      let densityCurve: { x: number; y: number }[];
      let mean: number;

      if (expiry.isReal) {
        densityCurve = consensus.points;
        mean = stats.mean;
      } else {
        const belief = generateBelief(expiry.regions!, numBuckets, lb, ub);
        densityCurve = evaluateDensityCurve(belief, lb, ub, 300);
        const synStats = computeStatistics(belief, lb, ub);
        mean = synStats.mean;
      }

      const densities: number[] = [];
      for (let i = 0; i < HEATMAP_COLS; i++) {
        const price = lb + (ub - lb) * (i + 0.5) / HEATMAP_COLS;
        let best = densityCurve[0];
        let bestDist = Math.abs(densityCurve[0].x - price);
        for (const pt of densityCurve) {
          const d = Math.abs(pt.x - price);
          if (d < bestDist) { best = pt; bestDist = d; }
        }
        densities.push(best.y);
      }

      const maxDensity = Math.max(...densities);

      return {
        year: expiry.year,
        label: expiry.label,
        sublabel: expiry.sublabel,
        densities,
        maxDensity,
        mean,
        isReal: expiry.isReal,
        densityCurve,
      };
    });
  }, [market, consensus, lb, ub, numBuckets]);

  // Bracket is created by BeliefInterceptor on first TradePanel render

  /* ── Price axis ticks ── */
  const xTicks = useMemo(() => {
    const ticks: { label: string; pct: number }[] = [];
    const step = ub <= 10000 ? 1000 : ub <= 50000 ? 10000 : ub <= 500000 ? 50000 : 100000;
    for (let v = 0; v <= ub; v += step) {
      ticks.push({ label: formatPrice(v), pct: (v - lb) / (ub - lb) * 100 });
    }
    return ticks;
  }, [lb, ub]);

  if (!market || !consensus) {
    return (
      <div className="heatmap-card" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Loading market data…</span>
      </div>
    );
  }

  return (
    <div className="heatmap-card">
      {/* ── Header ── */}
      <div className="heatmap-header">
        <div>
          <h2 className="heatmap-title">Term Structure Heatmap</h2>
          <p className="heatmap-subtitle">Brighter colors indicate higher probability density.</p>
        </div>
        <div className="heatmap-view-badge">View: Heatmap</div>
      </div>

      {/* ── Heatmap body ── */}
      <div className="heatmap-body">
        <div className="heatmap-y-label">Expiry</div>

        {/* Per-row rendering with inline detail panels */}
        {rows.map((row, i) => (
          <React.Fragment key={row.year}>
            {/* Row: label + canvas side by side */}
            <div
              className={`heatmap-inline-row ${i === selectedRow ? 'selected' : ''} ${i === hoverRow ? 'hovered' : ''}`}
              onMouseEnter={() => setHoverRow(i)}
              onMouseLeave={() => setHoverRow(null)}
              onClick={() => setSelectedRow(prev => prev === i ? null : i)}
            >
              <div className="heatmap-row-label-inline">
                <strong>{row.label}</strong>
                <span>{row.sublabel}</span>
              </div>
              <div className="heatmap-row-canvas-wrap">
                <HeatmapRowCanvas
                  row={row}
                  isSelected={i === selectedRow}
                  isHovered={i === hoverRow}
                  lb={lb}
                  ub={ub}
                />
              </div>
            </div>

            {/* User belief bracket — show saved belief for this row, or live belief if selected */}
            {(i === selectedRow ? userBelief : savedBeliefs[i]) && (
              <BeliefBracket lb={lb} ub={ub} userBelief={(i === selectedRow ? userBelief : savedBeliefs[i])!} onDrag={(mean, hw) => { if (i !== selectedRow) setSelectedRow(i); handleBracketDrag(mean, hw); }} />
            )}

            {/* Inline detail panel — expands between rows */}
            <div className={`heatmap-inline-detail ${i === selectedRow ? 'open' : ''}`}>
              {i === selectedRow && (
                <BeliefInterceptor rowIdx={i} lb={lb} ub={ub} onBeliefChange={handleBeliefFromPanel}>
                  <div className="heatmap-detail-header">
                    <h3>
                      {row.label} Distribution Detail
                      <span className="heatmap-selected-badge">Selected Expiry</span>
                    </h3>
                    <button
                      className="heatmap-collapse-btn"
                      onClick={(e) => { e.stopPropagation(); setSelectedRow(null); }}
                    >
                      Collapse ▴
                    </button>
                  </div>
                  <div className="heatmap-detail-body">
                    <div className="heatmap-detail-real">
                      <div style={{ flex: 7, minWidth: 0 }}>
                        {row.isReal ? (
                          <ConsensusChart marketId={marketId} height={340} zoomable />
                        ) : (
                          <SyntheticPdfChart curve={row.densityCurve} lb={lb} ub={ub} height={340} market={market} />
                        )}
                      </div>
                      <div style={{ flex: 3, minWidth: 0 }}>
                        <TradePanel marketId={marketId} modes={['gaussian', 'range']} prediction={prediction} confidence={confidence} onPredictionChange={setPrediction} onConfidenceChange={setConfidence} amount={amount} onAmountChange={setAmount} />
                      </div>
                    </div>
                  </div>
                </BeliefInterceptor>
              )}
            </div>
          </React.Fragment>
        ))}

        {/* X-axis ticks */}
        <div className="heatmap-x-axis">
          {xTicks.map((tick) => (
            <span
              key={tick.label}
              className="heatmap-x-tick"
              style={{ left: `${tick.pct}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <div className="heatmap-x-label">Price</div>
      </div>
    </div>
  );
}

