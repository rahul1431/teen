-- Migration: SEO & Marketing Configuration

-- 1. Extend CMS Pages with SEO fields
ALTER TABLE cms_pages
ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS meta_description TEXT,
ADD COLUMN IF NOT EXISTS meta_keywords TEXT,
ADD COLUMN IF NOT EXISTS og_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS og_description TEXT,
ADD COLUMN IF NOT EXISTS og_image TEXT;

-- 2. Create Global SEO settings table
CREATE TABLE IF NOT EXISTS seo_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL
);

-- 3. Create Marketing Campaigns tracking table
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  utm_source VARCHAR(50) NOT NULL,
  utm_medium VARCHAR(50),
  utm_campaign VARCHAR(50),
  clicks INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_utm ON marketing_campaigns(utm_source, utm_medium, utm_campaign);

-- 4. Create User Campaign Attribution table
CREATE TABLE IF NOT EXISTS user_campaign_attribution (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  utm_source VARCHAR(50),
  utm_medium VARCHAR(50),
  utm_campaign VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uca_campaign ON user_campaign_attribution(campaign_id);

-- 5. Seed default Global SEO settings
INSERT INTO seo_settings (key, value) VALUES
  ('global_title', 'MyOnlineJoker - Play Teen Patti, Ludo, Aviator & Win Real Money'),
  ('global_description', 'Play card games, board games, and crash games on MyOnlineJoker. Earn sign up bonus, refer friends and win real cash daily.'),
  ('global_keywords', 'teen patti, ludo, aviator, earn money, cash games, rummy, online lottery'),
  ('robots_txt', 'User-agent: *' || CHR(10) || 'Allow: /' || CHR(10) || 'Sitemap: https://myonlinejoker.com/sitemap.xml'),
  ('google_analytics_id', 'G-XXXXXXXXXX'),
  ('facebook_pixel_id', 'FB-XXXXXXXXXX'),
  ('custom_header_html', '')
ON CONFLICT (key) DO NOTHING;
