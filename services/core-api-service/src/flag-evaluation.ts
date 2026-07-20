import { createHash } from 'crypto'

export interface FeatureFlagVariant {
  key: string
  weight: number
}

export interface FeatureFlag {
  key: string
  enabled: boolean
  rolloutPercent: number
  enabledUserIds: string[]
  variants: FeatureFlagVariant[] | null
}

export interface FlagResult {
  enabled: boolean
  variant?: string
}

// Deterministic 0-99 bucket for a (userId, salt) pair — the same inputs
// always produce the same bucket, so a user's on/off/variant state never
// flip-flops between requests. sha256 avoids the poor distribution of
// simple string-sum hashes.
function bucket(userId: string, salt: string): number {
  const hash = createHash('sha256').update(`${userId}:${salt}`).digest()
  // First 4 bytes as an unsigned 32-bit int, mod 100.
  return hash.readUInt32BE(0) % 100
}

function assignVariant(flag: FeatureFlag, userId: string): string | undefined {
  if (!flag.variants || flag.variants.length === 0) return undefined
  const totalWeight = flag.variants.reduce((sum, v) => sum + v.weight, 0)
  const roll = bucket(userId, `${flag.key}:variant`) % totalWeight
  let cumulative = 0
  for (const v of flag.variants) {
    cumulative += v.weight
    if (roll < cumulative) return v.key
  }
  return flag.variants[flag.variants.length - 1].key // fallback for rounding edge cases
}

export function evaluateFlag(flag: FeatureFlag, userId: string): FlagResult {
  if (!flag.enabled) return { enabled: false }

  const allowlisted = flag.enabledUserIds.includes(userId)
  const inRollout = bucket(userId, flag.key) < flag.rolloutPercent
  const on = allowlisted || inRollout

  if (!on) return { enabled: false }
  const variant = assignVariant(flag, userId)
  return variant !== undefined ? { enabled: true, variant } : { enabled: true }
}
