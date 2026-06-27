# Teen Patti Lobby & Game Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix screen flash on game entry, timer reset on reconnect, exit confirmation dialog, and gift/emoji sound sync across three Flutter files.

**Architecture:** All changes are surgical edits to existing files — no new files, no new dependencies. Each task is a self-contained fix that can be verified with `flutter analyze` and a manual smoke test on device.

**Tech Stack:** Flutter 3.44.3, Dart 3.12.2, audioplayers, hive, web_socket_channel, go_router

## Global Constraints

- Flutter SDK: `C:\Users\Rahul\Downloads\flutter\bin\flutter.bat`
- All edits are in `mobile/` directory
- Do NOT add new sound asset files — reuse `Sfx.chipBet` and `Sfx.buttonTap`
- Do NOT change `AppColors`, `AppConfig`, or any theme file
- `flutter analyze` must pass with zero errors before each commit
- APK built with `--debug` flag via `build_apk.bat` at root

---

## File Map

| File | What changes |
|------|-------------|
| `mobile/lib/core/audio/sound_service.dart` | Fix `_muted` → `muted` in `play()` and `loopAmbience()` |
| `mobile/lib/features/games/teen_patti/lobby_page.dart` | Add `dispose()`, store subscriptions, pre-lock orientation before push |
| `mobile/lib/features/games/teen_patti/game_page.dart` | Guard `_startTurnTimer()` in `_applyRoomJoinedData`, add `_confirmExit()`, add sounds to `_sendGift`/`_sendEmoji`/`_spawnReaction` |

---

### Task 1: Fix SoundService mute-on-startup bug

**Files:**
- Modify: `mobile/lib/core/audio/sound_service.dart:92-110`

**Problem:** `play()` checks `if (_muted)` — a private field always `false` at construction. `loopAmbience()` has the same bug. The `muted` getter reads from Hive and returns the persisted value. Result: BGM plays even when user had muted the previous session.

- [ ] **Step 1: Edit `sound_service.dart` — fix `play()`**

In `play()` at line 92, change:
```dart
Future<void> play(Sfx sfx, {double volume = 1.0}) async {
    if (_muted) return;
```
to:
```dart
Future<void> play(Sfx sfx, {double volume = 1.0}) async {
    if (muted) return;
```

- [ ] **Step 2: Edit `sound_service.dart` — fix `loopAmbience()`**

In `loopAmbience()` at line 105, change:
```dart
Future<void> loopAmbience(String asset, {double volume = 0.4}) async {
    if (_muted) return;
```
to:
```dart
Future<void> loopAmbience(String asset, {double volume = 0.4}) async {
    if (muted) return;
```

- [ ] **Step 3: Verify no analysis errors**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/core/audio/sound_service.dart
```
Expected: `No issues found!`

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/core/audio/sound_service.dart
git commit -m "fix: sound_service mute check now reads persisted Hive preference on startup"
```

---

### Task 2: Fix lobby — dispose subscriptions + pre-lock orientation

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/lobby_page.dart`

**Problem:** Stream subscriptions from `_socket.on()` are never cancelled (no `dispose()`), causing duplicate listeners if the lobby is visited twice. Also, orientation is not pre-locked before navigating to the game page, causing a 1-second screen flash.

- [ ] **Step 1: Add subscription fields to state class**

In `_TeenPattiLobbyPageState`, add two fields after the existing fields (after line 21, before `String get _variationLabel`):

```dart
StreamSubscription? _roomJoinedSub;
StreamSubscription? _errorSub;
```

Also add the import at the top of the file if not already present:
```dart
import 'dart:async';
import 'package:flutter/services.dart';
```

- [ ] **Step 2: Update `initState` to store subscriptions**

Replace the two `.listen(...)` calls in `initState` (lines 35-43) with stored subscriptions:

```dart
_roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen((data) {
  if (!mounted) return;
  setState(() => _searching = false);
  SystemChrome.setPreferredOrientations(
      [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
  context.push('/games/teen-patti/play/${data['room_id']}', extra: data);
});
_errorSub = _socket.on(SocketEvents.errorEvent).listen((data) {
  if (!mounted) return;
  setState(() => _searching = false);
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(data['message'] ?? 'Error'),
      backgroundColor: AppColors.red));
});
```

Note: `SystemChrome.setPreferredOrientations(...)` is called **before** `context.push(...)` so the device is already in landscape when the game page renders — this eliminates the flash.

- [ ] **Step 3: Add `dispose()` method**

Add this method after `initState` (before `_loadBalance`):

```dart
@override
void dispose() {
  _roomJoinedSub?.cancel();
  _errorSub?.cancel();
  super.dispose();
}
```

- [ ] **Step 4: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/lobby_page.dart
```
Expected: `No issues found!`

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/games/teen_patti/lobby_page.dart
git commit -m "fix: lobby disposes socket subscriptions and pre-locks landscape before game navigation"
```

---

### Task 3: Fix timer reset on reconnect

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart:181`

**Problem:** `_applyRoomJoinedData` unconditionally calls `_startTurnTimer()` when it's the player's turn. On socket reconnect, this resets the countdown to 30s even if only 5s remained.

- [ ] **Step 1: Guard `_startTurnTimer()` in `_applyRoomJoinedData`**

Find this block in `_applyRoomJoinedData` (around line 179-181):
```dart
_myTurnNotifier.value = isMe;
if (isMe) _startTurnTimer();
SoundService.instance.play(Sfx.cardDeal);
```

Replace with:
```dart
_myTurnNotifier.value = isMe;
if (isMe && (_turnTimer == null || !_turnTimer!.isActive)) {
  _startTurnTimer();
}
SoundService.instance.play(Sfx.cardDeal);
```

- [ ] **Step 2: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart
```
Expected: `No issues found!`

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "fix: turn timer no longer resets on reconnect if already running"
```

---

### Task 4: Add exit confirmation dialog + leave_room event

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart`

**Problem:** `_exit()` calls `Navigator.pop()` with no warning and no server notification. The server never learns the player left, relying on timeout/heartbeat to recover.

- [ ] **Step 1: Replace `_exit()` with `_doExit()` and add `_confirmExit()`**

Find the existing `_exit()` method (around line 344-346):
```dart
void _exit() {
  Navigator.pop(context);
}
```

Replace the entire method with these two methods:
```dart
void _doExit() {
  if (!widget.demo) {
    _socket.emit('leave_room', {'room_id': widget.roomId});
  }
  Navigator.pop(context);
}

void _confirmExit() {
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Text(
        'Leave Game?',
        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
      ),
      content: const Text(
        "You'll forfeit this hand and your current bet.",
        style: TextStyle(color: Colors.white70, fontSize: 14),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Stay', style: TextStyle(color: Colors.white54)),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.red,
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          onPressed: () {
            Navigator.pop(ctx);
            _doExit();
          },
          child: const Text('Leave', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
      ],
    ),
  );
}
```

- [ ] **Step 2: Update all call sites**

There are three call sites to update:

**a. `PopScope.onPopInvokedWithResult`** (around line 357-358):
```dart
// Before:
onPopInvokedWithResult: (didPop, result) { if (!didPop) _exit(); },
// After:
onPopInvokedWithResult: (didPop, result) { if (!didPop) _confirmExit(); },
```

**b. Top bar back button** in `_buildTopBar()` (around line 728):
```dart
// Before:
_circleBtn(Icons.arrow_back, _exit, size: 36),
// After:
_circleBtn(Icons.arrow_back, _confirmExit, size: 36),
```

**c. Result overlay "Back to Lobby" button** in `_buildResult()` (around line 1029) — keep this calling `_doExit()` directly (no confirmation — game is over):
```dart
// Before:
onPressed: _exit,
// After:
onPressed: _doExit,
```

- [ ] **Step 3: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart
```
Expected: `No issues found!`

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "feat: exit confirmation dialog with leave_room server notification"
```

---

### Task 5: Add gift, emoji, and reaction sounds

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart`

**Problem:** Sending a gift or emoji only triggers haptics. Receiving another player's reaction is completely silent.

- [ ] **Step 1: Add sound to `_sendGift()`**

Find `_sendGift()` (around line 319-325):
```dart
void _sendGift(String icon) {
  _socket.emit(SocketEvents.roomChat,
      {'room_id': widget.roomId, 'message': icon, 'type': 'gift'});
  _spawnReaction(_myUserId ?? '', icon, isGift: true);
  setState(() => _showGiftTray = false);
  HapticFeedback.mediumImpact();
}
```

Replace with:
```dart
void _sendGift(String icon) {
  _socket.emit(SocketEvents.roomChat,
      {'room_id': widget.roomId, 'message': icon, 'type': 'gift'});
  _spawnReaction(_myUserId ?? '', icon, isGift: true);
  setState(() => _showGiftTray = false);
  SoundService.instance.play(Sfx.chipBet);
  HapticFeedback.mediumImpact();
}
```

- [ ] **Step 2: Add sound to `_sendEmoji()`**

Find `_sendEmoji()` (around line 312-317):
```dart
void _sendEmoji(String emoji) {
  _socket.emit(SocketEvents.roomChat,
      {'room_id': widget.roomId, 'message': emoji, 'type': 'emoji'});
  _spawnReaction(_myUserId ?? '', emoji);
  HapticFeedback.selectionClick();
}
```

Replace with:
```dart
void _sendEmoji(String emoji) {
  _socket.emit(SocketEvents.roomChat,
      {'room_id': widget.roomId, 'message': emoji, 'type': 'emoji'});
  _spawnReaction(_myUserId ?? '', emoji);
  SoundService.instance.play(Sfx.buttonTap);
  HapticFeedback.selectionClick();
}
```

- [ ] **Step 3: Add sound to `_spawnReaction()` for received reactions**

Find `_spawnReaction()` (around line 327-336):
```dart
void _spawnReaction(String userId, String emoji, {bool isGift = false}) {
  final r = _Reaction(id: ++_reactionId, userId: userId, emoji: emoji, isGift: isGift);
  final list = List<_Reaction>.from(_reactionsNotifier.value)..add(r);
  _reactionsNotifier.value = list;
  Timer(2600.ms, () {
    if (!mounted) return;
    _reactionsNotifier.value =
        List<_Reaction>.from(_reactionsNotifier.value)..removeWhere((x) => x.id == r.id);
  });
}
```

Replace with:
```dart
void _spawnReaction(String userId, String emoji, {bool isGift = false}) {
  final r = _Reaction(id: ++_reactionId, userId: userId, emoji: emoji, isGift: isGift);
  final list = List<_Reaction>.from(_reactionsNotifier.value)..add(r);
  _reactionsNotifier.value = list;
  // Play sound for incoming reactions (sender already heard it via _sendGift/_sendEmoji)
  if (userId != _myUserId) {
    SoundService.instance.play(Sfx.buttonTap, volume: 0.5);
  }
  Timer(2600.ms, () {
    if (!mounted) return;
    _reactionsNotifier.value =
        List<_Reaction>.from(_reactionsNotifier.value)..removeWhere((x) => x.id == r.id);
  });
}
```

- [ ] **Step 4: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart
```
Expected: `No issues found!`

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "feat: gift/emoji/reaction sounds synced for sender and receiver"
```

---

### Task 6: Full analyze + build debug APK

**Files:** None modified — verification and build only.

- [ ] **Step 1: Full project analyze**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze
```
Expected: `No issues found!`

If any issues appear, fix them before proceeding.

- [ ] **Step 2: Build debug APK**

From the repo root:
```bash
cd "C:\Users\Rahul\Desktop\teen"
build_apk.bat
```

Or directly:
```bash
cd "C:\Users\Rahul\Desktop\teen\mobile"
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" build apk --debug
```

Expected output ends with:
```
✓ Built build/app/outputs/flutter-apk/app-debug.apk
```

- [ ] **Step 3: Confirm APK exists**

```bash
ls "C:\Users\Rahul\Desktop\teen\mobile\build\app\outputs\flutter-apk\app-debug.apk"
```
Expected: file present with non-zero size.

- [ ] **Step 4: Manual test checklist (on device)**

After installing the APK:
- [ ] Enter lobby → tap Quick Match → confirm NO screen flash when game opens
- [ ] Mid-game: press hardware back → confirm "Leave Game?" dialog appears with Stay / Leave
- [ ] Press Stay → confirm returns to game with timer continuing (not reset)
- [ ] Simulate reconnect → confirm timer does NOT jump back to 30s
- [ ] Send an emoji → confirm audio plays
- [ ] Send a gift → confirm chip-clink audio plays
- [ ] Receive an emoji from another player → confirm soft audio plays
- [ ] Mute sound, close app, reopen → confirm BGM does NOT play

---

## Self-Review

**Spec coverage:**
- ✅ Screen flash → Task 2 (orientation pre-lock before push)
- ✅ Timer reset → Task 3 (guard `_turnTimer!.isActive`)
- ✅ Lobby dispose/leak → Task 2 (store subs + `dispose()`)
- ✅ Exit confirmation always → Task 4 (`_confirmExit()` on back + top bar)
- ✅ leave_room event → Task 4 (`_doExit()` emits socket event)
- ✅ Result overlay skips confirmation → Task 4 (calls `_doExit()` directly)
- ✅ Mute-on-startup bug → Task 1 (`_muted` → `muted` getter)
- ✅ Gift send sound → Task 5 (`Sfx.chipBet`)
- ✅ Emoji send sound → Task 5 (`Sfx.buttonTap`)
- ✅ Received reaction sound → Task 5 (`Sfx.buttonTap` at 0.5 volume, only for others)
- ✅ APK build → Task 6

**No placeholders found.**

**Type/name consistency:** `_doExit`, `_confirmExit`, `_roomJoinedSub`, `_errorSub` — all consistent across tasks that reference them.
