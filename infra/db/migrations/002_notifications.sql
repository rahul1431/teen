-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'general',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  read BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, read);

-- Seed 20 bot users for Teen Patti
DO $$
DECLARE
  i INT;
  bot_id UUID;
  bot_names TEXT[] := ARRAY[
    'Raju_Bot','Shyam_Bot','Priya_Bot','Amit_Bot','Neha_Bot',
    'Rahul_Bot','Pooja_Bot','Suresh_Bot','Anjali_Bot','Vikram_Bot',
    'Kavita_Bot','Deepak_Bot','Sunita_Bot','Arun_Bot','Meera_Bot',
    'Rohan_Bot','Seema_Bot','Kiran_Bot','Arjun_Bot','Nisha_Bot'
  ];
BEGIN
  FOR i IN 1..20 LOOP
    bot_id := uuid_generate_v4();
    INSERT INTO users (id, phone, username, password_hash, is_bot, status, referral_code)
    VALUES (
      bot_id,
      LPAD(i::TEXT, 10, '9'),
      bot_names[i],
      '$2b$12$invalid_bot_hash_never_login',
      TRUE,
      'active',
      UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 8))
    ) ON CONFLICT DO NOTHING;

    INSERT INTO wallets (user_id, real_balance, bonus_balance)
    VALUES (bot_id, 10000, 0)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
