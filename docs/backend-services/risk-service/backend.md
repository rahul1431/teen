# Risk Service — Backend

Two files: `services/risk-service/src/index.ts` (Fastify app, routes, event consumer) and `services/risk-service/src/fraud-detector.ts` (`FraudDetector` class — all scoring logic).

## Cron jobs

**None.** No `node-cron`, no `setInterval` scheduling anywhere in this service. The only recurring work is the blocking Redis Streams read loop below, which is event-driven, not time-driven.

## Background consumer — `processEvents()` (`src/index.ts:206-268`)

An infinite `while (true)` loop (kicked off fire-and-forget at `src/index.ts:271`, not awaited by the request lifecycle):

- `redis.xread('COUNT', '10', 'BLOCK', '1000', 'STREAMS', 'events:all', lastId)` — reads up to 10 new messages per iteration, blocks up to 1s, starts from `lastId = '$'` (i.e. only events published **after** this process started; a restart does not replay history).
- Each message's flat `[field, value, field, value...]` array is reduced into an object (`src/index.ts:228-233`), the `data` field is `JSON.parse`d into the raw monitoring-service event, and passed to `fraudDetector.analyzeGameEvent(event)`.
- If a `FraudEvent` comes back, it is published a **second time** to `fraud:alerts` (`src/index.ts:244`) — `FraudDetector.logFraudEvent()` (called internally by `analyzeGameEvent`) already publishes the same payload to the same channel (`fraud-detector.ts:295-301`). Every real fraud event is therefore published to `fraud:alerts` twice per detection. Currently harmless because nothing subscribes to that channel (see "Dead outputs" below), but would double-fire any future consumer.
- Per-message errors are caught and logged individually (`src/index.ts:258-260`) without breaking the loop; only an exception in the surrounding `xread` call itself triggers the outer `catch` at `src/index.ts:263-267`, which retries the whole `processEvents()` call after a flat 5s `setTimeout` — no backoff, no cap on retries.

## Config hot-reload — `ml:config:change` subscriber (`src/index.ts:274-294`) — effectively a no-op

A second Redis connection subscribes to `ml:config:change`. On message, it parses the JSON and, if `config.fraudDetection` is present, only **logs it** (`src/index.ts:285`) with a comment claiming *"Config is automatically used next time fraudDetector methods are called"*. That claim is false: `FraudDetector.config` (`fraud-detector.ts:25,33`) is a plain object assigned once in the constructor; nothing in `index.ts` ever calls a setter or reassigns it after the subscriber fires. Changing thresholds from the admin panel's ML Configuration tab (`POST /api/admin/ml/config`) therefore has **no effect on a running `teen-risk` process** — the new thresholds only take effect after the process is restarted and re-reads `process.env.FRAUD_*` (which, notably, are also never updated by the config-change flow — the new thresholds live in Redis/`admin_config`, not in `services/risk-service/.env`, so even a restart won't pick them up unless someone manually edits the `.env` file to match). This is the mechanism the ML Configuration tab's description text ("Changes take effect immediately" — `admin-panel/src/components/AI/MLConfigPanel.tsx:94`) is wrong about for fraud detection specifically.

## HTTP routes (`src/index.ts`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | `{ status: 'ok', service: 'risk-service', timestamp }`. |
| `GET /api/risk/alerts` | **none** | Last 24h of `fraud_events`, optional `?action=allow\|slow_lane\|block` filter, `?limit=` (default 50, capped 500), ordered by `fraud_score DESC, created_at DESC`. Builds its own SQL inline rather than calling `FraudDetector.getRecentAlerts()` — that method (`fraud-detector.ts:330-345`) is dead code, never invoked anywhere. |
| `GET /api/risk/user/:userId/history` | **none** | Calls `fraudDetector.getUserFraudHistory(userId, limit)` — all `fraud_events` rows for that user, newest first, `limit` capped 500. |
| `GET /api/risk/stats` | **none** | Aggregate counts/avg/max over `?hours=` window (default 24, capped 168): `totalAlerts`, `blocks`, `slowLanes`, `avgScore`, `maxScore`, `uniqueUsers`, `rulesTriggered`. |
| `POST /api/risk/user/:userId/flag` | **`x-internal-key` header must equal `INTERNAL_SERVICE_KEY`** | The only route with any auth check at all (`src/index.ts:171-179`). Body `{ isFlagged, reason }`, delegates to `fraudDetector.setUserFlag()`. |

Three of the four data routes are completely unauthenticated. In practice this is low-risk today only because port 3006 isn't exposed through nginx (internal network only) and, per the "Orphaned HTTP surface" section below, nothing calls these routes at all — but the inconsistency (one route gated by the repo-standard `INTERNAL_SERVICE_KEY` pattern, three not) is worth fixing before anything is ever wired to call this API over the network.

### Orphaned HTTP surface

No service in the repo references `RISK_SERVICE_URL`, `risk-service:3006`, or any client pointed at this HTTP API — confirmed by searching every `services/*/src` and `admin-panel/src` for a caller. `admin-service` does **not** proxy to this API; instead it re-implements the identical queries directly against the same Postgres tables (`services/admin-service/src/index.ts:1888-2075`, routes `/api/admin/fraud-alerts`, `/api/admin/fraud-stats`, `/api/admin/user/:userId/fraud-history`, `/api/admin/user/:userId/fraud-flag`, `PATCH /api/admin/fraud-alerts/:alertId/resolve`). The two implementations have already drifted (admin-service's version additionally selects/updates `resolved`/`resolved_by`/`resolution_notes`, and its flag endpoint writes to the dedicated `user_fraud_flags` table with an `ON CONFLICT` upsert, whereas this service's `setUserFlag()` writes a synthetic audit row into `fraud_events` instead and never touches `user_fraud_flags` at all). See `docs/Bugs/risk-service-http-api-orphaned-and-duplicated.md`.

## Fraud-scoring algorithm (`fraud-detector.ts`)

`analyzeGameEvent(event)` (`fraud-detector.ts:39-121`) is the entry point, called once per stream message. If `FRAUD_DETECTION_ENABLED=false` or the event has no `user_id`, it returns `null` immediately. Otherwise it runs all four rules unconditionally (rule 3 only for `event_type === 'gameAction' | 'gameResult'`) and sums weighted scores:

| Rule | Method | Weight | Trigger condition | Score formula |
|---|---|---|---|---|
| Co-location | `checkCoLocation` (`:127-152`) | 30% | `accountCount >= FRAUD_CO_LOCATION_THRESHOLD` (default 3) accounts sharing a device fingerprint | `min(accountCount / 10, 1)` |
| Win-rate anomaly | `checkWinRateAnomaly` (`:158-192`) | 35% | ≥10 games in last 7 days for that `game_type`, win rate over `FRAUD_WIN_RATE_THRESHOLD`% (default 95) | `min((winRate - threshold) / 5, 1)` |
| Velocity | `checkVelocity` (`:198-222`) | 20% | deposit+withdrawal sum over `FRAUD_VELOCITY_HOURS` (default 1h) exceeds a **hardcoded** ₹10,000 | `min((total - 10000) / 50000, 1)` |
| Referral chain | `checkReferralChain` (`:228-259`) | 15% | referrer (or up to `FRAUD_REFERRAL_DEPTH` hops up, default 2) is present as a Redis `fraud:flagged:<id>` key | `1 - depth * 0.2` |

**Co-location SQL** (`:129-138`) joins `users u` to `device_fingerprints df` where `df.fingerprint` matches the fingerprint on file for the subject user, counting distinct `active`-status users. **This table (`device_fingerprints`) and the related `users.device_fingerprint` column are never written to by any service in the repo** — verified by searching every backend service and the Flutter app for an `INSERT`/`UPDATE` against either. The rule can therefore never score above 0. See `docs/Bugs/device-fingerprint-never-collected.md` (also explains why admin-service's own "Device Links" Risk Center tab, which groups on the same dead `users.device_fingerprint` column, is equally always empty).

**Win-rate SQL** (`:163-173`) defines a "win" as `gp.prize_won > gp.entry_fee_deducted` over `game_participants` joined to `game_rooms`, casting `gr.game_type::text` to tolerate arbitrary strings on the incoming event without a Postgres enum cast error (a deliberate defensive cast, per the inline comment at `:161-162`). This is a genuinely different win/wager definition and threshold (95% win-rate, 7-day window, ≥10 games) from the parallel win-rate check in admin-service's Risk Center (`win/wager ratio > 1.5x` or `> 3x` depending on endpoint — see `docs/Bugs/risk-center-win-rate-threshold-mismatch.md`, filed against that other system). The two "win-rate anomaly" detectors in this codebase use unrelated math and are not the same feature.

**Velocity check** (`:198-222`) queries `wallet_transactions` for `type IN ('deposit', 'withdrawal')` — note the `amount` parameter passed in from `analyzeGameEvent` (the triggering game event's stake/prize amount) is accepted by the method signature but **never read inside its body**; the actual amount scored comes entirely from the `wallet_transactions` table lookup. Also note the rule only runs at all when a `gameAction`/`gameResult` event happens to arrive for that user — a user who deposits/withdraws heavily but doesn't immediately play won't be scored until their next in-game action.

**Referral chain** (`:228-259`) walks `referrals.referrer_id` up to `referralChainDepth` hops, checking Redis key `fraud:flagged:<referrerId>` at each hop (that key is set by `logFraudEvent` only when `action === 'block'`, or by a manual flag via `setUserFlag`).

### Action thresholds — corrects the service's own README

```
confidence = min(totalScore, 1)
confidence > 0.85  → action = 'block'
confidence > 0.6   → action = 'slow_lane'
otherwise          → action = 'allow'          (fraud-detector.ts:86-93)

A FraudEvent is only created/persisted/published at all when confidence > 0.4 (:96).
```

The service's `README.md` (`## Action Thresholds`) documents a `0.4 ≤ score < 0.6 → slow_lane` band — **this does not match the code**. In the real implementation, any event scoring in `(0.4, 0.6]` is still logged to `fraud_events`, still published to `fraud:alerts`, and still shows up in `/api/admin/ml/metrics`'s "fraud" alert feed (used by AI Control Center's `WorkflowDashboard.tsx:345`) — but its `action` is `'allow'`, i.e. no mitigation happens. An operator skimming the README (or the near-identical threshold text baked into `WorkflowDashboard.tsx:112`) would reasonably expect that band to already be rate-limited/2FA-gated; it is not. `block`-level verdicts are enforced as of 2026-07-28 (wallet-service withdrawals, game-gateway matchmaking/private tables — see `docs/backend-services/wallet-service/backend.md`); `slow_lane` still has no enforcement anywhere, which this README/threshold mismatch compounds.

## DB tables

**Written:**
- `fraud_events` — every scored event `> 0.4` (`logFraudEvent`, `fraud-detector.ts:265-306`) and every manual flag/unflag (`setUserFlag`, `:350-385`, inserting a synthetic row with `rule_triggered = 'manual_flag'`). Schema from `infra/db/migrations/013_fraud_detection.sql:21-36`: `id, user_id, game_type, rule_triggered, fraud_score, confidence, evidence, action, resolved, resolved_at, resolved_by, resolution_notes, created_at, updated_at`. This service never reads or writes `resolved`/`resolved_at`/`resolved_by`/`resolution_notes` — those columns are only touched by admin-service's separate `PATCH /api/admin/fraud-alerts/:alertId/resolve`.

**Read:**
- `device_fingerprints`, `users` (co-location, `:129-138`)
- `game_participants`, `game_rooms` (win-rate, `:163-173`)
- `wallet_transactions` (velocity, `:200-207`)
- `referrals` (referral chain, `:235-238`)

**Redis:**
- `fraud:flagged:<userId>` — set for 24h on a `block` action (`:287-291`), or 7 days on a manual flag (`:357-361`); read by the referral-chain rule and nowhere else server-side.
- `fraud:alerts` pub/sub channel — published twice per real event (see above); **no subscriber anywhere in the codebase**, confirmed by searching for `.subscribe('fraud:alerts'`. Dead output today.
- `ml:config:change` pub/sub channel — subscribed, but as documented above, effectively ignored.
