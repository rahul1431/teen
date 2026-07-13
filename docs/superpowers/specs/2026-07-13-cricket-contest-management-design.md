# Cricket Fantasy Contest Management — Design

## Problem

The admin panel's Cricket page has a "Fantasy Contests" tab that can Create and Delete contests (`cricket_fantasy_leagues`) and Finalize/settle them, but admins cannot:
- View a single contest's full detail
- Edit a contest (name, entry fee, prize pool, max entries, prize distribution)
- See who joined a contest (participants, their team, rank, payout)

On mobile, users have no dedicated contest **history** view — the existing "My Contests" tab only shows currently-joined contests via an inefficient per-match API loop, and neither admin nor mobile display player photos or country flags (only match-level team flags exist today).

## Goals

1. Admin: a searchable/filterable Contests page across all matches, with a detail view (edit + participants list).
2. Admin: image upload for cricket fantasy player avatars and country flags (replacing raw-URL-paste-only), plus a new small Countries management section.
3. Mobile: a new "History" tab on the Cricket page showing the user's past contest entries (rank, payout, status).
4. Mobile: player avatars and country flag icons rendered wherever fantasy player rosters/leaderboards are shown.

## Non-goals

- Changing the existing "My Contests" tab (joined-but-not-yet-settled contests) — left as-is.
- Automated test suite — this repo has no test harness for these services; verification is manual/end-to-end, consistent with prior work in this codebase.
- Editing money fields (entry fee / prize pool / max entries / prize distribution) once a contest has any entries — locked server-side.

## Data model changes

No new tables. `cricket_countries` (id, name, flag_url — already exists, currently only used for match-level `team_a_flag`/`team_b_flag`) becomes the single source of truth for country icons; player responses join `cricket_fantasy_players.team_name = cricket_countries.name` to attach `flag_url`.

## Backend changes

### admin-service (`services/admin-service/src/index.ts`)

- `GET /api/admin/betting/cricket/fantasy/contests` — cross-match contest list. Query params: `status`, `match_id`, `date_from`, `date_to`, pagination. Joins `cricket_fantasy_leagues` + `cricket_matches`.
- `GET /api/admin/betting/cricket/fantasy/leagues/:id/entries` — participants for one contest: user, team, rank, payout, status. Joins `cricket_fantasy_entries` + `user_fantasy_teams` + users table.
- `PATCH /api/admin/betting/cricket/fantasy/leagues/:id` — edit contest. `name` always editable; `entry_fee`/`prize_pool`/`max_entries`/`prize_distribution` rejected with `409 Conflict` if `current_entries > 0` (server-side check, not just UI).
- `POST /api/admin/betting/cricket/fantasy/players/:id/avatar` — multipart upload, reusing the existing QR/emoji/banner upload pattern (dir, static serving, size/mime validation). Sets `avatar_url`.
- New `cricket_countries` admin CRUD: `GET/POST/PATCH /api/admin/betting/cricket/countries`, plus `POST .../countries/:id/flag` multipart upload for `flag_url`.
- Existing `GET .../fantasy/players` response extended to include `flag_url` via the team_name→country join.

### core-api-service (`services/core-api-service/src/plugins/betting.ts`)

- `GET /cricket/fantasy/my-history` — new user-facing route. Single query joining `cricket_fantasy_entries` → `cricket_fantasy_leagues` → `cricket_matches` for `req.user.sub`, paginated, ordered by match date descending. Returns match info, contest name, entry fee, rank, payout, status.

## Admin panel changes (`admin-panel/src/pages/games/Cricket.tsx`)

- New "Contests" view: filterable/searchable table (status, match, date) replacing the current nested-per-match-only display; row click opens a detail drawer.
- Detail drawer: editable fields (money fields disabled/read-only once `current_entries > 0`, with a note why) + participants table (paginated).
- Player form: avatar_url text field replaced with an upload widget (drag/pick, preview, upload progress); URL paste kept as a fallback advanced option.
- New "Countries" section: list + create/edit + flag upload.

## Mobile changes (`mobile/lib/features/games/betting/cricket_page.dart`)

- New "History" tab alongside Matches/My Contests/Fantasy, modeled on `transaction_history_page.dart`'s pattern: single API call to `/cricket/fantasy/my-history`, status filter chips, pull-to-refresh, empty/error states with retry.
- Player avatar (`avatar_url`) and country flag badge (`flag_url`) rendered together wherever player rosters/leaderboards currently show a name (existing `_buildTeamFlag`-style rendering extended to per-player use), with a placeholder icon fallback when either URL is null.

## Error handling

- Edit on a contest with entries → `409` with explicit message, not generic `400`.
- Upload endpoints validate mime type and size before writing to disk; reject non-images with `400`.
- Mobile History: empty state, error+retry state, null-safe image fallback.

## Rollout

- Backend + admin panel changes are server-side: deploy to VPS (rebuild admin-service and core-api-service, redeploy admin-panel dist, restart via pm2) — no user action required.
- Mobile changes require a new APK build and reinstall/update on devices — flagged explicitly at the end of implementation.
