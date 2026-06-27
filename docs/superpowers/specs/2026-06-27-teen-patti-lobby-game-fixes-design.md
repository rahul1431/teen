# Teen Patti: Lobby + Game Fixes Design
**Date:** 2026-06-27

## Overview

Three independent bug-fix areas in the Teen Patti mobile game:
1. Screen flash on game entry + turn timer resets on reconnect
2. Exit confirmation dialog with server-side leave notification
3. Gift/emoji sound sync + mute-on-startup bug

---

## Section 1 — Screen Flash & Timer Reset

### Problem
- Transitioning from the portrait lobby to the landscape game page causes a 1-second white/black flash because orientation is locked *after* the new page renders.
- On socket reconnect, `_applyRoomJoinedData` calls `_startTurnTimer()` unconditionally, resetting the countdown to 30s mid-turn.
- `_TeenPattiLobbyPageState` has no `dispose()` — the `roomJoined` and `errorEvent` stream subscriptions are never cancelled, causing duplicate listeners and potential ghost navigation if the lobby is visited more than once.

### Fix

**`lobby_page.dart`**
- Store both `_socket.on(SocketEvents.roomJoined).listen(...)` and `_socket.on(SocketEvents.errorEvent).listen(...)` into `StreamSubscription` variables (`_roomJoinedSub`, `_errorSub`).
- Add `@override void dispose()` that cancels both subscriptions and calls `super.dispose()`.
- In the `roomJoined` listener, call `SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight])` **before** `context.push(...)`. This pre-locks orientation so the game page opens already in landscape — eliminating the flash.

**`game_page.dart`**
- In `_applyRoomJoinedData`, guard the `_startTurnTimer()` call:
  ```dart
  if (isMe && (_turnTimer == null || !_turnTimer!.isActive)) {
    _startTurnTimer();
  }
  ```
  Reconnecting will no longer reset the countdown if a timer is already running.

---

## Section 2 — Exit Confirmation + Leave Room

### Problem
- `_exit()` calls `Navigator.pop(context)` with no confirmation and emits nothing to the server. The player silently disappears from the room without a `leave_room` event, leaving the server's bot-recovery to eventually time them out.
- `PopScope(canPop: false)` intercepts the back button and calls `_exit()`, so the same unguarded path is hit from hardware back too.

### Fix

**`game_page.dart`**
- Rename `_exit()` → `_doExit()` (the raw, unconditional pop + socket leave).
- Add `_confirmExit()` which shows an `AlertDialog`:
  - Title: "Leave Game?"
  - Body: "You'll forfeit this hand and your current bet."
  - Actions: **Stay** (dismiss) and **Leave** (red, calls `_doExit()`).
- `_doExit()` emits `leave_room` to the socket before popping:
  ```dart
  void _doExit() {
    if (!widget.demo) {
      _socket.emit('leave_room', {'room_id': widget.roomId});
    }
    Navigator.pop(context);
  }
  ```
- `PopScope.onPopInvokedWithResult` calls `_confirmExit()`.
- Top bar back button calls `_confirmExit()`.
- **Result overlay "Back to Lobby" button** keeps calling `_doExit()` directly — game is already over, no confirmation needed.

---

## Section 3 — Gifts, Emojis & Sound Sync

### Problem
- `SoundService.play()` and `loopAmbience()` check `_muted` (a private `bool` field set to `false` at construction) instead of the `muted` getter (which reads from Hive). If the user muted sound in a previous session, `_muted` is `false` on the next launch, so the BGM plays despite the saved preference.
- `_sendGift()` and `_sendEmoji()` only trigger haptics — no audio feedback.
- `_spawnReaction()` (called when receiving another player's gift/emoji) is also silent.

### Fix

**`sound_service.dart`**
- `play()`: change `if (_muted)` → `if (muted)` to use the Hive-backed getter.
- `loopAmbience()`: same change — `if (_muted)` → `if (muted)`.

**`game_page.dart`**
- `_sendGift()`: add `SoundService.instance.play(Sfx.chipBet)` after the socket emit (reuses the satisfying chip-clink sound).
- `_sendEmoji()`: add `SoundService.instance.play(Sfx.buttonTap)`.
- `_spawnReaction()`: add `SoundService.instance.play(Sfx.buttonTap, volume: 0.5)` only when `userId != _myUserId` — avoids double-play for the sender who already heard the send-sound.

---

## Files Changed

| File | Change |
|------|--------|
| `mobile/lib/features/games/teen_patti/lobby_page.dart` | Add `dispose()`, store subs, pre-lock orientation before push |
| `mobile/lib/features/games/teen_patti/game_page.dart` | Guard timer in `_applyRoomJoinedData`, add `_confirmExit()`, add sounds to gift/emoji/reaction |
| `mobile/lib/core/audio/sound_service.dart` | Fix `_muted` → `muted` in `play()` and `loopAmbience()` |

## Out of Scope
- New sound assets (reusing existing `chipBet`, `buttonTap`)
- "Play Again" for live games (separate feature)
- Admin panel changes
