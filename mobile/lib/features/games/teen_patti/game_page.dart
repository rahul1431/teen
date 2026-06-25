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

/// Landscape Teen Patti table with live chat, emoji reactions and gifts.
class TeenPattiGamePage extends StatefulWidget {
  final String roomId;
  final bool demo;
  final Map<String, dynamic>? initialData;
  const TeenPattiGamePage({super.key, required this.roomId, this.demo = false, this.initialData});
  @override
  State<TeenPattiGamePage> createState() => _TeenPattiGamePageState();
}

class _TeenPattiGamePageState extends State<TeenPattiGamePage> {
  final _socket = SocketService();
  PracticeEngine? _practice; // offline bot game (demo / Practice mode)
  Map<String, dynamic>? _gameState;
  String? _myUserId;
  bool _isMyTurn = false;
  int _turnSeq = 0;
  int _turnSecondsLeft = 30;
  Timer? _turnTimer;
  bool _isSeen = false;
  String? _resultMessage;
  /// Current chaal/raise amount the user is about to commit. Stepped by stake.
  double _betAmount = 0;
  StreamSubscription? _reconnectSub;

  // Social
  bool _showChat = false;
  bool _showGiftTray = false;
  final _chatInput = TextEditingController();
  final List<_ChatMsg> _chat = [];
  final List<_Reaction> _reactions = [];
  int _reactionId = 0;

  static const _quickEmojis = ['😀', '😂', '😎', '😮', '😭', '🔥', '👏', '🤔'];
  static const _gifts = [
    {'icon': '🌹', 'name': 'Rose'},
    {'icon': '🎁', 'name': 'Gift'},
    {'icon': '💎', 'name': 'Diamond'},
    {'icon': '🍺', 'name': 'Beer'},
    {'icon': '👑', 'name': 'Crown'},
    {'icon': '💣', 'name': 'Bomb'},
  ];

  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    if (widget.demo) {
      _initDemo();
    } else {
      _init();
    }
  }

  // Practice mode: a real offline Teen Patti game vs 3 bots (no socket/backend).
  void _initDemo() {
    _myUserId = 'me';
    _isSeen = true;
    _practice = PracticeEngine(
      onChanged: () {
        if (!mounted) return;
        setState(() {
          _gameState = _practice!.state;
          _isMyTurn = _practice!.isMyTurn;
          // A live hand always hides any lingering result banner.
          if (!_practice!.handOver) _resultMessage = null;
        });
        if (_isMyTurn) {
          _startTurnTimer();
        } else {
          _turnTimer?.cancel();
        }
      },
      onResult: (msg, won) {
        if (!mounted) return;
        _turnTimer?.cancel();
        setState(() {
          _resultMessage = msg;
          _isMyTurn = false;
        });
        if (won) {
          HapticFeedback.heavyImpact();
          Timer(const Duration(milliseconds: 140), HapticFeedback.heavyImpact);
          Timer(const Duration(milliseconds: 280), HapticFeedback.heavyImpact);
          SystemSound.play(SystemSoundType.alert);
        } else {
          HapticFeedback.mediumImpact();
        }
      },
      onChat: (uid, name, text) {
        if (!mounted) return;
        setState(() {
          _chat.add(_ChatMsg(userId: uid, username: name, text: text, type: 'text'));
          if (_chat.length > 50) _chat.removeAt(0);
        });
      },
    );
    _chat.add(_ChatMsg(userId: 'b1', username: 'Steven P.', text: 'Good luck! 🍀', type: 'text'));
    // Deal after the first frame — startHand() calls setState via onChanged,
    // which isn't allowed during initState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _practice!.startHand();
    });
  }

  List<Map<String, dynamic>> _myCards = [];

  void _applyRoomJoinedData(Map<String, dynamic> data) {
    if (!mounted) return;
    setState(() {
      final rawCards = data['my_cards'] as List?;
      _myCards = rawCards?.cast<Map<String, dynamic>>() ?? [];
      final rawState = data['state'] as Map<String, dynamic>? ?? data;

      final List rawPlayers = data['players'] ?? rawState['players'] ?? [];
      final List<Map<String, dynamic>> mappedPlayers = [];
      for (final p in rawPlayers) {
        if (p is Map) {
          final mapped = Map<String, dynamic>.from(p);
          if (mapped['user_id'] == null && mapped['userId'] != null) {
            mapped['user_id'] = mapped['userId'];
          }
          if (mapped['userId'] == null && mapped['user_id'] != null) {
            mapped['userId'] = mapped['user_id'];
          }
          mappedPlayers.add(mapped);
        }
      }

      _gameState = {
        ...rawState,
        'pot': data['pot'] ?? rawState['pot'] ?? 0,
        'min_bet': data['min_bet'] ?? rawState['min_bet'] ?? 0,
        'current_turn': data['current_turn'] ?? rawState['current_turn'] ?? 0,
        'players': mappedPlayers,
      };
      _betAmount = (data['min_bet'] as num?)?.toDouble() ?? 0;
      final idx = (data['current_turn'] ?? 0) as int;
      final players = _gameState!['players'] as List? ?? [];
      final currentPlayer = idx < players.length ? players[idx] : null;
      _isMyTurn = (currentPlayer?['userId'] ?? currentPlayer?['user_id']) == _myUserId;
      if (_isMyTurn) _startTurnTimer();
    });
    SoundService.instance.play(Sfx.cardDeal);
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();
    _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});

    _reconnectSub = _socket.on('reconnect').listen((_) {
      _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});
    });

    if (widget.initialData != null) {
      _applyRoomJoinedData(Map<String, dynamic>.from(widget.initialData!));
    }

    // Server sends room:joined with private cards for this player
    _socket.on(SocketEvents.roomJoined).listen((data) {
      _applyRoomJoinedData(Map<String, dynamic>.from(data));
    });

    _socket.on(SocketEvents.gameStateUpdate).listen((data) {
      if (!mounted) return;
      final innerState = data['state'] as Map<String, dynamic>? ?? data;
      setState(() {
        final List rawPlayers = innerState['players'] ?? [];
        final List<Map<String, dynamic>> mappedPlayers = [];
        for (final p in rawPlayers) {
          if (p is Map) {
            final mapped = Map<String, dynamic>.from(p);
            if (mapped['user_id'] == null && mapped['userId'] != null) {
              mapped['user_id'] = mapped['userId'];
            }
            if (mapped['userId'] == null && mapped['user_id'] != null) {
              mapped['userId'] = mapped['user_id'];
            }
            mappedPlayers.add(mapped);
          }
        }
        _gameState = {
          ...innerState,
          'players': mappedPlayers,
        };
        final idx = (innerState['current_turn'] ?? innerState['CurrentTurn'] ?? 0) as int;
        final currentPlayer = idx < mappedPlayers.length ? mappedPlayers[idx] : null;
        _isMyTurn = (currentPlayer?['userId'] ?? currentPlayer?['user_id']) == _myUserId;
        if (_isMyTurn) _startTurnTimer();
        // Show last action in chat
        final la = data['last_action'] as Map?;
        if (la != null) {
          final actorId = la['user_id']?.toString() ?? '';
          final actor = mappedPlayers.firstWhere(
            (p) => (p['userId'] ?? p['user_id']) == actorId,
            orElse: () => <String, dynamic>{},
          );
          final actorName = actor['username'] ?? 'Player';
          _chat.add(_ChatMsg(userId: actorId, username: actorName, text: '${la['action']?.toString().toUpperCase()}', type: 'text'));
          if (_chat.length > 50) _chat.removeAt(0);
        }
      });
    });

    _socket.on(SocketEvents.gameResult).listen((data) {
      if (!mounted) return;
      _turnTimer?.cancel();
      final won = data['winner_id'] == _myUserId;
      setState(() {
        _resultMessage = won
            ? '🎉 You Won ₹${double.parse(data['prize'].toString()).toStringAsFixed(2)}!'
            : '😔 You Lost. Winner: ${data['winner_username'] ?? 'Unknown'}';
      });
      // Win fanfare = 3 strong taps; loss = single soft buzz
      if (won) {
        HapticFeedback.heavyImpact();
        Timer(const Duration(milliseconds: 140), HapticFeedback.heavyImpact);
        Timer(const Duration(milliseconds: 280), HapticFeedback.heavyImpact);
        SystemSound.play(SystemSoundType.alert);
        SoundService.instance.play(Sfx.win);
      } else {
        HapticFeedback.mediumImpact();
        SoundService.instance.play(Sfx.lose);
      }
    });

    _socket.on(SocketEvents.roomChatMsg).listen((data) {
      if (!mounted || data is! Map) return;
      final type = (data['type'] ?? 'text').toString();
      final msg = _ChatMsg(
        userId: data['user_id']?.toString() ?? '',
        username: data['username']?.toString() ?? 'Player',
        text: data['message']?.toString() ?? '',
        type: type,
      );
      setState(() {
        if (type == 'text') {
          _chat.add(msg);
          if (_chat.length > 50) _chat.removeAt(0);
        } else if (msg.userId != _myUserId) {
          // emoji / gift float over the sender's seat
          // (own reactions are already shown optimistically)
          _spawnReaction(msg.userId, msg.text, isGift: type == 'gift');
        }
      });
    });
  }

  void _startTurnTimer() {
    _turnTimer?.cancel();
    setState(() => _turnSecondsLeft = 30);
    // "your turn" cue: double light tap + click
    HapticFeedback.lightImpact();
    Timer(const Duration(milliseconds: 90), HapticFeedback.lightImpact);
    SystemSound.play(SystemSoundType.click);
    _turnTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() {
        _turnSecondsLeft--;
        // urgent ticks in the last 5 seconds
        if (_turnSecondsLeft > 0 && _turnSecondsLeft <= 5) {
          HapticFeedback.selectionClick();
        }
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
    SoundService.instance.play(action == 'fold' ? Sfx.buttonTap : Sfx.chipBet);
    if (widget.demo) {
      _applyDemoAction(action, amount);
      return;
    }
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': action,
      if (amount != null) 'amount': amount,
      'sequence_num': ++_turnSeq,
    });
    HapticFeedback.mediumImpact();
  }

  /// Practice mode: forward the action to the offline engine, which advances
  /// the bots and re-deals on its own. The engine's onChanged/onResult
  /// callbacks update the table.
  void _applyDemoAction(String action, double? amount) {
    HapticFeedback.mediumImpact();
    _practice?.playerAction(action, amount);
  }

  // ---- Social senders (piggyback on room:chat with a `type`) ----
  void _sendChat(String text) {
    final t = text.trim();
    if (t.isEmpty) return;
    if (widget.demo) {
      setState(() => _chat.add(_ChatMsg(userId: 'me', username: 'You', text: t, type: 'text')));
    } else {
      _socket.emit(SocketEvents.roomChat,
          {'room_id': widget.roomId, 'message': t, 'type': 'text'});
    }
    _chatInput.clear();
  }

  void _sendEmoji(String emoji) {
    _socket.emit(SocketEvents.roomChat,
        {'room_id': widget.roomId, 'message': emoji, 'type': 'emoji'});
    _spawnReaction(_myUserId ?? '', emoji); // optimistic
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
    setState(() => _reactions.add(r));
    Timer(const Duration(milliseconds: 2600), () {
      if (!mounted) return;
      setState(() => _reactions.removeWhere((x) => x.id == r.id));
    });
  }

  String? _chipsOf(Map<String, dynamic> p) {
    final v = p['chips'] ?? p['balance'] ?? p['stack'];
    if (v == null) return null;
    final n = num.tryParse(v.toString());
    return n == null ? null : n.toStringAsFixed(0);
  }

  void _exit() {
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    Navigator.pop(context);
  }

  @override
  void dispose() {
    _reconnectSub?.cancel();
    _turnTimer?.cancel();
    _practice?.dispose();
    _chatInput.dispose();
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvoked: (didPop) {
        if (!didPop) _exit();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF1A1033),
        body: SafeArea(
          child: _resultMessage != null
              ? _buildResult()
              : Stack(
                  children: [
                    _buildFelt(),
                    _buildSeatsAndCenter(),
                    _buildTopBar(),
                    _buildMyHand(),
                    _buildMyChips(),
                    if (_isMyTurn) _buildActionBar(),
                    _buildSocialButtons(),
                    if (_showGiftTray) _buildGiftTray(),
                    if (_showChat) _buildChatPanel(),
                  ],
                ),
        ),
      ),
    );
  }

  // Reference look: navy room, ornate gold-bordered RED felt with watermark
  Widget _buildFelt() => Positioned.fill(
        child: Container(
          // Overhead casino spotlight background room atmosphere
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, -0.2),
              radius: 1.4,
              colors: [
                Color(0xFF1E2D5A), // Bright spotlight center
                Color(0xFF0F1736), // Deep navy
                Color(0xFF060A1A), // Dark shadow corners
              ],
              stops: [0.0, 0.6, 1.0],
            ),
          ),
          child: Center(
            child: FractionallySizedBox(
              widthFactor: 0.88,
              heightFactor: 0.82,
              child: Container(
                // 1. Padded Leather Outer Cushion Rail (3D Table Frame)
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(400),
                  gradient: const RadialGradient(
                    center: Alignment.center,
                    radius: 1.0,
                    colors: [
                      Color(0xFF381F17), // Highlighted wood/leather
                      Color(0xFF1D0E09), // Shadowed wood/leather
                    ],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.7),
                      blurRadius: 28,
                      offset: const Offset(0, 10),
                      spreadRadius: 4,
                    ),
                  ],
                ),
                child: Container(
                  // 2. Shiny Metallic Multi-tier Gold Rim
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(400),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Color(0xFFFFDF7A), // Bright gold
                        Color(0xFFB38F24), // Antique gold
                        Color(0xFFFFDF7A), // Reflective highlights
                        Color(0xFF8C6B12), // Deep brass shadow
                      ],
                      stops: [0.0, 0.35, 0.7, 1.0],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.5),
                        blurRadius: 4,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                  child: Container(
                    // 3. Inner Cushion Deep Shadow
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F0505),
                      borderRadius: BorderRadius.circular(400),
                    ),
                    child: Container(
                      // 4. Premium Felt with Radial Lighting vignette and Watermarks
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(400),
                        gradient: const RadialGradient(
                          center: Alignment.center,
                          radius: 0.85,
                          colors: [
                            Color(0xFFC61A2E), // Bright spotlight felt center
                            Color(0xFF8B0F1E), // Velvet crimson
                            Color(0xFF53050F), // Dark edge felt shadow under rail
                          ],
                          stops: [0.0, 0.65, 1.0],
                        ),
                      ),
                      child: Stack(
                        children: [
                          // 5. Classic Casino Circular Line Marking (Playing Zone)
                          Positioned.fill(
                            child: Container(
                              margin: const EdgeInsets.all(28),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(400),
                                border: Border.all(
                                  color: const Color(0xFFFFD700).withOpacity(0.08),
                                  width: 1.5,
                                ),
                              ),
                            ),
                          ),
                          // 6. Center Branding Crest & Watermark
                          Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  '👑',
                                  style: TextStyle(
                                    fontSize: 32,
                                    color: const Color(0xFFFFD700).withOpacity(0.08),
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'TEEN PATTI',
                                  style: TextStyle(
                                    color: const Color(0xFFFFD700).withOpacity(0.12),
                                    fontSize: 36,
                                    fontWeight: FontWeight.w800,
                                    fontFamily: 'Serif',
                                    letterSpacing: 8,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Container(
                                  width: 80,
                                  height: 1,
                                  color: const Color(0xFFFFD700).withOpacity(0.08),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  Widget _buildSeatsAndCenter() {
    return LayoutBuilder(builder: (context, c) {
      final players = (_gameState?['players'] as List?) ?? [];
      final w = c.maxWidth, h = c.maxHeight;
      final cx = w / 2, cy = h / 2 - 6;
      final rx = w * 0.36, ry = h * 0.33;

      // order players so "me" sits at the bottom-center
      final ordered = List<Map<String, dynamic>>.from(
          players.map((e) => Map<String, dynamic>.from(e as Map)));
      final myIdx = ordered.indexWhere((p) => p['user_id'] == _myUserId);
      if (myIdx > 0) {
        final rotated = [...ordered.sublist(myIdx), ...ordered.sublist(0, myIdx)];
        ordered
          ..clear()
          ..addAll(rotated);
      }
      final n = ordered.isEmpty ? 1 : ordered.length;

      final seats = <Widget>[];
      for (var i = 0; i < ordered.length; i++) {
        // "me" (i==0, bottom-center) is represented by the fanned hand and the
        // action bar — drawing a seat avatar there overlaps both, so skip it.
        if (ordered[i]['user_id'] == _myUserId) continue;
        final theta = (math.pi / 2) + (2 * math.pi * i / n); // i=0 → bottom
        final sx = cx + rx * math.cos(theta);
        final sy = cy + ry * math.sin(theta);
        seats.add(Positioned(
          left: sx - 46,
          top: sy - 40,
          child: _buildPlayerSeat(ordered[i]),
        ));
        // reactions floating above this seat
        for (final r in _reactions.where((x) => x.userId == ordered[i]['user_id'])) {
          seats.add(Positioned(
            left: sx - 16,
            top: sy - 78,
            child: _ReactionBubble(key: ValueKey(r.id), emoji: r.emoji, isGift: r.isGift),
          ));
        }
      }

      // center pot
      seats.add(Positioned(
        left: cx - 70,
        top: cy - 22,
        child: SizedBox(width: 140, child: Center(child: _potChip())),
      ));

      // animated hostess at top-center of the oval
      seats.add(Positioned(
        left: cx - 40,
        top: cy - ry - 82,
        child: _buildHostess(),
      ));

      return Stack(children: seats);
    });
  }

  Widget _potChip() => Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black54,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.gold.withOpacity(0.6)),
        ),
        child: Text('💰 ₹${_gameState?['pot'] ?? 0}',
            style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 14)),
      );

  /// Decorative animated hostess/dealer figure at the top of the oval table.
  Widget _buildHostess() {
    return SizedBox(
      width: 80,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Glow halo behind the figure
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppColors.gold.withOpacity(0.35),
                  blurRadius: 22,
                  spreadRadius: 6,
                ),
              ],
            ),
            alignment: Alignment.center,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // decorative gold ring
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)],
                    ),
                  ),
                ),
                // inner navy circle
                Container(
                  width: 54,
                  height: 54,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(0xFF0E1830),
                  ),
                  alignment: Alignment.center,
                  child: const Text('💃', style: TextStyle(fontSize: 32)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // "DEALER" pill label
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFB11226), Color(0xFF7A0C1A)],
              ),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.gold.withOpacity(0.8), width: 1),
              boxShadow: [
                BoxShadow(color: AppColors.gold.withOpacity(0.3), blurRadius: 6),
              ],
            ),
            child: const Text(
              '🎁 DEALER',
              style: TextStyle(
                color: Colors.white,
                fontSize: 9,
                fontWeight: FontWeight.bold,
                letterSpacing: 1,
              ),
            ),
          ),
        ],
      )
          .animate(onPlay: (c) => c.repeat(reverse: true))
          .moveY(begin: 0, end: -7, duration: 1400.ms, curve: Curves.easeInOut),
    );
  }

  Widget _buildPlayerSeat(Map<String, dynamic> player) {
    final isMe = player['user_id'] == _myUserId;
    final isActive = player['status'] == 'active';
    final isFolded = player['status'] == 'folded';
    final isTurn = _gameState?['current_turn_user_id'] == player['user_id'];
    final isDealer = _gameState?['dealer_id'] == player['user_id'];
    final status = _statusOf(player); // (label, color)
    return Opacity(
      opacity: isFolded ? 0.55 : 1,
      child: Container(
        width: 96,
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        decoration: BoxDecoration(
          color: isMe ? AppColors.gold.withOpacity(0.18) : Colors.black38,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isTurn ? AppColors.green : Colors.white12,
            width: isTurn ? 2.5 : 1,
          ),
          boxShadow: isTurn
              ? [
                  BoxShadow(
                    color: AppColors.green.withOpacity(0.65),
                    blurRadius: 14,
                    spreadRadius: 1,
                  ),
                ]
              : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Fanned card-backs for opponents (own cards are at the bottom)
            if (!isMe) _opponentCardBacks(isFolded),
            // Status pill (Chaal / Pack / Blind) above the avatar
            _statusPill(status.$1, status.$2),
            const SizedBox(height: 3),
            SizedBox(
              width: 54,
              height: 50,
              child: Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.center,
                children: [
                  // ring: green countdown arc on the active turn, gold idle
                  SizedBox(
                    width: 46,
                    height: 46,
                    child: CircularProgressIndicator(
                      value: isTurn ? (_turnSecondsLeft / 30).clamp(0.0, 1.0) : 1.0,
                      strokeWidth: 3,
                      backgroundColor: Colors.black26,
                      valueColor: AlwaysStoppedAnimation(
                          isTurn ? AppColors.green : AppColors.gold.withOpacity(0.6)),
                    ),
                  ),
                  CircleAvatar(
                    radius: 17,
                    backgroundColor: isActive ? (isMe ? AppColors.gold : Colors.white24) : Colors.grey,
                    child: Text(player['username']?[0]?.toUpperCase() ?? '?',
                        style: TextStyle(color: isMe ? Colors.black : Colors.white, fontWeight: FontWeight.bold)),
                  ),
                  if (isTurn)
                    Positioned(
                      bottom: -4,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5),
                        decoration: BoxDecoration(color: AppColors.red, borderRadius: BorderRadius.circular(8)),
                        child: Text('${_turnSecondsLeft}s',
                            style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                      ),
                    ),
                  // Gift badge — top-left of avatar; tap opens the gift tray
                  if (!isMe)
                    Positioned(
                      left: -4,
                      top: -4,
                      child: GestureDetector(
                        onTap: () => setState(() {
                          _showGiftTray = true;
                          _showChat = false;
                        }),
                        child: Container(
                          width: 20,
                          height: 20,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 1),
                            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 3)],
                          ),
                          child: const Text('🎁', style: TextStyle(fontSize: 10)),
                        ),
                      ),
                    ),
                  // Dealer "D" badge — top-right of avatar
                  if (isDealer)
                    Positioned(
                      right: -2,
                      top: -2,
                      child: Container(
                        width: 18,
                        height: 18,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.red,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.5),
                          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 3)],
                        ),
                        child: const Text('D',
                            style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 3),
            Text(isMe ? 'You' : (player['username'] ?? 'Bot'),
                style: const TextStyle(color: Colors.white, fontSize: 11), overflow: TextOverflow.ellipsis),
            if (_chipsOf(player) != null)
              Container(
                margin: const EdgeInsets.only(top: 2),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: Colors.black45,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.gold.withOpacity(0.4)),
                ),
                child: Text('💰 ${_chipsOf(player)}',
                    style: const TextStyle(color: AppColors.goldLight, fontSize: 9, fontWeight: FontWeight.bold)),
              ),
            if (player['is_bot'] == true)
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Text('BOT',
                    style: TextStyle(color: Colors.orange, fontSize: 8, fontWeight: FontWeight.bold)),
              ),
          ],
        ),
      ),
    );
  }

  /// (label, background-colour) for the seat status pill.
  (String, Color) _statusOf(Map<String, dynamic> p) {
    if (p['status'] == 'folded') return ('Pack', AppColors.red);
    if (p['is_seen'] == false) return ('Blind', Colors.orange.shade700);
    return ('Chaal', AppColors.green);
  }

  /// Three small fanned card-backs (blue) for opponents.
  /// Folded players' cards render dimmed.
  Widget _opponentCardBacks(bool folded) {
    return Opacity(
      opacity: folded ? 0.4 : 1,
      child: SizedBox(
        width: 46,
        height: 26,
        child: Stack(
          alignment: Alignment.center,
          children: List.generate(3, (i) {
            final angle = (i - 1) * 0.22; // -0.22, 0, +0.22 rad
            return Transform.translate(
              offset: Offset((i - 1) * 6.0, 0),
              child: Transform.rotate(
                angle: angle,
                child: Container(
                  width: 16,
                  height: 22,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF1E3A8A), Color(0xFF0B1E52)],
                    ),
                    borderRadius: BorderRadius.circular(3),
                    border: Border.all(color: AppColors.gold.withOpacity(0.7), width: 0.8),
                    boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 2, offset: Offset(0, 1))],
                  ),
                  alignment: Alignment.center,
                  child: Text('♠',
                      style: TextStyle(
                          color: AppColors.gold.withOpacity(0.85),
                          fontSize: 11,
                          fontWeight: FontWeight.bold)),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _statusPill(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white.withOpacity(0.3)),
          boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 3, offset: Offset(0, 1))],
        ),
        child: Text(label,
            style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.5)),
      );

  Widget _buildTopBar() => Positioned(
        top: 6,
        left: 8,
        right: 8,
        child: Row(
          children: [
            _circleBtn(Icons.arrow_back, _exit, size: 36),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(20)),
              child: Text('Teen Patti • Table ${widget.roomId.substring(0, math.min(4, widget.roomId.length))}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ),
            const Spacer(),
            if (_isMyTurn) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: AppColors.red, borderRadius: BorderRadius.circular(20)),
                child: Text('Your turn • ${_turnSecondsLeft}s',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
              ),
              const SizedBox(width: 8),
            ],
            _circleBtn(Icons.info_outline, () => _showTopBarSnack('Table info')),
            const SizedBox(width: 6),
            _circleBtn(Icons.chat_bubble_outline, () => setState(() {
                  _showChat = !_showChat;
                  _showGiftTray = false;
                }), size: 36),
            const SizedBox(width: 6),
            _circleBtn(Icons.person_add_alt_1, () => _showTopBarSnack('Invite friend'), size: 36),
            const SizedBox(width: 6),
            _circleBtn(Icons.settings, () => _showTopBarSnack('Settings'), size: 36),
          ],
        ),
      );

  void _showTopBarSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 1),
      ),
    );
  }

  Widget _buildMyHand() {
    final me = (_gameState?['players'] as List?)
        ?.where((p) => (p['user_id'] ?? p['userId']) == _myUserId)
        .firstOrNull;
    if (me != null) {
      final serverSeen = me['is_seen'] == true || me['isSeen'] == true;
      if (serverSeen && !_isSeen) {
        _isSeen = true;
      }
    }
    final cards = _myCards;
    if (cards.isEmpty) return const SizedBox.shrink();
    return Positioned(
      bottom: _isMyTurn ? 104 : 14,
      left: 0,
      right: 0,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!_isSeen) ...[
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                ),
                onPressed: () {
                  _sendAction('see');
                  setState(() {
                    _isSeen = true;
                  });
                },
                child: const Text('See Cards', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
              const SizedBox(height: 8),
            ],
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < cards.length; i++)
                  Transform.rotate(
                    angle: (i - (cards.length - 1) / 2) * 0.12,
                    child: _isSeen
                        ? _buildCard(cards[i]['value'].toString(), cards[i]['suit'].toString())
                        : _buildCardBack(),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Compact "my chips" pill (bottom-left) — the bottom-center seat is dropped
  /// so the player still sees their own stack without overlapping the cards.
  Widget _buildMyChips() {
    final me = (_gameState?['players'] as List?)
        ?.where((p) => p['user_id'] == _myUserId)
        .firstOrNull;
    if (me == null) return const SizedBox.shrink();
    final chips = me['chips'] ?? me['balance'] ?? 0;
    return Positioned(
      left: 12,
      bottom: 12,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black54,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.gold.withOpacity(0.7)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Text('You  ', style: TextStyle(color: Colors.white70, fontSize: 11)),
          Text('💰 $chips',
              style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
        ]),
      ),
    );
  }

  Widget _buildCard(String value, String suit) {
    final color = (suit == 'H' || suit == 'D') ? AppColors.red : Colors.black;
    final suitSymbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
    return Container(
      width: 52,
      height: 74,
      margin: const EdgeInsets.symmetric(horizontal: 3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(1, 3))],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
          Text(suitSymbol, style: TextStyle(fontSize: 16, color: color)),
        ],
      ),
    );
  }

  Widget _buildCardBack() {
    return Container(
      width: 52,
      height: 74,
      margin: const EdgeInsets.symmetric(horizontal: 3),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1E3A8A), Color(0xFF0B1E52)],
        ),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.gold, width: 1.5),
        boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(1, 3))],
      ),
      alignment: Alignment.center,
      child: const Text('♠', style: TextStyle(color: AppColors.gold, fontSize: 28, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildActionBar() {
    final stake = (_gameState?['min_bet'] as num?)?.toDouble() ?? 10;
    final minBet = _isSeen ? stake * 2 : stake;
    final maxBet = minBet * 4; // standard Teen Patti chaal cap
    if (_betAmount < minBet) _betAmount = minBet;
    if (_betAmount > maxBet) _betAmount = maxBet;

    final players = (_gameState?['players'] as List?) ?? [];
    final activeCount = players.where((p) => p['status'] == 'active').length;
    final showAllowed = activeCount == 2;

    return Positioned(
      bottom: 6,
      left: 12,
      right: 12,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Centre coin chip showing the current bet amount
          _coinChip(_betAmount.toInt()),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _actionBtn('Pack', AppColors.red, () => _sendAction('fold')),
              if (showAllowed) ...[
                const SizedBox(width: 10),
                _actionBtn('Show', Colors.deepPurple, () => _sendAction('show')),
              ],
              const SizedBox(width: 10),
              // Bet stepper: −  [Chaal ₹amt]  +
              _stepperBtn('−', () => _adjustBet(-stake, minBet, maxBet)),
              const SizedBox(width: 6),
              _actionBtn(
                  _betAmount > minBet ? 'Raise ₹${_betAmount.toInt()}' : 'Chaal ₹${_betAmount.toInt()}',
                  AppColors.green,
                  () => _sendAction(_betAmount > minBet ? 'raise' : 'call', amount: _betAmount)),
              const SizedBox(width: 6),
              _stepperBtn('+', () => _adjustBet(stake, minBet, maxBet)),
            ],
          ),
        ],
      ),
    );
  }

  void _adjustBet(double delta, double minBet, double maxBet) {
    setState(() {
      _betAmount = (_betAmount + delta).clamp(minBet, maxBet);
    });
    HapticFeedback.selectionClick();
    SystemSound.play(SystemSoundType.click); // chip-place tick
  }

  Widget _coinChip(int amount) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)],
          ),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white24),
          boxShadow: [
            BoxShadow(color: AppColors.gold.withOpacity(0.5), blurRadius: 10, spreadRadius: 1),
          ],
        ),
        child: Text(
          '🪙 ₹$amount',
          style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12),
        ),
      );

  Widget _stepperBtn(String label, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF5B6470), Color(0xFF323844)],
            ),
            border: Border.all(color: AppColors.gold.withOpacity(0.6), width: 1.5),
            shape: BoxShape.circle,
            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 4, offset: Offset(0, 2))],
          ),
          child: Text(label,
              style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold, height: 1)),
        ),
      );

  Widget _actionBtn(String label, Color color, VoidCallback onTap, {Color textColor = Colors.white}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 18),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color.lerp(color, Colors.white, 0.25)!,
                color,
                Color.lerp(color, Colors.black, 0.25)!,
              ],
            ),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white.withOpacity(0.25)),
            boxShadow: [
              BoxShadow(color: color.withOpacity(0.55), blurRadius: 14, spreadRadius: 1),
              const BoxShadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 2)),
            ],
          ),
          child: Text(label,
              style: TextStyle(
                  color: textColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  shadows: const [Shadow(color: Colors.black38, blurRadius: 2)])),
        ),
      );

  // Right-edge vertical buttons: gift tray + emoji bar
  // (chat now lives in the top bar)
  Widget _buildSocialButtons() => Positioned(
        right: 8,
        top: 52,
        child: Column(
          children: [
            _circleBtn(Icons.card_giftcard, () => setState(() {
                  _showGiftTray = !_showGiftTray;
                  _showChat = false;
                })),
            const SizedBox(height: 8),
            _emojiQuickBar(),
          ],
        ),
      );

  Widget _emojiQuickBar() => Container(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
        decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(20)),
        child: Column(
          children: _quickEmojis.take(5).map((e) {
            return GestureDetector(
              onTap: () => _sendEmoji(e),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Text(e, style: const TextStyle(fontSize: 20)),
              ),
            );
          }).toList(),
        ),
      );

  Widget _circleBtn(IconData icon, VoidCallback onTap, {double size = 38}) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFFFE082), Color(0xFFD4AF37), Color(0xFF8A6D1E)],
            ),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withOpacity(0.4), width: 1),
            boxShadow: [
              BoxShadow(color: AppColors.gold.withOpacity(0.45), blurRadius: 8, spreadRadius: 1),
              const BoxShadow(color: Colors.black54, blurRadius: 4, offset: Offset(0, 2)),
            ],
          ),
          child: Icon(icon, color: Colors.white, size: size * 0.52),
        ),
      );

  Widget _buildGiftTray() => Positioned(
        right: 54,
        top: 44,
        child: Container(
          width: 180,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.black87,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.gold.withOpacity(0.5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Send a gift', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _gifts.map((g) {
                  return GestureDetector(
                    onTap: () => _sendGift(g['icon']!),
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.white10,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        children: [
                          Text(g['icon']!, style: const TextStyle(fontSize: 22)),
                          Text(g['name']!, style: const TextStyle(color: Colors.white70, fontSize: 9)),
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

  Widget _buildChatPanel() => Positioned(
        right: 54,
        top: 44,
        bottom: 8,
        child: Container(
          width: 240,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.black87,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.gold.withOpacity(0.4)),
          ),
          child: Column(
            children: [
              const Text('Table Chat', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
              const Divider(color: Colors.white24, height: 12),
              Expanded(
                child: _chat.isEmpty
                    ? const Center(child: Text('Say hi 👋', style: TextStyle(color: Colors.white38, fontSize: 12)))
                    : ListView.builder(
                        reverse: true,
                        itemCount: _chat.length,
                        itemBuilder: (_, i) {
                          final m = _chat[_chat.length - 1 - i];
                          final mine = m.userId == _myUserId;
                          return Align(
                            alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 2),
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                              decoration: BoxDecoration(
                                color: mine ? AppColors.gold.withOpacity(0.85) : Colors.white12,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                mine ? m.text : '${m.username}: ${m.text}',
                                style: TextStyle(color: mine ? Colors.black : Colors.white, fontSize: 12),
                              ),
                            ),
                          );
                        },
                      ),
              ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _chatInput,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      textInputAction: TextInputAction.send,
                      onSubmitted: _sendChat,
                      decoration: const InputDecoration(
                        isDense: true,
                        hintText: 'Message…',
                        hintStyle: TextStyle(color: Colors.white38, fontSize: 12),
                        contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send, color: AppColors.gold, size: 20),
                    onPressed: () => _sendChat(_chatInput.text),
                  ),
                ],
              ),
            ],
          ),
        ),
      );

  Widget _buildResult() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_resultMessage ?? '',
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white),
                  textAlign: TextAlign.center),
              const SizedBox(height: 24),
              ElevatedButton(onPressed: _exit, child: const Text('Back to Lobby')),
            ],
          ),
        ),
      );
}

class _ChatMsg {
  final String userId, username, text, type;
  _ChatMsg({required this.userId, required this.username, required this.text, required this.type});
}

class _Reaction {
  final int id;
  final String userId, emoji;
  final bool isGift;
  _Reaction({required this.id, required this.userId, required this.emoji, this.isGift = false});
}

/// Floating emoji/gift that rises and fades over a seat.
class _ReactionBubble extends StatefulWidget {
  final String emoji;
  final bool isGift;
  const _ReactionBubble({super.key, required this.emoji, this.isGift = false});
  @override
  State<_ReactionBubble> createState() => _ReactionBubbleState();
}

class _ReactionBubbleState extends State<_ReactionBubble> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..forward();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        final t = _c.value;
        return Transform.translate(
          offset: Offset(math.sin(t * math.pi * 2) * 6, -36 * t),
          child: Opacity(
            opacity: (1 - t).clamp(0.0, 1.0),
            child: Transform.scale(
              scale: widget.isGift ? 1.0 + t * 0.6 : 1.0,
              child: Text(widget.emoji, style: const TextStyle(fontSize: 30)),
            ),
          ),
        );
      },
    );
  }
}
