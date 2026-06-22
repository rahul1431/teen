import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:math';
import 'dart:async';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

// Single-player Aviator. Each round is the player vs the house: a fresh round
// starts automatically, the plane climbs, and the player cashes out before it
// flies away. The round is driven entirely on-device (no shared multiplayer).
class AviatorPage extends StatefulWidget {
  const AviatorPage({super.key});
  @override
  State<AviatorPage> createState() => _AviatorPageState();
}

class _AviatorPageState extends State<AviatorPage> with TickerProviderStateMixin {
  // Drives the per-frame render loop (plane, curve, multiplier growth).
  late final AnimationController _ticker;
  // Pulses the multiplier / plane glow.
  late final AnimationController _pulse;

  String _phase = 'betting'; // betting, flying, crashed
  double _multiplier = 1.00;
  double? _crashAt;
  double _betAmount = 50;
  bool _betPlaced = false;
  bool _cashedOut = false;
  double? _myMultiplier;
  List<double> _history = [];
  String? _errorMsg;
  int _bettingSecondsLeft = 5;
  double? _balance;

  final _rng = Random();
  int _phaseStartMs = 0;

  @override
  void initState() {
    super.initState();
    _ticker = AnimationController(vsync: this, duration: const Duration(seconds: 1))
      ..addListener(_onFrame)
      ..repeat();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 600))
      ..repeat(reverse: true);
    _loadBalance();
    _history = List.generate(8, (_) => _rollCrash());
    _enterBetting();
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance = double.parse(res.data['real_balance'].toString()));
    } catch (_) {/* offline / no auth */}
  }

  void _enterBetting() {
    setState(() {
      _phase = 'betting';
      _betPlaced = false; _cashedOut = false; _myMultiplier = null;
      _multiplier = 1.00;
      _bettingSecondsLeft = 5;
      _crashAt = _rollCrash();
    });
    _phaseStartMs = DateTime.now().millisecondsSinceEpoch;
  }

  // House-edge weighted crash point: mostly 1–3x, occasional long tail.
  double _rollCrash() {
    final r = _rng.nextDouble();
    final c = (0.97 / (1 - r)).clamp(1.0, 50.0);
    return double.parse(c.toStringAsFixed(2));
  }

  void _onFrame() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final elapsed = (now - _phaseStartMs) / 1000.0;

    if (_phase == 'betting') {
      final left = (5 - elapsed).ceil();
      if (left != _bettingSecondsLeft) setState(() => _bettingSecondsLeft = left.clamp(0, 5));
      if (elapsed >= 5) { setState(() => _phase = 'flying'); _phaseStartMs = now; }
    } else if (_phase == 'flying') {
      final m = exp(0.16 * elapsed); // ~2x at 4.3s, ~4x at 8.7s
      if (_crashAt != null && m >= _crashAt!) {
        setState(() { _multiplier = _crashAt!; _phase = 'crashed'; });
        HapticFeedback.heavyImpact();
        _phaseStartMs = now;
      } else {
        setState(() => _multiplier = m);
      }
    } else if (_phase == 'crashed') {
      if (elapsed >= 2.5) {
        setState(() => _history = [_crashAt ?? _multiplier, ..._history].take(20).toList());
        _enterBetting();
      } else {
        setState(() {}); // keep painting the crash frame
      }
    } else {
      setState(() {});
    }
  }

  void _placeBet() {
    // Block betting with insufficient balance.
    if (_balance != null && _balance! < _betAmount) {
      setState(() => _errorMsg = 'Low balance — add money to play');
      Future.delayed(const Duration(seconds: 3), () { if (mounted) setState(() => _errorMsg = null); });
      return;
    }
    setState(() {
      _betPlaced = true;
      if (_balance != null) _balance = _balance! - _betAmount;
    });
    HapticFeedback.mediumImpact();
  }

  void _cashout() {
    setState(() {
      _cashedOut = true;
      _myMultiplier = _multiplier;
      if (_balance != null) _balance = _balance! + _betAmount * _multiplier;
    });
    HapticFeedback.heavyImpact();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _pulse.dispose();
    super.dispose();
  }

  Color _historyColor(double v) => v < 2 ? AppColors.red : v < 5 ? AppColors.orange : AppColors.green;

  // Map multiplier → 0..1 plane progress; asymptotic so the plane stays on screen.
  double get _progress => (1 - 1 / max(_multiplier, 1.0)).clamp(0.0, 1.0);

  @override
  Widget build(BuildContext context) {
    final flying = _phase == 'flying';
    final crashed = _phase == 'crashed';
    return Scaffold(
      backgroundColor: const Color(0xFF0B1020),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Aviator', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.gold.withOpacity(0.6)),
                ),
                child: Text('₹${_balance?.toStringAsFixed(0) ?? '—'}',
                    style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          _buildHistoryStrip(),
          Expanded(child: _buildSky(flying, crashed)),
          _buildBetPanel(),
        ],
      ),
    );
  }

  Widget _buildHistoryStrip() => SizedBox(
    height: 38,
    child: ListView.builder(
      scrollDirection: Axis.horizontal,
      reverse: true,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      itemCount: _history.length,
      itemBuilder: (_, i) => Container(
        margin: const EdgeInsets.symmetric(horizontal: 3, vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: _historyColor(_history[i]).withOpacity(0.18),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: _historyColor(_history[i]).withOpacity(0.55)),
        ),
        child: Center(
          child: Text('${_history[i].toStringAsFixed(2)}x',
              style: TextStyle(color: _historyColor(_history[i]), fontSize: 11, fontWeight: FontWeight.bold)),
        ),
      ),
    ),
  );

  Widget _buildSky(bool flying, bool crashed) => ClipRect(
    child: Stack(
      children: [
        Positioned.fill(
          child: CustomPaint(
            painter: _AviatorPainter(
              progress: _progress,
              phase: _phase,
              spin: _pulse.value,
            ),
          ),
        ),
        Center(child: _buildCenterReadout(crashed)),
        if (_errorMsg != null)
          Positioned(
            bottom: 12, left: 0, right: 0,
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(color: AppColors.red.withOpacity(0.2), borderRadius: BorderRadius.circular(8)),
                child: Text(_errorMsg!, style: const TextStyle(color: AppColors.red)),
              ),
            ),
          ),
      ],
    ),
  );

  Widget _buildCenterReadout(bool crashed) {
    if (crashed) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('FLEW AWAY!', style: TextStyle(color: AppColors.red, fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 4),
          Text('${(_crashAt ?? _multiplier).toStringAsFixed(2)}x',
              style: const TextStyle(color: AppColors.red, fontSize: 56, fontWeight: FontWeight.w900)),
        ],
      );
    }
    if (_phase == 'betting') {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('NEXT ROUND IN', style: TextStyle(color: Colors.white54, letterSpacing: 2, fontSize: 12)),
          const SizedBox(height: 6),
          Text('${_bettingSecondsLeft}s', style: const TextStyle(color: Colors.white, fontSize: 48, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          SizedBox(
            width: 140,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (_bettingSecondsLeft / 5).clamp(0.0, 1.0),
                backgroundColor: Colors.white12,
                color: AppColors.gold,
                minHeight: 5,
              ),
            ),
          ),
        ],
      );
    }
    // flying / waiting
    final scale = _phase == 'flying' ? 1.0 + _pulse.value * 0.06 : 1.0;
    final hot = _multiplier >= 2.0;
    return Transform.scale(
      scale: scale,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('${_multiplier.toStringAsFixed(2)}x',
            style: TextStyle(
              fontSize: 60, fontWeight: FontWeight.w900,
              color: hot ? AppColors.aviatorGreen : Colors.white,
              shadows: [Shadow(color: (hot ? AppColors.aviatorGreen : Colors.white).withOpacity(0.6), blurRadius: 24)],
            )),
          if (_cashedOut && _myMultiplier != null)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(color: AppColors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.green)),
              child: Text('Cashed out @ ${_myMultiplier!.toStringAsFixed(2)}x  ·  +${formatCurrency(_betAmount * _myMultiplier!)}',
                  style: const TextStyle(color: AppColors.green, fontSize: 13, fontWeight: FontWeight.bold)),
            ),
        ],
      ),
    );
  }

  Widget _buildBetPanel() => Container(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
    decoration: const BoxDecoration(
      color: Color(0xFF11182E),
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    child: Column(
      children: [
        Row(
          children: [10, 50, 100, 500].map((v) {
            final sel = _betAmount == v.toDouble();
            final locked = _betPlaced || _phase == 'flying';
            return Expanded(
              child: GestureDetector(
                onTap: locked ? null : () => setState(() => _betAmount = v.toDouble()),
                child: Container(
                  margin: const EdgeInsets.all(4),
                  padding: const EdgeInsets.symmetric(vertical: 11),
                  decoration: BoxDecoration(
                    color: sel ? AppColors.gold : Colors.white12,
                    borderRadius: BorderRadius.circular(10),
                    border: sel ? null : Border.all(color: Colors.white12),
                  ),
                  child: Text('₹$v', textAlign: TextAlign.center,
                      style: TextStyle(color: sel ? Colors.black : Colors.white, fontWeight: FontWeight.bold)),
                ),
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 12),
        SizedBox(width: double.infinity, height: 54, child: _buildMainButton()),
      ],
    ),
  );

  Widget _buildMainButton() {
    if (_phase == 'betting' && !_betPlaced) {
      return ElevatedButton(
        onPressed: _placeBet,
        style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        child: Text('BET ₹${_betAmount.toInt()}', style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 17)),
      );
    }
    if (_phase == 'flying' && _betPlaced && !_cashedOut) {
      return ElevatedButton(
        onPressed: _cashout,
        style: ElevatedButton.styleFrom(backgroundColor: AppColors.green, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        child: Text('CASH OUT  ${formatCurrency(_betAmount * _multiplier)}',
            style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 17)),
      );
    }
    return ElevatedButton(
      onPressed: null,
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.white10,
        disabledBackgroundColor: Colors.white10,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      child: Text(
        _betPlaced && !_cashedOut ? 'Bet placed — good luck!' :
        _cashedOut ? 'Cashed out ✓' :
        _phase == 'crashed' ? 'Round over — next one soon' : 'Connecting…',
        style: const TextStyle(color: Colors.white54, fontSize: 14, fontWeight: FontWeight.w600),
      ),
    );
  }

}

class _AviatorPainter extends CustomPainter {
  final double progress; // 0..1 along the flight
  final String phase;
  final double spin;     // 0..1 propeller / glow pulse
  _AviatorPainter({required this.progress, required this.phase, required this.spin});

  @override
  void paint(Canvas canvas, Size size) {
    _drawGrid(canvas, size);
    if (phase != 'flying' && phase != 'crashed') return;

    final crashed = phase == 'crashed';
    final main = crashed ? AppColors.red : AppColors.aviatorGreen;

    // Build the exponential flight path.
    final path = Path()..moveTo(0, size.height);
    final steps = 60;
    double px = 0, py = size.height;
    for (int i = 0; i <= steps; i++) {
      final t = i / steps * progress;
      final x = t * size.width;
      final y = size.height - pow(t, 1.5).toDouble() * size.height * 0.82;
      path.lineTo(x, y);
      px = x; py = y;
    }

    // Area fill under the curve.
    final fill = Path.from(path)
      ..lineTo(px, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(
      fill,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter, end: Alignment.bottomCenter,
          colors: [main.withOpacity(0.35), main.withOpacity(0.02)],
        ).createShader(Offset.zero & size),
    );

    // Glowing stroke.
    canvas.drawPath(
      path,
      Paint()
        ..color = main
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );

    // The plane at the tip.
    _drawPlane(canvas, Offset(px, py), main, crashed);
  }

  void _drawGrid(Canvas canvas, Size size) {
    final p = Paint()..color = Colors.white.withOpacity(0.04)..strokeWidth = 1;
    for (double x = 0; x < size.width; x += size.width / 6) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), p);
    }
    for (double y = 0; y < size.height; y += size.height / 5) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), p);
    }
  }

  void _drawPlane(Canvas canvas, Offset c, Color glow, bool crashed) {
    // Glow halo
    canvas.drawCircle(c, 22, Paint()
      ..color = glow.withOpacity(0.25)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 10));

    final body = Paint()..color = crashed ? AppColors.red : AppColors.gold;
    // Simple stylised plane (triangle nose + tail) pointing up-right.
    final plane = Path()
      ..moveTo(c.dx + 14, c.dy - 10) // nose
      ..lineTo(c.dx - 10, c.dy + 2)  // tail-bottom
      ..lineTo(c.dx - 2, c.dy + 2)
      ..lineTo(c.dx - 8, c.dy + 12)  // rudder
      ..lineTo(c.dx + 2, c.dy + 4)
      ..close();
    canvas.drawPath(plane, body);
    // Cockpit dot
    canvas.drawCircle(Offset(c.dx + 4, c.dy - 2), 2.4, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(_AviatorPainter old) =>
      old.progress != progress || old.phase != phase || old.spin != spin;
}
