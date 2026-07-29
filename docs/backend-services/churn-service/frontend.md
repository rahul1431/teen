# Churn Service — Frontend (mobile)

There is no mobile-side surface for this service. A repo-wide search of `mobile/` for `churn` (case-insensitive) returns zero matches — the Flutter app has no screen, API call, model, or even a string constant referencing churn scoring or re-engagement.

This is expected given what the service does: churn scoring and re-engagement are entirely backend/admin-operational concerns. The only player-visible effects of this service are indirect and untraceable from the player's side:
- A wallet credit that would show up in the player's transaction history exactly like any other bonus credit, with no special "re-engagement" labeling visible client-side (fixed 2026-07-29 — this path was previously broken end-to-end, see `docs/backend-services/churn-service/backend.md`).
- A push/in-app notification (`title: 'We miss you! 🎮'`) that would arrive through the same generic notification channel every other push notification uses (`core-api-service`'s `/internal/notifications/send`, surfaced to the app via the existing notifications feature, not anything churn-specific) — also fixed 2026-07-29.

Churn data and controls are exclusively admin-facing — see `docs/backend-services/churn-service/admin.md` for the full API contract and `docs/admin-panel/ml-churn-bot-learning/frontend.md` for the `ChurnTab.tsx` UI it drives.
