
export interface AgentParentRef {
  id: string
  parentAgentId: string | null
}

export interface AgentRateRef {
  id: string
  parentAgentId: string | null
  commissionRate: number
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

// Max hierarchy depth is 3: a top-level agent (parentAgentId=null), its
// sub-agents, and no deeper. So a new agent may only be parented under an
// agent that is itself top-level.
export function validateNewAgentParent(
  agents: AgentParentRef[],
  parentAgentId: string | null,
): ValidationResult {
  if (parentAgentId === null) return { ok: true }
  const parent = agents.find(a => a.id === parentAgentId)
  if (!parent) return { ok: false, error: 'Parent agent not found' }
  if (parent.parentAgentId !== null) {
    return { ok: false, error: 'Cannot create a sub-agent under a sub-agent — hierarchy is capped at 3 levels' }
  }
  return { ok: true }
}

// An upline's rate must always be strictly greater than every one of its
// direct sub-agents' rates (the override model requires a positive
// rate difference — see docs/superpowers/specs/2026-07-20-agent-commission-system-design.md).
// Call with agentId=null when creating a new agent (nothing to check below it yet).
export function validateRateAssignment(
  agents: AgentRateRef[],
  agentId: string | null,
  parentAgentId: string | null,
  newRate: number,
): ValidationResult {
  if (parentAgentId !== null) {
    const parent = agents.find(a => a.id === parentAgentId)
    if (parent && newRate >= parent.commissionRate) {
      return { ok: false, error: `Rate must be lower than parent agent's rate (${parent.commissionRate}%)` }
    }
  }
  if (agentId !== null) {
    const subAgents = agents.filter(a => a.parentAgentId === agentId)
    const tooHigh = subAgents.find(sub => newRate <= sub.commissionRate)
    if (tooHigh) {
      return { ok: false, error: `Rate must be higher than sub-agent ${tooHigh.id}'s rate (${tooHigh.commissionRate}%)` }
    }
  }
  return { ok: true }
}
