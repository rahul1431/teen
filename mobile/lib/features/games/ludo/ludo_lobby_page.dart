import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';

/// Online Ludo matchmaking. Mirrors the Teen Patti lobby: pick a stake,
/// Quick Match over /ws, navigate to the board on room:joined.
class LudoLobbyPage extends StatefulWidget {
  final String? privateMode; // 'create' | 'join' | null
  final String? privateCode;
  const LudoLobbyPage({super.key, this.privateMode, this.privateCode});
  @override
  State<LudoLobbyPage> createState() => _LudoLobbyPageState();
}

class _LudoLobbyPageState extends State<LudoLobbyPage> {
  final _socket = SocketService();
  double _selectedStake = 10;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  final _stakes = [10.0, 50.0, 100.0, 500.0];

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _loadBalance();
    _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      if (data['game_type'] != null && data['game_type'] != 'ludo') return;
      setState(() => _searching = false);
      context.push('/games/ludo/play/${data['room_id']}', extra: data);
    });
    _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      setState(() => _searching = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(data['message'] ?? 'Error'),
          backgroundColor: AppColors.red));
    });
    _socket.onReconnect(() {
      if (!mounted || !_searching) return;
      _socket.emit(SocketEvents.joinMatchmaking,
          {'game_type': 'ludo', 'stake': _selectedStake});
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
    } catch (_) {/* offline / no auth */}
  }

  void _joinMatchmaking() {
    if (!_socket.isConnected) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Not connected to server. Attempting to reconnect...'),
        backgroundColor: AppColors.orange,
      ));
      _socket.connect();
      return;
    }
    if (_balanceValue == null || _balanceValue! < _selectedStake) {
      _showLowBalanceDialog();
      return;
    }
    setState(() => _searching = true);
    _socket.emit(SocketEvents.joinMatchmaking,
        {'game_type': 'ludo', 'stake': _selectedStake});
  }

  void _cancelSearch() {
    _socket.emit(SocketEvents.leaveMatchmaking,
        {'game_type': 'ludo', 'stake': _selectedStake});
    setState(() => _searching = false);
  }

  Widget _buildSocketDebugPanel() {
    return GestureDetector(
      onTap: () => _socket.connect(),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.35),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.gold.withOpacity(0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: const [
                Icon(Icons.bug_report, size: 14, color: AppColors.gold),
                SizedBox(width: 6),
                Text('Socket Debug (tap to reconnect)',
                    style: TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 6),
            Text('URL: ${_socket.url}',
                style: const TextStyle(color: Colors.white70, fontSize: 10)),
            Text('Token: ${_socket.tokenPresent ? "present" : "MISSING"}',
                style: TextStyle(
                    color: _socket.tokenPresent ? Colors.greenAccent : Colors.redAccent,
                    fontSize: 10)),
            ValueListenableBuilder<String>(
              valueListenable: _socket.status,
              builder: (_, status, __) => Text('Status: $status',
                  style: TextStyle(
                      color: status == 'connected' ? Colors.greenAccent : AppColors.orange,
                      fontSize: 10, fontWeight: FontWeight.bold)),
            ),
            ValueListenableBuilder<String>(
              valueListenable: _socket.lastError,
              builder: (_, err, __) => err.isEmpty
                  ? const SizedBox.shrink()
                  : Text('Error: $err',
                      style: const TextStyle(color: Colors.redAccent, fontSize: 10)),
            ),
          ],
        ),
      ),
    );
  }

  void _showLowBalanceDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(children: [
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
    final isPrivate = widget.privateMode != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(isPrivate ? 'Ludo · Friends' : 'Ludo · Quick Match'),
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
                  border: Border.all(color: AppColors.gold.withOpacity(0.6)),
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
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isPrivate && widget.privateCode != null)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                    color: AppColors.cardBg,
                    borderRadius: BorderRadius.circular(12)),
                child: Text('Room code: ${widget.privateCode}',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _searching ? null : _joinMatchmaking,
                icon: const Icon(Icons.flash_on, color: Colors.black),
                label: Text('Quick Match — ₹${_selectedStake.toInt()}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
            const SizedBox(height: 24),
            const Text('Select Stake',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
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
                    width: 88,
                    height: 50,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: selected
                            ? AppColors.ludoGrad
                            : const [Color(0xFF2A2440), Color(0xFF181426)],
                      ),
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(
                        color: selected
                            ? AppColors.gold
                            : AppColors.gold.withOpacity(0.35),
                        width: selected ? 2.5 : 1.5,
                      ),
                    ),
                    child: Text('₹${stake.toInt()}',
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 16)),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                  color: AppColors.cardBg,
                  borderRadius: BorderRadius.circular(16)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Game Info',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  _infoRow('Players', '2-4'),
                  _infoRow('Entry Fee', '₹${_selectedStake.toInt()}'),
                  _infoRow('Pot Size', '₹${(_selectedStake * 4).toInt()} (max)'),
                  _infoRow('Platform Fee', '5%'),
                  _infoRow('Bots', 'Yes (if wait > 8s)'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            _buildSocketDebugPanel(),
            const Spacer(),
            if (_searching)
              Column(
                children: [
                  const CircularProgressIndicator(color: AppColors.gold),
                  const SizedBox(height: 16),
                  const Text('Finding players...',
                      style: TextStyle(color: AppColors.textSecondary)),
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
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Text(label,
              style:
                  const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const Spacer(),
          Text(value,
              style:
                  const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        ]),
      );
}
