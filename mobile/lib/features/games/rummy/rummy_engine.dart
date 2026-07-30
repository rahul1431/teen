// mobile/lib/features/games/rummy/rummy_engine.dart
import 'dart:math';

class RummyCard {
  final String id;
  final String rank; // 'A'..'10','J','Q','K','JOKER'
  final String suit; // 'S','H','D','C','JK'
  RummyCard(this.id, this.rank, this.suit);
}

class RummyPlayerState {
  final String userId;
  final String username;
  final bool isBot;
  List<RummyCard> hand = [];
  bool hasDrawn = false;
  bool hasTakenTurn = false;
  bool hasDropped = false;
  bool isEliminated = false;
  RummyPlayerState(this.userId, this.username, this.isBot);
}

class RummyEngineState {
  final List<RummyPlayerState> players;
  List<RummyCard> closedPile;
  List<RummyCard> openPile;
  final String wildRank;
  int currentTurn = 0;
  String awaiting = 'draw'; // 'draw' | 'discard'
  String status = 'active'; // 'active' | 'completed'
  String? winnerId;

  RummyEngineState({
    required this.players,
    required this.closedPile,
    required this.openPile,
    required this.wildRank,
  });
}

const _suits = ['S', 'H', 'D', 'C'];
const _ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const _rankValue = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13,
};

bool isJokerCard(RummyCard card, String wildRank) => card.suit == 'JK' || card.rank == wildRank;

class RummyEngine {
  final _rand = Random();

  List<RummyCard> _buildDeck() {
    final deck = <RummyCard>[];
    var n = 0;
    for (var d = 0; d < 2; d++) {
      for (final suit in _suits) {
        for (final rank in _ranks) {
          deck.add(RummyCard('c${n++}', rank, suit));
        }
      }
      deck.add(RummyCard('c${n++}', 'JOKER', 'JK'));
    }
    return deck;
  }

  List<RummyCard> _shuffle(List<RummyCard> deck) {
    final out = List<RummyCard>.from(deck);
    for (var i = out.length - 1; i > 0; i--) {
      final j = _rand.nextInt(i + 1);
      final tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  RummyEngineState createGame(List<RummyPlayerState> players) {
    final deck = _shuffle(_buildDeck());
    var cursor = 0;
    for (var round = 0; round < 13; round++) {
      for (final p in players) {
        p.hand.add(deck[cursor++]);
      }
    }
    final wildIndicator = deck[cursor++];
    final wildRank = wildIndicator.suit == 'JK' ? '__NONE__' : wildIndicator.rank;
    final openPile = [deck[cursor++]];
    final closedPile = deck.sublist(cursor);
    return RummyEngineState(
      players: players,
      closedPile: closedPile,
      openPile: openPile,
      wildRank: wildRank,
    );
  }

  void _reshuffleIfNeeded(RummyEngineState s) {
    if (s.closedPile.isNotEmpty) return;
    if (s.openPile.length <= 1) return;
    final top = s.openPile.removeLast();
    s.closedPile = _shuffle(s.openPile);
    s.openPile = [top];
  }

  RummyCard drawFromClosed(RummyEngineState s, int playerIdx) {
    _reshuffleIfNeeded(s);
    final card = s.closedPile.removeLast();
    s.players[playerIdx].hand.add(card);
    s.players[playerIdx].hasDrawn = true;
    s.awaiting = 'discard';
    return card;
  }

  RummyCard drawFromOpen(RummyEngineState s, int playerIdx) {
    final card = s.openPile.removeLast();
    s.players[playerIdx].hand.add(card);
    s.players[playerIdx].hasDrawn = true;
    s.awaiting = 'discard';
    return card;
  }

  void _advanceTurn(RummyEngineState s) {
    final n = s.players.length;
    var next = s.currentTurn;
    for (var i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (!s.players[next].isEliminated && !s.players[next].hasDropped) {
        s.currentTurn = next;
        s.awaiting = 'draw';
        return;
      }
    }
  }

  List<RummyPlayerState> _active(RummyEngineState s) =>
      s.players.where((p) => !p.isEliminated && !p.hasDropped).toList();

  void _checkLastStanding(RummyEngineState s) {
    final active = _active(s);
    if (active.length == 1) {
      s.status = 'completed';
      s.winnerId = active[0].userId;
    }
  }

  void discard(RummyEngineState s, int playerIdx, String cardId) {
    final player = s.players[playerIdx];
    final idx = player.hand.indexWhere((c) => c.id == cardId);
    final card = player.hand.removeAt(idx);
    s.openPile.add(card);
    player.hasDrawn = false;
    player.hasTakenTurn = true;
    _advanceTurn(s);
  }

  void dropPlayer(RummyEngineState s, int playerIdx) {
    s.players[playerIdx].hasDropped = true;
    _checkLastStanding(s);
    if (s.status != 'completed') _advanceTurn(s);
  }

  // Returns true and completes the game if valid; false (and eliminates the
  // player) if invalid. groups is a list of card-id lists.
  bool declare(RummyEngineState s, int playerIdx, List<List<String>> groups) {
    final player = s.players[playerIdx];
    final valid = _validateDeclare(player.hand, groups, s.wildRank);
    if (!valid) {
      player.isEliminated = true;
      _checkLastStanding(s);
      if (s.status != 'completed') _advanceTurn(s);
      return false;
    }
    s.status = 'completed';
    s.winnerId = player.userId;
    return true;
  }

  ({bool valid, String? kind, bool pure}) checkGroup(List<RummyCard> cards, String wildRank) {
    final seq = _isValidSequence(cards, wildRank);
    if (seq.valid) return (valid: true, kind: 'sequence', pure: seq.pure);
    if (_isValidSet(cards, wildRank)) return (valid: true, kind: 'set', pure: false);
    return (valid: false, kind: null, pure: false);
  }

  ({bool valid, bool pure}) _isValidSequence(List<RummyCard> cards, String wildRank) {
    if (cards.length < 3) return (valid: false, pure: false);
    final jokers = cards.where((c) => isJokerCard(c, wildRank)).toList();
    final naturals = cards.where((c) => !isJokerCard(c, wildRank)).toList();
    if (naturals.isEmpty) return (valid: false, pure: false);
    final suit = naturals[0].suit;
    if (naturals.any((c) => c.suit != suit)) return (valid: false, pure: false);

    final size = cards.length;
    final hasAce = naturals.any((c) => c.rank == 'A');
    final aceOptions = hasAce ? [1, 14] : [null];
    for (final aceValue in aceOptions) {
      final values = naturals
          .map((c) => (c.rank == 'A' && aceValue != null) ? aceValue : _rankValue[c.rank]!)
          .toList();
      if (values.toSet().length != values.length) continue;
      final natMin = values.reduce(min);
      final natMax = values.reduce(max);
      // Jokers can extend the run past the naturals' own min/max, not just
      // fill internal gaps — search every window of length `size` that fully
      // contains [natMin, natMax] and stays within the valid rank range.
      final maxRank = aceValue == 14 ? 14 : 13;
      const minRank = 1;
      final lowStart = max(minRank, natMax - size + 1);
      final lowEnd = min(natMin, maxRank - size + 1);
      if (lowStart <= lowEnd) return (valid: true, pure: jokers.isEmpty);
    }
    return (valid: false, pure: false);
  }

  bool _isValidSet(List<RummyCard> cards, String wildRank) {
    if (cards.length < 3 || cards.length > 4) return false;
    final jokers = cards.where((c) => isJokerCard(c, wildRank)).toList();
    final naturals = cards.where((c) => !isJokerCard(c, wildRank)).toList();
    if (naturals.isEmpty) return false;
    final rank = naturals[0].rank;
    if (naturals.any((c) => c.rank != rank)) return false;
    final suits = naturals.map((c) => c.suit).toList();
    if (suits.toSet().length != suits.length) return false;
    return naturals.length + jokers.length == cards.length;
  }

  bool _validateDeclare(List<RummyCard> hand, List<List<String>> groups, String wildRank) {
    final flat = groups.expand((g) => g).toList();
    if (flat.length != 13) return false;
    if (flat.toSet().length != flat.length) return false;
    final handIds = hand.map((c) => c.id).toSet();
    if (!flat.every((id) => handIds.contains(id))) return false;
    final byId = {for (final c in hand) c.id: c};
    var sequenceCount = 0;
    var pureCount = 0;
    for (final ids in groups) {
      if (ids.length < 3) return false;
      final cards = ids.map((id) => byId[id]!).toList();
      final check = checkGroup(cards, wildRank);
      if (!check.valid) return false;
      if (check.kind == 'sequence') {
        sequenceCount++;
        if (check.pure) pureCount++;
      }
    }
    return sequenceCount >= 2 && pureCount >= 1;
  }
}
