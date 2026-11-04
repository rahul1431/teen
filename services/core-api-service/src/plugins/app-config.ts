import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

export function appConfigPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    app.get('/api/app-config', async (_req, reply) => {
      try {
        const [settingsRes, gamesRes] = await Promise.all([
          db.query(
            `SELECT key, value FROM system_settings WHERE key IN ('wallet_deposit_enabled', 'wallet_withdrawal_enabled')`
          ),
          db.query(`SELECT game_type, is_active FROM game_configs`),
        ])

        const wallet = { deposit_enabled: false, withdrawal_enabled: false }
        for (const r of settingsRes.rows) {
          if (r.key === 'wallet_deposit_enabled') wallet.deposit_enabled = r.value !== 'false'
          if (r.key === 'wallet_withdrawal_enabled') wallet.withdrawal_enabled = r.value !== 'false'
        }

        const games: Record<string, boolean> = {}
        for (const r of gamesRes.rows) {
          games[r.game_type] = r.is_active === true
        }

        return reply.send({ success: true, wallet, games })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    })
  }
}
