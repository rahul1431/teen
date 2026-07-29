# Lottery's admin "Game Active" and "Rake %" controls save successfully but have zero effect on gameplay

**Severity:** Medium
**Found:** 2026-07-28, games documentation pass (lottery)
**Files:** `admin-panel/src/pages/games/Lottery.tsx:118-155` (config form: `is_active`, `rake_percent`), `services/admin-service/src/index.ts:1030-1044` (generic `PATCH /api/admin/game-configs/:gameType`, persists successfully), `services/core-api-service/src/plugins/betting.ts` and `services/core-api-service/src/helpers/lottery.ts` (zero reads of `game_configs` for `game_type='lottery'` anywhere in either file — the only `game_configs.special_rules` reader in `betting.ts` is the Cricket section, `:389,419,435`)

## What's wrong

The Lottery admin page's config card lets an admin toggle "Game Active" and set a rake percentage, and the save always succeeds via the generic `game_configs` PATCH route. But nothing in the lottery route or settlement code ever reads `game_configs` for `game_type='lottery'` at all — `/lottery/buy` has no active-flag gate (draws are only gated by their own `lottery_draws.status`, a separate per-draw concept), and `settleLottery` computes payout purely from the ticket's stake and the draw's own `prize_multiplier`, with no rake deduction of any kind. (This card also used to render a dead "Bot Settings" section with the same root cause — fixed 2026-07-28 by removing it; this bug covers the remaining `is_active`/`rake_percent` gap that isn't specific to bots.)

## Impact

An admin toggling "Game Active" off, believing they've disabled lottery ticket sales platform-wide, has changed nothing — purchases continue normally. Setting a rake percentage similarly has no effect on any payout. This is a false sense of control over a real-money feature's most basic on/off switch, with no error or warning at save time to indicate the setting is inert.

## Fix

Either wire `is_active` into `/lottery/buy` (reject purchases when false) and `rake_percent` into `settleLottery`'s payout calculation, or remove those two fields from `games/Lottery.tsx`'s config card until they're connected to real behavior.
