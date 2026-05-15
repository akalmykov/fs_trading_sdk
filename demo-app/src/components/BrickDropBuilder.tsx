import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMarket,
  useConsensus,
  useBuy,
  usePreviewPayout,
  useAuth,
} from '@functionspace/react';
import {
  generateBelief,
  computeStatistics,
} from '@functionspace/core';
import type { BeliefVector, PayoutCurve } from '@functionspace/core';

/* ── constants ── */
const TOTAL_BRICKS = 20;
const NUM_VISUAL_COLUMNS = 16;
const COLLATERAL_DEFAULT = 100;
const PAYOUT_PREVIEW_TIMEOUT_MS = 45_000;
const PAYOUT_PREVIEW_OUTCOMES = NUM_VISUAL_COLUMNS;

/* ── helpers ── */
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function formatOutcome(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function payoutColor(ratio: number, lightOffset = 0): string {
  // Keep the full payout scale luminous enough to read over the dark chart.
  const stops = [
    { t: 0, l: 0.68, c: 0.16, h: 245 },
    { t: 0.48, l: 0.76, c: 0.14, h: 205 },
    { t: 0.74, l: 0.86, c: 0.16, h: 88 },
    { t: 1, l: 0.96, c: 0.06, h: 92 },
  ];
  const clamped = clamp(ratio, 0, 1);
  const upperIndex = Math.max(1, stops.findIndex((stop) => clamped <= stop.t));
  const a = stops[upperIndex - 1];
  const b = stops[upperIndex] ?? stops[stops.length - 1];
  const localT = b.t === a.t ? 0 : (clamped - a.t) / (b.t - a.t);
  const l = clamp(mix(a.l, b.l, localT) + lightOffset, 0, 1);
  const c = mix(a.c, b.c, localT);
  const h = mix(a.h, b.h, localT);
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

function payoutLabelColor(ratio: number): string {
  const t = clamp(ratio, 0, 1);
  const l = Math.max(0.68, 0.55 + t * 0.35);
  const c = 0.12 + t * 0.10;
  const h = 260 - t * 185;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

function neutralBrickColor(): string {
  return '#2563eb';
}

function previewOutcomeToMarketOutcome(
  outcome: number,
  lowerBound: number,
  upperBound: number,
): number {
  if (outcome >= 0 && outcome <= 1 && upperBound - lowerBound > 1) {
    return lowerBound + outcome * (upperBound - lowerBound);
  }
  return outcome;
}

function buildBeliefFromBricks(
  brickCounts: number[],
  totalBricks: number,
  numBuckets: number,
  lowerBound: number,
  upperBound: number,
): BeliefVector {
  const regions = buildBrickBeliefRegions(brickCounts, totalBricks, lowerBound, upperBound);
  return generateBelief(regions, numBuckets, lowerBound, upperBound);
}

function buildBrickBeliefRegions(
  brickCounts: number[],
  totalBricks: number,
  lowerBound: number,
  upperBound: number,
) {
  const bricksPlaced = brickCounts.reduce((sum, count) => sum + count, 0);
  const bricksRemaining = Math.max(0, totalBricks - bricksPlaced);
  const visualColumnWidth = (upperBound - lowerBound) / brickCounts.length;
  const regions = brickCounts
    .map((brickCount, columnIndex) => {
      if (brickCount <= 0) return null;
      const low = lowerBound + columnIndex * visualColumnWidth;
      return {
        type: 'range' as const,
        low,
        high: low + visualColumnWidth,
        weight: brickCount / totalBricks,
        sharpness: 1,
      };
    })
    .filter((region): region is NonNullable<typeof region> => region !== null);

  if (bricksRemaining > 0) {
    regions.push({
      type: 'range',
      low: lowerBound,
      high: upperBound,
      weight: bricksRemaining / totalBricks,
      sharpness: 1,
    });
  }

  return regions;
}

function buildColumnDebugState(
  brickCounts: number[],
  lowerBound: number,
  upperBound: number,
) {
  const visualColumnWidth = (upperBound - lowerBound) / brickCounts.length;
  return brickCounts.map((brickCount, columnIndex) => ({
    center: lowerBound + (columnIndex + 0.5) * visualColumnWidth,
    bricks: brickCount,
  }));
}

function summarizeBeliefByVisualColumn(
  belief: BeliefVector,
  visualColumns: number,
  lowerBound: number,
  upperBound: number,
) {
  const step = (upperBound - lowerBound) / visualColumns;
  const numBuckets = belief.length - 2;
  return Array.from({ length: visualColumns }, (_, columnIndex) => {
    const low = lowerBound + columnIndex * step;
    const high = low + step;
    let mass = 0;
    let bucketCount = 0;

    for (let bucketIndex = 0; bucketIndex < belief.length; bucketIndex += 1) {
      const outcome = lowerBound + (bucketIndex / (numBuckets + 1)) * (upperBound - lowerBound);
      const inColumn = columnIndex === visualColumns - 1
        ? outcome >= low && outcome <= high
        : outcome >= low && outcome < high;
      if (inColumn) {
        mass += belief[bucketIndex];
        bucketCount += 1;
      }
    }

    return {
      column: columnIndex,
      center: lowerBound + (columnIndex + 0.5) * step,
      mass: Number(mass.toFixed(6)),
      average: Number((mass / Math.max(1, bucketCount)).toFixed(6)),
    };
  });
}

function payoutGlow(ratio: number): string {
  const glowColor = payoutColor(ratio, 0.08);
  return `0 0 ${6 + ratio * 12}px color-mix(in oklch, ${glowColor} 70%, transparent)`;
}

/* ── types ── */
interface ColumnPayoutInfo {
  payout: number;
  ratio: number; // 0-1 normalised
  outcomeCenter: number;
  previewOutcome: number | null;
  previewIndex: number | null;
}

type PreviewStatus = 'idle' | 'debouncing' | 'loading' | 'ready' | 'error';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  color: string;
  floorY?: number;
  bounced?: boolean;
}

interface BrickDropBuilderProps {
  marketId: string | number;
}

/* ── Component ── */
export function BrickDropBuilder({ marketId }: BrickDropBuilderProps) {
  const { market } = useMarket(marketId);
  const { consensus } = useConsensus(marketId, 200);
  const { execute: executeBuy, loading: buyLoading, error: buyError } = useBuy(marketId);
  const { execute: previewPayout } = usePreviewPayout(marketId);
  const { isAuthenticated } = useAuth();

  const [brickCounts, setBrickCounts] = useState<number[]>(() =>
    new Array(NUM_VISUAL_COLUMNS).fill(0),
  );
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);
  const [collateral, setCollateral] = useState(COLLATERAL_DEFAULT);
  const [payoutCurve, setPayoutCurve] = useState<PayoutCurve | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fallingBricks, setFallingBricks] = useState<
    { col: number; id: number; row: number }[]
  >([]);
  const [labelPulse, setLabelPulse] = useState<{ col: number; tick: number } | null>(null);
  const [pulseAll, setPulseAll] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const brickIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const particleFrameRef = useRef<number | null>(null);
  const impactCountRef = useRef(0);
  const pendingDropsRef = useRef(0);
  const previewRequestRef = useRef(0);
  const debugBrickDrop = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('debugBrickDrop');

  const lb = market?.config?.lowerBound ?? 0;
  const ub = market?.config?.upperBound ?? 5000;
  const numBuckets = market?.config?.numBuckets ?? 80;

  const bricksPlaced = brickCounts.reduce((a, b) => a + b, 0);
  const bricksRemaining = TOTAL_BRICKS - bricksPlaced;
  const isLocked = bricksRemaining <= 0;

  /* ── column outcome labels ── */
  const columnLabels = useMemo(() => {
    const labels: string[] = [];
    const step = (ub - lb) / NUM_VISUAL_COLUMNS;
    for (let i = 0; i < NUM_VISUAL_COLUMNS; i++) {
      const center = lb + step * (i + 0.5);
      labels.push(formatOutcome(center));
    }
    return labels;
  }, [lb, ub]);

  /* ── build belief vector from bricks ── */
  const belief = useMemo<BeliefVector | null>(() => {
    if (!market) return null;
    return buildBeliefFromBricks(brickCounts, TOTAL_BRICKS, numBuckets, lb, ub);
  }, [brickCounts, market, numBuckets, lb, ub]);

  /* ── consensus per column (for heat map) ── */
  const consensusPerColumn = useMemo(() => {
    if (!consensus || !market) return null;
    const points = consensus.points;
    if (points.length === 0) return null;
    const step = (ub - lb) / NUM_VISUAL_COLUMNS;
    const cols: number[] = [];
    for (let i = 0; i < NUM_VISUAL_COLUMNS; i++) {
      const colLow = lb + step * i;
      const colHigh = colLow + step;
      // Average density in this column's range
      const pts = points.filter((p) => p.x >= colLow && p.x < colHigh);
      const avg = pts.length > 0 ? pts.reduce((s, p) => s + p.y, 0) / pts.length : 0;
      cols.push(avg);
    }
    const maxC = Math.max(...cols, 1e-10);
    return cols.map((c) => c / maxC); // normalise to 0-1
  }, [consensus, market, lb, ub]);

  /* ── preview payout on brick change ── */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewPayoutRef = useRef(previewPayout);
  previewPayoutRef.current = previewPayout;

  const beliefRef = useRef(belief);
  beliefRef.current = belief;

  // Only trigger preview when brickCounts or collateral actually change
  const brickCountsKey = brickCounts.join(',');
  useEffect(() => {
    const currentBelief = beliefRef.current;
    if (!currentBelief || !isAuthenticated) {
      setPayoutCurve(null);
      setPreviewStatus('idle');
      setPreviewError(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    const requestId = ++previewRequestRef.current;
    setPreviewStatus('debouncing');
    setPreviewError(null);
    debounceRef.current = setTimeout(() => {
      setPreviewStatus('loading');
      if (debugBrickDrop) {
        console.groupCollapsed('[BrickDrop] payout preview request');
        console.log('belief vector:', JSON.stringify(currentBelief));
        console.log('columns state:', buildColumnDebugState(brickCounts, lb, ub));
        console.log('regions:', buildBrickBeliefRegions(brickCounts, TOTAL_BRICKS, lb, ub));
        console.log('brickCounts', brickCounts);
        console.table(summarizeBeliefByVisualColumn(currentBelief, NUM_VISUAL_COLUMNS, lb, ub));
        console.log('belief', currentBelief);
        console.groupEnd();
      }
      previewTimeoutRef.current = setTimeout(() => {
        if (requestId !== previewRequestRef.current) return;
        previewRequestRef.current += 1;
        setPreviewStatus('error');
        setPreviewError('Payout preview is taking longer than expected. Try again in a moment.');
      }, PAYOUT_PREVIEW_TIMEOUT_MS);

      previewPayoutRef.current(currentBelief, collateral, PAYOUT_PREVIEW_OUTCOMES)
        .then((curve) => {
          if (requestId !== previewRequestRef.current) return;
          if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
          if (debugBrickDrop) {
            console.groupCollapsed('[BrickDrop] payout preview response');
            console.log('maxPayout', curve.maxPayout);
            console.log('maxPayoutOutcome', curve.maxPayoutOutcome);
            console.table(curve.previews);
            console.groupEnd();
          }
          setPayoutCurve(curve);
          setPreviewStatus('ready');
          setPreviewError(null);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (requestId !== previewRequestRef.current) return;
          if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
          setPreviewStatus('error');
          setPreviewError(err instanceof Error ? err.message : String(err));
        });
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, [brickCountsKey, collateral, numBuckets, isAuthenticated, debugBrickDrop, lb, ub, brickCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── payout info per column ── */
  const columnPayouts = useMemo<ColumnPayoutInfo[]>(() => {
    const step = (ub - lb) / NUM_VISUAL_COLUMNS;
    if (!payoutCurve?.previews?.length) {
      return Array.from({ length: NUM_VISUAL_COLUMNS }, (_, i) => ({
        payout: 0,
        ratio: 0,
        outcomeCenter: lb + step * (i + 0.5),
        previewOutcome: null,
        previewIndex: null,
      }));
    }
    const previews = payoutCurve.previews;
    const previewOutcomes = previews.map((preview) => preview.outcome);
    const minPreviewOutcome = Math.min(...previewOutcomes);
    const maxPreviewOutcome = Math.max(...previewOutcomes);
    const previewOutcomeSpan = maxPreviewOutcome - minPreviewOutcome;
    const marketSpan = ub - lb;
    const previewsUseMarketUnits =
      minPreviewOutcome >= lb - step &&
      maxPreviewOutcome <= ub + step &&
      previewOutcomeSpan >= marketSpan * 0.5;
    const infos: ColumnPayoutInfo[] = [];
    for (let i = 0; i < NUM_VISUAL_COLUMNS; i++) {
      const outcomeCenter = lb + step * (i + 0.5);
      const previewIndex = previewsUseMarketUnits
        ? previews.reduce((nearestIndex, preview, previewIndex) =>
          Math.abs(preview.outcome - outcomeCenter) < Math.abs(previews[nearestIndex].outcome - outcomeCenter)
            ? previewIndex
            : nearestIndex,
        0)
        : Math.min(
          previews.length - 1,
          Math.round((i / Math.max(1, NUM_VISUAL_COLUMNS - 1)) * (previews.length - 1)),
        );
      const preview = previews[previewIndex];
      infos.push({
        payout: preview.payout,
        ratio: 0,
        outcomeCenter,
        previewOutcome: preview.outcome,
        previewIndex,
      });
    }
    const minP = Math.min(...infos.map((i) => i.payout));
    const maxP = Math.max(...infos.map((i) => i.payout));
    const range = Math.max(maxP - minP, 1e-10);
    return infos.map((i) => ({ ...i, ratio: (i.payout - minP) / range }));
  }, [payoutCurve, lb, ub]);

  useEffect(() => {
    if (!debugBrickDrop || previewStatus !== 'ready') return;
    console.groupCollapsed('[BrickDrop] mapped column payouts');
    console.table(columnPayouts);
    console.groupEnd();
  }, [columnPayouts, debugBrickDrop, previewStatus]);

  const drawParticles = useCallback(() => {
    const canvas = particleCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      particleFrameRef.current = null;
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particlesRef.current = particlesRef.current
      .map((particle) => {
        const next = { ...particle };
        next.x += next.vx;
        next.y += next.vy;
        next.vy += 0.15;
        next.life -= next.decay;
        if (next.floorY !== undefined && !next.bounced && next.y > next.floorY) {
          next.y = next.floorY;
          next.vy *= -0.42;
          next.vx *= 0.72;
          next.bounced = true;
        }
        return next;
      })
      .filter((particle) => particle.life > 0);

    for (const particle of particlesRef.current) {
      ctx.save();
      ctx.globalAlpha = clamp(particle.life, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0.3, particle.size * particle.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (particlesRef.current.length > 0) {
      particleFrameRef.current = requestAnimationFrame(drawParticles);
    } else {
      particleFrameRef.current = null;
    }
  }, []);

  const spawnImpactParticles = useCallback((col: number, row: number) => {
    const gridArea = gridAreaRef.current;
    const canvas = particleCanvasRef.current;
    if (!gridArea || !canvas) return;

    const columnEl = gridArea.querySelectorAll<HTMLElement>('.brick-column')[col];
    const stackEl = columnEl?.querySelector<HTMLElement>('.brick-stack');
    if (!columnEl || !stackEl) return;

    const areaRect = gridArea.getBoundingClientRect();
    const columnRect = columnEl.getBoundingClientRect();
    const stackRect = stackEl.getBoundingClientRect();
    const x = columnRect.left - areaRect.left + columnRect.width / 2;
    const y = stackRect.bottom - areaRect.top - row * 28 - 12;
    const ratio = columnPayouts[col]?.ratio ?? 0;
    const color = payoutColor(ratio, 0.08);
    const count = 12 + Math.floor(Math.random() * 7);

    const nextParticles: Particle[] = [];
    for (let i = 0; i < count; i += 1) {
      nextParticles.push({
        x,
        y,
        vx: -3 + Math.random() * 6,
        vy: -4 + Math.random() * 3,
        life: 1,
        decay: 0.04 + Math.random() * 0.03,
        size: 1.5 + Math.random() * 2,
        color,
      });
    }

    impactCountRef.current += 1;
    if (impactCountRef.current % 4 === 0 || impactCountRef.current % 5 === 0) {
      nextParticles.push({
        x,
        y,
        vx: -1.4 + Math.random() * 2.8,
        vy: -2.8 - Math.random() * 1.4,
        life: 1,
        decay: 0.02,
        size: 5 + Math.random() * 2,
        color: payoutColor(ratio, 0.15),
        floorY: stackRect.bottom - areaRect.top + 2,
      });
    }

    particlesRef.current.push(...nextParticles);
    if (particleFrameRef.current === null) {
      particleFrameRef.current = requestAnimationFrame(drawParticles);
    }
  }, [columnPayouts, drawParticles]);

  useEffect(() => {
    const gridArea = gridAreaRef.current;
    const canvas = particleCanvasRef.current;
    if (!gridArea || !canvas) return;

    const resizeCanvas = () => {
      const rect = gridArea.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(gridArea);
    return () => {
      observer.disconnect();
      if (particleFrameRef.current !== null) {
        cancelAnimationFrame(particleFrameRef.current);
        particleFrameRef.current = null;
      }
    };
  }, []);

  const maxColumnPayout = useMemo(() => {
    if (!payoutCurve) return null;
    return columnPayouts.reduce((best, current) =>
      current.payout > best.payout ? current : best,
    columnPayouts[0]);
  }, [columnPayouts, payoutCurve]);
  const isPreviewPending = previewStatus === 'debouncing' || previewStatus === 'loading';

  /* ── drop a brick ── */
  const dropBrick = useCallback(
    (col: number) => {
      if (col < 0 || col >= NUM_VISUAL_COLUMNS) return;
      if (bricksPlaced + pendingDropsRef.current >= TOTAL_BRICKS) return;
      const currentRow = brickCounts[col];

      pendingDropsRef.current += 1;
      const id = ++brickIdRef.current;
      setFallingBricks((prev) => [...prev, { col, id, row: currentRow }]);

      setTimeout(() => {
        setBrickCounts((prev) => {
          const total = prev.reduce((a, b) => a + b, 0);
          if (total >= TOTAL_BRICKS) return prev;
          const next = [...prev];
          next[col] += 1;
          return next;
        });
        pendingDropsRef.current = Math.max(0, pendingDropsRef.current - 1);
        setFallingBricks((prev) => prev.filter((b) => b.id !== id));
        spawnImpactParticles(col, currentRow + 1);
        setLabelPulse({ col, tick: Date.now() });
      }, 350);
    },
    [bricksPlaced, brickCounts, spawnImpactParticles],
  );

  /* ── remove a brick ── */
  const removeBrick = useCallback(
    (col: number) => {
      if (col < 0 || col >= NUM_VISUAL_COLUMNS) return;
      setBrickCounts((prev) => {
        if (prev[col] <= 0) return prev;
        const next = [...prev];
        next[col] -= 1;
        return next;
      });
    },
    [],
  );

  /* ── reset all ── */
  const resetAll = useCallback(() => {
    setBrickCounts(new Array(NUM_VISUAL_COLUMNS).fill(0));
    pendingDropsRef.current = 0;
    previewRequestRef.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    setPayoutCurve(null);
    setPreviewStatus('idle');
    setPreviewError(null);
    setLabelPulse(null);
    setPulseAll(false);
    setSubmitSuccess(false);
    particlesRef.current = [];
    const canvas = particleCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  /* ── keyboard navigation ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setHoveredColumn((prev) =>
          prev === null ? NUM_VISUAL_COLUMNS - 1 : Math.max(0, prev - 1),
        );
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setHoveredColumn((prev) =>
          prev === null ? 0 : Math.min(NUM_VISUAL_COLUMNS - 1, prev + 1),
        );
      } else if (e.key === ' ' || e.key === 'Space') {
        e.preventDefault();
        if (hoveredColumn !== null) dropBrick(hoveredColumn);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (hoveredColumn !== null) removeBrick(hoveredColumn);
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [hoveredColumn, dropBrick, removeBrick]);

  /* ── submit trade ── */
  const handleSubmit = useCallback(async () => {
    if (!belief || !isAuthenticated) return;
    setPulseAll(true);
    setTimeout(async () => {
      try {
        await executeBuy(belief, collateral);
        setSubmitSuccess(true);
      } catch (err) {
        console.error('Trade failed:', err);
      }
      setPulseAll(false);
    }, 800);
  }, [belief, collateral, isAuthenticated, executeBuy]);

  /* ── max stack height for rendering ── */
  const maxStack = Math.max(...brickCounts, 1);
  const gridRows = Math.max(maxStack + 2, 8); // at least 8 rows for visual balance

  /* ── stats ── */
  const stats = useMemo(() => {
    if (!belief || !market) return null;
    return computeStatistics(belief, lb, ub);
  }, [belief, market, lb, ub]);

  /* ── column step ── */
  const colStep = (ub - lb) / NUM_VISUAL_COLUMNS;
  const hoveredOutcome = hoveredColumn !== null ? lb + colStep * (hoveredColumn + 0.5) : null;
  const hoveredPayout = hoveredColumn !== null ? columnPayouts[hoveredColumn] : null;
  const sdkMaxPayoutOutcome = payoutCurve
    ? previewOutcomeToMarketOutcome(payoutCurve.maxPayoutOutcome, lb, ub)
    : null;
  const isBucketLocalPayoutPreview = Boolean(
    payoutCurve
    && stats
    && sdkMaxPayoutOutcome !== null
    && Math.abs(sdkMaxPayoutOutcome - stats.mode) <= colStep * 1.5,
  );

  if (!market) {
    return (
      <div className="brick-drop-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <span style={{ color: 'var(--fs-text-secondary, #94a3b8)' }}>Loading market data…</span>
      </div>
    );
  }

  return (
    <div className="brick-drop-card" ref={containerRef} tabIndex={0}>
      {/* ── Header ── */}
      <div className="brick-drop-header">
        <div className="brick-drop-header-left">
          <span className="brick-drop-lego-icon">🧱</span>
          <h2 className="brick-drop-title">Brick-Drop Distribution Builder</h2>
          <span className="brick-drop-new-badge">NEW</span>
        </div>
        {isAuthenticated && isPreviewPending && (
          <div className="brick-preview-banner" role="status" aria-live="polite">
            <span className="brick-mini-spinner" />
            <span>Calculating payout curve...</span>
          </div>
        )}
        <button className="brick-drop-how-btn" onClick={resetAll} title="Reset all bricks">
          ↻ Reset
        </button>
      </div>

      <div className="brick-drop-body">
        {/* ── Main grid area ── */}
        <div className="brick-drop-grid-area" ref={gridAreaRef}>
          <canvas className="brick-particle-canvas" ref={particleCanvasRef} aria-hidden="true" />

          {/* Subtitle */}
          <p className="brick-drop-subtitle">
            Drop bricks into outcome buckets to build your belief distribution.
          </p>

          {/* Y-axis label */}
          <div className="brick-drop-y-axis-label">Probability (%)</div>

          {/* ── Grid ── */}
          <div className="brick-grid">
            {brickCounts.map((count, col) => {
              const isHovered = hoveredColumn === col;
              const payoutInfo = columnPayouts[col];
              const consensusH = consensusPerColumn ? consensusPerColumn[col] : 0;
              const hasPayoutLabel = Boolean(payoutCurve);
              const hasPayoutColor = hasPayoutLabel;
              const brickColor = hasPayoutColor ? payoutColor(payoutInfo.ratio) : neutralBrickColor();
              const brickHotColor = hasPayoutColor
                ? payoutColor(payoutInfo.ratio, 0.10)
                : '#38bdf8';
              const brickShadow = hasPayoutColor
                ? payoutGlow(payoutInfo.ratio)
                : '0 0 10px rgba(56, 189, 248, 0.35)';
              const labelAnimationClass = labelPulse
                ? labelPulse.col === col
                  ? 'impact-flash'
                  : 'impact-tick'
                : '';
              const labelColor = hasPayoutLabel ? payoutLabelColor(payoutInfo.ratio) : undefined;

              return (
                <div
                  key={col}
                  className={`brick-column ${isHovered ? 'hovered' : ''} ${isLocked ? 'locked' : ''}`}
                  onMouseEnter={() => setHoveredColumn(col)}
                  onMouseLeave={() => setHoveredColumn(null)}
                  onClick={() => dropBrick(col)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    removeBrick(col);
                  }}
                >
                  {/* Target indicator */}
                  <div
                    className="brick-target-indicator"
                    style={{ visibility: isHovered && !isLocked ? 'visible' : 'hidden' }}
                  >▼</div>

                  {/* Payout label */}
                  <div
                    key={labelPulse ? `${col}-${labelPulse.tick}` : col}
                    className={`brick-payout-label ${count > 0 ? 'has-bricks' : 'empty'} ${labelAnimationClass}`}
                    style={{
                      color: labelColor,
                      '--payout-label-color': labelColor,
                    } as React.CSSProperties}
                  >
                    {hasPayoutLabel ? `+$${payoutInfo.payout.toFixed(0)}` : isPreviewPending ? '...' : '–'}
                  </div>

                  {/* Stack area */}
                  <div className="brick-stack" style={{ height: `${gridRows * 28}px` }}>
                    {/* Consensus heat bar */}
                    {consensusPerColumn && (
                      <div
                        className="consensus-heat-bar"
                        style={{
                          height: `${consensusH * 100}%`,
                          opacity: 0.35 + consensusH * 0.5,
                        }}
                      />
                    )}

                    {/* Stacked bricks */}
                    {Array.from({ length: count }).map((_, row) => {
                      const isTopBrick = row === count - 1;
                      return (
                        <div
                          key={row}
                          className={`brick ${pulseAll ? 'pulse' : ''}`}
                          style={{
                            bottom: `${row * 28}px`,
                            background: `linear-gradient(135deg, ${brickColor}, ${isTopBrick ? brickHotColor : brickColor})`,
                            boxShadow: brickShadow,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBrick(col);
                          }}
                        >
                          <div className="brick-inner-shine" />
                        </div>
                      );
                    })}

                    {/* Falling bricks (animated) */}
                    {fallingBricks
                      .filter((b) => b.col === col)
                      .map((b) => (
                        <div
                          key={b.id}
                          className="brick falling"
                          style={{
                            bottom: `${b.row * 28}px`,
                            background: `linear-gradient(135deg, ${brickColor}, ${brickHotColor})`,
                            boxShadow: brickShadow,
                          }}
                        >
                          <div className="brick-inner-shine" />
                        </div>
                      ))}
                  </div>

                  {/* Column label */}
                  <div className="brick-column-label">{columnLabels[col]}</div>
                </div>
              );
            })}
          </div>

          {/* X-axis label */}
          <div className="brick-drop-x-axis-label">
            Outcome ({market.xAxisUnits || 'Units'})
          </div>

          {/* Legend */}
          <div className="brick-drop-legend">
            <span className="legend-item">
              <span className="legend-swatch-brick" />
              Your Bricks (Your Belief)
            </span>
            <span className="legend-item">
              <span className="legend-dots">•••</span>
              Consensus Heat Map (All Traders)
            </span>
          </div>

          {/* Info bar */}
          <div className="brick-drop-info-bar">
            <span>ℹ Stack height represents probability mass. Bricks across all buckets must sum to 100%.</span>
          </div>
        </div>

        {/* ── Side panel ── */}
        <div className="brick-drop-sidebar">
          {/* Stake Amount */}
          <div className="brick-sidebar-section">
            <label className="brick-sidebar-label">STAKE AMOUNT (USDC)</label>
            <div className="brick-stake-input-wrap">
              <input
                type="number"
                className="brick-stake-input"
                value={collateral}
                onChange={(e) => setCollateral(Math.max(1, Number(e.target.value) || 0))}
                min={1}
              />
              <span className="brick-stake-icon">💰</span>
            </div>
            <span className="brick-stake-hint">Minimum: 1.00 USDC</span>
          </div>

          {/* Bricks Remaining */}
          <div className="brick-sidebar-section brick-remaining-section">
            <label className="brick-sidebar-label">BRICKS REMAINING</label>
            <div className="brick-remaining-row">
              <span className="brick-remaining-count">
                <strong>{bricksRemaining}</strong> / {TOTAL_BRICKS}
              </span>
              <span className="brick-remaining-sub">remaining</span>
            </div>
            <div className="brick-remaining-bar">
              <div
                className="brick-remaining-bar-fill"
                style={{ width: `${(bricksPlaced / TOTAL_BRICKS) * 100}%` }}
              />
            </div>
          </div>

          {/* Current Bucket */}
          <div className="brick-sidebar-section">
            <label className="brick-sidebar-label">CURRENT BUCKET</label>
            {hoveredColumn !== null ? (
              <div className="brick-current-bucket">
                <div className="brick-bucket-value">
                  <strong>{formatOutcome(hoveredOutcome!)}</strong>
                  <span className="brick-bucket-units">{market.xAxisUnits || 'Units'}</span>
                  {brickCounts[hoveredColumn] > 0 && (
                    <span className="brick-target-badge">TARGET</span>
                  )}
                </div>
                <span className="brick-bucket-payout">
                  Payout if resolved here: <strong style={{ color: hoveredPayout ? payoutColor(hoveredPayout.ratio) : '#4b5563' }}>
                    {hoveredPayout && payoutCurve ? `+$${hoveredPayout.payout.toFixed(0)}` : '–'}
                  </strong>
                </span>
              </div>
            ) : (
              <span className="brick-bucket-empty">Hover a column to see details</span>
            )}
          </div>

          {/* Est Payout Preview */}
          <div className="brick-sidebar-section brick-payout-section">
            <label className="brick-sidebar-label">EST. PAYOUT PREVIEW</label>
            {payoutCurve && !isBucketLocalPayoutPreview ? (
              <>
                <div className="brick-payout-big" style={{ color: '#f59e0b' }}>
                  ${payoutCurve.maxPayout.toFixed(2)}
                </div>
                <span className="brick-payout-sub" style={{ color: '#f59e0b' }}>
                  SDK max is at {formatOutcome(sdkMaxPayoutOutcome ?? payoutCurve.maxPayoutOutcome)} {market.xAxisUnits || 'Units'}; per-column labels hidden
                </span>
              </>
            ) : maxColumnPayout ? (
              <>
                <div className="brick-payout-big" style={{ color: '#4ade80' }}>
                  ${maxColumnPayout.payout.toFixed(2)}
                </div>
                <span className="brick-payout-sub">
                  If outcome is {formatOutcome(maxColumnPayout.outcomeCenter)} {market.xAxisUnits || 'Units'}
                </span>
              </>
            ) : isPreviewPending ? (
              <span className="brick-payout-loading">
                <span className="brick-mini-spinner" />
                Calculating payout...
              </span>
            ) : !isAuthenticated ? (
              <span className="brick-payout-sub" style={{ color: '#f59e0b' }}>Sign in to see payout estimates</span>
            ) : previewStatus === 'error' ? (
              <span className="brick-payout-sub" style={{ color: '#ef4444' }}>{previewError ?? 'Unable to preview payout'}</span>
            ) : (
              <span className="brick-payout-big" style={{ color: '#4b5563' }}>--</span>
            )}
          </div>

          {/* Controls hint */}
          <div className="brick-sidebar-section brick-controls">
            <div className="brick-control-row">
              <kbd>←</kbd> <kbd>→</kbd> <span>move</span>
              <kbd>SPACE</kbd> <span>drop</span>
            </div>
            <div className="brick-control-row">
              <span className="brick-mouse-icon">🖱</span> <span>Hover to aim</span>
            </div>
            <div className="brick-control-row">
              <span>Click brick or <kbd>⌫</kbd> to remove</span>
            </div>
          </div>

          {/* Lock status */}
          <div className="brick-sidebar-section brick-lock-status">
            {isLocked ? (
              <div className="brick-locked-badge">
                🔒 Distribution locked
              </div>
            ) : (
              <div className="brick-unlocked-badge">
                🔓 Distribution locked after all bricks are placed.
              </div>
            )}
          </div>

          {submitSuccess ? (
            <div className="brick-submit-success">
              ✅ Trade submitted successfully!
            </div>
          ) : (
            <button
              className="brick-submit-btn"
              disabled={!isAuthenticated || buyLoading}
              onClick={handleSubmit}
            >
              {buyLoading ? 'Submitting…' : 'Submit Trade'}
            </button>
          )}

          {buyError && (
            <div className="brick-error">{buyError.message}</div>
          )}

          <span className="brick-fine-print">All trades are on-chain and non-custodial.</span>
        </div>
      </div>
    </div>
  );
}
