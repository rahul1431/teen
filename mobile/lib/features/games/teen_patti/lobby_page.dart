import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';

class TeenPattiLobbyPage extends StatefulWidget {
  const TeenPattiLobbyPage({super.key});
  @override
  State<TeenPattiLobbyPage> createState() => _TeenPattiLobbyPageState();
}

class _TeenPattiLobbyPageState extends State<TeenPattiLobbyPage> {
  final _socket = SocketService();
  double _selectedStake = 10;
  bool _searching = false;
  final _stakes = [10.0, 50.0, 100.0, 500.0, 1000.0];

  @override
  void initState() {
    super.initState();
    _socket.connect();
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
  }

  void _joinMatchmaking() {
    setState(() => _searching = true);
    _socket.emit(SocketEvents.joinMatchmaking, {'game_type': 'teen_patti', 'stake': _selectedStake});
  }

  void _cancelSearch() {
    _socket.emit(SocketEvents.leaveMatchmaking, {'game_type': 'teen_patti', 'stake': _selectedStake});
    setState(() => _searching = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Teen Patti')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
                    width: 80, height: 60,
                    decoration: BoxDecoration(
                      color: selected ? AppColors.gold : AppColors.cardBg,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: selected ? AppColors.gold : AppColors.border, width: 2),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('₹${stake.toInt()}', style: TextStyle(color: selected ? Colors.black : AppColors.textPrimary, fontWeight: FontWeight.bold, fontSize: 16)),
                      ],
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
              )
            else
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _joinMatchmaking,
                  child: Text('Join Table — ₹${_selectedStake.toInt()}'),
                ),
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
