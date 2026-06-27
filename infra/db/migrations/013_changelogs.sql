-- Migration 013: Add changelogs table for release notes
CREATE TABLE IF NOT EXISTS changelogs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version VARCHAR(50) NOT NULL,
  platform VARCHAR(20) NOT NULL, -- 'mobile' | 'admin' | 'server'
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  released_by VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial major releases
INSERT INTO changelogs (version, platform, title, description, released_by) VALUES
('1.0.0', 'mobile', 'Initial Launch', 'Launch of the MyOnlineJoker mobile app with multiplayer Teen Patti game tables and real-time cashout Aviator game.', 'system'),
('1.0.0', 'admin', 'Admin Dashboard Launch', 'Launch of the administrative cockpit featuring user management, finance/withdrawals, bot controls, and risk center.', 'system'),
('1.1.0', 'server', 'Sports betting integration', 'Deploys Matka lottery, Satta Matka markets, lottery draws, and Cricket sports betting backend services.', 'system'),
('1.1.0', 'mobile', 'Lottery & Matka Play', 'Enables betting on Matka markets, Lottery tickets, and live Cricket matches directly from the mobile app.', 'system'),
('1.2.0', 'admin', 'Cricket Sessions & Security Logs', 'Upgrades admin panel with Cricket Session (Fancy bet) creation/settlement, a Leaderboard standings view, and global admin action audit logs.', 'superadmin');
