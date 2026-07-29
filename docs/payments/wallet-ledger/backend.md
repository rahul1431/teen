# Wallet Ledger — Backend

All ledger mutation logic is in `services/wallet-service/src/wallet.service.ts` (`WalletService`, 300 lines). Routes that expose it live in `services/wallet-service/src/index.ts`. Two auth guards: `authenticate` (player JWT via `@fastify/jwt`) and `authenticateInternal` (`x-internal-key` header must equal `INTERNAL_SERVICE_KEY`, fails closed if either side is unset — `index.ts:98-102`).

## `credit(opts, client?)` / `debit(opts, client?)` — `wallet.service.ts:29-143`

Both:
1. `SELECT real_balance, bonus_balance FROM wallets WHERE user_id = $1 FOR UPDATE` — row lock, so concurrent mutations on the same user serialize.
2. Compute `balanceAfter` from the locked-in `balanceBefore`. `debit` throws `Insufficient balance` here if `balanceBefore < amount`, before any write.
3. `INSERT INTO wallet_transactions (...) VALUES (...) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`.
4. Only if that insert returned a row: `UPDATE wallets SET <col> = balanceAfter`, plus a side-effect total (`total_deposited`/`total_won` on credit, `total_withdrawn` on debit) for the matching `type`.
5. If the insert returned nothing (duplicate `idempotency_key` — already processed), roll back/return without touching the balance.

Both accept an optional caller-supplied `PoolClient` so they can be composed into a larger transaction — used by `POST /wallet/deposit/verify` (Razorpay path, credits inside the same transaction as marking the order paid).

`opts.idempotencyKey` is optional per the TS signature but every real caller supplies one; if omitted, `crypto.randomUUID()` is generated — which defeats idempotency entirely (a retry would get a fresh key and double-apply). No caller in this codebase currently omits it for a real money-moving call.

## `lockForGame(userId, amount, roomId, lockId)` — `wallet.service.ts:149-187`

Moves `real_balance → locked_balance`. Idempotency key is `lock:<lockId>` — **`lockId` is caller-generated per individual lock attempt, not derived from `roomId`+`userId`**, by explicit design (comment at `wallet.service.ts:146-148`): a per-room key "would block subsequent bets in the same room," since one room can host multiple sequential locks for the same player (multiple hands/rounds at a persistent table). `POST /internal/wallet/lock` (`index.ts:504-514`) generates a `lock_id` via `crypto.randomUUID()` if the caller (`game-gateway`) doesn't supply one.

## `unlockFunds(userId, amount, roomId, client?)` — `wallet.service.ts:191-240`

Reverses a lock: `locked_balance → real_balance`. Idempotency key is `unlock:<roomId>:<userId>` — **not per-call, unlike `lockForGame`** — deliberately deterministic so it's safe to call from multiple independent places (game-start rollback and `GameWatchdog`'s idle-room reaper both call it for the same room/user without double-refunding). The consequence: if the *same user in the same room* is legitimately locked-and-unlocked more than once (e.g. a room that hosts multiple hands, where an earlier hand's lock was already unlocked once), a second unlock for that same `roomId`+`userId` pair is a silent no-op — the `ON CONFLICT (idempotency_key) DO NOTHING` swallows it and the transaction rolls back with nothing changed, logged nowhere beyond the DB-level conflict. Whether this is exercised in practice depends on whether any room ever unlocks the same user twice.

Also **clamps** rather than throws: `toUnlock = Math.min(locked, amount)`, logging a `console.warn` if `locked < amount` — a deliberate choice to keep settlement from crashing on minor discrepancies, but it means a caller passing a wrong `amount` silently gets a partial unlock instead of a hard error.

## `consumeLockedFunds(userId, amount, client?, roomId?)` — `wallet.service.ts:244-289`

`locked_balance` shrinks by `amount` (money actually spent/lost). Idempotency key is `consume:<roomId>:<userId>` when a `roomId` is given (else a fresh random UUID, which is **not** idempotent — used only by the withdrawal-approval caller, see below). Same per-room+user determinism and same clamp-not-throw behavior as `unlockFunds`, and the same caveat: a second legitimate consume for the same user+room pair is a silent no-op.

`POST /internal/wallet/settle-game` (`index.ts:534-573`) calls this per losing player in a loop, catching and collecting errors into `consume_errors` rather than failing the whole settlement — then unconditionally credits the winner. A stranded lock from this used to have no recovery path; `game-gateway`'s `GameWatchdog` now sweeps recently-completed rooms every 5 minutes and retries any missing consume (fixed 2026-07-28, see `docs/backend-services/game-gateway/backend.md`).

`POST /internal/wallet/consume` (`index.ts:524-528`) is also called by `admin-service`'s withdrawal-approval transition, passing `room_id: "withdrawal:<orderId>"` as the dedupe key — not an actual game room, just reusing the same idempotent primitive.

## Player-facing ledger reads (JWT auth)

- **`GET /wallet/balance`** (`index.ts:105-109`) — `{ real_balance, bonus_balance, locked_balance }`.
- **`GET /wallet/transactions?limit&offset`** (`index.ts:138-143`) — `WalletService.getTransactions`, paginated, newest first.
- **`GET /wallet/game-history?game_type&limit&offset`** (`index.ts:112-135`) — joins `game_participants`/`game_rooms`, computes `net_result = prize_won - entry_fee_deducted` per completed game (bots excluded).

## Internal ledger-mutating routes (`x-internal-key`)

- **`POST /internal/wallet/credit`** (`index.ts:576-602`) — `type` one of `game_credit | bonus | referral | manual_credit`; `bonus`/`referral` are hardcoded to the **bonus** wallet regardless of what the caller passes — there is no `walletType` param on this route at all, the type→wallet mapping is fixed server-side. No `.positive()` constraint on `amount` in the Zod schema; a negative value would flow into `credit()` and effectively debit the target without going through `debit()`'s insufficient-balance check — blocked only by the `wallets` table's `CHECK (>= 0)` constraint (a raw DB error, not a clean 400).
- **`POST /internal/wallet/debit`** (`index.ts:606-629`) — `type` hardcoded `game_debit`, `amount` must be positive. Used by `core-api-service`'s betting flows (Matka/Lottery/Cricket) via `helpers/wallet-client.ts`'s `debitStake`.
- **`POST /internal/wallet/lock`** / **`/unlock`** / **`/consume`** / **`/settle-game`** — see above; all called by `game-gateway`.
- **`POST /wallet/deposit/manual`** / **`POST /wallet/debit/manual`** (`index.ts:227-249`, `410-437`) — admin-only credit/debit paths, `request_id` becomes the idempotency key (`manual_credit:<request_id>` / `manual_debit:<request_id>`). Note the path is `/wallet/...manual`, not `/internal/wallet/...manual` like its siblings — still gated by `authenticateInternal`, just an inconsistent URL prefix.

## Direct-write paths outside `WalletService`

`game-gateway` writes to `wallets`/`wallet_transactions` directly from its own DB pool in two places, bypassing `WalletService` entirely: the `room:tip` WS handler (`services/game-gateway/src/index.ts`, idempotency-key bug fixed 2026-07-28 — see `docs/games/teen-patti/backend.md`) and `autoRefillBots` (`services/game-gateway/src/matchmaking.ts:201-239`, tops bot wallets back to ₹10,000). Both hand-roll their own `BEGIN`/`FOR UPDATE`/`COMMIT`, so they don't inherit any of the correctness guarantees documented above — each has to be verified independently. `tip_dealer` was added to the Postgres `txn_type_enum` (`infra/db/migrations/029_tip_dealer_drop_gifts.sql`) but never added to `WalletService`'s own `TxnType` TS union (`wallet.service.ts:4`) — harmless while these writers never route through `WalletService`, but a trap if anyone later does.
