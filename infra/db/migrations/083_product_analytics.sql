-- Product analytics: event tracking + feature flags, built on existing
-- infrastructure instead of adopting PostHog (self-hosting its ClickHouse
-- stack was ruled out as too heavy for this VPS). See
-- docs/superpowers/specs/2026-07-21-product-analytics-design.md

CREATE TABLE product_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  event_name    TEXT NOT NULL,
  properties    JSONB NOT NULL DEFAULT '{}',
  source        TEXT NOT NULL CHECK (source IN ('mobile', 'admin_panel')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_events_name_created ON product_events(event_name, created_at);
CREATE INDEX idx_product_events_user_id ON product_events(user_id);
CREATE INDEX idx_product_events_created_at ON product_events(created_at);

CREATE TABLE feature_flags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key               VARCHAR(100) UNIQUE NOT NULL,
  description       TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percent   INT NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  enabled_user_ids  UUID[] NOT NULL DEFAULT '{}',
  variants          JSONB,
  created_by        UUID NOT NULL REFERENCES admin_users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
