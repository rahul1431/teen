import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:async';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../shared/theme/app_theme.dart';

class TeenPattiGamePage extends StatefulWidget {
  final String roomId;
  const TeenPattiGamePage({super.key, required this.roomId});
  @override
  State<TeenPattiGamePage> createState() => _TeenPattiGamePageState();
}

class _TeenPattiGamePageState extends State<TeenPattiGamePage> {
  final _socket = SocketService();
  Map<String, dynamic>? _gameState;
  String? _myUserId;
  bool _isMyTurn = false;
  int _turnSeq = 0;
  int _turnSecondsLeft = 30;
  Timer? _turnTimer;
  bool _isSeen = false;
  String? _resultMessage;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();
    _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});

    _socket.on(SocketEvents.gameStateUpdate).listen((data) {
      if (!mounted) return;
      setState(() {
        _gameState = data;
        final myPlayer = (data['players'] as List?)?.firstWhere((p) => p['user_id'] == _myUserId, orElse: () => null);
        _isMyTurn = myPlayer != null && data['current_turn_user_id'] == _myUserId;
        if (_isMyTurn) _startTurnTimer();
      });
    });

    _socket.on(SocketEvents.gameResult).listen((data) {
      if (!mounted) return;
      _turnTimer?.cancel();
      setState(() {
        _resultMessage = data['winner_id'] == _myUserId
            ? '🎉 You Won ₹${double.parse(data['prize'].toString()).toStringAsFixed(2)}!'
            : '😔 You Lost. Winner: ${data['winner_username'] ?? 'Unknown'}';
      });
      HapticFeedback.heavyImpact();
    });
  }

  void _startTurnTimer() {
    _turnTimer?.cancel();
    setState(() => _turnSecondsLeft = 30);
    _turnTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      setState(() {
        _turnSecondsLeft--;
        if (_turnSecondsLeft <= 0) {
          t.cancel();
          _sendAction('fold');
        }
      });
    });
  }

  void _sendAction(String action, {double? amount}) {
    _turnTimer?.cancel();
    setState(() => _isMyTurn = false);
    if (action == 'show') setState(() => _isSeen = true);
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': action,
      if (amount != null) 'amount': amount,
      'sequence_num': ++_turnSeq,
    });
    HapticFeedback.mediumImpact();
  }

  @override
  void dispose() {
    _turnTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.teenPattiGreen,
      body: SafeArea(
        child: _resultMessage != null
            ? _buildResult()
            : Stack(
                children: [
                  _buildTable(),
                  if (_isMyTurn) _buildActionBar(),
                ],
              ),
      ),
    );
  }

  Widget _buildTable() {
    final players = (_gameState?['players'] as List?) ?? [];
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              const BackButton(color: Colors.white),
              const Spacer(),
              _potChip(),
              const Spacer(),
              if (_isMyTurn)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: AppColors.red, borderRadius: BorderRadius.circular(20)),
                  child: Text('$_turnSecondsLeft s', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        ),
        Expanded(
          child: Center(
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              alignment: WrapAlignment.center,
              children: players.map<Widget>((p) => _buildPlayerSeat(p)).toList(),
            ),
          ),
        ),
        _buildMyCards(),
      ],
    );
  }

  Widget _potChip() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(20)),
    child: Text('Pot: ₹${_gameState?['pot'] ?? 0}', style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
  );

  Widget _buildPlayerSeat(Map<String, dynamic> player) {
    final isMe = player['user_id'] == _myUserId;
    final isActive = player['status'] == 'active';
    final isTurn = _gameState?['current_turn_user_id'] == player['user_id'];
    return Container(
      width: 90,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: isMe ? AppColors.gold.withOpacity(0.2) : Colors.black45,
        borderRadius: BorderRadius.circular(12),
        border: isTurn ? Border.all(color: AppColors.gold, width: 2) : null,
      ),
      child: Column(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: isActive ? (isMe ? AppColors.gold : Colors.white24) : Colors.grey,
            child: Text(player['username']?[0]?.toUpperCase() ?? '?', style: TextStyle(color: isMe ? Colors.black : Colors.white, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 4),
          Text(isMe ? 'You' : (player['username'] ?? 'Bot'), style: const TextStyle(color: Colors.white, fontSize: 11), overflow: TextOverflow.ellipsis),
          Text(player['status'] == 'folded' ? 'FOLD' : '${player['cards']?.length ?? 0} cards', style: TextStyle(color: isActive ? AppColors.gold : Colors.grey, fontSize: 10)),
          if (player['is_bot'] == true)
            const Text('BOT', style: TextStyle(color: Colors.orange, fontSize: 9)),
        ],
      ),
    );
  }

  Widget _buildMyCards() {
    final me = (_gameState?['players'] as List?)?.where((p) => p['user_id'] == _myUserId).firstOrNull;
    final cards = (me?['cards'] as List?) ?? [];
    if (cards.isEmpty) return const SizedBox(height: 120);
    return Container(
      height: 120,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: cards.map<Widget>((card) => _buildCard(card['value'], card['suit'])).toList(),
      ),
    );
  }

  Widget _buildCard(String value, String suit) {
    final color = (suit == 'H' || suit == 'D') ? AppColors.red : Colors.black;
    final suitSymbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
    return Container(
      width: 70, height: 100,
      margin: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        boxShadow: [const BoxShadow(color: Colors.black38, blurRadius: 8, offset: Offset(2, 4))],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
          Text(suitSymbol, style: TextStyle(fontSize: 20, color: color)),
        ],
      ),
    );
  }

  Widget _buildActionBar() {
    final stake = (_gameState?['min_bet'] as num?)?.toDouble() ?? 10;
    final callAmount = _isSeen ? stake * 2 : stake;
    return Positioned(
      bottom: 0, left: 0, right: 0,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: const BoxDecoration(
          color: Colors.black87,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Row(
          children: [
            Expanded(child: _actionBtn('FOLD', AppColors.red, () => _sendAction('fold'))),
            const SizedBox(width: 8),
            Expanded(child: _actionBtn('CALL\n₹${callAmount.toInt()}', AppColors.gold, () => _sendAction('call'), textColor: Colors.black)),
            const SizedBox(width: 8),
            Expanded(child: _actionBtn('RAISE', Colors.blue, () => _sendAction('raise', amount: stake * 4))),
            if (!_isSeen) ...[
              const SizedBox(width: 8),
              Expanded(child: _actionBtn('SEE', Colors.purple, () => _sendAction('show'))),
            ],
          ],
        ),
      ),
    );
  }

  Widget _actionBtn(String label, Color color, VoidCallback onTap, {Color textColor = Colors.white}) => GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
      child: Text(label, textAlign: TextAlign.center, style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 12)),
    ),
  );

  Widget _buildResult() => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_resultMessage ?? '', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white), textAlign: TextAlign.center),
          const SizedBox(height: 32),
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Back to Lobby'),
          ),
        ],
      ),
    ),
  );
}
