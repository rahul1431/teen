import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'ludo_engine.dart';

// ── Coordinate tables ─────────────────────────────────────────────────────────

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

// Vivid seat colors: Red, Green, Yellow, Blue
const List<Color> _seatColors = [
  Color(0xFFE53935), // red
  Color(0xFF43A047), // green
  Color(0xFFFDD835), // yellow
  Color(0xFF1E88E5), // blue
];

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
      const framePad = 10.0;
      final boardSize = outer - framePad * 2;

      return Container(
        width: outer,
        height: outer,
        decoration: BoxDecoration(
          // Outermost dark shadow ring
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
                color: Colors.black.withOpacity(0.75),
                blurRadius: 24,
                spreadRadius: 2,
                offset: const Offset(0, 8)),
            BoxShadow(
                color: const Color(0xFFD4AF37).withOpacity(0.12),
                blurRadius: 30,
                spreadRadius: -4),
          ],
        ),
        child: Container(
          // Layer 1: Mahogany wood outer frame
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: const LinearGradient(
              colors: [Color(0xFF5C3317), Color(0xFF2E1A0A), Color(0xFF4A2812)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Container(
            margin: const EdgeInsets.all(3),
            // Layer 2: Gold inlay line
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(17.5),
              border: Border.all(color: const Color(0xFFD4AF37).withOpacity(0.6), width: 1.5),
            ),
            child: Container(
              margin: const EdgeInsets.all(2),
              padding: EdgeInsets.all(framePad - 6),
              // Layer 3: Inner dark bezel
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(15),
                color: const Color(0xFF0A0F1D),
                border: Border.all(color: Colors.white.withOpacity(0.04), width: 1),
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
            ),
          ),
        ),
      );
    });
  }

  List<Widget> _buildTokens(double size) {
    final widgets = <Widget>[];
    final s = size / 15.0;
    final tokenSize = s * 0.82;

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
          left: pos.dx - tokenSize / 2,
          top: pos.dy - tokenSize / 2,
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

// ── Token widget ─────────────────────────────────────────────────────────────

class _Token extends StatelessWidget {
  final Color color;
  final int number;
  final bool highlighted;
  const _Token({required this.color, required this.number, required this.highlighted});

  @override
  Widget build(BuildContext context) {
    Widget body = Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            Colors.white.withOpacity(0.98),
            color,
            color.withOpacity(0.8),
            Colors.black.withOpacity(0.55),
          ],
          stops: const [0.0, 0.28, 0.72, 1.0],
          center: const Alignment(-0.4, -0.4),
          radius: 0.85,
        ),
        border: Border.all(
          color: highlighted
              ? Colors.white
              : color.withOpacity(0.7),
          width: highlighted ? 2.5 : 1.5,
        ),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withOpacity(0.6),
              blurRadius: 5,
              offset: const Offset(1.5, 3.5)),
          if (highlighted)
            BoxShadow(
                color: color.withOpacity(0.8),
                blurRadius: 16,
                spreadRadius: 3),
        ],
      ),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Specular highlight dot
            Container(
              width: 4,
              height: 4,
              margin: const EdgeInsets.only(bottom: 1),
              decoration: const BoxDecoration(
                  shape: BoxShape.circle, color: Colors.white),
            ),
            // Token number
            Text(
              '$number',
              style: TextStyle(
                color: Colors.white.withOpacity(0.9),
                fontSize: 7,
                fontWeight: FontWeight.w900,
                shadows: [
                  Shadow(
                      color: Colors.black.withOpacity(0.7),
                      blurRadius: 2)
                ],
              ),
            ),
          ],
        ),
      ),
    );

    return highlighted ? _BouncingToken(child: body) : body;
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
        offset: Offset(0, -7 * _ctrl.value),
        child: Transform.scale(
            scale: 1.0 + 0.06 * _ctrl.value, child: child),
      ),
      child: widget.child,
    );
  }
}

// ── Board painter ─────────────────────────────────────────────────────────────

class _BoardPainter extends CustomPainter {
  final int activeSeatIndex;
  final double breathing;

  _BoardPainter({required this.activeSeatIndex, required this.breathing});

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 15.0;

    // ── 1. Board background ──────────────────────────────────────────────────
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = const Color(0xFF0A0F1D),
    );

    // Subtle dot texture
    final dotP = Paint()..color = Colors.white.withOpacity(0.025);
    for (double x = s * 0.5; x < size.width; x += s) {
      for (double y = s * 0.5; y < size.height; y += s) {
        canvas.drawCircle(Offset(x, y), 1.0, dotP);
      }
    }

    // ── 2. Colored quadrants ─────────────────────────────────────────────────
    _drawBaseQuadrant(canvas, s, 0, 9, _seatColors[0], 0);  // BL – Red
    _drawBaseQuadrant(canvas, s, 0, 0, _seatColors[1], 1);  // TL – Green
    _drawBaseQuadrant(canvas, s, 9, 0, _seatColors[2], 2);  // TR – Yellow
    _drawBaseQuadrant(canvas, s, 9, 9, _seatColors[3], 3);  // BR – Blue

    // ── 3. Track cells (cream/ivory) ─────────────────────────────────────────
    for (var i = 0; i < _track.length; i++) {
      final c = _track[i];
      final rect = Rect.fromLTWH(c[0] * s + 0.8, c[1] * s + 0.8, s - 1.6, s - 1.6);
      final rr = RRect.fromRectAndRadius(rect, Radius.circular(s * 0.18));
      final isSafe = kSafeCells.contains(i);

      // Cell fill
      canvas.drawRRect(
        rr,
        Paint()
          ..color = isSafe
              ? const Color(0xFFF8F3E6)
              : const Color(0xFFEEE9D8),
      );

      // Cell inner shadow (top-left lighter, bottom-right darker)
      canvas.drawRRect(
        rr,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.2
          ..color = const Color(0xFFD4C9B0),
      );

      if (isSafe) {
        _drawStar(canvas, rect.center, s * 0.32, const Color(0xFFFFB300));
      }
    }

    // ── 4. Colored home lanes ────────────────────────────────────────────────
    for (var seat = 0; seat < 4; seat++) {
      final color = _seatColors[seat];
      final lanes = _homeLanes[seat];
      for (var j = 0; j < lanes.length; j++) {
        final c = lanes[j];
        final rect = Rect.fromLTWH(
            c[0] * s + 0.8, c[1] * s + 0.8, s - 1.6, s - 1.6);
        final rr = RRect.fromRectAndRadius(rect, Radius.circular(s * 0.18));

        canvas.drawRRect(
          rr,
          Paint()
            ..shader = LinearGradient(
              colors: [color, color.withOpacity(0.7)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ).createShader(rect),
        );
        canvas.drawRRect(
          rr,
          Paint()
            ..style = PaintingStyle.stroke
            ..color = Colors.white.withOpacity(0.35)
            ..strokeWidth = 1.0,
        );

        // Arrow on entry cell (j==0) and small triangle on last
        if (j == 0) {
          _drawArrow(canvas, rect.center, s * 0.22, seat);
        }
      }

      // Start cells (vivid color fill + star)
      final startCoord = _track[kStartOffsets[seat]];
      final sr = Rect.fromLTWH(
          startCoord[0] * s + 0.8,
          startCoord[1] * s + 0.8,
          s - 1.6,
          s - 1.6);
      final srr = RRect.fromRectAndRadius(sr, Radius.circular(s * 0.18));
      canvas.drawRRect(
        srr,
        Paint()
          ..shader = LinearGradient(
            colors: [color, color.withOpacity(0.8)],
          ).createShader(sr),
      );
      canvas.drawRRect(
        srr,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white.withOpacity(0.4)
          ..strokeWidth = 1.0,
      );
      _drawStar(canvas, sr.center, s * 0.3, Colors.white.withOpacity(0.95));
    }

    // ── 5. Center home area (3×3 at col 6, row 6) ───────────────────────────
    _drawCenter(canvas, s, size);
  }

  // ── Quadrant base ──────────────────────────────────────────────────────────

  void _drawBaseQuadrant(
      Canvas canvas, double s, int col, int row, Color color, int seatIndex) {
    final outer = Rect.fromLTWH(col * s, row * s, 6 * s, 6 * s);
    final isActive = seatIndex == activeSeatIndex;

    // Quadrant background — vivid gradient
    canvas.drawRect(
      outer,
      Paint()
        ..shader = LinearGradient(
          colors: [
            color,
            color.withOpacity(0.75),
            color.withOpacity(0.55),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ).createShader(outer),
    );

    // Active turn breathing glow
    if (isActive) {
      canvas.drawRect(
        outer,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white.withOpacity(0.15 + 0.35 * breathing)
          ..strokeWidth = 4.0 + 3.0 * breathing
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, 4.0 + 4.0 * breathing),
      );
      canvas.drawRect(
        outer,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = color.withOpacity(0.4 + 0.5 * breathing)
          ..strokeWidth = 2.5,
      );
    }

    // Gold boundary
    canvas.drawRect(
      outer,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFFFFD700).withOpacity(0.45)
        ..strokeWidth = 1.2,
    );

    // Inner tray (dark recessed area)
    final inner = Rect.fromLTWH((col + 1) * s, (row + 1) * s, 4 * s, 4 * s);
    final innerRR = RRect.fromRectAndRadius(inner, Radius.circular(s * 0.45));
    canvas.drawRRect(
      innerRR,
      Paint()..color = Colors.black.withOpacity(0.45),
    );
    // Tray color tint
    canvas.drawRRect(
      innerRR,
      Paint()
        ..color = color.withOpacity(0.12)
        ..style = PaintingStyle.fill,
    );
    // Tray border
    canvas.drawRRect(
      innerRR,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = Colors.white.withOpacity(0.12)
        ..strokeWidth = 1.0,
    );

    // Token sockets
    for (final d in _baseDots[seatIndex]) {
      final center = Offset(d[0] * s, d[1] * s);
      final r = s * 0.62;

      // Deep shadow ring
      canvas.drawCircle(center, r + 1.5,
          Paint()..color = Colors.black.withOpacity(0.65));

      // Socket base (recessed dark)
      canvas.drawCircle(
        center,
        r,
        Paint()
          ..shader = RadialGradient(
            colors: [
              Colors.black.withOpacity(0.85),
              color.withOpacity(0.15),
            ],
            center: const Alignment(0.3, 0.3),
          ).createShader(Rect.fromCircle(center: center, radius: r)),
      );

      // Color ring around socket
      canvas.drawCircle(
        center,
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = color.withOpacity(0.5)
          ..strokeWidth = 2.0,
      );
      // Gold accent ring
      canvas.drawCircle(
        center,
        r - 2,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = const Color(0xFFFFD700).withOpacity(0.2)
          ..strokeWidth = 1.0,
      );
    }

    // Corner label (seat number / color initial)
    final labels = ['R', 'G', 'Y', 'B'];
    final tp = TextPainter(
      text: TextSpan(
        text: labels[seatIndex],
        style: TextStyle(
          color: Colors.white.withOpacity(0.25),
          fontSize: s * 0.75,
          fontWeight: FontWeight.w900,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(
      canvas,
      Offset(
        outer.left + s * 0.15,
        outer.top + s * 0.1,
      ),
    );
  }

  // ── Center area ────────────────────────────────────────────────────────────

  void _drawCenter(Canvas canvas, double s, Size size) {
    final cx = 6 * s, cy = 6 * s, cs = 3 * s;
    final centerRect = Rect.fromLTWH(cx, cy, cs, cs);
    final centerPt = Offset(7.5 * s, 7.5 * s);

    // Background
    canvas.drawRect(centerRect, Paint()..color = const Color(0xFF0A0F1D));

    // 4 colored triangles pointing to center
    final triangles = [
      // [color, corner1, corner2]
      [_seatColors[1], Offset(cx, cy), Offset(cx + cs, cy)],       // top → green
      [_seatColors[2], Offset(cx + cs, cy), Offset(cx + cs, cy + cs)], // right → yellow
      [_seatColors[3], Offset(cx + cs, cy + cs), Offset(cx, cy + cs)], // bottom → blue
      [_seatColors[0], Offset(cx, cy + cs), Offset(cx, cy)],       // left → red
    ];

    for (final t in triangles) {
      final color = t[0] as Color;
      final p1 = t[1] as Offset;
      final p2 = t[2] as Offset;
      final path = Path()
        ..moveTo(p1.dx, p1.dy)
        ..lineTo(p2.dx, p2.dy)
        ..lineTo(centerPt.dx, centerPt.dy)
        ..close();
      canvas.drawPath(
        path,
        Paint()
          ..shader = LinearGradient(
            colors: [color.withOpacity(0.95), color.withOpacity(0.5)],
            begin: Alignment.center,
            end: Alignment.topCenter,
          ).createShader(
              Rect.fromPoints(p1, centerPt)),
      );
      // Edge highlight on each triangle
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = Colors.white.withOpacity(0.12)
          ..strokeWidth = 0.8,
      );
    }

    // Center home circle
    canvas.drawCircle(
      centerPt,
      s * 0.85,
      Paint()..color = const Color(0xFF0A0F1D),
    );
    canvas.drawCircle(
      centerPt,
      s * 0.85,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFFD4AF37).withOpacity(0.5)
        ..strokeWidth = 1.5,
    );

    // Golden crown/home icon
    _drawCrown(canvas, centerPt, s * 0.65);
  }

  // ── Star ──────────────────────────────────────────────────────────────────

  void _drawStar(Canvas canvas, Offset c, double r, Color color) {
    // Outer glow
    canvas.drawCircle(
      c,
      r * 1.5,
      Paint()
        ..color = color.withOpacity(0.2)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
    );

    // 6-pointed star (two overlapping triangles)
    final path1 = _starTriangle(c, r, 0);
    final path2 = _starTriangle(c, r, math.pi);

    canvas.drawPath(path1, Paint()..color = color);
    canvas.drawPath(path2, Paint()..color = color);

    // Center dot
    canvas.drawCircle(c, r * 0.22, Paint()..color = Colors.white.withOpacity(0.9));
  }

  Path _starTriangle(Offset c, double r, double rotation) {
    final path = Path();
    for (var i = 0; i < 3; i++) {
      final angle = rotation + i * 2 * math.pi / 3 - math.pi / 2;
      final p = Offset(c.dx + r * math.cos(angle), c.dy + r * math.sin(angle));
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    return path..close();
  }

  // ── Arrow (into home lane) ─────────────────────────────────────────────────

  void _drawArrow(Canvas canvas, Offset c, double r, int seat) {
    // seat 0 = up, seat 1 = right, seat 2 = down, seat 3 = left
    final angles = [-math.pi / 2, 0, math.pi / 2, math.pi];
    final angle = angles[seat];
    final tip = Offset(c.dx + r * math.cos(angle), c.dy + r * math.sin(angle));
    final base1 = Offset(
        c.dx + r * 0.7 * math.cos(angle + math.pi * 0.6),
        c.dy + r * 0.7 * math.sin(angle + math.pi * 0.6));
    final base2 = Offset(
        c.dx + r * 0.7 * math.cos(angle - math.pi * 0.6),
        c.dy + r * 0.7 * math.sin(angle - math.pi * 0.6));
    final path = Path()
      ..moveTo(tip.dx, tip.dy)
      ..lineTo(base1.dx, base1.dy)
      ..lineTo(base2.dx, base2.dy)
      ..close();
    canvas.drawPath(path, Paint()..color = Colors.white.withOpacity(0.85));
  }

  // ── Crown watermark ────────────────────────────────────────────────────────

  void _drawCrown(Canvas canvas, Offset c, double r) {
    final goldPaint = Paint()
      ..color = const Color(0xFFD4AF37).withOpacity(0.85)
      ..style = PaintingStyle.fill;

    // Crown base bar
    final barH = r * 0.25;
    final barW = r * 1.6;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(
            center: Offset(c.dx, c.dy + r * 0.4),
            width: barW,
            height: barH),
        Radius.circular(barH * 0.5),
      ),
      goldPaint,
    );

    // Crown peaks (5 points)
    final path = Path();
    final peakPositions = [-r * 0.7, -r * 0.35, 0.0, r * 0.35, r * 0.7];
    final peakHeights = [r * 0.55, r * 0.75, r * 0.9, r * 0.75, r * 0.55];
    final baseY = c.dy + r * 0.28;

    path.moveTo(c.dx - r * 0.8, baseY);
    for (var i = 0; i < peakPositions.length; i++) {
      path.lineTo(c.dx + peakPositions[i], c.dy - peakHeights[i] + r * 0.25);
    }
    path.lineTo(c.dx + r * 0.8, baseY);
    path.close();
    canvas.drawPath(path, goldPaint);

    // Crown jewel dots
    final jewels = [
      [c.dx - r * 0.35, c.dy - r * 0.08],
      [c.dx, c.dy - r * 0.25],
      [c.dx + r * 0.35, c.dy - r * 0.08],
    ];
    for (final j in jewels) {
      canvas.drawCircle(
        Offset(j[0], j[1]),
        r * 0.1,
        Paint()..color = Colors.white.withOpacity(0.9),
      );
    }

    // "HOME" text below crown
    final tp = TextPainter(
      text: TextSpan(
        text: 'HOME',
        style: TextStyle(
          color: const Color(0xFFD4AF37).withOpacity(0.7),
          fontSize: r * 0.32,
          fontWeight: FontWeight.w900,
          letterSpacing: 1.5,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(
      canvas,
      Offset(c.dx - tp.width / 2, c.dy + r * 0.5),
    );
  }

  @override
  bool shouldRepaint(covariant _BoardPainter old) =>
      old.activeSeatIndex != activeSeatIndex || old.breathing != breathing;
}
