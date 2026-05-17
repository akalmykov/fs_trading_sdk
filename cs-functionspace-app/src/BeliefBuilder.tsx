import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { generateBelief } from '@functionspace/core';
import type { Region } from '@functionspace/core/src/math/generators.js';

/* ── Constants ── */
const COLUMNS = 13;
const ROUND_VALUES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25.5];
const LOWER_BOUND = 12.5;
const UPPER_BOUND = 26;
const NUM_BUCKETS = 50;
const MAX_SPREAD = (UPPER_BOUND - LOWER_BOUND) * 0.25;
const COLUMN_LABELS = ['13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', 'OT'];
const CONSENSUS_P = [1.5, 2.0, 3.0, 4.5, 5.5, 7.0, 9.0, 11.5, 13.5, 14.0, 12.0, 9.0, 7.5];
const MAX_CONSENSUS_P = Math.max(...CONSENSUS_P);
const CONSENSUS_MEAN = ROUND_VALUES.reduce((s, v, i) => s + v * CONSENSUS_P[i] / 100, 0);
const TOTAL_BRICKS_MAX = 32;
const GRID_H = 224;
const COL_PITCH = 36;
const COL_W = 34;
const MIN_BRICK_H = 7;
const MAX_BRICK_H = 24;

/* ── Color helpers ── */
const COLOR_ANCHORS = [
  { t: 0.00, hex: '#0066ff' },  //  1 brick  — vivid electric blue
  { t: 0.09, hex: '#0066ff' },  //  3 bricks — still vivid blue
  { t: 0.30, hex: '#8b3dc8' },  // 10 bricks — vivid purple
  { t: 0.50, hex: '#e8105a' },  // 16 bricks — hot red-pink
  { t: 0.70, hex: '#0ea5a0' },  // 22 bricks — deep cyan-teal
  { t: 0.85, hex: '#0fb870' },  // 28 bricks — vivid teal-green
  { t: 1.00, hex: '#16a34a' },  // 32 bricks — vivid green
];

function bricksToRegions(bricks: number[]): Region[] {
  const total = bricks.reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const regions: Region[] = [];
  const spread = (UPPER_BOUND - LOWER_BOUND) * 0.06;
  for (let col = 0; col < bricks.length; col++) {
    if (bricks[col] === 0) continue;
    const center = LOWER_BOUND + (col / (bricks.length - 1)) * (UPPER_BOUND - LOWER_BOUND);
    regions.push({ type: 'point', center, spread, weight: bricks[col] });
  }
  return regions;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function adjustSaturation(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  s = Math.min(1, s * factor);
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hue2rgb(p, q, h + 1/3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1/3) * 255);
}

function lighten(hex: string, amount: number): string {
  // Add lightness in HSL space
  const [r, g, b] = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  l = Math.min(1, l + amount);
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hue2rgb(p, q, h + 1/3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1/3) * 255);
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hue2rgb(p, q, h + 1/3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1/3) * 255);
}

function getBrickColor(brickCount: number, edgeRatio: number): string {
  const t = Math.max(0, Math.min(1, (brickCount - 1) / 31));
  let lo = COLOR_ANCHORS[0], hi = COLOR_ANCHORS[1];
  for (let i = 1; i < COLOR_ANCHORS.length; i++) {
    if (t <= COLOR_ANCHORS[i].t) { lo = COLOR_ANCHORS[i - 1]; hi = COLOR_ANCHORS[i]; break; }
    if (i === COLOR_ANCHORS.length - 1) { lo = COLOR_ANCHORS[i - 1]; hi = COLOR_ANCHORS[i]; }
  }
  const frac = hi.t === lo.t ? 1 : (t - lo.t) / (hi.t - lo.t);
  // Interpolate in HSL for clean hue rotation
  const [h1, s1, l1] = hexToHsl(lo.hex);
  const [h2, s2, l2] = hexToHsl(hi.hex);
  // Shortest hue path
  let dh = h2 - h1;
  if (dh > 0.5) dh -= 1;
  if (dh < -0.5) dh += 1;
  const h = ((h1 + dh * frac) % 1 + 1) % 1;
  const s = s1 + (s2 - s1) * frac;
  const l = l1 + (l2 - l1) * frac;
  const base = hslToHex(h, s, l);

  let satMod = 1.0;
  if (edgeRatio < 0.5) satMod = 0.45;
  else if (edgeRatio < 1.0) satMod = 0.75;
  else if (edgeRatio < 2.0) satMod = 1.0;
  else if (edgeRatio < 4.0) satMod = 1.2;
  else satMod = 1.35;
  return adjustSaturation(base, satMod);
}

function getMultiplierColor(mult: number): string {
  if (mult < 0.8) return '#dc2626';
  if (mult <= 1.2) return '#6b6b6b';
  if (mult <= 2.0) return '#3c3c3c';
  if (mult <= 4.0) return '#1c69d4';
  return '#f59e0b';
}

function getBrickH(count: number): number {
  if (count <= 0) return MAX_BRICK_H;
  const naturalHeight = count * MAX_BRICK_H;
  if (naturalHeight <= GRID_H) {
    return MAX_BRICK_H;
  } else {
    return Math.max(MIN_BRICK_H, Math.floor(GRID_H / count));
  }
}

/* ── Component ── */
export interface BeliefBuilderProps {
  onBeliefChange?: (userP: number[], userMean: number, totalBricks: number) => void;
}

export function BeliefBuilder({ onBeliefChange }: BeliefBuilderProps) {
  const [bricks, setBricks] = useState<number[]>(new Array(COLUMNS).fill(0));
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [hint, setHint] = useState(0);
  const [fallingCols, setFallingCols] = useState<Set<number>>(new Set());
  const [flashCols, setFlashCols] = useState<Record<number, string>>({});
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Array<{ x: number; y: number; angle: number; speed: number; length: number; width: number; startOpacity: number; size: number; life: number; born: number; color: string }>>([]);
  const animFrameRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const totalBricks = bricks.reduce((a, b) => a + b, 0);
  const userP = useMemo(() => totalBricks > 0 ? bricks.map(b => b / totalBricks) : bricks.map(() => 0), [bricks, totalBricks]);

  // Build belief vector from the smooth curve (for submission/display)
  const beliefVector = useMemo(() => {
    if (totalBricks === 0) return null;
    return generateBelief(bricksToRegions(bricks), NUM_BUCKETS, LOWER_BOUND, UPPER_BOUND);
  }, [bricks, totalBricks]);

  // Discrete multiplier: userP[col] / consensusP[col]
  const BASE_STAKE = 100;
  const stake = BASE_STAKE * (totalBricks / TOTAL_BRICKS_MAX);
  const multipliers = useMemo(() => userP.map((p, i) => p > 0 ? p / (CONSENSUS_P[i] / 100) : null), [userP]);
  const returnIfWin = useMemo(() => multipliers.map((m, i) => m !== null ? stake * userP[i] * m : null), [multipliers, stake, userP]);
  const userMean = useMemo(() => totalBricks > 0 ? ROUND_VALUES.reduce((s, v, i) => s + v * userP[i], 0) : null, [userP, totalBricks]);
  const edge = userMean !== null ? userMean - CONSENSUS_MEAN : null;
  const pUnder235 = useMemo(() => totalBricks > 0 ? userP.slice(0, 11).reduce((s, p) => s + p, 0) * 100 : null, [userP, totalBricks]);

  // Compute belief curve SVG path from beliefVector
  const beliefPath = useMemo(() => {
    if (!beliefVector) return '';
    const max = Math.max(...beliefVector);
    if (max === 0) return '';
    const gridW = COLUMNS * COL_PITCH - 2;
    const points = beliefVector.map((v, i) => {
      const x = (i / (beliefVector.length - 1)) * gridW;
      const y = GRID_H - (v / max) * GRID_H * 0.9;
      return `${x},${y}`;
    });
    return `M${points.join('L')}`;
  }, [beliefVector]);

  useEffect(() => { if (onBeliefChange && totalBricks > 0) onBeliefChange(userP, userMean!, totalBricks); }, [userP, userMean, totalBricks]);

  // Particle system constants
  const GRAVITY = 600;
  const CANVAS_PAD_X = 60;
  const CANVAS_PAD_Y = 140;

  const tickParticles = useCallback(() => {
    const canvas = particleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const now = performance.now();
    particlesRef.current = particlesRef.current.filter(p => now - p.born < p.life);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particlesRef.current) {
      const dt = (now - p.born) / 1000;
      const lifeFraction = 1 - dt / (p.life / 1000);
      if (lifeFraction <= 0) continue;
      const dx = Math.cos(p.angle) * p.speed * dt;
      const dy = -Math.sin(p.angle) * p.speed * dt + 0.5 * GRAVITY * dt * dt;
      const x = p.x + dx;
      const y = p.y + dy;
      const vx = Math.cos(p.angle) * p.speed;
      const vy = -Math.sin(p.angle) * p.speed + GRAVITY * dt;
      const travelAngle = Math.atan2(vy, vx);
      const len = p.length * lifeFraction;
      const wid = p.width * lifeFraction;
      ctx.save();
      ctx.globalAlpha = lifeFraction * p.startOpacity;
      ctx.fillStyle = p.color;
      ctx.translate(x, y);
      ctx.rotate(travelAngle);
      ctx.fillRect(-len / 2, -wid / 2, len, wid);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (particlesRef.current.length > 0) {
      animFrameRef.current = requestAnimationFrame(tickParticles);
    } else {
      animFrameRef.current = null;
    }
  }, []);

  const SPARK_COLOURS = ['#ffffff', '#fff4c2', '#ffcc00', '#ff8c00', '#ff4500', '#e83010'];
  const SPARK_WEIGHTS = [0.05, 0.10, 0.15, 0.25, 0.28, 0.17];

  const randomSparkColour = useCallback(() => {
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < SPARK_WEIGHTS.length; i++) {
      cum += SPARK_WEIGHTS[i];
      if (r < cum) return SPARK_COLOURS[i];
    }
    return SPARK_COLOURS[5];
  }, []);

  const spawnSparks = useCallback((col: number, count: number) => {
    if (reducedMotion.current) return;
    const canvas = particleCanvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return;
    const gridRect = grid.getBoundingClientRect();
    canvas.width = gridRect.width + CANVAS_PAD_X * 2;
    canvas.height = GRID_H + CANVAS_PAD_Y;
    // Impact point: bottom edge of new brick
    const brickH = getBrickH(count);
    const stackH = count * brickH;
    const impactY = (GRID_H - stackH + brickH) + CANVAS_PAD_Y; // canvas-local, bottom of new brick
    const colX = col * COL_PITCH + CANVAS_PAD_X; // canvas-local X
    const sparkCount = Math.round(10 + (count - 1) / 31 * 10);
    for (let i = 0; i < sparkCount; i++) {
      const speed = 280 + Math.random() * 240;
      const angle = (-20 + Math.random() * 220) * Math.PI / 180;
      particlesRef.current.push({
        x: colX + Math.random() * COL_W,
        y: impactY,
        angle,
        speed,
        length: speed * 0.055,
        width: 2.0,
        startOpacity: 0.75 + Math.random() * 0.25,
        size: 0,
        life: 280 + Math.random() * 200,
        born: performance.now(),
        color: randomSparkColour(),
      });
    }
    if (!animFrameRef.current) animFrameRef.current = requestAnimationFrame(tickParticles);
  }, [tickParticles, randomSparkColour]);

  // Cleanup animation frame on unmount
  useEffect(() => () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); }, []);

  const addBrick = useCallback((col: number) => {
    if (Math.floor(GRID_H / (bricks[col] + 1)) < MIN_BRICK_H || totalBricks >= TOTAL_BRICKS_MAX) return;
    const newCount = bricks[col] + 1;
    setBricks(prev => { const n = [...prev]; n[col]++; return n; });
    if (totalBricks === 0) setHint(1);
    else if (totalBricks >= 7) setHint(2);

    if (!reducedMotion.current) {
      // Trigger fall animation
      setFallingCols(prev => new Set(prev).add(col));
      setTimeout(() => setFallingCols(prev => { const n = new Set(prev); n.delete(col); return n; }), 220);

      // Trigger column flash
      const edgeRatio = (newCount > 0 && totalBricks + 1 > 0) ? (CONSENSUS_P[col] / 100) / (newCount / (totalBricks + 1)) : 1;
      const color = getBrickColor(newCount, edgeRatio);
      setFlashCols(prev => ({ ...prev, [col]: color }));
      setTimeout(() => setFlashCols(prev => { const n = { ...prev }; delete n[col]; return n; }), 320);

      // Spawn sparks at t=160ms
      setTimeout(() => spawnSparks(col, newCount), 160);
    }
  }, [bricks, totalBricks, spawnSparks]);

  const removeBrick = useCallback((col: number) => {
    if (bricks[col] <= 0) return;
    setBricks(prev => { const n = [...prev]; n[col]--; return n; });
  }, [bricks]);

  const edgeColor = edge === null ? '#6b6b6b' : edge > 0.5 ? '#1c69d4' : edge < -0.5 ? '#dc2626' : '#6b6b6b';

  return (
    <div className="bb-container">
      <div className="bb-context">
        <span>Market consensus: {CONSENSUS_MEAN.toFixed(1)} rounds avg · P(under 23.5): 83.5%</span>
        {totalBricks > 0 && <button className="bb-reset" onClick={() => setBricks(new Array(COLUMNS).fill(0))}>Reset</button>}
      </div>

      <div className="bb-counts">
        {bricks.map((count, i) => (
          <div key={i} className="bb-count">{count > 0 ? count : '–'}</div>
        ))}
      </div>

      <div className="bb-grid" ref={gridRef} onMouseLeave={() => setHoverCol(null)}>
        <canvas ref={particleCanvasRef} className="bb-particle-canvas" />
        {beliefPath && (
          <svg className="bb-curve-overlay" viewBox={`0 0 ${COLUMNS * COL_PITCH - 2} ${GRID_H}`} preserveAspectRatio="none">
            <path d={beliefPath} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          </svg>
        )}
        {bricks.map((count, col) => {
          const consensusH = (CONSENSUS_P[col] / MAX_CONSENSUS_P) * GRID_H;
          const brickH = getBrickH(count);
          const isHovered = hoverCol === col;
          const canAdd = Math.floor(GRID_H / (count + 1)) >= MIN_BRICK_H && totalBricks < TOTAL_BRICKS_MAX;
          const isFalling = fallingCols.has(col);

          return (
            <div key={col} className={`bb-col ${isHovered ? 'hovered' : ''}`} onMouseEnter={() => setHoverCol(col)} onClick={() => addBrick(col)}>
              <div className="bb-consensus-bar" style={{ height: consensusH }} />
              {flashCols[col] && <div className="bb-col-flash" style={{ background: flashCols[col] }} />}
              <div className="bb-brick-stack">
                {Array.from({ length: count }).map((_, i) => {
                  const edgeRatio = userP[col] > 0 ? (CONSENSUS_P[col] / 100) / userP[col] : 1;
                  const color = getBrickColor(count, edgeRatio);
                  const isNewest = i === count - 1 && isFalling;
                  return (
                    <div key={i} className={`bb-brick ${isNewest ? 'falling' : ''}`}
                      style={{ height: brickH, background: color, borderTop: `1.5px solid ${lighten(color, 0.12)}`, transition: 'height 180ms ease-in-out, background 180ms ease-in-out' }}
                      onClick={(e) => { e.stopPropagation(); removeBrick(col); }}
                    />
                  );
                })}
              </div>
              {isHovered && canAdd && <div className="bb-ghost" style={{ height: getBrickH(count + 1) }} />}
            </div>
          );
        })}
      </div>

      <div className="bb-labels">
        {COLUMN_LABELS.map((label, i) => (
          <div key={i} className={`bb-label ${hoverCol === i ? 'active' : ''}`}>
            <span className="bb-label-round">{label}</span>
            <span className="bb-label-pct">{CONSENSUS_P[i]}%</span>
          </div>
        ))}
      </div>

      <div className="bb-buttons">
        {bricks.map((count, col) => {
          const canAdd = Math.floor(GRID_H / (count + 1)) >= MIN_BRICK_H && totalBricks < TOTAL_BRICKS_MAX;
          return (
            <button key={col} className="bb-add-btn" onClick={() => canAdd ? addBrick(col) : removeBrick(col)}>
              {canAdd ? '+' : '−'}
            </button>
          );
        })}
      </div>

      <div className="bb-multipliers">
        {multipliers.map((m, i) => (
          <div key={i} className="bb-mult" style={{ color: m !== null ? getMultiplierColor(m) : '#9a9a9a' }}>
            {m !== null ? `${Math.min(m, 99).toFixed(1)}×` : '—'}
          </div>
        ))}
      </div>

      {totalBricks > 0 && (
        <div className="bb-returns">
          {returnIfWin.map((r, i) => (
            <div key={i} className="bb-return">
              {r !== null ? `$${r >= 100 ? r.toFixed(0) : r.toFixed(1)}` : '—'}
            </div>
          ))}
        </div>
      )}

      {totalBricks > 0 && <div className="bb-inference">Your implied P(under 23.5): {pUnder235!.toFixed(0)}% · Your mean: {userMean!.toFixed(1)} rounds</div>}

      <div className="bb-summary">
        {totalBricks > 0 ? (<>
          <span style={{ color: '#262626', fontWeight: 700 }}>Your mean: {userMean!.toFixed(1)} rds</span>
          <span style={{ color: '#6b6b6b' }}>Market: {CONSENSUS_MEAN.toFixed(1)} rds</span>
          <span style={{ color: edgeColor }}>Edge: {edge! >= 0 ? '+' : ''}{edge!.toFixed(1)} rds</span>
          <span style={{ color: totalBricks > 28 ? '#f59e0b' : '#9a9a9a' }}>{totalBricks}/{TOTAL_BRICKS_MAX}</span>
        </>) : <span style={{ color: '#9a9a9a' }}>Click columns to build your belief</span>}
      </div>

      <div className="bb-progress-track">
        <div className="bb-progress-fill" style={{ width: `${(totalBricks / TOTAL_BRICKS_MAX) * 100}%`, background: totalBricks > 28 ? '#f59e0b' : '#1c69d4' }} />
      </div>

      <div className="bb-hint">
        {hint === 0 && totalBricks === 0 && 'Click any column to place a brick — more bricks means more confidence.'}
        {hint === 1 && totalBricks > 0 && totalBricks < 8 && 'Blue = near market · Gold shimmer = high contrarian upside'}
        {hint === 2 && totalBricks >= 8 && 'Looking good. Set your stake below when ready.'}
      </div>
    </div>
  );
}
