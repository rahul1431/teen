// mobile/lib/features/games/rummy/rummy_game_page.dart
import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';
import 'rummy_engine.dart';

class RummyGamePage extends StatefulWidget {
  final bool offline;
  final String roomId;
  final Map<String, dynamic>? initialData;
  const RummyGamePage({
    super.key,
    this.offline = false,
    this.roomId = 'PRACTICE',
    this.initialData,
  });

  @override
  State<RummyGamePage> createState() => _RummyGamePageState();
}

class _RummyGamePageState extends State<RummyGamePage> {
  final _engine = RummyEngine();
  final _socket = SocketService();
  final _subs = <StreamSubscription>[];

  RummyEngineState? _offlineState;
  Map<String, dynamic>? _onlineState;
  int _mySeatIndex = 0;
  final Set<String> _selectedCardIds = {};
  bool _actionPending = false;
  String? _banner;

  static const int _turnTimerSeconds = 30;
  Timer? _turnTimer;
  int _turnSecondsLeft = _turnTimerSeconds;

  @override
  void initState() {
    super.initState();
    widget.offline ? _initOffline() : _initOnline();
  }

  @override
  void dispose() {
    _turnTimer?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  // ── Offline practice ──────────────────────────────────────────────────
  void _initOffline() {
    final players = [
      RummyPlayerState('me', 'You', false),
      RummyPlayerState('bot1', 'Riya', true),
    ];
    _offlineState = _engine.createGame(players);
    _mySeatIndex = 0;
    setState(() => _banner = 'Your turn — draw a card');
    _syncTurnTimer();
    _maybeDriveOfflineBot();
  }

  void _syncTurnTimer() {
    final isMyTurn = widget.offline
        ? _offlineState?.currentTurn == _mySeatIndex
        : (_onlineState?['current_turn'] == _mySeatIndex);
    final active = isMyTurn && !_actionPending;
    if (active) {
      _turnTimer ??= Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) {
          t.cancel();
          return;
        }
        setState(() {
          _turnSecondsLeft--;
          if (_turnSecondsLeft <= 0) {
            _turnSecondsLeft = 0;
            t.cancel();
            _turnTimer = null;
          }
        });
      });
    } else {
      _turnTimer?.cancel();
      _turnTimer = null;
      _turnSecondsLeft = _turnTimerSeconds;
    }
  }

  Future<void> _maybeDriveOfflineBot() async {
    final s = _offlineState;
    if (s == null || s.status != 'active') return;
    final cur = s.players[s.currentTurn];
    if (!cur.isBot) {
      _syncTurnTimer();
      return;
    }
    await Future.delayed(const Duration(milliseconds: 900));
    if (!mounted) return;
    final idx = s.currentTurn;
    // Simple offline-bot behavior: always draw closed, discard highest
    // non-joker card. (Online bots use the richer coordination.ts heuristic
    // server-side — this offline stand-in only needs to be playable.)
    _engine.drawFromClosed(s, idx);
    final hand = s.players[idx].hand;
    final nonJokers = hand.where((c) => !isJokerCard(c, s.wildRank)).toList();
    final pool = nonJokers.isNotEmpty ? nonJokers : hand;
    final discard = pool.reduce((a, b) => _cardValue(a) >= _cardValue(b) ? a : b);
    _engine.discard(s, idx, discard.id);
    setState(() => _banner = "${cur.username} played");
    if (s.status == 'completed') {
      setState(() => _banner = s.winnerId == _myUserId ? 'You win! 🎉' : '${s.players.firstWhere((p) => p.userId == s.winnerId).username} wins');
      return;
    }
    _maybeDriveOfflineBot();
  }

  int _cardValue(RummyCard c) {
    if (c.rank == 'A') return 1;
    if (['J', 'Q', 'K'].contains(c.rank)) return 10;
    return int.tryParse(c.rank) ?? 10;
  }

  void _offlineDrawClosed() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'draw') return;
    setState(() => _engine.drawFromClosed(s, _mySeatIndex));
  }

  void _offlineDrawOpen() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'draw' || s.openPile.isEmpty) return;
    setState(() => _engine.drawFromOpen(s, _mySeatIndex));
  }

  void _offlineDiscard(String cardId) {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'discard') return;
    setState(() {
      _engine.discard(s, _mySeatIndex, cardId);
      _selectedCardIds.clear();
    });
    _maybeDriveOfflineBot();
  }

  void _offlineDeclare() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'discard') return;
    // Minimal v1 grouping UX: every 3 (or 4) consecutive selected cards in
    // hand order becomes one group. Players arrange their hand via tap
    // reordering (not implemented in this pass — see rummy_board.dart
    // follow-up) so for now groups are inferred in fixed chunks of 3 from
    // the hand's current order, using the trailing 4th card in the first
    // group when 13 doesn't divide evenly by 3.
    final hand = s.players[_mySeatIndex].hand;
    if (hand.length != 14) return;
    final ids = hand.map((c) => c.id).toList()..removeLast();
    final groups = <List<String>>[];
    var i = 0;
    while (i < ids.length) {
      final size = (ids.length - i) == 4 ? 4 : 3;
      groups.add(ids.sublist(i, i + size));
      i += size;
    }
    final won = _engine.declare(s, _mySeatIndex, groups);
    setState(() {
      _banner = won
          ? 'You win! 🎉'
          : 'Invalid declare — you\'re out';
    });
    if (s.status != 'completed') _maybeDriveOfflineBot();
  }

  // ── Online ────────────────────────────────────────────────────────────
  void _initOnline() {
    final hasInitialState = widget.initialData != null && widget.initialData!['state'] != null;
    if (!hasInitialState) {
      _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});
    } else {
      _onlineState = Map<String, dynamic>.from(widget.initialData!['state']);
      _mySeatIndex = widget.initialData!['your_seat'] != null ? (widget.initialData!['your_seat'] as int) - 1 : 0;
    }
    _subs.add(_socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      setState(() {
        _onlineState = data['state'] != null ? Map<String, dynamic>.from(data['state']) : _onlineState;
        _mySeatIndex = (data['your_seat'] ?? 1) - 1;
      });
      _syncTurnTimer();
    }));
    _subs.add(_socket.on('game:state_update').listen((data) {
      if (!mounted || data['room_id'] != widget.roomId) return;
      setState(() {
        _onlineState = Map<String, dynamic>.from(data['state']);
        _actionPending = false;
        final result = data['result'];
        if (result != null) {
          _banner = result['winner_id'] == _myUserId ? 'You win! 🎉' : 'Game over';
        } else if (data['declare_rejected_reason'] != null) {
          _banner = 'Invalid declare: ${data['declare_rejected_reason']}';
        }
      });
      _syncTurnTimer();
    }));
    _subs.add(_socket.on('error').listen((data) {
      if (!mounted) return;
      AppSnackBar.show(context, data['message'] ?? 'Error', error: true);
      setState(() => _actionPending = false);
    }));
  }

  void _onlineAction(String action, {String? cardId, List<List<String>>? groups}) {
    if (_actionPending) return;
    setState(() => _actionPending = true);
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': action,
      if (cardId != null) 'card_id': cardId,
      if (groups != null) 'groups': groups,
    });
  }

  // ── Shared UI ─────────────────────────────────────────────────────────
  bool get _isMyTurn => widget.offline
      ? _offlineState?.currentTurn == _mySeatIndex
      : (_onlineState?['current_turn'] == _mySeatIndex);
  String get _awaiting => widget.offline ? (_offlineState?.awaiting ?? 'draw') : (_onlineState?['awaiting'] ?? 'draw');

  // No standalone "current user id" accessor exists on ApiClient in this
  // codebase — LudoGamePage derives it the same way, from the seated
  // player's own state entry (see ludo_game_page.dart's `_myUserId` getter).
  String? get _myUserId {
    if (widget.offline) {
      final s = _offlineState;
      return (s != null && _mySeatIndex < s.players.length) ? s.players[_mySeatIndex].userId : null;
    }
    final players = (_onlineState?['players'] as List?) ?? [];
    if (_mySeatIndex >= players.length) return null;
    return players[_mySeatIndex]['user_id']?.toString();
  }

  List<Map<String, String>> get _myHand {
    if (widget.offline) {
      return (_offlineState?.players[_mySeatIndex].hand ?? [])
          .map((c) => {'id': c.id, 'rank': c.rank, 'suit': c.suit})
          .toList();
    }
    final players = (_onlineState?['players'] as List?) ?? [];
    if (_mySeatIndex >= players.length) return [];
    final hand = (players[_mySeatIndex]['hand'] as List?) ?? [];
    return hand.map((c) => {'id': c['id'] as String, 'rank': c['rank'] as String, 'suit': c['suit'] as String}).toList();
  }

  Widget _cardWidget(Map<String, String> card) {
    final selected = _selectedCardIds.contains(card['id']);
    final isRed = card['suit'] == 'H' || card['suit'] == 'D';
    final suitSymbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣', 'JK': '🃏'}[card['suit']] ?? '';
    return GestureDetector(
      onTap: () => setState(() {
        selected ? _selectedCardIds.remove(card['id']) : _selectedCardIds.add(card['id']!);
      }),
      child: Container(
        width: 44,
        height: 64,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: selected ? AppColors.gold : Colors.black26, width: selected ? 2 : 1),
        ),
        alignment: Alignment.center,
        child: Text(
          card['rank'] == 'JOKER' ? '🃏' : '${card['rank']}$suitSymbol',
          style: TextStyle(
            color: card['rank'] == 'JOKER' ? Colors.purple : (isRed ? Colors.red : Colors.black),
            fontWeight: FontWeight.bold,
            fontSize: 13,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hand = _myHand;
    final canAct = _isMyTurn && !_actionPending;
    final awaitingDraw = _awaiting == 'draw';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Rummy'),
        backgroundColor: AppColors.surface,
      ),
      body: Column(
        children: [
          if (_banner != null)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(_banner!, style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
            ),
          if (canAct)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                awaitingDraw ? 'Your turn — draw a card ($_turnSecondsLeft s)' : 'Select 13 cards to declare, or discard one ($_turnSecondsLeft s)',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
          const Spacer(),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              GestureDetector(
                onTap: canAct && awaitingDraw ? (widget.offline ? _offlineDrawClosed : () => _onlineAction('draw_closed')) : null,
                child: Container(
                  width: 50, height: 70,
                  decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(6), border: Border.all(color: Colors.white24)),
                  alignment: Alignment.center,
                  child: const Text('Closed', style: TextStyle(color: Colors.white70, fontSize: 10)),
                ),
              ),
              const SizedBox(width: 24),
              GestureDetector(
                onTap: canAct && awaitingDraw ? (widget.offline ? _offlineDrawOpen : () => _onlineAction('draw_open')) : null,
                child: Container(
                  width: 50, height: 70,
                  decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(6), border: Border.all(color: Colors.white24)),
                  alignment: Alignment.center,
                  child: const Text('Open', style: TextStyle(color: Colors.white70, fontSize: 10)),
                ),
              ),
            ],
          ),
          const Spacer(),
          SizedBox(
            height: 80,
            child: ListView(scrollDirection: Axis.horizontal, children: hand.map(_cardWidget).toList()),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                ElevatedButton(
                  onPressed: canAct && !awaitingDraw && _selectedCardIds.length == 1
                      ? () {
                          final id = _selectedCardIds.first;
                          widget.offline ? _offlineDiscard(id) : _onlineAction('discard', cardId: id);
                        }
                      : null,
                  child: const Text('Discard'),
                ),
                ElevatedButton(
                  onPressed: canAct && !awaitingDraw
                      ? (widget.offline ? _offlineDeclare : () => _onlineAction('declare', groups: _naiveGroupsFromHand(hand)))
                      : null,
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.green),
                  child: const Text('Declare'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Same fixed-chunk grouping fallback as _offlineDeclare, for the online
  // path. The server is authoritative regardless of what's submitted here.
  List<List<String>> _naiveGroupsFromHand(List<Map<String, String>> hand) {
    if (hand.length != 14) return [];
    final ids = hand.map((c) => c['id']!).toList()..removeLast();
    final groups = <List<String>>[];
    var i = 0;
    while (i < ids.length) {
      final size = (ids.length - i) == 4 ? 4 : 3;
      groups.add(ids.sublist(i, i + size));
      i += size;
    }
    return groups;
  }
}
