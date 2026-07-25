# Ludo Personalized-Difficulty ML Canary — Design

## Context

`churn-ml-service` already exposes `/predict-difficulty`, a Random Forest model that
recommends `easy`/`medium`/`hard` bot difficulty per player. `game-gateway`'s
`matchmaking.ts:startGame` already calls it (`getPersonalizedDifficulty`) for
single-real-player rooms, gated by `isInPersonalizationCanary(playerId)` — but that
gate reads a single global env var, `PERSONALIZATION_CANARY_PCT`, which is `0` on
production and applies to every game type identically.

This is sub-project #1 of "integrate ML into Ludo" (three independent pieces agreed
with the user: this canary rollout, then Ludo-specific fraud/anomaly detection, then
playstyle-based segmentation — each gets its own spec).

Two problems block just flipping the existing knob on for Ludo:

1. **Shared blast radius.** Enabling the global canary activates personalization for
   Teen Patti too. Teen Patti is under an explicit lockdown (no changes without
   re-authorization) — this must not be a side effect of Ludo work.
2. **Poisoned training signal.** The difficulty model's `current_win_rate` feature is
   `SUM(CASE WHEN final_rank = 1 THEN 1 ELSE 0 END) / games_played`. Until
   2026-07-25T06:04:03Z (`services/game-gateway/src/matchmaking.ts` `handleLudoEnd`
   fix, see [[ludo-game-history-missing-results-fixed]]), `final_rank` was never
   written for any Ludo game — every historical Ludo participant row shows a 0% win
   rate regardless of the real outcome. Training on that data teaches the model
   nothing true about Ludo players.

## Goals

- Let Ludo opt into the personalized-difficulty canary independently of Teen Patti.
- Ensure the model is only trained/served on real (post-fix) Ludo outcome data.
- Don't activate real rollout until there's enough post-fix Ludo volume to trust the
  quality-gate accuracy number.

## Non-goals

- Changing Teen Patti's canary behavior at all.
- Building new dashboards — `game_rooms.bot_difficulty_source = 'personalized'` is
  already recorded per room and is sufficient to audit rollout via a DB query.
- Retroactively fixing historical Ludo win-rate data (not possible — the real
  outcome was never recorded, see [[ludo-game-history-missing-results-fixed]]).

## Design

### 1. Per-game canary split (game-gateway, TypeScript)

`services/game-gateway/src/personalized-difficulty-client.ts`:

- Add `PERSONALIZATION_CANARY_PCT_LUDO` env var (default `0`, same clamp/parse logic
  as the existing var).
- `isInPersonalizationCanary(playerId: string, gameType: string): boolean` — new
  `gameType` parameter selects `PERSONALIZATION_CANARY_PCT_LUDO` when
  `gameType === 'ludo'`, otherwise keeps using `PERSONALIZATION_CANARY_PCT` exactly
  as today.
- `matchmaking.ts:527` call site updates to pass `gameType` into
  `isInPersonalizationCanary`.

This is a backward-compatible signature change (existing behavior for every other
game type is byte-for-byte identical); only Ludo gets a new independent knob.

### 2. Exclude pre-fix Ludo rows from training/prediction (churn-ml-service, Python)

`services/churn-ml-service/src/difficulty_predictor.py`, `get_player_features`:

- The inner subquery that aggregates `game_participants` into
  `games_played`/`games_won`/`total_bets` adds, only for the `ludo` branch of the
  `CASE` that assigns `game_type`:
  `AND gp.joined_at >= '2026-07-25 06:04:03+00'`
- Teen Patti/aviator/matka branches are untouched (Teen Patti's `final_rank` was
  always correct — see `services/game-engines/teen-patti/main.go:817`).

This means a Ludo player's `current_win_rate`/`game_count` features only reflect
games played after the fix, so `get_optimal_difficulty`'s existing
`game_count < 10 → easy` rule naturally keeps predictions conservative
(`'fallback'`/`'easy'`) for players who haven't accumulated enough post-fix history
yet — no separate per-player gate needed on top of this.

### 3. Training volume gate (churn-ml-service, Python)

`DifficultyPredictor.train()`:

- Before running the existing 75%-test-accuracy quality gate, add a Ludo-specific
  volume check: count post-cutover Ludo rows in the training set
  (`df[df.game_type == 'ludo']`, `WHERE joined_at >= cutover`). If that count is
  `< 200`, raise the same `ValueError`-based quality-gate pattern already used for
  low accuracy, with a message identifying it as a volume gate — so `/train-difficulty`
  fails loudly instead of silently training on a near-empty/synthetic-padded Ludo
  slice.
- 200 is a judgment call, not a hard requirement from data — the intent is "don't
  trust a Random Forest that saw only single-digit real Ludo examples." Easy to
  raise/lower via a module constant if this proves too strict or too loose once real
  volume starts coming in.

### 4. Rollout

- Deploy the code changes with `PERSONALIZATION_CANARY_PCT_LUDO=0` (no behavior
  change on deploy).
- Once ≥200 post-cutover completed Ludo games exist, call `POST /train-difficulty`
  manually and confirm it reports `success` (not a quality-gate `ValueError`).
- Set `PERSONALIZATION_CANARY_PCT_LUDO=5` on the VPS, restart game-gateway.
- Verify via `SELECT bot_difficulty_source, count(*) FROM game_rooms WHERE game_type
  = 'ludo' AND created_at > <rollout-time> GROUP BY 1` that a small, non-zero
  fraction of rooms show `personalized`.
- Ramp or roll back by editing the env var and restarting — same mechanism as today,
  no new tooling.

## Testing

- TS: unit test for `isInPersonalizationCanary(playerId, gameType)` — Ludo player
  respects `PERSONALIZATION_CANARY_PCT_LUDO`; non-Ludo player is unaffected by that
  var and still keyed off `PERSONALIZATION_CANARY_PCT`.
- Python: unit test (mocked DB rows) confirming a Ludo `game_participants` row dated
  before the cutover is excluded from `get_player_features` output, and one dated
  after is included.
- Python: unit test for the training volume gate raising when post-cutover Ludo rows
  are under the threshold, and not raising when at/above it.

## Rollback

Set `PERSONALIZATION_CANARY_PCT_LUDO=0` and restart `teen-gateway*`. No data
migration involved in this sub-project, so rollback is instant and has no residue.
