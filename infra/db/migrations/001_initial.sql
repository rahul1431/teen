-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUM types
CREATE TYPE kyc_status_enum AS ENUM ('pending', 'under_review', 'approved', 'rejected');
CREATE TYPE user_status_enum AS ENUM ('active', 'suspended', 'banned');
CREATE TYPE game_type_enum AS ENUM ('teen_patti', 'rummy', 'ludo', 'aviator', 'matka', 'lottery');
CREATE TYPE game_status_enum AS ENUM ('waiting', 'active', 'completed', 'cancelled');
CREATE TYPE txn_type_enum AS ENUM ('deposit', 'withdrawal', 'game_credit', 'game_debit', 'bonus', 'referral', 'transfer', 'manual_credit', 'manual_debit');
CREATE TYPE wallet_type_enum AS ENUM ('real', 'bonus');
CREATE TYPE txn_status_enum AS ENUM ('pending', 'completed', 'failed', 'reversed');
CREATE TYPE payment_gateway_enum AS ENUM ('razorpay', 'cashfree', 'payu', 'manual');
CREATE TYPE payment_type_enum AS ENUM ('deposit', 'withdrawal');
CREATE TYPE payment_status_enum AS ENUM ('created', 'paid', 'failed', 'refunded');
CREATE TYPE bonus_type_enum AS ENUM ('welcome', 'deposit_match', 'daily_login', 'referral', 'tournament', 'manual');
CREATE TYPE bonus_status_enum AS ENUM ('active', 'completed', 'expired');
CREATE TYPE referral_status_enum AS ENUM ('pending', 'qualified', 'rewarded');
CREATE TYPE kyc_doc_type_enum AS ENUM ('pan', 'aadhaar', 'passport', 'driving_license');

-- USERS
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(15) UNIQUE,
  email VARCHAR(255) UNIQUE,
  username VARCHAR(50) UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  kyc_status kyc_status_enum NOT NULL DEFAULT 'pending',
  referral_code VARCHAR(10) UNIQUE,
  referred_by UUID REFERENCES users(id),
  status user_status_enum NOT NULL DEFAULT 'active',
  fcm_token TEXT,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_is_bot ON users(is_bot);
CREATE INDEX idx_users_status ON users(status);

-- ADMIN USERS
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'support_agent',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ADMIN AUDIT LOG
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES admin_users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WALLETS
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  real_balance NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (real_balance >= 0),
  bonus_balance NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  locked_balance NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  total_deposited NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_withdrawn NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_won NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- WALLET TRANSACTIONS (double-entry ledger)
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  type txn_type_enum NOT NULL,
  wallet_type wallet_type_enum NOT NULL DEFAULT 'real',
  amount NUMERIC(15,2) NOT NULL,
  balance_before NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,
  reference_id VARCHAR(200),
  idempotency_key VARCHAR(200) UNIQUE NOT NULL,
  status txn_status_enum NOT NULL DEFAULT 'completed',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_txn_user_id ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_txn_reference_id ON wallet_transactions(reference_id);
CREATE INDEX idx_wallet_txn_created_at ON wallet_transactions(created_at DESC);

-- PAYMENT ORDERS
CREATE TABLE payment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  gateway payment_gateway_enum NOT NULL,
  gateway_order_id VARCHAR(200),
  gateway_payment_id VARCHAR(200),
  amount NUMERIC(15,2) NOT NULL,
  currency VARCHAR(5) NOT NULL DEFAULT 'INR',
  type payment_type_enum NOT NULL,
  status payment_status_enum NOT NULL DEFAULT 'created',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX idx_payment_orders_gateway_order_id ON payment_orders(gateway_order_id);

-- GAME ROOMS
CREATE TABLE game_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type game_type_enum NOT NULL,
  status game_status_enum NOT NULL DEFAULT 'waiting',
  min_players INT NOT NULL DEFAULT 2,
  max_players INT NOT NULL DEFAULT 6,
  entry_fee NUMERIC(15,2) NOT NULL DEFAULT 0,
  pot_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  platform_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  platform_fee_collected NUMERIC(15,2) NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_rooms_game_type ON game_rooms(game_type);
CREATE INDEX idx_game_rooms_status ON game_rooms(status);
CREATE INDEX idx_game_rooms_created_at ON game_rooms(created_at DESC);

-- GAME PARTICIPANTS
CREATE TABLE game_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES game_rooms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  seat_number INT NOT NULL,
  entry_fee_deducted NUMERIC(15,2) NOT NULL DEFAULT 0,
  prize_won NUMERIC(15,2) NOT NULL DEFAULT 0,
  final_rank INT,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE(room_id, seat_number),
  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_game_participants_room_id ON game_participants(room_id);
CREATE INDEX idx_game_participants_user_id ON game_participants(user_id);

-- KYC DOCUMENTS
CREATE TABLE kyc_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id),
  doc_type kyc_doc_type_enum,
  doc_number VARCHAR(50),
  s3_front_key TEXT,
  s3_back_key TEXT,
  verified_name TEXT,
  verified_dob DATE,
  provider_response JSONB,
  status kyc_status_enum NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES admin_users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- REFERRALS
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  referee_id UUID UNIQUE NOT NULL REFERENCES users(id),
  status referral_status_enum NOT NULL DEFAULT 'pending',
  reward_amount NUMERIC(15,2) NOT NULL DEFAULT 50.00,
  qualified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referrals_referrer_id ON referrals(referrer_id);

-- BONUSES
CREATE TABLE bonuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  type bonus_type_enum NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  wagering_requirement NUMERIC(15,2) NOT NULL DEFAULT 0,
  wagered_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status bonus_status_enum NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bonuses_user_id ON bonuses(user_id);
CREATE INDEX idx_bonuses_status ON bonuses(status);

-- GAME CONFIGS (editable by admin)
CREATE TABLE game_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_type game_type_enum UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  min_players INT NOT NULL DEFAULT 2,
  max_players INT NOT NULL DEFAULT 6,
  stake_options NUMERIC[] NOT NULL DEFAULT '{10,50,100,500,1000}',
  rake_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  bot_fill_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bot_fill_delay_seconds INT NOT NULL DEFAULT 10,
  max_bot_ratio NUMERIC(3,2) NOT NULL DEFAULT 0.60,
  bot_difficulty VARCHAR(10) NOT NULL DEFAULT 'medium',
  special_rules JSONB NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES admin_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed game configs
INSERT INTO game_configs (game_type, is_active, min_players, max_players, stake_options, rake_percent, bot_fill_enabled)
VALUES
  ('teen_patti', true, 2, 6, '{10,50,100,500,1000}', 5.00, true),
  ('aviator', true, 1, 1, '{10,50,100,500,1000}', 5.00, false),
  ('rummy', false, 2, 6, '{10,50,100,500,1000}', 5.00, true),
  ('ludo', false, 2, 4, '{10,50,100}', 5.00, true),
  ('matka', false, 1, 1, '{10,50,100}', 10.00, false),
  ('lottery', false, 1, 1, '{10,50,100}', 10.00, false);

-- Default admin user (password: Admin@123456 — change immediately in prod)
INSERT INTO admin_users (username, email, password_hash, role)
VALUES ('superadmin', 'admin@teengame.in', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMlJbekRSm9p8zY.9TJnl3WKSK', 'superadmin');
