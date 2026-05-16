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
} from '@functionspace/core';
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
  { id: 255, label: 'Jun', sublabel: 'June 2026' },
  { id: 256, label: 'Jul', sublabel: 'July 2026' },
  { id: 257, label: 'Aug', sublabel: 'August 2026' },
  { id: 258, label: 'Sep', sublabel: 'September 2026' },
  { id: 259, label: 'Oct', sublabel: 'October 2026' },
  { id: 260, label: 'Nov', sublabel: 'November 2026' },
];

const HEATMAP_ROWS = 200;

/* ── Types ── */
interface ColData {
  label: string;
  sublabel: string;
  marketId: number;
  densities: number[];
  maxDensity: number;
  mean: number;
  densityCurve: { x: number; y: number }[];
}

/* ── Component ── */
export function SpMultiTermHeatmap() {
  const m0 = useMarket(255), c0 = useConsensus(255, 300);
  const m1 = useMarket(256), c1 = useConsensus(256, 300);
  const m2 = useMarket(257), c2 = useConsensus(257, 300);
  const m3 = useMarket(258), c3 = useConsensus(258, 300);
  const m4 = useMarket(259), c4 = useConsensus(259, 300);
  const m5 = useMarket(260), c5 = useConsensus(260, 300);

  const markets = [m0, m1, m2, m3, m4, m5];
  const consensuses = [c0, c1, c2, c3, c4, c5];

  const ctx = React.useContext(FunctionSpaceContext as unknown as React.Context<FSContext | null>);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [savedBeliefs, setSavedBeliefs] = useState<Record<number, { mean: number; p10: number; p90: number }>>({});
  const [prediction, setPrediction] = useState<number | undefined>(undefined);
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'top' | 'bottom'; startY: number; startMean: number; startP10: number; startP90: number } | null>(null);
  const didDragRef = useRef(false);

  const allLoaded = markets.every(m => m.market) && consensuses.every(c => c.consensus);

  // All markets share bounds [3700, 11100]
  const lb = markets[0]?.market?.config?.lowerBound ?? 3700;
  const ub = markets[0]?.market?.config?.upperBound ?? 11100;

  // User belief
  const userBelief = useMemo(() => {
    const belief = ctx?.previewBelief;
    if (!belief || selectedCol === null) return null;
    const stats = computeStatistics(belief, lb, ub);
    const pctiles = computePercentiles(belief, lb, ub);
    return { mean: stats.mean, p10: pctiles.p12_5, p90: pctiles.p87_5 };
  }, [ctx?.previewBelief, selectedCol, lb, ub]);

  useEffect(() => {
    if (userBelief && selectedCol !== null) {
      setSavedBeliefs(prev => ({ ...prev, [selectedCol]: userBelief }));
    }
  }, [userBelief, selectedCol]);

  const halfWidthToConfidence = useCallback((hw: number) => {
    const range = ub - lb;
    const minSigma = range * 0.01;
    const maxSigma = range * 0.20;
    const sigma = hw / 1.15;
    return Math.max(0, Math.min(100, Math.round(((maxSigma - sigma) / (maxSigma - minSigma)) * 100)));
  }, [lb, ub]);

  // Build column data
  const cols = useMemo<ColData[]>(() => {
    if (!allLoaded) return [];
    return MARKETS.map((cfg, i) => {
      const market = markets[i].market!;
      const consensus = consensuses[i].consensus!;
      const stats = computeStatistics(market.consensus, lb, ub);

      const densities: number[] = [];
      for (let row = 0; row < HEATMAP_ROWS; row++) {
        const price = lb + (ub - lb) * (row + 0.5) / HEATMAP_ROWS;
        let best = consensus.points[0];
        let bestDist = Math.abs(consensus.points[0].x - price);
        for (const pt of consensus.points) {
          const d = Math.abs(pt.x - price);
          if (d < bestDist) { best = pt; bestDist = d; }
        }
        densities.push(best.y);
      }

      return {
        label: cfg.label, sublabel: cfg.sublabel, marketId: cfg.id,
        densities, maxDensity: Math.max(...densities), mean: stats.mean,
        densityCurve: consensus.points,
      };
    });
  }, [allLoaded]);

  // Canvas drag handler
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || cols.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const h = rect.height;
    const colW = rect.width / cols.length;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find which column's bracket is near
    const allBeliefs: Record<number, { mean: number; p10: number; p90: number }> = { ...savedBeliefs };
    if (userBelief && selectedCol !== null) allBeliefs[selectedCol] = userBelief;

    let targetCol: number | null = null;
    for (const [colIdx] of Object.entries(allBeliefs)) {
      const c = Number(colIdx);
      const bracketX = c * colW + colW - 12;
      if (Math.abs(x - bracketX) <= 15) { targetCol = c; break; }
    }
    if (targetCol === null) return;

    const belief = allBeliefs[targetCol];
    if (!belief) return;

    const p10Y = h - ((belief.p10 - lb) / (ub - lb)) * h;
    const p90Y = h - ((belief.p90 - lb) / (ub - lb)) * h;

    let mode: 'move' | 'top' | 'bottom';
    if (Math.abs(y - p90Y) < 10) mode = 'top';
    else if (Math.abs(y - p10Y) < 10) mode = 'bottom';
    else if (y > p90Y && y < p10Y) mode = 'move';
    else return;

    e.preventDefault();
    e.stopPropagation();
    didDragRef.current = true;
    if (targetCol !== selectedCol) setSelectedCol(targetCol);
    dragRef.current = { mode, startY: e.clientY, startMean: belief.mean, startP10: belief.p10, startP90: belief.p90 };

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dy = ev.clientY - dragRef.current.startY;
      const pricePerPx = (ub - lb) / h;
      const dp = -dy * pricePerPx;

      if (dragRef.current.mode === 'move') {
        const newMean = Math.max(lb, Math.min(ub, dragRef.current.startMean + dp));
        const hw = (dragRef.current.startP90 - dragRef.current.startP10) / 2;
        setPrediction(+newMean.toFixed(2));
        setConfidence(Math.round(halfWidthToConfidence(hw)));
      } else if (dragRef.current.mode === 'top') {
        const newP90 = Math.min(ub, Math.max(dragRef.current.startP10 + (ub - lb) * 0.02, dragRef.current.startP90 + dp));
        const hw = (newP90 - dragRef.current.startP10) / 2;
        setPrediction(+(dragRef.current.startP10 + hw).toFixed(2));
        setConfidence(Math.round(halfWidthToConfidence(hw)));
      } else {
        const newP10 = Math.max(lb, Math.min(dragRef.current.startP90 - (ub - lb) * 0.02, dragRef.current.startP10 + dp));
        const hw = (dragRef.current.startP90 - newP10) / 2;
        setPrediction(+(newP10 + hw).toFixed(2));
        setConfidence(Math.round(halfWidthToConfidence(hw)));
      }
    };
    const onUp = () => { dragRef.current = null; setTimeout(() => { didDragRef.current = false; }, 50); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [selectedCol, cols, userBelief, savedBeliefs, lb, ub, halfWidthToConfidence]);

  // Render canvas
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

    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      for (let row = 0; row < HEATMAP_ROWS; row++) {
        let blurred = 0, weightSum = 0;
        for (let k = -4; k <= 4; k++) {
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
        const y = h - (row + 1) * cellH;
        ctx2d.fillRect(c * colW, y, colW + 0.5, cellH + 0.5);
      }

      // Column separator
      if (c > 0) {
        ctx2d.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath(); ctx2d.moveTo(c * colW, 0); ctx2d.lineTo(c * colW, h); ctx2d.stroke();
      }

      // Hover/selected
      if (c === selectedCol || c === hoverCol) {
        ctx2d.strokeStyle = c === selectedCol ? '#60a5fa' : 'rgba(96,165,250,0.4)';
        ctx2d.lineWidth = c === selectedCol ? 2 : 1;
        ctx2d.strokeRect(c * colW + 0.5, 0.5, colW - 1, h - 1);
      }
    }

    // Draw all belief brackets
    const allBeliefs: Record<number, { mean: number; p10: number; p90: number }> = { ...savedBeliefs };
    if (userBelief && selectedCol !== null) allBeliefs[selectedCol] = userBelief;

    for (const [colIdx, belief] of Object.entries(allBeliefs)) {
      const c = Number(colIdx);
      const colX = c * colW;
      const p10Y = h - ((belief.p10 - lb) / (ub - lb)) * h;
      const p90Y = h - ((belief.p90 - lb) / (ub - lb)) * h;
      const meanY = h - ((belief.mean - lb) / (ub - lb)) * h;
      const bracketX = colX + colW - 12;
      const tickW = 6;
      const isActive = c === selectedCol;

      ctx2d.globalAlpha = isActive ? 1 : 0.6;
      ctx2d.strokeStyle = '#f59e0b';
      ctx2d.lineWidth = 1.5;
      ctx2d.setLineDash([]);

      ctx2d.beginPath(); ctx2d.moveTo(bracketX, p90Y); ctx2d.lineTo(bracketX, p10Y); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.moveTo(bracketX - tickW / 2, p90Y); ctx2d.lineTo(bracketX + tickW / 2, p90Y); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.moveTo(bracketX - tickW / 2, p10Y); ctx2d.lineTo(bracketX + tickW / 2, p10Y); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.arc(bracketX, meanY, 4, 0, Math.PI * 2);
      ctx2d.fillStyle = '#f59e0b'; ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(0,0,0,0.6)'; ctx2d.lineWidth = 1.5; ctx2d.stroke();
      ctx2d.globalAlpha = 1;
    }
  }, [cols, selectedCol, hoverCol, lb, ub, userBelief, savedBeliefs]);

  // Price axis ticks
  const yTicks = useMemo(() => {
    const ticks: { label: string; pct: number }[] = [];
    const step = 1000;
    for (let v = Math.ceil(lb / step) * step; v <= ub; v += step) {
      ticks.push({ label: v.toLocaleString(), pct: ((v - lb) / (ub - lb)) * 100 });
    }
    return ticks;
  }, [lb, ub]);

  // Click/hover handlers
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didDragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas || cols.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colW = canvas.clientWidth / cols.length;
    const colIdx = Math.floor(x / colW);
    if (colIdx >= 0 && colIdx < cols.length) setSelectedCol(prev => prev === colIdx ? null : colIdx);
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

  if (!allLoaded) {
    return (
      <div className="sol-heatmap-card" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Loading S&P 500 market data…</span>
      </div>
    );
  }

  const selectedColData = selectedCol !== null ? cols[selectedCol] : null;

  return (
    <div className="sol-heatmap-card">
      <div className="heatmap-header">
        <div>
          <h2 className="heatmap-title">S&P 500 Multi-Month Term Structure</h2>
          <p className="heatmap-subtitle">Real consensus data — June through November 2026. Click a column to trade.</p>
        </div>
      </div>

      <div className="sol-heatmap-body">
        <div className="sol-heatmap-y-axis">
          {yTicks.map(tick => (
            <span key={tick.label} className="sol-heatmap-y-tick" style={{ bottom: `${tick.pct}%` }}>
              {tick.label}
            </span>
          ))}
        </div>

        <div className="sol-heatmap-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="sol-heatmap-canvas"
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onMouseLeave={() => setHoverCol(null)}
            onPointerDown={handleCanvasPointerDown}
          />
          <div className="sol-heatmap-x-axis">
            {cols.map((col, i) => (
              <span key={col.marketId} className="sol-heatmap-x-tick" style={{ left: `${(i + 0.5) / cols.length * 100}%` }}>
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
                {selectedColData.sublabel} — S&P 500
                <span className="heatmap-selected-badge">Live Data</span>
              </h3>
              <button className="heatmap-collapse-btn" onClick={() => setSelectedCol(null)}>Collapse ▴</button>
            </div>
            <div className="heatmap-detail-body">
              <div className="heatmap-detail-real">
                <div style={{ flex: 7, minWidth: 0 }}>
                  <ConsensusChart marketId={selectedColData.marketId} height={300} zoomable />
                </div>
                <div style={{ flex: 3, minWidth: 0 }}>
                  <TradePanel marketId={selectedColData.marketId} modes={['gaussian', 'range']} prediction={prediction} confidence={confidence} onPredictionChange={setPrediction} onConfidenceChange={setConfidence} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
