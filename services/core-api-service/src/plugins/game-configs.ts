import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

// special_rules is a flat JSON blob shared between genuinely public gameplay
// tunables (stakes, timers, bet limits) and operational secrets that some
// games stash in the same column — e.g. cricapi-client.ts reads
// special_rules.api_keys/api_key for CricAPI auth. Strip anything
// credential-shaped before this ever reaches a client.
const SECRET_KEY_PATTERN = /key|secret|token/i

function sanitizeSpecialRules(rules: unknown): Record<string, any> {
  if (!rules || typeof rules !== 'object') return {}
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(rules as Record<string, any>)) {
    if (SECRET_KEY_PATTERN.test(k)) continue
    out[k] = v
  }
  return out
}

export function gameConfigsPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    // GET /game-configs/:gameType — public read backing the mobile client's
    // config-reload feature (ConfigReloadService fetches this after a
    // config:reload socket event). See docs/Bugs/config-reload-dead-feature.md.
    app.get('/game-configs/:gameType', { onRequest: [app.authenticate] }, async (req, reply) => {
      const { gameType } = req.params as { gameType: string }
      const res = await db.query(
        `SELECT game_type, is_active, special_rules, updated_at FROM game_configs WHERE game_type = $1`,
        [gameType],
      )
      if (!res.rows.length) return reply.code(404).send({ error: 'Game config not found' })
      const row = res.rows[0]
      const specialRules = typeof row.special_rules === 'string' ? JSON.parse(row.special_rules) : row.special_rules
      return {
        game_type: row.game_type,
        is_active: row.is_active,
        updated_at: row.updated_at,
        special_rules: sanitizeSpecialRules(specialRules),
      }
    })
  }
}
