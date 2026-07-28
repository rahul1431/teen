# Aviator — Admin Panel

Two admin-panel pages read and write the same underlying `game_configs` row (`game_type='aviator'`) through the same admin-service endpoints (`GET /game-configs`, `PATCH /game-configs/aviator`, `services/admin-service/src/index.ts:1026,1037-1043`). There is no admin surface anywhere for observing a live round in progress (no current-multiplier readout, no active-bets list, no manual force-crash/force-settle) — contrast with Teen Patti/Ludo, which have an admin "Live Spectator"/force-action path that reads the engine's Redis state directly (`docs/backend-services/game-gateway/admin.md`). Operationally, Aviator is only configurable, never observable or interruptible, from the admin panel.

## Dedicated page — `admin-panel/src/pages/games/Aviator.tsx` (route `/admin/games/aviator`, sidebar `Games → Aviator`)

Loads `GET /game-configs`, finds the row where `game_type === 'aviator'`, and renders a single form plus a static info card.

**"Aviator Rules & Settings" card** — every field here maps to a real column or `special_rules` key the engine actually reads (`loadConfig()`, `services/game-engines/aviator/src/index.ts:94-113`):
| Control | Field | Reaches the engine as |
|---|---|---|
| Game Active | `is_active` | `aviatorConfig.isActive` — the kill switch; `false` stops new rounds entirely (`aviator:maintenance` broadcast) starting from the very next round boundary |
| Rake % (Platform Fee) | `rake_percent` (top-level column) | `aviatorConfig.rakePercent` — cut taken from cash-out **profit** only |
| House Edge % | `special_rules.house_edge_percent` | `aviatorConfig.houseEdgePercent` — sizes the instant-1.00x-crash probability band in `generateCrashPoint` |
| Max Win Cap | `special_rules.max_win` | `aviatorConfig.maxWin` — absolute payout ceiling per bet, `0` = unlimited |
| Min Bet | `special_rules.min_bet` | `aviatorConfig.minBet` |
| Max Bet | `special_rules.max_bet` | `aviatorConfig.maxBet` |
| Betting Window (ms) | `special_rules.betting_time_ms` | `aviatorConfig.bettingTimeMs` — controls both the actual betting-phase `setTimeout` duration and the `betting_time_ms` value broadcast to clients in `aviator:round_start` |

This card is a genuine, effective control surface — see `overview.md` for why it works (config is re-read fresh from Postgres at the start of every round, not cached/dead).

**"Bot Settings" card — removed (fixed 2026-07-28).** `Aviator.tsx` used to render a full `Bot Fill Enabled`/`Bot Fill Delay`/`Max Bot Ratio`/`Bot Difficulty` section that wrote real `game_configs` columns nothing ever read: `game-gateway`'s bot-fill machinery (`matchmaking.ts`'s `joinQueue`/`botFillRoom`) only operates on games that go through its `matchmaking:<gameType>:...` Redis queue and `game_rooms`/`game_participants` tables, and Aviator never enters that queue (confirmed: zero references to `'aviator'` anywhere in `services/game-gateway/src`, aside from one dead fallback profile — see `docs/backend-services/game-gateway/backend.md` and `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md`); the Aviator engine's own `loadConfig()` never selected those columns either (`services/game-engines/aviator/src/index.ts:96-97` selects only `is_active, rake_percent, special_rules`). The card has been removed from this page entirely rather than left as a dead control.

**"Aviator System Overview" card** — static descriptive text only (no live data), correctly describing the single-continuous-round model and the HMAC-SHA256 provable-fairness scheme in prose. Not wired to any real-time source.

## Generic page — `admin-panel/src/pages/GameConfig.tsx` (route `/admin/game-config`, lists every game as a card)

Renders one `Card` per row returned by `GET /game-configs`, including Aviator's. The Aviator card conditionally shows the same "Aviator Economics" fields (`GameConfig.tsx:59-77`, gated on `cfg.game_type === 'aviator'`) as the dedicated page, submitting to the identical `PATCH /game-configs/aviator` endpoint with the identical payload-splitting logic (`house_edge_percent`/`max_win`/`min_bet`/`max_bet`/`betting_time_ms` peeled off into `special_rules`). This page is itself unreachable through the UI (`docs/Bugs/orphaned-admin-pages.md` — not imported by `main.tsx`, no nav entry), but its source still renders an unconditional "Bot Settings" section for every game card (`GameConfig.tsx:79-99`, no `game_type` gate) — the same dead controls the dedicated Aviator page removed still exist here, just behind dead code that nothing can navigate to.

Net effect: there are two admin UIs that can edit Aviator's `is_active`/rake/economics, but only the reachable one (`Aviator.tsx`) matters in practice — the orphaned duplicate's stale Bot Settings section is moot since nothing can reach it.

## Other admin surfaces that reference Aviator

- **`admin-panel/src/pages/Leaderboard.tsx`** — game-type selector includes `aviator`. The backing query (`services/core-api-service/src/plugins/leaderboard.ts:33-48`) is Aviator-specific: because there's no `game_participants` row for a solo-crash game, it instead sums `wallet_transactions.amount` for `type='game_credit', status='completed'` rows whose `idempotency_key LIKE 'aviator_cashout_%'`, joined to `users` and filtered to `is_bot=false`. This correctly reconstructs "total winnings" per player from the wallet ledger, matching the idempotency-key format the engine actually writes (`aviator_cashout_${userId}_${roundId}_${betIndex}`) — worth noting is that the score is **gross winnings paid out**, not net profit (i.e., a player who bet ₹10,000 and cashed out at 1.01x nets almost nothing but still accrues a large "score"), the same methodology used for other games' `prize_won` sums, so it's consistent within the codebase even if "biggest gross payout" and "most skillful/profitable player" aren't the same ranking.
- **`admin-panel/src/components/AI/BotLearningSection.tsx`** — renders a full Easy/Medium/Hard "Aviator" card identical in shape to Teen Patti's (fold/call/raise probabilities, sample size), backed by `bot_profiles` rows that `bot-learning-service`'s nightly rebuild can never actually populate for Aviator (no qualifying `game_participants` rows exist for a game that doesn't use the room model) — already filed as `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md`; not re-analyzed here.
- **`admin-panel/src/components/AI/AppMonitorTab.tsx`** — references `aviator` only as one entry in a generic per-game event-count breakdown sourced from app-telemetry events, not gameplay data; no Aviator-specific logic.
- **Risk/fraud pipeline** — `services/risk-service`, `services/churn-service`, and `services/monitoring-service` contain no references to `aviator` at all (confirmed by a repo-wide source grep). Aviator round outcomes are not fed into the fraud-detection or win-rate-threshold machinery documented for Teen Patti in `docs/Bugs/risk-center-win-rate-threshold-mismatch.md` and related bugs — there is currently no automated anomaly detection specific to Aviator cash-out patterns (e.g., a player who always cashes out a split-second before every crash).

## Bugs referenced in this document

- `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md` (already filed) — the BotLearningSection Aviator card.
- `docs/Bugs/orphaned-admin-pages.md` — the unreachable `GameConfig.tsx` duplicate still has the dead Bot Settings section removed from the reachable page.
