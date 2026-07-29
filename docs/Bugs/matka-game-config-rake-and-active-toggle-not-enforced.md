# Matka's admin "Game Active" and "Rake %" controls save successfully but have zero effect on betting

**Severity:** High
**Found:** 2026-07-28, games documentation pass (matka)
**Files:** `admin-panel/src/pages/games/Matka.tsx:117-154` (config card: `is_active`, `rake_percent`), `services/core-api-service/src/plugins/betting.ts` and `services/core-api-service/src/helpers/matka.ts` (zero references to `game_configs`/`rake`/`is_active` in either file — the only `game_configs.special_rules` reader in `betting.ts` is the Cricket section, `:389,419,435`)

## What's wrong

The Matka admin page's config card lets an admin toggle a game-wide "Game Active" switch and set a platform rake percentage, and the save always succeeds via the generic `game_configs` PATCH route. But no Matka route reads either field: `POST /matka/bet` computes payout purely as `amount * MATKA_MULTIPLIERS[bet_type]` with no rake deduction, and the only active/inactive gate that's actually checked is `matka_markets.is_active` — a separate, per-market row, not the game-level flag this control writes. (This card also used to render a dead "Bot Settings" section with the same root cause — fixed 2026-07-28 by removing it; this bug covers the remaining `is_active`/`rake_percent` gap.)

## Impact

An admin believing they've disabled Matka betting platform-wide via "Game Active" has done nothing — betting continues normally across every market. This removes the emergency-stop capability a real-money operator would reasonably expect to have, with no error or warning at save time indicating the toggle is inert. The rake field is similarly pure UI decoration.

## Fix

Either wire `game_configs.is_active` into the Matka bet-placement route (checked before accepting a bet) and `rake_percent` into settlement payout math, or remove the misleading game-level controls from `Matka.tsx` in favor of a clearly-labeled per-market active flag that maps to what's actually enforced.
