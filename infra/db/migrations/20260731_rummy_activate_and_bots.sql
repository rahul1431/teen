-- Rummy was seeded inactive (20260730_rummy_config.sql) pending the mobile
-- integration; that's now shipped, so flip it live. It also never got a
-- dedicated bot pool (only teen_patti/ludo/lottery bots exist), so
-- botFillRoom found zero eligible bots and matchmaking hung indefinitely.
UPDATE game_configs SET is_active = true WHERE game_type = 'rummy';

-- Seed a small dedicated rummy bot pool, separate from Teen Patti/Ludo bots
-- (mirrors 084_lottery_bot_fill.sql's pattern).
DO $$
DECLARE
  bot_id UUID;
  bot_names TEXT[] := ARRAY['RummyBot_A', 'RummyBot_B', 'RummyBot_C', 'RummyBot_D', 'RummyBot_E', 'RummyBot_F'];
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
        'rummy'
      )
      RETURNING id INTO bot_id;

      INSERT INTO wallets (user_id, real_balance, bonus_balance) VALUES (bot_id, 10000, 0);
    END IF;
  END LOOP;
END $$;

-- Fail loudly if any rummy bot ended up without a wallet (same failure mode
-- as the bot-pool-separation and lottery-bot-fill migration guards).
DO $$
DECLARE
  missing_wallets INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_wallets
  FROM users u LEFT JOIN wallets w ON w.user_id = u.id
  WHERE u.preferred_game_type = 'rummy' AND w.user_id IS NULL;
  IF missing_wallets > 0 THEN
    RAISE EXCEPTION 'rummy bot fill migration incomplete: % rummy bot(s) missing a wallet', missing_wallets;
  END IF;
END $$;
