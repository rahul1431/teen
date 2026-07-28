# Risk Service — Mobile / client surface

**None.** No client — Flutter app or otherwise — calls this service directly, and this service exposes no WebSocket or SSE endpoint a client could subscribe to. It is purely backend-to-backend, and one hop removed at that: it consumes an already-normalized event stream produced by `monitoring-service`, not raw traffic from the game client.

## It does not consume the Flutter app-monitor SDK either

It would be a reasonable guess that a service under `services/*` described as "ingesting from... the Flutter app-monitor SDK" (per the general pattern in `CLAUDE.md` for this family of supporting services) includes risk-service — it does not. The app-monitor SDK (`mobile/lib/core/*` telemetry code) reports to **`app-monitor-service`** over its own separate ingestion path and database tables; that pipeline has no connection to `events:all`, `fraud_events`, or anything in `services/risk-service`. Searching `services/risk-service/src` for any reference to app-monitor concepts (device telemetry, crash reports, `MONITOR_SECRET_KEY`) turns up nothing — the name collision between "monitoring-service" (the actual upstream of this service) and "app-monitor-service" (a same-named-but-unrelated sibling service for Flutter client telemetry) is worth flagging explicitly since it's easy to conflate the two from the service names alone.

## What actually feeds this service, traced end to end

```
Flutter app (gameplay actions, e.g. Teen Patti bet)
        │  Socket.IO / WS
        ▼
game-gateway  (src/realtime.ts — shared broadcast hub for all games)
        │  services/game-gateway/src/monitor-emitter.ts — fire-and-forget WS client,
        │  MONITORING_WS_URL (default ws://127.0.0.1:3017/ws), emits typed events:
        │  join_matchmaking / leave_matchmaking / room_joined / game_action / game_result / room_chat
        ▼
monitoring-service  (src/index.ts — WebSocketServer on the monitoring port)
        │  src/event-processor.ts:71-146 normalizeEvent() maps the 6 raw types into a
        │  common { event_type, game_type, room_id, user_id, amount, action, timestamp } shape
        │  src/index.ts:75-76 — XADD events:<game_type> AND XADD events:all
        ▼
risk-service  (src/index.ts:206-268 — processEvents(), blocking XREAD on "events:all")
        │  fraud-detector.ts:39-121 analyzeGameEvent() — the 4 scoring rules
        ▼
Postgres fraud_events (+ Redis fraud:flagged:<userId>, fraud:alerts pub/sub — unconsumed)
```

Everything from `game-gateway` down is server-side; the Flutter client has no visibility into, and makes no direct request to, any part of this pipeline. A player's actions (placing a bet, winning a hand, joining a room) are what indirectly seed the fraud rules — `event.user_id`, `event.game_type`, and `event.amount` (deposit/withdrawal volume specifically, for the velocity rule) all trace back to real gameplay/wallet activity — but the app itself never calls `risk-service`, never receives a `fraud_score`, and has no code path that would change behavior based on being flagged (a `block` action changes what a *different* system, wallet-service/game-gateway, does with that user server-side, not something risk-service tells the client directly).

## Net effect for anyone working on the mobile app

If you're debugging why a specific player got blocked from a game room or a withdrawal, and a `block`-level fraud decision is a candidate cause: as of 2026-07-28, `game-gateway` and `wallet-service` both check `fraud:flagged:<userId>` (the Redis key `analyzeGameEvent()` sets on a `block` verdict) before allowing matchmaking/private-table join or a withdrawal request — see `docs/backend-services/wallet-service/backend.md`. `slow_lane`-level verdicts still have no enforcement anywhere — `fraud_events` and `fraud:alerts` are the only place that action shows up. There is no risk-service SDK, header, or response field the Flutter app reads directly; the enforcement above happens server-side, invisible to the client beyond an error message on the blocked action.
