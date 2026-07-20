import { describe, it, expect } from 'vitest'
import { validateNewAgentParent, validateRateAssignment } from '../src/agent-hierarchy'

describe('validateNewAgentParent', () => {
  it('allows a top-level agent (no parent)', () => {
    expect(validateNewAgentParent([], null)).toEqual({ ok: true })
  })

  it('allows a sub-agent under a top-level agent', () => {
    const agents = [{ id: 'A', parentAgentId: null }]
    expect(validateNewAgentParent(agents, 'A')).toEqual({ ok: true })
  })

  it('rejects a sub-agent under an agent that already has a parent (would be 4th level)', () => {
    const agents = [
      { id: 'A', parentAgentId: null },
      { id: 'B', parentAgentId: 'A' },
    ]
    const result = validateNewAgentParent(agents, 'B')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/3 levels/i)
  })

  it('rejects a parent id that does not exist', () => {
    const result = validateNewAgentParent([], 'nonexistent')
    expect(result.ok).toBe(false)
  })
})

describe('validateRateAssignment', () => {
  it('allows a rate with no parent', () => {
    expect(validateRateAssignment([], null, null, 20)).toEqual({ ok: true })
  })

  it('allows a sub-agent rate lower than its parent rate', () => {
    const agents = [{ id: 'A', parentAgentId: null, commissionRate: 25 }]
    expect(validateRateAssignment(agents, null, 'A', 20)).toEqual({ ok: true })
  })

  it('rejects a sub-agent rate equal to its parent rate (zero override)', () => {
    const agents = [{ id: 'A', parentAgentId: null, commissionRate: 25 }]
    const result = validateRateAssignment(agents, null, 'A', 25)
    expect(result.ok).toBe(false)
  })

  it('rejects a sub-agent rate higher than its parent rate', () => {
    const agents = [{ id: 'A', parentAgentId: null, commissionRate: 25 }]
    const result = validateRateAssignment(agents, null, 'A', 30)
    expect(result.ok).toBe(false)
  })

  it('rejects lowering an existing agent rate below one of its own sub-agents', () => {
    const agents = [
      { id: 'A', parentAgentId: null, commissionRate: 25 },
      { id: 'B', parentAgentId: 'A', commissionRate: 20 },
    ]
    // Editing A's own rate down to 18 — below B's 20 — must be rejected.
    const result = validateRateAssignment(agents, 'A', null, 18)
    expect(result.ok).toBe(false)
  })

  it('allows raising an existing agent rate above its sub-agents', () => {
    const agents = [
      { id: 'A', parentAgentId: null, commissionRate: 25 },
      { id: 'B', parentAgentId: 'A', commissionRate: 20 },
    ]
    const result = validateRateAssignment(agents, 'A', null, 30)
    expect(result.ok).toBe(true)
  })
})
