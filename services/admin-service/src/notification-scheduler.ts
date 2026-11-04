import { Pool } from 'pg'

export class NotificationScheduler {
  private static readonly CHECK_INTERVAL_MS = 60 * 1000 // every minute
  private timer: NodeJS.Timeout | null = null

  constructor(private db: Pool, private coreApiUrl: string, private internalKey: string) {}

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error('[notification-scheduler] tick failed', err))
    }, NotificationScheduler.CHECK_INTERVAL_MS)
    console.log('[notification-scheduler] started running (checks every minute)')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    // Fetch pending campaigns that are due
    const res = await this.db.query(
      `SELECT id, title, body, type, target_type, target_user_id, image_url, segment_type 
       FROM notification_campaigns 
       WHERE status = 'pending' AND scheduled_for <= NOW() 
       FOR UPDATE SKIP LOCKED`
    )

    for (const campaign of res.rows) {
      try {
        // Mark as processing
        await this.db.query('UPDATE notification_campaigns SET status = $1 WHERE id = $2', ['processing', campaign.id])

        if (campaign.target_type === 'all') {
          // Broadcast
          const coreRes = await fetch(`${this.coreApiUrl}/internal/notifications/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': this.internalKey },
            body: JSON.stringify({
              title: campaign.title,
              body: campaign.body,
              type: campaign.type,
              campaign_id: campaign.id,
              image_url: campaign.image_url,
              segment_type: campaign.segment_type
            }),
          })
          if (!coreRes.ok) {
            throw new Error(`Core API broadcast failed with status ${coreRes.status}`)
          }
          const data: any = await coreRes.json()
          await this.db.query(
            'UPDATE notification_campaigns SET status = $1, delivered_count = $2 WHERE id = $3',
            ['sent', data.sent ?? 0, campaign.id]
          )
        } else {
          // Specific user
          const coreRes = await fetch(`${this.coreApiUrl}/internal/notifications/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': this.internalKey },
            body: JSON.stringify({
              user_id: campaign.target_user_id,
              title: campaign.title,
              body: campaign.body,
              type: campaign.type,
              campaign_id: campaign.id,
              image_url: campaign.image_url
            }),
          })
          if (!coreRes.ok) {
            throw new Error(`Core API send failed with status ${coreRes.status}`)
          }
          const data: any = await coreRes.json()
          await this.db.query(
            'UPDATE notification_campaigns SET status = $1, delivered_count = $2 WHERE id = $3',
            ['sent', data.delivered ?? 0, campaign.id]
          )
        }
      } catch (err: any) {
        console.error(`[notification-scheduler] campaign ${campaign.id} failed:`, err.message)
        await this.db.query(
          'UPDATE notification_campaigns SET status = $1, error_message = $2 WHERE id = $3',
          ['failed', err.message || 'Unknown error', campaign.id]
        )
      }
    }
  }
}
