import Redis from 'ioredis';
import { Pool } from 'pg';
import { Logger } from 'pino';

export interface NormalizedEvent {
  event_type: string;
  game_type?: string;
  room_id?: string;
  user_id?: string;
  player_count?: number;
  amount?: number;
  action?: string;
  timestamp: string;
  raw_data?: any;
}

const BATCH_SIZE = 100
const FLUSH_INTERVAL_MS = 1000

// README documents a 30-day retention policy for game_events, but nothing
// ever deleted from it — every event since deploy stayed forever (see
// docs/Bugs/game-events-table-has-no-retention-cleanup.md). Sweep daily,
// deleting in small batches so a table with millions of rows doesn't hold
// a long lock / generate a huge WAL spike in one shot.
const RETENTION_DAYS = Number(process.env.GAME_EVENTS_RETENTION_DAYS) || 30
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
const RETENTION_FIRST_SWEEP_DELAY_MS = 60 * 1000
const RETENTION_BATCH_SIZE = 5000
const RETENTION_BATCH_PAUSE_MS = 100

export class EventProcessor {
  private eventBuffer: NormalizedEvent[] = []
  private flushTimer: ReturnType<typeof setInterval>
  private retentionTimer: ReturnType<typeof setInterval>
  private retentionStartTimer: ReturnType<typeof setTimeout>

  constructor(
    private redis: Redis,
    private pool: Pool,
    private logger: Logger
  ) {
    this.flushTimer = setInterval(() => {
      this.flushEvents().catch(err => this.logger.error({ err }, 'Batch flush failed'))
    }, FLUSH_INTERVAL_MS)

    const runSweep = () => this.runRetentionSweep().catch(err => this.logger.error({ err }, 'game_events retention sweep failed'))
    this.retentionStartTimer = setTimeout(runSweep, RETENTION_FIRST_SWEEP_DELAY_MS)
    this.retentionTimer = setInterval(runSweep, RETENTION_SWEEP_INTERVAL_MS)
  }

  destroy() {
    clearInterval(this.flushTimer)
    clearInterval(this.retentionTimer)
    clearTimeout(this.retentionStartTimer)
  }

  /**
   * Delete game_events rows older than the retention window, in bounded
   * batches, until none remain.
   */
  private async runRetentionSweep(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    let totalDeleted = 0
    for (;;) {
      const result = await this.pool.query(
        `DELETE FROM game_events WHERE id IN (
           SELECT id FROM game_events WHERE created_at < $1 LIMIT $2
         )`,
        [cutoff, RETENTION_BATCH_SIZE],
      )
      totalDeleted += result.rowCount ?? 0
      if (!result.rowCount || result.rowCount < RETENTION_BATCH_SIZE) break
      await new Promise(r => setTimeout(r, RETENTION_BATCH_PAUSE_MS))
    }
    if (totalDeleted > 0) {
      this.logger.info({ totalDeleted, retentionDays: RETENTION_DAYS }, 'game_events retention sweep completed')
    }
  }

  private async flushEvents(): Promise<void> {
    if (!this.eventBuffer.length) return
    const batch = this.eventBuffer.splice(0, this.eventBuffer.length)
    const cols = 9
    const values = batch.map((_, i) => {
      const base = i * cols
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
    }).join(', ')
    const params = batch.flatMap(e => [
      e.event_type,
      e.game_type ?? null,
      e.room_id ?? null,
      e.user_id ?? null,
      e.action ?? null,
      e.amount ?? null,
      e.player_count ?? null,
      e.raw_data ? JSON.stringify(e.raw_data) : null,
      e.timestamp,
    ])
    try {
      await this.pool.query(
        `INSERT INTO game_events (event_type, game_type, room_id, user_id, action, amount, player_count, raw_data, created_at)
         VALUES ${values} ON CONFLICT DO NOTHING`,
        params,
      )
    } catch (err) {
      this.logger.error({ err, count: batch.length }, 'Batch insert failed')
    }
  }

  /**
   * Normalize event from WebSocket into standard format
   */
  normalizeEvent(event: any): NormalizedEvent {
    const timestamp = new Date().toISOString();

    // Map WebSocket event to normalized format
    switch (event.type) {
      case 'join_matchmaking':
        return {
          event_type: 'joinMatchmaking',
          game_type: event.data?.game_type,
          user_id: event.data?.user_id,
          amount: event.data?.stake,
          timestamp,
          raw_data: event.data,
        };

      case 'leave_matchmaking':
        return {
          event_type: 'leaveMatchmaking',
          game_type: event.data?.game_type,
          user_id: event.data?.user_id,
          timestamp,
          raw_data: event.data,
        };

      case 'room_joined':
        return {
          event_type: 'roomJoined',
          game_type: event.data?.game_type,
          room_id: event.data?.room_id,
          user_id: event.data?.user_id,
          player_count: event.data?.players?.length || 0,
          amount: event.data?.stake,
          timestamp,
          raw_data: event.data,
        };

      case 'game_action':
        return {
          event_type: 'gameAction',
          game_type: event.data?.game_type,
          room_id: event.data?.room_id,
          user_id: event.data?.user_id,
          action: event.data?.action,
          amount: event.data?.amount,
          timestamp,
          raw_data: event.data,
        };

      case 'game_result':
        return {
          event_type: 'gameResult',
          game_type: event.data?.game_type,
          room_id: event.data?.room_id,
          user_id: event.data?.winner_id,
          amount: event.data?.prize_amount,
          timestamp,
          raw_data: event.data,
        };

      case 'room_chat':
        return {
          event_type: 'roomChat',
          game_type: event.data?.game_type,
          room_id: event.data?.room_id,
          user_id: event.data?.user_id,
          timestamp,
          raw_data: event.data,
        };

      default:
        return {
          event_type: event.type || 'unknown',
          timestamp,
          raw_data: event,
        };
    }
  }

  async persistEvent(event: NormalizedEvent): Promise<void> {
    this.eventBuffer.push(event)
    if (this.eventBuffer.length >= BATCH_SIZE) {
      await this.flushEvents()
    }
  }

  /**
   * Get aggregated metrics for dashboard
   */
  async getAggregatedMetrics(
    gameType: string = 'all',
    interval: 'minute' | 'hour' | 'day' = 'hour'
  ): Promise<any> {
    try {
      const key = `metrics:${gameType}:${interval}`;

      // Check cache first
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }

      // Calculate from PostgreSQL
      const intervalLiteral =
        interval === 'minute' ? '1 minute' :
        interval === 'hour'   ? '1 hour'   : '1 day';

      const params: unknown[] = [];
      let gameTypeFilter = '';
      if (gameType !== 'all') {
        params.push(gameType);
        gameTypeFilter = `AND game_type = $${params.length}`;
      }

      const query = `
        SELECT
          game_type,
          event_type,
          COUNT(*) as count,
          AVG(CAST(amount AS DECIMAL)) as avg_amount,
          MAX(CAST(amount AS DECIMAL)) as max_amount,
          COUNT(DISTINCT user_id) as unique_players,
          COUNT(DISTINCT room_id) as active_rooms
        FROM game_events
        WHERE created_at > NOW() - INTERVAL '${intervalLiteral}'
          ${gameTypeFilter}
        GROUP BY game_type, event_type
        ORDER BY count DESC;
      `;

      const result = await this.pool.query(query, params);

      const metrics = {
        interval,
        gameType,
        timestamp: new Date().toISOString(),
        events: result.rows,
        summary: {
          totalEvents: result.rows.reduce((sum: number, row: any) => sum + parseInt(row.count || '0'), 0),
          totalPlayers: result.rows[0]?.unique_players || 0,
          activeRooms: result.rows[0]?.active_rooms || 0,
          averageStake: result.rows[0]?.avg_amount || 0,
        },
      };

      // Cache for 1 minute
      await this.redis.setex(key, 60, JSON.stringify(metrics));

      return metrics;
    } catch (err) {
      this.logger.error({ err }, 'Failed to get aggregated metrics');
      throw err;
    }
  }

  /**
   * Check for anomalies (for fraud detection)
   */
  async detectAnomalies(gameType: string): Promise<any[]> {
    try {
      // Find players with unusual activity in last hour
      const query = `
        SELECT
          user_id,
          COUNT(*) as action_count,
          AVG(CAST(amount AS DECIMAL)) as avg_bet,
          MAX(CAST(amount AS DECIMAL)) as max_bet,
          COUNT(DISTINCT room_id) as room_count
        FROM game_events
        WHERE game_type = $1
          AND event_type = 'gameAction'
          AND created_at > NOW() - INTERVAL '1 hour'
        GROUP BY user_id
        HAVING COUNT(*) > 50  -- More than 50 actions in 1 hour (suspicious bot activity)
           OR MAX(CAST(amount AS DECIMAL)) > 5000  -- Bet > 5000 (unusual)
        ORDER BY action_count DESC;
      `;

      const result = await this.pool.query(query, [gameType]);
      return result.rows;
    } catch (err) {
      this.logger.error({ err }, 'Failed to detect anomalies');
      throw err;
    }
  }
}
