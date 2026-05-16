import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
} from 'lightweight-charts';
import { useMarket, useConsensus } from '@functionspace/react';
import { computeStatistics, evaluateDensityCurve } from '@functionspace/core';

/* ── types ── */
type Candle = { time: string; open: number; high: number; low: number; close: number };

export interface ConePriceChartProps {
  marketId: string | number;
  prediction: number | null;
  confidence: number;
  onPredictionChange: (prediction: number) => void;
  onConfidenceChange: (confidence: number) => void;
  onLatestClose?: (latestClose: number) => void;
  height?: number;
}

/* ── constants ── */
const CONE_COLOR = 'rgba(249, 115, 22, 0.35)';
const CONE_LINE_COLOR = 'rgba(249, 115, 22, 0.8)';
const CONSENSUS_PDF_COLOR = 'rgba(59, 130, 246, 0.6)';
const CONSENSUS_PDF_LINE = '#3b82f6';
const USER_PDF_COLOR = 'rgba(249, 115, 22, 0.45)';
const USER_PDF_LINE = '#f97316';
const SETTLEMENT_COLOR = '#c084fc';

/* ── helpers ── */
const WTI_FRED_CSV = import.meta.env.DEV
  ? '/fred/graph/fredgraph.csv?id=DCOILWTICO'
  : 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILWTICO';

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(t: string, n: number) { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return toISO(d); }
function daysBetween(a: string, b: string) { return Math.max(1, Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000)); }

function parseSettlementDate(title: string) {
  const m = title.match(/on\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return '2026-12-31';
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? '2026-12-31' : toISO(d);
}

function makeFallbackCandles(): Candle[] {
  const end = new Date('2026-04-27T00:00:00Z');
  const out: Candle[] = [];
  let close = 68.42;
  for (let i = 255; i >= 0; i--) {
    const d = new Date(end); d.setUTCDate(end.getUTCDate() - i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const wave = Math.sin(i / 15) * 1.5 + Math.cos(i / 37) * 1.1;
    const open = close + Math.sin(i * 0.7) * 0.9;
    close = clamp(open + wave * 0.28 + Math.sin(i * 1.9) * 0.8, 55, 104);
    const high = Math.max(open, close) + 1.1 + Math.abs(Math.sin(i)) * 1.6;
    const low = Math.min(open, close) - 1.1 - Math.abs(Math.cos(i)) * 1.6;
    out.push({ time: toISO(d), open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2) });
  }
  return out;
}

async function fetchWtiCandles(signal: AbortSignal): Promise<Candle[]> {
  const r = await fetch(WTI_FRED_CSV, { signal });
  if (!r.ok) throw new Error('fetch failed');
  const csv = await r.text();
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const closes = rows
    .map(row => { const [date, val] = row.split(','); const c = Number(val); return Number.isFinite(c) && c > 0 ? { date, close: c } : null; })
    .filter((r): r is { date: string; close: number } => r !== null)
    .slice(-320);
  return closes.map((row, i) => {
    const prev = closes[Math.max(0, i - 1)]?.close ?? row.close;
    return { time: row.date, open: +prev.toFixed(2), high: +(Math.max(prev, row.close) + 0.75).toFixed(2), low: +(Math.min(prev, row.close) - 0.75).toFixed(2), close: +row.close.toFixed(2) };
  });
}

/** Confidence → stdDev (same logic as TradePanel) */
function confidenceToStdDev(conf: number, lb: number, ub: number) {
  const range = ub - lb;
  const minSigma = range * 0.01;
  const maxSigma = range * 0.20;
  return maxSigma - (conf / 100) * (maxSigma - minSigma);
}

/** StdDev → confidence (inverse) */
function stdDevToConfidence(sigma: number, lb: number, ub: number) {
  const range = ub - lb;
  const minSigma = range * 0.01;
  const maxSigma = range * 0.20;
  return clamp(((maxSigma - sigma) / (maxSigma - minSigma)) * 100, 0, 100);
}

/* ── Component ── */
export function ConePriceChart({
  marketId,
  prediction,
  confidence,
  onPredictionChange,
  onConfidenceChange,
  onLatestClose,
  height = 655,
}: ConePriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const coneUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const coneLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const coneFillRef = useRef<ISeriesApi<'Area'> | null>(null);
  const coneCenterRef = useRef<ISeriesApi<'Line'> | null>(null);
  const hiddenExtRef = useRef<ISeriesApi<'Line'> | null>(null);
  const drawingRef = useRef(false);
  const drawStartRef = useRef<{ price: number } | null>(null);

  const [candles, setCandles] = useState<Candle[]>([]);
  const { market } = useMarket(marketId);
  const { consensus } = useConsensus(marketId, 200);

  const bounds = market?.config;
  const lb = bounds?.lowerBound ?? 0;
  const ub = bounds?.upperBound ?? 450;
  const settlementDate = useMemo(() => parseSettlementDate(market?.title ?? ''), [market?.title]);
  const latest = candles[candles.length - 1] ?? null;

  /* ── fetch candles ── */
  useEffect(() => {
    const ac = new AbortController();
    fetchWtiCandles(ac.signal)
      .then(c => setCandles(c.length > 0 ? c : makeFallbackCandles()))
      .catch(err => {
        // Don't set fallback if the fetch was aborted (e.g. StrictMode cleanup)
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setCandles(makeFallbackCandles());
      });
    return () => ac.abort();
  }, []);

  /* ── init prediction from latest price ── */
  useEffect(() => {
    if (!latest || !bounds) return;
    const val = +clamp(latest.close, lb, ub).toFixed(2);
    onLatestClose?.(val);
  }, [latest, bounds]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── build cone data from prediction/confidence ── */
  const coneData = useMemo(() => {
    if (!latest || prediction === null || !bounds) return null;
    const sigma = confidenceToStdDev(confidence, lb, ub);
    const latDate = latest.time;
    const days = daysBetween(latDate, settlementDate);
    if (days <= 0) return null;

    const steps = Math.min(days, 120);
    const upper: { time: string; value: number }[] = [];
    const lower: { time: string; value: number }[] = [];
    const center: { time: string; value: number }[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const date = addDays(latDate, Math.round(t * days));
      const mean = latest.close + (prediction - latest.close) * t;
      const halfWidth = sigma * t * 3; // ±3σ: edges where probability mass ≈ 0
      upper.push({ time: date, value: Math.min(ub, mean + halfWidth) });
      lower.push({ time: date, value: Math.max(lb, mean - halfWidth) });
      center.push({ time: date, value: mean });
    }
    return { upper, lower, center };
  }, [latest, prediction, confidence, bounds, lb, ub, settlementDate]);

  /* ── create chart (once) ── */
  useEffect(() => {
    if (!containerRef.current || chartApiRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#070b12' },
        textColor: '#aab2c0',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(88,101,128,0.16)' },
        horzLines: { color: 'rgba(88,101,128,0.24)' },
      },
      rightPriceScale: { borderColor: 'rgba(115,131,166,0.35)' },
      timeScale: {
        borderColor: 'rgba(115,131,166,0.35)',
        rightOffset: 20,
        barSpacing: 4,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: false,
      handleScale: false,
      crosshair: { mode: 0 },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#7dd3a8', wickDownColor: '#f87171',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    chartApiRef.current = chart;
    candleRef.current = candleSeries;

    const ro = new ResizeObserver(([e]) => {
      chart.applyOptions({ width: e.contentRect.width, height });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartApiRef.current = null; candleRef.current = null; };
  }, [height]);

  /* ── set candle data + extend time axis to settlement ── */
  useEffect(() => {
    const chart = chartApiRef.current;
    const cs = candleRef.current;
    if (!chart || !cs || candles.length === 0) return;

    cs.setData(candles as any);

    // Anchor series: extend x-axis past settlement AND force Y-axis to cover
    // the full market price bounds [lb, ub] so that the rotated PDFs at the
    // settlement line are visible and proportional.
    const buf = addDays(settlementDate, 40);
    const latDate = candles[candles.length - 1].time;
    const yPadding = (ub - lb) * 0.04; // small padding so bounds aren't clipped

    const ext = chart.addSeries(LineSeries, {
      color: 'rgba(0,0,0,0)', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      // THIS is the key: provide custom autoscale info that forces
      // the price axis to cover the full market bounds
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: lb - yPadding, maxValue: ub + yPadding },
      }),
    });
    ext.setData([
      { time: latDate as any, value: lb },
      { time: buf as any, value: ub },
    ]);
    hiddenExtRef.current = ext;

    // set visible range: ~50% history, ~50% future
    const daysToSet = daysBetween(latDate, settlementDate);
    const visFrom = addDays(latDate, -daysToSet);
    requestAnimationFrame(() => {
      chart.timeScale().setVisibleRange({ from: visFrom as any, to: buf as any });
    });

    return () => { if (chartApiRef.current) chart.removeSeries(ext); hiddenExtRef.current = null; };
  }, [candles, settlementDate, lb, ub]);

  /* ── draw cone overlay ── */
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart || !coneData) return;

    // Shared options to prevent cone from stretching Y-axis
    const coneOpts = {
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => null, // don't affect auto-scale
    };

    // center line (dashed)
    const centerSeries = chart.addSeries(LineSeries, {
      color: CONE_LINE_COLOR, lineWidth: 2, lineStyle: 2,
      ...coneOpts,
    });
    centerSeries.setData(coneData.center as any);
    coneCenterRef.current = centerSeries;

    // upper bound
    const upperSeries = chart.addSeries(LineSeries, {
      color: CONE_LINE_COLOR, lineWidth: 1, lineStyle: 2,
      ...coneOpts,
    });
    upperSeries.setData(coneData.upper as any);
    coneUpperRef.current = upperSeries;

    // lower bound
    const lowerSeries = chart.addSeries(LineSeries, {
      color: CONE_LINE_COLOR, lineWidth: 1, lineStyle: 2,
      ...coneOpts,
    });
    lowerSeries.setData(coneData.lower as any);
    coneLowerRef.current = lowerSeries;

    return () => {
      if (chartApiRef.current) {
        chart.removeSeries(centerSeries);
        chart.removeSeries(upperSeries);
        chart.removeSeries(lowerSeries);
      }
      coneCenterRef.current = null;
      coneUpperRef.current = null;
      coneLowerRef.current = null;
    };
  }, [coneData]);

  /* ── settlement line pixel position (HTML overlay) ── */
  const [settlementX, setSettlementX] = useState<number | null>(null);

  const updateSettlementX = useCallback(() => {
    const chart = chartApiRef.current;
    const el = containerRef.current;
    if (!chart || !el) { setSettlementX(null); return; }
    const coord = chart.timeScale().timeToCoordinate(settlementDate as any);
    if (typeof coord === 'number' && Number.isFinite(coord)) {
      setSettlementX(clamp(coord, 0, el.clientWidth));
    } else {
      setSettlementX(el.clientWidth * 0.79);
    }
  }, [settlementDate]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const handler = () => updateSettlementX();
    chart.timeScale().subscribeVisibleTimeRangeChange(handler);
    requestAnimationFrame(handler);
    return () => { if (chartApiRef.current) chart.timeScale().unsubscribeVisibleTimeRangeChange(handler); };
  }, [updateSettlementX, candles]);

  /* ── consensus PDF overlay (canvas) ── */
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = pdfCanvasRef.current;
    const chart = chartApiRef.current;
    if (!canvas || !chart || settlementX === null || !consensus || !bounds) return;

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    const points = consensus.points;
    if (points.length === 0) return;

    // We draw the PDF rotated: x-axis of PDF becomes vertical (price axis),
    // y-axis of PDF becomes horizontal (going left from settlement line).
    // Both distributions are normalised to their own peak → same visual max width,
    // so neither one looks "too tall" or "too flat".
    const maxDensity = Math.max(...points.map(p => p.y));
    if (maxDensity <= 0) return;

    const pdfWidth = 140; // max horizontal pixels the PDF curve extends

    const cs = candleRef.current;
    if (!cs) return;

    const sx = settlementX;

    // Helper: draw a single rotated PDF
    const drawPdf = (
      pts: { x: number; y: number }[],
      peak: number,
      fillStyle: string,
      strokeStyle: string,
      dash?: number[],
    ) => {
      if (peak <= 0) return;
      ctx2d.save();
      ctx2d.beginPath();
      if (dash) ctx2d.setLineDash(dash);
      let started = false;
      for (const pt of pts) {
        const py = cs.priceToCoordinate(pt.x);
        if (py === null || !Number.isFinite(py)) continue;
        // Normalise to OWN peak so every PDF fills the same max width
        const px = sx - (pt.y / peak) * pdfWidth;
        if (!started) { ctx2d.moveTo(sx, py); started = true; }
        ctx2d.lineTo(px, py);
      }
      const last = pts[pts.length - 1];
      const ly = cs.priceToCoordinate(last.x);
      if (ly !== null) ctx2d.lineTo(sx, ly);
      ctx2d.closePath();
      ctx2d.fillStyle = fillStyle;
      ctx2d.fill();
      ctx2d.strokeStyle = strokeStyle;
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
      ctx2d.restore();
    };

    // Draw consensus PDF (blue)
    drawPdf(points, maxDensity, CONSENSUS_PDF_COLOR, CONSENSUS_PDF_LINE);

    // Draw user Gaussian PDF (orange, dashed)
    if (prediction !== null && bounds) {
      const sigma = confidenceToStdDev(confidence, lb, ub);
      const userPoints: { x: number; y: number }[] = [];
      const step = (ub - lb) / 200;
      for (let x = lb; x <= ub; x += step) {
        const z = (x - prediction) / sigma;
        const y = Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
        userPoints.push({ x, y });
      }
      const userMax = Math.max(...userPoints.map(p => p.y));
      drawPdf(userPoints, userMax, USER_PDF_COLOR, USER_PDF_LINE, [6, 4]);
    }
  }, [settlementX, consensus, bounds, prediction, confidence, lb, ub, candles]);

  /* ── interactive cone drawing ── */
  // Dragging in the future zone only adjusts the PREDICTION (center line).
  // Confidence (cone width) is preserved from the slider.
  useEffect(() => {
    const chart = chartApiRef.current;
    const el = containerRef.current;
    if (!chart || !el || !latest || !bounds) return;

    const latDate = latest.time;
    const days = daysBetween(latDate, settlementDate);
    if (days <= 0) return;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      // Only start drawing in the future zone (right of latest candle)
      const latCoord = chart.timeScale().timeToCoordinate(latDate as any);
      if (latCoord !== null && x < latCoord) return;
      drawingRef.current = true;
      const cs = candleRef.current;
      if (!cs) return;
      const price = cs.coordinateToPrice(e.clientY - rect.top);
      if (price !== null) drawStartRef.current = { price };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!drawingRef.current || !drawStartRef.current) return;
      const rect = el.getBoundingClientRect();
      const cs = candleRef.current;
      if (!cs) return;
      const price = cs.coordinateToPrice(e.clientY - rect.top);
      if (price === null) return;

      const settCoord = chart.timeScale().timeToCoordinate(settlementDate as any);
      const latCoord = chart.timeScale().timeToCoordinate(latDate as any);
      if (settCoord === null || latCoord === null) return;

      const x = e.clientX - rect.left;
      // Fraction along the cone from latest to settlement
      const frac = clamp((x - latCoord) / (settCoord - latCoord), 0.01, 1);

      // mean at settlement = extrapolated from latest through current mouse
      const meanAtSettlement = latest.close + (price - latest.close) / frac;
      const clampedMean = clamp(meanAtSettlement, lb, ub);

      // Only update prediction — confidence stays as-is from the slider
      onPredictionChange(+clampedMean.toFixed(2));
    };

    const handleMouseUp = () => {
      drawingRef.current = false;
      drawStartRef.current = null;
    };

    el.addEventListener('mousedown', handleMouseDown);
    el.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
      el.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [latest, bounds, settlementDate, lb, ub, onPredictionChange]);

  /* ── resize canvas to match container ── */
  useEffect(() => {
    const el = containerRef.current;
    const canvas = pdfCanvasRef.current;
    if (!el || !canvas) return;
    const ro = new ResizeObserver(([e]) => {
      canvas.width = e.contentRect.width;
      canvas.height = e.contentRect.height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── compute display values ── */
  const sigma = bounds ? confidenceToStdDev(confidence, lb, ub) : 0;
  const consensusStats = useMemo(() => {
    if (!market) return null;
    return computeStatistics(market.consensus, lb, ub);
  }, [market, lb, ub]);

  return (
    <div className="cone-chart-card" style={{ height }}>
      <div className="cone-chart-toolbar">
        <div>
          <span className="cone-chart-eyebrow">Chart View</span>
          <strong>{market?.title ?? 'Price-Series Market'}</strong>
        </div>
        <div className="cone-chart-legend">
          <span><i className="legend-swatch consensus" /> Consensus</span>
          <span><i className="legend-swatch cone" /> Your Cone</span>
          <span><i className="legend-swatch settlement" /> Settlement</span>
        </div>
      </div>

      <div className="cone-chart-stage">
        <div ref={containerRef} className="cone-chart-canvas-host" />
        <canvas
          ref={pdfCanvasRef}
          className="cone-chart-pdf-canvas"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}
        />
        {settlementX !== null && (
          <div className="cone-chart-settlement-line" style={{ left: `${settlementX}px` }}>
            <div className="cone-chart-settlement-label">
              Settlement<br />{settlementDate}
            </div>
          </div>
        )}
      </div>

      <div className="cone-chart-footer">
        <div className="cone-chart-info-pills">
          {latest && (
            <span className="cone-info-pill">
              Latest: <strong>${latest.close.toFixed(2)}</strong>
            </span>
          )}
          {consensusStats && (
            <span className="cone-info-pill consensus-pill">
              Consensus μ: <strong>${consensusStats.mean.toFixed(1)}</strong>
            </span>
          )}
          {prediction !== null && (
            <span className="cone-info-pill cone-pill">
              Your μ: <strong>${prediction.toFixed(1)}</strong> · σ: <strong>{sigma.toFixed(1)}</strong>
            </span>
          )}
        </div>
        <span className="cone-draw-hint">Click &amp; drag in future zone to draw cone</span>
      </div>
    </div>
  );
}
