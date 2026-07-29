import { Database } from '../db'
import { ElectionAlgorithm } from './electionAlgorithm'

export interface GameOutcome {
  gameId: string
  actualWinnerId: string | null
  botTrainingMetadata?: {
    winnerBotId: string
    strategy: string
    targetWinRate: number
    aggressiveness: number
    botIds: string[]
    rpId: string
  }
  botPerformance: Record<string, any>
  rpPerformance: any
}

export class GameRecorder {
  private electionAlgorithm = new ElectionAlgorithm()

  constructor(private db: Database) {}

  async recordCoordinatedGame(outcome: GameOutcome): Promise<void> {
    if (!outcome.botTrainingMetadata) {
      return // Not a coordinated game
    }

    const metadata = outcome.botTrainingMetadata
    const success = this.electionAlgorithm.isCoordinationSuccess(
      outcome.actualWinnerId,
      metadata.winnerBotId,
      metadata.targetWinRate
    )

    try {
      await this.db.query(
        `INSERT INTO bot_learning_sessions (
          game_id, winner_bot_id, actual_winner_id, bot_ids, rp_id,
          strategy_used, target_win_rate, bot_performance, rp_performance, coordination_success
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          outcome.gameId,
          metadata.winnerBotId,
          outcome.actualWinnerId,
          JSON.stringify(metadata.botIds),
          metadata.rpId,
          metadata.strategy,
          metadata.targetWinRate,
          JSON.stringify(outcome.botPerformance),
          JSON.stringify(outcome.rpPerformance),
          success ? true : false,
        ]
      )

      console.log(`[BotCoordination] Recorded game ${outcome.gameId}: coordination_success=${success}`)
    } catch (error) {
      console.error(`[BotCoordination] Failed to record game outcome for ${outcome.gameId}:`, error)
      // Log but don't fail the game end
    }
  }
}
