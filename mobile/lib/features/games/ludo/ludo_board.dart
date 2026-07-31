import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'ludo_engine.dart';

// ── Coordinate tables (UNCHANGED — game logic depends on these) ───────────────

const List<List<int>> _track = [
  [6, 13],
  [6, 12],
  [6, 11],
  [6, 10],
  [6, 9],
  [5, 8],
  [4, 8],
  [3, 8],
  [2, 8],
  [1, 8],
  [0, 8],
  [0, 7],
  [0, 6],
  [1, 6],
  [2, 6],
  [3, 6],
  [4, 6],
  [5, 6],
  [6, 5],
  [6, 4],
  [6, 3],
  [6, 2],
  [6, 1],
  [6, 0],
  [7, 0],
  [8, 0],
  [8, 1],
  [8, 2],
  [8, 3],
  [8, 4],
  [8, 5],
  [9, 6],
  [10, 6],
  [11, 6],
  [12, 6],
  [13, 6],
  [14, 6],
  [14, 7],
  [14, 8],
  [13, 8],
  [12, 8],
  [11, 8],
  [10, 8],
  [9, 8],
  [8, 9],
  [8, 10],
  [8, 11],
  [8, 12],
  [8, 13],
  [8, 14],
  [7, 14],
  [6, 14],
];

const List<List<List<int>>> _homeLanes = [
  [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
    [7, 8]
  ],
  [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7]
  ],
  [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6]
  ],
  [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
    [8, 7]
  ],
];

const List<List<List<double>>> _baseDots = [
  [
    [1.5, 10.5],
    [3.5, 10.5],
    [1.5, 12.5],
    [3.5, 12.5]
  ],
  [
    [1.5, 1.5],
    [3.5, 1.5],
    [1.5, 3.5],
    [3.5, 3.5]
  ],
  [
    [10.5, 1.5],
    [12.5, 1.5],
    [10.5, 3.5],
    [12.5, 3.5]
  ],
  [
    [10.5, 10.5],
    [12.5, 10.5],
    [10.5, 12.5],
    [12.5, 12.5]
  ],
];

// Flat "Ludo King"–style seat colors, mapped so corners match the reference
// board layout: seat0 = red (bottom-left), seat1 = green (top-left),
// seat2 = yellow (top-right), seat3 = blue (bottom-right).
// Sourced from AppColors.ludo* so the rest of the Ludo screen (avatars, chips,
// turn borders) always matches these exact token colors — see app_theme.dart.
const List<Color> _seatColors = [
  AppColors.ludoRed,
  AppColors.ludoGreen,
  AppColors.ludoYellow,
  AppColors.ludoBlue,
];

// Board surface + grid tones — flat "Ludo King" look: pure white cells, a thin
// medium-grey grid, and dark hollow safe-cell stars.
const Color _boardBg = Color(0xFFFFFFFF);
const Color _cellFill = Color(0xFFFFFFFF);
const Color _cellLine = Color(0xFF6E6E6E);
const Color _starOutline = Color(0xFF3A3A3A);

// Flat solid fill — the reference board uses pure flat colors with no gloss or
// gradient. Kept as a helper so every colored region shares one code path.
Paint _flatFill(Color base) => Paint()..color = base;

Offset _cellCenter(num col, num row, double size) {
  final s = size / 15.0;
  return Offset((col + 0.5) * s, (row + 0.5) * s);
}

Offset tokenPosition(int seatIndex, int tokenIndex, int progress, double size) {
  if (progress == -1) {
    // _baseDots are already-centered pixel-grid coordinates (e.g. 1.5, 10.5)
    // — same values _drawBaseQuadrant uses directly for the slot circles.
    // Do NOT route through _cellCenter, which adds another +0.5 cell offset
    // and was shifting every base token away from its drawn circle.
    final d = _baseDots[seatIndex % 4][tokenIndex % 4];
    final s = size / 15.0;
    return Offset(d[0] * s, d[1] * s);
  }
  if (progress <= 50) {
    final cell = _track[absoluteCell(seatIndex, progress)];
    return _cellCenter(cell[0], cell[1], size);
  }
  if (progress <= 55) {
    final cell = _homeLanes[seatIndex % 4][progress - 51];
    return _cellCenter(cell[0], cell[1], size);
  }
  // progress 56 lands on the home lane's 6th cell, which sits geometrically
  // inside the centre triangle (same coordinates as _goalCentroid below) —
  // falling through here keeps it visually and key-wise identical to
  // "finished" instead of a separate state that silently overlapped it.
  // Finished: rest at the centroid of this seat's own goal triangle. When
  // several of the same colour finish, _buildTokens clusters them with the
  // same tight diamond offsets used everywhere else tokens share a cell —
  // so the goal looks like every other stack on the board, not a spread-out
  // row that can crowd toward the triangle's edge.
  return _goalCentroid(seatIndex, size);
}

// Centroid of this seat's own goal triangle, matching _drawCenter's
// triangle assignment (top=seat2 yellow, right=seat3 blue, bottom=seat0
// red, left=seat1 green). Staying at the centroid keeps clustered tokens
// well inside the coloured area regardless of how many share it.
Offset _goalCentroid(int seatIndex, double size) {
  final s = size / 15.0;
  switch (seatIndex % 4) {
    case 0: // red — bottom triangle
      return Offset(7.5 * s, 8.5 * s);
    case 1: // green — left triangle
      return Offset(6.5 * s, 7.5 * s);
    case 2: // yellow — top triangle
      return Offset(7.5 * s, 6.5 * s);
    default: // blue — right triangle
      return Offset(8.5 * s, 7.5 * s);
  }
}

// ── Board widget ─────────────────────────────────────────────────────────────

class LudoBoard extends StatefulWidget {
  final LudoState state;
  final int? mySeatIndex;
  final void Function(int playerIdx, int tokenIndex)? onTokenTap;

  const LudoBoard({
    super.key,
    required this.state,
    this.mySeatIndex,
    this.onTokenTap,
  });

  @override
  State<LudoBoard> createState() => _LudoBoardState();
}

class _LudoBoardState extends State<LudoBoard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _breathingCtrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _breathingCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      final outer = constraints.maxWidth;
      const framePad = 4.0;
      final boardSize = outer - framePad * 2;

      return Container(
        width: outer,
        height: outer,
        padding: const EdgeInsets.all(framePad),
        // Clean white board with a thin dark edge, floating on the backdrop.
        decoration: BoxDecoration(
          color: _boardBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFF23233A), width: 2),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.35),
              blurRadius: 20,
              spreadRadius: 1,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: SizedBox(
          width: boardSize,
          height: boardSize,
          child: Stack(children: [
            // Only the board surface repaints on the breathing tick; the token
            // sprites keep their own movement animations and must not be torn
            // down 60×/sec, so they live outside this AnimatedBuilder.
            AnimatedBuilder(
              animation: _breathingCtrl,
              builder: (context, _) {
                final activeSeat =
                    widget.state.players[widget.state.currentTurn].seat - 1;
                return CustomPaint(
                  size: Size(boardSize, boardSize),
                  painter: _BoardPainter(
                    activeSeatIndex: activeSeat,
                    breathing: _breathingCtrl.value,
                    mySeatIndex: widget.mySeatIndex,
                  ),
                );
              },
            ),
            ..._buildTokens(boardSize),
          ]),
        ),
      );
    });
  }

  List<Widget> _buildTokens(double size) {
    final base = <Widget>[];
    final onTop = <Widget>[];
    final s = size / 15.0;
    final tokenSize = s * 1.28; // Increased from 1.05 for larger tokens!

    // Compute overlapping tokens grouping
    final cellGroups = <String, List<MapEntry<int, int>>>{};
    for (var pi = 0; pi < widget.state.players.length; pi++) {
      final player = widget.state.players[pi];
      final seatIdx = (player.seat - 1).clamp(0, 3);
      for (var ti = 0; ti < player.tokens.length; ti++) {
        final prog = player.tokens[ti];
        if (prog == -1) continue;

        String cellKey;
        if (prog <= 50) {
          cellKey = 'track_${absoluteCell(seatIdx, prog)}';
        } else if (prog < kHomeProgress - 1) {
          cellKey = 'home_${seatIdx}_$prog';
        } else {
          cellKey = 'goal_$seatIdx';
        }
        cellGroups.putIfAbsent(cellKey, () => []).add(MapEntry(pi, ti));
      }
    }

    for (var pi = 0; pi < widget.state.players.length; pi++) {
      final player = widget.state.players[pi];
      final seatIdx = (player.seat - 1).clamp(0, 3);
      final color = _seatColors[seatIdx];
      final isMine = widget.mySeatIndex == pi;
      final canMoveNow = pi == widget.state.currentTurn &&
          widget.state.awaiting == 'move' &&
          (widget.mySeatIndex == null || isMine);

      final isActiveTurnPlayer = pi == widget.state.currentTurn;

      for (var ti = 0; ti < player.tokens.length; ti++) {
        final progress = player.tokens[ti];
        final movable = canMoveNow && widget.state.movableTokens.contains(ti);

        // Get overlap style
        Offset offset = Offset.zero;
        double scale = 1.0;

        if (progress != -1) {
          String cellKey;
          if (progress <= 50) {
            cellKey = 'track_${absoluteCell(seatIdx, progress)}';
          } else if (progress < kHomeProgress - 1) {
            cellKey = 'home_${seatIdx}_$progress';
          } else {
            cellKey = 'goal_$seatIdx';
          }
          final list = cellGroups[cellKey] ?? [];
          final count = list.length;
          if (count > 1) {
            final idx = list.indexWhere((e) => e.key == pi && e.value == ti);
            if (idx != -1) {
              if (count == 2) {
                final offsets = [
                  Offset(-s * 0.18, -s * 0.18),
                  Offset(s * 0.18, s * 0.18),
                ];
                offset = offsets[idx % 2];
                scale = 0.75;
              } else if (count == 3) {
                final offsets = [
                  Offset(0, -s * 0.20),
                  Offset(-s * 0.20, s * 0.16),
                  Offset(s * 0.20, s * 0.16),
                ];
                offset = offsets[idx % 3];
                scale = 0.68;
              } else {
                final offsets = [
                  Offset(-s * 0.20, -s * 0.20),
                  Offset(s * 0.20, -s * 0.20),
                  Offset(-s * 0.20, s * 0.20),
                  Offset(s * 0.20, s * 0.20),
                ];
                offset = offsets[idx % 4];
                scale = 0.60;
              }
            }
          }
        }

        final sprite = _TokenSprite(
          key: ValueKey('tok_${pi}_$ti'),
          seatIndex: seatIdx,
          tokenIndex: ti,
          progress: progress,
          boardSize: size,
          tokenSize: tokenSize,
          color: color,
          number: ti + 1,
          highlighted: movable,
          bouncing: isActiveTurnPlayer,
          mySeatIndex: widget.mySeatIndex,
          positionOffset: offset,
          scaleFactor: scale,
          onTap: movable ? () => widget.onTokenTap?.call(pi, ti) : null,
        );
        (movable ? onTop : base).add(sprite);
      }
    }
    return [...base, ...onTop];
  }
}

// ── Smooth path position ─────────────────────────────────────────────────────

// Pixel position for a *fractional* progress value: interpolates in a straight
// line between the two adjacent cells so a token visibly travels the path
// cell-by-cell. Base (-1) and integer endpoints fall back to the exact
// tokenPosition() coordinate.
Offset _tokenPixel(int seat, int tokenIdx, double progress, double size,
    [int? mySeatIndex]) {
  Offset raw;
  if (progress <= 0) {
    raw = tokenPosition(seat, tokenIdx, progress.round(), size);
  } else {
    final lo = progress.floor();
    final hi = progress.ceil();
    if (lo == hi) {
      raw = tokenPosition(seat, tokenIdx, lo, size);
    } else {
      final a = tokenPosition(seat, tokenIdx, lo, size);
      final b = tokenPosition(seat, tokenIdx, hi, size);
      final t = progress - lo;
      raw = Offset(a.dx + (b.dx - a.dx) * t, a.dy + (b.dy - a.dy) * t);
    }
  }

  if (mySeatIndex == null) return raw;
  final rotationAngle = ((4 - mySeatIndex) % 4) * (math.pi / 2);
  if (rotationAngle == 0) return raw;

  final center = Offset(size / 2, size / 2);
  final s = math.sin(rotationAngle);
  final c = math.cos(rotationAngle);
  final x = raw.dx - center.dx;
  final y = raw.dy - center.dy;
  final xNew = x * c - y * s;
  final yNew = x * s + y * c;
  return Offset(xNew + center.dx, yNew + center.dy);
}

// ── Animated token sprite ────────────────────────────────────────────────────

// Owns the per-token movement/capture/home animations. Fills the board (so it
// can place its token anywhere) but only the small token box is hit-testable.
class _TokenSprite extends StatefulWidget {
  final int seatIndex;
  final int tokenIndex;
  final int progress;
  final double boardSize;
  final double tokenSize;
  final Color color;
  final int number;
  final bool highlighted;
  final bool bouncing;
  final int? mySeatIndex;
  final Offset positionOffset;
  final double scaleFactor;
  final VoidCallback? onTap;

  const _TokenSprite({
    super.key,
    required this.seatIndex,
    required this.tokenIndex,
    required this.progress,
    required this.boardSize,
    required this.tokenSize,
    required this.color,
    required this.number,
    required this.highlighted,
    required this.bouncing,
    this.mySeatIndex,
    required this.positionOffset,
    required this.scaleFactor,
    this.onTap,
  });

  @override
  State<_TokenSprite> createState() => _TokenSpriteState();
}

class _TokenSpriteState extends State<_TokenSprite>
    with TickerProviderStateMixin {
  // Fractional progress currently rendered (drives the pixel position).
  late double _display = widget.progress.toDouble();

  // Cell-to-cell travel.
  late final AnimationController _move = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 300));
  double _from = 0, _to = 0;
  // Real destination progress for this move. Usually equals _to, except when
  // the move ends at 57 (finished) — see _animateSteps.
  double _finalValue = 0;
  int _lastTick = 0;

  // One-shot flourish: capture pop-in (sent home) and home-arrival bounce.
  late final AnimationController _fx = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 520));
  bool _homeFlourish = false; // true = home bounce, false = capture pop

  @override
  void didUpdateWidget(covariant _TokenSprite old) {
    super.didUpdateWidget(old);
    if (widget.progress == old.progress) return;
    final from = old.progress, to = widget.progress;

    if (to == -1 && from >= 0) {
      // Captured → slide back to 0, then snap to base slot (-1)
      _animateCapture(from.toDouble());
    } else if (from < 0 && to >= 0) {
      // Entering the board from base — snap on with a small pop.
      _display = to.toDouble();
      _homeFlourish = false;
      _fx.forward(from: 0);
      setState(() {});
    } else if (to > from) {
      _animateSteps(from.toDouble(), to.toDouble());
    } else {
      _display = to.toDouble();
      setState(() {});
    }
  }

  void _animateCapture(double from) {
    _from = from;
    _to = 0.0;
    _lastTick = from.floor();

    // Slide back in ~750ms
    _move.duration = const Duration(milliseconds: 750);
    _move.reset();

    late void Function(AnimationStatus) captureListener;
    captureListener = (st) {
      if (st == AnimationStatus.completed) {
        _move.removeStatusListener(captureListener);
        setState(() {
          _display = -1.0;
          _homeFlourish = false;
        });
        _fx.forward(from: 0);
      }
    };
    _move.addStatusListener(captureListener);
    _move.forward();
  }

  void _animateSteps(double from, double to) {
    _from = from;
    _finalValue = to;
    // Progress 56 (last home-lane cell) and 57 (finished) render at the
    // identical pixel — both are the goal triangle's centroid. Animating a
    // full step between them covers zero visual distance, so the token
    // would freeze in the goal square for an extra beat before "landing".
    // Cap the animated target at 56 and snap straight to the real value
    // (_finalValue) on completion instead.
    _to = to > 56 ? 56.0 : to;
    _lastTick = from.floor();
    final steps = (_to - from).abs();
    // ~150ms per cell, clamped, so a 6-step move reads clearly without dragging.
    _move.duration =
        Duration(milliseconds: (150 * steps).round().clamp(200, 1400));
    _move
      ..reset()
      ..forward();
  }

  void _onMoveTick() {
    final v = Curves.easeInOut.transform(_move.value);
    setState(() => _display = _from + (_to - _from) * v);
    final cell = _display.floor();
    if (cell != _lastTick) {
      _lastTick = cell;
      // Per-cell "tik" — the signature Ludo stepping sound.
      SoundService.instance.play(Sfx.tokenMove, volume: 0.65);
    }
  }

  void _onMoveDone(AnimationStatus st) {
    if (st != AnimationStatus.completed) return;
    _display = _finalValue;
    // Landing feedback: home arrival flourish, else a safe-cell chime.
    if (_finalValue >= 57) {
      _homeFlourish = true;
      _fx.forward(from: 0);
    } else if (_to <= 50) {
      final cell = absoluteCell(widget.seatIndex, _to.round());
      if (cell != -1 && kSafeCells.contains(cell)) {
        SoundService.instance.play(Sfx.ludoSafe, volume: 0.8);
      }
    }
    if (mounted) setState(() {});
  }

  @override
  void initState() {
    super.initState();
    _move.addListener(_onMoveTick);
    _move.addStatusListener(_onMoveDone);
  }

  @override
  void dispose() {
    _move.dispose();
    _fx.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rawPos = _tokenPixel(widget.seatIndex, widget.tokenIndex, _display,
        widget.boardSize, widget.mySeatIndex);
    final pos = rawPos + widget.positionOffset;

    // Hop arc while stepping: lifts the token between cells.
    final frac = _display - _display.floorToDouble();
    final moving = _move.isAnimating;
    final hop =
        moving ? math.sin(frac * math.pi) * widget.tokenSize * 0.32 : 0.0;

    // A tight, token-sized Positioned (NOT a full-board overlay) so each token
    // only claims its own hit-box — full-board layers were swallowing taps for
    // tokens sharing a cell. This sprite is a direct child of the board Stack,
    // so returning a Positioned here is valid.
    final visual = AnimatedBuilder(
      animation: _fx,
      builder: (context, child) {
        if (!_fx.isAnimating && _fx.value == 0) return child!;
        final t = _fx.value;
        // Home flourish: overshoot bounce. Capture pop: quick punch-in.
        final scale = _homeFlourish
            ? 1.0 + 0.35 * math.sin(t * math.pi)
            : (1.0 + 0.6 * (1 - t) * (t < 0.2 ? t / 0.2 : 1));
        return Transform.scale(scale: scale, child: child);
      },
      child: Transform.scale(
        scale: widget.scaleFactor,
        child: _Token(
          color: widget.color,
          number: widget.number,
          highlighted: widget.highlighted,
          bouncing: widget.bouncing && !moving,
        ),
      ),
    );

    // Only a movable token is interactive: it gets an opaque hit-box (whole
    // square tappable, even where the pawn art is transparent). Non-movable
    // tokens are wrapped in IgnorePointer so they can NEVER absorb a tap meant
    // for a movable token sharing/overlapping their cell.
    final tappable = widget.onTap != null;
    return Positioned(
      left: pos.dx - widget.tokenSize / 2,
      top: pos.dy - widget.tokenSize / 2 - hop,
      width: widget.tokenSize,
      height: widget.tokenSize,
      child: tappable
          ? GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: widget.onTap,
              child: visual,
            )
          : IgnorePointer(child: visual),
    );
  }
}

// ── Token widget — glossy 3D pawn marker ─────────────────────────────────────

// Head (the ball the number sits in) is centered at this fraction of the
// token's height — shared between the painter, the highlight glow, and the
// number badge so they all line up on the same spot. The whole pawn
// (head + neck + base + drop shadow) must fit inside a single sz×sz box.
const double _pawnHeadCenterY = 0.24;
const double _pawnHeadRadius = 0.26; // fraction of width

class _Token extends StatelessWidget {
  final Color color;
  final int number;
  final bool highlighted;
  final bool bouncing;
  const _Token({
    required this.color,
    required this.number,
    required this.highlighted,
    this.bouncing = false,
  });

  @override
  Widget build(BuildContext context) {
    Widget pin = LayoutBuilder(builder: (context, c) {
      final sz = c.maxWidth;
      final headCenter = Offset(sz * 0.5, sz * _pawnHeadCenterY);
      final headR = sz * _pawnHeadRadius;

      return SizedBox(
        width: sz,
        height: sz,
        child: Stack(
          alignment: Alignment.topCenter,
          clipBehavior: Clip.none,
          children: [
            if (highlighted)
              Positioned(
                left: headCenter.dx - headR * 1.05,
                top: headCenter.dy - headR * 1.05,
                child: Container(
                  width: headR * 2.1,
                  height: headR * 2.1,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(alpha: 0.85),
                        blurRadius: 14,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                ),
              ),
            CustomPaint(
              size: Size(sz, sz),
              painter: _PawnPainter(color: color),
            ),
            // White head disc with the token number, centered on the pawn head.
            Positioned(
              left: headCenter.dx - sz * 0.23,
              top: headCenter.dy - sz * 0.23,
              child: Container(
                width: sz * 0.46,
                height: sz * 0.46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(
                      color: color.withValues(alpha: 0.55), width: 1),
                ),
                alignment: Alignment.center,
                child: Text(
                  '$number',
                  style: TextStyle(
                    color: color,
                    fontSize: sz * 0.24,
                    fontWeight: FontWeight.w900,
                    height: 1,
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    });

    if (highlighted) return _BouncingToken(child: pin);
    // Gentler jump for "it's this player's turn" vs the stronger bounce a
    // tap-ready token gets — keeps the turn cue readable without every
    // token on an active player's side looking equally urgent/tappable.
    if (bouncing) return _BouncingToken(intensity: 0.45, child: pin);
    return pin;
  }
}

// Paints a glossy 3D bowling-pin/pawn silhouette (round head, tapered neck,
// rounded base) with a radial highlight and an elliptical drop shadow.
class _PawnPainter extends CustomPainter {
  final Color color;
  const _PawnPainter({required this.color});

  Path _pinPath(double w, double h) {
    final headC = Offset(w * 0.5, h * _pawnHeadCenterY);
    final headR = w * _pawnHeadRadius;
    final head = Path()..addOval(Rect.fromCircle(center: headC, radius: headR));

    final baseRect = Rect.fromCenter(
        center: Offset(w * 0.5, h * 0.66), width: w * 0.60, height: h * 0.20);
    final base = Path()
      ..addRRect(RRect.fromRectAndRadius(
          baseRect, Radius.circular(baseRect.height / 2)));

    final neck = Path()
      ..moveTo(w * 0.32, h * 0.32)
      ..lineTo(w * 0.68, h * 0.32)
      ..lineTo(w * 0.63, h * 0.58)
      ..lineTo(w * 0.37, h * 0.58)
      ..close();

    return Path.combine(
      PathOperation.union,
      Path.combine(PathOperation.union, head, neck),
      base,
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final path = _pinPath(w, h);

    // Elliptical drop shadow beneath the base.
    final shadowRect = Rect.fromCenter(
        center: Offset(w * 0.5, h * 0.80), width: w * 0.62, height: h * 0.08);
    canvas.drawOval(
      shadowRect,
      Paint()
        ..color = Colors.black.withValues(alpha: 0.35)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3.0),
    );

    // Glossy radial-gradient body — light source top-left.
    final bounds = path.getBounds();
    final gloss = Paint()
      ..shader = ui.Gradient.radial(
        Offset(bounds.left + bounds.width * 0.35,
            bounds.top + bounds.height * 0.28),
        bounds.longestSide * 0.9,
        [
          Color.lerp(color, Colors.white, 0.55)!,
          color,
          Color.lerp(color, Colors.black, 0.30)!,
        ],
        const [0.0, 0.55, 1.0],
      );
    canvas.drawPath(path, gloss);
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = Colors.black.withValues(alpha: 0.25),
    );

    // Small highlight streak for extra gloss.
    final highlightC = Offset(w * 0.40, h * 0.20);
    canvas.drawOval(
      Rect.fromCenter(center: highlightC, width: w * 0.18, height: h * 0.10),
      Paint()..color = Colors.white.withValues(alpha: 0.55),
    );
  }

  @override
  bool shouldRepaint(covariant _PawnPainter old) => old.color != color;
}

class _BouncingToken extends StatefulWidget {
  final Widget child;
  final double intensity;
  const _BouncingToken({required this.child, this.intensity = 1.0});
  @override
  State<_BouncingToken> createState() => _BouncingTokenState();
}

class _BouncingTokenState extends State<_BouncingToken>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 550),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, child) => Transform.translate(
        offset: Offset(0, -6 * widget.intensity * _ctrl.value),
        child: Transform.scale(
            scale: 1.0 + 0.06 * widget.intensity * _ctrl.value, child: child),
      ),
      child: widget.child,
    );
  }
}

// ── Board painter — bright classic Ludo ──────────────────────────────────────

class _BoardPainter extends CustomPainter {
  final int activeSeatIndex;
  final double breathing;
  final int? mySeatIndex;

  _BoardPainter(
      {required this.activeSeatIndex,
      required this.breathing,
      this.mySeatIndex});

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 15.0;

    final rotationAngle = ((4 - (mySeatIndex ?? 0)) % 4) * (math.pi / 2);
    if (rotationAngle != 0) {
      canvas.save();
      canvas.translate(size.width / 2, size.height / 2);
      canvas.rotate(rotationAngle);
      canvas.translate(-size.width / 2, -size.height / 2);
    }

    // 1. White board surface.
    canvas.drawRect(Offset.zero & size, Paint()..color = _boardBg);

    // 2. Coloured corner homes (6×6) with a white token tray.
    _drawBaseQuadrant(canvas, s, 0, 9, _seatColors[0], 0); // BL – red
    _drawBaseQuadrant(canvas, s, 0, 0, _seatColors[1], 1); // TL – green
    _drawBaseQuadrant(canvas, s, 9, 0, _seatColors[2], 2); // TR – yellow
    _drawBaseQuadrant(canvas, s, 9, 9, _seatColors[3], 3); // BR – blue

    // 3. Path cells (flat white with a thin grid). Only the four mid-arm safe
    //    cells carry a hollow dark star — the coloured start cells (which are
    //    also in kSafeCells) instead show a directional arrow, matching the
    //    reference board.
    for (var i = 0; i < _track.length; i++) {
      final c = _track[i];
      final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
      canvas.drawRect(rect, Paint()..color = _cellFill);
      canvas.drawRect(
        rect,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.1
          ..color = _cellLine,
      );
      if (kSafeCells.contains(i) && !kStartOffsets.contains(i)) {
        _drawStar(canvas, rect.center, s * 0.34,
            color: _starOutline, fill: false, stroke: 1.6);
      }
    }

    // 4. Coloured home lanes + coloured start cells + entrance arrows.
    // Each arm's directional arrow sits on the white cell at the very mouth of
    // the arm (mid-edge), drawn in the seat colour — exactly like the reference.
    const entranceCells = <List<int>>[
      [7, 14], // seat0 red   – bottom, arrow up
      [0, 7], // seat1 green  – left,   arrow right
      [7, 0], // seat2 yellow – top,    arrow down
      [14, 7], // seat3 blue   – right,  arrow left
    ];
    for (var seat = 0; seat < 4; seat++) {
      final color = _seatColors[seat];
      for (var j = 0; j < _homeLanes[seat].length; j++) {
        final c = _homeLanes[seat][j];
        final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
        canvas.drawRect(rect, _flatFill(color));
        canvas.drawRect(
          rect,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.1
            ..color = _cellLine.withValues(alpha: 0.55),
        );
      }

      // Flat coloured start cell (no star — the arrow marks the entrance).
      final startCoord = _track[kStartOffsets[seat]];
      final sr = Rect.fromLTWH(startCoord[0] * s, startCoord[1] * s, s, s);
      canvas.drawRect(sr, _flatFill(color));
      canvas.drawRect(
        sr,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.1
          ..color = _cellLine,
      );

      // Seat-coloured entrance arrow on the white mouth cell.
      final ec = entranceCells[seat];
      final ecCenter = Offset((ec[0] + 0.5) * s, (ec[1] + 0.5) * s);
      _drawArrow(canvas, ecCenter, s * 0.26, seat, color);
    }

    // 5. Centre — four bright triangles meeting at the middle.
    _drawCenter(canvas, s);

    if (rotationAngle != 0) {
      canvas.restore();
    }
  }

  // ── Corner home ────────────────────────────────────────────────────────────

  void _drawBaseQuadrant(
      Canvas canvas, double s, int col, int row, Color color, int seatIndex) {
    final outer = Rect.fromLTWH(col * s, row * s, 6 * s, 6 * s);

    // Flat solid corner home.
    canvas.drawRect(outer, _flatFill(color));

    // Active-turn breathing glow (functional turn cue; the static reference art
    // can't show turns, so we keep a restrained white pulse on the home).
    if (seatIndex == activeSeatIndex) {
      canvas.drawRect(
        outer.deflate(2),
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white.withValues(alpha: 0.35 + 0.5 * breathing)
          ..strokeWidth = 3.0 + 3.0 * breathing
          ..maskFilter =
              MaskFilter.blur(BlurStyle.normal, 3.0 + 3.0 * breathing),
      );
    }

    // Thin outer separator.
    canvas.drawRect(
      outer,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = Colors.black.withValues(alpha: 0.20)
        ..strokeWidth = 1.0,
    );

    // Square white token tray (4×4) with a thin coloured border — the reference
    // tray is a plain square, only very slightly rounded.
    final inner = Rect.fromLTWH((col + 1) * s, (row + 1) * s, 4 * s, 4 * s);
    final innerRR = RRect.fromRectAndRadius(inner, Radius.circular(s * 0.12));
    canvas.drawRRect(innerRR, Paint()..color = Colors.white);
    canvas.drawRRect(
      innerRR,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = color
        ..strokeWidth = 2.0,
    );

    // Empty token slots — larger double-ring design filling the base area cleanly.
    for (final d in _baseDots[seatIndex]) {
      final center = Offset(d[0] * s, d[1] * s);
      canvas.drawCircle(
          center, s * 0.85, Paint()..color = color.withValues(alpha: 0.18));
      canvas.drawCircle(center, s * 0.70, Paint()..color = color);
      canvas.drawCircle(
        center,
        s * 0.70,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white
          ..strokeWidth = 1.6,
      );
    }
  }

  // ── Centre ───────────────────────────────────────────────────────────────

  void _drawCenter(Canvas canvas, double s) {
    final cx = 6 * s, cy = 6 * s, cs = 3 * s;
    final centre = Offset(7.5 * s, 7.5 * s);
    final rect = Rect.fromLTWH(cx, cy, cs, cs);

    canvas.drawRect(rect, Paint()..color = Colors.white);

    // Triangle colours follow the home lane feeding each side:
    // top = yellow(seat2), right = blue(seat3), bottom = red(seat0), left = green(seat1).
    final tris = <List<dynamic>>[
      [_seatColors[2], Offset(cx, cy), Offset(cx + cs, cy)], // top
      [_seatColors[3], Offset(cx + cs, cy), Offset(cx + cs, cy + cs)], // right
      [_seatColors[0], Offset(cx + cs, cy + cs), Offset(cx, cy + cs)], // bottom
      [_seatColors[1], Offset(cx, cy + cs), Offset(cx, cy)], // left
    ];
    for (final t in tris) {
      final path = Path()
        ..moveTo((t[1] as Offset).dx, (t[1] as Offset).dy)
        ..lineTo((t[2] as Offset).dx, (t[2] as Offset).dy)
        ..lineTo(centre.dx, centre.dy)
        ..close();
      canvas.drawPath(path, _flatFill(t[0] as Color));
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.black.withValues(alpha: 0.25)
          ..strokeWidth = 1.0,
      );
    }

    canvas.drawRect(
      rect,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFF23233A)
        ..strokeWidth = 1.2,
    );
  }

  // ── 5-point star (safe / start cells) ────────────────────────────────────

  void _drawStar(Canvas canvas, Offset c, double outerR,
      {required Color color, required bool fill, double stroke = 1.5}) {
    final innerR = outerR * 0.42;
    final path = Path();
    for (var i = 0; i < 10; i++) {
      final r = i.isEven ? outerR : innerR;
      final a = -math.pi / 2 + i * math.pi / 5;
      final p = Offset(c.dx + r * math.cos(a), c.dy + r * math.sin(a));
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    path.close();
    canvas.drawPath(
      path,
      Paint()
        ..style = fill ? PaintingStyle.fill : PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeJoin = StrokeJoin.round
        ..color = color,
    );
  }

  // ── Arrow into a home lane ───────────────────────────────────────────────

  void _drawArrow(Canvas canvas, Offset c, double r, int seat, Color color) {
    // seat0 up, seat1 right, seat2 down, seat3 left (points into the board).
    const angles = [-math.pi / 2, 0.0, math.pi / 2, math.pi];
    final angle = angles[seat];
    final tip = Offset(c.dx + r * math.cos(angle), c.dy + r * math.sin(angle));
    final b1 = Offset(c.dx + r * 0.75 * math.cos(angle + math.pi * 0.6),
        c.dy + r * 0.75 * math.sin(angle + math.pi * 0.6));
    final b2 = Offset(c.dx + r * 0.75 * math.cos(angle - math.pi * 0.6),
        c.dy + r * 0.75 * math.sin(angle - math.pi * 0.6));
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo(b1.dx, b1.dy)
      ..lineTo(b2.dx, b2.dy)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _BoardPainter old) =>
      old.activeSeatIndex != activeSeatIndex || old.breathing != breathing;
}
