import { Redis } from 'ioredis'
import { Pool } from 'pg'

export interface BotTrainingConfig {
  enabled: boolean
  strategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first'
  targetWinRate: number // 0.85 - 1.0
  aggressiveness: number // 0.0 - 1.0
}

const CONFIG_REDIS_KEY = 'ludo:bot-training:config'
const CONFIG_DB_KEY = 'ludo_bot_training_config'

export class BotTrainingConfigRepository {
  constructor(
    private redis: Redis,
    private db: Pool,
  ) {}

  async getConfig(): Promise<BotTrainingConfig> {
    // Try Redis first
    const cached = await this.redis.get(CONFIG_REDIS_KEY)
    if (cached) {
      return JSON.parse(cached)
    }

    // Fall back to database
    const res = await this.db.query(
      `SELECT value FROM config WHERE key = $1`,
      [CONFIG_DB_KEY]
    )

    const defaultConfig: BotTrainingConfig = {
      enabled: false,
      strategy: 'lifetime_winrate',
      targetWinRate: 0.95,
      aggressiveness: 0.4,
    }

    if (!res.rows || !res.rows[0]) {
      return defaultConfig
    }

    const config = JSON.parse(res.rows[0].value)
    // Cache it
    await this.redis.setex(CONFIG_REDIS_KEY, 3600, JSON.stringify(config))
    return config
  }

  async updateConfig(config: BotTrainingConfig): Promise<void> {
    // Validate ranges
    if (config.targetWinRate < 0.85 || config.targetWinRate > 1.0) {
      throw new Error('targetWinRate must be between 0.85 and 1.0')
    }
    if (config.aggressiveness < 0 || config.aggressiveness > 1.0) {
      throw new Error('aggressiveness must be between 0 and 1.0')
    }

    const configJson = JSON.stringify(config)

    // Update database
    await this.db.query(
      `INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CONFIG_DB_KEY, configJson]
    )

    // Update Redis cache
    await this.redis.setex(CONFIG_REDIS_KEY, 3600, configJson)
  }

  async invalidateCache(): Promise<void> {
    await this.redis.del(CONFIG_REDIS_KEY)
  }
}
