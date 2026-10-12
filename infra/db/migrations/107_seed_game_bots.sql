-- Migration 107: Seed dedicated and diverse bot accounts for Teen Patti, Ludo, and Rummy
-- Ensures every game has active bots with difficulty tiers (easy, medium, hard) and funded wallets.

-- 1. Update existing Rummy bots with difficulty tiers
UPDATE users SET bot_difficulty = 'easy' WHERE username IN ('Aarav', 'Riya') AND is_bot = true;
UPDATE users SET bot_difficulty = 'medium' WHERE username IN ('Kabir', 'Ananya') AND is_bot = true;
UPDATE users SET bot_difficulty = 'hard' WHERE username IN ('Vihaan', 'Diya') AND is_bot = true;

-- Ensure all existing bots have funded wallets
INSERT INTO wallets (user_id, real_balance, bonus_balance)
SELECT id, 50000.00, 0.00 FROM users WHERE is_bot = true
ON CONFLICT (user_id) DO UPDATE SET real_balance = GREATEST(wallets.real_balance, 50000.00);

-- Helper function to seed bots
DO $$
DECLARE
  tp_names TEXT[] := ARRAY['Arjun_Bot', 'Vikram_Bot', 'Amit_Bot', 'Deepak_Bot', 'Karan_Bot', 'Rohan_Bot', 'Suresh_Bot', 'Rajesh_Bot', 'Kavita_Bot', 'Neha_Bot', 'Pooja_Bot', 'Priya_Bot', 'Anjali_Bot', 'Sunita_Bot', 'Meera_Bot'];
  tp_diffs TEXT[] := ARRAY['easy', 'medium', 'hard', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard'];
  ludo_names TEXT[] := ARRAY['Aditya_Ludo', 'Rohan_Ludo', 'Sameer_Ludo', 'Manish_Ludo', 'Kunal_Ludo', 'Sanjay_Ludo', 'Alok_Ludo', 'Vivek_Ludo', 'Divya_Ludo', 'Sneha_Ludo', 'Shweta_Ludo', 'Rashmi_Ludo', 'Tanvi_Ludo', 'Komal_Ludo', 'Isha_Ludo'];
  ludo_diffs TEXT[] := ARRAY['easy', 'medium', 'hard', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard', 'easy', 'medium', 'hard'];
  all_names TEXT[] := ARRAY['Rahul_Player', 'Varun_Gamer', 'Preeti_Star', 'Simran_Ace', 'Nikhil_Pro', 'Gaurav_King', 'Pooja_Lucky', 'Megha_Queen'];
  i INT;
  new_id UUID;
BEGIN
  -- Insert Teen Patti Bots
  FOR i IN 1..array_length(tp_names, 1) LOOP
    INSERT INTO users (username, phone, password_hash, is_bot, status, preferred_game_type, bot_difficulty, kyc_status)
    VALUES (tp_names[i], '9900000' || LPAD(i::TEXT, 3, '0'), '$2a$10$abcdefghijklmnopqrstuvwxyza', true, 'active', 'teen_patti', tp_diffs[i], 'approved')
    ON CONFLICT (username) DO UPDATE SET 
      is_bot = true, status = 'active', preferred_game_type = 'teen_patti', bot_difficulty = tp_diffs[i]
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      INSERT INTO wallets (user_id, real_balance, bonus_balance)
      VALUES (new_id, 50000.00, 0.00)
      ON CONFLICT (user_id) DO UPDATE SET real_balance = GREATEST(wallets.real_balance, 50000.00);
    END IF;
  END LOOP;

  -- Insert Ludo Bots
  FOR i IN 1..array_length(ludo_names, 1) LOOP
    INSERT INTO users (username, phone, password_hash, is_bot, status, preferred_game_type, bot_difficulty, kyc_status)
    VALUES (ludo_names[i], '9900001' || LPAD(i::TEXT, 3, '0'), '$2a$10$abcdefghijklmnopqrstuvwxyza', true, 'active', 'ludo', ludo_diffs[i], 'approved')
    ON CONFLICT (username) DO UPDATE SET 
      is_bot = true, status = 'active', preferred_game_type = 'ludo', bot_difficulty = ludo_diffs[i]
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      INSERT INTO wallets (user_id, real_balance, bonus_balance)
      VALUES (new_id, 50000.00, 0.00)
      ON CONFLICT (user_id) DO UPDATE SET real_balance = GREATEST(wallets.real_balance, 50000.00);
    END IF;
  END LOOP;

  -- Insert Universal Bots (preferred_game_type = 'all')
  FOR i IN 1..array_length(all_names, 1) LOOP
    INSERT INTO users (username, phone, password_hash, is_bot, status, preferred_game_type, bot_difficulty, kyc_status)
    VALUES (all_names[i], '9900002' || LPAD(i::TEXT, 3, '0'), '$2a$10$abcdefghijklmnopqrstuvwxyza', true, 'active', 'all', 'medium', 'approved')
    ON CONFLICT (username) DO UPDATE SET 
      is_bot = true, status = 'active', preferred_game_type = 'all', bot_difficulty = 'medium'
    RETURNING id INTO new_id;

    IF new_id IS NOT NULL THEN
      INSERT INTO wallets (user_id, real_balance, bonus_balance)
      VALUES (new_id, 50000.00, 0.00)
      ON CONFLICT (user_id) DO UPDATE SET real_balance = GREATEST(wallets.real_balance, 50000.00);
    END IF;
  END LOOP;
END $$;
