import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';
import 'history_page.dart';

class TeenPattiLobbyPage extends StatefulWidget {
  final String variation;
  const TeenPattiLobbyPage({super.key, this.variation = 'classic'});
  @override
  State<TeenPattiLobbyPage> createState() => _TeenPattiLobbyPageState();
}

class _TeenPattiLobbyPageState extends State<TeenPattiLobbyPage> {
  final _socket = SocketService();
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _errorSub;
  double _selectedStake = 10;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  final _stakes = [10.0, 50.0, 100.0, 500.0, 1000.0];

  String get _variationLabel {
    switch (widget.variation) {
      case 'ak47':
        return 'AK47';
      case 'no_limit':
        return 'No Limit';
      case 'muflis':
        return 'Muflis';
      case 'joker':
        return 'Joker';
      default:
        return 'Classic';
    }
  }

  // Per-variation identity (icon + rule text + accent gradient) — mirrors the
  // mode-select grid so the accent carries through from tap to table instead
  // of every variation's lobby looking identical.
  String get _variationRule {
    switch (widget.variation) {
      case 'ak47':
        return 'WILD · A K 4 7';
      case 'no_limit':
        return 'NO POT CAP';
      case 'muflis':
        return 'LOWEST WINS';
      case 'joker':
        return 'RANDOM WILD';
      default:
        return 'STANDARD RULES';
    }
  }

  IconData get _variationIcon {
    switch (widget.variation) {
      case 'ak47':
        return Icons.auto_awesome_rounded;
      case 'no_limit':
        return Icons.all_inclusive_rounded;
      case 'muflis':
        return Icons.trending_down_rounded;
      case 'joker':
        return Icons.casino_rounded;
      default:
        return Icons.style_rounded;
    }
  }

  List<Color> get _variationGradient {
    switch (widget.variation) {
      case 'ak47':
        return AppColors.premiumGrad;
      case 'no_limit':
        return const [Color(0xFF2196F3), Color(0xFF0D47A1)];
      case 'muflis':
        return const [Color(0xFF00C853), Color(0xFF064E3B)];
      case 'joker':
        return const [Color(0xFF9C27B0), Color(0xFF4A148C)];
      default:
        return AppColors.teenPattiGrad;
    }
  }

  bool get _isNoLimit => widget.variation == 'no_limit';

  // Mirrors the engine's potLimitFor() tiers.
  int _potLimitFor(double stake) {
    if (stake <= 10) return 500;
    if (stake <= 50) return 1000;
    if (stake <= 100) return 1500;
    if (stake <= 500) return 10000;
    return 20000;
  }

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _loadBalance();
    _attachRoomJoinedListener();
    _errorSub = _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _searching = false);
      final msg = (data is Map ? data['message'] as String? : null) ??
          'Connection error. Please retry.';
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.red));
    });
    // Re-join matchmaking queue after socket reconnects (preserves searching state)
    _socket.onReconnect(() {
      if (!mounted || !_searching) return;
      _socket.emit(SocketEvents.joinMatchmaking, {
        'game_type': 'teen_patti',
        'stake': _selectedStake,
        'variation': widget.variation,
      });
    });
  }

  // Re-subscribes to roomJoined each time we need it. The listener is cancelled
  // after navigation to prevent the lobby (still alive in the stack) from double-
  // firing when the game page emits its own joinRoom. We re-attach here on every
  // new search so the 2nd, 3rd... game can still receive the event.
  void _attachRoomJoinedListener() {
    _roomJoinedSub?.cancel();
    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted || !_searching) return;
      _roomJoinedSub?.cancel();
      _roomJoinedSub = null;
      setState(() => _searching = false);
      context.push('/games/teen-patti/play/${data['room_id']}', extra: data);
    });
  }

  @override
  void dispose() {
    _roomJoinedSub?.cancel();
    _errorSub?.cancel();
    super.dispose();
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      final value = double.parse(res.data['real_balance'].toString());
      setState(() {
        _balanceValue = value;
        _balance = value.toStringAsFixed(0);
      });
    } catch (_) {/* offline / no auth — leave as '—' */}
  }

  void _joinMatchmaking() {
    if (!_socket.isConnected) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Not connected to server. Attempting to reconnect…'),
        backgroundColor: AppColors.orange,
      ));
      _socket.reconnectNow();
      return;
    }
    // Gate: block join when balance is unknown or below the selected stake.
    if (_balanceValue == null || _balanceValue! < _selectedStake) {
      _showLowBalanceDialog();
      return;
    }
    // Reattach listener every time — it was cancelled after game 1 to prevent
    // the lobby (alive in stack) from firing again on the game page's joinRoom.
    _attachRoomJoinedListener();
    setState(() => _searching = true);
    _socket.emit(SocketEvents.joinMatchmaking, {
      'game_type': 'teen_patti',
      'stake': _selectedStake,
      'variation': widget.variation,
    });
  }

  void _showLowBalanceDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.account_balance_wallet_rounded,
                color: AppColors.orange, size: 22),
            SizedBox(width: 8),
            Text('Low Balance', style: TextStyle(fontWeight: FontWeight.bold)),
          ],
        ),
        content: Text(
          'You need ₹${_selectedStake.toInt()} to join this table.\n'
          'Your balance is ₹${_balance ?? '0'}.\n\nAdd money to start playing.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
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

  void _cancelSearch() {
    _socket.emit(SocketEvents.leaveMatchmaking, {
      'game_type': 'teen_patti',
      'stake': _selectedStake,
      'variation': widget.variation,
    });
    _roomJoinedSub?.cancel();
    _roomJoinedSub = null;
    setState(() => _searching = false);
  }

  @override
  Widget build(BuildContext context) {
    final accent = _variationGradient;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Quick Match'),
        actions: [
          IconButton(
            icon: const Icon(Icons.history_rounded, color: AppColors.gold),
            tooltip: 'Game History',
            onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => const TeenPattiHistoryPage())),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 14),
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
                child: Text('₹${_balance ?? '—'}',
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
          // Variation identity banner — the accent carries through from the
          // mode-select tile the player tapped, so the lobby doesn't look
          // interchangeable between Classic/AK47/No Limit/Muflis/Joker.
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                  begin: Alignment.topLeft, end: Alignment.bottomRight, colors: accent),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
              boxShadow: [
                BoxShadow(color: accent.last.withValues(alpha: 0.5), blurRadius: 18, offset: const Offset(0, 8)),
              ],
            ),
            child: Stack(
              children: [
                Positioned(
                  right: -12, bottom: -12,
                  child: Icon(_variationIcon, size: 96, color: Colors.white.withValues(alpha: 0.10)),
                ),
                Row(
                  children: [
                    Container(
                      width: 54, height: 54,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(colors: [
                          Colors.white.withValues(alpha: 0.22),
                          Colors.white.withValues(alpha: 0.06),
                        ]),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 1.2),
                      ),
                      child: Icon(_variationIcon, color: Colors.white, size: 28),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_variationLabel,
                              style: const TextStyle(
                                  fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.28),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
                            ),
                            child: Text(_variationRule,
                                style: TextStyle(
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 0.6,
                                    color: Colors.white.withValues(alpha: 0.9))),
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

          // Quick Match hero — quickest path to the table at the chosen stake
          SizedBox(
            width: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(color: AppColors.gold.withValues(alpha: 0.35), blurRadius: 14, offset: const Offset(0, 6)),
                ],
              ),
              child: ElevatedButton.icon(
                onPressed: _searching ? null : _joinMatchmaking,
                icon: const Icon(Icons.flash_on_rounded, color: Colors.black, size: 22),
                label: Text('Quick Match  ·  ₹${_selectedStake.toInt()}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900, letterSpacing: 0.3)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  foregroundColor: Colors.black,
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          // Friends tables — create a private code table or join a friend's
          Row(
            children: [
              Expanded(
                child: _actionCard(
                  icon: Icons.group_add_rounded,
                  label: 'Create Table',
                  sublabel: 'Private · invite friends',
                  onTap: _searching
                      ? null
                      : () {
                          if (_balanceValue == null ||
                              _balanceValue! < _selectedStake) {
                            _showLowBalanceDialog();
                            return;
                          }
                          context.push(
                              '/games/teen-patti/friends?mode=create&stake=${_selectedStake.toInt()}');
                        },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _actionCard(
                  icon: Icons.pin_rounded,
                  label: 'Join with Code',
                  sublabel: 'Enter a friend\'s table',
                  onTap: _searching
                      ? null
                      : () =>
                          context.push('/games/teen-patti/friends?mode=join'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 26),
          const Text('SELECT STAKE',
              style: TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w900, letterSpacing: 1.2, color: AppColors.textSecondary)),
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
                        '₹${stake.toInt()}',
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
                        _isNoLimit ? 'no cap' : 'pot ₹${_potLimitFor(stake)}',
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
              Expanded(child: _statTile(Icons.groups_rounded, 'Players', '2-6')),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(Icons.account_balance_wallet_rounded, 'Entry',
                      '₹${_selectedStake.toInt()}')),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(
                      Icons.trending_up_rounded,
                      'Pot Limit',
                      _isNoLimit ? 'No Limit' : '₹${_potLimitFor(_selectedStake)}')),
              const SizedBox(width: 10),
              Expanded(child: _statTile(Icons.percent_rounded, 'Fee', '5%')),
            ],
          ),
          _buildReconnectNotice(),
          if (_searching) ...[
            const SizedBox(height: 28),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: accent.last.withValues(alpha: 0.5)),
              ),
              child: Column(
                children: [
                  const SizedBox(
                    width: 30, height: 30,
                    child: CircularProgressIndicator(color: AppColors.gold, strokeWidth: 3),
                  ),
                  const SizedBox(height: 14),
                  Text('Finding players for $_variationLabel…',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                  const SizedBox(height: 16),
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
            ),
          ],
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
                width: 34, height: 34,
                decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, color: AppColors.gold, size: 18),
              ),
              const SizedBox(height: 10),
              Text(label,
                  style: const TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 2),
              Text(sublabel,
                  style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
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
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.white)),
            const SizedBox(height: 2),
            Text(label,
                style: const TextStyle(fontSize: 9, color: AppColors.textSecondary)),
          ],
        ),
      );

  // Shows only when the socket connection has failed, so players can recover
  // from a dropped connection with one tap. Hidden while connected or connecting.
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
          width: double.infinity,
          margin: const EdgeInsets.only(top: 12),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.red.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.red.withValues(alpha: 0.5)),
          ),
          child: Row(
            children: [
              const Icon(Icons.wifi_off_rounded,
                  size: 18, color: AppColors.red),
              const SizedBox(width: 10),
              const Expanded(
                child: Text('Connection lost',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w600)),
              ),
              TextButton.icon(
                onPressed: () => _socket.reconnectNow(),
                icon: const Icon(Icons.refresh_rounded,
                    size: 16, color: AppColors.gold),
                label: const Text('Reconnect',
                    style: TextStyle(
                        color: AppColors.gold, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        );
      },
    );
  }
}
