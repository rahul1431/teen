# Games Platform — Progress & Plan

Living tracker for the realtime games build-out. Updated as work lands.
Legend: ✅ done · 🟡 in progress · ⬜ planned

---

## 0. Realtime transport (foundation)

Socket.IO was dropped — the Dart `socket_io_client` crashed on-device before
sending a handshake. Everything now runs on **raw WebSockets**.

| Item | Status | Notes |
|------|--------|-------|
| Gateway raw `ws` server (`/ws`) | ✅ | JWT via `?token=`, in-memory `RealtimeHub` |
| Aviator raw `ws` (`/ws/aviator`) | ✅ | |
| Flutter `web_socket_channel` client | ✅ | same public API, token refresh, backoff |
| `dotenv` dependency fix (VPS crash) | ✅ | gateway + aviator were missing it |
| Gateway `cluster`→`fork` (single instance) | ✅ | in-memory hub needs one process |
| **Nginx `/ws` upgrade block on VPS** | ✅ | live — `/ws` returns `101` through nginx |

> ✅ **Resolved on VPS.** The `/ws`, `/ws/aviator` and `/api/betting/` blocks
> were added to the live Hestia per-domain config
> (`/home/admin/conf/web/game.myonlinejoker.com/nginx{,.ssl}.conf_api`).
> Verified: `https://game.myonlinejoker.com/ws` → `101 Switching Protocols`
> and `/api/betting/...` → `401` (service reachable, auth required).
> Note: the repo's `infra/nginx/hestia-proxy.conf` uses a different (rewrite)
> style than the box's hand-written `*_api` files — the live box was patched
> in its own style rather than replaced.

---

## 1. Ludo (NEW multiplayer game)

### Backend ✅
- **Engine** `services/game-engines/ludo` (Node/Fastify, port 3011),
  server-authoritative.
  - `rules.ts` — pure rules: 52-cell shared track + 6-cell home columns,
    start offsets per seat, captures, safe cells `{0,8,13,21,26,34,39,47}`,
    6-grants-extra-turn, capture/home grants extra turn, three-sixes forfeit,
    exact-finish to home, win = all 4 tokens home.
  - HTTP: `/start`, `/action` (`roll_dice` / `move_token`), `/bot-turn`,
    `/state`, `/health`.
  - **Verified:** 500/500 simulated bot games terminate with a valid winner;
    payout = pot − 5% rake.
- **Gateway** routes Ludo `game:action`, broadcasts board to the room, drives
  consecutive bot turns, credits the winner.
- **Matchmaking** creates Ludo rooms (2–4 players, bot-fill) and emits
  `room:joined` with the full board.
- **DB** migration `008_enable_ludo.sql` activates Ludo + tunes config.
- **PM2** `teen-ludo` process added to `ecosystem.config.js`.

### Mobile 🟡
- ⬜ Modes page — **Quick Match · Practice (offline) · Friends · Rules**
- ⬜ Offline practice engine (Dart port of `rules.ts`, vs bots, no network)
- ⬜ Online lobby (matchmaking over `/ws`)
- ⬜ Board widget + token/dice animations + sounds
- ⬜ Friends (private room by code) — needs gateway private-room support
- ⬜ Routing + Home tile

---

## 2. Aviator (update gameplay) 🟡

Current engine works (provably-fair crash curve, bet/cashout). Updates:
- ✅ Smooth multiplier curve animation (eased, 60fps) + rising plane path
- ✅ **Auto-cashout** target stepper + **auto-bet** for next round
- ✅ "You won +₹X" burst animation on cashout (flutter_animate)
- ✅ Round history chips with colour coding (low/mid/high crash)
- ✅ Takeoff / countdown / cashout / crash sound effects
- ⬜ Live bets list (other players) with cashout flashes
- ⬜ Lottie explosion on crash, confetti on big cashout

---

## 3. Animations (every game) ⬜→🟡

Shared building blocks (packages already present: `flutter_animate`,
`lottie`, `shimmer`):
- ⬜ `shared/effects/` — reusable confetti, glow-pulse, count-up, shake,
  card-flip, chip-toss widgets.
- ⬜ Teen Patti: card deal/flip, chip-to-pot toss, winner glow, fold fade.
- ⬜ Ludo: dice tumble, token hop along path, capture pop, home celebration.
- ⬜ Aviator: see §2.

## 4. Sound effects (every game) 🟡

- ✅ `core/audio/SoundService` (audioplayers) — pooled SFX, mute toggle,
  graceful no-op when an asset is missing.
- ⬜ Asset set under `assets/sounds/` (drop royalty-free files — see
  `assets/sounds/README.md` for the exact filename list).
- ✅ Wired into **Ludo** (dice/move/capture/home/win/lose/turn).
- ✅ Wired into **Aviator** (takeoff/countdown/cashout/crash/win).
- 🟡 Teen Patti (card deal / chip / win-lose) — in progress.

> Note: SFX **binaries** must be added to `assets/sounds/` (royalty-free, e.g.
> Mixkit/Freesound/Pixabay). The service is wired to filenames and silently
> skips any that are absent, so the app runs before assets are dropped in.

---

## 4b. Betting games — Matka · Lottery · Cricket ✅ (backend + mobile)

New consolidated **betting-service** (port 3012, REST under `/api/betting`)
plus mobile screens. These are "place bet → scheduled/declared result →
settle" games, settled by admin/internal endpoints.

| Game | Backend | Mobile | Settlement |
|------|---------|--------|------------|
| **Matka** | ✅ markets, daily draws, single/jodi/panna, std multipliers | ✅ market list + bet sheet | open/close session declare |
| **Lottery** | ✅ scheduled draws, ticket buy (w/ Admin stats dashboard) | ✅ physical Ticket Stub design (cut notches, dashed divider, glowing header) | exact-match payout |
| **Cricket** (IPL/T20/ICC) | ✅ matches → markets (winner/top-bat/…) w/ odds | ✅ match cards + odds + bet sheet | per-market settle / void+refund |

- Idempotent stake debit + prize credit via wallet-service (added
  `/internal/wallet/debit`).
- Migration `009_betting_games.sql`: all tables, `cricket` enum value, seeds
  Matka markets, activates configs.
- **Rummy retired** ✅ — config row deleted, removed from admin panel and UI
  (enum value retained; Postgres can't drop it safely).
- Admin/internal endpoints to create matches/markets/draws and declare
  results. ✅ **Admin-panel "Betting Games" page**: Matka declare
  open/close, Lottery create + declare winner, Cricket add match/market +
  settle/void.
- ✅ **"My Bets" history** on mobile (unified page; receipt icon in each
  game's app bar) — Matka bets, Lottery tickets, Cricket bets.

## 5. "Top games" structure (rules / gameplay / feel)

Patterns we mirror from established titles, adapted to our stack:
- **Ludo King–style** Ludo: 4 colours, safe stars, capture-sends-home,
  6-to-open + extra turn, exact finish, blockade (2 tokens) uncapturable.
  ✅ implemented in `rules.ts`.
- **Aviator (Spribe)-style** crash curve, auto-cashout, live bets, provably
  fair seed reveal. Curve/auto-cashout ⬜ (see §2); fairness ✅.
- **Teen Patti (classic)** seen/blind, chaal/pack/show, side-show. ✅ core
  engine; UX polish ⬜.

---

## Service / port map

| Service | Port | Mode |
|---------|------|------|
| gateway | 3004 | fork ×1 |
| aviator | 3005 | fork ×1 |
| teen-patti engine | 3010 | fork ×1 |
| **ludo engine** | **3011** | **fork ×1** |
| **betting-service** (matka/lottery/cricket) | **3012** | **fork ×1** |

---

## Next actions (priority order)
1. Apply nginx `/ws` block on VPS → unblock live multiplayer.
2. Ludo mobile: modes (Quick/Practice/Friends) + offline engine + board.
3. Sound service + asset set; wire into all three games.
4. Aviator gameplay update + animations.
5. Shared animation effects; apply across games.
