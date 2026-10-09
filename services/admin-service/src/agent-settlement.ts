export interface AgentNode {
  id: string
  parentAgentId: string | null
  commissionRate: number // default fallback percent, e.g. 20 means 20%
  gameCommissions?: Record<string, number> // per-game custom rates, e.g. { teen_patti: 5.0, rummy: 6.0, ... }
  status: 'active' | 'suspended'
}

export interface PlayerNetLoss {
  agentId: string   // the player's direct agent (users.agent_id)
  gameType?: string  // 'teen_patti', 'rummy', 'ludo', 'aviator', 'matka', 'lottery', 'cricket', or 'general'
  netHouseWin: number // can be negative if the player won overall that day
}

export interface GameCommissionBreakdown {
  pool: number
  direct: number
  override: number
  total: number
}

export interface AgentSettlementResult {
  agentId: string
  directCommission: number
  overrideCommission: number
  totalCommission: number
  gameBreakdown: Record<string, GameCommissionBreakdown>
}

function getAgentGameRate(agent: AgentNode, gameType: string): number {
  if (agent.gameCommissions && agent.gameCommissions[gameType] !== undefined && agent.gameCommissions[gameType] !== null) {
    return Number(agent.gameCommissions[gameType])
  }
  return agent.commissionRate
}

// Computes daily commission for every agent with activity in their
// network, broken down per game with support for individual game commission rates.
export function calculateDailySettlement(
  agents: AgentNode[],
  playerLosses: PlayerNetLoss[],
): AgentSettlementResult[] {
  const agentById = new Map(agents.map(a => [a.id, a]))

  // Map of (agentId -> Map of (gameType -> pool))
  const poolByAgentAndGame = new Map<string, Map<string, number>>()
  for (const p of playerLosses) {
    const game = p.gameType || 'general'
    let gameMap = poolByAgentAndGame.get(p.agentId)
    if (!gameMap) {
      gameMap = new Map<string, number>()
      poolByAgentAndGame.set(p.agentId, gameMap)
    }
    gameMap.set(game, (gameMap.get(game) || 0) + p.netHouseWin)
  }

  const results = new Map<string, AgentSettlementResult>()
  const ensure = (id: string): AgentSettlementResult => {
    let r = results.get(id)
    if (!r) {
      r = { agentId: id, directCommission: 0, overrideCommission: 0, totalCommission: 0, gameBreakdown: {} }
      results.set(id, r)
    }
    return r
  }

  for (const [leafId, gameMap] of poolByAgentAndGame) {
    const leaf = agentById.get(leafId)
    if (!leaf) continue

    for (const [gameType, pool] of gameMap) {
      const leafRate = getAgentGameRate(leaf, gameType)

      if (leaf.status === 'active') {
        const direct = Math.max(0, (leafRate / 100) * pool)
        const res = ensure(leaf.id)
        res.directCommission += direct
        if (!res.gameBreakdown[gameType]) {
          res.gameBreakdown[gameType] = { pool: 0, direct: 0, override: 0, total: 0 }
        }
        res.gameBreakdown[gameType].pool += pool
        res.gameBreakdown[gameType].direct += direct
      }

      // Walk up the ancestor hierarchy for overrides
      const visited = new Set<string>([leaf.id])
      let child = leaf
      let parent = child.parentAgentId ? agentById.get(child.parentAgentId) : undefined
      while (parent) {
        if (visited.has(parent.id)) break
        visited.add(parent.id)

        const parentRate = getAgentGameRate(parent, gameType)
        const childRate = getAgentGameRate(child, gameType)
        const rateDiff = Math.max(0, parentRate - childRate)
        const overrideAmt = Math.max(0, (rateDiff / 100) * pool)

        if (parent.status === 'active') {
          const parentRes = ensure(parent.id)
          parentRes.overrideCommission += overrideAmt
          if (!parentRes.gameBreakdown[gameType]) {
            parentRes.gameBreakdown[gameType] = { pool: 0, direct: 0, override: 0, total: 0 }
          }
          parentRes.gameBreakdown[gameType].pool += pool
          parentRes.gameBreakdown[gameType].override += overrideAmt
        }

        child = parent
        parent = child.parentAgentId ? agentById.get(child.parentAgentId) : undefined
      }
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  for (const r of results.values()) {
    r.directCommission = round2(r.directCommission)
    r.overrideCommission = round2(r.overrideCommission)
    r.totalCommission = r.directCommission + r.overrideCommission

    for (const g of Object.keys(r.gameBreakdown)) {
      const gb = r.gameBreakdown[g]
      gb.direct = round2(gb.direct)
      gb.override = round2(gb.override)
      gb.total = gb.direct + gb.override
      gb.pool = round2(gb.pool)
    }
  }

  return [...results.values()]
}
