-- 118_app_popups_page_delay_action.sql
ALTER TABLE app_popups
  ADD COLUMN IF NOT EXISTS target_page VARCHAR(100) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS delay_seconds INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS action_type VARCHAR(50) NOT NULL DEFAULT 'navigate';

COMMENT ON COLUMN app_popups.target_page IS 'Where to show popup: all, home, wallet, games, agent_dashboard, etc.';
COMMENT ON COLUMN app_popups.delay_seconds IS 'Delay in seconds after page load before showing popup';
COMMENT ON COLUMN app_popups.action_type IS 'Action on button click: navigate, claim_bonus, join_game, external_link, close';
