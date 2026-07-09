import 'dart:async';
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
  // Chosen colour as a 1-based seat (1=red, 2=green, 3=yellow, 4=blue) matching
  // the board's seat→colour order. null = no preference (server's choice).
  int? _preferredSeat;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  final _stakes = [10.0, 50.0, 100.0, 500.0];
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _errorSub;

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _loadBalance();
    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      if (data['game_type'] != null && data['game_type'] != 'ludo') return;
      setState(() => _searching = false);
      context.push('/games/ludo/play/${data['room_id']}', extra: data);
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
      _socket.emit(SocketEvents.joinMatchmaking, {
        'game_type': 'ludo',
        'stake': _selectedStake,
        if (_preferredSeat != null) 'preferred_seat': _preferredSeat,
      });
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
    _socket.emit(SocketEvents.joinMatchmaking, {
      'game_type': 'ludo',
      'stake': _selectedStake,
      if (_preferredSeat != null) 'preferred_seat': _preferredSeat,
    });
  }

  void _cancelSearch() {
    _socket.emit(SocketEvents.leaveMatchmaking,
        {'game_type': 'ludo', 'stake': _selectedStake});
    setState(() => _searching = false);
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
            const SizedBox(height: 28),
            Row(
              children: [
                const Text('Choose Your Colour',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Text(
                  _preferredSeat == null ? '(optional)' : 'guaranteed',
                  style: TextStyle(
                    fontSize: 12,
                    color: _preferredSeat == null
                        ? AppColors.textSecondary
                        : AppColors.ludoGreen,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _colorSwatch(AppColors.ludoRed, 1),
                _colorSwatch(AppColors.ludoGreen, 2),
                _colorSwatch(AppColors.ludoYellow, 3),
                _colorSwatch(AppColors.ludoBlue, 4),
              ],
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

  // Tappable colour disc → sets the preferred seat (colour). Tapping the
  // selected one again clears the choice (back to server's pick).
  Widget _colorSwatch(Color color, int seat) {
    final selected = _preferredSeat == seat;
    return Expanded(
      child: GestureDetector(
        onTap: _searching
            ? null
            : () => setState(
                () => _preferredSeat = selected ? null : seat),
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 6),
          height: 56,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? Colors.white : Colors.transparent,
              width: 3,
            ),
            boxShadow: selected
                ? [BoxShadow(color: color.withOpacity(0.7), blurRadius: 12, spreadRadius: 1)]
                : null,
          ),
          child: selected
              ? const Icon(Icons.check_rounded, color: Colors.white, size: 26)
              : null,
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
