import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';

/// Online Rummy matchmaking. Mirrors the Teen Patti / Ludo lobby: pick a
/// stake, Quick Match over /ws, navigate to the board on room:joined.
class RummyLobbyPage extends StatefulWidget {
  const RummyLobbyPage({super.key});
  @override
  State<RummyLobbyPage> createState() => _RummyLobbyPageState();
}

class _RummyLobbyPageState extends State<RummyLobbyPage> {
  final _socket = SocketService();
  double _selectedStake = 10;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  double _feePercent = 5;
  final _stakes = [10.0, 50.0, 100.0, 500.0];
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _errorSub;

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _loadBalance();
    _loadFeePercent();
    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      if (data['game_type'] != null && data['game_type'] != 'rummy') return;
      setState(() => _searching = false);
      context.push('/games/rummy/play/${data['room_id']}', extra: data);
    });
    _errorSub = _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _searching = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(data['message'] ?? 'Error'),
          backgroundColor: AppColors.red));
    });
    _socket.onReconnect(() {
      if (!mounted || !_searching) return;
      _socket.emit(SocketEvents.joinMatchmaking,
          {'game_type': 'rummy', 'stake': _selectedStake});
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
    setState(() => _searching = true);
    _socket.emit(SocketEvents.joinMatchmaking,
        {'game_type': 'rummy', 'stake': _selectedStake});
  }

  void _cancelSearch() {
    _socket.emit(SocketEvents.leaveMatchmaking,
        {'game_type': 'rummy', 'stake': _selectedStake});
    setState(() => _searching = false);
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
          'You need ₹${_selectedStake.toInt()} to join this table.\n'
          'Your balance is ₹${_balance ?? '0'}.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel',
                  style: TextStyle(color: AppColors.textSecondary))),
          ElevatedButton.icon(
            onPressed: () {
              Navigator.pop(ctx);
              context.push('/wallet');
            },
            icon: const Icon(Icons.add_rounded, size: 18),
            label: const Text('Add Money'),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Quick Match'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
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
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  begin: Alignment.topLeft, end: Alignment.bottomRight, colors: AppColors.rummyGrad),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
              boxShadow: [
                BoxShadow(color: AppColors.rummyGrad.last.withValues(alpha: 0.5), blurRadius: 18, offset: const Offset(0, 8)),
              ],
            ),
            child: Row(
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
                  child: const Center(child: Text('🂡', style: TextStyle(fontSize: 26))),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Rummy',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.28),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
                        ),
                        child: const Text('2-6 PLAYERS',
                            style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.6,
                                color: Colors.white)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
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
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => context.push('/games/rummy/practice'),
              icon: const Icon(Icons.school_rounded, size: 18, color: AppColors.gold),
              label: const Text('Practice vs Bots (Free)',
                  style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700)),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: AppColors.gold.withValues(alpha: 0.5)),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
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
                          ? AppColors.rummyGrad
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
                                color: AppColors.rummyGrad.last.withValues(alpha: 0.5),
                                blurRadius: 12,
                                spreadRadius: 1)
                          ]
                        : null,
                  ),
                  child: Text('₹${stake.toInt()}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 16)),
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
              Expanded(child: _statTile(Icons.percent_rounded, 'Fee',
                  '${_feePercent == _feePercent.roundToDouble() ? _feePercent.toInt() : _feePercent}%')),
            ],
          ),
          if (_searching) ...[
            const SizedBox(height: 28),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: AppColors.rummyGrad.last.withValues(alpha: 0.5)),
              ),
              child: Column(
                children: [
                  const SizedBox(
                    width: 30, height: 30,
                    child: CircularProgressIndicator(color: AppColors.gold, strokeWidth: 3),
                  ),
                  const SizedBox(height: 14),
                  const Text('Finding players…',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
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
}
