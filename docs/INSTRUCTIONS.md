# Docs Instructions — where to look for what

This repo's `docs/` tree has two kinds of files: **feature docs** (how something works, written from reading the code) and **bug reports** (`docs/Bugs/`, specific defects found during the documentation passes). This file is the index — start here.

## Folder structure

| Folder | Covers | File pattern per topic |
|---|---|---|
| `docs/games/<game>/` | Gameplay logic per game (teen-patti, aviator, ludo, matka, lottery, cricket, rummy-planned) | `overview.md`, `backend.md`, `mobile.md`, `admin.md` |
| `docs/payments/<feature>/` | Cross-cutting money-movement views (deposit, withdrawal, wallet-ledger, razorpay-integration) | `overview.md`, `backend.md`, `frontend.md`, `admin.md` |
| `docs/backend-services/<service>/` | Per-microservice deep dive (matches `services/*`) | `overview.md`, `backend.md`, `frontend.md`, `admin.md` |
| `docs/admin-panel/<page>/` | Per-admin-panel-page deep dive (matches `admin-panel/src/pages/*.tsx`) | `overview.md`, `backend.md`, `frontend.md`, `admin.md` |
| `docs/app/<feature>/` | Per-mobile-feature deep dive (matches `mobile/lib/features/*` + core cross-cutting concerns) | `overview.md`, `backend.md`, `mobile.md`, `admin.md` |
| `docs/infra/` | Deploy pipeline, nginx, PM2, DB migrations | one file per topic, no subfolders |
| `docs/Bugs/` | Every specific defect found — one file per bug, self-contained (severity, files, what's wrong, impact, fix) | flat, no subfolders |
| `docs/ops/*.local.md` | **Gitignored.** Local-only operational notes (credentials, access info) that must never be committed. See `docs/ops/vps-access.local.md`. |

Every topic folder (except `docs/infra/`) has exactly 4 files: an `overview.md` (read this first), then `backend.md`/`frontend.md`/`mobile.md` (implementation detail for that layer), then `admin.md` (how it surfaces in the admin panel / RBAC notes). If you only have one question, `overview.md` usually answers it or points at the right deeper file.

## "I have issue X, which file do I check?" — bug index by area

### Payments / Wallet / KYC
- `docs/Bugs/entry-fee-deducted-update-silently-swallowed.md`
- `docs/Bugs/kyc-file-proxy-no-role-gate.md`
- `docs/Bugs/kyc-review-endpoint-skips-audit-log-and-notification.md`
- `docs/Bugs/leaderboard-top3-reward-never-paid.md`
- `docs/Bugs/wallet-service-deposit-withdrawal-limit-env-vars-are-dead-config.md`
- `docs/Bugs/withdrawal-hours-restriction-is-client-side-only.md`
- `docs/Bugs/daily-bonus-claim-reports-success-even-if-wallet-credit-fails.md`
- `docs/Bugs/daily-bonus-remove-day-does-not-persist.md`
- → background: `docs/payments/*/overview.md`, `docs/backend-services/wallet-service/*.md`, `docs/admin-panel/finance/*.md`

### Teen Patti
- `docs/Bugs/teen-patti-dda-admin-control-gap.md`
- `docs/Bugs/teen-patti-dda-hard-fallback-100-percent.md`
- `docs/Bugs/teen-patti-emoji-config-shared-across-games.md`
- `docs/Bugs/teen-patti-engine-no-auth-or-turn-enforcement.md`
- `docs/Bugs/teen-patti-engine-url-env-example-broken.md`
- `docs/Bugs/teen-patti-lobby-fee-percent-hardcoded.md`
- `docs/Bugs/teen-patti-no-turn-timeout.md`
- `docs/Bugs/teen-patti-unbounded-raise-forces-bot-fold.md`
- → background: `docs/games/teen-patti/*.md`, `docs/backend-services/teen-patti-engine/*.md`

### Ludo
- `docs/Bugs/ludo-client-afk-countdown-mismatched-duration.md`
- `docs/Bugs/ludo-preferred-seat-color-selection-ignored-by-server.md`
- `docs/Bugs/ludo-turn-timeout-config-not-wired.md`
- → background: `docs/games/ludo/*.md`

### Aviator
- `docs/Bugs/aviator-mobile-betting-progress-bar-hardcoded-5s.md`
- `docs/Bugs/aviator-restart-recovery-discards-confirmed-cashout-winnings.md`
- → background: `docs/games/aviator/*.md`

### Cricket / Lottery / Matka (betting games in `core-api-service`)
- `docs/Bugs/betting-mobile-routes-missing-on-backend.md`
- `docs/Bugs/cricket-admin-series-import-routes-missing.md`
- `docs/Bugs/cricket-fantasy-roster-validation-mismatch.md`
- `docs/Bugs/cricket-live-fantasy-points-never-update.md`
- `docs/Bugs/cricket-my-contests-tab-joined-field-mismatch.md`
- `docs/Bugs/hardcoded-cricapi-fallback-key.md`
- `docs/Bugs/lottery-admin-config-panel-not-wired-to-gameplay.md`
- `docs/Bugs/lottery-mobile-category-tiers-schema-mismatch.md`
- `docs/Bugs/lottery-ticket-digits-limit-not-enforced.md`
- `docs/Bugs/matka-close-declared-before-open-corrupts-jodi.md`
- `docs/Bugs/matka-game-config-rake-and-active-toggle-not-enforced.md`
- `docs/Bugs/matka-sangam-bet-type-not-supported-by-backend.md`
- → background: `docs/games/{cricket,lottery,matka}/*.md`, `docs/backend-services/core-api-service/*.md`

### Matchmaking / game-gateway / bots
- `docs/Bugs/config-reload-dead-feature.md`
- `docs/Bugs/game-events-table-has-no-retention-cleanup.md`
- `docs/Bugs/bots-page-fake-personality-skill.md`
- `docs/Bugs/bot-learning-service-builds-dead-aviator-bot-profiles.md`
- `docs/Bugs/bot-learning-service-no-authentication.md`
- → background: `docs/backend-services/game-gateway/*.md`, `docs/backend-services/bot-learning-service/*.md`, `docs/admin-panel/bots/*.md`

### Admin panel / RBAC / auth / security
- `docs/Bugs/admin-deactivation-does-not-revoke-active-sessions.md`
- `docs/Bugs/admin-panel-no-401-session-expiry-handling.md`
- `docs/Bugs/ai-control-center-churn-prediction-config-unused.md`
- `docs/Bugs/ai-control-center-missing-role-gates.md`
- `docs/Bugs/ai-control-center-refresh-button-partial.md`
- `docs/Bugs/ai-workflow-dashboard-hardcoded-model-jobs.md`
- `docs/Bugs/audit-log-ip-address-never-recorded.md`
- `docs/Bugs/logout-does-not-call-backend.md`
- `docs/Bugs/otp-dev-mode-master-code-bypass.md`
- `docs/Bugs/orphaned-admin-pages.md`
- `docs/Bugs/device-fingerprint-never-collected.md`
- → background: `docs/admin-panel/{security,login-auth,admin-users,ai-control-center}/*.md`, `docs/backend-services/admin-service/*.md`, `docs/backend-services/risk-service/*.md`

### App-monitor / churn / ML / risk services
- `docs/Bugs/churn-ml-database-url-env-inheritance.md`
- `docs/Bugs/churn-ml-model-label-leakage-not-real-prediction.md`
- `docs/Bugs/churn-ml-model-never-retrains.md`
- `docs/Bugs/churn-ml-service-no-memory-restart-limit.md`
- `docs/Bugs/churn-service-admin-stats-field-mismatch.md`
- `docs/Bugs/churn-service-reengagement-calls-lack-internal-auth-header.md`
- `docs/Bugs/monitor-events-batch-size-mismatch.md`
- `docs/Bugs/monitor-heartbeat-interval-exceeds-active-session-window.md`
- `docs/Bugs/monitor-ws-message-event-type-not-persisted.md`
- `docs/Bugs/risk-center-user-deeplink-broken.md`
- `docs/Bugs/risk-center-win-rate-threshold-mismatch.md`
- `docs/Bugs/risk-service-http-api-orphaned-and-duplicated.md`
- `docs/Bugs/risk-service-ml-config-hot-reload-noop.md`
- `docs/Bugs/dashboard-fraud-alerts-hardcoded-zero.md`
- `docs/Bugs/product-analytics-endpoints-missing.md`
- → background: `docs/backend-services/{app-monitor-service,churn-service,churn-ml-service,risk-service}/*.md`, `docs/admin-panel/{ai-control-center,risk-center,ml-churn-bot-learning,dashboard}/*.md`, `docs/app/monitoring-sdk/*.md`

### CMS / notifications / banners / content / missions
- `docs/Bugs/cms-banners-never-displayed.md`
- `docs/Bugs/home-banner-external-url-does-nothing.md`
- `docs/Bugs/home-page-fake-live-data.md`
- `docs/Bugs/push-notification-read-by-campaign-missing.md`
- `docs/Bugs/telugu-translations-mixed-script.md`
- `docs/Bugs/missions-feature-has-no-backend.md`
- → background: `docs/admin-panel/{banners,notifications}/*.md`, `docs/app/{home,missions,notifications}/*.md`

### Infra / deploy / DB / nginx / VPS
- `docs/Bugs/create-env-files-excludes-core-api-from-shared-secrets.md`
- `docs/Bugs/deploy-backend-health-check-checks-nothing.md`
- `docs/Bugs/deploy-pipeline-live-path-skips-most-pm2-services.md`
- `docs/Bugs/docker-compose-db-redis-exposed-with-hardcoded-credentials.md`
- `docs/Bugs/nginx-fallback-config-http-only-and-unhardened.md`
- `docs/Bugs/nginx-hestia-config-filename-drift-across-deploy-scripts.md`
- `docs/Bugs/nginx-join-table-download-routes-missing-in-production.md`
- `docs/Bugs/nginx-protect-cron-never-installed.md`
- `docs/Bugs/vps-optimizations-script-deletes-active-bot-learning-service.md`
- → background: `docs/infra/{deploy-pipeline,nginx,pm2-ecosystem,db-migrations}.md`, `docs/backend-services/uptime-bot/*.md`, `docs/admin-panel/app-update/*.md`
- → **live VPS access**: `docs/ops/vps-access.local.md` (gitignored, local only — see below)

## VPS access

Production VPS SSH credentials are kept **out of git** in `docs/ops/vps-access.local.md` (matches the `docs/ops/*.local.md` pattern added to `.gitignore`). That file is not tracked and will not show up in `git status`/commits — check it directly rather than looking here. Do not copy its contents into any tracked file.
