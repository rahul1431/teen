# Teen Patti Gold UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark red game board with a classic green felt Teen Patti Gold 2D table inside `game_page.dart`, touching only visual `_build*` methods and removing `_SeatTimer`.

**Architecture:** All changes are surgical replacements of visual rendering methods inside one file. Game logic, socket events, ValueNotifiers, action bar, chat, gifts, and sound are completely untouched. `_SeatTimer` is deleted and its role (timer ring around avatar) is absorbed into `_buildPlayerSeat()`.

**Tech Stack:** Flutter 3.44.3, Dart 3.12.2 — no new packages

## Global Constraints

- Flutter SDK: `C:\Users\Rahul\Downloads\flutter\bin\flutter.bat`
- Only `mobile/lib/features/games/teen_patti/game_page.dart` is modified
- Do NOT change `AppColors`, `AppConfig`, socket logic, ValueNotifiers, `PracticeEngine`, or any file outside `game_page.dart`
- `flutter analyze` must show only pre-existing `withOpacity` info warnings — no new issues
- APK built with `--debug` flag at end
- Use `.withValues(alpha:)` not `.withOpacity()` for all new color code

---

## File Map

| File | Change |
|------|--------|
| `mobile/lib/features/games/teen_patti/game_page.dart` | Replace `_buildFelt`, `_buildSeatsAndCenter`, `_buildPlayerSeat`, `_buildCard`, `_buildCardBack`, `_buildMyHand`, `_buildMyChips`, `_potChip`. Add `_seatPositions` constant. Remove `_SeatTimer` class. |

---

### Task 1: Green Felt Table + Seat Position Constant

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart`

**What this does:** Replaces `_buildFelt()` with bright green TPG-style felt. Adds the `_seatPositions` static constant used by Task 2.

- [ ] **Step 1: Add `_seatPositions` constant to `_TeenPattiGamePageState`**

Add this constant anywhere inside `_TeenPattiGamePageState`, before the first `@override`:

```dart
static const _seatPositions = {
  1: [(0.50, 0.10)],
  2: [(0.28, 0.12), (0.72, 0.12)],
  3: [(0.15, 0.22), (0.50, 0.08), (0.85, 0.22)],
  4: [(0.12, 0.35), (0.32, 0.10), (0.68, 0.10), (0.88, 0.35)],
  5: [(0.10, 0.45), (0.25, 0.12), (0.50, 0.07), (0.75, 0.12), (0.90, 0.45)],
};
```

- [ ] **Step 2: Replace `_buildFelt()`**

Find and replace the entire `_buildFelt()` method (starts at `Widget _buildFelt() => Positioned.fill(`, ends before `// ── Seats + Center`):

```dart
Widget _buildFelt() => Positioned.fill(
      child: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.2), radius: 1.4,
            colors: [Color(0xFF0A1628), Color(0xFF060E1A), Color(0xFF060A1A)],
            stops: [0.0, 0.6, 1.0],
          ),
        ),
        child: Center(
          child: FractionallySizedBox(
            widthFactor: 0.88, heightFactor: 0.82,
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(400),
                gradient: const RadialGradient(
                  colors: [Color(0xFF237D45), Color(0xFF0F5C2C)],
                ),
                boxShadow: [BoxShadow(
                  color: Colors.black.withValues(alpha: 0.7),
                  blurRadius: 28, offset: const Offset(0, 10), spreadRadius: 4,
                )],
              ),
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(400),
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft, end: Alignment.bottomRight,
                    colors: [Color(0xFFFFDF7A), Color(0xFFB38F24), Color(0xFFFFDF7A), Color(0xFF8C6B12)],
                    stops: [0.0, 0.35, 0.7, 1.0],
                  ),
                ),
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0A3D1F),
                    borderRadius: BorderRadius.circular(400),
                  ),
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(400),
                      gradient: const RadialGradient(
                        center: Alignment(0, -0.1), radius: 1.0,
                        colors: [Color(0xFF237D45), Color(0xFF1B7A3E)],
                      ),
                    ),
                    child: Stack(children: [
                      Positioned.fill(
                        child: Container(
                          margin: const EdgeInsets.all(28),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(400),
                            border: Border.all(
                              color: const Color(0xFF2E9B55).withValues(alpha: 0.20),
                              width: 1.5,
                            ),
                          ),
                        ),
                      ),
                      Center(
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          Text('👑', style: TextStyle(
                            fontSize: 32,
                            color: const Color(0xFF2E9B55).withValues(alpha: 0.15),
                          )),
                          const SizedBox(height: 4),
                          Text('TEEN PATTI', style: TextStyle(
                            color: const Color(0xFF2E9B55).withValues(alpha: 0.18),
                            fontSize: 36, fontWeight: FontWeight.w800, letterSpacing: 8,
                          )),
                        ]),
                      ),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
```

- [ ] **Step 3: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart 2>&1 | grep -v "withOpacity\|withValues"
```
Expected: only `5 issues found` line (pre-existing), no new errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "feat: green felt table — TPG classic style"
```

---

### Task 2: Fixed Seat Positioning + Pot/My Chips Redesign

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart`

**What this does:** Replaces trigonometry ellipse in `_buildSeatsAndCenter()` with the `_seatPositions` lookup. Replaces `_potChip()` and `_buildMyChips()` with TPG-style displays.

- [ ] **Step 1: Replace `_buildSeatsAndCenter()`**

Find and replace the entire `_buildSeatsAndCenter()` method:

```dart
Widget _buildSeatsAndCenter(Map<String, dynamic>? gs, double w, double h) {
  final players = (gs?['players'] as List?) ?? [];
  final ordered = List<Map<String, dynamic>>.from(
      players.map((e) => Map<String, dynamic>.from(e as Map)));
  final myIdx = ordered.indexWhere((p) => p['user_id'] == _myUserId);
  if (myIdx > 0) {
    ordered
      ..clear()
      ..addAll([...players.sublist(myIdx), ...players.sublist(0, myIdx)]
          .map((e) => Map<String, dynamic>.from(e as Map)));
  }

  final opponents = ordered
      .where((p) => p['user_id'] != _myUserId && p['userId'] != _myUserId)
      .toList();
  final n = opponents.length.clamp(1, 5);
  final positions = _seatPositions[n] ?? _seatPositions[1]!;

  final seats = <Widget>[];

  for (var i = 0; i < opponents.length && i < positions.length; i++) {
    final p = opponents[i];
    final pos = positions[i];
    final sx = w * pos.$1;
    final sy = h * pos.$2;
    final uid = (p['user_id'] ?? p['userId']) as String?;

    seats.add(Positioned(
      key: ValueKey('seat_$uid'),
      left: sx - 55, top: sy,
      child: RepaintBoundary(child: _buildPlayerSeat(p, gs)),
    ));
    seats.add(Positioned(
      key: ValueKey('reaction_$uid'),
      left: sx - 32, top: sy - 40,
      child: ValueListenableBuilder<List<_Reaction>>(
        valueListenable: _reactionsNotifier,
        builder: (_, reactions, __) {
          final mine = reactions.where((x) => x.userId == uid).toList();
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: mine
                .map((r) => _ReactionBubble(
                    key: ValueKey(r.id), emoji: r.emoji, isGift: r.isGift))
                .toList(),
          );
        },
      ),
    ));
  }

  seats.add(Positioned(
    key: const ValueKey('pot_chip'),
    left: w / 2 - 70, top: h / 2 - 28,
    child: SizedBox(width: 140, child: Center(child: _potChip(gs))),
  ));

  seats.add(Positioned(
    key: const ValueKey('hostess'),
    left: w / 2 - 40, top: h * 0.05,
    child: const _HostessWidget(),
  ));

  return Stack(children: seats);
}
```

- [ ] **Step 2: Replace `_potChip()`**

Find and replace the entire `_potChip()` method:

```dart
Widget _potChip(Map<String, dynamic>? gs) => Container(
      width: 140,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: const Color(0xFFFFD700).withValues(alpha: 0.7), width: 1.5),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('POT',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.6),
                fontSize: 10,
                letterSpacing: 1.5,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text('💰 ₹${gs?['pot'] ?? 0}',
            style: const TextStyle(
                color: AppColors.gold,
                fontWeight: FontWeight.bold,
                fontSize: 18)),
      ]),
    );
```

- [ ] **Step 3: Replace `_buildMyChips()`**

Find and replace the entire `_buildMyChips()` method:

```dart
Widget _buildMyChips(Map<String, dynamic>? gs) {
  final me = (gs?['players'] as List?)
      ?.where((p) => p['user_id'] == _myUserId)
      .firstOrNull;
  if (me == null) return const SizedBox.shrink();
  final chips = me['chips'] ?? me['balance'] ?? 0;
  final isSeen = me['is_seen'] ?? me['isSeen'] ?? _isSeen;
  return Positioned(
    bottom: 8, left: 0, right: 0,
    child: Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFF0D2E18).withValues(alpha: 0.85),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
              color: const Color(0xFFFFD700).withValues(alpha: 0.7)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Text('💰 $chips',
              style: const TextStyle(
                  color: AppColors.gold,
                  fontWeight: FontWeight.bold,
                  fontSize: 13)),
          const Text('  You  ',
              style: TextStyle(color: Colors.white70, fontSize: 11)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: isSeen
                  ? const Color(0xFF2ECC71)
                  : Colors.orange.shade700,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              isSeen ? 'SEEN' : 'BLIND',
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.bold),
            ),
          ),
        ]),
      ),
    ),
  );
}
```

- [ ] **Step 4: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart 2>&1 | grep -v "withOpacity\|withValues"
```
Expected: no new errors beyond pre-existing.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "feat: fixed arc seat layout, TPG pot display, centered my-chips panel"
```

---

### Task 3: TPG Player Seat Panel + Remove `_SeatTimer`

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart`

**What this does:** Replaces `_buildPlayerSeat()` with the dark green glass TPG panel. Deletes the `_SeatTimer` class (its timer ring is now inline inside the seat panel).

- [ ] **Step 1: Replace `_buildPlayerSeat()`**

Find and replace the entire `_buildPlayerSeat()` method:

```dart
Widget _buildPlayerSeat(Map<String, dynamic> player, Map<String, dynamic>? gs) {
  final isFolded = player['status'] == 'folded';
  final players = (gs?['players'] as List?) ?? [];
  final turnIdx = (gs?['current_turn'] ?? gs?['CurrentTurn'] ?? -1) as int;
  final turnUserId = gs?['current_turn_user_id'] ??
      (turnIdx >= 0 && turnIdx < players.length
          ? players[turnIdx]['user_id'] ?? players[turnIdx]['userId']
          : null);
  final isTurn =
      turnUserId == player['user_id'] || turnUserId == player['userId'];
  final isDealer = gs?['dealer_id'] == player['user_id'] ||
      gs?['dealer_id'] == player['userId'];
  final isBot = player['is_bot'] == true;
  final status = _statusOf(player);

  return Opacity(
    opacity: isFolded ? 0.45 : 1.0,
    child: Container(
      width: 110,
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF0D2E18).withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isTurn ? const Color(0xFF2ECC71) : Colors.white12,
          width: isTurn ? 2.5 : 1.0,
        ),
        boxShadow: isTurn
            ? [BoxShadow(
                color: const Color(0xFF2ECC71).withValues(alpha: 0.65),
                blurRadius: 14, spreadRadius: 1)]
            : null,
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (!isFolded) _opponentCardBacks(),
        const SizedBox(height: 4),
        SizedBox(
          width: 54, height: 54,
          child: Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
            // Timer ring
            if (isTurn)
              ValueListenableBuilder<int>(
                valueListenable: _timerNotifier,
                builder: (_, secs, __) => SizedBox(
                  width: 50, height: 50,
                  child: CircularProgressIndicator(
                    value: (secs / 30).clamp(0.0, 1.0),
                    strokeWidth: 3,
                    backgroundColor: Colors.black26,
                    valueColor: AlwaysStoppedAnimation(
                        secs <= 5 ? Colors.red : const Color(0xFF2ECC71)),
                  ),
                ),
              )
            else
              SizedBox(
                width: 50, height: 50,
                child: CircularProgressIndicator(
                  value: 1.0,
                  strokeWidth: 3,
                  backgroundColor: Colors.black26,
                  valueColor: AlwaysStoppedAnimation(
                      const Color(0xFFD4AF37).withValues(alpha: 0.5)),
                ),
              ),
            // Avatar
            CircleAvatar(
              radius: 18,
              backgroundColor: isFolded ? Colors.grey : Colors.white24,
              child: Text(
                player['username']?[0]?.toUpperCase() ?? '?',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
              ),
            ),
            // Gift button
            Positioned(
              left: -2, top: -2,
              child: GestureDetector(
                onTap: () => setState(
                    () { _showGiftTray = true; _showChat = false; }),
                child: Container(
                  width: 20, height: 20, alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                  child: const Text('🎁', style: TextStyle(fontSize: 10)),
                ),
              ),
            ),
            // Dealer badge
            if (isDealer)
              Positioned(
                right: -2, top: -2,
                child: Container(
                  width: 18, height: 18, alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.red,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 1.5),
                  ),
                  child: const Text('D',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.bold)),
                ),
              ),
            // Thinking dots for bots
            if (isBot && isTurn)
              Positioned(
                top: -42,
                child: Container(
                  key: ValueKey('thinking_${player['user_id']}'),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: const Color(0xFFD4AF37).withValues(alpha: 0.5)),
                  ),
                  child: const _ThinkingDots(),
                ),
              ),
          ]),
        ),
        const SizedBox(height: 4),
        Text(
          player['username'] ?? 'Bot',
          style: const TextStyle(color: Colors.white, fontSize: 11),
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 3),
        if (_chipsOf(player) != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text('💰 ${_chipsOf(player)}',
                style: const TextStyle(
                    color: Colors.black,
                    fontSize: 9,
                    fontWeight: FontWeight.bold)),
          ),
        const SizedBox(height: 3),
        _statusPill(status.$1, status.$2),
        if (isBot)
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text('BOT',
                style: TextStyle(
                    color: Colors.orange,
                    fontSize: 8,
                    fontWeight: FontWeight.bold)),
          ),
      ]),
    ),
  );
}
```

- [ ] **Step 2: Delete `_SeatTimer` class**

Find and delete the entire `_SeatTimer` class — from `// ── Seat Timer (Leaf Rebuilder) ────` comment through its closing `}`. It starts around:
```dart
// ── Seat Timer (Leaf Rebuilder) ────────────────────────────────────────────────
class _SeatTimer extends StatelessWidget {
```
and ends at the final `}` of `_SeatTimerState` (or `_SeatTimer` if stateless). Delete everything from that comment to the end of the class.

- [ ] **Step 3: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart 2>&1 | grep -v "withOpacity\|withValues"
```
Expected: no new errors. The `_SeatTimer` removal may eliminate one `unused_element` warning — that's fine.

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "feat: TPG-style player seat panels, remove _SeatTimer class"
```

---

### Task 4: Larger Cards + Adjusted Hand Position

**Files:**
- Modify: `mobile/lib/features/games/teen_patti/game_page.dart`

**What this does:** Resizes player cards from 52×74 to 64×90px, updates colors, adjusts `_buildMyHand()` bottom offset.

- [ ] **Step 1: Replace `_buildCard()`**

Find and replace the entire `_buildCard()` method:

```dart
Widget _buildCard(String value, String suit) {
  final color =
      (suit == 'H' || suit == 'D') ? AppColors.red : const Color(0xFF1A1A2A);
  final suitSymbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
  return Container(
    width: 64, height: 90,
    margin: const EdgeInsets.symmetric(horizontal: 3),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(10),
      boxShadow: const [
        BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))
      ],
    ),
    child: Stack(children: [
      Positioned(top: 4, left: 5,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(value,
              style: TextStyle(
                  fontSize: 15, fontWeight: FontWeight.bold, color: color)),
          Text(suitSymbol, style: TextStyle(fontSize: 13, color: color)),
        ])),
      Center(
        child: Text(suitSymbol,
            style: TextStyle(
                fontSize: 28, color: color.withValues(alpha: 0.15)))),
      Positioned(bottom: 4, right: 5,
        child: Transform.rotate(
          angle: math.pi,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value,
                style: TextStyle(
                    fontSize: 15, fontWeight: FontWeight.bold, color: color)),
            Text(suitSymbol, style: TextStyle(fontSize: 13, color: color)),
          ]),
        )),
    ]),
  );
}
```

- [ ] **Step 2: Replace `_buildCardBack()`**

Find and replace the entire `_buildCardBack()` method:

```dart
Widget _buildCardBack() => Container(
      width: 64, height: 90,
      margin: const EdgeInsets.symmetric(horizontal: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        image: const DecorationImage(
          image: AssetImage('assets/images/card_back.png'),
          fit: BoxFit.cover,
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))
        ],
      ),
    );
```

- [ ] **Step 3: Update `_buildMyHand()` bottom offset**

Find this line inside `_buildMyHand()`:
```dart
    bottom: isMyTurn ? 104 : 14, left: 0, right: 0,
```
Replace with:
```dart
    bottom: isMyTurn ? 112 : 18, left: 0, right: 0,
```

- [ ] **Step 4: Verify**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze lib/features/games/teen_patti/game_page.dart 2>&1 | grep -v "withOpacity\|withValues"
```
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/games/teen_patti/game_page.dart
git commit -m "feat: 64x90 TPG-style cards with richer suit colors"
```

---

### Task 5: Full Analyze + Build Debug APK

**Files:** None modified — verification and build only.

- [ ] **Step 1: Full project analyze**

```bash
cd mobile
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" analyze 2>&1 | tail -5
```
Expected: `193 issues found` (same pre-existing count as before, all `withOpacity` info warnings). If count increased, investigate new issues before building.

- [ ] **Step 2: Build debug APK**

```bash
cd "C:\Users\Rahul\Desktop\teen\mobile"
"C:\Users\Rahul\Downloads\flutter\bin\flutter.bat" build apk --debug 2>&1 | tail -5
```
Expected output ends with:
```
√ Built build\app\outputs\flutter-apk\app-debug.apk
```

- [ ] **Step 3: Confirm APK exists**

```bash
ls -lh "C:\Users\Rahul\Desktop\teen\mobile\build\app\outputs\flutter-apk\app-debug.apk"
```
Expected: file present, size ~280–290 MB.

- [ ] **Step 4: Manual test checklist (on device)**

Install APK and verify:
- [ ] Game board shows **bright green felt** table (not dark red)
- [ ] Gold border ring visible around the green oval
- [ ] Faint `👑 TEEN PATTI` watermark visible in green-on-green
- [ ] Opponents appear in a **top arc** — not scattered around an ellipse
- [ ] **1 opponent:** top center. **2 opponents:** top-left + top-right. **3+:** wider arc
- [ ] Each opponent panel is **dark green glass** (not dark grey), 110px wide
- [ ] Active turn: **green glowing border** around the opponent's panel
- [ ] Timer ring wraps the opponent's **avatar circle** (not a separate bottom badge)
- [ ] Pot shows `POT` label above `💰 ₹{amount}` in gold 18px
- [ ] Your panel at **bottom center** shows `💰 chips  You  [SEEN/BLIND]`
- [ ] Your cards are **larger** (64×90) and fan correctly
- [ ] Card faces show near-black clubs/spades (not pure black)
- [ ] Demo mode (Practice): all of the above works offline
- [ ] Action bar, chat, gifts, sounds, result screen — all unchanged

---

## Self-Review

**Spec coverage:**
- ✅ Green felt colors → Task 1 (`_buildFelt`)
- ✅ `_seatPositions` constant → Task 1
- ✅ Fixed arc seat positioning → Task 2 (`_buildSeatsAndCenter`)
- ✅ TPG pot display with POT label → Task 2 (`_potChip`)
- ✅ Centered my-chips panel → Task 2 (`_buildMyChips`)
- ✅ Dark green glass seat panel → Task 3 (`_buildPlayerSeat`)
- ✅ Timer ring on avatar → Task 3 (inline `ValueListenableBuilder<int>`)
- ✅ Dealer badge on avatar → Task 3
- ✅ Gift button on avatar → Task 3
- ✅ Bot thinking dots above avatar → Task 3
- ✅ `_SeatTimer` class removed → Task 3
- ✅ 64×90 card size → Task 4 (`_buildCard`, `_buildCardBack`)
- ✅ Near-black clubs/spades → Task 4 (`Color(0xFF1A1A2A)`)
- ✅ `bottom: 112/18` adjusted for taller cards → Task 4 (`_buildMyHand`)
- ✅ APK build → Task 5

**No placeholders found.**

**Type consistency:** `_seatPositions` defined in Task 1, consumed in Task 2. `_timerNotifier` used in Task 3 — exists in state class (unchanged). `_ThinkingDots` used in Task 3 — existing class (unchanged). All consistent.
