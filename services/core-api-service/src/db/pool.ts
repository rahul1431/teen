import { Pool } from 'pg'

// Betting pool instance - initialized by betting plugin
// Used by lottery daily, matka, and other betting modules
let _poolInstance: Pool | null = null

export function initPool(p: Pool): void {
  _poolInstance = p
}

export function getPool(): Pool {
  if (!_poolInstance) {
    throw new Error('Pool not initialized. Call initPool() in betting plugin.')
  }
  return _poolInstance
}

// Direct export for backward compatibility with plan's code
export const pool: Pool = new Proxy({} as any, {
  get(target: any, prop: PropertyKey) {
    const p = getPool()
    return Reflect.get(p, prop)
  },
  set(target: any, prop: PropertyKey, value: any) {
    const p = getPool()
    return Reflect.set(p, prop, value)
  },
  apply(target: any, thisArg: any, args: any[]) {
    const p = getPool()
    return Reflect.apply(p as any, thisArg, args)
  },
}) as Pool
