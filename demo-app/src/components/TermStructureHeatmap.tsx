import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { ConsensusChart, TradePanel } from '@functionspace/ui';

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

    // Consensus mean dot
    const meanX = ((row.mean - lb) / (ub - lb)) * w;
    const dotY = ROW_HEIGHT / 2;

    const grad = ctx.createRadialGradient(meanX, dotY, 0, meanX, dotY, 12);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(meanX, dotY, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(meanX, dotY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(meanX, dotY, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4444';
    ctx.fill();
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

/* ── Belief bracket (drawn below selected heatmap row) ── */
function BeliefBracket({ lb, ub, userBelief }: { lb: number; ub: number; userBelief: { mean: number; p10: number; p90: number } }) {
  const p10Pct = ((userBelief.p10 - lb) / (ub - lb)) * 100;
  const p90Pct = ((userBelief.p90 - lb) / (ub - lb)) * 100;
  const meanPct = ((userBelief.mean - lb) / (ub - lb)) * 100;

  return (
    <div className="heatmap-belief-bracket">
      {/* Horizontal line */}
      <div className="heatmap-bracket-line" style={{ left: `${p10Pct}%`, width: `${p90Pct - p10Pct}%` }} />
      {/* Left tick */}
      <div className="heatmap-bracket-tick" style={{ left: `${p10Pct}%` }} />
      {/* Right tick */}
      <div className="heatmap-bracket-tick" style={{ left: `${p90Pct}%` }} />
      {/* Mean dot */}
      <div className="heatmap-bracket-dot" style={{ left: `${meanPct}%` }} />
    </div>
  );
}

export function TermStructureHeatmap({ marketId }: TermStructureHeatmapProps) {
  const { market } = useMarket(marketId);
  const { consensus } = useConsensus(marketId, 300);
  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);

  const lb = market?.config?.lowerBound ?? 0;
  const ub = market?.config?.upperBound ?? 200000;
  const numBuckets = market?.config?.numBuckets ?? 80;

  /* ── Compute user belief bracket from preview ── */
  const userBelief = useMemo(() => {
    const belief = ctx?.previewBelief;
    if (!belief || !market) return null;
    const stats = computeStatistics(belief, lb, ub);
    const pctiles = computePercentiles(belief, lb, ub);
    return { mean: stats.mean, p10: pctiles.p12_5, p90: pctiles.p87_5 };
  }, [ctx?.previewBelief, market, lb, ub]);

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

            {/* User belief bracket — below selected row, above detail panel */}
            {i === selectedRow && userBelief && (
              <BeliefBracket lb={lb} ub={ub} userBelief={userBelief} />
            )}

            {/* Inline detail panel — expands between rows */}
            <div className={`heatmap-inline-detail ${i === selectedRow ? 'open' : ''}`}>
              {i === selectedRow && (
                <>
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
                        <ConsensusChart marketId={marketId} height={340} zoomable />
                      </div>
                      <div style={{ flex: 3, minWidth: 0 }}>
                        <TradePanel marketId={marketId} modes={['gaussian', 'range']} />
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

