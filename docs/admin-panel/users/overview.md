# Users — Overview

The player (non-bot) account management page. A searchable/filterable table (username/phone search, status filter) backed by `GET /users` with pagination, plus a per-user detail modal with 6 tabs: Profile, Transactions, KYC, Game History, Notes, Audit Log.

Core admin actions from this page: suspend/activate account, credit/debit real-money wallet, reset password (admin-generated temp password, not OTP-based like the player-facing flow), approve/reject/review KYC, add internal notes (optionally flagged as high-priority, visible to all admins), and view the admin-audit trail for that specific user.

`is_bot: false` is hardcoded into every list query — bot accounts never show up here (they're managed separately in Bot Management).
