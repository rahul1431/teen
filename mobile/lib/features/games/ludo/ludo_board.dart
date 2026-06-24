import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../shared/theme/app_theme.dart';
import 'ludo_engine.dart';

/// Canonical 52-cell main track as (col,row) on a 15×15 grid. Index == the
/// engine's absolute cell number, so `track[absoluteCell(seat, progress)]`
/// gives a token's screen cell directly.
const List<List<int>> _track = [
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],          // 0-4  bottom arm, left lane
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],       // 5-10 to left edge
  [0, 7], [0, 6],                                        // 11-12 turn
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],               // 13-17 left arm top lane
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],       // 18-23 up top arm
  [7, 0], [8, 0],                                        // 24-25 turn
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],               // 26-30 top arm right lane
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],  // 31-36 to right edge
  [14, 7], [14, 8],                                      // 37-38 turn
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],           // 39-43 right arm bottom lane
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],  // 44-49 down bottom arm
  [7, 14], [6, 14],                                      // 50-51 turn
];

/// Home columns (6 cells each) leading to the centre, per seat index.
const List<List<List<int>>> _homeLanes = [
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]], // seat 0
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],     // seat 1
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],     // seat 2
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]], // seat 3
];

/// 2×2 base dot positions per seat (col,row), fractional grid coords.
const List<List<List<double>>> _baseDots = [
  [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]], // seat 0 bottom-left
  [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],     // seat 1 top-left
  [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]], // seat 2 top-right
  [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]], // seat 3 bottom-right
];

const List<Color> _seatColors = [
  AppColors.ludoRed,
  AppColors.ludoGreen,
  AppColors.ludoYellow,
  AppColors.ludoBlue,
];

/// Centre of the grid cell (col,row) within a board of [size] px.
Offset _cellCenter(num col, num row, double size) {
  final s = size / 15.0;
  return Offset((col + 0.5) * s, (row + 0.5) * s);
}

/// Screen position for a token given its seat + progress.
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
  return _cellCenter(7, 7, size); // home / centre
}

class LudoBoard extends StatefulWidget {
  final LudoState state;
  final int? mySeatIndex; // highlight my movable tokens
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

class _LudoBoardState extends State<LudoBoard> with SingleTickerProviderStateMixin {
  late final AnimationController _breathingCtrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _breathingCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.maxWidth;
        // Restrict size slightly to account for the mahogany wood border padding
        final borderSize = size - 16.0;
        
        return Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF4E2C1B), Color(0xFF261005)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF8C5D3A), width: 1.5),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.55),
                blurRadius: 12,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: SizedBox(
            width: borderSize,
            height: borderSize,
            child: AnimatedBuilder(
              animation: _breathingCtrl,
              builder: (context, child) {
                // Get active player seat (1-indexed: 1, 2, 3, 4) -> map to 0..3 index
                final activeSeat = widget.state.players[widget.state.currentTurn].seat - 1;
                return Stack(
                  children: [
                    // Static board.
                    CustomPaint(
                      size: Size(borderSize, borderSize), 
                      painter: _BoardPainter(
                        activeSeatIndex: activeSeat,
                        breathing: _breathingCtrl.value,
                      ),
                    ),
                    // Tokens.
                    ...(_buildTokens(borderSize)),
                  ],
                );
              },
            ),
          ),
        );
      },
    );
  }

  List<Widget> _buildTokens(double size) {
    final widgets = <Widget>[];
    final s = size / 15.0;
    final tokenSize = s * 0.85;

    for (var pi = 0; pi < widget.state.players.length; pi++) {
      final player = widget.state.players[pi];
      final color = _seatColors[player.seat - 1 >= 0 ? (player.seat - 1) % 4 : pi % 4];
      final isMine = widget.mySeatIndex == pi;
      final canMoveNow = pi == widget.state.currentTurn &&
          widget.state.awaiting == 'move' &&
          (widget.mySeatIndex == null || isMine);

      for (var ti = 0; ti < player.tokens.length; ti++) {
        final progress = player.tokens[ti];
        final pos = tokenPosition(player.seat - 1, ti, progress, size);
        final movable = canMoveNow && widget.state.movableTokens.contains(ti);

        widgets.add(AnimatedPositioned(
          duration: const Duration(milliseconds: 320),
          curve: Curves.easeOutBack,
          left: pos.dx - tokenSize / 2,
          top: pos.dy - tokenSize / 2,
          width: tokenSize,
          height: tokenSize,
          child: GestureDetector(
            onTap: movable ? () => widget.onTokenTap?.call(pi, ti) : null,
            child: _Token(color: color, highlighted: movable),
          ),
        ));
      }
    }
    return widgets;
  }
}

class _Token extends StatelessWidget {
  final Color color;
  final bool highlighted;
  const _Token({required this.color, required this.highlighted});

  @override
  Widget build(BuildContext context) {
    Widget tokenBody = Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            Colors.white.withOpacity(0.95), // Shiny reflections
            color,
            color.withOpacity(0.85),
            Colors.black.withOpacity(0.45), // 3D spherical shade
          ],
          stops: const [0.0, 0.25, 0.75, 1.0],
          center: const Alignment(-0.35, -0.35),
          radius: 0.9,
        ),
        border: Border.all(
          color: highlighted ? Colors.white : Colors.black.withOpacity(0.45),
          width: highlighted ? 2.2 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.45),
            blurRadius: 4,
            offset: const Offset(1.5, 3),
          ),
          if (highlighted)
            BoxShadow(
              color: color.withOpacity(0.7),
              blurRadius: 14,
              spreadRadius: 2,
            ),
        ],
      ),
      child: Center(
        child: Container(
          width: 5,
          height: 5,
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.white70,
          ),
        ),
      ),
    );

    if (highlighted) {
      return _BouncingToken(child: tokenBody);
    }
    return tokenBody;
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
    duration: const Duration(milliseconds: 600),
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
      builder: (_, child) {
        final val = _ctrl.value;
        return Transform.translate(
          offset: Offset(0, -7 * val),
          child: Transform.scale(
            scale: 1.0 + 0.05 * val,
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}

class _BoardPainter extends CustomPainter {
  final int activeSeatIndex;
  final double breathing;

  _BoardPainter({required this.activeSeatIndex, required this.breathing});

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 15.0;
    
    // 1. Dark Board Background
    final bg = Paint()..color = const Color(0xFF0F1422);
    canvas.drawRect(Offset.zero & size, bg);

    // 2. Base quadrants (6x6 base slots)
    _drawBaseQuadrant(canvas, s, 0, 9, _seatColors[0], 0);  // bottom-left (seat 0)
    _drawBaseQuadrant(canvas, s, 0, 0, _seatColors[1], 1);  // top-left (seat 1)
    _drawBaseQuadrant(canvas, s, 9, 0, _seatColors[2], 2);  // top-right (seat 2)
    _drawBaseQuadrant(canvas, s, 9, 9, _seatColors[3], 3);  // bottom-right (seat 3)

    // 3. Track cells & safe cells
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.white.withOpacity(0.06)
      ..strokeWidth = 0.8;

    for (var i = 0; i < _track.length; i++) {
      final c = _track[i];
      final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
      final isSafe = kSafeCells.contains(i);
      
      final cellPaint = Paint()..style = PaintingStyle.fill;
      if (isSafe) {
        cellPaint.shader = LinearGradient(
          colors: [const Color(0xFF243049), const Color(0xFF161F33)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ).createShader(rect);
      } else {
        cellPaint.color = const Color(0xFF161B26);
      }
      
      canvas.drawRect(rect, cellPaint);
      canvas.drawRect(rect, stroke);
      
      if (isSafe) {
        _drawSafeShield(canvas, rect.center, s * 0.35);
      }
    }

    // 4. Colored home lanes & start cells
    for (var seat = 0; seat < 4; seat++) {
      final color = _seatColors[seat];
      for (final c in _homeLanes[seat]) {
        final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
        final lanePaint = Paint()
          ..shader = RadialGradient(
            colors: [color.withOpacity(0.65), color.withOpacity(0.35)],
          ).createShader(rect);
        canvas.drawRect(rect, lanePaint);
        canvas.drawRect(rect, stroke);
      }
      
      // Start cell tint
      final start = _track[kStartOffsets[seat]];
      final sr = Rect.fromLTWH(start[0] * s, start[1] * s, s, s);
      canvas.drawRect(
        sr,
        Paint()
          ..shader = LinearGradient(
            colors: [color.withOpacity(0.7), color.withOpacity(0.4)],
          ).createShader(sr),
      );
      canvas.drawRect(sr, stroke);
      _drawSafeShield(canvas, sr.center, s * 0.28, color: color.withOpacity(0.6));
    }

    // 5. Central Home Triangle (3x3 center)
    final cx = 6 * s, cy = 6 * s, cs = 3 * s;
    canvas.drawRect(
      Rect.fromLTWH(cx, cy, cs, cs),
      Paint()..color = const Color(0xFF0F1524),
    );
    final center = Offset(7.5 * s, 7.5 * s);
    final tri = [
      [_seatColors[1], Offset(cx, cy), Offset(cx + cs, cy)],         // top → seat1
      [_seatColors[2], Offset(cx + cs, cy), Offset(cx + cs, cy + cs)], // right → seat2
      [_seatColors[3], Offset(cx + cs, cy + cs), Offset(cx, cy + cs)], // bottom → seat3
      [_seatColors[0], Offset(cx, cy + cs), Offset(cx, cy)],         // left → seat0
    ];
    for (final t in tri) {
      final p = Path()
        ..moveTo((t[1] as Offset).dx, (t[1] as Offset).dy)
        ..lineTo((t[2] as Offset).dx, (t[2] as Offset).dy)
        ..lineTo(center.dx, center.dy)
        ..close();
      canvas.drawPath(
        p,
        Paint()
          ..shader = RadialGradient(
            center: Alignment.center,
            radius: 1.0,
            colors: [(t[0] as Color), (t[0] as Color).withOpacity(0.4)],
          ).createShader(Rect.fromPoints(t[1] as Offset, center)),
      );
    }
    
    // Draw golden crown watermark in absolute center
    final crownPaint = Paint()
      ..color = const Color(0xFFFFD700).withOpacity(0.18)
      ..style = PaintingStyle.fill;
    final crown = Path()
      ..moveTo(center.dx - 12, center.dy + 8)
      ..lineTo(center.dx - 16, center.dy - 6)
      ..lineTo(center.dx - 6, center.dy)
      ..lineTo(center.dx, center.dy - 12) // center point of crown
      ..lineTo(center.dx + 6, center.dy)
      ..lineTo(center.dx + 16, center.dy - 6)
      ..lineTo(center.dx + 12, center.dy + 8)
      ..close();
    canvas.drawPath(crown, crownPaint);
  }

  void _drawBaseQuadrant(Canvas canvas, double s, int col, int row, Color color, int seatIndex) {
    final outer = Rect.fromLTWH(col * s, row * s, 6 * s, 6 * s);
    final isActive = seatIndex == activeSeatIndex;

    // Draw quadrant background gradient
    final quadPaint = Paint()
      ..shader = LinearGradient(
        colors: [color.withOpacity(0.8), color.withOpacity(0.35)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(outer);
    canvas.drawRect(outer, quadPaint);
    
    // Draw active turn breathing glow border
    if (isActive) {
      canvas.drawRect(
        outer,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = color.withOpacity(0.35 + 0.45 * breathing)
          ..strokeWidth = 3.5 + 3.5 * breathing
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, 3.5 + 3.5 * breathing),
      );
    }

    // Draw thin gold boundary
    canvas.drawRect(
      outer,
      Paint()
        ..style = PaintingStyle.stroke
        ..color = const Color(0xFFFFD700).withOpacity(0.35)
        ..strokeWidth = 1.0,
    );

    // Inner tray (glassmorphic token yard)
    final inner = Rect.fromLTWH((col + 1) * s, (row + 1) * s, 4 * s, 4 * s);
    canvas.drawRRect(
      RRect.fromRectAndRadius(inner, Radius.circular(s * 0.4)),
      Paint()
        ..color = const Color(0xFF0D121F).withOpacity(0.85)
        ..style = PaintingStyle.fill,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(inner, Radius.circular(s * 0.4)),
      Paint()
        ..style = PaintingStyle.stroke
        ..color = Colors.white.withOpacity(0.08)
        ..strokeWidth = 1.0,
    );

    // Draw 4 glossy pocket sockets for token positions
    final dots = _baseDots[seatIndex];
    for (final d in dots) {
      final center = Offset(d[0] * s, d[1] * s);
      final socketRadius = s * 0.65;
      
      // Outer shadow of socket
      canvas.drawCircle(
        center,
        socketRadius,
        Paint()
          ..color = Colors.black.withOpacity(0.6)
          ..style = PaintingStyle.fill,
      );
      
      // Gold/metallic trim ring
      canvas.drawCircle(
        center,
        socketRadius,
        Paint()
          ..style = PaintingStyle.stroke
          ..color = const Color(0xFFFFD700).withOpacity(0.25)
          ..strokeWidth = 1.2,
      );
      
      // Inner deep shading
      canvas.drawCircle(
        center,
        s * 0.45,
        Paint()
          ..shader = RadialGradient(
            colors: [Colors.black, color.withOpacity(0.12)],
          ).createShader(Rect.fromCircle(center: center, radius: s * 0.45)),
      );
    }
  }

  void _drawSafeShield(Canvas canvas, Offset c, double r, {Color? color}) {
    final activeColor = color ?? const Color(0xFFFFD700).withOpacity(0.85);
    final paint = Paint()
      ..color = activeColor
      ..style = PaintingStyle.fill;
      
    // Draw shield shape path
    final path = Path()
      ..moveTo(c.dx, c.dy - r)
      ..lineTo(c.dx + r * 0.8, c.dy - r * 0.4)
      ..lineTo(c.dx + r * 0.7, c.dy + r * 0.3)
      ..quadraticBezierTo(c.dx, c.dy + r, c.dx, c.dy + r)
      ..quadraticBezierTo(c.dx - r * 0.7, c.dy + r * 0.3, c.dx - r * 0.7, c.dy + r * 0.3)
      ..lineTo(c.dx - r * 0.8, c.dy - r * 0.4)
      ..close();
    canvas.drawPath(path, paint);
    
    // Inner star on shield
    final starPaint = Paint()..color = const Color(0xFF0F1524);
    final starPath = Path();
    final starRadius = r * 0.45;
    for (var i = 0; i < 5; i++) {
      final a = -math.pi / 2 + i * 2 * math.pi / 5;
      final p = Offset(c.dx + starRadius * math.cos(a), c.dy + starRadius * math.sin(a));
      i == 0 ? starPath.moveTo(p.dx, p.dy) : starPath.lineTo(p.dx, p.dy);
      final a2 = a + math.pi / 5;
      final p2 = Offset(c.dx + starRadius * 0.4 * math.cos(a2), c.dy + starRadius * 0.4 * math.sin(a2));
      starPath.lineTo(p2.dx, p2.dy);
    }
    starPath.close();
    canvas.drawPath(starPath, starPaint);
  }

  @override
  bool shouldRepaint(covariant _BoardPainter oldDelegate) =>
      oldDelegate.activeSeatIndex != activeSeatIndex || oldDelegate.breathing != breathing;
}
