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
   * Determine if coordination succeeded based on target win rate.
   * If the chosen bot actually won, success = true.
   * Otherwise, success = rand() < targetWinRate (allows failures to count as "success" based on probability)
   */
  isCoordinationSuccess(actualWinnerId: string | null, electedWinnerId: string, targetWinRate: number): boolean {
    if (actualWinnerId === electedWinnerId) {
      return true
    }
    // Coordination failed but randomness might say it's a "success" for stats
    return Math.random() < targetWinRate
  }
}
