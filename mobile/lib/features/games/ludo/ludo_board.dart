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

class LudoBoard extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.maxWidth;
        return SizedBox(
          width: size,
          height: size,
          child: Stack(
            children: [
              // Static board.
              CustomPaint(size: Size(size, size), painter: _BoardPainter()),
              // Tokens.
              ...(_buildTokens(size)),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _buildTokens(double size) {
    final widgets = <Widget>[];
    final s = size / 15.0;
    final tokenSize = s * 0.82;

    for (var pi = 0; pi < state.players.length; pi++) {
      final player = state.players[pi];
      final color = _seatColors[player.seat - 1 >= 0 ? (player.seat - 1) % 4 : pi % 4];
      final isMine = mySeatIndex == pi;
      final canMoveNow = pi == state.currentTurn &&
          state.awaiting == 'move' &&
          (mySeatIndex == null || isMine);

      for (var ti = 0; ti < player.tokens.length; ti++) {
        final progress = player.tokens[ti];
        final pos = tokenPosition(player.seat - 1, ti, progress, size);
        final movable = canMoveNow && state.movableTokens.contains(ti);

        widgets.add(AnimatedPositioned(
          duration: const Duration(milliseconds: 320),
          curve: Curves.easeOutBack,
          left: pos.dx - tokenSize / 2,
          top: pos.dy - tokenSize / 2,
          width: tokenSize,
          height: tokenSize,
          child: GestureDetector(
            onTap: movable ? () => onTokenTap?.call(pi, ti) : null,
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
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [color.withOpacity(0.95), color.withOpacity(0.7)],
          center: const Alignment(-0.3, -0.3),
        ),
        border: Border.all(
          color: highlighted ? Colors.white : Colors.black.withOpacity(0.4),
          width: highlighted ? 2.4 : 1.4,
        ),
        boxShadow: [
          BoxShadow(
            color: highlighted
                ? Colors.white.withOpacity(0.7)
                : Colors.black.withOpacity(0.35),
            blurRadius: highlighted ? 10 : 3,
            spreadRadius: highlighted ? 1 : 0,
          ),
        ],
      ),
      child: Center(
        child: Container(
          width: 6,
          height: 6,
          decoration: const BoxDecoration(
              shape: BoxShape.circle, color: Colors.white70),
        ),
      ),
    );
  }
}

class _BoardPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 15.0;
    final bg = Paint()..color = const Color(0xFF0F1626);
    canvas.drawRect(Offset.zero & size, bg);

    // Base quadrants.
    _quadrant(canvas, s, 0, 9, _seatColors[0]);  // bottom-left  (seat 0)
    _quadrant(canvas, s, 0, 0, _seatColors[1]);  // top-left     (seat 1)
    _quadrant(canvas, s, 9, 0, _seatColors[2]);  // top-right    (seat 2)
    _quadrant(canvas, s, 9, 9, _seatColors[3]);  // bottom-right (seat 3)

    // Track cells (white) + safe cells (highlighted).
    final cellPaint = Paint()..style = PaintingStyle.fill;
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.black.withOpacity(0.25)
      ..strokeWidth = 0.8;
    for (var i = 0; i < _track.length; i++) {
      final c = _track[i];
      final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
      cellPaint.color =
          kSafeCells.contains(i) ? const Color(0xFF243049) : const Color(0xFF1A2336);
      canvas.drawRect(rect, cellPaint);
      canvas.drawRect(rect, stroke);
      if (kSafeCells.contains(i)) _star(canvas, rect.center, s * 0.28);
    }

    // Colored home lanes + start cells.
    for (var seat = 0; seat < 4; seat++) {
      final color = _seatColors[seat];
      for (final c in _homeLanes[seat]) {
        final rect = Rect.fromLTWH(c[0] * s, c[1] * s, s, s);
        canvas.drawRect(rect, Paint()..color = color.withOpacity(0.55));
        canvas.drawRect(rect, stroke);
      }
      // Start cell tint.
      final start = _track[kStartOffsets[seat]];
      final sr = Rect.fromLTWH(start[0] * s, start[1] * s, s, s);
      canvas.drawRect(sr, Paint()..color = color.withOpacity(0.45));
      canvas.drawRect(sr, stroke);
    }

    // Centre home triangle (3×3).
    final cx = 6 * s, cy = 6 * s, cs = 3 * s;
    canvas.drawRect(
        Rect.fromLTWH(cx, cy, cs, cs), Paint()..color = const Color(0xFF11192B));
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
      canvas.drawPath(p, Paint()..color = (t[0] as Color).withOpacity(0.8));
    }
  }

  void _quadrant(Canvas canvas, double s, int col, int row, Color color) {
    final outer = Rect.fromLTWH(col * s, row * s, 6 * s, 6 * s);
    canvas.drawRect(outer, Paint()..color = color.withOpacity(0.85));
    // Inner white home tray.
    final inner = Rect.fromLTWH((col + 1) * s, (row + 1) * s, 4 * s, 4 * s);
    canvas.drawRRect(
        RRect.fromRectAndRadius(inner, Radius.circular(s * 0.4)),
        Paint()..color = const Color(0xFF0F1626));
  }

  void _star(Canvas canvas, Offset c, double r) {
    final paint = Paint()..color = Colors.white.withOpacity(0.5);
    final path = Path();
    for (var i = 0; i < 5; i++) {
      final a = -math.pi / 2 + i * 2 * math.pi / 5; // outer points, 72° steps
      final p = Offset(c.dx + r * math.cos(a), c.dy + r * math.sin(a));
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
      final a2 = a + math.pi / 5; // inner points
      final p2 =
          Offset(c.dx + r * 0.45 * math.cos(a2), c.dy + r * 0.45 * math.sin(a2));
      path.lineTo(p2.dx, p2.dy);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
