# Friends Tables: Share Link + Auto-Rematch — Design

Date: 2026-07-06
Status: Approved by Rahul (share link must open the app into the room;
rematch auto-starts with a 10s countdown)

## 1. Share room code (opens app into the room)

- Friends lobby code card gets Copy + Share buttons. Share opens the system
  share sheet (share_plus) with:
  "🃏 Join my Teen Patti table on MyOnlineJoker! Boot ₹<stake>. Tap to join:
  https://game.myonlinejoker.com/table/<CODE>"
  (`/join` was already taken by the referral landing page.)
- `/table/<CODE>` is a small static page (infra/web/table/index.html, served
  by nginx) showing the code and an "Open in App" button linking to
  `myonlinejoker://app/games/teen-patti/friends?mode=join&code=<CODE>`.
- App side: the `myonlinejoker` scheme is already registered; add
  `flutter_deeplinking_enabled` meta-data. go_router resolves the path to the
  friends page; new `code` query param prefills the code and auto-joins.
- Receiver flow: tap link in WhatsApp/Telegram → browser page → Open in App →
  lands in the friends lobby already seated.

## 2. Auto-rematch (Same Table 10s countdown | Exit Lobby)

Gateway:
- `private:start` no longer deletes the table: it marks `state='playing'`,
  saves `private:room:<roomId> → code`, and starts the hand. Double-start is
  guarded by the state. `startGame`/`startPrivateGame` accept a `privateCode`,
  include `private_code` in the `room:joined` payload, and return the roomId
  (null on failure → table reverts to lobby state).
- On `handleGameEnd`, a hook looks up `private:room:<roomId>`; if private:
  bump `gamesPlayed`, set `state='lobby'`, refresh TTL, re-broadcast
  `private:lobby`, and schedule a **12s server auto-start**: if the table
  still has ≥2 players in lobby state, start the next hand (everyone gets a
  fresh `room:joined`); with <2 players, close the table (`private:closed`,
  reason "Not enough players to continue").
- `private:leave` after at least one game reassigns the host to the next
  player instead of closing the table (pre-first-game host leave still closes
  it). A failed auto-start (e.g. a player is broke) reverts the table to
  lobby state and does not retry; players decide via the lobby.

Mobile (`game_page.dart`):
- `initialData.private_code` marks a friends game. Its result overlay shows
  **Same Table (10s countdown)** — passive label, client countdown 10s vs the
  server's 12s — and **Exit Lobby** (emits `private:leave` then exits; host
  exit hands the table to the next player).
- The page listens for the next `room:joined` and `pushReplacement`s to the
  new room; `private:closed` shows a snackbar and exits.
- Friends lobby page: entering a game no longer emits `private:leave` from
  dispose (flag), since the table now outlives the hand.

## Out of scope

- Ludo friends tables; kicking players; server-side balance pre-checks for
  rematch (wallet lock failure already aborts the start safely); iOS deep
  links.
