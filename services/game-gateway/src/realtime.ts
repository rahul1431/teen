import { WebSocket } from 'ws'

// One live WebSocket connection plus its identity and room membership.
export interface Conn {
  ws: WebSocket
  userId: string
  username: string
  rooms: Set<string>
  isAlive: boolean
}

// RealtimeHub replaces socket.io's rooms/emit model with plain in-memory maps.
// It targets a single gateway instance (PM2 fork mode). To scale horizontally
// later, the send* methods are the only place that needs a Redis pub/sub
// fan-out — the rest of the app talks to this interface, not the transport.
export class RealtimeHub {
  private byUser = new Map<string, Set<Conn>>()
  private byRoom = new Map<string, Set<Conn>>()

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

  // Join every live connection of a user to a room (used by matchmaking, where
  // we only know the userId, not the specific connection).
  joinRoom(userId: string, roomId: string): void {
    const conns = this.byUser.get(userId)
    if (!conns) return
    let roomSet = this.byRoom.get(roomId)
    if (!roomSet) { roomSet = new Set(); this.byRoom.set(roomId, roomSet) }
    for (const c of conns) { roomSet.add(c); c.rooms.add(roomId) }
  }

  // Join a specific connection to a room (used by the join_room handler).
  joinConn(conn: Conn, roomId: string): void {
    let roomSet = this.byRoom.get(roomId)
    if (!roomSet) { roomSet = new Set(); this.byRoom.set(roomId, roomSet) }
    roomSet.add(conn)
    conn.rooms.add(roomId)
  }

  sendToUser(userId: string, event: string, data: unknown): void {
    const conns = this.byUser.get(userId)
    if (!conns) return
    const msg = JSON.stringify({ event, data })
    for (const c of conns) this.rawSend(c.ws, msg)
  }

  sendToRoom(roomId: string, event: string, data: unknown): void {
    const conns = this.byRoom.get(roomId)
    if (!conns) return
    const msg = JSON.stringify({ event, data })
    for (const c of conns) this.rawSend(c.ws, msg)
  }

  // Per-connection reply (replaces socket.emit).
  send(conn: Conn, event: string, data: unknown): void {
    this.rawSend(conn.ws, JSON.stringify({ event, data }))
  }

  private rawSend(ws: WebSocket, msg: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg) } catch { /* connection went away mid-send */ }
    }
  }
}
