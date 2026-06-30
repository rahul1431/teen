import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../shared/theme/app_theme.dart';
import 'ludo_engine.dart';
import 'ludo_board.dart';

/// Ludo table. One widget serves both:
///  - **offline practice** (`offline: true`) — local [LudoEngine] vs 3 bots,
///  - **online** (`roomId` + `initialData` from room:joined) — server-driven
///    over /ws; this page only renders state and sends roll/move actions.
class LudoGamePage extends StatefulWidget {
  final bool offline;
  final String roomId;
  final Map<String, dynamic>? initialData;
  const LudoGamePage({
    super.key,
    this.offline = false,
    this.roomId = 'PRACTICE',
    this.initialData,
  });

  @override
  State<LudoGamePage> createState() => _LudoGamePageState();
}

class _LudoGamePageState extends State<LudoGamePage>
    with TickerProviderStateMixin {
  final _engine = LudoEngine();
  final _socket = SocketService();
  final _subs = <StreamSubscription>[];

  LudoState? _state;
  int _mySeatIndex = 0;
  bool _rolling = false;
  bool _botBusy = false;
  String? _banner;
  String? _rollNotif;
  bool _showRollNotif = false;

  late final AnimationController _diceCtrl = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 500));

  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    widget.offline ? _initOffline() : _initOnline();
    SoundService.instance.loopAmbience('ludo_bgm.mp3', volume: 0.3);
  }

  @override
  void dispose() {
    _diceCtrl.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    SoundService.instance.stopAmbience();
    super.dispose();
  }

  // ── Offline practice ──────────────────────────────────────────────────────
  void _initOffline() {
    final players = [
      LudoPlayer(
          userId: 'me',
          username: 'You',
          seat: 1,
          isBot: false,
          color: kColors[0],
          tokens: [-1, -1, -1, -1]),
      LudoPlayer(
          userId: 'bot1',
          username: 'Riya',
          seat: 2,
          isBot: true,
          color: kColors[1],
          tokens: [-1, -1, -1, -1]),
      LudoPlayer(
          userId: 'bot2',
          username: 'Arjun',
          seat: 3,
          isBot: true,
          color: kColors[2],
          tokens: [-1, -1, -1, -1]),
      LudoPlayer(
          userId: 'bot3',
          username: 'Sam',
          seat: 4,
          isBot: true,
          color: kColors[3],
          tokens: [-1, -1, -1, -1]),
    ];
    _state = _engine.createGame(roomId: 'PRACTICE', stake: 0, players: players);
    _mySeatIndex = 0;
    setState(() => _banner = 'Your turn — roll the dice');
  }

  Future<void> _offlineRoll() async {
    final s = _state;
    if (s == null || _rolling || _botBusy) return;
    if (s.currentTurn != _mySeatIndex || s.awaiting != 'roll') return;
    setState(() => _rolling = true);
    SoundService.instance.play(Sfx.diceRoll);
    _diceCtrl.forward(from: 0);
    final dice = _engine.rollDie();
    await Future.delayed(const Duration(milliseconds: 480));
    final canMove = _engine.applyRoll(s, dice);
    _showRoll('You', dice);
    setState(() {
      _rolling = false;
      _banner = canMove ? 'Tap a token to move' : 'No valid move — passing';
    });
    if (!canMove) _maybeDriveBots();
  }

  Future<void> _offlineMove(int tokenIndex) async {
    final s = _state;
    if (s == null) return;
    if (s.currentTurn != _mySeatIndex || s.awaiting != 'move') return;
    final res = _engine.applyMove(s, tokenIndex);
    _playMoveSounds(res);
    setState(() {});
    if (res['win'] == true) return _finish(s.winnerId);
    _maybeDriveBots();
  }

  Future<void> _maybeDriveBots() async {
    final s = _state;
    if (s == null || _botBusy) return;
    _botBusy = true;
    while (mounted &&
        s.status == 'active' &&
        s.players[s.currentTurn].isBot) {
      setState(() => _banner = '${s.players[s.currentTurn].username} is playing…');
      await Future.delayed(const Duration(milliseconds: 900));
      final dice = _engine.rollDie();
      SoundService.instance.play(Sfx.diceRoll);
      _diceCtrl.forward(from: 0);
      await Future.delayed(const Duration(milliseconds: 450));
      final canMove = _engine.applyRoll(s, dice);
      _showRoll(s.players[s.currentTurn].username, dice);
      if (canMove) {
        final tok = _engine.chooseBotToken(s, s.currentTurn, dice);
        await Future.delayed(const Duration(milliseconds: 350));
        final res = _engine.applyMove(s, tok);
        _playMoveSounds(res);
        if (res['win'] == true) {
          setState(() {});
          _botBusy = false;
          return _finish(s.winnerId);
        }
      }
      if (mounted) setState(() {});
    }
    _botBusy = false;
    if (mounted && s.status == 'active') {
      setState(() => _banner = 'Your turn — roll the dice');
      SoundService.instance.play(Sfx.yourTurn);
    }
  }

  // ── Online ────────────────────────────────────────────────────────────────
  void _initOnline() {
    final data = widget.initialData;
    if (data != null && data['state'] != null) {
      _state = LudoState.fromJson(Map<String, dynamic>.from(data['state']));
      final yourSeat = data['your_seat'];
      if (yourSeat is int) {
        _mySeatIndex = _state!.players.indexWhere((p) => p.seat == yourSeat);
        if (_mySeatIndex < 0) _mySeatIndex = 0;
      }
      _banner = _isMyTurn ? 'Your turn — roll the dice' : 'Waiting…';
    }

    _subs.add(_socket.on(SocketEvents.gameStateUpdate).listen((d) {
      if (!mounted || d == null || d['state'] == null) return;
      final prevPlayers = _state?.players;
      final newState = LudoState.fromJson(Map<String, dynamic>.from(d['state']));
      // Infer capture for SFX: a token went back to base since last update.
      final captured = _detectCapture(prevPlayers, newState.players);
      setState(() {
        _state = newState;
        _banner = _isMyTurn
            ? (newState.awaiting == 'move'
                ? 'Tap a token'
                : 'Your turn — roll')
            : '${newState.players[newState.currentTurn].username} is playing…';
      });
      final la = d['last_action'];
      if (la != null && la['dice'] != null) {
        SoundService.instance.play(Sfx.diceRoll);
        _diceCtrl.forward(from: 0);
        final rollerIdx = newState.currentTurn == _mySeatIndex
            ? (newState.currentTurn + (newState.awaiting == 'move' ? 0 : -1)) % newState.players.length
            : newState.currentTurn;
        final rollerName = newState.players[rollerIdx.clamp(0, newState.players.length - 1)].username;
        _showRoll(rollerName, (la['dice'] as num).toInt());
      }
      if (captured) SoundService.instance.play(Sfx.tokenCapture);
      else SoundService.instance.play(Sfx.tokenMove);
      if (d['result'] != null) _finish(d['result']['winner_id']);
    }));

    _subs.add(_socket.on(SocketEvents.gameResult).listen((d) {
      if (!mounted) return;
      _finish(d?['winner_id']);
    }));
  }

  bool _detectCapture(List<LudoPlayer>? before, List<LudoPlayer> after) {
    if (before == null) return false;
    var beforeBase = 0, afterBase = 0;
    for (final p in before) {
      beforeBase += p.tokens.where((t) => t == -1).length;
    }
    for (final p in after) {
      afterBase += p.tokens.where((t) => t == -1).length;
    }
    return afterBase > beforeBase;
  }

  void _onlineRoll() {
    if (!_isMyTurn || _state?.awaiting != 'roll') return;
    _socket.emit(SocketEvents.gameAction,
        {'room_id': widget.roomId, 'action': 'roll_dice'});
  }

  void _onlineMove(int tokenIndex) {
    if (!_isMyTurn || _state?.awaiting != 'move') return;
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': 'move_token',
      'token_index': tokenIndex,
    });
  }

  // ── Shared ────────────────────────────────────────────────────────────────
  bool get _isMyTurn => _state != null && _state!.currentTurn == _mySeatIndex;

  void _playMoveSounds(Map<String, bool> res) {
    if (res['captured'] == true) {
      SoundService.instance.play(Sfx.tokenCapture);
    } else if (res['home'] == true) {
      SoundService.instance.play(Sfx.tokenHome);
    } else {
      SoundService.instance.play(Sfx.tokenMove);
    }
  }

  void _showRoll(String playerName, int dice) {
    final emojis = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    setState(() {
      _rollNotif = '$playerName rolled ${emojis[dice.clamp(1, 6)]} $dice';
      _showRollNotif = true;
    });
    Future.delayed(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _showRollNotif = false);
    });
  }

  void _onRoll() => widget.offline ? _offlineRoll() : _onlineRoll();
  void _onTokenTap(int playerIdx, int tokenIndex) {
    if (playerIdx != _mySeatIndex) return;
    widget.offline ? _offlineMove(tokenIndex) : _onlineMove(tokenIndex);
  }

  void _finish(String? winnerId) {
    final won = winnerId == (widget.offline ? 'me' : _myUserId);
    SoundService.instance.play(won ? Sfx.win : Sfx.lose);
    showDialog(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.black.withOpacity(0.85),
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 28),
        child: Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: won
                  ? [const Color(0xFF1A1200), const Color(0xFF2A1E00), const Color(0xFF0D0D0D)]
                  : [const Color(0xFF0D0D16), const Color(0xFF161B2E), const Color(0xFF0D0D0D)],
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: won
                  ? AppColors.gold.withOpacity(0.6)
                  : Colors.white.withOpacity(0.1),
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: won ? AppColors.gold.withOpacity(0.3) : Colors.blue.withOpacity(0.15),
                blurRadius: 40,
                spreadRadius: 5,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Trophy / Sad emoji
              Text(
                won ? '🏆' : '😔',
                style: const TextStyle(fontSize: 64),
              ),
              const SizedBox(height: 16),
              Text(
                won ? 'VICTORY!' : 'GAME OVER',
                style: TextStyle(
                  color: won ? AppColors.gold : Colors.white70,
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 3,
                  shadows: won
                      ? [const Shadow(color: AppColors.gold, blurRadius: 20)]
                      : [],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                won
                    ? 'All tokens home first!'
                    : 'Better luck next time',
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    if (mounted) context.pop();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: won ? AppColors.gold : const Color(0xFF1E2840),
                    foregroundColor: won ? Colors.black : Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                    side: won
                        ? null
                        : BorderSide(color: Colors.white.withOpacity(0.2)),
                  ),
                  child: Text(
                    won ? 'Claim Victory' : 'Back to Lobby',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? get _myUserId =>
      _state != null && _mySeatIndex < _state!.players.length
          ? _state!.players[_mySeatIndex].userId
          : null;

  @override
  Widget build(BuildContext context) {
    final s = _state;
    return Scaffold(
      body: s == null
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : Container(
              decoration: const BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(0, -0.2),
                  radius: 1.3,
                  colors: [
                    Color(0xFF1E2D5A), // Bright spotlight center
                    Color(0xFF0F1736), // Deep navy
                    Color(0xFF060A1A), // Dark shadow corners
                  ],
                  stops: [0.0, 0.6, 1.0],
                ),
              ),
              child: SafeArea(
                child: Column(
                  children: [
                    _buildAppBar(context),
                    _playersBar(s),
                    Expanded(
                      child: Stack(
                        children: [
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                            child: AspectRatio(
                              aspectRatio: 1,
                              child: LudoBoard(
                                state: s,
                                mySeatIndex: _mySeatIndex,
                                onTokenTap: _onTokenTap,
                              ),
                            ),
                          ),
                          // Dice roll notification overlay
                          if (_rollNotif != null)
                            Positioned(
                              top: 16,
                              left: 0,
                              right: 0,
                              child: Center(
                                child: AnimatedOpacity(
                                  opacity: _showRollNotif ? 1.0 : 0.0,
                                  duration: const Duration(milliseconds: 280),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF0F1322).withOpacity(0.92),
                                      borderRadius: BorderRadius.circular(24),
                                      border: Border.all(color: AppColors.gold.withOpacity(0.4)),
                                      boxShadow: [
                                        BoxShadow(
                                          color: Colors.black.withOpacity(0.5),
                                          blurRadius: 12,
                                          offset: const Offset(0, 4),
                                        )
                                      ],
                                    ),
                                    child: Text(
                                      _rollNotif!,
                                      style: const TextStyle(
                                        color: AppColors.goldLight,
                                        fontSize: 15,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    _controlBar(s),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildAppBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
            onPressed: () => Navigator.of(context).pop(),
          ),
          const SizedBox(width: 4),
          Text(
            widget.offline ? 'LUDO · PRACTICE' : 'LUDO LIVE',
            style: const TextStyle(
              color: AppColors.gold,
              fontSize: 16,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.5,
            ),
          ),
          const Spacer(),
          if (!widget.offline)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: Colors.black38,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.gold.withOpacity(0.3)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('🪙 ', style: TextStyle(fontSize: 11)),
                  Text(
                    formatCurrency(_state?.stake ?? 0),
                    style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 11),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _playersBar(LudoState s) {
    final seatColors = [
      AppColors.ludoRed,
      AppColors.ludoGreen,
      AppColors.ludoYellow,
      AppColors.ludoBlue,
    ];
    return Container(
      height: 80,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: List.generate(s.players.length, (i) {
          final p = s.players[i];
          final active = i == s.currentTurn;
          final color = seatColors[(p.seat - 1) % 4];
          final initials = p.username.length > 1
              ? p.username.substring(0, 2).toUpperCase()
              : p.username.toUpperCase();

          return AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: active
                  ? color.withOpacity(0.15)
                  : Colors.white.withOpacity(0.03),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: active ? color.withOpacity(0.7) : Colors.transparent,
                width: 1.5,
              ),
              boxShadow: active
                  ? [BoxShadow(color: color.withOpacity(0.3), blurRadius: 12, spreadRadius: 1)]
                  : [],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Avatar
                Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [color.withOpacity(0.9), color.withOpacity(0.5)],
                        ),
                        border: Border.all(
                          color: active ? Colors.white : color.withOpacity(0.4),
                          width: active ? 2.0 : 1.0,
                        ),
                        boxShadow: [
                          BoxShadow(color: color.withOpacity(0.5), blurRadius: 6),
                        ],
                      ),
                      child: Center(
                        child: Text(
                          initials,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ),
                    if (active)
                      Positioned(
                        bottom: 0,
                        right: 0,
                        child: Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            color: Colors.greenAccent,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.black, width: 1.5),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                // Token dots (4 slots)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: List.generate(4, (ti) {
                    final home = ti < p.finished;
                    final onBoard = !home && p.tokens[ti] != -1;
                    return Container(
                      margin: const EdgeInsets.symmetric(horizontal: 1),
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: home
                            ? color
                            : onBoard
                                ? color.withOpacity(0.5)
                                : Colors.white.withOpacity(0.15),
                        boxShadow: home
                            ? [BoxShadow(color: color.withOpacity(0.6), blurRadius: 3)]
                            : [],
                      ),
                    );
                  }),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _controlBar(LudoState s) {
    final canRoll = _isMyTurn && s.awaiting == 'roll' && !_rolling && !_botBusy;
    final myTurn = _isMyTurn;
    final turnIdx = s.currentTurn.clamp(0, s.players.length - 1);
    final activePlayer = s.players[turnIdx];
    final seatColors = [AppColors.ludoRed, AppColors.ludoGreen, AppColors.ludoYellow, AppColors.ludoBlue];
    final activeColor = seatColors[(activePlayer.seat - 1) % 4];

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 22),
      decoration: BoxDecoration(
        color: const Color(0xFF0B0F1E),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
        border: Border(top: BorderSide(color: activeColor.withOpacity(0.3), width: 1.5)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.5),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
          if (myTurn) BoxShadow(
            color: AppColors.gold.withOpacity(0.08),
            blurRadius: 20,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Row(
        children: [
          // Dice
          _DiceWidget(value: s.dice ?? 1, controller: _diceCtrl),
          const SizedBox(width: 16),
          // Middle info
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (myTurn)
                  Row(
                    children: [
                      Container(
                        width: 8, height: 8,
                        decoration: const BoxDecoration(color: Colors.greenAccent, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      const Text('YOUR TURN',
                          style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.w900, fontSize: 12, letterSpacing: 1)),
                    ],
                  )
                else
                  Row(
                    children: [
                      Container(
                        width: 8, height: 8,
                        decoration: BoxDecoration(color: activeColor, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${activePlayer.username} playing…',
                          style: TextStyle(color: activeColor, fontWeight: FontWeight.w700, fontSize: 12),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 3),
                Text(
                  _banner ?? '',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Roll button
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            decoration: canRoll ? BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.4), blurRadius: 14, offset: const Offset(0, 3))],
            ) : null,
            child: myTurn && s.awaiting == 'move'
                ? Container(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                    decoration: BoxDecoration(
                      color: activeColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: activeColor.withOpacity(0.5)),
                    ),
                    child: Text(
                      'TAP TOKEN',
                      style: TextStyle(color: activeColor, fontWeight: FontWeight.w900, fontSize: 12, letterSpacing: 0.5),
                    ),
                  )
                : ElevatedButton.icon(
                    onPressed: canRoll ? _onRoll : null,
                    icon: const Icon(Icons.casino_rounded, size: 18),
                    label: const Text('ROLL', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      disabledBackgroundColor: Colors.white.withOpacity(0.04),
                      disabledForegroundColor: Colors.white24,
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Animated dice — tumbles (rotate + scale) while the controller runs, then
/// settles showing [value] pips.
class _DiceWidget extends StatelessWidget {
  final int value;
  final AnimationController controller;
  const _DiceWidget({required this.value, required this.controller});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final t = controller.value;
        final angle = t * 4 * 3.14159; // two full spins
        final scale = 1 + 0.25 * (t < 0.5 ? t * 2 : (1 - t) * 2);
        return Transform.scale(
          scale: scale,
          child: Transform.rotate(
            angle: angle,
            child: _face(value),
          ),
        );
      },
    );
  }

  Widget _face(int v) {
    return Container(
      width: 58,
      height: 58,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFFFFFFFF),
            Color(0xFFF5F5F0), // Off-white ivory look
            Color(0xFFE0DCD3),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          stops: [0.0, 0.4, 1.0],
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE0D8C8), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.55),
            blurRadius: 8,
            offset: const Offset(1, 4),
          ),
          BoxShadow(
            color: Colors.white.withOpacity(0.45),
            blurRadius: 2,
            offset: const Offset(-1, -1),
            spreadRadius: -0.5,
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(5),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.white.withOpacity(0.5), width: 1.0),
          ),
          child: CustomPaint(painter: _PipsPainter(v)),
        ),
      ),
    );
  }
}

class _PipsPainter extends CustomPainter {
  final int value;
  _PipsPainter(this.value);

  @override
  void paint(Canvas canvas, Size size) {
    // Red color for 1 and 4, dark gray/black for others (standard casino style)
    final isRed = value == 1 || value == 4;
    
    final r = size.width * 0.095;
    final cells = {
      'tl': Offset(size.width * 0.28, size.height * 0.28),
      'tr': Offset(size.width * 0.72, size.height * 0.28),
      'cl': Offset(size.width * 0.28, size.height * 0.5),
      'cr': Offset(size.width * 0.72, size.height * 0.5),
      'c': Offset(size.width * 0.5, size.height * 0.5),
      'bl': Offset(size.width * 0.28, size.height * 0.72),
      'br': Offset(size.width * 0.72, size.height * 0.72),
    };
    final layout = <int, List<String>>{
      1: ['c'],
      2: ['tl', 'br'],
      3: ['tl', 'c', 'br'],
      4: ['tl', 'tr', 'bl', 'br'],
      5: ['tl', 'tr', 'c', 'bl', 'br'],
      6: ['tl', 'tr', 'cl', 'cr', 'bl', 'br'],
    };
    for (final key in layout[value] ?? ['c']) {
      final center = cells[key]!;
      canvas.drawCircle(center, r, Paint()..shader = RadialGradient(
        colors: isRed 
            ? [const Color(0xFFFF5252), const Color(0xFFB71C1C)] 
            : [const Color(0xFF424242), const Color(0xFF000000)],
        center: const Alignment(-0.35, -0.35),
      ).createShader(Rect.fromCircle(center: center, radius: r)));
      
      // Highlight dot
      canvas.drawCircle(Offset(center.dx - r * 0.35, center.dy - r * 0.35), r * 0.2, Paint()..color = Colors.white70);
    }
  }

  @override
  bool shouldRepaint(covariant _PipsPainter old) => old.value != value;
}
