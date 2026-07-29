import { BotStats } from './botStatsLoader'

export interface BotWithStats {
  botId: string
  stats: BotStats
}

export class ElectionAlgorithm {
  private rotationState: Map<string, number> = new Map()

  electWinnerBot(bots: BotWithStats[], strategy: string, gameTypeKey?: string): string {
    if (bots.length === 0) {
      throw new Error('Cannot elect winner: no bots provided')
    }

    switch (strategy) {
      case 'lifetime_winrate':
        return this.electionByLifetimeWinRate(bots)
      case 'vs_rp_winrate':
        return this.electionByVsRpWinRate(bots)
      case 'rotation':
        return this.electionByRotation(bots, gameTypeKey || 'default')
      case 'weakest_first':
        return this.electionByWeakestFirst(bots)
      default:
        // Fall back to lifetime win rate
        return this.electionByLifetimeWinRate(bots)
    }
  }

  private electionByLifetimeWinRate(bots: BotWithStats[]): string {
    return bots.reduce((winner, bot) => {
      return bot.stats.lifetimeWinRate > winner.stats.lifetimeWinRate ? bot : winner
    }).botId
  }

  private electionByVsRpWinRate(bots: BotWithStats[]): string {
    return bots.reduce((winner, bot) => {
      return bot.stats.vsRpWinRate > winner.stats.vsRpWinRate ? bot : winner
    }).botId
  }

  private electionByRotation(bots: BotWithStats[], gameTypeKey: string): string {
    const key = `rotation:${gameTypeKey}`
    const lastWinnerIndex = this.rotationState.get(key) || 0
    const nextIndex = (lastWinnerIndex + 1) % bots.length

    this.rotationState.set(key, nextIndex)
    return bots[nextIndex].botId
  }

  private electionByWeakestFirst(bots: BotWithStats[]): string {
    return bots.reduce((weakest, bot) => {
      return bot.stats.lifetimeWinRate < weakest.stats.lifetimeWinRate ? bot : weakest
    }).botId
  }

  /**
   * Tiered Hard-Wins: the first bot among the seated bots' resolved
   * difficulties that's tagged 'hard', or null if none exists — callers
   * fall back to their own configured fallback strategy in that case.
   */
  electHardTierWinner(botDifficulties: Map<string, string>): string | null {
    for (const [botId, tier] of botDifficulties) {
      if (tier === 'hard') return botId
    }
    return null
  }

  /**
   * Determine if coordination succeeded: true iff the elected bot actually
   * won. This is a factual record, not a probabilistic estimate — it feeds
   * both the admin dashboard and computeEffectiveBoldness's adaptive-tuning
   * loop, so it must reflect what really happened or both go blind to a
   * regression in the underlying win-steering logic.
   */
  isCoordinationSuccess(actualWinnerId: string | null, electedWinnerId: string, targetWinRate: number): boolean {
    return actualWinnerId === electedWinnerId
  }
}
