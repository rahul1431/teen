-- Migration 20261026_bot_arena_god_mode.sql
-- Allow 'god_mode' difficulty in bot profile tables for 1000% Advanced Bot training & simulation

DO $$
BEGIN
  -- 1. Relax check constraint on bot_profiles
  ALTER TABLE bot_profiles DROP CONSTRAINT IF EXISTS bot_profiles_difficulty_check;
  BEGIN
    ALTER TABLE bot_profiles ADD CONSTRAINT bot_profiles_difficulty_check CHECK (difficulty IN ('easy','medium','hard','god_mode'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 2. Relax check constraint on teen_patti_bot_profiles if table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'teen_patti_bot_profiles') THEN
    ALTER TABLE teen_patti_bot_profiles DROP CONSTRAINT IF EXISTS teen_patti_bot_profiles_difficulty_check;
    BEGIN
      ALTER TABLE teen_patti_bot_profiles ADD CONSTRAINT teen_patti_bot_profiles_difficulty_check CHECK (difficulty IN ('easy','medium','hard','god_mode'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 3. Relax check constraint on ludo_bot_profiles if table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ludo_bot_profiles') THEN
    ALTER TABLE ludo_bot_profiles DROP CONSTRAINT IF EXISTS ludo_bot_profiles_difficulty_check;
    BEGIN
      ALTER TABLE ludo_bot_profiles ADD CONSTRAINT ludo_bot_profiles_difficulty_check CHECK (difficulty IN ('easy','medium','hard','god_mode'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

-- 4. Ensure bot_profiles has profile_data JSONB, is_active, and updated_at columns
ALTER TABLE bot_profiles ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE bot_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE bot_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. Seed god_mode profiles for Teen Patti, Rummy, and Ludo if not already present
INSERT INTO bot_profiles (game_type, difficulty, win_rate_target, avg_decision_delay_ms, aggression_score, sample_size, created_at, last_rebuild_at)
VALUES
  ('teen_patti', 'god_mode', 96.00, 1100, 4.80, 500, now(), now()),
  ('ludo', 'god_mode', 95.00, 950, 4.50, 500, now(), now()),
  ('rummy', 'god_mode', 96.00, 1050, 4.90, 500, now(), now())
ON CONFLICT (game_type, difficulty) DO UPDATE SET
  win_rate_target = EXCLUDED.win_rate_target,
  avg_decision_delay_ms = EXCLUDED.avg_decision_delay_ms,
  aggression_score = EXCLUDED.aggression_score;

