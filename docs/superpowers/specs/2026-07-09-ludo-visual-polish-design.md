# Ludo Board/Token Visual Polish

**Status:** Approved
**Scope:** Presentation-layer only, `mobile/lib/features/games/ludo/`

## Problem

The Ludo board and tokens currently look flat and basic compared to mainstream
mobile Ludo games (reference: Ludo King style, see `images.jpg` provided by
user). The board's corner quadrants, path cells, and home lanes are painted as
solid flat colors with no gradients/bevels, and tokens are a flat
`Icons.location_pin` marker instead of a glossy 3D piece. The dice-roll sound
effect (`Sfx.diceRoll` → `dice_roll.mp3`, a bell-like sound) is also
unwanted and should be silenced.

Investigation during design confirmed the dice widget (`_DiceWidget` in
`ludo_game_page.dart`) already has a gradient face, pip rendering, and a
rotate+scale tumble animation — it does not need rework. The screen backdrop
is already a purple/violet radial gradient matching the app's existing theme
— it does not need to become a dark navy backdrop as in the reference image;
only the white board surface itself needs richer rendering.

## Non-goals

- No changes to `ludo_engine.dart` (game rules/logic).
- No changes to `SocketService`/`/ws` wiring, seat assignment, AFK handling,
  or any other state-race-sensitive logic fixed in commit `872d073`.
- No changes to `LudoState`, `tokenPosition()`, or the coordinate tables
  (`_track`, `_homeLanes`, `_baseDots`, `kSafeCells`) in `ludo_board.dart` —
  game logic depends on these being unchanged.
- No dice animation changes — already satisfactory.
- No screen backdrop changes — already satisfactory (purple/gold theme).
- No architectural rewrite (e.g. Flame engine) — rejected during design as
  unnecessary risk to recently-stabilized socket/state logic.

## Design

### 1. Board painter (`_BoardPainter` in `ludo_board.dart`)

Replace flat `Paint()..color = X` fills with gradients/subtle shading:

- **Corner home quadrants** (`_drawBaseQuadrant`): currently one flat 6×6
  color block. Change to a colored outer frame with a white rounded-rect
  inset "tray" in the center (matching the reference image), sized to hold
  the 4 base token dots. The existing active-seat "breathing glow" stroke
  logic is unchanged, just repositioned to outline the new frame shape.
- **Path cells**: add a very subtle gradient/inner shadow instead of flat
  `_cellFill`, to read less flat without hurting cell-boundary legibility.
- **Home lanes**: colored fill gets a subtle linear gradient instead of flat
  color, consistent with corner quadrants.
- **Center triangles** (`_drawCenter`): add gradient shading per triangle.
- Board frame (outer container in `LudoBoard.build`): keep existing
  rounded-rect + border + drop shadow; no change needed there, it already
  reads reasonably close to the reference.
- Geometry (`_track`, `_homeLanes`, `_baseDots`, cell math) is unchanged —
  only paint calls change.

### 2. Tokens (`_Token` in `ludo_board.dart`)

Replace the `Icons.location_pin` shape with a glossy 3D pawn/pin piece:

- Rounded pawn/bowling-pin silhouette (wider rounded body narrowing toward
  top), built via a custom shape (`CustomPainter` or layered
  `Container`/`ClipPath`) rather than a Material icon.
- Radial gradient shading on the body (lighter top-left highlight, darker
  base) using the existing seat color as the base hue.
- Elliptical drop shadow beneath the token (separate from the existing
  `highlighted`-state glow ring, which is kept as-is).
- Existing token number badge (white circle + colored number) is kept,
  repositioned to sit on the pawn's head.
- Positioning/animation mechanics (`AnimatedPositioned`, 340ms,
  `Curves.easeOutBack`) are unchanged — only the token's own rendered
  appearance changes.

### 3. Dice

No changes. `_DiceWidget` in `ludo_game_page.dart` already has gradient face,
pip rendering, and tumble animation.

### 4. Layout/spacing

Light-touch review pass of padding/sizing around the board, `_playersBar`,
and activity log inside `ludo_game_page.dart`'s build method, for visual
crowding — no widget-tree restructuring.

### 5. Sound

Remove/no-op the three `SoundService.instance.play(Sfx.diceRoll)` call sites
in `ludo_game_page.dart` (lines ~146, ~179, ~246 as of this writing) so the
bell sound no longer plays on dice roll. The `dice_roll.mp3` asset file stays
on disk unchanged, for a future replacement sound.

## What stays untouched

- `ludo_engine.dart` — all game rules.
- `SocketService` / `/ws` event wiring.
- Seat assignment, AFK handling, turn/state-race logic.
- `LudoState` data model and `tokenPosition()` coordinate math.
- Offline bot logic (`_initOffline`, `chooseBotToken`, etc).
- Dice widget and screen backdrop gradient.

## Testing / verification

This is a purely visual change with no new business logic, so no new unit
tests are needed. Verification is manual:

1. Run the app in offline practice mode (`offline: true`, no server needed)
   to see the board/tokens render.
2. Visually confirm: corner quadrants show colored frame + white inset tray,
   path/home-lane cells show subtle gradient shading, tokens render as
   glossy 3D pawns with correct seat colors, number badges still legible.
3. Confirm tap-to-move still works — `movable` highlighting and
   `onTokenTap` callback are unaffected by the visual-only changes.
4. Confirm turn-highlighting (active-seat breathing glow) still renders
   correctly against the new quadrant shape.
5. Confirm dice roll no longer plays the bell sound, and that dice
   animation/value display is otherwise unaffected.
6. Spot-check on a couple of screen sizes (or resize the window/emulator) to
   confirm the new token shape doesn't clip or overlap awkwardly at small
   board sizes.
