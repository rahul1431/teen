-- Bot pool separation: gives Teen Patti and Ludo dedicated, non-overlapping
-- bot account pools instead of drawing from one shared global pool. See
-- docs/superpowers/specs/2026-07-21-bot-pool-separation-design.md

ALTER TABLE users ADD COLUMN preferred_game_type VARCHAR(30);

-- Partial index: this column is only ever queried for is_bot = true rows.
CREATE INDEX idx_users_bot_game_type ON users(is_bot, preferred_game_type) WHERE is_bot = true;

-- One-time backfill of the 30 existing bot accounts (production data,
-- verified 2026-07-21). Split evenly 15/15, weighted so each game keeps a
-- healthy pool despite Ludo having zero exclusively-Ludo bot history.

UPDATE users SET preferred_game_type = 'teen_patti'
WHERE is_bot = true AND username IN (
  'Seema_Bot', 'Anjali_Bot', 'Arun_Bot', 'Kavita_Bot', 'Amit_Bot',
  'Deepak_Bot', 'Shyam_Bot', 'Kiran_Bot',
  'Shiva', 'Saritha', 'Bhaskar', 'Rakesh', 'Rathod',
  'Sunita_Bot', 'Neha_Bot'
);

UPDATE users SET preferred_game_type = 'ludo'
WHERE is_bot = true AND username IN (
  'Pawar', 'Manisha', 'Anjali', 'nithin', 'Mohan',
  'Raju_Bot', 'Meera_Bot', 'Pooja_Bot', 'Priya_Bot', 'Nisha_Bot',
  'Vikram_Bot', 'Arjun_Bot', 'Rahul_Bot', 'Rohan_Bot', 'Suresh_Bot'
);

-- Fail loudly rather than silently deploying with an untagged bot that
-- would become unselectable by any game once matchmaking.ts enforces
-- this filter. Covers both a naming mismatch in the lists above and any
-- bot account created between the design investigation and this running.
DO $$
DECLARE
  untagged_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO untagged_count FROM users WHERE is_bot = true AND preferred_game_type IS NULL;
  IF untagged_count > 0 THEN
    RAISE EXCEPTION 'bot pool separation backfill incomplete: % bot(s) still have NULL preferred_game_type', untagged_count;
  END IF;
END $$;
