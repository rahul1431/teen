# Withdrawal — Overview

Withdrawals are a two-phase, admin-mediated process: the player requests one (funds are immediately moved to `locked_balance`, not yet paid out), and an admin approves or rejects it, at which point money is actually paid out **outside the platform** (a manual bank/UPI transfer the admin performs themselves) and the order is marked accordingly.

1. Player requests a withdrawal (`POST /wallet/withdraw/request`, ₹100–₹50,000). Requires `kyc_status = 'approved'`. In one transaction: row-locks the wallet, checks `real_balance >= amount`, moves the amount `real_balance → locked_balance`, creates a `payment_orders` row (`type='withdrawal'`, `status='created'`).
2. An admin reviews it on the Finance → Withdrawals tab and transitions its status: **approve** (`paid` — consumes the locked funds, i.e. the house now considers that money spent/paid out) or **reject** (`refunded` — unlocks the funds back to `real_balance`). The admin can also revert between any of the three states (`created`/`paid`/`refunded`), a 6-way state machine (`PATCH /api/admin/finance/withdrawals/:id`).
3. On approval, the admin manually pays the player via bank transfer/UPI **outside this system** and records a reference/UTR string on the order — there is no integration with any actual payout API.

## Where this is weaker than it looks

- **The 10 AM–9 PM withdrawal window is client-side only** (`docs/Bugs/withdrawal-hours-restriction-is-client-side-only.md`) — the backend accepts a withdrawal request at any hour.
- **Wallet-service call failures during admin approval used to be silently ignored** — fixed 2026-07-28: the admin panel now aborts the status transition with a clear error if the underlying wallet-service call that was supposed to move the money failed, instead of reporting "paid"/"refunded" success and notifying the user anyway.

## What to read next

- `backend.md` — the request route and all 6 admin state-machine transitions.
- `frontend.md` — the mobile withdraw sheet and bank-details page.
- `admin.md` — the Finance Withdrawals and Bank Details tabs.
