/**
 * Polyfill for React.useEffectEvent (React 19 experimental API).
 *
 * react-reconciler 0.31 does not implement useEffectEvent in its dispatcher,
 * so calling the hook from React 19 throws at runtime:
 *   "resolveDispatcher().useEffectEvent is not a function"
 *
 * This polyfill replicates the semantics:
 *  - Returns a stable function reference (never changes identity across renders)
 *  - Always calls the latest version of `callback` (no stale-closure problem)
 *  - Not safe to call during render (matches the spec constraint)
 *
 * Uses useInsertionEffect to synchronously update the ref before any layout
 * or passive effects fire, which is the closest available primitive.
 */
import { useCallback, useInsertionEffect, useRef } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useEffectEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef<T>(fn)

  // useInsertionEffect fires synchronously before layout effects, ensuring
  // the ref is current before any effect callbacks read it.
  useInsertionEffect(() => {
    ref.current = fn
  })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(((...args) => ref.current(...args)) as T, [])
}
