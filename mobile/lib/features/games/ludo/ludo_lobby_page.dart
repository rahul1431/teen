import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/services/locale_service.dart';
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
  double _selectedStake = 50;
  // Chosen colour as a 1-based seat (1=red, 2=green, 3=yellow, 4=blue) matching
  // the board's seat→colour order. null = no preference (server's choice).
  int? _preferredSeat;
  bool _searching = false;
  String? _balance;
  double? _balanceValue;
  final _stakes = [50.0, 100.0, 500.0];
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _errorSub;
  StreamSubscription? _statusSub;
  int _secondsRemaining = 60;
  List<Map<String, dynamic>> _queuedPlayers = [];

  @override
  void initState() {
    super.initState();
    _socket.connect();
    _loadBalance();
    _statusSub = _socket.on('matchmaking:status').listen((data) {
      if (!mounted) return;
      if (data is Map) {
        setState(() {
          if (data['seconds_remaining'] != null) {
            _secondsRemaining = (data['seconds_remaining'] as num).toInt();
          }
          if (data['players'] != null && data['players'] is List) {
            _queuedPlayers = List<Map<String, dynamic>>.from(
                (data['players'] as List).map((p) => Map<String, dynamic>.from(p)));
          }
        });
      }
    });
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
    _statusSub?.cancel();
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
    setState(() {
      _searching = true;
      _secondsRemaining = 60;
      _queuedPlayers = [{'username': 'You', 'isBot': false}];
    });
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
        title: Row(children: [
          const Icon(Icons.account_balance_wallet_rounded,
              color: AppColors.orange, size: 22),
          const SizedBox(width: 8),
          Text(locale.t('low_balance'), style: const TextStyle(fontWeight: FontWeight.bold)),
        ]),
        content: Text(
          'You need ₹${_selectedStake.toInt()} to join this table.\n'
          'Your balance is ₹${_balance ?? '0'}.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(locale.t('cancel'),
                  style: const TextStyle(color: AppColors.textSecondary))),
          ElevatedButton.icon(
            onPressed: () {
              Navigator.pop(ctx);
              context.push('/wallet');
            },
            icon: const Icon(Icons.add_rounded, size: 18),
            label: Text(locale.t('add_money')),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
          ),
        ],
      ),
    );
  }

  static const List<Color> _ludoAccent = [Color(0xFF6B1FE8), Color(0xFF2A1A8E)];

  @override
  Widget build(BuildContext context) {
    final isPrivate = widget.privateMode != null;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(locale.t('quick_match')),
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
          // Identity banner — mirrors the Ludo mode-select hero so Quick Match
          // doesn't read as an unbranded generic form.
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  begin: Alignment.topLeft, end: Alignment.bottomRight, colors: _ludoAccent),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
              boxShadow: [
                BoxShadow(color: _ludoAccent.last.withValues(alpha: 0.5), blurRadius: 18, offset: const Offset(0, 8)),
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
                  child: const Center(child: Text('🎲', style: TextStyle(fontSize: 26))),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(isPrivate ? 'Friends Table' : 'Ludo',
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
                        child: const Text('2-4 PLAYERS',
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
          if (isPrivate && widget.privateCode != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                  color: AppColors.cardBg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.gold.withValues(alpha: 0.4))),
              child: Text('Room code: ${widget.privateCode}',
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 16)),
            ),
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
                          ? AppColors.ludoGrad
                          : const [Color(0xFF2A2440), Color(0xFF181426)],
                    ),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: selected
                          ? AppColors.gold
                          : AppColors.gold.withValues(alpha: 0.35),
                      width: selected ? 2 : 1.2,
                    ),
                    boxShadow: selected
                        ? [
                            BoxShadow(
                                color: _ludoAccent.last.withValues(alpha: 0.5),
                                blurRadius: 12,
                                spreadRadius: 1)
                          ]
                        : null,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('₹${stake.toInt()}',
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 16)),
                      const SizedBox(height: 2),
                      Text('pot ₹${(stake * 4).toInt()} max',
                          style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.75),
                              fontSize: 9,
                              fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 26),
          Row(
            children: [
              const Text('CHOOSE YOUR COLOUR',
                  style: TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w900, letterSpacing: 1.2, color: AppColors.textSecondary)),
              const SizedBox(width: 8),
              Text(
                _preferredSeat == null ? '(optional)' : 'guaranteed',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
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
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(child: _statTile(Icons.groups_rounded, 'Players', '2-4')),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(Icons.account_balance_wallet_rounded, locale.t('entry_fee'),
                      '₹${_selectedStake.toInt()}')),
              const SizedBox(width: 10),
              Expanded(
                  child: _statTile(Icons.emoji_events_rounded, 'Pot Max',
                      '₹${(_selectedStake * 4).toInt()}')),
              const SizedBox(width: 10),
              Expanded(child: _statTile(Icons.percent_rounded, 'Fee', '5%')),
            ],
          ),
          if (_searching) ...[
            const SizedBox(height: 28),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: _ludoAccent.last.withValues(alpha: 0.5)),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const SizedBox(
                        width: 22, height: 22,
                        child: CircularProgressIndicator(color: AppColors.gold, strokeWidth: 2.5),
                      ),
                      const SizedBox(width: 10),
                      Text('Finding players… (${_secondsRemaining}s)',
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: List.generate(4, (index) {
                      final hasPlayer = index < _queuedPlayers.length;
                      final player = hasPlayer ? _queuedPlayers[index] : null;
                      final isBot = player?['isBot'] == true;
                      final name = player?['username'] ?? 'Waiting…';

                      return Container(
                        width: 72,
                        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                        decoration: BoxDecoration(
                          color: hasPlayer ? AppColors.gold.withValues(alpha: 0.15) : Colors.black25,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: hasPlayer ? AppColors.gold : Colors.white12,
                            width: hasPlayer ? 1.5 : 1.0,
                          ),
                        ),
                        child: Column(
                          children: [
                            Icon(
                              hasPlayer ? (isBot ? Icons.smart_toy_rounded : Icons.person_rounded) : Icons.hourglass_empty_rounded,
                              size: 22,
                              color: hasPlayer ? AppColors.gold : Colors.white30,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: hasPlayer ? Colors.white : Colors.white38,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 18),
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

  // Tappable colour disc → sets the preferred seat (colour). Tapping the
  // selected one again clears the choice (back to server's pick).
  Widget _colorSwatch(Color color, int seat) {
    final selected = _preferredSeat == seat;
    return Expanded(
      child: GestureDetector(
        onTap: _searching
            ? null
            : () => setState(() => _preferredSeat = selected ? null : seat),
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
                ? [
                    BoxShadow(
                        color: color.withValues(alpha: 0.7),
                        blurRadius: 12,
                        spreadRadius: 1)
                  ]
                : null,
          ),
          child: selected
              ? const Icon(Icons.check_rounded, color: Colors.white, size: 26)
              : null,
        ),
      ),
    );
  }
}
