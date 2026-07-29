-- Records every hit of the /join?ref=CODE referral landing page. No IP/UA/
-- device data — a click is just "this ref code was hit at this time," by
-- design (see docs/superpowers/specs/2026-07-22-agent-referral-management-design.md).
-- Logged for any ref code (agent or regular user) indiscriminately; readers
-- filter by the ref_code they care about.
CREATE TABLE referral_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code VARCHAR(20) NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_referral_clicks_ref_code ON referral_clicks(ref_code);
