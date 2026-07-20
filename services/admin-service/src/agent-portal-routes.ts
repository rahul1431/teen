import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

// Self-service routes for agents themselves (not admin staff). Agent JWTs
// carry role: 'agent', which is intentionally outside the admin ROLES
// hierarchy in index.ts. These routes use their own combined verify+role guard
// (authenticateAgent) rather than index.ts's shared `authenticate` decorator,
// because that shared decorator now REJECTS role: 'agent' tokens (so agent JWTs
// can't leak into general admin routes). req.jwtVerify() is available globally
// once @fastify/jwt is registered in index.ts, so no passed-in guard is needed.
export async function registerAgentPortalRoutes(
  app: FastifyInstance,
  db: Pool,
) {
  const authenticateAgent = async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
      if ((req.user as any)?.role !== 'agent') return reply.code(403).send({ error: 'Forbidden' })
    } catch { reply.code(401).send({ error: 'Unauthorized' }) }
  }

  // POST /api/admin/agent-portal/auth/login
  app.post('/api/admin/agent-portal/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body)
    const res = await db.query(`SELECT * FROM agents WHERE username = $1 AND status = 'active'`, [username])
    if (!res.rows.length) return reply.code(401).send({ error: 'Invalid credentials' })
    const agent = res.rows[0]
    const valid = await bcrypt.compare(password, agent.password_hash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ sub: agent.id, username: agent.username, role: 'agent' }, { expiresIn: '8h' })
    return reply.send({
      token,
      admin: { id: agent.id, username: agent.username, role: 'agent', display_name: agent.display_name },
    })
  })

  // GET /api/admin/agent-portal/me — dashboard summary
  app.get('/api/admin/agent-portal/me', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const [agentRes, walletRes, subAgentsRes] = await Promise.all([
      db.query('SELECT id, username, display_name, commission_rate, referral_code, parent_agent_id FROM agents WHERE id = $1', [agentId]),
      db.query('SELECT balance::float, locked_balance::float, total_earned::float, total_paid_out::float FROM agent_wallets WHERE agent_id = $1', [agentId]),
      db.query(`SELECT id, display_name, commission_rate FROM agents WHERE parent_agent_id = $1`, [agentId]),
    ])
    if (!agentRes.rows.length) return reply.code(404).send({ error: 'Agent not found' })
    return reply.send({
      agent: agentRes.rows[0],
      wallet: walletRes.rows[0] || { balance: 0, locked_balance: 0, total_earned: 0, total_paid_out: 0 },
      sub_agents: subAgentsRes.rows,
    })
  })

  // GET /api/admin/agent-portal/players — this agent's direct players (read-only)
  app.get('/api/admin/agent-portal/players', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT username, status, created_at,
              (SELECT MAX(created_at) FROM wallet_transactions WHERE user_id = users.id) AS last_active
       FROM users WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // GET /api/admin/agent-portal/ledger — this agent's commission history
  app.get('/api/admin/agent-portal/ledger', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const res = await db.query(
      `SELECT date, direct_commission::float, override_commission::float, total_commission::float, status
       FROM agent_commission_ledger WHERE agent_id = $1 ORDER BY date DESC LIMIT 90`,
      [agentId]
    )
    return reply.send(res.rows)
  })

  // POST /api/admin/agent-portal/payout — request a payout against the current balance
  app.post('/api/admin/agent-portal/payout', { onRequest: [authenticateAgent] }, async (req, reply) => {
    const agentId = (req.user as any).sub
    const body = z.object({
      amount: z.number().min(100),
      bank_account: z.string().optional(),
      upi_id: z.string().optional(),
    }).parse(req.body)

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const walletRes = await client.query('SELECT balance FROM agent_wallets WHERE agent_id = $1 FOR UPDATE', [agentId])
      const balance = parseFloat(walletRes.rows[0]?.balance ?? '0')
      if (balance < body.amount) {
        await client.query('ROLLBACK')
        return reply.code(400).send({ error: 'Insufficient balance' })
      }
      await client.query(
        'UPDATE agent_wallets SET balance = balance - $1, locked_balance = locked_balance + $1, updated_at = NOW() WHERE agent_id = $2',
        [body.amount, agentId]
      )
      const payoutRes = await client.query(
        `INSERT INTO agent_payouts (agent_id, amount, metadata) VALUES ($1, $2, $3) RETURNING id`,
        [agentId, body.amount, JSON.stringify({ bank_account: body.bank_account, upi_id: body.upi_id })]
      )
      await client.query('COMMIT')
      return reply.send({ success: true, payout_id: payoutRes.rows[0].id, message: 'Payout request submitted. Processed within 24 hours.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
