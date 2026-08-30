// mobile/lib/features/games/rummy/rummy_game_page.dart
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/storage/secure_storage.dart';
import 'rummy_engine.dart';
import 'rummy_history_page.dart';

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

class _RummyGamePageState extends State<RummyGamePage>
    with TickerProviderStateMixin {
  final _engine = RummyEngine();
  final _socket = SocketService();
  final _subs = <StreamSubscription>[];
  late AnimationController _pulseController;

  RummyEngineState? _offlineState;
  Map<String, dynamic>? _onlineState;
  int _mySeatIndex = 0;
  String? _localUserId;
  final Set<String> _selectedCardIds = {};
  bool _actionPending = false;
  Timer? _actionTimeoutTimer;
  String? _banner;
  bool _muted = false;
  bool _isGameOverModalShown = false;

  static const int _turnTimerSeconds = 30;
  Timer? _turnTimer;
  int _turnSecondsLeft = _turnTimerSeconds;

  List<List<String>> _customGroups = [];

  // Relative seat coordinates around the Landscape Oval Table: (fracX, fracY)
  static const _seatPositions = [
    (0.18, 0.16), // Top-Left (Opponent 1)
    (0.40, 0.12), // Top-Mid-Left (Opponent 2)
    (0.60, 0.12), // Top-Mid-Right (Opponent 3)
    (0.82, 0.16), // Top-Right (Opponent 4)
    (0.06, 0.44), // Far-Left (Opponent 5)
    (0.94, 0.44), // Far-Right (Opponent 6)
  ];

  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    _muted = SoundService.instance.muted;

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat(reverse: true);

    // Lock to landscape orientation for full horizontal casino table
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

    if (!_muted) {
      SoundService.instance.loopAmbience('casino_bgm.mp3');
    }

    _loadUserAndInit();
  }

  Future<void> _loadUserAndInit() async {
    _localUserId = await SecureStorage.getUserId();
    if (!mounted) return;
    widget.offline ? _initOffline() : _initOnline();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _turnTimer?.cancel();
    _actionTimeoutTimer?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    SoundService.instance.stopAmbience();

    // Restore portrait orientation on exit
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
    ]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual,
        overlays: SystemUiOverlay.values);

    super.dispose();
  }

  void _toggleMute() {
    SoundService.instance.toggleMute();
    final isMuted = SoundService.instance.muted;
    if (isMuted) {
      SoundService.instance.stopAmbience();
    } else {
      SoundService.instance.loopAmbience('casino_bgm.mp3');
    }
    setState(() => _muted = isMuted);
  }

  // ── Offline Practice ──────────────────────────────────────────────────
  void _initOffline() {
    final players = [
      RummyPlayerState(_localUserId ?? 'me', 'You', false),
      RummyPlayerState('bot1', 'Riya (AI)', true),
      RummyPlayerState('bot2', 'Kabir (AI)', true),
      RummyPlayerState('bot3', 'Aarav (AI)', true),
    ];
    _offlineState = _engine.createGame(players);
    _mySeatIndex = 0;
    _smartAutoGroup();
    setState(() => _banner = 'Your turn — Draw from Closed Deck or Open Pile');
    _syncTurnTimer();
    SoundService.instance.play(Sfx.cardDeal);
    _maybeDriveOfflineBot();
  }

  void _syncTurnTimer() {
    _turnTimer?.cancel();
    _turnSecondsLeft = _turnTimerSeconds;
    _turnTimer = Timer.periodic(const Duration(seconds: 1), (t) {
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
  }

  Future<void> _maybeDriveOfflineBot() async {
    final s = _offlineState;
    if (s == null || s.status != 'active') return;
    if (s.currentTurn < 0 || s.currentTurn >= s.players.length) return;
    final cur = s.players[s.currentTurn];
    if (!cur.isBot) {
      _syncTurnTimer();
      setState(() => _banner = 'Your turn — Draw from Closed Deck or Open Pile');
      return;
    }

    _syncTurnTimer();
    setState(() => _banner = '${cur.username} is thinking... (AI Turn)');

    // Random thinking time for bots between 5 and 15 seconds
    final delaySeconds = math.Random().nextInt(11) + 5;
    await Future.delayed(Duration(seconds: delaySeconds));
    if (!mounted) return;
    final idx = s.currentTurn;
    _engine.drawFromClosed(s, idx);
    SoundService.instance.play(Sfx.cardDeal);
    final hand = s.players[idx].hand;
    if (hand.isEmpty) return;
    final nonJokers = hand.where((c) => !isJokerCard(c, s.wildRank)).toList();
    final pool = nonJokers.isNotEmpty ? nonJokers : hand;
    final discard =
        pool.reduce((a, b) => _cardValue(a) >= _cardValue(b) ? a : b);
    _engine.discard(s, idx, discard.id);
    SoundService.instance.play(Sfx.chipBet);
    setState(() => _banner = "${cur.username} discarded");
    if (s.status == 'completed') {
      final isMeWinner = s.winnerId == (_localUserId ?? 'me');
      SoundService.instance.play(isMeWinner ? Sfx.win : Sfx.lose);
      setState(() => _banner = isMeWinner
          ? '🏆 You win! Valid Declare!'
          : '${s.players.firstWhere((p) => p.userId == s.winnerId, orElse: () => s.players.first).username} wins');
      _showGameOverModal({
        'winner_id': s.winnerId,
        'winner_name':
            s.players.firstWhere((p) => p.userId == s.winnerId, orElse: () => s.players.first).username,
        'prize': _currentPot,
      });
      return;
    }
    _maybeDriveOfflineBot();
  }

  int _cardValue(RummyCard c) {
    if (c.rank == 'A') return 10;
    if (['J', 'Q', 'K'].contains(c.rank)) return 10;
    return int.tryParse(c.rank) ?? 10;
  }

  void _offlineDrawClosed() {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'draw') {
      return;
    }
    SoundService.instance.play(Sfx.cardDeal);
    setState(() {
      _engine.drawFromClosed(s, _mySeatIndex);
      _banner = 'Select a card to Discard or Declare';
      _syncGroupsWithHand();
    });
  }

  void _offlineDrawOpen() {
    final s = _offlineState;
    if (s == null ||
        s.currentTurn != _mySeatIndex ||
        s.awaiting != 'draw' ||
        s.openPile.isEmpty) return;
    SoundService.instance.play(Sfx.cardDeal);
    setState(() {
      _engine.drawFromOpen(s, _mySeatIndex);
      _banner = 'Select a card to Discard or Declare';
      _syncGroupsWithHand();
    });
  }

  void _offlineDiscard(String cardId) {
    final s = _offlineState;
    if (s == null ||
        s.currentTurn != _mySeatIndex ||
        s.awaiting != 'discard') return;
    SoundService.instance.play(Sfx.chipBet);
    setState(() {
      _engine.discard(s, _mySeatIndex, cardId);
      _selectedCardIds.clear();
      _syncGroupsWithHand();
    });
    _maybeDriveOfflineBot();
  }

  void _offlineDeclare({String? finishCardId}) {
    final s = _offlineState;
    if (s == null || s.currentTurn != _mySeatIndex || s.awaiting != 'discard') {
      return;
    }
    final cardId = finishCardId ?? (_selectedCardIds.isNotEmpty ? _selectedCardIds.first : null);
    var groups = _customGroups;
    if (cardId != null) {
      groups = groups.map((g) => g.where((id) => id != cardId).toList()).where((g) => g.isNotEmpty).toList();
    }
    final success = _engine.declare(s, _mySeatIndex, groups);
    if (!success) {
      SoundService.instance.play(Sfx.lose);
      _showInvalidDeclareDialog('Invalid declaration melds. You need at least 2 sequences (1 pure sequence with no jokers) and all cards in valid sets/sequences.');
      return;
    }
    SoundService.instance.play(Sfx.win);
    setState(() => _banner = '🏆 Valid Declare! You won!');
    _showGameOverModal({
      'winner_id': _myUserId,
      'winner_name': 'You',
      'prize': _currentPot,
    });
  }

  void _triggerDeclare({String? finishCardId}) {
    HapticFeedback.heavyImpact();
    final cardId = finishCardId ?? (_selectedCardIds.isNotEmpty ? _selectedCardIds.first : null);
    if (widget.offline) {
      _offlineDeclare(finishCardId: cardId);
    } else {
      _onlineAction('declare', cardId: cardId);
    }
  }

  // ── Online WebSocket ──────────────────────────────────────────────────
  void _initOnline() {
    _subs.add(_socket.on(SocketEvents.gameStateUpdate).listen((data) {
      if (!mounted) return;
      _actionTimeoutTimer?.cancel();
      final raw = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      final state = (raw['state'] is Map) ? Map<String, dynamic>.from(raw['state']) : raw;
      final eventRoomId = (raw['room_id'] ?? state['room_id'] ?? state['roomId'])?.toString();
      if (eventRoomId != null && eventRoomId.isNotEmpty && eventRoomId != widget.roomId) {
        return; // Discard stale state updates from other/prior rooms
      }

      setState(() {
        _onlineState = state;
        _actionPending = false;
        _resolveMySeatIndex(raw);
        _syncGroupsWithHand();

        if (raw['declare_rejected_reason'] != null) {
          _showInvalidDeclareDialog(raw['declare_rejected_reason'].toString());
        }
      });
      _syncTurnTimer();

      // If game state ended or result embedded, show game over modal
      if (state['status'] == 'completed' || raw['result'] != null) {
        final res = (raw['result'] is Map)
            ? Map<String, dynamic>.from(raw['result'])
            : <String, dynamic>{
                'winner_id': state['winner_id'],
                'winner_name': state['winner_name'],
                'prize': state['prize'] ?? _currentPot,
              };
        final isMeWinner = res['winner_id']?.toString() == _myUserId?.toString();
        SoundService.instance.play(isMeWinner ? Sfx.win : Sfx.lose);
        _showGameOverModal(res);
      }
    }));

    _subs.add(_socket.on(SocketEvents.gameResult).listen((data) {
      if (!mounted) return;
      _actionTimeoutTimer?.cancel();
      final res = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      final eventRoomId = (res['room_id'] ?? res['roomId'])?.toString();
      if (eventRoomId != null && eventRoomId.isNotEmpty && eventRoomId != widget.roomId) {
        return; // Discard stale result events from other/prior rooms
      }

      setState(() => _actionPending = false);
      final isMeWinner = res['winner_id']?.toString() == _myUserId?.toString();
      SoundService.instance.play(isMeWinner ? Sfx.win : Sfx.lose);
      _showGameOverModal(res);
    }));

    _subs.add(_socket.on(SocketEvents.roomJoined).listen((data) {
      if (!mounted) return;
      _actionTimeoutTimer?.cancel();
      final map = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
      final state = (map['state'] is Map) ? Map<String, dynamic>.from(map['state']) : map;
      final eventRoomId = (map['room_id'] ?? map['roomId'] ?? state['room_id'] ?? state['roomId'])?.toString();
      if (eventRoomId != null && eventRoomId.isNotEmpty && eventRoomId != widget.roomId) {
        return; // Discard join events for other rooms
      }

      setState(() {
        _onlineState = state;
        _actionPending = false;
        _resolveMySeatIndex(map);
        _syncGroupsWithHand();
        if (_customGroups.isEmpty) {
          _smartAutoGroup();
        }
      });
      _syncTurnTimer();
    }));

    // Listen to error events so UI never freezes on rejected actions
    _subs.add(_socket.on('error').listen((data) {
      if (!mounted) return;
      _actionTimeoutTimer?.cancel();
      setState(() => _actionPending = false);
      if (data is Map && data['message'] != null) {
        final msg = data['message'].toString();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: const Color(0xFFEF4444),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    }));

    if (widget.initialData != null) {
      final init = widget.initialData!;
      final state = (init['state'] is Map) ? Map<String, dynamic>.from(init['state']) : init;
      _onlineState = state;
      _resolveMySeatIndex(init);
      _syncGroupsWithHand();
      if (_customGroups.isEmpty) {
        _smartAutoGroup();
      }
      _syncTurnTimer();
    }
  }

  void _resolveMySeatIndex(Map<String, dynamic> payload) {
    if (payload['seat_index'] != null) {
      final s = int.tryParse(payload['seat_index'].toString());
      if (s != null) {
        _mySeatIndex = s;
        return;
      }
    }
    if (payload['your_seat'] != null) {
      final ySeat = int.tryParse(payload['your_seat'].toString());
      if (ySeat != null) {
        _mySeatIndex = math.max(0, ySeat - 1);
        return;
      }
    }

    final players = (_onlineState?['players'] as List?) ?? [];
    // Priority 1: Match by user_id
    if (_localUserId != null && _localUserId!.isNotEmpty) {
      for (var i = 0; i < players.length; i++) {
        final p = players[i];
        if (p is Map) {
          final pid = (p['user_id'] ?? p['userId'])?.toString();
          if (pid == _localUserId) {
            _mySeatIndex = i;
            return;
          }
        }
      }
    }

    // Priority 2: Non-bot player who has unredacted hand cards
    for (var i = 0; i < players.length; i++) {
      final p = players[i];
      if (p is Map && p['is_bot'] != true && p['isBot'] != true) {
        final hand = p['hand'] as List?;
        if (hand != null && hand.isNotEmpty) {
          _mySeatIndex = i;
          return;
        }
      }
    }
  }

  void _onlineAction(String type, {String? cardId}) {
    if (_actionPending) return;
    setState(() => _actionPending = true);

    // Safety timeout: auto-release _actionPending after 4s in case network packet is dropped
    _actionTimeoutTimer?.cancel();
    _actionTimeoutTimer = Timer(const Duration(seconds: 4), () {
      if (mounted && _actionPending) {
        setState(() => _actionPending = false);
      }
    });

    if (type == 'draw_closed' || type == 'draw_open') {
      SoundService.instance.play(Sfx.cardDeal);
    } else if (type == 'discard') {
      SoundService.instance.play(Sfx.chipBet);
    }

    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': type,
      'card_id': cardId,
      'groups': type == 'declare' ? _customGroups : null,
    });
  }

  // ── Leave / Exit Confirmation Dialog ─────────────────────────────────
  void _confirmLeaveTable() {
    SoundService.instance.play(Sfx.buttonTap);
    final isPlaying = widget.offline
        ? (_offlineState?.status == 'active')
        : (_onlineState?['status'] == 'active' || _onlineState?['status'] == 'playing');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E2433),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFEF4444), width: 1.5),
        ),
        title: Row(
          children: const [
            Icon(Icons.exit_to_app_rounded, color: Color(0xFFEF4444)),
            SizedBox(width: 8),
            Text('Leave Table?',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold, fontSize: 17)),
          ],
        ),
        content: Text(
          isPlaying
              ? 'Are you sure you want to leave this table?\n\nIf you leave during an active round, your hand will be forfeited and standard drop penalty will apply.'
              : 'Are you sure you want to exit to the lobby?',
          style: const TextStyle(color: Colors.white70, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('STAY',
                style: TextStyle(
                    color: Colors.white70, fontWeight: FontWeight.bold)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _performExit();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('LEAVE TABLE',
                style: TextStyle(fontWeight: FontWeight.w900)),
          ),
        ],
      ),
    );
  }

  void _performExit() {
    if (!widget.offline) {
      _socket.emit('leave_room', {
        'room_id': widget.roomId,
        'game_type': 'rummy',
      });
    }
    SoundService.instance.stopAmbience();
    if (mounted) {
      context.pop();
    }
  }

  // ── Hand Sorting & Smart Auto-Grouping ──────────────────────────────
  void _syncGroupsWithHand() {
    final hand = _myHand;
    final currentIds = hand.map((c) => c['id']!).toSet();

    _customGroups = _customGroups
        .map((g) => g.where((id) => currentIds.contains(id)).toList())
        .where((g) => g.isNotEmpty)
        .toList();

    final groupedIds = _customGroups.expand((g) => g).toSet();
    final unGrouped = currentIds.difference(groupedIds);
    if (unGrouped.isNotEmpty) {
      if (_customGroups.isEmpty) {
        _customGroups.add(unGrouped.toList());
      } else {
        _customGroups.last.addAll(unGrouped);
      }
    }
  }

  // Smart Auto-Group (Magic Meld)
  void _smartAutoGroup() {
    SoundService.instance.play(Sfx.cardDeal, volume: 0.6);
    final hand = _myHand;
    if (hand.isEmpty) return;

    final cards = hand
        .map((c) => RummyCard(c['id']!, c['rank']!, c['suit']!))
        .toList();

    final autoGroups = _engine.smartAutoGroup(cards, _wildRank);
    if (autoGroups.isNotEmpty) {
      setState(() {
        _customGroups = autoGroups;
        _selectedCardIds.clear();
      });
    } else {
      _smartSortHand();
    }
  }

  void _smartSortHand() {
    SoundService.instance.play(Sfx.cardDeal, volume: 0.5);
    final hand = _myHand;
    if (hand.isEmpty) return;

    final rankOrder = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
      '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'JOKER': 14
    };

    final mapBySuit = <String, List<Map<String, String>>>{};
    for (final c in hand) {
      final s = c['suit'] ?? 'S';
      mapBySuit.putIfAbsent(s, () => []).add(c);
    }

    final newGroups = <List<String>>[];
    for (final suit in ['S', 'H', 'C', 'D', 'JK']) {
      final cardsInSuit = mapBySuit[suit] ?? [];
      if (cardsInSuit.isEmpty) continue;
      cardsInSuit.sort((a, b) {
        final rA = rankOrder[a['rank']] ?? 0;
        final rB = rankOrder[b['rank']] ?? 0;
        return rA.compareTo(rB);
      });
      newGroups.add(cardsInSuit.map((c) => c['id']!).toList());
    }

    setState(() {
      _customGroups = newGroups;
      _selectedCardIds.clear();
    });
  }

  void _groupSelectedCards() {
    if (_selectedCardIds.length < 2) return;
    SoundService.instance.play(Sfx.buttonTap);

    final selected = _selectedCardIds.toList();

    _customGroups = _customGroups
        .map((g) => g.where((id) => !selected.contains(id)).toList())
        .where((g) => g.isNotEmpty)
        .toList();

    _customGroups.insert(0, selected);

    setState(() {
      _selectedCardIds.clear();
    });
  }

  void _moveCardToGroup(String cardId, int targetGroupIdx) {
    if (targetGroupIdx < 0 || targetGroupIdx >= _customGroups.length) return;
    SoundService.instance.play(Sfx.buttonTap, volume: 0.3);

    for (final g in _customGroups) {
      g.remove(cardId);
    }
    _customGroups[targetGroupIdx].add(cardId);

    _customGroups.removeWhere((g) => g.isEmpty);
    setState(() {
      _selectedCardIds.remove(cardId);
    });
  }

  void _createNewGroupWithSelected() {
    if (_selectedCardIds.isEmpty) return;
    SoundService.instance.play(Sfx.buttonTap);
    final selected = _selectedCardIds.toList();

    _customGroups = _customGroups
        .map((g) => g.where((id) => !selected.contains(id)).toList())
        .where((g) => g.isNotEmpty)
        .toList();

    _customGroups.add(selected);
    setState(() {
      _selectedCardIds.clear();
    });
  }

  void _handleQuickDiscard(String cardId) {
    if (!_isMyTurn || _actionPending || _awaiting != 'discard') return;
    widget.offline
        ? _offlineDiscard(cardId)
        : _onlineAction('discard', cardId: cardId);
  }

  void _showInvalidDeclareDialog(String reason) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E2433),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFEF4444), width: 1.5),
        ),
        title: Row(
          children: const [
            Icon(Icons.warning_amber_rounded, color: Color(0xFFEF4444)),
            SizedBox(width: 8),
            Text('Invalid Declare',
                style: TextStyle(
                    color: Color(0xFFEF4444), fontWeight: FontWeight.bold)),
          ],
        ),
        content: Text(
          '$reason\n\nA valid declaration requires:\n• At least 1 Pure Sequence (no joker)\n• At least 1 Second Sequence (with/without joker)\n• Remaining cards in valid sequences or sets.',
          style: const TextStyle(color: Colors.white70, fontSize: 13),
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx),
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEF4444)),
            child: const Text('OK', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  void _showEmojiThrowModal(Map<String, dynamic> player) {
    HapticFeedback.lightImpact();
    final name = player['username'] ?? 'Player';
    final emojis = [
      ('🍺', 'Cheers'),
      ('🍅', 'Tomato'),
      ('💐', 'Flowers'),
      ('🚀', 'Rocket'),
      ('💣', 'Bomb'),
      ('💎', 'Diamond'),
    ];

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        padding: const EdgeInsets.all(16),
        decoration: const BoxDecoration(
          color: Color(0xFF1E2433),
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          border: Border(top: BorderSide(color: Color(0xFFFFD700), width: 1.5)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Interact with $name',
              style: const TextStyle(
                color: Color(0xFFFFD700),
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: emojis.map((e) {
                return GestureDetector(
                  onTap: () {
                    Navigator.pop(ctx);
                    HapticFeedback.mediumImpact();
                    SoundService.instance.play(Sfx.chipBet);
                    setState(() {
                      _banner = 'You sent ${e.$1} to $name';
                    });
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.black38,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: Column(
                      children: [
                        Text(e.$1, style: const TextStyle(fontSize: 24)),
                        const SizedBox(height: 4),
                        Text(
                          e.$2,
                          style: const TextStyle(color: Colors.white60, fontSize: 9),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  // ── Getters ──────────────────────────────────────────────────────────
  int get _currentTurnIndex {
    if (widget.offline) return _offlineState?.currentTurn ?? 0;
    final curTurn = _onlineState?['current_turn'] ?? _onlineState?['currentTurn'];
    return int.tryParse(curTurn?.toString() ?? '') ?? (curTurn is int ? curTurn : 0);
  }

  bool get _isMyTurn {
    return _currentTurnIndex == _mySeatIndex;
  }

  String get _awaiting {
    if (widget.offline) return _offlineState?.awaiting ?? 'draw';
    return _onlineState?['awaiting']?.toString() ?? 'draw';
  }

  String? get _myUserId {
    if (_localUserId != null && _localUserId!.isNotEmpty) return _localUserId;
    if (widget.offline) {
      final s = _offlineState;
      return (s != null && _mySeatIndex < s.players.length)
          ? s.players[_mySeatIndex].userId
          : null;
    }
    final players = (_onlineState?['players'] as List?) ?? [];
    if (_mySeatIndex >= players.length) return null;
    final p = players[_mySeatIndex];
    if (p is Map) {
      return (p['user_id'] ?? p['userId'])?.toString();
    }
    return null;
  }

  String get _wildRank {
    String rank = '8';
    if (widget.offline) {
      rank = _offlineState?.wildRank ?? '8';
    } else {
      rank = _onlineState?['wild_rank']?.toString() ??
          _onlineState?['wildRank']?.toString() ??
          '8';
    }
    if (rank == '__NONE__' || rank.toLowerCase() == 'none') {
      return 'A';
    }
    return rank;
  }

  Map<String, String>? get _wildIndicatorCard {
    if (widget.offline) {
      return {'id': 'wild_indicator', 'rank': _wildRank, 'suit': 'S'};
    }
    final rawInd = _onlineState?['wild_indicator'] ?? _onlineState?['wildIndicator'];
    if (rawInd is Map) {
      final rank = rawInd['rank']?.toString() ?? _wildRank;
      return {
        'id': rawInd['id']?.toString() ?? 'wild_indicator',
        'rank': (rank == '__NONE__' || rank.toLowerCase() == 'none') ? 'JOKER' : rank,
        'suit': rawInd['suit']?.toString() ?? 'JK',
      };
    }
    return {'id': 'wild_indicator', 'rank': _wildRank, 'suit': 'S'};
  }

  Map<String, String>? get _openTopCard {
    if (widget.offline) {
      final pile = _offlineState?.openPile;
      if (pile == null || pile.isEmpty) return null;
      final c = pile.last;
      return {'id': c.id, 'rank': c.rank, 'suit': c.suit};
    }
    final pile = (_onlineState?['open_pile'] as List?) ??
        (_onlineState?['openPile'] as List?) ??
        [];
    if (pile.isEmpty) return null;
    final last = pile.last;
    if (last is Map) {
      return {
        'id': last['id']?.toString() ?? '',
        'rank': last['rank']?.toString() ?? '',
        'suit': last['suit']?.toString() ?? ''
      };
    }
    return null;
  }

  List<Map<String, dynamic>> get _allPlayers {
    if (widget.offline) {
      return (_offlineState?.players ?? []).asMap().entries.map((e) => {
            'seat': e.key + 1,
            'username': e.value.username,
            'is_bot': e.value.isBot,
            'card_count': e.value.hand.length,
            'has_dropped': e.value.hasDropped,
            'is_eliminated': e.value.isEliminated,
          }).toList();
    }
    final players = (_onlineState?['players'] as List?) ?? [];
    return players.asMap().entries.map((e) {
      final p = (e.value is Map) ? Map<String, dynamic>.from(e.value) : <String, dynamic>{};
      p['seat'] = int.tryParse(p['seat']?.toString() ?? '') ?? (e.key + 1);
      final cardCount = int.tryParse(p['card_count']?.toString() ?? p['hand_count']?.toString() ?? '');
      p['card_count'] = cardCount ?? ((p['hand'] is List) ? (p['hand'] as List).length : 13);
      return p;
    }).toList();
  }

  List<Map<String, String>> get _myHand {
    if (widget.offline) {
      return (_offlineState?.players[_mySeatIndex].hand ?? [])
          .map((c) => {'id': c.id, 'rank': c.rank, 'suit': c.suit})
          .toList();
    }
    final players = (_onlineState?['players'] as List?) ?? [];
    if (_mySeatIndex >= players.length) return [];
    final p = players[_mySeatIndex];
    if (p is! Map) return [];
    final hand = (p['hand'] as List?) ?? [];
    return hand
        .whereType<Map>()
        .map((c) => {
              'id': c['id']?.toString() ?? '',
              'rank': c['rank']?.toString() ?? '',
              'suit': c['suit']?.toString() ?? ''
            })
        .where((c) => c['id']!.isNotEmpty && c['rank']!.isNotEmpty)
        .toList();
  }

  double get _currentPot {
    if (widget.offline) return 80.0;
    final stake =
        double.tryParse(_onlineState?['stake']?.toString() ?? '20') ?? 20.0;
    return stake * (_allPlayers.isNotEmpty ? _allPlayers.length : 2);
  }

  int get _liveHandScore {
    final hand = _myHand
        .map((c) => RummyCard(c['id']!, c['rank']!, c['suit']!))
        .toList();
    return _engine.calculateHandScore(hand, _customGroups, _wildRank);
  }

  HandValidationSummary get _handValidationSummary {
    final hand = _myHand
        .map((c) => RummyCard(c['id']!, c['rank']!, c['suit']!))
        .toList();
    return _engine.getHandValidationSummary(hand, _customGroups, _wildRank);
  }

  // ── Meld Validation Status Calculation ───────────────────────────────
  ({String label, Color color, IconData icon}) _evaluateGroupStatus(
      List<String> cardIds, int groupIndex) {
    final summary = _handValidationSummary;
    if (groupIndex >= 0 && groupIndex < summary.groupStatuses.length) {
      final info = summary.groupStatuses[groupIndex];
      switch (info.kind) {
        case 'pure_sequence':
          return (
            label: 'Pure Sec',
            color: const Color(0xFF10B981), // Emerald Green
            icon: Icons.check_circle_rounded,
          );
        case 'impure_sequence':
          return (
            label: 'Impure Sec',
            color: const Color(0xFFF59E0B), // Amber
            icon: Icons.check_circle_outline_rounded,
          );
        case 'set':
          return (
            label: info.isValidMeld ? 'Set (0 pts)' : 'Set (Need Pure)',
            color: info.isValidMeld
                ? const Color(0xFF3B82F6) // Royal Blue
                : const Color(0xFF94A3B8),
            icon: Icons.layers_rounded,
          );
        default:
          return (
            label: info.penaltyPoints > 0
                ? 'Invalid (${info.penaltyPoints} pts)'
                : info.label,
            color: const Color(0xFFEF4444), // Crimson Red
            icon: Icons.cancel_outlined,
          );
      }
    }

    return (
      label: 'Invalid',
      color: const Color(0xFFEF4444),
      icon: Icons.cancel_outlined,
    );
  }

  // ── Game Over Celebration & Full Scorecard Modal ──────────────────────
  void _showGameOverModal(dynamic result) {
    if (_isGameOverModalShown) return;
    _isGameOverModalShown = true;

    final isMeWinner = result is Map && result['winner_id']?.toString() == _myUserId?.toString();
    final winnerName =
        (result is Map ? result['winner_name'] : null) ?? (isMeWinner ? 'You' : 'Opponent');
    final allPlayers = _allPlayers;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        child: Container(
          width: 440,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const RadialGradient(
              colors: [
                Color(0xFF261842),
                Color(0xFF130A24),
                Color(0xFF090412)
              ],
              radius: 1.2,
            ),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFFFD700), width: 2.0),
            boxShadow: [
              BoxShadow(
                color: isMeWinner
                    ? const Color(0xFFFFD700).withValues(alpha: 0.35)
                    : Colors.black.withValues(alpha: 0.8),
                blurRadius: 28,
                spreadRadius: 4,
              )
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header title
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    isMeWinner ? '🏆 VICTORY! 🏆' : 'GAME OVER',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2,
                      color: isMeWinner
                          ? const Color(0xFFFFD700)
                          : const Color(0xFFEF4444),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // Prize & Winner Summary Bar
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black45,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white12),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Column(
                      children: [
                        const Text('Total Prize',
                            style: TextStyle(color: Colors.white60, fontSize: 10)),
                        const SizedBox(height: 2),
                        Text(
                          '₹ ${(result is Map ? (result['prize'] ?? _currentPot) : _currentPot).toString()}',
                          style: const TextStyle(
                            color: Color(0xFF10B981),
                            fontWeight: FontWeight.w900,
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                    Container(height: 24, width: 1, color: Colors.white24),
                    Column(
                      children: [
                        const Text('Round Winner',
                            style: TextStyle(color: Colors.white60, fontSize: 10)),
                        const SizedBox(height: 2),
                        Text(
                          isMeWinner ? 'YOU' : winnerName.toString(),
                          style: const TextStyle(
                            color: Color(0xFFFFD700),
                            fontWeight: FontWeight.w900,
                            fontSize: 15,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 12),

              // Player Scorecard List
              Container(
                constraints: const BoxConstraints(maxHeight: 120),
                decoration: BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.white10),
                ),
                child: ListView.separated(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  itemCount: allPlayers.length,
                  separatorBuilder: (_, __) => const Divider(
                    height: 1,
                    color: Colors.white10,
                  ),
                  itemBuilder: (context, idx) {
                    final p = allPlayers[idx];
                    final pName = p['username'] ?? 'Player';
                    final isPWinner = (result is Map && result['winner_id']?.toString() == p['user_id']?.toString()) ||
                        (isMeWinner && (p['user_id'] == _myUserId || pName == 'You'));
                    final hasDropped = p['has_dropped'] == true;
                    final points = isPWinner
                        ? 0
                        : (hasDropped
                            ? 20
                            : (_liveHandScore > 0 ? _liveHandScore : 80));

                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      child: Row(
                        children: [
                          Icon(
                            isPWinner
                                ? Icons.emoji_events_rounded
                                : (hasDropped
                                    ? Icons.flag_rounded
                                    : Icons.person_rounded),
                            size: 14,
                            color: isPWinner
                                ? const Color(0xFFFFD700)
                                : (hasDropped
                                    ? const Color(0xFFEF4444)
                                    : Colors.white54),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              pName,
                              style: TextStyle(
                                color: isPWinner
                                    ? const Color(0xFFFFD700)
                                    : Colors.white,
                                fontWeight: isPWinner
                                    ? FontWeight.w900
                                    : FontWeight.w500,
                                fontSize: 11,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 1.5),
                            decoration: BoxDecoration(
                              color: isPWinner
                                  ? const Color(0xFF10B981).withValues(alpha: 0.2)
                                  : (hasDropped
                                      ? const Color(0xFFEF4444).withValues(alpha: 0.2)
                                      : Colors.white10),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(
                                color: isPWinner
                                    ? const Color(0xFF10B981)
                                    : (hasDropped
                                        ? const Color(0xFFEF4444)
                                        : Colors.white24),
                                width: 0.6,
                              ),
                            ),
                            child: Text(
                              isPWinner
                                  ? 'WINNER (0 pts)'
                                  : (hasDropped
                                      ? 'DROPPED ($points pts)'
                                      : '$points pts'),
                              style: TextStyle(
                                color: isPWinner
                                    ? const Color(0xFF10B981)
                                    : (hasDropped
                                        ? const Color(0xFFEF4444)
                                        : Colors.white70),
                                fontSize: 9.5,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),

              const SizedBox(height: 14),

              // Action Buttons: History & Rematch / Lobby
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  OutlinedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => const RummyHistoryPage()),
                      );
                    },
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFFFD700)),
                      foregroundColor: const Color(0xFFFFD700),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('HISTORY',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 11)),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _performExit();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFD4AF37),
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 8),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                      elevation: 6,
                    ),
                    child: const Text(
                      'BACK TO LOBBY',
                      style:
                          TextStyle(fontWeight: FontWeight.w900, fontSize: 11),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI WIDGETS & TEEN PATTI LANDSCAPE CASINO BOARD
  // ═══════════════════════════════════════════════════════════════════════════

  // ① Luxury Casino Ambient Background
  Widget _buildAmbientBackground(double w, double h) {
    return Positioned.fill(
      child: Stack(
        children: [
          Container(
            decoration: const BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0.0, -0.2),
                radius: 1.4,
                colors: [
                  Color(0xFF16223F), // Luminous space navy
                  Color(0xFF0C1324), // Rich casino blue
                  Color(0xFF05080F), // Deep black-blue
                ],
                stops: [0.0, 0.55, 1.0],
              ),
            ),
          ),
          // Ambient golden light spotlight from top center
          Positioned(
            top: -h * 0.25,
            left: w * 0.15,
            right: w * 0.15,
            height: h * 0.55,
            child: Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    const Color(0xFFD4AF37).withValues(alpha: 0.12),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ② Teen Patti Landscape Oval Poker Felt Table
  Widget _buildOvalTable(double tl, double tt, double tw, double th) {
    final r = math.min(th * 0.44, tw * 0.22);
    final radius = BorderRadius.circular(r);

    return Positioned(
      left: tl,
      top: tt,
      width: tw,
      height: th,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: radius,
          gradient: const LinearGradient(
            colors: [
              Color(0xFF4A2525), // Polished mahogany wood rail
              Color(0xFF261010),
              Color(0xFF120505),
              Color(0xFF261010),
              Color(0xFF4A2525),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: const Color(0xFFD4AF37), width: 3.0),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.85),
              blurRadius: 36,
              spreadRadius: 8,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Container(
          margin: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            borderRadius: radius - BorderRadius.circular(7),
            image: const DecorationImage(
              image: AssetImage('assets/images/table_felt_green.png'),
              fit: BoxFit.cover,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.65),
                blurRadius: 14,
                spreadRadius: 3,
                offset: const Offset(0, 2),
              )
            ],
          ),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: radius - BorderRadius.circular(7),
              border: Border.all(
                color: const Color(0xFFFFD700).withValues(alpha: 0.4),
                width: 1.5,
              ),
            ),
            child: Stack(
              children: [
                // Table watermark
                Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'MYONLINEJOKER',
                        style: TextStyle(
                          color:
                              const Color(0xFFD4AF37).withValues(alpha: 0.12),
                          fontSize: tw * 0.038,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 6,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'INDIAN RUMMY • 13 CARDS',
                        style: TextStyle(
                          color:
                              const Color(0xFFD4AF37).withValues(alpha: 0.18),
                          fontSize: tw * 0.022,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 4,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ③ Opponent Seat Pods positioned around the Landscape Oval Table
  Widget _buildOpponents(double tl, double tt, double tw, double th) {
    final all = _allPlayers;
    final opponents = all.where((p) {
      final seat = int.tryParse(p['seat']?.toString() ?? '') ?? 1;
      return (seat - 1) != _mySeatIndex;
    }).toList();

    return Stack(
      children: [
        for (var i = 0; i < opponents.length && i < _seatPositions.length; i++)
          _buildSeatPod(
            opponents[i],
            (int.tryParse(opponents[i]['seat']?.toString() ?? '') ?? (i + 1)) - 1,
            tl + tw * _seatPositions[i].$1,
            tt + th * _seatPositions[i].$2,
          ),
      ],
    );
  }

  Widget _buildSeatPod(
      Map<String, dynamic> player, int seatIdx, double cx, double cy) {
    final isTurn = _currentTurnIndex == seatIdx;
    final hasDropped = player['has_dropped'] == true;
    final isEliminated = player['is_eliminated'] == true;

    return Positioned(
      left: cx - 38,
      top: cy - 28,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              // Active turn animated glowing sweep timer
              if (isTurn)
                SizedBox(
                  width: 48,
                  height: 48,
                  child: CircularProgressIndicator(
                    value: _turnSecondsLeft / _turnTimerSeconds,
                    strokeWidth: 3.0,
                    backgroundColor: Colors.white12,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      _turnSecondsLeft > 8
                          ? const Color(0xFF10B981)
                          : const Color(0xFFEF4444),
                    ),
                  ),
                ),
              // Dynamic pulsing glowing ring for active player turn
              if (isTurn)
                AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, child) {
                    final value = _pulseController.value;
                    return Container(
                      width: 42 + (value * 8),
                      height: 42 + (value * 8),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: const Color(0xFFFFD700).withValues(alpha: 0.8 - (value * 0.4)),
                          width: 2.0,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFFFFD700).withValues(alpha: 0.6 - (value * 0.4)),
                            blurRadius: 8 + (value * 12),
                            spreadRadius: 1 + (value * 5),
                          )
                        ],
                      ),
                    );
                  },
                ),
              // Golden Avatar Rim
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: isTurn
                        ? const Color(0xFFFFD700)
                        : const Color(0xFF94A3B8).withValues(alpha: 0.5),
                    width: isTurn ? 2.0 : 1.2,
                  ),
                  boxShadow: isTurn
                      ? [
                          const BoxShadow(
                            color: Color(0x66FFD700),
                            blurRadius: 10,
                            spreadRadius: 2,
                          )
                        ]
                      : null,
                ),
                child: GestureDetector(
                  onTap: () => _showEmojiThrowModal(player),
                  child: CircleAvatar(
                    radius: 18,
                    backgroundColor: const Color(0xFF1E293B),
                    child: Text(
                      (player['username']?[0]?.toUpperCase() ?? 'P'),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          // Name and Card count chip
          GestureDetector(
            onTap: () => _showEmojiThrowModal(player),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.8),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: isTurn
                      ? const Color(0xFFFFD700)
                      : Colors.white.withValues(alpha: 0.15),
                  width: 0.8,
                ),
              ),
              child: Column(
                children: [
                  Text(
                    player['username'] ?? 'Player',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                if (hasDropped)
                  const Text('DROPPED',
                      style: TextStyle(
                          color: Color(0xFFEF4444),
                          fontSize: 7.5,
                          fontWeight: FontWeight.w900))
                else if (isEliminated)
                  const Text('OUT',
                      style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 7.5,
                          fontWeight: FontWeight.w900))
                else
                  Text(
                    '${player['card_count'] ?? 13} Cards',
                    style: const TextStyle(
                        color: Color(0xFFFFD700),
                        fontSize: 7.5,
                        fontWeight: FontWeight.bold),
                  ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

  // ④ Table Center Area: Closed Deck Shoe, Open Discard Pile, Declare Slot, Wild Joker, Pot
  Widget _buildTableCenter(double tl, double tt, double tw, double th) {
    final canAct = _isMyTurn && !_actionPending;
    final awaitingDraw = _awaiting == 'draw';
    final openCard = _openTopCard;

    return Positioned(
      left: tl,
      top: tt + th * 0.36,
      width: tw,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Center Pot Badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFD700), Color(0xFFB45309)],
              ),
              borderRadius: BorderRadius.circular(14),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFFFD700).withValues(alpha: 0.4),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('💰 ₹ ',
                    style: TextStyle(
                        color: Colors.black87,
                        fontWeight: FontWeight.bold,
                        fontSize: 10)),
                Text(
                  _currentPot.toStringAsFixed(0),
                  style: const TextStyle(
                    color: Colors.black,
                    fontWeight: FontWeight.w900,
                    fontSize: 12,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),

          // Piles Row: Closed Deck (with Wild Joker), Open Discard Pile, and Finish/Declare Slot
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // 🂠 CLOSED DECK
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {
                  HapticFeedback.lightImpact();
                  if (canAct && awaitingDraw) {
                    widget.offline
                        ? _offlineDrawClosed()
                        : _onlineAction('draw_closed');
                  } else if (!_isMyTurn) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Please wait for your turn!'),
                        duration: Duration(milliseconds: 1200),
                      ),
                    );
                  } else if (!awaitingDraw) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Card already drawn! Select a card to Discard or Declare.'),
                        duration: Duration(milliseconds: 1200),
                      ),
                    );
                  }
                },
                child: Stack(
                  clipBehavior: Clip.none,
                  alignment: Alignment.center,
                  children: [
                    // Tilted Wild Cut Joker nested underneath closed deck
                    Positioned(
                      left: -22,
                      top: 4,
                      child: Transform.rotate(
                        angle: -0.32,
                        child: Stack(
                          children: [
                            _buildCardWidget(
                              _wildIndicatorCard ??
                                  {
                                    'id': 'wild_indicator',
                                    'rank': _wildRank,
                                    'suit': 'S'
                                  },
                              isIndicator: true,
                              cardW: 42,
                              cardH: 60,
                            ),
                            Positioned(
                              top: 2,
                              right: 2,
                              child: Container(
                                padding: const EdgeInsets.all(1.5),
                                decoration: const BoxDecoration(
                                  color: Color(0xFFFFD700),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.star_rounded,
                                  size: 8,
                                  color: Colors.black,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    // Closed Draw Stack Container
                    Container(
                      width: 46,
                      height: 64,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Color(0xFF2563EB),
                            Color(0xFF1E40AF),
                            Color(0xFF1E1B4B)
                          ],
                        ),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: canAct && awaitingDraw
                              ? const Color(0xFF10B981)
                              : const Color(0xFFFFD700).withValues(alpha: 0.7),
                          width: canAct && awaitingDraw ? 2.2 : 1.2,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: canAct && awaitingDraw
                                ? const Color(0x8810B981)
                                : Colors.black54,
                            blurRadius: canAct && awaitingDraw ? 12 : 6,
                            spreadRadius: canAct && awaitingDraw ? 2 : 0,
                          ),
                        ],
                      ),
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.style_rounded,
                              color: canAct && awaitingDraw
                                  ? const Color(0xFF10B981)
                                  : Colors.white70,
                              size: 20,
                            ),
                            const SizedBox(height: 1),
                            Text(
                              canAct && awaitingDraw ? 'DRAW' : 'CLOSED',
                              style: TextStyle(
                                color: canAct && awaitingDraw
                                    ? const Color(0xFF10B981)
                                    : Colors.white,
                                fontSize: 8,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(width: 24),

              // 🂡 OPEN DISCARD PILE (With DragTarget Support for drag-to-discard)
              DragTarget<String>(
                onWillAcceptWithDetails: (details) =>
                    canAct && !awaitingDraw,
                onAcceptWithDetails: (details) {
                  HapticFeedback.mediumImpact();
                  _handleQuickDiscard(details.data);
                },
                builder: (context, candidateData, rejectedData) {
                  final isHovered = candidateData.isNotEmpty;
                  final canDrawOpen = canAct && awaitingDraw && openCard != null;
                  return GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      HapticFeedback.lightImpact();
                      if (canDrawOpen) {
                        SoundService.instance.play(Sfx.cardDeal);
                        widget.offline
                            ? _offlineDrawOpen()
                            : _onlineAction('draw_open');
                      } else if (!_isMyTurn) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Please wait for your turn!'),
                            duration: Duration(milliseconds: 1200),
                          ),
                        );
                      } else if (!awaitingDraw) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Card already drawn! Select a card to Discard or Declare.'),
                            duration: Duration(milliseconds: 1200),
                          ),
                        );
                      }
                    },
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: isHovered
                              ? const Color(0xFFEF4444)
                              : (canDrawOpen
                                  ? const Color(0xFF10B981)
                                  : const Color(0xFFFFD700).withValues(alpha: 0.7)),
                          width: (isHovered || canDrawOpen) ? 2.2 : 1.2,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: isHovered
                                ? const Color(0x88EF4444)
                                : (canDrawOpen
                                    ? const Color(0x8810B981)
                                    : Colors.black54),
                            blurRadius: canDrawOpen ? 12 : 6,
                            spreadRadius: canDrawOpen ? 2 : 0,
                          ),
                        ],
                      ),
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          openCard != null
                              ? _buildCardWidget(openCard,
                                  isIndicator: true, cardW: 46, cardH: 64)
                              : Container(
                                  width: 46,
                                  height: 64,
                                  decoration: BoxDecoration(
                                    color: Colors.black38,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                        color: Colors.white24,
                                        style: BorderStyle.solid),
                                  ),
                                  alignment: Alignment.center,
                                  child: const Text(
                                    'OPEN\nPILE',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: Colors.white38,
                                      fontSize: 8,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                          if (canDrawOpen)
                            Positioned(
                              bottom: 2,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 4, vertical: 1),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF10B981),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text(
                                  'DRAW',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 7.5,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                              ),
                            ),
                          if (isHovered)
                            Positioned(
                              top: 2,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 4, vertical: 1),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFEF4444),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text(
                                  'DISCARD',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 7.5,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),

              const SizedBox(width: 24),

              // 🏆 FINISH / DECLARE SLOT (DragTarget for instant declare)
              DragTarget<String>(
                onWillAcceptWithDetails: (details) =>
                    canAct && !awaitingDraw,
                onAcceptWithDetails: (details) {
                  _triggerDeclare(finishCardId: details.data);
                },
                builder: (context, candidateData, rejectedData) {
                  final isHovered = candidateData.isNotEmpty;
                  final canDeclare = canAct && !awaitingDraw;
                  return GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      if (canDeclare) {
                        _triggerDeclare();
                      } else if (!_isMyTurn) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Please wait for your turn!'),
                            duration: Duration(milliseconds: 1200),
                          ),
                        );
                      } else if (awaitingDraw) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Draw a card from the deck first before declaring.'),
                            duration: Duration(milliseconds: 1200),
                          ),
                        );
                      }
                    },
                    child: Container(
                      width: 46,
                      height: 64,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: isHovered
                              ? [const Color(0xFF059669), const Color(0xFF10B981)]
                              : [
                                  const Color(0xFF064E3B).withValues(alpha: 0.7),
                                  const Color(0xFF022C22).withValues(alpha: 0.9),
                                ],
                        ),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: isHovered
                              ? const Color(0xFF34D399)
                              : (canDeclare
                                  ? const Color(0xFF10B981).withValues(alpha: 0.8)
                                  : Colors.white24),
                          width: isHovered ? 2.2 : 1.2,
                        ),
                        boxShadow: canDeclare
                            ? [
                                BoxShadow(
                                  color: const Color(0x6610B981),
                                  blurRadius: isHovered ? 12 : 6,
                                  spreadRadius: isHovered ? 2 : 0,
                                ),
                              ]
                            : null,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.emoji_events_rounded,
                            color: canDeclare
                                ? const Color(0xFFFFD700)
                                : Colors.white38,
                            size: 20,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'FINISH',
                            style: TextStyle(
                              color: canDeclare
                                  ? const Color(0xFF34D399)
                                  : Colors.white38,
                              fontSize: 8,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.5,
                            ),
                          ),
                          Text(
                            'DECLARE',
                            style: TextStyle(
                              color: canDeclare
                                  ? Colors.white
                                  : Colors.white24,
                              fontSize: 6.5,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Render Individual Card Widget (With Drag & Double-Tap Support) ──
  Widget _buildCardWidget(Map<String, String> card,
      {bool isIndicator = false,
      double cardW = 42,
      double cardH = 60,
      int? groupIndex}) {
    final cardId = card['id'] ?? '';
    final rawRank = card['rank'] ?? '';
    final rank = (rawRank == '__NONE__' || rawRank.toLowerCase() == 'none')
        ? 'A'
        : (rawRank == 'JOKER' ? 'JK' : rawRank);
    final suit = card['suit'] ?? '';
    final selected = _selectedCardIds.contains(cardId);
    final isJoker = suit == 'JK' || rank == _wildRank;
    final isRed = suit == 'H' || suit == 'D';
    final suitSymbol =
        {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣', 'JK': '🃏'}[suit] ?? '';

    final cardVisual = AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOutCubic,
      transform: Matrix4.translationValues(0, selected ? -10 : 0, 0),
      width: cardW,
      height: cardH,
      margin: const EdgeInsets.symmetric(horizontal: 1.5),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: selected
              ? const Color(0xFFFFD700)
              : (isJoker
                  ? const Color(0xFF8B5CF6)
                  : Colors.black.withValues(alpha: 0.15)),
          width: selected ? 2.0 : (isJoker ? 1.5 : 0.8),
        ),
        boxShadow: [
          BoxShadow(
            color: selected
                ? const Color(0x88FFD700)
                : Colors.black.withValues(alpha: 0.35),
            blurRadius: selected ? 10 : 3,
            offset: Offset(0, selected ? 3 : 1.5),
          ),
        ],
      ),
      child: Stack(
        children: [
          // Top-right star emblem/badge for wild/joker cards
          if (isJoker)
            const Positioned(
              top: 2.5,
              right: 3,
              child: Icon(
                Icons.star_rounded,
                color: Color(0xFFFFD700),
                size: 9.5,
              ),
            ),
          // Top-left rank & suit
          Positioned(
            top: 2,
            left: 3,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  rank == 'JOKER' ? 'JK' : rank,
                  style: TextStyle(
                    color: isJoker
                        ? const Color(0xFF7C3AED)
                        : (isRed
                            ? const Color(0xFFE11D48)
                            : const Color(0xFF0F172A)),
                    fontWeight: FontWeight.w900,
                    fontSize: 10,
                  ),
                ),
                Text(
                  suitSymbol,
                  style: TextStyle(
                    color: isRed
                        ? const Color(0xFFE11D48)
                        : const Color(0xFF0F172A),
                    fontSize: 8.5,
                    height: 0.85,
                  ),
                ),
              ],
            ),
          ),
          // Center Suit/Joker symbol
          Center(
            child: Text(
              isJoker ? '🃏' : suitSymbol,
              style: TextStyle(
                color: isJoker
                    ? const Color(0xFF7C3AED)
                    : (isRed
                        ? const Color(0xFFE11D48)
                        : const Color(0xFF0F172A)),
                fontSize: 16,
              ),
            ),
          ),
          // Joker badge
          if (isJoker)
            Positioned(
              bottom: 1.5,
              right: 1.5,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 2.5, vertical: 0.5),
                decoration: BoxDecoration(
                  color: const Color(0xFF7C3AED),
                  borderRadius: BorderRadius.circular(3),
                ),
                child: const Text(
                  'JOKER',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 6,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
        ],
      ),
    );

    if (isIndicator) return cardVisual;

    return Draggable<String>(
      data: cardId,
      feedback: Material(
        color: Colors.transparent,
        child: Opacity(opacity: 0.85, child: cardVisual),
      ),
      childWhenDragging: Opacity(opacity: 0.3, child: cardVisual),
      child: GestureDetector(
        onTap: () {
          SoundService.instance.play(Sfx.buttonTap, volume: 0.4);
          setState(() {
            selected
                ? _selectedCardIds.remove(cardId)
                : _selectedCardIds.add(cardId);
          });
        },
        onDoubleTap: () {
          // Double-tap to quick discard!
          _handleQuickDiscard(cardId);
        },
        child: cardVisual,
      ),
    );
  }

  // ⑤ Bottom Player Hand Tray in Landscape (Organized by Meld Groups + Action Controls)
  Widget _buildLandscapeBottomPanel(
      List<Map<String, String>> hand, bool canAct, bool awaitingDraw) {
    if (_customGroups.isEmpty && hand.isNotEmpty) {
      _syncGroupsWithHand();
    }

    final singleCardSelected = _selectedCardIds.length == 1;
    final score = _liveHandScore;

    return Container(
      height: 98,
      decoration: BoxDecoration(
        color: const Color(0xFF090D16).withValues(alpha: 0.96),
        border: Border(
          top: BorderSide(
            color: const Color(0xFFFFD700).withValues(alpha: 0.35),
            width: 1.5,
          ),
        ),
      ),
      child: Row(
        children: [
          // Left side: Quick Controls (Score, Sort, Auto-Group, Group)
          Container(
            width: 132,
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: const BoxDecoration(
              border: Border(right: BorderSide(color: Colors.white12)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                // Live Score & Wild Joker Pill
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 5, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: score == 0
                            ? const Color(0xFF10B981).withValues(alpha: 0.2)
                            : (score <= 20
                                ? const Color(0xFFF59E0B).withValues(alpha: 0.2)
                                : const Color(0xFFEF4444).withValues(alpha: 0.2)),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(
                          color: score == 0
                              ? const Color(0xFF10B981)
                              : (score <= 20
                                  ? const Color(0xFFF59E0B)
                                  : const Color(0xFFEF4444)),
                          width: 0.8,
                        ),
                      ),
                      child: Text(
                        score == 0 ? 'READY! 0 pts' : 'Score: $score pts',
                        style: TextStyle(
                          color: score == 0
                              ? const Color(0xFF10B981)
                              : (score <= 20
                                  ? const Color(0xFFF59E0B)
                                  : const Color(0xFFEF4444)),
                          fontWeight: FontWeight.w900,
                          fontSize: 9,
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 4, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: const Color(0xFF7C3AED).withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(
                            color: const Color(0xFF7C3AED), width: 0.8),
                      ),
                      child: Text(
                        '🃏 $_wildRank',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 9,
                        ),
                      ),
                    ),
                  ],
                ),
                // Magic Auto-Group & Sort
                Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: () {
                          HapticFeedback.selectionClick();
                          _smartAutoGroup();
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFF8B5CF6), Color(0xFF6D28D9)],
                            ),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          alignment: Alignment.center,
                          child: const Text('AUTO',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w900)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: GestureDetector(
                        onTap: () {
                          HapticFeedback.selectionClick();
                          _smartSortHand();
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFFFD700), Color(0xFFB45309)],
                            ),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          alignment: Alignment.center,
                          child: const Text('SORT',
                              style: TextStyle(
                                  color: Colors.black,
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w900)),
                        ),
                      ),
                    ),
                  ],
                ),
                // Group / Move button
                Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: _selectedCardIds.length >= 2
                            ? () {
                                HapticFeedback.selectionClick();
                                _groupSelectedCards();
                              }
                            : (_selectedCardIds.isNotEmpty
                                ? () {
                                    HapticFeedback.selectionClick();
                                    _createNewGroupWithSelected();
                                  }
                                : null),
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 3.5),
                          decoration: BoxDecoration(
                            gradient: _selectedCardIds.isNotEmpty
                                ? const LinearGradient(
                                    colors: [
                                      Color(0xFF2563EB),
                                      Color(0xFF1D4ED8)
                                    ],
                                  )
                                : null,
                            color: _selectedCardIds.isEmpty
                                ? Colors.white12
                                : null,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            _selectedCardIds.length >= 2
                                ? 'GROUP (${_selectedCardIds.length})'
                                : 'NEW GROUP',
                            style: TextStyle(
                              color: _selectedCardIds.isNotEmpty
                                  ? Colors.white
                                  : Colors.white38,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Center area: DragTarget Meld Groups with status chips
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              itemCount: _customGroups.length,
              separatorBuilder: (_, __) => Container(
                width: 1,
                margin: const EdgeInsets.symmetric(horizontal: 3, vertical: 6),
                color: Colors.white12,
              ),
              itemBuilder: (context, gIdx) {
                final groupIds = _customGroups[gIdx];
                final status = _evaluateGroupStatus(groupIds, gIdx);

                return DragTarget<String>(
                  onWillAcceptWithDetails: (details) =>
                      !groupIds.contains(details.data),
                  onAcceptWithDetails: (details) {
                    _moveCardToGroup(details.data, gIdx);
                  },
                  builder: (context, candidateData, rejectedData) {
                    final isHovered = candidateData.isNotEmpty;
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      decoration: BoxDecoration(
                        color: isHovered
                            ? const Color(0xFF2563EB).withValues(alpha: 0.2)
                            : status.color.withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: isHovered
                              ? const Color(0xFF60A5FA)
                              : status.color.withValues(alpha: 0.45),
                          width: isHovered ? 1.6 : 1.0,
                        ),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Group Status Chip
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              color: status.color.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(
                                  color: status.color.withValues(alpha: 0.6),
                                  width: 0.8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(status.icon, size: 9, color: status.color),
                                const SizedBox(width: 2.5),
                                Text(
                                  status.label,
                                  style: TextStyle(
                                    color: status.color,
                                    fontSize: 8.5,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 2),
                          // Cards in group
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: groupIds.map((id) {
                              final card = hand.firstWhere((c) => c['id'] == id,
                                  orElse: () =>
                                      {'id': id, 'rank': '', 'suit': ''});
                              return _buildCardWidget(card,
                                  cardW: 42, cardH: 60, groupIndex: gIdx);
                            }).toList(),
                          ),
                        ],
                      ),
                    );
                  },
                );
              },
            ),
          ),

          // Right side: Action Buttons (Drop, Discard, Declare)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: const BoxDecoration(
              border: Border(left: BorderSide(color: Colors.white12)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // DROP BUTTON
                ElevatedButton(
                  onPressed: canAct && awaitingDraw
                      ? () {
                          SoundService.instance.play(Sfx.buttonTap);
                          showDialog(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              backgroundColor: const Color(0xFF1E2433),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                                side: const BorderSide(
                                    color: Color(0xFFEF4444), width: 1.5),
                              ),
                              title: const Text('Drop Game?',
                                  style: TextStyle(
                                      color: Color(0xFFEF4444),
                                      fontWeight: FontWeight.bold)),
                              content: const Text(
                                'Are you sure you want to drop? First drop penalty is 20 points.',
                                style: TextStyle(color: Colors.white70),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(ctx),
                                  child: const Text('Cancel',
                                      style: TextStyle(color: Colors.white60)),
                                ),
                                ElevatedButton(
                                  onPressed: () {
                                    Navigator.pop(ctx);
                                    if (widget.offline) {
                                      _performExit();
                                    } else {
                                      _onlineAction('drop');
                                    }
                                  },
                                  style: ElevatedButton.styleFrom(
                                      backgroundColor:
                                          const Color(0xFFEF4444)),
                                  child: const Text('DROP',
                                      style: TextStyle(color: Colors.white)),
                                ),
                              ],
                            ),
                          );
                        }
                      : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFEF4444),
                    disabledBackgroundColor: Colors.white10,
                    foregroundColor: Colors.white,
                    disabledForegroundColor: Colors.white24,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 10),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text(
                    'DROP\n-20',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 9),
                  ),
                ),

                const SizedBox(width: 5),

                // DISCARD BUTTON
                ElevatedButton(
                  onPressed: canAct && !awaitingDraw && singleCardSelected
                      ? () {
                          final id = _selectedCardIds.first;
                          _handleQuickDiscard(id);
                        }
                      : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFF59E0B),
                    disabledBackgroundColor: Colors.white10,
                    foregroundColor: Colors.black,
                    disabledForegroundColor: Colors.white24,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 9, vertical: 10),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text(
                    'DISCARD',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 9.5),
                  ),
                ),

                const SizedBox(width: 5),

                // DECLARE BUTTON
                ElevatedButton(
                  onPressed: canAct && !awaitingDraw
                      ? () => _triggerDeclare()
                      : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF10B981),
                    disabledBackgroundColor: Colors.white10,
                    foregroundColor: Colors.white,
                    disabledForegroundColor: Colors.white24,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 10),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                    elevation: canAct && !awaitingDraw ? 6 : 0,
                    shadowColor:
                        const Color(0xFF10B981).withValues(alpha: 0.5),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Icon(Icons.emoji_events_rounded, size: 13),
                      SizedBox(width: 2),
                      Text(
                        'DECLARE',
                        style: TextStyle(
                            fontWeight: FontWeight.w900, fontSize: 9.5),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MAIN BUILD METHOD (LANDSCAPE WITH POPSCOPE)
  // ═══════════════════════════════════════════════════════════════════════════
  @override
  Widget build(BuildContext context) {
    final hand = _myHand;
    final canAct = _isMyTurn && !_actionPending;
    final awaitingDraw = _awaiting == 'draw';

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _confirmLeaveTable();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF05080F),
        body: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final w = constraints.maxWidth;
              final h = constraints.maxHeight;

              // Table bounds within the landscape screen
              final tableW = w * 0.96;
              final tableH = h * 0.58;
              final tableL = (w - tableW) / 2;
              final tableT = 28.0;

              return Column(
                children: [
                  // Top Header Overlay Bar (Compact Landscape)
                  Container(
                    height: 36,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0A1020).withValues(alpha: 0.95),
                      border: Border(
                        bottom: BorderSide(
                          color: const Color(0xFFFFD700).withValues(alpha: 0.25),
                        ),
                      ),
                    ),
                    child: Row(
                      children: [
                        // Leave Table / Exit Arrow
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(Icons.arrow_back_ios_new_rounded,
                              color: Color(0xFFFFD700), size: 16),
                          tooltip: 'Back / Exit',
                          onPressed: _confirmLeaveTable,
                        ),
                        const SizedBox(width: 8),
                        const Text(
                          '13-Card Rummy',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: Colors.white10,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            'Room: ${widget.roomId.length > 8 ? widget.roomId.substring(0, 8) : widget.roomId}',
                            style: const TextStyle(
                                color: Colors.white70, fontSize: 9.5),
                          ),
                        ),
                        const Spacer(),

                        // Active turn live notification chip
                        if (_banner != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 2),
                            decoration: BoxDecoration(
                              color: canAct
                                  ? const Color(0xFF10B981).withValues(alpha: 0.2)
                                  : Colors.black45,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: canAct
                                    ? const Color(0xFF10B981)
                                    : Colors.white24,
                                width: 0.8,
                              ),
                            ),
                            child: Text(
                              canAct ? '⚡ $_banner' : _banner!,
                              style: TextStyle(
                                color: canAct
                                    ? const Color(0xFF34D399)
                                    : Colors.white70,
                                fontWeight: FontWeight.bold,
                                fontSize: 9.5,
                              ),
                            ),
                          ),

                        const Spacer(),

                        // History Button
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(
                            Icons.history_rounded,
                            color: Color(0xFFFFD700),
                            size: 19,
                          ),
                          tooltip: 'Game History',
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                  builder: (_) => const RummyHistoryPage()),
                            );
                          },
                        ),
                        const SizedBox(width: 10),

                        // Sound Mute Toggle
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: Icon(
                            _muted
                                ? Icons.volume_off_rounded
                                : Icons.volume_up_rounded,
                            color: _muted
                                ? const Color(0xFFEF4444)
                                : const Color(0xFFFFD700),
                            size: 18,
                          ),
                          tooltip: _muted ? 'Unmute' : 'Mute',
                          onPressed: _toggleMute,
                        ),

                        const SizedBox(width: 10),

                        // Exit Table Button (explicit red leave)
                        IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(
                            Icons.exit_to_app_rounded,
                            color: Color(0xFFEF4444),
                            size: 19,
                          ),
                          tooltip: 'Leave Table',
                          onPressed: _confirmLeaveTable,
                        ),
                      ],
                    ),
                  ),

                  // Landscape Casino Board Area
                  Expanded(
                    child: Stack(
                      children: [
                        // ① Ambient Casino Lighting
                        _buildAmbientBackground(w, h),

                        // ② Landscape Oval Poker Felt Table
                        _buildOvalTable(tableL, tableT, tableW, tableH),

                        // ③ Opponent Seat Pods
                        _buildOpponents(tableL, tableT, tableW, tableH),

                        // ④ Table Center Area: Closed Deck, Open Pile, Wild Joker, Pot
                        _buildTableCenter(tableL, tableT, tableW, tableH),
                      ],
                    ),
                  ),

                  // ⑤ Bottom Hand Tray & Controls Bar
                  _buildLandscapeBottomPanel(hand, canAct, awaitingDraw),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
