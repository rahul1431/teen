export interface AgentNode {
  id: string
  parentAgentId: string | null
  commissionRate: number // percent, e.g. 20 means 20%
  status: 'active' | 'suspended'
}

export interface PlayerNetLoss {
  agentId: string   // the player's direct agent (users.agent_id)
  netHouseWin: number // can be negative if the player won overall that day
}

export interface AgentSettlementResult {
  agentId: string
  directCommission: number
  overrideCommission: number
  totalCommission: number
}

// Computes one day's commission for every agent with activity in their
// network. Pure function — no I/O — so the settlement job (Task 6) can be a
// thin wrapper that fetches inputs from the DB and persists this output.
//
// Model: an agent earns `rate% * max(0, sum of their direct players' net
// house win)` as direct commission. Each ancestor up the chain (max 2 hops,
// hierarchy is capped at 3 levels) earns `max(0, parentRate - childRate)% *
// max(0, pool)` as override, using the SAME pool as the original leaf — this
// is the standard "override" cascade, not a re-split of the leaf's own cut.
//
// Suspended agents earn nothing (no ledger entry at all for them), but do
// NOT block the override chain above them — an active grandparent still
// earns override on a suspended parent's downline activity, computed using
// the suspended agent's own configured rate as the reference point.
export function calculateDailySettlement(
  agents: AgentNode[],
  playerLosses: PlayerNetLoss[],
): AgentSettlementResult[] {
  const agentById = new Map(agents.map(a => [a.id, a]))

  const directPoolByAgent = new Map<string, number>()
  for (const p of playerLosses) {
    directPoolByAgent.set(p.agentId, (directPoolByAgent.get(p.agentId) || 0) + p.netHouseWin)
  }

  const results = new Map<string, AgentSettlementResult>()
  const ensure = (id: string): AgentSettlementResult => {
    let r = results.get(id)
    if (!r) {
      r = { agentId: id, directCommission: 0, overrideCommission: 0, totalCommission: 0 }
      results.set(id, r)
    }
    return r
  }

  for (const [leafId, pool] of directPoolByAgent) {
    const leaf = agentById.get(leafId)
    if (!leaf) continue // pool attributed to an unknown/deleted agent id — ignore

    if (leaf.status === 'active') {
      const direct = Math.max(0, (leaf.commissionRate / 100) * pool)
      ensure(leaf.id).directCommission += direct
    }

    // Walk up the chain applying the override. Always continue the walk even
    // through a suspended ancestor, but only credit ancestors that are active.
    // The `visited` set is defense-in-depth against a corrupted circular
    // parentAgentId chain (should be prevented at assignment time by
    // validateNewAgentParent) — break rather than loop forever.
    const visited = new Set<string>([leaf.id])
    let child = leaf
    let parent = child.parentAgentId ? agentById.get(child.parentAgentId) : undefined
    while (parent) {
      if (visited.has(parent.id)) break // cycle detected — stop walking
      visited.add(parent.id)
      const rateDiff = Math.max(0, parent.commissionRate - child.commissionRate)
      const overrideAmt = Math.max(0, (rateDiff / 100) * pool)
      if (parent.status === 'active') {
        ensure(parent.id).overrideCommission += overrideAmt
      }
      child = parent
      parent = child.parentAgentId ? agentById.get(child.parentAgentId) : undefined
    }
  }

  // Round all monetary outputs to 2 decimals (paise) before they reach the
  // NUMERIC(15,2) ledger columns and the `balance + $1` wallet accumulation,
  // which would otherwise drift on raw float sums over many settlement runs.
  // Round direct/override first, then sum the ALREADY-rounded values for total,
  // so stored total always equals stored direct + stored override.
  const round2 = (n: number) => Math.round(n * 100) / 100
  for (const r of results.values()) {
    r.directCommission = round2(r.directCommission)
    r.overrideCommission = round2(r.overrideCommission)
    r.totalCommission = r.directCommission + r.overrideCommission
  }

  return [...results.values()]
}
