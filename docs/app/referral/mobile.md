# Referral — Mobile (Flutter)

`lib/features/referral/referral_page.dart`. Single call: `GET /api/users/referrals/my-stats`, returning `referral_code`, `referral_link`, aggregate `stats`, and the full `referrals` list in one payload.

- Copy code / copy link via `Clipboard`; "Share Now" opens the native share sheet (`share_plus`) with a pre-filled message including the code and link.
- Each referral row maps its `status` to one of three chips: `rewarded` → green "Rewarded" + the `+₹<reward_amount>` credited amount, `qualified` → blue "Deposited", anything else → orange "Pending". In practice the backend never leaves a row in `qualified` for long — see `backend.md` — so the blue "Deposited" state is effectively unreachable/momentary.
- Step 4 of "How It Works" used to read "Bonus is instantly credited to your real balance!", which was incorrect — the backend always credits referral rewards to the **bonus** (non-withdrawable) wallet, never the real balance. Copy corrected to say "bonus balance" (fixed 2026-07-29).
