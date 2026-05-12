# Brick-Drop Distribution Builder

Build a Tetris-inspired distribution builder UI for the Tesla Optimus prediction market (ID 212, 80 buckets, range [0, 5000]).

## Proposed Changes

### Overview

The user drops "bricks" into columns (each column = a price bucket). Stack height = belief weight. 20 total bricks ("probability budget"); unplaced bricks are distributed uniformly as a base prior. The brick colors encode **expected payout** (blue→amber), not height. A consensus heat map underlay shows crowd belief.

The belief vector is built via `generateCustomShape(controlValues, numBuckets, lb, ub)` — the brick counts per column ARE the control values. `usePreviewPayout` returns per-bucket payouts for coloring. `useBuy` submits the trade.

---

### Component: BrickDropBuilder

#### [NEW] [BrickDropBuilder.tsx](file:///Users/alexey.kalmykov/Developer/fs_trading_sdk/demo-app/src/components/BrickDropBuilder.tsx)

Main component — ~500 lines. Pure React + CSS (no canvas, no WebGL). Renders as a grid of columns with stacked brick `<div>`s.

**State:**
- `brickCounts: number[]` — array of length `numColumns` (we'll use ~16 visual columns, each mapping to ~5 engine buckets). Each entry = number of bricks dropped in that column.
- `hoveredColumn: number | null` — which column the cursor / arrow keys target
- `totalBricks = 20` — fixed budget
- `collateral: number` — stake amount (default 100)
- `locked: boolean` — set true when all 20 bricks are placed

**Belief construction:**
```typescript
// Map brick counts → control values for generateCustomShape
// Each visual column maps to a slice of the 80-bucket space
const controlValues = brickCounts; // length = numColumns
const belief = generateCustomShape(controlValues, numBuckets, lowerBound, upperBound);
```

> [!IMPORTANT]
> All belief math goes through `generateCustomShape` from `@functionspace/core`. We never normalize or compute distributions ourselves.

**Payout preview:**
On every brick placement, call `usePreviewPayout.execute(belief, collateral)` → returns `PayoutCurve` with `previews[i].payout`. Map each preview bucket to the visual column and take the max payout, or interpolate.

**Visuals per column:**
| Element | What it shows |
|---------|--------------|
| Stacked brick divs | Height = `brickCounts[col]` |
| Brick background gradient | `hsl(lerp(220→40), ...)` based on `payout/maxPayout` (blue→amber) |
| Payout label above column | `+$X` from `previews[col].payout`, or `–` if no bricks |
| Column base label | Outcome range (e.g. "2,500") |
| Consensus dot overlay | Small translucent bar at consensus probability height |
| Falling animation | CSS `@keyframes brickFall` — brick slides from top of column to stack top, with a subtle bounce |
| Glow effect | CSS `box-shadow` with `inset 0 0 8px` on each brick, brighter for higher payout |
| Landing particle | Brief CSS pseudo-element flash at impact point |
| Submit pulse | When `locked`, all bricks do a simultaneous `@keyframes brickPulse` animation |

**Interaction:**
- **Mouse**: hover over column to aim, click to drop
- **Keyboard**: ← → to move `hoveredColumn`, Space to drop
- **Undo**: right-click or Backspace to remove a brick from the hovered column
- When all 20 placed → `locked = true`, show "Distribution Locked" badge, enable Submit Trade

**Consensus heat map:**
Use `useConsensus(marketId, numColumns)` → `consensus.points` → for each column, average the density values. Render as a subtle dot/bar row at the bottom, color-graded by intensity.

---

#### [MODIFY] [App_BasicTradingLayout.tsx](file:///Users/alexey.kalmykov/Developer/fs_trading_sdk/demo-app/src/App_BasicTradingLayout.tsx)

- Add `isTeslaOptimusMarket = Number(marketId) === 212` check (similar to the WTI cone pattern)
- When true, render `<BrickDropBuilder>` on the left (flex: 7) + a custom side panel on the right (flex: 3)
- The side panel shows: Stake Amount, Bricks Remaining (with a lego icon), Current Bucket info, Est. Payout Preview, keyboard hints, Submit Trade button

---

#### [MODIFY] [index.css](file:///Users/alexey.kalmykov/Developer/fs_trading_sdk/demo-app/src/index.css)

Add ~120 lines of styles:

- `.brick-drop-card` — container with dark background, border, border-radius
- `.brick-drop-header` — title bar with "Brick-Drop Distribution Builder" + NEW badge + "How it works" button
- `.brick-grid` — the column grid with gap, flex layout
- `.brick-column` — individual column with relative positioning
- `.brick` — individual brick div with gradient, glow, rounded corners
- `.brick-column.hovered` — highlight effect, pulsing border
- `@keyframes brickFall` — translateY(-100%) → 0 with cubic-bezier bounce
- `@keyframes brickLand` — brief scale(1.05) → scale(1) with opacity flash
- `@keyframes brickPulse` — submit lock-in animation
- `.consensus-dot` — consensus heat map indicator
- `.payout-label` — per-column payout text above the stacks
- `.brick-drop-sidebar` — right-side trade panel styling
- `.target-bucket-indicator` — the ▼ arrow above the active column

---

### Side Panel (within BrickDropBuilder or separate component)

The right panel mirrors the mockup:

| Section | Content |
|---------|---------|
| STAKE AMOUNT | Input field (default 100 USDC) |
| BRICKS REMAINING | `X / 20 remaining` + visual lego icon |
| CURRENT BUCKET | `X Units` + TARGET badge + "Payout if brick lands: +$Y" |
| EST. PAYOUT PREVIEW | Large `$X.XX` + "If outcome is Y Units" |
| Controls hint | ← → move, SPACE drop, 🖱 Hover to aim |
| Lock status | 🔒 "Distribution locked after all bricks are placed" |
| Submit Trade | Button (disabled until locked or until auth) |

---

## Open Questions

> [!IMPORTANT]
> **Number of visual columns**: The market has 80 buckets. Showing 80 columns is too dense. I propose **16 visual columns** (each maps to 5 engine buckets). The brick count in each visual column is spread evenly across its 5 engine buckets. Does 16 columns feel right, or would you prefer 10 or 20?

> [!IMPORTANT]
> **Brick removal**: The mockup doesn't show an undo mechanism. I plan right-click or Backspace to remove bricks. Should we also have a "Reset All" button?

> [!IMPORTANT]
> **"How it works" modal**: The mockup shows a "How it works" button. Should I build a quick tutorial modal, or skip it for now?

---

## Verification Plan

### Automated Tests
- Run `npm run dev` and open in browser
- Verify bricks fall with animation when clicking columns
- Verify payout labels update after each brick drop
- Verify consensus heat map renders
- Verify keyboard navigation (← → Space)
- Verify belief vector is valid by checking `generateCustomShape` output
- Verify Submit Trade calls `useBuy` with correct belief vector

### Manual Verification
- Visual inspection of the brick animations, glow effects, color gradients
- Test the full flow: drop 20 bricks → see Distribution Locked → Sign In → Submit Trade
