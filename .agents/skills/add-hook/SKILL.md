---
name: add-hook
description: Add a new data-fetching hook to the @functionspace/react package following SDK patterns
---

# Add React Hook

Adds a new data-fetching hook to `packages/react/src/` following the SDK's established patterns.

## Required Pattern

Every data-fetching hook MUST:

1. Accept `marketId: string | number` as first parameter
2. Accept optional `QueryOptions` as the last parameter (for `pollInterval`, `enabled`).
3. Get context via `useContext(FunctionSpaceContext)` and throw if missing
4. Get the cache via `useQueryCache()`
5. Build a `CacheKey` tuple via `useMemo` (e.g., `['queryName', normalizedId]`)
6. Wrap the core function in `useCallback` with `(signal: AbortSignal) => coreFn(ctx.client, marketId, { signal })`
7. Call `useCacheSubscription(cache, key, queryFn, options)` to subscribe to the cache entry
8. Return `{ <namedField>, loading, isFetching, error, refetch }`

## Reference Implementation

```typescript
// packages/react/src/useMarket.ts -- canonical example
import { useContext, useCallback, useMemo } from 'react';
import { queryMarketState } from '@functionspace/core';
import type { MarketState } from '@functionspace/core';
import type { QueryOptions, CacheKey } from './cache/index.js';
import { FunctionSpaceContext } from './context.js';
import { useQueryCache } from './QueryCacheContext.js';
import { useCacheSubscription } from './useCacheSubscription.js';

export function useMarket(marketId: string | number, options?: QueryOptions) {
  const ctx = useContext(FunctionSpaceContext);
  if (!ctx) throw new Error('useMarket must be used within FunctionSpaceProvider');

  const cache = useQueryCache();
  const normalizedId = String(marketId);
  const key: CacheKey = useMemo(() => ['marketState', normalizedId], [normalizedId]);

  const queryFn = useCallback(
    (signal: AbortSignal) => queryMarketState(ctx.client, marketId, { signal }),
    [ctx.client, marketId],
  );

  const { data, loading, isFetching, error, refetch } = useCacheSubscription<MarketState>(cache, key, queryFn, options);

  return { market: data, loading, isFetching, error, refetch };
}
```

**Key differences from the old useState+useEffect pattern:**
- No local `useState` for data, loading, or error -- all state comes from the cache via `useSyncExternalStore`
- No `useEffect` with `invalidationCount` dependency -- cache subscription handles invalidation automatically
- `loading` is true only on first fetch (no cached data); `isFetching` is true for any in-flight request
- `refetch` returns `Promise<void>` (was void)
- AbortSignal is passed to core functions for request cancellation

## Checklist

When adding a new hook, complete ALL of these steps:

### 1. Ensure the core function exists
- The hook wraps a function from `@functionspace/core` (e.g., `queryMarketState`)
- The core function must accept an options object with `signal?: AbortSignal` for request cancellation
- If the core function doesn't exist yet, create it first in the appropriate category:
  - `packages/core/src/queries/` for read-only data
  - `packages/core/src/transactions/` for mutations
  - `packages/core/src/previews/` for hypothetical calculations
- Export it from `packages/core/src/index.ts`

### 2. Create the hook file
- File: `packages/react/src/use<Name>.ts`
- Follow the exact pattern above -- context check, useQueryCache, CacheKey via useMemo, queryFn via useCallback with AbortSignal, useCacheSubscription

### 3. Export from react index
- Add to `packages/react/src/index.ts`:
  ```typescript
  export { use<Name> } from './use<Name>.js';
  ```
- If the hook has custom types, export those too:
  ```typescript
  export type { <TypeName> } from './use<Name>.js';
  ```

### 4. Add architecture test coverage
- In `tests/architecture.test.ts`, add the hook name to the "all hooks are exported from react package index" test:
  ```typescript
  expect(indexContent).toContain('use<Name>');
  ```

### 5. Add hook behavior tests
- In `tests/hooks.test.tsx`, add a describe block following existing patterns:
  ```typescript
  describe('use<Name>', () => {
    it('returns loading true initially', ...);
    it('returns data after fetch', ...);
    it('returns error on failure', ...);
    it('refetches on invalidation', ...);
  });
  ```

### 6. Update docs
- Add to `internal_sdk_docs/PLAYBOOK.md` Available Hooks table
- Add to `internal_sdk_docs/AGENTS.md` if a new test file was created

## Mutation Hook Pattern (Alternative)

If the hook wraps a state-changing operation (buy, sell) or a preview function, use the **mutation hook pattern** instead of the data-fetching pattern above:

- Use local `useState` for `loading` and `error` -- NOT `useCacheSubscription`
- Return `{ execute, loading, error, reset }` -- NOT `{ <named>, loading, isFetching, error, refetch }`
- `execute` is the trigger function, wrapped in `useCallback`
- On success: call `ctx.invalidate(marketId)` for state-changing operations (buy/sell)
- For preview hooks: manage an `AbortController` via `useRef`, aborting previous requests on new calls
- See `packages/react/src/useBuy.ts` and `packages/react/src/usePreviewPayout.ts` as reference implementations

## Layer Rules
- Hooks live in `packages/react/src/` -- they import from `@functionspace/core` only
- Never import from `@functionspace/ui` in a hook
- Never make direct API calls -- always wrap a core function
- State/action hooks (like `useAuth`) are exceptions to the cache subscription pattern
- Mutation hooks (like `useBuy`, `useSell`) are exceptions to the cache subscription pattern -- they use local `useState`
