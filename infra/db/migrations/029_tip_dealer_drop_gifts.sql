-- Migration 029: Teen Patti tip-the-dealer + gift feature removal
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
-- older Postgres versions; run this statement on its own.
ALTER TYPE txn_type_enum ADD VALUE IF NOT EXISTS 'tip_dealer';

-- Gift feature is fully removed (app, gateway, admin panel, admin API).
DROP TABLE IF EXISTS game_gifts;
