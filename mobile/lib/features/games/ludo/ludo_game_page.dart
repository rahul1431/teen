import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/network/api_client.dart';
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
  final _api = ApiClient();
  final _subs = <StreamSubscription>[];

  // ── Emoji reactions + dealer tips (online only) ────────────────────────────
  static const List<int> _tipAmounts = [5, 10, 20, 50];
  List<String> _quickEmojis = ['😀', '😂', '😎', '😮', '😭', '🔥', '👏', '🤔'];
  bool _showEmojiTray = false;
  int _reactionId = 0;
  final List<_Reaction> _reactions = [];

  bool _muted = false;

  // Visible countdown while it's the local player's turn to roll — mirrors
  // the server-side per-turn AFK auto-play window (LUDO_TURN_TIMEOUT_MS in
  // game-gateway) so a slow player can actually see time running out
  // instead of being surprised when their turn gets auto-played.
  static const int _turnTimerSeconds = 30;
  Timer? _turnTimer;
  int _turnSecondsLeft = _turnTimerSeconds;

  void _syncTurnTimer() {
    final active =
        _isMyTurn && _state?.awaiting == 'roll' && !_rolling && !_botBusy;
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

  LudoState? _state;
  int _mySeatIndex = 0;
  bool _rolling = false;
  bool _botBusy = false;
  String? _banner;
  String? _rollNotif;
  bool _showRollNotif = false;
  int _lastDice = 1;
  // Recent-events log — newest first, capped short. Fills the empty space
  // below the board (a fixed-size square inside an Expanded region) with
  // something useful instead of leaving it idle.
  final List<String> _activityLog = [];
  static const int _maxActivityLog = 6;

  void _logActivity(String entry) {
    setState(() {
      _activityLog.insert(0, entry);
      if (_activityLog.length > _maxActivityLog) _activityLog.removeLast();
    });
  }

  late final AnimationController _diceCtrl = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 500));

  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    _muted = SoundService.instance.muted;
    widget.offline ? _initOffline() : _initOnline();
    // Game-start sting as the table opens, then the looping ambience under it.
    SoundService.instance.play(Sfx.ludoStart);
    SoundService.instance.loopAmbience('ludo_ambience.mp3', volume: 0.5);
    if (!widget.offline) _loadEmojiConfig();
  }

  void _toggleMute() {
    SoundService.instance.toggleMute();
    final m = SoundService.instance.muted;
    setState(() => _muted = m);
    if (m) {
      SoundService.instance.stopAmbience();
    } else {
      SoundService.instance.loopAmbience('ludo_ambience.mp3', volume: 0.5);
    }
  }

  // Same admin-configurable emoji list already used on the Teen Patti table
  // (/api/admin/config/emojis) — falls back to the hardcoded defaults on
  // any failure so this never blocks the game from loading.
  Future<void> _loadEmojiConfig() async {
    try {
      final res = await _api.dio.get('/api/admin/config/emojis');
      final emojis = (res.data as List?)?.cast<String>();
      if (emojis != null && emojis.isNotEmpty && mounted) {
        setState(() => _quickEmojis = emojis);
      }
    } catch (_) {
      /* keep defaults */
    }
  }

  @override
  void dispose() {
    _diceCtrl.dispose();
    _turnTimer?.cancel();
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
    while (mounted && s.status == 'active' && s.players[s.currentTurn].isBot) {
      setState(
          () => _banner = '${s.players[s.currentTurn].username} is playing…');
      await Future.delayed(const Duration(milliseconds: 900));
      final dice = _engine.rollDie();
      _diceCtrl.forward(from: 0);
      await Future.delayed(const Duration(milliseconds: 450));
      final canMove = _engine.applyRoll(s, dice);
      _showRoll(s.players[s.currentTurn].username, dice);
      if (canMove) {
        final tok = _engine.chooseBotToken(s, s.currentTurn, dice);
        await Future.delayed(const Duration(milliseconds: 350));
        final res = _engine.applyMove(s, tok);
        // Capture/home are rare, notable events worth hearing even for a
        // bot's move — unlike plain tokenMove, which stays silent here to
        // avoid the every-~1.3s repeat noise bots caused during their turns.
        if (res['captured'] == true) {
          SoundService.instance.play(Sfx.tokenCapture);
        } else if (res['home'] == true) {
          SoundService.instance.play(Sfx.tokenHome);
        }
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
      final newState =
          LudoState.fromJson(Map<String, dynamic>.from(d['state']));
      // Infer capture/home for SFX by diffing token state since last update.
      final captured = _detectCapture(prevPlayers, newState.players);
      final homed = _detectHome(prevPlayers, newState.players);
      setState(() {
        _state = newState;
        _banner = _isMyTurn
            ? (newState.awaiting == 'move' ? 'Tap a token' : 'Your turn — roll')
            : '${newState.players[newState.currentTurn].username} is playing…';
      });
      final la = d['last_action'];
      // last_action.user_id is the authoritative actor (it's the request's own
      // conn.userId server-side, or the acting bot's user_id) — look up their
      // username directly instead of guessing from turn-index math, which
      // broke once a finished player caused passTurn to skip a seat.
      String? actorName;
      if (la != null) {
        final actorId = la['user_id'];
        final actorSeatIdx =
            newState.players.indexWhere((p) => p.userId == actorId);
        actorName = newState
            .players[actorSeatIdx >= 0
                ? actorSeatIdx
                : newState.currentTurn.clamp(0, newState.players.length - 1)]
            .username;
      }
      if (la != null && la['dice'] != null) {
        _diceCtrl.forward(from: 0);
        _showRoll(actorName!, (la['dice'] as num).toInt());
      }
      // Plain-move sound only for the local player's own move_token action —
      // the gateway includes a 'dice' field on every broadcast (roll AND
      // move), so this used to fire unconditionally on every single state
      // update from anyone at the table, which read as a non-stop bell in
      // online games. Capture/home are rare, genuinely notable events
      // (unlike every-broadcast dice noise) so those play for ANY player.
      // Per-cell stepping "tik" is emitted by the token sprite itself as it
      // travels (see _TokenSprite), so we only fire the rarer capture/home
      // cues here — no more per-move bell on every broadcast.
      if (captured) {
        SoundService.instance.play(Sfx.tokenCapture);
        if (actorName != null) _logActivity('$actorName captured a token! 💥');
      } else if (homed) {
        SoundService.instance.play(Sfx.tokenHome);
      }
      if (d['result'] != null) {
        _finish(d['result']['winner_id'],
            rankings: d['result']['rankings'],
            prize: (d['result']['prize'] as num?)?.toDouble());
      }
    }));

    _subs.add(_socket.on(SocketEvents.gameResult).listen((d) {
      if (!mounted) return;
      _finish(d?['winner_id'],
          rankings: d?['rankings'], prize: (d?['prize'] as num?)?.toDouble());
    }));

    // Server rejected an action (stale room, engine unavailable, not-your-turn
    // desync, etc). Without this the player is left staring at a dead ROLL
    // button with zero feedback — surface it and let them retry.
    _subs.add(_socket.on(SocketEvents.errorEvent).listen((d) {
      if (!mounted) return;
      final msg = (d is Map ? d['message'] : d)?.toString() ?? 'Action failed';
      setState(() => _banner = msg);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(msg)));
    }));

    // Emoji reactions — room:chat/room:tip are generic room-scoped events
    // (the gateway routes them purely by room_id, not game_type), so this
    // reuses the exact same backend the Teen Patti table already uses.
    _subs.add(_socket.on(SocketEvents.roomChatMsg).listen((data) {
      if (!mounted || data is! Map) return;
      final type = (data['type'] ?? 'text').toString();
      final userId = data['user_id']?.toString() ?? '';
      final msg = data['message']?.toString() ?? '';
      if (userId != _myUserId && type == 'emoji') _spawnReaction(userId, msg);
    }));

    _subs.add(_socket.on('room:tip').listen((data) {
      if (!mounted || data is! Map) return;
      final userId = data['user_id']?.toString() ?? '';
      final name = data['username']?.toString() ?? 'Player';
      final amount = (data['amount'] as num?)?.toInt() ?? 0;
      _spawnReaction(userId, '💰 ₹$amount', isTip: true);
      final who = userId == _myUserId ? 'You' : name;
      _logActivity('$who tipped the dealer ₹$amount');
    }));
  }

  void _sendEmoji(String emoji) {
    _socket.emit(SocketEvents.roomChat,
        {'room_id': widget.roomId, 'message': emoji, 'type': 'emoji'});
    _spawnReaction(_myUserId ?? '', emoji);
    SoundService.instance.play(Sfx.ludoTap);
  }

  void _sendTip(int amount) {
    // No optimistic reaction — the server only broadcasts room:tip after the
    // wallet debit actually succeeds (mirrors the Teen Patti tip flow).
    _socket.emit('room:tip', {'room_id': widget.roomId, 'amount': amount});
  }

  void _spawnReaction(String userId, String emoji, {bool isTip = false}) {
    final r = _Reaction(
        id: ++_reactionId, userId: userId, emoji: emoji, isTip: isTip);
    setState(() => _reactions.add(r));
    Timer(const Duration(milliseconds: 2400), () {
      if (!mounted) return;
      setState(() => _reactions.removeWhere((x) => x.id == r.id));
    });
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

  bool _detectHome(List<LudoPlayer>? before, List<LudoPlayer> after) {
    if (before == null) return false;
    var beforeFinished = 0, afterFinished = 0;
    for (final p in before) {
      beforeFinished += p.finished;
    }
    for (final p in after) {
      afterFinished += p.finished;
    }
    return afterFinished > beforeFinished;
  }

  void _onlineRoll() {
    if (!_isMyTurn || _state?.awaiting != 'roll') return;
    SoundService.instance.play(Sfx.diceRoll);
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

  // Amount the winner actually takes home: pot (stake × seats) minus the 5%
  // platform rake — mirrors the server formula in
  // services/game-engines/ludo/src/rules.ts (pot * 0.05 rake → pot * 0.95 prize)
  // so the header matches the "You Won …" result exactly.
  static const double _ludoRake = 0.05;
  double get _winningAmount {
    final s = _state;
    if (s == null) return 0;
    final pot = s.stake * s.players.length;
    return (pot * (1 - _ludoRake) * 100).roundToDouble() / 100;
  }

  void _playMoveSounds(Map<String, bool> res) {
    // Per-cell stepping "tik" (and the safe-cell chime) are emitted by the
    // token sprite as it travels — here we only add the rarer capture/home cues.
    if (res['captured'] == true) {
      SoundService.instance.play(Sfx.tokenCapture);
    } else if (res['home'] == true) {
      SoundService.instance.play(Sfx.tokenHome);
    }
  }

  void _showRoll(String playerName, int dice) {
    final emojis = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    setState(() {
      _rollNotif = '$playerName rolled ${emojis[dice.clamp(1, 6)]} $dice';
      _showRollNotif = true;
      // state.dice gets cleared back to null server-side (and in the offline
      // engine) the instant a roll auto-passes with no legal move — which is
      // the common case. Track the raw rolled value separately so the dice
      // face widget actually shows what was rolled instead of always falling
      // back to a static "1" in that case.
      _lastDice = dice;
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

  // Original confetti burst overlaid on the whole screen when the local player
  // wins — the celebratory "fireworks" moment, drawn with a CustomPainter (no
  // video asset). Self-removes when the animation finishes.
  void _showWinBurst() {
    final overlay = Overlay.of(context);
    late OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _WinBurst(onDone: () {
        entry.remove();
      }),
    );
    overlay.insert(entry);
  }

  void _finish(String? winnerId, {List<dynamic>? rankings, double? prize}) {
    final won = winnerId == (widget.offline ? 'me' : _myUserId);
    // Server computes full standings (rankings: [{user_id, finished}, ...],
    // already sorted best-first) but until now the dialog only ever showed a
    // binary Victory/Game Over with no final placement info.
    final players = _state?.players;
    final standings = <String>[];
    if (rankings != null && players != null) {
      for (final r in rankings) {
        final uid = r is Map ? r['user_id'] : null;
        final idx = players.indexWhere((p) => p.userId == uid);
        if (idx >= 0) standings.add(players[idx].username);
      }
    }
    SoundService.instance.play(won ? Sfx.ludoWin : Sfx.lose);
    if (won) _showWinBurst();
    showDialog(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.black.withOpacity(0.85),
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 28),
        // Simple scale+fade entrance — self-contained via TweenAnimationBuilder
        // (no extra AnimationController/lifecycle to manage) so the result
        // dialog doesn't just snap into place against the polished in-game
        // board animations.
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: const Duration(milliseconds: 380),
          curve: Curves.easeOutBack,
          builder: (context, t, child) => Opacity(
            opacity: t.clamp(0.0, 1.0),
            child: Transform.scale(scale: 0.85 + 0.15 * t, child: child),
          ),
          child: Container(
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: won
                    ? [
                        const Color(0xFF1A1200),
                        const Color(0xFF2A1E00),
                        const Color(0xFF0D0D0D)
                      ]
                    : [
                        const Color(0xFF0D0D16),
                        const Color(0xFF161B2E),
                        const Color(0xFF0D0D0D)
                      ],
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
                  color: won
                      ? AppColors.gold.withOpacity(0.3)
                      : Colors.blue.withOpacity(0.15),
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
                  won ? 'All tokens home first!' : 'Better luck next time',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 15,
                  ),
                ),
                if (won && prize != null && prize > 0) ...[
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      'You Won ${formatCurrency(prize)}',
                      style: const TextStyle(
                        color: Colors.black,
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                        letterSpacing: 0.3,
                      ),
                    ),
                  ),
                ],
                if (standings.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  ...List.generate(standings.length, (i) {
                    const medals = ['🥇', '🥈', '🥉', '4️⃣'];
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        children: [
                          Text(medals[i.clamp(0, 3)],
                              style: const TextStyle(fontSize: 16)),
                          const SizedBox(width: 8),
                          Text(
                            standings[i],
                            style: TextStyle(
                              color: i == 0
                                  ? AppColors.gold
                                  : AppColors.textSecondary,
                              fontWeight:
                                  i == 0 ? FontWeight.w800 : FontWeight.w500,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
                const SizedBox(height: 28),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      if (mounted) context.pop();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor:
                          won ? AppColors.gold : const Color(0xFF1E2840),
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
    if (s != null) _syncTurnTimer();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmExit();
      },
      child: Scaffold(
        body: s == null
            ? const Center(
                child: CircularProgressIndicator(color: AppColors.gold))
            : Container(
                decoration: const BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment(0, -0.15),
                    radius: 1.35,
                    colors: [
                      Color(0xFF7A2CC4), // Bright purple spotlight
                      Color(0xFF4A1B87), // Deep violet
                      Color(0xFF23103E), // Dark purple corners
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
                        child: Column(
                          children: [
                            Expanded(
                              child: Stack(
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 2, vertical: 2),
                                    child: AspectRatio(
                                      aspectRatio: 1,
                                      child: LudoBoard(
                                        state: s,
                                        mySeatIndex: _mySeatIndex,
                                        onTokenTap: _onTokenTap,
                                      ),
                                    ),
                                  ),
                                  // Dice roll notification overlay.
                                  // IgnorePointer: it floats over the top of the
                                  // board (faded, but kept in the tree), and
                                  // without this it silently swallowed taps on
                                  // tokens sitting near the top-centre cells.
                                  if (_rollNotif != null)
                                    Positioned(
                                      top: 16,
                                      left: 0,
                                      right: 0,
                                      child: IgnorePointer(
                                        child: Center(
                                        child: AnimatedOpacity(
                                          opacity: _showRollNotif ? 1.0 : 0.0,
                                          duration:
                                              const Duration(milliseconds: 280),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 20, vertical: 10),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFF0F1322)
                                                  .withOpacity(0.92),
                                              borderRadius:
                                                  BorderRadius.circular(24),
                                              border: Border.all(
                                                  color: AppColors.gold
                                                      .withOpacity(0.4)),
                                              boxShadow: [
                                                BoxShadow(
                                                  color: Colors.black
                                                      .withOpacity(0.5),
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
                                    ),
                                  // Floating emoji/tip reactions from anyone
                                  // at the table, centered over the board.
                                  // IgnorePointer so a lingering bubble can't
                                  // swallow a tap on a token beneath it.
                                  ..._reactions.map((r) => Positioned(
                                        key: ValueKey('rx_${r.id}'),
                                        left:
                                            MediaQuery.of(context).size.width /
                                                    2 -
                                                30 +
                                                (r.id % 5 - 2) * 18.0,
                                        top:
                                            MediaQuery.of(context).size.height *
                                                0.22,
                                        child: IgnorePointer(
                                          child: _ReactionBubble(
                                              emoji: r.emoji, isTip: r.isTip),
                                        ),
                                      )),
                                  if (_showEmojiTray)
                                    Positioned(
                                      top: 4,
                                      right: 4,
                                      child: _buildEmojiTray(),
                                    ),
                                ],
                              ),
                            ),
                            if (_activityLog.isNotEmpty) _activityPanel(),
                          ],
                        ),
                      ),
                      _tipBar(),
                      _controlBar(s),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  // Compact recent-events strip shown below the board. The board is a fixed
  // square inside an Expanded column, which otherwise left a large idle gap
  // beneath it on most phone aspect ratios — this fills it with something
  // useful (who rolled what, who got captured) instead of empty space.
  Widget _activityPanel() {
    // A plain Column child (sibling of the board's Expanded above it), not a
    // Stack overlay — must not return a Positioned root widget.
    return Container(
      margin: const EdgeInsets.fromLTRB(10, 6, 10, 8),
      constraints: const BoxConstraints(maxHeight: 92),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF0F1322).withOpacity(0.55),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: ListView.builder(
        padding: EdgeInsets.zero,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _activityLog.length,
        itemBuilder: (context, i) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 1.5),
          child: Text(
            _activityLog[i],
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: i == 0 ? Colors.white70 : Colors.white38,
              fontSize: 11.5,
              fontWeight: i == 0 ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }

  // Emoji picker popup opened from the app-bar emoji button. Dealer tips
  // moved out to their own always-visible strip above the control bar
  // (_tipBar) so they're not buried behind a tap.
  Widget _buildEmojiTray() {
    return GestureDetector(
      onTap: () {}, // absorb taps so the board behind it doesn't react
      child: Container(
        width: 220,
        constraints: const BoxConstraints(maxHeight: 360),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.92),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.gold.withOpacity(0.5)),
        ),
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Text('Send an Emoji',
                      style: TextStyle(
                          color: AppColors.gold,
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                  const Spacer(),
                  GestureDetector(
                    onTap: () => setState(() => _showEmojiTray = false),
                    child: const Icon(Icons.close,
                        color: Colors.white54, size: 18),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: _quickEmojis.map((e) {
                  return GestureDetector(
                    onTap: () {
                      _sendEmoji(e);
                      setState(() => _showEmojiTray = false);
                    },
                    child: Text(e, style: const TextStyle(fontSize: 26)),
                  );
                }).toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // Leaving mid-match previously popped instantly with no warning, even in a
  // real-money online game — matches the confirm-before-leave pattern already
  // used on the Teen Patti table.
  void _doExit() {
    if (!widget.offline) {
      _socket.emit('leave_room', {'room_id': widget.roomId});
    }
    Navigator.of(context).pop();
  }

  void _confirmExit() {
    if (widget.offline) {
      // Practice mode has no stake to forfeit — just leave.
      Navigator.of(context).pop();
      return;
    }
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Leave Match?',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        content: const Text(
            "You'll forfeit your stake and lose your progress in this game.",
            style: TextStyle(color: Colors.white70, fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Stay', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              _doExit();
            },
            child: const Text('Leave',
                style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
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
            onPressed: _confirmExit,
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
          IconButton(
            icon: Icon(
              _muted ? Icons.volume_off_rounded : Icons.volume_up_rounded,
              color: Colors.white70,
              size: 20,
            ),
            onPressed: _toggleMute,
          ),
          if (!widget.offline) ...[
            GestureDetector(
              onTap: () => setState(() => _showEmojiTray = !_showEmojiTray),
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                        color: AppColors.gold.withOpacity(0.4),
                        blurRadius: 8,
                        spreadRadius: 1),
                  ],
                ),
                child: const Icon(Icons.emoji_emotions,
                    color: Colors.black, size: 18),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: Colors.black38,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.gold.withOpacity(0.3)),
              ),
              // Winning amount (what the winner takes home) rather than the
              // per-player stake — the prize is the number players care about.
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('🏆 ', style: TextStyle(fontSize: 11)),
                  Text(
                    formatCurrency(_winningAmount),
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _playersBar(LudoState s) {
    // Order matches the reskinned board: seat0 red, seat1 green, seat2 yellow, seat3 blue.
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
          final disconnected = p.status == 'disconnected';
          final active = i == s.currentTurn && !disconnected;
          final color = seatColors[(p.seat - 1) % 4];
          final initials = p.username.length > 1
              ? p.username.substring(0, 2).toUpperCase()
              : p.username.toUpperCase();

          return Opacity(
            opacity: disconnected ? 0.4 : 1.0,
            child: AnimatedContainer(
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
                  ? [
                      BoxShadow(
                          color: color.withOpacity(0.3),
                          blurRadius: 12,
                          spreadRadius: 1)
                    ]
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
                          colors: [
                            color.withOpacity(0.9),
                            color.withOpacity(0.5)
                          ],
                        ),
                        border: Border.all(
                          color: active ? Colors.white : color.withOpacity(0.4),
                          width: active ? 2.0 : 1.0,
                        ),
                        boxShadow: [
                          BoxShadow(
                              color: color.withOpacity(0.5), blurRadius: 6),
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
                // 'Left' label for a player who forfeited, else token dots.
                if (disconnected)
                  const Text('LEFT',
                      style: TextStyle(
                          color: Colors.redAccent,
                          fontSize: 8,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.5))
                else
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
                              ? [
                                  BoxShadow(
                                      color: color.withOpacity(0.6),
                                      blurRadius: 3)
                                ]
                              : [],
                        ),
                      );
                    }),
                  ),
              ],
            ),
          ),
          );
        }),
      ),
    );
  }

  // Always-visible dealer-tip strip, directly above the dice/roll control
  // bar — replaces the old tip-inside-emoji-popup placement so tipping
  // doesn't require opening a tray first. Online only (no dealer to tip
  // in offline practice).
  Widget _tipBar() {
    if (widget.offline) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
      decoration: BoxDecoration(
        color: Colors.black26,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.gold.withOpacity(0.22)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.card_giftcard_rounded,
                  color: AppColors.gold.withOpacity(0.85), size: 14),
              const SizedBox(width: 6),
              const Text('TIP THE DEALER',
                  style: TextStyle(
                      color: AppColors.gold,
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                      letterSpacing: 1.2)),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: _tipAmounts.map((amount) {
              return GestureDetector(
                onTap: () => _sendTip(amount),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                          color: AppColors.gold.withOpacity(0.3),
                          blurRadius: 6,
                          offset: const Offset(0, 2)),
                    ],
                  ),
                  child: Text('₹$amount',
                      style: const TextStyle(
                          color: Colors.black,
                          fontWeight: FontWeight.w800,
                          fontSize: 12)),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _controlBar(LudoState s) {
    final canRoll = _isMyTurn && s.awaiting == 'roll' && !_rolling && !_botBusy;
    final myTurn = _isMyTurn;
    final turnIdx = s.currentTurn.clamp(0, s.players.length - 1);
    final activePlayer = s.players[turnIdx];
    // Must match _playersBar's order (seat0 red, seat1 blue, seat2 yellow, seat3
    // green) — this array previously had green/blue swapped, so the active-turn
    // border color didn't match the same player's color everywhere else on screen.
    final seatColors = [
      AppColors.ludoRed,
      AppColors.ludoGreen,
      AppColors.ludoYellow,
      AppColors.ludoBlue
    ];
    final activeColor = seatColors[(activePlayer.seat - 1) % 4];

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 22),
      decoration: BoxDecoration(
        color: const Color(0xFF0B0F1E),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
        border: Border(
            top: BorderSide(color: activeColor.withOpacity(0.3), width: 1.5)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.5),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
          if (myTurn)
            BoxShadow(
              color: AppColors.gold.withOpacity(0.08),
              blurRadius: 20,
              offset: const Offset(0, -2),
            ),
        ],
      ),
      child: Row(
        children: [
          // Dice
          _DiceWidget(value: s.dice ?? _lastDice, controller: _diceCtrl),
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
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                            color: Colors.greenAccent, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      const Text('YOUR TURN',
                          style: TextStyle(
                              color: Colors.greenAccent,
                              fontWeight: FontWeight.w900,
                              fontSize: 12,
                              letterSpacing: 1)),
                      if (s.awaiting == 'roll') ...[
                        const SizedBox(width: 8),
                        Text('${_turnSecondsLeft}s',
                            style: TextStyle(
                                color: _turnSecondsLeft <= 10
                                    ? Colors.redAccent
                                    : Colors.white54,
                                fontWeight: FontWeight.w800,
                                fontSize: 11)),
                      ],
                    ],
                  )
                else
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                            color: activeColor, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${activePlayer.username} playing…',
                          style: TextStyle(
                              color: activeColor,
                              fontWeight: FontWeight.w700,
                              fontSize: 12),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 3),
                Text(
                  // "Your turn — roll the dice" is redundant with the
                  // YOUR TURN badge + enabled ROLL button right next to it.
                  _banner == 'Your turn — roll the dice' ? '' : (_banner ?? ''),
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 11),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Roll button
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            decoration: canRoll
                ? BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: [
                      BoxShadow(
                          color: AppColors.gold.withOpacity(0.4),
                          blurRadius: 14,
                          offset: const Offset(0, 3))
                    ],
                  )
                : null,
            child: myTurn && s.awaiting == 'move'
                ? Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 18, vertical: 14),
                    decoration: BoxDecoration(
                      color: activeColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: activeColor.withOpacity(0.5)),
                    ),
                    child: Text(
                      'TAP TOKEN',
                      style: TextStyle(
                          color: activeColor,
                          fontWeight: FontWeight.w900,
                          fontSize: 12,
                          letterSpacing: 0.5),
                    ),
                  )
                : ElevatedButton.icon(
                    onPressed: canRoll ? _onRoll : null,
                    icon: const Icon(Icons.casino_rounded, size: 18),
                    label: const Text('ROLL',
                        style: TextStyle(
                            fontWeight: FontWeight.w900, fontSize: 13)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      disabledBackgroundColor: Colors.white.withOpacity(0.04),
                      disabledForegroundColor: Colors.white24,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
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
            border:
                Border.all(color: Colors.white.withOpacity(0.5), width: 1.0),
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
      canvas.drawCircle(
          center,
          r,
          Paint()
            ..shader = RadialGradient(
              colors: isRed
                  ? [const Color(0xFFFF5252), const Color(0xFFB71C1C)]
                  : [const Color(0xFF424242), const Color(0xFF000000)],
              center: const Alignment(-0.35, -0.35),
            ).createShader(Rect.fromCircle(center: center, radius: r)));

      // Highlight dot
      canvas.drawCircle(Offset(center.dx - r * 0.35, center.dy - r * 0.35),
          r * 0.2, Paint()..color = Colors.white70);
    }
  }

  @override
  bool shouldRepaint(covariant _PipsPainter old) => old.value != value;
}

// ── Emoji/tip reaction bubble ─────────────────────────────────────────────────
class _Reaction {
  final int id;
  final String userId, emoji;
  final bool isTip;
  _Reaction(
      {required this.id,
      required this.userId,
      required this.emoji,
      this.isTip = false});
}

class _ReactionBubble extends StatefulWidget {
  final String emoji;
  final bool isTip;
  const _ReactionBubble({required this.emoji, this.isTip = false});
  @override
  State<_ReactionBubble> createState() => _ReactionBubbleState();
}

class _ReactionBubbleState extends State<_ReactionBubble>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 2400))
    ..forward();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

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
                scale: widget.isTip ? 1.0 + t * 0.5 : 1.0,
                child: Text(widget.emoji, style: const TextStyle(fontSize: 28)),
              ),
            ),
          );
        },
      );
}

/// Full-screen confetti celebration shown when the local player wins.
/// A short one-shot particle burst rendered with a [CustomPainter]; calls
/// [onDone] so its host [OverlayEntry] can remove itself.
class _WinBurst extends StatefulWidget {
  final VoidCallback onDone;
  const _WinBurst({required this.onDone});

  @override
  State<_WinBurst> createState() => _WinBurstState();
}

class _WinBurstState extends State<_WinBurst>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  );
  late final List<_Confetto> _pieces;

  static const _palette = [
    AppColors.ludoRed,
    AppColors.ludoGreen,
    AppColors.ludoYellow,
    AppColors.ludoBlue,
    Color(0xFFFFFFFF),
  ];

  @override
  void initState() {
    super.initState();
    final rnd = math.Random();
    // Two launch points near the top corners so the burst reads as fireworks
    // fountaining inward across the screen.
    _pieces = List.generate(90, (i) {
      final fromLeft = i.isEven;
      final ox = fromLeft ? 0.18 : 0.82;
      final angle = (fromLeft ? -0.15 : math.pi + 0.15) +
          (rnd.nextDouble() - 0.5) * 1.5;
      final speed = 0.55 + rnd.nextDouble() * 0.75;
      return _Confetto(
        originX: ox,
        vx: math.cos(angle) * speed,
        vy: -(0.9 + rnd.nextDouble() * 0.9),
        color: _palette[rnd.nextInt(_palette.length)],
        size: 5 + rnd.nextDouble() * 7,
        spin: (rnd.nextDouble() - 0.5) * 8,
        delay: rnd.nextDouble() * 0.25,
      );
    });
    _c.forward().whenComplete(widget.onDone);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(
          size: Size.infinite,
          painter: _ConfettiPainter(_pieces, _c.value),
        ),
      ),
    );
  }
}

class _Confetto {
  final double originX; // 0..1 of width
  final double vx, vy; // initial velocity (screen fractions/sec-ish)
  final Color color;
  final double size;
  final double spin;
  final double delay; // 0..1 of the timeline before this piece launches
  const _Confetto({
    required this.originX,
    required this.vx,
    required this.vy,
    required this.color,
    required this.size,
    required this.spin,
    required this.delay,
  });
}

class _ConfettiPainter extends CustomPainter {
  final List<_Confetto> pieces;
  final double t; // 0..1
  _ConfettiPainter(this.pieces, this.t);

  @override
  void paint(Canvas canvas, Size size) {
    final g = 1.8; // gravity
    for (final p in pieces) {
      final lt = ((t - p.delay) / (1 - p.delay)).clamp(0.0, 1.0);
      if (lt <= 0) continue;
      // Simple projectile: position integrated from initial velocity + gravity.
      final x = size.width * p.originX + p.vx * size.width * 0.6 * lt;
      final y = size.height * 0.16 +
          (p.vy * lt + 0.5 * g * lt * lt) * size.height * 0.7;
      final opacity = (1 - lt).clamp(0.0, 1.0);
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(p.spin * lt);
      final paint = Paint()..color = p.color.withOpacity(opacity);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: Offset.zero, width: p.size, height: p.size * 0.6),
          const Radius.circular(1.5),
        ),
        paint,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ConfettiPainter old) => old.t != t;
}
