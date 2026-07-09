-- Migration: Support Knowledge Base Articles

CREATE TABLE IF NOT EXISTS support_kb_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'general',
  content_md TEXT NOT NULL,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_kb_category ON support_kb_articles(category);

-- Seed initial articles
INSERT INTO support_kb_articles (title, category, content_md) VALUES
  ('Manual UPI Deposit Troubleshooting', 'deposits', '# Manual UPI Deposit Troubleshooting

When a player deposits using manual UPI but doesn''t receive credits:

1. Ask the player for the **12-digit UTR/Reference number** and a screenshot of the payment receipt.
2. In the Admin Panel, navigate to **Finance -> Deposits**.
3. Search for the player''s transaction by username, amount, or reference number.
4. Cross-reference the UTR number with your bank ledger.
5. If the payment was received, click **Verify/Approve** to credit the user''s wallet manually.'),
  ('KYC Verification Rejection Rules', 'kyc', '# KYC Verification Rejection Rules

Always reject KYC documents if they fail the following criteria:

* **Blurry Images**: If the text or face on PAN/Aadhaar is unreadable.
* **Name Mismatch**: The name on the KYC document MUST match the bank account holder name.
* **Underage Users**: Verify that the birth year indicates the user is at least 18 years old.
* **Cropped/Modified ID**: If the edges of the card are cut off or it looks digitally altered.

*Provide a clear rejection reason to the user when rejecting so they can re-upload correctly.*'),
  ('Teen Patti Game Rules & Settlement', 'game_rules', '# Teen Patti Game Rules & Settlement

Here is how Teen Patti hands are ranked from highest to lowest:

1. **Trail / Trio (Three of a Kind)**: Three cards of the same rank (e.g., A-A-A is the highest, 2-2-2 is the lowest).
2. **Pure Sequence (Straight Flush)**: Three consecutive cards of the same suit (e.g., A-2-3 of hearts, K-Q-J of spades).
3. **Sequence (Straight)**: Three consecutive cards of different suits (e.g., A-2-3, 5-6-7).
4. **Color (Flush)**: Three cards of the same suit, not in sequence.
5. **Pair (Two of a Kind)**: Two cards of the same rank (e.g., A-A-K).
6. **High Card**: The highest single card if no other hand is made.')
ON CONFLICT DO NOTHING;
