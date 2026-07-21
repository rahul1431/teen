import { WebSocket } from 'ws'
import { Redis } from 'ioredis'
import { v4 as uuid } from 'uuid'

// One live WebSocket connection plus its identity and room membership.
export interface Conn {
  ws: WebSocket
  userId: string
  username: string
  rooms: Set<string>
  isAlive: boolean
}

// RealtimeHub manages connections and handles cluster-wide broadcasts via Redis.
export class RealtimeHub {
  private byUser = new Map<string, Set<Conn>>()
  private byRoom = new Map<string, Set<Conn>>()
  
  public processId = uuid()
  private redisPub: Redis | null = null

  setRedisPub(redis: Redis): void {
    this.redisPub = redis
  }

  add(conn: Conn): void {
    let set = this.byUser.get(conn.userId)
    if (!set) { set = new Set(); this.byUser.set(conn.userId, set) }
    set.add(conn)
  }

  remove(conn: Conn): void {
    const userSet = this.byUser.get(conn.userId)
    if (userSet) {
      userSet.delete(conn)
      if (userSet.size === 0) this.byUser.delete(conn.userId)
    }
    for (const roomId of conn.rooms) {
      const roomSet = this.byRoom.get(roomId)
      if (roomSet) {
        roomSet.delete(conn)
        if (roomSet.size === 0) this.byRoom.delete(roomId)
      }
    }
    conn.rooms.clear()
  }

  // Join every LOCAL connection of a user to a room, and tell the rest of
  // the cluster to do the same for any local connections THEY hold for this
  // user.
  //
  // Why: nginx hashes WebSocket connections by player token, not by room, so
  // two players at the same table routinely land on different game-gateway
  // processes. sendToRoom() already relays broadcasts across instances via
  // Redis pub/sub — but each instance's relay handler just re-runs its own
  // LOCAL sendToRoom(), which only reaches connections THIS process
  // registered via joinRoom(). Before this fix, joinRoom() only ever ran on
  // whichever single instance executed the game-start code (wherever the
  // bot-fill timer happened to fire), so a player connected to any OTHER
  // instance was never registered in ANY instance's byRoom map — not even
  // its own. Confirmed live: a Ludo player on a different instance than the
  // one that started the room received zero game:state_update broadcasts —
  // not opponents' moves, not their own turn arriving — until the AFK timer
  // auto-played for them. Publishing the join over the same cluster channel
  // sendToRoom already uses closes that gap: whichever instance the target
  // user actually has a live connection on picks it up and registers it
  // locally too.
  joinRoom(userId: string, roomId: string): void {
    this.joinRoomLocal(userId, roomId)
    if (this.redisPub) {
      this.redisPub.publish('gateway:broadcast', JSON.stringify({
        type: 'joinRoom',
        target: roomId,
        userId,
        sender: this.processId,
      })).catch(() => {})
    }
  }

  // Local-only half of joinRoom — also the entrypoint the cluster relay
  // calls on other instances, so this must NOT itself publish (that would
  // loop the join event around the cluster forever).
  joinRoomLocal(userId: string, roomId: string): void {
    const conns = this.byUser.get(userId)
    if (!conns) return
    let roomSet = this.byRoom.get(roomId)
    if (!roomSet) { roomSet = new Set(); this.byRoom.set(roomId, roomSet) }
    for (const c of conns) { roomSet.add(c); c.rooms.add(roomId) }
  }

  // Join a specific connection to a room
  joinConn(conn: Conn, roomId: string): void {
    let roomSet = this.byRoom.get(roomId)
    if (!roomSet) { roomSet = new Set(); this.byRoom.set(roomId, roomSet) }
    roomSet.add(conn)
    conn.rooms.add(roomId)
  }

  sendToUser(userId: string, event: string, data: unknown, senderId?: string): void {
    // 1. Send to local connections on this instance
    const conns = this.byUser.get(userId)
    if (conns) {
      const msg = JSON.stringify({ event, data })
      for (const c of conns) this.rawSend(c.ws, msg)
    }

    // 2. Publish to Redis so other instances in the cluster receive it
    if (this.redisPub && !senderId) {
      this.redisPub.publish('gateway:broadcast', JSON.stringify({
        type: 'user',
        target: userId,
        event,
        data,
        sender: this.processId
      })).catch(() => {})
    }
  }

  sendToRoom(roomId: string, event: string, data: unknown, senderId?: string): void {
    // 1. Send to local connections on this instance
    const conns = this.byRoom.get(roomId)
    if (conns) {
      const msg = JSON.stringify({ event, data })
      for (const c of conns) this.rawSend(c.ws, msg)
    }

    // 2. Publish to Redis so other instances in the cluster receive it
    if (this.redisPub && !senderId) {
      this.redisPub.publish('gateway:broadcast', JSON.stringify({
        type: 'room',
        target: roomId,
        event,
        data,
        sender: this.processId
      })).catch(() => {})
    }
  }

  // Per-connection reply (replaces socket.emit)
  send(conn: Conn, event: string, data: unknown): void {
    this.rawSend(conn.ws, JSON.stringify({ event, data }))
  }

  private rawSend(ws: WebSocket, msg: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg) } catch { /* connection went away mid-send */ }
    }
  }
}
