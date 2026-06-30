-- Hero banners (admin-configurable home page banners)
CREATE TABLE IF NOT EXISTS home_banners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(200),
  subtitle      VARCHAR(300),
  image_url     TEXT NOT NULL,
  click_url     TEXT,
  click_type    VARCHAR(20) NOT NULL DEFAULT 'url' CHECK (click_type IN ('url','route','none')),
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Promo codes
CREATE TABLE IF NOT EXISTS promo_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(50) NOT NULL UNIQUE,
  description     VARCHAR(300),
  discount_type   VARCHAR(10) NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed','percent')),
  discount_value  NUMERIC(10,2) NOT NULL,
  min_deposit     NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount    NUMERIC(10,2),
  usage_limit     INT,
  used_count      INT NOT NULL DEFAULT 0,
  per_user_limit  INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

-- Track who used what promo code
CREATE TABLE IF NOT EXISTS promo_code_usages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id    UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deposit_id  UUID,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(promo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_usages_user ON promo_code_usages(user_id);
