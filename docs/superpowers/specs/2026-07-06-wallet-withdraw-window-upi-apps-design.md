# Wallet: Withdrawal Window UI + UPI App Deep Links — Design

Date: 2026-07-06
Status: Approved by Rahul

## 1. Withdrawal window 10 AM – 9 PM (UI only)

In the Withdraw sheet (`mobile/lib/features/wallet/wallet_page.dart`):
- Helper text: "Min ₹100 · KYC required · Withdrawals 10 AM – 9 PM".
- Outside 10:00–21:00 device local time: orange banner "Withdrawals are open
  10 AM to 9 PM. Please come back later." and the Request Withdrawal button
  is disabled. No server-side enforcement; admin panel untouched.

## 2. Add Money — PhonePe / Google Pay / Paytm

In the deposit sheet, when the selected method is `upi`, show three branded
buttons. Tapping one launches the app with a UPI intent URI built from the
admin-configured method: `pa=<upi_id>`, `pn=<account_name|label>`,
`am=<typed amount>`, `cu=INR`, `tn=Add Money`.

- Schemes: PhonePe `phonepe://pay`, Google Pay `tez://upi/pay`,
  Paytm `paytmmp://pay`; fallback to generic `upi://pay` chooser; toast
  "App not installed" if nothing resolves.
- Amount ≥ ₹1 required before launching (UPI apps need `am` to be
  ready-to-pay).
- Rest of the flow unchanged (pay externally → UTR + screenshot → approval).
- `AndroidManifest.xml` gains a `<queries>` block for the four schemes
  (Android 11+ package visibility).

Known limitation: PhonePe/GPay may warn on or decline intent payments to
personal (non-merchant) VPAs — app-side policy; generic UPI fallback applies.
