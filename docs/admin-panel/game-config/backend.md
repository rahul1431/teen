# Game Config — Backend

- **`GET /api/admin/game-configs`** (`services/admin-service/src/index.ts` ~line 1025, any authenticated admin) — all `game_configs` rows.
- **`PATCH /api/admin/game-configs/:gameType`** (`superadmin`) — Zod-validated, and every field now falls back to its current value (via `??`) when a caller omits it, matching the merge-not-overwrite behavior `special_rules` already had — fixed 2026-07-28, previously any omitted field was silently written as `NULL`.

Consumed live by `game-gateway` (`docs/backend-services/game-gateway/`) to gate matchmaking/private-table creation on `is_active`, and by `matchmaking.ts` for `min_players`/`max_players`/bot-fill fields/`bot_difficulty`.
