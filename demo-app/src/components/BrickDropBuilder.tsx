import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMarket,
  useConsensus,
  useBuy,
  usePreviewPayout,
  useAuth,
} from '@functionspace/react';
import {
  generateCustomShape,
  computeStatistics,
} from '@functionspace/core';
import type { BeliefVector, PayoutCurve } from '@functionspace/core';

/* ── constants ── */
const TOTAL_BRICKS = 20;
const NUM_VISUAL_COLUMNS = 16;
const COLLATERAL_DEFAULT = 100;
const PAYOUT_PREVIEW_TIMEOUT_MS = 12_000;

/* ── helpers ── */
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function formatOutcome(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
}

function payoutColor(ratio: number): string {
  // 0 → cool blue (hsl 220), 1 → hot amber (hsl 40)
  const hue = 220 - ratio * 180; // 220 → 40
  const sat = 70 + ratio * 20;   // 70% → 90%
  const lit = 45 + ratio * 15;   // 45% → 60%
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

function neutralBrickColor(): string {
  return '#2563eb';
}

function buildBeliefFromBricks(
  brickCounts: number[],
  totalBricks: number,
  numBuckets: number,
  lowerBound: number,
  upperBound: number,
): BeliefVector {
  const bricksPlaced = brickCounts.reduce((sum, count) => sum + count, 0);
  const bricksRemaining = Math.max(0, totalBricks - bricksPlaced);
  const uniformPrior = bricksRemaining / brickCounts.length;
  const controlValues = brickCounts.map((count) => count + uniformPrior);
  return generateCustomShape(controlValues, numBuckets, lowerBound, upperBound);
}

function payoutGlow(ratio: number): string {
  const hue = 220 - ratio * 180;
  return `0 0 ${6 + ratio * 12}px hsla(${hue}, 90%, 55%, ${0.25 + ratio * 0.45})`;
}

/* ── types ── */
interface ColumnPayoutInfo {
  payout: number;
  ratio: number; // 0-1 normalised
  outcomeCenter: number;
}

type PreviewStatus = 'idle' | 'debouncing' | 'loading' | 'ready' | 'error';

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
  const [pulseAll, setPulseAll] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const brickIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingDropsRef = useRef(0);
  const previewRequestRef = useRef(0);

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
    if (!currentBelief || !market || !isAuthenticated) {
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
    setPayoutCurve(null);
    setPreviewStatus('debouncing');
    setPreviewError(null);
    debounceRef.current = setTimeout(() => {
      setPreviewStatus('loading');
      previewTimeoutRef.current = setTimeout(() => {
        if (requestId !== previewRequestRef.current) return;
        previewRequestRef.current += 1;
        setPayoutCurve(null);
        setPreviewStatus('error');
        setPreviewError('Payout preview timed out. Try adjusting the bricks or stake amount.');
      }, PAYOUT_PREVIEW_TIMEOUT_MS);

      previewPayoutRef.current(currentBelief, collateral, NUM_VISUAL_COLUMNS)
        .then((curve) => {
          if (requestId !== previewRequestRef.current) return;
          if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
          setPayoutCurve(curve);
          setPreviewStatus('ready');
          setPreviewError(null);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (requestId !== previewRequestRef.current) return;
          if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
          setPayoutCurve(null);
          setPreviewStatus('error');
          setPreviewError(err instanceof Error ? err.message : String(err));
        });
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, [brickCountsKey, collateral, market, numBuckets, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── payout info per column ── */
  const columnPayouts = useMemo<ColumnPayoutInfo[]>(() => {
    const step = (ub - lb) / NUM_VISUAL_COLUMNS;
    if (!payoutCurve?.previews?.length) {
      return Array.from({ length: NUM_VISUAL_COLUMNS }, (_, i) => ({
        payout: 0,
        ratio: 0,
        outcomeCenter: lb + step * (i + 0.5),
      }));
    }
    const previews = payoutCurve.previews;
    const infos: ColumnPayoutInfo[] = [];
    for (let i = 0; i < NUM_VISUAL_COLUMNS; i++) {
      const previewIndex = Math.min(
        previews.length - 1,
        Math.round((i / Math.max(1, NUM_VISUAL_COLUMNS - 1)) * (previews.length - 1)),
      );
      infos.push({
        payout: previews[previewIndex].payout,
        ratio: 0,
        outcomeCenter: lb + step * (i + 0.5),
      });
    }
    const minP = Math.min(...infos.map((i) => i.payout));
    const maxP = Math.max(...infos.map((i) => i.payout));
    const range = Math.max(maxP - minP, 1e-10);
    return infos.map((i) => ({ ...i, ratio: (i.payout - minP) / range }));
  }, [payoutCurve, lb, ub]);

  const maxColumnPayout = useMemo(() => {
    if (previewStatus !== 'ready' || !payoutCurve) return null;
    return columnPayouts.reduce((best, current) =>
      current.payout > best.payout ? current : best,
    columnPayouts[0]);
  }, [columnPayouts, payoutCurve, previewStatus]);

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
      }, 350);
    },
    [bricksPlaced, brickCounts],
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
    setPulseAll(false);
    setSubmitSuccess(false);
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
        <button className="brick-drop-how-btn" onClick={resetAll} title="Reset all bricks">
          ↻ Reset
        </button>
      </div>

      <div className="brick-drop-body">
        {/* ── Main grid area ── */}
        <div className="brick-drop-grid-area">
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
              const hasPayout = Boolean(payoutCurve && previewStatus === 'ready');
              const brickColor = hasPayout ? payoutColor(payoutInfo.ratio) : neutralBrickColor();
              const brickHotColor = hasPayout
                ? payoutColor(Math.min(1, payoutInfo.ratio + 0.15))
                : '#38bdf8';
              const brickShadow = hasPayout
                ? payoutGlow(payoutInfo.ratio)
                : '0 0 10px rgba(56, 189, 248, 0.35)';

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
                    className="brick-payout-label"
                    style={{ color: hasPayout ? payoutColor(payoutInfo.ratio) : '#4b5563' }}
                  >
                    {hasPayout ? `+$${payoutInfo.payout.toFixed(0)}` : '–'}
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
                    {Array.from({ length: count }).map((_, row) => (
                      <div
                        key={row}
                        className={`brick ${pulseAll ? 'pulse' : ''}`}
                        style={{
                          bottom: `${row * 28}px`,
                          background: `linear-gradient(135deg, ${brickColor}, ${brickHotColor})`,
                          boxShadow: brickShadow,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBrick(col);
                        }}
                      >
                        <div className="brick-inner-shine" />
                      </div>
                    ))}

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
              <span className="legend-swatch-brick" style={{ background: 'linear-gradient(135deg, hsl(160,80%,50%), hsl(40,90%,55%))' }} />
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
                    {hoveredPayout && payoutCurve && previewStatus === 'ready' ? `+$${hoveredPayout.payout.toFixed(0)}` : '–'}
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
            {maxColumnPayout ? (
              <>
                <div className="brick-payout-big" style={{ color: '#4ade80' }}>
                  ${maxColumnPayout.payout.toFixed(2)}
                </div>
                <span className="brick-payout-sub">
                  If outcome is {formatOutcome(maxColumnPayout.outcomeCenter)} {market.xAxisUnits || 'Units'}
                </span>
              </>
            ) : previewStatus === 'debouncing' || previewStatus === 'loading' ? (
              <span className="brick-payout-sub">Calculating payout...</span>
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
