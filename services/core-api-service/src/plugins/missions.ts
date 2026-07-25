// services/core-api-service/src/plugins/missions.ts
import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import crypto from 'crypto'
import { getCurrentPeriod, computeCompletionsAvailable } from '../helpers/missions'
import { getDepositSum, getReferralCount, getGamePlayedCount } from '../helpers/mission-metrics'

const PROOF_UPLOAD_DIR = process.env.MISSION_PROOF_UPLOAD_DIR || '/opt/teen/uploads/mission-proofs'
const APP_URL = process.env.APP_URL || 'https://game.myonlinejoker.com'
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL || 'http://127.0.0.1:3003'
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || ''

interface Mission {
  id: string
  title: string
  description: string | null
  emoji: string
  category: 'weekly' | 'monthly' | 'one_time'
  metric_type: 'deposit_amount' | 'referral_count' | 'game_played' | 'telegram_join' | 'manual_proof'
  game_type: string | null
  min_stake: string | null
  target_value: string
  reward_amount: string
  reward_wallet_type: 'real' | 'bonus'
  max_completions_per_period: number | null
  verification_type: 'auto' | 'telegram_bot' | 'manual_review'
}

async function creditWallet(userId: string, mission: Mission, idempotencyKey: string) {
  const type = mission.reward_wallet_type === 'bonus' ? 'bonus' : 'manual_credit'
  await fetch(`${WALLET_SERVICE_URL}/internal/wallet/credit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_SERVICE_KEY },
    body: JSON.stringify({
      user_id: userId,
      amount: parseFloat(mission.reward_amount),
      type,
      idempotency_key: idempotencyKey,
      description: `Mission reward: ${mission.title}`,
    }),
  }).catch(err => console.error('[missions] wallet credit failed:', err))
}

async function getMetricValue(db: Pool, userId: string, mission: Mission, start: Date, end: Date): Promise<number> {
  switch (mission.metric_type) {
    case 'deposit_amount':
      return getDepositSum(userId, start, end)
    case 'referral_count':
      return getReferralCount(userId, start, end)
    case 'game_played':
      return getGamePlayedCount(userId, mission.game_type!, mission.min_stake ? parseFloat(mission.min_stake) : null, start, end)
    case 'telegram_join': {
      const res = await db.query(`SELECT 1 FROM user_telegram_links WHERE user_id = $1`, [userId])
      return res.rows.length ? 1 : 0
    }
    default:
      return 0
  }
}

async function getAlreadyClaimed(db: Pool, userId: string, missionId: string, periodKey: string): Promise<number> {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count FROM user_mission_completions
     WHERE user_id = $1 AND mission_id = $2 AND period_key = $3 AND status != 'rejected'`,
    [userId, missionId, periodKey],
  )
  return res.rows[0].count
}

async function getNextCompletionNumber(db: Pool, userId: string, missionId: string, periodKey: string): Promise<number> {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count FROM user_mission_completions WHERE user_id = $1 AND mission_id = $2 AND period_key = $3`,
    [userId, missionId, periodKey],
  )
  return res.rows[0].count + 1
}

export function missionsPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    fs.mkdirSync(PROOF_UPLOAD_DIR, { recursive: true })

    app.get('/users/missions', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const missionsRes = await db.query<Mission>(`SELECT * FROM player_missions WHERE is_active = true ORDER BY category, sort_order`)
      const now = new Date()

      const views = await Promise.all(missionsRes.rows.map(async (mission) => {
        const period = getCurrentPeriod(mission.category, now)
        const alreadyClaimed = await getAlreadyClaimed(db, user.sub, mission.id, period.key)
        const target = parseFloat(mission.target_value)
        const reward = parseFloat(mission.reward_amount)

        if (mission.metric_type === 'manual_proof') {
          const latest = await db.query(
            `SELECT status FROM user_mission_completions WHERE user_id = $1 AND mission_id = $2 AND period_key = $3
             ORDER BY completion_number DESC LIMIT 1`,
            [user.sub, mission.id, period.key],
          )
          const latestStatus = latest.rows[0]?.status
          const state = alreadyClaimed >= (mission.max_completions_per_period ?? 1)
            ? 'completed_period'
            : latestStatus === 'pending_review' ? 'pending_review' : 'submit_proof'
          return {
            id: mission.id, title: mission.title, description: mission.description, emoji: mission.emoji,
            category: mission.category, metric_type: mission.metric_type,
            target_value: target, reward_amount: reward, reward_wallet_type: mission.reward_wallet_type,
            progress_current: alreadyClaimed, progress_target: mission.max_completions_per_period ?? 1,
            completions_available: 0, state,
          }
        }

        const metricValue = await getMetricValue(db, user.sub, mission, period.start, period.end)
        const completionsAvailable = computeCompletionsAvailable(metricValue, target, mission.max_completions_per_period, alreadyClaimed)

        let state: string
        if (mission.metric_type === 'telegram_join' && metricValue === 0) {
          state = 'connect_telegram'
        } else if (completionsAvailable > 0) {
          state = 'claim'
        } else if (metricValue < target) {
          state = 'in_progress'
        } else {
          state = 'completed_period'
        }

        return {
          id: mission.id, title: mission.title, description: mission.description, emoji: mission.emoji,
          category: mission.category, metric_type: mission.metric_type,
          target_value: target, reward_amount: reward, reward_wallet_type: mission.reward_wallet_type,
          progress_current: metricValue, progress_target: target,
          completions_available: completionsAvailable, state,
        }
      }))

      return reply.send({
        weekly: views.filter(v => v.category === 'weekly' || v.category === 'one_time'),
        monthly: views.filter(v => v.category === 'monthly'),
      })
    })

    app.post('/users/missions/:id/claim', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as { id: string }
      const missionRes = await db.query<Mission>(
        `SELECT * FROM player_missions WHERE id = $1 AND is_active = true AND verification_type IN ('auto', 'telegram_bot')`,
        [id],
      )
      const mission = missionRes.rows[0]
      if (!mission) return reply.code(404).send({ error: 'Mission not found' })

      const period = getCurrentPeriod(mission.category, new Date())
      const alreadyClaimed = await getAlreadyClaimed(db, user.sub, mission.id, period.key)
      const metricValue = await getMetricValue(db, user.sub, mission, period.start, period.end)
      const target = parseFloat(mission.target_value)
      const completionsAvailable = computeCompletionsAvailable(metricValue, target, mission.max_completions_per_period, alreadyClaimed)
      if (completionsAvailable < 1) return reply.code(400).send({ error: 'Nothing to claim yet' })

      const completionNumber = await getNextCompletionNumber(db, user.sub, mission.id, period.key)
      const rewardAmount = parseFloat(mission.reward_amount)
      try {
        await db.query(
          `INSERT INTO user_mission_completions (user_id, mission_id, period_key, completion_number, reward_amount, status)
           VALUES ($1, $2, $3, $4, $5, 'completed')`,
          [user.sub, mission.id, period.key, completionNumber, rewardAmount],
        )
      } catch (err: any) {
        if (err.code === '23505') return reply.code(409).send({ error: 'Already claimed' }) // unique violation race
        throw err
      }

      await creditWallet(user.sub, mission, `mission:${mission.id}:${user.sub}:${period.key}:${completionNumber}`)
      return reply.send({ success: true, reward_amount: rewardAmount, completion_number: completionNumber })
    })

    app.post('/users/missions/:id/submit', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const { id } = req.params as { id: string }
      const missionRes = await db.query<Mission>(
        `SELECT * FROM player_missions WHERE id = $1 AND is_active = true AND verification_type = 'manual_review'`,
        [id],
      )
      const mission = missionRes.rows[0]
      if (!mission) return reply.code(404).send({ error: 'Mission not found' })

      const period = getCurrentPeriod(mission.category, new Date())
      const alreadyClaimed = await getAlreadyClaimed(db, user.sub, mission.id, period.key)
      const cap = mission.max_completions_per_period ?? 1
      if (alreadyClaimed >= cap) return reply.code(400).send({ error: 'Already submitted for this period' })

      let proofUrl: string | null = null
      if (req.isMultipart()) {
        const data = await (req as any).file()
        if (data) {
          const ext = path.extname(data.filename || '.jpg').toLowerCase()
          const filename = `${user.sub}_${mission.id}_${crypto.randomBytes(6).toString('hex')}${ext}`
          await pipeline(data.file, fs.createWriteStream(path.join(PROOF_UPLOAD_DIR, filename)))
          proofUrl = `${APP_URL}/uploads/mission-proofs/${filename}`
        }
      }

      const completionNumber = await getNextCompletionNumber(db, user.sub, mission.id, period.key)
      await db.query(
        `INSERT INTO user_mission_completions (user_id, mission_id, period_key, completion_number, reward_amount, status, proof_url)
         VALUES ($1, $2, $3, $4, $5, 'pending_review', $6)`,
        [user.sub, mission.id, period.key, completionNumber, mission.reward_amount, proofUrl],
      )
      return reply.send({ success: true, status: 'pending_review' })
    })
  }
}
