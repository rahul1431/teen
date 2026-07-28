# Banners (Home Banners) — Overview

The real, live-consumed hero-banner carousel shown on the mobile app's home screen (`core-api-service`'s `GET /users/banners` serves `home_banners` to the app). Superadmin-only CRUD: title/subtitle, image upload, click URL + click type (in-app route / external URL / not clickable), sort order, active toggle.

Not to be confused with the Support page's "Banners" CMS tab (`docs/admin-panel/support/`) — a completely separate, unrelated, and currently-unconsumed banner system with a different schema (placement/priority/CTA/date-window) and different backend table (`cms_banners` vs. this page's `home_banners`).

The Active toggle switch used to silently delete the banner's `click_url` every time it was used — fixed 2026-07-28 (`click_url` now falls back to its existing value like every other field on this route when a partial-body request omits it).
