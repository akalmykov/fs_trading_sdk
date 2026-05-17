import { useState, useCallback, useMemo, useEffect } from 'react';

/* ── Constants ── */
const COLUMNS = 13;
const ROUND_VALUES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25.5];
const COLUMN_LABELS = ['13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', 'OT'];
const CONSENSUS_P = [1.5, 2.0, 3.0, 4.5, 5.5, 7.0, 9.0, 11.5, 13.5, 14.0, 12.0, 9.0, 7.5];
const MAX_CONSENSUS_P = Math.max(...CONSENSUS_P);
const CONSENSUS_MEAN = ROUND_VALUES.reduce((s, v, i) => s + v * CONSENSUS_P[i] / 100, 0);
const TOTAL_BRICKS_MAX = 32;
const GRID_H = 224;
const MIN_BRICK_H = 7;
const MAX_BRICK_H = 24;

/* ── Color helpers ── */
const COLOR_ANCHORS = [
  { t: 0.00, hex: '#1c69d4' },  //  1 brick  — BMW blue (hue ~214°)
  { t: 0.09, hex: '#1c69d4' },  //  3 bricks — still blue
  { t: 0.30, hex: '#8b3dc8' },  // 10 bricks — vivid purple
  { t: 0.50, hex: '#e8105a' },  // 16 bricks — hot red-pink
  { t: 0.70, hex: '#0ea5a0' },  // 22 bricks — deep cyan-teal
  { t: 0.85, hex: '#0fb870' },  // 28 bricks — vivid teal-green
  { t: 1.00, hex: '#16a34a' },  // 32 bricks — vivid green
];

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

  const totalBricks = bricks.reduce((a, b) => a + b, 0);
  const userP = useMemo(() => totalBricks > 0 ? bricks.map(b => b / totalBricks) : bricks.map(() => 0), [bricks, totalBricks]);
  const multipliers = useMemo(() => userP.map((p, i) => p > 0 ? (CONSENSUS_P[i] / 100) / p : null), [userP]);
  const userMean = useMemo(() => totalBricks > 0 ? ROUND_VALUES.reduce((s, v, i) => s + v * userP[i], 0) : null, [userP, totalBricks]);
  const edge = userMean !== null ? userMean - CONSENSUS_MEAN : null;
  const pUnder235 = useMemo(() => totalBricks > 0 ? userP.slice(0, 11).reduce((s, p) => s + p, 0) * 100 : null, [userP, totalBricks]);

  useEffect(() => { if (onBeliefChange && totalBricks > 0) onBeliefChange(userP, userMean!, totalBricks); }, [userP, userMean, totalBricks]);

  const addBrick = useCallback((col: number) => {
    if (Math.floor(GRID_H / (bricks[col] + 1)) < MIN_BRICK_H || totalBricks >= TOTAL_BRICKS_MAX) return;
    setBricks(prev => { const n = [...prev]; n[col]++; return n; });
    if (totalBricks === 0) setHint(1);
    else if (totalBricks >= 7) setHint(2);
  }, [bricks, totalBricks]);

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

      <div className="bb-grid" onMouseLeave={() => setHoverCol(null)}>
        {bricks.map((count, col) => {
          const consensusH = (CONSENSUS_P[col] / MAX_CONSENSUS_P) * GRID_H;
          const brickH = getBrickH(count);
          const isHovered = hoverCol === col;
          const canAdd = Math.floor(GRID_H / (count + 1)) >= MIN_BRICK_H && totalBricks < TOTAL_BRICKS_MAX;

          return (
            <div key={col} className={`bb-col ${isHovered ? 'hovered' : ''}`} onMouseEnter={() => setHoverCol(col)} onClick={() => addBrick(col)}>
              <div className="bb-consensus-bar" style={{ height: consensusH }} />
              <div className="bb-brick-stack">
                {Array.from({ length: count }).map((_, i) => {
                  const edgeRatio = userP[col] > 0 ? (CONSENSUS_P[col] / 100) / userP[col] : 1;
                  const color = getBrickColor(count, edgeRatio);
                  return (
                    <div key={i} className="bb-brick"
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
            {m !== null ? `${Math.min(m, 9.9).toFixed(1)}×` : '—'}
          </div>
        ))}
      </div>

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
