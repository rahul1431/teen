# MyOnlineJoker Platform — Audit of Codebase Findings & Potential Edge Cases

This report provides a detailed static code analysis across all monorepo components (Core API, Wallet Service, Game Gateway, Admin Service, Game Engines, Flutter Mobile App, and Admin Panel). The findings highlight edge cases, missing validation formatters, socket reconnection risks, and error-handling gaps.

---

## Summary of Findings by Component & Severity

| Component | Issue / Edge Case Description | Severity | Impact |
|---|---|---|---|
| **Core API & Services** | **Missing Global Zod Error Formatter**: `app.setErrorHandler` is not registered in Fastify instances (Core API, Wallet Service, Admin Service). Malformed JSON inputs cause `z.parse()` to throw `ZodError`, resulting in an unhandled HTTP 500 error instead of a structured 400 Bad Request response. | **High** | Poor API error contract compliance, cluttering error logs with preventable 500 exceptions. |
| **Wallet Service** | **Missing DB Transaction in `unlockFunds` & `consumeLockedFunds`**: Direct SQL `UPDATE wallets SET locked_balance = locked_balance - $1...` executes without explicit transaction wrapping (`BEGIN/COMMIT`), leaving potential concurrency race windows under high traffic. | **High** | Risk of row locking race conditions during simultaneous game settlement and cancellation. |
| **Game Gateway** | **Socket Reconnection State Sync Gap**: When a Flutter client disconnects briefly and reconnects via `/ws`, the gateway sends `room:joined` but does not re-sync player hand cards for active Teen Patti / Ludo games if the room state was updated during the disconnect window. | **Medium** | Reconnected players may see an empty or desynchronized game state until the next turn action occurs. |
| **Core API (Cricket Betting)** | **Unbounded Player Selection Payload**: The fantasy team creation endpoint (`/cricket/fantasy/team`) parses `player_ids` array, but lacks validation ensuring selected player IDs belong to the active match roster. | **Medium** | Users could submit arbitrary player IDs from other matches to craft invalid high-point fantasy teams. |
| **Admin Service** | **Unrestricted Large Page Limits**: Several paginated admin endpoints allow custom `limit` parameters up to unconstrained values (e.g. `limit=100000`), allowing heavy SQL queries that can spike CPU usage. | **Medium** | Performance degradation or database CPU saturation if admin users export large tables simultaneously. |
| **Mobile App (Flutter)** | **Hardcoded Socket Timeout without Fallback**: The WebSocket connection helper uses a hardcoded 5-second connection timeout without progressive exponential backoff on intermittent 4G network drops. | **Low** | Frequent socket disconnect alerts on shaky mobile connections in rural networks. |

---

## Detailed Analyses & Code References

### 1. Fastify Zod Error Handling Across Microservices (High Severity)
- **Location**: `services/core-api-service/src/index.ts`, `services/wallet-service/src/index.ts`, `services/admin-service/src/index.ts`
- **Root Cause**: Fastify routes make extensive use of `z.object({...}).parse(req.body)`. Without a Fastify global error handler catch block:
  ```typescript
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation Error', details: error.errors })
    }
    reply.send(error)
  })
  ```
  Any invalid schema input (e.g. string passed instead of number in `/wallet/deposit/create-order`) throws a unhandled `ZodError` resulting in a `500 Internal Server Error` instead of `400 Bad Request`.

### 2. Wallet Service Concurrent Balance Mutation Locking (High Severity)
- **Location**: `services/wallet-service/src/wallet.service.ts`
- **Details**: `unlockFunds` and `consumeLockedFunds` execute single UPDATE queries on `wallets`:
  ```typescript
  await this.db.query(
    'UPDATE wallets SET locked_balance = locked_balance - $1, real_balance = real_balance + $1 WHERE user_id = $2',
    [amount, userId]
  )
  ```
  While atomic at the SQL statement level, executing this outside `SELECT ... FOR UPDATE` row locks can lead to inconsistent balance logs when running concurrent game cancellations alongside batch settlement jobs.

### 3. Gateway Disconnect & Room Re-Sync Logic (Medium Severity)
- **Location**: `services/game-gateway/src/`
- **Details**: When a Dart client experiences a brief socket drop and reconnects with `join_room`, the gateway sends `room:joined`. However, in Teen Patti, opponent cards are stripped during state updates (`game:state_update`). If a card is dealt or folded during the disconnected interval, the reconnecting user misses the socket event and relies on manual state requests.
- **Recommended Fix**: Trigger an explicit `sendFullSanitizedState(socket, room)` immediately upon re-establishing a socket connection.

### 4. Cricket Fantasy Roster ID Validation (Medium Severity)
- **Location**: `services/core-api-service/src/plugins/betting.ts`
- **Details**: `/cricket/fantasy/team` validates `player_ids: z.array(z.string().uuid()).length(11)`. However, it does not query `cricket_match_players` to confirm that all 11 IDs are registered for the given `match_id`.

---

## Recommended Action Plan

1. **Register Global Zod Error Handler**: Add `app.setErrorHandler` to `core-api-service`, `wallet-service`, and `admin-service` to enforce standardized `400 Bad Request` responses on invalid request payloads.
2. **Wrap Wallet Service Ledger Mutations in Transactions**: Update `unlockFunds` and `consumeLockedFunds` to perform `SELECT ... FOR UPDATE` before mutating `wallets` and `wallet_transactions`.
3. **Enhance Gateway Reconnection Handshake**: Send current sanitized room state automatically upon client socket reconnection.
