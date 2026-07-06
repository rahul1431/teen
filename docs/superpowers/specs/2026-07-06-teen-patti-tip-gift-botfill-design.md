# Teen Patti: Tip Dealer, Gift Removal, Bot-Fill Fix — Design

Date: 2026-07-06
Status: Approved by Rahul

## Goals

1. Add a **Tip the dealer** option in the Teen Patti game (mobile).
2. **Fully remove** the Gift feature (mobile app, gateway, admin panel, admin API, DB).
3. Fix bot-fill so tables always fill to 4 seats: 1RP+3B, 2RP+2B, 3RP+1B, 4–6RP+0B.
   Reported bug: with 2 real players, no bots are added.

## 1. Tip the dealer

- Mobile `game_page.dart`: the right-panel Gift button becomes a **Tip** button.
  Tapping opens a tray with fixed preset amounts: ₹5, ₹10, ₹20, ₹50 (no admin config).
- Selecting an amount sends WS message `room:tip { room_id, amount }` to game-gateway.
- Gateway `room:tip` handler:
  - Validates amount is one of the presets (server-side whitelist).
  - Debits the player's wallet (real balance) if sufficient; otherwise replies with an
    error event (mobile shows toast, no debit).
  - Inserts a transaction row with type `tip_dealer` using the existing
    idempotency-keyed wallet-write pattern (money goes to the house — no credit row).
  - Broadcasts `room:tip` to the room (user_id, username, amount) for a coin/tip
    animation reusing the existing reaction-bubble overlay.
- Tips are visible in existing admin transaction/finance views via the transactions table.

## 2. Gift removal (full)

- Mobile `game_page.dart`: delete gift tray, `_gifts` state, `_sendGift`,
  and the `/api/admin/config/gifts` fetch. Emojis stay.
- Gateway `index.ts`: chat types reduce to `['text', 'emoji']`.
- Admin panel `TeenPatti.tsx`: remove Gifts management section, state, and modal.
- `admin-service`: remove GET/POST/PATCH/DELETE `/api/admin/gifts` and
  GET `/api/admin/config/gifts`.
- New migration: `DROP TABLE IF EXISTS game_gifts` (game_emojis stays).

## 3. Bot-fill fix

- Root cause: matchmaking already fills to `bot_fill_table_size` (4 for teen_patti via
  migration 026), but the VPS DB likely has it NULL (admin GameConfig save writes NULL
  when blank) or the VPS gateway predates the logic.
- Harden `matchmaking.ts`: if `game_type === 'teen_patti'` and `bot_fill_table_size`
  is NULL, default to 4 in code.
- Deploy step: verify/set `bot_fill_table_size = 4`, `bot_fill_enabled = true` for
  teen_patti in the VPS DB; redeploy game-gateway (surgical deploy per VPS topology).

## Out of scope

- Tipping other players; admin-configurable tip amounts; removing unrelated "gift"
  wording elsewhere (bonuses, notifications); Teen Patti gameplay/UI changes beyond
  the tip button.
