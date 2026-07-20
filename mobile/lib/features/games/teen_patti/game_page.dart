import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';
import 'dart:math' as math;
import '../../../core/audio/sound_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/constants/socket_events.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/network/api_client.dart';
import '../../../core/services/balance_service.dart';
import '../../../core/monitor/monitor_service.dart';
import '../../../shared/theme/app_theme.dart';
import 'coin_rain.dart';
import '../../../core/constants/app_config.dart';
import 'package:share_plus/share_plus.dart';
import 'package:lottie/lottie.dart';

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
//   10. Chat / tip overlays (conditional)
//   11. Result overlay (AnimatedSwitcher, no Positioned in ScaleTransition)
//
//  Anti-flicker: all mutable state flows through ValueNotifiers; only leaf
//  widgets rebuild. No setState inside build or listener callbacks.
// ─────────────────────────────────────────────────────────────────────────────
class TeenPattiGamePage extends StatefulWidget {
  final String roomId;
  final Map<String, dynamic>? initialData;
  const TeenPattiGamePage(
      {super.key, required this.roomId, this.initialData});
  @override
  State<TeenPattiGamePage> createState() => _TeenPattiGamePageState();
}

class _TeenPattiGamePageState extends State<TeenPattiGamePage>
    with TickerProviderStateMixin {
  final _socket = SocketService();
  final _api = ApiClient();

  // Friends "Same Table" rematch flips us to a brand-new game page via
  // pushReplacement. The new page's initState re-locks landscape, but the OLD
  // page's dispose fires after the transition and would reset orientation to
  // portrait — clobbering the landscape lock and leaving the 2nd+ hand in
  // portrait. This static flag is raised just before the rematch navigation so
  // the disposing page knows to skip its portrait reset (and lowers it again).
  static bool _rematchInFlight = false;

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
    1: [(0.15, 0.20)], // top-left
    2: [(0.15, 0.20), (0.85, 0.20)], // top-left, top-right
    3: [
      (0.08, 0.65),
      (0.15, 0.20),
      (0.85, 0.20)
    ], // bottom-left, top-left, top-right
    4: [
      (0.08, 0.65),
      (0.15, 0.20),
      (0.85, 0.20),
      (0.92, 0.65)
    ], // bottom-left, top-left, top-right, bottom-right
    5: [
      (0.08, 0.68),
      (0.08, 0.30),
      (0.28, 0.20),
      (0.72, 0.20),
      (0.92, 0.30)
    ], // bottom-left, mid-left, top-left, top-right, mid-right
  };

  // Derived seat dimensions (updated via _ls in build)
  double get _seatW => (100 * _ls).clamp(68, 118);
  double get _seatCH => (130 * _ls).clamp(90, 150); // container height
  double get _cardW => (58 * _ls).clamp(40, 76); // player card width
  double get _cardHt => (84 * _ls).clamp(58, 110); // player card height

  // ── ValueNotifiers ────────────────────────────────────────────────────────
  final _gsNotifier = ValueNotifier<Map<String, dynamic>?>(null);
  final _myTurnNotifier = ValueNotifier<bool>(false);
  final _timerNotifier = ValueNotifier<int>(30);
  // Holds the structured showdown result once a hand ends: {won, winnerName,
  // cards, handRank, prizeText}. null while the hand is still in progress.
  final _resultNotifier = ValueNotifier<Map<String, dynamic>?>(null);
  final _myCardsNotifier = ValueNotifier<List<Map<String, dynamic>>>([]);
  final _reactionsNotifier = ValueNotifier<List<_Reaction>>([]);
  late final _betNotifier = ValueNotifier<double>(0);

  String? _myUserId;
  bool _isSeen = false;
  int _turnSeq = 0;
  double _betAmount = 0;
  double _myBalance = 0; // fetched from wallet API and kept live
  Timer? _turnTimer;
  StreamSubscription? _reconnectSub;
  StreamSubscription? _errorSub;
  StreamSubscription? _roomJoinedSub;
  StreamSubscription? _gameStateSub;
  StreamSubscription? _gameResultSub;
  StreamSubscription? _roomChatSub;
  StreamSubscription? _roomTipSub;
  StreamSubscription? _nextHandSub;
  StreamSubscription? _privateClosedSub;
  Timer? _rematchTimer;
  final _rematchSecsNotifier = ValueNotifier<int>(-1); // -1 = hidden
  final _tipBannerNotifier = ValueNotifier<String?>(null);
  Timer? _tipBannerTimer;

  // Friends tables: the invite code rides in on room:joined so the result
  // overlay can offer "Same Table" and the server can auto-start the rematch.
  String? get _privateCode => widget.initialData?['private_code']?.toString();
  StreamSubscription? _sideshowPromptSub;
  StreamSubscription? _sideshowRevealSub;
  StreamSubscription? _sideshowResultSub;
  Timer? _sideshowPromptTimer;
  bool _ready = false;
  bool _showEmojiTray = false;
  bool _showTipMenu = false;
  int _reactionId = 0;

  // Quick emojis with blowing kiss 😘
  List<String> _quickEmojis = ['😀', '😂', '😎', '😘', '😭', '🔥', '👏', '🤔'];

  final _tipTriggerNotifier = ValueNotifier<int>(0);
  bool _isDealingCards = false;
  List<_FlyingCard> _flyingCards = [];
  String? _currentHandId;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  @override
  void initState() {
    super.initState();
    SoundService.instance.init();
    // Lock to landscape for the game table.
    SystemChrome.setPreferredOrientations(
        [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _init();
    SoundService.instance.loopAmbience('casino_bgm.mp3');
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    precacheImage(const AssetImage('assets/images/card_back.png'), context);
    precacheImage(const AssetImage('assets/images/dealer_avatar.png'), context);
    precacheImage(const AssetImage('assets/images/avatar_steven.png'), context);
    precacheImage(
        const AssetImage('assets/images/avatar_nairobi.png'), context);
    precacheImage(const AssetImage('assets/images/avatar_smith.png'), context);
    precacheImage(const AssetImage('assets/images/avatar_user.png'), context);
  }

  @override
  void dispose() {
    SoundService.instance.stopAmbience();
    _reconnectSub?.cancel();
    _errorSub?.cancel();
    _roomJoinedSub?.cancel();
    _gameStateSub?.cancel();
    _gameResultSub?.cancel();
    _roomChatSub?.cancel();
    _roomTipSub?.cancel();
    _nextHandSub?.cancel();
    _privateClosedSub?.cancel();
    _rematchTimer?.cancel();
    _rematchSecsNotifier.dispose();
    _tipBannerTimer?.cancel();
    _tipBannerNotifier.dispose();
    _tipTriggerNotifier.dispose();
    _sideshowPromptSub?.cancel();
    _sideshowRevealSub?.cancel();
    _sideshowResultSub?.cancel();
    _sideshowPromptTimer?.cancel();
    _turnTimer?.cancel();
    for (final n in [
      _gsNotifier,
      _myTurnNotifier,
      _timerNotifier,
      _resultNotifier,
      _myCardsNotifier,
      _reactionsNotifier,
      _betNotifier,
    ]) {
      n.dispose();
    }
    // Restore portrait when leaving the game — but NOT when a friends-table
    // rematch is swapping us onto a fresh game page (which stays landscape).
    // Otherwise this dispose would run after the new page's initState and
    // clobber its landscape lock, flipping continue-hands to portrait.
    if (_rematchInFlight) {
      _rematchInFlight = false;
    } else {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
      ]);
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    }
    super.dispose();
  }

  // ── Live init ─────────────────────────────────────────────────────────────
  List<Map<String, dynamic>> _mapPlayers(List raw) => raw.map((p) {
        if (p is! Map) return <String, dynamic>{};
        final m = Map<String, dynamic>.from(p);
        m['user_id'] ??= m['userId'];
        m['userId'] ??= m['user_id'];
        return m;
      }).toList();

  String? get _effectivePrivateCode {
    final gs = _gsNotifier.value;
    return gs?['private_code']?.toString() ??
        widget.initialData?['private_code']?.toString();
  }

  void _inviteFriend() {
    final code = _effectivePrivateCode ?? widget.roomId;
    Clipboard.setData(ClipboardData(text: code));
    Share.share('Join my Teen Patti table! Room Code: $code');
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Invite code/Room ID $code copied to clipboard!')),
    );
  }

  void _applyRoomJoinedData(Map<String, dynamic> data) {
    _myCardsNotifier.value =
        (data['my_cards'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final rawState = data['state'] as Map? ?? data;
    final players = _mapPlayers(rawState['players'] as List? ?? []);
    final me = players.firstWhere(
        (p) => (p['userId'] ?? p['user_id']) == _myUserId,
        orElse: () => <String, dynamic>{});
    _isSeen = me['is_seen'] ?? me['isSeen'] ?? false;

    final Map<String, dynamic> gs = {
      ...Map<String, dynamic>.from(rawState),
      'pot': data['pot'] ?? rawState['pot'] ?? 0,
      'min_bet': data['min_bet'] ?? rawState['min_bet'] ?? 0,
      'current_turn': data['current_turn'] ?? rawState['current_turn'] ?? 0,
      'players': players,
    };
    _gsNotifier.value = gs;
    _betAmount = (data['min_bet'] as num?)?.toDouble() ?? 0;
    _betNotifier.value = _betAmount;
    final idx = ((gs['current_turn'] ?? 0) as num).toInt();
    final cur = idx < players.length ? players[idx] : null;
    final isMe = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
    _myTurnNotifier.value = isMe;
    if (isMe && (_turnTimer == null || !_turnTimer!.isActive))
      _startTurnTimer();

    // Trigger card dealing animation
    if (gs['status'] == 'active' || gs['status'] == 'playing') {
      _triggerCardDealingAnimation(gs);
    } else {
      SoundService.instance.play(Sfx.cardDeal);
    }
  }

  Future<void> _loadConfig() async {
    try {
      final res = await _api.dio.get('/api/admin/config/emojis');
      final emojis = (res.data as List?)?.cast<String>();
      if (emojis != null && emojis.isNotEmpty && mounted)
        setState(() => _quickEmojis = emojis);
    } catch (_) {/* keep defaults on error */}
  }

  Future<void> _fetchBalance() async {
    try {
      final res = await _api.dio.get('/api/wallet/balance');
      if (!mounted) return;
      final val =
          double.tryParse(res.data['real_balance']?.toString() ?? '0') ?? 0;
      setState(() => _myBalance = val);
      BalanceService.instance.set(realBalance: val);
    } catch (_) {/* leave at 0 if wallet unreachable */}
  }

  Future<void> _init() async {
    _myUserId = await SecureStorage.getUserId();
    _loadConfig(); // fire-and-forget
    _fetchBalance(); // load wallet balance for the action bar display
    MonitorService.instance
        .game('tp_join_room', properties: {'room_id': widget.roomId});
    _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId});
    _reconnectSub = _socket.on('reconnect').listen(
        (_) => _socket.emit(SocketEvents.joinRoom, {'room_id': widget.roomId}));

    if (widget.initialData != null)
      _applyRoomJoinedData(Map<String, dynamic>.from(widget.initialData!));

    if (mounted) setState(() => _ready = true);

    _roomJoinedSub = _socket.on(SocketEvents.roomJoined).listen(
        (data) => _applyRoomJoinedData(Map<String, dynamic>.from(data)));

    _gameStateSub = _socket.on(SocketEvents.gameStateUpdate).listen((data) {
      if (!mounted) return;
      final inner = data['state'] as Map<String, dynamic>? ?? data;
      final players = _mapPlayers(inner['players'] as List? ?? []);
      final Map<String, dynamic> gs = {
        ...Map<String, dynamic>.from(inner),
        'players': players
      };
      _gsNotifier.value = gs;

      // Trigger card dealing animation
      if (gs['status'] == 'active' || gs['status'] == 'playing') {
        _triggerCardDealingAnimation(gs);
      }

      final idx =
          ((inner['current_turn'] ?? inner['CurrentTurn'] ?? 0) as num).toInt();
      final cur = idx < players.length ? players[idx] : null;
      final isMe = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
      final wasMyTurn = _myTurnNotifier.value;
      _myTurnNotifier.value = isMe;
      if (isMe && !wasMyTurn) {
        _startTurnTimer();
        _maybeWarnLowBalance();
      } else if (!isMe) {
        _turnTimer?.cancel();
      }
    });

    // Server rejected an action (e.g. wallet lock failed on a low balance).
    // _sendAction already hid the action bar and deducted the bet optimistically,
    // so without this the player is left stuck with no buttons while the server
    // still waits on their turn — restore the turn UI and let them Pack.
    _errorSub = _socket.on(SocketEvents.errorEvent).listen((data) {
      if (!mounted) return;
      final msg =
          (data is Map ? data['message'] : data)?.toString() ?? 'Action failed';
      _fetchBalance(); // undo the optimistic deduction with the server truth
      final gs = _gsNotifier.value;
      if (gs == null || gs['status'] == 'completed') return;
      final players = (gs['players'] as List?) ?? [];
      final idx =
          ((gs['current_turn'] ?? gs['CurrentTurn'] ?? 0) as num).toInt();
      final cur = idx < players.length ? players[idx] as Map? : null;
      final stillMyTurn = (cur?['userId'] ?? cur?['user_id']) == _myUserId;
      if (stillMyTurn && !_myTurnNotifier.value) {
        _myTurnNotifier.value = true;
        _startTurnTimer();
      }
      if (msg.toLowerCase().contains('insufficient balance')) {
        final stake = (gs['min_bet'] as num?)?.toDouble() ?? 0;
        _showLowBalanceDialog(_isSeen ? stake * 2 : stake);
      } else {
        AppSnackBar.show(context, msg, error: true);
      }
    });

    _gameResultSub = _socket.on(SocketEvents.gameResult).listen((data) {
      if (!mounted) return;
      try {
        _turnTimer?.cancel();
        final won = data['winner_id'] == _myUserId;
        MonitorService.instance.game('tp_result', properties: {
          'won': won,
          'prize': data['prize']?.toString() ?? '0',
          'room_id': widget.roomId,
        });
        final prizeAmount = double.tryParse(data['prize']?.toString() ?? '0') ?? 0.0;
        final winnerName = data['winner_username']?.toString() ?? 'Unknown';

        // Pull the winner's revealed cards + hand rank from the showdown
        // payload (all_hands) so the popup can show what actually won.
        final allHands = (data['all_hands'] as List?) ?? [];
        Map<String, dynamic>? winnerHand;
        for (final h in allHands) {
          if (h is Map &&
              h['user_id']?.toString() == data['winner_id']?.toString()) {
            winnerHand = Map<String, dynamic>.from(h);
            break;
          }
        }
        final winnerCards = (winnerHand?['cards'] as List?)
                ?.map((c) => Map<String, dynamic>.from(c as Map))
                .toList() ??
            <Map<String, dynamic>>[];
        final handRank = (winnerHand?['hand_rank'] ?? data['hand_rank'])
            ?.toString();

        _resultNotifier.value = {
          'won': won,
          'winnerName': winnerName,
          'cards': winnerCards,
          'handRank': handRank,
          'prizeText': '₹${prizeAmount.toStringAsFixed(2)}',
        };
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
        if (_privateCode != null) _startRematchCountdown();
      } catch (e) {
        print('[TeenPattiGamePage] Error processing game:result: $e');
        if (mounted) {
          AppSnackBar.show(context, 'Game ended but failed to display result', error: true);
        }
      }
    });

    _roomChatSub = _socket.on(SocketEvents.roomChatMsg).listen((data) {
      if (!mounted || data is! Map) return;
      final type = (data['type'] ?? 'text').toString();
      final msg = _ChatMsg(
          userId: data['user_id']?.toString() ?? '',
          username: data['username']?.toString() ?? 'Player',
          text: data['message']?.toString() ?? '',
          type: type);
      if (msg.userId != _myUserId && type != 'text') {
        _spawnReaction(msg.userId, msg.text);
      }
    });

    // Friends tables: the server re-opens the lobby after each hand and
    // auto-starts the next one — a fresh room:joined moves us to that table.
    if (_privateCode != null) {
      _nextHandSub = _socket.on(SocketEvents.roomJoined).listen((data) {
        if (!mounted || data is! Map) return;
        final newRoom = data['room_id']?.toString();
        if (newRoom == null || newRoom == widget.roomId) return;
        _rematchTimer?.cancel();
        // Keep landscape across the rematch — tell the disposing page not to
        // restore portrait (see _rematchInFlight).
        _rematchInFlight = true;
        context.pushReplacement('/games/teen-patti/play/$newRoom',
            extra: Map<String, dynamic>.from(data));
      });
      _privateClosedSub = _socket.on('private:closed').listen((data) {
        if (!mounted) return;
        final reason =
            (data is Map ? data['reason']?.toString() : null) ?? 'Table closed';
        AppSnackBar.show(context, reason);
        _doExit();
      });
    }

    // Dealer tips — server broadcasts after the wallet debit succeeds, so
    // everyone seated at the table sees the same golden banner + coin.
    _roomTipSub = _socket.on('room:tip').listen((data) {
      if (!mounted || data is! Map) return;
      final userId = data['user_id']?.toString() ?? '';
      final name = data['username']?.toString() ?? 'Player';
      final amount = (data['amount'] as num?)?.toInt() ?? 0;
      _spawnReaction(userId, '💰 ₹$amount', isTip: true);

      // Increment tip trigger for hostess animation
      _tipTriggerNotifier.value++;

      final who = userId == _myUserId ? 'You' : name;
      _tipBannerNotifier.value = '💰 $who tipped the dealer ₹$amount';
      _tipBannerTimer?.cancel();
      _tipBannerTimer = Timer(2600.ms, () {
        if (mounted) _tipBannerNotifier.value = null;
      });
      SoundService.instance.play(Sfx.chipBet);
      if (userId == _myUserId) {
        _fetchBalance(); // reflect the debit with the server truth
      }
    });

    // ── Sideshow ──
    // Prompt lands only on the target's socket; accept/reject within 10s.
    _sideshowPromptSub = _socket.on('game:sideshow_prompt').listen((data) {
      if (!mounted || data is! Map) return;
      if (data['target_id']?.toString() != _myUserId) return;
      _showSideshowPromptDialog(
          data['requester_username']?.toString() ?? 'Player');
    });

    // Reveal is private to the two involved players.
    _sideshowRevealSub = _socket.on('game:sideshow_reveal').listen((data) {
      if (!mounted || data is! Map) return;
      _showSideshowRevealDialog(Map<String, dynamic>.from(data));
    });

    // Room-wide outcome (no cards) — tell the requester if they were refused.
    _sideshowResultSub = _socket.on('game:sideshow_result').listen((data) {
      if (!mounted || data is! Map) return;
      final accepted = data['accepted'] == true;
      if (!accepted && data['requester_id']?.toString() == _myUserId) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Sideshow rejected — your turn continues'),
          duration: Duration(seconds: 2),
        ));
      }
    });
  }

  // ── Sideshow dialogs ───────────────────────────────────────────────────────
  void _showSideshowPromptDialog(String requesterName) {
    _sideshowPromptTimer?.cancel();
    var secondsLeft = 10;
    bool answered = false;
    HapticFeedback.mediumImpact();

    void answer(BuildContext dialogCtx, bool accept) {
      if (answered) return;
      answered = true;
      _sideshowPromptTimer?.cancel();
      Navigator.of(dialogCtx, rootNavigator: true).pop();
      _sendAction(accept ? 'sideshow_accept' : 'sideshow_reject');
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => StatefulBuilder(builder: (ctx, setDlg) {
        _sideshowPromptTimer ??=
            Timer.periodic(const Duration(seconds: 1), (t) {
          secondsLeft--;
          if (secondsLeft <= 0) {
            t.cancel();
            if (ctx.mounted) answer(dialogCtx, false); // timeout = reject
          } else if (ctx.mounted) {
            setDlg(() {});
          }
        });
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1B2E),
          title: const Text('Sideshow Request 👀',
              style: TextStyle(color: Colors.white)),
          content: Text(
            '$requesterName wants to compare cards with you.\n'
            'Accept and you both privately see each other\'s cards.\n\n'
            'Auto-reject in $secondsLeft s',
            style: const TextStyle(color: Colors.white70),
          ),
          actions: [
            TextButton(
              onPressed: () => answer(dialogCtx, false),
              child: const Text('Reject',
                  style: TextStyle(color: Colors.redAccent)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo),
              onPressed: () => answer(dialogCtx, true),
              child: const Text('Accept'),
            ),
          ],
        );
      }),
    ).then((_) {
      _sideshowPromptTimer?.cancel();
      _sideshowPromptTimer = null;
    });
  }

  void _showSideshowRevealDialog(Map<String, dynamic> data) {
    final iAmRequester = data['requester_id']?.toString() == _myUserId;
    final theirName = iAmRequester
        ? (data['target_username']?.toString() ?? 'Opponent')
        : (data['requester_username']?.toString() ?? 'Opponent');
    final myCards = ((iAmRequester
                ? data['requester_cards']
                : data['target_cards']) as List? ??
            [])
        .cast<Map<String, dynamic>>();
    final theirCards = ((iAmRequester
                ? data['target_cards']
                : data['requester_cards']) as List? ??
            [])
        .cast<Map<String, dynamic>>();

    Widget hand(String label, List<Map<String, dynamic>> cards) => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label,
                style: const TextStyle(color: Colors.white70, fontSize: 13)),
            const SizedBox(height: 6),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final c in cards)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: SizedBox(
                      width: 44,
                      height: 62,
                      child: _buildCard(
                          c['value'].toString(), c['suit'].toString()),
                    ),
                  ),
              ],
            ),
          ],
        );

    HapticFeedback.heavyImpact();
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF1A1B2E),
        title: const Text('Sideshow 🔍', style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            hand('$theirName\'s cards', theirCards),
            const SizedBox(height: 16),
            hand('Your cards', myCards),
            const SizedBox(height: 12),
            Text(
              iAmRequester
                  ? 'Your turn — decide Chaal or Pack.'
                  : 'Their turn continues.',
              style: const TextStyle(color: Colors.amber, fontSize: 12),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context, rootNavigator: true).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  void _startTurnTimer() {
    _turnTimer?.cancel();
    _timerNotifier.value = 30;
    HapticFeedback.lightImpact();
    Timer(90.ms, HapticFeedback.lightImpact);
    SystemSound.play(SystemSoundType.click);
    _turnTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      final n = _timerNotifier.value - 1;
      _timerNotifier.value = n;
      if (n > 0 && n <= 5) HapticFeedback.selectionClick();
      if (n <= 0) {
        t.cancel();
        _sendAction('fold');
      }
    });
  }

  /// Cost of [action] right now, using the same rules the gateway locks with.
  double _actionCost(String action, {double? amount}) {
    final gs = _gsNotifier.value;
    final stake = (gs?['min_bet'] as num?)?.toDouble() ?? 0;
    switch (action) {
      case 'call':
        return _isSeen ? stake * 2 : stake;
      case 'raise':
        return amount ?? stake * 2;
      case 'show':
        return _isSeen ? stake * 2 : stake;
      case 'sideshow':
        return stake * 2;
      default:
        return 0; // fold / see / sideshow answers are free
    }
  }

  /// Paid actions go through here: if the wallet can't cover the cost the
  /// server would reject it and freeze the turn, so warn first and offer Pack.
  void _guardedAction(String action, {double? amount}) {
    final cost = _actionCost(action, amount: amount);
    if (cost > 0 && _myBalance < cost) {
      HapticFeedback.mediumImpact();
      _showLowBalanceDialog(cost);
      return;
    }
    _sendAction(action, amount: amount);
  }

  // One warning per turn so the timer countdown doesn't re-trigger it.
  bool _lowBalWarned = false;

  void _maybeWarnLowBalance() {
    final gs = _gsNotifier.value;
    final stake = (gs?['min_bet'] as num?)?.toDouble() ?? 0;
    final nextChaal = _isSeen ? stake * 2 : stake;
    if (nextChaal <= 0 || _myBalance >= nextChaal) {
      _lowBalWarned = false;
      return;
    }
    if (_lowBalWarned) return;
    _lowBalWarned = true;
    _showLowBalanceDialog(nextChaal);
  }

  void _showLowBalanceDialog(double cost) {
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1B2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                color: AppColors.orange, size: 22),
            SizedBox(width: 8),
            Text('Low Balance',
                style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Text(
          'The next Chaal costs ₹${cost.toInt()} but you only have '
          '₹${_myBalance.toInt()}.\n\nYou can Pack now to fold this hand, '
          'or add money after the game.',
          style: const TextStyle(
              color: Colors.white70, fontSize: 13.5, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx, rootNavigator: true).pop(),
            child: const Text('Keep Playing',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(dialogCtx, rootNavigator: true).pop();
              _sendAction('fold');
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text('Pack',
                style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  void _sendAction(String action, {double? amount}) {
    _turnTimer?.cancel();
    _myTurnNotifier.value = false;
    if (action == 'show') _isSeen = true;
    SoundService.instance.play(action == 'fold' ? Sfx.buttonTap : Sfx.chipBet);
    MonitorService.instance.game('tp_action',
        properties: {'action': action, if (amount != null) 'amount': amount});

    // Optimistically deduct bet from displayed balance so it updates immediately.
    // 'see' (look at cards) and sideshow accept/reject have no wallet cost —
    // call/raise/show deduct, and a sideshow request costs a seen chaal (2x).
    // Server confirms via wallet lock; we re-fetch on game:result for the final value.
    if (action == 'call' || action == 'raise' || action == 'show') {
      final gs = _gsNotifier.value;
      final stake = (gs?['min_bet'] as num?)?.toDouble() ?? 0;
      final bet = amount ?? (_isSeen ? stake * 2 : stake);
      if (bet > 0)
        setState(
            () => _myBalance = (_myBalance - bet).clamp(0, double.infinity));
    } else if (action == 'sideshow') {
      final gs = _gsNotifier.value;
      final stake = (gs?['min_bet'] as num?)?.toDouble() ?? 0;
      final bet = stake * 2;
      if (bet > 0)
        setState(
            () => _myBalance = (_myBalance - bet).clamp(0, double.infinity));
    }

    MonitorService.instance.wsMessage('send', SocketEvents.gameAction);
    _socket.emit(SocketEvents.gameAction, {
      'room_id': widget.roomId,
      'action': action,
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

  void _sendTip(int amount) {
    // No optimistic reaction/balance change — the server broadcasts room:tip
    // only after the wallet debit succeeds.
    _socket.emit('room:tip', {'room_id': widget.roomId, 'amount': amount});
    SoundService.instance.play(Sfx.chipBet);
    HapticFeedback.mediumImpact();
  }

  void _spawnReaction(String userId, String emoji, {bool isTip = false}) {
    final r = _Reaction(
        id: ++_reactionId, userId: userId, emoji: emoji, isTip: isTip);
    _reactionsNotifier.value = [..._reactionsNotifier.value, r];
    if (userId != _myUserId)
      SoundService.instance.play(Sfx.buttonTap, volume: 0.5);
    Timer(7600.ms, () {
      if (!mounted) return;
      _reactionsNotifier.value =
          _reactionsNotifier.value.where((x) => x.id != r.id).toList();
    });
  }

  String? _chipsOf(Map<String, dynamic> p) {
    final v = p['chips'] ?? p['balance'] ?? p['stack'];
    return v == null ? null : num.tryParse(v.toString())?.toStringAsFixed(0);
  }

  // Friends tables: 10s client countdown while the server (12s) deals the
  // next hand automatically. Players who want out tap Exit Lobby in time.
  void _startRematchCountdown() {
    _rematchTimer?.cancel();
    _rematchSecsNotifier.value = 10;
    _rematchTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      final next = _rematchSecsNotifier.value - 1;
      _rematchSecsNotifier.value = next;
      if (next <= 0) t.cancel(); // 0 = "Starting next hand…" until room:joined
    });
  }

  void _exitPrivateTable() {
    _rematchTimer?.cancel();
    _socket.emit('private:leave', {'code': _privateCode});
    _doExit();
  }

  void _doExit() {
    _socket.emit('leave_room', {'room_id': widget.roomId});
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
              child:
                  const Text('Stay', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10))),
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

  bool _isReconnecting(String s) =>
      s.contains('reconnect') ||
      s.contains('connecting') ||
      s.contains('error');

  // ═══════════════════════════════════════════════════════════════════════════
  //  BUILD
  // ═══════════════════════════════════════════════════════════════════════════
  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmExit();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF060A1A),
        body: SafeArea(
          top: true,
          bottom: true,
          child: !_ready
              ? const Center(
                  child: CircularProgressIndicator(color: AppColors.gold))
              : LayoutBuilder(builder: (context, box) {
                  final w = box.maxWidth;
                  final h = box.maxHeight;
                  // Landscape layout — all dims scale from landscape height.
                  _ls = (h / 400.0).clamp(0.72, 1.5);
                  final topBarH = (40 * _ls).clamp(36.0, 52.0);
                  const rightPanelW = _rightPanelW;

                  final horizPadding = (56 * _ls).clamp(32.0, 80.0);
                  final vertPadding = (24 * _ls).clamp(16.0, 48.0);

                  final tw = w - rightPanelW - horizPadding;
                  final th = h - topBarH - vertPadding;
                  final tl = (w - rightPanelW - tw) / 2;
                  final tt = topBarH + vertPadding / 2;

                  return Stack(children: [
                    // ① Ambient background
                    _buildBackground(w, h),

                    // ② Poker table oval — wood border & red felt
                    _buildTableOval(tl, tt, tw, th),

                    // ②b Dealer Hostess (Beautiful woman with tipping animations)
                    Positioned(
                      top: tt - 36,
                      left: (w - _rightPanelW) / 2 - 40,
                      child: _HostessWidget(
                        tipTrigger: _tipTriggerNotifier,
                        onTipTap: () =>
                            setState(() => _showTipMenu = !_showTipMenu),
                        onInviteTap: _inviteFriend,
                        isDealing: _isDealingCards,
                      ),
                    ),

                    // ②c Tips Selection Menu (rendered horizontally under the Dealer)
                    if (_showTipMenu)
                      Positioned(
                        top: tt + 60,
                        left: (w - _rightPanelW) / 2 - 62,
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 4, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFF070B14)
                                  .withValues(alpha: 0.95),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                  color: const Color(0xFFD4AF37), width: 1.0),
                              boxShadow: const [
                                BoxShadow(
                                    color: Colors.black87,
                                    blurRadius: 8,
                                    offset: Offset(0, 3))
                              ],
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              // Must match the gateway's TIP_AMOUNTS whitelist.
                              children: [5, 10, 20, 50].map((amount) {
                                Color chipColor;
                                switch (amount) {
                                  case 5:
                                    chipColor = const Color(0xFF1976D2);
                                    break;
                                  case 10:
                                    chipColor = const Color(0xFF388E3C);
                                    break;
                                  case 20:
                                    chipColor = const Color(0xFFD32F2F);
                                    break;
                                  default:
                                    chipColor = const Color(0xFFFBC02D);
                                }
                                return GestureDetector(
                                  onTap: () {
                                    _sendTip(amount);
                                    setState(() {
                                      _showTipMenu = false;
                                    });
                                  },
                                  child: Container(
                                    margin: const EdgeInsets.symmetric(
                                        horizontal: 2),
                                    width: 24,
                                    height: 24,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                      gradient: RadialGradient(
                                        colors: [
                                          chipColor.withValues(alpha: 0.8),
                                          chipColor,
                                          Color.lerp(
                                              chipColor, Colors.black, 0.3)!,
                                        ],
                                        stops: const [0.3, 0.8, 1.0],
                                      ),
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                          color: Colors.white, width: 1.0),
                                      boxShadow: [
                                        BoxShadow(
                                            color: chipColor.withValues(
                                                alpha: 0.4),
                                            blurRadius: 2,
                                            offset: const Offset(0, 0.5))
                                      ],
                                    ),
                                    child: Container(
                                      width: 17,
                                      height: 17,
                                      alignment: Alignment.center,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: Colors.white
                                              .withValues(alpha: 0.4),
                                          width: 0.6,
                                        ),
                                      ),
                                      child: Text(
                                        '₹$amount',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 7.0,
                                          fontWeight: FontWeight.w900,
                                          shadows: [
                                            Shadow(
                                                color: Colors.black54,
                                                blurRadius: 1,
                                                offset: Offset(0, 0.5))
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                        )
                            .animate()
                            .scale(duration: 200.ms, curve: Curves.easeOutBack),
                      ),

                    // ③ Opponent seats & Invite seats
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) =>
                          _buildOpponentSeats(gs, w, h, tl, tt, tw, th),
                    ),

                    // ③b User seat (Bottom-center, green glowing outline)
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) =>
                          _buildUserSeat(gs, w, h, tl, tt, tw, th),
                    ),

                    // ⑤ User cards + See Cards btn — fanned out overlapping avatar
                    ValueListenableBuilder<List<Map<String, dynamic>>>(
                      valueListenable: _myCardsNotifier,
                      builder: (_, cards, __) => ValueListenableBuilder<bool>(
                        valueListenable: _myTurnNotifier,
                        builder: (_, isMyTurn, __) =>
                            _buildUserCards(cards, isMyTurn, w, tl, tt, tw, th),
                      ),
                    ),

                    // ⑥ Pot chip — upper-centre of table (black & gold capsule)
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) => _buildPotChip(gs, w, tt, tw, th),
                    ),
                    // ⑥b Variant chip — Muflis / Joker / AK47 rules reminder
                    ValueListenableBuilder<Map<String, dynamic>?>(
                      valueListenable: _gsNotifier,
                      builder: (_, gs, __) => _buildVariantChip(gs, tt, tw),
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

                    // ⑩ Floating reactions (Floating directly from the seat that sent them!)
                    ValueListenableBuilder<List<_Reaction>>(
                      valueListenable: _reactionsNotifier,
                      builder: (_, reactions, __) =>
                          _buildReactions(reactions, w, h, tl, tt, tw, th),
                    ),

                    // ⑩b Table-wide tip banner (everyone at the table sees it)
                    ValueListenableBuilder<String?>(
                      valueListenable: _tipBannerNotifier,
                      builder: (_, banner, __) => banner == null
                          ? const SizedBox.shrink()
                          : Positioned(
                              top: h * 0.30,
                              left: 0,
                              right: _rightPanelW,
                              child: Center(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 18, vertical: 9),
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(colors: [
                                      Color(0xFFFFE082),
                                      Color(0xFFD4AF37),
                                    ]),
                                    borderRadius: BorderRadius.circular(24),
                                    boxShadow: [
                                      BoxShadow(
                                          color: AppColors.gold
                                              .withValues(alpha: 0.55),
                                          blurRadius: 18,
                                          spreadRadius: 2),
                                    ],
                                  ),
                                  child: Text(banner,
                                      style: const TextStyle(
                                          color: Colors.black,
                                          fontWeight: FontWeight.w800,
                                          fontSize: 14)),
                                )
                                    .animate()
                                    .scale(
                                        begin: const Offset(0.4, 0.4),
                                        curve: Curves.elasticOut,
                                        duration: 600.ms)
                                    .then(delay: 1600.ms)
                                    .fadeOut(duration: 400.ms),
                              ),
                            ),
                    ),

                    // ⑪ Reconnect banner
                    ValueListenableBuilder<String>(
                      valueListenable: _socket.status,
                      builder: (_, sv, __) => _isReconnecting(sv)
                          ? _buildReconnectBanner(sv)
                          : const SizedBox.shrink(),
                    ),

                    // ⑫ Action bar
                    ValueListenableBuilder<bool>(
                      valueListenable: _myTurnNotifier,
                      builder: (_, isMyTurn, __) =>
                          ValueListenableBuilder<Map<String, dynamic>?>(
                        valueListenable: _resultNotifier,
                        builder: (_, result, __) => (isMyTurn && result == null)
                            ? ValueListenableBuilder<Map<String, dynamic>?>(
                                valueListenable: _gsNotifier,
                                builder: (_, gs, __) =>
                                    _buildActionBar(gs, w, h),
                              )
                            : const SizedBox.shrink(),
                      ),
                    ),

                    // ⑬ Emoji tray
                    if (_showEmojiTray) _buildEmojiTray(w, h),

                    // ⑭ Flying cards overlay
                    if (_isDealingCards) ..._buildFlyingCards(w, h),

                    // ⑮ Result overlay
                    Positioned.fill(
                      child: ValueListenableBuilder<Map<String, dynamic>?>(
                        valueListenable: _resultNotifier,
                        builder: (_, result, __) => AnimatedSwitcher(
                          duration: const Duration(milliseconds: 420),
                          transitionBuilder: (child, anim) => FadeTransition(
                            opacity: anim,
                            child: ScaleTransition(scale: anim, child: child),
                          ),
                          child: result != null
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
          child: Stack(
            children: [
              Container(
                decoration: const BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment(0.0, -0.3),
                    radius: 1.3,
                    colors: [
                      Color(0xFF16223F), // Luminous navy-blue
                      Color(0xFF0C1324), // Rich space blue
                      Color(0xFF05080F), // Deep black-blue
                    ],
                    stops: [0.0, 0.5, 1.0],
                  ),
                ),
              ),
              // Soft gold/purple ambient glow from top/center
              Positioned(
                top: -h * 0.2,
                left: w * 0.15,
                right: w * 0.15,
                height: h * 0.45,
                child: Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        const Color(0xFFD4AF37)
                            .withValues(alpha: 0.08), // soft gold aura
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  // ② Oval poker table — uses th*0.44 radius so side-seat area stays wide
  Widget _buildTableOval(double tl, double tt, double tw, double th) {
    final r = math.min(th * 0.44, tw * 0.22);
    final radius = BorderRadius.circular(r);
    return Positioned(
      left: tl,
      top: tt,
      width: tw,
      height: th,
      child: RepaintBoundary(
        child: Container(
          decoration: BoxDecoration(
            borderRadius: radius,
            gradient: const LinearGradient(
              colors: [
                Color(0xFF4A2525), // Polished mahogany
                Color(0xFF261010), // Shadowed wood
                Color(0xFF120505), // Deep grain shadow
                Color(0xFF261010),
                Color(0xFF4A2525),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            border: Border.all(color: const Color(0xFFD4AF37), width: 2.5),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: 0.8),
                  blurRadius: 36,
                  spreadRadius: 8,
                  offset: const Offset(0, 12)),
            ],
          ),
          child: Container(
            margin: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              borderRadius: radius - BorderRadius.circular(8),
              image: const DecorationImage(
                image: AssetImage('assets/images/table_felt_green.png'),
                fit: BoxFit.cover,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.6),
                  blurRadius: 14,
                  spreadRadius: 3,
                  offset: const Offset(0, 2),
                )
              ],
            ),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: radius - BorderRadius.circular(8),
                border: Border.all(
                    color: const Color(0xFFFFD700).withValues(alpha: 0.4),
                    width: 1.5),
              ),
              child: Center(
                child: Text(
                  'TEEN PATTI',
                  style: TextStyle(
                    color: const Color(0xFF7E1825).withValues(alpha: 0.35),
                    fontSize: tw * 0.08,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 8,
                    shadows: [
                      Shadow(
                        color: Colors.black.withValues(alpha: 0.3),
                        offset: const Offset(1, 2),
                        blurRadius: 2,
                      )
                    ],
                  ),
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
    Map<String, dynamic>? gs,
    double w,
    double h,
    double tl,
    double tt,
    double tw,
    double th,
  ) {
    final allPlayers = (gs?['players'] as List? ?? [])
        .map((p) => Map<String, dynamic>.from(p as Map))
        .toList();
    final opponents = allPlayers
        .where((p) => (p['user_id'] ?? p['userId']) != _myUserId)
        .toList();

    // Use fixed 4-seat coordinates layout so players stay at consistent positions and empty slots show invite buttons
    final posList = _tableSeats[4]!;

    return Stack(children: [
      // Active opponents
      for (var i = 0; i < opponents.length && i < posList.length; i++)
        _positionedSeat(opponents[i], gs, posList[i], w, h, tl, tt, tw, th),

      // Empty slots rendered as invite buttons
      for (var i = opponents.length; i < posList.length; i++)
        _positionedInviteSeat(posList[i], w, h, tl, tt, tw, th),
    ]);
  }

  Widget _positionedInviteSeat(
    (double, double) frac,
    double w,
    double h,
    double tl,
    double tt,
    double tw,
    double th,
  ) {
    final cx = tl + tw * frac.$1;
    final cy = tt + th * frac.$2;
    final sw = _seatW * 1.35;
    final sh = _seatCH;
    final sl = (cx - sw / 2).clamp(4.0, w - _rightPanelW - sw - 4.0);
    final st = (cy - sh / 2).clamp(tt - 16.0, h - sh - 4.0);

    return Positioned(
      left: sl,
      top: st,
      width: sw,
      child: GestureDetector(
        onTap: _inviteFriend,
        child: SizedBox(
          height: sh,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.black.withValues(alpha: 0.25),
                  border: Border.all(
                    color: const Color(0xFFFFD43F).withValues(alpha: 0.6),
                    width: 1.5,
                  ),
                ),
                child: const Icon(
                  Icons.add_rounded,
                  color: Color(0xFFFFD43F),
                  size: 24,
                ),
              ),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFD43F).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                      color: const Color(0xFFFFD43F).withValues(alpha: 0.4),
                      width: 0.8),
                ),
                child: const Text(
                  'INVITE',
                  style: TextStyle(
                    color: Color(0xFFFFD43F),
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _positionedSeat(
    Map<String, dynamic> p,
    Map<String, dynamic>? gs,
    (double, double) frac,
    double w,
    double h,
    double tl,
    double tt,
    double tw,
    double th,
  ) {
    final sw = _seatW * 1.35;
    final sh = _seatCH; // Opponent height is just the seat height
    // Centre of seat widget in screen pixels, table-relative
    final cx = tl + tw * frac.$1;
    final cy = tt + th * frac.$2;
    // Allow seats to overlap the wood border (like the reference design)
    // and clamp only to prevent clipping off the screen.
    final sl = (cx - sw / 2).clamp(4.0, w - _rightPanelW - sw - 4.0);
    final st = (cy - sh / 2).clamp(tt - 16.0, h - sh - 4.0);

    return Positioned(
      key: ValueKey('seat_${p['user_id'] ?? p['userId']}'),
      left: sl,
      top: st,
      width: sw,
      child:
          RepaintBoundary(child: _buildSeatWidget(p, gs, sw, fracX: frac.$1)),
    );
  }

  String? _getAvatarAsset(String username, bool isMe) {
    if (isMe) return 'assets/images/avatar_user.png';
    final name = username.toLowerCase();
    if (name.contains('steven')) return 'assets/images/avatar_steven.png';
    if (name.contains('nairobi')) return 'assets/images/avatar_nairobi.png';
    if (name.contains('smith')) return 'assets/images/avatar_smith.png';
    return null;
  }

  Widget _buildSeatWidget(
      Map<String, dynamic> p, Map<String, dynamic>? gs, double sw,
      {bool isMe = false, double fracX = 0.5}) {
    final uid = (p['user_id'] ?? p['userId'])?.toString() ?? '';
    final isFolded = p['status'] == 'folded';
    final isBot = p['is_bot'] == true;
    final players = (gs?['players'] as List?) ?? [];
    final turnIdx =
        ((gs?['current_turn'] ?? gs?['CurrentTurn'] ?? -1) as num).toInt();
    final turnUid = gs?['current_turn_user_id'] ??
        (turnIdx >= 0 && turnIdx < players.length
            ? (players[turnIdx] as Map)['user_id'] ??
                (players[turnIdx] as Map)['userId']
            : null);
    final isTurn = turnUid == uid;
    final isDealer = gs?['dealer_id'] == uid;
    final (statusLabel, statusColor) = _statusOf(p);
    final chips = _chipsOf(p);

    final avatarD = (52 * _ls).clamp(42.0, 68.0);
    final avatarR = avatarD * 0.5;
    final badgeD = (16 * _ls).clamp(12.0, 20.0);
    final fUsername = (11 * _ls).clamp(9.0, 14.0);
    final fChips = (9.0 * _ls).clamp(8.0, 12.0);

    final avatarAsset = _getAvatarAsset(p['username']?.toString() ?? '', isMe);

    final avatarColumn = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Avatar Stack
        Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            // Glow outline
            Container(
              width: avatarD + 6,
              height: avatarD + 6,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isMe
                      ? const Color(0xFF2ECC71)
                      : (isTurn
                          ? const Color(0xFF2ECC71)
                          : const Color(0xFFD4AF37).withValues(alpha: 0.45)),
                  width: (isMe || isTurn) ? 2.5 : 1.5,
                ),
                boxShadow: (isMe || isTurn)
                    ? [
                        BoxShadow(
                          color:
                              const Color(0xFF2ECC71).withValues(alpha: 0.45),
                          blurRadius: 12,
                          spreadRadius: 2,
                        )
                      ]
                    : [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.3),
                          blurRadius: 4,
                          offset: const Offset(0, 2),
                        )
                      ],
              ),
              child: isTurn
                  ? ValueListenableBuilder<int>(
                      valueListenable: _timerNotifier,
                      builder: (_, secs, __) => CircularProgressIndicator(
                        value: (secs / 30).clamp(0.0, 1.0),
                        strokeWidth: 3.0,
                        backgroundColor: Colors.transparent,
                        valueColor: AlwaysStoppedAnimation(secs <= 5
                            ? const Color(0xFFE53935)
                            : const Color(0xFF2ECC71)),
                      ),
                    )
                  : null,
            ),

            // Avatar Image / Circle
            ValueListenableBuilder<List<_Reaction>>(
              valueListenable: _reactionsNotifier,
              builder: (_, reactions, child) {
                final myRx =
                    reactions.where((r) => r.userId == uid).firstOrNull;
                if (myRx == null) return child!;

                // Apply animation effect based on emoji
                final emoji = myRx.emoji;
                if (emoji == '👏' || emoji.contains('💰')) {
                  return child!
                      .animate(onPlay: (c) => c.repeat(max: 3))
                      .scale(
                          begin: const Offset(1.0, 1.0),
                          end: const Offset(1.2, 1.2),
                          duration: 250.ms,
                          curve: Curves.easeOut)
                      .then()
                      .scale(
                          begin: const Offset(1.2, 1.2),
                          end: const Offset(1.0, 1.0),
                          duration: 200.ms,
                          curve: Curves.easeIn);
                } else if (emoji == '😂' || emoji == '🔥' || emoji == '😎') {
                  return child!
                      .animate(onPlay: (c) => c.repeat(max: 2))
                      .moveY(
                          begin: 0,
                          end: -8,
                          duration: 200.ms,
                          curve: Curves.easeOut)
                      .then()
                      .moveY(
                          begin: -8,
                          end: 0,
                          duration: 150.ms,
                          curve: Curves.easeIn);
                } else if (emoji == '😘' || emoji == '😮' || emoji == '😭') {
                  return child!
                      .animate()
                      .shake(hz: 4, curve: Curves.easeInOut, duration: 600.ms);
                }
                return child!;
              },
              child: CircleAvatar(
                radius: avatarR,
                backgroundColor: const Color(0xFF1E2638),
                backgroundImage:
                    avatarAsset != null ? AssetImage(avatarAsset) : null,
                child: avatarAsset == null
                    ? Text(
                        (p['username']?.toString() ?? '?')[0].toUpperCase(),
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: (18 * _ls).clamp(14, 24),
                        ),
                      )
                    : null,
              ),
            ),

            // Nairobi B has "Pack" written in large white text on a semi-transparent black overlay
            if (isFolded)
              Positioned.fill(
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.72),
                    shape: BoxShape.circle,
                    border: Border.all(
                        color: const Color(0xFFE53935).withValues(alpha: 0.8),
                        width: 1.5),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    'PACK',
                    style: TextStyle(
                      color: const Color(0xFFFF5252),
                      fontWeight: FontWeight.w900,
                      fontSize: (10 * _ls).clamp(8.0, 13.0),
                      letterSpacing: 1.0,
                      shadows: [
                        Shadow(
                            color:
                                const Color(0xFFD32F2F).withValues(alpha: 0.6),
                            blurRadius: 4)
                      ],
                    ),
                  ),
                ),
              ),

            // Status Pill overlaid at the bottom-center of the avatar (like the yellow "Chaal" or "Blind" badge)
            if (!isFolded && !isMe)
              Positioned(
                bottom: -4,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: statusLabel.toLowerCase() == 'chaal'
                          ? [const Color(0xFF2ECC71), const Color(0xFF1E8449)]
                          : [const Color(0xFFF39C12), const Color(0xFFD35400)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                    borderRadius: BorderRadius.circular(12),
                    border:
                        Border.all(color: const Color(0xFFFFD700), width: 1.0),
                    boxShadow: const [
                      BoxShadow(
                          color: Colors.black45,
                          blurRadius: 3,
                          offset: Offset(0, 2))
                    ],
                  ),
                  child: Text(
                    statusLabel.toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 8.0,
                      letterSpacing: 0.6,
                      shadows: [
                        Shadow(
                            color: Colors.black38,
                            blurRadius: 1,
                            offset: Offset(0, 0.5))
                      ],
                    ),
                  ),
                ),
              ),

            // Dealer chip (red circle with white "D") positioned next to the avatar
            if (isDealer)
              Positioned(
                right: -4,
                bottom: -4,
                child: Container(
                  width: badgeD + 2,
                  height: badgeD + 2,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFE53935), Color(0xFFB71C1C)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                    shape: BoxShape.circle,
                    border:
                        Border.all(color: const Color(0xFFFFD700), width: 1.2),
                    boxShadow: const [
                      BoxShadow(
                          color: Colors.black45,
                          blurRadius: 3,
                          offset: Offset(0, 2))
                    ],
                  ),
                  child: Text(
                    'D',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: (9.5 * _ls).clamp(7.5, 12.5),
                      fontWeight: FontWeight.w900,
                      shadows: const [
                        Shadow(
                            color: Colors.black54,
                            blurRadius: 1,
                            offset: Offset(0, 1))
                      ],
                    ),
                  ),
                ),
              ),

            // Bot thinking dots
            if (isBot && isTurn)
              Positioned(
                top: -24,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.black87,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color: const Color(0xFFD4AF37).withValues(alpha: 0.5)),
                  ),
                  child: const _ThinkingDots(),
                ),
              ),

            // Gift Box icon (if user/opponent)
            if (isMe)
              Positioned(
                right: -4,
                top: -4,
                child: Container(
                  width: badgeD + 2,
                  height: badgeD + 2,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFF9800), Color(0xFFE65100)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                    shape: BoxShape.circle,
                    border:
                        Border.all(color: const Color(0xFFFFD700), width: 1.0),
                    boxShadow: const [
                      BoxShadow(
                          color: Colors.black38,
                          blurRadius: 2,
                          offset: Offset(0, 1))
                    ],
                  ),
                  child: Icon(Icons.card_giftcard,
                      size: badgeD * 0.65, color: Colors.white),
                ),
              ),
          ],
        ),

        SizedBox(height: (6 * _ls).clamp(4, 10)),

        // Username under avatar
        if (!isMe)
          Text(
            p['username']?.toString() ?? 'Player',
            style: TextStyle(
              color: Colors.white70,
              fontSize: fUsername,
              fontWeight: FontWeight.bold,
              shadows: const [Shadow(color: Colors.black87, blurRadius: 4)],
            ),
            overflow: TextOverflow.ellipsis,
            maxLines: 1,
          ),

        if (chips != null) ...[
          SizedBox(height: (3 * _ls).clamp(2, 5)),
          // Balance Pill under username
          Container(
            padding: EdgeInsets.symmetric(
              horizontal: (8 * _ls).clamp(6, 12),
              vertical: (2.5 * _ls).clamp(2.0, 4.0),
            ),
            decoration: BoxDecoration(
              color: const Color(0xFF0F1626).withValues(alpha: 0.85),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: const Color(0xFFD4AF37).withValues(alpha: 0.65),
                width: 1.0,
              ),
              boxShadow: const [
                BoxShadow(
                    color: Colors.black54, blurRadius: 4, offset: Offset(0, 2))
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '🪙',
                  style: TextStyle(fontSize: fChips * 1.1),
                ),
                const SizedBox(width: 3),
                Text(
                  '₹$chips',
                  style: TextStyle(
                    color: const Color(0xFFFFD700), // Brilliant gold
                    fontSize: fChips,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );

    if (isMe) {
      return Opacity(
        opacity: isFolded ? 0.55 : 1.0,
        child: avatarColumn,
      );
    }

    final cards = _opponentCardBacks(
        isFolded: isFolded, isSeen: p['is_seen'] ?? p['isSeen'] ?? false);

    return Opacity(
      opacity: isFolded ? 0.55 : 1.0,
      child: fracX < 0.5
          ? Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                avatarColumn,
                SizedBox(width: (6 * _ls).clamp(4.0, 10.0)),
                cards,
              ],
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                cards,
                SizedBox(width: (6 * _ls).clamp(4.0, 10.0)),
                avatarColumn,
              ],
            ),
    );
  }

  // ⑤ User's cards — anchored above action bar; "See Cards" overlays the backs
  Widget _buildUserCards(List<Map<String, dynamic>> cards, bool isMyTurn,
      double w, double tl, double tt, double tw, double th) {
    if (cards.isEmpty) return const SizedBox.shrink();
    if (_isDealingCards)
      return const SizedBox.shrink(); // Hide cards during dealing

    final actionBarH = (60 * _ls).clamp(50.0, 80.0);
    final cardsBottom =
        tt + th - actionBarH + 4; // moved down as player avatar is hidden
    final cardsTop = cardsBottom - _cardHt;

    final cardStep = _cardW * 0.88;
    final rowWidth = cards.length * cardStep + (_cardW * 0.12);
    final rowLeft = (w - _rightPanelW) / 2 - rowWidth / 2;

    return Stack(children: [
      Positioned(
        top: cardsTop,
        left: rowLeft,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
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
                      color: Colors.black.withValues(alpha: 0.55),
                      borderRadius:
                          BorderRadius.circular((8 * _ls).clamp(6, 12)),
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
                                shadows: const [
                                  Shadow(color: Colors.black54, blurRadius: 4)
                                ])),
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

  // Coordinate helper: maps user ids to physical (X, Y) layout coordinates on the screen.
  Offset _getSeatCoordinates(String userId, double w, double h, double tl,
      double tt, double tw, double th) {
    if (userId == _myUserId) {
      // User is always bottom-center
      return Offset(tl + tw * 0.5, tt + th * 0.88);
    }
    final gs = _gsNotifier.value;
    final players = (gs?['players'] as List? ?? []);
    final activeOpponents = players
        .where((p) => (p['userId'] ?? p['user_id']) != _myUserId)
        .toList();

    int seatIndex = activeOpponents
        .indexWhere((p) => (p['userId'] ?? p['user_id']) == userId);
    if (seatIndex == -1) {
      // Fallback
      return Offset(tl + tw * 0.5, tt + th * 0.4);
    }

    final posList = _tableSeats[4]!;
    if (seatIndex >= posList.length) {
      seatIndex = posList.length - 1;
    }
    final pos = posList[seatIndex];
    return Offset(tl + tw * pos.$1, tt + th * pos.$2);
  }

  // User bottom-center seat widget
  Widget _buildUserSeat(Map<String, dynamic>? gs, double w, double h, double tl,
      double tt, double tw, double th) {
    return const SizedBox.shrink();
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

  // ⑥ Pot chip — Black & Gold capsule in the middle
  Widget _buildPotChip(
      Map<String, dynamic>? gs, double w, double tt, double tw, double th) {
    final chipW = (118 * _ls).clamp(84.0, 138.0);
    final chipH = (36 * _ls).clamp(30.0, 48.0);
    final potY = th * 0.45 - chipH / 2; // positioned centered vertically
    return Positioned(
      left: (w - _rightPanelW) / 2 - chipW / 2,
      top: tt + potY,
      child: Container(
        width: chipW,
        padding: EdgeInsets.symmetric(
            horizontal: (10 * _ls).clamp(8, 14),
            vertical: (6 * _ls).clamp(4, 10)),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF0F1B35), Color(0xFF070D1A)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFD4AF37), width: 1.5),
          boxShadow: [
            BoxShadow(
                color: const Color(0xFFD4AF37).withValues(alpha: 0.35),
                blurRadius: 16,
                spreadRadius: 1),
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.4),
                blurRadius: 4,
                offset: const Offset(0, 4)),
          ],
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Text('🪙', style: TextStyle(fontSize: (13 * _ls).clamp(11, 16))),
            const SizedBox(width: 4),
            Text('₹${gs?['pot'] ?? 0}',
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: (13 * _ls).clamp(11, 16),
                    shadows: const [
                      Shadow(color: Colors.black54, blurRadius: 2)
                    ])),
          ]),
          if (_potLimitOf(gs) > 0) ...[
            const SizedBox(height: 2),
            Text('Limit ₹${_fmtAmount(_potLimitOf(gs))}',
                style: TextStyle(
                    color: const Color(0xFFFFD54F),
                    fontSize: (8.0 * _ls).clamp(7.0, 10.0),
                    fontWeight: FontWeight.w800)),
          ]
        ]),
      ),
    );
  }

  /// Small pill under the top bar reminding players of the table's special
  /// rules: Muflis (lowest wins), Joker (this hand's wild rank), AK47.
  Widget _buildVariantChip(Map<String, dynamic>? gs, double tt, double tw) {
    final variation = gs?['variation']?.toString() ?? '';
    String? label;
    switch (variation) {
      case 'muflis':
        label = '🔻 MUFLIS · Lowest hand wins';
        break;
      case 'joker':
        final jv = gs?['joker_value']?.toString();
        label = jv == null || jv.isEmpty
            ? '🃏 JOKER · Wild card table'
            : '🃏 JOKER · All ${jv}s are wild';
        break;
      case 'ak47':
        label = '✨ AK47 · A · K · 4 · 7 are wild';
        break;
    }
    if (label == null) return const SizedBox.shrink();
    return Positioned(
      left: 0,
      width: tw,
      top: tt + (8 * _ls).clamp(6, 12),
      child: Center(
        child: Container(
          padding: EdgeInsets.symmetric(
              horizontal: (12 * _ls).clamp(10, 16),
              vertical: (4.5 * _ls).clamp(3.5, 7.0)),
          decoration: BoxDecoration(
            color: const Color(0xFF0F1626).withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
                color: const Color(0xFFFFB300).withValues(alpha: 0.5),
                width: 1.2),
            boxShadow: const [
              BoxShadow(
                  color: Colors.black38, blurRadius: 6, offset: Offset(0, 3))
            ],
          ),
          child: Text(label,
              style: TextStyle(
                  color: const Color(0xFFFFC107),
                  fontWeight: FontWeight.w900,
                  fontSize: (9.5 * _ls).clamp(8.0, 12.0),
                  letterSpacing: 0.5)),
        ),
      ),
    );
  }

  double _potLimitOf(Map<String, dynamic>? gs) =>
      ((gs?['pot_limit'] ?? gs?['potLimit']) as num?)?.toDouble() ?? 0;

  String _fmtAmount(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2);

  // ⑧ Top bar — back · table name · turn timer · sound toggle
  Widget _buildTopBar(double w) {
    return Positioned(
      top: 0,
      left: 0,
      right: _rightPanelW,
      height: (40 * _ls).clamp(36.0, 52.0),
      child: RepaintBoundary(
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          // Back
          _iconBtn(Icons.arrow_back_ios_new_rounded, _confirmExit, size: 38),
          const SizedBox(width: 6),
          // Table label
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(
                color: const Color(0xFF0F1626).withValues(alpha: 0.72),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: const Color(0xFFD4AF37).withValues(alpha: 0.4),
                    width: 1.0)),
            child: Text(
              'Table ${widget.roomId.substring(0, math.min(4, widget.roomId.length))}',
              style: TextStyle(
                  color: const Color(0xFFFFD54F),
                  fontWeight: FontWeight.bold,
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
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 5),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: secs <= 5
                                  ? [
                                      const Color(0xFFE53935),
                                      const Color(0xFFB71C1C)
                                    ]
                                  : [
                                      const Color(0xFF8B0F1E),
                                      const Color(0xFF5A0A14)
                                    ],
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                            ),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: secs <= 5
                                  ? const Color(0xFFFF8A80)
                                  : const Color(0xFFFF8A80)
                                      .withValues(alpha: 0.4),
                              width: 1.2,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: (secs <= 5
                                        ? const Color(0xFFE53935)
                                        : const Color(0xFF8B0F1E))
                                    .withValues(alpha: 0.4),
                                blurRadius: 8,
                                spreadRadius: 1,
                              ),
                            ],
                          ),
                          child: Text('Your turn • ${secs}s',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: (11 * _ls).clamp(9.0, 14.0))),
                        ))
                : const SizedBox.shrink(),
          ),
          const Spacer(),
          // Sound toggle (functional)
          _iconBtn(
            SoundService.instance.muted
                ? Icons.volume_off_rounded
                : Icons.volume_up_rounded,
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
    final pot = gs?['pot'] ?? 0;
    final stake = gs?['min_bet'] ?? 0;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0E1830),
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
            _infoLine(
                'Pot Limit',
                _potLimitOf(gs) > 0
                    ? '₹${_fmtAmount(_potLimitOf(gs))}'
                    : 'No Limit'),
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
          Text('$label: ',
              style: const TextStyle(color: Colors.white54, fontSize: 13)),
          Text(value,
              style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                  fontSize: 13)),
        ]),
      );

  // ⑨ Right panel — scrollable emoji panel
  Widget _buildRightPanel(double w, double h, double tt) {
    return Positioned(
      right: 0,
      top: 0,
      bottom: 0,
      width: _rightPanelW,
      child: RepaintBoundary(
        child: Container(
          decoration: const BoxDecoration(
            color: Color(0xFF050C1A),
            border: Border(left: BorderSide(color: Colors.white10)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFE082), Color(0xFFD4AF37)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                        color: AppColors.gold.withValues(alpha: 0.4),
                        blurRadius: 8,
                        spreadRadius: 1)
                  ],
                ),
                child: const Icon(Icons.emoji_emotions,
                    color: Colors.black, size: 20),
              ),
              const SizedBox(height: 6),
              Container(
                  height: 1,
                  color: Colors.white10,
                  margin: const EdgeInsets.symmetric(horizontal: 8)),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  itemCount: _quickEmojis.length,
                  physics: const BouncingScrollPhysics(),
                  itemBuilder: (context, idx) {
                    final e = _quickEmojis[idx];
                    return GestureDetector(
                      onTap: () => _sendEmoji(e),
                      child: Container(
                        margin: const EdgeInsets.symmetric(vertical: 8),
                        alignment: Alignment.center,
                        child: _buildEmojiOrImage(e, size: 28),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ⑩ Floating reactions (Floating directly from the seat that sent them!)
  Widget _buildReactions(List<_Reaction> reactions, double w, double h,
      double tl, double tt, double tw, double th) {
    if (reactions.isEmpty) return const SizedBox.shrink();
    return Stack(
        children: reactions.map((r) {
      final pos = _getSeatCoordinates(r.userId, w, h, tl, tt, tw, th);
      return Positioned(
        key: ValueKey('rx_${r.id}'),
        left: pos.dx - 20, // center bubble horizontally
        top: pos.dy - 65, // place above avatar
        child: _ReactionBubble(emoji: r.emoji, isTip: r.isTip),
      );
    }).toList());
  }

  // ⑪ Reconnect banner (below compact top bar, inside table area)
  Widget _buildReconnectBanner(String sv) {
    final failed = sv == 'reconnect-failed';
    return Positioned(
      top: 44,
      left: 8,
      right: _rightPanelW,
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
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(Colors.black)),
              ),
            if (!failed) const SizedBox(width: 8),
            Text(
              failed ? 'Connection lost' : 'Reconnecting…',
              style: TextStyle(
                  color: failed ? Colors.white : Colors.black,
                  fontSize: 12,
                  fontWeight: FontWeight.bold),
            ),
            if (failed) ...[
              const SizedBox(width: 10),
              GestureDetector(
                onTap: () => _socket.reconnectNow(),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                  decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(12)),
                  child: const Text('Retry',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ]),
        ),
      ),
    );
  }

  // ⑫ Bottom action bar: Pack | Side Show | Balance Capsule | − | Chaal | +
  Widget _buildActionBar(Map<String, dynamic>? gs, double w, double h) {
    final stake = (gs?['min_bet'] as num?)?.toDouble() ?? 10;
    final minBet = _isSeen ? stake * 2 : stake;
    final maxBet = minBet * 4;
    final players = (gs?['players'] as List?) ?? [];
    final activeCount =
        players.where((p) => (p as Map)['status'] == 'active').length;

    return Positioned(
      left: 0,
      right: _rightPanelW,
      bottom: 0,
      child: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                Colors.black.withValues(alpha: 0.0),
                Colors.black.withValues(alpha: 0.88)
              ],
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
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
              final btnPack = (86 * _ls).clamp(62.0, 110.0);
              final btnMain = (114 * _ls).clamp(88.0, 140.0);
              final btnSecond = (72 * _ls).clamp(54.0, 90.0);
              final gap = (8 * _ls).clamp(5.0, 12.0);
              return Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // 1. Pack Button (red)
                  _actionBtn('Pack', AppColors.red, () => _sendAction('fold'),
                      width: btnPack),
                  SizedBox(width: gap),

                  // 2. Sideshow / Show Button (red)
                  if (_isSeen && activeCount > 2) ...[
                    _actionBtn('Side Show', AppColors.red,
                        () => _guardedAction('sideshow'),
                        width: btnSecond),
                    SizedBox(width: gap),
                  ] else if (activeCount == 2) ...[
                    _actionBtn(
                        'Show', AppColors.red, () => _guardedAction('show'),
                        width: btnSecond),
                    SizedBox(width: gap),
                  ],

                  // 3. Center Balance/Bet Capsule
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    decoration: BoxDecoration(
                      color: const Color(0xFF070B14).withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                          color:
                              const Color(0xFFD4AF37).withValues(alpha: 0.65),
                          width: 1.2),
                      boxShadow: [
                        BoxShadow(
                          color:
                              const Color(0xFFD4AF37).withValues(alpha: 0.12),
                          blurRadius: 8,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('🪙',
                            style: TextStyle(
                                fontSize: (13 * _ls).clamp(11.0, 15.0))),
                        const SizedBox(width: 4),
                        Text(
                          '₹${_myBalance.toStringAsFixed(2)}',
                          style: TextStyle(
                            color: const Color(0xFFFFD700),
                            fontWeight: FontWeight.w900,
                            fontSize: (12 * _ls).clamp(10.0, 15.0),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(width: gap),

                  // 4. Stepper Minus (blue square)
                  _stepperBtn('−', () {
                    _betNotifier.value = (bet - stake).clamp(minBet, maxBet);
                    HapticFeedback.selectionClick();
                  }),
                  SizedBox(width: gap),

                  // 5. Chal / Raise Button (red with coin text)
                  _actionBtn(
                      label,
                      AppColors.red,
                      () => _guardedAction(bet > minBet ? 'raise' : 'call',
                          amount: bet),
                      width: btnMain),
                  SizedBox(width: gap),

                  // 6. Stepper Plus (blue square)
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
    final bottomY = h - actionBarH - 6;
    return Positioned(
      left: 10,
      right: _rightPanelW + 10,
      bottom: h - bottomY,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Blank placeholder / spacer to keep Blind/Seen pill on the right
          const SizedBox.shrink(),

          // Blind / Seen badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: _isSeen
                  ? Colors.deepPurple.withValues(alpha: 0.85)
                  : Colors.orange.withValues(alpha: 0.85),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                  color:
                      _isSeen ? Colors.purple.shade200 : Colors.orange.shade200,
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

  // ⑬ Emoji tray — full emoji grid (quick list lives in the right panel now)
  Widget _buildEmojiTray(double w, double h) {
    return Positioned(
      right: _rightPanelW + 8,
      top: h * 0.14,
      child: GestureDetector(
        onTap: () {}, // absorb taps so table doesn't close tray
        child: Container(
          width: 200,
          constraints:
              BoxConstraints(maxHeight: (h * 0.70).clamp(160.0, 420.0)),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.92),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.5))),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Text('Send an Emoji',
                    style: TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
                const Spacer(),
                GestureDetector(
                  onTap: () => setState(() => _showEmojiTray = false),
                  child:
                      const Icon(Icons.close, color: Colors.white54, size: 18),
                ),
              ]),
              const SizedBox(height: 8),
              Flexible(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  child: Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: _quickEmojis.map((e) {
                      return GestureDetector(
                        onTap: () {
                          _sendEmoji(e);
                          setState(() => _showEmojiTray = false);
                        },
                        child: _buildEmojiOrImage(e, size: 26),
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
  //    Shows, in order: title, winner name, winner's revealed cards + hand
  //    rank, prize amount, then the lobby/rematch buttons.
  Widget _buildResult(Map<String, dynamic> result) {
    final won = result['won'] == true;
    final winnerName = result['winnerName']?.toString() ?? 'Unknown';
    final cards = ((result['cards'] as List?) ?? const [])
        .map((c) => Map<String, dynamic>.from(c as Map))
        .toList();
    final handRank = result['handRank']?.toString();
    final prizeText = result['prizeText']?.toString() ?? '';
    return Container(
      key: const ValueKey('result'),
      color: Colors.black.withValues(alpha: 0.82),
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
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: won
                    ? [const Color(0xFF1B2C4E), const Color(0xFF0B1220)]
                    : [const Color(0xFF3F1318), const Color(0xFF1F070A)],
              ),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                  color:
                      won ? const Color(0xFFFFD700) : const Color(0xFFFF4D4D),
                  width: 2.5),
              boxShadow: [
                BoxShadow(
                    color: (won
                            ? const Color(0xFFFFD700)
                            : const Color(0xFFFF4D4D))
                        .withValues(alpha: 0.35),
                    blurRadius: 36,
                    spreadRadius: 4),
              ],
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(
                won ? '🏆 VICTORY 🏆' : '💀 GAME OVER 💀',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  color:
                      won ? const Color(0xFFFFD700) : const Color(0xFFFF4D4D),
                  letterSpacing: 1.0,
                  shadows: [
                    Shadow(
                        color: (won
                                ? const Color(0xFFFFD700)
                                : const Color(0xFFFF4D4D))
                            .withValues(alpha: 0.5),
                        blurRadius: 12)
                  ],
                ),
              )
                  .animate()
                  .scale(
                      begin: const Offset(0.6, 0.6), curve: Curves.elasticOut)
                  .fadeIn(),
              const SizedBox(height: 12),
              // Winner name
              Text(won ? 'You Won!' : 'Winner: $winnerName',
                  style: const TextStyle(
                      fontSize: 16,
                      color: Colors.white,
                      fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center),
              if (cards.isNotEmpty) ...[
                const SizedBox(height: 16),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: cards
                      .map((c) => _buildCard(
                            c['value']?.toString() ?? '',
                            c['suit']?.toString() ?? '',
                          ))
                      .toList(),
                ),
                if (handRank != null && handRank.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(handRank,
                      style: TextStyle(
                        fontSize: 13,
                        color: won
                            ? const Color(0xFFFFD700)
                            : Colors.white70,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5,
                      )),
                ],
              ],
              const SizedBox(height: 16),
              // Prize amount
              Text(won ? 'You Won $prizeText' : 'Prize: $prizeText',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                    color: won ? const Color(0xFFFFD700) : Colors.white,
                  ),
                  textAlign: TextAlign.center),
              const SizedBox(height: 28),
              Row(mainAxisSize: MainAxisSize.min, children: [
                if (_privateCode != null) ...[
                  // Friends table: next hand auto-starts server-side.
                  ValueListenableBuilder<int>(
                    valueListenable: _rematchSecsNotifier,
                    builder: (_, secs, __) => ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF2ECC71),
                        foregroundColor: Colors.white,
                        shadowColor:
                            const Color(0xFF2ECC71).withValues(alpha: 0.4),
                        elevation: 8,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20)),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 12),
                      ),
                      onPressed: () {}, // staying is the default — just wait
                      icon: secs > 0
                          ? const Icon(Icons.replay)
                          : const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white)),
                      label: Text(
                          secs > 0
                              ? 'Same Table (${secs}s)'
                              : 'Starting next hand…',
                          style: const TextStyle(fontWeight: FontWeight.w900)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.12),
                      foregroundColor: Colors.white,
                      shadowColor: Colors.transparent,
                      shape: RoundedRectangleBorder(
                          side: BorderSide(
                              color: Colors.white.withValues(alpha: 0.3),
                              width: 1.0),
                          borderRadius: BorderRadius.circular(20)),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 12),
                    ),
                    onPressed: _exitPrivateTable,
                    icon: const Icon(Icons.home),
                    label: const Text('Exit Lobby',
                        style: TextStyle(fontWeight: FontWeight.w900)),
                  ),
                ] else
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: won
                          ? const Color(0xFFFFD700)
                          : Colors.white.withValues(alpha: 0.12),
                      foregroundColor: won ? Colors.black : Colors.white,
                      shadowColor: won
                          ? const Color(0xFFFFD700).withValues(alpha: 0.4)
                          : Colors.transparent,
                      elevation: won ? 8 : 0,
                      shape: RoundedRectangleBorder(
                          side: won
                              ? BorderSide.none
                              : BorderSide(
                                  color: Colors.white.withValues(alpha: 0.3),
                                  width: 1.0),
                          borderRadius: BorderRadius.circular(20)),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 20, vertical: 12),
                    ),
                    onPressed: _doExit,
                    icon: const Icon(Icons.home),
                    label: const Text('Back to Lobby',
                        style: TextStyle(fontWeight: FontWeight.w900)),
                  ),
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
    final isRed = suit == 'H' || suit == 'D';
    final color = isRed ? AppColors.red : const Color(0xFF1A1A2A);
    final symbol = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣'}[suit] ?? suit;
    final cw = _cardW;
    final ch = _cardHt;
    final fs1 = (13 * _ls).clamp(9.0, 16.0);
    final fs2 = (11 * _ls).clamp(8.0, 14.0);
    final fsC = (24 * _ls).clamp(16.0, 32.0);
    return Container(
      width: cw,
      height: ch,
      margin: EdgeInsets.symmetric(horizontal: (3 * _ls).clamp(2, 5)),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular((8 * _ls).clamp(6, 11)),
        boxShadow: const [
          BoxShadow(color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))
        ],
      ),
      child: Stack(children: [
        Positioned(
            top: 3,
            left: 4,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value,
                  style: TextStyle(
                      fontSize: fs1,
                      fontWeight: FontWeight.bold,
                      color: color)),
              Text(symbol, style: TextStyle(fontSize: fs2, color: color)),
            ])),
        Center(
            child: Text(symbol,
                style: TextStyle(
                    fontSize: fsC, color: color.withValues(alpha: 0.12)))),
        Positioned(
            bottom: 3,
            right: 4,
            child: Transform.rotate(
                angle: math.pi,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(value,
                          style: TextStyle(
                              fontSize: fs1,
                              fontWeight: FontWeight.bold,
                              color: color)),
                      Text(symbol,
                          style: TextStyle(fontSize: fs2, color: color)),
                    ]))),
      ]),
    );
  }

  Widget _buildCardBack() => Container(
        width: _cardW,
        height: _cardHt,
        margin: EdgeInsets.symmetric(horizontal: (3 * _ls).clamp(2, 5)),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular((8 * _ls).clamp(6, 11)),
          image: const DecorationImage(
              image: AssetImage('assets/images/card_back.png'),
              fit: BoxFit.cover),
          boxShadow: const [
            BoxShadow(
                color: Colors.black54, blurRadius: 8, offset: Offset(2, 4))
          ],
        ),
      );

  // Mini fan of 3 card backs shown above opponent seats with Blind/Seen badge
  Widget _opponentCardBacks({bool isFolded = false, bool isSeen = false}) {
    if (_isDealingCards)
      return SizedBox(height: (24 * _ls).clamp(18.0, 32.0) + 4);
    final cw = (17 * _ls).clamp(13.0, 22.0);
    final ch = (24 * _ls).clamp(18.0, 32.0);
    final fanW = (48 * _ls).clamp(36.0, 60.0);
    return SizedBox(
      width: fanW,
      height: ch + 4,
      child: Opacity(
        opacity: isFolded ? 0.4 : 1.0,
        child: Stack(
          alignment: Alignment.center,
          children: [
            ...List.generate(
                3,
                (i) => Transform.translate(
                      offset: Offset((i - 1) * (fanW / 7), 0),
                      child: Transform.rotate(
                        angle: (i - 1) * 0.20,
                        child: Container(
                          width: cw,
                          height: ch,
                          decoration: BoxDecoration(
                            borderRadius:
                                BorderRadius.circular((3 * _ls).clamp(2, 5)),
                            image: const DecorationImage(
                                image:
                                    AssetImage('assets/images/card_back.png'),
                                fit: BoxFit.cover),
                            boxShadow: const [
                              BoxShadow(
                                  color: Colors.black54,
                                  blurRadius: 2,
                                  offset: Offset(0, 1))
                            ],
                          ),
                        ),
                      ),
                    )),
            // Blind / Seen eye indicator in the center of the cards
            if (!isFolded)
              Positioned(
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: const BoxDecoration(
                    color: Colors.black87,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    isSeen
                        ? Icons.visibility_rounded
                        : Icons.visibility_off_rounded,
                    color: isSeen ? const Color(0xFFFFC107) : Colors.white70,
                    size: (10 * _ls).clamp(8.0, 14.0),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  (String, Color) _statusOf(Map<String, dynamic> p) {
    if (p['status'] == 'folded') return ('Pack', AppColors.red);
    if (p['is_seen'] == false) return ('Blind', Colors.orange.shade700);
    return ('Chaal', AppColors.green);
  }

  Widget _iconBtn(IconData icon, VoidCallback onTap, {double size = 36}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: const Color(0xFF0F1626).withValues(alpha: 0.72),
            shape: BoxShape.circle,
            border: Border.all(
                color: const Color(0xFFD4AF37).withValues(alpha: 0.85),
                width: 1.2),
            boxShadow: [
              BoxShadow(
                  color: const Color(0xFFD4AF37).withValues(alpha: 0.18),
                  blurRadius: 8,
                  spreadRadius: 1),
              const BoxShadow(
                  color: Colors.black45, blurRadius: 4, offset: Offset(0, 3)),
            ],
          ),
          child: Icon(icon, color: const Color(0xFFFFD54F), size: size * 0.48),
        ),
      );

  Widget _actionBtn(String label, Color color, VoidCallback onTap,
      {double width = 100}) {
    final hasCoin = label.contains('Chaal') || label.contains('Raise');
    String cleanLabel = label;
    String? amountText;
    if (hasCoin) {
      final parts = label.split(' ');
      if (parts.length >= 2) {
        cleanLabel = parts[0];
        amountText = parts.sublist(1).join(' ');
      }
    }

    // Premium color gradients
    final List<Color> btnColors;
    if (color == AppColors.red) {
      btnColors = [
        const Color(0xFFFF4D4D), // brighter red
        const Color(0xFFD32F2F), // mid red
        const Color(0xFF7B0000), // deep ruby shadow
      ];
    } else {
      btnColors = [
        Color.lerp(color, Colors.white, 0.2)!,
        color,
        Color.lerp(color, Colors.black, 0.3)!,
      ];
    }

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: width,
        height: (44 * _ls).clamp(36.0, 54.0),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: btnColors,
          ),
          borderRadius: BorderRadius.circular((12 * _ls).clamp(9, 16)),
          border: Border.all(color: const Color(0xFFFFD54F), width: 1.5),
          boxShadow: [
            BoxShadow(
                color: btnColors[1].withValues(alpha: 0.45),
                blurRadius: 10,
                spreadRadius: 1),
            const BoxShadow(
                color: Colors.black45, blurRadius: 4, offset: Offset(0, 3)),
          ],
        ),
        child: amountText != null
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(cleanLabel,
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: (11.5 * _ls).clamp(9.5, 13.5),
                          shadows: const [
                            Shadow(
                                color: Colors.black54,
                                blurRadius: 2,
                                offset: Offset(0, 1))
                          ])),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text('🪙',
                          style: TextStyle(
                              fontSize: (10.5 * _ls).clamp(8.5, 12.5))),
                      const SizedBox(width: 2),
                      Text(amountText,
                          style: TextStyle(
                              color: const Color(0xFFFFD700),
                              fontWeight: FontWeight.w900,
                              fontSize: (11.5 * _ls).clamp(9.5, 13.5),
                              shadows: const [
                                Shadow(
                                    color: Colors.black54,
                                    blurRadius: 2,
                                    offset: Offset(0, 1))
                              ])),
                    ],
                  )
                ],
              )
            : Text(label,
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: (12.5 * _ls).clamp(10.0, 16.0),
                    letterSpacing: 0.5,
                    shadows: const [
                      Shadow(
                          color: Colors.black54,
                          blurRadius: 3,
                          offset: Offset(0, 1.5))
                    ])),
      ),
    );
  }

  Widget _stepperBtn(String label, VoidCallback onTap) {
    final d = (40 * _ls).clamp(32.0, 50.0);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: d,
        height: d,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topCenter, end: Alignment.bottomCenter,
            colors: [
              Color(0xFF00E5FF),
              Color(0xFF00838F)
            ], // Sleek cyan gradient
          ),
          border: Border.all(color: const Color(0xFFE0F7FA), width: 1.5),
          borderRadius: BorderRadius.circular(10),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF00E5FF).withValues(alpha: 0.35),
              blurRadius: 8,
              spreadRadius: 1,
            ),
            const BoxShadow(
                color: Colors.black54, blurRadius: 4, offset: Offset(0, 2)),
          ],
        ),
        child: Text(label,
            style: TextStyle(
                color: Colors.white,
                fontSize: (21 * _ls).clamp(16.0, 26.0),
                fontWeight: FontWeight.w900,
                height: 1.1)),
      ),
    );
  }

  // ── Card distribution trigger animation ────────────────────────────────────
  void _triggerCardDealingAnimation(Map<String, dynamic> gs) {
    if (_isDealingCards) return; // already dealing

    // Only deal if we have active players
    final players = (gs['players'] as List? ?? []);
    final activePlayers = players
        .where((p) => p['status'] == 'active' || p['status'] == 'playing')
        .toList();
    if (activePlayers.isEmpty) return;

    final handId =
        gs['hand_id']?.toString() ?? gs['current_hand_id']?.toString();
    if (handId != null && handId == _currentHandId) {
      // Already dealt cards for this hand
      return;
    }
    _currentHandId = handId;

    final size = MediaQuery.of(context).size;
    final w = size.width;
    final h = size.height;
    final ls = (h / 400.0).clamp(0.72, 1.5);
    final topBarH = (40 * ls).clamp(36.0, 52.0);
    final tw = w - _rightPanelW - 2;
    final th = h - topBarH - 2;
    final tl = 0.0;
    final tt = topBarH;

    final dealerPos = Offset((w - _rightPanelW) / 2, tt + 10);

    final List<_FlyingCard> list = [];
    int cardIndex = 0;

    // 3 rounds of dealing (one card to each player per round)
    for (int round = 0; round < 3; round++) {
      for (int pIdx = 0; pIdx < activePlayers.length; pIdx++) {
        final p = activePlayers[pIdx];
        final uid = (p['userId'] ?? p['user_id'])?.toString();
        if (uid == null) continue;

        final dest = _getSeatCoordinates(uid, w, h, tl, tt, tw, th);

        list.add(_FlyingCard(
          start: dealerPos,
          end: dest,
          delayMs: cardIndex * 150,
          index: round,
        ));
        cardIndex++;
      }
    }

    setState(() {
      _flyingCards = list;
      _isDealingCards = true;
    });

    // Sound effects matching delays
    for (int i = 0; i < cardIndex; i++) {
      Future.delayed(Duration(milliseconds: i * 150), () {
        if (mounted && _isDealingCards) {
          SoundService.instance.play(Sfx.cardDeal);
        }
      });
    }

    // Stop dealing animation after all cards have flown
    final totalDuration = cardIndex * 150 + 400; // delay + flight duration
    Future.delayed(Duration(milliseconds: totalDuration), () {
      if (mounted) {
        setState(() {
          _isDealingCards = false;
          _flyingCards = [];
        });
      }
    });
  }

  List<Widget> _buildFlyingCards(double w, double h) {
    return _flyingCards.map((fc) {
      return _FlyingCardWidget(
        flyingCard: fc,
        cardW: _cardW,
        cardHt: _cardHt,
      );
    }).toList();
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
class _ChatMsg {
  final String userId, username, text, type;
  _ChatMsg(
      {required this.userId,
      required this.username,
      required this.text,
      required this.type});
}

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

// ── Reaction bubble ───────────────────────────────────────────────────────────
class _ReactionBubble extends StatefulWidget {
  final String emoji;
  final bool isTip;
  const _ReactionBubble({required this.emoji, this.isTip = false});
  @override
  State<_ReactionBubble> createState() => _ReactionBubbleState();
}

class _ReactionBubbleState extends State<_ReactionBubble>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: 7400.ms)..forward();
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
                child: _buildEmojiOrImage(widget.emoji, size: 38),
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
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(
            3,
            (i) => AnimatedBuilder(
                  animation: _c,
                  builder: (_, __) {
                    final t = (_c.value - i * 0.2).clamp(0.0, 1.0);
                    return Container(
                      margin: const EdgeInsets.symmetric(horizontal: 1.5),
                      width: 5,
                      height: 5,
                      transform: Matrix4.translationValues(
                          0, -math.sin(t * math.pi) * 4, 0),
                      decoration: const BoxDecoration(
                          color: AppColors.gold, shape: BoxShape.circle),
                    );
                  },
                )),
      );
}

// ── Dealer hostess ────────────────────────────────────────────────────────────
class _HostessWidget extends StatefulWidget {
  final ValueNotifier<int> tipTrigger;
  final VoidCallback onTipTap;
  final VoidCallback onInviteTap;
  final bool isDealing;
  const _HostessWidget(
      {required this.tipTrigger,
      required this.onTipTap,
      required this.onInviteTap,
      required this.isDealing});
  @override
  State<_HostessWidget> createState() => _HostessWidgetState();
}

class _HostessWidgetState extends State<_HostessWidget>
    with TickerProviderStateMixin {
  late final AnimationController _idleController =
      AnimationController(vsync: this, duration: 1400.ms)
        ..repeat(reverse: true);

  late final AnimationController _tipController =
      AnimationController(vsync: this, duration: 1500.ms);

  late final AnimationController _dealController =
      AnimationController(vsync: this, duration: 250.ms);

  final List<_TipParticle> _particles = [];
  final math.Random _random = math.Random();

  @override
  void initState() {
    super.initState();
    widget.tipTrigger.addListener(_onTipReceived);
    if (widget.isDealing) {
      _dealController.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(covariant _HostessWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isDealing && !oldWidget.isDealing) {
      _dealController.repeat(reverse: true);
    } else if (!widget.isDealing && oldWidget.isDealing) {
      _dealController.stop();
      _dealController.reset();
    }
  }

  @override
  void dispose() {
    widget.tipTrigger.removeListener(_onTipReceived);
    _idleController.dispose();
    _tipController.dispose();
    _dealController.dispose();
    super.dispose();
  }

  void _onTipReceived() {
    if (!mounted) return;
    _tipController.forward(from: 0.0);

    // Spawn 8 hearts/coins particles
    _particles.clear();
    final icons = ['❤️', '🪙', '❤️', '🪙', '✨', '❤️', '🪙', '❤️'];
    for (int i = 0; i < 8; i++) {
      _particles.add(_TipParticle(
        dx: _random.nextDouble() * 60 - 30, // random offset -30 to 30
        dy: _random.nextDouble() * 80 + 40, // random height 40 to 120
        icon: icons[i % icons.length],
        scale: _random.nextDouble() * 0.5 + 0.8,
        delay: _random.nextDouble() * 400,
      ));
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    Widget hostessColumn = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Avatar circle with double rings
        GestureDetector(
          onTap: widget.onTipTap,
          child: Stack(
            alignment: Alignment.center,
            clipBehavior: Clip.none,
            children: [
              // Outer gold aura ring
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: const Color(0xFFD4AF37).withValues(alpha: 0.5),
                    width: 1.5,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFD4AF37).withValues(alpha: 0.3),
                      blurRadius: 18,
                      spreadRadius: 4,
                    ),
                  ],
                ),
              ),
              // Inner gold gradient ring
              Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: SweepGradient(
                    colors: [
                      Color(0xFFFFD700),
                      Color(0xFFB8860B),
                      Color(0xFFFFD700),
                    ],
                  ),
                ),
              ),
              // Image container
              Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0xFF0E1830),
                ),
                clipBehavior: Clip.antiAlias,
                child: Image.asset(
                  'assets/images/dealer_avatar.png',
                  fit: BoxFit.cover,
                ),
              )
                  .animate(controller: _tipController, autoPlay: false)
                  .scale(
                      begin: const Offset(1.0, 1.0),
                      end: const Offset(1.2, 1.2),
                      duration: 200.ms,
                      curve: Curves.easeOut)
                  .then()
                  .scale(
                      begin: const Offset(1.2, 1.2),
                      end: const Offset(1.0, 1.0),
                      duration: 150.ms,
                      curve: Curves.easeIn),

              // Invite badge next to dealer avatar
              Positioned(
                left: -12,
                bottom: -6,
                child: GestureDetector(
                  onTap: widget.onInviteTap,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 5, vertical: 6),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFFD43F), Color(0xFFB8860B)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 1.5),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFFD43F).withValues(alpha: 0.4),
                          blurRadius: 8,
                          spreadRadius: 1,
                          offset: const Offset(0, 2),
                        )
                      ],
                    ),
                    child: const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.person_add_alt_1_rounded,
                            color: Colors.black87, size: 11),
                        Text(
                          'INVITE',
                          style: TextStyle(
                              color: Colors.black87,
                              fontSize: 6.5,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.2),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              // Heart TIPS badge next to dealer avatar
              Positioned(
                right: -12,
                bottom: -6,
                child: GestureDetector(
                  onTap: widget.onTipTap,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 6),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFF2A6D), Color(0xFF910038)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                      shape: BoxShape.circle,
                      border: Border.all(
                          color: const Color(0xFFFFD700), width: 1.5),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFF2A6D).withValues(alpha: 0.4),
                          blurRadius: 8,
                          spreadRadius: 1,
                          offset: const Offset(0, 2),
                        )
                      ],
                    ),
                    child: const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.favorite_rounded,
                            color: Colors.white, size: 11),
                        Text(
                          'TIPS',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 7,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.5),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 5),
        // Dealer name badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF8C0E1C), Color(0xFF3F0006)],
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFD4AF37), width: 1.2),
            boxShadow: const [
              BoxShadow(
                  color: Colors.black45, blurRadius: 4, offset: Offset(0, 2))
            ],
          ),
          child: const Text(
            'DEALER',
            style: TextStyle(
              color: Color(0xFFFFF6D6),
              fontSize: 8,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.2,
            ),
          ),
        ),
      ],
    );

    // Apply animations cleanly depending on dealing state
    if (widget.isDealing) {
      hostessColumn = hostessColumn
          .animate(controller: _dealController)
          .scale(
              begin: const Offset(1.0, 1.0),
              end: const Offset(1.08, 1.08),
              duration: 125.ms,
              curve: Curves.easeInOut)
          .rotate(
              begin: -0.04,
              end: 0.04,
              duration: 125.ms,
              curve: Curves.easeInOut);
    } else {
      hostessColumn = hostessColumn
          .animate(controller: _idleController)
          .moveY(begin: 0, end: -6, duration: 1400.ms, curve: Curves.easeInOut)
          .scale(
              begin: const Offset(0.97, 0.97),
              end: const Offset(1.03, 1.03),
              duration: 1400.ms,
              curve: Curves.easeInOut)
          .rotate(
              begin: -0.02,
              end: 0.02,
              duration: 1400.ms,
              curve: Curves.easeInOut);
    }

    return SizedBox(
      width: 80,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.topCenter,
        children: [
          hostessColumn,

          // Floating particles overlay (Spawns coins and hearts)
          if (_particles.isNotEmpty)
            ..._particles.map((p) {
              return AnimatedBuilder(
                animation: _tipController,
                builder: (context, child) {
                  final progress =
                      ((_tipController.value * 1500 - p.delay) / 1000.0)
                          .clamp(0.0, 1.0);
                  if (progress <= 0.0) return const SizedBox.shrink();

                  final double x = p.dx + math.sin(progress * math.pi * 2) * 10;
                  final double y = -20 - (p.dy * progress);
                  final double opacity = 1.0 - progress;

                  return Positioned(
                    left: 40 + x,
                    top: y,
                    child: Opacity(
                      opacity: opacity,
                      child: Transform.scale(
                        scale: p.scale,
                        child:
                            Text(p.icon, style: const TextStyle(fontSize: 20)),
                      ),
                    ),
                  );
                },
              );
            }),
        ],
      ),
    );
  }
}

class _TipParticle {
  final double dx;
  final double dy;
  final String icon;
  final double scale;
  final double delay; // delay in ms
  _TipParticle(
      {required this.dx,
      required this.dy,
      required this.icon,
      required this.scale,
      required this.delay});
}

// ── Card distribution flight coordinates ──────────────────────────────────────
class _FlyingCard {
  final Offset start;
  final Offset end;
  final int delayMs;
  final int index;
  _FlyingCard(
      {required this.start,
      required this.end,
      required this.delayMs,
      required this.index});
}

// ── Flying card animation widget ──────────────────────────────────────────────
class _FlyingCardWidget extends StatefulWidget {
  final _FlyingCard flyingCard;
  final double cardW;
  final double cardHt;
  const _FlyingCardWidget({
    required this.flyingCard,
    required this.cardW,
    required this.cardHt,
  });

  @override
  State<_FlyingCardWidget> createState() => _FlyingCardWidgetState();
}

class _FlyingCardWidgetState extends State<_FlyingCardWidget>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<Offset> _positionAnimation;
  late final Animation<double> _rotationAnimation;
  late final Animation<double> _scaleAnimation;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    );

    _positionAnimation = Tween<Offset>(
      begin: widget.flyingCard.start,
      end: widget.flyingCard.end,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic));

    _rotationAnimation = Tween<double>(
      begin: 0.0,
      end: widget.flyingCard.index * 0.10 -
          0.05, // minor fan angle rotation at target
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOut));

    _scaleAnimation = Tween<double>(
      begin: 0.2, // starts small at dealer's hand
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic));

    // Trigger flight after delay
    Future.delayed(Duration(milliseconds: widget.flyingCard.delayMs), () {
      if (mounted) {
        setState(() => _started = true);
        _controller.forward();
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_started) return const SizedBox.shrink();

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final pos = _positionAnimation.value;
        final rot = _rotationAnimation.value;
        final scale = _scaleAnimation.value;

        return Positioned(
          left: pos.dx - (widget.cardW * scale) / 2,
          top: pos.dy - (widget.cardHt * scale) / 2,
          width: widget.cardW * scale,
          height: widget.cardHt * scale,
          child: Transform.rotate(
            angle: rot,
            child: child,
          ),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: Colors.white, width: 1.0),
          boxShadow: const [
            BoxShadow(
                color: Colors.black38, blurRadius: 4, offset: Offset(0, 2))
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Image.asset(
            'assets/images/card_back.png',
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }
}

String _resolveUrl(String? p) {
  if (p == null || p.isEmpty) return '';
  if (p.startsWith('http')) return p;
  return '${AppConfig.apiBaseUrl}$p';
}

Widget _buildEmojiOrImage(String emoji, {double size = 28}) {
  if (emoji.startsWith('/uploads/') || emoji.startsWith('http')) {
    final url = _resolveUrl(emoji);
    if (url.toLowerCase().endsWith('.json')) {
      return Lottie.network(
        url,
        width: size + 8,
        height: size + 8,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) =>
            Icon(Icons.broken_image_rounded, color: Colors.white60, size: size),
      );
    }
    return Image.network(
      url,
      width: size + 8,
      height: size + 8,
      fit: BoxFit.contain,
      errorBuilder: (context, error, stackTrace) =>
          Icon(Icons.broken_image_rounded, color: Colors.white60, size: size),
    );
  }
  return Text(
    emoji,
    style: TextStyle(fontSize: size),
  );
}
