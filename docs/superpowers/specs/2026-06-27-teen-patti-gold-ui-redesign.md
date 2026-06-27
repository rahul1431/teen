# Teen Patti Gold Style UI Redesign
**Date:** 2026-06-27

## Overview

Replace the current dark navy/red table board in `game_page.dart` with a classic green felt Teen Patti Gold style 2D table. All game logic, socket events, ValueNotifiers, action bar, chat, gift tray, sound, and result overlay are **untouched**. Only the visual rendering methods are replaced.

**Approach:** Option A — refactor visual `_build*` methods in-place inside `game_page.dart`. No new files, no new packages.

---

## Section 1 — Color Palette & Table Felt

### Colors

| Element | Current | New |
|---------|---------|-----|
| Background | `Color(0xFF060A1A)` | `Color(0xFF060A1A)` (unchanged) |
| Table outer | `Color(0xFF1D0E09)` deep red | `Color(0xFF0F5C2C)` deep green |
| Table inner | `Color(0xFF381F17)` | radial `Color(0xFF237D45)` → `Color(0xFF1B7A3E)` |
| Table border | Gold gradient | Gold gradient (unchanged) |
| Watermark text | `Color(0xFFFFD700).withValues(alpha:0.12)` | `Color(0xFF2E9B55).withValues(alpha:0.15)` |

### `_buildFelt()` changes
- Replace the two `RadialGradient`/color values on the inner and outer table containers with the green palette above
- Watermark `👑` + `TEEN PATTI` text color updated to faint green
- Everything else (border ring, shadow, shape, padding, BoxShadow) stays identical

---

## Section 2 — Seat Positioning (Fixed Layout)

### Replace trigonometry with lookup table

Remove the `theta/cos/sin` ellipse math from `_buildSeatsAndCenter()`. Replace with a static constant map of fractional screen positions keyed by opponent count (total players minus the local player):

```dart
static const _seatPositions = {
  1: [(0.50, 0.10)],
  2: [(0.28, 0.12), (0.72, 0.12)],
  3: [(0.15, 0.22), (0.50, 0.08), (0.85, 0.22)],
  4: [(0.12, 0.35), (0.32, 0.10), (0.68, 0.10), (0.88, 0.35)],
  5: [(0.10, 0.45), (0.25, 0.12), (0.50, 0.07), (0.75, 0.12), (0.90, 0.45)],
};
```

Each `(xFraction, yFraction)` is multiplied by `(w, h)` from the `LayoutBuilder` constraints to get the absolute pixel position. Opponents are mapped in order (after rotating so the local player is index 0). Reaction bubbles are offset `Offset(0, -70)` above each seat's position.

Player (you) stays at bottom center — no change to `_buildMyHand()` or `_buildMyChips()` positioning.

---

## Section 3 — Player Seat Panel (TPG Style)

### `_buildPlayerSeat()` full redesign

**Panel dimensions:** 110px wide (up from 96px)

**Panel background:** `Color(0xFF0D2E18).withValues(alpha: 0.85)` — dark green glass

**Active turn border:** `Color(0xFF2ECC71)` 2.5px with glow `BoxShadow(color: Color(0xFF2ECC71).withValues(alpha:0.65), blurRadius:14)`

**Inactive border:** `Colors.white12` 1px

**Layout (top to bottom):**
1. Card backs — 3 fanned cards, 18×26px each, `card_back.png`, hidden if folded
2. Avatar ring — `Stack` with:
   - `CircularProgressIndicator` (46×46px, green stroke) showing turn timer when `isTurn`, static gold ring otherwise
   - `CircleAvatar` (radius 17, white24 bg) with initial letter
   - Dealer badge `D` (red circle, top-right, 18px) when `isDealer`
   - Gift button `🎁` (gold circle, top-left, 20px) tap opens gift tray
3. Player name — white, 11px, ellipsis overflow
4. Chip count pill — gold gradient bg, `💰 ₹{chips}` black bold 9px
5. Status pill — BLIND (orange), SEEN (`Color(0xFF2ECC71)` green), PACK (red)
6. BOT label — orange 8px, only when `is_bot == true`

Folded players: `Opacity(opacity: 0.45)` on whole panel, card backs hidden.

The `_SeatTimer` leaf widget is **replaced** — the `CircularProgressIndicator` inside the avatar stack takes over its role. The `_SeatTimer` class is removed.

Thinking dots (`_ThinkingDots`) for bots remain, positioned above the avatar stack at `top: -38`.

---

## Section 4 — Player's Hand Cards

### `_buildCard()` changes
- **Size:** 64×90px (up from 52×74px)
- **Border radius:** `BorderRadius.circular(10)` (up from 8)
- **Rank font:** 15px bold (up from 13px)
- **Suit symbol center:** 28px (up from 22px)
- **Club/Spade color:** `Color(0xFF1A1A2A)` (near-black, richer than pure black)
- **Shadow:** `BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))`

### `_buildCardBack()` changes
- **Size:** 64×90px (up from 52×74px) — same `card_back.png` asset

### `_buildMyHand()` position adjustment
- `bottom: isMyTurn ? 112 : 18` (up from `104 : 14` to account for taller cards)

### Fan rotation unchanged
- `angle: (index - (total - 1) / 2) * 0.12` — same formula, larger cards make fan feel more substantial

---

## Section 5 — Pot Display & Your Player Panel

### `_potChip()` redesign
```
┌──────────────────┐
│       POT        │  white60, 10px, letterSpacing 1.5
│   💰 ₹2,400      │  gold bold, 18px
└──────────────────┘
```
- Container: `Color(0xFF000000).withValues(alpha:0.55)`, `BorderRadius.circular(14)`
- Border: `Color(0xFFFFD700).withValues(alpha:0.7)` 1.5px
- Width: 140px (unchanged), centered at table center

### `_buildMyChips()` upgrade
Replace the current bottom-left pill with a centered bottom panel:
- Positioned: `bottom: 8, left: 0, right: 0`
- `Center` → `Container` pill showing: `💰 ₹{chips}  You  [SEEN/BLIND]`
- Same dark green glass style as opponent panels
- Padding: `horizontal: 16, vertical: 6`
- Border: gold `withValues(alpha:0.7)`

---

## What Does NOT Change

| Component | Status |
|-----------|--------|
| `_buildTopBar()` | Unchanged |
| `_buildActionBar()` | Unchanged |
| `_buildSocialButtons()` | Unchanged |
| `_buildGiftTray()` | Unchanged |
| `_buildChatPanel()` | Unchanged |
| `_buildReconnectingBanner()` | Unchanged |
| `_buildResult()` | Unchanged |
| All socket listeners | Unchanged |
| All ValueNotifiers | Unchanged |
| `SoundService` calls | Unchanged |
| `PracticeEngine` | Unchanged |
| `_ReactionBubble` | Unchanged |
| `_HostessWidget` | Unchanged |
| `_ThinkingDots` | Unchanged |
| `CoinRainWidget` | Unchanged |

## Classes Removed
- `_SeatTimer` — replaced by inline `CircularProgressIndicator` inside `_buildPlayerSeat()`

## Files Changed
| File | Change |
|------|--------|
| `mobile/lib/features/games/teen_patti/game_page.dart` | Replace `_buildFelt`, `_buildSeatsAndCenter`, `_buildPlayerSeat`, `_buildCard`, `_buildCardBack`, `_buildMyHand`, `_buildMyChips`, `_potChip`. Remove `_SeatTimer` class. Add `_seatPositions` constant. |
