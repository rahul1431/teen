-- Migration: Seed More Knowledge Base Articles & Troubleshooting FAQs

INSERT INTO support_kb_articles (title, category, content_md) VALUES
  ('Withdrawal Requests Processing & Holds', 'deposits', '# Withdrawal Requests Processing & Holds

When processing withdrawal requests, customer support should adhere to the following checks:

### 1. Verification Checklist
* **Wallet Check**: Ensure the player has enough balance in their **Real Wallet** (withdrawable balance).
* **KYC Status**: Never approve withdrawals if the user''s KYC is not marked as **Approved**.
* **Bank Details**: Verify that the account number and IFSC code look valid and match the name verified during KYC.

### 2. Auto-Flag Risk Holds
Hold or reject the withdrawal if:
* **No Playthrough**: The user deposited money and immediately requested a withdrawal without wagering at least 50% of the deposit amount (Anti-Money Laundering compliance).
* **Collusion Alert**: The risk dashboard shows matches in device fingerprint or IP addresses with other active accounts.

*Always set the status to "Failed" or "Hold" and leave an internal admin note when holding transactions.*'),

  ('Account Suspension & Appeal Handling', 'kyc', '# Account Suspension & Appeal Handling

If a player is suspended due to fraud or violating platform terms, follow this guide to handle appeals.

### 1. Common Suspension Triggers
* **Multiple Accounts**: Operating more than one account on the same device.
* **Chargebacks / Fraudulent Transactions**: Reported by payment gateways.
* **Chip Dumping**: Intentionally losing hands in Teen Patti to transfer chips to a friend.

### 2. Handling Appeals
When a user contacts support to unban their account:
1. Review the **Risk Center** history for the player.
2. Ask the player to send a **Self-Declaration Video** holding their ID card, stating: *"I verify that I own account [Username] and I will play fairly."*
3. If cleared by the operations manager, navigate to **User Management -> Players**, select the user, and change status from **suspended** to **active**. Add a note in user history.'),

  ('Ludo Rules & Disconnection Policies', 'game_rules', '# Ludo Rules & Disconnection Policies

Ludo matches are automated and real-time. Support teams should refer to this guide when players report game issues.

### 1. Base Gameplay Rules
* Each player has 4 tokens. Rolling a 6 allows bringing a token out of the yard.
* Rolling a 6 awards an extra turn. Rolling three consecutive 6s skips the turn.
* Standard safe zones apply (start cells and star cells). Tokens cannot be captured on safe zones.

### 2. Disconnection & Autoplay
* **Turn Timer**: A player has 15 seconds to roll the dice and move.
* **Missed Turns**: If a player misses 3 turns consecutively (due to connection loss or inactivity), the system activates **Autoplay Mode**.
* **Autoplay Mechanics**: The AI automatically rolls and moves the closest token.
* **Rake Fee**: A 5% platform rake is deducted from the winner''s pot before payout. Refund requests for self-disconnection are not entertained.'),

  ('Aviator House Edge & Multiplier Settings', 'game_rules', '# Aviator House Edge & Multiplier Settings

Aviator is a crash multiplier game. Support must understand its configuration parameters to address player queries.

### 1. Provably Fair Math
The game runs on a cryptographic RNG curve. The crash multiplier is calculated as:
`Multiplier = 0.97 / (1 - r)` (where `r` is a random float between 0 and 1).

### 2. House Edge Configuration
* The platform reserves a **3% default house edge** (represented by the `0.97` factor).
* In 3% of rounds, the game will crash instantly at `1.00x`. This is mathematically normal and ensures platform profitability.
* Admins can adjust the house edge factor up to **10%** in the config dashboard.

### 3. Maximum Limit
The system stops the multiplier rise automatically at **10,000x** to prevent runaway platform liabilities. Any player who did not cash out before that point is paid out at 10,000x.'),

  ('WebSocket Connection Drop Checklist', 'technical', '# WebSocket Connection Drop Checklist

When players report stuck spinners, connection dropouts, or game lagging, guide them through this checklist.

### 1. Client-Side Diagnostics
Ask the user to:
1. **Toggle Connection**: Switch from Mobile Data to Wi-Fi (or vice-versa) to refresh IP routing.
2. **Clear Cache**: In App Settings, clear the MyOnlineJoker cache.
3. **Check Ping**: If the ping latency is above **300ms**, real-time WebSocket state updates might drop.

### 2. Server-Side Diagnostics (Devops Escalate)
If multiple players report connection dropouts simultaneously:
1. Check the Game Gateway server status: `pm2 status teen-gateway`.
2. Inspect gateway console logs for memory usage or client crash leaks: `pm2 logs teen-gateway --lines 100`.
3. Check Redis pub-sub capacity: `redis-cli ping`.'),

  ('Anti-Money Laundering & Fraud Prevention Rules', 'general', '# Anti-Money Laundering & Fraud Prevention Rules

Platform compliance rules require support teams to actively monitor for suspicious financial behavior.

### 1. Mandatory Rules
* **No Direct Transfer**: Players are strictly prohibited from depositing money and requesting withdrawals without playing games.
* **Minimum Turnaround**: A deposit must be held for at least **24 hours** before it can be withdrawn.
* **KYC Tier-2**: Users with single-day deposits exceeding ₹50,000 must undergo Tier-2 manual address verification (Aadhaar back verification).

### 2. Report Suspected Fraud
Flag to the compliance department immediately if you notice:
* Single user using multiple bank accounts with different names.
* Frequent withdrawals under ₹500 occurring in rapid succession (automated script behavior).')
ON CONFLICT (title) DO NOTHING;
