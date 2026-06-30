-- Daily Login Bonus system
-- login_bonus_config: admin-controlled bonus schedule (up to 30-day cycle)
CREATE TABLE IF NOT EXISTS login_bonus_config (
  day_number    INT PRIMARY KEY CHECK (day_number BETWEEN 1 AND 30),
  bonus_amount  NUMERIC(15,2) NOT NULL DEFAULT 10,
  bonus_type    VARCHAR(10)   NOT NULL DEFAULT 'real' CHECK (bonus_type IN ('real','bonus')),
  label         VARCHAR(100),
  emoji         VARCHAR(10)   DEFAULT '🎁',
  is_special    BOOLEAN       NOT NULL DEFAULT false,
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Seed default 7-day config
INSERT INTO login_bonus_config (day_number, bonus_amount, bonus_type, label, emoji, is_special) VALUES
(1,  10,  'real',  'Day 1',               '🎁',  false),
(2,  15,  'real',  'Day 2',               '💎',  false),
(3,  20,  'real',  'Day 3',               '🔥',  false),
(4,  25,  'real',  'Day 4',               '⚡',  false),
(5,  30,  'real',  'Day 5',               '🌟',  false),
(6,  40,  'real',  'Day 6',               '👑',  false),
(7,  100, 'real',  'Day 7 — Weekly Bonus!','🏆',  true)
ON CONFLICT (day_number) DO NOTHING;

-- user_login_streaks: per-user streak tracking
CREATE TABLE IF NOT EXISTS user_login_streaks (
  user_id         UUID       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak  INT        NOT NULL DEFAULT 0,
  longest_streak  INT        NOT NULL DEFAULT 0,
  last_claimed_date DATE,
  total_claimed   INT        NOT NULL DEFAULT 0,
  total_earned    NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_login_streaks_last_date ON user_login_streaks(last_claimed_date);
