export interface ProcessStatus {
  name: string
  status: 'online' | 'stopped' | 'errored' | 'launching' | 'unknown'
  cpu: number
  memoryMb: number
  restarts: number
  uptimeSec: number
}

export interface SystemMetrics {
  totalMemMb: number
  freeMemMb: number
  memUsedPct: number
  diskFreeGb: number
  diskUsedPct: number
  dbConnected: boolean
  dbLatencyMs: number
  redisConnected: boolean
  redisLatencyMs: number
  processes: ProcessStatus[]
  erroredCount: number
}

export interface FinancialMetrics {
  period: string
  totalDeposits: number
  depositsCount: number
  totalWithdrawals: number
  withdrawalsCount: number
  netMargin: number
  activePlayersToday: number
  pendingWithdrawalsCount: number
  pendingWithdrawalsSum: number
}

export interface PendingWithdrawal {
  id: string
  userId: string
  userName?: string
  amount: number
  payoutMethod?: string
  requestedAt: Date
  riskScore: number
  riskReasons: string[]
}

export interface ChurnedVIPLead {
  userId: string
  phone?: string
  lastPlayedAt: Date
  totalLifetimeDeposits: number
  favoriteGame: string
  suggestedBonus: number
  suggestedMessage: string
}

export interface ExecutiveBriefing {
  headline: string
  financialHealth: string
  sreHealth: string
  fraudRiskNotice: string
  growthSuggestions: string[]
  recommendedActions: string[]
}
