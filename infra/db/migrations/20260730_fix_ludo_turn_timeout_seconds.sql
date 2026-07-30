-- game-gateway now actually reads special_rules.turn_timeout_seconds for Ludo's
-- AFK auto-play window (see MatchmakingService.getLudoAfkTimeoutMs). It was
-- seeded at 20 in 008_enable_ludo.sql but the code-side default — and the
-- mobile client's visible countdown ring — has always been 30s (commit
-- 4811bfd). Correct the seed so wiring it up doesn't silently shorten the
-- live AFK window out from under the client's 30s ring.
UPDATE game_configs
SET special_rules = jsonb_set(special_rules, '{turn_timeout_seconds}', '30')
WHERE game_type = 'ludo';
