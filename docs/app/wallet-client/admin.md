# Wallet Client — Admin-panel touchpoints

Fully covered by `docs/admin-panel/finance/` — Deposits and Withdrawals tabs are where every `payment_orders` row this client creates gets approved/rejected/paid, and Payment Methods is what populates the deposit sheet's method chips. A failed wallet-service call during withdrawal approval used to be able to still mark the request "paid" (affecting the `locked_balance` this client's withdraw flow creates) — fixed 2026-07-28.
