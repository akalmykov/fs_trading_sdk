# Sample Output: `/implement-feature` Artifact Chain

This shows a realistic example of all artifacts produced by the `/implement-feature` skill for a fictional "order depth widget" feature.

---

## Original Input: `Docs/order-depth-widget-handoff.md`

```markdown
# Order Depth Widget

## Overview
Add an order depth visualization widget that displays buy/sell order book depth as a stacked area chart.

## Requirements
- Display bid and ask depth as mirrored area charts
- Accept a `marketId` prop to fetch order book data
- Support real-time updates via polling (reuse invalidation pattern)
- Use the SDK theme system for all colors
- Handle loading and error states

## API
- Core function: `queryOrderDepth(client, marketId)` -- returns `OrderDepthData`
- Hook: `useOrderDepth(marketId)` -- standard data-fetching hook
- Widget: `<OrderDepthChart marketId={...} />` -- self-contained widget

## Types
- `OrderDepthData`: `{ bids: DepthLevel[], asks: DepthLevel[], spread: number }`
- `DepthLevel`: `{ price: number, size: number, total: number }`
```

---

## Plan: `Docs/plans/order-depth-widget-plan.md`

```markdown
# Implementation Plan: Order Depth Widget

## Context
Adding an order depth visualization widget that displays bid/ask order book depth as a stacked area chart. This spans all three SDK layers: core (query function + types), react (data-fetching hook), and ui (chart component).

## Input Source
Handoff document: `Docs/order-depth-widget-handoff.md`

## Affected Layers
- **core** -- new query function + types
- **react** -- new data-fetching hook
- **ui** -- new chart component + styles

## Work Streams

### Work Stream 1: Core Layer (FOUNDATION)
**File ownership:**
- CREATE `packages/core/src/queries/queryOrderDepth.ts`
- CREATE `packages/core/src/types/orderDepth.ts`
- MODIFY `packages/core/src/index.ts`

**Steps:**
1. Define `OrderDepthData` and `DepthLevel` types in `packages/core/src/types/orderDepth.ts`
2. Create `queryOrderDepth(client, marketId)` in `packages/core/src/queries/queryOrderDepth.ts`
   - Follow pattern of `queryMarketState` in `packages/core/src/queries/queryMarketState.ts`
   - First param is `client`, second is `marketId: string | number`
   - Returns `Promise<OrderDepthData>`
3. Export function and types from `packages/core/src/index.ts`
   - `export { queryOrderDepth } from './queries/queryOrderDepth.js';`
   - `export type { OrderDepthData, DepthLevel } from './types/orderDepth.js';`

**PLAYBOOK checklist:** SDK Expansion Checklist -- Core Functions

### Work Stream 2: React Layer
**Depends on:** Work Stream 1 (core layer)

**File ownership:**
- CREATE `packages/react/src/useOrderDepth.ts`
- MODIFY `packages/react/src/index.ts`

**Steps:**
1. Create `useOrderDepth(marketId, options?)` hook in `packages/react/src/useOrderDepth.ts`
   - Follow canonical pattern from `packages/react/src/useMarket.ts`
   - Context check with throw
   - useQueryCache for cache access
   - CacheKey via useMemo: `['orderDepth', normalizedId]`
   - useCallback wrapping `queryOrderDepth` with AbortSignal: `(signal) => queryOrderDepth(ctx.client, marketId, { signal })`
   - useCacheSubscription for data subscription (uses useSyncExternalStore)
   - Return `{ orderDepth, loading, isFetching, error, refetch }`
   - Accept optional QueryOptions (pollInterval, enabled).
2. Export from `packages/react/src/index.ts`
   - `export { useOrderDepth } from './useOrderDepth.js';`

**PLAYBOOK checklist:** SDK Expansion Checklist -- Hooks (also use `add-hook` skill)

### Work Stream 3: UI Layer + Tests
**Depends on:** Work Stream 2 (react layer)

**File ownership:**
- CREATE `packages/ui/src/OrderDepthChart.tsx`
- MODIFY `packages/ui/src/index.ts`
- MODIFY `packages/ui/src/styles/base.css`
- MODIFY `tests/architecture.test.ts`
- MODIFY `tests/hooks.test.tsx`

**Steps:**
1. Create `OrderDepthChart` component in `packages/ui/src/OrderDepthChart.tsx`
   - Follow pattern of existing chart widget (reference `ShapeCutter` component structure)
   - Self-contained: own loading spinner, error message
   - Uses `useOrderDepth(marketId)` for data
   - Uses `useContext(FunctionSpaceContext)` with null check
   - Recharts AreaChart with `ctx.chartColors.*` for SVG props (NOT CSS variables)
   - All CSS classes prefixed with `fs-order-depth`
2. Add styles to `packages/ui/src/styles/base.css`
   - Add `.fs-order-depth` to derived-variables selector
   - Layout styles only -- colors via theme tokens
3. Export from `packages/ui/src/index.ts`
   - `export { OrderDepthChart } from './OrderDepthChart.js';`
4. Update `tests/architecture.test.ts`
   - Add `useOrderDepth` to hook export check
   - Add `OrderDepthChart` to component export check
   - Add `queryOrderDepth` to core function export check
5. Add hook tests to `tests/hooks.test.tsx`
   - `describe('useOrderDepth', () => { ... })`
   - Test: returns loading true initially
   - Test: returns data after fetch
   - Test: returns error on failure
   - Test: refetches on invalidation

**PLAYBOOK checklist:** SDK Expansion Checklist -- Widgets + Hooks

## Work Stream Dependencies
```
Work Stream 1 (core) -- FOUNDATION, runs first
  |
  v
Work Stream 2 (react) -- runs after core completes
  |
  v
Work Stream 3 (ui + tests) -- runs after react completes
```

Note: In this case all streams are sequential due to layer dependencies. For features that span fewer layers or have independent components, streams would run in parallel.

## Testing Strategy
- Architecture tests: verify all new exports (assigned to Work Stream 3)
- Hook behavior tests: standard 4-test pattern for useOrderDepth (assigned to Work Stream 3)
- No new test file created (using existing test files)

## Doc Updates Required
- PLAYBOOK.md: Add to Widget Reference (OrderDepthChart)
- PLAYBOOK.md: Add to Available Hooks table (useOrderDepth)
- PLAYBOOK.md: Add to Core Functions list under queries (queryOrderDepth)
- PLAYBOOK.md: Add `fs-order-depth` to derived-variables selector example
- PLAYBOOK.md: Add to File Locations
```

---

## Validation: `Docs/plans/order-depth-widget-validation/`

### `validator-codebase.md`

```markdown
# Codebase Accuracy Validation

**Plan:** Docs/plans/order-depth-widget-plan.md

## File Paths

| Path | Expected State | Actual State | Issue |
|------|---------------|--------------|-------|
| packages/core/src/queries/queryMarketState.ts | EXISTS (pattern ref) | EXISTS | -- |
| packages/core/src/index.ts | EXISTS (modify) | EXISTS | -- |
| packages/react/src/useMarket.ts | EXISTS (pattern ref) | EXISTS | -- |
| packages/react/src/index.ts | EXISTS (modify) | EXISTS | -- |
| packages/ui/src/index.ts | EXISTS (modify) | EXISTS | -- |
| packages/ui/src/styles/base.css | EXISTS (modify) | EXISTS | -- |
| tests/architecture.test.ts | EXISTS (modify) | EXISTS | -- |
| tests/hooks.test.tsx | EXISTS (modify) | EXISTS | -- |
| packages/core/src/types/ | EXISTS (parent for create) | EXISTS | -- |
| packages/core/src/queries/ | EXISTS (parent for create) | EXISTS | -- |

## Function/Method References

| Reference | Location | Expected Signature | Actual | Status |
|-----------|----------|-------------------|--------|--------|
| queryMarketState | core/src/queries/queryMarketState.ts | (client, marketId) => Promise<MarketState> | (client: FsClient, marketId: string \| number) => Promise<MarketState> | VERIFIED |
| useMarket | react/src/useMarket.ts | hook with standard pattern | matches canonical pattern | VERIFIED |
| FunctionSpaceContext | react/src/context.ts | React.Context | EXISTS, exported | VERIFIED |

## Import Validity

| Import | From | Symbol | Status | Issue |
|--------|------|--------|--------|-------|
| queryMarketState | @functionspace/core | named export | VALID | -- |
| FunctionSpaceContext | react/src/context.js | named export | VALID | -- |

## Type/Interface References

| Type | Location | Fields Referenced | Status |
|------|----------|-------------------|--------|
| MarketState | core/src/types/ | used as pattern reference | VERIFIED |
| FsClient | core/src/types/ | client type for query functions | VERIFIED |

## Test Infrastructure

| Test File | Exists | Framework | Utilities Available |
|-----------|--------|-----------|-------------------|
| tests/architecture.test.ts | yes | vitest | describe, it, expect |
| tests/hooks.test.tsx | yes | vitest | renderHook, act, vi.mock |

## Summary

- **File paths:** 10 verified, 0 issues
- **Functions/methods:** 3 verified, 0 issues
- **Imports:** 2 valid, 0 issues
- **Types:** 2 verified, 0 issues
- **Tests:** 2 verified, 0 issues

## Corrections Required

None. All plan references are accurate.
```

### `validator-gaps.md`

```markdown
# Gap Analysis Validation

**Plan:** Docs/plans/order-depth-widget-plan.md

## Dependency Chain

| Artifact | Depends On | Dependency in Plan? | Order Correct? |
|----------|-----------|-------------------|----------------|
| useOrderDepth | queryOrderDepth (core) | Yes, WS1 | Yes, WS1 before WS2 |
| OrderDepthChart | useOrderDepth (react) | Yes, WS2 | Yes, WS2 before WS3 |
| queryOrderDepth | OrderDepthData type | Yes, WS1 Step 1 | Yes, types before function |

## SDK Expansion Checklist Compliance

### For: New Widget + Hook + Core Function

| Checklist Item | In Plan? | Plan Step | Issue |
|----------------|----------|-----------|-------|
| Core function in correct directory | Yes | WS1 Step 2 | -- |
| Types defined | Yes | WS1 Step 1 | -- |
| Core function exported from index.ts | Yes | WS1 Step 3 | -- |
| Hook follows canonical pattern | Yes | WS2 Step 1 | -- |
| Hook exported from index.ts | Yes | WS2 Step 2 | -- |
| Component file created | Yes | WS3 Step 1 | -- |
| Styles in base.css | Yes | WS3 Step 2 | -- |
| Widget root class in derived-variables | Yes | WS3 Step 2 | -- |
| Loading state handled | Yes | WS3 Step 1 | -- |
| Error state handled | Yes | WS3 Step 1 | -- |
| Exported from ui index.ts | Yes | WS3 Step 3 | -- |
| Architecture test updated | Yes | WS3 Step 4 | -- |
| Hook behavior tests added | Yes | WS3 Step 5 | -- |
| Demo added to demo-app | MISSING | -- | No demo step in any work stream |
| PLAYBOOK.md updated | Yes | Doc Updates | -- |

**Missing items:** 1 of 15 checklist items not addressed

## Export Chain

| Symbol | Definition | Package Index | Status |
|--------|-----------|---------------|--------|
| queryOrderDepth | core/src/queries/queryOrderDepth.ts | core/index.ts WS1 Step 3 | COMPLETE |
| OrderDepthData | core/src/types/orderDepth.ts | core/index.ts WS1 Step 3 | COMPLETE |
| DepthLevel | core/src/types/orderDepth.ts | core/index.ts WS1 Step 3 | COMPLETE |
| useOrderDepth | react/src/useOrderDepth.ts | react/index.ts WS2 Step 2 | COMPLETE |
| OrderDepthChart | ui/src/OrderDepthChart.tsx | ui/index.ts WS3 Step 3 | COMPLETE |

## Test Coverage

| Artifact | Test File | Test Cases | Gaps |
|----------|-----------|------------|------|
| useOrderDepth | tests/hooks.test.tsx | loading, data, error, refetch | None |
| OrderDepthChart | NONE | NONE | No component tests planned |
| queryOrderDepth | NONE | NONE | No unit tests for core function |

## Doc Updates

| What Changed | Required Update | In Plan? | Issue |
|-------------|----------------|----------|-------|
| New widget | PLAYBOOK Widget Reference | Yes | -- |
| New hook | PLAYBOOK Available Hooks | Yes | -- |
| New core function | PLAYBOOK Core Functions | Yes | -- |
| New CSS class | PLAYBOOK derived-variables | Yes | -- |
| File locations | PLAYBOOK File Locations | Yes | -- |

## Step Ordering Issues

None. Sequential dependency chain (core -> react -> ui) is correctly ordered.

## Summary

- **Missing steps:** 1 (demo app integration)
- **Ordering issues:** 0
- **Checklist compliance:** 14 of 15 items covered
- **Export chain gaps:** 0
- **Test gaps:** 2 (no component tests, no core function unit tests)
- **Doc update gaps:** 0

## Recommended Additions

1. Add a step to Work Stream 3 (after Step 3): "Add OrderDepthChart demo to demo-app with sample marketId"
2. Consider adding basic unit tests for `queryOrderDepth` (validates request construction and response parsing)
```

### `validator-conventions.md`

```markdown
# Convention Compliance Validation

**Plan:** Docs/plans/order-depth-widget-plan.md

## Layer Boundaries

| Planned File | Layer | Imports From | Status |
|-------------|-------|-------------|--------|
| packages/core/src/queries/queryOrderDepth.ts | core | internal types only | VALID |
| packages/core/src/types/orderDepth.ts | core | none | VALID |
| packages/react/src/useOrderDepth.ts | react | @functionspace/core | VALID |
| packages/ui/src/OrderDepthChart.tsx | ui | @functionspace/core, @functionspace/react | VALID |

## Theming

| Issue | Plan Step | Details |
|-------|-----------|---------|
| None | -- | Plan correctly specifies ctx.chartColors.* for Recharts and var(--fs-*) for CSS |

## Naming Conventions

| Artifact | Planned Name | Expected Pattern | Status |
|----------|-------------|-----------------|--------|
| Core function | queryOrderDepth | query<Name> | VALID |
| Type | OrderDepthData | PascalCase | VALID |
| Type | DepthLevel | PascalCase | VALID |
| Hook file | useOrderDepth.ts | use<Name>.ts | VALID |
| Hook function | useOrderDepth | use<Name> | VALID |
| Component | OrderDepthChart.tsx | <Name>.tsx | VALID |
| CSS class | fs-order-depth | fs-<widget-name> | VALID |

## Pattern Compliance

### Hooks
useOrderDepth follows the canonical pattern exactly: context check, useQueryCache, CacheKey via useMemo, useCallback wrapping queryOrderDepth with AbortSignal, useCacheSubscription for data, return { orderDepth, loading, isFetching, error, refetch }. Accepts QueryOptions. COMPLIANT.

### Widgets
OrderDepthChart is self-contained with loading/error states, uses hook for data, uses context with null check, styles in base.css. COMPLIANT.

### Core Functions
queryOrderDepth uses client as first parameter, returns typed Promise. COMPLIANT.

## Anti-Patterns Detected

| Anti-Pattern | Plan Step | Details |
|-------------|-----------|---------|
| None detected | -- | -- |

## Summary

- **Layer violations:** 0
- **Theming violations:** 0
- **Naming deviations:** 0
- **Pattern deviations:** 0
- **Anti-patterns:** 0

## Corrections Required

None. Plan is fully convention-compliant.
```

---

## Completion Report: `Docs/plans/order-depth-widget-complete.md`

```markdown
# Implementation Complete: order-depth-widget

## What Was Built
Added a full-stack order depth visualization feature spanning all three SDK layers. The core layer provides `queryOrderDepth` for fetching order book data and `OrderDepthData`/`DepthLevel` types. The react layer provides `useOrderDepth`, a standard data-fetching hook following the canonical pattern. The ui layer provides `OrderDepthChart`, a self-contained Recharts-based area chart widget that displays bid/ask depth with theme-aware colors.

A demo was added to the demo-app showing the widget with a sample market ID (added per validator recommendation).

## Files Changed
- CREATE `packages/core/src/types/orderDepth.ts` -- OrderDepthData and DepthLevel types
- CREATE `packages/core/src/queries/queryOrderDepth.ts` -- query function
- MODIFY `packages/core/src/index.ts` -- added exports for queryOrderDepth, OrderDepthData, DepthLevel
- CREATE `packages/react/src/useOrderDepth.ts` -- data-fetching hook
- MODIFY `packages/react/src/index.ts` -- added useOrderDepth export
- CREATE `packages/ui/src/OrderDepthChart.tsx` -- chart widget component
- MODIFY `packages/ui/src/index.ts` -- added OrderDepthChart export
- MODIFY `packages/ui/src/styles/base.css` -- added .fs-order-depth styles and derived-variables entry
- MODIFY `tests/architecture.test.ts` -- added export checks for all new symbols
- MODIFY `tests/hooks.test.tsx` -- added useOrderDepth test suite (4 tests)
- MODIFY `demo-app/src/App.tsx` -- added OrderDepthChart demo section

## Deviations from Plan
- Added demo-app integration (was flagged as missing by validator-gaps, added to plan before implementation)
- No unit tests for queryOrderDepth core function (validator flagged this as a gap; deferred to follow-up since hook tests cover the integration path)

## Unresolved Issues
None.

## Test Results
```
 ✓ tests/architecture.test.ts (12 tests) 4ms
 ✓ tests/hooks.test.tsx (24 tests) 847ms
 ✓ tests/theme.test.ts (8 tests) 12ms

 Test Files  3 passed (3)
      Tests  44 passed (44)
   Start at  14:23:07
   Duration  2.34s

 vite v5.4.19 building for production...
 ✓ 127 modules transformed.
 dist/index.html          0.46 kB │ gzip:  0.30 kB
 dist/assets/index.css   14.22 kB │ gzip:  3.11 kB
 dist/assets/index.js   487.33 kB │ gzip: 152.88 kB
 ✓ built in 1.82s
```

## Doc Updates Made
- PLAYBOOK.md: Added OrderDepthChart to Widget Reference table
- PLAYBOOK.md: Added useOrderDepth to Available Hooks table
- PLAYBOOK.md: Added queryOrderDepth to Core Functions list (queries category)
- PLAYBOOK.md: Added .fs-order-depth to derived-variables selector example
- PLAYBOOK.md: Added new files to File Locations section
```

---

## Final User Prompt (displayed by orchestrator)

```
Implementation complete. To review, run:

/implement-feature-review with:
- Original handoff document: Docs/order-depth-widget-handoff.md
- Plan: Docs/plans/order-depth-widget-plan.md
- Validation: Docs/plans/order-depth-widget-validation/
- Completion report: Docs/plans/order-depth-widget-complete.md
```
