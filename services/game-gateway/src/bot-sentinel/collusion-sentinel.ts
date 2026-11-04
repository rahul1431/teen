import Redis from 'ioredis'
import { Pool } from 'pg'

/**
 * Multi-Agent Anti-Collusion Sentinel Swarm
 * 
 * Monitors real-time table action variance, soft-playing, and whipsawing between human players.
 * Identifies syndicates sharing cards or soft-checking against each other to exploit solo players.
 * Quarantines colluding pairs in matchmaking and activates defensive Sentinel bots.
 */

export interface CollusionInteraction {
  roomId: string;
  gameType: string;
  playerAId: string;
  playerBId: string;
  actionA: string;
  actionB: string;
  potAmount: number;
  thirdPartyInPot: boolean;
  isWhipsaw: boolean;
  isPassiveCheckdown: boolean;
}

export interface CollusionAlert {
  playerAId: string;
  playerBId: string;
  gameType: string;
  collusionScore: number;
  sharedHandsCount: number;
  passiveCheckdownRate: number;
  whipsawCount: number;
  status: 'flagged' | 'quarantined' | 'clean';
  evidence: Record<string, any>;
}

export class CollusionSentinelSwarm {
  private redis: Redis
  private db: Pool
  // Local fast lookup cache for active pairs
  private pairStats = new Map<string, {
    sharedHands: number;
    headsUpPots: number;
    passiveCheckdowns: number;
    whipsaws: number;
    raisesAgainstPartner: number;
    raisesAgainstOthers: number;
  }>()

  constructor(redis: Redis, db: Pool) {
    this.redis = redis
    this.db = db
  }

  private pairKey(id1: string, id2: string): string {
    return [id1, id2].sort().join(':')
  }

  /**
   * Analyze an interaction or completed hand between players at a table.
   */
  async recordTableInteraction(interaction: CollusionInteraction): Promise<CollusionAlert | null> {
    const { playerAId, playerBId, gameType, isWhipsaw, isPassiveCheckdown, thirdPartyInPot } = interaction
    if (!playerAId || !playerBId || playerAId === playerBId) return null

    const key = this.pairKey(playerAId, playerBId)
    const stats = this.pairStats.get(key) || {
      sharedHands: 0,
      headsUpPots: 0,
      passiveCheckdowns: 0,
      whipsaws: 0,
      raisesAgainstPartner: 0,
      raisesAgainstOthers: 0,
    }

    stats.sharedHands++
    if (!thirdPartyInPot) stats.headsUpPots++
    if (isPassiveCheckdown) stats.passiveCheckdowns++
    if (isWhipsaw) stats.whipsaws++

    this.pairStats.set(key, stats)

    // Evaluate collusion score if they have shared at least 3 hands
    if (stats.sharedHands >= 3) {
      const checkdownRate = stats.headsUpPots > 0 ? (stats.passiveCheckdowns / stats.headsUpPots) * 100 : 0
      const whipsawRate = (stats.whipsaws / stats.sharedHands)

      // Anomaly scoring formula
      let score = 0
      if (checkdownRate >= 70) score += 0.40
      if (whipsawRate >= 0.30) score += 0.45
      if (stats.whipsaws >= 2) score += 0.25

      score = Math.min(1.0, Math.round(score * 1000) / 1000)

      if (score >= 0.65) {
        const alert: CollusionAlert = {
          playerAId,
          playerBId,
          gameType,
          collusionScore: score,
          sharedHandsCount: stats.sharedHands,
          passiveCheckdownRate: Math.round(checkdownRate * 10) / 10,
          whipsawCount: stats.whipsaws,
          status: score >= 0.85 ? 'quarantined' : 'flagged',
          evidence: {
            checkdownRate,
            whipsawCount: stats.whipsaws,
            sharedHands: stats.sharedHands,
            timestamp: new Date().toISOString(),
          },
        }

        await this.persistCollusionAlert(alert)
        return alert
      }
    }

    return null
  }

  /**
   * Persist alert in PostgreSQL and mark pair in Redis for matchmaking quarantine.
   */
  private async persistCollusionAlert(alert: CollusionAlert): Promise<void> {
    const key = this.pairKey(alert.playerAId, alert.playerBId)
    
    // Set 24hr quarantine in Redis
    if (alert.status === 'quarantined') {
      await this.redis.setex(`sentinel:quarantine:${key}`, 86400, JSON.stringify(alert)).catch(() => {})
    }

    try {
      await this.db.query(
        `INSERT INTO table_collusion_alerts
           (game_type, player_a_id, player_b_id, collusion_score, shared_hands_count,
            passive_checkdown_rate, whipsaw_count, evidence, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          alert.gameType,
          alert.playerAId,
          alert.playerBId,
          alert.collusionScore,
          alert.sharedHandsCount,
          alert.passiveCheckdownRate,
          alert.whipsawCount,
          JSON.stringify(alert.evidence),
          alert.status,
        ]
      )
    } catch (dbErr) {
      // Non-fatal if DB insert fails
    }
  }

  /**
   * Matchmaking Guard: Checks if any two players in candidate room are quarantined.
   */
  async checkMatchmakingCollusion(playerIds: string[]): Promise<{ allowed: boolean; conflictingPair?: [string, string]; reason?: string }> {
    if (playerIds.length < 2) return { allowed: true }

    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const p1 = playerIds[i]
        const p2 = playerIds[j]
        const key = this.pairKey(p1, p2)

        // Check Redis quarantine
        const quarantined = await this.redis.get(`sentinel:quarantine:${key}`).catch(() => null)
        if (quarantined) {
          return {
            allowed: false,
            conflictingPair: [p1, p2],
            reason: `Suspected collusion syndicate quarantined (${p1.slice(0, 8)} & ${p2.slice(0, 8)})`,
          }
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Sentinel Bot In-Game Directive:
   * Instructs bots at the table on how to neutralize suspected whipsawing syndicates.
   */
  getBotSentinelDirective(hasSuspectedSyndicate: boolean): { aggressiveDefense: boolean; neverFoldPremium: boolean } {
    if (hasSuspectedSyndicate) {
      return {
        aggressiveDefense: true,
        neverFoldPremium: true, // Breaks bluff-squeeze by refusing to pack pure sequence/trail
      }
    }
    return {
      aggressiveDefense: false,
      neverFoldPremium: false,
    }
  }
}
