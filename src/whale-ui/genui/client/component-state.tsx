import { createContext, useCallback, useContext, useState } from 'react'

export interface GenuiComponentStateOwner {
  values: Record<string, unknown>
  getValue: (key: string, fallback: unknown) => unknown
  setValue: (key: string, value: unknown) => void
}
export const GenuiComponentStateContext = createContext<GenuiComponentStateOwner | undefined>(undefined)
export const GenuiComponentPathContext = createContext('')

/** Renderer path is stable across updates and includes tab/section identity. */
export function useGenuiComponentState<T>(name: string, fallback: T): [T, (next: T | ((old: T) => T)) => void] {
  const owner = useContext(GenuiComponentStateContext)
  const path = useContext(GenuiComponentPathContext)
  const key = `${path}:${name}`
  const [local, setLocal] = useState(fallback)
  const value = owner !== undefined ? Object.hasOwn(owner.values, key) ? owner.values[key] as T : fallback : local
  const setValue = useCallback((next: T | ((old: T) => T)) => {
    const current = owner === undefined ? fallback : owner.getValue(key, fallback) as T
    if (owner === undefined) setLocal(next)
    else owner.setValue(key, typeof next === 'function' ? (next as (old: T) => T)(current) : next)
  }, [owner, key, fallback])
  return [value, setValue]
}
