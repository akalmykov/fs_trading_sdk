import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { useMarket, useConsensus } from '@functionspace/react';

type PricePoint = { time: string; value: number };
type ConeState = { prediction: number; confidence: number };
type DragMode = 'mean' | 'upper' | 'lower';

const MARKETS = [
  { id: 250, year: 2026, settlement: '2026-12-31', color: '#14b8a6', label: '2026', opacity: 0.12 },
  { id: 251, year: 2027, settlement: '2027-12-31', color: '#3b82f6', label: '2027', opacity: 0.09 },
  { id: 252, year: 2028, settlement: '2028-12-31', color: '#a855f7', label: '2028', opacity: 0.07 },
  { id: 253, year: 2029, settlement: '2029-12-31', color: '#f97316', label: '2029', opacity: 0.05 },
  { id: 254, year: 2030, settlement: '2030-12-31', color: '#eab308', label: '2030', opacity: 0.03 },
];

const BTC_HISTORY_CACHE_KEY = 'fs:btc-usd-history:1y:v1';
const BTC_HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
const PDF_MAX_WIDTH = 60;
const PRICE_SCALE_WIDTH = 96;
const P10_P90_Z = 1.2815515655446004;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(t: string, n: number) {
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

function btcHistoryStart() {
  return addDays(toISO(new Date()), -365);
}

function zoneLayout(width: number) {
  const plotWidth = Math.max(320, width - PRICE_SCALE_WIDTH);
  const originX = 52;
  const zoneWidth = Math.max(48, (plotWidth - originX) / MARKETS.length);
  return { originX, plotWidth, zoneWidth };
}

function settlementXForZone(zoneIdx: number, width: number) {
  const { originX, zoneWidth } = zoneLayout(width);
  return originX + (zoneIdx + 1) * zoneWidth;
}

function hexToRgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '');
  const value = Number.parseInt(raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatUsd(value: number) {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
  return `$${value.toFixed(0)}`;
}

function generateFallbackBtcHistory(): PricePoint[] {
  const points: PricePoint[] = [];
  const start = new Date(`${btcHistoryStart()}T00:00:00Z`);
  const end = new Date();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dayIdx = Math.round((d.getTime() - start.getTime()) / 86_400_000);
    const trend = Math.sin(dayIdx / 180) * 15000 + dayIdx * 55;
    const noise = Math.sin(dayIdx * 0.3) * 2000 + Math.cos(dayIdx * 0.7) * 1500;
    const price = clamp(16500 + trend + noise, 15000, 115000);
    points.push({ time: toISO(d), value: +price.toFixed(0) });
  }
  return points;
}

function readCachedBtcHistory(): PricePoint[] | null {
  try {
    const raw = localStorage.getItem(BTC_HISTORY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt?: number; points?: PricePoint[] };
    if (!parsed.fetchedAt || !Array.isArray(parsed.points)) return null;
    if (Date.now() - parsed.fetchedAt > BTC_HISTORY_TTL_MS) return null;
    if (parsed.points.length < 30) return null;
    return parsed.points;
  } catch {
    return null;
  }
}

function writeCachedBtcHistory(points: PricePoint[]) {
  try {
    localStorage.setItem(BTC_HISTORY_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), points }));
  } catch {
    // Cache is an optimization only.
  }
}

async function fetchBtcHistory(signal: AbortSignal): Promise<PricePoint[]> {
  const url = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily';
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`CoinGecko history request failed: ${response.status}`);
  const data = await response.json() as { prices?: [number, number][] };
  if (!Array.isArray(data.prices) || data.prices.length === 0) {
    throw new Error('CoinGecko history response did not include prices');
  }

  const byDate = new Map<string, number>();
  for (const [ts, price] of data.prices) {
    if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) continue;
    byDate.set(toISO(new Date(ts)), price);
  }

  const points = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, value]) => ({ time, value: +value.toFixed(2) }));

  if (points.length < 30) throw new Error('CoinGecko history response had too few usable points');
  return points;
}

async function fetchBinanceBtcHistory(signal: AbortSignal): Promise<PricePoint[]> {
  const points: PricePoint[] = [];
  const end = Date.now();
  let start = new Date(`${btcHistoryStart()}T00:00:00Z`).getTime();
  let guard = 0;

  while (start < end && guard < 10) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${start}&endTime=${end}&limit=1000`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Binance BTC history request failed: ${response.status}`);
    const rows = await response.json() as unknown[][];
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      const ts = Number(row[0]);
      const close = Number(row[4]);
      if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
      points.push({ time: toISO(new Date(ts)), value: +close.toFixed(2) });
    }

    const lastTs = Number(rows[rows.length - 1]?.[0]);
    if (!Number.isFinite(lastTs) || lastTs <= start) break;
    start = lastTs + 86_400_000;
    guard += 1;
  }

  const deduped = Array.from(new Map(points.map(point => [point.time, point])).values())
    .sort((a, b) => a.time.localeCompare(b.time));
  if (deduped.length < 365) throw new Error('Binance BTC history response had too few usable points');
  return deduped;
}

function confidenceToStdDev(conf: number, lb: number, ub: number) {
  const range = ub - lb;
  const minSigma = range * 0.01;
  const maxSigma = range * 0.20;
  return maxSigma - (conf / 100) * (maxSigma - minSigma);
}

function stdDevToConfidence(sigma: number, lb: number, ub: number) {
  const range = ub - lb;
  const minSigma = range * 0.01;
  const maxSigma = range * 0.20;
  return clamp(((maxSigma - sigma) / (maxSigma - minSigma)) * 100, 0, 100);
}

function conePricesAtFraction(state: ConeState, frac: number, latestPrice: number, lb: number, ub: number) {
  const t = clamp(frac, 0, 1);
  const center = latestPrice + (state.prediction - latestPrice) * t;
  const sigma = confidenceToStdDev(state.confidence, lb, ub);
  const halfWidth = sigma * t * P10_P90_Z;
  return {
    center,
    upper: Math.min(ub, center + halfWidth),
    lower: Math.max(lb, center - halfWidth),
  };
}

function buildNeutralCone(latestPrice: number, lb: number, ub: number): ConeState {
  return { prediction: +clamp(latestPrice, lb, ub).toFixed(0), confidence: 50 };
}

function cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  let x = t;
  for (let i = 0; i < 5; i += 1) {
    const estimate = ((ax * x + bx) * x + cx) * x - t;
    const slope = (3 * ax * x + 2 * bx) * x + cx;
    if (Math.abs(slope) < 1e-4) break;
    x = clamp(x - estimate / slope, 0, 1);
  }
  return ((ay * x + by) * x + cy) * x;
}

export function BtcMultiConeChart({ height = 700 }: { height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const historySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const drawingRef = useRef<{ zoneIdx: number; mode: DragMode } | null>(null);
  const focusProgressRef = useRef(0);
  const focusAnimationRef = useRef<number | null>(null);

  const [coneStates, setConeStates] = useState<Record<number, ConeState>>({});
  const [activeZoneIdx, setActiveZoneIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<PricePoint[]>(() => generateFallbackBtcHistory());
  const [historySource, setHistorySource] = useState<'loading' | 'coingecko' | 'binance' | 'cache' | 'fallback'>('loading');
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);

  const m0 = useMarket(250), c0 = useConsensus(250, 300);
  const m1 = useMarket(251), c1 = useConsensus(251, 300);
  const m2 = useMarket(252), c2 = useConsensus(252, 300);
  const m3 = useMarket(253), c3 = useConsensus(253, 300);
  const m4 = useMarket(254), c4 = useConsensus(254, 300);

  const markets = useMemo(() => [m0.market, m1.market, m2.market, m3.market, m4.market], [m0.market, m1.market, m2.market, m3.market, m4.market]);
  const consensuses = useMemo(() => [c0.consensus, c1.consensus, c2.consensus, c3.consensus, c4.consensus], [c0.consensus, c1.consensus, c2.consensus, c3.consensus, c4.consensus]);
  const allLoaded = markets.every(Boolean) && consensuses.every(Boolean);

  const latestPrice = history[history.length - 1]?.value ?? 100000;
  const today = history[history.length - 1]?.time ?? toISO(new Date());

  const visiblePriceRange = useMemo(() => {
    const values = [latestPrice];
    if (allLoaded) {
      consensuses.forEach((consensus, idx) => {
        const market = markets[idx];
        if (!consensus?.points?.length || !market) return;
        const maxDensity = Math.max(...consensus.points.map(pt => Number.isFinite(pt.y) ? pt.y : 0));
        const densityFloor = maxDensity * 0.035;
        consensus.points.forEach(pt => {
          if (Number.isFinite(pt.x) && pt.y >= densityFloor) values.push(pt.x);
        });
      });
    }

    Object.entries(coneStates).forEach(([idx, state]) => {
      const market = markets[Number(idx)];
      if (!market) return;
      const prices = conePricesAtFraction(
        state,
        1,
        latestPrice,
        market.config.lowerBound,
        market.config.upperBound,
      );
      values.push(prices.lower, prices.center, prices.upper);
    });

    const finite = values.filter(Number.isFinite);
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const padding = Math.max((max - min) * 0.18, latestPrice * 0.08, 10_000);
    return {
      min: Math.max(1, min - padding),
      max: max + padding,
    };
  }, [allLoaded, coneStates, consensuses, latestPrice, markets]);

  useEffect(() => {
    const cached = readCachedBtcHistory();
    if (cached) {
      setHistory(cached);
      setHistorySource('cache');
    }

    const ac = new AbortController();
    fetchBtcHistory(ac.signal)
      .then(points => {
        setHistory(points);
        setHistorySource('coingecko');
        setHistoryWarning(null);
        writeCachedBtcHistory(points);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        fetchBinanceBtcHistory(ac.signal)
          .then(points => {
            setHistory(points);
            setHistorySource('binance');
            setHistoryWarning('CoinGecko history failed; using Binance BTCUSDT daily history.');
            writeCachedBtcHistory(points);
          })
          .catch(binanceErr => {
            if (binanceErr instanceof DOMException && binanceErr.name === 'AbortError') return;
            if (!cached) setHistorySource('fallback');
            setHistoryWarning(err instanceof Error ? err.message : 'Using fallback BTC history');
          });
      });

    return () => ac.abort();
  }, []);

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const priceSeries = historySeriesRef.current;
    if (!canvas || !chart || !priceSeries || !allLoaded) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const { originX, zoneWidth } = zoneLayout(rect.width);
    const zoneColors = [
      hexToRgba(MARKETS[0].color, 0.04),
      hexToRgba(MARKETS[1].color, 0.04),
      hexToRgba(MARKETS[2].color, 0.04),
      hexToRgba(MARKETS[3].color, 0.04),
      hexToRgba(MARKETS[4].color, 0.04),
    ];

    ctx.save();
    for (let i = 0; i < MARKETS.length; i += 1) {
      const x1 = originX + i * zoneWidth;
      const x2 = originX + (i + 1) * zoneWidth;
      ctx.fillStyle = zoneColors[i];
      ctx.fillRect(x1, 0, x2 - x1, rect.height);
    }
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(originX, 28);
    ctx.lineTo(originX, rect.height - 34);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
    ctx.font = '700 11px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Now', originX, 22);
    ctx.restore();

    const focusProgress = focusProgressRef.current;
    const hasFocus = activeZoneIdx !== null && focusProgress > 0.01;
    const inactiveFactor = hasFocus ? 1 - (0.72 * focusProgress) : 1;
    const dimAlpha = 0.62 * focusProgress;
    const activeZoneLeft = activeZoneIdx === null
      ? null
      : originX + activeZoneIdx * zoneWidth;
    const activeZoneRight = activeZoneIdx === null
      ? null
      : originX + (activeZoneIdx + 1) * zoneWidth;
    const activeCfg = activeZoneIdx === null ? null : MARKETS[activeZoneIdx];

    const alphaFor = (idx: number) => (
      hasFocus && idx !== activeZoneIdx ? inactiveFactor : 1
    );

    const drawLatestPrice = () => {
      const latestY = priceSeries.priceToCoordinate(latestPrice);
      if (latestY === null) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, latestY);
      ctx.lineTo(originX + MARKETS.length * zoneWidth, latestY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(originX, latestY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 12px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(formatUsd(latestPrice), originX + 8, latestY - 8);
      ctx.restore();
    };

    const drawCone = (idx: number) => {
      const state = coneStates[idx];
      const market = markets[idx];
      if (!state || !market) return;

      const cfg = MARKETS[idx];
      const lb = market.config.lowerBound;
      const ub = market.config.upperBound;
      const settlementX = settlementXForZone(idx, rect.width);
      const steps = 120;
      const upper: { x: number; y: number }[] = [];
      const lower: { x: number; y: number }[] = [];
      const center: { x: number; y: number }[] = [];

      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = originX + (settlementX - originX) * t;
        const prices = conePricesAtFraction(state, t, latestPrice, lb, ub);
        const upperY = priceSeries.priceToCoordinate(prices.upper);
        const lowerY = priceSeries.priceToCoordinate(prices.lower);
        const centerY = priceSeries.priceToCoordinate(prices.center);
        if (upperY === null || lowerY === null || centerY === null) continue;
        upper.push({ x, y: upperY });
        lower.push({ x, y: lowerY });
        center.push({ x, y: centerY });
      }

      if (upper.length < 2 || lower.length < 2 || center.length < 2) return;

      const layerAlpha = alphaFor(idx);
      const isActive = hasFocus && idx === activeZoneIdx;
      const lineOpacity = isActive
        ? 0.6 + (0.4 * focusProgress)
        : 0.6 * layerAlpha;
      const lineWidth = isActive ? 1.5 + (0.5 * focusProgress) : 1.5;
      ctx.save();
      ctx.beginPath();
      upper.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      for (let i = lower.length - 1; i >= 0; i -= 1) ctx.lineTo(lower[i].x, lower[i].y);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(cfg.color, cfg.opacity * layerAlpha);
      ctx.fill();

      ctx.strokeStyle = hexToRgba(cfg.color, lineOpacity);
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      upper.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.stroke();
      ctx.beginPath();
      lower.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.stroke();

      ctx.strokeStyle = hexToRgba(cfg.color, lineOpacity);
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      center.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
      ctx.stroke();
      ctx.setLineDash([]);

      const centerY = priceSeries.priceToCoordinate(state.prediction);
      if (centerY !== null) {
        ctx.fillStyle = hexToRgba(cfg.color, isActive ? 1 : 0.85 * layerAlpha);
        ctx.beginPath();
        ctx.arc(settlementX, centerY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawSettlement = (i: number, includeLabel: boolean) => {
      const cfg = MARKETS[i];
      const market = markets[i]!;
      const consensus = consensuses[i];
      const x = settlementXForZone(i, rect.width);
      const isActive = hasFocus && i === activeZoneIdx;
      const layerAlpha = alphaFor(i);

      ctx.save();
      ctx.strokeStyle = hexToRgba(cfg.color, isActive ? 1 : 0.4 * layerAlpha);
      ctx.lineWidth = 2;
      ctx.setLineDash(isActive ? [] : [4, 3]);
      if (isActive) {
        ctx.shadowColor = hexToRgba(cfg.color, 0.3);
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.lineTo(x, rect.height - 34);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);

      const lbY = market.config.lowerBound >= visiblePriceRange.min && market.config.lowerBound <= visiblePriceRange.max
        ? priceSeries.priceToCoordinate(market.config.lowerBound)
        : null;
      const ubY = market.config.upperBound >= visiblePriceRange.min && market.config.upperBound <= visiblePriceRange.max
        ? priceSeries.priceToCoordinate(market.config.upperBound)
        : null;
      ctx.strokeStyle = hexToRgba(cfg.color, 0.35 * layerAlpha);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      if (lbY !== null) {
        ctx.beginPath();
        ctx.moveTo(x - 32, lbY);
        ctx.lineTo(x + 32, lbY);
        ctx.stroke();
      }
      if (ubY !== null) {
        ctx.beginPath();
        ctx.moveTo(x - 32, ubY);
        ctx.lineTo(x + 32, ubY);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (consensus?.points?.length) {
        const points = consensus.points.filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
        const maxDensity = Math.max(...points.map(pt => pt.y));
        if (maxDensity > 0) {
          ctx.beginPath();
          let started = false;
          for (const pt of points) {
            const py = priceSeries.priceToCoordinate(pt.x);
            if (py === null || !Number.isFinite(py)) continue;
            const px = Math.max(0, x - (pt.y / maxDensity) * PDF_MAX_WIDTH);
            if (!started) {
              ctx.moveTo(x, py);
              started = true;
            }
            ctx.lineTo(px, py);
          }
          const last = points[points.length - 1];
          const ly = priceSeries.priceToCoordinate(last.x);
          if (ly !== null) ctx.lineTo(x, ly);
          ctx.closePath();
          const fillOpacity = isActive
            ? 0.12 + (0.16 * focusProgress)
            : 0.12 * layerAlpha;
          const strokeOpacity = isActive
            ? 0.5 + (0.35 * focusProgress)
            : 0.5 * layerAlpha;
          ctx.fillStyle = hexToRgba(cfg.color, fillOpacity);
          ctx.fill();
          ctx.strokeStyle = hexToRgba(cfg.color, strokeOpacity);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      if (includeLabel) {
        ctx.fillStyle = cfg.color;
        ctx.font = '700 11px Inter, ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cfg.label, x, 22);
      }
      ctx.restore();
    };

    const drawSettlementRule = (i: number) => {
      const cfg = MARKETS[i];
      const x = settlementXForZone(i, rect.width);
      ctx.save();
      ctx.strokeStyle = hexToRgba(cfg.color, 0.35);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.lineTo(x, rect.height - 34);
      ctx.stroke();
      ctx.restore();
    };

    const drawIdleCorridors = () => {
      const anchors = Object.entries(coneStates)
        .map(([idx, state]) => {
          const index = Number(idx);
          const market = markets[index];
          if (!market) return null;
          const sigma = confidenceToStdDev(
            state.confidence,
            market.config.lowerBound,
            market.config.upperBound,
          );
          const p10p90HalfWidth = sigma * P10_P90_Z;
          return {
            index,
            x: settlementXForZone(index, rect.width),
            median: state.prediction,
            p10: Math.max(market.config.lowerBound, state.prediction - p10p90HalfWidth),
            p90: Math.min(market.config.upperBound, state.prediction + p10p90HalfWidth),
            color: MARKETS[index].color,
          };
        })
        .filter((anchor): anchor is NonNullable<typeof anchor> => anchor !== null)
        .sort((a, b) => a.index - b.index);

      if (anchors.length === 0) return;

      const pathAnchors = [
        {
          index: -1,
          x: originX,
          median: latestPrice,
          p10: latestPrice,
          p90: latestPrice,
          color: '#22c55e',
        },
        ...anchors,
      ];

      for (let i = 0; i < pathAnchors.length - 1; i += 1) {
        const left = pathAnchors[i];
        const right = pathAnchors[i + 1];
        const skipped = Math.max(0, right.index - left.index - 1);
        const top: { x: number; y: number }[] = [];
        const bottom: { x: number; y: number }[] = [];
        const steps = 72;

        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const smooth = t * t * (3 - 2 * t);
          const median = left.median + (right.median - left.median) * smooth;
          const leftHalf = (left.p90 - left.p10) / 2;
          const rightHalf = (right.p90 - right.p10) / 2;
          const baseHalf = leftHalf + (rightHalf - leftHalf) * smooth;
          const uncertainty = 1 + skipped * 0.15 * Math.sin(Math.PI * t);
          const half = baseHalf * uncertainty;
          const x = left.x + (right.x - left.x) * smooth;
          const topY = priceSeries.priceToCoordinate(median + half);
          const bottomY = priceSeries.priceToCoordinate(median - half);
          if (topY === null || bottomY === null) continue;
          top.push({ x, y: topY });
          bottom.push({ x, y: bottomY });
        }

        if (top.length < 2 || bottom.length < 2) continue;

        const gradient = ctx.createLinearGradient(left.x, 0, right.x, 0);
        gradient.addColorStop(0, hexToRgba(left.color, 0.1));
        gradient.addColorStop(1, hexToRgba(right.color, 0.1));

        ctx.save();
        ctx.beginPath();
        top.forEach((pt, pointIdx) => {
          if (pointIdx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        for (let pointIdx = bottom.length - 1; pointIdx >= 0; pointIdx -= 1) {
          ctx.lineTo(bottom[pointIdx].x, bottom[pointIdx].y);
        }
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
        const topStroke = ctx.createLinearGradient(left.x, 0, right.x, 0);
        topStroke.addColorStop(0, hexToRgba(left.color, 0.35));
        topStroke.addColorStop(1, hexToRgba(right.color, 0.35));
        ctx.strokeStyle = topStroke;
        ctx.beginPath();
        top.forEach((pt, pointIdx) => {
          if (pointIdx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        const bottomStroke = ctx.createLinearGradient(left.x, 0, right.x, 0);
        bottomStroke.addColorStop(0, hexToRgba(left.color, 0.35));
        bottomStroke.addColorStop(1, hexToRgba(right.color, 0.35));
        ctx.strokeStyle = bottomStroke;
        ctx.beginPath();
        bottom.forEach((pt, pointIdx) => {
          if (pointIdx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.restore();
      }
    };

    if (!hasFocus) {
      drawIdleCorridors();
      drawLatestPrice();
      for (let idx = 0; idx < MARKETS.length; idx += 1) {
        drawSettlementRule(idx);
      }
      for (let idx = 0; idx < MARKETS.length; idx += 1) {
        const cfg = MARKETS[idx];
        const x = settlementXForZone(idx, rect.width);
        ctx.save();
        ctx.fillStyle = cfg.color;
        ctx.font = '700 11px Inter, ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cfg.label, x, 22);
        ctx.restore();
      }
      return;
    }

    for (let idx = MARKETS.length - 1; idx >= 0; idx -= 1) {
      if (idx !== activeZoneIdx) drawCone(idx);
    }
    for (let idx = 0; idx < MARKETS.length; idx += 1) {
      if (idx !== activeZoneIdx) drawSettlement(idx, false);
    }

    if (hasFocus && activeZoneLeft !== null && activeZoneRight !== null) {
      const fade = 40;
      ctx.save();
      ctx.fillStyle = `rgba(10, 11, 15, ${dimAlpha})`;
      ctx.fillRect(0, 0, Math.max(0, activeZoneLeft - fade), rect.height);

      const leftFade = ctx.createLinearGradient(activeZoneLeft - fade, 0, activeZoneLeft, 0);
      leftFade.addColorStop(0, `rgba(10, 11, 15, ${dimAlpha})`);
      leftFade.addColorStop(1, 'rgba(10, 11, 15, 0)');
      ctx.fillStyle = leftFade;
      ctx.fillRect(activeZoneLeft - fade, 0, fade, rect.height);

      const rightFade = ctx.createLinearGradient(activeZoneRight, 0, activeZoneRight + fade, 0);
      rightFade.addColorStop(0, 'rgba(10, 11, 15, 0)');
      rightFade.addColorStop(1, `rgba(10, 11, 15, ${dimAlpha})`);
      ctx.fillStyle = rightFade;
      ctx.fillRect(activeZoneRight, 0, fade, rect.height);

      ctx.fillStyle = `rgba(10, 11, 15, ${dimAlpha})`;
      ctx.fillRect(activeZoneRight + fade, 0, Math.max(0, rect.width - activeZoneRight - fade), rect.height);
      ctx.restore();

      if (activeCfg) {
        ctx.save();
        const glow = ctx.createRadialGradient(
          (activeZoneLeft + activeZoneRight) / 2,
          rect.height + 30,
          0,
          (activeZoneLeft + activeZoneRight) / 2,
          rect.height + 30,
          Math.max(zoneWidth * 0.75, 160),
        );
        glow.addColorStop(0, hexToRgba(activeCfg.color, 0.06 * focusProgress));
        glow.addColorStop(1, hexToRgba(activeCfg.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(activeZoneLeft, rect.height * 0.45, activeZoneRight - activeZoneLeft, rect.height * 0.55);
        ctx.restore();
      }
    }

    drawLatestPrice();
    if (hasFocus) {
      for (let idx = 0; idx < MARKETS.length; idx += 1) {
        if (idx !== activeZoneIdx) drawSettlementRule(idx);
      }
    }
    if (activeZoneIdx !== null) {
      drawCone(activeZoneIdx);
      drawSettlement(activeZoneIdx, false);
    }
    for (let idx = 0; idx < MARKETS.length; idx += 1) {
      const cfg = MARKETS[idx];
      const x = settlementXForZone(idx, rect.width);
      ctx.save();
      ctx.fillStyle = cfg.color;
      ctx.font = '700 11px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cfg.label, x, 22);
      ctx.restore();
    }
  }, [activeZoneIdx, allLoaded, coneStates, consensuses, latestPrice, markets, visiblePriceRange]);

  useEffect(() => {
    if (focusAnimationRef.current !== null) cancelAnimationFrame(focusAnimationRef.current);
    const from = focusProgressRef.current;
    const to = activeZoneIdx === null ? 0 : 1;
    const duration = activeZoneIdx === null ? 180 : 280;
    const easing = activeZoneIdx === null
      ? (t: number) => cubicBezier(t, 0.4, 0, 1, 1)
      : (t: number) => cubicBezier(t, 0.16, 1, 0.3, 1);
    const start = performance.now();

    const tick = (now: number) => {
      const t = clamp((now - start) / duration, 0, 1);
      focusProgressRef.current = from + (to - from) * easing(t);
      drawOverlay();
      if (t < 1) {
        focusAnimationRef.current = requestAnimationFrame(tick);
      } else {
        focusAnimationRef.current = null;
      }
    };

    focusAnimationRef.current = requestAnimationFrame(tick);
    return () => {
      if (focusAnimationRef.current !== null) cancelAnimationFrame(focusAnimationRef.current);
      focusAnimationRef.current = null;
    };
  }, [activeZoneIdx, drawOverlay]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const initialWidth = Math.max(320, containerRef.current.clientWidth || containerRef.current.getBoundingClientRect().width || 1000);
    const chart = createChart(containerRef.current, {
      width: initialWidth,
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
        visible: false,
        rightOffset: 24,
        barSpacing: 1.4,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: false,
      handleScale: false,
      crosshair: { mode: 0 },
    });

    chartRef.current = chart;
    const ro = new ResizeObserver(([entry]) => {
      chart.applyOptions({
        width: Math.max(320, entry.contentRect.width),
        height,
        layout: {
          background: { type: ColorType.Solid, color: '#070b12' },
          textColor: '#aab2c0',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        },
      });
      requestAnimationFrame(drawOverlay);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      historySeriesRef.current = null;
    };
  }, [drawOverlay, height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || history.length === 0) return;

    const historySeries = chart.addSeries(LineSeries, {
      color: 'rgba(226,232,240,0)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    historySeries.setData(history as any);
    historySeriesRef.current = historySeries;

    const ext = chart.addSeries(LineSeries, {
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: visiblePriceRange.min, maxValue: visiblePriceRange.max },
      }),
    });
    ext.setData([
      { time: history[0].time as any, value: visiblePriceRange.min },
      { time: today as any, value: latestPrice },
      ...MARKETS.map((market, idx) => ({
        time: market.settlement as any,
        value: idx % 2 === 0 ? visiblePriceRange.min : visiblePriceRange.max,
      })),
    ]);

    requestAnimationFrame(() => {
      chart.timeScale().fitContent();
      drawOverlay();
    });

    return () => {
      if (chartRef.current) {
        chart.removeSeries(historySeries);
        chart.removeSeries(ext);
      }
      historySeriesRef.current = null;
    };
  }, [drawOverlay, history, latestPrice, today, visiblePriceRange]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = () => drawOverlay();
    chart.timeScale().subscribeVisibleTimeRangeChange(handler);
    requestAnimationFrame(handler);
    return () => {
      if (chartRef.current) chart.timeScale().unsubscribeVisibleTimeRangeChange(handler);
    };
  }, [drawOverlay]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => drawOverlay());
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawOverlay]);

  const getStagePoint = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width };
  }, []);

  const getZone = useCallback((x: number, width: number): number => {
    if (!allLoaded) return -1;
    const { originX, zoneWidth } = zoneLayout(width);
    if (x < originX) return -1;
    for (let i = 0; i < MARKETS.length; i += 1) {
      if (x <= originX + (i + 1) * zoneWidth) return i;
    }
    return MARKETS.length - 1;
  }, [allLoaded]);

  const fractionForZone = useCallback((zoneIdx: number, x: number, width: number) => {
    const { originX } = zoneLayout(width);
    const settlementX = settlementXForZone(zoneIdx, width);
    if (settlementX === originX) return null;
    return clamp((x - originX) / (settlementX - originX), 0.01, 1);
  }, []);

  const modeForPointer = useCallback((zoneIdx: number, x: number, y: number, width: number, state: ConeState): DragMode => {
    const priceSeries = historySeriesRef.current;
    const market = markets[zoneIdx];
    if (!priceSeries || !market) return 'mean';
    const frac = fractionForZone(zoneIdx, x, width);
    if (frac === null) return 'mean';
    const prices = conePricesAtFraction(
      state,
      frac,
      latestPrice,
      market.config.lowerBound,
      market.config.upperBound,
    );
    const centerY = priceSeries.priceToCoordinate(prices.center);
    const upperY = priceSeries.priceToCoordinate(prices.upper);
    const lowerY = priceSeries.priceToCoordinate(prices.lower);
    const candidates = [
      { mode: 'mean' as const, distance: centerY === null ? Infinity : Math.abs(y - centerY) },
      { mode: 'upper' as const, distance: upperY === null ? Infinity : Math.abs(y - upperY) },
      { mode: 'lower' as const, distance: lowerY === null ? Infinity : Math.abs(y - lowerY) },
    ].sort((a, b) => a.distance - b.distance);
    return candidates[0].distance <= 16 ? candidates[0].mode : 'mean';
  }, [fractionForZone, latestPrice, markets]);

  const applyDrag = useCallback((zoneIdx: number, mode: DragMode, x: number, y: number, width: number) => {
    const priceSeries = historySeriesRef.current;
    const market = markets[zoneIdx];
    if (!priceSeries || !market) return;
    const price = priceSeries.coordinateToPrice(y);
    const frac = fractionForZone(zoneIdx, x, width);
    if (price === null || frac === null) return;

    const lb = market.config.lowerBound;
    const ub = market.config.upperBound;
    setConeStates(prev => {
      const current = prev[zoneIdx] ?? buildNeutralCone(latestPrice, lb, ub);
      if (mode === 'mean') {
        const meanAtSettlement = latestPrice + (price - latestPrice) / frac;
        return {
          ...prev,
          [zoneIdx]: {
            ...current,
            prediction: +clamp(meanAtSettlement, lb, ub).toFixed(0),
          },
        };
      }

      const centerAtX = latestPrice + (current.prediction - latestPrice) * frac;
      const sigma = Math.abs(price - centerAtX) / (frac * P10_P90_Z);
      return {
        ...prev,
        [zoneIdx]: {
          ...current,
          confidence: +stdDevToConfidence(sigma, lb, ub).toFixed(1),
        },
      };
    });
  }, [fractionForZone, latestPrice, markets]);

  const handleStageMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const point = getStagePoint(e);
    if (!point) return;
    const zoneIdx = getZone(point.x, point.width);
    if (zoneIdx < 0 || !markets[zoneIdx]) return;
    e.preventDefault();
    setActiveZoneIdx(zoneIdx);

    setConeStates(prev => {
      const market = markets[zoneIdx]!;
      const existing = prev[zoneIdx] ?? buildNeutralCone(
        latestPrice,
        market.config.lowerBound,
        market.config.upperBound,
      );
      const mode = prev[zoneIdx]
        ? modeForPointer(zoneIdx, point.x, point.y, point.width, existing)
        : 'mean';
      drawingRef.current = { zoneIdx, mode };
      return prev[zoneIdx] ? prev : { ...prev, [zoneIdx]: existing };
    });
  }, [getStagePoint, getZone, latestPrice, markets, modeForPointer]);

  const handleStageMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const drawing = drawingRef.current;
    const point = getStagePoint(e);
    if (!point) return;
    const hoveredZone = getZone(point.x, point.width);
    if (!drawing) {
      setActiveZoneIdx(hoveredZone >= 0 ? hoveredZone : null);
      return;
    }
    e.preventDefault();
    setActiveZoneIdx(drawing.zoneIdx);
    applyDrag(drawing.zoneIdx, drawing.mode, point.x, point.y, point.width);
  }, [applyDrag, getStagePoint, getZone]);

  const stopStageDrag = useCallback(() => {
    drawingRef.current = null;
  }, []);

  const handleStageMouseLeave = useCallback(() => {
    drawingRef.current = null;
    setActiveZoneIdx(null);
  }, []);

  const activeCones = Object.entries(coneStates)
    .map(([idx, state]) => ({ idx: Number(idx), state, cfg: MARKETS[Number(idx)] }))
    .sort((a, b) => a.idx - b.idx);

  if (!allLoaded) {
    return (
      <div className="cone-chart-card" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#94a3b8' }}>Loading BTC market data...</span>
      </div>
    );
  }

  return (
    <div className="cone-chart-card btc-multi-cone-card" style={{ height }}>
      <div className="cone-chart-toolbar">
        <div>
          <span className="cone-chart-eyebrow">Multi-Cone View</span>
          <strong>Bitcoin Multi-Term Annual Closing Price #2</strong>
        </div>
        <div className="cone-chart-legend">
          {MARKETS.map((m, i) => (
            <span key={m.year}>
              <i className="legend-swatch" style={{ background: m.color }} />
              {m.label}{coneStates[i] ? ` ${formatUsd(coneStates[i].prediction)}` : ''}
            </span>
          ))}
        </div>
      </div>

      <div
        className="cone-chart-stage"
        onMouseDownCapture={handleStageMouseDown}
        onMouseMoveCapture={handleStageMouseMove}
        onMouseUpCapture={stopStageDrag}
        onMouseLeave={handleStageMouseLeave}
      >
        <div ref={containerRef} className="cone-chart-canvas-host" />
        <canvas ref={overlayCanvasRef} className="cone-chart-pdf-canvas" />
        <div
          className="btc-multi-cone-hit-layer"
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={stopStageDrag}
          onMouseLeave={handleStageMouseLeave}
          style={{ position: 'absolute', inset: 0, zIndex: 4, cursor: 'crosshair' }}
        />
      </div>

      <div className="cone-chart-footer">
        <div className="cone-chart-info-pills">
          <span className="cone-info-pill">BTC: <strong>{formatUsd(latestPrice)}</strong></span>
          {activeCones.map(({ idx, state, cfg }) => (
            <span key={idx} className="cone-info-pill" style={{ borderColor: hexToRgba(cfg.color, 0.3), background: hexToRgba(cfg.color, 0.08) }}>
              {cfg.label}: <strong>{formatUsd(state.prediction)}</strong> · conf <strong>{state.confidence.toFixed(0)}%</strong>
            </span>
          ))}
        </div>
        <span className="cone-draw-hint">Click a future zone to create a cone. Drag center to move mean; drag edges to change confidence.</span>
      </div>
    </div>
  );
}
