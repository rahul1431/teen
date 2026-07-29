# Platform Audit & Fix — Sequential Environment Deep-Dive

Date: 2026-07-12
Status: Approved by Rahul

## Goal

Full audit and fix of the myonlinejoker platform — dev environment first, verified live, then a prod diff and controlled release. Covers infra, env config, backend services, admin panel, web frontend, VPS state, and Flutter mobile.

## Constraints

- **Teen Patti and Aviator are LOCKED**: audited and reported on, but zero code changes without explicit per-issue re-authorization.
- All Phase 1 and Phase 3 VPS/DB access is **read-only** (pm2/nginx/file inspection, SQL SELECTs only).
- Prod deploy happens **only after explicit user sign-off** on the Phase 3 release plan.
- First Phase 1 action on the VPS: determine whether dev and prod share a server or database. Any Phase 2 fix touching shared infra is flagged before execution.

## Phase 1 — Dev audit (read-only)

1. **Repo state (1a)**: reconcile in-flight `feature/admin-responsive` work — environment switcher, deployment/rollback routes, 5 uncommitted DB migrations. Determine complete/half-done/abandoned. Type-check and build admin-panel + admin-service locally.
2. **VPS dev side (1b)**: deployed branch/commit for dev, pm2 process health, nginx config for dev.myonlinejoker.com, .env files present vs required, DB migration state vs `infra/db/migrations`, disk/memory/SSL/backups.
3. **Live dev check (1c)**: browser pass over dev.myonlinejoker.com/admin/login — login flow, console errors, failing network calls; spot-check key admin modules and the myonlinejoker.com frontend.
4. **Mobile (1d)**: Flutter code audit — API base URL, dev/prod switching mechanism, code health, state of app-debug.apk / app-release.apk in repo root. No store releases.
5. **Output (1e)**: prioritized findings report — P0 money/security, P1 broken functionality, P2 drift/hygiene, P3 cosmetic.

## Phase 2 — Fix dev

Small tasks, one finding at a time, P0 first. Each fix: implement → deploy to dev via existing `infra/deploy` scripts → verify live in browser → mark done. Running checklist maintained in the task list. Nothing touches prod.

## Phase 3 — Prod diff & release plan

Diff prod VPS state (branch, files, env, nginx, DB schema) against the fixed dev. Produce a release plan listing exactly what changes on prod. Deploy only after user sign-off.

## Error handling

- SSH failures: report and fall back to repo-only audit for that area.
- Browser/site unreachable: recorded as a P1 finding, not a blocker for other tracks.
- Any discovery contradicting assumptions (e.g., dev DB is prod DB) halts Phase 2 planning until surfaced to user.
