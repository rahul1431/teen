# Cricket Betting & Fantasy System: Architecture & Upgrades Guide

This document details the database, backend, admin, and mobile architecture of the Cricket Betting module, including instructions for future modifications, upgrades, and extensions.

---

## 🏗️ 1. System Architecture

The Cricket module operates as a multi-tier system:
1. **Database Schema (PostgreSQL)**: Holds matches, session/outcome markets, fantasy players, drafted rosters, and contest entries.
2. **Backend API (`core-api-service`)**: Executes bet placement, fantasy validation, contest entry joins, external sports API syncing, and settlement disbursals.
3. **Admin Dashboard (React + AntD)**: Administrative portal to configure matches, players, contests, and manually update live scorecards or settle leagues.
4. **Mobile Client (Flutter)**: Premium user lobby, interactive 11-player drafter, green turf field preview, and local offline-first storage.

```
                  ┌──────────────────────┐
                  │   React Admin Panel  │
                  └──────────┬───────────┘
                             │ (Admin Actions)
                             ▼
┌────────────────┐     ┌───────────┐     ┌──────────────┐
│  Flutter App   ├────►│  Fastify  ├────►│  Postgres DB │
│ (Offline-First)│     │  Backend  │     │   (Storage)  │
└────────────────┘     └─────┬─────┘     └──────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ CricAPI (External)   │
                  └──────────────────────┘
```

---

## 🗄️ 2. Database Schema Reference

The system relies on 8 core tables (defined in migrations `009`, `010`, `011`, and `012`):

* **`cricket_matches`**: Matches schedule. Column `live_score` stores real-time overs, runs, and batsman statistics in JSONB format.
* **`cricket_markets`**: outcome markets (e.g. Winner, Top Batsman). Options & odds are stored inside a JSONB array: `[{"key": "a", "label": "India", "odds": 1.8}]`.
* **`cricket_bets`**: Stakes placed by users on outcome markets.
* **`cricket_fantasy_players`**: The global database of players with role (`wicket_keeper`, `batsman`, `all_rounder`, `bowler`), credits cost (e.g. 9.5), and team/country name.
* **`cricket_match_players`**: Maps players to specific matches and holds their fantasy points achieved during that match.
* **`cricket_fantasy_leagues`**: Contests created for a match, including entry fees, total prize pool, and rank distribution payouts: `[{"rank_start":1,"rank_end":1,"payout":5000}]`.
* **`user_fantasy_teams`**: The 11-player roster drafted by a user, referencing their Captain (2x points) and Vice-Captain (1.5x points).
* **`cricket_fantasy_entries`**: Bridges a user's drafted team to a contest league entry, storing final points, rank, and payout.

---

## ⚡ 3. Fantasy Squad Rules & Drafting Flow

Mobile team creation must follow these constraints validated by the server `/api/betting/cricket/fantasy/team`:
* **Squad Count**: Exactly `11` players.
* **Credit Budget**: Cumulative cost must not exceed `100.0` credits.
* **Role Composition limits**:
  - Wicket Keepers (WK): `1` to `4` players.
  - Batsmen (BAT): `3` to `6` players.
  - All-Rounders (AR): `1` to `4` players.
  - Bowlers (BOWL): `3` to `6` players.
* **Team Limit**: A maximum of `7` players can be drafted from a single team/country.
* **Captain (C)**: Receives **`2.0x`** fantasy points. Must be part of the roster.
* **Vice-Captain (VC)**: Receives **`1.5x`** fantasy points. Must be part of the roster, and different from Captain.

---

## 📶 4. Offline-First Caching Scheme

In Flutter, the app utilizes `LocalCricketStorage` (located in [local_cricket_storage.dart](file:///mobile/lib/features/games/betting/local_cricket_storage.dart)) which wraps `shared_preferences` to persist fetched lists.

* **Caching triggers**: Whenever a network request successfully fetches matches, players, or contests, the response is serialized to JSON and saved locally.
* **Offline fallbacks**: If a network error, timeout, or API rate limit occurs, the app catches the exception and reads from local cache.
* **Pre-seeded Dataset**: If no local cache exists, the storage pre-populates default mock fixtures (such as *India vs Australia*) and world-class rosters (Kohli, Rohit, Starc, etc.) so that the entire draft interface and lobby can be previewed offline without failing or crashing.

---

## ⚙️ 5. Sports API Integration

Match schedules and squads are synchronized from CricAPI (`cricapi.com`) via backend pass-through routes.

* **API Provider Config**: Settable in admin configurations under the `cricket` game configuration.
* **Sync routes**:
  - `/internal/cricket/sync-countries`: Downloads international team names and caches flags.
  - `/internal/cricket/sync-api`: Fetches active fixtures and current scoreboards.
  - `/internal/cricket/sync-squad`: Syncs 11-player squads for a match and populates the fantasy roster with customized avatars.

---

## 🚀 6. Future Upgrades Checklist

### How to adjust Fantasy Scoring Calculations
To customize points values (e.g. adding 1 point per run, 25 points per wicket, 8 points per catch), modify `settleFantasyLeague` inside [cricket.ts](file:///services/core-api-service/src/helpers/cricket.ts):
```typescript
// Example section:
teamPoints += basePlayerPoints * multiplier;
```
Modify the formula to compute custom weights from runs, boundaries, wickets, and fielding statistics.

### Adding Multi-League Team Entry
Currently, a user is limited to a single team registration per contest. To allow multiple team submissions (e.g., Team 1, Team 2, Team 3), modify:
1. The unique constraint `UNIQUE (league_id, user_id)` in the `cricket_fantasy_entries` table.
2. The endpoint `/cricket/fantasy/join` in [betting.ts](file:///services/core-api-service/src/plugins/betting.ts) to permit multiple entry joins for a single user ID.
