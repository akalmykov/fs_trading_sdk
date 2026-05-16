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
} from '@functionspace/core';
import { ConsensusChart, TradePanel, PositionTable, PasswordlessAuthWidget, MarketStats } from '@functionspace/ui';

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
    if (clamped <= THERMAL_STOPS[i].t) { lo = THERMAL_STOPS[i - 1]; hi = THERMAL_STOPS[i]; break; }
    if (i === THERMAL_STOPS.length - 1) { lo = THERMAL_STOPS[i - 1]; hi = THERMAL_STOPS[i]; }
  }
  const s = hi.t === lo.t ? 1 : (clamped - lo.t) / (hi.t - lo.t);
  return [
    Math.round(lo.r + s * (hi.r - lo.r)),
    Math.round(lo.g + s * (hi.g - lo.g)),
    Math.round(lo.b + s * (hi.b - lo.b)),
  ];
}

/* ── Market configs ── */
const MARKETS = [
  { id: 250, year: 2026, label: '2026', sublabel: 'Dec 31, 2026' },
  { id: 251, year: 2027, label: '2027', sublabel: 'Dec 31, 2027' },
  { id: 252, year: 2028, label: '2028', sublabel: 'Dec 31, 2028' },
  { id: 253, year: 2029, label: '2029', sublabel: 'Dec 31, 2029' },
  { id: 254, year: 2030, label: '2030', sublabel: 'Dec 31, 2030' },
];

const HEATMAP_COLS = 300;
const ROW_HEIGHT = 72;

/* ── Types ── */
interface RowData {
  year: number;
  label: string;
  sublabel: string;
  marketId: number;
  lb: number;
  ub: number;
  densities: number[];
  maxDensity: number;
  mean: number;
}

/* ── Per-row canvas ── */
function HeatmapRowCanvas({ row, isSelected, isHovered, globalLb, globalUb }: {
  row: RowData; isSelected: boolean; isHovered: boolean; globalLb: number; globalUb: number;
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

    const cellW = w / HEATMAP_COLS;
    for (let col = 0; col < HEATMAP_COLS; col++) {
      let blurred = 0, weightSum = 0;
      for (let k = -5; k <= 5; k++) {
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

    // Draw market bounds as vertical dashed lines
    const lbX = ((row.lb - globalLb) / (globalUb - globalLb)) * w;
    const ubX = ((row.ub - globalLb) / (globalUb - globalLb)) * w;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    if (lbX > 1) { ctx.beginPath(); ctx.moveTo(lbX, 0); ctx.lineTo(lbX, ROW_HEIGHT); ctx.stroke(); }
    if (ubX < w - 1) { ctx.beginPath(); ctx.moveTo(ubX, 0); ctx.lineTo(ubX, ROW_HEIGHT); ctx.stroke(); }
    ctx.setLineDash([]);

    // Hover/selected border
    if (isSelected || isHovered) {
      ctx.strokeStyle = isSelected ? '#60a5fa' : 'rgba(96,165,250,0.4)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(0, 0.5, w - 0.5, ROW_HEIGHT - 1);
    }
  }, [row, isSelected, isHovered, globalLb, globalUb]);

  return <canvas ref={canvasRef} className="heatmap-canvas" style={{ width: '100%', display: 'block' }} />;
}

/* ── Belief bracket ── */
function BeliefBracket({ globalLb, globalUb, marketLb, marketUb, userBelief, onDrag }: {
  globalLb: number; globalUb: number; marketLb: number; marketUb: number;
  userBelief: { mean: number; p10: number; p90: number };
  onDrag?: (mean: number, halfWidth: number) => void;
}) {
  const p10Pct = ((userBelief.p10 - globalLb) / (globalUb - globalLb)) * 100;
  const p90Pct = ((userBelief.p90 - globalLb) / (globalUb - globalLb)) * 100;
  const meanPct = ((userBelief.mean - globalLb) / (globalUb - globalLb)) * 100;
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
    const range = globalUb - globalLb;

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = ((ev.clientX - startX) / rect.width) * range;
      if (mode === 'move') {
        const newMean = Math.max(marketLb, Math.min(marketUb, startMean + dx));
        const hw = (startP90 - startP10) / 2;
        const clampedHw = Math.min(hw, newMean - marketLb, marketUb - newMean);
        onDrag(newMean, Math.max(clampedHw, (marketUb - marketLb) * 0.01));
      } else if (mode === 'left') {
        const newP10 = Math.max(marketLb, Math.min(startP90 - range * 0.01, startP10 + dx));
        const newHw = (startP90 - newP10) / 2;
        onDrag(newP10 + newHw, newHw);
      } else {
        const newP90 = Math.min(marketUb, Math.max(startP10 + range * 0.01, startP90 + dx));
        const newHw = (newP90 - startP10) / 2;
        onDrag(startP10 + newHw, newHw);
      }
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onDrag, userBelief, globalLb, globalUb, marketLb, marketUb]);

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

/* ── Helper: format price ── */
function formatPrice(v: number): string {
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${v.toFixed(0)}`;
}

/* ── Component ── */
export function BtcMultiTermHeatmap() {
  // Fetch all 5 markets
  const m0 = useMarket(250), c0 = useConsensus(250, 300);
  const m1 = useMarket(251), c1 = useConsensus(251, 300);
  const m2 = useMarket(252), c2 = useConsensus(252, 300);
  const m3 = useMarket(253), c3 = useConsensus(253, 300);
  const m4 = useMarket(254), c4 = useConsensus(254, 300);

  const markets = [m0, m1, m2, m3, m4];
  const consensuses = [c0, c1, c2, c3, c4];

  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [savedBeliefs, setSavedBeliefs] = useState<Record<number, { mean: number; p10: number; p90: number }>>({});
  const [prediction, setPrediction] = useState<number | undefined>(undefined);
  const [confidence, setConfidence] = useState<number | undefined>(undefined);

  const allLoaded = markets.every(m => m.market) && consensuses.every(c => c.consensus);

  // Global bounds (largest range across all markets)
  const globalLb = useMemo(() => {
    if (!allLoaded) return 0;
    return Math.min(...markets.map(m => m.market!.config.lowerBound));
  }, [allLoaded, markets]);

  const globalUb = useMemo(() => {
    if (!allLoaded) return 712000;
    return Math.max(...markets.map(m => m.market!.config.upperBound));
  }, [allLoaded, markets]);

  // Build row data
  const rows = useMemo<RowData[]>(() => {
    if (!allLoaded) return [];

    return MARKETS.map((cfg, i) => {
      const market = markets[i].market!;
      const consensus = consensuses[i].consensus!;
      const lb = market.config.lowerBound;
      const ub = market.config.upperBound;
      const stats = computeStatistics(market.consensus, lb, ub);

      // Sample density on the global axis
      const densities: number[] = [];
      for (let col = 0; col < HEATMAP_COLS; col++) {
        const price = globalLb + (globalUb - globalLb) * (col + 0.5) / HEATMAP_COLS;
        if (price < lb || price > ub) { densities.push(0); continue; }
        // Find nearest point in consensus curve
        let best = consensus.points[0];
        let bestDist = Math.abs(consensus.points[0].x - price);
        for (const pt of consensus.points) {
          const d = Math.abs(pt.x - price);
          if (d < bestDist) { best = pt; bestDist = d; }
        }
        densities.push(best.y);
      }

      return {
        year: cfg.year, label: cfg.label, sublabel: cfg.sublabel,
        marketId: cfg.id, lb, ub, densities,
        maxDensity: Math.max(...densities),
        mean: stats.mean,
      };
    });
  }, [allLoaded]);

  // User belief from context
  const selectedMarketLb = selectedRow !== null && rows[selectedRow] ? rows[selectedRow].lb : 0;
  const selectedMarketUb = selectedRow !== null && rows[selectedRow] ? rows[selectedRow].ub : 712000;

  const userBelief = useMemo(() => {
    const belief = ctx?.previewBelief;
    if (!belief || selectedRow === null || !rows[selectedRow]) return null;
    const { lb, ub } = rows[selectedRow];
    const stats = computeStatistics(belief, lb, ub);
    const pctiles = computePercentiles(belief, lb, ub);
    return { mean: stats.mean, p10: pctiles.p12_5, p90: pctiles.p87_5 };
  }, [ctx?.previewBelief, selectedRow, rows]);

  // Save belief when it changes
  useEffect(() => {
    if (userBelief && selectedRow !== null) {
      setSavedBeliefs(prev => ({ ...prev, [selectedRow]: userBelief }));
    }
  }, [userBelief, selectedRow]);

  // Drag handler
  const halfWidthToConfidence = useCallback((hw: number, lb: number, ub: number) => {
    const range = ub - lb;
    const minSigma = range * 0.01;
    const maxSigma = range * 0.20;
    const sigma = hw / 1.15;
    return Math.max(0, Math.min(100, Math.round(((maxSigma - sigma) / (maxSigma - minSigma)) * 100)));
  }, []);

  const handleBracketDrag = useCallback((rowIdx: number, mean: number, halfWidth: number) => {
    if (rowIdx !== selectedRow) setSelectedRow(rowIdx);
    const row = rows[rowIdx];
    if (!row) return;
    setPrediction(+mean.toFixed(2));
    setConfidence(halfWidthToConfidence(halfWidth, row.lb, row.ub));
  }, [selectedRow, rows, halfWidthToConfidence]);

  // Price axis ticks
  const xTicks = useMemo(() => {
    const ticks: { label: string; pct: number }[] = [];
    const step = globalUb <= 50000 ? 10000 : globalUb <= 500000 ? 50000 : 100000;
    for (let v = Math.ceil(globalLb / step) * step; v <= globalUb; v += step) {
      ticks.push({ label: formatPrice(v), pct: ((v - globalLb) / (globalUb - globalLb)) * 100 });
    }
    return ticks;
  }, [globalLb, globalUb]);

  if (!allLoaded) {
    return (
      <div className="heatmap-card" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Loading multi-term market data…</span>
      </div>
    );
  }

  const selectedRowData = selectedRow !== null ? rows[selectedRow] : null;

  return (
    <div className="heatmap-card">
      <div className="heatmap-header">
        <div>
          <h2 className="heatmap-title">Bitcoin Multi-Term Year-End Closing Price</h2>
          <p className="heatmap-subtitle">Real consensus data from 5 markets (2026–2030). Click a row to trade.</p>
        </div>
      </div>

      <div className="heatmap-body">
        <div className="heatmap-y-label">Expiry</div>

        {rows.map((row, i) => (
          <React.Fragment key={row.year}>
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
                <HeatmapRowCanvas row={row} isSelected={i === selectedRow} isHovered={i === hoverRow} globalLb={globalLb} globalUb={globalUb} />
              </div>
            </div>

            {/* Belief bracket */}
            {(i === selectedRow ? userBelief : savedBeliefs[i]) && (
              <BeliefBracket
                globalLb={globalLb} globalUb={globalUb}
                marketLb={row.lb} marketUb={row.ub}
                userBelief={(i === selectedRow ? userBelief : savedBeliefs[i])!}
                onDrag={(mean, hw) => handleBracketDrag(i, mean, hw)}
              />
            )}

            {/* Detail panel */}
            <div className={`heatmap-inline-detail ${i === selectedRow ? 'open' : ''}`}>
              {i === selectedRow && (
                <>
                  <div className="heatmap-detail-header">
                    <h3>
                      {row.label} — {markets[i].market!.title}
                      <span className="heatmap-selected-badge">Live Data</span>
                    </h3>
                    <button className="heatmap-collapse-btn" onClick={(e) => { e.stopPropagation(); setSelectedRow(null); }}>
                      Collapse ▴
                    </button>
                  </div>
                  <div className="heatmap-detail-body">
                    <div className="heatmap-detail-real">
                      <div style={{ flex: 7, minWidth: 0 }}>
                        <ConsensusChart marketId={row.marketId} height={340} zoomable />
                      </div>
                      <div style={{ flex: 3, minWidth: 0 }}>
                        <TradePanel marketId={row.marketId} modes={['gaussian', 'range']} prediction={prediction} confidence={confidence} onPredictionChange={setPrediction} onConfidenceChange={setConfidence} />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </React.Fragment>
        ))}

        {/* X-axis ticks */}
        <div className="heatmap-x-axis">
          {xTicks.map((tick) => (
            <span key={tick.label} className="heatmap-x-tick" style={{ left: `${tick.pct}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div className="heatmap-x-label">Price (USD)</div>
      </div>
    </div>
  );
}
