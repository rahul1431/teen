# Bot Learning Service — Admin-panel touchpoints

There are **two** admin-panel pages that look like they concern "bots," and only one of them actually reaches this service. This file is the service-side half of that trace; `docs/admin-panel/ai-control-center/*` already documents the page/tab structure in full and is not repeated here beyond what's needed to connect the two.

## `Bots.tsx` (`/bots` route) — does not reach this service at all

`admin-panel/src/pages/Bots.tsx` calls `adminApi.get('/bots/stats')`, `adminApi.get('/game-configs')`, `adminApi.delete('/bots/:id')`, and `adminApi.patch('/game-configs/:gameType')` — all of these hit **`admin-service`'s own `bots`/`game_configs` tables** (individual bot user rows with `is_bot = true`, and the single per-game `bot_difficulty`/`bot_fill_*` config), not `bot-learning-service`. The per-bot "Play Style"/"Skill Level" columns on this page are fabricated client-side from a hash of the bot's UUID and have no relationship to this service's `bot_profiles` table at all — already filed as `docs/Bugs/bots-page-fake-personality-skill.md`, which explicitly notes the real data source (`GET /api/admin/bots/profile(s)`, i.e. this service, via `bot-learning-routes.ts`) exists and is wired elsewhere but never consulted from this page. This same page's per-game config save path used to have an unrelated but serious bug (`is_active` silently nulled) — fixed 2026-07-28, not this service's concern, noted only so it isn't mistaken for one.

## `AIControlCenter.tsx` → "ML Configuration" tab → `MLConfigPanel` → `BotLearningSection` — the real path

Route: `admin-panel/src/main.tsx:64`, `path="ai-control"`, lazy-loaded `AIControlCenter`. Tab 2 ("ML Configuration", `AIControlCenter.tsx:37-44`) renders `<MLConfigPanel />`, which renders its own "Bot Settings" card (see below — **dead**) and then, at the bottom, `<BotLearningSection />` (`MLConfigPanel.tsx:369`) — this nested component is the one genuine UI surface wired to `bot-learning-service`.

`BotLearningSection.tsx` (`admin-panel/src/components/AI/BotLearningSection.tsx`) calls, via `adminApi` (baseURL already includes `/api/admin`):

| UI action | Request | Admin-service route (`bot-learning-routes.ts`) | RBAC |
|---|---|---|---|
| Mount (`loadProfiles`, `:43-61`) | `GET bots/profiles` | `GET /api/admin/bots/profiles` (`:23-30`) | `authenticate` only |
| Mount (`loadConfig`, `:73-81`) | `GET bots/config` | `GET /api/admin/bots/config` (`:43-50`) | `authenticate` only |
| "Rebuild Now" button (`triggerRebuild`, `:63-71`) | `POST bots/rebuild` | `POST /api/admin/bots/rebuild` (`:32-41`) | `authenticate` + `requireRole('superadmin')` |
| "Save Config" (Schedule & Sampling card, `saveConfig`, `:83-92`) | `PATCH bots/config` with `{rebuild_hour, stream_lookback_days, min_sample_size}` (all stringified) | `PATCH /api/admin/bots/config` (`:52-59`) | `superadmin` |
| Per-tier "Override" → "Save" (`saveOverride`, `:94-105`) | `PATCH bots/profiles/:gameType/:difficulty` with `{fold_probability, call_probability, avg_decision_delay_ms}` only | `PATCH /api/admin/bots/profiles/:gameType/:difficulty` (`:61-75`) | `superadmin` |

All five admin-service routes are correctly role-gated per the pattern used elsewhere in the file (writes require `superadmin`, reads require only `authenticate`) — this is one of the two route groups `docs/admin-panel/ai-control-center/admin.md` calls out as *properly* gated, in contrast to `ml-routes.ts`/`monitor-routes.ts` (see `docs/Bugs/ai-control-center-missing-role-gates.md`, not this service's problem). **However**, per that same doc, the `AIControlCenter` page itself has no client-side role check — a `readonly`/`support`-role admin sees the "Rebuild Now" button, the config form, and every per-tier "Override" button rendered and clickable exactly like a `superadmin` would; they only discover the write is rejected when the `PATCH`/`POST` comes back 403, since none of these buttons are conditionally hidden.

None of these five admin-service routes attach an `x-internal-key` (or any) header on their outbound call to `bot-learning-service` (`bot-learning-routes.ts:15,25,36,45,54,66-69`) — see `backend.md`'s "No authentication" section for why that matters given `bot-learning-service` itself checks nothing either.

### What the override form does *not* reach

`saveOverride` only ever submits `fold_probability`, `call_probability`, and `avg_decision_delay_ms` (`BotLearningSection.tsx:96-100`) even though `overrideProfile`'s server-side allow-list (`profile-builder.ts:261-262`) also accepts `win_rate_target`, `raise_probability`, `avg_stake_preference`, and `aggression_score` — the form's own `<Slider>`/`initialValues` simply never includes them (`:167-182`), and the profile card's `<Statistic>` tiles (`:152-160`) don't display `win_rate_target` at all, so an admin looking at this panel has no visibility that the field exists, let alone that it's the one thing `main.go`'s DDA swap actually reads. This is the same gap already fully documented in `docs/backend-services/teen-patti-engine/admin.md` and `docs/Bugs/teen-patti-dda-admin-control-gap.md` — restated here only to make explicit that the fix, if implemented, lives in this exact file (`BotLearningSection.tsx`) and this exact allow-list (`overrideProfile`), not anywhere in `MLConfigPanel`'s own "Bot Settings" card (next section), which is a structurally different, disconnected code path.

### `MLConfigPanel`'s own "Bot Settings" card — does not reach this service

The card at `MLConfigPanel.tsx:224-295` ("Max Bot Win Rate (%)" slider, "Decision Tree Depth", "Aggression Level", difficulty buttons, "Enable Bots" switch) is part of the same component but a **completely separate** data path: it's bound to `form`'s `botSettings.*` fields, which round-trip through `POST /api/admin/ml/config` (`ml-routes.ts`), not `bot-learning-routes.ts`. That endpoint persists the whole `MLConfig` blob to Redis/Postgres and publishes `ml:config:change` — the only subscriber (`risk-service`) only reads the `fraudDetection` sub-object back out. `botSettings` (including the "Max Bot Win Rate" value an admin might reasonably expect to be `win_rate_target`) is written and published into the void; nothing — not `bot-learning-service`, not the teen-patti engine, not `game-gateway` — ever reads it back. Fully detailed in `docs/Bugs/teen-patti-dda-admin-control-gap.md`; not re-derived here, only located precisely: this card has no code-level relationship to `bot-learning-service` whatsoever, despite sitting directly above the one card (`BotLearningSection`) that does.

## Summary of what "the admin can control" actually is

Via the one connected path (`BotLearningSection`, `superadmin` role required for writes): the nightly rebuild's schedule hour, its lookback window, its minimum-sample-size gate, and per-tier manual overrides of fold/call/delay only. Via the disconnected path (`MLConfigPanel`'s Bot Settings card): nothing that reaches this service. Not reachable from any admin-panel surface today: `win_rate_target` (the DDA lever), `raise_probability`, `avg_stake_preference`, `aggression_score` — all settable through this service's own API (`overrideProfile`'s allow-list) but not exposed by any form.
