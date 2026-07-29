-- device_fingerprints (013_fraud_detection.sql) has never had anything write
-- to it — no unique constraint exists on (user_id, fingerprint) because
-- nothing needed one. core-api-service's /auth/login and /auth/register now
-- upsert a row per sighting via ON CONFLICT (user_id, fingerprint), which
-- requires this constraint to target. See
-- docs/Bugs/device-fingerprint-never-collected.md.
--
-- Idempotent — safe to run multiple times.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'device_fingerprints_user_id_fingerprint_key'
      AND conrelid = 'device_fingerprints'::regclass
  ) THEN
    ALTER TABLE device_fingerprints
      ADD CONSTRAINT device_fingerprints_user_id_fingerprint_key
      UNIQUE (user_id, fingerprint);
  END IF;
END $$;
