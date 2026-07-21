-- infra/db/migrations/084_lottery_bot_fill.sql
-- Bot ticket-fill/throttle for Daily/Weekly/Monthly lottery draws.
-- See docs/superpowers/specs/2026-07-22-lottery-bot-fill-design.md

CREATE TABLE IF NOT EXISTS lottery_bot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_max_tickets INT NOT NULL DEFAULT 200,
  fill_pct NUMERIC(5,2) NOT NULL DEFAULT 60,
  trigger_pct NUMERIC(5,2) NOT NULL DEFAULT 99,
  release_pct NUMERIC(5,2) NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lottery_bot_config (enabled, default_max_tickets, fill_pct, trigger_pct, release_pct)
SELECT FALSE, 200, 60, 99, 1
WHERE NOT EXISTS (SELECT 1 FROM lottery_bot_config);

ALTER TABLE lottery_draws ADD COLUMN IF NOT EXISTS max_tickets INT NOT NULL DEFAULT 200;
ALTER TABLE lottery_daily_draws ADD COLUMN IF NOT EXISTS max_tickets INT NOT NULL DEFAULT 200;

-- May already exist from the in-flight bot-pool-separation work on another
-- branch; IF NOT EXISTS makes this migration safe to apply either order.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_game_type VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_users_bot_game_type ON users(is_bot, preferred_game_type) WHERE is_bot = true;

-- Seed a small dedicated lottery bot pool, separate from Teen Patti/Ludo bots.
DO $$
DECLARE
  bot_id UUID;
  bot_names TEXT[] := ARRAY['LotteryBot_A', 'LotteryBot_B', 'LotteryBot_C'];
  bot_name TEXT;
BEGIN
  FOREACH bot_name IN ARRAY bot_names LOOP
    IF NOT EXISTS (SELECT 1 FROM users WHERE username = bot_name) THEN
      INSERT INTO users (phone, username, password_hash, is_bot, status, referral_code, preferred_game_type)
      VALUES (
        '999' || floor(random() * 9000000 + 1000000)::text,
        bot_name,
        '$2b$12$invalid_bot_hash_never_login',
        true,
        'active',
        upper(substring(md5(random()::text || bot_name), 1, 8)),
        'lottery'
      )
      RETURNING id INTO bot_id;

      INSERT INTO wallets (user_id, real_balance, bonus_balance) VALUES (bot_id, 5000, 0);
    END IF;
  END LOOP;
END $$;

-- Fail loudly if any lottery bot ended up without a wallet (would silently
-- never be able to buy a ticket, same failure mode as the bot-pool-separation
-- migration's untagged-bot guard).
DO $$
DECLARE
  missing_wallets INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_wallets
  FROM users u LEFT JOIN wallets w ON w.user_id = u.id
  WHERE u.preferred_game_type = 'lottery' AND w.user_id IS NULL;
  IF missing_wallets > 0 THEN
    RAISE EXCEPTION 'lottery bot fill migration incomplete: % lottery bot(s) missing a wallet', missing_wallets;
  END IF;
END $$;
