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

class GroupMeldInfo {
  final int groupIdx;
  final String kind; // 'pure_sequence' | 'impure_sequence' | 'set' | 'invalid'
  final bool isPure;
  final bool isValidMeld;
  final int penaltyPoints;
  final String label;

  GroupMeldInfo({
    required this.groupIdx,
    required this.kind,
    required this.isPure,
    required this.isValidMeld,
    required this.penaltyPoints,
    required this.label,
  });
}

class HandValidationSummary {
  final int totalScore;
  final int pureSequences;
  final int impureSequences;
  final int sets;
  final bool isReadyToDeclare;
  final List<GroupMeldInfo> groupStatuses;

  HandValidationSummary({
    required this.totalScore,
    required this.pureSequences,
    required this.impureSequences,
    required this.sets,
    required this.isReadyToDeclare,
    required this.groupStatuses,
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
    final wildRank = (wildIndicator.suit == 'JK' || wildIndicator.rank == 'JOKER') ? 'A' : wildIndicator.rank;
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
    var validGroups = groups;
    final flat = validGroups.expand((g) => g).toList();
    if (flat.length != 13) {
      final computed = findValidDeclareGrouping(player.hand, s.wildRank);
      if (computed != null) {
        validGroups = computed;
      }
    } else {
      final check = _validateDeclare(player.hand, validGroups, s.wildRank);
      if (!check) {
        final computed = findValidDeclareGrouping(player.hand, s.wildRank);
        if (computed != null) {
          validGroups = computed;
        }
      }
    }

    final valid = _validateDeclare(player.hand, validGroups, s.wildRank);
    if (!valid) {
      return false;
    }
    s.status = 'completed';
    s.winnerId = player.userId;
    return true;
  }

  // Exhaustive backtracking search for a legal declare grouping in a 14-card
  // (post-draw) hand: 13 cards melded into valid sequences/sets with at least
  // 2 sequences, one of them pure, leaving one card over as the discard.
  // Returns the grouping as card-id lists, or null if NO partition of the
  // hand can legally declare.
  //
  // Dart mirror of findValidDeclareGrouping in
  // services/game-engines/rummy/src/rules.ts — the online path lets the
  // server compute this, but offline practice has no server to ask. Keep the
  // two in sync (same rule set, same algorithm) so practice and real tables
  // never disagree about whether a hand can win.
  List<List<String>>? findValidDeclareGrouping(List<RummyCard> hand, String wildRank) {
    if (hand.length != 14) return null;
    // Two decks are in play, so identical cards can repeat — trying the same
    // rank+suit as the leftover discard twice would repeat an identical
    // search (every rule check looks only at rank/suit).
    final triedLeftover = <String>{};
    for (var i = 0; i < hand.length; i++) {
      if (!triedLeftover.add('${hand[i].rank}|${hand[i].suit}')) continue;
      final remaining = List<RummyCard>.from(hand)..removeAt(i);
      final found = _partitionSearch(remaining, wildRank, const [], 0, 0);
      if (found != null) {
        return found.map((g) => g.map((c) => c.id).toList()).toList();
      }
    }
    return null;
  }

  // Partition `remaining` into valid 3-/4-card groups. Only combinations
  // containing the lowest-index remaining card are tried — it has to land in
  // some group, so this enumerates each distinct partition exactly once.
  List<List<RummyCard>>? _partitionSearch(
    List<RummyCard> remaining,
    String wildRank,
    List<List<RummyCard>> acc,
    int sequences,
    int pures,
  ) {
    if (remaining.isEmpty) {
      return (sequences >= 2 && pures >= 1) ? List<List<RummyCard>>.from(acc) : null;
    }
    if (remaining.length < 3) return null;
    // Prune: even if every group still to be formed were a pure sequence, the
    // >=2 sequences / >=1 pure requirement could not be met from here.
    final maxMoreGroups = remaining.length ~/ 3;
    if (sequences + maxMoreGroups < 2) return null;
    if (pures + maxMoreGroups < 1) return null;

    final head = remaining[0];
    final rest = remaining.sublist(1);
    for (final size in const [3, 4]) {
      final pickCount = size - 1;
      if (rest.length < pickCount) continue;
      for (final combo in _comboIndices(rest.length, pickCount)) {
        final group = <RummyCard>[head, ...combo.map((i) => rest[i])];
        final check = checkGroup(group, wildRank);
        if (!check.valid) continue;
        final used = combo.toSet();
        final nextRemaining = <RummyCard>[];
        for (var i = 0; i < rest.length; i++) {
          if (!used.contains(i)) nextRemaining.add(rest[i]);
        }
        final found = _partitionSearch(
          nextRemaining,
          wildRank,
          [...acc, group],
          sequences + (check.kind == 'sequence' ? 1 : 0),
          pures + (check.kind == 'sequence' && check.pure ? 1 : 0),
        );
        if (found != null) return found;
      }
    }
    return null;
  }

  Iterable<List<int>> _comboIndices(int n, int k) sync* {
    final picked = <int>[];
    Iterable<List<int>> rec(int start) sync* {
      if (picked.length == k) {
        yield List<int>.from(picked);
        return;
      }
      // Not enough entries left to finish this combination — stop early.
      if (n - start < k - picked.length) return;
      for (var i = start; i < n; i++) {
        picked.add(i);
        yield* rec(i + 1);
        picked.removeLast();
      }
    }

    yield* rec(0);
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

  // Calculate Indian Rummy penalty score (0 - 80 points)
  int calculateHandScore(List<RummyCard> hand, List<List<String>> groups, String wildRank) {
    return getHandValidationSummary(hand, groups, wildRank).totalScore;
  }

  // Comprehensive Hand Validation Summary for live UI badges and scoring HUD
  HandValidationSummary getHandValidationSummary(
      List<RummyCard> hand, List<List<String>> groups, String wildRank) {
    if (hand.isEmpty) {
      return HandValidationSummary(
        totalScore: 80,
        pureSequences: 0,
        impureSequences: 0,
        sets: 0,
        isReadyToDeclare: false,
        groupStatuses: [],
      );
    }

    final byId = {for (final c in hand) c.id: c};

    int cardPoint(RummyCard c) {
      if (isJokerCard(c, wildRank)) return 0;
      if (['A', 'K', 'Q', 'J', '10'].contains(c.rank)) return 10;
      return int.tryParse(c.rank) ?? 10;
    }

    var pureSeqCount = 0;
    var secondSeqCount = 0;
    var setsCount = 0;
    final validGroupIndices = <int>{};
    final groupStatuses = <GroupMeldInfo>[];

    // Pass 1: Identify pure sequences (no jokers)
    for (var i = 0; i < groups.length; i++) {
      final ids = groups[i];
      final cards = ids.map((id) => byId[id]).whereType<RummyCard>().toList();
      if (cards.length >= 3) {
        final check = checkGroup(cards, wildRank);
        if (check.valid && check.kind == 'sequence' && check.pure) {
          pureSeqCount++;
          validGroupIndices.add(i);
        }
      }
    }

    // Pass 2: Identify second sequence (impure or another pure)
    for (var i = 0; i < groups.length; i++) {
      if (validGroupIndices.contains(i)) continue;
      final ids = groups[i];
      final cards = ids.map((id) => byId[id]).whereType<RummyCard>().toList();
      if (cards.length >= 3) {
        final check = checkGroup(cards, wildRank);
        if (check.valid && check.kind == 'sequence') {
          secondSeqCount++;
          validGroupIndices.add(i);
        }
      }
    }

    // Pass 3: Identify valid sets (only valid if at least 1 pure + 1 second sequence present)
    final hasRequiredSequences = (pureSeqCount >= 1) && ((pureSeqCount + secondSeqCount) >= 2);
    if (hasRequiredSequences) {
      for (var i = 0; i < groups.length; i++) {
        if (validGroupIndices.contains(i)) continue;
        final ids = groups[i];
        final cards = ids.map((id) => byId[id]).whereType<RummyCard>().toList();
        if (cards.length >= 3 && cards.length <= 4) {
          final check = checkGroup(cards, wildRank);
          if (check.valid && check.kind == 'set') {
            setsCount++;
            validGroupIndices.add(i);
          }
        }
      }
    }

    // Build GroupMeldInfo for each group
    for (var i = 0; i < groups.length; i++) {
      final ids = groups[i];
      final cards = ids.map((id) => byId[id]).whereType<RummyCard>().toList();
      if (cards.length < 3) {
        final pts = cards.map(cardPoint).fold<int>(0, (a, b) => a + b);
        groupStatuses.add(GroupMeldInfo(
          groupIdx: i,
          kind: 'invalid',
          isPure: false,
          isValidMeld: false,
          penaltyPoints: pts,
          label: '${cards.length} Cards',
        ));
        continue;
      }

      final check = checkGroup(cards, wildRank);
      if (check.valid) {
        if (check.kind == 'sequence') {
          if (check.pure) {
            groupStatuses.add(GroupMeldInfo(
              groupIdx: i,
              kind: 'pure_sequence',
              isPure: true,
              isValidMeld: true,
              penaltyPoints: 0,
              label: 'Pure Sec',
            ));
          } else {
            groupStatuses.add(GroupMeldInfo(
              groupIdx: i,
              kind: 'impure_sequence',
              isPure: false,
              isValidMeld: true,
              penaltyPoints: pureSeqCount >= 1 ? 0 : cards.map(cardPoint).fold<int>(0, (a, b) => a + b),
              label: 'Impure Sec',
            ));
          }
        } else if (check.kind == 'set') {
          groupStatuses.add(GroupMeldInfo(
            groupIdx: i,
            kind: 'set',
            isPure: false,
            isValidMeld: hasRequiredSequences,
            penaltyPoints: hasRequiredSequences ? 0 : cards.map(cardPoint).fold<int>(0, (a, b) => a + b),
            label: 'Set',
          ));
        }
      } else {
        final pts = cards.map(cardPoint).fold<int>(0, (a, b) => a + b);
        groupStatuses.add(GroupMeldInfo(
          groupIdx: i,
          kind: 'invalid',
          isPure: false,
          isValidMeld: false,
          penaltyPoints: pts,
          label: 'Invalid ($pts pts)',
        ));
      }
    }

    // Calculate total hand penalty score
    int total = 0;
    if (pureSeqCount == 0) {
      // No pure sequence: all cards count
      total = hand.map(cardPoint).fold<int>(0, (a, b) => a + b);
    } else if (pureSeqCount + secondSeqCount < 2) {
      // Has pure, but lacking 2nd sequence: pure groups are exempt, all others count
      for (var i = 0; i < groups.length; i++) {
        if (validGroupIndices.contains(i)) continue;
        for (final id in groups[i]) {
          final c = byId[id];
          if (c != null) total += cardPoint(c);
        }
      }
    } else {
      // Both sequences satisfied: only invalid groups & unassigned count
      for (var i = 0; i < groups.length; i++) {
        if (!validGroupIndices.contains(i)) {
          for (final id in groups[i]) {
            final c = byId[id];
            if (c != null) total += cardPoint(c);
          }
        }
      }
    }

    // Add any unassigned cards
    final assigned = groups.expand((g) => g).toSet();
    for (final c in hand) {
      if (!assigned.contains(c.id)) total += cardPoint(c);
    }

    final totalScore = min(80, total);
    final totalAssigned = assigned.length;
    final isReady = totalScore == 0 &&
        pureSeqCount >= 1 &&
        (pureSeqCount + secondSeqCount >= 2) &&
        (totalAssigned == 13 || totalAssigned == 14);

    return HandValidationSummary(
      totalScore: totalScore,
      pureSequences: pureSeqCount,
      impureSequences: secondSeqCount,
      sets: setsCount,
      isReadyToDeclare: isReady,
      groupStatuses: groupStatuses,
    );
  }

  // Smart Auto-Grouper / Magic Meld for 13 or 14 card hands
  List<List<String>> smartAutoGroup(List<RummyCard> hand, String wildRank) {
    if (hand.isEmpty) return [];
    final pool = List<RummyCard>.from(hand);
    final groups = <List<RummyCard>>[];

    // 1. Try finding complete valid declare grouping first if 14 cards
    if (pool.length == 14) {
      final decl = findValidDeclareGrouping(pool, wildRank);
      if (decl != null) return decl;
    }

    // 2. Identify pure sequences first
    final suitMap = <String, List<RummyCard>>{};
    for (final c in pool) {
      if (!isJokerCard(c, wildRank)) {
        suitMap.putIfAbsent(c.suit, () => []).add(c);
      }
    }

    for (final entry in suitMap.entries) {
      final naturals = entry.value;
      naturals.sort((a, b) => (_rankValue[a.rank] ?? 0).compareTo(_rankValue[b.rank] ?? 0));
      // Find consecutive runs of 3 or more
      var currentRun = <RummyCard>[];
      for (var i = 0; i < naturals.length; i++) {
        if (currentRun.isEmpty) {
          currentRun.add(naturals[i]);
        } else {
          final lastVal = _rankValue[currentRun.last.rank] ?? 0;
          final curVal = _rankValue[naturals[i].rank] ?? 0;
          if (curVal == lastVal + 1) {
            currentRun.add(naturals[i]);
          } else if (curVal > lastVal + 1) {
            if (currentRun.length >= 3) {
              groups.add(List.from(currentRun));
              for (final c in currentRun) pool.removeWhere((p) => p.id == c.id);
            }
            currentRun = [naturals[i]];
          }
        }
      }
      if (currentRun.length >= 3) {
        groups.add(List.from(currentRun));
        for (final c in currentRun) pool.removeWhere((p) => p.id == c.id);
      }
    }

    // 3. Fallback: Group remaining cards by suit & rank order
    final leftoverSuitMap = <String, List<RummyCard>>{};
    final jokers = <RummyCard>[];
    for (final c in pool) {
      if (isJokerCard(c, wildRank)) {
        jokers.add(c);
      } else {
        leftoverSuitMap.putIfAbsent(c.suit, () => []).add(c);
      }
    }

    for (final s in ['S', 'H', 'C', 'D']) {
      final list = leftoverSuitMap[s] ?? [];
      if (list.isNotEmpty) {
        list.sort((a, b) => (_rankValue[a.rank] ?? 0).compareTo(_rankValue[b.rank] ?? 0));
        groups.add(list);
      }
    }
    if (jokers.isNotEmpty) {
      if (groups.isNotEmpty) {
        groups.last.addAll(jokers);
      } else {
        groups.add(jokers);
      }
    }

    return groups.map((g) => g.map((c) => c.id).toList()).toList();
  }
}
