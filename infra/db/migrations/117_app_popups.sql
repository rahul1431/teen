-- Migration: 117_app_popups.sql
-- Description: Dynamic announcement and promotional popups for Player App, Agent App, and Web Portals.
-- Controlled directly via Admin Panel (Marketing -> App Popups).

CREATE TABLE IF NOT EXISTS app_popups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(255) NOT NULL,
  body            TEXT,
  image_url       TEXT,
  button_text     VARCHAR(100),
  button_link     TEXT,
  target_audience VARCHAR(50) NOT NULL DEFAULT 'all', -- 'all', 'player', 'agent'
  display_type    VARCHAR(50) NOT NULL DEFAULT 'modal', -- 'modal', 'bottom_sheet'
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_popups_target_active ON app_popups(target_audience, is_active, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_app_popups_created ON app_popups(created_at DESC);

