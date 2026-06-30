import 'dart:math';

/// Ludo state model + offline rules engine.
///
/// The model mirrors the server engine's JSON (`services/game-engines/ludo`)
/// so the same widgets render both online (state from `/ws`) and offline
/// (state from this local engine in Practice mode). The rules here are a
/// faithful port of `rules.ts` — keep them in sync.

const int kMainTrack = 52;
const int kHomeProgress = 57; // exact value a token must reach to finish
const int kTokensPerPlayer = 4;
const List<int> kStartOffsets = [0, 13, 26, 39];
const Set<int> kSafeCells = {0, 8, 13, 21, 26, 34, 39, 47};
const List<String> kColors = ['red', 'green', 'yellow', 'blue'];

class LudoPlayer {
  final String userId;
  final String username;
  final int seat;
  final bool isBot;
  final String color;
  List<int> tokens; // progress per token: -1 base, 0..50 track, 51..57 home col
  int finished;
  String status; // 'active' | 'finished'

  LudoPlayer({
    required this.userId,
    required this.username,
    required this.seat,
    required this.isBot,
    required this.color,
    required this.tokens,
    this.finished = 0,
    this.status = 'active',
  });

  factory LudoPlayer.fromJson(Map<String, dynamic> j) => LudoPlayer(
        userId: (j['user_id'] ?? j['userId'] ?? '').toString(),
        username: (j['username'] ?? 'Player').toString(),
        seat: ((j['seat'] ?? 1) as num).toInt(),
        isBot: (j['is_bot'] ?? j['isBot'] ?? false) as bool,
        color: (j['color'] ?? 'red').toString(),
        tokens: ((j['tokens'] as List?)?.map((e) => (e as num).toInt()).toList()) ??
            [-1, -1, -1, -1],
        finished: ((j['finished'] ?? 0) as num).toInt(),
        status: (j['status'] ?? 'active').toString(),
      );
}

class LudoState {
  final String roomId;
  final double stake;
  List<LudoPlayer> players;
  String status; // 'active' | 'completed'
  int currentTurn;
  int? dice;
  List<int> movableTokens;
  String awaiting; // 'roll' | 'move'
  int consecutiveSixes;
  String? winnerId;
  int round;

  LudoState({
    required this.roomId,
    required this.stake,
    required this.players,
    this.status = 'active',
    this.currentTurn = 0,
    this.dice,
    this.movableTokens = const [],
    this.awaiting = 'roll',
    this.consecutiveSixes = 0,
    this.winnerId,
    this.round = 1,
  });

  factory LudoState.fromJson(Map<String, dynamic> j) => LudoState(
        roomId: (j['room_id'] ?? j['roomId'] ?? '').toString(),
        stake: double.tryParse((j['stake'] ?? 0).toString()) ?? 0,
        players: ((j['players'] as List?) ?? [])
            .map((e) => LudoPlayer.fromJson(e as Map<String, dynamic>))
            .toList(),
        status: (j['status'] ?? 'active').toString(),
        currentTurn: ((j['current_turn'] ?? j['currentTurn'] ?? 0) as num).toInt(),
        dice: j['dice'] != null ? (j['dice'] as num).toInt() : null,
        movableTokens:
            ((j['movable_tokens'] as List?)?.map((e) => (e as num).toInt()).toList()) ??
                const [],
        awaiting: (j['awaiting'] ?? 'roll').toString(),
        consecutiveSixes: ((j['consecutive_sixes'] ?? 0) as num).toInt(),
        winnerId: (j['winner_id'] ?? j['winnerId'])?.toString(),
        round: (j['round'] ?? 1) as int,
      );

  LudoPlayer get current => players[currentTurn];
}

/// Absolute main-track cell for a token, or -1 if in base / home column.
int absoluteCell(int seatIndex, int progress) {
  if (progress < 0 || progress > 50) return -1;
  return (kStartOffsets[seatIndex % 4] + progress) % kMainTrack;
}

/// Pure offline engine for Practice mode. Mutates the [state] it is given and
/// returns event hints so the UI can fire the right animation/sound.
class LudoEngine {
  final Random _rng = Random();

  LudoState createGame({
    required String roomId,
    required double stake,
    required List<LudoPlayer> players,
  }) =>
      LudoState(roomId: roomId, stake: stake, players: players);

  int rollDie() => _rng.nextInt(6) + 1;

  List<int> movableTokens(LudoState s, int playerIdx, int dice) {
    final p = s.players[playerIdx];
    final out = <int>[];
    for (var t = 0; t < p.tokens.length; t++) {
      final prog = p.tokens[t];
      if (prog == kHomeProgress) continue;
      if (prog == -1) {
        if (dice == 6) out.add(t);
        continue;
      }
      if (prog + dice <= kHomeProgress) out.add(t);
    }
    return out;
  }

  /// Apply a roll. Returns true if the player must now pick a token (a move is
  /// possible); false if the turn auto-passed (no move / three sixes).
  bool applyRoll(LudoState s, int dice) {
    final idx = s.currentTurn;
    s.dice = dice;
    if (dice == 6) {
      s.consecutiveSixes += 1;
      if (s.consecutiveSixes >= 3) {
        s.consecutiveSixes = 0;
        _passTurn(s);
        return false;
      }
    }
    final movable = movableTokens(s, idx, dice);
    if (movable.isEmpty) {
      if (dice != 6) s.consecutiveSixes = 0;
      _passTurn(s);
      return false;
    }
    s.movableTokens = movable;
    s.awaiting = 'move';
    return true;
  }

  /// Move a token. Returns a result map describing what happened:
  /// `{captured: bool, home: bool, win: bool}`.
  Map<String, bool> applyMove(LudoState s, int tokenIndex) {
    final idx = s.currentTurn;
    final p = s.players[idx];
    final dice = s.dice ?? 0;
    if (!s.movableTokens.contains(tokenIndex)) {
      return {'captured': false, 'home': false, 'win': false};
    }

    final prog = p.tokens[tokenIndex];
    p.tokens[tokenIndex] = prog == -1 ? 0 : prog + dice;
    final newProg = p.tokens[tokenIndex];

    var captured = false;
    var reachedHome = false;

    if (newProg == kHomeProgress) {
      p.finished += 1;
      reachedHome = true;
      if (p.finished >= kTokensPerPlayer) p.status = 'finished';
    } else {
      final cell = absoluteCell(idx, newProg);
      if (cell != -1 && !kSafeCells.contains(cell)) {
        captured = _captureAt(s, idx, cell);
      }
    }

    final extraTurn = dice == 6 || captured || reachedHome;
    s.dice = null;
    s.movableTokens = const [];
    s.awaiting = 'roll';

    if (p.status == 'finished') {
      s.status = 'completed';
      s.winnerId = p.userId;
      return {'captured': captured, 'home': true, 'win': true};
    }
    if (!extraTurn) {
      s.consecutiveSixes = 0;
      _passTurn(s);
    }
    return {'captured': captured, 'home': reachedHome, 'win': false};
  }

  bool _captureAt(LudoState s, int moverIdx, int cell) {
    for (var pi = 0; pi < s.players.length; pi++) {
      if (pi == moverIdx) continue;
      final other = s.players[pi];
      final here = <int>[];
      for (var t = 0; t < other.tokens.length; t++) {
        if (absoluteCell(pi, other.tokens[t]) == cell) here.add(t);
      }
      if (here.length == 1) {
        other.tokens[here[0]] = -1; // sent home
        return true;
      }
    }
    return false;
  }

  void _passTurn(LudoState s) {
    s.awaiting = 'roll';
    s.dice = null;
    s.movableTokens = const [];
    final n = s.players.length;
    var next = s.currentTurn;
    for (var i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (s.players[next].status != 'finished') break;
    }
    if (next <= s.currentTurn) s.round += 1;
    s.currentTurn = next;
  }

  /// Bot token choice: prefer a capture, else advance the furthest token.
  int chooseBotToken(LudoState s, int playerIdx, int dice) {
    final movable = movableTokens(s, playerIdx, dice);
    if (movable.isEmpty) return -1;
    final p = s.players[playerIdx];

    for (final t in movable) {
      final prog = p.tokens[t];
      if (prog == -1) continue;
      final cell = absoluteCell(playerIdx, prog + dice);
      if (cell != -1 && !kSafeCells.contains(cell)) {
        for (var pi = 0; pi < s.players.length; pi++) {
          if (pi == playerIdx) continue;
          final here =
              s.players[pi].tokens.where((tp) => absoluteCell(pi, tp) == cell);
          if (here.length == 1) return t;
        }
      }
    }
    var best = movable.first;
    for (final t in movable) {
      if (p.tokens[t] > p.tokens[best]) best = t;
    }
    return best;
  }
}
