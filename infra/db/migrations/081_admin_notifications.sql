-- Admin notification bell: table + AFTER INSERT triggers on the source tables
-- that generate admin-facing events (deposits, withdrawals, new users,
-- support tickets, KYC submissions, large wins). Triggers live entirely in
-- this migration so no source service (wallet-service, core-api-service,
-- bot-learning-service, game engines) needs any code change.

CREATE TABLE admin_notifications (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  target_role TEXT NOT NULL,
  ref_table TEXT,
  ref_id TEXT,
  read_by JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_notifications_role_created ON admin_notifications (target_role, created_at DESC);

-- Deposit requests
CREATE OR REPLACE FUNCTION trg_notify_new_deposit() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.type = 'deposit' THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('deposit', 'New Deposit Request', 'A deposit of ₹' || NEW.amount || ' is awaiting review.', 'info', 'finance', 'payment_orders', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_orders_deposit
  AFTER INSERT ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_deposit();

CREATE OR REPLACE FUNCTION trg_notify_new_withdrawal() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.type = 'withdrawal' THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('withdrawal', 'New Withdrawal Request', 'A withdrawal of ₹' || NEW.amount || ' is awaiting review.', 'info', 'finance', 'payment_orders', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_orders_withdrawal
  AFTER INSERT ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_withdrawal();

CREATE OR REPLACE FUNCTION trg_notify_new_user() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
  VALUES ('new_user', 'New User Registered', COALESCE(NEW.username, NEW.phone, 'A new user') || ' just signed up.', 'info', 'support', 'users', NEW.id::text)
  RETURNING id INTO notif_id;
  PERFORM pg_notify('admin_events', notif_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_new
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_user();

CREATE OR REPLACE FUNCTION trg_notify_new_ticket() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
  VALUES ('ticket', 'New Support Ticket', COALESCE(NEW.subject, 'A new ticket'), 'info', 'support', 'support_tickets', NEW.id::text)
  RETURNING id INTO notif_id;
  PERFORM pg_notify('admin_events', notif_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_support_tickets_new
  AFTER INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_ticket();

CREATE OR REPLACE FUNCTION trg_notify_new_kyc() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.status = 'under_review' THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('kyc', 'KYC Document Submitted', 'A ' || NEW.doc_type || ' document is awaiting review.', 'info', 'support', 'kyc_documents', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kyc_documents_new
  AFTER INSERT ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION trg_notify_new_kyc();

-- Large wins: wallet_transactions.type has no 'win' value in txn_type_enum
-- (values are deposit/withdrawal/game_credit/game_debit/bonus/referral/
-- transfer/manual_credit/manual_debit/tip_dealer). Wins are credited to the
-- wallet with type='game_credit' (see services/wallet-service/src/wallet.service.ts,
-- TxnType union + the total_won update on 'game_credit'). Using the literal
-- 'win' here would make every txn_type_enum comparison against it raise
-- "invalid input value for enum txn_type_enum" on EVERY wallet_transactions
-- insert across all services (wallet-service, game engines, etc.), so this
-- trigger would break wallet writes cluster-wide. Using 'game_credit' instead.
CREATE OR REPLACE FUNCTION trg_notify_large_win() RETURNS TRIGGER AS $$
DECLARE
  notif_id BIGINT;
BEGIN
  IF NEW.type = 'game_credit' AND NEW.amount >= 5000 THEN
    INSERT INTO admin_notifications (type, title, body, severity, target_role, ref_table, ref_id)
    VALUES ('large_win', 'Large Win Detected', 'A payout of ₹' || NEW.amount || ' was just credited.', 'warning', 'finance', 'wallet_transactions', NEW.id::text)
    RETURNING id INTO notif_id;
    PERFORM pg_notify('admin_events', notif_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_transactions_large_win
  AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_notify_large_win();
