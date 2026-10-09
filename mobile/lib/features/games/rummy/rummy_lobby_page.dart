import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/services/app_config_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'rummy_history_page.dart';

/// Online Rummy matchmaking. Mirrors the Teen Patti lobby: pick a
/// stake, Quick Match over /ws, navigate to the board on room:joined.
class RummyLobbyPage extends StatefulWidget {
  final String variation;
  const RummyLobbyPage({super.key, this.variation = 'points'});

  @override
  State<RummyLobbyPage> createState() => _RummyLobbyPageState();
}

class _RummyLobbyPageState extends State<RummyLobbyPage> {
  final _socket = SocketService();
  double _selectedStake = 100;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  double _feePercent = 5;
  final _stakes = [100.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0];
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _errorSub;
  int _secondsRemaining = 60;
  StateSetter? _dialogSetState;
  Timer? _searchingTimer;

  String get _variationLabel {
    switch (widget.variation) {
      case 'pool101':
        return 'Pool 101';
      case 'pool201':
        return 'Pool 201';
      case 'deals':
        return 'Deals Rummy';
      default:
        return 'Points Rummy';
    }
  }

  String get _variationRule {
    switch (widget.variation) {
      case 'pool101':
        return 'ELIMINATE @ 101 PTS';
      case 'pool201':
        return 'ELIMINATE @ 201 PTS';
      case 'deals':
        return 'BEST OF 2 / 3 DEALS';
      default:
        return 'FAST 1-DEAL · CASH/PT';
    }
  }

  IconData get _variationIcon {
    switch (widget.variation) {
      case 'pool101':
        return Icons.shield_rounded;
      case 'pool201':
        return Icons.military_tech_rounded;
      case 'deals':
        return Icons.layers_rounded;
      default:
        return Icons.flash_on_rounded;
    }
  }

  List<Color> get _variationGradient {
    switch (widget.variation) {
      case 'pool101':
        return const [Color(0xFF0D9488), Color(0xFF0F766E), Color(0xFF115E59)];
      case 'pool201':
        return const [Color(0xFF2563EB), Color(0xFF1D4ED8), Color(0xFF1E40AF)];
      case 'deals':
        return const [Color(0xFF7C3AED), Color(0xFF6D28D9), Color(0xFF4C1D95)];
      default:
        return AppColors.rummyGrad;
    }
  }

  String _pointValueLabel(double stake) {
    if (widget.variation == 'points') {
      if (AppConfigService.isSafeMode()) {
        final pv = (stake / 80).toStringAsFixed(1);
        return '$pv pts';
      }
      final pv = (stake / 80).toStringAsFixed(2);
      return '₹$pv/pt';
    } else if (widget.variation == 'deals') {
      return '2 Deals';
    } else if (widget.variation == 'pool101') {
      return 'Drop 20/40';
    } else {
      return 'Drop 25/50';
    }
  }

  @override
  void initState() {
    super.initState();
    if (!AppConfigService.isSafeMode()) {
      _socket.connect();
    }
    _loadBalance();
    _loadFeePercent();
    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      if (data['game_type'] != null && data['game_type'] != 'rummy') return;
      setState(() => _searching = false);
      _dismissSearchingDialog();
      context.push('/games/rummy/play/${data['room_id']}', extra: data);
    });
    _errorSub = _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _searching = false);
      _dismissSearchingDialog();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(data['message'] ?? 'Error'),
          backgroundColor: AppColors.red));
    });
    _socket.onReconnect(() {
      if (!mounted || !_searching) return;
      _socket.emit(SocketEvents.joinMatchmaking, {
        'game_type': 'rummy',
        'stake': _selectedStake,
        'variation': widget.variation,
      });
    });
  }

  @override
  void dispose() {
    _searchingTimer?.cancel();
    _roomJoinedSub?.cancel();
    _errorSub?.cancel();
    super.dispose();
  }

  Future<void> _loadBalance() async {
    if (AppConfigService.isSafeMode()) return;
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      final value = double.parse(res.data['real_balance'].toString());
      setState(() {
        _balanceValue = value;
        _balance = value.toStringAsFixed(0);
      });
    } catch (_) {/* offline / no auth */}
  }

  Future<void> _loadFeePercent() async {
    try {
      final res = await ApiClient().dio.get('/api/game-configs/rummy');
      final pct = res.data['rake_percent'];
      if (!mounted || pct == null) return;
      setState(() => _feePercent = double.parse(pct.toString()));
    } catch (_) {/* offline / not found — keep the 5% default */}
  }

  void _joinMatchmaking() {
    if (AppConfigService.isSafeMode()) {
      context.pushReplacement('/games/rummy/practice');
      return;
    }
    if (!_socket.isConnected) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Not connected to server. Attempting to reconnect…'),
        backgroundColor: AppColors.orange,
      ));
      _socket.reconnectNow();
      return;
    }
    if (_balanceValue == null || _balanceValue! < _selectedStake) {
      _showLowBalanceDialog();
      return;
    }
    setState(() {
      _searching = true;
      _secondsRemaining = 60;
    });
    _showSearchingDialog();

    _searchingTimer?.cancel();
    _searchingTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || !_searching) {
        timer.cancel();
        return;
      }
      if (_secondsRemaining > 0) {
        setState(() {
          _secondsRemaining--;
        });
        _dialogSetState?.call(() {});
      } else {
        timer.cancel();
      }
    });

    _socket.emit(SocketEvents.joinMatchmaking, {
      'game_type': 'rummy',
      'stake': _selectedStake,
      'variation': widget.variation,
    });
  }

  void _showSearchingDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            _dialogSetState = setDialogState;
            return AlertDialog(
              backgroundColor: AppColors.cardBg,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                  side: BorderSide(
                      color: AppColors.gold.withValues(alpha: 0.5))),
              contentPadding:
                  const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 30,
                    height: 30,
                    child: CircularProgressIndicator(
                        color: AppColors.gold, strokeWidth: 3),
                  ),
                  const SizedBox(height: 14),
                  Text('Finding players… (${_secondsRemaining}s)',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 14)),
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: _cancelSearch,
                      style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppColors.red)),
                      child: const Text('Cancel',
                          style: TextStyle(color: AppColors.red)),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    ).then((_) {
      _dialogSetState = null;
    });
  }

  void _dismissSearchingDialog() {
    if (_dialogSetState != null) {
      _dialogSetState = null;
      Navigator.of(context, rootNavigator: true).pop();
    }
  }

  void _cancelSearch() {
    _searchingTimer?.cancel();
    _socket.emit(SocketEvents.leaveMatchmaking, {
      'game_type': 'rummy',
      'stake': _selectedStake,
      'variation': widget.variation,
    });
    setState(() => _searching = false);
    _dismissSearchingDialog();
  }

  void _showLowBalanceDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(children: const [
          Icon(Icons.account_balance_wallet_rounded,
              color: AppColors.orange, size: 22),
          SizedBox(width: 8),
          Text('Low Balance', style: TextStyle(fontWeight: FontWeight.bold)),
        ]),
        content: Text(
          AppConfigService.isSafeMode()
              ? 'You need ${_selectedStake.toInt()} 🪙 to join this table.\nYour balance is ${_balance ?? '10,000'} 🪙.\n\nCollect daily bonus coins to keep playing.'
              : 'You need ₹${_selectedStake.toInt()} to join this table.\n'
                'Your balance is ₹${_balance ?? '0'}.\n\nAdd money to start playing.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel',
                  style: TextStyle(color: AppColors.textSecondary))),
          if (!AppConfigService.isSafeMode())
            ElevatedButton.icon(
              onPressed: () {
                Navigator.pop(ctx);
                context.push('/wallet');
              },
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Add Money'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.gold,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final accent = _variationGradient;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Tap to Play',
            style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
        actions: [
          IconButton(
            icon: const Icon(Icons.history_rounded,
                color: AppColors.gold, size: 24),
            tooltip: 'Game History',
            onPressed: () => Navigator.push(context,
                MaterialPageRoute(builder: (_) => const RummyHistoryPage())),
          ),
          if (!AppConfigService.isSafeMode())
            Padding(
              padding: const EdgeInsets.only(right: 14, left: 4),
              child: Center(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.feltDark,
                    borderRadius: BorderRadius.circular(20),
                    border:
                        Border.all(color: AppColors.gold.withValues(alpha: 0.6)),
                  ),
                  child: Text(AppConfigService.getSafeBalanceText(_balance),
                      style: const TextStyle(
                          color: AppColors.gold,
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                ),
              ),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        children: [
          // Dynamic Variation Header
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: accent),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(
                  color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
              boxShadow: [
                BoxShadow(
                    color: accent.last.withValues(alpha: 0.5),
                    blurRadius: 18,
                    offset: const Offset(0, 8)),
              ],
            ),
            child: Stack(
              children: [
                Positioned(
                  right: -12,
                  bottom: -12,
                  child: Icon(_variationIcon,
                      size: 96, color: Colors.white.withValues(alpha: 0.10)),
                ),
                Row(
                  children: [
                    Container(
                      width: 54,
                      height: 54,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(colors: [
                          Colors.white.withValues(alpha: 0.22),
                          Colors.white.withValues(alpha: 0.06),
                        ]),
                        border: Border.all(
                            color: Colors.white.withValues(alpha: 0.35),
                            width: 1.2),
                      ),
                      child: Icon(_variationIcon,
                          color: Colors.white, size: 28),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_variationLabel,
                              style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w900,
                                  color: Colors.white)),
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 9, vertical: 3),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.28),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.18)),
                            ),
                            child: Text(_variationRule,
                                style: TextStyle(
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 0.6,
                                    color: Colors.white
                                        .withValues(alpha: 0.9))),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Tap to Play button
          SizedBox(
            width: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                      color: AppColors.gold.withValues(alpha: 0.35),
                      blurRadius: 14,
                      offset: const Offset(0, 6)),
                ],
              ),
              child: ElevatedButton.icon(
                onPressed: _searching ? null : _joinMatchmaking,
                icon: const Icon(Icons.flash_on_rounded,
                    color: Colors.black, size: 22),
                label: Text(
                    AppConfigService.isSafeMode()
                        ? 'Tap to Play  ·  ${_selectedStake.toInt()} 🪙'
                        : 'Tap to Play  ·  ₹${_selectedStake.toInt()}',
                    style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.3)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  foregroundColor: Colors.black,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),

          // Action Cards (Practice + History)
          Row(
            children: [
              Expanded(
                child: _actionCard(
                  icon: Icons.school_rounded,
                  label: 'Practice Table',
                  sublabel: 'Free · Play with bots',
                  onTap: _searching
                      ? null
                      : () => context.push('/games/rummy/practice'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _actionCard(
                  icon: Icons.history_rounded,
                  label: 'Rummy History',
                  sublabel: 'View past scorecards',
                  onTap: _searching
                      ? null
                      : () => context.push('/games/rummy/history'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 26),

          const Text('SELECT STAKE',
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                  color: AppColors.textSecondary)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: _stakes.map((stake) {
              final selected = _selectedStake == stake;
              return GestureDetector(
                onTap: _searching
                    ? null
                    : () => setState(() => _selectedStake = stake),
                child: Container(
                  width: 92,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: selected
                          ? accent
                          : const [Color(0xFF232838), Color(0xFF171B28)],
                    ),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: selected
                          ? AppColors.gold
                          : AppColors.gold.withValues(alpha: 0.3),
                      width: selected ? 2 : 1.2,
                    ),
                    boxShadow: selected
                        ? [
                            BoxShadow(
                                color: accent.last.withValues(alpha: 0.5),
                                blurRadius: 12,
                                spreadRadius: 1)
                          ]
                        : null,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        AppConfigService.isSafeMode()
                            ? '${stake.toInt()} 🪙'
                            : '₹${stake.toInt()}',
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            fontSize: 16,
                            shadows: [
                              Shadow(color: Colors.black54, blurRadius: 3)
                            ]),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _pointValueLabel(stake),
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.75),
                            fontSize: 9,
                            fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                  child: _statTile(Icons.groups_rounded, 'Players', '4-6')),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(Icons.account_balance_wallet_rounded,
                      'Entry', AppConfigService.isSafeMode() ? '${_selectedStake.toInt()} 🪙' : '₹${_selectedStake.toInt()}')),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(
                      Icons.tune_rounded, 'Format', _pointValueLabel(_selectedStake))),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(Icons.percent_rounded, 'Fee',
                      '${_feePercent == _feePercent.roundToDouble() ? _feePercent.toInt() : _feePercent}%')),
            ],
          ),
          _buildReconnectNotice(),
        ],
      ),
    );
  }

  Widget _actionCard({
    required IconData icon,
    required String label,
    required String sublabel,
    required VoidCallback? onTap,
  }) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, color: AppColors.gold, size: 18),
              ),
              const SizedBox(height: 10),
              Text(label,
                  style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: Colors.white)),
              const SizedBox(height: 2),
              Text(sublabel,
                  style: const TextStyle(
                      fontSize: 10, color: AppColors.textSecondary)),
            ],
          ),
        ),
      );

  Widget _statTile(IconData icon, String label, String value) => Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          color: AppColors.cardBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
        ),
        child: Column(
          children: [
            Icon(icon, size: 15, color: AppColors.gold),
            const SizedBox(height: 6),
            Text(value,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: Colors.white)),
            const SizedBox(height: 2),
            Text(label,
                style: const TextStyle(
                    fontSize: 9, color: AppColors.textSecondary)),
          ],
        ),
      );

  Widget _buildReconnectNotice() {
    return ValueListenableBuilder<String>(
      valueListenable: _socket.status,
      builder: (_, status, __) {
        final connected = status == 'connected';
        final inProgress = status == 'idle' ||
            status == 'reading-token' ||
            status == 'auth-retry' ||
            status.startsWith('connecting') ||
            status.contains('reconnecting');
        if (connected || inProgress) return const SizedBox.shrink();

        return Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.orange.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.orange),
          ),
          child: Row(
            children: [
              const Icon(Icons.wifi_off_rounded,
                  color: AppColors.orange, size: 18),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Disconnected from game server',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
              ),
              TextButton(
                onPressed: () => _socket.reconnectNow(),
                child: const Text('RETRY',
                    style: TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.w900,
                        fontSize: 12)),
              ),
            ],
          ),
        );
      },
    );
  }
}
