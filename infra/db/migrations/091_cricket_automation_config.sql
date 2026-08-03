-- Automatic cricket contest pipeline: tracks daily CricAPI call usage for
-- the new scheduler's budget guard, and seeds the config the scheduler
-- reads for tier pricing/cadence/budget. Merges into special_rules with
-- `||` so it never clobbers an already-configured api_key/api_keys row.
-- NOTE: auto_contests_enabled is seeded false pending business policy decision
-- on prize-pool guarantees and minimum-entry protection for under-filled contests.

BEGIN;

CREATE TABLE IF NOT EXISTS cricket_api_usage (
  usage_date DATE PRIMARY KEY,
  calls_used INT NOT NULL DEFAULT 0
);

UPDATE game_configs
SET special_rules = special_rules || '{
  "auto_contests_enabled": false,
  "match_sync_interval_minutes": 15,
  "api_daily_budget": 300,
  "contest_tiers": [
    { "name": "Bronze", "entry_fee": 49, "max_entries": 500, "prize_pool": 15000,
      "prize_distribution": [
        { "rank_start": 1, "rank_end": 1, "payout": 5000 },
        { "rank_start": 2, "rank_end": 3, "payout": 1500 },
        { "rank_start": 4, "rank_end": 10, "payout": 500 },
        { "rank_start": 11, "rank_end": 100, "payout": 50 }
      ] },
    { "name": "Silver", "entry_fee": 99, "max_entries": 300, "prize_pool": 18000,
      "prize_distribution": [
        { "rank_start": 1, "rank_end": 1, "payout": 8000 },
        { "rank_start": 2, "rank_end": 3, "payout": 2000 },
        { "rank_start": 4, "rank_end": 10, "payout": 600 },
        { "rank_start": 11, "rank_end": 45, "payout": 60 }
      ] },
    { "name": "Gold", "entry_fee": 149, "max_entries": 150, "prize_pool": 15000,
      "prize_distribution": [
        { "rank_start": 1, "rank_end": 1, "payout": 6000 },
        { "rank_start": 2, "rank_end": 3, "payout": 2000 },
        { "rank_start": 4, "rank_end": 10, "payout": 500 },
        { "rank_start": 11, "rank_end": 15, "payout": 100 }
      ] }
  ]
}'::jsonb
WHERE game_type = 'cricket';

COMMIT;

-- ========== DOWN: Rollback (for manual rollback) ==========
-- DROP TABLE IF EXISTS cricket_api_usage CASCADE;
-- UPDATE game_configs SET special_rules = special_rules - 'auto_contests_enabled' - 'match_sync_interval_minutes' - 'api_daily_budget' - 'contest_tiers' WHERE game_type = 'cricket';
