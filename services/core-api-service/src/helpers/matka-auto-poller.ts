import { Pool } from 'pg'
import { settleMatkaSession } from './matka'

export function generateRandomPanna(): string {
  const digits = Array.from({ length: 3 }, () => {
    const d = Math.floor(Math.random() * 10)
    return d === 0 ? 10 : d
  })
  digits.sort((a, b) => a - b)
  return digits.map(d => d === 10 ? '0' : String(d)).join('')
}

export class MatkaAutoDeclaringPoller {
  private static readonly POLL_MS = 2 * 60 * 1000 // every 2 minutes
  private timer: NodeJS.Timeout | null = null

  constructor(private db: Pool) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.sweep().catch(err => console.error('[matka-auto-declare] sweep failed:', err))
    }, MatkaAutoDeclaringPoller.POLL_MS)
    console.log('[matka-auto-declare] poller started (every 2m)')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async sweep(): Promise<void> {
    const res = await this.db.query(`
      SELECT d.id AS draw_id, d.draw_date, d.status, d.open_panna, d.close_panna,
             m.id AS market_id, m.name AS market_name, 
             m.open_time, m.close_time,
             (m.open_time + interval '5 minutes')::time AS open_time_grace,
             (m.close_time + interval '5 minutes')::time AS close_time_grace,
             (NOW() AT TIME ZONE 'Asia/Kolkata')::time AS now_ist,
             (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS date_ist
      FROM matka_draws d
      JOIN matka_markets m ON m.id = d.market_id
      WHERE d.status IN ('open', 'open_declared')
    `)

    if (!res.rows.length) return

    for (const row of res.rows) {
      const drawId = row.draw_id
      const status = row.status
      const drawDate = new Date(row.draw_date)
      const dateIst = new Date(row.date_ist)

      // Time strings comparison works because they are HH:MM:SS format
      const nowIst = row.now_ist
      const openTimeGrace = row.open_time_grace
      const closeTimeGrace = row.close_time_grace

      const isPastDate = drawDate.getTime() < dateIst.getTime()
      const isToday = drawDate.getTime() === dateIst.getTime()

      if (status === 'open') {
        const shouldDeclareOpen = isPastDate || (isToday && nowIst >= openTimeGrace)
        if (shouldDeclareOpen) {
          const panna = generateRandomPanna()
          console.log(`[matka-auto-declare] Auto-declaring OPEN for market "${row.market_name}" (draw: ${drawId}) with panna ${panna}`)
          try {
            await settleMatkaSession(this.db, drawId, 'open', panna)
            console.log(`[matka-auto-declare] Successfully settled OPEN for draw: ${drawId}`)
          } catch (err: any) {
            console.error(`[matka-auto-declare] Failed to settle OPEN for draw ${drawId}:`, err?.message || err)
          }
        }
      } else if (status === 'open_declared') {
        const shouldDeclareClose = isPastDate || (isToday && nowIst >= closeTimeGrace)
        if (shouldDeclareClose) {
          const panna = generateRandomPanna()
          console.log(`[matka-auto-declare] Auto-declaring CLOSE for market "${row.market_name}" (draw: ${drawId}) with panna ${panna}`)
          try {
            await settleMatkaSession(this.db, drawId, 'close', panna)
            console.log(`[matka-auto-declare] Successfully settled CLOSE for draw: ${drawId}`)
          } catch (err: any) {
            console.error(`[matka-auto-declare] Failed to settle CLOSE for draw ${drawId}:`, err?.message || err)
          }
        }
      }
    }
  }
}
