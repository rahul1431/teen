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

  late final AnimationController _diceCtrl = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 500));

  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    widget.offline ? _initOffline() : _initOnline();
  }

  @override
  void dispose() {
    _diceCtrl.dispose();
    for (final s in _subs) {
      s.cancel();
    }
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
    setState(() {
      _rolling = false;
      _banner = canMove
          ? 'You rolled $dice — tap a token'
          : 'You rolled $dice — no move';
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
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Text(won ? '🏆 You Win!' : 'Game Over',
            textAlign: TextAlign.center,
            style: TextStyle(
                color: won ? AppColors.gold : Colors.white,
                fontWeight: FontWeight.w900)),
        content: Text(
            won
                ? 'You got all your tokens home first!'
                : 'Better luck next time.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSecondary)),
        actions: [
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                Navigator.pop(ctx);
                if (mounted) context.pop();
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
              child: const Text('Back to Lobby'),
            ),
          ),
        ],
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
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.offline ? 'Ludo · Practice' : 'Ludo'),
      ),
      body: s == null
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : SafeArea(
              child: Column(
                children: [
                  _playersBar(s),
                  Expanded(
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: AspectRatio(
                          aspectRatio: 1,
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                  color: AppColors.gold.withOpacity(0.5),
                                  width: 2),
                              boxShadow: [
                                BoxShadow(
                                    color: Colors.black.withOpacity(0.5),
                                    blurRadius: 18)
                              ],
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: LudoBoard(
                              state: s,
                              mySeatIndex: _mySeatIndex,
                              onTokenTap: _onTokenTap,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  _controlBar(s),
                ],
              ),
            ),
    );
  }

  Widget _playersBar(LudoState s) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: List.generate(s.players.length, (i) {
          final p = s.players[i];
          final active = i == s.currentTurn;
          final color = [
            AppColors.ludoRed,
            AppColors.ludoGreen,
            AppColors.ludoYellow,
            AppColors.ludoBlue
          ][(p.seat - 1) % 4];
          return AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: active ? color.withOpacity(0.25) : AppColors.cardBg,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: active ? color : Colors.transparent, width: 2),
            ),
            child: Column(
              children: [
                Row(children: [
                  Container(
                      width: 12,
                      height: 12,
                      decoration:
                          BoxDecoration(color: color, shape: BoxShape.circle)),
                  const SizedBox(width: 6),
                  Text(p.username,
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight:
                              active ? FontWeight.w800 : FontWeight.w500)),
                ]),
                const SizedBox(height: 2),
                Text('🏠 ${p.finished}/4',
                    style: const TextStyle(
                        fontSize: 10, color: AppColors.textSecondary)),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _controlBar(LudoState s) {
    final canRoll = _isMyTurn && s.awaiting == 'roll' && !_rolling && !_botBusy;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
      child: Column(
        children: [
          Text(_banner ?? '',
              style: const TextStyle(
                  color: AppColors.gold, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _DiceWidget(value: s.dice ?? 1, controller: _diceCtrl),
              const SizedBox(width: 24),
              ElevatedButton.icon(
                onPressed: canRoll ? _onRoll : null,
                icon: const Icon(Icons.casino_rounded),
                label: Text(s.awaiting == 'move' && _isMyTurn
                    ? 'Tap a token'
                    : 'Roll Dice'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  disabledBackgroundColor: AppColors.cardBg,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
                ),
              ),
            ],
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
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
            colors: [Colors.white, Color(0xFFE0E0E0)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.4), blurRadius: 6)
        ],
      ),
      child: CustomPaint(painter: _PipsPainter(v)),
    );
  }
}

class _PipsPainter extends CustomPainter {
  final int value;
  _PipsPainter(this.value);

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = const Color(0xFF1A1A1A);
    final r = size.width * 0.09;
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
      canvas.drawCircle(cells[key]!, r, p);
    }
  }

  @override
  bool shouldRepaint(covariant _PipsPainter old) => old.value != value;
}
