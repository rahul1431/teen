import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'dart:math';
import 'dart:async';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';

// Server-driven Aviator. The round (crash point, multiplier, history) is owned
// by the aviator engine (port 3005) over a raw WebSocket so the outcome is
// provably fair, cheat-resistant, and subject to the admin-configured
// economics (house edge / rake / max-win). The device only renders and sends
// place_bet / cashout intents. A local 60fps interpolation keeps the plane
// motion smooth between the server's multiplier ticks.
//
// Gameplay: supports auto-cashout (cash out automatically at a target
// multiplier) and auto-bet (re-bet the same stake each round), matching the
// feel of mainstream crash games, plus full SFX + a cash-out celebration.
class AviatorPage extends StatefulWidget {
  const AviatorPage({super.key});
  @override
  State<AviatorPage> createState() => _AviatorPageState();
}

class _AviatorPageState extends State<AviatorPage> with TickerProviderStateMixin {
  final _aviator = AviatorSocketService();
  final _subs = <StreamSubscription>[];

  // Drives the per-frame render loop (plane glow + multiplier interpolation).
  late final AnimationController _ticker;
  // Pulses the multiplier / plane glow.
  late final AnimationController _pulse;

  String _phase = 'connecting'; // connecting, betting, flying, crashed
  double _multiplier = 1.00;       // smoothed value shown on screen
  double _serverMultiplier = 1.00; // latest authoritative value from server
  double? _crashAt;
  double _betAmount = 50;
  bool _betPlaced = false;
  bool _cashedOut = false;
  double? _myMultiplier;
  List<double> _history = [];
  String? _errorMsg;
  int _bettingSecondsLeft = 5;
  double? _balance;
  Timer? _bettingTimer;

  // Crash-game staples: cash out automatically at a target multiplier, and/or
  // re-bet the same stake every round hands-free.
  bool _autoCashout = false;
  double _autoTarget = 2.0;
  bool _autoBet = false;
  bool _showWinBurst = false;

  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    _ticker = AnimationController(vsync: this, duration: const Duration(seconds: 1))
      ..addListener(_onFrame)
      ..repeat();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 600))
      ..repeat(reverse: true);
    _loadBalance();
    _connect();
  }

  Future<void> _connect() async {
    await _aviator.connect();
    _subs.add(_aviator.on(SocketEvents.aviatorRoundStart).listen(_onRoundStart));
    _subs.add(_aviator.on(SocketEvents.aviatorFlyingStart).listen(_onFlyingStart));
    _subs.add(_aviator.on(SocketEvents.aviatorMultiplierTick).listen(_onTick));
    _subs.add(_aviator.on(SocketEvents.aviatorCrashed).listen(_onCrashed));
    _subs.add(_aviator.on(SocketEvents.aviatorRoundState).listen(_onRoundState));
    _subs.add(_aviator.on(SocketEvents.aviatorBetPlaced).listen(_onBetPlaced));
    _subs.add(_aviator.on(SocketEvents.aviatorCashedOut).listen(_onCashedOut));
    _subs.add(_aviator.on(SocketEvents.errorEvent).listen(_onError));
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance = double.parse(res.data['real_balance'].toString()));
    } catch (_) {/* offline / no auth */}
  }

  List<double> _parseHistory(dynamic raw) {
    if (raw is! List) return _history;
    return raw.map((e) => double.tryParse(e.toString()) ?? 0).toList();
  }

  // ── Socket event handlers ──────────────────────────────────────────────
  void _onRoundStart(dynamic data) {
    if (!mounted) return;
    final ms = (data?['betting_time_ms'] as num?)?.toInt() ?? 5000;
    setState(() {
      _phase = 'betting';
      _betPlaced = false;
      _cashedOut = false;
      _myMultiplier = null;
      _multiplier = 1.00;
      _serverMultiplier = 1.00;
      _crashAt = null;
      _history = _parseHistory(data?['history']);
      _bettingSecondsLeft = (ms / 1000).ceil();
      _showWinBurst = false;
    });
    SoundService.instance.play(Sfx.countdown);
    _startBettingCountdown(ms);
    // Auto-bet: re-stake the same amount for the new round hands-free.
    if (_autoBet && (_balance == null || _balance! >= _betAmount)) {
      _placeBet();
    }
  }

  void _startBettingCountdown(int ms) {
    _bettingTimer?.cancel();
    final end = DateTime.now().millisecondsSinceEpoch + ms;
    _bettingTimer = Timer.periodic(const Duration(milliseconds: 200), (t) {
      if (!mounted || _phase != 'betting') { t.cancel(); return; }
      final left = ((end - DateTime.now().millisecondsSinceEpoch) / 1000).ceil().clamp(0, 99);
      if (left != _bettingSecondsLeft) setState(() => _bettingSecondsLeft = left);
      if (left <= 0) t.cancel();
    });
  }

  void _onFlyingStart(dynamic _) {
    if (!mounted) return;
    _bettingTimer?.cancel();
    SoundService.instance.play(Sfx.takeoff);
    setState(() {
      _phase = 'flying';
      _multiplier = 1.00;
      _serverMultiplier = 1.00;
    });
  }

  void _onTick(dynamic data) {
    final m = (data?['multiplier'] as num?)?.toDouble();
    if (m == null) return;
    _serverMultiplier = m;
    if (_phase != 'flying') setState(() => _phase = 'flying');
    // Auto-cashout: fire as soon as the authoritative value hits the target.
    if (_autoCashout && _betPlaced && !_cashedOut && m >= _autoTarget) {
      _cashout();
    }
  }

  void _onCrashed(dynamic data) {
    if (!mounted) return;
    final crash = (data?['crash_at'] as num?)?.toDouble() ?? _serverMultiplier;
    HapticFeedback.heavyImpact();
    SoundService.instance.play(Sfx.crash);
    setState(() {
      _phase = 'crashed';
      _crashAt = crash;
      _multiplier = crash;
      _serverMultiplier = crash;
      _history = [crash, ..._history].take(20).toList();
    });
    // Wallet settles on the server at crash time; refresh the balance.
    _loadBalance();
  }

  void _onRoundState(dynamic data) {
    if (!mounted) return;
    final status = data?['status']?.toString() ?? 'betting';
    setState(() {
      _phase = status == 'flying' ? 'flying' : status == 'crashed' ? 'crashed' : 'betting';
      _serverMultiplier = (data?['multiplier'] as num?)?.toDouble() ?? 1.00;
      _multiplier = _serverMultiplier;
      _history = _parseHistory(data?['history']);
    });
  }

  void _onBetPlaced(dynamic data) {
    if (!mounted) return;
    setState(() => _betPlaced = true);
    HapticFeedback.mediumImpact();
    _loadBalance(); // server locked the stake
  }

  void _onCashedOut(dynamic data) {
    if (!mounted) return;
    final m = (data?['multiplier'] as num?)?.toDouble() ?? _serverMultiplier;
    setState(() {
      _cashedOut = true;
      _myMultiplier = m;
      _showWinBurst = true;
    });
    HapticFeedback.heavyImpact();
    SoundService.instance.play(Sfx.cashout);
    SoundService.instance.play(Sfx.win);
    Future.delayed(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _showWinBurst = false);
    });
  }

  void _onError(dynamic data) {
    if (!mounted) return;
    final msg = data?['message']?.toString() ?? 'Something went wrong';
    setState(() => _errorMsg = msg);
    Future.delayed(const Duration(seconds: 3), () { if (mounted) setState(() => _errorMsg = null); });
  }

  // 60fps render loop: ease the displayed multiplier toward the server value
  // so the plane glides smoothly between 100ms server ticks.
  void _onFrame() {
    if (_phase == 'flying') {
      final next = _multiplier + (_serverMultiplier - _multiplier) * 0.25;
      setState(() => _multiplier = next);
    } else {
      setState(() {}); // keep painting glow / crash frame
    }
  }

  void _placeBet() {
    if (_phase != 'betting') return;
    if (_balance != null && _balance! < _betAmount) {
      setState(() => _errorMsg = 'Low balance — add money to play');
      Future.delayed(const Duration(seconds: 3), () { if (mounted) setState(() => _errorMsg = null); });
      return;
    }
    // Optimistic lock; server confirms via aviator:bet_placed or rejects via error.
    setState(() => _betPlaced = true);
    _aviator.emit(SocketEvents.aviatorPlaceBet, {'amount': _betAmount});
    HapticFeedback.mediumImpact();
  }

  void _cashout() {
    if (_phase != 'flying' || !_betPlaced || _cashedOut) return;
    _aviator.emit(SocketEvents.aviatorCashout);
  }

  @override
  void dispose() {
    _bettingTimer?.cancel();
    for (final s in _subs) { s.cancel(); }
    _aviator.disconnect();
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
        if (_showWinBurst && _myMultiplier != null)
          Center(
            child: Text('+${formatCurrency(_betAmount * _myMultiplier!)}',
                    style: const TextStyle(
                        color: AppColors.green,
                        fontSize: 40,
                        fontWeight: FontWeight.w900,
                        shadows: [Shadow(color: Colors.black54, blurRadius: 12)]))
                .animate()
                .scale(
                    begin: const Offset(0.4, 0.4),
                    end: const Offset(1.2, 1.2),
                    duration: 500.ms,
                    curve: Curves.elasticOut)
                .fadeOut(delay: 1100.ms, duration: 400.ms)
                .moveY(begin: 0, end: -60, duration: 1500.ms),
          ),
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
    if (_phase == 'connecting') {
      return const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(width: 28, height: 28, child: CircularProgressIndicator(color: AppColors.gold, strokeWidth: 2.5)),
          SizedBox(height: 14),
          Text('Connecting to round…', style: TextStyle(color: Colors.white54, letterSpacing: 1)),
        ],
      );
    }
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
        _buildAutoControls(),
        const SizedBox(height: 10),
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

  // Auto-bet toggle + auto-cashout toggle with a target-multiplier stepper.
  Widget _buildAutoControls() => Row(
    children: [
      Expanded(
        child: _autoChip(
          label: 'Auto Bet',
          on: _autoBet,
          onTap: () => setState(() => _autoBet = !_autoBet),
        ),
      ),
      const SizedBox(width: 8),
      Expanded(
        flex: 2,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: _autoCashout ? AppColors.green.withOpacity(0.18) : Colors.white12,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
                color: _autoCashout ? AppColors.green : Colors.white12),
          ),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => setState(() => _autoCashout = !_autoCashout),
                child: Row(children: [
                  Icon(
                      _autoCashout
                          ? Icons.check_box_rounded
                          : Icons.check_box_outline_blank_rounded,
                      size: 18,
                      color: _autoCashout ? AppColors.green : Colors.white54),
                  const SizedBox(width: 4),
                  const Text('Auto Cashout',
                      style: TextStyle(color: Colors.white, fontSize: 12)),
                ]),
              ),
              const Spacer(),
              _stepBtn(Icons.remove, () => setState(
                  () => _autoTarget = (_autoTarget - 0.5).clamp(1.5, 50.0))),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: Text('${_autoTarget.toStringAsFixed(1)}x',
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
              ),
              _stepBtn(Icons.add, () => setState(
                  () => _autoTarget = (_autoTarget + 0.5).clamp(1.5, 50.0))),
            ],
          ),
        ),
      ),
    ],
  );

  Widget _autoChip({required String label, required bool on, required VoidCallback onTap}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 9),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: on ? AppColors.gold.withOpacity(0.2) : Colors.white12,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: on ? AppColors.gold : Colors.white12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(on ? Icons.autorenew_rounded : Icons.autorenew_outlined,
                  size: 16, color: on ? AppColors.gold : Colors.white54),
              const SizedBox(width: 5),
              Text(label,
                  style: TextStyle(
                      color: on ? AppColors.gold : Colors.white70,
                      fontSize: 12,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      );

  Widget _stepBtn(IconData icon, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 26,
          height: 26,
          decoration: BoxDecoration(
              color: Colors.white10, borderRadius: BorderRadius.circular(7)),
          child: Icon(icon, size: 15, color: Colors.white),
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
