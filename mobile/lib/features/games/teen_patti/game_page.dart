import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'dart:async';
import 'dart:math' as math;
import '../../../core/audio/sound_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/network/api_client.dart';
import '../../../core/monitor/monitor_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'practice_engine.dart';
import 'coin_rain.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Teen Patti Game Page — portrait layout, layered Stack architecture.
//
//  Layout layers (bottom → top):
//    1. Dark ambient background gradient
//    2. Green oval poker table (AspectRatio-aware, gold border)
//    3. Dealer/hostess avatar (overlaps table top-center)
//    4. Opponent seats (positioned around table edges, null-safe)
//    5. Center content: user cards + pot chip
//    6. Top bar (back, table info, turn timer, icon actions)
//    7. Right emoji panel
//    8. Reconnect banner (conditional)
//    9. Bottom action bar: Pack / − / Chaal / + (SafeArea-padded)
//   10. Chat / gift overlays (conditional)
//   11. Result overlay (AnimatedSwitcher, no Positioned in ScaleTransition)
//
//  Anti-flicker: all mutable state flows through ValueNotifiers; only leaf
//  widgets rebuild. No setState inside build or listener callbacks.
// ─────────────────────────────────────────────────────────────────────────────
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
  final _api = ApiClient();
  PracticeEngine? _practice;

  // Seat positions: (fractionX, fractionY) relative to TABLE rect — landscape oval.
  // (0,0)=table top-left, (1,1)=table bottom-right.
  // cx = tableLeft + tableW * fx,  cy = tableTop + tableH * fy
  static const _tableSeats = {
    1: [(0.50, 0.12)],
    2: [(0.22, 0.09), (0.78, 0.09)],
    3: [(0.07, 0.50), (0.50, 0.08), (0.93, 0.50)],
    4: [(0.07, 0.46), (0.30, 0.08), (0.70, 0.08), (0.93, 0.46)],
    5: [(0.07, 0.46), (0.24, 0.08), (0.50, 0.06), (0.76, 0.08), (0.93, 0.46)],
  };

  // ── ValueNotifiers ────────────────────────────────────────────────────────
  final _gsNotifier        = ValueNotifier<Map<String, dynamic>?>(null);
  final _myTurnNotifier    = ValueNotifier<bool>(false);
  final _timerNotifier     = ValueNotifier<int>(30);
  final _resultNotifier    = ValueNotifier<String?>(null);
  final _myCardsNotifier   = ValueNotifier<List<Map<String, dynamic>>>([]);
  final _reactionsNotifier = ValueNotifier<List<_Reaction>>([]);
  late  final _betNotifier = ValueNotifier<double>(0);

  String? _myUserId;
  bool    _isSeen      = false;
  int     _turnSeq     = 0;
  double  _betAmount   = 0;
  Timer?  _turnTimer;
  StreamSubscription? _reconnectSub;
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _gameStateSub;
  StreamSubscription? _gameResultSub;
  StreamSubscription? _roomChatSub;
  bool _ready        = false;
  bool _showGiftTray = false;
  int  _reactionId   = 0;

  List<String> _quickEmojis = ['😀', '😂', '😎', '😮', '😭', '🔥', '👏', '🤔'];
  List<Map<String, dynamic>> _gifts = [
    {'icon': '🌹', 'name': 'Rose', 'price': 5.0},
    {'icon': '🎁', 'name': 'Gift', 'price': 10.0},
    {'icon': '💎', 'name': 'Diamond', 'price': 50.0},
    {'icon': '🍺', 'name': 'Beer', 'price': 15.0},
    {'icon': '👑', 'name': 'Crown', 'price': 100.0},
    {'icon': '🚀', 'name': 'Rocket', 'price': 25.0},
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    // Lock to landscape for the game table.
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    widget.demo ? _initDemo() : _init();
    SoundService.instance.loopAmbience('casino_bgm.mp3');
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    precacheImage(const AssetImage('assets/images/card_back.png'), context);
    precacheImage(const AssetImage('assets/images/dealer_avatar.png'), context);
  }

  @override
  void dispose() {
    SoundService.instance.stopAmbience();
    _reconnectSub?.cancel();
    _roomJoinedSub?.cancel();
    _gameStateSub?.cancel();
    _gameResultSub?.cancel();
    _roomChatSub?.cancel();
    _turnTimer?.cancel();
    _practice?.dispose();
    for (final n in [
      _gsNotifier, _myTurnNotifier, _timerNotifier, _resultNotifier,
      _myCardsNotifier, _reactionsNotifier, _betNotifier,
    ]) { n.dispose(); }
    // Restore portrait when leaving the game
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp, DeviceOrientation.portraitDown,
    ]);
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
        _resultNotifier.value = msg;
        _myTurnNotifier.value = false;
        if (won) {
          HapticFeedback.heavyImpact();
          Timer(140.ms, HapticFeedback.heavyImpact);
          Timer(280.ms, HapticFeedback.heavyImpact);
          SystemSound.play(SystemSoundType.alert);
        } else {
          HapticFeedback.mediumImpact();
        }
      },
      onChat: (uid, name, text) {},
    );
    _ready = true;
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
    final me = players.firstWhere(
        (p) => (p['userId'] ?? p['user_id']) == _myUserId,
        orElse: () => <String, dynamic>{});
    _isSeen = me['is_seen'] ?? me['isSeen'] ?? false;
    final gs = {
      ...rawState,
      'pot':          data['pot']          ?? rawState['pot']          ?? 0,
      'min_bet':      data['min_bet']      ?? rawState['min_bet']      ?? 0,
      'current_turn': data['current_turn'] ?? rawState['current_turn'] ?? 0,
      'players':      players,
    };
    _gsNotifier.value  = gs;
    _betAmount         = (data['min_bet'] as num?)?.toDouble() ?? 0;
    _betNotifier.value = _betAmount;
    final idx  = (gs['current_turn'] ?? 0) as int;
    final cur  = idx < players.length ? players[idx] : null;
    final isMe = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
    _myTurnNotifier.value = isMe;
    if (isMe && (_turnTimer == null || !_turnTimer!.isActive)) _startTurnTimer();
    SoundService.instance.play(Sfx.cardDeal);
  }

  Future<void> _loadConfig() async {
    try {
      final res = await Future.wait([
        _api.dio.get('/api/admin/config/emojis'),
        _api.dio.get('/api/admin/config/gifts'),
      ]);
      final emojis = (res[0].data as List?)?.cast<String>();
      final gifts  = (res[1].data as List?)?.cast<Map<String, dynamic>>();
      if (emojis != null && emojis.isNotEmpty && mounted) setState(() => _quickEmojis = emojis);
      if (gifts  != null && gifts.isNotEmpty  && mounted) setState(() => _gifts = gifts);
    } catch (_) { /* keep defaults on error */ }
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();
    _loadConfig(); // fire-and-forget, updates emojis/gifts when available
    MonitorService.instance.game('tp_join_room', properties: {'room_id': widget.roomId});
    _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});
    _reconnectSub = _socket.on('reconnect').listen((_) =>
        _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId}));

    if (widget.initialData != null)
      _applyRoomJoinedData(Map<String, dynamic>.from(widget.initialData!));

    if (mounted) setState(() => _ready = true);

    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen(
        (data) => _applyRoomJoinedData(Map<String, dynamic>.from(data)));

    _gameStateSub = _socket.on(SocketEvents.gameStateUpdate).listen((data) {
      if (!mounted) return;
      final inner   = data['state'] as Map<String, dynamic>? ?? data;
      final players = _mapPlayers(inner['players'] as List? ?? []);
      _gsNotifier.value = {...inner, 'players': players};
      final idx      = (inner['current_turn'] ?? inner['CurrentTurn'] ?? 0) as int;
      final cur      = idx < players.length ? players[idx] : null;
      final isMe     = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
      final wasMyTurn = _myTurnNotifier.value;
      _myTurnNotifier.value = isMe;
      if (isMe && !wasMyTurn) _startTurnTimer();
      else if (!isMe) _turnTimer?.cancel();

      // last_action available for future overlay if needed
    });

    _gameResultSub = _socket.on(SocketEvents.gameResult).listen((data) {
      if (!mounted) return;
      _turnTimer?.cancel();
      final won = data['winner_id'] == _myUserId;
      MonitorService.instance.game('tp_result', properties: {
        'won': won,
        'prize': data['prize']?.toString() ?? '0',
        'room_id': widget.roomId,
      });
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

    _roomChatSub = _socket.on(SocketEvents.roomChatMsg).listen((data) {
      if (!mounted || data is! Map) return;
      final type = (data['type'] ?? 'text').toString();
      final msg  = _ChatMsg(
          userId:   data['user_id']?.toString()  ?? '',
          username: data['username']?.toString() ?? 'Player',
          text:     data['message']?.toString()  ?? '',
          type:     type);
      if (msg.userId != _myUserId && type != 'text') {
        _spawnReaction(msg.userId, msg.text, isGift: type == 'gift');
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
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
    MonitorService.instance.game('tp_action',
        properties: {'action': action, if (amount != null) 'amount': amount});
    if (widget.demo) {
      HapticFeedback.mediumImpact();
      _practice?.playerAction(action, amount);
      return;
    }
    MonitorService.instance.wsMessage('send', SocketEvents.gameAction);
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action':  action,
      if (amount != null) 'amount': amount,
      'sequence_num': ++_turnSeq,
    });
    HapticFeedback.mediumImpact();
  }

  void _sendEmoji(String emoji) {
    _socket.emit(SocketEvents.roomChat,
        {'room_id': widget.roomId, 'message': emoji, 'type': 'emoji'});
    _spawnReaction(_myUserId ?? '', emoji);
    SoundService.instance.play(Sfx.buttonTap);
    HapticFeedback.selectionClick();
  }

  void _sendGift(String icon) {
    _socket.emit(SocketEvents.roomChat,
        {'room_id': widget.roomId, 'message': icon, 'type': 'gift'});
    _spawnReaction(_myUserId ?? '', icon, isGift: true);
    setState(() => _showGiftTray = false);
    SoundService.instance.play(Sfx.chipBet);
    HapticFeedback.mediumImpact();
  }

  void _spawnReaction(String userId, String emoji, {bool isGift = false}) {
    final r = _Reaction(id: ++_reactionId, userId: userId, emoji: emoji, isGift: isGift);
    _reactionsNotifier.value = [..._reactionsNotifier.value, r];
    if (userId != _myUserId) SoundService.instance.play(Sfx.buttonTap, volume: 0.5);
    Timer(2600.ms, () {
      if (!mounted) return;
      _reactionsNotifier.value =
          _reactionsNotifier.value.where((x) => x.id != r.id).toList();
    });
  }

  String? _chipsOf(Map<String, dynamic> p) {
    final v = p['chips'] ?? p['balance'] ?? p['stack'];
    return v == null ? null : num.tryParse(v.toString())?.toStringAsFixed(0);
  }

  void _doExit() {
    if (!widget.demo) _socket.emit('leave_room', {'room_id': widget.roomId});
    Navigator.pop(context);
  }

  void _confirmExit() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Leave Game?',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        content: const Text("You'll forfeit this hand and your current bet.",
            style: TextStyle(color: Colors.white70, fontSize: 14)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Stay', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
            onPressed: () { Navigator.pop(ctx); _doExit(); },
            child: const Text('Leave', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  bool _isReconnecting(String s) =>
      s.contains('reconnect') || s.contains('connecting') || s.contains('error');

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUILD
  // ═══════════════════════════════════════════════════════════════════════════
  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) _confirmExit(); },
      child: Scaffold(
        backgroundColor: const Color(0xFF060A1A),
        body: SafeArea(
          top: false,
          bottom: true,
          child: !_ready
              ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
              : LayoutBuilder(builder: (context, box) {
                  final w = box.maxWidth;
                  final h = box.maxHeight;
                  // Landscape layout: top bar 40px, right action panel 172px
                  const topBarH = 40.0;
                  const rightPanelW = 172.0;
                  final tw = w - rightPanelW - 2;   // table fills left area
                  final th = h - topBarH - 2;        // fills full height below top bar
                  const tl = 0.0;
                  const tt = topBarH;

                  return Stack(children: [
                    // ① Ambient background
                    _buildBackground(w, h),

                    // ② Poker table oval — explicit coords, no helpers needed
                    _buildTableOval(tl, tt, tw, th),

                    // ③ Dealer hostess — top-centre of the table oval
                    Positioned(
                      left: tw / 2 - 40, top: tt + 6,
                      child: const _HostessWidget(),
                    ),

                    // ④ Opponent seats
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) =>
                          _buildOpponentSeats(gs, w, h, tl, tt, tw, th),
                    ),

                    // ⑤ User cards + See Cards btn — centred on lower table
                    ValueListenableBuilder<List<Map<String, dynamic>>>(
                      valueListenable: _myCardsNotifier,
                      builder: (_, cards, __) =>
                          ValueListenableBuilder<bool>(
                            valueListenable: _myTurnNotifier,
                            builder: (_, isMyTurn, __) =>
                                _buildUserCards(cards, isMyTurn, w, tl, tt, tw, th),
                          ),
                    ),

                    // ⑥ Pot chip — below user cards, inside table
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) => _buildPotChip(gs, w, tt, tw, th),
                    ),

                    // ⑦ My chips strip — just below the table
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) => _buildMyChips(gs),
                    ),

                    // ⑧ Top bar
                    _buildTopBar(w),

                    // ⑨ Right emoji panel
                    _buildRightPanel(w, h, tt),

                    // ⑩ Floating reactions
                    ValueListenableBuilder<List<_Reaction>>(
                      valueListenable: _reactionsNotifier,
                      builder: (_, reactions, __) =>
                          _buildReactions(reactions, w, h),
                    ),

                    // ⑪ Reconnect banner
                    ValueListenableBuilder<String>(
                      valueListenable: _socket.status,
                      builder: (_, sv, __) =>
                          (!widget.demo && _isReconnecting(sv))
                              ? _buildReconnectBanner(sv)
                              : const SizedBox.shrink(),
                    ),

                    // ⑫ Action bar
                    ValueListenableBuilder<bool>(
                      valueListenable: _myTurnNotifier,
                      builder: (_, isMyTurn, __) =>
                          ValueListenableBuilder<String?>(
                            valueListenable: _resultNotifier,
                            builder: (_, result, __) =>
                                (isMyTurn && result == null)
                                    ? ValueListenableBuilder<Map<String, dynamic>?>(
                                        valueListenable: _gsNotifier,
                                        builder: (_, gs, __) =>
                                            _buildActionBar(gs, w, h),
                                      )
                                    : const SizedBox.shrink(),
                          ),
                    ),

                    // ⑬ Gift tray
                    if (_showGiftTray) _buildGiftTray(w, h),


                    // ⑮ Result overlay
                    Positioned.fill(
                      child: ValueListenableBuilder<String?>(
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
                    ),
                  ]);
                }),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LAYOUT HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  // ① Background
  Widget _buildBackground(double w, double h) => Positioned.fill(
        child: RepaintBoundary(
          child: Container(
            decoration: const BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0, -0.3),
                radius: 1.2,
                colors: [Color(0xFF0D1833), Color(0xFF060A1A)],
              ),
            ),
          ),
        ),
      );

  // ② Oval poker table — tl/tt/tw/th passed in from LayoutBuilder
  Widget _buildTableOval(double tl, double tt, double tw, double th) {
    final radius = BorderRadius.circular(math.min(tw, th) / 2);
    return Positioned(
      left: tl, top: tt, width: tw, height: th,
      child: RepaintBoundary(
        child: Container(
          decoration: BoxDecoration(
            borderRadius: radius,
            gradient: const RadialGradient(
              center: Alignment(0, -0.1),
              radius: 1.1,
              colors: [Color(0xFF2E9B55), Color(0xFF1B7A3E), Color(0xFF0F5428)],
              stops: [0.0, 0.55, 1.0],
            ),
            border: Border.all(color: const Color(0xFFD4AF37), width: 3.5),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withOpacity(0.65),
                  blurRadius: 28, spreadRadius: 4, offset: const Offset(0, 8)),
              BoxShadow(
                  color: const Color(0xFFD4AF37).withOpacity(0.18),
                  blurRadius: 12, spreadRadius: 1),
            ],
          ),
          child: Container(
            margin: const EdgeInsets.all(5),
            decoration: BoxDecoration(
              borderRadius: radius,
              border: Border.all(
                  color: const Color(0xFFD4AF37).withOpacity(0.30), width: 1.5),
            ),
            child: Center(
              child: Text(
                'TEEN PATTI',
                style: TextStyle(
                  color: const Color(0xFF2E9B55).withOpacity(0.14),
                  fontSize: tw * 0.08,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 6,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ④ Opponent seats positioned around the table using TABLE-relative fractions.
  //    cx = tl + tw*fx,  cy = tt + th*fy  — so seats stay inside the oval.
  Widget _buildOpponentSeats(
    Map<String, dynamic>? gs, double w, double h,
    double tl, double tt, double tw, double th,
  ) {
    final allPlayers = (gs?['players'] as List? ?? [])
        .map((p) => Map<String, dynamic>.from(p as Map))
        .toList();
    final opponents = allPlayers
        .where((p) => (p['user_id'] ?? p['userId']) != _myUserId)
        .toList();
    if (opponents.isEmpty) return const SizedBox.shrink();

    final n       = opponents.length.clamp(1, 5);
    final posList = _tableSeats[n] ?? _tableSeats[1]!;

    return Stack(children: [
      for (var i = 0; i < opponents.length && i < posList.length; i++)
        _positionedSeat(opponents[i], gs, posList[i], w, h, tl, tt, tw, th),
    ]);
  }

  Widget _positionedSeat(
    Map<String, dynamic> p,
    Map<String, dynamic>? gs,
    (double, double) frac,
    double w, double h,
    double tl, double tt, double tw, double th,
  ) {
    const seatW = 106.0;
    const seatH = 148.0;
    // Centre of seat in screen pixels, table-relative
    final cx = tl + tw * frac.$1;
    final cy = tt + th * frac.$2;
    // Clamp so seat box stays within screen bounds (4dp margin each side)
    final sl = (cx - seatW / 2).clamp(4.0, w - seatW - 4.0);
    // Clamp top: must be below status-bar area (tt - seatH/2 minimum = tt - 74)
    final st = (cy - seatH / 2).clamp(tt - 10.0, h - seatH - 4.0);

    return Positioned(
      key: ValueKey('seat_${p['user_id'] ?? p['userId']}'),
      left: sl, top: st, width: seatW,
      child: RepaintBoundary(child: _buildSeatWidget(p, gs)),
    );
  }

  Widget _buildSeatWidget(Map<String, dynamic> p, Map<String, dynamic>? gs) {
    final uid      = (p['user_id'] ?? p['userId'])?.toString() ?? '';
    final isFolded = p['status'] == 'folded';
    final isBot    = p['is_bot'] == true;
    final players  = (gs?['players'] as List?) ?? [];
    final turnIdx  = (gs?['current_turn'] ?? gs?['CurrentTurn'] ?? -1) as int;
    final turnUid  = gs?['current_turn_user_id'] ??
        (turnIdx >= 0 && turnIdx < players.length
            ? (players[turnIdx] as Map)['user_id'] ?? (players[turnIdx] as Map)['userId']
            : null);
    final isTurn   = turnUid == uid;
    final isDealer = gs?['dealer_id'] == uid;
    final (statusLabel, statusColor) = _statusOf(p);
    final chips    = _chipsOf(p);

    return Opacity(
      opacity: isFolded ? 0.45 : 1.0,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Card backs on top
          if (!isFolded) _opponentCardBacks(),
          const SizedBox(height: 4),
          // Dark container: avatar + name + status
          Container(
            width: 110,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF0D2E18).withOpacity(0.88),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                  color: isTurn ? const Color(0xFF2ECC71) : Colors.white12,
                  width: isTurn ? 2.0 : 1.0),
              boxShadow: isTurn
                  ? [BoxShadow(
                      color: const Color(0xFF2ECC71).withOpacity(0.55),
                      blurRadius: 12, spreadRadius: 1)]
                  : null,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Avatar with timer ring
                SizedBox(
                  width: 48, height: 48,
                  child: Stack(alignment: Alignment.center, children: [
                    // Timer ring
                    if (isTurn)
                      ValueListenableBuilder<int>(
                        valueListenable: _timerNotifier,
                        builder: (_, secs, __) => SizedBox(
                          width: 46, height: 46,
                          child: CircularProgressIndicator(
                            value: (secs / 30).clamp(0.0, 1.0),
                            strokeWidth: 2.5,
                            backgroundColor: Colors.black26,
                            valueColor: AlwaysStoppedAnimation(
                                secs <= 5 ? Colors.red : const Color(0xFF2ECC71)),
                          ),
                        ),
                      )
                    else
                      SizedBox(
                        width: 46, height: 46,
                        child: CircularProgressIndicator(
                          value: 1.0,
                          strokeWidth: 2.5,
                          backgroundColor: Colors.black26,
                          valueColor: AlwaysStoppedAnimation(
                              const Color(0xFFD4AF37).withOpacity(0.4)),
                        ),
                      ),
                    // Avatar circle
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: isFolded ? Colors.grey.shade800 : Colors.white24,
                      child: Text(
                        (p['username']?.toString() ?? '?')[0].toUpperCase(),
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                    ),
                    // Gift button
                    Positioned(
                      left: 0, top: 0,
                      child: GestureDetector(
                        onTap: () => setState(() { _showGiftTray = true; }),
                        child: Container(
                          width: 18, height: 18, alignment: Alignment.center,
                          decoration: const BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: LinearGradient(
                              colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                          ),
                          child: const Text('🎁', style: TextStyle(fontSize: 9)),
                        ),
                      ),
                    ),
                    // Dealer badge
                    if (isDealer)
                      Positioned(
                        right: 0, top: 0,
                        child: Container(
                          width: 17, height: 17, alignment: Alignment.center,
                          decoration: BoxDecoration(
                              color: AppColors.red,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 1.5)),
                          child: const Text('D',
                              style: TextStyle(
                                  color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                        ),
                      ),
                    // Thinking dots for bots
                    if (isBot && isTurn)
                      Positioned(
                        top: -36,
                        child: Container(
                          key: ValueKey('thinking_$uid'),
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.black87,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                                color: const Color(0xFFD4AF37).withOpacity(0.5)),
                          ),
                          child: const _ThinkingDots(),
                        ),
                      ),
                  ]),
                ),
                const SizedBox(height: 4),
                Text(
                  p['username']?.toString() ?? 'Bot',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 10, fontWeight: FontWeight.w600),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
                const SizedBox(height: 3),
                _statusPill(statusLabel, statusColor),
                if (chips != null) ...[
                  const SizedBox(height: 3),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                          begin: Alignment.topCenter, end: Alignment.bottomCenter),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text('💰 $chips',
                        style: const TextStyle(
                            color: Colors.black, fontSize: 8, fontWeight: FontWeight.bold)),
                  ),
                ],
                if (isBot) ...[
                  const SizedBox(height: 2),
                  const Text('BOT',
                      style: TextStyle(
                          color: Colors.orange, fontSize: 7, fontWeight: FontWeight.bold)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ⑤ User's own cards — centred on the table
  Widget _buildUserCards(
      List<Map<String, dynamic>> cards, bool isMyTurn,
      double w, double tl, double tt, double tw, double th) {
    if (cards.isEmpty) return const SizedBox.shrink();

    // Cards sit at 60% down the table; "See Cards" btn at 46%
    final cardsTop = tt + th * 0.60;
    final btnTop   = tt + th * 0.46;

    return Stack(children: [
      // "See Cards" button (only when blind and cards exist)
      if (!_isSeen)
        Positioned(
          top: btnTop,
          left: w / 2 - 70,
          child: SizedBox(
            width: 140, height: 38,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.gold,
                foregroundColor: Colors.black,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20)),
                elevation: 4,
              ),
              onPressed: () { _sendAction('see'); setState(() => _isSeen = true); },
              child: const Text('See Cards',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            ),
          ),
        ),
      // The 3 cards
      Positioned(
        top: cardsTop,
        left: w / 2 - (cards.length * 46.0) / 2,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 0; i < cards.length; i++)
              _buildAnimatedCard(cards[i], i, cards.length),
          ],
        ),
      ),
    ]);
  }

  Widget _buildAnimatedCard(Map<String, dynamic> card, int index, int total) {
    return TweenAnimationBuilder<double>(
      key: ValueKey('${card['value']}_${card['suit']}_$index'),
      tween: Tween(begin: 0.0, end: 1.0),
      duration: Duration(milliseconds: 360 + index * 80),
      curve: Curves.easeOutBack,
      builder: (_, t, __) => Transform.translate(
        offset: Offset(0, -60 * (1 - t)),
        child: Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.rotate(
            angle: (index - (total - 1) / 2) * 0.12,
            child: _isSeen
                ? _buildCard(card['value'].toString(), card['suit'].toString())
                : _buildCardBack(),
          ),
        ),
      ),
    );
  }

  // ⑥ Pot chip — below the user cards, inside table
  Widget _buildPotChip(Map<String, dynamic>? gs, double w, double tt, double tw, double th) {
    return Positioned(
      left: w / 2 - 52, top: tt + th * 0.80,
      child: Container(
        width: 104,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
              colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)],
              begin: Alignment.topCenter, end: Alignment.bottomCenter),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white24),
          boxShadow: [
            BoxShadow(
                color: AppColors.gold.withOpacity(0.4),
                blurRadius: 10, spreadRadius: 1),
          ],
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          const Text('🪙 ', style: TextStyle(fontSize: 14)),
          Text('₹${gs?['pot'] ?? 0}',
              style: const TextStyle(
                  color: Colors.black, fontWeight: FontWeight.bold, fontSize: 15)),
        ]),
      ),
    );
  }

  // ⑦ My chips strip — anchored to bottom-left in landscape
  Widget _buildMyChips(Map<String, dynamic>? gs) {
    final me = (gs?['players'] as List?)
        ?.where((p) => (p['user_id'] ?? p['userId']) == _myUserId)
        .firstOrNull;
    if (me == null) return const SizedBox.shrink();
    final chips  = me['chips'] ?? me['balance'] ?? 0;
    final isSeen = me['is_seen'] ?? me['isSeen'] ?? _isSeen;
    // In landscape, table fills most of the screen, so show chips at bottom inside table
    return Positioned(
      left: 0, right: 174, bottom: 12,
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFF0D2E18).withOpacity(0.85),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
                color: const Color(0xFFD4AF37).withOpacity(0.6), width: 1.5),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Text('💰 ',
                style: TextStyle(fontSize: 14)),
            Text('$chips',
                style: const TextStyle(
                    color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
            const Text('  You  ',
                style: TextStyle(color: Colors.white60, fontSize: 11)),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: isSeen ? const Color(0xFF2ECC71) : Colors.orange.shade700,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(isSeen ? 'SEEN' : 'BLIND',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
            ),
          ]),
        ),
      ),
    );
  }

  // ⑧ Top bar (landscape: compact 40px, stops before right panel)
  Widget _buildTopBar(double w) {
    return Positioned(
      top: 0, left: 0, right: 172, height: 40,
      child: RepaintBoundary(
        child: Row(children: [
          // Back button
          _iconBtn(Icons.arrow_back_ios_new_rounded, _confirmExit, size: 38),
          const SizedBox(width: 8),
          // Table label
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                  color: Colors.black54, borderRadius: BorderRadius.circular(20)),
              child: Text(
                'Teen Patti • Table ${widget.roomId.substring(0, math.min(4, widget.roomId.length))}',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Turn timer
          ValueListenableBuilder<bool>(
            valueListenable: _myTurnNotifier,
            builder: (_, isMyTurn, __) => isMyTurn
                ? ValueListenableBuilder<int>(
                    valueListenable: _timerNotifier,
                    builder: (_, secs, __) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: secs <= 5 ? AppColors.red : const Color(0xFF8B0F1E),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text('Your turn • ${secs}s',
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 12)),
                    ))
                : const SizedBox.shrink(),
          ),
          const Spacer(),
          // Icon actions
          _iconBtn(Icons.info_outline, () {}),
          const SizedBox(width: 5),
          _iconBtn(Icons.person_add_alt_1, () {}),
          const SizedBox(width: 5),
          _iconBtn(
            SoundService.instance.muted ? Icons.volume_off : Icons.volume_up,
            () => setState(() => SoundService.instance.toggleMute()),
          ),
          const SizedBox(width: 5),
          _iconBtn(Icons.settings, () {}),
        ]),
      ),
    );
  }

  // ⑨ Right panel — emojis + gift, anchored to right edge for landscape
  Widget _buildRightPanel(double w, double h, double tt) {
    return Positioned(
      right: 0, top: 0, bottom: 0, width: 172,
      child: RepaintBoundary(
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFF050C1A),
            border: Border(left: BorderSide(color: Colors.white12)),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(height: 8),
              // Gift button at top of right panel
              _iconBtn(Icons.card_giftcard,
                  () => setState(() { _showGiftTray = !_showGiftTray; }),
                  size: 36),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 6),
                decoration: BoxDecoration(
                    color: Colors.black38, borderRadius: BorderRadius.circular(22)),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: _quickEmojis.take(6).map((e) => GestureDetector(
                    onTap: () => _sendEmoji(e),
                    child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Text(e, style: const TextStyle(fontSize: 24))),
                  )).toList(),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }

  // ⑩ Floating reactions (centered in table area, not right panel)
  Widget _buildReactions(List<_Reaction> reactions, double w, double h) {
    if (reactions.isEmpty) return const SizedBox.shrink();
    final tableW = w - 174.0;
    return Stack(children: reactions.map((r) {
      return Positioned(
        key: ValueKey('rx_${r.id}'),
        left: tableW * 0.5 - 20 + (r.id % 5 - 2) * 18.0,
        top: h * 0.45,
        child: _ReactionBubble(emoji: r.emoji, isGift: r.isGift),
      );
    }).toList());
  }

  // ⑪ Reconnect banner (below compact top bar, inside table area)
  Widget _buildReconnectBanner(String sv) {
    final failed = sv == 'reconnect-failed';
    return Positioned(
      top: 44, left: 8, right: 180,
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            gradient: LinearGradient(
                colors: failed
                    ? [const Color(0xFFCC3333), const Color(0xFF991111)]
                    : [const Color(0xFFFFD700), const Color(0xFFDAA520)]),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (!failed)
              const SizedBox(
                width: 14, height: 14,
                child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(Colors.black)),
              ),
            if (!failed) const SizedBox(width: 8),
            Text(
              failed ? 'Connection lost' : 'Reconnecting…',
              style: TextStyle(
                  color: failed ? Colors.white : Colors.black,
                  fontSize: 12, fontWeight: FontWeight.bold),
            ),
            if (failed) ...[
              const SizedBox(width: 10),
              GestureDetector(
                onTap: () => _socket.reconnectNow(),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                  decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(12)),
                  child: const Text('Retry',
                      style: TextStyle(color: Colors.white, fontSize: 11,
                          fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ]),
        ),
      ),
    );
  }

  // ⑫ Bottom action bar: Pack | − | Chaal | +
  //    Pinned to bottom; SafeArea handles system nav bar.
  Widget _buildActionBar(Map<String, dynamic>? gs, double w, double h) {
    final stake  = (gs?['min_bet'] as num?)?.toDouble() ?? 10;
    final minBet = _isSeen ? stake * 2 : stake;
    final maxBet = minBet * 4;
    final players     = (gs?['players'] as List?) ?? [];
    final activeCount = players.where((p) => (p as Map)['status'] == 'active').length;

    return Positioned(
      left: 0, right: 174, bottom: 0,
      child: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [Colors.black.withOpacity(0.0), Colors.black.withOpacity(0.88)],
              begin: Alignment.topCenter, end: Alignment.bottomCenter,
            ),
          ),
          child: ValueListenableBuilder<double>(
            valueListenable: _betNotifier,
            builder: (_, rawBet, __) {
              // Clamp inline — never write to _betNotifier inside a builder
              // to avoid triggering a rebuild loop.
              final bet = rawBet.clamp(minBet, maxBet);
              _betAmount = bet;
              final label = bet > minBet
                  ? 'Raise ₹${bet.toInt()}'
                  : 'Chaal ₹${bet.toInt()}';
              return Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Pack
                  _actionBtn('Pack', AppColors.red, () => _sendAction('fold'),
                      width: 90),
                  const SizedBox(width: 8),
                  // Show (only 2 active players)
                  if (activeCount == 2) ...[
                    _actionBtn('Show', Colors.deepPurple,
                        () => _sendAction('show'), width: 72),
                    const SizedBox(width: 8),
                  ],
                  // − stepper
                  _stepperBtn('−', () {
                    _betNotifier.value = (bet - stake).clamp(minBet, maxBet);
                    HapticFeedback.selectionClick();
                  }),
                  const SizedBox(width: 8),
                  // Chaal / Raise
                  _actionBtn(label, AppColors.green,
                      () => _sendAction(bet > minBet ? 'raise' : 'call', amount: bet),
                      width: 120),
                  const SizedBox(width: 8),
                  // + stepper
                  _stepperBtn('+', () {
                    _betNotifier.value = (bet + stake).clamp(minBet, maxBet);
                    HapticFeedback.selectionClick();
                  }),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  // ⑬ Gift tray (positioned inside table area in landscape)
  Widget _buildGiftTray(double w, double h) => Positioned(
        right: 180, top: h * 0.22,
        child: Container(
          width: 190,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: Colors.black87,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.gold.withOpacity(0.5))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Send a gift',
                style: TextStyle(
                    color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8, runSpacing: 8,
              children: _gifts.map((g) {
                final price = double.tryParse(g['price']?.toString() ?? '0') ?? 0;
                return GestureDetector(
                  onTap: () => _sendGift(g['icon']?.toString() ?? ''),
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                        color: Colors.white10,
                        borderRadius: BorderRadius.circular(10)),
                    child: Column(children: [
                      Text(g['icon']?.toString() ?? '', style: const TextStyle(fontSize: 22)),
                      Text(g['name']?.toString() ?? '',
                          style: const TextStyle(color: Colors.white70, fontSize: 9)),
                      if (price > 0)
                        Text('₹${price.toInt()}',
                            style: const TextStyle(color: AppColors.gold, fontSize: 9,
                                fontWeight: FontWeight.bold)),
                    ]),
                  ),
                );
              }).toList(),
            ),
          ]),
        ),
      );

  // ⑮ Result overlay (returned as plain Container — AnimatedSwitcher wraps
  //    it inside Positioned.fill, so ScaleTransition can't break StackParentData)
  Widget _buildResult(String message) {
    final won = message.contains('Won');
    return Container(
      key: const ValueKey('result'),
      color: Colors.black.withOpacity(0.78),
      child: Stack(children: [
        if (won)
          Positioned.fill(
              child: RepaintBoundary(child: CoinRainWidget(active: true))),
        Center(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 24),
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter, end: Alignment.bottomCenter,
                colors: won
                    ? [const Color(0xFF1A2A3A), const Color(0xFF0D1B2A)]
                    : [const Color(0xFF2A0A0A), const Color(0xFF1A0505)],
              ),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                  color: won ? AppColors.gold : AppColors.red, width: 2.5),
              boxShadow: [
                BoxShadow(
                    color: (won ? AppColors.gold : AppColors.red).withOpacity(0.4),
                    blurRadius: 32, spreadRadius: 4),
              ],
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(
                won ? '🏆 VICTORY 🏆' : '💀 GAME OVER 💀',
                style: TextStyle(
                  fontSize: 26, fontWeight: FontWeight.bold,
                  color: won ? AppColors.gold : AppColors.red,
                  shadows: [Shadow(
                      color: (won ? AppColors.gold : AppColors.red).withOpacity(0.5),
                      blurRadius: 12)],
                ),
              ).animate().scale(
                  begin: const Offset(0.6, 0.6), curve: Curves.elasticOut).fadeIn(),
              const SizedBox(height: 14),
              Text(message,
                  style: const TextStyle(fontSize: 16, color: Colors.white),
                  textAlign: TextAlign.center),
              const SizedBox(height: 24),
              Row(mainAxisSize: MainAxisSize.min, children: [
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: won ? AppColors.gold : Colors.white24,
                    foregroundColor: won ? Colors.black : Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20)),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 12),
                  ),
                  onPressed: _doExit,
                  icon: const Icon(Icons.home),
                  label: const Text('Back to Lobby',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                ),
                if (widget.demo) ...[
                  const SizedBox(width: 12),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1E6B1E),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20)),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 12),
                    ),
                    onPressed: () {
                      _resultNotifier.value = null;
                      _practice?.startHand();
                    },
                    icon: const Icon(Icons.replay),
                    label: const Text('Play Again',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ],
              ]),
            ]),
          ),
        ),
      ]),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SHARED SMALL WIDGETS
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildCard(String value, String suit) {
    final isRed   = suit == 'H' || suit == 'D';
    final color   = isRed ? AppColors.red : const Color(0xFF1A1A2A);
    final symbol  = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
    return Container(
      width: 60, height: 86,
      margin: const EdgeInsets.symmetric(horizontal: 3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(9),
        boxShadow: const [
          BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))
        ],
      ),
      child: Stack(children: [
        Positioned(top: 4, left: 5,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value,
                style: TextStyle(
                    fontSize: 14, fontWeight: FontWeight.bold, color: color)),
            Text(symbol, style: TextStyle(fontSize: 12, color: color)),
          ])),
        Center(child: Text(symbol,
            style: TextStyle(fontSize: 26, color: color.withOpacity(0.12)))),
        Positioned(bottom: 4, right: 5,
          child: Transform.rotate(
            angle: math.pi,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value,
                  style: TextStyle(
                      fontSize: 14, fontWeight: FontWeight.bold, color: color)),
              Text(symbol, style: TextStyle(fontSize: 12, color: color)),
            ]),
          )),
      ]),
    );
  }

  Widget _buildCardBack() => Container(
        width: 60, height: 86,
        margin: const EdgeInsets.symmetric(horizontal: 3),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(9),
          image: const DecorationImage(
              image: AssetImage('assets/images/card_back.png'),
              fit: BoxFit.cover),
          boxShadow: const [
            BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))
          ],
        ),
      );

  Widget _opponentCardBacks() => SizedBox(
        width: 52, height: 30,
        child: Stack(
          alignment: Alignment.center,
          children: List.generate(3, (i) => Transform.translate(
            offset: Offset((i - 1) * 7.0, 0),
            child: Transform.rotate(
              angle: (i - 1) * 0.22,
              child: Container(
                width: 18, height: 25,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(3),
                  image: const DecorationImage(
                      image: AssetImage('assets/images/card_back.png'),
                      fit: BoxFit.cover),
                  boxShadow: const [
                    BoxShadow(color: Colors.black54, blurRadius: 2,
                        offset: Offset(0, 1))
                  ],
                ),
              ),
            ),
          )),
        ),
      );

  (String, Color) _statusOf(Map<String, dynamic> p) {
    if (p['status'] == 'folded') return ('Pack', AppColors.red);
    if (p['is_seen'] == false)   return ('Blind', Colors.orange.shade700);
    return ('Chaal', AppColors.green);
  }

  Widget _statusPill(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white24),
        ),
        child: Text(label,
            style: const TextStyle(
                color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold,
                letterSpacing: 0.5)),
      );

  Widget _iconBtn(IconData icon, VoidCallback onTap, {double size = 36}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          width: size, height: size,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topCenter, end: Alignment.bottomCenter,
              colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)],
            ),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white38, width: 1),
            boxShadow: [
              BoxShadow(
                  color: AppColors.gold.withOpacity(0.4), blurRadius: 8,
                  spreadRadius: 1),
              const BoxShadow(color: Colors.black54, blurRadius: 4,
                  offset: Offset(0, 2)),
            ],
          ),
          child: Icon(icon, color: Colors.white, size: size * 0.50),
        ),
      );

  Widget _actionBtn(String label, Color color, VoidCallback onTap,
          {double width = 100}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          width: width, height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter, end: Alignment.bottomCenter,
              colors: [
                Color.lerp(color, Colors.white, 0.22)!,
                color,
                Color.lerp(color, Colors.black, 0.22)!,
              ],
            ),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white24),
            boxShadow: [
              BoxShadow(color: color.withOpacity(0.5), blurRadius: 12, spreadRadius: 1),
              const BoxShadow(color: Colors.black38, blurRadius: 4,
                  offset: Offset(0, 2)),
            ],
          ),
          child: Text(label,
              style: const TextStyle(
                  color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13,
                  shadows: [Shadow(color: Colors.black38, blurRadius: 2)])),
        ),
      );

  Widget _stepperBtn(String label, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 40, height: 40, alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topCenter, end: Alignment.bottomCenter,
              colors: [Color(0xFF5B6470), Color(0xFF323844)],
            ),
            border: Border.all(
                color: AppColors.gold.withOpacity(0.6), width: 1.5),
            shape: BoxShape.circle,
            boxShadow: const [
              BoxShadow(color: Colors.black54, blurRadius: 4, offset: Offset(0, 2))
            ],
          ),
          child: Text(label,
              style: const TextStyle(
                  color: Colors.white, fontSize: 22,
                  fontWeight: FontWeight.bold, height: 1.1)),
        ),
      );
}

// ── Data ──────────────────────────────────────────────────────────────────────
class _ChatMsg {
  final String userId, username, text, type;
  _ChatMsg(
      {required this.userId, required this.username, required this.text,
      required this.type});
}

class _Reaction {
  final int    id;
  final String userId, emoji;
  final bool   isGift;
  _Reaction(
      {required this.id, required this.userId, required this.emoji,
      this.isGift = false});
}

// ── Reaction bubble ───────────────────────────────────────────────────────────
class _ReactionBubble extends StatefulWidget {
  final String emoji;
  final bool isGift;
  const _ReactionBubble({required this.emoji, this.isGift = false});
  @override
  State<_ReactionBubble> createState() => _ReactionBubbleState();
}

class _ReactionBubbleState extends State<_ReactionBubble>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: 2400.ms)..forward();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _c,
    builder: (_, __) {
      final t = _c.value;
      return Transform.translate(
        offset: Offset(math.sin(t * math.pi * 2) * 6, -50 * t),
        child: Opacity(
          opacity: (1 - t).clamp(0.0, 1.0),
          child: Transform.scale(
            scale: widget.isGift ? 1.0 + t * 0.5 : 1.0,
            child: Text(widget.emoji, style: const TextStyle(fontSize: 28)),
          ),
        ),
      );
    },
  );
}

// ── Thinking dots ─────────────────────────────────────────────────────────────
class _ThinkingDots extends StatefulWidget {
  const _ThinkingDots();
  @override
  State<_ThinkingDots> createState() => _ThinkingDotsState();
}

class _ThinkingDotsState extends State<_ThinkingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: 1200.ms)..repeat();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: List.generate(3, (i) => AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        final t = (_c.value - i * 0.2).clamp(0.0, 1.0);
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 1.5),
          width: 5, height: 5,
          transform: Matrix4.translationValues(0, -math.sin(t * math.pi) * 4, 0),
          decoration: const BoxDecoration(
              color: AppColors.gold, shape: BoxShape.circle),
        );
      },
    )),
  );
}

// ── Dealer hostess ────────────────────────────────────────────────────────────
class _HostessWidget extends StatefulWidget {
  const _HostessWidget();
  @override
  State<_HostessWidget> createState() => _HostessWidgetState();
}

class _HostessWidgetState extends State<_HostessWidget>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: 1400.ms)..repeat(reverse: true);
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 80,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 68, height: 68,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                    color: AppColors.gold.withOpacity(0.38),
                    blurRadius: 22, spreadRadius: 6),
              ],
            ),
            child: Stack(alignment: Alignment.center, children: [
              Container(
                width: 64, height: 64,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    begin: Alignment.topCenter, end: Alignment.bottomCenter,
                    colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)],
                  ),
                ),
              ),
              Container(
                width: 56, height: 56,
                decoration: const BoxDecoration(
                    shape: BoxShape.circle, color: Color(0xFF0E1830)),
                clipBehavior: Clip.antiAlias,
                child: Image.asset('assets/images/dealer_avatar.png',
                    fit: BoxFit.cover),
              ),
            ]),
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: [Color(0xFFB11226), Color(0xFF7A0C1A)]),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                  color: AppColors.gold.withOpacity(0.8), width: 1),
            ),
            child: const Text('🎁 DEALER',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1)),
          ),
        ]),
      ).animate(controller: _c)
       .moveY(begin: 0, end: -6, duration: 1400.ms, curve: Curves.easeInOut);
}
