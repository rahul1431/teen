# App Monitor Service — Admin-panel touchpoints

Two admin-panel surfaces consume this service's data, both already fully documented from the admin-panel side — this file covers the API contract/RBAC layer between them and this service, not UI detail:

- **App Monitor tab** — `docs/admin-panel/app-monitor/` (overview/backend/admin/frontend). The operational-health view: active sessions, error rate, API latency/error-rate per endpoint, WS disconnects, screen-visit funnel, session list, PM2/Docker server health, uptime, alerts (with acknowledge), remediation log. Frontend component is `admin-panel/src/components/AI/AppMonitorTab.tsx` (641 lines), routed standalone at `/admin/app-monitor` and embedded in the AI Control Center.
- **Player Tracking page** — `docs/admin-panel/player-tracking/` (overview/backend/admin/frontend). The PII-sensitive view: live player map (GPS/IP-derived geo), per-player session/screen/game/device/location drill-down.

Both are proxied through the same file, `services/admin-service/src/monitor-routes.ts` (167 lines), which forwards to `app-monitor-service` via `axios` using `APP_MONITOR_SERVICE_URL` (`.env`/`.env.example`: `http://localhost:3015`). **None of these proxy calls attach any header** — no `x-monitor-key`, no `x-internal-key`/`INTERNAL_SERVICE_KEY` (the pattern most other admin-service→backend-service proxies in this codebase use for service-to-service auth) — which is fine only because `app-monitor-service` itself doesn't check for one on any of these routes (see `backend.md`).

## Route mapping (`admin-service` path → this service's path)

| `admin-service` route | RBAC (`admin-service` only) | Proxies to |
|---|---|---|
| `GET /api/admin/monitor/stats` | `authenticate` | `GET /api/monitor/stats` |
| `GET /api/admin/monitor/uptime` | `authenticate` | `GET /api/monitor/uptime` |
| `GET /api/admin/monitor/errors` | `authenticate` | `GET /api/monitor/errors` |
| `GET /api/admin/monitor/api-health` | `authenticate` | `GET /api/monitor/api-health` |
| `GET /api/admin/monitor/ws-health` | `authenticate` | `GET /api/monitor/ws-health` |
| `GET /api/admin/monitor/sessions` | `authenticate` | `GET /api/monitor/sessions` |
| `GET /api/admin/monitor/screen-funnel` | `authenticate` | `GET /api/monitor/screen-funnel` |
| `GET /api/admin/monitor/server-health` | `authenticate` | `GET /api/monitor/server-health` |
| `GET /api/admin/monitor/alerts` | `authenticate` | `GET /api/monitor/alerts` |
| `GET /api/admin/monitor/remediations` | `authenticate` | `GET /api/monitor/remediations` |
| `POST /api/admin/monitor/alerts/:id/ack` | `authenticate` (no role gate — see below) | `POST /api/monitor/alerts/:id/ack` |
| `GET /api/admin/monitor/live-players` | `authenticate` + `requireRole('superadmin')` | `GET /api/monitor/live-players` |
| `GET /api/admin/monitor/player/:userId` | `authenticate` + `requireRole('superadmin')` | `GET /api/monitor/player/:userId` |
| `GET /api/admin/monitor/geo-distribution` | `authenticate` + `requireRole('superadmin')` | `GET /api/monitor/geo-distribution` |
| `GET /api/admin/monitor/engagement` | `authenticate` + `requireRole('superadmin')` | `GET /api/monitor/engagement` |

`registerMonitorRoutes()` (`monitor-routes.ts:6-10`) accepts a `requireRole` parameter for every route "for signature compatibility" per its own comment, but only actually applies it to the four Player Tracking routes above — every other route is any-authenticated-admin, by explicit design (comment: "All monitor routes are read-only observability data accessible to any authenticated admin").

## RBAC gaps

- `POST /api/admin/monitor/alerts/:id/ack` has no role gate at all (any authenticated admin, any role, can acknowledge any alert) — flagged as not obviously intentional in `docs/Bugs/ai-control-center-missing-role-gates.md` (pre-existing finding, not new here).
- The RBAC table above only describes `admin-service`'s proxy layer. This service's own routes previously had zero RBAC or authentication, and Nginx exposed `/api/monitor/` directly without routing through `admin-service` at all — so the `requireRole('superadmin')` gate on live-players/player-detail/geo-distribution/engagement was bypassable by calling `app-monitor-service`'s own path instead of the admin-service proxy path. **Fixed 2026-07-28**: this service now requires the shared `INTERNAL_SERVICE_KEY` (via `x-internal-key`) on every route except the public ingest endpoint and `/health`; `admin-service`'s proxy sends that header on every forwarded call; and Nginx's public `/api/monitor/` location is now restricted to the exact ingest path (`= /api/monitor/events`), so this service is no longer reachable from the internet at all except for that one path.

## Not consumed

`GET /monitor/ws-health` is defined by both this service and its `admin-service` proxy but not called by `AppMonitorTab.tsx` (per `docs/admin-panel/app-monitor/backend.md`) — dead from the UI's perspective, though reachable directly. `GET /monitor/engagement` is likewise not consumed by the Player Tracking page directly (per `docs/admin-panel/player-tracking/backend.md`) and is used elsewhere in App Monitor instead.
