import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart';

/// Offline Teen Patti engine for Practice mode (you vs 3 bots). No socket,
/// no backend, no real money. It owns a `state` map shaped exactly like the
/// server's game state so the existing table UI renders it unchanged:
///   { pot, min_bet, current_turn_user_id, dealer_id,
///     players: [ {user_id, username, status, is_seen, chips, cards:[{value,suit}]} ] }
///
/// Rules implemented (simplified but faithful):
///  - Each hand: every player antes the boot; players act in seat order.
///  - You are always "seen"; bots are randomly blind/seen.
///  - Actions: Chaal (call/raise), Pack (fold), Side Show (compare vs prev).
///  - Bots decide from 3-card hand strength with a little bluffing.
///  - Hand ends when one player remains, on a side-show loss, or a forced
///    showdown after a few betting rounds. Winner takes the pot.
class PracticeEngine {
  PracticeEngine({
    required this.onChanged,
    required this.onResult,
    required this.onChat,
    this.boot = 10,
    this.startingChips = 5000,
  });

  /// Called whenever [state] or [isMyTurn] changes — host should setState.
  final VoidCallback onChanged;

  /// Called at hand end: (message, didIWin).
  final void Function(String message, bool won) onResult;

  /// Called when a bot "says" something (table chatter).
  final void Function(String userId, String username, String text) onChat;

  final int boot;
  final int startingChips;

  final _rng = Random();
  final List<Timer> _timers = [];
  bool _disposed = false;

  static const _meId = 'me';
  static const _botNames = ['Steven P.', 'Nairobi B.', 'Smith J.'];

  List<_Player> _players = [];
  int _pot = 0;
  int _currentStake = 0; // current blind-unit stake; seen players pay 2x
  int _turn = 0; // index into _players
  int _dealer = 0;
  int _actionsThisHand = 0;
  bool _handOver = false;

  // ── Public surface the widget reads ─────────────────────────────────────
  Map<String, dynamic> get state => {
        'pot': _pot,
        'min_bet': _currentStake,
        'current_turn_user_id': _players[_turn].id,
        'dealer_id': _players[_dealer].id,
        'players': _players.map((p) => p.toMap()).toList(),
      };

  bool get isMyTurn => !_handOver && _players[_turn].id == _meId;
  bool get meSeen => true;
  bool get handOver => _handOver;

  // ── Lifecycle ───────────────────────────────────────────────────────────
  void startHand() {
    if (_disposed) return;
    final keepChips = _players.isNotEmpty
        ? {for (final p in _players) p.id: p.chips}
        : <String, int>{};

    _players = [
      _Player(_meId, 'You', isBot: false),
      _Player('b1', _botNames[0], isBot: true),
      _Player('b2', _botNames[1], isBot: true),
      _Player('b3', _botNames[2], isBot: true),
    ];
    for (final p in _players) {
      p.chips = keepChips[p.id] ?? startingChips;
      if (p.chips < boot) p.chips = startingChips; // top up if busted
    }

    final deck = _freshDeck()..shuffle(_rng);
    for (final p in _players) {
      p.cards = [deck.removeLast(), deck.removeLast(), deck.removeLast()];
      p.status = 'active';
      p.isSeen = p.isBot ? _rng.nextBool() : true; // you always see your cards
    }

    // Antes
    _pot = 0;
    for (final p in _players) {
      p.chips -= boot;
      _pot += boot;
    }
    _currentStake = boot;
    _handOver = false;
    _actionsThisHand = 0;
    _dealer = (_dealer + 1) % _players.length;
    _turn = (_dealer + 1) % _players.length; // first to act left of dealer

    onChanged();
    _afterTurnChange();
  }

  /// Player (you) action from the action bar: 'fold' | 'call' | 'side_show'.
  void playerAction(String action, double? amount) {
    if (_handOver || _players[_turn].id != _meId) return;
    final me = _players[_turn];
    switch (action) {
      case 'fold':
        me.status = 'folded';
        break;
      case 'side_show':
        _doSideShow(me);
        if (_handOver) return;
        break;
      case 'call':
      default:
        final bet = (amount ?? (_currentStake * 2)).round();
        _placeBet(me, bet);
    }
    _actionsThisHand++;
    _advance();
  }

  void dispose() {
    _disposed = true;
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
  }

  // ── Internal flow ────────────────────────────────────────────────────────
  void _placeBet(_Player p, int requested) {
    // Seen players pay at least 2x the blind unit; blind players pay 1x.
    final minPay = p.isSeen ? _currentStake * 2 : _currentStake;
    var bet = requested < minPay ? minPay : requested;
    if (bet > p.chips) bet = p.chips; // all-in fallback
    p.chips -= bet;
    _pot += bet;
    // The "blind-unit" stake the next player faces.
    final unit = p.isSeen ? (bet / 2).round() : bet;
    if (unit > _currentStake) _currentStake = unit;
  }

  void _advance() {
    onChanged();
    final active = _players.where((p) => p.status == 'active').toList();
    if (active.length == 1) {
      _endHand(active.first, 'last player standing');
      return;
    }
    // Force a showdown once enough betting has happened.
    if (_actionsThisHand >= _players.length * 3 && active.length == 2) {
      _showdown(active);
      return;
    }
    // Next active player.
    do {
      _turn = (_turn + 1) % _players.length;
    } while (_players[_turn].status != 'active');
    onChanged();
    _afterTurnChange();
  }

  void _afterTurnChange() {
    if (_handOver) return;
    final p = _players[_turn];
    if (!p.isBot) return; // wait for the human via playerAction
    // Bot "thinks" for a beat, then acts.
    _schedule(Duration(milliseconds: 700 + _rng.nextInt(900)), () => _botAct(p));
  }

  void _botAct(_Player bot) {
    if (_handOver || _players[_turn].id != bot.id) return;
    final strength = _handScore(bot.cards); // 0..1
    final potOdds = _currentStake * 2 / (_pot + 1);
    final r = _rng.nextDouble();

    // Blind bots play looser and cheaper; seen bots play to strength.
    String decision;
    if (bot.isSeen) {
      if (strength > 0.72) {
        decision = 'raise';
      } else if (strength > 0.38 || r < 0.15) {
        decision = 'call';
      } else {
        decision = 'fold';
      }
    } else {
      // Blind: usually continues cheaply, occasionally folds or sees-and-raises.
      if (r < 0.12) {
        decision = 'fold';
      } else if (strength > 0.8 && r < 0.5) {
        bot.isSeen = true;
        decision = 'raise';
      } else {
        decision = 'call';
      }
    }

    // Don't pour chips into a bad hand against a big stake.
    if (decision != 'fold' && potOdds > 0.5 && strength < 0.3 && bot.isSeen) {
      decision = 'fold';
    }

    switch (decision) {
      case 'fold':
        bot.status = 'folded';
        _maybeChatter(bot, fold: true);
        break;
      case 'raise':
        final base = bot.isSeen ? _currentStake * 2 : _currentStake;
        _placeBet(bot, (base * (1.5 + _rng.nextDouble())).round());
        _maybeChatter(bot, raise: true);
        break;
      case 'call':
      default:
        _placeBet(bot, bot.isSeen ? _currentStake * 2 : _currentStake);
    }
    _actionsThisHand++;
    _advance();
  }

  void _doSideShow(_Player me) {
    // Compare with the nearest other active player; lower hand packs.
    final others = _players
        .where((p) => p.id != me.id && p.status == 'active')
        .toList();
    if (others.isEmpty) return;
    final opp = others[_rng.nextInt(others.length)];
    final cmp = _compare(me.cards, opp.cards);
    if (cmp >= 0) {
      opp.status = 'folded';
      onChat(opp.id, opp.username, 'Side show — you win 👍');
    } else {
      me.status = 'folded';
      onChat(opp.id, opp.username, 'Side show — I win 😎');
      // After you pack, the hand may resolve immediately.
    }
    onChanged();
    final active = _players.where((p) => p.status == 'active').toList();
    if (active.length == 1) _endHand(active.first, 'side show');
  }

  void _showdown(List<_Player> active) {
    active.sort((a, b) => _compare(b.cards, a.cards));
    _endHand(active.first, 'showdown', reveal: active);
  }

  void _endHand(_Player winner, String reason, {List<_Player>? reveal}) {
    if (_handOver) return;
    _handOver = true;
    winner.chips += _pot;
    final won = winner.id == _meId;
    final msg = won
        ? '🎉 You won ₹$_pot  ($reason)'
        : '😔 ${winner.username} won ₹$_pot  ($reason)';
    onChanged();
    onResult(msg, won);
    // Auto-deal the next hand after a short pause.
    _schedule(const Duration(seconds: 4), startHand);
  }

  void _maybeChatter(_Player bot, {bool fold = false, bool raise = false}) {
    if (_rng.nextDouble() > 0.35) return;
    final line = fold
        ? ['Too rich for me', 'I pack', 'Not this one'][_rng.nextInt(3)]
        : raise
            ? ['Let\'s raise it 🔥', 'Feeling lucky', 'Boom 💥'][_rng.nextInt(3)]
            : ['Chaal', 'In', 'Call'][_rng.nextInt(3)];
    onChat(bot.id, bot.username, line);
  }

  void _schedule(Duration d, void Function() fn) {
    if (_disposed) return;
    late Timer t;
    t = Timer(d, () {
      _timers.remove(t);
      if (!_disposed) fn();
    });
    _timers.add(t);
  }

  // ── Cards & hand ranking ─────────────────────────────────────────────────
  List<Map<String, String>> _freshDeck() {
    const suits = ['S', 'H', 'D', 'C'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    return [
      for (final s in suits)
        for (final v in values) {'value': v, 'suit': s}
    ];
  }

  int _rank(Map c) {
    switch (c['value']) {
      case 'A':
        return 14;
      case 'K':
        return 13;
      case 'Q':
        return 12;
      case 'J':
        return 11;
      case '10':
        return 10;
      default:
        return int.parse(c['value'].toString());
    }
  }

  /// Returns a comparable score list: [category, tiebreakers...].
  /// Category: 5 trail, 4 pure seq, 3 seq, 2 color, 1 pair, 0 high card.
  List<int> _evaluate(List<Map> cards) {
    final ranks = cards.map(_rank).toList()..sort((a, b) => b - a);
    final suits = cards.map((c) => c['suit']).toSet();
    final isFlush = suits.length == 1;

    // Sequence detection (A-2-3 counts as a top run, then K-Q-J ... down).
    final sorted = [...ranks]..sort();
    bool isSeq = (sorted[2] - sorted[1] == 1) && (sorted[1] - sorted[0] == 1);
    final isAce23 = sorted[0] == 2 && sorted[1] == 3 && sorted[2] == 14;
    if (isAce23) isSeq = true;
    final seqHigh = isAce23 ? 15 : sorted[2]; // A-2-3 ranks above K-Q-A run

    final isTrail = ranks[0] == ranks[1] && ranks[1] == ranks[2];
    final isPair = !isTrail &&
        (ranks[0] == ranks[1] || ranks[1] == ranks[2] || ranks[0] == ranks[2]);

    if (isTrail) return [5, ranks[0]];
    if (isSeq && isFlush) return [4, seqHigh];
    if (isSeq) return [3, seqHigh];
    if (isFlush) return [2, ...ranks];
    if (isPair) {
      final pairRank = ranks[0] == ranks[1]
          ? ranks[0]
          : (ranks[1] == ranks[2] ? ranks[1] : ranks[0]);
      final kicker = ranks.firstWhere((r) => r != pairRank);
      return [1, pairRank, kicker];
    }
    return [0, ...ranks];
  }

  int _compare(List<Map> a, List<Map> b) {
    final ea = _evaluate(a), eb = _evaluate(b);
    final n = max(ea.length, eb.length);
    for (var i = 0; i < n; i++) {
      final x = i < ea.length ? ea[i] : 0;
      final y = i < eb.length ? eb[i] : 0;
      if (x != y) return x - y;
    }
    return 0;
  }

  /// Normalised 0..1 strength used by bot AI.
  double _handScore(List<Map> cards) {
    final e = _evaluate(cards);
    final category = e[0]; // 0..5
    final high = e.length > 1 ? e[1] : 0;
    return (category / 5.0) * 0.85 + (high / 15.0) * 0.15;
  }
}

class _Player {
  _Player(this.id, this.username, {required this.isBot});
  final String id;
  final String username;
  final bool isBot;
  int chips = 0;
  String status = 'active'; // active | folded
  bool isSeen = false;
  List<Map<String, String>> cards = [];

  Map<String, dynamic> toMap() => {
        'user_id': id,
        'username': username,
        'is_bot': isBot,
        'chips': chips,
        'status': status,
        'is_seen': isSeen,
        'cards': cards,
      };
}
