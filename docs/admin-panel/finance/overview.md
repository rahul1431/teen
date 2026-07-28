# Finance — Overview

The largest admin page (821 lines) — 7 tabs covering the platform's entire money-movement surface:

1. **Withdrawals** — approve (mark `paid`, requires UTR reference) / reject (mark `refunded`, requires reason) / revert-to-pending pending withdrawal requests. The status transitions here used to be able to silently diverge from actual wallet state on a wallet-service failure — fixed 2026-07-28, a failed money movement now aborts the transition with a clear error instead of the DB/audit-log/notification all claiming success.
2. **Deposits** — reconcile stuck/manual deposits (credit wallet + mark paid, or mark failed), filterable by gateway (Razorpay vs. manual) and status. **Same unchecked-wallet-call issue as withdrawals, with worse ordering — see the same Bugs entry.**
3. **Bank Details** — verify/unverify user-submitted bank accounts (masked account number display) for withdrawal eligibility.
4. **Payment Methods** — the UPI/bank/QR destinations shown to users for manual deposits, with per-method min/max limits and active toggle.
5. **Dealer Tips** — read-only view of Teen Patti "tip the dealer" revenue (today/week/all-time + recent list).
6. **Ledger** — a global, filterable view over every `wallet_transactions` row platform-wide (by type, wallet, user ID).
7. **Reconciliation** — GGR (gross gaming revenue / rake) trend and deposits-vs-withdrawals volume, both rendered with hand-rolled SVG charts (same `SVGLineChart` pattern as the Dashboard, plus a bar-chart variant here), over a selectable 1/7/30/90-day window.

Headline stats (revenue today/month, deposits/withdrawals today) load once on mount from `/finance/stats`, not polled.
