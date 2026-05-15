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
import { ConsensusChart, TradePanel, PositionTable } from '@functionspace/ui';

/* ── Thermal colormap (same as BTC heatmap) ── */
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

/* ── Expiry columns ── */
interface ExpiryCol {
  year: number;
  label: string;
  isReal: boolean;
  regions?: Region[];
}

const EXPIRY_COLS: ExpiryCol[] = [
  { year: 2026, label: '2026', isReal: true },
  {
    year: 2027, label: '2027', isReal: false,
    // SOL drifting up, slight right skew, peak ~$220
    regions: [
      { type: 'point', center: 220, spread: 65, weight: 1, skew: 0.2 },
    ],
  },
  {
    year: 2028, label: '2028', isReal: false,
    // Broader, higher ~$320
    regions: [
      { type: 'point', center: 320, spread: 80, weight: 1 },
    ],
  },
  {
    year: 2029, label: '2029', isReal: false,
    // Still rising ~$450, moderate spread
    regions: [
      { type: 'point', center: 450, spread: 100, weight: 1 },
    ],
  },
  {
    year: 2030, label: '2030', isReal: false,
    // Wide uncertainty, fat tails
    regions: [
      { type: 'point', center: 600, spread: 180, weight: 1 },
      { type: 'point', center: 50, spread: 30, weight: 0.12 },   // bear tail
      { type: 'point', center: 1200, spread: 60, weight: 0.1 },  // bull tail
    ],
  },
];

const HEATMAP_ROWS = 200;  // vertical resolution (price axis)
const COL_WIDTH = 120;     // px per expiry column

/* ── Types ── */
interface ColData {
  year: number;
  label: string;
  isReal: boolean;
  densities: number[];  // length = HEATMAP_ROWS (bottom=lb, top=ub)
  maxDensity: number;
  mean: number;
  densityCurve: { x: number; y: number }[];
}

/* ── Synthetic PDF Chart (static canvas rendering) ── */
function SyntheticPdfChart({ curve, lb, ub, height }: { curve: { x: number; y: number }[]; lb: number; ub: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const previewBelief = ctx?.previewBelief ?? null;

  const previewCurve = useMemo(() => {
    if (!previewBelief) return null;
    return evaluateDensityCurve(previewBelief, lb, ub, 200);
  }, [previewBelief, lb, ub]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || curve.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.scale(dpr, dpr);

    const pad = { top: 20, bottom: 30, left: 10, right: 10 };
    const plotW = w - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    let maxY = Math.max(...curve.map(p => p.y));
    if (previewCurve) maxY = Math.max(maxY, ...previewCurve.map(p => p.y));

    c.fillStyle = '#0d1117';
    c.fillRect(0, 0, w, height);

    c.strokeStyle = 'rgba(88,101,128,0.2)';
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH / 4) * i;
      c.beginPath(); c.moveTo(pad.left, y); c.lineTo(w - pad.right, y); c.stroke();
    }

    c.beginPath();
    c.moveTo(pad.left, pad.top + plotH);
    for (const pt of curve) {
      c.lineTo(pad.left + ((pt.x - lb) / (ub - lb)) * plotW, pad.top + plotH - (pt.y / maxY) * plotH);
    }
    c.lineTo(pad.left + plotW, pad.top + plotH);
    c.closePath();
    c.fillStyle = 'rgba(59, 130, 246, 0.2)';
    c.fill();

    c.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const px = pad.left + ((curve[i].x - lb) / (ub - lb)) * plotW;
      const py = pad.top + plotH - (curve[i].y / maxY) * plotH;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.strokeStyle = '#3b82f6';
    c.lineWidth = 2;
    c.stroke();

    if (previewCurve) {
      c.beginPath();
      c.moveTo(pad.left, pad.top + plotH);
      for (const pt of previewCurve) {
        c.lineTo(pad.left + ((pt.x - lb) / (ub - lb)) * plotW, pad.top + plotH - (pt.y / maxY) * plotH);
      }
      c.lineTo(pad.left + plotW, pad.top + plotH);
      c.closePath();
      c.fillStyle = 'rgba(249, 115, 22, 0.12)';
      c.fill();

      c.beginPath();
      for (let i = 0; i < previewCurve.length; i++) {
        const px = pad.left + ((previewCurve[i].x - lb) / (ub - lb)) * plotW;
        const py = pad.top + plotH - (previewCurve[i].y / maxY) * plotH;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.setLineDash([6, 4]);
      c.strokeStyle = '#f97316';
      c.lineWidth = 2;
      c.stroke();
      c.setLineDash([]);
    }

    c.fillStyle = '#64748b';
    c.font = '11px Inter, sans-serif';
    c.textAlign = 'center';
    const step = ub <= 500 ? 50 : ub <= 2000 ? 200 : ub <= 5000 ? 500 : 1000;
    for (let v = 0; v <= ub; v += step) {
      const px = pad.left + ((v - lb) / (ub - lb)) * plotW;
      c.fillText(`$${v}`, px, height - 8);
    }

    c.fillStyle = '#94a3b8';
    c.font = '12px Inter, sans-serif';
    c.textAlign = 'left';
    c.fillText('Synthetic Consensus PDF', pad.left + 4, pad.top - 6);
  }, [curve, lb, ub, height, previewCurve]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block', borderRadius: 8, border: '1px solid #1e293b' }}
    />
  );
}

/* ── Component ── */
export interface SolTermHeatmapProps {
  marketId: string | number;
}

export function SolTermHeatmap({ marketId }: SolTermHeatmapProps) {
  const { market } = useMarket(marketId);
  const { consensus } = useConsensus(marketId, 300);
  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const lb = market?.config?.lowerBound ?? 0;
  const ub = market?.config?.upperBound ?? 3000;
  const numBuckets = market?.config?.numBuckets ?? 80;

  /* ── User belief bracket ── */
  const userBelief = useMemo(() => {
    const belief = ctx?.previewBelief;
    if (!belief || !market) return null;
    const stats = computeStatistics(belief, lb, ub);
    const pctiles = computePercentiles(belief, lb, ub);
    return { mean: stats.mean, p10: pctiles.p12_5, p90: pctiles.p87_5 };
  }, [ctx?.previewBelief, market, lb, ub]);

  /* ── Build column data ── */
  const cols = useMemo<ColData[]>(() => {
    if (!market || !consensus) return [];

    const stats = computeStatistics(market.consensus, lb, ub);

    return EXPIRY_COLS.map((col) => {
      let densityCurve: { x: number; y: number }[];
      let mean: number;

      if (col.isReal) {
        densityCurve = consensus.points;
        mean = stats.mean;
      } else {
        const belief = generateBelief(col.regions!, numBuckets, lb, ub);
        densityCurve = evaluateDensityCurve(belief, lb, ub, 300);
        const synStats = computeStatistics(belief, lb, ub);
        mean = synStats.mean;
      }

      // Sample density along the price axis (bottom to top)
      const densities: number[] = [];
      for (let i = 0; i < HEATMAP_ROWS; i++) {
        const price = lb + (ub - lb) * (i + 0.5) / HEATMAP_ROWS;
        let best = densityCurve[0];
        let bestDist = Math.abs(densityCurve[0].x - price);
        for (const pt of densityCurve) {
          const d = Math.abs(pt.x - price);
          if (d < bestDist) { best = pt; bestDist = d; }
        }
        densities.push(best.y);
      }

      return { year: col.year, label: col.label, isReal: col.isReal, densities, maxDensity: Math.max(...densities), mean, densityCurve };
    });
  }, [market, consensus, lb, ub, numBuckets]);

  /* ── Render canvas ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cols.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    ctx2d.scale(dpr, dpr);

    const colW = w / cols.length;
    const cellH = h / HEATMAP_ROWS;

    // Paint each column
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      for (let row = 0; row < HEATMAP_ROWS; row++) {
        // Apply Gaussian blur vertically
        let blurred = 0, weightSum = 0;
        const kernelSize = 4;
        for (let k = -kernelSize; k <= kernelSize; k++) {
          const idx = row + k;
          if (idx < 0 || idx >= HEATMAP_ROWS) continue;
          const weight = Math.exp(-0.5 * (k / 1.8) * (k / 1.8));
          blurred += col.densities[idx] * weight;
          weightSum += weight;
        }
        blurred /= weightSum;

        const t = col.maxDensity > 0 ? blurred / col.maxDensity : 0;
        const [r, g, b] = thermalRGB(t);
        ctx2d.fillStyle = `rgb(${r},${g},${b})`;
        // Draw from bottom (high price) to top (low price) — invert y
        const y = h - (row + 1) * cellH;
        ctx2d.fillRect(c * colW, y, colW + 0.5, cellH + 0.5);
      }

      // Column separator
      if (c > 0) {
        ctx2d.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(c * colW, 0);
        ctx2d.lineTo(c * colW, h);
        ctx2d.stroke();
      }

      // Hover/selected highlight
      if (c === selectedCol || c === hoverCol) {
        ctx2d.strokeStyle = c === selectedCol ? '#60a5fa' : 'rgba(96,165,250,0.4)';
        ctx2d.lineWidth = c === selectedCol ? 2 : 1;
        ctx2d.strokeRect(c * colW + 0.5, 0.5, colW - 1, h - 1);
      }
    }

    // User belief bracket (vertical bar on the selected column)
    if (userBelief && selectedCol !== null) {
      const colX = selectedCol * colW;
      const p10Y = h - ((userBelief.p10 - lb) / (ub - lb)) * h;
      const p90Y = h - ((userBelief.p90 - lb) / (ub - lb)) * h;
      const meanY = h - ((userBelief.mean - lb) / (ub - lb)) * h;
      const bracketX = colX + colW - 12;
      const tickW = 6;

      ctx2d.strokeStyle = '#f59e0b';
      ctx2d.lineWidth = 1.5;
      ctx2d.setLineDash([]);

      // Vertical connecting line
      ctx2d.beginPath();
      ctx2d.moveTo(bracketX, p90Y);
      ctx2d.lineTo(bracketX, p10Y);
      ctx2d.stroke();

      // Top tick
      ctx2d.beginPath();
      ctx2d.moveTo(bracketX - tickW / 2, p90Y);
      ctx2d.lineTo(bracketX + tickW / 2, p90Y);
      ctx2d.stroke();

      // Bottom tick
      ctx2d.beginPath();
      ctx2d.moveTo(bracketX - tickW / 2, p10Y);
      ctx2d.lineTo(bracketX + tickW / 2, p10Y);
      ctx2d.stroke();

      // Mean dot
      ctx2d.beginPath();
      ctx2d.arc(bracketX, meanY, 4, 0, Math.PI * 2);
      ctx2d.fillStyle = '#f59e0b';
      ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    }
  }, [cols, selectedCol, hoverCol, lb, ub, userBelief]);

  /* ── Price axis ticks ── */
  const yTicks = useMemo(() => {
    const ticks: { label: string; pct: number }[] = [];
    const step = ub <= 500 ? 50 : ub <= 2000 ? 200 : ub <= 5000 ? 500 : 1000;
    for (let v = 0; v <= ub; v += step) {
      ticks.push({ label: `$${v}`, pct: ((v - lb) / (ub - lb)) * 100 });
    }
    return ticks;
  }, [lb, ub]);

  /* ── Click handler ── */
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || cols.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colW = canvas.clientWidth / cols.length;
    const colIdx = Math.floor(x / colW);
    if (colIdx >= 0 && colIdx < cols.length) {
      setSelectedCol(prev => prev === colIdx ? null : colIdx);
    }
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || cols.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colW = canvas.clientWidth / cols.length;
    const colIdx = Math.floor(x / colW);
    setHoverCol(colIdx >= 0 && colIdx < cols.length ? colIdx : null);
  };

  if (!market || !consensus) {
    return (
      <div className="sol-heatmap-card" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Loading market data…</span>
      </div>
    );
  }

  const selectedColData = selectedCol !== null ? cols[selectedCol] : null;

  return (
    <div className="sol-heatmap-card">
      <div className="heatmap-header">
        <div>
          <h2 className="heatmap-title">SOL Term Structure</h2>
          <p className="heatmap-subtitle">Price × Time — click a column for details</p>
        </div>
        <div className="heatmap-view-badge">Transposed View</div>
      </div>

      <div className="sol-heatmap-body">
        {/* Y-axis (price) */}
        <div className="sol-heatmap-y-axis">
          {yTicks.map(tick => (
            <span key={tick.label} className="sol-heatmap-y-tick" style={{ bottom: `${tick.pct}%` }}>
              {tick.label}
            </span>
          ))}
        </div>

        {/* Canvas */}
        <div className="sol-heatmap-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="sol-heatmap-canvas"
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onMouseLeave={() => setHoverCol(null)}
          />
          {/* X-axis (time) labels */}
          <div className="sol-heatmap-x-axis">
            {cols.map((col, i) => (
              <span key={col.year} className="sol-heatmap-x-tick" style={{ left: `${(i + 0.5) / cols.length * 100}%` }}>
                {col.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      <div className={`heatmap-inline-detail ${selectedCol !== null ? 'open' : ''}`}>
        {selectedCol !== null && selectedColData && (
          <>
            <div className="heatmap-detail-header">
              <h3>
                {selectedColData.label} Distribution Detail
                <span className="heatmap-selected-badge">{selectedColData.isReal ? 'Live Data' : 'Synthetic'}</span>
              </h3>
              <button className="heatmap-collapse-btn" onClick={() => setSelectedCol(null)}>
                Collapse ▴
              </button>
            </div>
            <div className="heatmap-detail-body">
              <div className="heatmap-detail-real">
                <div style={{ flex: 7, minWidth: 0 }}>
                  {selectedColData.isReal ? (
                    <ConsensusChart marketId={marketId} height={300} zoomable />
                  ) : (
                    <SyntheticPdfChart curve={selectedColData.densityCurve} lb={lb} ub={ub} height={300} />
                  )}
                </div>
                <div style={{ flex: 3, minWidth: 0 }}>
                  <TradePanel marketId={marketId} modes={['gaussian', 'range']} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
