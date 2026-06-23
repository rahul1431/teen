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
| **Nginx `/ws` upgrade block on VPS** | 🟡 | **blocking live connect** — see below |

> ⚠️ **Action required on VPS:** the public site returns `404` for `/ws`
> because the updated nginx config isn't applied. Paste
> `infra/nginx/hestia-proxy.conf` into Hestia → Web → Edit Domain → Advanced →
> Custom Nginx Config, then `nginx -t && systemctl reload nginx`. Verified the
> gateway itself upgrades correctly (`curl` to `127.0.0.1:3004/ws` → `101`).

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

---

## Next actions (priority order)
1. Apply nginx `/ws` block on VPS → unblock live multiplayer.
2. Ludo mobile: modes (Quick/Practice/Friends) + offline engine + board.
3. Sound service + asset set; wire into all three games.
4. Aviator gameplay update + animations.
5. Shared animation effects; apply across games.
