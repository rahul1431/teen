import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'dart:async';
import 'dart:math' as math;
import '../../../core/audio/sound_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../shared/theme/app_theme.dart';
import 'practice_engine.dart';
import 'coin_rain.dart';

/// Landscape Teen Patti table — flicker-free edition.
///
/// Anti-flicker techniques:
///   1. ValueNotifiers drive the timer, turn state, game state, cards,
///      chat and reactions — only leaf widgets rebuild, not the full Scaffold.
///   2. The heavy felt table uses high-res assets and is isolated under RepaintBoundary.
///   3. The result overlay uses AnimatedSwitcher + fade/scale transition.
///   4. Cards use TweenAnimationBuilder for a smooth deal-in slide.
///   5. Seat timers are isolated inside a dedicated leaf widget _SeatTimer.
///   6. Hostess animations are isolated inside _HostessWidget.
///   7. LayoutBuilder is removed, coordinates are calculated synchronously using MediaQuery.
class TeenPattiGamePage extends StatefulWidget {
  final String roomId;
  final bool demo;
  final Map<String, dynamic>? initialData;
  const TeenPattiGamePage(
      {super.key, required this.roomId, this.demo = false, this.initialData});
  @override
  State<TeenPattiGamePage> createState() => _TeenPattiGamePageState();
}

class _TeenPattiGamePageState extends State<TeenPattiGamePage>
    with TickerProviderStateMixin {
  final _socket = SocketService();
  PracticeEngine? _practice;

  // ── ValueNotifiers (no full rebuild on change) ────────────────────────────
  final _gsNotifier        = ValueNotifier<Map<String, dynamic>?>(null);
  final _myTurnNotifier    = ValueNotifier<bool>(false);
  final _timerNotifier     = ValueNotifier<int>(30);
  final _resultNotifier    = ValueNotifier<String?>(null);
  final _myCardsNotifier   = ValueNotifier<List<Map<String, dynamic>>>([]);
  final _chatNotifier      = ValueNotifier<List<_ChatMsg>>([]);
  final _reactionsNotifier = ValueNotifier<List<_Reaction>>([]);

  String? _myUserId;
  bool    _isSeen      = false;
  int     _turnSeq     = 0;
  double  _betAmount   = 0;
  Timer?  _turnTimer;
  StreamSubscription? _reconnectSub;
  bool _showChat     = false;
  bool _showGiftTray = false;
  final _chatInput   = TextEditingController();
  int  _reactionId   = 0;

  static const _quickEmojis = ['😀','😂','😎','😮','😭','🔥','👏','🤔'];
  static const _gifts = [
    {'icon': '🌹', 'name': 'Rose'},   {'icon': '🎁', 'name': 'Gift'},
    {'icon': '💎', 'name': 'Diamond'},{'icon': '🍺', 'name': 'Beer'},
    {'icon': '👑', 'name': 'Crown'},  {'icon': '💣', 'name': 'Bomb'},
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    widget.demo ? _initDemo() : _init();
    SoundService.instance.loopAmbience('casino_bgm.mp3');
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    precacheImage(const AssetImage('assets/images/table_felt.png'), context);
    precacheImage(const AssetImage('assets/images/card_back.png'), context);
    precacheImage(const AssetImage('assets/images/dealer_avatar.png'), context);
  }

  @override
  void dispose() {
    SoundService.instance.stopAmbience();
    _reconnectSub?.cancel();
    _turnTimer?.cancel();
    _practice?.dispose();
    _chatInput.dispose();
    for (final n in [_gsNotifier, _myTurnNotifier, _timerNotifier,
        _resultNotifier, _myCardsNotifier, _chatNotifier, _reactionsNotifier]) {
      n.dispose();
    }
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  // ── Demo init ─────────────────────────────────────────────────────────────
  void _initDemo() {
    _myUserId = 'me';
    _isSeen   = true;
    _practice = PracticeEngine(
      onChanged: () {
        if (!mounted) return;
        _gsNotifier.value     = _practice!.state;
        _myTurnNotifier.value = _practice!.isMyTurn;
        if (!_practice!.handOver) _resultNotifier.value = null;
        _practice!.isMyTurn ? _startTurnTimer() : _turnTimer?.cancel();
      },
      onResult: (msg, won) {
        if (!mounted) return;
        _turnTimer?.cancel();
        _resultNotifier.value  = msg;
        _myTurnNotifier.value  = false;
        if (won) {
          HapticFeedback.heavyImpact();
          Timer(140.ms, HapticFeedback.heavyImpact);
          Timer(280.ms, HapticFeedback.heavyImpact);
          SystemSound.play(SystemSoundType.alert);
        } else {
          HapticFeedback.mediumImpact();
        }
      },
      onChat: (uid, name, text) {
        if (!mounted) return;
        _pushChat(_ChatMsg(userId: uid, username: name, text: text, type: 'text'));
      },
    );
    _chatNotifier.value = [
      _ChatMsg(userId:'b1', username:'Steven P.', text:'Good luck! 🍀', type:'text'),
    ];
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _practice!.startHand();
    });
  }

  // ── Live init ─────────────────────────────────────────────────────────────
  List<Map<String, dynamic>> _mapPlayers(List raw) => raw.map((p) {
        if (p is! Map) return <String, dynamic>{};
        final m = Map<String, dynamic>.from(p);
        m['user_id'] ??= m['userId'];
        m['userId']  ??= m['user_id'];
        return m;
      }).toList();

  void _applyRoomJoinedData(Map<String, dynamic> data) {
    if (!mounted) return;
    _myCardsNotifier.value =
        (data['my_cards'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final rawState = data['state'] as Map<String, dynamic>? ?? data;
    final players  = _mapPlayers(
        rawState['players'] as List? ?? data['players'] as List? ?? []);
    final gs = {
      ...rawState,
      'pot':           data['pot']          ?? rawState['pot']          ?? 0,
      'min_bet':       data['min_bet']      ?? rawState['min_bet']      ?? 0,
      'current_turn':  data['current_turn'] ?? rawState['current_turn'] ?? 0,
      'players':       players,
    };
    _gsNotifier.value  = gs;
    _betAmount = (data['min_bet'] as num?)?.toDouble() ?? 0;
    final idx  = (gs['current_turn'] ?? 0) as int;
    final cur  = idx < players.length ? players[idx] : null;
    final isMe = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
    _myTurnNotifier.value = isMe;
    if (isMe) _startTurnTimer();
    SoundService.instance.play(Sfx.cardDeal);
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();
    _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});
    _reconnectSub = _socket.on('reconnect').listen((_) =>
        _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId}));

    if (widget.initialData != null)
      _applyRoomJoinedData(Map<String, dynamic>.from(widget.initialData!));

    _socket.on(SocketEvents.roomJoined).listen((data) =>
        _applyRoomJoinedData(Map<String, dynamic>.from(data)));

    _socket.on(SocketEvents.gameStateUpdate).listen((data) {
      if (!mounted) return;
      final inner   = data['state'] as Map<String, dynamic>? ?? data;
      final players = _mapPlayers(inner['players'] as List? ?? []);
      _gsNotifier.value = {...inner, 'players': players};
      final idx = (inner['current_turn'] ?? inner['CurrentTurn'] ?? 0) as int;
      final cur = idx < players.length ? players[idx] : null;
      final isMe = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
      _myTurnNotifier.value = isMe;
      if (isMe) _startTurnTimer();
      final la = data['last_action'] as Map?;
      if (la != null) {
        final actorId = la['user_id']?.toString() ?? '';
        final actor   = players.firstWhere(
            (p) => (p['userId'] ?? p['user_id']) == actorId,
            orElse: () => <String, dynamic>{});
        _pushChat(_ChatMsg(
            userId: actorId, username: actor['username'] ?? 'Player',
            text: la['action']?.toString().toUpperCase() ?? '', type: 'text'));
      }
    });

    _socket.on(SocketEvents.gameResult).listen((data) {
      if (!mounted) return;
      _turnTimer?.cancel();
      final won = data['winner_id'] == _myUserId;
      _resultNotifier.value = won
          ? '🎉 You Won ₹${double.parse(data['prize'].toString()).toStringAsFixed(2)}!'
          : '😔 You Lost. Winner: ${data['winner_username'] ?? 'Unknown'}';
      _myTurnNotifier.value = false;
      if (won) {
        HapticFeedback.heavyImpact();
        Timer(140.ms, HapticFeedback.heavyImpact);
        Timer(280.ms, HapticFeedback.heavyImpact);
        SoundService.instance.play(Sfx.win);
      } else {
        HapticFeedback.mediumImpact();
        SoundService.instance.play(Sfx.lose);
      }
    });

    _socket.on(SocketEvents.roomChatMsg).listen((data) {
      if (!mounted || data is! Map) return;
      final type = (data['type'] ?? 'text').toString();
      final msg  = _ChatMsg(
          userId:   data['user_id']?.toString()   ?? '',
          username: data['username']?.toString()  ?? 'Player',
          text:     data['message']?.toString()   ?? '',
          type:     type);
      if (type == 'text') {
        _pushChat(msg);
      } else if (msg.userId != _myUserId) {
        _spawnReaction(msg.userId, msg.text, isGift: type == 'gift');
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  void _pushChat(_ChatMsg msg) {
    final list = List<_ChatMsg>.from(_chatNotifier.value)..add(msg);
    if (list.length > 50) list.removeAt(0);
    _chatNotifier.value = list;
  }

  void _startTurnTimer() {
    _turnTimer?.cancel();
    _timerNotifier.value = 30;
    HapticFeedback.lightImpact();
    Timer(90.ms, HapticFeedback.lightImpact);
    SystemSound.play(SystemSoundType.click);
    _turnTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      final n = _timerNotifier.value - 1;
      _timerNotifier.value = n;
      if (n > 0 && n <= 5) HapticFeedback.selectionClick();
      if (n <= 0) { t.cancel(); _sendAction('fold'); }
    });
  }

  void _sendAction(String action, {double? amount}) {
    _turnTimer?.cancel();
    _myTurnNotifier.value = false;
    if (action == 'show') _isSeen = true;
    SoundService.instance.play(action == 'fold' ? Sfx.buttonTap : Sfx.chipBet);
    if (widget.demo) { HapticFeedback.mediumImpact(); _practice?.playerAction(action, amount); return; }
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action':  action,
      if (amount != null) 'amount': amount,
      'sequence_num': ++_turnSeq,
    });
    HapticFeedback.mediumImpact();
  }

  void _sendChat(String text) {
    final t = text.trim();
    if (t.isEmpty) return;
    if (widget.demo) {
      _pushChat(_ChatMsg(userId: 'me', username: 'You', text: t, type: 'text'));
    } else {
      _socket.emit(SocketEvents.roomChat,
          {'room_id': widget.roomId, 'message': t, 'type': 'text'});
    }
    _chatInput.clear();
  }

  void _sendEmoji(String emoji) {
    _socket.emit(SocketEvents.roomChat,
        {'room_id': widget.roomId, 'message': emoji, 'type': 'emoji'});
    _spawnReaction(_myUserId ?? '', emoji);
    HapticFeedback.selectionClick();
  }

  void _sendGift(String icon) {
    _socket.emit(SocketEvents.roomChat,
        {'room_id': widget.roomId, 'message': icon, 'type': 'gift'});
    _spawnReaction(_myUserId ?? '', icon, isGift: true);
    setState(() => _showGiftTray = false);
    HapticFeedback.mediumImpact();
  }

  void _spawnReaction(String userId, String emoji, {bool isGift = false}) {
    final r = _Reaction(id: ++_reactionId, userId: userId, emoji: emoji, isGift: isGift);
    final list = List<_Reaction>.from(_reactionsNotifier.value)..add(r);
    _reactionsNotifier.value = list;
    Timer(2600.ms, () {
      if (!mounted) return;
      _reactionsNotifier.value =
          List<_Reaction>.from(_reactionsNotifier.value)..removeWhere((x) => x.id == r.id);
    });
  }

  String? _chipsOf(Map<String, dynamic> p) {
    final v = p['chips'] ?? p['balance'] ?? p['stack'];
    if (v == null) return null;
    return num.tryParse(v.toString())?.toStringAsFixed(0);
  }

  void _exit() {
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    Navigator.pop(context);
  }

  bool _isReconnectingStatus(String s) =>
      s.contains('reconnect') || s.contains('connecting') || s.contains('error');

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUILD
  // ═══════════════════════════════════════════════════════════════════════════
  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) { if (!didPop) _exit(); },
      child: Scaffold(
        backgroundColor: const Color(0xFF060A1A),
        body: SafeArea(
          child: Stack(children: [
            // ① Felt — wrapped in RepaintBoundary: never repaints
            RepaintBoundary(child: _buildFelt()),

            // ② Seats + pot — only on gameState change
            ValueListenableBuilder<Map<String, dynamic>?>(
              valueListenable: _gsNotifier,
              builder: (_, gs, __) => _buildSeatsAndCenter(gs),
            ),

            // ③ Top bar
            _buildTopBar(),

            // ④ My hand — only on card/turn change
            ValueListenableBuilder<List<Map<String, dynamic>>>(
              valueListenable: _myCardsNotifier,
              builder: (_, cards, __) => ValueListenableBuilder<bool>(
                valueListenable: _myTurnNotifier,
                builder: (_, isMyTurn, __) => _buildMyHand(cards, isMyTurn),
              ),
            ),

            // ⑤ My chips
            ValueListenableBuilder<Map<String, dynamic>?>(
              valueListenable: _gsNotifier,
              builder: (_, gs, __) => _buildMyChips(gs),
            ),

            // ⑥ Action bar
            ValueListenableBuilder<bool>(
              valueListenable: _myTurnNotifier,
              builder: (_, isMyTurn, __) => ValueListenableBuilder<String?>(
                valueListenable: _resultNotifier,
                builder: (_, result, __) {
                  if (!isMyTurn || result != null) return const SizedBox.shrink();
                  return ValueListenableBuilder<Map<String, dynamic>?>(
                    valueListenable: _gsNotifier,
                    builder: (_, gs, __) => _buildActionBar(gs),
                  );
                },
              ),
            ),

            // ⑦ Social
            _buildSocialButtons(),
            if (_showGiftTray) _buildGiftTray(),
            if (_showChat) ValueListenableBuilder<List<_ChatMsg>>(
              valueListenable: _chatNotifier,
              builder: (_, msgs, __) => _buildChatPanel(msgs),
            ),

            // ⑧ Reconnect banner
            ValueListenableBuilder<String>(
              valueListenable: _socket.status,
              builder: (_, sv, __) => (!widget.demo && _isReconnectingStatus(sv))
                  ? _buildReconnectingBanner(sv)
                  : const SizedBox.shrink(),
            ),

            // ⑨ Result — AnimatedSwitcher prevents hard flash
            ValueListenableBuilder<String?>(
              valueListenable: _resultNotifier,
              builder: (_, result, __) => AnimatedSwitcher(
                duration: const Duration(milliseconds: 420),
                transitionBuilder: (child, anim) => FadeTransition(
                  opacity: anim,
                  child: ScaleTransition(scale: anim, child: child),
                ),
                child: (result != null && result.isNotEmpty)
                    ? _buildResult(result)
                    : const SizedBox.shrink(),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  // ── Felt table (painted once, RepaintBoundary isolates it) ─────────────────
  Widget _buildFelt() => Positioned.fill(
        child: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, -0.2), radius: 1.4,
              colors: [Color(0xFF1E2D5A), Color(0xFF0F1736), Color(0xFF060A1A)],
              stops:  [0.0, 0.6, 1.0],
            ),
          ),
          child: Center(
            child: FractionallySizedBox(
              widthFactor: 0.88, heightFactor: 0.82,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(400),
                  gradient: const RadialGradient(colors: [Color(0xFF381F17), Color(0xFF1D0E09)]),
                  boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.7), blurRadius: 28, offset: const Offset(0, 10), spreadRadius: 4)],
                ),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(400),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft, end: Alignment.bottomRight,
                      colors: [Color(0xFFFFDF7A), Color(0xFFB38F24), Color(0xFFFFDF7A), Color(0xFF8C6B12)],
                      stops:  [0.0, 0.35, 0.7, 1.0],
                    ),
                  ),
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(color: const Color(0xFF0F0505), borderRadius: BorderRadius.circular(400)),
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(400),
                        image: const DecorationImage(
                          image: AssetImage('assets/images/table_felt.png'),
                          fit: BoxFit.cover,
                          colorFilter: ColorFilter.mode(Colors.black26, BlendMode.darken),
                        ),
                      ),
                      child: Stack(children: [
                        Positioned.fill(
                          child: Container(
                            margin: const EdgeInsets.all(28),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(400),
                              border: Border.all(color: const Color(0xFFFFD700).withValues(alpha: 0.08), width: 1.5),
                            ),
                          ),
                        ),
                        Center(
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            Text('👑', style: TextStyle(fontSize: 32, color: const Color(0xFFFFD700).withValues(alpha: 0.08))),
                            const SizedBox(height: 4),
                            Text('TEEN PATTI', style: TextStyle(
                              color: const Color(0xFFFFD700).withValues(alpha: 0.12),
                              fontSize: 36, fontWeight: FontWeight.w800, letterSpacing: 8,
                            )),
                          ]),
                        ),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  // ── Seats + Center ─────────────────────────────────────────────────────────
  Widget _buildSeatsAndCenter(Map<String, dynamic>? gs) {
    final size = MediaQuery.sizeOf(context);
    final w = size.width;
    final h = size.height;
    
    // Safety fallback bounds in case size is zero on first layout
    final widthVal = w > 0 ? w : 800.0;
    final heightVal = h > 0 ? h : 480.0;

    final cx = widthVal / 2;
    final cy = heightVal / 2 - 10;
    final rx = widthVal * 0.36;
    final ry = heightVal * 0.30;

    final players = (gs?['players'] as List?) ?? [];
    final ordered = List<Map<String, dynamic>>.from(
        players.map((e) => Map<String, dynamic>.from(e as Map)));
    final myIdx = ordered.indexWhere((p) => p['user_id'] == _myUserId);
    if (myIdx > 0) {
      ordered
        ..clear()
        ..addAll([...players.sublist(myIdx), ...players.sublist(0, myIdx)]
            .map((e) => Map<String, dynamic>.from(e as Map)));
    }
    final n = ordered.isEmpty ? 1 : ordered.length;

    final seats = <Widget>[];
    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i]['user_id'] == _myUserId) continue;
      final theta = (math.pi / 2) + (2 * math.pi * i / n);
      final sx = cx + rx * math.cos(theta);
      final sy = cy + ry * math.sin(theta);
      final uid = ordered[i]['user_id'] as String?;

      seats.add(Positioned(
        left: sx - 46, top: sy - 40,
        child: _buildPlayerSeat(ordered[i], gs),
      ));
      seats.add(Positioned(
        left: sx - 32, top: sy - 90,
        child: ValueListenableBuilder<List<_Reaction>>(
          valueListenable: _reactionsNotifier,
          builder: (_, reactions, __) {
            final mine = reactions.where((x) => x.userId == uid).toList();
            return Row(
              mainAxisSize: MainAxisSize.min,
              children: mine.map((r) => _ReactionBubble(
                  key: ValueKey(r.id), emoji: r.emoji, isGift: r.isGift)).toList(),
            );
          },
        ),
      ));
    }

    seats.add(Positioned(
      left: cx - 70, top: cy - 22,
      child: SizedBox(width: 140, child: Center(child: _potChip(gs))),
    ));
    seats.add(Positioned(
      left: cx - 40, top: cy - ry - 75,
      child: const _HostessWidget(),
    ));

    return Stack(children: seats);
  }

  Widget _potChip(Map<String, dynamic>? gs) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black54,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.gold.withValues(alpha: 0.6)),
        ),
        child: Text('💰 ₹${gs?['pot'] ?? 0}',
            style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 14)),
      );

  Widget _buildPlayerSeat(Map<String, dynamic> player, Map<String, dynamic>? gs) {
    final isActive = player['status'] == 'active';
    final isFolded = player['status'] == 'folded';
    final isTurn   = gs?['current_turn_user_id'] == player['user_id'];
    final isDealer = gs?['dealer_id'] == player['user_id'];
    final status   = _statusOf(player);
    return Opacity(
      opacity: isFolded ? 0.55 : 1,
      child: Container(
        width: 96,
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        decoration: BoxDecoration(
          color: Colors.black38,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isTurn ? AppColors.green : Colors.white12, width: isTurn ? 2.5 : 1),
          boxShadow: isTurn
              ? [BoxShadow(color: AppColors.green.withValues(alpha: 0.65), blurRadius: 14, spreadRadius: 1)]
              : null,
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (!isFolded) _opponentCardBacks(),
          _statusPill(status.$1, status.$2),
          const SizedBox(height: 3),
          SizedBox(
            width: 54, height: 50,
            child: Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
              _SeatTimer(
                isTurn: isTurn,
                userId: player['user_id']?.toString() ?? '',
                timerNotifier: _timerNotifier,
                isBot: player['is_bot'] == true,
              ),
              CircleAvatar(
                radius: 17,
                backgroundColor: isActive ? Colors.white24 : Colors.grey,
                child: Text(
                  player['username']?[0]?.toUpperCase() ?? '?',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                ),
              ),
              Positioned(
                left: -4, top: -4,
                child: GestureDetector(
                  onTap: () => setState(() { _showGiftTray = true; _showChat = false; }),
                  child: Container(
                    width: 20, height: 20, alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                    child: const Text('🎁', style: TextStyle(fontSize: 10)),
                  ),
                ),
              ),
              if (isDealer)
                Positioned(
                  right: -2, top: -2,
                  child: Container(
                    width: 18, height: 18, alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.red,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                    child: const Text('D', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 3),
          Text(player['username'] ?? 'Bot', style: const TextStyle(color: Colors.white, fontSize: 11), overflow: TextOverflow.ellipsis),
          if (_chipsOf(player) != null)
            Container(
              margin: const EdgeInsets.only(top: 2),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.gold.withValues(alpha: 0.4))),
              child: Text('💰 ${_chipsOf(player)}', style: const TextStyle(color: AppColors.goldLight, fontSize: 9, fontWeight: FontWeight.bold)),
            ),
          if (player['is_bot'] == true)
            const Padding(padding: EdgeInsets.only(top: 2),
              child: Text('BOT', style: TextStyle(color: Colors.orange, fontSize: 8, fontWeight: FontWeight.bold))),
        ]),
      ),
    );
  }

  (String, Color) _statusOf(Map<String, dynamic> p) {
    if (p['status'] == 'folded') return ('Pack',  AppColors.red);
    if (p['is_seen'] == false)   return ('Blind', Colors.orange.shade700);
    return ('Chaal', AppColors.green);
  }

  Widget _opponentCardBacks() => SizedBox(
        width: 46, height: 26,
        child: Stack(alignment: Alignment.center,
          children: List.generate(3, (i) => Transform.translate(
            offset: Offset((i - 1) * 6.0, 0),
            child: Transform.rotate(angle: (i - 1) * 0.22, child: Container(
              width: 16, height: 22,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(3),
                image: const DecorationImage(
                  image: AssetImage('assets/images/card_back.png'),
                  fit: BoxFit.cover,
                ),
                boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 2, offset: Offset(0, 1))],
              ),
            )),
          ))),
      );

  Widget _statusPill(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10), border: Border.all(color: Colors.white.withOpacity(0.3))),
        child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.5)),
      );

  // ── Top Bar ────────────────────────────────────────────────────────────────
  Widget _buildTopBar() => Positioned(
        top: 6, left: 8, right: 8,
        child: Row(children: [
          _circleBtn(Icons.arrow_back, _exit, size: 36),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(20)),
            child: Text('Teen Patti • Table ${widget.roomId.substring(0, math.min(4, widget.roomId.length))}',
                style: const TextStyle(color: Colors.white70, fontSize: 12)),
          ),
          const Spacer(),
          ValueListenableBuilder<bool>(
            valueListenable: _myTurnNotifier,
            builder: (_, isMyTurn, __) => isMyTurn
                ? ValueListenableBuilder<int>(
                    valueListenable: _timerNotifier,
                    builder: (_, secs, __) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(color: secs <= 5 ? AppColors.red : const Color(0xFF8B0F1E), borderRadius: BorderRadius.circular(20)),
                      child: Text('Your turn • ${secs}s', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                    ))
                : const SizedBox.shrink(),
          ),
          const SizedBox(width: 8),
          _circleBtn(Icons.info_outline, () {}),
          const SizedBox(width: 6),
          _circleBtn(Icons.chat_bubble_outline, () => setState(() { _showChat = !_showChat; _showGiftTray = false; }), size: 36),
          const SizedBox(width: 6),
          _circleBtn(Icons.person_add_alt_1, () {}, size: 36),
          const SizedBox(width: 6),
          _circleBtn(SoundService.instance.muted ? Icons.volume_off : Icons.volume_up,
              () => setState(() => SoundService.instance.toggleMute()), size: 36),
          const SizedBox(width: 6),
          _circleBtn(Icons.settings, () {}, size: 36),
        ]),
      );

  // ── My Hand ────────────────────────────────────────────────────────────────
  Widget _buildMyHand(List<Map<String, dynamic>> cards, bool isMyTurn) {
    if (cards.isEmpty) return const SizedBox.shrink();
    return Positioned(
      bottom: isMyTurn ? 104 : 14, left: 0, right: 0,
      child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (!_isSeen) ...[
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold, foregroundColor: Colors.black, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20))),
            onPressed: () { _sendAction('see'); setState(() => _isSeen = true); },
            child: const Text('See Cards', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 8),
        ],
        Row(mainAxisSize: MainAxisSize.min,
          children: [for (var i = 0; i < cards.length; i++) _buildAnimatedCard(cards[i], i, cards.length)]),
      ])),
    );
  }

  Widget _buildAnimatedCard(Map<String, dynamic> card, int index, int total) {
    return TweenAnimationBuilder<double>(
      key: ValueKey('${card['value']}_${card['suit']}_$index'),
      tween: Tween(begin: 0.0, end: 1.0),
      duration: Duration(milliseconds: 350 + index * 80),
      curve: Curves.easeOutBack,
      builder: (_, t, __) => Transform.translate(
        offset: Offset(0, -60 * (1 - t)),
        child: Opacity(opacity: t.clamp(0.0, 1.0),
          child: Transform.rotate(
            angle: (index - (total - 1) / 2) * 0.12,
            child: _isSeen
                ? _buildCard(card['value'].toString(), card['suit'].toString())
                : _buildCardBack(),
          )),
      ),
    );
  }

  Widget _buildMyChips(Map<String, dynamic>? gs) {
    final me = (gs?['players'] as List?)?.where((p) => p['user_id'] == _myUserId).firstOrNull;
    if (me == null) return const SizedBox.shrink();
    final chips = me['chips'] ?? me['balance'] ?? 0;
    return Positioned(left: 12, bottom: 12, child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.gold.withValues(alpha: 0.7))),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Text('You  ', style: TextStyle(color: Colors.white70, fontSize: 11)),
        Text('💰 $chips', style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
      ]),
    ));
  }

  Widget _buildCard(String value, String suit) {
    final color      = (suit == 'H' || suit == 'D') ? AppColors.red : Colors.black;
    final suitSymbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
    return Container(
      width: 52, height: 74,
      margin: const EdgeInsets.symmetric(horizontal: 3),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8),
        boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(1, 3))]),
      child: Stack(children: [
        Positioned(top: 4, left: 5, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
          Text(suitSymbol, style: TextStyle(fontSize: 11, color: color)),
        ])),
        Center(child: Text(suitSymbol, style: TextStyle(fontSize: 22, color: color.withValues(alpha: 0.15)))),
        Positioned(bottom: 4, right: 5, child: Transform.rotate(angle: math.pi,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
            Text(suitSymbol, style: TextStyle(fontSize: 11, color: color)),
          ]))),
      ]),
    );
  }

  Widget _buildCardBack() => Container(
        width: 52, height: 74,
        margin: const EdgeInsets.symmetric(horizontal: 3),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          image: const DecorationImage(
            image: AssetImage('assets/images/card_back.png'),
            fit: BoxFit.cover,
          ),
          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(1, 3))],
        ),
      );

  // ── Action Bar ─────────────────────────────────────────────────────────────
  Widget _buildActionBar(Map<String, dynamic>? gs) {
    final stake    = (gs?['min_bet'] as num?)?.toDouble() ?? 10;
    final minBet   = _isSeen ? stake * 2 : stake;
    final maxBet   = minBet * 4;
    if (_betAmount < minBet) _betAmount = minBet;
    if (_betAmount > maxBet) _betAmount = maxBet;
    final players     = (gs?['players'] as List?) ?? [];
    final activeCount = players.where((p) => p['status'] == 'active').length;
    return Positioned(bottom: 6, left: 12, right: 12, child: Column(mainAxisSize: MainAxisSize.min, children: [
      _coinChip(_betAmount.toInt()),
      const SizedBox(height: 8),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        _actionBtn('Pack',  AppColors.red, () => _sendAction('fold')),
        if (activeCount == 2) ...[const SizedBox(width: 10), _actionBtn('Show', Colors.deepPurple, () => _sendAction('show'))],
        const SizedBox(width: 10),
        _stepperBtn('−', () { setState(() { _betAmount = (_betAmount - stake).clamp(minBet, maxBet); }); HapticFeedback.selectionClick(); }),
        const SizedBox(width: 6),
        _actionBtn(_betAmount > minBet ? 'Raise ₹${_betAmount.toInt()}' : 'Chaal ₹${_betAmount.toInt()}',
            AppColors.green, () => _sendAction(_betAmount > minBet ? 'raise' : 'call', amount: _betAmount)),
        const SizedBox(width: 6),
        _stepperBtn('+', () { setState(() { _betAmount = (_betAmount + stake).clamp(minBet, maxBet); }); HapticFeedback.selectionClick(); }),
      ]),
    ]));
  }

  Widget _coinChip(int amount) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
        decoration: BoxDecoration(
          gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)]),
          borderRadius: BorderRadius.circular(20), border: Border.all(color: Colors.white24),
          boxShadow: [BoxShadow(color: AppColors.gold.withValues(alpha: 0.5), blurRadius: 10, spreadRadius: 1)],
        ),
        child: Text('🪙 ₹$amount', style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12)),
      );

  Widget _stepperBtn(String label, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 36, height: 36, alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF5B6470), Color(0xFF323844)]),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
            shape: BoxShape.circle,
            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 4, offset: Offset(0, 2))],
          ),
          child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold, height: 1)),
        ),
      );

  Widget _actionBtn(String label, Color color, VoidCallback onTap, {Color textColor = Colors.white}) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 18),
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
              colors: [Color.lerp(color, Colors.white, 0.25)!, color, Color.lerp(color, Colors.black, 0.25)!]),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white.withOpacity(0.25)),
            boxShadow: [BoxShadow(color: color.withValues(alpha: 0.55), blurRadius: 14, spreadRadius: 1), const BoxShadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 2))],
          ),
          child: Text(label, style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 13, shadows: const [Shadow(color: Colors.black38, blurRadius: 2)])),
        ),
      );

  // ── Social ─────────────────────────────────────────────────────────────────
  Widget _buildSocialButtons() => Positioned(right: 8, top: 52, child: Column(children: [
        _circleBtn(Icons.card_giftcard, () => setState(() { _showGiftTray = !_showGiftTray; _showChat = false; })),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
          decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(20)),
          child: Column(children: _quickEmojis.take(5).map((e) => GestureDetector(
            onTap: () => _sendEmoji(e),
            child: Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text(e, style: const TextStyle(fontSize: 20))),
          )).toList()),
        ),
      ]));

  Widget _circleBtn(IconData icon, VoidCallback onTap, {double size = 38}) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: size, height: size,
          decoration: BoxDecoration(
            gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)]),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withOpacity(0.4), width: 1),
            boxShadow: [BoxShadow(color: AppColors.gold.withValues(alpha: 0.45), blurRadius: 8, spreadRadius: 1), const BoxShadow(color: Colors.black54, blurRadius: 4, offset: Offset(0, 2))],
          ),
          child: Icon(icon, color: Colors.white, size: size * 0.52),
        ),
      );

  Widget _buildGiftTray() => Positioned(right: 54, top: 44, child: Container(
        width: 180, padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.gold.withValues(alpha: 0.5))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          const Text('Send a gift', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: _gifts.map((g) => GestureDetector(
            onTap: () => _sendGift(g['icon']!),
            child: Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(10)),
              child: Column(children: [Text(g['icon']!, style: const TextStyle(fontSize: 22)), Text(g['name']!, style: const TextStyle(color: Colors.white70, fontSize: 9))])),
          )).toList()),
        ]),
      ));

  Widget _buildChatPanel(List<_ChatMsg> msgs) => Positioned(right: 54, top: 44, bottom: 8, child: Container(
        width: 240, padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.gold.withValues(alpha: 0.4))),
        child: Column(children: [
          const Text('Table Chat', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
          const Divider(color: Colors.white24, height: 12),
          Expanded(child: msgs.isEmpty
              ? const Center(child: Text('Say hi 👋', style: TextStyle(color: Colors.white38, fontSize: 12)))
              : ListView.builder(reverse: true, itemCount: msgs.length, itemBuilder: (_, i) {
                  final m = msgs[msgs.length - 1 - i];
                  final mine = m.userId == _myUserId;
                  return Align(alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 2),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                      decoration: BoxDecoration(color: mine ? AppColors.gold.withValues(alpha: 0.85) : Colors.white12, borderRadius: BorderRadius.circular(10)),
                      child: Text(mine ? m.text : '${m.username}: ${m.text}', style: TextStyle(color: mine ? Colors.black : Colors.white, fontSize: 12)),
                    ));
                })),
          Row(children: [
            Expanded(child: TextField(controller: _chatInput, style: const TextStyle(color: Colors.white, fontSize: 13),
              textInputAction: TextInputAction.send, onSubmitted: _sendChat,
              decoration: const InputDecoration(isDense: true, hintText: 'Message…', hintStyle: TextStyle(color: Colors.white38, fontSize: 12), contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)))),
            IconButton(icon: const Icon(Icons.send, color: AppColors.gold, size: 20), onPressed: () => _sendChat(_chatInput.text)),
          ]),
        ]),
      ));

  Widget _buildReconnectingBanner(String s) => Positioned(top: 48, left: 0, right: 0, child: Center(child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFFFFD700), Color(0xFFDAA520)]), borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(Colors.black))),
          const SizedBox(width: 10),
          Text('Reconnecting: $s…', style: const TextStyle(color: Colors.black, fontSize: 12, fontWeight: FontWeight.bold)),
        ]),
      )));

  // ── Result Overlay ─────────────────────────────────────────────────────────
  Widget _buildResult(String message) {
    final won = message.contains('Won');
    return Positioned.fill(key: const ValueKey('result'), child: Container(
      color: Colors.black.withOpacity(0.75),
      child: Stack(children: [
        if (won) RepaintBoundary(child: const Positioned.fill(child: CoinRainWidget(active: true))),
        Center(child: Container(
          margin: const EdgeInsets.all(24), padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
              colors: won ? [const Color(0xFF1A2A3A), const Color(0xFF0D1B2A)] : [const Color(0xFF2A0A0A), const Color(0xFF1A0505)]),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: won ? AppColors.gold : AppColors.red, width: 2.5),
            boxShadow: [BoxShadow(color: (won ? AppColors.gold : AppColors.red).withValues(alpha: 0.4), blurRadius: 32, spreadRadius: 4)],
          ),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(won ? '🏆 VICTORY 🏆' : '💀 GAME OVER 💀',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: won ? AppColors.gold : AppColors.red,
                shadows: [Shadow(color: (won ? AppColors.gold : AppColors.red).withValues(alpha: 0.5), blurRadius: 12)]))
              .animate().scale(begin: const Offset(0.6, 0.6), curve: Curves.elasticOut).fadeIn(),
            const SizedBox(height: 16),
            Text(message, style: const TextStyle(fontSize: 18, color: Colors.white), textAlign: TextAlign.center),
            const SizedBox(height: 28),
            Row(mainAxisSize: MainAxisSize.min, children: [
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: won ? AppColors.gold : Colors.white24,
                  foregroundColor: won ? Colors.black : Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12)),
                onPressed: _exit,
                icon: const Icon(Icons.home),
                label: const Text('Back to Lobby', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
              if (widget.demo) ...[
                const SizedBox(width: 12),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1E6B1E), foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12)),
                  onPressed: () { _resultNotifier.value = null; _practice?.startHand(); },
                  icon: const Icon(Icons.replay),
                  label: const Text('Play Again', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            ]),
          ]),
        )),
      ]),
    ));
  }
}

// ── Data classes ───────────────────────────────────────────────────────────────
class _ChatMsg {
  final String userId, username, text, type;
  _ChatMsg({required this.userId, required this.username, required this.text, required this.type});
}
class _Reaction {
  final int id; final String userId, emoji; final bool isGift;
  _Reaction({required this.id, required this.userId, required this.emoji, this.isGift = false});
}

// ── Reaction Bubble ────────────────────────────────────────────────────────────
class _ReactionBubble extends StatefulWidget {
  final String emoji; final bool isGift;
  const _ReactionBubble({super.key, required this.emoji, this.isGift = false});
  @override State<_ReactionBubble> createState() => _ReactionBubbleState();
}
class _ReactionBubbleState extends State<_ReactionBubble> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: 2400.ms)..forward();
  @override void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: _c, builder: (_, __) {
    final t = _c.value;
    return Transform.translate(offset: Offset(math.sin(t * math.pi * 2) * 6, -36 * t),
      child: Opacity(opacity: (1 - t).clamp(0.0, 1.0),
        child: Transform.scale(scale: widget.isGift ? 1.0 + t * 0.6 : 1.0,
          child: Text(widget.emoji, style: const TextStyle(fontSize: 30)))));
  });
}

// ── Thinking Dots ──────────────────────────────────────────────────────────────
class _ThinkingDots extends StatefulWidget {
  const _ThinkingDots();
  @override State<_ThinkingDots> createState() => _ThinkingDotsState();
}
class _ThinkingDotsState extends State<_ThinkingDots> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: 1200.ms)..repeat();
  @override void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: List.generate(3, (i) =>
    AnimatedBuilder(animation: _c, builder: (_, __) {
      final t = (_c.value - i * 0.2).clamp(0.0, 1.0);
      return Container(
        margin: const EdgeInsets.symmetric(horizontal: 1.5), width: 5, height: 5,
        transform: Matrix4.translationValues(0, -math.sin(t * math.pi) * 4, 0),
        decoration: const BoxDecoration(color: AppColors.gold, shape: BoxShape.circle));
    })));
}

// ── Dealer Hostess ─────────────────────────────────────────────────────────────
class _HostessWidget extends StatefulWidget {
  const _HostessWidget();
  @override
  State<_HostessWidget> createState() => _HostessWidgetState();
}
class _HostessWidgetState extends State<_HostessWidget> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this, duration: 1400.ms,
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 80,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 64, height: 64,
          decoration: BoxDecoration(shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: AppColors.gold.withValues(alpha: 0.35), blurRadius: 22, spreadRadius: 6)]),
          alignment: Alignment.center,
          child: Stack(alignment: Alignment.center, children: [
            Container(width: 60, height: 60,
              decoration: const BoxDecoration(shape: BoxShape.circle,
                gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)]))),
            Container(width: 54, height: 54,
              decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF0E1830)),
              clipBehavior: Clip.antiAlias,
              alignment: Alignment.center,
              child: Image.asset('assets/images/dealer_avatar.png', fit: BoxFit.cover)),
          ]),
        ),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [Color(0xFFB11226), Color(0xFF7A0C1A)]),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.8), width: 1),
          ),
          child: const Text('🎁 DEALER', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 1)),
        ),
      ]),
    ).animate(controller: _c, autoPlay: false)
     .moveY(begin: 0, end: -7, duration: 1400.ms, curve: Curves.easeInOut);
  }
}

// ── Seat Timer (Leaf Rebuilder) ────────────────────────────────────────────────
class _SeatTimer extends StatelessWidget {
  final bool isTurn;
  final String userId;
  final ValueNotifier<int> timerNotifier;
  final bool isBot;

  const _SeatTimer({
    required this.isTurn,
    required this.userId,
    required this.timerNotifier,
    required this.isBot,
  });

  @override
  Widget build(BuildContext context) {
    if (!isTurn) {
      return SizedBox(
        width: 46, height: 46,
        child: CircularProgressIndicator(
          value: 1.0,
          strokeWidth: 3,
          backgroundColor: Colors.black26,
          valueColor: AlwaysStoppedAnimation(const Color(0xFFD4AF37).withValues(alpha: 0.6)),
        ),
      );
    }

    return ValueListenableBuilder<int>(
      valueListenable: timerNotifier,
      builder: (context, secs, _) {
        return Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            if (isBot)
              Positioned(
                top: -38,
                child: Container(
                  key: ValueKey('thinking_$userId'),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFD4AF37).withValues(alpha: 0.5)),
                  ),
                  child: const _ThinkingDots(),
                ),
              ),
            SizedBox(
              width: 46, height: 46,
              child: CircularProgressIndicator(
                value: (secs / 30).clamp(0.0, 1.0),
                strokeWidth: 3,
                backgroundColor: Colors.black26,
                valueColor: const AlwaysStoppedAnimation(Colors.green),
              ),
            ),
            Positioned(
              bottom: -4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${secs}s',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
