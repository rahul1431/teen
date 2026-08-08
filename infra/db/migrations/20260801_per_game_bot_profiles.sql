-- Split the shared bot_profiles table into one table per game.
--
-- bot_profiles held the union of every game's columns, so half of every row
-- was structurally meaningless: capture_probability/safe_play_probability were
-- always NULL for Teen Patti (it has no captures), and fold/call/raise
-- probabilities were always ignored for Ludo (it has no betting round —
-- see game-gateway/src/bot-profile.ts's FALLBACK_PROFILES comment, which
-- documents that Ludo bots never read those fields at all).
--
-- A NULL that means "not applicable to this game" is indistinguishable from a
-- NULL that means "not enough samples to train yet", and the second one is
-- load-bearing: chooseBotToken treats NULL capture_probability as "no trained
-- data, use the deterministic rule". Separate tables make that distinction
-- structural instead of conventional.
--
-- bot_profiles is intentionally left in place and untouched by this migration.
-- The versioned snapshot tables (bot_profiles_v*) and their rollback path still
-- reference it; it is dropped in a follow-up once the per-game services have
-- run a full rebuild cycle and the old rows are provably unread.

CREATE TABLE IF NOT EXISTS teen_patti_bot_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  difficulty            VARCHAR(10) NOT NULL UNIQUE CHECK (difficulty IN ('easy','medium','hard')),
  win_rate_target       NUMERIC(5,2),
  -- Betting-round decision rates, learned from teen_patti_move_decisions.
  fold_probability      NUMERIC(5,4),
  call_probability      NUMERIC(5,4),
  raise_probability     NUMERIC(5,4),
  avg_decision_delay_ms INTEGER,
  avg_stake_preference  NUMERIC(10,2),
  aggression_score      NUMERIC(4,2),
  sample_size           INTEGER DEFAULT 0,
  last_rebuilt_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ludo_bot_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  difficulty            VARCHAR(10) NOT NULL UNIQUE CHECK (difficulty IN ('easy','medium','hard')),
  win_rate_target       NUMERIC(5,2),
  -- Move-choice rates, learned from ludo_move_decisions. NULL is meaningful:
  -- it means "below min_sample_size, fall back to the deterministic rule".
  capture_probability   NUMERIC(5,4),
  safe_play_probability NUMERIC(5,4),
  avg_decision_delay_ms INTEGER,
  avg_stake_preference  NUMERIC(10,2),
  sample_size           INTEGER DEFAULT 0,
  last_rebuilt_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Seed from the existing shared table so both services start with exactly the
-- profiles that are live today — the split must not change bot behaviour.
INSERT INTO teen_patti_bot_profiles
  (difficulty, win_rate_target, fold_probability, call_probability, raise_probability,
   avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size, last_rebuilt_at)
SELECT difficulty, win_rate_target, fold_probability, call_probability, raise_probability,
       avg_decision_delay_ms, avg_stake_preference, aggression_score, sample_size, last_rebuilt_at
FROM bot_profiles
WHERE game_type = 'teen_patti'
ON CONFLICT (difficulty) DO NOTHING;

INSERT INTO ludo_bot_profiles
  (difficulty, win_rate_target, capture_probability, safe_play_probability,
   avg_decision_delay_ms, avg_stake_preference, sample_size, last_rebuilt_at)
SELECT difficulty, win_rate_target, capture_probability, safe_play_probability,
       avg_decision_delay_ms, avg_stake_preference, sample_size, last_rebuilt_at
FROM bot_profiles
WHERE game_type = 'ludo'
ON CONFLICT (difficulty) DO NOTHING;

-- Guarantee all three tiers exist for both games even on a fresh database with
-- no bot_profiles rows to copy. These defaults mirror FALLBACK_PROFILES in
-- game-gateway/src/bot-profile.ts, so an untrained table and an unreachable
-- service produce identical bot behaviour rather than two different ones.
INSERT INTO teen_patti_bot_profiles
  (difficulty, fold_probability, call_probability, raise_probability, avg_decision_delay_ms, sample_size)
VALUES
  ('easy',   0.45, 0.45, 0.10, 2800, 0),
  ('medium', 0.30, 0.47, 0.23, 2000, 0),
  ('hard',   0.18, 0.42, 0.40, 1400, 0)
ON CONFLICT (difficulty) DO NOTHING;

-- Ludo seeds leave capture/safe-play NULL on purpose: untrained must mean
-- "use the deterministic rule", not "take captures 50% of the time".
INSERT INTO ludo_bot_profiles
  (difficulty, win_rate_target, avg_decision_delay_ms, sample_size)
VALUES
  ('easy',   25.00, 3000, 0),
  ('medium', 50.00, 3500, 0),
  ('hard',   80.00, 3700, 0)
ON CONFLICT (difficulty) DO NOTHING;

-- Per-game training config. bot_learning_config was a single global key/value
-- table, so changing min_sample_size for Ludo silently retuned Teen Patti's
-- percentile cutoffs too — the same class of bug 20260731_split_bot_training_by_game
-- fixed for bot_learning_sessions.
CREATE TABLE IF NOT EXISTS bot_training_config (
  game_type  VARCHAR(30) NOT NULL,
  key        VARCHAR(50) NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (game_type, key)
);

INSERT INTO bot_training_config (game_type, key, value)
SELECT g.game_type, c.key, c.value
FROM bot_learning_config c
CROSS JOIN (VALUES ('teen_patti'), ('ludo')) AS g(game_type)
ON CONFLICT (game_type, key) DO NOTHING;
