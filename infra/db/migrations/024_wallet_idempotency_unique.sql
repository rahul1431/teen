-- Add UNIQUE constraint on wallet_transactions.idempotency_key
-- Required for ON CONFLICT (idempotency_key) DO NOTHING to work atomically.
-- Previously idempotency was checked with a SELECT first (race condition).
-- This migration is idempotent — safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallet_transactions_idempotency_key_unique'
      AND conrelid = 'wallet_transactions'::regclass
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_idempotency_key_unique
      UNIQUE (idempotency_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency_key
  ON wallet_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
