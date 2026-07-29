import { Redis } from 'ioredis'
import { Pool } from 'pg'

export interface BotTrainingConfig {
  enabled: boolean
  strategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first' | 'tiered_hard_wins'
  fallbackStrategy: 'lifetime_winrate' | 'vs_rp_winrate' | 'rotation' | 'weakest_first' // used only when strategy is 'tiered_hard_wins' and no hard-tagged bot is among the seated bots
  targetWinRate: number // 0.5 - 1.0
  aggressiveness: number // 0.0 - 1.0
  winnerBotSkill: 'casual' | 'skilled' | 'expert'
  winnerBotBoldness: number // 0.0 - 1.0
  adaptiveBoldness: boolean // auto-tune winnerBotBoldness from recent coordination success rate
  winnerBotDiceBias: number // 0.0 - 1.0; skews the winner bot's OWN dice rolls toward high faces (0 = fair). Simulation showed this plateaus around 0.3-0.5 (~60% win rate) -- the three-consecutive-sixes forfeit rule caps further gains from higher bias.
}

const CONFIG_REDIS_KEY = 'ludo:bot-training:config'
const CONFIG_DB_KEY = 'ludo_bot_training_config'

const DEFAULT_CONFIG: BotTrainingConfig = {
  enabled: false,
  strategy: 'lifetime_winrate',
  fallbackStrategy: 'lifetime_winrate',
  targetWinRate: 0.95,
  aggressiveness: 0.4,
  winnerBotSkill: 'casual',
  winnerBotBoldness: 0.5,
  adaptiveBoldness: false,
  winnerBotDiceBias: 0,
}

export class BotTrainingConfigRepository {
  constructor(
    private redis: Redis,
    private db: Pool,
  ) {}

  async getConfig(): Promise<BotTrainingConfig> {
    // Try Redis first
    const cached = await this.redis.get(CONFIG_REDIS_KEY)
    if (cached) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(cached) }
    }

    // Fall back to database
    const res = await this.db.query(
      `SELECT value FROM admin_config WHERE key = $1`,
      [CONFIG_DB_KEY]
    )

    if (!res.rows || !res.rows[0]) {
      return DEFAULT_CONFIG
    }

    const config = { ...DEFAULT_CONFIG, ...(res.rows[0].value as Partial<BotTrainingConfig>) }
    // Cache it
    await this.redis.setex(CONFIG_REDIS_KEY, 3600, JSON.stringify(config))
    return config
  }

  async updateConfig(config: BotTrainingConfig): Promise<void> {
    // Validate ranges
    if (config.targetWinRate < 0.5 || config.targetWinRate > 1.0) {
      throw new Error('targetWinRate must be between 0.5 and 1.0')
    }
    if (config.aggressiveness < 0 || config.aggressiveness > 1.0) {
      throw new Error('aggressiveness must be between 0 and 1.0')
    }
    if (config.winnerBotBoldness < 0 || config.winnerBotBoldness > 1.0) {
      throw new Error('winnerBotBoldness must be between 0 and 1.0')
    }
    if (config.winnerBotDiceBias < 0 || config.winnerBotDiceBias > 1.0) {
      throw new Error('winnerBotDiceBias must be between 0 and 1.0')
    }
    if (!['casual', 'skilled', 'expert'].includes(config.winnerBotSkill)) {
      throw new Error('winnerBotSkill must be one of casual, skilled, expert')
    }
    if (!['lifetime_winrate', 'vs_rp_winrate', 'rotation', 'weakest_first', 'tiered_hard_wins'].includes(config.strategy)) {
      throw new Error('strategy must be one of lifetime_winrate, vs_rp_winrate, rotation, weakest_first, tiered_hard_wins')
    }
    if (!['lifetime_winrate', 'vs_rp_winrate', 'rotation', 'weakest_first'].includes(config.fallbackStrategy)) {
      throw new Error('fallbackStrategy must be one of lifetime_winrate, vs_rp_winrate, rotation, weakest_first')
    }

    // Update database
    await this.db.query(
      `INSERT INTO admin_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [CONFIG_DB_KEY, config]
    )

    // Update Redis cache
    await this.redis.setex(CONFIG_REDIS_KEY, 3600, JSON.stringify(config))
  }

  async invalidateCache(): Promise<void> {
    await this.redis.del(CONFIG_REDIS_KEY)
  }
}
