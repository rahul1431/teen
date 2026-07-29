# Finance — Admin/RBAC notes

Almost everything on this page requires the `finance` role backend-side; deleting a payment method is bumped to `superadmin`. No client-side role hiding — same pattern as Users/Bots, a non-`finance` admin would see all the tabs and controls and only hit 403s on action.

This is the single highest financial-risk page in the admin panel. Withdrawal status transitions used to be able to silently diverge from actual wallet state on a wallet-service failure — fixed 2026-07-28, every wallet-service call in the withdrawal state machine now aborts the status transition with a clear error if the money movement didn't actually succeed (the deposit-reconciliation handler already had this fix).
