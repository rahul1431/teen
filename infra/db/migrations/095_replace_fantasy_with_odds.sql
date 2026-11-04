DO $$
BEGIN
    -- Check if cricket_markets exists, if not, rename archived_cricket_markets
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_markets') THEN
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'archived_cricket_markets') THEN
            ALTER TABLE archived_cricket_markets RENAME TO cricket_markets;
        END IF;
    END IF;

    -- Check if cricket_bets exists, if not, rename archived_cricket_bets
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_bets') THEN
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'archived_cricket_bets') THEN
            ALTER TABLE archived_cricket_bets RENAME TO cricket_bets;
        END IF;
    END IF;

    -- Archive fantasy tables safely
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_fantasy_teams') THEN
        ALTER TABLE cricket_fantasy_teams RENAME TO archived_cricket_fantasy_teams;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_fantasy_leagues') THEN
        ALTER TABLE cricket_fantasy_leagues RENAME TO archived_cricket_fantasy_leagues;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_league_participants') THEN
        ALTER TABLE cricket_league_participants RENAME TO archived_cricket_league_participants;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_player_profiles') THEN
        ALTER TABLE cricket_player_profiles RENAME TO archived_cricket_player_profiles;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_countries') THEN
        ALTER TABLE cricket_countries RENAME TO archived_cricket_countries;
    END IF;
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cricket_api_usage') THEN
        ALTER TABLE cricket_api_usage RENAME TO archived_cricket_api_usage;
    END IF;

    -- Add unique constraint if not already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_cricket_markets_match_type'
    ) THEN
        ALTER TABLE cricket_markets ADD CONSTRAINT uq_cricket_markets_match_type UNIQUE (match_id, market_type);
    END IF;
END $$;
