# "ML Configuration" tab claims fraud-detection thresholds apply immediately — they don't, without a manual risk-service restart

**Severity:** Medium (admin-facing control silently does nothing; misleads whoever is tuning fraud sensitivity)
**Found:** 2026-07-28, backend-services documentation pass (risk-service)
**Files:** `services/risk-service/src/index.ts:274-294`, `services/risk-service/src/fraud-detector.ts:24-34`, `services/admin-service/src/ml-routes.ts:60-75`, `admin-panel/src/components/AI/MLConfigPanel.tsx:94`

## What's wrong

The admin panel's AI Control Center → "ML Configuration" tab (`admin-panel/src/components/AI/MLConfigPanel.tsx`) exposes `risk-service`'s four fraud thresholds (`coLocationThreshold`, `winRateAnomalyThreshold`, `velocityLimitHours`, `referralChainDepth`) plus an `enabled` toggle as an editable form, with the panel's own description text stating: *"Changes take effect immediately"* (`MLConfigPanel.tsx:94`).

Saving the form calls `POST /api/admin/ml/config` (`services/admin-service/src/ml-routes.ts:60-75`), which stores the new blob in Redis (`ml:config` key, 24h TTL) and Postgres (`admin_config` table), then does `redis.publish('ml:config:change', JSON.stringify(config))`.

`risk-service` does subscribe to that channel (`services/risk-service/src/index.ts:274-294`). But the handler only parses and **logs** the incoming config (`:280-291`) — it never calls anything that updates the live `FraudDetector` instance's config. `FraudDetector.config` (`fraud-detector.ts:24-34`) is a plain object assigned once in the constructor from `process.env.FRAUD_*` at process boot (`services/risk-service/src/index.ts:30-36`) and is never reassigned afterward. The subscriber's own inline comment even asserts the opposite of what the code does: *"Config is automatically used next time fraudDetector methods are called"* (`:286`) — there is no code path that makes that true.

Additionally, even a full `teen-risk` restart would not pick up the admin-saved values: the new thresholds live only in Redis (`ml:config`) / Postgres (`admin_config`), never written back into `services/risk-service/.env`, and `FraudDetector`'s constructor reads exclusively from `process.env.FRAUD_*` (`index.ts:30-36`). The only way to actually change these thresholds today is to hand-edit `services/risk-service/.env` and restart the `teen-risk` PM2 process.

## Impact

An admin who, say, raises `winRateAnomalyThreshold` from 95% to 98% to reduce false positives via the UI will see the save succeed with no error, and will reasonably believe the system is now less sensitive. It isn't — the running process keeps scoring against whatever was in `.env` at last boot. `block`-level verdicts are now enforced downstream (wallet-service withdrawals, game-gateway matchmaking, fixed 2026-07-28) — which makes this config UI's silent no-op more consequential than when it was purely observational: an admin adjusting this threshold now believes they're tuning what gets blocked, and isn't.

## Fix

Either:
- Have the `ml:config:change` subscriber in `services/risk-service/src/index.ts` actually mutate the live `FraudDetector` instance (e.g. add a `FraudDetector.updateConfig()` setter and call it from the subscriber instead of just logging), and drop the `process.env.FRAUD_*` envs as the source of truth in favor of an initial Redis read at boot; or
- If live-reload is intentionally out of scope, remove/correct the "Changes take effect immediately" copy in `MLConfigPanel.tsx` and document that a `teen-risk` restart (with matching `.env` edits) is required.
