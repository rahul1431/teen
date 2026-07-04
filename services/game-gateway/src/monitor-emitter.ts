import WebSocket from 'ws'

// Fire-and-forget event feed to the monitoring-service, which fans events out
// to the fraud-detection pipeline (Redis stream events:all → risk-service) and
// the game_events analytics table. Gameplay must never block or crash because
// monitoring is down, so everything here is best-effort: events queue in
// memory while disconnected (bounded, oldest dropped) and the socket
// reconnects with capped exponential backoff forever.

const MONITORING_WS_URL = process.env.MONITORING_WS_URL || 'ws://127.0.0.1:3017/ws'
const MAX_QUEUE = 500
const MAX_BACKOFF_MS = 30_000

type MonitorEventType =
  | 'join_matchmaking'
  | 'leave_matchmaking'
  | 'room_joined'
  | 'game_action'
  | 'game_result'
  | 'room_chat'

class MonitorEmitter {
  private ws: WebSocket | null = null
  private queue: string[] = []
  private connecting = false
  private backoffMs = 1000
  private stopped = false

  emit(type: MonitorEventType, data: Record<string, unknown>): void {
    try {
      const payload = JSON.stringify({ type, data })
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(payload, (err) => {
          if (err) this.enqueue(payload)
        })
      } else {
        this.enqueue(payload)
        this.connect()
      }
    } catch {
      // Monitoring must never take down gameplay.
    }
  }

  private enqueue(payload: string): void {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift()
    this.queue.push(payload)
  }

  private connect(): void {
    if (this.connecting || this.stopped) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.connecting = true

    try {
      const ws = new WebSocket(MONITORING_WS_URL)
      this.ws = ws

      ws.on('open', () => {
        this.connecting = false
        this.backoffMs = 1000
        console.log(`[monitor-emitter] connected to ${MONITORING_WS_URL}`)
        const pending = this.queue.splice(0, this.queue.length)
        for (const payload of pending) {
          ws.send(payload, (err) => {
            if (err) this.enqueue(payload)
          })
        }
      })

      ws.on('close', () => this.scheduleReconnect())
      ws.on('error', (err) => {
        // 'close' follows 'error'; just log quietly at connect-storm-safe level
        if (this.backoffMs <= 1000) console.warn(`[monitor-emitter] socket error: ${err.message}`)
      })
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.connecting = false
    this.ws = null
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    setTimeout(() => this.connect(), delay).unref()
  }

  start(): void {
    this.connect()
  }

  stop(): void {
    this.stopped = true
    try { this.ws?.close() } catch { /* ignore */ }
  }
}

export const monitorEmitter = new MonitorEmitter()
