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
  List<double> _history = [];
  String? _errorMsg;
  int _bettingSecondsLeft = 5;
  double? _balance;
  Timer? _bettingTimer;

  // Panel 1 State
  double _betAmount1 = 50;
  bool _betPlaced1 = false;
  bool _cashedOut1 = false;
  double? _myMultiplier1;
  bool _autoCashout1 = false;
  double _autoTarget1 = 2.0;
  bool _autoBet1 = false;

  // Panel 2 State
  double _betAmount2 = 50;
  bool _betPlaced2 = false;
  bool _cashedOut2 = false;
  double? _myMultiplier2;
  bool _autoCashout2 = false;
  double _autoTarget2 = 2.0;
  bool _autoBet2 = false;

  bool _showWinBurst = false;
  double _lastWinPrize = 0.0;

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
      _betPlaced1 = false;
      _betPlaced2 = false;
      _cashedOut1 = false;
      _cashedOut2 = false;
      _myMultiplier1 = null;
      _myMultiplier2 = null;
      _multiplier = 1.00;
      _serverMultiplier = 1.00;
      _crashAt = null;
      _history = _parseHistory(data?['history']);
      _bettingSecondsLeft = (ms / 1000).ceil();
      _showWinBurst = false;
      _lastWinPrize = 0.0;
    });
    SoundService.instance.play(Sfx.countdown);
    _startBettingCountdown(ms);
    // Auto-bet: re-stake the same amount for the new round hands-free.
    if (_autoBet1 && (_balance == null || _balance! >= _betAmount1)) {
      _placeBet(1);
    }
    if (_autoBet2 && (_balance == null || _balance! >= _betAmount2)) {
      _placeBet(2);
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
    if (_autoCashout1 && _betPlaced1 && !_cashedOut1 && m >= _autoTarget1) {
      _cashout(1);
    }
    if (_autoCashout2 && _betPlaced2 && !_cashedOut2 && m >= _autoTarget2) {
      _cashout(2);
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
    final betIndex = data?['bet_index'] as int? ?? 1;
    setState(() {
      if (betIndex == 1) {
        _betPlaced1 = true;
      } else {
        _betPlaced2 = true;
      }
    });
    HapticFeedback.mediumImpact();
    _loadBalance(); // server locked the stake
  }

  void _onCashedOut(dynamic data) {
    if (!mounted) return;
    final m = (data?['multiplier'] as num?)?.toDouble() ?? _serverMultiplier;
    final betIndex = data?['bet_index'] as int? ?? 1;
    final prize = (data?['prize'] as num?)?.toDouble() ?? 0.0;
    setState(() {
      if (betIndex == 1) {
        _cashedOut1 = true;
        _myMultiplier1 = m;
      } else {
        _cashedOut2 = true;
        _myMultiplier2 = m;
      }
      _showWinBurst = true;
      _lastWinPrize = prize;
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

  void _placeBet(int betIndex) {
    if (_phase != 'betting') return;
    final amount = betIndex == 1 ? _betAmount1 : _betAmount2;
    if (_balance != null && _balance! < amount) {
      setState(() => _errorMsg = 'Low balance — add money to play');
      Future.delayed(const Duration(seconds: 3), () { if (mounted) setState(() => _errorMsg = null); });
      return;
    }
    // Optimistic lock; server confirms via aviator:bet_placed or rejects via error.
    setState(() {
      if (betIndex == 1) {
        _betPlaced1 = true;
      } else {
        _betPlaced2 = true;
      }
    });
    _aviator.emit(SocketEvents.aviatorPlaceBet, {'amount': amount, 'bet_index': betIndex});
    HapticFeedback.mediumImpact();
  }

  void _cashout(int betIndex) {
    if (_phase != 'flying') return;
    if (betIndex == 1) {
      if (!_betPlaced1 || _cashedOut1) return;
    } else {
      if (!_betPlaced2 || _cashedOut2) return;
    }
    _aviator.emit(SocketEvents.aviatorCashout, {'bet_index': betIndex});
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
        if (_showWinBurst && _lastWinPrize > 0)
          Center(
            child: Text('+${formatCurrency(_lastWinPrize)}',
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
          Column(
            children: [
              if (_cashedOut1 && _myMultiplier1 != null)
                Container(
                  margin: const EdgeInsets.only(top: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: AppColors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.green)),
                  child: Text('Bet 1 Out @ ${_myMultiplier1!.toStringAsFixed(2)}x · +${formatCurrency(_betAmount1 * _myMultiplier1!)}',
                      style: const TextStyle(color: AppColors.green, fontSize: 11, fontWeight: FontWeight.bold)),
                ),
              if (_cashedOut2 && _myMultiplier2 != null)
                Container(
                  margin: const EdgeInsets.only(top: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: AppColors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.green)),
                  child: Text('Bet 2 Out @ ${_myMultiplier2!.toStringAsFixed(2)}x · +${formatCurrency(_betAmount2 * _myMultiplier2!)}',
                      style: const TextStyle(color: AppColors.green, fontSize: 11, fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBetPanel() => Container(
    padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
    decoration: const BoxDecoration(
      color: Color(0xFF11182E),
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildIndividualBetPanel(1),
        const SizedBox(height: 10),
        const Divider(color: Colors.white10, height: 1),
        const SizedBox(height: 10),
        _buildIndividualBetPanel(2),
      ],
    ),
  );

  Widget _buildIndividualBetPanel(int betIndex) {
    final amount = betIndex == 1 ? _betAmount1 : _betAmount2;
    final placed = betIndex == 1 ? _betPlaced1 : _betPlaced2;

    return Column(
      children: [
        _buildAutoControls(betIndex),
        const SizedBox(height: 8),
        Row(
          children: [
            // Left: Quick bet buttons
            Expanded(
              flex: 2,
              child: Row(
                children: [10, 50, 100].map((v) {
                  final sel = amount == v.toDouble();
                  final locked = placed || _phase == 'flying';
                  return Expanded(
                    child: GestureDetector(
                      onTap: locked ? null : () => setState(() {
                        if (betIndex == 1) {
                          _betAmount1 = v.toDouble();
                        } else {
                          _betAmount2 = v.toDouble();
                        }
                      }),
                      child: Container(
                        margin: const EdgeInsets.symmetric(horizontal: 2),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        decoration: BoxDecoration(
                          color: sel ? AppColors.gold : Colors.white12,
                          borderRadius: BorderRadius.circular(8),
                          border: sel ? null : Border.all(color: Colors.white12),
                        ),
                        child: Text('₹$v', textAlign: TextAlign.center,
                            style: TextStyle(color: sel ? Colors.black : Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(width: 8),
            // Right: Main Action Button
            Expanded(
              flex: 3,
              child: SizedBox(
                height: 38,
                child: _buildMainButton(betIndex),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildAutoControls(int betIndex) {
    final autoBet = betIndex == 1 ? _autoBet1 : _autoBet2;
    final autoCash = betIndex == 1 ? _autoCashout1 : _autoCashout2;
    final target = betIndex == 1 ? _autoTarget1 : _autoTarget2;

    return Row(
      children: [
        Expanded(
          flex: 2,
          child: _autoChip(
            label: 'Auto Bet',
            on: autoBet,
            onTap: () => setState(() {
              if (betIndex == 1) {
                _autoBet1 = !_autoBet1;
              } else {
                _autoBet2 = !_autoBet2;
              }
            }),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 3,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: autoCash ? AppColors.green.withOpacity(0.18) : Colors.white12,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                  color: autoCash ? AppColors.green : Colors.white12),
            ),
            child: Row(
              children: [
                GestureDetector(
                  onTap: () => setState(() {
                    if (betIndex == 1) {
                      _autoCashout1 = !_autoCashout1;
                    } else {
                      _autoCashout2 = !_autoCashout2;
                    }
                  }),
                  child: Row(children: [
                    Icon(
                        autoCash
                            ? Icons.check_box_rounded
                            : Icons.check_box_outline_blank_rounded,
                        size: 16,
                        color: autoCash ? AppColors.green : Colors.white54),
                    const SizedBox(width: 4),
                    const Text('Auto Out',
                        style: TextStyle(color: Colors.white, fontSize: 11)),
                  ]),
                ),
                const Spacer(),
                _stepBtn(Icons.remove, () => setState(() {
                  if (betIndex == 1) {
                    _autoTarget1 = (_autoTarget1 - 0.5).clamp(1.5, 50.0);
                  } else {
                    _autoTarget2 = (_autoTarget2 - 0.5).clamp(1.5, 50.0);
                  }
                })),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Text('${target.toStringAsFixed(1)}x',
                      style: const TextStyle(
                          color: AppColors.gold,
                          fontWeight: FontWeight.bold,
                          fontSize: 11)),
                ),
                _stepBtn(Icons.add, () => setState(() {
                  if (betIndex == 1) {
                    _autoTarget1 = (_autoTarget1 + 0.5).clamp(1.5, 50.0);
                  } else {
                    _autoTarget2 = (_autoTarget2 + 0.5).clamp(1.5, 50.0);
                  }
                })),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _autoChip({required String label, required bool on, required VoidCallback onTap}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 6),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: on ? AppColors.gold.withOpacity(0.2) : Colors.white12,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: on ? AppColors.gold : Colors.white12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(on ? Icons.autorenew_rounded : Icons.autorenew_outlined,
                  size: 14, color: on ? AppColors.gold : Colors.white54),
              const SizedBox(width: 4),
              Text(label,
                  style: TextStyle(
                      color: on ? AppColors.gold : Colors.white70,
                      fontSize: 11,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      );

  Widget _stepBtn(IconData icon, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
              color: Colors.white10, borderRadius: BorderRadius.circular(6)),
          child: Icon(icon, size: 13, color: Colors.white),
        ),
      );

  Widget _buildMainButton(int betIndex) {
    final amount = betIndex == 1 ? _betAmount1 : _betAmount2;
    final placed = betIndex == 1 ? _betPlaced1 : _betPlaced2;
    final cashed = betIndex == 1 ? _cashedOut1 : _cashedOut2;

    if (_phase == 'betting' && !placed) {
      return ElevatedButton(
        onPressed: () => _placeBet(betIndex),
        style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.gold, 
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            padding: EdgeInsets.zero,
        ),
        child: Text('BET ₹${amount.toInt()}', style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 13)),
      );
    }
    if (_phase == 'flying' && placed && !cashed) {
      return ElevatedButton(
        onPressed: () => _cashout(betIndex),
        style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.green, 
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            padding: EdgeInsets.zero,
        ),
        child: Text('OUT ${formatCurrency(amount * _multiplier)}',
            style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12)),
      );
    }
    return ElevatedButton(
      onPressed: null,
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.white10,
        disabledBackgroundColor: Colors.white10,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        padding: EdgeInsets.zero,
      ),
      child: Text(
        placed && !cashed ? 'Placed' :
        cashed ? 'Cashed ✓' :
        _phase == 'crashed' ? 'Ended' : 'Wait…',
        style: const TextStyle(color: Colors.white54, fontSize: 12, fontWeight: FontWeight.w600),
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
