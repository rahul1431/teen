import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:math';
import 'dart:async';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';

class AviatorPage extends StatefulWidget {
  const AviatorPage({super.key});
  @override
  State<AviatorPage> createState() => _AviatorPageState();
}

class _AviatorPageState extends State<AviatorPage> with SingleTickerProviderStateMixin {
  final _socket = AviatorSocketService();
  late final AnimationController _curveController;

  String _phase = 'waiting'; // waiting, betting, flying, crashed
  double _multiplier = 1.00;
  double? _crashAt;
  double _betAmount = 50;
  bool _betPlaced = false;
  bool _cashedOut = false;
  double? _myMultiplier;
  List<double> _history = [];
  List<Map<String, dynamic>> _liveBets = [];
  String? _errorMsg;
  int _bettingSecondsLeft = 5;
  Timer? _bettingTimer;

  @override
  void initState() {
    super.initState();
    _curveController = AnimationController(vsync: this, duration: const Duration(seconds: 60));
    _connect();
  }

  Future<void> _connect() async {
    await _socket.connect();

    _socket.on(SocketEvents.aviatorRoundStart).listen((data) {
      if (!mounted) return;
      setState(() {
        _phase = 'betting';
        _betPlaced = false;
        _cashedOut = false;
        _myMultiplier = null;
        _multiplier = 1.00;
        _history = List<double>.from(data['history']?.map((e) => double.parse(e.toString())) ?? []);
        _bettingSecondsLeft = 5;
      });
      _curveController.reset();
      _startBettingCountdown();
    });

    _socket.on(SocketEvents.aviatorFlyingStart).listen((_) {
      if (!mounted) return;
      setState(() => _phase = 'flying');
      _bettingTimer?.cancel();
      _curveController.forward();
    });

    _socket.on(SocketEvents.aviatorMultiplierTick).listen((data) {
      if (!mounted) return;
      setState(() => _multiplier = double.parse(data['multiplier'].toString()));
    });

    _socket.on(SocketEvents.aviatorCrashed).listen((data) {
      if (!mounted) return;
      setState(() {
        _phase = 'crashed';
        _crashAt = double.parse(data['crash_at'].toString());
      });
      _curveController.stop();
      HapticFeedback.heavyImpact();
    });

    _socket.on(SocketEvents.aviatorBetPlaced).listen((data) {
      if (!mounted) return;
      setState(() => _betPlaced = true);
    });

    _socket.on(SocketEvents.aviatorCashedOut).listen((data) {
      if (!mounted) return;
      setState(() {
        _cashedOut = true;
        _myMultiplier = double.parse(data['multiplier'].toString());
      });
      HapticFeedback.mediumImpact();
    });

    _socket.on(SocketEvents.aviatorLiveBets).listen((data) {
      if (!mounted) return;
      setState(() => _liveBets = List<Map<String, dynamic>>.from(data['bets'] ?? []));
    });

    _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _errorMsg = data['message']);
      Future.delayed(const Duration(seconds: 3), () { if (mounted) setState(() => _errorMsg = null); });
    });

    _socket.on(SocketEvents.aviatorRoundState).listen((data) {
      if (!mounted) return;
      setState(() {
        _phase = data['status'] ?? 'waiting';
        _multiplier = double.parse((data['multiplier'] ?? 1).toString());
        _history = List<double>.from(data['history']?.map((e) => double.parse(e.toString())) ?? []);
      });
    });
  }

  void _startBettingCountdown() {
    _bettingTimer?.cancel();
    _bettingTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      setState(() {
        _bettingSecondsLeft--;
        if (_bettingSecondsLeft <= 0) t.cancel();
      });
    });
  }

  void _placeBet() {
    _socket.emit(SocketEvents.aviatorPlaceBet, {'amount': _betAmount});
    HapticFeedback.mediumImpact();
  }

  void _cashout() {
    _socket.emit(SocketEvents.aviatorCashout, {});
    HapticFeedback.heavyImpact();
  }

  @override
  void dispose() {
    _curveController.dispose();
    _bettingTimer?.cancel();
    _socket.disconnect();
    super.dispose();
  }

  Color _historyColor(double v) => v < 2 ? AppColors.red : v < 5 ? Colors.orange : AppColors.green;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.aviatorBlue,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: const Text('Aviator', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Column(
        children: [
          // History strip
          SizedBox(
            height: 36,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              reverse: true,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              itemCount: _history.length,
              itemBuilder: (_, i) => Container(
                margin: const EdgeInsets.symmetric(horizontal: 3, vertical: 4),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: _historyColor(_history[i]).withOpacity(0.2), borderRadius: BorderRadius.circular(8), border: Border.all(color: _historyColor(_history[i]).withOpacity(0.6))),
                child: Text('${_history[i].toStringAsFixed(2)}x', style: TextStyle(color: _historyColor(_history[i]), fontSize: 11, fontWeight: FontWeight.bold)),
              ),
            ),
          ),

          // Main crash curve area
          Expanded(
            child: CustomPaint(
              painter: _CrashCurvePainter(_multiplier, _phase),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_phase == 'crashed')
                      Text('CRASHED\n${_crashAt?.toStringAsFixed(2)}x', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.red, fontSize: 36, fontWeight: FontWeight.bold))
                    else if (_phase == 'betting')
                      Column(children: [
                        const Text('WAITING TO START', style: TextStyle(color: Colors.white54)),
                        Text('$_bettingSecondsLeft s', style: const TextStyle(color: Colors.white, fontSize: 40, fontWeight: FontWeight.bold)),
                      ])
                    else
                      Column(children: [
                        Text('${_multiplier.toStringAsFixed(2)}x',
                          style: TextStyle(
                            fontSize: 52, fontWeight: FontWeight.bold,
                            color: _multiplier >= 2.0 ? AppColors.aviatorGreen : Colors.white,
                            shadows: [Shadow(color: (_multiplier >= 2.0 ? AppColors.aviatorGreen : Colors.white).withOpacity(0.5), blurRadius: 20)],
                          )),
                        if (_cashedOut && _myMultiplier != null)
                          Text('Cashed out @ ${_myMultiplier!.toStringAsFixed(2)}x', style: const TextStyle(color: AppColors.gold, fontSize: 14)),
                      ]),
                    if (_errorMsg != null)
                      Container(
                        margin: const EdgeInsets.only(top: 12),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(color: AppColors.red.withOpacity(0.2), borderRadius: BorderRadius.circular(8)),
                        child: Text(_errorMsg!, style: const TextStyle(color: AppColors.red)),
                      ),
                  ],
                ),
              ),
            ),
          ),

          // Bet controls
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.black.withOpacity(0.4), borderRadius: const BorderRadius.vertical(top: Radius.circular(24))),
            child: Column(
              children: [
                // Bet amount selector
                Row(
                  children: [10, 50, 100, 500].map((v) {
                    final sel = _betAmount == v.toDouble();
                    return Expanded(
                      child: GestureDetector(
                        onTap: (_betPlaced || _phase == 'flying') ? null : () => setState(() => _betAmount = v.toDouble()),
                        child: Container(
                          margin: const EdgeInsets.all(4),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          decoration: BoxDecoration(
                            color: sel ? AppColors.gold : Colors.white12,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text('₹$v', textAlign: TextAlign.center, style: TextStyle(color: sel ? Colors.black : Colors.white, fontWeight: FontWeight.bold)),
                        ),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: _buildMainButton(),
                ),
              ],
            ),
          ),

          // Live bets
          if (_liveBets.isNotEmpty)
            Container(
              height: 60,
              color: Colors.black45,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                itemCount: _liveBets.length,
                itemBuilder: (_, i) {
                  final bet = _liveBets[i];
                  return Container(
                    margin: const EdgeInsets.only(right: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: bet['cashed_out'] == true ? AppColors.green.withOpacity(0.2) : Colors.white10,
                      borderRadius: BorderRadius.circular(8),
                      border: bet['cashed_out'] == true ? Border.all(color: AppColors.green.withOpacity(0.5)) : null,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(bet['username'] ?? '', style: const TextStyle(color: Colors.white, fontSize: 11)),
                        Text('₹${bet['amount']}${bet['cashed_out'] == true ? ' @ ${bet['cashout_multiplier']}x' : ''}', style: TextStyle(color: bet['cashed_out'] == true ? AppColors.green : AppColors.gold, fontSize: 10)),
                      ],
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMainButton() {
    if (_phase == 'betting' && !_betPlaced) {
      return ElevatedButton(
        onPressed: _placeBet,
        style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        child: Text('BET ₹${_betAmount.toInt()}', style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 16)),
      );
    }
    if (_phase == 'flying' && _betPlaced && !_cashedOut) {
      return ElevatedButton(
        onPressed: _cashout,
        style: ElevatedButton.styleFrom(backgroundColor: AppColors.aviatorGreen, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        child: Text('CASH OUT @ ${_multiplier.toStringAsFixed(2)}x', style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 16)),
      );
    }
    return ElevatedButton(
      onPressed: null,
      style: ElevatedButton.styleFrom(backgroundColor: Colors.white12, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
      child: Text(
        _betPlaced && !_cashedOut ? 'Bet Placed — Waiting...' :
        _cashedOut ? 'Cashed Out ✓' :
        _phase == 'crashed' ? 'Next round soon...' : 'Waiting...',
        style: const TextStyle(color: Colors.white54, fontSize: 14),
      ),
    );
  }
}

class _CrashCurvePainter extends CustomPainter {
  final double multiplier;
  final String phase;
  _CrashCurvePainter(this.multiplier, this.phase);

  @override
  void paint(Canvas canvas, Size size) {
    if (phase != 'flying' && phase != 'crashed') return;
    final paint = Paint()
      ..color = (phase == 'crashed' ? AppColors.red : AppColors.aviatorGreen).withOpacity(0.6)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;

    final path = Path();
    final steps = 100;
    final progress = ((multiplier - 1) / 20).clamp(0.0, 1.0);

    path.moveTo(0, size.height);
    for (int i = 0; i <= steps; i++) {
      final t = i / steps * progress;
      final x = t * size.width;
      final y = size.height - pow(t * 1.5, 1.8).toDouble() * size.height * 0.8;
      if (i == 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_CrashCurvePainter old) => old.multiplier != multiplier || old.phase != phase;
}
