import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'ludo_engine.dart';

// ── Coordinate tables (UNCHANGED — game logic depends on these) ───────────────

const List<List<int>> _track = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
];

const List<List<List<int>>> _homeLanes = [
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];

const List<List<List<double>>> _baseDots = [
  [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
  [[1.5, 1.5],  [3.5, 1.5],  [1.5, 3.5],  [3.5, 3.5]],
  [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  [[10.5, 10.5],[12.5, 10.5],[10.5, 12.5],[12.5, 12.5]],
];

// Bright classic seat colors, mapped so corners match the reference board:
// seat0 = red (bottom-left), seat1 = blue (top-left),
// seat2 = yellow (top-right), seat3 = green (bottom-right).
const List<Color> _seatColors = [
  Color(0xFFE33B3B), // red
  Color(0xFF1E7FD6), // blue
  Color(0xFFF7C815), // yellow
  Color(0xFF1FA855), // green
];

// Board surface + grid tones (classic bright look).
const Color _boardBg = Color(0xFFFFFFFF);
const Color _cellFill = Color(0xFFFFFFFF);
const Color _cellLine = Color(0xFF8A8A8A);
const Color _starOutline = Color(0xFF9AA0A6);

Offset _cellCenter(num col, num row, double size) {
  final s = size / 15.0;
  return Offset((col + 0.5) * s, (row + 0.5) * s);
}

Offset tokenPosition(int seatIndex, int tokenIndex, int progress, double size) {
  if (progress == -1) {
    final d = _baseDots[seatIndex % 4][tokenIndex % 4];
    return _cellCenter(d[0], d[1], size);
  }
  if (progress <= 50) {
    final cell = _track[absoluteCell(seatIndex, progress)];
    return _cellCenter(cell[0], cell[1], size);
  }
  if (progress <= 56) {
    final cell = _homeLanes[seatIndex % 4][progress - 51];
    return _cellCenter(cell[0], cell[1], size);
  }
  return _cellCenter(7, 7, size);
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
      const framePad = 8.0;
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
              color: Colors.black.withOpacity(0.35),
              blurRadius: 20,
              spreadRadius: 1,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: SizedBox(
          width: boardSize,
          height: boardSize,
          child: AnimatedBuilder(
            animation: _breathingCtrl,
            builder: (context, _) {
              final activeSeat =
                  widget.state.players[widget.state.currentTurn].seat - 1;
              return Stack(children: [
                CustomPaint(
                  size: Size(boardSize, boardSize),
                  painter: _BoardPainter(
                    activeSeatIndex: activeSeat,
                    breathing: _breathingCtrl.value,
                  ),
                ),
                ..._buildTokens(boardSize),
              ]);
            },
          ),
        ),
      );
    });
  }

  List<Widget> _buildTokens(double size) {
    final widgets = <Widget>[];
    final s = size / 15.0;
    final tokenSize = s * 0.92;

    for (var pi = 0; pi < widget.state.players.length; pi++) {
      final player = widget.state.players[pi];
      final seatIdx = (player.seat - 1).clamp(0, 3);
      final color = _seatColors[seatIdx];
      final isMine = widget.mySeatIndex == pi;
      final canMoveNow = pi == widget.state.currentTurn &&
          widget.state.awaiting == 'move' &&
          (widget.mySeatIndex == null || isMine);

      for (var ti = 0; ti < player.tokens.length; ti++) {
        final progress = player.tokens[ti];
        final pos = tokenPosition(seatIdx, ti, progress, size);
        final movable = canMoveNow && widget.state.movableTokens.contains(ti);

        widgets.add(AnimatedPositioned(
          duration: const Duration(milliseconds: 340),
          curve: Curves.easeOutBack,
          // Pin points down: anchor the tip near the cell centre.
          left: pos.dx - tokenSize / 2,
          top: pos.dy - tokenSize * 0.78,
          width: tokenSize,
          height: tokenSize,
          child: GestureDetector(
            onTap: movable ? () => widget.onTokenTap?.call(pi, ti) : null,
            child: _Token(
              color: color,
              number: ti + 1,
              highlighted: movable,
            ),
          ),
        ));
      }
    }
    return widgets;
  }
}

// ── Token widget — classic location-pin marker ───────────────────────────────

class _Token extends StatelessWidget {
  final Color color;
  final int number;
  final bool highlighted;
  const _Token({required this.color, required this.number, required this.highlighted});

  @override
  Widget build(BuildContext context) {
    Widget pin = LayoutBuilder(builder: (context, c) {
      final sz = c.maxWidth;
      return SizedBox(
        width: sz,
        height: sz,
        child: Stack(
          alignment: Alignment.topCenter,
          clipBehavior: Clip.none,
          children: [
            if (highlighted)
              Positioned(
                top: sz * 0.06,
                child: Container(
                  width: sz * 0.7,
                  height: sz * 0.7,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: color.withOpacity(0.85),
                        blurRadius: 14,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                ),
              ),
            Icon(
              Icons.location_pin,
              size: sz,
              color: color,
              shadows: const [
                Shadow(color: Colors.black45, blurRadius: 3, offset: Offset(0, 2)),
              ],
            ),
            // White head disc with the token number.
            Positioned(
              top: sz * 0.13,
              child: Container(
                width: sz * 0.46,
                height: sz * 0.46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(color: color.withOpacity(0.55), width: 1),
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

    return highlighted ? _BouncingToken(child: pin) : pin;
  }
}

class _BouncingToken extends StatefulWidget {
  final Widget child;
  const _BouncingToken({required this.child});
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
        offset: Offset(0, -6 * _ctrl.value),
        child: Transform.scale(scale: 1.0 + 0.06 * _ctrl.value, child: child),
      ),
      child: widget.child,
    );
  }
}

// ── Board painter — bright classic Ludo ──────────────────────────────────────

class _BoardPainter extends CustomPainter {
  final int activeSeatIndex;
  final double breathing;

  _BoardPainter({required this.activeSeatIndex, required this.breathing});

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 15.0;

    // 1. White board surface.
    canvas.drawRect(Offset.zero & size, Paint()..color = _boardBg);

    // 2. Coloured corner homes (6×6) with a white token tray.
    _drawBaseQuadrant(canvas, s, 0, 9, _seatColors[0], 0); // BL – red
    _drawBaseQuadrant(canvas, s, 0, 0, _seatColors[1], 1); // TL – blue
    _drawBaseQuadrant(canvas, s, 9, 0, _seatColors[2], 2); // TR – yellow
    _drawBaseQuadrant(canvas, s, 9, 9, _seatColors[3], 3); // BR – green

    // 3. Path cells (white with thin grid lines; safe cells get a hollow star).
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
      if (kSafeCells.contains(i)) {
        _drawStar(canvas, rect.center, s * 0.34,
            color: _starOutline, fill: false, stroke: 1.4);
      }
    }

    // 4. Coloured home lanes + coloured start cells.
    for (var seat = 0; seat < 4; seat++) {
      final color = _seatColors[seat];
      for (var j = 0; j < _homeLanes[seat].length; j++) {
        final c = _homeLanes[seat][j];
        final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
        canvas.drawRect(rect, Paint()..color = color);
        canvas.drawRect(
          rect,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.1
            ..color = Colors.white.withOpacity(0.7),
        );
        if (j == 0) _drawArrow(canvas, rect.center, s * 0.24, seat);
      }

      final startCoord = _track[kStartOffsets[seat]];
      final sr = Rect.fromLTWH(startCoord[0] * s, startCoord[1] * s, s, s);
      canvas.drawRect(sr, Paint()..color = color);
      canvas.drawRect(
        sr,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.1
          ..color = Colors.white.withOpacity(0.8),
      );
      _drawStar(canvas, sr.center, s * 0.32,
          color: Colors.white, fill: false, stroke: 1.6);
    }

    // 5. Centre — four bright triangles meeting at the middle.
    _drawCenter(canvas, s);
  }

  // ── Corner home ────────────────────────────────────────────────────────────

  void _drawBaseQuadrant(
      Canvas canvas, double s, int col, int row, Color color, int seatIndex) {
    final outer = Rect.fromLTWH(col * s, row * s, 6 * s, 6 * s);

    canvas.drawRect(outer, Paint()..color = color);

    // Active-turn breathing glow.
    if (seatIndex == activeSeatIndex) {
      canvas.drawRect(
        outer.deflate(2),
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white.withOpacity(0.35 + 0.5 * breathing)
          ..strokeWidth = 3.0 + 3.0 * breathing
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, 3.0 + 3.0 * breathing),
      );
    }

    // Thin outer separator.
    canvas.drawRect(
      outer,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = Colors.black.withOpacity(0.18)
        ..strokeWidth = 1.0,
    );

    // White token tray (4×4) with a thin coloured border.
    final inner = Rect.fromLTWH((col + 1) * s, (row + 1) * s, 4 * s, 4 * s);
    final innerRR = RRect.fromRectAndRadius(inner, Radius.circular(s * 0.3));
    canvas.drawRRect(innerRR, Paint()..color = Colors.white);
    canvas.drawRRect(
      innerRR,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = color
        ..strokeWidth = 2.0,
    );

    // Empty token slots (light discs with a coloured ring).
    for (final d in _baseDots[seatIndex]) {
      final center = Offset(d[0] * s, d[1] * s);
      final r = s * 0.58;
      canvas.drawCircle(center, r, Paint()..color = color.withOpacity(0.14));
      canvas.drawCircle(
        center,
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = color.withOpacity(0.65)
          ..strokeWidth = 2.0,
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
    // top = yellow(seat2), right = green(seat3), bottom = red(seat0), left = blue(seat1).
    final tris = <List<dynamic>>[
      [_seatColors[2], Offset(cx, cy), Offset(cx + cs, cy)],             // top
      [_seatColors[3], Offset(cx + cs, cy), Offset(cx + cs, cy + cs)],   // right
      [_seatColors[0], Offset(cx + cs, cy + cs), Offset(cx, cy + cs)],   // bottom
      [_seatColors[1], Offset(cx, cy + cs), Offset(cx, cy)],             // left
    ];
    for (final t in tris) {
      final path = Path()
        ..moveTo((t[1] as Offset).dx, (t[1] as Offset).dy)
        ..lineTo((t[2] as Offset).dx, (t[2] as Offset).dy)
        ..lineTo(centre.dx, centre.dy)
        ..close();
      canvas.drawPath(path, Paint()..color = t[0] as Color);
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white.withOpacity(0.85)
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

  void _drawArrow(Canvas canvas, Offset c, double r, int seat) {
    // seat0 up, seat1 right, seat2 down, seat3 left (points along the lane).
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
    canvas.drawPath(path, Paint()..color = Colors.white.withOpacity(0.95));
  }

  @override
  bool shouldRepaint(covariant _BoardPainter old) =>
      old.activeSeatIndex != activeSeatIndex || old.breathing != breathing;
}
