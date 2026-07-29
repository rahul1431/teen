/**
 * Event schema for Kafka game events
 * Shared between game-gateway (producer) and bot-learning-service (consumer)
 */

export type EventType = 'game-complete' | 'profile-update' | 'anomaly-detection'

export interface EventRecord {
  type: EventType
  timestamp: number
  player_id: string
  game_type: string
  outcome?: 'win' | 'loss' | 'draw'
  win_rate?: number
  trace_id?: string
  span_id?: string
  [key: string]: any
}

export function validateEvent(event: any): EventRecord | null {
  try {
    if (!event.type || !event.timestamp || !event.player_id || !event.game_type) {
      return null
    }

    const validTypes = ['game-complete', 'profile-update', 'anomaly-detection']
    if (!validTypes.includes(event.type)) {
      return null
    }

    return event as EventRecord
  } catch {
    return null
  }
}

export function serializeEvent(event: EventRecord): string {
  return JSON.stringify(event)
}

export function deserializeEvent(data: string): EventRecord | null {
  try {
    const parsed = JSON.parse(data)
    return validateEvent(parsed)
  } catch {
    return null
  }
}
