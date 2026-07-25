import { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || ''
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || ''
const TELEGRAM_GROUP_INVITE_LINK = process.env.TELEGRAM_GROUP_INVITE_LINK || ''
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

async function callTelegramApi(method: string, params: Record<string, any>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return res.json()
}

export function telegramPlugin(db: Pool) {
  return async function (app: FastifyInstance) {
    app.get('/telegram/deep-link', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as any
      const token = app.jwt.sign({ sub: user.sub, purpose: 'telegram_link' }, { expiresIn: '15m' })
      return reply.send({ link: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` })
    })

    app.post('/telegram/webhook', async (req, reply) => {
      const secret = req.headers['x-telegram-bot-api-secret-token']
      if (secret !== TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ error: 'Unauthorized' })

      const body = req.body as any
      const message = body?.message
      const text: string | undefined = message?.text
      if (!text || !text.startsWith('/start ')) return reply.send({ ok: true })

      const token = text.slice('/start '.length).trim()
      let payload: any
      try {
        payload = app.jwt.verify(token)
      } catch {
        await callTelegramApi('sendMessage', { chat_id: message.chat.id, text: 'This link has expired — go back to the app and tap "Connect Telegram" again.' })
        return reply.send({ ok: true })
      }
      if (payload.purpose !== 'telegram_link') return reply.send({ ok: true })

      const telegramUserId = message.from.id
      const member = await callTelegramApi('getChatMember', { chat_id: TELEGRAM_GROUP_CHAT_ID, user_id: telegramUserId })
      const isMember = member?.ok && ['member', 'administrator', 'creator'].includes(member.result?.status)

      if (!isMember) {
        await callTelegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: `You need to join the group first: ${TELEGRAM_GROUP_INVITE_LINK}\nThen come back and tap "Connect Telegram" again.`,
        })
        return reply.send({ ok: true })
      }

      await db.query(
        `INSERT INTO user_telegram_links (user_id, telegram_user_id, telegram_username, linked_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id, telegram_username = EXCLUDED.telegram_username, linked_at = NOW()`,
        [payload.sub, telegramUserId, message.from.username || null],
      )
      await callTelegramApi('sendMessage', { chat_id: message.chat.id, text: '✅ Verified! Go back to the app to claim your reward.' })
      return reply.send({ ok: true })
    })
  }
}
