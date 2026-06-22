import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';

class TeenPattiLobbyPage extends StatefulWidget {
  final String variation;
  const TeenPattiLobbyPage({super.key, this.variation = 'classic'});
  @override
  State<TeenPattiLobbyPage> createState() => _TeenPattiLobbyPageState();
}

class _TeenPattiLobbyPageState extends State<TeenPattiLobbyPage> {
  final _socket = SocketService();
  double _selectedStake = 10;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  final _stakes = [10.0, 50.0, 100.0, 500.0, 1000.0];

  String get _variationLabel {
    switch (widget.variation) {
      case 'ak47': return 'AK47';
      default:     return 'Classic';
    }
  }

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _loadBalance();
    _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      setState(() => _searching = false);
      context.push('/games/teen-patti/play/${data['room_id']}', extra: data);
    });
    _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _searching = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(data['message'] ?? 'Error'), backgroundColor: AppColors.red));
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
    // Gate: block join when balance is unknown or below the selected stake.
    if (_balanceValue == null || _balanceValue! < _selectedStake) {
      _showLowBalanceDialog();
      return;
    }
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
            Icon(Icons.account_balance_wallet_rounded, color: AppColors.orange, size: 22),
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
            child: const Text('Cancel', style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton.icon(
            onPressed: () { Navigator.pop(ctx); context.push('/wallet'); },
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
    _socket.emit(SocketEvents.leaveMatchmaking, {'game_type': 'teen_patti', 'stake': _selectedStake});
    setState(() => _searching = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Teen Patti · $_variationLabel'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.feltDark,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.gold.withOpacity(0.6)),
                ),
                child: Text('₹${_balance ?? '—'}',
                    style: const TextStyle(
                        color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Quick Match hero — quickest path to the table at the chosen stake
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _searching ? null : _joinMatchmaking,
                icon: const Icon(Icons.flash_on, color: Colors.black),
                label: Text('Quick Match — ₹${_selectedStake.toInt()}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
            const SizedBox(height: 24),
            const Text('Select Stake', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: _stakes.map((stake) {
                final selected = _selectedStake == stake;
                return GestureDetector(
                  onTap: _searching ? null : () => setState(() => _selectedStake = stake),
                  child: Container(
                    width: 88,
                    height: 50,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: selected
                            ? const [Color(0xFFE6213A), Color(0xFFB11226), Color(0xFF7A0C1A)]
                            : const [Color(0xFF3A2230), Color(0xFF24121C)],
                      ),
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(
                        color: selected ? AppColors.gold : AppColors.gold.withOpacity(0.35),
                        width: selected ? 2.5 : 1.5,
                      ),
                      boxShadow: selected
                          ? [BoxShadow(color: AppColors.gold.withOpacity(0.45), blurRadius: 12, spreadRadius: 1)]
                          : null,
                    ),
                    child: Text(
                      '₹${stake.toInt()}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                          shadows: [Shadow(color: Colors.black54, blurRadius: 3)]),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: AppColors.cardBg, borderRadius: BorderRadius.circular(16)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Game Info', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  _infoRow('Players', '2-6'),
                  _infoRow('Entry Fee', '₹${_selectedStake.toInt()}'),
                  _infoRow('Pot Size', '₹${(_selectedStake * 6).toInt()} (max)'),
                  _infoRow('Platform Fee', '5%'),
                  _infoRow('Bots', 'Yes (if wait > 10s)'),
                ],
              ),
            ),
            const Spacer(),
            if (_searching)
              Column(
                children: [
                  const CircularProgressIndicator(color: AppColors.gold),
                  const SizedBox(height: 16),
                  const Text('Finding players...', style: TextStyle(color: AppColors.textSecondary)),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: _cancelSearch,
                      style: OutlinedButton.styleFrom(side: const BorderSide(color: AppColors.red)),
                      child: const Text('Cancel', style: TextStyle(color: AppColors.red)),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      children: [
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const Spacer(),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
      ],
    ),
  );
}
