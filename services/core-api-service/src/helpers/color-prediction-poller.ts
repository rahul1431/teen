import { Pool } from 'pg'
import { settleColorPredictionRound } from './color-prediction'

export interface GameModeConfig {
  mode: string
  intervalSec: number
  label: string
}

export const GAME_MODES: GameModeConfig[] = [
  { mode: '30s', intervalSec: 30, label: '30s (Fast Parity)' },
  { mode: '1m', intervalSec: 60, label: '1M (Wingo 1M)' },
  { mode: '3m', intervalSec: 180, label: '3M (Wingo 3M)' },
  { mode: '5m', intervalSec: 300, label: '5M (Wingo 5M)' },
]

export class ColorPredictionPoller {
  private timer: NodeJS.Timeout | null = null
  private isProcessing = false
  public static POLL_MS = 1000 // 1-second pulse for crisp countdown transitions

  constructor(private db: Pool) {}

  start() {
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error('[ColorPredictionPoller] tick error:', err?.message || err))
    }, ColorPredictionPoller.POLL_MS)
    console.log('[ColorPredictionPoller] Continuous game loop started for all 4 game modes (30s, 1m, 3m, 5m)')
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private generatePeriodId(mode: string): string {
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const hh = String(now.getHours()).padStart(2, '0')
    const min = String(now.getMinutes()).padStart(2, '0')
    const sec = String(now.getSeconds()).padStart(2, '0')
    const tag = mode.toUpperCase()
    return `${yyyy}${mm}${dd}${hh}${min}${sec}_${tag}`
  }

  async tick() {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      // 1. Check for expired open/locked rounds across ALL modes that need settlement
      const expiredRounds = await this.db.query(
        `SELECT * FROM color_prediction_rounds
         WHERE status IN ('open', 'locked') AND end_time <= NOW()
         ORDER BY end_time ASC`
      )

      for (const round of expiredRounds.rows) {
        console.log(`[ColorPredictionPoller] Settling expired round ${round.period_id} (${round.game_mode || '30s'})...`)
        await settleColorPredictionRound(this.db, round.id)
      }

      // 2. Lock rounds that are within 5 seconds of expiry
      await this.db.query(
        `UPDATE color_prediction_rounds
         SET status = 'locked'
         WHERE status = 'open' AND end_time <= NOW() + INTERVAL '5 seconds'`
      )

      // 3. Ensure an active open round exists for EACH of the 4 game modes
      for (const cfg of GAME_MODES) {
        const activeRes = await this.db.query(
          `SELECT id FROM color_prediction_rounds
           WHERE game_mode = $1 AND status IN ('open', 'locked') AND end_time > NOW()
           LIMIT 1`,
          [cfg.mode]
        )

        if (activeRes.rows.length === 0) {
          const periodId = this.generatePeriodId(cfg.mode)

          await this.db.query(
            `INSERT INTO color_prediction_rounds (period_id, game_mode, start_time, end_time, status)
             VALUES ($1, $2, NOW(), NOW() + ($3 || ' seconds')::INTERVAL, 'open')
             ON CONFLICT (period_id) DO NOTHING`,
            [periodId, cfg.mode, cfg.intervalSec]
          )
          console.log(`[ColorPredictionPoller] Initialized new ${cfg.mode} round ${periodId} (ends in ${cfg.intervalSec}s)`)
        }
      }
    } catch (err: any) {
      console.error('[ColorPredictionPoller] Execution error:', err?.message || err)
    } finally {
      this.isProcessing = false
    }
  }
}
