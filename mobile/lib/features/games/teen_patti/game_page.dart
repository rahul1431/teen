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

  // ── Responsive layout ────────────────────────────────────────────────────
  // All visual dimensions derive from _ls (layout scale), computed each build
  // from the landscape screen height so the game looks good on every device.
  // Reference height = 400 logical px (typical mid-range phone landscape).
  double _ls = 1.0; // set at top of LayoutBuilder, read by all helpers

  static const _rightPanelW = 64.0;

  // Seat positions: (fractionX, fractionY) relative to TABLE oval.
  // Side seats kept at fx≥0.16 / fx≤0.84 so they stay clear of oval corners
  // at all screen sizes.
  static const _tableSeats = {
    1: [(0.50, 0.18)],
    2: [(0.24, 0.12), (0.76, 0.12)],
    3: [(0.18, 0.46), (0.50, 0.11), (0.82, 0.46)],
    4: [(0.18, 0.44), (0.36, 0.11), (0.64, 0.11), (0.82, 0.44)],
    5: [(0.18, 0.44), (0.30, 0.11), (0.50, 0.09), (0.70, 0.11), (0.82, 0.44)],
  };

  // Derived seat dimensions (updated via _ls in build)
  double get _seatW   => (100 * _ls).clamp(68, 118);
  double get _seatCH  => (118 * _ls).clamp(82, 138); // container height
  double get _cardBH  => (32  * _ls).clamp(24, 40);  // card-backs row height
  double get _totalSH => _cardBH + 4 + _seatCH;      // total seat widget height
  double get _cardW   => (58  * _ls).clamp(40, 76);  // player card width
  double get _cardHt  => (84  * _ls).clamp(58, 110); // player card height

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
  double  _myBalance   = 0;   // fetched from wallet API and kept live
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
    final idx  = ((gs['current_turn'] ?? 0) as num).toInt();
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

  Future<void> _fetchBalance() async {
    try {
      final res = await _api.dio.get('/api/wallet/balance');
      if (!mounted) return;
      final val = double.tryParse(
              res.data['real_balance']?.toString() ?? '0') ??
          0;
      setState(() => _myBalance = val);
    } catch (_) { /* leave at 0 if wallet unreachable */ }
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();
    _loadConfig();      // fire-and-forget
    _fetchBalance();    // load wallet balance for the action bar display
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
      final idx      = ((inner['current_turn'] ?? inner['CurrentTurn'] ?? 0) as num).toInt();
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
      // Refresh wallet balance after settlement completes on the server.
      Timer(const Duration(milliseconds: 1200), _fetchBalance);
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

    // Optimistically deduct bet from displayed balance so it updates immediately.
    // 'see' (look at cards) has no wallet cost — only call/raise/show deduct.
    // Server confirms via wallet lock; we re-fetch on game:result for the final value.
    if (action == 'call' || action == 'raise' || action == 'show') {
      final gs    = _gsNotifier.value;
      final stake = (gs?['min_bet'] as num?)?.toDouble() ?? 0;
      final bet   = amount ?? (_isSeen ? stake * 2 : stake);
      if (bet > 0) setState(() => _myBalance = (_myBalance - bet).clamp(0, double.infinity));
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
          top: true,
          bottom: true,
          child: !_ready
              ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
              : LayoutBuilder(builder: (context, box) {
                  final w = box.maxWidth;
                  final h = box.maxHeight;
                  // Landscape layout — all dims scale from landscape height.
                  _ls = (h / 400.0).clamp(0.72, 1.5);
                  final topBarH = (40 * _ls).clamp(36.0, 52.0);
                  const rightPanelW = _rightPanelW;
                  final tw = w - rightPanelW - 2;   // table fills left area
                  final th = h - topBarH - 2;        // fills full height below top bar
                  const tl = 0.0;
                  final tt = topBarH;

                  return Stack(children: [
                    // ① Ambient background
                    _buildBackground(w, h),

                    // ② Poker table oval — explicit coords, no helpers needed
                    _buildTableOval(tl, tt, tw, th),

                    // ③ Opponent seats
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

                    // ⑥ Pot chip — upper-centre of table
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) => _buildPotChip(gs, w, tt, tw, th),
                    ),
                    // ⑦ Wallet balance + Blind/Seen pills — above action bar
                    ValueListenableBuilder<bool>(
                      valueListenable: _myTurnNotifier,
                      builder: (_, isMyTurn, __) => isMyTurn
                          ? _buildPlayerStatus(w, h)
                          : const SizedBox.shrink(),
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

  // ② Oval poker table — uses th*0.44 radius so side-seat area stays wide
  Widget _buildTableOval(double tl, double tt, double tw, double th) {
    // Clamp radius to look like a real poker table on all screen sizes.
    // th*0.44 ≈ fully-rounded short ends, th*0.2 ≈ mild rounding on tall table.
    final r = math.min(th * 0.44, tw * 0.22);
    final radius = BorderRadius.circular(r);
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
    final sw = _seatW;
    final sh = _totalSH; // total height: card-backs + gap + container
    // Centre of seat widget in screen pixels, table-relative
    final cx = tl + tw * frac.$1;
    final cy = tt + th * frac.$2;
    // Keep seats well inside the oval — use 8% of table width as minimum inner gap
    // so seats clear the curved corners at all aspect ratios.
    final innerMarginH = math.max(12.0, tw * 0.08);
    final sl = (cx - sw / 2).clamp(tl + innerMarginH, tl + tw - sw - innerMarginH);
    final st = (cy - sh / 2).clamp(tt - 8.0, h - sh - 4.0);

    return Positioned(
      key: ValueKey('seat_${p['user_id'] ?? p['userId']}'),
      left: sl, top: st, width: sw,
      child: RepaintBoundary(child: _buildSeatWidget(p, gs, sw)),
    );
  }

  Widget _buildSeatWidget(Map<String, dynamic> p, Map<String, dynamic>? gs, double sw) {
    final uid      = (p['user_id'] ?? p['userId'])?.toString() ?? '';
    final isFolded = p['status'] == 'folded';
    final isBot    = p['is_bot'] == true;
    final players  = (gs?['players'] as List?) ?? [];
    final turnIdx  = ((gs?['current_turn'] ?? gs?['CurrentTurn'] ?? -1) as num).toInt();
    final turnUid  = gs?['current_turn_user_id'] ??
        (turnIdx >= 0 && turnIdx < players.length
            ? (players[turnIdx] as Map)['user_id'] ?? (players[turnIdx] as Map)['userId']
            : null);
    final isTurn   = turnUid == uid;
    final isDealer = gs?['dealer_id'] == uid;
    final (statusLabel, statusColor) = _statusOf(p);
    final chips    = _chipsOf(p);

    // Scale-aware dimensions
    final avatarD  = (44 * _ls).clamp(32.0, 54.0);
    final avatarR  = avatarD * 0.5;
    final badgeD   = (16 * _ls).clamp(12.0, 20.0);
    final fUsername = (9.5 * _ls).clamp(7.5, 12.0);
    final fChips    = (7.5 * _ls).clamp(6.0, 10.0);
    final padH     = (7 * _ls).clamp(5.0, 10.0);
    final padV     = (5 * _ls).clamp(4.0, 8.0);
    final brCorner = (12 * _ls).clamp(8.0, 16.0);

    return Opacity(
      opacity: isFolded ? 0.45 : 1.0,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Mini card-backs fan above seat container
          if (!isFolded) _opponentCardBacks(),
          SizedBox(height: (4 * _ls).clamp(2, 6)),
          // Dark seat container
          Container(
            width: sw,
            padding: EdgeInsets.symmetric(horizontal: padH, vertical: padV),
            decoration: BoxDecoration(
              color: const Color(0xFF0D2E18).withOpacity(0.88),
              borderRadius: BorderRadius.circular(brCorner),
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
                  width: avatarD, height: avatarD,
                  child: Stack(alignment: Alignment.center, children: [
                    if (isTurn)
                      ValueListenableBuilder<int>(
                        valueListenable: _timerNotifier,
                        builder: (_, secs, __) => SizedBox(
                          width: avatarD - 2, height: avatarD - 2,
                          child: CircularProgressIndicator(
                            value: (secs / 30).clamp(0.0, 1.0),
                            strokeWidth: 2.0,
                            backgroundColor: Colors.black26,
                            valueColor: AlwaysStoppedAnimation(
                                secs <= 5 ? Colors.red : const Color(0xFF2ECC71)),
                          ),
                        ),
                      )
                    else
                      SizedBox(
                        width: avatarD - 2, height: avatarD - 2,
                        child: CircularProgressIndicator(
                          value: 1.0,
                          strokeWidth: 2.0,
                          backgroundColor: Colors.black26,
                          valueColor: AlwaysStoppedAnimation(
                              const Color(0xFFD4AF37).withOpacity(0.4)),
                        ),
                      ),
                    CircleAvatar(
                      radius: avatarR * 0.72,
                      backgroundColor: isFolded ? Colors.grey.shade800 : Colors.white24,
                      child: Text(
                        (p['username']?.toString() ?? '?')[0].toUpperCase(),
                        style: TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold,
                            fontSize: (13 * _ls).clamp(9, 17)),
                      ),
                    ),
                    // Dealer chip — small "D" at bottom-right of avatar, not overlapping
                    if (isDealer)
                      Positioned(
                        right: 0, bottom: 0,
                        child: Container(
                          width: badgeD, height: badgeD, alignment: Alignment.center,
                          decoration: BoxDecoration(
                              color: AppColors.gold, shape: BoxShape.circle,
                              border: Border.all(color: Colors.black45, width: 1.0)),
                          child: Text('D',
                              style: TextStyle(color: Colors.black,
                                  fontSize: (8 * _ls).clamp(6, 11),
                                  fontWeight: FontWeight.bold)),
                        ),
                      ),
                    if (isBot && isTurn)
                      Positioned(
                        top: -32,
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
                SizedBox(height: (3 * _ls).clamp(2, 5)),
                Text(
                  p['username']?.toString() ?? 'Bot',
                  style: TextStyle(color: Colors.white, fontSize: fUsername,
                      fontWeight: FontWeight.w600),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
                SizedBox(height: (2 * _ls).clamp(1, 4)),
                _statusPill(statusLabel, statusColor, scale: _ls),
                if (chips != null) ...[
                  SizedBox(height: (2 * _ls).clamp(1, 4)),
                  Container(
                    padding: EdgeInsets.symmetric(
                        horizontal: (5 * _ls).clamp(3, 8),
                        vertical: (1 * _ls).clamp(1, 2)),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                          begin: Alignment.topCenter, end: Alignment.bottomCenter),
                      borderRadius: BorderRadius.circular(5),
                    ),
                    child: Text('💰 $chips',
                        style: TextStyle(color: Colors.black, fontSize: fChips,
                            fontWeight: FontWeight.bold)),
                  ),
                ],
                if (isBot) ...[
                  SizedBox(height: (2 * _ls).clamp(1, 4)),
                  Text('BOT',
                      style: TextStyle(color: Colors.orange,
                          fontSize: (7 * _ls).clamp(5.5, 9),
                          fontWeight: FontWeight.bold)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ⑤ User's cards — anchored above action bar; "See Cards" overlays the backs
  Widget _buildUserCards(
      List<Map<String, dynamic>> cards, bool isMyTurn,
      double w, double tl, double tt, double tw, double th) {
    if (cards.isEmpty) return const SizedBox.shrink();

    // Action bar height estimate (scales with _ls, consistent with _buildActionBar)
    final actionBarH = (60 * _ls).clamp(50.0, 80.0);
    // 12dp breathing room above the action bar
    final cardsBottom = tt + th - actionBarH - 12;
    final cardsTop    = cardsBottom - _cardHt;

    // Row of 3 cards — slight fan overlap
    final cardStep = _cardW * 0.88;
    final rowWidth = cards.length * cardStep + (_cardW * 0.12);
    final rowLeft  = (w - _rightPanelW) / 2 - rowWidth / 2;

    return Stack(children: [
      Positioned(
        top: cardsTop, left: rowLeft,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            // Card row
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < cards.length; i++)
                  _buildAnimatedCard(cards[i], i, cards.length),
              ],
            ),
            // "See Cards" overlay — sits ON TOP of the card backs when blind
            if (!_isSeen)
              Positioned.fill(
                child: GestureDetector(
                  onTap: () {
                    _sendAction('see');
                    setState(() => _isSeen = true);
                    _fetchBalance(); // deduct entry fee reflected after seeing
                  },
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.55),
                      borderRadius: BorderRadius.circular((8 * _ls).clamp(6, 12)),
                    ),
                    alignment: Alignment.center,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.visibility_rounded,
                            color: AppColors.gold,
                            size: (18 * _ls).clamp(14, 24)),
                        SizedBox(height: (2 * _ls).clamp(1, 4)),
                        Text('See Cards',
                            style: TextStyle(
                                color: AppColors.gold,
                                fontWeight: FontWeight.bold,
                                fontSize: (10 * _ls).clamp(8, 14),
                                shadows: const [Shadow(color: Colors.black54, blurRadius: 4)])),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    ]);
  }

  Widget _buildAnimatedCard(Map<String, dynamic> card, int index, int total) {
    final dropDist = (_cardHt * 0.7).clamp(30.0, 60.0);
    final fanAngle = (index - (total - 1) / 2) * 0.10;
    return TweenAnimationBuilder<double>(
      key: ValueKey('${card['value']}_${card['suit']}_$index'),
      tween: Tween(begin: 0.0, end: 1.0),
      duration: Duration(milliseconds: 340 + index * 70),
      curve: Curves.easeOutBack,
      builder: (_, t, __) => Transform.translate(
        offset: Offset(0, -dropDist * (1 - t)),
        child: Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.rotate(
            angle: fanAngle,
            child: _isSeen
                ? _buildCard(card['value'].toString(), card['suit'].toString())
                : _buildCardBack(),
          ),
        ),
      ),
    );
  }

  // ⑥ Pot chip — upper centre, guaranteed above the player cards zone
  Widget _buildPotChip(Map<String, dynamic>? gs, double w, double tt, double tw, double th) {
    final chipW  = (100 * _ls).clamp(68.0, 120.0);
    final chipH  = (30  * _ls).clamp(24.0, 40.0);
    final actionBarH = (60 * _ls).clamp(50.0, 80.0);
    // Player cards zone top = th - actionBarH - 12 - _cardHt (from tt)
    final cardsZoneTop = th - actionBarH - 12 - _cardHt;
    // Pot chip sits at 36% of table height, but never within 20dp of cards
    final potY = math.min(th * 0.36, cardsZoneTop - chipH - 20);
    return Positioned(
      left: w / 2 - chipW / 2, top: tt + potY,
      child: Container(
        width: chipW,
        padding: EdgeInsets.symmetric(
            horizontal: (10 * _ls).clamp(7, 14),
            vertical: (5 * _ls).clamp(3, 8)),
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
          Text('🪙 ', style: TextStyle(fontSize: (13 * _ls).clamp(10, 18))),
          Text('₹${gs?['pot'] ?? 0}',
              style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold,
                  fontSize: (14 * _ls).clamp(11, 18))),
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
    return Positioned(
      left: 0, right: _rightPanelW, bottom: 12,
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

  // ⑧ Top bar — back · table name · turn timer · sound toggle
  Widget _buildTopBar(double w) {
    return Positioned(
      top: 0, left: 0, right: _rightPanelW,
      height: (40 * _ls).clamp(36.0, 52.0),
      child: RepaintBoundary(
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          // Back
          _iconBtn(Icons.arrow_back_ios_new_rounded, _confirmExit, size: 38),
          const SizedBox(width: 6),
          // Table label
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
                color: Colors.black54, borderRadius: BorderRadius.circular(20)),
            child: Text(
              'Table ${widget.roomId.substring(0, math.min(4, widget.roomId.length))}',
              style: TextStyle(color: Colors.white70,
                  fontSize: (11 * _ls).clamp(9.0, 14.0)),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          // Turn timer pill
          ValueListenableBuilder<bool>(
            valueListenable: _myTurnNotifier,
            builder: (_, isMyTurn, __) => isMyTurn
                ? ValueListenableBuilder<int>(
                    valueListenable: _timerNotifier,
                    builder: (_, secs, __) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                      decoration: BoxDecoration(
                        color: secs <= 5 ? AppColors.red : const Color(0xFF8B0F1E),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text('Your turn • ${secs}s',
                          style: TextStyle(color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: (11 * _ls).clamp(9.0, 14.0))),
                    ))
                : const SizedBox.shrink(),
          ),
          const Spacer(),
          // Sound toggle (functional)
          _iconBtn(
            SoundService.instance.muted ? Icons.volume_off_rounded : Icons.volume_up_rounded,
            () => setState(() => SoundService.instance.toggleMute()),
          ),
          const SizedBox(width: 4),
          // Info — shows table details
          _iconBtn(Icons.info_outline_rounded, _showTableInfo),
        ]),
      ),
    );
  }

  void _showTableInfo() {
    final gs = _gsNotifier.value;
    final pot   = gs?['pot'] ?? 0;
    final stake = gs?['min_bet'] ?? 0;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0D2E18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Table Info',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _infoLine('Table ID', widget.roomId),
            _infoLine('Stake', '₹$stake'),
            _infoLine('Pot', '₹$pot'),
            _infoLine('Players', '${(gs?['players'] as List?)?.length ?? 0}'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close', style: TextStyle(color: AppColors.gold)),
          ),
        ],
      ),
    );
  }

  Widget _infoLine(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(children: [
      Text('$label: ', style: const TextStyle(color: Colors.white54, fontSize: 13)),
      Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
    ]),
  );

  // ⑨ Right panel — gift button + scrollable emoji list
  Widget _buildRightPanel(double w, double h, double tt) {
    return Positioned(
      right: 0, top: 0, bottom: 0, width: _rightPanelW,
      child: RepaintBoundary(
        child: Container(
          decoration: const BoxDecoration(
            color: Color(0xFF050C1A),
            border: Border(left: BorderSide(color: Colors.white10)),
          ),
          child: Column(
            children: [
              // Gift button — fixed at top
              const SizedBox(height: 8),
              GestureDetector(
                onTap: () => setState(() { _showGiftTray = !_showGiftTray; }),
                child: Container(
                  width: 38, height: 38,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                      begin: Alignment.topLeft, end: Alignment.bottomRight,
                    ),
                    boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.4),
                        blurRadius: 8, spreadRadius: 1)],
                  ),
                  child: const Icon(Icons.card_giftcard, color: Colors.black, size: 20),
                ),
              ),
              const SizedBox(height: 6),
              Container(height: 1, color: Colors.white10,
                  margin: const EdgeInsets.symmetric(horizontal: 8)),
              const SizedBox(height: 4),
              // Scrollable emoji list — shows all emojis, user can scroll
              Expanded(
                child: ScrollConfiguration(
                  behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false),
                  child: SingleChildScrollView(
                    physics: const BouncingScrollPhysics(),
                    child: Column(
                      children: _quickEmojis.map((e) => GestureDetector(
                        onTap: () => _sendEmoji(e),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Text(e, style: const TextStyle(fontSize: 24)),
                        ),
                      )).toList(),
                    ),
                  ),
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
    final tableW = w - _rightPanelW;
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
      top: 44, left: 8, right: _rightPanelW,
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
      left: 0, right: _rightPanelW, bottom: 0,
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
              final bet = rawBet.clamp(minBet, maxBet);
              _betAmount = bet;
              final label = bet > minBet
                  ? 'Raise ₹${bet.toInt()}'
                  : 'Chaal ₹${bet.toInt()}';
              final btnPack    = (86  * _ls).clamp(62.0,  110.0);
              final btnMain    = (114 * _ls).clamp(88.0,  140.0);
              final btnSecond  = (72  * _ls).clamp(54.0,  90.0);
              final gap        = (8   * _ls).clamp(5.0,   12.0);
              return Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _actionBtn('Pack', AppColors.red, () => _sendAction('fold'), width: btnPack),
                  SizedBox(width: gap),
                  // Sideshow — seen player can challenge the previous seen player
                  if (_isSeen && activeCount > 2) ...[
                    _actionBtn('Sideshow', Colors.indigo, () => _sendAction('sideshow'), width: btnSecond),
                    SizedBox(width: gap),
                  ],
                  // Show — final showdown when only 2 players remain
                  if (activeCount == 2) ...[
                    _actionBtn('Show', Colors.deepPurple, () => _sendAction('show'), width: btnSecond),
                    SizedBox(width: gap),
                  ],
                  _stepperBtn('−', () {
                    _betNotifier.value = (bet - stake).clamp(minBet, maxBet);
                    HapticFeedback.selectionClick();
                  }),
                  SizedBox(width: gap),
                  _actionBtn(label, AppColors.green,
                      () => _sendAction(bet > minBet ? 'raise' : 'call', amount: bet),
                      width: btnMain),
                  SizedBox(width: gap),
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

  // Balance + Blind/Seen pills — pinned just above the action bar, inside table
  Widget _buildPlayerStatus(double w, double h) {
    final actionBarH = (60 * _ls).clamp(50.0, 80.0);
    final bottomY    = h - actionBarH - 6;
    return Positioned(
      left: 10, right: _rightPanelW + 10, bottom: h - bottomY,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Wallet balance — loaded from API
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.72),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.gold.withOpacity(0.6)),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Text('💰', style: TextStyle(fontSize: 13)),
              const SizedBox(width: 5),
              Text('₹${_myBalance.toInt()}',
                  style: TextStyle(
                      color: AppColors.gold,
                      fontWeight: FontWeight.bold,
                      fontSize: (12 * _ls).clamp(10.0, 15.0))),
            ]),
          ),
          // Blind / Seen badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: _isSeen
                  ? Colors.deepPurple.withOpacity(0.85)
                  : Colors.orange.withOpacity(0.85),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                  color: _isSeen ? Colors.purple.shade200 : Colors.orange.shade200,
                  width: 1.0),
            ),
            child: Text(
              _isSeen ? 'SEEN' : 'BLIND',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: (11 * _ls).clamp(9.0, 14.0)),
            ),
          ),
        ],
      ),
    );
  }

  // ⑬ Gift tray — scrollable so all gifts are reachable on any screen size
  Widget _buildGiftTray(double w, double h) {
    final maxH = (h * 0.70).clamp(180.0, 420.0);
    return Positioned(
      right: _rightPanelW + 8,
      top: h * 0.14,
      child: GestureDetector(
        onTap: () {}, // absorb taps so table doesn't close tray
        child: Container(
          width: 200,
          constraints: BoxConstraints(maxHeight: maxH),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.92),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.gold.withOpacity(0.5))),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Text('Send a Gift',
                    style: TextStyle(
                        color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
                const Spacer(),
                GestureDetector(
                  onTap: () => setState(() => _showGiftTray = false),
                  child: const Icon(Icons.close, color: Colors.white54, size: 18),
                ),
              ]),
              const SizedBox(height: 8),
              Flexible(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  child: Wrap(
                    spacing: 8, runSpacing: 8,
                    children: _gifts.map((g) {
                      final price = double.tryParse(g['price']?.toString() ?? '0') ?? 0;
                      return GestureDetector(
                        onTap: () {
                          _sendGift(g['icon']?.toString() ?? '');
                          setState(() => _showGiftTray = false);
                        },
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                              color: Colors.white10,
                              borderRadius: BorderRadius.circular(10)),
                          child: Column(children: [
                            Text(g['icon']?.toString() ?? '',
                                style: const TextStyle(fontSize: 22)),
                            Text(g['name']?.toString() ?? '',
                                style: const TextStyle(color: Colors.white70, fontSize: 9)),
                            if (price > 0)
                              Text('₹${price.toInt()}',
                                  style: const TextStyle(
                                      color: AppColors.gold, fontSize: 9,
                                      fontWeight: FontWeight.bold)),
                          ]),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

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
    final isRed  = suit == 'H' || suit == 'D';
    final color  = isRed ? AppColors.red : const Color(0xFF1A1A2A);
    final symbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
    final cw = _cardW; final ch = _cardHt;
    final fs1 = (13 * _ls).clamp(9.0, 16.0);
    final fs2 = (11 * _ls).clamp(8.0, 14.0);
    final fsC = (24 * _ls).clamp(16.0, 32.0);
    return Container(
      width: cw, height: ch,
      margin: EdgeInsets.symmetric(horizontal: (3 * _ls).clamp(2, 5)),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular((8 * _ls).clamp(6, 11)),
        boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))],
      ),
      child: Stack(children: [
        Positioned(top: 3, left: 4,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value, style: TextStyle(fontSize: fs1, fontWeight: FontWeight.bold, color: color)),
            Text(symbol, style: TextStyle(fontSize: fs2, color: color)),
          ])),
        Center(child: Text(symbol,
            style: TextStyle(fontSize: fsC, color: color.withOpacity(0.12)))),
        Positioned(bottom: 3, right: 4,
          child: Transform.rotate(angle: math.pi,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value, style: TextStyle(fontSize: fs1, fontWeight: FontWeight.bold, color: color)),
              Text(symbol, style: TextStyle(fontSize: fs2, color: color)),
            ]))),
      ]),
    );
  }

  Widget _buildCardBack() => Container(
        width: _cardW, height: _cardHt,
        margin: EdgeInsets.symmetric(horizontal: (3 * _ls).clamp(2, 5)),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular((8 * _ls).clamp(6, 11)),
          image: const DecorationImage(
              image: AssetImage('assets/images/card_back.png'), fit: BoxFit.cover),
          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))],
        ),
      );

  // Mini fan of 3 card backs shown above opponent seat containers
  Widget _opponentCardBacks() {
    final cw = (17 * _ls).clamp(13.0, 22.0);
    final ch = (24 * _ls).clamp(18.0, 32.0);
    final fanW = (48 * _ls).clamp(36.0, 60.0);
    return SizedBox(
      width: fanW, height: ch + 4,
      child: Stack(alignment: Alignment.center,
        children: List.generate(3, (i) => Transform.translate(
          offset: Offset((i - 1) * (fanW / 7), 0),
          child: Transform.rotate(
            angle: (i - 1) * 0.20,
            child: Container(
              width: cw, height: ch,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular((3 * _ls).clamp(2, 5)),
                image: const DecorationImage(
                    image: AssetImage('assets/images/card_back.png'), fit: BoxFit.cover),
                boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 2, offset: Offset(0, 1))],
              ),
            ),
          ),
        )),
      ),
    );
  }

  (String, Color) _statusOf(Map<String, dynamic> p) {
    if (p['status'] == 'folded') return ('Pack', AppColors.red);
    if (p['is_seen'] == false)   return ('Blind', Colors.orange.shade700);
    return ('Chaal', AppColors.green);
  }

  Widget _statusPill(String label, Color color, {double scale = 1.0}) {
    final s = scale;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: (7 * s).clamp(5, 10), vertical: (2 * s).clamp(1, 3)),
      decoration: BoxDecoration(
        color: color, borderRadius: BorderRadius.circular(9),
        border: Border.all(color: Colors.white24),
      ),
      child: Text(label,
          style: TextStyle(color: Colors.white, fontSize: (8.5 * s).clamp(7, 11),
              fontWeight: FontWeight.bold, letterSpacing: 0.4)),
    );
  }

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
          width: width, height: (44 * _ls).clamp(36.0, 54.0),
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
            borderRadius: BorderRadius.circular((13 * _ls).clamp(10, 18)),
            border: Border.all(color: Colors.white24),
            boxShadow: [
              BoxShadow(color: color.withOpacity(0.5), blurRadius: 12, spreadRadius: 1),
              const BoxShadow(color: Colors.black38, blurRadius: 4, offset: Offset(0, 2)),
            ],
          ),
          child: Text(label,
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold,
                  fontSize: (12.5 * _ls).clamp(10.0, 16.0),
                  shadows: const [Shadow(color: Colors.black38, blurRadius: 2)])),
        ),
      );

  Widget _stepperBtn(String label, VoidCallback onTap) {
    final d = (40 * _ls).clamp(32.0, 50.0);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: d, height: d, alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topCenter, end: Alignment.bottomCenter,
            colors: [Color(0xFF5B6470), Color(0xFF323844)],
          ),
          border: Border.all(color: AppColors.gold.withOpacity(0.6), width: 1.5),
          shape: BoxShape.circle,
          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 4, offset: Offset(0, 2))],
        ),
        child: Text(label,
            style: TextStyle(color: Colors.white,
                fontSize: (21 * _ls).clamp(16.0, 26.0),
                fontWeight: FontWeight.bold, height: 1.1)),
      ),
    );
  }
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
