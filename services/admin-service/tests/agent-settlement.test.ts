import { describe, it, expect } from 'vitest'
import { calculateDailySettlement, AgentNode, PlayerNetLoss } from '../src/agent-settlement'

describe('calculateDailySettlement', () => {
  it('single agent, single player who lost money: rate% of the loss', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    const losses: PlayerNetLoss[] = [{ agentId: 'A', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    expect(result).toEqual([{ agentId: 'A', directCommission: 200, overrideCommission: 0, totalCommission: 200 }])
  })

  it('floors at zero when the agent\'s players collectively won money that day', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    const losses: PlayerNetLoss[] = [{ agentId: 'A', netHouseWin: -500 }]
    const result = calculateDailySettlement(agents, losses)
    expect(result).toEqual([{ agentId: 'A', directCommission: 0, overrideCommission: 0, totalCommission: 0 }])
  })

  it('nets multiple players under the same agent before flooring', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    // Player 1 lost 1000, player 2 won 300 -> net pool 700 -> commission 140
    const losses: PlayerNetLoss[] = [
      { agentId: 'A', netHouseWin: 1000 },
      { agentId: 'A', netHouseWin: -300 },
    ]
    const result = calculateDailySettlement(agents, losses)
    expect(result[0].totalCommission).toBe(140)
  })

  it('two-level override: upline earns the rate difference on the sub-agent\'s pool', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 25, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 20, status: 'active' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'SUB', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    const sub = result.find(r => r.agentId === 'SUB')!
    const master = result.find(r => r.agentId === 'MASTER')!
    expect(sub).toEqual({ agentId: 'SUB', directCommission: 200, overrideCommission: 0, totalCommission: 200 })
    // (25% - 20%) * 1000 = 50
    expect(master).toEqual({ agentId: 'MASTER', directCommission: 0, overrideCommission: 50, totalCommission: 50 })
  })

  it('three-level override cascade: each level earns the difference down to the player pool', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 30, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 25, status: 'active' },
      { id: 'PLAYERAGENT', parentAgentId: 'SUB', commissionRate: 20, status: 'active' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'PLAYERAGENT', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    expect(result.find(r => r.agentId === 'PLAYERAGENT')!.totalCommission).toBe(200) // 20%
    expect(result.find(r => r.agentId === 'SUB')!.totalCommission).toBe(50)          // (25-20)%
    expect(result.find(r => r.agentId === 'MASTER')!.totalCommission).toBe(50)       // (30-25)%
  })

  it('does not credit a suspended agent their own direct or override commission', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 25, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 20, status: 'suspended' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'SUB', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    const sub = result.find(r => r.agentId === 'SUB')
    expect(sub).toBeUndefined()
  })

  it('a suspended intermediate agent does not block their upline from earning override on the downline below them', () => {
    const agents: AgentNode[] = [
      { id: 'MASTER', parentAgentId: null, commissionRate: 30, status: 'active' },
      { id: 'SUB', parentAgentId: 'MASTER', commissionRate: 25, status: 'suspended' },
      { id: 'PLAYERAGENT', parentAgentId: 'SUB', commissionRate: 20, status: 'active' },
    ]
    const losses: PlayerNetLoss[] = [{ agentId: 'PLAYERAGENT', netHouseWin: 1000 }]
    const result = calculateDailySettlement(agents, losses)
    // PLAYERAGENT still earns their own 20%.
    expect(result.find(r => r.agentId === 'PLAYERAGENT')!.totalCommission).toBe(200)
    // SUB is suspended — earns nothing, no ledger entry for them at all.
    expect(result.find(r => r.agentId === 'SUB')).toBeUndefined()
    // MASTER still earns (30-25)% = 50 on PLAYERAGENT's pool, computed against SUB's
    // configured rate as the reference point even though SUB itself isn't paid.
    expect(result.find(r => r.agentId === 'MASTER')!.totalCommission).toBe(50)
  })

  it('returns an empty array for no agents and no losses', () => {
    expect(calculateDailySettlement([], [])).toEqual([])
  })

  it('an agent with no player activity that day gets no ledger entry', () => {
    const agents: AgentNode[] = [{ id: 'A', parentAgentId: null, commissionRate: 20, status: 'active' }]
    const result = calculateDailySettlement(agents, [])
    expect(result).toEqual([])
  })
})
