# Game Config — Overview

Per-game economics/bot tuning: active toggle, rake %, Aviator-specific economics (house edge, max win cap, min/max bet, betting window), and bot-fill settings (enabled, delay, max ratio, fixed table size, difficulty). One card per game from `games/registry.json`'s live set.

A related, more severe issue used to live in the Bots page, not here: saving bot config from `Bots.tsx` could silently null out a game's `is_active` flag and take it offline for real players — fixed 2026-07-28 (the backend PATCH now falls back to the current value for any omitted field). This page's own save (which does include an explicit `is_active` Switch) was never the trigger, but its "LIVE"/"OFF" tag was the visible symptom when it happened elsewhere.
