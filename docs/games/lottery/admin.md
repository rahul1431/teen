# Lottery Betting — Admin Panel

## Two competing pages — only one is reachable

There are two lottery admin implementations in the codebase:

1. **`admin-panel/src/pages/games/Lottery.tsx`** — routed at `/admin/games/lottery` (`admin-panel/src/main.tsx:59`, nav entry in `admin-panel/src/pages/Layout.tsx:29`). This is the live, reachable page and the one described below.
2. **`admin-panel/src/pages/BettingManagement.tsx`**'s `LotteryTab` (~lines 178-262, wired into a tab strip at line 513) — calls the identical `/betting/lottery/{draws,create,draw,draws/:id}` endpoints but the whole file is never imported by `main.tsx` and has no menu entry. This is dead code, already fully documented in `docs/Bugs/orphaned-admin-pages.md` (which names `BettingManagement.tsx` explicitly as a "superseded duplicate" of `games/Lottery.tsx`, among others) — not re-filed here.

Everything below concerns `games/Lottery.tsx` and its `admin-service` routes only.

## Backend routes this page calls (`services/admin-service/src/index.ts:1488-1721`)

All require `authenticate`; the mutating ones additionally require `requireRole('finance')` except delete, which requires `requireRole('superadmin')`.

| Route | Purpose |
|---|---|
| `GET /api/admin/betting/lottery/draws` (`:1489-1495`) | Last 100 draws with a `ticket_count` subquery — feeds the main table. |
| `POST /api/admin/betting/lottery/create` (`:1497-1500`) | Proxies to `core-api-service`'s `/internal/lottery/create` via `callBetting()` (`:1462-1470`), which POSTs to `BETTING_URL` (`process.env.BETTING_SERVICE_URL`, default `http://127.0.0.1:3012`) with the shared `x-internal-key`. Creates a `lottery_draws` row. |
| `POST /api/admin/betting/lottery/draw` (`:1502-1505`) | Proxies to `/internal/lottery/draw` → `settleLottery()`. This is the "Declare & Settle" action. |
| `DELETE /api/admin/betting/lottery/draws/:id` (`:1630-1635`, `requireRole('superadmin')`) | Hard-deletes the draw's tickets then the draw row directly from `admin-service`'s own DB pool — **does not** call `core-api-service` or refund anyone first. Deleting an `open` draw that already has paid tickets on it destroys those ticket rows with no refund path; the only guard is that this requires the highest role tier. |
| `PATCH /api/admin/betting/lottery/draws/:id` (`:1638-1658`) | Edits `name`/`ticket_price`/`draw_time`/`prize_multiplier` — but only `if (existing.rows[0].status !== 'open') return reply.code(409)...` (`:1648`), so a `settled`/`cancelled` draw can't be edited. Note `digits` is **not** one of the editable fields here even though it's settable at creation. |
| `GET /api/admin/betting/lottery/draws/:id/tickets` (`:1661-1685`) | Paginated ticket list joined to `users` for username/phone — feeds the "View Tickets" drawer. |
| `GET /api/admin/betting/lottery/stats` (`:1688-1713`) | Aggregate dashboard numbers (open/settled/cancelled draw counts, total tickets, total revenue, total paid out) plus a top-10 recent-draws table — not currently surfaced anywhere in `games/Lottery.tsx` (no call site for this route in that file), so this endpoint is presently unused by any admin page. |
| `POST /api/admin/betting/lottery/cancel/:id` (`:1716-1721`) | Proxies to `/internal/lottery/cancel` — refunds every ticket and marks the draw cancelled. Not wired to any button in `games/Lottery.tsx` either (no `cancel` call site in that file) — reachable only via a direct API call today. |

The stale header comment above these routes ("write actions proxy to the **betting-service** internal endpoints," `services/admin-service/src/index.ts`) is a leftover from before the standalone `betting-service` was folded into `core-api-service`. Both `BETTING_URL`'s in-code fallback and the checked-in `.env`/`.env.example` used to point at port `3012` (nothing listens there — `core-api-service` runs on port `3001` per `ecosystem.config.js:32`), breaking this proxy in any environment; fixed 2026-07-28 to point at `3001` in all three places.

## What the page actually shows and does

`games/Lottery.tsx` (282 lines) is split into two cards:

**Left — "Lottery Rules & Config"** (`:118-155`): a form bound to the `game_configs` row where `game_type = 'lottery'`, loaded via the *generic* `GET /game-configs` (not a lottery-specific route — filters client-side for `game_type === 'lottery'`, `:32`) and saved via `PATCH /game-configs/lottery` (`:41`, also generic — this is `admin-service`'s catch-all `PATCH /api/admin/game-configs/:gameType` shared by every game type). Fields: `is_active` (on/off switch), `rake_percent` (0-20%). A `bot_fill_enabled`/`bot_fill_delay_seconds`/`max_bot_ratio`/`bot_difficulty` "Bot Settings" divider section used to render here too — removed (fixed 2026-07-28), since lottery has no bot-fill mechanic for the bot fields to control. **The remaining `is_active`/`rake_percent` fields still have no effect on lottery gameplay** — see `docs/Bugs/lottery-admin-config-panel-not-wired-to-gameplay.md` (detailed in `backend.md`): no lottery route reads `game_configs`, `is_active` doesn't gate `/lottery/buy`, and `rake_percent` is never deducted from any payout. An admin can toggle "Game Active" off and see the save succeed with no error, while players continue buying tickets uninterrupted.

**Right — "Lottery Draws"** (`:158-198`): the draws table (name, ticket price, digits limit, multiplier, tickets sold, draw time, status tag, winning number) with three row actions:
- **"Declare Winner"** (disabled once `status === 'settled'`) opens the settle modal (`:210-253`) — a free-form `Form.List` where the admin adds one row per winning ticket, each requiring a `ticket_number` (plain text, no validation against the draw's `digits`/format) and a `prize` (any positive number, unrelated to the draw's stored `prize_multiplier` — see `backend.md`). Submitting calls `POST /betting/lottery/draw` and shows a success toast with the returned `winners`/`tickets`/`paid` counts. The in-modal warning text ("This settles all tickets, credits winning accounts immediately... This cannot be undone") is accurate — there's no undo, no draft/preview step, and no confirmation of the admin-typed prize amounts against any reference before they're paid out via `wallet-service`.
- **"View Tickets"** opens a drawer (`:255-279`) listing every ticket for that draw with buyer username/phone, stake amount, and (once settled) win/loss + prize.
- **"Delete"** (`Popconfirm`-gated) calls `DELETE /betting/lottery/draws/:id`, which — as noted above — has no refund step; deleting a draw with real paid tickets on it destroys the ticket rows and the money already staked on them without returning it to any player's wallet.

**"+ New Draw"** modal (`:200-208`): `name`, `ticket_price` (default ₹10), `digits` (default 8, despite the mobile client only ever offering a 4-digit picker — see `mobile.md`), `prize_multiplier` (default 1000x), `draw_time`. Calls `POST /betting/lottery/create`.

## What an admin cannot do from this page

- Cannot see the aggregate stats (`GET /api/admin/betting/lottery/stats` exists server-side but has no call site here).
- Cannot cancel-and-refund an open draw from the UI (`/api/admin/betting/lottery/cancel/:id` exists server-side, no button calls it) — the only way to unwind an open draw from this page is the destructive, non-refunding **Delete**.
- Cannot edit a draw's `digits` after creation (`PATCH .../draws/:id` accepts `name`/`ticket_price`/`draw_time`/`prize_multiplier` only, per `services/admin-service/src/index.ts:1640-1645`).
- Has no way to know, from this UI, that the "Rules & Config" card on the left is inert — it renders and saves exactly like every other game's config card (compare `admin-panel/src/pages/games/TeenPatti.tsx`, where the equivalent fields do matter), giving no visual indication that lottery is the one game type where none of it is read back.
